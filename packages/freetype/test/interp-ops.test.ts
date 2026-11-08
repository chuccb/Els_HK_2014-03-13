import { describe, expect, test } from "bun:test";
import { FtErr } from "../src/index.ts";
import type { FtSize } from "../src/index.ts";
import { TtExec } from "../src/interp.ts";

/**
 * TrueType instructions run one at a time on an interpreter with no font behind it: a stack, a few bytes of code, nothing else.  Every expected value is
 * worked out from the C text of FreeType 2.4.11 (src/truetype/ttinterp.c: the DO_* macros, the Round_* functions, SetSuperRound, Compute_Funcs), not from the
 * port; the stack is listed bottom first.  What the exe's own interpreter makes of the instructions the shipped fonts run is in oracle.test.ts (a full
 * hinted load of 768 glyphs and 38 more found by tools/mutate-freetype.py --pick); here are also the ones no shipped glyph reaches.
 */
interface Run {
  x: TtExec;
  err: number;
  stack: number[];
}

function run(code: number[], stack: number[] = [], setup: (x: TtExec) => void = () => {}): Run {
  const x = new TtExec();
  x.stack = new Int32Array(64);
  x.stackSize = 64;
  stack.forEach((v, i) => (x.stack[i] = v));
  x.top = stack.length;
  x.code = Uint8Array.from(code);
  x.codeSize = code.length;
  x.IP = 0;
  x.size = { cvtReady: true } as unknown as FtSize; // errorExit() marks the size's bytecode as not ready
  x.ttMetrics.xRatio = 0x10000;
  x.ttMetrics.yRatio = 0x10000;
  setup(x);
  const err = x.runIns();
  return { x, err, stack: Array.from(x.stack.subarray(0, x.top)) };
}

const OK = FtErr.Ok;

