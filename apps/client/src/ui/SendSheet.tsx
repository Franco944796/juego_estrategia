import type { SendPreview } from '@si/engine';
import { useEffect, useState } from 'react';
import { formatDecimal, formatDuration, formatNumber } from '../format';
import { command, preview as requestPreview } from '../game/session';
import { RULE_TEXT, t, type Lang } from '../i18n';
import { toRealMs, useGame, type Clock } from '../store';
import { useGameNow } from './hooks';
import { CloseIcon, TroopIcon } from './icons';
import { linkedIsles, townById, townLabel } from './labels';

const PREVIEW_DEBOUNCE_MS = 120;
/** Slider steps: the army is chosen as a share, since garrisons run into the billions. */
const SHARE_STEPS = 100;

function travelText(lang: Lang, p: SendPreview): string {
  if (!p.travel) return '';
  const f = formatDecimal(p.travel.windFactor, lang);
  if (!p.travel.sky) return t(lang, 'land');
  if (p.travel.windFactor > 1.05) return t(lang, 'tailwind', { f });
  if (p.travel.windFactor < 0.95) return t(lang, 'headwind', { f });
  return t(lang, 'crosswind', { f });
}

function outcomeText(lang: Lang, p: SendPreview): { text: string; tone: string } {
  if (p.reinforce) return { text: t(lang, 'reinforce'), tone: 'good' };
  if (!p.battle) return { text: t(lang, 'unknown'), tone: 'muted' };
  if (p.battle.winner === 'ATTACKER') {
    return { text: t(lang, 'win', { n: formatNumber(p.battle.attackerLost, lang) }), tone: 'good' };
  }
  return { text: t(lang, 'lose'), tone: 'bad' };
}

function waitHint(lang: Lang, p: SendPreview, clock: Clock, now: number): string | null {
  const arrival = p.arriveAt;
  if (arrival === null) return null;
  // Waiting only helps when the better wind gets the march there sooner.
  const better = p.later.find((l) => l.departAt + l.durationMs < arrival);
  if (!better) return null;
  const wait = formatDuration(toRealMs(clock, better.departAt - now));
  const arrive = formatDuration(toRealMs(clock, better.departAt + better.durationMs - now));
  return t(lang, 'waitWind', { wait, t: arrive, f: formatDecimal(better.windFactor, lang) });
}

export function SendSheet({ from, to }: { from: number; to: number }) {
  const view = useGame((s) => s.view);
  const lang = useGame((s) => s.lang);
  const clock = useGame((s) => s.clock);
  const closeSheet = useGame((s) => s.closeSheet);
  const openSend = useGame((s) => s.openSend);
  const tutorial = useGame((s) => s.tutorial);
  const setTutorial = useGame((s) => s.setTutorial);
  const now = useGameNow();
  const source = view ? townById(view, from) : undefined;
  const target = view ? townById(view, to) : undefined;
  // From a clanmate's town the player can only move the troops it stationed there.
  const available =
    (source?.owner === view?.me.id
      ? source?.garrison
      : source?.stationed?.find((s) => s.lordId === view?.me.id)?.troops) ?? 0;
  const [share, setShare] = useState(1);
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const windDir = view?.wind.dir;

  useEffect(() => {
    if (tutorial === 1) setTutorial(2);
  }, [tutorial, setTutorial]);

  const amount = Math.floor(available * share);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      void requestPreview(from, to, amount).then((p) => {
        if (!cancelled) setPreview(p);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [from, to, amount, windDir]);

  if (!view || !source || !target) return null;
  const sources = view.towns.filter(
    (town) =>
      town.owner === view.me.id &&
      town.id !== to &&
      town.garrison !== null &&
      town.garrison > 0 &&
      linkedIsles(view, town.isleId).has(target.isleId),
  );
  const total = amount;
  const outcome = preview ? outcomeText(lang, preview) : null;
  const hint = preview ? waitHint(lang, preview, clock, now) : null;
  const error =
    preview?.error && total > 0 ? (RULE_TEXT[lang][preview.error.code] ?? preview.error.message) : null;
  const eta = preview?.travel ? formatDuration(toRealMs(clock, preview.travel.durationMs)) : '—';

  const send = async (): Promise<void> => {
    setBusy(true);
    const ok = await command({ type: 'SEND', from, to, troops: amount });
    setBusy(false);
    if (ok) closeSheet();
  };

  return (
    <section className="drawer" data-testid="send-sheet" aria-label={t(lang, 'sendTroops')}>
      <header className="drawer-head">
        <div className="drawer-title">
          <h2>
            {townLabel(lang, view, from)} → {townLabel(lang, view, to)}
          </h2>
        </div>
        <button type="button" className="icon-button" aria-label={t(lang, 'close')} onClick={closeSheet}>
          <CloseIcon />
        </button>
      </header>

      {sources.length > 1 && (
        <div className="sources" role="group" aria-label={t(lang, 'from')}>
          {sources.map((town) => (
            <button
              key={town.id}
              type="button"
              className={`small${town.id === from ? ' selected' : ''}`}
              aria-pressed={town.id === from}
              onClick={() => openSend(town.id, to)}
            >
              {townLabel(lang, view, town.id)} · {formatNumber(town.garrison ?? 0, lang)}
            </button>
          ))}
        </div>
      )}

      <div className="sliders">
        <label className="slider-row">
          <span className="troop">
            <TroopIcon size={16} />
            {t(lang, 'troops')}
          </span>
          <input
            type="range"
            min={0}
            max={SHARE_STEPS}
            step={1}
            value={Math.round(share * SHARE_STEPS)}
            disabled={available === 0}
            data-testid="troop-slider"
            onChange={(e) => setShare(Number(e.target.value) / SHARE_STEPS)}
          />
          <span className="slider-value">
            {formatNumber(amount, lang)}/{formatNumber(available, lang)}
          </span>
        </label>
      </div>
      <div className="quick">
        <button type="button" className="small" data-testid="send-all" onClick={() => setShare(1)}>
          {t(lang, 'all')}
        </button>
        <button type="button" className="small" onClick={() => setShare(0.5)}>
          {t(lang, 'half')}
        </button>
        <button type="button" className="small" onClick={() => setShare(0)}>
          {t(lang, 'none')}
        </button>
      </div>

      <div className="preview" aria-live="polite">
        <p>
          <strong data-testid="eta">{t(lang, 'eta', { t: eta })}</strong>
          {preview && <span className="muted"> · {travelText(lang, preview)}</span>}
        </p>
        {outcome && <p className={`tone-${outcome.tone}`}>{outcome.text}</p>}
        {hint && <p className="muted">{hint}</p>}
        {error && <p className="tone-bad">{error}</p>}
      </div>

      <div className="actions">
        <button
          type="button"
          className="primary"
          data-testid="confirm-send"
          disabled={busy || total === 0 || error !== null}
          onClick={() => void send()}
        >
          {t(lang, 'confirmSend')}
        </button>
      </div>
    </section>
  );
}
