// Card jobs made from pictures (PNG, JPG, …): each picture becomes a PDF page of the card size plus bleed, with
// the missing bleed filled in. Also the rows of the Cards panel that belong to pictures.
import { imageDpi, jpegOrientation } from '../../core/image.js';
import { PT } from '../../core/matrix.js';
import { mm1, num } from '../../core/svg.js';
import { byId, setMsg } from '../../dom.js';
import { ensureLibs } from '../../lib/pdf.js';
import { isPrintMode } from './job.js';
import { loadCardPdf } from './load.js';
import { syncBleedRow } from './winietki.js';
import { saveOpts } from '../../settings.js';
import { state } from '../../state.js';

export async function readCardImage(f) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bmp;
  try { bmp = await createImageBitmap(new Blob([bytes], { type: f.type || 'image/png' })); }
  catch (e) { throw new Error(`${f.name} isn’t an image the browser can read.`, { cause: e }); }
  const png = bytes[0] === 0x89 && bytes[1] === 0x50, jpg = bytes[0] === 0xFF && bytes[1] === 0xD8;
  const img = { name: f.name, w: bmp.width, h: bmp.height, dpi: imageDpi(bytes), bytes: null, kind: null, blob: new Blob([bytes], { type: f.type || 'image/png' }) };
  if (png) { img.bytes = bytes; img.kind = 'png'; }
  else if (jpg && jpegOrientation(bytes) === 1) { img.bytes = bytes; img.kind = 'jpg'; }
  else { // other formats, or a rotated JPEG: re-encode upright as lossless PNG
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    img.bytes = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer()); img.kind = 'png';
    cv.width = cv.height = 1;
  }
  bmp.close && bmp.close();
  return img;
}
// The trim size of an image card: the CardXtra cut size in Morgana mode (the machine is fixed to it), else the fields.
// Orientation follows the image (or, once edited, the editor's orientation).
function imageTrim(im) {
  const v = id => parseFloat(byId(id).value);
  let W, H;
  if (state.mode === 'morgana') { const m = /^(\d+)x(\d+)$/.exec(byId('mSize').value) || [0, 90, 55]; W = +m[1]; H = +m[2]; }
  else { W = Math.max(10, v('icW') || 90); H = Math.max(10, v('icH') || 50); }
  const land = im.edit ? !im.edit.state.portrait : im.w >= im.h;
  return land === (W >= H) ? [W, H] : [H, W];
}
// One PDF page per image. Page = trim + the same bleed B on all sides (what the imposition expects), TrimBox set
// so the bleed is read back exactly. In 100% and fit mode the image keeps its size/proportions, centred on the
// trim; bleed it brings along is used per side (e.g. only top and bottom), and sides without bleed are either
// filled by repeating the edge pixels or left white.
export async function imagesToCardPdf(src) {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib, v = id => parseFloat(byId(id).value);
  const fit = byId('icFit').value, dpiSet = Math.min(2400, Math.max(30, v('icDpi') || 300));
  const extend = byId('icExtend').checked, setB = Math.max(0, v('cBleed') || 0), how = byId('icBleedHow').value;
  const r2 = x => num(Math.round(x * 100) / 100), TOL = 0.15;
  // placed image size (mm) per image
  const plan = src.imgs.map(orig => {
    const [W, H] = imageTrim(orig);
    if (orig.edit) { // finished in the editor: the page it made is the card plus its own bleed, used as it is
      const e = orig.edit, eb = e.bleed, im = { ...e.img, name: orig.name };
      return { im, W, H, iw: W + 2 * eb, ih: H + 2 * eb, dpi: null, bx: eb, by: eb, edited: true, stale: Math.abs(e.W - W) > 0.01 || Math.abs(e.H - H) > 0.01 };
    }
    const im = orig;
    let iw, ih, dpi = null;
    // the area the picture goes in: the cut, less the safe margin (the bleed and the margin are filled last)
    const S = Math.max(0, Math.min(v('icSafe') || 0, W / 2 - 1, H / 2 - 1)), cw = W - 2 * S, ch = H - 2 * S;
    if (fit === 'stretch') { iw = cw; ih = ch; }
    else if (fit === 'fill') { const k = Math.max(cw / im.w, ch / im.h); iw = im.w * k; ih = im.h * k; }
    else { dpi = im.dpi || dpiSet; iw = im.w / dpi * 25.4; ih = im.h / dpi * 25.4; }
    return { im, W, H, iw, ih, dpi, bx: (iw - W) / 2, by: (ih - H) / 2 };
  });
  // one bleed for every page (front and back must match): the most any image brings, at most 6 mm
  const B = fit === 'stretch' ? setB : Math.min(6, Math.max(0, ...plan.map(p => Math.max(p.bx, p.by))));
  // (stretch: the bleed comes from the Bleed setting and is filled around the stretched picture)
  const pdf = await PDFDocument.create(), notes = [];
  const [W0, H0] = [plan[0].W, plan[0].H];
  for (const p of plan) {
    const { im, W, H, iw, ih } = p, pw = W + 2 * B, ph = H + 2 * B;
    const page = pdf.addPage([pw * PT, ph * PT]);
    page.setTrimBox(B * PT, B * PT, W * PT, H * PT);
    const gapX = (pw - iw) / 2, gapY = (ph - ih) / 2; // > 0: the image doesn't reach the page edge there
    let emb, x = gapX, y = gapY, w = iw, h = ih;
    if (extend && (gapX > 0.01 || gapY > 0.01)) {
      // the picture at its placed size (stretched if need be), then the rest of the page filled around it: last
      const ppm = Math.max(im.w / iw, im.h / ih), sw = Math.max(1, Math.round(iw * ppm)), sh = Math.max(1, Math.round(ih * ppm));
      const cw = Math.max(1, Math.round(pw * ppm)), ch = Math.max(1, Math.round(ph * ppm)), ox = Math.round(gapX * ppm), oy = Math.round(gapY * ppm);
      const placed = async () => {
        const bmp = await createImageBitmap(im.blob), cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
        const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, sw, sh); bmp.close && bmp.close();
        return cv;
      };
      let bytes;
      if (how === 'ai') { // MI-GAN in the browser; cached per picture and placement
        // kept per picture (its bytes) and placement: another picture with the same name and size must not reuse it
        if (!aiBleedCache.has(im.bytes)) aiBleedCache.set(im.bytes, new Map());
        const filled = aiBleedCache.get(im.bytes), key = `${sw}x${sh}|${cw}x${ch}|${ox},${oy}`;
        if (!filled.has(key)) {
          const ai = await import('../../lib/ai.js');
          setMsg('AI is filling the missing bleed…');
          const out = ai.toCanvas(await ai.aiExtend(ai.fromCanvas(await placed()), cw, ch, ox, oy, text => setMsg(`Missing bleed: ${text}`)));
          filled.set(key, new Uint8Array(await (await new Promise(r => out.toBlob(r, 'image/png'))).arrayBuffer()));
          setMsg('');
        }
        bytes = filled.get(key);
      } else { // repeat the outermost pixels into the missing bleed
        const pic = await placed(), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        const ex = ox + sw, ey = oy + sh;
        g.drawImage(pic, ox, oy);
        if (ox > 0) { g.drawImage(pic, 0, 0, 1, sh, 0, oy, ox, sh); g.drawImage(pic, sw - 1, 0, 1, sh, ex, oy, cw - ex, sh); }
        if (oy > 0) { g.drawImage(pic, 0, 0, sw, 1, ox, 0, sw, oy); g.drawImage(pic, 0, sh - 1, sw, 1, ox, ey, sw, ch - ey); }
        if (ox > 0 && oy > 0) for (const [sx, sy, dx, dy, dw, dh] of [[0, 0, 0, 0, ox, oy], [sw - 1, 0, ex, 0, cw - ex, oy], [0, sh - 1, 0, ey, ox, ch - ey], [sw - 1, sh - 1, ex, ey, cw - ex, ch - ey]]) g.drawImage(pic, sx, sy, 1, 1, dx, dy, dw, dh);
        bytes = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer());
        cv.width = cv.height = 1;
      }
      emb = await pdf.embedPng(bytes); x = 0; y = 0; w = pw; h = ph; // the canvas is exactly the page
    } else emb = im.kind === 'png' ? await pdf.embedPng(im.bytes) : await pdf.embedJpg(im.bytes);
    const fillNote = !extend ? ' White around it.' : how === 'ai' ? ' Bleed filled by AI.' : ' Bleed filled by repeating the edge pixels.';
    // PDF y runs up: an image placed y mm from the top sits at ph - y - h from the bottom
    page.drawImage(emb, { x: x * PT, y: (ph - y - h) * PT, width: w * PT, height: h * PT });
    if (p.edited) {
      const eb = (iw - W) / 2;
      notes.push(`${im.name}: edited in the editor (${num(W)} × ${num(H)} mm + ${r2(eb)} mm bleed).${p.stale ? ' The card size changed since: edit it again.' : ''}${eb < B - 0.01 ? (extend ? ` The extra bleed is filled${how === 'ai' ? ' by AI' : ' by repeating the edge pixels'}.` : ' White in the extra bleed.') : ''}`);
      continue;
    }
    if (fit === 'stretch') {
      const ar = im.w / im.h, cr = iw / ih;
      notes.push(`${im.name}: stretched to ${mm1(iw)} × ${mm1(ih)} mm${iw < W - 0.01 ? ` (inside a ${r2((W - iw) / 2)} mm safe margin)` : ''}${Math.abs(ar / cr - 1) > 0.02 ? `, ${num(Math.round(Math.abs(ar / cr - 1) * 100))} % out of proportion` : ''}.${fillNote}`);
      continue;
    }
    const side = b => b < -TOL ? `short by ${r2(-b)} mm per side` : b <= TOL ? 'none' : `${r2(b)} mm`;
    let t = `${im.name}: ${mm1(iw)} × ${mm1(ih)} mm${p.dpi ? ` at ${num(Math.round(p.dpi))} dpi${im.dpi ? ' (from the file)' : ''}` : ''}, cut ${num(W)} × ${num(H)} mm. Bleed top and bottom: ${side(p.by)}, left and right: ${side(p.bx)}`;
    if (!(p.bx > TOL && p.by > TOL)) t += extend && B > TOL && p.bx >= -TOL && p.by >= -TOL ? (how === 'ai' ? ' (missing bleed filled by AI)' : ' (missing bleed filled by repeating the edge pixels)') : '';
    t += '.';
    if (p.bx < -TOL || p.by < -TOL) t += ' The image is smaller than the card: check the card size and the dpi, otherwise a white edge ends up inside the card.';
    if (p.dpi && (p.bx > 6 || p.by > 6)) t += ' Much bigger than the card: check the card size and the dpi.';
    notes.push(t);
    if (Math.abs(W - W0) > 0.01 || Math.abs(H - H0) > 0.01) notes.push('The images have different orientations; the back should match the front.');
  }
  byId('icInfo').textContent = (src.imgs.length > 1 ? `Front: ${src.imgs[0].name}, back: ${src.imgs[1].name}. ` : '') + notes.join(' ');
  return { bytes: await pdf.save(), bleed: B };
}
let icTimer = null;
const aiBleedCache = new WeakMap();
 // AI-filled card pages (PNG), by image and placement
