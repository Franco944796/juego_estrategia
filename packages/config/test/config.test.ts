import { describe, expect, it } from 'vitest';
import { defaultConfig, validateConfig, withOverrides } from '../src/index';

describe('config', () => {
  it('validates the defaults', () => {
    expect(validateConfig(defaultConfig)).toEqual(defaultConfig);
  });

  it('merges overrides deeply and replaces arrays whole', () => {
    const cfg = withOverrides(defaultConfig, {
      season: { durationMin: 60 },
      towns: { goldPerMin: 7 },
      neutral: { garrison: [1, 2, 3, 4, 5] },
    });
    expect(cfg.season.durationMin).toBe(60);
    expect(cfg.towns.goldPerMin).toBe(7);
    expect(cfg.neutral.garrison).toEqual([1, 2, 3, 4, 5]);
    expect(cfg.towns.troopsPerMin).toBe(defaultConfig.towns.troopsPerMin);
    expect(cfg.wind).toEqual(defaultConfig.wind);
    expect(defaultConfig.season.durationMin).toBe(360);
  });

  it.each([
    ['too few neutral garrisons', { neutral: { garrison: [1, 2] } }],
    ['a level scale that does not grow', { towns: { scale: { second: 3, top: 2 } } }],
    ['lord levels above the town levels', { levels: { maxLevel: 101 } }],
    [
      'drop odds out of order',
      {
        gear: {
          dropOdds: [
            { minLevel: 5, weights: [1, 0, 0, 0] },
            { minLevel: 5, weights: [0, 1, 0, 0] },
          ],
        },
      },
    ],
    [
      'a lowest league that relegates',
      { leagues: [{ id: 'X', legacyMult: 1, promoteShare: 0, relegateShare: 0.5, gemBonus: 0.025 }] },
    ],
    [
      'a top league that promotes',
      { leagues: [{ id: 'X', legacyMult: 1, promoteShare: 0.5, relegateShare: 0, gemBonus: 0.025 }] },
    ],
    ['drop odds without four weights', { gear: { dropOdds: [{ minLevel: 1, weights: [1, 1] }] } }],
    ['isle tiers that do not match the bands', { map: { isle: { tiers: [3, 2] } } }],
    ['isle tiers above the maximum', { map: { isle: { tiers: [101, 2, 1] } } }],
    ['a capital above the maximum tier', { lords: { capitalTier: 101 } }],
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
    expect(liveConfig.towns.goldPerMin).toBe(defaultConfig.towns.goldPerMin);
    expect(liveConfig.towns.troopsPerMin).toBe(defaultConfig.towns.troopsPerMin);
    expect(liveConfig.towns.upgradeCost).toBe(defaultConfig.towns.upgradeCost * 40);
    // Same real seconds per march in both: live game time is real time, demo runs ×20.
    expect(liveConfig.march.landSpeed).toBe(defaultConfig.march.landSpeed * 20);
    expect(liveConfig.march.minDurationMin).toBeCloseTo(defaultConfig.march.minDurationMin / 20, 12);
  });

  it('rejects rewards that do not end at the whole field and paid default styles', () => {
    expect(() =>
      withOverrides(defaultConfig, { rewards: { tiers: [{ topShare: 0.5, legacy: 1, gems: 1 }] } }),
    ).toThrow();
    expect(() => withOverrides(defaultConfig, { cosmetics: { styles: [{ id: 'x', cost: 5 }] } })).toThrow();
  });
});
