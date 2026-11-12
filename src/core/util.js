// Small shared utilities.

export const tick = () => new Promise(r => setTimeout(r, 0));
export const asciiOnly = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^\x20-\x7e]/g, '?');
// what a file is, by its name or the type the browser gives it
export const isPdfFile = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
export const isImageFile = f => /^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);
