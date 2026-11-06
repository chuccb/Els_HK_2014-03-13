import { LuaTable } from "../table.ts";
import { LuaError, LuaNative, typeName } from "../value.ts";
export { callerError, vmError } from "../value.ts";
import type { LuaValue, NativeImpl } from "../value.ts";
import { luaNumberToString } from "../numfmt.ts";
import { strToNumber } from "../vm.ts";
import type { LuaThread } from "../vm.ts";

export const numToStr = luaNumberToString;

/** lj_err_arg: the function name in the message is derived from the calling instruction when the error is resolved. */
export function argError(i: number, fname: string, msg: string): never {
  throw new LuaError(`bad argument #${i + 1} to '${fname}' (${msg})`, { kind: "arg", narg: i + 1, msg, fname });
}

function typeErr(args: LuaValue[], i: number, fname: string, expected: string): never {
  const got = i >= args.length ? "no value" : typeName(args[i]);
  return argError(i, fname, `${expected} expected, got ${got}`);
}

export function checkAny(args: LuaValue[], i: number, fname: string): LuaValue {
  if (i >= args.length) argError(i, fname, "value expected");
  return args[i];
}

export function checkTable(args: LuaValue[], i: number, fname: string): LuaTable {
  const v = args[i];
  if (!(v instanceof LuaTable)) typeErr(args, i, fname, "table");
  return v as LuaTable;
}

export function checkNum(args: LuaValue[], i: number, fname: string): number {
  const v = args[i];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = strToNumber(v);
    if (n !== undefined) return n;
  }
  return typeErr(args, i, fname, "number");
}

export function optNum(args: LuaValue[], i: number, fname: string, def: number): number {
  return args[i] === undefined ? def : checkNum(args, i, fname);
}

/** Number truncated toward zero (lua_Integer semantics; values stay doubles). */
export function checkInt(args: LuaValue[], i: number, fname: string): number {
  const n = checkNum(args, i, fname);
  return n < 0 ? Math.ceil(n) : Math.floor(n);
}

export function optInt(args: LuaValue[], i: number, fname: string, def: number): number {
  return args[i] === undefined ? def : checkInt(args, i, fname);
}

export function checkStr(args: LuaValue[], i: number, fname: string): string {
  const v = args[i];
  if (typeof v === "string") return v;
  if (typeof v === "number") return numToStr(v);
  return typeErr(args, i, fname, "string");
}

export function optStr(args: LuaValue[], i: number, fname: string, def: string): string {
  return args[i] === undefined ? def : checkStr(args, i, fname);
}

const bf64 = new Float64Array(1);
const bu32 = new Uint32Array(bf64.buffer);

/** lj_num2bit: round to nearest-even and wrap to int32 with the 2^52+2^51 trick (same result as the C code). */
export function num2bit(x: number): number {
  bf64[0] = x + 6755399441055744.0;
  return bu32[0]! | 0;
}

/** lj_lib_checkbit: a number (or numeric string) as a wrapped int32. */
export function checkBit(args: LuaValue[], i: number, fname: string): number {
  return num2bit(checkNum(args, i, fname));
}

const isSpaceCode = (c: number): boolean => c === 32 || (c >= 9 && c <= 13);

/** strtoul with a 32-bit unsigned long (the Win32 client) as used by tonumber(s, base); undefined = not a number. */
export function strtoul32(s: string, base: number): number | undefined {
  const n = s.length;
  let i = 0;
  while (i < n && isSpaceCode(s.charCodeAt(i))) i++;
  let neg = false;
  if (s[i] === "-") { neg = true; i++; } else if (s[i] === "+") i++;
  const digit = (c: number): number =>
    c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 122 ? c - 87 : c >= 65 && c <= 90 ? c - 55 : 99;
  if (base === 16 && s[i] === "0" && (s[i + 1] === "x" || s[i + 1] === "X") && digit(s.charCodeAt(i + 2)) < 16) i += 2;
  const start = i;
  let v = 0;
  let overflow = false;
  for (; i < n; i++) {
    const d = digit(s.charCodeAt(i));
    if (d >= base) break;
    if (!overflow) {
      v = v * base + d;
      if (v > 4294967295) overflow = true;
    }
  }
  if (i === start) return undefined;
  while (i < n && isSpaceCode(s.charCodeAt(i))) i++;
  if (i !== n) return undefined;
  if (overflow) return 4294967295; // ULONG_MAX, whatever the sign
  return neg ? (-v >>> 0) : v;
}

export function checkFunc(args: LuaValue[], i: number, fname: string): LuaValue {
  const v = args[i];
  if (typeName(v) !== "function") typeErr(args, i, fname, "function");
  return v;
}

/** Install a library table (or plain globals when libName is null): `defs` maps name -> impl. */
export function makeLib(G: LuaTable, libName: string | null, defs: Record<string, NativeImpl>): LuaTable {
  const t = libName ? new LuaTable(0, 4) : G;
  for (const [name, impl] of Object.entries(defs)) {
    t.setStr(name, new LuaNative(libName ? `${libName}.${name}` : name, impl));
  }
  if (libName) G.setStr(libName, t);
  return t;
}

export type { LuaThread };
