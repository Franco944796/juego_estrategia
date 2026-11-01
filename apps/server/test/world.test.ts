import { hashState, type DomainEvent } from '@si/engine';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { account, clock, MIN, T0, world } from './helpers';

function setup() {
  const store = new Store(':memory:');
  const c = clock();
  const w = world(store, c);
  const ana = account(store, 'ana', c);
  const bo = account(store, 'bo', c);
  w.join(ana);
  w.join(bo);
  return { store, c, w, ana, bo };
}

/** A send from Ana's capital to a neutral town on a neighboring isle. */
function attackAcross(w: ReturnType<typeof setup>['w'], lordId: string) {
  const state = w.gameState;
  const capital = state.towns[state.lords[lordId]?.capitalId ?? -1];
  if (!capital) throw new Error('no capital');
  const linked = new Set(
    state.lanes.flatMap((l) => (l.a === capital.isleId ? [l.b] : l.b === capital.isleId ? [l.a] : [])),
  );
  const target = state.towns.find((t) => linked.has(t.isleId) && t.owner === null && !t.isThrone);
  if (!target) throw new Error('no target');
  return w.command(lordId, {
    type: 'SEND',
    from: capital.id,
    to: target.id,
    troops: { LANCER: 18, ARCHER: 14, GRIFFIN: 8 },
  });
}

describe('world service', () => {
  it('starts a season and logs each join once', () => {
    const { store, w, ana } = setup();
    expect(w.currentSeason).toMatchObject({ id: 1, startsAt: T0, endsAt: T0 + 120 * MIN });
    expect(w.hasJoined(ana.id)).toBe(true);
    expect(w.join(ana)).toEqual({ ok: true });
    expect(store.logAfter(1, 0).filter((e) => e.kind === 'join')).toHaveLength(2);
  });

  it('logs only accepted commands', () => {
    const { store, w, ana } = setup();
    const capital = w.gameState.lords[ana.id]?.capitalId ?? -1;
    expect(attackAcross(w, ana.id).ok).toBe(true);
    expect(w.command(ana.id, { type: 'UPGRADE', townId: capital }).ok).toBe(false);
    expect(store.logAfter(1, 0).filter((e) => e.kind === 'command')).toHaveLength(1);
  });

  it('rebuilds the same state from snapshot and log after a restart', () => {
    const { store, c, w, ana, bo } = setup();
    c.t += 5 * MIN;
    attackAcross(w, ana.id);
    w.snapshot();
    c.t += MIN;
    attackAcross(w, bo.id);
    w.setStyle(bo.id, 'classic');
    c.t += 30 * MIN;
    w.tick();
    const restarted = world(store, c);
    restarted.tick();
    expect(hashState(restarted.gameState)).toBe(hashState(w.gameState));
  });

  it('resolves a march once after a restart in the middle of its flight', () => {
    const { store, c, w, ana } = setup();
    const sent = attackAcross(w, ana.id);
    if (!sent.ok) throw new Error(sent.error.code);
    const launched = sent.events.find((e) => e.type === 'MARCH_LAUNCHED');
    if (!launched || launched.type !== 'MARCH_LAUNCHED') throw new Error('no march');
    c.t = Math.floor((launched.march.departAt + launched.march.arriveAt) / 2);
    w.tick();
    const restarted = world(store, c);
    const seen: DomainEvent[] = [];
    restarted.onEvents((events) => seen.push(...events));
    c.t = launched.march.arriveAt + MIN;
    restarted.tick();
    restarted.tick();
    expect(seen.filter((e) => e.type === 'BATTLE' && e.report.marchId === launched.march.id)).toHaveLength(1);
  });

  it('pays Legacy, archives the season and opens the next one at the end', () => {
    const { store, c, w, ana, bo } = setup();
    const finished: number[] = [];
    w.onSeason((done) => finished.push(done.id));
    c.t = T0 + 120 * MIN + 1;
    w.tick();
    expect(finished).toEqual([1]);
    expect(w.currentSeason).toMatchObject({ id: 2, startsAt: T0 + 120 * MIN });
    expect(w.hasJoined(ana.id)).toBe(false);
    const legacy = [store.account(ana.id), store.account(bo.id)].map((a) => a?.legacy).sort();
    expect(legacy).toEqual([10, 100]);
    expect(store.account(ana.id)?.medals).toHaveLength(1);
    expect(store.finishedSeasons(5)).toHaveLength(1);
    expect(w.join(ana)).toEqual({ ok: true });
  });

  it('catches up on several missed season ends', () => {
    const { c, w } = setup();
    c.t = T0 + 3 * 120 * MIN + 5 * MIN;
    w.tick();
    expect(w.currentSeason.id).toBe(4);
    expect(w.currentSeason.startsAt).toBeLessThanOrEqual(c.t);
    expect(w.currentSeason.endsAt).toBeGreaterThan(c.t);
  });
});
