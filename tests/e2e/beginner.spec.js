// What a beginner needs to tell that it worked: a save said on screen, the job's name in the file names, a stamp's
// size box that means the whole stamp, and a restore offer in her words.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { download, enabled, fixture, mode, noProblems, openApp } from './helpers.js';

// click an export button: the file name the browser got
async function savedName(page, id) {
  await enabled(page, id);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(id => document.getElementById(id).click(), id)]);
  return dl.suggestedFilename();
}
// the shapes of an xTool project (a deflated zip): size and place of each, without the random ids
function xsShapes(buf) {
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8), size = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), xl = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nl).toString(), data = buf.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size);
    if (/displays-0\.json$/.test(name)) return JSON.parse((method === 8 ? inflateRawSync(data) : data).toString()).displays.map(d => [d.layerTag, d.x, d.y, d.width, d.height]);
    p += 30 + nl + xl + size;
  }
  return null;
}
const edLines = ed => ed.evaluate(e => Array.from(e.children).map(d => d.dataset.pt));

test('every save is said on screen, with what the file is for, and the job’s name in front of the file name', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', { name: 'Wino Teresy 14,5cm_cut.pdf', mimeType: 'application/pdf', buffer: readFileSync(fixture('sticker-cutline.pdf')) });
  await expect(page.locator('#count')).toHaveText(/\d+ stickers? on the sheet/);
  const n = (await page.locator('#count').textContent()).match(/\d+/)[0];
  const note = page.locator('#savedNote');
  // the print PDF: the job's name (ASCII, no spaces) and the kind suffix the shop knows
  const pdf = await savedName(page, 'exPdf');
  expect(pdf).toBe(`Wino_Teresy_14_5cm_cut-sticker-sheet-${n}pcs-print.pdf`);
  await expect(note).toBeVisible();
  await expect(note).toHaveText(`Saved: ${pdf} — for the printer`);
  const plt = await savedName(page, 'exPlt');
  expect(plt).toBe(`Wino_Teresy_14_5cm_cut-sticker-sheet-${n}pcs-plt.zip`);
  await expect(note).toHaveText(`Saved: ${plt} — for the Skycut cutting machine`);
  expect(await savedName(page, 'exCutPdf')).toMatch(/^Wino_Teresy_14_5cm_cut-.*-cut\.pdf$/);
  await expect(note).toHaveText(/— for the Skycut cutting machine$/);

  // a stamp: its first line is the job's name; the xTool file is said to be for the laser
  await mode(page, 'stamps');
  await page.click('#stAddText');
  await page.locator('#stList li .steditor').evaluate(ed => { ed.innerHTML = '<div style="text-align: center;" data-pt="10">Firma Kowalski</div><div style="text-align: center;" data-pt="10">ul. Długa 1</div>'; ed.dispatchEvent(new Event('input')); });
  await page.locator('#stList li .stq').fill('3');
  await expect(page.locator('#count')).toHaveText('3 stamps on the bed');
  const xs = await savedName(page, 'exStampsXs');
  expect(xs).toBe('Firma_Kowalski-pieczatki-3szt.xs');
  await expect(note).toHaveText(`Saved: ${xs} — for the xTool laser`);
  noProblems(problems);
});

test('stamp pt box: with only the cursor in the text (at its end, after typing) every line gets the size; a selection only its lines', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'stamps');
  await page.click('#stAddText');
  const li = page.locator('#stList li').first(), ed = li.locator('.steditor'), mixed = li.locator('.stmixed');
  await expect(li.locator('.stptl')).toContainText('Size (pt): the selected lines, or all lines');
  await expect(mixed).toBeHidden();
  // she types her text, the cursor stays at the end, then she types 8 in the box
  await ed.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Firma Kowalski');
  await page.keyboard.press('Enter'); await page.keyboard.type('ul. Długa 1');
  await page.keyboard.press('Enter'); await page.keyboard.type('tel. 600 000 000');
  await li.locator('.stpt').click();
  await li.locator('.stpt').fill('8');
  await expect.poll(() => edLines(ed)).toEqual(['8', '8', '8']);
  await expect(li.locator('.stst')).toContainText('Letters 8 pt.');
  await expect(mixed).toBeHidden();
  const caretXs = await download(page, 'exStampsXs');
  expect(xsShapes(caretXs).length).toBeGreaterThan(0);
  // the same as selecting all the text and typing 8
  await ed.evaluate(e => { const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await li.locator('.stpt').fill('9');
  await li.locator('.stpt').fill('8');
  await expect(li.locator('.stst')).toContainText('Letters 8 pt.');
  expect(xsShapes(await download(page, 'exStampsXs'))).toEqual(xsShapes(caretXs));

  // one line selected: only that line; the different sizes are said right under the text
  await ed.locator('div').nth(1).evaluate(d => { const r = document.createRange(); r.selectNodeContents(d); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await li.locator('.stpt').fill('10');
  await expect.poll(() => edLines(ed)).toEqual(['8', '10', '8']);
  await expect(mixed).toBeVisible();
  await expect(mixed).toHaveText('Lines have different sizes: 8 and 10 pt');
  await expect(li.locator('.stst')).toContainText('Letters 8–10 pt.');
  noProblems(problems);
});

test('restore offer: each mode’s job in words with its own button, the open mode first; Discard asks first', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', fixture('star.svg'));
  await expect(page.locator('#list li.design')).toHaveCount(1);
  await mode(page, 'stamps');
  await page.click('#stAddText');
  await page.locator('#stList li .steditor').evaluate(ed => { ed.innerHTML = '<div style="text-align: center;" data-pt="10">Firma Kowalski</div>'; ed.dispatchEvent(new Event('input')); });
  await page.locator('#stList li .stq').fill('3');
  await expect(page.locator('#count')).toHaveText('3 stamps on the bed');
  // kept in the browser: leaving no longer asks
  await expect.poll(() => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), { timeout: 30_000 }).toBe(false);

  await page.reload();
  const rows = page.locator('#jobRestoreList li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('span')).toHaveText(/^Pieczątki: 3 stamps 'Firma Kowalski' · \d\d:\d\d$/);
  await expect(rows.nth(1).locator('span')).toHaveText(/^Stickers: 1 file 'star\.svg' · \d\d:\d\d$/);
  // while it is offered the empty list points at it
  await expect(page.locator('#stList li.empty')).toHaveText('Your last work can be brought back: see the bar over the sheet.');
  await expect(page.locator('#count')).toHaveText('Your last stamps can be brought back');
  // Discard asks; saying no keeps the offer
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.click('#jobRestoreNo');
  expect(asked).toContain('Discard your last work');
  await expect(rows).toHaveCount(2);
  // only the stamps brought back: the stickers job is still offered
  await rows.nth(0).locator('.jrBring').click();
  await expect(page.locator('#count')).toHaveText('3 stamps on the bed');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('Stickers');
  await expect(page.locator('#jobRestoreAll')).toBeHidden();
  // in Stickers the empty list points at the offer too; Discard (accepted) clears it
  await mode(page, 'stickers');
  await expect(page.locator('#list li.empty')).toHaveText('Your last work can be brought back: see the bar over the sheet.');
  page.once('dialog', d => d.accept());
  await page.click('#jobRestoreNo');
  await expect(page.locator('#jobRestore')).toBeHidden();
  await expect(page.locator('#list li.empty')).toHaveText('No stickers yet.');
  noProblems(problems);
});
