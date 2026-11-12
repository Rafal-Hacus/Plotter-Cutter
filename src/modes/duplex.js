import { PT } from '../core/matrix.js';
import { num } from '../core/svg.js';
import { setCardMsg, ui } from '../dom.js';
import { saveFile } from '../export/files.js';
import { ensureLibs } from '../lib/pdf.js';
import { schedule } from '../pipeline.js';
import { state } from '../state.js';
import { applyView } from '../viewport.js';
import { syncImgRows } from './cards/images.js';
import { syncPerf } from './cards/index.js';
import { syncPerfDie } from './cards/render.js';
import { syncWinRows } from './cards/winietki.js';
import { registerMode } from './registry.js';

/* ---------- duplex test: two pages with frames and PAGE 1 / PAGE 2 ---------- */
function duplexSize() {
  const sel = document.getElementById('dxSize').value;
  if (sel === 'custom') {
    const w = parseFloat(document.getElementById('dxW').value), h = parseFloat(document.getElementById('dxH').value);
    return [isFinite(w) && w >= 50 ? w : 210, isFinite(h) && h >= 50 ? h : 297];
  }
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(sel);
  return m ? [+m[1], +m[2]] : [210, 297];
}
const DX_FRAMES = [5, 10];
 // frame insets, mm
function renderDuplexPreview() {
  const [W, H] = duplexSize(), n = document.getElementById('showBack').checked ? 2 : 1, fs = Math.min(W, H) * 0.12;
  state.previewFrame = { x: -8, y: -8, w: W + 16, h: H + 16 };
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${state.previewFrame.x} ${state.previewFrame.y} ${state.previewFrame.w} ${state.previewFrame.h}" role="img" aria-label="Duplex test page ${n}"><rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="#fff"/>`];
  for (const i of DX_FRAMES) p.push(`<rect x="${i}" y="${i}" width="${num(W - 2 * i)}" height="${num(H - 2 * i)}" fill="none" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
  p.push(`<path d="M${num(W / 2)} 10V${num(H - 10)}M10 ${num(H / 2)}H${num(W - 10)}" stroke="#000" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`);
  p.push(`<text x="${num(W / 2)}" y="${num(H / 2 - fs * 0.25)}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${num(fs)}" text-anchor="middle">PAGE ${n}</text>`);
  p.push(`<text x="${num(W / 2)}" y="16" font-family="Helvetica, Arial, sans-serif" font-size="4" text-anchor="middle">TOP</text></svg>`);
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderDuplexStats() {
  const [W, H] = duplexSize();
  ui.dropNote.hidden = true;
  ui.count.textContent = `Duplex test, ${num(W)} × ${num(H)} mm`;
  setCardMsg('Two pages with the same frames (5 and 10 mm from the edge), a centre cross, PAGE 1 / PAGE 2 and TOP. Print double-sided and hold the sheet against the light: where the back’s frames sit relative to the front’s is the offset to correct (Back shift). Back side shows page 2.');
}
async function buildDuplexPdf() {
  await ensureLibs();
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const [W, H] = duplexSize(), Wpt = W * PT, Hpt = H * PT, black = rgb(0, 0, 0);
  const out = await PDFDocument.create(), bold = await out.embedFont(StandardFonts.HelveticaBold), font = await out.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) {
    const page = out.addPage([Wpt, Hpt]);
    for (const i of DX_FRAMES) page.drawRectangle({ x: i * PT, y: i * PT, width: (W - 2 * i) * PT, height: (H - 2 * i) * PT, borderColor: black, borderWidth: 0.5 });
    page.drawLine({ start: { x: Wpt / 2, y: 10 * PT }, end: { x: Wpt / 2, y: Hpt - 10 * PT }, thickness: 0.3, color: black });
    page.drawLine({ start: { x: 10 * PT, y: Hpt / 2 }, end: { x: Wpt - 10 * PT, y: Hpt / 2 }, thickness: 0.3, color: black });
    const label = `PAGE ${n}`, size = Math.min(W, H) * 0.12 * PT, lw = bold.widthOfTextAtSize(label, size);
    page.drawText(label, { x: (Wpt - lw) / 2, y: Hpt / 2 + size * 0.25, size, font: bold, color: black });
    const top = 'TOP', tw = font.widthOfTextAtSize(top, 11);
    page.drawText(top, { x: (Wpt - tw) / 2, y: Hpt - 16 * PT, size: 11, font, color: black });
  }
  out.setTitle(`Duplex test ${num(W)} x ${num(H)} mm`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
document.getElementById('dxSize').addEventListener('change', () => { document.getElementById('rowDxCustom').hidden = document.getElementById('dxSize').value !== 'custom'; state.view = null; schedule(); });
for (const id of ['dxW', 'dxH']) document.getElementById(id).addEventListener('input', () => { state.view = null; schedule(); });
document.getElementById('exDuplex').addEventListener('click', async () => {
  const [W, H] = duplexSize();
  try { await saveFile(`duplex-test-${num(W)}x${num(H)}.pdf`, await buildDuplexPdf()); }
  catch (e) { setCardMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
});
registerMode('duplex', { renderPreview: renderDuplexPreview, renderStats: renderDuplexStats });
// show or hide the rows that depend on other fields' values
export function syncOptionRows() {
  syncPerf();
  document.getElementById('rowDxCustom').hidden = document.getElementById('dxSize').value !== 'custom';
  document.getElementById('rowGPageCustom').hidden = document.getElementById('gPage').value !== 'custom';
  document.getElementById('rowGGCustom').hidden = document.getElementById('ggFormat').value !== 'custom';
  document.getElementById('rowGGGap').hidden = document.getElementById('ggAuto').checked;
  syncImgRows();
  syncPerfDie();
  syncWinRows();
}
