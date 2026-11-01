import { describe, expect, it } from 'vitest';
import { goldRate } from '../src/economy';
import { advanceTo, execute } from '../src/game';
import type { DomainEvent, GameState } from '../src/types';
import { view } from '../src/view';
import { gainXp, migrateState, xpForLevel } from '../src/world';
import { capitalOf, game, give, lord, neutralsBeside, NO_PRODUCTION, T0, troops } from './helpers';

function capture(state: GameState, lordId: string, targetOwner: string | null, tier: number): DomainEvent[] {
  const capital = capitalOf(state, lordId);
  const target = neutralsBeside(state, capital)[0];
  if (!target) throw new Error('no neutral');
  give(state, target, targetOwner, troops(0));
  target.tier = tier;
  const sent = execute(
    state,
    lordId,
    { type: 'SEND', from: capital.id, to: target.id, troops: troops(5) },
    T0,
  );
  const march = sent.events.find((e) => e.type === 'MARCH_LAUNCHED');
  if (!march || march.type !== 'MARCH_LAUNCHED') throw new Error('no march');
  return advanceTo(state, march.march.arriveAt);
}

describe('lord levels', () => {
  it('earns experience by town tier when capturing a neutral town', () => {
    const state = game({ config: NO_PRODUCTION });
    const events = capture(state, 'h1', null, 1);
    expect(events.some((e) => e.type === 'TOWN_CAPTURED')).toBe(true);
    expect(lord(state, 'h1')).toMatchObject({ level: 1, xp: 10 });
  });

  it('doubles the experience for a town taken from a lord and levels up with troops for the capital', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const before = { ...capital.garrison };
    const events = capture(state, 'h1', 'h2', 2);
    const up = events.find((e) => e.type === 'LEVEL_UP');
    expect(up).toMatchObject({ type: 'LEVEL_UP', lordId: 'h1', level: 2, troops: troops(5, 5, 5) });
    expect(lord(state, 'h1')).toMatchObject({ level: 2, xp: 40 - 30 });
    expect(capital.garrison).toEqual({
      LANCER: before.LANCER - 5 + 5,
      ARCHER: before.ARCHER + 5,
      GRIFFIN: before.GRIFFIN + 5,
    });
  });

  it('climbs several levels at once, giving more troops each level, with the remainder to the capital type', () => {
    const state = game();
    const h1 = lord(state, 'h1');
    const events: DomainEvent[] = [];
    const needed = xpForLevel(state, 1) + xpForLevel(state, 2) + xpForLevel(state, 3);
    gainXp(state, h1, needed + 1, T0, events);
    expect(h1).toMatchObject({ level: 4, xp: 1 });
    const ups = events.flatMap((e) => (e.type === 'LEVEL_UP' ? [e] : []));
    expect(ups.map((e) => e.level)).toEqual([2, 3, 4]);
    expect(ups.map((e) => e.troops.LANCER + e.troops.ARCHER + e.troops.GRIFFIN)).toEqual([15, 18, 21]);
    expect(ups[2]?.troops).toEqual(troops(7, 7, 7));
    expect(ups[1]?.troops).toEqual(troops(6, 6, 6));
    expect(xpForLevel(state, 2)).toBe(Math.round(30 * 1.25));
  });

  it('adds 1% of gold production per level gained', () => {
    const state = game();
    const base = goldRate(state, 'h1');
    lord(state, 'h1').level = 3;
    expect(goldRate(state, 'h1')).toBeCloseTo(base * 1.02, 12);
  });

  it('stops at the maximum level and shows progress in the view', () => {
    const state = game({ config: { levels: { maxLevel: 3 } } });
    const h1 = lord(state, 'h1');
    gainXp(state, h1, 10_000, T0, []);
    expect(h1).toMatchObject({ level: 3, xp: 0 });
    expect(view(state, 'h1', T0).me).toMatchObject({ level: 3, xp: 0, nextLevelXp: null });
    expect(view(state, 'h2', T0).me).toMatchObject({ level: 1, xp: 0, nextLevelXp: 30 });
    expect(view(state, 'h2', T0).lords.find((l) => l.id === 'h1')?.level).toBe(3);
  });

  it('skips the troops when the lord has no capital and fills levels in old saves', () => {
    const state = game();
    const h1 = lord(state, 'h1');
    h1.capitalId = null;
    const events: DomainEvent[] = [];
    gainXp(state, h1, 30, T0, events);
    expect(events).toEqual([{ type: 'LEVEL_UP', at: T0, lordId: 'h1', level: 2, troops: troops(0) }]);
    const old = JSON.parse(JSON.stringify(state)) as GameState;
    delete (old.lords.h2 as Partial<typeof h1>).level;
    delete (old.lords.h2 as Partial<typeof h1>).xp;
    expect(migrateState(old).lords.h2).toMatchObject({ level: 1, xp: 0 });
  });
});
