import { mulFix } from "./calc.ts";

/**
 * The parts of fttrigon.c / ftcalc.c / ftoutln.c the TrueType loader and interpreter use: FT_Vector_Length (TT_VecLen, so every SVTL / SPVFS / SFVFS and every
 * non-axis projection), FT_SqrtFixed (SCALED_COMPONENT_OFFSET) and FT_Vector_Transform (composite components).  The exe's copy is built without FT_LONG64, so
 * ft_trig_downscale is the 32-bit-pair version.
 */

const FT_ANGLE_PI2 = 90 << 16;
const FT_TRIG_SCALE = 0x9b74eda8;
const ARCTAN = [2949120, 1740967, 919879, 466945, 234379, 117304, 58666, 29335, 14668, 7334, 3667, 1833, 917, 458, 229, 115, 57, 29, 14, 7, 4, 2, 1];

function trigDownscale(val: number): number {
  const s = val;
  val = val >= 0 ? val : -val | 0;
  const v1 = val >>> 16;
  const v2 = val & 0xffff;
  const k1 = FT_TRIG_SCALE >>> 16;
  const k2 = FT_TRIG_SCALE & 0xffff;
  let hi = (k1 * v1) >>> 0;
  let lo1 = (k1 * v2 + k2 * v1) >>> 0;
  const lo2 = ((k2 * v2) >>> 16) >>> 0;
  const lo3 = lo1 >= lo2 ? lo1 : lo2;
  lo1 = (lo1 + lo2) >>> 0;
  hi = (hi + (lo1 >>> 16)) >>> 0;
  if (lo1 < lo3) hi = (hi + 0x10000) >>> 0;
  val = hi | 0;
  return s >= 0 ? val : -val | 0;
}

/** ft_trig_prenorm: returns the shift and leaves the normalised vector in v */
function trigPrenorm(v: { x: number; y: number }): number {
  const x = v.x;
  const y = v.y;
  let z = (x >= 0 ? x : -x | 0) | (y >= 0 ? y : -y | 0);
  let shift = 0;
  if (z >= 1 << 16) {
    z >>= 16;
    shift += 16;
  }
  if (z >= 1 << 8) {
    z >>= 8;
    shift += 8;
  }
  if (z >= 1 << 4) {
    z >>= 4;
    shift += 4;
  }
  if (z >= 1 << 2) {
    z >>= 2;
    shift += 2;
  }
  if (z >= 1 << 1) {
    z >>= 1;
    shift += 1;
  }
  if (shift <= 27) {
    shift = 27 - shift;
    v.x = x << shift;
    v.y = y << shift;
  } else {
    shift -= 27;
    v.x = x >> shift;
    v.y = y >> shift;
    shift = -shift;
  }
  return shift;
}

/** ft_trig_pseudo_polarize: v.x becomes the (scaled) length, v.y the angle */
function trigPseudoPolarize(v: { x: number; y: number }): void {
  let x = v.x;
  let y = v.y;
  let theta = 0;
  if (x < 0) {
    x = -x | 0;
    y = -y | 0;
    theta = 2 * FT_ANGLE_PI2;
  }
  if (y > 0) theta = -theta;
  for (let i = 0; i < 23; i++) {
    if (y > 0) {
      const xt = (x + (y >> i)) | 0;
      y = (y - (x >> i)) | 0;
      x = xt;
      theta = (theta + ARCTAN[i]!) | 0;
    } else {
      const xt = (x - (y >> i)) | 0;
      y = (y + (x >> i)) | 0;
      x = xt;
      theta = (theta - ARCTAN[i]!) | 0;
    }
  }
  theta = theta >= 0 ? (theta + 16) & ~31 : -((-theta + 16) & ~31) | 0;
  v.x = x;
  v.y = theta;
}

/** FT_Vector_Length */
export function vectorLength(x: number, y: number): number {
  if (x === 0) return y >= 0 ? y : -y | 0;
  if (y === 0) return x >= 0 ? x : -x | 0;
  const v = { x, y };
  const shift = trigPrenorm(v);
  trigPseudoPolarize(v);
  v.x = trigDownscale(v.x);
  if (shift > 0) return (v.x + (1 << (shift - 1))) >> shift;
  return v.x << -shift;
}

/** FT_SqrtFixed */
export function sqrtFixed(x: number): number {
  let root = 0;
  if (x > 0) {
    let remHi = 0;
    let remLo = x >>> 0;
    let count = 24;
    do {
      remHi = ((remHi << 2) | (remLo >>> 30)) >>> 0;
      remLo = (remLo << 2) >>> 0;
      root = (root << 1) >>> 0;
      const testDiv = ((root << 1) + 1) >>> 0;
      if (remHi >= testDiv) {
        remHi = (remHi - testDiv) >>> 0;
        root = (root + 1) >>> 0;
      }
    } while (--count);
  }
  return root | 0;
}

/** FT_Vector_Transform on the pair (x, y) at v[i], v[i + 1]; the matrix is xx, xy, yx, yy (16.16) */
export function vectorTransform(v: Int32Array, i: number, xx: number, xy: number, yx: number, yy: number): void {
  const x = v[i]!;
  const y = v[i + 1]!;
  const xz = (mulFix(x, xx) + mulFix(y, xy)) | 0;
  const yz = (mulFix(x, yx) + mulFix(y, yy)) | 0;
  v[i] = xz;
  v[i + 1] = yz;
}
