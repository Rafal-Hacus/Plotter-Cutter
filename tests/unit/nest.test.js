import { describe, it, expect } from 'vitest';
import { makeMask, rotBits } from '../../src/core/geometry.js';
import { nestAll } from '../../src/nest.js';

const rect = (w, h) => {
  const bits = new Uint8Array(w * h).fill(1), masks = {};
  for (const r of [0, 90, 180, 270]) { const rb = rotBits(bits, w, h, r); masks[r] = makeMask(rb.bits, rb.w, rb.h); }
  return masks;
};
const sheetOf = (W, H) => ({ Gw: W, Gh: H, blocked: new Uint8Array(W * H), free: { x0: 0, y0: 0, x1: W - 1, y1: H - 1 } });
const design = (id, w, h, qty) => ({ id, qty, res: { masks: rect(w, h) } });
const nest = (list, sheet) => nestAll(list, sheet, { rotate: true }, () => false);
const noOverlap = (lay, sheet) => {
  const occ = new Uint8Array(sheet.Gw * sheet.Gh);
  for (const it of lay.items) {
    const m = it.d.res.masks[it.rot];
    for (let r = 0; r < m.h; r++) for (let k = 0; k < m.rows[r].length; k += 2) for (let x = m.rows[r][k]; x <= m.rows[r][k + 1]; x++) {
      const i = (it.Y + r) * sheet.Gw + it.X + x;
      expect(it.X + x).toBeLessThan(sheet.Gw); expect(occ[i]).toBe(0); occ[i] = 1;
    }
  }
};

// sheets where the greedy fill finds one fewer than a block upright beside a block turned
const CASES = [[13, 8, 5, 3], [10, 7, 3, 2], [16, 11, 5, 3]];
describe('typed copies nest as densely as Fill', () => {
  for (const [W, H, w, h] of CASES) {
    it(`${w}x${h} on ${W}x${H}: typed copies reach the Fill count and stop at N`, async () => {
      const sheet = sheetOf(W, H);
      const fill = (await nest([design(1, w, h, null)], sheet)).items.length;
      for (const n of [fill, fill + 1, 99]) {
        const lay = await nest([design(1, w, h, n)], sheet);
        expect(lay.items.length).toBe(Math.min(n, fill));
        noOverlap(lay, sheet);
      }
      for (const n of [1, 2, fill - 1]) expect((await nest([design(1, w, h, n)], sheet)).items.length).toBe(n);
    });
  }
  it('Fill layouts are unchanged (the wino case: 6 per sheet)', async () => {
    const lay = await nest([design(1, 5, 3, null)], sheetOf(13, 8));
    expect(lay.items.length).toBe(6);
    expect(lay.counts.get(1)).toBe(6);
  });
  it('several typed designs: no fewer in total than before, each at most its copies', async () => {
    const sheet = sheetOf(16, 11);
    const lay = await nest([design(1, 5, 3, 6), design(2, 5, 3, 99)], sheet);
    expect(lay.counts.get(1)).toBeLessThanOrEqual(6);
    expect(lay.counts.get(1) + lay.counts.get(2)).toBe(11); // = the fill of one 5x3 design on this sheet
    noOverlap(lay, sheet);
  });
});
