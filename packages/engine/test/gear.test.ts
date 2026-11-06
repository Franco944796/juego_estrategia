import { describe, expect, it } from 'vitest';
import { botTurn } from '../src/bots';
import { fortification, townRates, townWalls, wallsAt } from '../src/economy';
import { execute } from '../src/game';
import { grantItem } from '../src/gear';
import { travelInfo } from '../src/marches';
import { lordMods } from '../src/modifiers';
import type { DomainEvent, Item, LordInit } from '../src/types';
import { view } from '../src/view';
import { gainXp, xpForLevel } from '../src/world';
import { bots, capitalOf, game, humans, lord, neutralsBeside, T0 } from './helpers';

const sword: Item = { id: 'sword', slot: 'WEAPON', rarity: 'EPIC' };

function withItems(items: Item[], gear: LordInit['gear'] = {}) {
  const [h1, h2] = humans(2) as [LordInit, LordInit];
  return game({ lords: [{ ...h1, items, gear }, h2] });
}

function xpUpTo(state: ReturnType<typeof game>, level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpForLevel(state, l);
  return total;
}

describe('items found by leveling up', () => {
  it('drops one item every 5 levels, with ids unique per season, lord and level', () => {
    const state = game();
    const events: DomainEvent[] = [];
    gainXp(state, lord(state, 'h1'), xpUpTo(state, 12), T0, events);
    const found = events.flatMap((e) => (e.type === 'ITEM_FOUND' ? [e] : []));
    const prefix = `${T0.toString(36)}-${state.seed.toString(36)}-h1`;
    expect(found.map((e) => e.item.id)).toEqual([`${prefix}-5`, `${prefix}-10`]);
    expect(found.every((e) => e.source === 'LEVEL')).toBe(true);
    expect(lord(state, 'h1').items).toEqual(found.map((e) => e.item));
    expect(lord(state, 'h1').gear).toEqual({});
  });

  it('rolls the rarity with the odds of the level reached', () => {
    const state = game({
      config: {
        gear: {
          dropOdds: [
            { minLevel: 1, weights: [1, 0, 0, 0] },
            { minLevel: 10, weights: [0, 0, 0, 1] },
          ],
        },
      },
    });
    gainXp(state, lord(state, 'h1'), xpUpTo(state, 10), T0, []);
    expect(lord(state, 'h1').items.map((i) => i.rarity)).toEqual(['COMMON', 'LEGENDARY']);
  });

  it('is deterministic per seed', () => {
    const roll = (seed: number) => {
      const state = game({ seed });
      const events: DomainEvent[] = [];
      gainXp(state, lord(state, 'h1'), xpUpTo(state, 60), T0, events);
      return { items: lord(state, 'h1').items, found: events.filter((e) => e.type === 'ITEM_FOUND').length };
    };
    expect(roll(3)).toEqual(roll(3));
    // Twelve finds; repeated ones joined an owned item as copies.
    const { items, found } = roll(3);
    expect(found).toBe(12);
    const levels = items.reduce((sum, item) => sum + (item.level ?? 1) - 1, 0);
    const copies = items.reduce((sum, item) => sum + (item.copies ?? 0), 0);
    expect(items.length + copies + levels * 2).toBeGreaterThanOrEqual(12);
    expect(items.length).toBeLessThanOrEqual(12);
  });
});

