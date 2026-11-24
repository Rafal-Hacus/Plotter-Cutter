// Material profiles (Cut lines → Material): named sets of the kiss and die cut force and the speeds, and for a
// material that needs another knife its blade offset and overcut too. Choosing one fills those fields; editing them
// marks the profile "changed" (Save / Save as new). Kept in this browser's storage.
import { parseNum } from './core/number.js';
import { byId } from './dom.js';

export const MAT_FIELDS = ['kissForce', 'dieForce', 'cutSpeed', 'upSpeed'];
export const KNIFE_FIELDS = ['bladeOffset', 'overcut'];
const KEY = 'plotterCutter.materials.v1';
// starter profiles with the standard values: to be tuned with a test cut and saved
export const STARTERS = [
  { id: 'sticker', name: 'Sticker paper (kiss + easy-peel die)', kissForce: 60, dieForce: 60, cutSpeed: 13, upSpeed: 13 },
  { id: 'vinyl', name: 'Vinyl', kissForce: 60, dieForce: 60, cutSpeed: 13, upSpeed: 13 },
  { id: 'card300', name: 'Card 300 g (die through)', kissForce: 60, dieForce: 60, cutSpeed: 13, upSpeed: 13 }
];

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && Array.isArray(d.profiles)) return { profiles: d.profiles.filter(p => p && typeof p.name === 'string' && p.id), current: d.current || '' };
  } catch { /* storage unavailable, or not what we saved */ }
  return { profiles: STARTERS.map(p => ({ ...p })), current: '' };
}
const store = load();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage unavailable */ } };
const fieldsOf = p => [...MAT_FIELDS, ...(p.knife ? KNIFE_FIELDS : [])];
const value = id => parseNum(byId(id).value);

const sel = byId('matSel'), dirty = byId('matDirty'), bUpdate = byId('matUpdate'), bDelete = byId('matDelete');
const nameRow = byId('matNameRow'), nameIn = byId('matName');
const current = () => store.profiles.find(p => p.id === store.current) || null;
const changed = p => fieldsOf(p).some(id => value(id) !== p[id]);

function render() {
  sel.replaceChildren(new Option('No material profile', ''), ...store.profiles.map(p => new Option(p.name, p.id)));
  sel.value = current() ? store.current : '';
  sync();
}
function sync() {
  const p = current(), d = !!p && changed(p);
  dirty.hidden = !d; bUpdate.disabled = !d; bDelete.disabled = !p;
}
function choose(id) {
  store.current = id; persist();
  const p = current();
  if (p) for (const f of fieldsOf(p)) {
    const e = byId(f);
    e.value = String(p[f]);
    e.dispatchEvent(new Event('input', { bubbles: true })); // saves the options, redraws, rechecks the field
  }
  sync();
}
const take = p => { for (const f of fieldsOf(p)) { const v = value(f); if (Number.isFinite(v)) p[f] = v; } return p; };

sel.addEventListener('change', () => choose(sel.value));
bUpdate.addEventListener('click', () => { const p = current(); if (p) { take(p); persist(); sync(); } });
byId('matSave').addEventListener('click', () => { nameRow.hidden = false; nameIn.value = current() ? `${current().name} (copy)` : ''; byId('matKnife').checked = !!(current() && current().knife); nameIn.focus(); nameIn.select(); });
byId('matNameCancel').addEventListener('click', () => { nameRow.hidden = true; });
byId('matNameOk').addEventListener('click', () => {
  const name = nameIn.value.trim().replace(/\s+/g, ' ');
  if (!name) { nameIn.focus(); return; }
  const p = take({ id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, knife: byId('matKnife').checked });
  if (!p.knife) delete p.knife;
  store.profiles.push(p); store.current = p.id; persist();
  nameRow.hidden = true;
  render();
});
nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); byId('matNameOk').click(); } if (e.key === 'Escape') byId('matNameCancel').click(); });
bDelete.addEventListener('click', () => {
  const p = current();
  if (!p || !confirm(`Delete the material profile “${p.name}”?`)) return;
  store.profiles = store.profiles.filter(q => q !== p); store.current = ''; persist();
  render();
});
// any edit of a field (by hand, or by saved settings being applied) can make the profile "changed"
for (const ev of ['input', 'change', 'click']) document.addEventListener(ev, () => setTimeout(sync, 0), true);
// (after the fields got their values from the last visit)
export const initMaterials = render;
