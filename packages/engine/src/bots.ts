import type { PersonalityConfig } from '@si/config';
import { applyCommand } from './commands';
import { resolveBattle, type BattleOutcome } from './combat';
import { fortification, townRates, upgradeCost } from './economy';
import { distance } from './geometry';
import { travelInfo, type TravelInfo } from './marches';
import { modsMemo, neutralMods, type LordMods } from './modifiers';
import { addTroops, scaleTroops, splitGarrison, totalTroops, zeroTroops } from './troops';
import type { DomainEvent, GameState, Lord, Town, Troops } from './types';
import { visibleIsles } from './vision';
import { isleNeighbors, islesLinked, townsOf } from './world';

/** Only the strongest towns are weighed as attack sources, so big realms keep turns cheap. */
const SOURCES_PER_ATTACK = 4;

interface Turn {
  state: GameState;
  lord: Lord;
  p: PersonalityConfig;
  mods: LordMods;
  /** Lord modifiers memoized for the turn: the bot's own sends never change who owns what. */
  modsOf: (lordId: string | null) => LordMods;
  now: number;
  events: DomainEvent[];
  visible: Set<number>;
  /** Towns that already sent a march this turn. */
  busy: Set<number>;
  /** Towns this lord already has a march heading to. */
  targeted: Set<number>;
}

/** One bot decision round. Bots act only through applyCommand, so they obey the same rules as players. */
export function botTurn(state: GameState, lordId: string, now: number, events: DomainEvent[]): void {
  const lord = state.lords[lordId];
  if (!lord || !lord.alive || !lord.personality) return;
  const modsOf = modsMemo(state);
  const turn: Turn = {
    state,
    lord,
    p: state.config.bots.personalities[lord.personality],
    mods: modsOf(lordId),
    modsOf,
    now,
    events,
    visible: visibleIsles(state, lordId),
    busy: new Set(),
    targeted: new Set(state.marches.filter((m) => m.owner === lordId).map((m) => m.to)),
  };
  defend(turn);
  upgrade(turn);
  attack(turn);
  consolidate(turn);
}

function send(turn: Turn, from: Town, to: Town, troops: Troops): boolean {
  const command = { type: 'SEND', from: from.id, to: to.id, troops };
  if (applyCommand(turn.state, turn.lord.id, command, turn.now, turn.events)) return false;
  turn.busy.add(from.id);
  turn.targeted.add(to.id);
  return true;
}

function spare(turn: Turn, town: Town): Troops {
  return scaleTroops(town.garrison, 1 - turn.p.keepHome);
}

function marchSlots(turn: Turn): number {
  const active = turn.state.marches.filter((m) => m.owner === turn.lord.id).length;
  return turn.state.config.march.maxActivePerLord - active;
}

/** Unseen garrisons are guessed: neutrals at their regeneration ceiling, lords at their cap. */
function knownGarrison(turn: Turn, town: Town): Troops {
  const cfg = turn.state.config;
  if (turn.visible.has(town.isleId))
    return town.stationed.reduce((sum, s) => addTroops(sum, s.troops), town.garrison);
  const size = town.owner === null ? town.neutralCap : (cfg.towns.garrisonCap[town.tier - 1] ?? 0);
  return splitGarrison(size, town.spec, cfg.neutral.mainShare);
}

function predictAttack(turn: Turn, attackers: Troops, target: Town, defenders: Troops): BattleOutcome {
  const state = turn.state;
  const defense = target.owner === null ? neutralMods() : turn.modsOf(target.owner);
  return resolveBattle(state.config, {
    attacker: attackers,
    defender: defenders,
    attackMults: turn.mods.attack,
    defenseMults: defense.defense,
    fort: fortification(state, target, turn.modsOf(target.owner)),
    attackerLossMult: turn.mods.winnerLosses,
    defenderLossMult: defense.winnerLosses,
  });
}

