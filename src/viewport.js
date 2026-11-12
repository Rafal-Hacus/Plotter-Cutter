import { $, ui } from './dom.js';
import { state } from './state.js';

/* ---------- zoom & pan on the sheet preview ---------- */
// view = visible part of the sheet in template units (same aspect as the sheet); null = whole sheet.
let pan = null;
function fullView() { const v = state.previewFrame || state.template.vb; return { x: v.x, y: v.y, w: v.w, h: v.h }; }
function clampView(v) {
  const f = fullView(), minW = f.w / 40;
  if (v.w >= f.w) return null;
  if (v.w < minW) { const s = minW / v.w; v = { x: v.x, y: v.y, w: minW, h: v.h * s }; }
  v.x = Math.min(Math.max(v.x, f.x), f.x + f.w - v.w);
  v.y = Math.min(Math.max(v.y, f.y), f.y + f.h - v.h);
  return v;
}
export function applyView() {
  const svg = ui.stage.querySelector('svg');
  if (!svg || !state.template) return;
  const v = state.view || fullView();
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  $('#zLbl').textContent = Math.round(fullView().w / v.w * 100) + '%';
  ui.stage.classList.toggle('zoomed', !!state.view);
}
function svgPoint(svg, cx, cy) {
  const m = svg.getScreenCTM().inverse();
  return { x: m.a * cx + m.c * cy + m.e, y: m.b * cx + m.d * cy + m.f };
}
function zoomAt(factor, cx, cy) {
  const svg = ui.stage.querySelector('svg');
  if (!svg || !state.template) return;
  const v = state.view || fullView();
  const p = cx == null ? { x: v.x + v.w / 2, y: v.y + v.h / 2 } : svgPoint(svg, cx, cy);
  const nw = v.w / factor, nh = v.h / factor;
  state.view = clampView({ x: p.x - (p.x - v.x) * (nw / v.w), y: p.y - (p.y - v.y) * (nh / v.h), w: nw, h: nh });
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
  if (!svg || !state.view || e.button !== 0) return;
  const r = svg.getBoundingClientRect(), v = state.view;
  const scale = Math.min(r.width / v.w, r.height / v.h);
  pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, v: { ...v }, scale };
  ui.stage.setPointerCapture(e.pointerId);
  ui.stage.classList.add('panning');
});
ui.stage.addEventListener('pointermove', e => {
  if (!pan || e.pointerId !== pan.id) return;
  state.view = clampView({ ...pan.v, x: pan.v.x - (e.clientX - pan.sx) / pan.scale, y: pan.v.y - (e.clientY - pan.sy) / pan.scale });
  applyView();
});
const endPan = e => { if (pan && e.pointerId === pan.id) { pan = null; ui.stage.classList.remove('panning'); } };
ui.stage.addEventListener('pointerup', endPan);
ui.stage.addEventListener('pointercancel', endPan);
ui.stage.addEventListener('dblclick', () => { state.view = null; applyView(); });
ui.stage.title = 'Scroll to zoom, drag to move, double-click to fit';
$('#zIn').addEventListener('click', () => zoomAt(1.5));
$('#zOut').addEventListener('click', () => zoomAt(1 / 1.5));
$('#zFit').addEventListener('click', () => { state.view = null; applyView(); });
