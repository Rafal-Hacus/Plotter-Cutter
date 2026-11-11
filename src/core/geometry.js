// Raster geometry: distance transforms, contour tracing, simplification and nesting on a cell grid.

export const CELL = 0.5; // nesting grid, mm
//CORE-START
// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher). feat[i]=1 marks feature pixels.
export function edt(feat, w, h) {
  const INF = 1e20, n = Math.max(w, h), N = w * h;
  const g = new Float64Array(N);
  for (let i = 0; i < N; i++) g[i] = feat[i] ? 0 : INF;
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  const out = new Float32Array(N);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) f[x] = g[o + x];
    dt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[o + x] = Math.sqrt(d[x]);
  }
  return out;
}
export function dt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}
// Mark background pixels reachable from the border (4-connected).
export function floodOutside(inside, w, h) {
  const out = new Uint8Array(w * h), st = new Int32Array(w * h);
  let sp = 0;
  const push = i => { if (!inside[i] && !out[i]) { out[i] = 1; st[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = st[--sp], x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return out;
}
// Fill holes of the region field<=level by pulling hole pixels inside; returns inside mask.
export function fillHolesField(F, level, w, h) {
  const N = w * h, inside = new Uint8Array(N);
  for (let i = 0; i < N; i++) inside[i] = F[i] <= level ? 1 : 0;
  const out = floodOutside(inside, w, h);
  for (let i = 0; i < N; i++) if (!inside[i] && !out[i]) { inside[i] = 1; F[i] = level - 1; }
  return inside;
}
export function fillHolesBin(bin, w, h) {
  const out = floodOutside(bin, w, h);
  for (let i = 0; i < w * h; i++) if (!out[i]) bin[i] = 1;
  return bin;
}
// Is the set of 1-pixels a single 8-connected component?
// Marching squares: iso-contours of F at level (inside = F<=level). Returns loops in pixel-center coords.
export function march(F, L, w, h) {
  const pts = new Map(), adj = new Map();
  const ep = id => {
    if (pts.has(id)) return;
    const cell = id >> 1, x = cell % w, y = (cell / w) | 0;
    let bx = x, by = y;
    if (id & 1) by = y + 1; else bx = x + 1;
    const fa = F[y * w + x], fb = F[by * w + bx];
    let t = (L - fa) / (fb - fa);
    if (!isFinite(t)) t = 0.5;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    pts.set(id, [x + (bx - x) * t + 0.5, y + (by - y) * t + 0.5]);
  };
  const link = (a, b) => {
    ep(a); ep(b);
    let A = adj.get(a); if (!A) { A = []; adj.set(a, A); } A.push(b);
    let B = adj.get(b); if (!B) { B = []; adj.set(b, B); } B.push(a);
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const c = (F[i] <= L ? 8 : 0) | (F[i + 1] <= L ? 4 : 0) | (F[i + w + 1] <= L ? 2 : 0) | (F[i + w] <= L ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const T = 2 * i, B = 2 * (i + w), Le = 2 * i + 1, R = 2 * (i + 1) + 1;
      switch (c) {
        case 1: case 14: link(Le, B); break;
        case 2: case 13: link(B, R); break;
        case 3: case 12: link(Le, R); break;
        case 4: case 11: link(T, R); break;
        case 6: case 9: link(T, B); break;
        case 7: case 8: link(Le, T); break;
        case 5: {
          const ctr = (F[i] + F[i + 1] + F[i + w] + F[i + w + 1]) / 4 <= L;
          if (ctr) { link(Le, T); link(B, R); } else { link(T, R); link(Le, B); }
          break;
        }
        case 10: {
          const ctr = (F[i] + F[i + 1] + F[i + w] + F[i + w + 1]) / 4 <= L;
          if (ctr) { link(T, R); link(Le, B); } else { link(Le, T); link(B, R); }
          break;
        }
      }
    }
  }
  const loops = [], seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start, guard = 0;
    while (guard++ < 5e6) {
      seen.add(cur);
      loop.push(pts.get(cur));
      const A = adj.get(cur);
      const nxt = A[0] !== prev ? A[0] : A[1];
      if (nxt === undefined) break;
      prev = cur; cur = nxt;
      if (cur === start || seen.has(cur)) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
export function loopArea(l) {
  let a = 0;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) a += (l[j][0] + l[i][0]) * (l[j][1] - l[i][1]);
  return a / 2;
}
// Ramer-Douglas-Peucker on an open polyline. Uses the distance to the chord *segment* (not the infinite line),
// so points that fold back past an end of the chord are never dropped by mistake.
export function rdp(pts, eps) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    if (b - a < 2) continue;
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, L2 = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] - ax, py = pts[i][1] - ay;
      const t = L2 > 1e-18 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// RDP for a stroke that may end where it started (a closed outline): split at the point farthest from the
// start, simplify both halves, so the shape can't collapse to its endpoints.
export function rdpStroke(pts, eps) {
  if (pts.length < 4) return pts.slice();
  let fi = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > fd) { fd = d; fi = i; }
  }
  if (fi === pts.length - 1) return rdp(pts, eps);
  return rdp(pts.slice(0, fi + 1), eps).concat(rdp(pts.slice(fi), eps).slice(1));
}
export function simplifyLoop(l, eps) {
  if (l.length < 8) return l;
  let fi = 0, fd = 0;
  for (let i = 1; i < l.length; i++) {
    const d = (l[i][0] - l[0][0]) ** 2 + (l[i][1] - l[0][1]) ** 2;
    if (d > fd) { fd = d; fi = i; }
  }
  const a = rdp(l.slice(0, fi + 1), eps), b = rdp(l.slice(fi).concat([l[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
// ---- cell masks ----
export function rotBits(bits, w, h, r) {
  if (r === 0) return { bits: bits.slice(), w, h };
  const W = (r === 180) ? w : h, H = (r === 180) ? h : w, nb = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!bits[y * w + x]) continue;
    let nx, ny;
    if (r === 90) { nx = h - 1 - y; ny = x; }
    else if (r === 180) { nx = w - 1 - x; ny = h - 1 - y; }
    else { nx = y; ny = w - 1 - x; }
    nb[ny * W + nx] = 1;
  }
  return { bits: nb, w: W, h: H };
}
export function makeMask(bits, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bits[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const mw = x1 - x0 + 1, mh = y1 - y0 + 1, mb = new Uint8Array(mw * mh), rows = [];
  let area = 0;
  for (let y = 0; y < mh; y++) {
    const runs = [];
    let x = 0;
    while (x < mw) {
      if (bits[(y + y0) * w + x + x0]) {
        const a = x;
        while (x < mw && bits[(y + y0) * w + x + x0]) { mb[y * mw + x] = 1; x++; area++; }
        runs.push(a, x - 1);
      } else x++;
    }
    rows.push(runs);
  }
  return { w: mw, h: mh, ox: x0, oy: y0, bits: mb, rows, area };
}
export function transposeMask(m) {
  const tb = new Uint8Array(m.w * m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.bits[y * m.w + x]) tb[x * m.h + y] = 1;
  const t = makeMask(tb, m.h, m.w);
  return t;
}
export function transposeGrid(g, W, H) {
  const t = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[x * H + y] = g[y * W + x];
  return t;
}
// Greedy top-left nesting on a cell grid. items: [{masks:{rot:mask}, qty:null|n, area}]
export function runStrategy(Gw, Gh, blocked, items, rotSet) {
  const occ = blocked.slice(), W1 = Gw + 1, P = new Int32Array(Gh * W1);
  const rowPrefix = r => { let s = 0; const o = r * W1, q = r * Gw; for (let x = 0; x < Gw; x++) { s += occ[q + x]; P[o + x + 1] = s; } };
  for (let r = 0; r < Gh; r++) rowPrefix(r);
  const fitsJump = (m, X, Y) => {
    const rows = m.rows;
    for (let r = 0; r < m.h; r++) {
      const o = (Y + r) * W1, rr = rows[r];
      for (let k = 0; k < rr.length; k += 2) {
        const a = rr[k], b = rr[k + 1];
        if (P[o + X + b + 1] - P[o + X + a] > 0) {
          const q = (Y + r) * Gw; let t = X + b;
          while (!occ[q + t]) t--;
          return t - a + 1;
        }
      }
    }
    return -1;
  };
  const find = (m, p) => {
    const maxX = Gw - m.w, maxY = Gh - m.h;
    let x = p.x, y = p.y;
    while (y <= maxY) {
      while (x <= maxX) {
        const j = fitsJump(m, x, y);
        if (j < 0) { p.x = x; p.y = y; return true; }
        x = j > x ? j : x + 1;
      }
      y++; x = 0;
    }
    p.x = 0; p.y = y;
    return false;
  };
  const place = (m, X, Y) => {
    for (let r = 0; r < m.h; r++) {
      const q = (Y + r) * Gw, rr = m.rows[r];
      for (let k = 0; k < rr.length; k += 2) for (let x = rr[k]; x <= rr[k + 1]; x++) occ[q + X + x] = 1;
      rowPrefix(Y + r);
    }
  };
  const ptrs = items.map(() => { const o = {}; for (const r of rotSet) o[r] = { x: 0, y: 0 }; return o; });
  const out = [], placed = items.map(() => 0);
  const tryPlace = ii => {
    const it = items[ii];
    let best = null;
    for (const r of rotSet) {
      const m = it.masks[r]; if (!m) continue;
      const p = ptrs[ii][r];
      if (find(m, p) && (!best || p.y < best.y || (p.y === best.y && p.x < best.x))) best = { r, x: p.x, y: p.y };
    }
    if (!best) return false;
    place(it.masks[best.r], best.x, best.y);
    out.push({ ii, rot: best.r, X: best.x, Y: best.y });
    placed[ii]++;
    return true;
  };
  const idx = items.map((_, i) => i);
  const fixed = idx.filter(i => items[i].qty != null).sort((a, b) => items[b].area - items[a].area);
  for (const i of fixed) for (let n = 0; n < items[i].qty; n++) if (!tryPlace(i)) break;
  let auto = idx.filter(i => items[i].qty == null);
  while (auto.length) auto = auto.filter(i => tryPlace(i));
  return { out, placed };
}
// Label 8-connected components; returns labels (1-based) and bounding boxes.
export function labelComponents(bin, w, h) {
  const N = w * h, lab = new Int32Array(N), st = new Int32Array(N), boxes = [];
  let n = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!bin[s0] || lab[s0]) continue;
    n++;
    let sp = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    lab[s0] = n; st[sp++] = s0;
    while (sp) {
      const i = st[--sp], x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (bin[j] && !lab[j]) { lab[j] = n; st[sp++] = j; }
        }
      }
    }
    boxes.push({ x0, y0, x1, y1 });
  }
  return { lab, n, boxes };
}
// Fill the space between components wherever distA + distB <= T (pixels):
// everything between two outlines that are less than T apart becomes solid.
export function joinNear(bin, w, h, T) {
  const { lab, n, boxes } = labelComponents(bin, w, h);
  if (n < 2 || n > 120) return { bin, joined: false };
  const m = Math.ceil(T) + 2;
  const win = boxes.map((b, ci) => {
    const x0 = Math.max(0, b.x0 - m), y0 = Math.max(0, b.y0 - m), x1 = Math.min(w - 1, b.x1 + m), y1 = Math.min(h - 1, b.y1 + m);
    return { x0, y0, x1, y1, ww: x1 - x0 + 1, hh: y1 - y0 + 1, id: ci + 1, F: null };
  });
  const field = W => {
    if (!W.F) {
      const feat = new Uint8Array(W.ww * W.hh);
      for (let y = 0; y < W.hh; y++) for (let x = 0; x < W.ww; x++) if (lab[(y + W.y0) * w + x + W.x0] === W.id) feat[y * W.ww + x] = 1;
      W.F = edt(feat, W.ww, W.hh);
    }
    return W.F;
  };
  const out = bin.slice();
  let joined = false;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const bi = boxes[i], bj = boxes[j];
    const gx = Math.max(0, bj.x0 - bi.x1, bi.x0 - bj.x1), gy = Math.max(0, bj.y0 - bi.y1, bi.y0 - bj.y1);
    if (Math.hypot(gx, gy) > T + 1) continue;
    const A = win[i], B = win[j];
    const ix0 = Math.max(A.x0, B.x0), iy0 = Math.max(A.y0, B.y0), ix1 = Math.min(A.x1, B.x1), iy1 = Math.min(A.y1, B.y1);
    if (ix0 > ix1 || iy0 > iy1) continue;
    const FA = field(A), FB = field(B);
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
      const a = FA[(y - A.y0) * A.ww + x - A.x0];
      if (a > T) continue;
      if (a + FB[(y - B.y0) * B.ww + x - B.x0] <= T) { out[y * w + x] = 1; joined = true; }
    }
  }
  return { bin: out, joined };
}
