// HTTP server: the built app behind a login, plus the saved-settings API.
// No framework and no runtime dependencies: only Node's own modules.
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, isPasswordHash, safeEqual, sessionSigner, loginLimiter, parseCookies } from './auth.js';
import { openStore, ValidationError } from './store.js';
import { staticHandler } from './static.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COOKIE = 'pc_session';

const bool = v => /^(1|true|yes|on)$/i.test(String(v || ''));
export function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || join(HERE, '..', 'data');
  const authDisabled = bool(env.AUTH_DISABLED);
  let password = env.AUTH_PASSWORD;
  if (!password && env.AUTH_PASSWORD_FILE) password = readFileSync(env.AUTH_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
  let passwordHash = env.AUTH_PASSWORD_HASH || null;
  if (passwordHash && !isPasswordHash(passwordHash)) throw new Error('AUTH_PASSWORD_HASH is not a scrypt hash; make one with: node server/hash-password.js');
  if (!passwordHash && password) {
    if (password.length < 8) throw new Error('AUTH_PASSWORD must be at least 8 characters.');
    passwordHash = hashPassword(password);
  }
  if (!passwordHash && !authDisabled) throw new Error('Set AUTH_PASSWORD, AUTH_PASSWORD_FILE or AUTH_PASSWORD_HASH (or AUTH_DISABLED=true for local development only).');
  return {
    port: +(env.PORT || 8080), host: env.HOST || '0.0.0.0', dataDir,
    staticDir: env.STATIC_DIR || join(HERE, '..', 'dist'),
    username: env.AUTH_USERNAME || 'admin', passwordHash, authDisabled,
    // kept only to derive a stable session key (the stored hash gets a new random salt on every start)
    password: password || null,
    sessionSecret: env.SESSION_SECRET || null, sessionDays: Math.max(1, +(env.SESSION_DAYS || 30)),
    cookieSecure: bool(env.COOKIE_SECURE), trustProxy: bool(env.TRUST_PROXY)
  };
}

// a secret kept in the data folder, so sessions survive restarts
function sessionSecret(cfg) {
  if (cfg.sessionSecret) return cfg.sessionSecret;
  const f = join(cfg.dataDir, 'session-secret');
  if (!existsSync(f)) { mkdirSync(cfg.dataDir, { recursive: true }); writeFileSync(f, randomBytes(32).toString('base64url'), { mode: 0o600 }); }
  return readFileSync(f, 'utf8').trim();
}

