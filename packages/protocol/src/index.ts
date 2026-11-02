import type { Command, DomainEvent, GroupPreview, Item, LordView, RuleError, SendPreview } from '@si/engine';

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
  /** Equipment kept across seasons. */
  items: Item[];
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

export type ChatChannel = 'global' | 'clan';

export interface ChatMessage {
  id: number;
  channel: ChatChannel;
  accountId: string;
  name: string;
  text: string;
  at: number;
}

export type ClanRole = 'leader' | 'officer' | 'member';

export interface ClanMedal {
  season: number;
  dominion: number;
}

export interface ClanSummary {
  id: string;
  name: string;
  tag: string;
  members: number;
  medals: ClanMedal[];
}

export interface ClanMember {
  accountId: string;
  name: string;
  role: ClanRole;
  joinedAt: number;
}

export interface ClanDetail extends ClanSummary {
  memberList: ClanMember[];
  /** Pending join requests; only shown to the leader and officers. */
  requests: { accountId: string; name: string; at: number }[];
}

export interface ClanRankingRow {
  rank: number;
  clanId: string;
  name: string;
  tag: string;
  dominion: number;
  members: number;
}

export interface MyClan {
  id: string;
  name: string;
  tag: string;
  role: ClanRole;
}

export type ClientMessage =
  | { type: 'command'; id: number; command: Command }
  | { type: 'preview'; id: number; from: number; to: number; troops: number }
  | { type: 'previewGroup'; id: number; from: number[]; to: number }
  | { type: 'chat'; channel: ChatChannel; text: string };

export type ServerMessage =
  | { type: 'view'; view: LordView; clock: ClockInfo }
  | { type: 'events'; events: DomainEvent[] }
  | { type: 'result'; id: number; error: RuleError | null }
  | { type: 'preview'; id: number; preview: SendPreview }
  | { type: 'previewGroup'; id: number; preview: GroupPreview }
  | {
      type: 'season';
      finished: SeasonSummary;
      next: SeasonSummary;
      reward: Reward | null;
      top: StandingRow[];
    }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chatHistory'; channel: ChatChannel; messages: ChatMessage[] }
  /** Something about the receiver's clan changed (members, roles, requests): refetch it. */
  | { type: 'clanChanged' };

export interface SessionResponse {
  token: string;
  account: PublicAccount;
}

export interface MeResponse {
  account: PublicAccount;
  joined: boolean;
  season: SeasonSummary;
  clan: MyClan | null;
}

export interface HallResponse {
  current: SeasonSummary;
  seasons: { id: number; startsAt: number; endsAt: number; top: StandingRow[]; clans: ClanRankingRow[] }[];
}

export interface ErrorResponse {
  error: string;
}
