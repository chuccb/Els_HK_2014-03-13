/**
 * Decode every `data/movie/*.avi` with packages/assets/src/mpeg1.ts and compare each picture with FFmpeg's (tools/oracle-mpeg1.py):
 *
 *   bun run tools/verify-mpeg1.ts [FILE.avi ...]                  # against the hashes recorded in packages/assets/test/fixtures/mpeg1/movies.*
 *   PYTHONPATH=/home/user/work/pyav python3 tools/oracle-mpeg1.py --dump /tmp/yuv --out /tmp/oracle.json data/movie/*.avi
 *   bun run tools/verify-mpeg1.ts --hashes /tmp/oracle.json [--dump /tmp/yuv] [FILE.avi ...]   # against a fresh FFmpeg run
 *
 * With --dump (raw I420 of the oracle) the largest sample difference is reported for pictures whose CRC does not match; --none only decodes
 * (timing, picture types).  Exit code 1 when anything differs.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { Mpeg1Movie } from "../packages/assets/src/movie.ts";
import { visiblePlanes } from "../packages/assets/src/mpeg1.ts";

const args = process.argv.slice(2);
const noOracle = args.includes("--none");
if (noOracle) args.splice(args.indexOf("--none"), 1);
const opt = (name: string): string | undefined => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const hashesPath = opt("--hashes"), dumpDir = opt("--dump");
let files = args;
if (!files.length) files = readdirSync("data/movie").filter((f) => f.endsWith(".avi")).sort().map((f) => join("data/movie", f));

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

interface Reference { frames: number; crc: number[][]; types: string; width: number; height: number }
/** the recorded hashes (movies.json + movies.bin) or the full JSON written by oracle-mpeg1.py --out */
function loadOracle(): Record<string, Reference> | null {
  if (noOracle) return null;
  const out: Record<string, Reference> = {};
  if (hashesPath) {
    const full = JSON.parse(readFileSync(hashesPath, "utf8")) as Record<string, { frames: number; crc: number[][]; types: number[]; width: number; height: number }>;
    for (const [k, v] of Object.entries(full)) out[k] = { frames: v.frames, crc: v.crc, types: v.types.map((t) => "?IPBD"[t]).join(""), width: v.width, height: v.height };
    return out;
  }
  const dir = join(import.meta.dir, "..", "packages", "assets", "test", "fixtures", "mpeg1");
  const index = JSON.parse(readFileSync(join(dir, "movies.json"), "utf8")) as Record<string, { frames: number; types: string; offset: number; width: number; height: number }>;
  const bin = readFileSync(join(dir, "movies.bin"));
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (const [k, v] of Object.entries(index)) {
    out[k] = { frames: v.frames, types: v.types, width: v.width, height: v.height, crc: Array.from({ length: v.frames }, (_, n) => [0, 4, 8].map((o) => dv.getUint32(v.offset + 12 * n + o, true))) };
  }
  return out;
}
const oracle = loadOracle();
let totalFrames = 0, totalExact = 0, totalMs = 0, bad = 0;
for (const path of files) {
  const name = basename(path);
  const t0 = performance.now();
  const movie = Mpeg1Movie.open(new Uint8Array(readFileSync(path)));
  const ref = oracle?.[name];
  const yuv = dumpDir && existsSync(join(dumpDir, name + ".yuv")) ? readFileSync(join(dumpDir, name + ".yuv")) : null;
  let n = 0, exact = 0, first = -1, maxDiff = 0, firstDesc = "";
  const types = new Map<number, number>();
  for (let f = movie.next(); f; f = movie.next(), n++) {
    types.set(f.pictureType, (types.get(f.pictureType) ?? 0) + 1);
    if (!ref) continue;
    const planes = visiblePlanes(f);
    const hashes = planes.map(crc32);
    const want = ref.crc[n];
    const typeOk = ref.types[n] === "?IPBD"[f.pictureType];
    if (want && typeOk && hashes.every((h, i) => h === want[i])) { exact++; continue; }
    if (first < 0) { first = n; firstDesc = !want ? "no such picture in the oracle" : !typeOk ? `type ${"?IPBD"[f.pictureType]} want ${ref.types[n]}` : `crc ${hashes.map((h) => h.toString(16))} want ${want.map((h) => h.toString(16))}`; }
    if (yuv) {
      const frameSize = f.width * f.height + 2 * ((f.width + 1) >> 1) * ((f.height + 1) >> 1);
      let o = n * frameSize;
      for (const p of planes) { for (let i = 0; i < p.length; i++) maxDiff = Math.max(maxDiff, Math.abs(p[i]! - yuv[o + i]!)); o += p.length; }
    }
  }
  const ms = performance.now() - t0;
  totalFrames += n; totalExact += exact; totalMs += ms;
  const typeText = [...types].sort().map(([t, c]) => `${"?IPBD"[t]}:${c}`).join(" ");
  if (!ref) console.log(`${name}: ${n} pictures (${typeText}) ${ms.toFixed(0)} ms`);
  else {
    const ok = exact === n && n === ref.frames;
    if (!ok) bad++;
    console.log(`${name}: ${n}/${ref.frames} pictures (${typeText}), ${exact} identical${ok ? "" : `; first difference at picture ${first} (${firstDesc})${yuv ? `, max sample difference ${maxDiff}` : ""}`} ${ms.toFixed(0)} ms`);
  }
}
console.log(`total: ${totalFrames} pictures in ${files.length} files, ${oracle ? `${totalExact} identical to FFmpeg, ${bad} files differ, ` : ""}${(totalMs / 1000).toFixed(1)} s`);
if (bad) process.exit(1);
