import { defaultConfig } from './defaults';
import { withOverrides } from './overrides';

// The online world runs in real time for a month instead of 6 accelerated hours. Marches and the
// wind keep a human scale (minutes, hours). Production per minute is the demo's, for a brisk pace
// (docs/BALANCE.md); upgrades cost more, so towns still take days to reach the top level.
const COST_FACTOR = 40;
const PLUNDER_FACTOR = 5;
const SEASON_DAYS = 30;
const MINUTES_PER_DAY = 24 * 60;

export const liveConfig = withOverrides(defaultConfig, {
  season: { durationMin: SEASON_DAYS * MINUTES_PER_DAY },
  wind: { shiftEveryMin: 180 },
  march: {
    landSpeed: defaultConfig.march.landSpeed * defaultConfig.demo.timeScale,
    skySpeed: defaultConfig.march.skySpeed * defaultConfig.demo.timeScale,
    minDurationMin: defaultConfig.march.minDurationMin / defaultConfig.demo.timeScale,
  },
  towns: {
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
