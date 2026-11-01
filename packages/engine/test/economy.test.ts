import { describe, expect, it } from 'vitest';
import {
  accrueTo,
  dominionRates,
  fortification,
  goldRate,
  growGarrison,
  levelScale,
  plunderAt,
  projectedDominion,
  projectedGarrison,
  projectedGold,
  townRates,
  upgradeCost,
  upgradeCostAt,
  upgradePlan,
  wallsAt,
} from '../src/economy';
import { lordMods } from '../src/modifiers';
import { distance } from '../src/geometry';
import type { DomainEvent, Town } from '../src/types';
import { recomputeZone } from '../src/world';
import { capitalOf, config, game, give, lord, MIN, neutralsBeside, T0 } from './helpers';

describe('level scale', () => {
  const cfg = config();

  it('starts at 1, jumps most at first and reaches the top at the last level', () => {
    expect(levelScale(cfg, 1)).toBe(1);
    expect(levelScale(cfg, 2)).toBeCloseTo(2.5, 9);
    expect(levelScale(cfg, 100)).toBeCloseTo(5e11, -3);
    const step = (l: number): number => levelScale(cfg, l + 1) / levelScale(cfg, l);
    expect(step(1)).toBeGreaterThan(step(10));
    expect(step(10)).toBeGreaterThan(step(90));
    expect(step(90)).toBeGreaterThan(1);
  });

  it('builds walls from 20 to 10T in round numbers', () => {
    expect(wallsAt(cfg, 1)).toBe(20);
    expect(wallsAt(cfg, 2)).toBe(50);
    expect(wallsAt(cfg, 100)).toBe(1e13);
    for (let level = 3; level <= 100; level++) {
      const walls = wallsAt(cfg, level);
      expect(walls).toBeGreaterThan(wallsAt(cfg, level - 1));
      const unit = 10 ** (Math.floor(Math.log10(walls)) - 1);
      expect(walls % unit).toBe(0);
    }
  });

  it('scales plunder with the level too', () => {
    expect(plunderAt(cfg, 1)).toBe(40);
    expect(plunderAt(cfg, 2)).toBeCloseTo(100, 9);
  });

  it('copes with only two levels', () => {
    const short = config({
      towns: { maxTier: 2 },
      levels: { maxLevel: 2 },
      map: { isle: { tiers: [2, 2, 1] } },
      throne: { tier: 2 },
    });
    expect(levelScale(short, 2)).toBeCloseTo(2.5, 9);
  });
});

describe('production', () => {
  it('pays gold and trains troops in an owned town, without a cap', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    // Capital level 2: 2 gold and 1.2 troops per minute, ×2.5 for the level and ×1.5 for the capital.
    expect(townRates(state, capital).gold).toBeCloseTo(7.5, 12);
    expect(townRates(state, capital).troops).toBeCloseTo(4.5, 12);
    accrueTo(state, T0 + 7 * MIN);
    expect(lord(state, 'h1').gold).toBeCloseTo(120 + 7.5 * 7, 9);
    expect(capital.garrison).toBe(40 + 31);
    expect(capital.carry).toBeCloseTo(0.5, 9);
    capital.garrison = 1e9;
    accrueTo(state, T0 + 17 * MIN);
    expect(capital.garrison).toBe(1e9 + 45);
  });

  it('keeps the carry when nothing is produced', () => {
    expect(growGarrison(1, 0.4, 0, 5, 10)).toEqual({ garrison: 1, carry: 0.4 });
    expect(growGarrison(1, 0.4, 0.1, 1, 10)).toEqual({ garrison: 1, carry: 0.5 });
    expect(growGarrison(10, 0.4, 1, 1, 10)).toEqual({ garrison: 10, carry: 0 });
  });

  it('regenerates neutral towns slowly up to their starting size', () => {
    const state = game();
    const neutral = neutralsBeside(state, capitalOf(state, 'h1'))[0];
    if (!neutral) throw new Error('no neutral');
    const cap = neutral.neutralCap;
    neutral.garrison = 0;
    const rate = 1.2 * levelScale(state.config, neutral.tier) * 0.3;
    expect(townRates(state, neutral).troops).toBeCloseTo(rate, 12);
    expect(townRates(state, neutral).gold).toBe(0);
    accrueTo(state, T0 + 10 * MIN);
    expect(neutral.garrison).toBe(Math.min(cap, Math.floor(rate * 10)));
    accrueTo(state, T0 + 1000 * MIN);
    expect(neutral.garrison).toBe(cap);
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
    expect(capital.garrison).toBe(garrison);
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
    const plain = 2 * levelScale(state.config, first.tier) * lordMods(state, 'h1').sprawl;
    expect(townRates(state, first).gold).toBeCloseTo(plain * 1.25, 12);
    expect(townRates(state, capitalOf(state, 'h1')).gold).toBeCloseTo(7.5 * lordMods(state, 'h1').sprawl, 12);
    const perTier = [capitalOf(state, 'h1'), ...towns].reduce((sum, t) => sum + t.tier, 0);
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
    give(state, throne, 'h1', 1);
    expect(dominionRates(state).get('h1')).toBeCloseTo(2 + 5 + 25, 12);
    accrueTo(state, T0 + 10 * MIN);
    expect(lord(state, 'h1').dominion).toBeCloseTo(320, 9);
  });
});

