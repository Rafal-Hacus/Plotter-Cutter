// Background library for winietki from names (stored on the server, see server/library.js):
// click a background and it loads together with its card settings (size, font, name position, fold).
// Hidden when the app runs without the server.

// the card settings kept with each background
export const LIB_KEYS = ['winW', 'winH', 'winFont', 'winSize', 'winColor', 'winBoth', 'winOffX', 'winOffY', 'cFoldOn', 'cFoldDir', 'cFoldPos', 'cPerfCut', 'cPerfGap'];

const toBase64 = bytes => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(',') + 1));
  r.onerror = () => fail(r.error);
  r.readAsDataURL(new Blob([bytes]));
});
const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: 'same-origin', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, ...opts });
  if (r.status === 401) { location.href = 'login'; throw new Error('Signed out.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
};

// app: { getBackground() -> { kind, bytes } | null, setBackground(bg | null, name), readSettings(keys) -> {},
//        applySettings(settings), makeThumb(bg) -> Promise<Uint8Array JPEG> }
export async function initLibrary(app) {
  try { const r = await fetch('api/backgrounds', { credentials: 'same-origin' }); if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return; }
  catch { return; }
  const $ = id => document.getElementById(id);
  const box = $('winLib'), grid = $('winLibGrid'), msg = $('winLibMsg');
  const bSave = $('winLibSave'), bUpdate = $('winLibUpdate'), bDelete = $('winLibDelete');
  const nameRow = $('winLibNameRow'), nameIn = $('winLibName');
  box.hidden = false;
  let items = [], selected = null;
  const say = (t, warn) => { msg.textContent = t; msg.classList.toggle('warn', !!warn); };
  const sync = () => {
    bSave.disabled = !app.getBackground();
    bUpdate.disabled = bDelete.disabled = !selected;
    for (const el of grid.children) el.setAttribute('aria-pressed', String((el.dataset.id || '') === (selected ? selected.id : '')));
  };
  function render() {
    grid.replaceChildren();
    const tile = (id, label, thumb) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'libtile'; b.dataset.id = id; b.title = label;
      if (thumb) { const im = document.createElement('img'); im.alt = ''; im.loading = 'lazy'; im.src = thumb; b.append(im); }
      else { const s = document.createElement('span'); s.className = 'libnone'; s.textContent = 'None'; b.append(s); }
      const c = document.createElement('span'); c.className = 'libname'; c.textContent = label; b.append(c);
      b.addEventListener('click', () => pick(id).catch(e => say(e.message, true)));
      grid.append(b);
    };
    tile('', 'No background', null);
    for (const it of items) tile(it.id, it.name, `api/backgrounds/${it.id}/thumb?v=${encodeURIComponent(it.updatedAt)}`);
    sync();
  }
  async function load() { items = (await api('api/backgrounds')).backgrounds; if (selected) selected = items.find(i => i.id === selected.id) || null; render(); }
  async function pick(id) {
    if (!id) { selected = null; app.setBackground(null, ''); sync(); say('No background.'); return; }
    const it = items.find(i => i.id === id);
    say(`Loading “${it.name}”…`);
    const r = await fetch(`api/backgrounds/${id}/file`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`Couldn’t load the background (${r.status}).`);
    selected = it;
    app.applySettings(it.settings || {});
    app.setBackground({ kind: it.kind, bytes: new Uint8Array(await r.arrayBuffer()) }, it.name);
    sync();
    say(`“${it.name}” with its card settings.`);
  }
  bSave.addEventListener('click', () => { nameRow.hidden = false; nameIn.value = ''; nameIn.focus(); });
  $('winLibNameCancel').addEventListener('click', () => { nameRow.hidden = true; });
  const save = async () => {
    const bg = app.getBackground(), name = nameIn.value.trim();
    if (!bg) { say('Load a background first.', true); return; }
    if (!name) { nameIn.focus(); return; }
    say('Uploading…');
    const it = await api('api/backgrounds', { method: 'POST', body: JSON.stringify({ name, data: await toBase64(bg.bytes), thumb: await toBase64(await app.makeThumb(bg)), settings: app.readSettings(LIB_KEYS) }) });
    nameRow.hidden = true; selected = it;
    await load();
    say(`Saved “${it.name}” to the library with the current card settings.`);
  };
  $('winLibNameOk').addEventListener('click', () => save().catch(e => say(e.message, true)));
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('winLibNameOk').click(); } if (e.key === 'Escape') $('winLibNameCancel').click(); });
  bUpdate.addEventListener('click', async () => {
    if (!selected) return;
    try { await api(`api/backgrounds/${selected.id}`, { method: 'PUT', body: JSON.stringify({ settings: app.readSettings(LIB_KEYS) }) }); await load(); say(`Saved the current card settings with “${selected.name}”.`); }
    catch (e) { say(e.message, true); }
  });
  bDelete.addEventListener('click', async () => {
    if (!selected || !confirm(`Delete “${selected.name}” from the library?`)) return;
    try { await api(`api/backgrounds/${selected.id}`, { method: 'DELETE' }); say(`Deleted “${selected.name}”.`); selected = null; await load(); }
    catch (e) { say(e.message, true); }
  });
  try { await load(); } catch (e) { say(e.message, true); }
  // loading a background by hand de-selects the library one
  return { backgroundChanged(fromLibrary) { if (!fromLibrary) selected = null; sync(); }, reload: load };
}
