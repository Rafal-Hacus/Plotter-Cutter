// Vinyl and pen modes: the shapes of the designs cut (or drawn) as they are, nested on a roll without
// registration marks. The origin is the knife: the bottom right corner of the material.
import { contourFill, hatchLines } from '../core/fill.js';
import { CELL, edt, fillHolesBin, makeMask, rdp, rotBits, simplifyLoop } from '../core/geometry.js';
import { closedTip, dragKnife, speedTokens, strokeTokens } from '../core/plt.js';
import { SHAPES, aiId, flattenPath, num, parseSvg, pathEl } from '../core/svg.js';
import { tick } from '../core/util.js';
import { makeZip } from '../core/zip.js';
import { CUT_RED, byId, saveFile, setMsg, ui } from '../dom.js';
import { buildCutPdf, pdfClick } from '../export/cut-files.js';
import { registerMode } from './registry.js';
import { addFiles } from './stickers/index.js';
import { updateRow } from './stickers/rows.js';
import { nestAll, placeMatrix } from '../nest.js';
import { renderStats } from '../pipeline.js';
import { readOpts } from '../settings.js';
import { designs, state } from '../state.js';
import { applyView } from '../viewport.js';

let geoGroup = 0;
 // id shared by the subpaths of one element (so holes stay holes when filling)
