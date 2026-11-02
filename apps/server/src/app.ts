import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { GameConfig } from '@si/config';
import { GEAR_SLOTS, RARITIES, SKILL_IDS } from '@si/config/constants';
import type { Command, DomainEvent, GameState } from '@si/engine';
import type { ClanRankingRow, PublicAccount, ServerMessage } from '@si/protocol';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { ClanService, type ClanResult } from './clans';
import type { Account, Store } from './store';
import type { WorldService } from './world';

export interface AppOptions {
  store: Store;
  /** One world per league, lowest first (index = `Account.league`). */
  worlds: WorldService[];
  config: GameConfig;
  now: () => number;
  /** Built client to serve at `/`, if present. */
  clientDir?: string;
  logger?: boolean;
  viewEveryMs?: number;
  /** Game milliseconds per real millisecond; above 1 only for tests. */
  rate?: number;
}

const NAME_MIN = 2;
const NAME_MAX = 20;
const TOKEN_BYTES = 32;
const HALL_SEASONS = 10;
const HALL_TOP = 10;
const DEFAULT_VIEW_EVERY_MS = 2000;
/** Commands and previews a socket may send per second before being throttled. */
const RATE_PER_SECOND = 20;
const CHAT_MAX_LENGTH = 200;
const CHAT_KEPT = 100;
const CHAT_HISTORY = 50;
/** Chat flood guard: at most this many messages per account in the window. */
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 10_000;
const CLAN_SEARCH_LIMIT = 30;
/** Most towns one group send may list; far above a real realm's reach, it only bounds the payload. */
const MAX_GROUP = 500;

const troopsSchema = z.number().int().min(0);
const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('UPGRADE'),
    townId: z.number().int(),
    levels: z.number().int().min(1).default(1),
  }),
  z.object({ type: z.literal('SEND'), from: z.number().int(), to: z.number().int(), troops: troopsSchema }),
  z.object({
    type: z.literal('SEND_GROUP'),
    from: z.array(z.number().int()).min(1).max(MAX_GROUP),
    to: z.number().int(),
  }),
  z.object({ type: z.literal('LEARN_SKILL'), skill: z.enum(SKILL_IDS) }),
  z.object({ type: z.literal('EQUIP'), itemId: z.string().max(200) }),
]);
const itemBody = z.object({ slot: z.enum(GEAR_SLOTS), rarity: z.enum(RARITIES) });
const socketMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), id: z.number().int(), command: commandSchema }),
  z.object({
    type: z.literal('preview'),
    id: z.number().int(),
    from: z.number().int(),
    to: z.number().int(),
    troops: troopsSchema,
  }),
  z.object({
    type: z.literal('previewGroup'),
    id: z.number().int(),
    from: z.array(z.number().int()).max(MAX_GROUP),
    to: z.number().int(),
  }),
  z.object({ type: z.literal('chat'), channel: z.enum(['global', 'clan']), text: z.string() }),
]);
const clanBody = z.object({ name: z.string(), tag: z.string() });
const roleBody = z.object({ role: z.enum(['officer', 'member']) });
const sessionBody = z.object({
  name: z
    .string()
    .transform((s) => s.replace(/[\p{C}]/gu, '').trim())
    .pipe(z.string().min(NAME_MIN).max(NAME_MAX)),
});
const styleBody = z.object({ style: z.string().min(1) });

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function publicAccount(a: Account): PublicAccount {
  return {
    id: a.id,
    name: a.name,
    legacy: a.legacy,
    legacyTotal: a.legacyTotal,
    styles: a.styles,
    style: a.style,
    medals: a.medals,
    items: a.items,
    league: a.league,
  };
}

/**
 * Events a lord may see: its own and incoming marches and battles, plus public map news. Another
 * lord's march goes out with 0 troops: the target learns its size only as a band, from the view.
 */
export function eventsFor(lordId: string, events: DomainEvent[], state: GameState): DomainEvent[] {
  return events.filter(visibleTo(lordId, state)).map((e) => {
    if (
      (e.type === 'MARCH_LAUNCHED' || e.type === 'MARCH_REINFORCED' || e.type === 'MARCH_REPELLED') &&
      e.march.owner !== lordId
    ) {
      return { ...e, march: { ...e.march, troops: 0 } };
    }
    return e;
  });
}

