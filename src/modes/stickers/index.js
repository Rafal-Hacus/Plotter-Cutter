// The stickers mode: adding designs, tracing their outlines and nesting them on the sheet.
import { circleSvg, detectCircle } from '../../core/image.js';
import { pagePaths } from '../../core/pdfpaths.js';
import { stripCutColour } from '../../core/pdfcutstrip.js';
import { bbox } from '../../core/stamp.js';
import { num } from '../../core/svg.js';
import { isPdfFile, tick } from '../../core/util.js';
import { EMPTY_LIST, setMsg, ui } from '../../dom.js';
import { bladeNote, pdfCheck, pltCheck } from '../../export/check.js';
import { ensureLibs, pdfSource } from '../../lib/pdf.js';
import { itemFiles, matchItems, registerJob, registerMode } from '../registry.js';
import { prepareDesign, processDesign } from './design.js';
import { renderStickerPreview, renderStickerStats } from './render.js';
import { addRow, updateRow } from './rows.js';
import { isMarkless } from '../vinyl.js';
import { nestAll } from '../../nest.js';
import { planSheets } from './plan.js';
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
  // typed copies: how many sheets the order needs, as the batch export plans them
  let plan = null;
  const typed = ready.filter(d => d.qty != null);
  if (lay && typed.length) {
    if (o.batchMix && typed.every(d => (lay.counts.get(d.id) || 0) >= d.qty)) plan = { groups: [{ designs: typed, pieces: typed.reduce((s, d) => s + d.qty, 0), sheets: 1, overs: 0 }] };
    else {
      renderStats('Planning the sheets…');
      try { plan = await planSheets(ready, sheet, o, { cancelled: stale, limit: 5000 }); }
      catch (e) { plan = { error: e.message || String(e) }; }
      if (stale()) return false;
    }
  }
  state.layout = lay; state.plan = plan;
  designs.forEach(updateRow);
}
// what the print PDF and the PLTs will carry
function stickerExportCheck(o) {
  const L = state.layout, t = state.template;
  if (!L || !L.items.length || !t) return null;
  const sheet = [t.wMm, t.hMm];
  return [pdfCheck({ pages: 1, page: sheet, extra: `artwork at 300 dpi, ${L.items.length} stickers` }),
    t.marks ? pltCheck(o, [['kiss', o.kissForce], ['die', o.dieForce]], { sheet, pieces: L.items.length }) : '', t.marks ? bladeNote(o) : ''];
}
registerMode('stickers', { compute: computeStickers, renderPreview: renderStickerPreview, renderStats: renderStickerStats, onDrop: addFiles, exportCheck: stickerExportCheck });

