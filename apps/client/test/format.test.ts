import { describe, expect, it } from 'vitest';
import { formatDecimal, formatDuration, formatNumber, formatRate, townName } from '../src/format';

describe('formatting', () => {
  it('abbreviates large numbers to three significant digits', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999.9)).toBe('999');
    expect(formatNumber(1450)).toBe('1.45K');
    expect(formatNumber(14_560)).toBe('14.5K');
    expect(formatNumber(145_600)).toBe('145K');
    expect(formatNumber(1_450_000)).toBe('1.45M');
    expect(formatNumber(35_800_000_000)).toBe('35.8G');
    expect(formatNumber(-2500)).toBe('-2.50K');
    expect(formatNumber(1450, 'es')).toBe('1,45K');
  });

  it('formats decimals with the language mark', () => {
    expect(formatDecimal(5.25, 'en')).toBe('5.3');
    expect(formatDecimal(5.25, 'es', 2)).toBe('5,25');
  });

  it('keeps a decimal on small rates and suffixes on big ones', () => {
    expect(formatRate(7.5, 'es')).toBe('7,5');
    expect(formatRate(2_355_162.8, 'es')).toBe('2,35M');
    expect(formatRate(1e13, 'en')).toBe('10.0T');
  });

  it('formats durations as m:ss or h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-500)).toBe('0:00');
    expect(formatDuration(61_000)).toBe('1:01');
    expect(formatDuration(59_100)).toBe('1:00');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(86_400_000 * 29 + 3_600_000 * 23)).toBe('29d 23h');
  });

  it('names towns uniquely', () => {
    const names = Array.from({ length: 144 }, (_, i) => townName(i));
    expect(new Set(names).size).toBe(144);
    expect(townName(0)).toBe('Brumar');
    expect(townName(150)).not.toBe(townName(6));
  });
});
