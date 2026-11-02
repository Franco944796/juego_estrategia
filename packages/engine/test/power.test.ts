import { describe, expect, it } from 'vitest';
import { townWalls } from '../src/economy';
import { advanceTo, execute } from '../src/game';
import { lordPower, xpMultiplier } from '../src/power';
import type { BattleReport, DomainEvent, GameState, Item, LordInit, Town } from '../src/types';
import { view } from '../src/view';
import {
  capitalOf,
  game,
  give,
  humans,
  lord,
  neutralsBeside,
  NO_PRODUCTION,
  NO_RECOVERY,
  T0,
} from './helpers';

/** The real power rules (the shared test config turns them off). */
const POWER = { power: { forbidBelow: 0.65, halfBelow: 0.81, doubleFrom: 2 } };

/** h1 with an extra town `t1`, h2 with an extra town `t2`; capitals keep their 40 troops. */
function setup(items: Item[] = []): { state: GameState; t1: Town; t2: Town } {
  const [h1, h2] = humans(2) as [LordInit, LordInit];
  const gear = Object.fromEntries(items.map((i) => [i.slot, i.id]));
  const state = game({
    lords: [{ ...h1, items, gear }, h2],
    config: { ...NO_PRODUCTION, ...NO_RECOVERY, ...POWER },
  });
  const [t1, t2] = neutralsBeside(state, capitalOf(state, 'h1'));
  if (!t1 || !t2) throw new Error('need two neutrals');
  // A strong h1, so h2 can be set anywhere from far weaker to far stronger.
  give(state, t1, 'h1', 1000);
  give(state, t2, 'h2', 0);
  t1.tier = 1;
  t2.tier = 1;
  return { state, t1, t2 };
}

/** Sets h2's power to `ratio` times h1's by changing the garrison of t2. */
function ratio(state: GameState, t2: Town, value: number): void {
  t2.garrison = 0;
  const base = lordPower(state, 'h2');
  t2.garrison = Math.max(0, Math.round(lordPower(state, 'h1') * value - base));
}

function battle(events: DomainEvent[]): BattleReport {
  const e = events.find((x) => x.type === 'BATTLE');
  if (!e || e.type !== 'BATTLE') throw new Error('no battle');
  return e.report;
}

describe('power', () => {
  it('adds every troop of the lord and the walls of its towns', () => {
    const { state, t1 } = setup();
    const capital = capitalOf(state, 'h1');
    const walls = townWalls(state, capital) + townWalls(state, t1);
    expect(lordPower(state, 'h1')).toBe(40 + 1000 + walls);
    expect(view(state, 'h2', T0).lords.find((l) => l.id === 'h1')?.power).toBe(40 + 1000 + walls);
  });

  it('sets the experience by the power of the lord attacked: ×2, ×1, ×0.5, or not at all', () => {
    const { state, t2 } = setup();
    const at = (value: number): number => {
      ratio(state, t2, value);
      return xpMultiplier(state, 'h1', 'h2');
    };
    expect(at(2.5)).toBe(2);
    expect(at(1.2)).toBe(1);
    expect(at(0.9)).toBe(1);
    expect(at(0.7)).toBe(0.5);
    expect(at(0.5)).toBe(0);
    expect(xpMultiplier(state, 'h1', null)).toBe(1);
  });

  it('forbids attacking a lord with 64 % or less of your power, but not a neutral town', () => {
    const { state, t1, t2 } = setup();
    ratio(state, t2, 0.5);
    const send = (to: Town) => execute(state, 'h1', { type: 'SEND', from: t1.id, to: to.id, troops: 5 }, T0);
    expect(send(t2)).toMatchObject({ ok: false, error: { rule: 'R17', code: 'TOO_WEAK' } });
    const neutral = neutralsBeside(state, t1).find((t) => t.owner === null);
    if (!neutral) throw new Error('no neutral');
    expect(send(neutral).ok).toBe(true);
  });

  it('pays double experience for kills against a much stronger lord', () => {
    const { state, t1, t2 } = setup();
    ratio(state, t2, 3);
    const sent = execute(state, 'h1', { type: 'SEND', from: t1.id, to: t2.id, troops: 1000 }, T0);
    if (!sent.ok) throw new Error(sent.error.code);
    const leg = sent.events.find((e) => e.type === 'MARCH_LAUNCHED');
    if (!leg || leg.type !== 'MARCH_LAUNCHED') throw new Error('no march');
    const report = battle(advanceTo(state, leg.march.arriveAt));
    expect(report.xpMult).toBe(2);
    expect(report.rewards.attackerXp).toBe(report.defenderLost * 5 * 2);
  });
});

describe('amulet and chest', () => {
  it('pays more gold per kill with an amulet', () => {
    const amulet: Item = { id: 'a', slot: 'AMULET', rarity: 'LEGENDARY' };
    const { state, t1, t2 } = setup([amulet]);
    ratio(state, t2, 1);
    const gold = lord(state, 'h1').gold;
    const sent = execute(state, 'h1', { type: 'SEND', from: t1.id, to: t2.id, troops: 1000 }, T0);
    if (!sent.ok) throw new Error(sent.error.code);
    const leg = sent.events.find((e) => e.type === 'MARCH_LAUNCHED');
    if (!leg || leg.type !== 'MARCH_LAUNCHED') throw new Error('no march');
    const report = battle(advanceTo(state, leg.march.arriveAt));
    expect(report.rewards.attackerGold).toBeCloseTo(report.defenderLost * 5 * 1.15, 9);
    expect(lord(state, 'h1').gold - gold).toBeCloseTo(report.rewards.attackerGold + report.plunder, 6);
  });

  it('gives back part of the gold invested in a town when it is lost, and counts it per owner', () => {
    const chest: Item = { id: 'c', slot: 'CHEST', rarity: 'LEGENDARY' };
    const [h1, h2] = humans(2) as [LordInit, LordInit];
    const state = game({
      lords: [h1, { ...h2, items: [chest], gear: { CHEST: 'c' } }],
      config: { ...NO_PRODUCTION, ...NO_RECOVERY },
    });
    const [t1, t2] = neutralsBeside(state, capitalOf(state, 'h1'));
    if (!t1 || !t2) throw new Error('need two neutrals');
    give(state, t1, 'h1', 5000);
    give(state, t2, 'h2', 0);
    t2.tier = 1;
    lord(state, 'h2').gold = 1000;
    const up = execute(state, 'h2', { type: 'UPGRADE', townId: t2.id, levels: 4 }, T0);
    if (!up.ok) throw new Error(up.error.code);
    const spent = 1000 - lord(state, 'h2').gold;
    expect(t2.invested).toBeCloseTo(spent, 9);
    const before = lord(state, 'h2').gold;
    const sent = execute(state, 'h1', { type: 'SEND', from: t1.id, to: t2.id, troops: 5000 }, T0);
    if (!sent.ok) throw new Error(sent.error.code);
    const leg = sent.events.find((e) => e.type === 'MARCH_LAUNCHED');
    if (!leg || leg.type !== 'MARCH_LAUNCHED') throw new Error('no march');
    const report = battle(advanceTo(state, leg.march.arriveAt));
    expect(report.captured).toBe(true);
    expect(report.refund).toBe(Math.floor(spent * 0.5));
    // Its walls also killed some attackers, which pays gold too.
    expect(lord(state, 'h2').gold).toBeCloseTo(before + report.refund + report.rewards.defenderGold, 6);
    expect(t2.invested).toBe(0);
  });
});
