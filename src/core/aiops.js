// Image operations around the AI models, independent of how a model is run (unit tested with stand-ins).
// Images here are { w, h, rgb: Uint8Array(w * h * 3) } (RGB, row by row); masks are Uint8Array(w * h), 1 = known.
//
// Fill (MI-GAN): runTile(rgb, mask, w, h) -> Promise<Uint8Array rgb> fills the unknown pixels of one tile.
//   - fillTiles: tiles of up to T px at full resolution; a tile's result is only kept M px away from tile sides
//     inside the image (the model is weakest at its own borders), and kept pixels become context for later tiles.
//   - extendGrow: outpainting. The known rectangle grows outwards `step` px at a time, the model filling each new
//     band next to the real picture. (Stand-in context beyond the band was tried: a mirror image brought back
//     ghost letters, a stretched and blurred edge made the fill blurry and streaky.) The original pixels are
//     never touched.
// Upscale: backProject makes the AI result agree with the original: scaled back down (box average), it gives the
//   original again, so the AI can add sharpness but cannot change what is in the picture.

export const image = (w, h, rgb = new Uint8Array(w * h * 3)) => ({ w, h, rgb });

// symmetric index: -1 -> 0, -2 -> 1, n -> n - 1 (like numpy 'symmetric'), for any distance
const sym = (i, n) => { const p = 2 * n; i = ((i % p) + p) % p; return i < n ? i : p - 1 - i; };
export function mirrorPad(img, p) {
  const W = img.w + 2 * p, H = img.h + 2 * p, out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = sym(y - p, img.h);
    for (let x = 0; x < W; x++) {
      const sx = sym(x - p, img.w), s = (sy * img.w + sx) * 3, d = (y * W + x) * 3;
      out[d] = img.rgb[s]; out[d + 1] = img.rgb[s + 1]; out[d + 2] = img.rgb[s + 2];
    }
  }
  return image(W, H, out);
}
// edge pixels repeated outwards p px on every side
export function edgePad(img, p) {
  const W = img.w + 2 * p, H = img.h + 2 * p, out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(img.h - 1, Math.max(0, y - p));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(img.w - 1, Math.max(0, x - p)), s = (sy * img.w + sx) * 3, d = (y * W + x) * 3;
      out[d] = img.rgb[s]; out[d + 1] = img.rgb[s + 1]; out[d + 2] = img.rgb[s + 2];
    }
  }
  return image(W, H, out);
}
export function crop(img, x, y, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let r = 0; r < h; r++) out.set(img.rgb.subarray(((y + r) * img.w + x) * 3, ((y + r) * img.w + x + w) * 3), r * w * 3);
  return image(w, h, out);
}
export function paste(dst, src, x, y) {
  for (let r = 0; r < src.h; r++) dst.rgb.set(src.rgb.subarray(r * src.w * 3, (r + 1) * src.w * 3), ((y + r) * dst.w + x) * 3);
}

// box blur (two passes ~ a soft Gaussian), radius r, in place
export function boxBlur(img, r) {
  const { w, h } = img, a = Float32Array.from(img.rgb), b = new Float32Array(a.length), n = 2 * r + 1;
  const pass = (src, dst, along) => {
    const [len, lines, step, lineStep] = along === 'x' ? [w, h, 3, w * 3] : [h, w, w * 3, 3];
    for (let L = 0; L < lines; L++) for (let c = 0; c < 3; c++) {
      const base = L * lineStep + c, at = i => src[base + Math.min(len - 1, Math.max(0, i)) * step];
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += at(i);
      for (let i = 0; i < len; i++) { dst[base + i * step] = sum / n; sum += at(i + r + 1) - at(i - r); }
    }
  };
  for (let k = 0; k < 2; k++) { pass(a, b, 'x'); pass(b, a, 'y'); }
  for (let i = 0; i < a.length; i++) img.rgb[i] = Math.round(a[i]);
  return img;
}

