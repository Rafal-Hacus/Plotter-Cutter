// xTool Studio project files (.xs, "xcs-workspace-v2": a zip of JSON files) for rubber stamps on the xTool P2,
// written exactly like a stamp project saved by xTool Studio 1.7.30 (canvas format 2.16.2): the same files, fields,
// layers and laser settings, one group per stamp so each moves as one piece.
//
// How xTool places a path: world = M · p + (offsetX, offsetY), M from angle / skew / scale (PIXI). A stamp is
// mirrored (it prints the right way round): angle 180 with skew.x = π is M = [-1 0; 0 1], a mirror left to right.
// Then (x, y) is the world position of the path's bounding box: its right edge (mirrored) and its top. The path
// data here starts at 0, 0 (its own bounding box), so offsetX = x and offsetY = y.
//
// Layers and settings (the stamp's three parts, see core/stamp.js), in processing order:
//   #2366FF  blue  fill engraving   55 % power, speed 400, 300 lines/inch, 1 pass   (the finishing pass; the
//                                    original stamp had 30 %, raised to 55 % after cutting stamps with it)
//   #FE0002  red   fill engraving   35 % power, speed 300, 200 lines/inch, 5 passes (the deep pass)
//   #000000  black vector cut       80 % power, speed 20, 2 passes                 (cutting the stamp out)
// With a sloped shoulder the deep pass is split into steps (core/stamp.js): red keeps its area with the first share
// of the 5 passes, and each further step (orange, yellow, green, purple) engraves a little further from the letters
// with the next share, same power and speed; the passes add up, so the outside is exactly as deep as before.
// Each path has its own binding to its profile, plus two "shadow" bindings with xTool's defaults for the other
// processing types (what xTool switches to if you change the type), all as xTool writes them.

import { splitPasses } from './stamp.js';

export const XS_APP = { appVersion: '1.7.30', canvasVersion: '2.16.2' };
export const BED = { w: 600, h: 308 }; // xTool P2 working area (mm)

const LAYERS = { blue: '#2366ff', red: '#fe0002', black: '#000000' };
export const SLOPE_COLORS = ['#ff8c00', '#ffd400', '#00b050', '#a64dff'];
// the settings of the stamp project
const FILL = (power, speed, repeat, density) => ({ power, speed, repeat, density, bitmapScanMode: 'zMode', airPump: 50, enableKerf: false, kerfDistance: 0, defocus: false, defocus_distance: 8 });
const CUT = (power, speed, repeat) => ({ power, speed, repeat, cuttingDrop: false, sinkingMethod: 'one', firstCuttingDropValue: 1, cuttingDropValue: 1, descentIntervalDescent: 1, descentPerStep: 1, enableBreakPoint: false, breakPointGenMode: 'auto', breakPointSize: 0.5, breakPointMode: 'count', breakPointCount: 2, breakPointDistance: 100, breakPointPower: 0, enableKerf: false, kerfDistance: 0, airPump: 100, enableOverCut: false, overCutDistance: 0.5 });
const VENGRAVE = (power, speed, repeat) => ({ power, speed, repeat, enableKerf: false, kerfDistance: 0, airPump: 50, defocus: false, defocus_distance: 8 });
export const STAMP_SETTINGS = {
  blue: { processingType: 'FILL_VECTOR_ENGRAVING', values: FILL(55, 400, 1, 300) },
  red: { processingType: 'FILL_VECTOR_ENGRAVING', values: FILL(35, 300, 5, 200) },
  black: { processingType: 'VECTOR_CUTTING', values: CUT(80, 20, 2) }
};
// xTool's defaults for the other processing types of each path (the shadow bindings)
const SHADOW = {
  vengrave: { processingType: 'VECTOR_ENGRAVING', values: VENGRAVE(1, 20, 1) },
  cut: { processingType: 'VECTOR_CUTTING', values: CUT(1, 16, 1) },
  fill: { processingType: 'FILL_VECTOR_ENGRAVING', values: FILL(1, 80, 1, 100) }
};
const SHADOWS_OF = { blue: ['vengrave', 'cut'], red: ['vengrave', 'cut'], black: ['vengrave', 'fill'] };

const withRepeat = (def, repeat) => ({ ...def, values: { ...def.values, repeat } });
const f6 = v => { const r = Math.round(v * 1e6) / 1e6; return Object.is(r, -0) ? 0 : r; };
const n6 = v => String(f6(v));
// rings -> SVG path data as xTool writes it: "M x yL x y x y …Z" per ring
export function pathData(rings) {
  return rings.map(r => `M${n6(r[0][0])} ${n6(r[0][1])}L${r.slice(1).map(p => `${n6(p[0])} ${n6(p[1])}`).join(' ')}Z`).join('');
}
// SHA-256 in plain JS: crypto.subtle (and crypto.randomUUID) exist only on https pages, and the app is often
// opened over plain http on the local network
const K256 = Uint32Array.from([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256Hex(text) {
  const msg = new TextEncoder().encode(text), n = msg.length, total = Math.ceil((n + 9) / 64) * 64, buf = new Uint8Array(total);
  buf.set(msg); buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(n / 0x20000000), false); dv.setUint32(total - 4, (n << 3) >>> 0, false);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64);
  const rotr = (x, r) => (x >>> r) | (x << (32 - r));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, x => x.toString(16).padStart(8, '0')).join('');
}
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const shortId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => ALNUM[b % ALNUM.length]).join('');
// a random UUID (version 4); crypto.getRandomValues works on http pages too
const uuid = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};

