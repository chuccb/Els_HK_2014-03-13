/**
 * LuaTable — a faithful port of LuaJIT 2.0 `lj_tab.c` (GCtab):
 *   - array part holds integer keys 0..asize-1 (slot 0 included, as in LuaJIT),
 *   - hash part is a node array with main-position hashing, collision chains through `next` and a descending
 *     `freetop` free pointer (lj_tab_newkey),
 *   - rehashtab()/bestasize() decide when integer keys migrate into the array part.
 * Matching these algorithms exactly is what makes `#t` for tables with holes and the iteration order of
 * `pairs`/`next` identical to the original client (they depend on the string hash and the node layout).
 *
 * Sources in x2.exe.c: lj_str_new @3336EF60 (string hash), hashkey @33370340, lj_tab_newkey @3336FE10,
 * lj_tab_next @33370180, lj_tab_len @333702E0, rehashtab @333704E0, resizetab @33370760.
 *
 * Lookups go through a JS Map (key -> node index) while node placement/ordering is maintained as in
 * LuaJIT, so reads stay O(1) in JS without recomputing the byte hash of strings.
 */
import { newObjectId, LuaClosure, LuaNative } from "./value.ts";
import type { LuaValue } from "./value.ts";

const LJ_MAX_ASIZE = 0x8000000;
const LJ_MAX_ABITS = 28;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

const rol = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

/** LuaJIT 2.0 string hash (lj_str_new). `s` is a byte string. */
export function strHash(s: string): number {
  const len = s.length;
  if (len === 0) return 0;
  let a: number, b: number, h: number;
  if (len >= 4) {
    const u = (i: number) => (s.charCodeAt(i) | (s.charCodeAt(i + 1) << 8) | (s.charCodeAt(i + 2) << 16) | (s.charCodeAt(i + 3) << 24)) >>> 0;
    a = u(0);
    h = (len ^ u(len - 4)) >>> 0;
    b = u((len >> 1) - 2);
    h = (h ^ b) >>> 0;
    h = (h - rol(b, 14)) >>> 0;
    b = (b + u((len >> 2) - 1)) >>> 0;
  } else {
    a = s.charCodeAt(0);
    h = (len ^ s.charCodeAt(len - 1)) >>> 0;
    b = s.charCodeAt(len >> 1);
    h = (h ^ b) >>> 0;
    h = (h - rol(b, 14)) >>> 0;
  }
  a = (a ^ h) >>> 0;
  a = (a - rol(h, 11)) >>> 0;
  b = (b ^ a) >>> 0;
  b = (b - rol(a, 25)) >>> 0;
  h = (h ^ b) >>> 0;
  h = (h - rol(b, 16)) >>> 0;
  return h;
}

/** hashrot (lj_tab.c): mixes lo/hi into the hash. */
function hashrot(lo: number, hi: number): number {
  lo = (lo ^ hi) >>> 0;
  hi = rol(hi, 14);
  lo = (lo - hi) >>> 0;
  hi = rol(hi, 5);
  hi = (hi ^ lo) >>> 0;
  hi = (hi - rol(lo, 13)) >>> 0;
  return hi;
}

const HASH_BIAS = -0x04c11db7;

function fls(x: number): number {
  return 31 - Math.clz32(x);
}

function hsize2hbits(s: number): number {
  return s ? (s === 1 ? 1 : 1 + fls(s - 1)) : 0;
}

export class LuaTable {
  asize = 0;
  array: LuaValue[] = [];
  hmask = 0;
  nk: LuaValue[] = []; // node keys   (undefined == free node)
  nv: LuaValue[] = []; // node values (undefined == nil / dead)
  nn: Int32Array = new Int32Array(0); // next node index in collision chain, -1 == end
  freetop = 0;
  map: Map<LuaValue, number> | undefined = undefined; // key -> node index
  metatable: LuaTable | undefined = undefined;
  readonly id = newObjectId();

