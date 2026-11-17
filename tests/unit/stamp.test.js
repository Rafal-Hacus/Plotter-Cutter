import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { bbox, buildStamp, convexHull, offset, union } from '../../src/core/stamp.js';
import { textOutlines } from '../../src/core/stamptext.js';

const font = fontkit.create(readFileSync('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf'));
const LINES = ['Firma Przykład', 'ul. Długa 1, 00-001 Warszawa', 'NIP 123-456-78-90', 'tel. 600 000 000'];
const area = rings => rings.reduce((a, r) => a + r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2, 0);
const inside = (p, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };

describe('textOutlines', () => {
  it('sets every line, Polish letters included, centred one under the other', () => {
    const rings = textOutlines(font, ['Żółw', 'ąę']);
    const b = bbox(rings);
    expect(rings.length).toBeGreaterThan(8);
    expect(b.h).toBeGreaterThan(1.5); // two lines (em units)
  });
});

describe('buildStamp', () => {
  const art = textOutlines(font, LINES);
  it('fits the text to the size, proportions kept, with 2.3 mm at the sides and 0.8 mm top and bottom', () => {
    const s = buildStamp(art, 48, 19);
    const a = bbox(s.art), c = bbox([s.cut]), raw = bbox(union(art));
    // not stretched: the same proportions as set
    expect(a.w / a.h).toBeCloseTo(raw.w / raw.h, 3); // (points finer than 0.005 mm are dropped)
    // the limiting side touches the margins exactly, the other one stays inside them
    const tight = Math.min((48 - 4.6) / a.w, (19 - 1.6) / a.h);
    expect(tight).toBeCloseTo(1, 6);
    expect(a.w).toBeLessThanOrEqual(48 - 4.6 + 1e-6); expect(a.h).toBeLessThanOrEqual(19 - 1.6 + 1e-6);
    // the cut is exactly the stamp size (here the text fills the width, the cut is stretched to the height too)
    expect([c.x0, c.y0, c.x1, c.y1].map(v => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 48, 19]);
    // the top and bottom are straight: an edge along y = 0 and one along y = H
    const along = y => s.cut.filter(p => Math.abs(p[1] - y) < 1e-6).length;
    expect(along(0)).toBe(2); expect(along(19)).toBe(2);
    // straight edges, sharp corners: few points
    expect(s.cut.length).toBeLessThan(20);
    // every letter inside the cut
    for (const r of s.art) for (const p of r) expect(inside(p, s.cut)).toBe(true);
  });
  it('height-limited text: the cut is still the full stamp size, straight at the top and bottom', () => {
    const tall = textOutlines(font, ['A', 'B', 'C', 'D', 'E']), s = buildStamp(tall, 48, 19), c = bbox([s.cut]), a = bbox(s.art);
    expect(a.h).toBeCloseTo(19 - 1.6, 6); expect(a.w).toBeLessThan(10); // limited by the height
    expect([c.w, c.h].map(v => Math.round(v * 1e6) / 1e6)).toEqual([48, 19]);
    expect(s.cut.filter(p => Math.abs(p[1]) < 1e-6)).toHaveLength(2);
    for (const r of s.art) for (const p of r) expect(inside(p, s.cut)).toBe(true);
  });
  it('rows: shapes at overlapping heights are one row (a line of text), lines apart are rows of their own', async () => {
    const { rowBoxes } = await import('../../src/core/stamp.js');
    const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    expect(rowBoxes([sq(0, 0, 1, 2), sq(3, 0.5, 1, 2), sq(0, 4, 5, 1.5)])).toEqual([{ x0: 0, y0: 0, x1: 4, y1: 2.5 }, { x0: 0, y0: 4, x1: 5, y1: 5.5 }]);
    // the dot of a Ż and the accent of an Ś above a line join it: one row, the line's full width
    expect(rowBoxes([sq(2, -0.6, 0.3, 0.3), sq(6, -0.7, 0.4, 0.3), sq(0, 0, 9, 2)])).toEqual([{ x0: 0, y0: -0.7, x1: 9, y1: 2 }]);
  });
  it('engraving layers: blue = cut shape less the letters; red = cut grown 0.8 mm less the letters grown 0.2 mm', () => {
    const s = buildStamp(art, 48, 19), c = bbox([s.cut]);
    expect(s.blue[0]).toBe(s.cut);
    expect(s.blue.length).toBe(1 + s.art.length);
    const outer = s.red.reduce((best, r) => (Math.abs(area([r])) > Math.abs(area([best])) ? r : best));
    const o = bbox([outer]);
    expect(o.x0).toBeCloseTo(c.x0 - 0.8, 2); expect(o.y1).toBeCloseTo(c.y1 + 0.8, 2);
    const letters = bbox(s.red.filter(r => r !== outer)), a = bbox(s.art);
    expect(letters.x0).toBeCloseTo(a.x0 - 0.2, 2); expect(letters.y0).toBeCloseTo(a.y0 - 0.2, 2); expect(letters.x1).toBeCloseTo(a.x1 + 0.2, 2);
  });
  it('rectangle and rounded rectangle cuts are the size itself', () => {
    expect(bbox([buildStamp(art, 59, 25, { shape: 'rect' }).cut])).toMatchObject({ x0: 0, y0: 0, x1: 59, y1: 25 });
    const r = bbox([buildStamp(art, 59, 25, { shape: 'round', radius: 3 }).cut]);
    expect(r.w).toBeCloseTo(59, 6); expect(r.h).toBeCloseTo(25, 6);
  });
  it('text scale: the text smaller than it fits, the cut still the stamp size', () => {
    const full = bbox(buildStamp(art, 48, 19).art), s = buildStamp(art, 48, 19, { scale: 0.8 }), a = bbox(s.art);
    expect(a.w).toBeCloseTo(full.w * 0.8, 2);
    expect(bbox([s.cut])).toMatchObject({ w: expect.closeTo(48, 3), h: expect.closeTo(19, 3) });
  });
  it('a small stamp with big distances to the cut: the distances shrink, the text still fits', () => {
    const s = buildStamp(art, 20, 6, { marginX: 15, marginY: 4 }), a = bbox(s.art);
    expect(a.w).toBeGreaterThan(0); expect(a.w).toBeLessThanOrEqual(20); expect(a.h).toBeLessThanOrEqual(6);
  });
  it('rejects an empty stamp', () => { expect(() => buildStamp([], 48, 19)).toThrow(/empty/); });
});

