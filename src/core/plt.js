// Skycut PLT: writing (writePlt), drag-knife compensation, and editing existing PLT files.
import { rdpStroke } from './geometry.js';

// Drag-knife compensation. tip: points the blade tip must follow (PLT units), R: blade offset,
// dir: heading the blade had before. Returns the holder-axis path and the final heading.
export function dragKnife(tip, R, dir) {
  const pts = [];
  for (const p of tip) { const l = pts[pts.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-6) pts.push(p); }
  // no micro-moves: points closer than ~0.075 mm (3 units) to the last one are dropped, the end point is kept
  const thin = a => {
    const o = [];
    a.forEach((p, i) => { const l = o[o.length - 1]; if (!l || i === a.length - 1 || Math.hypot(p[0] - l[0], p[1] - l[1]) >= 3) o.push(p); });
    return o;
  };
  if (R <= 0 || pts.length < 2) return { pts: thin(pts), dir };
  const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return [dx / L, dy / L]; };
  const turn = (d1, d2) => Math.abs(Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]));
  const TH = 12 * Math.PI / 180, out = [];
  // sharp turn: overshoot the corner and swivel around it; gentle turn: one point on the bisector
  const swivel = (c, d1, d2) => {
    const a1 = Math.atan2(d1[1], d1[0]);
    let da = Math.atan2(d2[1], d2[0]) - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const n = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 12)));
    for (let i = 1; i <= n; i++) { const a = a1 + da * i / n; out.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]); }
  };
  const bis = (d1, d2) => { const x = d1[0] + d2[0], y = d1[1] + d2[1], L = Math.hypot(x, y) || 1; return [x / L, y / L]; };
  let d = unit(pts[0], pts[1]);
  if (turn(dir, d) <= TH) out.push([pts[0][0] + R * d[0], pts[0][1] + R * d[1]]);
  else { out.push([pts[0][0] + R * dir[0], pts[0][1] + R * dir[1]]); swivel(pts[0], dir, d); }
  for (let i = 1; i < pts.length; i++) {
    const P = pts[i];
    if (i === pts.length - 1) { out.push([P[0] + R * d[0], P[1] + R * d[1]]); break; }
    const d2 = unit(P, pts[i + 1]);
    if (turn(d, d2) <= TH) { const b = bis(d, d2); out.push([P[0] + R * b[0], P[1] + R * b[1]]); }
    else { out.push([P[0] + R * d[0], P[1] + R * d[1]]); swivel(P, d, d2); }
    d = d2;
  }
  return { pts: thin(out), dir: d };
}
export const isMove = tk => /^[UD]-?\d/.test(tk);
// Old, dense files: per pen-down stroke, simplify (0.05 mm) and drop moves shorter than ~0.075 mm.
// The stroke's start and end stay exactly where they were.
export function cleanMoves(tok, first) {
  const out = tok.slice(0, first);
  let i = first, before = 0, after = 0;
  const xy = t => t.slice(1).split(',').map(Number);
  while (i < tok.length) {
    const t = tok[i];
    if (!isMove(t) || t[0] !== 'U') { out.push(t); if (isMove(t)) { before++; after++; } i++; continue; }
    let j = i + 1;
    const ds = [];
    while (j < tok.length && isMove(tok[j]) && tok[j][0] === 'D') ds.push(tok[j++]);
    before += ds.length;
    if (ds.length < 3) { out.push(t, ...ds); after += ds.length; i = j; continue; }
    const dup = ds[0] === 'D' + t.slice(1); // SignCut-style 'U a D a' start
    const P = (dup ? ds : [t, ...ds]).map(xy);
    const simple = rdpStroke(P, 2), kept = [];
    simple.forEach((p, k) => { const l = kept[kept.length - 1]; if (!l || k === simple.length - 1 || Math.hypot(p[0] - l[0], p[1] - l[1]) >= 3) kept.push(p); });
    const dTok = (dup ? kept : kept.slice(1)).map(p => `D${p[0]},${p[1]}`);
    out.push(t, ...dTok);
    after += dTok.length;
    i = j;
  }
  return { tok: out, before, after };
}
export function modifyPlt(text, m) {
  let tok = text.trim().split(/\s+/);
  let first = tok.findIndex(isMove);
  if (first < 0) throw new Error('No moves in this PLT.');
  const set = (pf, val, lo, hi) => {
    if (val == null) return;
    const nt = pf + Math.min(hi, Math.max(lo, Math.round(val)));
    const i = tok.findIndex((x, k) => k < first && new RegExp(`^${pf}\\d+$`).test(x));
    if (i >= 0) tok[i] = nt; else { tok.splice(first, 0, nt); first++; }
  };
  set('VS', m.speed, 1, 13); set('US', m.up, 1, 13); set('FS', m.force, 1, 160);
  if (m.clean) { const r = cleanMoves(tok, first); tok = r.tok; m.counts = [r.before, r.after]; }
  if (m.twice) {
    // repeat every cut after the first pass; the start arrow and the final park move are left alone
    let end = tok.length;
    while (end > first && !isMove(tok[end - 1])) end--;
    const park = end - 1;
    let start = first;
    // skip the start arrow (first path, drawn by the bottom-right mark; its exact points depend on the blade offset)
    let j = first + 1;
    while (j < park && tok[j][0] === 'D') j++;
    const nearArrow = tok.slice(first, j).every(x => { const [X, Y] = x.slice(1).split(',').map(Number); return X > -100 && X < 150 && Y > 550 && Y < 950; });
    if (nearArrow && j < park) start = j;
    tok.splice(park, 0, ...tok.slice(start, park));
  }
  return tok.join(' ');
}
export function pltValues(text) { // current force / speed / up-speed in the header, null when not set
  const tok = text.trim().split(/\s+/), first = tok.findIndex(isMove), head = tok.slice(0, first < 0 ? tok.length : first);
  const get = pf => { const tk = head.find(x => new RegExp(`^${pf}\\d+$`).test(x)); return tk ? +tk.slice(2) : null; };
  return { force: get('FS'), speed: get('VS'), up: get('US') };
}
// Skycut PLT in the same shape SignCut writes it: 40 units/mm, origin at the centre of the bottom-right
// registration mark, X running up the sheet (feed), Y running left.
// frame: centre lines of the registration marks in sheet mm { top, bottom, left, right }.
// opts: { force (g), overcut (mm), bladeOffset (mm), pltForce (write VS/US/FS), cutSpeed, upSpeed (cm/s),
//         markless: no registration marks: a plain 'IN' header, no start-arrow cut, the origin is wherever the
//         knife is set (frame.bottom/right: the start point in sheet mm; top/left unused) }.
// sheetLoops: closed outlines in sheet mm; openLines, ...laterLines: groups of open lines cut first, in order
// (a group with .ordered = true keeps its exact order and direction).
export function writePlt(frame, opts, sheetLoops, openLines = [], ...laterLines) {
  const { top, bottom, left, right } = frame, force = opts.force, oc = opts.overcut * 40, bo = opts.bladeOffset * 40;
  const FX = Math.round((bottom - top) * 40), FY = Math.round((right - left) * 40);
  const loops = [];
  for (const loop of sheetLoops) {
    const pts = [];
    for (const [x, y] of loop) {
      const q = [Math.round((bottom - y) * 40), Math.round((right - x) * 40)], last = pts[pts.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
    }
    if (pts.length > 2) loops.push(pts);
  }
  // nearest-neighbour order, each outline started at its vertex closest to the knife
  const markless = !!opts.markless;
  const out = [markless ? 'IN' : `IN FSIZE${FX},${FY} CMD:32,0,0,400,400;CMD:18,1;CMD:103,0;CMD:35,1,1,0;TB26,${FX},${FY} CMD:35,1;`];
  // blade offset: the tip trails the holder axis, so the axis path is shifted ahead and swivels around corners
  const po = opts;
  if (po.pltForce) {
    const ci = (v, a, b) => Math.min(b, Math.max(a, Math.round(v)));
    // SignCut puts these right after the header: VS cutting speed, US up-speed (cm/s), FS force (g)
    out.push(`VS${ci(po.cutSpeed, 1, 13)}`, `US${ci(po.upSpeed, 1, 13)}`, `FS${ci(force, 1, 160)}`);
  }
  let bdir = [1, 0], maxX = 0;
  const emit = (tip, dup) => {
    const c = dragKnife(tip, bo, bdir);
    bdir = c.dir;
    const q = c.pts.map(p => [Math.round(p[0]), Math.round(p[1])]);
    for (const p of q) maxX = Math.max(maxX, p[0]);
    out.push(`U${q[0][0]},${q[0][1]}`);
    if (dup) out.push(`D${q[0][0]},${q[0][1]}`);
    for (let i = 1; i < q.length; i++) if (q[i][0] !== q[i - 1][0] || q[i][1] !== q[i - 1][1]) out.push(`D${q[i][0]},${q[i][1]}`);
  };
  let cx = 0, cy = 0;
  if (!markless) { emit([[-19, 647], [80, 747], [-19, 847]], false); cx = -19; cy = 847; }
  // open lines first (fold perforations, then grid lines group by group), nearest-neighbour inside a group
  for (const group of [openLines, ...laterLines]) {
  const lines = group.map(l => l.map(([x, y]) => [Math.round((bottom - y) * 40), Math.round((right - x) * 40)]));
  while (lines.length) {
    let bi = 0, bd = Infinity, rev = false;
    // an ordered group is cut exactly in the given order and direction
    if (!group.ordered) lines.forEach((l, i) => {
      const a = l[0], b = l[l.length - 1], da = (a[0] - cx) ** 2 + (a[1] - cy) ** 2, db = (b[0] - cx) ** 2 + (b[1] - cy) ** 2;
      if (da < bd) { bd = da; bi = i; rev = false; }
      if (db < bd) { bd = db; bi = i; rev = true; }
    });
    const l = lines.splice(bi, 1)[0], r = rev ? l.slice().reverse() : l;
    emit(r, true);
    cx = r[r.length - 1][0]; cy = r[r.length - 1][1];
  }
  }
  const left2 = loops.slice();
  while (left2.length) {
    let bi = 0, bv = 0, bd = Infinity;
    left2.forEach((l, i) => l.forEach((q, j) => { const d = (q[0] - cx) ** 2 + (q[1] - cy) ** 2; if (d < bd) { bd = d; bi = i; bv = j; } }));
    const l = left2.splice(bi, 1)[0], r = l.slice(bv).concat(l.slice(0, bv));
    // path the blade tip must follow: the outline, back to the start, then the overcut
    const tip = r.concat([r[0]]);
    let rem = oc;
    for (let i = 1; rem > 0 && i <= r.length; i++) {
      const a = r[i - 1], b = r[i % r.length], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!seg) continue;
      if (seg >= rem) { const k = rem / seg; tip.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); rem = 0; }
      else { tip.push(b); rem -= seg; }
    }
    emit(tip, true);
    cx = r[0][0]; cy = r[0][1];
  }
  // marks: park at the top mark; markless: feed out past the end of the job, like the vinyl cut
  out.push(markless ? `U${maxX + 400},0` : `U${FX},0`, '@;@;');
  return out.join(' ');
}
