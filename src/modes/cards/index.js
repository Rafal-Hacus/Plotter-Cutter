// The card modes (business cards, vouchers, winietki, guillotine, card deck, Morgana CardXtra): the mode itself,
// the rows of its panel, and its export buttons.
import { makeZip } from '../../core/zip.js';
import { byId, saveFile, setMsg } from '../../dom.js';
import { buildCutPdf, closedAll, lemurCutSvg, openAll, pdfClick } from '../../export/cut-files.js';
import { syncImgRows } from './images.js';
import { KIND, PRINT_MODES, deckLike, deckPer, isPrintMode, kinds } from './job.js';
import { cardCuts, cardPlt, computeCardLayout, deckPlan, dotCut, winPlan } from './layout.js';
import { loadCardFile, updateCardInfo } from './load.js';
import { buildCardCutSvg, buildCardsPdf, buildDeckPdf, buildWinietkaPdf } from './pdf.js';
import { renderCardPreview, renderCardStats } from './render.js';
import { syncWinRows, winAddFiles, winList, winNamesChanged, winNamesOn } from './winietki.js';
import { registerMode } from '../registry.js';
import { renderPreview, renderStats, schedule } from '../../pipeline.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';
import { templateSheet } from '../../template.js';

// The card modes lay one PDF job out in a grid: on the template's free area, or on a plain sheet for the guillotine.
async function computeCards(o, stale) {
  const sheet = await templateSheet(o);
  if (stale()) return false;
  state.job.layout = computeCardLayout(sheet, o);
}
const cardMode = { compute: computeCards, renderPreview: renderCardPreview, renderStats: renderCardStats, onDrop: files => loadCardFile(files) };
registerMode(PRINT_MODES.filter(m => m !== 'winietka'), cardMode);
registerMode('winietka', { ...cardMode, onDrop: files => winAddFiles(files) });

// Opening one of the card modes: its own job, and the rows of the Cards panel that apply to it.
export function enterCardMode(m) {
  const win = m === 'winietka', plainSheet = m === 'guillotine' || m === 'morgana' || m === 'deck';
  state.job = kinds[m];
  byId('h-cards').textContent = KIND[m].title;
  byId('foldRows').hidden = m !== 'vouchers' && !win;
  byId('winRows').hidden = !win;
  byId('cardLoadRow').hidden = win;
  for (const id of ['rowCOffX', 'rowCOffY']) byId(id).hidden = win;
  byId('exCardPdf').textContent = win ? 'Print PDF' : 'Print PDF (both sides)';
  byId('gRows').hidden = m !== 'guillotine' && m !== 'deck';
  byId('rowMSize').hidden = m !== 'morgana';
  for (const id of ['rowCGap', 'rowCutStyle', 'rowCRadius', 'cardsCutHint']) byId(id).hidden = plainSheet;
  byId('rowCFlip').hidden = plainSheet || win;
  if (win) { winList(); syncWinRows(); if (winNamesOn() && !state.job.items.length) winNamesChanged(); }
  syncImgRows();
  if (state.job.bleed != null) byId('cBleed').value = state.job.bleed;
  updateCardInfo();
  syncGRows();
}
// rows of the guillotine and the card deck that depend on how the PDF's pages are used
function syncGRows() {
  const each = deckLike() && deckPer() === 1; // every page a separate one-sided card
  byId('deckRows').hidden = !deckLike();
  byId('rowGPages').hidden = state.mode !== 'guillotine';
  byId('rowGMarksBack').hidden = each;
  byId('backToggle').hidden = !isPrintMode() || state.mode === 'winietka' || each;
  if (each) byId('showBack').checked = false;
  byId('rowDeckSets').hidden = each;
  byId('rowGEachSets').hidden = !each;
}
// rows that depend on a checkbox or a choice next to them
export function syncPerf() {
  byId('perfRows').hidden = !byId('cFoldOn').checked;
  byId('rowGScale').hidden = byId('gSize').value !== 'custom';
  byId('rowGSpace').hidden = byId('gAutoGap').checked;
}
byId('gPages').addEventListener('change', () => { syncGRows(); state.view = null; schedule(); });
byId('cardFile').addEventListener('change', e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) loadCardFile(files); });
byId('showBack').addEventListener('change', () => renderPreview());
byId('deckSheet').addEventListener('change', () => renderPreview());
for (const id of ['gAutoGap', 'gSize', 'cFoldOn']) byId(id).addEventListener('change', syncPerf);

/* ---------- exports ---------- */
const cardBase = () => `${KIND[state.mode].file}-${state.job.layout ? state.job.layout.n : 0}pcs`;
// the print PDF of the open card mode: [file name, the PDF]
async function cardPrintPdf() {
  const o = readOpts();
  if (state.mode === 'winietka') return [`winietki-${winPlan(o).total}pcs-print.pdf`, await buildWinietkaPdf()];
  if (!deckLike()) return [`${cardBase()}-print.pdf`, await buildCardsPdf()];
  const dk = deckPlan(o);
  const name = state.mode === 'deck' ? `deck-${dk.sets}sets-print.pdf` : `guillotine-${dk.total}pcs-${dk.sheets}sheets-print.pdf`;
  return [name, await buildDeckPdf()];
}
byId('exCardPdf').addEventListener('click', async () => {
  const btn = byId('exCardPdf');
  btn.disabled = true; setMsg('Building the PDF…');
  try { const [name, pdf] = await cardPrintPdf(); saveFile(name, pdf); renderStats(); }
  catch (e) { setMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
// every card cut line as one cut layer: closed outlines, then the open lines
function cardCutLayer(o) {
  const c = cardCuts();
  return { name: o.dieLayer, color: o.dieColor, paths: [...closedAll(c.loops), ...openAll([...c.folds, ...c.v, ...c.h, ...c.dashes])] };
}
byId('exCardCut').addEventListener('click', () => {
  saveFile(`${cardBase()}-cut.svg`, state.template.generated ? lemurCutSvg([cardCutLayer(readOpts())]) : buildCardCutSvg());
});
byId('exCardPlt').addEventListener('click', () => {
  const o = readOpts(), name = `${cardBase()}${dotCut(o) ? '-nosensor' : ''}`;
  saveFile(`${name}-plt.zip`, makeZip([{ name: `${name}-die.plt`, text: cardPlt(cardCuts(), o) }]));
});
pdfClick('exCardCutPdf', () => `${cardBase()}-cut.pdf`, () => buildCutPdf(state.template.wMm, state.template.hMm, [cardCutLayer(readOpts())], true));
