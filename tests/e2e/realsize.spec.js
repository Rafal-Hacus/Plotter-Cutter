// SVGs come in at their real size: physical units as given, px by the program that wrote the file (Illustrator 72,
// Inkscape 96 per inch), a guess said on the row, and a 'real size' button that puts the height back.
import { test, expect } from '@playwright/test';
import { openApp, noProblems, mode, setField, download, cutLayers, bbox } from './helpers.js';

const svgFile = (name, text) => ({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(text) });
const NS = 'xmlns="http://www.w3.org/2000/svg"';
// 120 × 80 mm, filled edge to edge, in Illustrator's px (72 per inch)
const AI = svgFile('logo-ai.svg', `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<svg version="1.1" id="Layer_1" ${NS} x="0px" y="0px" width="340.157px" height="226.772px" viewBox="0 0 340.157 226.772"><rect width="340.157" height="226.772" fill="#1d4ed8"/></svg>`);
// 100 × 50 mm of shapes on a 150 × 90 mm page, in Inkscape's px (96 per inch)
const INK = svgFile('sign-ink.svg', `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" inkscape:version="1.3.2 (091e20e, 2023-11-25)" sodipodi:docname="sign.svg" width="566.929" height="340.157" viewBox="0 0 150 90"><rect x="10" y="10" width="100" height="50" fill="#000"/></svg>`);
const BIG = svgFile('poster.svg', `<svg ${NS} width="300mm" height="420mm" viewBox="0 0 300 420"><rect width="300" height="420" fill="#c2410c"/></svg>`);
const PLAIN = svgFile('plain-px.svg', `<svg ${NS} width="377.953" height="188.976" viewBox="0 0 100 50"><rect width="100" height="50" fill="#000"/></svg>`);

test('stickers: an Illustrator px file comes in at 120 × 80 mm (was 50 mm high), real size button puts it back', async ({ page }) => {
  const problems = await openApp(page);
  await setField(page, 'kiss', 0);
  await page.setInputFiles('#files', [AI]);
  const row = page.locator('#list li.design');
  await expect(row.locator('.fsize')).toHaveText('file 120 × 80 mm · size read from px at 72 dpi (Illustrator file)');
  await expect(row.locator('.fsize')).not.toHaveClass(/warn/);
  await expect(row.locator('.h')).toHaveValue('80');
  await expect(row.locator('.status')).toContainText('Art 120 × 80 mm');
  // the exported kiss cut is the artwork's edge: 120 × 80 mm (the sticker may be turned on the sheet)
  const kiss = cutLayers((await download(page, 'exCut')).toString()).Kiss_cut;
  const b = bbox(kiss[0]);
  const dims = [b[2] - b[0], b[3] - b[1]].sort((p, q) => q - p);
  expect(dims[0]).toBeCloseTo(120, 0);
  expect(dims[1]).toBeCloseTo(80, 0);
  // typed smaller, then back to real size
  await row.locator('.h').fill('30');
  await expect(row.locator('.status')).toContainText('Art 45 × 30 mm');
  await row.locator('.real').click();
  await expect(row.locator('.h')).toHaveValue('80');
  await expect(row.locator('.status')).toContainText('Art 120 × 80 mm');
  noProblems(problems);
});

test('stickers: a 300 × 420 mm file is 300 × 420 mm (was 35.7 × 50); a px file of unknown origin says it is a guess', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', [BIG, PLAIN]);
  const rows = page.locator('#list li.design');
  await expect(rows.nth(0).locator('.fsize')).toHaveText('file 300 × 420 mm');
  await expect(rows.nth(0).locator('.h')).toHaveValue('420');
  await expect(rows.nth(0).locator('.status')).toContainText('Art 300 × 420 mm', { timeout: 60_000 });
  await expect(rows.nth(1).locator('.fsize')).toHaveText('file 100 × 50 mm · size guessed from px at 96 dpi: check');
  await expect(rows.nth(1).locator('.fsize')).toHaveClass(/warn/);
  await expect(rows.nth(1).locator('.h')).toHaveValue('50');
  noProblems(problems);
});

test('stickers: no size and no viewBox starts at 50 mm and says so; an absurd size too', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', [
    svgFile('nosize.svg', `<svg ${NS}><rect x="10" y="10" width="40" height="20" fill="#000"/></svg>`),
    svgFile('huge.svg', `<svg ${NS} width="8000mm" height="6000mm" viewBox="0 0 80 60"><rect width="80" height="60" fill="#000"/></svg>`)
  ]);
  const rows = page.locator('#list li.design');
  await expect(rows.nth(0).locator('.status')).toContainText('No size and no viewBox in this file: started at 50 mm height');
  await expect(rows.nth(0).locator('.status')).toContainText('Art 100 × 50 mm');
  await expect(rows.nth(0).locator('.fsize')).toHaveText('file: no usable size');
  await expect(rows.nth(0).locator('.real')).toBeHidden();
  await expect(rows.nth(1).locator('.status')).toContainText('The file says 8000 × 6000 mm, which can’t be right: started at 50 mm height');
  await expect(rows.nth(1).locator('.h')).toHaveValue('50');
  noProblems(problems);
});

test('vinyl: an Inkscape px file is cut at its real size (100 × 50 mm), real size button after a typed height', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'vinyl');
  await page.setInputFiles('#files', [INK]);
  const row = page.locator('#list li.design');
  await expect(row.locator('.fsize')).toHaveText('file 150 × 90 mm · size read from px at 96 dpi (Inkscape file)');
  await expect(row.locator('.status')).toContainText('Cut 100 × 50 mm');
  await expect(row.locator('.h')).toHaveValue('50');
  await row.locator('.h').fill('20');
  await expect(row.locator('.status')).toContainText('Cut 40 × 20 mm');
  await row.locator('.real').click();
  await expect(row.locator('.status')).toContainText('Cut 100 × 50 mm');
  await expect(row.locator('.h')).toHaveValue('50');
  noProblems(problems);
});

test('SVG to PLT: live text is pointed out, louder when drawn like a cut line; an Inkscape px file is read at 96 dpi', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'svgplt');
  const marks = [[0, 0], [290, 0], [0, 290], [290, 290]].map(([x, y]) => `<rect x="${x}" y="${y}" width="10" height="1"/><rect x="${x + (x ? 9 : 0)}" y="${y}" width="1" height="10"/>`).join('');
  const file = (name, extra, root = 'width="300mm" height="300mm"') => svgFile(name, `<svg ${NS} ${root} viewBox="0 0 300 300">${marks}<rect x="50" y="50" width="100" height="100" fill="none" stroke="#f00"/>${extra}</svg>`);
  await page.setInputFiles('#spFile', [file('t1.svg', '<text x="60" y="200" font-size="20">Hello</text>')]);
  await expect(page.locator('#msg')).toContainText('1 live text element (not converted to curves) isn’t cut');
  await page.setInputFiles('#spFile', [file('t2.svg', '<text x="60" y="200" font-size="20" fill="none" stroke="#f00">Hi</text><text x="60" y="250" fill="none" stroke="#f00">Ho</text>')]);
  await expect(page.locator('#msg')).toContainText('2 live text elements are drawn like a cut line but won’t be cut');
  // 300 mm at 96 dpi = 1133.858 px, from Inkscape: read as 300 mm (the 72 dpi default would make it 400 mm)
  await page.setInputFiles('#spFile', [file('ink.svg', '', `xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1.2" width="1133.858" height="1133.858"`)]);
  await expect(page.locator('#msg')).toContainText('ink: 300 × 300 mm (size in px, read as 96 per inch)');
  noProblems(problems);
});
