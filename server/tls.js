// HTTPS for the LAN: browsers only allow the graphics card (WebGPU) and multi-core WebAssembly on secure pages,
// so over plain http://<ip> the in-browser AI is stuck on one processor core.
// Either your own certificate (TLS_CERT_FILE / TLS_KEY_FILE) or a self-signed one made here on first start and
// kept in <data>/tls (made again when the host names change). Pure Node: no openssl needed.
import { generateKeyPairSync, createPrivateKey, sign, randomBytes, X509Certificate } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isIP } from 'node:net';

// ---- a little DER (ASN.1) ----
const len = n => n < 128 ? Buffer.from([n]) : (b => Buffer.concat([Buffer.from([0x80 | b.length]), b]))(Buffer.from(n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0'), 'hex'));
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p) => tlv(0x30, ...p), set = (...p) => tlv(0x31, ...p);
const oid = s => {
  const a = s.split('.').map(Number), out = [40 * a[0] + a[1]];
  for (const v of a.slice(2)) { const b = []; let x = v; do { b.unshift(x & 0x7f); x >>= 7; } while (x); for (let i = 0; i < b.length - 1; i++) b[i] |= 0x80; out.push(...b); }
  return tlv(0x06, Buffer.from(out));
};
const int = buf => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const utf8 = s => tlv(0x0c, Buffer.from(s, 'utf8'));
const time = d => { const s = d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'; return tlv(0x17, Buffer.from(s)); }; // UTCTime
const bits = buf => tlv(0x03, Buffer.from([0]), buf);
const octets = buf => tlv(0x04, buf);
const ctx = (n, ...p) => tlv(0xa0 | n, ...p);
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), octets(value));
const ipBytes = ip => isIP(ip) === 4 ? Buffer.from(ip.split('.').map(Number)) : Buffer.from(ip.split(':').length < 8 ? expand6(ip) : ip.split(':').flatMap(h => [parseInt(h || '0', 16) >> 8, parseInt(h || '0', 16) & 255]));
function expand6(ip) { const [a, b] = ip.split('::'), A = a ? a.split(':') : [], B = b ? b.split(':') : [], full = [...A, ...Array(8 - A.length - B.length).fill('0'), ...B]; return full.flatMap(h => [parseInt(h, 16) >> 8, parseInt(h, 16) & 255]); }

// A self-signed server certificate (EC P-256, SHA-256) for the given host names / IP addresses.
// Valid 825 days: the longest Apple devices accept for a server certificate.
export function selfSignedCert(hosts, days = 825) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const name = seq(set(seq(oid('2.5.4.3'), utf8('Plotter Cutter'))), set(seq(oid('2.5.4.10'), utf8('Plotter Cutter (self-signed)'))));
  const sigAlg = seq(oid('1.2.840.10045.4.3.2'));
  const now = new Date(Date.now() - 60_000), until = new Date(now.getTime() + days * 86400_000);
  const san = seq(...hosts.map(h => isIP(h) ? tlv(0x87, ipBytes(h)) : tlv(0x82, Buffer.from(h, 'ascii'))));
  const tbs = seq(
    ctx(0, int(Buffer.from([2]))),
    int(Buffer.concat([Buffer.from([0x40 | (randomBytes(1)[0] & 0x3f)]), randomBytes(15)])),
    sigAlg, name, seq(time(now), time(until)), name,
    publicKey.export({ type: 'spki', format: 'der' }),
    ctx(3, seq(
      ext('2.5.29.19', true, seq()),                                 // basicConstraints: not a CA
      ext('2.5.29.15', true, bits(Buffer.from([0x80]))),             // keyUsage: digitalSignature
      ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),        // extKeyUsage: serverAuth
      ext('2.5.29.17', false, san)                                   // subjectAltName
    ))
  );
  const cert = seq(tbs, sigAlg, bits(sign('sha256', tbs, privateKey)));
  const pem = '-----BEGIN CERTIFICATE-----\n' + cert.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  return { cert: pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// { cert, key, selfSigned, hosts } for the server, or null when HTTPS is off
export function loadTls(cfg) {
  if (cfg.tls === 'off') return null;
  if (cfg.tlsCertFile && cfg.tlsKeyFile) {
    const cert = readFileSync(cfg.tlsCertFile, 'utf8'), key = readFileSync(cfg.tlsKeyFile, 'utf8');
    createPrivateKey(key); new X509Certificate(cert); // fail early on a bad file
    return { cert, key, selfSigned: false, hosts: [] };
  }
  const dir = join(cfg.dataDir, 'tls'), hosts = [...new Set(['localhost', '127.0.0.1', ...cfg.tlsHosts])];
  const cf = join(dir, 'cert.pem'), kf = join(dir, 'key.pem'), hf = join(dir, 'hosts.json');
  const same = existsSync(cf) && existsSync(kf) && existsSync(hf) && JSON.stringify(JSON.parse(readFileSync(hf, 'utf8'))) === JSON.stringify(hosts);
  let expired = false;
  if (same) { try { expired = new Date(new X509Certificate(readFileSync(cf)).validTo) < new Date(Date.now() + 30 * 86400_000); } catch { expired = true; } }
  if (!same || expired) {
    mkdirSync(dir, { recursive: true });
    const { cert, key } = selfSignedCert(hosts);
    writeFileSync(kf, key, { mode: 0o600 }); writeFileSync(cf, cert, { mode: 0o644 }); writeFileSync(hf, JSON.stringify(hosts), { mode: 0o600 });
  }
  return { cert: readFileSync(cf, 'utf8'), key: readFileSync(kf, 'utf8'), selfSigned: true, hosts };
}
