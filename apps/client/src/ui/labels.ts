import type { LordView } from '@si/engine';
import { townName } from '../format';
import { t, type Lang } from '../i18n';

export function townLabel(lang: Lang, view: LordView, townId: number): string {
  return townId === view.season.throneTownId ? t(lang, 'throne') : townName(townId);
}

export function ownerName(lang: Lang, view: LordView, ownerId: string | null): string {
  if (ownerId === null) return t(lang, 'neutral');
  return view.lords.find((l) => l.id === ownerId)?.name ?? ownerId;
}

export function ownerColor(view: LordView, ownerId: string | null): string {
  return view.lords.find((l) => l.id === ownerId)?.color ?? NEUTRAL_COLOR;
}

export const NEUTRAL_COLOR = '#aab4bf';

/** Isle adjacency from the view's lanes. */
export function linkedIsles(view: LordView, isleId: number): Set<number> {
  const linked = new Set([isleId]);
  for (const lane of view.lanes) {
    if (lane.a === isleId) linked.add(lane.b);
    if (lane.b === isleId) linked.add(lane.a);
  }
  return linked;
}
