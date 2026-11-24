// Never lose a job: every mode's job (its files as they were loaded, plus what was set for each design or item) is
// kept in the browser's IndexedDB shortly after each change, and offered again after a reload or a closed tab.
// The open mode is remembered too. Storage that fails or is missing never stops the app: the job just isn't kept,
// and leaving the page then asks first.
import { fileSlug } from './core/util.js';
import { byId, restoreHint, setFileNamer, setMsg } from './dom.js';
import { allJobs, currentMode, jobOfMode } from './modes/registry.js';
import { state } from './state.js';

const DB_NAME = 'plotter-cutter-jobs', STORE = 'jobs', MODE_KEY = 'stickerSheet.lastMode';
const MAX_BYTES = 200 * 1024 * 1024; // a job bigger than this (files included) is not kept: said once
const DELAY = 800; // ms after the last change

/* ---------- IndexedDB, every call wrapped ---------- */
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'key' });
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
      rq.onblocked = () => reject(new Error('storage blocked'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}
async function store(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode), rq = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(rq && rq.result);
    t.onerror = t.onabort = () => reject(t.error || new Error('storage failed'));
  });
}
const getAll = () => store('readonly', s => s.getAll());
const put = rec => store('readwrite', s => s.put(rec));
const del = key => store('readwrite', s => s.delete(key));

/* ---------- what changed: a signature of each job (files by identity, the state as JSON) ---------- */
const ids = new WeakMap();
let nextObj = 1;
const idOf = o => { if (!ids.has(o)) ids.set(o, nextObj++); return ids.get(o); };
const binary = v => v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v);
function signature(snap) {
  return JSON.stringify({ f: snap.files.map(f => [f.name, idOf(f.data)]), s: snap.state }, (k, v) => (v && typeof v === 'object' && binary(v) ? `#${idOf(v)}` : v));
}
const sizeOf = d => (d instanceof Blob ? d.size : d.byteLength || 0);
function binarySize(v, seen = new Set()) {
  if (!v || typeof v !== 'object' || seen.has(v)) return 0;
  seen.add(v);
  if (binary(v)) return sizeOf(v);
  let n = 0;
  for (const x of Array.isArray(v) ? v : Object.values(v)) n += binarySize(x, seen);
  return n;
}
const bufs = new WeakMap(); // a File read once
function bytesOf(d) {
  if (!(d instanceof Blob)) return Promise.resolve(d);
  if (!bufs.has(d)) bufs.set(d, d.arrayBuffer());
  return bufs.get(d);
}
function snapshot(def) {
  let snap;
  try { snap = def.serialize(); } catch (e) { console.warn('Could not read the job to keep it:', e); return { error: true }; }
  if (!snap || (!snap.files.length && !snap.count)) return null;
  return snap;
}

/* ---------- saving ---------- */
const saved = new Map(); // key -> the signature now in storage ('' or missing: nothing)
const tooBig = new Set();
let timer = null, saving = false, suspended = 0, started = false, offer = null;
export function noteChange() {
  if (!started) return;
  clearTimeout(timer);
  timer = setTimeout(flush, DELAY);
  syncClear();
}
async function flush() {
  timer = null;
  if (saving || suspended) { timer = setTimeout(flush, DELAY); return; }
  saving = true;
  try {
    for (const [key, def] of allJobs()) {
      const snap = snapshot(def);
      if (snap && snap.error) continue;
      // a saved job not restored (yet) stays until it is restored or discarded, or a new job in its mode replaces it
      if (!snap && offer && offer.has(key)) continue;
      const sig = snap ? signature(snap) : '';
      if ((saved.get(key) || '') === sig) continue;
      try {
        if (!snap) { await del(key); saved.set(key, ''); continue; }
        if (offer && offer.delete(key)) showOffer();
        const size = snap.files.reduce((s, f) => s + sizeOf(f.data), 0) + binarySize(snap.state);
        if (size > MAX_BYTES) {
          if (!tooBig.has(key)) setMsg(`This ${def.label} job is ${Math.round(size / 1048576)} MB, too big to keep in the browser: it is lost if the page is closed or reloaded.`, true);
          tooBig.add(key);
          await del(key); saved.set(key, '');
          continue;
        }
        tooBig.delete(key);
        const files = await Promise.all(snap.files.map(async f => ({ name: f.name, type: f.type || '', data: await bytesOf(f.data) })));
        // (changed while the files were read: the next round keeps it)
        if (signature(snap) !== sig) continue;
        await put({ key, label: def.label, savedAt: Date.now(), count: snap.count, files, state: snap.state });
        saved.set(key, sig);
      } catch (e) { console.warn(`Could not keep the ${def.label} job:`, e); }
    }
  } finally { saving = false; }
}
// a job whose current state is not what is in storage (not saved yet, too big, or storage failing)
function unsaved() {
  if (timer || saving) return true;
  for (const [key, def] of allJobs()) {
    const snap = snapshot(def);
    if (snap && snap.error) continue;
    if (!snap) continue;
    if ((saved.get(key) || '') !== signature(snap)) return true;
  }
  return false;
}

