import { describe, expect, test } from "bun:test";
import { ttDotFix14, ttMulFix14 } from "../src/interp.ts";

/**
 * The two 14-bit fixed-point helpers of the bytecode interpreter (ttinterp.c, built without FT_LONG64: 32-bit halves with a carry).  They are only exact for
 * the numbers the interpreter gives them: the second factor of TT_MulFix14 and both of TT_DotFix14 are components of a unit vector, at most 0x4000 in size.
 * Expected values come from the definition (a product, 0x2000 added, shifted right by 14, ties away from zero), computed here with BigInt, plus a few ties
 * worked out on paper; the interpreter that runs real glyphs against the exe is covered by oracle.test.ts.
 */
const i32 = (x: bigint): number => Number(BigInt.asIntN(32, x));
const absB = (x: bigint): bigint => (x < 0n ? -x : x);

/** (|a| * |b| + 0x2000) >> 14, negated when a and b have different signs (the sign of a ^ b) */
const mulFix14Model = (a: number, b: number): number => {
  const r = (absB(BigInt(a)) * absB(BigInt(b)) + 0x2000n) >> 14n;
  return i32(a < 0 !== b < 0 ? -r : r);
};

/** (ax * bx + ay * by + 0x2000 + (the sum < 0 ? -1 : 0)) >> 14, an arithmetic shift of the 64-bit sum: a negative tie goes away from zero as well */
const dotFix14Model = (ax: number, ay: number, bx: number, by: number): number => {
  const sum = BigInt(ax) * BigInt(bx) + BigInt(ay) * BigInt(by);
  return i32((sum + (sum < 0n ? -1n : 0n) + 0x2000n) >> 14n);
};

function* values(seed: number, n: number, limit: number): Generator<number> {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n; i++) yield Math.floor((rnd() * 2 - 1) * limit);
}

describe("TT_MulFix14", () => {
  test("ties go away from zero, in either sign", () => {
    expect(ttMulFix14(1, 0x2000)).toBe(1); // 0.5
    expect(ttMulFix14(-1, 0x2000)).toBe(-1);
    expect(ttMulFix14(1, -0x2000)).toBe(-1);
    expect(ttMulFix14(-1, -0x2000)).toBe(1);
    expect(ttMulFix14(1, 0x1fff)).toBe(0); // just under
    expect(ttMulFix14(-1, 0x1fff)).toBe(0);
    expect(ttMulFix14(3, 0x2000)).toBe(2); // 1.5
    expect(ttMulFix14(5, 0x2000)).toBe(3); // 2.5
    expect(ttMulFix14(-5, 0x2000)).toBe(-3);
    // 0x10001 * 0x2000 = 0x20002000: 32768.5, so 0x8001
    expect(ttMulFix14(0x10001, 0x2000)).toBe(0x8001);
    expect(ttMulFix14(-0x10001, 0x2000)).toBe(-0x8001);
    expect(ttMulFix14(0x10001, 0x1fff)).toBe(32764); // 0x10001 * 0x1fff = 536813567 = 32764 * 0x4000 + 8191, just under a tie
  });

  test("a vector component of 0x4000 is 1.0", () => {
    for (const a of [0, 1, -1, 64, 1000, -4097, 0x7fffffff]) expect(ttMulFix14(a, 0x4000)).toBe(a);
    expect(ttMulFix14(0x4000, 0x4000)).toBe(0x4000);
    expect(ttMulFix14(1234, 0)).toBe(0);
  });

  test("the definition, 3000 products of any 32-bit number and a component of a unit vector", () => {
    const bad: string[] = [];
    const as = [...values(1, 3000, 2 ** 31)];
    const bs = [...values(2, 3000, 0x4000)];
    as.forEach((a, i) => {
      const b = bs[i]!;
      if (ttMulFix14(a, b) !== mulFix14Model(a, b)) bad.push(`${a} * ${b}`);
    });
    // and the corners
    for (const a of [0, 1, 2, 0x1fff, 0x2000, 0x2001, 0x3fff, 0x4000, 0x7fff, 0x8000, 0x10000, 0x7fffffff, -0x80000000, -1, -0x2000, -0x10001]) {
      for (const b of [0, 1, 2, 0x1fff, 0x2000, 0x2001, 0x3fff, 0x4000, -1, -0x1fff, -0x2000, -0x4000]) {
        if (ttMulFix14(a, b) !== mulFix14Model(a, b)) bad.push(`${a} * ${b}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("TT_DotFix14", () => {
  test("ties go away from zero, in either sign", () => {
    expect(ttDotFix14(1, 0, 0x2000, 0)).toBe(1); // 0.5
    expect(ttDotFix14(-1, 0, 0x2000, 0)).toBe(-1);
    expect(ttDotFix14(1, 0, 0x1fff, 0)).toBe(0);
    expect(ttDotFix14(-1, 0, 0x1fff, 0)).toBe(0);
    expect(ttDotFix14(0, 1, 0, 0x2000)).toBe(1);
    expect(ttDotFix14(0, -1, 0, 0x2000)).toBe(-1);
    // the two products add before the rounding: 0.25 + 0.25 is a tie, each alone is not
    expect(ttDotFix14(1, 1, 0x1000, 0x1000)).toBe(1);
    expect(ttDotFix14(-1, -1, 0x1000, 0x1000)).toBe(-1);
    expect(ttDotFix14(1, 0, 0x1000, 0)).toBe(0);
    expect(ttDotFix14(3, 5, 0x2000, 0x2000)).toBe(4); // 4.0
    expect(ttDotFix14(3, -5, 0x2000, 0x2000)).toBe(-1); // -1.0
  });

  test("a unit vector dotted with a vector: x * 0x4000 / 0x4000", () => {
    expect(ttDotFix14(1000, 2000, 0x4000, 0)).toBe(1000);
    expect(ttDotFix14(1000, 2000, 0, 0x4000)).toBe(2000);
    expect(ttDotFix14(-70000, 90000, 0x4000, 0)).toBe(-70000);
    expect(ttDotFix14(0x7fffffff, 0, 0x4000, 0)).toBe(0x7fffffff);
  });

  test("the definition, 3000 products of vectors of any size and unit vectors", () => {
    const bad: string[] = [];
    const ax = [...values(3, 3000, 2 ** 31)];
    const ay = [...values(4, 3000, 2 ** 31)];
    const bx = [...values(5, 3000, 0x4000)];
    const by = [...values(6, 3000, 0x4000)];
    ax.forEach((x, i) => {
      if (ttDotFix14(x, ay[i]!, bx[i]!, by[i]!) !== dotFix14Model(x, ay[i]!, bx[i]!, by[i]!)) bad.push(`(${x}, ${ay[i]}) . (${bx[i]}, ${by[i]})`);
    });
    for (const a of [0, 1, 0x1fff, 0x2000, 0x7fffffff, -0x80000000, -1, -0x2000]) {
      for (const b of [0, 1, 0x1fff, 0x2000, 0x3fff, 0x4000, -1, -0x2000, -0x4000]) {
        for (const [c, d] of [[0, 0], [a, b], [-a | 0, b], [1, 0x2000], [-1, 0x2000]] as [number, number][]) {
          if (ttDotFix14(a, c, b, d) !== dotFix14Model(a, c, b, d)) bad.push(`(${a}, ${c}) . (${b}, ${d})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
