import { describe, expect, it } from 'vitest';
import { dominionRates, goldRate } from '../src/economy';
import { execute } from '../src/game';
import { gemBonuses, gemValue, stockGem } from '../src/gems';
import { lordMods } from '../src/modifiers';
import type { Gem, Item, LordInit } from '../src/types';
import { view } from '../src/view';
import { game, humans, lord, T0 } from './helpers';

const sword: Item = { id: 'sword', slot: 'WEAPON', rarity: 'EPIC' };
const ruby = (id: string, league = 2): Gem => ({ id, color: 'RUBY', league });

function withGear(items: Item[], gems: Gem[], gear: LordInit['gear'] = { WEAPON: 'sword' }) {
  const [h1, h2] = humans(2) as [LordInit, LordInit];
  return game({ lords: [{ ...h1, items, gear, gems }, h2] });
}

describe('gems', () => {
  it('are worth their league and half of it per level, and stack as copies', () => {
    const state = game();
    const cfg = state.config;
    expect(gemValue(cfg, ruby('a', 0))).toBeCloseTo(0.025);
    expect(gemValue(cfg, ruby('a', 1))).toBeCloseTo(0.05);
    expect(gemValue(cfg, { ...ruby('a'), level: 3 })).toBeCloseTo(0.2);
    const bag: Gem[] = [];
    stockGem(cfg, bag, ruby('a'));
    stockGem(cfg, bag, ruby('b'));
    stockGem(cfg, bag, ruby('c'));
    stockGem(cfg, bag, ruby('d', 0));
    expect(bag).toHaveLength(2);
    expect(bag[0]).toMatchObject({ id: 'a', level: 2, copies: 0 });
    const top: Gem[] = [{ ...ruby('t'), level: cfg.gems.maxLevel }];
    stockGem(cfg, top, ruby('u'));
    expect(top).toHaveLength(2);
  });

  it('go into free sockets of an item and only count on worn items', () => {
    const gems = [ruby('r1'), { id: 't1', color: 'TOPAZ', league: 0 } as Gem, ruby('r2', 1)];
    const state = withGear([sword, { id: 'ring', slot: 'RING', rarity: 'COMMON' }], gems);
    const before = lordMods(state, 'h1').troopProd;
    const socket = (itemId: string, gemId: string) =>
      execute(state, 'h1', { type: 'SOCKET_GEM', itemId, gemId }, T0);
    const code = (r: ReturnType<typeof execute>) => (r.ok ? null : r.error.code);
    expect(code(socket('ring', 'r1'))).toBe('NO_SOCKET');
    expect(code(socket('sword', 'nope'))).toBe('NO_GEM');
    expect(code(socket('ghost', 'r1'))).toBe('NO_ITEM');
    expect(socket('sword', 'r1').ok).toBe(true);
    expect(code(socket('sword', 'r1'))).toBe('GEM_IN_USE');
    expect(lordMods(state, 'h1').troopProd).toBeCloseTo(before + 0.1);
    expect(view(state, 'h1', T0).me.items.find((i) => i.id === 'sword')?.gems).toEqual(['r1']);

    // A gem in an item that is not worn does nothing.
    expect(execute(state, 'h1', { type: 'EQUIP', itemId: 'ring' }, T0).ok).toBe(true);
    const out = execute(state, 'h1', { type: 'UNSOCKET_GEM', itemId: 'sword', gemId: 'r1' }, T0);
    expect(out.ok).toBe(true);
    expect(code(execute(state, 'h1', { type: 'UNSOCKET_GEM', itemId: 'sword', gemId: 'r1' }, T0))).toBe(
      'NO_GEM',
    );
    expect(code(execute(state, 'h1', { type: 'UNSOCKET_GEM', itemId: 'ghost', gemId: 'r1' }, T0))).toBe(
      'NO_ITEM',
    );
    expect(lordMods(state, 'h1').troopProd).toBeCloseTo(before);
  });

  it('add gold, defense, Dominion and experience by color, and destroying the item frees them', () => {
    const gems: Gem[] = [
      { id: 'g1', color: 'TOPAZ', league: 2 },
      { id: 'g2', color: 'SAPPHIRE', league: 2 },
      { id: 'g3', color: 'AMETHYST', league: 2 },
      { id: 'g4', color: 'EMERALD', league: 2 },
    ];
    const state = withGear([{ ...sword, gems: gems.map((g) => g.id) }], gems);
    const bonus = gemBonuses(state.config, lord(state, 'h1'));
    expect(bonus).toMatchObject({ TOPAZ: 0.1, SAPPHIRE: 0.1, AMETHYST: 0.1, EMERALD: 0.1, RUBY: 0 });
    const mods = lordMods(state, 'h1');
    // The sword adds attack, so defense comes from the sapphire alone.
    expect(mods.defense).toBeCloseTo(1.1);
    expect(mods.dominion).toBeCloseTo(1.1);
    expect(mods.xp).toBeCloseTo(1.1);
    const gold = goldRate(state, 'h1');
    const dominion = dominionRates(state).get('h1') ?? 0;

    lord(state, 'h1').gear = {};
    expect(goldRate(state, 'h1')).toBeLessThan(gold);
    expect(dominionRates(state).get('h1') ?? 0).toBeLessThan(dominion);
    expect(execute(state, 'h1', { type: 'DESTROY_ITEM', itemId: 'sword' }, T0).ok).toBe(true);
    expect(lord(state, 'h1').gems).toHaveLength(4);
    expect(view(state, 'h1', T0).me.gemRules.sockets.LEGENDARY).toBe(9);
  });
});
