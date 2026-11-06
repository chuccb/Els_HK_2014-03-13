/**
 * Decode data/item.kim (the item database image, see packages/assets/src/kim.ts) from its KOM and check what the exe's accessors assume:
 *   bun run tools/verify-kim.ts [--dump FILE.json]
 * Reports id ordering, id/templet agreement, string length words vs NUL-terminated text, set-item cross references, statistics, and how
 * much of the file the decoder actually reads (anything not read is a field this port does not know about).
 */
import { writeFileSync } from "node:fs";
import { decodeItemFlags, Kim, UNIT_TYPE } from "@els/assets";
import type { KimItem } from "@els/assets";
import { indexAllKoms } from "./komindex.ts";

const dumpAt = process.argv.indexOf("--dump");
const dumpPath = dumpAt >= 0 ? process.argv[dumpAt + 1] : undefined;

const index = await indexAllKoms();
const hit = index.get("ITEM.KIM");
if (!hit) { console.error("ITEM.KIM not found in any KOM"); process.exit(1); }
const bytes = await hit.kom.read(hit.entry);
console.log(`ITEM.KIM from ${hit.komName}: ${bytes.length} bytes`);

const covered = new Uint8Array(bytes.length);
let stringReads = 0, lengthMismatch = 0;
const lengthMismatchSamples: string[] = [];
const kim = Kim.open(bytes, {
  onRead: (o, l) => covered.fill(1, o, o + l),
  onString: (o, lw, t) => {
    stringReads++;
    if (lw !== t.length) { lengthMismatch++; if (lengthMismatchSamples.length < 5) lengthMismatchSamples.push(`@${o}: length word ${lw}, text ${t.length} chars`); }
  },
});
console.log(`header: ${kim.numItems} items, ${kim.numSetIDs} set ids`);

const problems: string[] = [];
const ids = kim.itemIds();
const setIds = kim.setIds();
for (let i = 1; i < ids.length; i++) if (!(ids[i - 1]! < ids[i]!)) { problems.push(`item ids not strictly ascending at ${i}`); break; }
for (let i = 1; i < setIds.length; i++) if (!(setIds[i - 1]! < setIds[i]!)) { problems.push(`set ids not strictly ascending at ${i}`); break; }

const stats = {
  noName: 0, noDescription: 0, withStat: 0, withBuffFactors: 0, abilityEntries: 0, withAbilities: 0, withSocketOptions: 0, withRandomSocketOptions: 0,
  withParticles: 0, withMeshes: 0, withExtra: 0, withStatRel: 0, withSetID: 0, setIDMissing: 0, notInOwnSet: 0, idMismatch: 0, fashion: 0, pvp: 0, maxNameLen: 0,
  frameOffsets: 0, renderScales: 0, renderRotates: 0, commonModels: 0, commonXETs: 0, slashTraces: 0,
};
const byType = new Map<number, number>(), byGrade = new Map<number, number>(), byPos = new Map<number, number>(), byUnit = new Map<number, number>();
const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
const items: KimItem[] = [];
for (let i = 0; i < kim.numItems; i++) {
  const it = kim.itemAt(i);
  items.push(it);
  if (it.id !== ids[i]) { stats.idMismatch++; if (stats.idMismatch <= 3) problems.push(`item ${i}: templet id ${it.id} != table id ${ids[i]}`); }
  const f = decodeItemFlags(it.flags);
  if (it.name === "") stats.noName++;
  if (it.description === "") stats.noDescription++;
  stats.maxNameLen = Math.max(stats.maxNameLen, it.name.length);
  if (it.stat.baseHP || it.stat.atkPhysic || it.stat.atkMagic || it.stat.defPhysic || it.stat.defMagic) stats.withStat++;
  if (it.buffFactorIndices.length) stats.withBuffFactors++;
  if (it.specialAbilities.length) { stats.withAbilities++; stats.abilityEntries += it.specialAbilities.length; }
  if (it.socketOptions.length) stats.withSocketOptions++;
  if (it.randomSocketOptions.length) stats.withRandomSocketOptions++;
  if (it.attachedParticles.length) stats.withParticles++;
  if (it.attachedMeshes.length) stats.withMeshes++;
  if (it.frameOffsets.length + it.renderScales.length + it.renderRotates.length + it.commonItemModelNames.length + it.commonItemXETNames.length + it.slashTraces.length) stats.withExtra++;
  stats.frameOffsets += it.frameOffsets.length; stats.renderScales += it.renderScales.length; stats.renderRotates += it.renderRotates.length;
  stats.commonModels += it.commonItemModelNames.length; stats.commonXETs += it.commonItemXETNames.length; stats.slashTraces += it.slashTraces.length;
  if (it.statRelLV.baseHPRelLV || it.statRelLV.atkPhysicRelLV || it.statRelLV.atkMagicRelLV || it.statRelLV.defPhysicRelLV || it.statRelLV.defMagicRelLV) stats.withStatRel++;
  if (f.fashion) stats.fashion++;
  if ((it.flags2 & 1) !== 0) stats.pvp++;
  bump(byType, f.itemType); bump(byGrade, f.itemGrade); bump(byPos, it.eqipPosition); bump(byUnit, it.unitType);
  if (it.setID !== 0) {
    stats.withSetID++;
    const set = kim.getSet(it.setID);
    if (!set) stats.setIDMissing++;
    else if (!set.itemIDs.includes(it.id)) stats.notInOwnSet++;
  }
}

