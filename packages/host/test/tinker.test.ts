import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { call, createLuaState, index, LuaError, LuaNative, LuaTable, LuaUserdata, setIndex, utf8ToLua } from "@els/lua";
import type { LuaValue } from "@els/lua";
import { classify, Color, HOST_CLASSES, HOST_CONSTANTS, HOST_FUNCTIONS, HostNotPortedError, HostRuntime, KLuaManager, Vec2, Vec3 } from "../src/index.ts";
import type { CKTDGUIControl_Methods, CKTDGUIDialog_Methods } from "../src/index.ts";

/**
 * The binder is driven from TS (the exe has no source compiler, so no Lua text can be run here): `call(L, f, args)` is what the
 * interpreter does for `obj:Method(...)`. Every expectation below is read off the decompile of lua_tinker (see src/tinker.ts).
 */
function setup(opts?: { notPorted?: "throw" | "record" }) {
  const G = createLuaState({ write: () => {} });
  const rt = new HostRuntime(G, opts);
  const L = G.main;
  const get = (o: LuaValue, k: LuaValue) => index(L, o, k);
  const set = (o: LuaValue, k: LuaValue, v: LuaValue) => setIndex(L, o, k, v);
  /** `o:name(...)` */
  const m = (o: LuaValue, name: string, ...args: LuaValue[]) => call(L, get(o, name), [o, ...args]);
  const g = (name: string) => G.globals.getStr(name);
  return { G, rt, L, get, set, m, g };
}
const msg = (f: () => unknown): string | undefined => {
  try { f(); } catch (e) { if (e instanceof LuaError) return e.message; throw e; }
  return undefined;
};

/** a receiver for CKTDGUIControl: implements by Lua name, records what it was called with */
class FakeControl implements Partial<CKTDGUIControl_Methods> {
  log: unknown[][] = [];
  name = "";
  offset = new Vec2(1.5, 2.5);
  SetName(s: string): void { this.name = s; this.log.push(["SetName", s]); }
  SetOffsetPos(x: number, y: number): void { this.log.push(["SetOffsetPos", x, y]); }
  GetOffsetPos(): Vec2 { return this.offset; }
  SetEnable(b: boolean): void { this.log.push(["SetEnable", b]); }
  AddDummyInt(i: number): void { this.log.push(["AddDummyInt", i]); }
  SetEnableLeftTop(v: Vec2): void { this.log.push(["SetEnableLeftTop", v]); v.x = 99; }
  GetDummyString(i: number): string { return i === 1 ? "設定" : "plain"; }
  GetMouseOver(): boolean { return true; }
}
class FakeButton extends FakeControl {
  SetNormalTex(a: string, b: string): void { this.log.push(["SetNormalTex", a, b]); }
}
class FakeDialog implements Partial<CKTDGUIDialog_Methods> {
  added: unknown[] = [];
  readonly button = new FakeButton();
  CreateButton() { return this.button; }
  AddControl(c: unknown) { this.added.push(c); }
}