  constructor(asize = 0, hbits = 0) {
    if (asize) {
      this.asize = asize;
      this.array = new Array<LuaValue>(asize).fill(undefined);
    }
    if (hbits) this.allocNodes(hbits);
  }

  private allocNodes(hbits: number): void {
    const n = 1 << hbits;
    this.hmask = n - 1;
    this.nk = new Array<LuaValue>(n).fill(undefined);
    this.nv = new Array<LuaValue>(n).fill(undefined);
    this.nn = new Int32Array(n).fill(-1);
    this.freetop = n;
    this.map = new Map();
  }

  // ---- hashing / main position ------------------------------------------------------------------------
  private mainPos(key: LuaValue): number {
    switch (typeof key) {
      case "string":
        return this.hmask & strHash(key);
      case "number": {
        f64[0] = key;
        return this.hmask & hashrot(u32[0]!, (u32[1]! << 1) >>> 0);
      }
      case "boolean":
        return key ? 1 & this.hmask : 0;
      default: {
        const addr = (key as { id: number }).id;
        return this.hmask & hashrot(addr, (addr + HASH_BIAS) >>> 0);
      }
    }
  }

  // ---- lookups -----------------------------------------------------------------------------------------
  /** Raw get (lj_tab_get). */
  get(key: LuaValue): LuaValue {
    if (typeof key === "number") {
      const k = key | 0;
      if (k === key) return this.getInt(k);
      return this.map?.size ? this.nv[this.map.get(key) ?? -1] : undefined;
    }
    if (key === undefined) return undefined;
    if (this.map === undefined) return undefined;
    const i = this.map.get(key);
    return i === undefined ? undefined : this.nv[i];
  }

  getStr(key: string): LuaValue {
    if (this.map === undefined) return undefined;
    const i = this.map.get(key);
    return i === undefined ? undefined : this.nv[i];
  }

  /** Integer-key get (array part for 0 <= k < asize, otherwise the hash part keyed by the double). */
  getInt(k: number): LuaValue {
    if (k >= 0 && k < this.asize) return this.array[k];
    if (this.map === undefined) return undefined;
    const i = this.map.get(k);
    return i === undefined ? undefined : this.nv[i];
  }

  // ---- stores ------------------------------------------------------------------------------------------
  /** Raw set (lj_tab_set + store). Caller guarantees key is neither nil nor NaN. */
  set(key: LuaValue, value: LuaValue): void {
    if (typeof key === "number") {
      const k = key | 0;
      if (k === key) {
        this.setInt(k, value);
        return;
      }
    }
    const i = this.map?.get(key);
    if (i !== undefined) {
      this.nv[i] = value;
      return;
    }
    this.insertNew(key, value);
  }

  setStr(key: string, value: LuaValue): void {
    const i = this.map?.get(key);
    if (i !== undefined) {
      this.nv[i] = value;
      return;
    }
    this.insertNew(key, value);
  }

  setInt(k: number, value: LuaValue): void {
    if (k >= 0 && k < this.asize) {
      this.array[k] = value;
      return;
    }
    const i = this.map?.get(k);
    if (i !== undefined) {
      this.nv[i] = value;
      return;
    }
    this.insertNew(k, value);
  }

