// Rubber stamps for the laser (xTool): the artwork (letters, or the filled shapes of an SVG) fitted to the stamp size,
// the cut line around it, and the two engraving layers, following the layout of a stamp made by hand in xTool Studio:
//   cut  (black, vector cut): like the stamp made in xTool Studio, the stamp's rectangle (exactly W x H, never
//        bigger) with its four corners cut off at 45 degrees as far as the text allows (or a plain rectangle /
//        rounded rectangle of the size). The artwork is never bigger than W x H less those
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
function roundedRect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pts = [], corner = (cx, cy, a0) => { const n = Math.max(6, Math.ceil(r * 8)); for (let i = 0; i <= n; i++) { const a = a0 + Math.PI / 2 * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}
// W x H with each corner cut off at 45 degrees as far as possible while every point of the artwork stays at least
// (mx + my) / sqrt 2 from the cut (the distance a box mx x my has along a 45-degree edge): straight top, bottom
// and sides, exactly W x H. A corner the artwork fills stays square.
export function chamferedRect(rings, W, H, mx, my) {
  let tl = Infinity, tr = Infinity, br = Infinity, bl = Infinity;
  for (const r of rings) for (const [x, y] of r) {
    tl = Math.min(tl, x + y); tr = Math.min(tr, W - x + y); br = Math.min(br, W - x + H - y); bl = Math.min(bl, x + H - y);
  }
  const lim = Math.min(W, H) / 2, c = v => Math.max(0, Math.min(lim, v - (mx + my)));
  const [a, b, d, e] = [c(tl), c(tr), c(br), c(bl)];
  const pts = [[a, 0], [W - b, 0], [W, b], [W, H - d], [W - d, H], [e, H], [0, H - e], [0, a]];
  return pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9; });
}
// The letters' height (mm): of the shapes' heights the 75th percentile, which is the capitals and tall letters
// (dots, accents and the holes in letters are lower); for shapes that aren't text, a fair measure of their detail
export function letterHeight(rings) {
  const h = rings.map(r => bbox([r])).filter(b => b.w * b.h > 0.02).map(b => b.h).sort((a, b) => a - b);
  return h.length ? h[Math.floor((h.length - 1) * 0.75)] : REF_LETTER;
}
// the letters of the stamp made in xTool Studio: 1.92 mm (75th percentile), with a 0.2 mm shoulder
export const REF_LETTER = 1.92;
// as measured in the stamp made in xTool Studio: 38 x 19 mm, text 33.37 x 17.39 mm, red edge and letter shoulder
export const STAMP_DEFAULTS = { marginX: 2.3, marginY: 0.8, textGrow: 0.2, outerGrow: 0.8, shoulderScale: true };

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
    // as in the stamp made in xTool Studio: the stamp's rectangle with its four corners cut off at 45 degrees, each
    // as far as the text allows, keeping the distance from it (a 45-degree edge mx + my from the text's corner)
    cut = chamferedRect(A, W, H, mx, my);
  }
  const blue = [cut, ...A];
  // the shoulder (the rim left around the letters by the deep pass): set for letters the size of the original
  // stamp's; smaller letters get a narrower one in proportion, so small text doesn't drown in its rim
  const shoulder = o.shoulderScale ? Math.max(Math.min(0.05, o.textGrow), Math.min(o.textGrow, o.textGrow * letterHeight(A) / REF_LETTER)) : o.textGrow;
  const red = [...offset([cut], o.outerGrow, 'miter'), ...offset(A, shoulder, 'round')];
  return { art: A, cut, blue, red, scale: k, shrunk, shoulder, W, H, margins: { x: mx, y: my, cutX: mx < o.marginX, cutY: my < o.marginY } };
}