let sets = 0, setItems = 0, missingSetItems = 0, unsortedNeeds = 0, noSetName = 0, emptySets = 0;
for (let i = 0; i < kim.numSetIDs; i++) {
  const s = kim.setAt(i);
  sets++;
  if (s.setID !== setIds[i]) problems.push(`set ${i}: entry id ${s.setID} != table id ${setIds[i]}`);
  if (s.setName === "") noSetName++;
  if (s.itemIDs.length === 0) emptySets++;
  for (const id of s.itemIDs) { setItems++; if (kim.indexOfItem(id) < 0) missingSetItems++; }
  for (let k = 1; k < s.needPartsNumAndOptions.length; k++) if (s.needPartsNumAndOptions[k - 1]!.needPartsNum > s.needPartsNumAndOptions[k]!.needPartsNum) { unsortedNeeds++; break; }
}

// lookups behave like lower_bound + equality
for (const probe of [ids[0]!, ids[ids.length >> 1]!, ids[ids.length - 1]!]) if (kim.getItem(probe)?.id !== probe) problems.push(`getItem(${probe}) failed`);
if (kim.getItem(0xffffffff) !== undefined || kim.getItem(ids[0]! + 0) === undefined) problems.push("getItem boundary behaviour wrong");

// coverage: what the decoder never read. Expected: zero padding that aligns the next block, plus a few complete strings nobody refers to.
let unread = 0, paddingBytes = 0, paddingGaps = 0, orphanStrings = 0, orphanBytes = 0;
const unexplained: Array<[number, number]> = [];
for (let i = 0; i < covered.length; ) {
  if (covered[i]) { i++; continue; }
  let j = i;
  while (j < covered.length && !covered[j]) j++;
  unread += j - i;
  if (bytes.subarray(i, j).every((b) => b === 0)) { paddingGaps++; paddingBytes += j - i; }
  else {
    // does the gap consist of whole strings (u16 length, text, NUL)?
    let p = i, strings = 0;
    while (p + 4 <= j) {
      const len = bytes[p]! | (bytes[p + 1]! << 8);
      const end = p + 2 + 2 * len;
      if (len === 0 || end + 2 > j || bytes[end] !== 0 || bytes[end + 1] !== 0) break;
      p = end + 2;
      strings++;
    }
    if (p === j) { orphanStrings += strings; orphanBytes += j - i; } else unexplained.push([i, j - i]);
  }
  i = j;
}
if (unexplained.length) problems.push(`${unexplained.length} unread ranges are neither padding nor whole strings: ${JSON.stringify(unexplained.slice(0, 6))}`);

const fmt = (m: Map<number, number>) => JSON.stringify([...m].sort((a, b) => a[0] - b[0]));
console.log("stats:", JSON.stringify(stats));
console.log(`item types ${fmt(byType)}\ngrades ${fmt(byGrade)}\nequip positions ${fmt(byPos)}\nunit types ${fmt(byUnit)}`);
console.log(`sets ${sets} (items listed ${setItems}, missing from the item table ${missingSetItems}, unsorted need-parts tables ${unsortedNeeds}, without name ${noSetName}, empty ${emptySets})`);
console.log(`strings read ${stringReads}; length word != text length: ${lengthMismatch} ${lengthMismatchSamples.join("; ")}`);
console.log(`bytes never read: ${unread} of ${bytes.length} = ${paddingBytes} zero padding bytes in ${paddingGaps} gaps + ${orphanBytes} bytes of ${orphanStrings} unreferenced strings + ${unread - paddingBytes - orphanBytes} unexplained`);
for (const id of [100, 1, 250003020]) {
  const it = kim.getItem(id);
  if (it) console.log(`item ${id}:`, JSON.stringify({ name: it.name, level: it.itemLevel, price: it.price, pos: it.eqipPosition, unit: it.unitType, model: it.modelNames[0], stat: it.stat }));
}
console.log("unit type constants used by lookups:", JSON.stringify(UNIT_TYPE));
if (dumpPath) { writeFileSync(dumpPath, JSON.stringify(items)); console.log(`wrote ${dumpPath}`); }
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.slice(0, 20).join("\n  ")}` : "no structural problems");
process.exit(problems.length ? 1 : 0);
