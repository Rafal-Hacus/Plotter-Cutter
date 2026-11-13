import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { download, fixture, mode, noProblems, openApp, setField, unzip } from './helpers.js';

const PT = 72 / 25.4;
// the cut loops of a PLT: each starts with a pen-up move to its first point
const loops = plt => String(plt).split(/\s+/).filter(t => /^U-?\d+,-?\d+$/.test(t)).length - 2; // (less the start arrow and the move off the sheet at the end)

test('roll: PDFs packed on the roll width with marks; copies from the file name; cut along the outline or the rounded trim', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'roll');
  await setField(page, 'rollW', 400);
  await page.setInputFiles('#rollFile', [fixture('sign_100x150mm_3szt.pdf'), fixture('label_80x30mm_4pcs.pdf')]);
  await expect(page.locator('#count')).toContainText('7 pieces');
  const sign = page.locator('#rollList li').nth(0), label = page.locator('#rollList li').nth(1);
  await expect(sign.locator('.rq')).toHaveValue('3');
  await expect(label.locator('.rq')).toHaveValue('4');
  // the sign has an outline drawn in it, the label hasn't
  const outerOff = li => li.locator('.rc option[value="outer"]').evaluate(o => o.disabled);
  expect(await outerOff(sign)).toBe(false);
  expect(await outerOff(label)).toBe(true);
  await sign.locator('.rc').selectOption('outer');
  await expect(sign.locator('.rs')).toContainText('Cut along the outermost line: 99.5 × 149.5 mm.');
  await expect(sign.locator('.rr')).toBeDisabled();
  await label.locator('.rr').fill('3');

  // cut files: 7 loops, sheet as wide as the roll
  const plt = unzip(await download(page, 'exRollPlt'));
  const [name] = Object.keys(plt);
  expect(name).toMatch(/^roll-400mm-7pcs\.plt$/);
  expect(loops(plt[name])).toBe(7);
  const svg = (await download(page, 'exRollSvg')).toString();
  expect(svg).toContain('width="400mm"');
  expect((svg.match(/<path /g) || []).length).toBe(7);
  expect(svg).toContain('scpro2_x5F_regmarks');

  // the print PDF: one page as wide as the roll, as long as the layout
  const pdf = await PDFDocument.load(await download(page, 'exRollPdf'));
  expect(pdf.getPageCount()).toBe(1);
  const { width, height } = pdf.getPage(0).getSize();
  expect(Math.round(width / PT)).toBe(400);
  const H = height / PT;
  expect(svg).toContain(`height="${Math.round(H * 1000) / 1000}mm"`);
  noProblems(problems);
});

test('roll: split into sheets, each with its own marks and PLT', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'roll');
  await setField(page, 'rollW', 200); await setField(page, 'rollMax', 250); await setField(page, 'rollTurn', false);
  await page.setInputFiles('#rollFile', [fixture('sign_100x150mm_3szt.pdf')]);
  await expect(page.locator('#msg')).toContainText('3 sheets');
  const plt = unzip(await download(page, 'exRollPlt'));
  expect(Object.keys(plt).sort()).toEqual(['roll-200mm-3pcs-sheet1.plt', 'roll-200mm-3pcs-sheet2.plt', 'roll-200mm-3pcs-sheet3.plt']);
  const pdf = await PDFDocument.load(await download(page, 'exRollPdf'));
  expect(pdf.getPageCount()).toBe(3);
  noProblems(problems);
});
