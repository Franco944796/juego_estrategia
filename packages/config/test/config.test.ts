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
    ['isle tiers that do not match the bands', { map: { isle: { tiers: [3, 2] } } }],
    ['isle tiers above the maximum', { map: { isle: { tiers: [9, 2, 1] } } }],
    ['a capital above the maximum tier', { lords: { capitalTier: 9 } }],
    ['a negative duration', { season: { durationMin: -1 } }],
  ])('rejects %s', (_label, patch) => {
    expect(() => withOverrides(defaultConfig, patch)).toThrow();
  });
});

describe('live preset', () => {
  it('runs a month in real time with immune capitals and a slower economy', async () => {
    const { liveConfig } = await import('../src/index');
    expect(liveConfig.season.durationMin).toBe(30 * 24 * 60);
    expect(liveConfig.rules.capitalImmune).toBe(true);
    expect(liveConfig.lords.capitalTier).toBe(1);
    expect(liveConfig.towns.goldPerMin[0]).toBeCloseTo(defaultConfig.towns.goldPerMin[0]! / 5, 12);
    expect(liveConfig.towns.upgradeCost[0]).toBe(defaultConfig.towns.upgradeCost[0]! * 10);
    expect(liveConfig.march).toEqual(defaultConfig.march);
  });

  it('rejects rewards that do not end at the whole field and paid default styles', () => {
    expect(() =>
      withOverrides(defaultConfig, { rewards: { tiers: [{ topShare: 0.5, legacy: 1 }] } }),
    ).toThrow();
    expect(() => withOverrides(defaultConfig, { cosmetics: { styles: [{ id: 'x', cost: 5 }] } })).toThrow();
  });
});
