// Client KIE.ai : envoi de tâche, suivi, upload de fichiers, crédits.
const DEV = import.meta.env.DEV;
const API = DEV ? '/kie-api' : 'https://api.kie.ai';
const UPLOAD = DEV ? '/kie-upload' : 'https://kieai.redpandaai.co';

async function call(apiKey, url, { method = 'GET', body } = {}) {
  if (!apiKey) throw new Error('Clé API KIE manquante (⚙ Réglages)');
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, {
    method,
    headers,
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || (j.code !== 200 && j.success !== true)) {
    console.warn('KIE', url, body, j);
    throw new Error(`${j?.code ?? r.status} ${j?.msg || 'erreur'}`);
  }
  return j.data;
}

export async function createTask(apiKey, model, input) {
  const d = await call(apiKey, `${API}/api/v1/jobs/createTask`, { method: 'POST', body: { model, input } });
  return d.taskId;
}

// Renvoie { state: waiting|queuing|generating|success|fail, urls, error }
export async function getTask(apiKey, taskId) {
  const d = await call(apiKey, `${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  let urls = [];
  try {
    const res = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson || '{}') : d.resultJson || {};
    urls = res.resultUrls || res.resultUrl || [];
    if (typeof urls === 'string') urls = [urls];
  } catch { /* résultat illisible */ }
  const error = [d.failCode, d.failMsg].filter(Boolean).join(' – ');
  return { state: d.state, urls, error };
}

export const getCredits = (apiKey) => call(apiKey, `${API}/api/v1/chat/credit`);

// Upload d'un média local pour obtenir une URL publique (valable quelques jours chez KIE).
export async function uploadBlob(apiKey, blob, fileName) {
  const fd = new FormData();
  fd.append('file', blob, fileName);
  fd.append('uploadPath', 'ia-canvas');
  fd.append('fileName', fileName);
  const d = await call(apiKey, `${UPLOAD}/api/file-stream-upload`, { method: 'POST', body: fd });
  const url = d.downloadUrl || d.fileUrl || d.url;
  if (!url) throw new Error("Upload : pas d'URL renvoyée");
  return url;
}

// Les URL de résultat expirent : on télécharge tout de suite.
export async function downloadBlob(url) {
  try {
    const r = await fetch(url);
    if (r.ok) return await r.blob();
  } catch { /* CORS : on tente le proxy local */ }
  if (DEV) {
    const r = await fetch(`/kie-dl?url=${encodeURIComponent(url)}`);
    if (r.ok) return await r.blob();
  }
  throw new Error('Téléchargement du résultat impossible');
}
