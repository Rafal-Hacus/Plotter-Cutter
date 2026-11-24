// Each mode shows its own title and only the shared settings it uses, and an export button is in view without
// scrolling the side panel (src/modes/meta.js).
import { test, expect } from '@playwright/test';
import { MODE_META } from '../../src/modes/meta.js';
import { openApp, noProblems, mode, setField } from './helpers.js';

const MODES = Object.keys(MODE_META);
// shown in the mode: no hidden panel or row around it (a closed <details> still counts as shown)
const visible = (page, id) => page.evaluate(id => {
  for (let a = document.getElementById(id); a; a = a.parentElement) if (a.hidden) return false;
  return true;
}, id);

// the first export button that is shown, enabled or not, is on screen and not under anything else
const exportInView = page => page.evaluate(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  return [...document.querySelectorAll('#secExport button[id^="ex"]')].some(b => {
    if (!b.offsetParent) return false;
    const r = b.getBoundingClientRect();
    if (r.top < 0 || r.left < 0 || r.bottom > vh || r.right > vw) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === b || b.contains(hit);
  });
});

test('every mode has its own title, lede and drop hint', async ({ page }) => {
  const problems = await openApp(page);
  expect(MODES).toHaveLength(15);
  const ledes = new Set();
  for (const m of MODES) {
    await mode(page, m);
    const meta = MODE_META[m];
    await expect(page.locator('h1')).toHaveText(meta.title);
    await expect(page).toHaveTitle(new RegExp(`^${meta.title}`));
    await expect(page.locator('#appLede')).toHaveText(meta.lede);
    expect(await page.locator('#dropNote').textContent()).toBe(meta.drop);
    ledes.add(meta.lede);
  }
  expect(ledes.size).toBe(MODES.length);
  // nothing says sticker outside the sticker mode's own words
  await mode(page, 'vinyl');
  await expect(page.locator('#h-stickers')).toHaveText('Shapes to cut');
  await expect(page.locator('h1')).not.toContainText('Sticker');
  await mode(page, 'stickers');
  await expect(page.locator('#h-stickers')).toHaveText('Stickers');
  await expect(page.locator('#dropNote')).not.toContainText('round');
  noProblems(problems);
});

test('the knife settings show only in the modes that cut with them; hidden values are kept', async ({ page }) => {
  const problems = await openApp(page);
  for (const m of ['stamps', 'gang', 'guillotine', 'deck', 'morgana', 'duplex']) {
    await mode(page, m);
    for (const id of ['secCut', 'secLayout', 'secSheet']) expect(await visible(page, id), `${id} in ${m}`).toBe(false);
  }
  for (const m of ['stickers', 'vinyl', 'roll']) {
    await mode(page, m);
    await page.evaluate(() => { for (const d of document.querySelectorAll('#secCut, #secCut details.sub')) d.open = true; });
    await expect(page.locator('#kissForce')).toBeVisible();
    expect(await visible(page, 'kissForce'), `kiss force in ${m}`).toBe(true);
  }
  for (const m of ['stickers', 'roll']) {
    await mode(page, m);
    expect(await visible(page, 'dieForce'), `die force in ${m}`).toBe(true);
  }
  // the sticker outline settings only in stickers; the sheet with marks only where the template is used
  await mode(page, 'stickers');
  for (const id of ['kiss', 'die', 'joinGap', 'clearance', 'sheetSize']) expect(await visible(page, id), id).toBe(true);
  await mode(page, 'cards');
  for (const id of ['kiss', 'joinGap', 'kissForce']) expect(await visible(page, id), `${id} in cards`).toBe(false);
  for (const id of ['dieForce', 'bladeOffset', 'clearance']) expect(await visible(page, id), `${id} in cards`).toBe(true);
  await mode(page, 'roll');
  for (const id of ['kiss', 'clearance', 'sheetSize', 'rotate']) expect(await visible(page, id), `${id} in roll`).toBe(false);
  await mode(page, 'pen');
  for (const id of ['kissForce', 'overcut', 'bladeOffset']) expect(await visible(page, id), `${id} in pen`).toBe(false);
  expect(await visible(page, 'rotate')).toBe(true);
  // a value set in one mode survives a mode that hides it
  await mode(page, 'stickers');
  await setField(page, 'kissForce', '77');
  await mode(page, 'stamps');
  await mode(page, 'stickers');
  await expect(page.locator('#kissForce')).toHaveValue('77');
  noProblems(problems);
});

test('the PLT modifier is a tool of its own, opened from Tools', async ({ page }) => {
  const problems = await openApp(page);
  expect(await page.locator('aside #modFile').count()).toBe(0);
  await expect(page.locator('#toolMod')).toBeHidden();
  await page.click('#toolModOpen');
  await expect(page.locator('#toolMod')).toBeVisible();
  await expect(page.locator('#exMod')).toBeVisible();
  await page.click('#toolModClose');
  await expect(page.locator('#toolMod')).toBeHidden();
  noProblems(problems);
});

for (const [w, h] of [[1400, 900], [390, 844]]) {
  test(`an export button is in view without scrolling in every mode at ${w} × ${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const problems = await openApp(page);
    // (with the "Restore last job" bar and "Clear job" shown, as after a reload with a job kept)
    await page.evaluate(() => { for (const id of ['jobRestore', 'jobClear']) document.getElementById(id).hidden = false; });
    for (const m of MODES.filter(x => x !== 'duplex')) {
      await mode(page, m);
      await page.evaluate(() => { for (const id of ['jobRestore', 'jobClear']) document.getElementById(id).hidden = false; });
      await page.evaluate(() => { document.querySelector('aside').scrollTop = 0; window.scrollTo(0, 0); });
      expect(await exportInView(page), `export in view in ${m}`).toBe(true);
    }
    // the page never scrolls sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    noProblems(problems);
  });
}