function defend(turn: Turn): void {
  const { state, lord, now } = turn;
  let budget = turn.p.reinforcementsPerTurn;
  const threats = state.marches
    .filter((m) => m.owner !== lord.id && state.towns[m.to]?.owner === lord.id)
    .sort((a, b) => a.arriveAt - b.arriveAt || a.id - b.id);

  for (const threat of threats) {
    if (budget <= 0 || marchSlots(turn) <= 0) return;
    const town = state.towns[threat.to];
    if (!town) continue;
    const arriving = state.marches
      .filter((m) => m.owner === lord.id && m.to === town.id && m.arriveAt <= threat.arriveAt)
      .reduce((sum, m) => addTroops(sum, m.troops), zeroTroops());
    const enemy = turn.modsOf(threat.owner);
    const outcome = resolveBattle(state.config, {
      attacker: threat.troops,
      defender: addTroops(town.garrison, arriving),
      attackMults: enemy.attack,
      defenseMults: turn.mods.defense,
      fort: fortification(state, town, turn.mods),
      attackerLossMult: enemy.winnerLosses,
      defenderLossMult: turn.mods.winnerLosses,
    });
    if (outcome.winner === 'DEFENDER') continue;

    let best: { from: Town; troops: Troops; travel: TravelInfo } | null = null;
    for (const from of townsOf(state, lord.id)) {
      if (from.id === town.id || turn.busy.has(from.id)) continue;
      if (!islesLinked(state, from.isleId, town.isleId)) continue;
      const troops = spare(turn, from);
      if (totalTroops(troops) === 0) continue;
      const travel = travelInfo(state, lord.id, from, town, troops, now, turn.mods);
      if (now + travel.durationMs >= threat.arriveAt) continue;
      if (!best || travel.durationMs < best.travel.durationMs) best = { from, troops, travel };
    }
    if (best && send(turn, best.from, town, best.troops)) budget--;
  }
}

function upgradeGain(state: GameState, town: Town): number {
  const cfg = state.config;
  const current = townRates(state, town);
  const next = townRates(state, { ...town, tier: town.tier + 1 });
  const dominion = (cfg.dominion.perTier[town.tier] ?? 0) - (cfg.dominion.perTier[town.tier - 1] ?? 0);
  return next.gold - current.gold + next.troops - current.troops + dominion;
}

function upgrade(turn: Turn): void {
  const { state, lord, p } = turn;
  for (let i = 0; i < p.upgradesPerTurn; i++) {
    let best: { town: Town; score: number } | null = null;
    for (const town of townsOf(state, lord.id)) {
      const cost = upgradeCost(state, town);
      if (cost === null || lord.gold - cost < p.goldReserve) continue;
      const score = upgradeGain(state, town) / cost;
      if (!best || score > best.score) best = { town, score };
    }
    if (!best) return;
    const command = { type: 'UPGRADE', townId: best.town.id };
    if (applyCommand(state, lord.id, command, turn.now, turn.events)) return;
  }
}

/** Dominion-per-minute the target would add, weighted by the personality. */
function targetValue(turn: Turn, to: Town): number {
  const { state, lord, p } = turn;
  const cfg = state.config;
  let value = (cfg.dominion.perTier[to.tier - 1] ?? 0) * (to.owner === null ? 1 : p.lordAggression);
  const zone = to.zoneId === null ? undefined : state.zones[to.zoneId];
  if (zone) {
    // Worth more the closer it brings the lord to lighting the zone's beacon.
    const owned = zone.townIds.filter((id) => id === to.id || state.towns[id]?.owner === lord.id).length;
    value += cfg.beacon.dominionPerMin * 3 * (owned / zone.townIds.length) ** 2;
  }
  if (to.isThrone) value += cfg.throne.dominionPerMin * p.throneDesire;
  return value;
}

/** Up to `limit` towns on `isles` that pass `accept`, nearest to `from` first. */
function nearest(
  state: GameState,
  from: Town,
  isles: number[],
  limit: number,
  accept: (to: Town) => boolean,
): Town[] {
  const best: { to: Town; d: number }[] = [];
  for (const isleId of isles) {
    for (const id of state.isles[isleId]?.townIds ?? []) {
      const to = state.towns[id] as Town;
      if (to.id === from.id || !accept(to)) continue;
      const d = distance(from.pos, to.pos);
      if (best.length === limit && d >= (best[limit - 1]?.d ?? Infinity)) continue;
      let i = Math.min(best.length, limit - 1);
      best[i] = { to, d };
      while (i > 0 && (best[i - 1]?.d ?? 0) > d) {
        best[i] = best[i - 1] as { to: Town; d: number };
        best[i - 1] = { to, d };
        i--;
      }
    }
  }
  return best.map((p) => p.to);
}

function seenBy(lordId: string, town: Town): boolean {
  return town.privateTo === null || town.privateTo === lordId;
}

/**
 * The nearest towns `from` could attack (big isles hold too many towns to weigh them all), plus a few
 * on each linked isle so bots still look across the lanes.
 */
