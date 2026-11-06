import type { GameConfig, GearSlot, GemColor, Personality, Rarity, SkillId } from '@si/config';

export type { GameConfig, GearSlot, GemColor, Personality, Rarity, SkillId };

/** Equipment belongs to the player's account and outlives seasons; the season state keeps a copy. */
export interface Item {
  id: string;
  slot: GearSlot;
  rarity: Rarity;
  /** 1 when left out. */
  level?: number;
  /** Duplicates gathered toward the next level. */
  copies?: number;
  /** Scrap put into it; destroying it gives half back. */
  scrap?: number;
  /** Ids of the gems set in its sockets (owned by the same lord). */
  gems?: string[];
}

/** A gem: its color says what it adds, its league how much (see `gems` in the config). */
export interface Gem {
  id: string;
  color: GemColor;
  /** Index into `leagues` of the season it was won in. */
  league: number;
  /** 1 when left out. */
  level?: number;
  /** Duplicates gathered toward the next level. */
  copies?: number;
}

export interface Vec {
  x: number;
  y: number;
}

/** A shore spot where one lord can appear; an isle is full when every slot is taken. */
export interface SpawnSlot {
  pos: Vec;
  lordId: string | null;
}

export interface Isle {
  id: number;
  /** 0 for the first isle, then the ring of isles around it the isle belongs to. */
  ring: number;
  pos: Vec;
  radius: number;
  /** Outline radius multipliers, only used for rendering. */
  shape: number[];
  townIds: number[];
  slots: SpawnSlot[];
  bornAt: number;
}

/** A cluster of about ten towns with its own beacon. */
export interface Zone {
  id: number;
  isleId: number;
  pos: Vec;
  townIds: number[];
  beaconOwner: string | null;
}

export interface Lane {
  a: number;
  b: number;
}

/** Troops a clanmate keeps in someone else's town; they defend it with the owner's garrison. */
export interface Stationed {
  lordId: string;
  troops: number;
}

export interface Town {
  id: number;
  isleId: number;
  pos: Vec;
  /** The town level, 1 to towns.maxTier. */
  tier: number;
  owner: string | null;
  garrison: number;
  /** Fraction of a troop already produced but not yet added to the garrison. */
  carry: number;
  isCapital: boolean;
  isThrone: boolean;
  /** Neutral towns regenerate up to this size; 0 once a lord has owned the town. */
  neutralCap: number;
  stationed: Stationed[];
  zoneId: number | null;
  /** A starter town only this lord can see or target until someone owns it. */
  privateTo: string | null;
  /** Gold its current owner spent upgrading it; part of it comes back if the town is lost (chest). */
  invested: number;
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
  /** Points spent per skill; the unspent ones are level - 1 minus these. */
  skills: Record<SkillId, number>;
  /** Every item the lord owns: brought from its account when joining, or found this season. */
  items: Item[];
  /** Equipped item id per slot. */
  gear: Partial<Record<GearSlot, string>>;
  capitalId: number | null;
  alive: boolean;
  exiles: number;
  stats: LordStats;
  /** Cosmetic town style, chosen outside the season rules. */
  style: string;
  /** Lords sharing a clan are allies: no attacks, shared vision, stationed reinforcements. */
  clanId: string | null;
  /** Season level from battle experience; each level reached gives one skill point. */
  level: number;
  /** Experience toward the next level. */
  xp: number;
  /** A test account (see dev.ts): free upgrades, out of the standings. Left out for everyone else. */
  dev?: boolean;
  /** From destroyed items; spent to level items up. */
  scrap: number;
  /** Every gem the lord owns, set in an item or loose. */
  gems: Gem[];
}

export interface March {
  id: number;
  owner: string;
  from: number;
  to: number;
  troops: number;
  departAt: number;
  arriveAt: number;
  windFactor: number;
  sky: boolean;
  /** Marches of one synchronized group share it (the first march's id) and arrive together. */
  groupId: number | null;
  /** Aimed at a town that was neither own nor allied at departure; only these count for the limit. */
  attack: boolean;
  /** A lone troop sent to look at a town: it never fights and is lost there. Left out otherwise. */
  scout?: boolean;
}