// The hole's pixels next to the picture, set to the nearest picture colour (a few px deep). The model's pipeline lets
// the hole's own pixels show through in the first pixels of its fill: black there made a dark line along the edge.
export function nearFill(tile, mask, depth = 6) {
  const { w, h, rgb } = tile, k = Uint8Array.from(mask);
  for (let it = 0; it < depth; it++) {
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (k[i]) continue;
      let n = 0, s0 = 0, s1 = 0, s2 = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h || !k[Y * w + X]) continue;
        const q = (Y * w + X) * 3; s0 += rgb[q]; s1 += rgb[q + 1]; s2 += rgb[q + 2]; n++;
      }
      if (n) add.push(i, Math.round(s0 / n), Math.round(s1 / n), Math.round(s2 / n));
    }
    if (!add.length) break;
    for (let a = 0; a < add.length; a += 4) { const i = add[a]; rgb[i * 3] = add[a + 1]; rgb[i * 3 + 1] = add[a + 2]; rgb[i * 3 + 2] = add[a + 3]; k[i] = 1; }
  }
  return rgb;
}

const starts = (L, T, step) => { const s = new Set([0, Math.max(0, L - T)]); for (let v = 0; v < L - T; v += step) s.add(v); return [...s].sort((a, b) => a - b); };

// Fills the unknown pixels of img in place. known is updated as pixels get filled.
export async function fillTiles(img, known, runTile, { T = 512, M = 32, onTile } = {}) {
  const { w: W, h: H } = img, step = Math.max(1, T - 2 * M);
  for (let pass = 0; pass < 3; pass++) {
    if (known.every(Boolean)) return;
    // holes per rectangle in O(1): a summed-area table
    const sat = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += known[y * W + x] ? 0 : 1; sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row; } }
    const holesIn = (x, y, w, h) => sat[(y + h) * (W + 1) + x + w] - sat[y * (W + 1) + x + w] - sat[(y + h) * (W + 1) + x] + sat[y * (W + 1) + x];
    for (const y of starts(H, T, step)) for (const x of starts(W, T, step)) {
      const tw = Math.min(T, W - x), th = Math.min(T, H - y);
      if (!holesIn(x, y, tw, th)) continue;
      const mask = new Uint8Array(tw * th);
      let holes = 0;
      for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) { const k = known[(y + r) * W + x + c]; mask[r * tw + c] = k; if (!k) holes++; }
      if (!holes) continue;
      const out = await runTile(nearFill(crop(img, x, y, tw, th), mask), mask, tw, th);
      if (onTile) onTile();
      const y0 = y === 0 ? 0 : M, x0 = x === 0 ? 0 : M, y1 = y + th >= H ? th : th - M, x1 = x + tw >= W ? tw : tw - M;
      for (let r = y0; r < y1; r++) for (let c = x0; c < x1; c++) {
        if (mask[r * tw + c]) continue;
        const d = ((y + r) * W + x + c) * 3, s = (r * tw + c) * 3;
        img.rgb[d] = out[s]; img.rgb[d + 1] = out[s + 1]; img.rgb[d + 2] = out[s + 2];
        known[(y + r) * W + x + c] = 1;
      }
    }
  }
}

