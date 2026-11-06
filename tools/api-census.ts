/**
 * Host-API census: which global names do the 4,498 game scripts read that no script ever assigns (GGET minus GSET)?
 * Those names are provided by the C++ engine (lua_tinker bindings) and are the work list for phase 5.
 * For every such global the census also lists the fields / methods the scripts access on it (`g_pLineMap:GetLineData(...)`
 * compiles to  GGET r "g_pLineMap" ; MOV r+1 r ; TGETS r+... r "GetLineData"),  tracked with a simple linear register scan.
 *
 *   bun run tools/api-census.ts [--md docs/HOST_API.md] [--json out.json]
 */
import { writeFileSync } from "node:fs";
import { loadBytecode, OP, Proto } from "@els/lua";
import { indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const mdPath = args.includes("--md") ? args[args.indexOf("--md") + 1] : undefined;
const jsonPath = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;

const index = await indexAllKoms();
const protos: { script: string; pt: Proto }[] = [];
for (const [name, hit] of index) {
  if (!name.endsWith(".LUA")) continue;
  const data = await hit.kom.read(hit.entry);
  const root = loadBytecode(data, { chunkname: "@" + hit.entry.name });
  const walk = (p: Proto): void => {
    protos.push({ script: hit.entry.name, pt: p });
    for (const k of p.kgc) if (k instanceof Proto) walk(k);
  };
  walk(root);
}

const opGGET = OP.GGET!, opGSET = OP.GSET!, opMOV = OP.MOV!, opTGETS = OP.TGETS!, opCALL = OP.CALL!, opCALLM = OP.CALLM!;
const opCALLT = OP.CALLT!, opCALLMT = OP.CALLMT!, opKNIL = OP.KNIL!, opVARG = OP.VARG!, opITERC = OP.ITERC!, opITERN = OP.ITERN!;
const opTSETS = OP.TSETS!;
// A-mode "dst" opcodes write register A
const writesA = new Set<number>(
  ["MOV", "NOT", "UNM", "LEN", "ADDVN", "SUBVN", "MULVN", "DIVVN", "MODVN", "ADDNV", "SUBNV", "MULNV", "DIVNV", "MODNV",
    "ADDVV", "SUBVV", "MULVV", "DIVVV", "MODVV", "POW", "CAT", "KSTR", "KSHORT", "KNUM", "KPRI", "UGET", "FNEW", "TNEW",
    "TDUP", "GGET", "TGETV", "TGETS", "TGETB", "ISTC", "ISFC"].map((n) => OP[n]!),
);

// ---- pass 1: defined / used globals ----
const defined = new Set<string>();
const used = new Map<string, { uses: number; scripts: Set<string> }>();
for (const { script, pt } of protos) {
  for (let pc = 1; pc < pt.bc.length; pc++) {
    const ins = pt.bc[pc]!;
    const op = ins & 0xff;
    if (op === opGSET) defined.add(pt.kgc[ins >>> 16] as string);
    else if (op === opGGET) {
      const name = pt.kgc[ins >>> 16] as string;
      let u = used.get(name);
      if (!u) used.set(name, (u = { uses: 0, scripts: new Set() }));
      u.uses++;
      u.scripts.add(script);
    }
  }
}
const external = [...used.keys()].filter((n) => !defined.has(n));

// ---- pass 2: fields accessed on external globals ----
type Acc = { calls: number; fields: Map<string, number>; setFields: Map<string, number> };
const acc = new Map<string, Acc>();
const extSet = new Set(external);
for (const { pt } of protos) {
  const targets = new Set<number>();
  for (let pc = 1; pc < pt.bc.length; pc++) {
    const ins = pt.bc[pc]!;
    const op = ins & 0xff;
    // jump-mode D operand: UCLO JMP LOOP FORI FORL ITERL ISNEXT (D at bits 16..31, bias 0x8000)
    if (op === OP.UCLO || op === OP.JMP || op === OP.LOOP || op === OP.FORI || op === OP.FORL || op === OP.ITERL || op === OP.ISNEXT) {
      targets.add(pc + (ins >>> 16) - 0x7fff);
    }
  }
  const origin: (string | undefined)[] = new Array(pt.framesize + 2).fill(undefined);
  const get = (n: string): Acc => {
    let a = acc.get(n);
    if (!a) acc.set(n, (a = { calls: 0, fields: new Map(), setFields: new Map() }));
    return a;
  };
  for (let pc = 1; pc < pt.bc.length; pc++) {
    if (targets.has(pc)) origin.fill(undefined);
    const ins = pt.bc[pc]!;
    const op = ins & 0xff;
    const A = (ins >>> 8) & 0xff;
    if (op === opGGET) {
      const name = pt.kgc[ins >>> 16] as string;
      origin[A] = extSet.has(name) ? name : undefined;
      if (extSet.has(name)) get(name);
    } else if (op === opMOV) {
      origin[A] = origin[ins >>> 16];
    } else if (op === opTGETS) {
      const B = ins >>> 24;
      const key = pt.kgc[(ins >>> 16) & 0xff] as string;
      const o = origin[B];
      if (o) {
        const f = get(o).fields;
        f.set(key, (f.get(key) ?? 0) + 1);
      }
      origin[A] = undefined;
    } else if (op === opTSETS) {
      const o = origin[(ins >>> 24)];
      if (o) {
        const key = pt.kgc[(ins >>> 16) & 0xff] as string;
        const f = get(o).setFields;
        f.set(key, (f.get(key) ?? 0) + 1);
      }
    } else if (op === opCALL || op === opCALLM) {
      const o = origin[A];
      if (o) get(o).calls++;
      const nres = ((ins >>> 24) & 0xff) - 1;
      for (let r = A; r < A + Math.max(nres, 1) && r < origin.length; r++) origin[r] = undefined;
    } else if (op === opCALLT || op === opCALLMT) {
      const o = origin[A];
      if (o) get(o).calls++;
    } else if (op === opKNIL) {
      for (let r = A; r <= (ins >>> 16) && r < origin.length; r++) origin[r] = undefined;
    } else if (op === opVARG) {
      const nres = ((ins >>> 24) & 0xff) - 1;
      for (let r = A; r < A + Math.max(nres, 1) && r < origin.length; r++) origin[r] = undefined;
    } else if (op === opITERC || op === opITERN) {
      for (let r = A; r < A + 4 && r < origin.length; r++) origin[r] = undefined;
    } else if (writesA.has(op)) {
      origin[A] = undefined;
    }
  }
}

const stdlibs = new Set(["math", "string", "table", "os", "io", "bit", "coroutine", "debug", "ipairs", "pairs", "print", "tostring",
  "tonumber", "type", "select", "unpack", "pcall", "xpcall", "error", "assert", "next", "rawget", "rawset", "setmetatable",
  "getmetatable", "require", "module", "loadstring", "collectgarbage"]);
const rows = external
  .map((n) => ({ name: n, uses: used.get(n)!.uses, scripts: used.get(n)!.scripts.size, ...(acc.get(n) ?? { calls: 0, fields: new Map(), setFields: new Map() }) }))
  .sort((a, b) => b.uses - a.uses);

const json = rows.map((r) => ({
  name: r.name, uses: r.uses, scripts: r.scripts, calls: r.calls,
  fields: Object.fromEntries([...r.fields.entries()].sort((a, b) => b[1] - a[1])),
  setFields: Object.fromEntries([...r.setFields.entries()].sort((a, b) => b[1] - a[1])),
}));
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(json, null, 1));

