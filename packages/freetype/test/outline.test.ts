import { describe, expect, test } from "bun:test";
import { FT_CURVE_TAG, FtErr } from "../src/types.ts";
import { Outline, outlineCheck, outlineDecompose, outlineGetCBox, outlineTranslate, type OutlineFuncs } from "../src/outline.ts";

/**
 * FT_Outline_Decompose, _Check, _Get_CBox and _Translate (ftoutln.c) on small outlines: the sequence of move / line / conic / cubic calls is what the C text
 * produces for these tags, worked out by hand.  Real glyph outlines go through all of it in oracle.test.ts.
 */
const ON = FT_CURVE_TAG.ON;
const CONIC = FT_CURVE_TAG.CONIC;
const CUBIC = FT_CURVE_TAG.CUBIC;

function outline(points: number[][], tags: number[], contours: number[]): Outline {
  const o = new Outline();
  o.nPoints = points.length;
  o.nContours = contours.length;
  o.points = Int32Array.from(points.flat());
  o.tags = Uint8Array.from(tags);
  o.contours = Uint16Array.from(contours);
  return o;
}

/** the calls decompose makes, as text */
function calls(o: Outline): { log: string[]; error: number } {
  const log: string[] = [];
  const funcs: OutlineFuncs = {
    moveTo: (x, y) => (log.push(`M ${x},${y}`), 0),
    lineTo: (x, y) => (log.push(`L ${x},${y}`), 0),
    conicTo: (cx, cy, x, y) => (log.push(`Q ${cx},${cy} ${x},${y}`), 0),
    cubicTo: (ax, ay, bx, by, x, y) => (log.push(`C ${ax},${ay} ${bx},${by} ${x},${y}`), 0),
  };
  const error = outlineDecompose(o, funcs);
  return { log, error };
}

describe("FT_Outline_Decompose", () => {
  test("on-curve points make lines, and the contour closes with a line back to its start", () => {
    const r = calls(outline([[0, 0], [64, 0], [64, 64], [0, 64]], [ON, ON, ON, ON], [3]));
    expect(r.error).toBe(0);
    expect(r.log).toEqual(["M 0,0", "L 64,0", "L 64,64", "L 0,64", "L 0,0"]);
  });

  test("a conic control point between two on-curve points makes one conic", () => {
    const r = calls(outline([[0, 0], [64, 0], [64, 64]], [ON, CONIC, ON], [2]));
    expect(r.log).toEqual(["M 0,0", "Q 64,0 64,64", "L 0,0"]);
  });

  test("two conic control points in a row have the on-curve point halfway between them (the division truncates)", () => {
    const r = calls(outline([[0, 0], [64, 0], [65, 64], [0, 64]], [ON, CONIC, CONIC, ON], [3]));
    // the on-curve point between (64,0) and (65,64) is (64,32): (129 / 2 = 64, 64 / 2 = 32)
    expect(r.log).toEqual(["M 0,0", "Q 64,0 64,32", "Q 65,64 0,64", "L 0,0"]);
  });

  test("a contour that starts with a conic point and ends on the curve starts at its last point", () => {
    const r = calls(outline([[0, 0], [64, 0], [64, 64], [0, 64]], [CONIC, ON, ON, ON], [3]));
    // v_start = the last point (0,64); the first point is a control point; the loop stops before the last point
    expect(r.log).toEqual(["M 0,64", "Q 0,0 64,0", "L 64,64", "L 0,64"]);
  });

  test("a contour of conic points only starts halfway between its first and last point", () => {
    const r = calls(outline([[0, 0], [128, 0], [128, 128]], [CONIC, CONIC, CONIC], [2]));
    // start = ((0 + 128) / 2, (0 + 128) / 2) = (64, 64); halfway points (64,0) and (128,64)
    expect(r.log).toEqual(["M 64,64", "Q 0,0 64,0", "Q 128,0 128,64", "Q 128,128 64,64"]);
  });

  test("a cubic is two cubic control points and an end point; the closing cubic ends at the start", () => {
    const a = calls(outline([[0, 0], [0, 64], [64, 64], [64, 0]], [ON, CUBIC, CUBIC, ON], [3]));
    expect(a.log).toEqual(["M 0,0", "C 0,64 64,64 64,0", "L 0,0"]);
    const b = calls(outline([[0, 0], [0, 64], [64, 64]], [ON, CUBIC, CUBIC], [2]));
    expect(b.log).toEqual(["M 0,0", "C 0,64 64,64 0,0"]);
  });

  test("several contours: each starts at its own first point", () => {
    const r = calls(outline([[0, 0], [64, 0], [64, 64], [10, 10], [20, 10], [20, 20]], [ON, ON, ON, ON, ON, ON], [2, 5]));
    expect(r.log).toEqual(["M 0,0", "L 64,0", "L 64,64", "L 0,0", "M 10,10", "L 20,10", "L 20,20", "L 10,10"]);
  });

  test("invalid tag sequences are refused: a first point that is a cubic control, a conic followed by a cubic control, a cubic control without its partner", () => {
    expect(calls(outline([[0, 0], [1, 1], [2, 2]], [CUBIC, ON, ON], [2])).error).toBe(FtErr.Invalid_Outline);
    expect(calls(outline([[0, 0], [1, 1], [2, 2], [3, 3]], [ON, CONIC, CUBIC, ON], [3])).error).toBe(FtErr.Invalid_Outline);
    expect(calls(outline([[0, 0], [1, 1], [2, 2]], [ON, CUBIC, ON], [2])).error).toBe(FtErr.Invalid_Outline);
    expect(calls(outline([[0, 0], [1, 1]], [ON, CUBIC], [1])).error).toBe(FtErr.Invalid_Outline);
  });

  test("an error from a callback stops everything and is returned", () => {
    const o = outline([[0, 0], [64, 0], [64, 64]], [ON, ON, ON], [2]);
    let n = 0;
    const error = outlineDecompose(o, {
      moveTo: () => 0,
      lineTo: () => (++n === 2 ? 7 : 0),
      conicTo: () => 0,
      cubicTo: () => 0,
    });
    expect(error).toBe(7);
    expect(n).toBe(2);
  });
});

