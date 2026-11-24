// Number fields: a decimal comma is a decimal point (never ×10), a value out of range is shown on the field and
// holds back the exports, and the preview says why it isn't updated instead of showing the last result.
import { test, expect } from '@playwright/test';
import { openApp, noProblems, mode, download, unzip, pltStrokes, fixture } from './helpers.js';

const svgFile = (name, text) => ({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(text) });
const span = (strokes, k) => Math.max(...strokes.flat().map(p => p[k])) - Math.min(...strokes.flat().map(p => p[k]));
// type into a field key by key, as a person does
async function typeInto(page, loc, text) { await loc.click(); await loc.press('Control+a'); await loc.press('Backspace'); await loc.pressSequentially(text); }

test('a decimal comma is read as a point: 100,5 mm is 100.5 mm in the field, the layout and the PLT', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'vinyl');
  await page.setInputFiles('#files', [svgFile('box.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="40mm" viewBox="0 0 100 40"><rect x="10" y="5" width="20" height="10" fill="#000"/></svg>')]);
  await page.locator('#list input.q').fill('1');
  await page.evaluate(() => { for (const [id, v] of [['bladeOffset', '0'], ['overcut', '0']]) { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); } });
  const h = page.locator('#list .h');
  await typeInto(page, h, '100,5');
  await expect(h).toHaveValue('100.5');
  await expect(page.locator('#list .status')).toContainText('Cut 201 × 100.5 mm');
  await expect(h).not.toHaveClass(/bad/);
  await page.waitForTimeout(400);
  const s = pltStrokes(Object.values(unzip(await download(page, 'exVinylPlt')))[0].toString());
  expect([span(s, 0), span(s, 1)].sort((a, b) => a - b)).toEqual([4020, 8040]);
  // pasted text with a comma and a space too
  await h.fill('1 00,5');
  await expect(h).toHaveValue('100.5');
  // the arrow keys still step the value by the field's step (0.5)
  await h.press('ArrowUp');
  await expect(h).toHaveValue('101');
  await expect(page.locator('#list .status')).toContainText('× 101 mm');
  noProblems(problems);
});

test('a force out of range turns the field red with the range, and the PLT is not written until fixed', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', fixture('star.svg'));
  const btn = page.locator('#exPlt');
  await expect(btn).toBeEnabled({ timeout: 60_000 });
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
  const f = page.locator('#kissForce');
  await typeInto(page, f, '600');
  await expect(f).toHaveClass(/bad/);
  await expect(f).toHaveAttribute('aria-invalid', 'true');
  const err = f.locator('xpath=ancestor::div[contains(@class,"row")]/following-sibling::p[1]');
  await expect(err).toHaveClass(/numerr/);
  await expect(err).toBeVisible();
  await expect(err).toContainText('1–160 g');
  await expect(err).toContainText('160 g');
  await expect(btn).toHaveClass(/numblock/);
  // the count doesn't pretend the sheet is current, the line under it says why
  await expect(page.locator('#count')).toContainText('Not updated');
  await expect(page.locator('#msg')).toContainText('Kiss cut force');
  // clicking export writes nothing, and says why
  let got = false; page.on('download', () => { got = true; });
  await page.evaluate(() => document.getElementById('exPlt').click());
  await page.waitForTimeout(500);
  expect(got).toBe(false);
  await expect(page.locator('#msg')).toContainText('Not exported');
  // a negative die force and a speed of 99: the same
  await typeInto(page, f, '150');
  await expect(f).not.toHaveClass(/bad/);
  await typeInto(page, page.locator('#cutSpeed'), '99');
  await expect(page.locator('#cutSpeed')).toHaveClass(/bad/);
  await expect(btn).toHaveClass(/numblock/);
  await typeInto(page, page.locator('#cutSpeed'), '10');
  await expect(btn).not.toHaveClass(/numblock/);
  await expect(page.locator('#count')).not.toContainText('Not updated');
  page.removeAllListeners('download');
  const z = unzip(await download(page, 'exPlt'));
  const kiss = Object.entries(z).find(([n]) => /kiss/.test(n))[1].toString();
  expect(kiss).toContain('FS150');
  expect(kiss).toContain('VS10');
  noProblems(problems);
});

test('an impossible sticker height shows the reason instead of the last layout', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', fixture('star.svg'));
  await expect(page.locator('#exPlt')).toBeEnabled({ timeout: 60_000 });
  const h = page.locator('#list .h');
  await typeInto(page, h, '-50');
  await expect(h).toHaveClass(/bad/);
  await expect(page.locator('#count')).toContainText('Not updated');
  await expect(page.locator('#msg')).toContainText('at least 1');
  await expect(page.locator('#stage')).toHaveClass(/stale/);
  await typeInto(page, h, '40');
  await expect(page.locator('#stage')).not.toHaveClass(/stale/);
  await expect(page.locator('#count')).not.toContainText('Not updated');
  noProblems(problems);
});

test('values typed with a comma are kept over a reload; a bad one comes back red, not silently clamped', async ({ page }) => {
  const problems = await openApp(page);
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
  await typeInto(page, page.locator('#kiss'), '2,5');
  await typeInto(page, page.locator('#bladeOffset'), '0,25');
  await typeInto(page, page.locator('#dieForce'), '600');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('#kiss')).toHaveValue('2.5');
  await expect(page.locator('#bladeOffset')).toHaveValue('0.25');
  await expect(page.locator('#kiss')).not.toHaveClass(/bad/);
  await expect(page.locator('#dieForce')).toHaveValue('600');
  await expect(page.locator('#dieForce')).toHaveClass(/bad/);
  noProblems(problems);
});
