import type { Vec } from './types';

const D = Math.SQRT1_2;

/** Unit vectors toward which the wind blows, clockwise from north; screen y grows downward. */
export const WIND_VECTORS: readonly Vec[] = [
  { x: 0, y: -1 },
  { x: D, y: -D },
  { x: 1, y: 0 },
  { x: D, y: D },
  { x: 0, y: 1 },
  { x: -D, y: D },
  { x: -1, y: 0 },
  { x: -D, y: -D },
];

// Only +, −, ×, ÷ and sqrt (all correctly rounded in IEEE 754), so results match on every JS engine.
export function distance(a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Piecewise-linear in the cosine between travel and wind:
 * tailwind → tailwindMax, crosswind → 1, headwind → headwindMin.
 */
export function windFactor(
  from: Vec,
  to: Vec,
  windDir: number,
  tailwindMax: number,
  headwindMin: number,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const wind = WIND_VECTORS[windDir];
  if (len === 0 || wind === undefined) return 1;
  const cos = (dx * wind.x + dy * wind.y) / len;
  return cos >= 0 ? 1 + (tailwindMax - 1) * cos : 1 + (1 - headwindMin) * cos;
}
