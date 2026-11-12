import { test, expect } from '@playwright/test';
import { openApp, noProblems, setField, mode, fixture } from './helpers.js';

// A square picture (like a ChatGPT image) made into a portrait print with bleed, in Print sheets.
const pngSize = async (page, sel) => page.evaluate(async sel => {
  const im = new Image(); im.src = document.querySelector(sel).src; await im.decode();
  return [im.naturalWidth, im.naturalHeight];
}, sel);

test('edit picture: fit a square picture into 10 × 15 cm, white around it, straight onto the sheet', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'gang');
  await page.setInputFiles('#gangFile', fixture('square-party.png'));
  await page.click('.ged');
  await expect(page.locator('#imgEditor')).toBeVisible();
  await expect(page.locator('#edInfo')).toContainText('100 × 150 mm + 2 mm bleed');
  await expect(page.locator('#edDpi')).toContainText('152 dpi (low: AI upscale recommended)');
  await page.click('#edStretch');
  await expect(page.locator('#edStretchH')).not.toHaveValue('100'); // stretched: height no longer equals width
  await page.click('#edFit');
  await expect(page.locator('#edStretchH')).toHaveValue('100');
  await setField(page, 'edEmpty', 'white');
  await page.click('#edApply');
  await expect(page.locator('#edUse')).toBeVisible();
  await page.click('#edUse');
  await expect(page.locator('#imgEditor')).toBeHidden();
  await expect(page.locator('.gst')).toContainText('Edited for the format');
  await expect(page.locator('#count')).toHaveText('1 print on 1 sheet');
  noProblems(problems);
});

test('edit picture: AI fills the rest of the page (runs the real model in the browser, through the server)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:4174/');
  await page.fill('#u', 'shop'); await page.fill('#p', 'e2e password 123'); await page.click('button[type=submit]');
  await expect(page.locator('#secPresets')).toBeVisible();
  await mode(page, 'gang');
  // a small format so the model runs quickly even without a graphics card
  await setField(page, 'ggFormat', 'custom'); await setField(page, 'ggW', 30); await setField(page, 'ggH', 45);
  await page.setInputFiles('#gangFile', fixture('square-party.png'));
  await page.click('.ged');
  await page.click('#edFit');
  await setField(page, 'edEmpty', 'ai');
  await page.click('#edApply');
  await expect(page.locator('#edUse')).toBeVisible({ timeout: 200_000 });
  await expect(page.locator('#edStatus')).toContainText('Check the result');
  // the finished page: 30 + 2 x 2 mm by 45 + 2 x 2 mm at 300 dpi, and no white left where the picture didn't reach
  const corner = await page.evaluate(() => {
    const cv = document.getElementById('edCanvas'), g = cv.getContext('2d');
    // sample the preview inside the top bleed band, which only the AI could have painted
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const d = g.getImageData(Math.round(r.width * dpr / 2), Math.round(r.height * dpr * 0.08), 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  expect(corner.join(',')).not.toBe('255,255,255');
  await page.click('#edUse');
  await expect(page.locator('.gst')).toContainText('Edited for the format');
  // the preview of the finished page has the page's shape: (30 + 4) x (45 + 4) mm
  const [w, h] = await pngSize(page, '.design .thumb img');
  expect(h).toBe(600); expect(Math.abs(w - 600 * 34 / 49)).toBeLessThan(1.5);
  expect(errors.filter(e => !/WebGPU|webgpu|GPU adapter|adapters/i.test(e))).toEqual([]);
});