let md = `# Host API used by the game scripts (generated)\n\n`;
md += `Generated by \`bun run tools/api-census.ts --md docs/HOST_API.md\` from the bytecode of all ${index.size ? [...index.keys()].filter((k) => k.endsWith(".LUA")).length : 0} scripts `;
md += `(${protos.length} prototypes).\n\n`;
md += `* distinct global names read (GGET): **${used.size}**; assigned by some script (GSET): **${defined.size}**\n`;
md += `* read but **never assigned by any script** (= provided by the engine, or nil because of typos): **${external.length}**\n\n`;
md += `Fields/methods are attributed with a linear register scan (\`GGET\`/\`MOV\` -> \`TGETS\`); accesses through locals that\n`;
md += `escape the scan are not counted, so counts are lower bounds. \`calls\` = the global itself is called (constructors / functions).\n\n`;
md += `## Engine globals\n\n`;
for (const r of rows) {
  if (stdlibs.has(r.name)) continue;
  const fields = [...r.fields.entries()].sort((a, b) => b[1] - a[1]);
  const sets = [...r.setFields.entries()].sort((a, b) => b[1] - a[1]);
  md += `### \`${r.name}\`  (${r.uses} reads in ${r.scripts} scripts${r.calls ? `, ${r.calls} calls` : ""})\n`;
  if (fields.length) md += `- members read: ${fields.map(([k, v]) => `\`${k}\`${v > 1 ? `x${v}` : ""}`).join(", ")}\n`;
  if (sets.length) md += `- members written: ${sets.map(([k, v]) => `\`${k}\`${v > 1 ? `x${v}` : ""}`).join(", ")}\n`;
  md += `\n`;
}
md += `## Standard library names used\n\n`;
for (const r of rows) {
  if (!stdlibs.has(r.name)) continue;
  const fields = [...r.fields.entries()].sort((a, b) => b[1] - a[1]);
  md += `- \`${r.name}\` (${r.uses})${fields.length ? ": " + fields.map(([k, v]) => `\`${k}\`x${v}`).join(", ") : ""}\n`;
}
if (mdPath) writeFileSync(mdPath, md);
console.log(`globals read=${used.size} assigned=${defined.size} external=${external.length}`);
console.log(rows.slice(0, 15).map((r) => `${r.name}(${r.uses}, fields=${r.fields.size})`).join(" "));
