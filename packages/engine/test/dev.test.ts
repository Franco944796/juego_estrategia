import { describe, expect, it } from 'vitest';
import { devAction } from '../src/dev';
import { computeStandings, execute } from '../src/game';
import { view } from '../src/view';
import { capitalOf, game, neutralsBeside, T0 } from './helpers';

describe('test accounts', () => {
  it('need to be enabled first, then upgrade for free and leave the standings', () => {
    const state = game();
    const home = capitalOf(state, 'h1');
    expect(devAction(state, 'h1', { type: 'LEVELS', levels: 1 }, T0).ok).toBe(false);
    expect(devAction(state, 'h1', { type: 'NOPE' }, T0).ok).toBe(false);
    expect(devAction(state, 'ghost', { type: 'ENABLE', on: true }, T0).ok).toBe(false);
    expect(devAction(state, 'h1', { type: 'ENABLE', on: true }, T0).ok).toBe(true);
    expect(view(state, 'h1', T0).me.dev).toBe(true);
    expect(computeStandings(state, T0).map((s) => s.lordId)).not.toContain('h1');

    const gold = state.lords.h1?.gold ?? 0;
    const start = home.tier;
    expect(execute(state, 'h1', { type: 'UPGRADE', townId: home.id, levels: 20 }, T0).ok).toBe(true);
    expect(home.tier).toBe(start + 20);
    expect(state.lords.h1?.gold).toBe(gold);
    expect(view(state, 'h1', T0).towns.find((t) => t.id === home.id)?.own?.upgradeMax.levels).toBe(
      state.config.towns.maxTier - start - 20,
    );
  });

  it('add troops to own towns only and levels up to the maximum', () => {
    const state = game();
    const home = capitalOf(state, 'h1');
    const neutral = neutralsBeside(state, home)[0];
    if (!neutral) throw new Error('no neutral');
    devAction(state, 'h1', { type: 'ENABLE', on: true }, T0);
    const before = home.garrison;
    expect(devAction(state, 'h1', { type: 'TROOPS', townId: home.id, amount: 500 }, T0).ok).toBe(true);
    expect(home.garrison).toBe(before + 500);
    expect(devAction(state, 'h1', { type: 'TROOPS', townId: neutral.id, amount: 500 }, T0).ok).toBe(false);
    expect(devAction(state, 'h1', { type: 'TROOPS', townId: home.id, amount: 0.5 }, T0).ok).toBe(false);
    const result = devAction(state, 'h1', { type: 'LEVELS', levels: 1000 }, T0);
    expect(result.ok).toBe(true);
    expect(state.lords.h1?.level).toBe(state.config.levels.maxLevel);
    expect(result.events.some((e) => e.type === 'LEVEL_UP')).toBe(true);
    expect(devAction(state, 'h1', { type: 'ENABLE', on: false }, T0).ok).toBe(true);
    expect(computeStandings(state, T0).map((s) => s.lordId)).toContain('h1');
  });
});
