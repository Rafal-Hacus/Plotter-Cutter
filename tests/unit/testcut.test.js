import { describe, it, expect } from 'vitest';
import { TEST_OFFSETS, bladeOffsetPlt, testCutLayout, testCutPlts } from '../../src/core/testcut.js';
import { isMove, pltValues } from '../../src/core/plt.js';

// marks of an A4 sheet (centre lines 5.5 mm in)
const FRAME = { top: 5.5, bottom: 291.5, left: 5.5, right: 204.5 };
const O = { kissForce: 55, dieForce: 120, overcut: 0.5, bladeOffset: 0.35, pltForce: true, cutSpeed: 8, upSpeed: 12 };
// pen-down strokes in plotter units
function strokes(text) {
  const out = [];
  for (const tk of text.split(/\s+/).filter(isMove)) {
    const p = tk.slice(1).split(',').map(Number);
    if (tk[0] === 'U') out.push([p]); else out[out.length - 1].push(p);
  }
  return out.filter(s => s.length > 1);
}
const bbox = s => s.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);

describe('test cut', () => {
  it('lays the blade-offset squares out left to right in the stated order, inside the frame', () => {
    const L = testCutLayout(FRAME);
    expect(L.blade.map(b => b.offset)).toEqual([0.25, 0.3, 0.35, 0.4, 0.5]);
    const xs = L.blade.map(b => Math.min(...b.loop.map(p => p[0])));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    for (const p of [...L.blade.flatMap(b => b.loop), ...L.kiss.loop, ...L.die.loop, ...L.targets.map(t => [t.x, t.y])]) {
      expect(p[0]).toBeGreaterThan(FRAME.left + 10); expect(p[0]).toBeLessThan(FRAME.right - 10);
      expect(p[1]).toBeGreaterThan(FRAME.top + 10); expect(p[1]).toBeLessThan(FRAME.bottom - 10);
    }
  });
  it('refuses a sheet too small for it', () => {
    expect(() => testCutLayout({ top: 5.5, bottom: 100, left: 5.5, right: 200 })).toThrow(/too small/);
  });
  it('cuts each square with its own blade offset (the holder swings out by the offset past every corner)', () => {
    const t = bladeOffsetPlt(FRAME, { ...O, force: O.kissForce }), s = strokes(t);
    expect(s).toHaveLength(1 + TEST_OFFSETS.length); // the start arrow, then the squares
    TEST_OFFSETS.forEach((R, i) => {
      const b = bbox(s[i + 1]);
      // 10 mm square plus the offset on both sides, in 1/40 mm (rounding: a unit or two)
      expect(Math.abs(b[2] - b[0] - (10 + 2 * R) * 40)).toBeLessThanOrEqual(2);
      expect(Math.abs(b[3] - b[1] - (10 + 2 * R) * 40)).toBeLessThanOrEqual(2);
    });
    // left to right on the sheet is Y falling in the PLT (Y runs left)
    const ys = s.slice(1).map(st => bbox(st)[1]);
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
  });
  it('writes valid Skycut PLTs: the mark header with FSIZE, the forces, the park move', () => {
    const files = testCutPlts(FRAME, O);
    expect(files.map(f => f.name)).toEqual(['1-blade-offset.plt', '2-marks.plt', '3-kiss.plt', '4-die.plt']);
    for (const f of files) {
      expect(f.text.startsWith('IN FSIZE11440,7960 CMD:32,0,0,400,400;CMD:18,1;CMD:103,0;CMD:35,1,1,0;TB26,11440,7960 CMD:35,1; VS8 US12 FS')).toBe(true);
      expect(f.text.endsWith('U11440,0 @;@;')).toBe(true);
    }
    expect(files.map(f => pltValues(f.text).force)).toEqual([55, 55, 55, 120]);
    // the marks file: two short lines on each of the four targets, after the start arrow
    const L = testCutLayout(FRAME), m = strokes(files[1].text).slice(1);
    expect(m).toHaveLength(8);
    L.targets.forEach((tg, i) => {
      const c = [Math.round((FRAME.bottom - tg.y) * 40), Math.round((FRAME.right - tg.x) * 40)];
      for (const st of m.slice(2 * i, 2 * i + 2)) {
        const b = bbox(st), mid = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        expect(Math.hypot(mid[0] - c[0], mid[1] - c[1])).toBeLessThan(20); // within half a mm (blade offset lead-in)
      }
    });
  });
  it('leaves force and speed out when they are switched off', () => {
    for (const f of testCutPlts(FRAME, { ...O, pltForce: false })) expect(f.text).not.toMatch(/\b(VS|US|FS)\d/);
  });
});
