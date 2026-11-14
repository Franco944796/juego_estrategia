import { defaultConfig, liveConfig, withOverrides } from '@si/config';
import { simulateSeason } from './simulate';

const factor = Number(process.argv[2]);
const seed = Number(process.argv[3] ?? 1);
const config = withOverrides(liveConfig, { towns: { upgradeCost: defaultConfig.towns.upgradeCost * factor } });
const m = simulateSeason(config, seed, 8);
console.log(JSON.stringify({ factor, seed, ...m }));