describe('skills', () => {
  it('adds 5 % per point to gold, troops and attack', () => {
    const state = game();
    lord(state, 'h1').skills = { GOLD: 4, TROOPS: 2, ATTACK: 10 };
    expect(lordMods(state, 'h1')).toMatchObject({ goldProd: 1.2, troopProd: 1.1, attack: 1.5 });
    expect(goldRate(state, 'h1')).toBeCloseTo(7.5 * 1.2, 12);
    expect(townRates(state, capitalOf(state, 'h1')).troops).toBeCloseTo(4.5 * 1.1, 12);
    expect(lordMods(state, 'nobody').goldProd).toBe(1);
    expect(lordMods(state, null).attack).toBe(1);
  });
});

describe('costs and fortification', () => {
  it('prices upgrades by level and stops at the top level', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    // Level 1 to 2 costs 8; from level 2 it is 8 × 2.5.
    expect(upgradeCost(state, capital)).toBeCloseTo(20, 9);
    capital.tier = 100;
    expect(upgradeCost(state, capital)).toBeNull();
    expect(upgradeCostAt(state.config, 99)).toBeCloseTo(8 * levelScale(state.config, 99), 0);
  });

  it('plans as many levels in a row as the gold pays for', () => {
    const cfg = config();
    expect(upgradePlan(cfg, 1, 7.99, 10)).toEqual({ levels: 0, cost: 0 });
    const two = 8 + upgradeCostAt(cfg, 2)!;
    expect(upgradePlan(cfg, 1, two, 10)).toEqual({ levels: 2, cost: two });
    expect(upgradePlan(cfg, 1, two, 1)).toEqual({ levels: 1, cost: 8 });
    expect(upgradePlan(cfg, 99, 1e30, 10).levels).toBe(1);
  });

  it('adds 5 % per level from level 1 and stacks capital and Throne', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    expect(fortification(state, capital)).toBeCloseTo(1.05 * 1.75, 12);
    capital.tier = 100;
    expect(fortification(state, capital)).toBeCloseTo(5.95 * 1.75, 12);
    const crowned = game({ config: { throne: { enabled: true } } });
    const throne = crowned.towns[crowned.throneTownId ?? -1];
    if (!throne) throw new Error('no throne');
    expect(fortification(crowned, throne)).toBeCloseTo(1.2, 12);
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
    give(state, home, 'h1', 1);
    expect(fortification(state, home)).toBeCloseTo(neutralFort * 3, 12);
    expect(fortification(state, capital)).toBeCloseTo(1.05 * 1.75, 12);
    give(state, home, 'h2', 1);
    expect(fortification(state, home)).toBeCloseTo(neutralFort, 12);
    const awayFort = fortification(state, away);
    give(state, away, 'h1', 1);
    expect(fortification(state, away)).toBeCloseTo(awayFort, 12);
  });

  it('slows the production of lords with many towns', () => {
    const state = game({ config: { towns: { sprawl: { freeTowns: 2, penaltyPerTown: 0.1 } } } });
    const capital = capitalOf(state, 'h1');
    const base = townRates(state, capital).gold;
    const extra = state.towns.filter((t) => t.owner === null && !t.isThrone).slice(0, 4);
    for (const town of extra) give(state, town, 'h1', 1);
    expect(lordMods(state, 'h1').sprawl).toBeCloseTo(1 / (1 + 3 * 0.1), 12);
    expect(townRates(state, capital).gold).toBeCloseTo(base / 1.3, 12);
    expect(lordMods(state, 'h2').sprawl).toBe(1);
  });
});
