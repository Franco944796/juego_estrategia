import { formatNumber } from '../format';
import { HUMAN_ID } from '../game/protocol';
import { abandonGame, finishTutorial, startNewGame } from '../game/session';
import { t, type MessageKey } from '../i18n';
import { useGame } from '../store';

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
  if (!view || view.season.status !== 'ENDED') return null;
  const mine = view.standings.find((s) => s.lordId === HUMAN_ID);
  const champion = view.standings[0];
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
            <li key={s.lordId} className={s.lordId === HUMAN_ID ? 'me' : undefined}>
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
