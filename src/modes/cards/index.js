import { makeZip } from '../../core/zip.js';
import { setCardMsg } from '../../dom.js';
import { buildCutPdf, closedAll, lemurCutSvg, openAll, pdfClick } from '../../export/cut-files.js';
import { saveFile } from '../../export/files.js';
import { renderPreview, renderStats, schedule } from '../../pipeline.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';
import { registerMode } from '../registry.js';
import { KIND, deckPer, isPrintMode } from './job.js';
import { cardCuts, cardPlt, deckLike, deckPlan, dotCut, winPlan } from './layout.js';
import { loadCardFile } from './load.js';
import { buildCardCutSvg, buildCardsPdf, buildDeckPdf, buildWinietkaPdf } from './pdf.js';
import { renderCardPreview, renderCardStats } from './render.js';
import { computeCards, winAddFiles } from './winietki.js';

const cardMode = { compute: computeCards, renderPreview: renderCardPreview, renderStats: renderCardStats, onDrop: files => loadCardFile(files) };
registerMode(['cards', 'vouchers', 'guillotine', 'morgana', 'deck'], cardMode);
registerMode('winietka', { ...cardMode, onDrop: files => winAddFiles(files) });
export function syncGRows() {
  const g = state.mode === 'guillotine', each = deckLike() && deckPer() === 1;
  document.getElementById('deckRows').hidden = !deckLike();
  document.getElementById('rowGPages').hidden = !g;
  document.getElementById('rowGMarksBack').hidden = each;
  document.getElementById('backToggle').hidden = !isPrintMode() || state.mode === 'winietka' || each;
  if (each) document.getElementById('showBack').checked = false;
  document.getElementById('rowDeckSets').hidden = each;
  document.getElementById('rowGEachSets').hidden = !each;
}
document.getElementById('gPages').addEventListener('change', () => { syncGRows(); state.view = null; schedule(); });
document.getElementById('cardFile').addEventListener('change', e => { const l = Array.from(e.target.files); e.target.value = ''; if (l.length) loadCardFile(l); });
document.getElementById('showBack').addEventListener('change', () => renderPreview());
document.getElementById('deckSheet').addEventListener('change', () => renderPreview());
export const syncPerf = () => { document.getElementById('perfRows').hidden = !document.getElementById('cFoldOn').checked; document.getElementById('rowGScale').hidden = document.getElementById('gSize').value !== 'custom'; document.getElementById('rowGSpace').hidden = document.getElementById('gAutoGap').checked; };
document.getElementById('gAutoGap').addEventListener('change', syncPerf);
document.getElementById('gSize').addEventListener('change', syncPerf);
document.getElementById('cFoldOn').addEventListener('change', syncPerf);
const cardBase = () => `${KIND[state.mode] ? KIND[state.mode].file : 'cards'}-${state.job.layout ? state.job.layout.n : 0}pcs`;
document.getElementById('exCardPdf').addEventListener('click', async () => {
  const btn = document.getElementById('exCardPdf');
  btn.disabled = true; setCardMsg('Building the PDF…');
  try { if (state.mode === 'winietka') { await saveFile(`winietki-${winPlan(readOpts()).total}pcs-print.pdf`, await buildWinietkaPdf()); renderStats(); return; }
    const dl = deckLike(), dk = dl ? deckPlan(readOpts()) : null;
    await saveFile(dl ? (state.mode === 'deck' ? `deck-${dk.sets}sets-print.pdf` : `guillotine-${dk.total}pcs-${dk.sheets}sheets-print.pdf`) : `${cardBase()}-print.pdf`, dl ? await buildDeckPdf() : await buildCardsPdf()); renderStats(); }
  catch (e) { setCardMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
  finally { btn.disabled = false; }
});
document.getElementById('exCardCut').addEventListener('click', () => {
  const o = readOpts(), c = cardCuts();
  saveFile(`${cardBase()}-cut.svg`, state.template.generated ? lemurCutSvg([{ name: o.dieLayer, color: o.dieColor, paths: [
    ...c.loops.map(pts => ({ pts, closed: true })), ...[...c.folds, ...c.v, ...c.h, ...c.dashes].map(pts => ({ pts, closed: false }))] }]) : buildCardCutSvg());
});
document.getElementById('exCardPlt').addEventListener('click', () => {
  const o = readOpts(), name = `${cardBase()}${dotCut(o) ? '-nosensor' : ''}`;
  saveFile(`${name}-plt.zip`, makeZip([{ name: `${name}-die.plt`, text: cardPlt(cardCuts(), o) }]));
});
pdfClick('exCardCutPdf', () => `${cardBase()}-cut.pdf`, () => {
  const o = readOpts(), c = cardCuts();
  return buildCutPdf(state.template.wMm, state.template.hMm, [{ name: o.dieLayer, color: o.dieColor, paths: [...closedAll(c.loops), ...openAll([...c.folds, ...c.v, ...c.h, ...c.dashes])] }], true);
});
