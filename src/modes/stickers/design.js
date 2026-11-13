// A sticker design: reading the SVG (prepareDesign) and tracing its kiss-cut and die-cut outlines at the chosen
// size (processDesign).
import { CELL, edt, fillHolesBin, fillHolesField, joinNear, loopArea, makeMask, march, rotBits, simplifyLoop } from '../../core/geometry.js';
import { sanitize } from '../../core/sanitize.js';
import { MM_PER, SHAPES, XLINK, dataUri, esc, loadImg, num, parseLen, parseSvg, prefixDoc, readViewBox, ser, sizedSvg, splitRoot, windowSvg } from '../../core/svg.js';
import { tick } from '../../core/util.js';

// Vector shapes that look like cut lines: stroked, with no visible fill. Indices into the SHAPES list.
function detectCutShapes(doc) {
  const hasImage = !!doc.querySelector('image');
  let host = null;
  try {
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll('image').forEach(n => n.remove());
    host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden;pointer-events:none';
    const svg = document.importNode(clone, true);
    host.appendChild(svg); document.body.appendChild(host);
    const idx = [];
    Array.from(svg.querySelectorAll(SHAPES)).forEach((el, i) => {
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) return;
      const cs = getComputedStyle(el);
      const fillOn = cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0;
      const strokeOn = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeOpacity || '1') > 0;
      if (strokeOn && !fillOn) idx.push(i);
    });
    let box = null;
    try {
      const all = Array.from(svg.querySelectorAll(SHAPES)), inv = svg.getScreenCTM().inverse();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of idx) {
        const el = all[i], b = el.getBBox(), m = inv.multiply(el.getScreenCTM());
        for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
          const X = m.a * x + m.c * y + m.e, Y = m.b * x + m.d * y + m.f;
          x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
        }
      }
      if (isFinite(x0) && x1 > x0 && y1 > y0) box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } catch (e) { box = null; }
    return { idx, hasImage, box };
  } catch (e) {
    return { idx: [], hasImage };
  } finally {
    if (host) host.remove();
  }
}
let nextId = 1;
export function prepareDesign(text, name) {
  const doc = parseSvg(text);
  const linked = Array.from(doc.documentElement.querySelectorAll('image')).some(im => { const h = (im.getAttribute('href') || im.getAttributeNS(XLINK, 'href') || '').trim(); return h && !h.startsWith('data:'); });
  sanitize(doc);
  const root = doc.documentElement;
  const vb = readViewBox(root);
  if (!vb) throw new Error('No viewBox or size in this file. Re-export it with a viewBox.');
  const hl = parseLen(root.getAttribute('height'));
  let natH = (hl && MM_PER[hl.unit]) ? hl.n * MM_PER[hl.unit] : null;
  if (!natH || natH < 5 || natH > 400) natH = 50;
  const warns = [];
  if (linked) warns.push('Linked images in this file won’t show (for safety only embedded images are used). Embed them before exporting.');
  if (root.querySelector('text')) {
    warns.push('Contains live text: the outline is traced with the browser’s fonts, so if they differ from yours the cut lines end up shifted. Convert text to curves before exporting.');
  }
  const cut = detectCutShapes(doc);
  // normalised copy for drawing
  root.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  root.removeAttribute('width'); root.removeAttribute('height');
  root.setAttribute('preserveAspectRatio', 'none');
  const norm = ser.serializeToString(doc);
  const without = (dd, idx) => { const sh = Array.from(dd.documentElement.querySelectorAll(SHAPES)); idx.forEach(i => sh[i] && sh[i].remove()); return dd; };
  let normNoCut = norm, cutMask = null;
  if (cut.idx.length) {
    normNoCut = ser.serializeToString(without(doc.cloneNode(true), cut.idx));
    // mask: only the cut shapes, filled solid black
    const mdoc = doc.cloneNode(true), mroot = mdoc.documentElement;
    mroot.querySelectorAll('image').forEach(n => n.remove());
    const sh = Array.from(mroot.querySelectorAll(SHAPES));
    cut.idx.forEach(i => sh[i] && sh[i].setAttribute('style', 'visibility:visible;fill:#000;fill-opacity:1;fill-rule:nonzero;stroke:none;opacity:1'));
    const st = mdoc.createElementNS(mroot.namespaceURI, 'style');
    st.textContent = '*{visibility:hidden}';
    mroot.insertBefore(st, mroot.firstChild);
    cutMask = ser.serializeToString(mdoc);
  }
  // markup for export
  const id = nextId++;
  const odoc = doc.cloneNode(true), oroot = odoc.documentElement;
  prefixDoc(oroot, `s${id}-`);
  // Embedded bitmaps go into the file once per design (__D__ ids) instead of once per sticker.
  const shared = [], bases = [];
  let k = 0;
  for (const im of Array.from(oroot.querySelectorAll('image'))) {
    const href = im.getAttribute('href') || im.getAttributeNS(XLINK, 'href') || '';
    if (!href.startsWith('data:')) continue;
    const oldId = im.getAttribute('id'), base = oldId ? oldId.replace(/^__P__/, '') : `img${k++}`;
    const cl = im.cloneNode(true); cl.setAttribute('id', '__D__' + base);
    shared.push(ser.serializeToString(cl)); bases.push(base);
    if (im.closest('defs')) im.remove();
    else { const u = odoc.createElementNS(oroot.namespaceURI, 'use'); u.setAttributeNS(XLINK, 'xlink:href', '#__D__' + base); im.replaceWith(u); }
  }
  const fixRefs = m => bases.reduce((acc, b) => acc.split('#__P__' + b).join('#__D__' + b), m);
  const skip = new Set(['width', 'height', 'viewBox', 'x', 'y', 'version', 'baseProfile', 'preserveAspectRatio', 'id', 'enable-background', 'overflow']);
  let wrap = '';
  for (const a of Array.from(oroot.attributes)) {
    if (a.name.startsWith('xmlns') || a.name.includes(':') || skip.has(a.name)) continue;
    wrap += ` ${a.name}="${esc(a.value)}"`;
  }
  const parts = splitRoot(oroot);
  for (const m of parts.open.match(/\sxmlns:[\w.-]+="[^"]*"/g) || []) wrap += m;
  const markup = fixRefs(parts.inner);
  const markupNoCut = cut.idx.length ? fixRefs(splitRoot(without(odoc, cut.idx).documentElement).inner) : markup;
  return {
    id, name, vb, norm, markup, markupNoCut, cutMask, wrap, warns, heightMm: natH, qty: null,
    sharedDefs: shared.join(''), canCut: cut.idx.length > 0, cutBox: cut.box,
    mode: cut.idx.length && cut.hasImage ? 'cut' : 'trace',
    url: dataUri(norm), urlNoCut: cut.idx.length ? dataUri(normNoCut) : dataUri(norm),
    key: null, res: null, error: null, busy: false, ui: null
  };
}
export async function processDesign(d, o) {
  const k = o.kiss, dd = o.die, gap = o.gap;
  const cutMode = d.mode === 'cut';
  const fr = (cutMode && d.cutBox) || d.vb; // what the height applies to: the cut line in cut mode, else the artwork
  const s = d.heightMm / fr.h, artW = d.vb.w * s, artH = d.vb.h * s, frW = fr.w * s, frH = d.heightMm;
  const pad = k + dd + Math.max(gap / 2, o.joinGap / 2) + 1.5;
  const Wc = Math.ceil((frW + 2 * pad) / CELL), Hc = Math.ceil((frH + 2 * pad) / CELL);
  let ppm = 2;
  for (const p of [20, 10, 6, 4, 2]) {
    if (o.quality !== 'fine' && p > 10) continue;
    if (Wc * Hc * (p * CELL) ** 2 <= 9e6) { ppm = p; break; }
  }
  const f = Math.round(ppm * CELL), w = Wc * f, h = Hc * f, N = w * h;
  const boxW = Wc * CELL, boxH = Hc * CELL, fx = (boxW - frW) / 2, fy = (boxH - frH) / 2;
  const offX = fx - (fr.x - d.vb.x) * s, offY = fy - (fr.y - d.vb.y) * s; // where the artwork's viewBox origin lands

  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  if (cutMode) {
    // render only the window around the cut line, however big the image is
    const img = await loadImg(windowSvg(d.cutMask, fr.x - fx / s, fr.y - fy / s, boxW / s, boxH / s, w, h));
    cx.drawImage(img, 0, 0, w, h);
  } else {
    const img = await loadImg(sizedSvg(d.norm, Math.round(artW * ppm), Math.round(artH * ppm)));
    cx.drawImage(img, offX * ppm, offY * ppm, artW * ppm, artH * ppm);
  }
  const px = cx.getImageData(0, 0, w, h).data;
  const lvl = mm => mm * ppm + 0.5;
  // Morphological closing of a mask by r mm (grow, then shrink back), returned as a smooth field.
  // Fills gaps and notches narrower than 2r and rounds concave corners; never removes anything.
  const closeField = (bin, r) => {
    const Lc = r * ppm + 0.5, E1 = edt(bin, w, h), outside = new Uint8Array(N);
    for (let i = 0; i < N; i++) outside[i] = E1[i] <= Lc ? 0 : 1;
    const E2 = edt(outside, w, h), F = new Float32Array(N);
    for (let i = 0; i < N; i++) F[i] = -E2[i];
    return { F, L: -Lc };
  };
  const smooth = o.joinGap / 2;
  let kField, kLevel, joined = false;
  if (cutMode) {
    // Kiss cut = the file's own cut line, read straight from its filled shape (anti-aliased edge, sub-pixel).
    kField = new Float32Array(N); kLevel = 127.5;
    let cnt = 0;
    for (let i = 0; i < N; i++) { const a = px[i * 4 + 3]; kField[i] = 255 - a; if (a >= 128) cnt++; }
    if (!cnt) throw new Error('No cut line found in this file.');
  } else {
    const M = new Uint8Array(N);
    let cnt = 0;
    for (let i = 0; i < N; i++) {
      const a = px[i * 4 + 3];
      if (a > 64) {
        if (o.ignoreWhite && a > 200 && px[i * 4] > 245 && px[i * 4 + 1] > 245 && px[i * 4 + 2] > 245) continue;
        M[i] = 1; cnt++;
      }
    }
    if (!cnt) throw new Error('Nothing visible in this file.');
    await tick();
    const D = edt(M, w, h);
    kField = D; kLevel = lvl(k);
    if (smooth > 0) {
      const K0 = new Uint8Array(N);
      for (let i = 0; i < N; i++) K0[i] = D[i] <= kLevel ? 1 : 0;
      fillHolesBin(K0, w, h);
      const jr = joinNear(K0, w, h, o.joinGap * ppm + 1);
      joined = jr.joined;
      await tick();
      const cf = closeField(jr.bin, smooth);
      kField = cf.F; kLevel = cf.L;
    }
  }
  const K = fillHolesField(kField, kLevel, w, h);
  const borderOut = (F, L) => { for (let x = 0; x < w; x++) { F[x] = L + 1; F[(h - 1) * w + x] = L + 1; } for (let y = 0; y < h; y++) { F[y * w] = L + 1; F[y * w + w - 1] = L + 1; } };
  borderOut(kField, kLevel);
  await tick();

  // Die cut = kiss outline grown by dd, smoothed the same way so its notches don't come back sharp.
  const DK = edt(K, w, h);
  let dField, dLevel;
  if (smooth > 0) {
    const db = new Uint8Array(N);
    for (let i = 0; i < N; i++) db[i] = DK[i] <= lvl(dd) ? 1 : 0;
    fillHolesBin(db, w, h);
    const cf = closeField(db, smooth);
    dField = cf.F; dLevel = cf.L;
  } else { dField = Float32Array.from(DK); dLevel = lvl(dd); }
  const dieBin = fillHolesField(dField, dLevel, w, h);
  borderOut(dField, dLevel);
  await tick();
  const DD = edt(dieBin, w, h), nLevel = lvl(gap / 2), nest = new Uint8Array(N);
  for (let i = 0; i < N; i++) nest[i] = DD[i] <= nLevel ? 1 : 0;
  fillHolesBin(nest, w, h);
  let clipField = null, clipLevel = 0;
  if (cutMode) {
    clipField = Float32Array.from(DD); clipLevel = lvl(Math.min(gap / 2, 1));
    fillHolesField(clipField, clipLevel, w, h);
    borderOut(clipField, clipLevel);
  }

  // Drop zero-length and near-duplicate segments: some cutter software divides by segment length.
  const clean = l => {
    const o2 = [];
    for (const p of l) { const q = o2[o2.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01) o2.push(p); }
    while (o2.length > 2 && Math.hypot(o2[0][0] - o2[o2.length - 1][0], o2[0][1] - o2[o2.length - 1][1]) <= 0.01) o2.pop();
    return o2;
  };
  const toMm = loops => loops
    .map(l => clean(simplifyLoop(l.map(p => [p[0] / ppm, p[1] / ppm]), 0.05)))
    .filter(l => l.length >= 3 && Math.abs(loopArea(l)) > 0.3);
  const kissLoops = toMm(march(kField, kLevel, w, h));
  const dieLoops = toMm(march(dField, dLevel, w, h));
  const clipLoops = cutMode ? toMm(march(clipField, clipLevel, w, h)) : [];

  const cb = new Uint8Array(Wc * Hc);
  for (let y = 0; y < h; y++) {
    const row = ((y / f) | 0) * Wc;
    for (let x = 0; x < w; x++) if (nest[y * w + x]) cb[row + ((x / f) | 0)] = 1;
  }
  const masks = {};
  for (const r of [0, 90, 180, 270]) { const rb = rotBits(cb, Wc, Hc, r); masks[r] = makeMask(rb.bits, rb.w, rb.h); }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const l of dieLoops) for (const p of l) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); }
  const pathD = loops => loops.map(l => 'M' + l.map(p => num(p[0]) + ' ' + num(p[1])).join('L') + 'Z').join('');
  return {
    s, artW, artH, frW, frH, boxW, boxH, offX, offY, joined, ppm, parts: kissLoops.length,
    kissLoops, dieLoops, clipLoops, kissD: pathD(kissLoops), dieD: pathD(dieLoops), clipD: pathD(clipLoops), cutMode, masks,
    cutW: bx1 - bx0, cutH: by1 - by0,
    bleedShort: cutMode && (bx0 < offX - 0.05 || by0 < offY - 0.05 || bx1 > offX + artW + 0.05 || by1 > offY + artH + 0.05)
  };
}
