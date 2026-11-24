// The sheet preview and the notes of the stickers mode.
import { CELL } from '../../core/geometry.js';
import { SLOT_RE, num } from '../../core/svg.js';
import { CUT_RED, byId, ui } from '../../dom.js';
import { placeMatrix } from '../../nest.js';
import { readOpts } from '../../settings.js';
import { designs, state } from '../../state.js';
import { applyView } from '../../viewport.js';
import { planText } from './plan.js';

export function renderStickerPreview() {
  state.previewFrame = null;
  const t = state.template, o = readOpts(), showArt = ui.showArt.checked;
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${t.vb.x} ${t.vb.y} ${t.vb.w} ${t.vb.h}" role="img" aria-label="Sticker sheet preview">`);
  p.push(`<rect x="${t.vb.x}" y="${t.vb.y}" width="${t.vb.w}" height="${t.vb.h}" fill="#fff"/>`);
  p.push(`<g>${t.inner.replace(SLOT_RE, '')}</g>`);
  p.push(`<g transform="translate(${t.vb.x} ${t.vb.y}) scale(${t.u})">`);
  if (state.sheetCache && state.sheetCache.free) {
    const f = state.sheetCache.free;
    p.push(`<rect x="${f.x0 * CELL}" y="${f.y0 * CELL}" width="${(f.x1 - f.x0 + 1) * CELL}" height="${(f.y1 - f.y0 + 1) * CELL}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`);
  }
  if (state.layout && showArt) {
    p.push('<defs>');
    for (const d of new Set(state.layout.items.map(it => it.d))) {
      const r = d.res;
      const im = `<image href="${r.cutMode ? d.urlNoCut : d.url}" x="${num(r.offX)}" y="${num(r.offY)}" width="${num(r.artW)}" height="${num(r.artH)}" preserveAspectRatio="none"/>`;
      p.push(`<g id="pv${d.id}"><clipPath id="pvc${d.id}"><path d="${r.clipD}"/></clipPath><g clip-path="url(#pvc${d.id})">${im}</g></g>`);
    }
    p.push('</defs>');
  }
  if (state.layout) {
    for (const it of state.layout.items) {
      const r = it.d.res, M = placeMatrix(it);
      p.push(`<g transform="matrix(${M.map(num).join(',')})">`);
      if (showArt) {
        if (o.borderFill && !r.cutMode) p.push(`<path d="${r.kissD}" fill="${o.borderColor}"/>`);
        p.push(`<use href="#pv${it.d.id}"/>`);
      }
      p.push(`<path d="${r.dieD}" fill="none" stroke="${CUT_RED}" stroke-width="1.2" stroke-dasharray="1.6 0.9" vector-effect="non-scaling-stroke"/>`);
      p.push(`<path d="${r.kissD}" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      p.push('</g>');
    }
  }
  p.push('</g></svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
export function renderStickerStats(busyText) {
  const total = state.layout ? state.layout.items.length : 0;
  const ready = designs.filter(d => d.res);
  ui.dropNote.hidden = designs.length > 0;
  for (const b of [ui.exAll, ui.exPrint, ui.exCut]) b.disabled = !total || !!busyText;
  byId('exPdf').disabled = !total || !!busyText;
  byId('exCutPdf').disabled = !total || !!busyText;
  byId('exBatch').disabled = !designs.some(d => d.res) || !!busyText || !(state.template && state.template.marks);
  ui.exPlt.disabled = !total || !!busyText || !(state.template && state.template.marks);
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = !designs.length ? 'Empty sheet' : total === 1 ? '1 sticker on the sheet' : `${total} stickers on the sheet`;
  const notes = [], plans = [];
  const plan = state.plan && state.plan.groups, planned = new Set(plan ? plan.flatMap(g => g.designs) : []);
  if (state.layout) {
    for (const d of ready) {
      const got = state.layout.counts.get(d.id) || 0;
      // more copies than one sheet holds: the order goes over several sheets (the batch export), not a warning
      if (d.qty != null && got < d.qty && !(got > 0 && planned.has(d))) notes.push(`Only ${got} of ${d.qty} copies of ${d.name} fit.`);
      if (d.qty == null && got === 0) notes.push(`${d.name} is too big for the free area.`);
    }
  }
  if (plan) {
    for (const g of plan) plans.push(`${plan.length > 1 || g.designs.length === 1 ? `${g.designs.map(d => d.name).join(', ')}: ` : ''}${planText(g)}.`);
    if (plan.some(g => g.sheets > 1)) plans.push('“Batch: print PDF + PLTs” makes all the sheets.');
  }
  ui.msg.textContent = notes.concat(plans).join(' ');
  ui.msg.className = 'msg' + (notes.length ? ' warn' : '');
}