// src placed at (x0, y0) in a W x H canvas (the rest unknown); returns the filled canvas. The known rectangle grows
// outwards `step` px at a time; each step the model sees the real picture next to the band it fills (no stand-in
// context: a blurred or stretched one made the fill blurry and streaky), so it continues textures at full sharpness.
export async function extendGrow(src, W, H, x0, y0, runTile, { step = 64, T = 512, M = 32, onTile } = {}) {
  const C = image(W, H);
  // the part of src that lies on the canvas
  const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(W, x0 + src.w), cy1 = Math.min(H, y0 + src.h);
  if (cx1 <= cx0 || cy1 <= cy0) throw new Error('The picture is outside the page.');
  paste(C, crop(src, cx0 - x0, cy0 - y0, cx1 - cx0, cy1 - cy0), cx0, cy0);
  let l = cx0, t = cy0, r = cx1, b = cy1;
  while (l > 0 || t > 0 || r < W || b < H) {
    const dl = Math.min(step, l), dt = Math.min(step, t), dr = Math.min(step, W - r), db = Math.min(step, H - b);
    // the known rectangle plus the band around it; the model only needs a tile's worth of picture next to the band
    const R = crop(C, l - dl, t - dt, r - l + dl + dr, b - t + dt + db), known = new Uint8Array(R.w * R.h);
    for (let y = dt; y < dt + b - t; y++) known.fill(1, y * R.w + dl, y * R.w + dl + r - l);
    await fillTiles(R, known, runTile, { T, M, onTile });
    paste(C, R, l - dl, t - dt);
    l -= dl; t -= dt; r += dr; b += db;
  }
  return C;
}

// out: the AI upscale of inp by the whole number s (out.w = inp.w * s). Adjusts out in place so that its s x s
// box averages equal inp (to within rounding): iterative back-projection with bilinear spreading of the error.
export function backProject(out, inp, s, iters = 4) {
  const W = out.w, H = out.h, w = inp.w, h = inp.h, o = out.rgb, err = new Float32Array(w * h * 3), area = s * s;
  // bilinear spreading weights, once per column and per row
  const axis = (N, n) => {
    const i0 = new Int32Array(N), i1 = new Int32Array(N), f = new Float32Array(N);
    for (let X = 0; X < N; X++) { const u = Math.min(n - 1, Math.max(0, (X + 0.5) / s - 0.5)); i0[X] = Math.floor(u); i1[X] = Math.min(n - 1, i0[X] + 1); f[X] = u - i0[X]; }
    return { i0, i1, f };
  };
  const ax = axis(W, w), ay = axis(H, h), rowA = new Float32Array(W * 3), rowB = new Float32Array(W * 3);
  for (let it = 0; it < iters; it++) {
    // the error of each original pixel: original - box average of its s x s block
    err.fill(0);
    for (let Y = 0; Y < H; Y++) {
      const er = Math.floor(Y / s) * w * 3, orow = Y * W * 3;
      for (let X = 0; X < W; X++) { const e = er + Math.floor(X / s) * 3, q = orow + X * 3; err[e] -= o[q]; err[e + 1] -= o[q + 1]; err[e + 2] -= o[q + 2]; }
    }
    for (let i = 0; i < err.length; i++) err[i] = inp.rgb[i] + err[i] / area;
    // spread it back bilinearly: first along x for the two error rows a row of out needs, then along y
    let lastA = -1, lastB = -1;
    const fillRow = (row, y) => { for (let X = 0; X < W; X++) { const a = (y * w + ax.i0[X]) * 3, b = (y * w + ax.i1[X]) * 3, f = ax.f[X]; for (let c = 0; c < 3; c++) row[X * 3 + c] = err[a + c] * (1 - f) + err[b + c] * f; } };
    for (let Y = 0; Y < H; Y++) {
      const y0 = ay.i0[Y], y1 = ay.i1[Y], fy = ay.f[Y];
      if (y0 !== lastA) { fillRow(rowA, y0); lastA = y0; }
      if (y1 !== lastB) { fillRow(rowB, y1); lastB = y1; }
      const q0 = Y * W * 3;
      for (let k = 0; k < W * 3; k++) { const v = o[q0 + k] + rowA[k] * (1 - fy) + rowB[k] * fy; o[q0 + k] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
    }
  }
  return out;
}
// the largest |box average of out - inp|, to check an upscale
export function boxError(out, inp, s) {
  let worst = 0;
  for (let y = 0; y < inp.h; y++) for (let x = 0; x < inp.w; x++) for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) sum += out.rgb[((y * s + dy) * out.w + x * s + dx) * 3 + c];
    worst = Math.max(worst, Math.abs(sum / (s * s) - inp.rgb[(y * inp.w + x) * 3 + c]));
  }
  return worst;
}
