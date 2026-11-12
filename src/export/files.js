import { writePlt } from '../core/plt.js';
import { markFrame } from '../modes/stickers/export.js';
import { readOpts } from '../settings.js';
import { state } from '../state.js';

export const pltOpts = (o, force) => ({ force, overcut: o.overcut, bladeOffset: o.bladeOffset, pltForce: o.pltForce, cutSpeed: o.cutSpeed, upSpeed: o.upSpeed });
export function buildPlt(sheetLoops, force, openLines = [], ...laterLines) {
  return writePlt(markFrame(state.template), pltOpts(readOpts(), force), sheetLoops, openLines, ...laterLines);
}
export async function saveFile(name, text) {
  const blob = text instanceof Blob ? text : new Blob([text], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
