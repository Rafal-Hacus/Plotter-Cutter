import { defineConfig } from 'vite';
import { cpSync, existsSync, createReadStream } from 'node:fs';
import { resolve, join, normalize } from 'node:path';

// Files served next to the app, so nothing is fetched from another site:
//   pdfjs/  pdf.js standard fonts, CJK character maps, image decoders, colour profiles
//   ort/    the ONNX runtime's WebAssembly (runs the MI-GAN fill model)
//   models/ the AI models: MI-GAN (fill, Picsart, MIT) and ESRGAN thick x2/x4 (upscale, UpscalerJS, MIT)
const NM = resolve('node_modules');
const ASSETS = [
  ...['cmaps', 'standard_fonts', 'wasm', 'iccs'].map(d => ['pdfjs/' + d, 'pdfjs-dist/' + d]),
  ['ort/ort-wasm-simd-threaded.asyncify.wasm', 'onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm'],
  ['ort/ort-wasm-simd-threaded.asyncify.mjs', 'onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs'],
  ['models/migan.onnx', 'migan-onnx/models/migan_pipeline_v2.onnx'],
  ['models/esrgan-thick/x2', '@upscalerjs/esrgan-thick/models/x2'],
  ['models/esrgan-thick/x4', '@upscalerjs/esrgan-thick/models/x4']
];
const TYPES = { '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream' };
function localAssets() {
  return {
    name: 'local-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        for (const [to, from] of ASSETS) {
          if (url !== to && !url.startsWith(to + '/')) continue;
          const file = normalize(join(NM, from, url.slice(to.length)));
          if (!file.startsWith(join(NM, from)) || !existsSync(file)) return next();
          const ext = file.slice(file.lastIndexOf('.'));
          if (TYPES[ext]) res.setHeader('Content-Type', TYPES[ext]);
          return createReadStream(file).pipe(res);
        }
        next();
      });
    },
    writeBundle(options) {
      for (const [to, from] of ASSETS) cpSync(join(NM, from), join(options.dir, to), { recursive: true });
    }
  };
}

// The production page only runs its own scripts and loads nothing from elsewhere.
// (Inline styles are allowed: the sheet previews are SVG built with style attributes.)
const CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
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

// Cross-origin isolation: lets the AI use all processor cores (WebAssembly threads need it). The app loads nothing
// from other sites, so it costs nothing. The production server sends the same headers (server/index.js).
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  base: './',
  // the AI worker loads its libraries on demand, which needs a module worker
  worker: { format: 'es' },
  preview: { headers: ISOLATION },
  server: { headers: ISOLATION, ...(backend ? { proxy: Object.fromEntries(['/api', '/login', '/logout'].map(p => [p, { target: backend, changeOrigin: false }])) } : {}) },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2500 },
  plugins: [localAssets(), csp()],
  test: { include: ['tests/unit/**/*.test.js', 'tests/server/**/*.test.js'] }
});
