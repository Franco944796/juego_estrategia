import { defaultConfig } from './defaults';
import { withOverrides } from './overrides';

// The online world runs in real time for a month instead of 6 accelerated hours. Marches and the
// wind keep a human scale (minutes, hours); the economy is slowed so towns grow over weeks.
const PRODUCTION_DIVISOR = 20;
const COST_FACTOR = 5;
const GLORY_FACTOR = 5;
const SEASON_DAYS = 30;
const MINUTES_PER_DAY = 24 * 60;

const slower = (table: number[]): number[] => table.map((v) => v / PRODUCTION_DIVISOR);
const pricier = (table: number[]): number[] => table.map((v) => v * COST_FACTOR);

export const liveConfig = withOverrides(defaultConfig, {
  season: { durationMin: SEASON_DAYS * MINUTES_PER_DAY },
  wind: { shiftEveryMin: 180 },
  towns: {
    goldPerMin: slower(defaultConfig.towns.goldPerMin),
    troopsPerMin: slower(defaultConfig.towns.troopsPerMin),
    upgradeCost: pricier(defaultConfig.towns.upgradeCost),
    respecCostPerTier: defaultConfig.towns.respecCostPerTier * COST_FACTOR,
    // Brakes on the month-long snowball; chosen with tools/sim (docs/BALANCE.md, live section).
    homeIsleFort: 3,
    sprawl: { freeTowns: 6, penaltyPerTown: 0.1 },
  },
  plunder: { goldByTier: pricier(defaultConfig.plunder.goldByTier) },
  // Kept at the value the live brakes were measured with; the demo uses a weaker Throne.
  throne: { garrison: 300 },
  lords: { startGold: 300, capitalTier: 1 },
  edicts: { gloryThresholds: defaultConfig.edicts.gloryThresholds.map((g) => g * GLORY_FACTOR) },
  bots: { thinkEveryMin: 15, jitterMin: 5 },
  rules: { capitalImmune: true },
  demo: { timeScale: 1 },
});
