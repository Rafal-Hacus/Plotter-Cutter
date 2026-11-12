// The stickers mode: adding designs, tracing their outlines and nesting them on the sheet.
import { circleSvg, detectCircle } from '../../core/image.js';
import { isPdfFile, tick } from '../../core/util.js';
import { EMPTY_LIST, setMsg, ui } from '../../dom.js';
import { ensureLibs, pdfSource } from '../../lib/pdf.js';
import { registerMode } from '../registry.js';
import { prepareDesign, processDesign } from './design.js';
import { renderStickerPreview, renderStickerStats } from './render.js';
import { addRow, updateRow } from './rows.js';
import { isMarkless } from '../vinyl.js';
import { nestAll } from '../../nest.js';
import { renderStats, schedule } from '../../pipeline.js';
import { designs, state } from '../../state.js';
import { templateSheet } from '../../template.js';

// Trace every sticker that changed, then nest them on the sheet. Returns false when a newer run took over.
async function computeStickers(o, stale) {
  const sheet = await templateSheet(o);
  if (stale()) return false;
  for (const d of designs) {
    const key = [d.mode, d.heightMm, o.kiss, o.die, o.gap, o.joinGap, o.quality, o.ignoreWhite].join('|');
    if (d.key === key) continue;
    d.busy = true; updateRow(d);
    renderStats(`Tracing ${d.name}…`);
    await tick();
    let res = null, err = null;
    try { res = await processDesign(d, o); }
    catch (e) { err = e.message || String(e); }
    if (stale()) return false;
    d.res = res; d.error = err; d.key = key; d.busy = false;
    updateRow(d);
  }
  const ready = designs.filter(d => d.res && d.qty !== 0);
  renderStats('Arranging stickers…');
  await tick();
  const lay = ready.length ? await nestAll(ready, sheet, o, stale) : null;
  if (stale()) return false;
  state.layout = lay;
  designs.forEach(updateRow);
}
registerMode('stickers', { compute: computeStickers, renderPreview: renderStickerPreview, renderStats: renderStickerStats, onDrop: addFiles });

/* ---------- round stickers from a PDF: the page as artwork, a circle as the kiss cut ---------- */
async function addPdfCircles(file) {
  await ensureLibs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i), vp1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: Math.min(10, 3000 / Math.max(vp1.width, vp1.height)) }); // ~3000 px: 300 dpi up to ~25 cm
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: g, viewport: vp }).promise;
    const det = detectCircle(cv);
    // cut a little inside the detected edge, so no background shows if the cut lands a bit off
    const c = { img: cv.toDataURL('image/jpeg', 0.92), w: vp1.width, h: vp1.height, pdf: bytes, page: i - 1, mbx: pg.view[0], mby: pg.view[1], rot: ((pg.rotate || 0) % 360 + 360) % 360, size: det ? det.size * 0.98 : 0.9, x: det ? det.x : 0, y: det ? det.y : 0, found: !!det };
    cv.width = cv.height = 1;
    const d = prepareDesign(circleSvg(c), pdf.numPages > 1 ? `${file.name} p.${i}` : file.name);
    d.circle = c; d.mode = 'cut'; d.heightMm = 50;
    designs.push(d); addRow(d);
  }
}
// after the circle of a round sticker was moved or resized: the design is made again around the new circle
export function rebuildCircle(d) {
  const keep = { qty: d.qty, heightMm: d.heightMm, ui: d.ui, circle: d.circle };
  Object.assign(d, prepareDesign(circleSvg(d.circle), d.name), keep, { mode: 'cut' });
  // the shapes read for the vinyl and pen modes belong to the old circle
  d.vgeo = d.vres = d.vkey = null;
  updateRow(d); schedule();
}
// SVG files become stickers (or shapes, in the vinyl and pen modes); PDFs become round stickers.
export async function addFiles(fileList) {
  const pdfOk = !isMarkless();
  const files = Array.from(fileList).filter(f => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml' || (pdfOk && isPdfFile(f)));
  if (!files.length) { setMsg(pdfOk ? 'Only SVG and PDF files can be added.' : 'Only SVG files can be added here.', true); return; }
  if (!designs.length) ui.list.innerHTML = '';
  const failed = [];
  for (const f of files) {
    try {
      if (isPdfFile(f)) { setMsg(`Reading ${f.name}…`); await addPdfCircles(f); setMsg(''); continue; }
      const d = prepareDesign(await f.text(), f.name);
      designs.push(d); addRow(d);
    } catch (e) {
      failed.push(`${f.name}: ${e.message}`);
    }
  }
  if (!designs.length) ui.list.innerHTML = EMPTY_LIST;
  // shown with the sheet's own notes until the next files are added
  state.loadError = failed.join(' ');
  schedule();
}
ui.files.addEventListener('change', () => { addFiles(ui.files.files); ui.files.value = ''; });
