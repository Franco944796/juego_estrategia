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
// One world per league. Leagues added later start their first season with the lowest one's, so all
// seasons end together.
const worlds: WorldService[] = [];
for (let league = 0; league < liveConfig.leagues.length; league++) {
  worlds.push(
    new WorldService({
      store,
      config: liveConfig,
      now,
      random: Math.random,
      snapshotEveryMs: SNAPSHOT_EVERY_MS,
      league,
      firstStartsAt: worlds[0]?.currentSeason.startsAt,
    }),
  );
}
const app = await buildApp({
  store,
  worlds,
  config: liveConfig,
  now,
  rate: TIME_SCALE,
  clientDir: resolve(here, '../../client/dist'),
  logger: true,
});

let timer: NodeJS.Timeout | undefined;
const loop = (): void => {
  for (const world of worlds) world.tick();
  const next = Math.min(...worlds.map((w) => w.msUntilNextEvent()));
  timer = setTimeout(loop, Math.min(MAX_SLEEP_MS, next));
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
  for (const world of worlds) world.snapshot();
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
