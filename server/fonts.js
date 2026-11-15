// Font library for the stamps: font files uploaded once (TrueType, OpenType, WOFF, WOFF2), offered in the stamp
// text editor from then on. Files live in <data>/fonts/<id>.font; the list is <data>/fonts.json. The family and
// style (regular / bold / italic / bold italic) come from the browser, which reads them from the file.
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ValidationError } from './store.js';

export const FONT_LIMITS = { items: 300, file: 30 * 1024 * 1024, name: 120 };
export const FONT_STYLES = ['regular', 'bold', 'italic', 'bolditalic'];
// what the bytes really are: a font this app can read, or null
export function sniffFont(buf) {
  if (buf.length < 12) return null;
  const tag = buf.subarray(0, 4).toString('latin1');
  if (tag === '\u0000\u0001\u0000\u0000' || tag === 'true') return 'ttf';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  return null;
}
const TYPES = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
const text = (v, what) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > FONT_LIMITS.name || /[\u0000-\u001f\u007f]/.test(s)) throw new ValidationError(`${what} must be 1 to ${FONT_LIMITS.name} characters.`);
  return s;
};

export async function openFonts(dataDir) {
  const dir = join(dataDir, 'fonts'), indexFile = join(dataDir, 'fonts.json');
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
  const fileOf = it => join(dir, `${it.id}.font`);
  const summary = it => ({ id: it.id, name: it.name, family: it.family, style: it.style, kind: it.kind, size: it.size, updatedAt: it.updatedAt, updatedBy: it.updatedBy });
  const has = id => Object.hasOwn(data.items, id);
  return {
    list: () => Object.values(data.items).sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }) || FONT_STYLES.indexOf(a.style) - FONT_STYLES.indexOf(b.style)).map(summary),
    // body: { name (file name), family, style, data (base64) }. The same family and style again replaces it.
    async create(body, user) {
      if (!body || typeof body !== 'object') throw new ValidationError('Expected a JSON object.');
      const name = text(body.name, 'The file name'), family = text(body.family, 'The font family');
      if (!FONT_STYLES.includes(body.style)) throw new ValidationError(`The style must be one of ${FONT_STYLES.join(', ')}.`);
      if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw new ValidationError('The file: expected base64.');
      const file = Buffer.from(body.data, 'base64');
      if (!file.length || file.length > FONT_LIMITS.file) throw new ValidationError(`The font file is empty or larger than ${FONT_LIMITS.file / 1048576} MB.`);
      const kind = sniffFont(file);
      if (!kind) throw new ValidationError('That is not a font file (TrueType, OpenType, WOFF or WOFF2).');
      const same = Object.values(data.items).find(it => it.family.toLowerCase() === family.toLowerCase() && it.style === body.style);
      if (!same && Object.keys(data.items).length >= FONT_LIMITS.items) throw new ValidationError(`At most ${FONT_LIMITS.items} fonts.`);
      const it = { id: same ? same.id : randomUUID(), name, family: same ? same.family : family, style: body.style, kind, size: file.length, updatedAt: new Date().toISOString(), updatedBy: user };
      await writeFile(fileOf(it), file, { mode: 0o600 });
      data.items[it.id] = it;
      await persist();
      return summary(it);
    },
    async remove(id) {
      if (!has(id)) return false;
      const it = data.items[id];
      delete data.items[id];
      await persist();
      await rm(fileOf(it), { force: true });
      return true;
    },
    async read(id) {
      if (!has(id)) return null;
      const it = data.items[id];
      return { type: TYPES[it.kind], bytes: await readFile(fileOf(it)) };
    },
    flush: () => queue
  };
}
