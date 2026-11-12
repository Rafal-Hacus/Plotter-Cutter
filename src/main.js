// The entry point: loads every mode (each one wires its own panel and registers itself in the mode table),
// wires what the modes share, and starts the app.
import './styles.css';
import { EMPTY_LIST, byId, ui } from './dom.js';
import { setAppMode } from './mode-switch.js';
import { rebuildCardImages } from './modes/cards/images.js';
import { winNamesChanged, winNamesOn } from './modes/cards/winietki.js';
import { currentMode } from './modes/registry.js';
import { updateRow } from './modes/stickers/rows.js';
import { analyseSvgPlt, sp } from './modes/svgplt.js';
import { syncOptionRows } from './option-rows.js';
import { renderPreview, run, schedule } from './pipeline.js';
import { initPresets } from './presets.js';
import { OPT_IDS, applyOptionValues, loadOpts, optionValues, saveOpts } from './settings.js';
import { designs, state } from './state.js';
import { applySheetSize, setTemplate } from './template.js';
import './viewport.js';
import './modes/stickers/index.js';
import './modes/stickers/export.js';
import './modes/stickers/batch.js';
import './modes/vinyl.js';
import './modes/gang.js';
import './modes/squares.js';
import './modes/duplex.js';
import './plt-modifier.js';

/* ---------- the sheet template ---------- */
ui.tplFile.addEventListener('change', async () => {
  const f = ui.tplFile.files[0]; ui.tplFile.value = '';
  if (!f) return;
  try { setTemplate(await f.text(), f.name.replace(/\.svg$/i, ''), false); schedule(); }
  catch (e) { ui.msg.textContent = `Template: ${e.message}`; ui.msg.className = 'msg warn'; }
});
ui.tplReset.addEventListener('click', () => { applySheetSize(); schedule(); });
for (const id of ['sheetSize', 'sheetFeed']) byId(id).addEventListener('change', () => { applySheetSize(); schedule(); });
for (const id of ['sheetW', 'sheetH', 'sheetFeedMm']) byId(id).addEventListener('input', () => { applySheetSize(); schedule(); });

/* ---------- option fields ---------- */
// fields that only change how the result is written or drawn: nothing has to be laid out again
const REDRAW_ONLY = ['kissColor', 'dieColor', 'kissLayer', 'dieLayer', 'borderFill', 'borderColor', 'lineW', 'overcut', 'bladeOffset', 'pltForce', 'kissForce', 'dieForce', 'cutSpeed', 'upSpeed'];
for (const id of OPT_IDS) {
  const e = byId(id), picks = e.type === 'color' || e.type === 'checkbox' || e.tagName === 'SELECT';
  e.addEventListener(picks ? 'change' : 'input', () => {
    const t = state.template;
    // a template without a size in it is read at the dpi setting
    if (id === 'dpi' && t && t.unitless) setTemplate(t.text, t.name, ui.tplReset.hidden);
    if (!REDRAW_ONLY.includes(id)) { schedule(); return; }
    saveOpts();
    if (state.template) renderPreview();
    designs.forEach(updateRow);
  });
}
ui.showArt.addEventListener('change', () => renderPreview());

/* ---------- dropping files on the page ---------- */
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dropping'); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dropping'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  const mode = currentMode();
  if (mode.onDrop) mode.onDrop(e.dataTransfer.files);
});

/* ---------- saved settings: the mode plus every option field ---------- */
function snapshotSettings() { return { mode: state.mode, settings: optionValues() }; }
function applySettings({ mode, settings }) {
  applyOptionValues(settings);
  syncOptionRows();
  const t = state.template;
  if (!t || t.generated) applySheetSize(); // a template you loaded yourself stays
  else if (t.unitless) setTemplate(t.text, t.name, false);
  saveOpts();
  if (state.job.imgSrc) rebuildCardImages();
  if (sp.text) analyseSvgPlt();
  setAppMode(mode);
  if (winNamesOn()) winNamesChanged();
}

/* ---------- start ---------- */
loadOpts();
syncOptionRows();
applySheetSize();
ui.list.innerHTML = EMPTY_LIST;
renderPreview();
run();
initPresets({ snapshot: snapshotSettings, apply: applySettings });
// Browsers give the in-browser AI the graphics card and all processor cores only on secure, cross-origin isolated
// pages (https or localhost, with the COOP/COEP headers the server sends). Otherwise it is stuck on one core: say so.
if (!(window.isSecureContext && window.crossOriginIsolated)) {
  const el = byId('secureNote');
  el.textContent = window.isSecureContext
    ? 'The page is missing the cross-origin isolation headers (a proxy in front of the app may drop them), so the AI runs on one processor core. Pass Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy through.'
    : 'This page is on plain HTTP, so the browser blocks the graphics card and multi-core for the AI (it runs on one processor core, slowly). Open the app over https to use them.';
  el.hidden = false;
}
