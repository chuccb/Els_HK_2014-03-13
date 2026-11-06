import { LuaState } from "./vm.ts";
import { installBase, loadChunk } from "./lib/base.ts";
import { installString } from "./lib/string.ts";
import { installTable } from "./lib/table.ts";
import { installMisc } from "./lib/misc.ts";
import type { OsHost } from "./lib/misc.ts";

export * from "./value.ts";
export { LuaTable, strHash, tabDup } from "./table.ts";
export { Proto, loadBytecode, disassemble, OPS, OP, luaNumberToString, fmtG } from "./bytecode.ts";
export {
  LuaState, LuaThread, call, resume, newThread, index, setIndex, arith, equals, lessThan, lessEqual,
  tostringMeta, rawToString, strToNumber, toNumber, tostr, getMetatable, metaOf, EMPTY, YieldSignal,
} from "./vm.ts";
export { loadChunk } from "./lib/base.ts";
export type { BaseHost } from "./lib/base.ts";
export type { OsHost } from "./lib/misc.ts";

/**
 * Creates a state with the LuaJIT 2.0 standard libraries (base, string, table, math, bit, os, io, coroutine, debug, jit, package).
 * `host.print(line)` receives whole lines (without the trailing newline); `host.write(raw)` receives raw text from io.write.
 * Supply either or both; the missing one is derived from the other so that output stays correctly interleaved.
 */
export function createLuaState(host: Partial<OsHost> = {}): LuaState {
  let pending = "";
  const userPrint = host.print ?? ((s: string) => console.log(s));
  const userWrite = host.write;
  const write = userWrite ?? ((s: string) => {
    pending += s;
    let i: number;
    while ((i = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      userPrint(line);
    }
  });
  const print = userWrite ? (line: string) => userWrite(line + "\n") : (line: string) => {
    const l = pending + line;
    pending = "";
    userPrint(l);
  };
  const h: OsHost = { ...host, print, write };
  const G = new LuaState();
  installBase(G, h);
  installString(G);
  installTable(G);
  installMisc(G, h);
  return G;
}

/** Load and run a bytecode chunk on the main thread, returning its results. */
export function runChunk(G: LuaState, data: Uint8Array, chunkname = "=chunk"): import("./value.ts").LuaValue[] {
  const fn = loadChunk(G.main, data, chunkname);
  return callMain(G, fn);
}

import { call } from "./vm.ts";
function callMain(G: LuaState, fn: import("./value.ts").LuaClosure): import("./value.ts").LuaValue[] {
  return call(G.main, fn, []);
}
