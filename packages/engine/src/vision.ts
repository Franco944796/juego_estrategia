import type { GameState } from './types';
import { isleNeighbors } from './world';

/** Isles where the lord sees garrison sizes: own isles plus `vision.hops` lanes (more from a lit beacon). */
export function visibleIsles(state: GameState, lordId: string): Set<number> {
  const cfg = state.config;
  const adj = isleNeighbors(state);
  const visible = new Set<number>();
  const owned = new Set<number>();
  for (const town of state.towns) if (town.owner === lordId) owned.add(town.isleId);

  for (const start of owned) {
    const isle = state.isles[start];
    const hops = cfg.vision.hops + (isle?.beaconOwner === lordId ? cfg.beacon.visionHops : 0);
    // Visited is per start: an isle already seen from a shorter-range isle must still be expanded.
    const seen = new Set([start]);
    let frontier = [start];
    for (let depth = 0; depth < hops; depth++) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const n of adj[id] ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    for (const id of seen) visible.add(id);
  }
  return visible;
}