/* ---------- export buttons still working: they are disabled while they build ---------- */
const exporting = new Set();
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button[id^="ex"]'); if (b) exporting.add(b); }, true);
function exportBusy() {
  for (const b of exporting) { if (b.disabled && b.isConnected) return true; exporting.delete(b); }
  return false;
}
let working = 0; // layout runs and restores in progress
export function busy(delta) { working = Math.max(0, working + delta); }
window.addEventListener('beforeunload', e => {
  if (working || exportBusy() || unsaved()) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- the open mode ---------- */
export function rememberMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* storage unavailable */ } }
export function lastMode() { try { return localStorage.getItem(MODE_KEY); } catch { return null; } }

/* ---------- the offer after a reload, and Clear job ---------- */
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function when(t) {
  const d = new Date(t), now = new Date(), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}. ${hm}`;
}
// a kept job in words: "3 stamps 'Firma Kowalski'", "2 files 'star.svg', 'cut.pdf'" (the job's own describe() first)
const quoted = names => { const u = [...new Set(names.filter(Boolean))]; return u.slice(0, 2).map(n => `'${n}'`).join(', ') + (u.length > 2 ? ', …' : ''); };
export function describeJob(def, rec) {
  try { const d = def.describe && def.describe(rec.state, rec.files); if (d) return d; } catch (e) { console.warn(e); }
  return rec.files.length ? `${plural(rec.files.length, 'file')} ${quoted(rec.files.map(f => f.name))}` : plural(rec.count, 'item');
}
function showOffer() {
  const bar = byId('jobRestore'), ul = byId('jobRestoreList');
  const on = !!(offer && offer.size);
  if (!on) { bar.hidden = true; offer = null; }
  else {
    // the open mode's job first, each with its own button
    const cur = jobOfMode(state.mode), keys = [...offer.keys()].sort((a, b) => (b === (cur && cur.key)) - (a === (cur && cur.key)));
    ul.innerHTML = '';
    for (const key of keys) {
      const rec = offer.get(key), def = allJobs().get(key), li = document.createElement('li'), t = document.createElement('span'), b = document.createElement('button');
      li.dataset.key = key;
      t.textContent = `${def.label}: ${describeJob(def, rec)} · ${when(rec.savedAt)}`;
      b.type = 'button'; b.className = 'jrBring'; b.textContent = 'Bring it back';
      b.addEventListener('click', () => restore([key]));
      li.append(t, b); ul.appendChild(li);
    }
    byId('jobRestoreAll').hidden = keys.length < 2;
    bar.hidden = false;
  }
  // the empty lists point at the offer while it is shown
  if (restoreHint.on !== on) {
    restoreHint.on = on;
    for (const li of document.querySelectorAll('li.empty[data-text]')) li.textContent = on ? restoreHint.text : li.dataset.text;
    const m = currentMode(); if (m && m.renderStats) try { m.renderStats(); } catch (e) { console.warn(e); }
  }
}
let setMode = null;
async function restore(only) {
  if (!offer) return;
  const recs = [...offer.entries()].filter(([k]) => !only || only.includes(k)), back = state.mode, failed = [];
  for (const [k] of recs) offer.delete(k);
  showOffer();
  suspended++; busy(1);
  try {
    for (const [key, rec] of recs) {
      const def = allJobs().get(key);
      if (!def) continue;
      if (!def.modes.includes(state.mode)) setMode(def.modes[0]);
      setMsg(`Restoring the ${def.label} job…`);
      try { await def.restore(rec.state, rec.files.map(f => new File([f.data], f.name, { type: f.type }))); }
      catch (e) { failed.push(`${def.label}: ${e.message || e}`); console.warn(e); }
    }
  } finally {
    suspended--; busy(-1);
    // one job brought back by its own button: its mode stays open; all of them: back to the mode that was open
    if (state.mode !== back && !(only && only.length === 1)) setMode(back);
    if (failed.length) setMsg(`Could not restore all of the last job. ${failed.join(' ')}`, true);
    noteChange();
  }
}
async function discard() {
  const keys = offer ? [...offer.keys()] : [];
  if (!keys.length || !confirm(`Discard your last work (${keys.map(k => allJobs().get(k).label).join(', ')})? It can’t be brought back afterwards.`)) return;
  offer = null; showOffer();
  for (const k of keys) { try { await del(k); } catch (e) { console.warn(e); } }
}
function syncClear() {
  const j = jobOfMode(state.mode), btn = byId('jobClear');
  btn.hidden = !j || !snapshot(j.def);
}
async function clearJob() {
  const j = jobOfMode(state.mode);
  if (!j || !confirm(`Clear the ${j.def.label} job? Its files and settings are removed here and from the browser’s autosave.`)) return;
  suspended++;
  try {
    j.def.clear();
    try { await del(j.key); saved.set(j.key, ''); } catch (e) { console.warn(e); }
  } finally { suspended--; syncClear(); }
}
// at the start: what was kept, offered without stopping anything
export async function initJobStore({ setAppMode }) {
  setMode = setAppMode;
  byId('jobRestoreAll').addEventListener('click', () => restore());
  setFileNamer(withJobName);
  byId('jobRestoreNo').addEventListener('click', () => discard());
  byId('jobClear').addEventListener('click', () => clearJob());
  started = true;
  // any field typed in or changed (the job's own fields too: copies, heights, texts)
  for (const t of ['input', 'change']) document.addEventListener(t, () => noteChange(), true);
  syncClear();
  let recs;
  try { recs = await getAll(); } catch (e) { console.warn('The browser storage for jobs is not available:', e); return; }
  offer = new Map();
  for (const r of recs) {
    const def = allJobs().get(r.key);
    if (def && (r.files.length || r.count)) offer.set(r.key, r);
  }
  showOffer();
}
// a mode was opened
export function modeOpened(m) { rememberMode(m); if (started) { syncClear(); if (offer) showOffer(); } }

/* ---------- the job's name at the front of the files saved ---------- */
// the open mode's job: its own title() (a stamp's first line), else its first file's name, ASCII-safe
export function jobName() {
  const j = jobOfMode(state.mode);
  if (!j) return '';
  const snap = snapshot(j.def);
  if (!snap || snap.error) return '';
  let t = '';
  try { t = (j.def.title && j.def.title(snap)) || (snap.files[0] && snap.files[0].name) || ''; } catch (e) { console.warn(e); }
  return fileSlug(t);
}
// 'sticker-sheet-6pcs-print.pdf' -> 'wino_teresy_14_5cm_cut-sticker-sheet-6pcs-print.pdf' (unless it starts with it already)
export function withJobName(name) {
  const j = jobName();
  return j && !name.startsWith(j) ? `${j}-${name}` : name;
}
