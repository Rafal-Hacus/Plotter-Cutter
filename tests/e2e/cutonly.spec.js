// Cut-only modes (vinyl, pen, SVG to PLT): what ends up in the exported files.
import { test, expect } from '@playwright/test';
import { openApp, noProblems, mode, download, unzip, pltStrokes } from './helpers.js';

const svgFile = (name, text) => ({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(text) });
const span = (strokes, k) => Math.max(...strokes.flat().map(p => p[k])) - Math.min(...strokes.flat().map(p => p[k]));

test('vinyl: a file drawn to size is cut at that size, blank space around the shapes or not', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'vinyl');
  // a 100 x 40 mm page with a 20 x 10 mm rectangle on it
  await page.setInputFiles('#files', [svgFile('box.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="40mm" viewBox="0 0 100 40"><rect x="10" y="5" width="20" height="10" fill="#000"/></svg>')]);
  await expect(page.locator('#list .h')).toHaveValue('40');
  await page.locator('#list input.q').fill('1');
  await expect(page.locator('#count')).toHaveText('1 copy on the vinyl');
  await expect(page.locator('#list .status')).toContainText('Cut 20 × 10 mm');
  await page.evaluate(() => { for (const [id, v] of [['bladeOffset', '0'], ['overcut', '0']]) { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); } });
  await page.waitForTimeout(300);
  const z = unzip(await download(page, 'exVinylPlt')), s = pltStrokes(Object.values(z)[0].toString());
  // PLT X runs along the feed, Y across: the rectangle may be turned, so compare the two sides either way
  expect([span(s, 0), span(s, 1)].sort((a, b) => a - b)).toEqual([400, 800]);
  noProblems(problems);
});
