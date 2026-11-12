// Image editor: fit a picture to a print format (trim + bleed) by rotating, scaling, stretching and moving it,
// fill the rest of the page with AI (or white), upscale with AI, and hand back the finished page image. Used from
// Print sheets, so the edited picture goes straight onto the sheet with its crop marks (no export / re-upload).
//
// Geometry, all in mm on the page (origin: top-left corner of the bleed box, y down):
//   page = format + bleed on every side; the picture's centre (cx, cy), its rotation (quarter turns + a small
//   straightening angle) and its scale ax, ay (mm per source pixel along the picture's own axes; equal unless
//   stretched).
import { aiExtend, aiFill, aiUpscale, fromCanvas, toCanvas, fillBackend, upscaleBackend } from './lib/ai.js';

const DPI = 300;
const $ = id => document.getElementById(id);

// the source picture as a canvas (so it can be read back for the AI)
async function decode(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]));
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  return cv;
}

// opts: { name, bytes (the original picture), state (from an earlier edit, or null), format: { w, h, bleed } (mm),
//         onApply({ bytes (PNG), w, h, preview (data URL), state }) }
export async function openEditor(opts) {
  const dlg = $('imgEditor'), cv = $('edCanvas'), g = cv.getContext('2d');
  let src = await decode(opts.bytes);
  const st = opts.state ? { ...opts.state } : null;
  const S = st || { portrait: opts.format.h >= opts.format.w, quarter: 0, angle: 0, ax: 0, ay: 0, cx: 0, cy: 0, empty: 'ai', upscaled: 1 };
  // how much the source has been AI-upscaled in this session; ax / ay are always mm per ORIGINAL pixel
  let upscaled = 1;
  let result = null; // the finished page, waiting for "Use it"
  const page = () => {
    const f = opts.format, long = Math.max(f.w, f.h), short = Math.min(f.w, f.h), [w, h] = S.portrait ? [short, long] : [long, short];
    return { w, h, b: f.bleed, W: w + 2 * f.bleed, H: h + 2 * f.bleed };
  };
  const ow = () => src.width / upscaled, oh = () => src.height / upscaled; // the original picture's pixels
  const rotated = () => (S.quarter % 2 ? [oh(), ow()] : [ow(), oh()]);
  const fitScale = mode => {
    const p = page(), [rw, rh] = rotated();
    return mode === 'fill' ? Math.max(p.W / rw, p.H / rh) : Math.min(p.w / rw, p.h / rh);
  };
  function layout(mode) {
    const p = page();
    S.cx = p.W / 2; S.cy = p.H / 2; S.angle = mode === 'keep' ? S.angle : 0;
    if (mode === 'stretch') { // cover the page exactly, proportions not kept
      const [W, H] = S.quarter % 2 ? [p.H, p.W] : [p.W, p.H];
      S.ax = W / ow(); S.ay = H / oh();
    } else { const k = fitScale(mode); S.ax = S.ay = k; }
    S.mode = mode;
  }
  if (!st) layout('fit');

  // page mm -> canvas px for the preview
  let view = { k: 1, ox: 0, oy: 0 };
  function sizeCanvas() {
    const box = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, p = page();
    const k = Math.min((box.width - 24) / p.W, (box.height - 24) / p.H);
    cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr);
    cv.style.width = box.width + 'px'; cv.style.height = box.height + 'px';
    view = { k: k * dpr, ox: (box.width * dpr - p.W * k * dpr) / 2, oy: (box.height * dpr - p.H * k * dpr) / 2, dpr };
  }
  // the picture's transform in page mm, then in pixels of a target (scale px per mm, offset)
  function place(ctx, pxPerMm, ox = 0, oy = 0) {
    ctx.setTransform(pxPerMm, 0, 0, pxPerMm, ox, oy);
    ctx.translate(S.cx, S.cy);
    ctx.rotate((S.quarter * 90 + S.angle) * Math.PI / 180);
    ctx.scale(S.ax / upscaled, S.ay / upscaled);
    ctx.translate(-src.width / 2, -src.height / 2);
  }
  function draw() {
    const p = page(), { k, ox, oy } = view;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#fff'; g.fillRect(ox, oy, p.W * k, p.H * k);
    if (result) { g.drawImage(result, ox, oy, p.W * k, p.H * k); }
    else {
      g.save(); g.beginPath(); g.rect(ox, oy, p.W * k, p.H * k); g.clip();
      g.imageSmoothingQuality = 'high'; place(g, k, ox, oy); g.drawImage(src, 0, 0); g.restore();
      // empty parts of the page to be filled
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    // bleed shading, the cut line, the page edge
    g.fillStyle = 'rgba(20,40,32,.18)';
    const b = p.b * k;
    g.fillRect(ox, oy, p.W * k, b); g.fillRect(ox, oy + p.H * k - b, p.W * k, b); g.fillRect(ox, oy + b, b, p.H * k - 2 * b); g.fillRect(ox + p.W * k - b, oy + b, b, p.H * k - 2 * b);
    g.strokeStyle = '#E0262B'; g.lineWidth = 1.5 * view.dpr; g.strokeRect(ox + b, oy + b, p.w * k, p.h * k);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1 * view.dpr; g.strokeRect(ox, oy, p.W * k, p.H * k);
    info();
  }
  function info() {
    const p = page(), d = Math.round(25.4 * upscaled / Math.max(S.ax, S.ay));
    $('edInfo').textContent = `${opts.name} · ${p.w} × ${p.h} mm + ${p.b} mm bleed`;
    $('edDpi').textContent = `Print resolution: ${d} dpi${d < 200 ? ' (low: AI upscale recommended)' : d < 300 ? ' (fine; 300 is ideal)' : ' (good)'}${upscaled > 1 ? `, after AI upscale ×${upscaled}` : ''}.`;
    $('edUpscale').disabled = d >= 300 || !!result;
    $('edUpscale').textContent = d < 150 ? 'AI upscale ×4' : 'AI upscale ×2';
    $('edZoom').value = String(Math.round(Math.max(S.ax, S.ay) / fitScale('fit') * 100));
    $('edZoomV').textContent = $('edZoom').value + ' %';
    $('edAngle').value = String(S.angle); $('edAngleV').textContent = `${S.angle.toFixed(1)}°`;
    $('edStretchH').value = String(Math.round(S.ay / S.ax * 100));
    $('edEmpty').value = S.empty;
    $('edOrient').value = S.portrait ? 'portrait' : 'landscape';
    $('edUse').hidden = !result; $('edBack').hidden = !result; $('edApply').hidden = !!result;
    for (const id of ['edRotL', 'edRotR', 'edFit', 'edFill', 'edStretch', 'edZoom', 'edAngle', 'edStretchH', 'edEmpty', 'edOrient']) $(id).disabled = !!result;
  }
  const status = t => { $('edStatus').textContent = t; };

  // the finished page at 300 dpi: the picture, then the empty parts filled
  async function bake() {
    const p = page(), W = Math.round(p.W / 25.4 * DPI), H = Math.round(p.H / 25.4 * DPI), k = W / p.W;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const o = out.getContext('2d', { willReadFrequently: true });
    o.imageSmoothingQuality = 'high'; place(o, k); o.drawImage(src, 0, 0); o.setTransform(1, 0, 0, 1, 0, 0);
    // where is the picture? (fully opaque pixels)
    const a = o.getImageData(0, 0, W, H).data, known = new Uint8Array(W * H);
    let holes = 0;
    for (let i = 0; i < W * H; i++) { known[i] = a[i * 4 + 3] === 255 ? 1 : 0; if (!known[i]) holes++; }
    if (!holes) return out;
    if (S.empty === 'white') { o.globalCompositeOperation = 'destination-over'; o.fillStyle = '#fff'; o.fillRect(0, 0, W, H); return out; }
    let tiles = 0;
    const tick = () => status(`AI is filling the empty parts… ${++tiles} ${tiles === 1 ? 'tile' : 'tiles'} done (${fillBackend === 'webgpu' ? 'graphics card' : 'processor'}).`);
    status('Loading the AI fill model…');
    if (Math.abs(S.angle) < 1e-9) {
      // an upright rectangle: grow it outwards (best quality)
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (known[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) throw new Error('The picture is outside the page.');
      // one pixel in from the antialiased edge
      if (x0 > 0) x0++; if (y0 > 0) y0++; if (x1 < W - 1) x1--; if (y1 < H - 1) y1--;
      const filled = await aiExtend(fromCanvas(out, x0, y0, x1 - x0 + 1, y1 - y0 + 1), W, H, x0, y0, tick);
      return toCanvas(filled);
    }
    const img = fromCanvas(out);
    await aiFill(img, known, tick);
    return toCanvas(img);
  }

  // ---- wiring (fresh listeners each time the editor opens) ----
  const ac = new AbortController(), on = (id, ev, fn) => $(id).addEventListener(ev, fn, { signal: ac.signal });
  const redraw = () => { result = null; draw(); };
  on('edRotL', 'click', () => { S.quarter = (S.quarter + 3) % 4; layout(S.mode === 'stretch' ? 'stretch' : S.mode === 'fill' ? 'fill' : 'fit'); redraw(); });
  on('edRotR', 'click', () => { S.quarter = (S.quarter + 1) % 4; layout(S.mode === 'stretch' ? 'stretch' : S.mode === 'fill' ? 'fill' : 'fit'); redraw(); });
  on('edFit', 'click', () => { layout('fit'); redraw(); });
  on('edFill', 'click', () => { layout('fill'); redraw(); });
  on('edStretch', 'click', () => { layout('stretch'); redraw(); });
  on('edOrient', 'change', () => { S.portrait = $('edOrient').value === 'portrait'; sizeCanvas(); layout(S.mode || 'fit'); redraw(); });
  on('edAngle', 'input', () => { S.angle = parseFloat($('edAngle').value) || 0; S.mode = 'custom'; redraw(); });
  on('edZoom', 'input', () => { const z = (parseFloat($('edZoom').value) || 100) / 100, r = S.ay / S.ax, f = fitScale('fit'); S.ax = f * z; S.ay = f * z * r; S.mode = 'custom'; redraw(); });
  on('edStretchH', 'input', () => { const r = (parseFloat($('edStretchH').value) || 100) / 100; S.ay = S.ax * r; S.mode = 'custom'; redraw(); });
  on('edEmpty', 'change', () => { S.empty = $('edEmpty').value; redraw(); });
  let drag = null;
  on('edCanvas', 'pointerdown', e => { if (result) return; drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy }; cv.setPointerCapture(e.pointerId); });
  on('edCanvas', 'pointermove', e => { if (!drag) return; const k = view.k / view.dpr; S.cx = drag.cx + (e.clientX - drag.x) / k; S.cy = drag.cy + (e.clientY - drag.y) / k; S.mode = 'custom'; redraw(); });
  on('edCanvas', 'pointerup', () => { drag = null; });
  on('edCanvas', 'wheel', e => { if (result) return; e.preventDefault(); const f = Math.exp(-e.deltaY * 0.0015); S.ax *= f; S.ay *= f; S.mode = 'custom'; redraw(); }, { passive: false });
  on('edUpscale', 'click', async () => {
    const btn = $('edUpscale'); btn.disabled = true;
    try {
      const d = Math.round(25.4 * upscaled / Math.max(S.ax, S.ay)), s = d < 150 ? 4 : 2;
      if (src.width * src.height * s * s > 64e6) throw new Error('The picture is too large to upscale further.');
      status('Loading the AI upscale model…');
      const up = await aiUpscale(fromCanvas(src), s, f => status(`AI upscale ×${s}: ${Math.round(f * 100)} % (${upscaleBackend === 'webgpu' ? 'graphics card' : upscaleBackend}).`));
      src = toCanvas(up); upscaled *= s; S.upscaled = upscaled;
      status(`Upscaled ×${s} with AI. Scaled back down it matches the original exactly, so nothing in the picture was changed.`);
      draw();
    } catch (e) { status(e.message || String(e)); }
    finally { info(); }
  });
  on('edApply', 'click', async () => {
    $('edApply').disabled = true;
    try { result = await bake(); status('Check the result, then “Use it”, or go back and change something.'); draw(); }
    catch (e) { status(`Couldn’t finish the page: ${e.message || e}`); }
    finally { $('edApply').disabled = false; }
  });
  on('edBack', 'click', () => { result = null; status(''); draw(); });
  on('edUse', 'click', async () => {
    const r = result, prev = document.createElement('canvas'), k = 600 / Math.max(r.width, r.height);
    prev.width = Math.round(r.width * k); prev.height = Math.round(r.height * k);
    prev.getContext('2d').drawImage(r, 0, 0, prev.width, prev.height);
    const bytes = new Uint8Array(await (await new Promise(res => r.toBlob(res, 'image/png'))).arrayBuffer());
    // the state is kept in original-picture pixels, so a later edit starts from the original
    const state = { ...S, ax: S.ax / upscaled, ay: S.ay / upscaled, upscaled: 1 };
    opts.onApply({ bytes, w: r.width, h: r.height, preview: prev.toDataURL('image/jpeg', 0.85), state });
    dlg.close();
  });
  on('imgEditor', 'close', () => ac.abort());
  on('edCancel', 'click', () => dlg.close());
  window.addEventListener('resize', () => { sizeCanvas(); draw(); }, { signal: ac.signal });

  status('');
  dlg.showModal();
  sizeCanvas(); draw();
}
