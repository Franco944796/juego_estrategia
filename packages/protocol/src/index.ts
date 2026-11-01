import type { Command, DomainEvent, LordView, RuleError, SendPreview, Troops } from '@si/engine';

/** Messages and REST payloads shared by apps/server and apps/client. Types only. */

export interface Medal {
  season: number;
  rank: number;
  of: number;
  /** Index into `rewards.tiers`: 0 is the top band. */
  tier: number;
  legacy: number;
}

export interface PublicAccount {
  id: string;
  name: string;
  legacy: number;
  legacyTotal: number;
  styles: string[];
  style: string;
  medals: Medal[];
}

export interface SeasonSummary {
  id: number;
  startsAt: number;
  endsAt: number;
}

export interface StandingRow {
  rank: number;
  lordId: string;
  name: string;
  color: string;
  dominion: number;
  towns: number;
}

export interface Reward {
  lordId: string;
  rank: number;
  tier: number;
  legacy: number;
}

export interface ClockInfo {
  gameNow: number;
  /** Game milliseconds per real millisecond; 0 while paused or after the season. */
  rate: number;
  speed: number;
  timeScale: number;
}

export type ClientMessage =
  | { type: 'command'; id: number; command: Command }
  | { type: 'preview'; id: number; from: number; to: number; troops: Troops };

export type ServerMessage =
  | { type: 'view'; view: LordView; clock: ClockInfo }
  | { type: 'events'; events: DomainEvent[] }
  | { type: 'result'; id: number; error: RuleError | null }
  | { type: 'preview'; id: number; preview: SendPreview }
  | {
      type: 'season';
      finished: SeasonSummary;
      next: SeasonSummary;
      reward: Reward | null;
      top: StandingRow[];
    };

export interface SessionResponse {
  token: string;
  account: PublicAccount;
}

export interface MeResponse {
  account: PublicAccount;
  joined: boolean;
  season: SeasonSummary;
}

export interface HallResponse {
  current: SeasonSummary;
  seasons: { id: number; startsAt: number; endsAt: number; top: StandingRow[] }[];
}

export interface ErrorResponse {
  error: string;
}
