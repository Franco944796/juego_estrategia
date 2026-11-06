import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { Store } from '../src/store';
import { clock, config, world } from './helpers';

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('items in accounts', () => {
  it('stack shop duplicates as copies and keep levels and scrap from the season', async () => {
    const store = new Store(':memory:');
    const c = clock();
    const w = world(store, c);
    app = await buildApp({ store, worlds: [w], config, now: c.now, viewEveryMs: 60_000 });
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { name: 'Ana' } });
    const { token, account } = res.json() as { token: string; account: { id: string } };
    const auth = { authorization: `Bearer ${token}` };
    const buy = (rarity: string) =>
      app?.inject({
        method: 'POST',
        url: '/api/items/buy',
        headers: auth,
        payload: { slot: 'RING', rarity },
      });

    // Not in a season yet: legacy is 0, so give some first.
    const saved = store.account(account.id);
    if (!saved) throw new Error('no account');
    store.saveAccount({ ...saved, legacy: 1000 });
    await buy('COMMON');
    await buy('COMMON');
    await buy('RARE');
    expect(store.account(account.id)?.items.map((i) => [i.rarity, i.copies ?? 0])).toEqual([
      ['COMMON', 1],
      ['RARE', 0],
    ]);

    await app.inject({ method: 'POST', url: '/api/join', headers: auth });
    const rare = store.account(account.id)?.items.find((i) => i.rarity === 'RARE');
    if (!rare) throw new Error('no rare ring');
    expect(w.command(account.id, { type: 'DESTROY_ITEM', itemId: rare.id }).ok).toBe(true);
    const common = store.account(account.id)?.items[0];
    if (!common) throw new Error('no common ring');
    expect(w.command(account.id, { type: 'UPGRADE_ITEM', itemId: common.id }).ok).toBe(true);
    const after = store.account(account.id);
    // A rare gives 25; one level costs 20.
    expect(after?.scrap).toBe(5);
    expect(after?.items).toHaveLength(1);
    expect(after?.items[0]).toMatchObject({ level: 2, scrap: 20 });
  });
});
