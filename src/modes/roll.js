// Roll: print-and-cut PDFs of any size (signs, labels, banners) packed across a roll of the chosen width, as short
// as possible, with SignCut registration marks. Every PDF page is a piece: its trim box is the cut size, the bleed
// around it is printed. The cut is the trim with rounded corners, or the outermost line drawn in the file (e.g. the
// outline of a road sign). Gives the print PDF, the cut PLT and the cut SVG, one sheet per page when the roll is
// split into sheets.
import { lemurMarks } from '../core/marks.js';
import { PT, mul, roundRect } from '../core/matrix.js';
import { outermostLoop, pagePaths } from '../core/pdfpaths.js';
import { writePlt } from '../core/plt.js';
import { copiesFromName, packRoll } from '../core/rollpack.js';
import { aiId, mm1, num, pathEl } from '../core/svg.js';
import { isPdfFile, tick } from '../core/util.js';
import { makeZip } from '../core/zip.js';
import { CUT_RED, byId, fillSheetPicker, plural, saveFile, setMsg, ui } from '../dom.js';
import { pltOpts } from '../export/files.js';
import { drawClipped, svgPathPt } from '../export/pdf-draw.js';
import { ensureLibs, pdfSource } from '../lib/pdf.js';
import { renderPreview, schedule } from '../pipeline.js';
import { readOpts } from '../settings.js';
import { state } from '../state.js';
import { applyView } from '../viewport.js';
import { registerMode } from './registry.js';

const roll = { items: [], sheets: [], tooBig: [], view: 0 };
let nextId = 1;

/* ---------- reading the PDFs ---------- */
async function readPdf(f) {
  await ensureLibs();
  const bytes = new Uint8Array(await f.arrayBuffer()), out = [], { OPS } = window.pdfjsLib;
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
  const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  for (let i = 0; i < pdf.numPages; i++) {
    const pg = await pdf.getPage(i + 1), lp = lib.getPage(i), mb = lp.getMediaBox(), tb = lp.getTrimBox();
    // the trim box, inside the media box (a missing one is the media box: no bleed)
    const tx = Math.max(mb.x, tb.x), ty = Math.max(mb.y, tb.y);
    const trim = { x: tx, y: ty, w: Math.min(mb.x + mb.width, tb.x + tb.width) - tx, h: Math.min(mb.y + mb.height, tb.y + tb.height) - ty };
    // the outline drawn in the file: the outermost closed line within the trim, if it is about the size of the trim
    const ol = await pg.getOperatorList();
    // (a background reaching into the bleed is not a cut line: the line has to stay within 1 mm of the trim)
    const tol = PT, inside = b => b[0] >= trim.x - tol && b[1] >= trim.y - tol && b[2] <= trim.x + trim.w + tol && b[3] <= trim.y + trim.h + tol;
    const loop = outermostLoop(pagePaths(ol.fnArray, ol.argsArray, OPS), b => !inside(b));
    const outer = loop && (loop.bbox[2] - loop.bbox[0]) > 0.8 * trim.w && (loop.bbox[3] - loop.bbox[1]) > 0.8 * trim.h ? loop : null;
    // a picture of the whole page for the preview (at most 1600 px)
    const k = Math.min(4, 1600 / Math.max(mb.width, mb.height)), vp = pg.getViewport({ scale: k });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const preview = cv.toDataURL('image/jpeg', 0.85);
    cv.width = cv.height = 1;
    out.push({
      name: pdf.numPages > 1 ? `${f.name} p.${i + 1}` : f.name, bytes, page: i, preview,
      mb: { x: mb.x, y: mb.y, w: mb.width, h: mb.height }, trim, outer,
      bleeds: [trim.x - mb.x, mb.x + mb.width - trim.x - trim.w, mb.y + mb.height - trim.y - trim.h, trim.y - mb.y].map(v => v / PT) // left, right, top, bottom (mm)
    });
  }
  return out;
}
async function addFiles(fileList) {
  const failed = [], o = readOpts();
  setMsg('Reading the PDFs…');
  for (const f of Array.from(fileList)) {
    try {
      if (!isPdfFile(f)) throw new Error('not a PDF');
      const copies = copiesFromName(f.name);
      for (const it of await readPdf(f)) roll.items.push({ id: nextId++, copies, radius: o.rollRadius, cut: it.outer && o.rollOuter ? 'outer' : 'trim', ...it });
    } catch (e) { failed.push(`${f.name}: ${e.message || e}.`); }
  }
  state.loadError = failed.join(' ');
  list();
  schedule();
}

