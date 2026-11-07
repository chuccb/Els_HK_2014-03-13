import { FtErr } from "./types.ts";

/**
 * FT_GlyphLoader (ftgloadr.c): the buffers TT_Load_Glyph builds an outline in.  `base` holds the glyph (components) added so far, `current` the one being
 * read; in C `current.outline.points` points at `base.outline.points + base.outline.n_points`, here `current` starts at index `baseNPoints` /
 * `baseNContours` / `baseNumSubglyphs` of the same buffers.  Points are interleaved (x, y) pairs; `extra` / `extra2` are the `org` / `orus` arrays of a
 * hinting zone (use_extra, set by tt_slot_init -> FT_GlyphLoader_CreateExtra).  The buffers grow like the C reallocs (to a multiple of 8 points / 4 contours,
 * never above SHRT_MAX); the new part is zero.
 */

const FT_OUTLINE_POINTS_MAX = 0x7fff;
const FT_OUTLINE_CONTOURS_MAX = 0x7fff;

/** FT_SubGlyphRec */
export interface SubGlyph {
  index: number;
  flags: number;
  arg1: number;
  arg2: number;
  xx: number;
  xy: number;
  yx: number;
  yy: number;
}

export class GlyphLoader {
  maxPoints = 0;
  maxContours = 0;
  points = new Int32Array(0);
  tags = new Uint8Array(0);
  contours = new Uint16Array(0);
  extra = new Int32Array(0);
  extra2 = new Int32Array(0);
  subglyphs: SubGlyph[] = [];
  baseNPoints = 0;
  baseNContours = 0;
  baseNumSubglyphs = 0;
  curNPoints = 0;
  curNContours = 0;
  curNumSubglyphs = 0;

  /** FT_GlyphLoader_Rewind */
  rewind(): void {
    this.baseNPoints = 0;
    this.baseNContours = 0;
    this.baseNumSubglyphs = 0;
    this.prepare();
  }

  /** FT_GlyphLoader_Prepare */
  prepare(): void {
    this.curNPoints = 0;
    this.curNContours = 0;
    this.curNumSubglyphs = 0;
  }

  /** FT_GlyphLoader_CheckPoints: an FT_Error */
  checkPoints(nPoints: number, nContours: number): number {
    let newMax = this.baseNPoints + this.curNPoints + nPoints;
    if (newMax > this.maxPoints) {
      newMax = (newMax + 7) & ~7;
      if (newMax > FT_OUTLINE_POINTS_MAX) return FtErr.Array_Too_Large;
      const grow = <T extends Int32Array | Uint8Array | Uint16Array>(a: T, n: number): T => {
        const b = new (a.constructor as new (n: number) => T)(n);
        b.set(a);
        return b;
      };
      this.points = grow(this.points, newMax * 2);
      this.tags = grow(this.tags, newMax);
      this.extra = grow(this.extra, newMax * 2);
      this.extra2 = grow(this.extra2, newMax * 2);
      this.maxPoints = newMax;
    }
    newMax = this.baseNContours + this.curNContours + nContours;
    if (newMax > this.maxContours) {
      newMax = (newMax + 3) & ~3;
      if (newMax > FT_OUTLINE_CONTOURS_MAX) return FtErr.Array_Too_Large;
      const c = new Uint16Array(newMax);
      c.set(this.contours);
      this.contours = c;
      this.maxContours = newMax;
    }
    return FtErr.Ok;
  }

  /** FT_GlyphLoader_CheckSubGlyphs */
  checkSubGlyphs(nSubs: number): number {
    const newMax = this.baseNumSubglyphs + this.curNumSubglyphs + nSubs;
    while (this.subglyphs.length < newMax) this.subglyphs.push({ index: 0, flags: 0, arg1: 0, arg2: 0, xx: 0, xy: 0, yx: 0, yy: 0 });
    return FtErr.Ok;
  }

  /** FT_GlyphLoader_Add: `current` becomes part of `base` */
  add(): void {
    const nCurrContours = this.curNContours;
    const nBasePoints = this.baseNPoints;
    this.baseNPoints += this.curNPoints;
    this.baseNContours += this.curNContours;
    this.baseNumSubglyphs += this.curNumSubglyphs;
    // adjust the contour end points of the newest outline
    for (let n = 0; n < nCurrContours; n++) {
      const i = this.baseNContours - nCurrContours + n;
      this.contours[i] = (this.contours[i]! + nBasePoints) & 0xffff;
    }
    this.prepare();
  }
}
