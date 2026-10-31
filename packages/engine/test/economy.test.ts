import { describe, expect, it } from 'vitest';
import {
  accrueTo,
  dominionRates,
  fortification,
  goldRate,
  growGarrison,
  projectedDominion,
  projectedGarrison,
  projectedGold,
  respecCost,
  townRates,
  upgradeCost,
} from '../src/economy';
import { lordMods } from '../src/modifiers';
import { totalTroops } from '../src/troops';
import type { DomainEvent } from '../src/types';
import { recomputeBeacon } from '../src/world';
import { capitalOf, game, give, lord, MIN, neutralsBeside, T0, townsOnIsle, troops } from './helpers';

describe('production', () => {
  it('pays gold and trains the specialization of an owned town', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    // Capital tier 2: 3.5 gold and 1.8 lancers per minute, ×1.5 for the capital.
    expect(townRates(state, capital).gold).toBeCloseTo(5.25, 12);
    expect(townRates(state, capital).troops).toBeCloseTo(2.7, 12);
    accrueTo(state, T0 + 7 * MIN);
    expect(lord(state, 'h1').gold).toBeCloseTo(120 + 5.25 * 7, 9);
    expect(capital.garrison).toEqual(troops(18 + 18, 14, 8));
    expect(capital.carry).toBeCloseTo(0.9, 9);
  });

  it('stops at the cap and resets the carry there', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    capital.garrison = troops(79);
    accrueTo(state, T0 + 10 * MIN);
    expect(totalTroops(capital.garrison)).toBe(80);
    expect(capital.carry).toBe(0);
    capital.garrison = troops(100);
    accrueTo(state, T0 + 20 * MIN);
    expect(capital.garrison).toEqual(troops(100));
  });

  it('keeps the carry when nothing is produced', () => {
    expect(growGarrison(troops(1), 0.4, 'LANCER', 0, 5, 10)).toEqual({ garrison: troops(1), carry: 0.4 });
    expect(growGarrison(troops(1), 0.4, 'LANCER', 0.1, 1, 10)).toEqual({ garrison: troops(1), carry: 0.5 });
  });

  it('regenerates neutral towns slowly up to their starting size', () => {
    const state = game();
    const neutral = neutralsBeside(state, capitalOf(state, 'h1'))[0];
    if (!neutral) throw new Error('no neutral');
    const cap = neutral.neutralCap;
    neutral.garrison = troops(0);
    const rate = 1.2 * state.config.troops[neutral.spec].prodMult * 0.3;
    expect(townRates(state, neutral).troops).toBeCloseTo(rate, 12);
    expect(townRates(state, neutral).gold).toBe(0);
    accrueTo(state, T0 + 10 * MIN);
    expect(totalTroops(neutral.garrison)).toBe(Math.floor(rate * 10));
    accrueTo(state, T0 + 1000 * MIN);
    expect(totalTroops(neutral.garrison)).toBe(cap);
    neutral.neutralCap = 0;
    expect(townRates(state, neutral).troops).toBe(0);
  });

  it('never accrues past the season end', () => {
    const state = game();
    accrueTo(state, state.endsAt + 100 * MIN);
    expect(state.accruedAt).toBe(state.endsAt);
    const gold = lord(state, 'h1').gold;
    accrueTo(state, state.endsAt + 200 * MIN);
    expect(lord(state, 'h1').gold).toBe(gold);
  });

  it('projects exactly what accrual will settle', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const t = T0 + 13.37 * MIN;
    const gold = projectedGold(state, 'h1', t);
    const dominion = projectedDominion(state, 'h1', t);
    const garrison = projectedGarrison(state, capital, t);
    expect(projectedGold(state, 'h1', T0)).toBe(lord(state, 'h1').gold);
    expect(projectedDominion(state, 'h1', T0)).toBe(0);
    expect(projectedGarrison(state, capital, T0)).toBe(capital.garrison);
    accrueTo(state, t);
    expect(lord(state, 'h1').gold).toBe(gold);
    expect(lord(state, 'h1').dominion).toBe(dominion);
    expect(capital.garrison).toEqual(garrison);
    expect(projectedGold(state, 'nobody', t)).toBe(0);
    expect(projectedDominion(state, 'nobody', t)).toBe(0);
  });
});

