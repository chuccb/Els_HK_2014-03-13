/**
 * C `printf` number conversions (%e %f %g) for doubles.
 *
 * JavaScript's toExponential/toFixed round an exactly-representable decimal tie *up* (0.5 -> "1", 2.5 -> "3"), while the
 * UCRT the client links against (and glibc) round ties to even, as IEEE 754 requires (0.5 -> "0", 2.5 -> "2"). Ties are
 * only possible for one specific cut position per value, found exactly from the odd mantissa/exponent split, so the
 * fast JS conversion is used and corrected only for those rare cases.
 */

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** x = m * 2^e with m odd; for finite x > 0. */
function oddMantissa(x: number): { m: number; e: number } {
  f64[0] = x;
  const lo = u32[0]!;
  const hi = u32[1]!;
  const be = (hi >>> 20) & 0x7ff;
  let mhi = hi & 0xfffff;
  let e: number;
  if (be === 0) e = -1074;
  else {
    mhi |= 0x100000;
    e = be - 1075;
  }
  let tz: number;
  if (lo !== 0) tz = 31 - Math.clz32(lo & -lo);
  else tz = 32 + 31 - Math.clz32(mhi & -mhi);
  const m = (mhi * 4294967296 + lo) / 2 ** tz;
  return { m, e: e + tz };
}

/** True when x * 10^k is exactly (integer + 1/2), i.e. rounding to k decimals is a decimal tie. x finite, > 0. */
function isTie(x: number, k: number): boolean {
  const { m, e } = oddMantissa(x);
  if (k !== -e - 1) return false;
  if (k >= 0) return true;
  const p = -k; // need 5^p | m
  if (p > 22) return false;
  return m % 5 ** p === 0;
}

function decLastDigit(s: string): string {
  const c = s.charCodeAt(s.length - 1);
  return s.slice(0, -1) + String.fromCharCode(c - 1);
}

/** Digits of the %e conversion without sign: returns [mantissa "d.ddd", exponent]. */
function expParts(x: number, prec: number): [string, number] {
  const s = x.toExponential(prec);
  const ei = s.indexOf("e");
  let mant = s.slice(0, ei);
  const ex = Number(s.slice(ei + 1));
  const last = mant.charCodeAt(mant.length - 1) - 48;
  if ((last & 1) === 1 && !(prec === 0 && mant === "1")) {
    // JS rounded an exact tie up; IEEE ties-to-even keeps the even digit
    if (isTie(x, prec - ex)) mant = decLastDigit(mant);
  }
  return [mant, ex];
}

function fixedAbs(x: number, prec: number): string {
  if (x >= 1e21) {
    let s = BigInt(x).toString();
    if (prec > 0) s += "." + "0".repeat(prec);
    return s;
  }
  let s = x.toFixed(prec);
  if (x !== 0) {
    const last = s.charCodeAt(s.length - 1) - 48;
    if ((last & 1) === 1 && isTie(x, prec)) s = decLastDigit(s);
  }
  return s;
}

function expSuffix(ex: number, upper: boolean): string {
  const a = Math.abs(ex);
  return (upper ? "E" : "e") + (ex < 0 ? "-" : "+") + (a < 10 ? "0" + a : String(a));
}

const isNeg = (n: number): boolean => n < 0 || Object.is(n, -0);

/** LuaJIT canonicalises every NaN to "nan" (lj_str_bufnum), whatever its sign. */
const NAN_TEXT = (upper: boolean): string => (upper ? "NAN" : "nan");

/** printf("%.<prec>e") (sign included). */
export function fmtE(n: number, prec: number, upper = false, alt = false): string {
  if (Number.isNaN(n)) return NAN_TEXT(upper);
  if (!Number.isFinite(n)) return (n < 0 ? "-" : "") + (upper ? "INF" : "inf");
  const sign = isNeg(n) ? "-" : "";
  const x = Math.abs(n);
  let mant: string, ex: number;
  if (x === 0) {
    mant = prec > 0 ? "0." + "0".repeat(prec) : "0";
    ex = 0;
  } else [mant, ex] = expParts(x, prec);
  if (alt && prec === 0) mant += ".";
  return sign + mant + expSuffix(ex, upper);
}

/** printf("%.<prec>f") (sign included). */
export function fmtF(n: number, prec: number, alt = false): string {
  if (Number.isNaN(n)) return NAN_TEXT(false);
  if (!Number.isFinite(n)) return n < 0 ? "-inf" : "inf";
  const sign = isNeg(n) ? "-" : "";
  const s = fixedAbs(Math.abs(n), prec);
  return sign + (alt && prec === 0 ? s + "." : s);
}

/** printf("%.<prec>g") (sign included); `alt` is the '#' flag (keep trailing zeros). */
export function fmtG(n: number, prec: number, alt = false, upper = false): string {
  if (Number.isNaN(n)) return NAN_TEXT(upper);
  if (!Number.isFinite(n)) return (n < 0 ? "-" : "") + (upper ? "INF" : "inf");
  if (prec === 0) prec = 1;
  const sign = isNeg(n) ? "-" : "";
  const x = Math.abs(n);
  if (x === 0) return sign + (alt ? "0." + "0".repeat(prec - 1) : "0");
  const [mant, ex] = expParts(x, prec - 1);
  let s: string;
  if (ex < -4 || ex >= prec) {
    let m = mant;
    if (!alt && m.includes(".")) m = m.replace(/\.?0+$/, "");
    else if (alt && !m.includes(".")) m += ".";
    s = m + expSuffix(ex, upper);
  } else {
    s = fixedAbs(x, prec - 1 - ex);
    if (!alt && s.includes(".")) s = s.replace(/\.?0+$/, "");
    else if (alt && !s.includes(".")) s += ".";
  }
  return sign + s;
}

/** Lua 5.1 tostring(number): "%.14g". */
export function luaNumberToString(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e14) return Object.is(n, -0) ? "-0" : String(n);
  return fmtG(n, 14);
}
