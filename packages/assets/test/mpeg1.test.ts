import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AviError, parseAvi } from "../src/avi.ts";
import { Mpeg1Movie } from "../src/movie.ts";
import { Mpeg1Decoder, Mpeg1Error, ZIGZAG, inverseDct, splitPictures, visiblePlanes, yuv420ToBgra } from "../src/mpeg1.ts";
import type { Mpeg1Frame } from "../src/mpeg1.ts";
import {
  MB_TYPE_B, MB_TYPE_P, CODED_BLOCK_PATTERN, DC_SIZE_CHROMA, DC_SIZE_LUMA, DEFAULT_INTRA_MATRIX, MB_ADDR_INCR, MOTION_CODE, RL_EOB, RL_ESCAPE, RUN_LEVEL,
} from "../src/mpeg1-tables.ts";

// ------------------------------------------------------------------------------------------------------------ helpers
const FIXTURES = join(import.meta.dir, "fixtures", "mpeg1");
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const hashes = (f: Mpeg1Frame): number[] => visiblePlanes(f).map(crc32);

interface Expected { width: number; height: number; crc: number[][]; types: number[] }
const expected: Record<string, Expected> = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8"));
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name + ".m1v")));

function decodeAll(data: Uint8Array): { frames: Mpeg1Frame[]; decoder: Mpeg1Decoder } {
  const decoder = new Mpeg1Decoder();
  const frames = [...decoder.decode(data), ...decoder.flush()];
  return { frames, decoder };
}

class BitWriter {
  private bits: number[] = [];
  put(value: number, n: number): this { for (let i = n - 1; i >= 0; i--) this.bits.push((value >>> i) & 1); return this; }
  code(c: readonly number[]): this { return this.put(c[0]!, c[1]!); }
  align(): this { while (this.bits.length % 8) this.bits.push(0); return this; }
  startCode(code: number): this { this.align(); return this.put(1, 24).put(code, 8); }
  bytes(): Uint8Array {
    this.align();
    const out = new Uint8Array(this.bits.length / 8);
    this.bits.forEach((b, i) => { out[i >> 3]! |= b << (7 - (i & 7)); });
    return out;
  }
}

/** Intra pictures made by hand: every block is a DC value only, so the decoded picture is flat per block. */
function sequenceHeader(w: BitWriter, width: number, height: number): void {
  w.startCode(0xb3).put(width, 12).put(height, 12).put(1, 4).put(2, 4).put(0x3ffff, 18).put(1, 1).put(20, 10).put(0, 1).put(0, 1).put(0, 1);
}
function pictureHeader(w: BitWriter, temporalReference: number, type: number, fCode = 1): void {
  w.startCode(0x00).put(temporalReference, 10).put(type, 3).put(0xffff, 16);
  if (type >= 2) w.put(0, 1).put(fCode, 3);
  if (type === 3) w.put(0, 1).put(fCode, 3);
  w.put(0, 1);
}
/** a macroblock of flat blocks: luma value y (all four blocks), chroma cb / cr; `pred` is the DC predictor state of the slice */
function intraMacroblock(w: BitWriter, increment: number, pred: number[], y: number, cb: number, cr: number, stuffing = 0): void {
  for (let i = 0; i < stuffing; i++) w.code(MB_ADDR_INCR[34]!);
  let inc = increment;
  while (inc > 33) { w.code(MB_ADDR_INCR[33]!); inc -= 33; }
  w.code(MB_ADDR_INCR[inc - 1]!);
  w.put(1, 1); // macroblock_type: intra
  intraBlocks(w, pred, y, cb, cr);
}
function intraBlocks(w: BitWriter, pred: number[], y: number, cb: number, cr: number): void {
  const targets = [y, y, y, y, cb, cr];
  targets.forEach((target, b) => {
    const comp = b < 4 ? 0 : b - 3;
    const diff = target - pred[comp]!;
    pred[comp] = target;
    const size = diff === 0 ? 0 : 32 - Math.clz32(Math.abs(diff));
    w.code((b < 4 ? DC_SIZE_LUMA : DC_SIZE_CHROMA)[size]!);
    if (size) w.put(diff > 0 ? diff : diff + (1 << size) - 1, size);
    w.code(RL_EOB);
  });
}

