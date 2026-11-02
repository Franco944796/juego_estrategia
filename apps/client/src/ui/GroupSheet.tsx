import type { GroupPreview, TownView } from '@si/engine';
import { useEffect, useState } from 'react';
import { formatDuration, formatNumber } from '../format';
import { command, previewGroup } from '../game/session';
import { RULE_TEXT, t } from '../i18n';
import { toRealMs, useGame } from '../store';
import { CloseIcon, TroopIcon } from './icons';
import { linkedIsles, townById, townLabel } from './labels';
import { outcomeText } from './SendSheet';

const PREVIEW_DEBOUNCE_MS = 120;
/** Nearest towns with troops ticked when the list opens. */
const PRESELECTED = 5;

/** Picks own towns that all send every troop to `to`; they arrive together as one army. */
export function GroupSheet({ to }: { to: number }) {
  const view = useGame((s) => s.view);
  const lang = useGame((s) => s.lang);
  const clock = useGame((s) => s.clock);
  const closeSheet = useGame((s) => s.closeSheet);
  const target = view ? townById(view, to) : undefined;

  // The list is fixed when the sheet opens: troops keep growing, but the towns stay put.
  const [sources] = useState<TownView[]>(() => {
    if (!view || !target) return [];
    const d = (town: TownView): number => Math.hypot(town.pos.x - target.pos.x, town.pos.y - target.pos.y);
    return view.towns
      .filter(
        (town) =>
          town.owner === view.me.id &&
          town.id !== to &&
          (town.garrison ?? 0) > 0 &&
          linkedIsles(view, town.isleId).has(target.isleId),
      )
      .sort((a, b) => d(a) - d(b) || a.id - b.id);
  });
  const [chosen, setChosen] = useState<number[]>(() => sources.slice(0, PRESELECTED).map((s) => s.id));
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      void previewGroup(chosen, to).then((p) => {
        if (!cancelled) setPreview(p);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [chosen, to]);

  if (!view || !target) return null;
  const toggle = (id: number): void =>
    setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const outcome = preview && chosen.length > 0 ? outcomeText(lang, preview) : null;
  const error =
    preview?.error && chosen.length > 0
      ? (RULE_TEXT[lang][preview.error.code] ?? preview.error.message)
      : null;
  const eta = preview?.durationMs != null ? formatDuration(toRealMs(clock, preview.durationMs)) : '—';

  const send = async (): Promise<void> => {
    setBusy(true);
    const ok = await command({ type: 'SEND_GROUP', from: chosen, to });
    setBusy(false);
    if (ok) closeSheet();
  };

  return (
    <section className="drawer" data-testid="group-sheet" aria-label={t(lang, 'groupTitle')}>
      <header className="drawer-head">
        <div className="drawer-title">
          <h2>{t(lang, 'groupTitle')}</h2>
          <p className="muted">{townLabel(lang, view, to)}</p>
        </div>
        <button type="button" className="icon-button" aria-label={t(lang, 'close')} onClick={closeSheet}>
          <CloseIcon />
        </button>
      </header>

      {sources.length === 0 ? (
        <p className="muted">{t(lang, 'noSource')}</p>
      ) : (
        <ul className="list">
          {sources.map((town) => (
            <li key={town.id}>
              <label className="group-row">
                <input
                  type="checkbox"
                  checked={chosen.includes(town.id)}
                  data-testid="group-source"
                  onChange={() => toggle(town.id)}
                />
                <span className="group-name">{townLabel(lang, view, town.id)}</span>
                <span className="troop">
                  <TroopIcon size={14} />
                  {formatNumber(townById(view, town.id)?.garrison ?? 0, lang)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="preview" aria-live="polite">
        <p>
          <strong data-testid="group-total">
            {t(lang, 'groupTotal', { n: formatNumber(preview?.troops ?? 0, lang), k: chosen.length })}
          </strong>
        </p>
        <p>
          <strong data-testid="group-eta">{t(lang, 'eta', { t: eta })}</strong>
          <span className="muted"> · {t(lang, 'groupTogether')}</span>
        </p>
        {outcome && <p className={`tone-${outcome.tone}`}>{outcome.text}</p>}
        {error && <p className="tone-bad">{error}</p>}
      </div>

      <div className="actions">
        <button
          type="button"
          className="primary"
          data-testid="confirm-group"
          disabled={busy || chosen.length === 0 || error !== null}
          onClick={() => void send()}
        >
          {t(lang, 'confirmSend')}
        </button>
      </div>
    </section>
  );
}