describe("arithmetic and logic: the operands are popped, the result pushed", () => {
  // [name, opcode, stack before, stack after]
  const rows: [string, number, number[], number[]][] = [
    ["ADD", 0x60, [3, 4], [7]],
    ["ADD", 0x60, [-5, 2], [-3]],
    ["ADD wraps at 32 bits", 0x60, [0x7fffffff, 1], [-0x80000000]],
    ["SUB", 0x61, [10, 3], [7]],
    ["SUB", 0x61, [3, 10], [-7]],
    ["DIV: n1 / n2 in 26.6, not rounded", 0x62, [128, 64], [128]],
    ["DIV", 0x62, [64, 128], [32]],
    ["DIV", 0x62, [1, 3], [21]], // 64 / 3 = 21.3
    ["DIV", 0x62, [-1, 3], [-21]],
    ["DIV", 0x62, [100, -3], [-2133]], // 6400 / 3 = 2133.3
    ["MUL: n1 * n2 in 26.6, rounded", 0x63, [128, 64], [128]],
    ["MUL", 0x63, [128, 32], [64]],
    ["MUL", 0x63, [3, 3], [0]], // (9 + 32) / 64
    ["MUL", 0x63, [100, 100], [156]], // (10000 + 32) / 64 = 156.75
    ["MUL", 0x63, [-100, 100], [-156]],
    ["MUL", 0x63, [6, 5], [0]], // 30 / 64 = 0.47
    ["MUL", 0x63, [7, 5], [1]], // 35 / 64 = 0.55
    ["ABS", 0x64, [-7], [7]],
    ["ABS", 0x64, [7], [7]],
    ["ABS", 0x64, [0], [0]],
    ["NEG", 0x65, [5], [-5]],
    ["NEG", 0x65, [-5], [5]],
    ["NEG", 0x65, [0], [0]],
    ["FLOOR", 0x66, [100], [64]],
    ["FLOOR", 0x66, [-100], [-128]],
    ["FLOOR", 0x66, [64], [64]],
    ["FLOOR", 0x66, [63], [0]],
    ["FLOOR", 0x66, [-1], [-64]],
    ["CEILING", 0x67, [65], [128]],
    ["CEILING", 0x67, [64], [64]],
    ["CEILING", 0x67, [-65], [-64]],
    ["CEILING", 0x67, [1], [64]],
    ["CEILING", 0x67, [0], [0]],
    // ODD and EVEN round to the grid (the default state) and look at the pixel's parity: 64 + 128 n
    ["ODD", 0x56, [64], [1]],
    ["ODD", 0x56, [128], [0]],
    ["ODD", 0x56, [95], [1]], // rounds to 64
    ["ODD", 0x56, [96], [0]], // rounds to 128
    ["ODD", 0x56, [0], [0]],
    ["EVEN", 0x57, [128], [1]],
    ["EVEN", 0x57, [64], [0]],
    ["EVEN", 0x57, [0], [1]],
    ["EVEN", 0x57, [31], [1]], // rounds to 0
    ["LT", 0x50, [1, 2], [1]],
    ["LT", 0x50, [2, 1], [0]],
    ["LT", 0x50, [2, 2], [0]],
    ["LT", 0x50, [-1, 0], [1]],
    ["LTEQ", 0x51, [2, 2], [1]],
    ["LTEQ", 0x51, [3, 2], [0]],
    ["LTEQ", 0x51, [1, 2], [1]],
    ["GT", 0x52, [3, 2], [1]],
    ["GT", 0x52, [2, 2], [0]],
    ["GT", 0x52, [1, 2], [0]],
    ["GTEQ", 0x53, [2, 2], [1]],
    ["GTEQ", 0x53, [1, 2], [0]],
    ["GTEQ", 0x53, [3, 2], [1]],
    ["EQ", 0x54, [4, 4], [1]],
    ["EQ", 0x54, [4, 5], [0]],
    ["NEQ", 0x55, [4, 4], [0]],
    ["NEQ", 0x55, [4, 5], [1]],
    ["AND", 0x5a, [1, 1], [1]],
    ["AND", 0x5a, [1, 0], [0]],
    ["AND", 0x5a, [0, 1], [0]],
    ["AND", 0x5a, [5, 7], [1]],
    ["AND", 0x5a, [0, 0], [0]],
    ["OR", 0x5b, [0, 0], [0]],
    ["OR", 0x5b, [0, 3], [1]],
    ["OR", 0x5b, [4, 0], [1]],
    ["OR", 0x5b, [5, 7], [1]],
    ["NOT", 0x5c, [0], [1]],
    ["NOT", 0x5c, [5], [0]],
    ["NOT", 0x5c, [-1], [0]],
    ["MAX", 0x8b, [3, 9], [9]],
    ["MAX", 0x8b, [9, 3], [9]],
    ["MAX", 0x8b, [-3, -9], [-3]],
    ["MAX", 0x8b, [-9, -3], [-3]],
    ["MIN", 0x8c, [3, 9], [3]],
    ["MIN", 0x8c, [9, 3], [3]],
    ["MIN", 0x8c, [-3, -9], [-9]],
  ];
  for (const [name, opcode, before, after] of rows) {
    test(`${name}: ${before.join(" ")} -> ${after.join(" ")}`, () => {
      const r = run([opcode], before);
      expect(r.err).toBe(OK);
      expect(r.stack).toEqual(after);
    });
  }

  test("a division by zero is an error; too few arguments are zeros, unless the hinting is pedantic", () => {
    expect(run([0x62], [5, 0]).err).toBe(FtErr.Divide_By_Zero);
    const lenient = run([0x60]); // ADD on an empty stack
    expect([lenient.err, lenient.stack]).toEqual([OK, [0]]);
    expect(run([0x60], [], (x) => (x.pedanticHinting = true)).err).toBe(FtErr.Too_Few_Arguments);
    // a stack that holds one number where two are needed: the numbers there are overwritten with zeros (for i < pops: stack[i] = 0), the 9 is lost
    const one = run([0x60], [9]);
    expect([one.err, one.stack]).toEqual([OK, [0]]);
  });
});

