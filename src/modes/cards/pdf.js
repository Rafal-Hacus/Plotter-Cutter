// Print PDFs and the cut SVG of the card modes.
import { PT, mul } from '../../core/matrix.js';
import { SLOT_RE, aiId, num, pathEl } from '../../core/svg.js';
import { tick } from '../../core/util.js';
import { setMsg } from '../../dom.js';
import { drawClipped, drawCropMarks, drawShapes, printPage, sheetToPdf } from '../../export/pdf-draw.js';
import { ensureLibs } from '../../lib/pdf.js';
import { KIND, M_TPL, deckPer, pageDims } from './job.js';
import { backClip, backMarks, backT, cardCuts, cropMarks, deckCard, deckPlan, dotCut, drawStartDot, winItem, winPlan } from './layout.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';
import { templateShapes } from '../../template.js';

// card page points -> card mm (y down from the bleed corner), at the scale the job prints at
const cardToMm = (L, job) => [L.sc / PT, 0, 0, -L.sc / PT, -job.mbx * L.sc / PT, L.ph + job.mby * L.sc / PT];

// Front and back of one sheet of identical cards.
export async function buildCardsPdf() {
  await ensureLibs();
  const { PDFDocument, rgb } = window.PDFLib;
  const o = readOpts(), job = state.job, L = job.layout, pg = pageDims();
  const guil = state.mode === 'guillotine', morg = state.mode === 'morgana';
  const src = await PDFDocument.load(job.bytes, { ignoreEncryption: true }), out = await PDFDocument.create();
  const [frontSide, backSide] = await out.embedPdf(src, job.pages > 1 ? [0, 1] : [0]);
  const Wpt = pg.wMm * PT, Hpt = pg.hMm * PT, F = sheetToPdf(Hpt), G = cardToMm(L, job);
  // each copy is clipped to its own rect on the sheet (trim plus the bleed it may keep), then drawn
  const place = (page, side, back) => {
    const name = page.node.newXObject('Card', side.ref);
    for (const it of L.items) drawClipped(page, name, back ? backClip(it, o) : it.clip, mul(F, mul(back ? backT(it, o) : it.T, G)), Hpt);
  };
  // the black mark the CardXtra reads
  const readingMark = page => { const k = M_TPL.mark; page.drawRectangle({ x: k[0] * PT, y: Hpt - (k[1] + k[3]) * PT, width: k[2] * PT, height: k[3] * PT, color: rgb(0, 0, 0) }); };

  const front = printPage(out, Wpt, Hpt);
  if (guil) drawCropMarks(front, cropMarks(L, o), Hpt);
  else if (morg) readingMark(front);
  else drawShapes(front, templateShapes(), Hpt);
  place(front, frontSide, false);
  if (backSide) {
    const back = printPage(out, Wpt, Hpt);
    if (morg) readingMark(back);
    place(back, backSide, true);
    if (guil && o.gMarksBack) drawCropMarks(back, backMarks(L, o), Hpt);
  }
  out.setTitle(`${KIND[state.mode].title}, ${L.n} pcs`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
export function buildCardCutSvg() {
  const t = state.template, o = readOpts(), u = t.u;
  const s = ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n', t.open.replace(/\s+xmlns:xlink="[^"]*"/g, '') + '\n', t.inner.replace(SLOT_RE, '') + '\n'];
  s.push(`<g id="${aiId(o.dieLayer)}">\n`);
  const st = `fill:none;stroke:${o.dieColor};stroke-width:${num(o.lineW * u)}`, doc = q => [q[0] * u + t.vb.x, q[1] * u + t.vb.y];
  const c = cardCuts();
  for (const loop of c.loops) s.push(pathEl(loop.map(doc), true, st) + '\n');
  for (const ln of [...c.folds, ...c.v, ...c.h, ...c.dashes]) s.push(pathEl(ln.map(doc), false, st) + '\n');
  s.push('</g>\n</svg>\n');
  return s.join('');
}
// Card deck, or the guillotine with every page a separate card: as many sheets as the plan needs, each slot
// carrying the card the plan puts there.
export async function buildDeckPdf() {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const o = readOpts(), job = state.job, L = job.layout, dk = deckPlan(o), pg = pageDims(), per = deckPer();
  const src = await PDFDocument.load(job.bytes, { ignoreEncryption: true }), out = await PDFDocument.create();
  const sides = await out.embedPdf(src, Array.from({ length: job.pages }, (_, i) => i));
  const Wpt = pg.wMm * PT, Hpt = pg.hMm * PT, F = sheetToPdf(Hpt), G = cardToMm(L, job), marks = cropMarks(L, o);
  for (let i = 0; i < dk.sheets; i++) {
    setMsg(`Sheet ${i + 1} of ${dk.sheets}…`);
    await tick();
    for (const back of per === 2 ? [false, true] : [false]) {
      const page = printPage(out, Wpt, Hpt), names = new Map();
      L.items.forEach((it, j) => {
        const c = deckCard(dk, i, j), pi = c == null ? -1 : per * c + (back ? 1 : 0);
        if (pi < 0 || pi >= job.pages) return; // empty slot, or the blank back of an odd last page
        if (!names.has(pi)) names.set(pi, page.node.newXObject(`P${pi}`, sides[pi].ref));
        drawClipped(page, names.get(pi), back ? backClip(it, o) : it.clip, mul(F, mul(back ? backT(it, o) : it.T, G)), Hpt);
      });
      if (!back || o.gMarksBack) drawCropMarks(page, back ? backMarks(L, o) : marks, Hpt);
    }
  }
  out.setTitle(state.mode === 'deck' ? `Card deck, ${dk.sets} sets` : `Guillotine, ${dk.total} cards`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
// Winietki: single-sided sheets with the registration marks (or the start dot), every slot its own card.
export async function buildWinietkaPdf() {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const o = readOpts(), job = state.job, L = job.layout, wp = winPlan(o), pg = pageDims(), out = await PDFDocument.create();
  const Wpt = pg.wMm * PT, Hpt = pg.hMm * PT, F = sheetToPdf(Hpt), marks = templateShapes();
  // every card page is embedded once, every source PDF opened once
  const docs = new Map(), embedded = new Map();
  const embed = async k => {
    if (!embedded.has(k)) {
      const it = job.items[k];
      if (!docs.has(it.bytes)) docs.set(it.bytes, await PDFDocument.load(it.bytes, { ignoreEncryption: true }));
      embedded.set(k, (await out.embedPdf(docs.get(it.bytes), [it.page]))[0]);
    }
    return embedded.get(k);
  };
  for (let s = 0; s < wp.sheets; s++) {
    setMsg(`Sheet ${s + 1} of ${wp.sheets}…`);
    await tick();
    const page = printPage(out, Wpt, Hpt), names = new Map();
    if (dotCut(o)) drawStartDot(page, Hpt); else drawShapes(page, marks, Hpt);
    for (let j = 0; j < L.n; j++) {
      const k = winItem(s, j);
      if (k == null) continue;
      const it = job.items[k], slot = L.items[j];
      if (!names.has(k)) names.set(k, page.node.newXObject(`W${k}`, (await embed(k)).ref));
      // card page points -> slot mm (y down); a card of another size is stretched to the slot
      const sx = L.pw / it.w, sy = L.ph / it.h, G = [sx, 0, 0, -sy, -it.mbx * sx, L.ph + it.mby * sy];
      drawClipped(page, names.get(k), slot.clip, mul(F, mul(slot.T, G)), Hpt);
    }
  }
  out.setTitle(`Winietki, ${wp.total} pcs`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
