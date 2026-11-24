// Safe defaults per mode, and the "Will be written" line next to the export buttons.
import { test, expect } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { download, fixture, mode, noProblems, openApp, setField, unzip } from './helpers.js';
import { isBlue, isRed, pdfColours, turnedPdf } from './pdfpixels.js';

const msg = page => page.locator('#msg'), check = page => page.locator('#exportCheck');

test('print sheets: an A6 PDF is printed 1:1 by default; a format that scales or crops it says by how much', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'gang');
  await expect(page.locator('#ggFormat')).toHaveValue('file');
  // an A6 page without bleed (trim box = media box), a red square 5..25 mm in from its top left corner
  await page.setInputFiles('#gangFile', { name: 'invite-a6.pdf', mimeType: 'application/pdf', buffer: await turnedPdf(105, 148, 0, { bleed: 0 }) });
  const note = page.locator('#gangList .gfit');
  await expect(note).toContainText('1:1, as in the file (105 × 148 mm).');
  await expect(note).toContainText('The file has no bleed');
  await expect(note).not.toHaveClass(/warn/);
  await expect(msg(page)).toContainText('105 × 148 mm + 2 mm bleed');
  // in the print PDF the page sits on the slot's trim at its own size, turned a quarter (8 up, the slots lie on
  // their side): the file's top left square is 5..25 mm in from the trim's left and bottom edges, its bottom right
  // one 5..25 mm in from the trim's right and top edges
  const text = await msg(page).textContent();
  expect(text).toContain('8 per sheet (2 × 4, rotated)');
  const x0 = +text.match(/left edge: ([\d.]+)/)[1], y0 = +text.match(/top: ([\d.]+)/)[1];
  const pdf = await download(page, 'exGang');
  const [red, blue, before, after] = await pdfColours(page, pdf, [[x0 + 15, y0 + 105 - 15], [x0 + 148 - 15, y0 + 15], [x0 + 3.5, y0 + 90], [x0 + 26.5, y0 + 90]]);
  expect(isRed(red), `red ${red}`).toBe(true);
  expect(isBlue(blue), `blue ${blue}`).toBe(true);
  expect(isRed(before) || isRed(after), `edges ${before} ${after}`).toBe(false);
  // the old default, 10 x 15 filled: scaled 104 % and cut, said next to the file
  await setField(page, 'ggFormat', '100x150');
  await expect(note).toContainText('Scaled to 104.1 %; 4.6 mm cut off at the left and right, 2 mm cut off at the top and bottom.');
  await expect(note).toHaveClass(/warn/);
  // the proof still builds (its labels now in an embedded font)
  expect((await PDFDocument.load(await download(page, 'exGangProof'))).getPageCount()).toBe(1);
  noProblems(problems);
});

test('guillotine: the narrowed gap is said, can be turned off, and the unprintable edge starts at 3 mm', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'guillotine');
  await expect(page.locator('#gEdge')).toHaveValue('3');
  await page.setInputFiles('#cardFile', { name: 'card-90x50.pdf', mimeType: 'application/pdf', buffer: await turnedPdf(90, 50, 0, { bleed: 3 }) });
  // 2 x 3 mm bleed fits 21; 4 mm fits 24, and the layout says so
  await expect(page.locator('#count')).toContainText('24 copies');
  await expect(msg(page)).toContainText('Space between copies 4 mm, narrowed from 2 × bleed (6 mm) to fit 24 instead of 21: the bleed between copies is 2 mm.');
  await expect(check(page)).toContainText('Print PDF: 1 page, 310 × 440 mm, bleed 3 mm, 24 copies, 2 mm between copies.');
  await setField(page, 'gSqueeze', false);
  await expect(page.locator('#count')).toContainText('21 copies');
  await expect(msg(page)).toContainText('Space between copies 6 mm (2 × bleed).');
  await expect(check(page)).toContainText('Print PDF: 1 page, 310 × 440 mm, bleed 3 mm, 21 copies.');
  noProblems(problems);
});

test('guillotine: crop marks shorter than 3 mm are warned about', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'guillotine');
  await setField(page, 'gEdge', 0);
  await page.setInputFiles('#cardFile', { name: 'card-90x50.pdf', mimeType: 'application/pdf', buffer: await turnedPdf(90, 50, 0, { bleed: 3 }) });
  // 24 at a 4.5 mm gap, 4.25 mm from the top edge: the top and bottom marks are 1.25 mm stubs
  await expect(msg(page)).toContainText('Space between copies 4.5 mm');
  await expect(msg(page)).toContainText('Crop marks at the top (1.3 mm) and bottom (1.3 mm) print shorter than 3 mm.');
  await setField(page, 'gEdge', 3);
  await expect(msg(page)).toContainText('Not enough room for printable crop marks at the top and bottom.');
  noProblems(problems);
});

