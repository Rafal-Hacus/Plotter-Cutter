// Text as outlines (filled rings, y down, in em of the font): lines one under the other, each centred / left /
// right, with its own size, made of runs in bold, italic and underlined. Fonts come from fontkit.
// When a family has no bold or italic face, it is made up: bold by thickening the letters, italic by slanting them.
import { offset, union } from './stamp.js';

export const FAUX_BOLD = 0.03; // em added around each letter
export const FAUX_SLANT = Math.tan(12 * Math.PI / 180);

function flattenGlyph(cmds, ox, oy, k, steps, out) {
  let cur = null, last = [0, 0], start = [0, 0];
  const P = (x, y) => [ox + x * k, oy - y * k]; // font units, y up -> em, y down
  const close = () => { if (cur && cur.length > 2) out.push(cur); cur = null; };
  for (const c of cmds) {
    const a = c.args;
    if (c.command === 'moveTo') { close(); cur = [P(a[0], a[1])]; last = start = [a[0], a[1]]; }
    else if (c.command === 'lineTo') { if (!cur) cur = [P(last[0], last[1])]; cur.push(P(a[0], a[1])); last = [a[0], a[1]]; }
    else if (c.command === 'quadraticCurveTo') {
      if (!cur) cur = [P(last[0], last[1])];
      for (let s = 1; s <= steps; s++) { const t = s / steps, u = 1 - t; cur.push(P(u * u * last[0] + 2 * u * t * a[0] + t * t * a[2], u * u * last[1] + 2 * u * t * a[1] + t * t * a[3])); }
      last = [a[2], a[3]];
    } else if (c.command === 'bezierCurveTo') {
      if (!cur) cur = [P(last[0], last[1])];
      for (let s = 1; s <= steps; s++) { const t = s / steps, u = 1 - t; cur.push(P(u * u * u * last[0] + 3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t * t * t * a[4], u * u * u * last[1] + 3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t * t * t * a[5])); }
      last = [a[4], a[5]];
    } else if (c.command === 'closePath') { close(); last = start; }
  }
  close();
}

// lines: [{ align: 'center' | 'left' | 'right', size (relative, 1 = normal), runs: [{ text, bold, italic, underline }] }]
// fontFor(bold, italic) -> { font, fauxBold, fauxItalic }: the face to use, and what has to be made up
// opts: { spacing (line distance in em of the line's size), steps (points per curve) }
export function richOutlines(lines, fontFor, { spacing = 1.15, steps = 12 } = {}) {
  const base = fontFor(false, false).font, rings = [];
  // measure each run, then each line
  const laid = lines.map(line => {
    const s = line.size || 1;
    let w = 0;
    const runs = (line.runs || []).filter(r => r.text).map(r => {
      const f = fontFor(!!r.bold, !!r.italic), run = f.font.layout(r.text.normalize('NFC')), k = s / f.font.unitsPerEm;
      // a made-up bold is wider by its thickening on each letter
      const adv = run.positions.reduce((a, p) => a + p.xAdvance, 0) * k + (f.fauxBold ? FAUX_BOLD * s * run.glyphs.length : 0);
      const out = { r, f, run, k, x: w, w: adv };
      w += adv;
      return out;
    });
    return { line, s, runs, w };
  });
  const maxW = Math.max(0, ...laid.map(l => l.w));
  let y = 0, prev = 0;
  laid.forEach((L, i) => {
    // baseline: the first line's ascent; then the line distance, weighted towards this line's size
    y += i ? spacing * (0.3 * prev + 0.7 * L.s) : (base.ascent / base.unitsPerEm) * L.s;
    prev = L.s;
    const x0 = L.line.align === 'left' ? 0 : L.line.align === 'right' ? maxW - L.w : (maxW - L.w) / 2;
    for (const R of L.runs) {
      let rr = [], x = x0 + R.x;
      const fauxStep = R.f.fauxBold ? FAUX_BOLD * L.s : 0;
      R.run.glyphs.forEach((g, j) => {
        const p = R.run.positions[j];
        flattenGlyph(g.path.commands, x + fauxStep + p.xOffset * R.k, y - p.yOffset * R.k, R.k, steps, rr);
        x += p.xAdvance * R.k + fauxStep;
      });
      if (R.f.fauxBold && rr.length) rr = offset(union(rr), fauxStep, 'round');
      if (R.r.underline) {
        const font = R.f.font, pos = (font.underlinePosition || -0.1 * font.unitsPerEm) * R.k, th = Math.max(0.04 * L.s, (font.underlineThickness || 0.06 * font.unitsPerEm) * R.k);
        const uy = y - pos - th / 2, ux0 = x0 + R.x, ux1 = ux0 + R.w;
        rr.push([[ux0, uy], [ux1, uy], [ux1, uy + th], [ux0, uy + th]]);
      }
      if (R.f.fauxItalic) rr = rr.map(r => r.map(([px, py]) => [px + (y - py) * FAUX_SLANT, py]));
      rings.push(...rr);
    }
  });
  return rings;
}

// The letters of the text the font (the face each run is set in) has no glyph for, each once, in order: the font
// sets them as nothing at all, so they would be silently missing from the stamp (a decorative font without ą, ł,
// a symbol). Spaces and invisible characters (soft hyphen, zero-width space, controls) don't count.
// (code point ranges: controls, soft hyphen, joiners, direction marks, variation selectors, BOM, specials)
const INVISIBLE = [[0, 0x20], [0x7f, 0xa0], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180f], [0x200b, 0x200f], [0x2028, 0x202f], [0x205f, 0x206f], [0x3000, 0x3000], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfff8]];
const invisible = ch => /\s/.test(ch) || INVISIBLE.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b);
export function missingChars(lines, fontFor) {
  const out = new Set();
  for (const line of lines) for (const r of line.runs || []) {
    if (!r.text) continue;
    const font = fontFor(!!r.bold, !!r.italic).font;
    for (const ch of r.text.normalize('NFC')) if (!invisible(ch) && !font.hasGlyphForCodePoint(ch.codePointAt(0))) out.add(ch);
  }
  return [...out].join('');
}

// plain lines in one font (each line one run)
export function textOutlines(font, lines, { align = 'center', spacing = 1.15, sizes = [], steps = 12 } = {}) {
  return richOutlines(lines.map((text, i) => ({ align, size: sizes[i] || 1, runs: [{ text }] })), () => ({ font }), { spacing, steps });
}
