// The AI, run in a background thread so the page never freezes. Messages:
//   in:  { id, op: 'fill' | 'extend' | 'upscale', base (app URL), args }
//   out: { id, type: 'status', text } | { id, type: 'progress', value } | { id, type: 'done', result } | { id, type: 'error', message }
// Models: MI-GAN (Picsart, MIT) for filling via onnxruntime-web; ESRGAN thick (UpscalerJS, MIT) via TensorFlow.js.
// WebGPU (the graphics card) when there is one, else the processor, on all cores when the page is cross-origin
// isolated (the server sends the headers for that).
import { image, fillTiles, extendGrow, backProject, mirrorPad } from '../core/aiops.js';

let job = 0; // the message id being worked on, for status messages
const say = text => self.postMessage({ id: job, type: 'status', text });
const MB = n => (n / 1048576).toFixed(1);

// download with progress (the model files are big; the browser caches them afterwards)
async function download(url, label) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Couldn’t download the ${label} (${r.status}).`);
  const total = +r.headers.get('content-length') || 0, reader = r.body.getReader(), parts = [];
  let got = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (Date.now() - last > 250) { last = Date.now(); say(`Downloading the ${label}: ${MB(got)}${total ? ` of ${MB(total)}` : ''} MB…`); }
  }
  const out = new Uint8Array(got);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ---------- MI-GAN ---------- */
let migan = null, fillBackend = '';
function loadMigan(base) {
  if (!migan) migan = (async () => {
    const ort = await import('onnxruntime-web/webgpu');
    // the WebGPU build runs on the 'asyncify' WebAssembly; point at both files (bundlers move the library)
    ort.env.wasm.wasmPaths = { mjs: base + 'ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: base + 'ort/ort-wasm-simd-threaded.asyncify.wasm' };
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1;
    const model = await download(base + 'models/migan.onnx', 'AI fill model');
    say('Starting the AI fill model…');
    let last;
    for (const ep of navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']) {
      try { const session = await ort.InferenceSession.create(model, { executionProviders: [ep] }); fillBackend = ep === 'webgpu' ? 'graphics card' : `processor, ${ort.env.wasm.numThreads} ${ort.env.wasm.numThreads === 1 ? 'thread' : 'threads'}${self.isSecureContext ? '' : '; open the https address for the graphics card and all cores'}`; return { ort, session }; }
      catch (e) { last = e; }
    }
    throw new Error(`Couldn’t start the fill model: ${last && last.message}`);
  })().catch(e => { migan = null; throw e; });
  return migan;
}
async function runMigan(rgb, mask, w, h) {
  const { ort, session } = await migan, n = w * h, chw = new Uint8Array(3 * n), m = new Uint8Array(n);
  for (let i = 0; i < n; i++) { chw[i] = rgb[i * 3]; chw[n + i] = rgb[i * 3 + 1]; chw[2 * n + i] = rgb[i * 3 + 2]; m[i] = mask[i] ? 255 : 0; }
  const res = await session.run({ image: new ort.Tensor('uint8', chw, [1, 3, h, w]), mask: new ort.Tensor('uint8', m, [1, 1, h, w]) });
  const r = res.result.data, out = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) { out[i * 3] = r[i]; out[i * 3 + 1] = r[n + i]; out[i * 3 + 2] = r[2 * n + i]; }
  return out;
}

/* ---------- ESRGAN ---------- */
let tfP = null, upscaleBackend = '';
function loadTf() {
  if (!tfP) tfP = (async () => {
    const tf = await import('@tensorflow/tfjs');
    try {
      if (navigator.gpu) { await import('@tensorflow/tfjs-backend-webgpu'); if (!(await tf.setBackend('webgpu'))) throw new Error('no webgpu'); }
      else if (!(await tf.setBackend('webgl'))) throw new Error('no webgl');
    } catch { if (!(await tf.setBackend('webgl').catch(() => false))) await tf.setBackend('cpu'); }
    await tf.ready();
    upscaleBackend = { webgpu: 'graphics card', webgl: 'graphics card (WebGL)', cpu: 'processor' }[tf.getBackend()] || tf.getBackend();
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
async function esrgan(base, scale) {
  const t = await loadTf();
  if (!t.models.has(scale)) {
    t.models.set(scale, t.tf.loadLayersModel(base + `models/esrgan-thick/x${scale}/model.json`, {
      onProgress: f => say(`Downloading the AI upscale model ×${scale}: ${Math.round(f * 100)} % of about 28 MB…`)
    }).catch(e => { t.models.delete(scale); throw e; }));
  }
  return { tf: t.tf, model: await t.models.get(scale) };
}
async function upscale(base, img, scale) {
  const { tf, model } = await esrgan(base, scale), T = 128, P = 12, { w, h } = img, W = w * scale, out = image(W, h * scale);
  const pad = mirrorPad(img, P), PW = pad.w, tiles = Math.ceil(w / T) * Math.ceil(h / T);
  let done = 0;
  for (let ty = 0; ty < h; ty += T) for (let tx = 0; tx < w; tx += T) {
    const x0 = tx - P, y0 = ty - P, x1 = Math.min(w, tx + T) + P, y1 = Math.min(h, ty + T) + P, pw = x1 - x0, ph = y1 - y0;
    const buf = new Float32Array(pw * ph * 3);
    for (let r = 0; r < ph; r++) for (let c = 0; c < pw * 3; c++) buf[r * pw * 3 + c] = pad.rgb[((y0 + P + r) * PW + x0 + P) * 3 + c] / 255;
    const y = tf.tidy(() => model.predict(tf.tensor4d(buf, [1, ph, pw, 3])));
    const d = await y.data(); y.dispose();
    const OW = pw * scale;
    for (let r = ty; r < Math.min(h, ty + T); r++) for (let sr = 0; sr < scale; sr++) {
      const oy = r * scale + sr, iy = (r - y0) * scale + sr;
      for (let c = tx; c < Math.min(w, tx + T); c++) for (let sc = 0; sc < scale; sc++) {
        const di = (iy * OW + (c - x0) * scale + sc) * 3, oi = (oy * W + c * scale + sc) * 3;
        for (let k = 0; k < 3; k++) { const v = d[di + k] * 255; out.rgb[oi + k] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
      }
    }
    done++;
    say(`AI upscale ×${scale}: ${Math.round(done / tiles * 100)} % (${upscaleBackend}).`);
  }
  say('Checking the upscale against the original…');
  return backProject(out, img, scale, 6);
}

self.onmessage = async ({ data }) => {
  const { id, op, base, args } = data;
  job = id;
  try {
    let result;
    if (op === 'fill' || op === 'extend') {
      await loadMigan(base);
      let tiles = 0;
      const onTile = () => say(`AI is filling: ${++tiles} ${tiles === 1 ? 'tile' : 'tiles'} done (${fillBackend}).`);
      if (op === 'fill') { await fillTiles(args.img, args.known, runMigan, { onTile }); result = { img: args.img, known: args.known }; }
      else result = { img: await extendGrow(args.src, args.W, args.H, args.x0, args.y0, runMigan, { onTile }) };
    } else if (op === 'upscale') result = { img: await upscale(base, args.img, args.scale) };
    else throw new Error(`Unknown job ${op}`);
    const buffers = [result.img.rgb.buffer, ...(result.known ? [result.known.buffer] : [])];
    self.postMessage({ id, type: 'done', result }, buffers);
  } catch (e) {
    self.postMessage({ id, type: 'error', message: (e && e.message) || String(e) });
  }
};
