// Pieczątki: rubber stamps for the xTool P2 laser. Each stamp comes from text typed here or from an SVG, is fitted
// to its size (Wagraf plate sizes or your own) with its proportions kept, gets the cut around it and the two
// engraving layers (core/stamp.js), and all of them are laid out on the laser bed and saved as an xTool Studio
// project (.xs) with the laser settings of the stamp project, one group per stamp (core/xs.js).
import { packRoll } from '../core/rollpack.js';
import { sanitize } from '../core/sanitize.js';
import { bbox, buildStamp, strokeToShapes, union } from '../core/stamp.js';
import { textOutlines } from '../core/stamptext.js';
import { SHAPES, expandUses, flattenPath, num, parseSvg } from '../core/svg.js';
import { BED, buildXsFiles } from '../core/xs.js';
import { makeZipDeflated } from '../core/zip.js';
import { byId, plural, saveFile, setMsg, ui } from '../dom.js';
import { schedule } from '../pipeline.js';
import { readOpts } from '../settings.js';
import { state } from '../state.js';
import { applyView } from '../viewport.js';
import { registerMode } from './registry.js';
import montserratBold from '@expo-google-fonts/montserrat/700Bold/Montserrat_700Bold.ttf?url';
import montserratMedium from '@expo-google-fonts/montserrat/500Medium/Montserrat_500Medium.ttf?url';
import playfair from '@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf?url';

// Wagraf self-inking stamps: imprint sizes from the Wagraf catalogue
export const STAMP_SIZES = { b1s: ['Wagraf B1s', 28, 12], b2: ['Wagraf B2', 39, 15], b3: ['Wagraf B3', 48, 19], b4: ['Wagraf B4', 59, 25] };
const FONTS = {
  arialBold: ['Arial-like, bold (Liberation Sans Bold)', () => new URL('pdfjs/standard_fonts/LiberationSans-Bold.ttf', document.baseURI).href],
  arial: ['Arial-like (Liberation Sans)', () => new URL('pdfjs/standard_fonts/LiberationSans-Regular.ttf', document.baseURI).href],
  montserratBold: ['Montserrat Bold', () => montserratBold],
  montserrat: ['Montserrat Medium', () => montserratMedium],
  serif: ['Playfair Display (serif)', () => playfair]
};
const LAYER_FILL = { red: '#ff8080', blue: '#5078ff' };
const stamps = { items: [], placed: [], tooBig: [] };
let nextId = 1;

/* ---------- fonts ---------- */
const fontCache = new Map();
async function loadFont(key, custom) {
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  if (key === 'custom') {
    if (!custom) throw new Error('Load a font file, or pick one of the fonts.');
    if (!custom.font) custom.font = fontkit.create(custom.bytes);
    return custom.font;
  }
  if (!fontCache.has(key)) fontCache.set(key, (async () => {
    const r = await fetch((FONTS[key] || FONTS.arialBold)[1]());
    if (!r.ok) throw new Error('Could not load the font.');
    return fontkit.create(new Uint8Array(await r.arrayBuffer()));
  })().catch(e => { fontCache.delete(key); throw e; }));
  return fontCache.get(key);
}

