import {
  dominionRates,
  fortification,
  goldRate,
  projectedDominion,
  projectedGarrison,
  projectedGold,
  respecCost,
  townRates,
  upgradeCost,
} from './economy';
import { computeStandings } from './game';
import { windIndexAt, windShiftMs } from './marches';
import { cloneTroops } from './troops';
import type {
  BattleReport,
  EdictId,
  GameState,
  Isle,
  Lane,
  LordStats,
  SeasonStatus,
  Standing,
  Troops,
  TroopType,
  Vec,
} from './types';
import { visibleIsles } from './vision';

export interface OwnTownInfo {
  goldPerMin: number;
  troopsPerMin: number;
  cap: number;
  upgradeCost: number | null;
  respecCost: number;
}

export interface TownView {
  id: number;
  isleId: number;
  pos: Vec;
  tier: number;
  spec: TroopType;
  owner: string | null;
  isCapital: boolean;
  isThrone: boolean;
  fort: number;
  /** Null when the garrison is out of sight. */
  garrison: Troops | null;
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
  /** Shown for own marches and for marches aimed at the viewer's towns. */
  troops: Troops | null;
  mine: boolean;
  incoming: boolean;
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
  gold: number;
  goldPerMin: number;
  dominion: number;
  dominionPerMin: number;
  glory: number;
  nextGlory: number | null;
  edicts: EdictId[];
  draft: EdictId[] | null;
  capitalId: number | null;
  alive: boolean;
  exiles: number;
  stats: LordStats;
  activeMarches: number;
}

export interface LordSummary {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  alive: boolean;
}

export interface SeasonView {
  startsAt: number;
  endsAt: number;
  throneUnsealAt: number;
  throneUnsealed: boolean;
  throneTownId: number;
  status: SeasonStatus;
}

export interface LordView {
  now: number;
  title: string;
  me: MeView;
  lords: LordSummary[];
  isles: Isle[];
  lanes: Lane[];
  towns: TownView[];
  marches: MarchView[];
  wind: WindView;
  season: SeasonView;
  reports: BattleReport[];
  standings: Standing[];
}

/** What one lord may see at `now`, projected without touching the state. */
export function view(state: GameState, lordId: string, now: number): LordView {
  const cfg = state.config;
  const lord = state.lords[lordId];
  if (!lord) throw new Error(`unknown lord ${lordId}`);
  const t = Math.min(Math.max(now, state.accruedAt), state.endsAt);
  const visible = visibleIsles(state, lordId);

  const towns: TownView[] = state.towns.map((town) => {
    const mine = town.owner === lordId;
    let own: OwnTownInfo | null = null;
    if (mine) {
      const rates = townRates(state, town);
      own = {
        goldPerMin: rates.gold,
        troopsPerMin: rates.troops,
        cap: rates.cap,
        upgradeCost: upgradeCost(state, town),
        respecCost: respecCost(state, town),
      };
    }
    return {
      id: town.id,
      isleId: town.isleId,
      pos: { x: town.pos.x, y: town.pos.y },
      tier: town.tier,
      spec: town.spec,
      owner: town.owner,
      isCapital: town.isCapital,
      isThrone: town.isThrone,
      fort: fortification(state, town),
      garrison: mine || visible.has(town.isleId) ? cloneTroops(projectedGarrison(state, town, t)) : null,
      own,
    };
  });

  const isleOf = (townId: number): number => state.towns[townId]?.isleId ?? -1;
  const marches: MarchView[] = state.marches
    .filter(
      (m) =>
        m.owner === lordId ||
        state.towns[m.to]?.owner === lordId ||
        visible.has(isleOf(m.from)) ||
        visible.has(isleOf(m.to)),
    )
    .map((m) => {
      const mine = m.owner === lordId;
      const incoming = !mine && state.towns[m.to]?.owner === lordId;
      return {
        id: m.id,
        owner: m.owner,
        from: m.from,
        to: m.to,
        departAt: m.departAt,
        arriveAt: m.arriveAt,
        sky: m.sky,
        windFactor: mine ? m.windFactor : null,
        troops: mine || incoming ? cloneTroops(m.troops) : null,
        mine,
        incoming,
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
      gold: projectedGold(state, lordId, t),
      goldPerMin: goldRate(state, lordId),
      dominion: projectedDominion(state, lordId, t),
      dominionPerMin: dominionRates(state).get(lordId) ?? 0,
      glory: lord.glory,
      nextGlory: cfg.edicts.gloryThresholds[lord.draftsOpened] ?? null,
      edicts: [...lord.edicts],
      draft: lord.draft ? [...lord.draft] : null,
      capitalId: lord.capitalId,
      alive: lord.alive,
      exiles: lord.exiles,
      stats: { ...lord.stats },
      activeMarches: state.marches.filter((m) => m.owner === lordId).length,
    },
    lords: state.lordOrder.flatMap((id) => {
      const l = state.lords[id];
      return l ? [{ id: l.id, name: l.name, color: l.color, isBot: l.isBot, alive: l.alive }] : [];
    }),
    isles: state.isles.map((isle) => ({
      ...isle,
      pos: { x: isle.pos.x, y: isle.pos.y },
      shape: [...isle.shape],
      townIds: [...isle.townIds],
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
    },
    reports: state.reports.filter((r) => r.attacker === lordId || r.defender === lordId).reverse(),
    standings: computeStandings(state, t),
  };
}
