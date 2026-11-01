import { defaultConfig } from '@si/config';
import { useState } from 'react';
import { continueGame, DEMO_BOTS, readSave, rememberLang, startNewGame } from '../game/session';
import { BOT_NAMES, LANGS, t } from '../i18n';
import { useGame } from '../store';

const MIN_BOTS = 3;

export function TitleScreen() {
  const lang = useGame((s) => s.lang);
  const setLang = useGame((s) => s.setLang);
  const [bots, setBots] = useState(DEMO_BOTS);
  const [hasSave] = useState(() => readSave() !== null);
  const maxBots = Math.min(BOT_NAMES[lang].length, (defaultConfig.map.rings.at(-1)?.isles ?? 1) - 1);

  return (
    <main className="title-screen">
      <div className="title-card">
        <svg className="title-art" viewBox="0 0 240 90" aria-hidden="true">
          <ellipse cx="60" cy="58" rx="34" ry="9" fill="#4f3b2c" />
          <ellipse cx="60" cy="50" rx="36" ry="12" fill="#5b8f3e" />
          <ellipse cx="170" cy="40" rx="44" ry="11" fill="#4f3b2c" />
          <ellipse cx="170" cy="31" rx="46" ry="14" fill="#9d86cf" />
          <path d="M160 26l5-9 5 6 5-6 5 9z" fill="#ffd166" />
          <path
            d="M20 20h40M30 12h30M190 70h40M200 78h25"
            stroke="#ffffff55"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <h1>{defaultConfig.meta.gameTitle}</h1>
        <p className="tagline">{t(lang, 'tagline')}</p>

        <label className="field">
          <span>{t(lang, 'rivals')}</span>
          <select data-testid="bots-select" value={bots} onChange={(e) => setBots(Number(e.target.value))}>
            {Array.from({ length: maxBots - MIN_BOTS + 1 }, (_, i) => MIN_BOTS + i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="segmented" role="group" aria-label={t(lang, 'language')}>
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => {
                setLang(l);
                rememberLang(l);
              }}
            >
              {t(l, 'langName')}
            </button>
          ))}
        </div>

        <div className="title-actions">
          {hasSave && (
            <button type="button" data-testid="continue-game" onClick={() => continueGame()}>
              {t(lang, 'continue')}
            </button>
          )}
          <button type="button" className="primary" data-testid="new-game" onClick={() => startNewGame(bots)}>
            {t(lang, 'newSeason')}
          </button>
        </div>
      </div>
    </main>
  );
}
