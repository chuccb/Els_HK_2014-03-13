/**
 * How much of the host API the scripts use is ported (docs/ROADMAP.md Phase 5):
 *
 *     bun run tools/host-left.ts [--list]
 *
 * Every script of the KOMs runs on the host layer with typed stubs (the host census), which says which registered methods the scripts call (the 440 of
 * docs/HOST_CENSUS.md).  A method is implemented when the TS class that `registerImpl` names for its C++ class has it (`implementedMethods`: the test of
 * `rt.status()`).  The line prints the scripts that run to the end, the called methods, how many are implemented and how many are left, in how many classes;
 * the second line is the classes with the number of methods left; `--list` also prints every method that is left.  Registered here: the UI classes (`UIWorld`)
 * and the classes of `@els/world`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCensus } from "@els/host";
import { StringTable } from "@els/assets";
import { UIWorld, implementedMethods } from "@els/ui";
import { CKTDGLineMap } from "@els/world";
import { indexAllKoms } from "./komindex.ts";

const index = await indexAllKoms();
const scripts = new Map<string, Uint8Array>();
for (const [name, hit] of index) if (name.endsWith(".LUA")) scripts.set(name, await hit.kom.read(hit.entry));
const all = [...scripts.keys()].sort();
const host = runCensus(scripts, all);

const strings = StringTable.fromEss(new Uint8Array(readFileSync(join(import.meta.dir, "..", "data", "general.ess"))));
const probe = new UIWorld({ source: { has: () => false, read: () => undefined }, strings, notPorted: "throw" });
probe.world.rt.registerImpl("CKTDGLineMap", CKTDGLineMap);
const implemented = implementedMethods(probe.world.rt);

const called = new Set<string>();
let ok = 0;
for (const name of all) {
  const run = host.get(name)!;
  if (!run.ok) continue; // a script that fails stops at a name the build does not have; what it called before is not counted
  ok++;
  for (const key of run.calls.keys()) called.add(key);
}
const left = [...called].filter((key) => !implemented.has(key)).sort();
const perClass = new Map<string, number>();
for (const key of left) perClass.set(key.split(".")[0]!, (perClass.get(key.split(".")[0]!) ?? 0) + 1);
console.log(`${ok} of ${all.length} scripts run to the end and call ${called.size} registered methods: ${called.size - left.length} implemented, ${left.length} left in ${perClass.size} classes`);
console.log([...perClass].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([cls, n]) => `${cls} ${n}`).join(", "));
if (process.argv.includes("--list")) for (const key of left) console.log(key);
