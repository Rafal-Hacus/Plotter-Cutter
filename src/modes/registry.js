// The mode table. Every mode registers how it works out its layout, draws the preview, fills in the counts and
// notes, and what it does with dropped files:
//   { compute(o, stale) -> false when a newer run took over, renderPreview(), renderStats(busyText), onDrop(files) }
//   exportCheck(o) -> the lines saying what the files will carry (see export/check.js)
// compute, onDrop and exportCheck are optional.
import { state } from '../state.js';

const MODES = {};
export function registerMode(names, def) { for (const n of [].concat(names)) MODES[n] = def; }
export function currentMode() { return MODES[state.mode]; }