// One display (a path on the canvas), with xTool's fields in xTool's order. kind: 'blue' | 'red' | 'black'.
// (paths inside a group carry no groupTag of their own, as in xTool's file)
function display(kind, { id, x, y, w, h, zOrder, sourceId, groupTags, path, color = LAYERS[kind] }) {
  const filled = kind !== 'black';
  const d = {
    id, name: null, type: 'PATH', x: f6(x), y: f6(y), angle: 180, scale: { x: 1, y: 1 }, skew: { x: 3.141593, y: 0 }, pivot: { x: 0, y: 0 },
    localSkew: { x: 0, y: 3.141593 }, offsetX: f6(x), offsetY: f6(y), lockRatio: kind !== 'black', isClosePath: true, zOrder, sourceId,
    groupTags, layerTag: color, layerColor: color, visible: true, originColor: '#000000', enableTransform: true,
    visibleState: true, lockState: false, resourceOrigin: '', customData: { tabBreaks: {}, startPoint: {} }, rootComponentId: '',
    minCanvasVersion: '0.0.0', alpha: 1,
    // as in the stamp project: the blue engraving is shown filled, the red one and the cut as outlines
    fill: { paintType: 'color', visible: kind === 'blue', color: 0, alpha: 1 },
    stroke: kind === 'blue'
      ? { paintType: 'color', visible: false, color: 0, alpha: 1, width: 33.333332, cap: 'butt', join: 'round', miterLimit: 2, alignment: 0.5 }
      : { paintType: 'color', visible: true, color: 0, alpha: 1, width: 1, cap: 'butt', join: 'miter', miterLimit: 4, alignment: 0.5 },
    effects: [], width: f6(w), height: f6(h), isFill: filled, lineColor: filled ? 16421416 : 10036991, fillColor: filled ? '#f9932b' : '#9928ff',
    points: [], fillRule: filled ? 'evenodd' : 'nonzero', graphicX: f6(x), graphicY: f6(y), isCompoundPath: filled
  };
  if (filled) d.vectorRef = { vectorHash: path.hash, bucketType: 'svg', originalField: 'dPath' };
  else d.dPath = path.d;
  return d;
}