describe('beacons, Throne and dominion', () => {
  it('lights a beacon for a lord owning the whole isle', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const events: DomainEvent[] = [];
    for (const town of townsOnIsle(state, capital.isleId)) give(state, town, 'h1', town.garrison);
    recomputeBeacon(state, capital.isleId, T0, events);
    expect(events).toEqual([{ type: 'BEACON_CHANGED', at: T0, isleId: capital.isleId, owner: 'h1' }]);
    expect(townRates(state, capital).gold).toBeCloseTo(3.5 * 1.5 * 1.25, 12);
    const isleTowns = townsOnIsle(state, capital.isleId);
    const perTier = isleTowns.reduce((sum, t) => sum + (state.config.dominion.perTier[t.tier - 1] ?? 0), 0);
    expect(dominionRates(state).get('h1')).toBeCloseTo(perTier + 3, 12);
    recomputeBeacon(state, capital.isleId, T0, events);
    expect(events).toHaveLength(1);
  });

  it('pays Throne dominion to its holder', () => {
    const state = game();
    const throne = state.towns[state.throneTownId];
    if (!throne) throw new Error('no throne');
    give(state, throne, 'h1', troops(1));
    expect(dominionRates(state).get('h1')).toBeCloseTo(2 + 6 + 25, 12);
    accrueTo(state, T0 + 10 * MIN);
    expect(lord(state, 'h1').dominion).toBeCloseTo(330, 9);
  });

  it('applies the Legend and Golden Tide edicts', () => {
    const state = game();
    lord(state, 'h1').edicts = ['LEGEND', 'GOLDEN_TIDE'];
    expect(dominionRates(state).get('h1')).toBeCloseTo(2 * 1.15, 12);
    expect(goldRate(state, 'h1')).toBeCloseTo(5.25 * 1.2, 12);
  });
});

describe('costs and fortification', () => {
  it('prices upgrades per tier, with Architects, and stops at the top tier', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    expect(upgradeCost(state, capital)).toBe(240);
    lord(state, 'h1').edicts = ['ARCHITECTS'];
    expect(upgradeCost(state, capital)).toBeCloseTo(192, 12);
    capital.tier = 5;
    expect(upgradeCost(state, capital)).toBeNull();
    expect(respecCost(state, capital)).toBe(200);
  });

  it('stacks tier, capital, Throne and Bulwarks', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    expect(fortification(state, capital)).toBeCloseTo(1.15 * 1.25, 12);
    lord(state, 'h1').edicts = ['BULWARKS'];
    expect(fortification(state, capital)).toBeCloseTo(1.15 * 1.25 * 1.1, 12);
    const throne = state.towns[state.throneTownId];
    if (!throne) throw new Error('no throne');
    expect(fortification(state, throne)).toBeCloseTo(1.6 * 1.5, 12);
  });

  it('combines every edict effect', () => {
    const state = game();
    lord(state, 'h1').edicts = [
      'SWIFT_WINGS',
      'SPEAR_WALL',
      'ARROW_STORM',
      'MUSTER',
      'WIND_READERS',
      'PLUNDERERS',
      'VETERANS',
    ];
    const mods = lordMods(state, 'h1');
    expect(mods.speed.GRIFFIN).toBeCloseTo(1.2, 12);
    expect(mods.defense.LANCER).toBeCloseTo(1.25, 12);
    expect(mods.attack.ARCHER).toBeCloseTo(1.25, 12);
    expect(mods.troopProd).toBeCloseTo(1.15, 12);
    expect(mods.headwindMin).toBe(0.75);
    expect(mods.plunder).toBe(2);
    expect(mods.winnerLosses).toBeCloseTo(0.8, 12);
    expect(lordMods(state, 'nobody').goldProd).toBe(1);
    expect(lordMods(state, null).fort).toBe(1);
  });
});
