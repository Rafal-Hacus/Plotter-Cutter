import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, loadConfig } from '../../server/index.js';
import { hashPassword, verifyPassword, sessionSigner } from '../../server/auth.js';
import { openStore, validatePreset } from '../../server/store.js';

const PASSWORD = 'correct horse battery';
let base, server, dir, staticDir;

async function start(env = {}) {
  const cfg = loadConfig({ DATA_DIR: dir, STATIC_DIR: staticDir, AUTH_USERNAME: 'shop', AUTH_PASSWORD: PASSWORD, SESSION_SECRET: 'test-secret', ...env });
  const app = await createApp(cfg);
  await new Promise(ok => app.server.listen(0, '127.0.0.1', ok));
  return { app, url: `http://127.0.0.1:${app.server.address().port}` };
}
const get = (path, headers = {}) => fetch(base + path, { redirect: 'manual', headers });
const login = (username, password, headers = {}) => fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ username, password }) });
let cookie;
const authed = (path, opts = {}) => fetch(base + path, { redirect: 'manual', ...opts, headers: { cookie, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers } });
const preset = (over = {}) => ({ name: 'Morgana 85 × 55', mode: 'morgana', settings: { mSize: '85x55', cBleed: '2', icExtend: true, kissForce: 60 }, ...over });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pc-data-'));
  staticDir = mkdtempSync(join(tmpdir(), 'pc-static-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>app</title>');
  mkdirSync(join(staticDir, 'assets'));
  writeFileSync(join(staticDir, 'assets', 'app-123.js'), 'console.log(1)');
  writeFileSync(join(staticDir, '.env'), 'SECRET=1');
  ({ app: { server }, url: base } = await start());
});
afterAll(() => server && server.close());

