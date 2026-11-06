/**
 * Generates `packages/host/src/api.generated.ts` from `docs/host_api.tsv` (which `tools/bindings.py` extracts from the decompile).
 *
 *   bun run tools/gen-host-api.ts [--check]
 *
 * The output has two halves:
 *   - data tables (`HOST_CLASSES`, `HOST_OBJECTS`, `HOST_FUNCTIONS`, `HOST_CONSTANTS`): every class with its C++ type, Lua name, bases,
 *     constructors, fields and methods (Lua name, C++ function, address, parameter / return types as the exe's `lua_tinker` templates
 *     spell them); the binder (`src/tinker.ts`) builds its metatables from them;
 *   - typed interfaces (`<Class>_Methods`): what an implementation of a class must provide, keyed by the *Lua* name. A TS class says
 *     `implements Partial<CKTDGUIDialog_Methods>` and gets arity / primitive-type checking; the binder reports which methods are still
 *     missing (`hostStatus()`), which is the phase-5 porting status.
 * `--check` regenerates in memory and fails when the committed file is stale (used by the tests).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const TSV = join(ROOT, "docs", "host_api.tsv");
const NULL_TSV = join(ROOT, "docs", "host_null_cstr.tsv");
const OUT = join(ROOT, "packages", "host", "src", "api.generated.ts");

interface Row { kind: string; luaClass: string; cppClass: string; luaName: string; cppFn: string; addr: string; sig: string; via: string }

const rows: Row[] = readFileSync(TSV, "utf8").split("\n").slice(1).filter(Boolean).map((l) => {
  const c = l.split("\t");
  return { kind: c[0]!, luaClass: c[1] ?? "", cppClass: c[2] ?? "", luaName: c[3] ?? "", cppFn: c[4] ?? "", addr: c[5] ?? "", sig: c[6] ?? "", via: c[7] ?? "" };
});

/**
 * `docs/host_null_cstr.tsv` (tools/null-cstr.py): which `const char*` parameters tolerate NULL, one character per parameter
 * (`L`: NULL reads as "", `U`: NULL means "not given").  Key: C++ class, Lua name, address of the registered function.
 */
const nullMasks = new Map<string, string>();
if (existsSync(NULL_TSV)) {
  for (const l of readFileSync(NULL_TSV, "utf8").split("\n").slice(1).filter(Boolean)) {
    const c = l.split("\t");
    nullMasks.set(`${c[0]}|${c[1]}|${parseInt(c[2]!, 16)}`, c[3]!);
  }
}

/** split at top-level commas (not inside <> () []) */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Parameter and return types of a registration. Three spellings occur in the decompile:
 *   `functor<A1,..,A8> -> R`            global function (unused trailing arguments are `void`)
 *   `mem_functor<T,A1,..,A9> -> R`      member (T is only a placeholder: identical code folded by the linker keeps one name)
 *   `R (__thiscall C::*)(A1,A2) => ...` member function pointer type given to `class_def`
 */
function parseSig(sig: string): { params: string[]; ret: string } {
  let m = /^(?:mem_)?functor<(.*)> -> (.*)$/.exec(sig);
  if (m) {
    let args = splitTop(m[1]!);
    if (sig.startsWith("mem_functor")) args = args.slice(1);
    return { params: args.filter((a) => a !== "void"), ret: m[2]!.trim() };
  }
  m = /^(.*?) \(__(?:thiscall|cdecl|stdcall|fastcall) [^)]*\)\((.*?)\)(?:const)?(?: =>.*)?$/.exec(sig);
  if (m) return { params: splitTop(m[2]!).filter((a) => a !== "void"), ret: m[1]!.trim() };
  throw new Error(`cannot parse signature: ${sig}`);
}

const cppName = (r: Row): string => r.cppFn.replace(/ \(virtual, vtable slot \d+\)$/, "");
const isVirtual = (r: Row): boolean => / \(virtual, vtable slot \d+\)$/.test(r.cppFn) || r.cppFn.startsWith("(virtual");
const q = (s: string): string => JSON.stringify(s);
const ident = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, "_");

