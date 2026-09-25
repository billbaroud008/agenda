import { openDB } from 'idb';

const dbp = openDB('ia-canvas', 1, {
  upgrade(db) {
    db.createObjectStore('boards', { keyPath: 'id' });
    db.createObjectStore('media');
    db.createObjectStore('settings');
  },
});

export const uid = () => crypto.randomUUID();

export const listBoards = async () => (await dbp).getAll('boards');
export const saveBoard = async (b) => (await dbp).put('boards', b);
export const deleteBoardDb = async (id) => (await dbp).delete('boards', id);

export const getSetting = async (k) => (await dbp).get('settings', k);
export const setSetting = async (k, v) => (await dbp).put('settings', v, k);

// Média = { blob, type, createdAt, remoteUrl?, uploadedUrl?, uploadedAt? }
export async function putMedia(blob, meta = {}, id = uid()) {
  await (await dbp).put('media', { blob, type: blob.type, createdAt: Date.now(), ...meta }, id);
  return id;
}
export const getMedia = async (id) => (await dbp).get('media', id);
export async function updateMedia(id, patch) {
  const db = await dbp;
  const rec = await db.get('media', id);
  if (rec) await db.put('media', { ...rec, ...patch }, id);
}
export const hasMedia = async (id) => !!(await (await dbp).getKey('media', id));

export function mediaIdsOf(board) {
  const ids = new Set();
  for (const n of board.nodes || []) {
    if (n.data?.mediaId) ids.add(n.data.mediaId);
    for (const v of n.data?.versions || []) if (v.mediaId) ids.add(v.mediaId);
  }
  return ids;
}

// Supprime les médias qui ne sont plus utilisés par aucun board.
export async function gcMedia(boards) {
  const used = new Set();
  for (const b of boards) for (const id of mediaIdsOf(b)) used.add(id);
  const db = await dbp;
  const keys = await db.getAllKeys('media');
  for (const k of keys) if (!used.has(k)) await db.delete('media', k);
}
