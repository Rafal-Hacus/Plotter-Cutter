// Switching between modes: which panels each mode shows, the legend and the hint on the empty sheet.
import { byId, setMsg, ui } from './dom.js';
import { ensureLibs } from './lib/pdf.js';
import { enterCardMode } from './modes/cards/index.js';
import { PRINT_MODES } from './modes/cards/job.js';
import { syncPerfDie } from './modes/cards/render.js';
import { updateRow } from './modes/stickers/rows.js';
import { renderPreview, renderStats, schedule } from './pipeline.js';
import { designs, state } from './state.js';

// element id -> the modes it is shown in
const SHOWN_IN = {
  secStickers: ['stickers', 'vinyl', 'pen'], stickerExports: ['stickers'], stickerBatch: ['stickers'], lgDieW: ['stickers'],
  secCards: PRINT_MODES, cardExports: PRINT_MODES,
  secVinyl: ['vinyl', 'pen'], vinylExports: ['vinyl', 'pen'],
  secGang: ['gang'], gangExports: ['gang'],
  secRoll: ['roll'], rollExports: ['roll'],
  secSquares: ['squares'], squaresExports: ['squares'],
  secSvgPlt: ['svgplt'], spExports: ['svgplt'],
  secDuplex: ['duplex'],
  backToggle: [...PRINT_MODES.filter(m => m !== 'winietka'), 'duplex']
};
// element id -> the modes it is hidden in
const HIDDEN_IN = { secExport: ['duplex'], lgKissW: ['duplex'] };

// what the red line in the preview stands for
const CUT_LEGEND = {
  stickers: 'Kiss cut', pen: 'Pen line', guillotine: 'Guillotine cut', deck: 'Guillotine cut', gang: 'Guillotine cut', morgana: 'CardXtra cut'
};
const DROP_NOTE = {
  stickers: 'Drop SVG files (or PDFs for round stickers) here to start filling the sheet.',
  cards: 'Drop the card PDF here (page 1 front, page 2 back).',
  vouchers: 'Drop the voucher PDF here (page 1 outside, page 2 inside).',
  winietka: 'Drop the winietki PDFs here (one card per page).',
  guillotine: 'Drop the PDF here (page 1 front, page 2 back).',
  morgana: 'Drop the PDF here (page 1 front, page 2 back).',
  deck: 'Drop the multi-page card PDF here (front, back, front, back…).',
  gang: 'Drop photos and PDFs here.',
  roll: 'Drop the PDFs here (signs, labels, banners).',
  vinyl: 'Drop SVG files with the shapes to cut.',
  pen: 'Drop SVG files with the lines to draw.',
  svgplt: 'Drop the print-and-cut SVG here.'
};

export function setAppMode(m) {
  state.mode = m;
  state.view = null;
  state.loadError = '';
  document.body.dataset.mode = m;
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  for (const [id, modes] of Object.entries(SHOWN_IN)) byId(id).hidden = !modes.includes(m);
  for (const [id, modes] of Object.entries(HIDDEN_IN)) byId(id).hidden = modes.includes(m);
  byId('h-vinyl').textContent = m === 'pen' ? 'Pen' : 'Vinyl';
  byId('lgKissT').textContent = CUT_LEGEND[m] || 'Cut line';
  ui.dropNote.textContent = DROP_NOTE[m] || '';
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