// ------------------------------------------------------------------------------------------------------------- tables
describe("MPEG-1 tables", () => {
  test("sizes and anchors of the standard's tables", () => {
    expect(RUN_LEVEL.length).toBe(111);
    expect(new Set(RUN_LEVEL.map((e) => e[2] * 64 + e[3])).size).toBe(111); // every (run, level) once
    expect(RL_EOB).toEqual([2, 2]); // `10`
    expect(RL_ESCAPE).toEqual([1, 6]); // `000001`
    expect(RUN_LEVEL[0]).toEqual([3, 2, 0, 1]); // `11s` = run 0, level 1
    expect(MB_ADDR_INCR.length).toBe(35);
    expect(MB_ADDR_INCR[0]).toEqual([1, 1]); // `1`: increment 1
    expect(MB_ADDR_INCR[33]).toEqual([8, 11]); // escape `00000001000`
    expect(MB_ADDR_INCR[34]).toEqual([15, 11]); // stuffing `00000001111`
    expect(CODED_BLOCK_PATTERN.length).toBe(64);
    expect(CODED_BLOCK_PATTERN[60]).toEqual([7, 3]); // `111`
    expect(MOTION_CODE.length).toBe(17);
    expect(DC_SIZE_LUMA[0]).toEqual([4, 3]); // `100`
    expect(DC_SIZE_CHROMA[0]).toEqual([0, 2]); // `00`
  });

  test("every VLC table is a prefix code that never uses more than the whole code space", () => {
    const check = (name: string, codes: ReadonlyArray<readonly number[]>): void => {
      let kraft = 0;
      for (let i = 0; i < codes.length; i++) {
        kraft += 2 ** -codes[i]![1]!;
        for (let j = 0; j < codes.length; j++) {
          if (i === j) continue;
          const [a, la] = codes[i]! as [number, number], [b, lb] = codes[j]! as [number, number];
          if (la <= lb) expect(`${name} ${i} prefix of ${j}: ${b >> (lb - la) === a}`).toContain("false");
        }
      }
      expect(kraft).toBeLessThanOrEqual(1);
    };
    check("mba", MB_ADDR_INCR);
    check("cbp", CODED_BLOCK_PATTERN);
    check("mv", MOTION_CODE);
    check("dcY", DC_SIZE_LUMA);
    check("dcC", DC_SIZE_CHROMA);
    // DCT: each code is followed by a sign bit except EOB and escape
    check("dct", [...RUN_LEVEL.map((e) => [e[0], e[1]] as const), RL_EOB, RL_ESCAPE]);
  });

  test("zigzag scan and default intra matrix", () => {
    expect(ZIGZAG.slice(0, 16)).toEqual([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5]);
    expect(ZIGZAG[63]).toBe(63);
    expect(new Set(ZIGZAG).size).toBe(64);
    expect(DEFAULT_INTRA_MATRIX.length).toBe(64);
    expect(DEFAULT_INTRA_MATRIX.slice(0, 8)).toEqual([8, 16, 19, 22, 26, 27, 29, 34]);
    expect(DEFAULT_INTRA_MATRIX.slice(56)).toEqual([27, 29, 35, 38, 46, 56, 69, 83]);
    expect(DEFAULT_INTRA_MATRIX.reduce((a, b) => a + b, 0)).toBe(2114);
  });
});

// ---------------------------------------------------------------------------------------------------------------- IDCT
describe("inverse DCT", () => {
  test("stays within one of the exact IDCT (IEEE 1180 peak error) for dense, sparse and DC-only blocks", () => {
    let seed = 12345;
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const cos = Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, u) => (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2));
    let worst = 0, sumSq = 0, count = 0;
    for (let n = 0; n < 1500; n++) {
      const coeff = new Int32Array(64);
      const density = n % 3 === 0 ? 64 : n % 3 === 1 ? 6 : 1;
      const range = n % 2 === 0 ? 100 : 300; // what dequantised blocks look like (the output has to fit 8 bits)
      for (let k = 0; k < density; k++) coeff[density === 1 ? 0 : Math.floor(rnd() * 64)] = Math.round((rnd() * 2 - 1) * range) | 1;
      const out = Int32Array.from(coeff);
      inverseDct(out);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        let v = 0;
        for (let u = 0; u < 8; u++) for (let w = 0; w < 8; w++) v += coeff[u * 8 + w]! * cos[y]![u]! * cos[x]![w]!;
        const d = out[y * 8 + x]! - Math.round(v);
        worst = Math.max(worst, Math.abs(d)); sumSq += d * d; count++;
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
    expect(sumSq / count).toBeLessThan(0.06); // IEEE 1180: overall mean square error
  });

  test("a DC coefficient d * 8 gives a flat block of d", () => {
    for (const d of [0, 1, 17, 128, 254, 255]) {
      const b = new Int32Array(64); b[0] = d * 8;
      inverseDct(b);
      expect(new Set(b)).toEqual(new Set([d]));
    }
  });
});

