import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { outermostLoop, pagePaths } from '../../src/core/pdfpaths.js';

const OPS = { save: 10, restore: 11, transform: 12, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28, setLineWidth: 2, constructPath: 91, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };
const rect = (x, y, w, h) => Float32Array.from([0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4]);

describe('pagePaths', () => {
  it('applies the transformations, keeps saved states apart, and finds the outermost closed line', () => {
    const fn = [OPS.transform, OPS.save, OPS.transform, OPS.constructPath, OPS.restore, OPS.constructPath, OPS.constructPath];
    const args = [[1, 0, 0, 1, 10, 10], null, [2, 0, 0, 2, 0, 0], [OPS.fill, [rect(0, 0, 5, 5)], null], null, [OPS.stroke, [rect(-5, -5, 100, 50)], null], [OPS.endPath, [rect(-50, -50, 1000, 1000)], null]];
    const P = pagePaths(fn, args, OPS);
    expect(P).toHaveLength(2); // the unpainted path (a clip, say) is not a line
    expect(P[0].bbox).toEqual([10, 10, 20, 20]);
    expect(P[1].bbox).toEqual([5, 5, 105, 55]);
    expect(outermostLoop(P).bbox).toEqual([5, 5, 105, 55]);
    expect(outermostLoop(P, b => b[2] > 100).bbox).toEqual([10, 10, 20, 20]); // a background left out
  });
  it('reads the outline of a sign from a real PDF (pdf.js)', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync('tests/fixtures/sign_100x150mm_3szt.pdf')), isEvalSupported: false }).promise;
    const ol = await (await doc.getPage(1)).getOperatorList();
    const PT = 72 / 25.4, trim = [3 * PT, 3 * PT, 103 * PT, 153 * PT];
    const loop = outermostLoop(pagePaths(ol.fnArray, ol.argsArray, pdfjs.OPS), b => b[0] < trim[0] - PT || b[2] > trim[2] + PT);
    // the outline is drawn 0.25 mm inside the 100 x 150 mm trim
    const mm = v => Math.round(v / PT * 100) / 100;
    expect(loop.bbox.map(mm)).toEqual([3.25, 3.25, 102.75, 152.75]);
    expect(loop.pts.length).toBeGreaterThan(20); // the rounded corners are followed, not cut short
  });
});
