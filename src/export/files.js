// PLT files for sheets with registration marks: the template's mark frame and the plotter settings, put together.
import { writePlt } from '../core/plt.js';
import { readOpts } from '../settings.js';
import { state } from '../state.js';
import { markFrame } from '../template.js';

export const pltOpts = (o, force) => ({ force, overcut: o.overcut, bladeOffset: o.bladeOffset, pltForce: o.pltForce, cutSpeed: o.cutSpeed, upSpeed: o.upSpeed });
export function buildPlt(sheetLoops, force, openLines = [], ...laterLines) {
  return writePlt(markFrame(state.template), pltOpts(readOpts(), force), sheetLoops, openLines, ...laterLines);
}
