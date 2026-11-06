/**
 * LuaJIT-2.0-compatible bytecode interpreter (the client embeds LuaJIT 2.0; see bytecode.ts).
 *
 * Design:
 *  - one flat `stack` per thread, frames in an array; Lua->Lua calls never recurse on the JS stack,
 *  - `pcall`/`xpcall` are ordinary Lua closures over tiny synthetic bytecode bodies; the frame of such a body is the
 *    protected-call marker (see pcallProto), so errors and coroutine yields cross them like in LuaJIT,
 *  - error text is finished lazily (resolveError): variable names and `chunk:line:` locations are derived from the
 *    erroring frame's bytecode like lj_debug.c does,
 *  - host->Lua calls (`call()`) run a nested loop above the current frame,
 *  - metamethod semantics follow Lua 5.1 / LuaJIT 2.0 (no 5.2 compat: __len on tables and __pairs are ignored).
 */
import { LuaTable, tabDup } from "./table.ts";
import {
  Proto, PROTO_CHILD, PROTO_VARARG, PROTO_UV_LOCAL, PROTO_UV_IMMUTABLE, OP_A_MODE,
} from "./bytecode.ts";
import { luaNumberToString } from "./numfmt.ts";
import {
  LuaClosure, LuaNative, LuaUserdata, LuaError, Upval, typeName, newObjectId, opError, vmError, callerError,
} from "./value.ts";
import type { LuaValue, NativeImpl } from "./value.ts";
import { scanNumber } from "./strscan.ts";
import { luaPow } from "./cmath.ts";

export const EMPTY: LuaValue[] = [];
const LUAI_MAXSTACK = 65500; // LJ_STACK_MAX
const LUAI_MAXCCALLS = 200;
/** frame flag: pushed by call() (host / metamethod / native callback); run() returns when it returns */
const FRAME_ENTRY = 1;
/** frame flag (with FRAME_ENTRY): the call came from a native function, which counts as a level of its own */
const FRAME_CBOUNDARY = 2;

// Opcode numbers (generated from OPS in bytecode.ts; literal constants keep the switch a jump table).
const OP_ISLT = 0;
const OP_ISGE = 1;
const OP_ISLE = 2;
const OP_ISGT = 3;
const OP_ISEQV = 4;
const OP_ISNEV = 5;
const OP_ISEQS = 6;
const OP_ISNES = 7;
const OP_ISEQN = 8;
const OP_ISNEN = 9;
const OP_ISEQP = 10;
const OP_ISNEP = 11;
const OP_ISTC = 12;
const OP_ISFC = 13;
const OP_IST = 14;
const OP_ISF = 15;
const OP_MOV = 16;
const OP_NOT = 17;
const OP_UNM = 18;
const OP_LEN = 19;
const OP_ADDVN = 20;
const OP_SUBVN = 21;
const OP_MULVN = 22;
const OP_DIVVN = 23;
const OP_MODVN = 24;
const OP_ADDNV = 25;
const OP_SUBNV = 26;
const OP_MULNV = 27;
const OP_DIVNV = 28;
const OP_MODNV = 29;
const OP_ADDVV = 30;
const OP_SUBVV = 31;
const OP_MULVV = 32;
const OP_DIVVV = 33;
const OP_MODVV = 34;
const OP_POW = 35;
const OP_CAT = 36;
const OP_KSTR = 37;
const OP_KCDATA = 38;
const OP_KSHORT = 39;
const OP_KNUM = 40;
const OP_KPRI = 41;
const OP_KNIL = 42;
const OP_UGET = 43;
const OP_USETV = 44;
const OP_USETS = 45;
const OP_USETN = 46;
const OP_USETP = 47;
const OP_UCLO = 48;
const OP_FNEW = 49;
const OP_TNEW = 50;
const OP_TDUP = 51;
const OP_GGET = 52;
const OP_GSET = 53;
const OP_TGETV = 54;
const OP_TGETS = 55;
const OP_TGETB = 56;
const OP_TSETV = 57;
const OP_TSETS = 58;
const OP_TSETB = 59;
const OP_TSETM = 60;
const OP_CALLM = 61;
const OP_CALL = 62;
const OP_CALLMT = 63;
const OP_CALLT = 64;
const OP_ITERC = 65;
const OP_ITERN = 66;
const OP_VARG = 67;
const OP_ISNEXT = 68;
const OP_RETM = 69;
const OP_RET = 70;
const OP_RET0 = 71;
const OP_RET1 = 72;
const OP_FORI = 73;
const OP_JFORI = 74;
const OP_FORL = 75;
const OP_IFORL = 76;
const OP_JFORL = 77;
const OP_ITERL = 78;
const OP_IITERL = 79;
const OP_JITERL = 80;
const OP_LOOP = 81;
const OP_ILOOP = 82;
const OP_JLOOP = 83;
const OP_JMP = 84;
const OP_FUNCF = 85;
const OP_IFUNCF = 86;
const OP_JFUNCF = 87;
const OP_FUNCV = 88;
const OP_IFUNCV = 89;
const OP_JFUNCV = 90;
const OP_FUNCC = 91;
const OP_FUNCCW = 92;

export class Frame {
  varargs: LuaValue[] = EMPTY;
  pendingRa = 0;
  pendingWant = 0;
  pendingTail = false;
  constructor(
    public cl: LuaClosure,
    public base: number,
    public pc: number,
    /** absolute stack index receiving the first result */
    public retDst: number,
    /** wanted result count; -1 = all */
    public nres: number,
    public flags: number,
  ) {}
}

/** Thrown by coroutine.yield, caught by the coroutine driver. */
export class YieldSignal {
  constructor(readonly values: LuaValue[]) {}
}

export type ThreadStatus = "suspended" | "running" | "normal" | "dead";

export class LuaThread {
  readonly isLuaThread = true;
  readonly id = newObjectId();
  stack: LuaValue[] = [];
  frames: Frame[] = [];
  openUpvals: Upval[] = []; // sorted by stack index, descending
  multres = 0;
  status: ThreadStatus = "suspended";
  ccalls = 0;
  /** true while a native function called by the interpreter loop is running (errors then have no Lua location) */
  inNative = false;
  /** coroutine body, kept until the first resume */
  body: LuaValue = undefined;
  started = false;
  constructor(readonly state: LuaState) {}
}

export class LuaState {
  globals = new LuaTable();
  registry = new LuaTable();
  stringMeta: LuaTable | undefined = undefined;
  /**
   * `global_State.encoding` (+380 in the exe; `lua_setencoding`/`lua_getencoding`, KOG addition): how `luaL_loadfile`/`dofile` treat the first
   * bytes of a file. 0 = a UTF-8 BOM is accepted, 1 = a BOM (or a bytecode dump) is required, 2 = no check. A new state starts at 0; the game
   * calls `lua_setencoding(L, 1)` right after creating its state.
   */
  encoding = 0;
  readonly main: LuaThread;
  current: LuaThread;
  /** native functions with special treatment inside the interpreter loop */
  yieldFn!: LuaNative;
  nextFn!: LuaNative;
  constructor() {
    this.main = new LuaThread(this);
    this.main.status = "running";
    this.current = this.main;
    this.main.stack = new Array<LuaValue>(256).fill(undefined);
  }
}

// ---- helpers ----------------------------------------------------------------------------------------------

/** Raise an error from a native function; like lj_err_caller it is located at the Lua caller. */
export function luaError(msg: string): never {
  throw callerError(msg);
}

function growStack(L: LuaThread, need: number): void {
  if (need > LUAI_MAXSTACK + 200) throw vmError("stack overflow");
  const s = L.stack;
  let n = s.length;
  const target = Math.min(Math.max(need, n * 2), LUAI_MAXSTACK + 256);
  while (n < target) { s.push(undefined); n++; }
}

export function getMetatable(G: LuaState, v: LuaValue): LuaTable | undefined {
  if (v instanceof LuaTable) return v.metatable;
  if (typeof v === "string") return G.stringMeta;
  if (v instanceof LuaUserdata) return v.metatable;
  return undefined;
}

