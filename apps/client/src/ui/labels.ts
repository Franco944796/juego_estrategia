import { defaultConfig } from '@si/config';
import { GEAR_EFFECTS } from '@si/config/constants';
import type { Item, LordView, MarchView, TownView } from '@si/engine';
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

/** «Casco · Épico». */
export function itemName(lang: Lang, item: Item): string {
  return `${t(lang, `slot${item.slot}`)} · ${t(lang, `rarity${item.rarity}`)}`;
}

/** «+10 % muros», with the bonus the view reports for the item's rarity. */
export function itemEffect(lang: Lang, view: LordView, item: Item): string {
  const table = item.slot === 'CHEST' ? view.me.refundBonus : view.me.gearBonus;
  const p = Math.round(table[item.rarity] * 100);
  return t(lang, `effect${GEAR_EFFECTS[item.slot]}`, { p });
}

/** A synchronized group shows as one march with the troops of every leg. */
export function mergeGroups(marches: MarchView[]): (MarchView & { legs: number })[] {
  const merged: (MarchView & { legs: number })[] = [];
  const byGroup = new Map<number, MarchView & { legs: number }>();
  for (const m of marches) {
    const group = m.groupId === null ? undefined : byGroup.get(m.groupId);
    if (group) {
      group.legs++;
      group.troops = group.troops === null || m.troops === null ? null : group.troops + m.troops;
      continue;
    }
    const row = { ...m, legs: 1 };
    if (m.groupId !== null) byGroup.set(m.groupId, row);
    merged.push(row);
  }
  return merged;
}

/** «Plata», «Gold»… for a league index. */
export function leagueName(lang: Lang, league: number): string {
  const id = defaultConfig.leagues[league]?.id ?? 'BRONZE';
  return t(lang, `league${id}` as 'leagueBRONZE');
}

/**
 * Experience multiplier for attacking `ownerId` (the engine's power rule, from the view): 0 when that
 * lord is too weak to be attacked, 1 for neutral towns.
 */
export function attackXp(view: LordView, ownerId: string | null): number {
  const other = ownerId === null ? undefined : view.lords.find((l) => l.id === ownerId);
  if (!other || other.id === view.me.id) return 1;
  const rules = view.me.powerRules;
  const ratio = view.me.power > 0 ? other.power / view.me.power : Infinity;
  if (ratio >= rules.doubleFrom) return rules.highXp;
  if (ratio >= rules.halfBelow) return 1;
  if (ratio >= rules.forbidBelow) return rules.lowXp;
  return 0;
}
