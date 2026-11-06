/**
 * `lua_tinker` as built into x2.exe, on top of `@els/lua`: the layer that makes C++ objects visible to the scripts.
 *
 * Everything here is read from the decompile (data/x2.exe.c); the lines are the Hex-Rays export, the addresses are the exe's.
 *
 * Classes (`class_add`, 32A12EA0 and its siblings): one table per class, stored as a *global named like the class* and used as the
 * metatable of the class's userdata. It carries `__name`, `__index = meta_get`, `__newindex = meta_set`, `__gc`, one entry per method
 * (`class_def`: a C closure holding the member-function pointer), one per field (`class_mem`: a userdata holding a `mem_var` accessor)
 * and `__parent` (`class_inh`: the base class's table).  `class_con` gives the class table its own metatable with a `__call` that
 * constructs a value.
 *
 * `meta_get` (33369720): rawget of the key in the object's metatable; a userdata there is a field accessor (called); nil walks the
 * `__parent` chain (`invoke_parent`, 3336A050) and, when still nil, RAISES `can't find '<key>' class variable. (forgot registering class
 * variable ?)` instead of returning nil.  Two quirks are kept on purpose: a field found through `__parent` is returned as the raw
 * accessor userdata (never called), and `meta_set` (333697E0) on an unknown key does a `rawset` into the CLASS table, shared by every
 * instance, while an assignment to a method name is silently ignored.
 *
 * Arguments (`lua_tinker::read<T>`, 33368B50...): numbers are `(int)lua_tonumber(L, i)` (nil / non-numbers read as 0; a numeric string
 * converts), floats `(float)lua_tonumber`, bool is `lua_toboolean` for a boolean and `lua_tonumber != 0` for everything else, strings
 * are `lua_tolstring` (NULL for non-strings), a class value / pointer must be a userdata (otherwise: `no class at first argument.
 * (forgot ':' expression ?)`, 334AC49C).  The exe never checks WHICH class the userdata is; the port rejects an object of the wrong
 * JS shape with the same message instead of crashing like the exe would.
 *
 * Returns (`push<T>`): numbers as doubles, strings as byte strings, a struct by value as a NEW userdata owning a copy (`val2user`), a
 * pointer / reference as a new userdata pointing at the object (`ptr2user`: pushing the same object twice gives two different
 * userdata), NULL as nil.  (The exe additionally sets the class table as the metatable of that nil, i.e. of *every* nil: not emulated,
 * it only changes the text of the error a script gets for a method call on nil.)
 */
import {
  LuaError, LuaNative, LuaTable, LuaUserdata, call, getMetatable, index as luaIndex, luaToUtf8, setIndex, toNumber, tostr, typeName, utf8ToLua,
} from "@els/lua";
import type { LuaState, LuaThread, LuaValue } from "@els/lua";
import { HOST_CLASSES, HOST_CONSTANTS, HOST_FUNCTIONS } from "./api.generated.ts";
import type { HostClassSpec, HostFieldSpec, HostMethodSpec } from "./api.generated.ts";
import { Color, HostHandle, Vec2, Vec3 } from "./values.ts";
import type { HostObject } from "./values.ts";

// ---- C++ types -> how a value crosses the boundary ---------------------------------------------------------------------------

export type IntWidth = "i32" | "u32" | "i16" | "u16" | "i8" | "u8";
export type TypeSpec =
  | { k: "void" }
  | { k: "int"; w: IntWidth }
  | { k: "float" | "double" | "bool" | "cstr" | "string" | "i64" | "u64" | "table" }
  /** a registered class passed by value (`val2user`: D3DXVECTOR2/3, D3DXCOLOR, KHandleType<...>); `ref`: by reference (no copy) */
  | { k: "val"; cls: string; ref: boolean }
  /** pointer to a registered class; `cls` is the C++ type */
  | { k: "ptr"; cls: string };

const INT_WIDTH: Record<string, IntWidth> = {
  int: "i32", long: "i32", "unsigned int": "u32", "unsigned long": "u32",
  short: "i16", "unsigned short": "u16", char: "i8", "unsigned char": "u8",
};

const CLASS_NAMES = new Set(HOST_CLASSES.map((c) => c.cpp));

