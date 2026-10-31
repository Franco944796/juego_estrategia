import { EDICT_IDS } from '@si/config/constants';
import { describe, expect, it } from 'vitest';
import { advanceTo, computeStandings, execute } from '../src/game';
import { distance, windFactor } from '../src/geometry';
import { arriveMarch, travelInfo, windDirAt } from '../src/marches';
import { totalTroops } from '../src/troops';
import type { BattleReport, DomainEvent, GameState, Town } from '../src/types';
import { openDrafts } from '../src/world';
import {
  bots,
  capitalOf,
  game,
  give,
  humans,
  lord,
  MIN,
  neutralsBeside,
  NO_PRODUCTION,
  T0,
  townAcrossLane,
  townsOnIsle,
  troops,
} from './helpers';

function send(state: GameState, lordId: string, from: Town, to: Town, t: ReturnType<typeof troops>, at = T0) {
  const result = execute(state, lordId, { type: 'SEND', from: from.id, to: to.id, troops: t }, at);
  if (!result.ok) throw new Error(`send rejected by ${result.error.rule}`);
  const launched = result.events.find((e) => e.type === 'MARCH_LAUNCHED');
  if (!launched || launched.type !== 'MARCH_LAUNCHED') throw new Error('no march');
  return launched.march;
}

function battles(events: DomainEvent[]): BattleReport[] {
  return events.flatMap((e) => (e.type === 'BATTLE' ? [e.report] : []));
}

function firstNeutral(state: GameState, town: Town): Town {
  const n = neutralsBeside(state, town)[0];
  if (!n) throw new Error('no neutral');
  return n;
}

describe('travel', () => {
  it('walks inside an isle at land speed, ignoring the wind', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    const march = send(state, 'h1', capital, target, troops(10));
    const minutes = Math.max(0.5, distance(capital.pos, target.pos) / 45);
    expect(march.arriveAt - march.departAt).toBe(Math.round(minutes * MIN));
    expect(march.sky).toBe(false);
    expect(march.windFactor).toBe(1);
    expect(capital.garrison).toEqual(troops(8, 14, 8));
  });

  it('moves at the slowest troop type', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    const griffins = travelInfo(state, 'h1', capital, target, troops(0, 0, 8), T0);
    const mixed = travelInfo(state, 'h1', capital, target, troops(1, 0, 8), T0);
    const dist = distance(capital.pos, target.pos);
    expect(griffins.durationMs).toBe(Math.round(Math.max(0.5, dist / (45 * 1.3)) * MIN));
    expect(mixed.durationMs).toBe(Math.round(Math.max(0.5, dist / 45) * MIN));
    lord(state, 'h1').edicts = ['SWIFT_WINGS'];
    const swift = travelInfo(state, 'h1', capital, target, troops(0, 0, 8), T0);
    expect(swift.durationMs).toBeLessThanOrEqual(griffins.durationMs);
  });

  it('flies between isles with the wind of the departure window', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const target = townAcrossLane(state, capital);
    const later = T0 + 31 * MIN;
    for (const at of [T0, later]) {
      const info = travelInfo(state, 'h1', capital, target, troops(1), at);
      const factor = windFactor(capital.pos, target.pos, windDirAt(state, at), 2, 0.5);
      expect(info.sky).toBe(true);
      expect(info.windFactor).toBe(factor);
      expect(info.durationMs).toBe(
        Math.round(Math.max(0.5, distance(capital.pos, target.pos) / (45 * factor)) * MIN),
      );
    }
    expect(windDirAt(state, later)).toBe(state.windDirs[1]);
    expect(windDirAt(state, T0 - MIN)).toBe(state.windDirs[0]);
    expect(windDirAt(state, state.endsAt + MIN)).toBe(state.windDirs[state.windDirs.length - 1]);
  });

  it('honors the Wind Readers headwind floor', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const target = townAcrossLane(state, capital);
    const plain = travelInfo(state, 'h1', capital, target, troops(1), T0);
    lord(state, 'h1').edicts = ['WIND_READERS'];
    const reader = travelInfo(state, 'h1', capital, target, troops(1), T0);
    expect(reader.windFactor).toBeGreaterThanOrEqual(plain.windFactor);
    expect(reader.windFactor).toBeGreaterThanOrEqual(0.75);
  });
});

