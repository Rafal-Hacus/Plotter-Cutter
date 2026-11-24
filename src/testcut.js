// Tools → Test cut: a print PDF and the PLTs of the test cut (see core/testcut.js) on the current sheet, in one zip.
import { PT } from './core/matrix.js';
import { TEST_OFFSETS, testCutLayout, testCutPlts } from './core/testcut.js';
import { makeZip } from './core/zip.js';
import { byId, saveFile } from './dom.js';
import { drawShapes, printPage } from './export/pdf-draw.js';
import { embedSans, ensureLibs } from './lib/pdf.js';
import { readOpts } from './settings.js';
import { state } from './state.js';
import { markFrame, templateShapes } from './template.js';

const mm = v => String(Math.round(v * 1000) / 1000);
const offsets = TEST_OFFSETS.map(v => v.toFixed(2)).join(', ');

async function buildPrintPdf(L, o) {
  await ensureLibs();
  const { PDFDocument, rgb } = window.PDFLib, t = state.template, Wpt = t.wMm * PT, Hpt = t.hMm * PT, black = rgb(0, 0, 0);
  const pdf = await PDFDocument.create(), font = await embedSans(pdf), page = printPage(pdf, Wpt, Hpt);
  drawShapes(page, templateShapes(), Hpt);
  const P = (x, y) => ({ x: x * PT, y: Hpt - y * PT });
  const text = (s, [x, y], size = 7) => page.drawText(s, { ...P(x, y), x: x * PT - font.widthOfTextAtSize(s, size) / 2, size, font, color: black });
  const line = (a, b, th = 0.25) => page.drawLine({ start: P(...a), end: P(...b), thickness: th, color: black });
  text('Blade offset (mm), cut left to right, kiss force', L.title, 8);
  for (const sq of L.blade) text(sq.offset.toFixed(2), sq.label);
  text(`KISS ${mm(o.kissForce)} g`, L.kiss.label);
  text(`DIE ${mm(o.dieForce)} g`, L.die.label);
  // crosshair targets: a cross, a 3 mm circle and ticks every 0.5 mm along the arms to read the offset
  for (const { name, x, y } of L.targets) {
    line([x - 6, y], [x + 6, y], 0.3); line([x, y - 6], [x, y + 6], 0.3);
    page.drawCircle({ ...P(x, y), size: 3 * PT, borderColor: black, borderWidth: 0.3 });
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const d = k * 0.5, h = k % 2 ? 0.5 : 0.9;
      line([x + d, y - h], [x + d, y + h], 0.2); line([x - h, y + d], [x + h, y + d], 0.2);
    }
    text(name, [x + 5, y - 4.5], 8);
  }
  pdf.setTitle('Test cut');
  return pdf.save();
}

const README = o => `Test cut (Plotter-Cutter)

1. Print test-cut-print.pdf at 100 % (actual size), as you print a job.
2. Load the sheet and send the PLTs in order: 1-blade-offset, 2-marks, 3-kiss, then 4-die (it cuts through).

1-blade-offset.plt: ${TEST_OFFSETS.length} squares of 10 mm, left to right ${offsets} mm (printed under each), at the kiss force.
  Rounded corners: the offset is too small. A hook or loop at the corners: too large. Put the value of the square
  with sharp, clean corners in Cut lines > Knife, force and speed > Blade offset (and turn the cutter's own
  blade-offset compensation off).
2-marks.plt: a small cross on each printed target A-D (ticks every 0.5 mm). The cut cross should sit on the printed
  one. Off by the same amount on all four: set that as the mark (sensor) offset in the cutter's settings. Off by
  more towards one side: the print was scaled; print at 100 %.
3-kiss.plt (${mm(o.kissForce)} g): cuts the face, not the backing. 4-die.plt (${mm(o.dieForce)} g): the square comes out.
  Change Kiss / Die cut force under Cut lines and save it in the material profile.

Now: blade offset ${mm(o.bladeOffset)} mm, overcut ${mm(o.overcut)} mm, speed ${mm(o.cutSpeed)} / up ${mm(o.upSpeed)} cm/s.
`;

export async function buildTestCut() {
  const o = readOpts(), frame = markFrame(state.template), L = testCutLayout(frame);
  const plts = testCutPlts(frame, o);
  return makeZip([{ name: 'test-cut-print.pdf', bytes: await buildPrintPdf(L, o) }, ...plts, { name: 'read-me.txt', text: README(o) }]);
}

const dlg = byId('toolTest');
byId('toolTestOpen').addEventListener('click', () => dlg.showModal());
byId('toolTestClose').addEventListener('click', () => dlg.close());
byId('exTestCut').addEventListener('click', async () => {
  const msg = byId('testCutMsg');
  msg.textContent = ''; msg.classList.remove('warn');
  try { saveFile('test-cut.zip', await buildTestCut(), { plain: true }); msg.textContent = 'Downloaded test-cut.zip (print PDF, four PLTs, read-me).'; }
  catch (e) { msg.textContent = `Couldn’t build the test cut: ${e.message || e}`; msg.classList.add('warn'); }
});
