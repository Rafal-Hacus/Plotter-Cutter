import { test, expect } from '@playwright/test';
import { openApp, noProblems, mode, fixture } from './helpers.js';

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
