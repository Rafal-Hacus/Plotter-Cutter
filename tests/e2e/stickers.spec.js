import { test, expect } from '@playwright/test';
import { openApp, noProblems, setField, download, unzip, cutLayers, pltStrokes, distToLoops, bbox, inside, fixture, enabled } from './helpers.js';

const FILES = ['star.svg', 'u.svg', 'cut.svg'].map(fixture);
// generated SRA3 template: mark centre lines 5.5 mm in
const RIGHT = 310 - 5.5, BOTTOM = 440 - 5.5;

async function sheet(page, opts) {
  const problems = await openApp(page);
  for (const [k, v] of Object.entries(opts)) await setField(page, k, v);
  await page.setInputFiles('#files', FILES);
  await enabled(page, 'exCut');
  await expect(page.locator('#count')).toHaveText(/\d+ stickers on the sheet/);
  return problems;
}

for (const cfg of [{ kiss: 2, die: 2, joinGap: 3 }, { kiss: 0, die: 5, joinGap: 0 }, { kiss: 1, die: 0.5, joinGap: 3, quality: 'fine' }]) {
  test(`easy-peel line sits ${cfg.die} mm outside the kiss line (kiss ${cfg.kiss}, join ${cfg.joinGap})`, async ({ page }) => {
    const problems = await sheet(page, { ...cfg, bladeOffset: 0, overcut: 0 });
    const L = cutLayers((await download(page, 'exCut')).toString());
    const kiss = L.Kiss_cut, die = L.Die_cut;
    expect(kiss.length).toBeGreaterThan(10);
    expect(die.length).toBeGreaterThan(10);
    for (const d of die) {
      const own = kiss.filter(k => inside(bbox(k), bbox(d)));
      expect(own.length).toBeGreaterThan(0);
      const dist = d.map(p => distToLoops(p, own)).sort((a, b) => a - b);
      // never closer than the margin; the median right on it (notches narrower than the join distance get filled, so the max can be more)
      expect(dist[0]).toBeGreaterThan(cfg.die - 0.06);
      expect(dist[dist.length >> 1]).toBeLessThan(cfg.die + 0.08);
      // (the round corners of the cut-line sticker come out up to ~0.08 mm short: 0.1 mm pixels, 0.05 mm simplification)
      for (const k of own) for (const p of k) expect(distToLoops(p, [d])).toBeGreaterThan(cfg.die - 0.1);
    }
    // die lines of different stickers keep the 'space between die cuts' (2 mm default) apart
    for (let i = 0; i < die.length; i++) for (let j = i + 1; j < die.length; j++) {
      const a = bbox(die[i]), b = bbox(die[j]);
      if (a[0] > b[2] + 3 || b[0] > a[2] + 3 || a[1] > b[3] + 3 || b[1] > a[3] + 3) continue;
      for (const p of die[i]) expect(distToLoops(p, [die[j]])).toBeGreaterThan(1.9);
    }
    noProblems(problems);
  });
}

test('PLT files trace exactly the lines in the cut SVG', async ({ page }) => {
  const problems = await sheet(page, { bladeOffset: 0, overcut: 0 });
  const L = cutLayers((await download(page, 'exCut')).toString());
  const zip = unzip(await download(page, 'exPlt'));
  for (const [suffix, layer] of [['-kiss.plt', 'Kiss_cut'], ['-die.plt', 'Die_cut']]) {
    const name = Object.keys(zip).find(n => n.endsWith(suffix));
    const strokes = pltStrokes(zip[name].toString()).slice(1); // without the start-arrow V cut
    expect(strokes.length).toBe(L[layer].length);
    for (const s of strokes) for (const [X, Y] of s) {
      // plotter units (1/40 mm, X up the sheet, Y to the left, origin bottom-right mark) back to sheet mm
      expect(distToLoops([RIGHT - Y / 40, BOTTOM - X / 40], L[layer])).toBeLessThan(0.013);
    }
  }
  noProblems(problems);
});

test('PLT modifier "fix dense paths" keeps every outline (regression)', async ({ page }) => {
  const problems = await sheet(page, { bladeOffset: 0, overcut: 0 });
  const original = await download(page, 'exPlt');
  await page.setInputFiles('#modFile', { name: 'sheet-plt.zip', mimeType: 'application/zip', buffer: original });
  await setField(page, 'modClean', true);
  const before = unzip(original), after = unzip(await download(page, 'exMod'));
  for (const name of Object.keys(before)) {
    const a = pltStrokes(before[name].toString()), b = pltStrokes(after[name].toString());
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      // every original point stays within 0.05 mm (2 units) of the simplified stroke
      const loop = b[i];
      for (const p of a[i]) expect(distToLoops(p, [loop])).toBeLessThan(2.01);
    }
  }
  noProblems(problems);
});

