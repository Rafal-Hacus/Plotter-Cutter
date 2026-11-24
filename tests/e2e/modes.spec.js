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

// the picker: six main choices, a sub-choice for three of them, and a Tools row (src/mode-switch.js)
const MAIN = { stickers: ['stickers'], cards: ['cards', 'vouchers', 'winietka'], guillotine: ['guillotine', 'deck', 'gang', 'morgana'], roll: ['roll'], vinyl: ['vinyl', 'pen'], stamps: ['stamps'] };
const TOOLS = ['svgplt', 'squares', 'duplex'];
const pressed = page => page.evaluate(() => [...document.querySelectorAll('.modes button[aria-pressed="true"]')].filter(b => b.offsetParent).map(b => b.dataset.mode || `main:${b.dataset.main}`));

test('the mode picker: six main choices, a sub-choice that picks the mode, and Tools', async ({ page }) => {
  const problems = await openApp(page);
  await expect(page.locator('.modes .mmain button')).toHaveText(['Stickers', 'Cards & flyers', 'Guillotine', 'Roll', 'Vinyl & pen', 'Pieczątki']);
  await expect(page.locator('.modes .tools button')).toHaveText(['SVG to PLT', 'Squares', 'Duplex test', 'PLT modifier…']);
  await expect(page.locator('.modes [data-sub]:visible')).toHaveCount(0);
  // every mode of the app is reachable, with the main choice and the sub-choice pressed and its own title
  const reached = [];
  for (const [main, modes] of Object.entries(MAIN)) {
    for (const m of modes) {
      await mode(page, m);
      reached.push(m);
      await expect(page.locator('h1')).toHaveText(MODE_META[m].title);
      expect(await page.evaluate(() => document.body.dataset.mode)).toBe(m);
      expect(await pressed(page)).toEqual(modes.length > 1 ? [`main:${main}`, m] : [m]);
      await expect(page.locator('.modes [data-sub]:visible')).toHaveCount(modes.length > 1 ? 1 : 0);
    }
  }
  for (const m of TOOLS) {
    await page.click(`.modes .tools button[data-mode="${m}"]`);
    reached.push(m);
    await expect(page.locator('h1')).toHaveText(MODE_META[m].title);
    expect(await pressed(page)).toEqual([m]);
    await expect(page.locator('.modes [data-sub]:visible')).toHaveCount(0);
  }
  expect(reached.sort()).toEqual(MODES.slice().sort());
  // a main choice opens on the sub-choice used last, also after a reload
  await mode(page, 'deck');
  await mode(page, 'pen');
  await page.click('.modes button[data-main="guillotine"]');
  await expect(page.locator('h1')).toHaveText(MODE_META.deck.title);
  await page.click('.modes button[data-main="cards"]');
  await expect(page.locator('h1')).toHaveText(MODE_META.winietka.title); // the last one picked in the loop above
  await page.click('.modes button[data-main="vinyl"]');
  await expect(page.locator('h1')).toHaveText(MODE_META.pen.title);
  await page.reload();
  // the last mode comes back with its main choice open
  await expect(page.locator('h1')).toHaveText(MODE_META.pen.title);
  expect(await pressed(page)).toEqual(['main:vinyl', 'pen']);
  await page.click('.modes button[data-main="guillotine"]');
  await expect(page.locator('h1')).toHaveText(MODE_META.deck.title);
  // keyboard: Tab to a choice, Enter or Space picks it
  await page.focus('.modes button[data-main="cards"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toHaveText(MODE_META.winietka.title);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab'); // past the other main choices
  await expect(page.locator('.modes button[data-mode="cards"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.modes button[data-mode="vouchers"]')).toBeFocused();
  await page.keyboard.press(' ');
  await expect(page.locator('h1')).toHaveText(MODE_META.vouchers.title);
  noProblems(problems);
});

for (const [w, h, max] of [[1400, 900, 190], [390, 844, 190]]) {
  test(`the mode picker is compact and fits at ${w} × ${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const problems = await openApp(page);
    for (const m of ['stickers', 'deck', 'morgana', 'vouchers', 'pen', 'duplex']) {
      await mode(page, m);
      const box = await page.locator('nav.modes').boundingBox();
      expect(box.height, `picker height in ${m}`).toBeLessThanOrEqual(max);
      // nothing in it sticks out of it
      expect(await page.evaluate(() => {
        const n = document.querySelector('nav.modes').getBoundingClientRect();
        return [...document.querySelectorAll('nav.modes button')].filter(b => b.offsetParent).every(b => { const r = b.getBoundingClientRect(); return r.left >= n.left && r.right <= n.right; });
      }), `buttons inside in ${m}`).toBe(true);
    }
    noProblems(problems);
  });
}

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
