/**
 * `KLuaManager` (3336A210..3336BEC0): KOG's thin wrapper over the Lua C API that every `*_LUA` function of the client uses to read its
 * table arguments (`CPictureData::SetPoint_LUA`, `CKTDGStatic::AddString_LUA`, the item / NPC / dialog templates ...).
 *
 * The C++ class keeps a table depth `m_iTableDepth` and works on the Lua stack: with depth 0 a name is looked up in the globals
 * (`lua_getfield(L, LUA_GLOBALSINDEX, name)`), with depth > 0 in the table on top of the stack (`lua_pushstring; lua_gettable(L, -2)`),
 * `BeginTable` pushes the field if it is a table, `EndTable` pops.  Lookups go through `lua_gettable`, i.e. WITH metamethods.
 * `KLuaManager(L, 1, false)` (what the `_LUA` functions construct) means "the table on top of the stack is the current one": the stack
 * of the native call being served, whose top is the last argument of the Lua call (`obj:AddString{ ... }`).
 *
 * The value getters return `true` and write the result only when the field exists with a usable type, so callers keep their defaults
 * otherwise; here they return `undefined` for "not found".  Numbers are `lua_isnumber` (numbers and numeric strings) and then
 * `(int)lua_tonumber` / `(float)lua_tonumber`; a bool is `(int)lua_tonumber != 0`, so the Lua values `true` / `false` are NOT numbers
 * and read as "not found" (the scripts use the numeric constants `TRUE` / `FALSE` of Enum.lua); strings are `lua_isstring` (numbers
 * count) and the wide-string variant decodes UTF-8 (`MultiByteToWideChar(CP_UTF8)`).
 */
import { LuaTable, LuaUserdata, luaToUtf8, toNumber, tostr } from "@els/lua";
import type { LuaValue } from "@els/lua";
import type { HostRuntime } from "./tinker.ts";
import { Color, Vec2, Vec3 } from "./values.ts";

export type NumKind = "i16" | "i32" | "u16" | "u32" | "f32" | "f64";

/** `(int)double` as x86 `cvttsd2si` */
function cvtt32(d: number): number {
  if (!(d > -2147483649 && d < 2147483648)) return -2147483648;
  return Math.trunc(d) | 0;
}

export class KLuaManager {
  private readonly tables: LuaValue[] = [];

  /**
   * `KLuaManager(L, iTableDepth, false)`. `tableDepth` 0: names are globals. 1: the current table is the top of the stack of the native
   * call being served (`rt.topOfStack()`); other depths do not occur in the exe's `_LUA` functions.
   */
  constructor(private readonly rt: HostRuntime, tableDepth = 0) {
    if (tableDepth === 1) this.tables.push(rt.topOfStack());
    else if (tableDepth !== 0) throw new Error(`KLuaManager: table depth ${tableDepth} is not supported`);
  }

  get depth(): number {
    return this.tables.length;
  }

  /** `KLuaManager::Get(name)` / `Get(index)`: the field (index 0 = globals when at depth 0 is not valid for an index) */
  private get(key: string | number): { ok: boolean; v: LuaValue } {
    if (typeof key === "number") {
      if (this.depth <= 0) return { ok: false, v: undefined };
      return { ok: true, v: this.rt.index(this.tables[this.depth - 1], key) };
    }
    return { ok: true, v: this.rt.index(this.depth <= 0 ? this.rt.G.globals : this.tables[this.depth - 1], key) };
  }

  /** `BeginTable(name)` (3336A890) / `BeginTable(index)` (3336A8F0) */
  beginTable(key: string | number): boolean {
    if (typeof key === "number" && this.depth <= 0) return false;
    const { v } = this.get(key);
    if (v instanceof LuaTable) {
      this.tables.push(v);
      return true;
    }
    return false;
  }

  /** `EndTable` (3336A950) */
  endTable(): boolean {
    if (this.depth <= 0) return false;
    this.tables.pop();
    return true;
  }

  /** the `GetValue` overloads for numbers and bools */
  getNumber(key: string | number, kind: NumKind): number | undefined {
    const { ok, v } = this.get(key);
    if (!ok) return undefined;
    const n = toNumber(v);
    if (n === undefined) return undefined;
    switch (kind) {
      case "f32": return Math.fround(n);
      case "f64": return n;
      case "i32": return cvtt32(n);
      case "i16": return (cvtt32(n) << 16) >> 16;
      case "u16": return cvtt32(n) & 0xffff;
      case "u32": return Number(BigInt.asUintN(32, BigInt(Math.trunc(Number.isFinite(n) ? n : 0))));
    }
  }
  getInt(key: string | number): number | undefined { return this.getNumber(key, "i32"); }
  getFloat(key: string | number): number | undefined { return this.getNumber(key, "f32"); }
  getBool(key: string | number): boolean | undefined {
    const n = this.getNumber(key, "i32");
    return n === undefined ? undefined : n !== 0;
  }

  /** `GetValue(name, std::wstring*)`: UTF-8 -> UTF-16; `lua_isstring` accepts numbers. */
  getString(key: string | number): string | undefined {
    const { ok, v } = this.get(key);
    if (!ok) return undefined;
    const s = tostr(v);
    return s === undefined ? undefined : luaToUtf8(s);
  }

  /** `GetUserDefinedTypeValue<D3DXVECTOR2/3/COLOR>`: a userdata (any userdata: the exe copies the struct without a class check). */
  private getStruct<T>(key: string, pick: (d: Record<string, number>) => T): T | undefined {
    const { v } = this.get(key);
    if (!(v instanceof LuaUserdata) || typeof v.data !== "object" || v.data === null) return undefined;
    return pick(v.data as Record<string, number>);
  }
  getVec2(key: string): Vec2 | undefined { return this.getStruct(key, (d) => new Vec2(d.x, d.y)); }
  getVec3(key: string): Vec3 | undefined { return this.getStruct(key, (d) => new Vec3(d.x, d.y, d.z)); }
  getColor(key: string): Color | undefined { return this.getStruct(key, (d) => new Color(d.r, d.g, d.b, d.a)); }

  /** `GetNumIndexedValues` (3336ACA0): the number of leading non-nil entries 1..n of the current table */
  getNumIndexedValues(): number {
    let i = 1;
    for (; this.depth > 0; i++) if (this.rt.index(this.tables[this.depth - 1], i) === undefined) break;
    return i - 1;
  }
}
