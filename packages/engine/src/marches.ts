import { MINUTE_MS } from '@si/config/constants';
import { resolveSiege } from './combat';
import { fortification, plunderAt, townWalls } from './economy';
import { distance, windFactor } from './geometry';
import { lordMods, type LordMods } from './modifiers';
import { xpMultiplier } from './power';
import { schedule } from './queue';
import type { BattleReport, DomainEvent, GameState, Lord, March, ScoutReport, Town } from './types';
import { areAllies, checkExile, gainXp, getLord, recoverTroops, setOwner } from './world';

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

/** Digits in the troop count: 1 up to 9 troops, 2 up to 99… */
function digits(troops: number): number {
  let d = 1;
  for (let n = troops; n >= 10; n /= 10) d++;
  return d;
}

/** The power-of-ten band a troop count falls in: 1–10, 10–100, 100–1000… */
export function troopRange(troops: number): [number, number] {
  const low = 10 ** (digits(troops) - 1);
  return [low, low * 10];
}

/** How much longer an army takes than 9 troops or fewer: +`march.perDigit` per extra digit. */
export function troopSlowdown(state: GameState, troops: number): number {
  return 1 + state.config.march.perDigit * (digits(troops) - 1);
}

/** The wind factor is read at departure and stays locked for the whole flight. */
export function travelInfo(
  state: GameState,
  lordId: string,
  from: Town,
  to: Town,
  troops: number,
  departAt: number,
  mods?: LordMods,
): TravelInfo {
  const cfg = state.config;
  const sky = from.isleId !== to.isleId;
  let speed = (sky ? cfg.march.skySpeed : cfg.march.landSpeed) * (mods ?? lordMods(state, lordId)).speed;
  let factor = 1;
  if (sky) {
    factor = windFactor(
      from.pos,
      to.pos,
      windDirAt(state, departAt),
      cfg.wind.tailwindMax,
      cfg.wind.headwindMin,
    );
    speed *= factor;
  }
  const minutes = Math.max(
    cfg.march.minDurationMin,
    (distance(from.pos, to.pos) / speed) * troopSlowdown(state, troops),
  );
  return { durationMs: Math.max(1, Math.round(minutes * MINUTE_MS)), windFactor: factor, sky };
}

export function isAttack(state: GameState, lordId: string, to: Town): boolean {
  return to.owner !== lordId && !areAllies(state, lordId, to.owner);
}

/** Attacks in flight, a synchronized group counting once; reinforcements never count. */
export function activeAttacks(state: GameState, lordId: string): number {
  const keys = new Set<number>();
  for (const m of state.marches) if (m.owner === lordId && m.attack) keys.add(m.groupId ?? -m.id);
  return keys.size;
}

/**
 * Puts troops already taken out of a town on the road; the mission is decided on arrival. A group
 * passes its common arrival time and id.
 */
export function dispatchMarch(
  state: GameState,
  lordId: string,
  from: Town,
  to: Town,
  troops: number,
  at: number,
  events: DomainEvent[],
  group?: { arriveAt: number; id: number },
  scout = false,
): March {
  const travel = travelInfo(state, lordId, from, to, troops, at);
  const march: March = {
    id: state.nextMarchId++,
    owner: lordId,
    from: from.id,
    to: to.id,
    troops,
    departAt: at,
    arriveAt: group?.arriveAt ?? at + travel.durationMs,
    windFactor: travel.windFactor,
    sky: travel.sky,
    groupId: group?.id ?? null,
    attack: !scout && isAttack(state, lordId, to),
    ...(scout ? { scout: true } : {}),
  };
  state.marches.push(march);
  schedule(state, march.arriveAt, { kind: 'MARCH_ARRIVAL', marchId: march.id });
  events.push({ type: 'MARCH_LAUNCHED', at, march: { ...march } });
  return march;
}

/** Sends troops from the lord's garrison, or from its contingent stationed in an ally's town. */
export function launchMarch(
  state: GameState,
  lordId: string,
  from: Town,
  to: Town,
  troops: number,
  at: number,
  events: DomainEvent[],
  scout = false,
): March {
  if (from.owner === lordId) {
    from.garrison -= troops;
  } else {
    from.stationed = from.stationed
      .map((s) => (s.lordId === lordId ? { lordId, troops: s.troops - troops } : s))
      .filter((s) => s.troops > 0);
  }
  return dispatchMarch(state, lordId, from, to, troops, at, events, undefined, scout);
}

/**
 * Every source sends its whole garrison. All leave now and arrive with the slowest one: the closer
 * ones simply travel slower.
 */