interface Cls {
  cpp: string; lua: string; registeredIn: string;
  bases: { cpp: string; lua: string }[];
  ctors: string[][];
  fields: { name: string; type: string; offset: number; declaredIn: string }[];
  methods: { name: string; fn: string; addr: number; params: string[]; ret: string; virtual: boolean; nullCStr?: string }[];
}
const classes = new Map<string, Cls>();
const cls = (cpp: string, lua: string, via: string): Cls => {
  let c = classes.get(cpp);
  if (!c) classes.set(cpp, (c = { cpp, lua: lua || cpp, registeredIn: via, bases: [], ctors: [], fields: [], methods: [] }));
  else if (lua && c.lua === c.cpp) c.lua = lua;
  return c;
};

for (const r of rows) {
  if (!r.cppClass) continue;
  const c = cls(r.cppClass, r.luaClass, r.via);
  switch (r.kind) {
    case "base": c.bases.push({ cpp: r.cppFn, lua: r.luaName }); break;
    case "ctor": c.ctors.push(r.sig.split(",").map((s) => s.trim()).filter((s) => s && s !== "void")); break;
    case "field": {
      const m = /^(.*?) @(0x[0-9A-Fa-f]+|\d+)(?: \(declared in (.*)\))?$/.exec(r.sig);
      if (!m) throw new Error(`cannot parse field: ${r.sig}`);
      c.fields.push({ name: r.luaName, type: m[1]!, offset: Number(m[2]), declaredIn: m[3] ?? r.cppClass });
      break;
    }
    case "method": {
      const { params, ret } = parseSig(r.sig);
      const addr = r.addr ? parseInt(r.addr, 16) : 0;
      c.methods.push({ name: r.luaName, fn: cppName(r), addr, params, ret, virtual: isVirtual(r), nullCStr: nullMasks.get(`${r.cppClass}|${r.luaName}|${addr}`) });
      break;
    }
  }
}
// every base must be a class of the table (the binder resolves `__parent` by name)
for (const c of classes.values()) for (const b of c.bases) if (!classes.has(b.cpp)) cls(b.cpp, b.lua, "(base only)");

// ---- TS types of the typed interfaces -------------------------------------------------------------------------------------
type Kind = "int" | "float" | "bool" | "str" | "i64" | "table" | "vec2" | "vec3" | "color" | "handle" | "ptr" | "obj" | "void";
function kindOf(t0: string): Kind {
  const t = t0.replace(/\bconst\b/g, "").replace(/\benum\b/g, "").replace(/\s+/g, " ").trim();
  if (t === "void") return "void";
  if (t === "bool") return "bool";
  if (t === "float" || t === "double") return "float";
  if (t === "char *" || t === "std::string" || t === "std::string &" || t === "std::wstring" || t === "std::wstring &") return "str";
  if (t === "__int64" || t === "unsigned __int64") return "i64";
  if (t === "lua_tinker::table") return "table";
  if (/^D3DXVECTOR2 ?&?$/.test(t)) return "vec2";
  if (/^D3DXVECTOR3 ?&?$/.test(t)) return "vec3";
  if (/^D3DXCOLOR ?&?$/.test(t)) return "color";
  if (t.startsWith("KHandleType<")) return "handle";
  if (t.endsWith("*")) return "ptr";
  if (/^(int|unsigned int|long|unsigned long|short|unsigned short|char|unsigned char)$/.test(t)) return "int";
  if (classes.has(t.replace(/ ?&$/, ""))) return "obj"; // another registered class passed by value
  return "int"; // enums print as their own name once `enum` is stripped (e.g. `CX2Unit::UNIT_CLASS`)
}
const TS: Record<Kind, string> = {
  int: "number", float: "number", bool: "boolean", str: "string", i64: "bigint", table: "LuaTable",
  vec2: "Vec2", vec3: "Vec3", color: "Color", handle: "HostHandle", ptr: "HostObject | undefined", obj: "HostObject", void: "void",
};

