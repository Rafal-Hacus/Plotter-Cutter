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
