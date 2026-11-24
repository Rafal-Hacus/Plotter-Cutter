// Loading a card job: a PDF, or pictures that are turned into one.
import { PT } from '../../core/matrix.js';
import { pageGeom } from '../../core/pdfembed.js';
import { mm1, num } from '../../core/svg.js';
import { isImageFile, isPdfFile } from '../../core/util.js';
import { byId, setMsg } from '../../dom.js';
import { ensureLibs, pdfSource } from '../../lib/pdf.js';
import { imagesToCardPdf, readCardImage, syncImgRows } from './images.js';
import { KIND, pageScale, showBleed } from './job.js';
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
// standard formats recognised in a PDF without a trim box
const STD_FORMATS = [[105, 148], [148, 210], [210, 297], [297, 420], [99, 210], [100, 150], [90, 50], [85, 55], [90, 55]];
const MORGANA_SIZES = [['90x55', 90, 55], ['90x50', 90, 50], ['85x55', 85, 55]];
// The bleed a PDF page carries, mm, and where it was read: only from the file, never from the last job.
// 'trim': its trim box (0 when the trim box is the whole page); 'format': no trim box, but the page is a standard
// format (or card size) plus up to 6 mm on every side; 'none': no trim box, so the whole page is the card.
export function pdfBleed(g) {
  if (g.bleed != null) return { bleed: g.bleed, how: 'trim' };
  for (const [a, b] of STD_FORMATS) for (const [fw, fh] of [[a, b], [b, a]]) {
    const bw = (g.w / PT - fw) / 2, bh = (g.h / PT - fh) / 2;
    if (bw > 0.05 && bw <= 6 && Math.abs(bw - bh) < 0.3) return { bleed: Math.round((bw + bh) / 2 * 10) / 10, how: 'format', format: [fw, fh] };
  }
  return { bleed: 0, how: 'none' };
}
// how the bleed of the open job was found, for the notes
function bleedSource(job) {
  const b = job.bleedFrom;
  if (!b) return '';
  if (b.how === 'typed') return ' (as typed: the file’s own bleed is used again when it is loaded again)';
  if (b.how === 'none') return ' (the PDF has no trim box, so the whole page is taken as the card: type the bleed if the page has one)';
  if (b.how === 'format') return ` (the PDF has no trim box: taken as ${num(b.format[0])} × ${num(b.format[1])} mm plus the bleed, from its size)`;
  if (b.how === 'trim' && !b.bleed) return ' (the trim box is the whole page)';
  return '';
}
// A page drawn the way it is printed (pdf.js page, its pageGeom): only its box, turned by its /Rotate, at pxPerMm.
export async function renderShown(pg, g, pxPerMm, type = 'image/jpeg', quality = 0.88) {
  const scale = pxPerMm * 25.4 / 72, vp0 = pg.getViewport({ scale }), { x, y, width, height } = g.box;
  const pts = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(q => vp0.convertToViewportPoint(q[0], q[1]));
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
  const vp = pg.getViewport({ scale, offsetX: -x0, offsetY: -y0 });
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.ceil(Math.max(...xs) - x0)); cv.height = Math.max(1, Math.ceil(Math.max(...ys) - y0));
  await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  const url = cv.toDataURL(type, quality);
  cv.width = cv.height = 1;
  return url;
}
// Read a PDF into the open card mode's job: page size, bleed, previews of its pages.
// imgBleed: the bleed of a page built from images (exact, also when it is 0); null for a loaded PDF.
// The job and the mode are taken when the load starts: another mode may be open by the time the pages are drawn.
export async function loadCardPdf(bytes, fileName, imgBleed) {
  const job = state.job, mode = state.mode, fromImages = imgBleed != null;
  await ensureLibs();
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
  const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const multi = mode === 'deck' || mode === 'guillotine'; // every page is used, not only front and back
  const pages = multi ? pdf.numPages : Math.min(pdf.numPages, 2), previews = [], geoms = [];
  for (let i = 1; i <= pages; i++) {
    const g = pageGeom(lib.getPage(i - 1));
    geoms.push(g);
    previews.push(await renderShown(await pdf.getPage(i), g, mode === 'deck' || pages > 2 ? 5 : 12)); // px per mm
  }
  const g0 = geoms[0];
  Object.assign(job, {
    name: fileName, bytes, pages, previews, geoms, pageW: g0.w / PT, pageH: g0.h / PT,
    bleedFrom: fromImages ? null : pdfBleed(g0)
  });
  job.bleed = fromImages ? Math.round(imgBleed * 1000) / 1000 : job.bleedFrom.bleed;
  if (job !== state.job) return; // another mode was opened meanwhile: its panel is not this job's
  showBleed(job);
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
  el.textContent = `${state.job.name}: ${mm1(tw)} × ${mm1(th)} mm ${KIND[state.mode].one} + ${num(b)} mm bleed${bleedSource(state.job)}, ${state.job.pages > 1 ? 'two-sided' : 'single-sided'}.${Math.abs(sc - 1) > 0.001 ? ` Printed at ${num(Math.round(sc * 1000) / 10)}%: ${mm1(tw * sc)} × ${mm1(th * sc)} mm.` : ''}`;
}