describe('arrivals', () => {
  it('reinforces an own town', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    give(state, target, 'h1', troops(0));
    const march = send(state, 'h1', capital, target, troops(10));
    const events = advanceTo(state, march.arriveAt);
    expect(events.map((e) => e.type)).toContain('MARCH_REINFORCED');
    expect(target.garrison).toEqual(troops(10));
    expect(state.marches).toHaveLength(0);
  });

  it('captures a neutral town, with plunder and glory', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    const defenders = totalTroops(target.garrison);
    const march = send(state, 'h1', capital, target, troops(18, 14, 8));
    const events = advanceTo(state, march.arriveAt);
    const [report] = battles(events);
    expect(report?.winner).toBe('ATTACKER');
    expect(report?.captured).toBe(true);
    expect(report?.plunder).toBe(40);
    expect(events).toContainEqual({
      type: 'TOWN_CAPTURED',
      at: march.arriveAt,
      townId: target.id,
      from: null,
      to: 'h1',
    });
    expect(target.owner).toBe('h1');
    expect(target.neutralCap).toBe(0);
    expect(totalTroops(target.garrison)).toBe(40 - totalTroops(report?.attackerLost ?? troops(0)));
    const h1 = lord(state, 'h1');
    expect(h1.gold).toBe(120 + 40);
    expect(h1.glory).toBeCloseTo(defenders / 10 + 3, 12);
    expect(h1.stats).toMatchObject({ captures: 1, battlesWon: 1, troopsKilled: defenders });
  });

  it('loses a weak attack and keeps the town neutral', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    const before = totalTroops(target.garrison);
    const march = send(state, 'h1', capital, target, troops(1));
    const [report] = battles(advanceTo(state, march.arriveAt));
    expect(report?.winner).toBe('DEFENDER');
    expect(report?.attackerLost).toEqual(troops(1));
    expect(target.owner).toBeNull();
    expect(totalTroops(target.garrison)).toBe(before - totalTroops(report?.defenderLost ?? troops(0)));
    expect(lord(state, 'h1').stats.battlesLost).toBe(1);
  });

  it('wipes a garrison without taking the town when no attacker survives', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    target.garrison = troops(2);
    const march = send(state, 'h1', capital, target, troops(3));
    const events = advanceTo(state, march.arriveAt);
    const [report] = battles(events);
    expect(report?.winner).toBe('ATTACKER');
    expect(report?.captured).toBe(false);
    expect(events.some((e) => e.type === 'TOWN_CAPTURED')).toBe(false);
    expect(target.owner).toBeNull();
    expect(target.garrison).toEqual(troops(0));
  });

  it('resolves simultaneous arrivals one after the other', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    target.garrison = troops(2);
    const first = send(state, 'h1', capital, target, troops(10));
    const second = send(state, 'h1', capital, target, troops(5));
    expect(second.arriveAt).toBe(first.arriveAt);
    const events = advanceTo(state, first.arriveAt);
    const types = events.map((e) => e.type).filter((t) => t === 'BATTLE' || t === 'MARCH_REINFORCED');
    expect(types).toEqual(['BATTLE', 'MARCH_REINFORCED']);
    const survivors = battles(events)[0]?.attackerTroops.LANCER ?? 0;
    expect(target.garrison.LANCER).toBe(survivors - (battles(events)[0]?.attackerLost.LANCER ?? 0) + 5);
  });

  it('ignores an arrival for a march that no longer exists', () => {
    const state = game();
    const events: DomainEvent[] = [];
    arriveMarch(state, 12345, T0, events);
    expect(events).toEqual([]);
  });

  it('moves the capital when it falls and lights a beacon when an isle is completed', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const [x, y] = neutralsBeside(state, capital);
    if (!x || !y) throw new Error('need two neutrals');
    give(state, x, 'h1', troops(5));
    give(state, y, 'h2', troops(200));
    capital.garrison = troops(0);
    const march = send(state, 'h2', y, capital, troops(100));
    const events = advanceTo(state, march.arriveAt);
    expect(capital.owner).toBe('h2');
    expect(capital.isCapital).toBe(false);
    expect(x.isCapital).toBe(true);
    expect(lord(state, 'h1').capitalId).toBe(x.id);
    expect(events).toContainEqual({ type: 'CAPITAL_MOVED', at: march.arriveAt, lordId: 'h1', townId: x.id });
    expect(lord(state, 'h1').stats.townsLost).toBe(1);

    x.garrison = troops(0);
    for (const t of neutralsBeside(state, capital)) give(state, t, 'h2', troops(1));
    const last = send(state, 'h2', capital, x, troops(50), march.arriveAt);
    const more = advanceTo(state, last.arriveAt);
    const isle = state.isles[capital.isleId];
    const allMine = townsOnIsle(state, capital.isleId).every((t) => t.owner === 'h2');
    expect(allMine).toBe(true);
    expect(isle?.beaconOwner).toBe('h2');
    expect(more).toContainEqual({
      type: 'BEACON_CHANGED',
      at: last.arriveAt,
      isleId: capital.isleId,
      owner: 'h2',
    });
  });
});

