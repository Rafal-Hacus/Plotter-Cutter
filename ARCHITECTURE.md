# Architecture

```
index.html            markup of the side panel and the sheet view
src/app.js            application: state, UI wiring, every mode (to be split further, see below)
src/styles.css        styles (light and dark)
src/lib/pdf.js        pdf.js and pdf-lib, loaded on first use; pdf.js data files served from pdfjs/
src/core/             pure code, no app state, unit tested
  geometry.js         distance transform, contour tracing, simplification (RDP), cell-grid nesting
  fill.js             pen fills (contour-parallel, hatched)
  plt.js              writePlt (Skycut PLT), drag-knife compensation, PLT editing
  svg.js              SVG units, viewBox, ids, path flattening, <use> expansion
  sanitize.js         cleaning of untrusted SVG files
  marks.js            SignCut registration-mark templates
  perf.js             perforated cut lines (cuts with uncut bridges)
  aiops.js            tiling, outpainting (grow), blur, back-projection around the AI models
  matrix.js           2D affine matrices, rounded rectangles, PT (points per mm)
  zip.js              zip writer and reader
  image.js            embedded dpi, EXIF orientation, round-sticker detection
  util.js             small helpers
src/presets.js        the Saved settings panel (talks to the server's /api)
src/winlib.js         the winietki background library panel
src/editor.js         the picture editor (fit / rotate / stretch / AI fill / AI upscale), used by Print sheets
src/lib/ai.js         the page's side of the AI: hands jobs to the worker, canvas <-> pixels
src/lib/ai.worker.js  runs the models in a background thread: MI-GAN (onnxruntime-web), ESRGAN (TensorFlow.js)
src/lib/namecards.js  winietki from a list of names: one PDF page per name (fonts embedded with fontkit)
server/               Node server, no runtime dependencies
  index.js            routes, security headers, first-run setup, login/logout, saved-settings API, config
  setup.html, login.html
  auth.js             scrypt passwords, signed session cookies, login lockout
  store.js            saved settings in /data/presets.json (atomic writes, validation)
  library.js          background library in /data/backgrounds (+ backgrounds.json), file types sniffed
  static.js           serves dist/
  hash-password.js    makes AUTH_PASSWORD_HASH
Dockerfile            build stage (npm ci + vite build), runtime stage (node + server + dist, non-root)
docker-compose.yml          the stack (pulls the published image; paste into Portainer as is)
compose.build.yaml    override to build the image from the checkout instead
.github/workflows     ci.yml (lint, tests, build, browser tests, compose smoke test), publish.yml (image to ghcr.io)
tests/unit            Vitest, one file per core module
tests/server          Vitest against the running server
tests/e2e             Playwright against the production build, plus golden files
vite.config.js        build; serves pdf.js data, the ONNX runtime WebAssembly and the AI models locally; CSP
```

Units: sheet coordinates are mm, y down, origin top left of the sheet. PLT coordinates are 1/40 mm with the
origin at the bottom-right registration mark (see `writePlt`). Matrices are `[a, b, c, d, e, f]` like SVG.

## Rules

- `src/core` never reads app state, the DOM of the page, or settings fields: everything comes in as arguments.
  That keeps it testable and reusable.
- Anything that changes what goes to the plotter needs a test, and the golden files must only change on purpose.
- Files from users are untrusted: SVG goes through `sanitize` before touching the page; PDFs are opened with
  `pdfSource` (no code evaluation).

## Next steps

`src/app.js` still holds the modes and shares state through module-level variables (`template`, `layout`,
`cards`, `appMode`, …). The plan, one step at a time with the golden and browser tests green after each:

1. Move the shared state into `src/state.js` (one object) and settings reading (`readOpts`) into `src/settings.js`.
2. Move each mode into `src/modes/` (stickers, cards and CardXtra, guillotine and deck, print sheets, vinyl and
   pen, squares, SVG to PLT, PLT modifier, duplex test), each with `compute`, `renderPreview`, `renderStats` and
   its exports, registered in one mode table instead of the `if (appMode === …)` chains.
3. Move the export builders (cut SVG, cut PDF, print PDF) into `src/export/`, taking layouts as arguments.
4. Import pdf.js and pdf-lib directly where used instead of through `window`.
5. Run tracing and nesting in a Web Worker so big sheets don't freeze the page.
