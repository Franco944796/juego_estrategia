import { liveConfig, withOverrides } from '@si/config';
import { Store, type Account } from '../src/store';
import { WorldService } from '../src/world';

export const T0 = 1_800_000_000_000;
export const MIN = 60_000;
export const config = withOverrides(liveConfig, { season: { durationMin: 120 } });

export interface Clock {
  t: number;
  now: () => number;
}

export function clock(start = T0): Clock {
  const c: Clock = { t: start, now: () => c.t };
  return c;
}

export function world(store: Store, c: Clock): WorldService {
  return new WorldService({ store, config, now: c.now, random: () => 0.25, snapshotEveryMs: 5 * MIN });
}

export function account(store: Store, name: string, c: Clock): Account {
  return store.createAccount(`id-${name}`, name, `hash-${name}`, 'classic', c.t);
}
