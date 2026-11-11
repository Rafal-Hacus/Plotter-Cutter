import { defineConfig } from 'vite';
import { cpSync, existsSync, createReadStream } from 'node:fs';
import { resolve, join, normalize } from 'node:path';

// pdf.js data files (standard fonts, CJK character maps, image decoders, colour profiles), served next to the app
// under pdfjs/ so nothing is fetched from another site.
const PDFJS = resolve('node_modules/pdfjs-dist');
const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
function pdfjsAssets() {
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[/\\]+/, '');
        const file = join(PDFJS, rel);
        if (!PDFJS_DIRS.includes(rel.split(/[/\\]/)[0]) || !file.startsWith(PDFJS) || !existsSync(file)) return next();
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      for (const d of PDFJS_DIRS) cpSync(join(PDFJS, d), join(options.dir, 'pdfjs', d), { recursive: true });
    }
  };
}

// The production page only runs its own scripts and loads nothing from elsewhere.
// (Inline styles are allowed: the sheet previews are SVG built with style attributes.)
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
  "img-src 'self' data: blob:", "connect-src 'self' data: blob:", "worker-src 'self' blob:",
  "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"
].join('; ');
function csp() {
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: html => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`)
  };
}

// npm run dev with the server running too (npm start): PC_SERVER=http://localhost:8080 npm run dev
const backend = process.env.PC_SERVER;

export default defineConfig({
  base: './',
  server: backend ? { proxy: Object.fromEntries(['/api', '/login', '/logout'].map(p => [p, { target: backend, changeOrigin: false }])) } : {},
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2500 },
  plugins: [pdfjsAssets(), csp()],
  test: { include: ['tests/unit/**/*.test.js', 'tests/server/**/*.test.js'] }
});
