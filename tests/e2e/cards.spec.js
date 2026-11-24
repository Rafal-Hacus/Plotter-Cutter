import { test, expect } from '@playwright/test';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { openApp, noProblems, setField, download, mode, makePng, enabled } from './helpers.js';

const PT = 72 / 25.4;
// 85.0 x 55.0 mm at 350 dpi with a 2.5 mm frame: like a card with bleed only on the top and bottom of an 85 x 50 card
const front = { name: 'front.png', mimeType: 'image/png', buffer: makePng(1171, 758, 350, 34) };
const back = { name: 'back.png', mimeType: 'image/png', buffer: makePng(1171, 758, 350, 34) };

test('card images at 100 %: bleed found per side (only top and bottom)', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'cards');
  await page.evaluate(() => { document.getElementById('icW').value = 85; document.getElementById('icH').value = 50; });
  await page.setInputFiles('#cardFile', [front, back]);
  await expect(page.locator('#icInfo')).toContainText('Bleed top and bottom: 2.5 mm, left and right: none');
  await expect(page.locator('#cardInfo')).toContainText('85 × 50 mm card');
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/);
  const pdf = await PDFDocument.load(await download(page, 'exCardPdf'));
  expect(pdf.getPageCount()).toBe(2);
  noProblems(problems);
});

test('Morgana CardXtra: 85 × 55 image fills all 20 slots without bleed', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'morgana');
  await setField(page, 'mSize', '85x55');
  await page.setInputFiles('#cardFile', [front, back]);
  await expect(page.locator('#count')).toHaveText('20 cards on the sheet');
  await expect(page.locator('#icInfo')).toContainText('cut 85 × 55 mm. Bleed top and bottom: none, left and right: none');
  // the cut positions are drawn in red
  expect(await page.locator('#stage rect[stroke="#E0262B"]').count()).toBe(20);
  // a size that doesn't match the image is refused with a clear message
  await setField(page, 'mSize', '90x55');
  await expect(page.locator('#icInfo')).toContainText('smaller than the card');
  noProblems(problems);
});

test('business cards from a PDF with a trim box', async ({ page }) => {
  const doc = await PDFDocument.create();
  for (const c of [rgb(0.9, 0.2, 0.2), rgb(0.2, 0.2, 0.9)]) {
    const p = doc.addPage([94 * PT, 54 * PT]);
    p.setTrimBox(2 * PT, 2 * PT, 90 * PT, 50 * PT);
    p.drawRectangle({ x: 0, y: 0, width: 94 * PT, height: 54 * PT, color: c });
  }
  const problems = await openApp(page);
  await mode(page, 'cards');
  await page.setInputFiles('#cardFile', { name: 'card.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#cardInfo')).toContainText('90 × 50 mm card + 2 mm bleed, two-sided');
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/);
  await enabled(page, 'exCardPlt');
  const out = await PDFDocument.load(await download(page, 'exCardPdf'));
  expect(out.getPageCount()).toBe(2);
  noProblems(problems);
});

test('business cards: perforated die cut leaves bridges, keeps corners cut, and changes nothing when off', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'cards');
  await page.setInputFiles('#cardFile', [front, back]);
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/);
  const plain = await download(page, 'exCardPlt');
  await expect(page.locator('#perfDie')).toBeVisible();
  await setField(page, 'cPerfDie', true);
  await setField(page, 'cTieCut', 6);
  await setField(page, 'cTie', 0.8);
  await expect(page.locator('#msg')).toContainText('Perforated die cut');
  const { cutLayers, unzip, pltStrokes } = await import('./helpers.js');
  // cut SVG: every grid line now in pieces, with 0.8 mm gaps between the pieces of one line
  const L = cutLayers((await download(page, 'exCardCut')).toString());
  const lines = Object.values(L)[0];
  expect(lines.length).toBeGreaterThan(100);
  const xs = new Set(lines.filter(l => l[0][0] === l.at(-1)[0]).map(l => l[0][0]));
  for (const x of xs) {
    const pieces = lines.filter(l => l[0][0] === x && l.at(-1)[0] === x).map(l => [Math.min(l[0][1], l.at(-1)[1]), Math.max(l[0][1], l.at(-1)[1])]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i][0] - pieces[i - 1][1]).toBeCloseTo(0.8, 2);
  }
  // the PLT has more, shorter cuts than without perforation
  const perf = unzip(await download(page, 'exCardPlt')), base = unzip(plain);
  const name = Object.keys(perf)[0];
  expect(pltStrokes(perf[name].toString()).length).toBeGreaterThan(pltStrokes(base[name].toString()).length * 5);
  // rounded corners: one perforated outline per card
  await setField(page, 'cCutStyle', 'rect'); await setField(page, 'cRadius', 3);
  await expect(page.locator('#msg')).toContainText('Perforated die cut');
  expect(Object.values(cutLayers((await download(page, 'exCardCut')).toString()))[0].length).toBeGreaterThan(21 * 20);
  // only in business cards for now
  await mode(page, 'vouchers');
  await expect(page.locator('#perfDie')).toBeHidden();
  noProblems(problems);
});

