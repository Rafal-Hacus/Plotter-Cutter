import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { bbox, cutLayers, download, fixture, mode, noProblems, openApp, setField, unzip } from './helpers.js';
import { isBlue, isRed, pdfColours, turnedPdf } from './pdfpixels.js';

const PT = 72 / 25.4;
// the cut loops of a PLT: each starts with a pen-up move to its first point
const loops = plt => String(plt).split(/\s+/).filter(t => /^U-?\d+,-?\d+$/.test(t)).length - 2; // (less the start arrow and the move off the sheet at the end)

test('roll: PDFs packed on the roll width with marks; copies from the file name; cut along the outline or the rounded trim', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'roll');
  await setField(page, 'rollW', 400);
  await page.setInputFiles('#rollFile', [fixture('sign_100x150mm_3szt.pdf'), fixture('label_80x30mm_4pcs.pdf')]);
  await expect(page.locator('#count')).toContainText('7 pieces');
  const sign = page.locator('#rollList li').nth(0), label = page.locator('#rollList li').nth(1);
  await expect(sign.locator('.rq')).toHaveValue('3');
  await expect(label.locator('.rq')).toHaveValue('4');
  // the sign has an outline drawn in it, the label hasn't
  const outerOff = li => li.locator('.rc option[value="outer"]').evaluate(o => o.disabled);
  expect(await outerOff(sign)).toBe(false);
  expect(await outerOff(label)).toBe(true);
  await sign.locator('.rc').selectOption('outer');
  await expect(sign.locator('.rs')).toContainText('Cut along the outermost line: 99.5 × 149.5 mm.');
  await expect(sign.locator('.rr')).toBeDisabled();
  await label.locator('.rr').fill('3');

  // cut files: 7 loops, sheet as wide as the roll
  const plt = unzip(await download(page, 'exRollPlt'));
  const [name] = Object.keys(plt);
  expect(name).toMatch(/^roll-400mm-7pcs\.plt$/);
  expect(loops(plt[name])).toBe(7);
  const svg = (await download(page, 'exRollSvg')).toString();
  expect(svg).toContain('width="400mm"');
  expect((svg.match(/<path /g) || []).length).toBe(7);
  expect(svg).toContain('scpro2_x5F_regmarks');

  // the print PDF: one page as wide as the roll, as long as the layout
  const pdf = await PDFDocument.load(await download(page, 'exRollPdf'));
  expect(pdf.getPageCount()).toBe(1);
  const { width, height } = pdf.getPage(0).getSize();
  expect(Math.round(width / PT)).toBe(400);
  const H = height / PT;
  expect(svg).toContain(`height="${Math.round(H * 1000) / 1000}mm"`);
  noProblems(problems);
});

test('roll: cut in sections, each with its own marks and PLT, printed as one long page or a page each', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'roll');
  await setField(page, 'rollW', 200); await setField(page, 'rollMax', 250); await setField(page, 'rollTurn', false);
  await page.setInputFiles('#rollFile', [fixture('sign_100x150mm_3szt.pdf')]);
  await expect(page.locator('#msg')).toContainText('Cut in 3 sections of at most 250 mm');
  const plt = unzip(await download(page, 'exRollPlt'));
  expect(Object.keys(plt).sort()).toEqual(['roll-200mm-3pcs-section1.plt', 'roll-200mm-3pcs-section2.plt', 'roll-200mm-3pcs-section3.plt']);
  // every section's PLT has its own frame: one sign each, the size of one section
  for (const t of Object.values(plt)) { expect(loops(t)).toBe(1); expect(String(t)).toContain('FSIZE'); }
  const fsize = String(plt['roll-200mm-3pcs-section1.plt']).match(/FSIZE(\d+),(\d+)/);
  const secH = +fsize[1] / 40 + 11; // the marks' frame is 5.5 mm in from each end
  // one long page: the three sections one after the other, 10 mm of blank roll between them
  let pdf = await PDFDocument.load(await download(page, 'exRollPdf'));
  expect(pdf.getPageCount()).toBe(1);
  expect(Math.round(pdf.getPage(0).getSize().height / PT)).toBe(Math.round(3 * secH + 2 * 10));
  // or a page each
  await setField(page, 'rollOnePage', false);
  await expect(page.locator('#msg')).toContainText('One print page per section.');
  pdf = await PDFDocument.load(await download(page, 'exRollPdf'));
  expect(pdf.getPageCount()).toBe(3);
  expect(Math.round(pdf.getPage(0).getSize().height / PT)).toBe(Math.round(secH));
  noProblems(problems);
});

test('roll: a page turned by /Rotate is cut and printed the way it is seen, also with its media box off 0,0', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'roll');
  await setField(page, 'rollW', 450); await setField(page, 'rollTurn', false);
  // seen: 90 x 140 mm, a red square at the top left, a blue one at the bottom right (whichever way the page is stored)
  const files = [];
  for (const rot of [0, 90, 180, 270]) files.push({ name: `turned${rot}_90x140mm_1szt.pdf`, mimeType: 'application/pdf', buffer: await turnedPdf(90, 140, rot, { ox: 20, oy: 35 }) });
  await page.setInputFiles('#rollFile', files);
  await expect(page.locator('#count')).toContainText('4 pieces');
  for (const li of await page.locator('#rollList li').all()) await expect(li.locator('.rs')).toContainText('Cut 90 × 140 mm');
  const svg = (await download(page, 'exRollSvg')).toString(), [cuts] = Object.values(cutLayers(svg));
  expect(cuts).toHaveLength(4);
  const boxes = cuts.map(bbox);
  for (const b of boxes) { expect(b[2] - b[0]).toBeCloseTo(90, 3); expect(b[3] - b[1]).toBeCloseTo(140, 3); }
  // the print: every piece's red square at the top left of its cut, the blue one at the bottom right
  const pdf = await download(page, 'exRollPdf');
  const colours = await pdfColours(page, pdf, boxes.flatMap(b => [[b[0] + 15, b[1] + 15], [b[2] - 15, b[3] - 15]]));
  for (let i = 0; i < 4; i++) {
    expect(isRed(colours[2 * i]), `piece ${i} top left ${colours[2 * i]}`).toBe(true);
    expect(isBlue(colours[2 * i + 1]), `piece ${i} bottom right ${colours[2 * i + 1]}`).toBe(true);
  }
  noProblems(problems);
});

test('roll: a long run of one label: the preview carries the picture once; a page over 5080 mm is flagged', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'roll');
  await setField(page, 'rollW', 600);
  await page.setInputFiles('#rollFile', { name: 'label_80x30mm_1000szt.pdf', mimeType: 'application/pdf', buffer: readFileSync(fixture('label_80x30mm_4pcs.pdf')) });
  await expect(page.locator('#count')).toContainText('1000 pieces');
  expect(await page.locator('#stage image').count()).toBe(1);
  expect(await page.locator('#stage use').count()).toBe(1000);
  await expect(page.locator('#msg')).toContainText('PDF pages over 5080 mm (200 in)');
  // in sections of 2 m, a page each: no page too long any more
  await setField(page, 'rollMax', 2000); await setField(page, 'rollOnePage', false);
  await expect(page.locator('#msg')).toContainText('One print page per section.');
  await expect(page.locator('#msg')).not.toContainText('5080');
  noProblems(problems);
});
