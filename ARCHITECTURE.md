# Architecture

```
index.html            markup of the side panel and the sheet view
src/main.js           entry point: loads every mode, wires what they share (template, option fields, drop), starts the app
src/state.js          the one object the modes share (open mode, template, layouts, preview viewport) and the designs
src/dom.js            shared page elements, the message line, saving a file
src/settings.js       the option fields: readOpts, storing them in the browser
src/pipeline.js       schedule / run: recompute the open mode's layout and redraw; renderPreview / renderStats
src/mode-switch.js    switching modes: which panels each mode shows (tables), legend, drop hint
src/option-rows.js    rows of the panel that depend on other fields' values
src/template.js       the sheet template: registration marks, sheet size, the grid of where things may go
src/nest.js           nesting designs on the grid; the matrix that places a nested design
src/viewport.js       zoom and pan on the preview
src/plt-modifier.js   the PLT modifier panel
src/modes/            one module (or folder) per mode; each registers itself in the mode table
  registry.js         the mode table: registerMode, currentMode
  stickers/           design.js (read + trace a design), index.js (the mode, adding files), rows.js (the design list),
                      render.js (preview, notes), export.js (SVG / PDF / PLT), batch.js (print PDFs, batches)
  cards/              the card modes (business cards, vouchers, winietki, guillotine, card deck, Morgana CardXtra):
                      job.js (the PDF jobs, sheets, fixed data), load.js, images.js (cards from pictures),
                      layout.js (grid, back side, cuts, plans), render.js, pdf.js, winietki.js, index.js (mode, exports)
  vinyl.js            vinyl and pen
  gang.js             print sheets
  squares.js, svgplt.js, duplex.js
src/export/           writing files, shared by the modes
  files.js            PLTs for sheets with registration marks
  cut-files.js        the cut SVG and the layered cut PDF for SignCut
  pdf-draw.js         drawing on print PDF pages: clipped placement, marks, crop marks, colours
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
  grid.js             straight cuts through a grid of equal pieces, and the order they are cut in
  util.js             small helpers
src/presets.js        the Saved settings panel (talks to the server's /api)
src/winlib.js         the winietki background library panel
src/editor.js         the picture editor (fit / rotate / stretch / AI fill / AI upscale), used by Print sheets, the card modes, the winietki background
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

## How a mode plugs in

A mode calls `registerMode(name, { compute, renderPreview, renderStats, onDrop })` (see `modes/registry.js`).
`run()` in `pipeline.js` calls `compute(options, stale)` of the open mode, then redraws; a `compute` that waits
(tracing, nesting, reading PDFs) checks `stale()` after each wait and returns `false` when a newer run took over.
What several modes need lives outside them: the template, nesting, the export helpers. Modules import each other
freely, including in circles, so nothing may *use* another module's `const` while the modules are still loading:
what is shared at load time is either a function declaration or lives in a module that imports nothing from the
modes (`state.js`, `dom.js`, `settings.js`, `modes/registry.js`, `src/core`).

## Next steps

1. Each mode module still wires its buttons when it is imported; an `init()` per mode, called from `main.js`,
   would make the load order explicit.
2. The card modes read `state.mode` in many places (`gridCut`, `perfDie`, `pageDims`, …); a per-mode description
   object in `cards/job.js` would replace those checks.
3. Import pdf.js and pdf-lib directly where used instead of through `window`.
4. Run tracing and nesting in a Web Worker so big sheets don't freeze the page.
