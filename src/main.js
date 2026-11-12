import './styles.css';
import { ui } from './dom.js';
import { setAppMode } from './mode-switch.js';
import { rebuildCardImages } from './modes/cards/images.js';
import { winNamesChanged, winNamesOn } from './modes/cards/winietki.js';
import { syncOptionRows } from './modes/duplex.js';
import { currentMode } from './modes/registry.js';
import { updateRow } from './modes/stickers/rows.js';
import { analyseSvgPlt, sp } from './modes/svgplt.js';
import { renderPreview, run, schedule } from './pipeline.js';
import { initPresets } from './presets.js';
import { OPT_IDS, loadOpts, optionValues, saveOpts } from './settings.js';
import { designs, state } from './state.js';
import { applySheetSize, setTemplate } from './template.js';
import './template.js';
import './dom.js';
import './settings.js';
import './state.js';
import './modes/registry.js';
import './modes/stickers/design.js';
import './nest.js';
import './pipeline.js';
import './modes/stickers/render.js';
import './modes/stickers/rows.js';
import './modes/stickers/index.js';
import './modes/stickers/export.js';
import './export/files.js';
import './viewport.js';
import './modes/cards/job.js';
import './modes/cards/layout.js';
import './modes/cards/images.js';
import './modes/cards/load.js';
import './modes/cards/render.js';
import './export/pdf-draw.js';
import './modes/cards/pdf.js';
import './modes/cards/winietki.js';
import './modes/cards/index.js';
import './mode-switch.js';
import './modes/vinyl.js';
import './modes/stickers/batch.js';
import './modes/gang.js';
import './modes/squares.js';
import './export/cut-files.js';
import './modes/svgplt.js';
import './plt-modifier.js';
import './modes/duplex.js';

ui.tplFile.addEventListener('change', async () => {
  const f = ui.tplFile.files[0]; ui.tplFile.value = '';
  if (!f) return;
  try { setTemplate(await f.text(), f.name.replace(/\.svg$/i, ''), false); schedule(); }
  catch (e) { ui.msg.textContent = `Template: ${e.message}`; ui.msg.className = 'msg warn'; }
});
ui.tplReset.addEventListener('click', () => { applySheetSize(); schedule(); });
for (const id of ['sheetSize', 'sheetW', 'sheetH', 'sheetFeed', 'sheetFeedMm']) document.getElementById(id).addEventListener(id === 'sheetSize' || id === 'sheetFeed' ? 'change' : 'input', () => { applySheetSize(); schedule(); });
for (const id of OPT_IDS) {
  const e = document.getElementById(id);
  e.addEventListener(e.type === 'color' || e.type === 'checkbox' || e.tagName === 'SELECT' ? 'change' : 'input', () => {
    if (id === 'dpi' && state.template && state.template.unitless) { setTemplate(state.template.text, state.template.name, ui.tplReset.hidden); }
    if (['kissColor', 'dieColor', 'kissLayer', 'dieLayer', 'borderFill', 'borderColor', 'lineW', 'overcut', 'bladeOffset', 'pltForce', 'kissForce', 'dieForce', 'cutSpeed', 'upSpeed'].includes(id)) {
      saveOpts(); if (state.template) renderPreview(); designs.forEach(updateRow); return;
    }
    schedule();
  });
}
ui.showArt.addEventListener('change', () => renderPreview());
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
// Saved settings: the mode plus every option field.
function snapshotSettings() { return { mode: state.mode, settings: optionValues() }; }
function applySettings({ mode, settings }) {
  for (const id of OPT_IDS) {
    if (!Object.hasOwn(settings, id)) continue;
    const e = document.getElementById(id);
    if (e.type === 'checkbox') e.checked = !!settings[id]; else e.value = String(settings[id]);
  }
  syncOptionRows();
  if (!state.template || state.template.generated) applySheetSize(); // a template you loaded yourself stays
  else if (state.template.unitless) setTemplate(state.template.text, state.template.name, false);
  saveOpts();
  if (state.job.imgSrc) rebuildCardImages();
  if (sp.text) analyseSvgPlt();
  setAppMode(mode);
  if (winNamesOn()) winNamesChanged();
}
loadOpts();
syncOptionRows();
applySheetSize();
ui.list.innerHTML = '<li class="empty">No stickers yet.</li>';
renderPreview();
run();
initPresets({ snapshot: snapshotSettings, apply: applySettings });
// Browsers give the in-browser AI the graphics card and all processor cores only on secure, cross-origin isolated
// pages (https or localhost, with the COOP/COEP headers the server sends). Otherwise it is stuck on one core: say so.
if (!(window.isSecureContext && window.crossOriginIsolated)) {
  const el = document.getElementById('secureNote');
  el.textContent = window.isSecureContext
    ? 'The page is missing the cross-origin isolation headers (a proxy in front of the app may drop them), so the AI runs on one processor core. Pass Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy through.'
    : 'This page is on plain HTTP, so the browser blocks the graphics card and multi-core for the AI (it runs on one processor core, slowly). Open the app over https to use them.';
  el.hidden = false;
}
