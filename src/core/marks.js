// SignCut registration marks (L-marks 5 mm in from each corner, start arrow by the bottom-right mark).

// SignCut registration marks for any sheet (mm): 10 mm L-marks, 1 mm thick, 5 mm in from each corner,
// and the print-only start arrow by the bottom-right mark. Same geometry as the SRA3 template.
// T: blank strip at the top (sheet feeding without a mat); the top marks sit T mm lower, nothing goes above them
export function makeMarksTemplate(W, H, T = 0) {
  const f = v => (Math.round(v * 1000) / 1000).toString();
  const r = (x, y, w, h) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" style="fill:#000000"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">
  <g id="scpro2_x5F_printonly">
    <path d="M${f(W - 21.68)},${f(H - 5)} L${f(W - 24.17)},${f(H - 7.5)} L${f(W - 26.69)},${f(H - 5)}" style="fill:none;stroke:#000000;stroke-width:0.35"/>
  </g>
  <g id="scpro2_x5F_regmarks">
    ${r(5, T + 5.5, 1, 10)}${r(5.5, T + 5, 10, 1)}${r(W - 6, T + 5.5, 1, 10)}${r(W - 15.5, T + 5, 10, 1)}
    ${r(5, H - 15.5, 1, 10)}${r(5.5, H - 6, 10, 1)}${r(W - 6, H - 15.5, 1, 10)}${r(W - 15.5, H - 6, 10, 1)}
  </g>
</svg>
`;
}
// Same as SvgToolkit.GetRegistrationMarks: marks in document units (mm), classes without a style sheet,
// appended at the end of the document, after the cut lines.
export function lemurMarks(w, h, T = 0) {
  const f = v => (Math.round(v * 100) / 100).toFixed(2);
  return `  <g id="scpro2_x5F_printonly">
    <polyline class="st0" points="${f(w - 21.68)} ${f(h - 5.00)} ${f(w - 24.17)} ${f(h - 7.50)} ${f(w - 26.69)} ${f(h - 5.00)}"/>
  </g>
  <g id="scpro2_x5F_regmarks">
    <rect class="st1" x="5.00" y="${f(T + 5.50)}" width="1.00" height="10.00"/>
    <rect class="st1" x="5.50" y="${f(T + 5.00)}" width="10.00" height="1.00"/>
    <rect class="st1" x="${f(w - 6.00)}" y="${f(T + 5.50)}" width="1.00" height="10.00"/>
    <rect class="st1" x="${f(w - 15.50)}" y="${f(T + 5.00)}" width="10.00" height="1.00"/>
    <rect class="st1" x="5.00" y="${f(h - 15.50)}" width="1.00" height="10.00"/>
    <rect class="st1" x="5.50" y="${f(h - 6.00)}" width="10.00" height="1.00"/>
    <rect class="st1" x="${f(w - 6.00)}" y="${f(h - 15.50)}" width="1.00" height="10.00"/>
    <rect class="st1" x="${f(w - 15.50)}" y="${f(h - 6.00)}" width="10.00" height="1.00"/>
  </g>
`;
}
