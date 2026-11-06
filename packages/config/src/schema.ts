import { z } from 'zod';

const positive = z.number().positive();
const nonNegative = z.number().nonnegative();
const fraction = z.number().min(0).max(1);
const count = z.number().int().min(1);
const intNonNegative = z.number().int().nonnegative();

const perSkill = z.object({ GOLD: nonNegative, TROOPS: nonNegative, ATTACK: nonNegative });
const perRarity = <T extends z.ZodType>(value: T) =>
  z.object({ COMMON: value, RARE: value, EPIC: value, LEGENDARY: value });

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
  /** Looks at other isles only once the share of neutral towns left on the source's isle is at most this. */
  crossFreeShare: fraction,
  /** Weight of targets on another isle against those at home. */
  crossWeight: nonNegative,
  /** Share of skill points the bot puts in each skill. */
  skillWeights: perSkill,
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
      spawn: z.object({
        slots: count,
        privateTowns: intNonNegative,
        privateSpacing: positive,
        /** A new capital is drawn among this share of neutral towns farthest from other capitals. */
        farShare: z.number().gt(0).max(1),
      }),
      growth: z.object({
        /** Off: the season keeps its first isle; joining fails once its shore slots are taken. */
        enabled: z.boolean(),
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
    combat: z.object({ lossExponent: positive }),
    towns: z.object({
      maxTier: z.number().int().min(2),
      /**
       * Everything that grows with the level is multiplied by `second` at level 2 and by `top` at
       * maxTier, growing fastest at first (see levelScale in the engine).
       */
      scale: z.object({ second: z.number().gt(1), top: z.number().gt(1) }),
      /** Values at level 1, multiplied by the level scale. */
      goldPerMin: nonNegative,
      troopsPerMin: nonNegative,
      walls: nonNegative,
      /** Cost from level 1 to 2; from level L it is this times the scale of L. */
      upgradeCost: positive,
      fortPerTier: nonNegative,
      capitalFort: z.number().min(1),
      capitalProdMult: positive,
      homeFort: z.number().min(1),
      homeRadius: positive,
      sprawl: z.object({ freeTowns: intNonNegative, penaltyPerTown: nonNegative }),
    }),
    neutral: z.object({
      /** Garrison per level, for the levels neutral towns can have. */
      garrison: z.array(intNonNegative),
      regenMult: nonNegative,
    }),
    /** Gold taken on capture: `base` times the level scale of the town. */
    plunder: z.object({ base: nonNegative }),
    /** Dominion per minute per town level. */
    dominion: z.object({ perTier: nonNegative }),
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
    /** Rewards per enemy troop killed, attacking or defending. */
    kills: z.object({
      xp: z.object({ attack: nonNegative, defend: nonNegative }),
      gold: z.object({ attack: nonNegative, defend: nonNegative }),
    }),
    /** Bonus per skill point (0.05 = +5 %), added up, not compounded. */
    skills: z.object({ perPoint: perSkill }),
    gear: z.object({
      /** Bonus of an item by rarity (0.03 = +3 %), added to the skill bonus of the same kind. */
      rarityBonus: perRarity(fraction),
      /** The chest's refund by rarity (0.5 = half the gold invested in a lost town comes back). */
      refundByRarity: perRarity(fraction),
      /** A lord finds one item every this many levels. */
      dropEveryLevels: count,
      /** Rarity weights (common, rare, epic, legendary) by lord level: the last row reached applies. */
      dropOdds: z.array(z.object({ minLevel: count, weights: z.array(nonNegative).length(4) })).min(1),
      /** Legacy price of an item in the online shop. */
      prices: perRarity(intNonNegative),
      /** Bonus each level past the first adds, by rarity, on top of `rarityBonus` (the chest never levels). */
      levelBonus: perRarity(fraction),
      maxItemLevel: count,
      /** Duplicates pile up as copies: going from level n to n + 1 takes `copiesPerLevel` × n of them. */
      copiesPerLevel: count,
      /** Scrap a destroyed item gives, by rarity (plus half the scrap put into it). */
      scrapByRarity: perRarity(intNonNegative),
      /** Scrap to go from level n to n + 1 is `upgradeScrap` × n. */
      upgradeScrap: count,
      /** Gem sockets of an item by rarity. */
      sockets: perRarity(intNonNegative),
    }),
    gems: z.object({
      maxLevel: count,
      /** Each level past the first adds this share of the gem's base value (its league's `gemBonus`). */
      levelShare: fraction,
    }),
    /**
     * Power (troops + walls) of the lord attacked over the attacker's: below `forbidBelow` it cannot be
     * attacked, below `halfBelow` kills pay `lowXp`, from `doubleFrom` they pay `highXp`.
     */
    power: z.object({
      forbidBelow: fraction,
      halfBelow: fraction,
      doubleFrom: z.number().min(1),
      lowXp: nonNegative,
      highXp: nonNegative,
    }),
    /** League rules: share of a lord's dead troops that reappear in its capital. */
    league: z.object({ attackerRecovery: fraction, defenderRecovery: fraction }),
    march: z.object({
      landSpeed: positive,
      skySpeed: positive,
      minDurationMin: nonNegative,
      /** Each digit of the troop count beyond the first adds this much travel time (5 = +500 %). */
      perDigit: nonNegative,
      minTroops: count,
      maxActivePerLord: count,
    }),
    vision: z.object({ hops: intNonNegative }),
    lords: z.object({
      startGold: nonNegative,
      startTroops: intNonNegative,
      capitalTier: count,
    }),
    exile: z.object({ enabled: z.boolean(), troops: intNonNegative }),
    bots: z.object({
      thinkEveryMin: positive,
      jitterMin: nonNegative,
      targetsPerTown: count,
      /** Unseen lord garrisons are guessed as this many minutes of the town's production. */
      guessMin: nonNegative,
      /** A safe town keeps this many minutes of its production before pushing troops to the front. */
      hoardMin: nonNegative,
      /** Attacks across the lanes send what the siege needs times this, not the whole garrison. */
      crossSlack: positive,
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
    /** Lord levels: from level L the next one needs `xpBase` times the town level scale of L. */
    levels: z.object({
      xpBase: positive,
      maxLevel: count,
      /** Troops given at each new level: this times the town level scale of the level reached. */
      troopsReward: nonNegative,
    }),
    /**
     * Online leagues, lowest first, each its own world. At the season end the top `promoteShare` of
     * the ranking go up one league and the bottom `relegateShare` go down one; Legacy is × `legacyMult`.
     */
    leagues: z
      .array(
        z.object({
          id: z.string().min(1),
          legacyMult: positive,
          promoteShare: fraction,
          relegateShare: fraction,
          /** What a level-1 gem won in this league adds (0.025 = +2.5 %). */
          gemBonus: fraction,
        }),
      )
      .min(1),
    rewards: z.object({
      tiers: z
        .array(z.object({ topShare: z.number().gt(0).max(1), legacy: intNonNegative, gems: intNonNegative }))
        .min(1),
    }),
    cosmetics: z.object({
      styles: z.array(z.object({ id: z.string().min(1), cost: intNonNegative })).min(1),
    }),
  })
  .superRefine((c, ctx) => {
    const tiers = c.towns.maxTier;
    if (c.towns.scale.top <= c.towns.scale.second) {
      ctx.addIssue({ code: 'custom', message: 'towns.scale.top must exceed towns.scale.second' });
    }
    const neutralTiers = Math.max(...c.map.isle.tiers, c.throne.tier, c.lords.capitalTier);
    if (c.neutral.garrison.length < neutralTiers) {
      ctx.addIssue({ code: 'custom', message: `neutral.garrison needs ${neutralTiers} entries` });
    }
    if (c.levels.maxLevel > tiers) {
      ctx.addIssue({ code: 'custom', message: 'levels.maxLevel exceeds towns.maxTier' });
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
    const minLevels = c.gear.dropOdds.map((row) => row.minLevel);
    if (minLevels.some((m, i) => i > 0 && m <= (minLevels[i - 1] ?? 0))) {
      ctx.addIssue({ code: 'custom', message: 'gear.dropOdds must ascend by minLevel' });
    }
    if (c.leagues[0]?.relegateShare !== 0 || c.leagues.at(-1)?.promoteShare !== 0) {
      ctx.addIssue({ code: 'custom', message: 'nobody leaves the lowest league down or the top one up' });
    }
    const shares = c.rewards.tiers.map((tier) => tier.topShare);
    if (shares.some((s, i) => i > 0 && s <= (shares[i - 1] ?? 0)) || shares.at(-1) !== 1) {
      ctx.addIssue({ code: 'custom', message: 'rewards.tiers must ascend and end at topShare 1' });
    }
    if (c.cosmetics.styles[0]?.cost !== 0) {
      ctx.addIssue({ code: 'custom', message: 'the first cosmetic style is the free default' });
    }
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type PersonalityConfig = z.infer<typeof personality>;