describe('equipping', () => {
  it('equips only owned items, one per slot, and shows them in the view', () => {
    const helm: Item = { id: 'helm', slot: 'HELMET', rarity: 'COMMON' };
    const state = withItems([sword, helm]);
    expect(execute(state, 'h1', { type: 'EQUIP', itemId: 'ghost' }, T0)).toMatchObject({
      ok: false,
      error: { rule: 'R16', code: 'NO_ITEM' },
    });
    expect(execute(state, 'h1', { type: 'EQUIP', itemId: 7 }, T0)).toMatchObject({
      error: { code: 'BAD_COMMAND' },
    });
    const done = execute(state, 'h1', { type: 'EQUIP', itemId: 'sword' }, T0);
    expect(done.events).toEqual([{ type: 'ITEM_EQUIPPED', at: T0, lordId: 'h1', item: sword }]);
    execute(state, 'h1', { type: 'EQUIP', itemId: 'helm' }, T0);
    expect(lord(state, 'h1').gear).toEqual({ WEAPON: 'sword', HELMET: 'helm' });
    expect(view(state, 'h1', T0).me).toMatchObject({
      items: [sword, helm],
      gear: { WEAPON: 'sword', HELMET: 'helm' },
      gearBonus: { COMMON: 0.03, RARE: 0.06, EPIC: 0.1, LEGENDARY: 0.15 },
    });
  });

  it('brings the account items into the season and keeps only valid gear', () => {
    const state = withItems([sword], { WEAPON: 'sword', RING: 'sword', BOOTS: 'nothing' });
    expect(lord(state, 'h1')).toMatchObject({ items: [sword], gear: { WEAPON: 'sword' } });
  });

  it('gives each slot its own bonus, added to the skills', () => {
    const items: Item[] = [
      { id: 'w', slot: 'WEAPON', rarity: 'LEGENDARY' },
      { id: 'a', slot: 'ARMOR', rarity: 'EPIC' },
      { id: 'h', slot: 'HELMET', rarity: 'RARE' },
      { id: 'c', slot: 'CLOAK', rarity: 'COMMON' },
      { id: 'b', slot: 'BOOTS', rarity: 'EPIC' },
      { id: 'r', slot: 'RING', rarity: 'RARE' },
    ];
    const gear = Object.fromEntries(items.map((i) => [i.slot, i.id]));
    const state = withItems(items, gear);
    lord(state, 'h1').skills = { GOLD: 2, TROOPS: 0, ATTACK: 1 };
    const mods = lordMods(state, 'h1');
    expect(mods.attack).toBeCloseTo(1.2, 12);
    expect(mods.defense).toBeCloseTo(1.1, 12);
    expect(mods.walls).toBeCloseTo(1.06, 12);
    expect(mods.troopProd).toBeCloseTo(1.03, 12);
    expect(mods.speed).toBeCloseTo(1.1, 12);
    expect(mods.goldProd).toBeCloseTo(1.16, 12);

    const capital = capitalOf(state, 'h1');
    expect(townWalls(state, capital)).toBe(wallsAt(state.config, capital.tier, 1.06));
    expect(townRates(state, capital).gold).toBeCloseTo(7.5 * 1.16, 9);
    expect(fortification(state, capital)).toBeCloseTo(1.05 * 1.75, 12);
    const target = neutralsBeside(state, capital)[0];
    if (!target) throw new Error('no neutral');
    const plain = travelInfo(state, 'h2', capitalOf(state, 'h2'), target, 1, T0);
    const swift = travelInfo(state, 'h1', capitalOf(state, 'h2'), target, 1, T0);
    expect(swift.durationMs).toBeLessThan(plain.durationMs);
  });
});

describe('the Legacy shop', () => {
  it('adds a bought item once, and nothing for an unknown lord', () => {
    const state = game();
    expect(grantItem(state, 'h1', sword, T0)).toEqual([
      { type: 'ITEM_FOUND', at: T0, lordId: 'h1', item: sword, source: 'SHOP' },
    ]);
    expect(grantItem(state, 'h1', sword, T0)).toEqual([]);
    expect(grantItem(state, 'ghost', sword, T0)).toEqual([]);
    expect(lord(state, 'h1').items).toEqual([sword]);
  });
});

describe('bots and gear', () => {
  it('wear the best item of each slot', () => {
    const [b1] = bots(1) as [LordInit];
    const items: Item[] = [
      { id: 'w1', slot: 'WEAPON', rarity: 'COMMON' },
      { id: 'w2', slot: 'WEAPON', rarity: 'EPIC' },
      { id: 'r1', slot: 'RING', rarity: 'RARE' },
    ];
    const state = game({ lords: [...humans(1), { ...b1, personality: 'WARDEN', items }] });
    botTurn(state, 'b1', T0, []);
    expect(lord(state, 'b1').gear).toEqual({ WEAPON: 'w2', RING: 'r1' });
  });
});