function visibleTo(lordId: string, state: GameState): (e: DomainEvent) => boolean {
  return (e) => {
    switch (e.type) {
      case 'MARCH_LAUNCHED':
      case 'MARCH_REINFORCED':
      case 'MARCH_REPELLED':
        return e.march.owner === lordId || state.towns[e.march.to]?.owner === lordId;
      case 'BATTLE':
        return (
          e.report.attacker === lordId ||
          e.report.defender === lordId ||
          e.report.allies.some((a) => a.lordId === lordId)
        );
      case 'TOWN_UPGRADED':
      case 'SKILL_LEARNED':
      case 'ITEM_FOUND':
      case 'ITEM_EQUIPPED':
      case 'LORD_EXILED':
      case 'LORD_ELIMINATED':
        return e.lordId === lordId;
      default:
        return true;
    }
  };
}

/** Clans ranked by their members' Dominion summed over every league. */
function clanRanking(worlds: WorldService[]): ClanRankingRow[] {
  const totals = new Map<string, ClanRankingRow>();
  for (const world of worlds) {
    for (const row of world.clanRanking()) {
      const sum = totals.get(row.clanId);
      if (sum) {
        sum.dominion += row.dominion;
        sum.members += row.members;
      } else totals.set(row.clanId, { ...row });
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.dominion - a.dominion || (a.clanId < b.clanId ? -1 : 1))
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { store, worlds, config } = opts;
  const lowest = worlds[0];
  if (!lowest) throw new Error('at least one league world is needed');
  /** The world an account plays in: the one of its league. */
  const worldOf = (accountId: string): WorldService =>
    worlds[store.account(accountId)?.league ?? 0] ?? lowest;
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 16 * 1024 });
  await app.register(fastifyWebsocket);

  const authenticate = (token: string | undefined): Account | null =>
    token ? store.accountByToken(hashToken(token)) : null;
  const bearer = (req: FastifyRequest): Account | null => {
    const header = req.headers.authorization ?? '';
    return authenticate(header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined);
  };

  const sockets = new Map<WebSocket, string>();
  const clanWorlds = { setClan: (id: string, clanId: string | null) => worldOf(id).setClan(id, clanId) };
  const clans = new ClanService(store, clanWorlds, opts.now, (accountIds) => {
    for (const [socket, id] of sockets) {
      if (!accountIds.includes(id)) continue;
      send(socket, { type: 'clanChanged' });
      sendHistory(socket, id);
    }
  });

  app.get('/api/health', async () => ({ ok: true, season: lowest.currentSeason }));

  app.post('/api/session', async (req, reply) => {
    const body = sessionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_NAME' });
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const style = config.cosmetics.styles[0]?.id ?? 'classic';
    const account = store.createAccount(randomUUID(), body.data.name, hashToken(token), style, opts.now());
    return { token, account: publicAccount(account) };
  });

  app.get('/api/me', async (req, reply) => {
    const account = bearer(req);
    if (!account) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    return {
      account: publicAccount(account),
      joined: worldOf(account.id).hasJoined(account.id),
      season: worldOf(account.id).currentSeason,
      clan: clans.myClan(account.id),
    };
  });

  app.post('/api/join', async (req, reply) => {
    const account = bearer(req);
    if (!account) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const world = worldOf(account.id);
    const result = world.join(account);
    if (!result.ok) return reply.code(409).send({ error: result.code });
    return { ok: true, season: world.currentSeason };
  });

  app.post('/api/styles/unlock', async (req, reply) => {
    const account = bearer(req);
    if (!account) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const body = styleBody.safeParse(req.body);
    const style = config.cosmetics.styles.find((s) => body.success && s.id === body.data.style);
    if (!style) return reply.code(400).send({ error: 'UNKNOWN_STYLE' });
    if (account.styles.includes(style.id)) return reply.code(409).send({ error: 'ALREADY_OWNED' });
    if (account.legacy < style.cost) return reply.code(409).send({ error: 'NOT_ENOUGH_LEGACY' });
    account.legacy -= style.cost;
    account.styles.push(style.id);
    store.saveAccount(account);
    return { account: publicAccount(account) };
  });

  app.post('/api/items/buy', async (req, reply) => {
    const account = bearer(req);
    if (!account) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const body = itemBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'UNKNOWN_ITEM' });
    const price = config.gear.prices[body.data.rarity];
    if (account.legacy < price) return reply.code(409).send({ error: 'NOT_ENOUGH_LEGACY' });
    const item = { id: randomUUID(), slot: body.data.slot, rarity: body.data.rarity };
    account.legacy -= price;
    account.items.push(item);
    store.saveAccount(account);
    worldOf(account.id).grantItem(account.id, item);
    return { account: publicAccount(account), item };
  });

  app.post('/api/styles/equip', async (req, reply) => {
    const account = bearer(req);
    if (!account) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const body = styleBody.safeParse(req.body);
    if (!body.success || !account.styles.includes(body.data.style)) {
      return reply.code(409).send({ error: 'STYLE_NOT_OWNED' });
    }
    account.style = body.data.style;
    store.saveAccount(account);
    worldOf(account.id).setStyle(account.id, account.style);
    return { account: publicAccount(account) };
  });

  app.get('/api/hall', async (req) => {
    const asked = Number((req.query as { league?: string }).league ?? 0);
    const world = worlds[Number.isInteger(asked) ? asked : 0] ?? lowest;
    return {
      current: world.currentSeason,
      seasons: store.finishedSeasons(HALL_SEASONS, world.league).map((s) => {
        const results = s.results as { standings?: unknown[]; clans?: unknown[] } | null;
        return {
          id: s.id,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          top: (results?.standings ?? []).slice(0, HALL_TOP),
          clans: (results?.clans ?? []).slice(0, HALL_TOP),
        };
      }),
    };
  });

  const send = (socket: WebSocket, message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const chatChannel = (accountId: string, channel: 'global' | 'clan'): string | null => {
    if (channel === 'global') return 'global';
    const clanId = store.membership(accountId)?.clanId;
    return clanId ? `clan:${clanId}` : null;
  };
  const sendHistory = (socket: WebSocket, accountId: string): void => {
    for (const channel of ['global', 'clan'] as const) {
      const key = chatChannel(accountId, channel);
      const messages = key ? store.messages(key, CHAT_HISTORY).map((m) => ({ ...m, channel })) : [];
      send(socket, { type: 'chatHistory', channel, messages });
    }
  };
  const recentChat = new Map<string, number[]>();
  const rate = opts.rate ?? 1;
  const clock = () => ({ gameNow: opts.now(), rate, speed: 1, timeScale: rate });
  const pushView = (socket: WebSocket, lordId: string): void => {
    const world = worldOf(lordId);
    if (world.hasJoined(lordId)) send(socket, { type: 'view', view: world.view(lordId), clock: clock() });
  };

  app.get('/ws', { websocket: true }, (socket, req) => {
    const token = (req.query as { token?: string }).token;
    const account = authenticate(token);
    if (!account) {
      socket.close(4001, 'unauthorized');
      return;
    }
    sockets.set(socket, account.id);
    pushView(socket, account.id);
    sendHistory(socket, account.id);
    let windowStart = opts.now();
    let used = 0;
    socket.on('message', (raw: Buffer) => {
      const now = opts.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        used = 0;
      }
      if (++used > RATE_PER_SECOND) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const msg = socketMessage.safeParse(parsed);
      if (!msg.success) return;
      if (msg.data.type === 'command') {
        const result = worldOf(account.id).command(account.id, msg.data.command as Command);
        send(socket, { type: 'result', id: msg.data.id, error: result.ok ? null : result.error });
        pushView(socket, account.id);
      } else if (msg.data.type === 'preview') {
        const { id, from, to, troops } = msg.data;
        const preview = worldOf(account.id).preview(account.id, from, to, troops);
        send(socket, { type: 'preview', id, preview });
      } else if (msg.data.type === 'previewGroup') {
        const { id, from, to } = msg.data;
        const preview = worldOf(account.id).previewGroup(account.id, from, to);
        send(socket, { type: 'previewGroup', id, preview });
      } else {
        postChat(account.id, msg.data.channel, msg.data.text);
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });

  /** Stores and fans out a chat line: global to everyone online, clan lines to that clan only. */
  const postChat = (accountId: string, channel: 'global' | 'clan', raw: string): void => {
    const text = raw
      .replace(/[\p{C}]/gu, '')
      .trim()
      .slice(0, CHAT_MAX_LENGTH);
    const key = chatChannel(accountId, channel);
    const account = store.account(accountId);
    if (!text || !key || !account) return;
    const now = opts.now();
    const recent = (recentChat.get(accountId) ?? []).filter((at) => now - at < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) return;
    recentChat.set(accountId, [...recent, now]);
    const id = store.addMessage(key, accountId, account.name, text, now, CHAT_KEPT);
    const message = { id, channel, accountId, name: account.name, text, at: now };
    for (const [socket, readerId] of sockets) {
      if (chatChannel(readerId, channel) === key) send(socket, { type: 'chat', message });
    }
  };

  const reply = <T>(res: FastifyReply, result: ClanResult<T>) =>
    result.ok ? { ok: true, value: result.value } : res.code(result.status).send({ error: result.error });

  app.post('/api/clans', async (req, res) => {
    const account = bearer(req);
    if (!account) return res.code(401).send({ error: 'UNAUTHORIZED' });
    const body = clanBody.safeParse(req.body);
    if (!body.success) return res.code(400).send({ error: 'BAD_CLAN_NAME' });
    return reply(res, clans.create(account, body.data.name, body.data.tag));
  });

  app.get('/api/clans', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').slice(0, 24);
    return { clans: store.clans(q, CLAN_SEARCH_LIMIT) };
  });

  app.get('/api/clans/ranking', async () => ({ ranking: clanRanking(worlds).slice(0, HALL_TOP) }));

  app.get('/api/clans/:id', async (req, res) => {
    const account = bearer(req);
    if (!account) return res.code(401).send({ error: 'UNAUTHORIZED' });
    return reply(res, clans.detail((req.params as { id: string }).id, account.id));
  });

  app.post('/api/clans/:id/requests', async (req, res) => {
    const account = bearer(req);
    if (!account) return res.code(401).send({ error: 'UNAUTHORIZED' });
    return reply(res, clans.request(account, (req.params as { id: string }).id));
  });

  app.post('/api/clans/:id/requests/:accountId/:decision', async (req, res) => {
    const account = bearer(req);
    if (!account) return res.code(401).send({ error: 'UNAUTHORIZED' });
    const { id, accountId, decision } = req.params as { id: string; accountId: string; decision: string };
    if (decision !== 'accept' && decision !== 'reject') return res.code(404).send({ error: 'NOT_FOUND' });
    return reply(res, clans.decide(account, id, accountId, decision === 'accept'));
  });

  app.post('/api/clan/leave', async (req, res) => {
    const account = bearer(req);
    if (!account) return res.code(401).send({ error: 'UNAUTHORIZED' });
    return reply(res, clans.leave(account));
  });

  app.post('/api/clan/members/:accountId/kick', async (req, res) => {
    const account = bearer(req);
    if (!account) return res.code(401).send({ error: 'UNAUTHORIZED' });
    return reply(res, clans.kick(account, (req.params as { accountId: string }).accountId));
  });

  app.post('/api/clan/members/:accountId/role', async (req, res) => {
    const account = bearer(req);
    if (!account) return res.code(401).send({ error: 'UNAUTHORIZED' });
    const body = roleBody.safeParse(req.body);
    if (!body.success) return res.code(400).send({ error: 'BAD_ROLE' });
    return reply(
      res,
      clans.setRole(account, (req.params as { accountId: string }).accountId, body.data.role),
    );
  });

  const offEvents = worlds.map((world) =>
    world.onEvents((events) => {
      for (const [socket, lordId] of sockets) {
        if (!world.hasJoined(lordId)) continue;
        const mine = eventsFor(lordId, events, world.gameState);
        if (mine.length > 0) send(socket, { type: 'events', events: mine });
        pushView(socket, lordId);
      }
    }),
  );
  // Each league tells its own players: those who played the season and those who now belong to it.
  const offSeason = worlds.map((world) =>
    world.onSeason((finished, results, next) => {
      for (const [socket, lordId] of sockets) {
        const move = results.moves.find((m) => m.lordId === lordId) ?? null;
        if (!move && store.account(lordId)?.league !== world.league) continue;
        const reward = results.rewards.find((r) => r.lordId === lordId) ?? null;
        const top = results.standings.slice(0, HALL_TOP);
        send(socket, { type: 'season', finished, next, reward, top, move });
      }
    }),
  );
  const viewTimer = setInterval(() => {
    for (const [socket, lordId] of sockets) pushView(socket, lordId);
  }, opts.viewEveryMs ?? DEFAULT_VIEW_EVERY_MS);
  app.addHook('onClose', async () => {
    clearInterval(viewTimer);
    for (const off of [...offEvents, ...offSeason]) off();
  });

  if (opts.clientDir && existsSync(opts.clientDir)) {
    await app.register(fastifyStatic, { root: opts.clientDir });
  }
  return app;
}
