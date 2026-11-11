// 2D affine matrices [a, b, c, d, e, f] and small shape helpers; units in mm unless noted.

export const PT = 72 / 25.4;
export const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
export const apply = (M, p) => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]];
export function roundRect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pts = [], corner = (cx, cy, a0) => {
    const n = Math.max(4, Math.ceil(r * Math.PI / 2 / 0.3));
    for (let i = 0; i <= n; i++) { const a = a0 + Math.PI / 2 * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}
