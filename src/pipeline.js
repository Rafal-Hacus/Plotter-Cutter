// Recomputing the open mode's layout and redrawing the sheet.
import { setMsg, ui } from './dom.js';
import { showExportCheck } from './export/check.js';
import { busy, noteChange } from './jobstore.js';
import { numProblem, onNumValidity, recheckNumFields } from './numfield.js';
import { currentMode } from './modes/registry.js';
import { readOpts, saveOpts } from './settings.js';
import { state } from './state.js';

export function renderPreview() { currentMode().renderPreview(); }
// busyText: what is being worked on; the counts and notes are filled in when it is left out
export function renderStats(busyText) {
  currentMode().renderStats(busyText);
  if (!busyText) refreshExportCheck();
  if (showNumProblem()) return;
  // a file that couldn't be added stays mentioned until the next one is
  if (!busyText && state.loadError) setMsg([ui.msg.textContent, state.loadError].filter(Boolean).join(' '), true);
}

// the "Will be written" line under Export: what the open mode's files will carry
export function refreshExportCheck() { const m = currentMode(); showExportCheck(m.exportCheck ? m.exportCheck(readOpts()) : null); }

// Recompute and redraw shortly after the last change. A newer run supersedes an older one that is still working:
// `stale()` tells the older one to stop.
let timer = null;
// A number field with a value it can't take (red, see numfield.js): the sheet isn't laid out with it, and instead of
// the previous result looking current the count says so and the line under it says why. true when that is the case.
function showNumProblem() {
  const p = numProblem();
  ui.stage.classList.toggle('stale', !!p);
  if (!p) return false;
  ui.count.textContent = 'Not updated: a field is out of range';
  setMsg(p.text, true);
  return true;
}
// a field turned wrong or right again: lay out again (or say why not)
onNumValidity(() => schedule());
export function schedule() { clearTimeout(timer); timer = setTimeout(run, 280); noteChange(); }
export async function run() {
  const my = ++state.gen, stale = () => my !== state.gen, mode = currentMode();
  saveOpts();
  recheckNumFields();
  if (showNumProblem()) return;
  busy(1);
  try {
    renderStats('Preparing the sheet…');
    if (mode.compute && await mode.compute(readOpts(), stale) === false) return;
    if (stale()) return;
    renderPreview();
    renderStats();
  } catch (e) {
    if (!stale()) { renderStats(); setMsg(e.message || String(e), true); }
  } finally { busy(-1); }
}
