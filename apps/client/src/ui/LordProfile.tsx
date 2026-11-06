import { defaultConfig } from '@si/config';
import { GEAR_SLOTS, RARITIES, SKILL_IDS } from '@si/config/constants';
import type { Gem as OwnedGem, GearSlot, GemColor, Item, LordView, SkillId } from '@si/engine';
import { useState, type ComponentType } from 'react';
import { formatDecimal, formatNumber } from '../format';
import { buyItem, command } from '../game/session';
import { t, type Lang, type MessageKey } from '../i18n';
import { useGame } from '../store';
import {
  AmuletIcon,
  ArmorIcon,
  BootsIcon,
  ChestIcon,
  CloakIcon,
  CoinIcon,
  HelmetIcon,
  RingIcon,
  StarIcon,
  SwordIcon,
  TroopIcon,
} from './icons';
import { Gem, type GemKind } from './Gem';
import { gemLabel, itemEffect, itemName } from './labels';

type Tab = 'gear' | 'skills' | 'stats';

const SLOT_ICONS: Record<GearSlot, ComponentType<{ size?: number; className?: string }>> = {
  WEAPON: SwordIcon,
  ARMOR: ArmorIcon,
  HELMET: HelmetIcon,
  CLOAK: CloakIcon,
  BOOTS: BootsIcon,
  RING: RingIcon,
  AMULET: AmuletIcon,
  CHEST: ChestIcon,
};

const percent = (share: number, lang: Lang): string => formatDecimal(share * 100, lang, 0);

/** Gold skills wear topaz, troop and attack skills ruby (see Gem.tsx). */
const SKILL_GEMS: Record<(typeof SKILL_IDS)[number], GemKind> = {
  GOLD: 'topaz',
  TROOPS: 'ruby',
  ATTACK: 'ruby',
};

