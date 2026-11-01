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
import { distance } from '../src/geometry';
import type { DomainEvent, Town } from '../src/types';
import { recomputeZone } from '../src/world';
import { capitalOf, game, give, lord, MIN, neutralsBeside, T0, troops } from './helpers';

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
  it('lights a zone beacon for a lord owning every town of the zone', () => {
    const state = game();
    const zone = state.zones[0];
    if (!zone) throw new Error('no zone');
    const towns = zone.townIds.map((id) => state.towns[id] as Town);
    const events: DomainEvent[] = [];
    for (const town of towns) give(state, town, 'h1', town.garrison);
    recomputeZone(state, zone.id, T0, events);
    expect(events).toEqual([{ type: 'BEACON_CHANGED', at: T0, zoneId: zone.id, owner: 'h1' }]);
    const first = towns[0] as Town;
    const plain = (state.config.towns.goldPerMin[first.tier - 1] ?? 0) * lordMods(state, 'h1').sprawl;
    expect(townRates(state, first).gold).toBeCloseTo(plain * 1.25, 12);
    expect(townRates(state, capitalOf(state, 'h1')).gold).toBeCloseTo(
      3.5 * 1.5 * lordMods(state, 'h1').sprawl,
      12,
    );
    const perTier = [capitalOf(state, 'h1'), ...towns].reduce(
      (sum, t) => sum + (state.config.dominion.perTier[t.tier - 1] ?? 0),
      0,
    );
    expect(dominionRates(state).get('h1')).toBeCloseTo(perTier + 3, 12);
    recomputeZone(state, zone.id, T0, events);
    recomputeZone(state, null, T0, events);
    expect(events).toHaveLength(1);
    give(state, first, 'h2', first.garrison);
    recomputeZone(state, zone.id, T0, events);
    expect(events.at(-1)).toEqual({ type: 'BEACON_CHANGED', at: T0, zoneId: zone.id, owner: null });
  });

  it('pays Throne dominion to its holder', () => {
    const state = game({ config: { throne: { enabled: true } } });
    expect(game().throneTownId).toBeNull();
    const throne = state.towns[state.throneTownId ?? -1];
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
    expect(fortification(state, capital)).toBeCloseTo(1.25 * 1.75, 12);
    lord(state, 'h1').edicts = ['BULWARKS'];
    expect(fortification(state, capital)).toBeCloseTo(1.25 * 1.75 * 1.1, 12);
    const crowned = game({ config: { throne: { enabled: true } } });
    const throne = crowned.towns[crowned.throneTownId ?? -1];
    if (!throne) throw new Error('no throne');
    expect(fortification(crowned, throne)).toBeCloseTo(2, 12);
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

describe('snowball brakes', () => {
  it('fortifies the towns near the capital', () => {
    const state = game({ config: { towns: { homeFort: 3 } } });
    const capital = capitalOf(state, 'h1');
    const near = (t: Town): number => distance(t.pos, capital.pos);
    const radius = state.config.towns.homeRadius;
    const home = neutralsBeside(state, capital).find((t) => near(t) <= radius);
    const away = neutralsBeside(state, capital).find((t) => near(t) > radius);
    if (!home || !away) throw new Error('no neutral');
    const neutralFort = fortification(state, home);
    give(state, home, 'h1', troops(1));
    expect(fortification(state, home)).toBeCloseTo(neutralFort * 3, 12);
    expect(fortification(state, capital)).toBeCloseTo(1.25 * 1.75, 12);
    give(state, home, 'h2', troops(1));
    expect(fortification(state, home)).toBeCloseTo(neutralFort, 12);
    const awayFort = fortification(state, away);
    give(state, away, 'h1', troops(1));
    expect(fortification(state, away)).toBeCloseTo(awayFort, 12);
  });

  it('slows the production of lords with many towns', () => {
    const state = game({ config: { towns: { sprawl: { freeTowns: 2, penaltyPerTown: 0.1 } } } });
    const capital = capitalOf(state, 'h1');
    const base = townRates(state, capital).gold;
    const extra = state.towns.filter((t) => t.owner === null && !t.isThrone).slice(0, 4);
    for (const town of extra) give(state, town, 'h1', troops(1));
    expect(lordMods(state, 'h1').sprawl).toBeCloseTo(1 / (1 + 3 * 0.1), 12);
    expect(townRates(state, capital).gold).toBeCloseTo(base / 1.3, 12);
    expect(lordMods(state, 'h2').sprawl).toBe(1);
  });
});