test('perforated die cut with the bridges near the corners: edges cut through, two bridges per card edge', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'cards');
  await page.setInputFiles('#cardFile', [front, back]);
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/);
  await setField(page, 'cPerfDie', true);
  await setField(page, 'cTie', 0.8);
  await setField(page, 'cTiePlace', 'corners');
  await setField(page, 'cTieInset', 2);
  await expect(page.locator('#rowTieInset')).toBeVisible();
  await expect(page.locator('#rowTieCut')).toBeHidden();
  await expect(page.locator('#msg')).toContainText('2 mm from the corners');
  const { cutLayers } = await import('./helpers.js');
  const lines = Object.values(cutLayers((await download(page, 'exCardCut')).toString()))[0];
  const len = l => Math.hypot(l.at(-1)[0] - l[0][0], l.at(-1)[1] - l[0][1]);
  // card edges are 90 and 50 mm: cut between the two bridges = edge - 2 x (2 + 0.8)
  expect(lines.some(l => Math.abs(len(l) - (90 - 5.6)) < 0.02)).toBe(true);
  expect(lines.some(l => Math.abs(len(l) - (50 - 5.6)) < 0.02)).toBe(true);
  // through each card corner the cut runs on: 2 mm along the card edge, then into the 4 mm gap between cards up
  // to the bridge in its middle ((4 - 0.8) / 2 = 1.6 mm): 3.6 mm pieces, so the corners themselves are cut
  expect(lines.filter(l => Math.abs(len(l) - 3.6) < 0.02).length).toBeGreaterThan(20);
  noProblems(problems);
});

test('card images: AI fills the missing side bleed (real model in the browser)', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = await openApp(page);
  await mode(page, 'cards');
  // a small card so the model runs quickly without a graphics card: 40 x 25 mm picture, card 40 x 20 mm
  await page.evaluate(() => { document.getElementById('icW').value = 40; document.getElementById('icH').value = 20; });
  await setField(page, 'icBleedHow', 'ai');
  await page.setInputFiles('#cardFile', [{ name: 'small.png', mimeType: 'image/png', buffer: makePng(472, 295, 300, 10) }]);
  await expect(page.locator('#icInfo')).toContainText('missing bleed filled by AI', { timeout: 240_000 });
  await expect(page.locator('#count')).toHaveText(/\d+ cards on the sheet/, { timeout: 240_000 });
  noProblems(problems.filter(p => !/WebGPU|webgpu|GPU adapter|adapters/i.test(p)));
});

test('guillotine: images at a preset size (A5), and A3 offered as a final size', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'guillotine');
  await expect(page.locator('#gSize option[value="A3"]')).toHaveCount(1);
  await page.setInputFiles('#cardFile', [{ name: 'flyer.png', mimeType: 'image/png', buffer: makePng(1795, 2528, 300) }]);
  await setField(page, 'icPreset', '148x210');
  await expect(page.locator('#icW')).toHaveValue('148');
  await expect(page.locator('#icH')).toHaveValue('210');
  await expect(page.locator('#cardInfo')).toContainText('148 × 210 mm', { timeout: 30_000 });
  await expect(page.locator('#count')).toHaveText(/\d+ copies? on/);
  // typing a size by hand switches the preset back to Custom
  await page.fill('#icW', '150');
  await expect(page.locator('#icPreset')).toHaveValue('custom');
  noProblems(problems);
});

test('card images: stretch to the card inside a safe margin first, then the AI fills margin and bleed last', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = await openApp(page);
  await mode(page, 'cards');
  await page.evaluate(() => { document.getElementById('icW').value = 40; document.getElementById('icH').value = 25; });
  await setField(page, 'icFit', 'stretch');
  await setField(page, 'icSafe', 3);
  await setField(page, 'cBleed', 2);
  await setField(page, 'icBleedHow', 'ai');
  // a square picture: stretched to 34 x 19 mm (40 x 25 less 3 mm on every side), out of proportion
  await page.setInputFiles('#cardFile', [{ name: 'square.png', mimeType: 'image/png', buffer: makePng(300, 300, 300, 0) }]);
  await expect(page.locator('#icInfo')).toContainText('square.png: stretched to 34 × 19 mm (inside a 3 mm safe margin)', { timeout: 240_000 });
  await expect(page.locator('#icInfo')).toContainText('Bleed filled by AI.');
  await expect(page.locator('#cardInfo')).toContainText('40 × 25 mm card + 2 mm bleed', { timeout: 240_000 });
  await expect(page.locator('#rowIcSafe')).toBeVisible();
  noProblems(problems.filter(p => !/WebGPU|webgpu|GPU adapter|adapters/i.test(p)));
});

