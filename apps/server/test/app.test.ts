import type { AddressInfo } from 'node:net';
import type { DomainEvent, LordView } from '@si/engine';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp, eventsFor } from '../src/app';
import { Store } from '../src/store';
import type { WorldService } from '../src/world';
import { clock, config, world } from './helpers';

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function start() {
  const store = new Store(':memory:');
  const c = clock();
  const w = world(store, c);
  app = await buildApp({ store, world: w, config, now: c.now, viewEveryMs: 60_000 });
  return { store, w, c, app };
}

async function session(a: FastifyInstance, name: string): Promise<string> {
  const res = await a.inject({ method: 'POST', url: '/api/session', payload: { name } });
  return (res.json() as { token: string }).token;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

type Message = { type: string; [key: string]: unknown };

class Client {
  readonly messages: Message[] = [];
  private waiters: { match: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];
  readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as Message;
      this.messages.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(message)) return true;
        w.resolve(message);
        return false;
      });
    });
  }

  next(match: (m: Message) => boolean, timeoutMs = 3000): Promise<Message> {
    const seen = this.messages.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeoutMs);
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }
}

describe('REST API', () => {
  it('creates guest sessions and rejects bad names or tokens', async () => {
    const { app: a } = await start();
    expect((await a.inject({ method: 'POST', url: '/api/session', payload: { name: 'x' } })).statusCode).toBe(
      400,
    );
    const token = await session(a, '  Ana  ');
    expect((await a.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const me = await a.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(me.json()).toMatchObject({ account: { name: 'Ana', legacy: 0, style: 'classic' }, joined: false });
    expect((await a.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ ok: true });
  });

  it('joins the world once', async () => {
    const { app: a, w } = await start();
    const token = await session(a, 'Ana');
    expect((await a.inject({ method: 'POST', url: '/api/join', headers: auth(token) })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: '/api/join', headers: auth(token) })).statusCode).toBe(200);
    expect(Object.keys(w.gameState.lords)).toHaveLength(1);
    expect((await a.inject({ method: 'POST', url: '/api/join' })).statusCode).toBe(401);
  });

  it('sells items for Legacy and hands them to the running season', async () => {
    const { app: a, store, w } = await start();
    const token = await session(a, 'Ana');
    await a.inject({ method: 'POST', url: '/api/join', headers: auth(token) });
    const buy = (payload: Record<string, string>) =>
      a.inject({ method: 'POST', url: '/api/items/buy', headers: auth(token), payload });
    expect((await a.inject({ method: 'POST', url: '/api/items/buy', payload: {} })).statusCode).toBe(401);
    expect((await buy({ slot: 'WEAPON', rarity: 'EPIC' })).json()).toEqual({ error: 'NOT_ENOUGH_LEGACY' });
    expect((await buy({ slot: 'TAIL', rarity: 'EPIC' })).statusCode).toBe(400);
    const me = (await a.inject({ method: 'GET', url: '/api/me', headers: auth(token) })).json() as {
      account: { id: string };
    };
    const account = store.account(me.account.id);
    if (!account) throw new Error('no account');
    account.legacy = 130;
    store.saveAccount(account);
    const bought = (await buy({ slot: 'WEAPON', rarity: 'EPIC' })).json() as {
      account: { legacy: number; items: unknown[] };
      item: { id: string; slot: string; rarity: string };
    };
    expect(bought.account.legacy).toBe(10);
    expect(bought.item).toMatchObject({ slot: 'WEAPON', rarity: 'EPIC' });
    expect(bought.account.items).toEqual([bought.item]);
    expect(w.gameState.lords[account.id]?.items).toEqual([bought.item]);
    expect(w.command(account.id, { type: 'EQUIP', itemId: bought.item.id }).ok).toBe(true);
    expect(store.account(account.id)?.gear).toEqual({ WEAPON: bought.item.id });
  });

  it('unlocks styles with Legacy and equips only owned ones', async () => {
    const { app: a, store, w } = await start();
    const token = await session(a, 'Ana');
    await a.inject({ method: 'POST', url: '/api/join', headers: auth(token) });
    const unlock = (style: string) =>
      a.inject({ method: 'POST', url: '/api/styles/unlock', headers: auth(token), payload: { style } });
    const equip = (style: string) =>
      a.inject({ method: 'POST', url: '/api/styles/equip', headers: auth(token), payload: { style } });
    expect((await unlock('tower')).json()).toEqual({ error: 'NOT_ENOUGH_LEGACY' });
    expect((await unlock('nope')).statusCode).toBe(400);
    expect((await equip('tower')).statusCode).toBe(409);
    const me = (await a.inject({ method: 'GET', url: '/api/me', headers: auth(token) })).json() as {
      account: { id: string };
    };
    const account = store.account(me.account.id);
    if (!account) throw new Error('no account');
    account.legacy = 40;
    store.saveAccount(account);
    expect((await unlock('tower')).json()).toMatchObject({
      account: { legacy: 10, styles: ['classic', 'tower'] },
    });
    expect((await unlock('tower')).json()).toEqual({ error: 'ALREADY_OWNED' });
    expect((await equip('tower')).json()).toMatchObject({ account: { style: 'tower' } });
    expect(w.gameState.lords[account.id]?.style).toBe('tower');
  });

  it('lists the hall of fame', async () => {
    const { app: a } = await start();
    expect((await a.inject({ method: 'GET', url: '/api/hall' })).json()).toMatchObject({
      current: { id: 1 },
      seasons: [],
    });
  });
});

