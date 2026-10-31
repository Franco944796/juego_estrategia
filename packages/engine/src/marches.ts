import { MINUTE_MS, TROOP_TYPES } from '@si/config/constants';
import { resolveBattle } from './combat';
import { fortification } from './economy';
import { distance, windFactor } from './geometry';
import { lordMods, neutralMods } from './modifiers';
import { schedule } from './queue';
import { addTroops, cloneTroops, subTroops, totalTroops } from './troops';
import type { BattleReport, DomainEvent, GameState, March, Town, Troops } from './types';
import { checkExile, getLord, openDrafts, setOwner } from './world';

export function windShiftMs(state: GameState): number {
  return Math.round(state.config.wind.shiftEveryMin * MINUTE_MS);
}

export function windIndexAt(state: GameState, t: number): number {
  const index = Math.floor((t - state.startsAt) / windShiftMs(state));
  return Math.min(state.windDirs.length - 1, Math.max(0, index));
}

export function windDirAt(state: GameState, t: number): number {
  return state.windDirs[windIndexAt(state, t)] ?? 0;
}

export interface TravelInfo {
  durationMs: number;
  windFactor: number;
  sky: boolean;
}

/** A march moves at the speed of its slowest troop type. */
export function slowestSpeed(state: GameState, lordId: string, troops: Troops): number {
  const mods = lordMods(state, lordId);
  let slowest = Infinity;
  for (const type of TROOP_TYPES) {
    if (troops[type] > 0) slowest = Math.min(slowest, state.config.troops[type].speed * mods.speed[type]);
  }
  return Number.isFinite(slowest) ? slowest : 1;
}

/** The wind factor is read at departure and stays locked for the whole flight. */
export function travelInfo(
  state: GameState,
  lordId: string,
  from: Town,
  to: Town,
  troops: Troops,
  departAt: number,
): TravelInfo {
  const cfg = state.config;
  const sky = from.isleId !== to.isleId;
  let speed = (sky ? cfg.march.skySpeed : cfg.march.landSpeed) * slowestSpeed(state, lordId, troops);
  let factor = 1;
  if (sky) {
    const headwindMin = Math.max(cfg.wind.headwindMin, lordMods(state, lordId).headwindMin ?? 0);
    factor = windFactor(from.pos, to.pos, windDirAt(state, departAt), cfg.wind.tailwindMax, headwindMin);
    speed *= factor;
  }
  const minutes = Math.max(cfg.march.minDurationMin, distance(from.pos, to.pos) / speed);
  return { durationMs: Math.max(1, Math.round(minutes * MINUTE_MS)), windFactor: factor, sky };
}

export function launchMarch(
  state: GameState,
  lordId: string,
  from: Town,
  to: Town,
  troops: Troops,
  at: number,
  events: DomainEvent[],
): March {
  const travel = travelInfo(state, lordId, from, to, troops, at);
  from.garrison = subTroops(from.garrison, troops);
  const march: March = {
    id: state.nextMarchId++,
    owner: lordId,
    from: from.id,
    to: to.id,
    troops: cloneTroops(troops),
    departAt: at,
    arriveAt: at + travel.durationMs,
    windFactor: travel.windFactor,
    sky: travel.sky,
  };
  state.marches.push(march);
  schedule(state, march.arriveAt, { kind: 'MARCH_ARRIVAL', marchId: march.id });
  events.push({ type: 'MARCH_LAUNCHED', at, march: { ...march, troops: cloneTroops(march.troops) } });
  return march;
}

/** The mission is decided on arrival: an own town is reinforced, any other town is attacked. */
export function arriveMarch(state: GameState, marchId: number, at: number, events: DomainEvent[]): void {
  const index = state.marches.findIndex((m) => m.id === marchId);
  if (index < 0) return;
  const march = state.marches.splice(index, 1)[0] as March;
  const town = state.towns[march.to];
  if (!town) return;
  if (town.owner === march.owner) {
    town.garrison = addTroops(town.garrison, march.troops);
    events.push({ type: 'MARCH_REINFORCED', at, march });
    return;
  }
  fight(state, march, town, at, events);
}

function fight(state: GameState, march: March, town: Town, at: number, events: DomainEvent[]): void {
  const cfg = state.config;
  const attacker = getLord(state, march.owner);
  if (!attacker) return;
  const defenderId = town.owner;
  const defender = defenderId === null ? undefined : getLord(state, defenderId);
  const attackMods = lordMods(state, attacker.id);
  const defenseMods = defenderId === null ? neutralMods() : lordMods(state, defenderId);
  const fort = fortification(state, town);
  const defenderTroops = cloneTroops(town.garrison);
  const outcome = resolveBattle(cfg, {
    attacker: march.troops,
    defender: defenderTroops,
    attackMults: attackMods.attack,
    defenseMults: defenseMods.defense,
    fort,
    attackerLossMult: attackMods.winnerLosses,
    defenderLossMult: defenseMods.winnerLosses,
  });

  town.garrison = outcome.defenderSurvivors;
  const killedByAttacker = totalTroops(outcome.defenderLost);
  const killedByDefender = totalTroops(outcome.attackerLost);
  attacker.stats.troopsKilled += killedByAttacker;
  attacker.stats.troopsLost += killedByDefender;
  attacker.glory += killedByAttacker / cfg.glory.troopsPerPoint;
  if (defender) {
    defender.stats.troopsKilled += killedByDefender;
    defender.stats.troopsLost += killedByAttacker;
    defender.glory += killedByDefender / cfg.glory.troopsPerPoint;
  }

  const attackerWon = outcome.winner === 'ATTACKER';
  if (attackerWon) {
    attacker.stats.battlesWon++;
    if (defender) defender.stats.battlesLost++;
  } else {
    attacker.stats.battlesLost++;
    if (defender) defender.stats.battlesWon++;
  }
  // Without a survivor the garrison is still wiped out, but nobody is left to hold the town.
  const captured = attackerWon && totalTroops(outcome.attackerSurvivors) > 0;
  let plunder = 0;
  if (captured) {
    plunder = (cfg.plunder.goldByTier[town.tier - 1] ?? 0) * attackMods.plunder;
    attacker.gold += plunder;
    attacker.glory += cfg.glory.perCaptureTier * town.tier;
    attacker.stats.captures++;
  }

  const report: BattleReport = {
    id: state.nextReportId++,
    at,
    townId: town.id,
    marchId: march.id,
    attacker: attacker.id,
    defender: defenderId,
    attackerTroops: cloneTroops(march.troops),
    defenderTroops,
    attackerPower: outcome.attackerPower,
    defenderPower: outcome.defenderPower,
    fort,
    attackerLost: outcome.attackerLost,
    defenderLost: outcome.defenderLost,
    winner: outcome.winner,
    captured,
    plunder,
  };
  state.reports.push(report);
  const excess = state.reports.length - cfg.limits.reportsKept;
  if (excess > 0) state.reports.splice(0, excess);
  events.push({ type: 'BATTLE', at, report });

  if (captured) {
    setOwner(state, town, attacker.id, at, events);
    town.garrison = outcome.attackerSurvivors;
  }
  openDrafts(state, attacker, at, events);
  if (defender) openDrafts(state, defender, at, events);
  checkExile(state, attacker.id, at, events);
  if (defender) checkExile(state, defender.id, at, events);
}
