import { describe, it, expect } from 'vitest';
import { copiesFromName, packRoll } from '../../src/core/rollpack.js';

const overlap = (a, b, g) => a.x < b.x + b.w + g - 1e-9 && b.x < a.x + a.w + g - 1e-9 && a.y < b.y + b.h + g - 1e-9 && b.y < a.y + a.h + g - 1e-9;
const items = () => [
  ...Array.from({ length: 3 }, (_, i) => ({ id: `sign${i}`, w: 307, h: 382 })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: `small${i}`, w: 206, h: 306 })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `label${i}`, w: 256, h: 66 })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: `banner${i}`, w: 1006, h: 126 }))
];

describe('packRoll', () => {
  it('places everything across the width, gap between pieces, no overlaps, short', () => {
    const { sheets, tooBig } = packRoll(items(), { width: 1330, gap: 2 });
    expect(tooBig).toEqual([]);
    expect(sheets).toHaveLength(1);
    const P = sheets[0].places;
    expect(P).toHaveLength(17);
    for (const p of P) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + p.w).toBeLessThanOrEqual(1330 + 1e-9); expect(p.y).toBeGreaterThanOrEqual(0); }
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) expect(overlap(P[i], P[j], 2)).toBe(false);
    // the area of the pieces is 17 % of a 1330 x 1000 sheet: the roll used stays well under 1 m
    expect(sheets[0].length).toBeLessThan(800);
    // turned pieces keep their size, only swapped
    for (const p of P.filter(q => q.id.startsWith('sign'))) expect([p.w, p.h].sort()).toEqual([307, 382]);
  });
  it('turns a piece only when allowed, and reports what fits nowhere', () => {
    expect(packRoll([{ id: 'a', w: 500, h: 200 }], { width: 300, rotate: false }).tooBig).toEqual(['a']);
    const r = packRoll([{ id: 'a', w: 500, h: 200 }], { width: 300 });
    expect(r.sheets[0].places[0]).toMatchObject({ rot: true, w: 200, h: 500 });
  });
  it('splits into sheets of at most maxLength', () => {
    const { sheets } = packRoll(Array.from({ length: 6 }, (_, i) => ({ id: i, w: 100, h: 100 })), { width: 100, gap: 0, maxLength: 250 });
    expect(sheets.map(s => s.places.length)).toEqual([2, 2, 2]);
    for (const s of sheets) expect(s.length).toBeLessThanOrEqual(250);
  });
});

describe('copiesFromName', () => {
  it('reads the number of copies, not the size', () => {
    expect(copiesFromName('stanowisko_nr3_1000x120mm_2szt.pdf')).toBe(2);
    expect(copiesFromName('zakaz_ogloszen_250x60mm_10szt.pdf')).toBe(10);
    expect(copiesFromName('label 80x30 4 pcs.pdf')).toBe(4);
    expect(copiesFromName('sign_301x376mm.pdf')).toBe(1);
  });
});
