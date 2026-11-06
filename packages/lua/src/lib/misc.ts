import { LuaTable } from "../table.ts";
import { LuaClosure, LuaError, LuaNative, LuaUserdata, typeName, callerError } from "../value.ts";
import type { LuaValue } from "../value.ts";
import { call, callerLevels, newThread, resume, tostringMeta, YieldSignal, EMPTY } from "../vm.ts";
import type { LuaState, LuaThread } from "../vm.ts";
import { argError, checkAny, checkFunc, checkInt, checkNum, checkStr, checkTable, makeLib, optInt, optNum, optStr } from "./util.ts";
import { loadChunk } from "./base.ts";
import type { BaseHost } from "./base.ts";

// ---- math ------------------------------------------------------------------------------------------------------

const f64 = new Float64Array(1);
const u64v = new BigUint64Array(f64.buffer);
const M64 = (1n << 64n) - 1n;

class Prng {
  gen: bigint[] = [0n, 0n, 0n, 0n];
  valid = false;
  private step(): bigint {
    let r = 0n;
    const tw = (i: number, k: bigint, q: bigint, s: bigint) => {
      let z = this.gen[i]!;
      z = ((((z << q) & M64) ^ z) >> (k - s)) ^ (((z & ((M64 << (64n - k)) & M64)) << s) & M64);
      z &= M64;
      r ^= z;
      this.gen[i] = z;
    };
    tw(0, 63n, 31n, 18n);
    tw(1, 58n, 19n, 28n);
    tw(2, 55n, 24n, 7n);
    tw(3, 47n, 21n, 8n);
    return (r & 0x000fffffffffffffn) | 0x3ff0000000000000n;
  }
  init(d: number): void {
    let r = 0x11090601;
    for (let i = 0; i < 4; i++) {
      const m = BigInt(1 << (r & 255));
      r >>>= 8;
      d = d * 3.14159265358979323846 + 2.7182818284590452354;
      f64[0] = d;
      let u = u64v[0]!;
      if (u < m) u += m;
      this.gen[i] = u & M64;
    }
    this.valid = true;
    for (let i = 0; i < 10; i++) this.step();
  }
  next(): number {
    if (!this.valid) this.init(0);
    u64v[0] = this.step();
    return f64[0]! - 1.0;
  }
}

