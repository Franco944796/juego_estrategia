import { defaultConfig } from './defaults';
import { withOverrides } from './overrides';

// The online world runs in real time for a month instead of 6 accelerated hours. Marches and the
// wind keep a human scale (minutes, hours); the economy is slowed so towns grow over weeks.
const PRODUCTION_DIVISOR = 5;
const COST_FACTOR = 40;
const PLUNDER_FACTOR = 5;
const SEASON_DAYS = 30;
const MINUTES_PER_DAY = 24 * 60;

export const liveConfig = withOverrides(defaultConfig, {
  season: { durationMin: SEASON_DAYS * MINUTES_PER_DAY },
  wind: { shiftEveryMin: 180 },
  towns: {
    goldPerMin: defaultConfig.towns.goldPerMin / PRODUCTION_DIVISOR,
    troopsPerMin: defaultConfig.towns.troopsPerMin / PRODUCTION_DIVISOR,
    upgradeCost: defaultConfig.towns.upgradeCost * COST_FACTOR,
    // Brakes on the month-long snowball; chosen with tools/sim (docs/BALANCE.md, live section).
    homeFort: 3,
    sprawl: { freeTowns: 6, penaltyPerTown: 0.1 },
  },
  plunder: { base: defaultConfig.plunder.base * PLUNDER_FACTOR },
  lords: { startGold: 400, capitalTier: 1 },
  bots: { thinkEveryMin: 15, jitterMin: 5 },
  rules: { capitalImmune: true },
  demo: { timeScale: 1 },
});
