import { SKILL_IDS } from '@si/config/constants';
import type { DomainEvent, GameState, Lord, SkillId } from './types';

export function unspentPoints(lord: Lord): number {
  return lord.level - 1 - SKILL_IDS.reduce((sum, id) => sum + lord.skills[id], 0);
}

export function learnSkill(lord: Lord, skill: SkillId, at: number, events: DomainEvent[]): void {
  lord.skills[skill]++;
  events.push({ type: 'SKILL_LEARNED', at, lordId: lord.id, skill, points: lord.skills[skill] });
}

/** The skill that keeps a bot's points closest to its personality's weights (first id on ties). */
export function botSkill(state: GameState, lord: Lord): SkillId | null {
  if (!lord.personality) return null;
  const weights = state.config.bots.personalities[lord.personality].skillWeights;
  let best: SkillId | null = null;
  let bestRatio = Infinity;
  for (const id of SKILL_IDS) {
    if (weights[id] <= 0) continue;
    const ratio = lord.skills[id] / weights[id];
    if (ratio < bestRatio) {
      best = id;
      bestRatio = ratio;
    }
  }
  return best;
}
