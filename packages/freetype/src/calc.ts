/**
 * Fixed-point arithmetic of FreeType 2.4.11 (ftcalc.c) the way x2.exe's copy computes it.  The exe was built without FT_LONG64, so FT_MulDiv /
 * FT_MulDiv_No_Round / FT_DivFix are the 32-bit-pair versions (ft_multo64, FT_Add64, ft_div64by32; FT_MulDiv 0x32831B90, FT_MulDiv_No_Round
 * 0x32831C50, FT_DivFix 0x32831D10) and FT_MulFix is the x86 assembler version of ftconfig.h (0x32831CE0: `imul`, add 0x8000 plus the sign of the
 * product, `shrd` by 16 -- the same rounding as the C text, half away from zero).  All values are 32-bit signed (FT_Long is `long` on Win32).
 */

/** FT_MulFix: (a * b) / 0x10000, rounded to nearest, ties away from zero; the low 32 bits of the quotient like the `shrd` of the exe */
export function mulFix(a: number, b: number): number {
  const p = a * b; // exact below 2^53
  if (p > -9007199254740992 && p < 9007199254740992) {
    return Math.floor((p + 0x8000 + (p < 0 ? -1 : 0)) / 65536) | 0;
  }
  const q = (BigInt(a) * BigInt(b) + 0x8000n + (a < 0 !== b < 0 ? -1n : 0n)) >> 16n;
  return Number(BigInt.asIntN(32, q));
}

/** ft_multo64: the 64-bit product of two unsigned 32-bit numbers as [hi, lo] */
function multo64(x: number, y: number): [number, number] {
  const lo1 = x & 0xffff;
  const hi1 = x >>> 16;
  const lo2 = y & 0xffff;
  const hi2 = y >>> 16;
  let lo = lo1 * lo2; // < 2^32
  let i1 = lo1 * hi2;
  const i2 = lo2 * hi1;
  let hi = hi1 * hi2;
  i1 += i2;
  const carry = i1 >= 4294967296 ? 1 : 0; // (FT_UInt32)(i1 < i2) after the 32-bit wrap
  i1 >>>= 0;
  hi += carry << 16;
  hi += i1 >>> 16;
  i1 = (i1 << 16) >>> 0;
  lo += i1;
  if (lo >= 4294967296) {
    lo -= 4294967296;
    hi += 1;
  }
  return [hi >>> 0, lo >>> 0];
}

/** FT_Add64 of [hi, lo] pairs */
function add64(x: [number, number], y: [number, number]): [number, number] {
  let lo = x[1] + y[1];
  let hi = x[0] + y[0];
  if (lo >= 4294967296) {
    lo -= 4294967296;
    hi += 1;
  }
  return [hi >>> 0, lo >>> 0];
}

/**
 * ft_div64by32 (0x32831B30; register arguments eax = lo, ecx = hi, edx = y): the 32-bit quotient of the 64-bit [hi, lo] by y, or 0x7FFFFFFF when `hi >= y` (all
 * unsigned).  The remainder stays below y <= 2^31 so `r * 2 + bit` fits in 32 bits, as it does in the exe's registers.
 */
function div64by32(hi: number, lo: number, y: number): number {
  y >>>= 0;
  let r = hi >>> 0;
  if (r >= y) return 0x7fffffff;
  let q = 0;
  lo >>>= 0;
  for (let i = 32; i > 0; i--) {
    r = r * 2 + (lo >>> 31);
    q = q * 2;
    if (r >= y) {
      r -= y;
      q += 1;
    }
    lo = (lo << 1) >>> 0;
  }
  return q >>> 0;
}

/** `cdq; xor; sub`: |x| in 32 bits, INT_MIN stays INT_MIN */
const abs32 = (x: number): number => {
  const m = x >> 31;
  return ((x ^ m) - m) | 0;
};

/**
 * FT_MulDiv (0x32831B90): (a * b + c / 2) / c.  The exe's machine code: absolute values by cdq / xor / sub (INT_MIN stays negative), SIGNED compares for the
 * fast path (|a|, |b| <= 46340 and |c| <= 176095), the fast path's product by a 32-bit `imul` and the quotient by `idiv`; the slow path is the 64-bit product
 * (ft_multo64 on the unsigned bit patterns), FT_Add64 of c >> 1 and ft_div64by32.  `c <= 0` after the absolute value gives 0x7FFFFFFF.
 */
export function mulDiv(a: number, b: number, c: number): number {
  a |= 0;
  b |= 0;
  c |= 0;
  if (a === 0 || b === c) return a;
  const s = a ^ b ^ c;
  const ua = abs32(a);
  const ub = abs32(b);
  const uc = abs32(c);
  let r: number;
  if (ua > 46340 || ub > 46340 || uc > 176095) {
    if (uc > 0) {
      const t = add64(multo64(ua >>> 0, ub >>> 0), [0, uc >> 1]);
      r = div64by32(t[0], t[1], uc) | 0;
    } else r = 0x7fffffff;
  } else if (uc > 0) r = Math.trunc(((Math.imul(ua, ub) + (uc >> 1)) | 0) / uc) | 0;
  else r = 0x7fffffff;
  return s < 0 ? -r | 0 : r;
}

/** FT_MulDiv_No_Round (0x32831C50): (a * b) / c truncated, same structure as FT_MulDiv without the `c <= 176095` test and the rounding term */
export function mulDivNoRound(a: number, b: number, c: number): number {
  a |= 0;
  b |= 0;
  c |= 0;
  if (a === 0 || b === c) return a;
  const s = a ^ b ^ c;
  const ua = abs32(a);
  const ub = abs32(b);
  const uc = abs32(c);
  let r: number;
  if (ua > 46340 || ub > 46340) {
    if (uc > 0) {
      const t = multo64(ua >>> 0, ub >>> 0);
      r = div64by32(t[0], t[1], uc) | 0;
    } else r = 0x7fffffff;
  } else if (uc > 0) r = Math.trunc(Math.imul(ua, ub) / uc) | 0;
  else r = 0x7fffffff;
  return s < 0 ? -r | 0 : r;
}

/**
 * FT_DivFix (0x32831D10): (a * 0x10000 + b / 2) / b.  `b == 0` gives 0x7FFFFFFF.  When |a| >> 16 (an arithmetic shift) is 0 the quotient is the unsigned
 * 32-bit division of `(|b| >> 1) + (|a| << 16)` (which wraps for a large |b|, as in the exe) by |b|; otherwise the 64-bit path.
 */
export function divFix(a: number, b: number): number {
  a |= 0;
  b |= 0;
  const s = a ^ b;
  const ua = abs32(a);
  const ub = abs32(b);
  let q: number;
  if (ub === 0) q = 0x7fffffff;
  else {
    const hi = ua >> 16;
    const lo = (ua << 16) >>> 0;
    if (hi === 0) q = Math.floor((((ub >> 1) + lo) >>> 0) / (ub >>> 0));
    else {
      const t = add64([hi >>> 0, lo], [0, (ub >> 1) >>> 0]);
      q = div64by32(t[0], t[1], ub);
    }
  }
  return s < 0 ? -q | 0 : q | 0;
}
