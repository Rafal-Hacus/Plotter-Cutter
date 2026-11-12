// In-browser AI, using the computer's graphics card (WebGPU) when there is one, else the processor.
// Models are served by this app (see vite.config.js), downloaded once and then cached by the browser.
//   aiFill / aiExtend: MI-GAN (Picsart, MIT) fills or extends a picture (bleed, wrong aspect ratio)
//   aiUpscale:         ESRGAN "thick" x2 / x4 (UpscalerJS, MIT), made faithful with back-projection
import { image, fillTiles, extendGrow, backProject, mirrorPad } from '../core/aiops.js';

const here = () => new URL('./', document.baseURI).href;

/* ---------- MI-GAN fill ---------- */
let miganP = null;
export let fillBackend = '';
function migan() {
  if (!miganP) miganP = (async () => {
    const ort = await import('onnxruntime-web/webgpu');
    // the WebGPU build runs on the 'asyncify' WebAssembly; point at both files explicitly (bundlers move the library)
    ort.env.wasm.wasmPaths = { mjs: here() + 'ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: here() + 'ort/ort-wasm-simd-threaded.asyncify.wasm' };
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
    const url = here() + 'models/migan.onnx';
    let last;
    for (const ep of navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']) {
      try { const session = await ort.InferenceSession.create(url, { executionProviders: [ep] }); fillBackend = ep; return { ort, session }; }
      catch (e) { last = e; console.warn(`MI-GAN on ${ep}:`, e && e.message); }
    }
    throw new Error(`Couldn’t start the fill model: ${last && last.message}`, { cause: last });
  })().catch(e => { miganP = null; throw e; });
  return miganP;
}
// one tile: rgb (interleaved), mask 1 = known -> rgb with the unknown pixels filled
async function runMigan(rgb, mask, w, h) {
  const { ort, session } = await migan(), n = w * h, chw = new Uint8Array(3 * n), m = new Uint8Array(n);
  for (let i = 0; i < n; i++) { chw[i] = rgb[i * 3]; chw[n + i] = rgb[i * 3 + 1]; chw[2 * n + i] = rgb[i * 3 + 2]; m[i] = mask[i] ? 255 : 0; }
  const res = await session.run({ image: new ort.Tensor('uint8', chw, [1, 3, h, w]), mask: new ort.Tensor('uint8', m, [1, 1, h, w]) });
  const r = res.result.data, out = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) { out[i * 3] = r[i]; out[i * 3 + 1] = r[n + i]; out[i * 3 + 2] = r[2 * n + i]; }
  return out;
}
export const loadFill = () => migan();
// fill the unknown pixels (known: Uint8Array, 1 = keep) of img in place
export const aiFill = (img, known, onTile) => fillTiles(img, known, runMigan, { onTile });
// src placed at (x0, y0) on a W x H page: everything around it filled
export const aiExtend = (src, W, H, x0, y0, onTile) => extendGrow(src, W, H, x0, y0, runMigan, { onTile });

