// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { makeMarksTemplate } from '../../src/core/marks.js';
import { parseSvg } from '../../src/core/svg.js';

describe('makeMarksTemplate', () => {
  it('puts 1 mm thick, 10 mm L-marks 5 mm in from each corner', () => {
    const doc = parseSvg(makeMarksTemplate(310, 440));
    const rects = [...doc.querySelectorAll('#scpro2_x5F_regmarks rect')].map(r => ['x', 'y', 'width', 'height'].map(k => +r.getAttribute(k)));
    expect(rects).toHaveLength(8);
    expect(rects).toContainEqual([5, 5.5, 1, 10]);
    expect(rects).toContainEqual([304, 434.5 - 10, 1, 10].map((v, i) => i === 1 ? 424.5 : v));
    expect(doc.documentElement.getAttribute('width')).toBe('310mm');
  });
  it('moves the top marks down by the blank feed strip', () => {
    const doc = parseSvg(makeMarksTemplate(310, 440, 60));
    const ys = [...doc.querySelectorAll('#scpro2_x5F_regmarks rect')].map(r => +r.getAttribute('y'));
    expect(Math.min(...ys)).toBe(65);
  });
});