// A card PDF the way some programs write it: a /Rotate 90 page (shown portrait, 50 × 90 mm), with printer's marks
// on a slug around the bleed box (magenta) and a black square at the top left of the trim as it is shown.
async function turnedCardWithSlug() {
  const doc = await PDFDocument.create(), s = 10, W = 90, H = 50, b = 2;
  for (const col of [rgb(0, 0, 1), rgb(0, 0.7, 0)]) {
    const pw = W + 2 * b + 2 * s, ph = H + 2 * b + 2 * s, p = doc.addPage([pw * PT, ph * PT]);
    const R = (x, y, w, h, color) => p.drawRectangle({ x: x * PT, y: y * PT, width: w * PT, height: h * PT, color });
    R(0, 0, pw, ph, rgb(1, 0, 1)); // the slug, where the marks would be
    R(s, s, W + 2 * b, H + 2 * b, rgb(1, 0, 0));
    R(s + b, s + b, W, H, col);
    R(s + b, s + b, 3, 3, rgb(0, 0, 0)); // bottom left unturned = top left once turned clockwise
    p.setBleedBox(s * PT, s * PT, (W + 2 * b) * PT, (H + 2 * b) * PT);
    p.setTrimBox((s + b) * PT, (s + b) * PT, W * PT, H * PT);
    p.setRotation(degrees(90));
  }
  return Buffer.from(await doc.save());
}
// the pages of a PDF drawn in the app's page at 4 px/mm: per page, the colour at each probe ([xMm, yMm] -> [r, g, b])
// and how many pixels are magenta
async function renderPdf(page, bytes, probes) {
  return page.evaluate(async ([b64, probes]) => {
    const pdf = await window.pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }).promise, out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i), vp = pg.getViewport({ scale: 4 * 25.4 / 72 }), cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let magenta = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k] > 200 && d[k + 1] < 60 && d[k + 2] > 200) magenta++;
      const px = probes.map(([x, y]) => { const k = (Math.round(y * 4) * cv.width + Math.round(x * 4)) * 4; return [d[k], d[k + 1], d[k + 2]]; });
      out.push({ px, magenta });
    }
    return out;
  }, [bytes.toString('base64'), probes]);
}
const isRgb = (c, want) => c.every((v, i) => Math.abs(v - want[i]) < 40);
const cutList = async page => {
  const msg = await page.locator('#msg').textContent(), list = re => re.exec(msg)[1].split(', ').map(Number);
  return [list(/Cuts from the left edge: ([\d., ]+) mm/), list(/From the top: ([\d., ]+) mm/)];
};

test('guillotine: a /Rotate page with printer’s marks prints turned like the preview, without the slug', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'guillotine');
  await page.setInputFiles('#cardFile', { name: 'turned.pdf', mimeType: 'application/pdf', buffer: await turnedCardWithSlug() });
  await expect(page.locator('#cardInfo')).toContainText('50 × 90 mm copy + 2 mm bleed, two-sided');
  await expect(page.locator('#count')).toHaveText('24 copies on the sheet');
  const [xs, ys] = await cutList(page);
  // the preview's picture of the card has the card's shape as shown (portrait)
  const ratio = await page.evaluate(async () => { const i = new Image(); i.src = document.querySelector('#stage image').getAttribute('href'); await i.decode(); return i.naturalWidth / i.naturalHeight; });
  expect(ratio).toBeCloseTo(54 / 94, 2);
  // 50 × 90 cards laid on their side: the first card spans the first two cuts each way
  expect(xs[1] - xs[0]).toBeCloseTo(90, 1); expect(ys[1] - ys[0]).toBeCloseTo(50, 1);
  const probes = [[xs[0] + 45, ys[0] + 25], [xs[0] - 1, ys[0] + 25], [xs[1] - 1.5, ys[0] + 1.5], [xs[0] + 1.5, ys[1] - 1.5]];
  const [front, back] = await renderPdf(page, await download(page, 'exCardPdf'), probes);
  expect(isRgb(front.px[0], [0, 0, 255])).toBe(true);
  expect(isRgb(front.px[1], [255, 0, 0])).toBe(true); // the bleed, not the slug
  // the card's top left (as shown), turned once more by the layout: the top right of the slot
  expect(isRgb(front.px[2], [0, 0, 0])).toBe(true);
  expect(isRgb(front.px[3], [0, 0, 255])).toBe(true);
  expect(front.magenta).toBe(0);
  expect(back.magenta).toBe(0);
  noProblems(problems);
});

