import { describe, expect, it } from 'vitest';
import { advanceTo, execute } from '../src/game';
import { activeAttacks, travelInfo } from '../src/marches';
import { previewGroup } from '../src/preview';
import { view } from '../src/view';
import type { DomainEvent, GameState, Town } from '../src/types';
import {
  capitalOf,
  game,
  give,
  MIN,
  neutralsBeside,
  NO_PRODUCTION,
  NO_RECOVERY,
  OPEN_CAPITALS,
  T0,
  townOutOfReach,
} from './helpers';

const QUIET = { ...NO_PRODUCTION, ...NO_RECOVERY };

/** h1 holds its capital plus three more towns with troops; returns them and a neutral target. */
function setup(config = QUIET) {
  const state = game({ config });
  const capital = capitalOf(state, 'h1');
  const [a, b, c, target] = neutralsBeside(state, capital);
  if (!a || !b || !c || !target) throw new Error('need four neutrals');
  give(state, a, 'h1', 5);
  give(state, b, 'h1', 300);
  give(state, c, 'h1', 0);
  return { state, capital, a, b, c, target };
}

function group(state: GameState, from: Town[], to: Town, at = T0) {
  return execute(state, 'h1', { type: 'SEND_GROUP', from: from.map((t) => t.id), to: to.id }, at);
}

describe('synchronized groups', () => {
  it('sends every troop of each source at once and lands them together as one army', () => {
    const { state, capital, a, b, target } = setup();
    target.garrison = 50;
    const slowest = Math.max(
      ...[capital, a, b].map((t) => travelInfo(state, 'h1', t, target, t.garrison, T0).durationMs),
    );
    const result = group(state, [capital, a, b], target);
    expect(result.ok).toBe(true);
    const launched = result.events.flatMap((e) => (e.type === 'MARCH_LAUNCHED' ? [e.march] : []));
    expect(launched.map((m) => m.troops)).toEqual([40, 5, 300]);
    expect(new Set(launched.map((m) => m.arriveAt))).toEqual(new Set([T0 + slowest]));
    expect(new Set(launched.map((m) => m.groupId))).toEqual(new Set([launched[0]?.id]));
    expect([capital, a, b].map((t) => t.garrison)).toEqual([0, 0, 0]);
    expect(activeAttacks(state, 'h1')).toBe(1);

    const events = advanceTo(state, T0 + slowest);
    const battles = events.flatMap((e) => (e.type === 'BATTLE' ? [e.report] : []));
    expect(battles).toHaveLength(1);
    expect(battles[0]).toMatchObject({ attackerTroops: 345, captured: true });
    expect(target.owner).toBe('h1');
    expect(state.marches).toEqual([]);
  });

  it('reinforces an own town with the whole group in one go', () => {
    const { state, a, b, c } = setup();
    const result = group(state, [a, b], c);
    const arriveAt = result.events.find((e) => e.type === 'MARCH_LAUNCHED');
    if (!arriveAt || arriveAt.type !== 'MARCH_LAUNCHED') throw new Error('no march');
    const events = advanceTo(state, arriveAt.march.arriveAt);
    expect(events.filter((e) => e.type === 'MARCH_REINFORCED')).toHaveLength(1);
    expect(c.garrison).toBe(305);
    expect(activeAttacks(state, 'h1')).toBe(0);
  });

  it('sends every repelled leg back to its own town', () => {
    const { state, a, b } = setup({ ...QUIET, rules: { capitalImmune: true } });
    const foe = capitalOf(state, 'h2');
    // The target becomes a capital while the group is on its way.
    foe.isCapital = false;
    const result = group(state, [a, b], foe);
    expect(result.ok).toBe(true);
    foe.isCapital = true;
    const leg = result.events.find((e) => e.type === 'MARCH_LAUNCHED');
    if (!leg || leg.type !== 'MARCH_LAUNCHED') throw new Error('no march');
    const events = advanceTo(state, leg.march.arriveAt);
    expect(events.filter((e) => e.type === 'MARCH_REPELLED')).toHaveLength(1);
    expect([a.garrison, b.garrison]).toEqual([5, 300]);
  });

  it('checks every source and the target', () => {
    const { state, capital, a, b, c, target } = setup();
    const rule = (from: Town[], to: Town) => {
      const r = group(state, from, to);
      return r.ok ? null : r.error.code;
    };
    expect(rule([a, c], target)).toBe('NOT_ENOUGH_TROOPS');
    expect(rule([a, target], b)).toBe('NOT_OWNER');
    expect(rule([a, b], b)).toBe('SAME_TOWN');
    expect(rule([capital], townOutOfReach(state, capital))).toBe('UNREACHABLE');
    const bad = (from: unknown) => execute(state, 'h1', { type: 'SEND_GROUP', from, to: target.id }, T0);
    for (const from of [[], [a.id, a.id], 'all', [a.id, 99_999]]) {
      expect(bad(from)).toMatchObject({ ok: false, error: { code: 'BAD_COMMAND' } });
    }
  });
});

