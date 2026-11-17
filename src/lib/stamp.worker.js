// Builds stamps (core/stamp.js: polygon unions and offsets) in a background thread, so typing a stamp's text
// never freezes the page.  in: { id, art, W, H, opts }  out: { id, result } or { id, error }
import { buildStamp } from '../core/stamp.js';

self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, result: buildStamp(data.art, data.W, data.H, data.opts) }); }
  catch (e) { self.postMessage({ id: data.id, error: e.message || String(e) }); }
};
