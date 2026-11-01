import { MINUTE_MS, TROOP_TYPES } from '@si/config/constants';
import { resolveSiege } from './combat';
import { fortification } from './economy';
import { distance, windFactor } from './geometry';
import { lordMods, neutralMods } from './modifiers';
import { schedule } from './queue';
import { addTroops, cloneTroops, subTroops, totalTroops, zeroTroops } from './troops';
import type { BattleReport, DomainEvent, GameState, Lord, March, Town, Troops } from './types';
import { areAllies, checkExile, getLord, openDrafts, setOwner } from './world';

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

/** Puts troops already taken out of a town on the road; the mission is decided on arrival. */
export function dispatchMarch(
  state: GameState,
  lordId: string,
  from: Town,
  to: Town,
  troops: Troops,
  at: number,
  events: DomainEvent[],
): March {
  const travel = travelInfo(state, lordId, from, to, troops, at);
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

/** Sends troops from the lord's garrison, or from its contingent stationed in an ally's town. */
export function launchMarch(
  state: GameState,
  lordId: string,
  from: Town,
  to: Town,
  troops: Troops,
  at: number,
  events: DomainEvent[],
): March {
  if (from.owner === lordId) {
    from.garrison = subTroops(from.garrison, troops);
  } else {
    from.stationed = from.stationed
      .map((s) => (s.lordId === lordId ? { lordId, troops: subTroops(s.troops, troops) } : s))
      .filter((s) => totalTroops(s.troops) > 0);
  }
  return dispatchMarch(state, lordId, from, to, troops, at, events);
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
  if (areAllies(state, march.owner, town.owner)) {
    const mine = town.stationed.find((s) => s.lordId === march.owner);
    if (mine) mine.troops = addTroops(mine.troops, march.troops);
    else town.stationed.push({ lordId: march.owner, troops: cloneTroops(march.troops) });
    events.push({ type: 'MARCH_STATIONED', at, march });
    return;
  }
  // A neutral town can become someone's capital while a march is on its way.
  if (state.config.rules.capitalImmune && town.isCapital) {
    const origin = state.towns[march.from];
    if (origin?.owner === march.owner) origin.garrison = addTroops(origin.garrison, march.troops);
    events.push({ type: 'MARCH_REPELLED', at, march });
    return;
  }
  fight(state, march, town, at, events);
}

function fight(state: GameState, march: March, town: Town, at: number, events: DomainEvent[]): void {
  const cfg = state.config;
  const attacker = getLord(state, march.owner);
  if (!attacker) return;
  const defenderId = town.owner;
  const attackMods = lordMods(state, attacker.id);
  const contingents = [
    {
      lordId: defenderId,
      troops: cloneTroops(town.garrison),
      mods: defenderId === null ? neutralMods() : lordMods(state, defenderId),
    },
    ...town.stationed.map((s) => ({
      lordId: s.lordId as string | null,
      troops: cloneTroops(s.troops),
      mods: lordMods(state, s.lordId),
    })),
  ];
  const fort = fortification(state, town);
  const outcome = resolveSiege(cfg, {
    attacker: march.troops,
    attackMults: attackMods.attack,
    attackerLossMult: attackMods.winnerLosses,
    defenders: contingents.map((c) => ({
      troops: c.troops,
      defenseMults: c.mods.defense,
      lossMult: c.mods.winnerLosses,
    })),
    fort,
  });

  const [garrison, ...allied] = outcome.defenders;
  town.garrison = garrison?.survivors ?? zeroTroops();
  town.stationed = town.stationed
    .map((s, i) => ({ lordId: s.lordId, troops: allied[i]?.survivors ?? zeroTroops() }))
    .filter((s) => totalTroops(s.troops) > 0);

  const killedByAttacker = outcome.defenders.reduce((sum, d) => sum + totalTroops(d.lost), 0);
  const killedByDefenders = totalTroops(outcome.attackerLost);
  attacker.stats.troopsKilled += killedByAttacker;
  attacker.stats.troopsLost += killedByDefenders;
  attacker.glory += killedByAttacker / cfg.glory.troopsPerPoint;

  const attackerWon = outcome.winner === 'ATTACKER';
  if (attackerWon) attacker.stats.battlesWon++;
  else attacker.stats.battlesLost++;
  // Defending lords share the kills (and the glory) in proportion to the power they brought.
  const defenders: Lord[] = [];
  contingents.forEach((c, i) => {
    const lord = c.lordId === null ? undefined : getLord(state, c.lordId);
    const result = outcome.defenders[i];
    if (!lord || !result) return;
    defenders.push(lord);
    const share = outcome.defenderPower > 0 ? result.power / outcome.defenderPower : i === 0 ? 1 : 0;
    const kills = killedByDefenders * share;
    lord.stats.troopsKilled += Math.round(kills);
    lord.stats.troopsLost += totalTroops(result.lost);
    lord.glory += kills / cfg.glory.troopsPerPoint;
    if (attackerWon) lord.stats.battlesLost++;
    else lord.stats.battlesWon++;
  });

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
    defenderTroops: contingents.reduce((sum, c) => addTroops(sum, c.troops), zeroTroops()),
    attackerPower: outcome.attackerPower,
    defenderPower: outcome.defenderPower,
    fort,
    attackerLost: outcome.attackerLost,
    defenderLost: outcome.defenders.reduce((sum, d) => addTroops(sum, d.lost), zeroTroops()),
    winner: outcome.winner,
    captured,
    plunder,
    allies: contingents.slice(1).map((c, i) => ({
      lordId: c.lordId ?? '',
      troops: c.troops,
      lost: allied[i]?.lost ?? zeroTroops(),
    })),
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
  for (const lord of defenders) openDrafts(state, lord, at, events);
  checkExile(state, attacker.id, at, events);
  if (defenderId !== null) checkExile(state, defenderId, at, events);
}
