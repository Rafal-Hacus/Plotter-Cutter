// Pages of another PDF embedded into the one being written (pdf-lib). pdf-lib's own embedPdf assumes a page's
// media box starts at 0,0: a page whose box starts elsewhere (Canva writes e.g. 0 7.71 297.75 426.96) is cut off on
// one side and lands off its place. Here each page is embedded with its real media box and moved so its lower left
// corner is the form's 0,0: draw the result as a page of width x height starting at the origin.
// boxes: optional, per index, the part of the page to embed ({ x, y, width, height } in the page's points, e.g. the
// box of pageGeom) instead of the media box.
export function embedPages(out, doc, indices, boxes) {
  return Promise.all(indices.map((i, k) => {
    const p = doc.getPage(i), mb = (boxes && boxes[k]) || p.getMediaBox();
    return out.embedPage(p, { left: mb.x, bottom: mb.y, right: mb.x + mb.width, top: mb.y + mb.height });
  }));
}
// a w x h form (lower left at 0,0) turned clockwise by rot -> the page as seen (its lower left at 0,0, y up)
const turn = (rot, w, h) => rot === 90 ? [0, -1, 1, 0, 0, w] : rot === 180 ? [-1, 0, 0, -1, w, h] : rot === 270 ? [0, 1, -1, 0, h, 0] : [1, 0, 0, 1, 0, 0];
// A page as it is seen: viewers (and pdf.js's pictures) turn a page by its /Rotate (clockwise, a multiple of 90°);
// the embedded form above is not turned. Returns { rot, w, h: the size as seen (points), M: form space (media box
// lower left at 0,0) -> the page as seen (its lower left at 0,0, y up), P: page space -> the page as seen }.
export function pageView(page) {
  const mb = page.getMediaBox(), w = mb.width, h = mb.height;
  const rot = ((Math.round((page.getRotation().angle || 0) / 90) * 90) % 360 + 360) % 360, M = turn(rot, w, h);
  return { rot, w: rot % 180 ? h : w, h: rot % 180 ? w : h, M, P: [M[0], M[1], M[2], M[3], M[4] - M[0] * mb.x - M[2] * mb.y, M[5] - M[1] * mb.x - M[3] * mb.y] };
}
// a box { x, y, w, h } of page space as seen (the box around it, turned)
export function seenBox(view, b) {
  const xs = [], ys = [];
  for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
    const P = view.P; xs.push(P[0] * x + P[2] * y + P[4]); ys.push(P[1] * x + P[3] * y + P[5]);
  }
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}
const PT = 72 / 25.4;
const meet = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
};
// The part of a PDF page that is the artwork, and how the page is turned when shown (pdf-lib page):
// box: the bleed box (else the crop box, else the media box, as pdf-lib falls back), within the media box. A file
//   exported with printer's marks has a media box much bigger than its bleed: the marks and the slug are left out.
//   When there is a smaller trim box the box is the trim plus the narrowest bleed around it, so the trim is always
//   in the middle (a trim box off centre would otherwise put every cut off the card).
// rot: the page's /Rotate (0, 90, 180, 270: clockwise, as a viewer turns it); w, h: the box as shown, in points;
// bleed: mm around the trim, or null when the page has no trim box smaller than the box.
export function pageGeom(page) {
  const mb = page.getMediaBox(), bb = meet(page.getBleedBox(), mb), tb = page.getTrimBox();
  let box = bb.width > 1 && bb.height > 1 ? bb : mb, bleed = null;
  if (tb.width < box.width - 0.5 && tb.height < box.height - 0.5) {
    const s = Math.max(0, Math.min(tb.x - box.x, tb.y - box.y, box.x + box.width - tb.x - tb.width, box.y + box.height - tb.y - tb.height));
    box = { x: tb.x - s, y: tb.y - s, width: tb.width + 2 * s, height: tb.height + 2 * s };
    bleed = Math.round(s / PT * 100) / 100;
  }
  const rot = pageView(page).rot, turned = rot % 180 !== 0;
  return { box, rot, w: turned ? box.height : box.width, h: turned ? box.width : box.height, bleed };
}
// The matrix from an embedded page (form points, from the box's lower left corner, y up) to the page as shown
// (points, from its lower left corner, y up): the page's /Rotate applied.
export const shownMatrix = g => turn(g.rot, g.box.width, g.box.height);