describe("the stack", () => {
  test("DUP, POP, CLEAR, SWAP, DEPTH", () => {
    expect(run([0x20], [5]).stack).toEqual([5, 5]);
    expect(run([0x21], [1, 2]).stack).toEqual([1]);
    expect(run([0x22], [1, 2, 3]).stack).toEqual([]);
    expect(run([0x23], [1, 2]).stack).toEqual([2, 1]);
    expect(run([0x24], [7, 8]).stack).toEqual([7, 8, 2]);
    expect(run([0x24]).stack).toEqual([0]);
  });

  test("CINDEX copies the k-th element from the top, MINDEX moves it; k out of range gives 0 / does nothing", () => {
    expect(run([0x25], [10, 20, 30, 1]).stack).toEqual([10, 20, 30, 30]);
    expect(run([0x25], [10, 20, 30, 2]).stack).toEqual([10, 20, 30, 20]);
    expect(run([0x25], [10, 20, 30, 3]).stack).toEqual([10, 20, 30, 10]);
    expect(run([0x25], [10, 20, 30, 4]).stack).toEqual([10, 20, 30, 0]);
    expect(run([0x25], [10, 20, 30, 0]).stack).toEqual([10, 20, 30, 0]);
    expect(run([0x25], [10, 20, 30, 4], (x) => (x.pedanticHinting = true)).err).toBe(FtErr.Invalid_Reference);
    expect(run([0x26], [10, 20, 30, 1]).stack).toEqual([10, 20, 30]);
    expect(run([0x26], [10, 20, 30, 2]).stack).toEqual([10, 30, 20]);
    expect(run([0x26], [10, 20, 30, 3]).stack).toEqual([20, 30, 10]);
    expect(run([0x26], [10, 20, 30, 4]).stack).toEqual([10, 20, 30]);
    expect(run([0x26], [10, 20, 30, 4], (x) => (x.pedanticHinting = true)).err).toBe(FtErr.Invalid_Reference);
  });

  test("ROLL brings the third element to the top", () => {
    expect(run([0x8a], [1, 2, 3]).stack).toEqual([2, 3, 1]);
    expect(run([0x8a], [1, 2, 3, 4, 5]).stack).toEqual([1, 2, 4, 5, 3]);
  });

  test("PUSHB, PUSHW (signed), NPUSHB, NPUSHW", () => {
    expect(run([0xb0, 9]).stack).toEqual([9]);
    expect(run([0xb2, 9, 8, 255]).stack).toEqual([9, 8, 255]);
    expect(run([0xb7, 1, 2, 3, 4, 5, 6, 7, 8]).stack).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(run([0xb8, 0xff, 0xfe]).stack).toEqual([-2]);
    expect(run([0xb9, 0x80, 0x00, 0x00, 0x01]).stack).toEqual([-32768, 1]);
    expect(run([0x40, 3, 1, 2, 255]).stack).toEqual([1, 2, 255]);
    expect(run([0x40, 0]).stack).toEqual([]);
    expect(run([0x41, 2, 0xff, 0xfe, 0x00, 0x05]).stack).toEqual([-2, 5]);
    expect(run([0xb0, 4, 0x20]).stack).toEqual([4, 4]); // execution goes on after the push
  });

  test("code that ends in the middle of an instruction is an error", () => {
    expect(run([0xb0]).err).toBe(FtErr.Code_Overflow); // PUSHB[0] without its byte
    expect(run([0xb1, 5]).err).toBe(FtErr.Code_Overflow); // PUSHB[1] with one of its two
    expect(run([0xb8, 1]).err).toBe(FtErr.Code_Overflow); // PUSHW[0] with half of its word
    expect(run([0x40]).err).toBe(FtErr.Code_Overflow); // NPUSHB without its count
    expect(run([0x40, 3, 1, 2]).err).toBe(FtErr.Code_Overflow); // a count of 3, two bytes
    expect(run([0x41, 1, 7]).err).toBe(FtErr.Code_Overflow);
    expect(run([0xb0, 5]).err).toBe(OK);
  });

  test("DEBUG and an opcode nothing defines are errors; a program that never ends is stopped after a million instructions", () => {
    expect(run([0x4f]).err).toBe(FtErr.Debug_OpCode);
    expect(run([0x91]).err).toBe(FtErr.Invalid_Opcode);
    // PUSHW[0] -3 ; JMPR: back to the start, for ever
    expect(run([0xb8, 0xff, 0xfd, 0x1c]).err).toBe(FtErr.Execution_Too_Long);
  });
});

