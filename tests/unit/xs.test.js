import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildXsFiles, pathData } from '../../src/core/xs.js';
import { makeZipDeflated } from '../../src/core/zip.js';

const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
// a stamp in its own mm: cut 0..40 x 0..20, red reaching 0.8 past it, some "text"
const stamp = (x, y) => ({ x, y, parts: { blue: [sq(0, 0, 40, 20), sq(5, 5, 30, 10)], red: [sq(-0.8, -0.8, 41.6, 21.6), sq(4.8, 4.8, 30.4, 10.4)], black: [sq(0, 0, 40, 20)] } });
const files = await buildXsFiles([stamp(10, 10), stamp(60, 10)], { now: 1794404038001 });
const J = name => JSON.parse(files.find(f => (typeof name === 'string' ? f.name === name : name.test(f.name))).text);

// the paths as xTool places them (skew is stored rounded to 3.141593, so a few µm off): world = M p + (offsetX, offsetY), M from angle and skew (PIXI)
function world(d, vectors) {
  const r = d.angle * Math.PI / 180, a = Math.cos(r + d.skew.y) * d.scale.x, b = Math.sin(r + d.skew.y) * d.scale.x;
  const c = -Math.sin(r - d.skew.x) * d.scale.y, e = Math.cos(r - d.skew.x) * d.scale.y;
  const s = d.dPath || vectors[d.vectorRef.vectorHash], n = s.match(/-?\d*\.?\d+(?:e-?\d+)?/g).map(Number), pts = [];
  for (let i = 0; i < n.length; i += 2) pts.push([a * n[i] + c * n[i + 1] + d.offsetX, b * n[i] + e * n[i + 1] + d.offsetY]);
  return pts;
}

