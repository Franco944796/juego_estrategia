import { describe, expect, it } from 'vitest';
import { execute } from '../src/game';
import { grantItem, itemBonus, stockItem } from '../src/gear';
import type { Item, LordInit } from '../src/types';
import { view } from '../src/view';
import { game, humans, lord, T0 } from './helpers';

function withItems(items: Item[], gear: LordInit['gear'] = {}, scrap = 0) {
  const [h1, h2] = humans(2) as [LordInit, LordInit];
  return game({ lords: [{ ...h1, items, gear, scrap }, h2] });
}

const ring = (id: string, rarity: Item['rarity'] = 'RARE'): Item => ({ id, slot: 'RING', rarity });

describe('item copies', () => {
  it('stack duplicates as copies and level up every 2 × level of them', () => {
    const state = game();
    const cfg = state.config;
    const items: Item[] = [];
    expect(stockItem(cfg, items, ring('a'))).toBeNull();
    for (let i = 0; i < 2; i++) stockItem(cfg, items, ring(`b${i}`));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'a', level: 2, copies: 0 });
    for (let i = 0; i < 5; i++) stockItem(cfg, items, ring(`c${i}`));
    expect(items[0]).toMatchObject({ level: 3, copies: 1 });
    // Another rarity or slot is not a duplicate.
    stockItem(cfg, items, ring('d', 'EPIC'));
    expect(items).toHaveLength(2);
  });

  it('keep chests and top-level items apart, so they can be destroyed for scrap', () => {
    const state = game();
    const cfg = state.config;
    const chests: Item[] = [];
    stockItem(cfg, chests, { id: 'c1', slot: 'CHEST', rarity: 'RARE' });
    stockItem(cfg, chests, { id: 'c2', slot: 'CHEST', rarity: 'RARE' });
    expect(chests).toHaveLength(2);
    const top: Item[] = [{ ...ring('t'), level: cfg.gear.maxItemLevel }];
    stockItem(cfg, top, ring('u'));
    expect(top).toHaveLength(2);
  });

  it('join a shop item to the owned one and say so in the event', () => {
    const state = withItems([ring('a')]);
    const events = grantItem(state, 'h1', ring('b'), T0);
    expect(events[0]).toMatchObject({ type: 'ITEM_FOUND', source: 'SHOP', into: { id: 'a', copies: 1 } });
    expect(lord(state, 'h1').items).toHaveLength(1);
  });
});

describe('scrap', () => {
  it('comes from destroying unequipped items and buys levels at 20 × level', () => {
    const state = withItems([ring('worn', 'LEGENDARY'), { ...ring('spare', 'COMMON'), scrap: 40 }], {
      RING: 'worn',
    });
    const refused = execute(state, 'h1', { type: 'DESTROY_ITEM', itemId: 'worn' }, T0);
    expect(refused.ok ? null : refused.error.code).toBe('ITEM_EQUIPPED');
    expect(execute(state, 'h1', { type: 'DESTROY_ITEM', itemId: 'spare' }, T0).ok).toBe(true);
    // A common gives 10, plus half the 40 put into it.
    expect(lord(state, 'h1').scrap).toBe(30);
    expect(lord(state, 'h1').items.map((i) => i.id)).toEqual(['worn']);

    const poor = execute(state, 'h1', { type: 'UPGRADE_ITEM', itemId: 'worn' }, T0);
    expect(poor.ok).toBe(true);
    expect(lord(state, 'h1').scrap).toBe(10);
    const worn = lord(state, 'h1').items[0] as Item;
    expect(worn).toMatchObject({ level: 2, scrap: 20 });
    // Legendary: +15 % and +5 % a level.
    expect(itemBonus(state, worn)).toBeCloseTo(0.2);
    const broke = execute(state, 'h1', { type: 'UPGRADE_ITEM', itemId: 'worn' }, T0);
    expect(broke.ok ? null : broke.error.code).toBe('NO_SCRAP');
    expect(view(state, 'h1', T0).me.scrap).toBe(10);
  });

  it('never levels the chest nor goes past the top level; a test lord pays nothing', () => {
    const top = { ...ring('top'), level: 20 };
    const state = withItems([{ id: 'box', slot: 'CHEST', rarity: 'EPIC' }, top], {}, 1000);
    const chest = execute(state, 'h1', { type: 'UPGRADE_ITEM', itemId: 'box' }, T0);
    expect(chest.ok ? null : chest.error.code).toBe('CHEST_FIXED');
    const max = execute(state, 'h1', { type: 'UPGRADE_ITEM', itemId: 'top' }, T0);
    expect(max.ok ? null : max.error.code).toBe('MAX_ITEM_LEVEL');
    const missing = execute(state, 'h1', { type: 'UPGRADE_ITEM', itemId: 'nope' }, T0);
    expect(missing.ok ? null : missing.error.code).toBe('NO_ITEM');
    const gone = execute(state, 'h1', { type: 'DESTROY_ITEM', itemId: 'nope' }, T0);
    expect(gone.ok ? null : gone.error.code).toBe('NO_ITEM');

    const dev = withItems([ring('r')]);
    lord(dev, 'h1').dev = true;
    expect(execute(dev, 'h1', { type: 'UPGRADE_ITEM', itemId: 'r' }, T0).ok).toBe(true);
    expect(lord(dev, 'h1').scrap).toBe(0);
    expect(lord(dev, 'h1').items[0]?.level).toBe(2);
  });
});
