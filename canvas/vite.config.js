import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';

// En dev, les appels KIE passent par ce serveur local : évite les soucis CORS.
const rewrite = (prefix) => (p) => p.replace(prefix, '');

const downloadProxy = {
  name: 'kie-download-proxy',
  configureServer(server) {
    server.middlewares.use('/kie-dl', async (req, res) => {
      const url = new URL(req.url, 'http://local').searchParams.get('url');
      if (!url || !/^https:\/\//.test(url)) {
        res.statusCode = 400;
        return res.end('url invalide');
      }
      try {
        const r = await fetch(url);
        res.statusCode = r.status;
        res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        res.statusCode = 502;
        res.end(String(e));
      }
    });
  },
};

// Claude Code local : l'assistant ✨ passe par l'abonnement Claude, sans clé API.
const claudeBin = () => {
  const local = join(homedir(), '.local/bin/claude');
  return existsSync(local) ? local : 'claude';
};

function runClaude(args, cwd, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin(), args, { cwd, env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude Code ne répond pas (délai dépassé)')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Claude Code introuvable : installe-le et lance « claude » une fois pour te connecter')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || out.trim() || `Claude Code a échoué (code ${code})`));
    });
  });
}

const readJson = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
});

const claudeLocal = {
  name: 'claude-local',
  configureServer(server) {
    server.middlewares.use('/claude-local', async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') {
        const ok = await runClaude(['--version'], homedir(), 15000).then(() => true, () => false);
        return res.end(JSON.stringify({ available: ok }));
      }
      let dir;
      try {
        // { system, text, images: [{ role, data (JPEG base64) }] }
        const { system, text, images = [] } = await readJson(req);
        dir = await mkdtemp(join(tmpdir(), 'ia-canvas-'));
        const lines = [];
        for (const [i, img] of images.entries()) {
          const name = `image-${i + 1}.jpg`;
          await writeFile(join(dir, name), Buffer.from(img.data, 'base64'));
          lines.push(`- ${name} : ${img.role}`);
        }
        const prompt = [
          system,
          lines.length ? `Images (lis-les avec l'outil Read avant de répondre) :\n${lines.join('\n')}` : '',
          text,
        ].filter(Boolean).join('\n\n');
        const out = await runClaude(['-p', prompt, '--output-format', 'json', '--allowedTools', 'Read'], dir);
        const result = JSON.parse(out);
        if (result.is_error) throw new Error(result.result || 'Erreur Claude Code');
        res.end(JSON.stringify({ text: String(result.result || '').trim() }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        if (dir) rm(dir, { recursive: true, force: true });
      }
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), downloadProxy, claudeLocal],
  server: {
    proxy: {
      '/kie-api': { target: 'https://api.kie.ai', changeOrigin: true, rewrite: rewrite(/^\/kie-api/) },
      '/kie-upload': { target: 'https://kieai.redpandaai.co', changeOrigin: true, rewrite: rewrite(/^\/kie-upload/) },
    },
  },
});
