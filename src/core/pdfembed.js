// Pages of another PDF embedded into the one being written (pdf-lib). pdf-lib's own embedPdf assumes a page's
// media box starts at 0,0: a page whose box starts elsewhere (Canva writes e.g. 0 7.71 297.75 426.96) is cut off on
// one side and lands off its place. Here each page is embedded with its real media box and moved so its lower left
// corner is the form's 0,0: draw the result as a page of width x height starting at the origin.
export function embedPages(out, doc, indices) {
  return Promise.all(indices.map(i => {
    const p = doc.getPage(i), mb = p.getMediaBox();
    return out.embedPage(p, { left: mb.x, bottom: mb.y, right: mb.x + mb.width, top: mb.y + mb.height });
  }));
}
// A page as it is seen: viewers (and pdf.js's pictures) turn a page by its /Rotate (clockwise, a multiple of 90°);
// the embedded form above is not turned. Returns { rot, w, h: the size as seen (points), M: form space (media box
// lower left at 0,0) -> the page as seen (its lower left at 0,0, y up), P: page space -> the page as seen }.
export function pageView(page) {
  const mb = page.getMediaBox(), w = mb.width, h = mb.height;
  const rot = ((Math.round((page.getRotation().angle || 0) / 90) * 90) % 360 + 360) % 360;
  const M = rot === 90 ? [0, -1, 1, 0, 0, w] : rot === 180 ? [-1, 0, 0, -1, w, h] : rot === 270 ? [0, 1, -1, 0, h, 0] : [1, 0, 0, 1, 0, 0];
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