export function rebuildCardImages() {
  clearTimeout(icTimer);
  icTimer = setTimeout(async () => {
    const src = state.job.imgSrc;
    if (!src) return;
    try { const r = await imagesToCardPdf(src); await loadCardPdf(r.bytes, src.name, r.bleed); }
    catch (e) { setMsg(`Couldn’t use the image: ${e.message || e}`, true); }
  }, 250);
}
export function syncImgRows() {
  const on = !!(isPrintMode() && state.mode !== 'winietka' && state.job.imgSrc);
  byId('imgCardRows').hidden = !on;
  const fit = byId('icFit').value;
  byId('rowIcDpi').hidden = fit !== 'actual';
  byId('rowIcExtend').hidden = false; // the bleed is filled last, also around a stretched picture
  byId('rowIcSafe').hidden = fit === 'actual';
  byId('rowIcSize').hidden = state.mode === 'morgana';
  byId('rowIcPreset').hidden = state.mode === 'morgana';
  byId('icSwap').hidden = !on || state.job.imgSrc.imgs.length !== 2;
  icList();
  syncBleedRow();
}
// the pictures of an image card job, each with the full editor (fit, rotate, stretch, AI fill and upscale)
function icList() {
  const ul = byId('icList'), src = state.job.imgSrc;
  ul.innerHTML = '';
  if (!src || state.mode === 'winietka') return;
  src.imgs.forEach((im, i) => {
    const li = document.createElement('li');
    li.className = 'icitem';
    li.innerHTML = '<span class="icname"></span><button type="button" class="link icedit">Edit picture (fit, rotate, AI)</button><button type="button" class="link icundo" hidden>Undo the edit</button>';
    const label = src.imgs.length === 2 ? (i ? 'Back: ' : 'Front: ') : src.imgs.length > 2 ? `${i + 1}. ` : '';
    li.querySelector('.icname').textContent = `${label}${im.name}${im.edit ? ' (edited)' : ''}`;
    li.querySelector('.icedit').addEventListener('click', () => icEdit(im).catch(e => setMsg(`Couldn’t open the editor: ${e.message || e}`, true)));
    const undo = li.querySelector('.icundo'); undo.hidden = !im.edit;
    undo.addEventListener('click', () => { im.edit = null; icList(); syncBleedRow(); rebuildCardImages(); });
    ul.appendChild(li);
  });
}
// the editor on the card format: the cut size, the bleed setting, the safe margin; the original is always kept
async function icEdit(im) {
  const v = id => parseFloat(byId(id).value), [W, H] = imageTrim(im), { openEditor } = await import('../../editor.js');
  const bleed = Math.max(0, v('cBleed') || 0) || 2;
  await openEditor({
    name: im.name, bytes: im.bytes, state: im.edit ? im.edit.state : null, format: { w: W, h: H, bleed },
    portrait: H > W, safe: Math.max(0, v('icSafe') || 0),
    onApply: r => {
      const [w, h] = r.state.portrait ? [Math.min(W, H), Math.max(W, H)] : [Math.max(W, H), Math.min(W, H)];
      im.edit = { state: r.state, bleed, W: w, H: h, img: { name: im.name, w: r.w, h: r.h, bytes: r.bytes, kind: 'png', blob: new Blob([r.bytes], { type: 'image/png' }) } };
      icList(); syncBleedRow(); rebuildCardImages();
    }
  });
}
for (const id of ['icW', 'icH', 'icDpi', 'icSafe']) byId(id).addEventListener('input', rebuildCardImages);
// a size preset fills in the card size (the image's orientation decides which way round); typing a size sets Custom
byId('icPreset').addEventListener('change', () => {
  const m = /^(\d+)x(\d+)$/.exec(byId('icPreset').value);
  if (!m) return;
  byId('icW').value = m[1]; byId('icH').value = m[2];
  saveOpts(); rebuildCardImages();
});
for (const id of ['icW', 'icH']) byId(id).addEventListener('input', () => {
  const v = `${byId('icW').value}x${byId('icH').value}`, sel = byId('icPreset');
  sel.value = [...sel.options].some(o => o.value === v) ? v : 'custom';
});
byId('icFit').addEventListener('change', () => { syncImgRows(); rebuildCardImages(); });
byId('icExtend').addEventListener('change', rebuildCardImages);
byId('icBleedHow').addEventListener('change', rebuildCardImages);
byId('icSwap').addEventListener('click', () => { const s = state.job.imgSrc; if (s && s.imgs.length > 1) { s.imgs.reverse(); rebuildCardImages(); } });
byId('mSize').addEventListener('change', () => { if (state.mode === 'morgana' && state.job.imgSrc) rebuildCardImages(); });
byId('cBleed').addEventListener('input', () => { if (state.job.imgSrc && byId('icFit').value === 'stretch') rebuildCardImages(); });
