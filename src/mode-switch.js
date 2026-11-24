// Switching between modes: which panels each mode shows, the legend and the hint on the empty sheet.
import { byId, setMsg, ui } from './dom.js';
import { ensureLibs } from './lib/pdf.js';
import { enterCardMode } from './modes/cards/index.js';
import { PRINT_MODES } from './modes/cards/job.js';
import { syncPerfDie } from './modes/cards/render.js';
import { updateRow } from './modes/stickers/rows.js';
import { FIELD_MODES, MODE_META, PANEL_MODES, ROW_PANELS } from './modes/meta.js';
import { renderPreview, renderStats, schedule } from './pipeline.js';
import { designs, state } from './state.js';

// element id -> the modes it is shown in
const SHOWN_IN = {
  secStickers: ['stickers', 'vinyl', 'pen'], stickerExports: ['stickers'], stickerBatch: ['stickers'], lgDieW: ['stickers'],
  secCards: PRINT_MODES, cardExports: PRINT_MODES,
  secVinyl: ['vinyl', 'pen'], vinylExports: ['vinyl', 'pen'],
  secGang: ['gang'], gangExports: ['gang'],
  secRoll: ['roll'], rollExports: ['roll'],
  secStamps: ['stamps'], stampsExports: ['stamps'],
  secSquares: ['squares'], squaresExports: ['squares'],
  secSvgPlt: ['svgplt'], spExports: ['svgplt'],
  secDuplex: ['duplex'],
  ...PANEL_MODES,
  backToggle: [...PRINT_MODES.filter(m => m !== 'winietka'), 'duplex']
};
// element id -> the modes it is hidden in
const HIDDEN_IN = { secExport: ['duplex'], lgKissW: ['duplex'] };

// what the red line in the preview stands for
const CUT_LEGEND = {
  stickers: 'Kiss cut', pen: 'Pen line', guillotine: 'Guillotine cut', deck: 'Guillotine cut', gang: 'Guillotine cut', morgana: 'CardXtra cut'
};

// The rows of the shared panels (Cut lines, Layout) the mode reads, the hint right after each row with it, and a
// panel or a group in it only when something in it is shown. Hidden fields keep their values.
function showSharedRows(m) {
  for (const [id, modes] of Object.entries(FIELD_MODES)) {
    const row = byId(id).closest('.row'), hint = row.nextElementSibling;
    row.hidden = !modes.includes(m);
    if (hint && hint.classList.contains('hint')) hint.hidden = row.hidden;
  }
  const anyRow = el => [...el.querySelectorAll('.row')].some(r => !r.hidden);
  for (const id of ROW_PANELS) {
    const panel = byId(id);
    for (const sub of panel.querySelectorAll('details.sub')) sub.hidden = !anyRow(sub);
    panel.hidden = !anyRow(panel);
  }
}

export function setAppMode(m) {
  state.mode = m;
  state.view = null;
  state.loadError = '';
  document.body.dataset.mode = m;
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  for (const [id, modes] of Object.entries(SHOWN_IN)) byId(id).hidden = !modes.includes(m);
  for (const [id, modes] of Object.entries(HIDDEN_IN)) byId(id).hidden = modes.includes(m);
  showSharedRows(m);
  const meta = MODE_META[m];
  document.title = `${meta.title} · Plotter Cutter`;
  byId('appTitle').textContent = meta.title;
  byId('appLede').textContent = meta.lede;
  if (meta.files) byId('h-stickers').textContent = meta.files;
  byId('h-vinyl').textContent = m === 'pen' ? 'Pen' : 'Vinyl';
  byId('lgKissT').textContent = CUT_LEGEND[m] || 'Cut line';
  ui.dropNote.textContent = meta.drop;
  const printMode = PRINT_MODES.includes(m);
  if (printMode) enterCardMode(m);
  syncPerfDie();
  designs.forEach(updateRow);
  ui.msg.textContent = '';
  // the PDF libraries load in the background as soon as a mode that needs them opens
  if (printMode || m === 'gang' || m === 'roll') ensureLibs().catch(e => setMsg(e.message, true));
  renderStats(); renderPreview(); schedule();
}
for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setAppMode(b.dataset.mode));
