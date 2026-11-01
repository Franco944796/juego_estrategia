import { defaultConfig, withOverrides } from '@si/config';
import { describe, expect, it } from 'vitest';
import { mean, median, meets, renderReport, simulateSeason, TARGETS } from '../src/simulate';

describe('balance simulator', () => {
  const short = withOverrides(defaultConfig, { season: { durationMin: 120 } });
  const run = simulateSeason(short, 3, 6);

  it('measures a whole season', () => {
    expect(run.lords).toBe(6);
    expect(run.battles).toBeGreaterThan(0);
    expect(run.captures).toBeGreaterThan(0);
    expect(run.medianLandMin).toBeGreaterThan(0);
    expect(run.winnerShare).toBeGreaterThan(0);
    expect(run.winnerShare).toBeLessThanOrEqual(1);
  });

  it('summarizes and renders the targets', () => {
    const report = renderReport([run, simulateSeason(short, 4, 6)], '## Test', TARGETS.demo);
    expect(report).toContain('| Metric | Target | Result | Status |');
    for (const t of TARGETS.demo) expect(report).toContain(t.label);
  });

  it('computes medians, means and target checks', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(mean([run], 'lords')).toBe(6);
    expect(meets({ key: 'lords', label: '', min: 1, max: 3, digits: 0 }, 2)).toBe(true);
    expect(meets({ key: 'lords', label: '', max: 3, digits: 0 }, 4)).toBe(false);
    expect(meets({ key: 'lords', label: '', min: 1, digits: 0 }, null)).toBe(false);
  });
});
