// Perforated (tabbed) cutting: a cut line becomes cuts with small uncut bridges, so cut-out parts stay attached
// to the sheet while it feeds through the plotter without a cutting mat, and pop out by hand afterwards.
//
// Bridges are only placed on straight runs of the line; corners and curves are always cut through. Two placements:
//   'edges'   (default) bridges spread evenly along each straight run, cuts of about `cut` mm between bridges of
//             `tie` mm; each run starts and ends with a cut, so the corners come out clean.
//   'corners' each straight run is cut all the way along except one bridge `inset` mm in from each of its ends,
//             i.e. next to the corners; long clean edges, small nubs near the corners.
// In both, a run of at least 3 bridge widths + 1 mm always keeps a bridge, so small waste pieces don't fall out.

const TURN = Math.sin(0.5 * Math.PI / 180); // vertices turning less than 0.5° continue a straight run

// pts: [[x, y], ...] in mm; closed: the line returns to its start; splitAtVertices: every vertex ends a run
// (for straight lines through crossings, so bridges stay off the crossings); place: 'edges' | 'corners';
// inset: for 'corners', the distance from the end of the run (the corner) to the bridge, mm.
// Returns [{ pts, closed }]: open dashes, or the untouched line when it gets no bridge at all.
export function perforate(pts, closed, cut, tie, splitAtVertices = false, { place = 'edges', inset = 2 } = {}) {
  const P = [];
  for (const p of pts) { const l = P[P.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-9) P.push(p); }
  if (closed && P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) <= 1e-9) P.pop();
  if (P.length < 2 || !(cut > 0) || !(tie > 0)) return [{ pts: P, closed }];
  const nSeg = closed ? P.length : P.length - 1;
  const seg = i => [P[i], P[(i + 1) % P.length]];
  const len = i => { const [a, b] = seg(i); return Math.hypot(b[0] - a[0], b[1] - a[1]); };
  const dir = i => { const [a, b] = seg(i), l = len(i); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  // does a run end at the vertex between segment i and i+1?
  const corner = i => {
    if (splitAtVertices) return true;
    const a = dir(i), b = dir((i + 1) % nSeg);
    return Math.abs(a[0] * b[1] - a[1] * b[0]) > TURN || a[0] * b[0] + a[1] * b[1] < 0;
  };
  // arc length at the start of every segment
  const at = [0];
  for (let i = 0; i < nSeg; i++) at.push(at[i] + len(i));
  const total = at[nSeg];
  // straight runs as [startArc, endArc]; a closed line is walked from its first corner
  let first = 0;
  if (closed) { first = -1; for (let i = 0; i < nSeg; i++) if (corner(i)) { first = (i + 1) % nSeg; break; } if (first < 0) first = 0; }
  const runs = [];
  let start = at[first], acc = 0;
  for (let k = 0; k < nSeg; k++) {
    const i = (first + k) % nSeg;
    acc += len(i);
    if (k === nSeg - 1 || corner(i)) { runs.push([start, start + acc]); start += acc; acc = 0; }
  }
  // bridges as [from, to] arc positions (may run past total on a closed line: wrapped below)
  const bridges = [];
  for (const [a, b] of runs) {
    const L = b - a;
    if (place === 'corners') {
      const d = Math.max(0, inset);
      if (L >= 2 * (d + tie) + 1) bridges.push([a + d, a + d + tie], [b - d - tie, b - d]); // one near each corner
      else if (L >= 3 * tie + 1) bridges.push([a + (L - tie) / 2, a + (L + tie) / 2]); // too short for two: one in the middle
      continue;
    }
    let n = Math.round((L + tie) / (cut + tie));
    if (L >= 3 * tie + 1) n = Math.max(n, 2);
    if (n < 2) continue;
    const c = (L - (n - 1) * tie) / n;
    for (let i = 1; i < n; i++) { const s = a + i * c + (i - 1) * tie; bridges.push([s, s + tie]); }
  }
  if (!bridges.length) return [{ pts: P, closed }];
  const wrap = s => (closed ? ((s % total) + total) % total : s);
  const B = bridges.map(([s, e]) => [wrap(s), wrap(s) + (e - s)]).sort((x, y) => x[0] - y[0]);
  // the point at arc position s, and the line between two arc positions
  const pointAt = s => {
    s = wrap(s);
    let i = 0;
    while (i < nSeg - 1 && at[i + 1] < s) i++;
    const [a, b] = seg(i), t = len(i) ? (s - at[i]) / len(i) : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  // the line from arc position s to e (on a closed line e may pass the start once)
  const piece = (s, e) => {
    const out = [pointAt(s)], laps = closed ? 2 : 1;
    for (let v = 0; v < laps * P.length; v++) {
      const pos = closed ? at[v % P.length] + Math.floor(v / P.length) * total : at[v];
      if (pos >= e - 1e-9) break;
      if (pos > s + 1e-9) out.push(P[v % P.length]);
    }
    out.push(pointAt(e));
    return out;
  };
  const dashes = [];
  if (closed) {
    for (let i = 0; i < B.length; i++) {
      const s = B[i][1], e = i + 1 < B.length ? B[i + 1][0] : B[0][0] + total;
      if (e - s > 1e-9) dashes.push({ pts: piece(s, e), closed: false });
    }
  } else {
    let s = 0;
    for (const [bs, be] of B) { if (bs - s > 1e-9) dashes.push({ pts: piece(s, bs), closed: false }); s = be; }
    if (total - s > 1e-9) dashes.push({ pts: piece(s, total), closed: false });
  }
  return dashes;
}