/* ---------- SVG artwork ---------- */
// Every visible shape of the SVG as filled rings (fills, and strokes turned into shapes of their width), in the
// SVG's user units. Text has to be converted to outlines (paths) in the SVG first.
function svgArt(text) {
  const doc = parseSvg(text);
  sanitize(doc); expandUses(doc);
  const texts = doc.querySelectorAll('text').length;
  doc.querySelectorAll('image,text').forEach(n => n.remove());
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none';
  try {
    const svg = document.importNode(doc.documentElement, true);
    svg.setAttribute('width', '1000'); svg.setAttribute('height', '1000'); svg.removeAttribute('preserveAspectRatio');
    host.appendChild(svg); document.body.appendChild(host);
    const inv = svg.getScreenCTM().inverse(), rings = [];
    for (const el of svg.querySelectorAll(SHAPES)) {
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue; // (visibility is hidden everywhere here: the SVG is measured off screen)
      const fillOn = cs.fill && cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0 && parseFloat(cs.opacity || '1') > 0;
      const strokeOn = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeOpacity || '1') > 0 && parseFloat(cs.strokeWidth) > 0;
      if (!fillOn && !strokeOn) continue;
      // white is the stamp's background, not ink
      if (fillOn && !strokeOn && /^rgb\(255, 255, 255\)$/.test(cs.fill)) continue;
      const m = inv.multiply(el.getScreenCTM()), at = n => parseFloat(el.getAttribute(n)) || 0;
      const T = ([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
      const ell = (cx, cy, rx, ry) => [{ pts: Array.from({ length: 96 }, (_, k) => [cx + rx * Math.cos(k / 96 * 2 * Math.PI), cy + ry * Math.sin(k / 96 * 2 * Math.PI)]), closed: true }];
      let polys;
      switch (el.localName) {
        case 'path': polys = flattenPath(el.getAttribute('d') || ''); break;
        case 'rect': { const x = at('x'), y = at('y'), w = at('width'), h = at('height'); polys = [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }]; break; }
        case 'circle': polys = ell(at('cx'), at('cy'), at('r'), at('r')); break;
        case 'ellipse': polys = ell(at('cx'), at('cy'), at('rx'), at('ry')); break;
        case 'line': polys = [{ pts: [[at('x1'), at('y1')], [at('x2'), at('y2')]], closed: false }]; break;
        default: {
          const a = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number), p = [];
          for (let k = 0; k + 1 < a.length; k += 2) p.push([a[k], a[k + 1]]);
          polys = [{ pts: p, closed: el.localName === 'polygon' }];
        }
      }
      const pts = polys.map(p => ({ pts: p.pts.map(T), closed: p.closed })).filter(p => p.pts.length > 1);
      if (fillOn) {
        const closedRings = pts.filter(p => p.pts.length > 2).map(p => p.pts);
        rings.push(...(cs.fillRule === 'evenodd' ? union(closedRings, 'evenodd') : union(closedRings)));
      }
      if (strokeOn) {
        const sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), w = parseFloat(cs.strokeWidth) * sc;
        for (const p of pts) rings.push(...strokeToShapes([p.pts], w, p.closed));
      }
    }
    return { rings, texts };
  } finally { host.remove(); }
}

