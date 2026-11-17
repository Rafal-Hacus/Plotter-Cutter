import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { download, fixture, mode, noProblems, openApp, setField } from './helpers.js';

const PT = 72 / 25.4;

// the files of a deflated zip
function unzipDeflated(buf) {
  const out = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8), size = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), xl = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nl).toString(), data = buf.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size);
    out[name] = method === 8 ? inflateRawSync(data) : data;
    p += 30 + nl + xl + size;
  }
  return out;
}

test('pieczątki: a text stamp (B3) and an SVG stamp, saved as an xTool project with one group per stamp', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'stamps');
  await page.click('#stAddText');
  const text = page.locator('#stList li').nth(0);
  await text.locator('.steditor').evaluate(ed => { ed.innerHTML = '<div style="text-align: center;" data-size="1"><b>Konserwator</b></div><div style="text-align: center;" data-size="1"><b>Żurawie samojezdne</b></div><div style="text-align: center;" data-size="1"><b>tel. 600 000 000</b></div>'; ed.dispatchEvent(new Event('input')); });
  await expect(text.locator('.stsize')).toHaveValue('b3');
  // fitted to 48 x 19 less 2.3 / 0.8 mm: the wider side touches, nothing stretched
  await expect(text.locator('.stst')).toContainText('48 × 19 mm: text 43.4 ×');
  // the long line fills the width: the lines are spread to fill the height; without that the text is lower
  const h = async () => +(await text.locator('.stst').textContent()).match(/text 43\.4 × ([\d.]+) mm/)[1];
  const spread = await h();
  await text.locator('.stspread').uncheck();
  await expect.poll(h).toBeLessThan(spread);
  await text.locator('.stspread').check();
  await expect.poll(h).toBe(spread);
  await page.setInputFiles('#stSvgFile', fixture('stamp-logo.svg'));
  const logo = page.locator('#stList li').nth(1);
  await expect(logo.locator('.stst')).toContainText('1 text element was left out');
  await logo.locator('.stsize').selectOption('b4');
  await logo.locator('.stq').fill('2');
  await logo.locator('.stshape').selectOption('rect');
  await expect(logo.locator('.stst')).toContainText('59 × 25 mm: text 54.4 × 16.2 mm, cut 59 × 25 mm.');
  await expect(page.locator('#count')).toHaveText('3 stamps on the bed');
  // the stamp's size typed as the general distance to the cut by mistake: a warning, and one click back
  await page.locator('details:has(#stMarginX) summary').click();
  await setField(page, 'stMarginX', 48);
  await expect(logo.locator('.stst')).toContainText('is more than a quarter of the stamp');
  await page.click('#stLayoutReset');
  await expect(page.locator('#stMarginX')).toHaveValue('2.3');
  await expect(logo.locator('.stst')).toContainText('Text to cut 2.3 mm at the sides, 0.8 mm top and bottom; rim around the letters 0.2 mm (automatic).');
  await expect(logo.locator('.stst')).not.toContainText('quarter');
  // its own rim around the letters
  await logo.locator('.strim').fill('0.08');
  await expect(logo.locator('.stst')).toContainText('rim around the letters 0.08 mm.');
  await logo.locator('.strim').fill('');
  await expect(logo.locator('.stst')).toContainText('(automatic)');
  // text scale 90 %: the text narrower by a tenth, the cut still the stamp's size
  await logo.locator('.stscale').fill('90');
  await expect(logo.locator('.stst')).toContainText('59 × 25 mm: text 49 × 14.6 mm, cut 59 × 25 mm.');
  await logo.locator('.stscale').fill('100');
  // its own distance from the text to the cut: 5 mm at the sides, the text gets narrower, the cut stays 59 x 25
  await logo.locator('.stmx').fill('5');
  await expect(logo.locator('.stst')).toContainText('59 × 25 mm: text 49 ×');
  await expect(logo.locator('.stst')).toContainText('cut 59 × 25 mm.');

  const files = unzipDeflated(await download(page, 'exStampsXs'));
  expect(Object.keys(files)).toContain('.format');
  const J = re => JSON.parse(files[Object.keys(files).find(n => re.test(n))].toString());
  const ds = J(/displays-0\.json$/).displays, canvas = J(/^canvases\/[^/]+\.json$/);
  expect(ds).toHaveLength(9);
  expect(Object.keys(canvas.groupData)).toHaveLength(3);
  expect(ds.every(d => d.angle === 180 && d.skew.x === 3.141593)).toBe(true); // mirrored
  expect(files['resources/project-cover.png'].subarray(1, 4).toString()).toBe('PNG');
  // the B4 rectangle cut: 59 x 25
  const cuts = ds.filter(d => d.layerTag === '#000000').map(d => `${d.width}x${d.height}`);
  expect(cuts.filter(c => c === '59x25')).toHaveLength(2);
  noProblems(problems);
});

