import { useStore } from './store.js';
import { modelsFor, defaultOpts, IMAGE_MODELS, UPSCALE } from './models.js';
import { createTask, getTask, uploadBlob, downloadBlob } from './kie.js';
import { getMedia, updateMedia, putMedia, uid } from './db.js';

const DAY = 86400000;
const TIMEOUT = 30 * 60000;
const running = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Média produit par un nœud (image courante ou image importée).
export function outputOf(node) {
  if (!node) return null;
  if (node.type === 'import') return node.data.mediaId ? { mediaId: node.data.mediaId } : null;
  const v = node.data.versions?.[node.data.current];
  return v ? { mediaId: v.mediaId, url: v.url } : null;
}

// Nœuds reliés en entrée, dans l'ordre de création des liens.
export function inputsOf(board, nodeId) {
  return board.edges
    .filter((e) => e.target === nodeId)
    .map((e) => board.nodes.find((n) => n.id === e.source))
    .filter(Boolean);
}

export function costOf(kind, data) {
  const m = modelsFor(kind)[data.model];
  const c = m ? m.cost(defaultOpts(m, data.opts)) : null;
  return c == null ? null : c * (data.count || 1);
}

const validRatio = (model, ratio) => (model.ratios?.includes(ratio) ? ratio : model.defaultRatio || model.ratios?.[0]);

