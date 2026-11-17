// Rubber stamps for the laser (xTool): the artwork (letters, or the filled shapes of an SVG) fitted to the stamp size,
// the cut line around it, and the two engraving layers, following the layout of a stamp made by hand in xTool Studio:
//   cut  (black, vector cut): the convex hull around the artwork's rows (each line of text as a box, so straight
//        edges, sharp corners, and the top and bottom straight) grown by `marginX` at the sides and `marginY` at the
//        top and bottom, then stretched to the stamp size: the rubber cut out is always exactly W x H, never
//        bigger (or a rectangle / rounded rectangle of the size). The artwork is never bigger than W x H less those
//        margins: fitted to it, or set smaller (scale, sizes in pt), and made smaller when asked for more;
//   blue (fill engraving, the finishing pass): the cut shape with the artwork left out, so the letters stay raised;
//   red  (fill engraving, the deep pass): the cut shape grown by `outerGrow` (0.8 mm: the edge is engraved past the
//        cut) with the artwork grown by `textGrow` (0.2 mm: a shoulder under the letters) left out.
// Both engraving layers are compound paths filled even-odd: the artwork is unioned first so every letter is one
// clean outline (its counters are holes, engraved like the background).
// Units: mm, y down; rings are arrays of [x, y], closed implicitly.
import ClipperLib from 'clipper-lib';
import { simplifyLoop } from './geometry.js';

const S = 10000; // Clipper works on integers: 0.1 µm
const toC = rings => rings.map(r => r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })));
const fromC = paths => paths.map(p => p.map(q => [q.X / S, q.Y / S])).filter(r => r.length > 2);

