// Pieczątki: rubber stamps for the xTool P2 laser. Each stamp comes from text typed here or from an SVG, is fitted
// to its size (Wagraf plate sizes or your own) with its proportions kept, gets the cut around it and the two
// engraving layers (core/stamp.js), and all of them are laid out on the laser bed and saved as an xTool Studio
// project (.xs) with the laser settings of the stamp project, one group per stamp (core/xs.js).
import { packRoll } from '../core/rollpack.js';
import { sanitize } from '../core/sanitize.js';
import { bbox, buildStamp, splitPasses, stampMargins, strokeToShapes, union } from '../core/stamp.js';
import { missingChars, richOutlines } from '../core/stamptext.js';
import { DEFAULT_FAMILY, addFontFiles, cssFamily, families, fontResolver, loadLibrary, onFontsChanged, ownFamilies, removeFamily } from '../stampfonts.js';
import { SHAPES, expandUses, flattenPath, num, parseSvg } from '../core/svg.js';
import { BED, buildXsFiles } from '../core/xs.js';
import { makeZipDeflated } from '../core/zip.js';
import { PT } from '../core/matrix.js';
import { byId, plural, saveFile, setMsg, ui } from '../dom.js';
import { ensureLibs } from '../lib/pdf.js';
import { schedule } from '../pipeline.js';
import { readOpts } from '../settings.js';
import { state } from '../state.js';
import { applyView } from '../viewport.js';
import { registerMode } from './registry.js';
// Wagraf self-inking stamps: imprint sizes from the Wagraf catalogue
export const STAMP_SIZES = { b1s: ['Wagraf B1s', 28, 12], b2: ['Wagraf B2', 39, 15], b3: ['Wagraf B3', 48, 19], b4: ['Wagraf B4', 59, 25] };
const LAYER_FILL = { red: '#ff8080', blue: '#5078ff' };
const SLOPE_FILL = ['#f25c5c', '#e03535', '#c41f1f', '#a30f0f'];
const stamps = { items: [], placed: [], tooBig: [] };
let nextId = 1;

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
// the artwork; W, H, opts: the stamp's size and margins (to spread the lines over the height)
async function artOf(it, W, H, opts) {
  if (it.kind === 'svg') return it.svg.rings;
  const lines = trimLines(it.lines);
  if (!lines.length) throw new Error('Type the text of the stamp.');
  // the layout is in em of 10 pt; set as typed (pt), it is turned into mm, else the stamp fits it to its size
  const fontFor = await fontResolver(it.font), at = sp => richOutlines(lines, fontFor, { spacing: sp });
  it.missing = missingChars(lines, fontFor);
  const mm = rings => (it.exact ? rings.map(r => r.map(([x, y]) => [x * EM_MM, y * EM_MM])) : rings);
  const s0 = it.spacing / 100, art = at(s0);
  if (!it.spread || lines.length < 2) return mm(art);
  // Lines spread apart to fill the height (the height grows with the spacing, the width doesn't), at most to twice
  // the font size. Fitted: a long line makes the text fill the width long before the height, so the lines spread
  // until the text block has the shape of the space for it. Set in pt: until it is as high as the space for it.
  const { mx, my } = stampMargins(W, H, opts.marginX, opts.marginY), b0 = bbox(art), roomH = H - 2 * my;
  const wantH = it.exact ? roomH / EM_MM : b0.w * roomH / (W - 2 * mx);
  if (!(b0.w > 0) || b0.h >= wantH) return mm(art);
  const b1 = bbox(at(s0 + 0.5)), perUnit = (b1.h - b0.h) / 0.5;
  if (!(perUnit > 0)) return mm(art);
  const s = Math.min(2, s0 + (wantH - b0.h) / perUnit);
  return mm(s > s0 + 0.005 ? at(s) : art);
}
// 10 pt in mm: the em of the text layout
const EM_MM = 10 * 25.4 / 72;
function stampOpts(o, it) {
  // the stamp's own distance from the text to the cut, else the one under Layout of a stamp
  const own = v => (v === '' || v == null || !isFinite(v) ? null : Math.max(0, +v));
  return { marginX: own(it.mx) ?? o.stMarginX, marginY: own(it.my) ?? o.stMarginY, textGrow: own(it.rim) ?? o.stShoulder, shoulderScale: own(it.rim) == null && o.stShoulderScale, outerGrow: o.stEdge, slopeSteps: o.stSlope, slopeWidth: o.stSlopeWidth, shape: it.shape, radius: it.radius, fit: !(it.kind === 'text' && it.exact), scale: (it.scale || 100) / 100 };
}
// the stamp builder in a background thread (falls back to this thread if workers can't start)
let worker = null, nextJob = 1;
const jobs = new Map();
function buildInWorker(art, W, H, opts) {
  try {
    if (!worker) {
      worker = new Worker(new URL('../lib/stamp.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => { const j = jobs.get(data.id); jobs.delete(data.id); if (j) (data.error ? j.reject(new Error(data.error)) : j.resolve(data.result)); };
      worker.onerror = e => { for (const j of jobs.values()) j.reject(new Error(e.message || 'The stamp builder stopped.')); jobs.clear(); worker.terminate(); worker = null; };
    }
  } catch { return Promise.resolve().then(() => buildStamp(art, W, H, opts)); }
  return new Promise((resolve, reject) => { const id = nextJob++; jobs.set(id, { resolve, reject }); worker.postMessage({ id, art, W, H, opts }); });
}
async function compute(o, stale) {
  for (const it of stamps.items) {
    try {
      const [W, H] = sizeOf(it), opts = stampOpts(o, it);
      // only the stamps whose text, font, size or layout changed are built again
      const key = JSON.stringify([it.kind === 'svg' ? it.id : it.lines, it.font, it.spacing, it.spread, it.exact, W, H, opts]);
      if (key !== it.key || (!it.result && !it.error)) {
        const art = await artOf(it, W, H, opts);
        if (stale()) return false;
        it.result = await buildInWorker(art, W, H, opts);
        if (stale()) return false;
        it.key = key; it.error = '';
        status(it);
      }
    } catch (e) { if (stale()) return false; it.result = null; it.error = e.message || String(e); it.key = null; status(it); }
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
      ${it.kind === 'text' ? `<div class="steditbar" role="toolbar" aria-label="Text formatting">
          <button type="button" data-cmd="bold" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button><button type="button" data-cmd="italic" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button><button type="button" data-cmd="underline" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>
          <span class="sep"></span><button type="button" data-size="0.9" title="Smaller line" aria-label="Smaller line">A−</button><label class="stptl" title="Size of the line(s) with the cursor, in points"><input type="number" class="stpt" min="3" max="72" step="0.5" aria-label="Line size in pt">pt</label><button type="button" data-size="1.1" title="Bigger line" aria-label="Bigger line">A+</button>
          <span class="sep"></span><button type="button" data-align="left" title="Align left" aria-label="Align left">⇤</button><button type="button" data-align="center" title="Centre" aria-label="Centre">≡</button><button type="button" data-align="right" title="Align right" aria-label="Align right">⇥</button>
        </div>
        <div class="steditor" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" aria-label="Text of the stamp"></div>
        <div class="fields"><label>Font<select class="stfont"></select></label>
        <label>Line spacing<input type="number" class="stspacing" min="80" max="250" step="5"> %</label>
        <label class="check"><input type="checkbox" class="stspread"> Spread the lines to fill the height</label></div>
        <div class="fields"><label>Text size<select class="stexact"><option value="fit">Fit to the stamp (the pt sizes set the proportions)</option><option value="exact">As set, in pt</option></select></label></div>` : ''}
      <div class="fields"><label>Size<select class="stsize">${sizeOptions()}</select></label>
        <label class="stcustom">W<input type="number" class="stw" min="5" step="1"> × H<input type="number" class="sth" min="5" step="1"> mm</label>
        <label>Copies<input type="number" class="stq" min="0" step="1"></label></div>
      <div class="fields"><label>Cut<select class="stshape"><option value="hull">Around the text (straight edges)</option><option value="rect">Rectangle of the size</option><option value="round">Rounded rectangle of the size</option></select></label>
        <label class="stradius">Corner radius<input type="number" class="str" min="0" step="0.5"> mm</label></div>
      <div class="fields"><label>Text to cut, sides<input type="number" class="stmx" min="0" step="0.1"> mm</label>
        <label>top and bottom<input type="number" class="stmy" min="0" step="0.1"> mm</label>
        <label title="The text at this share of the size it fits at (or of the size set in pt); at most 100 %: the text never gets bigger than the stamp">Text scale<input type="number" class="stscale" min="10" max="100" step="1"> %</label>
        <label title="How far the deep engraving stays from the letters. Empty: automatic (thinner for smaller letters)">Rim around the letters<input type="number" class="strim" min="0" max="1" step="0.01"> mm</label></div>
      <div class="status stst"></div></div><button type="button" class="remove">×</button>`;
    const q = s => li.querySelector(s), dn = q('.dname');
    dn.textContent = it.name; dn.title = it.name;
    const changed = () => { syncRow(it, li); schedule(); };
    if (it.kind === 'text') {
      const ed = q('.steditor'), f = q('.stfont');
      ed.innerHTML = it.html;
      const showFont = () => cssFamily(it.font).then(ff => { ed.style.fontFamily = ff; }).catch(() => {});
      showFont();
      // the editor's font follows the stamp's font where the browser has it (only a guide: the stamp is drawn exactly)
      const edited = () => { it.html = ed.innerHTML; it.lines = parseEditor(ed); it.name = trimLines(it.lines).map(l => l.runs.map(r => r.text).join('')).find(t => t.trim()) || 'Stamp'; dn.textContent = it.name; schedule(); };
      ed.addEventListener('input', edited);
      // as plain text; Word's line break (Shift+Enter) comes as a vertical tab, which the browser would drop
      ed.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\r\n?|[\v\f\u2028\u2029]/g, '\n')); });
      for (const b of li.querySelectorAll('.steditbar button')) {
        b.addEventListener('mousedown', e => e.preventDefault()); // keep the selection in the editor
        b.addEventListener('click', () => {
          ed.focus();
          if (b.dataset.cmd) document.execCommand(b.dataset.cmd);
          else for (const blk of selectedLines(ed)) {
            if (b.dataset.align) blk.style.textAlign = b.dataset.align;
            if (b.dataset.size) setPt(blk, linePt(blk) * parseFloat(b.dataset.size));
          }
          edited(); showPt();
        });
      }
      // the size field shows the size of the line with the cursor; typing a size sets the selected lines
      const pt = q('.stpt'), showPt = () => { const blk = selectedLines(ed, true)[0]; if (blk && document.activeElement !== pt) pt.value = String(linePt(blk)); };
      document.addEventListener('selectionchange', () => { if (ed.contains(document.getSelection().anchorNode)) showPt(); });
      pt.addEventListener('mousedown', () => { ptLines = selectedLines(ed); });
      pt.addEventListener('focus', () => { if (!ptLines) ptLines = selectedLines(ed); });
      // a size typed in pt means that size: the stamp is then set as typed, not fitted (fitted, the pt sizes only set the
      // lines' proportions and 8 pt came out as big as the stamp allows)
      pt.addEventListener('input', () => {
        const v = parseFloat(pt.value); if (!(v > 0)) return;
        for (const blk of ptLines || selectedLines(ed)) setPt(blk, v);
        if (!it.exact) { it.exact = true; q('.stexact').value = 'exact'; }
        edited();
      });
      pt.addEventListener('blur', () => { ptLines = null; showPt(); });
      let ptLines = null;
      showPt();
      const ex = q('.stexact'); ex.value = it.exact ? 'exact' : 'fit'; ex.addEventListener('change', () => { it.exact = ex.value === 'exact'; schedule(); });
      fillFontSelect(f, it.font);
      f.addEventListener('change', async () => {
        if (f.value === '+') {
          const pick = byId('stFontFile');
          pick.onchange = async () => { const r = await addFonts(pick.files); pick.value = ''; if (r && r.added.length) it.font = r.added[0].key; fillFontSelect(f, it.font); showFont(); changed(); };
          pick.click(); f.value = it.font; return;
        }
        it.font = f.value; showFont(); changed();
      });
      const spr = q('.stspread'); spr.checked = !!it.spread; spr.addEventListener('change', () => { it.spread = spr.checked; schedule(); });
      const sp = q('.stspacing'); sp.value = it.spacing; sp.addEventListener('input', () => { it.spacing = Math.max(50, parseFloat(sp.value) || 115); schedule(); });
    }
    const sz = q('.stsize'); sz.value = it.size; sz.addEventListener('change', () => { it.size = sz.value; changed(); });
    const w = q('.stw'), h = q('.sth'); w.value = it.w; h.value = it.h;
    w.addEventListener('input', () => { it.w = parseFloat(w.value) || 0; schedule(); });
    h.addEventListener('input', () => { it.h = parseFloat(h.value) || 0; schedule(); });
    const cq = q('.stq'); cq.value = it.copies; cq.addEventListener('input', () => { const v = parseInt(cq.value, 10); it.copies = isFinite(v) && v >= 0 ? v : 0; schedule(); });
    const sh = q('.stshape'); sh.value = it.shape; sh.addEventListener('change', () => { it.shape = sh.value; changed(); });
    // empty: the distances under Layout of a stamp (shown greyed as the placeholder)
    for (const [cls, key, opt] of [['.stmx', 'mx', 'stMarginX'], ['.stmy', 'my', 'stMarginY']]) {
      const inp = q(cls); inp.value = it[key] ?? ''; inp.placeholder = String(readOpts()[opt]);
      inp.addEventListener('input', () => { it[key] = inp.value === '' ? null : parseFloat(inp.value); schedule(); });
    }
    // the rim: empty = automatic, its value shown greyed
    const rim = q('.strim'); rim.value = it.rim ?? '';
    rim.addEventListener('input', () => { const v = parseFloat(rim.value); it.rim = rim.value === '' || !(v >= 0) ? null : Math.min(1, v); schedule(); });
    const sc = q('.stscale'); sc.value = it.scale || 100;
    sc.addEventListener('input', () => { const v = parseFloat(sc.value); it.scale = v >= 10 && v <= 100 ? v : 100; schedule(); });
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
}
function status(it) {
  if (!it.li || !it.li.isConnected) return;
  const st = it.li.querySelector('.stst'), [W, H] = sizeOf(it), r = it.result;
  if (it.error) { st.textContent = it.error; st.classList.add('warn'); }
  else if (r) {
    const a = bbox(r.art), c = bbox([r.cut]);
    st.classList.remove('warn');
    st.textContent = `${num(W)} × ${num(H)} mm: text ${num(Math.round(a.w * 10) / 10)} × ${num(Math.round(a.h * 10) / 10)} mm, cut ${num(Math.round(c.w * 10) / 10)} × ${num(Math.round(c.h * 10) / 10)} mm.${it.svg && it.svg.texts ? ` ${it.svg.texts} text ${it.svg.texts === 1 ? 'element was' : 'elements were'} left out: convert text to outlines (paths) in the SVG.` : ''}`;
    // the distances from the text to the cut it used, and a warning when one was too big for the stamp
    const m = r.margins || { x: 0, y: 0 }, r2 = v => num(Math.round(v * 100) / 100);
    st.textContent += ` Text to cut ${r2(m.x)} mm at the sides, ${r2(m.y)} mm top and bottom; rim around the letters ${r2(r.shoulder ?? 0.2)} mm${it.rim == null ? (readOpts().stShoulderScale ? ' (automatic, thinner for small letters)' : ' (the general rim)') : ''}.`;
    if (it.shape === 'round' && r.radii && Math.min(...r.radii) < Math.min(it.radius, W / 2, H / 2) - 0.005) st.textContent += ` Corners rounded less than set (${r.radii.map(r2).join(' / ')} mm) so the cut stays clear of the letters.`;
    if (r.slope && r.slope.length) {
      const o = readOpts(), p = splitPasses(5, r.slope.length + 1);
      st.textContent += ` Sloped sides: ${r.slope.length + 1} steps over ${r2(o.stSlopeWidth)} mm from the rim (passes ${p.join(' + ')}).`;
    }
    const rimEl = it.li.querySelector('.strim'); if (rimEl) rimEl.placeholder = r2(r.shoulder ?? 0.2);
    if (m.cutX || m.cutY) {
      const o = stampOpts(readOpts(), it);
      st.textContent += ` The distance set (${[m.cutX ? `${r2(o.marginX)} mm` : '', m.cutY ? `${r2(o.marginY)} mm` : ''].filter(Boolean).join(' / ')}) is more than a quarter of the stamp, so it was made smaller: check “Text to cut” here and under Layout of a stamp.`;
      st.classList.add('warn');
    }
    if (it.kind === 'text' && it.missing) {
      st.textContent += ` The font has no ${[...it.missing].map(c => `“${c}”`).join(' ')}: ${[...it.missing].length > 1 ? 'they are' : 'it is'} left out of the stamp. Choose another font (or bold / italic).`;
      st.classList.add('warn');
    }
    if (it.kind === 'text') {
      // the letters' real size: as set, or as the fitting made them (pt of the em, like in a word processor)
      const pts = trimLines(it.lines).map(l => l.size * 10 * (it.exact ? r.scale : r.scale / EM_MM)), r1 = v => num(Math.round(v * 10) / 10);
      const lo = Math.min(...pts), hi = Math.max(...pts);
      st.textContent += ` Letters ${lo === hi ? r1(lo) : `${r1(lo)}–${r1(hi)}`} pt.`;
      if (r.shrunk && it.exact) { st.textContent += ' The sizes set don’t fit the stamp: the text was made smaller to stay inside it (the cut is never bigger than the stamp).'; st.classList.add('warn'); }
    }
  }
  const th = it.li.querySelector('.thumb');
  th.innerHTML = r ? stampSvg(r, 'thumb') : '';
}
function newItem(kind, extra) {
  const o = readOpts();
  return { id: nextId++, kind, copies: 1, size: o.stSize, w: 48, h: 19, shape: 'hull', radius: 2, font: DEFAULT_FAMILY, spacing: 115, spread: true, name: 'Stamp', ...extra };
}
function addText() {
  // an example in bold (like the stamps made so far), each line centred
  const html = ['Firma Przykład', 'ul. Długa 1, 00-001 Warszawa', 'NIP 123-456-78-90', 'tel. 600 000 000'].map(t => `<div style="text-align: center;" data-pt="10"><b>${t}</b></div>`).join('');
  const box = document.createElement('div'); box.innerHTML = html;
  stamps.items.push(newItem('text', { html, lines: parseEditor(box), name: 'Firma Przykład' }));
  list(); schedule();
}

/* ---------- the text editor ---------- */
// The editor's lines (one block each; Shift+Enter breaks a line inside a block too) as the layout takes them:
// [{ align, size, runs: [{ text, bold, italic, underline }] }]
export function parseEditor(ed) {
  const lines = [];
  let cur = null;
  const newLine = (from, el) => {
    const st = el && el.style;
    cur = { align: (st && st.textAlign) || (from ? from.align : 'center'), size: el && el.dataset ? linePt(el) / 10 : (from ? from.size : 1), runs: [] };
    lines.push(cur);
  };
  const flags = (el, f) => {
    const t = el.tagName, st = el.style || {}, g = { ...f };
    if (t === 'B' || t === 'STRONG') g.bold = true;
    if (t === 'I' || t === 'EM') g.italic = true;
    if (t === 'U') g.underline = true;
    if (st.fontWeight) g.bold = st.fontWeight === 'bold' || st.fontWeight === 'bolder' || parseInt(st.fontWeight, 10) >= 600;
    if (st.fontStyle) g.italic = /italic|oblique/.test(st.fontStyle);
    if (st.textDecoration || st.textDecorationLine) g.underline = /underline/.test(st.textDecoration || st.textDecorationLine);
    return g;
  };
  const push = (text, f) => {
    if (!text) return;
    if (!cur) newLine(null, null);
    const last = cur.runs[cur.runs.length - 1], g = { bold: !!f.bold, italic: !!f.italic, underline: !!f.underline };
    if (last && last.bold === g.bold && last.italic === g.italic && last.underline === g.underline) last.text += text;
    else cur.runs.push({ text, ...g });
  };
  // anything after this node inside its block (a trailing <br> ends the block, it isn't an empty line)
  const more = n => { for (let x = n.nextSibling; x; x = x.nextSibling) if (x.nodeType === 1 || (x.nodeType === 3 && x.nodeValue)) return true; return n.parentNode !== ed && !/^(DIV|P|LI)$/.test(n.parentNode.tagName) && more(n.parentNode); };
  const walk = (node, f) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) push(n.nodeValue.replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' '), f);
      else if (n.nodeType === 1) {
        if (n.tagName === 'BR') { if (more(n)) newLine(cur, null); continue; }
        if (/^(DIV|P|LI|H[1-6])$/.test(n.tagName)) { newLine(cur, n); walk(n, flags(n, f)); cur = null; continue; }
        walk(n, flags(n, f));
      }
    }
  };
  walk(ed, {});
  return lines;
}
// a line's size in pt (10 unless set; older stamps stored a factor)
function linePt(blk) {
  const d = blk && blk.dataset ? blk.dataset : {};
  return parseFloat(d.pt) || (parseFloat(d.size) || 1) * 10;
}
function setPt(blk, v) {
  v = Math.round(Math.min(72, Math.max(3, v)) * 2) / 2;
  blk.dataset.pt = String(v); delete blk.dataset.size;
  blk.style.fontSize = `${Math.round(v * 10)}%`;
}
// without the empty lines at the top and the bottom
function trimLines(lines) {
  const empty = l => !l.runs.some(r => r.text.trim());
  let a = 0, b = lines.length;
  while (a < b && empty(lines[a])) a++;
  while (b > a && empty(lines[b - 1])) b--;
  return lines.slice(a, b);
}
// the line blocks the selection touches (top-level text is wrapped into a block first)
// look: only look (the size field following the cursor), don't wrap anything
function selectedLines(ed, look) {
  if (look) {
    const sel = window.getSelection(), r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!r || !ed.contains(r.startContainer)) return [];
    let n = r.startContainer;
    while (n && n.parentNode !== ed) n = n.parentNode;
    return n && n.nodeType === 1 ? [n] : [];
  }
  for (const n of Array.from(ed.childNodes)) {
    if (n.nodeType === 1 && /^(DIV|P)$/.test(n.tagName)) continue;
    const d = document.createElement('div'); d.style.textAlign = 'center'; d.dataset.pt = '10';
    ed.insertBefore(d, n); d.appendChild(n);
  }
  const sel = window.getSelection(), r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const blocks = Array.from(ed.children).filter(d => r && r.intersectsNode(d));
  return blocks.length ? blocks : Array.from(ed.children).slice(-1);
}

/* ---------- fonts ---------- */
function fillFontSelect(sel, value) {
  const fams = families();
  sel.innerHTML = Object.entries(fams).map(([k, f]) => `<option value="${k}">${f.name.replace(/[<&]/g, '')}${f.own ? ' (yours)' : ''}</option>`).join('') + '<option value="+">Add font files…</option>';
  sel.value = fams[value] ? value : DEFAULT_FAMILY;
}
async function addFonts(files) {
  if (!files || !files.length) return null;
  setMsg('Reading the fonts…');
  const r = await addFontFiles(files);
  setMsg([r.added.length ? `Added: ${[...new Set(r.added.map(a => a.family))].join(', ')}${r.saved ? '' : ' (for this session: the server isn’t reachable)'}.` : '', r.failed.join(' ')].filter(Boolean).join(' '), r.failed.length > 0);
  return r;
}
function fontList() {
  for (const it of stamps.items) it.key = null; // a family's files changed: set the text again
  const ul = byId('stFonts'), own = ownFamilies();
  ul.innerHTML = own.length ? '' : '<li class="empty">None yet: add .ttf / .otf / .woff files (each style of a family is its own file).</li>';
  for (const f of own) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="fname"></span><button type="button" class="link">Remove</button>';
    li.querySelector('.fname').textContent = `${f.name}: ${f.styles.join(', ')}${f.saved ? '' : ' (this session only)'}`;
    li.querySelector('button').addEventListener('click', async () => { await removeFamily(f.key); schedule(); });
    ul.appendChild(li);
  }
  for (const it of stamps.items) if (it.li && it.kind === 'text') fillFontSelect(it.li.querySelector('.stfont'), it.font);
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
  // the red (deep) layer drawn over the blue one, as xTool Studio shows them; the slope's steps darker as they go deeper
  const g = `<g transform="matrix(-1 0 0 1 ${num(e.x0 + e.x1)} 0)"><path d="${ringsD(r.blue)}" fill="${LAYER_FILL.blue}" fill-rule="evenodd"/><path d="${ringsD(r.red)}" fill="${LAYER_FILL.red}" fill-rule="evenodd"/>${(r.slope || []).map((rings, i) => `<path d="${ringsD(rings)}" fill="${SLOPE_FILL[i] || SLOPE_FILL[SLOPE_FILL.length - 1]}" fill-rule="evenodd"/>`).join('')}<path d="${ringsD([r.cut])}" fill="none" stroke="#000" stroke-width="0.15"/></g>`;
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
  byId('exStampsProof').disabled = !stamps.items.some(it => it.result) || !!busyText;
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
    return { x: pl.x, y: pl.y, parts: { blue: r.blue, red: r.red, slope: r.slope || [], black: [r.cut] } };
  });
  let cover = null;
  try { cover = await coverPng(); } catch { /* the project is fine without a cover */ }
  const files = await buildXsFiles(list_, { cover, name: 'Pieczątki' });
  return makeZipDeflated(files);
}
/* ---------- the proof for the client: every stamp at its real size ---------- */
// One A4 page after another, every stamp once (as it prints: not mirrored, the letters in black), its size and the
// number of copies, the outline of the rubber dashed, and a 50 mm line to check that it was printed at 100 %.
export async function buildStampsProof() {
  await ensureLibs();
  const { PDFDocument, rgb } = window.PDFLib, fontkit = (await import('@pdf-lib/fontkit')).default;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = async n => new Uint8Array(await (await fetch(new URL(`pdfjs/standard_fonts/${n}`, document.baseURI))).arrayBuffer());
  const font = await pdf.embedFont(await fontBytes('LiberationSans-Regular.ttf'), { subset: true });
  const bold = await pdf.embedFont(await fontBytes('LiberationSans-Bold.ttf'), { subset: true });
  const PW = 210 * PT, PH = 297 * PT, M = 15, black = rgb(0, 0, 0), grey = rgb(0.45, 0.45, 0.45), light = rgb(0.6, 0.6, 0.6);
  const items = stamps.items.filter(it => it.result);
  let page = null, x = M, y = 0, rowH = 0;
  const newPage = () => {
    page = pdf.addPage([PW, PH]);
    page.drawText('Projekt pieczątki – podgląd w rzeczywistym rozmiarze (1:1)', { x: M * PT, y: PH - (M + 5) * PT, size: 13, font: bold, color: black });
    page.drawText('Wydrukuj w skali 100 % (bez dopasowania do strony). Ta linia ma 50 mm:', { x: M * PT, y: PH - (M + 11) * PT, size: 8.5, font, color: grey });
    const ly = PH - (M + 15) * PT;
    page.drawLine({ start: { x: M * PT, y: ly }, end: { x: (M + 50) * PT, y: ly }, thickness: 0.8, color: black });
    for (let t = 0; t <= 50; t += 10) page.drawLine({ start: { x: (M + t) * PT, y: ly - 1.5 * PT }, end: { x: (M + t) * PT, y: ly + 1.5 * PT }, thickness: 0.6, color: black });
    x = M; y = M + 26; rowH = 0;
  };
  newPage();
  const path = rings => rings.map(r => `M${r.map(p => `${(p[0] * PT).toFixed(3)} ${(p[1] * PT).toFixed(3)}`).join(' L')} Z`).join(' ');
  for (const it of items) {
    const r = it.result, c = bbox([r.cut]), [W, H] = sizeOf(it), w = Math.max(c.w, 60), h = c.h + 14;
    if (x + w > 210 - M) { x = M; y += rowH + 8; rowH = 0; }
    if (y + h > 297 - M) newPage();
    const name = it.size === 'custom' ? `${num(W)} × ${num(H)} mm` : `${STAMP_SIZES[it.size][0]}, ${num(W)} × ${num(H)} mm`;
    page.drawText(name, { x: x * PT, y: PH - (y + 3.5) * PT, size: 9, font: bold, color: black });
    page.drawText(`${it.copies} szt. · płytka ${num(Math.round(c.w * 10) / 10)} × ${num(Math.round(c.h * 10) / 10)} mm`, { x: x * PT, y: PH - (y + 7.5) * PT, size: 7.5, font, color: grey });
    // the stamp: its own mm, placed with its cut's corner at (x, y + 10)
    const ox = (x - c.x0) * PT, oy = PH - (y + 10 - c.y0) * PT;
    page.drawSvgPath(path([r.cut]), { x: ox, y: oy, borderColor: light, borderWidth: 0.4, borderDashArray: [2, 2] });
    page.drawSvgPath(path(r.art), { x: ox, y: oy, color: black });
    x += w + 8; rowH = Math.max(rowH, h);
  }
  pdf.setTitle('Projekt pieczątki – podgląd 1:1');
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
byId('exStampsProof').addEventListener('click', async () => {
  const btn = byId('exStampsProof'); btn.disabled = true;
  try { await saveFile(`pieczatki-podglad-1do1.pdf`, await buildStampsProof()); }
  catch (e) { setMsg(`Couldn’t make the PDF: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
byId('exStampsXs').addEventListener('click', async () => {
  const btn = byId('exStampsXs'); btn.disabled = true;
  try { await saveFile(`pieczatki-${stamps.placed.length}szt.xs`, await buildStampsXs()); }
  catch (e) { setMsg(`Couldn’t make the xTool file: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
byId('stAddText').addEventListener('click', addText);
byId('stFontAdd').addEventListener('change', async e => { await addFonts(e.target.files); e.target.value = ''; });
onFontsChanged(fontList);
// the stamps without their own distance to the cut show the general one
for (const [id, cls] of [['stMarginX', '.stmx'], ['stMarginY', '.stmy']]) byId(id).addEventListener('input', () => { for (const el of document.querySelectorAll(`#stList ${cls}`)) el.placeholder = byId(id).value; });
// the values of the stamp made in xTool Studio
const ST_DEFAULTS = { stMarginX: 2.3, stMarginY: 0, stShoulder: 0.3, stEdge: 0.8 };
// once: the values kept from before the standard changed (0.8 mm top and bottom, 0.2 mm rim that thins for small
// letters) move to the new standard (0 mm, a 0.3 mm rim for all); values you set yourself stay
try {
  if (!localStorage.getItem('pc.stampDefaults.v2')) {
    setTimeout(() => {
      const set = (id, from, to) => { const e = byId(id); if (e.type === 'checkbox' ? e.checked === from : parseFloat(e.value) === from) { if (e.type === 'checkbox') e.checked = to; else e.value = String(to); e.dispatchEvent(new Event(e.type === 'checkbox' ? 'change' : 'input')); } };
      set('stMarginY', 0.8, 0); set('stShoulder', 0.2, 0.3); set('stShoulderScale', true, false);
      try { localStorage.setItem('pc.stampDefaults.v2', '1'); } catch { /* storage unavailable */ }
    }, 0);
  }
} catch { /* storage unavailable */ }
const setDefaults = ids => { for (const id of ids) { const e = byId(id); e.value = String(ST_DEFAULTS[id]); e.dispatchEvent(new Event('input')); } };
byId('stLayoutReset').addEventListener('click', () => setDefaults(Object.keys(ST_DEFAULTS)));
// a distance to the cut over 15 mm kept from an earlier visit is a mistake (no stamp is set like that): back to
// the original values
setTimeout(() => setDefaults(['stMarginX', 'stMarginY'].filter(id => parseFloat(byId(id).value) > 15)), 0);
loadLibrary();
byId('stSvgFile').addEventListener('change', e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) addSvgs(files); });

list();
registerMode('stamps', { compute, renderPreview, renderStats, onDrop: addSvgs });
