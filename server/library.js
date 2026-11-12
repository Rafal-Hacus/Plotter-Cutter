// Background library: graphics uploaded once (e.g. birthday, wedding) with the card settings that go with them,
// so a winietki job is: pick a background, paste the names, export.
// Files live in <data>/backgrounds/<id>.<ext> plus a small JPEG thumbnail; the list is <data>/backgrounds.json.
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ValidationError, validateSettings } from './store.js';

export const LIB_LIMITS = { items: 200, file: 40 * 1024 * 1024, thumb: 300 * 1024, name: 80 };
const TYPES = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' };
// what the bytes really are (never trust the name or the browser's type)
export function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}
const cleanName = n => {
  const name = typeof n === 'string' ? n.trim().replace(/\s+/g, ' ') : '';
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > LIB_LIMITS.name || /[\u0000-\u001f\u007f]/.test(name)) throw new ValidationError(`The name must be 1 to ${LIB_LIMITS.name} characters.`);
  return name;
};
const b64 = (s, what, max) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new ValidationError(`${what}: expected base64.`);
  const buf = Buffer.from(s, 'base64');
  if (!buf.length || buf.length > max) throw new ValidationError(`${what} is empty or too large (at most ${Math.round(max / 1048576 * 10) / 10} MB).`);
  return buf;
};

export async function openLibrary(dataDir) {
  const dir = join(dataDir, 'backgrounds'), indexFile = join(dataDir, 'backgrounds.json');
  await mkdir(dir, { recursive: true });
  let data = { version: 1, items: {} };
  try {
    const parsed = JSON.parse(await readFile(indexFile, 'utf8'));
    if (parsed && parsed.version === 1 && parsed.items && typeof parsed.items === 'object') data = parsed;
  } catch (e) { if (e.code !== 'ENOENT') throw new Error(`Can't read ${indexFile}: ${e.message}`, { cause: e }); }
  let queue = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(data, null, 2);
    queue = queue.then(async () => { const tmp = `${indexFile}.tmp`; await writeFile(tmp, snapshot, { mode: 0o600 }); await rename(tmp, indexFile); });
    return queue;
  };
  const fileOf = it => join(dir, `${it.id}.${it.kind}`), thumbOf = it => join(dir, `${it.id}.thumb.jpg`);
  const summary = it => ({ id: it.id, name: it.name, kind: it.kind, size: it.size, settings: it.settings, updatedAt: it.updatedAt, updatedBy: it.updatedBy });
  const has = id => Object.hasOwn(data.items, id);
  return {
    list: () => Object.values(data.items).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map(summary),
    // body: { name, data (base64 PNG/JPEG/PDF), thumb (base64 JPEG), settings }
    async create(body, user) {
      if (!body || typeof body !== 'object') throw new ValidationError('Expected a JSON object.');
      if (Object.keys(data.items).length >= LIB_LIMITS.items) throw new ValidationError(`At most ${LIB_LIMITS.items} backgrounds.`);
      const name = cleanName(body.name), file = b64(body.data, 'The file', LIB_LIMITS.file), thumb = b64(body.thumb, 'The thumbnail', LIB_LIMITS.thumb);
      const kind = sniff(file);
      if (!kind) throw new ValidationError('The file must be a PNG, JPEG or PDF.');
      if (sniff(thumb) !== 'jpg') throw new ValidationError('The thumbnail must be a JPEG.');
      const settings = validateSettings(body.settings || {});
      const it = { id: randomUUID(), name, kind, size: file.length, settings, updatedAt: new Date().toISOString(), updatedBy: user };
      await writeFile(fileOf(it), file, { mode: 0o600 });
      await writeFile(thumbOf(it), thumb, { mode: 0o600 });
      data.items[it.id] = it;
      await persist();
      return summary(it);
    },
    async update(id, body, user) {
      if (!has(id)) return null;
      const it = data.items[id];
      if (body && body.name !== undefined) it.name = cleanName(body.name);
      if (body && body.settings !== undefined) it.settings = validateSettings(body.settings);
      it.updatedAt = new Date().toISOString(); it.updatedBy = user;
      await persist();
      return summary(it);
    },
    async remove(id) {
      if (!has(id)) return false;
      const it = data.items[id];
      delete data.items[id];
      await persist();
      await rm(fileOf(it), { force: true }); await rm(thumbOf(it), { force: true });
      return true;
    },
    // { type, bytes } of the file or the thumbnail
    async read(id, thumb) {
      if (!has(id)) return null;
      const it = data.items[id];
      return thumb ? { type: 'image/jpeg', bytes: await readFile(thumbOf(it)) } : { type: TYPES[it.kind], bytes: await readFile(fileOf(it)) };
    },
    flush: () => queue
  };
}
