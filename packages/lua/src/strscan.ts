/**
 * String → number conversion: a literal port of LuaJIT 2.0 lj_strscan.c (`lj_strscan_scan` with STRSCAN_OPT_TONUM, i.e.
 * `lj_strscan_num`, which is what tonumber(), string arithmetic coercion and numeric `for` limits use).
 * The exe's copy (x2.exe.c: lj_strscan_scan 33373460, strscan_dec 33373A90, strscan_double 33374190, strscan_hex 333742E0) is the
 * stock 2.0 code.
 *
 * Why not Number()/parseFloat(): the decimal path scales a base-100 digit buffer by powers of two (6 bits at a time) and keeps one
 * sticky bit for the digits it drops, so for long inputs it is NOT always the correctly rounded double (the differential fuzz test
 * finds 17-digit strings whose result differs from the correctly rounded value by one ulp). Scripts that parse data at run time
 * must see the same doubles as the original client. Other differences from a plain parser, all checked against the native binary:
 *   - the input is a C string: an embedded NUL ends it (so "7\0abc" is 7),
 *   - "-0" is +0 (the 32-bit integer fast path negates an int), but "-0.0" and "-0e0" are -0,
 *   - "inf", "infinity", "nan" in any case with an optional sign are numbers; a sign on "nan" is ignored,
 *   - hex integers and hex floats ("0x1F", "0x.8", "0x1.8p1"), no octal, no binary, no 'U'/'L'/'LL'/'i' suffixes,
 *   - leading and trailing white space (space and \t \n \v \f \r) is allowed, nothing else.
 */

const DIG_MAX = 800; // STRSCAN_MAXDIG
const DDIG = 512; // STRSCAN_DDIG = STRSCAN_DIG / 2
const DMASK = DDIG - 1;

const dnext = (a: number): number => (a + 1) & DMASK;
const dprev = (a: number): number => (a - 1) & DMASK;
const dlen = (lo: number, hi: number): number => (lo - hi) & DMASK;

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isXDigit = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isSpace = (c: number): boolean => c === 32 || (c >= 9 && c <= 13);
const casecmp = (c: number, k: number): boolean => (c | 0x20) === k;

const U64 = (1n << 64n) - 1n;

/** C ldexp(): x * 2^e with a single rounding (the callers have already made denormal results exact). */
function ldexp(x: number, e: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  while (e > 1000) {
    x *= 2 ** 1000;
    e -= 1000;
    if (!Number.isFinite(x)) return x;
  }
  while (e < -1000) {
    x *= 2 ** -1000;
    e += 1000;
    if (x === 0) return x;
  }
  return x * 2 ** e;
}

/** strscan_double: final conversion to double (x is a uint64 that fits in a positive int64). */
function strscanDouble(x: bigint, ex2: number, neg: number): number {
  // Avoid double rounding for denormals.
  if (ex2 <= -1075 && x !== 0n) {
    const b = x.toString(2).length - 1; // clz64(x) ^ 63
    if (b + ex2 <= -1023 && b + ex2 >= -1075) {
      const rb = 1n << BigInt(-1075 - ex2);
      if ((x & rb) !== 0n && (x & (rb + rb + rb - 1n)) !== 0n) x += rb + rb;
      x &= ~(rb + rb - 1n);
    }
  }
  // Convert to double using a signed int64 conversion (round to nearest even), then rescale.
  let n = Number(BigInt.asIntN(64, x));
  if (neg) n = -n;
  if (ex2) n = ldexp(n, ex2);
  return n;
}

/** strscan_hex (STRSCAN_OPT_TONUM): `p` indexes the first significant digit; `dig` is the number of digits (the '.' is skipped). */
function strscanHex(ch: (i: number) => number, p: number, ex2: number, neg: number, dig: number): number {
  let x = 0n;
  let i: number;
  // Scan hex digits.
  for (i = dig > 16 ? 16 : dig; i; i--, p++) {
    let d = ch(p) !== 46 ? ch(p) : ch(++p);
    if (d > 57) d += 9;
    x = (x << 4n) + BigInt(d & 15);
  }
  // Summarize rounding-effect of excess digits.
  for (i = 16; i < dig; i++, p++) {
    x |= (ch(p) !== 46 ? ch(p) : ch(++p)) !== 48 ? 1n : 0n;
    ex2 += 4;
  }
  // Reduce range then convert to double.
  if ((x & 0xc000000000000000n) !== 0n) {
    x = (x >> 2n) | (x & 3n);
    ex2 += 2;
  }
  return strscanDouble(x, ex2, neg);
}