describe("storage and the control value table", () => {
  const withStorage = (x: TtExec): void => {
    x.storage = Int32Array.from([10, 20, 30, 40]);
    x.storeSize = 4;
  };
  const withCvt = (x: TtExec): void => {
    x.cvt = Int32Array.from([100, 200, 300]);
    x.cvtSize = 3;
  };

  test("RS reads, WS writes; an index outside is 0 / ignored, an error when pedantic", () => {
    expect(run([0x43], [2], withStorage).stack).toEqual([30]);
    expect(run([0x43], [0], withStorage).stack).toEqual([10]);
    expect(run([0x43], [4], withStorage).stack).toEqual([0]);
    expect(run([0x43], [-1], withStorage).stack).toEqual([0]); // unsigned: far outside
    expect(run([0x43], [4], (x) => (withStorage(x), (x.pedanticHinting = true))).err).toBe(FtErr.Invalid_Reference);
    const w = run([0x42], [2, 99], withStorage);
    expect([w.err, w.stack, Array.from(w.x.storage)]).toEqual([OK, [], [10, 20, 99, 40]]);
    const out = run([0x42], [4, 99], withStorage);
    expect([out.err, Array.from(out.x.storage)]).toEqual([OK, [10, 20, 30, 40]]);
    expect(run([0x42], [4, 99], (x) => (withStorage(x), (x.pedanticHinting = true))).err).toBe(FtErr.Invalid_Reference);
  });

  test("RCVT, WCVTP (in font units of the scaled table: as they are), WCVTF (scaled by the size)", () => {
    expect(run([0x45], [1], withCvt).stack).toEqual([200]);
    expect(run([0x45], [3], withCvt).stack).toEqual([0]);
    expect(run([0x45], [3], (x) => (withCvt(x), (x.pedanticHinting = true))).err).toBe(FtErr.Invalid_Reference);
    const w = run([0x44], [2, 77], withCvt);
    expect(Array.from(w.x.cvt)).toEqual([100, 200, 77]);
    const out = run([0x44], [3, 77], withCvt);
    expect(Array.from(out.x.cvt)).toEqual([100, 200, 300]);
    // WCVTF: FT_MulFix(value, scale); half a pixel of scale (0x8000): 100 -> 50, 101 -> 50.5 -> 51
    const half = (x: TtExec): void => {
      withCvt(x);
      x.ttMetrics.scale = 0x8000;
    };
    expect(Array.from(run([0x70], [0, 100], half).x.cvt)).toEqual([50, 200, 300]);
    expect(Array.from(run([0x70], [0, 101], half).x.cvt)).toEqual([51, 200, 300]);
    expect(Array.from(run([0x70], [3, 100], half).x.cvt)).toEqual([100, 200, 300]);
    expect(run([0x70], [3, 100], (x) => (half(x), (x.pedanticHinting = true))).err).toBe(FtErr.Invalid_Reference);
  });
});

describe("pixels per em, GETINFO", () => {
  test("MPPEM and MPS give the ppem scaled by the ratio of the projection vector's direction", () => {
    const setup = (x: TtExec): void => {
      x.ttMetrics.ppem = 16;
      x.ttMetrics.yRatio = 0x14000; // 1.25
    };
    expect(run([0x4b], [], setup).stack).toEqual([16]); // the projection vector is along x: the x ratio, 1.0
    expect(run([0x4c], [], setup).stack).toEqual([16]);
    expect(run([0x00, 0x4b], [], setup).stack).toEqual([20]); // SVTCA[0]: along y, 16 * 1.25
    expect(run([0x00, 0x4c], [], setup).stack).toEqual([20]);
    expect(run([0x00, 0x01, 0x4b], [], setup).stack).toEqual([16]); // and back along x
  });

  test("GETINFO: the version in bit 0..7, rotated in 0x80, stretched in 0x100, grayscale in 0x1000", () => {
    expect(run([0x88], [0]).stack).toEqual([0]);
    expect(run([0x88], [1]).stack).toEqual([35]);
    expect(run([0x88], [2]).stack).toEqual([0]);
    expect(run([0x88], [4]).stack).toEqual([0]);
    expect(run([0x88], [32]).stack).toEqual([0]);
    expect(run([0x88], [2], (x) => (x.ttMetrics.rotated = true)).stack).toEqual([0x80]);
    expect(run([0x88], [4], (x) => (x.ttMetrics.stretched = true)).stack).toEqual([0x100]);
    expect(run([0x88], [32], (x) => (x.grayscale = true)).stack).toEqual([0x1000]);
    expect(run([0x88], [1 | 2 | 4 | 32], (x) => ((x.ttMetrics.rotated = true), (x.ttMetrics.stretched = true), (x.grayscale = true))).stack).toEqual([0x11a3]);
    expect(run([0x88], [2 | 4], (x) => (x.grayscale = true)).stack).toEqual([0]); // a state is only reported when its bit is asked for
    expect(run([0x88], [8 | 64]).stack).toEqual([0]); // variations (no blend) and subpixel hinting (not built)
  });
});

