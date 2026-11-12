// The AI, from the page's side: every job runs in a background thread (ai.worker.js), so the page never freezes.
// The pictures' pixels are handed over to the worker (not copied) and come back with the result.
//   aiFill / aiExtend: MI-GAN fills or extends a picture (bleed, wrong aspect ratio)
//   aiUpscale:         ESRGAN x2 / x4, made faithful with back-projection
import { image } from '../core/aiops.js';

let worker = null, nextId = 1;
const jobs = new Map();
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const j = jobs.get(data.id);
      if (!j) return;
      if (data.type === 'status') j.onStatus && j.onStatus(data.text);
      else if (data.type === 'done') { jobs.delete(data.id); j.resolve(data.result); }
      else if (data.type === 'error') { jobs.delete(data.id); j.reject(new Error(data.message)); }
    };
    // a crashed worker (e.g. out of memory) fails every waiting job instead of hanging the page
    worker.onerror = e => {
      for (const j of jobs.values()) j.reject(new Error(`The AI stopped: ${e.message || 'out of memory?'} Try a smaller picture or format.`));
      jobs.clear(); worker.terminate(); worker = null;
    };
  }
  return worker;
}
function run(op, args, transfer, onStatus) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    jobs.set(id, { resolve, reject, onStatus });
    getWorker().postMessage({ id, op, base: new URL('./', document.baseURI).href, args }, transfer);
  });
}
// fill the unknown pixels (known: Uint8Array, 1 = keep) of img; img and known are updated
export async function aiFill(img, known, onStatus) {
  const r = await run('fill', { img, known }, [img.rgb.buffer, known.buffer], onStatus);
  img.rgb = r.img.rgb;
  return img;
}
// src placed at (x0, y0) on a W x H page: everything around it filled
export async function aiExtend(src, W, H, x0, y0, onStatus) {
  return (await run('extend', { src, W, H, x0, y0 }, [src.rgb.buffer], onStatus)).img;
}
// img -> img upscaled by 2 or 4
export async function aiUpscale(img, scale, onStatus) {
  return (await run('upscale', { img, scale }, [img.rgb.buffer], onStatus)).img;
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