// URL publique d'un média local : on réutilise l'URL KIE si récente, sinon on l'upload.
async function publicUrl(apiKey, out) {
  const rec = out.mediaId && (await getMedia(out.mediaId));
  if (!rec) {
    if (out.url) return out.url;
    throw new Error('Image d’entrée introuvable');
  }
  const now = Date.now();
  if (rec.uploadedUrl && now - rec.uploadedAt < 2 * DAY) return rec.uploadedUrl;
  if (rec.remoteUrl && now - rec.createdAt < DAY) return rec.remoteUrl;
  const ext = (rec.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const url = await uploadBlob(apiKey, rec.blob, `${out.mediaId}.${ext}`);
  await updateMedia(out.mediaId, { uploadedUrl: url, uploadedAt: now });
  return url;
}

const patcher = (boardId, nodeId) => (p) => useStore.getState().patchNodeData(boardId, nodeId, p);
const updateTask = (patch, localId, p) =>
  patch((d) => ({ tasks: (d.tasks || []).map((t) => (t.localId === localId ? { ...t, ...p } : t)) }));
const removeTask = (patch, localId, extra = {}) =>
  patch((d) => ({ tasks: (d.tasks || []).filter((t) => t.localId !== localId), ...extra }));

// Envoie `count` tâches identiques chez KIE et suit chacune.
async function launch(boardId, nodeId, { count, label, prepare }) {
  const patch = patcher(boardId, nodeId);
  const kind = useStore.getState().findNode(boardId, nodeId)?.type;
  const ids = Array.from({ length: count }, () => uid());
  patch((d) => ({
    error: null,
    tasks: [...(d.tasks || []), ...ids.map((localId) => ({ localId, status: 'envoi', startedAt: Date.now(), kind }))],
  }));
  try {
    const { kieModel, input, meta } = await prepare((status) => ids.forEach((l) => updateTask(patch, l, { status })));
    patch({ lastRequest: { model: kieModel, input } });
    await Promise.all(ids.map(async (localId) => {
      try {
        const id = await createTask(useStore.getState().apiKey, kieModel, input);
        updateTask(patch, localId, { id, status: 'waiting', startedAt: Date.now(), label, ...meta });
        track(boardId, nodeId, localId);
      } catch (e) {
        removeTask(patch, localId, { error: `KIE a refusé l’envoi (${kieModel}) : ${e.message}` });
      }
    }));
  } catch (e) {
    ids.forEach((l) => removeTask(patch, l, { error: e.message }));
  }
}

export function runNode(boardId, nodeId) {
  const s = useStore.getState();
  const node = s.findNode(boardId, nodeId);
  if (!node) return;
  const d = node.data;
  const model = modelsFor(node.type)[d.model];
  const opts = defaultOpts(model, d.opts);
  return launch(boardId, nodeId, {
    count: d.count || 1,
    prepare: async (setStatus) => {
      if (!d.prompt.trim()) throw new Error('Prompt vide');
      const outs = inputsOf(s.boards[boardId], nodeId).map(outputOf).filter(Boolean);
      const max = node.type === 'video' ? model.maxImages : model.maxRefs;
      if (outs.length > max) throw new Error(`${model.label} accepte ${max} image(s) max en entrée`);
      if (outs.length) setStatus('upload');
      const urls = [];
      for (const o of outs) urls.push(await publicUrl(s.apiKey, o));
      const { model: kieModel, input } = model.build({
        prompt: d.prompt, ratio: validRatio(model, d.ratio), opts, refs: urls, images: urls,
      });
      if (d.extra?.trim()) Object.assign(input, JSON.parse(d.extra));
      return { kieModel, input, meta: { prompt: d.prompt, model: d.model, cost: model.cost(opts) } };
    },
  });
}

// Relance l'image affichée en 4K avec Nano Banana Pro, sans rien changer d'autre.
export function upscaleNode(boardId, nodeId) {
  const s = useStore.getState();
  const node = s.findNode(boardId, nodeId);
  const out = node && outputOf(node);
  if (!out) return;
  const version = node.data.versions[node.data.current];
  return launch(boardId, nodeId, {
    count: 1,
    label: 'Upscale 4K',
    prepare: async (setStatus) => {
      setStatus('upload');
      const url = await publicUrl(s.apiKey, out);
      const model = IMAGE_MODELS['nano-banana-pro'];
      const { model: kieModel, input } = model.build({
        prompt: UPSCALE.prompt, ratio: validRatio(model, node.data.ratio), refs: [url], opts: { resolution: '4K' },
      });
      return { kieModel, input, meta: { prompt: version.prompt, model: 'nano-banana-pro', cost: UPSCALE.cost, upscale: true } };
    },
  });
}

// Vérifie régulièrement une tâche jusqu'au résultat, puis télécharge les médias en local.
export async function track(boardId, nodeId, localId) {
  const key = `${boardId}:${nodeId}:${localId}`;
  if (running.has(key)) return;
  running.add(key);
  const patch = patcher(boardId, nodeId);
  let errors = 0;
  try {
    for (;;) {
      const s = useStore.getState();
      const t = s.findNode(boardId, nodeId)?.data.tasks?.find((x) => x.localId === localId);
      if (!t?.id) return;
      if (Date.now() - t.startedAt > TIMEOUT) return removeTask(patch, localId, { error: 'Délai dépassé' });
      try {
        const r = await getTask(s.apiKey, t.id);
        errors = 0;
        if (r.state === 'fail') {
          return removeTask(patch, localId, { error: `Génération échouée chez KIE : ${r.error || 'sans détail'}` });
        }
        if (r.state === 'success') {
          updateTask(patch, localId, { status: 'download' });
          const versions = [];
          let warn = null;
          for (const url of r.urls) {
            const v = {
              url, prompt: t.prompt, model: t.model, cost: t.cost, label: t.label,
              createdAt: Date.now(), mediaId: null,
            };
            try {
              v.mediaId = await putMedia(await downloadBlob(url), { remoteUrl: url });
            } catch (e) {
              warn = `${e.message} : lien KIE temporaire conservé, exporte-le vite.`;
            }
            versions.push(v);
          }
          return patch((d) => ({
            versions: [...d.versions, ...versions],
            current: d.versions.length + versions.length - 1,
            tasks: (d.tasks || []).filter((x) => x.localId !== localId),
            error: warn,
          }));
        }
        updateTask(patch, localId, { status: r.state });
      } catch (e) {
        if (++errors >= 5) return removeTask(patch, localId, { error: e.message });
      }
      await sleep(t.kind === 'video' ? 8000 : 3000);
    }
  } finally {
    running.delete(key);
  }
}

// Reprend le suivi des tâches en cours après un rechargement de la page.
export function resumeAll() {
  const { boards, patchNodeData } = useStore.getState();
  for (const b of Object.values(boards)) {
    for (const n of b.nodes) {
      // Ancien format : une seule tâche dans `task`.
      let tasks = n.data.tasks || [];
      if (n.data.task) tasks = [...tasks, { ...n.data.task, localId: uid() }];
      const alive = tasks.filter((t) => t.id);
      if (n.data.task || alive.length !== tasks.length) {
        patchNodeData(b.id, n.id, {
          task: undefined, tasks: alive, ...(alive.length !== tasks.length && { error: 'Interrompu' }),
        });
      }
      for (const t of alive) track(b.id, n.id, t.localId);
    }
  }
}
