// Straight cuts through a grid of equal pieces (business cards cut as a grid, squares, the guillotine's cut list).

// Every distinct cut position along one axis: both edges of each of the `n` pieces, `size` long and `gap` apart,
// the first starting at `start`. With no gap neighbouring pieces share one cut.
export function gridCuts(start, n, size, gap) {
  const cuts = [];
  const add = v => { if (!cuts.some(q => Math.abs(q - v) < 0.01)) cuts.push(v); };
  for (let i = 0; i < n; i++) { add(start + i * (size + gap)); add(start + i * (size + gap) + size); }
  return cuts.sort((a, b) => a - b);
}

// The cut lines in the order the knife takes them, starting from the bottom right corner: vertical lines from
// right to left, the first going up, then alternating; then horizontal lines starting on the side where the
// verticals ended (top or bottom), the first going left to right, then alternating.
// g: { cutsX, cutsY, fx0, fy0, fx1, fy1 } (cut positions and the frame the lines run across, y down).
// Returns { v, h }: lines as [[x, y], [x, y]].
export function gridLines(g) {
  const xs = g.cutsX.slice().sort((a, b) => b - a);
  const v = xs.map((x, i) => i % 2 ? [[x, g.fy0], [x, g.fy1]] : [[x, g.fy1], [x, g.fy0]]);
  const endTop = xs.length % 2 === 1;
  const ys = g.cutsY.slice().sort((a, b) => endTop ? a - b : b - a);
  const h = ys.map((y, i) => i % 2 ? [[g.fx1, y], [g.fx0, y]] : [[g.fx0, y], [g.fx1, y]]);
  return { v, h };
}
