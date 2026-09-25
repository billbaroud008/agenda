import { useStore } from './store.js';
import { modelsFor, defaultOpts } from './models.js';
import { createTask, getTask, uploadBlob, downloadBlob } from './kie.js';
import { getMedia, updateMedia, putMedia } from './db.js';

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
  return m ? m.cost(defaultOpts(m, data.opts)) : null;
}

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

export async function runNode(boardId, nodeId) {
  const s = useStore.getState();
  const node = s.findNode(boardId, nodeId);
  if (!node || node.data.task) return;
  const kind = node.type;
  const d = node.data;
  const model = modelsFor(kind)[d.model];
  const patch = (p) => useStore.getState().patchNodeData(boardId, nodeId, p);

  try {
    if (!d.prompt.trim()) throw new Error('Prompt vide');
    const opts = defaultOpts(model, d.opts);
    const outs = inputsOf(s.boards[boardId], nodeId).map(outputOf).filter(Boolean);
    const max = kind === 'video' ? model.maxImages : model.maxRefs;
    if (outs.length > max) throw new Error(`${model.label} accepte ${max} image(s) max en entrée`);

    patch({ error: null, task: { status: outs.length ? 'upload' : 'envoi', startedAt: Date.now() } });
    const urls = [];
    for (const o of outs) urls.push(await publicUrl(s.apiKey, o));

    const { model: kieModel, input } = model.build({
      prompt: d.prompt, ratio: d.ratio, opts, refs: urls, images: urls,
    });
    if (d.extra?.trim()) Object.assign(input, JSON.parse(d.extra));

    patch({ lastRequest: { model: kieModel, input } });
    let taskId;
    try {
      taskId = await createTask(useStore.getState().apiKey, kieModel, input);
    } catch (e) {
      throw new Error(`KIE a refusé l’envoi (${kieModel}) : ${e.message}`);
    }
    patch({
      task: {
        id: taskId, status: 'waiting', startedAt: Date.now(), kind,
        prompt: d.prompt, model: d.model, cost: model.cost(opts),
      },
    });
    track(boardId, nodeId);
  } catch (e) {
    patch({ task: null, error: e.message });
  }
}

// Vérifie régulièrement la tâche jusqu'au résultat, puis télécharge les médias en local.
export async function track(boardId, nodeId) {
  const key = `${boardId}:${nodeId}`;
  if (running.has(key)) return;
  running.add(key);
  const patch = (p) => useStore.getState().patchNodeData(boardId, nodeId, p);
  let errors = 0;
  try {
    for (;;) {
      const s = useStore.getState();
      const t = s.findNode(boardId, nodeId)?.data.task;
      if (!t?.id) return;
      if (Date.now() - t.startedAt > TIMEOUT) {
        patch({ task: null, error: 'Délai dépassé' });
        return;
      }
      try {
        const r = await getTask(s.apiKey, t.id);
        errors = 0;
        if (r.state === 'fail') {
          patch({ task: null, error: `Génération échouée chez KIE : ${r.error || 'sans détail'}` });
          return;
        }
        if (r.state === 'success') {
          patch((d) => ({ task: { ...d.task, status: 'download' } }));
          const versions = [];
          let warn = null;
          for (const url of r.urls) {
            const v = { url, prompt: t.prompt, model: t.model, cost: t.cost, createdAt: Date.now(), mediaId: null };
            try {
              v.mediaId = await putMedia(await downloadBlob(url), { remoteUrl: url });
            } catch (e) {
              warn = `${e.message} : lien KIE temporaire conservé, exporte-le vite.`;
            }
            versions.push(v);
          }
          patch((d) => ({
            versions: [...d.versions, ...versions],
            current: d.versions.length + versions.length - 1,
            task: null,
            error: warn,
          }));
          return;
        }
        patch((d) => ({ task: { ...d.task, status: r.state } }));
      } catch (e) {
        if (++errors >= 5) {
          patch({ task: null, error: e.message });
          return;
        }
      }
      await sleep(t.kind === 'video' ? 8000 : 3000);
    }
  } finally {
    running.delete(key);
  }
}

// Reprend le suivi des tâches en cours après un rechargement de la page.
export function resumeAll() {
  const { boards } = useStore.getState();
  for (const b of Object.values(boards)) {
    for (const n of b.nodes) {
      if (n.data.task?.id) track(b.id, n.id);
      else if (n.data.task) useStore.getState().patchNodeData(b.id, n.id, { task: null, error: 'Interrompu' });
    }
  }
}