describe("generated API table", () => {
  test("shape: 128 classes with 1,418 methods, 5 functions, 19 constants", () => {
    expect(HOST_CLASSES.length).toBe(128);
    expect(HOST_CLASSES.reduce((n, c) => n + c.methods.length, 0)).toBe(1418);
    expect(HOST_FUNCTIONS.map((f) => f.name).sort()).toEqual(["GetDirVecToDegree", "GetDistance_LUA", "IncludeLua", "RandomFloat_LUA", "RandomInt_LUA"]);
    expect(HOST_CONSTANTS.length).toBe(19);
    expect(HOST_CONSTANTS.find((c) => c.name === "NF_HK")?.value).toBe(769);
  });

  test("every parameter, return and field type of the exe's registrations is understood", () => {
    const kinds = new Map<string, number>();
    const bump = (t: string) => { const k = classify(t).k; kinds.set(k, (kinds.get(k) ?? 0) + 1); };
    for (const c of HOST_CLASSES) {
      for (const m of c.methods) { m.params.forEach(bump); bump(m.ret); }
      for (const f of c.fields) bump(f.type);
    }
    for (const f of HOST_FUNCTIONS) { f.params.forEach(bump); bump(f.ret); }
    expect([...kinds.keys()].sort()).toEqual(["bool", "cstr", "double", "float", "i64", "int", "ptr", "string", "val", "void"]);
    expect(classify("enum CX2Unit::UNIT_CLASS")).toEqual({ k: "int", w: "i32" });
    expect(classify("unsigned long")).toEqual({ k: "int", w: "u32" });
    expect(classify("char const *")).toEqual({ k: "cstr" });
    expect(classify("D3DXVECTOR3 const &")).toEqual({ k: "val", cls: "D3DXVECTOR3", ref: true });
    expect(classify("D3DXVECTOR3")).toEqual({ k: "val", cls: "D3DXVECTOR3", ref: false });
    expect(classify("CKTDGUIControl::CPictureData *")).toEqual({ k: "ptr", cls: "CKTDGUIControl::CPictureData" });
    expect(classify("int const")).toEqual({ k: "int", w: "i32" });
  });

  test("api.generated.ts is what tools/gen-host-api.ts makes of docs/host_api.tsv", () => {
    const r = Bun.spawnSync([process.execPath, "run", "tools/gen-host-api.ts", "--check"], { cwd: join(import.meta.dir, "..", "..", ".."), stderr: "pipe", stdout: "pipe" });
    expect(`${r.stdout}${r.stderr}`).toContain("up to date");
    expect(r.exitCode).toBe(0);
  });

  test("every base of a class is itself a class of the table, and a Lua name never repeats", () => {
    const cpp = new Set(HOST_CLASSES.map((c) => c.cpp));
    for (const c of HOST_CLASSES) for (const b of c.bases) expect(cpp.has(b)).toBe(true);
    const lua = HOST_CLASSES.map((c) => c.lua);
    expect(new Set(lua).size).toBe(lua.length);
  });
});

