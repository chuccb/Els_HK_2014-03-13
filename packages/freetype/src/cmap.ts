import { Bytes } from "./bytes.ts";

/**
 * The cmap subtables of ttcmap.c (FreeType 2.4.11) that the shipped fonts use: formats 4, 6 and 12.  tt_face_build_cmaps validates every subtable
 * with FT_VALIDATE_DEFAULT and keeps the valid ones (`valid` in the C text is the level; the default level is the loosest, so `>= TIGHT` /
 * `>= PARANOID` branches never run).  A format this port does not know is skipped like a format the C table does not list; the real table also
 * has 0, 2, 8, 10, 13 and 14 -- none of the five fonts of the HK client carries one (checked on the font files: cmaps are 4, 6 and 12 only), and
 * the exe only ever calls FT_Get_Char_Index, so char_next / get_info / the variation selector calls are not ported.
 */

/** TT_CMAP_FLAG_UNSORTED / OVERLAPPING: what the validator reports for format 4 */
export const TT_CMAP_FLAG_OVERLAPPING = 1;
export const TT_CMAP_FLAG_UNSORTED = 2;

/** thrown inside a validator: the C code longjmps out with FT_INVALID_*; the subtable is then ignored */
class Invalid extends Error {}

export interface TtCmap {
  readonly format: number;
  /** offset of the subtable in the font file */
  readonly offset: number;
  /** the validator's flags (TT_CMAP_FLAG_*) */
  readonly flags: number;
  charIndex(code: number): number;
}

/** limit = end of the cmap table in the file; numGlyphs is only used by the TIGHT checks, kept for the signature */
export function buildCmap(b: Bytes, table: number, limit: number, offset: number): TtCmap | null {
  const format = b.u16(offset);
  try {
    switch (format) {
      case 4:
        return new Cmap4(b, offset, validate4(b, offset, limit), table, limit);
      case 6:
        validate6(b, offset, limit);
        return new Cmap6(b, offset);
      case 12:
        validate12(b, offset, limit);
        return new Cmap12(b, offset);
      default:
        return null; // unsupported cmap sub-table ignored
    }
  } catch (e) {
    if (e instanceof Invalid) return null; // broken cmap sub-table ignored
    throw e;
  }
}

/** true when a format is one this port can build (the others are skipped, like the C loop skips formats that are not in its class table) */
export const cmapFormatSupported = (format: number): boolean => format === 4 || format === 6 || format === 12;

function validate4(b: Bytes, table: number, limit: number): number {
  let p = table + 2;
  let length = b.u16(p);
  p += 2;
  if (length < 16) throw new Invalid();
  if (table + length > limit) length = limit - table; // level < TIGHT
  p = table + 6;
  let numSegs = b.u16(p);
  numSegs = Math.floor(numSegs / 2);
  if (length < 16 + numSegs * 2 * 4) throw new Invalid();
  const ends = table + 14;
  const starts = table + 16 + numSegs * 2;
  const deltas = starts + numSegs * 2;
  const offsets = deltas + numSegs * 2;
  const glyphIds = offsets + numSegs * 2;
  let error = 0;
  let lastStart = 0;
  let lastEnd = 0;
  for (let n = 0; n < numSegs; n++) {
    const pOffset = offsets + n * 2;
    const start = b.u16(starts + n * 2);
    const end = b.u16(ends + n * 2);
    b.s16(deltas + n * 2);
    const offset = b.u16(pOffset);
    if (start > end) throw new Invalid();
    if (start <= lastEnd && n > 0) {
      if (lastStart > start || lastEnd > end) error |= TT_CMAP_FLAG_UNSORTED;
      else error |= TT_CMAP_FLAG_OVERLAPPING;
    }
    if (offset !== 0 && offset !== 0xffff) {
      const q = pOffset + offset;
      if (n !== numSegs - 1 || !(start === 0xffff && end === 0xffff)) {
        if (q < glyphIds || q + (end - start + 1) * 2 > limit) throw new Invalid();
      }
    } else if (offset === 0xffff) {
      if (n !== numSegs - 1 || !(start === 0xffff && end === 0xffff)) throw new Invalid();
    }
    lastStart = start;
    lastEnd = end;
  }
  return error;
}

class Cmap4 implements TtCmap {
  readonly format = 4;
  constructor(
    private readonly b: Bytes,
    readonly offset: number,
    readonly flags: number,
    private readonly cmapTable: number,
    private readonly limit: number,
  ) {}

  charIndex(code: number): number {
    if (code >= 0x10000) return 0;
    return this.flags & TT_CMAP_FLAG_UNSORTED ? this.mapLinear(code) : this.mapBinary(code);
  }

  /** the "limit" fix-up of the last segment (a 0xFFFF..0xFFFF segment whose offset points outside the table) */
  private fixLast(i: number, numSegs: number, start: number, end: number, pDelta: number, offset: number, p: number): { delta: number; offset: number } {
    let delta = pDelta;
    if (i >= numSegs - 1 && start === 0xffff && end === 0xffff) {
      if (offset && p + offset + 2 > this.limit) {
        delta = 1;
        offset = 0;
      }
    }
    return { delta, offset };
  }

