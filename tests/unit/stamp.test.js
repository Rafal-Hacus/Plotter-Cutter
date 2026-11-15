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
    expect(a.w / a.h).toBeCloseTo(raw.w / raw.h, 6);
    // the limiting side touches the margins exactly, the other one stays inside them
    const tight = Math.min((48 - 4.6) / a.w, (19 - 1.6) / a.h);
    expect(tight).toBeCloseTo(1, 6);
    expect(a.w).toBeLessThanOrEqual(48 - 4.6 + 1e-6); expect(a.h).toBeLessThanOrEqual(19 - 1.6 + 1e-6);
    // the cut is the text plus the margins, inside the size, centred
    expect(c.w).toBeCloseTo(a.w + 4.6, 3); expect(c.h).toBeCloseTo(a.h + 1.6, 3);
    expect(c.x0 + c.w / 2).toBeCloseTo(24, 3); expect(c.y0 + c.h / 2).toBeCloseTo(9.5, 3);
    // straight edges, sharp corners: few points
    expect(s.cut.length).toBeLessThan(20);
    // every letter inside the cut
    for (const r of s.art) for (const p of r) expect(inside(p, s.cut)).toBe(true);
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