describe("classes", () => {
  test("a class is a global table named like the class and is the metatable of its objects (class_add)", () => {
    const { rt, G, get } = setup();
    const mt = G.globals.getStr("CKTDGUIControl") as LuaTable;
    expect(mt).toBeInstanceOf(LuaTable);
    expect(mt.getStr("__name")).toBe("CKTDGUIControl");
    expect(mt.getStr("__index")).toBeInstanceOf(LuaNative);
    expect(mt.getStr("__newindex")).toBeInstanceOf(LuaNative);
    expect(mt.getStr("SetName")).toBeInstanceOf(LuaNative);
    // the Lua name differs from the C++ type for nested classes
    expect(G.globals.getStr("CPictureData")).toBe(rt.byCpp.get("CKTDGUIControl::CPictureData")!.mt);
    expect(get(rt.pushObject(new FakeControl(), "CKTDGUIControl"), "SetName")).toBe(mt.getStr("SetName"));
  });

  test("a base class is reached through __parent; a missing name RAISES instead of returning nil (meta_get)", () => {
    const { rt, get, G } = setup();
    const control = G.globals.getStr("CKTDGUIControl") as LuaTable;
    const button = G.globals.getStr("CKTDGUIButton") as LuaTable;
    expect(button.getStr("__parent")).toBe(control);
    const b = rt.pushObject(new FakeButton(), "CKTDGUIButton");
    expect(get(b, "SetNormalTex")).toBeInstanceOf(LuaNative); // own
    expect(get(b, "SetName")).toBe(control.getStr("SetName")); // inherited
    expect(msg(() => get(b, "NoSuchMethod"))).toBe("can't find 'NoSuchMethod' class variable. (forgot registering class variable ?)");
    // a number key is shown the way lua_tolstring prints it
    expect(msg(() => get(b, 12))).toBe("can't find '12' class variable. (forgot registering class variable ?)");
    // a script cannot see host methods the exe does not register (the port must not invent any)
    const dlg = rt.pushObject(new FakeDialog(), "CKTDGUIDialog");
    expect(msg(() => get(dlg, "AddSpawnMonsterGroup"))).toContain("can't find 'AddSpawnMonsterGroup'");
  });

  test("assigning an unknown key writes into the CLASS table (shared by all instances); a method name is not overwritten (meta_set)", () => {
    const { rt, get, set, G } = setup();
    const a = rt.pushObject(new FakeControl(), "CKTDGUIControl");
    const b = rt.pushObject(new FakeControl(), "CKTDGUIControl");
    expect(msg(() => get(b, "dummy"))).toContain("can't find 'dummy'");
    set(a, "dummy", 42);
    expect(get(b, "dummy")).toBe(42);
    expect((G.globals.getStr("CKTDGUIControl") as LuaTable).getStr("dummy")).toBe(42);
    const setName = get(a, "SetName");
    set(a, "SetName", 1);
    expect(get(a, "SetName")).toBe(setName);
  });

  test("fields are accessors (mem_var): D3DXVECTOR3 x y z hold floats, copies cross the boundary", () => {
    const { rt, get, set, g, L } = setup();
    const v = call(L, g("D3DXVECTOR3"), [0.1, 2, "3.5"])[0] as LuaUserdata; // __call: the class table is argument 1
    expect(v).toBeInstanceOf(LuaUserdata);
    expect(v.data).toBeInstanceOf(Vec3);
    expect(get(v, "x")).toBe(Math.fround(0.1)); // a C++ float
    expect(get(v, "z")).toBe(3.5); // lua_tonumber converts numeric strings
    set(v, "y", 7.25);
    expect(get(v, "y")).toBe(7.25);
    set(v, "x", "8");
    expect(get(v, "x")).toBe(8);
    const empty = call(L, g("D3DXVECTOR3"), [])[0] as LuaUserdata;
    expect((empty.data as Vec3).toArray()).toEqual([0, 0, 0]); // read<float> of nil is lua_tonumber = 0
    const c = call(L, g("D3DXCOLOR"), [1, 0.5, 0.25, 0.75])[0] as LuaUserdata;
    expect(c.data).toBeInstanceOf(Color);
    expect([get(c, "r"), get(c, "g"), get(c, "b"), get(c, "a")]).toEqual([1, 0.5, 0.25, 0.75]); // ctor(r, g, b, a)
    const w = call(L, g("D3DXVECTOR2"), [3, 4])[0] as LuaUserdata;
    expect((w.data as Vec2).toArray()).toEqual([3, 4]);
    expect(rt.byCpp.get("D3DXVECTOR3")!.mt.metatable?.getStr("__call")).toBeInstanceOf(LuaNative);
  });

  test("a struct field is read and written by value (val2user copies)", () => {
    const { rt, get, set, g, L } = setup();
    const param = { lightPos: new Vec3(1, 2, 3) };
    const p = rt.pushObject(param, "CKTDGXRenderer::RenderParam");
    const lp = get(p, "lightPos") as LuaUserdata;
    expect(lp.data).not.toBe(param.lightPos); // a copy
    set(lp, "x", 100); // changes the copy only
    expect(param.lightPos.x).toBe(1);
    const v = call(L, g("D3DXVECTOR3"), [5, 6, 7])[0];
    set(p, "lightPos", v); // assignment copies the value in
    expect(param.lightPos.toArray()).toEqual([5, 6, 7]);
    expect((get(p, "lightPos") as LuaUserdata).data).not.toBe((v as LuaUserdata).data);
  });
});

