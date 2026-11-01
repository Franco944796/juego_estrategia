import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { GameConfig } from '@si/config';
import { EDICT_IDS, TROOP_TYPES } from '@si/config/constants';
import type { Command, DomainEvent, GameState } from '@si/engine';
import type { PublicAccount, ServerMessage } from '@si/protocol';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Account, Store } from './store';
import type { WorldService } from './world';

export interface AppOptions {
  store: Store;
  world: WorldService;
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

const troopsSchema = z.object({
  LANCER: z.number().int().min(0),
  ARCHER: z.number().int().min(0),
  GRIFFIN: z.number().int().min(0),
});
const troopType = z.enum(TROOP_TYPES);
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('UPGRADE'), townId: z.number().int() }),
  z.object({ type: z.literal('RESPECIALIZE'), townId: z.number().int(), spec: troopType }),
  z.object({ type: z.literal('SEND'), from: z.number().int(), to: z.number().int(), troops: troopsSchema }),
  z.object({ type: z.literal('CHOOSE_EDICT'), edict: z.enum(EDICT_IDS) }),
]);
const socketMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), id: z.number().int(), command: commandSchema }),
  z.object({
    type: z.literal('preview'),
    id: z.number().int(),
    from: z.number().int(),
    to: z.number().int(),
    troops: troopsSchema,
  }),
]);
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
  };
}

/** Events a lord may see: its own and incoming marches and battles, plus public map news. */
export function eventsFor(lordId: string, events: DomainEvent[], state: GameState): DomainEvent[] {
  return events.filter((e) => {
    switch (e.type) {
      case 'MARCH_LAUNCHED':
      case 'MARCH_REINFORCED':
      case 'MARCH_REPELLED':
        return e.march.owner === lordId || state.towns[e.march.to]?.owner === lordId;
      case 'BATTLE':
        return e.report.attacker === lordId || e.report.defender === lordId;
      case 'TOWN_UPGRADED':
      case 'TOWN_RESPECIALIZED':
      case 'EDICT_DRAFT':
      case 'EDICT_CHOSEN':
      case 'LORD_EXILED':
      case 'LORD_ELIMINATED':
        return e.lordId === lordId;
      default:
        return true;
    }
  });
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { store, world, config } = opts;
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 16 * 1024 });
  await app.register(fastifyWebsocket);

  const authenticate = (token: string | undefined): Account | null =>
    token ? store.accountByToken(hashToken(token)) : null;
  const bearer = (req: FastifyRequest): Account | null => {
    const header = req.headers.authorization ?? '';
    return authenticate(header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined);
  };

  app.get('/api/health', async () => ({ ok: true, season: world.currentSeason }));

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
      joined: world.hasJoined(account.id),
      season: world.currentSeason,
    };
  });

  app.post('/api/join', async (req, reply) => {
    const account = bearer(req);
    if (!account) return reply.code(401).send({ error: 'UNAUTHORIZED' });
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

  app.post('/api/styles/equip', async (req, reply) => {
    const account = bearer(req);
    if (!account) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const body = styleBody.safeParse(req.body);
    if (!body.success || !account.styles.includes(body.data.style)) {
      return reply.code(409).send({ error: 'STYLE_NOT_OWNED' });
    }
    account.style = body.data.style;
    store.saveAccount(account);
    world.setStyle(account.id, account.style);
    return { account: publicAccount(account) };
  });

  app.get('/api/hall', async () => ({
    current: world.currentSeason,
    seasons: store.finishedSeasons(HALL_SEASONS).map((s) => {
      const results = s.results as { standings?: unknown[] } | null;
      return {
        id: s.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        top: (results?.standings ?? []).slice(0, HALL_TOP),
      };
    }),
  }));

  const sockets = new Map<WebSocket, string>();
  const send = (socket: WebSocket, message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const rate = opts.rate ?? 1;
  const clock = () => ({ gameNow: opts.now(), rate, speed: 1, timeScale: rate });
  const pushView = (socket: WebSocket, lordId: string): void => {
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
        const result = world.command(account.id, msg.data.command as Command);
        send(socket, { type: 'result', id: msg.data.id, error: result.ok ? null : result.error });
        pushView(socket, account.id);
      } else {
        const { id, from, to, troops } = msg.data;
        send(socket, { type: 'preview', id, preview: world.preview(account.id, from, to, troops) });
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });

  const offEvents = world.onEvents((events) => {
    for (const [socket, lordId] of sockets) {
      const mine = eventsFor(lordId, events, world.gameState);
      if (mine.length > 0) send(socket, { type: 'events', events: mine });
      pushView(socket, lordId);
    }
  });
  const offSeason = world.onSeason((finished, results, next) => {
    for (const [socket, lordId] of sockets) {
      const reward = results.rewards.find((r) => r.lordId === lordId) ?? null;
      send(socket, { type: 'season', finished, next, reward, top: results.standings.slice(0, HALL_TOP) });
    }
  });
  const viewTimer = setInterval(() => {
    for (const [socket, lordId] of sockets) pushView(socket, lordId);
  }, opts.viewEveryMs ?? DEFAULT_VIEW_EVERY_MS);
  app.addHook('onClose', async () => {
    clearInterval(viewTimer);
    offEvents();
    offSeason();
  });

  if (opts.clientDir && existsSync(opts.clientDir)) {
    await app.register(fastifyStatic, { root: opts.clientDir });
  }
  return app;
}
