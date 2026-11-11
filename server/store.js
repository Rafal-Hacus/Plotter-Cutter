// Saved settings ("presets"), kept in one JSON file. Writes go to a temporary file that is renamed over the
// old one, so a crash never leaves a half-written file; writes are queued so they never interleave.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export const LIMITS = { presets: 500, name: 80, keys: 400, key: 40, value: 500, mode: 40 };
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
export const MODES = ['stickers', 'cards', 'vouchers', 'winietka', 'guillotine', 'deck', 'gang', 'morgana', 'duplex', 'vinyl', 'pen', 'squares', 'svgplt'];

export class ValidationError extends Error {}

// A preset as sent by the browser: { name, mode, settings: { fieldId: string | number | boolean } }
export function validatePreset(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Expected a JSON object.');
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > LIMITS.name) throw new ValidationError(`The name must be 1 to ${LIMITS.name} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new ValidationError('The name contains control characters.');
  const mode = body.mode;
  if (!MODES.includes(mode)) throw new ValidationError('Unknown mode.');
  const s = body.settings;
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new ValidationError('Settings must be an object.');
  const keys = Object.keys(s);
  if (keys.length > LIMITS.keys) throw new ValidationError('Too many settings.');
  const settings = {};
  for (const k of keys) {
    if (k.length > LIMITS.key || !KEY_RE.test(k)) throw new ValidationError(`Bad setting name: ${k.slice(0, 50)}`);
    const v = s[k];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) settings[k] = v;
    else if (typeof v === 'string' && v.length <= LIMITS.value) settings[k] = v;
    else throw new ValidationError(`Bad value for ${k}.`);
  }
  return { name, mode, settings };
}

export async function openStore(file) {
  let data = { version: 1, defaultId: null, presets: {} };
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed && parsed.version === 1 && parsed.presets && typeof parsed.presets === 'object') data = parsed;
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Can't read ${file}: ${e.message}`, { cause: e });
  }
  await mkdir(dirname(file), { recursive: true });
  let queue = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(data, null, 2);
    queue = queue.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, file);
    });
    return queue;
  };
  const summary = p => ({ id: p.id, name: p.name, mode: p.mode, updatedAt: p.updatedAt, updatedBy: p.updatedBy, isDefault: data.defaultId === p.id });
  return {
    list: () => Object.values(data.presets).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map(summary),
    get: id => (Object.hasOwn(data.presets, id) ? { ...summary(data.presets[id]), settings: data.presets[id].settings } : null),
    async create(body, user) {
      const v = validatePreset(body);
      if (Object.keys(data.presets).length >= LIMITS.presets) throw new ValidationError(`At most ${LIMITS.presets} saved settings.`);
      const id = randomUUID();
      data.presets[id] = { id, ...v, updatedAt: new Date().toISOString(), updatedBy: user };
      await persist();
      return this.get(id);
    },
    async update(id, body, user) {
      if (!Object.hasOwn(data.presets, id)) return null;
      const v = validatePreset(body);
      data.presets[id] = { id, ...v, updatedAt: new Date().toISOString(), updatedBy: user };
      await persist();
      return this.get(id);
    },
    async remove(id) {
      if (!Object.hasOwn(data.presets, id)) return false;
      delete data.presets[id];
      if (data.defaultId === id) data.defaultId = null;
      await persist();
      return true;
    },
    async setDefault(id) {
      if (id !== null && !Object.hasOwn(data.presets, id)) return false;
      data.defaultId = id;
      await persist();
      return true;
    },
    defaultId: () => data.defaultId,
    flush: () => queue
  };
}
