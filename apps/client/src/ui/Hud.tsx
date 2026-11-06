import { formatDuration, formatNumber, formatRate } from '../format';
import { t, WIND_NAMES } from '../i18n';
import { toRealMs, useGame } from '../store';
import { useGameNow } from './hooks';
import { Gem } from './Gem';
import { CoinIcon, CrownIcon, HelmetIcon, WindArrow } from './icons';
import { ownerName, townById } from './labels';

export function Hud() {
  const view = useGame((s) => s.view);
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const clock = useGame((s) => s.clock);
  const lang = useGame((s) => s.lang);
  const now = useGameNow();
  if (!view) return null;
  const { me, season, wind } = view;
  const real = (gameMs: number): string => formatDuration(toRealMs(clock, gameMs));
  const throneTown = townById(view, season.throneTownId);
  let throne: string | null = null;
  if (throneTown && !season.throneUnsealed)
    throne = t(lang, 'throneSealed', { t: real(season.throneUnsealAt - now) });
  else if (throneTown?.owner)
    throne = t(lang, 'throneHeld', { name: ownerName(lang, view, throneTown.owner) });
  else if (throneTown) throne = t(lang, 'throneFree');
  const levelShare = me.nextLevelXp ? Math.min(1, me.xp / me.nextLevelXp) : 1;
  let time = t(lang, 'timeLeft', { t: real(season.endsAt - now) });
  if (season.status === 'ENDED') time = t(lang, 'seasonOver');
  else if (clock.rate === 0) time = t(lang, 'paused');

  return (
    <header className="hud">
      <div className="hud-main">
        <div className="hud-stats">
          <div className="stat" data-testid="hud-gold" title={t(lang, 'gold')}>
            <Gem kind="topaz">
              <CoinIcon size={16} />
            </Gem>
            <span className="stat-text">
              <span className="stat-value">
                {me.dev ? t(lang, 'unlimited') : formatNumber(me.gold, lang)}
              </span>
              <span className="stat-sub">+{t(lang, 'perMin', { n: formatRate(me.goldPerMin, lang) })}</span>
            </span>
          </div>
          <div className="stat" data-testid="hud-dominion" title={t(lang, 'dominion')}>
            <Gem kind="amethyst">
              <CrownIcon size={16} />
            </Gem>
            <span className="stat-text">
              <span className="stat-value">{formatNumber(me.dominion, lang)}</span>
              <span className="stat-sub">
                +{t(lang, 'perMin', { n: formatRate(me.dominionPerMin, lang) })}
              </span>
            </span>
          </div>
          <button
            type="button"
            className={`stat portrait${panel === 'profile' ? ' active' : ''}`}
            data-testid="portrait"
            aria-label={t(lang, 'openProfile')}
            aria-pressed={panel === 'profile'}
            title={t(lang, 'levelTitle')}
            onClick={() => setPanel(panel === 'profile' ? null : 'profile')}
          >
            <span className="avatar" style={{ borderColor: me.color }}>
              <HelmetIcon size={18} />
            </span>
            <span className="stat-text">
              <span className="stat-value">{t(lang, 'levelShort', { n: me.level })}</span>
              <span className="meter" aria-hidden="true">
                <span className="meter-fill level" style={{ width: `${levelShare * 100}%` }} />
              </span>
            </span>
            {me.skillPoints > 0 && (
              <span className="inline-badge" data-testid="portrait-points">
                {me.skillPoints}
              </span>
            )}
          </button>
        </div>
        <div className="hud-chips">
          <span className="chip" data-testid="hud-time">
            {time}
          </span>
          {throne && <span className="chip">{throne}</span>}
        </div>
      </div>
      <div className="wind-rose" data-testid="hud-wind" title={t(lang, 'wind')}>
        <span className="rose">
          <WindArrow dir={wind.dir} size={26} />
        </span>
        <span className="rose-text">
          <strong>{WIND_NAMES[lang][wind.dir]}</strong>
          {wind.nextShiftAt !== null && <span> · {real(wind.nextShiftAt - now)}</span>}
        </span>
        <span className="rose-forecast" aria-hidden="true">
          {wind.forecast.map((f) => (
            <WindArrow key={f.at} dir={f.dir} size={13} />
          ))}
        </span>
      </div>
    </header>
  );
}
