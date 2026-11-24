// The guillotine layouts (Guillotine and Print sheets) keep room for full-length crop marks inside the printable
// area when that costs no copies, say so when it would, and can be told to keep it anyway. Checked in the exported
// print PDF, rendered with pdftoppm.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import { download, mode, noProblems, openApp, setField } from './helpers.js';
import { turnedPdf } from './pdfpixels.js';

const PT = 72 / 25.4, K = 15; // pixels per mm in the render
const msg = page => page.locator('#msg');

// page n of a PDF as grey levels, K pixels per mm
function render(bytes, n = 1) {
  const file = test.info().outputPath(`print-${n}.pdf`);
  writeFileSync(file, bytes);
  const out = execFileSync('pdftoppm', ['-r', String(K * 25.4), '-gray', '-f', String(n), '-l', String(n), file], { maxBuffer: 1 << 28 });
  const head = out.toString('latin1', 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  return { w: +head[1], h: +head[2], px: out.subarray(head[0].length) };
}
const dark = (img, x, y) => img.px[y * img.w + x] < 160;
// the dark runs (mm from..to) along a line across the mark, a pixel either side of it, between a and b mm
function runs(img, at, a, b, vertical) {
  const out = [], c = Math.round(at * K);
  let start = null;
  for (let i = Math.round(a * K); i <= Math.round(b * K); i++) {
    const on = [-1, 0, 1].some(d => vertical ? dark(img, c + d, i) : dark(img, i, c + d));
    if (on && start == null) start = i;
    if (!on && start != null) { out.push([start / K, i / K]); start = null; }
  }
  if (start != null) out.push([start / K, b]);
  return out;
}
// the cut positions said next to the layout
async function cuts(page) {
  const t = await msg(page).textContent();
  return { xs: t.match(/left edge: ([\d., ]+) mm/)[1].split(', ').map(Number), ys: t.match(/top: ([\d., ]+) mm/)[1].split(', ').map(Number) };
}
// every crop mark on the four sides: one run each, `len` mm long, inside the printable area (`edge` mm in), on the
// cut positions; `flip`: the back page, mirrored across its long edge (x → W − x)
function checkMarks(img, { xs, ys }, { W = 310, H = 440, edge = 3, len = 5, off = 3, flip = false } = {}) {
  const top = ys[0], bottom = ys[ys.length - 1], left = xs[0], right = xs[xs.length - 1];
  const X = x => flip ? W - x : x;
  // each mark ends `off` mm from the cut, where the bleed of the copy starts: read up to a little before that
  const near = off + 0.2;
  // one run, from..to (to the end of the range read, on the bleed side), inside the printable area
  const one = (r, at, from, to, max) => {
    expect(r, `marks at ${at} between ${from} and ${to} mm`).toHaveLength(1);
    expect(Math.abs(r[0][0] - from), `mark ${r[0]} at ${at} starts at ${from}`).toBeLessThan(0.15);
    expect(Math.abs(r[0][1] - to), `mark ${r[0]} at ${at} ends at ${to}`).toBeLessThan(0.15);
    expect(r[0][0]).toBeGreaterThanOrEqual(edge - 0.1);
    expect(r[0][1]).toBeLessThanOrEqual(max - edge + 0.1);
  };
  for (const x of xs) {
    one(runs(img, X(x), 0, top - near, true), `x ${x}`, top - off - len, top - near, H);
    one(runs(img, X(x), bottom + near, H, true), `x ${x}`, bottom + near, bottom + off + len, H);
  }
  const L = flip ? W - right : left, R = flip ? W - left : right;
  for (const y of ys) {
    one(runs(img, y, 0, L - near, false), `y ${y}`, L - off - len, L - near, W);
    one(runs(img, y, R + near, W, false), `y ${y}`, R + near, R + off + len, W);
  }
}
// a two-page 90 × 50 card with 3 mm bleed: the front red, the back blue
async function duplexCard() {
  const doc = await PDFDocument.create();
  for (const color of [rgb(0.9, 0.1, 0.1), rgb(0.1, 0.2, 0.9)]) {
    const p = doc.addPage([96 * PT, 56 * PT]);
    p.setTrimBox(3 * PT, 3 * PT, 90 * PT, 50 * PT);
    p.drawRectangle({ x: 0, y: 0, width: 96 * PT, height: 56 * PT, color });
  }
  return Buffer.from(await doc.save());
}

test('guillotine: room for the crop marks is kept when it costs no copies; the marks print full length, front and back', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'guillotine');
  await setField(page, 'gEdge', 0);
  await setField(page, 'gMarksBack', true);
  await page.setInputFiles('#cardFile', { name: 'card-90x50.pdf', mimeType: 'application/pdf', buffer: await duplexCard() });
  // 24 still fit with 8 mm (3 + 5) kept for the marks: kept, and nothing to warn about
  await expect(page.locator('#count')).toContainText('24 copies');
  await expect(msg(page)).toContainText('Space between copies 3 mm');
  await expect(msg(page)).not.toContainText('crop marks');
  await expect(msg(page)).not.toContainText('Crop marks');
  const c = await cuts(page);
  expect(c.ys[0]).toBeGreaterThanOrEqual(8 - 1e-6);
  const pdf = await download(page, 'exCardPdf');
  const front = render(pdf, 1), back = render(pdf, 2);
  checkMarks(front, c, { edge: 0 });
  // the back: the marks and the cards mirrored across the long edge, so both sides register
  checkMarks(back, c, { edge: 0, flip: true });
  const cx = (c.xs[0] + c.xs[1]) / 2, cy = (c.ys[0] + c.ys[1]) / 2, at = (img, x, y) => img.px[Math.round(y * K) * img.w + Math.round(x * K)];
  expect(at(back, 310 - cx, cy)).toBeLessThan(160); // blue card, not paper
  expect(at(back, 310 - (c.xs[0] - 3.5), cy)).toBeGreaterThan(240); // past its 3 mm outer bleed: paper
  expect(at(back, 310 - (c.xs[0] - 2.5), cy)).toBeLessThan(160); // within it: the card
  noProblems(problems);
});

