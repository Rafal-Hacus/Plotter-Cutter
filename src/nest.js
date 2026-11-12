import { CELL, runStrategy, transposeGrid, transposeMask } from './core/geometry.js';
import { num } from './core/svg.js';
import { tick } from './core/util.js';

/* ---------- nesting ---------- */
export async function nestAll(list, sheet, o, cancelled) {
  const { Gw, Gh, blocked } = sheet;
  const items = list.map(d => ({ d, masks: d.res.masks, qty: d.qty, area: d.res.masks[0].area }));
  const rotSets = o.rotate ? [[0], [0, 180], [0, 90, 180, 270], [90], [90, 270]] : [[0]];
  const blockedT = transposeGrid(blocked, Gw, Gh);
  const itemsT = items.map(it => {
    const m = {};
    for (const r in it.masks) m[r] = transposeMask(it.masks[r]);
    return { masks: m, qty: it.qty, area: it.area };
  });
  let best = null;
  for (const rs of rotSets) {
    for (const tr of [false, true]) {
      if (cancelled()) return null;
      const res = tr ? runStrategy(Gh, Gw, blockedT, itemsT, rs) : runStrategy(Gw, Gh, blocked, items, rs);
      const out = res.out.map(p => tr ? { ii: p.ii, rot: p.rot, X: p.Y, Y: p.X } : p);
      let fixedN = 0, autoN = 0;
      items.forEach((it, i) => { if (it.qty != null) fixedN += res.placed[i]; else autoN += res.placed[i]; });
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of out) { const m = items[p.ii].masks[p.rot]; x0 = Math.min(x0, p.X); y0 = Math.min(y0, p.Y); x1 = Math.max(x1, p.X + m.w); y1 = Math.max(y1, p.Y + m.h); }
      const score = [fixedN, autoN, out.length ? -(x1 - x0) * (y1 - y0) : 0];
      if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && (score[1] > best.score[1] || (score[1] === best.score[1] && score[2] > best.score[2])))) {
        best = { score, out, placed: res.placed, box: { x0, y0, x1, y1 } };
      }
      await tick();
    }
  }
  let out = best.out;
  if (o.center && out.length && sheet.free) {
    const fr = sheet.free, b = best.box;
    const want = { dx: Math.floor(((fr.x0 + fr.x1 + 1) - (b.x0 + b.x1)) / 2), dy: Math.floor(((fr.y0 + fr.y1 + 1) - (b.y0 + b.y1)) / 2) };
    const ok = (dx, dy) => out.every(p => {
      const m = items[p.ii].masks[p.rot], X = p.X + dx, Y = p.Y + dy;
      if (X < 0 || Y < 0 || X + m.w > Gw || Y + m.h > Gh) return false;
      for (let r = 0; r < m.h; r++) { const rr = m.rows[r], q = (Y + r) * Gw; for (let k = 0; k < rr.length; k += 2) for (let x = rr[k]; x <= rr[k + 1]; x++) if (blocked[q + X + x]) return false; }
      return true;
    });
    for (const [dx, dy] of [[want.dx, want.dy], [want.dx, 0], [0, want.dy]]) {
      if ((dx || dy) && ok(dx, dy)) { out = out.map(p => ({ ...p, X: p.X + dx, Y: p.Y + dy })); break; }
    }
  }
  return {
    items: out.map(p => ({ d: items[p.ii].d, rot: p.rot, X: p.X, Y: p.Y })),
    counts: new Map(items.map((it, i) => [it.d.id, best.placed[i]]))
  };
}
/* ---------- placement maths ---------- */
export function placeMatrix(it) {
  const r = it.d.res, m = r.masks[it.rot];
  const Bx = (it.X - m.ox) * CELL, By = (it.Y - m.oy) * CELL, bw = r.boxW, bh = r.boxH;
  switch (it.rot) {
    case 90: return [0, 1, -1, 0, Bx + bh, By];
    case 180: return [-1, 0, 0, -1, Bx + bw, By + bh];
    case 270: return [0, -1, 1, 0, Bx, By + bw];
    default: return [1, 0, 0, 1, Bx, By];
  }
}
export const artTransform = d => `translate(${num(d.res.offX)} ${num(d.res.offY)}) scale(${d.res.s}) translate(${num(-d.vb.x)} ${num(-d.vb.y)})`;
