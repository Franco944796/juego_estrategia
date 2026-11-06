import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LordView } from '@si/engine';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app';
import { Store } from '../src/store';
import { clock, config, world } from './helpers';

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

type Message = { type: string; id?: number; view?: LordView; error?: unknown };

/** Opens a socket and resolves the first message that matches. */
function waitFor(socket: WebSocket, match: (m: Message) => boolean): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), 3000);
    socket.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as Message;
      if (!match(m)) return;
      clearTimeout(timer);
      resolve(m);
    });
  });
}

describe('test accounts', () => {
  it('get free upgrades, troops, levels and Legacy, stay out of the ranking, and survive a restart', async () => {
    const store = new Store(':memory:');
    const c = clock();
    const w = world(store, c);
    const devFile = join(mkdtempSync(join(tmpdir(), 'si-dev-')), 'dev-accounts.txt');
    writeFileSync(devFile, '# test accounts\n');
    app = await buildApp({
      store,
      worlds: [w],
      config,
      now: c.now,
      viewEveryMs: 60_000,
      devAccountsPath: devFile,
    });
    const session = async (name: string): Promise<string> => {
      const res = await app?.inject({ method: 'POST', url: '/api/session', payload: { name } });
      return (res?.json() as { token: string }).token;
    };
    const ana = await session('Ana');
    const bo = await session('Bo');
    writeFileSync(devFile, `# test accounts\n${ana}  # Ana\n`);
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    await app.inject({ method: 'POST', url: '/api/join', headers: auth(ana) });
    await app.inject({ method: 'POST', url: '/api/join', headers: auth(bo) });
    const [anaId, boId] = Object.keys(w.gameState.lords);
    if (!anaId || !boId) throw new Error('lords missing');
    expect(w.gameState.lords[anaId]?.dev).toBe(true);
    expect(w.standings().map((s) => s.lordId)).toEqual([boId]);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(ana) });
    expect(me.json()).toMatchObject({ account: { dev: true, legacy: 0 } });
    const bought = await app.inject({
      method: 'POST',
      url: '/api/items/buy',
      headers: auth(ana),
      payload: { slot: 'WEAPON', rarity: 'LEGENDARY' },
    });
    expect(bought.statusCode).toBe(200);
    const refused = await app.inject({
      method: 'POST',
      url: '/api/items/buy',
      headers: auth(bo),
      payload: { slot: 'WEAPON', rarity: 'LEGENDARY' },
    });
    expect(refused.statusCode).toBe(409);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${ana}`);
    const first = await waitFor(socket, (m) => m.type === 'view');
    expect(first.view?.me.dev).toBe(true);
    const capitalId = first.view?.me.capitalId ?? -1;
    const send = (id: number, payload: object) => socket.send(JSON.stringify({ id, ...payload }));

    send(1, { type: 'dev', action: { type: 'LEVELS', levels: 3 } });
    expect(await waitFor(socket, (m) => m.type === 'result' && m.id === 1)).toMatchObject({ error: null });
    send(2, { type: 'dev', action: { type: 'TROOPS', townId: capitalId, amount: 1_000_000 } });
    expect(await waitFor(socket, (m) => m.type === 'result' && m.id === 2)).toMatchObject({ error: null });
    send(3, { type: 'command', command: { type: 'UPGRADE', townId: capitalId, levels: 99 } });
    expect(await waitFor(socket, (m) => m.type === 'result' && m.id === 3)).toMatchObject({ error: null });
    const lord = w.gameState.lords[anaId];
    expect(lord?.level).toBe(4);
    expect(w.gameState.towns[capitalId]?.tier).toBe(config.towns.maxTier);
    expect(w.gameState.towns[capitalId]?.garrison).toBeGreaterThanOrEqual(1_000_000);
    socket.close();

    const boSocket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${bo}`);
    await waitFor(boSocket, (m) => m.type === 'view');
    boSocket.send(JSON.stringify({ id: 4, type: 'dev', action: { type: 'LEVELS', levels: 3 } }));
    expect(await waitFor(boSocket, (m) => m.type === 'result' && m.id === 4)).toMatchObject({
      error: { code: 'DEV_REJECTED' },
    });
    boSocket.close();

    // The log replays the test tools after a restart.
    const again = world(store, c);
    expect(again.gameState.lords[anaId]).toMatchObject({ dev: true, level: 4 });
    expect(again.gameState.towns[capitalId]?.tier).toBe(config.towns.maxTier);
  });
});
