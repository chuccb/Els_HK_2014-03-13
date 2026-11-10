/**
 * `std::map<int, V>`: iterates in key order.  `CKTDGLineMap::m_mapStartInfo` is one: the start positions of a line map are looked up by
 * `_Find_lower_bound(key)` and a random start is the n-th KEY of the map, so the order is behaviour.
 */
export class IntMap<V> implements Iterable<[number, V]> {
  private readonly keys: number[] = [];
  private readonly values: V[] = [];

  get size(): number {
    return this.keys.length;
  }

  clear(): void {
    this.keys.length = 0;
    this.values.length = 0;
  }

  /** `_Find_lower_bound`: the position of the first key that is not less than `key` (`size` when there is none) */
  lowerBound(key: number): number {
    let lo = 0, hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.keys[mid]! < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** `find(key)`: the value of the key, undefined when it is not in the map */
  get(key: number): V | undefined {
    const at = this.lowerBound(key);
    return this.keys[at] === key ? this.values[at] : undefined;
  }

  /** `map[key]`: the value of the key; `make()` is inserted first when the key is not there */
  getOrInsert(key: number, make: () => V): V {
    const at = this.lowerBound(key);
    if (this.keys[at] === key) return this.values[at]!;
    const value = make();
    this.keys.splice(at, 0, key);
    this.values.splice(at, 0, value);
    return value;
  }

  /** the key of the n-th element in key order (undefined past the end) */
  keyAt(n: number): number | undefined {
    return this.keys[n];
  }

  *[Symbol.iterator](): Iterator<[number, V]> {
    for (let i = 0; i < this.keys.length; i++) yield [this.keys[i]!, this.values[i]!];
  }
}