// one page w x h mm; trim: [bleed] for a trim box that much inside, 0 for a trim box that is the whole page (as
// Canva writes it), null for no trim box
async function onePage(w, h, trim) {
  const doc = await PDFDocument.create(), p = doc.addPage([w * PT, h * PT]);
  p.drawRectangle({ x: 0, y: 0, width: w * PT, height: h * PT, color: rgb(0, 0, 1) });
  if (trim != null) p.setTrimBox(trim * PT, trim * PT, (w - 2 * trim) * PT, (h - 2 * trim) * PT);
  return { name: 'card.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
test('the bleed comes from the file only: never from the job before, a reload, or winietki from names', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'guillotine');
  // a card job with 3 mm bleed first, then the Canva A6 invite (trim box = media box): no bleed, the whole A6
  await page.setInputFiles('#cardFile', await onePage(96, 56, 3));
  await expect(page.locator('#cardInfo')).toContainText('90 × 50 mm copy + 3 mm bleed, single-sided');
  await page.setInputFiles('#cardFile', await onePage(105, 148, 0));
  await expect(page.locator('#cardInfo')).toContainText('105 × 148 mm copy + 0 mm bleed (the trim box is the whole page)');
  await page.reload();
  await mode(page, 'guillotine');
  await page.setInputFiles('#cardFile', await onePage(105, 148, 0));
  await expect(page.locator('#cardInfo')).toContainText('105 × 148 mm copy + 0 mm bleed');
  // no trim box: a standard size plus a little is read as that size with bleed, anything else is the card as it is
  await mode(page, 'winietka');
  await setField(page, 'winSrc', 'names');
  await setField(page, 'winNames', 'Anna\nBartek');
  await expect(page.locator('#cardInfo')).toContainText('+ 0 mm bleed');
  await mode(page, 'guillotine');
  await page.setInputFiles('#cardFile', await onePage(94, 54, null));
  await expect(page.locator('#cardInfo')).toContainText('90 × 50 mm copy + 2 mm bleed (the PDF has no trim box: taken as 90 × 50 mm plus the bleed, from its size)');
  await page.setInputFiles('#cardFile', await onePage(100, 70, null));
  await expect(page.locator('#cardInfo')).toContainText('100 × 70 mm copy + 0 mm bleed (the PDF has no trim box, so the whole page is taken as the card');
  // typed: used for this file
  await setField(page, 'cBleed', '1');
  await expect(page.locator('#cardInfo')).toContainText('98 × 68 mm copy + 1 mm bleed (as typed');
  await mode(page, 'winietka');
  await expect(page.locator('#cBleed')).toHaveValue('0');
  await page.waitForFunction(() => /"cBleed":"1"/.test(localStorage.getItem('stickerSheet.opts.v2') || ''));
  noProblems(problems);
});

test('guillotine: a Final size other than “As in the PDF” is said plainly, not only in the small print', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'guillotine');
  await setField(page, 'gSize', 'A4');
  await page.setInputFiles('#cardFile', { name: 'card.pdf', mimeType: 'application/pdf', buffer: await turnedCardWithSlug() });
  await expect(page.locator('#count')).toHaveText('1 copy on the sheet');
  await expect(page.locator('#msg')).toContainText('Final size A4: every copy is printed at 330 % (165 × 297 mm), not at the PDF’s 50 × 90 mm.');
  noProblems(problems);
});

test('card images at 100 %: a 72 dpi tag that can’t be meant for the card gives way to the resolution setting', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'cards');
  // 94 × 54 mm at 300 dpi, but the file says 72 dpi (391.6 × 225 mm)
  await page.setInputFiles('#cardFile', { name: 'card72.png', mimeType: 'image/png', buffer: makePng(1110, 638, 72) });
  await setField(page, 'icDpi', '300');
  await expect(page.locator('#icInfo')).toContainText('94 × 54 mm at 300 dpi (the file says 72 dpi');
  await expect(page.locator('#cardInfo')).toContainText('90 × 50 mm card + 2');
  noProblems(problems);
});

test('a back side shift saved far too big goes back to 0 on the next visit', async ({ page }) => {
  const problems = await openApp(page);
  await setField(page, 'cOffX', '-35');
  await setField(page, 'cOffY', '1.5');
  await page.waitForFunction(() => /"cOffX":"-35"/.test(localStorage.getItem('stickerSheet.opts.v2') || ''));
  await page.reload();
  await expect(page.locator('#cOffX')).toHaveValue('0');
  await expect(page.locator('#cOffY')).toHaveValue('1.5');
  noProblems(problems);
});
