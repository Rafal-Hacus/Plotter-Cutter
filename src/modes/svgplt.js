// SVG to PLT: a finished print-and-cut SVG (registration marks plus cut lines) turned into Skycut PLTs, one per
// cut layer or stroke colour.
import { rdp, simplifyLoop } from '../core/geometry.js';
import { writePlt } from '../core/plt.js';
import { sanitize } from '../core/sanitize.js';
import { MM_PER, SHAPES, dataUri, decodeLayer, elementPolys, esc, expandUses, mm1, num, parseLen, parseSvg, pathLen, readViewBox, toHex, windowSvg } from '../core/svg.js';
import { tick } from '../core/util.js';
import { makeZip } from '../core/zip.js';
import { byId, saveFile, setMsg, ui } from '../dom.js';
import { pltOpts } from '../export/files.js';
import { registerMode } from './registry.js';
import { renderPreview, renderStats } from '../pipeline.js';
import { readOpts } from '../settings.js';
import { state } from '../state.js';
import { markFrame } from '../template.js';
import { applyView } from '../viewport.js';

export const sp = { name: null, text: null, groups: [], vb: null, u: 1, marks: null, markSrc: '', unitless: false, err: '' };
export function analyseSvgPlt() {
  sp.groups = []; sp.marks = null; sp.err = ''; sp.markSrc = ''; sp.vb = null;
  if (!sp.text) { spRenderGroups(); return; }
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
  const box = byId('spGroups');
  byId('rowSpDpi').hidden = !sp.text || !sp.unitless;
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
  sp.name = file.name.replace(/\.svg$/i, '');
  try { sp.text = await file.text(); }
  catch (e) { sp.text = null; }
  analyseSvgPlt();
  if (sp.text == null) sp.err = `Couldn’t read ${file.name}.`;
  state.view = null;
  renderPreview(); renderStats();
}
function spPlt(group) {
  const loops = group.paths.filter(p => p.closed && p.pts.length > 2).map(p => p.pts), open = group.paths.filter(p => !p.closed).map(p => p.pts);
  return writePlt(markFrame(sp), pltOpts(readOpts(), group.force), loops, open);
}
function renderSvgPltPreview() {
  if (!sp.vb) { state.previewFrame = { x: -8, y: -8, w: 326, h: 456 }; ui.stage.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 326 456"><rect x="0" y="0" width="310" height="440" fill="#fff"/></svg>`; applyView(); return; }
  const W = sp.W, H = sp.H;
  state.previewFrame = { x: -8, y: -8, w: W + 16, h: H + 16 };
  const p = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${state.previewFrame.x} ${state.previewFrame.y} ${state.previewFrame.w} ${state.previewFrame.h}" role="img" aria-label="SVG with cut lines"><rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="#fff"/>`];
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
  byId('exSpPlt').disabled = !sp.marks || !n || !!busyText;
  if (busyText) { ui.count.textContent = busyText; return; }
  ui.count.textContent = !sp.vb ? 'No SVG loaded' : `${n} cut ${n === 1 ? 'line' : 'lines'} in ${inc.length} ${inc.length === 1 ? 'group' : 'groups'}`;
  if (!sp.text && !sp.err) { setMsg(''); return; }
  const notes = [];
  if (sp.vb) notes.push(`${sp.name}: ${mm1(sp.W)} × ${mm1(sp.H)} mm${sp.unitless ? ` (no size in the file, read as ${readOpts().spDpi === 25.4 ? 'mm' : readOpts().spDpi + ' per inch'})` : ''}.`);
  else notes.push(`${sp.name}:`);
  if (sp.marks) {
    const mk = sp.marks, f = v => mm1(v / sp.u);
    notes.push(`Marks from the ${sp.markSrc}: ${f(mk.right - mk.left)} × ${f(mk.bottom - mk.top)} mm between centres, ${mm1(mk.thick)} mm thick. The knife origin is the bottom-right mark.`);
    if (Math.abs(mk.thick - 1) > 0.3) notes.push('The marks aren’t 1 mm thick: check the file’s units before cutting.');
  }
  if (sp.err) notes.push(sp.err);
  setMsg(notes.join(' '), !!sp.err);
}
byId('spFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; spLoad(f); });
byId('spDpi').addEventListener('change', () => { analyseSvgPlt(); state.view = null; renderPreview(); renderStats(); });
byId('exSpPlt').addEventListener('click', () => {
  const slug = s => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'cut';
  // groups whose names come out the same get a number, so no file in the zip replaces another
  const used = new Map();
  const files = sp.groups.filter(g => g.include).map(g => {
    const base = slug(g.name), n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return { name: `${sp.name}-${base}${n > 1 ? `-${n}` : ''}.plt`, text: spPlt(g) };
  });
  saveFile(`${sp.name}-plt.zip`, makeZip(files));
});
registerMode('svgplt', { renderPreview: renderSvgPltPreview, renderStats: renderSvgPltStats, onDrop: files => spLoad(files[0]) });
