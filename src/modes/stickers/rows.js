// The list of designs in the side panel: one row per design with its size, copies and status.
// The vinyl and pen modes use the same list.
import { detectCircle } from '../../core/image.js';
import { mm1, num } from '../../core/svg.js';
import { CUT_RED, EMPTY_LIST, ui } from '../../dom.js';
import { rebuildCircle } from './index.js';
import { isMarkless, vOpts } from '../vinyl.js';
import { schedule } from '../../pipeline.js';
import { readOpts } from '../../settings.js';
import { designs, state } from '../../state.js';

function thumbSvg(d) {
  if (isMarkless() && d.vres) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(d.vres.boxW)} ${num(d.vres.boxH)}"><path d="${d.vres.pathD}" fill="rgba(35,31,32,.15)" fill-rule="evenodd" stroke="${CUT_RED}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
  if (!d.res) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${d.vb.x} ${d.vb.y} ${d.vb.w} ${d.vb.h}"><image href="${d.url}" x="${d.vb.x}" y="${d.vb.y}" width="${d.vb.w}" height="${d.vb.h}" preserveAspectRatio="none"/></svg>`;
  const r = d.res;
  const im = `<image href="${r.cutMode ? d.urlNoCut : d.url}" x="${num(r.offX)}" y="${num(r.offY)}" width="${num(r.artW)}" height="${num(r.artH)}" preserveAspectRatio="none"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(r.boxW)} ${num(r.boxH)}">${r.cutMode ? `<clipPath id="tc${d.id}"><path d="${r.clipD}"/></clipPath><g clip-path="url(#tc${d.id})">${im}</g>` : im}<path d="${r.dieD}" fill="none" stroke="${CUT_RED}" stroke-width="1" stroke-dasharray="2 1.2" vector-effect="non-scaling-stroke"/><path d="${r.kissD}" fill="none" stroke="${CUT_RED}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
}
// The height that puts the design at its real size in the file, for what the height applies to: the shapes in vinyl
// and pen (known once they are read), the cut line in cut mode, else the whole artwork. null if not known (yet).
export function realHeight(d) {
  if (!d.fileMm || !d.mmPerUnit) return null;
  if (isMarkless()) return d.vShapeH ? d.mmPerUnit * d.vShapeH : null;
  return d.mmPerUnit * ((d.mode === 'cut' && d.cutBox) || d.vb).h;
}
// what the file says it measures, next to the height, and how that was read when it wasn't in mm
function fileSizeText(d) {
  if (!d.fileMm) return 'file: no usable size';
  return `file ${mm1(d.fileMm.w)} × ${mm1(d.fileMm.h)} mm${d.sizeNote ? ` · ${d.sizeNote}` : ''}`;
}
export function updateRow(d) {
  if (!d.ui) return;
  d.ui.thumb.innerHTML = thumbSvg(d);
  // the height may have been set for the design (vinyl starts at the shapes' real size): show it, unless being typed
  const hIn = d.ui.li && d.ui.li.querySelector('.h');
  if (hIn && document.activeElement !== hIn) hIn.value = mm1(d.heightMm);
  if (d.ui.fsize) {
    d.ui.fsize.textContent = fileSizeText(d);
    d.ui.fsize.classList.toggle('warn', !!d.sizeGuessed);
    const rh = realHeight(d);
    d.ui.real.hidden = !d.fileMm;
    d.ui.real.title = rh ? `Height back to ${mm1(rh)} mm, the size in the file` : 'Height back to the size in the file';
  }
  const st = d.ui.status;
  // a file with no usable size of its own: said first, whatever the mode
  const sizeWarn = !d.fileMm && d.sizeNote ? d.sizeNote + '. ' : '';
  if (isMarkless()) {
    st.classList.toggle('err', !!d.verr);
    if (d.verr) { st.textContent = d.verr; return; }
    if (d.busy || !d.vres) { st.textContent = 'Reading the shapes…'; return; }
    const r = d.vres, n = state.vinylLayout ? state.vinylLayout.counts.get(d.id) || 0 : 0;
    st.textContent = `${sizeWarn}${state.mode === 'pen' ? 'Drawing' : 'Cut'} ${mm1(r.frW)} × ${mm1(r.frH)} mm, ${r.nPaths} paths. ${n === 1 ? `1 on the ${state.mode === 'pen' ? 'sheet' : 'vinyl'}.` : `${n} on the ${state.mode === 'pen' ? 'sheet' : 'vinyl'}.`}${vOpts().vMirror ? ' Mirrored.' : ''}`;
    if (r.texts) st.textContent += ` ${r.texts} text ${r.texts === 1 ? 'element is' : 'elements are'} left out: convert text to curves (outlines) in the SVG.`;
    if (r.strokes && state.mode !== 'pen') st.textContent += ` ${r.strokes === 1 ? '1 shape is' : `${r.strokes} shapes are`} only a thick stroke: the knife follows the middle of the stroke, not its edges. Convert strokes to outlines to cut them as drawn.`;
    return;
  }
  st.classList.toggle('err', !!d.error);
  if (d.error) { st.textContent = d.error; return; }
  if (d.busy || !d.res) { st.textContent = 'Tracing outline…'; return; }
  const r = d.res, bits = [];
  if (sizeWarn) bits.push(sizeWarn.trim());
  bits.push(`${r.cutMode ? 'Cut line' : 'Art'} ${mm1(r.frW)} × ${mm1(r.frH)} mm, die cut ${mm1(r.cutW)} × ${mm1(r.cutH)} mm.`);
  if (state.layout) { const n = state.layout.counts.get(d.id) || 0; bits.push(n === 1 ? '1 on the sheet.' : `${n} on the sheet.`); }
  const c = d.circle;
  if (c && c.kind === 'round') bits.push(c.found ? 'Round sticker: the cut circle was placed on the circle found in the PDF (2 % inside its edge); adjust it below if needed.' : 'Round sticker: no clear circle found in the PDF, so the cut circle is centred at 90 % of the page; adjust it below.');
  else if (c && c.kind === 'cut') bits.push(`Kiss cut along the line drawn in the PDF${c.cutLines.length > 1 ? ` (${c.cutLines.length} lines)` : ''}.${c.spotCut ? ' Its spot colour (CutContour) is left out of the print.' : c.hidLayer ? ' Its layer is left out of the print.' : ' It is part of the page, so it prints too: put it on a layer of its own named Cut or CutContour to keep it off the print.'}`);
  else if (c) bits.push('Kiss cut traced around the artwork, with the border set under Cut lines.');
  else if (r.cutMode) bits.push('Kiss cut follows the line in the file; everything outside the easy-peel margin is cropped off.');
  if (r.bleedShort) bits.push('The image doesn’t reach the die line everywhere, so parts of the easy-peel margin will print white.');
  if (r.joined) bits.push('Nearby parts joined into one shape.');
  { const want = readOpts().quality === 'fine' ? 20 : 10; if (r.ppm < want) bits.push(`Large design: outline traced at ${num(Math.round(100 / r.ppm) / 100)} mm instead of ${num(1 / want)} mm.`); }
  if (r.parts > 1) bits.push(`${r.parts} separate parts further apart than the join distance, each gets its own kiss cut.`);
  bits.push(...d.warns);
  st.textContent = bits.join(' ');
}
export function addRow(d) {
  const li = document.createElement('li');
  li.className = 'design';
  li.innerHTML = `<div class="thumb"></div>
    <div><div class="dname"></div>
      <div class="fields">
        <label class="hl">Height, mm<input type="number" min="1" step="0.5" class="h"></label>
        <div class="realsz"><span class="fsize"></span><button type="button" class="link real">real size</button></div>
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
  hIn.value = mm1(d.heightMm);
  rm.setAttribute('aria-label', `Remove ${d.name}`);
  const mIn = li.querySelector('.m');
  mIn.value = d.mode;
  const c = d.circle;
  if (c) {
    // a sticker from a PDF: the kiss cut along the PDF's line, traced around the artwork, or a circle
    mIn.insertAdjacentHTML('beforeend', '<option value="round">Circle (round sticker)</option>');
    mIn.value = c.kind;
    if (!c.cutLines.length) { mIn.querySelector('[value=cut]').disabled = true; mIn.title = 'No cut line (a stroked, unfilled closed line) in this PDF'; }
  } else if (!d.canCut) { mIn.querySelector('[value=cut]').disabled = true; mIn.title = 'No stroked, unfilled line found in this file'; }
  const hl = li.querySelector('.hl').firstChild;
  const setHl = () => { hl.textContent = c && c.kind === 'round' ? 'Sticker Ø (cut line), mm' : d.mode === 'cut' ? 'Cut line height, mm' : 'Height, mm'; };
  setHl();
  if (c) {
    // a round sticker's circle: its size and position on the page are set here
    const box = li.querySelector('.circ'), cs = box.querySelector('.cs'), cx = box.querySelector('.cx'), cy = box.querySelector('.cy');
    box.hidden = c.kind !== 'round';
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
  // the height applies to the cut line in cut mode and to the artwork otherwise: switching keeps the sticker's
  // scale (the artwork's size on the sheet), so the height is worked out again for what it now applies to
  const frameH = () => ((d.mode === 'cut' && d.cutBox) || d.vb).h;
  mIn.addEventListener('change', () => {
    const perUnit = d.heightMm / frameH();
    if (c) { c.kind = mIn.value; li.querySelector('.circ').hidden = c.kind !== 'round'; rebuildCircle(d); }
    else d.mode = mIn.value;
    d.heightMm = perUnit * frameH(); hIn.value = mm1(d.heightMm);
    setHl(); schedule();
  });
  hIn.addEventListener('input', () => { const v = parseFloat(hIn.value); if (isFinite(v) && v >= 1) { d.heightMm = v; d.hEdited = true; schedule(); } });
  li.querySelector('.real').addEventListener('click', () => {
    const rh = realHeight(d);
    d.hEdited = false;
    // in vinyl and pen before the shapes are read: they start at their real size once read
    if (rh == null) { d.realSized = false; schedule(); return; }
    // (vinyl and pen start again at the shapes' real size when switched to: the height here is the sticker's)
    d.heightMm = rh; d.realSized = isMarkless(); hIn.value = mm1(d.heightMm);
    schedule();
  });
  qIn.addEventListener('input', () => { const v = parseInt(qIn.value, 10); d.qty = (qIn.value === '' || !isFinite(v)) ? null : Math.max(0, v); schedule(); });
  rm.addEventListener('click', () => {
    const i = designs.indexOf(d); if (i >= 0) designs.splice(i, 1);
    li.remove();
    if (!designs.length) ui.list.innerHTML = EMPTY_LIST;
    schedule();
  });
  d.ui = { li, thumb: li.querySelector('.thumb'), status: li.querySelector('.status'), fsize: li.querySelector('.fsize'), real: li.querySelector('.real') };
  ui.list.appendChild(li);
  updateRow(d);
}
