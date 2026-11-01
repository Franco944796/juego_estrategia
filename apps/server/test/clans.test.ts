import type { AddressInfo } from 'node:net';
import type { ChatMessage, MeResponse } from '@si/protocol';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app';
import { CLAN_MAX_MEMBERS } from '../src/clans';
import { Store } from '../src/store';
import { clock, config, MIN, T0, world } from './helpers';

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

type Api = (
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
) => Promise<{ status: number; body: unknown }>;

async function player(a: FastifyInstance, name: string): Promise<{ token: string; id: string; call: Api }> {
  const created = (await a.inject({ method: 'POST', url: '/api/session', payload: { name } })).json() as {
    token: string;
    account: { id: string };
  };
  const call: Api = async (method, url, payload) => {
    const res = await a.inject({
      method,
      url,
      payload: payload as object,
      headers: { authorization: `Bearer ${created.token}` },
    });
    return { status: res.statusCode, body: res.json() };
  };
  await call('POST', '/api/join');
  return { token: created.token, id: created.account.id, call };
}

async function me(p: { call: Api }): Promise<MeResponse> {
  return (await p.call('GET', '/api/me')).body as MeResponse;
}

describe('clans', () => {
  it('creates a clan, takes requests and lets officers accept them', async () => {
    const { app: a, w } = await start();
    const ana = await player(a, 'Ana');
    const bo = await player(a, 'Bo');
    const cy = await player(a, 'Cy');
    expect((await ana.call('POST', '/api/clans', { name: 'x', tag: 'SKY' })).status).toBe(400);
    const created = await ana.call('POST', '/api/clans', { name: 'Sky Wardens', tag: 'sky' });
    expect(created.body).toMatchObject({ value: { name: 'Sky Wardens', tag: 'SKY', role: 'leader' } });
    const clanId = (created.body as { value: { id: string } }).value.id;
    expect((await bo.call('POST', '/api/clans', { name: 'sky wardens', tag: 'ZZ' })).body).toEqual({
      error: 'CLAN_TAKEN',
    });
    expect(w.gameState.lords[ana.id]?.clanId).toBe(clanId);

    expect((await bo.call('POST', `/api/clans/${clanId}/requests`)).status).toBe(200);
    expect((await bo.call('POST', `/api/clans/${clanId}/requests`)).body).toEqual({
      error: 'ALREADY_REQUESTED',
    });
    expect((await cy.call('POST', `/api/clans/${clanId}/requests/${bo.id}/accept`)).status).toBe(403);
    const asLeader = (await ana.call('GET', `/api/clans/${clanId}`)).body as {
      value: { requests: unknown[] };
    };
    expect(asLeader.value.requests).toHaveLength(1);
    const asStranger = (await cy.call('GET', `/api/clans/${clanId}`)).body as {
      value: { requests: unknown[] };
    };
    expect(asStranger.value.requests).toHaveLength(0);
    expect((await ana.call('POST', `/api/clans/${clanId}/requests/${bo.id}/accept`)).status).toBe(200);
    expect((await me(bo)).clan).toMatchObject({ id: clanId, role: 'member' });
    expect(w.gameState.lords[bo.id]?.clanId).toBe(clanId);

    expect((await ana.call('POST', `/api/clan/members/${bo.id}/role`, { role: 'officer' })).status).toBe(200);
    await cy.call('POST', `/api/clans/${clanId}/requests`);
    expect((await bo.call('POST', `/api/clans/${clanId}/requests/${cy.id}/reject`)).status).toBe(200);
    expect((await me(cy)).clan).toBeNull();
    const list = (await ana.call('GET', '/api/clans?q=sky')).body as { clans: { members: number }[] };
    expect(list.clans[0]?.members).toBe(2);
  });

  it('enforces ranks for kicks and role changes, and hands the clan over when the leader leaves', async () => {
    const { app: a, w } = await start();
    const ana = await player(a, 'Ana');
    const bo = await player(a, 'Bo');
    const cy = await player(a, 'Cy');
    const clanId = (
      (await ana.call('POST', '/api/clans', { name: 'Gale', tag: 'GL' })).body as { value: { id: string } }
    ).value.id;
    for (const p of [bo, cy]) {
      await p.call('POST', `/api/clans/${clanId}/requests`);
      await ana.call('POST', `/api/clans/${clanId}/requests/${p.id}/accept`);
    }
    await ana.call('POST', `/api/clan/members/${bo.id}/role`, { role: 'officer' });
    expect((await bo.call('POST', `/api/clan/members/${ana.id}/kick`)).status).toBe(403);
    expect((await bo.call('POST', `/api/clan/members/${cy.id}/role`, { role: 'officer' })).status).toBe(403);
    expect((await bo.call('POST', `/api/clan/members/${cy.id}/kick`)).status).toBe(200);
    expect(w.gameState.lords[cy.id]?.clanId).toBeNull();
    expect((await ana.call('POST', '/api/clan/leave')).status).toBe(200);
    expect((await me(bo)).clan).toMatchObject({ role: 'leader' });
    expect((await bo.call('POST', '/api/clan/leave')).status).toBe(200);
    expect((await bo.call('GET', `/api/clans/${clanId}`)).status).toBe(404);
    expect((await bo.call('POST', '/api/clan/leave')).body).toEqual({ error: 'NOT_MEMBER' });
  });

  it('caps clans at the member limit', async () => {
    const { app: a, store } = await start();
    const ana = await player(a, 'Ana');
    const clanId = (
      (await ana.call('POST', '/api/clans', { name: 'Full House', tag: 'FH' })).body as {
        value: { id: string };
      }
    ).value.id;
    for (let i = 1; i < CLAN_MAX_MEMBERS; i++) {
      const id = `filler-${i}`;
      store.createAccount(id, `F${i}`, `hash-${i}`, 'classic', T0);
      store.addMember(clanId, id, 'member', T0);
    }
    const late = await player(a, 'Late');
    expect((await late.call('POST', `/api/clans/${clanId}/requests`)).body).toEqual({ error: 'CLAN_FULL' });
  });

  it('ranks clans by summed Dominion and awards a medal at season end', async () => {
    const { app: a, w, c, store } = await start();
    const ana = await player(a, 'Ana');
    const bo = await player(a, 'Bo');
    const clanId = (
      (await ana.call('POST', '/api/clans', { name: 'Ember', tag: 'EMB' })).body as {
        value: { id: string };
      }
    ).value.id;
    c.t += 30 * MIN;
    const ranking = (await bo.call('GET', '/api/clans/ranking')).body as {
      ranking: { clanId: string; members: number }[];
    };
    expect(ranking.ranking).toMatchObject([{ clanId, members: 1, rank: 1 }]);
    c.t = T0 + 120 * MIN + 1;
    w.tick();
    expect(store.clan(clanId)?.medals).toHaveLength(1);
    const hall = (await bo.call('GET', '/api/hall')).body as { seasons: { clans: { clanId: string }[] }[] };
    expect(hall.seasons[0]?.clans[0]?.clanId).toBe(clanId);
    await ana.call('POST', '/api/join');
    expect(w.gameState.lords[ana.id]?.clanId).toBe(clanId);
  });
});