test('a PDF sticker (picture + a cut line): the kiss cut follows the PDF\'s line; or traced; or a circle', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', [fixture('sticker-cutline.pdf'), fixture('sticker-cutlayer.pdf')]);
  const rows = page.locator('#list li.design');
  await expect(rows).toHaveCount(2);
  const [line, layer] = [rows.nth(0), rows.nth(1)];
  // the line in the PDF is found and used; on a layer of its own it is kept off the print
  await expect(line.locator('.m')).toHaveValue('cut');
  await expect(line.locator('.status')).toContainText('Kiss cut along the line drawn in the PDF. It is part of the page, so it prints too');
  await expect(layer.locator('.status')).toContainText('Its layer is left out of the print.');
  // the pictures the stickers print from: the magenta line in the first, none in the second
  const magenta = await page.evaluate(async () => Promise.all([...document.querySelectorAll('#list .thumb image')].map(async el => {
    const u = decodeURIComponent(el.getAttribute('href') || '').match(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/)[0], im = new Image();
    im.src = u; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k] > 180 && d[k + 1] < 80 && d[k + 2] > 80 && d[k + 2] < 200) n++;
    return n;
  })));
  expect(magenta[0]).toBeGreaterThan(1000);
  expect(magenta[1]).toBe(0);
  // the cut line is 58 x 40 mm in the PDF: at its own height of 40 mm it comes out 58 mm wide
  await line.locator('.h').fill('40');
  await expect(line.locator('.status')).toContainText('Cut line 58 × 40 mm');
  // the kiss-cut lines: the PDF's rounded box (58 x 40) for each sticker of the first file
  await enabled(page, 'exCut');
  const kiss = cutLayers((await download(page, 'exCut')).toString()).Kiss_cut;
  expect(kiss.some(k => { const b = bbox(k), w = b[2] - b[0], h = b[3] - b[1]; return Math.abs(Math.max(w, h) - 58) < 0.3 && Math.abs(Math.min(w, h) - 40) < 0.3; })).toBe(true); // (upright or turned)
  // traced instead: the outline follows the artwork (a picture and a circle), not the box
  await line.locator('.m').selectOption('trace');
  await expect(line.locator('.status')).toContainText('Kiss cut traced around the artwork');
  // or a circle: its size and position fields appear
  await line.locator('.m').selectOption('round');
  await expect(line.locator('.circ')).toBeVisible();
  await expect(line.locator('.status')).toContainText('Round sticker');
  noProblems(problems);
});

test('a PDF sticker with its cut line in a CutContour spot colour: cut along it, left out of the print, real size', async ({ page }) => {
  const problems = await openApp(page);
  await page.setInputFiles('#files', fixture('sticker-cutspot.pdf'));
  const row = page.locator('#list li.design');
  await expect(row.locator('.status')).toContainText('Its spot colour (CutContour) is left out of the print.');
  await expect(row.locator('.m')).toHaveValue('cut');
  // the cut line's own size in the PDF (58 x 40 mm), not the page's
  await expect(row.locator('.h')).toHaveValue('40');
  await expect(row.locator('.status')).toContainText('Cut line 58 × 40 mm');
  // the picture it prints from has no magenta line
  const magenta = await page.evaluate(async () => {
    const el = document.querySelector('#list .thumb image');
    const u = decodeURIComponent(el.getAttribute('href') || '').match(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/)[0], im = new Image();
    im.src = u; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k] > 180 && d[k + 1] < 80 && d[k + 2] > 80 && d[k + 2] < 200) n++;
    return n;
  });
  expect(magenta).toBe(0);
  // the kiss cut is the spot-colour line
  await enabled(page, 'exCut');
  const kiss = cutLayers((await download(page, 'exCut')).toString()).Kiss_cut;
  expect(kiss.some(k => { const b = bbox(k), w = b[2] - b[0], h = b[3] - b[1]; return Math.abs(Math.max(w, h) - 58) < 0.3 && Math.abs(Math.min(w, h) - 40) < 0.3; })).toBe(true); // (upright or turned)
  noProblems(problems);
});

// Where blue prints on page 1 of a PDF: its box in mm and its area in mm² (drawn with the app's own pdf.js at 150 dpi).
const blueInk = (page, bytes) => page.evaluate(async b64 => {
  const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  const pdf = await window.pdfjsLib.getDocument({ data: bin }).promise, pg = await pdf.getPage(1), vp = pg.getViewport({ scale: 150 / 72 });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const k = (y * c.width + x) * 4;
    if (d[k + 2] > 180 && d[k] < 80 && d[k + 1] < 80) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  }
  return { box: [x0, y0, x1, y1].map(v => v * 25.4 / 150), area: n * (25.4 / 150) ** 2 };
}, bytes.toString('base64'));

