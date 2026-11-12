import { test, expect } from '@playwright/test';
import { setField, mode, makePng } from './helpers.js';

// Against the real server (login + library), see playwright.config.js
const SERVER = 'http://localhost:4174/';

test('background library: add a background with its card settings, then one click brings both back', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(SERVER);
  await page.fill('#u', 'shop'); await page.fill('#p', 'e2e password 123'); await page.click('button[type=submit]');
  await expect(page.locator('#secPresets')).toBeVisible();

  await mode(page, 'winietka');
  await setField(page, 'winSrc', 'names');
  await expect(page.locator('#winLib')).toBeVisible();
  await page.fill('#winNames', 'Anna\nJan');
  await page.setInputFiles('#winBg', { name: 'balony.png', mimeType: 'image/png', buffer: makePng(400, 300, 150, 20) });
  await setField(page, 'winW', 90); await setField(page, 'winH', 110); await setField(page, 'winOffY', 6); await setField(page, 'winFont', 'script');
  await setField(page, 'cFoldOn', true); await setField(page, 'cFoldDir', 'h');
  await expect(page.locator('#cardInfo')).toContainText('90 × 110 mm card + 2 mm bleed', { timeout: 30_000 });

  await page.click('#winLibSave');
  await page.fill('#winLibName', 'Urodziny – balony');
  await page.click('#winLibNameOk');
  await expect(page.locator('#winLibMsg')).toContainText('Saved “Urodziny – balony”');
  await expect(page.locator('.libtile', { hasText: 'Urodziny – balony' })).toHaveAttribute('aria-pressed', 'true');

  // a fresh start: other settings, no background
  await page.reload();
  await mode(page, 'winietka');
  await setField(page, 'winSrc', 'names');
  await page.click('.libtile[data-id=""]');
  await setField(page, 'winW', 100); await setField(page, 'winOffY', 0); await setField(page, 'winFont', 'sans'); await setField(page, 'cFoldOn', false);
  await page.fill('#winNames', 'Zofia\nŁukasz\nOla');

  // one click: background and its settings
  await page.click('.libtile:has-text("Urodziny – balony")');
  await expect(page.locator('#winLibMsg')).toContainText('with its card settings');
  await expect(page.locator('#winW')).toHaveValue('90');
  await expect(page.locator('#winH')).toHaveValue('110');
  await expect(page.locator('#winOffY')).toHaveValue('6');
  await expect(page.locator('#winFont')).toHaveValue('script');
  await expect(page.locator('#cFoldOn')).toBeChecked();
  await expect(page.locator('#cardInfo')).toContainText('3 cards: 90 × 110 mm card + 2 mm bleed', { timeout: 30_000 });
  await expect(page.locator('#winBgInfo')).toContainText('Urodziny – balony');

  // delete it again
  page.once('dialog', d => d.accept());
  await page.click('#winLibDelete');
  await expect(page.locator('#winLibMsg')).toContainText('Deleted');
  await expect(page.locator('.libtile')).toHaveCount(1);
  expect(errors).toEqual([]);
});
