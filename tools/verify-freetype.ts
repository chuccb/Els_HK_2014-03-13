/**
 * Differential test of packages/freetype (the port of FreeType 2.4.11) against the exe's own FreeType (x2.exe 0x32831000.., on the Unicorn CPU emulator,
 * tools/oracle-freetype.py):
 *
 *   pip install --target /home/user/work/pycap unicorn pefile
 *   ./node_modules/.bin/bun run tools/verify-freetype.ts [--layers calc,face,chars,unhinted,hinted,render,embolden] [--fonts A,B] [--sizes 13,15,17]
 *                                                        [--glyphs N] [--seed S] [--verbose] [--record FILE]
 *
 * One layer per piece of the library, so a failure names the piece: `calc` (FT_MulFix / MulDiv / MulDiv_No_Round / DivFix), `face` (what FT_New_Memory_Face
 * and FT_Set_Char_Size leave in the face and the size), `chars` (FT_Get_Char_Index over the whole BMP), `unhinted` (FT_Load_Glyph with FT_LOAD_NO_HINTING |
 * NO_BITMAP: the outline, metrics and advances), `hinted` (FT_LOAD_NO_BITMAP: the bytecode interpreter), `render` (FT_Render_Glyph, the pixels) and `embolden`
 * (FT_Bitmap_Copy + FT_Bitmap_Embolden).  Every number is compared exactly.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FtFace, setCharSize } from "@els/freetype";
import { bufHex, compactGlyph, faceInfo, indicesDigest, portEmbolden, portGlyph, portRaster, sha1, sizeInfo, type Json, type SynthOutline } from "../packages/freetype/test/probe.ts";
import { divFix, mulDiv, mulDivNoRound, mulFix } from "../packages/freetype/src/calc.ts";
import { sqrtFixed, vectorLength, vectorTransform } from "../packages/freetype/src/trig.ts";
import { dataDir, indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const layers = new Set((opt("--layers") ?? "calc,face,chars").split(","));
const onlyFonts = opt("--fonts")?.split(",");
const sizes = (opt("--sizes") ?? "13,15,17").split(",").map(Number);
const seed = Number(opt("--seed") ?? 1);
const verbose = args.includes("--verbose");
const charMax = Number(opt("--char-max") ?? 0xffff);

// ------------------------------------------------------------------------------------------------------------------ fonts
interface FontSpec {
  name: string;
  file: string;
  face: number;
}

async function fonts(): Promise<FontSpec[]> {
  const out: FontSpec[] = [];
  const have = (f: string) => existsSync(join(dataDir, f));
  const loose: [string, string, number][] = [
    ["DFT_P7", "dft_p7.ttc", 0],
    ["DFT_P7_1", "dft_p7.ttc", 1],
    ["DFT_P7U", "dft_p7u.ttf", 0],
    ["MSJH", "msjh.ttf", 0],
    ["MSJHBD", "msjhbd.ttf", 0],
    ["H2HDRM", "h2hdrm.ttf", 0],
    ["LKOG", "2002lkog.ttf", 0],
  ];
  for (const [name, file, face] of loose) if (have(file)) out.push({ name, file: join(dataDir, file), face });
  // GULIM.TTC only exists inside a KOM: extract it once
  const cache = join(tmpdir(), "els-freetype-fonts");
  const gulim = join(cache, "GULIM.TTC");
  if (!existsSync(gulim)) {
    const idx = await indexAllKoms();
    const e = idx.get("GULIM.TTC");
    if (e) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(cache, { recursive: true });
      writeFileSync(gulim, await e.kom.read(e.entry));
    }
  }
  if (existsSync(gulim)) for (let i = 0; i < 4; i++) out.push({ name: `GULIM_${i}`, file: gulim, face: i });
  return onlyFonts ? out.filter((f) => onlyFonts.includes(f.name)) : out;
}

// ------------------------------------------------------------------------------------------------------------------ oracle

/** the oracle's closing `stats` line of the last run (glyph count, longjmps) */
let lastStats: Json | undefined;

