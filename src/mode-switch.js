import { setCardMsg, ui } from './dom.js';
import { ensureLibs } from './lib/pdf.js';
import { syncImgRows } from './modes/cards/images.js';
import { syncGRows } from './modes/cards/index.js';
import { KIND, kinds } from './modes/cards/job.js';
import { updateCardInfo } from './modes/cards/load.js';
import { syncPerfDie } from './modes/cards/render.js';
import { syncWinRows, winList, winNamesChanged, winNamesOn } from './modes/cards/winietki.js';
import { updateRow } from './modes/stickers/rows.js';
import { renderPreview, renderStats, schedule } from './pipeline.js';
import { designs, state } from './state.js';

export function setAppMode(m) {
  state.mode = m;
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  document.body.dataset.mode = m;
  const pm = m === 'cards' || m === 'vouchers' || m === 'guillotine' || m === 'morgana' || m === 'deck' || m === 'winietka';
  if (pm) {
    state.job = kinds[m];
    document.getElementById('h-cards').textContent = KIND[m].title;
    document.getElementById('foldRows').hidden = m !== 'vouchers' && m !== 'winietka';
    document.getElementById('winRows').hidden = m !== 'winietka';
    document.getElementById('cardLoadRow').hidden = m === 'winietka';
    for (const id of ['rowCOffX', 'rowCOffY']) document.getElementById(id).hidden = m === 'winietka';
    if (m === 'winietka') { winList(); syncWinRows(); if (winNamesOn() && !(state.job.items || []).length) winNamesChanged(); }
    syncImgRows();
    document.getElementById('exCardPdf').textContent = m === 'winietka' ? 'Print PDF' : 'Print PDF (both sides)';
    document.getElementById('gRows').hidden = m !== 'guillotine' && m !== 'deck';
    document.getElementById('rowMSize').hidden = m !== 'morgana';
    for (const id of ['rowCGap', 'rowCutStyle', 'rowCRadius', 'rowCFlip', 'cardsCutHint']) document.getElementById(id).hidden = m === 'guillotine' || m === 'morgana' || m === 'deck' || (id === 'rowCFlip' && m === 'winietka');
    if (state.job.bleed != null) document.getElementById('cBleed').value = state.job.bleed;
    updateCardInfo();
  }
  document.getElementById('secStickers').hidden = pm || m === 'gang' || m === 'squares' || m === 'svgplt' || m === 'duplex';
  document.getElementById('secDuplex').hidden = m !== 'duplex';
  document.getElementById('secExport').hidden = m === 'duplex';
  document.getElementById('secSvgPlt').hidden = m !== 'svgplt';
  document.getElementById('spExports').hidden = m !== 'svgplt';
  document.getElementById('secSquares').hidden = m !== 'squares';
  document.getElementById('squaresExports').hidden = m !== 'squares';
  document.getElementById('secGang').hidden = m !== 'gang';
  document.getElementById('gangExports').hidden = m !== 'gang';
  document.getElementById('secCards').hidden = !pm;
  document.getElementById('secVinyl').hidden = m !== 'vinyl' && m !== 'pen';
  document.getElementById('h-vinyl').textContent = m === 'pen' ? 'Pen' : 'Vinyl';
  document.getElementById('stickerExports').hidden = m !== 'stickers';
  document.getElementById('stickerBatch').hidden = m !== 'stickers';
  document.getElementById('cardExports').hidden = !pm;
  document.getElementById('vinylExports').hidden = m !== 'vinyl' && m !== 'pen';
  document.getElementById('backToggle').hidden = !(pm || m === 'duplex') || m === 'winietka';
  if (pm) syncGRows();
  syncPerfDie();
  document.getElementById('lgKissT').textContent = m === 'stickers' ? 'Kiss cut' : m === 'pen' ? 'Pen line' : m === 'guillotine' || m === 'deck' || m === 'gang' ? 'Guillotine cut' : m === 'morgana' ? 'CardXtra cut' : 'Cut line';
  document.getElementById('lgDieW').hidden = m !== 'stickers';
  document.getElementById('lgKissW').hidden = m === 'duplex';
  state.view = null;
  ui.dropNote.textContent = m === 'winietka' ? 'Drop the winietki PDFs here (one card per page).' : m === 'svgplt' ? 'Drop the print-and-cut SVG here.' : m === 'gang' ? 'Drop photos and PDFs here.' : m === 'deck' ? 'Drop the multi-page card PDF here (front, back, front, back…).' : m === 'guillotine' || m === 'morgana' ? 'Drop the PDF here (page 1 front, page 2 back).' : pm ? `Drop the ${KIND[m].one} PDF here (page 1 ${m === 'vouchers' ? 'outside' : 'front'}, page 2 ${m === 'vouchers' ? 'inside' : 'back'}).` : m === 'vinyl' ? 'Drop SVG files with the shapes to cut.' : m === 'pen' ? 'Drop SVG files with the lines to draw.' : 'Drop SVG files (or PDFs for round stickers) here to start filling the sheet.';
  designs.forEach(updateRow);
  ui.msg.textContent = '';
  if (pm || m === 'gang') ensureLibs().catch(e => setCardMsg(e.message, true));
  renderStats(); renderPreview(); schedule();
}
for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setAppMode(b.dataset.mode));