// ------------------------------------------------------------------------------- streams made with FFmpeg (the oracle)
describe("pictures identical to FFmpeg", () => {
  for (const name of Object.keys(expected)) {
    test(name, () => {
      const e = expected[name]!;
      const { frames, decoder } = decodeAll(fixture(name));
      expect(frames.length).toBe(e.crc.length);
      expect(frames.map((f) => f.pictureType)).toEqual(e.types);
      expect(decoder.info!.width).toBe(e.width);
      expect(decoder.info!.height).toBe(e.height);
      frames.forEach((f, i) => expect(hashes(f)).toEqual(e.crc[i]!));
      expect(decoder.stats.outsideVectors).toBe(0); // no vector leaves the picture (the standard forbids it)
    });
  }

  // each stream is there for a feature; a regenerated fixture that stopped exercising it would make the test above vacuous
  test("the streams exercise what they are for", () => {
    const stats = (n: string) => decodeAll(fixture(n)).decoder.stats;
    const ipb = stats("ipb_64x48");
    expect(ipb.pictures.slice(1)).toEqual([3, 4, 12]);
    expect(ipb.bidirectional).toBeGreaterThan(20);
    expect(ipb.forward).toBeGreaterThan(20);
    expect(ipb.backward).toBeGreaterThan(20);
    expect(ipb.intra).toBeGreaterThan(20);
    expect(ipb.skipped).toBeGreaterThan(5);
    expect(ipb.noVector).toBeGreaterThan(5); // P macroblocks with a pattern but no vector
    expect(ipb.escapes).toBeGreaterThan(20);
    expect(decodeAll(fixture("ipb_50x34")).frames[0]).toMatchObject({ width: 50, height: 34, strideY: 64, strideC: 32 });
    expect(stats("fast_96x64").maxFCode).toBeGreaterThanOrEqual(3);
    expect(stats("qscale1_64x32").escapes16).toBeGreaterThan(5);
    expect(stats("adaptive_96x64").quantChanges).toBeGreaterThan(50);
    expect(stats("wide_640x32").addrEscapes).toBeGreaterThanOrEqual(1);
    expect(stats("wide_640x32").skipped).toBeGreaterThan(400);
    expect(stats("fullpel_64x48").fullPelPictures).toBeGreaterThan(10);
    const lm = decodeAll(fixture("loadmatrix_64x48"));
    expect(lm.decoder.stats.customMatrices).toBeGreaterThanOrEqual(2);
    expect(lm.decoder.info!.intraMatrix[ZIGZAG[1]!]).toBe(8 + 5 + 1);
    expect(lm.decoder.info!.nonIntraMatrix[ZIGZAG[2]!]).toBe(10 + 22 + 1);
  });

  test("pictures are returned in display order: types and temporal references", () => {
    const { frames } = decodeAll(fixture("ipb_64x48"));
    expect(frames.map((f) => "?IPBD"[f.pictureType]).join("")).toBe("IBBPBBPBBIBBPBBPBBI");
    // the B pictures after the second I picture belong to its GOP (temporal reference 0 and 1) and are shown before it (reference 2)
    expect(frames.slice(0, 10).map((f) => f.temporalReference)).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 1, 2]);
  });

  test("splitPictures gives one piece per picture, and the pieces decode to the same pictures", () => {
    const es = fixture("ipb_64x48");
    const pieces = splitPictures(es);
    expect(pieces.length).toBe(19);
    expect(pieces.reduce((n, p) => n + p.length, 0)).toBe(es.length);
    const dec = new Mpeg1Decoder();
    const frames: Mpeg1Frame[] = [];
    for (const p of pieces) frames.push(...dec.decode(p));
    frames.push(...dec.flush());
    frames.forEach((f, i) => expect(hashes(f)).toEqual(expected["ipb_64x48"]!.crc[i]!));
  });
});