/** Classifies a C++ type spelled as in the decompile (`enum CX2Unit::UNIT_CLASS`, `D3DXVECTOR3 const &`, `char const *` ...). */
export function classify(t0: string): TypeSpec {
  const t = t0.replace(/\bconst\b/g, "").replace(/\b(enum|struct|class)\b/g, "").replace(/\s+/g, " ").trim();
  if (t === "void") return { k: "void" };
  if (t === "bool") return { k: "bool" };
  if (t === "float") return { k: "float" };
  if (t === "double") return { k: "double" };
  if (t === "char *") return { k: "cstr" };
  if (t === "std::string" || t === "std::string &" || t === "std::wstring" || t === "std::wstring &") return { k: "string" };
  if (t === "__int64") return { k: "i64" };
  if (t === "unsigned __int64") return { k: "u64" };
  if (t === "lua_tinker::table") return { k: "table" };
  const ref = t.endsWith("&");
  const bare = t.replace(/ ?&$/, "");
  if (t.endsWith("*")) return { k: "ptr", cls: t.slice(0, -1).trim() };
  if (CLASS_NAMES.has(bare)) return { k: "val", cls: bare, ref };
  const w = INT_WIDTH[t];
  if (w) return { k: "int", w };
  return { k: "int", w: "i32" }; // an enum: its name is all that is left once `enum` is stripped
}

/** `(int)double` as x86 `cvttsd2si`: truncation, NaN / out of range give 0x80000000. */
function cvtt32(d: number): number {
  if (!(d > -2147483649 && d < 2147483648)) return -2147483648;
  return Math.trunc(d) | 0;
}
/** `(__int64)double` (`cvttsd2si` on the x87 path of the exe), as a BigInt. */
function cvtt64(d: number): bigint {
  if (!(d > -9223372036854775809 && d < 9223372036854775808)) return -9223372036854775808n;
  return BigInt(Math.trunc(d));
}
const num = (v: LuaValue): number => toNumber(v) ?? 0; // lua_tonumber

/** `(T)lua_tonumber` for the integer type T */
function toInt(w: IntWidth, d: number): number {
  return w === "u32" ? Number(BigInt.asUintN(32, cvtt64(d))) : narrow(cvtt32(d), w);
}
/** a number handed back by a TS implementation; anything else is a bug in that implementation, not a value to guess */
function numeric(r: unknown): number {
  if (typeof r === "number") return r;
  if (typeof r === "bigint") return Number(r);
  if (typeof r === "boolean") return r ? 1 : 0;
  throw new TypeError(`a host method returned ${r === undefined ? "undefined" : typeof r} where the C++ signature has a number`);
}

function narrow(n: number, w: IntWidth): number {
  switch (w) {
    case "i32": return n | 0;
    case "u32": return n >>> 0;
    case "i16": return (n << 16) >> 16;
    case "u16": return n & 0xffff;
    case "i8": return (n << 24) >> 24;
    case "u8": return n & 0xff;
  }
}

const NO_CLASS = "no class at first argument. (forgot ':' expression ?)";

// ---- field accessors (`mem_var`) ---------------------------------------------------------------------------------------------

export class MemVar {
  constructor(readonly owner: string, readonly name: string, readonly type: TypeSpec, private readonly rt: HostRuntime) {}
  get(L: LuaThread, obj: LuaValue): LuaValue {
    const self = this.rt.readSelf(obj);
    const v = (self as Record<string, unknown>)[this.name];
    if (v === undefined) return this.rt.missingField(this.owner, this.name, this.type);
    // class-typed members are pushed as a copy (`val2user`), scalars as numbers
    return this.rt.push(this.type, v, L);
  }
  set(L: LuaThread, obj: LuaValue, value: LuaValue): void {
    const self = this.rt.readSelf(obj);
    (self as Record<string, unknown>)[this.name] = this.rt.read(this.type, value, 3, L);
  }
}

// ---- the runtime ---------------------------------------------------------------------------------------------------------------

export class HostNotPortedError extends Error {
  constructor(readonly what: string) {
    super(`not ported: ${what}`);
    this.name = "HostNotPortedError";
  }
}

/** the object behind a userdata made by record mode: it implements nothing, so every call on it is recorded too */
export class HostStub {
  constructor(readonly hostClass: string) {}
}

