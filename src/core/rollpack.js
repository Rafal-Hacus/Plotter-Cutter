// Packing rectangles across a roll of fixed width, as short as possible (skyline, lowest top first).
// items: [{ id, w, h }] in mm; opts: { width (usable width), gap (between rectangles), maxLength (0 = no limit),
// rotate (may turn a rectangle a quarter) }. Returns { sheets: [{ length, places: [{ id, x, y, w, h, rot }] }],
// tooBig: [ids that fit nowhere] }; x across the roll, y along it, w and h as placed (turned when rot).
export function packRoll(items, { width, gap = 0, maxLength = 0, rotate = true } = {}) {
  const W = width + gap, cap = maxLength > 0 ? maxLength + gap : Infinity;
  const fits = (w, h) => w <= W + 1e-9 && h <= cap + 1e-9;
  const tooBig = [], todo = [];
  for (const it of items) {
    const w = it.w + gap, h = it.h + gap;
    if (fits(w, h) || (rotate && fits(h, w))) todo.push({ ...it, gw: w, gh: h });
    else tooBig.push(it.id);
  }
  // big first: the longer side, then the area
  todo.sort((a, b) => Math.max(b.gw, b.gh) - Math.max(a.gw, a.gh) || b.gw * b.gh - a.gw * a.gh);
  const sheets = [];
  while (todo.length) {
    let sky = [{ x: 0, y: 0, w: W }];
    const places = [];
    for (let i = 0; i < todo.length;) {
      const it = todo[i];
      let best = null;
      for (const rot of rotate && Math.abs(it.gw - it.gh) > 1e-9 ? [false, true] : [false]) {
        const w = rot ? it.gh : it.gw, h = rot ? it.gw : it.gh;
        for (let s = 0; s < sky.length; s++) {
          const x = sky[s].x;
          if (x + w > W + 1e-9) break;
          // resting height: the highest skyline segment under [x, x + w)
          let y = 0;
          for (let k = s; k < sky.length && sky[k].x < x + w - 1e-9; k++) y = Math.max(y, sky[k].y);
          if (y + h > cap + 1e-9) continue;
          if (!best || y + h < best.y + best.h - 1e-9 || (Math.abs(y + h - best.y - best.h) < 1e-9 && (y < best.y - 1e-9 || (Math.abs(y - best.y) < 1e-9 && x < best.x)))) best = { x, y, w, h, rot };
        }
      }
      if (!best) { i++; continue; } // doesn't fit on this sheet any more: maybe on the next
      places.push({ id: it.id, x: best.x, y: best.y, w: best.w - gap, h: best.h - gap, rot: best.rot });
      // raise the skyline under the new rectangle
      const x0 = best.x, x1 = best.x + best.w, top = best.y + best.h, next = [];
      for (const seg of sky) {
        const a = seg.x, b = seg.x + seg.w;
        if (b <= x0 + 1e-9 || a >= x1 - 1e-9) { next.push(seg); continue; }
        if (a < x0) next.push({ x: a, y: seg.y, w: x0 - a });
        if (b > x1) next.push({ x: x1, y: seg.y, w: b - x1 });
      }
      next.push({ x: x0, y: top, w: x1 - x0 });
      next.sort((p, q) => p.x - q.x);
      // join neighbours at the same height
      sky = next.reduce((acc, seg) => { const l = acc[acc.length - 1]; if (l && Math.abs(l.y - seg.y) < 1e-9 && Math.abs(l.x + l.w - seg.x) < 1e-9) l.w += seg.w; else acc.push({ ...seg }); return acc; }, []);
      todo.splice(i, 1);
      i = 0; // the skyline changed: smaller pieces skipped before may fit now
    }
    if (!places.length) break; // (can't happen: everything left fits an empty sheet)
    sheets.push({ length: Math.max(...places.map(p => p.y + p.h)), places });
  }
  return { sheets, tooBig };
}

// "…_301x376mm_3szt.pdf": 3 copies (also "3 pcs", "3pc", "3 copies"; the size's "301x376" is not a count)
export function copiesFromName(name) {
  const m = /(?:^|[^a-z0-9.])(\d{1,4})\s*(?:szt|pcs|pc|copies)(?![a-z])/i.exec(name.replace(/\.pdf$/i, ''));
  return m ? Math.max(1, +m[1]) : 1;
}
