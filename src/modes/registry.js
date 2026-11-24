// The mode table. Every mode registers how it works out its layout, draws the preview, fills in the counts and
// notes, and what it does with dropped files:
//   { compute(o, stale) -> false when a newer run took over, renderPreview(), renderStats(busyText), onDrop(files) }
//   exportCheck(o) -> the lines saying what the files will carry (see export/check.js)
// compute, onDrop and exportCheck are optional.
import { state } from '../state.js';

const MODES = {};
export function registerMode(names, def) { for (const n of [].concat(names)) MODES[n] = def; }
export function currentMode() { return MODES[state.mode]; }

// The jobs the modes keep (see jobstore.js: autosaved in the browser, offered again after a reload). One entry per
// job, under a key of its own:
//   { modes: the modes that show it (the first is opened to restore it), label,
//     serialize() -> { files: [{ name, type, data: File | Blob | Uint8Array }], state, count } or null when empty,
//     restore(state, files): reads the files the way new files are read, then sets the saved state,
//     clear() }
const JOBS = new Map();
export function registerJob(key, def) { JOBS.set(key, def); }
export const allJobs = () => JOBS;
export function jobOfMode(mode) { for (const [key, def] of JOBS) if (def.modes.includes(mode)) return { key, def }; return null; }
// The files a list of items came from (each item tagged with .src, its File, and .part, its page or place in it):
// the files in order, and each item's file index.
export function itemFiles(items) {
  const files = [], at = new Map();
  for (const it of items) if (it.src && !at.has(it.src)) { at.set(it.src, files.length); files.push(it.src); }
  return { files: files.map(f => ({ name: f.name, type: f.type, data: f })), at: it => at.get(it.src) };
}
// After the files were read again: the items they gave, matched to the saved ones ({ f, part, … }) in the saved
// order, as [item, saved] pairs. Items no longer in the job (removed before the reload) are left out.
export function matchItems(items, files, saved) {
  const by = new Map(items.map(it => [`${files.indexOf(it.src)}:${it.part}`, it]));
  return saved.map(s => [by.get(`${s.f}:${s.part}`), s]).filter(([it]) => it);
}