/* ---------- the list ---------- */
function list() {
  const ul = byId('rollList');
  ul.innerHTML = '';
  if (!roll.items.length) { ul.innerHTML = '<li class="empty">No files yet.</li>'; return; }
  for (const it of roll.items) {
    const li = document.createElement('li');
    li.className = 'design';
    li.innerHTML = `<div class="thumb"><img alt="" style="max-width:100%;max-height:100%"></div><div><div class="dname"></div>
      <div class="fields"><label>Copies<input type="number" min="0" step="1" class="rq"></label><label>Corner radius<input type="number" min="0" step="0.5" class="rr"> mm</label></div>
      <div class="fields"><label>Cut<select class="rc"><option value="trim">Trim size, corners rounded</option><option value="outer">The outermost line in the file</option></select></label></div>
      <div class="status rs"></div></div><button type="button" class="remove">×</button>`;
    li.querySelector('img').src = it.preview;
    const dn = li.querySelector('.dname'); dn.textContent = it.name; dn.title = it.name;
    const q = li.querySelector('.rq'), r = li.querySelector('.rr'), c = li.querySelector('.rc');
    q.value = it.copies; r.value = it.radius; c.value = it.cut;
    c.querySelector('option[value="outer"]').disabled = !it.outer;
    r.disabled = it.cut === 'outer';
    q.addEventListener('input', () => { const v = parseInt(q.value, 10); it.copies = isFinite(v) && v >= 0 ? v : 0; schedule(); });
    r.addEventListener('input', () => { const v = parseFloat(r.value); it.radius = isFinite(v) && v >= 0 ? v : 0; schedule(); });
    c.addEventListener('change', () => { it.cut = c.value; r.disabled = it.cut === 'outer'; status(it, li); schedule(); });
    const rm = li.querySelector('.remove'); rm.setAttribute('aria-label', `Remove ${it.name}`);
    rm.addEventListener('click', () => { roll.items.splice(roll.items.indexOf(it), 1); list(); schedule(); });
    status(it, li);
    ul.appendChild(li);
  }
}
function status(it, li) {
  const b = readOpts().rollBleed, short = it.bleeds.some(v => v < b - 0.05);
  const t = [`Cut ${mm1(it.trim.w / PT)} × ${mm1(it.trim.h / PT)} mm, bleed in the file ${[...new Set(it.bleeds.map(mm1))].join(' / ')} mm.`];
  if (it.cut === 'outer') { const [x0, y0, x1, y1] = it.outer.bbox; t.push(`Cut along the outermost line: ${mm1((x1 - x0) / PT)} × ${mm1((y1 - y0) / PT)} mm.`); }
  else if (!it.outer) t.push('No outline in the file to cut along.');
  if (short) t.push(`Less than the ${mm1(b)} mm bleed set: the rest is white.`);
  li.querySelector('.rs').textContent = t.join(' ');
}

/* ---------- layout ---------- */
// the frame of the sheet: x across the roll, y along it, mm; pieces start `margin` in from the edges (clear of the marks)
function compute(o) {
  const B = o.rollBleed, pieces = [];
  for (const it of roll.items) for (let k = 0; k < it.copies; k++) pieces.push({ id: `${it.id}:${k}`, it, w: it.trim.w / PT + 2 * B, h: it.trim.h / PT + 2 * B });
  const width = o.rollW - 2 * o.rollMargin;
  const r = packRoll(pieces.map(p => ({ id: p.id, w: p.w, h: p.h })), { width, gap: o.rollGap, maxLength: o.rollMax > 0 ? o.rollMax - 2 * o.rollMargin : 0, rotate: o.rollTurn });
  const byId_ = new Map(pieces.map(p => [p.id, p]));
  roll.sheets = r.sheets.map(s => ({
    W: o.rollW, H: s.length + 2 * o.rollMargin,
    places: s.places.map(p => ({ ...p, it: byId_.get(p.id).it, x: p.x + o.rollMargin, y: p.y + o.rollMargin }))
  }));
  roll.tooBig = [...new Set(r.tooBig.map(id => byId_.get(id).it.name))];
  roll.view = Math.min(roll.view, Math.max(0, roll.sheets.length - 1));
  fillSheetPicker(byId('rollSheet'), roll.sheets.length);
  byId('rollSheet').value = String(roll.view);
  byId('rowRollSheet').hidden = roll.sheets.length < 2;
}
// page space of a piece's PDF (points, y up) -> sheet mm (y down), for a piece placed at p (its bleed box)
function pieceMatrix(p, B) {
  const t = p.it.trim, x0 = p.x + B, y0 = p.y + B;
  // turned a quarter clockwise: the page's top edge goes to the right
  return p.rot ? [0, 1 / PT, 1 / PT, 0, x0 - t.y / PT, y0 - t.x / PT] : [1 / PT, 0, 0, -1 / PT, x0 - t.x / PT, y0 + (t.y + t.h) / PT];
}
const applyM = (M, q) => [M[0] * q[0] + M[2] * q[1] + M[4], M[1] * q[0] + M[3] * q[1] + M[5]];
// the cut line of a placed piece, sheet mm
function cutLoop(p, B) {
  if (p.it.cut === 'outer' && p.it.outer) { const M = pieceMatrix(p, B); return p.it.outer.pts.map(q => applyM(M, q)); }
  return roundRect(p.x + B, p.y + B, p.w - 2 * B, p.h - 2 * B, p.it.radius);
}
// SignCut marks: L-marks 10 mm, 1 mm thick, 5 mm in from each corner; the print-only start arrow at the bottom right
function markRects(W, H) {
  return [[5, 5.5, 1, 10], [5.5, 5, 10, 1], [W - 6, 5.5, 1, 10], [W - 15.5, 5, 10, 1], [5, H - 15.5, 1, 10], [5.5, H - 6, 10, 1], [W - 6, H - 15.5, 1, 10], [W - 15.5, H - 6, 10, 1]];
}
const startArrow = (W, H) => [[W - 21.68, H - 5], [W - 24.17, H - 7.5], [W - 26.69, H - 5]];
// the marks' centre lines, as writePlt takes them
const frame = (W, H) => ({ top: 5.5, left: 5.5, right: W - 5.5, bottom: H - 5.5 });

