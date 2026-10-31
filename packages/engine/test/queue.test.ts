import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { heapPeek, heapPop, heapPush } from '../src/queue';
import type { QueueItem } from '../src/types';

describe('event heap', () => {
  it('pops in (dueAt, seq) order', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 60 }), (dues) => {
        const heap: QueueItem[] = [];
        dues.forEach((dueAt, seq) => heapPush(heap, { dueAt, seq, ev: { kind: 'SEASON_END' } }));
        const out: QueueItem[] = [];
        while (heapPeek(heap)) out.push(heapPop(heap) as QueueItem);
        const expected = dues
          .map((dueAt, seq) => ({ dueAt, seq }))
          .sort((a, b) => a.dueAt - b.dueAt || a.seq - b.seq);
        expect(out.map((i) => ({ dueAt: i.dueAt, seq: i.seq }))).toEqual(expected);
      }),
    );
  });

  it('returns undefined when empty', () => {
    expect(heapPop([])).toBeUndefined();
    expect(heapPeek([])).toBeUndefined();
  });
});
