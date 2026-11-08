/**
 * Which glyphs tell a mutant of packages/freetype from the real thing?  (docs/FINDINGS.md 17.11)
 *
 * tools/mutate-freetype.py `--pick` hands this script a COPY of the package in which one change was made.  The script loads the glyphs of the nine
 * fixture fonts through that copy and through the digests of the unchanged package (`--baseline`), and prints the first glyphs whose result differs.  The unchanged
 * package agrees with x2.exe's own FreeType on all of these (tools/verify-freetype.ts, rule 3b), so a glyph on which the mutant differs from it is a glyph on
 * which the mutant differs from the exe: recorded in the fixture (tools/verify-freetype.ts --record reads tools/ft-picks.json) it kills the mutant in the unit
 * tests.  A mutant that no glyph of the pool tells apart cannot be killed by any test made of these fonts (it is equivalent for them): `{"none": ...}`.
 *
 *   bun run tools/ft-kill-pick.ts --write-baseline FILE [--flags 8,10]          digests of the unchanged package (FILE.8, FILE.10)
 *   bun run tools/ft-kill-pick.ts --pkg DIR --baseline FILE [--flags 8,10] [--limit 2]
 *
 * DIR holds src/ of a copy of the package (default packages/freetype).  The pool: every glyph of the nine faces at 13 / 15 / 17 px (every
 * `--ui-step`-th), a stride of `--sample` through the other sizes 8..48; flags 8 = hinted (FT_LOAD_NO_BITMAP, what the exe passes), 10 = unhinted.
 * Each difference found is checked again on a fresh face with nothing loaded before it, in both packages: the interpreter's cvt and storage are shared by
 * every load, so a difference that only the history of the scan produces is not a pick.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fontBytes } from "../packages/freetype/test/probe.ts";
import { dataDir } from "./komindex.ts";

const args = process.argv.slice(2);
const opt = (n: string, d?: string): string | undefined => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const pkgDir = resolve(opt("--pkg", join(import.meta.dir, "../packages/freetype"))!);
const baseDir = resolve(join(import.meta.dir, "../packages/freetype"));
const writeBaseline = opt("--write-baseline");
const baselineFile = writeBaseline ?? opt("--baseline");
const flagList = (opt("--flags", "8")!).split(",").map(Number);
const limit = Number(opt("--limit", "2"));
const sample = Number(opt("--sample", "16"));
const uiStep = Number(opt("--ui-step", "1"));
if (!baselineFile) throw new Error("--baseline FILE or --write-baseline FILE");

type Mod = typeof import("../packages/freetype/src/index.ts");
type Face = import("../packages/freetype/src/index.ts").FtFace;
const load = async (dir: string) => ({ ft: (await import(join(dir, "src/index.ts"))) as Mod });
const mod = await load(pkgDir);

// the nine faces of the fixture (tools/verify-freetype.ts `fonts()`)
const faceList: [string, number][] = [
  ["dft_p7.ttc", 0],
  ["dft_p7.ttc", 1],
  ["dft_p7u.ttf", 0],
  ["msjh.ttf", 0],
  ["msjhbd.ttf", 0],
  ["h2hdrm.ttf", 0],
  ["2002lkog.ttf", 0],
  ["kom:datai022.kom:gulim.ttc", 0],
  ["kom:datai022.kom:gulim.ttc", 3],
];
const uiSizes = [13, 15, 17];
const allSizes = Array.from({ length: 41 }, (_, i) => 8 + i);
const unhintedSizes = [13, 17, 28, 40];

const fileBytes = new Map<string, Uint8Array>();
for (const [f] of faceList) if (!fileBytes.has(f)) fileBytes.set(f, await fontBytes(dataDir, f));

/** a 32-bit digest of what FT_Load_Glyph left in the slot (error, metrics, advances, the outline) */
function digest(m: Mod, face: Face, g: number, flags: number): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 24) & 0xff), 0x01000193);
  };
  let err: number;
  try {
    err = m.loadGlyph(face, g, flags);
  } catch (e) {
    return 0xdead0000; // a throw is a difference too
  }
  mix(err);
  if (err) return h >>> 0;
  const s = face.glyph;
  const sm = s.metrics;
  for (const v of [sm.width, sm.height, sm.horiBearingX, sm.horiBearingY, sm.horiAdvance, sm.vertBearingX, sm.vertBearingY, sm.vertAdvance, s.linearHoriAdvance, s.linearVertAdvance, s.advance.x, s.advance.y, s.format]) mix(v);
  if (s.format === 0x6f75746c) {
    const o = s.outline;
    mix(o.nContours);
    mix(o.nPoints);
    mix(o.flags);
    for (let i = 0; i < o.nContours; i++) mix(o.contours[i]!);
    for (let i = 0; i < o.nPoints; i++) {
      mix(o.points[2 * i]!);
      mix(o.points[2 * i + 1]!);
      mix(o.tags[i]!);
    }
  }
  return h >>> 0;
}

