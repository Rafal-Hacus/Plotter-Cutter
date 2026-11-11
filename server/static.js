// Serves the built app from one folder. Only plain files inside that folder; no dotfiles, no directory listings.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf', '.icc': 'application/vnd.iccprofile', '.txt': 'text/plain; charset=utf-8'
};

export function staticHandler(rootDir) {
  const root = resolve(rootDir);
  return async function serve(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return false; }
    if (rel.includes('\0')) return false;
    rel = normalize(rel).replace(/^([/\\])+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    if (rel.split(/[/\\]/).some(seg => seg.startsWith('.'))) return false;
    const file = resolve(root, rel);
    if (file !== root && !file.startsWith(root + sep)) return false;
    let st;
    try { st = await stat(file); } catch { return false; }
    if (!st.isFile()) return false;
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', st.size);
    // hashed build files never change; everything else is checked every time
    res.setHeader('Cache-Control', /^assets[/\\]/.test(rel) ? 'private, max-age=31536000, immutable' : 'no-cache');
    if (req.method === 'HEAD') { res.end(); return true; }
    await new Promise((ok, fail) => createReadStream(file).on('error', fail).on('end', ok).pipe(res));
    return true;
  };
}
