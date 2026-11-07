/**
 * `std::map<std::pair<int, int>, V>`: iterates in key order (`std::pair`'s `<`: the first number, then the second).  The control list walks
 * its cells in this order.
 */
export class IntPairMap<V> implements Iterable<[number, number, V]> {
  private readonly cells: { first: number; second: number; value: V }[] = [];

  get size(): number {
    return this.cells.length;
  }

  private lowerBound(first: number, second: number): number {
    let lo = 0, hi = this.cells.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = this.cells[mid]!;
      if (c.first < first || (c.first === first && c.second < second)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  get(first: number, second: number): V | undefined {
    const at = this.lowerBound(first, second);
    const c = this.cells[at];
    return c && c.first === first && c.second === second ? c.value : undefined;
  }

  /** `map[key]`: the value of the key, made by `make` and inserted when the key is not there */
  getOrInsert(first: number, second: number, make: () => V): V {
    const at = this.lowerBound(first, second);
    const c = this.cells[at];
    if (c && c.first === first && c.second === second) return c.value;
    const value = make();
    this.cells.splice(at, 0, { first, second, value });
    return value;
  }

  *[Symbol.iterator](): Iterator<[number, number, V]> {
    for (const c of [...this.cells]) yield [c.first, c.second, c.value];
  }
}

/**
 * `std::map<std::wstring, V>`: iterates in key order (`wchar_t` code units, which is how JS compares strings), `emplace` keeps the
 * first value of a key.  The exe walks `CKTDGUIDialog::m_ControlsMap` in `MsgProc` and `OnFrameMove`, so the order is behaviour.
 */
export class WStringMap<V> implements Iterable<[string, V]> {
  private readonly sorted: string[] = [];
  private readonly values = new Map<string, V>();

  get size(): number {
    return this.sorted.length;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  get(key: string): V | undefined {
    return this.values.get(key);
  }

  /** `emplace`: false (and no change) when the key exists */
  emplace(key: string, value: V): boolean {
    if (this.values.has(key)) return false;
    let lo = 0, hi = this.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sorted[mid]! < key) lo = mid + 1;
      else hi = mid;
    }
    this.sorted.splice(lo, 0, key);
    this.values.set(key, value);
    return true;
  }

  /** `erase(key)`: whether there was such an entry */
  erase(key: string): boolean {
    if (!this.values.delete(key)) return false;
    this.sorted.splice(this.sorted.indexOf(key), 1);
    return true;
  }

  keys(): string[] {
    return [...this.sorted];
  }

  *[Symbol.iterator](): Iterator<[string, V]> {
    for (const k of [...this.sorted]) yield [k, this.values.get(k)!];
  }
}
