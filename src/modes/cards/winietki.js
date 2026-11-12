import { setCardMsg } from '../../dom.js';
import { buildNameCardsPdf, parseNames } from '../../lib/namecards.js';
import { ensureLibs, pdfSource } from '../../lib/pdf.js';
import { renderPreview, schedule } from '../../pipeline.js';
import { readOpts, saveOpts } from '../../settings.js';
import { state } from '../../state.js';
import { templateSheet } from '../../template.js';
import { LIB_KEYS, initLibrary } from '../../winlib.js';
import { syncOptionRows } from '../duplex.js';
import { readCardImage } from './images.js';
import { isPrintMode } from './job.js';
import { winIngest } from './layout.js';
import { computeCardLayout, updateCardInfo } from './load.js';

export async function winAddFiles(list) {
  if (document.getElementById('winSrc').value === 'names') { setCardMsg('Switch “Cards from” to PDF files to add PDFs.', true); return; }
  const files = Array.from(list || []).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) { setCardMsg('Load PDF files (one card per page, with bleed).', true); return; }
  setCardMsg('Reading the PDFs…');
  try {
    await ensureLibs();
    state.job.items = state.job.items || [];
    for (const f of files) await winIngest(new Uint8Array(await f.arrayBuffer()), f.name);
    winSync();
  } catch (e) {
    setCardMsg(`Couldn’t read the PDF: ${e.message || e}`, true);
  }
}
/* ---------- winietki from a list of names ---------- */
const winNames = { bg: null, bgName: '', fontFile: null, fontName: '', timer: null, gen: 0 };
try { document.getElementById('winNames').value = localStorage.getItem('stickerSheet.winNames') || ''; } catch (e) { /* storage unavailable */ }
export const winNamesOn = () => state.mode === 'winietka' && document.getElementById('winSrc').value === 'names';
// the fold as the names see it (same rules as cardFoldLines), in card mm
function winFold(o, W, H) {
  if (o.cFold !== 'perf') return null;
  const vert = o.cFoldDir === 'v' ? true : o.cFoldDir === 'h' ? false : W > H + 0.01, along = vert ? W : H;
  return { dir: vert ? 'v' : 'h', pos: o.cFoldPos > 0 && o.cFoldPos < along ? o.cFoldPos : along / 2 };
}
// The "Bleed in the PDF" field is hidden where the bleed is known exactly: card images in 100 % / fit mode
// (the bleed comes from the image) and winietki from names (2 mm with a background, none without).
export function syncBleedRow() {
  const img = isPrintMode() && state.mode !== 'winietka' && state.job.imgSrc && document.getElementById('icFit').value !== 'stretch' && !state.job.imgSrc.imgs.some(im => im.edit);
  document.getElementById('cBleed').closest('.row').hidden = !!img || winNamesOn();
}
export function syncWinRows() {
  const names = document.getElementById('winSrc').value === 'names';
  document.getElementById('winPdfRows').hidden = names;
  document.getElementById('winNameRows').hidden = !names;
  document.getElementById('rowWinFontFile').hidden = document.getElementById('winFont').value !== 'custom';
  document.getElementById('winBgClear').hidden = !winNames.bg;
  document.getElementById('winBgEdit').hidden = !winNames.bg || winNames.bg.kind === 'pdf';
  syncBleedRow();
}
async function winBuildNames() {
  const my = ++winNames.gen, o = readOpts(), list = parseNames(document.getElementById('winNames').value);
  try { localStorage.setItem('stickerSheet.winNames', document.getElementById('winNames').value); } catch (e) { /* storage unavailable */ }
  const info = document.getElementById('winNamesInfo');
  info.textContent = list.length ? `${list.length} ${list.length === 1 ? 'name' : 'names'}.` : 'Type or paste the names, one per line.';
  if (!list.length) { state.job.items = []; winSync(); return; }
  if (o.winFont === 'custom' && !winNames.fontFile) { info.textContent += ' Load a font file, or pick one of the fonts.'; return; }
  setCardMsg('Setting the names…');
  try {
    const W = o.winW, H = o.winH;
    const r = await buildNameCardsPdf({ names: list, W, H, bg: winNames.bg, font: o.winFont, fontFile: winNames.fontFile, size: o.winSize, color: o.winColor, fold: winFold(o, W, H), both: o.winBoth, offX: o.winOffX, offY: o.winOffY });
    if (my !== winNames.gen) return;
    const items = [], saved = state.job.items;
    state.job.items = items;
    try { await winIngest(r.bytes, 'names', { labels: list, bleed: r.bleed }); }
    catch (e) { state.job.items = saved; throw e; }
    if (my !== winNames.gen) return;
    if (r.shrunk) info.textContent += ` ${r.shrunk} long ${r.shrunk === 1 ? 'name was' : 'names were'} set smaller to fit.`;
    winSync();
  } catch (e) { setCardMsg(`Couldn’t make the cards: ${e.message || e}`, true); }
}
export function winNamesChanged() {
  syncWinRows();
  if (!winNamesOn()) return;
  clearTimeout(winNames.timer);
  winNames.timer = setTimeout(winBuildNames, 350);
}
for (const id of ['winNames', 'winW', 'winH', 'winSize', 'winColor', 'winBoth', 'winFont', 'winOffX', 'winOffY', 'cFoldOn', 'cFoldDir', 'cFoldPos'])
  document.getElementById(id).addEventListener(['winNames', 'winW', 'winH', 'winSize', 'winOffX', 'winOffY', 'cFoldPos'].includes(id) ? 'input' : 'change', winNamesChanged);
