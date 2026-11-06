/**
 * `optimizeKeys` = `OptimizeKeys` (x2.exe 32988610, with CorrectVectorKeyOrder 329884B0 / CorrectQuaternionKeyOrder 32988330).
 * The expectations of the small cases were recorded from the exe's own machine code on the Unicorn emulator (tools/oracle-optimizekeys.py);
 * the fixture replays 202 more (synthetic key sets and animations of the shipped KSM files) the same way, bit for bit.
 * tools/verify-optimizekeys.ts runs the oracle live on thousands of cases.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { optimizeKeys } from "../src/index.ts";
import type { KeyArrays } from "../src/index.ts";
import { decodeFixture, firstDiff } from "./keys-fixture.ts";

const f32 = (...v: number[]): Float32Array => Float32Array.from(v);
const none = new Float32Array(0);
/** one channel through optimizeKeys: vectors {t, x, y, z} / rotations {t, x, y, z, w} flattened */
const scales = (k: Float32Array, signBits?: { a: number; b: number }): number[] => Array.from(optimizeKeys({ scales: k, translations: none, rotations: none }, 0.001, { signBits }).scales);
const trans = (k: Float32Array): number[] => Array.from(optimizeKeys({ scales: none, translations: k, rotations: none }).translations);
const rots = (k: Float32Array): number[] => Array.from(optimizeKeys({ scales: none, translations: none, rotations: k }).rotations);
const s = Math.fround(Math.SQRT1_2);

describe("rotation keys", () => {
  test("a single key is left alone (not even normalised)", () => {
    expect(rots(f32(0, 0, 0, 0, 2))).toEqual([0, 0, 0, 0, 2]);
  });
  test("two keys: normalised, the first with w >= 0, the second in the hemisphere of the first (the exe flips sign bits, so zeros become -0)", () => {
    expect(rots(f32(0, 0, 0, 0, 2, 1, 0, 0, 0, -3))).toEqual([0, 0, 0, 0, 1, 1, -0, -0, -0, 1]);
    expect(rots(f32(0, 0, 0, 0, -2, 1, 0, 0, 3, -3, 2, 0, -1, 0, 0))).toEqual([0, -0, -0, -0, 1, 1, -0, -0, -s, s, 2, 0, -1, 0, 0]);
  });
  test("a steady spin keeps its end keys (tiny and large angles, 9 and 30 keys); a spin that turns round keeps the turning key too", () => {
    const spin = (n: number, total: number, t0 = 0): number[] => Array.from({ length: n }, (_, i) => [t0 + i, 0, 0, Math.sin((total * i) / (n - 1) / 2), Math.cos((total * i) / (n - 1) / 2)]).flat();
    const near = (got: number[], want: number[]): void => { expect(got.length).toBe(want.length); got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThan(1e-6)); };
    near(rots(f32(...spin(9, 1.2))), [0, 0, 0, 0, 1, 8, 0, 0, 0.564642489, 0.825335622]);
    near(rots(f32(...spin(9, 0.002))), [0, 0, 0, 0, 1, 8, 0, 0, 0.001, 0.999999523]); // below 1 / 1024 of axis length: interpolated linearly
    near(rots(f32(...spin(30, 3))), [0, 0, 0, 0, 1, 29, 0, 0, 0.997494996, 0.070737198]);
    const back = Array.from({ length: 4 }, (_, i) => [9 + i, 0, 0, Math.sin((1.2 - 0.3 * (i + 1)) / 2), Math.cos((1.2 - 0.3 * (i + 1)) / 2)]).flat();
    near(rots(f32(...spin(9, 1.2), ...back)), [0, 0, 0, 0, 1, 8, 0, 0, 0.564642489, 0.825335622, 12, 0, 0, 0, 1]);
  });
});