describe('what the target sees', () => {
  it('a band of the whole group, the same on every leg', () => {
    const { state, capital, a, b } = setup({ ...QUIET, ...OPEN_CAPITALS });
    const foe = capitalOf(state, 'h2');
    expect(group(state, [capital, a, b], foe).ok).toBe(true);
    const legs = view(state, 'h2', T0).marches.filter((m) => m.owner === 'h1');
    expect(legs).toHaveLength(3);
    expect(legs.every((m) => m.troops === null && m.troopRange?.join() === '100,1000')).toBe(true);
  });
});

describe('the attack limit', () => {
  it('counts attacks only, a group once, and always lets troops go to own towns', () => {
    const { state, capital, a, b, c } = setup({ ...QUIET, march: { maxActivePerLord: 2 } });
    const targets = neutralsBeside(state, capital).filter((t) => t.owner === null);
    const [t1, t2, t3] = targets;
    if (!t1 || !t2 || !t3) throw new Error('need targets');
    const send = (from: Town, to: Town, troops = 1): DomainEvent[] | string => {
      const r = execute(state, 'h1', { type: 'SEND', from: from.id, to: to.id, troops }, T0);
      return r.ok ? r.events : r.error.code;
    };
    expect(group(state, [a, b], t1).ok).toBe(true);
    expect(activeAttacks(state, 'h1')).toBe(1);
    expect(typeof send(capital, t2)).not.toBe('string');
    expect(send(capital, t3)).toBe('TOO_MANY_MARCHES');
    expect(typeof send(capital, c)).not.toBe('string');
    expect(typeof send(capital, c)).not.toBe('string');
    expect(activeAttacks(state, 'h1')).toBe(2);
  });
});

describe('previewGroup', () => {
  it('predicts the total, the common arrival and the battle the group will fight', () => {
    const { state, capital, a, b, target } = setup();
    const preview = previewGroup(state, 'h1', [capital.id, a.id, b.id], target.id, T0);
    expect(preview).toMatchObject({ error: null, reinforce: false, troops: 345 });
    const result = group(state, [capital, a, b], target);
    const leg = result.events.find((e) => e.type === 'MARCH_LAUNCHED');
    if (!leg || leg.type !== 'MARCH_LAUNCHED') throw new Error('no march');
    expect(preview.arriveAt).toBe(leg.march.arriveAt);
    const battle = advanceTo(state, leg.march.arriveAt).find((e) => e.type === 'BATTLE');
    if (!battle || battle.type !== 'BATTLE') throw new Error('no battle');
    expect(battle.report.attackerPower).toBe(preview.battle?.attackerPower);
    expect(battle.report.defenderPower).toBe(preview.battle?.defenderPower);
  });

  it('reports errors and handles own targets and empty lists', () => {
    const { state, a, c, target } = setup();
    expect(previewGroup(state, 'h1', [a.id], c.id, T0)).toMatchObject({ reinforce: true, battle: null });
    expect(previewGroup(state, 'h1', [c.id], target.id, T0).error?.code).toBe('NOT_ENOUGH_TROOPS');
    expect(previewGroup(state, 'h1', [], target.id, T0)).toMatchObject({ troops: 0, arriveAt: null });
    expect(previewGroup(state, 'h1', [a.id], target.id, T0 + MIN).arriveAt).toBeGreaterThan(T0 + MIN);
  });
});
