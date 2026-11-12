import { detectCircle } from '../../core/image.js';
import { num } from '../../core/svg.js';
import { CUT_RED, ui } from '../../dom.js';
import { schedule } from '../../pipeline.js';
import { readOpts } from '../../settings.js';
import { designs, state } from '../../state.js';
import { isMarkless, vOpts } from '../vinyl.js';
import { rebuildCircle } from './index.js';

function thumbSvg(d) {
  if (isMarkless() && d.vres) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(d.vres.boxW)} ${num(d.vres.boxH)}"><path d="${d.vres.pathD}" fill="rgba(35,31,32,.15)" fill-rule="evenodd" stroke="${CUT_RED}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
  if (!d.res) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${d.vb.x} ${d.vb.y} ${d.vb.w} ${d.vb.h}"><image href="${d.url}" x="${d.vb.x}" y="${d.vb.y}" width="${d.vb.w}" height="${d.vb.h}" preserveAspectRatio="none"/></svg>`;
  const r = d.res;
  const im = `<image href="${r.cutMode ? d.urlNoCut : d.url}" x="${num(r.offX)}" y="${num(r.offY)}" width="${num(r.artW)}" height="${num(r.artH)}" preserveAspectRatio="none"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(r.boxW)} ${num(r.boxH)}">${r.cutMode ? `<clipPath id="tc${d.id}"><path d="${r.clipD}"/></clipPath><g clip-path="url(#tc${d.id})">${im}</g>` : im}<path d="${r.dieD}" fill="none" stroke="${CUT_RED}" stroke-width="1" stroke-dasharray="2 1.2" vector-effect="non-scaling-stroke"/><path d="${r.kissD}" fill="none" stroke="${CUT_RED}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
}
export function updateRow(d) {
  if (!d.ui) return;
  d.ui.thumb.innerHTML = thumbSvg(d);
  const st = d.ui.status;
  if (isMarkless()) {
    st.classList.toggle('err', !!d.verr);
    if (d.verr) { st.textContent = d.verr; return; }
    if (d.busy || !d.vres) { st.textContent = 'Reading the shapes…'; return; }
    const r = d.vres, n = state.vinylLayout ? state.vinylLayout.counts.get(d.id) || 0 : 0;
    st.textContent = `${state.mode === 'pen' ? 'Drawing' : 'Cut'} ${num(Math.round(r.frW * 10) / 10)} × ${num(Math.round(r.frH * 10) / 10)} mm, ${r.nPaths} paths. ${n === 1 ? `1 on the ${state.mode === 'pen' ? 'sheet' : 'vinyl'}.` : `${n} on the ${state.mode === 'pen' ? 'sheet' : 'vinyl'}.`}${vOpts().vMirror ? ' Mirrored.' : ''}`;
    return;
  }
  st.classList.toggle('err', !!d.error);
  if (d.error) { st.textContent = d.error; return; }
  if (d.busy || !d.res) { st.textContent = 'Tracing outline…'; return; }
  const r = d.res, bits = [];
  bits.push(`${r.cutMode ? 'Cut line' : 'Art'} ${num(Math.round(r.frW * 10) / 10)} × ${num(Math.round(r.frH * 10) / 10)} mm, die cut ${num(Math.round(r.cutW * 10) / 10)} × ${num(Math.round(r.cutH * 10) / 10)} mm.`);
  if (state.layout) { const n = state.layout.counts.get(d.id) || 0; bits.push(n === 1 ? '1 on the sheet.' : `${n} on the sheet.`); }
  if (d.circle) bits.push(d.circle.found ? 'Round sticker: the cut circle was placed on the circle found in the PDF (2 % inside its edge); adjust it below if needed.' : 'Round sticker: no clear circle found in the PDF, so the cut circle is centred at 90 % of the page; adjust it below.');
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
