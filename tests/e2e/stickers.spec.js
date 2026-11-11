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
      for (const k of own) for (const p of k) expect(distToLoops(p, [d])).toBeGreaterThan(cfg.die - 0.06);
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
