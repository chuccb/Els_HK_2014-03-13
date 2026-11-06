/**
 * `x ^ y` and math.pow exactly as the LuaJIT 2.0 x86 interpreter computes them (vm_x86.dasc `vm_pow_sse` / `vm_powi_sse`; the exe is
 * the stock 2.0.2 VM, and `.define SSE, 1` is unconditional there). It is NOT the C library pow():
 *
 *  - an exponent that is an integer in the int32 range (checked with cvtsd2si and back) is raised by repeated squaring, one rounded
 *    multiplication per step, so e.g. 1.1^10 and 10^23 differ in the last bit from a correctly rounded pow() (and from JavaScript's `**`);
 *    a negative exponent is 1 / x^|i|;
 *  - x^NaN is 1 only for x == 1, otherwise NaN; x^(+-Inf), (+-0)^y and (+-Inf)^y are special-cased (sign of y, |x| compared to 1);
 *    note (-Inf)^y is +Inf or 0 whatever the parity of y, and (-1)^(2^31) is NaN because the exponent no longer fits int32;
 *  - everything else is x87 `fyl2x` + `f2xm1` + `fscale` (2^(y*log2 x)) in 80-bit arithmetic, NaN for x < 0. That is approximated here
 *    with Math.pow, which agrees except for the last bit in a small fraction of cases (not reproducible without an x87 emulation).
 */

const INT_MIN = -2147483648;

/** SSE2 cvtsd2si (32-bit result): round to nearest even; 0x80000000 when out of range or NaN. */
function cvtsd2si(y: number): number {
  if (y !== y) return INT_MIN;
  const f = Math.floor(y);
  const d = y - f;
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
  return r < INT_MIN || r > 2147483647 ? INT_MIN : r;
}

/** vm_powi_sse for an exponent e (uint32) that is at least 1. */
function powiPositive(x: number, e: number): number {
  while ((e & 1) === 0) {
    x = x * x; // handle leading zeros
    e >>>= 1;
  }
  e >>>= 1;
  if (e === 0) return x;
  let acc = x;
  for (;;) {
    x = x * x; // handle trailing bits
    const bit = e & 1;
    e >>>= 1;
    if (e === 0) return x * acc;
    if (bit) acc = acc * x;
  }
}

export function luaPow(x: number, y: number): number {
  const i = cvtsd2si(y);
  if (i === y) {
    // integral exponent in the int32 range: vm_powi_sse
    if (i === 1) return x;
    if (i === 0) return 1;
    if (i > 1) return powiPositive(x, i);
    return 1 / powiPositive(x, -i >>> 0);
  }
  if (y !== y) return x === 1 ? 1 : NaN; // x^NaN
  if (y === Infinity || y === -Infinity) {
    const ax = Math.abs(x);
    if (ax === 1 || ax !== ax) return ax; // +-1^+-Inf => 1 (NaN stays NaN)
    return ax < 1 !== y < 0 ? 0 : Infinity;
  }
  if (x === 0) return y < 0 ? Infinity : 0; // +-0^y
  if (x === Infinity || x === -Infinity) return y < 0 ? 0 : Infinity; // +-Inf^y
  if (x < 0) return NaN; // fyl2x of a negative number
  return Math.pow(x, y);
}
