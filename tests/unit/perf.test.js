import { describe, it, expect } from 'vitest';
import { perforate } from '../../src/core/perf.js';
import { roundRect } from '../../src/core/matrix.js';

const length = pts => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const near = (a, b, e = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) < e;

describe('perforate', () => {
  it('a straight line: cuts at both ends, even bridges of the given width', () => {
    const d = perforate([[0, 0], [90, 0]], false, 6, 0.8);
    expect(d.length).toBe(Math.round(90.8 / 6.8)); // 13 cuts, 12 bridges
    expect(d[0].pts[0]).toEqual([0, 0]);
    expect(d[d.length - 1].pts.at(-1)).toEqual([90, 0]);
    const cuts = d.map(x => length(x.pts));
    for (const c of cuts) expect(c).toBeCloseTo(cuts[0], 9);
    expect(cuts.reduce((a, b) => a + b, 0) + 0.8 * (d.length - 1)).toBeCloseTo(90, 9);
    for (let i = 1; i < d.length; i++) expect(d[i].pts[0][0] - d[i - 1].pts.at(-1)[0]).toBeCloseTo(0.8, 9);
  });

  it('a square-cornered card: no bridge at or near a corner, all four corners cut through', () => {
    const rect = [[0, 0], [90, 0], [90, 50], [0, 50]];
    const d = perforate(rect, true, 6, 0.8);
    expect(d.every(x => !x.closed)).toBe(true);
    // every corner lies inside one dash (not at a dash end)
    for (const c of rect) {
      const holder = d.find(x => x.pts.slice(1, -1).some(p => near(p, c)));
      expect(holder, `corner ${c}`).toBeTruthy();
    }
    // total cut + bridges = perimeter
    const cut = d.reduce((s, x) => s + length(x.pts), 0);
    const bridges = d.length; // closed: as many bridges as dashes
    expect(cut + bridges * 0.8).toBeCloseTo(280, 6);
  });

  it('rounded corners are cut through, bridges only on the straight sides', () => {
    const rr = roundRect(0, 0, 90, 50, 3);
    const d = perforate(rr, true, 6, 0.8);
    // bridge ends (dash ends) all lie on straight parts: x within the flat top/bottom or y within the flat sides
    for (const x of d) for (const p of [x.pts[0], x.pts.at(-1)]) {
      const onFlat = ((Math.abs(p[1]) < 1e-6 || Math.abs(p[1] - 50) < 1e-6) && p[0] > 3 && p[0] < 87) || ((Math.abs(p[0]) < 1e-6 || Math.abs(p[0] - 90) < 1e-6) && p[1] > 3 && p[1] < 47);
      expect(onFlat, `dash end ${p}`).toBe(true);
    }
  });

  it('a line through crossings keeps the bridges off the crossings', () => {
    // vertical grid line from 0 to 120, card edges at 10..60 and 64..114
    const d = perforate([[0, 0], [0, 10], [0, 60], [0, 64], [0, 114], [0, 120]], false, 6, 0.8, true);
    for (const y of [10, 60, 64, 114]) {
      expect(d.some(x => x.pts[0][1] < y - 1e-9 && x.pts.at(-1)[1] > y + 1e-9), `crossing at ${y} is cut through`).toBe(true);
    }
    // the 4 mm gap between the cards and the 6 mm margins still get a bridge, so no piece falls out
    const bridgesIn = (a, b) => d.slice(1).filter((x, i) => d[i].pts.at(-1)[1] >= a && x.pts[0][1] <= b).length;
    expect(bridgesIn(60, 64)).toBe(1);
    expect(bridgesIn(0, 10)).toBe(1);
  });

  it('leaves short lines whole', () => {
    expect(perforate([[0, 0], [2, 0]], false, 6, 0.8)).toEqual([{ pts: [[0, 0], [2, 0]], closed: false }]);
    const tri = [[0, 0], [2, 0], [1, 1.5]];
    expect(perforate(tri, true, 6, 0.8)).toEqual([{ pts: tri, closed: true }]);
  });
});

describe('perforate, bridges near the corners', () => {
  const opts = { place: 'corners', inset: 2 };
  it('a straight line: cut along its whole length except one bridge 2 mm in from each end', () => {
    const d = perforate([[0, 0], [90, 0]], false, 6, 0.8, false, opts);
    expect(d.map(x => [x.pts[0][0], x.pts.at(-1)[0]])).toEqual([[0, 2], [2.8, 87.2], [88, 90]]);
  });
  it('a square-cornered card: two bridges per side, next to the corners, corners themselves cut', () => {
    const rect = [[0, 0], [90, 0], [90, 50], [0, 50]];
    const d = perforate(rect, true, 6, 0.8, false, opts);
    expect(d.length).toBe(8); // 8 bridges on a closed outline -> 8 cuts
    for (const c of rect) expect(d.some(x => x.pts.slice(1, -1).some(p => near(p, c))), `corner ${c}`).toBe(true);
    const lens = d.map(x => length(x.pts)).sort((a, b) => a - b);
    expect(lens[0]).toBeCloseTo(4, 9); // around each corner: 2 mm + 2 mm
    expect(lens.at(-1)).toBeCloseTo(90 - 2 * 2.8, 9); // the long edge between its two bridges
  });
  it('rounded corners: the bridges sit where the straight edge meets the curve, 2 mm in', () => {
    const d = perforate(roundRect(0, 0, 90, 50, 3), true, 6, 0.8, false, opts);
    expect(d.length).toBe(8);
    const ends = d.flatMap(x => [x.pts[0], x.pts.at(-1)]);
    // on the top edge (y = 0) the flat part runs from x = 3 to 87: bridges at 5..5.8 and 84.2..85
    expect(ends.some(p => near(p, [5, 0]))).toBe(true);
    expect(ends.some(p => near(p, [85, 0]))).toBe(true);
  });
  it('short spans get one bridge in the middle, tiny ones none', () => {
    const d = perforate([[0, 0], [4, 0]], false, 6, 0.8, false, opts);
    expect(d.map(x => [x.pts[0][0], x.pts.at(-1)[0]])).toEqual([[0, 1.6], [2.4, 4]]);
    expect(perforate([[0, 0], [2, 0]], false, 6, 0.8, false, opts)).toHaveLength(1);
  });
});
