/**
 * Verifies the TypeScript KOM reader against every archive in data/:
 *   - header/manifest parse, end offset == file size
 *   - stored-bytes Adler-32 == manifest Checksum
 *   - decoded size == manifest Size
 * Expected for the 2014-03-13 HK client: 173 archives, 97,891 entries, 4,539 algorithm-2 entries, 0 failures.
 *
 *   bun run tools/verify-kom.ts [dataDir]
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { KomArchive, fileSource } from "@els/kom";

const dataDir = process.argv[2] ?? join(import.meta.dir, "..", "data");
const files = readdirSync(dataDir).filter((f) => f.toLowerCase().endsWith(".kom")).sort();

let entries = 0, algo2 = 0, noChecksum = 0, bytes = 0;
const failures: string[] = [];
const t0 = performance.now();
for (const f of files) {
  const src = fileSource(join(dataDir, f));
  const kom = await KomArchive.open(src);
  if (kom.end !== src.size) failures.push(`${f}: end offset ${kom.end} != file size ${src.size}`);
  for (const e of kom.entries) {
    entries++;
    if (e.algorithm === 2) algo2++;
    if (e.checksum === null) noChecksum++;
    const stored = await kom.readStored(e);
    if (!kom.verifyStored(e, stored)) failures.push(`${f}/${e.name}: adler32 mismatch`);
    try {
      const data = kom.decode(e, stored);
      bytes += data.length;
      if (data.length !== e.size) failures.push(`${f}/${e.name}: size ${data.length} != ${e.size}`);
    } catch (err) {
      failures.push(`${f}/${e.name}: ${(err as Error).message}`);
    }
  }
}
const sec = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`archives=${files.length} entries=${entries} algo2=${algo2} noChecksumAttr=${noChecksum} decoded=${(bytes / 1e9).toFixed(2)}GB in ${sec}s`);
if (failures.length) {
  console.log(`FAILURES: ${failures.length}`);
  for (const x of failures.slice(0, 20)) console.log("  " + x);
  process.exit(1);
}
console.log("OK: all entries verified");
