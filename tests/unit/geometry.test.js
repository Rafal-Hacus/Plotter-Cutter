import { describe, it, expect } from 'vitest';
import { edt, march, loopArea, rdp, rdpStroke, simplifyLoop, fillHolesBin, makeMask, rotBits, runStrategy } from '../../src/core/geometry.js';

const disc = (w, h, cx, cy, r) => { const b = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) b[y * w + x] = 1; return b; };

describe('edt', () => {
  it('matches a brute-force Euclidean distance transform', () => {
    const w = 23, h = 17, f = new Uint8Array(w * h);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < f.length; i++) f[i] = rnd() < 0.04 ? 1 : 0;
    f[0] = 1;
    const D = edt(f, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let best = Infinity;
      for (let j = 0; j < f.length; j++) if (f[j]) best = Math.min(best, Math.hypot(x - (j % w), y - Math.floor(j / w)));
      expect(D[y * w + x]).toBeCloseTo(best, 4);
    }
  });
});

describe('march', () => {
  it('traces one closed loop around a disc with the right area', () => {
    const w = 80, h = 80, r = 25, D = edt(disc(w, h, 40, 40, r), w, h);
    const loops = march(D, 0.5, w, h); // the disc edge, half a pixel out
    expect(loops).toHaveLength(1);
    expect(Math.abs(loopArea(loops[0]))).toBeGreaterThan(Math.PI * r * r * 0.97);
    expect(Math.abs(loopArea(loops[0]))).toBeLessThan(Math.PI * (r + 1) ** 2);
  });
  it('gives the offset contour at the requested distance', () => {
    const w = 120, h = 120, D = edt(disc(w, h, 60, 60, 20), w, h);
    const [loop] = march(D, 10.5, w, h);
    for (const [x, y] of loop) expect(Math.hypot(x - 60.5, y - 60.5)).toBeGreaterThan(29.5), expect(Math.hypot(x - 60.5, y - 60.5)).toBeLessThan(31.6);
  });
});

describe('fillHolesBin', () => {
  it('fills an enclosed hole but not the outside', () => {
    const w = 9, h = 9, b = new Uint8Array(w * h);
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) b[y * w + x] = (x === 2 || x === 6 || y === 2 || y === 6) ? 1 : 0;
    fillHolesBin(b, w, h);
    expect(b[4 * w + 4]).toBe(1);
    expect(b[0]).toBe(0);
  });
});

describe('rdp', () => {
  it('keeps points that fold back past the end of the chord (regression)', () => {
    // goes out to the right, comes back past the start: an infinite-line distance would drop (-5,0.01)
    const pts = [[0, 0], [10, 0], [-5, 0.01], [3, 0]];
    const out = rdp(pts, 0.05);
    expect(out).toContainEqual([10, 0]);
    expect(out).toContainEqual([-5, 0.01]);
  });
  it('drops collinear points', () => {
    expect(rdp([[0, 0], [1, 0.001], [2, 0], [3, 0]], 0.05)).toEqual([[0, 0], [3, 0]]);
  });
});

describe('rdpStroke', () => {
  it('does not collapse a closed stroke that ends where it starts (regression)', () => {
    const sq = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
    const out = rdpStroke(sq, 2);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([0, 0]);
  });
});

describe('simplifyLoop', () => {
  it('reduces a dense circle and stays within tolerance', () => {
    const l = Array.from({ length: 400 }, (_, i) => [50 + 30 * Math.cos(i / 400 * 2 * Math.PI), 50 + 30 * Math.sin(i / 400 * 2 * Math.PI)]);
    const s = simplifyLoop(l, 0.05);
    expect(s.length).toBeLessThan(150);
    for (const [x, y] of s) expect(Math.abs(Math.hypot(x - 50, y - 50) - 30)).toBeLessThan(1e-9);
  });
});

describe('nesting', () => {
  it('places non-overlapping copies and respects blocked cells', () => {
    const W = 20, H = 10, blocked = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) blocked[y * W] = 1; // left column blocked
    const bits = new Uint8Array(16).fill(1), masks = {};
    for (const r of [0, 90, 180, 270]) { const rb = rotBits(bits, 4, 4, r); masks[r] = makeMask(rb.bits, rb.w, rb.h); }
    const { out } = runStrategy(W, H, blocked, [{ masks, qty: null, area: 16 }], [0]);
    expect(out.length).toBe(8); // 19 free columns -> 4 across, 10 rows -> 2 down
    const occ = new Uint8Array(W * H);
    for (const p of out) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = (p.Y + y) * W + p.X + x; expect(occ[i] || blocked[i]).toBe(0); occ[i] = 1;
    }
  });
});
