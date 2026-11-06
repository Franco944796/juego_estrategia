import type { LordView, TownView } from '@si/engine';
import { formatDecimal, formatNumber, formatRate } from '../format';
import { command, devTool } from '../game/session';
import { t } from '../i18n';
import { useGame } from '../store';
import { Gem } from './Gem';
import { CloseIcon, CoinIcon, CrownIcon, ShieldIcon, StarIcon, TroopIcon } from './icons';
import { attackXp, isAlly, linkedIsles, ownerColor, ownerName, townById, townLabel } from './labels';

/** The player's town with the most troops that can reach `target`, if any. */
export function bestSource(view: LordView, target: TownView): TownView | null {
  let best: TownView | null = null;
  for (const town of view.towns) {
    if (town.owner !== view.me.id || town.id === target.id || !town.garrison) continue;
    if (!linkedIsles(view, town.isleId).has(target.isleId)) continue;
    if (!best || town.garrison > (best.garrison ?? 0)) best = town;
  }
  return best;
}

export function TownSheet({ townId }: { townId: number }) {
  const view = useGame((s) => s.view);
  const lang = useGame((s) => s.lang);
  const closeSheet = useGame((s) => s.closeSheet);
  const startPicking = useGame((s) => s.startPicking);
  const openSend = useGame((s) => s.openSend);
  const openGroup = useGame((s) => s.openGroup);
  const select = useGame((s) => s.select);
  const town = view ? townById(view, townId) : undefined;
  if (!view || !town) return null;
  const mine = town.owner === view.me.id;
  const ally = !mine && isAlly(view, town.owner);
  const myStationed = town.stationed?.find((s) => s.lordId === view.me.id);
  const zone = town.zoneId === null ? undefined : view.zones[town.zoneId];
  const zoneMine = zone ? zone.townIds.filter((id) => townById(view, id)?.owner === view.me.id).length : 0;
  const source = mine ? null : bestSource(view, town);
  const immune = !mine && !ally && view.season.capitalImmune && town.isCapital;
  const enemyLord = !mine && !ally && town.owner !== null;
  const xp = enemyLord ? attackXp(view, town.owner) : 1;
  const ownerPower = view.lords.find((l) => l.id === town.owner)?.power ?? 0;
  const tooWeak = enemyLord && xp === 0;
  const canGroup =
    !immune &&
    !tooWeak &&
    view.towns.some(
      (t) =>
        t.owner === view.me.id &&
        t.id !== town.id &&
        (t.garrison ?? 0) > 0 &&
        linkedIsles(view, t.isleId).has(town.isleId),
    );
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
        <h3 className="facts-title">{t(lang, 'sectionDefense')}</h3>
        <div className="fact">
          <Gem kind="ruby" small>
            <TroopIcon size={13} />
          </Gem>
          <span className="fact-label">{t(lang, 'garrison')}</span>
          {town.garrison !== null ? (
            <span className="troop" data-testid="garrison">
              {formatNumber(town.garrison, lang)}
            </span>
          ) : (
            <span className="muted">{t(lang, 'outOfSight')}</span>
          )}
        </div>
        <div className="fact" data-testid="walls">
          <Gem kind="sapphire" small>
            <ShieldIcon size={13} />
          </Gem>
          <span>
            {t(lang, 'walls', { n: formatNumber(town.walls, lang) })} ·{' '}
            {t(lang, 'defense', { n: formatDecimal(town.fort, lang, 2) })}
          </span>
        </div>
        {town.stationed && town.stationed.length > 0 && (
          <div className="fact" data-testid="stationed">
            <Gem kind="ruby" small>
              <TroopIcon size={13} />
            </Gem>
            <span className="fact-label">{t(lang, 'allies')}</span>
            <span>
              {town.stationed
                .map((s) => `${ownerName(lang, view, s.lordId)} · ${formatNumber(s.troops, lang)}`)
                .join(' — ')}
            </span>
          </div>
        )}
        {own && (
          <>
            <h3 className="facts-title">{t(lang, 'production')}</h3>
            <div className="fact">
              <Gem kind="topaz" small>
                <CoinIcon size={13} />
              </Gem>
              <span>{t(lang, 'goldRate', { n: formatRate(own.goldPerMin, lang) })}</span>
              <Gem kind="ruby" small>
                <TroopIcon size={13} />
              </Gem>
              <span>{t(lang, 'troopRate', { n: formatRate(own.troopsPerMin, lang) })}</span>
            </div>
          </>
        )}
        {((enemyLord && !tooWeak) || zone) && <h3 className="facts-title">{t(lang, 'sectionRealm')}</h3>}
        {enemyLord && !tooWeak && (
          <div className="fact" data-testid="lord-power">
            <Gem kind="amethyst" small>
              <StarIcon size={13} />
            </Gem>
            <span>
              {t(lang, 'lordPower', {
                name: ownerName(lang, view, town.owner),
                n: formatNumber(ownerPower, lang),
                x: formatDecimal(xp, lang, xp % 1 === 0 ? 0 : 1),
              })}
            </span>
          </div>
        )}
        {zone && (
          <div className="fact" data-testid="zone">
            <Gem kind="amethyst" small>
              <CrownIcon size={13} />
            </Gem>
            <span>
              {zone.beaconOwner
                ? t(lang, 'beacon', { name: ownerName(lang, view, zone.beaconOwner) })
                : t(lang, 'zoneProgress', { n: zoneMine, total: zone.townIds.length })}
            </span>
          </div>
        )}
        {town.isPrivate && (
          <p className="muted" data-testid="private-town">
            {t(lang, 'privateTown')}
          </p>
        )}
      </div>

      <div className="actions">
        {myStationed && (
          <button
            type="button"
            data-testid="withdraw-button"
            onClick={() => {
              select(town.id);
              startPicking();
            }}
          >
            {t(lang, 'yourStationed', { n: formatNumber(myStationed.troops, lang) })} · {t(lang, 'withdraw')}
          </button>
        )}
        {mine ? (
          <>
            <button type="button" className="primary" data-testid="send-button" onClick={startPicking}>
              {t(lang, 'sendTroops')}
            </button>
            <button
              type="button"
              data-testid="upgrade-button"
              disabled={!own || own.upgradeCost === null || (!view.me.dev && gold < own.upgradeCost)}
              onClick={() => void command({ type: 'UPGRADE', townId: town.id })}
            >
              {own?.upgradeCost == null
                ? t(lang, 'maxTier')
                : t(lang, 'upgrade', { n: town.tier + 1, cost: formatNumber(own.upgradeCost, lang) })}
            </button>
            {own && own.upgradeMax.levels > 1 && (
              <button
                type="button"
                data-testid="upgrade-max"
                onClick={() =>
                  void command({ type: 'UPGRADE', townId: town.id, levels: own.upgradeMax.levels })
                }
              >
                {t(lang, 'upgradeMax', {
                  n: town.tier + own.upgradeMax.levels,
                  cost: formatNumber(own.upgradeMax.cost, lang),
                })}
              </button>
            )}
          </>
        ) : ally ? (
          source ? (
            <button
              type="button"
              className="primary"
              data-testid="reinforce-button"
              onClick={() => openSend(source.id, town.id)}
            >
              {t(lang, 'reinforceAlly')}
            </button>
          ) : (
            <p className="muted">{t(lang, 'noSource')}</p>
          )
        ) : view.season.capitalImmune && town.isCapital ? (
          <p className="muted" data-testid="capital-immune">
            {t(lang, 'capitalImmune')}
          </p>
        ) : tooWeak ? (
          <p className="muted" data-testid="too-weak">
            {t(lang, 'tooWeak', {
              n: formatNumber(ownerPower, lang),
              mine: formatNumber(view.me.power, lang),
            })}
          </p>
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
        {!mine && !ally && source && (
          <button type="button" data-testid="scout-button" onClick={() => openSend(source.id, town.id, true)}>
            {t(lang, 'confirmScout')}
          </button>
        )}
        {mine && view.me.dev && (
          <div className="segmented" role="group" aria-label={t(lang, 'devTitle')}>
            {[1e6, 1e12].map((n) => (
              <button
                key={n}
                type="button"
                className="small"
                data-testid={`dev-troops-${n}`}
                onClick={() => void devTool({ type: 'TROOPS', townId: town.id, amount: n })}
              >
                {t(lang, 'devTroops', { n: formatNumber(n, lang) })}
              </button>
            ))}
          </div>
        )}
        {canGroup && (
          <button type="button" data-testid="group-button" onClick={() => openGroup(town.id)}>
            {t(lang, mine || ally ? 'groupHere' : 'groupAttack')}
          </button>
        )}
      </div>
    </section>
  );
}
