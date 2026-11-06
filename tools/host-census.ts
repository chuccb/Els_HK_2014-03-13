/**
 * Runs the real Lua scripts of the client on the host layer with TYPED STUBS (HostRuntime `notPorted: "record"`) and reports what they
 * ask of the host: which registered methods are called, how often, by how many scripts, and which scripts fail (and why).
 *
 *   bun run tools/host-census.ts [--match REGEX]  (default: every script) [--isolated] [--list] [--md OUT.md] [--json OUT.json] [--show SCRIPT]
 *
 * World, as the exe builds it (CX2Main::LoadLuaEnum 32A0D910): Enum.lua, DungeonEnum.lua, MassFileMappingList_HK.lua, StringID_def.lua;
 * `g_pMain` and the other registered globals exist; then the scripts under test (default: all 4,498; DLG_*.lua are what
 * CKTDGUIDialog::OpenScriptFile loads, each is run with `g_pUIDialog` set to a fresh dialog).
 * The exe has ONE Lua state for the whole client, so a script may use globals and functions that a sibling defined earlier
 * (`IconAni` of DLG_MAP_LOCAL_BACK, `g_pStaticJoinList` of DLG_GUILD_JOIN_LIST ...): by default all scripts share one state, in name order,
 * and the ones that fail get a second try once everybody else has run (`--isolated`: a fresh state per script, no retry).
 * Record mode returns zeros / "" / stub objects of the declared return class, so a script runs on past the calls nobody implemented yet.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_CLASSES, makeCensusWorld, runCensus } from "@els/host";
import type { ScriptRun } from "@els/host";
import { indexAllKoms } from "./komindex.ts";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const match = new RegExp(arg("--match") ?? "\\.LUA$", "i");
const t0 = performance.now();

const index = await indexAllKoms();
const scripts = new Map<string, Uint8Array>();
for (const [name, hit] of index) if (name.endsWith(".LUA")) scripts.set(name, await hit.kom.read(hit.entry));
console.error(`prefetched ${scripts.size} scripts in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const runScript = (name: string): ScriptRun => makeCensusWorld((n) => scripts.get(n)).run(name);

const names = [...scripts.keys()].filter((n) => match.test(n)).sort();
if (process.argv.includes("--list")) {
  console.log(names.join("\n"));
  process.exit(0);
}
const show = arg("--show");
if (show) {
  const r = runScript(show.toUpperCase());
  console.log(r.ok ? "ok" : `FAILED: ${r.error}`);
  console.log("included:", r.included.join(", "));
  for (const [k, v] of [...r.calls].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(6), k);
  process.exit(0);
}

const isDlg = (n: string): boolean => n.startsWith("DLG_");
const isolated = process.argv.includes("--isolated");
const final = runCensus(scripts, names, isolated);

interface Stat { calls: number; dlg: number; other: number }
const perMethod = new Map<string, Stat>();
const failures = new Map<string, string[]>(); // error with the digits blanked -> scripts
const groups = { dlg: { n: 0, ok: 0 }, other: { n: 0, ok: 0 } };
for (const n of names) {
  const r = final.get(n)!;
  const g = isDlg(n) ? groups.dlg : groups.other;
  g.n++;
  if (r.ok) g.ok++;
  else (failures.get(r.error!.replace(/\d+/g, "N")) ?? failures.set(r.error!.replace(/\d+/g, "N"), []).get(r.error!.replace(/\d+/g, "N"))!).push(n);
  for (const [k, c] of r.calls) {
    const e = perMethod.get(k) ?? perMethod.set(k, { calls: 0, dlg: 0, other: 0 }).get(k)!;
    e.calls += c;
    if (isDlg(n)) e.dlg++;
    else e.other++;
  }
}
const ok = groups.dlg.ok + groups.other.ok;
const total = (v: Stat): number => v.dlg + v.other;
const sorted = [...perMethod].sort((a, b) => total(b[1]) - total(a[1]) || b[1].calls - a[1].calls || a[0].localeCompare(b[0]));
console.log(`scripts matching ${match}: ${names.length}; ${isolated ? "isolated states" : "one shared state"}; ran to the end: ${ok}; failed: ${names.length - ok}`);
console.log(`  DLG_: ${groups.dlg.ok}/${groups.dlg.n} ran to the end; others: ${groups.other.ok}/${groups.other.n}`);
console.log(`distinct unimplemented host calls: ${perMethod.size} (${HOST_CLASSES.reduce((n, c) => n + c.methods.length, 0)} registered methods)`);

/** what a failure is about: a global that is nil, or a method of a host class that the exe does not register */
function culprit(msg: string): { name: string; kind: string } {
  let m = /attempt to (?:index|call) global '([^']+)'/.exec(msg);
  if (m) return { name: m[1]!, kind: "global" };
  m = /can't find '([^']+)' class variable/.exec(msg);
  if (m) return { name: m[1]!, kind: "method" };
  return { name: msg.replace(/^[^:]*:\d+: /, ""), kind: "other" };
}
const exe = readFileSync(join(import.meta.dir, "..", "data", "x2.exe"));
const byCulprit = new Map<string, { kind: string; scripts: string[] }>();
for (const [msg, list] of failures) {
  const c = culprit(msg);
  const e = byCulprit.get(c.name) ?? byCulprit.set(c.name, { kind: c.kind, scripts: [] }).get(c.name)!;
  e.scripts.push(...list);
}
for (const [name, e] of [...byCulprit].sort((a, b) => b[1].scripts.length - a[1].scripts.length || a[0].localeCompare(b[0]))) {
  console.log(`FAIL x${e.scripts.length} ${e.kind} '${name}' (string in x2.exe: ${exe.includes(name)}): ${e.scripts.slice(0, 5).join(" ")}`);
}
const byClass = new Map<string, { methods: number; calls: number; dlg: number; other: number }>();
for (const [k, v] of perMethod) {
  const cls = k.slice(0, k.lastIndexOf("."));
  const e = byClass.get(cls) ?? byClass.set(cls, { methods: 0, calls: 0, dlg: 0, other: 0 }).get(cls)!;
  e.methods++;
  e.calls += v.calls;
  e.dlg = Math.max(e.dlg, v.dlg);
  e.other = Math.max(e.other, v.other);
}
for (const [cls, v] of [...byClass].sort((a, b) => b[1].calls - a[1].calls).slice(0, 25)) console.log(String(v.calls).padStart(8), String(v.methods).padStart(4), cls);
console.log("top methods (scripts, calls):");
for (const [k, v] of sorted.slice(0, 40)) console.log(String(total(v)).padStart(6), String(v.calls).padStart(8), k);
console.error(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const mdOut = arg("--md");
if (mdOut) {
  const spec = new Map<string, { sig: string; addr: number }>();
  for (const c of HOST_CLASSES) for (const m of c.methods) spec.set(`${c.cpp}.${m.name}`, { sig: `(${m.params.join(", ")}) -> ${m.ret}`, addr: m.addr });
  const luaName = new Map(HOST_CLASSES.map((c) => [c.cpp, c.lua]));
  const registered = new Map(HOST_CLASSES.map((c) => [c.cpp, c.methods.length]));
  const nRegistered = HOST_CLASSES.reduce((n, c) => n + c.methods.length, 0);
  let md = `# Host API census of the scripts\n\n`;
  md += `Generated by \`bun run tools/host-census.ts --md docs/HOST_CENSUS.md\` (do not edit). It runs every Lua script of the KOMs on the host layer with typed stubs`;
  md += ` (\`HostRuntime\` \`notPorted: "record"\`: every registered method is callable, nothing is implemented, calls are counted and return a value of their declared type), ${isolated ? "each in a fresh Lua state" : "all in ONE Lua state in name order, like the exe (a script may use what a sibling defined: \`IconAni\`, \`g_pStaticJoinList\`...); a script that fails is retried once after the others"}.\n\n`;
  md += `- World: \`Enum.lua\`, \`DungeonEnum.lua\`, \`MassFileMappingList_HK.lua\`, \`StringID_def.lua\` (what \`CX2Main::LoadLuaEnum\` runs), the globals the exe publishes as stub objects, \`IncludeLua\` working, and \`g_pUIDialog\` = a new dialog for every script.\n`;
  md += `- What "runs to the end" means: the script made all its calls on the registered API without a Lua error. It says nothing about what the calls should do; that is what the implementations are for.\n\n`;
  md += `| scripts | count | run to the end | fail |\n|---|---:|---:|---:|\n`;
  md += `| \`DLG_*.lua\` (dialogs, what \`CKTDGUIDialog::OpenScriptFile\` loads) | ${groups.dlg.n} | ${groups.dlg.ok} | ${groups.dlg.n - groups.dlg.ok} |\n`;
  md += `| all others (tables, worlds, items, NPCs, skills, config...) | ${groups.other.n} | ${groups.other.ok} | ${groups.other.n - groups.other.ok} |\n`;
  md += `\n${perMethod.size} of the ${nRegistered} registered methods are called by at least one script.\n\n`;
  md += `## Scripts that fail\n\n`;
  md += `Every failure names something the script needs and the build does not have: a global nobody defines or a method the exe does not register. The check \`in x2.exe\` looks for the name as a string of x2.exe (a name the exe publishes or registers must be there): ${[...byCulprit.keys()].filter((n) => exe.includes(n)).length} of the ${byCulprit.size} are, so the C++ cannot supply the others and those scripts fail in the original as well. They belong to features and UIs that the HK client does not have (field spawns, older map and shop screens, other regions' configs) and stay in the KOMs unused.\n\n`;
  md += `| needs | kind | in x2.exe | scripts |\n|---|---|---|---|\n`;
  for (const [name, e] of [...byCulprit].sort((a, b) => b[1].scripts.length - a[1].scripts.length || a[0].localeCompare(b[0]))) {
    const shown = e.scripts.slice(0, 6).map((x) => x.replace(/\.LUA$/, "")).join(", ");
    md += `| \`${name}\` | ${e.kind} | ${exe.includes(name) ? "yes" : "no"} | ${e.scripts.length}: ${shown}${e.scripts.length > 6 ? ", ..." : ""} |\n`;
  }
  md += `\n## Classes\n\nThe scripts column is the most scripts that call one method of the class (DLG / others).\n\n`;
  md += `| class (Lua name) | registered methods | called by scripts | calls | scripts (DLG / others) |\n|---|---:|---:|---:|---:|\n`;
  for (const [cls, v] of [...byClass].sort((a, b) => b[1].calls - a[1].calls)) md += `| \`${cls}\` (${luaName.get(cls) ?? "?"}) | ${registered.get(cls) ?? "?"} | ${v.methods} | ${v.calls} | ${v.dlg} / ${v.other} |\n`;
  md += `\n## Methods\n\nBy the number of scripts that call them. \`addr\` is the function the exe registers.\n\n| scripts DLG / others | calls | method | signature | addr |\n|---:|---:|---|---|---|\n`;
  for (const [k, v] of sorted) {
    const sp = spec.get(k);
    md += `| ${v.dlg} / ${v.other} | ${v.calls} | \`${k}\` | ${sp ? "`" + sp.sig + "`" : "(field)"} | ${sp ? sp.addr.toString(16).toUpperCase() : ""} |\n`;
  }
  writeFileSync(mdOut, md);
}
const jsonOut = arg("--json");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ scripts: names.length, ok, methods: Object.fromEntries(perMethod), failures: Object.fromEntries(failures) }, null, 1));
