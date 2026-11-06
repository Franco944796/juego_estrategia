import type { PersonalityConfig } from '@si/config';
import { applyCommand } from './commands';
import { resolveSiege, type SiegeOutcome } from './combat';
import { fortification, townRates, townWalls, upgradeCost, upgradePlan } from './economy';
import { distance } from './geometry';
import { activeAttacks, travelInfo, type TravelInfo } from './marches';
import { modsMemo, type LordMods } from './modifiers';
import { bestUpgrade } from './gear';
import { xpMultiplier } from './power';
import { botSkill, unspentPoints } from './skills';
import type { DomainEvent, GameState, Lord, Town } from './types';
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
  attackable: Map<string, boolean>;
  /** Share of each isle's public towns still neutral, by isle id. */
  freeShare: Map<number, number>;
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
    attackable: new Map(),
    freeShare: new Map(),
  };
  learn(turn);
  defend(turn);
  upgrade(turn);
  attack(turn);
  consolidate(turn);
}

function learn(turn: Turn): void {
  const { state, lord } = turn;
  while (unspentPoints(lord) > 0) {
    const skill = botSkill(state, lord);
    if (!skill || applyCommand(state, lord.id, { type: 'LEARN_SKILL', skill }, turn.now, turn.events)) break;
  }
  for (let item = bestUpgrade(state, lord); item; item = bestUpgrade(state, lord)) {
    if (applyCommand(state, lord.id, { type: 'EQUIP', itemId: item.id }, turn.now, turn.events)) break;
  }
  // New points and gear change this lord's modifiers, so the turn's memo starts over.
  turn.modsOf = modsMemo(state);
  turn.mods = turn.modsOf(lord.id);
}

function send(turn: Turn, from: Town, to: Town, troops: number): boolean {
  const command = { type: 'SEND', from: from.id, to: to.id, troops };
  if (applyCommand(turn.state, turn.lord.id, command, turn.now, turn.events)) return false;
  turn.busy.add(from.id);
  turn.targeted.add(to.id);
  return true;
}

function spare(turn: Turn, town: Town): number {
  return Math.floor(town.garrison * (1 - turn.p.keepHome));
}

/** Attacks the bot may still launch; reinforcements are never limited. */
function attackSlots(turn: Turn): number {
  return turn.state.config.march.maxActivePerLord - activeAttacks(turn.state, turn.lord.id);
}

/** Unseen garrisons are guessed: neutrals at their regeneration ceiling, lords by their production. */
function knownGarrison(turn: Turn, town: Town): number {
  const { state } = turn;
  if (turn.visible.has(town.isleId)) return town.stationed.reduce((sum, s) => sum + s.troops, town.garrison);
  if (town.owner === null) return town.neutralCap;
  return townRates(state, town, turn.modsOf(town.owner)).troops * state.config.bots.guessMin;
}

function predictAttack(
  turn: Turn,
  attackers: number,
  attackMult: number,
  target: Town,
  defenders: number,
): SiegeOutcome {
  const state = turn.state;
  return resolveSiege(state.config, {
    attacker: attackers,
    attackMult,
    defenders: [{ troops: defenders, defense: turn.modsOf(target.owner).defense }],
    fort: fortification(state, target),
    walls: townWalls(state, target, turn.modsOf(target.owner)),
  });
}

