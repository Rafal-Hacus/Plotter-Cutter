// "Saved settings": named sets of every option plus the mode, stored on the server (see server/).
// Picking one applies it straight away; one can be the default that loads when the app opens.
// When the app is served without the server (plain static hosting, npm run dev without it) the panel stays hidden.

const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: 'same-origin', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) { location.href = 'login'; throw new Error('Signed out.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortKeys = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));

// app: { snapshot() -> {mode, settings}, apply({mode, settings}) }
export async function initPresets(app) {
  let me;
  try {
    const r = await fetch('api/me', { credentials: 'same-origin' });
    if (r.status === 401) { location.href = 'login'; return; }
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return; // no server: nothing to show
    me = await r.json();
  } catch { return; }

  const $ = id => document.getElementById(id);
  const box = $('secPresets'), sel = $('presetSel'), msg = $('presetMsg');
  const bSave = $('presetSave'), bUpdate = $('presetUpdate'), bDefault = $('presetDefault'), bDelete = $('presetDelete');
  const nameRow = $('presetNameRow'), nameIn = $('presetName'), bNameOk = $('presetNameOk'), bNameCancel = $('presetNameCancel');
  box.hidden = false;
  if (!me.authDisabled) { $('userBox').hidden = false; $('userName').textContent = me.user; }

  let list = [], defaultId = null, current = null; // current: the preset last applied or saved, with its settings
  const say = (t, warn) => { msg.textContent = t; msg.classList.toggle('warn', !!warn); };
  const changed = () => !!current && !same(sortKeys(current.settings), sortKeys(app.snapshot().settings)) || (current && current.mode !== app.snapshot().mode);

  function render() {
    const keep = current ? current.id : '';
    sel.replaceChildren(new Option(list.length ? 'Choose saved settings…' : 'No saved settings yet', ''));
    for (const p of list) {
      const o = new Option(`${p.name}${p.id === defaultId ? '  (default)' : ''}`, p.id);
      sel.append(o);
    }
    sel.value = list.some(p => p.id === keep) ? keep : '';
    sync();
  }
  function sync() {
    const has = !!current, dirty = has && changed();
    bUpdate.disabled = !dirty; bDelete.disabled = !has;
    bDefault.disabled = !has; bDefault.textContent = has && current.id === defaultId ? 'Remove as default' : 'Make default';
    $('presetDirty').hidden = !dirty;
  }
  async function load() { const r = await api('api/presets'); list = r.presets; defaultId = r.defaultId; render(); }
  async function choose(id) {
    if (!id) { current = null; sync(); return; }
    const p = await api(`api/presets/${id}`);
    app.apply({ mode: p.mode, settings: p.settings });
    current = { id: p.id, name: p.name, mode: p.mode, settings: app.snapshot().settings };
    // compare against what the page actually holds after applying (fields normalise their values)
    current.mode = app.snapshot().mode;
    say(`Applied “${p.name}”.`);
    sync();
  }

  sel.addEventListener('change', () => choose(sel.value).catch(e => say(e.message, true)));
  bSave.addEventListener('click', () => { nameRow.hidden = false; nameIn.value = current ? `${current.name} (copy)` : ''; nameIn.focus(); nameIn.select(); });
  bNameCancel.addEventListener('click', () => { nameRow.hidden = true; });
  const saveNew = async () => {
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    const snap = app.snapshot();
    const p = await api('api/presets', { method: 'POST', body: { name, mode: snap.mode, settings: snap.settings } });
    current = { id: p.id, name: p.name, mode: snap.mode, settings: snap.settings };
    nameRow.hidden = true;
    await load();
    say(`Saved “${p.name}”.`);
  };
  bNameOk.addEventListener('click', () => saveNew().catch(e => say(e.message, true)));
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); bNameOk.click(); } if (e.key === 'Escape') bNameCancel.click(); });
  bUpdate.addEventListener('click', async () => {
    if (!current) return;
    try {
      const snap = app.snapshot();
      await api(`api/presets/${current.id}`, { method: 'PUT', body: { name: current.name, mode: snap.mode, settings: snap.settings } });
      current = { ...current, mode: snap.mode, settings: snap.settings };
      await load();
      say(`Updated “${current.name}”.`);
    } catch (e) { say(e.message, true); }
  });
  bDefault.addEventListener('click', async () => {
    if (!current) return;
    try {
      const id = current.id === defaultId ? null : current.id;
      await api('api/default', { method: 'PUT', body: { id } });
      await load();
      say(id ? `“${current.name}” loads when the app opens.` : 'No default any more.');
    } catch (e) { say(e.message, true); }
  });
  bDelete.addEventListener('click', async () => {
    if (!current || !confirm(`Delete the saved settings “${current.name}”?`)) return;
    try { await api(`api/presets/${current.id}`, { method: 'DELETE' }); say(`Deleted “${current.name}”.`); current = null; await load(); }
    catch (e) { say(e.message, true); }
  });
  $('signOut').addEventListener('click', async () => {
    await fetch('logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.href = 'login';
  });
  // any edit of a field marks the applied settings as changed
  for (const ev of ['input', 'change', 'click']) document.addEventListener(ev, () => setTimeout(sync, 0), true);

  try {
    await load();
    if (defaultId) await choose(defaultId), sel.value = defaultId;
  } catch (e) { say(e.message, true); }
}