export interface BoundMethod { readonly spec: HostMethodSpec; readonly params: TypeSpec[]; readonly ret: TypeSpec }
export interface BoundClass {
  readonly spec: HostClassSpec;
  readonly mt: LuaTable;
  readonly methods: Map<string, BoundMethod>;
  /** the TS class providing the methods (`registerImpl`): its prototype is looked at for `status()`; calls dispatch on the receiver */
  impl?: object;
}

export interface HostOptions {
  /** `throw` (default): a registered method without a TS implementation raises HostNotPortedError. `record`: it counts the call and returns nothing. */
  notPorted?: "throw" | "record";
}

export class HostRuntime {
  readonly byCpp = new Map<string, BoundClass>();
  readonly byLua = new Map<string, BoundClass>();
  /** `Class.method` -> number of calls that reached a method without an implementation (`notPorted: "record"`) */
  readonly notPortedCalls = new Map<string, number>();
  notPorted: "throw" | "record";
  /** the arguments of the native call being served (`lua_gettop`-style access for functions that read their table from the stack) */
  private frames: LuaValue[][] = [];
  private readonly metaGet: LuaNative;
  private readonly metaSet: LuaNative;
  private readonly ctors = new Map<string, (...args: unknown[]) => HostObject>();
  /** value classes: what a nil argument reads as (the exe reads uninitialised stack) */
  private readonly defaults = new Map<string, () => unknown>();

  constructor(readonly G: LuaState, opts: HostOptions = {}) {
    this.notPorted = opts.notPorted ?? "throw";
    this.metaGet = new LuaNative("lua_tinker::meta_get", (L, a) => this.doMetaGet(L, a));
    this.metaSet = new LuaNative("lua_tinker::meta_set", (L, a) => this.doMetaSet(L, a));
    this.installClasses();
    this.installFunctions();
    this.installConstants();
    this.installMath();
  }

  // ---- registration --------------------------------------------------------------------------------------------------------

  private installClasses(): void {
    for (const spec of HOST_CLASSES) {
      const mt = new LuaTable();
      mt.setStr("__name", spec.lua);
      mt.setStr("__index", this.metaGet);
      mt.setStr("__newindex", this.metaSet);
      mt.setStr("__gc", new LuaNative("lua_tinker::destroyer", () => undefined));
      this.G.globals.setStr(spec.lua, mt); // class_add: lua_settable(L, LUA_GLOBALSINDEX)
      const bc: BoundClass = { spec, mt, methods: new Map() };
      this.byCpp.set(spec.cpp, bc);
      this.byLua.set(spec.lua, bc);
    }
    for (const bc of this.byCpp.values()) {
      const { spec, mt } = bc;
      for (const b of spec.bases) {
        const base = this.byCpp.get(b);
        if (base) mt.setStr("__parent", base.mt); // class_inh keeps one `__parent`: the last registration wins
      }
      for (const f of spec.fields) mt.setStr(f.name, new LuaUserdata(new MemVar(spec.cpp, f.name, classify(f.type), this)));
      for (const m of spec.methods) {
        const bm: BoundMethod = { spec: m, params: m.params.map(classify), ret: classify(m.ret) };
        bc.methods.set(m.name, bm);
        mt.setStr(m.name, this.makeMethod(bc, bm));
      }
    }
  }

  private makeMethod(bc: BoundClass, bm: BoundMethod): LuaNative {
    const label = `${bc.spec.cpp}::${bm.spec.name}`;
    const key = `${bc.spec.cpp}.${bm.spec.name}`;
    return new LuaNative(label, (L, args) => {
      const self = this.readSelf(args[0]);
      const impl = (self as Record<string, unknown>)[bm.spec.name];
      if (typeof impl !== "function") return this.missing(key, bm.spec, bm.ret);
      const a = bm.params.map((p, i) => this.read(p, args[i + 1], i + 2, L, bm.spec.nullCStr?.[i]));
      this.frames.push(args);
      let r: unknown;
      try {
        r = impl.apply(self, a);
      } finally {
        this.frames.pop();
      }
      return bm.ret.k === "void" ? undefined : [this.push(bm.ret, r, L)];
    });
  }

