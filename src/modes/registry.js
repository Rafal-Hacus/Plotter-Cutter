import { state } from '../state.js';

/* ---------- modes ---------- */
// Every mode registers how it works out its layout, draws the preview, fills in the counts and notes, and what it
// does with dropped files: { compute(o, stale), renderPreview(), renderStats(busyText), onDrop(files) }.
const MODES = {};
export function registerMode(names, def) { for (const n of [].concat(names)) MODES[n] = def; }
export const currentMode = () => MODES[state.mode];