document.getElementById('winSrc').addEventListener('change', () => { state.job.items = []; winSync(); winNamesChanged(); });
const BG_NONE = 'No background: plain white cards without bleed. A background fills the card plus 2 mm bleed on every side (proportions kept, centred).';
const setBgInfo = () => { document.getElementById('winBgInfo').textContent = winNames.bg ? `Background: ${winNames.bgName}${winNames.bg === winNames.bgEdited ? ' (edited)' : ''}. It fills each card plus 2 mm bleed on every side (proportions kept, centred).` : BG_NONE; };
let winLib = null;
document.getElementById('winBg').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') winNames.bg = { kind: 'pdf', bytes: new Uint8Array(await f.arrayBuffer()), page: 0 };
    else { const im = await readCardImage(f); winNames.bg = { kind: im.kind, bytes: im.bytes }; }
    winNames.bgName = f.name;
    setBgInfo();
  } catch (err) { setCardMsg(`Couldn’t use the background: ${err.message || err}`, true); return; }
  if (winLib) winLib.backgroundChanged(false);
  winNamesChanged();
});
// the background in the full editor, on the winietka plus its 2 mm bleed (the way round the card is); the editor
// always starts from the original background, with the settings of the last edit
document.getElementById('winBgEdit').addEventListener('click', async () => {
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
  } catch (e) { setCardMsg(`Couldn’t open the editor: ${e.message || e}`, true); }
});
document.getElementById('winBgClear').addEventListener('click', () => {
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
  readSettings: keys => Object.fromEntries(keys.map(k => { const e = document.getElementById(k); return [k, e.type === 'checkbox' ? e.checked : e.value]; })),
  applySettings: st => {
    for (const k of LIB_KEYS) {
      if (!Object.hasOwn(st, k)) continue;
      const e = document.getElementById(k);
      if (e.type === 'checkbox') e.checked = !!st[k]; else e.value = String(st[k]);
    }
    syncOptionRows(); saveOpts();
  },
  makeThumb: bgThumb
}).then(l => { winLib = l || null; });
document.getElementById('winFontFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  winNames.fontFile = new Uint8Array(await f.arrayBuffer()); winNames.fontName = f.name;
  winNamesChanged();
});
function winSync() {
  const it = state.job.items || [];
  state.job.bytes = it.length ? true : null; state.job.pages = 1;
  state.job.previews = it.length ? [it[0].preview] : [];
  state.job.name = `${it.length} ${it.length === 1 ? 'card' : 'cards'}`;
  if (!it.length) state.job.layout = null;
  winList(); updateCardInfo(); schedule();
}
export function winList() {
  const ul = document.getElementById('winList'), it = state.job.items || [];
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
  document.getElementById('winClear').hidden = !it.length;
}
document.getElementById('winFile').addEventListener('change', e => { const l = Array.from(e.target.files); e.target.value = ''; winAddFiles(l); });
document.getElementById('winClear').addEventListener('click', () => { state.job.items = []; winSync(); });
document.getElementById('winSheet').addEventListener('change', () => renderPreview());
// The card modes lay one PDF job out in a grid: on the template's free area, or on a plain sheet for the guillotine.
export async function computeCards(o, stale) {
  const sheet = await templateSheet(o);
  if (stale()) return false;
  state.job.layout = computeCardLayout(sheet, o);
}
