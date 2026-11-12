import { tick } from './core/util.js';
import { setCardMsg } from './dom.js';
import { currentMode } from './modes/registry.js';
import { processDesign } from './modes/stickers/design.js';
import { updateRow } from './modes/stickers/rows.js';
import { nestAll } from './nest.js';
import { readOpts, saveOpts } from './settings.js';
import { designs, state } from './state.js';
import { templateSheet } from './template.js';

/* ---------- rendering ---------- */
export function renderPreview() { currentMode().renderPreview(); }
export function renderStats(busyText) { currentMode().renderStats(busyText); }
/* ---------- pipeline ---------- */
// Recompute the current mode's layout and redraw, shortly after the last change. A newer run supersedes an
// older one that is still working: `stale()` tells the older one to stop.
let timer = null;
export function schedule() { clearTimeout(timer); timer = setTimeout(run, 280); }
export async function run() {
  const my = ++state.gen, stale = () => my !== state.gen, mode = currentMode();
  saveOpts();
  try {
    renderStats('Preparing the sheet…');
    if (mode.compute && await mode.compute(readOpts(), stale) === false) return;
    if (stale()) return;
    renderPreview();
    renderStats();
  } catch (e) {
    if (!stale()) { renderStats(); setCardMsg(e.message || String(e), true); }
  }
}
// Trace every sticker that changed, then nest them on the sheet. Returns false when a newer run took over.
export async function computeStickers(o, stale) {
  const sheet = await templateSheet(o);
  if (stale()) return false;
  for (const d of designs) {
    const key = [d.mode, d.heightMm, o.kiss, o.die, o.gap, o.joinGap, o.quality, o.ignoreWhite].join('|');
    if (d.key === key) continue;
    d.busy = true; updateRow(d);
    renderStats(`Tracing ${d.name}…`);
    await tick();
    let res = null, err = null;
    try { res = await processDesign(d, o); }
    catch (e) { err = e.message || String(e); }
    if (stale()) return false;
    d.res = res; d.error = err; d.key = key; d.busy = false;
    updateRow(d);
  }
  const ready = designs.filter(d => d.res && d.qty !== 0);
  renderStats('Arranging stickers…');
  await tick();
  const lay = ready.length ? await nestAll(ready, sheet, o, stale) : null;
  if (stale()) return false;
  state.layout = lay;
  designs.forEach(updateRow);
}
