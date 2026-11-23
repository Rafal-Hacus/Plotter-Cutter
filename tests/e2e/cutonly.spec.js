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

test('vinyl: live text and thick strokes, which aren’t cut as drawn, are pointed out', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'vinyl');
  await page.setInputFiles('#files', [svgFile('sale.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="40mm" viewBox="0 0 100 40"><rect x="2" y="2" width="20" height="20"/><text x="30" y="30" font-size="25">SALE</text><circle cx="80" cy="12" r="8" fill="none" stroke="#000" stroke-width="3"/><path d="M2 35 H90" fill="none" stroke="#000" stroke-width="0.1"/></svg>')]);
  const status = page.locator('#list .status');
  await expect(status).toContainText('1 text element is left out');
  await expect(status).toContainText('1 shape is only a thick stroke'); // (the hairline isn't counted)
  // only text: says why there is nothing to cut
  await page.click('#list .remove');
  await page.setInputFiles('#files', [svgFile('t.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="40mm" viewBox="0 0 100 40"><text x="10" y="30" font-size="25">SALE</text></svg>')]);
  await expect(status).toContainText('text has to be converted to curves');
  noProblems(problems);
});

test('pen: strokes are drawn as they are, so no stroke warning', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'pen');
  await page.setInputFiles('#files', [svgFile('ring.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="none" stroke="#000" stroke-width="3"/></svg>')]);
  await expect(page.locator('#list .status')).toContainText('Drawing');
  await expect(page.locator('#list .status')).not.toContainText('stroke');
  noProblems(problems);
});
