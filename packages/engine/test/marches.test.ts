import { defaultConfig, liveConfig } from '@si/config';
import { describe, expect, it } from 'vitest';
import { advanceTo, computeStandings, execute } from '../src/game';
import { distance, windFactor } from '../src/geometry';
import { arriveMarch, travelInfo, troopSlowdown, windDirAt } from '../src/marches';
import type { BattleReport, DomainEvent, GameState, Town } from '../src/types';
import {
  capitalOf,
  game,
  give,
  growTo,
  lord,
  MIN,
  neutralsBeside,
  NO_PRODUCTION,
  NO_RECOVERY,
  T0,
  townAcrossLane,
} from './helpers';

const QUIET = { ...NO_PRODUCTION, ...NO_RECOVERY };

function send(state: GameState, lordId: string, from: Town, to: Town, t: number, at = T0) {
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

const LAND = defaultConfig.march.landSpeed;
const SKY = defaultConfig.march.skySpeed;
const MIN_DURATION = defaultConfig.march.minDurationMin;

describe('travel', () => {
  it('walks inside an isle at land speed, ignoring the wind', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    const march = send(state, 'h1', capital, target, 10);
    // Two digits of troops: ×(1 + 5) the time of 9 troops or fewer.
    const minutes = Math.max(MIN_DURATION, (distance(capital.pos, target.pos) / LAND) * 6);
    expect(march.arriveAt - march.departAt).toBe(Math.round(minutes * MIN));
    expect(march.sky).toBe(false);
    expect(march.windFactor).toBe(1);
    expect(capital.garrison).toBe(30);
  });

  it('flies between isles with the wind of the departure window', () => {
    const state = game();
    const capital = capitalOf(state, 'h1');
    const target = townAcrossLane(state, capital);
    const later = T0 + 31 * MIN;
    for (const at of [T0, later]) {
      const info = travelInfo(state, 'h1', capital, target, 1, at);
      const factor = windFactor(capital.pos, target.pos, windDirAt(state, at), 2, 0.5);
      expect(info.sky).toBe(true);
      expect(info.windFactor).toBe(factor);
      expect(info.durationMs).toBe(
        Math.round(Math.max(MIN_DURATION, distance(capital.pos, target.pos) / (SKY * factor)) * MIN),
      );
    }
    expect(windDirAt(state, later)).toBe(state.windDirs[1]);
    expect(windDirAt(state, T0 - MIN)).toBe(state.windDirs[0]);
    expect(windDirAt(state, state.endsAt + MIN)).toBe(state.windDirs[state.windDirs.length - 1]);
  });
});

describe('army size', () => {
  it('adds the base time again ×5 for each digit of troops beyond the first', () => {
    const state = game();
    expect([1, 9, 10, 99, 100, 999_999, 1_000_000, 1e12].map((n) => troopSlowdown(state, n))).toEqual([
      1, 1, 6, 6, 11, 26, 31, 61,
    ]);
  });

  it('crosses the isle in about 10 real seconds with up to 9 troops, the same in the demo and online', () => {
    const across = 540;
    const demoSeconds = ((across / LAND) * 60) / defaultConfig.demo.timeScale;
    const liveSeconds = (across / liveConfig.march.landSpeed) * 60;
    expect(demoSeconds).toBeCloseTo(10, 0);
    expect(liveSeconds).toBeCloseTo(demoSeconds, 9);
  });
});

