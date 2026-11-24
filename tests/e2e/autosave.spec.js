import { test, expect } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { download, enabled, fixture, mode, noProblems, openApp, unzip } from './helpers.js';

const PT = 72 / 25.4;
// would leaving the page now ask first? (the beforeunload handler: work not in the autosave yet, or still working)
const asksToLeave = page => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
// the job is in the browser's storage: leaving no longer asks
const saved = page => expect.poll(() => asksToLeave(page), { timeout: 30_000 }).toBe(false);
// the files of a PLT zip, without the zip's own dates
const pltFiles = buf => Object.fromEntries(Object.entries(unzip(buf)).map(([k, v]) => [k, v.toString('latin1')]));
async function reloadAndRestore(page, files) {
  await page.reload();
  const btn = page.locator('#jobRestoreBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText(new RegExp(`^Restore last job \\(${files} files?, saved \\d\\d:\\d\\d\\)$`));
  await btn.click();
  await expect(page.locator('#jobRestore')).toBeHidden();
}

test('autosave: a sticker job (SVG + PDF, height and copies set) comes back after a reload, with the same PLT', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', [fixture('star.svg'), fixture('sticker-cutline.pdf')]);
  const rows = page.locator('#list li.design');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).locator('.h').fill('30');
  await rows.nth(1).locator('.q').fill('3');
  // a change not in the autosave yet: leaving asks first
  expect(await asksToLeave(page)).toBe(true);
  await enabled(page, 'exPlt');
  await expect(page.locator('#count')).toHaveText(/\d+ stickers on the sheet/);
  const count = await page.locator('#count').textContent();
  const plt = pltFiles(await download(page, 'exPlt'));
  await saved(page);

  await reloadAndRestore(page, 2);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.h')).toHaveValue('30');
  await expect(rows.nth(1).locator('.q')).toHaveValue('3');
  await expect(rows.nth(0).locator('.dname')).toHaveText('star.svg');
  await enabled(page, 'exPlt');
  await expect(page.locator('#count')).toHaveText(count);
  expect(pltFiles(await download(page, 'exPlt'))).toEqual(plt);
  await saved(page);

  // Clear job: the list is empty, and nothing is offered after the next reload
  page.once('dialog', d => d.accept());
  await page.click('#jobClear');
  await expect(page.locator('#list')).toContainText('No stickers yet.');
  await expect(page.locator('#jobClear')).toBeHidden();
  await page.reload();
  await expect(page.locator('#count')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('#jobRestore')).toBeHidden();
  noProblems(problems);
});

test('autosave: the open mode is remembered; a roll job comes back with its copies, radius and cut', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'roll');
  await page.setInputFiles('#rollFile', [fixture('sign_100x150mm_3szt.pdf'), fixture('label_80x30mm_4pcs.pdf')]);
  await expect(page.locator('#count')).toContainText('7 pieces');
  const rows = page.locator('#rollList li');
  await rows.nth(0).locator('.rc').selectOption('outer');
  await rows.nth(1).locator('.rq').fill('2');
  await rows.nth(1).locator('.rr').fill('3');
  await expect(page.locator('#count')).toContainText('5 pieces');
  const count = await page.locator('#count').textContent();
  const plt = pltFiles(await download(page, 'exRollPlt'));
  await saved(page);

  await page.reload();
  // the mode opens by itself; the job is offered
  await expect(page.locator('.modes button[data-mode="roll"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#jobRestoreInfo')).toHaveText('Roll: 2 files');
  await reloadAndRestore(page, 2);
  await expect(page.locator('#count')).toHaveText(count);
  await expect(rows.nth(0).locator('.rc')).toHaveValue('outer');
  await expect(rows.nth(1).locator('.rq')).toHaveValue('2');
  await expect(rows.nth(1).locator('.rr')).toHaveValue('3');
  expect(pltFiles(await download(page, 'exRollPlt'))).toEqual(plt);
  noProblems(problems);
});

test('autosave: typed stamp texts and their settings come back', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'stamps');
  await page.click('#stAddText');
  const text = page.locator('#stList li').nth(0);
  await text.locator('.steditor').evaluate(ed => { ed.innerHTML = '<div style="text-align: center;" data-pt="12"><b>Zakład Pogrzebowy</b></div><div style="text-align: left;" data-pt="9"><i>ul. Polna 7</i></div>'; ed.dispatchEvent(new Event('input')); });
  await text.locator('.stq').fill('3');
  await text.locator('.strim').fill('0.3');
  await page.setInputFiles('#stSvgFile', fixture('stamp-logo.svg'));
  const logo = page.locator('#stList li').nth(1);
  await logo.locator('.stsize').selectOption('b4');
  await expect(logo.locator('.stst')).toContainText('59 × 25 mm');
  await expect(text.locator('.stst')).toContainText('rim around the letters 0.3 mm');
  const status = [await text.locator('.stst').textContent(), await logo.locator('.stst').textContent()];
  const count = await page.locator('#count').textContent();
  const html = await text.locator('.steditor').innerHTML();
  await saved(page);

  await reloadAndRestore(page, 1);
  await expect(page.locator('#stList li')).toHaveCount(2);
  await expect(text.locator('.dname')).toHaveText('Zakład Pogrzebowy');
  expect(await text.locator('.steditor').innerHTML()).toBe(html);
  await expect(text.locator('.stq')).toHaveValue('3');
  await expect(logo.locator('.stsize')).toHaveValue('b4');
  await expect(text.locator('.stst')).toHaveText(status[0]);
  await expect(logo.locator('.stst')).toHaveText(status[1]);
  await expect(page.locator('#count')).toHaveText(count);
  noProblems(problems);
});

