// The page: the elements the modes share, the message line, and saving a file.
export const $ = s => document.querySelector(s);
export const byId = id => document.getElementById(id);
// every preview shows where the knife or guillotine will cut in the same red (exports keep the colours set under Cut lines)
export const CUT_RED = '#E0262B';
export const ui = {
  files: $('#files'), list: $('#list'), stage: $('#stage'), count: $('#count'), msg: $('#msg'),
  dropNote: $('#dropNote'), sheetInfo: $('#sheetInfo'), dpiRow: $('#dpiRow'), tplFile: $('#tplFile'), tplReset: $('#tplReset'),
  exAll: $('#exAll'), exPrint: $('#exPrint'), exCut: $('#exCut'), exPlt: $('#exPlt'), showArt: $('#showArt')
};
// the sticker list before anything is added
export const EMPTY_LIST = '<li class="empty">No stickers yet.</li>';
// the line under the sheet count: notes about the layout, or a warning
export function setMsg(text, warn) { ui.msg.textContent = text; ui.msg.className = 'msg' + (warn ? ' warn' : ''); }
// Offer a file for download. content: a Blob, or text (saved as SVG).
export function saveFile(name, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// "Sheet 1 of n" choices of a sheet picker, keeping the chosen sheet when it still exists
export function fillSheetPicker(sel, sheets) {
  const cur = +sel.value || 0, n = Math.max(1, sheets);
  sel.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i}">Sheet ${i + 1} of ${n}</option>`).join('');
  sel.value = String(cur < n ? cur : 0);
}
// "1 card" / "3 cards"
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