function installMath(G: LuaState): void {
  const prng = new Prng();
  const m = makeLib(G.globals, "math", {
    abs: (_L, a) => [Math.abs(checkNum(a, 0, "abs"))],
    ceil: (_L, a) => [Math.ceil(checkNum(a, 0, "ceil"))],
    floor: (_L, a) => [Math.floor(checkNum(a, 0, "floor"))],
    sqrt: (_L, a) => [Math.sqrt(checkNum(a, 0, "sqrt"))],
    sin: (_L, a) => [Math.sin(checkNum(a, 0, "sin"))],
    cos: (_L, a) => [Math.cos(checkNum(a, 0, "cos"))],
    tan: (_L, a) => [Math.tan(checkNum(a, 0, "tan"))],
    asin: (_L, a) => [Math.asin(checkNum(a, 0, "asin"))],
    acos: (_L, a) => [Math.acos(checkNum(a, 0, "acos"))],
    atan: (_L, a) => [Math.atan(checkNum(a, 0, "atan"))],
    atan2: (_L, a) => [Math.atan2(checkNum(a, 0, "atan2"), checkNum(a, 1, "atan2"))],
    sinh: (_L, a) => [Math.sinh(checkNum(a, 0, "sinh"))],
    cosh: (_L, a) => [Math.cosh(checkNum(a, 0, "cosh"))],
    tanh: (_L, a) => [Math.tanh(checkNum(a, 0, "tanh"))],
    exp: (_L, a) => [Math.exp(checkNum(a, 0, "exp"))],
    log: (_L, a) => {
      const x = checkNum(a, 0, "log");
      if (a[1] === undefined) return [Math.log(x)];
      const b = checkNum(a, 1, "log");
      return [b === 10 ? Math.log10(x) : b === 2 ? Math.log2(x) : Math.log(x) / Math.log(b)];
    },
    log10: (_L, a) => [Math.log10(checkNum(a, 0, "log10"))],
    pow: (_L, a) => [Math.pow(checkNum(a, 0, "pow"), checkNum(a, 1, "pow"))],
    fmod: (_L, a) => [checkNum(a, 0, "fmod") % checkNum(a, 1, "fmod")],
    modf(_L, a) {
      const x = checkNum(a, 0, "modf");
      if (!Number.isFinite(x)) return [x, Number.isNaN(x) ? x : 0];
      const ip = x >= 0 ? Math.floor(x) : Math.ceil(x);
      return [ip, x - ip];
    },
    frexp(_L, a) {
      const x = checkNum(a, 0, "frexp");
      if (x === 0 || !Number.isFinite(x)) return [x, 0];
      let e = Math.max(-1023, Math.floor(Math.log2(Math.abs(x))) + 1);
      let mant = x * 2 ** -e;
      while (Math.abs(mant) < 0.5) { mant *= 2; e--; }
      while (Math.abs(mant) >= 1) { mant /= 2; e++; }
      return [mant, e];
    },
    ldexp: (_L, a) => [checkNum(a, 0, "ldexp") * 2 ** checkInt(a, 1, "ldexp")],
    deg: (_L, a) => [(checkNum(a, 0, "deg") * 180) / Math.PI],
    rad: (_L, a) => [(checkNum(a, 0, "rad") * Math.PI) / 180],
    min(_L, a) {
      let r = checkNum(a, 0, "min");
      for (let i = 1; i < a.length; i++) {
        const v = checkNum(a, i, "min");
        if (v < r) r = v;
      }
      return [r];
    },
    max(_L, a) {
      let r = checkNum(a, 0, "max");
      for (let i = 1; i < a.length; i++) {
        const v = checkNum(a, i, "max");
        if (v > r) r = v;
      }
      return [r];
    },
    random(_L, a) {
      let d = prng.next();
      const n = a.length;
      if (n > 0) {
        const r1 = checkNum(a, 0, "random");
        if (n === 1) d = Math.floor(d * r1) + 1;
        else {
          const r2 = checkNum(a, 1, "random");
          d = Math.floor(d * (r2 - r1 + 1)) + r1;
        }
      }
      return [d];
    },
    randomseed(_L, a) {
      prng.init(checkNum(a, 0, "randomseed"));
      return EMPTY;
    },
  });
  m.setStr("pi", Math.PI);
  m.setStr("huge", Infinity);
  m.setStr("mod", m.getStr("fmod")); // LUA_COMPAT_MOD, luaopen_math L2510948
}

// ---- bit ---------------------------------------------------------------------------------------------------------

const bf64 = new Float64Array(1);
const bu32 = new Uint32Array(bf64.buffer);
function tobit(x: number): number {
  bf64[0] = x + 6755399441055744.0;
  return bu32[0]! | 0;
}

