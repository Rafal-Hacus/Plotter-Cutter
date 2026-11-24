// Numbers as people type them into the fields: a decimal comma (100,5) or point, spaces (1 370), a typographic
// minus. Pure functions, used by the field layer (src/numfield.js) and the settings (src/settings.js).

// the text with spaces dropped, a comma as the decimal point and − as a minus: what the field is set to while typing
export const normalizeNum = s => String(s ?? '').replace(/\s/g, '').replace(/,/g, '.').replace(/[\u2212\u2013]/g, '-'); // \s takes no-break spaces too

// the number in a field's text, or NaN when it is empty or not one number ("1.000,5" and "12abc" are NaN, not 1 or 12)
export function parseNum(s) {
  const t = normalizeNum(s);
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

// a number written back into a field: at most the step's decimals, no trailing zeros
const decimals = x => { const m = String(x).match(/\.(\d+)/); return m ? m[1].length : 0; };
const tidy = (x, d) => String(Number(x.toFixed(Math.min(10, d))));

// What the arrow keys make of a field: one step up (dir 1) or down (-1) on the grid of the step counted from the
// lowest value (as number fields do), kept within min..max. An empty or unreadable field starts from the lowest value.
export function stepNum(text, dir, { min = NaN, max = NaN, step = 1 } = {}) {
  const st = step > 0 ? step : 1, base = isFinite(min) ? min : 0, d = Math.max(decimals(st), decimals(base));
  let v = parseNum(text);
  if (!isFinite(v)) v = isFinite(min) ? min : 0;
  else {
    const k = (v - base) / st;
    v = base + st * (dir > 0 ? Math.floor(k + 1e-9) + 1 : Math.ceil(k - 1e-9) - 1);
  }
  if (isFinite(max)) v = Math.min(max, v);
  if (isFinite(min)) v = Math.max(min, v);
  return tidy(v, d);
}

// Whether a field's text is a usable value. { ok: true } or { ok: false, text: the reason, near: the nearest allowed
// value when the number is out of range }. An empty field is fine when `blankOk` (the code then uses its own default).
export function checkNum(text, { min = NaN, max = NaN, blankOk = true, unit = '' } = {}) {
  const u = unit ? ' ' + unit : '';
  const range = isFinite(min) && isFinite(max) ? `${min}–${max}${u}` : isFinite(min) ? `at least ${min}${u}` : isFinite(max) ? `at most ${max}${u}` : '';
  if (normalizeNum(text) === '') return blankOk ? { ok: true } : { ok: false, text: `Empty: enter a number${range ? ` (${range})` : ''}.` };
  const v = parseNum(text);
  if (!isFinite(v)) return { ok: false, text: `“${String(text).trim()}” is not a number${range ? ` (allowed: ${range})` : ''}.` };
  if (isFinite(min) && v < min) return { ok: false, near: min, text: `${v} is below the lowest allowed value: ${range}. It would be cut to ${min}${u}; nothing is exported until fixed.` };
  if (isFinite(max) && v > max) return { ok: false, near: max, text: `${v} is above the highest allowed value: ${range}. It would be cut to ${max}${u}; nothing is exported until fixed.` };
  return { ok: true };
}
