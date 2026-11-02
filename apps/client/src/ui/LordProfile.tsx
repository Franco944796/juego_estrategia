import { defaultConfig } from '@si/config';
import { GEAR_SLOTS, RARITIES, SKILL_IDS } from '@si/config/constants';
import type { GearSlot, Item, LordView } from '@si/engine';
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
  HelmetIcon,
  RingIcon,
  StarIcon,
  SwordIcon,
} from './icons';
import { itemEffect, itemName } from './labels';

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

function SkillsTab({ view, lang }: { view: LordView; lang: Lang }) {
  const { me } = view;
  const recovery: { key: MessageKey; effect: MessageKey; share: number }[] = [
    { key: 'skillAttacker', effect: 'recoveryAttacker', share: me.recovery.attacker },
    { key: 'skillDefender', effect: 'recoveryDefender', share: me.recovery.defender },
  ];
  return (
    <div className="skills">
      <p className="skill-points" data-testid="skill-points">
        <StarIcon className="stat-icon points" />
        <strong>{t(lang, 'skillPoints', { n: me.skillPoints })}</strong>
      </p>
      <ul className="list">
        {SKILL_IDS.map((id) => (
          <li key={id} className="skill" data-testid={`skill-${id}`}>
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
              disabled={me.skillPoints <= 0 || !me.alive}
              onClick={() => void command({ type: 'LEARN_SKILL', skill: id })}
            >
              {t(lang, 'learn')}
            </button>
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
      {owned.length === 0 ? (
        <p className="muted">{t(lang, 'noItemsForSlot')}</p>
      ) : (
        <ul className="list">
          {owned.map((item) => (
            <li key={item.id} className="skill" data-testid="gear-item">
              <span>
                <strong className={`rarity-text rarity-${item.rarity}`}>{itemName(lang, item)}</strong>
                <br />
                <span className="muted">{itemEffect(lang, view, item)}</span>
              </span>
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
            </li>
          ))}
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
                  disabled={profile.legacy < cost}
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