/** the pool in a fixed order: [face index into faceList, size, glyph] */
function* pool(flags: number): Generator<[number, number, number]> {
  for (let fi = 0; fi < faceList.length; fi++) {
    const [file, index] = faceList[fi]!;
    const face = mod.ft.FtFace.open(fileBytes.get(file)!, index);
    const n = face.numGlyphs;
    const sizes = flags === 8 ? allSizes : unhintedSizes;
    for (const size of sizes) {
      const step = flags === 8 ? (uiSizes.includes(size) ? uiStep : sample) : uiStep;
      for (let g = 0; g < n; g += step) yield [fi, size, g];
    }
  }
}

function runPool(m: Mod, flags: number, visit: (fi: number, size: number, g: number, h: number) => boolean): number {
  let loads = 0;
  let cur = -1;
  let curSize = -1;
  let face: Face | null = null;
  for (const [fi, size, g] of pool(flags)) {
    if (fi !== cur || size !== curSize) {
      if (fi !== cur) face = m.FtFace.open(fileBytes.get(faceList[fi]![0])!, faceList[fi]![1]);
      cur = fi;
      curSize = size;
      m.setCharSize(face!, size << 6, 0, 72, 72);
    }
    loads++;
    if (!visit(fi, size, g, digest(m, face!, g, flags))) break;
  }
  return loads;
}

if (writeBaseline) {
  for (const flags of flagList) {
    const out: number[] = [];
    const t = Date.now();
    const loads = runPool(mod.ft, flags, (_fi, _s, _g, h) => (out.push(h), true));
    writeFileSync(`${writeBaseline}.${flags}`, Buffer.from(Uint32Array.from(out).buffer));
    console.log(`baseline flags ${flags}: ${loads} loads, ${createHash("sha1").update(Buffer.from(Uint32Array.from(out).buffer)).digest("hex").slice(0, 12)} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  }
  process.exit(0);
}

const baseMod = baseDir === pkgDir ? mod : await load(baseDir);
const iso = (m: typeof mod, fi: number, size: number, g: number, flags: number): number => {
  const [file, index] = faceList[fi]!;
  const face = m.ft.FtFace.open(fileBytes.get(file)!, index);
  m.ft.setCharSize(face, size << 6, 0, 72, 72);
  return digest(m.ft, face, g, flags);
};

const picks: { file: string; face: number; size: number; glyph: number; flags: number }[] = [];
let totalLoads = 0;
let stateful = 0;
let firstStateful: { file: string; face: number; size: number; glyph: number; flags: number } | null = null;
for (const flags of flagList) {
  const file = `${baselineFile}.${flags}`;
  if (!existsSync(file)) throw new Error(`no baseline ${file}: run --write-baseline first`);
  const raw = readFileSync(file);
  const base = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  let k = 0;
  let found = 0;
  const loads = runPool(mod.ft, flags, (fi, size, g, h) => {
    if (h !== base[k++]) {
      // only a difference that survives a fresh load counts as a pick; one that needs the loads before it (the interpreter's cvt and storage are shared) is
      // reported as `stateful`
      const a = iso(baseMod, fi, size, g, flags);
      const b = iso(mod, fi, size, g, flags);
      const at = { file: faceList[fi]![0], face: faceList[fi]![1], size, glyph: g, flags };
      if (a !== b) {
        picks.push(at);
        found++;
      } else {
        stateful++;
        firstStateful ??= at;
      }
    }
    return found < limit && stateful < 200;
  });
  totalLoads += loads;
  if (found) break;
}
if (picks.length || stateful) console.log(JSON.stringify({ picks, stateful: stateful ? { count: stateful, first: firstStateful } : undefined, loads: totalLoads }));
else console.log(JSON.stringify({ none: true, loads: totalLoads }));
