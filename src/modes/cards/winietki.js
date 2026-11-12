// Winietki (place cards): many different single-sided cards, from PDFs or from a list of names set on a
// background, printed with registration marks and cut with straight lines.
import { PT } from '../../core/matrix.js';
import { isPdfFile, tick } from '../../core/util.js';
import { byId, plural, setMsg } from '../../dom.js';
import { buildNameCardsPdf, parseNames } from '../../lib/namecards.js';
import { ensureLibs, pdfSource } from '../../lib/pdf.js';
import { readCardImage } from './images.js';
import { isPrintMode, kinds } from './job.js';
import { updateCardInfo } from './load.js';
import { syncOptionRows } from '../../option-rows.js';
import { renderPreview, schedule } from '../../pipeline.js';
import { applyOptionValues, readOpts, saveOpts } from '../../settings.js';
import { state } from '../../state.js';
import { LIB_KEYS, initLibrary } from '../../winlib.js';

// the winietki job; used directly, because files are still being read when another mode may already be open
const job = kinds.winietka;

export async function winAddFiles(list) {
  if (byId('winSrc').value === 'names') { setMsg('Switch “Cards from” to PDF files to add PDFs.', true); return; }
  const files = Array.from(list || []).filter(isPdfFile);
  if (!files.length) { setMsg('Load PDF files (one card per page, with bleed).', true); return; }
  setMsg('Reading the PDFs…');
  state.loadError = '';
  try {
    await ensureLibs();
    for (const f of files) await winIngest(job.items, new Uint8Array(await f.arrayBuffer()), f.name);
  } catch (e) {
    state.loadError = `Couldn’t read the PDF: ${e.message || e}`;
  }
  winSync(); // the cards read before a file that failed stay
}
/* ---------- winietki from a list of names ---------- */
const winNames = { bg: null, bgName: '', fontFile: null, fontName: '', timer: null, gen: 0 };
try { byId('winNames').value = localStorage.getItem('stickerSheet.winNames') || ''; } catch (e) { /* storage unavailable */ }
export const winNamesOn = () => state.mode === 'winietka' && byId('winSrc').value === 'names';
// the fold as the names see it (same rules as cardFoldLines), in card mm
function winFold(o, W, H) {
  if (o.cFold !== 'perf') return null;
  const vert = o.cFoldDir === 'v' ? true : o.cFoldDir === 'h' ? false : W > H + 0.01, along = vert ? W : H;
  return { dir: vert ? 'v' : 'h', pos: o.cFoldPos > 0 && o.cFoldPos < along ? o.cFoldPos : along / 2 };
}
// The "Bleed in the PDF" field is hidden where the bleed is known exactly: card images in 100 % / fit mode
// (the bleed comes from the image) and winietki from names (2 mm with a background, none without).
export function syncBleedRow() {
  const img = isPrintMode() && state.mode !== 'winietka' && state.job.imgSrc && byId('icFit').value !== 'stretch' && !state.job.imgSrc.imgs.some(im => im.edit);
  byId('cBleed').closest('.row').hidden = !!img || winNamesOn();
}
export function syncWinRows() {
  const names = byId('winSrc').value === 'names';
  byId('winPdfRows').hidden = names;
  byId('winNameRows').hidden = !names;
  byId('rowWinFontFile').hidden = byId('winFont').value !== 'custom';
  byId('winBgClear').hidden = !winNames.bg;
  byId('winBgEdit').hidden = !winNames.bg || winNames.bg.kind === 'pdf';
  syncBleedRow();
}
async function winBuildNames() {
  if (!winNamesOn()) return; // another mode was opened while the timer ran
  const my = ++winNames.gen, o = readOpts(), list = parseNames(byId('winNames').value);
  try { localStorage.setItem('stickerSheet.winNames', byId('winNames').value); } catch (e) { /* storage unavailable */ }
  const info = byId('winNamesInfo');
  info.textContent = list.length ? `${plural(list.length, 'name')}.` : 'Type or paste the names, one per line.';
  if (!list.length) { job.items = []; winSync(); return; }
  if (o.winFont === 'custom' && !winNames.fontFile) { info.textContent += ' Load a font file, or pick one of the fonts.'; return; }
  setMsg('Setting the names…');
  try {
    const W = o.winW, H = o.winH;
    const r = await buildNameCardsPdf({ names: list, W, H, bg: winNames.bg, font: o.winFont, fontFile: winNames.fontFile, size: o.winSize, color: o.winColor, fold: winFold(o, W, H), both: o.winBoth, offX: o.winOffX, offY: o.winOffY });
    if (my !== winNames.gen) return;
    // into a list of its own, so a run that is superseded while it draws the pages leaves the cards alone
    const items = [];
    await winIngest(items, r.bytes, 'names', { labels: list, bleed: r.bleed });
    if (my !== winNames.gen) return;
    job.items = items;
    if (r.shrunk) info.textContent += ` ${r.shrunk} long ${r.shrunk === 1 ? 'name was' : 'names were'} set smaller to fit.`;
    winSync();
  } catch (e) { setMsg(`Couldn’t make the cards: ${e.message || e}`, true); }
}
export function winNamesChanged() {
  syncWinRows();
  if (!winNamesOn()) return;
  clearTimeout(winNames.timer);
  winNames.timer = setTimeout(winBuildNames, 350);
}
for (const id of ['winNames', 'winW', 'winH', 'winSize', 'winColor', 'winBoth', 'winFont', 'winOffX', 'winOffY', 'cFoldOn', 'cFoldDir', 'cFoldPos'])
  byId(id).addEventListener(['winNames', 'winW', 'winH', 'winSize', 'winOffX', 'winOffY', 'cFoldPos'].includes(id) ? 'input' : 'change', winNamesChanged);
