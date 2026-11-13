// Recomputing the open mode's layout and redrawing the sheet.
import { setMsg, ui } from './dom.js';
import { currentMode } from './modes/registry.js';
import { readOpts, saveOpts } from './settings.js';
import { state } from './state.js';

export function renderPreview() { currentMode().renderPreview(); }
// busyText: what is being worked on; the counts and notes are filled in when it is left out
export function renderStats(busyText) {
  currentMode().renderStats(busyText);
  // a file that couldn't be added stays mentioned until the next one is
  if (!busyText && state.loadError) setMsg([ui.msg.textContent, state.loadError].filter(Boolean).join(' '), true);
}

// Recompute and redraw shortly after the last change. A newer run supersedes an older one that is still working:
// `stale()` tells the older one to stop.
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
    if (!stale()) { renderStats(); setMsg(e.message || String(e), true); }
  }
}