function installBit(G: LuaState): void {
  const arg = (a: LuaValue[], i: number, n: string) => tobit(checkNum(a, i, n));
  makeLib(G.globals, "bit", {
    tobit: (_L, a) => [arg(a, 0, "tobit")],
    bnot: (_L, a) => [~arg(a, 0, "bnot")],
    band(_L, a) { let r = arg(a, 0, "band"); for (let i = 1; i < a.length; i++) r &= arg(a, i, "band"); return [r]; },
    bor(_L, a) { let r = arg(a, 0, "bor"); for (let i = 1; i < a.length; i++) r |= arg(a, i, "bor"); return [r]; },
    bxor(_L, a) { let r = arg(a, 0, "bxor"); for (let i = 1; i < a.length; i++) r ^= arg(a, i, "bxor"); return [r]; },
    lshift: (_L, a) => [arg(a, 0, "lshift") << (arg(a, 1, "lshift") & 31)],
    rshift: (_L, a) => [arg(a, 0, "rshift") >>> (arg(a, 1, "rshift") & 31) | 0],
    arshift: (_L, a) => [arg(a, 0, "arshift") >> (arg(a, 1, "arshift") & 31)],
    rol(_L, a) { const x = arg(a, 0, "rol"), n = arg(a, 1, "rol") & 31; return [((x << n) | (x >>> (32 - n))) | 0]; },
    ror(_L, a) { const x = arg(a, 0, "ror"), n = arg(a, 1, "ror") & 31; return [((x >>> n) | (x << (32 - n))) | 0]; },
    bswap(_L, a) {
      const x = arg(a, 0, "bswap");
      return [(((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) | 0];
    },
    tohex(_L, a) {
      const x = arg(a, 0, "tohex");
      let n = a[1] === undefined ? 8 : tobit(checkNum(a, 1, "tohex"));
      const upper = n < 0;
      if (upper) n = -n;
      if (n > 8) n = 8;
      let s = (x >>> 0).toString(16).padStart(8, "0").slice(8 - n);
      if (upper) s = s.toUpperCase();
      return [s];
    },
  });
}

// ---- coroutine ----------------------------------------------------------------------------------------------------

function installCoroutine(G: LuaState): void {
  const lib = makeLib(G.globals, "coroutine", {
    create(L, a) {
      checkFunc(a, 0, "create");
      return [newThread(L.state, a[0])];
    },
    resume(L, a) {
      const co = a[0];
      if (!(co && typeof co === "object" && (co as { isLuaThread?: boolean }).isLuaThread)) argError(0, "resume", "coroutine expected");
      return resume(L, co as LuaThread, a.slice(1));
    },
    yield(L, a) {
      // the main thread, or a coroutine with a host (C) call in between, cannot yield
      if (L === L.state.main || L.ccalls > 0) throw callerError("attempt to yield across C-call boundary");
      throw new YieldSignal(a);
    },
    status(L, a) {
      const co = a[0] as LuaThread;
      if (!(co && (co as { isLuaThread?: boolean }).isLuaThread)) argError(0, "status", "coroutine expected");
      return [co.status];
    },
    running(L) {
      return [L === L.state.main ? undefined : L];
    },
    wrap(L, a) {
      checkFunc(a, 0, "wrap");
      const co = newThread(L.state, a[0]);
      return [new LuaNative("wrap", (L2, args) => {
        const r = resume(L2, co, args);
        if (r[0] === true) return r.slice(1);
        // lj_ffh_coroutine_wrap_err: string errors get the location of the caller prepended
        if (typeof r[1] === "string") throw callerError(r[1]);
        throw new LuaError(r[1]);
      })];
    },
  });
  void lib;
}

// ---- os / io -------------------------------------------------------------------------------------------------------

export interface OsHost extends BaseHost {
  now?(): number; // milliseconds since epoch
  clock?(): number; // seconds
  getenv?(name: string): string | undefined;
  writeFile?(path: string, data: Uint8Array): void;
  write?(text: string): void;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function strftime(fmt: string, d: Date, utc: boolean): string {
  const g = {
    Y: utc ? d.getUTCFullYear() : d.getFullYear(),
    m: utc ? d.getUTCMonth() : d.getMonth(),
    d: utc ? d.getUTCDate() : d.getDate(),
    H: utc ? d.getUTCHours() : d.getHours(),
    M: utc ? d.getUTCMinutes() : d.getMinutes(),
    S: utc ? d.getUTCSeconds() : d.getSeconds(),
    w: utc ? d.getUTCDay() : d.getDay(),
  };
  const p2 = (n: number) => String(n).padStart(2, "0");
  const yday = Math.floor((Date.UTC(g.Y, g.m, g.d) - Date.UTC(g.Y, 0, 1)) / 86400000);
  const rec = (c: string): string => {
    switch (c) {
      case "a": return DAYS[g.w]!.slice(0, 3);
      case "A": return DAYS[g.w]!;
      case "b": case "h": return MONTHS[g.m]!.slice(0, 3);
      case "B": return MONTHS[g.m]!;
      case "c": return strftime("%a %b %d %H:%M:%S %Y", d, utc);
      case "d": return p2(g.d);
      case "H": return p2(g.H);
      case "I": return p2(g.H % 12 === 0 ? 12 : g.H % 12);
      case "j": return String(yday + 1).padStart(3, "0");
      case "m": return p2(g.m + 1);
      case "M": return p2(g.M);
      case "p": return g.H < 12 ? "AM" : "PM";
      case "S": return p2(g.S);
      case "U": return p2(Math.floor((yday + 7 - g.w) / 7));
      case "w": return String(g.w);
      case "W": return p2(Math.floor((yday + 7 - ((g.w + 6) % 7)) / 7));
      case "x": return strftime("%m/%d/%y", d, utc);
      case "X": return strftime("%H:%M:%S", d, utc);
      case "y": return p2(g.Y % 100);
      case "Y": return String(g.Y);
      case "Z": return utc ? "UTC" : "";
      case "%": return "%";
      default: return "%" + c;
    }
  };
  return fmt.replace(/%(.)/g, (_m, c: string) => rec(c));
}

function installOs(G: LuaState, host: OsHost): void {
  const now = host.now ?? (() => Date.now());
  const t0 = host.clock ? host.clock() : performance.now() / 1000;
  makeLib(G.globals, "os", {
    time(_L, a) {
      if (a[0] === undefined) return [Math.floor(now() / 1000)];
      const t = checkTable(a, 0, "time");
      const field = (k: string, def?: number): number => {
        const v = t.getStr(k);
        if (v === undefined) {
          if (def === undefined) throw new LuaError(`field '${k}' missing in date table`);
          return def;
        }
        if (typeof v !== "number") throw new LuaError(`field '${k}' missing in date table`);
        return v;
      };
      const d = new Date(field("year"), field("month") - 1, field("day"), field("hour", 12), field("min", 0), field("sec", 0));
      return [Math.floor(d.getTime() / 1000)];
    },
    clock: () => [(host.clock ? host.clock() : performance.now() / 1000) - t0],
    date(_L, a) {
      let fmt = optStr(a, 0, "date", "%c");
      const t = a[1] === undefined ? now() / 1000 : checkNum(a, 1, "date");
      const d = new Date(Math.floor(t) * 1000);
      let utc = false;
      if (fmt[0] === "!") { utc = true; fmt = fmt.slice(1); }
      if (fmt.startsWith("*t")) {
        const r = new LuaTable(0, 9);
        const yd = (u: boolean) => {
          const Y = u ? d.getUTCFullYear() : d.getFullYear(), m = u ? d.getUTCMonth() : d.getMonth(), dd = u ? d.getUTCDate() : d.getDate();
          return Math.floor((Date.UTC(Y, m, dd) - Date.UTC(Y, 0, 1)) / 86400000) + 1;
        };
        r.setStr("year", utc ? d.getUTCFullYear() : d.getFullYear());
        r.setStr("month", (utc ? d.getUTCMonth() : d.getMonth()) + 1);
        r.setStr("day", utc ? d.getUTCDate() : d.getDate());
        r.setStr("hour", utc ? d.getUTCHours() : d.getHours());
        r.setStr("min", utc ? d.getUTCMinutes() : d.getMinutes());
        r.setStr("sec", utc ? d.getUTCSeconds() : d.getSeconds());
        r.setStr("wday", (utc ? d.getUTCDay() : d.getDay()) + 1);
        r.setStr("yday", yd(utc));
        r.setStr("isdst", false);
        return [r];
      }
      return [strftime(fmt, d, utc)];
    },
    difftime: (_L, a) => [checkNum(a, 0, "difftime") - optNum(a, 1, "difftime", 0)],
    getenv: (_L, a) => [host.getenv?.(checkStr(a, 0, "getenv"))],
    exit() {
      throw new LuaError("os.exit called");
    },
    remove: () => [undefined, "operation not supported"],
    rename: () => [undefined, "operation not supported"],
    tmpname: () => ["tmp" + Math.floor(Math.random() * 1e9)],
    execute: () => [0],
    setlocale: (_L, a) => [a[0] === undefined || a[0] === "" || a[0] === "C" ? "C" : undefined],
  });
}

function installIo(G: LuaState, host: OsHost): void {
  const write = host.write ?? ((s: string) => host.print(s));
  const fileMeta = new LuaTable(0, 2);
  const methods = new LuaTable(0, 8);
  interface FileState { data?: string; pos: number; path?: string; out?: string; mode: string; closed: boolean }
  const getFile = (a: LuaValue[], fname: string): { u: LuaUserdata; st: FileState } => {
    const u = a[0];
    if (!(u instanceof LuaUserdata) || u.metatable !== fileMeta) argError(0, fname, "FILE* expected");
    return { u: u as LuaUserdata, st: (u as LuaUserdata).data as FileState };
  };
  const readOne = (st: FileState, fmtv: LuaValue): LuaValue => {
    const data = st.data ?? "";
    if (typeof fmtv === "number") {
      if (st.pos >= data.length && fmtv > 0) return undefined;
      const s = data.slice(st.pos, st.pos + fmtv);
      st.pos += s.length;
      return s;
    }
    const f = typeof fmtv === "string" ? fmtv.replace(/^\*/, "") : "l";
    if (f[0] === "a") {
      const s = data.slice(st.pos);
      st.pos = data.length;
      return s;
    }
    if (f[0] === "n") {
      const m = /^\s*[+-]?(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(data.slice(st.pos));
      if (!m) return undefined;
      st.pos += m[0].length;
      return Number(m[0]);
    }
    if (st.pos >= data.length) return undefined;
    let e = data.indexOf("\n", st.pos);
    let line: string;
    if (e < 0) { line = data.slice(st.pos); st.pos = data.length; }
    else { line = data.slice(st.pos, f[0] === "L" ? e + 1 : e); st.pos = e + 1; }
    return line;
  };
  const mk = (st: FileState): LuaUserdata => {
    const u = new LuaUserdata(st);
    u.metatable = fileMeta;
    return u;
  };
  const flush = (st: FileState): void => {
    if (st.path !== undefined && st.out !== undefined && host.writeFile) {
      host.writeFile(st.path, Uint8Array.from(st.out, (c) => c.charCodeAt(0)));
    }
  };
  for (const [name, impl] of Object.entries({
    read(_L: LuaThread, a: LuaValue[]) {
      const { st } = getFile(a, "read");
      if (a.length <= 1) return [readOne(st, "l")];
      return a.slice(1).map((f) => readOne(st, f));
    },
    write(_L: LuaThread, a: LuaValue[]) {
      const { u, st } = getFile(a, "write");
      for (let i = 1; i < a.length; i++) {
        const s = checkStr(a, i, "write");
        if (st.path === undefined && st.mode === "stdout") write(s);
        else st.out = (st.out ?? "") + s;
      }
      void u;
      return [true];
    },
    lines(_L: LuaThread, a: LuaValue[]) {
      const { st } = getFile(a, "lines");
      return [new LuaNative("lines_iter", () => [readOne(st, "l")])];
    },
    close(_L: LuaThread, a: LuaValue[]) {
      const { st } = getFile(a, "close");
      flush(st);
      st.closed = true;
      return [true];
    },
    flush(_L: LuaThread, a: LuaValue[]) {
      flush(getFile(a, "flush").st);
      return EMPTY;
    },
    seek(_L: LuaThread, a: LuaValue[]) {
      const { st } = getFile(a, "seek");
      const whence = optStr(a, 1, "seek", "cur");
      const off = optInt(a, 2, "seek", 0);
      const len = (st.data ?? "").length;
      st.pos = whence === "set" ? off : whence === "end" ? len + off : st.pos + off;
      return [st.pos];
    },
  })) methods.setStr(name, new LuaNative("file:" + name, impl));
  fileMeta.setStr("__index", methods);
  fileMeta.setStr("__tostring", new LuaNative("file:tostring", () => ["file (0x00000000)"]));
  const stdout = mk({ pos: 0, mode: "stdout", closed: false });
  const io = makeLib(G.globals, "io", {
    write(_L, a) {
      // like io_file_write: numbers/strings only (no tostring), result is `true` (luaL_fileresult)
      for (let i = 0; i < a.length; i++) write(checkStr(a, i, "write"));
      return [true];
    },
    read: () => [undefined],
    open(_L, a) {
      const path = checkStr(a, 0, "open");
      const mode = optStr(a, 1, "open", "r");
      if (mode.startsWith("r")) {
        const bytes = host.readFile?.(path);
        if (!bytes) return [undefined, `${path}: No such file or directory`, 2];
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
        return [mk({ data: s, pos: 0, path, mode, closed: false })];
      }
      return [mk({ pos: 0, path, mode, out: "", closed: false })];
    },
    lines(_L, a) {
      const path = checkStr(a, 0, "lines");
      const bytes = host.readFile?.(path);
      if (!bytes) throw new LuaError(`${path}: No such file or directory`);
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
      const st: FileState = { data: s, pos: 0, mode: "r", closed: false };
      return [new LuaNative("lines_iter", () => [readOne(st, "l")])];
    },
    close: () => [true],
    type(_L, a) {
      const u = a[0];
      return [u instanceof LuaUserdata && u.metatable === fileMeta ? ((u.data as FileState).closed ? "closed file" : "file") : undefined];
    },
  });
  const stdin = mk({ pos: 0, mode: "stdin", closed: false });
  io.setStr("stdout", stdout);
  io.setStr("stderr", mk({ pos: 0, mode: "stdout", closed: false }));
  io.setStr("stdin", stdin);
  // default input/output files are not switchable here: input()/output() only report the standard files
  io.setStr("flush", new LuaNative("io.flush", () => [true]));
  io.setStr("input", new LuaNative("io.input", (_L, a) => [a[0] === undefined ? stdin : a[0]]));
  io.setStr("output", new LuaNative("io.output", (_L, a) => [a[0] === undefined ? stdout : a[0]]));
  io.setStr("popen", new LuaNative("io.popen", () => {
    throw callerError("'popen' not supported");
  }));
  io.setStr("tmpfile", new LuaNative("io.tmpfile", () => [mk({ data: "", out: "", pos: 0, mode: "w+", closed: false })]));
}

// ---- debug / jit / package ---------------------------------------------------------------------------------------

function traceback(L: LuaThread, msg: string | undefined): string {
  let s = msg !== undefined ? msg + "\n" : "";
  s += "stack traceback:";
  for (let i = L.frames.length - 1; i >= 0; i--) {
    const f = L.frames[i]!;
    s += `\n\t${f.cl.proto.chunkname.replace(/^[@=]/, "")}:${f.cl.proto.lineinfo ? f.cl.proto.lineinfo[f.pc - 1] : "?"}: in function <${f.cl.proto.firstline}>`;
  }
  return s + "\n\t[C]: in ?";
}

const registry = new LuaTable(0, 4);

function installDebug(G: LuaState): void {
  makeLib(G.globals, "debug", {
    traceback(L, a) {
      let i = 0;
      let th = L;
      if (a[0] && typeof a[0] === "object" && (a[0] as { isLuaThread?: boolean }).isLuaThread) { th = a[0] as LuaThread; i = 1; }
      const msg = a[i];
      if (msg !== undefined && typeof msg !== "string" && typeof msg !== "number") return [msg];
      return [traceback(th, msg === undefined ? undefined : String(msg))];
    },
    getinfo(L, a) {
      const t = new LuaTable(0, 8);
      const f = a[0];
      let cl: LuaClosure | undefined;
      if (typeof f === "number") cl = L.frames[L.frames.length - f]?.cl;
      else if (f instanceof LuaClosure) cl = f;
      t.setStr("currentline", -1);
      t.setStr("source", cl ? cl.proto.chunkname : "=[C]");
      t.setStr("short_src", cl ? cl.proto.chunkname.replace(/^[@=]/, "") : "[C]");
      t.setStr("what", cl ? "Lua" : "C");
      t.setStr("linedefined", cl ? cl.proto.firstline : -1);
      t.setStr("func", f);
      t.setStr("nups", cl ? cl.upvals.length : 0);
      return [t];
    },
    getmetatable(L, a) {
      checkAny(a, 0, "getmetatable");
      const v = a[0];
      if (v instanceof LuaTable || v instanceof LuaUserdata) return [v.metatable];
      return [typeof v === "string" ? L.state.stringMeta : undefined];
    },
    setmetatable(_L, a) {
      const v = a[0];
      if (v instanceof LuaTable || v instanceof LuaUserdata) v.metatable = a[1] as LuaTable | undefined;
      return [v];
    },
    getfenv: (_L, a) => [a[0] instanceof LuaClosure ? a[0].env : undefined],
    setfenv(_L, a) {
      if (a[0] instanceof LuaClosure && a[1] instanceof LuaTable) a[0].env = a[1];
      return [a[0]];
    },
    // the client's scripts are stripped: no local or upvalue names, so these report nothing / empty names
    getlocal: () => [undefined],
    setlocal: () => [undefined],
    sethook: () => EMPTY,
    gethook: () => [undefined],
    getupvalue(_L, a) {
      const f = a[0], n = checkInt(a, 1, "getupvalue");
      if (!(f instanceof LuaClosure)) return [undefined];
      const uv = f.upvals[n - 1];
      return uv === undefined ? [undefined] : ["", uv.get()];
    },
    setupvalue(_L, a) {
      const f = a[0], n = checkInt(a, 1, "setupvalue");
      if (!(f instanceof LuaClosure)) return [undefined];
      const uv = f.upvals[n - 1];
      if (uv === undefined) return [undefined];
      uv.set(a[2]);
      return [""];
    },
    upvalueid(_L, a) {
      const f = a[0], n = checkInt(a, 1, "upvalueid");
      const uv = f instanceof LuaClosure ? f.upvals[n - 1] : undefined;
      return [uv === undefined ? undefined : new LuaUserdata(uv)];
    },
    upvaluejoin(_L, a) {
      const f1 = a[0], n1 = checkInt(a, 1, "upvaluejoin"), f2 = a[2], n2 = checkInt(a, 3, "upvaluejoin");
      if (f1 instanceof LuaClosure && f2 instanceof LuaClosure && f2.upvals[n2 - 1] !== undefined && n1 >= 1 && n1 <= f1.upvals.length) {
        f1.upvals[n1 - 1] = f2.upvals[n2 - 1]!;
      }
      return EMPTY;
    },
    getregistry: () => [registry],
    debug: () => EMPTY, // interactive prompt: no console here
  });
}

function installJit(G: LuaState): void {
  const jit = makeLib(G.globals, "jit", {
    on: () => EMPTY,
    off: () => EMPTY,
    flush: () => EMPTY,
    status: () => [false],
  });
  jit.setStr("version", "LuaJIT 2.0.2");
  jit.setStr("version_num", 20002);
  jit.setStr("attach", new LuaNative("jit.attach", () => EMPTY));
  jit.setStr("util", new LuaTable(0, 0));
  jit.setStr("os", "Windows");
  jit.setStr("arch", "x86");
  const opt = new LuaTable(0, 2);
  opt.setStr("start", new LuaNative("jit.opt.start", () => EMPTY));
  jit.setStr("opt", opt);
}

function installPackage(G: LuaState, host: OsHost): void {
  const g = G.globals;
  const pkg = new LuaTable(0, 4);
  const loaded = new LuaTable(0, 16);
  const preload = new LuaTable(0, 2);
  pkg.setStr("loaded", loaded);
  pkg.setStr("preload", preload);
  pkg.setStr("path", "?.lua");
  pkg.setStr("cpath", "");
  pkg.setStr("config", "\\\n;\n?\n!\n-\n"); // LUA_DIRSEP, LUA_PATHSEP, LUA_PATH_MARK, LUA_EXECDIR, LUA_IGMARK
  g.setStr("package", pkg);
  registry.setStr("_LOADED", loaded);
  registry.setStr("_PRELOAD", preload);
  pkg.setStr("loadlib", new LuaNative("package.loadlib", () => [undefined, "dynamic libraries not enabled; check your Lua installation", "absent"]));
  pkg.setStr("searchpath", new LuaNative("package.searchpath", (_L, a) => {
    const name = checkStr(a, 0, "searchpath"), path = checkStr(a, 1, "searchpath");
    const sep = a[2] === undefined ? "." : checkStr(a, 2, "searchpath"), rep = a[3] === undefined ? "\\" : checkStr(a, 3, "searchpath");
    const fname = sep === "" ? name : name.split(sep).join(rep);
    let msg = "";
    for (const tmpl of path.split(";")) {
      if (tmpl === "") continue;
      const file = tmpl.split("?").join(fname);
      if (host.readFile?.(file) !== undefined) return [file];
      msg += `\n\tno file '${file}'`;
    }
    return [undefined, msg.slice(1)];
  }));
  // the four standard loaders (preload, Lua file, C library, C root): there are no C libraries here
  const loaders = new LuaTable(4, 0);
  loaders.setInt(1, new LuaNative("loader_preload", (_L, a) => {
    const name = checkStr(a, 0, "loader");
    const f = preload.getStr(name);
    return [f !== undefined ? f : `\n\tno field package.preload['${name}']`];
  }));
  loaders.setInt(2, new LuaNative("loader_Lua", (L, a) => {
    const name = checkStr(a, 0, "loader");
    const path = pkg.getStr("path");
    if (typeof path !== "string") throw callerError("'package.path' must be a string");
    const fname = name.split(".").join("\\");
    let msg = "";
    for (const tmpl of path.split(";")) {
      if (tmpl === "") continue;
      const file = tmpl.split("?").join(fname);
      const bytes = host.readFile?.(file);
      if (bytes !== undefined) return [loadChunk(L, bytes, "@" + file, undefined, host)];
      msg += `\n\tno file '${file}'`;
    }
    return [msg];
  }));
  loaders.setInt(3, new LuaNative("loader_C", (_L, a) => {
    const name = checkStr(a, 0, "loader");
    const cpath = pkg.getStr("cpath");
    if (typeof cpath !== "string") throw callerError("'package.cpath' must be a string");
    let msg = "";
    for (const tmpl of cpath.split(";")) if (tmpl !== "") msg += `\n\tno file '${tmpl.split("?").join(name.split(".").join("\\"))}'`;
    return [msg];
  }));
  loaders.setInt(4, new LuaNative("loader_Croot", () => [undefined]));
  pkg.setStr("loaders", loaders);
  for (const name of ["string", "table", "math", "os", "io", "bit", "coroutine", "debug", "jit", "package"]) {
    const lib = g.getStr(name);
    if (lib !== undefined) loaded.setStr(name, lib);
  }
  loaded.setStr("_G", g);
  pkg.setStr("seeall", new LuaNative("package.seeall", (_L, a) => {
    const m = checkTable(a, 0, "seeall");
    if (m.metatable === undefined) m.metatable = new LuaTable(0, 1);
    m.metatable.setStr("__index", g);
    return EMPTY;
  }));
  // lj_cf_package_module: finds/creates the (dotted) global table, initialises _M/_NAME/_PACKAGE, makes it the calling
  // function's environment and applies the option functions (package.seeall)
  g.setStr("module", new LuaNative("module", (L, a) => {
    const modname = checkStr(a, 0, "module");
    let mod = loaded.getStr(modname);
    if (!(mod instanceof LuaTable)) {
      let t: LuaTable = g;
      for (const part of modname.split(".")) {
        const v = t.getStr(part);
        if (v === undefined) {
          const nt = new LuaTable(0, 1);
          t.setStr(part, nt);
          t = nt;
        } else if (v instanceof LuaTable) t = v;
        else throw callerError(`name conflict for module '${modname}'`);
      }
      mod = t;
      loaded.setStr(modname, mod);
    }
    const m = mod as LuaTable;
    if (m.getStr("_NAME") === undefined) {
      m.setStr("_M", m);
      m.setStr("_NAME", modname);
      const dot = modname.lastIndexOf(".");
      m.setStr("_PACKAGE", dot < 0 ? "" : modname.slice(0, dot + 1));
    }
    const lf = callerLevels(L)[0] ?? null;
    if (lf === null) throw callerError("'module' not called from a Lua function");
    lf.cl.env = m;
    for (let i = 1; i < a.length; i++) call(L, a[i], [m]);
    return EMPTY;
  }));
  // lj_cf_package_require: _LOADED check, then every package.loaders entry; the first function found loads the module
  const sentinel = new LuaUserdata({});
  g.setStr("require", new LuaNative("require", (L, a) => {
    const name = checkStr(a, 0, "require");
    const have = loaded.getStr(name);
    if (have !== undefined && have !== false) {
      if (have === sentinel) throw callerError(`loop or previous error loading module '${name}'`);
      return [have];
    }
    const ldrs = pkg.getStr("loaders");
    if (!(ldrs instanceof LuaTable)) throw callerError("'package.loaders' must be a table");
    let msg = "";
    let loader: LuaValue;
    for (let i = 1; ; i++) {
      const l = ldrs.getInt(i);
      if (l === undefined) throw callerError(`module '${name}' not found:${msg}`);
      const r = call(L, l, [name])[0];
      if (r instanceof LuaClosure || r instanceof LuaNative) { loader = r; break; }
      if (typeof r === "string" || typeof r === "number") msg += String(r);
    }
    loaded.setStr(name, sentinel);
    const r = call(L, loader, [name])[0];
    if (r !== undefined) loaded.setStr(name, r);
    if (loaded.getStr(name) === sentinel) loaded.setStr(name, true);
    return [loaded.getStr(name)];
  }));
}

export function installMisc(G: LuaState, host: OsHost): void {
  installMath(G);
  installBit(G);
  installCoroutine(G);
  installOs(G, host);
  installIo(G, host);
  installDebug(G);
  installJit(G);
  installPackage(G, host);
  void typeName;
  void tostringMeta;
}
