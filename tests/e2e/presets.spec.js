import { test, expect } from '@playwright/test';
import { setField, mode } from './helpers.js';

// Against the real server (login + saved settings), see playwright.config.js
const SERVER = 'http://localhost:4174/';
test.describe.configure({ mode: 'serial' });

async function signIn(page) {
  await page.goto(SERVER);
  await expect(page).toHaveURL(/\/login$/);
  await page.fill('#u', 'shop');
  await page.fill('#p', 'e2e password 123');
  await page.click('button[type=submit]');
  await expect(page.locator('#secPresets')).toBeVisible();
}

test('the app needs a login and refuses a wrong password', async ({ page }) => {
  await page.goto(SERVER);
  await expect(page).toHaveURL(/\/login$/);
  await page.fill('#u', 'shop');
  await page.fill('#p', 'wrong password');
  await page.click('button[type=submit]');
  await expect(page.locator('.err')).toHaveText('Wrong user name or password.');
  await signIn(page);
  await expect(page.locator('#userName')).toHaveText('shop');
});

test('save settings, pick them again, make them the default, delete them', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await signIn(page);

  // set up a Morgana job and save it
  await mode(page, 'morgana');
  await setField(page, 'mSize', '85x55');
  await setField(page, 'cOffX', '0.4');
  await setField(page, 'dieForce', '120');
  await page.click('#presetSave');
  await page.fill('#presetName', 'Morgana 85 × 55');
  await page.click('#presetNameOk');
  await expect(page.locator('#presetMsg')).toHaveText('Saved “Morgana 85 × 55”.');

  // change everything, then pick the saved settings again
  await mode(page, 'stickers');
  await setField(page, 'mSize', '90x50');
  await setField(page, 'cOffX', '0');
  await setField(page, 'dieForce', '60');
  await page.selectOption('#presetSel', { label: 'Morgana 85 × 55' });
  await expect(page.locator('.modes button[data-mode="morgana"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mSize')).toHaveValue('85x55');
  await expect(page.locator('#cOffX')).toHaveValue('0.4');
  await expect(page.locator('#dieForce')).toHaveValue('120');
  await expect(page.locator('#presetDirty')).toBeHidden();

  // an edit marks them as changed; Update saves it
  await setField(page, 'dieForce', '130');
  await expect(page.locator('#presetDirty')).toBeVisible();
  await page.click('#presetUpdate');
  await expect(page.locator('#presetMsg')).toHaveText('Updated “Morgana 85 × 55”.');
  await expect(page.locator('#presetDirty')).toBeHidden();

  // default: loads when the app opens
  await page.click('#presetDefault');
  await expect(page.locator('#presetSel option:checked')).toHaveText(/\(default\)/);
  await setField(page, 'dieForce', '60');
  await mode(page, 'stickers');
  await page.reload();
  await expect(page.locator('.modes button[data-mode="morgana"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#dieForce')).toHaveValue('130');

  // delete
  page.once('dialog', d => d.accept());
  await page.click('#presetDelete');
  await expect(page.locator('#presetMsg')).toHaveText('Deleted “Morgana 85 × 55”.');
  await expect(page.locator('#presetSel option')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('settings save in Roll too; saved settings with a slip in them (26 mm blade offset) load with the standard value', async ({ page }) => {
  await signIn(page);
  await mode(page, 'roll');
  await setField(page, 'rollW', '1600');
  await page.click('#presetSave');
  await page.fill('#presetName', 'Roll 1600');
  await page.click('#presetNameOk');
  await expect(page.locator('#presetMsg')).toHaveText('Saved “Roll 1600”.');
  // settings saved before the limits existed
  const settings = await page.evaluate(async () => {
    const r = await fetch('api/presets/' + (await (await fetch('api/presets')).json()).presets.find(p => p.name === 'Roll 1600').id);
    return (await r.json()).settings;
  });
  await page.evaluate(async s => {
    const r = await fetch('api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Old stickers', mode: 'stickers', settings: { ...s, bladeOffset: '26', clearance: '120', kissForce: '77' } }) });
    if (!r.ok) throw new Error(await r.text());
  }, settings);
  await page.reload();
  await expect(page.locator('#secPresets')).toBeVisible();
  await page.selectOption('#presetSel', { label: 'Old stickers' });
  await expect(page.locator('.modes button[data-mode="stickers"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#bladeOffset')).toHaveValue('0.35');
  await expect(page.locator('#clearance')).toHaveValue('5');
  await expect(page.locator('#kissForce')).toHaveValue('77');
  await expect(page.locator('#rollW')).toHaveValue('1600');
  for (const name of ['Old stickers', 'Roll 1600']) {
    await page.selectOption('#presetSel', { label: name });
    page.once('dialog', d => d.accept());
    await page.click('#presetDelete');
    await expect(page.locator('#presetMsg')).toHaveText(`Deleted “${name}”.`);
  }
});

test('signing out goes back to the login page', async ({ page }) => {
  await signIn(page);
  await page.click('#signOut');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(SERVER);
  await expect(page).toHaveURL(/\/login$/);
});