test('guillotine: when room for the crop marks would cost copies, the copies stay and it is said; the option keeps the room', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'guillotine');
  await expect(page.locator('#gMarkRoom')).not.toBeChecked();
  await page.setInputFiles('#cardFile', { name: 'card-90x50.pdf', mimeType: 'application/pdf', buffer: await turnedPdf(90, 50, 0, { bleed: 3 }) });
  await expect(page.locator('#count')).toContainText('24 copies');
  await expect(msg(page)).toContainText('Room for full crop marks would fit 21 instead of 24: marks at the top and bottom are not printed (full length 5 mm). Tick “Always leave room for crop marks”');
  await setField(page, 'gMarkRoom', true);
  await expect(page.locator('#count')).toContainText('21 copies');
  await expect(msg(page)).not.toContainText('Room for full crop marks');
  const c = await cuts(page);
  checkMarks(render(await download(page, 'exCardPdf')), c);
  noProblems(problems);
});

test('print sheets: the same rule, with its own option; the exported marks are full length', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'gang');
  await expect(page.locator('#ggMarkRoom')).not.toBeChecked();
  // A6 at 1:1 + 2 mm bleed: 8 per sheet only without the room for the marks
  await page.setInputFiles('#gangFile', { name: 'invite-a6.pdf', mimeType: 'application/pdf', buffer: await turnedPdf(105, 148, 0, { bleed: 0 }) });
  await expect(msg(page)).toContainText('8 per sheet');
  await expect(msg(page)).toContainText('Room for full crop marks would fit 4 instead of 8: marks on all sides are 0.5 mm (full length 5 mm)');
  await setField(page, 'ggMarkRoom', true);
  await expect(msg(page)).toContainText('4 per sheet (');
  await expect(msg(page)).not.toContainText('Room for full crop marks');
  checkMarks(render(await download(page, 'exGang')), await cuts(page));
  // a format that fits as many with the room: kept without asking
  await setField(page, 'ggMarkRoom', false);
  await setField(page, 'ggFormat', '100x150');
  await expect(msg(page)).toContainText('4 per sheet (2 × 2), 100 × 150 mm');
  await expect(msg(page)).not.toContainText('rop marks');
  checkMarks(render(await download(page, 'exGang')), await cuts(page));
  noProblems(problems);
});