describe('access without signing in', () => {
  it('health check is open', async () => { expect((await get('/healthz')).status).toBe(200); });
  it('the app redirects to the login page', async () => {
    const r = await get('/', { accept: 'text/html' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('login');
  });
  it('files and the API are refused', async () => {
    expect((await get('/assets/app-123.js')).status).toBe(401);
    expect((await get('/api/presets')).status).toBe(401);
  });
  it('the login page is served with security headers', async () => {
    const r = await get('/login');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('name="password"');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('signing in', () => {
  it('a wrong password is refused', async () => {
    const r = await login('shop', 'nope nope nope');
    expect(r.headers.get('location')).toBe('login?e=1');
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('a login from another site is refused', async () => {
    expect((await login('shop', PASSWORD, { origin: 'https://evil.example' })).status).toBe(403);
  });
  it('the right password sets an HttpOnly, SameSite=Strict session cookie', async () => {
    const r = await login('shop', PASSWORD);
    expect(r.status).toBe(303);
    const c = r.headers.get('set-cookie');
    expect(c).toMatch(/pc_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000/);
    cookie = c.split(';')[0];
  });
  it('with the cookie the app is served, with a CSP header', async () => {
    const r = await authed('/');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>app</title>');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    // cross-origin isolated (lets the in-browser AI use all processor cores), and WebAssembly allowed
    expect(r.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(r.headers.get('content-security-policy')).toContain("'wasm-unsafe-eval'");
    expect((await authed('/assets/app-123.js')).headers.get('cache-control')).toContain('immutable');
  });
  it('a tampered cookie is refused', async () => {
    const bad = cookie.replace(/.$/, c => (c === 'A' ? 'B' : 'A'));
    expect((await fetch(base + '/api/me', { headers: { cookie: bad } })).status).toBe(401);
  });
  it('signing out clears the cookie', async () => {
    const r = await authed('/logout', { method: 'POST' });
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('files', () => {
  it('nothing outside the app folder or hidden can be read', async () => {
    for (const p of ['/../package.json', '/%2e%2e/%2e%2e/etc/passwd', '/.env', '/assets/../.env', '/%00', '/assets']) {
      const r = await authed(p);
      expect([400, 404]).toContain(r.status);
    }
  });
});

describe('saved settings API', () => {
  let id;
  it('creates, lists and reads a preset', async () => {
    const r = await authed('/api/presets', { method: 'POST', body: JSON.stringify(preset()) });
    expect(r.status).toBe(201);
    const p = await r.json();
    id = p.id;
    expect(p).toMatchObject({ name: 'Morgana 85 × 55', mode: 'morgana', updatedBy: 'shop', settings: { mSize: '85x55', icExtend: true } });
    const list = await (await authed('/api/presets')).json();
    expect(list.presets.map(x => x.name)).toEqual(['Morgana 85 × 55']);
    expect((await (await authed(`/api/presets/${id}`)).json()).settings.kissForce).toBe(60);
  });
  it('updates, sets the default and deletes', async () => {
    expect((await authed(`/api/presets/${id}`, { method: 'PUT', body: JSON.stringify(preset({ name: 'Renamed' })) })).status).toBe(200);
    expect((await authed('/api/default', { method: 'PUT', body: JSON.stringify({ id }) })).status).toBe(200);
    let list = await (await authed('/api/presets')).json();
    expect(list).toMatchObject({ defaultId: id, presets: [{ name: 'Renamed', isDefault: true }] });
    expect((await authed(`/api/presets/${id}`, { method: 'DELETE' })).status).toBe(200);
    list = await (await authed('/api/presets')).json();
    expect(list).toEqual({ presets: [], defaultId: null });
    expect((await authed(`/api/presets/${id}`)).status).toBe(404);
  });
  it('refuses bad input', async () => {
    for (const bad of [preset({ name: '' }), preset({ name: 'x'.repeat(81) }), preset({ mode: 'hack' }), preset({ settings: { 'a.b': 1 } }), preset({ settings: { x: { y: 1 } } }), preset({ settings: { x: 'y'.repeat(501) } }), preset({ settings: { __proto__x: 1, x: NaN } })]) {
      const r = await authed('/api/presets', { method: 'POST', body: JSON.stringify(bad) });
      expect(r.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    expect((await authed('/api/presets', { method: 'POST', body: '{nope' })).status).toBe(400);
  });
  it('refuses requests from other sites and non-JSON bodies', async () => {
    expect((await authed('/api/presets', { method: 'POST', body: JSON.stringify(preset()), headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await authed('/api/presets', { method: 'POST', body: 'name=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status).toBe(415);
  });
  it('refuses very large bodies', async () => {
    const r = await authed('/api/presets', { method: 'POST', body: JSON.stringify(preset({ settings: { a: 'x'.repeat(400_000) } })) }).catch(() => ({ status: 'reset' }));
    expect([413, 'reset']).toContain(r.status);
  });
  it('keeps the presets in a private file in the data folder', async () => {
    await authed('/api/presets', { method: 'POST', body: JSON.stringify(preset({ name: 'Kept' })) });
    const f = join(dir, 'presets.json');
    expect(JSON.parse(readFileSync(f, 'utf8')).presets).toBeTruthy();
    expect(statSync(f).mode & 0o077).toBe(0);
    const again = await openStore(f);
    expect(again.list().map(p => p.name)).toContain('Kept');
  });
});

describe('background library API', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
  const add = (over = {}) => authed('/api/backgrounds', { method: 'POST', body: JSON.stringify({ name: 'Urodziny – balony', data: PNG.toString('base64'), thumb: JPG.toString('base64'), settings: { winW: '100', winOffY: '4', cFoldOn: true }, ...over }) });
  let id;
  it('stores a background with its settings and serves the file and the thumbnail', async () => {
    // sign in again (an earlier test signed out)
    cookie = (await login('shop', PASSWORD)).headers.get('set-cookie').split(';')[0];
    const r = await add();
    expect(r.status).toBe(201);
    const it = await r.json();
    id = it.id;
    expect(it).toMatchObject({ name: 'Urodziny – balony', kind: 'png', size: PNG.length, settings: { winW: '100', cFoldOn: true } });
    const f = await authed(`/api/backgrounds/${id}/file`);
    expect(f.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await f.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await authed(`/api/backgrounds/${id}/thumb`)).headers.get('content-type')).toBe('image/jpeg');
    expect((await (await authed('/api/backgrounds')).json()).backgrounds.map(b => b.name)).toContain('Urodziny – balony');
  });
  it('is only for signed-in users', async () => {
    expect((await get(`/api/backgrounds/${id}/file`)).status).toBe(401);
    expect((await get('/api/backgrounds')).status).toBe(401);
  });
  it('updates the settings and the name, then deletes the files', async () => {
    const u = await (await authed(`/api/backgrounds/${id}`, { method: 'PUT', body: JSON.stringify({ name: 'Birthday', settings: { winW: '90' } }) })).json();
    expect(u).toMatchObject({ name: 'Birthday', settings: { winW: '90' } });
    expect((await authed(`/api/backgrounds/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await authed(`/api/backgrounds/${id}/file`)).status).toBe(404);
    expect(existsSync(join(dir, 'backgrounds', `${id}.png`))).toBe(false);
  });
  it('accepts only real PNG/JPEG/PDF files and a JPEG thumbnail, whatever they are called', async () => {
    expect((await add({ data: Buffer.from('<svg onload=x()>').toString('base64') })).status).toBe(400);
    expect((await add({ thumb: PNG.toString('base64') })).status).toBe(400);
    expect((await add({ data: 'not base64!' })).status).toBe(400);
    expect((await add({ name: '' })).status).toBe(400);
    expect((await add({ settings: { 'a.b': 1 } })).status).toBe(400);
    const pdf = await add({ data: Buffer.from('%PDF-1.7 test').toString('base64') });
    expect((await pdf.json()).kind).toBe('pdf');
  });
});

describe('lockout', () => {
  it('locks an address out after 5 wrong passwords', async () => {
    const s = await start();
    const old = base; base = s.url;
    try {
      for (let i = 0; i < 5; i++) await login('shop', 'wrong password');
      const r = await login('shop', PASSWORD);
      expect(r.headers.get('location')).toBe('login?e=locked');
      expect(r.headers.get('set-cookie')).toBeNull();
    } finally { base = old; s.app.server.close(); }
  });
});

describe('restarts', () => {
  it('a session stays valid after the server restarts with the same password', async () => {
    const a = await start(), b = await start();
    try {
      const r = await fetch(a.url + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: 'shop', password: PASSWORD }) });
      const c = r.headers.get('set-cookie').split(';')[0];
      expect((await fetch(b.url + '/api/me', { headers: { cookie: c } })).status).toBe(200);
      const other = await start({ AUTH_PASSWORD: 'a different password' });
      expect((await fetch(other.url + '/api/me', { headers: { cookie: c } })).status).toBe(401);
      other.app.server.close();
    } finally { a.app.server.close(); b.app.server.close(); }
  });
});

describe('first-run setup (no password in the environment)', () => {
  it('asks for the code from the log, creates the login, and keeps it across restarts', async () => {
    const d = mkdtempSync(join(tmpdir(), 'pc-setup-'));
    const env = { DATA_DIR: d, STATIC_DIR: staticDir, SESSION_SECRET: 'x', AUTH_USERNAME: '', AUTH_PASSWORD: '' };
    const boot = async () => { const app = await createApp(loadConfig(env)); await new Promise(ok => app.server.listen(0, '127.0.0.1', ok)); return { app, url: `http://127.0.0.1:${app.server.address().port}` }; };
    const a = await boot();
    const code = a.app.setupCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const go = (path, init) => fetch(a.url + path, { redirect: 'manual', ...init });
    expect((await go('/')).headers.get('location')).toBe('setup');
    expect((await go('/login')).headers.get('location')).toBe('setup');
    expect((await go('/api/presets')).status).toBe(401);
    expect(await (await go('/setup')).text()).toContain('name="code"');
    const post = body => go('/setup', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    expect(await (await post({ code: 'AAAA-AAAA', username: 'shop', password: 'long enough 1', password2: 'long enough 1' })).text()).toContain('setup code is wrong');
    expect(await (await post({ code, username: 'shop', password: 'short', password2: 'short' })).text()).toContain('at least 8');
    expect(await (await post({ code, username: 'shop', password: 'long enough 1', password2: 'other one 22' })).text()).toContain('different');
    expect(await (await post({ code, username: '"><b>', password: 'long enough 1', password2: 'long enough 1' })).text()).toContain('value="&quot;&gt;&lt;b&gt;"');
    // the code is accepted in lower case and without the dash
    const ok = await post({ code: code.toLowerCase().replace('-', ''), username: 'shop', password: 'long enough 1', password2: 'long enough 1' });
    expect(ok.status).toBe(303);
    const c = ok.headers.get('set-cookie').split(';')[0];
    expect((await fetch(a.url + '/api/me', { headers: { cookie: c } })).status).toBe(200);
    expect((await go('/setup')).headers.get('location')).toBe('./'); // setup is closed now
    expect(statSync(join(d, 'auth.json')).mode & 0o077).toBe(0);
    expect(existsSync(join(d, 'setup-code'))).toBe(false);
    a.app.server.close();
    // after a restart the login is still there and the cookie still works
    const b = await boot();
    expect(b.app.setupCode()).toBeNull();
    expect((await fetch(b.url + '/api/me', { headers: { cookie: c } })).status).toBe(200);
    const l = await fetch(b.url + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: 'shop', password: 'long enough 1' }) });
    expect(l.headers.get('set-cookie')).toContain('pc_session=');
    b.app.server.close();
    // a password in the environment wins over the stored login
    const e = await createApp(loadConfig({ ...env, AUTH_USERNAME: 'boss', AUTH_PASSWORD: 'env password 1' }));
    expect(e.login()).toBe('boss');
    e.server.close();
  });
  it('locks out after 5 wrong setup codes', async () => {
    const d = mkdtempSync(join(tmpdir(), 'pc-setup-'));
    const app = await createApp(loadConfig({ DATA_DIR: d, STATIC_DIR: staticDir, SESSION_SECRET: 'x' }));
    await new Promise(ok => app.server.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${app.server.address().port}/setup`;
    const post = code => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, username: 'shop', password: 'long enough 1', password2: 'long enough 1' }) });
    for (let i = 0; i < 5; i++) await post('ZZZZ-ZZZZ');
    expect(await (await post(app.setupCode())).text()).toContain('Too many');
    app.server.close();
  });
});

describe('config and crypto', () => {
  it('starts without a password (first-run setup) but refuses bad ones', () => {
    expect(loadConfig({ DATA_DIR: dir }).passwordHash).toBeNull();
    expect(() => loadConfig({ DATA_DIR: dir, AUTH_PASSWORD: 'short' })).toThrow(/8 characters/);
    expect(() => loadConfig({ DATA_DIR: dir, AUTH_PASSWORD_HASH: 'plain' })).toThrow(/scrypt/);
    expect(loadConfig({ DATA_DIR: dir, AUTH_DISABLED: 'true' }).authDisabled).toBe(true);
  });
  it('accepts a pre-made password hash, in the new and the old form', () => {
    const h = hashPassword(PASSWORD);
    expect(h).toMatch(/^scrypt:32768:8:1:[\w-]+:[\w-]+$/);
    const old = h.replaceAll(':', '$');
    expect(verifyPassword(PASSWORD, old)).toBe(true);
    expect(loadConfig({ DATA_DIR: dir, AUTH_PASSWORD_HASH: old }).passwordHash).toBe(old);
    expect(verifyPassword(PASSWORD, h)).toBe(true);
    expect(verifyPassword('other password', h)).toBe(false);
    expect(loadConfig({ DATA_DIR: dir, AUTH_PASSWORD_HASH: h }).passwordHash).toBe(h);
  });
  it('changing the password signs everyone out', () => {
    const t = sessionSigner('s', hashPassword('first password')).sign('shop', 60);
    expect(sessionSigner('s', hashPassword('second password')).verify(t)).toBeNull();
  });
  it('expired sessions are refused', () => {
    const s = sessionSigner('s', 'h');
    expect(s.verify(s.sign('shop', 60)).u).toBe('shop');
    expect(s.verify(s.sign('shop', -1))).toBeNull();
  });
  it('validatePreset trims names and keeps only plain values', () => {
    expect(validatePreset({ name: '  A   b ', mode: 'cards', settings: { x: '1', y: true, z: 2 } })).toEqual({ name: 'A b', mode: 'cards', settings: { x: '1', y: true, z: 2 } });
  });
});
