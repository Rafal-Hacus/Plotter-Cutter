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
// An empty list's line: while the last job is offered (see jobstore.js) it points at the offer instead
export const restoreHint = { on: false, text: 'Your last work can be brought back: see the bar over the sheet.' };
export function emptyItem(text) { return `<li class="empty" data-text="${text}">${restoreHint.on ? restoreHint.text : text}</li>`; }
export const EMPTY_LIST = emptyItem('No stickers yet.');
// the line under the sheet count: notes about the layout, or a warning
export function setMsg(text, warn) { ui.msg.textContent = text; ui.msg.className = 'msg' + (warn ? ' warn' : ''); }
// What a saved file is for, by its name (the kind suffixes the shop knows: print / plt / kiss / die / cut).
export function filePurpose(name) {
  const n = name.toLowerCase();
  if (/\.xs$/.test(n)) return 'for the xTool laser';
  if (/(batch|test-cut)/.test(n) && /\.zip$/.test(n)) return 'for the printer and the Skycut cutting machine';
  if (/(podglad|proof)/.test(n)) return 'a proof to check on paper';
  if (/(plt|kiss|die|-cut|-draw)/.test(n)) return 'for the Skycut cutting machine';
  return 'for the printer';
}
// the job's name put in front of every file name (set by jobstore.js: the first file's name, or a stamp's first line)
let fileNamer = name => name;
export function setFileNamer(fn) { fileNamer = fn; }
// "Saved: …" shown for a while after each save, over the page (the message line is rewritten by the next layout run)
let savedTimer = 0;
function savedNote(name, kind) {
  let el = byId('savedNote');
  if (!el) {
    el = document.createElement('div'); el.id = 'savedNote'; el.className = 'savednote'; el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = `Saved: ${name} — ${filePurpose(kind)}`;
  el.hidden = false;
  clearTimeout(savedTimer); savedTimer = setTimeout(() => { el.hidden = true; }, 12000);
}
// Offer a file for download. content: a Blob, or text (saved as SVG). plain: a file not of the open job (a test cut,
// PLTs modified): no job name in front
export function saveFile(name, content, { plain = false } = {}) {
  const kind = name; if (!plain) name = fileNamer(name);
  const blob = content instanceof Blob ? content : new Blob([content], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  savedNote(name, kind);
}
// "Sheet 1 of n" choices of a sheet picker, keeping the chosen sheet when it still exists
export function fillSheetPicker(sel, sheets) {
  const cur = +sel.value || 0, n = Math.max(1, sheets);
  sel.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i}">Sheet ${i + 1} of ${n}</option>`).join('');
  sel.value = String(cur < n ? cur : 0);
}
// "1 card" / "3 cards"
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
