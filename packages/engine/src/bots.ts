import type { PersonalityConfig } from '@si/config';
import { applyCommand } from './commands';
import { resolveBattle, type BattleOutcome } from './combat';
import { fortification, townRates, upgradeCost } from './economy';
import { travelInfo, type TravelInfo } from './marches';
import { lordMods, neutralMods, type LordMods } from './modifiers';
import { addTroops, scaleTroops, splitGarrison, totalTroops, zeroTroops } from './troops';
import type { DomainEvent, GameState, Lord, Town, Troops } from './types';
import { visibleIsles } from './vision';
import { islesLinked, reachableTowns, townsOf } from './world';

interface Turn {
  state: GameState;
  lord: Lord;
  p: PersonalityConfig;
  mods: LordMods;
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
  const turn: Turn = {
    state,
    lord,
    p: state.config.bots.personalities[lord.personality],
    mods: lordMods(state, lordId),
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
  if (turn.visible.has(town.isleId)) return town.garrison;
  const size = town.owner === null ? town.neutralCap : (cfg.towns.garrisonCap[town.tier - 1] ?? 0);
  return splitGarrison(size, town.spec, cfg.neutral.mainShare);
}

function predictAttack(turn: Turn, attackers: Troops, target: Town, defenders: Troops): BattleOutcome {
  const state = turn.state;
  const defense = target.owner === null ? neutralMods() : lordMods(state, target.owner);
  return resolveBattle(state.config, {
    attacker: attackers,
    defender: defenders,
    attackMults: turn.mods.attack,
    defenseMults: defense.defense,
    fort: fortification(state, target),
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
    const enemy = lordMods(state, threat.owner);
    const outcome = resolveBattle(state.config, {
      attacker: threat.troops,
      defender: addTroops(town.garrison, arriving),
      attackMults: enemy.attack,
      defenseMults: turn.mods.defense,
      fort: fortification(state, town),
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
      const travel = travelInfo(state, lord.id, from, town, troops, now);
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
  const isle = state.isles[to.isleId];
  const completesIsle =
    isle?.hasBeacon === true &&
    isle.townIds.every((id) => id === to.id || state.towns[id]?.owner === lord.id);
  if (completesIsle) value += cfg.beacon.dominionPerMin;
  if (to.isThrone) value += cfg.throne.dominionPerMin * p.throneDesire;
  return value;
}

function attack(turn: Turn): void {
  const { state, lord, p, now } = turn;
  let slots = Math.min(p.attacksPerTurn, marchSlots(turn));
  if (slots <= 0) return;
  const options: { from: Town; to: Town; troops: Troops; score: number }[] = [];

  for (const from of townsOf(state, lord.id)) {
    if (turn.busy.has(from.id)) continue;
    const troops = spare(turn, from);
    if (totalTroops(troops) < p.minAttackTroops) continue;
    for (const to of reachableTowns(state, from)) {
      if (to.owner === lord.id || turn.targeted.has(to.id)) continue;
      if (to.isThrone && !state.throneUnsealed) continue;
      const value = targetValue(turn, to);
      if (value <= 0) continue;
      const outcome = predictAttack(turn, troops, to, knownGarrison(turn, to));
      if (outcome.attackerPower < outcome.defenderPower * p.attackMargin) continue;
      const travel = travelInfo(state, lord.id, from, to, troops, now);
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

/** How exposed a town is: foreign towns in reach, plus the Throne for lords who want it. */
function frontierScore(turn: Turn, town: Town): number {
  const { state, lord, p } = turn;
  let score = reachableTowns(state, town).filter((t) => t.owner !== lord.id).length;
  const throneIsle = state.towns[state.throneTownId]?.isleId;
  if (state.throneUnsealed && throneIsle !== undefined && islesLinked(state, town.isleId, throneIsle)) {
    score += p.throneDesire;
  }
  return score;
}

/** Towns stuck at their cap push their spare troops one lane toward the frontier. */
function consolidate(turn: Turn): void {
  const { state, lord, p } = turn;
  const mine = townsOf(state, lord.id);
  if (mine.length < 2) return;
  const scores = new Map(mine.map((t) => [t.id, frontierScore(turn, t)]));
  const scoreOf = (t: Town): number => scores.get(t.id) ?? 0;

  for (const from of mine) {
    if (marchSlots(turn) <= 0) return;
    if (turn.busy.has(from.id)) continue;
    const cap = state.config.towns.garrisonCap[from.tier - 1] ?? 0;
    if (totalTroops(from.garrison) < cap) continue;
    let best: Town | null = null;
    for (const t of mine) {
      if (t.id === from.id || !islesLinked(state, from.isleId, t.isleId)) continue;
      if (scoreOf(t) <= scoreOf(from)) continue;
      if (!best || scoreOf(t) > scoreOf(best)) best = t;
    }
    if (!best) continue;
    const troops = spare(turn, from);
    if (totalTroops(troops) >= p.minAttackTroops) send(turn, from, best, troops);
  }
}