  /**
   * lj_tab_newkey + the store of the value into the returned slot.  Note that, exactly like LuaJIT, a fresh
   * key is created even when `value` is nil (it consumes a node until the next rehash).
   */
  private insertNew(key: LuaValue, value: LuaValue): void {
    if (key === 0) key = 0; // -0 is stored as +0 (tvismzero)
    const nk = this.nk, nv = this.nv, nn = this.nn;
    const hasHash = nk.length > 0;
    let n = hasHash ? this.mainPos(key) : -1;
    if (!hasHash || nv[n] !== undefined) {
      // Main node is taken (or there is no hash part): grab a free node, walking `freetop` downwards.
      let free = hasHash ? this.freetop : 0;
      for (;;) {
        if (free === 0) {
          this.rehash(key); // no free node: rehash, then retry the insertion (lj_tab_set)
          this.set(key, value);
          return;
        }
        free--;
        if (nk[free] === undefined) break;
      }
      this.freetop = free;
      let collide = this.mainPos(nk[n]!);
      if (collide !== n) {
        // The colliding node is not in its own main position: move it into the free node.
        while (nn[collide] !== n) collide = nn[collide]!;
        nn[collide] = free; // relink the chain
        nv[free] = nv[n];
        nk[free] = nk[n];
        nn[free] = nn[n]!;
        this.map!.set(nk[free]!, free);
        nn[n] = -1;
        nv[n] = undefined;
        // Rechain pseudo-resurrected string keys with colliding hashes.
        let f = free;
        while (nn[f] !== -1) {
          const x = nn[f]!;
          if (typeof nk[x] === "string" && nv[x] !== undefined && this.mainPos(nk[x]) === n) {
            nn[f] = nn[x]!;
            nn[x] = nn[n]!;
            nn[n] = x;
          } else {
            f = x;
          }
        }
        // `n` now holds a stale key pointer that is about to be overwritten below.
        nk[n] = undefined;
      } else {
        // The colliding node sits in its main position: the new key goes into the free node.
        nn[free] = nn[n]!;
        nn[n] = free;
        n = free;
      }
    } else if (nk[n] !== undefined) {
      // Main node holds a dead key (value nil): the new key simply takes the node over.
      this.map!.delete(nk[n]);
    }
    nk[n] = key;
    nv[n] = value;
    this.map!.set(key, n);
  }

  // ---- iteration (lj_tab_next) ------------------------------------------------------------------------
  /** Returns [key, value] following `key` (undefined = start), or null at the end. Throws on an invalid key. */
  next(key: LuaValue): [LuaValue, LuaValue] | null {
    let i: number;
    if (key === undefined) {
      i = -1;
    } else {
      let found = -2;
      if (typeof key === "number") {
        const k = key | 0;
        if (k === key && k >= 0 && k < this.asize) found = k;
      }
      if (found === -2) {
        const idx = this.map?.get(key);
        if (idx === undefined) throw new Error("invalid key to 'next'");
        found = this.asize + idx;
      }
      i = found;
    }
    i++;
    for (; i < this.asize; i++) {
      const v = this.array[i];
      if (v !== undefined) return [i, v];
    }
    for (let j = i - this.asize; j <= this.hmask && this.nk.length > 0; j++) {
      const v = this.nv[j];
      if (v !== undefined) return [this.nk[j], v];
    }
    return null;
  }

  // ---- length (lj_tab_len + unbound_search) ------------------------------------------------------------
  length(): number {
    let j = this.asize;
    if (j > 1 && this.array[j - 1] === undefined) {
      let i = 1;
      while (j - i > 1) {
        const m = (i + j) >>> 1;
        if (this.array[m - 1] === undefined) j = m;
        else i = m;
      }
      return i - 1;
    }
    if (j) j--;
    if (this.hmask === 0 && this.nk.length === 0) return j;
    return this.unboundSearch(j);
  }

  private unboundSearch(j: number): number {
    let i = j; // i is zero or a present index
    j++;
    // find `i' and `j' such that i is present and j is not
    while (this.getInt(j) !== undefined) {
      i = j;
      j *= 2;
      if (j > 0x7fffffff - 2) {
        // overflow: resort to a linear search
        i = 1;
        while (this.getInt(i) !== undefined) i++;
        return i - 1;
      }
    }
    // now do a binary search between them
    while (j - i > 1) {
      const m = (i + j) >>> 1;
      if (this.getInt(m) === undefined) j = m;
      else i = m;
    }
    return i;
  }

