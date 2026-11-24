// @vitest-environment jsdom
// The guillotine layout keeps room for full-length crop marks when that costs no copies (or when asked to).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let L, state;
beforeAll(async () => {
  // the layout reads the sheet size and a few fields from the page
  document.body.innerHTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../index.html'), 'utf8').replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  L = await import('../../src/modes/cards/layout.js');
  ({ state } = await import('../../src/state.js'));
  state.mode = 'guillotine';
});
// 310 × 440 sheet, 3 mm unprintable edge, 5 mm marks 3 mm from the cut: full marks need 3 + 3 + 5 = 11 mm past the trim
const opts = over => ({ cBleed: 3, gAuto: true, gSqueeze: true, gGap: 4, gMargin: 3, gMarkOff: 3, gMarkLen: 5, gMarkRoom: false, gSize: 'orig', ...over });
const layout = (w, h, o) => { const job = { bytes: new Uint8Array(1), pageW: w, pageH: h }; state.job = job; return L.computeCardLayout(null, o, job); };
const markLengths = (lay, o) => L.cropMarks(lay, o).map(m => Math.hypot(m[2] - m[0], m[3] - m[1]));

describe('guillotine room for crop marks', () => {
  it('is kept when the same number of copies still fits: every mark full length and inside the printable area', () => {
    const o = opts({ cBleed: 2 }), lay = layout(104, 154, o); // 100 × 150 + 2 mm bleed: 4 up either way
    expect(lay.n).toBe(4);
    expect(lay.marks).toEqual({ reserved: true, nRoom: 4, nTight: 4 });
    const lens = markLengths(lay, o);
    expect(lens.length).toBeGreaterThan(0);
    for (const len of lens) expect(len).toBeCloseTo(5, 6);
    for (const m of L.cropMarks(lay, o)) for (const v of [m[0], m[2]]) expect(v).toBeGreaterThanOrEqual(3 - 1e-9), expect(v).toBeLessThanOrEqual(307 + 1e-9);
    for (const m of L.cropMarks(lay, o)) for (const v of [m[1], m[3]]) expect(v).toBeGreaterThanOrEqual(3 - 1e-9), expect(v).toBeLessThanOrEqual(437 + 1e-9);
    expect(L.shortMarksNote(lay, o)).toBe('');
  });
  it('is not kept when it would cost copies: the copies stay, and the note says how many full marks would leave', () => {
    const o = opts(), lay = layout(96, 56, o); // 90 × 50 + 3 mm bleed
    expect(lay.n).toBe(24);
    expect(lay.marks.reserved).toBe(false);
    expect(lay.marks.nRoom).toBeLessThan(24);
    expect(L.shortMarksNote(lay, o)).toMatch(new RegExp(`^Room for full crop marks would fit ${lay.marks.nRoom} instead of 24: marks at the top and bottom are not printed \\(full length 5 mm\\)`));
  });
  it('names the sides and how long their marks are when some room is left', () => {
    const o = opts({ gMargin: 2 }), lay = layout(96, 56, o);
    expect(lay.n).toBe(24);
    expect(L.shortMarksNote(lay, o)).toContain('Room for full crop marks would fit 21 instead of 24: marks at the top and bottom are 1 mm (full length 5 mm).');
  });
  it('is kept anyway with “Always leave room for crop marks”: fewer copies, full marks, no note', () => {
    const o = opts({ gMarkRoom: true }), tight = layout(96, 56, opts()), lay = layout(96, 56, o);
    expect(lay.n).toBe(tight.marks.nRoom);
    expect(lay.marks.reserved).toBe(true);
    for (const len of markLengths(lay, o)) expect(len).toBeCloseTo(5, 6);
    expect(L.shortMarksNote(lay, o)).toBe('');
  });
});
