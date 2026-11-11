// Pen fills: contour-parallel and hatched fills of closed shapes.
import { edt, march, loopArea, simplifyLoop } from './geometry.js';

// Contour fill: rings parallel to the outline, `sp` apart, going inward. Rings are chained into continuous
// pen-down paths (a short step inward between rings) so the pen keeps drawing instead of lifting each time.
export function contourFill(polys, rule, sp) {
  if (!(sp > 0) || !polys.length) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 1;
  let ppm = Math.min(25, Math.max(8, 6 / sp));
  while ((x1 - x0 + 2 * pad) * (y1 - y0 + 2 * pad) * ppm * ppm > 6e6 && ppm > 4) ppm *= 0.8;
  const w = Math.ceil((x1 - x0 + 2 * pad) * ppm), h = Math.ceil((y1 - y0 + 2 * pad) * ppm), N = w * h;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.setTransform(ppm, 0, 0, ppm, (pad - x0) * ppm, (pad - y0) * ppm);
  cx.beginPath();
  for (const p of polys) { p.forEach(([x, y], i) => i ? cx.lineTo(x, y) : cx.moveTo(x, y)); cx.closePath(); }
  cx.fillStyle = '#000'; cx.fill(rule === 'evenodd' ? 'evenodd' : 'nonzero');
  const px = cx.getImageData(0, 0, w, h).data, outside = new Uint8Array(N);
  for (let i = 0; i < N; i++) outside[i] = px[i * 4 + 3] >= 128 ? 0 : 1;
  const D = edt(outside, w, h), F = new Float32Array(N);
  let maxD = 0;
  for (let i = 0; i < N; i++) { F[i] = -D[i]; if (D[i] > maxD) maxD = D[i]; }
  const toMm = l => l.map(([X, Y]) => [X / ppm - pad + x0, Y / ppm - pad + y0]);
  const levels = [];
  for (let k = 1; ; k++) {
    const lv = k * sp * ppm + 0.5;
    if (lv > maxD) break;
    const ls = march(F, -lv, w, h).map(l => simplifyLoop(toMm(l), 0.02)).filter(l => l.length > 2 && Math.abs(loopArea(l)) > 0.005);
    if (!ls.length) break;
    levels.push(ls);
  }
  const chains = [];
  let prev = [];
  for (const ls of levels) {
    const next = [];
    for (const l of ls) {
      let best = null;
      for (const ch of prev) {
        if (ch.used) continue;
        const e = ch.pts[ch.pts.length - 1];
        let bi = 0, bd = Infinity;
        l.forEach((q, i) => { const d = Math.hypot(q[0] - e[0], q[1] - e[1]); if (d < bd) { bd = d; bi = i; } });
        if (bd <= 1.6 * sp && (!best || bd < best.d)) best = { ch, i: bi, d: bd };
      }
      const st = best ? best.i : 0, ring = l.slice(st).concat(l.slice(0, st + 1));
      if (best) { best.ch.used = true; best.ch.pts.push(...ring); next.push(best.ch); }
      else { const ch = { pts: ring }; chains.push(ch); next.push(ch); }
    }
    for (const ch of next) ch.used = false;
    prev = next;
  }
  return chains.map(c => c.pts);
}
// Parallel fill lines inside polygons (mm), at `sp` spacing and `angDeg` angle, honouring the fill rule; rows alternate direction.
export function hatchLines(polys, rule, sp, angDeg) {
  if (!(sp > 0)) return [];
  const a = angDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const rot = ([x, y]) => [x * c + y * s, -x * s + y * c], unrot = ([x, y]) => [x * c - y * s, x * s + y * c];
  const P = polys.map(p => p.map(rot));
  let y0 = Infinity, y1 = -Infinity;
  for (const p of P) for (const q of p) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const out = [];
  let k = 0;
  for (let y = y0 + sp / 2; y < y1; y += sp, k++) {
    const xs = [];
    for (const p of P) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [ax, ay] = p[j], [bx, by] = p[i];
      if ((ay > y) !== (by > y)) xs.push({ x: ax + (y - ay) / (by - ay) * (bx - ax), w: by > ay ? 1 : -1 });
    }
    xs.sort((m, n) => m.x - n.x);
    let wind = 0, start = null;
    const segs = [];
    for (let i = 0; i < xs.length; i++) {
      const in0 = rule === 'evenodd' ? i % 2 === 1 : wind !== 0;
      wind += xs[i].w;
      const in1 = rule === 'evenodd' ? (i + 1) % 2 === 1 : wind !== 0;
      if (!in0 && in1) start = xs[i].x;
      if (in0 && !in1 && start != null) { if (xs[i].x - start > 0.05) segs.push([start, xs[i].x]); start = null; }
    }
    if (k % 2) segs.reverse();
    for (const [xa, xb] of segs) out.push(k % 2 ? [unrot([xb, y]), unrot([xa, y])] : [unrot([xa, y]), unrot([xb, y])]);
  }
  return out;
}