/* ---------- the stamps ---------- */
function sizeOf(it) {
  if (it.size === 'custom') return [Math.max(5, it.w), Math.max(5, it.h)];
  const s = STAMP_SIZES[it.size] || STAMP_SIZES.b3;
  return [s[1], s[2]];
}
async function artOf(it) {
  if (it.kind === 'svg') return it.svg.rings;
  const lines = it.text.split('\n').map(l => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  if (!lines.length) throw new Error('Type the text of the stamp.');
  return textOutlines(await loadFont(it.font, it.customFont), lines, { align: it.align, spacing: it.spacing / 100 });
}
function stampOpts(o, it) {
  return { marginX: o.stMarginX, marginY: o.stMarginY, textGrow: o.stShoulder, outerGrow: o.stEdge, shape: it.shape, radius: it.radius };
}
async function compute(o, stale) {
  for (const it of stamps.items) {
    try {
      const art = await artOf(it);
      if (stale()) return false;
      const [W, H] = sizeOf(it);
      it.result = buildStamp(art, W, H, stampOpts(o, it));
      it.error = '';
    } catch (e) { it.result = null; it.error = e.message || String(e); }
    status(it);
  }
  // on the bed: each stamp by its full extent (the red edge reaches past the cut), never turned (the text reads
  // along the bed)
  const pieces = [];
  for (const it of stamps.items) {
    if (!it.result) continue;
    const e = bbox(it.result.red.concat([it.result.cut]));
    for (let c = 0; c < it.copies; c++) pieces.push({ id: `${it.id}:${c}`, it, e });
  }
  const edge = o.stBedEdge, r = packRoll(pieces.map(p => ({ id: p.id, w: p.e.w, h: p.e.h })), { width: BED.w - 2 * edge, gap: o.stGap, rotate: false });
  const byKey = new Map(pieces.map(p => [p.id, p]));
  stamps.placed = r.sheets.length ? r.sheets[0].places.map(pl => ({ ...byKey.get(pl.id), x: pl.x + edge, y: pl.y + edge })) : [];
  stamps.length = r.sheets.length ? r.sheets[0].length + edge : 0;
  stamps.tooBig = [...new Set(r.tooBig.map(id => byKey.get(id).it.name))];
}

/* ---------- the list ---------- */
function sizeOptions() {
  return Object.entries(STAMP_SIZES).map(([k, [n, w, h]]) => `<option value="${k}">${n} (${w} × ${h} mm)</option>`).join('') + '<option value="custom">Custom size</option>';
}
function list() {
  const ul = byId('stList');
  ul.innerHTML = '';
  if (!stamps.items.length) { ul.innerHTML = '<li class="empty">No stamps yet.</li>'; return; }
  for (const it of stamps.items) {
    const li = document.createElement('li');
    li.className = 'design stamp';
    li.innerHTML = `<div class="thumb"></div><div>
      <div class="dname"></div>
      ${it.kind === 'text' ? `<label class="sttext">Text (one line per line of the stamp)<textarea rows="5" spellcheck="false"></textarea></label>
      <div class="fields"><label>Font<select class="stfont">${Object.entries(FONTS).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join('')}<option value="custom">Your font file…</option></select></label>
        <label class="stfontfile" hidden>Font file<input type="file" accept=".ttf,.otf,font/ttf,font/otf"></label>
        <label>Lines<select class="stalign"><option value="center">Centred</option><option value="left">Left</option><option value="right">Right</option></select></label>
        <label>Line spacing<input type="number" class="stspacing" min="80" max="250" step="5"> %</label></div>` : ''}
      <div class="fields"><label>Size<select class="stsize">${sizeOptions()}</select></label>
        <label class="stcustom">W<input type="number" class="stw" min="5" step="1"> × H<input type="number" class="sth" min="5" step="1"> mm</label>
        <label>Copies<input type="number" class="stq" min="0" step="1"></label></div>
      <div class="fields"><label>Cut<select class="stshape"><option value="hull">Around the text (straight edges)</option><option value="rect">Rectangle of the size</option><option value="round">Rounded rectangle of the size</option></select></label>
        <label class="stradius">Corner radius<input type="number" class="str" min="0" step="0.5"> mm</label></div>
      <div class="status stst"></div></div><button type="button" class="remove">×</button>`;
    const q = s => li.querySelector(s), dn = q('.dname');
    dn.textContent = it.name; dn.title = it.name;
    const changed = () => { syncRow(it, li); schedule(); };
    if (it.kind === 'text') {
      const ta = q('textarea'); ta.value = it.text;
      ta.addEventListener('input', () => { it.text = ta.value; it.name = ta.value.split('\n').find(Boolean) || 'Stamp'; dn.textContent = it.name; schedule(); });
      const f = q('.stfont'); f.value = it.font; f.addEventListener('change', () => { it.font = f.value; changed(); });
      q('.stfontfile input').addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        it.customFont = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
        changed();
      });
      const al = q('.stalign'); al.value = it.align; al.addEventListener('change', () => { it.align = al.value; changed(); });
      const sp = q('.stspacing'); sp.value = it.spacing; sp.addEventListener('input', () => { it.spacing = Math.max(50, parseFloat(sp.value) || 115); schedule(); });
    }
    const sz = q('.stsize'); sz.value = it.size; sz.addEventListener('change', () => { it.size = sz.value; changed(); });
    const w = q('.stw'), h = q('.sth'); w.value = it.w; h.value = it.h;
    w.addEventListener('input', () => { it.w = parseFloat(w.value) || 0; schedule(); });
    h.addEventListener('input', () => { it.h = parseFloat(h.value) || 0; schedule(); });
    const cq = q('.stq'); cq.value = it.copies; cq.addEventListener('input', () => { const v = parseInt(cq.value, 10); it.copies = isFinite(v) && v >= 0 ? v : 0; schedule(); });
    const sh = q('.stshape'); sh.value = it.shape; sh.addEventListener('change', () => { it.shape = sh.value; changed(); });
    const rr = q('.str'); rr.value = it.radius; rr.addEventListener('input', () => { it.radius = Math.max(0, parseFloat(rr.value) || 0); schedule(); });
    const rm = q('.remove'); rm.setAttribute('aria-label', `Remove ${it.name}`);
    rm.addEventListener('click', () => { stamps.items.splice(stamps.items.indexOf(it), 1); list(); schedule(); });
    it.li = li;
    syncRow(it, li); status(it);
    ul.appendChild(li);
  }
}
function syncRow(it, li) {
  li.querySelector('.stcustom').hidden = it.size !== 'custom';
  li.querySelector('.stradius').hidden = it.shape !== 'round';
  const ff = li.querySelector('.stfontfile');
  if (ff) ff.hidden = it.font !== 'custom';
}
function status(it) {
  if (!it.li || !it.li.isConnected) return;
  const st = it.li.querySelector('.stst'), [W, H] = sizeOf(it), r = it.result;
  if (it.error) { st.textContent = it.error; st.classList.add('warn'); }
  else if (r) {
    const a = bbox(r.art), c = bbox([r.cut]);
    st.classList.remove('warn');
    st.textContent = `${num(W)} × ${num(H)} mm: text ${num(Math.round(a.w * 10) / 10)} × ${num(Math.round(a.h * 10) / 10)} mm, cut ${num(Math.round(c.w * 10) / 10)} × ${num(Math.round(c.h * 10) / 10)} mm.${it.svg && it.svg.texts ? ` ${it.svg.texts} text ${it.svg.texts === 1 ? 'element was' : 'elements were'} left out: convert text to outlines (paths) in the SVG.` : ''}`;
  }
  const th = it.li.querySelector('.thumb');
  th.innerHTML = r ? stampSvg(r, 'thumb') : '';
}
function newItem(kind, extra) {
  const o = readOpts();
  return { id: nextId++, kind, copies: 1, size: o.stSize, w: 48, h: 19, shape: 'hull', radius: 2, font: 'arialBold', align: 'center', spacing: 115, text: '', name: 'Stamp', ...extra };
}
function addText() {
  stamps.items.push(newItem('text', { text: 'Firma Przykład\nul. Długa 1, 00-001 Warszawa\nNIP 123-456-78-90\ntel. 600 000 000', name: 'Firma Przykład' }));
  list(); schedule();
}
async function addSvgs(files) {
  const failed = [];
  for (const f of Array.from(files)) {
    try {
      if (!/\.svg$/i.test(f.name) && f.type !== 'image/svg+xml') throw new Error('not an SVG');
      const svg = svgArt(await f.text());
      if (!svg.rings.length) throw new Error(svg.texts ? 'it only has text: convert the text to outlines (paths) first' : 'nothing filled or stroked in it');
      stamps.items.push(newItem('svg', { svg, name: f.name }));
    } catch (e) { failed.push(`${f.name}: ${e.message || e}.`); }
  }
  state.loadError = failed.join(' ');
  list(); schedule();
}

