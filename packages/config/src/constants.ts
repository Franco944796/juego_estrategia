// Points bought with lord levels. Troop recovery is not here: each league fixes it (config `league`).
export const SKILL_IDS = ['GOLD', 'TROOPS', 'ATTACK'] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export const GEAR_SLOTS = ['WEAPON', 'ARMOR', 'HELMET', 'CLOAK', 'BOOTS', 'RING', 'AMULET', 'CHEST'] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];

/** What an item in each slot improves, by its rarity bonus. */
export const GEAR_EFFECTS: Readonly<
  Record<
    GearSlot,
    'attack' | 'defense' | 'walls' | 'troopProd' | 'speed' | 'goldProd' | 'killGold' | 'refund'
  >
> = {
  WEAPON: 'attack',
  ARMOR: 'defense',
  HELMET: 'walls',
  CLOAK: 'troopProd',
  BOOTS: 'speed',
  RING: 'goldProd',
  /** Gold paid per enemy troop killed, attacking or defending. */
  AMULET: 'killGold',
  /** Share of the gold spent upgrading a town that comes back when the town is lost. */
  CHEST: 'refund',
};

export const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Gem colors and what each adds to (see `gems` in the config): the interface's one gem per figure. */
export const GEM_COLORS = ['TOPAZ', 'RUBY', 'SAPPHIRE', 'AMETHYST', 'EMERALD'] as const;
export type GemColor = (typeof GEM_COLORS)[number];

export const PERSONALITIES = ['RAIDER', 'BUILDER', 'WARDEN', 'CLIMBER'] as const;
export type Personality = (typeof PERSONALITIES)[number];

// Compass directions, clockwise from north. The engine's wind vectors depend on this order.
export const WIND_DIRECTIONS = 8;

export const MINUTE_MS = 60_000;