export function launchGroup(
  state: GameState,
  lordId: string,
  sources: Town[],
  to: Town,
  at: number,
  events: DomainEvent[],
): March[] {
  const legs = sources.map((from) => ({ from, troops: from.garrison }));
  const slowest = Math.max(
    ...legs.map((l) => travelInfo(state, lordId, l.from, to, l.troops, at).durationMs),
  );
  const group = { arriveAt: at + slowest, id: state.nextMarchId };
  return legs.map(({ from, troops }) => {
    from.garrison -= troops;
    return dispatchMarch(state, lordId, from, to, troops, at, events, group);
  });
}

/**
 * The mission is decided on arrival: an own town is reinforced, any other town is attacked. A group
 * resolves as one army when its first march arrives (the others land in the same instant).
 */
export function arriveMarch(state: GameState, marchId: number, at: number, events: DomainEvent[]): void {
  const index = state.marches.findIndex((m) => m.id === marchId);
  if (index < 0) return;
  const first = state.marches[index] as March;
  const legs = state.marches.filter(
    (m) => m.id === marchId || (first.groupId !== null && m.groupId === first.groupId),
  );
  state.marches = state.marches.filter((m) => !legs.includes(m));
  const march: March = { ...first, troops: legs.reduce((sum, m) => sum + m.troops, 0) };
  const town = state.towns[march.to];
  if (!town) return;
  if (town.owner === march.owner) {
    town.garrison += march.troops;
    events.push({ type: 'MARCH_REINFORCED', at, march });
    return;
  }
  if (areAllies(state, march.owner, town.owner)) {
    const mine = town.stationed.find((s) => s.lordId === march.owner);
    if (mine) mine.troops += march.troops;
    else town.stationed.push({ lordId: march.owner, troops: march.troops });
    events.push({ type: 'MARCH_STATIONED', at, march });
    return;
  }
  if (march.scout) {
    scoutTown(state, march, town, at, events);
    return;
  }
  // A neutral town can become someone's capital while a march is on its way.
  if (state.config.rules.capitalImmune && town.isCapital) {
    for (const leg of legs) {
      const origin = state.towns[leg.from];
      if (origin?.owner === leg.owner) origin.garrison += leg.troops;
    }
    events.push({ type: 'MARCH_REPELLED', at, march });
    return;
  }
  fight(state, march, town, at, events);
}

/** The scout counts the defense as a battle would, reports it and is lost; nothing else changes. */
function scoutTown(state: GameState, march: March, town: Town, at: number, events: DomainEvent[]): void {
  const cfg = state.config;
  const contingents = [
    { lordId: town.owner, troops: town.garrison },
    ...town.stationed.map((s) => ({ lordId: s.lordId as string | null, troops: s.troops })),
  ];
  const fort = fortification(state, town);
  const walls = townWalls(state, town);
  const siege = resolveSiege(cfg, {
    attacker: 0,
    attackMult: 1,
    defenders: contingents.map((c) => ({ troops: c.troops, defense: lordMods(state, c.lordId).defense })),
    fort,
    walls,
  });
  const report: ScoutReport = {
    id: state.nextReportId++,
    at,
    townId: town.id,
    marchId: march.id,
    scout: march.owner,
    owner: town.owner,
    troops: contingents.reduce((sum, c) => sum + c.troops, 0),
    walls,
    fort,
    defenseMult: fort * lordMods(state, town.owner).defense,
    defense: siege.defenderPower,
  };
  state.scouts.push(report);
  const excess = state.scouts.length - cfg.limits.reportsKept;
  if (excess > 0) state.scouts.splice(0, excess);
  events.push({ type: 'SCOUTED', at, report });
}

