// SVG parsing and writing helpers (units, viewBox, ids, paths, flattening).

export const XLINK = 'http://www.w3.org/1999/xlink';
// every element that draws a shape
export const SHAPES = 'path,rect,circle,ellipse,polygon,polyline,line';
// created on use, so the module also loads where there is no DOM (unit tests)
export const ser = { serializeToString: node => new XMLSerializer().serializeToString(node) };
export const PX_PER = { '': 1, px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16 };
export const MM_PER = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6 };
export const num = v => (Math.round(v * 1000) / 1000).toString();
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export function parseLen(v) {
  if (v == null) return null;
  const m = String(v).trim().match(/^([0-9.eE+-]+)\s*(px|mm|cm|in|pt|pc|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isFinite(n) ? { n, unit: m[2] || '' } : null;
}
export function parseSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || !root || root.localName !== 'svg') throw new Error('This file isn’t a readable SVG.');
  return doc;
}
export function readViewBox(root) {
  const vbA = root.getAttribute('viewBox');
  if (vbA) {
    const a = vbA.trim().split(/[\s,]+/).map(Number);
    if (a.length === 4 && a.every(isFinite) && a[2] > 0 && a[3] > 0) return { x: a[0], y: a[1], w: a[2], h: a[3] };
  }
  const wl = parseLen(root.getAttribute('width')), hl = parseLen(root.getAttribute('height'));
  if (wl && hl && wl.unit !== '%' && hl.unit !== '%' && wl.n > 0 && hl.n > 0) return { x: 0, y: 0, w: wl.n * PX_PER[wl.unit], h: hl.n * PX_PER[hl.unit] };
  return null;
}
// Illustrator-style layer id: space -> _, other symbols -> _xHH_ (how scpro2_printonly became scpro2_x5F_printonly).
export const aiId = name => {
  let out = '';
  for (const ch of name) {
    if (/[A-Za-z0-9.-]/.test(ch)) out += ch;
    else if (ch === ' ') out += '_';
    else out += '_x' + ch.codePointAt(0).toString(16).toUpperCase().padStart(2, '0') + '_';
  }
  return /^[A-Za-z_]/.test(out) ? out : '_' + out;
};
// cut outlines as plain paths with inline style (no polygon, no CSS, no data-*), the form SignCut reads
export const pathEl = (pts, closed, style) => `<path d="M${pts.map(q => num(q[0]) + ',' + num(q[1])).join(' L')}${closed ? ' Z' : ''}" style="${style}"/>`;
export const SLOT_RE = /<g\s[^>]*id="__PRINT_SLOT__"[^>]*?(\/>|><\/g>)/;
export const dataUri = text => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
export async function loadImg(text) {
  try {
    const img = new Image();
    img.src = dataUri(text);
    await img.decode();
    return img;
  } catch (e) {
    throw new Error('The browser couldn’t draw this SVG.', { cause: e });
  }
}
export function windowSvg(text, x, y, ww, hh, wpx, hpx) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const r = doc.documentElement;
  r.setAttribute('viewBox', `${x} ${y} ${ww} ${hh}`);
  r.setAttribute('width', wpx); r.setAttribute('height', hpx);
  r.setAttribute('preserveAspectRatio', 'none');
  return ser.serializeToString(doc);
}
export function sizedSvg(text, w, h) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const r = doc.documentElement;
  r.setAttribute('width', w); r.setAttribute('height', h);
  r.setAttribute('preserveAspectRatio', 'none');
  return ser.serializeToString(doc);
}
// Serialize an <svg> root and split it into its start tag and its inner markup,
// so children keep using the namespace prefixes declared on the root.
export function splitRoot(root) {
  const sx = ser.serializeToString(root);
  const i = sx.indexOf('>');
  if (sx[i - 1] === '/') return { open: sx.slice(0, i - 1).trimEnd() + '>', inner: '' };
  return { open: sx.slice(0, i + 1), inner: sx.slice(i + 1, sx.lastIndexOf('</')) };
}
export function prefixCss(css, cp) {
  return css.split(/(url\([^)]*\))/g).map((seg, i) => i % 2
    ? seg.replace(/url\(\s*(['"]?)#/, 'url($1#__P__')
    : seg.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (m, c) => '.' + cp + c)
         .replace(/#(-?[_a-zA-Z][\w-]*)(?=[^{}]*\{)/g, (m, c) => '#__P__' + c)
  ).join('');
}
export function prefixDoc(root, cp) {
  for (const e of [root, ...root.querySelectorAll('*')]) {
    for (const a of Array.from(e.attributes)) {
      const v = a.value; let nv = v;
      if (a.localName === 'id') nv = '__P__' + v;
      else if (a.localName === 'href' && v.startsWith('#')) nv = '#__P__' + v.slice(1);
      else if (a.localName === 'class') nv = v.split(/\s+/).filter(Boolean).map(t => cp + t).join(' ');
      if (nv.includes('url(')) nv = nv.replace(/url\(\s*(['"]?)#/g, 'url($1#__P__');
      if (nv !== v) a.value = nv;
    }
    if (e.localName === 'style') e.textContent = prefixCss(e.textContent, cp);
  }
}
// Flatten an SVG path "d" into polylines: [{pts:[[x,y],...], closed}] in the path's own units.
export function flattenPath(d) {
  const tok = String(d).match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lqx = 0, lqy = 0, prev = '', cur = null;
  const isCmd = t => /^[a-zA-Z]$/.test(t);
  const num = () => parseFloat(tok[i++]);
  const start = (x, y) => { if (cur && cur.pts.length > 1) out.push(cur); cur = { pts: [[x, y]], closed: false }; };
  const line = (x, y) => { if (!cur) start(cx, cy); cur.pts.push([x, y]); };
  const cubic = (x1, y1, x2, y2, x, y) => {
    const n = 16;
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      line(u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y);
    }
  };
  const quad = (x1, y1, x, y) => {
    const n = 12;
    for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; line(u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y); }
  };
  const arc = (rx, ry, phi, fa, fs, x, y) => {
    if (!rx || !ry) { line(x, y); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const c = Math.cos(phi * Math.PI / 180), s = Math.sin(phi * Math.PI / 180);
    const dx = (cx - x) / 2, dy = (cy - y) / 2, x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
    let L = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
    if (L > 1) { rx *= Math.sqrt(L); ry *= Math.sqrt(L); }
    const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let co = Math.sqrt(Math.max(0, num2 / den)); if (fa === fs) co = -co;
    const cxp = co * rx * y1 / ry, cyp = -co * ry * x1 / rx;
    const ccx = c * cxp - s * cyp + (cx + x) / 2, ccy = s * cxp + c * cyp + (cy + y) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
    let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 36)));
    for (let k = 1; k <= n; k++) {
      const t = t1 + dt * k / n;
      line(ccx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, ccy + rx * Math.cos(t) * s + ry * Math.sin(t) * c);
    }
  };
  while (i < tok.length) {
    if (isCmd(tok[i])) cmd = tok[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'Z') {
      if (cur) { cur.closed = true; if (cur.pts.length > 1) out.push(cur); cur = null; }
      cx = sx; cy = sy; prev = 'Z'; cmd = ''; continue;
    }
    if (i >= tok.length || isCmd(tok[i])) { cmd = ''; continue; }
    if (C === 'M') { const x = num() + ox, y = num() + oy; start(x, y); cx = sx = x; cy = sy = y; cmd = rel ? 'l' : 'L'; prev = 'M'; continue; }
    let x1, y1, x2, y2, x, y;
    switch (C) {
      case 'L': x = num() + ox; y = num() + oy; line(x, y); break;
      case 'H': x = num() + ox; y = cy; line(x, y); break;
      case 'V': x = cx; y = num() + (rel ? cy : 0); line(x, y); break;
      case 'C': x1 = num() + ox; y1 = num() + oy; x2 = num() + ox; y2 = num() + oy; x = num() + ox; y = num() + oy; cubic(x1, y1, x2, y2, x, y); lcx = x2; lcy = y2; break;
      case 'S': x1 = /[CS]/.test(prev) ? 2 * cx - lcx : cx; y1 = /[CS]/.test(prev) ? 2 * cy - lcy : cy; x2 = num() + ox; y2 = num() + oy; x = num() + ox; y = num() + oy; cubic(x1, y1, x2, y2, x, y); lcx = x2; lcy = y2; break;
      case 'Q': x1 = num() + ox; y1 = num() + oy; x = num() + ox; y = num() + oy; quad(x1, y1, x, y); lqx = x1; lqy = y1; break;
      case 'T': x1 = /[QT]/.test(prev) ? 2 * cx - lqx : cx; y1 = /[QT]/.test(prev) ? 2 * cy - lqy : cy; x = num() + ox; y = num() + oy; quad(x1, y1, x, y); lqx = x1; lqy = y1; break;
      case 'A': { const rx = num(), ry = num(), ph = num(), fa = num(), fs = num(); x = num() + ox; y = num() + oy; arc(rx, ry, ph, fa ? 1 : 0, fs ? 1 : 0, x, y); break; }
      default: i++; continue;
    }
    cx = x; cy = y; prev = C;
  }
  if (cur && cur.pts.length > 1) out.push(cur);
  return out;
}
// <use> clones (Affinity, Silhouette, Inkscape) become real copies, so every cut line is a plain shape
export function expandUses(doc) {
  const root = doc.documentElement;
  for (let pass = 0; pass < 6; pass++) {
    const uses = Array.from(root.querySelectorAll('use'));
    if (!uses.length) break;
    for (const u of uses) {
      const href = u.getAttribute('href') || u.getAttributeNS(XLINK, 'href') || '';
      const tgt = href.startsWith('#') ? doc.getElementById(href.slice(1)) : null;
      const g = doc.createElementNS(root.namespaceURI, 'g');
      for (const a of Array.from(u.attributes)) if (!/^(x|y|width|height|href|xlink:href|id)$/.test(a.name)) g.setAttribute(a.name, a.value);
      const x = parseFloat(u.getAttribute('x')) || 0, y = parseFloat(u.getAttribute('y')) || 0;
      if (x || y) g.setAttribute('transform', `${u.getAttribute('transform') || ''} translate(${x} ${y})`.trim());
      if (tgt && !tgt.contains(u)) {
        const kids = tgt.localName === 'symbol' ? Array.from(tgt.childNodes) : [tgt];
        for (const k of kids) { const c = k.cloneNode(true); if (c.removeAttribute) c.removeAttribute('id'); g.appendChild(c); }
      }
      u.replaceWith(g);
    }
  }
}
export const decodeLayer = id => id.replace(/_x([0-9A-Fa-f]{2,4})_/g, (m, h) => String.fromCodePoint(parseInt(h, 16)));
export function elementPolys(el) {
  const at = n => parseFloat(el.getAttribute(n)) || 0;
  const ell = (cx, cy, rx, ry) => { const p = []; for (let k = 0; k < 96; k++) { const a = k / 96 * 2 * Math.PI; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return [{ pts: p, closed: true }]; };
  switch (el.localName) {
    case 'path': return flattenPath(el.getAttribute('d') || '');
    case 'rect': { const x = at('x'), y = at('y'), w = at('width'), h = at('height'); return [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }]; }
    case 'circle': return ell(at('cx'), at('cy'), at('r'), at('r'));
    case 'ellipse': return ell(at('cx'), at('cy'), at('rx'), at('ry'));
    case 'line': return [{ pts: [[at('x1'), at('y1')], [at('x2'), at('y2')]], closed: false }];
    default: {
      const a = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number), p = [];
      for (let k = 0; k + 1 < a.length; k += 2) p.push([a[k], a[k + 1]]);
      return [{ pts: p, closed: el.localName === 'polygon' }];
    }
  }
}
export function toHex(c) {
  const m = String(c).match(/[\d.]+/g);
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
  if (/^#/.test(c)) return '#e6007e';
  return m ? '#' + m.slice(0, 3).map(v => Math.round(+v).toString(16).padStart(2, '0')).join('') : '#e6007e';
}
export const pathLen = p => { let L = 0; for (let i = 1; i < p.pts.length; i++) L += Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]); if (p.closed && p.pts.length > 2) L += Math.hypot(p.pts[0][0] - p.pts[p.pts.length - 1][0], p.pts[0][1] - p.pts[p.pts.length - 1][1]); return L; };