describe("vector keys", () => {
  test("a constant run keeps its first and last key", () => {
    expect(scales(f32(0, 1, 1, 1, 0.1, 1, 1, 1, 0.2, 1, 1, 1, 0.3, 1, 1, 1))).toEqual([0, 1, 1, 1, Math.fround(0.3), 1, 1, 1]);
  });
  test("a straight ramp keeps its first and last key; a corner is kept; two keys are never reduced", () => {
    expect(trans(f32(0, 0, 0, 0, 0.1, 1, 0, 0, 0.2, 2, 0, 0, 0.3, 3, 0, 0))).toEqual([0, 0, 0, 0, Math.fround(0.3), 3, 0, 0]);
    expect(trans(f32(0, 0, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 3, 2, 1, 0, 4, 2, 2, 0))).toEqual([0, 0, 0, 0, 2, 2, 0, 0, 4, 2, 2, 0]);
    expect(trans(f32(0, 0, 0, 0, 1, 5, 5, 5))).toEqual([0, 0, 0, 0, 1, 5, 5, 5]);
  });
  test("scales are gated by sign accumulators the exe never initialises: a sign change keeps every key, and so does a poisoned start value", () => {
    expect(scales(f32(0, 1, 1, 1, 1, 1, 1, 1, 2, -1, 1, 1, 3, -1, 1, 1))).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 2, -1, 1, 1, 3, -1, 1, 1]);
    const flat = f32(0, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1);
    expect(scales(flat)).toEqual([0, 1, 1, 1, 2, 1, 1, 1]);
    expect(scales(flat, { a: 3, b: 0 })).toEqual(Array.from(flat)); // x already "seen both signs" in states 0 / 1
    expect(scales(f32(0, 1, 1, 1, 1, 1, 1, 1.5, 2, 1, 1, 2, 3, 1, 1, 2.5), { a: 0, b: 0x30 })).toEqual([0, 1, 1, 1, 1, 1, 1, 1.5, 2, 1, 1, 2, 3, 1, 1, 2.5]); // z "seen both" in state 2
  });
});

describe("key order (Correct*KeyOrder)", () => {
  test("keys with a negative time are dropped; the last of them becomes the key at 0 when the first later key is after 0", () => {
    expect(trans(f32(-2, 1, 0, 0, -1, 2, 0, 0, 0.5, 3, 0, 0, 1, 4, 0, 0))).toEqual([0, 2, 0, 0, 1, 4, 0, 0]);
    expect(trans(f32(-3, 1, 1, 1, 4, 2, 2, 2))).toEqual([0, 1, 1, 1, 4, 2, 2, 2]);
    expect(trans(f32(-1, 9, 9, 9, 0, 1, 0, 0, 1, 2, 0, 0))).toEqual([0, 1, 0, 0, 1, 2, 0, 0]); // exactly 0: the negative key is simply dropped
  });
  test("all keys negative: one key at time 0 remains (the last)", () => {
    expect(trans(f32(-2, 1, 0, 0, -1, 2, 0, 0))).toEqual([0, 2, 0, 0]);
    expect(trans(f32(-2, 1, 0, 0))).toEqual([0, 1, 0, 0]);
  });
  test("equal times keep the first key; unsorted keys are sorted by time", () => {
    expect(trans(f32(0, 0, 0, 0, 1, 1, 0, 0, 1, 5, 5, 5, 2, 7, 0, 0))).toEqual([0, 0, 0, 0, 1, 1, 0, 0, 2, 7, 0, 0]);
    expect(trans(f32(2, 2, 0, 0, 0, 0, 0, 0, 1, 5, 0, 0))).toEqual([0, 0, 0, 0, 1, 5, 0, 0, 2, 2, 0, 0]);
  });
  test("the inputs are not modified", () => {
    const k = f32(2, 2, 0, 0, 0, 0, 0, 0, 1, 5, 0, 0);
    const copy = Array.from(k);
    trans(k);
    expect(Array.from(k)).toEqual(copy);
  });
});

describe("replaying what the exe did (tools/oracle-optimizekeys.py, recorded)", () => {
  const { cases, results } = decodeFixture(new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", "optimizekeys.bin"))));
  test(`${cases.length} cases: every key of every channel is bit-identical`, () => {
    expect(cases.length).toBeGreaterThan(150);
    let reduced = 0;
    const bad: string[] = [];
    cases.forEach((c, i) => {
      const want = results[i]!;
      const got: KeyArrays = optimizeKeys(c.keys, c.tol, { signBits: { a: c.signA, b: c.signB } });
      for (const [name, g, w, stride] of [["scales", got.scales, want.scales, 4], ["translations", got.translations, want.translations, 4], ["rotations", got.rotations, want.rotations, 5]] as const) {
        const d = firstDiff(g, w, stride);
        if (d) bad.push(`case ${i} ${name}: ${d}`);
        if (w.length < (name === "scales" ? c.keys.scales.length : name === "translations" ? c.keys.translations.length : c.keys.rotations.length)) reduced++;
      }
    });
    expect(bad).toEqual([]);
    expect(reduced).toBeGreaterThan(100); // the fixture really exercises the reduction
  });
});
