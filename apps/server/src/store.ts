import { DatabaseSync } from 'node:sqlite';
import type { ChatMessage, ClanMedal, ClanMember, ClanRole, ClanSummary, Medal } from '@si/protocol';

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

export type LogKind = 'join' | 'command' | 'style' | 'clan';

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
CREATE TABLE IF NOT EXISTS clans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
  medals TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clan_members (
  account_id TEXT PRIMARY KEY,
  clan_id TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clan_requests (
  clan_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (clan_id, account_id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_by_channel ON chat_messages (channel, id);
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

  /** Closes a season without results; the hall of fame and rewards skip it. */
  abandonSeason(id: number): void {
    this.db.prepare("UPDATE seasons SET status = 'abandoned' WHERE id = ?").run(id);
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

  createClan(id: string, name: string, tag: string, now: number): void {
    this.db
      .prepare('INSERT INTO clans (id, name, tag, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, tag, now);
  }

  clanNameTaken(name: string, tag: string): boolean {
    return this.db.prepare('SELECT 1 FROM clans WHERE name = ? OR tag = ?').get(name, tag) !== undefined;
  }

  deleteClan(id: string): void {
    this.db.prepare('DELETE FROM clan_requests WHERE clan_id = ?').run(id);
    this.db.prepare('DELETE FROM clan_members WHERE clan_id = ?').run(id);
    this.db.prepare('DELETE FROM clans WHERE id = ?').run(id);
  }

  clan(id: string): ClanSummary | null {
    const row = this.db
      .prepare(
        'SELECT c.id, c.name, c.tag, c.medals, (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS members FROM clans c WHERE c.id = ?',
      )
      .get(id) as { id: string; name: string; tag: string; medals: string; members: number } | undefined;
    return row ? { ...row, medals: JSON.parse(row.medals) as ClanMedal[] } : null;
  }

  clans(search: string, limit: number): ClanSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.name, c.tag, c.medals, (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS members
         FROM clans c WHERE c.name LIKE ? OR c.tag LIKE ? ORDER BY members DESC, c.name LIMIT ?`,
      )
      .all(`%${search}%`, `%${search}%`, limit) as {
      id: string;
      name: string;
      tag: string;
      medals: string;
      members: number;
    }[];
    return rows.map((r) => ({ ...r, medals: JSON.parse(r.medals) as ClanMedal[] }));
  }

  addClanMedal(id: string, medal: ClanMedal): void {
    const clan = this.clan(id);
    if (!clan) return;
    this.db
      .prepare('UPDATE clans SET medals = ? WHERE id = ?')
      .run(JSON.stringify([...clan.medals, medal]), id);
  }

  membership(accountId: string): { clanId: string; role: ClanRole } | null {
    const row = this.db
      .prepare('SELECT clan_id, role FROM clan_members WHERE account_id = ?')
      .get(accountId) as { clan_id: string; role: ClanRole } | undefined;
    return row ? { clanId: row.clan_id, role: row.role } : null;
  }

  members(clanId: string): ClanMember[] {
    const rows = this.db
      .prepare(
        `SELECT m.account_id, a.name, m.role, m.joined_at FROM clan_members m JOIN accounts a ON a.id = m.account_id
         WHERE m.clan_id = ? ORDER BY m.joined_at, m.account_id`,
      )
      .all(clanId) as { account_id: string; name: string; role: ClanRole; joined_at: number }[];
    return rows.map((r) => ({ accountId: r.account_id, name: r.name, role: r.role, joinedAt: r.joined_at }));
  }

  addMember(clanId: string, accountId: string, role: ClanRole, now: number): void {
    this.db
      .prepare('INSERT INTO clan_members (account_id, clan_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(accountId, clanId, role, now);
    this.db.prepare('DELETE FROM clan_requests WHERE account_id = ?').run(accountId);
  }

  removeMember(accountId: string): void {
    this.db.prepare('DELETE FROM clan_members WHERE account_id = ?').run(accountId);
  }

  setRole(accountId: string, role: ClanRole): void {
    this.db.prepare('UPDATE clan_members SET role = ? WHERE account_id = ?').run(role, accountId);
  }

  requests(clanId: string): { accountId: string; name: string; at: number }[] {
    const rows = this.db
      .prepare(
        `SELECT r.account_id, a.name, r.at FROM clan_requests r JOIN accounts a ON a.id = r.account_id
         WHERE r.clan_id = ? ORDER BY r.at`,
      )
      .all(clanId) as { account_id: string; name: string; at: number }[];
    return rows.map((r) => ({ accountId: r.account_id, name: r.name, at: r.at }));
  }

  addRequest(clanId: string, accountId: string, now: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO clan_requests (clan_id, account_id, at) VALUES (?, ?, ?)')
      .run(clanId, accountId, now);
  }

  hasRequest(clanId: string, accountId: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM clan_requests WHERE clan_id = ? AND account_id = ?')
        .get(clanId, accountId) !== undefined
    );
  }

  removeRequest(clanId: string, accountId: string): void {
    this.db.prepare('DELETE FROM clan_requests WHERE clan_id = ? AND account_id = ?').run(clanId, accountId);
  }

  /** Stores a message and keeps only the newest `keep` of its channel. */
  addMessage(
    channel: string,
    accountId: string,
    name: string,
    text: string,
    at: number,
    keep: number,
  ): number {
    const info = this.db
      .prepare('INSERT INTO chat_messages (channel, account_id, name, text, at) VALUES (?, ?, ?, ?, ?)')
      .run(channel, accountId, name, text, at);
    this.db
      .prepare(
        'DELETE FROM chat_messages WHERE channel = ? AND id NOT IN (SELECT id FROM chat_messages WHERE channel = ? ORDER BY id DESC LIMIT ?)',
      )
      .run(channel, channel, keep);
    return Number(info.lastInsertRowid);
  }

  messages(channel: string, limit: number): Omit<ChatMessage, 'channel'>[] {
    const rows = this.db
      .prepare(
        'SELECT id, account_id, name, text, at FROM chat_messages WHERE channel = ? ORDER BY id DESC LIMIT ?',
      )
      .all(channel, limit) as { id: number; account_id: string; name: string; text: string; at: number }[];
    return rows
      .reverse()
      .map((r) => ({ id: r.id, accountId: r.account_id, name: r.name, text: r.text, at: r.at }));
  }
}
