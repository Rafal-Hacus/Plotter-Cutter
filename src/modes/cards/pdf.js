import { PT, mul } from '../../core/matrix.js';
import { SLOT_RE, aiId, num, pathEl } from '../../core/svg.js';
import { tick } from '../../core/util.js';
import { setCardMsg } from '../../dom.js';
import { cssRgb } from '../../export/pdf-draw.js';
import { ensureLibs } from '../../lib/pdf.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';
import { KIND, M_TPL, backMarks, deckPer, pageDims } from './job.js';
import { backClip, backT, cardCuts, cropMarks, deckCard, deckPlan, dotCut, drawStartDot, winItem, winPlan } from './layout.js';
import { templateShapes } from './render.js';

export async function buildCardsPdf() {
  await ensureLibs();
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, drawObject } = window.PDFLib;
  const o = readOpts(), t = pageDims(), L = state.job.layout, guil = state.mode === 'guillotine', morg = state.mode === 'morgana';
  const src = await PDFDocument.load(state.job.bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const emb = await out.embedPdf(src, state.job.pages > 1 ? [0, 1] : [0]);
  const Wpt = t.wMm * PT, Hpt = t.hMm * PT, ph = L.ph, sc = L.sc;
  const F = [PT, 0, 0, -PT, 0, Hpt];                                                   // sheet mm (y down) -> PDF points
  const G = [sc / PT, 0, 0, -sc / PT, -state.job.mbx * sc / PT, ph + state.job.mby * sc / PT];   // card page points -> card mm (y down), scaled
  // each copy is clipped to its own rect on the sheet (trim plus the bleed it may keep), then drawn
  const place = (page, e, list) => {
    const name = page.node.newXObject('Card', e.ref);
    for (const { T, rc } of list) {
      const M = mul(F, mul(T, G));
      page.pushOperators(pushGraphicsState(), rectangle(rc[0] * PT, Hpt - (rc[1] + rc[3]) * PT, rc[2] * PT, rc[3] * PT), clip(), endPath(),
        concatTransformationMatrix(...M), drawObject(name), popGraphicsState());
    }
  };
  const front = printPage(out, Wpt, Hpt);
  if (guil) {
    const black = window.PDFLib.rgb(0, 0, 0);
    for (const m of cropMarks(L, o)) front.drawLine({ start: { x: m[0] * PT, y: Hpt - m[1] * PT }, end: { x: m[2] * PT, y: Hpt - m[3] * PT }, thickness: 0.25, color: black });
  }
  const drawMark = pg => { const k = M_TPL.mark; pg.drawRectangle({ x: k[0] * PT, y: Hpt - (k[1] + k[3]) * PT, width: k[2] * PT, height: k[3] * PT, color: window.PDFLib.rgb(0, 0, 0) }); };
  if (morg) drawMark(front);
  if (!guil && !morg) for (const sh of templateShapes()) {
    const d = 'M ' + sh.pts.map(q => `${(q[0] * PT).toFixed(3)} ${(q[1] * PT).toFixed(3)}`).join(' L ') + (sh.closed ? ' Z' : '');
    const opt = { x: 0, y: Hpt };
    if (sh.fill) opt.color = cssRgb(sh.fill);
    if (sh.stroke) { opt.borderColor = cssRgb(sh.stroke); opt.borderWidth = sh.sw * PT; }
    front.drawSvgPath(d, opt);
  }
  place(front, emb[0], L.items.map(it => ({ T: it.T, rc: it.clip })));
  if (emb[1]) {
    const back = printPage(out, Wpt, Hpt); if (morg) drawMark(back); place(back, emb[1], L.items.map(it => ({ T: backT(it, o), rc: backClip(it, o) })));
    if (state.mode === 'guillotine' && o.gMarksBack) for (const m of backMarks(L, o)) back.drawLine({ start: { x: m[0] * PT, y: Hpt - m[1] * PT }, end: { x: m[2] * PT, y: Hpt - m[3] * PT }, thickness: 0.25, color: window.PDFLib.rgb(0, 0, 0) });
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
// A print page whose content covers the whole sheet: a white background over the full page, plus two
// near-white specks at the top corners when there's a blank feed strip. Printers that position the page by
// its content (and centre it) then keep the layout where it is, blank strip included.
export function printPage(doc, Wpt, Hpt) {
  const page = doc.addPage([Wpt, Hpt]), { rgb } = window.PDFLib;
  page.drawRectangle({ x: 0, y: 0, width: Wpt, height: Hpt, color: rgb(1, 1, 1) });
  if (state.template && state.template.feedTop && Math.abs(Wpt - state.template.wMm * PT) < 1 && Math.abs(Hpt - state.template.hMm * PT) < 1) {
    for (const x of [3, state.template.wMm - 3.3]) page.drawRectangle({ x: x * PT, y: Hpt - 3.3 * PT, width: 0.3 * PT, height: 0.3 * PT, color: rgb(0.985, 0.985, 0.985) });
  }
  return page;
}
export async function buildDeckPdf() {
  await ensureLibs();
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, drawObject, rgb } = window.PDFLib;
  const o = readOpts(), L = state.job.layout, dk = deckPlan(o), pg = pageDims();
  const src = await PDFDocument.load(state.job.bytes, { ignoreEncryption: true }), out = await PDFDocument.create();
  const emb = await out.embedPdf(src, Array.from({ length: state.job.pages }, (_, i) => i));
  const Wpt = pg.wMm * PT, Hpt = pg.hMm * PT, ph = L.ph, sc = L.sc;
  const F = [PT, 0, 0, -PT, 0, Hpt], G = [sc / PT, 0, 0, -sc / PT, -state.job.mbx * sc / PT, ph + state.job.mby * sc / PT];
  const marks = cropMarks(L, o), black = rgb(0, 0, 0);
  for (let i = 0; i < dk.sheets; i++) {
    setCardMsg(`Sheet ${i + 1} of ${dk.sheets}…`);
    await tick();
    for (const back of deckPer() === 2 ? [false, true] : [false]) {
      const page = printPage(out, Wpt, Hpt), names = new Map();
      L.items.forEach((it, j) => {
        const c = deckCard(dk, i, j), pi = c == null ? -1 : deckPer() * c + (back ? 1 : 0);
        if (pi < 0 || pi >= state.job.pages) return; // empty slot, or the blank back of an odd last page
        if (!names.has(pi)) names.set(pi, page.node.newXObject(`P${pi}`, emb[pi].ref));
        const T = back ? backT(it, o) : it.T, rc = back ? backClip(it, o) : it.clip, M = mul(F, mul(T, G));
        page.pushOperators(pushGraphicsState(), rectangle(rc[0] * PT, Hpt - (rc[1] + rc[3]) * PT, rc[2] * PT, rc[3] * PT), clip(), endPath(),
          concatTransformationMatrix(...M), drawObject(names.get(pi)), popGraphicsState());
      });
      if (!back || o.gMarksBack) for (const m of back ? backMarks(L, o) : marks) page.drawLine({ start: { x: m[0] * PT, y: Hpt - m[1] * PT }, end: { x: m[2] * PT, y: Hpt - m[3] * PT }, thickness: 0.25, color: black });
    }
  }
  out.setTitle(state.mode === 'deck' ? `Card deck, ${dk.sets} sets` : `Guillotine, ${dk.total} cards`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
export async function buildWinietkaPdf() {
  await ensureLibs();
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, drawObject } = window.PDFLib;
  const o = readOpts(), t = pageDims(), L = state.job.layout, wp = winPlan(o), out = await PDFDocument.create();
  const Wpt = t.wMm * PT, Hpt = t.hMm * PT, F = [PT, 0, 0, -PT, 0, Hpt], docs = new Map(), embs = new Map(), marks = templateShapes();
  const embOf = async k => {
    if (embs.has(k)) return embs.get(k);
    const it = state.job.items[k];
    if (!docs.has(it.bytes)) docs.set(it.bytes, await PDFDocument.load(it.bytes, { ignoreEncryption: true }));
    const [e] = await out.embedPdf(docs.get(it.bytes), [it.page]);
    embs.set(k, e);
    return e;
  };
  for (let s = 0; s < wp.sheets; s++) {
    setCardMsg(`Sheet ${s + 1} of ${wp.sheets}…`);
    await tick();
    const page = printPage(out, Wpt, Hpt), names = new Map();
    if (dotCut(o)) drawStartDot(page, Hpt);
    else for (const sh of marks) {
      const d = 'M ' + sh.pts.map(q => `${(q[0] * PT).toFixed(3)} ${(q[1] * PT).toFixed(3)}`).join(' L ') + (sh.closed ? ' Z' : '');
      const opt = { x: 0, y: Hpt };
      if (sh.fill) opt.color = cssRgb(sh.fill);
      if (sh.stroke) { opt.borderColor = cssRgb(sh.stroke); opt.borderWidth = sh.sw * PT; }
      page.drawSvgPath(d, opt);
    }
    for (let j = 0; j < L.n; j++) {
      const k = winItem(s, j);
      if (k == null) continue;
      const it = state.job.items[k], e = await embOf(k);
      if (!names.has(k)) names.set(k, page.node.newXObject(`W${k}`, e.ref));
      // card page points -> slot mm (y down); a card of another size is stretched to the slot
      const sx = L.pw / it.w, sy = L.ph / it.h, G = [sx, 0, 0, -sy, -it.mbx * sx, L.ph + it.mby * sy];
      const slot = L.items[j], rc = slot.clip, M = mul(F, mul(slot.T, G));
      page.pushOperators(pushGraphicsState(), rectangle(rc[0] * PT, Hpt - (rc[1] + rc[3]) * PT, rc[2] * PT, rc[3] * PT), clip(), endPath(),
        concatTransformationMatrix(...M), drawObject(names.get(k)), popGraphicsState());
    }
  }
  out.setTitle(`Winietki, ${wp.total} pcs`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