describe('arrivals', () => {
  it('reinforces an own town', () => {
    const state = game({ config: NO_PRODUCTION });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    give(state, target, 'h1', 0);
    const march = send(state, 'h1', capital, target, 10);
    const events = advanceTo(state, march.arriveAt);
    expect(events.map((e) => e.type)).toContain('MARCH_REINFORCED');
    expect(target.garrison).toBe(10);
    expect(state.marches).toHaveLength(0);
  });

  it('captures a neutral town past its walls, with plunder', () => {
    const state = game({ config: QUIET });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    target.tier = 1;
    target.garrison = 10;
    const defenders = target.garrison;
    const march = send(state, 'h1', capital, target, 40);
    const events = advanceTo(state, march.arriveAt);
    const [report] = battles(events);
    expect(report?.winner).toBe('ATTACKER');
    expect(report?.captured).toBe(true);
    expect(report?.walls).toBe(20);
    expect(report?.defenderPower).toBe(30);
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
    expect(target.garrison).toBe(40 - (report?.attackerLost ?? 0));
    const h1 = lord(state, 'h1');
    expect(h1.gold).toBe(120 + 40 + defenders * 5);
    expect(h1.stats).toMatchObject({ captures: 1, battlesWon: 1, troopsKilled: defenders });
  });

  it('loses a weak attack and keeps the town neutral', () => {
    const state = game({ config: QUIET });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    const before = target.garrison;
    const march = send(state, 'h1', capital, target, 1);
    const [report] = battles(advanceTo(state, march.arriveAt));
    expect(report?.winner).toBe('DEFENDER');
    expect(report?.attackerLost).toBe(1);
    expect(target.owner).toBeNull();
    expect(target.garrison).toBe(before - (report?.defenderLost ?? 0));
    expect(lord(state, 'h1').stats.battlesLost).toBe(1);
  });

  it('wipes a garrison without taking the town when no attacker survives', () => {
    const state = game({ config: QUIET });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    target.tier = 1;
    target.garrison = 2;
    // 21 × 1.05 = 22.05 attack against 2 troops and 20 of walls: a win with almost nothing left.
    lord(state, 'h1').skills.ATTACK = 1;
    const march = send(state, 'h1', capital, target, 21);
    const events = advanceTo(state, march.arriveAt);
    const [report] = battles(events);
    expect(report?.winner).toBe('ATTACKER');
    expect(report?.captured).toBe(false);
    expect(events.some((e) => e.type === 'TOWN_CAPTURED')).toBe(false);
    expect(target.owner).toBeNull();
    expect(target.garrison).toBe(0);
  });

  it('resolves simultaneous arrivals one after the other', () => {
    const state = game({ config: QUIET });
    const capital = capitalOf(state, 'h1');
    const target = firstNeutral(state, capital);
    target.tier = 1;
    target.garrison = 2;
    const first = send(state, 'h1', capital, target, 30);
    const second = send(state, 'h1', capital, target, 10);
    expect(second.arriveAt).toBe(first.arriveAt);
    const events = advanceTo(state, first.arriveAt);
    const types = events.map((e) => e.type).filter((t) => t === 'BATTLE' || t === 'MARCH_REINFORCED');
    expect(types).toEqual(['BATTLE', 'MARCH_REINFORCED']);
    const report = battles(events)[0];
    expect(target.garrison).toBe((report?.attackerTroops ?? 0) - (report?.attackerLost ?? 0) + 10);
  });

  it('ignores an arrival for a march that no longer exists', () => {
    const state = game();
    const events: DomainEvent[] = [];
    arriveMarch(state, 12345, T0, events);
    expect(events).toEqual([]);
  });

  it('moves the capital when it falls and lights a beacon when a zone is completed', () => {
    const state = game({ config: QUIET });
    const capital = capitalOf(state, 'h1');
    const [x, y] = neutralsBeside(state, capital);
    if (!x || !y) throw new Error('need two neutrals');
    give(state, x, 'h1', 5);
    give(state, y, 'h2', 200);
    capital.garrison = 0;
    const march = send(state, 'h2', y, capital, 100);
    const events = advanceTo(state, march.arriveAt);
    expect(capital.owner).toBe('h2');
    expect(capital.isCapital).toBe(false);
    expect(x.isCapital).toBe(true);
    expect(lord(state, 'h1').capitalId).toBe(x.id);
    expect(events).toContainEqual({ type: 'CAPITAL_MOVED', at: march.arriveAt, lordId: 'h1', townId: x.id });
    expect(lord(state, 'h1').stats.townsLost).toBe(1);

    x.garrison = 0;
    const zone = state.zones[x.zoneId ?? -1];
    if (!zone) throw new Error('no zone');
    for (const id of zone.townIds) if (id !== x.id) give(state, state.towns[id] as Town, 'h2', 1);
    const last = send(state, 'h2', capital, x, capital.garrison, march.arriveAt);
    const more = advanceTo(state, last.arriveAt);
    expect(zone.beaconOwner).toBe('h2');
    expect(more).toContainEqual({
      type: 'BEACON_CHANGED',
      at: last.arriveAt,
      zoneId: zone.id,
      owner: 'h2',
    });
  });
});

