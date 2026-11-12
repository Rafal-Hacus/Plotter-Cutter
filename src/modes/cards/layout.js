import { PT, apply, mul, roundRect } from '../../core/matrix.js';
import { perforate } from '../../core/perf.js';
import { writePlt } from '../../core/plt.js';
import { num } from '../../core/svg.js';
import { tick } from '../../core/util.js';
import { pltOpts } from '../../export/files.js';
import { pdfSource } from '../../lib/pdf.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';
import { markFrame } from '../stickers/export.js';
import { G_PAGE, M_PAGE, M_TPL, deckPer, pageDims, rotPlace } from './job.js';

export function morganaLayout(o) {
  const pw = state.job.pageW, ph = state.job.pageH, b = o.cBleed, tw = pw - 2 * b, th = ph - 2 * b;
  const base = { n: 0, items: [], b, tw, th, e: 0, gap: 0, guil: false, morgana: true, pw, ph, sc: 1 };
  const land = tw >= th, [W, H] = { '90x50': [90, 50], '85x55': [85, 55] }[o.mSize] || [90, 55];
  if (Math.abs(Math.max(tw, th) - W) > 0.6 || Math.abs(Math.min(tw, th) - H) > 0.6) return { ...base, error: `The CardXtra is set to cut ${W} × ${H} mm; this PDF is ${num(Math.round(tw * 10) / 10)} × ${num(Math.round(th * 10) / 10)} mm after the bleed.` };
  // every card sits in the bottom-left corner of its template slot; bleed is limited to half the gap to the next card
  const rot = land ? 0 : 90, e = Math.min(b, (60 - H) / 2, (100.5 - W) / 2), items = [];
  const S = [-1, 0, 0, 1, pw, 0], My = [1, 0, 0, -1, 0, M_PAGE.hMm];
  M_TPL.rows.forEach((ry, r) => M_TPL.cols.forEach((rx, c) => {
    const tx = rx, ty = ry + M_TPL.h - H;
    const T = rotPlace(rot, tx - b, ty - b, pw, ph);
    // back: flipped over the long (top) edge, so the back of each card reads the right way up; placed on the template's back slot
    const Lb = mul(My, mul(T, S)), pts = [[b, b], [b + tw, b], [b, b + th], [b + tw, b + th]].map(q => apply([Lb[0], Lb[1], Lb[2], Lb[3], 0, 0], q));
    // the back of the same card is mirrored top-to-bottom, so it sits in the top-left corner of the back slot
    const bx = M_TPL.backCols[c], by = M_TPL.backRows[M_TPL.rows.length - 1 - r];
    const Tb = [Lb[0], Lb[1], Lb[2], Lb[3], bx - Math.min(...pts.map(q => q[0])), by - Math.min(...pts.map(q => q[1]))];
    items.push({ T, Tb, trim: [tx, ty, W, H], clip: [tx - e, ty - e, W + 2 * e, H + 2 * e], btrim: [bx, by, W, H], bclip: [bx - e, by - e, W + 2 * e, H + 2 * e] });
  }));
  return { ...base, n: items.length, items, e, rot, cols: 4, rows: 5 };
}
const shiftRect = (rc, o) => [rc[0] + o.cOffX, rc[1] + o.cOffY, rc[2], rc[3]];
export const backT = (it, o) => it.Tb ? mul([1, 0, 0, 1, o.cOffX, o.cOffY], it.Tb) : backMatrix(it.T, o);
export const backClip = (it, o) => it.bclip ? shiftRect(it.bclip, o) : backRect(it.clip, o);
// a multi-page job laid out card by card: the card deck (front + back per card) or the guillotine with
// "every page a separate card" (one page per card, one-sided)
export const deckLike = () => state.mode === 'deck' || (state.mode === 'guillotine' && document.getElementById('gPages').value === 'each');
// Duplex: the back page is the front mirrored across the flip edge, with each card mirrored back
// around its own vertical axis (so the back reads upright), then shifted by the calibration offset.
export function sheetMirror(o) { const pg = pageDims(); return o.cFlip === 'short' ? [1, 0, 0, -1, 0, pg.hMm] : [-1, 0, 0, 1, pg.wMm, 0]; }
// an axis-aligned rect (sheet mm) as it lands on the back page
export function backRect(rc, o) {
  const pg = pageDims(), [x, y, w, h] = rc;
  return o.cFlip === 'short' ? [x + o.cOffX, pg.hMm - y - h + o.cOffY, w, h] : [pg.wMm - x - w + o.cOffX, y + o.cOffY, w, h];
}
// Crop marks on each side, fitted into the room between the trim and the sheet edge:
// the offset shrinks (down to the bleed) so at least part of the mark is printable.
export function markSide(L, o, space) {
  const avail = space - o.gMargin;
  const off = Math.max(L.b, Math.min(o.gMarkOff, avail - 1.5)), end = Math.min(off + o.gMarkLen, space);
  return end - off >= 0.5 ? { off, end, printable: Math.max(0, Math.min(end, avail) - off) } : null;
}
export function cropMarks(L, o) { // [[x1,y1,x2,y2]...] in sheet mm
  const x0 = L.sx, y0 = L.sy, x1 = L.sx + L.totW, y1 = L.sy + L.totH, out = [];
  const T = markSide(L, o, y0), B = markSide(L, o, G_PAGE.hMm - y1), Lf = markSide(L, o, x0), R = markSide(L, o, G_PAGE.wMm - x1);
  for (const x of L.cutsX) { if (T) out.push([x, y0 - T.end, x, y0 - T.off]); if (B) out.push([x, y1 + B.off, x, y1 + B.end]); }
  for (const y of L.cutsY) { if (Lf) out.push([x0 - Lf.end, y, x0 - Lf.off, y]); if (R) out.push([x1 + R.off, y, x1 + R.end, y]); }
  return out;
}
function backMatrix(T, o) {
  const S = [-1, 0, 0, 1, state.job.layout ? state.job.layout.pw : state.job.pageW, 0];
  return mul([1, 0, 0, 1, o.cOffX, o.cOffY], mul(sheetMirror(o), mul(T, S)));
}
export const cardTrim = (L, o) => roundRect(L.b, L.b, L.tw, L.th, o.cRadius);
// Voucher fold: a perforation across the long side (dashes, with uncut gaps at both edges), in card-page mm.
export function cardFoldLines(L, o) {
  if ((state.mode !== 'vouchers' && state.mode !== 'winietka') || o.cFold !== 'perf' || !L) return [];
  // the fold runs across the longer side (square cards: horizontally, like a tent card), unless set
  const vert = o.cFoldDir === 'v' ? true : o.cFoldDir === 'h' ? false : L.tw > L.th + 0.01, len = vert ? L.th : L.tw, along = vert ? L.tw : L.th;
  const pos = o.cFoldPos > 0 && o.cFoldPos < along ? o.cFoldPos : along / 2;
  const cut = o.cPerfCut, gap = o.cPerfGap, n = Math.floor((len - gap) / (cut + gap));
  if (n < 1) return [];
  const start = (len - (n * cut + (n - 1) * gap)) / 2, segs = [];
  for (let i = 0; i < n; i++) {
    const a = start + i * (cut + gap), b = a + cut;
    segs.push(vert ? [[L.b + pos, L.b + a], [L.b + pos, L.b + b]] : [[L.b + a, L.b + pos], [L.b + b, L.b + pos]]);
  }
  return segs;
}
function cardSheetFolds() {
  const L = state.job.layout, f = cardFoldLines(L, readOpts());
  return L.items.flatMap(it => f.map(sg => sg.map(p => apply(it.T, p))));
}
// Grid cutting: straight lines through every card edge, running across the free area (the sheet border
// stays whole, so it keeps feeding). Only for square corners.
export const gridCut = o => (state.mode === 'cards' || state.mode === 'vouchers' || state.mode === 'winietka') && o.cCutStyle === 'grid' && !(o.cRadius > 0);
// Cut order: after the start mark (bottom right), vertical lines from right to left, the first going up,
// then alternating. Horizontal lines start on the side where the verticals ended (top or bottom),
// the first going left to right, then alternating.
export function cardGridLines() {
  const L = state.job.layout;
  const xs = L.cutsX.slice().sort((a, b) => b - a);
  const v = xs.map((x, i) => i % 2 ? [[x, L.fy0], [x, L.fy1]] : [[x, L.fy1], [x, L.fy0]]);
  const endTop = xs.length % 2 === 1;
  const ys = L.cutsY.slice().sort((a, b) => endTop ? a - b : b - a);
  const h = ys.map((y, i) => i % 2 ? [[L.fx1, y], [L.fx0, y]] : [[L.fx0, y], [L.fx1, y]]);
  return { v: Object.assign(v, { ordered: true }), h: Object.assign(h, { ordered: true }) };
}
function cardSheetLoops() {
  const L = state.job.layout, o = readOpts();
  if (gridCut(o)) return [];
  const trim = cardTrim(L, o);
  return L.items.map(it => trim.map(p => apply(it.T, p)));
}
// Perforated die cut (business cards): the cut lines become cuts with uncut bridges, so the sheet holds together
// without a cutting mat. Business cards only for now.
export const perfDie = o => (state.mode === 'cards' || state.mode === 'winietka') && o.cPerfDie;
// Every card cut line on the sheet, in sheet mm, the way it is cut:
// loops (closed outlines), folds (fold perforation), v and h (grid lines, cut in this exact order),
// dashes (perforated outlines, any order).
export function cardCuts() {
  const o = readOpts(), L = state.job.layout, grid = gridCut(o), folds = cardSheetFolds();
  const gl = grid ? cardGridLines() : { v: [], h: [] };
  if (!perfDie(o)) return { loops: cardSheetLoops(), folds, v: gl.v, h: gl.h, dashes: [] };
  const opens = list => list.flatMap(d => d.closed ? [d.pts.concat([d.pts[0]])] : [d.pts]);
  const tieOpts = { place: o.cTiePlace, inset: o.cTieInset };
  if (grid) {
    // split each grid line at the lines crossing it, so bridges stay off the card corners
    const through = (ln, cross, k) => {
      const [a, b] = ln, lo = Math.min(a[k], b[k]), hi = Math.max(a[k], b[k]), up = b[k] > a[k];
      const mids = cross.filter(c => c > lo + 1e-6 && c < hi - 1e-6).sort((x, y) => up ? x - y : y - x);
      const pts = [a, ...mids.map(c => k ? [a[0], c] : [c, a[1]]), b];
      return opens(perforate(pts, false, o.cTieCut, o.cTie, true, tieOpts));
    };
    const v = gl.v.flatMap(ln => through(ln, L.cutsY, 1)), h = gl.h.flatMap(ln => through(ln, L.cutsX, 0));
    return { loops: [], folds, v: Object.assign(v, { ordered: true }), h: Object.assign(h, { ordered: true }), dashes: [] };
  }
  return { loops: [], folds, v: [], h: [], dashes: opens(cardSheetLoops().flatMap(l => perforate(l, true, o.cTieCut, o.cTie, false, tieOpts))) };
}
// Winietki cut without the sensor: the PLT starts at a printed dot (where the bottom-right mark would be)
// instead of reading the registration marks.
export const dotCut = o => state.mode === 'winietka' && o.cAlign === 'dot';
// the start dot in sheet mm: the centre of the bottom-right registration mark
const startDot = () => { const f = markFrame(state.template); return [f.right, f.bottom]; };
// The start dot on a print page: a 1.2 mm dot inside a 4 mm ring, with 12 mm cross-hairs to aim the knife tip.
export function drawStartDot(page, Hpt) {
  const { rgb } = window.PDFLib, [x, y] = startDot(), X = x * PT, Y = Hpt - y * PT, black = rgb(0, 0, 0);
  page.drawCircle({ x: X, y: Y, size: 0.6 * PT, color: black });
  page.drawCircle({ x: X, y: Y, size: 2 * PT, borderColor: black, borderWidth: 0.15 * PT });
  page.drawLine({ start: { x: X - 6 * PT, y: Y }, end: { x: X + 6 * PT, y: Y }, thickness: 0.1 * PT, color: black });
  page.drawLine({ start: { x: X, y: Y - 6 * PT }, end: { x: X, y: Y + 6 * PT }, thickness: 0.1 * PT, color: black });
}
export const startDotSvg = () => { const [x, y] = startDot(); return `<g stroke="#000" fill="none"><circle cx="${num(x)}" cy="${num(y)}" r="0.6" fill="#000" stroke="none"/><circle cx="${num(x)}" cy="${num(y)}" r="2" stroke-width="0.15"/><path d="M${num(x - 6)} ${num(y)}h12M${num(x)} ${num(y - 6)}v12" stroke-width="0.1"/></g>`; };
// The card cut as a PLT, lined up by the marks or by the start dot.
export function cardPlt(c, o) {
  const frame = markFrame(state.template), opts = pltOpts(o, o.dieForce);
  if (dotCut(o)) { frame.right -= o.cShiftX; frame.bottom -= o.cShiftY; opts.markless = true; }
  return gridCut(o) ? writePlt(frame, opts, [], c.folds, c.v, c.h) : writePlt(frame, opts, c.loops, c.folds, c.dashes);
}
/* ---------- card deck: a multi-page PDF as double-sided cards, many sets ---------- */
export function deckPlan(o) {
  const L = state.job.layout, N = L ? L.n : 0, nCards = Math.ceil(state.job.pages / deckPer()), sets = state.mode === 'deck' ? o.deckSets : o.gEachSets, total = nCards * sets;
  if (!N) return { N: 0, cards: nCards, sets, total, sheets: 0, order: o.deckOrder };
  if (o.deckOrder === 'card') { const per = Math.ceil(sets / N); return { N, cards: nCards, sets, total, per, sheets: per * nCards, order: 'card' }; }
  return { N, cards: nCards, sets, total, sheets: Math.ceil(total / N), order: 'stack' };
}
// which card (0-based) sits in slot j of sheet i, or null for an empty slot
export function deckCard(dk, i, j) {
  if (!dk || !dk.N) return null;
  if (dk.order === 'card') { const c = Math.floor(i / dk.per), left = dk.sets - (i % dk.per) * dk.N; return c < dk.cards && j < left ? c : null; }
  const idx = j * dk.sheets + i; // cut & stack: pile j holds items j*S … j*S+S-1, piles stacked in slot order give the sets in order
  return idx < dk.total ? idx % dk.cards : null;
}
/* ---------- winietki: many different single-sided cards, print + straight-line cut ---------- */
export function winPlan(o) {
  const L = state.job.layout, N = L ? L.n : 0, items = (state.job.items || []).length, copies = Math.max(1, Math.round(o.winCopies || 1)), total = items * copies;
  return { N, items, copies, total, sheets: N ? Math.ceil(total / N) : 0 };
}
// which file/page sits in slot j of sheet s (copies of one card next to each other), or null
export function winItem(s, j) {
  const wp = winPlan(readOpts()), k = s * wp.N + j;
  return wp.N && k < wp.total ? Math.floor(k / wp.copies) : null;
}
// Add every page of a PDF as a winietka. labels: names for the pages (else file name + page);
// bleed: the exact bleed of generated pages (else read from the trim box).
export async function winIngest(bytes, fileName, { labels = null, bleed = null } = {}) {
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
  const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  for (let i = 0; i < pdf.numPages; i++) {
    const lp = lib.getPage(i), mb = lp.getMediaBox(), tb = lp.getTrimBox();
    if (!state.job.items.length) { // the first card sets the size and the bleed
      state.job.pageW = mb.width / PT; state.job.pageH = mb.height / PT; state.job.mbx = mb.x; state.job.mby = mb.y; state.job.bleed = null;
      if (bleed != null) state.job.bleed = bleed;
      else if (tb.width < mb.width - 0.5 && tb.height < mb.height - 0.5) state.job.bleed = Math.round((mb.width - tb.width) / 2 / PT * 100) / 100;
      if (state.job.bleed != null) document.getElementById('cBleed').value = state.job.bleed;
    }
    const pg = await pdf.getPage(i + 1), vp = pg.getViewport({ scale: 6 / PT });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    state.job.items.push({ name: labels ? labels[i] : pdf.numPages > 1 ? `${fileName} p.${i + 1}` : fileName, bytes, page: i, w: mb.width, h: mb.height, mbx: mb.x, mby: mb.y, preview: cv.toDataURL('image/jpeg', 0.85) });
    cv.width = cv.height = 1;
    if (i % 20 === 19) await tick();
  }
}
