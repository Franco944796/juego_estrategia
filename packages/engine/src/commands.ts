import { SKILL_IDS } from '@si/config/constants';
import { accrueTo, projectedGarrison, projectedGold, upgradeCost, upgradePlan } from './economy';
import { equipItem } from './gear';
import { activeAttacks, isAttack, launchGroup, launchMarch } from './marches';
import { learnSkill, unspentPoints } from './skills';
import type { Command, DomainEvent, GameState, RuleError, RuleId, Town } from './types';
import { getLord, getTown, islesLinked } from './world';

function fail(rule: RuleId, code: string, message: string): RuleError {
  return { rule, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTownId(state: GameState, value: unknown): value is number {
  return typeof value === 'number' && getTown(state, value) !== undefined;
}

/** R14: known command type, existing ids, known skills and a numeric troop count. */
function parseCommand(state: GameState, input: unknown): Command | null {
  if (!isRecord(input)) return null;
  switch (input.type) {
    case 'UPGRADE': {
      const levels = input.levels ?? 1;
      return isTownId(state, input.townId) &&
        Number.isInteger(levels) &&
        typeof levels === 'number' &&
        levels >= 1
        ? { type: 'UPGRADE', townId: input.townId, levels }
        : null;
    }
    case 'SEND': {
      const { from, to, troops } = input;
      return isTownId(state, from) && isTownId(state, to) && typeof troops === 'number'
        ? { type: 'SEND', from, to, troops }
        : null;
    }
    case 'SEND_GROUP': {
      const { from, to } = input;
      if (!Array.isArray(from) || from.length === 0 || !isTownId(state, to)) return null;
      const ids: number[] = [];
      for (const id of from as unknown[]) {
        if (!isTownId(state, id) || ids.includes(id)) return null;
        ids.push(id);
      }
      return { type: 'SEND_GROUP', from: ids, to };
    }
    case 'LEARN_SKILL': {
      const skill = SKILL_IDS.find((id) => id === input.skill);
      return skill ? { type: 'LEARN_SKILL', skill } : null;
    }
    case 'EQUIP':
      return typeof input.itemId === 'string' ? { type: 'EQUIP', itemId: input.itemId } : null;
    default:
      return null;
  }
}

export type Validation = { ok: true; command: Command } | { ok: false; error: RuleError };

/** Checks every rule against values projected to `now`; it never mutates the state. */
export function validateCommand(state: GameState, lordId: string, input: unknown, now: number): Validation {
  const command = parseCommand(state, input);
  if (!command) return { ok: false, error: fail('R14', 'BAD_COMMAND', 'malformed command') };
  const error = checkRules(state, lordId, command, now);
  return error ? { ok: false, error } : { ok: true, command };
}

function checkRules(state: GameState, lordId: string, command: Command, now: number): RuleError | null {
  const cfg = state.config;
  const lord = getLord(state, lordId);
  if (!lord || !lord.alive) return fail('R01', 'NO_LORD', 'unknown or eliminated lord');
  if (state.status !== 'RUNNING' || now < state.startsAt || now >= state.endsAt) {
    return fail('R02', 'SEASON_CLOSED', 'the season is not running');
  }

  switch (command.type) {
    case 'UPGRADE': {
      const town = state.towns[command.townId];
      if (!town || town.owner !== lordId) return fail('R03', 'NOT_OWNER', 'town not owned');
      const cost = upgradeCost(state, town);
      if (cost === null) return fail('R04', 'MAX_TIER', 'town already at the maximum level');
      if (projectedGold(state, lordId, now) < cost) return fail('R05', 'NO_GOLD', 'not enough gold');
      return null;
    }
    case 'SEND': {
      const from = state.towns[command.from];
      const to = state.towns[command.to];
      const stationed = from?.stationed.find((s) => s.lordId === lordId);
      if (!from || !to || (from.owner !== lordId && !stationed)) {
        return fail('R03', 'NOT_OWNER', 'no troops of yours in the source town');
      }
      if (!Number.isInteger(command.troops) || command.troops < cfg.march.minTroops) {
        return fail('R07', 'BAD_TROOPS', 'the troop count must be whole and enough');
      }
      const available =
        from.owner === lordId ? projectedGarrison(state, from, now) : (stationed?.troops ?? 0);
      if (command.troops > available) {
        return fail('R08', 'NOT_ENOUGH_TROOPS', 'not enough troops in the town');
      }
      return targetRules(state, lordId, [from], to);
    }
    case 'SEND_GROUP': {
      const to = state.towns[command.to];
      const sources = command.from.map((id) => state.towns[id]);
      if (!to || sources.some((from) => from?.owner !== lordId)) {
        return fail('R03', 'NOT_OWNER', 'every source must be a town of yours');
      }
      const towns = sources as Town[];
      if (towns.some((from) => projectedGarrison(state, from, now) < cfg.march.minTroops)) {
        return fail('R08', 'NOT_ENOUGH_TROOPS', 'a source town has no troops to send');
      }
      return targetRules(state, lordId, towns, to);
    }
    case 'LEARN_SKILL':
      if (unspentPoints(lord) <= 0) return fail('R13', 'NO_SKILL_POINTS', 'no skill points left');
      return null;
    case 'EQUIP':
      if (!lord.items.some((item) => item.id === command.itemId)) {
        return fail('R16', 'NO_ITEM', 'the lord does not own that item');
      }
      return null;
  }
}

/** Rules about where marches from `sources` may go; only attacks count against the march limit. */
function targetRules(state: GameState, lordId: string, sources: Town[], to: Town): RuleError | null {
  const cfg = state.config;
  if (to.privateTo !== null && to.privateTo !== lordId) {
    return fail('R14', 'UNKNOWN_TOWN', 'that town is not visible to this lord');
  }
  for (const from of sources) {
    if (from.id === to.id) return fail('R09', 'SAME_TOWN', 'target is the source');
    if (!islesLinked(state, from.isleId, to.isleId)) {
      return fail('R10', 'UNREACHABLE', 'target isle has no lane to the source isle');
    }
  }
  if (to.isThrone && !state.throneUnsealed) return fail('R11', 'THRONE_SEALED', 'the Throne is sealed');
  if (!isAttack(state, lordId, to)) return null;
  if (cfg.rules.capitalImmune && to.isCapital) {
    return fail('R15', 'CAPITAL_IMMUNE', 'capitals cannot be attacked');
  }
  if (activeAttacks(state, lordId) >= cfg.march.maxActivePerLord) {
    return fail('R12', 'TOO_MANY_MARCHES', 'too many attacks in flight');
  }
  return null;
}

/** Validates, then settles production up to `now` and applies. Returns the broken rule, if any. */
export function applyCommand(
  state: GameState,
  lordId: string,
  input: unknown,
  now: number,
  events: DomainEvent[],
): RuleError | null {
  const validation = validateCommand(state, lordId, input, now);
  if (!validation.ok) return validation.error;
  const command = validation.command;
  accrueTo(state, now);
  const lord = state.lords[lordId];
  if (!lord) return null;

  switch (command.type) {
    case 'UPGRADE': {
      const town = state.towns[command.townId];
      if (!town) return null;
      const plan = upgradePlan(state.config, town.tier, lord.gold, command.levels ?? 1);
      if (plan.levels === 0) return null;
      lord.gold -= plan.cost;
      town.tier += plan.levels;
      events.push({
        type: 'TOWN_UPGRADED',
        at: now,
        lordId,
        townId: town.id,
        tier: town.tier,
        cost: plan.cost,
      });
      return null;
    }
    case 'SEND': {
      const from = state.towns[command.from];
      const to = state.towns[command.to];
      if (from && to) launchMarch(state, lordId, from, to, command.troops, now, events);
      return null;
    }
    case 'SEND_GROUP': {
      const to = state.towns[command.to];
      const sources = command.from.flatMap((id) => (state.towns[id] ? [state.towns[id] as Town] : []));
      if (to) launchGroup(state, lordId, sources, to, now, events);
      return null;
    }
    case 'LEARN_SKILL':
      learnSkill(lord, command.skill, now, events);
      return null;
    case 'EQUIP': {
      const item = lord.items.find((owned) => owned.id === command.itemId);
      if (item) equipItem(lord, item, now, events);
      return null;
    }
  }
}