describe('exile and elimination', () => {
  function conquer(state: GameState): { events: DomainEvent[]; at: number } {
    const capital = capitalOf(state, 'h1');
    const base = firstNeutral(state, capital);
    give(state, base, 'h2', 300);
    capital.garrison = 0;
    const march = send(state, 'h2', base, capital, 100);
    return { events: advanceTo(state, march.arriveAt), at: march.arriveAt };
  }

  it('restarts a lord without towns on a free public town of the newest isle', () => {
    const state = game({ config: QUIET });
    const { events } = conquer(state);
    const exiled = events.find((e) => e.type === 'LORD_EXILED');
    if (!exiled || exiled.type !== 'LORD_EXILED') throw new Error('not exiled');
    const town = state.towns[exiled.townId];
    expect(town?.owner).toBe('h1');
    expect(town?.isCapital).toBe(true);
    expect(town?.garrison).toBe(state.config.exile.troops);
    expect(town?.isleId).toBe(state.isles.length - 1);
    expect(town?.privateTo).toBeNull();
    expect(lord(state, 'h1')).toMatchObject({ alive: true, exiles: 1, capitalId: exiled.townId });
  });

  it('falls back to an older isle when the newest has no free town', () => {
    const state = game({ config: { ...QUIET, map: { growth: { maxPerDay: 1 } } } });
    growTo(state, 2);
    for (const id of state.isles[1]?.townIds ?? []) give(state, state.towns[id] as Town, 'h2', 1);
    const { events } = conquer(state);
    expect(events.some((e) => e.type === 'MAP_EXPANDED')).toBe(false);
    expect(state.isles).toHaveLength(2);
    const exiled = events.find((e) => e.type === 'LORD_EXILED');
    if (!exiled || exiled.type !== 'LORD_EXILED') throw new Error('not exiled');
    const town = state.towns[exiled.townId];
    expect(town?.isleId).toBe(0);
    expect(town?.isThrone).toBe(false);
  });

  it('waits for marches in flight before exiling', () => {
    const state = game({ config: QUIET });
    const capital = capitalOf(state, 'h1');
    const far = townAcrossLane(state, capital);
    const probe = send(state, 'h1', capital, far, 10);
    const { events, at } = conquer(state);
    expect(probe.arriveAt).toBeGreaterThan(at);
    expect(events.some((e) => e.type === 'LORD_EXILED')).toBe(false);
    const later = advanceTo(state, probe.arriveAt);
    expect(later.some((e) => e.type === 'LORD_EXILED')).toBe(true);
  });

  it('makes the first town taken by a lord without a capital its new capital', () => {
    const state = game({ config: QUIET });
    const capital = capitalOf(state, 'h1');
    const prize = neutralsBeside(state, capital).at(-1) as Town;
    prize.garrison = 0;
    prize.tier = 1;
    const raid = send(state, 'h1', capital, prize, 30);
    const { at } = conquer(state);
    expect(at).toBeLessThan(raid.arriveAt);
    expect(lord(state, 'h1').capitalId).toBeNull();
    const events = advanceTo(state, raid.arriveAt);
    expect(prize).toMatchObject({ owner: 'h1', isCapital: true });
    expect(events).toContainEqual({
      type: 'CAPITAL_MOVED',
      at: raid.arriveAt,
      lordId: 'h1',
      townId: prize.id,
    });
  });

  it('eliminates the lord when exile is off', () => {
    const state = game({ config: { ...QUIET, exile: { enabled: false } } });
    const { events } = conquer(state);
    expect(events.some((e) => e.type === 'LORD_ELIMINATED')).toBe(true);
    expect(lord(state, 'h1')).toMatchObject({ alive: false, capitalId: null });
    const result = execute(state, 'h1', { type: 'LEARN_SKILL', skill: 'GOLD' }, T0 + 10 * MIN);
    expect(result.ok ? null : result.error.rule).toBe('R01');
  });
});

describe('season clock', () => {
  it('shifts the wind, unseals the Throne and ends with frozen standings', () => {
    const state = game();
    const events = advanceTo(state, state.endsAt);
    const shifts = events.filter((e) => e.type === 'WIND_SHIFTED');
    expect(shifts).toHaveLength(state.windDirs.length - 1);
    expect(events.filter((e) => e.type === 'THRONE_UNSEALED')).toHaveLength(0);
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
    const march = send(state, 'h1', capital, target, 1, T0 + 5 * MIN);
    expect(march.departAt).toBe(T0 + 30 * MIN);
  });
});