byId('winSrc').addEventListener('change', () => { job.items = []; winSync(); winNamesChanged(); });
const BG_NONE = 'No background: plain white cards without bleed. A background fills the card plus 2 mm bleed on every side (proportions kept, centred).';
const setBgInfo = () => { byId('winBgInfo').textContent = winNames.bg ? `Background: ${winNames.bgName}${winNames.bg === winNames.bgEdited ? ' (edited)' : ''}. It fills each card plus 2 mm bleed on every side (proportions kept, centred).` : BG_NONE; };
let winLib = null;
byId('winBg').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    if (isPdfFile(f)) winNames.bg = { kind: 'pdf', bytes: new Uint8Array(await f.arrayBuffer()), page: 0 };
    else { const im = await readCardImage(f); winNames.bg = { kind: im.kind, bytes: im.bytes }; }
    winNames.bgName = f.name;
    setBgInfo();
  } catch (err) { setMsg(`Couldn’t use the background: ${err.message || err}`, true); return; }
  if (winLib) winLib.backgroundChanged(false);
  winNamesChanged();
});
// the background in the full editor, on the winietka plus its 2 mm bleed (the way round the card is); the editor
// always starts from the original background, with the settings of the last edit
byId('winBgEdit').addEventListener('click', async () => {
  const bg = winNames.bg;
  if (!bg || bg.kind === 'pdf') return;
  if (bg !== winNames.bgEdited) { winNames.bgOrig = bg; winNames.bgEdit = null; }
  const o = readOpts(), { openEditor } = await import('../../editor.js');
  try {
    await openEditor({
      name: winNames.bgName || 'Background', bytes: winNames.bgOrig.bytes, state: winNames.bgEdit, format: { w: o.winW, h: o.winH, bleed: 2 }, lockOrientation: true,
      onApply: r => {
        winNames.bg = winNames.bgEdited = { kind: 'png', bytes: r.bytes }; winNames.bgEdit = r.state;
        if (winLib) winLib.backgroundChanged(false);
        setBgInfo(); winNamesChanged();
      }
    });
  } catch (e) { setMsg(`Couldn’t open the editor: ${e.message || e}`, true); }
});
byId('winBgClear').addEventListener('click', () => {
  winNames.bg = null; winNames.bgName = '';
  setBgInfo();
  if (winLib) winLib.backgroundChanged(false);
  winNamesChanged();
});
// a small JPEG of a background for the library
async function bgThumb(bg) {
  let src;
  if (bg.kind === 'pdf') {
    await ensureLibs();
    const pdf = await window.pdfjsLib.getDocument(pdfSource(bg.bytes.slice())).promise, pg = await pdf.getPage(1), vp1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: 320 / Math.max(vp1.width, vp1.height) });
    src = document.createElement('canvas'); src.width = Math.ceil(vp.width); src.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: src.getContext('2d'), viewport: vp }).promise;
  } else src = await createImageBitmap(new Blob([bg.bytes]));
  const k = Math.min(1, 320 / Math.max(src.width, src.height)), cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(src.width * k)); cv.height = Math.max(1, Math.round(src.height * k));
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(src, 0, 0, cv.width, cv.height);
  return new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82))).arrayBuffer());
}
initLibrary({
  getBackground: () => winNames.bg,
  setBackground: (bg, name) => { winNames.bg = bg; winNames.bgName = name; setBgInfo(); winNamesChanged(); },
  readSettings: keys => Object.fromEntries(keys.map(k => { const e = byId(k); return [k, e.type === 'checkbox' ? e.checked : e.value]; })),
  applySettings: st => { applyOptionValues(st, LIB_KEYS); syncOptionRows(); saveOpts(); },
  makeThumb: bgThumb
}).then(l => { winLib = l || null; });
byId('winFontFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  winNames.fontFile = new Uint8Array(await f.arrayBuffer()); winNames.fontName = f.name;
  winNamesChanged();
});
// after the cards changed: the job's summary fields, the list, and (when the mode is open) the sheet
function winSync() {
  const it = job.items;
  job.bytes = it.length ? true : null; job.pages = 1;
  job.previews = it.length ? [it[0].preview] : [];
  job.name = plural(it.length, 'card');
  if (!it.length) job.layout = null;
  winList();
  if (state.mode === 'winietka') { updateCardInfo(); schedule(); }
}
export function winList() {
  const ul = byId('winList'), it = job.items;
  ul.innerHTML = it.length ? '' : '<li class="empty">No cards yet.</li>';
  it.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'design';
    li.innerHTML = '<div class="thumb"><img alt="" style="max-width:100%;max-height:100%"></div><div><div class="dname"></div></div><button type="button" class="remove">×</button>';
    li.querySelector('img').src = c.preview;
    li.querySelector('.dname').textContent = c.name; li.querySelector('.dname').title = c.name;
    const rm = li.querySelector('.remove'); rm.setAttribute('aria-label', `Remove ${c.name}`);
    rm.addEventListener('click', () => { it.splice(i, 1); winSync(); });
    ul.appendChild(li);
  });
  byId('winClear').hidden = !it.length;
}
byId('winFile').addEventListener('change', e => { const l = Array.from(e.target.files); e.target.value = ''; winAddFiles(l); });
byId('winClear').addEventListener('click', () => { job.items = []; winSync(); });
byId('winSheet').addEventListener('change', () => renderPreview());
// Add every page of a PDF to `items` as a winietka. labels: names for the pages (else file name + page);
// bleed: the exact bleed of generated pages (else read from the trim box).
async function winIngest(items, bytes, fileName, { labels = null, bleed = null } = {}) {
  const pdf = await window.pdfjsLib.getDocument(pdfSource(bytes.slice())).promise;
  const lib = await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  for (let i = 0; i < pdf.numPages; i++) {
    const lp = lib.getPage(i), mb = lp.getMediaBox(), tb = lp.getTrimBox();
    if (!items.length) { // the first card sets the size and the bleed
      job.pageW = mb.width / PT; job.pageH = mb.height / PT; job.mbx = mb.x; job.mby = mb.y; job.bleed = null;
      if (bleed != null) job.bleed = bleed;
      else if (tb.width < mb.width - 0.5 && tb.height < mb.height - 0.5) job.bleed = Math.round((mb.width - tb.width) / 2 / PT * 100) / 100;
      if (job.bleed != null) byId('cBleed').value = job.bleed;
    }
    const pg = await pdf.getPage(i + 1), vp = pg.getViewport({ scale: 6 / PT });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    items.push({ name: labels ? labels[i] : pdf.numPages > 1 ? `${fileName} p.${i + 1}` : fileName, bytes, page: i, w: mb.width, h: mb.height, mbx: mb.x, mby: mb.y, preview: cv.toDataURL('image/jpeg', 0.85) });
    cv.width = cv.height = 1;
    if (i % 20 === 19) await tick();
  }
}
