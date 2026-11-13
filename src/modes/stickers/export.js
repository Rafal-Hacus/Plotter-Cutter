// The sticker sheet as files: print and cut SVG, cut PDF, PLTs.
import { SLOT_RE, aiId, num, pathEl } from '../../core/svg.js';
import { makeZip } from '../../core/zip.js';
import { saveFile, ui } from '../../dom.js';
import { buildCutPdf, closedAll, lemurCutSvg, pdfClick } from '../../export/cut-files.js';
import { buildPlt } from '../../export/files.js';
import { artTransform, placeMatrix } from '../../nest.js';
import { readOpts } from '../../settings.js';
import { state } from '../../state.js';

// vec: for the print PDF, round stickers made from a PDF are left out here and drawn from the original PDF instead
// A rotated PDF page is printed from its rendered image: the vector embed would come out unrotated.
export const vecCircle = d => !!(d.circle && d.circle.pdf && !d.circle.rot);
// The sheet as an SVG. kind: 'all' (print + cut), 'print', 'cut', or 'art' (artwork only, no marks). L: the layout.
export function buildExport(kind, L, vec = false) {
  const t = state.template, o = readOpts();
  const s = [];
  s.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n');
  // SignCut chokes on xlink:href, so the cut file carries no xlink at all
  s.push((kind === 'cut' ? t.open.replace(/\s+xmlns:xlink="[^"]*"/g, '') : t.open) + '\n');
  const pr = [];
  if (kind !== 'cut') {
    // Reset styles the template root passes down (e.g. fill-rule:evenodd), so the artwork renders like its own file.
    pr.push(`<g id="Print" transform="translate(${t.vb.x} ${t.vb.y}) scale(${t.u})" xml:space="default" style="fill-rule:nonzero;clip-rule:nonzero;stroke-linejoin:miter;stroke-miterlimit:4">\n`);
    // shared bitmaps, once per design
    const defs = [...new Set(L.items.map(it => it.d))].map(d => d.sharedDefs.split('__D__').join(`s${d.id}-`)).join('');
    if (defs) pr.push(`<defs>${defs}</defs>\n`);
    L.items.forEach((it, n) => {
      if (vec && vecCircle(it.d)) return;
      const d = it.d, M = placeMatrix(it), cp = `s${d.id}c${n}-`;
      const art = m => `<g transform="${artTransform(d)}"${d.wrap}>${m.split('__P__').join(cp).split('__D__').join(`s${d.id}-`)}</g>`;
      pr.push(`<g transform="matrix(${M.map(num).join(',')})">`);
      if (d.res.cutMode) {
        // cut-line mode: artwork is cropped to the die line plus a little bleed, the rest of the image is dropped
        pr.push(`<clipPath id="${cp}clip"><path d="${d.res.clipD}"/></clipPath><g clip-path="url(#${cp}clip)">${art(d.markupNoCut)}</g></g>\n`);
      } else {
        if (o.borderFill) pr.push(`<path d="${d.res.kissD}" fill="${o.borderColor}"/>`);
        pr.push(`${art(d.markup)}</g>\n`);
      }
    });
    pr.push('</g>\n');
  }
  const print = pr.join('');
  if (kind === 'art') s.push(print); // artwork only, no marks
  else if (SLOT_RE.test(t.inner)) s.push(t.inner.replace(SLOT_RE, () => print) + '\n');
  else s.push(t.inner + '\n' + print);
  if (kind !== 'print' && kind !== 'art') {
    // Cut lines: plain paths in the document's own units, no transforms, one closed path per outline.
    const u = t.u, toDoc = M => [M[0] * u, M[1] * u, M[2] * u, M[3] * u, M[4] * u + t.vb.x, M[5] * u + t.vb.y];
    const sw = num(o.lineW * u);
    // Written the way Illustrator does: one <polygon> per outline, layer names encoded Illustrator-style (SignCut decodes them).
    const dieName = o.dieLayer === o.kissLayer ? o.dieLayer + ' 2' : o.dieLayer;
    for (const [name, color, key] of [[o.kissLayer, o.kissColor, 'kissLoops'], [dieName, o.dieColor, 'dieLoops']]) {
      s.push(`<g id="${aiId(name)}">\n`);
      for (const it of L.items) {
        const M = toDoc(placeMatrix(it));
        for (const loop of it.d.res[key]) s.push(pathEl(loop.map(p => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]), true, `fill:none;stroke:${color};stroke-width:${sw}`) + '\n');
      }
      s.push('</g>\n');
    }
  }
  s.push('</svg>\n');
  return s.join('');
}
// Sticker outlines placed on the sheet, in sheet mm.
export function stickerLoops(L, key) {
  const res = [];
  for (const it of L.items) {
    const M = placeMatrix(it);
    for (const loop of it.d.res[key]) res.push(loop.map(p => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]));
  }
  return res;
}
export function exportName(kind) {
  const n = state.layout ? state.layout.items.length : 0;
  const base = `sticker-sheet-${n}pcs`;
  return kind === 'all' ? `${base}.svg` : `${base}-${kind}.svg`;
}
ui.exAll.addEventListener('click', () => saveFile(exportName('all'), buildExport('all', state.layout)));
ui.exPrint.addEventListener('click', () => saveFile(exportName('print'), buildExport('print', state.layout)));
ui.exCut.addEventListener('click', () => {
  const o = readOpts(), dieName = o.dieLayer === o.kissLayer ? o.dieLayer + ' 2' : o.dieLayer;
  saveFile(exportName('cut'), state.template.generated ? lemurCutSvg([
    { name: o.kissLayer, color: o.kissColor, paths: stickerLoops(state.layout, 'kissLoops').map(pts => ({ pts, closed: true })) },
    { name: dieName, color: o.dieColor, paths: stickerLoops(state.layout, 'dieLoops').map(pts => ({ pts, closed: true })) }]) : buildExport('cut', state.layout));
});
ui.exPlt.addEventListener('click', () => {
  const base = exportName('cut').replace(/-cut\.svg$/, '');
  const po = readOpts();
  saveFile(`${base}-plt.zip`, makeZip([{ name: `${base}-kiss.plt`, text: buildPlt(stickerLoops(state.layout, 'kissLoops'), po.kissForce) }, { name: `${base}-die.plt`, text: buildPlt(stickerLoops(state.layout, 'dieLoops'), po.dieForce) }]));
});
pdfClick('exCutPdf', () => exportName('cut').replace(/\.svg$/, '.pdf'), () => {
  const o = readOpts(), dieName = o.dieLayer === o.kissLayer ? o.dieLayer + ' 2' : o.dieLayer;
  return buildCutPdf(state.template.wMm, state.template.hMm, [
    { name: o.kissLayer, color: o.kissColor, paths: closedAll(stickerLoops(state.layout, 'kissLoops')) },
    { name: dieName, color: o.dieColor, paths: closedAll(stickerLoops(state.layout, 'dieLoops')) }], true);
});
