import { test, expect } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { openApp, noProblems, setField, download, mode, makePng, enabled } from './helpers.js';

const PT = 72 / 25.4;
// 85.0 x 55.0 mm at 350 dpi with a 2.5 mm frame: like a card with bleed only on the top and bottom of an 85 x 50 card
const front = { name: 'front.png', mimeType: 'image/png', buffer: makePng(1171, 758, 350, 34) };
const back = { name: 'back.png', mimeType: 'image/png', buffer: makePng(1171, 758, 350, 34) };

test('card images at 100 %: bleed found per side (only top and bottom)', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'cards');
  await page.evaluate(() => { document.getElementById('icW').value = 85; document.getElementById('icH').value = 50; });
  await page.setInputFiles('#cardFile', [front, back]);
  await expect(page.locator('#icInfo')).toContainText('Bleed top and bottom: 2.5 mm, left and right: none');
  await expect(page.locator('#cardInfo')).toContainText('85 × 50 mm card');
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/);
  const pdf = await PDFDocument.load(await download(page, 'exCardPdf'));
  expect(pdf.getPageCount()).toBe(2);
  noProblems(problems);
});

test('Morgana CardXtra: 85 × 55 image fills all 20 slots without bleed', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'morgana');
  await setField(page, 'mSize', '85x55');
  await page.setInputFiles('#cardFile', [front, back]);
  await expect(page.locator('#count')).toHaveText('20 cards on the sheet');
  await expect(page.locator('#icInfo')).toContainText('cut 85 × 55 mm. Bleed top and bottom: none, left and right: none');
  // the cut positions are drawn in red
  expect(await page.locator('#stage rect[stroke="#E0262B"]').count()).toBe(20);
  // a size that doesn't match the image is refused with a clear message
  await setField(page, 'mSize', '90x55');
  await expect(page.locator('#icInfo')).toContainText('smaller than the card');
  noProblems(problems);
});

test('business cards from a PDF with a trim box', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (const c of [rgb(0.9, 0.2, 0.2), rgb(0.2, 0.2, 0.9)]) {
    const p = doc.addPage([94 * PT, 54 * PT]);
    p.setTrimBox(2 * PT, 2 * PT, 90 * PT, 50 * PT);
    p.drawRectangle({ x: 0, y: 0, width: 94 * PT, height: 54 * PT, color: c });
  }
  const problems = await openApp(page);
  await mode(page, 'cards');
  await page.setInputFiles('#cardFile', { name: 'card.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#cardInfo')).toContainText('90 × 50 mm card + 2 mm bleed, two-sided');
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/);
  await enabled(page, 'exCardPlt');
  const out = await PDFDocument.load(await download(page, 'exCardPdf'));
  expect(out.getPageCount()).toBe(2);
  noProblems(problems);
});

test('business cards: perforated die cut leaves bridges, keeps corners cut, and changes nothing when off', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'cards');
  await page.setInputFiles('#cardFile', [front, back]);
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/);
  const plain = await download(page, 'exCardPlt');
  await expect(page.locator('#perfDie')).toBeVisible();
  await setField(page, 'cPerfDie', true);
  await setField(page, 'cTieCut', 6);
  await setField(page, 'cTie', 0.8);
  await expect(page.locator('#msg')).toContainText('Perforated die cut');
  const { cutLayers, unzip, pltStrokes } = await import('./helpers.js');
  // cut SVG: every grid line now in pieces, with 0.8 mm gaps between the pieces of one line
  const L = cutLayers((await download(page, 'exCardCut')).toString());
  const lines = Object.values(L)[0];
  expect(lines.length).toBeGreaterThan(100);
  const xs = new Set(lines.filter(l => l[0][0] === l.at(-1)[0]).map(l => l[0][0]));
  for (const x of xs) {
    const pieces = lines.filter(l => l[0][0] === x && l.at(-1)[0] === x).map(l => [Math.min(l[0][1], l.at(-1)[1]), Math.max(l[0][1], l.at(-1)[1])]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i][0] - pieces[i - 1][1]).toBeCloseTo(0.8, 2);
  }
  // the PLT has more, shorter cuts than without perforation
  const perf = unzip(await download(page, 'exCardPlt')), base = unzip(plain);
  const name = Object.keys(perf)[0];
  expect(pltStrokes(perf[name].toString()).length).toBeGreaterThan(pltStrokes(base[name].toString()).length * 5);
  // rounded corners: one perforated outline per card
  await setField(page, 'cCutStyle', 'rect'); await setField(page, 'cRadius', 3);
  await expect(page.locator('#msg')).toContainText('Perforated die cut');
  expect(Object.values(cutLayers((await download(page, 'exCardCut')).toString()))[0].length).toBeGreaterThan(21 * 20);
  // only in business cards for now
  await mode(page, 'vouchers');
  await expect(page.locator('#perfDie')).toBeHidden();
  noProblems(problems);
});