// --------------------------------------------------------------------------------------- streams made by hand (slices)
describe("hand made intra pictures", () => {
  const planeOf = (f: Mpeg1Frame, mbx: number, mby: number): { y: number[]; cb: number; cr: number } => ({
    y: [f.y[(mby * 16) * f.strideY + mbx * 16]!, f.y[(mby * 16) * f.strideY + mbx * 16 + 8]!, f.y[(mby * 16 + 8) * f.strideY + mbx * 16]!, f.y[(mby * 16 + 15) * f.strideY + mbx * 16 + 15]!],
    cb: f.cb[(mby * 8 + 7) * f.strideC + mbx * 8 + 7]!, cr: f.cr[(mby * 8) * f.strideC + mbx * 8]!,
  });
  const ys = [20, 50, 80, 110, 140, 170], cbs = [100, 110, 120, 130, 140, 150], crs = [200, 190, 180, 170, 160, 150];

  test("a slice may start in the middle of a row; predictors restart with every slice", () => {
    const w = new BitWriter();
    sequenceHeader(w, 48, 32);
    pictureHeader(w, 0, 1);
    // slice 1: row 0, macroblocks 0 and 1
    let pred = [128, 128, 128];
    w.startCode(0x01).put(8, 5).put(0, 1);
    intraMacroblock(w, 1, pred, ys[0]!, cbs[0]!, crs[0]!);
    intraMacroblock(w, 1, pred, ys[1]!, cbs[1]!, crs[1]!);
    // slice 2: also row 0, its first macroblock is number 2 (increment 3 from the start of the row)
    pred = [128, 128, 128];
    w.startCode(0x01).put(8, 5).put(0, 1);
    intraMacroblock(w, 3, pred, ys[2]!, cbs[2]!, crs[2]!);
    // slice 3: row 1, macroblocks 3..5
    pred = [128, 128, 128];
    w.startCode(0x02).put(8, 5).put(0, 1);
    for (let k = 3; k < 6; k++) intraMacroblock(w, 1, pred, ys[k]!, cbs[k]!, crs[k]!);
    w.startCode(0xb7);
    const { frames, decoder } = decodeAll(w.bytes());
    expect(frames.length).toBe(1);
    expect(decoder.stats.slices).toBe(3);
    const f = frames[0]!;
    for (let k = 0; k < 6; k++) {
      const p = planeOf(f, k % 3, (k / 3) | 0);
      expect(p).toEqual({ y: [ys[k]!, ys[k]!, ys[k]!, ys[k]!], cb: cbs[k]!, cr: crs[k]! });
    }
  });

  test("macroblock stuffing is ignored", () => {
    const build = (stuffing: number): Uint8Array => {
      const w = new BitWriter();
      sequenceHeader(w, 32, 16);
      pictureHeader(w, 0, 1);
      const pred = [128, 128, 128];
      w.startCode(0x01).put(5, 5).put(0, 1);
      intraMacroblock(w, 1, pred, 90, 70, 60, stuffing);
      intraMacroblock(w, 1, pred, 91, 71, 61, stuffing);
      return w.bytes();
    };
    const a = decodeAll(build(0)).frames[0]!, b = decodeAll(build(3)).frames[0]!;
    expect(hashes(b)).toEqual(hashes(a));
    expect(a.y[0]).toBe(90);
    expect(a.y[16]).toBe(91);
  });

  // I picture of four flat macroblocks, then (kind "P") a P picture or (kind "B") an all intra P picture followed by a B picture, whose
  // macroblocks are: forward +16, intra, forward +16, forward 0.  A vector is half pels (f_code 2: -32..31), so +16 moves the prediction 8 pixels
  // to the right; if the intra macroblock did not reset the predictor, the third vector would be 16 + 16 = 32 and wrap to -32.
  const resetTest = (kind: "P" | "B"): { frames: Mpeg1Frame[]; target: Mpeg1Frame } => {
    const w = new BitWriter();
    sequenceHeader(w, 64, 16);
    pictureHeader(w, 0, 1);
    const ys = [20, 60, 100, 140], cbs = [100, 110, 120, 130], crs = [200, 190, 180, 170];
    const pred = [128, 128, 128];
    w.startCode(0x01).put(8, 5).put(0, 1);
    for (let k = 0; k < 4; k++) intraMacroblock(w, 1, pred, ys[k]!, cbs[k]!, crs[k]!);
    const type = kind === "P" ? 2 : 3;
    if (kind === "B") { // the later reference, shown after the B picture
      pictureHeader(w, 2, 2, 2);
      w.startCode(0x01).put(8, 5).put(0, 1);
      for (let k = 0; k < 4; k++) { w.code(MB_ADDR_INCR[0]!).code(MB_TYPE_P[3]!); intraBlocks(w, [128, 128, 128], 200 - 40 * k, 50, 60); }
    }
    const motion = (v: number): void => {
      if (v === 0) { w.code(MOTION_CODE[0]!); return; }
      const code = Math.ceil(Math.abs(v) / 2);
      w.code(MOTION_CODE[code]!).put(v < 0 ? 1 : 0, 1).put(Math.abs(v) - ((code - 1) * 2 + 1), 1);
    };
    const forward = (dx: number, dy: number): void => {
      w.code(MB_ADDR_INCR[0]!).code(kind === "P" ? MB_TYPE_P[2]! : MB_TYPE_B[4]!); motion(dx); motion(dy);
    };
    pictureHeader(w, 1, type, 2);
    w.startCode(0x01).put(8, 5).put(0, 1);
    forward(16, 0);
    w.code(MB_ADDR_INCR[0]!).code(kind === "P" ? MB_TYPE_P[3]! : MB_TYPE_B[6]!); // intra
    intraBlocks(w, [128, 128, 128], 200, 50, 60);
    forward(16, 0);
    forward(0, 0);
    const { frames } = decodeAll(w.bytes());
    return { frames, target: frames[1]! };
  };
  const expectResetPictures = (p: Mpeg1Frame): void => {
    const row = (plane: Uint8Array, stride: number, n: number, r: number): number[] => Array.from(plane.subarray(r * stride, r * stride + n));
    const expectY = [...Array(8).fill(20), ...Array(8).fill(60), ...Array(16).fill(200), ...Array(8).fill(100), ...Array(8).fill(140), ...Array(16).fill(140)];
    expect(row(p.y, p.strideY, 64, 8)).toEqual(expectY);
    // chroma: half the vector, 4 samples
    expect(row(p.cb, p.strideC, 32, 4)).toEqual([...Array(4).fill(100), ...Array(4).fill(110), ...Array(8).fill(50), ...Array(4).fill(120), ...Array(4).fill(130), ...Array(8).fill(130)]);
  };

  test("an intra macroblock in a P picture resets the vector predictor", () => {
    const { frames, target } = resetTest("P");
    expect(frames.map((f) => f.pictureType)).toEqual([1, 2]);
    expectResetPictures(target);
  });

  test("an intra macroblock in a B picture resets the vector predictors", () => {
    const { frames, target } = resetTest("B");
    expect(frames.map((f) => f.pictureType)).toEqual([1, 3, 2]); // display order: I, B, P
    expectResetPictures(target);
  });

  test("slices below the picture are ignored, a missing reference skips the picture, D pictures and orphan pictures are errors", () => {
    const w = new BitWriter();
    sequenceHeader(w, 16, 16);
    pictureHeader(w, 0, 1);
    const pred = [128, 128, 128];
    w.startCode(0x01).put(8, 5).put(0, 1);
    intraMacroblock(w, 1, pred, 60, 60, 60);
    w.startCode(0x05).put(8, 5).put(0, 1); // row 4 of a one row picture
    intraMacroblock(w, 1, [128, 128, 128], 200, 200, 200);
    const { frames } = decodeAll(w.bytes());
    expect(frames.length).toBe(1);
    expect(frames[0]!.y[0]).toBe(60);

    const p = new BitWriter();
    sequenceHeader(p, 16, 16);
    pictureHeader(p, 3, 2); // P without a reference
    p.startCode(0x01).put(8, 5).put(0, 1);
    expect(decodeAll(p.bytes()).frames.length).toBe(0);

    const d = new BitWriter();
    sequenceHeader(d, 16, 16);
    d.startCode(0x00).put(0, 10).put(4, 3).put(0xffff, 16).put(0, 1);
    expect(() => decodeAll(d.bytes())).toThrow(/D pictures/);

    const o = new BitWriter();
    pictureHeader(o, 0, 1);
    expect(() => decodeAll(o.bytes())).toThrow(Mpeg1Error);
  });
});

