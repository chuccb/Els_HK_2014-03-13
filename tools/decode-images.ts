/**
 * Decode every `.tga` / `.dds` entry of the KOMs with @els/assets and write one TSV row per entry:
 *   bun run tools/decode-images.ts --tsv out.tsv [--dump DIR --every N] [--filter REGEX]
 * Columns: name, container, format, width, height, hasAlpha, md5(RGBA) or ERROR text. `--dump` additionally writes the raw RGBA of
 * every N-th entry to DIR/NAME.rgba (width and height are in the TSV) for tools/verify-images.py to compare with Pillow.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage, sniffImage } from "@els/assets";
import { indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const tsvPath = opt("--tsv");
const dumpDir = opt("--dump");
const every = Number(opt("--every") ?? "50");
const filter = opt("--filter") ? new RegExp(opt("--filter")!, "i") : undefined;
if (dumpDir) mkdirSync(dumpDir, { recursive: true });

const index = await indexAllKoms();
const rows: string[] = [];
const counts = new Map<string, number>();
const failures: string[] = [];
let n = 0, ok = 0;
const t0 = performance.now();
for (const [key, hit] of index) {
  if (!/\.(TGA|DDS)$/.test(key)) continue;
  if (filter && !filter.test(hit.entry.name)) continue;
  n++;
  const d = await hit.kom.read(hit.entry);
  try {
    const img = decodeImage(d);
    ok++;
    const md5 = createHash("md5").update(img.rgba).digest("hex");
    rows.push([hit.entry.name, img.container, img.format, img.width, img.height, img.hasAlpha ? 1 : 0, md5].join("\t"));
    const k = `${img.container}/${img.format}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (dumpDir && n % every === 0) writeFileSync(join(dumpDir, `${hit.entry.name}.rgba`), img.rgba);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${hit.entry.name}\t${sniffImage(d) ?? "?"}\t${msg}`);
    rows.push([hit.entry.name, sniffImage(d) ?? "?", "ERROR", 0, 0, 0, msg].join("\t"));
  }
}
if (tsvPath) writeFileSync(tsvPath, rows.join("\n") + "\n");
console.log(`decoded ${ok} of ${n} entries in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}\t${v}`);
console.log(`failures: ${failures.length}`);
for (const f of failures) console.log(`  ${f}`);
