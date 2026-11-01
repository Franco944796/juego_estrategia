import type { LordView, TownView } from '@si/engine';
import { townName } from '../format';
import { t, type Lang } from '../i18n';

const townIndex = new WeakMap<LordView, Map<number, TownView>>();

/** The view leaves out other lords' private towns, so its towns are looked up by id, never by index. */
export function townById(view: LordView, id: number | null | undefined): TownView | undefined {
  if (id === null || id === undefined) return undefined;
  let index = townIndex.get(view);
  if (!index) {
    index = new Map(view.towns.map((town) => [town.id, town]));
    townIndex.set(view, index);
  }
  return index.get(id);
}

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

/** A clanmate of the viewer (never the viewer itself). */
export function isAlly(view: LordView, ownerId: string | null): boolean {
  const mine = view.me.clanId;
  if (ownerId === null || ownerId === view.me.id || mine === null) return false;
  return view.lords.find((l) => l.id === ownerId)?.clanId === mine;
}