let out = `// GENERATED by tools/gen-host-api.ts from docs/host_api.tsv - do not edit.
// Source: the lua_tinker registrations in data/x2.exe.c (tools/bindings.py). ${classes.size} classes, ${[...classes.values()].reduce((n, c) => n + c.methods.length, 0)} methods.
import type { LuaTable } from "@els/lua";
import type { Vec2, Vec3, Color, HostObject, HostHandle } from "./values.ts";

export interface HostMethodSpec {
  /** name the scripts use */
  readonly name: string;
  /** C++ function behind it (the decompile's name; after identical-code folding it can be a twin, see docs/HOST_API.md) */
  readonly fn: string;
  /** address of the C++ function in x2.exe (0 for virtual calls) */
  readonly addr: number;
  /** parameter types as written by the exe's lua_tinker templates (without the implicit \`this\`) */
  readonly params: readonly string[];
  readonly ret: string;
  readonly virtual: boolean;
  /**
   * one character per parameter, for the \`const char*\` ones the exe survives a NULL for (a Lua value that is no string or number reads
   * as NULL; docs/host_null_cstr.tsv): \`L\` the function converts it into a local, NULL is the empty string; \`U\` NULL means "not given"
   */
  readonly nullCStr?: string;
}
export interface HostFieldSpec { readonly name: string; readonly type: string; readonly offset: number; readonly declaredIn: string }
export interface HostClassSpec {
  /** C++ type: the key used everywhere in the binder */
  readonly cpp: string;
  /** the global name of the class table (\`class_add\`); equals \`cpp\` when the exe's registration did not reveal one */
  readonly lua: string;
  readonly registeredIn: string;
  /** C++ types of the bases (\`class_inh\`) */
  readonly bases: readonly string[];
  readonly ctors: readonly (readonly string[])[];
  readonly fields: readonly HostFieldSpec[];
  readonly methods: readonly HostMethodSpec[];
}
export interface HostObjectSpec { readonly name: string; readonly cls: string; readonly inferred: boolean; readonly registeredIn: string }
export interface HostFunctionSpec { readonly name: string; readonly fn: string; readonly addr: number; readonly params: readonly string[]; readonly ret: string }
export interface HostConstantSpec { readonly name: string; readonly value: number }

`;

out += "export const HOST_CLASSES: readonly HostClassSpec[] = [\n";
for (const c of classes.values()) {
  out += `  { cpp: ${q(c.cpp)}, lua: ${q(c.lua)}, registeredIn: ${q(c.registeredIn)}, bases: ${JSON.stringify(c.bases.map((b) => b.cpp))}, ctors: ${JSON.stringify(c.ctors)},\n`;
  out += `    fields: [${c.fields.map((f) => `{ name: ${q(f.name)}, type: ${q(f.type)}, offset: ${f.offset}, declaredIn: ${q(f.declaredIn)} }`).join(", ")}],\n`;
  out += "    methods: [\n";
  for (const m of c.methods) {
    out += `      { name: ${q(m.name)}, fn: ${q(m.fn)}, addr: 0x${m.addr.toString(16).toUpperCase()}, params: ${JSON.stringify(m.params)}, ret: ${q(m.ret)}, virtual: ${m.virtual}${m.nullCStr ? `, nullCStr: ${q(m.nullCStr)}` : ""} },\n`;
  }
  out += "    ] },\n";
}
out += "];\n\n";

// objects (global pointers) -------------------------------------------------------------------------------------------------
const objs = new Map<string, { name: string; cls: string; inferred: boolean; via: string }>();
for (const r of rows) {
  if (r.kind !== "object") continue;
  const inferred = / \(inferred\)$/.test(r.luaName);
  const name = r.luaName.replace(/ \(inferred\)$/, "");
  if (name.startsWith("<by address")) continue;
  const key = `${name}|${r.cppClass}`;
  const prev = objs.get(key);
  if (!prev) objs.set(key, { name, cls: r.cppClass, inferred, via: r.via });
  else if (prev.inferred && !inferred) { prev.inferred = false; prev.via = r.via; }
}
out += "export const HOST_OBJECTS: readonly HostObjectSpec[] = [\n";
for (const o of objs.values()) out += `  { name: ${q(o.name)}, cls: ${q(o.cls)}, inferred: ${o.inferred}, registeredIn: ${q(o.via)} },\n`;
out += "];\n\n";

