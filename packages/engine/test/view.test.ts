import { describe, expect, it } from 'vitest';
import { advanceTo, execute } from '../src/game';
import { hashState } from '../src/hash';
import { view } from '../src/view';
import { visibleIsles } from '../src/vision';
import { recomputeBeacon } from '../src/world';
import {
  capitalOf,
  game,
  give,
  MIN,
  neutralsBeside,
  T0,
  townOutOfReach,
  townsOnIsle,
  troops,
} from './helpers';

describe('view', () => {
  it('shows the lord, its towns and what it can see', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const v = view(state, 'h1', T0);
    expect(v.title).toBe('Shattered Isles');
    expect(v.me).toMatchObject({
      id: 'h1',
      gold: 120,
      glory: 0,
      nextGlory: 10,
      draft: null,
      activeMarches: 0,
    });
    const own = v.towns.find((t) => t.id === capital.id);
    expect(own?.own).toMatchObject({ upgradeCost: 240, respecCost: 80, cap: 80 });
    expect(own?.garrison).toEqual(troops(18, 14, 8));
    const neighbor = neutralsBeside(state, capital)[0];
    expect(v.towns.find((t) => t.id === neighbor?.id)?.garrison).not.toBeNull();
    const far = townOutOfReach(state, capital);
    const farView = v.towns.find((t) => t.id === far.id);
    expect(farView?.garrison).toBeNull();
    expect(farView?.own).toBeNull();
    expect(v.lords.map((l) => l.id)).toEqual(['h1', 'h2']);
    expect(v.standings).toHaveLength(2);
  });

  it('forecasts the wind', () => {
    const state = game();
    const v = view(state, 'h1', T0);
    expect(v.wind.dir).toBe(state.windDirs[0]);
    expect(v.wind.nextShiftAt).toBe(T0 + 30 * MIN);
    expect(v.wind.forecast).toEqual([
      { at: T0 + 30 * MIN, dir: state.windDirs[1] },
      { at: T0 + 60 * MIN, dir: state.windDirs[2] },
    ]);
    const late = view(state, 'h1', state.endsAt - MIN);
    expect(late.wind.forecast).toEqual([]);
    expect(late.wind.nextShiftAt).toBeNull();
  });

  it('projects production without touching the state', () => {
    const state = game();
    const before = hashState(state);
    const v = view(state, 'h1', T0 + 10 * MIN);
    expect(v.me.gold).toBeCloseTo(120 + 5.25 * 10, 9);
    expect(v.me.dominion).toBeCloseTo(20, 9);
    expect(v.me.goldPerMin).toBeCloseTo(5.25, 12);
    expect(hashState(state)).toBe(before);
    expect(() => view(state, 'ghost', T0)).toThrow();
  });

  it('reveals incoming armies but hides strangers’ troops', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const [a, b] = neutralsBeside(state, capital);
    if (!a || !b) throw new Error('need two neutrals');
    give(state, a, 'h2', troops(40));
    give(state, b, 'h2', troops(0));
    const attack = execute(state, 'h1', { type: 'SEND', from: capital.id, to: a.id, troops: troops(10) }, T0);
    const move = execute(state, 'h2', { type: 'SEND', from: a.id, to: b.id, troops: troops(5) }, T0);
    expect(attack.ok && move.ok).toBe(true);

    const mine = view(state, 'h1', T0);
    const ownMarch = mine.marches.find((m) => m.owner === 'h1');
    expect(ownMarch).toMatchObject({ mine: true, incoming: false, troops: troops(10) });
    expect(ownMarch?.windFactor).toBe(1);
    const stranger = mine.marches.find((m) => m.owner === 'h2');
    expect(stranger).toMatchObject({ mine: false, incoming: false, troops: null, windFactor: null });

    const theirs = view(state, 'h2', T0);
    const incoming = theirs.marches.find((m) => m.owner === 'h1');
    expect(incoming).toMatchObject({ incoming: true, troops: troops(10), windFactor: null });

    const events = advanceTo(state, ownMarch?.arriveAt ?? T0);
    expect(events.some((e) => e.type === 'BATTLE')).toBe(true);
    expect(view(state, 'h1', ownMarch?.arriveAt ?? T0).reports).toHaveLength(1);
    expect(view(state, 'h2', ownMarch?.arriveAt ?? T0).reports).toHaveLength(1);
  });

  it('widens vision from a lit beacon', () => {
    const state = game({ config: { vision: { hops: 0 } } });
    const capital = capitalOf(state, 'h1');
    expect([...visibleIsles(state, 'h1')]).toEqual([capital.isleId]);
    for (const town of townsOnIsle(state, capital.isleId)) give(state, town, 'h1', town.garrison);
    recomputeBeacon(state, capital.isleId, T0, []);
    expect(visibleIsles(state, 'h1').size).toBeGreaterThan(1);
  });
});
