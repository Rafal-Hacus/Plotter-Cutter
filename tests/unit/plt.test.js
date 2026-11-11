import { describe, it, expect } from 'vitest';
import { writePlt, dragKnife, modifyPlt, cleanMoves, pltValues, isMove } from '../../src/core/plt.js';

// marks of a 310 x 440 sheet (centre lines 5.5 mm in)
const FRAME = { top: 5.5, bottom: 434.5, left: 5.5, right: 304.5 };
const OPTS = { force: 60, overcut: 0, bladeOffset: 0, pltForce: true, cutSpeed: 13, upSpeed: 10 };
const moves = t => t.split(/\s+/).filter(isMove).map(tk => ({ pen: tk[0], x: +tk.slice(1).split(',')[0], y: +tk.slice(1).split(',')[1] }));
// PLT units back to sheet mm
const toSheet = m => [FRAME.right - m.y / 40, FRAME.bottom - m.x / 40];

describe('writePlt', () => {
  it('writes the SignCut header with the mark distance and the force/speed', () => {
    const t = writePlt(FRAME, OPTS, []);
    expect(t.startsWith('IN FSIZE17160,11960 ')).toBe(true);
    expect(t).toContain(' VS13 US10 FS60 ');
    expect(t.endsWith('U17160,0 @;@;')).toBe(true);
  });
  it('omits force and speed when switched off', () => {
    expect(writePlt(FRAME, { ...OPTS, pltForce: false }, [])).not.toMatch(/\b(VS|US|FS)\d/);
  });
  it('maps sheet mm to plotter units exactly and closes every loop', () => {
    const sq = [[100, 100], [150, 100], [150, 130], [100, 130]];
    const m = moves(writePlt(FRAME, OPTS, [sq])).slice(3, -1); // after the start-arrow V cut, before the park move
    expect(m[0].pen).toBe('U');
    const pts = m.map(toSheet);
    for (const p of pts) expect(sq.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9)).toBe(true);
    expect(pts[pts.length - 1]).toEqual(pts[0]);
  });
  it('adds the overcut past the start point', () => {
    const sq = [[100, 100], [150, 100], [150, 130], [100, 130]];
    const plain = moves(writePlt(FRAME, OPTS, [sq])).slice(0, -1), over = moves(writePlt(FRAME, { ...OPTS, overcut: 2 }, [sq])).slice(0, -1);
    expect(over.length).toBe(plain.length + 1);
    const [a, b] = [toSheet(over[over.length - 2]), toSheet(over[over.length - 1])];
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(2, 1);
  });
});

describe('dragKnife', () => {
  it('leaves the path alone with no blade offset (apart from micro-moves)', () => {
    const tip = [[0, 0], [100, 0], [100, 1], [100, 100]];
    expect(dragKnife(tip, 0, [1, 0]).pts).toEqual([[0, 0], [100, 0], [100, 100]]);
  });
  it('overshoots a sharp corner by the offset and swivels around it', () => {
    const R = 14, { pts } = dragKnife([[0, 0], [400, 0], [400, 400]], R, [1, 0]);
    expect(pts[0]).toEqual([R, 0]);
    expect(pts).toContainEqual([400 + R, 0]);
    expect(pts[pts.length - 1]).toEqual([400, 400 + R]);
    for (const p of pts.slice(2, -1)) expect(Math.hypot(p[0] - 400, p[1])).toBeCloseTo(R, 6);
  });
});

describe('modifyPlt', () => {
  const plt = writePlt(FRAME, OPTS, [[[100, 100], [150, 100], [150, 130], [100, 130]], [[200, 200], [220, 200], [220, 220], [200, 220]]]);
  it('reads and rewrites force, speed and up-speed', () => {
    expect(pltValues(plt)).toEqual({ force: 60, speed: 13, up: 10 });
    expect(pltValues(modifyPlt(plt, { force: 95, speed: 5, up: 7 }))).toEqual({ force: 95, speed: 5, up: 7 });
  });
  it('adds force to a file that has none', () => {
    const bare = writePlt(FRAME, { ...OPTS, pltForce: false }, []);
    expect(pltValues(modifyPlt(bare, { force: 30 })).force).toBe(30);
  });
  it('cutting twice repeats every cut but not the start arrow or the park move', () => {
    const once = moves(plt), twice = moves(modifyPlt(plt, { twice: true }));
    expect(twice.length).toBe(once.length + (once.length - 3 - 1));
  });
  it('fix dense paths keeps closed outlines intact with no overcut (regression)', () => {
    const tok = plt.split(/\s+/), first = tok.findIndex(isMove);
    const r = cleanMoves(tok, first);
    const before = moves(plt), after = moves(r.tok.join(' '));
    expect(after).toEqual(before); // nothing to simplify in a square: nothing may be dropped
  });
});
