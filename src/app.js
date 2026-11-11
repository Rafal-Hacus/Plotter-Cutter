// The application: state, UI wiring and every mode. Pure helpers live in ./core.
import './styles.css';
import { contourFill, hatchLines } from './core/fill.js';
import { CELL, edt, fillHolesField, fillHolesBin, march, loopArea, rdp, simplifyLoop, rotBits, makeMask, transposeMask, transposeGrid, runStrategy, joinNear } from './core/geometry.js';
import { imageDpi, jpegOrientation, readAsDataUrl, detectCircle, circleSvg } from './core/image.js';
import { makeMarksTemplate, lemurMarks } from './core/marks.js';
import { PT, mul, apply, roundRect } from './core/matrix.js';
import { perforate } from './core/perf.js';
import { dragKnife, modifyPlt, pltValues, writePlt } from './core/plt.js';
import { sanitize } from './core/sanitize.js';
import { XLINK, ser, MM_PER, num, esc, parseLen, parseSvg, readViewBox, aiId, pathEl, SLOT_RE, dataUri, loadImg, windowSvg, sizedSvg, splitRoot, prefixDoc, flattenPath, expandUses, decodeLayer, elementPolys, toHex, pathLen } from './core/svg.js';
import { tick, asciiOnly } from './core/util.js';
import { ensureLibs, pdfSource } from './lib/pdf.js';
import { initPresets } from './presets.js';
import { buildNameCardsPdf, parseNames } from './lib/namecards.js';
import { makeZip, readZipPlts } from './core/zip.js';

function sheetSizeMm() {
  const o = readOpts();
  if (o.sheetSize === 'custom') return [o.sheetW, o.sheetH];
  const m = /^(\d+)x(\d+)$/.exec(o.sheetSize);
  return m ? [+m[1], +m[2]] : [310, 440];
}
function applySheetSize() {
  const [W, H] = sheetSizeMm(), o = readOpts(), T = o.sheetFeed ? Math.max(0, Math.min(o.sheetFeedMm, H - 80)) : 0;
  document.getElementById('rowSheetCustom').hidden = o.sheetSize !== 'custom';
  document.getElementById('rowSheetFeed').hidden = !o.sheetFeed;
  setTemplate(makeMarksTemplate(W, H, T), T ? `Generated SignCut marks, ${num(T)} mm blank strip at the top` : 'Generated SignCut marks', true);
  template.generated = true;
  template.feedTop = T;
}

/* ---------- state ---------- */
const $ = s => document.querySelector(s);
// every preview shows where the knife or guillotine will cut in the same red (exports keep the colours set under Cut lines)
const CUT_RED = '#E0262B';
const ui = {
  files: $('#files'), list: $('#list'), stage: $('#stage'), count: $('#count'), msg: $('#msg'),
  dropNote: $('#dropNote'), sheetInfo: $('#sheetInfo'), dpiRow: $('#dpiRow'), tplFile: $('#tplFile'), tplReset: $('#tplReset'),
  exAll: $('#exAll'), exPrint: $('#exPrint'), exCut: $('#exCut'), exPlt: $('#exPlt'), showArt: $('#showArt'), lgKiss: $('#lgKiss'), lgDie: $('#lgDie')
};
const OPT_IDS = ['kiss', 'die', 'gap', 'kissColor', 'dieColor', 'kissLayer', 'dieLayer', 'lineW', 'overcut', 'bladeOffset', 'pltForce', 'kissForce', 'dieForce', 'cutSpeed', 'upSpeed', 'cBleed', 'cGap', 'cCutStyle', 'mSize', 'cRadius', 'cFlip', 'cOffX', 'cOffY', 'cFoldOn', 'cFoldPos', 'gSpace', 'gAutoGap', 'deckSets', 'deckOrder', 'icW', 'icH', 'icFit', 'icDpi', 'icExtend', 'cPerfDie', 'cTieCut', 'cTie', 'cTiePlace', 'cTieInset', 'winSrc', 'winW', 'winH', 'winFont', 'winSize', 'winColor', 'winBoth', 'winCopies', 'cFoldDir', 'sheetSize', 'sheetW', 'sheetH', 'sheetFeed', 'sheetFeedMm', 'gPage', 'gPageW', 'gPageH', 'dxSize', 'dxW', 'dxH', 'gPages', 'gMarksBack', 'gEachSets', 'gMarkLen', 'gMarkOff', 'gEdge', 'gSize', 'gScale', 'cPerfCut', 'cPerfGap', 'vWidth', 'vLength', 'vMargin', 'vGap', 'vWeed', 'vWeedMargin', 'vMirror', 'penForce', 'penFill', 'penStyle', 'penSpacing', 'penAngle', 'batchMix', 'ggFormat', 'ggW', 'ggH', 'ggBleed', 'ggFit', 'ggAuto', 'ggGap', 'ggMarkLen', 'ggMarkOff', 'ggEdge', 'spDpi', 'sqW', 'sqH', 'sqSheetW', 'sqSheetH', 'sqMargin', 'sqGap', 'borderFill', 'borderColor', 'clearance', 'joinGap', 'rotate', 'center', 'ignoreWhite', 'quality', 'dpi'];
const designs = [];
let template = null, layout = null, gen = 0, nextId = 1, sheetCache = null, timer = null;

function readOpts() {
  const v = id => document.getElementById(id);
  const n = (id, def, min) => { const x = parseFloat(v(id).value); return isFinite(x) ? Math.max(min, x) : def; };
  return {
    kiss: n('kiss', 2, 0), die: n('die', 2, 0), gap: n('gap', 2, 0), lineW: n('lineW', 0.1, 0.01), overcut: n('overcut', 0.5, 0), bladeOffset: n('bladeOffset', 0.35, 0),
    pltForce: document.getElementById('pltForce').checked, kissForce: n('kissForce', 60, 1), dieForce: n('dieForce', 60, 1), cutSpeed: n('cutSpeed', 13, 1), upSpeed: n('upSpeed', 13, 1),
    cBleed: n('cBleed', 2, 0), cGap: n('cGap', 4, 0), cCutStyle: v('cCutStyle').value, mSize: v('mSize').value, cRadius: n('cRadius', 0, 0), cFlip: v('cFlip').value,
    winSrc: v('winSrc').value, winW: n('winW', 100, 20), winH: n('winH', 100, 20), winFont: v('winFont').value, winSize: Math.min(200, n('winSize', 28, 6)), winColor: v('winColor').value, winBoth: v('winBoth').checked, cPerfDie: v('cPerfDie').checked, cTiePlace: v('cTiePlace').value === 'corners' ? 'corners' : 'edges', cTieInset: n('cTieInset', 2, 0), cTieCut: n('cTieCut', 6, 0.5), cTie: n('cTie', 0.8, 0.1), cOffX: parseFloat(v('cOffX').value) || 0, cOffY: parseFloat(v('cOffY').value) || 0,
    cFold: v('cFoldOn').checked ? 'perf' : 'none', cFoldDir: v('cFoldDir').value, gGap: n('gSpace', 4, 0), gAuto: v('gAutoGap').checked, deckSets: Math.max(1, Math.round(n('deckSets', 10, 1))), deckOrder: v('deckOrder').value, winCopies: Math.max(1, Math.round(n('winCopies', 1, 1))), sheetSize: v('sheetSize').value, sheetW: n('sheetW', 310, 60), sheetH: n('sheetH', 440, 60), sheetFeed: v('sheetFeed').checked, sheetFeedMm: n('sheetFeedMm', 60, 0), gPages: v('gPages').value, gMarksBack: v('gMarksBack').checked, gEachSets: Math.max(1, Math.round(n('gEachSets', 1, 1))), gMarkLen: n('gMarkLen', 5, 1), gMarkOff: n('gMarkOff', 3, 0), gMargin: n('gEdge', 0, 0), gSize: v('gSize').value, gScale: n('gScale', 100, 5), cFoldPos: n('cFoldPos', 0, 0), cPerfCut: n('cPerfCut', 1, 0.2), cPerfGap: n('cPerfGap', 1, 0.2),
    vWidth: n('vWidth', 300, 20), vLength: n('vLength', 1000, 20), vMargin: n('vMargin', 5, 0), vGap: n('vGap', 3, 0),
    vWeed: v('vWeed').value, vWeedMargin: n('vWeedMargin', 3, 0), vMirror: v('vMirror').checked, penForce: n('penForce', 40, 1), penFill: v('penFill').checked, penStyle: v('penStyle').value, penSpacing: n('penSpacing', 0.4, 0.1), penAngle: parseFloat(v('penAngle').value) || 0, batchMix: v('batchMix').checked, ggFormat: v('ggFormat').value, ggW: n('ggW', 100, 5), ggH: n('ggH', 150, 5), ggBleed: n('ggBleed', 2, 0), ggFit: v('ggFit').value, ggAuto: v('ggAuto').checked, ggGap: n('ggGap', 4, 0), ggMarkLen: n('ggMarkLen', 5, 1), ggMarkOff: n('ggMarkOff', 3, 0), ggEdge: n('ggEdge', 0, 0), spDpi: parseFloat(v('spDpi').value) || 72, sqW: n('sqW', 50, 5), sqH: n('sqH', 50, 5), sqSheetW: n('sqSheetW', 320, 20), sqSheetH: n('sqSheetH', 450, 20), sqMargin: n('sqMargin', 10, 0), sqGap: n('sqGap', 0, 0),
    kissColor: v('kissColor').value, dieColor: v('dieColor').value,
    kissLayer: v('kissLayer').value.trim() || 'Kiss cut', dieLayer: v('dieLayer').value.trim() || 'Die cut',
    borderFill: v('borderFill').checked, borderColor: v('borderColor').value,
    clearance: n('clearance', 5, 0), joinGap: n('joinGap', 3, 0),
    rotate: v('rotate').checked, center: v('center').checked, ignoreWhite: v('ignoreWhite').checked,
    quality: v('quality').value, dpi: n('dpi', 300, 1)
  };
}
// every option field as { id: value } (checkboxes as booleans, the rest as the field's text)
function optionValues() {
  const o = {};
  for (const id of OPT_IDS) { const e = document.getElementById(id); o[id] = e.type === 'checkbox' ? e.checked : e.value; }
  return o;
}
function saveOpts() {
  try { localStorage.setItem('stickerSheet.opts.v2', JSON.stringify(optionValues())); } catch (e) { /* storage unavailable */ }
}
function loadOpts() {
  try {
    const o = JSON.parse(localStorage.getItem('stickerSheet.opts.v2') || 'null');
    if (!o) return;
    for (const id of OPT_IDS) {
      if (!(id in o)) continue;
      const e = document.getElementById(id);
      if (e.type === 'checkbox') e.checked = !!o[id]; else e.value = o[id];
    }
  } catch (e) { /* ignore */ }
}

/* ---------- template ---------- */
// Centre lines of the four corner marks, in template user units (needs the live DOM for getBBox).
function measureMarks(text) {
  let host = null;
  try {
    const doc = parseSvg(text); sanitize(doc);
    host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none';
    const svg = document.importNode(doc.documentElement, true);
    svg.setAttribute('width', '1000'); svg.setAttribute('height', '1000');
    host.appendChild(svg); document.body.appendChild(host);
    const grp = Array.from(svg.querySelectorAll('g[id]')).find(g => /^scpro2(_x5F_|_)regmarks$/i.test(g.id));
    const scope = grp || svg;
    const inv = svg.getScreenCTM().inverse();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, t = Infinity;
    for (const el of scope.querySelectorAll('rect,path,polygon,polyline,line,circle,ellipse')) {
      if (!grp) { const g = el.closest('g[id]'); if (g && /printonly/i.test(g.id)) continue; }
      const b = el.getBBox();
      if (!b.width && !b.height) continue;
      const m = inv.multiply(el.getScreenCTM());
      const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
      const ex0 = Math.min(...pts.map(q => q[0])), ex1 = Math.max(...pts.map(q => q[0])), ey0 = Math.min(...pts.map(q => q[1])), ey1 = Math.max(...pts.map(q => q[1]));
      t = Math.min(t, ex1 - ex0, ey1 - ey0);
      x0 = Math.min(x0, ex0); x1 = Math.max(x1, ex1); y0 = Math.min(y0, ey0); y1 = Math.max(y1, ey1);
    }
    if (!isFinite(x0) || !isFinite(t)) return null;
    return { left: x0 + t / 2, right: x1 - t / 2, top: y0 + t / 2, bottom: y1 - t / 2, named: !!grp };
  } catch (e) {
    return null;
  } finally {
    if (host) host.remove();
  }
}
function prepareTemplate(text, name, dpi) {
  const doc = parseSvg(text); sanitize(doc);
  const root = doc.documentElement;
  const vb = readViewBox(root);
  if (!vb) throw new Error('The template needs a viewBox.');
  const wl = parseLen(root.getAttribute('width'));
  let u, unitless = true;
  if (wl && MM_PER[wl.unit]) { u = vb.w / (wl.n * MM_PER[wl.unit]); unitless = false; }
  else u = dpi / 25.4;
  if (!root.hasAttribute('xmlns:xlink')) root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', XLINK);
  // Give the export a real page size in mm; with width="100%" Affinity reads px at 72 dpi (310 mm becomes 1291.9 mm).
  if (unitless) { root.setAttribute('width', num(vb.w / u) + 'mm'); root.setAttribute('height', num(vb.h / u) + 'mm'); }
  // SignCut prints but never cuts the scpro2_printonly layer: the artwork goes in there.
  const po = Array.from(root.querySelectorAll('g[id]')).find(g => /^scpro2(_x5F_|_)printonly$/i.test(g.id));
  if (po) po.appendChild(doc.createElementNS(root.namespaceURI, 'g')).setAttribute('id', '__PRINT_SLOT__');
  const { open, inner } = splitRoot(root);
  return { name, text, vb, u, unitless, open, inner, wMm: vb.w / u, hMm: vb.h / u, ink: null, marks: measureMarks(text) };
}
async function templateSheet(o) {
  const t = template;
  const Gw = Math.ceil(t.wMm / CELL), Gh = Math.ceil(t.hMm / CELL);
  const key = [t.name, t.u, o.clearance].join('|');
  if (sheetCache && sheetCache.key === key) return sheetCache;
  if (!t.ink || t.ink.Gw !== Gw || t.ink.Gh !== Gh) {
    const img = await loadImg(sizedSvg(t.text, t.wMm / CELL, t.hMm / CELL));
    const cv = document.createElement('canvas'); cv.width = Gw; cv.height = Gh;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, t.wMm / CELL, t.hMm / CELL);
    const data = cx.getImageData(0, 0, Gw, Gh).data, ink = new Uint8Array(Gw * Gh);
    for (let i = 0; i < Gw * Gh; i++) ink[i] = data[i * 4 + 3] > 0 ? 1 : 0;
    t.ink = { Gw, Gh, bits: ink };
  }
  const ink = t.ink.bits;
  let x0 = Gw, y0 = Gh, x1 = -1, y1 = -1, any = false;
  for (let y = 0; y < Gh; y++) for (let x = 0; x < Gw; x++) if (ink[y * Gw + x]) { any = true; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!any) { x0 = 0; y0 = 0; x1 = Gw - 1; y1 = Gh - 1; }
  const c = o.clearance / CELL;
  const D = any ? edt(ink, Gw, Gh) : null;
  const blocked = new Uint8Array(Gw * Gh);
  let fx0 = Gw, fy0 = Gh, fx1 = -1, fy1 = -1;
  for (let y = 0; y < Gh; y++) for (let x = 0; x < Gw; x++) {
    const i = y * Gw + x;
    const b = (x < x0 + c || x > x1 - c || y < y0 + c || y > y1 - c || (D && D[i] <= c + 0.5)) ? 1 : 0;
    blocked[i] = b;
    if (!b) { if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y; }
  }
  sheetCache = { key, Gw, Gh, blocked, free: fx1 >= 0 ? { x0: fx0, y0: fy0, x1: fx1, y1: fy1 } : null };
  return sheetCache;
}
function setTemplate(text, name, isDefault) {
  const o = readOpts();
  template = prepareTemplate(text, name, o.dpi);
  sheetCache = null;
  view = null;
  ui.tplReset.hidden = !!isDefault;
  ui.dpiRow.hidden = !template.unitless;
  ui.sheetInfo.textContent = `${name}${isDefault ? '' : ' template'}: ${num(Math.round(template.wMm * 10) / 10)} × ${num(Math.round(template.hMm * 10) / 10)} mm.`;
}

/* ---------- designs ---------- */
const SHAPES = 'path,rect,circle,ellipse,polygon,polyline,line';
// Vector shapes that look like cut lines: stroked, with no visible fill. Indices into the SHAPES list.
function detectCutShapes(doc) {
  const hasImage = !!doc.querySelector('image');
  let host = null;
  try {
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll('image').forEach(n => n.remove());
    host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden;pointer-events:none';
    const svg = document.importNode(clone, true);
    host.appendChild(svg); document.body.appendChild(host);
    const idx = [];
    Array.from(svg.querySelectorAll(SHAPES)).forEach((el, i) => {
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) return;
      const cs = getComputedStyle(el);
      const fillOn = cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0;
      const strokeOn = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeOpacity || '1') > 0;
      if (strokeOn && !fillOn) idx.push(i);
    });
    let box = null;
    try {
      const all = Array.from(svg.querySelectorAll(SHAPES)), inv = svg.getScreenCTM().inverse();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of idx) {
        const el = all[i], b = el.getBBox(), m = inv.multiply(el.getScreenCTM());
        for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
          const X = m.a * x + m.c * y + m.e, Y = m.b * x + m.d * y + m.f;
          x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
        }
      }
      if (isFinite(x0) && x1 > x0 && y1 > y0) box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } catch (e) { box = null; }
    return { idx, hasImage, box };
  } catch (e) {
    return { idx: [], hasImage };
  } finally {
    if (host) host.remove();
  }
}
function prepareDesign(text, name) {
  const doc = parseSvg(text);
  const linked = Array.from(doc.documentElement.querySelectorAll('image')).some(im => { const h = (im.getAttribute('href') || im.getAttributeNS(XLINK, 'href') || '').trim(); return h && !h.startsWith('data:'); });
  sanitize(doc);
  const root = doc.documentElement;
  const vb = readViewBox(root);
  if (!vb) throw new Error('No viewBox or size in this file. Re-export it with a viewBox.');
  const hl = parseLen(root.getAttribute('height'));
  let natH = (hl && MM_PER[hl.unit]) ? hl.n * MM_PER[hl.unit] : null;
  if (!natH || natH < 5 || natH > 400) natH = 50;
  const warns = [];
  if (linked) warns.push('Linked images in this file won’t show (for safety only embedded images are used). Embed them before exporting.');
  if (root.querySelector('text')) {
    warns.push('Contains live text: the outline is traced with the browser’s fonts, so if they differ from yours the cut lines end up shifted. Convert text to curves before exporting.');
  }
  const cut = detectCutShapes(doc);
  // normalised copy for drawing
  root.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  root.removeAttribute('width'); root.removeAttribute('height');
  root.setAttribute('preserveAspectRatio', 'none');
  const norm = ser.serializeToString(doc);
  const without = (dd, idx) => { const sh = Array.from(dd.documentElement.querySelectorAll(SHAPES)); idx.forEach(i => sh[i] && sh[i].remove()); return dd; };
  let normNoCut = norm, cutMask = null;
  if (cut.idx.length) {
    normNoCut = ser.serializeToString(without(doc.cloneNode(true), cut.idx));
    // mask: only the cut shapes, filled solid black
    const mdoc = doc.cloneNode(true), mroot = mdoc.documentElement;
    mroot.querySelectorAll('image').forEach(n => n.remove());
    const sh = Array.from(mroot.querySelectorAll(SHAPES));
    cut.idx.forEach(i => sh[i] && sh[i].setAttribute('style', 'visibility:visible;fill:#000;fill-opacity:1;fill-rule:nonzero;stroke:none;opacity:1'));
    const st = mdoc.createElementNS(mroot.namespaceURI, 'style');
    st.textContent = '*{visibility:hidden}';
    mroot.insertBefore(st, mroot.firstChild);
    cutMask = ser.serializeToString(mdoc);
  }
  // markup for export
  const id = nextId++;
  const odoc = doc.cloneNode(true), oroot = odoc.documentElement;
  prefixDoc(oroot, `s${id}-`);
  // Embedded bitmaps go into the file once per design (__D__ ids) instead of once per sticker.
  const shared = [], bases = [];
  let k = 0;
  for (const im of Array.from(oroot.querySelectorAll('image'))) {
    const href = im.getAttribute('href') || im.getAttributeNS(XLINK, 'href') || '';
    if (!href.startsWith('data:')) continue;
    const oldId = im.getAttribute('id'), base = oldId ? oldId.replace(/^__P__/, '') : `img${k++}`;
    const cl = im.cloneNode(true); cl.setAttribute('id', '__D__' + base);
    shared.push(ser.serializeToString(cl)); bases.push(base);
    if (im.closest('defs')) im.remove();
    else { const u = odoc.createElementNS(oroot.namespaceURI, 'use'); u.setAttributeNS(XLINK, 'xlink:href', '#__D__' + base); im.replaceWith(u); }
  }
  const fixRefs = m => bases.reduce((acc, b) => acc.split('#__P__' + b).join('#__D__' + b), m);
  const skip = new Set(['width', 'height', 'viewBox', 'x', 'y', 'version', 'baseProfile', 'preserveAspectRatio', 'id', 'enable-background', 'overflow']);
  let wrap = '';
  for (const a of Array.from(oroot.attributes)) {
    if (a.name.startsWith('xmlns') || a.name.includes(':') || skip.has(a.name)) continue;
    wrap += ` ${a.name}="${esc(a.value)}"`;
  }
  const parts = splitRoot(oroot);
  for (const m of parts.open.match(/\sxmlns:[\w.-]+="[^"]*"/g) || []) wrap += m;
  const markup = fixRefs(parts.inner);
  const markupNoCut = cut.idx.length ? fixRefs(splitRoot(without(odoc, cut.idx).documentElement).inner) : markup;
  return {
    id, name, vb, norm, markup, markupNoCut, cutMask, wrap, warns, heightMm: natH, qty: null,
    sharedDefs: shared.join(''), canCut: cut.idx.length > 0, cutBox: cut.box,
    mode: cut.idx.length && cut.hasImage ? 'cut' : 'trace',
    url: dataUri(norm), urlNoCut: cut.idx.length ? dataUri(normNoCut) : dataUri(norm),
    key: null, res: null, error: null, busy: false, ui: null
  };
}

async function processDesign(d, o) {
  const k = o.kiss, dd = o.die, gap = o.gap;
  const cutMode = d.mode === 'cut';
  const fr = (cutMode && d.cutBox) || d.vb; // what the height applies to: the cut line in cut mode, else the artwork
  const s = d.heightMm / fr.h, artW = d.vb.w * s, artH = d.vb.h * s, frW = fr.w * s, frH = d.heightMm;
  const pad = k + dd + Math.max(gap / 2, o.joinGap / 2) + 1.5;
  const Wc = Math.ceil((frW + 2 * pad) / CELL), Hc = Math.ceil((frH + 2 * pad) / CELL);
  let ppm = 2;
  for (const p of [20, 10, 6, 4, 2]) {
    if (o.quality !== 'fine' && p > 10) continue;
    if (Wc * Hc * (p * CELL) ** 2 <= 9e6) { ppm = p; break; }
  }
  const f = Math.round(ppm * CELL), w = Wc * f, h = Hc * f, N = w * h;
  const boxW = Wc * CELL, boxH = Hc * CELL, fx = (boxW - frW) / 2, fy = (boxH - frH) / 2;
  const offX = fx - (fr.x - d.vb.x) * s, offY = fy - (fr.y - d.vb.y) * s; // where the artwork's viewBox origin lands

  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  if (cutMode) {
    // render only the window around the cut line, however big the image is
    const img = await loadImg(windowSvg(d.cutMask, fr.x - fx / s, fr.y - fy / s, boxW / s, boxH / s, w, h));
    cx.drawImage(img, 0, 0, w, h);
  } else {
    const img = await loadImg(sizedSvg(d.norm, Math.round(artW * ppm), Math.round(artH * ppm)));
    cx.drawImage(img, offX * ppm, offY * ppm, artW * ppm, artH * ppm);
  }
  const px = cx.getImageData(0, 0, w, h).data;
  const lvl = mm => mm * ppm + 0.5;
  // Morphological closing of a mask by r mm (grow, then shrink back), returned as a smooth field.
  // Fills gaps and notches narrower than 2r and rounds concave corners; never removes anything.
  const closeField = (bin, r) => {
    const Lc = r * ppm + 0.5, E1 = edt(bin, w, h), outside = new Uint8Array(N);
    for (let i = 0; i < N; i++) outside[i] = E1[i] <= Lc ? 0 : 1;
    const E2 = edt(outside, w, h), F = new Float32Array(N);
    for (let i = 0; i < N; i++) F[i] = -E2[i];
    return { F, L: -Lc };
  };
  const smooth = o.joinGap / 2;
  let kField, kLevel, joined = false;
  if (cutMode) {
    // Kiss cut = the file's own cut line, read straight from its filled shape (anti-aliased edge, sub-pixel).
    kField = new Float32Array(N); kLevel = 127.5;
    let cnt = 0;
    for (let i = 0; i < N; i++) { const a = px[i * 4 + 3]; kField[i] = 255 - a; if (a >= 128) cnt++; }
    if (!cnt) throw new Error('No cut line found in this file.');
  } else {
    const M = new Uint8Array(N);
    let cnt = 0;
    for (let i = 0; i < N; i++) {
      const a = px[i * 4 + 3];
      if (a > 64) {
        if (o.ignoreWhite && a > 200 && px[i * 4] > 245 && px[i * 4 + 1] > 245 && px[i * 4 + 2] > 245) continue;
        M[i] = 1; cnt++;
      }
    }
    if (!cnt) throw new Error('Nothing visible in this file.');
    await tick();
    const D = edt(M, w, h);
    kField = D; kLevel = lvl(k);
    if (smooth > 0) {
      const K0 = new Uint8Array(N);
      for (let i = 0; i < N; i++) K0[i] = D[i] <= kLevel ? 1 : 0;
      fillHolesBin(K0, w, h);
      const jr = joinNear(K0, w, h, o.joinGap * ppm + 1);
      joined = jr.joined;
      await tick();
      const cf = closeField(jr.bin, smooth);
      kField = cf.F; kLevel = cf.L;
    }
  }
  const K = fillHolesField(kField, kLevel, w, h);
  const borderOut = (F, L) => { for (let x = 0; x < w; x++) { F[x] = L + 1; F[(h - 1) * w + x] = L + 1; } for (let y = 0; y < h; y++) { F[y * w] = L + 1; F[y * w + w - 1] = L + 1; } };
  borderOut(kField, kLevel);
  await tick();

  // Die cut = kiss outline grown by dd, smoothed the same way so its notches don't come back sharp.
  const DK = edt(K, w, h);
  let dField, dLevel;
  if (smooth > 0) {
    const db = new Uint8Array(N);
    for (let i = 0; i < N; i++) db[i] = DK[i] <= lvl(dd) ? 1 : 0;
    fillHolesBin(db, w, h);
    const cf = closeField(db, smooth);
    dField = cf.F; dLevel = cf.L;
  } else { dField = Float32Array.from(DK); dLevel = lvl(dd); }
  const dieBin = fillHolesField(dField, dLevel, w, h);
  borderOut(dField, dLevel);
  await tick();
  const DD = edt(dieBin, w, h), nLevel = lvl(gap / 2), nest = new Uint8Array(N);
  for (let i = 0; i < N; i++) nest[i] = DD[i] <= nLevel ? 1 : 0;
  fillHolesBin(nest, w, h);
  let clipField = null, clipLevel = 0;
  if (cutMode) {
    clipField = Float32Array.from(DD); clipLevel = lvl(Math.min(gap / 2, 1));
    fillHolesField(clipField, clipLevel, w, h);
    borderOut(clipField, clipLevel);
  }

  // Drop zero-length and near-duplicate segments: some cutter software divides by segment length.
  const clean = l => {
    const o2 = [];
    for (const p of l) { const q = o2[o2.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01) o2.push(p); }
    while (o2.length > 2 && Math.hypot(o2[0][0] - o2[o2.length - 1][0], o2[0][1] - o2[o2.length - 1][1]) <= 0.01) o2.pop();
    return o2;
  };
  const toMm = loops => loops
    .map(l => clean(simplifyLoop(l.map(p => [p[0] / ppm, p[1] / ppm]), 0.05)))
    .filter(l => l.length >= 3 && Math.abs(loopArea(l)) > 0.3);
  const kissLoops = toMm(march(kField, kLevel, w, h));
  const dieLoops = toMm(march(dField, dLevel, w, h));
  const clipLoops = cutMode ? toMm(march(clipField, clipLevel, w, h)) : [];

  const cb = new Uint8Array(Wc * Hc);
  for (let y = 0; y < h; y++) {
    const row = ((y / f) | 0) * Wc;
    for (let x = 0; x < w; x++) if (nest[y * w + x]) cb[row + ((x / f) | 0)] = 1;
  }
  const masks = {};
  for (const r of [0, 90, 180, 270]) { const rb = rotBits(cb, Wc, Hc, r); masks[r] = makeMask(rb.bits, rb.w, rb.h); }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const l of dieLoops) for (const p of l) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); }
  const pathD = loops => loops.map(l => 'M' + l.map(p => num(p[0]) + ' ' + num(p[1])).join('L') + 'Z').join('');
  return {
    s, artW, artH, frW, frH, boxW, boxH, offX, offY, joined, ppm, parts: kissLoops.length,
    kissLoops, dieLoops, clipLoops, kissD: pathD(kissLoops), dieD: pathD(dieLoops), clipD: pathD(clipLoops), cutMode, masks,
    cutW: bx1 - bx0, cutH: by1 - by0,
    bleedShort: cutMode && (bx0 < offX - 0.05 || by0 < offY - 0.05 || bx1 > offX + artW + 0.05 || by1 > offY + artH + 0.05)
  };
}

