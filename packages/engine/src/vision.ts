import type { GameState } from './types';
import { areAllies, isleNeighbors } from './world';

/**
 * Isles where the lord sees garrison sizes: isles of its own or its clanmates' towns plus `vision.hops`
 * lanes (more from an isle where a friendly beacon is lit).
 */
export function visibleIsles(state: GameState, lordId: string): Set<number> {
  const cfg = state.config;
  const adj = isleNeighbors(state);
  const visible = new Set<number>();
  const owned = new Set<number>();
  const friendly = (id: string | null): boolean => id === lordId || areAllies(state, lordId, id);
  for (const town of state.towns) if (friendly(town.owner)) owned.add(town.isleId);
  const beaconIsles = new Set(state.zones.filter((z) => friendly(z.beaconOwner)).map((z) => z.isleId));

  for (const start of owned) {
    const hops = cfg.vision.hops + (beaconIsles.has(start) ? cfg.beacon.visionHops : 0);
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
