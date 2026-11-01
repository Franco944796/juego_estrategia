import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveConfig } from '@si/config';
import { buildApp } from './app';
import { Store } from './store';
import { WorldService } from './world';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? resolve(here, '../data/shattered-isles.db');
const SNAPSHOT_EVERY_MS = 5 * 60_000;
/** Upper bound between ticks, so views and snapshots keep flowing on a quiet world. */
const MAX_SLEEP_MS = 1000;
// Only for end-to-end tests: game time runs TIME_SCALE times faster than the wall clock.
const TIME_SCALE = Number(process.env.TIME_SCALE ?? 1);
const EPOCH = Date.now();
const now = (): number => EPOCH + Math.round((Date.now() - EPOCH) * TIME_SCALE);

mkdirSync(dirname(DB_PATH), { recursive: true });
const store = new Store(DB_PATH);
const world = new WorldService({
  store,
  config: liveConfig,
  now,
  random: Math.random,
  snapshotEveryMs: SNAPSHOT_EVERY_MS,
});
const app = await buildApp({
  store,
  world,
  config: liveConfig,
  now,
  rate: TIME_SCALE,
  clientDir: resolve(here, '../../client/dist'),
  logger: true,
});

let timer: NodeJS.Timeout | undefined;
const loop = (): void => {
  world.tick();
  timer = setTimeout(loop, Math.min(MAX_SLEEP_MS, world.msUntilNextEvent()));
};
loop();

await app.listen({ host: '0.0.0.0', port: PORT });
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => `http://${a?.address}:${PORT}`);
console.log(`Shattered Isles online: http://localhost:${PORT} ${addresses.join(' ')}`);

const shutdown = async (): Promise<void> => {
  clearTimeout(timer);
  world.snapshot();
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
