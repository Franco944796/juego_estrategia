import { withOverrides, type GameConfig } from '@si/config';
import { MINUTE_MS } from '@si/config/constants';
import {
  advanceTo,
  computeStandings,
  createGame,
  execute,
  joinLord,
  migrateState,
  previewSend,
  setClan,
  setStyle,
  STATE_VERSION,
  view,
  type Command,
  type DomainEvent,
  type ExecResult,
  type GameState,
  type LordView,
  type SendPreview,
  type Standing,
  type Troops,
} from '@si/engine';
import type { ClanRankingRow, Reward, SeasonSummary, StandingRow } from '@si/protocol';
import { computeRewards } from './rewards';
import type { Account, Store } from './store';

export interface WorldOptions {
  store: Store;
  config: GameConfig;
  now: () => number;
  /** Only used to pick each season's seed. */
  random: () => number;
  snapshotEveryMs: number;
}

export interface SeasonResults {
  standings: StandingRow[];
  rewards: Reward[];
  clans: ClanRankingRow[];
}

type EventListener = (events: DomainEvent[]) => void;
type SeasonListener = (finished: SeasonSummary, results: SeasonResults, next: SeasonSummary) => void;

const SEED_RANGE = 2 ** 31;
const CLANS_KEPT = 10;

function colorFor(config: GameConfig, id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  const colors = config.display.lordColors;
  return colors[h % colors.length] ?? '#ffffff';
}

/**
 * The one public world. Every state change is an engine call at a logged time, so loading the last
 * snapshot and replaying the log after it rebuilds exactly the live state.
 */
export class WorldService {
  private state!: GameState;
  private season!: SeasonSummary;
  private lastSeq = 0;
  private lastSnapshotAt = 0;
  private readonly eventListeners = new Set<EventListener>();
  private readonly seasonListeners = new Set<SeasonListener>();

  constructor(private readonly opts: WorldOptions) {
    this.load();
  }

  private get store(): Store {
    return this.opts.store;
  }

  private load(): void {
    const row = this.store.currentSeason() ?? this.newSeasonRow(this.opts.now());
    this.season = { id: row.id, startsAt: row.startsAt, endsAt: row.endsAt };
    const snap = this.store.snapshot(row.id);
    if (snap && (snap.state as GameState).version !== STATE_VERSION) {
      // Saved by an older engine with another map: it cannot be replayed, so a new season starts.
      this.store.abandonSeason(row.id);
      this.load();
      return;
    }
    if (snap) {
      // A snapshot keeps the config its season started with; keys added since come from the current one.
      const saved = snap.state as GameState;
      saved.config = withOverrides(this.opts.config, saved.config);
      this.state = migrateState(saved);
    } else {
      this.state = createGame({
        seed: row.seed,
        config: this.opts.config,
        startsAt: row.startsAt,
        lords: [],
      });
    }
    this.lastSeq = snap?.seq ?? 0;
    for (const entry of this.store.logAfter(row.id, this.lastSeq)) {
      if (entry.kind === 'join')
        joinLord(this.state, entry.payload as Parameters<typeof joinLord>[1], entry.at);
      if (entry.kind === 'command') execute(this.state, entry.lordId, entry.payload, entry.at);
      if (entry.kind === 'style') setStyle(this.state, entry.lordId, String(entry.payload), entry.at);
      if (entry.kind === 'clan') setClan(this.state, entry.lordId, entry.payload as string | null, entry.at);
      this.lastSeq = entry.seq;
    }
    this.lastSnapshotAt = this.opts.now();
  }

  private newSeasonRow(startsAt: number): { id: number; seed: number; startsAt: number; endsAt: number } {
    const seed = Math.floor(this.opts.random() * SEED_RANGE);
    const endsAt = startsAt + Math.round(this.opts.config.season.durationMin * MINUTE_MS);
    return this.store.createSeason(seed, startsAt, endsAt);
  }

  private log(
    kind: 'join' | 'command' | 'style' | 'clan',
    at: number,
    lordId: string,
    payload: unknown,
  ): void {
    this.lastSeq = this.store.appendLog(this.season.id, at, kind, lordId, payload);
  }

  private emit(events: DomainEvent[]): void {
    if (events.length === 0) return;
    for (const listener of this.eventListeners) listener(events);
  }

  onEvents(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onSeason(listener: SeasonListener): () => void {
    this.seasonListeners.add(listener);
    return () => this.seasonListeners.delete(listener);
  }

  get currentSeason(): SeasonSummary {
    return this.season;
  }

  /** For tests and diagnostics. */
  get gameState(): GameState {
    return this.state;
  }

  hasJoined(accountId: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.state.lords, accountId);
  }

  /** Runs due events; closes the season and opens the next one when it ends. */
  tick(): void {
    const events = advanceTo(this.state, this.opts.now());
    this.emit(events);
    if (events.some((e) => e.type === 'SEASON_ENDED')) this.rollover();
    if (this.opts.now() - this.lastSnapshotAt >= this.opts.snapshotEveryMs) this.snapshot();
  }