describe('chat', () => {
  class Client {
    readonly messages: { type: string; [key: string]: unknown }[] = [];
    readonly socket: WebSocket;
    constructor(url: string) {
      this.socket = new WebSocket(url);
      this.socket.on('message', (raw) => this.messages.push(JSON.parse(String(raw)) as { type: string }));
    }
    async waitFor(test: (m: { type: string; [key: string]: unknown }) => boolean): Promise<void> {
      for (let i = 0; i < 100 && !this.messages.some(test); i++) await new Promise((r) => setTimeout(r, 20));
      if (!this.messages.some(test)) throw new Error('message not received');
    }
    chats(): ChatMessage[] {
      return this.messages.flatMap((m) => (m.type === 'chat' ? [m.message as ChatMessage] : []));
    }
  }

  it('delivers global lines to everyone and clan lines to the clan only, with history and a flood limit', async () => {
    const { app: a } = await start();
    await a.listen({ port: 0, host: '127.0.0.1' });
    const port = (a.server.address() as AddressInfo).port;
    const ana = await player(a, 'Ana');
    const bo = await player(a, 'Bo');
    const cy = await player(a, 'Cy');
    const clanId = (
      (await ana.call('POST', '/api/clans', { name: 'Mist', tag: 'MST' })).body as {
        value: { id: string };
      }
    ).value.id;
    await bo.call('POST', `/api/clans/${clanId}/requests`);
    await ana.call('POST', `/api/clans/${clanId}/requests/${bo.id}/accept`);

    const sockets = [ana, bo, cy].map((p) => new Client(`ws://127.0.0.1:${port}/ws?token=${p.token}`));
    await Promise.all(sockets.map((s) => s.waitFor((m) => m.type === 'chatHistory')));
    const [sa, sb, sc] = sockets as [Client, Client, Client];
    sa.socket.send(JSON.stringify({ type: 'chat', channel: 'global', text: '  hola \u0007mundo  ' }));
    sa.socket.send(JSON.stringify({ type: 'chat', channel: 'clan', text: 'solo el clan' }));
    sc.socket.send(JSON.stringify({ type: 'chat', channel: 'clan', text: 'no tengo clan' }));
    await sb.waitFor((m) => m.type === 'chat' && (m.message as ChatMessage).channel === 'clan');
    await sc.waitFor((m) => m.type === 'chat');
    expect(sc.chats().map((m) => m.text)).toEqual(['hola mundo']);
    expect(sb.chats().map((m) => [m.channel, m.text])).toEqual([
      ['global', 'hola mundo'],
      ['clan', 'solo el clan'],
    ]);

    for (let i = 0; i < 8; i++)
      sa.socket.send(JSON.stringify({ type: 'chat', channel: 'global', text: `spam ${i}` }));
    await new Promise((r) => setTimeout(r, 200));
    expect(sc.chats().filter((m) => m.text.startsWith('spam')).length).toBe(3);

    const late = new Client(`ws://127.0.0.1:${port}/ws?token=${bo.token}`);
    await late.waitFor((m) => m.type === 'chatHistory' && m.channel === 'clan');
    const history = late.messages.find((m) => m.type === 'chatHistory' && m.channel === 'clan');
    expect((history?.messages as ChatMessage[]).map((m) => m.text)).toEqual(['solo el clan']);
    for (const s of [...sockets, late]) s.socket.close();
  });
});
