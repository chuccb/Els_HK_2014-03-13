import { LuaTable } from "../table.ts";
import { LuaClosure, LuaError, LuaNative, LuaUserdata, typeName, callerError, vmError } from "../value.ts";
import type { LuaValue } from "../value.ts";
import { BytecodeError, loadBytecode } from "../bytecode.ts";
import { call, callerLevels, getMetatable, makePcall, makeXpcall, strToNumber, tostringMeta, EMPTY } from "../vm.ts";
import type { LuaState, LuaThread } from "../vm.ts";
import { argError, checkAny, checkInt, checkStr, checkTable, makeLib, optInt, strtoul32 } from "./util.ts";

export interface BaseHost {
  print(text: string): void;
  /** Reads a file for dofile/loadfile; returns bytes or undefined (the file cannot be opened). */
  readFile?(path: string): Uint8Array | undefined;
}

/** LJ_ERR_BCBAD / LJ_ERR_BCFMT of lj_errmsg.h. */
const ERR_BCBAD = "cannot load malformed bytecode";
const ERR_BCFMT = "cannot load incompatible bytecode";

const isEol = (c: number | undefined): boolean => c === 0x0a || c === 0x0d;

/**
 * `lj_lex_setup` of the exe (stock lj_lex.c): decides whether the buffer is a bytecode dump.
 * A UTF-8 BOM and a `#` first line are skipped like in stock LuaJIT; a dump that follows such a header is refused (LJ_ERR_BCBAD, "for
 * security reasons"); anything that does not start with the dump signature (ESC) is Lua *source*, which this exe cannot compile.
 */
function lexSetupIsBytecode(bytes: Uint8Array): boolean {
  let p = 0;
  let header = false;
  if (bytes[0] === 0xef && bytes.length >= 3 && bytes[1] === 0xbb && bytes[2] === 0xbf) { // only skipped if all three bytes are buffered
    p = 3;
    header = true;
  }
  if (bytes[p] === 0x23) { // '#': skip a POSIX #! line
    do {
      p++;
      if (p >= bytes.length) return false; // LEX_EOF inside the line
    } while (!isEol(bytes[p]));
    const first = bytes[p]!;
    p++;
    if (isEol(bytes[p]) && bytes[p] !== first) p++; // inclinenumber: "\r\n" and "\n\r" count as one line break
    header = true;
  }
  if (bytes[p] === 0x1b) {
    if (header) throw new LuaError(ERR_BCBAD); // no chunk name is echoed either
    return true;
  }
  return false;
}

/** The chunk name as `bcread_error` prints it: "(binary)" for a name that is itself a dump, else the name without a leading '@' or '='. */
function bcreadName(chunkname: string): string {
  if (chunkname.charCodeAt(0) === 0x1b) return "(binary)";
  return chunkname[0] === "@" || chunkname[0] === "=" ? chunkname.slice(1) : chunkname;
}

/**
 * `cpparser` of the exe (33378B50) behind lua_load / luaL_loadbuffer: loads a *binary* chunk as a closure over `env`.
 *
 * The exe has no Lua source compiler (lj_parse is not linked in; `lj_lex_setup` is kept only to find the dump signature): the game ships
 * precompiled bytecode, and its few text configuration files are read by KOG's own `KLuaManagerProxy` (see `proxy.ts`). So every chunk that is
 * not a dump (source text, an empty buffer, a BOM or `#` line alone) fails with LUA_ERRSYNTAX "cannot load malformed bytecode", without a
 * chunk name, which is what `loadstring`/`load`/`loadfile` return as their second result.
 */
export function loadChunk(L: LuaThread, data: Uint8Array | string, chunkname: string, env?: LuaTable): LuaClosure {
  const bytes = typeof data === "string" ? Uint8Array.from(data, (c) => c.charCodeAt(0)) : data;
  if (!lexSetupIsBytecode(bytes)) throw new LuaError(ERR_BCBAD);
  let pt;
  try {
    pt = loadBytecode(bytes, { chunkname });
  } catch (e) {
    if (e instanceof LuaError) throw e;
    if (e instanceof BytecodeError) throw new LuaError(`${bcreadName(chunkname)}: ${e.format ? ERR_BCFMT : ERR_BCBAD}`);
    throw e;
  }
  return new LuaClosure(pt, env ?? L.state.globals, []);
}

/**
 * `luaL_loadfilex(L, filename, mode, iEncoding)` of the exe (33378830, KOG addition) on the file's bytes; `iEncoding` is 0 for `loadfile`/`dofile`
 * (`lua_getencoding`) and 1 for `dofile_UTF8`. Unless it is 2, the first byte is looked at: a UTF-8 BOM is consumed (unlike in stock
 * LuaJIT it is not handed to the lexer, so "BOM + dump" loads); a dump signature is accepted; anything else is "invalid encoding" unless
 * `iEncoding` is 0. The chunk is named "@filename".
 */
export function loadFileChunk(L: LuaThread, data: Uint8Array | undefined, filename: string, iEncoding: number): LuaClosure {
  if (!data) throw new LuaError(`cannot open ${filename}: No such file or directory`);
  let bytes = data;
  if (iEncoding !== 2) {
    if (bytes[0] === 0xef) {
      if (bytes[1] !== 0xbb || bytes[2] !== 0xbf) throw new LuaError(`invalid encoding ${filename}`);
      bytes = bytes.subarray(3);
    } else if (bytes[0] !== 0x1b && iEncoding !== 0) throw new LuaError(`invalid encoding ${filename}`);
  }
  return loadChunk(L, bytes, "@" + filename);
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
        return [loadChunk(L, s, name)];
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
        return [loadChunk(L, s, name)];
      } catch (e) {
        if (e instanceof LuaError) return [undefined, e.value];
        throw e;
      }
    },
    loadfile(L, a) {
      const path = checkStr(a, 0, "loadfile");
      try {
        return [loadFileChunk(L, host.readFile?.(path), path, G.encoding)];
      } catch (e) {
        if (e instanceof LuaError) return [undefined, e.value];
        throw e;
      }
    },
    dofile(L, a) {
      const path = checkStr(a, 0, "dofile");
      return call(L, loadFileChunk(L, host.readFile?.(path), path, G.encoding), []);
    },
    /** KOG addition (lj_cf_dofile_UTF8, 3338DD00): dofile with `iEncoding` 1, i.e. the file must start with a UTF-8 BOM or be a dump. */
    dofile_UTF8(L, a) {
      const path = checkStr(a, 0, "dofile_UTF8");
      return call(L, loadFileChunk(L, host.readFile?.(path), path, 1), []);
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
