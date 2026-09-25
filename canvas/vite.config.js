import { defineConfig } from 'vite';
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

export default defineConfig({
  base: './',
  plugins: [react(), downloadProxy],
  server: {
    proxy: {
      '/kie-api': { target: 'https://api.kie.ai', changeOrigin: true, rewrite: rewrite(/^\/kie-api/) },
      '/kie-upload': { target: 'https://kieai.redpandaai.co', changeOrigin: true, rewrite: rewrite(/^\/kie-upload/) },
    },
  },
});
