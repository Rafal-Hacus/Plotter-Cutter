import { test, expect } from '@playwright/test';
import { openApp, noProblems, setField, download, mode, makePng, unzip, pltStrokes, enabled } from './helpers.js';

const NAMES = 'Anna Kowalska\nJan Nowak\n\n  Łukasz Ćwikła  \nZofia Wiśniewska-Żółkiewska\nBartłomiej Grzegorz Brzęczyszczykiewicz';
const waitCards = (page, n) => expect(page.locator('#count')).toHaveText(new RegExp(`^${n} cards on \\d+ sheet`), { timeout: 30_000 });

test('winietki from a list of names: no bleed without a background, 2 mm with one, fold and die perforation kept apart', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'winietka');
  await setField(page, 'winSrc', 'names');
  await expect(page.locator('#winNameRows')).toBeVisible();
  await page.fill('#winNames', NAMES);
  await waitCards(page, 5);
  await expect(page.locator('#winNamesInfo')).toContainText('5 names.');
  await expect(page.locator('#cardInfo')).toContainText('100 × 100 mm card + 0 mm bleed');
  await expect(page.locator('#cBleed')).toBeHidden();

  // background: 2 mm bleed on every side
  await page.setInputFiles('#winBg', { name: 'bg.png', mimeType: 'image/png', buffer: makePng(600, 400, 150) });
  await expect(page.locator('#cardInfo')).toContainText('100 × 100 mm card + 2 mm bleed', { timeout: 30_000 });
  await page.click('#winBgClear');
  await expect(page.locator('#cardInfo')).toContainText('+ 0 mm bleed', { timeout: 30_000 });
  await page.setInputFiles('#winBg', { name: 'bg.png', mimeType: 'image/png', buffer: makePng(600, 400, 150) });
  await expect(page.locator('#cardInfo')).toContainText('+ 2 mm bleed', { timeout: 30_000 });

  // tent fold with its own 1 mm / 1 mm perforation, and the perforated die cut at 6 mm / 0.8 mm
  await setField(page, 'cFoldOn', true); await setField(page, 'cFoldDir', 'h');
  await setField(page, 'cPerfCut', 1); await setField(page, 'cPerfGap', 1);
  await setField(page, 'cPerfDie', true); await setField(page, 'cTieCut', 6); await setField(page, 'cTie', 0.8);
  await expect(page.locator('#msg')).toContainText('Perforated die cut', { timeout: 30_000 });
  await enabled(page, 'exCardPlt');
  const plt = Object.values(unzip(await download(page, 'exCardPlt')))[0].toString();
  const lengths = pltStrokes(plt).map(s => s.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - s[i][0], p[1] - s[i][1]), 0) / 40);
  const near = mm => lengths.filter(l => Math.abs(l - mm) < 0.6).length;
  expect(near(1)).toBeGreaterThan(100); // the fold perforation
  expect(near(5.9)).toBeGreaterThan(100); // the die cut between bridges

  // the print PDF holds one card per name (copies of each = 1)
  const pdf = await download(page, 'exCardPdf');
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  noProblems(problems);
});

test('switching back to PDF files clears the generated cards', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'winietka');
  await setField(page, 'winSrc', 'names');
  await page.fill('#winNames', 'Anna\nJan');
  await waitCards(page, 2);
  await setField(page, 'winSrc', 'pdf');
  await expect(page.locator('#winPdfRows')).toBeVisible();
  await expect(page.locator('#count')).toHaveText(/No cards/);
  noProblems(problems);
});

// Every cut in the PLT is a straight, axis-parallel line, and all pieces of one line share one coordinate.
// The swivel the blade-offset compensation adds at the start of a cut (within 2 blade offsets of the start) is
// left out: it is meant to curve.
function checkStraight(plt, bladeOffsetMm) {
  const R = bladeOffsetMm * 40, lines = new Set();
  for (const s of pltStrokes(plt)) {
    const [a, b] = s.slice(-2), axis = a[0] === b[0] ? 0 : a[1] === b[1] ? 1 : -1;
    expect(axis, `stroke ending ${a} -> ${b} is not axis-parallel`).not.toBe(-1);
    for (const q of s) {
      if (Math.hypot(q[0] - s[0][0], q[1] - s[0][1]) <= 2 * R + 3) continue;
      expect(q[axis], `point ${q} off the line ${axis ? 'Y' : 'X'}=${b[axis]}`).toBe(b[axis]);
    }
    lines.add(`${axis}:${b[axis]}`);
  }
  return lines.size;
}

test('winietki without the sensor: start dot instead of marks, plain PLT, and every cut line dead straight', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'winietka');
  await setField(page, 'winSrc', 'names');
  await page.fill('#winNames', 'Anna Kowalska\nJan Nowak\nZofia Wiśniewska\nŁukasz Ćwikła\nOla\nPiotr');
  await setField(page, 'cFoldOn', true); await setField(page, 'cFoldDir', 'h');
  await waitCards(page, 6);
  const plts = {};
  for (const align of ['marks', 'dot']) for (const perf of [false, true]) {
    await setField(page, 'cAlign', align); await setField(page, 'cPerfDie', perf);
    await page.waitForTimeout(700);
    await enabled(page, 'exCardPlt');
    const files = unzip(await download(page, 'exCardPlt')), name = Object.keys(files)[0];
    expect(name.includes('nosensor')).toBe(align === 'dot');
    plts[`${align}${perf ? '-perf' : ''}`] = files[name].toString();
  }
  // with marks: the SignCut header and the start-arrow cut; with the dot: a plain header, nothing else
  expect(plts.marks).toMatch(/^IN FSIZE\d+,\d+ .*TB26/);
  expect(plts.dot).toMatch(/^IN VS\d+ US\d+ FS\d+ U/);
  expect(plts.dot).not.toMatch(/FSIZE|TB26|CMD:/);
  for (const [k, t] of Object.entries(plts)) {
    const body = k.startsWith('marks') ? t.replace(/ U-?\d+,-?\d+[^U]*/, ' ') : t; // without the start-arrow V cut
    expect(checkStraight(body, 0.35), k).toBe(16); // 4 vertical + 8 horizontal card edges + 4 fold lines
  }
  // same cut positions both ways: the start dot sits where the bottom-right mark's centre was
  const ends = t => pltStrokes(t).map(s => s.at(-1).join(',')).sort().join(' ');
  expect(ends(plts.dot)).toBe(ends(plts.marks.replace(/ U-?\d+,-?\d+[^U]*/, ' ')));
  // the cut shift moves the whole cut: +1 mm X = 40 units less in plotter Y (Y runs left)
  await setField(page, 'cShiftX', 1);
  await page.waitForTimeout(500);
  const shifted = Object.values(unzip(await download(page, 'exCardPlt')))[0].toString();
  const first = t => pltStrokes(t)[0].at(-1);
  expect(first(shifted)[1]).toBe(first(plts['dot-perf'])[1] - 40);
  noProblems(problems);
});