describe('exile and elimination', () => {
  function conquer(state: GameState): { events: DomainEvent[]; at: number } {
    const capital = capitalOf(state, 'h1');
    const base = firstNeutral(state, capital);
    give(state, base, 'h2', troops(300));
    capital.garrison = troops(0);
    const march = send(state, 'h2', base, capital, troops(100));
    return { events: advanceTo(state, march.arriveAt), at: march.arriveAt };
  }

  it('restarts a lord without towns on a free outer town', () => {
    const state = game({ config: NO_PRODUCTION });
    const { events } = conquer(state);
    const exiled = events.find((e) => e.type === 'LORD_EXILED');
    if (!exiled || exiled.type !== 'LORD_EXILED') throw new Error('not exiled');
    const town = state.towns[exiled.townId];
    expect(town?.owner).toBe('h1');
    expect(town?.isCapital).toBe(true);
    expect(town?.garrison).toEqual(state.config.exile.troops);
    expect(state.isles[town?.isleId ?? -1]?.ring).toBe(state.config.map.rings.length);
    expect(lord(state, 'h1')).toMatchObject({ alive: true, exiles: 1, capitalId: exiled.townId });
  });

  it('waits for marches in flight before exiling', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const far = townAcrossLane(state, capital);
    const probe = send(state, 'h1', capital, far, troops(1));
    const { events, at } = conquer(state);
    expect(probe.arriveAt).toBeGreaterThan(at);
    expect(events.some((e) => e.type === 'LORD_EXILED')).toBe(false);
    const later = advanceTo(state, probe.arriveAt);
    expect(later.some((e) => e.type === 'LORD_EXILED')).toBe(true);
  });

  it('eliminates the lord when exile is off', () => {
    const state = game({ config: { ...NO_PRODUCTION, exile: { enabled: false } } });
    const { events } = conquer(state);
    expect(events.some((e) => e.type === 'LORD_ELIMINATED')).toBe(true);
    expect(lord(state, 'h1')).toMatchObject({ alive: false, capitalId: null });
    const result = execute(state, 'h1', { type: 'CHOOSE_EDICT', edict: 'LEGEND' }, T0 + 10 * MIN);
    expect(result.ok ? null : result.error.rule).toBe('R01');
  });
});

describe('season clock', () => {
  it('shifts the wind, unseals the Throne and ends with frozen standings', () => {
    const state = game();
    const events = advanceTo(state, state.endsAt);
    const shifts = events.filter((e) => e.type === 'WIND_SHIFTED');
    expect(shifts).toHaveLength(state.windDirs.length - 1);
    expect(events.filter((e) => e.type === 'THRONE_UNSEALED')).toHaveLength(1);
    const end = events.at(-1);
    expect(end?.type).toBe('SEASON_ENDED');
    expect(state.status).toBe('ENDED');
    expect(state.standings?.map((s) => s.rank)).toEqual([1, 2]);
    expect(computeStandings(state, state.endsAt + MIN)).toBe(state.standings);
    expect(advanceTo(state, state.endsAt + 10 * MIN)).toEqual([]);
  });

  it('treats an out-of-order command time as the last settled instant', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    advanceTo(state, T0 + 31 * MIN);
    const march = send(state, 'h1', capital, target, troops(1), T0 + 5 * MIN);
    expect(march.departAt).toBe(T0 + 30 * MIN);
  });
});

describe('edict drafts', () => {
  it('opens a draft per glory threshold and lets the lord choose', () => {
    const state = game();
    const h1 = lord(state, 'h1');
    const events: DomainEvent[] = [];
    h1.glory = 10;
    openDrafts(state, h1, T0, events);
    expect(h1.draft).toHaveLength(3);
    expect(new Set(h1.draft).size).toBe(3);
    expect(h1.draftsOpened).toBe(1);
    const pick = h1.draft?.[0];
    const result = execute(state, 'h1', { type: 'CHOOSE_EDICT', edict: pick }, T0);
    expect(result.ok).toBe(true);
    expect(h1.edicts).toEqual([pick]);
    expect(h1.draft).toBeNull();
    h1.glory = 35;
    openDrafts(state, h1, T0, events);
    expect(h1.draft).not.toContain(pick);
    expect(h1.draftsOpened).toBe(2);
  });

  it('lets bots pick at once, following their preferences', () => {
    const state = game({ lords: [...humans(1), { ...bots(1)[0]!, personality: 'RAIDER' }] });
    const b1 = lord(state, 'b1');
    b1.glory = 75;
    openDrafts(state, b1, T0, []);
    expect(b1.edicts).toHaveLength(3);
    expect(b1.draft).toBeNull();
    expect(b1.draftsOpened).toBe(3);
  });

  it('stops offering when every edict is taken', () => {
    const state = game();
    const h1 = lord(state, 'h1');
    h1.edicts = [...EDICT_IDS];
    h1.glory = 1000;
    openDrafts(state, h1, T0, []);
    expect(h1.draft).toBeNull();
  });
});