test('autosave: a business card PDF with a typed bleed comes back, with the same PLT', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (const c of [rgb(0.9, 0.2, 0.2), rgb(0.2, 0.2, 0.9)]) {
    const p = doc.addPage([120 * PT, 70 * PT]);
    p.drawRectangle({ x: 0, y: 0, width: 120 * PT, height: 70 * PT, color: c });
  }
  const problems = await openApp(page);
  await mode(page, 'cards');
  await page.setInputFiles('#cardFile', { name: 'card.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#cardInfo')).toContainText('card.pdf: 120 × 70 mm card + 0 mm bleed');
  // no trim box: the bleed typed for this PDF
  await page.locator('#cBleed').fill('3.5');
  await expect(page.locator('#cardInfo')).toContainText('113 × 63 mm card + 3.5 mm bleed (as typed');
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/);
  const count = await page.locator('#count').textContent();
  const plt = pltFiles(await download(page, 'exCardPlt'));
  await saved(page);

  // reloaded in another mode: the card job is restored in its own mode, and the open mode stays
  await mode(page, 'stickers');
  await reloadAndRestore(page, 1);
  await expect(page.locator('.modes button[data-mode="stickers"]')).toHaveAttribute('aria-pressed', 'true');
  await mode(page, 'cards');
  await expect(page.locator('#cardInfo')).toContainText('card.pdf: 113 × 63 mm card + 3.5 mm bleed (as typed');
  await expect(page.locator('#count')).toHaveText(count);
  expect(pltFiles(await download(page, 'exCardPlt'))).toEqual(plt);
  noProblems(problems);
});

test('autosave: jobs of several modes come back in one go: print sheets, winietki (one removed), SVG to PLT', async ({ page }) => {
  const problems = await openApp(page);
  // print sheets: a picture and a two-page PDF, copies set
  await mode(page, 'gang');
  const two = await PDFDocument.create();
  for (let i = 0; i < 2; i++) two.addPage([100 * PT, 150 * PT]).drawRectangle({ x: 0, y: 0, width: 100 * PT, height: 150 * PT, color: rgb(0.2, 0.2, 0.9) });
  const twoPdf = Buffer.from(await two.save());
  await page.setInputFiles('#gangFile', [{ name: 'party.png', mimeType: 'image/png', buffer: readFileSync(fixture('square-party.png')) }, { name: 'two.pdf', mimeType: 'application/pdf', buffer: twoPdf }]);
  const gRows = page.locator('#gangList li');
  await expect(gRows).toHaveCount(3);
  await gRows.nth(2).locator('.gq').fill('4');
  await expect(page.locator('#count')).toContainText('6 prints');
  // winietki: a two-page PDF, the first card removed
  await mode(page, 'winietka');
  await page.setInputFiles('#winFile', { name: 'win.pdf', mimeType: 'application/pdf', buffer: twoPdf });
  await expect(page.locator('#winList li')).toHaveCount(2);
  await page.locator('#winList li').nth(0).locator('.remove').click();
  await expect(page.locator('#winList li')).toHaveCount(1);
  await expect(page.locator('#winList .dname')).toHaveText('win.pdf p.2');
  // SVG to PLT: one of two cut groups left out, the other's force changed
  await mode(page, 'svgplt');
  const marks = [[0, 0], [290, 0], [0, 290], [290, 290]].map(([x, y]) => `<rect x="${x}" y="${y}" width="10" height="1"/><rect x="${x + (x ? 9 : 0)}" y="${y}" width="1" height="10"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 300 300">${marks}<rect x="50" y="50" width="100" height="100" fill="none" stroke="#f00"/><rect x="160" y="50" width="50" height="50" fill="none" stroke="#00f"/></svg>`;
  await page.setInputFiles('#spFile', { name: 'pc.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await expect(page.locator('#spGroups .spInc')).toHaveCount(2);
  await page.locator('#spGroups .spInc').nth(1).uncheck();
  await page.locator('#spGroups .spF').nth(0).fill('77');
  await saved(page);

  await reloadAndRestore(page, 4);
  await expect(page.locator('.modes button[data-mode="svgplt"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#spGroups .spInc').nth(1)).not.toBeChecked();
  await expect(page.locator('#spGroups .spInc').nth(0)).toBeChecked();
  await expect(page.locator('#spGroups .spF').nth(0)).toHaveValue('77');
  await mode(page, 'winietka');
  await expect(page.locator('#winList li')).toHaveCount(1);
  await expect(page.locator('#winList .dname')).toHaveText('win.pdf p.2');
  await mode(page, 'gang');
  await expect(gRows).toHaveCount(3);
  await expect(gRows.nth(2).locator('.gq')).toHaveValue('4');
  await expect(page.locator('#count')).toContainText('6 prints');
  noProblems(problems);
});
