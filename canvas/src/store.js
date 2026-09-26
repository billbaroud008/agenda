import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { listBoards, saveBoard, deleteBoardDb, getSetting, setSetting, gcMedia, uid } from './db.js';

const TYPE_TITLE = { image: 'Image', video: 'Vidéo', import: 'Import', note: 'Note' };
// « 11-chercheur-d-or-flare.png » → « 11 chercheur d or » (sans le nom du modèle à la fin).
const MODEL_WORDS = /^(zimage|z-image|flare|sunburst|gpt|gpt2|gpt25|nano|banana|nanobanana|pro|lite|seedream|grok|imagen|flux|mj|v\d+)$/i;
export function titleFromFile(name) {
  const parts = name.replace(/^.*\//, '').replace(/\.[^.]+$/, '').split(/[-_ ]+/);
  while (parts.length > 2 && MODEL_WORDS.test(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

// Titre affiché : titre saisi, sinon nom du fichier d'origine (images Claude, imports), sinon le type.
export function titleOfData(type, data) {
  const source = data.versions?.find((v) => v.source)?.source;
  return data.title
    || (source && titleFromFile(source))
    || data.name?.replace(/\.[^.]+$/, '')
    || TYPE_TITLE[type] || '';
}
export const titleOf = (n) => titleOfData(n.type, n.data);

// Grille de 4 colonnes, nœuds triés par titre (« 2 » avant « 10 »).
export function arrangeNodes(nodes) {
  const sorted = [...nodes].sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'fr', { numeric: true }));
  const pos = new Map();
  let y = 0;
  for (let i = 0; i < sorted.length; i += 4) {
    const row = sorted.slice(i, i + 4);
    row.forEach((n, k) => pos.set(n.id, { x: k * 380, y }));
    y += Math.max(...row.map((n) => n.measured?.height || (n.type === 'note' ? 160 : 760))) + 60;
  }
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) }));
}

// Images Claude d'un nœud : fermées, elles ne sont pas réimportées.
const sourcesOf = (n) => (n.data.versions || []).map((v) => v.source).filter(Boolean);

// Branchements de la sauvegarde disque (voir disk.js).
export const hooks = { save: null, remove: null };

export const newBoard = (name) => ({
  id: uid(), name, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: Date.now(), updatedAt: Date.now(),
});

export const DEFAULT_DATA = {
  image: { prompt: '', model: 'nano-banana', ratio: '1:1', opts: {}, extra: '', versions: [], current: -1 },
  video: { prompt: '', model: 'seedance-2-5-frames', ratio: 'adaptive', opts: {}, extra: '', versions: [], current: -1 },
  import: { mediaId: null, name: '' },
  note: { text: '' },
};

