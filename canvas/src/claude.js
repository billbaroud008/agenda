import Anthropic from '@anthropic-ai/sdk';
import { getMedia } from './db.js';
import { downloadBlob } from './kie.js';

const SYSTEM = `Tu aides à écrire des prompts pour des modèles de génération d'images et de vidéos (Nano Banana, Seedream, Seedance, Hailuo…).
On te donne le modèle cible, le prompt actuel, les images reliées au nœud (avec leur rôle) et parfois une consigne.
Écris un seul prompt prêt à l'emploi :
- en anglais, sauf si la consigne demande une autre langue ;
- concret : sujet, action, décor, lumière, cadrage et mouvement de caméra, style ;
- quand des images sont fournies, désigne-les par leur rôle ("the man from the first image", "first frame"…) au lieu de les décrire en entier ;
- pour une vidéo, décris le déroulé dans le temps et les mouvements de caméra ;
- respecte l'intention du prompt actuel et la consigne, sans ajouter d'éléments qui les contredisent.
Réponds uniquement avec le prompt, sans guillemets, titre ni commentaire.`;

// Réduit une image en JPEG base64 (côté max 1024 px) pour l'envoyer à Claude.
async function toJpegBase64(blob, max = 1024) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

async function blobOf({ mediaId, url }) {
  const rec = mediaId && (await getMedia(mediaId));
  if (rec) return rec.blob;
  return url ? downloadBlob(url) : null;
}

// Prépare la demande : texte + images réduites en JPEG base64.
// images : [{ mediaId, url, role }]
async function buildRequest({ kind, modelLabel, prompt, instruction, images }) {
  const imgs = [];
  for (const img of images) {
    const blob = await blobOf(img).catch(() => null);
    if (blob?.type.startsWith('image/')) imgs.push({ role: img.role, data: await toJpegBase64(blob) });
  }
  const text = [
    `Type : ${kind === 'video' ? 'vidéo' : 'image'}`,
    `Modèle cible : ${modelLabel}`,
    `Prompt actuel : ${prompt.trim() || '(vide)'}`,
    `Consigne : ${instruction.trim() || 'améliore le prompt'}`,
  ].join('\n');
  return { system: SYSTEM, text, images: imgs };
}

// Via l'API Anthropic (clé API, facturée à l'usage).
async function viaApi(apiKey, { system, text, images }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const content = [];
  for (const img of images) {
    content.push({ type: 'text', text: `${img.role} :` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.data } });
  }
  content.push({ type: 'text', text });

  const response = await client.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude a refusé : ${response.stop_details?.explanation || 'demande non traitée'}`);
  }
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// Via Claude Code installé sur l'ordinateur (abonnement Claude, sans clé API).
async function viaClaudeCode(request) {
  if (!import.meta.env.DEV) throw new Error('Claude Code n’est joignable qu’avec « npm run dev »');
  const r = await fetch('/claude-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Claude Code : erreur ${r.status}`);
  return j.text;
}

// Clé API renseignée → API ; sinon Claude Code (abonnement).
export async function askClaude({ apiKey, ...params }) {
  const request = await buildRequest(params);
  const text = (apiKey ? await viaApi(apiKey, request) : await viaClaudeCode(request)).trim();
  if (!text) throw new Error('Réponse vide');
  return text;
}

// Secours manuel : demande à coller dans le chat claude.ai (images à glisser à la main).
export function copyText({ kind, modelLabel, prompt, instruction, roles }) {
  return [
    SYSTEM,
    roles.length ? `Je joins ${roles.length} image(s), dans cet ordre :\n${roles.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '',
    `Type : ${kind === 'video' ? 'vidéo' : 'image'}`,
    `Modèle cible : ${modelLabel}`,
    `Prompt actuel : ${prompt.trim() || '(vide)'}`,
    `Consigne : ${instruction.trim() || 'améliore le prompt'}`,
  ].filter(Boolean).join('\n\n');
}