/* ---------- preview ---------- */
function renderRollPreview() {
  const o = readOpts(), B = o.rollBleed, s = roll.sheets[roll.view];
  const W = s ? s.W : o.rollW, H = s ? s.H : Math.max(300, o.rollW / 2);
  state.previewFrame = { x: -10, y: -10, w: W + 20, h: H + 20 };
  const f = state.previewFrame, p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.x} ${f.y} ${f.w} ${f.h}" role="img" aria-label="Roll preview"><rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="#fff"/>`];
  p.push(`<rect x="${num(o.rollMargin)}" y="${num(o.rollMargin)}" width="${num(W - 2 * o.rollMargin)}" height="${num(H - 2 * o.rollMargin)}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`);
  if (s) {
    s.places.forEach((pl, i) => {
      const it = pl.it;
      if (ui.showArt.checked) {
        // the page picture (pixels from the media box's top left, scaled to points) -> page space -> sheet
        const M = mul(pieceMatrix(pl, B), [1, 0, 0, -1, it.mb.x, it.mb.y + it.mb.h]);
        p.push(`<clipPath id="rc${i}"><rect x="${num(pl.x)}" y="${num(pl.y)}" width="${num(pl.w)}" height="${num(pl.h)}"/></clipPath><g clip-path="url(#rc${i})"><image href="${it.preview}" x="0" y="0" width="${num(it.mb.w)}" height="${num(it.mb.h)}" preserveAspectRatio="none" transform="matrix(${M.map(num).join(',')})"/></g>`);
      }
      p.push(pathEl(cutLoop(pl, B), true, `fill:none;stroke:${CUT_RED};stroke-width:1.1;vector-effect:non-scaling-stroke`));
    });
  }
  for (const r of markRects(W, H)) p.push(`<rect x="${num(r[0])}" y="${num(r[1])}" width="${num(r[2])}" height="${num(r[3])}" fill="#000"/>`);
  p.push(`<polyline points="${startArrow(W, H).map(q => q.map(num).join(',')).join(' ')}" fill="none" stroke="#000" stroke-width="0.35"/>`);
  p.push('</svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderRollStats(busyText) {
  const total = roll.items.reduce((s, it) => s + it.copies, 0), ok = roll.sheets.length > 0;
  ui.dropNote.hidden = roll.items.length > 0;
  for (const id of ['exRollPdf', 'exRollPlt', 'exRollSvg']) byId(id).disabled = !ok || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = !roll.items.length ? 'No files yet' : `${plural(total, 'piece')}, ${roll.sheets.map(s => `${mm1(s.H)} mm`).join(' + ') || 'nothing'} of roll`;
  const notes = [];
  if (roll.sheets.length > 1) notes.push(`${roll.sheets.length} sheets (the roll is split at ${mm1(readOpts().rollMax)} mm), each with its own marks.`);
  if (roll.tooBig.length) notes.push(`Too big for the roll: ${roll.tooBig.join(', ')}.`);
  setMsg(notes.join(' '), roll.tooBig.length > 0);
}

