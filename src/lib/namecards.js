// Winietki (place cards) from a list of names: one PDF page per name, the card size plus bleed, an optional
// shared background, and the name set in an embedded font (Polish letters included).
import montserrat from '@expo-google-fonts/montserrat/500Medium/Montserrat_500Medium.ttf?url';
import playfair from '@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf?url';
import greatVibes from '@expo-google-fonts/great-vibes/400Regular/GreatVibes_400Regular.ttf?url';
import { ensureLibs } from './pdf.js';

export const FONTS = { sans: montserrat, serif: playfair, script: greatVibes };
export const BG_BLEED = 2; // mm, used when there is a background graphic
const PT = 72 / 25.4;
const fontCache = new Map();
async function fontBytes(key) {
  if (!fontCache.has(key)) fontCache.set(key, fetch(FONTS[key]).then(r => { if (!r.ok) throw new Error('Could not load the font.'); return r.arrayBuffer(); }));
  return fontCache.get(key);
}

// One name per line; blank lines and surrounding spaces dropped.
export const parseNames = text => String(text || '').split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

// Where the name goes, in card mm (y down from the top of the trim): [{ x, y, w, h, flip }]
// fold: { dir: 'h' | 'v', pos } or null; both: the name also on the other half of a tent card, upside down.
export function textAreas(W, H, fold, both) {
  if (fold && fold.dir === 'h') {
    const areas = [{ x: 0, y: fold.pos, w: W, h: H - fold.pos, flip: false }];
    if (both) areas.push({ x: 0, y: 0, w: W, h: fold.pos, flip: true });
    return areas;
  }
  if (fold && fold.dir === 'v') return [{ x: fold.pos, y: 0, w: W - fold.pos, h: H, flip: false }]; // the front cover
  return [{ x: 0, y: 0, w: W, h: H, flip: false }];
}

// opts: { names, W, H (trim mm), bg: null | { kind: 'png'|'jpg'|'pdf', bytes, page }, font: 'sans'|'serif'|'script',
//         fontFile (bytes of your own font, for 'custom'), size (pt, the largest), color '#rrggbb', fold, both }
// Returns { bytes, bleed, shrunk: number of names made smaller to fit }.
export async function buildNameCardsPdf(opts) {
  await ensureLibs();
  const { PDFDocument, rgb, degrees } = window.PDFLib;
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const { names, W, H, bg, fold, both } = opts;
  const b = bg ? BG_BLEED : 0, pw = (W + 2 * b) * PT, ph = (H + 2 * b) * PT;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(opts.font === 'custom' && opts.fontFile ? opts.fontFile : await fontBytes(FONTS[opts.font] ? opts.font : 'sans'), { subset: true });
  let bgObj = null;
  if (bg) {
    if (bg.kind === 'pdf') [bgObj] = await pdf.embedPdf(await PDFDocument.load(bg.bytes, { ignoreEncryption: true }), [bg.page || 0]);
    else bgObj = bg.kind === 'png' ? await pdf.embedPng(bg.bytes) : await pdf.embedJpg(bg.bytes);
  }
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(opts.color || '') || [0, '1f', '2a', '24'];
  const color = rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
  const areas = textAreas(W, H, fold, both);
  const MARGIN = 5; // mm of space kept on each side of the name
  let shrunk = 0;
  for (const name of names) {
    const page = pdf.addPage([pw, ph]);
    if (b) page.setTrimBox(b * PT, b * PT, W * PT, H * PT);
    if (bgObj) { // fill the card plus bleed, proportions kept, centred
      const k = Math.max(pw / bgObj.width, ph / bgObj.height), w = bgObj.width * k, h = bgObj.height * k;
      const at = { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h };
      if (bg.kind === 'pdf') page.drawPage(bgObj, at); else page.drawImage(bgObj, at);
    }
    let small = false;
    for (const a of areas) {
      // largest size up to the chosen one that fits the width and 60 % of the height
      const room = Math.max(1, (a.w - 2 * MARGIN) * PT), unit = font.widthOfTextAtSize(name, 1) || 1;
      const size = Math.min(opts.size, room / unit, a.h * PT * 0.6 / (font.heightAtSize(1, { descender: false }) || 1));
      if (size < opts.size - 0.01) small = true;
      const tw = font.widthOfTextAtSize(name, size), capMid = font.heightAtSize(size, { descender: false }) * 0.36;
      const cx = (b + a.x + a.w / 2) * PT, cy = ph - (b + a.y + a.h / 2) * PT; // centre of the area, PDF y up
      if (a.flip) page.drawText(name, { x: cx + tw / 2, y: cy + capMid, size, font, color, rotate: degrees(180) });
      else page.drawText(name, { x: cx - tw / 2, y: cy - capMid, size, font, color });
    }
    if (small) shrunk++;
  }
  pdf.setTitle(`Winietki, ${names.length} names`);
  return { bytes: await pdf.save(), bleed: b, shrunk };
}
