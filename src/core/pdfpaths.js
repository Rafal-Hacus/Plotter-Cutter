// The vector paths of a PDF page, from pdf.js's operator list, in page space (points, y up), with the
// transformations applied. Used to cut along a line drawn in the file (e.g. the outline of a road sign).
// OPS: pdf.js's OPS table. Path data (pdf.js 4+): constructPath args [paintOp, [Float32Array], minMax], the array
// holding 0 moveTo x y, 1 lineTo x y, 2 curveTo x1 y1 x2 y2 x y, 3 quadraticCurveTo x1 y1 x y, 4 closePath.
import { apply, mul } from './matrix.js';

const PAINT = ['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'];
// returns [{ subpaths: [{ pts: [[x, y]...], closed }], stroke (bool), fill (bool), lineWidth, bbox: [x0, y0, x1, y1] }]
export function pagePaths(fnArray, argsArray, OPS, { curveSteps = 24 } = {}) {
  const names = {};
  for (const n of [...PAINT, 'save', 'restore', 'transform', 'constructPath', 'setLineWidth', 'paintFormXObjectBegin', 'paintFormXObjectEnd']) names[OPS[n]] = n;
  const out = [], stack = [];
  let ctm = [1, 0, 0, 1, 0, 0], lw = 1;
  for (let i = 0; i < fnArray.length; i++) {
    const op = names[fnArray[i]], a = argsArray[i];
    if (op === 'save') stack.push([ctm, lw]);
    else if (op === 'restore') { if (stack.length) [ctm, lw] = stack.pop(); }
    else if (op === 'transform') ctm = mul(ctm, a);
    else if (op === 'setLineWidth') lw = a[0];
    else if (op === 'paintFormXObjectBegin') { stack.push([ctm, lw]); if (a[0]) ctm = mul(ctm, a[0]); }
    else if (op === 'paintFormXObjectEnd') { if (stack.length) [ctm, lw] = stack.pop(); }
    else if (op === 'constructPath') {
      const paint = names[a[0]], data = a[1] && a[1][0];
      if (!PAINT.includes(paint) || !data || !data.length) continue;
      const subpaths = [];
      let cur = null, last = [0, 0], start = [0, 0];
      const add = p => { const q = apply(ctm, p); cur.pts.push(q); };
      for (let k = 0; k < data.length;) {
        const t = data[k];
        if (t === 0) { cur = { pts: [], closed: false }; subpaths.push(cur); last = start = [data[k + 1], data[k + 2]]; add(last); k += 3; }
        else if (t === 1) { if (!cur) { cur = { pts: [], closed: false }; subpaths.push(cur); add(last); } last = [data[k + 1], data[k + 2]]; add(last); k += 3; }
        else if (t === 2 || t === 3) {
          if (!cur) { cur = { pts: [], closed: false }; subpaths.push(cur); add(last); }
          const p0 = last, c = t === 2 ? [[data[k + 1], data[k + 2]], [data[k + 3], data[k + 4]]] : null;
          const end = t === 2 ? [data[k + 5], data[k + 6]] : [data[k + 3], data[k + 4]];
          const q1 = t === 3 ? [data[k + 1], data[k + 2]] : null;
          for (let s = 1; s <= curveSteps; s++) {
            const u = s / curveSteps, v = 1 - u;
            add(t === 2
              ? [v * v * v * p0[0] + 3 * v * v * u * c[0][0] + 3 * v * u * u * c[1][0] + u * u * u * end[0], v * v * v * p0[1] + 3 * v * v * u * c[0][1] + 3 * v * u * u * c[1][1] + u * u * u * end[1]]
              : [v * v * p0[0] + 2 * v * u * q1[0] + u * u * end[0], v * v * p0[1] + 2 * v * u * q1[1] + u * u * end[1]]);
          }
          last = end; k += t === 2 ? 7 : 5;
        } else if (t === 4) { if (cur) cur.closed = true; last = start; cur = null; k += 1; }
        else break; // unknown: stop reading this path
      }
      const kept = subpaths.filter(sp => sp.pts.length > 1);
      if (!kept.length) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const sp of kept) for (const [x, y] of sp.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
      out.push({ subpaths: kept, stroke: /stroke/i.test(paint), fill: /fill/i.test(paint), lineWidth: lw * scale, bbox: [x0, y0, x1, y1] });
    }
  }
  return out;
}
// The outermost line of the page: the closed outline with the largest extent, as one closed loop (points, y up).
// Paths that only fill the whole page (a background) can be left out with `ignore` (bbox -> true to skip).
export function outermostLoop(paths, ignore = () => false) {
  let best = null, bestArea = 0;
  for (const p of paths) {
    if (ignore(p.bbox)) continue;
    for (const sp of p.subpaths) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of sp.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const a = (x1 - x0) * (y1 - y0), first = sp.pts[0], lastP = sp.pts[sp.pts.length - 1];
      const closed = sp.closed || Math.hypot(first[0] - lastP[0], first[1] - lastP[1]) < 0.5;
      if (closed && sp.pts.length > 2 && a > bestArea + 1e-6) { bestArea = a; best = { pts: sp.pts, bbox: [x0, y0, x1, y1], stroke: p.stroke, lineWidth: p.lineWidth }; }
    }
  }
  return best;
}
