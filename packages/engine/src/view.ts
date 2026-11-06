import {
  dominionRates,
  fortification,
  goldRate,
  projectedDominion,
  projectedGarrison,
  projectedGold,
  townRates,
  townWalls,
  upgradeCost,
  upgradePlan,
} from './economy';
import { computeStandings } from './game';
import { modsMemo } from './modifiers';
import { troopRange, windIndexAt, windShiftMs } from './marches';
import { lordPower } from './power';
import { unspentPoints } from './skills';
import type {
  BattleReport,
  GameState,
  GearSlot,
  Isle,
  Gem,
  Item,
  Lane,
  LordStats,
  SeasonStatus,
  SkillId,
  Standing,
  Vec,
  Zone,
} from './types';
import { visibleIsles } from './vision';
import { areAllies, xpForLevel } from './world';

export interface OwnTownInfo {
  goldPerMin: number;
  troopsPerMin: number;
  /** Cost of the next level; null at the top level. */
  upgradeCost: number | null;
  /** Levels the lord's gold pays for right now, one after another, and what they cost together. */
  upgradeMax: { levels: number; cost: number };
}

export interface TownView {
  id: number;
  isleId: number;
  pos: Vec;
  tier: number;
  owner: string | null;
  isCapital: boolean;
  isThrone: boolean;
  /** A starter town only the viewer sees until someone owns it. */
  isPrivate: boolean;
  zoneId: number | null;
  fort: number;
  walls: number;
  /** Null when the garrison is out of sight. */
  garrison: number | null;
  /** Clanmates' troops stationed here; null when the town is out of sight. */
  stationed: { lordId: string; troops: number }[] | null;
  own: OwnTownInfo | null;
}

export interface MarchView {
  id: number;
  owner: string;
  from: number;
  to: number;
  departAt: number;
  arriveAt: number;
  sky: boolean;
  windFactor: number | null;
  /** Exact size, only for the viewer's own marches. */
  troops: number | null;
  /** Size band (1–10, 10–100…) of another lord's march, group, aimed at one of the viewer's towns. */
  troopRange: [number, number] | null;
  mine: boolean;
  /** Hostile march aimed at one of the viewer's towns. */
  incoming: boolean;
  /** March of a clanmate. */
  allied: boolean;
  /** Shared by the marches of one synchronized group. */
  groupId: number | null;
  /** A lone scout: it does not attack, so it is never `incoming`. */
  scout: boolean;
}

export interface ScoutView {
  id: number;
  at: number;
  townId: number;
  scout: string;
  owner: string | null;
  troops: number | null;
  walls: number | null;
  defenseMult: number | null;
  defense: number | null;
}

export interface WindView {
  dir: number;
  nextShiftAt: number | null;
  forecast: { at: number; dir: number }[];
}

export interface MeView {
  id: string;
  name: string;
  color: string;
  /** A test account: unlimited gold for upgrades and the test tools (see dev.ts). */
  dev: boolean;
  gold: number;
  goldPerMin: number;
  dominion: number;
  dominionPerMin: number;
  skills: Record<SkillId, number>;
  skillPoints: number;
  /** Bonus per skill point (0.05 = +5 %). */
  skillPerPoint: Record<SkillId, number>;
  /** League rule: share of dead troops that reappear in the capital. */
  recovery: { attacker: number; defender: number };
  items: Item[];
  gear: Partial<Record<GearSlot, string>>;
  /** Bonus of an item by rarity (0.03 = +3 %); the chest uses `refundBonus`. */
  gearBonus: Record<Item['rarity'], number>;
  refundBonus: Record<Item['rarity'], number>;
  /** Scrap to spend on item levels. */
  scrap: number;
  /** Every gem the lord owns; items list the ones set in them. */
  gems: Gem[];
  /** How gems work; see `gems` and `leagues` in the config. */
  gemRules: {
    sockets: Record<Item['rarity'], number>;
    /** Base value of a gem by the league it was won in. */
    leagueBonus: number[];
    levelShare: number;
    maxLevel: number;
  };
  /** How items level up; see `gear` in the config. */
  itemRules: {
    levelBonus: Record<Item['rarity'], number>;
    maxLevel: number;
    copiesPerLevel: number;
    scrapByRarity: Record<Item['rarity'], number>;
    upgradeScrap: number;
  };
  /** Troops plus walls; see `power` in the config for what it changes. */
  power: number;
  /** Power ratios (theirs over yours) that set the experience of an attack; see config `power`. */
  powerRules: { forbidBelow: number; halfBelow: number; doubleFrom: number; lowXp: number; highXp: number };
  capitalId: number | null;
  alive: boolean;
  exiles: number;
  stats: LordStats;
  activeMarches: number;
  clanId: string | null;
  level: number;
  xp: number;
  /** Experience the next level needs; null at the top level. */
  nextLevelXp: number | null;
}

