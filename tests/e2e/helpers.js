import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

// Open the app and fail the test on any page error, console error or request to another host.
export async function openApp(page) {
  const problems = [];
  page.on('pageerror', e => problems.push(`page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('request', r => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !/^(data|blob):/.test(u.protocol)) problems.push(`external request: ${r.url()}`); });
  await page.goto('/');
  return problems;
}
export const noProblems = problems => expect(problems, problems.join('\n')).toEqual([]);

// Set a field the way a user would (fires input/change).
export const setField = (page, id, value) => page.evaluate(([id, v]) => {
  const e = document.getElementById(id);
  if (e.type === 'checkbox') e.checked = v; else e.value = v;
  e.dispatchEvent(new Event(e.type === 'checkbox' || e.tagName === 'SELECT' ? 'change' : 'input'));
}, [id, value]);
export const mode = (page, m) => page.click(`.modes button[data-mode="${m}"]`);
export const enabled = (page, id, timeout = 60_000) => page.waitForFunction(id => !document.getElementById(id).disabled, id, { timeout });

// Click an export button (also inside a closed panel) and return the downloaded bytes.
export async function download(page, id) {
  await enabled(page, id);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(id => document.getElementById(id).click(), id)]);
  return readFileSync(await dl.path());
}

// Read the files of a stored zip (what the app writes).
export function unzip(buf) {
  const out = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), xl = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nl).toString(), start = p + 30 + nl + xl;
    out[name] = buf.subarray(start, start + size);
    p = start + size;
  }
  return out;
}

// Cut layers of an exported cut SVG: { layerId: [[ [x,y], ... ], ...] } in sheet mm.
export function cutLayers(svg) {
  const layers = {};
  for (const [, id, body] of svg.matchAll(/<g id="([^"]+)">([\s\S]*?)<\/g>/g)) {
    layers[id] = [...body.matchAll(/ d="([^"]+)"/g)].map(m => [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(q => [+q[1], +q[2]]));
  }
  return layers;
}
// Pen strokes of a PLT in plotter units.
export function pltStrokes(text) {
  const strokes = [];
  for (const t of text.split(/\s+/)) {
    const m = /^([UD])(-?\d+),(-?\d+)$/.exec(t);
    if (!m) continue;
    if (m[1] === 'U') strokes.push([[+m[2], +m[3]]]); else strokes[strokes.length - 1].push([+m[2], +m[3]]);
  }
  return strokes.filter(s => s.length > 1);
}
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
// Distance from a point to the nearest edge of any of the closed loops.
export function distToLoops(p, loops) {
  let best = Infinity;
  for (const l of loops) for (let i = 0; i < l.length; i++) best = Math.min(best, segDist(p, l[i], l[(i + 1) % l.length]));
  return best;
}
export const bbox = l => l.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
export const inside = (a, b, tol = 0.01) => a[0] >= b[0] - tol && a[1] >= b[1] - tol && a[2] <= b[2] + tol && a[3] <= b[3] + tol;

// A PNG made in memory: w x h pixels at dpi, a gradient with a 'frame' px wide band of another colour around it.
export function makePng(w, h, dpi, frame = 0) {
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t, 'latin1'), d])) >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3, edge = x < frame || y < frame || x >= w - frame || y >= h - frame;
    raw[o] = edge ? 170 : (x * 255 / w) | 0; raw[o + 1] = edge ? 200 : (y * 255 / h) | 0; raw[o + 2] = edge ? 230 : 120;
  }
  const phys = Buffer.alloc(9); phys.writeUInt32BE(Math.round(dpi / 0.0254)); phys.writeUInt32BE(Math.round(dpi / 0.0254), 4); phys[8] = 1;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('pHYs', phys), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
