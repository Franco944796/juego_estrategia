import { TROOP_TYPES } from '@si/config/constants';
import { totalTroops, zeroTroops, type SendPreview, type Troops } from '@si/engine';
import { useEffect, useMemo, useState } from 'react';
import { formatDecimal, formatDuration, formatNumber } from '../format';
import { HUMAN_ID } from '../game/protocol';
import { command, preview as requestPreview } from '../game/session';
import { RULE_TEXT, t, TROOP_NAMES, type Lang } from '../i18n';
import { toRealMs, useGame, type Clock } from '../store';
import { useGameNow } from './hooks';
import { CloseIcon, TroopIcon } from './icons';
import { linkedIsles, townLabel } from './labels';

const PREVIEW_DEBOUNCE_MS = 120;

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
    return { text: t(lang, 'win', { n: totalTroops(p.battle.attackerLost) }), tone: 'good' };
  }
  return { text: t(lang, 'lose'), tone: 'bad' };
}

function waitHint(lang: Lang, p: SendPreview, clock: Clock, now: number): string | null {
  const current = p.travel?.windFactor ?? 1;
  const better = p.later.find((l) => l.windFactor > current + 0.15);
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
  const source = view?.towns[from];
  const target = view?.towns[to];
  const available: Troops = source?.garrison ?? zeroTroops();
  const [amounts, setAmounts] = useState<Troops>(() => ({ ...available }));
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const windDir = view?.wind.dir;

  useEffect(() => {
    if (tutorial === 1) setTutorial(2);
  }, [tutorial, setTutorial]);

  const clamped = useMemo<Troops>(
    () => ({
      LANCER: Math.min(amounts.LANCER, available.LANCER),
      ARCHER: Math.min(amounts.ARCHER, available.ARCHER),
      GRIFFIN: Math.min(amounts.GRIFFIN, available.GRIFFIN),
    }),
    [amounts, available.LANCER, available.ARCHER, available.GRIFFIN],
  );

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      void requestPreview(from, to, clamped).then((p) => {
        if (!cancelled) setPreview(p);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [from, to, clamped, windDir]);

  if (!view || !source || !target) return null;
  const sources = view.towns.filter(
    (town) =>
      town.owner === HUMAN_ID &&
      town.id !== to &&
      town.garrison !== null &&
      totalTroops(town.garrison) > 0 &&
      linkedIsles(view, town.isleId).has(target.isleId),
  );
  const total = totalTroops(clamped);
  const outcome = preview ? outcomeText(lang, preview) : null;
  const hint = preview ? waitHint(lang, preview, clock, now) : null;
  const error =
    preview?.error && total > 0 ? (RULE_TEXT[lang][preview.error.code] ?? preview.error.message) : null;
  const eta = preview?.travel ? formatDuration(toRealMs(clock, preview.travel.durationMs)) : '—';

  const setAll = (share: number): void =>
    setAmounts({
      LANCER: Math.floor(available.LANCER * share),
      ARCHER: Math.floor(available.ARCHER * share),
      GRIFFIN: Math.floor(available.GRIFFIN * share),
    });

  const send = async (): Promise<void> => {
    setBusy(true);
    const ok = await command({ type: 'SEND', from, to, troops: clamped });
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
              {townLabel(lang, view, town.id)} ·{' '}
              {formatNumber(totalTroops(town.garrison ?? zeroTroops()), lang)}
            </button>
          ))}
        </div>
      )}

      <div className="sliders">
        {TROOP_TYPES.map((type) => (
          <label key={type} className="slider-row">
            <span className="troop">
              <TroopIcon type={type} size={16} />
              {TROOP_NAMES[lang][type]}
            </span>
            <input
              type="range"
              min={0}
              max={available[type]}
              step={1}
              value={clamped[type]}
              disabled={available[type] === 0}
              onChange={(e) => setAmounts({ ...clamped, [type]: Number(e.target.value) })}
            />
            <span className="slider-value">
              {formatNumber(clamped[type], lang)}/{formatNumber(available[type], lang)}
            </span>
          </label>
        ))}
      </div>
      <div className="quick">
        <button type="button" className="small" data-testid="send-all" onClick={() => setAll(1)}>
          {t(lang, 'all')}
        </button>
        <button type="button" className="small" onClick={() => setAll(0.5)}>
          {t(lang, 'half')}
        </button>
        <button type="button" className="small" onClick={() => setAll(0)}>
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
