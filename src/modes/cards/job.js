// The PDF jobs of the card modes, the sheets they print on, and the fixed data of each mode.
import { byId } from '../../dom.js';
import { state } from '../../state.js';

// The card modes each keep their own PDF job, so switching between them loses nothing. state.job is the open one's.
export const PRINT_MODES = ['cards', 'vouchers', 'winietka', 'guillotine', 'deck', 'morgana'];
// items: the cards of a winietki job (one PDF page each); imgSrc: the pictures a job was made from, if any
const newPrintJob = () => ({ imgSrc: null, name: null, bytes: null, pages: 0, pageW: 0, pageH: 0, mbx: 0, mby: 0, previews: [], layout: null, bleed: null, items: [] });
export const kinds = Object.fromEntries([...PRINT_MODES, 'gang'].map(m => [m, newPrintJob()]));
state.job = kinds.cards;
export function isPrintMode() { return PRINT_MODES.includes(state.mode); }
// guillotine sheet (also the card deck): chosen under Sheet; print sheets mode stays on 310 × 440
function gSheetMm() {
  if (state.mode === 'gang') return [310, 440];
  const sel = document.getElementById('gPage').value;
  if (sel === 'custom') {
    const w = parseFloat(document.getElementById('gPageW').value), h = parseFloat(document.getElementById('gPageH').value);
    return [isFinite(w) && w >= 50 ? w : 310, isFinite(h) && h >= 50 ? h : 440];
  }
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(sel);
  return m ? [+m[1], +m[2]] : [310, 440];
}
export const G_PAGE = { get wMm() { return gSheetMm()[0]; }, get hMm() { return gSheetMm()[1]; } };
byId('gPage').addEventListener('change', () => { byId('rowGPageCustom').hidden = byId('gPage').value !== 'custom'; });
const SIZES = { A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148], DL: [99, 210] };
// guillotine: print the PDF scaled to a standard size (orientation follows the PDF)
export function pageScale(o) {
  if ((state.mode !== 'guillotine' && state.mode !== 'deck') || !state.job.bytes) return 1;
  if (o.gSize === 'custom') return Math.max(0.05, o.gScale / 100);
  const t = SIZES[o.gSize];
  const sw = state.job.pageW - 2 * o.cBleed, sh = state.job.pageH - 2 * o.cBleed;
  if (!t || sw <= 0 || sh <= 0) return 1;
  const [a, b] = sw >= sh ? [t[1], t[0]] : t;
  return Math.min(a / sw, b / sh);
}
// the sheet the open mode prints on
export function pageDims() {
  if (state.mode === 'guillotine' || state.mode === 'gang' || state.mode === 'deck') return G_PAGE;
  if (state.mode === 'morgana') return M_PAGE;
  return { wMm: state.template.wMm, hMm: state.template.hMm };
}
// Morgana CardXtra SRA3 template (calibrated, 20-up): 90 × 50 slot trims and the reading mark, taken 1:1 from the template PDF.
export const M_PAGE = { wMm: 450, hMm: 320 };
export const M_TPL = {
  cols: [17.891, 118.479, 219.067, 319.74], rows: [12.944, 72.944, 132.943, 192.943, 252.944],
  backCols: [17.9, 118.5, 219.1, 319.7], backRows: [17.012, 77.012, 137.012, 197.012, 257.012],
  mark: [6.011, 145.034, 7.959, 29.972], w: 90, h: 50
};
export const deckPer = () => state.mode === 'deck' ? 2 : 1;
export const KIND = {
  cards: { title: 'Business cards', one: 'card', many: 'cards', file: 'business-cards', hint: 'One PDF: page 1 is the front, page 2 the back, both with bleed (e.g. 94 × 54 mm for a 90 × 50 card). Or one or two images (PNG, JPG, WebP…): front, then back. You can also drop them on the sheet.' },
  morgana: { title: 'Morgana CardXtra', one: 'card', many: 'cards', file: 'morgana', hint: 'One PDF of a 90 × 55, 90 × 50 or 85 × 55 card (set the cut size) with bleed: page 1 the front, page 2 the back. Or one or two images (front, back): they are cut at the CardXtra size, at 100 % from their dpi. Imposed 20-up on SRA3 (450 × 320) on the CardXtra template slots, each card in the bottom-left corner of its slot, with the black reading mark on both sides. You can also drop it on the sheet.' },
  winietka: { title: 'Winietki', one: 'card', many: 'cards', file: 'winietki', hint: 'Add one or more PDFs, every page one winietka (all the same size, with bleed), or make them from a list of names. Single-sided, printed on the sheet with registration marks and cut with straight lines like business cards; every sheet uses the same PLT. You can also drop the PDFs on the sheet.' },
  deck: { title: 'Card deck', one: 'card', many: 'cards', file: 'deck', hint: 'One multi-page PDF with bleed: pages 1 and 2 are the front and back of card 1, pages 3 and 4 card 2, and so on. Set how many complete sets you need; you get double-sided sheets (310 × 440 or the size chosen under Sheet) with crop marks. You can also drop it on the sheet.' },
  guillotine: { title: 'Guillotine', one: 'copy', many: 'copies', file: 'guillotine', hint: 'One PDF with bleed: page 1 the front, page 2 the back (optional). Copies are laid out on the chosen sheet (310 × 440 by default) with crop marks for the guillotine. A multi-page PDF of different one-sided cards: set PDF pages to “every page a separate card”. You can also drop it on the sheet.' },
  vouchers: { title: 'Vouchers', one: 'voucher', many: 'vouchers', file: 'vouchers', hint: 'One PDF of the opened-out voucher: page 1 the outside, page 2 the inside, with bleed. The fold is perforated across the long side. You can also drop it on the sheet.' }
};
// a multi-page job laid out card by card: the card deck (front + back per card) or the guillotine with
// "every page a separate card" (one page per card, one-sided)
export const deckLike = () => state.mode === 'deck' || (state.mode === 'guillotine' && document.getElementById('gPages').value === 'each');