test('a PDF sticker whose crop box is smaller than its media box prints in register with its cut line', async ({ page }) => {
  // 60 x 40 mm media box cropped 2 mm on every side; a blue 50 x 30 mm box 2 mm inside a 54 x 34 mm cut line
  const problems = await openApp(page);
  await page.setInputFiles('#files', fixture('sticker-cropbox.pdf'));
  const row = page.locator('#list li.design');
  await expect(row.locator('.m')).toHaveValue('cut');
  await row.locator('.q').fill('1');
  await expect(page.locator('#count')).toHaveText('1 sticker on the sheet');
  const kiss = bbox(cutLayers((await download(page, 'exCut')).toString()).Kiss_cut[0]);
  const blue = (await blueInk(page, await download(page, 'exPdf'))).box;
  // upright or turned, the print sits 2 mm inside the kiss cut on every side (it was 2 mm off on two sides)
  for (let i = 0; i < 4; i++) expect(Math.abs(blue[i] - kiss[i]), `side ${i}: print ${blue} kiss ${kiss}`).toBeCloseTo(2, 0);
  noProblems(problems);
});

test('an SVG sticker with a cut line comes in at the cut line\'s real size; switching the kiss cut keeps the size', async ({ page }) => {
  // cut.svg: a 60 x 40 mm file with a 50 x 30 mm cut line (the height used to be the file's, so it came out 66.7 x 40)
  const problems = await openApp(page);
  await page.setInputFiles('#files', fixture('cut.svg'));
  const row = page.locator('#list li.design');
  await expect(row.locator('.m')).toHaveValue('cut');
  await expect(row.locator('.h')).toHaveValue('30');
  await expect(row.locator('.status')).toContainText('Cut line 50 × 30 mm');
  // traced instead: the height is now the artwork's, at the same scale
  await row.locator('.m').selectOption('trace');
  await expect(row.locator('.h')).toHaveValue('40');
  await expect(row.locator('.status')).toContainText('Art 60 × 40 mm');
  await row.locator('.m').selectOption('cut');
  await expect(row.locator('.h')).toHaveValue('30');
  await expect(row.locator('.status')).toContainText('Cut line 50 × 30 mm');
  noProblems(problems);
});

test('traced with "ignore white", a sticker\'s white background never prints over its neighbours', async ({ page }) => {
  // a 60 x 60 mm white page (PDF: printed as vectors; SVG: as pixels) with a blue Ø 20 mm circle: traced around the
  // circle the stickers sit ~28 mm apart, so each page's white square used to cover parts of the circles around it
  const problems = await openApp(page);
  await setField(page, 'ignoreWhite', true);
  await page.setInputFiles('#files', [fixture('sticker-whitebg.pdf'), fixture('sticker-whitebg.svg')]);
  const rows = page.locator('#list li.design');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).locator('.m').selectOption('trace');
  for (const i of [0, 1]) await rows.nth(i).locator('.q').fill('8');
  await expect(page.locator('#count')).toHaveText('16 stickers on the sheet');
  await expect(rows.nth(0).locator('.status')).toContainText('die cut 28');
  const { area } = await blueInk(page, await download(page, 'exPdf'));
  expect(area / (16 * Math.PI * 100)).toBeCloseTo(1, 1); // every circle prints whole
  noProblems(problems);
});

test('typed copies nest as densely as Fill: 6 per SRA3 sheet of a 96 x 145 mm sticker, and the order in sheets', async ({ page }) => {
  // (the cut line of the shop's wino_teresy_14_5cm_cut.pdf: Fill put 6 on a sheet, copies 6 or 12 only 5 a sheet)
  const problems = await openApp(page);
  await page.setInputFiles('#files', fixture('sticker-96x145-cutspot.pdf'));
  const row = page.locator('#list li.design'), count = page.locator('#count'), msg = page.locator('#msg');
  await expect(row.locator('.status')).toContainText('Cut line 96 × 145 mm');
  await expect(count).toHaveText('6 stickers on the sheet');
  await row.locator('.q').fill('6');
  await expect(msg).toHaveText(/6 pieces → 1 sheet\./);
  await expect(count).toHaveText('6 stickers on the sheet');
  await row.locator('.q').fill('12');
  await expect(msg).toHaveText(/12 pieces → 2 sheets\./);
  await expect(count).toHaveText('6 stickers on the sheet');
  await expect(msg).not.toContainText('Only');
  // the sheet's cut file has the 6
  expect(cutLayers((await download(page, 'exCut')).toString()).Kiss_cut.length).toBe(6);
  // the batch export makes the 12 as 2 sheets of 6
  const z = unzip(await download(page, 'exBatch'));
  expect(z['batch-sheets.txt'].toString().trim().split('\n').map(l => l.replace(/^.*?: /, ''))).toEqual(['sticker-96x145-cutspot.pdf x6', 'sticker-96x145-cutspot.pdf x6']);
  // an order of 500: 84 sheets, the last could take 4 more
  await row.locator('.q').fill('500');
  await expect(msg).toContainText('500 pieces → 84 sheets (+ 4 overs on the last).');
  noProblems(problems);
});
