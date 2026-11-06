/** Census of everything inside the client's KOM archives, by extension: `bun run tools/census.ts` (reads manifests only). */
import { indexAllKoms } from "./komindex.ts";

const index = await indexAllKoms();
const byExt = new Map<string, { n: number; size: number; csize: number; sample: string }>();
for (const { entry } of index.values()) {
  const dot = entry.name.lastIndexOf(".");
  const ext = dot < 0 ? "(none)" : entry.name.slice(dot + 1).toLowerCase();
  const e = byExt.get(ext) ?? { n: 0, size: 0, csize: 0, sample: entry.name };
  e.n++; e.size += entry.size; e.csize += entry.csize;
  byExt.set(ext, e);
}
const rows = [...byExt.entries()].sort((a, b) => b[1].size - a[1].size);
console.log("ext\tcount\tMiB(unpacked)\tMiB(stored)\tsample");
for (const [ext, e] of rows) console.log(`${ext}\t${e.n}\t${(e.size / 1048576).toFixed(1)}\t${(e.csize / 1048576).toFixed(1)}\t${e.sample}`);
console.log(`total entries (unique names): ${index.size}`);
