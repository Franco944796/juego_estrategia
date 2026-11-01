import { formatDecimal, formatDuration, formatNumber } from '../format';
import { t, WIND_NAMES } from '../i18n';
import { toRealMs, useGame } from '../store';
import { useGameNow } from './hooks';
import { CoinIcon, CrownIcon, StarIcon, WindArrow } from './icons';
import { ownerName } from './labels';

export function Hud() {
  const view = useGame((s) => s.view);
  const clock = useGame((s) => s.clock);
  const lang = useGame((s) => s.lang);
  const now = useGameNow();
  if (!view) return null;
  const { me, season, wind } = view;
  const real = (gameMs: number): string => formatDuration(toRealMs(clock, gameMs));
  const throneTown = view.towns[season.throneTownId];
  let throne = t(lang, 'throneFree');
  if (!season.throneUnsealed) throne = t(lang, 'throneSealed', { t: real(season.throneUnsealAt - now) });
  else if (throneTown?.owner)
    throne = t(lang, 'throneHeld', { name: ownerName(lang, view, throneTown.owner) });
  const gloryShare = me.nextGlory ? Math.min(1, me.glory / me.nextGlory) : 1;
  let time = t(lang, 'timeLeft', { t: real(season.endsAt - now) });
  if (season.status === 'ENDED') time = t(lang, 'seasonOver');
  else if (clock.rate === 0) time = t(lang, 'paused');

  return (
    <header className="hud">
      <div className="hud-main">
        <div className="hud-stats">
          <div className="stat" data-testid="hud-gold" title={t(lang, 'gold')}>
            <CoinIcon className="stat-icon gold" />
            <span className="stat-text">
              <span className="stat-value">{formatNumber(me.gold, lang)}</span>
              <span className="stat-sub">
                +{t(lang, 'perMin', { n: formatDecimal(me.goldPerMin, lang) })}
              </span>
            </span>
          </div>
          <div className="stat" data-testid="hud-dominion" title={t(lang, 'dominion')}>
            <CrownIcon className="stat-icon dominion" />
            <span className="stat-text">
              <span className="stat-value">{formatNumber(me.dominion, lang)}</span>
              <span className="stat-sub">
                +{t(lang, 'perMin', { n: formatDecimal(me.dominionPerMin, lang) })}
              </span>
            </span>
          </div>
          <div className="stat" data-testid="hud-glory" title={t(lang, 'glory')}>
            <StarIcon className="stat-icon glory" />
            <span className="stat-text">
              <span className="stat-value">{Math.floor(me.glory)}</span>
              <span className="meter" aria-hidden="true">
                <span className="meter-fill" style={{ width: `${gloryShare * 100}%` }} />
              </span>
            </span>
          </div>
        </div>
        <div className="hud-chips">
          <span className="chip" data-testid="hud-time">
            {time}
          </span>
          <span className="chip">{throne}</span>
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