describe('WebSocket', () => {
  async function online() {
    const env = await start();
    await env.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (env.app.server.address() as AddressInfo).port;
    const connect = (token?: string) =>
      new Client(`ws://127.0.0.1:${port}/ws${token ? `?token=${token}` : ''}`);
    return { ...env, connect };
  }

  function town(w: WorldService, lordId: string) {
    const state = w.gameState;
    const capital = state.towns[state.lords[lordId]?.capitalId ?? -1];
    const neighbor = state.towns.find((t) => t.isleId === capital?.isleId && t.owner === null);
    if (!capital || !neighbor) throw new Error('no towns');
    return { capital, neighbor };
  }

  it('pushes views, answers commands and warns the defender of an incoming march', async () => {
    const { app: a, w, connect } = await online();
    const tokenA = await session(a, 'Ana');
    const tokenB = await session(a, 'Bo');
    await a.inject({ method: 'POST', url: '/api/join', headers: auth(tokenA) });
    await a.inject({ method: 'POST', url: '/api/join', headers: auth(tokenB) });
    const ids = Object.keys(w.gameState.lords);
    const [anaId, boId] = ids;
    if (!anaId || !boId) throw new Error('lords missing');
    const { capital, neighbor } = town(w, anaId);
    neighbor.owner = boId;
    neighbor.neutralCap = 0;

    const ana = connect(tokenA);
    const bo = connect(tokenB);
    const first = await ana.next((m) => m.type === 'view');
    expect((first.view as LordView).me.id).toBe(anaId);
    await bo.next((m) => m.type === 'view');

    ana.socket.send(
      JSON.stringify({
        type: 'command',
        id: 7,
        command: {
          type: 'SEND',
          from: capital.id,
          to: neighbor.id,
          troops: 5,
        },
      }),
    );
    expect(await ana.next((m) => m.type === 'result' && m.id === 7)).toMatchObject({ error: null });
    const warned = await bo.next((m) => m.type === 'events');
    expect((warned.events as DomainEvent[]).some((e) => e.type === 'MARCH_LAUNCHED')).toBe(true);
    const seen = await bo.next(
      (m) => m.type === 'view' && (m.view as LordView).marches.some((march) => march.incoming),
    );
    expect((seen.view as LordView).marches.find((m) => m.incoming)?.troops).toBe(5);

    ana.socket.send(
      JSON.stringify({ type: 'command', id: 8, command: { type: 'SEND', from: capital.id, to: 99999 } }),
    );
    ana.socket.send(
      JSON.stringify({
        type: 'preview',
        id: 9,
        from: capital.id,
        to: neighbor.id,
        troops: 1,
      }),
    );
    const preview = await ana.next((m) => m.type === 'preview' && m.id === 9);
    expect(preview.preview).toMatchObject({ error: null });
    expect(ana.messages.some((m) => m.id === 8)).toBe(false);
    ana.socket.close();
    bo.socket.close();
  });

  it('closes sockets without a valid token', async () => {
    const { connect } = await online();
    const stranger = connect('nope');
    const code = await new Promise<number>((resolve) => stranger.socket.on('close', (c) => resolve(c)));
    expect(code).toBe(4001);
  });
});

describe('event filtering', () => {
  it('hides battles and skills of other lords but keeps public news', async () => {
    const { w } = await start();
    const events: DomainEvent[] = [
      { type: 'WIND_SHIFTED', at: 1, dir: 2 },
      { type: 'SKILL_LEARNED', at: 1, lordId: 'other', skill: 'GOLD', points: 1 },
      {
        type: 'BATTLE',
        at: 1,
        report: {
          id: 1,
          at: 1,
          townId: 3,
          marchId: 1,
          attacker: 'x',
          defender: 'y',
          attackerTroops: 1,
          defenderTroops: 1,
          attackerPower: 1,
          defenderPower: 1,
          fort: 1,
          walls: 0,
          attackerLost: 1,
          defenderLost: 0,
          attackerRecovered: 0,
          defenderRecovered: 0,
          winner: 'DEFENDER',
          captured: false,
          plunder: 0,
          rewards: { attackerXp: 0, attackerGold: 0, defenderXp: 3, defenderGold: 3 },
          allies: [],
        },
      },
    ];
    expect(eventsFor('me', events, w.gameState).map((e) => e.type)).toEqual(['WIND_SHIFTED']);
    expect(eventsFor('y', events, w.gameState).map((e) => e.type)).toEqual(['WIND_SHIFTED', 'BATTLE']);
  });
});