describe("FT_Outline_Check", () => {
  test("empty is fine; a well formed outline is fine", () => {
    expect(outlineCheck(outline([], [], []))).toBe(0);
    expect(outlineCheck(outline([[0, 0], [1, 1], [2, 2]], [ON, ON, ON], [2]))).toBe(0);
    expect(outlineCheck(outline([[0, 0], [1, 1], [2, 2], [3, 3]], [ON, ON, ON, ON], [1, 3]))).toBe(0);
  });
  test("points without contours, contours without points", () => {
    expect(outlineCheck(outline([[0, 0]], [ON], []))).toBe(FtErr.Invalid_Argument);
    const o = outline([], [], [0]);
    o.nContours = 1;
    expect(outlineCheck(o)).toBe(FtErr.Invalid_Argument);
  });
  test("contour ends must grow, stay inside the points and the last one must be the last point", () => {
    const four = [[0, 0], [1, 1], [2, 2], [3, 3]];
    expect(outlineCheck(outline(four, [ON, ON, ON, ON], [1, 1, 3]))).toBe(FtErr.Invalid_Argument); // an empty contour
    expect(outlineCheck(outline(four, [ON, ON, ON, ON], [2, 1, 3]))).toBe(FtErr.Invalid_Argument); // going backwards
    expect(outlineCheck(outline(four, [ON, ON, ON, ON], [4]))).toBe(FtErr.Invalid_Argument); // past the points
    expect(outlineCheck(outline(four, [ON, ON, ON, ON], [2]))).toBe(FtErr.Invalid_Argument); // stops short
  });
});

describe("FT_Outline_Get_CBox and FT_Outline_Translate", () => {
  test("the box of all points, control points included; an empty outline has a zero box", () => {
    const o = outline([[5, -7], [-3, 20], [40, 2]], [ON, CONIC, ON], [2]);
    expect(outlineGetCBox(o)).toEqual({ xMin: -3, yMin: -7, xMax: 40, yMax: 20 });
    expect(outlineGetCBox(outline([], [], []))).toEqual({ xMin: 0, yMin: 0, xMax: 0, yMax: 0 });
  });
  test("translate adds the x offset to x and the y offset to y of every point, wrapping at 32 bits", () => {
    const o = outline([[5, -7], [-3, 20]], [ON, ON], [1]);
    outlineTranslate(o, 10, 100);
    expect(Array.from(o.points)).toEqual([15, 93, 7, 120]);
    const w = outline([[0x7fffffff, 0]], [ON], [0]);
    outlineTranslate(w, 1, 0);
    expect(Array.from(w.points)).toEqual([-0x80000000, 0]);
  });
});
