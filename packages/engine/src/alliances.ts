import { accrueTo } from './economy';
import { dispatchMarch } from './marches';
import type { DomainEvent, GameState, Stationed, Town } from './types';
import { areAllies, getLord } from './world';

/** A contingent that may no longer stay marches back to its lord's capital; without one it is lost. */
function sendHome(
  state: GameState,
  town: Town,
  contingent: Stationed,
  at: number,
  events: DomainEvent[],
): void {
  const capitalId = getLord(state, contingent.lordId)?.capitalId;
  const capital = capitalId === null || capitalId === undefined ? undefined : state.towns[capitalId];
  if (capital && capital.id !== town.id)
    dispatchMarch(state, contingent.lordId, town, capital, contingent.troops, at, events);
}

/** Changes a lord's clan; contingents stationed between former allies march home. */
export function setClan(state: GameState, lordId: string, clanId: string | null, at: number): DomainEvent[] {
  const lord = getLord(state, lordId);
  if (!lord || lord.clanId === clanId) return [];
  const events: DomainEvent[] = [];
  accrueTo(state, at);
  lord.clanId = clanId;
  events.push({ type: 'CLAN_CHANGED', at, lordId, clanId });
  for (const town of state.towns) {
    if (town.stationed.length === 0) continue;
    const staying = town.stationed.filter((s) => areAllies(state, s.lordId, town.owner));
    if (staying.length === town.stationed.length) continue;
    const leaving = town.stationed.filter((s) => !areAllies(state, s.lordId, town.owner));
    town.stationed = staying;
    for (const contingent of leaving) sendHome(state, town, contingent, at, events);
  }
  return events;
}
