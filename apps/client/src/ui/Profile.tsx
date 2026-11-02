import { defaultConfig } from '@si/config';
import type { HallResponse } from '@si/protocol';
import { useEffect, useState } from 'react';
import { formatNumber } from '../format';
import { equipStyle, leaveOnline, loadHall, refreshProfile, unlockStyle } from '../game/session';
import { STYLE_NAMES, t, type MessageKey } from '../i18n';
import { leagueName } from './labels';
import { useGame } from '../store';

const BANDS: MessageKey[] = ['band0', 'band1', 'band2', 'band3'];

export function bandLabel(lang: 'es' | 'en', tier: number): string {
  return t(lang, BANDS[tier] ?? 'band3');
}

/** Online-only part of the menu: Legacy, styles, medals, recovery code and the hall of fame. */
export function Profile() {
  const lang = useGame((s) => s.lang);
  const profile = useGame((s) => s.profile);
  const token = useGame((s) => s.token);
  const [copied, setCopied] = useState(false);
  const [hall, setHall] = useState<HallResponse | null>(null);

  useEffect(() => {
    void refreshProfile().catch(() => undefined);
    void loadHall()
      .then(setHall)
      .catch(() => undefined);
  }, []);

  if (!profile) return null;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(token ?? '');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="profile" data-testid="profile">
      <h3>{t(lang, 'profile')}</h3>
      <p>
        <strong>{profile.name}</strong> ·{' '}
        <span data-testid="my-league">
          {t(lang, 'yourLeague', { name: leagueName(lang, profile.league) })}
        </span>{' '}
        ·{' '}
        {t(lang, 'legacyBalance', {
          n: formatNumber(profile.legacy, lang),
          total: formatNumber(profile.legacyTotal, lang),
        })}
      </p>

      <h3>{t(lang, 'stylesTitle')}</h3>
      <div className="styles-grid">
        {defaultConfig.cosmetics.styles.map((style) => {
          const owned = profile.styles.includes(style.id);
          const inUse = profile.style === style.id;
          return (
            <div key={style.id} className={`style-card${inUse ? ' in-use' : ''}`}>
              <span>{STYLE_NAMES[lang][style.id] ?? style.id}</span>
              {inUse ? (
                <span className="muted">{t(lang, 'styleInUse')}</span>
              ) : owned ? (
                <button type="button" className="small" onClick={() => void equipStyle(style.id)}>
                  {t(lang, 'styleUse')}
                </button>
              ) : (
                <button
                  type="button"
                  className="small"
                  disabled={profile.legacy < style.cost}
                  onClick={() => void unlockStyle(style.id)}
                >
                  {t(lang, 'styleUnlock', { n: style.cost })}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h3>{t(lang, 'medals')}</h3>
      {profile.medals.length === 0 ? (
        <p className="muted">{t(lang, 'noMedals')}</p>
      ) : (
        <ul className="list">
          {[...profile.medals].reverse().map((m) => (
            <li key={m.season} className="report">
              {t(lang, 'medalLine', {
                season: m.season,
                league: leagueName(lang, m.league ?? 0),
                rank: m.rank,
                of: m.of,
                band: bandLabel(lang, m.tier),
                legacy: m.legacy,
              })}
            </li>
          ))}
        </ul>
      )}

      <h3>{t(lang, 'recoveryCode')}</h3>
      <p className="muted">{t(lang, 'recoveryHelp')}</p>
      <div className="code-row">
        <code className="code" data-testid="recovery-code">
          {token}
        </code>
        <button type="button" className="small" onClick={() => void copy()}>
          {copied ? t(lang, 'copied') : t(lang, 'copy')}
        </button>
      </div>

      <h3>
        {t(lang, 'hallTitle')} · {leagueName(lang, profile.league)}
      </h3>
      {!hall || hall.seasons.length === 0 ? (
        <p className="muted">{t(lang, 'noHall')}</p>
      ) : (
        hall.seasons.map((season) => (
          <div key={season.id} className="report">
            <strong>{t(lang, 'hallSeason', { n: season.id })}</strong>
            {season.clans[0] && (
              <p className="muted">
                {t(lang, 'hallClan', { name: season.clans[0].name, tag: season.clans[0].tag })}
              </p>
            )}
            <ol className="end-ranking">
              {season.top.slice(0, 3).map((row) => (
                <li key={row.lordId}>
                  <span className="owner-dot small" style={{ background: row.color }} /> {row.name} ·{' '}
                  {formatNumber(row.dominion, lang)}
                </li>
              ))}
            </ol>
          </div>
        ))
      )}

      <div className="actions">
        <button type="button" onClick={leaveOnline}>
          {t(lang, 'leaveWorld')}
        </button>
      </div>
    </div>
  );
}
