// Synchronisation avec le disque (serveur de dev uniquement) :
// 1. chaque board est aussi enregistré dans <racine>/canvas/<board>/ ;
// 2. les images générées par Claude (<racine>/<dossier>/*.png + .json) arrivent seules dans le canvas.
import { useStore, hooks, DEFAULT_DATA, arrangeNodes } from './store.js';
import { getMedia, putMedia, hasMedia, mediaIdsOf, getSetting, setSetting, uid, deleteBoardDb } from './db.js';
import { IMAGE_MODELS } from './models.js';

const DEV = import.meta.env.DEV;
const POLL_MS = 5000;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

export const diskState = { available: false, root: null };

const api = async (path, opts) => {
  const r = await fetch(`/disk/${path}`, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erreur disque ${r.status}`);
  return r;
};
const enc = encodeURIComponent;

export const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';

export async function setRoot(root) {
  const r = await (await api('status', { method: 'POST', body: JSON.stringify({ root }) })).json();
  Object.assign(diskState, { root: r.root, available: r.exists });
  return r;
}

// --- 1. Boards sur le disque -------------------------------------------

const knownMedia = {}; // dossier → Set des fichiers déjà écrits

function folderFor(board) {
  if (board.folder) return board.folder;
  const taken = new Set(Object.values(useStore.getState().boards).map((b) => b.folder).filter(Boolean));
  const base = slugify(board.name);
  let f = base;
  for (let i = 2; taken.has(f); i++) f = `${base}-${i}`;
  useStore.getState().updateBoard(board.id, () => ({ folder: f }));
  return f;
}

async function saveToDisk(board) {
  const folder = folderFor(board);
  await api(`boards/${enc(folder)}`, { method: 'PUT', body: JSON.stringify({ ...board, folder }) });
  if (!knownMedia[folder]) knownMedia[folder] = new Set(await (await api(`boards/${enc(folder)}/medias`)).json());
  for (const id of mediaIdsOf(board)) {
    if ([...knownMedia[folder]].some((f) => f.startsWith(`${id}.`))) continue;
    const m = await getMedia(id);
    if (!m) continue;
    const file = `${id}.${EXT[m.type] || 'bin'}`;
    await api(`boards/${enc(folder)}/medias/${enc(file)}`, { method: 'PUT', body: m.blob });
    knownMedia[folder].add(file);
  }
}

// Reprend les boards du disque : ceux absents du navigateur, ou plus récents sur le disque.
async function loadFromDisk() {
  const disk = await (await api('boards')).json();
  const { boards, addBoards } = useStore.getState();
  const newer = disk.filter((b) => !boards[b.id] || (b.updatedAt || 0) > (boards[b.id].updatedAt || 0));
  for (const b of newer) {
    const files = await (await api(`boards/${enc(b.folder)}/medias`)).json();
    knownMedia[b.folder] = new Set(files);
    for (const id of mediaIdsOf(b)) {
      if (await hasMedia(id)) continue;
      const file = files.find((f) => f.startsWith(`${id}.`));
      if (file) await putMedia(await (await api(`boards/${enc(b.folder)}/medias/${enc(file)}`)).blob(), {}, id);
    }
  }
  if (newer.length) addBoards(newer);
  // Board vide créé au démarrage alors que le disque en contient déjà : on le retire.
  const placeholder = Object.values(useStore.getState().boards).find((b) => b.placeholder && !b.nodes.length);
  if (placeholder && disk.length) {
    const first = [...disk].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (useStore.getState().activeId === placeholder.id) useStore.getState().setActive(first.id);
    const { [placeholder.id]: _, ...rest } = useStore.getState().boards;
    useStore.setState({ boards: rest });
    await deleteBoardDb(placeholder.id);
  }
  // Les boards qui n'existent que dans le navigateur partent sur le disque.
  const onDisk = new Set(disk.map((b) => b.id));
  for (const b of Object.values(useStore.getState().boards)) {
    if (!onDisk.has(b.id) && !(b.placeholder && !b.nodes.length)) await saveToDisk(b).catch(() => {});
  }
}

// --- 2. Images générées par Claude ---------------------------------------

// « 11-chercheur-d-or-flare.png » et « 11-chercheur-d-or-zimage.png » → même personnage « 11 ».
const groupKey = (name) => name.match(/^(\d+)[-_ ]/)?.[1] || name.replace(/\.[^.]+$/, '');

// « 11-chercheur-d-or-flare.png » → « 11 chercheur d or » (sans le nom du modèle à la fin).
const MODEL_WORDS = /^(zimage|z-image|flare|sunburst|gpt|gpt2|gpt25|nano|banana|nanobanana|pro|lite|seedream|grok|imagen|flux|mj|v\d+)$/i;
function titleFromFile(name) {
  const parts = name.replace(/\.[^.]+$/, '').split(/[-_ ]+/);
  while (parts.length > 2 && MODEL_WORDS.test(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

// Associe le nom de modèle écrit par Claude à un modèle du canvas (pour pouvoir relancer).
function modelFor(meta) {
  const m = (meta?.model || '').toLowerCase();
  if (m.includes('2.5') || m.includes('flare') || m.includes('sunburst')) {
    return { model: 'gpt-image-2-5', opts: { version: m.includes('sunburst') ? 'Sunburst' : 'Flare' } };
  }
  if (m.includes('gpt')) return { model: 'gpt-image-2', opts: {} };
  if (m.includes('banana') && m.includes('pro')) return { model: 'nano-banana-pro', opts: {} };
  if (m.includes('grok')) return { model: 'grok-imagine-image-2', opts: {} };
  if (m.includes('seedream')) return { model: 'seedream-4', opts: {} };
  return { model: 'nano-banana', opts: {} };
}

async function ignoredFolders() {
  return new Set((await getSetting('claudeIgnored')) || []);
}
export async function ignoreClaudeFolder(folder) {
  const s = await ignoredFolders();
  s.add(folder);
  await setSetting('claudeIgnored', [...s]);
}

async function importClaude() {
  const folders = await (await api('claude')).json();
  const ignored = await ignoredFolders();
  const store = useStore.getState();

  for (const { folder, files } of folders) {
    if (ignored.has(folder) || !files.length) continue;
    const boardId = `claude-${slugify(folder)}`;
    if (!store.boards[boardId]) {
      store.addBoards([{
        id: boardId, name: folder, claudeFolder: folder, nodes: [], edges: [],
        viewport: { x: 40, y: 40, zoom: 0.6 }, createdAt: Date.now(), updatedAt: Date.now(),
      }]);
    }
    const board = useStore.getState().boards[boardId];
    const known = new Map((board.claudeDismissed || []).map((src) => [src, { prompt: 'x' }]));
    for (const n of board.nodes) for (const v of n.data.versions || []) if (v.source) known.set(v.source, v);

    // Télécharge d'abord les nouvelles images, puis met le board à jour en une fois.
    const added = [];
    const promptUpdates = new Map();
    for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
      const source = `${folder}/${f.name}`;
      const v = known.get(source);
      if (v) {
        if (!v.prompt && f.meta?.prompt) promptUpdates.set(source, f.meta);
        continue;
      }
      const blob = await (await api(`file?path=${enc(source)}`)).blob();
      const mediaId = await putMedia(blob, { name: f.name });
      added.push({ f, source, mediaId });
    }
    if (!added.length && !promptUpdates.size) continue;

    store.updateBoard(boardId, (b) => {
      let nodes = b.nodes.map((n) => {
        const versions = (n.data.versions || []).map((v) => {
          const meta = promptUpdates.get(v.source);
          return meta ? { ...v, prompt: meta.prompt, model: meta.model || v.model, cost: meta.cost_credits ?? v.cost, ref: meta.reference } : v;
        });
        const cur = versions[n.data.current];
        const prompt = promptUpdates.has(cur?.source) ? cur.prompt : n.data.prompt;
        return { ...n, data: { ...n.data, versions, prompt } };
      });

      for (const { f, source, mediaId } of added) {
        const meta = f.meta || {};
        const version = {
          mediaId, source, url: meta.url || null, prompt: meta.prompt || '', model: meta.model || 'Claude',
          cost: meta.cost_credits ?? null, ref: meta.reference || null,
          createdAt: Date.parse(meta.created) || f.mtime,
        };
        const key = groupKey(f.name);
        const i = nodes.findIndex((n) => n.data.claudeKey === key);
        if (i >= 0) {
          const d = nodes[i].data;
          nodes[i] = { ...nodes[i], data: { ...d, versions: [...d.versions, version], current: d.versions.length, prompt: version.prompt || d.prompt } };
          continue;
        }
        const { model, opts } = modelFor(meta);
        const ratio = meta.settings?.ratio;
        const count = nodes.filter((n) => n.data.claudeKey).length;
        nodes.push({
          id: uid(),
          type: 'image',
          position: { x: (count % 4) * 380, y: Math.floor(count / 4) * 780 },
          data: {
            ...structuredClone(DEFAULT_DATA.image), model, opts,
            ratio: IMAGE_MODELS[model].ratios.includes(ratio) ? ratio : DEFAULT_DATA.image.ratio,
            title: meta.title || titleFromFile(f.name),
            prompt: version.prompt, claudeKey: key, versions: [version], current: 0,
          },
        });
      }

      // Image de référence (« reference » dans le .json) → fil depuis le nœud qui la contient.
      const edges = [...b.edges];
      for (const n of nodes) {
        for (const v of n.data.versions || []) {
          if (!v.ref) continue;
          const src = nodes.find((m) => m.id !== n.id && m.data.versions?.some((x) => x.source === `${folder}/${v.ref}`));
          if (src && !edges.some((e) => e.source === src.id && e.target === n.id)) {
            edges.push({ id: uid(), source: src.id, target: n.id, sourceHandle: 'out', targetHandle: 'refs' });
          }
        }
      }
      // Rangés par titre tant qu'aucun nœud n'a été déplacé à la main.
      return { nodes: b.autoArrange === false ? nodes : arrangeNodes(nodes), edges };
    });
  }
}

// --- Démarrage ------------------------------------------------------------

export async function initDisk() {
  if (!DEV) return;
  try {
    const s = await (await api('status')).json();
    Object.assign(diskState, { root: s.root, available: s.exists });
  } catch {
    return;
  }
  if (!diskState.available) return;

  hooks.save = (b) => saveToDisk(b).catch((e) => console.warn('Sauvegarde disque', e));
  hooks.remove = async (b) => {
    if (b.claudeFolder) await ignoreClaudeFolder(b.claudeFolder);
    if (b.folder) await api(`boards/${enc(b.folder)}`, { method: 'DELETE' }).catch(() => {});
  };
  await loadFromDisk().catch((e) => console.warn('Chargement disque', e));

  const poll = async () => {
    await importClaude().catch((e) => console.warn('Import Claude', e));
    setTimeout(poll, POLL_MS);
  };
  poll();
}