export function metaOf(G: LuaState, v: LuaValue, name: string): LuaValue {
  const mt = getMetatable(G, v);
  return mt === undefined ? undefined : mt.getStr(name);
}

export function isCallable(v: LuaValue): boolean {
  return v instanceof LuaClosure || v instanceof LuaNative;
}

// ---- string <-> number -------------------------------------------------------------------------------------

/**
 * Loop test of FORI/FORL (vm_x86.dasc): the SIGN BIT of the step picks the comparison, not `step > 0`. A step of +0 is "forward"
 * (idx <= stop, so `for i = 1, 3, 0` is skipped when stop < idx and endless otherwise), -0 and NaN count as negative (the x86 default
 * NaN has its sign bit set; that is what 0/0 gives), and an unordered comparison ends the loop. The caller handles step > 0.
 */
function forGoes(idx: number, stop: number, step: number): boolean {
  if (step < 0) return stop <= idx;
  return step === 0 && 1 / step > 0 ? idx <= stop : stop <= idx;
}

/** lj_strscan_num (a literal port, see strscan.ts): the number a string denotes, or undefined. */
export function strToNumber(s: string): number | undefined {
  return scanNumber(s);
}

export function toNumber(v: LuaValue): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") return strToNumber(v);
  return undefined;
}

export function tostr(v: LuaValue): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return luaNumberToString(v);
  return undefined;
}

/** Plain tostring without metamethods. */
export function rawToString(v: LuaValue): string {
  switch (typeof v) {
    case "undefined": return "nil";
    case "boolean": return v ? "true" : "false";
    case "number": return luaNumberToString(v);
    case "string": return v;
    default: {
      const id = (v as { id?: number }).id ?? 0;
      const hex = "0x" + id.toString(16).padStart(8, "0");
      if (v instanceof LuaClosure) return "function: " + hex;
      if (v instanceof LuaNative) return "function: builtin#" + hex;
      return `${typeName(v)}: ${hex}`;
    }
  }
}

// ---- calling ------------------------------------------------------------------------------------------------

/** Run a native function on behalf of host code (its caller is "C": no Lua location, no function name). */
function callNative(L: LuaThread, fn: LuaNative, args: LuaValue[]): LuaValue[] {
  const saved = L.inNative;
  L.inNative = true;
  L.ccalls++; // a native called from native code is a C boundary: coroutine.yield must fail here
  try {
    return fn.fn(L, args) ?? EMPTY;
  } catch (e) {
    if (e instanceof LuaError && e.pending !== undefined) resolveError(L, e, true);
    throw e;
  } finally {
    L.ccalls--;
    L.inNative = saved;
  }
}

/** Call any Lua value from host code; returns all results. */
export function call(L: LuaThread, fn: LuaValue, args: LuaValue[]): LuaValue[] {
  for (let depth = 0; ; depth++) {
    if (fn instanceof LuaNative) return callNative(L, fn, args);
    if (fn instanceof LuaClosure) break;
    const tm = metaOf(L.state, fn, "__call");
    if (!(tm instanceof LuaClosure || tm instanceof LuaNative)) throw opError("call", fn, -1); // lj_meta_call: __call must be a function, no chains
    args = [fn, ...args];
    fn = tm;
  }
  if (++L.ccalls > LUAI_MAXCCALLS) {
    L.ccalls--;
    throw vmError("C stack overflow");
  }
  const closure = fn as LuaClosure;
  const frames = L.frames;
  const savedNative = L.inNative;
  let fslot = 0;
  try {
    const top = frames.length ? frames[frames.length - 1]!.base + frames[frames.length - 1]!.cl.proto.framesize : 0;
    fslot = top + 1;
    const need = fslot + 1 + args.length + closure.proto.framesize + 4;
    if (need > L.stack.length) growStack(L, need);
    const stack = L.stack;
    stack[fslot] = closure;
    for (let i = 0; i < args.length; i++) stack[fslot + 1 + i] = args[i];
    const depthBefore = frames.length;
    pushLuaFrame(L, closure, fslot + 1, args.length, fslot, -1, savedNative ? FRAME_ENTRY | FRAME_CBOUNDARY : FRAME_ENTRY);
    L.inNative = false;
    run(L, depthBefore);
  } finally {
    L.ccalls--;
    L.inNative = savedNative;
  }
  return L.stack.slice(fslot, fslot + L.multres);
}

function pushLuaFrame(L: LuaThread, cl: LuaClosure, base: number, nargs: number, retDst: number, nres: number, flags: number): Frame {
  const p = cl.proto;
  const stack = L.stack;
  const need = base + p.framesize + 8;
  if (need > stack.length) growStack(L, need);
  if (base + p.framesize > LUAI_MAXSTACK) throw vmError("stack overflow");
  const np = p.numparams;
  const f = new Frame(cl, base, 1, retDst, nres, flags);
  if (p.flags & PROTO_VARARG && nargs > np) f.varargs = stack.slice(base + np, base + nargs);
  for (let i = nargs; i < np; i++) stack[base + i] = undefined;
  L.frames.push(f);
  return f;
}

// ---- upvalues -----------------------------------------------------------------------------------------------

function findUpval(L: LuaThread, idx: number, immutable: boolean): Upval {
  const open = L.openUpvals;
  let i = 0;
  while (i < open.length && open[i]!.idx > idx) i++;
  if (i < open.length && open[i]!.idx === idx) return open[i]!;
  const uv = new Upval(L, idx, immutable);
  open.splice(i, 0, uv);
  return uv;
}

function closeUpvals(L: LuaThread, level: number): void {
  const open = L.openUpvals;
  while (open.length && open[0]!.idx >= level) open.shift()!.close();
}

// ---- metamethod-aware operations ------------------------------------------------------------------------------

export function index(L: LuaThread, obj: LuaValue, key: LuaValue): LuaValue {
  for (let loop = 0; loop < 100; loop++) {
    let tm: LuaValue;
    if (obj instanceof LuaTable) {
      const v = obj.get(key);
      if (v !== undefined) return v;
      const mt = obj.metatable;
      if (mt === undefined) return undefined;
      tm = mt.getStr("__index");
      if (tm === undefined) return undefined;
    } else {
      tm = metaOf(L.state, obj, "__index");
      if (tm === undefined) throw opError("index", obj, loop === 0 ? 0 : -1);
    }
    if (tm instanceof LuaClosure || tm instanceof LuaNative) return call(L, tm, [obj, key])[0];
    obj = tm;
  }
  throw vmError("loop in gettable");
}

function checkKey(key: LuaValue): void {
  if (key === undefined) throw vmError("table index is nil");
  if (typeof key === "number" && key !== key) throw vmError("table index is NaN");
}

export function setIndex(L: LuaThread, obj: LuaValue, key: LuaValue, val: LuaValue): void {
  for (let loop = 0; loop < 100; loop++) {
    let tm: LuaValue;
    if (obj instanceof LuaTable) {
      const mt = obj.metatable;
      if (mt === undefined) {
        checkKey(key);
        obj.set(key, val);
        return;
      }
      if (obj.get(key) !== undefined) {
        obj.set(key, val);
        return;
      }
      tm = mt.getStr("__newindex");
      if (tm === undefined) {
        checkKey(key);
        obj.set(key, val);
        return;
      }
    } else {
      tm = metaOf(L.state, obj, "__newindex");
      if (tm === undefined) throw opError("index", obj, loop === 0 ? 0 : -1);
    }
    if (tm instanceof LuaClosure || tm instanceof LuaNative) {
      call(L, tm, [obj, key, val]);
      return;
    }
    obj = tm;
  }
  throw vmError("loop in settable");
}

const ARITH_NAMES = ["__add", "__sub", "__mul", "__div", "__mod", "__pow"] as const;

function numArith(op: number, a: number, b: number): number {
  switch (op) {
    case 0: return a + b;
    case 1: return a - b;
    case 2: return a * b;
    case 3: return a / b;
    case 4: return a - Math.floor(a / b) * b;
    default: return luaPow(a, b);
  }
}