  // ---- resize / rehash (rehashtab, resizetab, bestasize) -----------------------------------------------
  private countInt(key: LuaValue, bins: Uint32Array): number {
    if (typeof key === "number") {
      const k = key | 0;
      if (k === key && k >>> 0 < LJ_MAX_ASIZE + 1) {
        bins[k > 2 ? fls(k - 1) : 0]!++;
        return 1;
      }
    }
    return 0;
  }

  private rehash(ek: LuaValue): void {
    const bins = new Uint32Array(LJ_MAX_ABITS);
    // countarray
    let na = 0;
    if (this.asize !== 0) {
      let i = 0;
      for (let b = 0; b < LJ_MAX_ABITS; b++) {
        let top = 2 << b;
        if (top >= this.asize) {
          top = this.asize - 1;
          if (i > top) break;
        }
        let n = 0;
        for (; i <= top; i++) if (this.array[i] !== undefined) n++;
        bins[b]! += n;
        na += n;
      }
    }
    // counthash
    let hashTotal = 0, hashInts = 0;
    for (let i = 0; i < this.nk.length; i++) {
      if (this.nv[i] === undefined) continue;
      hashInts += this.countInt(this.nk[i], bins);
      hashTotal++;
    }
    let total = na + hashInts;
    total += this.countInt(ek, bins);
    // bestasize
    let sz = 0, nbest = 0;
    {
      const nn = total;
      let sum = 0;
      for (let b = 0; 2 * nn > 1 << b && sum !== nn; b++) {
        if (bins[b]! > 0 && 2 * (sum += bins[b]!) > 1 << b) {
          sz = (2 << b) + 1;
          nbest = sum;
        }
      }
    }
    const totalHash = hashTotal + na + 1 - nbest;
    this.resize(sz, hsize2hbits(totalHash));
  }

  /** resizetab (lj_tab_resize): rebuild array and hash parts. */
  resize(nasize: number, hbits: number): void {
    const oldAsize = this.asize, oldArray = this.array;
    const oldNk = this.nk, oldNv = this.nv;
    if (nasize > oldAsize) {
      // array part grows
      for (let i = oldAsize; i < nasize; i++) oldArray[i] = undefined;
      this.asize = nasize;
    }
    // new hash part
    if (hbits) this.allocNodes(hbits);
    else {
      this.hmask = 0;
      this.nk = [];
      this.nv = [];
      this.nn = new Int32Array(0);
      this.freetop = 0;
      this.map = undefined;
    }
    if (nasize < oldAsize) {
      // array part shrinks: reinsert the old slice
      this.asize = nasize;
      for (let i = nasize; i < oldAsize; i++) {
        const v = oldArray[i];
        if (v !== undefined) this.setInt(i, v);
      }
      oldArray.length = nasize;
    }
    // reinsert pairs from the old hash part, in node order
    for (let i = 0; i < oldNk.length; i++) {
      const v = oldNv[i];
      if (v !== undefined) this.set(oldNk[i], v);
    }
  }

  /** lj_tab_reasize: resize the array part to hold keys 0..nasize, keeping the hash part size (TSETM etc.). */
  reasize(nasize: number): void {
    this.resize(nasize + 1, this.hmask ? fls(this.hmask) + 1 : 0);
  }
}

/** Duplicate a template table (TDUP): same sizes and contents, no metatable (lj_tab_dup). */
export function tabDup(t: LuaTable): LuaTable {
  const r = new LuaTable();
  r.asize = t.asize;
  r.array = t.array.slice();
  if (t.nk.length) {
    r.hmask = t.hmask;
    r.nk = t.nk.slice();
    r.nv = t.nv.slice();
    r.nn = t.nn.slice();
    r.freetop = t.freetop;
    r.map = new Map(t.map);
  }
  return r;
}

export function isCallable(v: LuaValue): v is LuaClosure | LuaNative {
  return v instanceof LuaClosure || v instanceof LuaNative;
}