/* ---------- preview ---------- */
const ringsD = rings => rings.map(r => `M${r.map(p => `${num(p[0])},${num(p[1])}`).join('L')}Z`).join('');
// one stamp as it will be engraved (mirrored), in its own mm; mode 'thumb' for the list
function stampSvg(r, mode) {
  const e = bbox(r.red.concat([r.cut])), pad = 0.5;
  const g = `<g transform="matrix(-1 0 0 1 ${num(e.x0 + e.x1)} 0)"><path d="${ringsD(r.red)}" fill="${LAYER_FILL.red}" fill-rule="evenodd"/><path d="${ringsD(r.blue)}" fill="${LAYER_FILL.blue}" fill-rule="evenodd"/><path d="${ringsD([r.cut])}" fill="none" stroke="#000" stroke-width="0.15"/></g>`;
  if (mode === 'thumb') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(e.x0 - pad)} ${num(e.y0 - pad)} ${num(e.w + 2 * pad)} ${num(e.h + 2 * pad)}" style="max-width:100%;max-height:100%">${g}</svg>`;
  return g;
}
function renderPreview() {
  const L = Math.max(BED.h, stamps.length || 0);
  state.previewFrame = { x: -10, y: -10, w: BED.w + 20, h: L + 20 };
  const f = state.previewFrame, p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.x} ${f.y} ${f.w} ${f.h}" role="img" aria-label="Laser bed preview"><rect x="0" y="0" width="${BED.w}" height="${BED.h}" fill="#fff" stroke="#9fb0a9" vector-effect="non-scaling-stroke"/>`];
  for (const pl of stamps.placed) {
    const e = bbox(pl.it.result.red.concat([pl.it.result.cut]));
    p.push(`<g transform="translate(${num(pl.x - e.x0)} ${num(pl.y - e.y0)})">${stampSvg(pl.it.result)}</g>`);
  }
  p.push('</svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderStats(busyText) {
  const n = stamps.placed.length;
  ui.dropNote.hidden = stamps.items.length > 0;
  byId('exStampsXs').disabled = !n || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = !stamps.items.length ? 'No stamps yet' : `${plural(n, 'stamp')} on the bed`;
  const notes = [];
  if (stamps.tooBig.length) notes.push(`Too big for the bed: ${stamps.tooBig.join(', ')}.`);
  if (stamps.length > BED.h) notes.push(`The stamps need ${num(Math.round(stamps.length))} mm, more than the ${BED.h} mm of the bed: make fewer copies, or move some in xTool Studio.`);
  setMsg(notes.join(' '), notes.length > 0);
}

