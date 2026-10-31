import type { GameState, QueueItem, ScheduledEvent } from './types';

function before(a: QueueItem, b: QueueItem): boolean {
  return a.dueAt < b.dueAt || (a.dueAt === b.dueAt && a.seq < b.seq);
}

export function heapPush(heap: QueueItem[], item: QueueItem): void {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!before(heap[i] as QueueItem, heap[parent] as QueueItem)) break;
    [heap[i], heap[parent]] = [heap[parent] as QueueItem, heap[i] as QueueItem];
    i = parent;
  }
}

export function heapPeek(heap: readonly QueueItem[]): QueueItem | undefined {
  return heap[0];
}

export function heapPop(heap: QueueItem[]): QueueItem | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (top === undefined || last === undefined || heap.length === 0) return top;
  heap[0] = last;
  let i = 0;
  for (;;) {
    const left = 2 * i + 1;
    const right = left + 1;
    let smallest = i;
    if (left < heap.length && before(heap[left] as QueueItem, heap[smallest] as QueueItem)) {
      smallest = left;
    }
    if (right < heap.length && before(heap[right] as QueueItem, heap[smallest] as QueueItem)) {
      smallest = right;
    }
    if (smallest === i) break;
    [heap[i], heap[smallest]] = [heap[smallest] as QueueItem, heap[i] as QueueItem];
    i = smallest;
  }
  return top;
}

/** Events due at the same instant run in scheduling order (seq). */
export function schedule(state: GameState, dueAt: number, ev: ScheduledEvent): void {
  heapPush(state.queue, { dueAt, seq: state.seq++, ev });
}