describe('geometry helpers', () => {
  it('hull, offset and union', () => {
    expect(convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]])).toHaveLength(4);
    const g = bbox(offset([[[0, 0], [10, 0], [10, 10], [0, 10]]], 1, 'miter'));
    expect(g).toMatchObject({ x0: -1, y0: -1, x1: 11, y1: 11 });
    expect(union([[[0, 0], [2, 0], [2, 2], [0, 2]], [[1, 1], [3, 1], [3, 3], [1, 3]]])).toHaveLength(1);
  });
});

describe('richOutlines', () => {
  const regular = fontkit.create(readFileSync('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
  const boldF = fontkit.create(readFileSync('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf'));
  const line = (runs, extra = {}) => ({ align: 'center', size: 1, runs, ...extra });
  it('uses the bold face for bold runs, and makes one up (thicker, wider) when the family has none', async () => {
    const { richOutlines } = await import('../../src/core/stamptext.js');
    const real = bbox(richOutlines([line([{ text: 'Stempel', bold: true }])], b => ({ font: b ? boldF : regular })));
    const plain = bbox(richOutlines([line([{ text: 'Stempel' }])], () => ({ font: regular })));
    const faux = bbox(richOutlines([line([{ text: 'Stempel', bold: true }])], b => ({ font: regular, fauxBold: b })));
    expect(real.w).toBeGreaterThan(plain.w);
    expect(faux.w).toBeGreaterThan(plain.w);
  });
  it('slants a made-up italic, underlines, and sizes each line', async () => {
    const { richOutlines } = await import('../../src/core/stamptext.js');
    const one = r => bbox(richOutlines([line([{ text: 'I', ...r }])], (b, i) => ({ font: regular, fauxItalic: i })));
    const up = one({}), it_ = one({ italic: true });
    expect(it_.x1 - it_.x0).toBeGreaterThan(up.x1 - up.x0); // the top of the I leans right
    const u = one({ underline: true });
    expect(u.y1).toBeGreaterThan(up.y1); // a line under the baseline
    const two = richOutlines([line([{ text: 'Duży' }], { size: 2 }), line([{ text: 'Duży' }])], () => ({ font: regular }));
    const single = bbox(richOutlines([line([{ text: 'Duży' }])], () => ({ font: regular })));
    expect(bbox(two).w).toBeCloseTo(2 * single.w, 3); // the line at size 2 is twice as wide, and the widest
  });
});
