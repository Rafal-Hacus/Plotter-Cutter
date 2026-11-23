import { test, expect } from '@playwright/test';
import { download, mode, noProblems, openApp, setField } from './helpers.js';
import { isBlue, isRed, pdfColours, turnedPdf } from './pdfpixels.js';

test('print sheets: a PDF page turned by /Rotate is placed the way it is seen, media box off 0,0 too', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'gang');
  // A5 with 2 mm bleed, filled; the page seen is 148 x 210 + 3 mm bleed: upright on an upright slot, nothing turned
  await setField(page, 'ggFormat', 'A5'); await setField(page, 'ggBleed', 2); await setField(page, 'ggFit', 'fill');
  const files = [];
  for (const rot of [0, 90, 180, 270]) files.push({ name: `turned${rot}.pdf`, mimeType: 'application/pdf', buffer: await turnedPdf(148, 210, rot, { ox: 20, oy: 35 }) });
  await page.setInputFiles('#gangFile', files);
  await expect(page.locator('#count')).toContainText('4 prints on 1 sheet');
  await expect(page.locator('#msg')).toContainText('4 per sheet (2 × 2)');
  // where the slots' trims start: the cut positions in the message
  const msg = await page.locator('#msg').textContent();
  const xs = msg.match(/left edge: ([\d., ]+) mm/)[1].split(', ').map(Number), ys = msg.match(/top: ([\d., ]+) mm/)[1].split(', ').map(Number);
  const trims = [[xs[0], ys[0]], [xs[2], ys[0]], [xs[0], ys[2]], [xs[2], ys[2]]];
  // the page with its bleed (154 x 216) covers the slot with bleed (152 x 214) at scale ~0.99, centred: each square
  // lands about where it is in the file, 5..25 mm in from the trim's corners
  const pdf = await download(page, 'exGang');
  const colours = await pdfColours(page, pdf, trims.flatMap(([x, y]) => [[x + 15, y + 15], [x + 148 - 15, y + 210 - 15]]));
  for (let i = 0; i < 4; i++) {
    expect(isRed(colours[2 * i]), `print ${i} top left ${colours[2 * i]}`).toBe(true);
    expect(isBlue(colours[2 * i + 1]), `print ${i} bottom right ${colours[2 * i + 1]}`).toBe(true);
  }
  // the preview draws it the same way: not turned
  for (const t of await page.locator('#stage image').evaluateAll(ims => ims.map(im => im.getAttribute('transform')))) expect(t).toMatch(/^matrix\([\d.]+,0,0,[\d.]+,/);
  noProblems(problems);
});