function targetsNear(turn: Turn, from: Town): Town[] {
  const { state, lord } = turn;
  const capitalImmune = state.config.rules.capitalImmune;
  const limit = state.config.bots.targetsPerTown;
  const accept = (to: Town): boolean =>
    to.owner !== lord.id &&
    seenBy(lord.id, to) &&
    !(to.isThrone && !state.throneUnsealed) &&
    !(to.isCapital && capitalImmune);
  const across = (isleNeighbors(state)[from.isleId] ?? []).flatMap((isleId) =>
    nearest(state, from, [isleId], Math.ceil(limit / 4), accept),
  );
  return [...nearest(state, from, [from.isleId], limit, accept), ...across];
}

function attack(turn: Turn): void {
  const { state, lord, p, now } = turn;
  let slots = Math.min(p.attacksPerTurn, marchSlots(turn));
  if (slots <= 0) return;
  const options: { from: Town; to: Town; troops: Troops; score: number }[] = [];

  const sources = townsOf(state, lord.id)
    .filter((from) => !turn.busy.has(from.id))
    .map((from) => ({ from, troops: spare(turn, from) }))
    .filter((x) => totalTroops(x.troops) >= p.minAttackTroops)
    .sort((a, b) => totalTroops(b.troops) - totalTroops(a.troops) || a.from.id - b.from.id)
    .slice(0, slots * SOURCES_PER_ATTACK);
  for (const { from, troops } of sources) {
    for (const to of targetsNear(turn, from)) {
      if (turn.targeted.has(to.id)) continue;
      const value = targetValue(turn, to);
      if (value <= 0) continue;
      const outcome = predictAttack(turn, troops, to, knownGarrison(turn, to));
      if (outcome.attackerPower < outcome.defenderPower * p.attackMargin) continue;
      const travel = travelInfo(state, lord.id, from, to, troops, now, turn.mods);
      if (travel.sky && travel.windFactor < p.minWindFactor) continue;
      options.push({ from, to, troops, score: value / travel.durationMs });
    }
  }

  options.sort((a, b) => b.score - a.score || a.from.id - b.from.id || a.to.id - b.to.id);
  for (const option of options) {
    if (slots <= 0) return;
    if (turn.busy.has(option.from.id) || turn.targeted.has(option.to.id)) continue;
    if (send(turn, option.from, option.to, option.troops)) slots--;
  }
}

/** How exposed a town is: foreign towns among its nearest neighbors, plus the Throne for lords who want it. */
function frontierScore(turn: Turn, town: Town): number {
  const { state, lord, p } = turn;
  const reach = [town.isleId, ...(isleNeighbors(state)[town.isleId] ?? [])];
  const around = nearest(state, town, reach, state.config.bots.targetsPerTown, (t) => seenBy(lord.id, t));
  let score = around.filter((t) => t.owner !== lord.id).length;
  const throneIsle = state.throneTownId === null ? undefined : state.towns[state.throneTownId]?.isleId;
  if (state.throneUnsealed && throneIsle !== undefined && islesLinked(state, town.isleId, throneIsle)) {
    score += p.throneDesire;
  }
  return score;
}

/** Towns stuck at their cap push their spare troops to the most exposed of their nearest own towns. */
function consolidate(turn: Turn): void {
  const { state, lord, p } = turn;
  const scores = new Map<number, number>();
  const scoreOf = (t: Town): number => {
    let score = scores.get(t.id);
    if (score === undefined) {
      score = frontierScore(turn, t);
      scores.set(t.id, score);
    }
    return score;
  };

  for (const from of townsOf(state, lord.id)) {
    if (marchSlots(turn) <= 0) return;
    if (turn.busy.has(from.id)) continue;
    const cap = state.config.towns.garrisonCap[from.tier - 1] ?? 0;
    if (totalTroops(from.garrison) < cap) continue;
    const reach = [from.isleId, ...(isleNeighbors(state)[from.isleId] ?? [])];
    const near = nearest(state, from, reach, state.config.bots.targetsPerTown, (t) => t.owner === lord.id);
    let best: Town | null = null;
    for (const t of near) {
      if (scoreOf(t) <= scoreOf(from)) continue;
      if (!best || scoreOf(t) > scoreOf(best)) best = t;
    }
    if (!best) continue;
    const troops = spare(turn, from);
    if (totalTroops(troops) >= p.minAttackTroops) send(turn, from, best, troops);
  }
}
