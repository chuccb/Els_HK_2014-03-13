/**
 * How far the UI classes (`@els/ui`) carry the real `DLG_*.lua` dialog scripts.
 *
 *   bun run tools/ui-census.ts [--md docs/UI_COVERAGE.md] [--next N] [--json OUT.json]
 *
 *  1. Every script of the KOMs runs on the host layer with typed stubs (the host census, one shared Lua state, like the exe): that
 *     tells which registered methods each DLG script calls.
 *  2. Which of those methods the UI classes implement comes from the binder (`implementedMethods`, the same test as `rt.status()`).
 *     A script all of whose calls are ported is "fully ported".
 *  3. The fully ported scripts run for real, in strict mode (a registered method nobody ported is an error): each builds a dialog in a
 *     shared UI world.  The textures their controls name are checked (file in the archives, key in its UV table).  Images are loaded
 *     header-only: only their sizes matter here.
 *  4. The scripts that are not fully ported vote for the methods to port next (`greedyOrder`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_CLASSES, runCensus } from "@els/host";
import { StringTable } from "@els/assets";
import { UIWorld, greedyOrder, implementedMethods, runStrict } from "@els/ui";
import type { StrictRun } from "@els/ui";
import { indexAllKoms, KomMassFileSource } from "./komindex.ts";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const t0 = performance.now();
const lap = (what: string): void => console.error(`${what}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const index = await indexAllKoms();
const scripts = new Map<string, Uint8Array>();
for (const [name, hit] of index) if (name.endsWith(".LUA")) scripts.set(name, await hit.kom.read(hit.entry));
lap(`prefetched ${scripts.size} scripts`);

// 1. what the DLG scripts call
const all = [...scripts.keys()].sort();
const host = runCensus(scripts, all);
const dlgNames = all.filter((n) => n.startsWith("DLG_"));
const dlgOk = dlgNames.filter((n) => host.get(n)!.ok);
lap(`host census (${dlgOk.length} of ${dlgNames.length} DLG scripts run to the end on stubs)`);

// 2. what is ported
const strings = StringTable.fromEss(new Uint8Array(readFileSync(join(import.meta.dir, "..", "data", "general.ess"))));
const probe = new UIWorld({ source: { has: () => false, read: () => undefined }, strings, notPorted: "throw" });
const implemented = implementedMethods(probe.world.rt);
const needs = new Map<string, Set<string>>();
for (const n of dlgOk) needs.set(n, new Set([...host.get(n)!.calls.keys()].filter((k) => !implemented.has(k))));
const ported = [...needs].filter(([, v]) => v.size === 0).map(([n]) => n);

// 3. run them for real
const source = new KomMassFileSource(index, 64 * 1024);
await source.load(scripts.keys()); // the scripts are all resident from the start (the texture files are discovered as the scripts run)
let strict: StrictRun[] = [];
let rounds = 0;
strict = await source.settle(() => {
  rounds++;
  return runStrict({ source, strings }, ported);
});
lap(`strict run of ${ported.length} scripts (${rounds} rounds)`);
const failed = strict.filter((r) => !r.ok && !r.needsSibling);
const waiting = strict.filter((r) => r.needsSibling);
const tex = { resolved: 0, missingFile: new Map<string, string[]>(), missingKey: new Map<string, string[]>() };
for (const r of strict) {
  tex.resolved += r.textures.resolved;
  for (const t of r.textures.missingFile) (tex.missingFile.get(t) ?? tex.missingFile.set(t, []).get(t)!).push(r.name);
  for (const t of r.textures.missingKey) (tex.missingKey.get(t) ?? tex.missingKey.set(t, []).get(t)!).push(r.name);
}

// drawing: which control classes the dialogs hold, and which of them have a ported OnFrameRender (the others are still counted as not drawn)
const okRuns = strict.filter((r) => r.ok);
const classUse = new Map<string, { dialogs: number; controls: number }>();
const undrawnClasses = new Set<string>();
for (const r of okRuns) {
  for (const [k, n] of Object.entries(r.classes)) {
    const e = classUse.get(k) ?? classUse.set(k, { dialogs: 0, controls: 0 }).get(k)!;
    e.dialogs++;
    e.controls += n;
  }
  for (const k of r.undrawn) undrawnClasses.add(k);
}
const allClassesDrawn = okRuns.filter((r) => r.undrawn.length === 0).length;

// 4. what to port next
const next = greedyOrder(needs);
const calledBy = new Map<string, number>();
for (const n of dlgOk) for (const k of host.get(n)!.calls.keys()) calledBy.set(k, (calledBy.get(k) ?? 0) + 1);

console.log(`DLG scripts: ${dlgNames.length}; run to the end on stubs: ${dlgOk.length}; fully ported: ${ported.length}`);
console.log(`strict run of the ported ones: ${strict.filter((r) => r.ok).length} ok, ${failed.length} failed, ${waiting.length} wait for a sibling script that defines a global they use (${[...new Set(waiting.map((r) => /global '([^']+)'/.exec(r.error!)?.[1]))].join(", ")})`);
for (const r of failed.slice(0, 20)) console.log(`  FAILED ${r.name}: ${r.error}`);
console.log(`drawing: ${allClassesDrawn} of ${okRuns.length} dialogs hold only control classes whose OnFrameRender is ported; not ported: ${[...undrawnClasses].sort().join(", ")}`);
console.log(`textures named by those dialogs: ${tex.resolved} resolved, ${[...tex.missingFile.values()].reduce((a, b) => a + b.length, 0)} references to files that do not open (${tex.missingFile.size} distinct), ${[...tex.missingKey.values()].reduce((a, b) => a + b.length, 0)} references to keys the TET lacks (${tex.missingKey.size} distinct)`);
for (const [t, by] of [...tex.missingFile].slice(0, 10)) console.log(`  no file ${t} (${by.length}: ${by.slice(0, 3).join(" ")})`);
for (const [t, by] of [...tex.missingKey].slice(0, 10)) console.log(`  no key  ${t} (${by.length}: ${by.slice(0, 3).join(" ")})`);

const show = Number(arg("--next") ?? 30);
console.log(`next methods to port (greedy; scripts fully ported after each step):`);
for (let i = 0; i < Math.min(show, next.order.length); i++) {
  const k = next.order[i]!;
  console.log(`${String(i + 1).padStart(4)} ${String(next.ported[i]!).padStart(5)}  ${k}  (${calledBy.get(k)} scripts)`);
}
if (next.order.length === 0) console.log("  (none: every script that runs on the stubs is fully ported)");
else console.log("curve:", [5, 10, 20, 30, 40, 60, 100, 140, 200, next.order.length].filter((n) => n <= next.order.length).map((n) => `${n} -> ${next.ported[n - 1]!}`).join(", "));

// per class
// distinct Lua names: the exe registers CKTDGUISlot's SetDraggingSlotColor twice (the same function), and a name is one method
const registered = new Map(HOST_CLASSES.map((c) => [c.cpp, { lua: c.lua, total: new Set(c.methods.map((m) => m.name)).size, done: 0 }]));
for (const k of implemented) {
  const cls = k.slice(0, k.lastIndexOf("."));
  const e = registered.get(cls);
  if (e) e.done++;
}

const jsonOut = arg("--json");
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify({ dlg: dlgNames.length, runOnStubs: dlgOk.length, ported: ported.length, strictFailed: failed.map((r) => r.name), order: next.order, portedCurve: next.ported }, null, 1),
  );
}

const mdOut = arg("--md");
if (mdOut) {
  let md = `# How far the UI classes carry the dialog scripts\n\n`;
  md += `Generated by \`bun run tools/ui-census.ts --md docs/UI_COVERAGE.md\` (do not edit). The real \`DLG_*.lua\` scripts of the KOMs are run on the host layer with typed stubs to find the registered methods each one calls; a script is **fully ported** when the UI classes (\`@els/ui\`) implement every one of them. Those scripts are then run for real in strict mode (a registered method nobody ported is an error) and the textures their controls name are checked against the archives.\n\n`;
  md += `| | scripts |\n|---|---:|\n`;
  md += `| \`DLG_*.lua\` in the KOMs | ${dlgNames.length} |\n`;
  md += `| run to the end on typed stubs (the others need something the HK client does not have, see HOST_CENSUS.md) | ${dlgOk.length} |\n`;
  md += `| **fully ported** (every method they call is implemented) | **${ported.length}** |\n`;
  md += `| of those, run in strict mode without an error | ${strict.filter((r) => r.ok).length} |\n`;
  md += `| of those, wait for a sibling script (a global it defines is used, the sibling is not ported yet) | ${waiting.length} |\n\n`;
  md += `## Drawing\n\nThe control classes the finished dialogs hold, by the number of dialogs that hold one, and whether the class has its own \`OnFrameRender\` (otherwise \`CKTDGUIControl\`'s counts it as not drawn). **${allClassesDrawn} of ${okRuns.length}** dialogs hold only classes that draw their pictures; the strings of Static, Button, RadioButton and ComboBox are drawn too (FINDINGS 17.13, 17.14), those of ListBox, Slot, EditBox and IMEEditBox not yet.\n\n`;
  md += `| control class | dialogs | controls | OnFrameRender |\n|---|---:|---:|---|\n`;
  for (const [k, e] of [...classUse].sort((a, b) => b[1].dialogs - a[1].dialogs || (a[0] < b[0] ? -1 : 1))) md += `| \`${k}\` | ${e.dialogs} | ${e.controls} | ${undrawnClasses.has(k) ? "not ported" : "ported"} |\n`;
  md += `\n`;
  md += `Textures named by the strict runs: ${tex.resolved} references resolve (file in the archives and key in its TET); ${tex.missingFile.size} distinct files do not open, ${tex.missingKey.size} distinct keys are not in their TET.\n\n`;
  md += `## Classes\n\n| class (Lua name) | registered | implemented | called by DLG scripts |\n|---|---:|---:|---:|\n`;
  const calledPerClass = new Map<string, number>();
  for (const k of calledBy.keys()) {
    const cls = k.slice(0, k.lastIndexOf("."));
    calledPerClass.set(cls, (calledPerClass.get(cls) ?? 0) + 1);
  }
  for (const [cls, e] of [...registered].filter(([c]) => calledPerClass.has(c) || (registered.get(c)?.done ?? 0) > 0).sort((a, b) => (calledPerClass.get(b[0]) ?? 0) - (calledPerClass.get(a[0]) ?? 0))) {
    md += `| \`${cls}\` (${e.lua}) | ${e.total} | ${e.done} | ${calledPerClass.get(cls) ?? 0} |\n`;
  }
  md += `\n## What to port next\n\nGreedy order: each step takes the method that completes the most scripts (a script that lacks \`n\` methods gives each of them \`1/n\`).\n\n`;
  md += `| step | fully ported scripts after it | method | scripts that call it |\n|---:|---:|---|---:|\n`;
  for (let i = 0; i < Math.min(80, next.order.length); i++) md += `| ${i + 1} | ${next.ported[i]!} | \`${next.order[i]}\` | ${calledBy.get(next.order[i]!)} |\n`;
  md += `\nAll ${next.order.length} remaining methods would make all ${dlgOk.length} scripts fully ported.\n`;
  writeFileSync(mdOut, md);
}
lap("done");
