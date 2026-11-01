import { z } from 'zod';
import { EDICT_IDS, TROOP_TYPES } from './constants';

const positive = z.number().positive();
const nonNegative = z.number().nonnegative();
const fraction = z.number().min(0).max(1);
const count = z.number().int().min(1);
const intNonNegative = z.number().int().nonnegative();

function perTroop<T extends z.ZodType>(value: T) {
  return z.object({ LANCER: value, ARCHER: value, GRIFFIN: value });
}

const troopMultipliers = z.object({
  LANCER: positive.optional(),
  ARCHER: positive.optional(),
  GRIFFIN: positive.optional(),
});

const edictEffect = z.object({
  attack: troopMultipliers.optional(),
  defense: troopMultipliers.optional(),
  speed: troopMultipliers.optional(),
  goldProd: positive.optional(),
  troopProd: positive.optional(),
  upgradeCost: positive.optional(),
  headwindMin: z.number().gt(0).max(1).optional(),
  fort: positive.optional(),
  plunder: positive.optional(),
  dominion: positive.optional(),
  winnerLosses: positive.optional(),
});

const personality = z.object({
  attackMargin: positive,
  lordAggression: nonNegative,
  throneDesire: nonNegative,
  upgradesPerTurn: intNonNegative,
  attacksPerTurn: intNonNegative,
  reinforcementsPerTurn: intNonNegative,
  goldReserve: nonNegative,
  keepHome: fraction,
  minWindFactor: positive,
  minAttackTroops: count,
  preferredSpec: z.enum(TROOP_TYPES),
  edictPreference: z.array(z.enum(EDICT_IDS)),
});