function SkillsTab({ view, lang }: { view: LordView; lang: Lang }) {
  const { me } = view;
  const recovery: { key: MessageKey; effect: MessageKey; share: number }[] = [
    { key: 'skillAttacker', effect: 'recoveryAttacker', share: me.recovery.attacker },
    { key: 'skillDefender', effect: 'recoveryDefender', share: me.recovery.defender },
  ];
  // Points stay put until the season ends, so each one is confirmed before it is spent.
  const [pending, setPending] = useState<SkillId | null>(null);
  return (
    <div className="skills">
      <p className="skill-points" data-testid="skill-points">
        <Gem kind="emerald" small>
          <StarIcon size={13} />
        </Gem>
        <strong>{t(lang, 'skillPoints', { n: me.skillPoints })}</strong>
      </p>
      <ul className="list">
        {SKILL_IDS.map((id) => (
          <li key={id} className="skill" data-testid={`skill-${id}`}>
            <Gem kind={SKILL_GEMS[id]} small>
              {id === 'GOLD' ? (
                <CoinIcon size={13} />
              ) : id === 'TROOPS' ? (
                <TroopIcon size={13} />
              ) : (
                <SwordIcon size={13} />
              )}
            </Gem>
            <span>
              <strong>{t(lang, `skill${id}`)}</strong> · {me.skills[id]}
              <br />
              <span className="muted">
                {t(lang, 'skillEffect', {
                  p: percent(me.skillPerPoint[id], lang),
                  total: percent(me.skillPerPoint[id] * me.skills[id], lang),
                })}
              </span>
            </span>
            <button
              type="button"
              className="small"
              data-testid={`learn-${id}`}
              disabled={me.skillPoints <= 0 || !me.alive || pending !== null}
              onClick={() => setPending(id)}
            >
              {t(lang, 'learn')}
            </button>
            {pending === id && (
              <div className="skill-confirm" data-testid="skill-confirm">
                <p>{t(lang, 'confirmSkill', { skill: t(lang, `skill${id}`) })}</p>
                <div className="actions">
                  <button type="button" className="small" onClick={() => setPending(null)}>
                    {t(lang, 'cancel')}
                  </button>
                  <button
                    type="button"
                    className="small primary"
                    data-testid="confirm-skill"
                    onClick={() => {
                      setPending(null);
                      void command({ type: 'LEARN_SKILL', skill: id });
                    }}
                  >
                    {t(lang, 'confirmLearn')}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {recovery.map((r) => (
          <li key={r.key} className="skill">
            <span>
              <strong>{t(lang, r.key)}</strong> · {percent(r.share, lang)} %
              <br />
              <span className="muted">{t(lang, r.effect, { p: percent(r.share, lang) })}</span>
            </span>
            <span className="muted small-note">{t(lang, 'leagueMax')}</span>
          </li>
        ))}
      </ul>
      <p className="muted">{t(lang, 'skillsHelp')}</p>
    </div>
  );
}

function equippedIn(view: LordView, slot: GearSlot): Item | undefined {
  const id = view.me.gear[slot];
  return id === undefined ? undefined : view.me.items.find((item) => item.id === id);
}

function GearTab({ view, lang }: { view: LordView; lang: Lang }) {
  const online = useGame((s) => s.mode === 'online');
  const profile = useGame((s) => s.profile);
  const [slot, setSlot] = useState<GearSlot>('WEAPON');
  const bonus = view.me.gearBonus;
  const owned = view.me.items
    .filter((item) => item.slot === slot)
    .sort((a, b) => bonus[b.rarity] - bonus[a.rarity] || (a.id < b.id ? -1 : 1));
  const worn = view.me.gear[slot];
  const rules = view.me.itemRules;
  const set = new Set(view.me.items.flatMap((item) => item.gems ?? []));
  const loose = view.me.gems.filter((gem) => !set.has(gem.id));
  const dev = view.me.dev;
  // Destroying cannot be undone, so it asks first, like spending a skill point.
  const [doomed, setDoomed] = useState<string | null>(null);

  return (
    <div className="gear">
      <div className="gear-slots" role="tablist" aria-label={t(lang, 'tabGear')}>
        {GEAR_SLOTS.map((s) => {
          const item = equippedIn(view, s);
          const Icon = SLOT_ICONS[s];
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={slot === s}
              className={`gear-slot${slot === s ? ' selected' : ''}${item ? ` rarity-${item.rarity}` : ''}`}
              data-testid={`slot-${s}`}
              onClick={() => setSlot(s)}
            >
              <Icon size={26} />
              <span className="gear-slot-name">{t(lang, `slot${s}`)}</span>
              <span className="gear-slot-item">
                {item ? itemEffect(lang, view, item) : t(lang, 'emptySlot')}
              </span>
            </button>
          );
        })}
      </div>

      <h3>{t(lang, `slot${slot}`)}</h3>
      <p className="muted" data-testid="scrap-total">
        {t(lang, 'scrapTotal', { n: dev ? t(lang, 'unlimited') : formatNumber(view.me.scrap, lang) })}
      </p>
      <p className="muted" data-testid="gems-total">
        {t(lang, 'gemsTotal', { n: view.me.gems.length, free: loose.length })}
      </p>
      {owned.length === 0 ? (
        <p className="muted">{t(lang, 'noItemsForSlot')}</p>
      ) : (
        <ul className="list">
          {owned.map((item) => {
            const level = item.level ?? 1;
            const chest = item.slot === 'CHEST';
            const top = level >= rules.maxLevel;
            const cost = rules.upgradeScrap * level;
            const gives = rules.scrapByRarity[item.rarity] + Math.floor((item.scrap ?? 0) / 2);
            return (
              <li key={item.id} className="skill gear-row" data-testid="gear-item">
                <span>
                  <strong className={`rarity-text rarity-${item.rarity}`}>{itemName(lang, item)}</strong>
                  <br />
                  <span className="muted">{itemEffect(lang, view, item)}</span>
                  <br />
                  <span className="muted small-note" data-testid="item-progress">
                    {chest
                      ? t(lang, 'chestFixed')
                      : top
                        ? t(lang, 'itemTop', { max: rules.maxLevel })
                        : t(lang, 'itemProgress', {
                            n: level,
                            max: rules.maxLevel,
                            c: item.copies ?? 0,
                            need: rules.copiesPerLevel * level,
                          })}
                  </span>
                </span>
                <span className="gear-actions">
                  {worn === item.id ? (
                    <span className="muted small-note">{t(lang, 'equipped')}</span>
                  ) : (
                    <button
                      type="button"
                      className="small"
                      data-testid="equip-item"
                      disabled={!view.me.alive}
                      onClick={() => void command({ type: 'EQUIP', itemId: item.id })}
                    >
                      {t(lang, 'equip')}
                    </button>
                  )}
                  {!chest && !top && (
                    <button
                      type="button"
                      className="small"
                      data-testid="upgrade-item"
                      disabled={!view.me.alive || (!dev && view.me.scrap < cost)}
                      onClick={() => void command({ type: 'UPGRADE_ITEM', itemId: item.id })}
                    >
                      {t(lang, 'upgradeItem', { n: dev ? 0 : cost })}
                    </button>
                  )}
                  {worn !== item.id && (
                    <button
                      type="button"
                      className="small"
                      data-testid="destroy-item"
                      disabled={!view.me.alive || doomed !== null}
                      onClick={() => setDoomed(item.id)}
                    >
                      {t(lang, 'destroyItem', { n: gives })}
                    </button>
                  )}
                </span>
                <GemSockets view={view} lang={lang} item={item} loose={loose} />
                {doomed === item.id && (
                  <div className="skill-confirm" data-testid="destroy-confirm">
                    <p>{t(lang, 'confirmDestroy', { item: itemName(lang, item), n: gives })}</p>
                    <div className="actions">
                      <button type="button" className="small" onClick={() => setDoomed(null)}>
                        {t(lang, 'cancel')}
                      </button>
                      <button
                        type="button"
                        className="small danger"
                        data-testid="confirm-destroy"
                        onClick={() => {
                          setDoomed(null);
                          void command({ type: 'DESTROY_ITEM', itemId: item.id });
                        }}
                      >
                        {t(lang, 'destroyItem', { n: gives })}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {online && profile && (
        <>
          <h3>{t(lang, 'shopTitle', { n: formatNumber(profile.legacy, lang) })}</h3>
          <div className="quick" data-testid="item-shop">
            {RARITIES.map((rarity) => {
              const cost = defaultConfig.gear.prices[rarity];
              return (
                <button
                  key={rarity}
                  type="button"
                  className={`small rarity-border rarity-${rarity}`}
                  disabled={!profile.dev && profile.legacy < cost}
                  onClick={() => void buyItem(slot, rarity)}
                >
                  {t(lang, 'buyItem', { rarity: t(lang, `rarity${rarity}`), cost })}
                </button>
              );
            })}
          </div>
        </>
      )}
      <p className="muted">{t(lang, 'gearHelp', { n: defaultConfig.gear.dropEveryLevels })}</p>
    </div>
  );
}

/** Gem colors as the interface's gem kinds (see Gem.tsx): the same palette, one per figure. */
const GEM_KINDS: Record<GemColor, GemKind> = {
  TOPAZ: 'topaz',
  RUBY: 'ruby',
  SAPPHIRE: 'sapphire',
  AMETHYST: 'amethyst',
  EMERALD: 'emerald',
};

/** An item's sockets: the gems set in it (tap one to take it out), the free ones and a picker. */
function GemSockets({
  view,
  lang,
  item,
  loose,
}: {
  view: LordView;
  lang: Lang;
  item: Item;
  loose: OwnedGem[];
}) {
  const sockets = view.me.gemRules.sockets[item.rarity];
  if (sockets === 0) return null;
  const set = (item.gems ?? []).flatMap((id) => view.me.gems.filter((gem) => gem.id === id));
  return (
    <div className="gem-sockets" data-testid="item-sockets">
      <span className="muted small-note">
        {t(lang, 'socketsLabel', { used: set.length, total: sockets })}
      </span>
      {set.map((gem) => (
        <button
          key={gem.id}
          type="button"
          className="gem-socket"
          data-testid="unsocket-gem"
          title={t(lang, 'unsocketGem', { gem: gemLabel(lang, view, gem) })}
          aria-label={t(lang, 'unsocketGem', { gem: gemLabel(lang, view, gem) })}
          onClick={() => void command({ type: 'UNSOCKET_GEM', itemId: item.id, gemId: gem.id })}
        >
          <Gem kind={GEM_KINDS[gem.color]} small>
            <span className="gem-level">{gem.level ?? 1}</span>
          </Gem>
        </button>
      ))}
      {Array.from({ length: sockets - set.length }, (_, i) => (
        <span key={i} className="gem-empty" aria-hidden="true" />
      ))}
      {set.length < sockets && loose.length > 0 && (
        <select
          data-testid="socket-gem"
          aria-label={t(lang, 'socketGem')}
          value=""
          onChange={(e) => {
            if (e.target.value) void command({ type: 'SOCKET_GEM', itemId: item.id, gemId: e.target.value });
          }}
        >
          <option value="">{t(lang, 'socketGem')}</option>
          {loose.map((gem) => (
            <option key={gem.id} value={gem.id}>
              {gemLabel(lang, view, gem)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function StatsTab({ view, lang }: { view: LordView; lang: Lang }) {
  const { me } = view;
  const towns = view.towns.filter((town) => town.owner === me.id).length;
  const rows: [MessageKey, number][] = [
    ['statPower', me.power],
    ['statTowns', towns],
    ['statCaptures', me.stats.captures],
    ['statWins', me.stats.battlesWon],
    ['statLosses', me.stats.battlesLost],
    ['statKills', me.stats.troopsKilled],
    ['statTroopsLost', me.stats.troopsLost],
    ['statTownsLost', me.stats.townsLost],
    ['statExiles', me.exiles],
  ];
  return (
    <div className="stats">
      <p>
        <strong>{t(lang, 'levelShort', { n: me.level })}</strong>
        {me.nextLevelXp !== null && (
          <span className="muted">
            {' '}
            · {formatNumber(me.xp, lang)} / {formatNumber(me.nextLevelXp, lang)}
          </span>
        )}
      </p>
      <dl className="stat-list">
        {rows.map(([key, value]) => (
          <div key={key} className="stat-row">
            <dt className="muted">{t(lang, key)}</dt>
            <dd>{formatNumber(value, lang)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The lord's profile, opened from its portrait: gear, skills and season stats. */
export function LordProfile({ view, lang }: { view: LordView; lang: Lang }) {
  const [tab, setTab] = useState<Tab>(view.me.skillPoints > 0 ? 'skills' : 'gear');
  const labels: Record<Tab, MessageKey> = { gear: 'tabGear', skills: 'tabSkills', stats: 'tabStats' };
  return (
    <div className="lord-profile">
      <div className="segmented" role="tablist">
        {(['gear', 'skills', 'stats'] as const).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            aria-pressed={tab === x}
            data-testid={`tab-${x}`}
            onClick={() => setTab(x)}
          >
            {t(lang, labels[x])}
            {x === 'skills' && view.me.skillPoints > 0 && (
              <span className="inline-badge">{view.me.skillPoints}</span>
            )}
          </button>
        ))}
      </div>
      {tab === 'gear' && <GearTab view={view} lang={lang} />}
      {tab === 'skills' && <SkillsTab view={view} lang={lang} />}
      {tab === 'stats' && <StatsTab view={view} lang={lang} />}
    </div>
  );
}
