import { describe, expect, it } from 'vitest';
import { advanceTo } from '../src/game';
import { hashState, hashString, stableStringify } from '../src/hash';
import { bots, game, humans, MIN, T0 } from './helpers';

describe('hashing', () => {
  it('ignores key order and undefined fields, not array order', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe('{"a":[2,{"d":3}],"b":1}');
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify(undefined)).toBe('null');
    expect(hashString('a')).not.toBe(hashString('b'));
    expect(hashString('')).toHaveLength(14);
  });

  it('changes with the state and survives a JSON round trip', () => {
    const state = game({ lords: [...humans(1), ...bots(3)] });
    const before = hashState(state);
    advanceTo(state, T0 + 60 * MIN);
    expect(hashState(state)).not.toBe(before);

    const copy = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(hashState(copy)).toBe(hashState(state));
    advanceTo(state, state.endsAt);
    advanceTo(copy, copy.endsAt);
    expect(hashState(copy)).toBe(hashState(state));
  });
});