  /**
   * A registered method / function without a TS implementation. Strict mode throws. Record mode counts the call and returns a value
   * of the declared return type (0, false, "", a zero vector, a stub object of the pointed-to class) so that a script can run on:
   * the typed stubs of the host API, used to find out what the scripts need (tools/host-census.ts).
   */
  private missing(key: string, spec: { name: string; addr: number }, ret: TypeSpec): LuaValue[] | undefined {
    if (this.notPorted === "throw") throw new HostNotPortedError(`${key} @${spec.addr.toString(16).toUpperCase()}`);
    this.notPortedCalls.set(key, (this.notPortedCalls.get(key) ?? 0) + 1);
    return ret.k === "void" ? undefined : [this.stubValue(ret)];
  }

  /** a field the receiver does not have (strict: not ported; record: counted, typed default) */
  missingField(owner: string, name: string, type: TypeSpec): LuaValue {
    const key = `${owner}.${name} (field)`;
    if (this.notPorted === "throw") throw new HostNotPortedError(key);
    this.notPortedCalls.set(key, (this.notPortedCalls.get(key) ?? 0) + 1);
    return this.stubValue(type);
  }

  /** the typed default of record mode */
  private stubValue(t: TypeSpec): LuaValue {
    switch (t.k) {
      case "void": return undefined;
      case "int": case "float": case "double": case "i64": case "u64": return 0;
      case "bool": return false;
      case "cstr": case "string": return "";
      case "table": return new LuaTable();
      case "val": return this.push(t, this.defaults.get(t.cls)?.() ?? new HostStub(t.cls));
      case "ptr": return this.pushObject(new HostStub(t.cls), t.cls);
    }
  }

  private installFunctions(): void {
    for (const f of HOST_FUNCTIONS) {
      const params = f.params.map(classify);
      const ret = classify(f.ret);
      const key = `::${f.name}`;
      this.G.globals.setStr(f.name, new LuaNative(f.name, (L, args) => {
        const impl = this.functions.get(f.name);
        if (!impl) return this.missing(key, f, ret);
        const a = params.map((p, i) => this.read(p, args[i], i + 1, L));
        this.frames.push(args);
        let r: unknown;
        try {
          r = impl(...a);
        } finally {
          this.frames.pop();
        }
        return ret.k === "void" ? undefined : [this.push(ret, r, L)];
      }));
    }
  }
  private readonly functions = new Map<string, (...args: unknown[]) => unknown>();
  /** provide the body of a registered global function (`IncludeLua`, `RandomInt_LUA`...) */
  registerFunction(name: string, fn: (...args: any[]) => unknown): void {
    if (!HOST_FUNCTIONS.some((f) => f.name === name)) throw new Error(`the exe registers no global function '${name}'`);
    this.functions.set(name, fn as (...args: unknown[]) => unknown);
  }

  private installConstants(): void {
    for (const c of HOST_CONSTANTS) this.G.globals.setStr(c.name, c.value);
  }

  /** Lua constructors: `class_con<T>`: a metatable on the class table with `__call` (arguments start at index 2: index 1 is the table). */
  registerConstructor(cppClass: string, make: (...args: any[]) => HostObject): void {
    const bc = this.byCpp.get(cppClass);
    if (!bc) throw new Error(`unknown host class ${cppClass}`);
    const ctor = bc.spec.ctors[0];
    const params = (ctor ?? []).map(classify);
    this.ctors.set(cppClass, make as (...args: unknown[]) => HostObject);
    const meta = new LuaTable();
    meta.setStr("__call", new LuaNative(`${cppClass}::new`, (L, args) => {
      const a = params.map((p, i) => this.read(p, args[i + 1], i + 2, L));
      return [this.pushObject(make(...a), cppClass)];
    }));
    bc.mt.metatable = meta;
  }