/* ---------- nesting ---------- */
async function nestAll(list, sheet, o, cancelled) {
  const { Gw, Gh, blocked } = sheet;
  const items = list.map(d => ({ d, masks: d.res.masks, qty: d.qty, area: d.res.masks[0].area }));
  const rotSets = o.rotate ? [[0], [0, 180], [0, 90, 180, 270], [90], [90, 270]] : [[0]];
  const blockedT = transposeGrid(blocked, Gw, Gh);
  const itemsT = items.map(it => {
    const m = {};
    for (const r in it.masks) m[r] = transposeMask(it.masks[r]);
    return { masks: m, qty: it.qty, area: it.area };
  });
  let best = null;
  for (const rs of rotSets) {
    for (const tr of [false, true]) {
      if (cancelled()) return null;
      const res = tr ? runStrategy(Gh, Gw, blockedT, itemsT, rs) : runStrategy(Gw, Gh, blocked, items, rs);
      const out = res.out.map(p => tr ? { ii: p.ii, rot: p.rot, X: p.Y, Y: p.X } : p);
      let fixedN = 0, autoN = 0;
      items.forEach((it, i) => { if (it.qty != null) fixedN += res.placed[i]; else autoN += res.placed[i]; });
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of out) { const m = items[p.ii].masks[p.rot]; x0 = Math.min(x0, p.X); y0 = Math.min(y0, p.Y); x1 = Math.max(x1, p.X + m.w); y1 = Math.max(y1, p.Y + m.h); }
      const score = [fixedN, autoN, out.length ? -(x1 - x0) * (y1 - y0) : 0];
      if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && (score[1] > best.score[1] || (score[1] === best.score[1] && score[2] > best.score[2])))) {
        best = { score, out, placed: res.placed, box: { x0, y0, x1, y1 } };
      }
      await tick();
    }
  }
  let out = best.out;
  if (o.center && out.length && sheet.free) {
    const fr = sheet.free, b = best.box;
    const want = { dx: Math.floor(((fr.x0 + fr.x1 + 1) - (b.x0 + b.x1)) / 2), dy: Math.floor(((fr.y0 + fr.y1 + 1) - (b.y0 + b.y1)) / 2) };
    const ok = (dx, dy) => out.every(p => {
      const m = items[p.ii].masks[p.rot], X = p.X + dx, Y = p.Y + dy;
      if (X < 0 || Y < 0 || X + m.w > Gw || Y + m.h > Gh) return false;
      for (let r = 0; r < m.h; r++) { const rr = m.rows[r], q = (Y + r) * Gw; for (let k = 0; k < rr.length; k += 2) for (let x = rr[k]; x <= rr[k + 1]; x++) if (blocked[q + X + x]) return false; }
      return true;
    });
    for (const [dx, dy] of [[want.dx, want.dy], [want.dx, 0], [0, want.dy]]) {
      if ((dx || dy) && ok(dx, dy)) { out = out.map(p => ({ ...p, X: p.X + dx, Y: p.Y + dy })); break; }
    }
  }
  return {
    items: out.map(p => ({ d: items[p.ii].d, rot: p.rot, X: p.X, Y: p.Y })),
    counts: new Map(items.map((it, i) => [it.d.id, best.placed[i]]))
  };
}

/* ---------- placement maths ---------- */
function placeMatrix(it) {
  const r = it.d.res, m = r.masks[it.rot];
  const Bx = (it.X - m.ox) * CELL, By = (it.Y - m.oy) * CELL, bw = r.boxW, bh = r.boxH;
  switch (it.rot) {
    case 90: return [0, 1, -1, 0, Bx + bh, By];
    case 180: return [-1, 0, 0, -1, Bx + bw, By + bh];
    case 270: return [0, -1, 1, 0, Bx, By + bw];
    default: return [1, 0, 0, 1, Bx, By];
  }
}
const artTransform = d => `translate(${num(d.res.offX)} ${num(d.res.offY)}) scale(${d.res.s}) translate(${num(-d.vb.x)} ${num(-d.vb.y)})`;

