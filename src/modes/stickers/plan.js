// Planning sticker copies over as many sheets as they need (the batch export, and the "N pieces → X sheets" note).
import { nestAll } from '../../nest.js';

// Copies = that many; empty copies = fill what the counted ones leave on every sheet (on their own: one full sheet
// each). Returns the sheets (nest layouts) and, per group of designs sharing sheets, its pieces, sheets and overs:
// the copies a repeat of the group's first (full) sheet would add on its last one.
// A sheet is nested again only when its copies could run out on it: while every design still has more copies left
// than could ever fit on a sheet, the layout is the same as the one before (nesting doesn't depend on the copies then).
export async function planSheets(ready, sheet, o, { cancelled = () => false, limit = 200 } = {}) {
  const sheets = [], groupsOut = [];
  const remaining = new Map(ready.filter(d => d.qty != null).map(d => [d, d.qty]));
  const fills = ready.filter(d => d.qty == null), fillers = () => fills.map(d => Object.assign(Object.create(d), { qty: null }));
  let freeCells = 0;
  for (let i = 0; i < sheet.blocked.length; i++) if (!sheet.blocked[i]) freeCells++;
  const most = d => Math.floor(freeCells / d.res.masks[0].area);
  const groups = o.batchMix ? [[...remaining.keys()]] : [...remaining.keys()].map(d => [d]);
  for (const g of groups) {
    if (!g.length) continue;
    const start = sheets.length, pieces = g.reduce((s, d) => s + remaining.get(d), 0);
    let prev = null;
    while (g.some(d => remaining.get(d) > 0)) {
      const left = g.filter(d => remaining.get(d) > 0);
      let lay = prev && prev.left.length === left.length && left.every(d => remaining.get(d) > most(d)) ? prev.lay : null;
      if (!lay) {
        const list = left.map(d => Object.assign(Object.create(d), { qty: remaining.get(d) }));
        lay = await nestAll([...list, ...fillers()], sheet, o, cancelled);
        if (cancelled()) return null;
        const placed = g.reduce((s, d) => s + ((lay && lay.counts.get(d.id)) || 0), 0);
        if (!lay || !placed) throw new Error(`${list[0].name} doesn’t fit on a sheet.`);
        prev = left.every(d => remaining.get(d) > most(d)) ? { lay, left } : null;
      }
      for (const d of g) remaining.set(d, remaining.get(d) - (lay.counts.get(d.id) || 0));
      sheets.push(lay);
      if (sheets.length > limit) throw new Error(`More than ${limit} sheets; check the copies.`);
    }
    const first = sheets[start], last = sheets[sheets.length - 1];
    const overs = sheets.length - start > 1 ? g.reduce((s, d) => s + Math.max(0, (first.counts.get(d.id) || 0) - (last.counts.get(d.id) || 0)), 0) : 0;
    groupsOut.push({ designs: g, pieces, sheets: sheets.length - start, overs });
  }
  // only fill designs (nothing counted): one full sheet each
  if (!remaining.size) for (const d of fills) {
    const lay = await nestAll([Object.assign(Object.create(d), { qty: null })], sheet, o, cancelled);
    if (cancelled()) return null;
    if (!lay || !lay.items.length) throw new Error(`${d.name} doesn’t fit on a sheet.`);
    sheets.push(lay);
  }
  return { sheets, groups: groupsOut };
}
// "500 pieces → 84 sheets (+ 4 overs on the last)"
export function planText(gr) {
  const s = `${gr.pieces} ${gr.pieces === 1 ? 'piece' : 'pieces'} → ${gr.sheets} ${gr.sheets === 1 ? 'sheet' : 'sheets'}`;
  return gr.overs ? `${s} (+ ${gr.overs} ${gr.overs === 1 ? 'over' : 'overs'} on the last)` : s;
}
