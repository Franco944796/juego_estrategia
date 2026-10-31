import { describe, expect, it } from 'vitest';
import { botTurn } from '../src/bots';
import { advanceTo, createGame, execute } from '../src/game';
import { hashState } from '../src/hash';
import { totalTroops } from '../src/troops';
import type { DomainEvent, GameState, LordInit } from '../src/types';
import {
  allTroops,
  bots,
  capitalOf,
  config,
  game,
  give,
  humans,
  lord,
  neutralsBeside,
  NO_PRODUCTION,
  T0,
  townAcrossLane,
  troops,
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

  it('runs to the end with conquests, upgrades, edicts and reinforcements', () => {
    expect(state.status).toBe('ENDED');
    expect(count(events, 'TOWN_CAPTURED')).toBeGreaterThan(20);
    expect(count(events, 'TOWN_UPGRADED')).toBeGreaterThan(10);
    expect(count(events, 'EDICT_CHOSEN')).toBeGreaterThan(0);
    expect(count(events, 'MARCH_REINFORCED')).toBeGreaterThan(0);
    expect(state.standings?.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps every quantity non-negative', () => {
    for (const l of Object.values(state.lords)) {
      expect(l.gold).toBeGreaterThanOrEqual(0);
      expect(l.dominion).toBeGreaterThan(0);
    }
    for (const town of state.towns) {
      expect(
        Math.min(town.garrison.LANCER, town.garrison.ARCHER, town.garrison.GRIFFIN),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic per seed', () => {
    expect(hashState(botSeason(11).state)).toBe(hashState(state));
    expect(hashState(botSeason(12).state)).not.toBe(hashState(state));
  });
});

describe('troop conservation', () => {
  it('only battles remove troops when nothing is produced', () => {
    const patch = { ...NO_PRODUCTION, exile: { enabled: false } };
    const s = createGame({ seed: 5, config: config(patch), startsAt: T0, lords: bots(6) });
    const start = allTroops(s);
    const events = advanceTo(s, s.endsAt - 1);
    let killed = 0;
    for (const e of events) {
      if (e.type === 'BATTLE')
        killed += totalTroops(e.report.attackerLost) + totalTroops(e.report.defenderLost);
    }
    expect(killed).toBeGreaterThan(0);
    expect(allTroops(s)).toBe(start - killed);
  });
});

describe('bot decisions', () => {
  const warden: LordInit = { ...(bots(1)[0] as LordInit), personality: 'WARDEN' };

  function duel(): GameState {
    return game({ lords: [...humans(1), warden], config: NO_PRODUCTION });
  }

  it('reinforces a town that would fall to an incoming march', () => {
    const state = duel();
    const capital = capitalOf(state, 'b1');
    const helper = neutralsBeside(state, capital)[0];
    if (!helper) throw new Error('no neutral');
    give(state, helper, 'b1', troops(200));
    capital.garrison = troops(10);
    const base = townAcrossLane(state, capital);
    give(state, base, 'h1', troops(300));
    const attack = execute(
      state,
      'h1',
      { type: 'SEND', from: base.id, to: capital.id, troops: troops(300) },
      T0,
    );
    expect(attack.ok).toBe(true);
    const events: DomainEvent[] = [];
    botTurn(state, 'b1', T0, events);
    const help = events.find(
      (e) => e.type === 'MARCH_LAUNCHED' && e.march.owner === 'b1' && e.march.to === capital.id,
    );
    expect(help).toBeDefined();
  });

  it('spends gold on upgrades, up to its per-turn limit', () => {
    const state = duel();
    lord(state, 'b1').gold = 100_000;
    const events: DomainEvent[] = [];
    botTurn(state, 'b1', T0, events);
    expect(count(events, 'TOWN_UPGRADED')).toBe(state.config.bots.personalities.WARDEN.upgradesPerTurn);
  });

  it('attacks a weak neighbor it can beat', () => {
    const state = duel();
    capitalOf(state, 'b1').garrison = troops(200);
    const events: DomainEvent[] = [];
    botTurn(state, 'b1', T0, events);
    const launched = events.find((e) => e.type === 'MARCH_LAUNCHED' && e.march.owner === 'b1');
    expect(launched).toBeDefined();
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