describe("the graphics state", () => {
  const vec = (r: Run) => ({
    p: [r.x.GS.projVector.x, r.x.GS.projVector.y],
    f: [r.x.GS.freeVector.x, r.x.GS.freeVector.y],
    d: [r.x.GS.dualVector.x, r.x.GS.dualVector.y],
  });
  const X = [0x4000, 0];
  const Y = [0, 0x4000];

  test("SVTCA sets both vectors (and the dual one) to an axis, SPVTCA the projection vector, SFVTCA the freedom vector", () => {
    expect(vec(run([0x00]))).toEqual({ p: Y, f: Y, d: Y });
    expect(vec(run([0x01]))).toEqual({ p: X, f: X, d: X });
    expect(vec(run([0x00, 0x03]))).toEqual({ p: X, f: Y, d: X }); // SPVTCA[1] after SVTCA[0]
    expect(vec(run([0x01, 0x02]))).toEqual({ p: Y, f: X, d: Y });
    expect(vec(run([0x00, 0x05]))).toEqual({ p: Y, f: X, d: Y }); // SFVTCA[1]
    expect(vec(run([0x01, 0x04]))).toEqual({ p: X, f: Y, d: X });
    expect(vec(run([0x00, 0x05, 0x0e]))).toEqual({ p: Y, f: Y, d: Y }); // SFVTPV: the freedom vector becomes the projection vector
  });

  test("F . P is the freedom vector dotted with the projection vector, 0x4000 when they are nearly perpendicular", () => {
    const fdotp = (p: number[], f: number[]): number => run([0x1a], [0], (x) => ((x.GS.projVector = { x: p[0]!, y: p[1]! }), (x.GS.freeVector = { x: f[0]!, y: f[1]! }))).x.FdotP;
    expect(fdotp([0x4000, 0], [0x4000, 0])).toBe(0x4000);
    expect(fdotp([0, 0x4000], [0, 0x4000])).toBe(0x4000);
    expect(fdotp([0x2d41, 0x2d41], [0x4000, 0])).toBe(0x2d41); // a free vector along x: the projection vector's x
    expect(fdotp([0x2d41, 0x2d41], [0, 0x4000])).toBe(0x2d41); // along y: its y
    expect(fdotp([0x4000, 0], [0x2d41, 0x2d41])).toBe(0x2d41); // (0x4000 * 0x2d41) >> 14
    expect(fdotp([0x2d41, 0x2d41], [0x2d41, 0x2d41])).toBe(0x3fff); // 2 * 11585^2 = 268424450, >> 14 = 16383.4
    // below 0x400 in size the value is replaced by 0x4000 (the sign is lost): the boundary is 0x3ff / 0x400, on both sides of zero
    expect(fdotp([0x4000, 0], [0x3ff, 0x3fff])).toBe(0x4000);
    expect(fdotp([0x4000, 0], [0x400, 0x3fff])).toBe(0x400);
    expect(fdotp([0x4000, 0], [-0x3ff, 0x3fff])).toBe(0x4000);
    expect(fdotp([0x4000, 0], [-0x400, 0x3fff])).toBe(-0x400);
    expect(fdotp([0x4000, 0], [0, 0x3fff])).toBe(0x4000); // perpendicular
  });

  test("SRP0 / SRP1 / SRP2, SLOOP, SMD, SCVTCI, SSWCI, SSW, SDB, SDS, FLIPON / FLIPOFF", () => {
    expect(run([0x10], [5]).x.GS.rp0).toBe(5);
    expect(run([0x11], [6]).x.GS.rp1).toBe(6);
    expect(run([0x12], [0x10007]).x.GS.rp2).toBe(7); // 16 bits
    expect(run([0x17], [3]).x.GS.loop).toBe(3);
    expect(run([0x17], [0]).x.GS.loop).toBe(0);
    expect(run([0x17], [-1]).err).toBe(FtErr.Bad_Argument);
    expect(run([0x1a], [32]).x.GS.minimumDistance).toBe(32);
    expect(run([0x1d], [50]).x.GS.controlValueCutin).toBe(50);
    expect(run([0x1e], [7]).x.GS.singleWidthCutin).toBe(7);
    expect(run([0x1f], [100], (x) => (x.ttMetrics.scale = 0x8000)).x.GS.singleWidthValue).toBe(50);
    expect(run([0x5e], [0x10005]).x.GS.deltaBase).toBe(5); // a short
    expect(run([0x5e], [0xfffe]).x.GS.deltaBase).toBe(-2);
    expect(run([0x5f], [0x10002]).x.GS.deltaShift).toBe(2);
    expect(run([0x4e]).x.GS.autoFlip).toBe(false);
    expect(run([0x4e, 0x4d]).x.GS.autoFlip).toBe(true);
    expect(run([0x4d]).x.GS.autoFlip).toBe(true);
  });

  test("INSTCTRL: selector 1 and 2 set or clear their bit, any other selector does nothing (an error when pedantic)", () => {
    const ic = (stack: number[], from = 0, pedantic = false) => run([0x8e], stack, (x) => ((x.GS.instructControl = from), (x.pedanticHinting = pedantic)));
    expect(ic([1, 1]).x.GS.instructControl).toBe(1);
    expect(ic([2, 2]).x.GS.instructControl).toBe(2);
    expect(ic([5, 1]).x.GS.instructControl).toBe(1); // any non-zero value sets the bit
    expect(ic([0, 1], 3).x.GS.instructControl).toBe(2);
    expect(ic([0, 2], 3).x.GS.instructControl).toBe(1);
    expect(ic([1, 2], 1).x.GS.instructControl).toBe(3);
    expect(ic([1, 3], 0).x.GS.instructControl).toBe(0);
    expect(ic([1, 0], 0).x.GS.instructControl).toBe(0);
    expect(ic([1, 3], 0, true).err).toBe(FtErr.Invalid_Reference);
  });

  test("SCANCTRL and SCANTYPE", () => {
    const sc = (v: number, from: boolean, ppem = 13) => run([0x85], [v], (x) => ((x.GS.scanControl = from), (x.ttMetrics.ppem = ppem))).x.GS.scanControl;
    expect(sc(0xff, false)).toBe(true);
    expect(sc(0x1ff, false)).toBe(true); // a threshold of 0xFF is "always"
    expect(sc(0, true)).toBe(false);
    expect(sc(0x100, true)).toBe(false); // a threshold of 0 is "never"
    expect(sc(0x105, false, 4)).toBe(true); // ppem <= 5
    expect(sc(0x105, false, 5)).toBe(true);
    expect(sc(0x105, false, 6)).toBe(false);
    expect(sc(0x805, true, 6)).toBe(false); // ppem > 5 switches it off
    expect(sc(0x805, true, 5)).toBe(true);
    expect(run([0x85], [0x205], (x) => (x.ttMetrics.rotated = true)).x.GS.scanControl).toBe(true);
    expect(run([0x85], [0x405], (x) => (x.ttMetrics.stretched = true)).x.GS.scanControl).toBe(true);
    expect(run([0x85], [0x205]).x.GS.scanControl).toBe(false);
    expect(run([0x8d], [2]).x.GS.scanType).toBe(2);
    expect(run([0x8d], [-1], (x) => (x.GS.scanType = 4)).x.GS.scanType).toBe(4); // negative: ignored
  });
});

