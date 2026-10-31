export const TROOP_TYPES = ['LANCER', 'ARCHER', 'GRIFFIN'] as const;
export type TroopType = (typeof TROOP_TYPES)[number];

// Each type beats the type it maps to: lancers beat griffins, griffins beat archers, archers beat lancers.
export const BEATS: Readonly<Record<TroopType, TroopType>> = {
  LANCER: 'GRIFFIN',
  GRIFFIN: 'ARCHER',
  ARCHER: 'LANCER',
};

export const EDICT_IDS = [
  'SWIFT_WINGS',
  'SPEAR_WALL',
  'ARROW_STORM',
  'GOLDEN_TIDE',
  'MUSTER',
  'ARCHITECTS',
  'WIND_READERS',
  'BULWARKS',
  'PLUNDERERS',
  'LEGEND',
  'VETERANS',
] as const;
export type EdictId = (typeof EDICT_IDS)[number];

export const PERSONALITIES = ['RAIDER', 'BUILDER', 'WARDEN', 'CLIMBER'] as const;
export type Personality = (typeof PERSONALITIES)[number];

// Compass directions, clockwise from north. The engine's wind vectors depend on this order.
export const WIND_DIRECTIONS = 8;

export const MINUTE_MS = 60_000;
