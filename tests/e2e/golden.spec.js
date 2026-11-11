// Byte-for-byte check of the exported cut files against tests/golden/.
// A change here means the files sent to the plotter changed. If that is intended, look at the difference,
// then refresh the goldens with:  UPDATE_GOLDEN=1 npm run test:e2e -- golden
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApp, noProblems, setField, download, mode, makePng, fixture, enabled } from './helpers.js';

const DIR = fileURLToPath(new URL('../golden/', import.meta.url));
const UPDATE = !!process.env.UPDATE_GOLDEN;
function golden(name, bytes) {
  const f = DIR + name;
  if (UPDATE || !existsSync(f)) { mkdirSync(DIR, { recursive: true }); writeFileSync(f, bytes); return; }
  expect(Buffer.compare(bytes, readFileSync(f)), `${name} differs from tests/golden/${name}`).toBe(0);
}

test('stickers: cut SVG and PLTs', async ({ page }) => {
  const problems = await openApp(page);
  await setField(page, 'bladeOffset', 0.35); await setField(page, 'overcut', 0.5);
  await page.setInputFiles('#files', ['star.svg', 'u.svg', 'cut.svg'].map(fixture));
  await enabled(page, 'exCut');
  await expect(page.locator('#count')).toHaveText(/\d+ stickers on the sheet/);
  golden('stickers-cut.svg', await download(page, 'exCut'));
  golden('stickers-plt.zip', await download(page, 'exPlt'));
  golden('stickers-all.svg', await download(page, 'exAll'));
  noProblems(problems);
});

test('business cards: cut SVG and PLT, straight and rounded', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'cards');
  const png = makePng(1110, 638, 300, 24);
  await page.setInputFiles('#cardFile', [{ name: 'f.png', mimeType: 'image/png', buffer: png }, { name: 'b.png', mimeType: 'image/png', buffer: png }]);
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/);
  golden('cards-cut.svg', await download(page, 'exCardCut'));
  golden('cards-plt.zip', await download(page, 'exCardPlt'));
  await setField(page, 'cCutStyle', 'rect'); await setField(page, 'cRadius', 3);
  await page.waitForTimeout(800);
  golden('cards-rounded-plt.zip', await download(page, 'exCardPlt'));
  noProblems(problems);
});

test('squares, vinyl and pen PLTs', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'squares');
  await expect(page.locator('#count')).toHaveText(/pieces/);
  golden('squares-plt.zip', await download(page, 'exSqPlt'));
  await mode(page, 'vinyl');
  await page.setInputFiles('#files', ['star.svg', 'u.svg'].map(fixture));
  await expect(page.locator('#list input.q')).toHaveCount(2);
  for (const q of await page.locator('#list input.q').all()) await q.fill('2');
  await expect(page.locator('#count')).toHaveText('4 copies on the vinyl');
  await enabled(page, 'exVinylPlt');
  golden('vinyl-plt.zip', await download(page, 'exVinylPlt'));
  await mode(page, 'pen');
  await setField(page, 'penFill', true);
  await expect(page.locator('#count')).toHaveText('4 copies on the sheet');
  await page.waitForTimeout(500);
  await enabled(page, 'exVinylPlt');
  golden('pen-plt.zip', await download(page, 'exVinylPlt'));
  noProblems(problems);
});