/** strscan_dec (STRSCAN_OPT_TONUM, integer format already folded into plain numbers). */
function strscanDec(ch: (i: number) => number, p: number, ex10: number, neg: number, dig: number): number {
  const xi = new Uint8Array(DDIG);
  let xip = 0;
  /** `(*p != '.' ? *p : *++p)` */
  const rd = (): number => {
    if (ch(p) === 46) p++;
    return ch(p);
  };

  if (dig) {
    let i = dig;
    if (i > DIG_MAX) {
      ex10 += i - DIG_MAX;
      i = DIG_MAX;
    }
    // Scan unaligned leading digit.
    if ((ex10 ^ i) & 1) {
      xi[xip++] = rd() & 15;
      i--;
      p++;
    }
    // Scan aligned double-digits.
    for (; i > 1; i -= 2) {
      const d = 10 * (rd() & 15);
      p++;
      xi[xip++] = d + (rd() & 15);
      p++;
    }
    // Scan and realign trailing digit.
    if (i) {
      xi[xip++] = 10 * (rd() & 15);
      ex10--;
      p++;
    }
    // Summarize rounding-effect of excess digits.
    if (dig > DIG_MAX) {
      do {
        if (rd() !== 48) {
          xi[xip - 1] |= 1;
          break;
        }
        p++;
      } while (--dig > DIG_MAX);
      dig = DIG_MAX;
    } else {
      // Simplify exponent.
      while (ex10 > 0 && dig <= 18) {
        xi[xip++] = 0;
        ex10 -= 2;
        dig += 2;
      }
    }
  } else {
    // Only got zeros.
    ex10 = 0;
    xi[0] = 0;
  }

  // Fast path for numbers in integer format (but handles e.g. 1e6, too).
  if (dig <= 20 && ex10 === 0) {
    let x = BigInt(xi[0]!);
    for (let xis = 1; xis < xip; xis++) x = (x * 100n + BigInt(xi[xis]!)) & U64;
    const negative64 = x >= 1n << 63n; // (int64_t)x < 0
    if (!(dig === 20 && (xi[0]! > 18 || !negative64))) {
      // No overflow? Fast path for plain numbers < 2^63.
      if (!negative64) {
        const n = Number(x);
        return neg ? -n : n;
      }
    }
  }

  // Slow non-integer path.
  let hi = 0;
  let lo = xip;
  let ex2 = 0;
  let idig = lo + (ex10 >> 1);

  // Handle simple overflow/underflow.
  if (idig > 310 / 2) return neg ? -Infinity : Infinity;
  if (idig < -326 / 2) return neg ? -0 : 0;

  // Scale up until we have at least 17 or 18 integer part digits.
  while (idig < 9 && idig < dlen(lo, hi)) {
    let cy = 0;
    ex2 -= 6;
    for (let i = dprev(lo); ; i = dprev(i)) {
      let d = (xi[i]! << 6) + cy;
      cy = ((d >> 2) * 5243) >> 17;
      d = d - cy * 100; // Div/mod 100.
      xi[i] = d;
      if (i === hi) break;
      if (d === 0 && i === dprev(lo)) lo = i;
    }
    if (cy) {
      hi = dprev(hi);
      if (xi[dprev(lo)] === 0) lo = dprev(lo);
      else if (hi === lo) {
        lo = dprev(lo);
        xi[dprev(lo)] |= xi[lo]!;
      }
      xi[hi] = cy;
      idig++;
    }
  }

  // Scale down until no more than 17 or 18 integer part digits remain.
  while (idig > 9) {
    let cy = 0;
    ex2 += 6;
    for (let i = hi; i !== lo; i = dnext(i)) {
      cy += xi[i]!;
      xi[i] = cy >> 6;
      cy = 100 * (cy & 0x3f);
      if (xi[i] === 0 && i === hi) {
        hi = dnext(hi);
        idig--;
      }
    }
    while (cy) {
      if (hi === lo) {
        xi[dprev(lo)] |= 1;
        break;
      }
      xi[lo] = cy >> 6;
      lo = dnext(lo);
      cy = 100 * (cy & 0x3f);
    }
  }

  // Collect integer part digits and convert to rescaled double.
  let x = BigInt(xi[hi]!);
  let i: number;
  for (i = dnext(hi); --idig > 0 && i !== lo; i = dnext(i)) x = x * 100n + BigInt(xi[i]!);
  if (i === lo) {
    while (--idig >= 0) x *= 100n;
  } else {
    // Gather round bit from remaining digits.
    x <<= 1n;
    ex2--;
    do {
      if (xi[i]) {
        x |= 1n;
        break;
      }
      i = dnext(i);
    } while (i !== lo);
  }
  return strscanDouble(x, ex2, neg);
}

