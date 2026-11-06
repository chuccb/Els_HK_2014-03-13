import { call, index, LuaTable } from "@els/lua";
import type { LuaUserdata, LuaValue } from "@els/lua";
import { StringTable } from "@els/assets";
import type { TetFile } from "@els/assets";
import type { MassFileSource } from "@els/host";
import { CKTDGUIDialog, DeviceTexture, UIWorld } from "../src/index.ts";

/**
 * The control classes on their own (no client data): a world whose every texture opens (64 x 32 texels, one UV rectangle for every key),
 * and the Lua side driven from TS the way the interpreter would (`o:Method(...)`), because the setters that read a table read the one
 * on top of the Lua stack of the call that reaches them.
 */
export const NOTHING: MassFileSource = { has: () => false, read: () => undefined };

export function setup(strings = new StringTable([])) {
  const w = new UIWorld({ source: NOTHING, strings, notPorted: "throw" });
  w.devices.openTexture = ((id: string) => {
    const t = new DeviceTexture(id.toUpperCase());
    t.info = { ...t.info, Width: 64, Height: 32 };
    t.tet = { getTexUV: () => ({ leftTop: [0, 0], rightTop: [64, 0], leftBottom: [0, 32], rightBottom: [64, 32], rectSize: [64, 32] }) } as unknown as TetFile;
    return t;
  }) as typeof w.devices.openTexture;
  const G = w.world.G;
  const L = G.main;
  /** a control as a script holds it */
  const wrap = (obj: object, cpp: string): LuaUserdata => {
    w.world.rt.setObject("g_pWrapped", obj, cpp);
    return G.globals.getStr("g_pWrapped") as LuaUserdata;
  };
  const m = (o: LuaValue, name: string, ...args: LuaValue[]) => call(L, index(L, o, name), [o, ...args]);
  const vec2 = (x: number, y: number): LuaValue => call(L, G.globals.getStr("D3DXVECTOR2"), [x, y])[0];
  /** the table of a `Set*Point`: the left-top corner (the size comes from the texture) */
  const point = (x: number, y: number, extra: Record<string, LuaValue> = {}): LuaTable => {
    const t = new LuaTable();
    t.setStr("LEFT_TOP", vec2(x, y));
    for (const [k, v] of Object.entries(extra)) t.setStr(k, v);
    return t;
  };
  const dialog = () => new CKTDGUIDialog(w);
  /** the messages a stage receives */
  const stageLog: [number, number | string][] = [];
  const stage = { MsgProc: (msg: number, wParam: number | string) => void stageLog.push([msg, wParam]) };
  return { w, wrap, m, vec2, point, dialog, stage, stageLog };
}