function defend(turn: Turn): void {
  const { state, lord, now } = turn;
  let budget = turn.p.reinforcementsPerTurn;
  const threats = state.marches
    .filter((m) => m.owner !== lord.id && state.towns[m.to]?.owner === lord.id)
    .sort((a, b) => a.arriveAt - b.arriveAt || a.id - b.id);

  for (const threat of threats) {
    if (budget <= 0) return;
    const town = state.towns[threat.to];
    if (!town) continue;
    const arriving = state.marches
      .filter((m) => m.owner === lord.id && m.to === town.id && m.arriveAt <= threat.arriveAt)
      .reduce((sum, m) => sum + m.troops, 0);
    const enemy = turn.modsOf(threat.owner);
    const outcome = predictAttack(turn, threat.troops, enemy.attack, town, town.garrison + arriving);
    if (outcome.winner === 'DEFENDER') continue;

    let best: { from: Town; troops: number; travel: TravelInfo } | null = null;
    for (const from of townsOf(state, lord.id)) {
      if (from.id === town.id || turn.busy.has(from.id)) continue;
      if (!islesLinked(state, from.isleId, town.isleId)) continue;
      const troops = spare(turn, from);
      if (troops === 0) continue;
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
  return next.gold - current.gold + next.troops - current.troops + cfg.dominion.perTier;
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
    // The best town takes every level the spare gold pays for; with 100 levels one at a time is too slow.
    const levels = upgradePlan(
      state.config,
      best.town.tier,
      lord.gold - p.goldReserve,
      state.config.towns.maxTier,
    ).levels;
    const command = { type: 'UPGRADE', townId: best.town.id, levels };
    if (applyCommand(state, lord.id, command, turn.now, turn.events)) return;
  }
}

/** Dominion-per-minute the target would add, weighted by the personality. */
function targetValue(turn: Turn, to: Town): number {
  const { state, lord, p } = turn;
  const cfg = state.config;
  let value = cfg.dominion.perTier * to.tier * (to.owner === null ? 1 : p.lordAggression);
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
/** Lords too weak next to this one cannot be attacked (rule R17); worked out once per turn. */
function attackable(turn: Turn, ownerId: string): boolean {
  let ok = turn.attackable.get(ownerId);
  if (ok === undefined) {
    ok = xpMultiplier(turn.state, turn.lord.id, ownerId, turn.now) > 0;
    turn.attackable.set(ownerId, ok);
  }
  return ok;
}

function freeShare(turn: Turn, isleId: number): number {
  let share = turn.freeShare.get(isleId);
  if (share === undefined) {
    const open = (turn.state.isles[isleId]?.townIds ?? [])
      .map((id) => turn.state.towns[id] as Town)
      .filter((t) => t.privateTo === null && !t.isThrone);
    share = open.length > 0 ? open.filter((t) => t.owner === null).length / open.length : 0;
    turn.freeShare.set(isleId, share);
  }
  return share;
}

/** Personalities set how soon bots reach across the lanes: raiders at once, wardens only when home is spent. */
function crossFactor(turn: Turn, from: Town, to: Town): number {
  if (to.isleId === from.isleId) return 1;
  return freeShare(turn, from.isleId) <= turn.p.crossFreeShare ? turn.p.crossWeight : 0;
}

function targetsNear(turn: Turn, from: Town): Town[] {
  const { state, lord } = turn;
  const capitalImmune = state.config.rules.capitalImmune;
  const limit = state.config.bots.targetsPerTown;
  const accept = (to: Town): boolean =>
    to.owner !== lord.id &&
    seenBy(lord.id, to) &&
    !(to.isThrone && !state.throneUnsealed) &&
    !(to.isCapital && capitalImmune) &&
    (to.owner === null || attackable(turn, to.owner));
  const across = (isleNeighbors(state)[from.isleId] ?? []).flatMap((isleId) =>
    nearest(state, from, [isleId], Math.ceil(limit / 4), accept),
  );
  return [...nearest(state, from, [from.isleId], limit, accept), ...across];
}

function attack(turn: Turn): void {
  const { state, lord, p, now } = turn;
  let slots = Math.min(p.attacksPerTurn, attackSlots(turn));
  if (slots <= 0) return;
  const options: { from: Town; to: Town; troops: number; score: number }[] = [];
  const cfgSlack = state.config.bots.crossSlack;

  const sources = townsOf(state, lord.id)
    .filter((from) => !turn.busy.has(from.id))
    .map((from) => ({ from, troops: spare(turn, from) }))
    .filter((x) => x.troops >= p.minAttackTroops)
    .sort((a, b) => b.troops - a.troops || a.from.id - b.from.id)
    .slice(0, slots * SOURCES_PER_ATTACK);
  for (const { from, troops } of sources) {
    for (const to of targetsNear(turn, from)) {
      if (turn.targeted.has(to.id)) continue;
      const value = targetValue(turn, to) * crossFactor(turn, from, to);
      if (value <= 0) continue;
      const outcome = predictAttack(turn, troops, turn.mods.attack, to, knownGarrison(turn, to));
      const needed = outcome.defenderPower * p.attackMargin;
      if (outcome.attackerPower < needed) continue;
      // Bigger marches fly slower: sent whole, a garrison takes a third of the season to cross.
      const sent =
        to.isleId === from.isleId
          ? troops
          : Math.min(
              troops,
              Math.max(p.minAttackTroops, Math.ceil((troops * needed * cfgSlack) / outcome.attackerPower)),
            );
      const travel = travelInfo(state, lord.id, from, to, sent, now, turn.mods);
      if (travel.sky && travel.windFactor < p.minWindFactor) continue;
      options.push({ from, to, troops: sent, score: value / travel.durationMs });
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

/** Towns holding a good stock push their spare troops to the most exposed of their nearest own towns. */
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
    if (turn.busy.has(from.id)) continue;
    const stock = townRates(state, from, turn.mods).troops * state.config.bots.hoardMin;
    if (from.garrison < stock) continue;
    const reach = [from.isleId, ...(isleNeighbors(state)[from.isleId] ?? [])];
    const near = nearest(state, from, reach, state.config.bots.targetsPerTown, (t) => t.owner === lord.id);
    let best: Town | null = null;
    for (const t of near) {
      if (scoreOf(t) <= scoreOf(from)) continue;
      if (!best || scoreOf(t) > scoreOf(best)) best = t;
    }
    if (!best) continue;
    const troops = spare(turn, from);
    if (troops >= p.minAttackTroops) send(turn, from, best, troops);
  }
}
