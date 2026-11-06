import { describe, expect, it } from 'vitest';
import { themeAt } from '../src/theme';

describe('theme by the hour', () => {
  it('is parchment from 7:00 to 18:59 and night the rest', () => {
    const at = (hour: number, minute = 0) => themeAt(new Date(2026, 10, 6, hour, minute));
    expect(at(6, 59)).toBe('noche');
    expect(at(7)).toBe('pergamino');
    expect(at(12)).toBe('pergamino');
    expect(at(18, 59)).toBe('pergamino');
    expect(at(19)).toBe('noche');
    expect(at(0)).toBe('noche');
  });
});
