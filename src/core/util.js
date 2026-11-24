// Small shared utilities.

export const tick = () => new Promise(r => setTimeout(r, 0));
export const asciiOnly = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^\x20-\x7e]/g, '?');
// a job's name as the start of a file name: ASCII only (no diacritics), spaces and other signs as _, at most 40
// characters, the extension of a file name left out ('Wino Teresy 14,5cm_cut.pdf' -> 'Wino_Teresy_14_5cm_cut')
export function fileSlug(s) {
  const t = asciiOnly(String(s || '').replace(/\.[a-z0-9]{1,4}$/i, '')).replace(/[^A-Za-z0-9-]+/g, '_').replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
  return t.slice(0, 40).replace(/[_-]+$/, '');
}
// what a file is, by its name or the type the browser gives it
export const isPdfFile = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
export const isImageFile = f => /^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);
