import { defaultConfig } from '@si/config';
import { GEAR_EFFECTS, GEAR_SLOTS, RARITIES, SKILL_IDS } from '@si/config/constants';
import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES,
  messageKeys,
  RULE_TEXT,
  SERVER_TEXT,
  STYLE_NAMES,
  t,
  WIND_NAMES,
  type MessageKey,
} from '../src/i18n';

describe('i18n', () => {
  it('has the same keys in both languages and no empty strings', () => {
    expect(messageKeys('en').sort()).toEqual(messageKeys('es').sort());
    for (const key of messageKeys('es')) {
      expect(t('es', key as MessageKey).trim()).not.toBe('');
      expect(t('en', key as MessageKey).trim()).not.toBe('');
    }
  });

  it('fills placeholders and leaves unknown ones', () => {
    expect(t('en', 'tier', { n: 3 })).toBe('Level 3');
    expect(t('es', 'tier')).toBe('Nivel {n}');
  });

  it('covers every skill, rule code, wind direction and bot slot', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const id of SKILL_IDS) expect(messageKeys(lang)).toContain(`skill${id}`);
      expect(Object.keys(RULE_TEXT[lang])).toHaveLength(16);
      for (const slot of GEAR_SLOTS) expect(messageKeys(lang)).toContain(`slot${slot}`);
      for (const rarity of RARITIES) expect(messageKeys(lang)).toContain(`rarity${rarity}`);
      for (const effect of Object.values(GEAR_EFFECTS))
        expect(messageKeys(lang)).toContain(`effect${effect}`);
      for (const style of defaultConfig.cosmetics.styles) expect(STYLE_NAMES[lang][style.id]).toBeTruthy();
      expect(Object.keys(SERVER_TEXT[lang]).sort()).toEqual(Object.keys(SERVER_TEXT.es).sort());
      expect(WIND_NAMES[lang]).toHaveLength(8);
      expect(BOT_NAMES[lang]).toHaveLength(11);
    }
  });
});
