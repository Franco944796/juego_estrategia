import { defaultConfig } from '@si/config';
import { EDICT_IDS, TROOP_TYPES } from '@si/config/constants';
import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES,
  EDICT_TEXT,
  messageKeys,
  RULE_TEXT,
  SERVER_TEXT,
  STYLE_NAMES,
  t,
  TROOP_NAMES,
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
    expect(t('en', 'tier', { n: 3 })).toBe('Tier 3');
    expect(t('es', 'tier')).toBe('Nivel {n}');
  });

  it('covers every troop, edict, rule code, wind direction and bot slot', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const type of TROOP_TYPES) expect(TROOP_NAMES[lang][type]).toBeTruthy();
      for (const id of EDICT_IDS) expect(EDICT_TEXT[lang][id].name).toBeTruthy();
      expect(Object.keys(RULE_TEXT[lang])).toHaveLength(15);
      for (const style of defaultConfig.cosmetics.styles) expect(STYLE_NAMES[lang][style.id]).toBeTruthy();
      expect(Object.keys(SERVER_TEXT[lang]).sort()).toEqual(Object.keys(SERVER_TEXT.es).sort());
      expect(WIND_NAMES[lang]).toHaveLength(8);
      expect(BOT_NAMES[lang]).toHaveLength(11);
    }
  });
});
