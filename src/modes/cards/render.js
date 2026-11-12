import { CELL } from '../../core/geometry.js';
import { mul } from '../../core/matrix.js';
import { sanitize } from '../../core/sanitize.js';
import { SHAPES, SLOT_RE, num, parseSvg } from '../../core/svg.js';
import { CUT_RED, setCardMsg, ui } from '../../dom.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';
import { applyView } from '../../viewport.js';
import { G_PAGE, KIND, M_TPL, backMarks, deckPer, pageDims } from './job.js';
import { backClip, backRect, backT, cardCuts, cardFoldLines, cardGridLines, cardTrim, cropMarks, deckCard, deckLike, deckPlan, dotCut, gridCut, markSide, perfDie, sheetMirror, startDotSvg, winItem, winPlan } from './layout.js';
import { updateCardInfo } from './load.js';

export function syncPerfDie() {
  const on = state.mode === 'cards' || state.mode === 'winietka';
  document.getElementById('perfDie').hidden = !on;
  document.getElementById('perfDieRows').hidden = !on || !document.getElementById('cPerfDie').checked;
  const corners = document.getElementById('cTiePlace').value === 'corners';
  document.getElementById('rowTieInset').hidden = !corners;
  document.getElementById('rowTieCut').hidden = corners;
  document.getElementById('dotRows').hidden = document.getElementById('cAlign').value !== 'dot';
}
document.getElementById('cPerfDie').addEventListener('change', syncPerfDie);
document.getElementById('cTiePlace').addEventListener('change', syncPerfDie);
document.getElementById('cAlign').addEventListener('change', syncPerfDie);
export function renderCardPreview() {
  state.previewFrame = null;
  const t = state.template, o = readOpts(), L = state.job.layout, back = document.getElementById('showBack').checked && state.job.pages > 1 && !(deckLike() && deckPer() === 1);
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
    const multi = deck || win, dk = deck ? deckPlan(o) : null, used = new Map(), shIdx = multi ? +document.getElementById(deck ? 'deckSheet' : 'winSheet').value || 0 : 0;
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
export function renderCardStats(busyText) {
  const n = state.job.layout ? state.job.layout.n : 0;
  ui.dropNote.hidden = !!state.job.bytes;
  for (const id of ['exCardPdf', 'exCardCut']) document.getElementById(id).disabled = !n || !!busyText;
  const guil = state.mode === 'guillotine' || state.mode === 'morgana' || state.mode === 'deck';
  document.getElementById('exCardCut').hidden = guil; document.getElementById('exCardPlt').hidden = guil; document.getElementById('exCardCutPdf').hidden = guil;
  document.getElementById('exCardCutPdf').disabled = !n || !!busyText;
  document.getElementById('exCardPlt').disabled = !n || !!busyText || !(state.template && state.template.marks);
  if (busyText) { ui.count.textContent = busyText; return; }
  const K = KIND[state.mode];
  ui.count.textContent = !state.job.bytes ? `No ${K.many} loaded` : state.mode === 'guillotine' && deckLike() && n ? (dkx => `${dkx.total} cards on ${dkx.sheets} ${dkx.sheets === 1 ? 'sheet' : 'sheets'}`)(deckPlan(readOpts())) : state.mode === 'winietka' && n ? (wpx => `${wpx.total} ${wpx.total === 1 ? 'card' : 'cards'} on ${wpx.sheets} ${wpx.sheets === 1 ? 'sheet' : 'sheets'}`)(winPlan(readOpts())) : n === 1 ? `1 ${K.one} on the sheet` : `${n} ${K.many} on the sheet`;
  const notes = [];
  if (state.job.bytes && state.job.layout) {
    if (n) notes.push(`${state.job.layout.cols} × ${state.job.layout.rows}${state.job.layout.rot ? ', rotated' : ''}.`);
    else if (!state.job.layout.error) notes.push(`The ${K.one} doesn’t fit in the free area.`);
    if (state.job.layout.error) notes.push(state.job.layout.error);
    if (n && perfDie(readOpts())) {
      const c = cardCuts(), oo = readOpts(), cuts = c.v.length + c.h.length + c.dashes.length;
      notes.push(`Perforated die cut: ${cuts} cuts with ${num(oo.cTie)} mm bridges ${oo.cTiePlace === 'corners' ? `${num(oo.cTieInset)} mm from the corners` : 'along the edges'}, so the sheet holds together without a mat.`);
    }
    { const oo = readOpts(); if (state.job.pages > 1 && (oo.cOffX || oo.cOffY)) notes.push(`The back side is shifted by X ${num(oo.cOffX)} mm, Y ${num(oo.cOffY)} mm (Back side shift).`); }
    if (state.job.pages < 2 && state.mode !== 'winietka') notes.push('The PDF has one page, so the sheet is single-sided.');
    if (n && state.mode === 'winietka') {
      const wp = winPlan(readOpts()), odd = state.job.items.filter(c => Math.abs(c.w - state.job.items[0].w) > 1.5 || Math.abs(c.h - state.job.items[0].h) > 1.5).length;
      notes.unshift(`${wp.items} ${wp.items === 1 ? 'card' : 'cards'}${wp.copies > 1 ? ` × ${wp.copies}` : ''} = ${wp.total} on ${wp.sheets} ${wp.sheets === 1 ? 'sheet' : 'sheets'} (${n} per sheet), single-sided. Every sheet is cut with the same PLT.`);
      if (odd) notes.push(`${odd} ${odd === 1 ? 'card has' : 'cards have'} a different page size than the first and ${odd === 1 ? 'is' : 'are'} stretched to fit.`);
      const sel = document.getElementById('winSheet'), cur = sel.value;
      sel.innerHTML = Array.from({ length: Math.max(1, wp.sheets) }, (_, i) => `<option value="${i}">Sheet ${i + 1} of ${Math.max(1, wp.sheets)}</option>`).join('');
      sel.value = +cur < wp.sheets ? cur : '0';
    }
    if (n && deckLike()) {
      const dk = deckPlan(readOpts());
      notes.unshift(deckPer() === 1
        ? `${dk.cards} ${dk.cards === 1 ? 'card' : 'cards'} (one per page)${dk.sets > 1 ? ` × ${dk.sets} sets` : ''} = ${dk.total} on ${dk.sheets} ${dk.sheets === 1 ? 'sheet' : 'sheets'}, one-sided.`
        : `${dk.cards} ${dk.cards === 1 ? 'card' : 'cards'} per set (${state.job.pages} pages${state.job.pages % 2 ? ', the last back is blank' : ''}), ${dk.sets} sets: ${dk.sheets} ${dk.sheets === 1 ? 'sheet' : 'sheets'}, double-sided.`);
      notes.push(dk.order === 'stack' ? 'Cut the whole pile, then stack the piles in slot order (left to right, top to bottom): you get complete sets in order.' : 'Each sheet carries one card; collate the piles by card.');
      const sel = document.getElementById('deckSheet'), cur = sel.value;
      sel.innerHTML = Array.from({ length: dk.sheets }, (_, i) => `<option value="${i}">Sheet ${i + 1} of ${dk.sheets}</option>`).join('');
      sel.value = +cur < dk.sheets ? cur : '0';
    }
    if (n && (state.mode === 'guillotine' || state.mode === 'deck')) {
      const L = state.job.layout, f = v => num(Math.round(v * 10) / 10), oo = readOpts();
      const sides = [['top', markSide(L, oo, L.sy)], ['bottom', markSide(L, oo, G_PAGE.hMm - L.sy - L.totH)], ['left', markSide(L, oo, L.sx)], ['right', markSide(L, oo, G_PAGE.wMm - L.sx - L.totW)]];
      const weak = sides.filter(([, m]) => !m || m.printable < 1).map(([nm]) => nm);
      if (weak.length) notes.push(`Not enough room for printable crop marks at the ${weak.join(' and ')}; use the cut positions below or lower the unprintable edge if your printer allows.`);
      notes.push(`Cuts from the left edge: ${L.cutsX.map(f).join(', ')} mm. From the top: ${L.cutsY.map(f).join(', ')} mm.`);
    }
  }
  setCardMsg(notes.join(' '), !n && !!state.job.bytes);
  updateCardInfo();
}
// Template drawing as plain shapes in sheet mm (for the PDF): needs the live DOM.
export function templateShapes() {
  const t = state.template;
  let host = null;
  try {
    const doc = parseSvg(t.text); sanitize(doc);
    host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none';
    const svg = document.importNode(doc.documentElement, true);
    svg.setAttribute('width', '1000'); svg.setAttribute('height', '1000');
    host.appendChild(svg); document.body.appendChild(host);
    const inv = svg.getScreenCTM().inverse(), out = [];
    for (const el of svg.querySelectorAll(SHAPES)) {
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const m = inv.multiply(el.getScreenCTM());
      const tp = (x, y) => [((m.a * x + m.c * y + m.e) - t.vb.x) / t.u, ((m.b * x + m.d * y + m.f) - t.vb.y) / t.u];
      const at = n => parseFloat(el.getAttribute(n)) || 0;
      let pts = [], closed = true;
      if (el.localName === 'rect') { const x = at('x'), y = at('y'), w = at('width'), h = at('height'); pts = [tp(x, y), tp(x + w, y), tp(x + w, y + h), tp(x, y + h)]; }
      else if (el.localName === 'polyline' || el.localName === 'polygon') {
        const a = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i + 1 < a.length; i += 2) pts.push(tp(a[i], a[i + 1]));
        closed = el.localName === 'polygon';
      } else if (el.localName === 'line') { pts = [tp(at('x1'), at('y1')), tp(at('x2'), at('y2'))]; closed = false; }
      else {
        const len = el.getTotalLength(), n = Math.max(8, Math.ceil(len / 0.5));
        for (let i = 0; i <= n; i++) { const q = el.getPointAtLength(len * i / n); pts.push(tp(q.x, q.y)); }
        closed = el.localName !== 'path' || /z\s*$/i.test(el.getAttribute('d') || '');
      }
      const sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) / t.u;
      const fill = cs.fill && cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0 ? cs.fill : null;
      const stroke = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeOpacity || '1') > 0 ? cs.stroke : null;
      if (pts.length > 1 && (fill || stroke)) out.push({ pts, closed, fill, stroke, sw: (parseFloat(cs.strokeWidth) || 1) * sc });
    }
    return out;
  } finally {
    if (host) host.remove();
  }
}
