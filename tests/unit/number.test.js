import { describe, it, expect } from 'vitest';
import { checkNum, normalizeNum, parseNum, stepNum } from '../../src/core/number.js';

describe('parseNum', () => {
  it('reads a decimal comma as a point, never as ×10', () => {
    expect(parseNum('100,5')).toBe(100.5);
    expect(parseNum('0,35')).toBe(0.35);
    expect(parseNum(',5')).toBe(0.5);
    expect(parseNum('100.5')).toBe(100.5);
  });
  it('drops spaces (also no-break ones) and takes a typographic minus', () => {
    expect(parseNum(' 1 370 ')).toBe(1370);
    expect(parseNum('1 370,5')).toBe(1370.5);
    expect(parseNum('−5')).toBe(-5);
    expect(parseNum('-0,5')).toBe(-0.5);
  });
  it('is NaN for empty text and anything that is not one number', () => {
    for (const s of ['', '  ', 'abc', '12abc', '1.000,5', '1,2,3', '-', '.', null, undefined]) expect(parseNum(s)).toBeNaN();
  });
  it('normalizes what the field shows while typing', () => {
    expect(normalizeNum('100,')).toBe('100.');
    expect(normalizeNum('1 370,5')).toBe('1370.5');
  });
});

describe('checkNum', () => {
  const force = { min: 1, max: 160, unit: 'g', blankOk: false };
  it('accepts values in range', () => {
    expect(checkNum('60', force).ok).toBe(true);
    expect(checkNum('160', force).ok).toBe(true);
    expect(checkNum('100,5', { min: 5 }).ok).toBe(true);
  });
  it('says the range and the value it would be cut to when out of range', () => {
    const r = checkNum('600', force);
    expect(r.ok).toBe(false); expect(r.near).toBe(160);
    expect(r.text).toContain('1–160 g'); expect(r.text).toContain('160 g');
    expect(checkNum('-5', force)).toMatchObject({ ok: false, near: 1 });
    expect(checkNum('0', { min: 5 })).toMatchObject({ ok: false, near: 5 });
  });
  it('rejects text that is not a number, and empty only where the field needs a value', () => {
    expect(checkNum('12abc', force).ok).toBe(false);
    expect(checkNum('', force).ok).toBe(false);
    expect(checkNum('', { min: 0 }).ok).toBe(true);
  });
});

describe('stepNum', () => {
  it('steps on the grid of the step from the lowest value, within the range', () => {
    expect(stepNum('2', 1, { min: 0, step: 0.5 })).toBe('2.5');
    expect(stepNum('2,3', 1, { min: 0, step: 0.5 })).toBe('2.5');
    expect(stepNum('2.3', -1, { min: 0, step: 0.5 })).toBe('2');
    expect(stepNum('0.35', 1, { min: 0, max: 2, step: 0.025 })).toBe('0.375');
    expect(stepNum('160', 1, { min: 1, max: 160 })).toBe('160');
    expect(stepNum('600', -1, { min: 1, max: 160 })).toBe('160');
    expect(stepNum('', 1, { min: 1, max: 160 })).toBe('1');
    expect(stepNum('0', -1, { step: 0.1 })).toBe('-0.1');
  });
});
