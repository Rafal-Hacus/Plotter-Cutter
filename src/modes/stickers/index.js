import { circleSvg, detectCircle } from '../../core/image.js';
import { ui } from '../../dom.js';
import { ensureLibs, pdfSource } from '../../lib/pdf.js';
import { computeStickers, schedule } from '../../pipeline.js';
import { designs } from '../../state.js';
import { registerMode } from '../registry.js';
import { isMarkless } from '../vinyl.js';
import { prepareDesign } from './design.js';
import { renderStickerPreview, renderStickerStats } from './render.js';
import { addRow, updateRow } from './rows.js';

registerMode('stickers', { compute: computeStickers, renderPreview: renderStickerPreview, renderStats: renderStickerStats, onDrop: files => addFiles(files) });
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
export function rebuildCircle(d) {
  const nd = prepareDesign(circleSvg(d.circle), d.name), keep = { qty: d.qty, heightMm: d.heightMm, ui: d.ui, circle: d.circle };
  for (const k of Object.keys(nd)) d[k] = nd[k];
  Object.assign(d, keep);
  d.mode = 'cut';
  updateRow(d); schedule();
}
export async function addFiles(fileList) {
  const isPdf = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  const files = Array.from(fileList).filter(f => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml' || (isPdf(f) && !isMarkless()));
  if (!files.length) { ui.msg.textContent = isMarkless() ? 'Only SVG files can be added here.' : 'Only SVG and PDF files can be added.'; ui.msg.className = 'msg warn'; return; }
  if (!designs.length) ui.list.innerHTML = '';
  for (const f of files) {
    try {
      if (isPdf(f)) { ui.msg.textContent = `Reading ${f.name}…`; ui.msg.className = 'msg'; await addPdfCircles(f); ui.msg.textContent = ''; continue; }
      const d = prepareDesign(await f.text(), f.name);
      designs.push(d); addRow(d);
    } catch (e) {
      ui.msg.textContent = `${f.name}: ${e.message}`; ui.msg.className = 'msg warn';
    }
  }
  schedule();
}
/* ---------- wiring ---------- */
ui.files.addEventListener('change', () => { addFiles(ui.files.files); ui.files.value = ''; });