/** op: 0 add, 1 sub, 2 mul, 3 div, 4 mod, 5 pow */
export function arith(L: LuaThread, op: number, a: LuaValue, b: LuaValue): LuaValue {
  const x = toNumber(a), y = toNumber(b);
  if (x !== undefined && y !== undefined) return numArith(op, x, y);
  const G = L.state;
  const name = ARITH_NAMES[op]!;
  let tm = metaOf(G, a, name);
  if (tm === undefined) tm = metaOf(G, b, name);
  if (tm === undefined) throw x === undefined ? opError("perform arithmetic on", a, 0) : opError("perform arithmetic on", b, 1);
  return call(L, tm, [a, b])[0];
}

export function unm(L: LuaThread, a: LuaValue): LuaValue {
  const x = toNumber(a);
  if (x !== undefined) return -x;
  const tm = metaOf(L.state, a, "__unm");
  if (tm === undefined) throw opError("perform arithmetic on", a, 0);
  return call(L, tm, [a, a])[0];
}

export function len(L: LuaThread, a: LuaValue): LuaValue {
  if (typeof a === "string") return a.length;
  if (a instanceof LuaTable) return a.length();
  const tm = metaOf(L.state, a, "__len");
  if (tm === undefined) throw opError("get length of", a, 0);
  return call(L, tm, [a, a])[0];
}

function cmpError(a: LuaValue, b: LuaValue): LuaError {
  const t1 = typeName(a), t2 = typeName(b);
  return vmError(t1 === t2 ? `attempt to compare two ${t1} values` : `attempt to compare ${t1} with ${t2}`);
}

/** LuaJIT's `itype(o1) == itype(o2)`: same type, except that `true` and `false` are different types there. */
function sameItype(a: LuaValue, b: LuaValue): boolean {
  if (typeof a === "boolean") return a === b;
  return typeName(a) === typeName(b);
}

/**
 * lj_meta_comp (x2.exe.c, lj_meta_* L2481315+): ordered comparison with LuaJIT's operand and metamethod order, which is NOT the
 * Lua 5.1 one.  `op` is the bytecode (0 ISLT, 1 ISGE, 2 ISLE, 3 ISGT); o1 is always the A operand and o2 the D operand.
 * Returns whether the instruction's jump condition holds.
 *   LT: __lt(o1,o2)           GE: not __lt(o1,o2)
 *   LE: __le(o1,o2), or if there is no __le: not __lt(o2,o1)
 *   GT: not __le(o1,o2), or if there is no __le: __lt(o2,o1)
 * Metamethods are only used when both operands have the same metamethod (lj_obj_equal(mo, mo2)).
 */
export function metaComp(L: LuaThread, o1: LuaValue, o2: LuaValue, op: number): boolean {
  if (sameItype(o1, o2)) {
    if (typeof o1 === "string" && typeof o2 === "string") {
      const res = o1 < o2 ? -1 : o1 === o2 ? 0 : 1; // byte strings: lj_str_cmp
      return ((op & 2) !== 0 ? res <= 0 : res < 0) !== ((op & 1) !== 0);
    }
  } else if (!(typeof o1 === "boolean" && typeof o2 === "boolean")) {
    throw cmpError(o1, o2);
  }
  const G = L.state;
  for (;;) {
    const mm = (op & 2) !== 0 ? "__le" : "__lt";
    const mo = metaOf(G, o1, mm);
    if (mo === undefined || mo !== metaOf(G, o2, mm)) {
      if ((op & 2) !== 0) { // no __le: retry with __lt, operands swapped and the condition flipped
        const t = o1; o1 = o2; o2 = t;
        op ^= 3;
        continue;
      }
      throw cmpError(o1, o2);
    }
    const r = call(L, mo, [o1, o2])[0];
    const truth = r !== undefined && r !== false;
    return (op & 1) !== 0 ? !truth : truth;
  }
}

/** `a < b` as seen by the C API (lua_lessthan): used by table.sort. */
export function lessThan(L: LuaThread, a: LuaValue, b: LuaValue): boolean {
  if (typeof a === "number" && typeof b === "number") return a < b;
  return metaComp(L, a, b, 0);
}

/** `a <= b` as seen by the C API (lua_lessequal). */
export function lessEqual(L: LuaThread, a: LuaValue, b: LuaValue): boolean {
  if (typeof a === "number" && typeof b === "number") return a <= b;
  return metaComp(L, a, b, 2);
}

export function equals(L: LuaThread, a: LuaValue, b: LuaValue): boolean {
  if (a === b) return true;
  if (typeof a === "object" || typeof b === "object") {
    if (a instanceof LuaTable && b instanceof LuaTable || a instanceof LuaUserdata && b instanceof LuaUserdata) {
      const G = L.state;
      const tm = metaOf(G, a, "__eq");
      if (tm !== undefined && tm === metaOf(G, b, "__eq")) {
        const r = call(L, tm, [a, b])[0];
        return r !== undefined && r !== false;
      }
    }
  }
  return false;
}

/** `leftSlot` = absolute stack slot of `a` (its right neighbour `b` is the running result in leftSlot + 1). */
function concat2(L: LuaThread, a: LuaValue, b: LuaValue, leftSlot: number): LuaValue {
  const sa = tostr(a), sb = tostr(b);
  if (sa !== undefined && sb !== undefined) return sa + sb;
  const G = L.state;
  let tm = metaOf(G, a, "__concat");
  if (tm === undefined) tm = metaOf(G, b, "__concat");
  if (tm === undefined) throw sa === undefined ? opError("concatenate", a, 0, leftSlot) : opError("concatenate", b, 1, leftSlot + 1);
  return call(L, tm, [a, b])[0];
}

function concatRange(L: LuaThread, from: number, to: number): LuaValue {
  const stack = L.stack;
  // fast path: all strings/numbers
  let allStr = true;
  for (let i = from; i <= to; i++) {
    const v = stack[i];
    if (typeof v !== "string" && typeof v !== "number") { allStr = false; break; }
  }
  if (allStr) {
    let s = "";
    for (let i = from; i <= to; i++) {
      const v = stack[i] as string | number;
      s += typeof v === "string" ? v : luaNumberToString(v);
    }
    return s;
  }
  let acc = stack[to];
  for (let i = to - 1; i >= from; i--) acc = concat2(L, stack[i], acc, i);
  return acc;
}

export function tostringMeta(L: LuaThread, v: LuaValue): string {
  const tm = metaOf(L.state, v, "__tostring");
  if (tm !== undefined) {
    const r = call(L, tm, [v])[0];
    if (typeof r !== "string") throw callerError("'__tostring' must return a string");
    return r;
  }
  return rawToString(v);
}

function forPrep(v: LuaValue, what: string): number {
  const n = toNumber(v);
  if (n === undefined) throw vmError(`'for' ${what} must be a number`);
  return n;
}

// ---- error handling ---------------------------------------------------------------------------------------------

/** lj_err_run: run the xpcall handler; an error inside the handler (or a non-function handler) gives "error in error handling". */
function runErrorHandler(L: LuaThread, h: LuaValue, ev: LuaValue): LuaValue {
  if (!(h instanceof LuaClosure || h instanceof LuaNative)) return "error in error handling";
  try {
    return call(L, h, [ev])[0];
  } catch (e2) {
    if (!(e2 instanceof LuaError)) throw e2;
    return "error in error handling";
  }
}

/**
 * Unwind to the nearest protected frame. Returns 0 when it is below `entryDepth` (or absent): the frames of this run are dropped
 * and the caller rethrows; 1 to continue running the loop; 2 when the protected frame was the host-entry frame of this run.
 * The xpcall handler runs before any unwinding, so it sees the stack of the error (debug.traceback).
 */