// ------------------------------------------------------------------------------------------------------- robustness
describe("damaged streams", () => {
  test("random damage ends in an Mpeg1Error or in pictures, never in another exception or a hang", () => {
    const base = fixture("ipb_64x48");
    let seed = 99;
    const rnd = (n: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };
    let errors = 0, ok = 0;
    for (let trial = 0; trial < 300; trial++) {
      const data = Uint8Array.from(base);
      const hits = 1 + rnd(6);
      for (let k = 0; k < hits; k++) data[rnd(data.length)] = rnd(256);
      const cut = trial % 5 === 0 ? data.subarray(0, 40 + rnd(data.length - 40)) : data;
      try { decodeAll(cut); ok++; } catch (e) {
        expect(e instanceof Mpeg1Error).toBe(true);
        errors++;
      }
    }
    expect(errors).toBeGreaterThan(20);
    expect(ok).toBeGreaterThan(20);
  });

  test("a truncated picture is an error or a partial picture, a stream without start codes is empty", () => {
    expect(decodeAll(new Uint8Array(0)).frames.length).toBe(0);
    expect(decodeAll(new Uint8Array(100)).frames.length).toBe(0);
    expect(decodeAll(Uint8Array.from({ length: 64 }, (_, i) => i * 7)).frames.length).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------ colour
describe("yuv420ToBgra", () => {
  const solid = (y: number, cb: number, cr: number): Mpeg1Frame => ({
    width: 2, height: 2, y: new Uint8Array(4).fill(y), cb: new Uint8Array(1).fill(cb), cr: new Uint8Array(1).fill(cr), strideY: 2, strideC: 1, pictureType: 1, temporalReference: 0,
  });
  test("BT.601 limited range: black, white, grey, saturated primaries", () => {
    const px = (y: number, cb: number, cr: number): number[] => [...yuv420ToBgra(solid(y, cb, cr)).subarray(0, 4)];
    expect(px(16, 128, 128)).toEqual([0, 0, 0, 255]);
    expect(px(235, 128, 128)).toEqual([255, 255, 255, 255]);
    expect(px(126, 128, 128)).toEqual([128, 128, 128, 255]);
    const red = px(81, 90, 240), green = px(145, 54, 34), blue = px(41, 240, 110);
    expect(red[2]).toBeGreaterThan(250); expect(red[0]).toBeLessThan(5); expect(red[1]).toBeLessThan(5);
    expect(green[1]).toBeGreaterThan(250); expect(green[0]).toBeLessThan(5); expect(green[2]).toBeLessThan(5);
    expect(blue[0]).toBeGreaterThan(250); expect(blue[1]).toBeLessThan(5); expect(blue[2]).toBeLessThan(5);
  });
  test("crops the macroblock padding and replicates chroma", () => {
    const f = decodeAll(fixture("ipb_50x34")).frames[0]!;
    const rgba = yuv420ToBgra(f);
    expect(rgba.length).toBe(50 * 34 * 4);
    // pixel (x, y) uses chroma (x >> 1, y >> 1): neighbouring pixels of a 2x2 group share chroma, so a flat luma area gives equal colours
    const flat = solid(100, 90, 160);
    const o = yuv420ToBgra(flat);
    expect([...o.subarray(0, 4)]).toEqual([...o.subarray(12, 16)]);
  });
});

// -------------------------------------------------------------------------------------------------------------- AVI
function makeAvi(chunks: Uint8Array[], width: number, height: number, opts: { keyframes?: boolean[]; audio?: boolean; fps?: number } = {}): Uint8Array {
  const parts: number[] = [];
  const u32 = (v: number): void => { parts.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); };
  const str = (s: string): void => { for (const c of s) parts.push(c.charCodeAt(0)); };
  const bytes = (b: ArrayLike<number>): void => { for (let i = 0; i < b.length; i++) parts.push(b[i]!); };
  const patchU32 = (at: number, v: number): void => { parts[at] = v & 255; parts[at + 1] = (v >>> 8) & 255; parts[at + 2] = (v >>> 16) & 255; parts[at + 3] = (v >>> 24) & 255; };
  const fps = opts.fps ?? 24;
  const list = (type: string, body: () => void): void => { str("LIST"); const at = parts.length; u32(0); str(type); body(); patchU32(at, parts.length - at - 4); };
  const chunk = (id: string, data: ArrayLike<number>): number => { str(id); u32(data.length); const off = parts.length; bytes(data); if (data.length & 1) parts.push(0); return off; };
  str("RIFF"); u32(0); str("AVI ");
  list("hdrl", () => {
    const avih = new Uint8Array(56); const dv = new DataView(avih.buffer);
    dv.setUint32(0, Math.round(1e6 / fps), true); dv.setUint32(16, chunks.length, true); dv.setUint32(32, width, true); dv.setUint32(36, height, true);
    chunk("avih", avih);
    list("strl", () => {
      const strh = new Uint8Array(56); const s = new DataView(strh.buffer);
      strh.set([..."vids"].map((c) => c.charCodeAt(0)), 0); strh.set([..."MPG1"].map((c) => c.charCodeAt(0)), 4);
      s.setUint32(20, 1, true); s.setUint32(24, fps, true); s.setUint32(32, chunks.length, true);
      chunk("strh", strh);
      const bih = new Uint8Array(40); const b = new DataView(bih.buffer);
      b.setUint32(0, 40, true); b.setInt32(4, width, true); b.setInt32(8, height, true); b.setUint16(12, 1, true); b.setUint16(14, 24, true);
      bih.set([..."MPG1"].map((c) => c.charCodeAt(0)), 16);
      chunk("strf", bih);
    });
  });
  chunk("JUNK", new Uint8Array(13)); // odd sized padding chunk, as in the shipped files
  const entries: Array<{ off: number; size: number }> = [];
  let moviType = 0;
  list("movi", () => {
    moviType = parts.length - 4;
    chunks.forEach((c, i) => {
      const at = parts.length;
      chunk("00dc", c);
      entries.push({ off: at - moviType, size: c.length });
      if (opts.audio && i % 2 === 0) chunk("01wb", new Uint8Array(5));
    });
  });
  str("idx1"); u32(16 * entries.length);
  entries.forEach((e, i) => { str("00dc"); u32(opts.keyframes?.[i] === false ? 0 : 0x10); u32(e.off); u32(e.size); });
  patchU32(4, parts.length - 8);
  return Uint8Array.from(parts);
}

describe("AVI demuxer", () => {
  test("headers, chunks of odd size, interleaved audio and the key frame flags of idx1", () => {
    const chunks = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5), Uint8Array.of(6, 7, 8, 9, 10)];
    const data = makeAvi(chunks, 400, 220, { keyframes: [true, false, false], audio: true });
    const avi = parseAvi(data);
    expect(avi.microSecPerFrame).toBe(41667);
    expect(avi.width).toBe(400);
    expect(avi.height).toBe(220);
    expect(avi.streams.length).toBe(1);
    expect(avi.streams[0]).toMatchObject({ type: "vids", handler: "MPG1", rate: 24, scale: 1, length: 3 });
    expect(avi.chunks.filter((c) => c.stream === 0).map((c) => [...data.subarray(c.offset, c.offset + c.size)])).toEqual(chunks.map((c) => [...c]));
    expect(avi.chunks.filter((c) => c.stream === 0).map((c) => c.keyframe)).toEqual([true, false, false]);
    expect(avi.chunks.filter((c) => c.kind === "wb").length).toBe(2);
  });
  test("rejects other files", () => {
    expect(() => parseAvi(new Uint8Array(20))).toThrow(AviError);
    expect(() => parseAvi(Uint8Array.from([..."RIFF\0\0\0\0WAVE"].map((c) => c.charCodeAt(0))))).toThrow(AviError);
  });
});

describe("Mpeg1Movie", () => {
  for (const name of ["fast_96x64", "ipb_64x48", "adaptive_96x64"]) {
    test(`${name}: sequential and random access give the pictures FFmpeg gives`, () => {
      const e = expected[name]!;
      const es = fixture(name);
      const pieces = splitPictures(es);
      const movie = Mpeg1Movie.open(makeAvi(pieces, e.width, e.height));
      expect(movie.info).toMatchObject({ width: e.width, height: e.height, frameCount: pieces.length, frameRate: { num: 24, den: 1 } });
      const seqHashes: number[][] = [];
      for (let f = movie.next(); f; f = movie.next()) seqHashes.push(hashes(f));
      expect(seqHashes).toEqual(e.crc);
      expect(movie.next()).toBeNull();
      let seed = 7;
      const order = Array.from({ length: 24 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % e.crc.length; });
      for (const i of [...order, 0, e.crc.length - 1, 3, 2, 3, 4]) expect(hashes(movie.frame(i)!)).toEqual(e.crc[i]!);
      expect(movie.frame(-1)).toBeNull();
      expect(movie.frame(e.crc.length)).toBeNull();
      movie.seek(5);
      expect(movie.position).toBe(5);
      expect(hashes(movie.next()!)).toEqual(e.crc[5]!);
    });
  }
});

// ------------------------------------------------------------------------------------- the real movies (data/movie)
/** CRC-32 per plane and picture as FFmpeg decodes the shipped movies (recorded by tools/oracle-mpeg1.py --pack) */
function recorded(name: string): { frames: number; types: string; crc: number[][] } {
  const index = JSON.parse(readFileSync(join(FIXTURES, "movies.json"), "utf8")) as Record<string, { frames: number; types: string; offset: number }>;
  const bin = readFileSync(join(FIXTURES, "movies.bin"));
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const e = index[name]!;
  return { frames: e.frames, types: e.types, crc: Array.from({ length: e.frames }, (_, n) => [0, 4, 8].map((o) => dv.getUint32(e.offset + 12 * n + o, true))) };
}
const movieFile = (name: string): string => `data/movie/${name}`;
const REAL = movieFile("movie_create_aisha_base.avi");
describe.skipIf(!existsSync(REAL))("data/movie", () => {
  const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(movieFile(name)));

  test("AVI structure: one MPG1 video stream, 400x220, 24 fps, 505 pictures, 27 key frames, no audio", () => {
    const avi = parseAvi(bytes("movie_create_aisha_base.avi"));
    expect(avi.streams.map((s) => [s.type, s.handler, s.rate, s.scale])).toEqual([["vids", "MPG1", 24, 1]]);
    expect(avi.microSecPerFrame).toBe(41666);
    expect(avi.chunks.length).toBe(505);
    expect(avi.chunks.every((c) => c.stream === 0 && c.kind === "dc")).toBe(true);
    expect(avi.chunks.filter((c) => c.keyframe).length).toBe(27);
    const movie = Mpeg1Movie.open(bytes("movie_create_aisha_base.avi"));
    expect(movie.info.width).toBe(400);
    expect(movie.info.height).toBe(220);
    expect(movie.info.frameCount).toBe(505);
    expect(movie.info.durationMs).toBeCloseTo(505 * 1000 / 24, 6);
  });

  // every picture of three movies (the longest, the shortest and the first); tools/verify-mpeg1.ts does all 30
  for (const name of ["movie_create_aisha_base.avi", "movie_create_es_base.avi", "movie_create_aisha_dw.avi"]) {
    test(`${name}: every picture identical to FFmpeg`, () => {
      const want = recorded(name);
      const movie = Mpeg1Movie.open(bytes(name));
      expect(movie.info.frameCount).toBe(want.frames);
      let n = 0;
      for (let f = movie.next(); f; f = movie.next(), n++) {
        expect(f).toMatchObject({ width: 400, height: 220, strideY: 400, strideC: 200 });
        expect(f.y.length).toBe(400 * 224); // 14 macroblock rows decoded, 220 displayed
        expect("?IPBD"[f.pictureType]).toBe(want.types[n]!);
        if (!hashes(f).every((h, i) => h === want.crc[n]![i])) throw new Error(`${name}: picture ${n} differs from FFmpeg`);
      }
      expect(n).toBe(want.frames);
    });
  }

  test("random access gives the same pictures as sequential decoding", () => {
    const want = recorded("movie_create_aisha_base.avi");
    const movie = Mpeg1Movie.open(bytes("movie_create_aisha_base.avi"));
    let seed = 5;
    const order = [504, 0, 1, 5, 6, 100, 99, 250, 31, 30, 29, 300, 299, 301, 302, 0];
    for (let k = 0; k < 20; k++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; order.push((seed >>> 8) % 505); }
    for (const i of order) {
      const f = movie.frame(i)!;
      expect(hashes(f)).toEqual(want.crc[i]!);
      expect(movie.position).toBe(i + 1);
    }
  });

  test("the whole file: 27 I and 478 P pictures, one slice each, nothing but what a plain I/P encoder writes", () => {
    const decoder = new Mpeg1Decoder();
    const avi = parseAvi(bytes("movie_create_aisha_base.avi"));
    let count = 0;
    for (const c of avi.chunks) count += decoder.decode(avi.data.subarray(c.offset, c.offset + c.size)).length;
    count += decoder.flush().length;
    expect(count).toBe(505);
    expect(decoder.stats.pictures.slice(1)).toEqual([27, 478, 0]);
    expect(decoder.stats.slices).toBe(505);
    expect(decoder.info).toMatchObject({ width: 400, height: 220, frameRateCode: 2, frameRate: { num: 24, den: 1 }, constrainedParameters: false });
    expect(decoder.stats).toMatchObject({ outsideVectors: 0, customMatrices: 0, quantChanges: 0, fullPelPictures: 0 });
    expect(decoder.stats.addrEscapes).toBeGreaterThan(0); // the real streams contain macroblock_escape too
  });
});
