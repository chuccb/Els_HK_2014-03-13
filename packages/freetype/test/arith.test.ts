import { describe, expect, test } from "bun:test";
import { divFix, mulDiv, mulDivNoRound, mulFix, sqrtFixed, vectorLength, vectorTransform } from "../src/index.ts";

/**
 * The fixed-point helpers with values worked out by hand from their definitions (docs/FINDINGS.md 17.11 has the disassembly of the exe's versions: built
 * without FT_LONG64, so a 32-bit fast path with a 64-bit fallback).  The edge cases -- INT_MIN, wrap-around, a zero divisor -- are in oracle.test.ts, taken
 * from the exe's own code.
 */
describe("FT_MulFix: (a * b + 0x8000) >> 16, rounding half away from zero", () => {
  test("16.16 numbers", () => {
    expect(mulFix(0x10000, 0x10000)).toBe(0x10000); // 1.0 * 1.0
    expect(mulFix(1000000, 0x10000)).toBe(1000000);
    expect(mulFix(0x7fffffff, 0x10000)).toBe(0x7fffffff);
    expect(mulFix(0, 12345)).toBe(0);
    expect(mulFix(12345, 0)).toBe(0);
  });
  test("rounding", () => {
    expect(mulFix(3, 0x8000)).toBe(2); // 1.5 -> 2
    expect(mulFix(-3, 0x8000)).toBe(-2); // -1.5 -> -2, not -1
    expect(mulFix(1, 0x8000)).toBe(1); // 0.5 -> 1
    expect(mulFix(1, 0x7fff)).toBe(0); // 0.49998 -> 0
    expect(mulFix(-5, 0xc000)).toBe(-4); // -3.75 -> -4
    expect(mulFix(5, -0xc000)).toBe(-4);
    expect(mulFix(-5, -0xc000)).toBe(4);
    expect(mulFix(-1, 0x8000)).toBe(-1); // -0.5 -> -1
    expect(mulFix(-1, 0x7fff)).toBe(0);
  });
  test("a product past 2^53 keeps the low 32 bits of the rounded quotient (ties away from zero)", () => {
    // 0x7fff8000 * 0x7fffffff = 2^15 * 65535 * 2147483647 is a tie (the product is 0x8000 mod 0x10000): the quotient 70367670403072.5 rounds to
    // 70367670403073 = 0x3FFFBFFF8001, whose low 32 bits are 0xBFFF8001; with the other sign the result is the negated quotient, low 32 bits 0x40007FFF
    expect(mulFix(0x7fff8000, 0x7fffffff)).toBe(-1073774591);
    expect(mulFix(0x7fff8000, -0x7fffffff)).toBe(1073774591);
    expect(mulFix(0x7fffffff, 0x7fffffff)).toBe(-65536); // (2^62 - 2^32 + 1 + 0x8000) >> 16 = 0x3FFFFFFF0000
  });
});

describe("FT_MulDiv: (a * b + c / 2) / c, FT_MulDiv_No_Round: (a * b) / c", () => {
  test("rounded", () => {
    expect(mulDiv(3, 5, 2)).toBe(8); // (15 + 1) / 2
    expect(mulDiv(-3, 5, 2)).toBe(-8);
    expect(mulDiv(3, -5, 2)).toBe(-8);
    expect(mulDiv(-3, -5, 2)).toBe(8);
    expect(mulDiv(1000, 3, 7)).toBe(429); // 3003 / 7
    expect(mulDiv(7, 1, 2)).toBe(4); // (7 + 1) / 2
    expect(mulDiv(7, 1, 3)).toBe(2); // (7 + 1) / 3 = 2.67 -> 2 (the division truncates after the half is added)
    expect(mulDiv(0, 5, 3)).toBe(0);
    expect(mulDiv(1, 2, 3)).toBe(1); // 1 ^ 2 ^ 3 == 0: the sign test is on the sign bit, so zero is positive
    expect(mulDiv(-1, -2, 3)).toBe(1);
    expect(mulDiv(5, 7, 7)).toBe(5); // b == c gives a
    expect(mulDiv(-5, 7, 7)).toBe(-5);
  });
  test("the 32-bit fast path ends where the product (plus half of c) would pass 2^31", () => {
    expect(mulDiv(46340, 46340, 2)).toBe(1073697800); // (2147395600 + 1) / 2
    expect(mulDiv(46341, 46341, 2)).toBe(1073744141); // (2147488281 + 1) / 2: the product no longer fits 31 bits
    expect(mulDiv(46340, 46340, 176095)).toBe(12195); // 2147395600 + 88047 = 2^31 - 1
    expect(mulDiv(46340, 46340, 176096)).toBe(12194); // 2147395600 + 88048 = 2^31: slow path, (2^31) / 176096
    expect(mulDivNoRound(46341, 46341, 2)).toBe(1073744140);
    // one operand past the limit, the other not: 46341 * 46340 = 2147441940 fits, but with the half of 176095 it is 2147529987 > 2^31 - 1 (176095 * 12195 =
    // 2147478525, remainder 51462), so the 32-bit sum would wrap and the slow path must be taken, whichever operand is the large one
    expect(mulDiv(46341, 46340, 176095)).toBe(12195);
    expect(mulDiv(46340, 46341, 176095)).toBe(12195);
    expect(mulDiv(-46341, 46340, 176095)).toBe(-12195);
  });
  test("a zero divisor gives 0x7FFFFFFF with the sign of the other two", () => {
    expect(mulDiv(5, 7, 0)).toBe(0x7fffffff);
    expect(mulDiv(-5, 7, 0)).toBe(-0x7fffffff);
    expect(mulDivNoRound(5, 7, 0)).toBe(0x7fffffff);
  });
  test("not rounded", () => {
    expect(mulDivNoRound(3, 5, 2)).toBe(7);
    expect(mulDivNoRound(-3, 5, 2)).toBe(-7);
    expect(mulDivNoRound(1000, 3, 7)).toBe(428);
    expect(mulDivNoRound(1000, 3, -7)).toBe(-428);
    expect(mulDivNoRound(3, 2, 1)).toBe(6); // 3 ^ 2 ^ 1 == 0: positive
    expect(mulDivNoRound(7, 2, 3)).toBe(4); // 14 / 3, no half added
  });
  test("products over 32 bits", () => {
    expect(mulDiv(0x10000, 0x10000, 0x10000)).toBe(0x10000); // 2^32 / 2^16, past the 32-bit fast path
    expect(mulDiv(100000, 100000, 1000)).toBe(10000000); // 10^10 / 10^3
  });
});

