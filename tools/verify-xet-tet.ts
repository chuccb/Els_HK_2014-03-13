/**
 * Parse every `.xet` / `.tet` of the KOMs and check the structure the exe's loaders assume:
 *   bun run tools/verify-xet-tet.ts
 * Checks: header/version accepted, table sizes fit, every string offset resolves (non-empty unless 0), name tables sorted the way
 * the exe's binary searches need them (TET: wcscmp order; XET anim data: case-insensitive), event ranges inside the event array,
 * and that the file ends exactly where the last referenced string ends (no unexplained bytes).
 */
import { parseTet, parseXet, readFormatString, TET_MAGIC, XET_MAGIC } from "@els/assets";
import { indexAllKoms } from "./komindex.ts";

const index = await indexAllKoms();
const problems: string[] = [];
const unsortedSamples: string[] = [];
const stats = { xetUnsorted: 0, xetMissedNames: 0, xet: 0, tet: 0, xetEmpty: 0, tetEmpty: 0, notFormat: 0, entries: 0, strings: 0 };
const u32 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const strEnd = (b: Uint8Array, off: number): number => off + 2 + 2 * (b[off]! | (b[off + 1]! << 8)) + 2;

for (const [key, hit] of index) {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  if (ext !== "XET" && ext !== "TET") continue;
  const b = await hit.kom.read(hit.entry);
  const name = hit.entry.name;
  const magic = b.length >= 4 ? u32(b, 0) : 0;
  if (ext === "XET") {
    stats.xet++;
    if (magic !== XET_MAGIC) { stats.notFormat++; problems.push(`${name}: XET without XET magic (first bytes ${[...b.subarray(0, 8)].join(",")}, ${b.length} bytes)`); continue; }
    const f = parseXet(b);
    if (!f) { problems.push(`${name}: parseXet rejected the file`); continue; }
    const a = u32(b, 8), n = u32(b, 12), c = u32(b, 16);
    let maxEnd = 36 + 8 * a + 16 * n + 16 * c;
    const offs: number[] = [u32(b, 20), u32(b, 28)];
    for (let i = 0; i < a; i++) offs.push(u32(b, 36 + 8 * i), u32(b, 40 + 8 * i));
    for (let i = 0; i < n; i++) offs.push(u32(b, 36 + 8 * a + 16 * i));
    for (let i = 0; i < c; i++) offs.push(u32(b, 36 + 8 * a + 16 * n + 16 * i), u32(b, 40 + 8 * a + 16 * n + 16 * i));
    for (const o of offs) {
      if (o === 0) continue;
      stats.strings++;
      if (readFormatString(b, o) === "") problems.push(`${name}: string offset ${o} does not resolve`);
      else maxEnd = Math.max(maxEnd, strEnd(b, o));
    }
    if (maxEnd !== b.length) problems.push(`${name}: referenced data ends at ${maxEnd}, file has ${b.length} bytes`);
    // the exe binary-searches AniData with _wcsicmp; some files are sorted case-sensitively and then miss entries
    const missed = f.aniData.filter((d, i) => f.aniData.findIndex((e) => e.name.toLowerCase() === d.name.toLowerCase()) === i && f.findAniDataIndex(d.name) !== i).length;
    if (missed > 0) { stats.xetUnsorted++; stats.xetMissedNames += missed; unsortedSamples.push(`${name} (${missed} of ${f.aniData.length})`); }
    for (let i = 0; i < n; i++) {
      const o = 36 + 8 * a + 16 * i;
      const num = b[o + 12]! | (b[o + 13]! << 8), first = b[o + 14]! | (b[o + 15]! << 8);
      if (first + num > c) problems.push(`${name}: AniData ${i} events ${first}+${num} exceed ${c}`);
    }
    stats.entries += a + n + c;
    if (a + n + c === 0 && f.multiStage1.blendTexName === "" && f.multiStage2.blendTexName === "") stats.xetEmpty++;
  } else {
    stats.tet++;
    if (magic !== TET_MAGIC) { stats.notFormat++; problems.push(`${name}: TET without TET magic (${b.length} bytes)`); continue; }
    const f = parseTet(b);
    if (!f) { problems.push(`${name}: parseTet rejected the file`); continue; }
    const n = u32(b, 8);
    let maxEnd = 12 + 44 * n;
    const keys: string[] = [];
    for (let i = 0; i < n; i++) {
      const o = u32(b, 12 + 4 * i);
      const s = readFormatString(b, o);
      stats.strings++;
      if (s === "") problems.push(`${name}: key offset ${o} does not resolve`);
      else maxEnd = Math.max(maxEnd, strEnd(b, o));
      keys.push(s);
    }
    if (maxEnd !== b.length) problems.push(`${name}: referenced data ends at ${maxEnd}, file has ${b.length} bytes`);
    for (let i = 1; i < keys.length; i++) {
      if (keys[i - 1]! >= keys[i]!) { problems.push(`${name}: keys not strictly sorted at ${i} (${keys[i - 1]} / ${keys[i]})`); break; }
    }
    if (f.rects.size !== n) problems.push(`${name}: ${n} entries but ${f.rects.size} distinct keys`);
    stats.entries += n;
    if (n === 0) stats.tetEmpty++;
  }
}
console.log(JSON.stringify(stats));
console.log(`problems: ${problems.length}`);
console.log(`XET files whose AniData table the exe's case-insensitive binary search cannot fully find: ${stats.xetUnsorted} (${stats.xetMissedNames} names): ${unsortedSamples.slice(0, 6).join(", ")}`);
for (const p of problems.slice(0, 40)) console.log("  " + p);
