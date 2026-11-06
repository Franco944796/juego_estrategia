import { formatNumber } from '../format';
import { abandonGame, finishTutorial, seasonGemCount, startNewGame } from '../game/session';
import { t, type MessageKey } from '../i18n';
import { useGame } from '../store';
import { leagueName } from './labels';
import { bandLabel } from './Profile';

const TUTORIAL: MessageKey[] = ['tut1', 'tut2', 'tut3', 'tut4', 'tut5'];
/** Steps that advance by themselves when the player does what they ask. */
const ACTION_STEPS = 3;

function Tutorial() {
  const step = useGame((s) => s.tutorial);
  const lang = useGame((s) => s.lang);
  const setTutorial = useGame((s) => s.setTutorial);
  if (step === null) return null;
  const key = TUTORIAL[step];
  if (!key) return null;
  const last = step === TUTORIAL.length - 1;
  return (
    <div className="bubble" role="status" data-testid="tutorial" data-step={step}>
      <p>{t(lang, key)}</p>
      <div className="bubble-actions">
        {step >= ACTION_STEPS && (
          <button
            type="button"
            className="small primary"
            data-testid="tutorial-next"
            onClick={() => (last ? finishTutorial() : setTutorial(step + 1))}
          >
            {t(lang, last ? 'play' : 'next')}
          </button>
        )}
        {!last && (
          <button type="button" className="small" data-testid="tutorial-skip" onClick={finishTutorial}>
            {t(lang, 'skip')}
          </button>
        )}
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast tone-${toast.tone}`}
          onClick={() => dismiss(toast.id)}
        >
          {toast.text}
        </button>
      ))}
    </div>
  );
}

export function TopStack() {
  return (
    <div className="top-stack">
      <Tutorial />
      <Toasts />
    </div>
  );
}

export function PickBanner() {
  const lang = useGame((s) => s.lang);
  const closeSheet = useGame((s) => s.closeSheet);
  return (
    <div className="pick-banner" data-testid="pick-banner">
      <span>{t(lang, 'pickTarget')}</span>
      <button type="button" className="small" onClick={closeSheet}>
        {t(lang, 'cancel')}
      </button>
    </div>
  );
}

export function EndScreen() {
  const view = useGame((s) => s.view);
  const lang = useGame((s) => s.lang);
  const online = useGame((s) => s.mode === 'online');
  if (!view || online || view.season.status !== 'ENDED') return null;
  const mine = view.standings.find((s) => s.lordId === view.me.id);
  const champion = view.standings[0];
  const gems = seasonGemCount(view.standings, view.me.id);
  const stats: [MessageKey, number][] = [
    ['statCaptures', view.me.stats.captures],
    ['statWins', view.me.stats.battlesWon],
    ['statKills', view.me.stats.troopsKilled],
  ];
  const again = (): void => {
    abandonGame();
    startNewGame(view.lords.length - 1);
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" data-testid="end-screen">
      <div className="modal-card">
        <h2>{t(lang, 'endTitle')}</h2>
        {champion && <p className="tone-good">{t(lang, 'champion', { name: champion.name })}</p>}
        {mine && <p>{t(lang, 'yourRank', { rank: mine.rank, n: view.standings.length })}</p>}
        {gems > 0 && (
          <p className="tone-good" data-testid="end-gems">
            {t(lang, 'endGems', { n: gems, league: leagueName(lang, 0) })}
          </p>
        )}
        <dl className="end-stats">
          {stats.map(([key, value]) => (
            <div key={key}>
              <dt>{t(lang, key)}</dt>
              <dd>{formatNumber(value, lang)}</dd>
            </div>
          ))}
        </dl>
        <ol className="end-ranking">
          {view.standings.map((s) => (
            <li key={s.lordId} className={s.lordId === view.me.id ? 'me' : undefined}>
              <span className="owner-dot small" style={{ background: s.color }} /> {s.name} ·{' '}
              {formatNumber(s.dominion, lang)}
            </li>
          ))}
        </ol>
        <button type="button" className="primary" onClick={again}>
          {t(lang, 'playAgain')}
        </button>
      </div>
    </div>
  );
}

export function SeasonNews() {
  const news = useGame((s) => s.seasonNews);
  const lang = useGame((s) => s.lang);
  if (!news) return null;
  const close = (): void => useGame.setState({ seasonNews: null });
  return (
    <div className="modal" role="dialog" aria-modal="true" data-testid="season-news">
      <div className="modal-card">
        <h2>{t(lang, 'seasonEndedTitle', { n: news.finished.id })}</h2>
        <p className={news.reward ? 'tone-good' : 'muted'}>
          {news.reward
            ? t(lang, 'seasonReward', {
                rank: news.reward.rank,
                band: bandLabel(lang, news.reward.tier),
                legacy: news.reward.legacy,
              })
            : t(lang, 'seasonNoReward')}
          {news.reward && news.reward.gems > 0 && (
            <>
              {' '}
              {t(lang, 'seasonGems', { n: news.reward.gems, league: leagueName(lang, news.finished.league) })}
            </>
          )}
        </p>
        {news.move && (
          <p
            className={
              news.move.to > news.move.from ? 'tone-good' : news.move.to < news.move.from ? 'tone-bad' : ''
            }
          >
            <strong data-testid="league-move">
              {t(
                lang,
                news.move.to > news.move.from
                  ? 'moveUp'
                  : news.move.to < news.move.from
                    ? 'moveDown'
                    : 'moveStay',
                {
                  name: leagueName(lang, news.move.to),
                },
              )}
            </strong>
          </p>
        )}
        <ol className="end-ranking">
          {news.top.slice(0, 5).map((row) => (
            <li key={row.lordId}>
              <span className="owner-dot small" style={{ background: row.color }} /> {row.name} ·{' '}
              {formatNumber(row.dominion, lang)}
            </li>
          ))}
        </ol>
        <p>{t(lang, 'newSeasonStarted')}</p>
        <button type="button" className="primary" onClick={close}>
          {t(lang, 'next')}
        </button>
      </div>
    </div>
  );
}

export function ConnectionBanner() {
  const lang = useGame((s) => s.lang);
  const lost = useGame((s) => s.mode === 'online' && !s.connected);
  if (!lost) return null;
  return (
    <div className="connection-banner" role="status">
      {t(lang, 'connectionLost')}
    </div>
  );
}