/** lj_strscan_num: the number the string denotes, or undefined when it is not a number. */
export function scanNumber(s: string): number | undefined {
  const ch = (i: number): number => (i < s.length ? s.charCodeAt(i) & 0xff : 0);
  let p = 0;
  let neg = 0;

  // Remove leading space, parse sign and non-numbers.
  if (!isDigit(ch(p))) {
    while (isSpace(ch(p))) p++;
    if (ch(p) === 43 || ch(p) === 45) neg = ch(p++) === 45 ? 1 : 0;
    if (ch(p) >= 65) {
      // Parse "inf", "infinity" or "nan".
      let tmp = NaN;
      if (casecmp(ch(p), 105) && casecmp(ch(p + 1), 110) && casecmp(ch(p + 2), 102)) {
        tmp = neg ? -Infinity : Infinity;
        p += 3;
        if (casecmp(ch(p), 105) && casecmp(ch(p + 1), 110) && casecmp(ch(p + 2), 105) && casecmp(ch(p + 3), 116) && casecmp(ch(p + 4), 121)) p += 5;
      } else if (casecmp(ch(p), 110) && casecmp(ch(p + 1), 97) && casecmp(ch(p + 2), 110)) {
        p += 3;
      }
      while (isSpace(ch(p))) p++;
      if (ch(p)) return undefined;
      return tmp;
    }
  }

  // Parse regular number.
  let isInt = true; // fmt == STRSCAN_INT (no decimal point, no exponent)
  let hex = false;
  let dp = -1; // position of the decimal point, -1 = none
  let dig = 0;
  let hasdig = 0;
  let x = 0;
  let ex = 0;

  // Determine base and skip leading zeros.
  if (ch(p) <= 48) {
    if (ch(p) === 48 && casecmp(ch(p + 1), 120)) {
      hex = true;
      p += 2;
    }
    for (; ; p++) {
      if (ch(p) === 48) hasdig = 1;
      else if (ch(p) === 46) {
        if (dp >= 0) return undefined;
        dp = p;
      } else break;
    }
  }

  // Preliminary digit and decimal point scan.
  const sp = p;
  for (; ; p++) {
    const c = ch(p);
    if (hex ? isXDigit(c) : isDigit(c)) {
      x = (Math.imul(x, 10) + (c & 15)) >>> 0; // for the fast path below
      dig++;
    } else if (c === 46) {
      if (dp >= 0) return undefined;
      dp = p;
    } else break;
  }
  if (!(hasdig | dig)) return undefined;

  // Handle decimal point.
  if (dp >= 0) {
    isInt = false;
    if (dig) {
      ex = dp - (p - 1);
      dp = p - 1;
      while (ex < 0) {
        const c = ch(dp);
        dp--;
        if (c !== 48) break;
        ex++;
        dig--; // Skip trailing zeros.
      }
      if (hex) ex *= 4;
    }
  }

  // Parse exponent.
  if (casecmp(ch(p), hex ? 112 : 101)) {
    let negx = 0;
    isInt = false;
    p++;
    if (ch(p) === 43 || ch(p) === 45) negx = ch(p++) === 45 ? 1 : 0;
    if (!isDigit(ch(p))) return undefined;
    let xx = ch(p++) & 15;
    while (isDigit(ch(p))) {
      if (xx < 65536) xx = xx * 10 + (ch(p) & 15);
      p++;
    }
    ex += negx ? -xx : xx;
  }

  // Parse suffix: with STRSCAN_OPT_TONUM nothing but white space may follow ('I', 'U', 'L', 'LL' suffixes are all errors here).
  if (ch(p)) {
    if (casecmp(ch(p), 105)) return undefined;
    if (isInt && (casecmp(ch(p), 117) || casecmp(ch(p), 108))) return undefined;
    while (isSpace(ch(p))) p++;
    if (ch(p)) return undefined;
  }

  // Fast path for decimal 32 bit integers.
  if (isInt && !hex && (dig < 10 || (dig === 10 && ch(sp) <= 50 && x < 0x80000000 + neg))) {
    const xs = x | 0;
    return neg ? -xs | 0 : xs;
  }

  // Dispatch to the base-specific parser.
  return hex ? strscanHex(ch, sp, ex, neg, dig) : strscanDec(ch, sp, ex, neg, dig);
}