  private mapLinear(code: number): number {
    const b = this.b;
    const d = this.offset;
    const numSegs2 = b.u16(d + 6) & ~1;
    const numSegs = numSegs2 >> 1;
    if (!numSegs) return 0;
    let gindex = 0;
    let p = d + 14;
    let q = d + 16 + numSegs2;
    for (let i = 0; i < numSegs; i++) {
      const end = b.u16(p);
      p += 2;
      const start = b.u16(q);
      q += 2;
      if (code >= start && code <= end) {
        let pp = q - 2 + numSegs2;
        let delta = b.s16(pp);
        pp += numSegs2;
        let offset = b.u16(pp);
        ({ delta, offset } = this.fixLast(i, numSegs, start, end, delta, offset, pp));
        if (offset === 0xffff) continue;
        if (offset) {
          pp += offset + (code - start) * 2;
          gindex = b.u16(pp);
          if (gindex !== 0) gindex = (gindex + delta) & 0xffff;
        } else gindex = (code + delta) & 0xffff;
        break;
      }
    }
    return gindex;
  }

  private mapBinary(code: number): number {
    const b = this.b;
    const d = this.offset;
    const numSegs2 = b.u16(d + 6) & ~1;
    if (!numSegs2) return 0;
    const numSegs = numSegs2 >> 1;
    let mid = numSegs;
    let end = 0xffff;
    let start = 0;
    let gindex = 0;
    let min = 0;
    let max = numSegs;
    while (min < max) {
      mid = (min + max) >> 1;
      let p = d + 14 + mid * 2;
      end = b.u16(p);
      p += 2 + numSegs2;
      start = b.u16(p);
      if (code < start) max = mid;
      else if (code > end) min = mid + 1;
      else {
        p += numSegs2;
        let delta = b.s16(p);
        p += numSegs2;
        let offset = b.u16(p);
        ({ delta, offset } = this.fixLast(mid, numSegs, start, end, delta, offset, p));
        if (this.flags & TT_CMAP_FLAG_OVERLAPPING) {
          // look for the best segment among those that overlap (lower index preferred unless the offset says "no glyphs")
          let i: number;
          max = mid;
          if (offset === 0xffff) mid = max + 1;
          for (i = max; i > 0; i--) {
            const oldP = p;
            p = d + 14 + (i - 1) * 2;
            const prevEnd = b.u16(p);
            if (code > prevEnd) {
              p = oldP;
              break;
            }
            end = prevEnd;
            p += 2 + numSegs2;
            start = b.u16(p);
            p += numSegs2;
            delta = b.s16(p);
            p += numSegs2;
            offset = b.u16(p);
            if (offset !== 0xffff) mid = i - 1;
          }
          if (mid === max + 1) {
            if (i !== max) {
              p = d + 14 + max * 2;
              end = b.u16(p);
              p += 2 + numSegs2;
              start = b.u16(p);
              p += numSegs2;
              delta = b.s16(p);
              p += numSegs2;
              offset = b.u16(p);
            }
            mid = max;
            for (i = max + 1; i < numSegs; i++) {
              p = d + 14 + i * 2;
              const nextEnd = b.u16(p);
              p += 2 + numSegs2;
              const nextStart = b.u16(p);
              if (code < nextStart) break;
              end = nextEnd;
              start = nextStart;
              p += numSegs2;
              delta = b.s16(p);
              p += numSegs2;
              offset = b.u16(p);
              if (offset !== 0xffff) mid = i;
            }
            i--;
            if (mid === max) {
              mid = i;
              break;
            }
          }
          if (mid !== i) {
            p = d + 14 + mid * 2;
            end = b.u16(p);
            p += 2 + numSegs2;
            start = b.u16(p);
            p += numSegs2;
            delta = b.s16(p);
            p += numSegs2;
            offset = b.u16(p);
          }
        } else if (offset === 0xffff) break;
        if (offset) {
          p += offset + (code - start) * 2;
          gindex = b.u16(p);
          if (gindex !== 0) gindex = (gindex + delta) & 0xffff;
        } else gindex = (code + delta) & 0xffff;
        break;
      }
    }
    return gindex;
  }
}

function validate6(b: Bytes, table: number, limit: number): void {
  if (table + 10 > limit) throw new Invalid();
  const length = b.u16(table + 2);
  const count = b.u16(table + 8);
  if (table + length > limit || length < 10 + count * 2) throw new Invalid();
}

class Cmap6 implements TtCmap {
  readonly format = 6;
  readonly flags = 0;
  constructor(
    private readonly b: Bytes,
    readonly offset: number,
  ) {}
  charIndex(code: number): number {
    let p = this.offset + 6;
    const start = this.b.u16(p);
    const count = this.b.u16(p + 2);
    p += 4;
    const idx = (code - start) >>> 0;
    return idx < count ? this.b.u16(p + 2 * idx) : 0;
  }
}

function validate12(b: Bytes, table: number, limit: number): void {
  if (table + 16 > limit) throw new Invalid();
  const length = b.u32(table + 4);
  const numGroups = b.u32(table + 12);
  if (length > limit - table || length < 16 + 12 * numGroups) throw new Invalid();
  let p = table + 12;
  p += 4;
  let last = 0;
  for (let n = 0; n < numGroups; n++) {
    const start = b.u32(p);
    const end = b.u32(p + 4);
    p += 12;
    if (start > end) throw new Invalid();
    if (n > 0 && start <= last) throw new Invalid();
    last = end;
  }
}

class Cmap12 implements TtCmap {
  readonly format = 12;
  readonly flags = 0;
  constructor(
    private readonly b: Bytes,
    readonly offset: number,
  ) {}
  charIndex(code: number): number {
    const b = this.b;
    const numGroups = b.u32(this.offset + 12);
    if (!numGroups) return 0;
    let min = 0;
    let max = numGroups;
    while (min < max) {
      const mid = (min + max) >>> 1;
      const p = this.offset + 16 + 12 * mid;
      const start = b.u32(p);
      const end = b.u32(p + 4);
      if (code < start) max = mid;
      else if (code > end) min = mid + 1;
      else return (b.u32(p + 8) + code - start) >>> 0;
    }
    return 0;
  }
}
