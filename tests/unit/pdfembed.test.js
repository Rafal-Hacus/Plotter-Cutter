import { describe, expect, it } from 'vitest';
import * as PDFLib from 'pdf-lib';
import { embedPages } from '../../src/core/pdfembed.js';

describe('embedPages', () => {
  it('keeps a page whose media box does not start at 0,0 whole, moved to start at the origin', async () => {
    const src = await PDFLib.PDFDocument.create(), pg = src.addPage([300, 420]);
    pg.setMediaBox(0, 7.71, 297.75, 419.25); // as Canva writes it
    pg.drawRectangle({ x: 0, y: 7.71, width: 297.75, height: 419.25 });
    const doc = await PDFLib.PDFDocument.load(await src.save()), out = await PDFLib.PDFDocument.create();
    const [e] = await embedPages(out, doc, [0]);
    expect(e.width).toBeCloseTo(297.75);
    expect(e.height).toBeCloseTo(419.25);
    await out.save(); // (the form is written on save)
    const form = out.context.lookup(e.ref), nums = k => form.dict.get(PDFLib.PDFName.of(k)).asArray().map(n => n.asNumber());
    expect(nums('BBox')).toEqual([0, 7.71, 297.75, 426.96].map(v => expect.closeTo(v, 5)));
    expect(nums('Matrix')).toEqual([1, 0, 0, 1, 0, -7.71].map(v => expect.closeTo(v, 5)));
  });
});
