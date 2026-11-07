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
import { divFix, mulDiv, mulDivNoRound, mulFix } from "../packages/freetype/src/calc.ts";
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
type Json = Record<string, any>;

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
    return readFileSync(join(dir, "res.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
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
const faceInfo = (f: FtFace): Json => ({
  num_faces: f.numFaces,
  face_index: f.faceIndex,
  face_flags: f.faceFlags,
  style_flags: f.styleFlags,
  num_glyphs: f.numGlyphs,
  num_charmaps: f.charmaps.length,
  bbox: [f.bbox.xMin, f.bbox.yMin, f.bbox.xMax, f.bbox.yMax],
  units_per_EM: f.unitsPerEM,
  ascender: f.ascender,
  descender: f.descender,
  height: f.height,
  max_advance_width: f.maxAdvanceWidth,
  max_advance_height: f.maxAdvanceHeight,
  underline_position: f.underlinePosition,
  underline_thickness: f.underlineThickness,
});

const sizeInfo = (f: FtFace): Json => {
  const m = f.size.metrics;
  return { x_ppem: m.xPpem, y_ppem: m.yPpem, x_scale: m.xScale, y_scale: m.yScale, ascender: m.ascender, descender: m.descender, height: m.height, max_advance: m.maxAdvance };
};

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
  const res = runOracle({
    fonts: {},
    jobs: [
      { calc: "mulfix", args: two },
      { calc: "muldiv", args: three },
      { calc: "muldiv_no_round", args: three },
      { calc: "divfix", args: two },
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

// ------------------------------------------------------------------------------------------------------------------ main
const t0 = Date.now();
const list = await fonts();
console.log(`fonts: ${list.map((f) => f.name).join(" ")}`);
if (layers.has("calc")) calcLayer();
if (layers.has("face")) await faceLayer(list);
if (layers.has("chars")) await charsLayer(list);
console.log(`${failures === 0 ? "all layers agree" : `${failures} differences`} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures === 0 ? 0 : 1);
