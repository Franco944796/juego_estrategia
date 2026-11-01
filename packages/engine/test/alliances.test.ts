import { liveConfig } from '@si/config';
import { describe, expect, it } from 'vitest';
import { setClan } from '../src/alliances';
import { advanceTo, createGame, execute } from '../src/game';
import { hashState } from '../src/hash';
import { joinLord } from '../src/join';
import { totalTroops } from '../src/troops';
import type { DomainEvent, GameState, March, Town } from '../src/types';
import { view } from '../src/view';
import { visibleIsles } from '../src/vision';
import { migrateState } from '../src/world';
import { capitalOf, game, give, humans, lord, NO_PRODUCTION, T0, townOutOfReach, troops } from './helpers';

function launched(events: DomainEvent[]): March {
  const e = events.find((x) => x.type === 'MARCH_LAUNCHED');
  if (!e || e.type !== 'MARCH_LAUNCHED') throw new Error('no march');
  return e.march;
}

/** h1 and h2 in one clan, h3 outside; h2 owns a town on h1's isle (its outpost). */
function alliance(): { state: GameState; host: Town; outpost: Town; foe: Town } {
  const state = game({ lords: humans(3), config: NO_PRODUCTION });
  setClan(state, 'h1', 'sky', T0);
  setClan(state, 'h2', 'sky', T0);
  const host = capitalOf(state, 'h1');
  const [outpost, foe] = state.towns.filter((t) => t.isleId === host.isleId && t.owner === null);
  if (!outpost || !foe) throw new Error('need two neutral towns');
  give(state, outpost, 'h2', troops(40));
  give(state, foe, 'h3', troops(200));
  return { state, host, outpost, foe };
}