test('pieczątki: letters under 6 pt get a warning, the export still works', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'stamps');
  await page.click('#stAddText');
  const li = page.locator('#stList li').nth(0);
  await li.locator('.steditor').evaluate(ed => { ed.innerHTML = '<div style="text-align: center;" data-pt="10">HHHH</div>'; ed.dispatchEvent(new Event('input')); });
  await li.locator('.steditor').evaluate(ed => { const r = document.createRange(); r.selectNodeContents(ed); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await li.locator('.stpt').fill('8');
  await expect(li.locator('.stst')).toContainText('Letters 8 pt.');
  await expect(li.locator('.stst')).not.toContainText('won’t read well');
  await li.locator('.stpt').fill('5');
  await expect(li.locator('.stexact')).toHaveValue('exact');
  await expect(li.locator('.stst')).toContainText('Letters under 6 pt (5 pt here) won’t read well on rubber');
  await expect(li.locator('.stst')).toHaveClass(/warn/);
  await expect(page.locator('#exStampsXs')).toBeEnabled();
  noProblems(problems);
});

test('stickers: the export line says what the PLTs carry, clamped as written, and the batch PDF embeds its font', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', fixture('star.svg'));
  await expect(page.locator('#count')).toContainText(/\d+ stickers? on the sheet/);
  const n = +(await page.locator('#count').textContent()).match(/\d+/)[0];
  await expect(check(page)).toContainText(`PLT: kiss 60 g / die 60 g, speed 13, blade offset 0.35 mm, overcut 0.5 mm, sheet 310 × 440 mm, ${n} pieces.`);
  await expect(check(page)).toContainText('Turn the cutter’s own blade-offset compensation OFF: the PLT already compensates.');
  await expect(check(page)).toContainText(`Print PDF: 1 page, 310 × 440 mm, artwork at 300 dpi, ${n} stickers.`);
  // a force over the plotter's limit: the line shows what the file gets, the same as the PLT header
  await setField(page, 'kissForce', 600);
  await expect(check(page)).toContainText('kiss 160 g / die 60 g');
  // (an out-of-range field holds the exports back; back in range, the PLT carries what the line said)
  await setField(page, 'kissForce', 150);
  await expect(check(page)).toContainText('kiss 150 g / die 60 g');
  const files = unzip(await download(page, 'exPlt'));
  const kiss = Object.entries(files).find(([name]) => name.endsWith('-kiss.plt'))[1].toString();
  expect(kiss).toMatch(/FS150\b/);
  expect(kiss).toMatch(/VS13\b/);
  // the batch print PDF: its label font is in the file (a named Helvetica would be swapped by the RIP)
  const zip = unzip(await download(page, 'exBatch'));
  const doc = await PDFDocument.load(zip['batch-print.pdf']);
  const fonts = doc.context.enumerateIndirectObjects().map(([, o]) => o).filter(o => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font'));
  expect(fonts.length).toBeGreaterThan(0);
  for (const f of fonts) expect(String(f.get(PDFName.of('BaseFont')))).not.toMatch(/Helvetica/);
  const descriptors = doc.context.enumerateIndirectObjects().map(([, o]) => o).filter(o => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'));
  expect(descriptors.length).toBeGreaterThan(0);
  for (const d of descriptors) expect(d.has(PDFName.of('FontFile2')) || d.has(PDFName.of('FontFile3')) || d.has(PDFName.of('FontFile'))).toBe(true);
  noProblems(problems);
});

test('print sheets: the export line gives pages, page size and bleed', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'gang');
  await page.setInputFiles('#gangFile', { name: 'a6.pdf', mimeType: 'application/pdf', buffer: await turnedPdf(105, 148, 0, { bleed: 2 }) });
  // (one print, but the layout still narrows the gap to 3 mm: the bleed between prints is said too)
  await expect(check(page)).toContainText('Print PDF: 1 page, 310 × 440 mm, bleed 2 mm, 1 print, 1.5 mm between prints.');
  await expect(check(page)).not.toContainText('PLT');
  noProblems(problems);
});

test('print sheets 1:1: a page with bleed, turned by /Rotate and with its media box off 0,0, lands on its trim', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'gang');
  const files = [];
  for (const rot of [0, 90]) files.push({ name: `a5-${rot}.pdf`, mimeType: 'application/pdf', buffer: await turnedPdf(148, 210, rot, { bleed: 3, ox: 20, oy: 35 }) });
  await page.setInputFiles('#gangFile', files);
  await expect(page.locator('#gangList .gfit').first()).toContainText('1:1, as in the file (148 × 210 mm).');
  await expect(page.locator('#gangList .gfit').nth(1)).toContainText('1:1, as in the file (148 × 210 mm).');
  await expect(msg(page)).toContainText('4 per sheet (2 × 2)');
  const text = await msg(page).textContent();
  const xs = text.match(/left edge: ([\d., ]+) mm/)[1].split(', ').map(Number), ys = text.match(/top: ([\d., ]+) mm/)[1].split(', ').map(Number);
  // print 1 (0°) and print 2 (90°) in the top row
  const pdf = await download(page, 'exGang');
  const c = await pdfColours(page, pdf, [[xs[0] + 15, ys[0] + 15], [xs[0] + 148 - 15, ys[0] + 210 - 15], [xs[2] + 15, ys[0] + 15], [xs[2] + 148 - 15, ys[0] + 210 - 15]]);
  expect(isRed(c[0]) && isBlue(c[1]) && isRed(c[2]) && isBlue(c[3]), c.join(' | ')).toBe(true);
  noProblems(problems);
});