// union (non-zero: overlapping letters and shapes merge, holes stay holes)
export function union(rings, rule = 'nonzero') {
  const c = new ClipperLib.Clipper(), sol = new ClipperLib.Paths(), ft = rule === 'evenodd' ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero;
  c.AddPaths(toC(rings), ClipperLib.PolyType.ptSubject, true);
  c.Execute(ClipperLib.ClipType.ctUnion, sol, ft, ft);
  return fromC(sol);
}
// grow (d > 0) or shrink closed shapes; join: 'round' or 'miter'
export function offset(rings, d, join = 'round') {
  if (!d) return rings.map(r => r.slice());
  const co = new ClipperLib.ClipperOffset(4, 0.005 * S), sol = new ClipperLib.Paths();
  co.AddPaths(toC(rings), join === 'miter' ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  co.Execute(sol, d * S);
  return fromC(sol);
}
// open lines (SVG strokes) as filled shapes of width w
export function strokeToShapes(lines, w, closed) {
  const co = new ClipperLib.ClipperOffset(4, 0.005 * S), sol = new ClipperLib.Paths();
  co.AddPaths(toC(lines), ClipperLib.JoinType.jtMiter, closed ? ClipperLib.EndType.etClosedLine : ClipperLib.EndType.etOpenButt);
  co.Execute(sol, w / 2 * S);
  return fromC(sol);
}
export function bbox(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
export function convexHull(points) {
  const P = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// drop points that lie (within tol) on the line between their neighbours: a hull of curved letters has many
function simplifyConvex(ring, tol = 0.01) {
  let r = ring.slice(), changed = true;
  while (changed && r.length > 3) {
    changed = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]), dist = L ? Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / L : 0;
      if (dist < tol) { r.splice(i, 1); changed = true; i--; }
    }
  }
  return r;
}
// The rows of the artwork: shapes whose heights overlap form one row (a line of text), each row one box;
// small rows (accents above a line) join their line
export function rowBoxes(rings) {
  const boxes = rings.map(r => bbox([r])).sort((a, b) => a.y0 - b.y0), rows = [];
  for (const q of boxes) {
    const row = rows[rows.length - 1];
    if (row && q.y0 < row.y1 - 1e-9) { row.x0 = Math.min(row.x0, q.x0); row.x1 = Math.max(row.x1, q.x1); row.y1 = Math.max(row.y1, q.y1); }
    else rows.push({ x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1 });
  }
  // accents and dots over capitals (Ż, Ś, Ę) stand apart from their line: a row much lower than the others joins
  // the nearest row (above or below), so the line keeps its full width and the cut stays straight along it
  const tall = Math.max(0, ...rows.map(r => r.y1 - r.y0));
  for (let i = 0; i < rows.length && rows.length > 1;) {
    const r = rows[i];
    if (r.y1 - r.y0 >= 0.45 * tall) { i++; continue; }
    const up = rows[i - 1], down = rows[i + 1];
    const into = !up ? down : !down ? up : (down.y0 - r.y1 <= r.y0 - up.y1 ? down : up);
    into.x0 = Math.min(into.x0, r.x0); into.x1 = Math.max(into.x1, r.x1); into.y0 = Math.min(into.y0, r.y0); into.y1 = Math.max(into.y1, r.y1);
    rows.splice(i, 1);
    i = 0;
  }
  return rows;
}
// A convex ring grown by mx sideways and my up and down, corners kept sharp: every corner moved out to the four
// corners of an mx x my box, and the hull of those (the Minkowski sum with the box). Level edges move exactly my,
// upright ones exactly mx, slanted ones in between (45 degrees: (mx + my) / sqrt 2, as the stamp made in xTool
// Studio has it); works with either distance 0.
export function growXY(ring, mx, my) {
  const pts = [];
  for (const [x, y] of ring) pts.push([x - mx, y - my], [x + mx, y - my], [x + mx, y + my], [x - mx, y + my]);
  return simplifyConvex(convexHull(pts));
}
function roundedRect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pts = [], corner = (cx, cy, a0) => { const n = Math.max(6, Math.ceil(r * 8)); for (let i = 0; i <= n; i++) { const a = a0 + Math.PI / 2 * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}
// as measured in the stamp made in xTool Studio: 38 x 19 mm, text 33.37 x 17.39 mm, red edge and letter shoulder
export const STAMP_DEFAULTS = { marginX: 2.3, marginY: 0.8, textGrow: 0.2, outerGrow: 0.8 };

// The distances from the text to the cut a W x H stamp uses: as set, but at most a quarter of the stamp each
export const stampMargins = (W, H, marginX, marginY) => ({ mx: Math.min(Math.max(0, marginX), W * 0.25), my: Math.min(Math.max(0, marginY), H * 0.25) });

// art: filled rings (any orientation, overlaps allowed), any units; W x H: the stamp size (mm).
// opts: { marginX, marginY, textGrow, outerGrow, shape: 'hull' | 'rect' | 'round', radius, scale (the text at this
//         share of its fitted size, e.g. 0.9), fit (true: scale the
//         artwork, with its proportions kept, to fill W x H less the margins; false: keep its size, centred) }
// Returns { art, cut, blue, red, scale, W, H } in stamp mm (origin: the top left corner of W x H).
export function buildStamp(art, W, H, opts = {}) {
  const o = { ...STAMP_DEFAULTS, shape: 'hull', radius: 2, fit: true, detail: 0.005, ...opts };
  if (!art.length) throw new Error('Nothing to engrave: the stamp is empty.');
  // the distances from the text to the cut take at most a quarter of the stamp on each side: a distance typed by
  // mistake (the stamp's size, say) leaves the text half the stamp, not a speck; `margins` says what was used
  const b = bbox(art), { mx, my } = stampMargins(W, H, o.marginX, o.marginY);
  const fitK = Math.min(b.w > 0 ? (W - 2 * mx) / b.w : Infinity, b.h > 0 ? (H - 2 * my) / b.h : Infinity);
  if (!(fitK > 0) || !isFinite(fitK)) throw new Error('The stamp has nothing to fit (an empty line?).');
  // scale: the text made smaller than it fits, e.g. 0.9 for 90 %; set in pt (fit: false), its own size. Never
  // bigger than fits: the cut is the stamp size, so the text must stay inside it with its distances (`shrunk`
  // says when it had to be made smaller than asked)
  const want = (o.fit ? fitK : 1) * (o.scale > 0 ? o.scale : 1), k = Math.min(want, fitK), shrunk = want > fitK * 1.0001;
  const dx = W / 2 - (b.x0 + b.w / 2) * k, dy = H / 2 - (b.y0 + b.h / 2) * k;
  // at its real size, without the points closer than `detail` to the line through their neighbours (far below what
  // the laser can show; letters' curves come in many tiny pieces, and every polygon step below scales with them)
  let A = union(art.map(r => simplifyLoop(r.map(([x, y]) => [x * k + dx, y * k + dy]), o.detail)));
  if (!A.length) throw new Error('Nothing to engrave: the stamp is empty.');
  let cut;
  if (o.shape === 'rect') cut = roundedRect(0, 0, W, H, 0);
  else if (o.shape === 'round') cut = roundedRect(0, 0, W, H, o.radius);
  else {
    // around the rows of the artwork (each line of text as one box): straight edges, sharp corners, and the top
    // and bottom straight along the first and the last line
    const corners = [];
    for (const q of rowBoxes(A)) corners.push([q.x0, q.y0], [q.x1, q.y0], [q.x1, q.y1], [q.x0, q.y1]);
    const grown = growXY(simplifyConvex(convexHull(corners)), mx, my), g = bbox([grown]);
    // and exactly as big as the stamp, never bigger: the text fits inside W x H less the distances, so the grown
    // outline fits inside W x H, centred. It is extended to fill it, the same way it was grown (the top and bottom
    // edges moved out, the sides lengthened): it still holds everything it held, which stretching would not (a
    // narrow line over a wide one, stretched upwards, cuts through the wide one), and stays straight at the top
    // and the bottom. The rubber cut out is W x H.
    const ex = Math.max(0, W - g.w) / 2, ey = Math.max(0, H - g.h) / 2;
    cut = growXY(grown, ex, ey).map(([x, y]) => [Math.min(W, Math.max(0, x)), Math.min(H, Math.max(0, y))]);
  }
  const blue = [cut, ...A];
  const red = [...offset([cut], o.outerGrow, 'miter'), ...offset(A, o.textGrow, 'round')];
  return { art: A, cut, blue, red, scale: k, shrunk, W, H, margins: { x: mx, y: my, cutX: mx < o.marginX, cutY: my < o.marginY } };
}