function fight(state: GameState, march: March, town: Town, at: number, events: DomainEvent[]): void {
  const cfg = state.config;
  const attacker = getLord(state, march.owner);
  if (!attacker) return;
  const defenderId = town.owner;
  const contingents = [
    { lordId: defenderId, troops: town.garrison },
    ...town.stationed.map((s) => ({ lordId: s.lordId as string | null, troops: s.troops })),
  ];
  const fort = fortification(state, town);
  const walls = townWalls(state, town);
  // Measured before the fight, with the arriving army back in the attacker's power. A target that grew
  // too weak while the march was on its way still pays the lowest rate.
  const xpMult = Math.max(cfg.power.lowXp, xpMultiplier(state, march.owner, town.owner, at, march.troops));
  const outcome = resolveSiege(cfg, {
    attacker: march.troops,
    attackMult: lordMods(state, attacker.id).attack,
    defenders: contingents.map((c) => ({ troops: c.troops, defense: lordMods(state, c.lordId).defense })),
    fort,
    walls,
  });

  const [garrison, ...allied] = outcome.defenders;
  town.garrison = garrison?.survivors ?? 0;
  town.stationed = town.stationed
    .map((s, i) => ({ lordId: s.lordId, troops: allied[i]?.survivors ?? 0 }))
    .filter((s) => s.troops > 0);

  const killedByAttacker = outcome.defenders.reduce((sum, d) => sum + d.lost, 0);
  const killedByDefenders = outcome.attackerLost;
  const attackerWon = outcome.winner === 'ATTACKER';
  attacker.stats.troopsKilled += killedByAttacker;
  attacker.stats.troopsLost += killedByDefenders;
  if (attackerWon) attacker.stats.battlesWon++;
  else attacker.stats.battlesLost++;
  const rewards = {
    attackerXp: killedByAttacker * cfg.kills.xp.attack * xpMult * lordMods(state, attacker.id).xp,
    attackerGold: killedByAttacker * cfg.kills.gold.attack * lordMods(state, attacker.id).killGold,
    defenderXp: defenderId === null ? 0 : killedByDefenders * cfg.kills.xp.defend,
    defenderGold: 0,
  };
  attacker.gold += rewards.attackerGold;
  const defendGold = defenderId === null ? 0 : killedByDefenders * cfg.kills.gold.defend;

  // Defending lords share the kill rewards in proportion to the power they brought (walls go to the owner).
  const defenders: { lord: Lord; share: number; lost: number; index: number }[] = [];
  contingents.forEach((c, i) => {
    const lord = c.lordId === null ? undefined : getLord(state, c.lordId);
    const result = outcome.defenders[i];
    if (!lord || !result) return;
    const share = outcome.defenderPower > 0 ? result.power / outcome.defenderPower : i === 0 ? 1 : 0;
    defenders.push({ lord, share, lost: result.lost, index: i });
    lord.stats.troopsKilled += Math.round(killedByDefenders * share);
    lord.stats.troopsLost += result.lost;
    const gold = defendGold * share * lordMods(state, lord.id).killGold;
    lord.gold += gold;
    rewards.defenderGold += gold;
    if (attackerWon) lord.stats.battlesLost++;
    else lord.stats.battlesWon++;
  });

  // Without a survivor the garrison is still wiped out, but nobody is left to hold the town.
  const captured = attackerWon && outcome.attackerSurvivors > 0;
  let plunder = 0;
  if (captured) {
    plunder = plunderAt(cfg, town.tier);
    attacker.gold += plunder;
    attacker.stats.captures++;
  }

  // The report goes before the capture events, but recovery has to wait for capitals to move.
  const battleAt = events.length;
  let refund = 0;
  if (captured) {
    const loser = defenderId === null ? undefined : getLord(state, defenderId);
    if (loser) {
      refund = Math.floor(town.invested * lordMods(state, loser.id).refund);
      loser.gold += refund;
    }
    setOwner(state, town, attacker.id, at, events);
    town.garrison = outcome.attackerSurvivors;
  }
  const attackerRecovered = recoverTroops(state, attacker.id, killedByDefenders, cfg.league.attackerRecovery);
  const recovered = contingents.map(() => 0);
  for (const d of defenders) {
    recovered[d.index] = recoverTroops(state, d.lord.id, d.lost, cfg.league.defenderRecovery);
  }

  const report: BattleReport = {
    id: state.nextReportId++,
    at,
    townId: town.id,
    marchId: march.id,
    attacker: attacker.id,
    defender: defenderId,
    attackerTroops: march.troops,
    defenderTroops: contingents.reduce((sum, c) => sum + c.troops, 0),
    attackerPower: outcome.attackerPower,
    defenderPower: outcome.defenderPower,
    fort,
    walls,
    defenseMult: fort * lordMods(state, defenderId).defense,
    attackerLost: killedByDefenders,
    defenderLost: killedByAttacker,
    attackerRecovered,
    defenderRecovered: recovered[0] ?? 0,
    winner: outcome.winner,
    captured,
    plunder,
    refund,
    xpMult,
    rewards,
    allies: contingents.slice(1).map((c, i) => ({
      lordId: c.lordId ?? '',
      troops: c.troops,
      lost: allied[i]?.lost ?? 0,
      recovered: recovered[i + 1] ?? 0,
    })),
  };
  state.reports.push(report);
  const excess = state.reports.length - cfg.limits.reportsKept;
  if (excess > 0) state.reports.splice(0, excess);
  events.splice(battleAt, 0, { type: 'BATTLE', at, report });

  gainXp(state, attacker, rewards.attackerXp, at, events);
  for (const d of defenders) {
    gainXp(state, d.lord, rewards.defenderXp * d.share * lordMods(state, d.lord.id).xp, at, events);
  }
  checkExile(state, attacker.id, at, events);
  if (defenderId !== null) checkExile(state, defenderId, at, events);
}
