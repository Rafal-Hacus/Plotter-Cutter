// Login: scrypt password hashes, HMAC-signed session cookies, and a per-address limit on failed logins.
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

// Stored form: scrypt:N:r:p:salt:hash (salt and hash in base64url). No $ signs, so it survives env files and
// Compose/Portainer variable substitution unquoted. The older scrypt$N$r$p$salt$hash form is still accepted.
export function hashPassword(password, salt = randomBytes(16)) {
  const h = scryptSync(String(password).normalize('NFKC'), salt, KEYLEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), h.toString('base64url')].join(':');
}
export function verifyPassword(password, stored) {
  const parts = String(stored).trim().split(/[:$]/);
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, 'base64url');
  let got;
  try { got = scryptSync(String(password).normalize('NFKC'), Buffer.from(salt, 'base64url'), want.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem }); }
  catch { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}
export const isPasswordHash = s => /^scrypt([:$])\d+\1\d+\1\d+\1[\w-]+\1[\w-]+$/.test(String(s).trim());

// Constant-time string comparison (for user names).
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Session token: base64url(JSON {u, exp}) . HMAC. The key includes the password hash, so changing the
// password signs everyone out.
export function sessionSigner(secret, passwordHash) {
  const key = createHmac('sha256', secret).update(passwordHash).digest();
  const mac = data => createHmac('sha256', key).update(data).digest('base64url');
  return {
    sign(user, maxAgeSec) {
      const data = Buffer.from(JSON.stringify({ u: user, exp: Math.floor(Date.now() / 1000) + maxAgeSec })).toString('base64url');
      return `${data}.${mac(data)}`;
    },
    verify(token) {
      const [data, sig] = String(token || '').split('.');
      if (!data || !sig || !safeEqual(sig, mac(data))) return null;
      try {
        const v = JSON.parse(Buffer.from(data, 'base64url').toString());
        return v && typeof v.u === 'string' && v.exp > Date.now() / 1000 ? v : null;
      } catch { return null; }
    }
  };
}

// After `max` failures within `windowMs` an address is locked out for `windowMs`.
export function loginLimiter({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const fails = new Map(); // ip -> { n, until, first }
  const sweep = () => { const now = Date.now(); for (const [k, v] of fails) if (now - v.first > windowMs && now > v.until) fails.delete(k); };
  setInterval(sweep, 60_000).unref();
  return {
    blocked(ip) { const f = fails.get(ip); return !!f && Date.now() < f.until; },
    fail(ip) {
      const now = Date.now();
      let f = fails.get(ip);
      if (!f || now - f.first > windowMs) f = { n: 0, until: 0, first: now };
      f.n++;
      if (f.n >= max) f.until = now + windowMs;
      fails.set(ip, f);
    },
    succeed(ip) { fails.delete(ip); }
  };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { const k = part.slice(0, i).trim(); if (!(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim()); }
  }
  return out;
}
