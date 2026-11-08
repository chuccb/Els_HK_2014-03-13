import { describe, expect, test } from "bun:test";
import { intersectRect } from "../src/rect.ts";
import type { Rect } from "../src/rect.ts";

/**
 * The user32 helper the text boxes use to cut a rectangle to another: `IntersectRect` (`SetRect` and `OffsetRect` are checked where the
 * controls use them).  It is the common part of two rectangles; two that have none (or one without an area) give the rectangle
 * (0, 0, 0, 0) and false.
 */
const rc = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });
const sides = (r: Rect): number[] => [r.left, r.top, r.right, r.bottom];

describe("intersectRect", () => {
  test("the common part: the larger of the left and top sides, the smaller of the right and bottom ones", () => {
    const dst = rc(99, 99, 99, 99);
    expect(intersectRect(dst, rc(0, 0, 10, 10), rc(5, 3, 20, 8))).toBe(true);
    expect(sides(dst)).toEqual([5, 3, 10, 8]);
    // each side of the result comes from the rectangle that limits it, whichever it is
    expect(intersectRect(dst, rc(5, 3, 20, 8), rc(0, 0, 10, 10))).toBe(true);
    expect(sides(dst)).toEqual([5, 3, 10, 8]);
    expect(intersectRect(dst, rc(0, 3, 20, 10), rc(5, 0, 10, 8))).toBe(true);
    expect(sides(dst)).toEqual([5, 3, 10, 8]);
    expect(intersectRect(dst, rc(5, 0, 10, 8), rc(0, 3, 20, 10))).toBe(true);
    expect(sides(dst)).toEqual([5, 3, 10, 8]);
  });

  test("one inside the other is the inner one; two equal ones are that rectangle; below 0 too", () => {
    const dst = rc(0, 0, 0, 0);
    intersectRect(dst, rc(0, 0, 100, 100), rc(10, 20, 30, 40));
    expect(sides(dst)).toEqual([10, 20, 30, 40]);
    intersectRect(dst, rc(10, 20, 30, 40), rc(10, 20, 30, 40));
    expect(sides(dst)).toEqual([10, 20, 30, 40]);
    expect(intersectRect(dst, rc(-30, -20, -5, -2), rc(-10, -40, 0, -10))).toBe(true);
    expect(sides(dst)).toEqual([-10, -20, -5, -10]);
  });

  test("the destination may be one of the sources (the exe's selection rectangle is both)", () => {
    const a = rc(0, 0, 10, 10);
    const b = rc(5, 3, 20, 8);
    expect(intersectRect(b, a, b)).toBe(true);
    expect(sides(b)).toEqual([5, 3, 10, 8]);
    const c = rc(0, 0, 10, 10);
    const d = rc(5, 3, 20, 8);
    expect(intersectRect(c, c, d)).toBe(true);
    expect(sides(c)).toEqual([5, 3, 10, 8]);
  });

  test("rectangles that only touch (a right side at the other's left, a bottom at the other's top) have no common part: (0, 0, 0, 0), false, the destination's old values gone", () => {
    const dst = rc(7, 7, 7, 7);
    expect(intersectRect(dst, rc(0, 0, 10, 10), rc(10, 0, 20, 10))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
    dst.left = 7;
    expect(intersectRect(dst, rc(10, 0, 20, 10), rc(0, 0, 10, 10))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
    dst.top = 7;
    expect(intersectRect(dst, rc(0, 0, 10, 10), rc(0, 10, 10, 20))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
    dst.top = 7;
    expect(intersectRect(dst, rc(0, 10, 10, 20), rc(0, 0, 10, 10))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
  });

  test("rectangles that are apart in one direction only have none, even when they overlap in the other one", () => {
    const dst = rc(7, 7, 7, 7);
    expect(intersectRect(dst, rc(0, 0, 10, 10), rc(20, 5, 30, 8))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
    dst.right = 7;
    expect(intersectRect(dst, rc(0, 0, 10, 10), rc(5, 20, 8, 30))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
    dst.bottom = 7;
    expect(intersectRect(dst, rc(20, 5, 30, 8), rc(0, 0, 10, 10))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
    dst.bottom = 7;
    expect(intersectRect(dst, rc(5, 20, 8, 30), rc(0, 0, 10, 10))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
  });

  test("a rectangle without an area has no common part with anything, also one inside the other", () => {
    const dst = rc(7, 7, 7, 7);
    expect(intersectRect(dst, rc(5, 5, 5, 5), rc(0, 0, 10, 10))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
    dst.left = 7;
    expect(intersectRect(dst, rc(0, 0, 10, 10), rc(5, 2, 5, 8))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
    dst.left = 7;
    expect(intersectRect(dst, rc(0, 0, 10, 10), rc(2, 5, 8, 5))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
    dst.left = 7;
    // a rectangle turned inside out (right left of left) is empty as well
    expect(intersectRect(dst, rc(0, 0, 10, 10), rc(8, 2, 3, 8))).toBe(false);
    expect(sides(dst)).toEqual([0, 0, 0, 0]);
  });
});
