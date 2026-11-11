// Sanitizer for untrusted SVG files.
// Keep only SVG drawing content: no scripts, no embedded HTML (foreignObject, iframes…), no event handlers,
// no links or references outside the file except embedded data: images, and no external CSS
// (@import / url(http…)). Runs before any SVG touches the live document.

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const BAD_TAGS = /^(script|foreignobject|iframe|frame|frameset|object|embed|applet|audio|video|source|track|canvas|link|meta|base|form|input|button|textarea|select|portal|handler|listener)$/i;
// Browsers ignore control characters and spaces inside URLs ("java\tscript:" still runs), so they are
// removed before any URL is checked.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000- ]+/g;
const stripControl = v => String(v).replace(CONTROL, '');

export const safeRef = (v, el) => {
  const t = stripControl(v);
  if (t.startsWith('#')) return true;
  return el.localName === 'image' && /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml)[;,]/i.test(t);
};
export const cleanCss = css => String(css)
  .replace(/@import[^;]*;?/gi, '')
  .replace(/url\(\s*(['"]?)(?!\s*#|\s*data:image\/)[^)]*\)/gi, 'none')
  .replace(/expression\s*\(/gi, '(');

export function sanitize(doc) {
  const root = doc.documentElement;
  for (const e of Array.from(root.querySelectorAll('*'))) {
    if (!e.isConnected) continue;
    if (BAD_TAGS.test(e.localName) || (e.namespaceURI && e.namespaceURI !== SVG_NS)) { e.remove(); continue; }
    // animations can rewrite links or handlers after the fact
    if (/^(set|animate|animateTransform|animateMotion|discard)$/i.test(e.localName)) {
      const an = (e.getAttribute('attributeName') || '').toLowerCase();
      if (!an || /^(on|href|xlink:href|style|values|from|to|begin)/.test(an) || e.localName === 'set' || e.localName === 'discard') { e.remove(); continue; }
    }
    if (e.localName === 'style') e.textContent = cleanCss(e.textContent);
  }
  for (const e of [root, ...root.querySelectorAll('*')]) {
    for (const a of Array.from(e.attributes)) {
      const n = a.name.toLowerCase(), v = a.value;
      if (/^on/.test(n) || /^(javascript|vbscript|data:text)/i.test(stripControl(v))) { e.removeAttributeNode(a); continue; }
      if (a.localName === 'href' || n === 'src') { if (!safeRef(v, e)) e.removeAttributeNode(a); continue; }
      if (n === 'style' || /url\(/i.test(v)) { const c = cleanCss(v); if (c !== v) a.value = c; }
    }
  }
}
