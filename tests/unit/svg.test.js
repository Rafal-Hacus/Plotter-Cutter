import { describe, it, expect } from 'vitest';
import { flattenPath } from '../../src/core/svg.js';

const near = (p, x, y) => { expect(p[0]).toBeCloseTo(x, 6); expect(p[1]).toBeCloseTo(y, 6); };

describe('flattenPath', () => {
  it('lines, closing, and a new subpath after Z', () => {
    const [a, b] = flattenPath('M0 0 L10 0 10 10 Z m20 0 h5 v5');
    expect(a).toEqual({ pts: [[0, 0], [10, 0], [10, 10]], closed: true });
    expect(b).toEqual({ pts: [[20, 0], [25, 0], [25, 5]], closed: false });
  });
  it('numbers written without separators', () => {
    expect(flattenPath('M.5.5L1-1 2e1,3')[0].pts).toEqual([[0.5, 0.5], [1, -1], [20, 3]]);
  });
  it('an arc ends where it says and bulges the right way', () => {
    const [p] = flattenPath('M0 0 A5 5 0 0 1 10 0');
    near(p.pts[p.pts.length - 1], 10, 0);
    const mid = p.pts[Math.floor(p.pts.length / 2)];
    near(mid, 5, -5); // sweep flag 1 with y down: over the top
  });
  it('arc flags packed against the next number (minified SVG) read the same as spaced ones', () => {
    const spaced = flattenPath('M0 0 a5 5 0 0 1 10 0 a5 5 0 1 0 -10 0');
    for (const packed of ['M0 0a5 5 0 0110 0a5 5 0 10-10 0', 'M0 0a5 5 0 01 10 0 5 5 0 1 0-10 0']) {
      expect(flattenPath(packed)).toEqual(spaced);
    }
  });
});
