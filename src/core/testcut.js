// The test cut: one printed sheet with registration marks and four small PLTs to check the knife before a job.
// 1-blade-offset: a row of 10 mm squares, each cut with another blade offset (TEST_OFFSETS, left to right);
// 2-marks: small crosses cut on printed crosshair targets A–D near the corners, to measure how far off the marks
// are read; 3-kiss and 4-die: a 15 mm square at the kiss and at the die force. Pure: sheet mm in, PLT text out.
import { closedTip, dragKnife, markHeader, speedTokens, strokeTokens, writePlt } from './plt.js';

export const TEST_OFFSETS = [0.25, 0.3, 0.35, 0.4, 0.5];
const SQ = 10, SQ_GAP = 6, BIG = 15, INSET = 20, ARM = 3;

// a square as a closed outline that starts in the middle of its bottom edge, so the start and the overcut
// stay away from the corners being judged
const square = (x, y, s) => [[x + s / 2, y + s], [x + s, y + s], [x + s, y], [x, y], [x, y + s]];

// Where everything goes, in sheet mm. frame: the mark frame { top, bottom, left, right } (see writePlt).
export function testCutLayout(frame) {
  const { top, bottom, left, right } = frame, W = right - left, H = bottom - top;
  if (!(W >= 120 && H >= 120)) throw new Error('The sheet is too small for the test cut: it needs at least 120 × 120 mm between the registration marks.');
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const rowW = TEST_OFFSETS.length * SQ + (TEST_OFFSETS.length - 1) * SQ_GAP, x0 = cx - rowW / 2, y0 = cy - 20;
  const blade = TEST_OFFSETS.map((offset, i) => {
    const x = x0 + i * (SQ + SQ_GAP);
    return { offset, loop: square(x, y0, SQ), label: [x + SQ / 2, y0 + SQ + 4.5] };
  });
  const y1 = cy + 4;
  const kiss = { loop: square(cx - 6 - BIG, y1, BIG), label: [cx - 6 - BIG / 2, y1 + BIG + 4.5] };
  const die = { loop: square(cx + 6, y1, BIG), label: [cx + 6 + BIG / 2, y1 + BIG + 4.5] };
  const targets = [['A', left + INSET, top + INSET], ['B', right - INSET, top + INSET], ['C', left + INSET, bottom - INSET], ['D', right - INSET, bottom - INSET]]
    .map(([name, x, y]) => ({ name, x, y }));
  return { blade, kiss, die, targets, title: [cx, y0 - 5] };
}
// the crosses the knife cuts on the targets: two ARM mm half-lines through each centre
export const crossLines = targets => targets.flatMap(({ x, y }) => [[[x - ARM, y], [x + ARM, y]], [[x, y - ARM], [x, y + ARM]]]);

// One PLT with the squares of the blade-offset row, each cut with its own blade offset, in the row's order
// (left to right). The header, speeds, force, start arrow and park move are the ones writePlt writes.
// opts: as writePlt (force: the kiss force; bladeOffset: the current one, used for the start arrow).
export function bladeOffsetPlt(frame, opts, layout = testCutLayout(frame)) {
  const { bottom, right } = frame, { FX, head } = markHeader(frame), out = [head];
  if (opts.pltForce) out.push(...speedTokens(opts, opts.force));
  const q = ([x, y]) => [Math.round((bottom - y) * 40), Math.round((right - x) * 40)];
  let dir = [1, 0];
  const emit = (tip, R, dup) => {
    const c = dragKnife(tip, R * 40, dir);
    dir = c.dir;
    out.push(...strokeTokens(c.pts.map(p => [Math.round(p[0]), Math.round(p[1])]), dup));
  };
  emit([[-19, 647], [80, 747], [-19, 847]], opts.bladeOffset, false);
  for (const sq of layout.blade) emit(closedTip(sq.loop.map(q), opts.overcut * 40), sq.offset, true);
  out.push(`U${FX},0`, '@;@;');
  return out.join(' ');
}

// Every PLT of the test cut. o: { kissForce, dieForce, overcut, bladeOffset, pltForce, cutSpeed, upSpeed }.
export function testCutPlts(frame, o) {
  const L = testCutLayout(frame), base = { overcut: o.overcut, bladeOffset: o.bladeOffset, pltForce: o.pltForce, cutSpeed: o.cutSpeed, upSpeed: o.upSpeed };
  const kiss = { ...base, force: o.kissForce }, die = { ...base, force: o.dieForce };
  const marks = crossLines(L.targets);
  marks.ordered = true;
  return [
    { name: '1-blade-offset.plt', text: bladeOffsetPlt(frame, kiss, L) },
    { name: '2-marks.plt', text: writePlt(frame, kiss, [], marks) },
    { name: '3-kiss.plt', text: writePlt(frame, kiss, [L.kiss.loop]) },
    { name: '4-die.plt', text: writePlt(frame, die, [L.die.loop]) }
  ];
}
