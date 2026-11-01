import { MINUTE_MS, PERSONALITIES, WIND_DIRECTIONS } from '@si/config/constants';
import { botTurn } from './bots';
import { applyCommand } from './commands';
import { accrueTo, projectedDominion } from './economy';
import { checkGrowth, growIsle } from './growth';
import { generateWorld } from './mapgen';
import { arriveMarch, windShiftMs } from './marches';
import { heapPeek, heapPop, schedule } from './queue';
import { nextFloat, nextInt, seedRng } from './rng';
import { STATE_VERSION } from './types';
import type {
  CreateGameParams,
  DomainEvent,
  ExecResult,
  GameState,
  Personality,
  QueueItem,
  Standing,
} from './types';
import { openIsle, spawnLord } from './spawn';

export function createGame(params: CreateGameParams): GameState {
  const cfg = params.config;
  if (new Set(params.lords.map((l) => l.id)).size !== params.lords.length) {
    throw new Error('lord ids must be unique');
  }
  const rng = seedRng(params.seed);
  const world = generateWorld(cfg, rng, params.startsAt);
  const durationMs = Math.round(cfg.season.durationMin * MINUTE_MS);
  const startsAt = params.startsAt;

  const state: GameState = {
    version: STATE_VERSION,
    seed: params.seed >>> 0,
    rng,
    config: cfg,
    startsAt,
    endsAt: startsAt + durationMs,
    throneUnsealAt: startsAt + Math.round(durationMs * cfg.throne.unsealAtFraction),
    throneUnsealed: false,
    throneTownId: world.throneTownId,
    status: 'RUNNING',
    accruedAt: startsAt,
    isles: world.isles,
    zones: world.zones,
    lanes: world.lanes,
    towns: world.towns,
    lords: {},
    lordOrder: [],
    windDirs: [],
    marches: [],
    nextMarchId: 1,
    queue: [],
    seq: 0,
    reports: [],
    nextReportId: 1,
    standings: null,
    growCheckAt: null,
    mapSpin: world.spin,
  };

  let botIndex = 0;
  for (const init of params.lords) {
    let personality: Personality | null = null;
    if (init.isBot) {
      personality = init.personality ?? PERSONALITIES[botIndex % PERSONALITIES.length] ?? 'RAIDER';
      botIndex++;
    }
    // Lords given at creation always fit: extra isles here skip the daily cap.
    spawnLord(state, init, openIsle(state) ?? growIsle(state, startsAt, []), personality);
  }

  const shiftMs = windShiftMs(state);
  const windows = Math.max(1, Math.ceil(durationMs / shiftMs));
  let dir = nextInt(rng, 0, WIND_DIRECTIONS - 1);
  state.windDirs.push(dir);
  for (let k = 1; k < windows; k++) {
    const step = nextInt(rng, 1, cfg.wind.maxStep) * (nextFloat(rng) < 0.5 ? -1 : 1);
    dir = (dir + step + WIND_DIRECTIONS) % WIND_DIRECTIONS;
    state.windDirs.push(dir);
    schedule(state, startsAt + k * shiftMs, { kind: 'WIND_SHIFT', index: k });
  }
  if (state.throneTownId !== null) schedule(state, state.throneUnsealAt, { kind: 'THRONE_UNSEAL' });
  schedule(state, state.endsAt, { kind: 'SEASON_END' });
  for (const id of state.lordOrder) {
    if (state.lords[id]?.isBot) scheduleFirstBotTurn(state, id, startsAt);
  }
  checkGrowth(state, startsAt, []);
  return state;
}

/** A bot's first turn lands somewhere in its first thinking interval, so bots do not act in lockstep. */
export function scheduleFirstBotTurn(state: GameState, lordId: string, at: number): void {
  const thinkMs = state.config.bots.thinkEveryMin * MINUTE_MS;
  schedule(state, at + Math.round(nextFloat(state.rng) * thinkMs), { kind: 'BOT_TURN', lordId });
}

/** Runs every scheduled event due up to `now`, in (dueAt, seq) order. */
export function advanceTo(state: GameState, now: number): DomainEvent[] {
  const events: DomainEvent[] = [];
  while (state.status === 'RUNNING') {
    const top = heapPeek(state.queue);
    if (!top || top.dueAt > now) break;
    heapPop(state.queue);
    accrueTo(state, top.dueAt);
    processEvent(state, top, events);
  }
  return events;
}

function processEvent(state: GameState, item: QueueItem, events: DomainEvent[]): void {
  const at = item.dueAt;
  const ev = item.ev;
  switch (ev.kind) {
    case 'MARCH_ARRIVAL':
      arriveMarch(state, ev.marchId, at, events);
      return;
    case 'WIND_SHIFT':
      events.push({ type: 'WIND_SHIFTED', at, dir: state.windDirs[ev.index] ?? 0 });
      return;
    case 'THRONE_UNSEAL':
      state.throneUnsealed = true;
      events.push({ type: 'THRONE_UNSEALED', at });
      return;
    case 'SEASON_END':
      state.status = 'ENDED';
      state.queue = [];
      state.marches = [];
      state.standings = computeStandings(state, at);
      events.push({ type: 'SEASON_ENDED', at, standings: state.standings });
      return;
    case 'GROW_CHECK':
      state.growCheckAt = null;
      checkGrowth(state, at, events);
      return;
    case 'BOT_TURN': {
      const lord = state.lords[ev.lordId];
      if (!lord || !lord.alive) return;
      botTurn(state, ev.lordId, at, events);
      const cfg = state.config;
      const delayMin = cfg.bots.thinkEveryMin + (nextFloat(state.rng) * 2 - 1) * cfg.bots.jitterMin;
      const next = Math.max(at + 1, at + Math.round(delayMin * MINUTE_MS));
      if (next < state.endsAt) schedule(state, next, { kind: 'BOT_TURN', lordId: ev.lordId });
      return;
    }
  }
}

/**
 * Advances to `now`, then validates and applies one command. Times must not go backwards: an
 * earlier `now` is treated as the last settled instant (before the season start it stays as is,
 * so R02 rejects it).
 */
export function execute(state: GameState, lordId: string, command: unknown, now: number): ExecResult {
  const events = advanceTo(state, now);
  const at = now < state.startsAt ? now : Math.max(now, state.accruedAt);
  const error = applyCommand(state, lordId, command, at, events);
  return error ? { ok: false, error, events } : { ok: true, events };
}

/** Ranking by Dominion, then level, then lord id. Frozen once the season has ended. */
export function computeStandings(state: GameState, now: number): Standing[] {
  if (state.status === 'ENDED' && state.standings) return state.standings;
  const lords = state.lordOrder.flatMap((id) => {
    const lord = state.lords[id];
    return lord ? [lord] : [];
  });
  const rows = lords.map((lord) => ({
    lordId: lord.id,
    name: lord.name,
    color: lord.color,
    dominion: projectedDominion(state, lord.id, now),
    level: lord.level,
    towns: state.towns.filter((t) => t.owner === lord.id).length,
    alive: lord.alive,
  }));
  rows.sort(
    (a, b) =>
      b.dominion - a.dominion ||
      b.level - a.level ||
      (a.lordId < b.lordId ? -1 : a.lordId > b.lordId ? 1 : 0),
  );
  return rows.map((row, i) => ({ rank: i + 1, ...row }));
}
