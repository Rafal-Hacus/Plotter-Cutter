// Lines of text as outlines (filled rings, y down), from a font loaded with fontkit. Each line is centred (or set
// left / right), one under the other; sizes are in em of the font (the stamp fits the result to its size anyway).
// opts: { align: 'center' | 'left' | 'right', spacing (line distance in em, e.g. 1.15), sizes (relative size per
//         line, default 1), steps (points per curve) }

function flattenGlyph(cmds, ox, oy, k, steps, out) {
  let cur = null, last = [0, 0], start = [0, 0];
  const P = (x, y) => [ox + x * k, oy - y * k]; // font units, y up -> em, y down
  const close = () => { if (cur && cur.length > 2) out.push(cur); cur = null; };
  for (const c of cmds) {
    const a = c.args;
    if (c.command === 'moveTo') { close(); cur = [P(a[0], a[1])]; last = start = [a[0], a[1]]; }
    else if (c.command === 'lineTo') { if (!cur) cur = [P(last[0], last[1])]; cur.push(P(a[0], a[1])); last = [a[0], a[1]]; }
    else if (c.command === 'quadraticCurveTo') {
      if (!cur) cur = [P(last[0], last[1])];
      for (let s = 1; s <= steps; s++) { const t = s / steps, u = 1 - t; cur.push(P(u * u * last[0] + 2 * u * t * a[0] + t * t * a[2], u * u * last[1] + 2 * u * t * a[1] + t * t * a[3])); }
      last = [a[2], a[3]];
    } else if (c.command === 'bezierCurveTo') {
      if (!cur) cur = [P(last[0], last[1])];
      for (let s = 1; s <= steps; s++) { const t = s / steps, u = 1 - t; cur.push(P(u * u * u * last[0] + 3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t * t * t * a[4], u * u * u * last[1] + 3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t * t * t * a[5])); }
      last = [a[4], a[5]];
    } else if (c.command === 'closePath') { close(); last = start; }
  }
  close();
}
export function textOutlines(font, lines, { align = 'center', spacing = 1.15, sizes = [], steps = 12 } = {}) {
  const upm = font.unitsPerEm, rings = [], widths = [];
  const laid = lines.map((text, i) => {
    const s = sizes[i] || 1, run = text ? font.layout(text) : { glyphs: [], positions: [] };
    const w = run.positions.reduce((a, p) => a + p.xAdvance, 0) / upm * s;
    widths.push(w);
    return { run, s };
  });
  const maxW = Math.max(0, ...widths);
  let y = 0;
  laid.forEach(({ run, s }, i) => {
    y += (i ? spacing * s : (font.ascent / upm) * s); // baseline: the first line's ascent, then the line distance
    let x = align === 'left' ? 0 : align === 'right' ? maxW - widths[i] : (maxW - widths[i]) / 2;
    const k = s / upm;
    run.glyphs.forEach((g, j) => {
      const p = run.positions[j];
      flattenGlyph(g.path.commands, x + p.xOffset * k, y - p.yOffset * k, k, steps, rings);
      x += p.xAdvance * k;
    });
  });
  return rings;
}
