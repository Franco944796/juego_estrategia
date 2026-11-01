import { DatabaseSync } from 'node:sqlite';
import type { Medal } from '@si/protocol';

export interface Account {
  id: string;
  name: string;
  /** Legacy points that can still be spent on styles. */
  legacy: number;
  /** Legacy earned over every season, never decreases. */
  legacyTotal: number;
  styles: string[];
  style: string;
  medals: Medal[];
  createdAt: number;
}

export interface SeasonRow {
  id: number;
  seed: number;
  startsAt: number;
  endsAt: number;
}

export interface FinishedSeason extends SeasonRow {
  results: unknown;
}

export type LogKind = 'join' | 'command' | 'style';

export interface LogEntry {
  seq: number;
  at: number;
  kind: LogKind;
  lordId: string;
  payload: unknown;
}

interface AccountRecord {
  id: string;
  name: string;
  legacy: number;
  legacy_total: number;
  styles: string;
  style: string;
  medals: string;
  created_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legacy INTEGER NOT NULL DEFAULT 0,
  legacy_total INTEGER NOT NULL DEFAULT 0,
  styles TEXT NOT NULL,
  style TEXT NOT NULL,
  medals TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seed INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  results TEXT
);
CREATE TABLE IF NOT EXISTS season_log (
  season_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  lord_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (season_id, seq)
);
CREATE TABLE IF NOT EXISTS snapshots (
  season_id INTEGER PRIMARY KEY,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL
);
`;

function toAccount(r: AccountRecord): Account {
  return {
    id: r.id,
    name: r.name,
    legacy: r.legacy,
    legacyTotal: r.legacy_total,
    styles: JSON.parse(r.styles) as string[],
    style: r.style,
    medals: JSON.parse(r.medals) as Medal[],
    createdAt: r.created_at,
  };
}

/** Everything the server keeps: accounts, seasons, the accepted-command log and state snapshots. */
export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createAccount(id: string, name: string, tokenHash: string, style: string, now: number): Account {
    this.db
      .prepare(
        'INSERT INTO accounts (id, token_hash, name, styles, style, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, tokenHash, name, JSON.stringify([style]), style, now);
    return this.account(id) as Account;
  }

  account(id: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRecord | undefined;
    return row ? toAccount(row) : null;
  }

  accountByToken(tokenHash: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE token_hash = ?').get(tokenHash) as
      AccountRecord | undefined;
    return row ? toAccount(row) : null;
  }

  saveAccount(a: Account): void {
    this.db
      .prepare(
        'UPDATE accounts SET name = ?, legacy = ?, legacy_total = ?, styles = ?, style = ?, medals = ? WHERE id = ?',
      )
      .run(
        a.name,
        a.legacy,
        a.legacyTotal,
        JSON.stringify(a.styles),
        a.style,
        JSON.stringify(a.medals),
        a.id,
      );
  }

  currentSeason(): SeasonRow | null {
    const row = this.db
      .prepare(
        "SELECT id, seed, starts_at, ends_at FROM seasons WHERE status = 'running' ORDER BY id DESC LIMIT 1",
      )
      .get() as { id: number; seed: number; starts_at: number; ends_at: number } | undefined;
    return row ? { id: row.id, seed: row.seed, startsAt: row.starts_at, endsAt: row.ends_at } : null;
  }

  createSeason(seed: number, startsAt: number, endsAt: number): SeasonRow {
    const info = this.db
      .prepare("INSERT INTO seasons (seed, starts_at, ends_at, status) VALUES (?, ?, ?, 'running')")
      .run(seed, startsAt, endsAt);
    return { id: Number(info.lastInsertRowid), seed, startsAt, endsAt };
  }

  finishSeason(id: number, results: unknown): void {
    this.db
      .prepare("UPDATE seasons SET status = 'finished', results = ? WHERE id = ?")
      .run(JSON.stringify(results), id);
  }

  finishedSeasons(limit: number): FinishedSeason[] {
    const rows = this.db
      .prepare(
        "SELECT id, seed, starts_at, ends_at, results FROM seasons WHERE status = 'finished' ORDER BY id DESC LIMIT ?",
      )
      .all(limit) as { id: number; seed: number; starts_at: number; ends_at: number; results: string }[];
    return rows.map((r) => ({
      id: r.id,
      seed: r.seed,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      results: JSON.parse(r.results) as unknown,
    }));
  }

  appendLog(seasonId: number, at: number, kind: LogKind, lordId: string, payload: unknown): number {
    const last = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM season_log WHERE season_id = ?')
      .get(seasonId) as { seq: number };
    const seq = last.seq + 1;
    this.db
      .prepare(
        'INSERT INTO season_log (season_id, seq, at, kind, lord_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(seasonId, seq, at, kind, lordId, JSON.stringify(payload));
    return seq;
  }

  logAfter(seasonId: number, seq: number): LogEntry[] {
    const rows = this.db
      .prepare(
        'SELECT seq, at, kind, lord_id, payload FROM season_log WHERE season_id = ? AND seq > ? ORDER BY seq',
      )
      .all(seasonId, seq) as { seq: number; at: number; kind: LogKind; lord_id: string; payload: string }[];
    return rows.map((r) => ({
      seq: r.seq,
      at: r.at,
      kind: r.kind,
      lordId: r.lord_id,
      payload: JSON.parse(r.payload) as unknown,
    }));
  }

  saveSnapshot(seasonId: number, seq: number, at: number, state: unknown): void {
    this.db
      .prepare('INSERT OR REPLACE INTO snapshots (season_id, seq, at, state) VALUES (?, ?, ?, ?)')
      .run(seasonId, seq, at, JSON.stringify(state));
  }

  snapshot(seasonId: number): { seq: number; at: number; state: unknown } | null {
    const row = this.db.prepare('SELECT seq, at, state FROM snapshots WHERE season_id = ?').get(seasonId) as
      { seq: number; at: number; state: string } | undefined;
    return row ? { seq: row.seq, at: row.at, state: JSON.parse(row.state) as unknown } : null;
  }
}