/** What a scout saw; the scouted owner is only told who looked and where. */
export interface ScoutReport {
  id: number;
  at: number;
  townId: number;
  marchId: number;
  scout: string;
  owner: string | null;
  /** The owner's garrison plus allied contingents stationed there. */
  troops: number;
  walls: number;
  fort: number;
  /** What each of the owner's troops counts for: fortification × the owner's defense (skills, gear). */
  defenseMult: number;
  /** Total defense power, as a battle would count it. */
  defense: number;
}

export type BattleWinner = 'ATTACKER' | 'DEFENDER';

export interface BattleReport {
  id: number;
  at: number;
  townId: number;
  marchId: number;
  attacker: string;
  defender: string | null;
  attackerTroops: number;
  defenderTroops: number;
  attackerPower: number;
  defenderPower: number;
  fort: number;
  walls: number;
  /**
   * What each of the owner's troops counted for: fortification × the owner's defense (skills, gear).
   * Missing in reports saved before it was added.
   */
  defenseMult?: number;
  attackerLost: number;
  defenderLost: number;
  /** Lost troops that reappeared in their lords' capitals (league rule); allies count their own. */
  attackerRecovered: number;
  defenderRecovered: number;
  winner: BattleWinner;
  captured: boolean;
  plunder: number;
  /** Gold the lord who lost the town got back from what it had invested in it (chest). */
  refund: number;
  /** Experience multiplier of the attacker from the power of the lord attacked. */
  xpMult: number;
  /** Kill rewards; the defenders' total is split among the defending lords by the power they brought. */
  rewards: { attackerXp: number; attackerGold: number; defenderXp: number; defenderGold: number };
  /** Allied contingents that defended alongside the owner (their troops are included above). */
  allies: { lordId: string; troops: number; lost: number; recovered: number }[];
}

export type ScheduledEvent =
  | { kind: 'MARCH_ARRIVAL'; marchId: number }
  | { kind: 'WIND_SHIFT'; index: number }
  | { kind: 'THRONE_UNSEAL' }
  | { kind: 'SEASON_END' }
  | { kind: 'BOT_TURN'; lordId: string }
  | { kind: 'GROW_CHECK' };

export interface QueueItem {
  dueAt: number;
  seq: number;
  ev: ScheduledEvent;
}

export type SeasonStatus = 'RUNNING' | 'ENDED';

/** Bumped when the state shape changes so much that older saves cannot be loaded. */
export const STATE_VERSION = 5;

export interface GameState {
  version: typeof STATE_VERSION;
  seed: number;
  rng: [number, number, number, number];
  config: GameConfig;
  startsAt: number;
  endsAt: number;
  throneUnsealAt: number;
  throneUnsealed: boolean;
  throneTownId: number | null;
  status: SeasonStatus;
  /** Production is settled up to this instant; it only moves at commands and scheduled events. */
  accruedAt: number;
  isles: Isle[];
  zones: Zone[];
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
  scouts: ScoutReport[];
  nextReportId: number;
  standings: Standing[] | null;
  /** When a growth check is already scheduled (daily isle cap reached), so it is not queued twice. */
  growCheckAt: number | null;
  /** Angle of the first ring of isles, kept so isles born later line up with it. */
  mapSpin: number;
}

export interface LordInit {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  personality?: Personality;
  style?: string;
  items?: Item[];
  gear?: Partial<Record<GearSlot, string>>;
  clanId?: string | null;
  scrap?: number;
  gems?: Gem[];
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
  level: number;
  towns: number;
  alive: boolean;
}

