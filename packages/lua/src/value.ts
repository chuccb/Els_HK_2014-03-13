/**
 * Lua value model for the LuaJIT-2.0-compatible VM used to run the client's scripts unmodified.
 *
 *   nil      -> undefined
 *   boolean  -> boolean
 *   number   -> number (LuaJIT 2.0 without DUALNUM: every number is a double)
 *   string   -> JS string holding one *byte* per UTF-16 code unit (0..255). This keeps `#s`, s:sub, s:byte,
 *               patterns and string ordering byte-exact. Use utf8ToLua()/luaToUtf8() at the host boundary.
 *   table    -> LuaTable        (faithful port of lj_tab.c: same array/hash split, so `#t` and `pairs` order match)
 *   function -> LuaClosure | LuaNative
 *   userdata -> LuaUserdata
 *   thread   -> LuaThread
 */
import type { LuaTable } from "./table.ts";
import type { Proto } from "./bytecode.ts";

export type LuaValue = undefined | boolean | number | string | LuaTable | LuaFunction | LuaUserdata | LuaThread;
export type LuaFunction = LuaClosure | LuaNative;

/** Native (host) function: receives the call arguments, returns the results (or nothing). */
export type NativeImpl = (L: LuaThread, args: LuaValue[]) => LuaValue[] | void;

export class LuaNative {
  readonly id = newObjectId();
  constructor(readonly name: string, readonly fn: NativeImpl) {}
}

/** An upvalue cell: open (aliases a stack slot of its owner thread) or closed (holds its own value). */
export class Upval {
  closed = false;
  value: LuaValue = undefined;
  constructor(public thread: LuaThread | null, public idx: number, public immutable = false) {}
  get(): LuaValue {
    return this.closed ? this.value : this.thread!.stack[this.idx];
  }
  set(v: LuaValue): void {
    if (this.closed) this.value = v;
    else this.thread!.stack[this.idx] = v;
  }
  close(): void {
    if (!this.closed) {
      this.value = this.thread!.stack[this.idx];
      this.closed = true;
      this.thread = null;
    }
  }
}

export class LuaClosure {
  readonly id = newObjectId();
  constructor(readonly proto: Proto, public env: LuaTable, readonly upvals: Upval[]) {}
}

let nextId = 1;
/** Stable pseudo-address, used for table hashing of non-string keys and for tostring(). */
export function newObjectId(): number {
  return (nextId++ * 8 + 0x01000000) >>> 0;
}

export class LuaUserdata {
  readonly id = newObjectId();
  metatable: LuaTable | undefined = undefined;
  constructor(public data: unknown = undefined) {}
}

/**
 * Context-dependent error text. LuaJIT adds variable names ("global 'foo'") and `chunk:line:` locations while the
 * erroring frames are still on the stack; the VM does the same in `resolveError` (vm.ts) when the exception reaches
 * the interpreter loop, so errors are created cheaply by helpers and natives.
 */
export type PendingInfo =
  | { kind: "op"; op: string; vtype: string; which: number; slot?: number } // lj_err_optype / lj_err_optype_call
  | { kind: "arg"; narg: number; msg: string; fname: string } // err_argmsg
  | { kind: "caller"; msg: string } // lj_err_caller*: location of the Lua caller
  | { kind: "vm"; msg: string } // lj_err_msg*: location of the running Lua frame
  | { kind: "level"; msg: string; level: number }; // error(msg, level)

/** Raised for every Lua-level error. `value` is the Lua error value (usually a string). */
export class LuaError {
  traceback?: string;
  pending?: PendingInfo;
  /** xpcall handler already ran for this error (it runs at the error point, before unwinding) */
  handled = false;
  constructor(public value: LuaValue, pending?: PendingInfo) {
    this.pending = pending;
  }
  get message(): string {
    return typeof this.value === "string" ? luaToUtf8(this.value) : `(error object is a ${typeName(this.value)} value)`;
  }
}

/** `attempt to <op> a <type> value` raised by a VM operation (name/location added later). `which` = operand index. */
export function opError(op: string, v: LuaValue, which = 0, slot?: number): LuaError {
  const vtype = typeName(v);
  return new LuaError(`attempt to ${op} a ${vtype} value`, { kind: "op", op, vtype, which, slot });
}

/** Error raised by a native, located at its Lua caller like lj_err_caller(). */
export function callerError(msg: string): LuaError {
  return new LuaError(msg, { kind: "caller", msg });
}

/** Error raised by the VM itself (lj_err_msg): located at the running frame. */
export function vmError(msg: string): LuaError {
  return new LuaError(msg, { kind: "vm", msg });
}

import type { LuaThread } from "./vm.ts";

export function typeName(v: LuaValue): string {
  switch (typeof v) {
    case "undefined": return "nil";
    case "boolean": return "boolean";
    case "number": return "number";
    case "string": return "string";
    default:
      if (v instanceof LuaClosure || v instanceof LuaNative) return "function";
      if (v instanceof LuaUserdata) return "userdata";
      if ((v as { isLuaThread?: boolean }).isLuaThread) return "thread";
      return "table";
  }
}

/** JS (UTF-16) string -> Lua byte string holding its UTF-8 encoding. */
export function utf8ToLua(s: string): string {
  let ascii = true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) { ascii = false; break; }
  if (ascii) return s;
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x2000) out += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return out;
}

/** Lua byte string (UTF-8 bytes) -> JS string. Invalid sequences become U+FFFD. */
export function luaToUtf8(s: string): string {
  let ascii = true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) { ascii = false; break; }
  if (ascii) return s;
  return new TextDecoder("utf-8").decode(luaBytes(s));
}

export function luaBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

export function bytesToLua(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 0x2000) out += String.fromCharCode(...b.subarray(i, i + 0x2000));
  return out;
}
