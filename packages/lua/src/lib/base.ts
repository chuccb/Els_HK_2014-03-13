import { LuaTable } from "../table.ts";
import { LuaClosure, LuaError, LuaNative, LuaUserdata, typeName, callerError, vmError } from "../value.ts";
import type { LuaValue } from "../value.ts";
import { loadBytecode } from "../bytecode.ts";
import { call, callerLevels, getMetatable, makePcall, makeXpcall, shortName, strToNumber, tostringMeta, EMPTY } from "../vm.ts";
import type { LuaState, LuaThread } from "../vm.ts";
import { argError, checkAny, checkInt, checkStr, checkTable, makeLib, optInt, strtoul32 } from "./util.ts";

export interface BaseHost {
  print(text: string): void;
  /** Reads a file for dofile/loadfile; returns bytes or undefined. */
  readFile?(path: string): Uint8Array | undefined;
  /** Compile Lua *source text* to a function (only available when a source compiler is plugged in). */
  loadSource?(L: LuaThread, source: string, chunkname: string): LuaClosure;
}

/** Load a binary chunk (or, when the host provides a compiler, source text) as a closure over `env`. */
export function loadChunk(L: LuaThread, data: Uint8Array | string, chunkname: string, env?: LuaTable, host?: BaseHost): LuaClosure {
  const bytes = typeof data === "string" ? Uint8Array.from(data, (c) => c.charCodeAt(0)) : data;
  if (bytes[0] === 0x1b) {
    let pt;
    try {
      pt = loadBytecode(bytes, { chunkname });
    } catch (e) {
      if (e instanceof LuaError) throw e;
      const bad = e instanceof Error && /header|version|incompatible|flags/i.test(e.message);
      throw new LuaError(`${shortName(chunkname)}: ${bad ? "cannot load incompatible bytecode" : "cannot load malformed bytecode"}`);
    }
    return new LuaClosure(pt, env ?? L.state.globals, []);
  }
  if (host?.loadSource) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x2000) text += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
    return host.loadSource(L, text, chunkname);
  }
  throw new LuaError(`${chunkname}: Lua source chunks are not supported (no compiler); only precompiled bytecode`);
}

const isFalsy = (v: LuaValue): boolean => v === undefined || v === false;

const ipairsIter = new LuaNative("ipairs_iter", (_L, a) => {
  const t = a[0] as LuaTable;
  const i = (a[1] as number) + 1;
  const v = t.getInt(i);
  return v === undefined ? [undefined] : [i, v];
});

