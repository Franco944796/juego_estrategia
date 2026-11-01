import { liveConfig } from '@si/config';
import { describe, expect, it } from 'vitest';
import { advanceTo, createGame, execute } from '../src/game';
import { hashState } from '../src/hash';
import { expandMap, joinLord, outerRing, setStyle } from '../src/join';
import { totalTroops } from '../src/troops';
import type { GameState, LordInit } from '../src/types';
import { view } from '../src/view';
import { isleNeighbors } from '../src/world';
import { game, humans, lord, MIN, T0, troops } from './helpers';

function world(seed = 3): GameState {
  return createGame({ seed, config: liveConfig, startsAt: T0, lords: [] });
}

function player(id: string): LordInit {
  return { id, name: id, color: '#fff', isBot: false };
}

function connected(state: GameState): boolean {
  const adj = isleNeighbors(state);
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length > 0) {
    for (const n of adj[stack.pop() as number] ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === state.isles.length;
}

describe('joining a running season', () => {
  it('founds a tier-1 capital on a free outer isle', () => {
    const state = world();
    const result = joinLord(state, player('ana'), T0 + 5 * MIN);
    if (!result.ok) throw new Error(result.error.code);
    const town = state.towns[result.townId];
    expect(town).toMatchObject({ owner: 'ana', tier: 1, isCapital: true });
    expect(totalTroops(town?.garrison ?? troops(0))).toBe(40);
    expect(state.isles[town?.isleId ?? -1]?.ring).toBe(outerRing(state));
    expect(lord(state, 'ana')).toMatchObject({ style: 'classic', gold: 300, capitalId: result.townId });
    expect(result.events.at(-1)).toEqual({
      type: 'LORD_JOINED',
      at: T0 + 5 * MIN,
      lordId: 'ana',
      townId: result.townId,
    });
  });

  it('rejects a second join and joins after the season end', () => {
    const state = world();
    expect(joinLord(state, player('ana'), T0).ok).toBe(true);
    const twice = joinLord(state, player('ana'), T0);
    expect(twice.ok ? null : twice.error.code).toBe('DUPLICATE_LORD');
    const late = joinLord(state, player('bo'), state.endsAt);
    expect(late.ok ? null : late.error.rule).toBe('R02');
  });

  it('grows a new ring when the outer isles are taken, keeping every old lane', () => {
    const state = world();
    const outer = state.isles.filter((isle) => isle.ring === 2).length;
    for (let i = 0; i < outer; i++) expect(joinLord(state, player(`p${i}`), T0).ok).toBe(true);
    const lanesBefore = state.lanes.map((l) => `${l.a}-${l.b}`);
    const isleCount = state.isles.length;
    const result = joinLord(state, player('late'), T0 + MIN);
    if (!result.ok) throw new Error(result.error.code);
    const grown = result.events.find((e) => e.type === 'MAP_EXPANDED');
    if (!grown || grown.type !== 'MAP_EXPANDED') throw new Error('map did not grow');
    expect(state.isles.length).toBe(isleCount + grown.isleIds.length);
    expect(grown.isleIds.length).toBeGreaterThanOrEqual(outer);
    expect(outerRing(state)).toBe(3);
    expect(state.isles[state.towns[result.townId]?.isleId ?? -1]?.ring).toBe(3);
    const lanesAfter = new Set(state.lanes.map((l) => `${l.a}-${l.b}`));
    for (const lane of lanesBefore) expect(lanesAfter.has(lane)).toBe(true);
    expect(connected(state)).toBe(true);
    expect(view(state, 'late', T0 + MIN).isles).toHaveLength(state.isles.length);
  });

  it('expands even an empty ring list deterministically', () => {
    const a = world(9);
    const b = world(9);
    expandMap(a, T0, []);
    expandMap(b, T0, []);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('replays joins and commands to the same state', () => {
    const run = (): GameState => {
      const state = world(4);
      joinLord(state, player('ana'), T0 + MIN);
      joinLord(state, player('bo'), T0 + 2 * MIN);
      const capital = lord(state, 'ana').capitalId ?? -1;
      execute(state, 'ana', { type: 'UPGRADE', townId: capital }, T0 + 3 * MIN);
      advanceTo(state, T0 + 600 * MIN);
      return state;
    };
    expect(hashState(run())).toBe(hashState(run()));
  });
});

describe('immune capitals', () => {
  function rivals(): { state: GameState; base: number; capital: number } {
    const state = world();
    joinLord(state, player('ana'), T0);
    joinLord(state, player('bo'), T0);
    const capital = lord(state, 'bo').capitalId ?? -1;
    const isleId = state.towns[capital]?.isleId ?? -1;
    const base = state.isles[isleId]?.townIds.find((id) => id !== capital) ?? -1;
    const town = state.towns[base];
    if (!town) throw new Error('no base');
    town.owner = 'ana';
    town.neutralCap = 0;
    town.garrison = troops(200);
    return { state, base, capital };
  }

  it('R15 rejects attacks on a capital when capitals are immune', () => {
    const { state, base, capital } = rivals();
    const result = execute(state, 'ana', { type: 'SEND', from: base, to: capital, troops: troops(10) }, T0);
    expect(result.ok ? null : result.error.rule).toBe('R15');
  });

  it('lets capitals fall in the demo rules', () => {
    const state = game({ lords: humans(2) });
    const capital = lord(state, 'h2').capitalId ?? -1;
    const isleId = state.towns[capital]?.isleId ?? -1;
    const base = state.towns.find((t) => t.isleId === isleId && t.id !== capital);
    if (!base) throw new Error('no base');
    base.owner = 'h1';
    base.neutralCap = 0;
    base.garrison = troops(50);
    const result = execute(state, 'h1', { type: 'SEND', from: base.id, to: capital, troops: troops(10) }, T0);
    expect(result.ok).toBe(true);
  });

  it('repels a march whose target became a capital on the way', () => {
    const state = world();
    joinLord(state, player('ana'), T0);
    const home = state.towns[lord(state, 'ana').capitalId ?? -1];
    if (!home) throw new Error('no home');
    const neighbor = (isleNeighbors(state)[home.isleId] ?? [])
      .map((id) => state.isles[id])
      .find((isle) => isle?.ring === outerRing(state));
    if (!neighbor) throw new Error('no outer neighbor');
    for (const isle of state.isles) {
      const first = state.towns[isle.townIds[0] ?? -1];
      if (isle.ring === outerRing(state) && isle.id !== neighbor.id && first && first.owner === null) {
        first.owner = 'ana';
        first.neutralCap = 0;
      }
    }
    const target = neighbor.townIds[0] ?? -1;
    const sent = execute(state, 'ana', { type: 'SEND', from: home.id, to: target, troops: troops(10) }, T0);
    if (!sent.ok) throw new Error(sent.error.code);
    const joined = joinLord(state, player('bo'), T0 + 1);
    expect(joined.ok && joined.townId).toBe(target);
    const launched = sent.events.find((e) => e.type === 'MARCH_LAUNCHED');
    if (!launched || launched.type !== 'MARCH_LAUNCHED') throw new Error('no march');
    const before = home.garrison.LANCER;
    const events = advanceTo(state, launched.march.arriveAt);
    expect(events.some((e) => e.type === 'MARCH_REPELLED')).toBe(true);
    expect(events.some((e) => e.type === 'BATTLE')).toBe(false);
    expect(home.garrison.LANCER).toBeGreaterThanOrEqual(before + 10);
    expect(state.towns[target]?.owner).toBe('bo');
  });
});

describe('styles', () => {
  it('changes a lord style only to a known style and shows it in the view', () => {
    const state = world();
    joinLord(state, player('ana'), T0);
    expect(setStyle(state, 'ana', 'hex', T0)).toEqual([
      { type: 'STYLE_CHANGED', at: T0, lordId: 'ana', style: 'hex' },
    ]);
    expect(setStyle(state, 'ana', 'nope', T0)).toEqual([]);
    expect(setStyle(state, 'ghost', 'hex', T0)).toEqual([]);
    expect(view(state, 'ana', T0).lords.find((l) => l.id === 'ana')?.style).toBe('hex');
  });
});