function handleError(L: LuaThread, e: LuaError, entryDepth: number): number {
  const frames = L.frames;
  const stack = L.stack;
  let i = frames.length - 1;
  while (i >= 0 && frames[i]!.cl.proto.pcallKind === 0) i--;
  if (i >= 0 && !e.handled && frames[i]!.cl.proto.pcallKind === 2) {
    e.value = runErrorHandler(L, stack[frames[i]!.base + 1], e.value);
    e.handled = true;
  }
  if (i < entryDepth) {
    if (frames.length > entryDepth) {
      closeUpvals(L, frames[entryDepth]!.base);
      frames.length = entryDepth;
    }
    return 0;
  }
  const f = frames[i]!;
  closeUpvals(L, f.base);
  frames.length = i;
  const dst = f.retDst;
  if (dst + 4 > stack.length) growStack(L, dst + 5);
  stack[dst] = false;
  stack[dst + 1] = e.value;
  finishResults(L, dst, f.nres, 2);
  return (f.flags & FRAME_ENTRY) !== 0 ? 2 : 1;
}

/** Deliver `res` as the results of `frame` (already popped). Returns true when `frame` was a host-entry frame. */
function doReturn(L: LuaThread, frame: Frame, res: LuaValue[]): boolean {
  const stack = L.stack;
  const n = res.length;
  const dst = frame.retDst, want = frame.nres;
  if (want < 0) {
    if (dst + n + 3 > stack.length) growStack(L, dst + n + 4);
    for (let i = 0; i < n; i++) stack[dst + i] = res[i];
    L.multres = n;
  } else {
    if (dst + want + 3 > stack.length) growStack(L, dst + want + 4);
    for (let i = 0; i < want; i++) stack[dst + i] = res[i];
  }
  return (frame.flags & FRAME_ENTRY) !== 0;
}

/** After `n` values were stored at stack[dst..], adjust to `want` results (nil-fill) or set multres when want < 0. */
function finishResults(L: LuaThread, dst: number, want: number, n: number): void {
  if (want < 0) {
    L.multres = n;
    return;
  }
  const stack = L.stack;
  if (dst + want + 1 > stack.length) growStack(L, dst + want + 2);
  for (let i = n; i < want; i++) stack[dst + i] = undefined;
}

// ---- the interpreter ---------------------------------------------------------------------------------------------

export function run(L: LuaThread, entryDepth: number): void {
  for (;;) {
    try {
      runLoop(L, entryDepth);
      return;
    } catch (e) {
      if (e instanceof LuaError) {
        if (e.pending !== undefined) resolveError(L, e);
        L.inNative = false;
        const r = handleError(L, e, entryDepth);
        if (r === 1) continue;
        if (r === 2) return;
        throw e;
      }
      if (e instanceof YieldSignal) {
        L.inNative = false;
        throw e;
      }
      if (e instanceof RangeError) {
        // JS stack exhausted by runaway host recursion
        const err = vmError("stack overflow");
        resolveError(L, err);
        L.inNative = false;
        const r = handleError(L, err, entryDepth);
        if (r === 1) continue;
        if (r === 2) return;
        throw err;
      }
      throw e;
    }
  }
}