test('pieczątki: bold / italic / underline / line size in the editor, another font, and the real-size proof PDF', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'stamps');
  await page.click('#stAddText');
  const li = page.locator('#stList li').first(), ed = li.locator('.steditor');
  const textSize = async () => (await li.locator('.stst').textContent()).match(/text ([\d.]+) × ([\d.]+) mm/).slice(1).map(Number);
  await expect(li.locator('.stst')).toContainText('text');
  await li.locator('.stspread').uncheck(); // (spread lines always fill the height)
  await expect.poll(textSize).not.toEqual([43.4, 17.4]);
  const before = await textSize();
  // the first line bigger: the text gets taller relative to its width (it is fitted to 48 x 19 again)
  await ed.locator('div').first().click();
  await li.locator('button[data-size="1.1"]').click();
  await expect(ed.locator('div').first()).toHaveAttribute('data-pt', '11');
  await expect(li.locator('.stpt')).toHaveValue('11');
  await expect.poll(textSize).not.toEqual(before);
  // the last line: not bold, italic, underlined
  await ed.locator('div').last().click();
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
  await li.locator('button[data-cmd="bold"]').click();
  await li.locator('button[data-cmd="italic"]').click();
  await li.locator('button[data-cmd="underline"]').click();
  const html = await ed.innerHTML();
  expect(html).toMatch(/<i>|font-style: italic/);
  expect(html).toMatch(/<u>|underline/);
  // right-aligned line
  await li.locator('button[data-align="right"]').click();
  await expect(ed.locator('div').last()).toHaveAttribute('style', /text-align: right/);
  await li.locator('.stfont').selectOption('tinos');
  await expect(li.locator('.stst')).toContainText('48 × 19 mm');

  // sizes in pt: fitted, the stamp says how big the letters came out; set as typed, the text is that size
  await expect(li.locator('.stst')).toContainText(/Letters [\d.]+–[\d.]+ pt\./);
  for (let k = 0; k < 4; k++) {
    await ed.locator('div').nth(k).click();
    await li.locator('.stpt').fill('6');
  }
  await expect(ed.locator('div').nth(3)).toHaveAttribute('data-pt', '6');
  await li.locator('.stexact').selectOption('exact');
  await expect(li.locator('.stst')).toContainText('Letters 6 pt.');
  await li.locator('.stpt').fill('30');
  await expect(li.locator('.stst')).toContainText('the text was made smaller to stay inside it');
  await expect(li.locator('.stst')).toContainText('cut 48 × 19 mm.');
  await li.locator('.stpt').fill('6');
  const pdf = await PDFDocument.load(await download(page, 'exStampsProof'));
  expect(pdf.getPageCount()).toBe(1);
  const { width, height } = pdf.getPage(0).getSize();
  expect([Math.round(width / PT), Math.round(height / PT)]).toEqual([210, 297]); // A4, drawn at 1:1
  noProblems(problems);
});

test('pieczątki: your font files are kept on the server and offered in every stamp', async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  await page.goto('http://localhost:4174/');
  await page.fill('#u', 'shop'); await page.fill('#p', 'e2e password 123'); await page.click('button[type=submit]');
  await expect(page.locator('#secPresets')).toBeVisible();
  await mode(page, 'stamps');
  await page.click('#stAddText');
  await page.locator('details:has(#stFonts) summary').first().click();
  await page.setInputFiles('#stFontAdd', fixture('../../node_modules/@expo-google-fonts/great-vibes/400Regular/GreatVibes_400Regular.ttf'));
  await expect(page.locator('#stFonts')).toContainText('Great Vibes: regular');
  await expect(page.locator('#stFonts')).not.toContainText('this session only');
  const sel = page.locator('#stList li .stfont');
  await expect(sel.locator('option', { hasText: 'Great Vibes (yours)' })).toHaveCount(1);
  await sel.selectOption({ label: 'Great Vibes (yours)' });
  await expect(page.locator('#stList li .stst')).toContainText('48 × 19 mm');
  // still there after a reload
  await page.reload();
  await mode(page, 'stamps');
  await page.locator('details:has(#stFonts) summary').first().click();
  await expect(page.locator('#stFonts')).toContainText('Great Vibes: regular');
  await page.locator('#stFonts li', { hasText: 'Great Vibes' }).locator('button').click();
  await expect(page.locator('#stFonts')).not.toContainText('Great Vibes');
});

test('pieczątki: the xTool file is made on a plain http page too (no crypto.randomUUID, no crypto.subtle there)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true });
    Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true });
  });
  const problems = await openApp(page);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  await mode(page, 'stamps');
  await page.click('#stAddText');
  await expect(page.locator('#count')).toHaveText('1 stamp on the bed');
  const files = unzipDeflated(await download(page, 'exStampsXs'));
  expect(Object.keys(files)).toContain('vectors/svg/index.json');
  noProblems(problems);
});
