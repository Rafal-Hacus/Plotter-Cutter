/* ---------- state ---------- */
export const $ = s => document.querySelector(s);
// every preview shows where the knife or guillotine will cut in the same red (exports keep the colours set under Cut lines)
export const CUT_RED = '#E0262B';
export const ui = {
  files: $('#files'), list: $('#list'), stage: $('#stage'), count: $('#count'), msg: $('#msg'),
  dropNote: $('#dropNote'), sheetInfo: $('#sheetInfo'), dpiRow: $('#dpiRow'), tplFile: $('#tplFile'), tplReset: $('#tplReset'),
  exAll: $('#exAll'), exPrint: $('#exPrint'), exCut: $('#exCut'), exPlt: $('#exPlt'), showArt: $('#showArt'), lgKiss: $('#lgKiss'), lgDie: $('#lgDie')
};
export function setCardMsg(text, warn) { ui.msg.textContent = text; ui.msg.className = 'msg' + (warn ? ' warn' : ''); }