export const useStore = create((set, get) => ({
  ready: false,
  boards: {},
  activeId: null,
  apiKey: '',
  anthropicKey: '',

  async init() {
    let list = await listBoards();
    if (!list.length) {
      const b = { ...newBoard('Projet 1'), placeholder: true };
      await saveBoard(b);
      list = [b];
    }
    await gcMedia(list);
    const boards = Object.fromEntries(list.map((b) => [b.id, b]));
    const last = await getSetting('activeBoard');
    for (const b of list) lastSaved[b.id] = b;
    set({
      boards,
      activeId: boards[last] ? last : list.sort((a, b) => a.createdAt - b.createdAt)[0].id,
      apiKey: (await getSetting('apiKey')) || '',
      anthropicKey: (await getSetting('anthropicKey')) || '',
      ready: true,
    });
  },

  setApiKey(k) {
    set({ apiKey: k });
    setSetting('apiKey', k);
  },

  setAnthropicKey(k) {
    set({ anthropicKey: k });
    setSetting('anthropicKey', k);
  },

  setActive(id) {
    flush();
    set({ activeId: id });
    setSetting('activeBoard', id);
  },

  updateBoard(id, fn) {
    set((s) => {
      const b = s.boards[id];
      if (!b) return {};
      return { boards: { ...s.boards, [id]: { ...b, ...fn(b), updatedAt: Date.now() } } };
    });
  },

  createBoard(name) {
    const b = newBoard(name);
    set((s) => ({ boards: { ...s.boards, [b.id]: b } }));
    get().setActive(b.id);
  },

  renameBoard(id, name) {
    get().updateBoard(id, () => ({ name }));
  },

  async deleteBoard(id) {
    const { boards } = get();
    const rest = { ...boards };
    delete rest[id];
    if (!Object.keys(rest).length) {
      const b = newBoard('Projet 1');
      rest[b.id] = b;
    }
    delete lastSaved[id];
    await hooks.remove?.(boards[id]);
    await deleteBoardDb(id);
    set({ boards: rest });
    get().setActive(Object.values(rest).sort((a, b) => a.createdAt - b.createdAt)[0].id);
    await gcMedia(Object.values(rest));
  },

  addBoards(list) {
    set((s) => {
      const boards = { ...s.boards };
      for (const b of list) boards[b.id] = b;
      return { boards };
    });
  },

  // --- Canvas actif ---
  onNodesChange(changes) {
    get().updateBoard(get().activeId, (b) => {
      const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id));
      const dismissed = b.nodes.filter((n) => removed.has(n.id)).flatMap(sourcesOf);
      // Un nœud déplacé à la main désactive le rangement automatique du board.
      const moved = changes.some((c) => c.type === 'position' && c.dragging === false);
      return {
        nodes: applyNodeChanges(changes, b.nodes),
        ...(dismissed.length && { claudeDismissed: [...(b.claudeDismissed || []), ...dismissed] }),
        ...(moved && { autoArrange: false }),
      };
    });
  },
  arrangeByTitle() {
    get().updateBoard(get().activeId, (b) => ({ nodes: arrangeNodes(b.nodes), autoArrange: true }));
  },
  removeNode(nodeId) {
    get().onNodesChange([{ type: 'remove', id: nodeId }]);
    get().onEdgesChange(
      get().boards[get().activeId].edges.filter((e) => e.source === nodeId || e.target === nodeId).map((e) => ({ type: 'remove', id: e.id })),
    );
  },
  // Retire une version de l'historique d'un nœud.
  removeVersion(nodeId, index) {
    get().updateBoard(get().activeId, (b) => {
      const n = b.nodes.find((x) => x.id === nodeId);
      const v = n?.data.versions?.[index];
      if (!v) return {};
      const versions = n.data.versions.filter((_, i) => i !== index);
      const current = Math.min(Math.max(0, n.data.current - (index <= n.data.current ? 1 : 0)), versions.length - 1);
      return {
        nodes: b.nodes.map((x) => (x.id === nodeId ? { ...x, data: { ...x.data, versions, current } } : x)),
        ...(v.source && { claudeDismissed: [...(b.claudeDismissed || []), v.source] }),
      };
    });
  },
  onEdgesChange(changes) {
    get().updateBoard(get().activeId, (b) => ({ edges: applyEdgeChanges(changes, b.edges) }));
  },
  onConnect(conn) {
    get().updateBoard(get().activeId, (b) => ({ edges: addEdge({ ...conn, id: uid() }, b.edges) }));
  },
  setViewport(viewport) {
    get().updateBoard(get().activeId, () => ({ viewport }));
  },

  addNode(type, position, data = {}) {
    const node = { id: uid(), type, position, data: { ...structuredClone(DEFAULT_DATA[type]), ...data } };
    if (type === 'note') node.style = { width: 220, height: 140 };
    get().updateBoard(get().activeId, (b) => ({ nodes: [...b.nodes, node] }));
    return node.id;
  },

  // Copie le nœud (prompt, modèle, réglages) et ses liens entrants, sans l'historique.
  duplicateNode(nodeId) {
    const boardId = get().activeId;
    get().updateBoard(boardId, (b) => {
      const src = b.nodes.find((n) => n.id === nodeId);
      if (!src) return {};
      const id = uid();
      const data = structuredClone(src.data);
      if ('versions' in data) Object.assign(data, { versions: [], current: -1, tasks: [], error: null });
      const node = {
        ...structuredClone({ type: src.type, style: src.style }),
        id, data, selected: false,
        position: { x: src.position.x + (src.measured?.width || 300) + 40, y: src.position.y },
      };
      const edges = b.edges.filter((e) => e.target === nodeId).map((e) => ({ ...e, id: uid(), target: id, selected: false }));
      return { nodes: [...b.nodes, node], edges: [...b.edges, ...edges] };
    });
  },

  // Met à jour les données d'un nœud, sur n'importe quel board. Renvoie false si le nœud n'existe plus.
  patchNodeData(boardId, nodeId, patch) {
    let found = false;
    get().updateBoard(boardId, (b) => ({
      nodes: b.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        found = true;
        const p = typeof patch === 'function' ? patch(n.data) : patch;
        return { ...n, data: { ...n.data, ...p } };
      }),
    }));
    return found;
  },

  findNode(boardId, nodeId) {
    return get().boards[boardId]?.nodes.find((n) => n.id === nodeId);
  },
}));

// Patch sur le board actif, pour les composants de nœud.
export const patchActive = (nodeId, patch) => {
  const s = useStore.getState();
  return s.patchNodeData(s.activeId, nodeId, patch);
};

// --- Sauvegarde automatique dans IndexedDB ---
const lastSaved = {};
let timer = null;

const clean = (b) => ({
  ...b,
  nodes: b.nodes.map(({ selected, dragging, resizing, ...n }) => n),
  edges: b.edges.map(({ selected, ...e }) => e),
});

export async function flush() {
  clearTimeout(timer);
  const { boards } = useStore.getState();
  for (const [id, b] of Object.entries(boards)) {
    if (lastSaved[id] === b) continue;
    lastSaved[id] = b;
    await saveBoard(clean(b));
    hooks.save?.(clean(b));
  }
}

useStore.subscribe((s, prev) => {
  if (s.boards === prev.boards || !s.ready) return;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.hidden && flush());
  window.addEventListener('pagehide', flush);
}