/* ---------- ESRGAN upscale ---------- */
let tfP = null;
export let upscaleBackend = '';
function tfjs() {
  if (!tfP) tfP = (async () => {
    const tf = await import('@tensorflow/tfjs');
    try {
      if (navigator.gpu) { await import('@tensorflow/tfjs-backend-webgpu'); await tf.setBackend('webgpu'); }
      else await tf.setBackend('webgl');
    } catch { if (!(await tf.setBackend('webgl').catch(() => false))) await tf.setBackend('cpu'); }
    await tf.ready();
    upscaleBackend = tf.getBackend();
    // the two custom layers of the ESRGAN models
    class MultiplyBeta extends tf.layers.Layer {
      static className = 'MultiplyBeta';
      constructor(config) { super(config || {}); this.beta = 0.2; }
      call(inputs) { return tf.mul(Array.isArray(inputs) ? inputs[0] : inputs, this.beta); }
    }
    tf.serialization.registerClass(MultiplyBeta);
    for (const s of [2, 4]) {
      tf.serialization.registerClass(class extends tf.layers.Layer {
        static className = `PixelShuffle${s}x`;
        constructor(config) { super(config || {}); }
        computeOutputShape(shape) { return [shape[0], shape[1] == null ? null : shape[1] * s, shape[2] == null ? null : shape[2] * s, 3]; }
        call(inputs) { return tf.depthToSpace(Array.isArray(inputs) ? inputs[0] : inputs, s, 'NHWC'); }
      });
    }
    return { tf, models: new Map() };
  })().catch(e => { tfP = null; throw e; });
  return tfP;
}
async function esrgan(scale) {
  const t = await tfjs();
  if (!t.models.has(scale)) t.models.set(scale, t.tf.loadLayersModel(here() + `models/esrgan-thick/x${scale}/model.json`));
  return { tf: t.tf, model: await t.models.get(scale) };
}
export const loadUpscale = scale => esrgan(scale);
// img -> img upscaled by 2 or 4. Tiles of 128 px, each with 12 px of context around it (mirrored past the picture's
// edges, so the model never sees a hard border); then back-projection so that the result,
// scaled back down, is the original: the AI can only add sharpness, not change what is in the picture.
export async function aiUpscale(img, scale, onProgress) {
  const { tf, model } = await esrgan(scale), T = 128, P = 12, { w, h } = img, W = w * scale, out = image(W, h * scale);
  const pad = mirrorPad(img, P), PW = pad.w; // picture pixel (x, y) is pad pixel (x + P, y + P)
  const tiles = Math.ceil(w / T) * Math.ceil(h / T);
  let done = 0;
  for (let ty = 0; ty < h; ty += T) for (let tx = 0; tx < w; tx += T) {
    // in picture coordinates, the context may run P px past the picture (into the mirrored pad)
    const x0 = tx - P, y0 = ty - P, x1 = Math.min(w, tx + T) + P, y1 = Math.min(h, ty + T) + P, pw = x1 - x0, ph = y1 - y0;
    const buf = new Float32Array(pw * ph * 3);
    for (let r = 0; r < ph; r++) for (let c = 0; c < pw * 3; c++) buf[r * pw * 3 + c] = pad.rgb[((y0 + P + r) * PW + x0 + P) * 3 + c] / 255;
    const y = tf.tidy(() => model.predict(tf.tensor4d(buf, [1, ph, pw, 3])));
    const d = await y.data(); y.dispose();
    const OW = pw * scale;
    for (let r = ty; r < Math.min(h, ty + T); r++) for (let sr = 0; sr < scale; sr++) {
      const oy = r * scale + sr, iy = (r - y0) * scale + sr;
      for (let c = tx; c < Math.min(w, tx + T); c++) for (let sc = 0; sc < scale; sc++) {
        const ox = c * scale + sc, ix = (c - x0) * scale + sc, di = (iy * OW + ix) * 3, oi = (oy * W + ox) * 3;
        for (let k = 0; k < 3; k++) { const v = d[di + k] * 255; out.rgb[oi + k] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
      }
    }
    if (onProgress) onProgress(++done / tiles);
    await new Promise(r => setTimeout(r, 0));
  }
  return backProject(out, img, scale, 6);
}

/* ---------- canvas <-> image ---------- */
export function fromCanvas(cv, x = 0, y = 0, w = cv.width, h = cv.height) {
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data, im = image(w, h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) { im.rgb[i * 3] = d[j]; im.rgb[i * 3 + 1] = d[j + 1]; im.rgb[i * 3 + 2] = d[j + 2]; }
  return im;
}
export function toCanvas(im) {
  const cv = document.createElement('canvas'); cv.width = im.w; cv.height = im.h;
  const g = cv.getContext('2d'), id = g.createImageData(im.w, im.h);
  for (let i = 0, j = 0; i < im.w * im.h; i++, j += 4) { id.data[j] = im.rgb[i * 3]; id.data[j + 1] = im.rgb[i * 3 + 1]; id.data[j + 2] = im.rgb[i * 3 + 2]; id.data[j + 3] = 255; }
  g.putImageData(id, 0, 0);
  return cv;
}