/* ---------- rendering ---------- */
function renderPreview() {
  if (appMode === 'duplex') { renderDuplexPreview(); return; }
  if (appMode === 'svgplt') { renderSvgPltPreview(); return; }
  if (appMode === 'squares') { renderSquaresPreview(); return; }
  if (appMode === 'gang') { renderGangPreview(); return; }
  if (isMarkless()) { renderVinylPreview(); return; }
  previewFrame = null;
  if (isPrintMode()) { renderCardPreview(); return; }
  const t = template, o = readOpts(), showArt = ui.showArt.checked;
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${t.vb.x} ${t.vb.y} ${t.vb.w} ${t.vb.h}" role="img" aria-label="Sticker sheet preview">`);
  p.push(`<rect x="${t.vb.x}" y="${t.vb.y}" width="${t.vb.w}" height="${t.vb.h}" fill="#fff"/>`);
  p.push(`<g>${t.inner.replace(SLOT_RE, '')}</g>`);
  p.push(`<g transform="translate(${t.vb.x} ${t.vb.y}) scale(${t.u})">`);
  if (sheetCache && sheetCache.free) {
    const f = sheetCache.free;
    p.push(`<rect x="${f.x0 * CELL}" y="${f.y0 * CELL}" width="${(f.x1 - f.x0 + 1) * CELL}" height="${(f.y1 - f.y0 + 1) * CELL}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`);
  }
  if (layout && showArt) {
    p.push('<defs>');
    for (const d of new Set(layout.items.map(it => it.d))) {
      const r = d.res;
      const im = `<image href="${r.cutMode ? d.urlNoCut : d.url}" x="${num(r.offX)}" y="${num(r.offY)}" width="${num(r.artW)}" height="${num(r.artH)}" preserveAspectRatio="none"/>`;
      p.push(r.cutMode
        ? `<g id="pv${d.id}"><clipPath id="pvc${d.id}"><path d="${r.clipD}"/></clipPath><g clip-path="url(#pvc${d.id})">${im}</g></g>`
        : `<g id="pv${d.id}">${im}</g>`);
    }
    p.push('</defs>');
  }
  if (layout) {
    for (const it of layout.items) {
      const r = it.d.res, M = placeMatrix(it);
      p.push(`<g transform="matrix(${M.map(num).join(',')})">`);
      if (showArt) {
        if (o.borderFill && !r.cutMode) p.push(`<path d="${r.kissD}" fill="${o.borderColor}"/>`);
        p.push(`<use href="#pv${it.d.id}"/>`);
      }
      p.push(`<path d="${r.dieD}" fill="none" stroke="${CUT_RED}" stroke-width="1.2" stroke-dasharray="1.6 0.9" vector-effect="non-scaling-stroke"/>`);
      p.push(`<path d="${r.kissD}" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      p.push('</g>');
    }
  }
  p.push('</g></svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderStats(busyText) {
  renderStatsCore(busyText);
}
function renderStatsCore(busyText) {
  if (appMode === 'duplex') { renderDuplexStats(); return; }
  if (appMode === 'svgplt') { renderSvgPltStats(busyText); return; }
  if (appMode === 'squares') { renderSquaresStats(busyText); return; }
  if (appMode === 'gang') { renderGangStats(busyText); return; }
  if (isMarkless()) { renderVinylStats(busyText); return; }
  if (isPrintMode()) { renderCardStats(busyText); return; }
  const total = layout ? layout.items.length : 0;
  const ready = designs.filter(d => d.res);
  ui.dropNote.hidden = designs.length > 0;
  for (const b of [ui.exAll, ui.exPrint, ui.exCut]) b.disabled = !total || !!busyText;
  document.getElementById('exPdf').disabled = !total || !!busyText;
  document.getElementById('exCutPdf').disabled = !total || !!busyText;
  document.getElementById('exBatch').disabled = !designs.some(d => d.res) || !!busyText || !(template && template.marks);
  ui.exPlt.disabled = !total || !!busyText || !(template && template.marks);
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = !designs.length ? 'Empty sheet' : total === 1 ? '1 sticker on the sheet' : `${total} stickers on the sheet`;
  const notes = [];
  if (layout) {
    for (const d of ready) {
      const got = layout.counts.get(d.id) || 0;
      if (d.qty != null && got < d.qty) notes.push(`Only ${got} of ${d.qty} copies of ${d.name} fit.`);
      if (d.qty == null && got === 0) notes.push(`${d.name} is too big for the free area.`);
    }
  }
  ui.msg.textContent = notes.join(' ');
  ui.msg.className = 'msg' + (notes.length ? ' warn' : '');
}
function thumbSvg(d) {
  if (isMarkless() && d.vres) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(d.vres.boxW)} ${num(d.vres.boxH)}"><path d="${d.vres.pathD}" fill="rgba(35,31,32,.15)" fill-rule="evenodd" stroke="${CUT_RED}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
  if (!d.res) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${d.vb.x} ${d.vb.y} ${d.vb.w} ${d.vb.h}"><image href="${d.url}" x="${d.vb.x}" y="${d.vb.y}" width="${d.vb.w}" height="${d.vb.h}" preserveAspectRatio="none"/></svg>`;
  const r = d.res;
  const im = `<image href="${r.cutMode ? d.urlNoCut : d.url}" x="${num(r.offX)}" y="${num(r.offY)}" width="${num(r.artW)}" height="${num(r.artH)}" preserveAspectRatio="none"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(r.boxW)} ${num(r.boxH)}">${r.cutMode ? `<clipPath id="tc${d.id}"><path d="${r.clipD}"/></clipPath><g clip-path="url(#tc${d.id})">${im}</g>` : im}<path d="${r.dieD}" fill="none" stroke="${CUT_RED}" stroke-width="1" stroke-dasharray="2 1.2" vector-effect="non-scaling-stroke"/><path d="${r.kissD}" fill="none" stroke="${CUT_RED}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
}
function updateRow(d) {
  if (!d.ui) return;
  d.ui.thumb.innerHTML = thumbSvg(d);
  const st = d.ui.status;
  if (isMarkless()) {
    st.classList.toggle('err', !!d.verr);
    if (d.verr) { st.textContent = d.verr; return; }
    if (d.busy || !d.vres) { st.textContent = 'Reading the shapes…'; return; }
    const r = d.vres, n = vinylLayout ? vinylLayout.counts.get(d.id) || 0 : 0;
    st.textContent = `${appMode === 'pen' ? 'Drawing' : 'Cut'} ${num(Math.round(r.frW * 10) / 10)} × ${num(Math.round(r.frH * 10) / 10)} mm, ${r.nPaths} paths. ${n === 1 ? `1 on the ${appMode === 'pen' ? 'sheet' : 'vinyl'}.` : `${n} on the ${appMode === 'pen' ? 'sheet' : 'vinyl'}.`}${vOpts().vMirror ? ' Mirrored.' : ''}`;
    return;
  }
  st.classList.toggle('err', !!d.error);
  if (d.error) { st.textContent = d.error; return; }
  if (d.busy || !d.res) { st.textContent = 'Tracing outline…'; return; }
  const r = d.res, bits = [];
  bits.push(`${r.cutMode ? 'Cut line' : 'Art'} ${num(Math.round(r.frW * 10) / 10)} × ${num(Math.round(r.frH * 10) / 10)} mm, die cut ${num(Math.round(r.cutW * 10) / 10)} × ${num(Math.round(r.cutH * 10) / 10)} mm.`);
  if (layout) { const n = layout.counts.get(d.id) || 0; bits.push(n === 1 ? '1 on the sheet.' : `${n} on the sheet.`); }
  if (d.circle) bits.push(d.circle.found ? 'Round sticker: the cut circle was placed on the circle found in the PDF (2 % inside its edge); adjust it below if needed.' : 'Round sticker: no clear circle found in the PDF, so the cut circle is centred at 90 % of the page; adjust it below.');
  else if (r.cutMode) bits.push('Kiss cut follows the line in the file; everything outside the easy-peel margin is cropped off.');
  if (r.bleedShort) bits.push('The image doesn’t reach the die line everywhere, so parts of the easy-peel margin will print white.');
  if (r.joined) bits.push('Nearby parts joined into one shape.');
  { const want = readOpts().quality === 'fine' ? 20 : 10; if (r.ppm < want) bits.push(`Large design: outline traced at ${num(Math.round(100 / r.ppm) / 100)} mm instead of ${num(1 / want)} mm.`); }
  if (r.parts > 1) bits.push(`${r.parts} separate parts further apart than the join distance, each gets its own kiss cut.`);
  bits.push(...d.warns);
  st.textContent = bits.join(' ');
}
function addRow(d) {
  const li = document.createElement('li');
  li.className = 'design';
  li.innerHTML = `<div class="thumb"></div>
    <div><div class="dname"></div>
      <div class="fields">
        <label class="hl">Height, mm<input type="number" min="5" step="0.5" class="h"></label>
        <label>Copies<input type="number" min="0" step="1" placeholder="Fill" class="q"></label>
        <label class="ksel">Kiss cut<select class="m"><option value="trace">Trace artwork</option><option value="cut">Cut line from file</option></select></label>
      </div>
      <div class="fields circ" hidden>
        <label>Circle, % of page<input type="number" min="5" max="150" step="0.5" class="cs"></label>
        <label>Move X, %<input type="number" min="-50" max="50" step="0.5" class="cx"></label>
        <label>Move Y, %<input type="number" min="-50" max="50" step="0.5" class="cy"></label>
        <button type="button" class="link cdet">Find the circle again</button>
      </div>
      <div class="status"></div></div>
    <button type="button" class="remove">×</button>`;
  li.querySelector('.dname').textContent = d.name;
  li.querySelector('.dname').title = d.name;
  const hIn = li.querySelector('.h'), qIn = li.querySelector('.q'), rm = li.querySelector('.remove');
  hIn.value = num(Math.round(d.heightMm * 10) / 10);
  rm.setAttribute('aria-label', `Remove ${d.name}`);
  const mIn = li.querySelector('.m');
  mIn.value = d.mode;
  if (!d.canCut) { mIn.querySelector('[value=cut]').disabled = true; mIn.title = 'No stroked, unfilled line found in this file'; }
  const hl = li.querySelector('.hl').firstChild;
  const setHl = () => { hl.textContent = d.circle ? 'Sticker Ø (cut line), mm' : d.mode === 'cut' ? 'Cut line height, mm' : 'Height, mm'; };
  setHl();
  if (d.circle) {
    // round sticker from a PDF: the circle is the kiss cut; its size and position on the page are set here
    li.querySelector('.ksel').hidden = true;
    const box = li.querySelector('.circ'), cs = box.querySelector('.cs'), cx = box.querySelector('.cx'), cy = box.querySelector('.cy');
    box.hidden = false;
    const fill = () => { cs.value = num(Math.round(d.circle.size * 1000) / 10); cx.value = num(Math.round(d.circle.x * 1000) / 10); cy.value = num(Math.round(d.circle.y * 1000) / 10); };
    fill();
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(() => rebuildCircle(d), 250); };
    cs.addEventListener('input', () => { const v = parseFloat(cs.value); if (isFinite(v) && v >= 5) { d.circle.size = v / 100; later(); } });
    cx.addEventListener('input', () => { const v = parseFloat(cx.value); if (isFinite(v)) { d.circle.x = v / 100; later(); } });
    cy.addEventListener('input', () => { const v = parseFloat(cy.value); if (isFinite(v)) { d.circle.y = v / 100; later(); } });
    box.querySelector('.cdet').addEventListener('click', async () => {
      const im = new Image(); im.src = d.circle.img; await im.decode();
      const det = detectCircle(im);
      if (det) { Object.assign(d.circle, { size: det.size * 0.98, x: det.x, y: det.y }); fill(); rebuildCircle(d); }
      else { d.ui.status.textContent = 'No clear circle found; set the size and position by hand.'; }
    });
  }
  mIn.addEventListener('change', () => { d.mode = mIn.value; setHl(); schedule(); });
  hIn.addEventListener('input', () => { const v = parseFloat(hIn.value); if (isFinite(v) && v >= 5) { d.heightMm = v; schedule(); } });
  qIn.addEventListener('input', () => { const v = parseInt(qIn.value, 10); d.qty = (qIn.value === '' || !isFinite(v)) ? null : Math.max(0, v); schedule(); });
  rm.addEventListener('click', () => {
    const i = designs.indexOf(d); if (i >= 0) designs.splice(i, 1);
    li.remove();
    if (!designs.length) ui.list.innerHTML = '<li class="empty">No stickers yet.</li>';
    schedule();
  });
  d.ui = { li, thumb: li.querySelector('.thumb'), status: li.querySelector('.status') };
  ui.list.appendChild(li);
  updateRow(d);
}

/* ---------- pipeline ---------- */
function schedule() { clearTimeout(timer); timer = setTimeout(run, 280); }
async function run() {
  const my = ++gen, o = readOpts();
  saveOpts();
  try {
    renderStats('Preparing the sheet…');
    if (appMode === 'svgplt' || appMode === 'duplex') { renderPreview(); renderStats(); return; }
    if (appMode === 'squares') { squaresCompute(o); renderPreview(); renderStats(); return; }
    if (appMode === 'gang') { gangCompute(o); renderPreview(); renderStats(); return; }
    if (isMarkless()) { await runVinyl(my, vOpts()); return; }
    const sheet = await templateSheet(o);
    if (my !== gen) return;
    if (isPrintMode()) { cards.layout = computeCardLayout(sheet, o); renderPreview(); renderStats(); return; }
    for (const d of designs) {
      const key = [d.mode, d.heightMm, o.kiss, o.die, o.gap, o.joinGap, o.quality, o.ignoreWhite].join('|');
      if (d.key === key) continue;
      d.busy = true; updateRow(d);
      renderStats(`Tracing ${d.name}…`);
      await tick();
      let res = null, err = null;
      try { res = await processDesign(d, o); }
      catch (e) { err = e.message || String(e); }
      if (my !== gen) return;
      d.res = res; d.error = err; d.key = key; d.busy = false;
      updateRow(d);
    }
    const ready = designs.filter(d => d.res && d.qty !== 0);
    renderStats('Arranging stickers…');
    await tick();
    const lay = ready.length ? await nestAll(ready, sheet, o, () => my !== gen) : null;
    if (my !== gen) return;
    layout = lay;
    renderPreview();
    designs.forEach(updateRow);
    renderStats();
  } catch (e) {
    if (my === gen) { renderStats(); ui.msg.textContent = e.message || String(e); ui.msg.className = 'msg warn'; }
  }
}

/* ---------- round stickers from a PDF: the page as artwork, a circle as the kiss cut ---------- */
async function addPdfCircles(file) {
  await ensureLibs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i), vp1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: Math.min(10, 3000 / Math.max(vp1.width, vp1.height)) }); // ~3000 px: 300 dpi up to ~25 cm
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: g, viewport: vp }).promise;
    const det = detectCircle(cv);
    // cut a little inside the detected edge, so no background shows if the cut lands a bit off
    const c = { img: cv.toDataURL('image/jpeg', 0.92), w: vp1.width, h: vp1.height, pdf: bytes, page: i - 1, mbx: pg.view[0], mby: pg.view[1], rot: ((pg.rotate || 0) % 360 + 360) % 360, size: det ? det.size * 0.98 : 0.9, x: det ? det.x : 0, y: det ? det.y : 0, found: !!det };
    cv.width = cv.height = 1;
    const d = prepareDesign(circleSvg(c), pdf.numPages > 1 ? `${file.name} p.${i}` : file.name);
    d.circle = c; d.mode = 'cut'; d.heightMm = 50;
    designs.push(d); addRow(d);
  }
}
function rebuildCircle(d) {
  const nd = prepareDesign(circleSvg(d.circle), d.name), keep = { qty: d.qty, heightMm: d.heightMm, ui: d.ui, circle: d.circle };
  for (const k of Object.keys(nd)) d[k] = nd[k];
  Object.assign(d, keep);
  d.mode = 'cut';
  updateRow(d); schedule();
}

async function addFiles(fileList) {
  const isPdf = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  const files = Array.from(fileList).filter(f => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml' || (isPdf(f) && !isMarkless()));
  if (!files.length) { ui.msg.textContent = isMarkless() ? 'Only SVG files can be added here.' : 'Only SVG and PDF files can be added.'; ui.msg.className = 'msg warn'; return; }
  if (!designs.length) ui.list.innerHTML = '';
  for (const f of files) {
    try {
      if (isPdf(f)) { ui.msg.textContent = `Reading ${f.name}…`; ui.msg.className = 'msg'; await addPdfCircles(f); ui.msg.textContent = ''; continue; }
      const d = prepareDesign(await f.text(), f.name);
      designs.push(d); addRow(d);
    } catch (e) {
      ui.msg.textContent = `${f.name}: ${e.message}`; ui.msg.className = 'msg warn';
    }
  }
  schedule();
}

/* ---------- export ---------- */
// vec: for the print PDF, round stickers made from a PDF are left out here and drawn from the original PDF instead
// A rotated PDF page is printed from its rendered image: the vector embed would come out unrotated.
const vecCircle = d => !!(d.circle && d.circle.pdf && !d.circle.rot);
function buildExport(kind, vec = false) {
  const t = template, o = readOpts(), L = layout;
  const s = [];
  s.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n');
  // SignCut chokes on xlink:href, so the cut file carries no xlink at all
  s.push((kind === 'cut' ? t.open.replace(/\s+xmlns:xlink="[^"]*"/g, '') : t.open) + '\n');
  const pr = [];
  if (kind !== 'cut') {
    // Reset styles the template root passes down (e.g. fill-rule:evenodd), so the artwork renders like its own file.
    pr.push(`<g id="Print" transform="translate(${t.vb.x} ${t.vb.y}) scale(${t.u})" xml:space="default" style="fill-rule:nonzero;clip-rule:nonzero;stroke-linejoin:miter;stroke-miterlimit:4">\n`);
    // shared bitmaps, once per design
    const defs = [...new Set(L.items.map(it => it.d))].map(d => d.sharedDefs.split('__D__').join(`s${d.id}-`)).join('');
    if (defs) pr.push(`<defs>${defs}</defs>\n`);
    L.items.forEach((it, n) => {
      if (vec && vecCircle(it.d)) return;
      const d = it.d, M = placeMatrix(it), cp = `s${d.id}c${n}-`;
      const art = m => `<g transform="${artTransform(d)}"${d.wrap}>${m.split('__P__').join(cp).split('__D__').join(`s${d.id}-`)}</g>`;
      pr.push(`<g transform="matrix(${M.map(num).join(',')})">`);
      if (d.res.cutMode) {
        // cut-line mode: artwork is cropped to the die line plus a little bleed, the rest of the image is dropped
        pr.push(`<clipPath id="${cp}clip"><path d="${d.res.clipD}"/></clipPath><g clip-path="url(#${cp}clip)">${art(d.markupNoCut)}</g></g>\n`);
      } else {
        if (o.borderFill) pr.push(`<path d="${d.res.kissD}" fill="${o.borderColor}"/>`);
        pr.push(`${art(d.markup)}</g>\n`);
      }
    });
    pr.push('</g>\n');
  }
  const print = pr.join('');
  if (kind === 'art') s.push(print); // artwork only, no marks
  else if (SLOT_RE.test(t.inner)) s.push(t.inner.replace(SLOT_RE, () => print) + '\n');
  else s.push(t.inner + '\n' + print);
  if (kind !== 'print' && kind !== 'art') {
    // Cut lines: plain paths in the document's own units, no transforms, one closed path per outline.
    const u = t.u, toDoc = M => [M[0] * u, M[1] * u, M[2] * u, M[3] * u, M[4] * u + t.vb.x, M[5] * u + t.vb.y];
    const sw = num(o.lineW * u);
    // Written the way Illustrator does: one <polygon> per outline, layer names encoded Illustrator-style (SignCut decodes them).
    const dieName = o.dieLayer === o.kissLayer ? o.dieLayer + ' 2' : o.dieLayer;
    for (const [name, color, key] of [[o.kissLayer, o.kissColor, 'kissLoops'], [dieName, o.dieColor, 'dieLoops']]) {
      s.push(`<g id="${aiId(name)}">\n`);
      for (const it of L.items) {
        const M = toDoc(placeMatrix(it));
        for (const loop of it.d.res[key]) s.push(pathEl(loop.map(p => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]), true, `fill:none;stroke:${color};stroke-width:${sw}`) + '\n');
      }
      s.push('</g>\n');
    }
  }
  s.push('</svg>\n');
  return s.join('');
}
// Sticker outlines placed on the sheet, in sheet mm.
function stickerLoops(key) {
  const res = [];
  for (const it of layout.items) {
    const M = placeMatrix(it);
    for (const loop of it.d.res[key]) res.push(loop.map(p => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]));
  }
  return res;
}
// Centre lines of a template's registration marks in sheet mm, as writePlt expects them.
const markFrame = t => ({ top: (t.marks.top - t.vb.y) / t.u, bottom: (t.marks.bottom - t.vb.y) / t.u, left: (t.marks.left - t.vb.x) / t.u, right: (t.marks.right - t.vb.x) / t.u });
const pltOpts = (o, force) => ({ force, overcut: o.overcut, bladeOffset: o.bladeOffset, pltForce: o.pltForce, cutSpeed: o.cutSpeed, upSpeed: o.upSpeed });
function buildPlt(sheetLoops, force, openLines = [], ...laterLines) {
  return writePlt(markFrame(template), pltOpts(readOpts(), force), sheetLoops, openLines, ...laterLines);
}
async function saveFile(name, text) {
  const blob = text instanceof Blob ? text : new Blob([text], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function exportName(kind) {
  const n = layout ? layout.items.length : 0;
  const base = `sticker-sheet-${n}pcs`;
  return kind === 'all' ? `${base}.svg` : `${base}-${kind}.svg`;
}
ui.exAll.addEventListener('click', () => saveFile(exportName('all'), buildExport('all')));
ui.exPrint.addEventListener('click', () => saveFile(exportName('print'), buildExport('print')));
ui.exCut.addEventListener('click', () => {
  const o = readOpts(), dieName = o.dieLayer === o.kissLayer ? o.dieLayer + ' 2' : o.dieLayer;
  saveFile(exportName('cut'), template.generated ? lemurCutSvg([
    { name: o.kissLayer, color: o.kissColor, paths: stickerLoops('kissLoops').map(pts => ({ pts, closed: true })) },
    { name: dieName, color: o.dieColor, paths: stickerLoops('dieLoops').map(pts => ({ pts, closed: true })) }]) : buildExport('cut'));
});
ui.exPlt.addEventListener('click', () => {
  const base = exportName('cut').replace(/-cut\.svg$/, '');
  const po = readOpts();
  saveFile(`${base}-plt.zip`, makeZip([{ name: `${base}-kiss.plt`, text: buildPlt(stickerLoops('kissLoops'), po.kissForce) }, { name: `${base}-die.plt`, text: buildPlt(stickerLoops('dieLoops'), po.dieForce) }]));
});

/* ---------- wiring ---------- */
ui.files.addEventListener('change', () => { addFiles(ui.files.files); ui.files.value = ''; });
ui.tplFile.addEventListener('change', async () => {
  const f = ui.tplFile.files[0]; ui.tplFile.value = '';
  if (!f) return;
  try { setTemplate(await f.text(), f.name.replace(/\.svg$/i, ''), false); schedule(); }
  catch (e) { ui.msg.textContent = `Template: ${e.message}`; ui.msg.className = 'msg warn'; }
});
ui.tplReset.addEventListener('click', () => { applySheetSize(); schedule(); });
for (const id of ['sheetSize', 'sheetW', 'sheetH', 'sheetFeed', 'sheetFeedMm']) document.getElementById(id).addEventListener(id === 'sheetSize' || id === 'sheetFeed' ? 'change' : 'input', () => { applySheetSize(); schedule(); });
for (const id of OPT_IDS) {
  const e = document.getElementById(id);
  e.addEventListener(e.type === 'color' || e.type === 'checkbox' || e.tagName === 'SELECT' ? 'change' : 'input', () => {
    if (id === 'dpi' && template && template.unitless) { setTemplate(template.text, template.name, ui.tplReset.hidden); }
    if (['kissColor', 'dieColor', 'kissLayer', 'dieLayer', 'borderFill', 'borderColor', 'lineW', 'overcut', 'bladeOffset', 'pltForce', 'kissForce', 'dieForce', 'cutSpeed', 'upSpeed'].includes(id)) {
      saveOpts(); if (template) renderPreview(); designs.forEach(updateRow); return;
    }
    schedule();
  });
}
ui.showArt.addEventListener('change', () => renderPreview());

/* ---------- zoom & pan on the sheet preview ---------- */
// view = visible part of the sheet in template units (same aspect as the sheet); null = whole sheet.
let view = null, pan = null;
function fullView() { const v = previewFrame || template.vb; return { x: v.x, y: v.y, w: v.w, h: v.h }; }
function clampView(v) {
  const f = fullView(), minW = f.w / 40;
  if (v.w >= f.w) return null;
  if (v.w < minW) { const s = minW / v.w; v = { x: v.x, y: v.y, w: minW, h: v.h * s }; }
  v.x = Math.min(Math.max(v.x, f.x), f.x + f.w - v.w);
  v.y = Math.min(Math.max(v.y, f.y), f.y + f.h - v.h);
  return v;
}
function applyView() {
  const svg = ui.stage.querySelector('svg');
  if (!svg || !template) return;
  const v = view || fullView();
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  $('#zLbl').textContent = Math.round(fullView().w / v.w * 100) + '%';
  ui.stage.classList.toggle('zoomed', !!view);
}
function svgPoint(svg, cx, cy) {
  const m = svg.getScreenCTM().inverse();
  return { x: m.a * cx + m.c * cy + m.e, y: m.b * cx + m.d * cy + m.f };
}
function zoomAt(factor, cx, cy) {
  const svg = ui.stage.querySelector('svg');
  if (!svg || !template) return;
  const v = view || fullView();
  const p = cx == null ? { x: v.x + v.w / 2, y: v.y + v.h / 2 } : svgPoint(svg, cx, cy);
  const nw = v.w / factor, nh = v.h / factor;
  view = clampView({ x: p.x - (p.x - v.x) * (nw / v.w), y: p.y - (p.y - v.y) * (nh / v.h), w: nw, h: nh });
  applyView();
}
ui.stage.addEventListener('wheel', e => {
  if (!ui.stage.querySelector('svg')) return;
  e.preventDefault();
  // trackpad pinch arrives as ctrl+wheel with small deltas
  const k = e.ctrlKey ? 0.01 : 0.0015;
  zoomAt(Math.exp(-e.deltaY * k), e.clientX, e.clientY);
}, { passive: false });
ui.stage.addEventListener('pointerdown', e => {
  const svg = ui.stage.querySelector('svg');
  if (!svg || !view || e.button !== 0) return;
  const r = svg.getBoundingClientRect(), v = view;
  const scale = Math.min(r.width / v.w, r.height / v.h);
  pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, v: { ...v }, scale };
  ui.stage.setPointerCapture(e.pointerId);
  ui.stage.classList.add('panning');
});
ui.stage.addEventListener('pointermove', e => {
  if (!pan || e.pointerId !== pan.id) return;
  view = clampView({ ...pan.v, x: pan.v.x - (e.clientX - pan.sx) / pan.scale, y: pan.v.y - (e.clientY - pan.sy) / pan.scale });
  applyView();
});
const endPan = e => { if (pan && e.pointerId === pan.id) { pan = null; ui.stage.classList.remove('panning'); } };
ui.stage.addEventListener('pointerup', endPan);
ui.stage.addEventListener('pointercancel', endPan);
ui.stage.addEventListener('dblclick', () => { view = null; applyView(); });
ui.stage.title = 'Scroll to zoom, drag to move, double-click to fit';
$('#zIn').addEventListener('click', () => zoomAt(1.5));
$('#zOut').addEventListener('click', () => zoomAt(1 / 1.5));
$('#zFit').addEventListener('click', () => { view = null; applyView(); });
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dropping'); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dropping'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  if (appMode === 'winietka') winAddFiles(e.dataTransfer.files); else if (appMode === 'svgplt') spLoad(e.dataTransfer.files[0]); else if (appMode === 'gang') gangAddFiles(e.dataTransfer.files); else if (isPrintMode()) loadCardFile(e.dataTransfer.files); else addFiles(e.dataTransfer.files);
});

/* ---------- business cards mode ---------- */
let appMode = 'stickers';
const newPrintJob = () => ({ imgSrc: null, name: null, bytes: null, pages: 0, pageW: 0, pageH: 0, mbx: 0, mby: 0, previews: [], layout: null, bleed: null });
const kinds = { cards: newPrintJob(), vouchers: newPrintJob(), guillotine: newPrintJob(), morgana: newPrintJob(), gang: newPrintJob(), deck: newPrintJob(), winietka: newPrintJob() };
let cards = kinds.cards; // the PDF job of the current mode
function isPrintMode() { return appMode === 'cards' || appMode === 'vouchers' || appMode === 'guillotine' || appMode === 'morgana' || appMode === 'deck' || appMode === 'winietka'; }
// guillotine sheet (also the card deck): chosen under Sheet; print sheets mode stays on 310 × 440
function gSheetMm() {
  if (appMode === 'gang') return [310, 440];
  const sel = document.getElementById('gPage').value;
  if (sel === 'custom') {
    const w = parseFloat(document.getElementById('gPageW').value), h = parseFloat(document.getElementById('gPageH').value);
    return [isFinite(w) && w >= 50 ? w : 310, isFinite(h) && h >= 50 ? h : 440];
  }
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(sel);
  return m ? [+m[1], +m[2]] : [310, 440];
}
const G_PAGE = { get wMm() { return gSheetMm()[0]; }, get hMm() { return gSheetMm()[1]; } };
document.getElementById('gPage').addEventListener('change', () => { document.getElementById('rowGPageCustom').hidden = document.getElementById('gPage').value !== 'custom'; });
const SIZES = { A4: [210, 297], A5: [148, 210], A6: [105, 148], DL: [99, 210] };
// guillotine: print the PDF scaled to a standard size (orientation follows the PDF)
function pageScale(o) {
  if ((appMode !== 'guillotine' && appMode !== 'deck') || !cards.bytes) return 1;
  if (o.gSize === 'custom') return Math.max(0.05, o.gScale / 100);
  const t = SIZES[o.gSize];
  const sw = cards.pageW - 2 * o.cBleed, sh = cards.pageH - 2 * o.cBleed;
  if (!t || sw <= 0 || sh <= 0) return 1;
  const [a, b] = sw >= sh ? [t[1], t[0]] : t;
  return Math.min(a / sw, b / sh);
}
function pageDims() { return appMode === 'guillotine' || appMode === 'gang' || appMode === 'deck' ? G_PAGE : appMode === 'morgana' ? M_PAGE : { wMm: template.wMm, hMm: template.hMm }; }
// Morgana CardXtra SRA3 template (calibrated, 20-up): 90 × 50 slot trims and the reading mark, taken 1:1 from the template PDF.
const M_PAGE = { wMm: 450, hMm: 320 };
const M_TPL = {
  cols: [17.891, 118.479, 219.067, 319.74], rows: [12.944, 72.944, 132.943, 192.943, 252.944],
  backCols: [17.9, 118.5, 219.1, 319.7], backRows: [17.012, 77.012, 137.012, 197.012, 257.012],
  mark: [6.011, 145.034, 7.959, 29.972], w: 90, h: 50
};
const rotPlace = (r, Bx, By, pw, ph) => r === 90 ? [0, 1, -1, 0, Bx + ph, By] : r === 180 ? [-1, 0, 0, -1, Bx + pw, By + ph] : r === 270 ? [0, -1, 1, 0, Bx, By + pw] : [1, 0, 0, 1, Bx, By];
function morganaLayout(o) {
  const pw = cards.pageW, ph = cards.pageH, b = o.cBleed, tw = pw - 2 * b, th = ph - 2 * b;
  const base = { n: 0, items: [], b, tw, th, e: 0, gap: 0, guil: false, morgana: true, pw, ph, sc: 1 };
  const land = tw >= th, [W, H] = { '90x50': [90, 50], '85x55': [85, 55] }[o.mSize] || [90, 55];
  if (Math.abs(Math.max(tw, th) - W) > 0.6 || Math.abs(Math.min(tw, th) - H) > 0.6) return { ...base, error: `The CardXtra is set to cut ${W} × ${H} mm; this PDF is ${num(Math.round(tw * 10) / 10)} × ${num(Math.round(th * 10) / 10)} mm after the bleed.` };
  // every card sits in the bottom-left corner of its template slot; bleed is limited to half the gap to the next card
  const rot = land ? 0 : 90, e = Math.min(b, (60 - H) / 2, (100.5 - W) / 2), items = [];
  const S = [-1, 0, 0, 1, pw, 0], My = [1, 0, 0, -1, 0, M_PAGE.hMm];
  M_TPL.rows.forEach((ry, r) => M_TPL.cols.forEach((rx, c) => {
    const tx = rx, ty = ry + M_TPL.h - H;
    const T = rotPlace(rot, tx - b, ty - b, pw, ph);
    // back: flipped over the long (top) edge, so the back of each card reads the right way up; placed on the template's back slot
    const Lb = mul(My, mul(T, S)), pts = [[b, b], [b + tw, b], [b, b + th], [b + tw, b + th]].map(q => apply([Lb[0], Lb[1], Lb[2], Lb[3], 0, 0], q));
    // the back of the same card is mirrored top-to-bottom, so it sits in the top-left corner of the back slot
    const bx = M_TPL.backCols[c], by = M_TPL.backRows[M_TPL.rows.length - 1 - r];
    const Tb = [Lb[0], Lb[1], Lb[2], Lb[3], bx - Math.min(...pts.map(q => q[0])), by - Math.min(...pts.map(q => q[1]))];
    items.push({ T, Tb, trim: [tx, ty, W, H], clip: [tx - e, ty - e, W + 2 * e, H + 2 * e], btrim: [bx, by, W, H], bclip: [bx - e, by - e, W + 2 * e, H + 2 * e] });
  }));
  return { ...base, n: items.length, items, e, rot, cols: 4, rows: 5 };
}
const shiftRect = (rc, o) => [rc[0] + o.cOffX, rc[1] + o.cOffY, rc[2], rc[3]];
const backT = (it, o) => it.Tb ? mul([1, 0, 0, 1, o.cOffX, o.cOffY], it.Tb) : backMatrix(it.T, o);
const backClip = (it, o) => it.bclip ? shiftRect(it.bclip, o) : backRect(it.clip, o);
// a multi-page job laid out card by card: the card deck (front + back per card) or the guillotine with
// "every page a separate card" (one page per card, one-sided)
const deckLike = () => appMode === 'deck' || (appMode === 'guillotine' && document.getElementById('gPages').value === 'each');
const deckPer = () => appMode === 'deck' ? 2 : 1;
// the crop marks as they land on the back page (mirrored like the cards, with the back shift)
function backMarks(L, o) {
  const pg = pageDims();
  return cropMarks(L, o).map(m => o.cFlip === 'short'
    ? [m[0] + o.cOffX, pg.hMm - m[1] + o.cOffY, m[2] + o.cOffX, pg.hMm - m[3] + o.cOffY]
    : [pg.wMm - m[0] + o.cOffX, m[1] + o.cOffY, pg.wMm - m[2] + o.cOffX, m[3] + o.cOffY]);
}
const KIND = {
  cards: { title: 'Business cards', one: 'card', many: 'cards', file: 'business-cards', hint: 'One PDF: page 1 is the front, page 2 the back, both with bleed (e.g. 94 × 54 mm for a 90 × 50 card). Or one or two images (PNG, JPG, WebP…): front, then back. You can also drop them on the sheet.' },
  morgana: { title: 'Morgana CardXtra', one: 'card', many: 'cards', file: 'morgana', hint: 'One PDF of a 90 × 55, 90 × 50 or 85 × 55 card (set the cut size) with bleed: page 1 the front, page 2 the back. Or one or two images (front, back): they are cut at the CardXtra size, at 100 % from their dpi. Imposed 20-up on SRA3 (450 × 320) on the CardXtra template slots, each card in the bottom-left corner of its slot, with the black reading mark on both sides. You can also drop it on the sheet.' },
  winietka: { title: 'Winietki', one: 'card', many: 'cards', file: 'winietki', hint: 'Add one or more PDFs, every page one winietka (all the same size, with bleed), or make them from a list of names. Single-sided, printed on the sheet with registration marks and cut with straight lines like business cards; every sheet uses the same PLT. You can also drop the PDFs on the sheet.' },
  deck: { title: 'Card deck', one: 'card', many: 'cards', file: 'deck', hint: 'One multi-page PDF with bleed: pages 1 and 2 are the front and back of card 1, pages 3 and 4 card 2, and so on. Set how many complete sets you need; you get double-sided sheets (310 × 440 or the size chosen under Sheet) with crop marks. You can also drop it on the sheet.' },
  guillotine: { title: 'Guillotine', one: 'copy', many: 'copies', file: 'guillotine', hint: 'One PDF with bleed: page 1 the front, page 2 the back (optional). Copies are laid out on the chosen sheet (310 × 440 by default) with crop marks for the guillotine. A multi-page PDF of different one-sided cards: set PDF pages to “every page a separate card”. You can also drop it on the sheet.' },
  vouchers: { title: 'Vouchers', one: 'voucher', many: 'vouchers', file: 'vouchers', hint: 'One PDF of the opened-out voucher: page 1 the outside, page 2 the inside, with bleed. The fold is perforated across the long side. You can also drop it on the sheet.' }
};

/* ---------- card images: PNG / JPG / … turned into a card PDF with bleed ---------- */
const isPdfFile = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
const isImageFile = f => /^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);
async function readCardImage(f) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bmp;
  try { bmp = await createImageBitmap(new Blob([bytes], { type: f.type || 'image/png' })); }
  catch (e) { throw new Error(`${f.name} isn’t an image the browser can read.`, { cause: e }); }
  const png = bytes[0] === 0x89 && bytes[1] === 0x50, jpg = bytes[0] === 0xFF && bytes[1] === 0xD8;
  const img = { name: f.name, w: bmp.width, h: bmp.height, dpi: imageDpi(bytes), bytes: null, kind: null, blob: new Blob([bytes], { type: f.type || 'image/png' }) };
  if (png) { img.bytes = bytes; img.kind = 'png'; }
  else if (jpg && jpegOrientation(bytes) === 1) { img.bytes = bytes; img.kind = 'jpg'; }
  else { // other formats, or a rotated JPEG: re-encode upright as lossless PNG
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    img.bytes = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer()); img.kind = 'png';
    cv.width = cv.height = 1;
  }
  bmp.close && bmp.close();
  return img;
}
// The trim size of an image card: the CardXtra cut size in Morgana mode (the machine is fixed to it), else the fields.
// Orientation follows the image.
function imageTrim(im) {
  const v = id => parseFloat(document.getElementById(id).value);
  let W, H;
  if (appMode === 'morgana') { const m = /^(\d+)x(\d+)$/.exec(document.getElementById('mSize').value) || [0, 90, 55]; W = +m[1]; H = +m[2]; }
  else { W = Math.max(10, v('icW') || 90); H = Math.max(10, v('icH') || 50); }
  const land = im.w >= im.h;
  return land === (W >= H) ? [W, H] : [H, W];
}
// One PDF page per image. Page = trim + the same bleed B on all sides (what the imposition expects), TrimBox set
// so the bleed is read back exactly. In 100% and fit mode the image keeps its size/proportions, centred on the
// trim; bleed it brings along is used per side (e.g. only top and bottom), and sides without bleed are either
// filled by repeating the edge pixels or left white.
async function imagesToCardPdf(src) {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib, v = id => parseFloat(document.getElementById(id).value);
  const fit = document.getElementById('icFit').value, dpiSet = Math.min(2400, Math.max(30, v('icDpi') || 300));
  const extend = document.getElementById('icExtend').checked, setB = Math.max(0, v('cBleed') || 0);
  const r1 = x => num(Math.round(x * 10) / 10), r2 = x => num(Math.round(x * 100) / 100), TOL = 0.15;
  // placed image size (mm) per image
  const plan = src.imgs.map(im => {
    const [W, H] = imageTrim(im);
    let iw, ih, dpi = null;
    if (fit === 'stretch') { iw = W + 2 * setB; ih = H + 2 * setB; }
    else if (fit === 'fill') { const k = Math.max(W / im.w, H / im.h); iw = im.w * k; ih = im.h * k; }
    else { dpi = im.dpi || dpiSet; iw = im.w / dpi * 25.4; ih = im.h / dpi * 25.4; }
    return { im, W, H, iw, ih, dpi, bx: (iw - W) / 2, by: (ih - H) / 2 };
  });
  // one bleed for every page (front and back must match): the most any image brings, at most 6 mm
  const B = fit === 'stretch' ? setB : Math.min(6, Math.max(0, ...plan.map(p => Math.max(p.bx, p.by))));
  const pdf = await PDFDocument.create(), notes = [];
  const [W0, H0] = [plan[0].W, plan[0].H];
  for (const p of plan) {
    const { im, W, H, iw, ih } = p, pw = W + 2 * B, ph = H + 2 * B;
    const page = pdf.addPage([pw * PT, ph * PT]);
    page.setTrimBox(B * PT, B * PT, W * PT, H * PT);
    const gapX = (pw - iw) / 2, gapY = (ph - ih) / 2; // > 0: the image doesn't reach the page edge there
    let emb, x = gapX, y = gapY, w = iw, h = ih;
    if (fit !== 'stretch' && extend && (gapX > 0.01 || gapY > 0.01)) {
      // repeat the outermost pixels into the missing bleed (only ever lands outside the trim if the image covers it)
      const bmp = await createImageBitmap(im.blob), ppm = im.w / iw;
      const cw = Math.max(1, Math.round(pw * ppm)), ch = Math.max(1, Math.round(ph * ppm));
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      const ox = gapX * ppm, oy = gapY * ppm, ex = ox + im.w, ey = oy + im.h;
      g.drawImage(bmp, ox, oy, im.w, im.h);
      if (ox > 0) { g.drawImage(bmp, 0, 0, 1, im.h, 0, oy, ox, im.h); g.drawImage(bmp, im.w - 1, 0, 1, im.h, ex, oy, cw - ex, im.h); }
      if (oy > 0) { g.drawImage(bmp, 0, 0, im.w, 1, ox, 0, im.w, oy); g.drawImage(bmp, 0, im.h - 1, im.w, 1, ox, ey, im.w, ch - ey); }
      if (ox > 0 && oy > 0) for (const [sx, sy, dx, dy, dw, dh] of [[0, 0, 0, 0, ox, oy], [im.w - 1, 0, ex, 0, cw - ex, oy], [0, im.h - 1, 0, ey, ox, ch - ey], [im.w - 1, im.h - 1, ex, ey, cw - ex, ch - ey]]) g.drawImage(bmp, sx, sy, 1, 1, dx, dy, dw, dh);
      bmp.close && bmp.close();
      const bytes = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer());
      cv.width = cv.height = 1;
      emb = await pdf.embedPng(bytes); x = 0; y = 0; w = pw; h = ph; // the canvas is exactly the page
    } else emb = im.kind === 'png' ? await pdf.embedPng(im.bytes) : await pdf.embedJpg(im.bytes);
    // PDF y runs up: an image placed y mm from the top sits at ph - y - h from the bottom
    page.drawImage(emb, { x: x * PT, y: (ph - y - h) * PT, width: w * PT, height: h * PT });
    if (fit === 'stretch') {
      const ar = im.w / im.h, cr = pw / ph;
      if (Math.abs(ar / cr - 1) > 0.02) notes.push(`${im.name} is stretched ${num(Math.round(Math.abs(ar / cr - 1) * 100))} % out of proportion.`);
      continue;
    }
    const side = b => b < -TOL ? `short by ${r2(-b)} mm per side` : b <= TOL ? 'none' : `${r2(b)} mm`;
    let t = `${im.name}: ${r1(iw)} × ${r1(ih)} mm${p.dpi ? ` at ${num(Math.round(p.dpi))} dpi${im.dpi ? ' (from the file)' : ''}` : ''}, cut ${num(W)} × ${num(H)} mm. Bleed top and bottom: ${side(p.by)}, left and right: ${side(p.bx)}`;
    if (p.bx > TOL && p.by <= TOL || p.by > TOL && p.bx <= TOL || (p.bx <= TOL && p.by <= TOL)) t += extend && B > TOL && p.bx >= -TOL && p.by >= -TOL ? ' (missing bleed filled by repeating the edge pixels)' : '';
    t += '.';
    if (p.bx < -TOL || p.by < -TOL) t += ' The image is smaller than the card: check the card size and the dpi, otherwise a white edge ends up inside the card.';
    if (p.dpi && (p.bx > 6 || p.by > 6)) t += ' Much bigger than the card: check the card size and the dpi.';
    notes.push(t);
    if (Math.abs(W - W0) > 0.01 || Math.abs(H - H0) > 0.01) notes.push('The images have different orientations; the back should match the front.');
  }
  document.getElementById('icInfo').textContent = (src.imgs.length > 1 ? `Front: ${src.imgs[0].name}, back: ${src.imgs[1].name}. ` : '') + notes.join(' ');
  return { bytes: await pdf.save(), bleed: B };
}
let icTimer = null;
function rebuildCardImages() {
  clearTimeout(icTimer);
  icTimer = setTimeout(async () => {
    const src = cards.imgSrc;
    if (!src) return;
    try { const r = await imagesToCardPdf(src); await loadCardPdf(r.bytes, src.name, r.bleed); }
    catch (e) { setCardMsg(`Couldn’t use the image: ${e.message || e}`, true); }
  }, 250);
}
function syncImgRows() {
  const on = !!(isPrintMode() && appMode !== 'winietka' && cards.imgSrc);
  document.getElementById('imgCardRows').hidden = !on;
  const fit = document.getElementById('icFit').value;
  document.getElementById('rowIcDpi').hidden = fit !== 'actual';
  document.getElementById('rowIcExtend').hidden = fit === 'stretch';
  document.getElementById('rowIcSize').hidden = appMode === 'morgana';
  document.getElementById('icSwap').hidden = !on || cards.imgSrc.imgs.length !== 2;
  syncBleedRow();
}
for (const id of ['icW', 'icH', 'icDpi']) document.getElementById(id).addEventListener('input', rebuildCardImages);
document.getElementById('icFit').addEventListener('change', () => { syncImgRows(); rebuildCardImages(); });
document.getElementById('icExtend').addEventListener('change', rebuildCardImages);
document.getElementById('icSwap').addEventListener('click', () => { const s = cards.imgSrc; if (s && s.imgs.length > 1) { s.imgs.reverse(); rebuildCardImages(); } });
document.getElementById('mSize').addEventListener('change', () => { if (appMode === 'morgana' && cards.imgSrc) rebuildCardImages(); });
document.getElementById('cBleed').addEventListener('input', () => { if (cards.imgSrc && document.getElementById('icFit').value === 'stretch') rebuildCardImages(); });
async function loadCardFile(input) {
  const list = Array.from(input && input.length != null ? input : input ? [input] : []);
  const pdfF = list.find(isPdfFile), imgs = list.filter(isImageFile);
  if (!pdfF && imgs.length) {
    setCardMsg('Reading the image…');
    try {
      const max = appMode === 'deck' || appMode === 'guillotine' ? 400 : 2;
      cards.imgSrc = { imgs: [], name: imgs[0].name.replace(/\.[^.]+$/, '') };
      for (const f of imgs.slice(0, max)) cards.imgSrc.imgs.push(await readCardImage(f));
      syncImgRows();
      const r = await imagesToCardPdf(cards.imgSrc); await loadCardPdf(r.bytes, cards.imgSrc.name, r.bleed);
    } catch (e) { cards.imgSrc = null; syncImgRows(); setCardMsg(`Couldn’t use the image: ${e.message || e}`, true); }
    return;
  }
  if (!pdfF) { setCardMsg('Load a PDF or an image file.', true); return; }
  cards.imgSrc = null; syncImgRows();
  setCardMsg('Reading the PDF…');
  try { await loadCardPdf(new Uint8Array(await pdfF.arrayBuffer()), pdfF.name, null); }
  catch (e) { setCardMsg(`Couldn’t read the PDF: ${e.message || e}`, true); }
}
// imgBleed: the bleed of a page built from images (exact, also when it is 0); null for a loaded PDF
async function loadCardPdf(bytes, fileName, imgBleed) {
  const fromImages = imgBleed != null;
  {
    await ensureLibs();
    const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
    const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const p0 = lib.getPage(0), mb = p0.getMediaBox(), tb = p0.getTrimBox();
    cards.pageW = mb.width / PT; cards.pageH = mb.height / PT; cards.mbx = mb.x; cards.mby = mb.y;
    cards.bleed = null;
    if (fromImages) { cards.bleed = Math.round(imgBleed * 1000) / 1000; document.getElementById('cBleed').value = cards.bleed; }
    else if (tb.width < mb.width - 0.5 && tb.height < mb.height - 0.5) {
      cards.bleed = Math.round((mb.width - tb.width) / 2 / PT * 100) / 100;
      document.getElementById('cBleed').value = cards.bleed;
    }
    if (cards.bleed == null && appMode === 'deck') { // no trim box: recognise a standard format plus bleed
      const fmts = [[105, 148], [148, 210], [210, 297], [99, 210], [100, 150], [90, 50], [85, 55], [90, 55]];
      for (const [a, b] of fmts) for (const [fw, fh] of [[a, b], [b, a]]) {
        const bw = (cards.pageW - fw) / 2, bh = (cards.pageH - fh) / 2;
        if (cards.bleed == null && bw >= 0 && bw <= 6 && Math.abs(bw - bh) < 0.3) { cards.bleed = Math.round((bw + bh) / 2 * 10) / 10; document.getElementById('cBleed').value = cards.bleed; }
      }
    }
    cards.pages = appMode === 'deck' || appMode === 'guillotine' ? pdf.numPages : Math.min(pdf.numPages, 2);
    cards.previews = [];
    for (let i = 1; i <= cards.pages; i++) {
      const pg = await pdf.getPage(i), vp = pg.getViewport({ scale: (appMode === 'deck' || cards.pages > 2 ? 5 : 12) / PT }); // px per mm
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      cards.previews.push(cv.toDataURL('image/jpeg', 0.88));
    }
    cards.name = fileName; cards.bytes = bytes;
    if (appMode === 'morgana') { // pick the CardXtra cut size that matches the PDF
      const b = parseFloat(document.getElementById('cBleed').value) || 0;
      const a = Math.max(cards.pageW, cards.pageH) - 2 * b, c = Math.min(cards.pageW, cards.pageH) - 2 * b;
      const hit = [['90x55', 90, 55], ['90x50', 90, 50], ['85x55', 85, 55]].find(([, W, H]) => Math.abs(a - W) < 0.6 && Math.abs(c - H) < 0.6);
      if (hit) document.getElementById('mSize').value = hit[0];
    }
    updateCardInfo();
    if (fromImages) setCardMsg('');
    schedule();
  }
}
function setCardMsg(text, warn) { ui.msg.textContent = text; ui.msg.className = 'msg' + (warn ? ' warn' : ''); }
function updateCardInfo() {
  const el = document.getElementById('cardInfo');
  if (!cards.bytes) { el.textContent = KIND[appMode].hint; return; }
  const o = readOpts(), b = o.cBleed, tw = cards.pageW - 2 * b, th = cards.pageH - 2 * b, sc = pageScale(o);
  el.textContent = `${cards.name}: ${num(Math.round(tw * 10) / 10)} × ${num(Math.round(th * 10) / 10)} mm ${KIND[appMode].one} + ${num(b)} mm bleed${cards.bleed == null ? ' (from the setting, the PDF has no trim box)' : ''}, ${cards.pages > 1 ? 'two-sided' : 'single-sided'}.${Math.abs(sc - 1) > 0.001 ? ` Printed at ${num(Math.round(sc * 1000) / 10)}%: ${num(Math.round(tw * sc * 10) / 10)} × ${num(Math.round(th * sc * 10) / 10)} mm.` : ''}`;
}
// Grid of cards inside the free area. T maps card-page mm (y down, origin at the bleed corner) to sheet mm.
function computeCardLayout(sheet, o) {
  if (!cards.bytes) return null;
  if (appMode === 'morgana') return morganaLayout(o);
  const guil = appMode === 'guillotine' || appMode === 'gang' || appMode === 'deck', sc = pageScale(o), pw = cards.pageW * sc, ph = cards.pageH * sc;
  const b = o.cBleed * sc, tw = pw - 2 * b, th = ph - 2 * b;
  // auto: the gap is the two bleeds (after scaling), so the space between the cuts is fully printed; if a narrower
  // gap (not under 3 mm, still two cuts) fits more copies, the widest such gap is used and the inner bleed trimmed to half of it
  let gap = guil ? (o.gAuto ? 2 * b : o.gGap) : o.cGap;
  let X0, Y0, W, H, e;
  if (guil) {
    // trim + bleed must sit inside the printable sheet; crop marks use whatever room is left
    const ins = o.gMargin + b;
    X0 = ins; Y0 = ins; W = G_PAGE.wMm - 2 * ins; H = G_PAGE.hMm - 2 * ins; e = 0;
    if (o.gAuto && tw > 0 && th > 0) {
      const count = g => Math.max(...[[tw, th], [th, tw]].map(([cw, ch]) => Math.max(0, Math.floor((W + g) / (cw + g))) * Math.max(0, Math.floor((H + g) / (ch + g)))));
      let bestG = gap, bestN = count(gap);
      for (let g = gap - 0.5; g >= Math.min(3, gap) - 1e-9; g -= 0.5) { const nn = count(g); if (nn > bestN) { bestN = nn; bestG = g; } }
      gap = bestG;
    }
  } else {
    if (!sheet || !sheet.free) return null;
    const f = sheet.free;
    X0 = f.x0 * CELL; Y0 = f.y0 * CELL; W = (f.x1 - f.x0 + 1) * CELL; H = (f.y1 - f.y0 + 1) * CELL; e = Math.min(b, gap / 2);
  }
  const inner = Math.min(b, gap / 2), outer = guil ? b : inner;
  const base = { n: 0, items: [], b, tw, th, e, gap, guil, pw, ph, sc };
  if (tw <= 0 || th <= 0 || W <= 0 || H <= 0) return base;
  let best = null;
  for (const rot of [0, 90]) {
    const cw = rot ? th : tw, ch = rot ? tw : th;
    const cols = Math.floor((W - 2 * e + gap) / (cw + gap)), rows = Math.floor((H - 2 * e + gap) / (ch + gap));
    if (cols < 1 || rows < 1) continue;
    if (!best || cols * rows > best.cols * best.rows) best = { rot, cols, rows, cw, ch };
  }
  if (!best) return base;
  const totW = best.cols * best.cw + (best.cols - 1) * gap, totH = best.rows * best.ch + (best.rows - 1) * gap;
  const sx = X0 + (W - totW) / 2, sy = Y0 + (H - totH) / 2, items = [];
  for (let r = 0; r < best.rows; r++) for (let c = 0; c < best.cols; c++) {
    const tx = sx + c * (best.cw + gap), ty = sy + r * (best.ch + gap);
    const l = c === 0 ? outer : inner, rr = c === best.cols - 1 ? outer : inner, t = r === 0 ? outer : inner, bt = r === best.rows - 1 ? outer : inner;
    items.push({
      T: best.rot ? [0, 1, -1, 0, ph + tx - b, ty - b] : [1, 0, 0, 1, tx - b, ty - b],
      trim: [tx, ty, best.cw, best.ch],
      clip: [tx - l, ty - t, best.cw + l + rr, best.ch + t + bt]
    });
  }
  // guillotine: every distinct cut position, measured from the sheet's left and top edges
  const cutsX = [], cutsY = [], addCut = (arr, v) => { if (!arr.some(q => Math.abs(q - v) < 0.01)) arr.push(v); };
  for (let c = 0; c < best.cols; c++) { addCut(cutsX, sx + c * (best.cw + gap)); addCut(cutsX, sx + c * (best.cw + gap) + best.cw); }
  for (let r = 0; r < best.rows; r++) { addCut(cutsY, sy + r * (best.ch + gap)); addCut(cutsY, sy + r * (best.ch + gap) + best.ch); }
  cutsX.sort((a, q) => a - q); cutsY.sort((a, q) => a - q);
  return { ...best, ...base, n: items.length, items, sx, sy, totW, totH, cutsX, cutsY, fx0: X0, fy0: Y0, fx1: X0 + W, fy1: Y0 + H };
}
// Duplex: the back page is the front mirrored across the flip edge, with each card mirrored back
// around its own vertical axis (so the back reads upright), then shifted by the calibration offset.
function sheetMirror(o) { const pg = pageDims(); return o.cFlip === 'short' ? [1, 0, 0, -1, 0, pg.hMm] : [-1, 0, 0, 1, pg.wMm, 0]; }
// an axis-aligned rect (sheet mm) as it lands on the back page
function backRect(rc, o) {
  const pg = pageDims(), [x, y, w, h] = rc;
  return o.cFlip === 'short' ? [x + o.cOffX, pg.hMm - y - h + o.cOffY, w, h] : [pg.wMm - x - w + o.cOffX, y + o.cOffY, w, h];
}
// Crop marks on each side, fitted into the room between the trim and the sheet edge:
// the offset shrinks (down to the bleed) so at least part of the mark is printable.
function markSide(L, o, space) {
  const avail = space - o.gMargin;
  const off = Math.max(L.b, Math.min(o.gMarkOff, avail - 1.5)), end = Math.min(off + o.gMarkLen, space);
  return end - off >= 0.5 ? { off, end, printable: Math.max(0, Math.min(end, avail) - off) } : null;
}
function cropMarks(L, o) { // [[x1,y1,x2,y2]...] in sheet mm
  const x0 = L.sx, y0 = L.sy, x1 = L.sx + L.totW, y1 = L.sy + L.totH, out = [];
  const T = markSide(L, o, y0), B = markSide(L, o, G_PAGE.hMm - y1), Lf = markSide(L, o, x0), R = markSide(L, o, G_PAGE.wMm - x1);
  for (const x of L.cutsX) { if (T) out.push([x, y0 - T.end, x, y0 - T.off]); if (B) out.push([x, y1 + B.off, x, y1 + B.end]); }
  for (const y of L.cutsY) { if (Lf) out.push([x0 - Lf.end, y, x0 - Lf.off, y]); if (R) out.push([x1 + R.off, y, x1 + R.end, y]); }
  return out;
}
function backMatrix(T, o) {
  const S = [-1, 0, 0, 1, cards.layout ? cards.layout.pw : cards.pageW, 0];
  return mul([1, 0, 0, 1, o.cOffX, o.cOffY], mul(sheetMirror(o), mul(T, S)));
}
const cardTrim = (L, o) => roundRect(L.b, L.b, L.tw, L.th, o.cRadius);
// Voucher fold: a perforation across the long side (dashes, with uncut gaps at both edges), in card-page mm.
function cardFoldLines(L, o) {
  if ((appMode !== 'vouchers' && appMode !== 'winietka') || o.cFold !== 'perf' || !L) return [];
  // the fold runs across the longer side (square cards: horizontally, like a tent card), unless set
  const vert = o.cFoldDir === 'v' ? true : o.cFoldDir === 'h' ? false : L.tw > L.th + 0.01, len = vert ? L.th : L.tw, along = vert ? L.tw : L.th;
  const pos = o.cFoldPos > 0 && o.cFoldPos < along ? o.cFoldPos : along / 2;
  const cut = o.cPerfCut, gap = o.cPerfGap, n = Math.floor((len - gap) / (cut + gap));
  if (n < 1) return [];
  const start = (len - (n * cut + (n - 1) * gap)) / 2, segs = [];
  for (let i = 0; i < n; i++) {
    const a = start + i * (cut + gap), b = a + cut;
    segs.push(vert ? [[L.b + pos, L.b + a], [L.b + pos, L.b + b]] : [[L.b + a, L.b + pos], [L.b + b, L.b + pos]]);
  }
  return segs;
}
function cardSheetFolds() {
  const L = cards.layout, f = cardFoldLines(L, readOpts());
  return L.items.flatMap(it => f.map(sg => sg.map(p => apply(it.T, p))));
}
// Grid cutting: straight lines through every card edge, running across the free area (the sheet border
// stays whole, so it keeps feeding). Only for square corners.
const gridCut = o => (appMode === 'cards' || appMode === 'vouchers' || appMode === 'winietka') && o.cCutStyle === 'grid' && !(o.cRadius > 0);
// Cut order: after the start mark (bottom right), vertical lines from right to left, the first going up,
// then alternating. Horizontal lines start on the side where the verticals ended (top or bottom),
// the first going left to right, then alternating.
function cardGridLines() {
  const L = cards.layout;
  const xs = L.cutsX.slice().sort((a, b) => b - a);
  const v = xs.map((x, i) => i % 2 ? [[x, L.fy0], [x, L.fy1]] : [[x, L.fy1], [x, L.fy0]]);
  const endTop = xs.length % 2 === 1;
  const ys = L.cutsY.slice().sort((a, b) => endTop ? a - b : b - a);
  const h = ys.map((y, i) => i % 2 ? [[L.fx1, y], [L.fx0, y]] : [[L.fx0, y], [L.fx1, y]]);
  return { v: Object.assign(v, { ordered: true }), h: Object.assign(h, { ordered: true }) };
}
function cardSheetLoops() {
  const L = cards.layout, o = readOpts();
  if (gridCut(o)) return [];
  const trim = cardTrim(L, o);
  return L.items.map(it => trim.map(p => apply(it.T, p)));
}
// Perforated die cut (business cards): the cut lines become cuts with uncut bridges, so the sheet holds together
// without a cutting mat. Business cards only for now.
const perfDie = o => (appMode === 'cards' || appMode === 'winietka') && o.cPerfDie;
// Every card cut line on the sheet, in sheet mm, the way it is cut:
// loops (closed outlines), folds (fold perforation), v and h (grid lines, cut in this exact order),
// dashes (perforated outlines, any order).
function cardCuts() {
  const o = readOpts(), L = cards.layout, grid = gridCut(o), folds = cardSheetFolds();
  const gl = grid ? cardGridLines() : { v: [], h: [] };
  if (!perfDie(o)) return { loops: cardSheetLoops(), folds, v: gl.v, h: gl.h, dashes: [] };
  const opens = list => list.flatMap(d => d.closed ? [d.pts.concat([d.pts[0]])] : [d.pts]);
  const tieOpts = { place: o.cTiePlace, inset: o.cTieInset };
  if (grid) {
    // split each grid line at the lines crossing it, so bridges stay off the card corners
    const through = (ln, cross, k) => {
      const [a, b] = ln, lo = Math.min(a[k], b[k]), hi = Math.max(a[k], b[k]), up = b[k] > a[k];
      const mids = cross.filter(c => c > lo + 1e-6 && c < hi - 1e-6).sort((x, y) => up ? x - y : y - x);
      const pts = [a, ...mids.map(c => k ? [a[0], c] : [c, a[1]]), b];
      return opens(perforate(pts, false, o.cTieCut, o.cTie, true, tieOpts));
    };
    const v = gl.v.flatMap(ln => through(ln, L.cutsY, 1)), h = gl.h.flatMap(ln => through(ln, L.cutsX, 0));
    return { loops: [], folds, v: Object.assign(v, { ordered: true }), h: Object.assign(h, { ordered: true }), dashes: [] };
  }
  return { loops: [], folds, v: [], h: [], dashes: opens(cardSheetLoops().flatMap(l => perforate(l, true, o.cTieCut, o.cTie, false, tieOpts))) };
}
function syncPerfDie() {
  const on = appMode === 'cards' || appMode === 'winietka';
  document.getElementById('perfDie').hidden = !on;
  document.getElementById('perfDieRows').hidden = !on || !document.getElementById('cPerfDie').checked;
  const corners = document.getElementById('cTiePlace').value === 'corners';
  document.getElementById('rowTieInset').hidden = !corners;
  document.getElementById('rowTieCut').hidden = corners;
}
document.getElementById('cPerfDie').addEventListener('change', syncPerfDie);
document.getElementById('cTiePlace').addEventListener('change', syncPerfDie);
function renderCardPreview() {
  const t = template, o = readOpts(), L = cards.layout, back = document.getElementById('showBack').checked && cards.pages > 1 && !(deckLike() && deckPer() === 1);
  const deck = deckLike(), win = appMode === 'winietka', guil = appMode === 'guillotine' || deck, morg = appMode === 'morgana';
  const p = [];
  if (guil || morg) {
    const pg = pageDims();
    previewFrame = { x: -8, y: -8, w: pg.wMm + 16, h: pg.hMm + 16 };
    p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${previewFrame.x} ${previewFrame.y} ${previewFrame.w} ${previewFrame.h}" role="img" aria-label="${back ? 'Back' : 'Front'} of the sheet">`);
    p.push(`<rect x="0" y="0" width="${pg.wMm}" height="${pg.hMm}" fill="#fff"/><g>`);
    if (guil && !back) { const m = o.gMargin; p.push(`<rect x="${m}" y="${m}" width="${G_PAGE.wMm - 2 * m}" height="${G_PAGE.hMm - 2 * m}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`); }
    if (morg) { const k = M_TPL.mark; p.push(`<rect x="${k[0]}" y="${k[1]}" width="${k[2]}" height="${k[3]}" fill="#000"/>`); }
  } else {
    p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${t.vb.x} ${t.vb.y} ${t.vb.w} ${t.vb.h}" role="img" aria-label="${back ? 'Back' : 'Front'} of the sheet">`);
    p.push(`<rect x="${t.vb.x}" y="${t.vb.y}" width="${t.vb.w}" height="${t.vb.h}" fill="#fff"/>`);
    if (!back) p.push(`<g>${t.inner.replace(SLOT_RE, '')}</g>`);
    p.push(`<g transform="translate(${t.vb.x} ${t.vb.y}) scale(${t.u})">`);
    if (!back && sheetCache && sheetCache.free) {
      const f = sheetCache.free;
      p.push(`<rect x="${f.x0 * CELL}" y="${f.y0 * CELL}" width="${(f.x1 - f.x0 + 1) * CELL}" height="${(f.y1 - f.y0 + 1) * CELL}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`);
    }
  }
  if (L && L.n) {
    const img = cards.previews[back ? 1 : 0];
    const trimD = 'M' + cardTrim(L, o).map(q => num(q[0]) + ' ' + num(q[1])).join('L') + 'Z';
    const foldD = cardFoldLines(L, o).map(sg => `M${num(sg[0][0])} ${num(sg[0][1])}L${num(sg[1][0])} ${num(sg[1][1])}`).join('');
    const multi = deck || win, dk = deck ? deckPlan(o) : null, used = new Map(), shIdx = multi ? +document.getElementById(deck ? 'deckSheet' : 'winSheet').value || 0 : 0;
    // deck: page per card side; winietki: one file/page per slot
    const slotKey = j => {
      if (deck) { const c = deckCard(dk, shIdx, j), pi = c == null ? -1 : deckPer() * c + (back ? 1 : 0); return cards.previews[pi] ? [pi, cards.previews[pi]] : null; }
      const k = winItem(shIdx, j); return k == null ? null : [k, cards.items[k].preview];
    };
    if (multi) L.items.forEach((it, j) => { const s = slotKey(j); if (s) used.set(s[0], s[1]); });
    p.push(`<defs>${multi ? [...used].map(([k, url]) => `<g id="dimg${k}"><image href="${url}" x="0" y="0" width="${num(L.pw)}" height="${num(L.ph)}" preserveAspectRatio="none"/></g>`).join('') : `<g id="cimg"><image href="${img}" x="0" y="0" width="${num(L.pw)}" height="${num(L.ph)}" preserveAspectRatio="none"/></g>`}</defs>`);
    L.items.forEach((it, i) => {
      const Mi = back ? backT(it, o) : it.T, cr = back ? backClip(it, o) : it.clip;
      let ref = '#cimg';
      if (multi) { const s = slotKey(i); ref = s ? `#dimg${s[0]}` : null; }
      if (ui.showArt.checked && ref) p.push(`<clipPath id="cc${i}"><rect x="${num(cr[0])}" y="${num(cr[1])}" width="${num(cr[2])}" height="${num(cr[3])}"/></clipPath><g clip-path="url(#cc${i})"><use href="${ref}" transform="matrix(${Mi.map(num).join(',')})"/></g>`);
      // on the back, show where the cut actually lands (mirror only, no print shift)
      const Mc = back ? mul(sheetMirror(o), it.T) : it.T;
      if (guil || morg) {
        const tr = back ? (it.btrim || backRect(it.trim, { ...o, cOffX: 0, cOffY: 0 })) : it.trim;
        p.push(`<rect x="${num(tr[0])}" y="${num(tr[1])}" width="${num(tr[2])}" height="${num(tr[3])}" fill="none" stroke="${CUT_RED}" stroke-width="1.1" vector-effect="non-scaling-stroke"/>`);
      } else {
        if (!gridCut(o) && !perfDie(o)) p.push(`<path d="${trimD}" transform="matrix(${Mc.map(num).join(',')})" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"${back ? ' stroke-dasharray="5 3"' : ''}/>`);
        if (foldD) p.push(`<path d="${foldD}" transform="matrix(${Mc.map(num).join(',')})" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      }
    });
    if (perfDie(o)) {
      // perforated: the cuts as they will be made, bridges left out
      const c = cardCuts(), Ms = back ? sheetMirror(o) : [1, 0, 0, 1, 0, 0];
      p.push(`<path d="${[...c.v, ...c.h, ...c.dashes].map(l => 'M' + l.map(q => num(q[0]) + ' ' + num(q[1])).join('L')).join('')}" transform="matrix(${Ms.map(num).join(',')})" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
    } else if (gridCut(o)) {
      const gl = cardGridLines(), Ms = back ? sheetMirror(o) : [1, 0, 0, 1, 0, 0];
      p.push(`<path d="${[...gl.v, ...gl.h].map(l => `M${num(l[0][0])} ${num(l[0][1])}L${num(l[1][0])} ${num(l[1][1])}`).join('')}" transform="matrix(${Ms.map(num).join(',')})" fill="none" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"${back ? ' stroke-dasharray="5 3"' : ''}/>`);
    }
    if (guil && (!back || o.gMarksBack)) p.push(`<path d="${(back ? backMarks(L, o) : cropMarks(L, o)).map(m => `M${num(m[0])} ${num(m[1])}L${num(m[2])} ${num(m[3])}`).join('')}" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
  }
  p.push('</g></svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderCardStats(busyText) {
  const n = cards.layout ? cards.layout.n : 0;
  ui.dropNote.hidden = !!cards.bytes;
  for (const id of ['exCardPdf', 'exCardCut']) document.getElementById(id).disabled = !n || !!busyText;
  const guil = appMode === 'guillotine' || appMode === 'morgana' || appMode === 'deck';
  document.getElementById('exCardCut').hidden = guil; document.getElementById('exCardPlt').hidden = guil; document.getElementById('exCardCutPdf').hidden = guil;
  document.getElementById('exCardCutPdf').disabled = !n || !!busyText;
  document.getElementById('exCardPlt').disabled = !n || !!busyText || !(template && template.marks);
  if (busyText) { ui.count.textContent = busyText; return; }
  const K = KIND[appMode];
  ui.count.textContent = !cards.bytes ? `No ${K.many} loaded` : appMode === 'guillotine' && deckLike() && n ? (dkx => `${dkx.total} cards on ${dkx.sheets} ${dkx.sheets === 1 ? 'sheet' : 'sheets'}`)(deckPlan(readOpts())) : appMode === 'winietka' && n ? (wpx => `${wpx.total} ${wpx.total === 1 ? 'card' : 'cards'} on ${wpx.sheets} ${wpx.sheets === 1 ? 'sheet' : 'sheets'}`)(winPlan(readOpts())) : n === 1 ? `1 ${K.one} on the sheet` : `${n} ${K.many} on the sheet`;
  const notes = [];
  if (cards.bytes && cards.layout) {
    if (n) notes.push(`${cards.layout.cols} × ${cards.layout.rows}${cards.layout.rot ? ', rotated' : ''}.`);
    else if (!cards.layout.error) notes.push(`The ${K.one} doesn’t fit in the free area.`);
    if (cards.layout.error) notes.push(cards.layout.error);
    if (n && perfDie(readOpts())) {
      const c = cardCuts(), oo = readOpts(), cuts = c.v.length + c.h.length + c.dashes.length;
      notes.push(`Perforated die cut: ${cuts} cuts with ${num(oo.cTie)} mm bridges ${oo.cTiePlace === 'corners' ? `${num(oo.cTieInset)} mm from the corners` : 'along the edges'}, so the sheet holds together without a mat.`);
    }
    { const oo = readOpts(); if (cards.pages > 1 && (oo.cOffX || oo.cOffY)) notes.push(`The back side is shifted by X ${num(oo.cOffX)} mm, Y ${num(oo.cOffY)} mm (Back side shift).`); }
    if (cards.pages < 2 && appMode !== 'winietka') notes.push('The PDF has one page, so the sheet is single-sided.');
    if (n && appMode === 'winietka') {
      const wp = winPlan(readOpts()), odd = cards.items.filter(c => Math.abs(c.w - cards.items[0].w) > 1.5 || Math.abs(c.h - cards.items[0].h) > 1.5).length;
      notes.unshift(`${wp.items} ${wp.items === 1 ? 'card' : 'cards'}${wp.copies > 1 ? ` × ${wp.copies}` : ''} = ${wp.total} on ${wp.sheets} ${wp.sheets === 1 ? 'sheet' : 'sheets'} (${n} per sheet), single-sided. Every sheet is cut with the same PLT.`);
      if (odd) notes.push(`${odd} ${odd === 1 ? 'card has' : 'cards have'} a different page size than the first and ${odd === 1 ? 'is' : 'are'} stretched to fit.`);
      const sel = document.getElementById('winSheet'), cur = sel.value;
      sel.innerHTML = Array.from({ length: Math.max(1, wp.sheets) }, (_, i) => `<option value="${i}">Sheet ${i + 1} of ${Math.max(1, wp.sheets)}</option>`).join('');
      sel.value = +cur < wp.sheets ? cur : '0';
    }
    if (n && deckLike()) {
      const dk = deckPlan(readOpts());
      notes.unshift(deckPer() === 1
        ? `${dk.cards} ${dk.cards === 1 ? 'card' : 'cards'} (one per page)${dk.sets > 1 ? ` × ${dk.sets} sets` : ''} = ${dk.total} on ${dk.sheets} ${dk.sheets === 1 ? 'sheet' : 'sheets'}, one-sided.`
        : `${dk.cards} ${dk.cards === 1 ? 'card' : 'cards'} per set (${cards.pages} pages${cards.pages % 2 ? ', the last back is blank' : ''}), ${dk.sets} sets: ${dk.sheets} ${dk.sheets === 1 ? 'sheet' : 'sheets'}, double-sided.`);
      notes.push(dk.order === 'stack' ? 'Cut the whole pile, then stack the piles in slot order (left to right, top to bottom): you get complete sets in order.' : 'Each sheet carries one card; collate the piles by card.');
      const sel = document.getElementById('deckSheet'), cur = sel.value;
      sel.innerHTML = Array.from({ length: dk.sheets }, (_, i) => `<option value="${i}">Sheet ${i + 1} of ${dk.sheets}</option>`).join('');
      sel.value = +cur < dk.sheets ? cur : '0';
    }
    if (n && (appMode === 'guillotine' || appMode === 'deck')) {
      const L = cards.layout, f = v => num(Math.round(v * 10) / 10), oo = readOpts();
      const sides = [['top', markSide(L, oo, L.sy)], ['bottom', markSide(L, oo, G_PAGE.hMm - L.sy - L.totH)], ['left', markSide(L, oo, L.sx)], ['right', markSide(L, oo, G_PAGE.wMm - L.sx - L.totW)]];
      const weak = sides.filter(([, m]) => !m || m.printable < 1).map(([nm]) => nm);
      if (weak.length) notes.push(`Not enough room for printable crop marks at the ${weak.join(' and ')}; use the cut positions below or lower the unprintable edge if your printer allows.`);
      notes.push(`Cuts from the left edge: ${L.cutsX.map(f).join(', ')} mm. From the top: ${L.cutsY.map(f).join(', ')} mm.`);
    }
  }
  setCardMsg(notes.join(' '), !n && !!cards.bytes);
  updateCardInfo();
}
// Template drawing as plain shapes in sheet mm (for the PDF): needs the live DOM.
function templateShapes() {
  const t = template;
  let host = null;
  try {
    const doc = parseSvg(t.text); sanitize(doc);
    host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none';
    const svg = document.importNode(doc.documentElement, true);
    svg.setAttribute('width', '1000'); svg.setAttribute('height', '1000');
    host.appendChild(svg); document.body.appendChild(host);
    const inv = svg.getScreenCTM().inverse(), out = [];
    for (const el of svg.querySelectorAll(SHAPES)) {
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const m = inv.multiply(el.getScreenCTM());
      const tp = (x, y) => [((m.a * x + m.c * y + m.e) - t.vb.x) / t.u, ((m.b * x + m.d * y + m.f) - t.vb.y) / t.u];
      const at = n => parseFloat(el.getAttribute(n)) || 0;
      let pts = [], closed = true;
      if (el.localName === 'rect') { const x = at('x'), y = at('y'), w = at('width'), h = at('height'); pts = [tp(x, y), tp(x + w, y), tp(x + w, y + h), tp(x, y + h)]; }
      else if (el.localName === 'polyline' || el.localName === 'polygon') {
        const a = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i + 1 < a.length; i += 2) pts.push(tp(a[i], a[i + 1]));
        closed = el.localName === 'polygon';
      } else if (el.localName === 'line') { pts = [tp(at('x1'), at('y1')), tp(at('x2'), at('y2'))]; closed = false; }
      else {
        const len = el.getTotalLength(), n = Math.max(8, Math.ceil(len / 0.5));
        for (let i = 0; i <= n; i++) { const q = el.getPointAtLength(len * i / n); pts.push(tp(q.x, q.y)); }
        closed = el.localName !== 'path' || /z\s*$/i.test(el.getAttribute('d') || '');
      }
      const sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) / t.u;
      const fill = cs.fill && cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0 ? cs.fill : null;
      const stroke = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeOpacity || '1') > 0 ? cs.stroke : null;
      if (pts.length > 1 && (fill || stroke)) out.push({ pts, closed, fill, stroke, sw: (parseFloat(cs.strokeWidth) || 1) * sc });
    }
    return out;
  } finally {
    if (host) host.remove();
  }
}
const cssRgb = c => {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
  if (h) { const x = h[1].length === 3 ? h[1].split('').map(ch => ch + ch).join('') : h[1]; return window.PDFLib.rgb(parseInt(x.slice(0, 2), 16) / 255, parseInt(x.slice(2, 4), 16) / 255, parseInt(x.slice(4, 6), 16) / 255); }
  const m = String(c).match(/[\d.]+/g) || [0, 0, 0];
  return window.PDFLib.rgb(+m[0] / 255, +m[1] / 255, +m[2] / 255);
};
async function buildCardsPdf() {
  await ensureLibs();
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, drawObject } = window.PDFLib;
  const o = readOpts(), t = pageDims(), L = cards.layout, guil = appMode === 'guillotine', morg = appMode === 'morgana';
  const src = await PDFDocument.load(cards.bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const emb = await out.embedPdf(src, cards.pages > 1 ? [0, 1] : [0]);
  const Wpt = t.wMm * PT, Hpt = t.hMm * PT, ph = L.ph, sc = L.sc;
  const F = [PT, 0, 0, -PT, 0, Hpt];                                                   // sheet mm (y down) -> PDF points
  const G = [sc / PT, 0, 0, -sc / PT, -cards.mbx * sc / PT, ph + cards.mby * sc / PT];   // card page points -> card mm (y down), scaled
  // each copy is clipped to its own rect on the sheet (trim plus the bleed it may keep), then drawn
  const place = (page, e, list) => {
    const name = page.node.newXObject('Card', e.ref);
    for (const { T, rc } of list) {
      const M = mul(F, mul(T, G));
      page.pushOperators(pushGraphicsState(), rectangle(rc[0] * PT, Hpt - (rc[1] + rc[3]) * PT, rc[2] * PT, rc[3] * PT), clip(), endPath(),
        concatTransformationMatrix(...M), drawObject(name), popGraphicsState());
    }
  };
  const front = printPage(out, Wpt, Hpt);
  if (guil) {
    const black = window.PDFLib.rgb(0, 0, 0);
    for (const m of cropMarks(L, o)) front.drawLine({ start: { x: m[0] * PT, y: Hpt - m[1] * PT }, end: { x: m[2] * PT, y: Hpt - m[3] * PT }, thickness: 0.25, color: black });
  }
  const drawMark = pg => { const k = M_TPL.mark; pg.drawRectangle({ x: k[0] * PT, y: Hpt - (k[1] + k[3]) * PT, width: k[2] * PT, height: k[3] * PT, color: window.PDFLib.rgb(0, 0, 0) }); };
  if (morg) drawMark(front);
  if (!guil && !morg) for (const sh of templateShapes()) {
    const d = 'M ' + sh.pts.map(q => `${(q[0] * PT).toFixed(3)} ${(q[1] * PT).toFixed(3)}`).join(' L ') + (sh.closed ? ' Z' : '');
    const opt = { x: 0, y: Hpt };
    if (sh.fill) opt.color = cssRgb(sh.fill);
    if (sh.stroke) { opt.borderColor = cssRgb(sh.stroke); opt.borderWidth = sh.sw * PT; }
    front.drawSvgPath(d, opt);
  }
  place(front, emb[0], L.items.map(it => ({ T: it.T, rc: it.clip })));
  if (emb[1]) {
    const back = printPage(out, Wpt, Hpt); if (morg) drawMark(back); place(back, emb[1], L.items.map(it => ({ T: backT(it, o), rc: backClip(it, o) })));
    if (appMode === 'guillotine' && o.gMarksBack) for (const m of backMarks(L, o)) back.drawLine({ start: { x: m[0] * PT, y: Hpt - m[1] * PT }, end: { x: m[2] * PT, y: Hpt - m[3] * PT }, thickness: 0.25, color: window.PDFLib.rgb(0, 0, 0) });
  }
  out.setTitle(`${KIND[appMode].title}, ${L.n} pcs`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
function buildCardCutSvg() {
  const t = template, o = readOpts(), u = t.u;
  const s = ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n', t.open.replace(/\s+xmlns:xlink="[^"]*"/g, '') + '\n', t.inner.replace(SLOT_RE, '') + '\n'];
  s.push(`<g id="${aiId(o.dieLayer)}">\n`);
  const st = `fill:none;stroke:${o.dieColor};stroke-width:${num(o.lineW * u)}`, doc = q => [q[0] * u + t.vb.x, q[1] * u + t.vb.y];
  const c = cardCuts();
  for (const loop of c.loops) s.push(pathEl(loop.map(doc), true, st) + '\n');
  for (const ln of [...c.folds, ...c.v, ...c.h, ...c.dashes]) s.push(pathEl(ln.map(doc), false, st) + '\n');
  s.push('</g>\n</svg>\n');
  return s.join('');
}
// A print page whose content covers the whole sheet: a white background over the full page, plus two
// near-white specks at the top corners when there's a blank feed strip. Printers that position the page by
// its content (and centre it) then keep the layout where it is, blank strip included.
function printPage(doc, Wpt, Hpt) {
  const page = doc.addPage([Wpt, Hpt]), { rgb } = window.PDFLib;
  page.drawRectangle({ x: 0, y: 0, width: Wpt, height: Hpt, color: rgb(1, 1, 1) });
  if (template && template.feedTop && Math.abs(Wpt - template.wMm * PT) < 1 && Math.abs(Hpt - template.hMm * PT) < 1) {
    for (const x of [3, template.wMm - 3.3]) page.drawRectangle({ x: x * PT, y: Hpt - 3.3 * PT, width: 0.3 * PT, height: 0.3 * PT, color: rgb(0.985, 0.985, 0.985) });
  }
  return page;
}
/* ---------- card deck: a multi-page PDF as double-sided cards, many sets ---------- */
function deckPlan(o) {
  const L = cards.layout, N = L ? L.n : 0, nCards = Math.ceil(cards.pages / deckPer()), sets = appMode === 'deck' ? o.deckSets : o.gEachSets, total = nCards * sets;
  if (!N) return { N: 0, cards: nCards, sets, total, sheets: 0, order: o.deckOrder };
  if (o.deckOrder === 'card') { const per = Math.ceil(sets / N); return { N, cards: nCards, sets, total, per, sheets: per * nCards, order: 'card' }; }
  return { N, cards: nCards, sets, total, sheets: Math.ceil(total / N), order: 'stack' };
}
// which card (0-based) sits in slot j of sheet i, or null for an empty slot
function deckCard(dk, i, j) {
  if (!dk || !dk.N) return null;
  if (dk.order === 'card') { const c = Math.floor(i / dk.per), left = dk.sets - (i % dk.per) * dk.N; return c < dk.cards && j < left ? c : null; }
  const idx = j * dk.sheets + i; // cut & stack: pile j holds items j*S … j*S+S-1, piles stacked in slot order give the sets in order
  return idx < dk.total ? idx % dk.cards : null;
}
async function buildDeckPdf() {
  await ensureLibs();
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, drawObject, rgb } = window.PDFLib;
  const o = readOpts(), L = cards.layout, dk = deckPlan(o), pg = pageDims();
  const src = await PDFDocument.load(cards.bytes, { ignoreEncryption: true }), out = await PDFDocument.create();
  const emb = await out.embedPdf(src, Array.from({ length: cards.pages }, (_, i) => i));
  const Wpt = pg.wMm * PT, Hpt = pg.hMm * PT, ph = L.ph, sc = L.sc;
  const F = [PT, 0, 0, -PT, 0, Hpt], G = [sc / PT, 0, 0, -sc / PT, -cards.mbx * sc / PT, ph + cards.mby * sc / PT];
  const marks = cropMarks(L, o), black = rgb(0, 0, 0);
  for (let i = 0; i < dk.sheets; i++) {
    setCardMsg(`Sheet ${i + 1} of ${dk.sheets}…`);
    await tick();
    for (const back of deckPer() === 2 ? [false, true] : [false]) {
      const page = printPage(out, Wpt, Hpt), names = new Map();
      L.items.forEach((it, j) => {
        const c = deckCard(dk, i, j), pi = c == null ? -1 : deckPer() * c + (back ? 1 : 0);
        if (pi < 0 || pi >= cards.pages) return; // empty slot, or the blank back of an odd last page
        if (!names.has(pi)) names.set(pi, page.node.newXObject(`P${pi}`, emb[pi].ref));
        const T = back ? backT(it, o) : it.T, rc = back ? backClip(it, o) : it.clip, M = mul(F, mul(T, G));
        page.pushOperators(pushGraphicsState(), rectangle(rc[0] * PT, Hpt - (rc[1] + rc[3]) * PT, rc[2] * PT, rc[3] * PT), clip(), endPath(),
          concatTransformationMatrix(...M), drawObject(names.get(pi)), popGraphicsState());
      });
      if (!back || o.gMarksBack) for (const m of back ? backMarks(L, o) : marks) page.drawLine({ start: { x: m[0] * PT, y: Hpt - m[1] * PT }, end: { x: m[2] * PT, y: Hpt - m[3] * PT }, thickness: 0.25, color: black });
    }
  }
  out.setTitle(appMode === 'deck' ? `Card deck, ${dk.sets} sets` : `Guillotine, ${dk.total} cards`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
/* ---------- winietki: many different single-sided cards, print + straight-line cut ---------- */
function winPlan(o) {
  const L = cards.layout, N = L ? L.n : 0, items = (cards.items || []).length, copies = Math.max(1, Math.round(o.winCopies || 1)), total = items * copies;
  return { N, items, copies, total, sheets: N ? Math.ceil(total / N) : 0 };
}
// which file/page sits in slot j of sheet s (copies of one card next to each other), or null
function winItem(s, j) {
  const wp = winPlan(readOpts()), k = s * wp.N + j;
  return wp.N && k < wp.total ? Math.floor(k / wp.copies) : null;
}
// Add every page of a PDF as a winietka. labels: names for the pages (else file name + page);
// bleed: the exact bleed of generated pages (else read from the trim box).
async function winIngest(bytes, fileName, { labels = null, bleed = null } = {}) {
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
  const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  for (let i = 0; i < pdf.numPages; i++) {
    const lp = lib.getPage(i), mb = lp.getMediaBox(), tb = lp.getTrimBox();
    if (!cards.items.length) { // the first card sets the size and the bleed
      cards.pageW = mb.width / PT; cards.pageH = mb.height / PT; cards.mbx = mb.x; cards.mby = mb.y; cards.bleed = null;
      if (bleed != null) cards.bleed = bleed;
      else if (tb.width < mb.width - 0.5 && tb.height < mb.height - 0.5) cards.bleed = Math.round((mb.width - tb.width) / 2 / PT * 100) / 100;
      if (cards.bleed != null) document.getElementById('cBleed').value = cards.bleed;
    }
    const pg = await pdf.getPage(i + 1), vp = pg.getViewport({ scale: 6 / PT });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    cards.items.push({ name: labels ? labels[i] : pdf.numPages > 1 ? `${fileName} p.${i + 1}` : fileName, bytes, page: i, w: mb.width, h: mb.height, mbx: mb.x, mby: mb.y, preview: cv.toDataURL('image/jpeg', 0.85) });
    cv.width = cv.height = 1;
    if (i % 20 === 19) await tick();
  }
}
async function winAddFiles(list) {
  if (document.getElementById('winSrc').value === 'names') { setCardMsg('Switch “Cards from” to PDF files to add PDFs.', true); return; }
  const files = Array.from(list || []).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) { setCardMsg('Load PDF files (one card per page, with bleed).', true); return; }
  setCardMsg('Reading the PDFs…');
  try {
    await ensureLibs();
    cards.items = cards.items || [];
    for (const f of files) await winIngest(new Uint8Array(await f.arrayBuffer()), f.name);
    winSync();
  } catch (e) {
    setCardMsg(`Couldn’t read the PDF: ${e.message || e}`, true);
  }
}

/* ---------- winietki from a list of names ---------- */
const winNames = { bg: null, bgName: '', fontFile: null, fontName: '', timer: null, gen: 0 };
try { document.getElementById('winNames').value = localStorage.getItem('stickerSheet.winNames') || ''; } catch (e) { /* storage unavailable */ }
const winNamesOn = () => appMode === 'winietka' && document.getElementById('winSrc').value === 'names';
// the fold as the names see it (same rules as cardFoldLines), in card mm
function winFold(o, W, H) {
  if (o.cFold !== 'perf') return null;
  const vert = o.cFoldDir === 'v' ? true : o.cFoldDir === 'h' ? false : W > H + 0.01, along = vert ? W : H;
  return { dir: vert ? 'v' : 'h', pos: o.cFoldPos > 0 && o.cFoldPos < along ? o.cFoldPos : along / 2 };
}
// The "Bleed in the PDF" field is hidden where the bleed is known exactly: card images in 100 % / fit mode
// (the bleed comes from the image) and winietki from names (2 mm with a background, none without).
function syncBleedRow() {
  const img = isPrintMode() && appMode !== 'winietka' && cards.imgSrc && document.getElementById('icFit').value !== 'stretch';
  document.getElementById('cBleed').closest('.row').hidden = !!img || winNamesOn();
}
function syncWinRows() {
  const names = document.getElementById('winSrc').value === 'names';
  document.getElementById('winPdfRows').hidden = names;
  document.getElementById('winNameRows').hidden = !names;
  document.getElementById('rowWinFontFile').hidden = document.getElementById('winFont').value !== 'custom';
  document.getElementById('winBgClear').hidden = !winNames.bg;
  syncBleedRow();
}
async function winBuildNames() {
  const my = ++winNames.gen, o = readOpts(), list = parseNames(document.getElementById('winNames').value);
  try { localStorage.setItem('stickerSheet.winNames', document.getElementById('winNames').value); } catch (e) { /* storage unavailable */ }
  const info = document.getElementById('winNamesInfo');
  info.textContent = list.length ? `${list.length} ${list.length === 1 ? 'name' : 'names'}.` : 'Type or paste the names, one per line.';
  if (!list.length) { cards.items = []; winSync(); return; }
  if (o.winFont === 'custom' && !winNames.fontFile) { info.textContent += ' Load a font file, or pick one of the fonts.'; return; }
  setCardMsg('Setting the names…');
  try {
    const W = o.winW, H = o.winH;
    const r = await buildNameCardsPdf({ names: list, W, H, bg: winNames.bg, font: o.winFont, fontFile: winNames.fontFile, size: o.winSize, color: o.winColor, fold: winFold(o, W, H), both: o.winBoth });
    if (my !== winNames.gen) return;
    const items = [], saved = cards.items;
    cards.items = items;
    try { await winIngest(r.bytes, 'names', { labels: list, bleed: r.bleed }); }
    catch (e) { cards.items = saved; throw e; }
    if (my !== winNames.gen) return;
    if (r.shrunk) info.textContent += ` ${r.shrunk} long ${r.shrunk === 1 ? 'name was' : 'names were'} set smaller to fit.`;
    winSync();
  } catch (e) { setCardMsg(`Couldn’t make the cards: ${e.message || e}`, true); }
}
function winNamesChanged() {
  syncWinRows();
  if (!winNamesOn()) return;
  clearTimeout(winNames.timer);
  winNames.timer = setTimeout(winBuildNames, 350);
}
for (const id of ['winNames', 'winW', 'winH', 'winSize', 'winColor', 'winBoth', 'winFont', 'cFoldOn', 'cFoldDir', 'cFoldPos'])
  document.getElementById(id).addEventListener(id === 'winNames' || id === 'winW' || id === 'winH' || id === 'winSize' || id === 'cFoldPos' ? 'input' : 'change', winNamesChanged);
document.getElementById('winSrc').addEventListener('change', () => { cards.items = []; winSync(); winNamesChanged(); });
document.getElementById('winBg').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') winNames.bg = { kind: 'pdf', bytes: new Uint8Array(await f.arrayBuffer()), page: 0 };
    else { const im = await readCardImage(f); winNames.bg = { kind: im.kind, bytes: im.bytes }; }
    winNames.bgName = f.name;
    document.getElementById('winBgInfo').textContent = `Background: ${f.name}. It fills each card plus 2 mm bleed on every side (proportions kept, centred).`;
  } catch (err) { setCardMsg(`Couldn’t use the background: ${err.message || err}`, true); return; }
  winNamesChanged();
});
document.getElementById('winBgClear').addEventListener('click', () => {
  winNames.bg = null; winNames.bgName = '';
  document.getElementById('winBgInfo').textContent = 'No background: plain white cards without bleed. A background fills the card plus 2 mm bleed on every side (proportions kept, centred).';
  winNamesChanged();
});
document.getElementById('winFontFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  winNames.fontFile = new Uint8Array(await f.arrayBuffer()); winNames.fontName = f.name;
  winNamesChanged();
});
function winSync() {
  const it = cards.items || [];
  cards.bytes = it.length ? true : null; cards.pages = 1;
  cards.previews = it.length ? [it[0].preview] : [];
  cards.name = `${it.length} ${it.length === 1 ? 'card' : 'cards'}`;
  if (!it.length) cards.layout = null;
  winList(); updateCardInfo(); schedule();
}
function winList() {
  const ul = document.getElementById('winList'), it = cards.items || [];
  ul.innerHTML = it.length ? '' : '<li class="empty">No cards yet.</li>';
  it.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'design';
    li.innerHTML = '<div class="thumb"><img alt="" style="max-width:100%;max-height:100%"></div><div><div class="dname"></div></div><button type="button" class="remove">×</button>';
    li.querySelector('img').src = c.preview;
    li.querySelector('.dname').textContent = c.name; li.querySelector('.dname').title = c.name;
    const rm = li.querySelector('.remove'); rm.setAttribute('aria-label', `Remove ${c.name}`);
    rm.addEventListener('click', () => { it.splice(i, 1); winSync(); });
    ul.appendChild(li);
  });
  document.getElementById('winClear').hidden = !it.length;
}
async function buildWinietkaPdf() {
  await ensureLibs();
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, drawObject } = window.PDFLib;
  const o = readOpts(), t = pageDims(), L = cards.layout, wp = winPlan(o), out = await PDFDocument.create();
  const Wpt = t.wMm * PT, Hpt = t.hMm * PT, F = [PT, 0, 0, -PT, 0, Hpt], docs = new Map(), embs = new Map(), marks = templateShapes();
  const embOf = async k => {
    if (embs.has(k)) return embs.get(k);
    const it = cards.items[k];
    if (!docs.has(it.bytes)) docs.set(it.bytes, await PDFDocument.load(it.bytes, { ignoreEncryption: true }));
    const [e] = await out.embedPdf(docs.get(it.bytes), [it.page]);
    embs.set(k, e);
    return e;
  };
  for (let s = 0; s < wp.sheets; s++) {
    setCardMsg(`Sheet ${s + 1} of ${wp.sheets}…`);
    await tick();
    const page = printPage(out, Wpt, Hpt), names = new Map();
    for (const sh of marks) {
      const d = 'M ' + sh.pts.map(q => `${(q[0] * PT).toFixed(3)} ${(q[1] * PT).toFixed(3)}`).join(' L ') + (sh.closed ? ' Z' : '');
      const opt = { x: 0, y: Hpt };
      if (sh.fill) opt.color = cssRgb(sh.fill);
      if (sh.stroke) { opt.borderColor = cssRgb(sh.stroke); opt.borderWidth = sh.sw * PT; }
      page.drawSvgPath(d, opt);
    }
    for (let j = 0; j < L.n; j++) {
      const k = winItem(s, j);
      if (k == null) continue;
      const it = cards.items[k], e = await embOf(k);
      if (!names.has(k)) names.set(k, page.node.newXObject(`W${k}`, e.ref));
      // card page points -> slot mm (y down); a card of another size is stretched to the slot
      const sx = L.pw / it.w, sy = L.ph / it.h, G = [sx, 0, 0, -sy, -it.mbx * sx, L.ph + it.mby * sy];
      const slot = L.items[j], rc = slot.clip, M = mul(F, mul(slot.T, G));
      page.pushOperators(pushGraphicsState(), rectangle(rc[0] * PT, Hpt - (rc[1] + rc[3]) * PT, rc[2] * PT, rc[3] * PT), clip(), endPath(),
        concatTransformationMatrix(...M), drawObject(names.get(k)), popGraphicsState());
    }
  }
  out.setTitle(`Winietki, ${wp.total} pcs`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
document.getElementById('winFile').addEventListener('change', e => { const l = Array.from(e.target.files); e.target.value = ''; winAddFiles(l); });
document.getElementById('winClear').addEventListener('click', () => { cards.items = []; winSync(); });
document.getElementById('winSheet').addEventListener('change', () => renderPreview());

function syncGRows() {
  const g = appMode === 'guillotine', each = deckLike() && deckPer() === 1;
  document.getElementById('deckRows').hidden = !deckLike();
  document.getElementById('rowGPages').hidden = !g;
  document.getElementById('rowGMarksBack').hidden = each;
  document.getElementById('backToggle').hidden = !isPrintMode() || appMode === 'winietka' || each;
  if (each) document.getElementById('showBack').checked = false;
  document.getElementById('rowDeckSets').hidden = each;
  document.getElementById('rowGEachSets').hidden = !each;
}
document.getElementById('gPages').addEventListener('change', () => { syncGRows(); view = null; schedule(); });
function setAppMode(m) {
  appMode = m;
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  document.body.dataset.mode = m;
  const pm = m === 'cards' || m === 'vouchers' || m === 'guillotine' || m === 'morgana' || m === 'deck' || m === 'winietka';
  if (pm) {
    cards = kinds[m];
    document.getElementById('h-cards').textContent = KIND[m].title;
    document.getElementById('foldRows').hidden = m !== 'vouchers' && m !== 'winietka';
    document.getElementById('winRows').hidden = m !== 'winietka';
    document.getElementById('cardLoadRow').hidden = m === 'winietka';
    for (const id of ['rowCOffX', 'rowCOffY']) document.getElementById(id).hidden = m === 'winietka';
    if (m === 'winietka') { winList(); syncWinRows(); if (winNamesOn() && !(cards.items || []).length) winNamesChanged(); }
    syncImgRows();
    document.getElementById('exCardPdf').textContent = m === 'winietka' ? 'Print PDF' : 'Print PDF (both sides)';
    document.getElementById('gRows').hidden = m !== 'guillotine' && m !== 'deck';
    document.getElementById('rowMSize').hidden = m !== 'morgana';
    for (const id of ['rowCGap', 'rowCutStyle', 'rowCRadius', 'rowCFlip', 'cardsCutHint']) document.getElementById(id).hidden = m === 'guillotine' || m === 'morgana' || m === 'deck' || (id === 'rowCFlip' && m === 'winietka');
    if (cards.bleed != null) document.getElementById('cBleed').value = cards.bleed;
    updateCardInfo();
  }
  document.getElementById('secStickers').hidden = pm || m === 'gang' || m === 'squares' || m === 'svgplt' || m === 'duplex';
  document.getElementById('secDuplex').hidden = m !== 'duplex';
  document.getElementById('secExport').hidden = m === 'duplex';
  document.getElementById('secSvgPlt').hidden = m !== 'svgplt';
  document.getElementById('spExports').hidden = m !== 'svgplt';
  document.getElementById('secSquares').hidden = m !== 'squares';
  document.getElementById('squaresExports').hidden = m !== 'squares';
  document.getElementById('secGang').hidden = m !== 'gang';
  document.getElementById('gangExports').hidden = m !== 'gang';
  document.getElementById('secCards').hidden = !pm;
  document.getElementById('secVinyl').hidden = m !== 'vinyl' && m !== 'pen';
  document.getElementById('h-vinyl').textContent = m === 'pen' ? 'Pen' : 'Vinyl';
  document.getElementById('stickerExports').hidden = m !== 'stickers';
  document.getElementById('stickerBatch').hidden = m !== 'stickers';
  document.getElementById('cardExports').hidden = !pm;
  document.getElementById('vinylExports').hidden = m !== 'vinyl' && m !== 'pen';
  document.getElementById('backToggle').hidden = !(pm || m === 'duplex') || m === 'winietka';
  if (pm) syncGRows();
  syncPerfDie();
  document.getElementById('lgKissT').textContent = m === 'stickers' ? 'Kiss cut' : m === 'pen' ? 'Pen line' : m === 'guillotine' || m === 'deck' || m === 'gang' ? 'Guillotine cut' : m === 'morgana' ? 'CardXtra cut' : 'Cut line';
  document.getElementById('lgDieW').hidden = m !== 'stickers';
  document.getElementById('lgKissW').hidden = m === 'duplex';
  view = null;
  ui.dropNote.textContent = m === 'winietka' ? 'Drop the winietki PDFs here (one card per page).' : m === 'svgplt' ? 'Drop the print-and-cut SVG here.' : m === 'gang' ? 'Drop photos and PDFs here.' : m === 'deck' ? 'Drop the multi-page card PDF here (front, back, front, back…).' : m === 'guillotine' || m === 'morgana' ? 'Drop the PDF here (page 1 front, page 2 back).' : pm ? `Drop the ${KIND[m].one} PDF here (page 1 ${m === 'vouchers' ? 'outside' : 'front'}, page 2 ${m === 'vouchers' ? 'inside' : 'back'}).` : m === 'vinyl' ? 'Drop SVG files with the shapes to cut.' : m === 'pen' ? 'Drop SVG files with the lines to draw.' : 'Drop SVG files (or PDFs for round stickers) here to start filling the sheet.';
  designs.forEach(updateRow);
  ui.msg.textContent = '';
  if (pm || m === 'gang') ensureLibs().catch(e => setCardMsg(e.message, true));
  renderStats(); renderPreview(); schedule();
}
for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setAppMode(b.dataset.mode));
document.getElementById('cardFile').addEventListener('change', e => { const l = Array.from(e.target.files); e.target.value = ''; if (l.length) loadCardFile(l); });
document.getElementById('showBack').addEventListener('change', () => renderPreview());
document.getElementById('deckSheet').addEventListener('change', () => renderPreview());
const syncPerf = () => { document.getElementById('perfRows').hidden = !document.getElementById('cFoldOn').checked; document.getElementById('rowGScale').hidden = document.getElementById('gSize').value !== 'custom'; document.getElementById('rowGSpace').hidden = document.getElementById('gAutoGap').checked; };
document.getElementById('gAutoGap').addEventListener('change', syncPerf);
document.getElementById('gSize').addEventListener('change', syncPerf);
document.getElementById('cFoldOn').addEventListener('change', syncPerf);
const cardBase = () => `${KIND[appMode] ? KIND[appMode].file : 'cards'}-${cards.layout ? cards.layout.n : 0}pcs`;
document.getElementById('exCardPdf').addEventListener('click', async () => {
  const btn = document.getElementById('exCardPdf');
  btn.disabled = true; setCardMsg('Building the PDF…');
  try { if (appMode === 'winietka') { await saveFile(`winietki-${winPlan(readOpts()).total}pcs-print.pdf`, await buildWinietkaPdf()); renderStats(); return; }
    const dl = deckLike(), dk = dl ? deckPlan(readOpts()) : null;
    await saveFile(dl ? (appMode === 'deck' ? `deck-${dk.sets}sets-print.pdf` : `guillotine-${dk.total}pcs-${dk.sheets}sheets-print.pdf`) : `${cardBase()}-print.pdf`, dl ? await buildDeckPdf() : await buildCardsPdf()); renderStats(); }
  catch (e) { setCardMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
document.getElementById('exCardCut').addEventListener('click', () => {
  const o = readOpts(), c = cardCuts();
  saveFile(`${cardBase()}-cut.svg`, template.generated ? lemurCutSvg([{ name: o.dieLayer, color: o.dieColor, paths: [
    ...c.loops.map(pts => ({ pts, closed: true })), ...[...c.folds, ...c.v, ...c.h, ...c.dashes].map(pts => ({ pts, closed: false }))] }]) : buildCardCutSvg());
});
document.getElementById('exCardPlt').addEventListener('click', () => {
  const c = cardCuts(), force = readOpts().dieForce;
  saveFile(`${cardBase()}-plt.zip`, makeZip([{ name: `${cardBase()}-die.plt`, text: gridCut(readOpts()) ? buildPlt([], force, c.folds, c.v, c.h) : buildPlt(c.loops, force, c.folds, c.dashes) }]));
});

let previewFrame = null;
/* ---------- vinyl (markless) mode ---------- */
let vinylLayout = null;
let geoGroup = 0; // id shared by the subpaths of one element (so holes stay holes when filling)
// Every visible vector shape in the design, flattened, in root user units. Needs the live DOM (for CTMs and styles).
function extractGeometry(d) {
  let host = null;
  try {
    const doc = parseSvg(d.norm);
    doc.querySelectorAll('image').forEach(n => n.remove());
    host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none';
    const svg = document.importNode(doc.documentElement, true);
    svg.setAttribute('width', '1000'); svg.setAttribute('height', '1000'); svg.removeAttribute('preserveAspectRatio');
    host.appendChild(svg); document.body.appendChild(host);
    const inv = svg.getScreenCTM().inverse(), out = [];
    for (const el of svg.querySelectorAll(SHAPES)) {
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const fillOn = cs.fill && cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0;
      const strokeOn = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeOpacity || '1') > 0;
      if (!fillOn && !strokeOn) continue;
      const gid = ++geoGroup, rule = cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
      const m = inv.multiply(el.getScreenCTM());
      const at = n => parseFloat(el.getAttribute(n)) || 0;
      let polys = [];
      const ell = (cx, cy, rx, ry) => { const p = []; for (let k = 0; k < 72; k++) { const a = k / 72 * 2 * Math.PI; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return [{ pts: p, closed: true }]; };
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
      for (const pl of polys) {
        if (pl.pts.length < 2) continue;
        // an explicit return to the start counts as closed
        const f = pl.pts[0], l = pl.pts[pl.pts.length - 1];
        if (!pl.closed && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6 && pl.pts.length > 2) { pl.closed = true; pl.pts.pop(); }
        if (pl.closed && pl.pts.length > 2) { const a = pl.pts[0], b = pl.pts[pl.pts.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pl.pts.pop(); }
        out.push({ pts: pl.pts.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]), closed: pl.closed, fill: !!fillOn, rule, g: gid });
      }
    }
    return out;
  } finally {
    if (host) host.remove();
  }
}
async function processVinyl(d, o) {
  if (!d.vgeo) d.vgeo = extractGeometry(d);
  const geo = d.vgeo;
  if (!geo.length) throw new Error('No vector shapes to cut in this file.');
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  for (const g of geo) for (const [x, y] of g.pts) { gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y); }
  const bw = gx1 - gx0, bh = gy1 - gy0;
  if (!(bh > 0)) throw new Error('The shapes in this file have no height.');
  const s = d.heightMm / bh, frW = bw * s, frH = d.heightMm;
  const weedEach = o.vWeed === 'each', wm = weedEach ? o.vWeedMargin : 0;
  const pad = o.vGap / 2 + wm + 1.5;
  const Wc = Math.ceil((frW + 2 * pad) / CELL), Hc = Math.ceil((frH + 2 * pad) / CELL);
  let ppm = 2;
  for (const p of [10, 6, 4, 2]) if (Wc * Hc * (p * CELL) ** 2 <= 9e6) { ppm = p; break; }
  const f = Math.round(ppm * CELL), w = Wc * f, h = Hc * f, N = w * h;
  const boxW = Wc * CELL, boxH = Hc * CELL, fx = (boxW - frW) / 2, fy = (boxH - frH) / 2;
  const tx = o.vMirror ? (x => fx + (gx1 - x) * s) : (x => fx + (x - gx0) * s), ty = y => fy + (y - gy0) * s;
  const paths = geo.map(g => { const pts = g.pts.map(([x, y]) => [tx(x), ty(y)]); return { pts: g.closed ? simplifyLoop(pts, 0.01) : rdp(pts, 0.01), closed: g.closed }; });
  if (o.penFill) {
    // pen: fill the filled shapes (text etc.) with parallel lines, per element so holes stay empty
    const groups = new Map();
    geo.forEach((g, i) => { if (g.fill && g.closed) { if (!groups.has(g.g)) groups.set(g.g, { rule: g.rule, polys: [] }); groups.get(g.g).polys.push(paths[i].pts); } });
    for (const { rule, polys } of groups.values()) {
      const fill = o.penStyle === 'lines' ? hatchLines(polys, rule, o.penSpacing, o.penAngle) : contourFill(polys, rule, o.penSpacing);
      for (const ln of fill) paths.push({ pts: ln, closed: false });
    }
  }
  if (weedEach && wm > 0) paths.push({ pts: [[fx - wm, fy - wm], [fx + frW + wm, fy - wm], [fx + frW + wm, fy + frH + wm], [fx - wm, fy + frH + wm]], closed: true, weed: true });
  // nesting footprint: everything that gets cut, filled, grown by half the gap
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.setTransform(ppm, 0, 0, ppm, 0, 0);
  cx.fillStyle = '#000'; cx.strokeStyle = '#000'; cx.lineWidth = 0.4; cx.lineJoin = 'round'; cx.lineCap = 'round';
  for (const p of paths) {
    cx.beginPath();
    p.pts.forEach(([x, y], k) => k ? cx.lineTo(x, y) : cx.moveTo(x, y));
    if (p.closed) { cx.closePath(); cx.fill(); }
    cx.stroke();
  }
  const px = cx.getImageData(0, 0, w, h).data, M = new Uint8Array(N);
  for (let i = 0; i < N; i++) M[i] = px[i * 4 + 3] > 0 ? 1 : 0;
  await tick();
  const D = edt(M, w, h), nest = new Uint8Array(N), L = (o.vGap / 2) * ppm + 0.5;
  for (let i = 0; i < N; i++) nest[i] = D[i] <= L ? 1 : 0;
  fillHolesBin(nest, w, h);
  const cb = new Uint8Array(Wc * Hc);
  for (let y = 0; y < h; y++) { const row = ((y / f) | 0) * Wc; for (let x = 0; x < w; x++) if (nest[y * w + x]) cb[row + ((x / f) | 0)] = 1; }
  const masks = {};
  for (const r of [0, 90, 180, 270]) { const rb = rotBits(cb, Wc, Hc, r); masks[r] = makeMask(rb.bits, rb.w, rb.h); }
  if (!masks[0]) throw new Error('The shapes came out empty at this size.');
  const pathD = paths.map(p => 'M' + p.pts.map(q => num(q[0]) + ' ' + num(q[1])).join('L') + (p.closed ? 'Z' : '')).join('');
  return { s, boxW, boxH, frW, frH, masks, paths, pathD, nPaths: geo.length };
}
// Material area as a nesting grid; packs toward the origin corner (bottom right) by nesting
// top-left and turning the whole result 180°.
async function nestVinyl(list, o, cancelled) {
  const W = o.vWidth, Lm = o.vLength, mg = o.vMargin;
  const Gw = Math.floor(W / CELL), Gh = Math.floor(Lm / CELL), blocked = new Uint8Array(Gw * Gh), mc = Math.ceil(mg / CELL);
  for (let y = 0; y < Gh; y++) for (let x = 0; x < Gw; x++) if (x < mc || y < mc || x >= Gw - mc || y >= Gh - mc) blocked[y * Gw + x] = 1;
  // nest with every shape turned 180° (top-left packing), then turn the whole layout 180°: copies pack toward
  // the origin corner and keep their own orientation
  const flip = m => ({ 0: m[180], 90: m[270], 180: m[0], 270: m[90] });
  const proxies = list.map(d => ({ id: d.id, qty: d.qty, name: d.name, res: { ...d.vres, masks: flip(d.vres.masks) }, real: { id: d.id, qty: d.qty, name: d.name, res: d.vres, src: d } }));
  const lay = await nestAll(proxies, { Gw, Gh, blocked, free: null }, { ...o, center: false }, cancelled);
  if (!lay) return null;
  const items = lay.items.map(it => {
    const m0 = it.d.res.masks[it.rot];
    return { d: it.d.real, rot: it.rot, X: Gw - it.X - m0.w, Y: Gh - it.Y - m0.h };
  });
  return { items, counts: lay.counts, W, L: Lm };
}
function isMarkless() { return appMode === 'vinyl' || appMode === 'pen'; }
// pen mode: same engine as vinyl, but drawn with a pen (no blade offset, overcut, weeding or mirroring)
function vOpts() {
  const o = readOpts();
  return appMode === 'pen' ? { ...o, vWeed: 'none', vMirror: false, overcut: 0, bladeOffset: 0, kissForce: o.penForce } : { ...o, penFill: false };
}
function vinylPaths() {
  const out = [], L = vinylLayout;
  for (const it of L.items) {
    const M = placeMatrix(it);
    for (const p of it.d.res.paths) out.push({ pts: p.pts.map(q => [M[0] * q[0] + M[2] * q[1] + M[4], M[1] * q[0] + M[3] * q[1] + M[5]]), closed: p.closed });
  }
  if (vOpts().vWeed === 'all' && out.length) {
    const wm = vOpts().vWeedMargin;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of out) for (const [x, y] of p.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    x0 = Math.max(0, x0 - wm); y0 = Math.max(0, y0 - wm); x1 = Math.min(L.W, x1 + wm); y1 = Math.min(L.L, y1 + wm);
    out.push({ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
  }
  return out;
}
// Markless PLT: origin at the knife (bottom right of the material), X along the feed, Y across.
function buildVinylPlt() {
  const o = vOpts(), L = vinylLayout, oc = o.overcut * 40, bo = o.bladeOffset * 40;
  const conv = ([x, y]) => [Math.round((L.L - y) * 40), Math.round((L.W - x) * 40)];
  const polys = vinylPaths().map(p => {
    const pts = [];
    for (const q of p.pts) { const c = conv(q), l = pts[pts.length - 1]; if (!l || l[0] !== c[0] || l[1] !== c[1]) pts.push(c); }
    return { pts, closed: p.closed && pts.length > 2 };
  }).filter(p => p.pts.length > 1);
  const out = ['IN'];
  if (o.pltForce) {
    const ci = (v, a, b) => Math.min(b, Math.max(a, Math.round(v)));
    out.push(`VS${ci(o.cutSpeed, 1, 13)}`, `US${ci(o.upSpeed, 1, 13)}`, `FS${ci(o.kissForce, 1, 160)}`);
  }
  let bdir = [1, 0], cx = 0, cy = 0, maxX = 0;
  const emit = tip => {
    const c = dragKnife(tip, bo, bdir);
    bdir = c.dir;
    const q = c.pts.map(p => [Math.round(p[0]), Math.round(p[1])]);
    out.push(`U${q[0][0]},${q[0][1]}`, `D${q[0][0]},${q[0][1]}`);
    for (let i = 1; i < q.length; i++) if (q[i][0] !== q[i - 1][0] || q[i][1] !== q[i - 1][1]) out.push(`D${q[i][0]},${q[i][1]}`);
  };
  const left = polys.slice();
  while (left.length) {
    let bi = 0, bv = 0, bd = Infinity, rev = false;
    left.forEach((p, i) => {
      if (p.closed) p.pts.forEach((q, j) => { const d = (q[0] - cx) ** 2 + (q[1] - cy) ** 2; if (d < bd) { bd = d; bi = i; bv = j; rev = false; } });
      else {
        const a = p.pts[0], b = p.pts[p.pts.length - 1];
        const da = (a[0] - cx) ** 2 + (a[1] - cy) ** 2, db = (b[0] - cx) ** 2 + (b[1] - cy) ** 2;
        if (da < bd) { bd = da; bi = i; bv = 0; rev = false; }
        if (db < bd) { bd = db; bi = i; bv = 0; rev = true; }
      }
    });
    const p = left.splice(bi, 1)[0];
    let tip;
    if (p.closed) {
      const r = p.pts.slice(bv).concat(p.pts.slice(0, bv));
      tip = r.concat([r[0]]);
      let rem = oc;
      for (let i = 1; rem > 0 && i <= r.length; i++) {
        const a = r[i - 1], b = r[i % r.length], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!seg) continue;
        if (seg >= rem) { const k = rem / seg; tip.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); rem = 0; }
        else { tip.push(b); rem -= seg; }
      }
    } else tip = rev ? p.pts.slice().reverse() : p.pts;
    emit(tip);
    const e = tip[tip.length - 1]; cx = e[0]; cy = e[1];
    for (const q of p.pts) maxX = Math.max(maxX, q[0]);
  }
  // feed the cut job out past its end, back to the right edge
  out.push(`U${maxX + 400},0`, '@;@;');
  return out.join(' ');
}
function buildVinylSvg() {
  const o = vOpts(), L = vinylLayout;
  const s = [`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(L.W)}mm" height="${num(L.L)}mm" viewBox="0 0 ${num(L.W)} ${num(L.L)}">\n`];
  s.push(`<g id="${aiId(o.kissLayer)}">\n`);
  for (const p of vinylPaths()) s.push(pathEl(p.pts, p.closed, `fill:none;stroke:${o.kissColor};stroke-width:${o.lineW}`) + '\n');
  s.push('</g>\n</svg>\n');
  return s.join('');
}
function renderVinylPreview() {
  const o = vOpts(), W = o.vWidth, Lm = o.vLength, mg = o.vMargin, L = vinylLayout;
  previewFrame = { x: -6, y: -6, w: W + 12, h: Lm + 12 };
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${previewFrame.x} ${previewFrame.y} ${previewFrame.w} ${previewFrame.h}" role="img" aria-label="Vinyl cutting layout">`);
  p.push(`<rect x="0" y="0" width="${num(W)}" height="${num(Lm)}" fill="#f3f1ec"/>`);
  p.push(`<rect x="${mg}" y="${mg}" width="${num(W - 2 * mg)}" height="${num(Lm - 2 * mg)}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`);
  if (L) {
    let top = Lm;
    for (const it of L.items) {
      const M = placeMatrix(it);
      p.push(`<path d="${it.d.res.pathD}" transform="matrix(${M.map(num).join(',')})" fill="${ui.showArt.checked ? 'rgba(35,31,32,.12)' : 'none'}" fill-rule="evenodd" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
      top = Math.min(top, it.Y * CELL);
    }
    if (o.vWeed === 'all') {
      const wb = vinylPaths().pop();
      p.push(`<polygon points="${wb.pts.map(q => num(q[0]) + ' ' + num(q[1])).join(' ')}" fill="none" stroke="${CUT_RED}" stroke-width="1.2" stroke-dasharray="6 3" vector-effect="non-scaling-stroke"/>`);
    }
    if (L.items.length) p.push(`<line x1="0" x2="${num(W)}" y1="${num(top)}" y2="${num(top)}" stroke="#c2410c" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`);
  }
  // knife origin and feed direction
  p.push(`<g transform="translate(${num(W)} ${num(Lm)})"><circle r="2.5" fill="#c2410c"/><path d="M-8 -6 L-8 -22 M-11 -18 L-8 -22 L-5 -18" fill="none" stroke="#c2410c" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g>`);
  p.push('</svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
function vinylUsedLength() {
  const L = vinylLayout;
  if (!L || !L.items.length) return 0;
  let top = Infinity;
  for (const p of vinylPaths()) for (const q of p.pts) top = Math.min(top, q[1]);
  return L.L - top;
}
function renderVinylStats(busyText) {
  const n = vinylLayout ? vinylLayout.items.length : 0;
  ui.dropNote.hidden = designs.length > 0;
  for (const id of ['exVinylSvg', 'exVinylPlt', 'exVinylPdf']) document.getElementById(id).disabled = !n || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  const where = appMode === 'pen' ? 'sheet' : 'vinyl', tool = appMode === 'pen' ? 'pen' : 'knife';
  ui.count.textContent = !designs.length ? `Empty ${where}` : n === 1 ? `1 copy on the ${where}` : `${n} copies on the ${where}`;
  const notes = [];
  if (n) notes.push(`Uses ${Math.ceil(vinylUsedLength())} mm of the material length. The ${tool} starts at the bottom right corner, the material feeds up.`);
  for (const d of designs) {
    if (!d.vres) continue;
    const got = vinylLayout ? vinylLayout.counts.get(d.id) || 0 : 0;
    if (d.qty != null && got < d.qty) notes.push(`Only ${got} of ${d.qty} copies of ${d.name} fit.`);
  }
  setCardMsg(notes.join(' '), false);
}
async function runVinyl(my, o) {
  for (const d of designs) {
    const key = ['v', d.heightMm, o.vGap, o.vWeed, o.vWeedMargin, o.vMirror, o.penFill, o.penStyle, o.penSpacing, o.penAngle].join('|');
    if (d.vkey === key) continue;
    d.busy = true; updateRow(d);
    renderStats(`Reading ${d.name}…`);
    await tick();
    let res = null, err = null;
    try { res = await processVinyl(d, o); } catch (e) { err = e.message || String(e); }
    if (my !== gen) return;
    d.vres = res; d.verr = err; d.vkey = key; d.busy = false;
    updateRow(d);
  }
  const ready = designs.filter(d => d.vres && d.qty !== 0);
  renderStats('Arranging…');
  await tick();
  const lay = ready.length ? await nestVinyl(ready, o, () => my !== gen) : null;
  if (my !== gen) return;
  vinylLayout = lay;
  renderPreview();
  designs.forEach(updateRow);
  renderStats();
}
document.getElementById('exVinylSvg').addEventListener('click', () => saveFile(`${appMode === 'pen' ? 'pen' : 'vinyl'}-${vinylLayout.items.length}pcs-${appMode === 'pen' ? 'draw' : 'cut'}.svg`, buildVinylSvg()));
document.getElementById('exVinylPlt').addEventListener('click', () => {
  const base = `${appMode === 'pen' ? 'pen' : 'vinyl'}-${vinylLayout.items.length}pcs`;
  saveFile(`${base}-plt.zip`, makeZip([{ name: `${base}.plt`, text: buildVinylPlt() }]));
});

/* ---------- sticker batch: several sheets, one print PDF + PLTs per sheet ---------- */
// Split the stickers over as many sheets as needed. Copies = that many; empty copies = one full sheet of that design.
async function planBatch(o) {
  const ready = designs.filter(d => d.res && d.qty !== 0);
  if (!ready.length) throw new Error('Add some stickers first.');
  const sheet = await templateSheet(o), sheets = [];
  const remaining = new Map(ready.filter(d => d.qty != null).map(d => [d, d.qty]));
  // designs without copies fill whatever space the counted ones leave on every sheet
  const fills = ready.filter(d => d.qty == null), fillers = () => fills.map(d => Object.assign(Object.create(d), { qty: null }));
  const groups = o.batchMix ? [[...remaining.keys()]] : [...remaining.keys()].map(d => [d]);
  for (const g of groups) {
    while (g.some(d => remaining.get(d) > 0)) {
      const list = g.filter(d => remaining.get(d) > 0).map(d => Object.assign(Object.create(d), { qty: remaining.get(d) }));
      const lay = await nestAll([...list, ...fillers()], sheet, o, () => false);
      const placed = g.reduce((s, d) => s + ((lay && lay.counts.get(d.id)) || 0), 0);
      if (!lay || !placed) throw new Error(`${list[0].name} doesn’t fit on a sheet.`);
      for (const d of g) remaining.set(d, remaining.get(d) - (lay.counts.get(d.id) || 0));
      sheets.push(lay);
      if (sheets.length > 200) throw new Error('More than 200 sheets; check the copies.');
    }
  }
  // only fill designs (nothing counted): one full sheet each
  if (!remaining.size) for (const d of fills) {
    const lay = await nestAll([Object.assign(Object.create(d), { qty: null })], sheet, o, () => false);
    if (!lay || !lay.items.length) throw new Error(`${d.name} doesn’t fit on a sheet.`);
    sheets.push(lay);
  }
  return sheets;
}
const sheetSummary = lay => {
  const per = new Map();
  for (const it of lay.items) per.set(it.d.name, (per.get(it.d.name) || 0) + 1);
  return [...per].map(([nm, n]) => `${nm} x${n}`).join(', ');
};
// One sheet as a print PDF: artwork at 300 dpi, registration marks as vectors (no xlink, no cut lines).
// Round stickers from a PDF go into the print PDF as the original vector page (no pixels), clipped to
// the same area the raster print uses (die line plus a little bleed). cache: Map shared by the pages of one PDF.
async function drawVectorStickers(page, out, L, Hpt, cache) {
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, moveTo, lineTo, closePath, clip, endPath, drawObject } = window.PDFLib;
  const F = [PT, 0, 0, -PT, 0, Hpt], names = new Map();
  for (const it of L.items) {
    const d = it.d, c = d.circle;
    if (!vecCircle(d) || !d.res) continue;
    const key = d.id;
    if (!cache.has(key)) {
      if (!cache.docs) cache.docs = new Map();
      if (!cache.docs.has(c.pdf)) cache.docs.set(c.pdf, await PDFDocument.load(c.pdf, { ignoreEncryption: true }));
      cache.set(key, (await out.embedPdf(cache.docs.get(c.pdf), [c.page]))[0]);
    }
    const emb = cache.get(key);
    if (!names.has(key)) names.set(key, page.node.newXObject(`V${key}`, emb.ref));
    const P = placeMatrix(it), r = d.res;
    const A = [r.s, 0, 0, r.s, r.offX - r.s * d.vb.x, r.offY - r.s * d.vb.y]; // design units (page pt, y down) -> sticker mm
    const G = [1, 0, 0, -1, -c.mbx, c.mby + c.h];                              // PDF page space (y up) -> design units
    const S = mul(F, P), M = mul(S, mul(A, G));
    const ops = [pushGraphicsState()];
    for (const loop of r.clipLoops) {
      loop.forEach((q, i) => { const [x, y] = apply(S, q); ops.push(i ? lineTo(x, y) : moveTo(x, y)); });
      ops.push(closePath());
    }
    ops.push(clip(), endPath(), concatTransformationMatrix(...M), drawObject(names.get(key)), popGraphicsState());
    page.pushOperators(...ops);
  }
}
async function renderSheetPage(pdf, t, marks, dpi, cache = new Map()) {
  const Wpt = t.wMm * PT, Hpt = t.hMm * PT, wpx = Math.round(t.wMm / 25.4 * dpi), hpx = Math.round(t.hMm / 25.4 * dpi);
  const img = await loadImg(sizedSvg(buildExport('art', true), wpx, hpx));
  const cv = document.createElement('canvas'); cv.width = wpx; cv.height = hpx;
  const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, wpx, hpx); cx.drawImage(img, 0, 0, wpx, hpx);
  const jpg = await new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.93));
  cv.width = cv.height = 1;
  const page = printPage(pdf, Wpt, Hpt);
  page.drawImage(await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer())), { x: 0, y: 0, width: Wpt, height: Hpt });
  await drawVectorStickers(page, pdf, layout, Hpt, cache);
  for (const sh of marks) {
    const dd = 'M ' + sh.pts.map(q => `${(q[0] * PT).toFixed(3)} ${(q[1] * PT).toFixed(3)}`).join(' L ') + (sh.closed ? ' Z' : '');
    const opt = { x: 0, y: Hpt };
    if (sh.fill) opt.color = cssRgb(sh.fill);
    if (sh.stroke) { opt.borderColor = cssRgb(sh.stroke); opt.borderWidth = sh.sw * PT; }
    page.drawSvgPath(dd, opt);
  }
  return page;
}
async function buildSinglePdf() {
  await ensureLibs();
  const pdf = await window.PDFLib.PDFDocument.create();
  await renderSheetPage(pdf, template, templateShapes(), 300);
  pdf.setTitle(`Sticker sheet, ${layout.items.length} pcs`);
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
document.getElementById('exPdf').addEventListener('click', async () => {
  const btn = document.getElementById('exPdf'); btn.disabled = true;
  try { await saveFile(exportName('all').replace(/\.svg$/, '-print.pdf'), await buildSinglePdf()); }
  catch (e) { setCardMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
async function buildBatch() {
  const o = readOpts(), t = template, saved = layout;
  setCardMsg('Planning the sheets…');
  await ensureLibs();
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const sheets = await planBatch(o);
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  const Wpt = t.wMm * PT, Hpt = t.hMm * PT, dpi = 300, wpx = Math.round(t.wMm / 25.4 * dpi), hpx = Math.round(t.hMm / 25.4 * dpi);
  const marks = templateShapes(), files = [], date = new Date().toISOString().slice(0, 10), total = sheets.length;
  // identical sheets (same stickers in the same places) share one pair of PLTs: A, B, C…
  const pltOf = new Map(), sheetPlt = [], vcache = new Map();
  const letter = n => (n >= 26 ? letter(Math.floor(n / 26) - 1) : '') + String.fromCharCode(65 + n % 26);
  // label goes left of the start arrow by the bottom-right mark: that corner stays whole after the die cut
  const mk = t.marks, rightMm = mk ? (mk.right - t.vb.x) / t.u : t.wMm - 5.5, bottomMm = mk ? (mk.bottom - t.vb.y) / t.u : t.hMm - 5.5;
  try {
    for (let i = 0; i < total; i++) {
      const id = `S${String(i + 1).padStart(2, '0')}`;
      setCardMsg(`Sheet ${i + 1} of ${total}…`);
      await tick();
      layout = sheets[i];
      const key = layout.items.map(it => `${it.d.id}:${it.rot}:${it.X}:${it.Y}`).sort().join('|');
      if (!pltOf.has(key)) {
        const L = letter(pltOf.size);
        pltOf.set(key, L);
        files.push({ name: `${L}-kiss.plt`, text: buildPlt(stickerLoops('kissLoops'), o.kissForce) });
        files.push({ name: `${L}-die.plt`, text: buildPlt(stickerLoops('dieLoops'), o.dieForce) });
      }
      const plt = pltOf.get(key);
      sheetPlt.push(plt);
      // print: artwork rendered at 300 dpi, marks and the label as vectors on top
      const img = await loadImg(sizedSvg(buildExport('art', true), wpx, hpx));
      const cv = document.createElement('canvas'); cv.width = wpx; cv.height = hpx;
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, wpx, hpx); cx.drawImage(img, 0, 0, wpx, hpx);
      const jpg = await new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.93));
      cv.width = cv.height = 1;
      const page = printPage(pdf, Wpt, Hpt);
      page.drawImage(await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer())), { x: 0, y: 0, width: Wpt, height: Hpt });
      await drawVectorStickers(page, pdf, layout, Hpt, vcache);
      for (const sh of marks) {
        const dd = 'M ' + sh.pts.map(q => `${(q[0] * PT).toFixed(3)} ${(q[1] * PT).toFixed(3)}`).join(' L ') + (sh.closed ? ' Z' : '');
        const opt = { x: 0, y: Hpt };
        if (sh.fill) opt.color = cssRgb(sh.fill);
        if (sh.stroke) { opt.borderColor = cssRgb(sh.stroke); opt.borderWidth = sh.sw * PT; }
        page.drawSvgPath(dd, opt);
      }
      const label = asciiOnly(`${id}/${String(total).padStart(2, '0')}  PLT ${plt}  ${date}`), size = 7;
      const lw = font.widthOfTextAtSize(label, size);
      page.drawText(label, { x: (rightMm - 23.5) * PT - lw, y: (t.hMm - bottomMm - 0.5) * PT, size, font, color: rgb(0, 0, 0) });
    }
  } finally { layout = saved; }
  pdf.setTitle(`Sticker batch ${date}, ${total} sheets`);
  const summary = sheets.map((l, i) => `S${String(i + 1).padStart(2, '0')} (PLT ${sheetPlt[i]}): ${sheetSummary(l)}`).join('\n');
  files.unshift({ name: 'batch-print.pdf', bytes: await pdf.save() }, { name: 'batch-sheets.txt', text: summary + '\n' });
  return { zip: makeZip(files), total, summary };
}
document.getElementById('exBatch').addEventListener('click', async () => {
  const btn = document.getElementById('exBatch');
  btn.disabled = true;
  try {
    const r = await buildBatch();
    await saveFile(`sticker-batch-${r.total}sheets.zip`, r.zip);
    setCardMsg(`${r.total} ${r.total === 1 ? 'sheet' : 'sheets'}: ${r.summary.replace(/\n/g, '; ')}.`);
  } catch (e) { setCardMsg(`Batch failed: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});

/* ---------- print sheets (gang printing for the guillotine) ---------- */
// Images and PDF pages, each scaled with its proportions kept to cover the chosen format plus bleed
// (or to fit inside it), centred, imposed on 310 × 440 sheets with crop marks.
const gang = { items: [], layout: null, sheets: 0, view: 0 };
let gangNext = 1;
const GFORMATS = { '100x150': [100, 150], '130x180': [130, 180], A6: [105, 148], A5: [148, 210], A4: [210, 297], DL: [99, 210], '90x50': [90, 50], '85x55': [85, 55] };
function gangOpts(o) { // the guillotine engine, fed with this mode's own settings
  return { ...o, cBleed: o.ggBleed, gAuto: o.ggAuto, gGap: o.ggGap, gMarkLen: o.ggMarkLen, gMarkOff: o.ggMarkOff, gMargin: o.ggEdge, gSize: 'orig' };
}
function gangFormat(o) {
  const f = o.ggFormat === 'custom' ? [o.ggW, o.ggH] : (GFORMATS[o.ggFormat] || [100, 150]);
  return [Math.max(5, f[0]), Math.max(5, f[1])];
}
async function gangAddFiles(fileList) {
  const files = Array.from(fileList);
  setCardMsg('Reading files…');
  for (const f of files) {
    try {
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        await ensureLibs();
        const bytes = new Uint8Array(await f.arrayBuffer());
        const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
        const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        for (let i = 0; i < pdf.numPages; i++) {
          const pg = await pdf.getPage(i + 1), mb = lib.getPage(i).getMediaBox();
          const vp = pg.getViewport({ scale: 4 / PT });
          const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
          await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          gang.items.push({ id: gangNext++, name: pdf.numPages > 1 ? `${f.name} p.${i + 1}` : f.name, kind: 'pdf', bytes, page: i, w: mb.width, h: mb.height, mbx: mb.x, mby: mb.y, preview: cv.toDataURL('image/jpeg', 0.85), copies: 1 });
        }
      } else if (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)) {
        const url = await readAsDataUrl(f);
        const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('unreadable image')); im.src = url; });
        let bytes = new Uint8Array(await f.arrayBuffer()), mime = /png/i.test(f.type) || /\.png$/i.test(f.name) ? 'png' : 'jpg';
        if (!/^image\/(jpeg|png)$/.test(f.type) && !/\.(jpe?g|png)$/i.test(f.name)) { // other formats: re-encode as JPEG
          const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
          const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0);
          bytes = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.95))).arrayBuffer()); mime = 'jpg';
        }
        gang.items.push({ id: gangNext++, name: f.name, kind: 'img', bytes, mime, w: img.naturalWidth, h: img.naturalHeight, preview: url, copies: 1 });
      }
    } catch (e) { setCardMsg(`${f.name}: ${e.message || e}`, true); }
  }
  gangList();
  schedule();
}
function gangList() {
  const ul = document.getElementById('gangList');
  ul.innerHTML = '';
  if (!gang.items.length) { ul.innerHTML = '<li class="empty">No files yet.</li>'; return; }
  for (const it of gang.items) {
    const li = document.createElement('li');
    li.className = 'design';
    li.innerHTML = `<div class="thumb"><img alt="" style="max-width:100%;max-height:100%"></div><div><div class="dname"></div><div class="fields"><label>Copies<input type="number" min="0" step="1" class="gq"></label></div></div><button type="button" class="remove">×</button>`;
    li.querySelector('img').src = it.preview;
    li.querySelector('.dname').textContent = it.name; li.querySelector('.dname').title = it.name;
    const q = li.querySelector('.gq'); q.value = it.copies;
    q.addEventListener('input', () => { const v = parseInt(q.value, 10); it.copies = isFinite(v) && v >= 0 ? v : 0; schedule(); });
    const rm = li.querySelector('.remove'); rm.setAttribute('aria-label', `Remove ${it.name}`);
    rm.addEventListener('click', () => { gang.items.splice(gang.items.indexOf(it), 1); gangList(); schedule(); });
    ul.appendChild(li);
  }
}
function gangCompute(o) {
  const go = gangOpts(o), [fw, fh] = gangFormat(o);
  const job = kinds.gang;
  job.pageW = fw + 2 * go.cBleed; job.pageH = fh + 2 * go.cBleed; job.bytes = gang.items.length ? true : null;
  cards = job;
  gang.layout = gang.items.length ? computeCardLayout(null, go) : null;
  const total = gang.items.reduce((s, it) => s + it.copies, 0), n = gang.layout ? gang.layout.n : 0;
  gang.sheets = n ? Math.ceil(total / n) : 0;
  gang.view = Math.min(gang.view, Math.max(0, gang.sheets - 1));
  const sel = document.getElementById('gangSheet');
  sel.innerHTML = Array.from({ length: Math.max(1, gang.sheets) }, (_, i) => `<option value="${i}">Sheet ${i + 1}${gang.sheets ? ` of ${gang.sheets}` : ''}</option>`).join('');
  sel.value = String(gang.view);
}
// which item goes in which slot: copies in order, sheet after sheet
function gangSlots() {
  const seq = [];
  for (const it of gang.items) for (let k = 0; k < it.copies; k++) seq.push(it);
  return seq;
}
// placement of an item (natural w × h) in a box on the sheet (mm, y down): rotation to match orientation, scale, centre
function gangPlace(it, box, fill) {
  const [bx, by, bw, bh] = box, rot = (it.w > it.h) !== (bw > bh) && Math.abs(it.w - it.h) > 1e-6;
  const cw = rot ? it.h : it.w, ch = rot ? it.w : it.h;
  const s = fill ? Math.max(bw / cw, bh / ch) : Math.min(bw / cw, bh / ch);
  return { rot, s, x: bx + (bw - cw * s) / 2, y: by + (bh - ch * s) / 2, cw, ch };
}
function renderGangPreview() {
  const o = readOpts(), go = gangOpts(o), L = gang.layout, pg = G_PAGE, fill = o.ggFit === 'fill';
  previewFrame = { x: -8, y: -8, w: pg.wMm + 16, h: pg.hMm + 16 };
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${previewFrame.x} ${previewFrame.y} ${previewFrame.w} ${previewFrame.h}" role="img" aria-label="Print sheet preview"><rect x="0" y="0" width="${pg.wMm}" height="${pg.hMm}" fill="#fff"/>`];
  if (go.gMargin) p.push(`<rect x="${go.gMargin}" y="${go.gMargin}" width="${pg.wMm - 2 * go.gMargin}" height="${pg.hMm - 2 * go.gMargin}" fill="none" stroke="#9fb0a9" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`);
  if (L && L.n) {
    const seq = gangSlots(), base = gang.view * L.n;
    L.items.forEach((slot, i) => {
      const it = seq[base + i], [cx, cy, cw2, ch2] = slot.clip;
      p.push(`<rect x="${num(slot.trim[0])}" y="${num(slot.trim[1])}" width="${num(slot.trim[2])}" height="${num(slot.trim[3])}" fill="none" stroke="${CUT_RED}" stroke-width="1.1" vector-effect="non-scaling-stroke"/>`);
      if (!it || !ui.showArt.checked) return;
      const pl = gangPlace(it, slot.clip, fill);
      // image drawn in its own (rotated) frame
      const M = pl.rot ? [0, -pl.s, pl.s, 0, pl.x, pl.y + pl.ch * pl.s] : [pl.s, 0, 0, pl.s, pl.x, pl.y];
      p.push(`<clipPath id="gc${i}"><rect x="${num(cx)}" y="${num(cy)}" width="${num(cw2)}" height="${num(ch2)}"/></clipPath><g clip-path="url(#gc${i})"><image href="${it.preview}" x="0" y="0" width="${it.w}" height="${it.h}" preserveAspectRatio="none" transform="matrix(${M.map(num).join(',')})"/></g>`);
    });
    p.push(`<path d="${cropMarks(L, go).map(m => `M${num(m[0])} ${num(m[1])}L${num(m[2])} ${num(m[3])}`).join('')}" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
  }
  p.push('</svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderGangStats(busyText) {
  const L = gang.layout, n = L ? L.n : 0, total = gang.items.reduce((s, it) => s + it.copies, 0);
  ui.dropNote.hidden = gang.items.length > 0;
  document.getElementById('exGang').disabled = !n || !total || !!busyText;
  document.getElementById('exGangProof').disabled = !n || !total || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = !gang.items.length ? 'No files yet' : `${total} ${total === 1 ? 'print' : 'prints'} on ${gang.sheets} ${gang.sheets === 1 ? 'sheet' : 'sheets'}`;
  const notes = [];
  if (gang.items.length && L) {
    const [fw, fh] = gangFormat(readOpts());
    if (!n) notes.push('The format doesn’t fit on the sheet.');
    else {
      const f = v => num(Math.round(v * 10) / 10);
      notes.push(`${n} per sheet (${L.cols} × ${L.rows}${L.rot ? ', rotated' : ''}), ${num(fw)} × ${num(fh)} mm + ${num(readOpts().ggBleed)} mm bleed.`);
      notes.push(`Cuts from the left edge: ${L.cutsX.map(f).join(', ')} mm. From the top: ${L.cutsY.map(f).join(', ')} mm.`);
    }
  }
  setCardMsg(notes.join(' '), gang.items.length > 0 && !n);
}
async function buildGangPdf() {
  await ensureLibs();
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, drawObject, rgb } = window.PDFLib;
  const o = readOpts(), go = gangOpts(o), L = gang.layout, fill = o.ggFit === 'fill', seq = gangSlots();
  const out = await PDFDocument.create(), Wpt = G_PAGE.wMm * PT, Hpt = G_PAGE.hMm * PT;
  // embed every source once
  const emb = new Map(), srcDocs = new Map();
  for (const it of gang.items) {
    if (!it.copies) continue;
    if (it.kind === 'img') emb.set(it, it.mime === 'png' ? await out.embedPng(it.bytes) : await out.embedJpg(it.bytes));
    else {
      if (!srcDocs.has(it.bytes)) srcDocs.set(it.bytes, await PDFDocument.load(it.bytes, { ignoreEncryption: true }));
      const [pgE] = await out.embedPdf(srcDocs.get(it.bytes), [it.page]);
      emb.set(it, pgE);
    }
  }
  const marks = cropMarks(L, go), black = rgb(0, 0, 0);
  for (let sh = 0; sh < gang.sheets; sh++) {
    setCardMsg(`Sheet ${sh + 1} of ${gang.sheets}…`);
    await tick();
    const page = out.addPage([Wpt, Hpt]), names = new Map();
    L.items.forEach((slot, i) => {
      const it = seq[sh * L.n + i];
      if (!it) return;
      const e = emb.get(it);
      if (!names.has(e)) names.set(e, page.node.newXObject('Gang', e.ref));
      const pl = gangPlace(it, slot.clip, fill), rc = slot.clip;
      // source units -> natural size (image: unit square; PDF page: points from its media box)
      const S0 = it.kind === 'img' ? [it.w, 0, 0, it.h, 0, 0] : [1, 0, 0, 1, -it.mbx, -it.mby];
      // natural (y up) -> sheet points (y up), rotated a quarter turn when the orientation differs
      const s = pl.s * PT, x0 = pl.x * PT, yTop = Hpt - pl.y * PT, chPt = pl.ch * s;
      const R = pl.rot ? [0, s, -s, 0, x0 + pl.cw * s, yTop - chPt] : [s, 0, 0, s, x0, yTop - chPt];
      const M = mul(R, S0);
      page.pushOperators(pushGraphicsState(), rectangle(rc[0] * PT, Hpt - (rc[1] + rc[3]) * PT, rc[2] * PT, rc[3] * PT), clip(), endPath(),
        concatTransformationMatrix(...M), drawObject(names.get(e)), popGraphicsState());
    });
    for (const m of marks) page.drawLine({ start: { x: m[0] * PT, y: Hpt - m[1] * PT }, end: { x: m[2] * PT, y: Hpt - m[3] * PT }, thickness: 0.25, color: black });
  }
  out.setTitle(`Print sheets, ${seq.length} prints`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
document.getElementById('gangFile').addEventListener('change', e => { const f = e.target.files; const list = Array.from(f); e.target.value = ''; if (list.length) gangAddFiles(list); });
document.getElementById('gangSheet').addEventListener('change', e => { gang.view = parseInt(e.target.value, 10) || 0; renderPreview(); });
document.getElementById('ggFormat').addEventListener('change', () => { document.getElementById('rowGGCustom').hidden = document.getElementById('ggFormat').value !== 'custom'; });
document.getElementById('ggAuto').addEventListener('change', () => { document.getElementById('rowGGGap').hidden = document.getElementById('ggAuto').checked; });
document.getElementById('exGang').addEventListener('click', async () => {
  const btn = document.getElementById('exGang'); btn.disabled = true;
  try { const n = gangSlots().length; await saveFile(`print-sheets-${gang.sheets}x-${n}pcs.pdf`, await buildGangPdf()); renderGangStats(); }
  catch (e) { setCardMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
// Proof: every file whole, one A4 page each, with the cut line and the bleed edge drawn over it
// and everything that ends up cut off greyed out.
async function buildGangProof() {
  await ensureLibs();
  const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = window.PDFLib;
  const o = readOpts(), go = gangOpts(o), L = gang.layout, fill = o.ggFit === 'fill', [fw, fh] = gangFormat(o), b = go.cBleed;
  const out = await PDFDocument.create(), font = await out.embedFont(StandardFonts.Helvetica), srcDocs = new Map();
  const tw = L.items[0].trim[2], th = L.items[0].trim[3], PW = 595.28, PH = 841.89;
  const red = rgb(0.85, 0.1, 0.1), orange = rgb(0.95, 0.55, 0.1), grey = rgb(1, 1, 1);
  for (const it of gang.items) {
    if (!it.copies) continue;
    const page = out.addPage([PW, PH]);
    const e = it.kind === 'img' ? (it.mime === 'png' ? await out.embedPng(it.bytes) : await out.embedJpg(it.bytes)) : await (async () => {
      if (!srcDocs.has(it.bytes)) srcDocs.set(it.bytes, await PDFDocument.load(it.bytes, { ignoreEncryption: true }));
      return (await out.embedPdf(srcDocs.get(it.bytes), [it.page]))[0];
    })();
    const pl = gangPlace(it, [0, 0, tw + 2 * b, th + 2 * b], fill), s = pl.s;
    // the printed area (bleed box) and the cut line, in the file's own units, centred on it
    const vis = pl.rot ? [(th + 2 * b) / s, (tw + 2 * b) / s] : [(tw + 2 * b) / s, (th + 2 * b) / s];
    const cut = pl.rot ? [th / s, tw / s] : [tw / s, th / s];
    const rect = sz => [it.w / 2 - sz[0] / 2, it.h / 2 - sz[1] / 2, sz[0], sz[1]]; // x, y (from the top), w, h
    const V = rect(vis), C = rect(cut);
    const minX = Math.min(0, V[0]), minY = Math.min(0, V[1]), maxX = Math.max(it.w, V[0] + V[2]), maxY = Math.max(it.h, V[1] + V[3]);
    const AX = 40, AY = 70, AW = PW - 80, AH = PH - 150, k = Math.min(AW / (maxX - minX), AH / (maxY - minY));
    const ox = AX + (AW - (maxX - minX) * k) / 2 - minX * k, top = AY + AH - (AH - (maxY - minY) * k) / 2 + minY * k;
    const P = (x, y) => [ox + x * k, top - y * k]; // file units (y down) -> page points
    const [ix, iy] = P(0, it.h);
    const M = it.kind === 'img' ? [it.w * k, 0, 0, it.h * k, ix, iy] : [k, 0, 0, k, ix - it.mbx * k, iy - it.mby * k];
    const name = page.node.newXObject('Src', e.ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...M), drawObject(name), popGraphicsState());
    // grey out what falls outside the cut line (only over the picture itself)
    const band = (x0, y0, x1, y1) => {
      x0 = Math.max(x0, 0); y0 = Math.max(y0, 0); x1 = Math.min(x1, it.w); y1 = Math.min(y1, it.h);
      if (x1 <= x0 || y1 <= y0) return;
      const [px, py] = P(x0, y1);
      page.drawRectangle({ x: px, y: py, width: (x1 - x0) * k, height: (y1 - y0) * k, color: grey, opacity: 0.6 });
    };
    band(0, 0, it.w, C[1]); band(0, C[1] + C[3], it.w, it.h); band(0, C[1], C[0], C[1] + C[3]); band(C[0] + C[2], C[1], it.w, C[1] + C[3]);
    const frame = (R, color, dash) => { const [px, py] = P(R[0], R[1] + R[3]); page.drawRectangle({ x: px, y: py, width: R[2] * k, height: R[3] * k, borderColor: color, borderWidth: 1, borderDashArray: dash, opacity: 0 }); };
    frame(V, orange, [4, 3]); frame(C, red, undefined);
    const t1 = asciiOnly(`${it.name}  (${it.copies} ${it.copies === 1 ? 'copy' : 'copies'})`);
    const t2 = asciiOnly(`${num(fw)} x ${num(fh)} mm + ${num(b)} mm bleed, ${fill ? 'filled' : 'fitted whole'}${pl.rot ? ', turned a quarter on the sheet' : ''}`);
    page.drawText(t1.slice(0, 90), { x: 40, y: PH - 45, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText(t2, { x: 40, y: PH - 62, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    page.drawText('Red: cut line.  Orange dashed: edge of the printed bleed.  Greyed out: cut off.', { x: 40, y: 40, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  }
  out.setTitle('Print sheets proof');
  return new Blob([await out.save()], { type: 'application/pdf' });
}
document.getElementById('exGangProof').addEventListener('click', async () => {
  const btn = document.getElementById('exGangProof'); btn.disabled = true;
  try { await saveFile('print-sheets-proof.pdf', await buildGangProof()); }
  catch (e) { setCardMsg(`Couldn’t build the proof: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
gangList();

/* ---------- squares: cut a blank sheet into a grid, no marks ---------- */
const squares = { L: null };
function squaresCompute(o) {
  const W = o.sqSheetW, H = o.sqSheetH, m = o.sqMargin, g = o.sqGap;
  let best = null;
  for (const rot of [false, true]) {
    const pw = rot ? o.sqH : o.sqW, ph = rot ? o.sqW : o.sqH;
    const cols = Math.floor((W - 2 * m + g) / (pw + g)), rows = Math.floor((H - 2 * m + g) / (ph + g));
    if (cols > 0 && rows > 0 && (!best || cols * rows > best.cols * best.rows)) best = { cols, rows, pw, ph, rot };
  }
  if (!best) { squares.L = { n: 0, W, H }; return; }
  const totW = best.cols * best.pw + (best.cols - 1) * g, totH = best.rows * best.ph + (best.rows - 1) * g;
  const sx = (W - totW) / 2, sy = (H - totH) / 2, cutsX = [], cutsY = [];
  const add = (arr, v) => { if (!arr.some(q => Math.abs(q - v) < 0.01)) arr.push(v); };
  for (let c = 0; c < best.cols; c++) { add(cutsX, sx + c * (best.pw + g)); add(cutsX, sx + c * (best.pw + g) + best.pw); }
  for (let r = 0; r < best.rows; r++) { add(cutsY, sy + r * (best.ph + g)); add(cutsY, sy + r * (best.ph + g) + best.ph); }
  cutsX.sort((a, b) => a - b); cutsY.sort((a, b) => a - b);
  squares.L = { ...best, n: best.cols * best.rows, W, H, sx, sy, totW, totH, cutsX, cutsY, fx0: m, fy0: m, fx1: W - m, fy1: H - m, g };
}
// same order as the business cards: verticals right to left (first one up from the knife), then horizontals
// from the side the verticals ended on, first one left to right
function squaresLines() {
  const L = squares.L, xs = L.cutsX.slice().sort((a, b) => b - a);
  const v = xs.map((x, i) => i % 2 ? [[x, L.fy0], [x, L.fy1]] : [[x, L.fy1], [x, L.fy0]]);
  const endTop = xs.length % 2 === 1, ys = L.cutsY.slice().sort((a, b) => endTop ? a - b : b - a);
  const h = ys.map((y, i) => i % 2 ? [[L.fx1, y], [L.fx0, y]] : [[L.fx0, y], [L.fx1, y]]);
  return [...v, ...h];
}
// markless PLT, origin at the knife = bottom right corner of the sheet, X along the feed
function buildSquaresPlt() {
  const o = readOpts(), L = squares.L, bo = o.bladeOffset * 40, out = ['IN'];
  if (o.pltForce) {
    const ci = (v, a, b) => Math.min(b, Math.max(a, Math.round(v)));
    out.push(`VS${ci(o.cutSpeed, 1, 13)}`, `US${ci(o.upSpeed, 1, 13)}`, `FS${ci(o.dieForce, 1, 160)}`);
  }
  let bdir = [1, 0], maxX = 0;
  for (const ln of squaresLines()) {
    const tip = ln.map(([x, y]) => [(L.H - y) * 40, (L.W - x) * 40]);
    const c = dragKnife(tip, bo, bdir); bdir = c.dir;
    const q = c.pts.map(p => [Math.round(p[0]), Math.round(p[1])]);
    out.push(`U${q[0][0]},${q[0][1]}`, `D${q[0][0]},${q[0][1]}`);
    for (let i = 1; i < q.length; i++) if (q[i][0] !== q[i - 1][0] || q[i][1] !== q[i - 1][1]) out.push(`D${q[i][0]},${q[i][1]}`);
    for (const p of tip) maxX = Math.max(maxX, p[0]);
  }
  out.push(`U${Math.round(maxX + 400)},0`, '@;@;');
  return out.join(' ');
}
function buildSquaresSvg() {
  const o = readOpts(), L = squares.L;
  const s = [`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(L.W)}mm" height="${num(L.H)}mm" viewBox="0 0 ${num(L.W)} ${num(L.H)}">\n`];
  s.push(`<g id="${aiId(o.dieLayer)}">\n`);
  for (const ln of squaresLines()) s.push(pathEl(ln, false, `fill:none;stroke:${o.dieColor};stroke-width:${o.lineW}`) + '\n');
  s.push('</g>\n</svg>\n');
  return s.join('');
}
function renderSquaresPreview() {
  const o = readOpts(), L = squares.L || { n: 0, W: o.sqSheetW, H: o.sqSheetH };
  previewFrame = { x: -8, y: -8, w: L.W + 16, h: L.H + 16 };
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${previewFrame.x} ${previewFrame.y} ${previewFrame.w} ${previewFrame.h}" role="img" aria-label="Squares cutting layout"><rect x="0" y="0" width="${num(L.W)}" height="${num(L.H)}" fill="#fff"/>`];
  if (L.n) {
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) p.push(`<rect x="${num(L.sx + c * (L.pw + L.g))}" y="${num(L.sy + r * (L.ph + L.g))}" width="${num(L.pw)}" height="${num(L.ph)}" fill="#e7f2ed"/>`);
    p.push(`<path d="${squaresLines().map(l => `M${num(l[0][0])} ${num(l[0][1])}L${num(l[1][0])} ${num(l[1][1])}`).join('')}" stroke="${CUT_RED}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
  }
  p.push(`<g transform="translate(${num(L.W)} ${num(L.H)})"><circle r="2.5" fill="#c2410c"/><path d="M-8 -6 L-8 -22 M-11 -18 L-8 -22 L-5 -18" fill="none" stroke="#c2410c" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g></svg>`);
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderSquaresStats(busyText) {
  const L = squares.L, n = L ? L.n : 0;
  ui.dropNote.hidden = true;
  for (const id of ['exSqPlt', 'exSqSvg', 'exSqPdf']) document.getElementById(id).disabled = !n || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = n === 1 ? '1 piece' : `${n} pieces`;
  if (!n) { setCardMsg('The piece doesn’t fit inside the frame.', true); return; }
  const f = v => num(Math.round(v * 10) / 10);
  setCardMsg(`${L.cols} × ${L.rows}${L.rot ? ', turned' : ''}, ${L.cutsX.length + L.cutsY.length} straight cuts. Lines at ${L.cutsX.map(f).join(', ')} mm from the left and ${L.cutsY.map(f).join(', ')} mm from the top. The knife starts at the bottom right corner.`);
}
document.getElementById('exSqPlt').addEventListener('click', () => {
  const L = squares.L, base = `squares-${num(L.pw)}x${num(L.ph)}-${L.n}pcs`;
  saveFile(`${base}-plt.zip`, makeZip([{ name: `${base}.plt`, text: buildSquaresPlt() }]));
});
document.getElementById('exSqSvg').addEventListener('click', () => { const L = squares.L; saveFile(`squares-${num(L.pw)}x${num(L.ph)}-${L.n}pcs-cut.svg`, buildSquaresSvg()); });

/* ---------- cut SVG for SignCut, built 1:1 like the LemurPrints.CutMarks tool ---------- */
// layers: [{ name, color, paths: [{ pts (sheet mm), closed }] }]
function lemurCutSvg(layers) {
  const W = template.wMm, H = template.hMm, sw = num(readOpts().lineW);
  const s = [`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(W)}mm" height="${num(H)}mm" viewBox="0 0 ${num(W)} ${num(H)}">\n`];
  for (const L of layers) {
    s.push(`  <g id="${aiId(L.name)}">\n`);
    for (const p of L.paths) s.push('    ' + pathEl(p.pts, p.closed, `fill:none;stroke:${L.color};stroke-width:${sw}px;`) + '\n');
    s.push('  </g>\n');
  }
  s.push(lemurMarks(W, H, template.feedTop || 0), '</svg>\n');
  return s.join('');
}

/* ---------- cut lines as PDF (vector, one PDF layer per cut layer) ---------- */
const hexRgb = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h) || [0, '00', '00', '00']; return window.PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255); };
// layers: [{ name, color, paths: [{ pts (sheet mm), closed }] }]; marks: true to add the registration marks layers
async function buildCutPdf(Wmm, Hmm, layers, marks) {
  await ensureLibs();
  const { PDFDocument, PDFName, PDFString, PDFOperator, PDFOperatorNames, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create(), ctx = pdf.context, Wpt = Wmm * PT, Hpt = Hmm * PT;
  const page = pdf.addPage([Wpt, Hpt]), props = ctx.obj({}), ocgs = [];
  const layer = (name, draw) => {
    const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(name) }));
    ocgs.push(ref);
    const key = `OC${ocgs.length}`;
    props.set(PDFName.of(key), ref);
    page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of(key)]));
    draw();
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  };
  const d = (pts, closed) => 'M ' + pts.map(q => `${(q[0] * PT).toFixed(3)} ${(q[1] * PT).toFixed(3)}`).join(' L ') + (closed ? ' Z' : '');
  if (marks) {
    const sh = templateShapes(), black = rgb(0, 0, 0);
    layer('scpro2_regmarks', () => { for (const m of sh.filter(x => x.closed && x.fill)) page.drawSvgPath(d(m.pts, true), { x: 0, y: Hpt, color: black }); });
    layer('scpro2_printonly', () => { for (const m of sh.filter(x => !(x.closed && x.fill))) page.drawSvgPath(d(m.pts, m.closed), { x: 0, y: Hpt, borderColor: black, borderWidth: Math.max(0.25, m.sw * PT) }); });
  }
  const lw = Math.max(0.1, readOpts().lineW * PT);
  for (const L of layers) layer(L.name, () => { const c = hexRgb(L.color); for (const p of L.paths) page.drawSvgPath(d(p.pts, p.closed), { x: 0, y: Hpt, borderColor: c, borderWidth: lw }); });
  page.node.Resources().set(PDFName.of('Properties'), props);
  pdf.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: ocgs, D: { Order: ocgs, ON: ocgs } }));
  pdf.setTitle('Cut lines');
  // SignCut only reads plain PDFs: no compressed content streams, no object streams (classic xref table)
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj && typeof obj.getUnencodedContents === 'function' && 'encode' in obj && obj.dict) {
      obj.encode = false;
      obj.dict.delete(PDFName.of('Filter'));
      obj.contentsCache = { access: () => obj.getUnencodedContents() };
    }
  }
  return new Blob([await pdf.save({ useObjectStreams: false })], { type: 'application/pdf' });
}
const pdfClick = (id, name, make) => document.getElementById(id).addEventListener('click', async () => {
  const btn = document.getElementById(id); btn.disabled = true;
  try { await saveFile(name(), await make()); }
  catch (e) { setCardMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
const closedAll = loops => loops.map(pts => ({ pts, closed: true })), openAll = lines => lines.map(pts => ({ pts, closed: false }));
pdfClick('exCutPdf', () => exportName('cut').replace(/\.svg$/, '.pdf'), () => {
  const o = readOpts(), dieName = o.dieLayer === o.kissLayer ? o.dieLayer + ' 2' : o.dieLayer;
  return buildCutPdf(template.wMm, template.hMm, [
    { name: o.kissLayer, color: o.kissColor, paths: closedAll(stickerLoops('kissLoops')) },
    { name: dieName, color: o.dieColor, paths: closedAll(stickerLoops('dieLoops')) }], true);
});
pdfClick('exCardCutPdf', () => `${cardBase()}-cut.pdf`, () => {
  const o = readOpts(), c = cardCuts();
  return buildCutPdf(template.wMm, template.hMm, [{ name: o.dieLayer, color: o.dieColor, paths: [...closedAll(c.loops), ...openAll([...c.folds, ...c.v, ...c.h, ...c.dashes])] }], true);
});
pdfClick('exSqPdf', () => `squares-${num(squares.L.pw)}x${num(squares.L.ph)}-${squares.L.n}pcs-cut.pdf`, () => {
  const o = readOpts();
  return buildCutPdf(squares.L.W, squares.L.H, [{ name: o.dieLayer, color: o.dieColor, paths: openAll(squaresLines()) }], false);
});
pdfClick('exVinylPdf', () => `${appMode === 'pen' ? 'pen' : 'vinyl'}-${vinylLayout.items.length}pcs-cut.pdf`, () => {
  const o = vOpts();
  return buildCutPdf(vinylLayout.W, vinylLayout.L, [{ name: o.kissLayer, color: o.kissColor, paths: vinylPaths() }], false);
});

/* ---------- SVG to PLT: a finished print-and-cut SVG (registration marks + cut lines) to Skycut PLTs ---------- */
const sp = { name: null, text: null, groups: [], vb: null, u: 1, marks: null, markSrc: '', unitless: false, err: '' };
function analyseSvgPlt() {
  sp.groups = []; sp.marks = null; sp.err = ''; sp.markSrc = '';
  if (!sp.text) return;
  let host = null;
  try {
    const doc = parseSvg(sp.text); sanitize(doc); expandUses(doc);
    const root = doc.documentElement, vb = readViewBox(root);
    if (!vb) throw new Error('The SVG has no viewBox or size.');
    const wl = parseLen(root.getAttribute('width'));
    sp.unitless = !(wl && MM_PER[wl.unit]);
    sp.u = sp.unitless ? readOpts().spDpi / 25.4 : vb.w / (wl.n * MM_PER[wl.unit]);
    sp.vb = vb;
    doc.querySelectorAll('image').forEach(n => n.remove());
    host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:1000px;height:1000px;visibility:hidden;pointer-events:none';
    const svg = document.importNode(root, true);
    svg.setAttribute('width', '1000'); svg.setAttribute('height', '1000'); svg.removeAttribute('preserveAspectRatio');
    host.appendChild(svg); document.body.appendChild(host);
    const inv = svg.getScreenCTM().inverse(), u = sp.u, mm = (X, Y) => [(X - vb.x) / u, (Y - vb.y) / u];
    const Wmm = vb.w / u, Hmm = vb.h / u, shapes = [];
    for (const el of svg.querySelectorAll(SHAPES)) {
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue; // (visibility is inherited from the hidden host, so it can't be used)
      let layer = '';
      for (let a = el.parentElement; a && a !== svg; a = a.parentElement) if (a.localName === 'g' && a.id) layer = a.id; // outermost named group
      const fillOn = cs.fill && cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0 && parseFloat(cs.opacity || '1') > 0;
      const strokeOn = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeOpacity || '1') > 0 && parseFloat(cs.opacity || '1') > 0;
      const m = inv.multiply(el.getScreenCTM()), polys = [];
      for (const pl of elementPolys(el)) {
        if (pl.pts.length < 2) continue;
        const f = pl.pts[0], l = pl.pts[pl.pts.length - 1];
        // a path that returns to its start: the last point duplicates the first, so drop it once (never a real corner)
        if (pl.pts.length > 2 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) { pl.closed = true; pl.pts.pop(); }
        polys.push({ pts: pl.pts.map(([x, y]) => mm(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f)), closed: pl.closed });
      }
      if (!polys.length) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const pl of polys) for (const [x, y] of pl.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      shapes.push({ el, layer, fillOn, strokeOn, stroke: toHex(cs.stroke), polys, box: [x0, y0, x1, y1] });
    }
    // registration marks: the regmarks layer, or else small filled bars near the four corners (SignCut L-marks)
    let markShapes = shapes.filter(s => /regmark/i.test(s.layer));
    if (markShapes.length) sp.markSrc = `layer ${decodeLayer(markShapes[0].layer)}`;
    else {
      const near = s => { const [x0, y0, x1, y1] = s.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; return (cx < 40 || cx > Wmm - 40) && (cy < 40 || cy > Hmm - 40); };
      markShapes = shapes.filter(s => s.fillOn && !/printonly/i.test(s.layer) && near(s) && Math.max(s.box[2] - s.box[0], s.box[3] - s.box[1]) <= 25 && Math.min(s.box[2] - s.box[0], s.box[3] - s.box[1]) <= 3);
      const corners = new Set(markShapes.map(s => `${(s.box[0] + s.box[2]) / 2 < Wmm / 2 ? 'L' : 'R'}${(s.box[1] + s.box[3]) / 2 < Hmm / 2 ? 'T' : 'B'}`));
      if (corners.size < 4) markShapes = [];
      else sp.markSrc = 'shapes in the four corners';
    }
    if (markShapes.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, t = Infinity;
      for (const s of markShapes) { const [a, b, c, d] = s.box; x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); t = Math.min(t, c - a, d - b); }
      // mark centres in document units (what buildPlt expects)
      sp.marks = { left: (x0 + t / 2) * u + vb.x, right: (x1 - t / 2) * u + vb.x, top: (y0 + t / 2) * u + vb.y, bottom: (y1 - t / 2) * u + vb.y, thick: t, box: [x0, y0, x1, y1] };
    } else sp.err = 'No registration marks found: no regmarks layer and no L-marks in all four corners.';
    // cut lines: stroked and unfilled, outside the marks and print-only layers
    const markSet = new Set(markShapes), groups = new Map(), o = readOpts();
    for (const s of shapes) {
      if (markSet.has(s) || /regmark|printonly/i.test(s.layer) || !s.strokeOn || s.fillOn) continue;
      const key = s.layer ? decodeLayer(s.layer) : `Colour ${s.stroke}`;
      if (!groups.has(key)) groups.set(key, { name: key, color: s.stroke, paths: [], include: true, force: /die|przel|through|full|wykroj/i.test(key) ? o.dieForce : o.kissForce });
      for (const pl of s.polys) groups.get(key).paths.push({ pts: pl.closed ? simplifyLoop(pl.pts, 0.02) : rdp(pl.pts, 0.02), closed: pl.closed });
    }
    sp.groups = [...groups.values()];
    sp.W = Wmm; sp.H = Hmm;
    if (!sp.groups.length && !sp.err) sp.err = 'No cut lines found: cut lines need a stroke and no fill.';
  } catch (e) {
    sp.err = e.message || String(e);
  } finally {
    if (host) host.remove();
  }
  spRenderGroups();
}
function spRenderGroups() {
  const box = document.getElementById('spGroups');
  document.getElementById('rowSpDpi').hidden = !sp.text || !sp.unitless;
  if (!sp.groups.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<table class="modt"><thead><tr><th></th><th>Cut group</th><th>Lines</th><th>Length</th><th>Force g</th></tr></thead><tbody>${sp.groups.map((g, i) =>
    `<tr><td><input type="checkbox" data-i="${i}" class="spInc" ${g.include ? 'checked' : ''} aria-label="Cut ${esc(g.name)}"></td><td title="${esc(g.name)}"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${g.color};margin-right:5px"></span>${esc(g.name)}</td><td>${g.paths.length}</td><td>${num(Math.round(g.paths.reduce((s, p) => s + pathLen(p), 0) / 100) / 10)} m</td><td><input type="number" min="1" max="160" step="1" data-i="${i}" class="spF" value="${g.force}" aria-label="Force for ${esc(g.name)}"></td></tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('.spInc').forEach(c => c.addEventListener('change', () => { sp.groups[+c.dataset.i].include = c.checked; renderPreview(); renderStats(); }));
  box.querySelectorAll('.spF').forEach(c => c.addEventListener('input', () => { const v = parseFloat(c.value); if (isFinite(v)) sp.groups[+c.dataset.i].force = v; }));
}
async function spLoad(file) {
  if (!file) return;
  renderSvgPltStats('Reading the SVG…');
  await tick();
  try { sp.text = await file.text(); sp.name = file.name.replace(/\.svg$/i, ''); }
  catch (e) { sp.err = `Couldn’t read ${file.name}.`; }
  analyseSvgPlt();
  view = null;
  renderPreview(); renderStats();
}
function spPlt(group) {
  const loops = group.paths.filter(p => p.closed && p.pts.length > 2).map(p => p.pts), open = group.paths.filter(p => !p.closed).map(p => p.pts);
  return writePlt(markFrame(sp), pltOpts(readOpts(), group.force), loops, open);
}
function renderSvgPltPreview() {
  if (!sp.vb) { previewFrame = { x: -8, y: -8, w: 326, h: 456 }; ui.stage.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 326 456"><rect x="0" y="0" width="310" height="440" fill="#fff"/></svg>`; applyView(); return; }
  const W = sp.W, H = sp.H;
  previewFrame = { x: -8, y: -8, w: W + 16, h: H + 16 };
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${previewFrame.x} ${previewFrame.y} ${previewFrame.w} ${previewFrame.h}" role="img" aria-label="SVG with cut lines"><rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="#fff"/>`];
  if (ui.showArt.checked) p.push(`<image href="${dataUri(windowSvg(sp.text, sp.vb.x, sp.vb.y, sp.vb.w, sp.vb.h, Math.round(W * 4), Math.round(H * 4)))}" x="0" y="0" width="${num(W)}" height="${num(H)}" preserveAspectRatio="none" opacity="0.55"/>`);
  for (const g of sp.groups) if (g.include) p.push(`<path d="${g.paths.map(q => 'M' + q.pts.map(v => num(v[0]) + ' ' + num(v[1])).join('L') + (q.closed ? 'Z' : '')).join('')}" fill="none" stroke="${g.color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`);
  if (sp.marks) {
    const mk = sp.marks, u = sp.u, X = v => (v - sp.vb.x) / u, Y = v => (v - sp.vb.y) / u;
    for (const [x, y] of [[mk.left, mk.top], [mk.right, mk.top], [mk.left, mk.bottom], [mk.right, mk.bottom]]) p.push(`<circle cx="${num(X(x))}" cy="${num(Y(y))}" r="3" fill="none" stroke="#c2410c" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`);
    p.push(`<circle cx="${num(X(mk.right))}" cy="${num(Y(mk.bottom))}" r="1.2" fill="#c2410c"/>`);
  }
  p.push('</svg>');
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderSvgPltStats(busyText) {
  const inc = sp.groups.filter(g => g.include), n = inc.reduce((s, g) => s + g.paths.length, 0);
  ui.dropNote.hidden = !!sp.text;
  document.getElementById('exSpPlt').disabled = !sp.marks || !n || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = !sp.text ? 'No SVG loaded' : `${n} cut ${n === 1 ? 'line' : 'lines'} in ${inc.length} ${inc.length === 1 ? 'group' : 'groups'}`;
  if (!sp.text) { setCardMsg(''); return; }
  const notes = [`${sp.name}: ${num(Math.round(sp.W * 10) / 10)} × ${num(Math.round(sp.H * 10) / 10)} mm${sp.unitless ? ` (no size in the file, read as ${readOpts().spDpi === 25.4 ? 'mm' : readOpts().spDpi + ' per inch'})` : ''}.`];
  if (sp.marks) {
    const mk = sp.marks, f = v => num(Math.round(v / sp.u * 10) / 10);
    notes.push(`Marks from the ${sp.markSrc}: ${f(mk.right - mk.left)} × ${f(mk.bottom - mk.top)} mm between centres, ${num(Math.round(mk.thick * 10) / 10)} mm thick. The knife origin is the bottom-right mark.`);
    if (Math.abs(mk.thick - 1) > 0.3) notes.push('The marks aren’t 1 mm thick: check the file’s units before cutting.');
  }
  if (sp.err) notes.push(sp.err);
  setCardMsg(notes.join(' '), !!sp.err);
}
document.getElementById('spFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; spLoad(f); });
document.getElementById('spDpi').addEventListener('change', () => { analyseSvgPlt(); view = null; renderPreview(); renderStats(); });
document.getElementById('exSpPlt').addEventListener('click', () => {
  const slug = s => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'cut';
  const files = sp.groups.filter(g => g.include).map(g => ({ name: `${sp.name}-${slug(g.name)}.plt`, text: spPlt(g) }));
  saveFile(`${sp.name}-plt.zip`, makeZip(files));
});

/* ---------- PLT modifier ---------- */
const modFiles = [];
const MOD_KEYS = [['force', 'modForce', 1, 160], ['speed', 'modSpeed', 1, 13], ['up', 'modUp', 1, 13]];
function modRender() {
  const box = document.getElementById('modTable');
  document.getElementById('exMod').disabled = !modFiles.length;
  // the 'all files' fields show the common value, or say the files differ
  for (const [k, id] of MOD_KEYS) {
    const vals = [...new Set(modFiles.map(f => f[k]))], el = document.getElementById(id);
    el.value = vals.length === 1 && vals[0] != null ? vals[0] : '';
    el.placeholder = !modFiles.length ? '' : vals.length > 1 ? 'differs' : 'not set';
  }
  if (!modFiles.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<table class="modt"><thead><tr><th>File</th><th>Force g</th><th>Speed</th><th>Up</th></tr></thead><tbody>${modFiles.map((f, i) =>
    `<tr><td title="${esc(f.name)}">${esc(f.name)}</td>${MOD_KEYS.map(([k, , lo, hi]) => `<td><input type="number" min="${lo}" max="${hi}" step="1" data-i="${i}" data-k="${k}" value="${f[k] ?? ''}" placeholder="–" aria-label="${k} for ${esc(f.name)}"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
    const x = parseFloat(inp.value);
    modFiles[+inp.dataset.i][inp.dataset.k] = isFinite(x) ? x : null;
    const k = inp.dataset.k, id = MOD_KEYS.find(m => m[0] === k)[1], vals = [...new Set(modFiles.map(f => f[k]))], el = document.getElementById(id);
    el.value = vals.length === 1 && vals[0] != null ? vals[0] : ''; el.placeholder = vals.length > 1 ? 'differs' : 'not set';
  }));
}
for (const [k, id] of MOD_KEYS) document.getElementById(id).addEventListener('input', e => {
  const x = parseFloat(e.target.value);
  if (!isFinite(x)) return;
  for (const f of modFiles) f[k] = x;
  document.querySelectorAll(`#modTable input[data-k="${k}"]`).forEach(inp => { inp.value = x; });
});
document.getElementById('modFile').addEventListener('change', async e => {
  const list = Array.from(e.target.files); e.target.value = '';
  modFiles.length = 0;
  try {
    for (const f of list) {
      if (/\.zip$/i.test(f.name)) modFiles.push(...await readZipPlts(await f.arrayBuffer()));
      else modFiles.push({ name: f.name, text: await f.text() });
    }
    for (const f of modFiles) Object.assign(f, pltValues(f.text));
    if (!modFiles.length) setCardMsg('No PLT files found.', true);
  } catch (err) { setCardMsg(`Couldn’t read: ${err.message || err}`, true); }
  modRender();
});
document.getElementById('exMod').addEventListener('click', () => {
  const twice = document.getElementById('modTwice').checked, clean = document.getElementById('modClean').checked;
  try {
    const notes = [];
    const out = modFiles.map(f => {
      const m = { force: f.force, speed: f.speed, up: f.up, twice, clean };
      const text = modifyPlt(f.text, m);
      if (m.counts) notes.push(`${f.name}: ${m.counts[0].toLocaleString()} → ${m.counts[1].toLocaleString()} moves`);
      return { name: f.name, text };
    });
    saveFile('modified-plt.zip', makeZip(out));
    if (notes.length) setCardMsg(notes.join('; ') + '.');
  } catch (err) { setCardMsg(`Couldn’t modify: ${err.message || err}`, true); }
});

/* ---------- duplex test: two pages with frames and PAGE 1 / PAGE 2 ---------- */
function duplexSize() {
  const sel = document.getElementById('dxSize').value;
  if (sel === 'custom') {
    const w = parseFloat(document.getElementById('dxW').value), h = parseFloat(document.getElementById('dxH').value);
    return [isFinite(w) && w >= 50 ? w : 210, isFinite(h) && h >= 50 ? h : 297];
  }
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(sel);
  return m ? [+m[1], +m[2]] : [210, 297];
}
const DX_FRAMES = [5, 10]; // frame insets, mm
function renderDuplexPreview() {
  const [W, H] = duplexSize(), n = document.getElementById('showBack').checked ? 2 : 1, fs = Math.min(W, H) * 0.12;
  previewFrame = { x: -8, y: -8, w: W + 16, h: H + 16 };
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${previewFrame.x} ${previewFrame.y} ${previewFrame.w} ${previewFrame.h}" role="img" aria-label="Duplex test page ${n}"><rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="#fff"/>`];
  for (const i of DX_FRAMES) p.push(`<rect x="${i}" y="${i}" width="${num(W - 2 * i)}" height="${num(H - 2 * i)}" fill="none" stroke="#000" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
  p.push(`<path d="M${num(W / 2)} 10V${num(H - 10)}M10 ${num(H / 2)}H${num(W - 10)}" stroke="#000" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`);
  p.push(`<text x="${num(W / 2)}" y="${num(H / 2 - fs * 0.25)}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${num(fs)}" text-anchor="middle">PAGE ${n}</text>`);
  p.push(`<text x="${num(W / 2)}" y="16" font-family="Helvetica, Arial, sans-serif" font-size="4" text-anchor="middle">TOP</text></svg>`);
  ui.stage.innerHTML = p.join('');
  applyView();
}
function renderDuplexStats() {
  const [W, H] = duplexSize();
  ui.dropNote.hidden = true;
  ui.count.textContent = `Duplex test, ${num(W)} × ${num(H)} mm`;
  setCardMsg('Two pages with the same frames (5 and 10 mm from the edge), a centre cross, PAGE 1 / PAGE 2 and TOP. Print double-sided and hold the sheet against the light: where the back’s frames sit relative to the front’s is the offset to correct (Back shift). Back side shows page 2.');
}
async function buildDuplexPdf() {
  await ensureLibs();
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const [W, H] = duplexSize(), Wpt = W * PT, Hpt = H * PT, black = rgb(0, 0, 0);
  const out = await PDFDocument.create(), bold = await out.embedFont(StandardFonts.HelveticaBold), font = await out.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) {
    const page = out.addPage([Wpt, Hpt]);
    for (const i of DX_FRAMES) page.drawRectangle({ x: i * PT, y: i * PT, width: (W - 2 * i) * PT, height: (H - 2 * i) * PT, borderColor: black, borderWidth: 0.5 });
    page.drawLine({ start: { x: Wpt / 2, y: 10 * PT }, end: { x: Wpt / 2, y: Hpt - 10 * PT }, thickness: 0.3, color: black });
    page.drawLine({ start: { x: 10 * PT, y: Hpt / 2 }, end: { x: Wpt - 10 * PT, y: Hpt / 2 }, thickness: 0.3, color: black });
    const label = `PAGE ${n}`, size = Math.min(W, H) * 0.12 * PT, lw = bold.widthOfTextAtSize(label, size);
    page.drawText(label, { x: (Wpt - lw) / 2, y: Hpt / 2 + size * 0.25, size, font: bold, color: black });
    const top = 'TOP', tw = font.widthOfTextAtSize(top, 11);
    page.drawText(top, { x: (Wpt - tw) / 2, y: Hpt - 16 * PT, size: 11, font, color: black });
  }
  out.setTitle(`Duplex test ${num(W)} x ${num(H)} mm`);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
document.getElementById('dxSize').addEventListener('change', () => { document.getElementById('rowDxCustom').hidden = document.getElementById('dxSize').value !== 'custom'; view = null; schedule(); });
for (const id of ['dxW', 'dxH']) document.getElementById(id).addEventListener('input', () => { view = null; schedule(); });
document.getElementById('exDuplex').addEventListener('click', async () => {
  const [W, H] = duplexSize();
  try { await saveFile(`duplex-test-${num(W)}x${num(H)}.pdf`, await buildDuplexPdf()); }
  catch (e) { setCardMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
});

// show or hide the rows that depend on other fields' values
function syncOptionRows() {
  syncPerf();
  document.getElementById('rowDxCustom').hidden = document.getElementById('dxSize').value !== 'custom';
  document.getElementById('rowGPageCustom').hidden = document.getElementById('gPage').value !== 'custom';
  document.getElementById('rowGGCustom').hidden = document.getElementById('ggFormat').value !== 'custom';
  document.getElementById('rowGGGap').hidden = document.getElementById('ggAuto').checked;
  syncImgRows();
  syncPerfDie();
  syncWinRows();
}
// Saved settings: the mode plus every option field.
function snapshotSettings() { return { mode: appMode, settings: optionValues() }; }
function applySettings({ mode, settings }) {
  for (const id of OPT_IDS) {
    if (!Object.hasOwn(settings, id)) continue;
    const e = document.getElementById(id);
    if (e.type === 'checkbox') e.checked = !!settings[id]; else e.value = String(settings[id]);
  }
  syncOptionRows();
  if (!template || template.generated) applySheetSize(); // a template you loaded yourself stays
  else if (template.unitless) setTemplate(template.text, template.name, false);
  saveOpts();
  if (cards.imgSrc) rebuildCardImages();
  if (sp.text) analyseSvgPlt();
  setAppMode(mode);
  if (winNamesOn()) winNamesChanged();
}

loadOpts();
syncOptionRows();
applySheetSize();
ui.list.innerHTML = '<li class="empty">No stickers yet.</li>';
renderPreview();
run();
initPresets({ snapshot: snapshotSettings, apply: applySettings });