/* ---------- the xTool project ---------- */
// a picture of the job for xTool's project list (as the stamps look on the bed)
async function coverPng() {
  const e = stamps.placed.reduce((a, pl) => { const b = bbox(pl.it.result.red.concat([pl.it.result.cut])); return { x0: Math.min(a.x0, pl.x), y0: Math.min(a.y0, pl.y), x1: Math.max(a.x1, pl.x + b.w), y1: Math.max(a.y1, pl.y + b.h) }; }, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const k = 400 / Math.max(1, e.x1 - e.x0), W = 400, H = Math.max(1, Math.round((e.y1 - e.y0) * k));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${num(e.x0)} ${num(e.y0)} ${num(e.x1 - e.x0)} ${num(e.y1 - e.y0)}">${stamps.placed.map(pl => { const b = bbox(pl.it.result.red.concat([pl.it.result.cut])); return `<g transform="translate(${num(pl.x - b.x0)} ${num(pl.y - b.y0)})">${stampSvg(pl.it.result)}</g>`; }).join('')}</svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  cv.getContext('2d').drawImage(img, 0, 0, W, H);
  return new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer());
}
export async function buildStampsXs() {
  const list_ = stamps.placed.map(pl => {
    const r = pl.it.result;
    return { x: pl.x, y: pl.y, parts: { blue: r.blue, red: r.red, black: [r.cut] } };
  });
  let cover = null;
  try { cover = await coverPng(); } catch { /* the project is fine without a cover */ }
  const files = await buildXsFiles(list_, { cover, name: 'Pieczątki' });
  return makeZipDeflated(files);
}
byId('exStampsXs').addEventListener('click', async () => {
  const btn = byId('exStampsXs'); btn.disabled = true;
  try { await saveFile(`pieczatki-${stamps.placed.length}szt.xs`, await buildStampsXs()); }
  catch (e) { setMsg(`Couldn’t make the xTool file: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
byId('stAddText').addEventListener('click', addText);
byId('stSvgFile').addEventListener('change', e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) addSvgs(files); });

list();
registerMode('stamps', { compute, renderPreview, renderStats, onDrop: addSvgs });