describe('xTool project (.xs)', () => {
  it('has the files of an xTool Studio project, in its order', () => {
    expect(files.map(f => f.name.replace(/[0-9a-f-]{36}/g, 'ID'))).toEqual(['meta/persistence-meta.json', 'project.json', 'profiles.json', 'canvases/', 'canvases/ID.json', 'canvases/ID/', 'canvases/ID/displays-0.json', 'devices/', 'devices/device-MP2-1.json', 'vectors/', 'vectors/svg/', 'vectors/svg/index.json', 'vectors/svg/data-0.json', '.format']);
    expect(files.find(f => f.name === '.format').text).toBe('v2');
    expect(J('meta/persistence-meta.json')).toEqual({ schemaVersion: '2.0.0', protocol: 'xcs-workspace-v2' });
  });
  it('the laser settings of the stamp project, bound to every path of every stamp', () => {
    const ds = J(/displays-0\.json$/).displays, prof = J('profiles.json').profiles, dev = J('devices/device-MP2-1.json');
    const mode = Object.values(dev.processing)[0].modes.LASER_PLANE;
    expect(dev).toMatchObject({ id: 'MP2-1', deviceCode: 'MP2', extId: 'P2', extName: 'P2', power: [55] });
    expect(mode.data).toEqual({ material: 0, thickness: null, perimeter: null, diameter: null, isProcessByLayer: false, pathPlanning: 'auto', fillPlanning: 'separate', scanDirection: 'topToBottom', matchThresh: 0.7, enableOddEvenKerf: true, focalLen: null, focalLength: null });
    expect(new Set(mode.profileRefs)).toEqual(new Set(Object.keys(prof)));
    const want = {
      '#2366ff': ['FILL_VECTOR_ENGRAVING', { power: 55, speed: 400, repeat: 1, density: 300 }],
      '#fe0002': ['FILL_VECTOR_ENGRAVING', { power: 35, speed: 300, repeat: 5, density: 200 }],
      '#000000': ['VECTOR_CUTTING', { power: 80, speed: 20, repeat: 2 }]
    };
    expect(ds).toHaveLength(6);
    for (const d of ds) {
      const main = mode.bindings.filter(b => b.displayIds.includes(d.id));
      expect(main).toHaveLength(1);
      const p = prof[main[0].baseProfileId];
      expect(p.processingType).toBe(want[d.layerTag][0]);
      expect(p.values).toMatchObject(want[d.layerTag][1]);
      // and the two shadow bindings xTool keeps for the other processing types
      expect(mode.bindings.filter(b => b.shadowOf === main[0].bindingId).map(b => prof[b.baseProfileId].processingType).sort())
        .toEqual(d.layerTag === '#000000' ? ['FILL_VECTOR_ENGRAVING', 'VECTOR_ENGRAVING'] : ['VECTOR_CUTTING', 'VECTOR_ENGRAVING']);
    }
  });
  it('each stamp is one group, mirrored in place, layers in processing order', () => {
    const ds = J(/displays-0\.json$/).displays, canvas = J(/canvases\/[0-9a-f-]{36}\.json$/), vectors = J('vectors/svg/data-0.json').entries;
    expect(Object.keys(canvas.groupData)).toHaveLength(2);
    expect(canvas.layerData).toEqual({ '#2366ff': { name: '#2366FF', order: 1, visible: true }, '#fe0002': { name: '#FE0002', order: 2, visible: true }, '#000000': { name: '#000000', order: 3, visible: true } });
    expect(canvas.chunkLayout).toEqual({ displayCount: 6, chunkCount: 1, chunkIndexes: [0] });
    for (const g of Object.keys(canvas.groupData)) expect(ds.filter(d => d.groupTags[0] === g).map(d => d.layerTag).sort()).toEqual(['#000000', '#2366ff', '#fe0002']);
    const first = ds.filter(d => d.groupTags[0] === ds.find(q => q.zOrder === 1).groupTags[0]);
    const cut = first.find(d => d.layerTag === '#000000'), red = first.find(d => d.layerTag === '#fe0002');
    // the red edge starts at the stamp's place (10, 10); the cut 0.8 mm in; a point at local x is at 10.8 + 40 - x
    const W = world(cut, vectors), R = world(red, vectors);
    expect(Math.min(...R.map(p => p[0]))).toBeCloseTo(10, 4); expect(Math.min(...R.map(p => p[1]))).toBeCloseTo(10, 4);
    expect(Math.min(...W.map(p => p[0]))).toBeCloseTo(10.8, 4); expect(Math.max(...W.map(p => p[0]))).toBeCloseTo(50.8, 4);
    expect(cut).toMatchObject({ angle: 180, skew: { x: 3.141593, y: 0 }, localSkew: { x: 0, y: 3.141593 }, width: 40, height: 20, isFill: false, fillRule: 'nonzero' });
    // the blue text sits mirrored: local (5..35) -> world 10.8 + 40 - (35..5)
    const blue = world(first.find(d => d.layerTag === '#2366ff'), vectors);
    expect(blue.some(p => Math.abs(p[0] - 15.8) < 1e-4)).toBe(true);
  });
  it('vectors are stored by their SHA-256 with their size', () => {
    const v = J('vectors/svg/data-0.json').entries, ix = J('vectors/svg/index.json');
    for (const [h, s] of Object.entries(v)) {
      expect(createHash('sha256').update(s).digest('hex')).toBe(h);
      expect(ix.entries[h]).toEqual({ hash: h, size: Buffer.byteLength(s) });
    }
    expect(ix.entryCount).toBe(Object.keys(v).length);
    expect(pathData([sq(0, 0, 1, 2)])).toBe('M0 0L1 0 1 2 0 2Z');
  });
  it('works on http pages: its own SHA-256 and UUIDs (no crypto.subtle, no crypto.randomUUID there)', async () => {
    const { sha256Hex } = await import('../../src/core/xs.js');
    for (const t of ['', 'abc', 'M0 0L1 0Z'.repeat(1000), 'zażółć gęślą jaźń']) expect(sha256Hex(t)).toBe(createHash('sha256').update(t).digest('hex'));
    const ids = J(/displays-0\.json$/).displays.map(d => d.id);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('is a deflated zip', async () => {
    const buf = Buffer.from(await (await makeZipDeflated(files)).arrayBuffer());
    expect(buf.readUInt16LE(8)).toBe(8); // deflate
    const nl = buf.readUInt16LE(26), size = buf.readUInt32LE(18);
    expect(buf.subarray(30, 30 + nl).toString()).toBe('meta/persistence-meta.json');
    expect(JSON.parse(inflateRawSync(buf.subarray(30 + nl, 30 + nl + size)).toString())).toEqual({ schemaVersion: '2.0.0', protocol: 'xcs-workspace-v2' });
  });
});
