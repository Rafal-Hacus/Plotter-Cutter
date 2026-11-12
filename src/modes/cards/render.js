// The sheet preview and the notes of the card modes.
import { CELL } from '../../core/geometry.js';
import { mul } from '../../core/matrix.js';
import { SLOT_RE, mm1, num } from '../../core/svg.js';
import { CUT_RED, byId, fillSheetPicker, plural, setMsg, ui } from '../../dom.js';
import { G_PAGE, KIND, M_TPL, deckLike, deckPer, pageDims } from './job.js';
import { backClip, backMarks, backRect, backT, cardCuts, cardFoldLines, cardGridLines, cardTrim, cropMarks, deckCard, deckPlan, dotCut, gridCut, markSide, perfDie, sheetMirror, startDotSvg, winItem, winPlan } from './layout.js';
import { updateCardInfo } from './load.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';
import { applyView } from '../../viewport.js';

export function syncPerfDie() {
  const on = state.mode === 'cards' || state.mode === 'winietka';
  byId('perfDie').hidden = !on;
  byId('perfDieRows').hidden = !on || !byId('cPerfDie').checked;
  const corners = byId('cTiePlace').value === 'corners';
  byId('rowTieInset').hidden = !corners;
  byId('rowTieCut').hidden = corners;
  byId('dotRows').hidden = byId('cAlign').value !== 'dot';
}
byId('cPerfDie').addEventListener('change', syncPerfDie);
byId('cTiePlace').addEventListener('change', syncPerfDie);
byId('cAlign').addEventListener('change', syncPerfDie);
export function renderCardPreview() {
  state.previewFrame = null;
  const t = state.template, o = readOpts(), L = state.job.layout, back = byId('showBack').checked && state.job.pages > 1 && !(deckLike() && deckPer() === 1);
  const deck = deckLike(), win = state.mode === 'winietka', guil = state.mode === 'guillotine' || deck, morg = state.mode === 'morgana';
  const p = [];
  if (guil || morg) {
    const pg = pageDims();
    state.previewFrame = { x: -8, y: -8, w: pg.wMm + 16, h: pg.hMm + 16 };
    p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${state.previewFrame.x} ${state.previewFrame.y} ${state.previewFrame.w} ${state.previewFrame.h}" role="img" aria-label="${back ? 'Back' : 'Front'} of the sheet">`);
    p.push(`<rect x="0" y="0" width="${pg.wMm}" height="${pg.hMm}" fill="#fff"/><g>`);
    if (guil && !back) { const m = o.gMargin; p.push(`<rect x="${m}" y="${m}" width="${G_PAGE.wMm - 2 * m}" height="${G_PAGE.hMm - 2 * m}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`); }
    if (morg) { const k = M_TPL.mark; p.push(`<rect x="${k[0]}" y="${k[1]}" width="${k[2]}" height="${k[3]}" fill="#000"/>`); }
  } else {
    p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${t.vb.x} ${t.vb.y} ${t.vb.w} ${t.vb.h}" role="img" aria-label="${back ? 'Back' : 'Front'} of the sheet">`);
    p.push(`<rect x="${t.vb.x}" y="${t.vb.y}" width="${t.vb.w}" height="${t.vb.h}" fill="#fff"/>`);
    if (!back && dotCut(o)) p.push(`<g transform="translate(${t.vb.x} ${t.vb.y}) scale(${t.u})">${startDotSvg()}</g>`);
    else if (!back) p.push(`<g>${t.inner.replace(SLOT_RE, '')}</g>`);
    p.push(`<g transform="translate(${t.vb.x} ${t.vb.y}) scale(${t.u})">`);
    if (!back && state.sheetCache && state.sheetCache.free) {
      const f = state.sheetCache.free;
      p.push(`<rect x="${f.x0 * CELL}" y="${f.y0 * CELL}" width="${(f.x1 - f.x0 + 1) * CELL}" height="${(f.y1 - f.y0 + 1) * CELL}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`);
    }
  }
  if (L && L.n) {
    const img = state.job.previews[back ? 1 : 0];
    const trimD = 'M' + cardTrim(L, o).map(q => num(q[0]) + ' ' + num(q[1])).join('L') + 'Z';
    const foldD = cardFoldLines(L, o).map(sg => `M${num(sg[0][0])} ${num(sg[0][1])}L${num(sg[1][0])} ${num(sg[1][1])}`).join('');
    const multi = deck || win, dk = deck ? deckPlan(o) : null, used = new Map(), shIdx = multi ? +byId(deck ? 'deckSheet' : 'winSheet').value || 0 : 0;
    // deck: page per card side; winietki: one file/page per slot
    const slotKey = j => {
      if (deck) { const c = deckCard(dk, shIdx, j), pi = c == null ? -1 : deckPer() * c + (back ? 1 : 0); return state.job.previews[pi] ? [pi, state.job.previews[pi]] : null; }
      const k = winItem(shIdx, j); return k == null ? null : [k, state.job.items[k].preview];
    };
    if (multi) L.items.forEach((it, j) => { const s = slotKey(j); if (s) used.set(s[0], s[1]); });
    p.push(`<defs>${multi ? [...used].map(([k, url]) => `<g id="dimg${k}"><image href="${url}" x="0" y="0" width="${num(L.pw)}" height="${num(L.ph)}" preserveAspectRatio="none"/></g>`).join('') : `<g id="cimg"><image href="${img}" x="0" y="0" width="${num(L.pw)}" height="${num(L.ph)}" preserveAspectRatio="none"/></g>`}</defs>`);
    L.items.forEach((it, i) => {
      const Mi = back ? backT(it, o) : it.T, cr = back ? backClip(it, o) : it.clip;
      let ref = '#cimg';
      if (multi) { const s = slotKey(i); ref = s ? `#dimg${s[0]}` : null; }
      if (ui.showArt.checked && ref) p.push(`<clipPath id="cc${i}"><rect x="${num(cr[0])}" y="${num(cr[1])}" width="${num(cr[2])}" height="${num(cr[3])}"/></clipPath><g clip-path="url(#cc${i})"><use href="${ref}" transform="matrix(${Mi.map(num).join(',')})"/></g>`);
      // on the back, show where the cut actually lands (mirror only, no print shift)
      const Mc = back ? mul(sheetMirror(o), it.T) : it.T;
      if (guil || morg) {
        const tr = back ? (it.btrim || backRect(it.trim, { ...o, cOffX: 0, cOffY: 0 })) : it.trim;
        p.push(`<rect x="${num(tr[0])}" y="${num(tr[1])}" width="${num(tr[2])}" height="${num(tr[3])}" fill="none" stroke="${CUT_RED}" stroke-width="1.1" vector-effect="non-scaling-stroke"/>`);
      } else {
        if (!gridCut(o) && !perfDie(o)) p.push(`<path d="${trimD}" transform="matrix(${Mc.map(num).join(',')})" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"${back ? ' stroke-dasharray="5 3"' : ''}/>`);
        if (foldD) p.push(`<path d="${foldD}" transform="matrix(${Mc.map(num).join(',')})" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      }
    });
    if (perfDie(o)) {
      // perforated: the cuts as they will be made, bridges left out
      const c = cardCuts(), Ms = back ? sheetMirror(o) : [1, 0, 0, 1, 0, 0];
      p.push(`<path d="${[...c.v, ...c.h, ...c.dashes].map(l => 'M' + l.map(q => num(q[0]) + ' ' + num(q[1])).join('L')).join('')}" transform="matrix(${Ms.map(num).join(',')})" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
    } else if (gridCut(o)) {
      const gl = cardGridLines(), Ms = back ? sheetMirror(o) : [1, 0, 0, 1, 0, 0];
      p.push(`<path d="${[...gl.v, ...gl.h].map(l => `M${num(l[0][0])} ${num(l[0][1])}L${num(l[1][0])} ${num(l[1][1])}`).join('')}" transform="matrix(${Ms.map(num).join(',')})" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"${back ? ' stroke-dasharray="5 3"' : ''}/>`);
    }
    if (guil && (!back || o.gMarksBack)) p.push(`<path d="${(back ? backMarks(L, o) : cropMarks(L, o)).map(m => `M${num(m[0])} ${num(m[1])}L${num(m[2])} ${num(m[3])}`).join('')}" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
  }
  p.push('</g></svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
// the headline under the sheet: how many cards, on how many sheets
function cardCountText(o, n) {
  const job = state.job, K = KIND[state.mode];
  if (!job.bytes) return `No ${K.many} loaded`;
  if (n && state.mode === 'guillotine' && deckLike()) { const dk = deckPlan(o); return `${dk.total} cards on ${plural(dk.sheets, 'sheet')}`; }
  if (n && state.mode === 'winietka') { const wp = winPlan(o); return `${plural(wp.total, 'card')} on ${plural(wp.sheets, 'sheet')}`; }
  return `${plural(n, K.one, K.many)} on the sheet`;
}
// winietki: how the cards spread over the sheets
function winietkiNotes(o, n, notes) {
  const items = state.job.items, wp = winPlan(o);
  const odd = items.filter(c => Math.abs(c.w - items[0].w) > 1.5 || Math.abs(c.h - items[0].h) > 1.5).length;
  notes.unshift(`${plural(wp.items, 'card')}${wp.copies > 1 ? ` × ${wp.copies}` : ''} = ${wp.total} on ${plural(wp.sheets, 'sheet')} (${n} per sheet), single-sided. Every sheet is cut with the same PLT.`);
  if (odd) notes.push(`${odd} ${odd === 1 ? 'card has' : 'cards have'} a different page size than the first and ${odd === 1 ? 'is' : 'are'} stretched to fit.`);
  fillSheetPicker(byId('winSheet'), wp.sheets);
}
// card deck, or the guillotine with every page a separate card: sets, sheets and how to collate them
function deckNotes(o, notes) {
  const dk = deckPlan(o), pages = state.job.pages;
  notes.unshift(deckPer() === 1
    ? `${plural(dk.cards, 'card')} (one per page)${dk.sets > 1 ? ` × ${dk.sets} sets` : ''} = ${dk.total} on ${plural(dk.sheets, 'sheet')}, one-sided.`
    : `${plural(dk.cards, 'card')} per set (${pages} pages${pages % 2 ? ', the last back is blank' : ''}), ${dk.sets} sets: ${plural(dk.sheets, 'sheet')}, double-sided.`);
  notes.push(dk.order === 'stack' ? 'Cut the whole pile, then stack the piles in slot order (left to right, top to bottom): you get complete sets in order.' : 'Each sheet carries one card; collate the piles by card.');
  fillSheetPicker(byId('deckSheet'), dk.sheets);
}
// guillotine: where the crop marks can't be printed, and the cut positions
function guillotineNotes(o, L, notes) {
  const sides = [['top', L.sy], ['bottom', G_PAGE.hMm - L.sy - L.totH], ['left', L.sx], ['right', G_PAGE.wMm - L.sx - L.totW]];
  const weak = sides.filter(([, space]) => { const m = markSide(L, o, space); return !m || m.printable < 1; }).map(([name]) => name);
  if (weak.length) notes.push(`Not enough room for printable crop marks at the ${weak.join(' and ')}; use the cut positions below or lower the unprintable edge if your printer allows.`);
  notes.push(`Cuts from the left edge: ${L.cutsX.map(mm1).join(', ')} mm. From the top: ${L.cutsY.map(mm1).join(', ')} mm.`);
}
export function renderCardStats(busyText) {
  const job = state.job, L = job.layout, n = L ? L.n : 0, off = !n || !!busyText;
  const plainSheet = state.mode === 'guillotine' || state.mode === 'morgana' || state.mode === 'deck'; // nothing for the plotter
  ui.dropNote.hidden = !!job.bytes;
  for (const id of ['exCardPdf', 'exCardCut', 'exCardCutPdf']) byId(id).disabled = off;
  for (const id of ['exCardCut', 'exCardPlt', 'exCardCutPdf']) byId(id).hidden = plainSheet;
  byId('exCardPlt').disabled = off || !(state.template && state.template.marks);
  if (busyText) { ui.count.textContent = busyText; return; }
  const o = readOpts(), K = KIND[state.mode], notes = [];
  ui.count.textContent = cardCountText(o, n);
  if (job.bytes && L) {
    if (n) notes.push(`${L.cols} × ${L.rows}${L.rot ? ', rotated' : ''}.`);
    else if (!L.error) notes.push(`The ${K.one} doesn’t fit in the free area.`);
    if (L.error) notes.push(L.error);
    if (n && perfDie(o)) {
      const c = cardCuts(), cuts = c.v.length + c.h.length + c.dashes.length;
      notes.push(`Perforated die cut: ${cuts} cuts with ${num(o.cTie)} mm bridges ${o.cTiePlace === 'corners' ? `${num(o.cTieInset)} mm from the corners` : 'along the edges'}, so the sheet holds together without a mat.`);
    }
    if (job.pages > 1 && (o.cOffX || o.cOffY)) notes.push(`The back side is shifted by X ${num(o.cOffX)} mm, Y ${num(o.cOffY)} mm (Back side shift).`);
    if (job.pages < 2 && state.mode !== 'winietka') notes.push('The PDF has one page, so the sheet is single-sided.');
    if (n && state.mode === 'winietka') winietkiNotes(o, n, notes);
    if (n && deckLike()) deckNotes(o, notes);
    if (n && (state.mode === 'guillotine' || state.mode === 'deck')) guillotineNotes(o, L, notes);
  }
  setMsg(notes.join(' '), !n && !!job.bytes);
  updateCardInfo();
}
