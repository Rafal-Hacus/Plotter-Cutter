// Loading a card job: a PDF, or pictures that are turned into one.
import { PT } from '../../core/matrix.js';
import { mm1, num } from '../../core/svg.js';
import { isImageFile, isPdfFile } from '../../core/util.js';
import { byId, setMsg } from '../../dom.js';
import { ensureLibs, pdfSource } from '../../lib/pdf.js';
import { imagesToCardPdf, readCardImage, syncImgRows } from './images.js';
import { KIND, pageScale } from './job.js';
import { schedule } from '../../pipeline.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';

export async function loadCardFile(input) {
  const list = Array.from(input && input.length != null ? input : input ? [input] : []);
  const pdfF = list.find(isPdfFile), imgs = list.filter(isImageFile);
  if (!pdfF && imgs.length) {
    setMsg('Reading the image…');
    try {
      const max = state.mode === 'deck' || state.mode === 'guillotine' ? 400 : 2;
      const src = { imgs: [], name: imgs[0].name.replace(/\.[^.]+$/, '') };
      for (const f of imgs.slice(0, max)) src.imgs.push(await readCardImage(f));
      state.job.imgSrc = src;
      syncImgRows();
      const r = await imagesToCardPdf(src); await loadCardPdf(r.bytes, src.name, r.bleed);
    } catch (e) { state.job.imgSrc = null; syncImgRows(); setMsg(`Couldn’t use the image: ${e.message || e}`, true); }
    return;
  }
  if (!pdfF) { setMsg('Load a PDF or an image file.', true); return; }
  state.job.imgSrc = null; syncImgRows();
  setMsg('Reading the PDF…');
  try { await loadCardPdf(new Uint8Array(await pdfF.arrayBuffer()), pdfF.name, null); }
  catch (e) { setMsg(`Couldn’t read the PDF: ${e.message || e}`, true); }
}
// standard formats recognised in a card deck PDF without a trim box
const DECK_FORMATS = [[105, 148], [148, 210], [210, 297], [99, 210], [100, 150], [90, 50], [85, 55], [90, 55]];
const MORGANA_SIZES = [['90x55', 90, 55], ['90x50', 90, 50], ['85x55', 85, 55]];
// The bleed a PDF page carries, mm: from its trim box, or (card deck) from a standard format the page is a bit
// bigger than; null when it can't be told.
function pdfBleed(mb, tb, mode) {
  if (tb.width < mb.width - 0.5 && tb.height < mb.height - 0.5) return Math.round((mb.width - tb.width) / 2 / PT * 100) / 100;
  if (mode !== 'deck') return null;
  for (const [a, b] of DECK_FORMATS) for (const [fw, fh] of [[a, b], [b, a]]) {
    const bw = (mb.width / PT - fw) / 2, bh = (mb.height / PT - fh) / 2;
    if (bw >= 0 && bw <= 6 && Math.abs(bw - bh) < 0.3) return Math.round((bw + bh) / 2 * 10) / 10;
  }
  return null;
}
// Read a PDF into the open card mode's job: page size, bleed, previews of its pages.
// imgBleed: the bleed of a page built from images (exact, also when it is 0); null for a loaded PDF.
// The job and the mode are taken when the load starts: another mode may be open by the time the pages are drawn.
export async function loadCardPdf(bytes, fileName, imgBleed) {
  const job = state.job, mode = state.mode, fromImages = imgBleed != null;
  await ensureLibs();
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
  const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const p0 = lib.getPage(0), mb = p0.getMediaBox();
  const multi = mode === 'deck' || mode === 'guillotine'; // every page is used, not only front and back
  const pages = multi ? pdf.numPages : Math.min(pdf.numPages, 2), previews = [];
  for (let i = 1; i <= pages; i++) {
    const pg = await pdf.getPage(i), vp = pg.getViewport({ scale: (mode === 'deck' || pages > 2 ? 5 : 12) / PT }); // px per mm
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    previews.push(cv.toDataURL('image/jpeg', 0.88));
    cv.width = cv.height = 1;
  }
  Object.assign(job, {
    name: fileName, bytes, pages, previews, pageW: mb.width / PT, pageH: mb.height / PT, mbx: mb.x, mby: mb.y,
    bleed: fromImages ? Math.round(imgBleed * 1000) / 1000 : pdfBleed(mb, p0.getTrimBox(), mode)
  });
  if (job !== state.job) return; // another mode was opened meanwhile: its panel is not this job's
  if (job.bleed != null) byId('cBleed').value = job.bleed;
  if (mode === 'morgana') { // pick the CardXtra cut size that matches the PDF
    const b = parseFloat(byId('cBleed').value) || 0;
    const long = Math.max(job.pageW, job.pageH) - 2 * b, short = Math.min(job.pageW, job.pageH) - 2 * b;
    const hit = MORGANA_SIZES.find(([, W, H]) => Math.abs(long - W) < 0.6 && Math.abs(short - H) < 0.6);
    if (hit) byId('mSize').value = hit[0];
  }
  updateCardInfo();
  if (fromImages) setMsg('');
  schedule();
}
export function updateCardInfo() {
  const el = byId('cardInfo');
  if (!state.job.bytes) { el.textContent = KIND[state.mode].hint; return; }
  const o = readOpts(), b = o.cBleed, tw = state.job.pageW - 2 * b, th = state.job.pageH - 2 * b, sc = pageScale(o);
  el.textContent = `${state.job.name}: ${mm1(tw)} × ${mm1(th)} mm ${KIND[state.mode].one} + ${num(b)} mm bleed${state.job.bleed == null ? ' (from the setting, the PDF has no trim box)' : ''}, ${state.job.pages > 1 ? 'two-sided' : 'single-sided'}.${Math.abs(sc - 1) > 0.001 ? ` Printed at ${num(Math.round(sc * 1000) / 10)}%: ${mm1(tw * sc)} × ${mm1(th * sc)} mm.` : ''}`;
}