const APP_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
  "img-src 'self' data: blob:", "connect-src 'self' data: blob:", "worker-src 'self' blob:",
  "object-src 'none'", "frame-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"
].join('; ');
const LOGIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export async function createApp(cfg) {
  const store = await openStore(join(cfg.dataDir, 'presets.json'));
  const secret = sessionSecret(cfg);
  // Sessions are tied to the password: a new password signs everyone out, a restart doesn't.
  const pwKey = cfg.password ? hashPassword(cfg.password, createHash('sha256').update(secret).digest().subarray(0, 16)) : cfg.passwordHash || 'no-auth';
  const signer = sessionSigner(secret, pwKey);
  const limiter = loginLimiter();
  const serveStatic = staticHandler(cfg.staticDir);
  const loginPage = readFileSync(join(HERE, 'login.html'), 'utf8');
  const maxAge = cfg.sessionDays * 86400;

  const clientIp = req => (cfg.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  const userOf = req => cfg.authDisabled ? 'local' : (signer.verify(parseCookies(req.headers.cookie)[COOKIE]) || {}).u || null;
  const cookie = (value, age) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${cfg.cookieSecure ? '; Secure' : ''}`;

  const headers = (res, csp) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (csp) res.setHeader('Content-Security-Policy', csp);
    if (cfg.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  };
  const send = (res, status, body, type = 'text/plain; charset=utf-8') => { res.statusCode = status; res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-store'); res.end(body); };
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
  const redirect = (res, to) => { res.statusCode = 303; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); };

  const readBody = (req, limit) => new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { fail(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
  // state-changing requests must come from this site's own pages
  const sameOrigin = req => {
    const o = req.headers.origin || req.headers.referer;
    if (!o) return true; // not a browser cross-site request (curl, scripts with the cookie)
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  };

  async function api(req, res, path, user) {
    const m = req.method;
    if (m !== 'GET' && m !== 'HEAD') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-site request refused.' });
      if ((m === 'POST' || m === 'PUT') && !/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Send JSON.' });
    }
    const body = async () => { const t = await readBody(req, 256 * 1024); try { return JSON.parse(t); } catch { throw new ValidationError('Invalid JSON.'); } };
    if (path === '/api/me' && m === 'GET') return json(res, 200, { user, authDisabled: cfg.authDisabled });
    if (path === '/api/presets' && m === 'GET') return json(res, 200, { presets: store.list(), defaultId: store.defaultId() });
    if (path === '/api/presets' && m === 'POST') return json(res, 201, await store.create(await body(), user));
    if (path === '/api/default' && m === 'PUT') {
      const b = await body(), id = b && b.id === null ? null : String((b && b.id) || '');
      return (await store.setDefault(id)) ? json(res, 200, { defaultId: id }) : json(res, 404, { error: 'No such saved setting.' });
    }
    const pm = /^\/api\/presets\/([0-9a-f-]{36})$/.exec(path);
    if (pm) {
      const id = pm[1];
      if (m === 'GET') { const p = store.get(id); return p ? json(res, 200, p) : json(res, 404, { error: 'No such saved setting.' }); }
      if (m === 'PUT') { const p = await store.update(id, await body(), user); return p ? json(res, 200, p) : json(res, 404, { error: 'No such saved setting.' }); }
      if (m === 'DELETE') return (await store.remove(id)) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'No such saved setting.' });
    }
    return json(res, 404, { error: 'Not found.' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x'), path = url.pathname;
    headers(res, path === '/login' ? LOGIN_CSP : APP_CSP);
    if (path === '/healthz') return send(res, 200, 'ok');

    if (path === '/login') {
      if (cfg.authDisabled) return redirect(res, './');
      if (req.method === 'GET') {
        if (userOf(req)) return redirect(res, './');
        const err = url.searchParams.get('e');
        const msg = err === 'locked' ? 'Too many failed attempts. Try again in 15 minutes.' : err ? 'Wrong user name or password.' : '';
        return send(res, 200, loginPage.replace('<!--ERROR-->', msg ? `<p class="err" role="alert">${msg}</p>` : ''), 'text/html; charset=utf-8');
      }
      if (req.method === 'POST') {
        if (!sameOrigin(req)) return send(res, 403, 'Cross-site request refused.');
        const ip = clientIp(req);
        if (limiter.blocked(ip)) return redirect(res, 'login?e=locked');
        const form = new URLSearchParams(await readBody(req, 4096));
        const okUser = safeEqual(form.get('username') || '', cfg.username);
        const okPass = verifyPassword(form.get('password') || '', cfg.passwordHash); // always run, so timing doesn't reveal the user name
        if (!(okUser && okPass)) { limiter.fail(ip); return redirect(res, limiter.blocked(ip) ? 'login?e=locked' : 'login?e=1'); }
        limiter.succeed(ip);
        res.setHeader('Set-Cookie', cookie(signer.sign(cfg.username, maxAge), maxAge));
        return redirect(res, './');
      }
      return send(res, 405, 'Method not allowed');
    }
    if (path === '/logout') {
      if (req.method !== 'POST') return send(res, 405, 'Method not allowed');
      if (!sameOrigin(req)) return send(res, 403, 'Cross-site request refused.');
      res.setHeader('Set-Cookie', cookie('', 0));
      return redirect(res, 'login');
    }

    const user = userOf(req);
    if (!user) {
      if (path.startsWith('/api/')) return json(res, 401, { error: 'Sign in first.' });
      const wantsPage = req.method === 'GET' && (path === '/' || path.endsWith('.html')) || /text\/html/.test(req.headers.accept || '');
      return wantsPage ? redirect(res, path === '/' ? 'login' : '/login') : send(res, 401, 'Sign in first.');
    }
    if (path.startsWith('/api/')) return api(req, res, path, user);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (await serveStatic(req, res, path)) return;
    return send(res, 404, 'Not found');
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(e => {
      if (e instanceof ValidationError) return json(res, 400, { error: e.message });
      if (e.status === 413) return res.headersSent ? res.end() : json(res, 413, { error: 'Too large.' });
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'Server error.' }); else res.end();
    });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  return { server, store };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let cfg;
  try { cfg = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }
  if (cfg.authDisabled) console.warn('WARNING: AUTH_DISABLED is set: anyone who can reach this server can use it and change saved settings.');
  if (!existsSync(join(cfg.staticDir, 'index.html'))) console.warn(`No built app in ${cfg.staticDir}; run "npm run build" first.`);
  const { server, store } = await createApp(cfg);
  server.listen(cfg.port, cfg.host, () => console.log(`Listening on http://${cfg.host}:${cfg.port} (user "${cfg.username}", data in ${cfg.dataDir})`));
  const stop = () => { server.close(); store.flush().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
