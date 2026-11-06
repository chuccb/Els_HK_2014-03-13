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
