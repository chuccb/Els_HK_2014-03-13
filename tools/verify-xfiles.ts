/**
 * Container check of every `.x` / `.y` entry of the KOMs:
 *   bun run tools/verify-xfiles.ts [--dump DIR --every N]
 * Classifies the entries by magic (DirectX "xof" txt / bin / bzip / tzip, KOG "KSM " skinned mesh, "KME " static mesh), inflates the
 * MSZIP ones (declared size must match, no trailing bytes) and prints the totals. `--dump` writes every N-th decompressed file
 * (DIR/NAME) for manual inspection.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "fflate";
import { decompressXFile, isCompressedXFile } from "@els/assets";
import { indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const dumpDir = opt("--dump");
const crosscheck = args.includes("--crosscheck");
const every = Number(opt("--every") ?? "200");
if (dumpDir) mkdirSync(dumpDir, { recursive: true });

const index = await indexAllKoms();
const counts = new Map<string, number>();
const errors: string[] = [];
const stats = { crossSame: 0, crossDifferent: 0, crossSkipped: 0 };
let n = 0;
for (const [key, hit] of index) {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  if (ext !== "X" && ext !== "Y") continue;
  n++;
  const d = await hit.kom.read(hit.entry);
  const magic = String.fromCharCode(...d.subarray(0, 16)).replace(/[^ -~]/g, ".");
  let kind: string;
  if (magic.startsWith("xof ")) kind = "xof " + magic.slice(8, 16);
  else if (magic.startsWith("KSM ")) kind = "KSM";
  else if (magic.startsWith("KME ")) kind = "KME";
  else kind = "other " + JSON.stringify(magic.slice(0, 8));
  const k = `${ext} ${kind}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
  if (isCompressedXFile(d)) {
    try {
      const out = decompressXFile(d);
      if (crosscheck) {
        // independent decode with fflate (chunk by chunk, previous 32 KiB as dictionary); skips entries that fflate rejects
        const ref = new Uint8Array(out.length);
        ref.set(d.subarray(0, 16));
        let o = 16, p = 20, ok = true;
        try {
          while (o < out.length) {
            const raw = d[p]! | (d[p + 1]! << 8), packed = d[p + 2]! | (d[p + 3]! << 8);
            const dictionary = o > 16 ? ref.subarray(Math.max(16, o - 32768), o) : undefined;
            ref.set(inflateSync(d.subarray(p + 6, p + 4 + packed), dictionary ? { dictionary } : undefined), o);
            o += raw; p += 4 + packed;
          }
        } catch { ok = false; stats.crossSkipped++; }
        if (ok) {
          let same = true;
          for (let i = 16; i < out.length && same; i++) if (out[i] !== ref[i]) same = false;
          if (same) stats.crossSame++; else { stats.crossDifferent++; errors.push(`${hit.entry.name}: differs from fflate`); }
        }
      }
      if (dumpDir && n % every === 0) writeFileSync(join(dumpDir, hit.entry.name), out);
    } catch (e) {
      errors.push(`${hit.entry.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (dumpDir && n % every === 0) writeFileSync(join(dumpDir, hit.entry.name), d);
}
console.log(`entries: ${n}`);
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}\t${v}`);
if (crosscheck) console.log(`fflate cross-check: identical ${stats.crossSame}, different ${stats.crossDifferent}, skipped (fflate rejects the stream) ${stats.crossSkipped}`);
console.log(`MSZIP errors: ${errors.length}`);
for (const e of errors.slice(0, 20)) console.log("  " + e);
