// PLT modifier: change the force and speeds of existing PLT files, cut twice, thin out dense paths.
import { modifyPlt, pltValues } from './core/plt.js';
import { esc } from './core/svg.js';
import { makeZip, readZipPlts } from './core/zip.js';
import { byId, saveFile, setMsg } from './dom.js';

const modFiles = [];
const MOD_KEYS = [['force', 'modForce', 1, 160], ['speed', 'modSpeed', 1, 13], ['up', 'modUp', 1, 13]];
function modRender() {
  const box = byId('modTable');
  byId('exMod').disabled = !modFiles.length;
  // the 'all files' fields show the common value, or say the files differ
  for (const [k, id] of MOD_KEYS) {
    const vals = [...new Set(modFiles.map(f => f[k]))], el = byId(id);
    el.value = vals.length === 1 && vals[0] != null ? vals[0] : '';
    el.placeholder = !modFiles.length ? '' : vals.length > 1 ? 'differs' : 'not set';
  }
  if (!modFiles.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<table class="modt"><thead><tr><th>File</th><th>Force g</th><th>Speed</th><th>Up</th></tr></thead><tbody>${modFiles.map((f, i) =>
    `<tr><td title="${esc(f.name)}">${esc(f.name)}</td>${MOD_KEYS.map(([k, , lo, hi]) => `<td><input type="number" min="${lo}" max="${hi}" step="1" data-i="${i}" data-k="${k}" value="${f[k] ?? ''}" placeholder="–" aria-label="${k} for ${esc(f.name)}"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
    const x = parseFloat(inp.value);
    modFiles[+inp.dataset.i][inp.dataset.k] = isFinite(x) ? x : null;
    const k = inp.dataset.k, id = MOD_KEYS.find(m => m[0] === k)[1], vals = [...new Set(modFiles.map(f => f[k]))], el = byId(id);
    el.value = vals.length === 1 && vals[0] != null ? vals[0] : ''; el.placeholder = vals.length > 1 ? 'differs' : 'not set';
  }));
}
for (const [k, id] of MOD_KEYS) byId(id).addEventListener('input', e => {
  const x = parseFloat(e.target.value);
  if (!isFinite(x)) return;
  for (const f of modFiles) f[k] = x;
  document.querySelectorAll(`#modTable input[data-k="${k}"]`).forEach(inp => { inp.value = x; });
});
byId('modFile').addEventListener('change', async e => {
  const list = Array.from(e.target.files); e.target.value = '';
  modFiles.length = 0;
  try {
    for (const f of list) {
      if (/\.zip$/i.test(f.name)) modFiles.push(...await readZipPlts(await f.arrayBuffer()));
      else modFiles.push({ name: f.name, text: await f.text() });
    }
    for (const f of modFiles) Object.assign(f, pltValues(f.text));
    if (!modFiles.length) setMsg('No PLT files found.', true);
  } catch (err) { setMsg(`Couldn’t read: ${err.message || err}`, true); }
  modRender();
});
byId('exMod').addEventListener('click', () => {
  const twice = byId('modTwice').checked, clean = byId('modClean').checked;
  try {
    const notes = [];
    const out = modFiles.map(f => {
      const m = { force: f.force, speed: f.speed, up: f.up, twice, clean };
      const text = modifyPlt(f.text, m);
      if (m.counts) notes.push(`${f.name}: ${m.counts[0].toLocaleString()} → ${m.counts[1].toLocaleString()} moves`);
      return { name: f.name, text };
    });
    saveFile('modified-plt.zip', makeZip(out));
    if (notes.length) setMsg(notes.join('; ') + '.');
  } catch (err) { setMsg(`Couldn’t modify: ${err.message || err}`, true); }
});
