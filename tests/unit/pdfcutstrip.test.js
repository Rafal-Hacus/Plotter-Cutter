import { describe, expect, it } from 'vitest';
import * as PDFLib from 'pdf-lib';
import { stripCutColour, stripCutStrokes } from '../../src/core/pdfcutstrip.js';

const enc = s => new TextEncoder().encode(s), dec = b => new TextDecoder().decode(b);

describe('stripCutStrokes', () => {
  it('drops only the strokes in the cut colour', () => {
    const src = 'q 0 0 1 RG 0 0 m 10 0 l S Q\n/CutContour CS 1 SCN .25 w n 0 0 m 5 5 l h S\n0 G 1 1 m 2 2 l S';
    const r = stripCutStrokes(enc(src), n => n === 'CutContour');
    expect(r.removed).toBe(1);
    expect(dec(r.bytes)).toBe('q 0 0 1 RG 0 0 m 10 0 l S Q\n/CutContour CS 1 SCN .25 w n 0 0 m 5 5 l h n\n0 G 1 1 m 2 2 l S');
  });
  it('keeps the fill of fill-and-stroke, follows q/Q, and skips strings and inline images', () => {
    const src = 'q /C1 CS 0 0 m 1 1 l b Q 0 0 m 1 1 l S (a S b) Tj BI /W 1 ID xS\nEI /C1 CS 0 0 m B*';
    const r = stripCutStrokes(enc(src), n => n === 'C1');
    expect(dec(r.bytes)).toBe('q /C1 CS 0 0 m 1 1 l f Q 0 0 m 1 1 l S (a S b) Tj BI /W 1 ID xS\nEI /C1 CS 0 0 m f*');
  });
  it('leaves content without a cut colour as it is', () => {
    const b = enc('0 0 m 1 1 l S');
    expect(stripCutStrokes(b, () => false)).toEqual({ bytes: b, removed: 0 });
  });
});

describe('stripCutColour', () => {
  it('takes a CutContour separation out of the page', async () => {
    const doc = await PDFLib.PDFDocument.create(), page = doc.addPage([200, 200]), ctx = doc.context;
    const fn = ctx.register(ctx.flateStream('{0 exch 0 0}', { FunctionType: 4, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1, 0, 1] }));
    const sep = ctx.obj([PDFLib.PDFName.of('Separation'), PDFLib.PDFName.of('CutContour'), PDFLib.PDFName.of('DeviceCMYK'), fn]);
    page.node.set(PDFLib.PDFName.of('Resources'), ctx.obj({ ColorSpace: { CS0: sep } }));
    page.node.set(PDFLib.PDFName.of('Contents'), ctx.register(ctx.flateStream('1 0 0 rg 0 0 50 50 re f\n/CS0 CS 1 SCN 10 10 m 190 10 l 190 190 l h S')));
    const bytes = await doc.save();
    const r = await stripCutColour(PDFLib, bytes, /cut/i);
    expect(r.removed).toBe(1);
    const back = await PDFLib.PDFDocument.load(r.bytes), c = back.getPages()[0].node.Contents();
    const text = dec(PDFLib.decodePDFRawStream(c).decode());
    expect(text).toContain('0 0 50 50 re f');
    expect(text).toMatch(/h n\s*$/);
    expect((await stripCutColour(PDFLib, bytes, /nothing/)).removed).toBe(0);
  });
});
