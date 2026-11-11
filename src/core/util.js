// Small shared utilities.

export const tick = () => new Promise(r => setTimeout(r, 0));
export const asciiOnly = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^\x20-\x7e]/g, '?');
