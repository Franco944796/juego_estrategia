import type { SendPreview } from '@si/engine';
import { useEffect, useState } from 'react';
import { formatDecimal, formatDuration, formatNumber } from '../format';
import { command, preview as requestPreview } from '../game/session';
import { RULE_TEXT, t, type Lang } from '../i18n';
import { toRealMs, useGame, type Clock } from '../store';
import { useGameNow } from './hooks';
import { CloseIcon, TroopIcon } from './icons';
import { isAlly, linkedIsles, townById, townLabel } from './labels';

const PREVIEW_DEBOUNCE_MS = 120;
/** Rules a scout must also meet; the rest (capitals, too weak, march limit) only bind attacks. */
const SCOUT_RULES = new Set(['NOT_OWNER', 'NOT_ENOUGH_TROOPS', 'UNKNOWN_TOWN', 'SAME_TOWN', 'UNREACHABLE']);
/**
 * Slider stops: the army is chosen as a share, since garrisons run into the billions. Stop 0 sends a
 * single troop to scout; stop k sends k tenths.
 */
const SHARE_STEPS = 10;

function travelText(lang: Lang, p: SendPreview): string {
  if (!p.travel) return '';
  const f = formatDecimal(p.travel.windFactor, lang);
  if (!p.travel.sky) return t(lang, 'land');
  if (p.travel.windFactor > 1.05) return t(lang, 'tailwind', { f });
  if (p.travel.windFactor < 0.95) return t(lang, 'headwind', { f });
  return t(lang, 'crosswind', { f });
}

export function outcomeText(
  lang: Lang,
  p: Pick<SendPreview, 'reinforce' | 'battle'>,
): { text: string; tone: string } {
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

export function SendSheet({ from, to, scout = false }: { from: number; to: number; scout?: boolean }) {
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
  const [step, setStep] = useState(scout ? 0 : SHARE_STEPS);
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const windDir = view?.wind.dir;

  useEffect(() => {
    if (tutorial === 1) setTutorial(2);
  }, [tutorial, setTutorial]);

  // Rounded down, but never 0 while there are troops: the lowest stop scouts with one.
  const amount = available === 0 ? 0 : Math.max(1, Math.floor((available * step) / SHARE_STEPS));

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
  // The lowest stop scouts a foreign town; toward an own or allied town it just sends one troop.
  const scouting = step === 0 && target.owner !== view.me.id && !isAlly(view, target.owner);
  const outcome = preview && !scouting ? outcomeText(lang, preview) : null;
  const hint = preview ? (scouting ? t(lang, 'scoutHint') : waitHint(lang, preview, clock, now)) : null;
  const rule = preview?.error && (!scouting || SCOUT_RULES.has(preview.error.code)) ? preview.error : null;
  const error = rule && total > 0 ? (RULE_TEXT[lang][rule.code] ?? rule.message) : null;
  const eta = preview?.travel ? formatDuration(toRealMs(clock, preview.travel.durationMs)) : '—';

  const send = async (): Promise<void> => {
    setBusy(true);
    const ok = await command(
      scouting ? { type: 'SCOUT', from, to } : { type: 'SEND', from, to, troops: amount },
    );
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
              onClick={() => openSend(town.id, to, step === 0)}
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
            value={step}
            disabled={available === 0}
            data-testid="troop-slider"
            onChange={(e) => setStep(Number(e.target.value))}
          />
          <span className="slider-value" data-testid="troop-amount">
            {step === 0 ? t(lang, 'scoutValue') : `${(step * 100) / SHARE_STEPS} %`} ·{' '}
            {formatNumber(amount, lang)}/{formatNumber(available, lang)}
          </span>
        </label>
      </div>
      <div className="quick">
        <button type="button" className="small" data-testid="send-all" onClick={() => setStep(SHARE_STEPS)}>
          {t(lang, 'all')}
        </button>
        <button type="button" className="small" onClick={() => setStep(SHARE_STEPS / 2)}>
          {t(lang, 'half')}
        </button>
        <button type="button" className="small" data-testid="send-scout" onClick={() => setStep(0)}>
          {t(lang, 'scout')}
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
          {t(lang, scouting ? 'confirmScout' : 'confirmSend')}
        </button>
      </div>
    </section>
  );
}
