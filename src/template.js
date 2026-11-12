import { CELL, edt } from './core/geometry.js';
import { makeMarksTemplate } from './core/marks.js';
import { sanitize } from './core/sanitize.js';
import { MM_PER, XLINK, loadImg, num, parseLen, parseSvg, readViewBox, sizedSvg, splitRoot } from './core/svg.js';
import { ui } from './dom.js';
import { readOpts } from './settings.js';
import { state } from './state.js';

function sheetSizeMm() {
  const o = readOpts();
  if (o.sheetSize === 'custom') return [o.sheetW, o.sheetH];
  const m = /^(\d+)x(\d+)$/.exec(o.sheetSize);
  return m ? [+m[1], +m[2]] : [310, 440];
}
export function applySheetSize() {
  const [W, H] = sheetSizeMm(), o = readOpts(), T = o.sheetFeed ? Math.max(0, Math.min(o.sheetFeedMm, H - 80)) : 0;
  document.getElementById('rowSheetCustom').hidden = o.sheetSize !== 'custom';
  document.getElementById('rowSheetFeed').hidden = !o.sheetFeed;
  setTemplate(makeMarksTemplate(W, H, T), T ? `Generated SignCut marks, ${num(T)} mm blank strip at the top` : 'Generated SignCut marks', true);
  state.template.generated = true;
  state.template.feedTop = T;
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
export async function templateSheet(o) {
  const t = state.template;
  const Gw = Math.ceil(t.wMm / CELL), Gh = Math.ceil(t.hMm / CELL);
  const key = [t.name, t.u, o.clearance].join('|');
  if (state.sheetCache && state.sheetCache.key === key) return state.sheetCache;
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
  state.sheetCache = { key, Gw, Gh, blocked, free: fx1 >= 0 ? { x0: fx0, y0: fy0, x1: fx1, y1: fy1 } : null };
  return state.sheetCache;
}
export function setTemplate(text, name, isDefault) {
  const o = readOpts();
  state.template = prepareTemplate(text, name, o.dpi);
  state.sheetCache = null;
  state.view = null;
  ui.tplReset.hidden = !!isDefault;
  ui.dpiRow.hidden = !state.template.unitless;
  ui.sheetInfo.textContent = `${name}${isDefault ? '' : ' template'}: ${num(Math.round(state.template.wMm * 10) / 10)} × ${num(Math.round(state.template.hMm * 10) / 10)} mm.`;
}
