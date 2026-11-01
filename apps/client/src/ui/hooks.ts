import { useEffect, useState } from 'react';
import { estimateGameNow, useGame } from '../store';

/** Re-renders every `ms` milliseconds, for countdowns between engine views. */
export function useTicker(ms: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useGameNow(): number {
  const clock = useGame((s) => s.clock);
  const endsAt = useGame((s) => s.view?.season.endsAt ?? 0);
  useTicker(250);
  return estimateGameNow(clock, endsAt);
}
