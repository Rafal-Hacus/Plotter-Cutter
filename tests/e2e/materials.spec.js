import { test, expect } from '@playwright/test';
import { download, mode, noProblems, openApp, setField, unzip } from './helpers.js';
import { pltValues } from '../../src/core/plt.js';

const sqPlt = async page => {
  const files = unzip(await download(page, 'exSqPlt'));
  return pltValues(Object.values(files)[0].toString());
};

test('a material profile fills the force and speed fields, and the exported PLT follows it', async ({ page }) => {
  const problems = await openApp(page);
  await mode(page, 'squares');
  await expect(page.locator('#count')).toHaveText(/pieces/);
  await expect(page.locator('#matSel option')).toHaveText(['No material profile', 'Sticker paper (kiss + easy-peel die)', 'Vinyl', 'Card 300 g (die through)']);

  // a new profile from edited fields
  await setField(page, 'dieForce', '95');
  await setField(page, 'cutSpeed', '7');
  await page.click('#matSave');
  await page.fill('#matName', 'Thick card');
  await page.click('#matNameOk');
  await expect(page.locator('#matSel option:checked')).toHaveText('Thick card');
  await expect(page.locator('#matDirty')).toBeHidden();

  // another profile puts its values in the fields and the PLT
  await page.selectOption('#matSel', { label: 'Sticker paper (kiss + easy-peel die)' });
  await expect(page.locator('#dieForce')).toHaveValue('60');
  await expect(page.locator('#cutSpeed')).toHaveValue('13');
  expect(await sqPlt(page)).toEqual({ force: 60, speed: 13, up: 13 });

  await page.selectOption('#matSel', { label: 'Thick card' });
  await expect(page.locator('#dieForce')).toHaveValue('95');
  await expect(page.locator('#cutSpeed')).toHaveValue('7');
  expect(await sqPlt(page)).toEqual({ force: 95, speed: 7, up: 13 });

  // an edit marks it as changed; Save keeps it
  await setField(page, 'dieForce', '100');
  await expect(page.locator('#matDirty')).toBeVisible();
  await page.click('#matUpdate');
  await expect(page.locator('#matDirty')).toBeHidden();
  // a profile without its own knife leaves the blade offset alone
  await setField(page, 'bladeOffset', '0.3');
  await expect(page.locator('#matDirty')).toBeHidden();

  // kept in the browser
  await page.reload();
  await expect(page.locator('#matSel option:checked')).toHaveText('Thick card');
  await expect(page.locator('#dieForce')).toHaveValue('100');
  await expect(page.locator('#matDirty')).toBeHidden();
  noProblems(problems);
});

test('Tools → Test cut downloads a print PDF and the test PLTs for the current sheet', async ({ page }) => {
  const problems = await openApp(page);
  await setField(page, 'kissForce', '50');
  await setField(page, 'dieForce', '110');
  await page.click('#toolTestOpen');
  await expect(page.locator('#toolTest')).toBeVisible();
  const files = unzip(await download(page, 'exTestCut'));
  expect(Object.keys(files)).toEqual(['test-cut-print.pdf', '1-blade-offset.plt', '2-marks.plt', '3-kiss.plt', '4-die.plt', 'read-me.txt']);
  expect(files['test-cut-print.pdf'].subarray(0, 5).toString()).toBe('%PDF-');
  // the standard 310 x 440 sheet: marks 5.5 mm in
  for (const name of ['1-blade-offset.plt', '2-marks.plt', '3-kiss.plt', '4-die.plt']) expect(files[name].toString()).toMatch(/^IN FSIZE17160,11960 CMD:32,0,0,400,400;/);
  expect(['1-blade-offset.plt', '3-kiss.plt', '4-die.plt'].map(n => pltValues(files[n].toString()).force)).toEqual([50, 50, 110]);
  await expect(page.locator('#testCutMsg')).toHaveText(/Downloaded/);
  noProblems(problems);
});