/* ---------- files ---------- */
async function buildPdf() {
  await ensureLibs();
  const { PDFDocument, rgb } = window.PDFLib;
  const o = readOpts(), B = o.rollBleed, out = await PDFDocument.create(), docs = new Map(), emb = new Map(), black = rgb(0, 0, 0);
  for (const it of roll.items) {
    if (!it.copies) continue;
    if (!docs.has(it.bytes)) docs.set(it.bytes, await PDFDocument.load(it.bytes, { ignoreEncryption: true }));
    emb.set(it, (await out.embedPdf(docs.get(it.bytes), [it.page]))[0]);
  }
  for (let n = 0; n < roll.sheets.length; n++) {
    const s = roll.sheets[n], Wpt = s.W * PT, Hpt = s.H * PT;
    setMsg(`Sheet ${n + 1} of ${roll.sheets.length}…`); await tick();
    const page = out.addPage([Wpt, Hpt]), names = new Map();
    page.drawRectangle({ x: 0, y: 0, width: Wpt, height: Hpt, color: rgb(1, 1, 1) });
    for (const pl of s.places) {
      const e = emb.get(pl.it);
      if (!names.has(e)) names.set(e, page.node.newXObject('Roll', e.ref));
      // the embedded page starts at its media box's lower left corner; then page space -> sheet mm -> PDF points
      const M = mul([PT, 0, 0, -PT, 0, Hpt], mul(pieceMatrix(pl, B), [1, 0, 0, 1, pl.it.mb.x, pl.it.mb.y]));
      drawClipped(page, names.get(e), [pl.x, pl.y, pl.w, pl.h], M, Hpt);
    }
    for (const r of markRects(s.W, s.H)) page.drawRectangle({ x: r[0] * PT, y: Hpt - (r[1] + r[3]) * PT, width: r[2] * PT, height: r[3] * PT, color: black });
    page.drawSvgPath(svgPathPt(startArrow(s.W, s.H), false), { x: 0, y: Hpt, borderColor: black, borderWidth: 0.35 * PT });
  }
  out.setTitle(`Roll, ${roll.sheets.reduce((a, s) => a + s.places.length, 0)} pieces`);
  setMsg('');
  return new Blob([await out.save()], { type: 'application/pdf' });
}
function sheetLoops(s) { const B = readOpts().rollBleed; return s.places.map(pl => cutLoop(pl, B)); }
function buildPlt(s) {
  const o = readOpts();
  return writePlt(frame(s.W, s.H), pltOpts(o, o.rollForce === 'die' ? o.dieForce : o.kissForce), sheetLoops(s));
}
function buildSvg(s) {
  const o = readOpts(), color = o.rollForce === 'die' ? o.dieColor : o.kissColor, layer = o.rollForce === 'die' ? o.dieLayer : o.kissLayer;
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(s.W)}mm" height="${num(s.H)}mm" viewBox="0 0 ${num(s.W)} ${num(s.H)}">\n  <g id="${aiId(layer)}">\n`
    + sheetLoops(s).map(l => '    ' + pathEl(l, true, `fill:none;stroke:${color};stroke-width:${num(o.lineW)}px;`) + '\n').join('')
    + `  </g>\n${lemurMarks(s.W, s.H)}</svg>\n`;
}
const base = () => `roll-${mm1(readOpts().rollW)}mm-${roll.sheets.reduce((a, s) => a + s.places.length, 0)}pcs`;
const sheetName = (i, ext) => `${base()}${roll.sheets.length > 1 ? `-sheet${i + 1}` : ''}.${ext}`;
function onClick(id, make) {
  const btn = byId(id);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await make(); }
    catch (e) { setMsg(`Couldn’t make the file: ${e.message || e}`, true); }
    finally { btn.disabled = false; }
  });
}
onClick('exRollPdf', async () => saveFile(`${base()}-print.pdf`, await buildPdf()));
onClick('exRollPlt', async () => saveFile(`${base()}-plt.zip`, makeZip(roll.sheets.map((s, i) => ({ name: sheetName(i, 'plt'), text: buildPlt(s) })))));
onClick('exRollSvg', async () => {
  if (roll.sheets.length === 1) saveFile(sheetName(0, 'svg').replace('.svg', '-cut.svg'), buildSvg(roll.sheets[0]));
  else saveFile(`${base()}-cut-svg.zip`, makeZip(roll.sheets.map((s, i) => ({ name: sheetName(i, 'svg'), text: buildSvg(s) }))));
});
byId('rollFile').addEventListener('change', e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) addFiles(files); });
byId('rollSheet').addEventListener('change', e => { roll.view = parseInt(e.target.value, 10) || 0; renderPreview(); });
byId('rollBleed').addEventListener('input', () => list());

list();
registerMode('roll', { compute, renderPreview: renderRollPreview, renderStats: renderRollStats, onDrop: addFiles });
