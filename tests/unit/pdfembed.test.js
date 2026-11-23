import { describe, expect, it } from 'vitest';
import * as PDFLib from 'pdf-lib';
import { embedPages, pageGeom, shownMatrix } from '../../src/core/pdfembed.js';
import { apply } from '../../src/core/matrix.js';

const PT = 72 / 25.4;

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

describe('pageGeom', () => {
  const page = async setup => { const d = await PDFLib.PDFDocument.create(), p = d.addPage([300, 200]); setup(p); return (await PDFLib.PDFDocument.load(await d.save())).getPage(0); };
  it('a plain page: the media box, no bleed', async () => {
    const g = pageGeom(await page(() => {}));
    expect(g).toMatchObject({ box: { x: 0, y: 0, width: 300, height: 200 }, rot: 0, w: 300, h: 200, bleed: null });
  });
  it('a file exported with marks: the bleed box, not the media box with the slug', async () => {
    const g = pageGeom(await page(p => { p.setBleedBox(20, 20, 260, 160); p.setTrimBox(20 + 2 * PT, 20 + 2 * PT, 260 - 4 * PT, 160 - 4 * PT); }));
    expect(g.bleed).toBe(2);
    expect(g.box.x).toBeCloseTo(20); expect(g.box.width).toBeCloseTo(260); expect(g.box.height).toBeCloseTo(160);
  });
  it('a trim box off centre: the trim plus the narrowest bleed, so the trim is in the middle', async () => {
    const g = pageGeom(await page(p => p.setTrimBox(3 * PT, 1 * PT, 300 - 6 * PT, 200 - 4 * PT)));
    expect(g.bleed).toBe(1);
    expect(g.box.x).toBeCloseTo(2 * PT); expect(g.box.y).toBeCloseTo(0); expect(g.box.width).toBeCloseTo(300 - 4 * PT); expect(g.box.height).toBeCloseTo(200 - 2 * PT);
  });
  it('a crop box smaller than the media box is what is printed (as a viewer shows it)', async () => {
    const g = pageGeom(await page(p => p.setCropBox(10, 10, 100, 50)));
    expect(g.box).toEqual({ x: 10, y: 10, width: 100, height: 50 });
  });
  it('/Rotate: the size as shown, and a matrix that turns the page clockwise', async () => {
    for (const [rot, ll] of [[90, [0, 300]], [180, [300, 200]], [270, [200, 0]]]) {
      const g = pageGeom(await page(p => p.setRotation(PDFLib.degrees(rot))));
      expect(g.rot).toBe(rot);
      expect([g.w, g.h]).toEqual(rot === 180 ? [300, 200] : [200, 300]);
      // the page's lower left corner, turned clockwise: top left (90), top right (180), lower right (270)
      expect(apply(shownMatrix(g), [0, 0])).toEqual(ll);
    }
  });
});
