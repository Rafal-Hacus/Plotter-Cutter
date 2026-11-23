// Checking where things land in an exported PDF: render a page with the app's own pdf.js and read colours.
import { PDFDocument, degrees, rgb } from 'pdf-lib';

const PT = 72 / 25.4;

// The colours [r, g, b] of page `n` of a PDF at points given in mm from the page's top left corner (2 px per mm).
// The app has to have loaded its PDF libraries already (any mode that reads a PDF does).
export const pdfColours = (page, bytes, pts, n = 1) => page.evaluate(async ([b64, pts, n]) => {
  const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const pdf = await window.pdfjsLib.getDocument({ data, isEvalSupported: false }).promise, pg = await pdf.getPage(n);
  const k = 2, vp = pg.getViewport({ scale: k * 25.4 / 72 }), cv = document.createElement('canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const cx = cv.getContext('2d');
  await pg.render({ canvasContext: cx, viewport: vp }).promise;
  return pts.map(([x, y]) => Array.from(cx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data.slice(0, 3)));
}, [Buffer.from(bytes).toString('base64'), pts, n]);
export const isRed = c => c[0] > 180 && c[1] < 80 && c[2] < 80;
export const isBlue = c => c[2] > 180 && c[0] < 80 && c[1] < 120;

// A one-page PDF of a w x h mm piece (trim box, `bleed` mm around it) turned by /Rotate `rot`, drawn so that AS SEEN
// it has a red square 5..25 mm in from the top left corner of the trim and a blue one 5..25 mm in from the bottom
// right; the media box starts at (ox, oy) points.
export async function turnedPdf(w, h, rot, { bleed = 3, ox = 0, oy = 0 } = {}) {
  const doc = await PDFDocument.create(), sw = rot % 180 ? h : w, sh = rot % 180 ? w : h; // (sw x sh: unturned)
  const W = (sw + 2 * bleed) * PT, H = (sh + 2 * bleed) * PT, p = doc.addPage([W, H]);
  p.setMediaBox(ox, oy, W, H);
  p.setTrimBox(ox + bleed * PT, oy + bleed * PT, sw * PT, sh * PT);
  p.setRotation(degrees(rot));
  p.drawRectangle({ x: ox, y: oy, width: W, height: H, color: rgb(1, 0.95, 0.8) });
  // a square 5..25 mm in from a corner of the seen page; seen corner (0: top left, 1: bottom right) -> unturned corner
  const square = (corner, color) => {
    // the corners of the unturned trim going clockwise as seen from the top left: TL, TR, BR, BL
    const order = ['TL', 'TR', 'BR', 'BL'], seen = corner ? 2 : 0, c = order[(seen + 4 - rot / 90) % 4];
    const x = c[1] === 'L' ? 5 : sw - 25, y = c[0] === 'B' ? 5 : sh - 25;
    p.drawRectangle({ x: ox + (bleed + x) * PT, y: oy + (bleed + y) * PT, width: 20 * PT, height: 20 * PT, color });
  };
  square(0, rgb(0.9, 0.1, 0.1)); square(1, rgb(0.1, 0.2, 0.9));
  return Buffer.from(await doc.save());
}