describe("rounding", () => {
  // the state is selected by an instruction, the number rounded by ROUND[0] (compensation 0): [instruction, value] -> rounded
  const states: [string, number, [number, number][]][] = [
    [
      "RTG: round to grid",
      0x18,
      [[0, 0], [31, 0], [32, 64], [40, 64], [63, 64], [64, 64], [95, 64], [96, 128], [-31, 0], [-32, -64], [-40, -64], [-96, -128]],
    ],
    [
      "RTHG: round to half grid",
      0x19,
      [[0, 32], [40, 32], [63, 32], [64, 96], [100, 96], [127, 96], [128, 160], [-1, -32], [-40, -32], [-64, -96]],
    ],
    [
      "RTDG: round to double grid",
      0x3d,
      [[0, 0], [15, 0], [16, 32], [40, 32], [47, 32], [48, 64], [64, 64], [80, 96], [-15, 0], [-16, -32], [-40, -32], [-48, -64]],
    ],
    [
      "RDTG: round down to grid",
      0x7d,
      [[0, 0], [1, 0], [63, 0], [64, 64], [100, 64], [127, 64], [128, 128], [-1, 0], [-63, 0], [-64, -64], [-100, -64]],
    ],
    [
      "RUTG: round up to grid",
      0x7c,
      [[0, 0], [1, 64], [64, 64], [65, 128], [-1, -64], [-64, -64], [-65, -128]],
    ],
    ["ROFF: round off", 0x7a, [[0, 0], [37, 37], [-37, -37], [1, 1]]],
  ];
  for (const [name, op, cases] of states) {
    test(name, () => {
      for (const [d, want] of cases) {
        const r = run([op, 0x68], [d]);
        expect([d, r.err, r.stack]).toEqual([d, OK, [want]]);
      }
    });
  }

  test("the engine compensation is added before rounding (ROUND[1] .. ROUND[3] take their own)", () => {
    const comp = (x: TtExec): void => {
      x.ttMetrics.compensations = [0, 8, 16, 24];
    };
    // to grid: 40 + 8 = 48 + 32 -> 64; 20 + 16 + 32 = 68 -> 64; 10 + 24 + 32 = 66 -> 64; 10 + 8 + 32 = 50 -> 0
    expect(run([0x69], [40], comp).stack).toEqual([64]);
    expect(run([0x6a], [20], comp).stack).toEqual([64]);
    expect(run([0x6b], [10], comp).stack).toEqual([64]);
    expect(run([0x69], [10], comp).stack).toEqual([0]);
    // off: the compensation is added to a positive distance and taken off a negative one
    expect(run([0x7a, 0x69], [40], comp).stack).toEqual([48]);
    expect(run([0x7a, 0x69], [-40], comp).stack).toEqual([-48]);
    expect(run([0x7a, 0x6a], [5], comp).stack).toEqual([21]);
    expect(run([0x7a, 0x6a], [-5], comp).stack).toEqual([-21]);
    // NROUND never rounds: only the compensation (opcode 0x6c + n)
    expect(run([0x6d], [40], comp).stack).toEqual([48]);
    expect(run([0x6c], [-40], comp).stack).toEqual([-40]);
    expect(run([0x6f], [3], comp).stack).toEqual([27]);
    // a compensation never carries a number across zero: it stops at 0
    const neg = (x: TtExec): void => {
      x.ttMetrics.compensations = [0, 0, 0, -24];
    };
    expect(run([0x7a, 0x6b], [10], neg).stack).toEqual([0]); // 10 - 24 < 0
    expect(run([0x7a, 0x6b], [-10], neg).stack).toEqual([0]); // -10 + 24 > 0
    expect(run([0x7a, 0x6b], [30], neg).stack).toEqual([6]);
    expect(run([0x7a, 0x6b], [-30], neg).stack).toEqual([-6]);
  });

  test("SROUND sets period, phase and threshold from its selector (0x4000 is a grid period)", () => {
    const params = (grid: number, selector: number) => {
      const x = new TtExec();
      x.setSuperRound(grid, selector);
      return [x.period, x.phase, x.threshold];
    };
    expect(params(0x4000, 0x48)).toEqual([64, 0, 32]); // period 1 pixel, phase 0, threshold 4 / 8
    expect(params(0x4000, 0x68)).toEqual([64, 32, 32]); // phase half a period
    expect(params(0x4000, 0x58)).toEqual([64, 16, 32]); // a quarter
    expect(params(0x4000, 0x78)).toEqual([64, 48, 32]); // three quarters
    expect(params(0x4000, 0x08)).toEqual([32, 0, 16]); // period half a pixel; the threshold is (n - 4) / 8 of the period
    expect(params(0x4000, 0x80)).toEqual([128, 0, 127]); // period 2 pixels; a low nibble of 0 is a threshold of period - 1: 0x7fff / 256
    expect(params(0x4000, 0xc0)).toEqual([64, 0, 63]); // the reserved value is a period of 1 pixel
    expect(params(0x4000, 0x4f)).toEqual([64, 0, 88]); // (15 - 4) * 0x4000 / 8 / 256
    expect(params(0x4000, 0x41)).toEqual([64, 0, -24]); // (1 - 4) * 0x4000 / 8 = -6144 / 256
    expect(params(0x4000, 0x43)).toEqual([64, 0, -8]);
    expect(params(0x4000, 0x45)).toEqual([64, 0, 8]);
    // 45 degrees: the period is 0x2d41 / 256 = 45 (45.25), the threshold 4 * 0x2d41 / 8 = 5792 / 256 = 22
    expect(params(0x2d41, 0x48)).toEqual([45, 0, 22]);
  });

  test("SROUND (0x76) and S45ROUND (0x77) then ROUND", () => {
    // stack: the number, then the selector SROUND takes
    const sr = (op: number, selector: number, d: number) => run([op, 0x68], [d, selector]).stack;
    // period 64, phase 0, threshold 32: like round to grid
    expect(sr(0x76, 0x48, 40)).toEqual([64]);
    expect(sr(0x76, 0x48, 31)).toEqual([0]);
    expect(sr(0x76, 0x48, -40)).toEqual([-64]);
    expect(sr(0x76, 0x48, -31)).toEqual([0]);
    // period 64, phase 32, threshold 32: like round to half grid, except at 0 which stays at the phase
    expect(sr(0x76, 0x68, 40)).toEqual([32]);
    expect(sr(0x76, 0x68, 70)).toEqual([96]);
    expect(sr(0x76, 0x68, 0)).toEqual([32]);
    expect(sr(0x76, 0x68, -40)).toEqual([-32]); // -(((32 - 32 + 40) & -64)) - 32 = -32
    // period 32, threshold 16: to the nearest multiple of 32
    expect(sr(0x76, 0x08, 20)).toEqual([32]);
    expect(sr(0x76, 0x08, 15)).toEqual([0]);
    expect(sr(0x76, 0x08, 16)).toEqual([32]);
    // period 128, threshold 127: up to the next multiple of 128
    expect(sr(0x76, 0x80, 1)).toEqual([128]);
    expect(sr(0x76, 0x80, 128)).toEqual([128]);
    expect(sr(0x76, 0x80, 129)).toEqual([256]);
    // 45 degrees: period 45, threshold 22, divided rather than masked
    expect(sr(0x77, 0x48, 22)).toEqual([0]);
    expect(sr(0x77, 0x48, 23)).toEqual([45]);
    expect(sr(0x77, 0x48, 40)).toEqual([45]);
    expect(sr(0x77, 0x48, 68)).toEqual([90]);
    expect(sr(0x77, 0x48, -22)).toEqual([0]);
    expect(sr(0x77, 0x48, -23)).toEqual([-45]);
    expect(run([0x76], [0x48]).x.GS.roundState).toBe(6);
    expect(run([0x77], [0x48]).x.GS.roundState).toBe(7);
  });

  test("the round state instructions set the state, ODD / EVEN follow it", () => {
    expect(run([0x19]).x.GS.roundState).toBe(0);
    expect(run([0x18]).x.GS.roundState).toBe(1);
    expect(run([0x3d]).x.GS.roundState).toBe(2);
    expect(run([0x7d]).x.GS.roundState).toBe(3);
    expect(run([0x7c]).x.GS.roundState).toBe(4);
    expect(run([0x7a]).x.GS.roundState).toBe(5);
    // 100 rounds to 128 on the grid (even), to 96 on the half grid (96 & 127 = 96: neither), down to 64 (odd), up to 128
    expect(run([0x56], [100]).stack).toEqual([0]);
    expect(run([0x19, 0x56], [100]).stack).toEqual([0]);
    expect(run([0x7d, 0x56], [100]).stack).toEqual([1]);
    expect(run([0x7d, 0x57], [100]).stack).toEqual([0]);
    expect(run([0x7c, 0x57], [100]).stack).toEqual([1]);
    expect(run([0x7a, 0x56], [64]).stack).toEqual([1]); // off: 64 stays 64
    expect(run([0x7a, 0x57], [64]).stack).toEqual([0]);
  });
});