describe("FT_DivFix: ((a << 16) + b / 2) / b", () => {
  test("values", () => {
    expect(divFix(1, 1)).toBe(0x10000);
    expect(divFix(1, 2)).toBe(0x8000); // (65536 + 1) / 2
    expect(divFix(1, 3)).toBe(21845); // (65536 + 1) / 3
    expect(divFix(2, 3)).toBe(43691); // (131072 + 1) / 3
    expect(divFix(0, 5)).toBe(0);
    expect(divFix(5, 0)).toBe(0x7fffffff); // a zero divisor
    expect(divFix(3, 0x7fffffff)).toBe(0); // (3 << 16) / 0x7fffffff, rounded
    expect(divFix(0x7fff, 0xffff)).toBe(32767); // (0x7fff0000 + 0x7fff) / 0xffff = 32767.5 -> 32767: the half of b is added, and the division floors
  });
  test("a numerator with bits above 16 takes the 64-bit division", () => {
    expect(divFix(0x10000, 1)).toBe(0x7fffffff); // 2^32 does not fit: the exe answers 0x7FFFFFFF
    expect(divFix(0x20000, 0x30000)).toBe(0xaaab); // 2/3 = 43690.67 -> 43691
    expect(divFix(0x7fff0000, 0x7fff0000)).toBe(0x10000);
  });
  test("signs", () => {
    expect(divFix(-1, 3)).toBe(-21845);
    expect(divFix(1, -3)).toBe(-21845);
    expect(divFix(-1, -3)).toBe(21845);
  });
});

describe("FT_SqrtFixed, FT_Vector_Length, FT_Vector_Transform", () => {
  test("sqrt of 16.16 numbers", () => {
    expect(sqrtFixed(0)).toBe(0);
    expect(sqrtFixed(0x10000)).toBe(0x10000); // sqrt(1) = 1
    expect(sqrtFixed(0x40000)).toBe(0x20000); // sqrt(4) = 2
    expect(sqrtFixed(0x90000)).toBe(0x30000); // sqrt(9) = 3
    expect(sqrtFixed(0x20000)).toBe(0x16a09); // sqrt(2) = 1.41421 -> 92681 = 0x16A09 (floor of 92681.9)
  });
  test("a vector on an axis has the length of its coordinate", () => {
    expect(vectorLength(0, 0)).toBe(0);
    expect(vectorLength(64, 0)).toBe(64);
    expect(vectorLength(-5, 0)).toBe(5);
    expect(vectorLength(0, -64)).toBe(64);
  });
  test("transform: x' = x * xx + y * xy, y' = x * yx + y * yy (16.16 matrix)", () => {
    const t = (x: number, y: number, xx: number, xy: number, yx: number, yy: number): number[] => {
      const v = new Int32Array([x, y]);
      vectorTransform(v, 0, xx, xy, yx, yy);
      return [v[0]!, v[1]!];
    };
    expect(t(64, 32, 0x10000, 0, 0, 0x10000)).toEqual([64, 32]); // identity
    expect(t(64, 32, 0, -0x10000, 0x10000, 0)).toEqual([-32, 64]); // a quarter turn
    expect(t(64, 32, 0x18000, 0x8000, 0, 0x10000)).toEqual([112, 32]); // 64 * 1.5 + 32 * 0.5 = 112
    expect(t(64, -32, 0x20000, 0, 0, 0x20000)).toEqual([128, -64]); // scale by 2
  });
  test("transform works on the pair at v[i], v[i + 1]; the rest of the array is untouched", () => {
    const v = new Int32Array([1, 2, 64, 32, 5, 6]);
    vectorTransform(v, 2, 0, -0x10000, 0x10000, 0);
    expect(Array.from(v)).toEqual([1, 2, -32, 64, 5, 6]);
  });
});
