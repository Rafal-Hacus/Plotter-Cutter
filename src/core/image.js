// Image helpers: embedded dpi, EXIF orientation, data URLs, round-sticker detection.
import { num } from './svg.js';

// Pixel density stored in the file (PNG pHYs, JPEG JFIF), or null.
export function imageDpi(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 33 && b[0] === 0x89 && b[1] === 0x50) {
    for (let p = 8; p + 12 <= b.length;) {
      const len = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (type === 'pHYs' && len >= 9 && b[p + 16] === 1) { const ppm = dv.getUint32(p + 8); return ppm > 0 ? ppm * 0.0254 : null; }
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + len;
    }
  } else if (b.length > 18 && b[0] === 0xFF && b[1] === 0xD8 && b[6] === 0x4A && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46) {
    const unit = b[13], x = dv.getUint16(14);
    if (x > 1) return unit === 1 ? x : unit === 2 ? x * 2.54 : null;
  }
  return null;
}
// EXIF orientation of a JPEG (1 = upright), so a phone photo isn't embedded sideways.
export function jpegOrientation(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return 1;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let p = 2; p + 4 < b.length;) {
    if (b[p] !== 0xFF) return 1;
    const mk = b[p + 1], len = dv.getUint16(p + 2);
    if (mk === 0xE1 && String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]) === 'Exif') {
      const t = p + 10, le = dv.getUint16(t) === 0x4949, g16 = o => dv.getUint16(t + o, le), g32 = o => dv.getUint32(t + o, le);
      const ifd = g32(4), n = g16(ifd);
      for (let i = 0; i < n; i++) if (g16(ifd + 2 + i * 12) === 0x0112) return g16(ifd + 2 + i * 12 + 8) || 1;
      return 1;
    }
    if (mk === 0xDA) return 1;
    p += 2 + len;
  }
  return 1;
}
export const readAsDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
// Find the sticker's circle near the middle of the page: for centres within ±4 % and radii from 20 to 50 %
// of the shorter side, the colour step across the circle is measured at 120 angles; the score is the 30th
// percentile, so the edge has to run most of the way round (a real circle, not one strong line). Of the
// clear circles found, the outermost wins: a round sticker design is usually rings inside one outer circle.
export function detectCircle(src) {
  const N = 320, k = N / Math.max(src.width, src.height), w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, S = Math.min(w, h), A = 120;
  const cos = [], sin = [];
  for (let a = 0; a < A; a++) { cos.push(Math.cos(a / A * 2 * Math.PI)); sin.push(Math.sin(a / A * 2 * Math.PI)); }
  const at = (x, y) => { x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y))); return (y * w + x) * 4; };
  const dl = Math.max(1.5, S * 0.006), diffs = new Float64Array(A);
  const byR = []; // best centre per radius
  for (let ox = -0.04; ox <= 0.0401; ox += 0.01) for (let oy = -0.04; oy <= 0.0401; oy += 0.01) {
    const cx = w * (0.5 + ox), cy = h * (0.5 + oy);
    for (let ri = 0, rf = 0.2; rf <= 0.5; ri++, rf += 0.0025) {
      const r = rf * S;
      for (let a = 0; a < A; a++) {
        const i = at(cx + (r - dl) * cos[a], cy + (r - dl) * sin[a]), j = at(cx + (r + dl) * cos[a], cy + (r + dl) * sin[a]);
        diffs[a] = Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
      }
      const sc = Float64Array.from(diffs).sort()[Math.floor(A * 0.3)];
      if (!byR[ri] || sc > byR[ri].sc + 1e-9) byR[ri] = { sc, x: ox, y: oy, size: 2 * rf };
    }
  }
  const top = Math.max(...byR.map(b => b.sc));
  if (!(top >= 24)) return null;
  // outermost local peak that is still a clear edge (at least 45 % of the strongest one)
  for (let i = byR.length - 1; i >= 0; i--) {
    const b = byR[i], prev = byR[i - 1], next = byR[i + 1];
    if (b.sc >= Math.max(24, 0.45 * top) && (!prev || b.sc >= prev.sc) && (!next || b.sc >= next.sc)) return b;
  }
  return null;
}
// circle: { img, w, h (page in pt), size (fraction of the shorter side), x, y (centre offset, fraction of width/height) }
export function circleSvg(c) {
  const s = Math.min(c.w, c.h), r = c.size * s / 2, cx = c.w * (0.5 + c.x), cy = c.h * (0.5 + c.y);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${num(c.w)} ${num(c.h)}" width="${num(c.w)}pt" height="${num(c.h)}pt">`
    + `<image href="${c.img}" x="0" y="0" width="${num(c.w)}" height="${num(c.h)}" preserveAspectRatio="none"/>`
    + `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="none" stroke="#e6007e" stroke-width="${num(s / 400)}"/></svg>`;
}
