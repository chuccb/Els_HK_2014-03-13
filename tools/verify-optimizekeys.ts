/**
 * Differential test of `optimizeKeys` (packages/engine/src/kac-keys.ts, the port of `OptimizeKeys` 32988610) against the exe's own machine code
 * running on the Unicorn CPU emulator (tools/oracle-optimizekeys.py):
 *
 *   pip install --target /home/user/work/pycap unicorn pefile
 *   ./node_modules/.bin/bun run tools/verify-optimizekeys.ts [--synthetic N] [--corpus STEP] [--seed S] [--tol T] [--natural] [--verbose] [--record FILE [--budget BYTES]]
 *
 * Cases: N random key sets (constant / ramps / piecewise linear / random walks / curves / noise at several scales around the tolerance; rotations as
 * slerps, spins, random walks, hemisphere flips, tiny rotations, non-unit lengths; keys unsorted, duplicated, negative times, 0 / 1 / 2 keys) and
 * every STEP-th animation of every KSM / KAC in the KOMs (default 400; 0 = none).  Outputs are compared bit for bit (the arrays and every float).
 * `--natural` also runs the corpus with the stack garbage the emulated CorrectVectorKeyOrder leaves in the scale reducer's two uninitialised
 * accumulators (which the exe really has) and reports how often that turns the scale reduction off.
 * `--record FILE` writes the cases (and the oracle's answers) that fit in BYTES (default 240000: 60 % synthetic cases and 40 % shipped animations, each at most
 * 4,000 bytes, in order; only when every case matched) as the fixture
 * packages/engine/test/fixtures/optimizekeys.bin that packages/engine/test/kac-keys.test.ts replays without Python.
 * `--merge A.bin,B.bin` appends the cases of other fixture files to the recorded one; `--dump-failing FILE [--dump-count N]` writes the N smallest
 * cases that differ (with the oracle's answers) as such a file: mutate the port, dump what catches the mutant, merge it into the fixture
 * (that is how the fixture got the cases that pin the linear -> slerp switch and the 180-degree step of the rotation reducer).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseKsm } from "@els/assets";
import { isKsmData, optimizeKeys } from "@els/engine";
import type { KeyArrays } from "@els/engine";
import { NATURAL, decodeFixture, decodeResults, encodeCases, encodeFixture, firstDiff } from "../packages/engine/test/keys-fixture.ts";
import type { KeyCase as Case } from "../packages/engine/test/keys-fixture.ts";
import { indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const nSynthetic = Number(opt("--synthetic") ?? 3000);
const corpusStep = Number(opt("--corpus") ?? 400);
const seed = Number(opt("--seed") ?? 1);
const fixedTol = opt("--tol") ? Number(opt("--tol")) : undefined;
const natural = args.includes("--natural");
const verbose = args.includes("--verbose");
const recordTo = opt("--record");
const budget = Number(opt("--budget") ?? 240000);
const mergeFiles = (opt("--merge") ?? "").split(",").filter(Boolean);
const dumpFailing = opt("--dump-failing");
const dumpCount = Number(opt("--dump-count") ?? 2);

// ---------------------------------------------------------------------------------------------- random cases
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);
const rnd = (a = 1, b?: number): number => (b === undefined ? rng() * a : a + rng() * (b - a));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

function genTimes(n: number): number[] {
  const dt = pick([1 / 30, 1 / 60, 0.001, 0.2, rnd(0.0005, 0.1)]);
  let t = pick([0, 0, 0, rnd(0, 0.5), -rnd(0, 0.3)]);
  const times: number[] = [];
  for (let i = 0; i < n; i++) { times.push(t); t += dt * (rng() < 0.2 ? rnd(0.2, 3) : 1); }
  const quirk = rng();
  if (quirk < 0.04 && n > 2) { const j = 1 + Math.floor(rng() * (n - 1)); times[j] = times[j - 1]!; } // a duplicate time
  else if (quirk < 0.08 && n > 2) { const j = Math.floor(rng() * (n - 1)); [times[j], times[j + 1]] = [times[j + 1]!, times[j]!]; } // unsorted
  else if (quirk < 0.10 && n > 2) { for (let i = 0; i < Math.min(3, n); i++) times[i] = -1 - i; } // leading negatives
  else if (quirk < 0.14 && n > 3) { const k = 1 + Math.floor(rng() * 3); const t0 = times[k]!; for (let i = 0; i < n; i++) times[i] = times[i]! - t0; } // negatives, then exactly 0
  return times;
}

function genVector(n: number): Float32Array {
  const a = new Float32Array(n * 4);
  const times = genTimes(n);
  const mode = pick(["const", "ramp", "pwl", "walk", "rand", "curve", "scale", "flip"] as const);
  const noise = pick([0, 0, 1e-5, 2e-4, 6e-4, 2e-3, 1e-2]);
  const base = [rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)];
  const slope = [rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)];
  const amp = pick([0.01, 0.1, 1, 10]);
  const sigma = pick([1e-4, 1e-3, 1e-2, 0.1]);
  const walk = [...base];
  const knots = Array.from({ length: 4 }, () => [rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)]);
  for (let i = 0; i < n; i++) {
    const t = times[i]!;
    let v: number[];
    switch (mode) {
      case "const": v = [...base]; break;
      case "ramp": v = base.map((b, c) => b + slope[c]! * t); break;
      case "pwl": { const u = (i / Math.max(1, n - 1)) * 3; const k = Math.min(2, Math.floor(u)); v = knots[k]!.map((p, c) => p + (knots[k + 1]![c]! - p) * (u - k)); break; }
      case "walk": for (let c = 0; c < 3; c++) walk[c]! += sigma * gauss(); v = [...walk]; break;
      case "rand": v = [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)]; break;
      case "curve": v = base.map((b, c) => b + amp * Math.sin(t * (2 + c) * 3)); break;
      case "scale": v = [1, 1, 1].map((b) => b + 0.0004 * gauss() * (rng() < 0.5 ? 1 : 0)); break;
      default: v = [rnd(-1, 1) < 0 ? -1 : 1, 1, rng() < 0.5 ? 0 : -1]; break; // "flip": signs change
    }
    a[i * 4] = t;
    for (let c = 0; c < 3; c++) a[i * 4 + 1 + c] = v[c]! + noise * gauss();
  }
  return a;
}

type Q = [number, number, number, number]; // x y z w
const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qnorm = (q: Q): Q => { const l = Math.hypot(...q) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qaxis = (axis: number[], angle: number): Q => { const l = Math.hypot(...axis) || 1; const s = Math.sin(angle / 2) / l; return [axis[0]! * s, axis[1]! * s, axis[2]! * s, Math.cos(angle / 2)]; };
const qrand = (): Q => qnorm([gauss(), gauss(), gauss(), gauss()]);
const qslerp = (a: Q, b: Q, t: number): Q => {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb: Q = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  dot = Math.abs(dot);
  if (dot > 0.9995) return qnorm([a[0] + t * (bb[0] - a[0]), a[1] + t * (bb[1] - a[1]), a[2] + t * (bb[2] - a[2]), a[3] + t * (bb[3] - a[3])]);
  const th = Math.acos(dot), s = Math.sin(th);
  const w0 = Math.sin((1 - t) * th) / s, w1 = Math.sin(t * th) / s;
  return [w0 * a[0] + w1 * bb[0], w0 * a[1] + w1 * bb[1], w0 * a[2] + w1 * bb[2], w0 * a[3] + w1 * bb[3]];
};

function genQuat(n: number): Float32Array {
  const a = new Float32Array(n * 5);
  const times = genTimes(n);
  const mode = pick(["const", "slerp", "spin", "walk", "rand", "flip", "tiny", "unnorm", "poly", "orth"] as const);
  const noise = pick([0, 0, 1e-5, 2e-4, 6e-4, 2e-3, 1e-2]);
  const q0 = qrand();
  const q1 = rng() < 0.3 ? qaxis([rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)], rnd(0, 0.01)) : qrand();
  const axis = [gauss(), gauss(), gauss()];
  const rate = pick([0.01, 0.03, 0.06, 0.2, 1, 3]);
  const tinyAngle = pick([0.0008, 0.0025, 0.004, 0.006]);
  const orthogonal: Q[] = [[0, 0, 0, 1], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
  const sigma = pick([1e-4, 1e-3, 1e-2, 0.1]);
  let walk = q0;
  const knots = [q0, qrand(), qrand(), qrand()];
  for (let i = 0; i < n; i++) {
    const t = times[i]!;
    const u = n > 1 ? i / (n - 1) : 0;
    let q: Q;
    switch (mode) {
      case "const": q = q0; break;
      case "slerp": q = qslerp(q0, q1, u); break;
      case "spin": q = qmul(qaxis(axis, rate * t), q0); break;
      case "walk": walk = qnorm(qmul(qaxis([gauss(), gauss(), gauss()], sigma * gauss()), walk)); q = walk; break;
      case "rand": q = qrand(); break;
      case "flip": q = qslerp(q0, q1, u); if (i % 2) q = [-q[0], -q[1], -q[2], -q[3]]; break;
      case "tiny": q = qmul(qaxis(axis, tinyAngle * u), q0); break;
      case "orth": { const b = pick(orthogonal); const sg = rng() < 0.5 ? 1 : -1; q = [b[0] * sg, b[1] * sg, b[2] * sg, b[3] * sg]; break; }
      case "unnorm": { const s = rnd(0.5, 2); const b = qslerp(q0, q1, u); q = [b[0] * s, b[1] * s, b[2] * s, b[3] * s]; break; }
      default: { const k = Math.min(2, Math.floor(u * 3)); q = qslerp(knots[k]!, knots[k + 1]!, u * 3 - k); break; }
    }
    if (rng() < 0.15 && mode !== "flip") q = [-q[0], -q[1], -q[2], -q[3]];
    a[i * 5] = t;
    for (let c = 0; c < 4; c++) a[i * 5 + 1 + c] = q[c]! + noise * gauss();
  }
  return a;
}

function genCase(): Case {
  const count = (): number => pick([0, 1, 2, 3, 4, 5, 8, 13, 21, 40, 80, 150]);
  const tol = fixedTol ?? pick([0.001, 0.001, 0.001, 0.0001, 0.01, 0.05]);
  const garbage = rng() < 0.7 ? [0, 0] : [Math.floor(rnd(0, 64)), Math.floor(rnd(0, 64))];
  return { kind: "synthetic", tol, signA: garbage[0]!, signB: garbage[1]!, keys: { scales: genVector(count()), translations: genVector(count()), rotations: genQuat(count()) } };
}

// ---------------------------------------------------------------------------------------------- corpus cases
async function corpusCases(step: number, withNatural: boolean): Promise<Case[]> {
  const out: Case[] = [];
  const index = await indexAllKoms();
  let k = 0;
  for (const [key, hit] of index) {
    const ext = key.slice(key.lastIndexOf(".") + 1);
    if (ext !== "X" && ext !== "Y") continue;
    const bytes = await hit.kom.read(hit.entry);
    if (!isKsmData(bytes)) continue;
    const ksm = parseKsm(bytes);
    for (const set of ksm.animation?.sets ?? []) {
      if (set.kind !== "keyframed") continue;
      for (const an of set.animations) {
        if (k++ % step !== 0) continue;
        const v3 = (keys: typeof an.scales): Float32Array => { const a = new Float32Array(keys.length * 4); keys.forEach((q, i) => { a[i * 4] = q.time; a[i * 4 + 1] = q.value[0]; a[i * 4 + 2] = q.value[1]; a[i * 4 + 3] = q.value[2]; }); return a; };
        const q4 = new Float32Array(an.rotations.length * 5);
        an.rotations.forEach((q, i) => { q4[i * 5] = q.time; q4[i * 5 + 1] = q.value[0]; q4[i * 5 + 2] = q.value[1]; q4[i * 5 + 3] = q.value[2]; q4[i * 5 + 4] = q.value[3]; });
        const keys = { scales: v3(an.scales), translations: v3(an.translations), rotations: q4 };
        out.push({ kind: `corpus ${hit.entry.name}`, tol: 0.001, signA: 0, signB: 0, keys });
        if (withNatural) out.push({ kind: `natural ${hit.entry.name}`, tol: 0.001, signA: NATURAL, signB: NATURAL, keys });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- oracle I/O
function runOracle(cases: Case[]): KeyArrays[] {
  const dir = mkdtempSync(join(tmpdir(), "okeys-"));
  try {
    writeFileSync(join(dir, "cases.bin"), encodeCases(cases));
    const r = spawnSync("python3", [join(import.meta.dir, "oracle-optimizekeys.py"), join(dir, "cases.bin"), join(dir, "results.bin")], { encoding: "utf8", env: { ...process.env, ELS_PYLIBS: process.env.ELS_PYLIBS ?? "/home/user/work/pycap" } });
    if (r.status !== 0) throw new Error(`oracle failed (${r.status}): ${r.stderr}`);
    console.log(`oracle: ${r.stderr.trim()}`);
    return decodeResults(readFileSync(join(dir, "results.bin")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------- compare
const t0 = performance.now();
const cases: Case[] = [];
for (let i = 0; i < nSynthetic; i++) cases.push(genCase());
if (corpusStep > 0) cases.push(...(await corpusCases(corpusStep, natural)));
console.log(`${cases.length} cases (${nSynthetic} synthetic) prepared in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const results = runOracle(cases);
const stat: Record<string, { cases: number; bad: number; keysIn: number; keysOut: number }> = {};
const problems: string[] = [];
const failing: { i: number; size: number }[] = [];
let naturalOff = 0, naturalCases = 0;
cases.forEach((c, i) => {
  const want = results[i]!;
  const group = c.kind.startsWith("synthetic") ? "synthetic" : c.kind.startsWith("natural") ? "natural" : "corpus";
  const s = (stat[group] ??= { cases: 0, bad: 0, keysIn: 0, keysOut: 0 });
  s.cases++;
  s.keysIn += (c.keys.scales.length / 4 + c.keys.translations.length / 4 + c.keys.rotations.length / 5);
  s.keysOut += (want.scales.length / 4 + want.translations.length / 4 + want.rotations.length / 5);
  if (c.signA === NATURAL) {
    // the oracle's own stack garbage: does it differ from the zero-initialised accumulators the port uses?
    const got = optimizeKeys(c.keys, c.tol);
    naturalCases++;
    if (got.scales.length !== want.scales.length) naturalOff++;
    for (const [name, g, w, stride] of [["translations", got.translations, want.translations, 4], ["rotations", got.rotations, want.rotations, 5]] as const) {
      const d = firstDiff(g, w, stride);
      if (d) { s.bad++; problems.push(`${c.kind} ${name}: ${d}`); }
    }
    return;
  }
  const got = optimizeKeys(c.keys, c.tol, { signBits: { a: c.signA, b: c.signB } });
  const diffs: string[] = [];
  for (const [name, g, w, stride] of [["scales", got.scales, want.scales, 4], ["translations", got.translations, want.translations, 4], ["rotations", got.rotations, want.rotations, 5]] as const) {
    const d = firstDiff(g, w, stride);
    if (d) diffs.push(`${name}: ${d}`);
  }
  if (diffs.length) { failing.push({ i, size: c.keys.scales.length + c.keys.translations.length + c.keys.rotations.length }); s.bad++; problems.push(`${c.kind} #${i} tol ${c.tol} sign ${c.signA},${c.signB} (${c.keys.scales.length / 4}/${c.keys.translations.length / 4}/${c.keys.rotations.length / 5} keys): ${diffs.join("; ")}`); }
});
for (const [g, s] of Object.entries(stat)) console.log(`${g}: ${s.cases} cases, ${s.bad} differ, ${s.keysIn} keys in -> ${s.keysOut} out (oracle)`);
if (naturalCases) console.log(`natural stack garbage: ${naturalOff} of ${naturalCases} corpus animations have a different scale key count than with zero-initialised accumulators`);
for (const p of problems.slice(0, verbose ? problems.length : 15)) console.log(`  DIFF ${p}`);
if (problems.length > 15 && !verbose) console.log(`  ... ${problems.length - 15} more (--verbose)`);
if (dumpFailing && failing.length) {
  const pick = failing.sort((a, b) => a.size - b.size).slice(0, dumpCount).map((f) => f.i);
  writeFileSync(dumpFailing, encodeFixture(pick.map((i) => cases[i]!), pick.map((i) => results[i]!)));
  console.log(`dumped the ${pick.length} smallest failing cases to ${dumpFailing}`);
}
if (recordTo && !problems.length) {
  // the budget is shared: 60 % synthetic cases, 40 % animations of the shipped files (small ones, in order)
  const picked: number[] = [];
  const used = { synthetic: 0, corpus: 0 };
  cases.forEach((c, i) => {
    if (c.signA === NATURAL) return;
    const group = c.kind.startsWith("synthetic") ? "synthetic" : "corpus";
    const r = results[i]!;
    const size = 24 + 12 + 4 * (c.keys.scales.length + c.keys.translations.length + c.keys.rotations.length + r.scales.length + r.translations.length + r.rotations.length);
    if (size > 4000 || used[group] + size > budget * (group === "synthetic" ? 0.6 : 0.4)) return;
    used[group] += size; picked.push(i);
  });
  const recCases = picked.map((i) => cases[i]!), recResults = picked.map((i) => results[i]!);
  for (const f of mergeFiles) { const m = decodeFixture(new Uint8Array(readFileSync(f))); recCases.push(...m.cases); recResults.push(...m.results); }
  const bytes = encodeFixture(recCases, recResults);
  writeFileSync(recordTo, bytes);
  console.log(`recorded ${recCases.length} cases (${bytes.length} bytes) to ${recordTo}`);
}
console.log(problems.length ? `FAILED: ${problems.length} cases differ` : "ok: every case is bit-identical to the exe");
process.exit(problems.length ? 1 : 0);