/* ---------- stickers from a PDF: the page as artwork, and the kiss cut one of three ways ---------- */
//   kind 'cut':   the line drawn in the PDF (stroked, not filled: the usual cut line, as for SVGs)
//   kind 'trace': traced around the artwork with the kiss-cut offset, as for SVGs
//   kind 'round': a circle, found on the page or set by hand (round stickers)
// A cut line on a layer of its own (named Cut, CutContour, Kiss, Wykrój, Cięcie …) is left out of the print.
const CUT_LAYER = /cut|kiss|contour|wykr[oó]j|ci[eę]cie|kontur/i;
// the sticker's SVG: the page picture, plus the circle or the PDF's cut lines (in page points, y down)
export function pdfStickerSvg(c) {
  if (c.kind === 'round') return circleSvg(c);
  const lines = c.kind === 'cut' ? c.cutLines.map(r => `<path d="M${r.map(p => `${num(p[0])},${num(p[1])}`).join('L')}Z" fill="none" stroke="#e6007e" stroke-width="${num(Math.min(c.w, c.h) / 400)}"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${num(c.w)} ${num(c.h)}" width="${num(c.w)}pt" height="${num(c.h)}pt">`
    + `<image href="${c.img}" x="0" y="0" width="${num(c.w)}" height="${num(c.h)}" preserveAspectRatio="none"/>${lines}</svg>`;
}
async function addPdfStickers(file) {
  await ensureLibs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise, { OPS } = window.pdfjsLib;
  // a cut line in a spot colour of its own (CutContour …): read from the page as it is, then taken out of the copy
  // that is drawn and printed
  let printBytes = bytes, printPdf = pdf, spotCut = false;
  try {
    const r = await stripCutColour(window.PDFLib, bytes.slice(), CUT_LAYER);
    if (r.removed) { printBytes = r.bytes; spotCut = true; printPdf = await window.pdfjsLib.getDocument(pdfSource(r.bytes.slice())).promise; }
  } catch (e) { console.warn('Could not take the cut colour out of the print:', e); }
  // layers that hold the cut line: hidden in the picture (and the page is then printed from the picture)
  let ocConfig, hidLayer = false;
  try {
    ocConfig = await printPdf.getOptionalContentConfig();
    for (const [id, grp] of ocConfig) if (grp && CUT_LAYER.test(grp.name || '')) { ocConfig.setVisibility(id, false); hidLayer = true; }
  } catch { ocConfig = null; }
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i), vp1 = pg.getViewport({ scale: 1 });
    // the PDF's cut lines: closed, stroked and not filled, longer than a few mm; in the picture's coordinates
    const ol = await pg.getOperatorList();
    const cutLines = [];
    for (const p of pagePaths(ol.fnArray, ol.argsArray, OPS)) {
      if (!p.stroke || p.fill) continue;
      for (const sp of p.subpaths) {
        const a = sp.pts[0], z = sp.pts[sp.pts.length - 1];
        if (!(sp.closed || Math.hypot(a[0] - z[0], a[1] - z[1]) < 0.5) || sp.pts.length < 3) continue;
        const pts = sp.pts.map(([x, y]) => vp1.convertToViewportPoint(x, y));
        const b = bbox([pts]);
        if (b.w > 5 && b.h > 5) cutLines.push(pts); // (points: about 2 mm)
      }
    }
    const ppg = printPdf === pdf ? pg : await printPdf.getPage(i);
    const vp = pg.getViewport({ scale: Math.min(10, 3000 / Math.max(vp1.width, vp1.height)) }); // ~3000 px: 300 dpi up to ~25 cm
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await ppg.render({ canvasContext: g, viewport: vp, ...(ocConfig ? { optionalContentConfigPromise: Promise.resolve(ocConfig) } : {}) }).promise;
    const det = detectCircle(cv);
    // cut a little inside the detected edge, so no background shows if the cut lands a bit off
    const c = {
      img: cv.toDataURL('image/jpeg', 0.92), w: vp1.width, h: vp1.height, pdf: printBytes, page: i - 1, mbx: pg.view[0], mby: pg.view[1],
      rot: ((pg.rotate || 0) % 360 + 360) % 360, size: det ? det.size * 0.98 : 0.9, x: det ? det.x : 0, y: det ? det.y : 0, found: !!det,
      cutLines, kind: cutLines.length ? 'cut' : det ? 'round' : 'trace', hidLayer, spotCut
    };
    cv.width = cv.height = 1;
    const d = prepareDesign(pdfStickerSvg(c), pdf.numPages > 1 ? `${file.name} p.${i}` : file.name);
    d.circle = c; d.mode = c.kind === 'trace' ? 'trace' : 'cut';
    if (c.kind === 'round') d.heightMm = 50;
    // the cut line at its size in the PDF (the page is usually a little bigger: the bleed)
    else if (c.kind === 'cut') d.heightMm = Math.round(bbox(cutLines).h * 25.4 / 72 * 10) / 10;
    designs.push(d); addRow(d);
  }
}
// after the circle was moved or resized, or the kind of kiss cut changed: the design is made again
export function rebuildCircle(d) {
  const keep = { qty: d.qty, heightMm: d.heightMm, ui: d.ui, circle: d.circle };
  Object.assign(d, prepareDesign(pdfStickerSvg(d.circle), d.name), keep, { mode: d.circle.kind === 'trace' ? 'trace' : 'cut' });
  // the shapes read for the vinyl and pen modes belong to the old design
  d.vgeo = d.vres = d.vkey = null;
  updateRow(d); schedule();
}
export async function addFiles(fileList) {
  const pdfOk = !isMarkless();
  const files = Array.from(fileList).filter(f => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml' || (pdfOk && isPdfFile(f)));
  if (!files.length) { setMsg(pdfOk ? 'Only SVG and PDF files can be added.' : 'Only SVG files can be added here.', true); return; }
  if (!designs.length) ui.list.innerHTML = '';
  const failed = [];
  for (const f of files) {
    const before = designs.length;
    try {
      if (isPdfFile(f)) { setMsg(`Reading ${f.name}…`); await addPdfStickers(f); setMsg(''); continue; }
      const d = prepareDesign(await f.text(), f.name);
      // vinyl: a file added starts at one copy (filling the roll cut one logo 34 times over a metre); empty = fill
      if (state.mode === 'vinyl') d.qty = 1;
      designs.push(d); addRow(d);
    } catch (e) {
      failed.push(`${f.name}: ${e.message}`);
    } finally {
      // the file each design came from (its page in a PDF), for the autosave
      designs.slice(before).forEach((d, k) => { d.src = f; d.part = k; });
    }
  }
  if (!designs.length) ui.list.innerHTML = EMPTY_LIST;
  // shown with the sheet's own notes until the next files are added
  state.loadError = failed.join(' ');
  schedule();
}
ui.files.addEventListener('change', () => { addFiles(ui.files.files); ui.files.value = ''; });

/* ---------- the job kept in the browser (see jobstore.js); the vinyl and pen modes share it ---------- */
function clearStickers() {
  designs.length = 0; ui.list.innerHTML = EMPTY_LIST; state.layout = null; state.plan = null; state.vinylLayout = null;
  schedule();
}
registerJob('stickers', {
  modes: ['stickers', 'vinyl', 'pen'], label: 'Stickers',
  serialize() {
    if (!designs.length) return null;
    const { files, at } = itemFiles(designs);
    const items = designs.filter(d => d.src).map(d => ({
      f: at(d), part: d.part, heightMm: d.heightMm, qty: d.qty, mode: d.mode, hEdited: !!d.hEdited, realSized: !!d.realSized,
      circle: d.circle ? { kind: d.circle.kind, size: d.circle.size, x: d.circle.x, y: d.circle.y } : null
    }));
    return { files, state: { items }, count: items.length };
  },
  async restore(saved, files) {
    clearStickers();
    for (const f of files) await addFiles([f]);
    const pairs = matchItems(designs, files, saved.items);
    designs.length = 0;
    for (const [d, s] of pairs) {
      const c = d.circle;
      if (c && s.circle && (c.kind !== s.circle.kind || c.size !== s.circle.size || c.x !== s.circle.x || c.y !== s.circle.y)) {
        Object.assign(c, s.circle);
        Object.assign(d, prepareDesign(pdfStickerSvg(c), d.name), { mode: c.kind === 'trace' ? 'trace' : 'cut' });
      } else if (!c) d.mode = s.mode;
      Object.assign(d, { heightMm: s.heightMm, qty: s.qty, hEdited: s.hEdited, realSized: s.realSized });
      designs.push(d);
    }
    // the rows again, with the saved values in them
    ui.list.innerHTML = designs.length ? '' : EMPTY_LIST;
    for (const d of designs) addRow(d);
    schedule();
  },
  clear: clearStickers
});