export const gameConfigSchema = z
  .object({
    meta: z.object({ gameTitle: z.string().min(1) }),
    season: z.object({ durationMin: positive }),
    map: z.object({
      isle: z.object({
        towns: count,
        radius: positive,
        shore: positive,
        jitter: nonNegative,
        /** Radius fractions that split an isle into tier bands, inside out. */
        tierBands: z.array(fraction),
        /** Tier of each band, inside out; one more entry than tierBands. */
        tiers: z.array(count),
        zoneSize: count,
      }),
      spawn: z.object({ slots: count, privateTowns: intNonNegative, privateSpacing: positive }),
      growth: z.object({
        isleSpacing: positive,
        maxPerDay: intNonNegative,
        laneNeighbors: count,
        maxLaneLength: positive,
      }),
      shapePoints: z.number().int().min(3),
      shapeJitter: fraction,
    }),
    wind: z.object({
      shiftEveryMin: positive,
      tailwindMax: z.number().min(1),
      headwindMin: z.number().gt(0).max(1),
      forecastShifts: intNonNegative,
      maxStep: z.number().int().min(1).max(4),
    }),
    troops: perTroop(z.object({ attack: positive, defense: positive, speed: positive, prodMult: positive })),
    combat: z.object({ counterBonus: z.number().min(1), lossExponent: positive }),
    towns: z.object({
      maxTier: z.number().int().min(2),
      goldPerMin: z.array(nonNegative),
      troopsPerMin: z.array(nonNegative),
      garrisonCap: z.array(count),
      upgradeCost: z.array(positive),
      respecCostPerTier: nonNegative,
      fortPerTier: nonNegative,
      capitalFort: z.number().min(1),
      capitalProdMult: positive,
      homeFort: z.number().min(1),
      homeRadius: positive,
      sprawl: z.object({ freeTowns: intNonNegative, penaltyPerTown: nonNegative }),
    }),
    neutral: z.object({
      garrison: z.array(intNonNegative),
      mainShare: fraction,
      regenMult: nonNegative,
    }),
    plunder: z.object({ goldByTier: z.array(nonNegative) }),
    dominion: z.object({ perTier: z.array(nonNegative) }),
    beacon: z.object({
      prodBonus: nonNegative,
      dominionPerMin: nonNegative,
      visionHops: intNonNegative,
    }),
    throne: z.object({
      enabled: z.boolean(),
      tier: count,
      garrison: intNonNegative,
      unsealAtFraction: fraction,
      dominionPerMin: nonNegative,
      fortMult: z.number().min(1),
    }),
    glory: z.object({ troopsPerPoint: positive, perCaptureTier: nonNegative }),
    edicts: z.object({
      gloryThresholds: z.array(positive),
      draftSize: count,
      catalog: z.object({
        SWIFT_WINGS: edictEffect,
        SPEAR_WALL: edictEffect,
        ARROW_STORM: edictEffect,
        GOLDEN_TIDE: edictEffect,
        MUSTER: edictEffect,
        ARCHITECTS: edictEffect,
        WIND_READERS: edictEffect,
        BULWARKS: edictEffect,
        PLUNDERERS: edictEffect,
        LEGEND: edictEffect,
        VETERANS: edictEffect,
      }),
    }),
    march: z.object({
      landSpeed: positive,
      skySpeed: positive,
      minDurationMin: nonNegative,
      minTroops: count,
      maxActivePerLord: count,
    }),
    vision: z.object({ hops: intNonNegative }),
    lords: z.object({
      startGold: nonNegative,
      startTroops: perTroop(intNonNegative),
      capitalTier: count,
    }),
    exile: z.object({ enabled: z.boolean(), troops: perTroop(intNonNegative) }),
    bots: z.object({
      thinkEveryMin: positive,
      jitterMin: nonNegative,
      targetsPerTown: count,
      personalities: z.object({
        RAIDER: personality,
        BUILDER: personality,
        WARDEN: personality,
        CLIMBER: personality,
      }),
    }),
    limits: z.object({ reportsKept: count }),
    demo: z.object({
      timeScale: positive,
      bots: count,
      speeds: z.array(positive).min(1),
    }),
    display: z.object({
      suffixes: z.array(z.string()).min(1),
      lordColors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).min(1),
    }),
    rules: z.object({ capitalImmune: z.boolean() }),
    levels: z.object({
      xpPerCaptureTier: positive,
      lordCaptureMult: z.number().min(1),
      xpBase: positive,
      xpGrowth: z.number().min(1),
      troopsBase: intNonNegative,
      troopsPerLevel: intNonNegative,
      goldBonusPerLevel: nonNegative,
      maxLevel: count,
    }),
    rewards: z.object({
      tiers: z.array(z.object({ topShare: z.number().gt(0).max(1), legacy: intNonNegative })).min(1),
    }),
    cosmetics: z.object({
      styles: z.array(z.object({ id: z.string().min(1), cost: intNonNegative })).min(1),
    }),
  })
  .superRefine((c, ctx) => {
    const tiers = c.towns.maxTier;
    const perTier: [string, readonly unknown[]][] = [
      ['towns.goldPerMin', c.towns.goldPerMin],
      ['towns.troopsPerMin', c.towns.troopsPerMin],
      ['towns.garrisonCap', c.towns.garrisonCap],
      ['neutral.garrison', c.neutral.garrison],
      ['plunder.goldByTier', c.plunder.goldByTier],
      ['dominion.perTier', c.dominion.perTier],
    ];
    for (const [path, table] of perTier) {
      if (table.length !== tiers) {
        ctx.addIssue({ code: 'custom', message: `${path} needs ${tiers} entries` });
      }
    }
    if (c.towns.upgradeCost.length !== tiers - 1) {
      ctx.addIssue({ code: 'custom', message: `towns.upgradeCost needs ${tiers - 1} entries` });
    }
    if (c.map.isle.tiers.length !== c.map.isle.tierBands.length + 1) {
      ctx.addIssue({ code: 'custom', message: 'map.isle.tiers needs one entry more than tierBands' });
    }
    if (c.map.isle.tiers.some((tier) => tier > tiers)) {
      ctx.addIssue({ code: 'custom', message: 'map.isle tiers exceed towns.maxTier' });
    }
    if (c.throne.tier > tiers || c.lords.capitalTier > tiers) {
      ctx.addIssue({ code: 'custom', message: 'throne or capital tier exceeds towns.maxTier' });
    }
    const shares = c.rewards.tiers.map((tier) => tier.topShare);
    if (shares.some((s, i) => i > 0 && s <= (shares[i - 1] ?? 0)) || shares.at(-1) !== 1) {
      ctx.addIssue({ code: 'custom', message: 'rewards.tiers must ascend and end at topShare 1' });
    }
    if (c.cosmetics.styles[0]?.cost !== 0) {
      ctx.addIssue({ code: 'custom', message: 'the first cosmetic style is the free default' });
    }

    const thresholds = c.edicts.gloryThresholds;
    if (thresholds.some((t, i) => i > 0 && t <= (thresholds[i - 1] ?? 0))) {
      ctx.addIssue({ code: 'custom', message: 'edicts.gloryThresholds must be ascending' });
    }
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type PersonalityConfig = z.infer<typeof personality>;
export type EdictEffect = z.infer<typeof edictEffect>;
