// One layer for every number field of the page, the side panel's and the ones the modes add (sticker heights,
// copies, stamp sizes, forces in tables):
// - they are text fields that take a decimal comma: 100,5 becomes 100.5 while typing (a browser's number field
//   reads it as 1005 or as nothing), spaces are dropped; the arrow keys still step by the field's step;
// - a value outside the field's min..max, or text that isn't a number, turns the field red with the allowed range
//   under it, and every export button refuses to write a file until it is fixed (the code would otherwise quietly
//   cut 600 g to 160 g, or keep using the last good value);
// - pipeline.js asks `numProblem()` before laying out, so the preview says why it isn't updated instead of showing
//   the previous result as if it were current.
import { checkNum, normalizeNum, stepNum } from './core/number.js';

const SEL = 'input[type=number], input.num';
const fields = () => document.querySelectorAll('input.num');

// what a field is called in a message: its label, its aria-label, or the text of the label around it
function fieldName(e) {
  const l = e.id && document.querySelector(`label[for="${e.id}"]`);
  if (l && l.textContent.trim()) return l.textContent.trim();
  if (e.getAttribute('aria-label')) return e.getAttribute('aria-label');
  const wrap = e.closest('label');
  const t = wrap && [...wrap.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
  return t ? t.textContent.trim().replace(/[,:]\s*$/, '') : 'A number field';
}
// the unit written right after the field (mm, g, cm/s…), if any
function fieldUnit(e) {
  const n = e.nextSibling, t = n && n.nodeType === 3 ? n.textContent.trim() : '';
  return t && t !== '×' && t.length <= 6 ? t : '';
}
const limit = (e, a) => { const v = e.getAttribute(a); return v === null || v === '' ? NaN : Number(v); };
const rules = e => ({
  min: limit(e, 'min'), max: limit(e, 'max'), step: limit(e, 'step') || 1, unit: fieldUnit(e),
  // a field that comes with a value can't be left empty (the code would quietly use its own standard value);
  // fields that start empty (Copies: fill, an automatic rim, PLT modifier: unchanged) can
  blankOk: e.defaultValue === ''
});

// a field the open mode uses: on the page and not in a hidden panel (a closed <details> still counts)
function inUse(e) {
  if (!e.isConnected || e.disabled) return false;
  for (let a = e; a && a !== document.body; a = a.parentElement) if (a.hidden || getComputedStyle(a).display === 'none') return false;
  return true;
}

// the message under the row (or the group of fields, or the table) the field is in
function msgBox(e) {
  const box = e.closest('.row, .fields, table') || e.parentElement;
  let m = box.nextElementSibling;
  if (!m || !m.classList.contains('numerr')) {
    m = document.createElement('p'); m.className = 'numerr'; m.setAttribute('role', 'alert'); m.hidden = true;
    box.after(m);
  }
  return [box, m];
}
function showCheck(e) {
  const r = checkNum(e.value, rules(e));
  e.classList.toggle('bad', !r.ok);
  if (r.ok) e.removeAttribute('aria-invalid'); else e.setAttribute('aria-invalid', 'true');
  e.title = r.ok ? '' : r.text;
  e.dataset.numErr = r.ok ? '' : `${fieldName(e)}: ${r.text}`;
  const [box, m] = msgBox(e);
  const errs = [...box.querySelectorAll('input.num.bad')].map(x => x.dataset.numErr);
  m.textContent = errs.join(' ');
  // only under a row the open mode shows (a Pen-only field's message stays out of Vinyl)
  m.hidden = !errs.length || !inUse(box);
  return r.ok;
}

// the first problem in the fields the open mode uses: { field, text }, or null when all is well
export function numProblem() {
  for (const e of fields()) if (e.classList.contains('bad') && inUse(e)) return { field: e, text: e.dataset.numErr };
  return null;
}

// called when the page goes from fine to a problem or back (pipeline.js lays out again then)
let onFlip = () => {}, wasBad = false;
export function onNumValidity(f) { onFlip = f; }
function flip() {
  const bad = !!numProblem();
  markExports(bad);
  if (bad !== wasBad) { wasBad = bad; onFlip(bad); }
}
// export buttons look switched off and say why while a field is wrong
function markExports(bad) {
  const p = bad && numProblem();
  for (const b of document.querySelectorAll('button[id^="ex"]')) {
    b.classList.toggle('numblock', !!p);
    if (p) { b.setAttribute('aria-disabled', 'true'); b.title = `Fix first: ${p.text}`; }
    else if (b.getAttribute('aria-disabled')) { b.removeAttribute('aria-disabled'); b.title = ''; }
  }
}

// check every field again (after settings were loaded or set by code)
export function recheckNumFields() { fields().forEach(showCheck); flip(); }

// turn a browser number field into ours
function upgrade(e) {
  if (e.classList.contains('num')) return;
  e.classList.add('num');
  e.type = 'text';
  e.inputMode = 'decimal';
  e.autocomplete = 'off';
  e.spellcheck = false;
}
function upgradeAll(root) {
  if (root.matches && root.matches(SEL)) upgrade(root);
  if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(upgrade);
}

export function initNumFields() {
  upgradeAll(document);
  // fields the modes add later (a row per sticker, stamp, file)
  new MutationObserver(list => {
    let added = false;
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) { upgradeAll(n); added = true; }
    if (added) queueMicrotask(() => { for (const e of fields()) if (!('numErr' in e.dataset)) showCheck(e); flip(); });
  }).observe(document.body, { childList: true, subtree: true });
  // before any other listener reads the field: a comma becomes a point, spaces go
  document.addEventListener('input', ev => {
    const e = ev.target;
    if (!(e instanceof HTMLInputElement) || !e.classList.contains('num')) return;
    const raw = e.value, norm = normalizeNum(raw);
    if (norm !== raw) {
      const at = e === document.activeElement ? e.selectionStart : null;
      e.value = norm;
      if (at !== null) { const c = normalizeNum(raw.slice(0, at)).length; e.setSelectionRange(c, c); }
    }
    showCheck(e); flip();
  }, true);
  document.addEventListener('change', ev => { const e = ev.target; if (e instanceof HTMLInputElement && e.classList.contains('num')) { showCheck(e); flip(); } }, true);
  // the arrow keys step the value, as in a number field
  document.addEventListener('keydown', ev => {
    const e = ev.target;
    if (!(e instanceof HTMLInputElement) || !e.classList.contains('num') || e.readOnly || e.disabled) return;
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown' || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    ev.preventDefault();
    const r = rules(e), next = stepNum(e.value, ev.key === 'ArrowUp' ? 1 : -1, r);
    if (next === e.value) return;
    e.value = next;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // an export while a field is wrong would write a file with a value nobody typed: refuse, and show the field
  document.addEventListener('click', ev => {
    const b = ev.target instanceof Element && ev.target.closest('button[id^="ex"]');
    if (!b) return;
    recheckNumFields();
    const p = numProblem();
    if (!p) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    for (let a = p.field.parentElement; a; a = a.parentElement) if (a.tagName === 'DETAILS') a.open = true;
    p.field.focus();
    const msg = document.getElementById('msg');
    if (msg) { msg.textContent = `Not exported: ${p.text}`; msg.className = 'msg warn'; }
  }, true);
  recheckNumFields();
}
