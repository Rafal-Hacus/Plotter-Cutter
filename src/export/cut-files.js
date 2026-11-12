import { lemurMarks } from '../core/marks.js';
import { PT } from '../core/matrix.js';
import { aiId, num, pathEl } from '../core/svg.js';
import { setCardMsg } from '../dom.js';
import { ensureLibs } from '../lib/pdf.js';
import { templateShapes } from '../modes/cards/render.js';
import { readOpts } from '../settings.js';
import { state } from '../state.js';
import { saveFile } from './files.js';

/* ---------- cut SVG for SignCut, built 1:1 like the LemurPrints.CutMarks tool ---------- */
// layers: [{ name, color, paths: [{ pts (sheet mm), closed }] }]
export function lemurCutSvg(layers) {
  const W = state.template.wMm, H = state.template.hMm, sw = num(readOpts().lineW);
  const s = [`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(W)}mm" height="${num(H)}mm" viewBox="0 0 ${num(W)} ${num(H)}">\n`];
  for (const L of layers) {
    s.push(`  <g id="${aiId(L.name)}">\n`);
    for (const p of L.paths) s.push('    ' + pathEl(p.pts, p.closed, `fill:none;stroke:${L.color};stroke-width:${sw}px;`) + '\n');
    s.push('  </g>\n');
  }
  s.push(lemurMarks(W, H, state.template.feedTop || 0), '</svg>\n');
  return s.join('');
}
/* ---------- cut lines as PDF (vector, one PDF layer per cut layer) ---------- */
const hexRgb = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h) || [0, '00', '00', '00']; return window.PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255); };
// layers: [{ name, color, paths: [{ pts (sheet mm), closed }] }]; marks: true to add the registration marks layers
export async function buildCutPdf(Wmm, Hmm, layers, marks) {
  await ensureLibs();
  const { PDFDocument, PDFName, PDFString, PDFOperator, PDFOperatorNames, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create(), ctx = pdf.context, Wpt = Wmm * PT, Hpt = Hmm * PT;
  const page = pdf.addPage([Wpt, Hpt]), props = ctx.obj({}), ocgs = [];
  const layer = (name, draw) => {
    const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(name) }));
    ocgs.push(ref);
    const key = `OC${ocgs.length}`;
    props.set(PDFName.of(key), ref);
    page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of(key)]));
    draw();
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  };
  const d = (pts, closed) => 'M ' + pts.map(q => `${(q[0] * PT).toFixed(3)} ${(q[1] * PT).toFixed(3)}`).join(' L ') + (closed ? ' Z' : '');
  if (marks) {
    const sh = templateShapes(), black = rgb(0, 0, 0);
    layer('scpro2_regmarks', () => { for (const m of sh.filter(x => x.closed && x.fill)) page.drawSvgPath(d(m.pts, true), { x: 0, y: Hpt, color: black }); });
    layer('scpro2_printonly', () => { for (const m of sh.filter(x => !(x.closed && x.fill))) page.drawSvgPath(d(m.pts, m.closed), { x: 0, y: Hpt, borderColor: black, borderWidth: Math.max(0.25, m.sw * PT) }); });
  }
  const lw = Math.max(0.1, readOpts().lineW * PT);
  for (const L of layers) layer(L.name, () => { const c = hexRgb(L.color); for (const p of L.paths) page.drawSvgPath(d(p.pts, p.closed), { x: 0, y: Hpt, borderColor: c, borderWidth: lw }); });
  page.node.Resources().set(PDFName.of('Properties'), props);
  pdf.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: ocgs, D: { Order: ocgs, ON: ocgs } }));
  pdf.setTitle('Cut lines');
  // SignCut only reads plain PDFs: no compressed content streams, no object streams (classic xref table)
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj && typeof obj.getUnencodedContents === 'function' && 'encode' in obj && obj.dict) {
      obj.encode = false;
      obj.dict.delete(PDFName.of('Filter'));
      obj.contentsCache = { access: () => obj.getUnencodedContents() };
    }
  }
  return new Blob([await pdf.save({ useObjectStreams: false })], { type: 'application/pdf' });
}
// Wire a button that builds a PDF and saves it: name() gives the file name, make() the PDF.
export function pdfClick(id, name, make) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await saveFile(name(), await make()); }
    catch (e) { setCardMsg(`Couldn’t build the PDF: ${e.message || e}`, true); }
    finally { btn.disabled = false; }
  });
}
// outlines and open lines as the { pts, closed } paths the cut files take
export function closedAll(loops) { return loops.map(pts => ({ pts, closed: true })); }
export function openAll(lines) { return lines.map(pts => ({ pts, closed: false })); }