// Every visible vector shape in the design, flattened, in root user units. Needs the live DOM (for CTMs and styles).
function extractGeometry(d) {
  let host = null;
  try {
    const doc = parseSvg(d.norm);
    doc.querySelectorAll('image').forEach(n => n.remove());
    host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none';
    const svg = document.importNode(doc.documentElement, true);
    svg.setAttribute('width', '1000'); svg.setAttribute('height', '1000'); svg.removeAttribute('preserveAspectRatio');
    host.appendChild(svg); document.body.appendChild(host);
    const inv = svg.getScreenCTM().inverse(), out = [];
    for (const el of svg.querySelectorAll(SHAPES)) {
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const fillOn = cs.fill && cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0;
      const strokeOn = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeOpacity || '1') > 0;
      if (!fillOn && !strokeOn) continue;
      const gid = ++geoGroup, rule = cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
      const m = inv.multiply(el.getScreenCTM());
      const at = n => parseFloat(el.getAttribute(n)) || 0;
      let polys = [];
      const ell = (cx, cy, rx, ry) => { const p = []; for (let k = 0; k < 72; k++) { const a = k / 72 * 2 * Math.PI; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return [{ pts: p, closed: true }]; };
      switch (el.localName) {
        case 'path': polys = flattenPath(el.getAttribute('d') || ''); break;
        case 'rect': { const x = at('x'), y = at('y'), w = at('width'), h = at('height'); polys = [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }]; break; }
        case 'circle': polys = ell(at('cx'), at('cy'), at('r'), at('r')); break;
        case 'ellipse': polys = ell(at('cx'), at('cy'), at('rx'), at('ry')); break;
        case 'line': polys = [{ pts: [[at('x1'), at('y1')], [at('x2'), at('y2')]], closed: false }]; break;
        default: {
          const a = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number), p = [];
          for (let k = 0; k + 1 < a.length; k += 2) p.push([a[k], a[k + 1]]);
          polys = [{ pts: p, closed: el.localName === 'polygon' }];
        }
      }
      for (const pl of polys) {
        if (pl.pts.length < 2) continue;
        // an explicit return to the start counts as closed
        const f = pl.pts[0], l = pl.pts[pl.pts.length - 1];
        if (!pl.closed && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6 && pl.pts.length > 2) { pl.closed = true; pl.pts.pop(); }
        if (pl.closed && pl.pts.length > 2) { const a = pl.pts[0], b = pl.pts[pl.pts.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pl.pts.pop(); }
        out.push({ pts: pl.pts.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]), closed: pl.closed, fill: !!fillOn, rule, g: gid });
      }
    }
    return out;
  } finally {
    if (host) host.remove();
  }
}
async function processVinyl(d, o) {
  if (!d.vgeo) d.vgeo = extractGeometry(d);
  const geo = d.vgeo;
  if (!geo.length) throw new Error('No vector shapes to cut in this file.');
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  for (const g of geo) for (const [x, y] of g.pts) { gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y); }
  const bw = gx1 - gx0, bh = gy1 - gy0;
  if (!(bh > 0)) throw new Error('The shapes in this file have no height.');
  const s = d.heightMm / bh, frW = bw * s, frH = d.heightMm;
  const weedEach = o.vWeed === 'each', wm = weedEach ? o.vWeedMargin : 0;
  const pad = o.vGap / 2 + wm + 1.5;
  const Wc = Math.ceil((frW + 2 * pad) / CELL), Hc = Math.ceil((frH + 2 * pad) / CELL);
  let ppm = 2;
  for (const p of [10, 6, 4, 2]) if (Wc * Hc * (p * CELL) ** 2 <= 9e6) { ppm = p; break; }
  const f = Math.round(ppm * CELL), w = Wc * f, h = Hc * f, N = w * h;
  const boxW = Wc * CELL, boxH = Hc * CELL, fx = (boxW - frW) / 2, fy = (boxH - frH) / 2;
  const tx = o.vMirror ? (x => fx + (gx1 - x) * s) : (x => fx + (x - gx0) * s), ty = y => fy + (y - gy0) * s;
  const paths = geo.map(g => { const pts = g.pts.map(([x, y]) => [tx(x), ty(y)]); return { pts: g.closed ? simplifyLoop(pts, 0.01) : rdp(pts, 0.01), closed: g.closed }; });
  if (o.penFill) {
    // pen: fill the filled shapes (text etc.) with parallel lines, per element so holes stay empty
    const groups = new Map();
    geo.forEach((g, i) => { if (g.fill && g.closed) { if (!groups.has(g.g)) groups.set(g.g, { rule: g.rule, polys: [] }); groups.get(g.g).polys.push(paths[i].pts); } });
    for (const { rule, polys } of groups.values()) {
      const fill = o.penStyle === 'lines' ? hatchLines(polys, rule, o.penSpacing, o.penAngle) : contourFill(polys, rule, o.penSpacing);
      for (const ln of fill) paths.push({ pts: ln, closed: false });
    }
  }
  if (weedEach && wm > 0) paths.push({ pts: [[fx - wm, fy - wm], [fx + frW + wm, fy - wm], [fx + frW + wm, fy + frH + wm], [fx - wm, fy + frH + wm]], closed: true, weed: true });
  // nesting footprint: everything that gets cut, filled, grown by half the gap
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.setTransform(ppm, 0, 0, ppm, 0, 0);
  cx.fillStyle = '#000'; cx.strokeStyle = '#000'; cx.lineWidth = 0.4; cx.lineJoin = 'round'; cx.lineCap = 'round';
  for (const p of paths) {
    cx.beginPath();
    p.pts.forEach(([x, y], k) => k ? cx.lineTo(x, y) : cx.moveTo(x, y));
    if (p.closed) { cx.closePath(); cx.fill(); }
    cx.stroke();
  }
  const px = cx.getImageData(0, 0, w, h).data, M = new Uint8Array(N);
  for (let i = 0; i < N; i++) M[i] = px[i * 4 + 3] > 0 ? 1 : 0;
  await tick();
  const D = edt(M, w, h), nest = new Uint8Array(N), L = (o.vGap / 2) * ppm + 0.5;
  for (let i = 0; i < N; i++) nest[i] = D[i] <= L ? 1 : 0;
  fillHolesBin(nest, w, h);
  const cb = new Uint8Array(Wc * Hc);
  for (let y = 0; y < h; y++) { const row = ((y / f) | 0) * Wc; for (let x = 0; x < w; x++) if (nest[y * w + x]) cb[row + ((x / f) | 0)] = 1; }
  const masks = {};
  for (const r of [0, 90, 180, 270]) { const rb = rotBits(cb, Wc, Hc, r); masks[r] = makeMask(rb.bits, rb.w, rb.h); }
  if (!masks[0]) throw new Error('The shapes came out empty at this size.');
  const pathD = paths.map(p => 'M' + p.pts.map(q => num(q[0]) + ' ' + num(q[1])).join('L') + (p.closed ? 'Z' : '')).join('');
  return { s, boxW, boxH, frW, frH, masks, paths, pathD, nPaths: geo.length };
}
// Material area as a nesting grid; packs toward the origin corner (bottom right) by nesting
// top-left and turning the whole result 180°.
async function nestVinyl(list, o, cancelled) {
  const W = o.vWidth, Lm = o.vLength, mg = o.vMargin;
  const Gw = Math.floor(W / CELL), Gh = Math.floor(Lm / CELL), blocked = new Uint8Array(Gw * Gh), mc = Math.ceil(mg / CELL);
  for (let y = 0; y < Gh; y++) for (let x = 0; x < Gw; x++) if (x < mc || y < mc || x >= Gw - mc || y >= Gh - mc) blocked[y * Gw + x] = 1;
  // nest with every shape turned 180° (top-left packing), then turn the whole layout 180°: copies pack toward
  // the origin corner and keep their own orientation
  const flip = m => ({ 0: m[180], 90: m[270], 180: m[0], 270: m[90] });
  const proxies = list.map(d => ({ id: d.id, qty: d.qty, name: d.name, res: { ...d.vres, masks: flip(d.vres.masks) }, real: { id: d.id, qty: d.qty, name: d.name, res: d.vres, src: d } }));
  const lay = await nestAll(proxies, { Gw, Gh, blocked, free: null }, { ...o, center: false }, cancelled);
  if (!lay) return null;
  const items = lay.items.map(it => {
    const m0 = it.d.res.masks[it.rot];
    return { d: it.d.real, rot: it.rot, X: Gw - it.X - m0.w, Y: Gh - it.Y - m0.h };
  });
  return { items, counts: lay.counts, W, L: Lm };
}
export function isMarkless() { return state.mode === 'vinyl' || state.mode === 'pen'; }
// pen mode: same engine as vinyl, but drawn with a pen (no blade offset, overcut, weeding or mirroring)
export function vOpts() {
  const o = readOpts();
  return state.mode === 'pen' ? { ...o, vWeed: 'none', vMirror: false, overcut: 0, bladeOffset: 0, kissForce: o.penForce } : { ...o, penFill: false };
}
function vinylPaths() {
  const out = [], L = state.vinylLayout;
  for (const it of L.items) {
    const M = placeMatrix(it);
    for (const p of it.d.res.paths) out.push({ pts: p.pts.map(q => [M[0] * q[0] + M[2] * q[1] + M[4], M[1] * q[0] + M[3] * q[1] + M[5]]), closed: p.closed });
  }
  if (vOpts().vWeed === 'all' && out.length) {
    const wm = vOpts().vWeedMargin;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of out) for (const [x, y] of p.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    x0 = Math.max(0, x0 - wm); y0 = Math.max(0, y0 - wm); x1 = Math.min(L.W, x1 + wm); y1 = Math.min(L.L, y1 + wm);
    out.push({ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
  }
  return out;
}
// Markless PLT: origin at the knife (bottom right of the material), X along the feed, Y across.
function buildVinylPlt() {
  const o = vOpts(), L = state.vinylLayout, oc = o.overcut * 40, bo = o.bladeOffset * 40;
  const conv = ([x, y]) => [Math.round((L.L - y) * 40), Math.round((L.W - x) * 40)];
  const polys = vinylPaths().map(p => {
    const pts = [];
    for (const q of p.pts) { const c = conv(q), l = pts[pts.length - 1]; if (!l || l[0] !== c[0] || l[1] !== c[1]) pts.push(c); }
    return { pts, closed: p.closed && pts.length > 2 };
  }).filter(p => p.pts.length > 1);
  const out = ['IN'];
  if (o.pltForce) out.push(...speedTokens(o, o.kissForce));
  let bdir = [1, 0], cx = 0, cy = 0, maxX = 0;
  const emit = tip => {
    const c = dragKnife(tip, bo, bdir);
    bdir = c.dir;
    out.push(...strokeTokens(c.pts.map(p => [Math.round(p[0]), Math.round(p[1])])));
  };
  // nearest first: a closed shape from its vertex closest to the knife, an open line from its nearer end
  const left = polys.slice();
  while (left.length) {
    let bi = 0, bv = 0, bd = Infinity, rev = false;
    left.forEach((p, i) => {
      if (p.closed) p.pts.forEach((q, j) => { const d = (q[0] - cx) ** 2 + (q[1] - cy) ** 2; if (d < bd) { bd = d; bi = i; bv = j; rev = false; } });
      else {
        const a = p.pts[0], b = p.pts[p.pts.length - 1];
        const da = (a[0] - cx) ** 2 + (a[1] - cy) ** 2, db = (b[0] - cx) ** 2 + (b[1] - cy) ** 2;
        if (da < bd) { bd = da; bi = i; bv = 0; rev = false; }
        if (db < bd) { bd = db; bi = i; bv = 0; rev = true; }
      }
    });
    const p = left.splice(bi, 1)[0];
    const tip = p.closed ? closedTip(p.pts.slice(bv).concat(p.pts.slice(0, bv)), oc) : rev ? p.pts.slice().reverse() : p.pts;
    emit(tip);
    const e = tip[tip.length - 1]; cx = e[0]; cy = e[1];
    for (const q of p.pts) maxX = Math.max(maxX, q[0]);
  }
  // feed the cut job out past its end, back to the right edge
  out.push(`U${maxX + 400},0`, '@;@;');
  return out.join(' ');
}
function buildVinylSvg() {
  const o = vOpts(), L = state.vinylLayout;
  const s = [`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(L.W)}mm" height="${num(L.L)}mm" viewBox="0 0 ${num(L.W)} ${num(L.L)}">\n`];
  s.push(`<g id="${aiId(o.kissLayer)}">\n`);
  for (const p of vinylPaths()) s.push(pathEl(p.pts, p.closed, `fill:none;stroke:${o.kissColor};stroke-width:${o.lineW}`) + '\n');
  s.push('</g>\n</svg>\n');
  return s.join('');
}
function renderVinylPreview() {
  const o = vOpts(), W = o.vWidth, Lm = o.vLength, mg = o.vMargin, L = state.vinylLayout;
  state.previewFrame = { x: -6, y: -6, w: W + 12, h: Lm + 12 };
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${state.previewFrame.x} ${state.previewFrame.y} ${state.previewFrame.w} ${state.previewFrame.h}" role="img" aria-label="Vinyl cutting layout">`);
  p.push(`<rect x="0" y="0" width="${num(W)}" height="${num(Lm)}" fill="#f3f1ec"/>`);
  p.push(`<rect x="${mg}" y="${mg}" width="${num(W - 2 * mg)}" height="${num(Lm - 2 * mg)}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`);
  if (L) {
    let top = Lm;
    for (const it of L.items) {
      const M = placeMatrix(it);
      p.push(`<path d="${it.d.res.pathD}" transform="matrix(${M.map(num).join(',')})" fill="${ui.showArt.checked ? 'rgba(35,31,32,.12)' : 'none'}" fill-rule="evenodd" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      top = Math.min(top, it.Y * CELL);
    }
    if (o.vWeed === 'all' && L.items.length) {
      const wb = vinylPaths().pop();
      p.push(`<polygon points="${wb.pts.map(q => num(q[0]) + ' ' + num(q[1])).join(' ')}" fill="none" stroke="${CUT_RED}" stroke-width="1.2" stroke-dasharray="6 3" vector-effect="non-scaling-stroke"/>`);
    }
    if (L.items.length) p.push(`<line x1="0" x2="${num(W)}" y1="${num(top)}" y2="${num(top)}" stroke="#c2410c" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`);
  }
  // knife origin and feed direction
  p.push(`<g transform="translate(${num(W)} ${num(Lm)})"><circle r="2.5" fill="#c2410c"/><path d="M-8 -6 L-8 -22 M-11 -18 L-8 -22 L-5 -18" fill="none" stroke="#c2410c" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g>`);
  p.push('</svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
function vinylUsedLength() {
  const L = state.vinylLayout;
  if (!L || !L.items.length) return 0;
  let top = Infinity;
  for (const p of vinylPaths()) for (const q of p.pts) top = Math.min(top, q[1]);
  return L.L - top;
}
function renderVinylStats(busyText) {
  const n = state.vinylLayout ? state.vinylLayout.items.length : 0;
  ui.dropNote.hidden = designs.length > 0;
  for (const id of ['exVinylSvg', 'exVinylPlt', 'exVinylPdf']) byId(id).disabled = !n || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  const where = state.mode === 'pen' ? 'sheet' : 'vinyl', tool = state.mode === 'pen' ? 'pen' : 'knife';
  ui.count.textContent = !designs.length ? `Empty ${where}` : n === 1 ? `1 copy on the ${where}` : `${n} copies on the ${where}`;
  const notes = [];
  if (n) notes.push(`Uses ${Math.ceil(vinylUsedLength())} mm of the material length. The ${tool} starts at the bottom right corner, the material feeds up.`);
  for (const d of designs) {
    if (!d.vres) continue;
    const got = state.vinylLayout ? state.vinylLayout.counts.get(d.id) || 0 : 0;
    if (d.qty != null && got < d.qty) notes.push(`Only ${got} of ${d.qty} copies of ${d.name} fit.`);
  }
  setMsg(notes.join(' '), false);
}
async function computeVinyl(_, stale) {
  const o = vOpts();
  for (const d of designs) {
    const key = ['v', d.heightMm, o.vGap, o.vWeed, o.vWeedMargin, o.vMirror, o.penFill, o.penStyle, o.penSpacing, o.penAngle].join('|');
    if (d.vkey === key) continue;
    d.busy = true; updateRow(d);
    renderStats(`Reading ${d.name}…`);
    await tick();
    let res = null, err = null;
    try { res = await processVinyl(d, o); } catch (e) { err = e.message || String(e); }
    if (stale()) return false;
    d.vres = res; d.verr = err; d.vkey = key; d.busy = false;
    updateRow(d);
  }
  const ready = designs.filter(d => d.vres && d.qty !== 0);
  renderStats('Arranging…');
  await tick();
  const lay = ready.length ? await nestVinyl(ready, o, stale) : null;
  if (stale()) return false;
  state.vinylLayout = lay;
  designs.forEach(updateRow);
}
registerMode(['vinyl', 'pen'], { compute: computeVinyl, renderPreview: renderVinylPreview, renderStats: renderVinylStats, onDrop: files => addFiles(files) });
byId('exVinylSvg').addEventListener('click', () => saveFile(`${state.mode === 'pen' ? 'pen' : 'vinyl'}-${state.vinylLayout.items.length}pcs-${state.mode === 'pen' ? 'draw' : 'cut'}.svg`, buildVinylSvg()));
byId('exVinylPlt').addEventListener('click', () => {
  const base = `${state.mode === 'pen' ? 'pen' : 'vinyl'}-${state.vinylLayout.items.length}pcs`;
  saveFile(`${base}-plt.zip`, makeZip([{ name: `${base}.plt`, text: buildVinylPlt() }]));
});
pdfClick('exVinylPdf', () => `${state.mode === 'pen' ? 'pen' : 'vinyl'}-${state.vinylLayout.items.length}pcs-cut.pdf`, () => {
  const o = vOpts();
  return buildCutPdf(state.vinylLayout.W, state.vinylLayout.L, [{ name: o.kissLayer, color: o.kissColor, paths: vinylPaths() }], false);
});
