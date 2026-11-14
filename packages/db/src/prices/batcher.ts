/**
 * Collects the keys asked for in the same tick and loads them with one call, then remembers
 * each result. Ten prices asked for one by one (as the valuation code does) become one
 * request to the source.
 */
export class Batcher<K, V> {
  private readonly results = new Map<K, Promise<V>>();
  private waiting = new Map<K, { resolve: (value: V) => void; reject: (error: unknown) => void }>();
  private scheduled = false;

  constructor(private readonly loadMany: (keys: K[]) => Promise<Map<K, V>>) {}

  /** Rejects with a RangeError when the loader has no value for the key. */
  load(key: K): Promise<V> {
    let result = this.results.get(key);
    if (!result) {
      result = new Promise<V>((resolve, reject) => {
        this.waiting.set(key, { resolve, reject });
      });
      this.results.set(key, result);
      // A failure is not remembered: the next caller tries again.
      result.catch(() => this.results.delete(key));
      if (!this.scheduled) {
        this.scheduled = true;
        // After the current tick's microtasks, so everything asked for "at once" is in.
        setImmediate(() => void this.flush());
      }
    }
    return result;
  }

  private async flush(): Promise<void> {
    const batch = this.waiting;
    this.waiting = new Map();
    this.scheduled = false;
    try {
      const loaded = await this.loadMany([...batch.keys()]);
      for (const [key, waiter] of batch) {
        if (loaded.has(key)) waiter.resolve(loaded.get(key) as V);
        else waiter.reject(new RangeError("Not found"));
      }
    } catch (error) {
      for (const waiter of batch.values()) waiter.reject(error);
    }
  }
}
