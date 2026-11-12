// Drawing on pdf-lib pages in sheet coordinates (mm, y down from the top left corner).
import { PT } from '../core/matrix.js';
import { state } from '../state.js';

// a CSS colour (#rgb, #rrggbb, with or without alpha, or rgb(…)) as a pdf-lib colour
export function cssRgb(c) {
  const { rgb } = window.PDFLib, text = String(c).trim();
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hex) {
    const h = hex[1].length <= 4 ? hex[1].replace(/./g, ch => ch + ch) : hex[1];
    return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
  }
  const m = text.match(/[\d.]+/g) || [];
  return rgb((+m[0] || 0) / 255, (+m[1] || 0) / 255, (+m[2] || 0) / 255);
}
// sheet mm (y down) -> PDF points (y up), for a page Hpt points high
export const sheetToPdf = Hpt => [PT, 0, 0, -PT, 0, Hpt];
// points in sheet mm as an SVG path in points, for pdf-lib's drawSvgPath placed at the page's top left corner
export const svgPathPt = (pts, closed) => 'M ' + pts.map(q => `${(q[0] * PT).toFixed(3)} ${(q[1] * PT).toFixed(3)}`).join(' L ') + (closed ? ' Z' : '');

// A print page whose content covers the whole sheet: a white background over the full page, plus two
// near-white specks at the top corners when there's a blank feed strip. Printers that position the page by
// its content (and centre it) then keep the layout where it is, blank strip included.
export function printPage(doc, Wpt, Hpt) {
  const page = doc.addPage([Wpt, Hpt]), { rgb } = window.PDFLib, t = state.template;
  page.drawRectangle({ x: 0, y: 0, width: Wpt, height: Hpt, color: rgb(1, 1, 1) });
  if (t && t.feedTop && Math.abs(Wpt - t.wMm * PT) < 1 && Math.abs(Hpt - t.hMm * PT) < 1) {
    for (const x of [3, t.wMm - 3.3]) page.drawRectangle({ x: x * PT, y: Hpt - 3.3 * PT, width: 0.3 * PT, height: 0.3 * PT, color: rgb(0.985, 0.985, 0.985) });
  }
  return page;
}
// An embedded page or image, clipped to a rectangle of the sheet. name: its XObject name on this page;
// rc: [x, y, w, h] in sheet mm; M: the matrix that places it, in PDF points.
export function drawClipped(page, name, rc, M, Hpt) {
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clip, endPath, drawObject } = window.PDFLib;
  page.pushOperators(pushGraphicsState(), rectangle(rc[0] * PT, Hpt - (rc[1] + rc[3]) * PT, rc[2] * PT, rc[3] * PT), clip(), endPath(),
    concatTransformationMatrix(...M), drawObject(name), popGraphicsState());
}
// The template's drawing (registration marks, start arrow) as vectors. shapes: from templateShapes().
export function drawShapes(page, shapes, Hpt) {
  for (const sh of shapes) {
    const opt = { x: 0, y: Hpt };
    if (sh.fill) opt.color = cssRgb(sh.fill);
    if (sh.stroke) { opt.borderColor = cssRgb(sh.stroke); opt.borderWidth = sh.sw * PT; }
    page.drawSvgPath(svgPathPt(sh.pts, sh.closed), opt);
  }
}
// Crop marks as hairlines. marks: [[x1, y1, x2, y2], …] in sheet mm.
export function drawCropMarks(page, marks, Hpt) {
  const black = window.PDFLib.rgb(0, 0, 0);
  for (const m of marks) page.drawLine({ start: { x: m[0] * PT, y: Hpt - m[1] * PT }, end: { x: m[2] * PT, y: Hpt - m[3] * PT }, thickness: 0.25, color: black });
}
