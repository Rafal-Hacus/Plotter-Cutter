import { CELL } from '../../core/geometry.js';
import { PT } from '../../core/matrix.js';
import { num } from '../../core/svg.js';
import { setCardMsg } from '../../dom.js';
import { ensureLibs, pdfSource } from '../../lib/pdf.js';
import { schedule } from '../../pipeline.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';
import { imagesToCardPdf, isImageFile, isPdfFile, readCardImage, syncImgRows } from './images.js';
import { G_PAGE, KIND, pageScale } from './job.js';
import { morganaLayout } from './layout.js';

export async function loadCardFile(input) {
  const list = Array.from(input && input.length != null ? input : input ? [input] : []);
  const pdfF = list.find(isPdfFile), imgs = list.filter(isImageFile);
  if (!pdfF && imgs.length) {
    setCardMsg('Reading the image…');
    try {
      const max = state.mode === 'deck' || state.mode === 'guillotine' ? 400 : 2;
      state.job.imgSrc = { imgs: [], name: imgs[0].name.replace(/\.[^.]+$/, '') };
      for (const f of imgs.slice(0, max)) state.job.imgSrc.imgs.push(await readCardImage(f));
      syncImgRows();
      const r = await imagesToCardPdf(state.job.imgSrc); await loadCardPdf(r.bytes, state.job.imgSrc.name, r.bleed);
    } catch (e) { state.job.imgSrc = null; syncImgRows(); setCardMsg(`Couldn’t use the image: ${e.message || e}`, true); }
    return;
  }
  if (!pdfF) { setCardMsg('Load a PDF or an image file.', true); return; }
  state.job.imgSrc = null; syncImgRows();
  setCardMsg('Reading the PDF…');
  try { await loadCardPdf(new Uint8Array(await pdfF.arrayBuffer()), pdfF.name, null); }
  catch (e) { setCardMsg(`Couldn’t read the PDF: ${e.message || e}`, true); }
}
// imgBleed: the bleed of a page built from images (exact, also when it is 0); null for a loaded PDF
export async function loadCardPdf(bytes, fileName, imgBleed) {
  const fromImages = imgBleed != null;
  {
    await ensureLibs();
    const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
    const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const p0 = lib.getPage(0), mb = p0.getMediaBox(), tb = p0.getTrimBox();
    state.job.pageW = mb.width / PT; state.job.pageH = mb.height / PT; state.job.mbx = mb.x; state.job.mby = mb.y;
    state.job.bleed = null;
    if (fromImages) { state.job.bleed = Math.round(imgBleed * 1000) / 1000; document.getElementById('cBleed').value = state.job.bleed; }
    else if (tb.width < mb.width - 0.5 && tb.height < mb.height - 0.5) {
      state.job.bleed = Math.round((mb.width - tb.width) / 2 / PT * 100) / 100;
      document.getElementById('cBleed').value = state.job.bleed;
    }
    if (state.job.bleed == null && state.mode === 'deck') { // no trim box: recognise a standard format plus bleed
      const fmts = [[105, 148], [148, 210], [210, 297], [99, 210], [100, 150], [90, 50], [85, 55], [90, 55]];
      for (const [a, b] of fmts) for (const [fw, fh] of [[a, b], [b, a]]) {
        const bw = (state.job.pageW - fw) / 2, bh = (state.job.pageH - fh) / 2;
        if (state.job.bleed == null && bw >= 0 && bw <= 6 && Math.abs(bw - bh) < 0.3) { state.job.bleed = Math.round((bw + bh) / 2 * 10) / 10; document.getElementById('cBleed').value = state.job.bleed; }
      }
    }
    state.job.pages = state.mode === 'deck' || state.mode === 'guillotine' ? pdf.numPages : Math.min(pdf.numPages, 2);
    state.job.previews = [];
    for (let i = 1; i <= state.job.pages; i++) {
      const pg = await pdf.getPage(i), vp = pg.getViewport({ scale: (state.mode === 'deck' || state.job.pages > 2 ? 5 : 12) / PT }); // px per mm
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      state.job.previews.push(cv.toDataURL('image/jpeg', 0.88));
    }
    state.job.name = fileName; state.job.bytes = bytes;
    if (state.mode === 'morgana') { // pick the CardXtra cut size that matches the PDF
      const b = parseFloat(document.getElementById('cBleed').value) || 0;
      const a = Math.max(state.job.pageW, state.job.pageH) - 2 * b, c = Math.min(state.job.pageW, state.job.pageH) - 2 * b;
      const hit = [['90x55', 90, 55], ['90x50', 90, 50], ['85x55', 85, 55]].find(([, W, H]) => Math.abs(a - W) < 0.6 && Math.abs(c - H) < 0.6);
      if (hit) document.getElementById('mSize').value = hit[0];
    }
    updateCardInfo();
    if (fromImages) setCardMsg('');
    schedule();
  }
}
export function updateCardInfo() {
  const el = document.getElementById('cardInfo');
  if (!state.job.bytes) { el.textContent = KIND[state.mode].hint; return; }
  const o = readOpts(), b = o.cBleed, tw = state.job.pageW - 2 * b, th = state.job.pageH - 2 * b, sc = pageScale(o);
  el.textContent = `${state.job.name}: ${num(Math.round(tw * 10) / 10)} × ${num(Math.round(th * 10) / 10)} mm ${KIND[state.mode].one} + ${num(b)} mm bleed${state.job.bleed == null ? ' (from the setting, the PDF has no trim box)' : ''}, ${state.job.pages > 1 ? 'two-sided' : 'single-sided'}.${Math.abs(sc - 1) > 0.001 ? ` Printed at ${num(Math.round(sc * 1000) / 10)}%: ${num(Math.round(tw * sc * 10) / 10)} × ${num(Math.round(th * sc * 10) / 10)} mm.` : ''}`;
}
// Grid of cards inside the free area. T maps card-page mm (y down, origin at the bleed corner) to sheet mm.
export function computeCardLayout(sheet, o) {
  if (!state.job.bytes) return null;
  if (state.mode === 'morgana') return morganaLayout(o);
  const guil = state.mode === 'guillotine' || state.mode === 'gang' || state.mode === 'deck', sc = pageScale(o), pw = state.job.pageW * sc, ph = state.job.pageH * sc;
  const b = o.cBleed * sc, tw = pw - 2 * b, th = ph - 2 * b;
  // auto: the gap is the two bleeds (after scaling), so the space between the cuts is fully printed; if a narrower
  // gap (not under 3 mm, still two cuts) fits more copies, the widest such gap is used and the inner bleed trimmed to half of it
  let gap = guil ? (o.gAuto ? 2 * b : o.gGap) : o.cGap;
  let X0, Y0, W, H, e;
  if (guil) {
    // trim + bleed must sit inside the printable sheet; crop marks use whatever room is left
    const ins = o.gMargin + b;
    X0 = ins; Y0 = ins; W = G_PAGE.wMm - 2 * ins; H = G_PAGE.hMm - 2 * ins; e = 0;
    if (o.gAuto && tw > 0 && th > 0) {
      const count = g => Math.max(...[[tw, th], [th, tw]].map(([cw, ch]) => Math.max(0, Math.floor((W + g) / (cw + g))) * Math.max(0, Math.floor((H + g) / (ch + g)))));
      let bestG = gap, bestN = count(gap);
      for (let g = gap - 0.5; g >= Math.min(3, gap) - 1e-9; g -= 0.5) { const nn = count(g); if (nn > bestN) { bestN = nn; bestG = g; } }
      gap = bestG;
    }
  } else {
    if (!sheet || !sheet.free) return null;
    const f = sheet.free;
    X0 = f.x0 * CELL; Y0 = f.y0 * CELL; W = (f.x1 - f.x0 + 1) * CELL; H = (f.y1 - f.y0 + 1) * CELL; e = Math.min(b, gap / 2);
  }
  const inner = Math.min(b, gap / 2), outer = guil ? b : inner;
  const base = { n: 0, items: [], b, tw, th, e, gap, guil, pw, ph, sc };
  if (tw <= 0 || th <= 0 || W <= 0 || H <= 0) return base;
  let best = null;
  for (const rot of [0, 90]) {
    const cw = rot ? th : tw, ch = rot ? tw : th;
    const cols = Math.floor((W - 2 * e + gap) / (cw + gap)), rows = Math.floor((H - 2 * e + gap) / (ch + gap));
    if (cols < 1 || rows < 1) continue;
    if (!best || cols * rows > best.cols * best.rows) best = { rot, cols, rows, cw, ch };
  }
  if (!best) return base;
  const totW = best.cols * best.cw + (best.cols - 1) * gap, totH = best.rows * best.ch + (best.rows - 1) * gap;
  const sx = X0 + (W - totW) / 2, sy = Y0 + (H - totH) / 2, items = [];
  for (let r = 0; r < best.rows; r++) for (let c = 0; c < best.cols; c++) {
    const tx = sx + c * (best.cw + gap), ty = sy + r * (best.ch + gap);
    const l = c === 0 ? outer : inner, rr = c === best.cols - 1 ? outer : inner, t = r === 0 ? outer : inner, bt = r === best.rows - 1 ? outer : inner;
    items.push({
      T: best.rot ? [0, 1, -1, 0, ph + tx - b, ty - b] : [1, 0, 0, 1, tx - b, ty - b],
      trim: [tx, ty, best.cw, best.ch],
      clip: [tx - l, ty - t, best.cw + l + rr, best.ch + t + bt]
    });
  }
  // guillotine: every distinct cut position, measured from the sheet's left and top edges
  const cutsX = [], cutsY = [], addCut = (arr, v) => { if (!arr.some(q => Math.abs(q - v) < 0.01)) arr.push(v); };
  for (let c = 0; c < best.cols; c++) { addCut(cutsX, sx + c * (best.cw + gap)); addCut(cutsX, sx + c * (best.cw + gap) + best.cw); }
  for (let r = 0; r < best.rows; r++) { addCut(cutsY, sy + r * (best.ch + gap)); addCut(cutsY, sy + r * (best.ch + gap) + best.ch); }
  cutsX.sort((a, q) => a - q); cutsY.sort((a, q) => a - q);
  return { ...best, ...base, n: items.length, items, sx, sy, totW, totH, cutsX, cutsY, fx0: X0, fy0: Y0, fx1: X0 + W, fy1: Y0 + H };
}