export function installBase(G: LuaState, host: BaseHost): void {
  const g = G.globals;
  let gcPause = 200, gcStepMul = 200; // LUAI_GCPAUSE / LUAI_GCMUL; only the bookkeeping of lua_gc is emulated
  makeLib(g, null, {
    assert(_L, a) {
      checkAny(a, 0, "assert");
      if (isFalsy(a[0])) {
        if (a[1] === undefined) throw callerError("assertion failed!");
        throw callerError(checkStr(a, 1, "assert"));
      }
      return a;
    },
    collectgarbage(_L, a) {
      const opts = ["stop", "restart", "collect", "count", "step", "setpause", "setstepmul"];
      let opt = "collect";
      if (a[0] !== undefined) {
        opt = checkStr(a, 0, "collectgarbage");
        if (!opts.includes(opt)) argError(0, "collectgarbage", `invalid option '${opt}'`);
      }
      const data = optInt(a, 1, "collectgarbage", 0);
      switch (opt) {
        case "count": {
          const kb = typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().heapUsed / 1024 : 0;
          return [kb];
        }
        case "step": return [false];
        case "setpause": { const old = gcPause; gcPause = data; return [old]; }
        case "setstepmul": { const old = gcStepMul; gcStepMul = data; return [old]; }
        default: return [0];
      }
    },
    error(_L, a) {
      const level = optInt(a, 1, "error", 1);
      let v = a[0];
      if ((typeof v === "string" || typeof v === "number") && level > 0) {
        // luaL_where(level) .. msg  (a number becomes a string here)
        const msg = typeof v === "number" ? tostringMeta(_L, v) : v;
        throw new LuaError(msg, { kind: "level", msg, level });
      }
      throw new LuaError(v);
    },
    getmetatable(L, a) {
      checkAny(a, 0, "getmetatable");
      const mt = getMetatable(L.state, a[0]);
      if (mt === undefined) return [undefined];
      const prot = mt.getStr("__metatable");
      return [prot !== undefined ? prot : mt];
    },
    setmetatable(_L, a) {
      const t = checkTable(a, 0, "setmetatable");
      const mt = a[1];
      if (a.length < 2 || (mt !== undefined && !(mt instanceof LuaTable))) argError(1, "setmetatable", "nil or table expected");
      if (t.metatable?.getStr("__metatable") !== undefined) throw callerError("cannot change a protected metatable");
      t.metatable = mt as LuaTable | undefined;
      return [t];
    },
    rawget(_L, a) {
      const t = checkTable(a, 0, "rawget");
      checkAny(a, 1, "rawget");
      return [t.get(a[1])];
    },
    rawset(_L, a) {
      const t = checkTable(a, 0, "rawset");
      checkAny(a, 1, "rawset");
      checkAny(a, 2, "rawset");
      if (a[1] === undefined) throw vmError("table index is nil");
      if (typeof a[1] === "number" && Number.isNaN(a[1])) throw vmError("table index is NaN");
      t.set(a[1], a[2]);
      return [t];
    },
    rawequal(_L, a) {
      checkAny(a, 0, "rawequal");
      checkAny(a, 1, "rawequal");
      return [a[0] === a[1]];
    },
    type(_L, a) {
      checkAny(a, 0, "type");
      return [typeName(a[0])];
    },
    tostring(L, a) {
      checkAny(a, 0, "tostring");
      return [tostringMeta(L, a[0])];
    },
    tonumber(_L, a) {
      const base = optInt(a, 1, "tonumber", 10);
      if (base === 10) {
        checkAny(a, 0, "tonumber");
        const v = a[0];
        if (typeof v === "number") return [v];
        if (typeof v === "string") return [strToNumber(v)];
        return [undefined];
      }
      const s = checkStr(a, 0, "tonumber");
      if (base < 2 || base > 36) argError(1, "tonumber", "base out of range");
      return [strtoul32(s, base)];
    },
    select(_L, a) {
      const n = a.length;
      const first = a[0];
      if (n >= 1 && typeof first === "string" && first.charCodeAt(0) === 0x23 /* # */) return [n - 1];
      let i = checkInt(a, 0, "select");
      if (i < 0) i = n + i; else if (i > n) i = n;
      if (i < 1) argError(0, "select", "index out of range");
      return a.slice(i);
    },
    unpack(_L, a) {
      const t = checkTable(a, 0, "unpack");
      const i = optInt(a, 1, "unpack", 1);
      const e = a[2] === undefined ? t.length() : checkInt(a, 2, "unpack");
      if (i > e) return EMPTY;
      const n = e - i + 1;
      if (n <= 0 || n + a.length > 8000 /* LUAI_MAXCSTACK */) throw callerError("too many results to unpack");
      const out: LuaValue[] = new Array(n);
      for (let k = i; k <= e; k++) out[k - i] = t.getInt(k);
      return out;
    },
    next(_L, a) {
      const t = checkTable(a, 0, "next");
      let r: [LuaValue, LuaValue] | null;
      try {
        r = t.next(a[1]);
      } catch {
        throw vmError("invalid key to 'next'");
      }
      return r === null ? [undefined] : r;
    },
    pairs(_L, a) {
      // ffh_pairs: checkany first, then "table expected" (no __pairs: the client is built without LUA52COMPAT)
      const t = checkAny(a, 0, "pairs");
      if (!(t instanceof LuaTable)) argError(0, "pairs", `table expected, got ${typeName(t)}`);
      return [G.nextFn, t, undefined];
    },
    ipairs(_L, a) {
      const t = checkAny(a, 0, "ipairs");
      if (!(t instanceof LuaTable)) argError(0, "ipairs", `table expected, got ${typeName(t)}`);
      return [ipairsIter, t, 0];
    },
    getfenv(L, a) {
      const f = a[0];
      if (f instanceof LuaClosure) return [f.env];
      if (f instanceof LuaNative) return [g];
      const level = optInt(a, 0, "getfenv", 1);
      if (level === 0) return [g];
      if (level < 0) argError(0, "getfenv", "invalid level");
      const lf = callerLevels(L)[level - 1];
      if (lf === undefined) argError(0, "getfenv", "invalid level");
      return [lf === null ? g : lf.cl.env];
    },
    setfenv(L, a) {
      const f = a[0];
      const env = checkTable(a, 1, "setfenv");
      if (f instanceof LuaClosure) {
        f.env = env;
        return [f];
      }
      if (f instanceof LuaNative) throw callerError("'setfenv' cannot change environment of given object");
      const level = checkInt(a, 0, "setfenv");
      if (level === 0) return EMPTY; // the thread environment is not modelled
      if (level < 0) argError(0, "setfenv", "invalid level");
      const lf = callerLevels(L)[level - 1];
      if (lf === undefined) argError(0, "setfenv", "invalid level");
      if (lf === null) throw callerError("'setfenv' cannot change environment of given object");
      lf.cl.env = env;
      return [lf.cl];
    },
    print(L, a) {
      // lj_cf_print calls the global `tostring` (Lua 5.1 behaviour), not the metamethod machinery directly
      const ts = g.getStr("tostring");
      const parts: string[] = [];
      for (const v of a) {
        if (ts === tostringNative) parts.push(tostringMeta(L, v));
        else {
          const r = call(L, ts, [v])[0];
          if (typeof r === "string") parts.push(r);
          else if (typeof r === "number") parts.push(tostringMeta(L, r));
          else throw callerError("'tostring' must return a string to 'print'");
        }
      }
      host.print(parts.join("\t"));
    },
    loadstring(L, a) {
      const s = checkStr(a, 0, "loadstring");
      const name = a[1] === undefined ? s : checkStr(a, 1, "loadstring");
      try {
        return [loadChunk(L, s, name, undefined, host)];
      } catch (e) {
        if (e instanceof LuaError) return [undefined, e.value];
        throw e;
      }
    },
    load(L, a) {
      let s = "";
      for (;;) {
        const piece = call(L, a[0], [])[0];
        if (piece === undefined || piece === "") break;
        if (typeof piece !== "string") return [undefined, "reader function must return a string"];
        s += piece;
      }
      const name = a[1] === undefined ? "=(load)" : checkStr(a, 1, "load");
      try {
        return [loadChunk(L, s, name, undefined, host)];
      } catch (e) {
        if (e instanceof LuaError) return [undefined, e.value];
        throw e;
      }
    },
    loadfile(L, a) {
      const path = checkStr(a, 0, "loadfile");
      const data = host.readFile?.(path);
      if (!data) return [undefined, `cannot open ${path}`];
      try {
        return [loadChunk(L, data, "@" + path, undefined, host)];
      } catch (e) {
        if (e instanceof LuaError) return [undefined, e.value];
        throw e;
      }
    },
    dofile(L, a) {
      const path = checkStr(a, 0, "dofile");
      const data = host.readFile?.(path);
      if (!data) throw new LuaError(`cannot open ${path}`);
      return call(L, loadChunk(L, data, "@" + path, undefined, host), []);
    },
    gcinfo() {
      const kb = typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().heapUsed / 1024 : 0;
      return [Math.floor(kb)];
    },
    newproxy(_L, a) {
      const u = new LuaUserdata();
      if (a[0] === true) u.metatable = new LuaTable();
      else if (a[0] instanceof LuaUserdata) u.metatable = a[0].metatable;
      else if (a[0] !== undefined && a[0] !== false) argError(0, "newproxy", "boolean or proxy expected");
      return [u];
    },
  });
  const tostringNative = g.getStr("tostring");
  // pcall / xpcall: real frames over synthetic bytecode (see vm.ts makePcall)
  g.setStr("pcall", makePcall(G));
  g.setStr("xpcall", makeXpcall(G));
  g.setStr("_G", g);
  g.setStr("_VERSION", "Lua 5.1");
  G.nextFn = g.getStr("next") as LuaNative;
}
