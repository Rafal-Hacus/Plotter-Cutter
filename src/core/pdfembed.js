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
  const rot = (((Math.round((page.getRotation().angle || 0) / 90) % 4) + 4) % 4) * 90, turned = rot % 180 !== 0;
  return { box, rot, w: turned ? box.height : box.width, h: turned ? box.width : box.height, bleed };
}
// The matrix from an embedded page (form points, from the box's lower left corner, y up) to the page as shown
// (points, from its lower left corner, y up): the page's /Rotate applied.
export function shownMatrix(g) {
  const w = g.box.width, h = g.box.height;
  return g.rot === 90 ? [0, -1, 1, 0, 0, w] : g.rot === 180 ? [-1, 0, 0, -1, w, h] : g.rot === 270 ? [0, 1, -1, 0, h, 0] : [1, 0, 0, 1, 0, 0];
}
