import { describe, expect, it } from 'vitest';
import { defaultConfig, validateConfig, withOverrides } from '../src/index';

describe('config', () => {
  it('validates the defaults', () => {
    expect(validateConfig(defaultConfig)).toEqual(defaultConfig);
  });

  it('merges overrides deeply and replaces arrays whole', () => {
    const cfg = withOverrides(defaultConfig, {
      season: { durationMin: 60 },
      towns: { goldPerMin: [1, 2, 3, 4, 5] },
    });
    expect(cfg.season.durationMin).toBe(60);
    expect(cfg.towns.goldPerMin).toEqual([1, 2, 3, 4, 5]);
    expect(cfg.towns.troopsPerMin).toEqual(defaultConfig.towns.troopsPerMin);
    expect(cfg.wind).toEqual(defaultConfig.wind);
    expect(defaultConfig.season.durationMin).toBe(360);
  });

  it.each([
    ['a per-tier table of the wrong length', { towns: { goldPerMin: [1, 2] } }],
    ['upgrade costs of the wrong length', { towns: { upgradeCost: [1, 2, 3, 4, 5] } }],
    ['thresholds out of order', { edicts: { gloryThresholds: [10, 5] } }],
    ['an inverted range', { map: { townsPerIsle: [5, 3] as [number, number] } }],
    [
      'ring tiers above the maximum',
      { map: { rings: [{ isles: 6, radius: 270, tiers: [2, 9] as [number, number] }] } },
    ],
    ['a capital above the maximum tier', { lords: { capitalTier: 9 } }],
    ['a negative duration', { season: { durationMin: -1 } }],
  ])('rejects %s', (_label, patch) => {
    expect(() => withOverrides(defaultConfig, patch)).toThrow();
  });
});
