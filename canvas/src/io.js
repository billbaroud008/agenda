import { getMedia, putMedia, hasMedia, mediaIdsOf, uid, setSetting } from './db.js';
import { useStore, flush } from './store.js';

const toDataUrl = (blob) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = ko;
  r.readAsDataURL(blob);
});

// Fichier .json autonome : structure des boards + médias encodés en base64.
export async function exportBoards(ids) {
  await flush();
  const { boards } = useStore.getState();
  const list = ids.map((id) => boards[id]).map(({ id, name, nodes, edges, viewport, createdAt }) => ({
    id, name, createdAt, viewport,
    nodes: nodes.map(({ selected, dragging, ...n }) => ({ ...n, data: { ...n.data, tasks: [] } })),
    edges: edges.map(({ selected, ...e }) => e),
  }));
  const media = {};
  for (const b of list) {
    for (const mid of mediaIdsOf(b)) {
      const m = await getMedia(mid);
      if (m) media[mid] = { ...m, blob: undefined, uploadedUrl: undefined, data: await toDataUrl(m.blob) };
    }
  }
  const file = { format: 'ia-canvas', version: 1, exportedAt: new Date().toISOString(), boards: list, media };
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const name = list.length === 1 ? list[0].name.replace(/[^\w-]+/g, '_') : 'tous-les-boards';
  a.download = `canvas-${name}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  await setSetting('lastExport', Date.now());
}

export async function importFile(file) {
  const json = JSON.parse(await file.text());
  if (json.format !== 'ia-canvas') throw new Error('Fichier non reconnu');
  for (const [id, m] of Object.entries(json.media || {})) {
    if (await hasMedia(id)) continue;
    const blob = await (await fetch(m.data)).blob();
    const { data, ...meta } = m;
    await putMedia(blob, meta, id);
  }
  const { boards } = useStore.getState();
  const list = json.boards.map((b) => ({
    ...b,
    id: boards[b.id] ? uid() : b.id,
    name: boards[b.id] ? `${b.name} (import)` : b.name,
    createdAt: b.createdAt || Date.now(),
    updatedAt: Date.now(),
  }));
  useStore.getState().addBoards(list);
  useStore.getState().setActive(list[0].id);
  return list.length;
}