  /** `D3DXVECTOR2`, `D3DXVECTOR3` and `D3DXCOLOR` are the three classes with a constructor (`creator<T>`, 328BC6A0...). */
  private installMath(): void {
    this.registerConstructor("D3DXVECTOR2", (x: number, y: number) => new Vec2(x, y));
    this.registerConstructor("D3DXVECTOR3", (x: number, y: number, z: number) => new Vec3(x, y, z));
    this.registerConstructor("D3DXCOLOR", (r: number, g: number, b: number, a: number) => new Color(r, g, b, a));
    this.defaults.set("D3DXVECTOR2", () => new Vec2());
    this.defaults.set("D3DXVECTOR3", () => new Vec3());
    this.defaults.set("D3DXCOLOR", () => new Color());
    for (const c of HOST_CLASSES) if (c.cpp.startsWith("KHandleType<")) this.defaults.set(c.cpp, () => new HostHandle(0, c.cpp));
  }

  /** Declare which TS class implements a host class (only used by `status()`; calls are dispatched on the receiver by method name). */
  registerImpl(cppClass: string, impl: object | (abstract new (...a: never[]) => object)): void {
    const bc = this.byCpp.get(cppClass);
    if (!bc) throw new Error(`unknown host class ${cppClass}`);
    bc.impl = typeof impl === "function" ? (impl as { prototype: object }).prototype : impl;
  }

  /** Phase-5 porting status: per class the registered methods that have a TS implementation. */
  status(): { cls: string; lua: string; total: number; implemented: number; missing: string[] }[] {
    const out = [];
    for (const bc of this.byCpp.values()) {
      const missing: string[] = [];
      const impl = bc.impl as Record<string, unknown> | undefined;
      for (const name of bc.methods.keys()) if (!impl || typeof impl[name] !== "function") missing.push(name);
      out.push({ cls: bc.spec.cpp, lua: bc.spec.lua, total: bc.methods.size, implemented: bc.methods.size - missing.length, missing });
    }
    return out;
  }

  // ---- objects -------------------------------------------------------------------------------------------------------------

  /** `ptr2user<T>`: a new userdata pointing at `obj` with the metatable of class `cppClass` (nil for a null pointer). */
  pushObject(obj: unknown, cppClass: string): LuaValue {
    if (obj === undefined || obj === null) return undefined;
    const ud = new LuaUserdata(obj);
    ud.metatable = this.byCpp.get(cppClass)?.mt;
    return ud;
  }

  /** `lua_tinker::set(L, name, ptr)`: publishes an object as a global (g_pUIDialog, g_pMain...). */
  setObject(globalName: string, obj: HostObject | undefined, cppClass: string): void {
    this.G.globals.setStr(globalName, this.pushObject(obj, cppClass));
  }

  /** The host object behind a userdata argument (`read<T*>`); anything else is `no class at first argument...`. */
  readSelf(v: LuaValue): object {
    if (v instanceof LuaUserdata && typeof v.data === "object" && v.data !== null) return v.data;
    throw new LuaError(NO_CLASS);
  }

  /** The table the C++ side reads with `KLuaManager(L, 1, false)`: the top of the stack of the native call being served. */
  topOfStack(): LuaValue {
    const f = this.frames[this.frames.length - 1];
    return f ? f[f.length - 1] : undefined;
  }

  // ---- crossing the boundary -----------------------------------------------------------------------------------------------

  read(t: TypeSpec, v: LuaValue, luaIndexOfArg: number, _L: LuaThread, nullCStr?: string): unknown {
    switch (t.k) {
      case "int": return toInt(t.w, num(v));
      case "float": return Math.fround(num(v));
      case "double": return num(v);
      case "bool": return typeof v === "boolean" ? v : num(v) !== 0;
      case "cstr": {
        const s = tostr(v);
        if (s === undefined) {
          // NULL (`lua_tostring` of a table, nil, a missing argument). Where the exe survives it (docs/host_null_cstr.tsv) the method
          // gets what the exe's code makes of it: "" (converted into a local) or undefined (tested by the function / left alone).
          if (nullCStr === "L") return "";
          if (nullCStr === "U") return undefined;
          throw new LuaError(`bad argument #${luaIndexOfArg} (string expected, got ${typeName(v)}): the exe would pass NULL`);
        }
        return luaToUtf8(s);
      }
      case "string": {
        const s = tostr(v);
        return s === undefined ? "" : luaToUtf8(s);
      }
      case "i64": {
        if (toNumber(v) !== undefined) return cvtt64(num(v));
        if (v instanceof LuaUserdata && typeof v.data === "bigint") return v.data;
        throw new LuaError(NO_CLASS);
      }
      case "u64": {
        if (toNumber(v) !== undefined) return BigInt.asUintN(64, cvtt64(num(v)));
        if (v instanceof LuaUserdata && typeof v.data === "bigint") return v.data;
        throw new LuaError(NO_CLASS);
      }
      case "table":
        if (!(v instanceof LuaTable)) throw new LuaError(`attempt to index a ${typeName(v)} value`);
        return v;
      case "val": {
        if (v instanceof LuaUserdata && typeof v.data === "object" && v.data !== null) {
          const d = v.data as { clone?: () => unknown };
          return t.ref || !d.clone ? d : d.clone();
        }
        // `read<D3DXVECTOR3>` on nil returns the caller's uninitialised temporary: zeros here
        const make = !t.ref && v === undefined ? this.defaults.get(t.cls) : undefined;
        if (make) return make();
        throw new LuaError(NO_CLASS);
      }
      case "ptr": return this.readSelf(v);
      case "void": return undefined;
    }
  }