describe("arguments (lua_tinker::read<T>)", () => {
  test("ints are (int)lua_tonumber: truncation, numeric strings, nil = 0, out of range = INT_MIN", () => {
    const { rt, m } = setup();
    const c = new FakeControl();
    const o = rt.pushObject(c, "CKTDGUIControl");
    for (const v of [3.9, -3.9, "7", undefined, 1e10, NaN, -1e10, "x", true, 2147483647.9]) m(o, "AddDummyInt", v);
    expect(c.log.map((l) => l[1])).toEqual([3, -3, 7, 0, -2147483648, -2147483648, -2147483648, 0, 0, 2147483647]);
  });

  test("bool: a boolean as is, anything else is lua_tonumber != 0", () => {
    const { rt, m } = setup();
    const c = new FakeControl();
    const o = rt.pushObject(c, "CKTDGUIControl");
    for (const v of [true, false, 1, 0, 2.5, "1", "0", "abc", undefined, new LuaTable()]) m(o, "SetEnable", v);
    expect(c.log.map((l) => l[1])).toEqual([true, false, true, false, true, true, false, false, false, false]);
  });

  test("floats are rounded to float; strings decode UTF-8; nil is no string (the exe would pass NULL)", () => {
    const { rt, m } = setup();
    const c = new FakeControl();
    const o = rt.pushObject(c, "CKTDGUIControl");
    m(o, "SetOffsetPos", 0.1, "0.2");
    expect(c.log[0]).toEqual(["SetOffsetPos", Math.fround(0.1), Math.fround(0.2)]);
    m(o, "SetName", utf8ToLua("設定"));
    m(o, "SetName", 12);
    expect(c.log.slice(1)).toEqual([["SetName", "設定"], ["SetName", "12"]]); // lua_tolstring converts numbers
    expect(msg(() => m(o, "SetName", undefined))).toContain("bad argument #2");
    expect(msg(() => m(o, "SetName", true))).toContain("string expected, got boolean");
  });

  test("a struct by value is copied in: the callee cannot change the script's value", () => {
    const { rt, m, g, L } = setup();
    const c = new FakeControl();
    const o = rt.pushObject(c, "CKTDGUIControl");
    const v = call(L, g("D3DXVECTOR2"), [1, 2])[0] as LuaUserdata;
    m(o, "SetEnableLeftTop", v);
    expect((v.data as Vec2).x).toBe(1); // the callee set x = 99 on its copy
    expect((c.log[0]![1] as Vec2).x).toBe(99);
    m(o, "SetEnableLeftTop", undefined); // read<D3DXVECTOR2> of nil: the caller's uninitialised temporary (zeros here)
    expect((c.log[1]![1] as Vec2).toArray()).toEqual([99, 0]);
    expect(msg(() => m(o, "SetEnableLeftTop", 5))).toBe("no class at first argument. (forgot ':' expression ?)");
  });

  test("a pointer argument must be a userdata; self too (forgot ':')", () => {
    const { rt, get, m, L } = setup();
    const d = new FakeDialog();
    const dlg = rt.pushObject(d, "CKTDGUIDialog");
    const ctl = rt.pushObject(d.button, "CKTDGUIButton");
    m(dlg, "AddControl", ctl);
    expect(d.added[0]).toBe(d.button); // the same object, not a copy
    expect(msg(() => m(dlg, "AddControl", 5))).toBe("no class at first argument. (forgot ':' expression ?)");
    expect(msg(() => m(dlg, "AddControl", undefined))).toBe("no class at first argument. (forgot ':' expression ?)");
    // dialog.AddControl(ctl): the first argument is the control, not the dialog
    expect(msg(() => call(L, get(dlg, "AddControl"), [5, ctl]))).toBe("no class at first argument. (forgot ':' expression ?)");
  });
});

describe("returns (lua_tinker::push<T>)", () => {
  test("a pointer is a new userdata with the class table as metatable; the same object twice is two userdata; NULL is nil", () => {
    const { rt, m, G } = setup();
    const d = new FakeDialog();
    const dlg = rt.pushObject(d, "CKTDGUIDialog");
    const b1 = m(dlg, "CreateButton")[0] as LuaUserdata;
    const b2 = m(dlg, "CreateButton")[0] as LuaUserdata;
    expect(b1).toBeInstanceOf(LuaUserdata);
    expect(b1.data).toBe(d.button);
    expect(b1).not.toBe(b2); // ptr2user: every push makes a new userdata
    expect(b1.metatable).toBe(G.globals.getStr("CKTDGUIButton") as LuaTable);
    expect(rt.pushObject(undefined, "CKTDGUIButton")).toBeUndefined();
    expect(rt.pushObject(null, "CKTDGUIButton")).toBeUndefined();
  });

  test("a struct return is a copy even when the C++ function hands out its member; bool / string returns", () => {
    const { rt, m, get } = setup();
    const c = new FakeControl();
    const o = rt.pushObject(c, "CKTDGUIControl");
    const off = m(o, "GetOffsetPos")[0] as LuaUserdata;
    expect(off.data).not.toBe(c.offset);
    expect([get(off, "x"), get(off, "y")]).toEqual([1.5, 2.5]);
    expect(m(o, "GetMouseOver")).toEqual([true]);
    expect(m(o, "GetDummyString", 0)).toEqual(["plain"]);
    expect(m(o, "GetDummyString", 1)).toEqual([utf8ToLua("設定")]); // std::wstring -> UTF-8
    expect(m(o, "SetName", "x")).toEqual([]); // void returns nothing
  });
});

