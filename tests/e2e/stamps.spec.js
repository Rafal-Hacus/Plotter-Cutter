import { test, expect } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { download, fixture, mode, noProblems, openApp } from './helpers.js';

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
  await text.locator('textarea').fill('Konserwator\nŻurawie samojezdne\ntel. 600 000 000');
  await expect(text.locator('.stsize')).toHaveValue('b3');
  // fitted to 48 x 19 less 2.3 / 0.8 mm: the wider side touches, nothing stretched
  await expect(text.locator('.stst')).toContainText('48 × 19 mm: text 43.4 ×');
  await page.setInputFiles('#stSvgFile', fixture('stamp-logo.svg'));
  const logo = page.locator('#stList li').nth(1);
  await expect(logo.locator('.stst')).toContainText('1 text element was left out');
  await logo.locator('.stsize').selectOption('b4');
  await logo.locator('.stq').fill('2');
  await logo.locator('.stshape').selectOption('rect');
  await expect(logo.locator('.stst')).toContainText('59 × 25 mm: text 54.4 × 16.2 mm, cut 59 × 25 mm.');
  await expect(page.locator('#count')).toHaveText('3 stamps on the bed');

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
