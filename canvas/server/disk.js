// Accès au disque pour le serveur de dev :
// - lecture des images générées par Claude (un sous-dossier = un board),
// - sauvegarde des boards du canvas dans <racine>/canvas/<board>/.
import { readFile, writeFile, readdir, stat, mkdir, rename, access } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { homedir } from 'node:os';

const CONFIG = join(homedir(), '.ia-canvas.json');
const DEFAULT_ROOT = join(homedir(), 'Documents', 'CLAUDE DOC');
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.json': 'application/json' };

let root = (() => {
  try { return JSON.parse(readFileSync(CONFIG, 'utf8')).root || DEFAULT_ROOT; } catch { return DEFAULT_ROOT; }
})();
const canvasDir = () => join(root, 'canvas');

// Refuse tout chemin qui sortirait de la racine.
function inside(base, ...parts) {
  const p = resolve(base, ...parts);
  if (p !== base && !p.startsWith(base + sep)) throw new Error('Chemin interdit');
  return p;
}

const exists = (p) => access(p).then(() => true, () => false);
const readJson = async (p) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };

const body = (req) => new Promise((ok, ko) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => ok(Buffer.concat(chunks)));
  req.on('error', ko);
});

const send = (res, status, data) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
};

// Dossiers de Claude : tous les sous-dossiers de la racine sauf « canvas » et ceux en _ ou .
async function claudeFolders() {
  const out = [];
  for (const d of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || d.name === 'canvas' || /^[._]/.test(d.name)) continue;
    const dir = join(root, d.name);
    const files = [];
    for (const f of await readdir(dir).catch(() => [])) {
      if (!IMAGE_EXT.includes(extname(f).toLowerCase())) continue;
      const st = await stat(join(dir, f));
      const meta = await readJson(join(dir, f.replace(/\.[^.]+$/, '.json')));
      files.push({ name: f, mtime: st.mtimeMs, meta });
    }
    out.push({ folder: d.name, files });
  }
  return out;
}

// Boards enregistrés : <racine>/canvas/<dossier>/board.json
async function listBoards() {
  const out = [];
  for (const d of await readdir(canvasDir(), { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || /^[._]/.test(d.name)) continue;
    const b = await readJson(join(canvasDir(), d.name, 'board.json'));
    if (b?.id) out.push({ ...b, folder: d.name });
  }
  return out;
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const [, section, ...rest] = url.pathname.split('/').map(decodeURIComponent);
  try {
    // État et réglage de la racine
    if (section === 'status') {
      if (req.method === 'POST') {
        const { root: r } = JSON.parse((await body(req)).toString());
        root = resolve(r.replace(/^~(?=$|\/)/, homedir()));
        writeFileSync(CONFIG, JSON.stringify({ root }));
      }
      return send(res, 200, { root, exists: existsSync(root) });
    }

    // Images de Claude
    if (section === 'claude') return send(res, 200, await claudeFolders());

    // Lecture d'un fichier sous la racine (images Claude, médias des boards)
    if (section === 'file') {
      const p = inside(root, url.searchParams.get('path') || '');
      res.setHeader('Content-Type', TYPES[extname(p).toLowerCase()] || 'application/octet-stream');
      return res.end(await readFile(p));
    }

    // Boards
    if (section === 'boards') {
      const [folder, kind, file] = rest;
      if (!folder) return send(res, 200, await listBoards());
      const dir = inside(canvasDir(), folder);
      if (req.method === 'PUT' && !kind) {
        await mkdir(join(dir, 'medias'), { recursive: true });
        const tmp = join(dir, 'board.json.tmp');
        await writeFile(tmp, await body(req));
        await rename(tmp, join(dir, 'board.json'));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && !kind) {
        const trash = join(canvasDir(), '_supprimés');
        await mkdir(trash, { recursive: true });
        if (await exists(dir)) await rename(dir, join(trash, `${folder}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`));
        return send(res, 200, { ok: true });
      }
      if (kind === 'medias') {
        await mkdir(join(dir, 'medias'), { recursive: true });
        if (!file) return send(res, 200, await readdir(join(dir, 'medias')));
        const p = inside(join(dir, 'medias'), file);
        if (req.method === 'PUT') {
          if (!(await exists(p))) await writeFile(p, await body(req));
          return send(res, 200, { ok: true });
        }
        res.setHeader('Content-Type', TYPES[extname(p).toLowerCase()] || 'application/octet-stream');
        return res.end(await readFile(p));
      }
    }
    send(res, 404, { error: 'introuvable' });
  } catch (e) {
    send(res, e.code === 'ENOENT' ? 404 : 500, { error: e.message });
  }
}

export const diskPlugin = {
  name: 'ia-canvas-disk',
  configureServer(server) {
    server.middlewares.use('/disk', handle);
  },
};
