import type { EdictId, GameConfig, Personality, TroopType } from '@si/config';

export type { EdictId, GameConfig, Personality, TroopType };

export type Troops = Record<TroopType, number>;

export interface Vec {
  x: number;
  y: number;
}

export interface Isle {
  id: number;
  ring: number;
  pos: Vec;
  radius: number;
  /** Outline radius multipliers, only used for rendering. */
  shape: number[];
  townIds: number[];
  hasBeacon: boolean;
  beaconOwner: string | null;
}

export interface Lane {
  a: number;
  b: number;
}

export interface Town {
  id: number;
  isleId: number;
  pos: Vec;
  tier: number;
  spec: TroopType;
  owner: string | null;
  garrison: Troops;
  /** Fraction of a troop already produced but not yet added to the garrison. */
  carry: number;
  isCapital: boolean;
  isThrone: boolean;
  /** Neutral towns regenerate up to this size; 0 once a lord has owned the town. */
  neutralCap: number;
}

export interface LordStats {
  captures: number;
  townsLost: number;
  battlesWon: number;
  battlesLost: number;
  troopsKilled: number;
  troopsLost: number;
}

export interface Lord {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  personality: Personality | null;
  gold: number;
  dominion: number;
  glory: number;
  edicts: EdictId[];
  draft: EdictId[] | null;
  /** Glory thresholds already turned into drafts. */
  draftsOpened: number;
  capitalId: number | null;
  alive: boolean;
  exiles: number;
  stats: LordStats;
  /** Cosmetic town style, chosen outside the season rules. */
  style: string;
}

export interface March {
  id: number;
  owner: string;
  from: number;
  to: number;
  troops: Troops;
  departAt: number;
  arriveAt: number;
  windFactor: number;
  sky: boolean;
}

export type BattleWinner = 'ATTACKER' | 'DEFENDER';

export interface BattleReport {
  id: number;
  at: number;
  townId: number;
  marchId: number;
  attacker: string;
  defender: string | null;
  attackerTroops: Troops;
  defenderTroops: Troops;
  attackerPower: number;
  defenderPower: number;
  fort: number;
  attackerLost: Troops;
  defenderLost: Troops;
  winner: BattleWinner;
  captured: boolean;
  plunder: number;
}

export type ScheduledEvent =
  | { kind: 'MARCH_ARRIVAL'; marchId: number }
  | { kind: 'WIND_SHIFT'; index: number }
  | { kind: 'THRONE_UNSEAL' }
  | { kind: 'SEASON_END' }
  | { kind: 'BOT_TURN'; lordId: string };

export interface QueueItem {
  dueAt: number;
  seq: number;
  ev: ScheduledEvent;
}

export type SeasonStatus = 'RUNNING' | 'ENDED';

export interface GameState {
  version: 1;
  seed: number;
  rng: [number, number, number, number];
  config: GameConfig;
  startsAt: number;
  endsAt: number;
  throneUnsealAt: number;
  throneUnsealed: boolean;
  throneTownId: number;
  status: SeasonStatus;
  /** Production is settled up to this instant; it only moves at commands and scheduled events. */
  accruedAt: number;
  isles: Isle[];
  lanes: Lane[];
  towns: Town[];
  lords: Record<string, Lord>;
  lordOrder: string[];
  /** Wind direction per shift window: index k applies from startsAt + k × shiftEveryMin. */
  windDirs: number[];
  marches: March[];
  nextMarchId: number;
  queue: QueueItem[];
  seq: number;
  reports: BattleReport[];
  nextReportId: number;
  standings: Standing[] | null;
}

export interface LordInit {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  personality?: Personality;
  spec?: TroopType;
  style?: string;
}

export interface CreateGameParams {
  seed: number;
  config: GameConfig;
  startsAt: number;
  lords: LordInit[];
}

export interface Standing {
  rank: number;
  lordId: string;
  name: string;
  color: string;
  dominion: number;
  glory: number;
  towns: number;
  alive: boolean;
}

export type Command =
  | { type: 'UPGRADE'; townId: number }
  | { type: 'RESPECIALIZE'; townId: number; spec: TroopType }
  | { type: 'SEND'; from: number; to: number; troops: Troops }
  | { type: 'CHOOSE_EDICT'; edict: EdictId };

export type RuleId =
  | 'R01'
  | 'R02'
  | 'R03'
  | 'R04'
  | 'R05'
  | 'R06'
  | 'R07'
  | 'R08'
  | 'R09'
  | 'R10'
  | 'R11'
  | 'R12'
  | 'R13'
  | 'R14'
  | 'R15';

export interface RuleError {
  rule: RuleId;
  code: string;
  message: string;
}

export type ExecResult =
  { ok: true; events: DomainEvent[] } | { ok: false; error: RuleError; events: DomainEvent[] };

export type DomainEvent =
  | { type: 'TOWN_UPGRADED'; at: number; lordId: string; townId: number; tier: number; cost: number }
  | {
      type: 'TOWN_RESPECIALIZED';
      at: number;
      lordId: string;
      townId: number;
      spec: TroopType;
      cost: number;
    }
  | { type: 'MARCH_LAUNCHED'; at: number; march: March }
  | { type: 'MARCH_REINFORCED'; at: number; march: March }
  | { type: 'BATTLE'; at: number; report: BattleReport }
  | { type: 'TOWN_CAPTURED'; at: number; townId: number; from: string | null; to: string }
  | { type: 'CAPITAL_MOVED'; at: number; lordId: string; townId: number | null }
  | { type: 'BEACON_CHANGED'; at: number; isleId: number; owner: string | null }
  | { type: 'WIND_SHIFTED'; at: number; dir: number }
  | { type: 'THRONE_UNSEALED'; at: number }
  | { type: 'EDICT_DRAFT'; at: number; lordId: string; options: EdictId[] }
  | { type: 'EDICT_CHOSEN'; at: number; lordId: string; edict: EdictId }
  | { type: 'LORD_EXILED'; at: number; lordId: string; townId: number }
  | { type: 'LORD_ELIMINATED'; at: number; lordId: string }
  | { type: 'LORD_JOINED'; at: number; lordId: string; townId: number }
  | { type: 'MAP_EXPANDED'; at: number; isleIds: number[] }
  | { type: 'MARCH_REPELLED'; at: number; march: March }
  | { type: 'STYLE_CHANGED'; at: number; lordId: string; style: string }
  | { type: 'SEASON_ENDED'; at: number; standings: Standing[] };
