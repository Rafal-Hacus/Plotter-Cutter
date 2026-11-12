import { describe, it, expect } from 'vitest';
import { gridCuts, gridLines } from '../../src/core/grid.js';

describe('grid cuts', () => {
  it('both edges of every piece when there is a gap', () => {
    expect(gridCuts(10, 3, 50, 4)).toEqual([10, 60, 64, 114, 118, 168]);
  });
  it('neighbours share one cut when there is no gap', () => {
    expect(gridCuts(10, 3, 50, 0)).toEqual([10, 60, 110, 160]);
  });
  it('verticals right to left starting upwards, then horizontals from the side the verticals ended on', () => {
    const frame = { fx0: 0, fy0: 0, fx1: 100, fy1: 200 };
    // three verticals end at the top: horizontals go top to bottom, the first left to right
    let g = gridLines({ ...frame, cutsX: [10, 50, 90], cutsY: [20, 180] });
    expect(g.v).toEqual([[[90, 200], [90, 0]], [[50, 0], [50, 200]], [[10, 200], [10, 0]]]);
    expect(g.h).toEqual([[[0, 20], [100, 20]], [[100, 180], [0, 180]]]);
    // two verticals end at the bottom: horizontals go bottom to top
    g = gridLines({ ...frame, cutsX: [10, 90], cutsY: [20, 180] });
    expect(g.h.map(l => l[0][1])).toEqual([180, 20]);
  });
});