export interface LordSummary {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  alive: boolean;
  style: string;
  clanId: string | null;
  level: number;
  power: number;
}

export interface SeasonView {
  startsAt: number;
  endsAt: number;
  throneUnsealAt: number;
  throneUnsealed: boolean;
  throneTownId: number | null;
  status: SeasonStatus;
  capitalImmune: boolean;
}

export interface LordView {
  now: number;
  title: string;
  me: MeView;
  lords: LordSummary[];
  isles: Isle[];
  zones: Zone[];
  lanes: Lane[];
  /** Sorted by id, without other lords' private starter towns, so it is not indexed by id. */
  towns: TownView[];
  marches: MarchView[];
  wind: WindView;
  season: SeasonView;
  reports: BattleReport[];
  /** Newest first; the details are only for the lord who scouted (null for the scouted owner). */
  scouts: ScoutView[];
  standings: Standing[];
}

/** What one lord may see at `now`, projected without touching the state. */
export function view(state: GameState, lordId: string, now: number): LordView {
  const cfg = state.config;
  const lord = state.lords[lordId];
  if (!lord) throw new Error(`unknown lord ${lordId}`);
  const t = Math.min(Math.max(now, state.accruedAt), state.endsAt);
  const visible = visibleIsles(state, lordId);
  const modsOf = modsMemo(state);
  const gold = projectedGold(state, lordId, t);

  const hidden = (townId: number): boolean => {
    const owner = state.towns[townId]?.privateTo ?? null;
    return owner !== null && owner !== lordId;
  };
  const towns: TownView[] = state.towns.flatMap((town) => {
    if (hidden(town.id)) return [];
    const mine = town.owner === lordId;
    let own: OwnTownInfo | null = null;
    if (mine) {
      const rates = townRates(state, town, modsOf(lordId));
      own = {
        goldPerMin: rates.gold,
        troopsPerMin: rates.troops,
        upgradeCost: upgradeCost(state, town),
        upgradeMax: upgradePlan(cfg, town.tier, lord.dev ? Infinity : gold, cfg.towns.maxTier),
      };
    }
    const seen: TownView = {
      id: town.id,
      isleId: town.isleId,
      pos: { x: town.pos.x, y: town.pos.y },
      tier: town.tier,
      owner: town.owner,
      isCapital: town.isCapital,
      isThrone: town.isThrone,
      isPrivate: town.privateTo === lordId,
      zoneId: town.zoneId,
      fort: fortification(state, town),
      walls: townWalls(state, town, modsOf(town.owner)),
      garrison: mine || visible.has(town.isleId) ? projectedGarrison(state, town, t) : null,
      stationed:
        mine || visible.has(town.isleId)
          ? town.stationed.map((s) => ({ lordId: s.lordId, troops: s.troops }))
          : null,
      own,
    };
    return [seen];
  });

  // Everyone sees every march in real time, but not its size (see troops and troopRange).
  const groupTroops = new Map<number, number>();
  for (const m of state.marches) {
    if (m.groupId !== null) groupTroops.set(m.groupId, (groupTroops.get(m.groupId) ?? 0) + m.troops);
  }
  const marches: MarchView[] = state.marches
    .filter((m) => m.owner === lordId || !hidden(m.to))
    .map((m) => {
      const mine = m.owner === lordId;
      const allied = areAllies(state, lordId, m.owner);
      const toMe = state.towns[m.to]?.owner === lordId;
      const incoming = !mine && !allied && toMe && !m.scout;
      return {
        id: m.id,
        owner: m.owner,
        from: m.from,
        to: m.to,
        departAt: m.departAt,
        arriveAt: m.arriveAt,
        sky: m.sky,
        windFactor: mine ? m.windFactor : null,
        troops: mine ? m.troops : null,
        troopRange:
          toMe && !mine
            ? troopRange(m.groupId === null ? m.troops : (groupTroops.get(m.groupId) ?? m.troops))
            : null,
        mine,
        incoming,
        allied,
        groupId: m.groupId,
        scout: m.scout === true,
      };
    });

  const index = windIndexAt(state, t);
  const shift = windShiftMs(state);
  const forecast: WindView['forecast'] = [];
  for (let k = index + 1; k <= index + cfg.wind.forecastShifts && k < state.windDirs.length; k++) {
    const at = state.startsAt + k * shift;
    if (at >= state.endsAt) break;
    forecast.push({ at, dir: state.windDirs[k] ?? 0 });
  }

  return {
    now: t,
    title: cfg.meta.gameTitle,
    me: {
      id: lord.id,
      name: lord.name,
      color: lord.color,
      dev: lord.dev === true,
      gold,
      goldPerMin: goldRate(state, lordId),
      dominion: projectedDominion(state, lordId, t),
      dominionPerMin: dominionRates(state).get(lordId) ?? 0,
      skills: { ...lord.skills },
      skillPoints: unspentPoints(lord),
      skillPerPoint: { ...cfg.skills.perPoint },
      recovery: { attacker: cfg.league.attackerRecovery, defender: cfg.league.defenderRecovery },
      items: lord.items.map((item) => ({ ...item, ...(item.gems ? { gems: [...item.gems] } : {}) })),
      gear: { ...lord.gear },
      gearBonus: { ...cfg.gear.rarityBonus },
      refundBonus: { ...cfg.gear.refundByRarity },
      scrap: lord.scrap,
      gems: lord.gems.map((gem) => ({ ...gem })),
      gemRules: {
        sockets: { ...cfg.gear.sockets },
        leagueBonus: cfg.leagues.map((l) => l.gemBonus),
        levelShare: cfg.gems.levelShare,
        maxLevel: cfg.gems.maxLevel,
      },
      itemRules: {
        levelBonus: { ...cfg.gear.levelBonus },
        maxLevel: cfg.gear.maxItemLevel,
        copiesPerLevel: cfg.gear.copiesPerLevel,
        scrapByRarity: { ...cfg.gear.scrapByRarity },
        upgradeScrap: cfg.gear.upgradeScrap,
      },
      power: lordPower(state, lordId, t),
      powerRules: { ...cfg.power },
      capitalId: lord.capitalId,
      alive: lord.alive,
      exiles: lord.exiles,
      stats: { ...lord.stats },
      activeMarches: state.marches.filter((m) => m.owner === lordId).length,
      clanId: lord.clanId,
      level: lord.level,
      xp: lord.xp,
      nextLevelXp: lord.level < cfg.levels.maxLevel ? xpForLevel(state, lord.level) : null,
    },
    lords: state.lordOrder.flatMap((id) => {
      const l = state.lords[id];
      return l
        ? [
            {
              id: l.id,
              name: l.name,
              color: l.color,
              isBot: l.isBot,
              alive: l.alive,
              style: l.style,
              clanId: l.clanId,
              level: l.level,
              power: lordPower(state, l.id, t),
            },
          ]
        : [];
    }),
    isles: state.isles.map((isle) => ({
      ...isle,
      pos: { x: isle.pos.x, y: isle.pos.y },
      shape: [...isle.shape],
      townIds: isle.townIds.filter((id) => !hidden(id)),
      slots: isle.slots.map((slot) => ({ pos: { x: slot.pos.x, y: slot.pos.y }, lordId: slot.lordId })),
    })),
    zones: state.zones.map((zone) => ({
      ...zone,
      pos: { x: zone.pos.x, y: zone.pos.y },
      townIds: [...zone.townIds],
    })),
    lanes: state.lanes.map((lane) => ({ a: lane.a, b: lane.b })),
    towns,
    marches,
    wind: { dir: state.windDirs[index] ?? 0, nextShiftAt: forecast[0]?.at ?? null, forecast },
    season: {
      startsAt: state.startsAt,
      endsAt: state.endsAt,
      throneUnsealAt: state.throneUnsealAt,
      throneUnsealed: state.throneUnsealed,
      throneTownId: state.throneTownId,
      status: state.status,
      capitalImmune: cfg.rules.capitalImmune,
    },
    reports: state.reports
      .filter(
        (r) => r.attacker === lordId || r.defender === lordId || r.allies.some((a) => a.lordId === lordId),
      )
      .reverse(),
    scouts: state.scouts
      .filter((r) => r.scout === lordId || r.owner === lordId)
      .map((r) => {
        const mine = r.scout === lordId;
        return {
          id: r.id,
          at: r.at,
          townId: r.townId,
          scout: r.scout,
          owner: r.owner,
          troops: mine ? r.troops : null,
          walls: mine ? r.walls : null,
          defenseMult: mine ? r.defenseMult : null,
          defense: mine ? r.defense : null,
        };
      })
      .reverse(),
    standings: computeStandings(state, t),
  };
}