describe('alliances', () => {
  it('stations a clanmate march in the ally town and shows it as friendly', () => {
    const { state, host, outpost } = alliance();
    const sent = execute(
      state,
      'h2',
      { type: 'SEND', from: outpost.id, to: host.id, troops: troops(30) },
      T0,
    );
    if (!sent.ok) throw new Error(sent.error.code);
    const march = launched(sent.events);
    const before = { ...host.garrison };
    const hostView = view(state, 'h1', T0);
    const seen = hostView.marches.find((m) => m.id === march.id);
    expect(seen).toMatchObject({ incoming: false, allied: true, troops: troops(30) });
    const events = advanceTo(state, march.arriveAt);
    expect(events.some((e) => e.type === 'MARCH_STATIONED')).toBe(true);
    expect(host.garrison).toEqual(before);
    expect(host.stationed).toEqual([{ lordId: 'h2', troops: troops(30) }]);
    expect(view(state, 'h1', march.arriveAt).towns[host.id]?.stationed).toEqual([
      { lordId: 'h2', troops: troops(30) },
    ]);
    const again = execute(
      state,
      'h2',
      { type: 'SEND', from: outpost.id, to: host.id, troops: troops(5) },
      march.arriveAt,
    );
    advanceTo(state, launched(again.events).arriveAt);
    expect(host.stationed).toEqual([{ lordId: 'h2', troops: troops(35) }]);
  });

  it('defends with every contingent and shares the glory by power', () => {
    const { state, host, outpost, foe } = alliance();
    host.garrison = troops(20);
    host.stationed = [{ lordId: 'h2', troops: troops(40) }];
    const attack = execute(state, 'h3', { type: 'SEND', from: foe.id, to: host.id, troops: troops(60) }, T0);
    const march = launched(attack.events);
    const battle = advanceTo(state, march.arriveAt).find((e) => e.type === 'BATTLE');
    if (!battle || battle.type !== 'BATTLE') throw new Error('no battle');
    const r = battle.report;
    expect(r.winner).toBe('DEFENDER');
    expect(r.defenderTroops).toEqual(troops(60));
    expect(r.allies).toHaveLength(1);
    expect(r.allies[0]?.lordId).toBe('h2');
    const hostLost = 20 - host.garrison.LANCER;
    const allyLost = 40 - (host.stationed[0]?.troops.LANCER ?? 0);
    expect(allyLost).toBeGreaterThanOrEqual(hostLost);
    expect(lord(state, 'h2').glory).toBeGreaterThan(lord(state, 'h1').glory);
    expect(lord(state, 'h1').glory + lord(state, 'h2').glory).toBeCloseTo(60 / 10, 9);
    expect(outpost.owner).toBe('h2');
  });

  it('loses the stationed troops with the town', () => {
    const { state, outpost, foe } = alliance();
    outpost.garrison = troops(0);
    outpost.stationed = [{ lordId: 'h1', troops: troops(2) }];
    const attack = execute(
      state,
      'h3',
      { type: 'SEND', from: foe.id, to: outpost.id, troops: troops(100) },
      T0,
    );
    const events = advanceTo(state, launched(attack.events).arriveAt);
    expect(events.some((e) => e.type === 'TOWN_CAPTURED')).toBe(true);
    expect(outpost.owner).toBe('h3');
    expect(outpost.stationed).toEqual([]);
  });

  it('lets a clanmate pull its stationed troops back out', () => {
    const { state, host, outpost } = alliance();
    host.stationed = [{ lordId: 'h2', troops: troops(10) }];
    const tooMany = execute(
      state,
      'h2',
      { type: 'SEND', from: host.id, to: outpost.id, troops: troops(11) },
      T0,
    );
    expect(tooMany.ok ? null : tooMany.error.rule).toBe('R08');
    const stranger = execute(
      state,
      'h3',
      { type: 'SEND', from: host.id, to: outpost.id, troops: troops(1) },
      T0,
    );
    expect(stranger.ok ? null : stranger.error.rule).toBe('R03');
    const back = execute(
      state,
      'h2',
      { type: 'SEND', from: host.id, to: outpost.id, troops: troops(10) },
      T0,
    );
    expect(back.ok).toBe(true);
    expect(host.stationed).toEqual([]);
    advanceTo(state, launched(back.events).arriveAt);
    expect(outpost.garrison).toEqual(troops(50));
  });

  it('sends contingents home when the alliance breaks', () => {
    const { state, host, outpost } = alliance();
    host.stationed = [{ lordId: 'h2', troops: troops(10) }];
    outpost.stationed = [{ lordId: 'h1', troops: troops(5) }];
    const events = setClan(state, 'h2', null, T0);
    expect(events[0]).toEqual({ type: 'CLAN_CHANGED', at: T0, lordId: 'h2', clanId: null });
    const marches = events.flatMap((e) => (e.type === 'MARCH_LAUNCHED' ? [e.march] : []));
    expect(marches.map((m) => [m.owner, m.to]).sort()).toEqual([
      ['h1', host.id],
      ['h2', capitalOf(state, 'h2').id],
    ]);
    expect(host.stationed).toEqual([]);
    expect(outpost.stationed).toEqual([]);
    expect(setClan(state, 'h2', null, T0)).toEqual([]);
    expect(setClan(state, 'ghost', 'x', T0)).toEqual([]);
  });

  it('shares vision inside the clan', () => {
    const state = game({ lords: humans(3) });
    const far = townOutOfReach(state, capitalOf(state, 'h1'));
    give(state, far, 'h2', troops(9));
    expect(visibleIsles(state, 'h1').has(far.isleId)).toBe(false);
    setClan(state, 'h1', 'sky', T0);
    setClan(state, 'h2', 'sky', T0);
    expect(visibleIsles(state, 'h1').has(far.isleId)).toBe(true);
    expect(visibleIsles(state, 'h3').has(far.isleId)).toBe(false);
  });

  it('lets clanmates reinforce each other capitals when capitals are immune', () => {
    const state = createGame({ seed: 5, config: liveConfig, startsAt: T0, lords: [] });
    for (const id of ['ana', 'bo', 'cy']) joinLord(state, { id, name: id, color: '#fff', isBot: false }, T0);
    setClan(state, 'ana', 'sky', T0);
    setClan(state, 'bo', 'sky', T0);
    const capital = state.towns[lord(state, 'bo').capitalId ?? -1];
    const base = state.towns.find((t) => t.isleId === capital?.isleId && t.owner === null);
    if (!capital || !base) throw new Error('no towns');
    give(state, base, 'ana', troops(20));
    const help = execute(
      state,
      'ana',
      { type: 'SEND', from: base.id, to: capital.id, troops: troops(5) },
      T0,
    );
    expect(help.ok).toBe(true);
    give(state, base, 'cy', troops(20));
    const attack = execute(
      state,
      'cy',
      { type: 'SEND', from: base.id, to: capital.id, troops: troops(5) },
      T0,
    );
    expect(attack.ok ? null : attack.error.rule).toBe('R15');
  });

  it('replays clan changes and stationed troops to the same state', () => {
    const run = (): GameState => {
      const { state, host, outpost } = alliance();
      const sent = execute(
        state,
        'h2',
        { type: 'SEND', from: outpost.id, to: host.id, troops: troops(10) },
        T0,
      );
      advanceTo(state, launched(sent.events).arriveAt);
      setClan(state, 'h1', null, launched(sent.events).arriveAt + 1);
      advanceTo(state, T0 + 3_600_000);
      return state;
    };
    expect(hashState(run())).toBe(hashState(run()));
  });

  it('fills fields missing from older saves', () => {
    const state = game();
    const old = JSON.parse(JSON.stringify(state)) as GameState;
    for (const town of old.towns) delete (town as Partial<Town>).stationed;
    delete (old.lords.h1 as Partial<GameState['lords'][string]>).clanId;
    const migrated = migrateState(old);
    expect(migrated.towns.every((t) => Array.isArray(t.stationed))).toBe(true);
    expect(migrated.lords.h1?.clanId).toBeNull();
    expect(totalTroops(migrated.towns[0]?.garrison ?? troops(0))).toBeGreaterThan(0);
  });
});
