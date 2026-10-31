import { EDICT_IDS, TROOP_TYPES } from '@si/config/constants';
import { accrueTo, projectedGarrison, projectedGold, respecCost, upgradeCost } from './economy';
import { launchMarch } from './marches';
import { fitsIn, totalTroops } from './troops';
import type { Command, DomainEvent, GameState, RuleError, RuleId, Troops } from './types';
import { chooseEdict, getLord, getTown, islesLinked } from './world';

function fail(rule: RuleId, code: string, message: string): RuleError {
  return { rule, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasNumericTroops(value: unknown): value is Troops {
  return isRecord(value) && TROOP_TYPES.every((type) => typeof value[type] === 'number');
}

function isTownId(state: GameState, value: unknown): value is number {
  return typeof value === 'number' && getTown(state, value) !== undefined;
}

/** R14: known command type, existing ids, known enums and numeric troop fields. */
function parseCommand(state: GameState, input: unknown): Command | null {
  if (!isRecord(input)) return null;
  switch (input.type) {
    case 'UPGRADE':
      return isTownId(state, input.townId) ? { type: 'UPGRADE', townId: input.townId } : null;
    case 'RESPECIALIZE': {
      const spec = TROOP_TYPES.find((type) => type === input.spec);
      return isTownId(state, input.townId) && spec
        ? { type: 'RESPECIALIZE', townId: input.townId, spec }
        : null;
    }
    case 'SEND': {
      const { from, to, troops } = input;
      return isTownId(state, from) && isTownId(state, to) && hasNumericTroops(troops)
        ? {
            type: 'SEND',
            from,
            to,
            troops: { LANCER: troops.LANCER, ARCHER: troops.ARCHER, GRIFFIN: troops.GRIFFIN },
          }
        : null;
    }
    case 'CHOOSE_EDICT': {
      const edict = EDICT_IDS.find((id) => id === input.edict);
      return edict ? { type: 'CHOOSE_EDICT', edict } : null;
    }
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
      if (cost === null) return fail('R04', 'MAX_TIER', 'town already at the maximum tier');
      if (projectedGold(state, lordId, now) < cost) return fail('R05', 'NO_GOLD', 'not enough gold');
      return null;
    }
    case 'RESPECIALIZE': {
      const town = state.towns[command.townId];
      if (!town || town.owner !== lordId) return fail('R03', 'NOT_OWNER', 'town not owned');
      if (town.spec === command.spec) return fail('R06', 'SAME_SPEC', 'already trains that type');
      if (projectedGold(state, lordId, now) < respecCost(state, town)) {
        return fail('R05', 'NO_GOLD', 'not enough gold');
      }
      return null;
    }
    case 'SEND': {
      const from = state.towns[command.from];
      const to = state.towns[command.to];
      if (!from || !to || from.owner !== lordId) return fail('R03', 'NOT_OWNER', 'source not owned');
      const amounts = TROOP_TYPES.map((type) => command.troops[type]);
      if (
        amounts.some((n) => !Number.isInteger(n) || n < 0) ||
        totalTroops(command.troops) < cfg.march.minTroops
      ) {
        return fail('R07', 'BAD_TROOPS', 'troop amounts must be whole, non-negative and enough');
      }
      if (!fitsIn(command.troops, projectedGarrison(state, from, now))) {
        return fail('R08', 'NOT_ENOUGH_TROOPS', 'not enough troops in the town');
      }
      if (from.id === to.id) return fail('R09', 'SAME_TOWN', 'target is the source');
      if (!islesLinked(state, from.isleId, to.isleId)) {
        return fail('R10', 'UNREACHABLE', 'target isle has no lane to the source isle');
      }
      if (to.isThrone && !state.throneUnsealed) return fail('R11', 'THRONE_SEALED', 'the Throne is sealed');
      const active = state.marches.filter((m) => m.owner === lordId).length;
      if (active >= cfg.march.maxActivePerLord) {
        return fail('R12', 'TOO_MANY_MARCHES', 'too many marches in flight');
      }
      return null;
    }
    case 'CHOOSE_EDICT':
      if (!lord.draft || !lord.draft.includes(command.edict)) {
        return fail('R13', 'NO_DRAFT', 'that edict is not offered');
      }
      return null;
  }
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
      const cost = town ? upgradeCost(state, town) : null;
      if (!town || cost === null) return null;
      lord.gold -= cost;
      town.tier += 1;
      events.push({ type: 'TOWN_UPGRADED', at: now, lordId, townId: town.id, tier: town.tier, cost });
      return null;
    }
    case 'RESPECIALIZE': {
      const town = state.towns[command.townId];
      if (!town) return null;
      const cost = respecCost(state, town);
      lord.gold -= cost;
      town.spec = command.spec;
      town.carry = 0;
      events.push({ type: 'TOWN_RESPECIALIZED', at: now, lordId, townId: town.id, spec: town.spec, cost });
      return null;
    }
    case 'SEND': {
      const from = state.towns[command.from];
      const to = state.towns[command.to];
      if (from && to) launchMarch(state, lordId, from, to, command.troops, now, events);
      return null;
    }
    case 'CHOOSE_EDICT':
      chooseEdict(state, lord, command.edict, now, events);
      return null;
  }
}
