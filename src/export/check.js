// "Will be written": one short line per file next to the export buttons, with the values exactly as the file will
// carry them (the PLT header's force and speed after the plotter's limits, the blade offset and overcut the cut is
// compensated with, the sheet, the count), so what goes to the cutter is never only in a field further up.
import { speedTokens } from '../core/plt.js';
import { mm1, num } from '../core/svg.js';
import { byId, plural } from '../dom.js';

const size = ([w, h]) => `${mm1(w)} × ${mm1(h)} mm`;
// A PLT. forces: [[name, g], …] (one per file); sheet: [w, h] mm; pieces: what is cut; knife: false for the pen;
// overcut: false when only open lines are cut; pieces: a count of pieces, or the words for what is cut.
export function pltCheck(o, forces, { sheet, pieces, knife = true, overcut = true } = {}) {
  const parts = [];
  if (o.pltForce) {
    parts.push(forces.map(([name, f]) => `${name ? name + ' ' : ''}${speedTokens(o, f)[2].slice(2)} g`).join(' / '));
    const [vs, us] = speedTokens(o, 0);
    parts.push(`speed ${vs.slice(2)}${us !== vs.replace('V', 'U') ? ` (up ${us.slice(2)})` : ''}`);
  } else parts.push('no force or speed (the cutter’s own)');
  if (knife) parts.push(`blade offset ${num(o.bladeOffset)} mm`);
  if (knife && overcut) parts.push(`overcut ${num(o.overcut)} mm`);
  if (sheet) parts.push(`sheet ${size(sheet)}`);
  if (pieces != null) parts.push(typeof pieces === 'number' ? plural(pieces, 'piece') : pieces);
  return `PLT: ${parts.join(', ')}.`;
}
// the reminder that goes with a PLT cut with blade-offset compensation
export const bladeNote = o => o.bladeOffset > 0 ? 'Turn the cutter’s own blade-offset compensation OFF: the PLT already compensates.' : '';
// A print PDF: pages, page size, bleed (null: no bleed to speak of)
export function pdfCheck({ label = 'Print PDF', pages, page, bleed = null, extra = '' }) {
  return `${label}: ${plural(pages, 'page')}, ${size(page)}${bleed != null ? `, bleed ${num(bleed)} mm` : ''}${extra ? `, ${extra}` : ''}.`;
}
// lines: the mode's lines (empty ones left out), shown under the Export heading; none: the line is hidden
export function showExportCheck(lines) {
  const el = byId('exportCheck'), list = (lines || []).filter(Boolean);
  el.hidden = !list.length;
  el.replaceChildren(...list.flatMap((t, i) => i ? [document.createElement('br'), t] : [t]));
}
