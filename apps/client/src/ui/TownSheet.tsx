import { TROOP_TYPES } from '@si/config/constants';
import { totalTroops, type LordView, type TownView } from '@si/engine';
import { formatDecimal, formatNumber } from '../format';
import { command } from '../game/session';
import { HUMAN_ID } from '../game/protocol';
import { t, TROOP_NAMES } from '../i18n';
import { useGame } from '../store';
import { CloseIcon, CrownIcon, ShieldIcon, TroopIcon } from './icons';
import { linkedIsles, ownerColor, ownerName, townLabel } from './labels';

/** The player's town with the most troops that can reach `target`, if any. */
export function bestSource(view: LordView, target: TownView): TownView | null {
  let best: TownView | null = null;
  for (const town of view.towns) {
    if (town.owner !== HUMAN_ID || town.id === target.id || !town.garrison) continue;
    if (!linkedIsles(view, town.isleId).has(target.isleId)) continue;
    if (!best || totalTroops(town.garrison) > totalTroops(best.garrison ?? town.garrison)) best = town;
  }
  return best;
}

export function TownSheet({ townId }: { townId: number }) {
  const view = useGame((s) => s.view);
  const lang = useGame((s) => s.lang);
  const closeSheet = useGame((s) => s.closeSheet);
  const startPicking = useGame((s) => s.startPicking);
  const openSend = useGame((s) => s.openSend);
  const town = view?.towns[townId];
  if (!view || !town) return null;
  const mine = town.owner === HUMAN_ID;
  const isle = view.isles[town.isleId];
  const source = mine ? null : bestSource(view, town);
  const gold = view.me.gold;
  const own = town.own;

  return (
    <section className="drawer" data-testid="town-sheet" aria-label={townLabel(lang, view, town.id)}>
      <header className="drawer-head">
        <span className="owner-dot" style={{ background: ownerColor(view, town.owner) }} />
        <div className="drawer-title">
          <h2>{townLabel(lang, view, town.id)}</h2>
          <p className="muted">
            {ownerName(lang, view, town.owner)} · {t(lang, 'tier', { n: town.tier })}
            {town.isCapital && <> · {t(lang, 'capital')}</>}
          </p>
        </div>
        <button type="button" className="icon-button" aria-label={t(lang, 'close')} onClick={closeSheet}>
          <CloseIcon />
        </button>
      </header>

      <div className="facts">
        <div className="fact">
          <span className="fact-label">{t(lang, 'garrison')}</span>
          {town.garrison ? (
            <span className="troops">
              {TROOP_TYPES.map((type) => (
                <span key={type} className="troop" title={TROOP_NAMES[lang][type]}>
                  <TroopIcon type={type} size={15} />
                  {formatNumber(town.garrison?.[type] ?? 0, lang)}
                </span>
              ))}
            </span>
          ) : (
            <span className="muted">{t(lang, 'outOfSight')}</span>
          )}
        </div>
        <div className="fact">
          <span className="fact-label">{t(lang, 'specialty')}</span>
          <span className="troop">
            <TroopIcon type={town.spec} size={15} />
            {TROOP_NAMES[lang][town.spec]}
          </span>
        </div>
        <div className="fact">
          <ShieldIcon size={15} />
          <span>{t(lang, 'defense', { n: formatDecimal(town.fort, lang, 2) })}</span>
        </div>
        {own && (
          <div className="fact">
            <span className="fact-label">{t(lang, 'production')}</span>
            <span>
              {t(lang, 'goldRate', { n: formatDecimal(own.goldPerMin, lang) })} ·{' '}
              {t(lang, 'troopRate', {
                n: formatDecimal(own.troopsPerMin, lang),
                type: TROOP_NAMES[lang][town.spec],
              })}{' '}
              · {t(lang, 'cap', { n: own.cap })}
            </span>
          </div>
        )}
        {isle?.beaconOwner && (
          <div className="fact">
            <CrownIcon size={15} />
            <span>{t(lang, 'beacon', { name: ownerName(lang, view, isle.beaconOwner) })}</span>
          </div>
        )}
      </div>

      <div className="actions">
        {mine ? (
          <>
            <button type="button" className="primary" data-testid="send-button" onClick={startPicking}>
              {t(lang, 'sendTroops')}
            </button>
            <button
              type="button"
              data-testid="upgrade-button"
              disabled={!own || own.upgradeCost === null || gold < own.upgradeCost}
              onClick={() => void command({ type: 'UPGRADE', townId: town.id })}
            >
              {own?.upgradeCost == null
                ? t(lang, 'maxTier')
                : t(lang, 'upgrade', { n: town.tier + 1, cost: formatNumber(own.upgradeCost, lang) })}
            </button>
            <div className="respec">
              <span className="fact-label">{t(lang, 'specialty')}</span>
              <div className="respec-buttons">
                {TROOP_TYPES.filter((type) => type !== town.spec).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="small"
                    disabled={!own || gold < own.respecCost}
                    onClick={() => void command({ type: 'RESPECIALIZE', townId: town.id, spec: type })}
                  >
                    <TroopIcon type={type} size={14} />
                    {t(lang, 'train', {
                      type: TROOP_NAMES[lang][type],
                      cost: formatNumber(own?.respecCost ?? 0, lang),
                    })}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : source ? (
          <button
            type="button"
            className="primary danger"
            data-testid="attack-button"
            onClick={() => openSend(source.id, town.id)}
          >
            {t(lang, 'attack')}
          </button>
        ) : (
          <p className="muted">{t(lang, 'noSource')}</p>
        )}
      </div>
    </section>
  );
}
