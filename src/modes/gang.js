// Print sheets (gang printing for the guillotine): pictures and PDF pages, each scaled with its proportions kept
// to cover the chosen format plus bleed (or to fit inside it), imposed on 310 × 440 sheets with crop marks.
import { jpegOrientation, readAsDataUrl } from '../core/image.js';
import { PT, mul } from '../core/matrix.js';
import { mm1, num } from '../core/svg.js';
import { asciiOnly, isImageFile, isPdfFile, tick } from '../core/util.js';
import { CUT_RED, byId, saveFile, setMsg, ui } from '../dom.js';
import { drawClipped, drawCropMarks } from '../export/pdf-draw.js';
import { ensureLibs, pdfSource } from '../lib/pdf.js';
import { G_PAGE, kinds } from './cards/job.js';
import { computeCardLayout, cropMarks } from './cards/layout.js';
import { registerMode } from './registry.js';
import { renderPreview, schedule } from '../pipeline.js';
import { readOpts } from '../settings.js';
import { state } from '../state.js';
import { applyView } from '../viewport.js';

// Images and PDF pages, each scaled with its proportions kept to cover the chosen format plus bleed
// (or to fit inside it), centred, imposed on 310 × 440 sheets with crop marks.
const gang = { items: [], layout: null, sheets: 0, view: 0 };
let gangNext = 1;
const GFORMATS = { '100x150': [100, 150], '130x180': [130, 180], A6: [105, 148], A5: [148, 210], A4: [210, 297], A3: [297, 420], DL: [99, 210], '90x50': [90, 50], '85x55': [85, 55] };
function gangOpts(o) { // the guillotine engine, fed with this mode's own settings
  return { ...o, cBleed: o.ggBleed, gAuto: o.ggAuto, gGap: o.ggGap, gMarkLen: o.ggMarkLen, gMarkOff: o.ggMarkOff, gMargin: o.ggEdge, gSize: 'orig' };
}
function gangFormat(o) {
  const f = o.ggFormat === 'custom' ? [o.ggW, o.ggH] : (GFORMATS[o.ggFormat] || [100, 150]);
  return [Math.max(5, f[0]), Math.max(5, f[1])];
}
// A picture as the PDF will carry it: PNG and upright JPEG as they are; other formats, and JPEGs the camera
// marked as turned (EXIF orientation), drawn upright and saved as JPEG. Without that a phone photo would be laid
// out by its upright size but printed sideways.
async function readPicture(f) {
  const url = await readAsDataUrl(f);
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('unreadable image')); im.src = url; });
  let bytes = new Uint8Array(await f.arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50, jpg = bytes[0] === 0xFF && bytes[1] === 0xD8;
  let mime = png ? 'png' : 'jpg';
  if (!png && !(jpg && jpegOrientation(bytes) === 1)) {
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0);
    bytes = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer()); mime = 'jpg';
    cv.width = cv.height = 1;
  }
  return { kind: 'img', bytes, mime, w: img.naturalWidth, h: img.naturalHeight, preview: url };
}
// every page of a PDF as an item of its own
async function readPdfPages(f) {
  await ensureLibs();
  const bytes = new Uint8Array(await f.arrayBuffer()), pages = [];
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
  const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  for (let i = 0; i < pdf.numPages; i++) {
    const pg = await pdf.getPage(i + 1), mb = lib.getPage(i).getMediaBox();
    const vp = pg.getViewport({ scale: 4 / PT });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    pages.push({ name: pdf.numPages > 1 ? `${f.name} p.${i + 1}` : f.name, kind: 'pdf', bytes, page: i, w: mb.width, h: mb.height, mbx: mb.x, mby: mb.y, preview: cv.toDataURL('image/jpeg', 0.85) });
    cv.width = cv.height = 1;
  }
  return pages;
}
async function gangAddFiles(fileList) {
  const failed = [];
  setMsg('Reading files…');
  for (const f of Array.from(fileList)) {
    try {
      let found;
      if (isPdfFile(f)) found = await readPdfPages(f);
      else if (isImageFile(f)) found = [{ name: f.name, ...await readPicture(f) }];
      else throw new Error('not a picture or a PDF');
      for (const it of found) gang.items.push({ id: gangNext++, copies: 1, ...it });
    } catch (e) { failed.push(`${f.name}: ${e.message || e}.`); }
  }
  state.loadError = failed.join(' ');
  gangList();
  schedule();
}
function gangList() {
  const ul = byId('gangList');
  ul.innerHTML = '';
  if (!gang.items.length) { ul.innerHTML = '<li class="empty">No files yet.</li>'; return; }
  for (const it of gang.items) {
    const li = document.createElement('li');
    li.className = 'design';
    li.innerHTML = `<div class="thumb"><img alt="" style="max-width:100%;max-height:100%"></div><div><div class="dname"></div><div class="fields"><label>Copies<input type="number" min="0" step="1" class="gq"></label></div><div class="actions"><button type="button" class="link ged" hidden>Edit picture (fit, rotate, AI)</button></div><div class="status gst"></div></div><button type="button" class="remove">×</button>`;
    li.querySelector('img').src = it.preview;
    li.querySelector('.dname').textContent = it.name; li.querySelector('.dname').title = it.name;
    const q = li.querySelector('.gq'); q.value = it.copies;
    q.addEventListener('input', () => { const v = parseInt(q.value, 10); it.copies = isFinite(v) && v >= 0 ? v : 0; schedule(); });
    const rm = li.querySelector('.remove'); rm.setAttribute('aria-label', `Remove ${it.name}`);
    rm.addEventListener('click', () => { gang.items.splice(gang.items.indexOf(it), 1); gangList(); schedule(); });
    if (it.kind === 'img') {
      const ed = li.querySelector('.ged'); ed.hidden = false;
      if (it.edit) li.querySelector('.gst').textContent = 'Edited for the format (the original is kept: edit again to change it).';
      ed.addEventListener('click', () => gangEdit(it).catch(e => setMsg(`Couldn’t open the editor: ${e.message || e}`, true)));
    }
    ul.appendChild(li);
  }
}
// Edit a picture for the chosen format: the result replaces it on the sheet (crop marks and all); the original
// and the settings are kept, so it can be edited again.
async function gangEdit(it) {
  const o = readOpts(), [fw, fh] = gangFormat(o), { openEditor } = await import('../editor.js');
  if (!it.orig) it.orig = { bytes: it.bytes, mime: it.mime, w: it.w, h: it.h, preview: it.preview };
  await openEditor({
    name: it.name, bytes: it.orig.bytes, state: it.edit || null, format: { w: fw, h: fh, bleed: gangOpts(o).cBleed },
    onApply: r => { Object.assign(it, { bytes: r.bytes, mime: 'png', w: r.w, h: r.h, preview: r.preview, edit: r.state }); gangList(); schedule(); }
  });
}
function gangCompute(o) {
  const go = gangOpts(o), [fw, fh] = gangFormat(o);
  // the guillotine's grid, for a "page" of the chosen format plus bleed
  const job = kinds.gang;
  job.pageW = fw + 2 * go.cBleed; job.pageH = fh + 2 * go.cBleed; job.bytes = gang.items.length ? true : null;
  gang.layout = gang.items.length ? computeCardLayout(null, go, job) : null;
  const total = gang.items.reduce((s, it) => s + it.copies, 0), n = gang.layout ? gang.layout.n : 0;
  gang.sheets = n ? Math.ceil(total / n) : 0;
  gang.view = Math.min(gang.view, Math.max(0, gang.sheets - 1));
  const sel = byId('gangSheet');
  sel.innerHTML = Array.from({ length: Math.max(1, gang.sheets) }, (_, i) => `<option value="${i}">Sheet ${i + 1}${gang.sheets ? ` of ${gang.sheets}` : ''}</option>`).join('');
  sel.value = String(gang.view);
}
// which item goes in which slot: copies in order, sheet after sheet
function gangSlots() {
  const seq = [];
  for (const it of gang.items) for (let k = 0; k < it.copies; k++) seq.push(it);
  return seq;
}
// The box a picture is placed in: its slot's trim plus the full bleed. (The slot's clip can be narrower when the
// gap between copies is less than two bleeds; the picture is clipped to that, but always placed on the trim.)
const gangBox = slot => { const b = gangOpts(readOpts()).cBleed, [x, y, w, h] = slot.trim; return [x - b, y - b, w + 2 * b, h + 2 * b]; };
// placement of an item (natural w × h) in a box on the sheet (mm, y down): rotation to match orientation, scale, centre
function gangPlace(it, box, fill) {
  const [bx, by, bw, bh] = box, rot = (it.w > it.h) !== (bw > bh) && Math.abs(it.w - it.h) > 1e-6;
  const cw = rot ? it.h : it.w, ch = rot ? it.w : it.h;
  const s = fill ? Math.max(bw / cw, bh / ch) : Math.min(bw / cw, bh / ch);
  return { rot, s, x: bx + (bw - cw * s) / 2, y: by + (bh - ch * s) / 2, cw, ch };
}
function renderGangPreview() {
  const o = readOpts(), go = gangOpts(o), L = gang.layout, pg = G_PAGE, fill = o.ggFit === 'fill';
  state.previewFrame = { x: -8, y: -8, w: pg.wMm + 16, h: pg.hMm + 16 };
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${state.previewFrame.x} ${state.previewFrame.y} ${state.previewFrame.w} ${state.previewFrame.h}" role="img" aria-label="Print sheet preview"><rect x="0" y="0" width="${pg.wMm}" height="${pg.hMm}" fill="#fff"/>`];
  if (go.gMargin) p.push(`<rect x="${go.gMargin}" y="${go.gMargin}" width="${pg.wMm - 2 * go.gMargin}" height="${pg.hMm - 2 * go.gMargin}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`);
  if (L && L.n) {
    const seq = gangSlots(), base = gang.view * L.n;
    L.items.forEach((slot, i) => {
      const it = seq[base + i], [cx, cy, cw2, ch2] = slot.clip;
      p.push(`<rect x="${num(slot.trim[0])}" y="${num(slot.trim[1])}" width="${num(slot.trim[2])}" height="${num(slot.trim[3])}" fill="none" stroke="${CUT_RED}" stroke-width="1.1" vector-effect="non-scaling-stroke"/>`);
      if (!it || !ui.showArt.checked) return;
      const pl = gangPlace(it, gangBox(slot), fill);
      // image drawn in its own (rotated) frame
      const M = pl.rot ? [0, -pl.s, pl.s, 0, pl.x, pl.y + pl.ch * pl.s] : [pl.s, 0, 0, pl.s, pl.x, pl.y];
      p.push(`<clipPath id="gc${i}"><rect x="${num(cx)}" y="${num(cy)}" width="${num(cw2)}" height="${num(ch2)}"/></clipPath><g clip-path="url(#gc${i})"><image href="${it.preview}" x="0" y="0" width="${it.w}" height="${it.h}" preserveAspectRatio="none" transform="matrix(${M.map(num).join(',')})"/></g>`);
    });
    p.push(`<path d="${cropMarks(L, go).map(m => `M${num(m[0])} ${num(m[1])}L${num(m[2])} ${num(m[3])}`).join('')}" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
  }
  p.push('</svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderGangStats(busyText) {
  const L = gang.layout, n = L ? L.n : 0, total = gang.items.reduce((s, it) => s + it.copies, 0);
  ui.dropNote.hidden = gang.items.length > 0;
  byId('exGang').disabled = !n || !total || !!busyText;
  byId('exGangProof').disabled = !n || !total || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = !gang.items.length ? 'No files yet' : `${total} ${total === 1 ? 'print' : 'prints'} on ${gang.sheets} ${gang.sheets === 1 ? 'sheet' : 'sheets'}`;
  const notes = [];
  if (gang.items.length && L) {
    const [fw, fh] = gangFormat(readOpts());
    if (!n) notes.push('The format doesn’t fit on the sheet.');
    else {
      notes.push(`${n} per sheet (${L.cols} × ${L.rows}${L.rot ? ', rotated' : ''}), ${num(fw)} × ${num(fh)} mm + ${num(readOpts().ggBleed)} mm bleed.`);
      notes.push(`Cuts from the left edge: ${L.cutsX.map(mm1).join(', ')} mm. From the top: ${L.cutsY.map(mm1).join(', ')} mm.`);
    }
  }
  setMsg(notes.join(' '), gang.items.length > 0 && !n);
}
async function buildGangPdf() {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const o = readOpts(), go = gangOpts(o), L = gang.layout, fill = o.ggFit === 'fill', seq = gangSlots();
  const out = await PDFDocument.create(), Wpt = G_PAGE.wMm * PT, Hpt = G_PAGE.hMm * PT;
  // embed every source once
  const emb = new Map(), srcDocs = new Map();
  for (const it of gang.items) {
    if (!it.copies) continue;
    if (it.kind === 'img') emb.set(it, it.mime === 'png' ? await out.embedPng(it.bytes) : await out.embedJpg(it.bytes));
    else {
      if (!srcDocs.has(it.bytes)) srcDocs.set(it.bytes, await PDFDocument.load(it.bytes, { ignoreEncryption: true }));
      const [pgE] = await out.embedPdf(srcDocs.get(it.bytes), [it.page]);
      emb.set(it, pgE);
    }
  }
  const marks = cropMarks(L, go);
  for (let sh = 0; sh < gang.sheets; sh++) {
    setMsg(`Sheet ${sh + 1} of ${gang.sheets}…`);
    await tick();
    const page = out.addPage([Wpt, Hpt]), names = new Map();
    L.items.forEach((slot, i) => {
      const it = seq[sh * L.n + i];
      if (!it) return;
      const e = emb.get(it);
      if (!names.has(e)) names.set(e, page.node.newXObject('Gang', e.ref));
      const pl = gangPlace(it, gangBox(slot), fill), rc = slot.clip;
      // source units -> natural size (image: unit square; PDF page: points from its media box)
      const S0 = it.kind === 'img' ? [it.w, 0, 0, it.h, 0, 0] : [1, 0, 0, 1, -it.mbx, -it.mby];
      // natural (y up) -> sheet points (y up), rotated a quarter turn when the orientation differs
      const s = pl.s * PT, x0 = pl.x * PT, yTop = Hpt - pl.y * PT, chPt = pl.ch * s;
      const R = pl.rot ? [0, s, -s, 0, x0 + pl.cw * s, yTop - chPt] : [s, 0, 0, s, x0, yTop - chPt];
      const M = mul(R, S0);
      drawClipped(page, names.get(e), rc, M, Hpt);
    });
    drawCropMarks(page, marks, Hpt);
  }
  out.setTitle(`Print sheets, ${seq.length} prints`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
byId('gangFile').addEventListener('change', e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) gangAddFiles(files); });
byId('gangSheet').addEventListener('change', e => { gang.view = parseInt(e.target.value, 10) || 0; renderPreview(); });
byId('ggFormat').addEventListener('change', () => { byId('rowGGCustom').hidden = byId('ggFormat').value !== 'custom'; });
byId('ggAuto').addEventListener('change', () => { byId('rowGGGap').hidden = byId('ggAuto').checked; });
byId('exGang').addEventListener('click', async () => {
  const btn = byId('exGang'); btn.disabled = true;
  try { const n = gangSlots().length; await saveFile(`print-sheets-${gang.sheets}x-${n}pcs.pdf`, await buildGangPdf()); renderGangStats(); }
  catch (e) { setMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
// Proof: every file whole, one A4 page each, with the cut line and the bleed edge drawn over it
// and everything that ends up cut off greyed out.
async function buildGangProof() {
  await ensureLibs();
  const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = window.PDFLib;
  const o = readOpts(), go = gangOpts(o), L = gang.layout, fill = o.ggFit === 'fill', [fw, fh] = gangFormat(o), b = go.cBleed;
  const out = await PDFDocument.create(), font = await out.embedFont(StandardFonts.Helvetica), srcDocs = new Map();
  const tw = L.items[0].trim[2], th = L.items[0].trim[3], PW = 595.28, PH = 841.89;
  const red = rgb(0.85, 0.1, 0.1), orange = rgb(0.95, 0.55, 0.1), grey = rgb(1, 1, 1);
  for (const it of gang.items) {
    if (!it.copies) continue;
    const page = out.addPage([PW, PH]);
    const e = it.kind === 'img' ? (it.mime === 'png' ? await out.embedPng(it.bytes) : await out.embedJpg(it.bytes)) : await (async () => {
      if (!srcDocs.has(it.bytes)) srcDocs.set(it.bytes, await PDFDocument.load(it.bytes, { ignoreEncryption: true }));
      return (await out.embedPdf(srcDocs.get(it.bytes), [it.page]))[0];
    })();
    const pl = gangPlace(it, [0, 0, tw + 2 * b, th + 2 * b], fill), s = pl.s;
    // the printed area (bleed box) and the cut line, in the file's own units, centred on it
    const vis = pl.rot ? [(th + 2 * b) / s, (tw + 2 * b) / s] : [(tw + 2 * b) / s, (th + 2 * b) / s];
    const cut = pl.rot ? [th / s, tw / s] : [tw / s, th / s];
    const rect = sz => [it.w / 2 - sz[0] / 2, it.h / 2 - sz[1] / 2, sz[0], sz[1]]; // x, y (from the top), w, h
    const V = rect(vis), C = rect(cut);
    const minX = Math.min(0, V[0]), minY = Math.min(0, V[1]), maxX = Math.max(it.w, V[0] + V[2]), maxY = Math.max(it.h, V[1] + V[3]);
    const AX = 40, AY = 70, AW = PW - 80, AH = PH - 150, k = Math.min(AW / (maxX - minX), AH / (maxY - minY));
    const ox = AX + (AW - (maxX - minX) * k) / 2 - minX * k, top = AY + AH - (AH - (maxY - minY) * k) / 2 + minY * k;
    const P = (x, y) => [ox + x * k, top - y * k]; // file units (y down) -> page points
    const [ix, iy] = P(0, it.h);
    const M = it.kind === 'img' ? [it.w * k, 0, 0, it.h * k, ix, iy] : [k, 0, 0, k, ix - it.mbx * k, iy - it.mby * k];
    const name = page.node.newXObject('Src', e.ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...M), drawObject(name), popGraphicsState());
    // grey out what falls outside the cut line (only over the picture itself)
    const band = (x0, y0, x1, y1) => {
      x0 = Math.max(x0, 0); y0 = Math.max(y0, 0); x1 = Math.min(x1, it.w); y1 = Math.min(y1, it.h);
      if (x1 <= x0 || y1 <= y0) return;
      const [px, py] = P(x0, y1);
      page.drawRectangle({ x: px, y: py, width: (x1 - x0) * k, height: (y1 - y0) * k, color: grey, opacity: 0.6 });
    };
    band(0, 0, it.w, C[1]); band(0, C[1] + C[3], it.w, it.h); band(0, C[1], C[0], C[1] + C[3]); band(C[0] + C[2], C[1], it.w, C[1] + C[3]);
    const frame = (R, color, dash) => { const [px, py] = P(R[0], R[1] + R[3]); page.drawRectangle({ x: px, y: py, width: R[2] * k, height: R[3] * k, borderColor: color, borderWidth: 1, borderDashArray: dash, opacity: 0 }); };
    frame(V, orange, [4, 3]); frame(C, red, undefined);
    const t1 = asciiOnly(`${it.name}  (${it.copies} ${it.copies === 1 ? 'copy' : 'copies'})`);
    const t2 = asciiOnly(`${num(fw)} x ${num(fh)} mm + ${num(b)} mm bleed, ${fill ? 'filled' : 'fitted whole'}${pl.rot ? ', turned a quarter on the sheet' : ''}`);
    page.drawText(t1.slice(0, 90), { x: 40, y: PH - 45, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText(t2, { x: 40, y: PH - 62, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    page.drawText('Red: cut line.  Orange dashed: edge of the printed bleed.  Greyed out: cut off.', { x: 40, y: 40, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  }
  out.setTitle('Print sheets proof');
  return new Blob([await out.save()], { type: 'application/pdf' });
}
byId('exGangProof').addEventListener('click', async () => {
  const btn = byId('exGangProof'); btn.disabled = true;
  try { await saveFile('print-sheets-proof.pdf', await buildGangProof()); }
  catch (e) { setMsg(`Couldn’t build the proof: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
gangList();
registerMode('gang', { compute: gangCompute, renderPreview: renderGangPreview, renderStats: renderGangStats, onDrop: gangAddFiles });
