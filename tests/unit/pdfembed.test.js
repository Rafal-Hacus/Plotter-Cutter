import { describe, expect, it } from 'vitest';
import * as PDFLib from 'pdf-lib';
import { embedPages, pageGeom, pageView, seenBox, shownMatrix } from '../../src/core/pdfembed.js';
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

describe('pageView', () => {
  // a page 200 x 100 pt whose media box starts at 30,40, turned by /Rotate
  const page = async rot => {
    const src = await PDFLib.PDFDocument.create(), pg = src.addPage([200, 100]);
    pg.setMediaBox(30, 40, 200, 100);
    pg.setRotation(PDFLib.degrees(rot));
    return (await PDFLib.PDFDocument.load(await src.save())).getPage(0);
  };
  const at = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]].map(v => Math.round(v * 1000) / 1000 + 0);
  it('gives the size as seen and maps the page the way a viewer turns it (clockwise)', async () => {
    let v = pageView(await page(0));
    expect([v.w, v.h]).toEqual([200, 100]);
    expect(at(v.P, 30, 140)).toEqual([0, 100]); // the top left stays the top left
    expect(v.M).toEqual([1, 0, 0, 1, 0, 0]); // (as before: the form as it is)
    v = pageView(await page(90));
    expect([v.w, v.h]).toEqual([100, 200]);
    // a quarter clockwise: the top left corner goes to the top right, the bottom left to the top left
    expect(at(v.P, 30, 140)).toEqual([100, 200]);
    expect(at(v.P, 30, 40)).toEqual([0, 200]);
    expect(at(v.M, 0, 0)).toEqual([0, 200]); // (the form starts at the media box's corner)
    v = pageView(await page(180));
    expect([v.w, v.h]).toEqual([200, 100]);
    expect(at(v.P, 30, 140)).toEqual([200, 0]);
    v = pageView(await page(270));
    expect([v.w, v.h]).toEqual([100, 200]);
    expect(at(v.P, 30, 140)).toEqual([0, 0]);
    expect(at(v.P, 230, 140)).toEqual([0, 200]);
  });
  it('turns a box of the page', async () => {
    const v = pageView(await page(90));
    // 10 in from the left and 20 up from the bottom of the media box, 50 x 30: seen 20 from the left, 140 up
    expect(seenBox(v, { x: 40, y: 60, w: 50, h: 30 })).toEqual({ x: 20, y: 140, w: 30, h: 50 });
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