function runLoop(L: LuaThread, entryDepth: number): void {
  const G = L.state;
  const stack = L.stack;
  const frames = L.frames;
  let frame = frames[frames.length - 1]!;
  let cl = frame.cl;
  let pt = cl.proto;
  let bc = pt.bc;
  let kgc = pt.kgc;
  let kn = pt.kn;
  let base = frame.base;
  let pc = frame.pc;

  for (;;) {
    const ins = bc[pc++]!;
    switch (ins & 0xff) {
      // ---- comparisons (followed by a JMP) ----
      case OP_ISLT: {
        const a = stack[base + ((ins >>> 8) & 0xff)], d = stack[base + (ins >>> 16)];
        frame.pc = pc;
        const r = typeof a === "number" && typeof d === "number" ? a < d : metaComp(L, a, d, 0);
        if (r) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      case OP_ISGE: {
        const a = stack[base + ((ins >>> 8) & 0xff)], d = stack[base + (ins >>> 16)];
        frame.pc = pc;
        const r = typeof a === "number" && typeof d === "number" ? !(a < d) : metaComp(L, a, d, 1); // ISGE is "not ISLT": true for NaN
        if (r) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      case OP_ISLE: {
        const a = stack[base + ((ins >>> 8) & 0xff)], d = stack[base + (ins >>> 16)];
        frame.pc = pc;
        const r = typeof a === "number" && typeof d === "number" ? a <= d : metaComp(L, a, d, 2);
        if (r) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      case OP_ISGT: {
        const a = stack[base + ((ins >>> 8) & 0xff)], d = stack[base + (ins >>> 16)];
        frame.pc = pc;
        const r = typeof a === "number" && typeof d === "number" ? !(a <= d) : metaComp(L, a, d, 3); // ISGT is "not ISLE": true for NaN
        if (r) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      case OP_ISEQV: case OP_ISNEV: {
        const a = stack[base + ((ins >>> 8) & 0xff)], d = stack[base + (ins >>> 16)];
        frame.pc = pc;
        const eq = a === d || (typeof a === "object" && typeof d === "object" && equals(L, a, d));
        if (eq === ((ins & 0xff) === OP_ISEQV)) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      case OP_ISEQS: case OP_ISNES: {
        const eq = stack[base + ((ins >>> 8) & 0xff)] === (kgc[ins >>> 16] as string);
        if (eq === ((ins & 0xff) === OP_ISEQS)) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      case OP_ISEQN: case OP_ISNEN: {
        const eq = stack[base + ((ins >>> 8) & 0xff)] === kn[ins >>> 16];
        if (eq === ((ins & 0xff) === OP_ISEQN)) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      case OP_ISEQP: case OP_ISNEP: {
        const d = ins >>> 16;
        const eq = stack[base + ((ins >>> 8) & 0xff)] === (d === 0 ? undefined : d === 1 ? false : true);
        if (eq === ((ins & 0xff) === OP_ISEQP)) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      // ---- unary test and copy ----
      case OP_ISTC: {
        const v = stack[base + (ins >>> 16)];
        if (v !== undefined && v !== false) { stack[base + ((ins >>> 8) & 0xff)] = v; pc += (bc[pc]! >>> 16) - 0x7fff; } else pc++;
        break;
      }
      case OP_ISFC: {
        const v = stack[base + (ins >>> 16)];
        if (v === undefined || v === false) { stack[base + ((ins >>> 8) & 0xff)] = v; pc += (bc[pc]! >>> 16) - 0x7fff; } else pc++;
        break;
      }
      case OP_IST: {
        const v = stack[base + (ins >>> 16)];
        if (v !== undefined && v !== false) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      case OP_ISF: {
        const v = stack[base + (ins >>> 16)];
        if (v === undefined || v === false) pc += (bc[pc]! >>> 16) - 0x7fff; else pc++;
        break;
      }
      // ---- unary ----
      case OP_MOV:
        stack[base + ((ins >>> 8) & 0xff)] = stack[base + (ins >>> 16)];
        break;
      case OP_NOT: {
        const v = stack[base + (ins >>> 16)];
        stack[base + ((ins >>> 8) & 0xff)] = v === undefined || v === false;
        break;
      }
      case OP_UNM: {
        const v = stack[base + (ins >>> 16)];
        frame.pc = pc;
        stack[base + ((ins >>> 8) & 0xff)] = typeof v === "number" ? -v : unm(L, v);
        break;
      }
      case OP_LEN: {
        const v = stack[base + (ins >>> 16)];
        frame.pc = pc;
        stack[base + ((ins >>> 8) & 0xff)] = typeof v === "string" ? v.length : v instanceof LuaTable ? v.length() : len(L, v);
        break;
      }
      // ---- arithmetic: VN (var op num), NV (num op var), VV ----
      case OP_ADDVN: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? b + c : arith(L, 0, b, c); break; }
      case OP_SUBVN: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? b - c : arith(L, 1, b, c); break; }
      case OP_MULVN: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? b * c : arith(L, 2, b, c); break; }
      case OP_DIVVN: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? b / c : arith(L, 3, b, c); break; }
      case OP_MODVN: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? b - Math.floor(b / c) * c : arith(L, 4, b, c); break; }
      case OP_ADDNV: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? c + b : arith(L, 0, c, b); break; }
      case OP_SUBNV: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? c - b : arith(L, 1, c, b); break; }
      case OP_MULNV: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? c * b : arith(L, 2, c, b); break; }
      case OP_DIVNV: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? c / b : arith(L, 3, c, b); break; }
      case OP_MODNV: { const b = stack[base + (ins >>> 24)]; const c = kn[(ins >>> 16) & 0xff]!; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" ? c - Math.floor(c / b) * b : arith(L, 4, c, b); break; }
      case OP_ADDVV: { const b = stack[base + (ins >>> 24)], c = stack[base + ((ins >>> 16) & 0xff)]; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" && typeof c === "number" ? b + c : arith(L, 0, b, c); break; }
      case OP_SUBVV: { const b = stack[base + (ins >>> 24)], c = stack[base + ((ins >>> 16) & 0xff)]; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" && typeof c === "number" ? b - c : arith(L, 1, b, c); break; }
      case OP_MULVV: { const b = stack[base + (ins >>> 24)], c = stack[base + ((ins >>> 16) & 0xff)]; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" && typeof c === "number" ? b * c : arith(L, 2, b, c); break; }
      case OP_DIVVV: { const b = stack[base + (ins >>> 24)], c = stack[base + ((ins >>> 16) & 0xff)]; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" && typeof c === "number" ? b / c : arith(L, 3, b, c); break; }
      case OP_MODVV: { const b = stack[base + (ins >>> 24)], c = stack[base + ((ins >>> 16) & 0xff)]; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" && typeof c === "number" ? b - Math.floor(b / c) * c : arith(L, 4, b, c); break; }
      case OP_POW: { const b = stack[base + (ins >>> 24)], c = stack[base + ((ins >>> 16) & 0xff)]; frame.pc = pc; stack[base + ((ins >>> 8) & 0xff)] = typeof b === "number" && typeof c === "number" ? luaPow(b, c) : arith(L, 5, b, c); break; }
      case OP_CAT: {
        const b = ins >>> 24, c = (ins >>> 16) & 0xff;
        frame.pc = pc;
        const r = concatRange(L, base + b, base + c);
        stack[base + ((ins >>> 8) & 0xff)] = r;
        break;
      }
      // ---- constants ----
      case OP_KSTR: stack[base + ((ins >>> 8) & 0xff)] = kgc[ins >>> 16] as string; break;
      case OP_KSHORT: stack[base + ((ins >>> 8) & 0xff)] = (ins >> 16); break;
      case OP_KNUM: stack[base + ((ins >>> 8) & 0xff)] = kn[ins >>> 16]; break;
      case OP_KPRI: { const d = ins >>> 16; stack[base + ((ins >>> 8) & 0xff)] = d === 0 ? undefined : d === 1 ? false : true; break; }
      case OP_KNIL: {
        for (let i = base + ((ins >>> 8) & 0xff), e = base + (ins >>> 16); i <= e; i++) stack[i] = undefined;
        break;
      }
      // ---- upvalues and functions ----
      case OP_UGET: stack[base + ((ins >>> 8) & 0xff)] = cl.upvals[ins >>> 16]!.get(); break;
      case OP_USETV: cl.upvals[(ins >>> 8) & 0xff]!.set(stack[base + (ins >>> 16)]); break;
      case OP_USETS: cl.upvals[(ins >>> 8) & 0xff]!.set(kgc[ins >>> 16] as string); break;
      case OP_USETN: cl.upvals[(ins >>> 8) & 0xff]!.set(kn[ins >>> 16]); break;
      case OP_USETP: { const d = ins >>> 16; cl.upvals[(ins >>> 8) & 0xff]!.set(d === 0 ? undefined : d === 1 ? false : true); break; }
      case OP_UCLO:
        closeUpvals(L, base + ((ins >>> 8) & 0xff));
        pc += (ins >>> 16) - 0x8000;
        break;
      case OP_FNEW: {
        const child = kgc[ins >>> 16] as Proto;
        const uvd = child.uv;
        const upvals: Upval[] = new Array(uvd.length);
        for (let i = 0; i < uvd.length; i++) {
          const v = uvd[i]!;
          upvals[i] = v & PROTO_UV_LOCAL
            ? findUpval(L, base + (v & 0xff), (v & PROTO_UV_IMMUTABLE) !== 0)
            : cl.upvals[v & 0xff]!;
        }
        stack[base + ((ins >>> 8) & 0xff)] = new LuaClosure(child, cl.env, upvals);
        break;
      }
      // ---- tables ----
      case OP_TNEW: {
        const d = ins >>> 16;
        stack[base + ((ins >>> 8) & 0xff)] = new LuaTable(d & 0x7ff, d >>> 11);
        break;
      }
      case OP_TDUP: stack[base + ((ins >>> 8) & 0xff)] = tabDup(kgc[ins >>> 16] as LuaTable); break;
      case OP_GGET: {
        const key = kgc[ins >>> 16] as string;
        const env = cl.env;
        let v = env.getStr(key);
        if (v === undefined && env.metatable !== undefined) { frame.pc = pc; v = index(L, env, key); }
        stack[base + ((ins >>> 8) & 0xff)] = v;
        break;
      }
      case OP_GSET: {
        const key = kgc[ins >>> 16] as string;
        const env = cl.env;
        const v = stack[base + ((ins >>> 8) & 0xff)];
        if (env.metatable === undefined) env.setStr(key, v);
        else { frame.pc = pc; setIndex(L, env, key, v); }
        break;
      }
      case OP_TGETV: {
        const t = stack[base + (ins >>> 24)], k = stack[base + ((ins >>> 16) & 0xff)];
        let v: LuaValue;
        if (t instanceof LuaTable) {
          v = typeof k === "number" ? ((k | 0) === k ? t.getInt(k) : t.get(k)) : t.get(k);
          if (v === undefined && t.metatable !== undefined) { frame.pc = pc; v = index(L, t, k); }
        } else { frame.pc = pc; v = index(L, t, k); }
        stack[base + ((ins >>> 8) & 0xff)] = v;
        break;
      }
      case OP_TGETS: {
        const t = stack[base + (ins >>> 24)], k = kgc[(ins >>> 16) & 0xff] as string;
        let v: LuaValue;
        if (t instanceof LuaTable) {
          v = t.getStr(k);
          if (v === undefined && t.metatable !== undefined) { frame.pc = pc; v = index(L, t, k); }
        } else { frame.pc = pc; v = index(L, t, k); }
        stack[base + ((ins >>> 8) & 0xff)] = v;
        break;
      }
      case OP_TGETB: {
        const t = stack[base + (ins >>> 24)], k = (ins >>> 16) & 0xff;
        let v: LuaValue;
        if (t instanceof LuaTable) {
          v = t.getInt(k);
          if (v === undefined && t.metatable !== undefined) { frame.pc = pc; v = index(L, t, k); }
        } else { frame.pc = pc; v = index(L, t, k); }
        stack[base + ((ins >>> 8) & 0xff)] = v;
        break;
      }
      case OP_TSETV: {
        const t = stack[base + (ins >>> 24)], k = stack[base + ((ins >>> 16) & 0xff)], v = stack[base + ((ins >>> 8) & 0xff)];
        frame.pc = pc;
        if (t instanceof LuaTable && t.metatable === undefined) {
          if (typeof k === "number" && (k | 0) === k) t.setInt(k, v);
          else { checkKey(k); t.set(k, v); }
        } else setIndex(L, t, k, v);
        break;
      }
      case OP_TSETS: {
        const t = stack[base + (ins >>> 24)], k = kgc[(ins >>> 16) & 0xff] as string, v = stack[base + ((ins >>> 8) & 0xff)];
        if (t instanceof LuaTable && t.metatable === undefined) t.setStr(k, v);
        else { frame.pc = pc; setIndex(L, t, k, v); }
        break;
      }
      case OP_TSETB: {
        const t = stack[base + (ins >>> 24)], k = (ins >>> 16) & 0xff, v = stack[base + ((ins >>> 8) & 0xff)];
        if (t instanceof LuaTable && t.metatable === undefined) t.setInt(k, v);
        else { frame.pc = pc; setIndex(L, t, k, v); }
        break;
      }
      case OP_TSETM: {
        const ra = base + ((ins >>> 8) & 0xff);
        const t = stack[ra - 1] as LuaTable;
        const start = kn[ins >>> 16]! - 2 ** 52;
        const n = L.multres;
        if (n > 0) { // vm_x86.dasc BC_TSETM: "Nothing to copy?" skips everything
          // needed = n + start; a bigger array is made with lj_tab_reasize(L, t, needed) = needed + 1 slots (one spare slot, which
          // is visible through the border search of #t)
          if (start + n > t.asize) t.reasize(start + n);
          for (let i = 0; i < n; i++) t.setInt(start + i, stack[ra + i]);
        }
        break;
      }
      // ---- calls ----
      case OP_CALL: case OP_CALLM: {
        const ra = base + ((ins >>> 8) & 0xff);
        const c = (ins >>> 16) & 0xff;
        let nargs = (ins & 0xff) === OP_CALL ? c - 1 : c + L.multres;
        const want = (ins >>> 24) - 1;
        let fn = stack[ra];
        frame.pc = pc;
        if (fn instanceof LuaClosure) {
          frame = pushLuaFrame(L, fn, ra + 1, nargs, ra, want, 0);
          cl = fn; pt = cl.proto; bc = pt.bc; kgc = pt.kgc; kn = pt.kn; base = frame.base; pc = 1;
          break;
        }
        // __call resolution
        for (let depth = 0; !(fn instanceof LuaClosure || fn instanceof LuaNative); depth++) {
          const tm = metaOf(G, fn, "__call");
          if (!(tm instanceof LuaClosure || tm instanceof LuaNative)) throw opError("call", fn, 0); // lj_meta_call: __call must be a function, no chains
          if (ra + nargs + 3 > stack.length) growStack(L, ra + nargs + 4);
          for (let i = nargs; i >= 0; i--) stack[ra + 1 + i] = stack[ra + i];
          nargs++;
          stack[ra] = tm;
          fn = tm;
        }
        if (fn instanceof LuaClosure) {
          frame = pushLuaFrame(L, fn, ra + 1, nargs, ra, want, 0);
          cl = fn; pt = cl.proto; bc = pt.bc; kgc = pt.kgc; kn = pt.kn; base = frame.base; pc = 1;
          break;
        }
        // plain native call
        const nf = fn as LuaNative;
        const args = stack.slice(ra + 1, ra + 1 + nargs);
        frame.pendingRa = ra;
        frame.pendingWant = want;
        L.inNative = true;
        const res = nf.fn(L, args) ?? EMPTY;
        L.inNative = false;
        const n = res.length;
        if (want < 0) {
          if (ra + n + 3 > stack.length) growStack(L, ra + n + 4);
          for (let i = 0; i < n; i++) stack[ra + i] = res[i];
          L.multres = n;
        } else {
          for (let i = 0; i < want; i++) stack[ra + i] = res[i];
        }
        break;
      }
      case OP_CALLT: case OP_CALLMT: {
        const ra = base + ((ins >>> 8) & 0xff);
        const d = ins >>> 16;
        let nargs = (ins & 0xff) === OP_CALLT ? d - 1 : d + L.multres;
        let fn = stack[ra];
        frame.pc = pc;
        for (let depth = 0; !(fn instanceof LuaClosure || fn instanceof LuaNative); depth++) {
          const tm = metaOf(G, fn, "__call");
          if (!(tm instanceof LuaClosure || tm instanceof LuaNative)) throw opError("call", fn, 0); // lj_meta_call: __call must be a function, no chains
          if (ra + nargs + 3 > stack.length) growStack(L, ra + nargs + 4);
          for (let i = nargs; i >= 0; i--) stack[ra + 1 + i] = stack[ra + i];
          nargs++;
          stack[ra] = tm;
          fn = tm;
        }
        if (fn instanceof LuaClosure) {
          // proper tail call: reuse the frame, args move down to base
          if (pt.flags & PROTO_CHILD) closeUpvals(L, base);
          const nb = base;
          for (let i = 0; i < nargs; i++) stack[nb + i] = stack[ra + 1 + i];
          const p2 = fn.proto;
          const need = nb + p2.framesize + 8;
          if (need > stack.length) growStack(L, need);
          if (nb + p2.framesize > LUAI_MAXSTACK) throw vmError("stack overflow");
          const np = p2.numparams;
          frame.varargs = p2.flags & PROTO_VARARG && nargs > np ? stack.slice(nb + np, nb + nargs) : EMPTY;
          for (let i = nargs; i < np; i++) stack[nb + i] = undefined;
          frame.cl = fn;
          cl = fn; pt = p2; bc = pt.bc; kgc = pt.kgc; kn = pt.kn; pc = 1;
          break;
        }
        // tail call of a native: call it, then return its results
        const nf = fn as LuaNative;
        frame.pendingRa = ra;
        frame.pendingWant = -1;
        frame.pendingTail = true; // a yield here must resume by *returning* the resume values
        L.inNative = true;
        const res = nf.fn(L, stack.slice(ra + 1, ra + 1 + nargs)) ?? EMPTY;
        L.inNative = false;
        frame.pendingTail = false;
        if (pt.flags & PROTO_CHILD) closeUpvals(L, base);
        frames.pop();
        if (doReturn(L, frame, res)) return;
        frame = frames[frames.length - 1]!;
        cl = frame.cl; pt = cl.proto; bc = pt.bc; kgc = pt.kgc; kn = pt.kn; base = frame.base; pc = frame.pc;
        break;
      }
      case OP_ITERC: case OP_ITERN: {
        const ra = base + ((ins >>> 8) & 0xff);
        const want = (ins >>> 24) - 1;
        const fn0 = stack[ra - 3];
        // fast path: next(t, k)
        if (fn0 === G.nextFn && stack[ra - 2] instanceof LuaTable) {
          let r: [LuaValue, LuaValue] | null;
          try { r = (stack[ra - 2] as LuaTable).next(stack[ra - 1]); }
          catch { throw vmError("invalid key to 'next'"); }
          if (r === null) { stack[ra] = undefined; for (let i = 1; i < want; i++) stack[ra + i] = undefined; }
          else { stack[ra] = r[0]; if (want > 1) stack[ra + 1] = r[1]; for (let i = 2; i < want; i++) stack[ra + i] = undefined; }
          break;
        }
        stack[ra] = fn0; stack[ra + 1] = stack[ra - 2]; stack[ra + 2] = stack[ra - 1];
        frame.pc = pc;
        const fn = fn0;
        if (fn instanceof LuaClosure) {
          frame = pushLuaFrame(L, fn, ra + 1, 2, ra, want, 0);
          cl = fn; pt = cl.proto; bc = pt.bc; kgc = pt.kgc; kn = pt.kn; base = frame.base; pc = 1;
          break;
        }
        if (fn instanceof LuaNative) {
          L.inNative = true;
          const res = fn.fn(L, [stack[ra + 1], stack[ra + 2]]) ?? EMPTY;
          L.inNative = false;
          for (let i = 0; i < want; i++) stack[ra + i] = res[i];
          break;
        }
        { const tm = metaOf(G, fn, "__call"); if (!(tm instanceof LuaClosure || tm instanceof LuaNative)) throw opError("call", fn, 0); }
        const res = call(L, fn, [stack[ra + 1], stack[ra + 2]]);
        for (let i = 0; i < want; i++) stack[ra + i] = res[i];
        break;
      }
      case OP_VARG: {
        const ra = base + ((ins >>> 8) & 0xff);
        const want = ((ins >>> 24)) - 1;
        const va = frame.varargs;
        if (want < 0) {
          const n = va.length;
          if (ra + n + 4 > stack.length) growStack(L, ra + n + 5);
          for (let i = 0; i < n; i++) stack[ra + i] = va[i];
          L.multres = n;
        } else {
          for (let i = 0; i < want; i++) stack[ra + i] = va[i];
        }
        break;
      }
      case OP_ISNEXT:
        pc += (ins >>> 16) - 0x8000;
        break;
      // ---- returns ----
      case OP_RETM: case OP_RET: case OP_RET0: case OP_RET1: {
        const ra = base + ((ins >>> 8) & 0xff);
        const o = ins & 0xff;
        const n = o === OP_RETM ? (ins >>> 16) + L.multres : (ins >>> 16) - 1;
        if (pt.flags & PROTO_CHILD) closeUpvals(L, base);
        frames.pop();
        const dst = frame.retDst;
        const want = frame.nres;
        if (want < 0) {
          for (let i = 0; i < n; i++) stack[dst + i] = stack[ra + i];
          L.multres = n;
        } else {
          let i = 0;
          for (; i < want && i < n; i++) stack[dst + i] = stack[ra + i];
          for (; i < want; i++) stack[dst + i] = undefined;
        }
        if (frame.flags & FRAME_ENTRY) return;
        frame = frames[frames.length - 1]!;
        cl = frame.cl; pt = cl.proto; bc = pt.bc; kgc = pt.kgc; kn = pt.kn; base = frame.base; pc = frame.pc;
        break;
      }
      // ---- loops ----
      case OP_FORI: {
        const ra = base + ((ins >>> 8) & 0xff);
        const a = stack[ra], b = stack[ra + 1], c = stack[ra + 2];
        let idx: number, stop: number, step: number;
        if (typeof a === "number" && typeof b === "number" && typeof c === "number") { idx = a; stop = b; step = c; }
        else {
          frame.pc = pc;
          idx = forPrep(a, "initial value"); stop = forPrep(b, "limit"); step = forPrep(c, "step");
          stack[ra] = idx; stack[ra + 1] = stop; stack[ra + 2] = step;
        }
        if (step > 0 ? idx <= stop : forGoes(idx, stop, step)) { stack[ra + 3] = idx; }
        else pc += (ins >>> 16) - 0x8000;
        break;
      }
      case OP_FORL: case OP_IFORL: {
        const ra = base + ((ins >>> 8) & 0xff);
        const step = stack[ra + 2] as number, stop = stack[ra + 1] as number;
        const idx = (stack[ra] as number) + step;
        stack[ra] = idx;
        if (step > 0 ? idx <= stop : forGoes(idx, stop, step)) { stack[ra + 3] = idx; pc += (ins >>> 16) - 0x8000; }
        break;
      }
      case OP_ITERL: case OP_IITERL: {
        const ra = base + ((ins >>> 8) & 0xff);
        const v = stack[ra];
        if (v !== undefined) { stack[ra - 1] = v; pc += (ins >>> 16) - 0x8000; }
        break;
      }
      case OP_LOOP: case OP_ILOOP:
        break;
      case OP_JMP:
        pc += (ins >>> 16) - 0x8000;
        break;
      default:
        throw new LuaError(`unsupported bytecode op ${ins & 0xff}`);
    }
  }
}

// ---- thread / coroutine drivers ------------------------------------------------------------------------------------

export function newThread(G: LuaState, body: LuaValue): LuaThread {
  const co = new LuaThread(G);
  co.stack = new Array<LuaValue>(64).fill(undefined);
  co.body = body;
  return co;
}

/** Resume a coroutine. Returns [true, ...values] or [false, error]. */
export function resume(from: LuaThread, co: LuaThread, args: LuaValue[]): LuaValue[] {
  const G = from.state;
  if (co.status === "dead") return [false, "cannot resume dead coroutine"];
  if (co.status === "running" || co.status === "normal") return [false, "cannot resume running coroutine"];
  const prev = G.current;
  prev.status = "normal";
  co.status = "running";
  G.current = co;
  try {
    let results: LuaValue[];
    if (!co.started) {
      co.started = true;
      const fn = co.body;
      co.body = undefined;
      if (fn instanceof LuaNative) {
        results = callNative(co, fn, args);
      } else {
        if (!(fn instanceof LuaClosure)) throw new LuaError("attempt to call a " + typeName(fn) + " value");
        const need = 2 + args.length + fn.proto.framesize + 8;
        if (need > co.stack.length) growStack(co, need);
        co.stack[0] = fn;
        for (let i = 0; i < args.length; i++) co.stack[1 + i] = args[i];
        pushLuaFrame(co, fn, 1, args.length, 0, -1, FRAME_ENTRY);
        run(co, 0);
        results = co.stack.slice(0, co.multres);
      }
    } else {
      // deliver resume arguments as the results of the pending yield call
      const f = co.frames[co.frames.length - 1]!;
      if (f.pendingTail) {
        f.pendingTail = false;
        co.frames.pop();
        if (f.cl.proto.flags & PROTO_CHILD) closeUpvals(co, f.base);
        if (doReturn(co, f, args)) {
          results = co.stack.slice(0, co.multres);
        } else {
          run(co, 0);
          results = co.stack.slice(0, co.multres);
        }
      } else {
        const ra = f.pendingRa, want = f.pendingWant;
        const n = args.length;
        if (want < 0) {
          if (ra + n + 4 > co.stack.length) growStack(co, ra + n + 5);
          for (let i = 0; i < n; i++) co.stack[ra + i] = args[i];
          co.multres = n;
        } else {
          for (let i = 0; i < want; i++) co.stack[ra + i] = args[i];
        }
        run(co, 0);
        results = co.stack.slice(0, co.multres);
      }
    }
    co.status = "dead";
    return [true, ...results];
  } catch (e) {
    if (e instanceof YieldSignal) {
      co.status = "suspended";
      return [true, ...e.values];
    }
    co.status = "dead";
    if (e instanceof LuaError) {
      if (e.pending !== undefined) resolveError(co, e, true);
      return [false, e.value];
    }
    throw e;
  } finally {
    G.current = prev;
    prev.status = "running";
  }
}

// ---- error context (lj_debug.c / lj_err.c) -----------------------------------------------------------------------

const A_DST = 1, A_BASE = 2;

/** lj_debug_shortname: the chunk name as shown in messages (LUA_IDSIZE 60). */
export function shortName(src: string): string {
  const IDSIZE = 60;
  const c = src.charCodeAt(0);
  if (c === 0x3d /* = */) return src.slice(1, IDSIZE);
  if (c === 0x40 /* @ */) {
    if (src.length - 1 >= IDSIZE) return "..." + src.slice(src.length - (IDSIZE - 4));
    return src.slice(1);
  }
  let len = 0;
  while (len < 48 && src.charCodeAt(len) >= 0x20) len++;
  if (len < src.length) return `[string "${src.slice(0, Math.min(len, 45))}..."]`;
  return `[string "${src}"]`;
}

/** lj_debug_line: 0 when the prototype has no line info (stripped scripts, as shipped with the client). */
function debugLine(pt: Proto, pc: number): number {
  const li = pt.lineinfo;
  const sizebc = pt.bc.length;
  if (pc > sizebc || li === null) return 0;
  if (pc === sizebc) return pt.firstline + pt.numline;
  if (pc === 0) return pt.firstline;
  return pt.firstline + li[pc - 1]!;
}

/** `chunk:line: ` of a running Lua frame (lj_debug_addloc); empty for synthetic (C-like) frames. */
function frameLoc(f: Frame): string {
  const pt = f.cl.proto;
  if (pt.synthetic) return "";
  return `${shortName(pt.chunkname)}:${debugLine(pt, f.pc - 1)}: `;
}

/** Name of the value in `slot` as seen by the instruction at `pc` (lj_debug_slotname without local variable info). */
function slotName(pt: Proto, pc: number, slot: number): [string, string] | undefined {
  const bc = pt.bc;
  for (let ip = pc - 1; ip > 0; ip--) {
    const ins = bc[ip]!;
    const op = ins & 0xff;
    const a = (ins >>> 8) & 0xff;
    const am = OP_A_MODE[op]!;
    if (am === A_BASE) {
      if (slot >= a && (op !== OP_KNIL || slot <= (ins >>> 16))) return undefined;
    } else if (am === A_DST && a === slot) {
      switch (op) {
        case OP_MOV:
          slot = ins >>> 16;
          continue;
        case OP_GGET:
          return ["global", pt.kgc[ins >>> 16] as string];
        case OP_TGETS: {
          const name = pt.kgc[(ins >>> 16) & 0xff] as string;
          if (ip > 0) {
            const prev = bc[ip - 1]!;
            if ((prev & 0xff) === OP_MOV && ((prev >>> 8) & 0xff) === a + 1 && (prev >>> 16) === (ins >>> 24)) {
              return ["method", name];
            }
          }
          return ["field", name];
        }
        case OP_UGET:
          return ["upvalue", pt.uvnames?.[ins >>> 16] ?? ""];
        default:
          return undefined;
      }
    }
  }
  return undefined;
}

/** Name of the function being called by the call instruction the frame is suspended at (lj_debug_funcname). */
function callName(f: Frame): [string, string] | undefined {
  const pt = f.cl.proto;
  const pc = f.pc - 1;
  const ins = pt.bc[pc]!;
  switch (ins & 0xff) {
    case OP_CALL: case OP_CALLM: case OP_CALLT: case OP_CALLMT:
      return slotName(pt, pc, (ins >>> 8) & 0xff);
    case OP_ITERC: case OP_ITERN:
      return slotName(pt, pc, ((ins >>> 8) & 0xff) - 3);
    default:
      return undefined;
  }
}

/** Frame slot (relative to base) of the operand blamed by an `op` error raised at instruction `ins`. */
function opSlot(f: Frame, ins: number, which: number, slot: number | undefined): number | undefined {
  if (slot !== undefined) return slot - f.base;
  const op = ins & 0xff;
  switch (op) {
    case OP_TGETV: case OP_TGETS: case OP_TGETB: case OP_TSETV: case OP_TSETS: case OP_TSETB:
      return ins >>> 24;
    case OP_CALL: case OP_CALLM: case OP_CALLT: case OP_CALLMT: case OP_ITERC: case OP_ITERN:
      return (ins >>> 8) & 0xff;
    case OP_UNM: case OP_LEN:
      return ins >>> 16;
    default:
      if (op >= OP_ADDVN && op <= OP_MODNV) return ins >>> 24; // variable operand B
      if (op >= OP_ADDVV && op <= OP_POW) return which === 0 ? ins >>> 24 : (ins >>> 16) & 0xff;
      return undefined;
  }
}

/**
 * Levels as seen by a running native: [0] = its caller (level 1), then outwards. null = a C function (the native that called
 * into an entry frame). A tail-called native has replaced its Lua frame, so that frame is not a level.
 */
export function callerLevels(L: LuaThread): (Frame | null)[] {
  const frames = L.frames;
  const top = frames.length - 1;
  const seq: (Frame | null)[] = [];
  for (let i = top; i >= 0; i--) {
    const f = frames[i]!;
    if (!(i === top && f.pendingTail)) seq.push(f.cl.proto.synthetic ? null : f);
    if (f.flags & FRAME_CBOUNDARY) seq.push(null);
  }
  return seq;
}

/**
 * Finish the text of an error raised with a PendingInfo. Runs while the frames of the error are still on the stack.
 * `fromC`: the raising native was called from host code (no Lua caller).
 */
export function resolveError(L: LuaThread, e: LuaError, fromC = false): void {
  const p = e.pending;
  if (p === undefined) return;
  e.pending = undefined;
  const frames = L.frames;
  const top = frames.length - 1;
  switch (p.kind) {
    case "vm": case "op": {
      if (fromC || L.inNative || top < 0) return;
      const f = frames[top]!;
      const pt = f.cl.proto;
      if (pt.synthetic) return;
      let msg = e.value as string;
      if (p.kind === "op" && p.which >= 0) {
        const ins = pt.bc[f.pc - 1]!;
        const slot = opSlot(f, ins, p.which, p.slot);
        const nm = slot === undefined ? undefined : slotName(pt, f.pc - 1, slot);
        if (nm !== undefined) msg = `attempt to ${p.op} ${nm[0]} '${nm[1]}' (a ${p.vtype} value)`;
      }
      e.value = frameLoc(f) + msg;
      return;
    }
    case "arg": {
      if (fromC || top < 0) {
        e.value = `bad argument #${p.narg} to '${p.fname || "?"}' (${p.msg})`;
        return;
      }
      const seq = callerLevels(L);
      const cf = seq[0] ?? null;
      let name = p.fname || "?";
      let kind: string | undefined;
      if (cf !== null && !frames[top]!.pendingTail) {
        const r = callName(cf);
        if (r !== undefined) { kind = r[0]; name = r[1]; }
        else name = "?";
      } else {
        name = "?";
      }
      let narg = p.narg;
      let msg: string;
      if (kind === "method" && --narg === 0) msg = `calling '${name}' on bad self (${p.msg})`;
      else msg = `bad argument #${narg} to '${name}' (${p.msg})`;
      e.value = (cf !== null ? frameLoc(cf) : "") + msg;
      return;
    }
    case "caller": {
      if (fromC || top < 0) return;
      const cf = callerLevels(L)[0] ?? null;
      if (cf !== null) e.value = frameLoc(cf) + p.msg;
      return;
    }
    case "level": {
      if (fromC || top < 0) return;
      const lf = callerLevels(L)[p.level - 1] ?? null;
      if (lf !== null) {
        const pt = lf.cl.proto;
        const line = debugLine(pt, lf.pc - 1);
        if (line > 0) e.value = `${shortName(pt.chunkname)}:${line}: ${p.msg}`;
      }
      return;
    }
  }
}

// ---- pcall / xpcall bodies ----------------------------------------------------------------------------------------

/**
 * pcall/xpcall are LuaClosures over tiny synthetic bytecode so that a protected call is a real frame: errors unwind to it
 * (handleError), coroutine yields pass through it, and tail calls / varargs behave like for any Lua function.
 *   pcall  : KPRI 1 true; MOV 2 0; VARG 3; CALLM 2 0; RETM 1 1          (R0 = f, varargs = arguments)
 *   xpcall : KPRI 2 true; MOV 3 0; CALL 3 0 1; RETM 2 1                  (R0 = f, R1 = error handler)
 */
function syntheticProto(kind: 1 | 2): Proto {
  const ad = (op: number, a: number, d: number) => (op | (a << 8) | (d << 16)) >>> 0;
  const abc = (op: number, a: number, b: number, c: number) => (op | (a << 8) | (c << 16) | (b << 24)) >>> 0;
  const p = new Proto();
  p.synthetic = true;
  p.pcallKind = kind;
  p.chunkname = "=[C]";
  p.kgc = [];
  p.kn = new Float64Array(0);
  p.uv = new Uint16Array(0);
  p.framesize = 8;
  p.numparams = kind === 1 ? 1 : 2;
  p.flags = kind === 1 ? PROTO_VARARG : 0;
  p.bc = Uint32Array.from(kind === 1
    ? [OP_FUNCV, ad(OP_KPRI, 1, 2), ad(OP_MOV, 2, 0), abc(OP_VARG, 3, 0, 0), abc(OP_CALLM, 2, 0, 0), ad(OP_RETM, 1, 1)]
    : [OP_FUNCF, ad(OP_KPRI, 2, 2), ad(OP_MOV, 3, 0), abc(OP_CALL, 3, 0, 1), ad(OP_RETM, 2, 1)]);
  return p;
}

export function makePcall(G: LuaState): LuaClosure {
  return new LuaClosure(syntheticProto(1), G.globals, []);
}

export function makeXpcall(G: LuaState): LuaClosure {
  return new LuaClosure(syntheticProto(2), G.globals, []);
}

export function makeNative(name: string, fn: NativeImpl): LuaNative {
  return new LuaNative(name, fn);
}
