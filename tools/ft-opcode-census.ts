/**
 * Which TrueType instructions do the fonts of the HK client ever run?  Loads every glyph of every face of the seven font files (hinted, FT_LOAD_NO_BITMAP like
 * the exe) at the UI sizes and a sample of the sizes 8..48, and counts how often each handler of the bytecode interpreter (packages/freetype/src/interp.ts,
 * `ins*` methods; the fpgm and prep programs of each size run too) is entered.  Port only -- no oracle -- so it is fast.  Then the same count for the synthetic
 * fonts of packages/freetype/test/synth.ts (every glyph at the sizes and flags of tools/verify-freetype.ts' `synth` layer).
 *
 *   ./node_modules/.bin/bun run tools/ft-opcode-census.ts [--sample N]     (every N-th glyph at the sizes other than 13 / 15 / 17; default 16)
 *
 * What the shipped fonts never enter, no test made of them can pin; the synthetic fonts are there for those (docs/FINDINGS.md 17.11).
 */
import { FtFace, FtLibrary, loadGlyph, setCharSize } from "@els/freetype";
import { TtExec } from "../packages/freetype/src/interp.ts";
import { fontBytes } from "../packages/freetype/test/probe.ts";
import { SYNTH_FLAGS, SYNTH_SIZES, SYNTH_SPECS, synthFont } from "../packages/freetype/test/synth.ts";
import { dataDir } from "./komindex.ts";

const args = process.argv.slice(2);
const sample = Number(args.includes("--sample") ? args[args.indexOf("--sample") + 1] : 16);

const counts = new Map<string, number>();
const proto = TtExec.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
for (const name of Object.getOwnPropertyNames(proto)) {
  if (!/^ins[A-Z]/.test(name) || name === "insGotoCodeRange") continue;
  const orig = proto[name]!;
  counts.set(name, 0);
  proto[name] = function (this: unknown, ...a: unknown[]) {
    counts.set(name, counts.get(name)! + 1);
    return orig.apply(this, a);
  };
}

// the rounding state each call of `round` runs in, with the sign of the distance (ROUND_TO_HALF_GRID 0, TO_GRID 1, TO_DOUBLE_GRID 2, DOWN 3, UP 4, OFF 5, SUPER 6, SUPER_45 7)
const roundNames = ["half grid", "grid", "double grid", "down to grid", "up to grid", "off", "super", "super 45"];
const rounds = new Map<string, number>();
for (const name of roundNames) for (const sign of ["+", "-"]) rounds.set(`${name} ${sign}`, 0);
{
  const orig = proto.round!;
  proto.round = function (this: { funcRound: number }, ...a: unknown[]) {
    const key = `${roundNames[this.funcRound] ?? this.funcRound} ${(a[0] as number) >= 0 ? "+" : "-"}`;
    rounds.set(key, (rounds.get(key) ?? 0) + 1);
    return orig.apply(this, a);
  };
}

const files: [string, number][] = [
  ["dft_p7.ttc", 0],
  ["dft_p7.ttc", 1],
  ["dft_p7u.ttf", 0],
  ["msjh.ttf", 0],
  ["msjhbd.ttf", 0],
  ["h2hdrm.ttf", 0],
  ["2002lkog.ttf", 0],
  ["kom:datai022.kom:gulim.ttc", 0],
  ["kom:datai022.kom:gulim.ttc", 1],
  ["kom:datai022.kom:gulim.ttc", 2],
  ["kom:datai022.kom:gulim.ttc", 3],
];
const uiSizes = [13, 15, 17];
const allSizes = Array.from({ length: 41 }, (_, i) => 8 + i);
const t0 = Date.now();
let loads = 0;
let failed = 0;
const bytes = new Map<string, Uint8Array>();
for (const [file, index] of files) {
  if (!bytes.has(file)) bytes.set(file, await fontBytes(dataDir, file));
  const face = FtFace.open(bytes.get(file)!, index);
  for (const size of allSizes) {
    setCharSize(face, size << 6, 0, 72, 72);
    const step = uiSizes.includes(size) ? 1 : sample;
    for (let g = 0; g < face.numGlyphs; g += step) {
      if (loadGlyph(face, g, 8)) failed++;
      loads++;
    }
  }
  console.error(`${file} #${index}: ${face.numGlyphs} glyphs, ${loads} loads so far (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
const names = [...counts.keys()].sort();
const never = names.filter((n) => counts.get(n) === 0);
console.log(`${loads} glyph loads (${failed} refused by the loader), ${names.length} instruction handlers, ${names.length - never.length} entered, ${never.length} never`);
for (const n of names) console.log(`${n.padEnd(14)} ${counts.get(n)}`);
console.log(`never entered: ${never.join(" ")}`);
console.log(`rounding: ${[...rounds].map(([k, v]) => `${k} ${v}`).join(", ")}`);

// the synthetic fonts, in one library, in the order of tools/verify-freetype.ts
const shipped = new Map(counts);
for (const n of names) counts.set(n, 0);
let synthLoads = 0;
let synthRefused = 0;
const lib = new FtLibrary();
const synthFaces = SYNTH_SPECS.map((spec) => FtFace.open(synthFont(spec).bytes, 0, lib));
synthFaces.forEach((face) => {
  for (const size of SYNTH_SIZES) {
    for (const flags of SYNTH_FLAGS) {
      setCharSize(face, size << 6, 0, 72, 72);
      for (let g = 0; g < face.numGlyphs; g++) {
        if (loadGlyph(face, g, flags)) synthRefused++;
        synthLoads++;
      }
    }
  }
});
const synthNever = names.filter((n) => counts.get(n) === 0);
console.log(`synthetic fonts: ${synthLoads} glyph loads (${synthRefused} with an error), ${names.length - synthNever.length} of ${names.length} handlers entered, never: ${synthNever.join(" ") || "none"}`);
console.log(`entered by neither: ${names.filter((n) => shipped.get(n) === 0 && counts.get(n) === 0).join(" ") || "none"}`);
console.log(`least entered by the synthetic fonts: ${names.map((n) => [n, counts.get(n)!] as const).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([n, c]) => `${n} ${c}`).join(", ")}`);
