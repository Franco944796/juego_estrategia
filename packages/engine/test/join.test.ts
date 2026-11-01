import { liveConfig } from '@si/config';
import { describe, expect, it } from 'vitest';
import { advanceTo, createGame, execute } from '../src/game';
import { hashState } from '../src/hash';
import { distance } from '../src/geometry';
import { growIsle, isleConquered, isleFull } from '../src/growth';
import { joinLord, setStyle } from '../src/join';
import { totalTroops } from '../src/troops';
import type { DomainEvent, GameState, Isle, LordInit, Town } from '../src/types';
import { view } from '../src/view';
import { isleNeighbors, setOwner } from '../src/world';
import { capitalOf, game, give, humans, lord, MIN, publicNeutral, T0, troops } from './helpers';

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
  it('founds a tier-1 capital on a shore slot with three private towns beside it', () => {
    const state = world();
    const result = joinLord(state, player('ana'), T0 + 5 * MIN);
    if (!result.ok) throw new Error(result.error.code);
    const town = state.towns[result.townId];
    if (!town) throw new Error('no capital');
    expect(town).toMatchObject({ owner: 'ana', tier: 1, isCapital: true, zoneId: null, privateTo: null });
    expect(totalTroops(town.garrison)).toBe(40);
    expect(state.isles[0]?.slots.filter((slot) => slot.lordId === 'ana')).toHaveLength(1);
    const own = state.towns.filter((t) => t.privateTo === 'ana');
    expect(own).toHaveLength(3);
    for (const t of own) {
      expect(t).toMatchObject({ owner: null, tier: 1, isleId: 0, zoneId: null });
      expect(distance(t.pos, town.pos)).toBeLessThanOrEqual(state.config.map.spawn.privateSpacing * 1.5);
    }
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

  it('hides private towns from everyone else until they are taken', () => {
    const state = world();
    joinLord(state, player('ana'), T0);
    joinLord(state, player('bo'), T0);
    const mine = state.towns.find((t) => t.privateTo === 'ana');
    if (!mine) throw new Error('no private town');
    const seenByBo = view(state, 'bo', T0);
    expect(seenByBo.towns.some((t) => t.id === mine.id)).toBe(false);
    expect(seenByBo.isles[0]?.townIds).not.toContain(mine.id);
    expect(view(state, 'ana', T0).towns.some((t) => t.id === mine.id)).toBe(true);

    const base = publicNeutral(state);
    give(state, base, 'bo', troops(100));
    const sneak = execute(state, 'bo', { type: 'SEND', from: base.id, to: mine.id, troops: troops(5) }, T0);
    expect(sneak.ok ? null : sneak.error).toMatchObject({ rule: 'R14', code: 'UNKNOWN_TOWN' });

    setOwner(state, mine, 'ana', T0, []);
    expect(mine.privateTo).toBeNull();
    expect(view(state, 'bo', T0).towns.some((t) => t.id === mine.id)).toBe(true);
  });

  it('opens a new linked isle when ten lords fill the first one', () => {
    const state = world();
    const slots = state.config.map.spawn.slots;
    for (let i = 0; i < slots - 1; i++) expect(joinLord(state, player(`p${i}`), T0).ok).toBe(true);
    expect(state.isles).toHaveLength(1);
    const tenth = joinLord(state, player('tenth'), T0 + MIN);
    expect(tenth.events.find((e) => e.type === 'MAP_EXPANDED')).toEqual({
      type: 'MAP_EXPANDED',
      at: T0 + MIN,
      isleIds: [1],
    });
    const late = joinLord(state, player('late'), T0 + 2 * MIN);
    if (!late.ok) throw new Error(late.error.code);
    expect(state.towns[late.townId]?.isleId).toBe(1);
    expect(state.isles[1]?.townIds.length).toBe(state.config.map.isle.towns + 4);
    expect(connected(state)).toBe(true);
    expect(view(state, 'late', T0 + 2 * MIN).isles).toHaveLength(2);
  });

  it('opens a new isle when every public town of the newest one has an owner', () => {
    const state = world();
    joinLord(state, player('ana'), T0);
    const open = (state.isles[0]?.townIds ?? [])
      .map((id) => state.towns[id] as Town)
      .filter((t) => t.owner === null && t.privateTo === null);
    const last = open.pop() as Town;
    for (const t of open) give(state, t, 'ana', troops(1));
    expect(isleConquered(state, state.isles[0] as Isle)).toBe(false);
    const events: DomainEvent[] = [];
    setOwner(state, last, 'ana', T0 + MIN, events);
    expect(events.some((e) => e.type === 'MAP_EXPANDED')).toBe(true);
    expect(state.isles).toHaveLength(2);
  });

  it('opens at most three isles a day and the world is full until the next one', () => {
    const state = world();
    const { slots } = state.config.map.spawn;
    const max = state.config.map.growth.maxPerDay;
    for (let i = 0; i < slots * (max + 1); i++) {
      const joined = joinLord(state, player(`p${i}`), T0 + i);
      if (!joined.ok) throw new Error(joined.error.code);
    }
    expect(state.isles).toHaveLength(max + 1);
    expect(state.isles.every(isleFull)).toBe(true);
    const day = 24 * 60 * MIN;
    expect(state.growCheckAt).toBe((state.isles[1]?.bornAt ?? 0) + day);
    const full = joinLord(state, player('late'), T0 + 60 * MIN);
    expect(full.ok ? null : full.error.code).toBe('WORLD_FULL');
    const grown = advanceTo(state, state.growCheckAt ?? 0);
    expect(grown.some((e) => e.type === 'MAP_EXPANDED')).toBe(true);
    expect(state.growCheckAt).toBeNull();
    expect(joinLord(state, player('late'), T0 + day).ok).toBe(true);
  });

  it('spreads the lords of a new game over the shore slots, opening isles as needed', () => {
    const state = game({ lords: humans(12) });
    const capitals = state.lordOrder.map((id) => capitalOf(state, id));
    expect(capitals.filter((t) => t.isleId === 0)).toHaveLength(10);
    expect(capitals.filter((t) => t.isleId === 1)).toHaveLength(2);
    expect(state.isles[0]?.slots.every((slot) => slot.lordId !== null)).toBe(true);
    const two = game({ lords: humans(2) });
    const [a, b] = two.lordOrder.map((id) => capitalOf(two, id));
    expect(distance(a?.pos ?? { x: 0, y: 0 }, b?.pos ?? { x: 0, y: 0 })).toBeGreaterThan(400);
  });

  it('grows the map deterministically', () => {
    const a = world(9);
    const b = world(9);
    growIsle(a, T0, []);
    growIsle(b, T0, []);
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
    const town = publicNeutral(state);
    give(state, town, 'ana', troops(200));
    return { state, base: town.id, capital };
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
    joinLord(state, player('bo'), T0);
    const home = capitalOf(state, 'ana');
    const target = publicNeutral(state);
    const sent = execute(
      state,
      'ana',
      { type: 'SEND', from: home.id, to: target.id, troops: troops(10) },
      T0,
    );
    if (!sent.ok) throw new Error(sent.error.code);
    // An exiled lord restarts on a neutral town, which can be one a march is already heading to.
    give(state, target, 'bo', troops(5));
    target.isCapital = true;
    const launched = sent.events.find((e) => e.type === 'MARCH_LAUNCHED');
    if (!launched || launched.type !== 'MARCH_LAUNCHED') throw new Error('no march');
    const before = home.garrison.LANCER;
    const events = advanceTo(state, launched.march.arriveAt);
    expect(events.some((e) => e.type === 'MARCH_REPELLED')).toBe(true);
    expect(events.some((e) => e.type === 'BATTLE')).toBe(false);
    expect(home.garrison.LANCER).toBeGreaterThanOrEqual(before + 10);
    expect(target.owner).toBe('bo');
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
