import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
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

describe('config and crypto', () => {
  it('needs a password unless auth is explicitly disabled', () => {
    expect(() => loadConfig({ DATA_DIR: dir })).toThrow(/AUTH_PASSWORD/);
    expect(() => loadConfig({ DATA_DIR: dir, AUTH_PASSWORD: 'short' })).toThrow(/8 characters/);
    expect(() => loadConfig({ DATA_DIR: dir, AUTH_PASSWORD_HASH: 'plain' })).toThrow(/scrypt/);
    expect(loadConfig({ DATA_DIR: dir, AUTH_DISABLED: 'true' }).authDisabled).toBe(true);
  });
  it('accepts a pre-made password hash', () => {
    const h = hashPassword(PASSWORD);
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
