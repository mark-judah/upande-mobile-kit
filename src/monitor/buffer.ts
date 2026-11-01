/** Bounded FIFO that drops the oldest item when full. O(1) push, no allocation per push beyond the slot. */
export class RingBuffer<T> {
  private items: (T | undefined)[];
  private head = 0;
  private count = 0;
  dropped = 0;

  constructor(readonly capacity: number) {
    this.items = new Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(item: T): void {
    const tail = (this.head + this.count) % this.capacity;
    if (this.count === this.capacity) {
      this.items[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
      this.dropped += 1;
    } else {
      this.items[tail] = item;
      this.count += 1;
    }
  }

  /** Remove and return everything, oldest first. */
  drain(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i += 1) out.push(this.items[(this.head + i) % this.capacity] as T);
    this.items = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
    return out;
  }

  /** Copy of the newest `n` items, oldest first, without removing them. */
  peekLast(n: number): T[] {
    const take = Math.min(n, this.count);
    const out: T[] = [];
    for (let i = this.count - take; i < this.count; i += 1) out.push(this.items[(this.head + i) % this.capacity] as T);
    return out;
  }
}