function runOracle(jobs: Json): Json[] {
  const dir = mkdtempSync(join(tmpdir(), "els-ftv-"));
  try {
    writeFileSync(join(dir, "jobs.json"), JSON.stringify(jobs));
    const r = spawnSync("python3", [join(import.meta.dir, "oracle-freetype.py"), join(dir, "jobs.json"), join(dir, "res.jsonl")], {
      env: { ...process.env, PYTHONPATH: process.env.PYTHONPATH ?? "/home/user/work/pycap" },
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    if (r.status !== 0) throw new Error(`oracle failed (${r.status}): ${r.stderr}`);
    const lines = readFileSync(join(dir, "res.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Json);
    lastStats = lines.find((l) => l.stats)?.stats;
    return lines.filter((l) => !l.stats);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function diff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (out.length >= 8) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${path}: length ${a.length} vs ${b.length}`);
      return;
    }
    for (let i = 0; i < a.length; i++) diff(a[i], b[i], `${path}[${i}]`, out);
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of Object.keys(a as object)) diff((a as Json)[k], (b as Json)[k], `${path}.${k}`, out);
  } else if (a !== b) out.push(`${path}: oracle ${String(a)} vs port ${String(b)}`);
}

let failures = 0;
function report(layer: string, total: number, bad: number, firsts: string[]): void {
  failures += bad;
  console.log(`${layer.padEnd(10)} ${String(total).padStart(8)} compared, ${String(bad).padStart(6)} differ`);
  for (const f of firsts.slice(0, verbose ? 40 : 6)) console.log(`   ${f}`);
}

// ------------------------------------------------------------------------------------------------------------------ the port's side
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------------------------ calc
function calcLayer(): void {
  const rnd = mulberry32(seed);
  const edge = [0, 1, -1, 2, -2, 63, 64, 65, 0x7fff, 0x8000, 0x10000, 0x7fffffff, -0x80000000, 46340, 46341, -46340, 176095, 176096, 0x40000000, 0xffff, 0x12345678, -0x12345678];
  const pick = (): number => {
    const r = rnd();
    if (r < 0.25) return edge[Math.floor(rnd() * edge.length)]!;
    if (r < 0.5) return Math.floor((rnd() - 0.5) * 2000);
    if (r < 0.75) return Math.floor((rnd() - 0.5) * 2 ** 17);
    return Math.floor((rnd() - 0.5) * 2 ** 32) | 0;
  };
  const n = 4000;
  const two = Array.from({ length: n }, () => [pick(), pick()]);
  const three = Array.from({ length: n }, () => [pick(), pick(), pick()]);
  const vt = Array.from({ length: n }, () => [pick(), pick(), pick(), pick(), pick(), pick()]);
  const res = runOracle({
    fonts: {},
    jobs: [
      { calc: "mulfix", args: two },
      { calc: "muldiv", args: three },
      { calc: "muldiv_no_round", args: three },
      { calc: "divfix", args: two },
      { calc: "sqrtfixed", args: two.map((a) => [a[0]]) },
      { calc: "veclen", args: two },
      { calc: "vtransform", args: vt },
    ],
  });
  const fns: [string, (a: number[]) => number, number[][]][] = [
    ["mulfix", (a) => mulFix(a[0]!, a[1]!), two],
    ["muldiv", (a) => mulDiv(a[0]!, a[1]!, a[2]!), three],
    ["muldiv_no_round", (a) => mulDivNoRound(a[0]!, a[1]!, a[2]!), three],
    ["divfix", (a) => divFix(a[0]!, a[1]!), two],
  ];
  for (const [i, [name, fn, cases]] of fns.entries()) {
    const want: number[] = res[i]!.results;
    const firsts: string[] = [];
    let bad = 0;
    for (let k = 0; k < cases.length; k++) {
      const got = fn(cases[k]!);
      if (got !== want[k]) {
        bad++;
        firsts.push(`${name}(${cases[k]!.join(", ")}): oracle ${want[k]} vs port ${got}`);
      }
    }
    report(`calc ${name}`, cases.length, bad, firsts);
  }
  {
    const cases = two.map((a) => a[0]!);
    const want: number[] = res[4]!.results;
    const firsts: string[] = [];
    let bad = 0;
    cases.forEach((c, k) => {
      const got = sqrtFixed(c);
      if (got !== want[k]) {
        bad++;
        firsts.push(`sqrtfixed(${c}): oracle ${want[k]} vs port ${got}`);
      }
    });
    report("calc sqrtfixed", cases.length, bad, firsts);
  }
  {
    // vector lengths: the cases an interpreter meets (small 26.6 vectors) and the whole range
    const want: number[] = res[5]!.results;
    const firsts: string[] = [];
    let bad = 0;
    two.forEach((c, k) => {
      const got = vectorLength(c[0]!, c[1]!);
      if (got !== want[k]) {
        bad++;
        firsts.push(`veclen(${c.join(", ")}): oracle ${want[k]} vs port ${got}`);
      }
    });
    report("calc veclen", two.length, bad, firsts);
  }
  {
    const want: number[][] = res[6]!.results;
    const firsts: string[] = [];
    let bad = 0;
    vt.forEach((c, k) => {
      const v = new Int32Array([c[0]!, c[1]!]);
      vectorTransform(v, 0, c[2]!, c[3]!, c[4]!, c[5]!);
      if (v[0] !== want[k]![0] || v[1] !== want[k]![1]) {
        bad++;
        firsts.push(`vtransform(${c.join(", ")}): oracle ${want[k]!.join(",")} vs port ${v[0]},${v[1]}`);
      }
    });
    report("calc vtransform", vt.length, bad, firsts);
  }
}

// ------------------------------------------------------------------------------------------------------------------ face + size
async function faceLayer(list: FontSpec[]): Promise<void> {
  const fontsJson: Json = {};
  for (const f of list) fontsJson[f.name] = { path: f.file, face: f.face };
  const jobs = list.flatMap((f) => sizes.map((s) => ({ font: f.name, size: s, flags: 10, render: null, codes: [] as number[] })));
  const res = runOracle({ fonts: fontsJson, jobs });
  const firsts: string[] = [];
  let total = 0;
  let bad = 0;
  const faces = new Map<string, FtFace>();
  for (const f of list) faces.set(f.name, FtFace.open(new Uint8Array(readFileSync(f.file)), f.face));
  for (const r of res) {
    const face = faces.get(r.font)!;
    if (r.size === undefined) {
      total++;
      const out: string[] = [];
      diff(r.info, faceInfo(face), r.font, out);
      if (out.length) {
        bad++;
        firsts.push(...out.map((o) => `face ${o}`));
      }
      continue;
    }
    total++;
    const err = setCharSize(face, r.size << 6, 0, 72, 72);
    const out: string[] = [];
    if (err !== r.set_err) out.push(`${r.font}@${r.size}: set_err oracle ${r.set_err} vs port ${err}`);
    else if (!err) {
      diff(r.metrics, sizeInfo(face), `${r.font}@${r.size}.metrics`, out);
      diff(r.info, faceInfo(face), `${r.font}@${r.size}.info`, out);
    }
    if (out.length) {
      bad++;
      firsts.push(...out);
    }
  }
  report("face+size", total, bad, firsts);
}

// ------------------------------------------------------------------------------------------------------------------ char index
async function charsLayer(list: FontSpec[]): Promise<void> {
  const fontsJson: Json = {};
  for (const f of list) fontsJson[f.name] = { path: f.file, face: f.face };
  const res = runOracle({ fonts: fontsJson, jobs: list.map((f) => ({ font: f.name, char_range: [0, charMax, 1] })) });
  const firsts: string[] = [];
  let total = 0;
  let bad = 0;
  for (const r of res) {
    if (!r.char_range) continue;
    const spec = list.find((f) => f.name === r.font)!;
    const face = FtFace.open(new Uint8Array(readFileSync(spec.file)), spec.face);
    const [lo, , step] = r.char_range as number[];
    const want: number[] = r.glyphs;
    let b = 0;
    for (let i = 0; i < want.length; i++) {
      const code = lo! + i * step!;
      const got = face.getCharIndex(code);
      total++;
      if (got !== want[i]) {
        b++;
        if (firsts.length < 40) firsts.push(`${r.font} U+${code.toString(16)}: oracle ${want[i]} vs port ${got}`);
      }
    }
    bad += b;
    if (verbose) console.log(`  ${r.font}: ${want.filter((g) => g !== 0).length} codes map to a glyph, ${b} differ`);
  }
  report("chars", total, bad, firsts);
}

// ------------------------------------------------------------------------------------------------------------------ glyphs
/** the character codes a layer loads from a font: ASCII, Latin-1, punctuation, kana, full-width forms, and strided samples of the CJK / Hangul blocks */
function codeCorpus(limit: number): number[] {
  const codes: number[] = [];
  const range = (lo: number, hi: number, step = 1) => {
    for (let c = lo; c <= hi; c += step) codes.push(c);
  };
  range(0x20, 0x7e);
  range(0xa1, 0xff, 3);
  range(0x2010, 0x2027, 2);
  range(0x2190, 0x2199);
  range(0x25a0, 0x25cf, 5);
  range(0x3000, 0x303f, 2);
  range(0x3041, 0x30ff, 7);
  range(0xff01, 0xff5e, 4);
  range(0x4e00, 0x9fa5, 41);
  range(0xac00, 0xd7a3, 97);
  range(0x3400, 0x4dbf, 311);
  range(0xf900, 0xfa2d, 17);
  // a deterministic shuffle so --glyphs N takes a mixed prefix
  const rnd = mulberry32(seed + 7);
  for (let i = codes.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [codes[i], codes[j]] = [codes[j]!, codes[i]!];
  }
  return limit > 0 ? codes.slice(0, limit) : codes;
}

const uiFonts = ["DFT_P7", "MSJH", "MSJHBD", "DFT_P7U", "GULIM_0"];

interface GlyphLayer {
  name: string;
  flags: number;
  render: number | null;
}

async function glyphLayer(list: FontSpec[], layer: GlyphLayer, limit: number): Promise<void> {
  const use = list.filter((f) => uiFonts.includes(f.name));
  const fontsJson: Json = {};
  for (const f of use) fontsJson[f.name] = { path: f.file, face: f.face };
  const codes = codeCorpus(limit);
  const jobs = use.flatMap((f) => sizes.map((s) => ({ font: f.name, size: s, flags: layer.flags, render: layer.render, codes, outline: true })));
  const t = Date.now();
  const res = runOracle({ fonts: fontsJson, jobs });
  if (verbose) console.log(`  oracle: ${res.length} lines in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  const faces = new Map<string, FtFace>();
  for (const f of use) faces.set(f.name, FtFace.open(new Uint8Array(readFileSync(f.file)), f.face));
  const firsts: string[] = [];
  let total = 0;
  let bad = 0;
  let thrown = 0;
  let missing = 0;
  let cur: { font: string; size: number } | undefined;
  for (const r of res) {
    if (r.size !== undefined && r.glyph === undefined) {
      cur = { font: r.font, size: r.size };
      const face = faces.get(r.font)!;
      setCharSize(face, r.size << 6, 0, 72, 72);
      continue;
    }
    if (r.info !== undefined || r.calc !== undefined || r.char_range !== undefined) continue;
    if (r.missing) {
      missing++;
      continue;
    }
    const face = faces.get(r.font)!;
    if (!cur || cur.font !== r.font || cur.size !== r.size) {
      cur = { font: r.font, size: r.size };
      setCharSize(face, r.size << 6, 0, 72, 72);
    }
    total++;
    const got = portGlyph(face, r.glyph, layer.flags, layer.render, true);
    if (got.thrown) {
      thrown++;
      if (firsts.length < 40) firsts.push(`${r.font}@${r.size} glyph ${r.glyph} (U+${(r.code ?? 0).toString(16)}): port threw: ${got.thrown}`);
      continue;
    }
    const out: string[] = [];
    const want: Json = { ...r };
    for (const k of ["font", "size", "code"]) delete want[k];
    if (layer.render === null) {
      delete want.render_err;
      delete got.render_err;
    }
    diff(want, got, `${r.font}@${r.size} glyph ${r.glyph} (U+${(r.code ?? 0).toString(16)})`, out);
    if (out.length) {
      bad++;
      firsts.push(...out.slice(0, 3));
    }
  }
  if (verbose) console.log(`  ${missing} codes unmapped`);
  report(`${layer.name}`, total, bad + thrown, firsts);
}

// ------------------------------------------------------------------------------------------------------------------ synthetic outlines
/** a random outline: 1-3 contours of lines, conic and cubic segments (some contours start on a conic point or end open, a few tags are garbage) */
function randomOutline(rnd: () => number, scale: number): SynthOutline {
  const lo = -Math.round(scale * 16);
  const hi = Math.round(scale * 80);
  const coord = (prev?: number): number => {
    const r = rnd();
    if (prev !== undefined) {
      if (r < 0.12) return prev; // axis-parallel segments
      if (r < 0.22) return prev + Math.floor(rnd() * 80) - 40; // tiny steps: the "flat enough" shortcuts of the curve code
    }
    const v = lo + Math.floor(rnd() * (hi - lo + 1));
    return r < 0.4 ? v & ~63 : v;
  };
  const points: number[][] = [];
  const tags: number[] = [];
  const contours: number[] = [];
  const nc = 1 + Math.floor(rnd() * 3);
  const maxSeg = scale < 20 ? 8 : scale < 100 ? 24 : 60;
  for (let c = 0; c < nc; c++) {
    let px = coord();
    let py = coord();
    const startConic = rnd() < 0.1;
    points.push([px, py]);
    tags.push(startConic ? 0 : 1);
    const add = (tag: number): void => {
      px = coord(px);
      py = coord(py);
      points.push([px, py]);
      tags.push(tag);
    };
    // valid by construction: a conic control point that has no on-curve point after it may only be followed by a line or another conic, a cubic is a pair
    // followed by its end point (only the last segment of a contour that starts on-curve may close with the bare pair)
    let openConic = startConic;
    const nseg = 2 + Math.floor(rnd() * maxSeg);
    for (let k = 0; k < nseg; k++) {
      const r = rnd();
      if (r < 0.4) {
        add(1);
        openConic = false;
      } else if (r < 0.75 || openConic) {
        add(0);
        openConic = rnd() >= 0.75;
        if (!openConic) add(1);
      } else {
        add(2);
        add(2);
        if (k < nseg - 1 || startConic || rnd() < 0.85) add(1);
      }
    }
    contours.push(points.length - 1);
  }
  if (rnd() < 0.03) tags[Math.floor(rnd() * tags.length)] = Math.floor(rnd() * 3); // a tag the decomposer may reject
  return { points, tags, contours, flags: rnd() < 0.3 ? 2 : 0 };
}

/** rectilinear outlines on (or near) the pixel grid: vertical edges exactly on the bitmap's right edge, horizontal edges on scanline borders, stair steps */
function rectilinearOutline(rnd: () => number, scale: number): SynthOutline {
  const snap = [64, 64, 32, 16, 1][Math.floor(rnd() * 5)]!;
  const c = (): number => Math.round((Math.floor(rnd() * scale * 1.2) * 64) / snap) * snap + (rnd() < 0.2 ? 64 : 0);
  const points: number[][] = [];
  const tags: number[] = [];
  const contours: number[] = [];
  const nc = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < nc; k++) {
    let x = c();
    let y = c();
    const steps = 1 + Math.floor(rnd() * 4); // a staircase of `steps` risers going right/up, then back down the left side
    const pts: number[][] = [[x, y]];
    for (let i = 0; i < steps; i++) {
      x += c() + 1;
      pts.push([x, y]);
      y += c() + 1;
      pts.push([x, y]);
    }
    pts.push([pts[0]![0]!, y]);
    for (const q of rnd() < 0.5 ? pts : pts.reverse()) {
      points.push(q);
      tags.push(1);
    }
    contours.push(points.length - 1);
  }
  return { points, tags, contours, flags: rnd() < 0.5 ? 2 : 0 };
}

/** FT_Render_Glyph of outlines no shipped font has: cubic segments, even-odd fill, garbage tags, and outlines with far more cells than the exe's pool holds */
async function rasterLayer(list: FontSpec[], perScale: number): Promise<void> {
  const f = list.find((x) => x.name === "MSJH") ?? list[0]!;
  const rnd = mulberry32(seed + 31);
  // [pixels across, share of --rasters, generator]: tiny curves (the flat-enough shortcuts), glyph sizes, and big outlines (the big ones are slow under the emulator)
  const classes: [number, number, (r: () => number, sc: number) => SynthOutline][] = [
    [1, 0.5, randomOutline],
    [2, 0.5, randomOutline],
    [6, 1, randomOutline],
    [14, 1, randomOutline],
    [30, 0.5, randomOutline],
    [80, 0.2, randomOutline],
    [200, 0.1, randomOutline],
    [8, 0.5, rectilinearOutline],
    [20, 0.5, rectilinearOutline],
  ];
  const scaleOf: string[] = [];
  const outlines: SynthOutline[] = [];
  for (const [sc, share, gen] of classes) {
    for (let i = 0, n = Math.max(1, Math.round(perScale * share)); i < n; i++) {
      outlines.push(gen(rnd, sc));
      scaleOf.push(`${gen === randomOutline ? "random" : "rectilinear"} ${sc} px`);
    }
  }
  const res = runOracle({ fonts: { [f.name]: { path: f.file, face: f.face } }, jobs: outlines.map((o) => ({ font: f.name, raster: o })) });
  const face = FtFace.open(new Uint8Array(readFileSync(f.file)), f.face);
  setCharSize(face, 16 << 6, 0, 72, 72);
  const rs = res.filter((r) => r.raster);
  const firsts: string[] = [];
  let bad = 0;
  let errs = 0;
  let empty = 0;
  rs.forEach((want, i) => {
    const got = portRaster(face, outlines[i]!);
    if (want.render_err) errs++;
    else if (!want.bitmap.rows) empty++;
    const out: string[] = [];
    diff(want, got, `outline ${i} (${scaleOf[i]})`, out);
    if (out.length) {
      bad++;
      firsts.push(...out.slice(0, 3));
    }
  });
  console.log(`  ${errs} outlines rejected (render_err), ${empty} empty bitmaps, ${lastStats?.longjmps ?? "?"} band bisections in the exe's rasterizer`);
  report("raster", rs.length, bad, firsts);
}

// ------------------------------------------------------------------------------------------------------------------ embolden
interface BitmapSpec {
  rows: number;
  width: number;
  pitch: number;
  pixel_mode: number;
  hex: string;
}

async function emboldenLayer(list: FontSpec[], count: number): Promise<void> {
  const rnd = mulberry32(seed + 53);
  // real glyph bitmaps (what FT_Render_Glyph leaves for FT_Bitmap_Copy + Embolden in CharToSystemTexture)
  const bitmaps: BitmapSpec[] = [];
  const use = list.filter((f) => ["DFT_P7", "MSJH", "GULIM_0"].includes(f.name));
  const codes = codeCorpus(0).slice(0, Math.max(10, Math.floor(count / 12)));
  const fontsJson: Json = {};
  for (const f of use) fontsJson[f.name] = { path: f.file, face: f.face };
  const real = runOracle({ fonts: fontsJson, jobs: use.flatMap((f) => sizes.map((s) => ({ font: f.name, size: s, flags: 8, render: 0, codes }))) });
  for (const r of real) if (r.bitmap && r.bitmap.rows) bitmaps.push({ rows: r.bitmap.rows, width: r.bitmap.width, pitch: r.bitmap.pitch, pixel_mode: r.bitmap.mode, hex: r.bitmap.hex });
  const realCount = bitmaps.length;
  // synthetic ones: pitch wider than the pixels, random bytes everywhere (padding too), gray and mono
  for (let i = 0; i < count; i++) {
    const mono = rnd() < 0.3;
    const width = 1 + Math.floor(rnd() * (mono ? 30 : 20));
    const rows = 1 + Math.floor(rnd() * 12);
    const pitch = (mono ? (width + 7) >> 3 : width) + Math.floor(rnd() * 7);
    const bytes = Buffer.alloc(rows * pitch);
    for (let k = 0; k < bytes.length; k++) bytes[k] = rnd() < 0.3 ? 0 : Math.floor(rnd() * 256);
    bitmaps.push({ rows, width, pitch, pixel_mode: mono ? 1 : 2, hex: bytes.toString("hex") });
  }
  const strengths = [[128, 128], [256, 256], [384, 384], [64, 64], [192, 64], [0, 128], [128, 0], [31, 31], [32, 0], [96, 96], [640, 640], [64, 0], [320, 0]];
  const jobs: Json[] = [];
  const cases: { b: BitmapSpec; x: number; y: number }[] = [];
  bitmaps.forEach((b, i) => {
    const picks = i < realCount ? strengths.slice(0, 5) : strengths;
    for (const [x, y] of picks) {
      jobs.push({ embolden: b, xstr: x, ystr: y });
      cases.push({ b, x: x!, y: y! });
    }
  });
  const res = runOracle({ fonts: {}, jobs }).filter((r) => r.embolden);
  const firsts: string[] = [];
  let bad = 0;
  res.forEach((want, i) => {
    const { b, x, y } = cases[i]!;
    const got = portEmbolden(b, x, y);
    const out: string[] = [];
    diff(want, got, `bitmap ${i >= 0 ? cases.indexOf(cases[i]!) : i} ${b.width}x${b.rows} pitch ${b.pitch} mode ${b.pixel_mode} strength (${x}, ${y})`, out);
    if (out.length) {
      bad++;
      firsts.push(...out.slice(0, 2));
    }
  });
  if (verbose) console.log(`  ${realCount} real bitmaps, ${bitmaps.length - realCount} synthetic`);
  report("embolden", res.length, bad, firsts);
}

// ------------------------------------------------------------------------------------------------------------------ fixture
/**
 * `--record FILE`: what the exe's FreeType says about a sample, written as the fixture packages/freetype/test/oracle.test.ts replays without Python:
 * face info and size metrics, the char index of U+0..U+2FFFF (as a hash), hinted and unhinted renders of a mixed sample of glyphs at 13 / 15 / 17 / 28 px,
 * emboldened bitmaps, 2,100 integer-helper cases, and synthetic outlines (cubics, even-odd, tiny curves, a pixel-grid staircase, a glyph-sized one that makes the exe bisect bands).
 */
async function record(list: FontSpec[], file: string): Promise<void> {
  const use = list.filter((f) => f.name !== "GULIM_1" && f.name !== "GULIM_2");
  const fontsJson: Json = {};
  for (const f of use) fontsJson[f.name] = { path: f.file, face: f.face };
  const recSizes = [13, 15, 17, 28];
  const codes = codeCorpus(20);
  const flagSets: [number, number][] = [[8, 0], [10, 0]];
  const rnd = mulberry32(seed + 77);
  const outlines: SynthOutline[] = [];
  const classes: [number, number, (r: () => number, sc: number) => SynthOutline][] = [
    [1, 10, randomOutline], [2, 10, randomOutline], [6, 20, randomOutline], [14, 20, randomOutline], [30, 10, randomOutline], [80, 4, randomOutline], [200, 1, randomOutline],
    [8, 15, rectilinearOutline], [20, 15, rectilinearOutline],
  ];
  for (const [sc, n, gen] of classes) for (let i = 0; i < n; i++) outlines.push(gen(rnd, sc));
  // outlines the exe refuses: three the decomposer rejects (render_err 1) and one whose contour table does not end at the last point (FT_Err_Invalid_Outline)
  const square = [[0, 0], [640, 0], [640, 640], [0, 640]];
  outlines.push(
    { points: square, tags: [2, 1, 1, 1], contours: [3], flags: 0 }, // starts on a cubic control point
    { points: square, tags: [1, 0, 2, 1], contours: [3], flags: 0 }, // a conic control point followed by a cubic one
    { points: square, tags: [1, 1, 1, 2], contours: [3], flags: 0 }, // a lone cubic control point closes the contour
    { points: square, tags: [1, 1, 1, 1], contours: [2], flags: 0 }, // the last contour ends before the last point
  );
  const jobs: Json[] = [];
  for (const f of use) for (const s of recSizes) for (const [flags, render] of flagSets) jobs.push({ font: f.name, size: s, flags, render, codes, outline: true });
  for (const f of use) jobs.push({ font: f.name, char_range: [0, 0x2ffff, 1] });
  for (const o of outlines) jobs.push({ font: "MSJH", raster: o });
  const crnd = mulberry32(seed + 5);
  const edge = [0, 1, -1, 2, -2, 63, 64, 65, 0x7fff, 0x8000, 0x10000, 0x7fffffff, -0x80000000, 46340, 46341, -46340, 176095, 176096, 0x40000000, 0xffff, 0x12345678, -0x12345678];
  const pick = (): number => {
    const r = crnd();
    if (r < 0.3) return edge[Math.floor(crnd() * edge.length)]!;
    if (r < 0.55) return Math.floor((crnd() - 0.5) * 2000);
    if (r < 0.8) return Math.floor((crnd() - 0.5) * 2 ** 17);
    return Math.floor((crnd() - 0.5) * 2 ** 32) | 0;
  };
  const calcArgs = (n: number, k: number): number[][] => Array.from({ length: n }, () => Array.from({ length: k }, pick));
  const calcKinds: [string, number][] = [["mulfix", 2], ["muldiv", 3], ["muldiv_no_round", 3], ["divfix", 2], ["sqrtfixed", 1], ["veclen", 2], ["vtransform", 6]];
  const calcJobs = calcKinds.map(([kind, k]) => ({ calc: kind, args: calcArgs(300, k) }));
  jobs.push(...calcJobs);
  const res = runOracle({ fonts: fontsJson, jobs });
  const fx: Json = { about: "recorded from x2.exe's FreeType 2.4.11 by tools/oracle-freetype.py (tools/verify-freetype.ts --record); replayed by packages/freetype/test/oracle.test.ts", fonts: {}, faces: {}, chars: [], glyphs: [], embolden: [], raster: [], calc: [] };
  for (const f of use) {
    const gulim = f.name.startsWith("GULIM");
    fx.fonts[f.name] = { file: gulim ? "kom:datai022.kom:gulim.ttc" : f.file.slice(dataDir.length + 1), face: f.face };
  }
  const bitmaps: { rows: number; width: number; pitch: number; pixel_mode: number; hex: string }[] = [];
  let sizeNow = 0;
  let flagsSeen = 0;
  let cur: [number, number] = [8, 0];
  let jobNo = 0;
  for (const r of res) {
    if (r.calc) {
      const j = calcJobs[fx.calc.length]!;
      fx.calc.push({ kind: j.calc, args: j.args, results: r.results });
    } else if (r.raster) {
      fx.raster.push({ outline: outlines[fx.raster.length], expect: r });
    } else if (r.char_range) {
      fx.chars.push({ font: r.font, range: r.char_range, ...indicesDigest(r.glyphs) });
    } else if (r.info !== undefined && r.size === undefined) {
      fx.faces[r.font] = { info: r.info, sizes: {} };
    } else if (r.size !== undefined && r.glyph === undefined) {
      sizeNow = r.size;
      flagsSeen++;
      jobNo++;
      fx.faces[r.font].sizes[r.size] = { metrics: r.metrics };
      cur = flagSets[(flagsSeen - 1) % flagSets.length]!; // the jobs go font, size, flag set
    } else if (r.glyph !== undefined && !r.missing) {
      const [flags, render] = cur;
      fx.glyphs.push({ job: jobNo, font: r.font, size: r.size ?? sizeNow, flags, render, code: r.code, glyph: r.glyph, expect: compactGlyph(r) });
      if (flags === 8 && r.bitmap?.hex && r.bitmap.rows && r.bitmap.hex.length <= 2048 && bitmaps.length < 24) bitmaps.push({ rows: r.bitmap.rows, width: r.bitmap.width, pitch: r.bitmap.pitch, pixel_mode: r.bitmap.mode, hex: r.bitmap.hex });
    }
  }
  // emboldened bitmaps: real ones at three strengths, random gray / mono ones with wide pitches at five
  const ernd = mulberry32(seed + 91);
  const synth: typeof bitmaps = [];
  for (let i = 0; i < 24; i++) {
    const mono = ernd() < 0.3;
    const width = 1 + Math.floor(ernd() * (mono ? 30 : 20));
    const rows = 1 + Math.floor(ernd() * 12);
    const pitch = (mono ? (width + 7) >> 3 : width) + Math.floor(ernd() * 7);
    const bytes = Buffer.alloc(rows * pitch);
    for (let k = 0; k < bytes.length; k++) bytes[k] = ernd() < 0.3 ? 0 : Math.floor(ernd() * 256);
    synth.push({ rows, width, pitch, pixel_mode: mono ? 1 : 2, hex: bytes.toString("hex") });
  }
  const ejobs: Json[] = [];
  for (const b of bitmaps) for (const [x, y] of [[128, 128], [256, 256], [64, 0]]) ejobs.push({ embolden: b, xstr: x, ystr: y });
  for (const b of synth) for (const [x, y] of [[128, 128], [192, 64], [0, 128], [64, 0], [31, 31]]) ejobs.push({ embolden: b, xstr: x, ystr: y });
  const eres = runOracle({ fonts: {}, jobs: ejobs }).filter((r) => r.embolden);
  eres.forEach((r, i) => fx.embolden.push({ b: ejobs[i]!.embolden, xstr: ejobs[i]!.xstr, ystr: ejobs[i]!.ystr, expect: r }));
  writeFileSync(file, JSON.stringify(fx));
  console.log(`recorded ${file}: ${Object.keys(fx.fonts).length} fonts, ${fx.glyphs.length} glyph results, ${fx.chars.length} char ranges, ${fx.raster.length} outlines, ${fx.embolden.length} emboldened bitmaps (${(JSON.stringify(fx).length / 1024).toFixed(0)} KB)`);
}

// ------------------------------------------------------------------------------------------------------------------ main
const t0 = Date.now();
const list = await fonts();
console.log(`fonts: ${list.map((f) => f.name).join(" ")}`);
if (layers.has("calc")) calcLayer();
if (layers.has("face")) await faceLayer(list);
if (layers.has("chars")) await charsLayer(list);
const recordTo = opt("--record");
if (recordTo) await record(list, recordTo);
const glyphLimit = Number(opt("--glyphs") ?? 0);
if (layers.has("unhinted")) await glyphLayer(list, { name: "unhinted", flags: 10, render: null }, glyphLimit);
if (layers.has("hinted")) await glyphLayer(list, { name: "hinted", flags: 8, render: null }, glyphLimit);
if (layers.has("render")) await glyphLayer(list, { name: "render", flags: 8, render: 0 }, glyphLimit);
const rasterCount = Number(opt("--rasters") ?? 400);
if (layers.has("raster")) await rasterLayer(list, rasterCount);
if (layers.has("embolden")) await emboldenLayer(list, rasterCount);
if (layers.has("render-unhinted")) await glyphLayer(list, { name: "render-unhinted", flags: 10, render: 0 }, glyphLimit);
console.log(`${failures === 0 ? "all layers agree" : `${failures} differences`} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures === 0 ? 0 : 1);