export type Command =
  /** Raises up to `levels` levels (1 if left out) in one go, stopping when the gold runs out. */
  | { type: 'UPGRADE'; townId: number; levels?: number }
  | { type: 'SEND'; from: number; to: number; troops: number }
  /** Every listed own town sends all its troops; they arrive together and fight as one army. */
  | { type: 'SEND_GROUP'; from: number[]; to: number }
  /** One troop goes to look at a foreign town; it reports the defense and does not come back. */
  | { type: 'SCOUT'; from: number; to: number }
  | { type: 'LEARN_SKILL'; skill: SkillId }
  | { type: 'EQUIP'; itemId: string }
  /** An unequipped item becomes scrap. */
  | { type: 'DESTROY_ITEM'; itemId: string }
  /** Spends scrap to raise an item one level (not the chest). */
  | { type: 'UPGRADE_ITEM'; itemId: string }
  /** Sets a loose gem in a free socket of an item; taking it out puts it back in the bag. */
  | { type: 'SOCKET_GEM'; itemId: string; gemId: string }
  | { type: 'UNSOCKET_GEM'; itemId: string; gemId: string };

export type RuleId =
  | 'R01'
  | 'R02'
  | 'R03'
  | 'R04'
  | 'R05'
  | 'R07'
  | 'R08'
  | 'R09'
  | 'R10'
  | 'R11'
  | 'R12'
  | 'R13'
  | 'R14'
  | 'R15'
  | 'R16'
  | 'R17'
  | 'R18'
  | 'R19'
  | 'R20';

export interface RuleError {
  rule: RuleId;
  code: string;
  message: string;
}

export type ExecResult =
  { ok: true; events: DomainEvent[] } | { ok: false; error: RuleError; events: DomainEvent[] };

export type DomainEvent =
  | { type: 'TOWN_UPGRADED'; at: number; lordId: string; townId: number; tier: number; cost: number }
  | { type: 'MARCH_LAUNCHED'; at: number; march: March }
  | { type: 'MARCH_REINFORCED'; at: number; march: March }
  | { type: 'BATTLE'; at: number; report: BattleReport }
  | { type: 'SCOUTED'; at: number; report: ScoutReport }
  | { type: 'TOWN_CAPTURED'; at: number; townId: number; from: string | null; to: string }
  | { type: 'CAPITAL_MOVED'; at: number; lordId: string; townId: number | null }
  | { type: 'BEACON_CHANGED'; at: number; zoneId: number; owner: string | null }
  | { type: 'WIND_SHIFTED'; at: number; dir: number }
  | { type: 'THRONE_UNSEALED'; at: number }
  | { type: 'SKILL_LEARNED'; at: number; lordId: string; skill: SkillId; points: number }
  /** `into`: the owned item a duplicate joined as a copy, as it is now. */
  | { type: 'ITEM_FOUND'; at: number; lordId: string; item: Item; source: 'LEVEL' | 'SHOP'; into?: Item }
  | { type: 'ITEM_DESTROYED'; at: number; lordId: string; item: Item; scrap: number }
  | { type: 'ITEM_UPGRADED'; at: number; lordId: string; item: Item; cost: number }
  | { type: 'GEM_SOCKETED'; at: number; lordId: string; itemId: string; gemId: string }
  | { type: 'GEM_UNSOCKETED'; at: number; lordId: string; itemId: string; gemId: string }
  | { type: 'ITEM_EQUIPPED'; at: number; lordId: string; item: Item }
  | { type: 'LORD_EXILED'; at: number; lordId: string; townId: number }
  | { type: 'LORD_ELIMINATED'; at: number; lordId: string }
  | { type: 'LORD_JOINED'; at: number; lordId: string; townId: number }
  | { type: 'MAP_EXPANDED'; at: number; isleIds: number[] }
  | { type: 'MARCH_REPELLED'; at: number; march: March }
  | { type: 'MARCH_STATIONED'; at: number; march: March }
  | { type: 'CLAN_CHANGED'; at: number; lordId: string; clanId: string | null }
  /** `troops`: the reward placed in the capital (0 with no town to put them in). */
  | { type: 'LEVEL_UP'; at: number; lordId: string; level: number; troops: number }
  | { type: 'STYLE_CHANGED'; at: number; lordId: string; style: string }
  | { type: 'SEASON_ENDED'; at: number; standings: Standing[] };
