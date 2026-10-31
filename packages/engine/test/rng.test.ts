import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextFloat, nextInt, nextRange, nextU32, pick, seedRng, shuffle, type RngState } from '../src/rng';

describe('rng', () => {
  it('matches the reference xoshiro128** sequence', () => {
    const s: RngState = [1, 2, 3, 4];
    expect([nextU32(s), nextU32(s), nextU32(s), nextU32(s), nextU32(s)]).toEqual([
      11520, 0, 5927040, 70819200, 2031721883,
    ]);
    expect(s).toEqual([15224335, 29364750, 272377353, 1125134346]);
  });

  it('expands seeds with splitmix32', () => {
    const s = seedRng(42);
    expect(s).toEqual([939911724, 3948730756, 321366731, 3317318717]);
    expect([nextU32(s), nextU32(s), nextU32(s)]).toEqual([2837322924, 544945897, 479756282]);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = seedRng(7);
    const b = seedRng(7);
    const c = seedRng(8);
    const seqA = Array.from({ length: 8 }, () => nextU32(a));
    expect(Array.from({ length: 8 }, () => nextU32(b))).toEqual(seqA);
    expect(Array.from({ length: 8 }, () => nextU32(c))).not.toEqual(seqA);
  });

  it('keeps floats and ints inside their bounds', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: -50, max: 50 }), fc.nat(40), (seed, min, span) => {
        const s = seedRng(seed);
        for (let i = 0; i < 20; i++) {
          const f = nextFloat(s);
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(1);
          const n = nextInt(s, min, min + span);
          expect(Number.isInteger(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(min);
          expect(n).toBeLessThanOrEqual(min + span);
          const r = nextRange(s, min, min + span + 1);
          expect(r).toBeGreaterThanOrEqual(min);
          expect(r).toBeLessThan(min + span + 1);
        }
      }),
    );
  });

  it('shuffles into a permutation and picks members', () => {
    const s = seedRng(3);
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffle(s, [...items]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(items).toContain(pick(s, items));
    expect(() => pick(s, [])).toThrow();
  });
});
