// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseSvg, readViewBox, svgGenerator, svgRealSize } from '../../src/core/svg.js';

const size = text => { const root = parseSvg(text).documentElement; return svgRealSize(root, readViewBox(root), text); };
const NS = 'xmlns="http://www.w3.org/2000/svg"';
// 120 × 80 mm in each program's px
const AI = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 24.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<svg version="1.1" id="Layer_1" ${NS} x="0px" y="0px" width="340.157px" height="226.772px" viewBox="0 0 340.157 226.772"><rect width="10" height="10"/></svg>`;
const INK = `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1.3 (0e150ed6c4, 2023-07-21)" width="453.543" height="302.362" viewBox="0 0 453.543 302.362"><rect width="10" height="10"/></svg>`;

describe('svgGenerator', () => {
  it('knows Illustrator by its comment, its namespaces or its root attributes', () => {
    expect(svgGenerator(AI)).toMatchObject({ name: 'Illustrator', dpi: 72, sure: true });
    expect(svgGenerator(`<svg ${NS} x="0px" y="0px" viewBox="0 0 1 1"/>`)).toMatchObject({ name: 'Illustrator', dpi: 72 });
    expect(svgGenerator(`<svg id="Layer_1" data-name="Layer 1" ${NS} viewBox="0 0 1 1"/>`)).toMatchObject({ name: 'Illustrator', dpi: 72 });
    expect(svgGenerator(`<!DOCTYPE svg [<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">]><svg ${NS} xmlns:i="&ns_ai;"/>`)).toMatchObject({ name: 'Illustrator' });
  });
  it('Inkscape: 96 per inch, 90 before 0.92; unknown without a version', () => {
    expect(svgGenerator(INK)).toEqual({ name: 'Inkscape', dpi: 96, sure: true });
    expect(svgGenerator('<svg inkscape:version="0.91 r13725">')).toEqual({ name: 'Inkscape', dpi: 90, sure: true });
    expect(svgGenerator('<svg xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">')).toEqual({ name: 'Inkscape', dpi: 96, sure: false });
  });
  it('Affinity 72 (a guess: its export can be set), anything else 96 (a guess)', () => {
    expect(svgGenerator(`<svg ${NS} xmlns:serif="http://www.serif.com/">`)).toEqual({ name: 'Affinity', dpi: 72, sure: false });
    expect(svgGenerator(`<svg ${NS} xmlns:affinity="https://www.affinity.studio/">`)).toEqual({ name: 'Affinity', dpi: 72, sure: false });
    expect(svgGenerator(`<svg ${NS} width="100" height="100">`)).toEqual({ name: null, dpi: 96, sure: false });
  });
});

describe('svgRealSize', () => {
  it('physical units as given, no note', () => {
    const r = size(`<svg ${NS} width="300mm" height="42cm" viewBox="0 0 3 4.2"/>`);
    expect(r.wMm).toBeCloseTo(300, 6); expect(r.hMm).toBeCloseTo(420, 6);
    expect(r).toMatchObject({ ok: true, guessed: false, note: null, dpi: null });
    expect(size(`<svg ${NS} width="2in" height="72pt" viewBox="0 0 2 1"/>`)).toMatchObject({ wMm: 50.8, hMm: 25.4 });
  });
  it('Illustrator px at 72 dpi: a 120 mm file is 120 mm (not 50)', () => {
    const r = size(AI);
    expect(r.hMm).toBeCloseTo(80, 2); expect(r.wMm).toBeCloseTo(120, 2);
    expect(r).toMatchObject({ ok: true, guessed: false, dpi: 72, generator: 'Illustrator' });
    expect(r.note).toBe('size read from px at 72 dpi (Illustrator file)');
  });
  it('Inkscape px at 96 dpi', () => {
    const r = size(INK);
    expect(r.wMm).toBeCloseTo(120, 2); expect(r.hMm).toBeCloseTo(80, 2);
    expect(r).toMatchObject({ ok: true, guessed: false, dpi: 96 });
  });
  it('px from an unknown program: 96 dpi, and said to be a guess', () => {
    const r = size(`<svg ${NS} width="453.543px" height="302.362px" viewBox="0 0 10 10"/>`);
    expect(r.hMm).toBeCloseTo(80, 2);
    expect(r).toMatchObject({ ok: true, guessed: true, note: 'size guessed from px at 96 dpi: check' });
  });
  it('no width and height (or %): the viewBox, read the same way', () => {
    const r = size(`<svg id="Layer_1" data-name="Layer 1" ${NS} viewBox="0 0 340.157 226.772"/>`);
    expect(r.wMm).toBeCloseTo(120, 2);
    expect(r.note).toBe('size read from the viewBox (no size in the file) at 72 dpi (Illustrator file)');
    const p = size(`<svg ${NS} width="100%" height="100%" viewBox="0 0 96 48"/>`);
    expect(p).toMatchObject({ wMm: 25.4, hMm: 12.7, guessed: true });
  });
  it('one side in mm: the other from the viewBox shape', () => {
    const r = size(`<svg ${NS} height="40mm" viewBox="0 0 30 20"/>`);
    expect(r).toMatchObject({ hMm: 40, wMm: 60, note: null });
  });
  it('absurd sizes and no size at all are not ok', () => {
    expect(size(`<svg ${NS} width="6000mm" height="6000mm" viewBox="0 0 1 1"/>`).ok).toBe(false);
    expect(size(`<svg ${NS} width="0.1mm" height="0.1mm" viewBox="0 0 1 1"/>`).ok).toBe(false);
    expect(size(`<svg ${NS}><rect width="5" height="5"/></svg>`)).toMatchObject({ ok: false, wMm: null });
  });
});
