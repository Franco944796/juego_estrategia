import { describe, expect, it } from 'vitest';
import { distance, windFactor } from '../src/geometry';

const O = { x: 0, y: 0 };
const NORTH = 0;
const NORTH_EAST = 1;

describe('wind factor', () => {
  it('doubles with a tailwind, keeps a crosswind, halves a headwind', () => {
    expect(windFactor(O, { x: 0, y: -10 }, NORTH, 2, 0.5)).toBe(2);
    expect(windFactor(O, { x: 10, y: 0 }, NORTH, 2, 0.5)).toBe(1);
    expect(windFactor(O, { x: 0, y: 10 }, NORTH, 2, 0.5)).toBe(0.5);
  });

  it('interpolates linearly in the cosine', () => {
    expect(windFactor(O, { x: 10, y: -10 }, NORTH, 2, 0.5)).toBeCloseTo(1 + Math.SQRT1_2, 12);
    expect(windFactor(O, { x: -10, y: 10 }, NORTH, 2, 0.5)).toBeCloseTo(1 - 0.5 * Math.SQRT1_2, 12);
    expect(windFactor(O, { x: 10, y: -10 }, NORTH_EAST, 2, 0.5)).toBeCloseTo(2, 12);
  });

  it('respects a raised headwind floor', () => {
    expect(windFactor(O, { x: 0, y: 10 }, NORTH, 2, 0.75)).toBe(0.75);
  });

  it('is neutral for zero-length trips or unknown directions', () => {
    expect(windFactor(O, O, NORTH, 2, 0.5)).toBe(1);
    expect(windFactor(O, { x: 1, y: 0 }, 99, 2, 0.5)).toBe(1);
  });

  it('measures euclidean distance', () => {
    expect(distance({ x: 1, y: 2 }, { x: 4, y: 6 })).toBe(5);
  });
});
