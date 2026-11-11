import { test, expect } from '@playwright/test';
import { openApp, noProblems, setField, download, mode, makePng, unzip, pltStrokes, enabled } from './helpers.js';

const NAMES = 'Anna Kowalska\nJan Nowak\n\n  Łukasz Ćwikła  \nZofia Wiśniewska-Żółkiewska\nBartłomiej Grzegorz Brzęczyszczykiewicz';
const waitCards = (page, n) => expect(page.locator('#count')).toHaveText(new RegExp(`^${n} cards on \\d+ sheet`), { timeout: 30_000 });

test('winietki from a list of names: no bleed without a background, 2 mm with one, fold and die perforation kept apart', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'winietka');
  await setField(page, 'winSrc', 'names');
  await expect(page.locator('#winNameRows')).toBeVisible();
  await page.fill('#winNames', NAMES);
  await waitCards(page, 5);
  await expect(page.locator('#winNamesInfo')).toContainText('5 names.');
  await expect(page.locator('#cardInfo')).toContainText('100 × 100 mm card + 0 mm bleed');
  await expect(page.locator('#cBleed')).toBeHidden();

  // background: 2 mm bleed on every side
  await page.setInputFiles('#winBg', { name: 'bg.png', mimeType: 'image/png', buffer: makePng(600, 400, 150) });
  await expect(page.locator('#cardInfo')).toContainText('100 × 100 mm card + 2 mm bleed', { timeout: 30_000 });
  await page.click('#winBgClear');
  await expect(page.locator('#cardInfo')).toContainText('+ 0 mm bleed', { timeout: 30_000 });
  await page.setInputFiles('#winBg', { name: 'bg.png', mimeType: 'image/png', buffer: makePng(600, 400, 150) });
  await expect(page.locator('#cardInfo')).toContainText('+ 2 mm bleed', { timeout: 30_000 });

  // tent fold with its own 1 mm / 1 mm perforation, and the perforated die cut at 6 mm / 0.8 mm
  await setField(page, 'cFoldOn', true); await setField(page, 'cFoldDir', 'h');
  await setField(page, 'cPerfCut', 1); await setField(page, 'cPerfGap', 1);
  await setField(page, 'cPerfDie', true); await setField(page, 'cTieCut', 6); await setField(page, 'cTie', 0.8);
  await expect(page.locator('#msg')).toContainText('Perforated die cut', { timeout: 30_000 });
  await enabled(page, 'exCardPlt');
  const plt = Object.values(unzip(await download(page, 'exCardPlt')))[0].toString();
  const lengths = pltStrokes(plt).map(s => s.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - s[i][0], p[1] - s[i][1]), 0) / 40);
  const near = mm => lengths.filter(l => Math.abs(l - mm) < 0.6).length;
  expect(near(1)).toBeGreaterThan(100); // the fold perforation
  expect(near(5.9)).toBeGreaterThan(100); // the die cut between bridges

  // the print PDF holds one card per name (copies of each = 1)
  const pdf = await download(page, 'exCardPdf');
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  noProblems(problems);
});

test('switching back to PDF files clears the generated cards', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'winietka');
  await setField(page, 'winSrc', 'names');
  await page.fill('#winNames', 'Anna\nJan');
  await waitCards(page, 2);
  await setField(page, 'winSrc', 'pdf');
  await expect(page.locator('#winPdfRows')).toBeVisible();
  await expect(page.locator('#count')).toHaveText(/No cards/);
  noProblems(problems);
});