out += "export const HOST_FUNCTIONS: readonly HostFunctionSpec[] = [\n";
for (const r of rows) {
  if (r.kind !== "function") continue;
  const { params, ret } = parseSig(r.sig);
  out += `  { name: ${q(r.luaName)}, fn: ${q(cppName(r))}, addr: 0x${parseInt(r.addr || "0", 16).toString(16).toUpperCase()}, params: ${JSON.stringify(params)}, ret: ${q(ret)} },\n`;
}
out += "];\n\n";

out += "export const HOST_CONSTANTS: readonly HostConstantSpec[] = [\n";
for (const r of rows) if (r.kind === "constant") out += `  { name: ${q(r.luaName)}, value: ${Number(r.sig)} },\n`;
out += "];\n\n";

// typed interfaces ----------------------------------------------------------------------------------------------------------
out += "// ---- what an implementation of each class has to provide (keyed by the Lua name) -----------------------------------------------\n";
const allNames = (cpp: string, seen = new Set<string>()): Set<string> => {
  const names = new Set<string>();
  const c = classes.get(cpp);
  if (!c || seen.has(cpp)) return names;
  seen.add(cpp);
  for (const m of c.methods) names.add(m.name);
  for (const b of c.bases) for (const n of allNames(b.cpp, seen)) names.add(n);
  return names;
};
for (const c of classes.values()) {
  // a class may register a name its base also registers (with another signature: `SetPos(vec3)` vs `SetPos(x, y, z, w)`): the own one
  // shadows the base's (meta_get finds it first), so the base's declaration is omitted from the interface
  const own = new Set(c.methods.map((m) => m.name));
  const ext = c.bases.length
    ? " extends " + c.bases.map((b) => {
      const clash = [...allNames(b.cpp)].filter((n) => own.has(n));
      return clash.length ? `Omit<${ident(b.cpp)}_Methods, ${clash.map(q).join(" | ")}>` : ident(b.cpp) + "_Methods";
    }).join(", ")
    : "";
  out += `export interface ${ident(c.cpp)}_Methods${ext} {\n`;
  const seen = new Set<string>();
  for (const m of c.methods) {
    if (seen.has(m.name)) continue; // a name registered twice: the later registration wins in the exe, one declaration is enough
    seen.add(m.name);
    const args = m.params.map((p, i) => `a${i}: ${TS[kindOf(p)]}${m.nullCStr?.[i] === "U" ? " | undefined" : ""}`).join(", ");
    const ret = TS[kindOf(m.ret)];
    out += `  /** ${m.fn}${m.addr ? " @" + m.addr.toString(16).toUpperCase() : ""} */\n  ${m.name}(${args}): ${ret};\n`;
  }
  out += "}\n";
}
out += `
/** typed view of the whole API: C++ class name -> the methods an implementation provides */
export interface HostApiMethods {
${[...classes.values()].map((c) => `  ${q(c.cpp)}: ${ident(c.cpp)}_Methods;`).join("\n")}
}
`;

if (process.argv.includes("--check")) {
  if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== out) {
    console.error("packages/host/src/api.generated.ts is stale: run `bun run tools/gen-host-api.ts`");
    process.exit(1);
  }
  console.log("api.generated.ts is up to date");
} else {
  writeFileSync(OUT, out);
  const nm = [...classes.values()].reduce((n, c) => n + c.methods.length, 0);
  console.log(`wrote ${OUT}: ${classes.size} classes, ${nm} methods, ${objs.size} objects, ${rows.filter((r) => r.kind === "function").length} functions, ${rows.filter((r) => r.kind === "constant").length} constants`);
}
