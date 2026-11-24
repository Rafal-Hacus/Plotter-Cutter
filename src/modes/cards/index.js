// The card modes (business cards, vouchers, winietki, guillotine, card deck, Morgana CardXtra): the mode itself,
// the rows of its panel, and its export buttons.
import { makeZip } from '../../core/zip.js';
import { byId, saveFile, setMsg } from '../../dom.js';
import { buildCutPdf, closedAll, lemurCutSvg, openAll, pdfClick } from '../../export/cut-files.js';
import { imagesToCardPdf, syncImgRows } from './images.js';
import { KIND, PRINT_MODES, deckLike, deckPer, isPrintMode, kinds, resetPrintJob, showBleed } from './job.js';
import { cardCuts, cardPlt, computeCardLayout, deckPlan, dotCut, winPlan } from './layout.js';
import { loadCardFile, loadCardPdf, updateCardInfo } from './load.js';
import { buildCardCutSvg, buildCardsPdf, buildDeckPdf, buildWinietkaPdf } from './pdf.js';
import { renderCardPreview, renderCardStats } from './render.js';
import { syncWinRows, winAddFiles, winList, winNamesChanged, winNamesOn, winSync } from './winietki.js';
import { registerJob, registerMode } from '../registry.js';
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
  showBleed(state.job);
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

/* ---------- each card mode's job kept in the browser (see jobstore.js) ---------- */
// what of it is kept: the PDF (or the pictures it was made from, with their edits), a bleed typed for it, and the
// winietki read from PDFs (made from names, they come from the names, which are kept with the settings)
function serializeCards(m) {
  const job = kinds[m];
  if (m === 'winietka') {
    if (byId('winSrc').value === 'names' || !job.items.length) return null;
    const bufs = [];
    for (const it of job.items) if (!bufs.some(b => b.data === it.bytes)) bufs.push({ name: it.file || 'winietki.pdf', type: 'application/pdf', data: it.bytes });
    const items = job.items.map(it => ({ f: bufs.findIndex(b => b.data === it.bytes), page: it.page }));
    return { files: bufs, state: { items, bleed: typedBleed(job) }, count: items.length };
  }
  if (job.imgSrc) {
    const imgs = job.imgSrc.imgs;
    return { files: imgs.map(im => ({ name: im.name, type: im.src.type, data: im.src })), state: { images: true, edits: imgs.map(im => im.edit || null) }, count: imgs.length };
  }
  if (!job.bytes || job.bytes === true) return null;
  return { files: [{ name: job.name, type: 'application/pdf', data: job.bytes }], state: { bleed: typedBleed(job) }, count: 1 };
}
const typedBleed = job => (job.bleedFrom && job.bleedFrom.how === 'typed' ? job.bleed : null);
function setTypedBleed(job, b) {
  if (b == null) return;
  job.bleed = b; job.bleedFrom = { how: 'typed' };
  showBleed(job); updateCardInfo();
}
async function restoreCards(m, saved, files) {
  const job = kinds[m];
  clearCards(m);
  if (m === 'winietka') {
    if (byId('winSrc').value === 'names') throw new Error('“Cards from” is set to a list of names, so the PDFs were not read again.');
    await winAddFiles(files);
    // the cards read again, matched by file and page, in the saved order (cards removed before stay removed)
    const fileOf = new Map(), seen = [];
    for (const it of job.items) { if (!seen.includes(it.bytes)) seen.push(it.bytes); fileOf.set(it, seen.indexOf(it.bytes)); }
    const by = new Map(job.items.map(it => [`${fileOf.get(it)}:${it.page}`, it]));
    job.items = saved.items.map(s => by.get(`${s.f}:${s.page}`)).filter(Boolean);
    setTypedBleed(job, saved.bleed);
    winSync();
    return;
  }
  await loadCardFile(files);
  if (saved.images && job.imgSrc) {
    // the pictures' edits, then the card PDF made from them again
    job.imgSrc.imgs.forEach((im, i) => { im.edit = saved.edits[i] || null; });
    if (job.imgSrc.imgs.some(im => im.edit)) {
      syncImgRows();
      const r = await imagesToCardPdf(job.imgSrc); await loadCardPdf(r.bytes, job.imgSrc.name, r.bleed);
    }
  }
  setTypedBleed(job, saved.bleed);
  schedule();
}
function clearCards(m) {
  resetPrintJob(kinds[m]);
  if (state.mode === m) { enterCardMode(m); schedule(); }
}
const CARD_LABELS = { cards: 'Business cards', vouchers: 'Vouchers', winietka: 'Winietki', guillotine: 'Guillotine', deck: 'Card deck', morgana: 'Morgana CardXtra' };
for (const m of PRINT_MODES) {
  registerJob(m, { modes: [m], label: CARD_LABELS[m], serialize: () => serializeCards(m), restore: (saved, files) => restoreCards(m, saved, files), clear: () => clearCards(m) });
}
