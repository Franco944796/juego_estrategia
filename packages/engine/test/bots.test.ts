import { describe, expect, it } from 'vitest';
import { botTurn } from '../src/bots';
import { upgradeCost } from '../src/economy';
import { advanceTo, createGame, execute } from '../src/game';
import { hashState } from '../src/hash';
import type { DomainEvent, GameState, LordInit } from '../src/types';
import {
  allTroops,
  bots,
  capitalOf,
  config,
  game,
  give,
  growTo,
  humans,
  lord,
  neutralsBeside,
  NO_PRODUCTION,
  OPEN_CAPITALS,
  publicNeutral,
  T0,
  townAcrossLane,
} from './helpers';

function botSeason(seed: number, patch = {}): { state: GameState; events: DomainEvent[] } {
  const state = createGame({ seed, config: config(patch), startsAt: T0, lords: bots(8) });
  return { state, events: advanceTo(state, state.endsAt) };
}

function count(events: DomainEvent[], type: DomainEvent['type']): number {
  return events.filter((e) => e.type === type).length;
}

describe('a season played by bots', () => {
  const { state, events } = botSeason(11);

  it('runs to the end with conquests, upgrades, skills and reinforcements', () => {
    expect(state.status).toBe('ENDED');
    expect(count(events, 'TOWN_CAPTURED')).toBeGreaterThan(20);
    expect(count(events, 'TOWN_UPGRADED')).toBeGreaterThan(10);
    expect(count(events, 'SKILL_LEARNED')).toBeGreaterThan(0);
    expect(count(events, 'MARCH_REINFORCED')).toBeGreaterThan(0);
    expect(state.standings?.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps every quantity non-negative', () => {
    for (const l of Object.values(state.lords)) {
      expect(l.gold).toBeGreaterThanOrEqual(0);
      expect(l.dominion).toBeGreaterThan(0);
    }
    for (const town of state.towns) expect(town.garrison).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic per seed', () => {
    expect(hashState(botSeason(11).state)).toBe(hashState(state));
    expect(hashState(botSeason(12).state)).not.toBe(hashState(state));
  });
});

describe('troop conservation', () => {
  it('only battles remove troops when nothing is produced, minus those recovered', () => {
    // Weak neutrals, so starting armies can get past the walls without any production.
    const patch = { ...NO_PRODUCTION, exile: { enabled: false }, neutral: { garrison: [2, 2, 2, 2, 2] } };
    const s = createGame({ seed: 5, config: config(patch), startsAt: T0, lords: bots(6) });
    const start = allTroops(s);
    const events = advanceTo(s, s.endsAt - 1);
    let killed = 0;
    for (const e of events) {
      if (e.type !== 'BATTLE') continue;
      const r = e.report;
      const allies = r.allies.reduce((sum, a) => sum + a.recovered, 0);
      killed += r.attackerLost + r.defenderLost - r.attackerRecovered - r.defenderRecovered - allies;
    }
    expect(killed).toBeGreaterThan(0);
    expect(allTroops(s)).toBe(start - killed);
  });
});

describe('bot decisions', () => {
  const warden: LordInit = { ...(bots(1)[0] as LordInit), personality: 'WARDEN' };

  function duel(open = false): GameState {
    const config = open ? { ...NO_PRODUCTION, ...OPEN_CAPITALS } : NO_PRODUCTION;
    return game({ lords: [...humans(1), warden], config });
  }

  it('reinforces a town that would fall to an incoming march', () => {
    const state = duel(true);
    const capital = capitalOf(state, 'b1');
    const helper = neutralsBeside(state, capital)[0];
    if (!helper) throw new Error('no neutral');
    give(state, helper, 'b1', 200);
    capital.garrison = 10;
    const base = townAcrossLane(state, capital);
    give(state, base, 'h1', 300);
    const attack = execute(state, 'h1', { type: 'SEND', from: base.id, to: capital.id, troops: 300 }, T0);
    expect(attack.ok).toBe(true);
    const events: DomainEvent[] = [];
    botTurn(state, 'b1', T0, events);
    const help = events.find(
      (e) => e.type === 'MARCH_LAUNCHED' && e.march.owner === 'b1' && e.march.to === capital.id,
    );
    expect(help).toBeDefined();
  });

  it('spends its gold on upgrades, several levels at a time', () => {
    const state = duel();
    const b1 = lord(state, 'b1');
    const capital = capitalOf(state, 'b1');
    const before = capital.tier;
    b1.gold = 100_000;
    const events: DomainEvent[] = [];
    botTurn(state, 'b1', T0, events);
    const ups = count(events, 'TOWN_UPGRADED');
    expect(ups).toBeGreaterThan(0);
    expect(ups).toBeLessThanOrEqual(state.config.bots.personalities.WARDEN.upgradesPerTurn);
    expect(capital.tier).toBeGreaterThan(before + 1);
    expect(b1.gold).toBeLessThan(upgradeCost(state, capital) ?? Infinity);
  });

  it('attacks a weak neighbor it can beat', () => {
    const state = duel();
    capitalOf(state, 'b1').garrison = 200;
    const events: DomainEvent[] = [];
    botTurn(state, 'b1', T0, events);
    const launched = events.find((e) => e.type === 'MARCH_LAUNCHED' && e.march.owner === 'b1');
    expect(launched).toBeDefined();
  });

  it('pushes the stock of an inner town toward the frontier', () => {
    const state = duel();
    for (const t of state.towns) if (t.owner === null) t.garrison = 10_000;
    const inner = publicNeutral(state);
    const cluster = [inner, ...neutralsBeside(state, inner).slice(0, state.config.bots.targetsPerTown + 6)];
    for (const t of cluster) give(state, t, 'b1', 0);
    inner.garrison = 1000;
    const events: DomainEvent[] = [];
    botTurn(state, 'b1', T0, events);
    const moved = events.find((e) => e.type === 'MARCH_LAUNCHED' && e.march.from === inner.id);
    if (!moved || moved.type !== 'MARCH_LAUNCHED') throw new Error('no consolidation');
    expect(state.towns[moved.march.to]?.owner).toBe('b1');
    expect(count(events, 'MARCH_LAUNCHED')).toBe(1);
  });

  it('judges unseen garrisons by their ceiling, not their real size', () => {
    const fog = (hops: number): DomainEvent[] => {
      const state = game({
        lords: [...humans(1), warden],
        config: {
          ...NO_PRODUCTION,
          vision: { hops },
          wind: { tailwindMax: 1, headwindMin: 1 },
          bots: { targetsPerTown: 500 },
        },
      });
      growTo(state, 2);
      for (const t of state.towns) {
        if (t.owner !== null) continue;
        t.garrison = t.isleId === 0 ? 10_000 : 0;
        t.neutralCap = 10_000;
      }
      capitalOf(state, 'b1').garrison = 200;
      const events: DomainEvent[] = [];
      botTurn(state, 'b1', T0, events);
      return events.filter((e) => e.type === 'MARCH_LAUNCHED');
    };
    expect(fog(0)).toHaveLength(0);
    expect(fog(1).length).toBeGreaterThan(0);
  });

  it('spends every skill point following its personality', () => {
    const state = duel();
    lord(state, 'b1').level = 6;
    const events: DomainEvent[] = [];
    botTurn(state, 'b1', T0, events);
    expect(count(events, 'SKILL_LEARNED')).toBe(5);
    expect(lord(state, 'b1').skills).toEqual({ GOLD: 1, TROOPS: 3, ATTACK: 1 });
  });

  it('does nothing for a human or an eliminated lord', () => {
    const state = duel();
    const events: DomainEvent[] = [];
    botTurn(state, 'h1', T0, events);
    lord(state, 'b1').alive = false;
    botTurn(state, 'b1', T0, events);
    botTurn(state, 'ghost', T0, events);
    expect(events).toEqual([]);
  });
});
