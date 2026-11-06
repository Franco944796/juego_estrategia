import { describe, expect, it } from 'vitest';
import { advanceTo, execute } from '../src/game';
import { activeAttacks } from '../src/marches';
import { view } from '../src/view';
import { capitalOf, game, neutralsBeside, T0 } from './helpers';

describe('scouting', () => {
  it('reports the defense of a capital without fighting, and the scout is lost', () => {
    const state = game();
    const home = capitalOf(state, 'h1');
    const enemy = capitalOf(state, 'h2');
    home.garrison = 50;
    enemy.garrison = 30;
    const result = execute(state, 'h1', { type: 'SCOUT', from: home.id, to: enemy.id }, T0);
    expect(result.ok).toBe(true);
    expect(home.garrison).toBe(49);
    const march = state.marches.find((m) => m.scout);
    if (!march) throw new Error('no scout');
    expect(march.troops).toBe(1);
    expect(march.attack).toBe(false);
    expect(activeAttacks(state, 'h1')).toBe(0);
    expect(view(state, 'h2', T0).marches.find((m) => m.id === march.id)?.incoming).toBe(false);

    const events = advanceTo(state, march.arriveAt);
    expect(events.some((e) => e.type === 'BATTLE')).toBe(false);
    const scouted = events.find((e) => e.type === 'SCOUTED');
    if (!scouted || scouted.type !== 'SCOUTED') throw new Error('no scout report');
    const report = scouted.report;
    expect(report.owner).toBe('h2');
    expect(report.troops).toBe(enemy.garrison);
    expect(report.defense).toBeCloseTo(report.troops * report.defenseMult + report.walls);
    expect(enemy.owner).toBe('h2');
    expect(state.marches).toHaveLength(0);

    const mine = view(state, 'h1', march.arriveAt).scouts[0];
    expect(mine?.troops).toBe(report.troops);
    expect(mine?.defense).toBe(report.defense);
    const theirs = view(state, 'h2', march.arriveAt).scouts[0];
    expect(theirs?.scout).toBe('h1');
    expect(theirs?.troops).toBeNull();
    expect(theirs?.defense).toBeNull();
  });

  it('scouts neutral towns but not own ones, and needs a troop', () => {
    const state = game();
    const home = capitalOf(state, 'h1');
    const neutral = neutralsBeside(state, home)[0];
    if (!neutral) throw new Error('no neutral');
    home.garrison = 0;
    const empty = execute(state, 'h1', { type: 'SCOUT', from: home.id, to: neutral.id }, T0);
    expect(empty.ok ? null : empty.error.code).toBe('NOT_ENOUGH_TROOPS');
    home.garrison = 5;
    expect(execute(state, 'h1', { type: 'SCOUT', from: home.id, to: neutral.id }, T0).ok).toBe(true);
    neutral.owner = 'h1';
    const own = execute(state, 'h1', { type: 'SCOUT', from: home.id, to: neutral.id }, T0);
    expect(own.ok ? null : own.error.code).toBe('NOT_FOREIGN');
  });
});