// stamps: [{ x, y (top left corner of the stamp on the bed, mm), parts: { blue, red, black: rings in stamp mm,
//           y down, NOT mirrored: the file mirrors them } }]; cover: PNG bytes of a picture of the job (or null).
// Returns the files of the .xs, in xTool's order: [{ name, text | bytes }] (directories end in '/').
export async function buildXsFiles(stamps, { cover = null, name = 'Untitled', now = Date.now() } = {}) {
  const canvasId = uuid(), projectId = uuid(), displays = [], groupData = {}, profiles = {}, bindings = [], vectors = {};
  const profile = def => { const id = `profile:${shortId()}`; profiles[id] = { id, processingType: def.processingType, values: { ...def.values } }; return id; };
  const shadowIds = Object.fromEntries(Object.entries(SHADOW).map(([k, def]) => [k, profile(def)]));
  let z = 0;
  const used = new Set();
  for (const st of stamps) {
    const gid = `g-${uuid()}`;
    groupData[gid] = { groupName: '', groupTag: gid, visible: true, enableTransform: true, zOrder: 1, rotation: 0 };
    // the stamp's extent (all parts): it is mirrored around it, so it stays where it was put
    let ex0 = Infinity, ex1 = -Infinity, ey0 = Infinity;
    for (const rings of Object.values(st.parts)) for (const r of rings) for (const [px, py] of r) { if (px < ex0) ex0 = px; if (px > ex1) ex1 = px; if (py < ey0) ey0 = py; }
    const A = st.x + (ex1 - ex0) + ex0, Yo = st.y - ey0; // world x = A - local x; world y = Yo + local y
    // the deep pass's passes shared by red and the slope's steps
    const slope = (st.parts.slope || []).slice(0, SLOPE_COLORS.length), passes = splitPasses(STAMP_SETTINGS.red.values.repeat, 1 + slope.length);
    const layers = [['blue', st.parts.blue, LAYERS.blue, STAMP_SETTINGS.blue], ['red', st.parts.red, LAYERS.red, withRepeat(STAMP_SETTINGS.red, passes[0])],
      ...slope.map((rings, i) => ['red', rings, SLOPE_COLORS[i], withRepeat(STAMP_SETTINGS.red, passes[i + 1])]), ['black', st.parts.black, LAYERS.black, STAMP_SETTINGS.black]];
    for (const [kind, rings, color, setting] of layers) {
      if (!rings.length) continue;
      used.add(color);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of rings) for (const [px, py] of r) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
      const d = pathData(rings.map(r => r.map(([px, py]) => [px - x0, py - y0])));
      let path = { d };
      if (kind !== 'black') { const hash = sha256Hex(d); vectors[hash] = d; path = { hash }; }
      const id = uuid();
      displays.push(display(kind, { id, x: A - x0, y: Yo + y0, w: x1 - x0, h: y1 - y0, zOrder: ++z, sourceId: uuid(), groupTags: [gid], path, color }));
      const main = `binding:${shortId()}`;
      bindings.push({ bindingId: main, canvasId, mode: 'LASER_PLANE', baseProfileId: profile(setting), displayIds: [id] });
      for (const s of SHADOWS_OF[kind]) bindings.push({ bindingId: `binding:${shortId()}`, canvasId, mode: 'LASER_PLANE', baseProfileId: shadowIds[s], displayIds: [], shadowOf: main });
    }
  }
  // listed topmost first, as xTool saves them
  displays.sort((p, q) => q.zOrder - p.zOrder);
  const J = o => JSON.stringify(o, null, 2);
  const canvas = {
    id: canvasId, title: '{panel}1', hidden: false,
    // in processing order: blue, red, the slope's steps, the cut (as the stamp project has them without a slope)
    layerData: Object.fromEntries([LAYERS.blue, LAYERS.red, ...SLOPE_COLORS.filter(c => used.has(c)), LAYERS.black].map((c, i) => [c, { name: c.toUpperCase(), order: i + 1, visible: true }])),
    groupData,
    extendInfo: { version: XS_APP.canvasVersion, minCanvasVersion: '0.0.0', displayProcessConfigMap: {}, rulerPluginData: { rulerGuide: [] }, type: '2d' },
    chunkLayout: { displayCount: displays.length, chunkCount: 1, chunkIndexes: [0] }
  };
  const device = {
    id: 'MP2-1', deviceCode: 'MP2', extId: 'P2', extName: 'P2', power: [55],
    processing: {
      [canvasId]: {
        id: canvasId, activeMode: 'LASER_PLANE',
        modes: {
          LASER_PLANE: {
            ignoredDisplayIds: [],
            data: { material: 0, thickness: null, perimeter: null, diameter: null, isProcessByLayer: false, pathPlanning: 'auto', fillPlanning: 'separate', scanDirection: 'topToBottom', matchThresh: 0.7, enableOddEvenKerf: true, focalLen: null, focalLength: null },
            profileRefs: Object.keys(profiles), patches: {}, bindings
          }
        }
      }
    }
  };
  const project = {
    __v2__: true, version: '2.0.0',
    schemaMeta: { schemaVersion: '2.1.0', format: 'directory', migratedFrom: '1.0', migratedAt: now },
    projectId, projectTraceID: projectId, projectName: name, activeCanvasId: canvasId, activeDeviceId: 'MP2-1',
    versionInfo: { source: 'web', appVersion: XS_APP.appVersion, savedAt: now, ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) xToolStudio/${XS_APP.appVersion} Chrome/136.0.7103.49 Electron/36.2.0 Safari/537.36`, minRequiredVersion: '2.6.0', appMinRequiredVersion: '', webMinRequiredVersion: '' },
    created: now, modify: now,
    modules: { canvases: [canvasId], devices: ['MP2-1'] },
    ...(cover ? { cover: 'resources/project-cover.png' } : {}),
    customProjectData: { projectTraceID: projectId }
  };
  const vecIndex = { bucketType: 'svg', version: '1.0', entryCount: Object.keys(vectors).length, entries: {} };
  for (const [h, d] of Object.entries(vectors)) vecIndex.entries[h] = { hash: h, size: new TextEncoder().encode(d).length };
  const files = [
    { name: 'meta/persistence-meta.json', text: J({ schemaVersion: '2.0.0', protocol: 'xcs-workspace-v2' }) },
    { name: 'project.json', text: J(project) },
    { name: 'profiles.json', text: J({ profiles }) },
    { name: 'canvases/' },
    { name: `canvases/${canvasId}.json`, text: J(canvas) },
    { name: `canvases/${canvasId}/` },
    { name: `canvases/${canvasId}/displays-0.json`, text: J({ canvasId, chunkIndex: 0, displays }) },
    { name: 'devices/' },
    { name: 'devices/device-MP2-1.json', text: J(device) }
  ];
  if (cover) files.push({ name: 'resources/' },
    { name: 'resources/project-cover.png.meta.json', text: J({ ref: 'resources/project-cover.png', metadata: { kind: 'image', source: { type: 'workspace', value: 'project-cover.png' }, mimeType: 'image/png' } }) },
    { name: 'resources/project-cover.png', bytes: cover });
  files.push({ name: 'vectors/' }, { name: 'vectors/svg/' },
    { name: 'vectors/svg/index.json', text: J(vecIndex) },
    { name: 'vectors/svg/data-0.json', text: J({ bucketType: 'svg', chunkIndex: 0, entries: vectors }) },
    { name: '.format', text: 'v2' });
  return files;
}
