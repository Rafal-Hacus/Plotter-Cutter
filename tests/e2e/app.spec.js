import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, noProblems, mode, fixture, setField } from './helpers.js';

const MODES = ['stickers', 'cards', 'vouchers', 'winietka', 'guillotine', 'deck', 'gang', 'morgana', 'duplex', 'vinyl', 'pen', 'squares', 'svgplt'];

test('every mode opens without errors or outside requests', async ({ page }) => {
  const problems = await openApp(page);
  for (const m of MODES) {
    await mode(page, m);
    await expect(page.locator(`.modes button[data-mode="${m}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#stage svg')).toBeVisible();
  }
  noProblems(problems);
});

test('the production page carries a strict Content-Security-Policy', async ({ page }) => {
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
});

test('a hostile SVG is drawn without running anything or loading anything', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', { name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 50 50" width="30mm" height="30mm" onload="window.__pwn=1">
<style>@import url(http://evil.example/x.css);</style>
<foreignObject width="50" height="50"><iframe xmlns="http://www.w3.org/1999/xhtml" srcdoc="&lt;script&gt;parent.__pwn=2&lt;/script&gt;"></iframe></foreignObject>
<a xlink:href="java&#x09;script:window.__pwn=3"><circle cx="25" cy="25" r="20" fill="#c00"/></a>
<set attributeName="onmouseover" to="window.__pwn=4"/><image href="http://evil.example/t.png" width="5" height="5"/></svg>`) });
  await expect(page.locator('#count')).toHaveText(/\d+ stickers on the sheet/);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__pwn)).toBeUndefined();
  noProblems(problems);
});

test('vinyl and pen modes cut the shapes as drawn', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'vinyl');
  await page.setInputFiles('#files', [fixture('star.svg')]);
  await expect(page.locator('#count')).toHaveText(/\d+ copies on the vinyl/);
  noProblems(problems);
});

test('a file that can’t be read stays mentioned next to the ones that could', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', [{ name: 'broken.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg') }, { name: 'star.svg', mimeType: 'image/svg+xml', buffer: readFileSync(fixture('star.svg')) }]);
  await expect(page.locator('#count')).toHaveText(/\d+ stickers? on the sheet/);
  // still there after the sheet has been laid out (it used to be wiped a moment after it appeared)
  await expect(page.locator('#msg')).toContainText('broken.svg');
  await expect(page.locator('#list li.design')).toHaveCount(1);
  // only a broken file: the list goes back to its empty state
  await page.click('#list .remove');
  await page.setInputFiles('#files', [{ name: 'broken.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg') }]);
  await expect(page.locator('#list li.empty')).toHaveCount(1);
  await expect(page.locator('#msg')).toContainText('broken.svg');
  noProblems(problems);
});

test('vinyl: a shape too big for the material with a weeding box around everything shows an empty layout, not an error', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'vinyl');
  await setField(page, 'vWeed', 'all');
  await page.setInputFiles('#files', [fixture('star.svg')]);
  await expect(page.locator('#count')).toHaveText(/\d+ copies on the vinyl/);
  await page.fill('#list .h', '400'); // wider than the 300 mm material
  await expect(page.locator('#count')).toHaveText('0 copies on the vinyl');
  await expect(page.locator('#msg')).not.toContainText('undefined');
  await expect(page.locator('#stage svg')).toHaveCount(1);
  noProblems(problems);
});

test('files dropped on a mode that takes none are ignored', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'squares');
  const data = await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'], 'a.svg', { type: 'image/svg+xml' })); return dt; });
  await page.dispatchEvent('body', 'drop', { dataTransfer: data });
  await mode(page, 'stickers');
  await expect(page.locator('#count')).toHaveText('Empty sheet');
  noProblems(problems);
});
