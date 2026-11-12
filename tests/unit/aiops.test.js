import { describe, it, expect } from 'vitest';
import { image, mirrorPad, nearFill, steady, calmFlat, fillTiles, extendGrow, backProject, boxError, boxBlur } from '../../src/core/aiops.js';

const rnd = (w, h, seed = 1) => { const im = image(w, h); let s = seed; for (let i = 0; i < im.rgb.length; i++) { s = (s * 16807) % 2147483647; im.rgb[i] = s % 256; } return im; };
// a stand-in model: paints holes in a marker colour and records what it was given
function fakeModel() {
  const calls = [];
  const run = async (rgb, mask, w, h) => {
    calls.push({ w, h, holes: mask.reduce((n, k) => n + (k ? 0 : 1), 0) });
    const out = rgb.slice();
    for (let i = 0; i < w * h; i++) if (!mask[i]) for (let c = 0; c < 3; c++) out[i * 3 + c] = 77; // a marker colour
    return out;
  };
  return { run, calls };
}

describe('mirrorPad', () => {
  it('reflects like numpy symmetric padding, also past the image size', () => {
    const im = image(3, 1, Uint8Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3]));
    const p = mirrorPad(im, 4);
    expect(Array.from({ length: p.w }, (_, x) => p.rgb[(4 * p.w + x) * 3] ?? p.rgb[x * 3]).slice(0, 11)).toEqual([3, 3, 2, 1, 1, 2, 3, 3, 2, 1, 1]); // numpy.pad([1, 2, 3], 4, 'symmetric')
  });
});

describe('fillTiles', () => {
  it('fills every hole, never changes known pixels, and runs only tiles with holes', async () => {
    const im = rnd(1200, 700), before = im.rgb.slice(), known = new Uint8Array(1200 * 700).fill(1);
    for (let y = 300; y < 340; y++) for (let x = 0; x < 1200; x++) known[y * 1200 + x] = 0; // a band across
    const m = fakeModel();
    await fillTiles(im, known, m.run);
    expect(known.every(Boolean)).toBe(true);
    let wrong = 0;
    for (let i = 0; i < 1200 * 700; i++) {
      const band = Math.floor(i / 1200) >= 300 && Math.floor(i / 1200) < 340;
      if (band ? im.rgb[i * 3] !== 77 : im.rgb[i * 3] !== before[i * 3]) wrong++;
    }
    expect(wrong).toBe(0);
    expect(m.calls.every(c => c.w <= 512 && c.h <= 512 && c.holes > 0)).toBe(true);
  });
});

describe('nearFill', () => {
  it('gives the hole next to the picture the picture\'s colour, a few pixels deep (no dark line along the fill)', () => {
    const t = image(20, 1), mask = new Uint8Array(20);
    for (let x = 0; x < 10; x++) { mask[x] = 1; t.rgb.set([200, 100, 50], x * 3); }
    nearFill(t, mask, 6);
    expect(Array.from({ length: 20 }, (_, x) => t.rgb[x * 3])).toEqual([...Array(16).fill(200), 0, 0, 0, 0]);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(10); // the mask itself is untouched
  });
});

describe('steady', () => {
  it('keeps what the three runs agree on and drops what only one of them made up', async () => {
    let n = 0;
    const run = async (rgb, mask, w, h) => { const o = rgb.slice(); for (let i = 0; i < w * h; i++) if (!mask[i]) o.fill(77, i * 3, i * 3 + 3); if (n++ === 0) o.fill(250, 0, 3); return o; };
    const out = await steady(run)(new Uint8Array(4 * 3), Uint8Array.from([0, 0, 0, 0]), 2, 2);
    expect(Array.from(out)).toEqual(Array(12).fill(77)); // the 250 from the first run is gone
    expect(n).toBe(3);
  });
});

describe('calmFlat', () => {
  it('keeps a plain border plain, and keeps foreign colours out of a textured one', () => {
    const plain = image(40, 40); for (let i = 0; i < 1600; i++) plain.rgb.set([0, 90, 177], i * 3);
    const out = image(60, 60); for (let i = 0; i < 3600; i++) out.rgb.set([200, 30, 30], i * 3); // the AI's junk
    calmFlat(out, plain, 10, 10);
    expect(Array.from(out.rgb.subarray(0, 3))).toEqual([0, 90, 177]);
    expect(Array.from(out.rgb.subarray((59 * 60 + 30) * 3, (59 * 60 + 30) * 3 + 3))).toEqual([0, 90, 177]);
    // a textured edge (stripes of two greens): the fill keeps its texture but only within the greens' colours
    const tex = image(40, 40); for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) tex.rgb.set(x % 4 < 2 ? [40, 120, 40] : [90, 170, 60], (y * 40 + x) * 3);
    const o2 = image(60, 60); for (let i = 0; i < 3600; i++) o2.rgb.set([200, 30, 30], i * 3);
    calmFlat(o2, tex, 10, 10);
    const p = Array.from(o2.rgb.subarray((5 * 60 + 30) * 3, (5 * 60 + 30) * 3 + 3));
    expect(p[0]).toBeLessThanOrEqual(90 + 12); expect(p[1]).toBeGreaterThanOrEqual(120 - 12);
  });
});

describe('extendGrow', () => {
  it('outpaints around a placed picture, keeps the picture pixel for pixel, a band of at most `step` at a time', async () => {
    const src = rnd(300, 300), m = fakeModel();
    const out = await extendGrow(src, 340, 480, 20, 90, m.run, { step: 48 });
    expect(out.w).toBe(340); expect(out.h).toBe(480);
    let changed = 0;
    for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) for (let c = 0; c < 3; c++) if (out.rgb[((y + 90) * 340 + x + 20) * 3 + c] !== src.rgb[(y * 300 + x) * 3 + c]) changed++;
    expect(changed).toBe(0);
    // everything outside the picture was filled by the model
    expect(out.rgb[0]).toBe(77); expect(out.rgb[(479 * 340 + 339) * 3]).toBe(77);
    // at most 48 px of new band per step: the tiles always see known context around the hole
    expect(m.calls.length).toBeGreaterThanOrEqual(2);
  });
  it('a thin bleed is one step', async () => {
    const src = rnd(200, 120), m = fakeModel();
    await extendGrow(src, 224, 144, 12, 12, m.run, { step: 48 });
    expect(m.calls.length).toBe(1);
  });
});

describe('boxBlur', () => {
  it('keeps flat areas and the overall brightness, softens edges', () => {
    const im = image(40, 1); for (let x = 0; x < 40; x++) for (let c = 0; c < 3; c++) im.rgb[x * 3 + c] = x < 20 ? 0 : 200;
    boxBlur(im, 3);
    expect(im.rgb[0]).toBe(0); expect(im.rgb[39 * 3]).toBe(200);
    expect(im.rgb[19 * 3]).toBeGreaterThan(0); expect(im.rgb[20 * 3]).toBeLessThan(200);
  });
});

describe('backProject', () => {
  it('makes an upscale scale back down to exactly the original', () => {
    const inp = rnd(40, 30, 7), s = 2, out = image(80, 60);
    // a poor "AI" result: nearest neighbour plus a brightness shift and noise
    for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) for (let c = 0; c < 3; c++) out.rgb[(y * 80 + x) * 3 + c] = Math.min(255, inp.rgb[((y >> 1) * 40 + (x >> 1)) * 3 + c] + 30 + ((x * 7 + y * 3) % 11));
    expect(boxError(out, inp, s)).toBeGreaterThan(20);
    backProject(out, inp, s, 6);
    expect(boxError(out, inp, s)).toBeLessThan(3);
  });
});
