/**
 * Load graph of the game scripts: which scripts does the exe itself load (string literals in x2.exe.c) and which scripts do
 * they pull in with `IncludeLua("x.lua")` or name in a string constant (data-driven loads, e.g. an NPC's AI script)?
 * Scripts that nothing names are loaded through file names that the exe composes at run time (worlds, dungeons, dialogs by
 * id) - or are dead data; the list below is therefore a lower bound of what the client runs.
 *
 *   bun run tools/script-graph.ts [--md docs/SCRIPT_GRAPH.md] [--json out.json]
 *
 * IncludeLua calls are recognised in the bytecode as  GGET r "IncludeLua" ; KSTR r+1 "name" ; CALL r  (constant names only; the
 * number of calls with a computed name is reported).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBytecode, OP, Proto } from "@els/lua";
import { dataDir, indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const mdPath = args.includes("--md") ? args[args.indexOf("--md") + 1] : undefined;
const jsonPath = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;

const index = await indexAllKoms();
const scripts = new Map<string, { name: string; includes: string[]; dynamic: number; protos: number; strings: Set<string> }>();
for (const [key, hit] of index) {
  if (!key.endsWith(".LUA")) continue;
  const root = loadBytecode(await hit.kom.read(hit.entry), { chunkname: "@" + hit.entry.name });
  const includes: string[] = [];
  const strings = new Set<string>();
  let dynamic = 0;
  let protos = 0;
  const walk = (p: Proto): void => {
    protos++;
    for (const k of p.kgc) if (typeof k === "string" && /\.lua$/i.test(k)) strings.add(k);
    for (let pc = 1; pc < p.bc.length; pc++) {
      const ins = p.bc[pc]!;
      if ((ins & 0xff) !== OP.GGET || p.kgc[ins >>> 16] !== "IncludeLua") continue;
      const A = (ins >>> 8) & 0xff;
      let found: string | undefined;
      for (let q = pc + 1; q < Math.min(pc + 8, p.bc.length); q++) {
        const n = p.bc[q]!;
        if ((n & 0xff) === OP.KSTR && ((n >>> 8) & 0xff) === A + 1) {
          found = p.kgc[n >>> 16] as string;
          break;
        }
        if ((n & 0xff) === OP.CALL && ((n >>> 8) & 0xff) === A) break;
      }
      if (found !== undefined) includes.push(found);
      else dynamic++;
    }
    for (const k of p.kgc) if (k instanceof Proto) walk(k);
  };
  walk(root);
  scripts.set(key, { name: hit.entry.name, includes, dynamic, protos, strings });
}

// roots: every "x.lua" literal of the exe's code
const src = readFileSync(join(dataDir, "x2.exe.c"), "latin1");
const roots = new Set<string>();
for (const m of src.matchAll(/^(?!\/\/).*?L?"([A-Za-z0-9_./ -]+\.lua)"/gim)) roots.add(m[1]!.toUpperCase());
const rootList = [...roots].sort();
const missingRoots = rootList.filter((r) => !scripts.has(r));

const reach = new Map<string, string>(); // script -> the root it was first reached from
const viaString = new Set<string>(); // scripts first reached through a string constant rather than IncludeLua / the exe
const missingIncludes = new Map<string, string[]>();
for (const r of rootList) {
  if (!scripts.has(r)) continue;
  const stack = [r];
  while (stack.length) {
    const cur = stack.pop()!;
    if (reach.has(cur)) continue;
    reach.set(cur, r);
    for (const inc of scripts.get(cur)!.includes) {
      const k = inc.toUpperCase();
      if (scripts.has(k)) stack.push(k);
      else (missingIncludes.get(k) ?? missingIncludes.set(k, []).get(k)!).push(cur);
    }
    // data-driven loads: a string constant that is the name of another script (e.g. an NPC's AI script in a table)
    for (const str of scripts.get(cur)!.strings) {
      const k = str.toUpperCase();
      if (scripts.has(k) && !reach.has(k)) {
        stack.push(k);
        viaString.add(k);
      }
    }
  }
}
const unreachable = [...scripts.keys()].filter((k) => !reach.has(k)).sort();
const dynamicTotal = [...scripts.values()].reduce((a, s) => a + s.dynamic, 0);
const includeTotal = [...scripts.values()].reduce((a, s) => a + s.includes.length, 0);

const prefix = (k: string): string => k.replace(/\.LUA$/, "").split(/[_0-9]/)[0]!;
const groups = new Map<string, number>();
for (const k of unreachable) groups.set(prefix(k), (groups.get(prefix(k)) ?? 0) + 1);

console.log(`scripts=${scripts.size} roots(literals in exe)=${rootList.length} (${missingRoots.length} not in any KOM) reachable=${reach.size} unreachable=${unreachable.length}`);
console.log(`reached through string constants naming a script: ${viaString.size}`);
console.log(`IncludeLua calls: constant=${includeTotal} computed=${dynamicTotal}; includes of missing scripts: ${missingIncludes.size}`);

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ roots: rootList, missingRoots, reachable: [...reach.keys()], unreachable, missingIncludes: Object.fromEntries(missingIncludes) }, null, 1));
}
if (mdPath) {
  const perRoot = new Map<string, number>();
  for (const r of reach.values()) perRoot.set(r, (perRoot.get(r) ?? 0) + 1);
  let md = "# Script load graph (generated by `tools/script-graph.ts`)\n\n";
  md += `* ${scripts.size} precompiled scripts in the KOMs; the exe's code names **${rootList.length}** \`.lua\` files itself (${missingRoots.length} of them are not in any KOM).\n`;
  md += `* ${includeTotal} \`IncludeLua("...")\` calls with a constant name, ${dynamicTotal} with a computed name (not followed).\n`;
  md += `* reachable from the exe's roots through \`IncludeLua\` or a string constant naming another script (data-driven loads such as NPC AI files): **${reach.size}** (${viaString.size} of them only through string constants); **${unreachable.length}** scripts are not referenced by name from anywhere reachable (they may still be loaded through names the exe builds at run time, e.g. \`wsprintf\` patterns: see the list below).\n\n`;
  md += "## Roots (named by the exe) with the number of scripts first reached through them\n\n| root | scripts |\n|---|---|\n";
  for (const r of rootList.filter((r) => scripts.has(r))) md += `| ${scripts.get(r)!.name} | ${perRoot.get(r) ?? 0} |\n`;
  if (missingRoots.length) md += `\nRoots missing from the KOMs: ${missingRoots.join(", ")}\n`;
  md += "\n## Unreachable scripts by name prefix\n\n| prefix | scripts |\n|---|---|\n";
  for (const [g, n] of [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) md += `| ${g} | ${n} |\n`;
  if (missingIncludes.size) {
    md += "\n## IncludeLua of scripts that do not exist in the KOMs\n\n";
    for (const [k, by] of [...missingIncludes.entries()].sort()) md += `* \`${k}\` <- ${[...new Set(by)].slice(0, 5).join(", ")}\n`;
  }
  writeFileSync(mdPath, md);
}