  push(t: TypeSpec, r: unknown, _L?: LuaThread): LuaValue {
    switch (t.k) {
      case "void": return undefined;
      case "int": return toInt(t.w, numeric(r));
      case "float": return Math.fround(numeric(r));
      case "double": return numeric(r);
      case "bool": return !!r;
      case "cstr": case "string": return r === undefined || r === null ? undefined : utf8ToLua(String(r));
      case "i64": case "u64": return r === undefined ? undefined : Number(r as bigint);
      case "table": return r as LuaTable;
      case "val": {
        if (r === undefined || r === null) return undefined;
        const d = r as { clone?: () => unknown };
        const ud = new LuaUserdata(t.ref || !d.clone ? r : d.clone());
        ud.metatable = this.byCpp.get(t.cls)?.mt;
        return ud;
      }
      case "ptr": return this.pushObject(r, t.cls);
    }
  }

  // ---- meta_get / meta_set -------------------------------------------------------------------------------------------------

  private doMetaGet(L: LuaThread, a: LuaValue[]): LuaValue[] {
    const obj = a[0], key = a[1];
    const mt = getMetatable(L.state, obj);
    if (!mt) throw new LuaError(`attempt to index a ${typeName(obj)} value`);
    let v = mt.get(key);
    if (v instanceof LuaUserdata && v.data instanceof MemVar) return [v.data.get(L, obj)];
    if (v === undefined) {
      v = this.invokeParent(mt, key);
      if (v === undefined) throw new LuaError(`can't find '${tostr(key) ?? "(null)"}' class variable. (forgot registering class variable ?)`);
    }
    return [v];
  }

  /** `invoke_parent` (3336A050) */
  private invokeParent(mt: LuaTable, key: LuaValue): LuaValue {
    for (let cur: LuaValue = mt; cur instanceof LuaTable;) {
      const parent = cur.getStr("__parent");
      if (!(parent instanceof LuaTable)) return undefined;
      const v = parent.get(key);
      if (v !== undefined) return v;
      cur = parent;
    }
    return undefined;
  }

  private doMetaSet(L: LuaThread, a: LuaValue[]): void {
    const obj = a[0], key = a[1], value = a[2];
    const mt = getMetatable(L.state, obj);
    if (!mt) throw new LuaError(`attempt to index a ${typeName(obj)} value`);
    const v = mt.get(key);
    if (v instanceof LuaUserdata && v.data instanceof MemVar) {
      v.data.set(L, obj, value);
      return;
    }
    if (v === undefined) mt.set(key, value); // the class table: shared by every instance
  }

  // ---- calling Lua from the host ---------------------------------------------------------------------------------------------

  /** `obj[key]` with metamethods, as `lua_gettable` does. */
  index(obj: LuaValue, key: LuaValue): LuaValue {
    return luaIndex(this.G.main, obj, key);
  }
  setIndex(obj: LuaValue, key: LuaValue, value: LuaValue): void {
    setIndex(this.G.main, obj, key, value);
  }
  call(fn: LuaValue, args: LuaValue[]): LuaValue[] {
    return call(this.G.main, fn, args);
  }
  field(f: HostFieldSpec): TypeSpec {
    return classify(f.type);
  }
}