describe("methods the port has not implemented yet", () => {
  test("strict (default): HostNotPortedError names the class, the Lua method and the exe's address", () => {
    const { rt, m } = setup();
    const o = rt.pushObject({}, "CKTDGUIControl");
    let err: unknown;
    try { m(o, "SetName", "x"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HostNotPortedError);
    expect((err as Error).message).toBe("not ported: CKTDGUIControl.SetName @32925D70");
  });

  test("record mode counts the calls and returns nothing", () => {
    const { rt, m } = setup({ notPorted: "record" });
    const o = rt.pushObject({}, "CKTDGUIControl");
    expect(m(o, "SetName", "x")).toEqual([]);
    m(o, "SetName", "y");
    m(o, "GetMouseOver");
    expect([...rt.notPortedCalls]).toEqual([["CKTDGUIControl.SetName", 2], ["CKTDGUIControl.GetMouseOver", 1]]);
  });

  test("status() lists what a registered TS class provides", () => {
    const { rt } = setup();
    rt.registerImpl("CKTDGUIControl", FakeControl);
    const s = rt.status().find((x) => x.cls === "CKTDGUIControl")!;
    expect(s.total).toBe(30);
    expect(s.implemented).toBe(8);
    expect(s.missing).toContain("SetShow");
    expect(s.missing).not.toContain("SetName");
    expect(rt.status().find((x) => x.cls === "CKTDGUIButton")!.implemented).toBe(0);
  });
});

describe("global functions, constants and objects", () => {
  test("a registered function receives typed arguments; an unimplemented one fails loudly", () => {
    const { rt, g, L, G } = setup();
    let got: unknown[] = [];
    rt.registerFunction("RandomInt_LUA", (a: number, b: number) => { got = [a, b]; return 4; });
    expect(call(L, g("RandomInt_LUA"), [1.9, "6"])).toEqual([4]);
    expect(got).toEqual([1, 6]);
    expect(() => call(L, g("GetDistance_LUA"), [])).toThrow(HostNotPortedError);
    expect(() => rt.registerFunction("NoSuchFunction", () => 0)).toThrow("registers no global function");
    expect(G.globals.getStr("NF_HK")).toBe(769);
  });

  test("setObject publishes a pointer as a global (g_pUIDialog)", () => {
    const { rt, G, m } = setup();
    const d = new FakeDialog();
    rt.setObject("g_pUIDialog", d, "CKTDGUIDialog");
    const ud = G.globals.getStr("g_pUIDialog") as LuaUserdata;
    expect(ud.data).toBe(d);
    expect(m(ud, "CreateButton")[0]).toBeInstanceOf(LuaUserdata);
    rt.setObject("g_pUIDialog", undefined, "CKTDGUIDialog");
    expect(G.globals.getStr("g_pUIDialog")).toBeUndefined();
  });
});

describe("KLuaManager", () => {
  const table = (entries: Record<string, LuaValue>, arr: LuaValue[] = []): LuaTable => {
    const t = new LuaTable();
    for (const [k, v] of Object.entries(entries)) t.setStr(k, v);
    arr.forEach((v, i) => t.setInt(i + 1, v));
    return t;
  };

  test("depth 0 reads globals; BeginTable / EndTable walk nested tables", () => {
    const { rt, G } = setup();
    G.globals.setStr("CONFIG", table({ NAME: "x", SUB: table({ N: 5, F: "2.5" }, [10, 20, 30]) }));
    const k = new KLuaManager(rt);
    expect(k.getString("NAME")).toBeUndefined(); // not a global
    expect(k.beginTable("CONFIG")).toBe(true);
    expect(k.depth).toBe(1);
    expect(k.getString("NAME")).toBe("x");
    expect(k.beginTable("SUB")).toBe(true);
    expect(k.getInt("N")).toBe(5);
    expect(k.getFloat("F")).toBe(2.5); // numeric strings are numbers
    expect(k.getNumIndexedValues()).toBe(3);
    expect(k.getInt(2)).toBe(20);
    expect(k.beginTable("NOPE")).toBe(false);
    expect(k.beginTable(1)).toBe(false); // a number, not a table
    expect(k.endTable()).toBe(true);
    expect(k.endTable()).toBe(true);
    expect(k.endTable()).toBe(false); // depth 0 again
    expect(k.getInt(1)).toBeUndefined(); // indexes need a table
  });

  test("getters: lua_isnumber / lua_isstring rules (Lua booleans are not numbers)", () => {
    const { rt, G } = setup();
    G.globals.setStr("T", table({ B0: 0, B1: 1, BT: true, BS: "1", I: -3.9, S: "text", SN: 12, U16: 70000, I16: 40000 }));
    const k = new KLuaManager(rt);
    k.beginTable("T");
    expect(k.getBool("B0")).toBe(false);
    expect(k.getBool("B1")).toBe(true);
    expect(k.getBool("BT")).toBeUndefined(); // `true` is not a number: "not found", the caller keeps its default
    expect(k.getBool("BS")).toBe(true); // "1" converts
    expect(k.getInt("I")).toBe(-3);
    expect(k.getString("S")).toBe("text");
    expect(k.getString("SN")).toBe("12"); // lua_isstring accepts numbers
    expect(k.getString("B0")).toBe("0");
    expect(k.getString("MISSING")).toBeUndefined();
    expect(k.getNumber("U16", "u16")).toBe(70000 & 0xffff);
    expect(k.getNumber("I16", "i16")).toBe(-25536);
  });

  test("lookups honour __index metamethods (lua_gettable)", () => {
    const { rt, G } = setup();
    const base = table({ INHERITED: 7 });
    const t = new LuaTable();
    const mt = new LuaTable();
    mt.setStr("__index", base);
    t.metatable = mt;
    G.globals.setStr("T", t);
    const k = new KLuaManager(rt);
    k.beginTable("T");
    expect(k.getInt("INHERITED")).toBe(7);
  });

  test("depth 1 takes the last argument of the native call being served (obj:AddString{...}) and reads struct userdata", () => {
    const { rt, m, g, L } = setup();
    const seen: Record<string, unknown> = {};
    // a receiver whose method reads its table the way the exe's *_LUA functions do
    const recv = {
      AddString() {
        const k = new KLuaManager(rt, 1);
        seen.msg = k.getString("MSG");
        seen.font = k.getInt("FONT_INDEX");
        seen.pos = k.getVec2("POS")?.toArray();
        seen.color = k.getColor("COLOR")?.toArray();
        seen.outline = k.getColor("OUTLINE_COLOR");
        seen.nested = k.beginTable("INNER") && k.getInt("A");
      },
    };
    const o = rt.pushObject(recv, "CKTDGUIStatic");
    const pos = call(L, g("D3DXVECTOR2"), [10, 20])[0];
    const color = call(L, g("D3DXCOLOR"), [1, 1, 0, 0.5])[0];
    m(o, "AddString", table({ MSG: "hello", FONT_INDEX: 15, POS: pos, COLOR: color, INNER: table({ A: 9 }) }));
    expect(seen).toEqual({ msg: "hello", font: 15, pos: [10, 20], color: [1, 1, 0, 0.5], outline: undefined, nested: 9 });
  });
});
