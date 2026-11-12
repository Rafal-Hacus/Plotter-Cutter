// Sticker print PDFs: one sheet, or a batch of as many sheets as the copies need with one pair of PLTs per
// distinct sheet.
import { PT, apply, mul } from '../../core/matrix.js';
import { loadImg, sizedSvg } from '../../core/svg.js';
import { asciiOnly, tick } from '../../core/util.js';
import { makeZip } from '../../core/zip.js';
import { byId, saveFile, setMsg } from '../../dom.js';
import { buildPlt } from '../../export/files.js';
import { drawShapes, printPage } from '../../export/pdf-draw.js';
import { ensureLibs } from '../../lib/pdf.js';
import { buildExport, exportName, stickerLoops, vecCircle } from './export.js';
import { nestAll, placeMatrix } from '../../nest.js';
import { readOpts } from '../../settings.js';
import { designs, state } from '../../state.js';
import { templateShapes, templateSheet } from '../../template.js';

// Split the stickers over as many sheets as needed. Copies = that many; empty copies = one full sheet of that design.
async function planBatch(o) {
  const ready = designs.filter(d => d.res && d.qty !== 0);
  if (!ready.length) throw new Error('Add some stickers first.');
  const sheet = await templateSheet(o), sheets = [];
  const remaining = new Map(ready.filter(d => d.qty != null).map(d => [d, d.qty]));
  // designs without copies fill whatever space the counted ones leave on every sheet
  const fills = ready.filter(d => d.qty == null), fillers = () => fills.map(d => Object.assign(Object.create(d), { qty: null }));
  const groups = o.batchMix ? [[...remaining.keys()]] : [...remaining.keys()].map(d => [d]);
  for (const g of groups) {
    while (g.some(d => remaining.get(d) > 0)) {
      const list = g.filter(d => remaining.get(d) > 0).map(d => Object.assign(Object.create(d), { qty: remaining.get(d) }));
      const lay = await nestAll([...list, ...fillers()], sheet, o, () => false);
      const placed = g.reduce((s, d) => s + ((lay && lay.counts.get(d.id)) || 0), 0);
      if (!lay || !placed) throw new Error(`${list[0].name} doesn’t fit on a sheet.`);
      for (const d of g) remaining.set(d, remaining.get(d) - (lay.counts.get(d.id) || 0));
      sheets.push(lay);
      if (sheets.length > 200) throw new Error('More than 200 sheets; check the copies.');
    }
  }
  // only fill designs (nothing counted): one full sheet each
  if (!remaining.size) for (const d of fills) {
    const lay = await nestAll([Object.assign(Object.create(d), { qty: null })], sheet, o, () => false);
    if (!lay || !lay.items.length) throw new Error(`${d.name} doesn’t fit on a sheet.`);
    sheets.push(lay);
  }
  return sheets;
}
const sheetSummary = lay => {
  const per = new Map();
  for (const it of lay.items) per.set(it.d.name, (per.get(it.d.name) || 0) + 1);
  return [...per].map(([nm, n]) => `${nm} x${n}`).join(', ');
};
// One sheet as a print PDF: artwork at 300 dpi, registration marks as vectors (no xlink, no cut lines).
// Round stickers from a PDF go into the print PDF as the original vector page (no pixels), clipped to
// the same area the raster print uses (die line plus a little bleed). cache: Map shared by the pages of one PDF.
async function drawVectorStickers(page, out, L, Hpt, cache) {
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, moveTo, lineTo, closePath, clip, endPath, drawObject } = window.PDFLib;
  const F = [PT, 0, 0, -PT, 0, Hpt], names = new Map();
  for (const it of L.items) {
    const d = it.d, c = d.circle;
    if (!vecCircle(d) || !d.res) continue;
    const key = d.id;
    if (!cache.has(key)) {
      if (!cache.docs) cache.docs = new Map();
      if (!cache.docs.has(c.pdf)) cache.docs.set(c.pdf, await PDFDocument.load(c.pdf, { ignoreEncryption: true }));
      cache.set(key, (await out.embedPdf(cache.docs.get(c.pdf), [c.page]))[0]);
    }
    const emb = cache.get(key);
    if (!names.has(key)) names.set(key, page.node.newXObject(`V${key}`, emb.ref));
    const P = placeMatrix(it), r = d.res;
    const A = [r.s, 0, 0, r.s, r.offX - r.s * d.vb.x, r.offY - r.s * d.vb.y]; // design units (page pt, y down) -> sticker mm
    const G = [1, 0, 0, -1, -c.mbx, c.mby + c.h];                              // PDF page space (y up) -> design units
    const S = mul(F, P), M = mul(S, mul(A, G));
    const ops = [pushGraphicsState()];
    for (const loop of r.clipLoops) {
      loop.forEach((q, i) => { const [x, y] = apply(S, q); ops.push(i ? lineTo(x, y) : moveTo(x, y)); });
      ops.push(closePath());
    }
    ops.push(clip(), endPath(), concatTransformationMatrix(...M), drawObject(names.get(key)), popGraphicsState());
    page.pushOperators(...ops);
  }
}
// One sheet as a page of `pdf`: the artwork as a picture at `dpi`, round stickers from PDFs and the marks as vectors.
async function renderSheetPage(pdf, t, marks, dpi, L, cache = new Map()) {
  const Wpt = t.wMm * PT, Hpt = t.hMm * PT, wpx = Math.round(t.wMm / 25.4 * dpi), hpx = Math.round(t.hMm / 25.4 * dpi);
  const img = await loadImg(sizedSvg(buildExport('art', L, true), wpx, hpx));
  const cv = document.createElement('canvas'); cv.width = wpx; cv.height = hpx;
  const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, wpx, hpx); cx.drawImage(img, 0, 0, wpx, hpx);
  const jpg = await new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.93));
  cv.width = cv.height = 1;
  const page = printPage(pdf, Wpt, Hpt);
  page.drawImage(await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer())), { x: 0, y: 0, width: Wpt, height: Hpt });
  await drawVectorStickers(page, pdf, L, Hpt, cache);
  drawShapes(page, marks, Hpt);
  return page;
}
async function buildSinglePdf() {
  await ensureLibs();
  const pdf = await window.PDFLib.PDFDocument.create();
  await renderSheetPage(pdf, state.template, templateShapes(), 300, state.layout);
  pdf.setTitle(`Sticker sheet, ${state.layout.items.length} pcs`);
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
byId('exPdf').addEventListener('click', async () => {
  const btn = byId('exPdf'); btn.disabled = true;
  try { await saveFile(exportName('all').replace(/\.svg$/, '-print.pdf'), await buildSinglePdf()); }
  catch (e) { setMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
async function buildBatch() {
  const o = readOpts(), t = state.template;
  setMsg('Planning the sheets…');
  await ensureLibs();
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const sheets = await planBatch(o);
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  const marks = templateShapes(), files = [], date = new Date().toISOString().slice(0, 10), total = sheets.length;
  // identical sheets (same stickers in the same places) share one pair of PLTs: A, B, C…
  const pltOf = new Map(), sheetPlt = [], vcache = new Map();
  const letter = n => (n >= 26 ? letter(Math.floor(n / 26) - 1) : '') + String.fromCharCode(65 + n % 26);
  // label goes left of the start arrow by the bottom-right mark: that corner stays whole after the die cut
  const mk = t.marks, rightMm = mk ? (mk.right - t.vb.x) / t.u : t.wMm - 5.5, bottomMm = mk ? (mk.bottom - t.vb.y) / t.u : t.hMm - 5.5;
  for (let i = 0; i < total; i++) {
    const id = `S${String(i + 1).padStart(2, '0')}`, L = sheets[i];
    setMsg(`Sheet ${i + 1} of ${total}…`);
    await tick();
    const key = L.items.map(it => `${it.d.id}:${it.rot}:${it.X}:${it.Y}`).sort().join('|');
    if (!pltOf.has(key)) {
      const name = letter(pltOf.size);
      pltOf.set(key, name);
      files.push({ name: `${name}-kiss.plt`, text: buildPlt(stickerLoops(L, 'kissLoops'), o.kissForce) });
      files.push({ name: `${name}-die.plt`, text: buildPlt(stickerLoops(L, 'dieLoops'), o.dieForce) });
    }
    const plt = pltOf.get(key);
    sheetPlt.push(plt);
    // print: artwork rendered at 300 dpi, marks and the label as vectors on top
    const page = await renderSheetPage(pdf, t, marks, 300, L, vcache);
    const label = asciiOnly(`${id}/${String(total).padStart(2, '0')}  PLT ${plt}  ${date}`), size = 7;
    const lw = font.widthOfTextAtSize(label, size);
    page.drawText(label, { x: (rightMm - 23.5) * PT - lw, y: (t.hMm - bottomMm - 0.5) * PT, size, font, color: rgb(0, 0, 0) });
  }
  pdf.setTitle(`Sticker batch ${date}, ${total} sheets`);
  const summary = sheets.map((l, i) => `S${String(i + 1).padStart(2, '0')} (PLT ${sheetPlt[i]}): ${sheetSummary(l)}`).join('\n');
  files.unshift({ name: 'batch-print.pdf', bytes: await pdf.save() }, { name: 'batch-sheets.txt', text: summary + '\n' });
  return { zip: makeZip(files), total, summary };
}
byId('exBatch').addEventListener('click', async () => {
  const btn = byId('exBatch');
  btn.disabled = true;
  try {
    const r = await buildBatch();
    await saveFile(`sticker-batch-${r.total}sheets.zip`, r.zip);
    setMsg(`${r.total} ${r.total === 1 ? 'sheet' : 'sheets'}: ${r.summary.replace(/\n/g, '; ')}.`);
  } catch (e) { setMsg(`Batch failed: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
