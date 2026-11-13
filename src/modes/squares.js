// Squares: a blank sheet cut into a grid of equal pieces, without registration marks.
import { gridCuts, gridLines } from '../core/grid.js';
import { dragKnife, speedTokens, strokeTokens } from '../core/plt.js';
import { aiId, mm1, num, pathEl } from '../core/svg.js';
import { makeZip } from '../core/zip.js';
import { CUT_RED, byId, saveFile, setMsg, ui } from '../dom.js';
import { buildCutPdf, openAll, pdfClick } from '../export/cut-files.js';
import { registerMode } from './registry.js';
import { readOpts } from '../settings.js';
import { state } from '../state.js';
import { applyView } from '../viewport.js';

const squares = { L: null };
function squaresCompute(o) {
  const W = o.sqSheetW, H = o.sqSheetH, m = o.sqMargin, g = o.sqGap;
  let best = null;
  for (const rot of [false, true]) {
    const pw = rot ? o.sqH : o.sqW, ph = rot ? o.sqW : o.sqH;
    const cols = Math.floor((W - 2 * m + g) / (pw + g)), rows = Math.floor((H - 2 * m + g) / (ph + g));
    if (cols > 0 && rows > 0 && (!best || cols * rows > best.cols * best.rows)) best = { cols, rows, pw, ph, rot };
  }
  if (!best) { squares.L = { n: 0, W, H }; return; }
  const totW = best.cols * best.pw + (best.cols - 1) * g, totH = best.rows * best.ph + (best.rows - 1) * g;
  const sx = (W - totW) / 2, sy = (H - totH) / 2;
  const cutsX = gridCuts(sx, best.cols, best.pw, g), cutsY = gridCuts(sy, best.rows, best.ph, g);
  squares.L = { ...best, n: best.cols * best.rows, W, H, sx, sy, totW, totH, cutsX, cutsY, fx0: m, fy0: m, fx1: W - m, fy1: H - m, g };
}
// same order as the business cards: verticals right to left (first one up from the knife), then horizontals
// from the side the verticals ended on, first one left to right
function squaresLines() {
  const { v, h } = gridLines(squares.L);
  return [...v, ...h];
}
// markless PLT, origin at the knife = bottom right corner of the sheet, X along the feed
function buildSquaresPlt() {
  const o = readOpts(), L = squares.L, bo = o.bladeOffset * 40, out = ['IN'];
  if (o.pltForce) out.push(...speedTokens(o, o.dieForce));
  let bdir = [1, 0], maxX = 0;
  for (const ln of squaresLines()) {
    const tip = ln.map(([x, y]) => [(L.H - y) * 40, (L.W - x) * 40]);
    const c = dragKnife(tip, bo, bdir); bdir = c.dir;
    out.push(...strokeTokens(c.pts.map(p => [Math.round(p[0]), Math.round(p[1])])));
    for (const p of tip) maxX = Math.max(maxX, p[0]);
  }
  // feed the sheet out past the last cut
  out.push(`U${Math.round(maxX + 400)},0`, '@;@;');
  return out.join(' ');
}
function buildSquaresSvg() {
  const o = readOpts(), L = squares.L;
  const s = [`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(L.W)}mm" height="${num(L.H)}mm" viewBox="0 0 ${num(L.W)} ${num(L.H)}">\n`];
  s.push(`<g id="${aiId(o.dieLayer)}">\n`);
  for (const ln of squaresLines()) s.push(pathEl(ln, false, `fill:none;stroke:${o.dieColor};stroke-width:${o.lineW}`) + '\n');
  s.push('</g>\n</svg>\n');
  return s.join('');
}
function renderSquaresPreview() {
  const o = readOpts(), L = squares.L || { n: 0, W: o.sqSheetW, H: o.sqSheetH };
  state.previewFrame = { x: -8, y: -8, w: L.W + 16, h: L.H + 16 };
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${state.previewFrame.x} ${state.previewFrame.y} ${state.previewFrame.w} ${state.previewFrame.h}" role="img" aria-label="Squares cutting layout"><rect x="0" y="0" width="${num(L.W)}" height="${num(L.H)}" fill="#fff"/>`];
  if (L.n) {
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) p.push(`<rect x="${num(L.sx + c * (L.pw + L.g))}" y="${num(L.sy + r * (L.ph + L.g))}" width="${num(L.pw)}" height="${num(L.ph)}" fill="#e7f2ed"/>`);
    p.push(`<path d="${squaresLines().map(l => `M${num(l[0][0])} ${num(l[0][1])}L${num(l[1][0])} ${num(l[1][1])}`).join('')}" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
  }
  p.push(`<g transform="translate(${num(L.W)} ${num(L.H)})"><circle r="2.5" fill="#c2410c"/><path d="M-8 -6 L-8 -22 M-11 -18 L-8 -22 L-5 -18" fill="none" stroke="#c2410c" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g></svg>`);
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderSquaresStats(busyText) {
  const L = squares.L, n = L ? L.n : 0;
  ui.dropNote.hidden = true;
  for (const id of ['exSqPlt', 'exSqSvg', 'exSqPdf']) byId(id).disabled = !n || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = n === 1 ? '1 piece' : `${n} pieces`;
  if (!n) { setMsg('The piece doesn’t fit inside the frame.', true); return; }
  setMsg(`${L.cols} × ${L.rows}${L.rot ? ', turned' : ''}, ${L.cutsX.length + L.cutsY.length} straight cuts. Lines at ${L.cutsX.map(mm1).join(', ')} mm from the left and ${L.cutsY.map(mm1).join(', ')} mm from the top. The knife starts at the bottom right corner.`);
}
byId('exSqPlt').addEventListener('click', () => {
  const L = squares.L, base = `squares-${num(L.pw)}x${num(L.ph)}-${L.n}pcs`;
  saveFile(`${base}-plt.zip`, makeZip([{ name: `${base}.plt`, text: buildSquaresPlt() }]));
});
byId('exSqSvg').addEventListener('click', () => { const L = squares.L; saveFile(`squares-${num(L.pw)}x${num(L.ph)}-${L.n}pcs-cut.svg`, buildSquaresSvg()); });
registerMode('squares', { compute: squaresCompute, renderPreview: renderSquaresPreview, renderStats: renderSquaresStats });
pdfClick('exSqPdf', () => `squares-${num(squares.L.pw)}x${num(squares.L.ph)}-${squares.L.n}pcs-cut.pdf`, () => {
  const o = readOpts();
  return buildCutPdf(squares.L.W, squares.L.H, [{ name: o.dieLayer, color: o.dieColor, paths: openAll(squaresLines()) }], false);
});
