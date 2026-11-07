import { FtErr, FT_CURVE_TAG } from "./types.ts";

/**
 * FT_Outline (ftimage.h) and the FT_Outline_* functions of ftoutln.c the text path reaches.  Points are interleaved x, y in an Int32Array (26.6
 * fixed point, like FT_Vector), `tags` hold FT_CURVE_TAG_* bits, `contours` the index of the last point of each contour.
 */

/** FT_OUTLINE_* flags */
export const FT_OUTLINE = {
  NONE: 0,
  OWNER: 0x1,
  EVEN_ODD_FILL: 0x2,
  REVERSE_FILL: 0x4,
  IGNORE_DROPOUTS: 0x8,
  SMART_DROPOUTS: 0x10,
  INCLUDE_STUBS: 0x20,
  HIGH_PRECISION: 0x100,
  SINGLE_PASS: 0x200,
} as const;

export class Outline {
  nContours = 0;
  nPoints = 0;
  points: Int32Array = new Int32Array(0);
  tags: Uint8Array = new Uint8Array(0);
  contours: Uint16Array = new Uint16Array(0);
  flags = 0;

  /** the same outline over the same arrays (FT_Outline is copied by value in C: `glyph->outline = loader->gloader->base.outline`) */
  copyFrom(o: Outline): void {
    this.nContours = o.nContours;
    this.nPoints = o.nPoints;
    this.points = o.points;
    this.tags = o.tags;
    this.contours = o.contours;
    this.flags = o.flags;
  }

  clear(): void {
    this.nContours = 0;
    this.nPoints = 0;
    this.points = new Int32Array(0);
    this.tags = new Uint8Array(0);
    this.contours = new Uint16Array(0);
    this.flags = 0;
  }
}

export interface BBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** FT_Outline_Get_CBox */
export function outlineGetCBox(o: Outline): BBox {
  if (o.nPoints === 0) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  const p = o.points;
  let xMin = p[0]!;
  let xMax = xMin;
  let yMin = p[1]!;
  let yMax = yMin;
  for (let i = 1; i < o.nPoints; i++) {
    const x = p[2 * i]!;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    const y = p[2 * i + 1]!;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  return { xMin, yMin, xMax, yMax };
}

/** FT_Outline_Translate (the offsets are added with the 32-bit wrap of FT_Pos) */
export function outlineTranslate(o: Outline, xOffset: number, yOffset: number): void {
  const p = o.points;
  for (let n = 0; n < (o.nPoints & 0xffff); n++) {
    p[2 * n] = (p[2 * n]! + xOffset) | 0;
    p[2 * n + 1] = (p[2 * n + 1]! + yOffset) | 0;
  }
}

/** FT_Outline_Check: 0 or FT_Err_Invalid_Argument */
export function outlineCheck(o: Outline): number {
  const nPoints = o.nPoints;
  const nContours = o.nContours;
  if (nPoints === 0 && nContours === 0) return 0;
  if (nPoints <= 0 || nContours <= 0) return FtErr.Invalid_Argument;
  let end0 = -1;
  let end = -1;
  for (let n = 0; n < nContours; n++) {
    end = o.contours[n]!;
    if (end <= end0 || end >= nPoints) return FtErr.Invalid_Argument;
    end0 = end;
  }
  if (end !== nPoints - 1) return FtErr.Invalid_Argument;
  return 0;
}

/** FT_Outline_Funcs (shift and delta are 0 for the gray rasterizer, so SCALED(x) is x) */
export interface OutlineFuncs {
  moveTo(x: number, y: number): number;
  lineTo(x: number, y: number): number;
  conicTo(cx: number, cy: number, x: number, y: number): number;
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): number;
}

/** FT_Outline_Decompose with shift = delta = 0 */
export function outlineDecompose(o: Outline, f: OutlineFuncs): number {
  const pts = o.points;
  const tags = o.tags;
  let first = 0;
  for (let n = 0; n < o.nContours; n++) {
    const last = o.contours[n]!;
    if (last < 0) return FtErr.Invalid_Outline;
    let limit = last; // index of the last point of this contour
    let vsx = pts[2 * first]!;
    let vsy = pts[2 * first + 1]!;
    let vlx = pts[2 * last]!;
    let vly = pts[2 * last + 1]!;
    let vcx = vsx;
    let vcy = vsy;
    let point = first;
    let tg = first; // index into tags
    let tag = tags[tg]! & 3;
    if (tag === FT_CURVE_TAG.CUBIC) return FtErr.Invalid_Outline;
    if (tag === FT_CURVE_TAG.CONIC) {
      if ((tags[last]! & 3) === FT_CURVE_TAG.ON) {
        vsx = vlx;
        vsy = vly;
        limit--;
      } else {
        vsx = Math.trunc((vsx + vlx) / 2) | 0;
        vsy = Math.trunc((vsy + vly) / 2) | 0;
        vlx = vsx;
        vly = vsy;
      }
      point--;
      tg--;
    }
    let error = f.moveTo(vsx, vsy);
    if (error) return error;
    let closed = false;
    outer: while (point < limit) {
      point++;
      tg++;
      tag = tags[tg]! & 3;
      switch (tag) {
        case FT_CURVE_TAG.ON: {
          error = f.lineTo(pts[2 * point]!, pts[2 * point + 1]!);
          if (error) return error;
          continue;
        }
        case FT_CURVE_TAG.CONIC: {
          vcx = pts[2 * point]!;
          vcy = pts[2 * point + 1]!;
          for (;;) {
            if (point < limit) {
              point++;
              tg++;
              tag = tags[tg]! & 3;
              const vx = pts[2 * point]!;
              const vy = pts[2 * point + 1]!;
              if (tag === FT_CURVE_TAG.ON) {
                error = f.conicTo(vcx, vcy, vx, vy);
                if (error) return error;
                continue outer;
              }
              if (tag !== FT_CURVE_TAG.CONIC) return FtErr.Invalid_Outline;
              const mx = Math.trunc((vcx + vx) / 2) | 0;
              const my = Math.trunc((vcy + vy) / 2) | 0;
              error = f.conicTo(vcx, vcy, mx, my);
              if (error) return error;
              vcx = vx;
              vcy = vy;
              continue;
            }
            error = f.conicTo(vcx, vcy, vsx, vsy);
            closed = true;
            break outer;
          }
        }
        default: {
          // cubic
          if (point + 1 > limit || (tags[tg + 1]! & 3) !== FT_CURVE_TAG.CUBIC) return FtErr.Invalid_Outline;
          point += 2;
          tg += 2;
          const v1x = pts[2 * (point - 2)]!;
          const v1y = pts[2 * (point - 2) + 1]!;
          const v2x = pts[2 * (point - 1)]!;
          const v2y = pts[2 * (point - 1) + 1]!;
          if (point <= limit) {
            error = f.cubicTo(v1x, v1y, v2x, v2y, pts[2 * point]!, pts[2 * point + 1]!);
            if (error) return error;
            continue;
          }
          error = f.cubicTo(v1x, v1y, v2x, v2y, vsx, vsy);
          closed = true;
          break outer;
        }
      }
    }
    if (!closed) error = f.lineTo(vsx, vsy);
    if (error) return error;
    first = last + 1;
  }
  return FtErr.Ok;
}