  /** Milliseconds until the next scheduled engine event, for the server timer. */
  msUntilNextEvent(): number {
    const next = this.state.queue[0]?.dueAt;
    return next === undefined ? Number.POSITIVE_INFINITY : Math.max(0, next - this.opts.now());
  }

  snapshot(): void {
    this.store.saveSnapshot(this.season.id, this.lastSeq, this.opts.now(), this.state);
    this.lastSnapshotAt = this.opts.now();
  }

  join(account: Account): { ok: boolean; code?: string } {
    if (this.hasJoined(account.id)) return { ok: true };
    const at = this.opts.now();
    const init = {
      id: account.id,
      name: account.name,
      color: colorFor(this.opts.config, account.id),
      isBot: false,
      style: account.style,
      clanId: this.store.membership(account.id)?.clanId ?? null,
    };
    const result = joinLord(this.state, init, at);
    this.emit(result.events);
    if (!result.ok) return { ok: false, code: result.error.code };
    this.log('join', at, account.id, init);
    return { ok: true };
  }

  command(accountId: string, command: Command): ExecResult {
    const at = this.opts.now();
    const result = execute(this.state, accountId, command, at);
    if (result.ok) this.log('command', at, accountId, command);
    this.emit(result.events);
    return result;
  }

  preview(accountId: string, from: number, to: number, troops: Troops): SendPreview {
    return previewSend(this.state, accountId, from, to, troops, this.opts.now());
  }

  setStyle(accountId: string, style: string): void {
    if (!this.hasJoined(accountId)) return;
    const at = this.opts.now();
    const events = setStyle(this.state, accountId, style, at);
    if (events.length > 0) this.log('style', at, accountId, style);
    this.emit(events);
  }

  /** Applies a clan change made through the API to the running season (no-op if not joined). */
  setClan(accountId: string, clanId: string | null): void {
    if (!this.hasJoined(accountId)) return;
    const at = this.opts.now();
    const events = setClan(this.state, accountId, clanId, at);
    if (events.length > 0) this.log('clan', at, accountId, clanId);
    this.emit(events);
  }

  standings(): Standing[] {
    return computeStandings(this.state, this.opts.now());
  }

  /** Clans ranked by the summed Dominion of their members in this season. */
  clanRanking(standings: Standing[] = this.standings()): ClanRankingRow[] {
    const totals = new Map<string, { dominion: number; members: number }>();
    for (const s of standings) {
      const clanId = this.store.membership(s.lordId)?.clanId;
      if (!clanId) continue;
      const row = totals.get(clanId) ?? { dominion: 0, members: 0 };
      row.dominion += s.dominion;
      row.members += 1;
      totals.set(clanId, row);
    }
    return [...totals.entries()]
      .flatMap(([clanId, row]) => {
        const clan = this.store.clan(clanId);
        return clan
          ? [{ clanId, name: clan.name, tag: clan.tag, dominion: row.dominion, members: row.members }]
          : [];
      })
      .sort((a, b) => b.dominion - a.dominion || (a.clanId < b.clanId ? -1 : 1))
      .map((row, i) => ({ rank: i + 1, ...row }));
  }

  view(accountId: string): LordView {
    return view(this.state, accountId, this.opts.now());
  }

  /** Pays Legacy by final rank, archives the results and starts the next season right away. */
  private rollover(): void {
    const finished = this.season;
    const standings = this.state.standings ?? [];
    const rewards = computeRewards(standings, this.opts.config.rewards.tiers);
    const results: SeasonResults = {
      standings: standings.map((s) => ({
        rank: s.rank,
        lordId: s.lordId,
        name: s.name,
        color: s.color,
        dominion: s.dominion,
        towns: s.towns,
      })),
      rewards,
      clans: this.clanRanking(standings).slice(0, CLANS_KEPT),
    };
    const next = this.store.transaction(() => {
      const winner = results.clans[0];
      if (winner && winner.dominion > 0) {
        this.store.addClanMedal(winner.clanId, { season: finished.id, dominion: winner.dominion });
      }
      for (const reward of rewards) {
        const account = this.store.account(reward.lordId);
        if (!account) continue;
        account.legacy += reward.legacy;
        account.legacyTotal += reward.legacy;
        account.medals.push({
          season: finished.id,
          rank: reward.rank,
          of: standings.length,
          tier: reward.tier,
          legacy: reward.legacy,
        });
        this.store.saveAccount(account);
      }
      this.store.saveSnapshot(finished.id, this.lastSeq, finished.endsAt, this.state);
      this.store.finishSeason(finished.id, results);
      return this.newSeasonRow(finished.endsAt);
    });
    this.season = { id: next.id, startsAt: next.startsAt, endsAt: next.endsAt };
    this.state = createGame({
      seed: next.seed,
      config: this.opts.config,
      startsAt: next.startsAt,
      lords: [],
    });
    this.lastSeq = 0;
    this.snapshot();
    for (const listener of this.seasonListeners) listener(finished, results, this.season);
    // A server that slept through several season ends catches up one season at a time.
    if (this.opts.now() >= this.season.endsAt) this.tick();
  }
}
