/**
 * LuaJIT 2.0 bytecode: opcode table, loader (bcread) and listing (jit.bc format).
 *
 * The client embeds LuaJIT 2.0 with a private dump header: `1B 'K' 'L' 0x81` instead of `1B 'L' 'J' 01`.
 * Everything else is stock 2.0 — verified: the exe's `lj_bc_mode[]` (x2.exe.c L100351) equals the 93-opcode
 * LuaJIT 2.0 table entry by entry, and `lj_bcread` (L2510034) / `bcread_proto` (L2510545) read the 2.0 format.
 *
 * Dump layout (all integers ULEB128 unless noted):
 *   header      : 1B 4B 4C 81, flags (1=BE, 2=STRIP, 4=FFI), [chunkname len + bytes unless STRIP]
 *   per proto   : len, [u8 flags, u8 numparams, u8 framesize, u8 sizeuv], sizekgc, sizekn, sizebc,
 *                 [sizedbg, (firstline, numline if sizedbg)] unless STRIP,
 *                 bc (sizebc * u32 LE), uv (sizeuv * u16 LE), kgc[], kn[], debug
 *   terminator  : 0
 * Children are emitted before their parent; the parent's KGC entry type 0 pops the most recent child.
 */
import { LuaTable } from "./table.ts";
import { strHash } from "./table.ts";
import { luaNumberToString } from "./numfmt.ts";
import type { LuaValue } from "./value.ts";

export const BCDUMP_HEAD = [0x1b, 0x4b, 0x4c, 0x81] as const;
export const BCDUMP_F_BE = 1, BCDUMP_F_STRIP = 2, BCDUMP_F_FFI = 4;
export const PROTO_CHILD = 1, PROTO_VARARG = 2, PROTO_FFI = 4, PROTO_NOJIT = 8, PROTO_ILOOP = 16;
export const PROTO_UV_LOCAL = 0x8000, PROTO_UV_IMMUTABLE = 0x4000;

// BCMode: A / B / C-D operand kinds, as in lj_bc.h.
export const enum BCM { none, dst, base, var, rbase, uv, lit, lits, pri, num, str, tab, func, jump, cdata }

/** [name, ma, mb, mc] for the 93 opcodes of LuaJIT 2.0, in opcode order (lj_bc.h BCDEF). */
export const OPS: readonly (readonly [string, BCM, BCM, BCM])[] = [
  ["ISLT", BCM.var, BCM.none, BCM.var], ["ISGE", BCM.var, BCM.none, BCM.var],
  ["ISLE", BCM.var, BCM.none, BCM.var], ["ISGT", BCM.var, BCM.none, BCM.var],
  ["ISEQV", BCM.var, BCM.none, BCM.var], ["ISNEV", BCM.var, BCM.none, BCM.var],
  ["ISEQS", BCM.var, BCM.none, BCM.str], ["ISNES", BCM.var, BCM.none, BCM.str],
  ["ISEQN", BCM.var, BCM.none, BCM.num], ["ISNEN", BCM.var, BCM.none, BCM.num],
  ["ISEQP", BCM.var, BCM.none, BCM.pri], ["ISNEP", BCM.var, BCM.none, BCM.pri],
  ["ISTC", BCM.dst, BCM.none, BCM.var], ["ISFC", BCM.dst, BCM.none, BCM.var],
  ["IST", BCM.none, BCM.none, BCM.var], ["ISF", BCM.none, BCM.none, BCM.var],
  ["MOV", BCM.dst, BCM.none, BCM.var], ["NOT", BCM.dst, BCM.none, BCM.var],
  ["UNM", BCM.dst, BCM.none, BCM.var], ["LEN", BCM.dst, BCM.none, BCM.var],
  ["ADDVN", BCM.dst, BCM.var, BCM.num], ["SUBVN", BCM.dst, BCM.var, BCM.num],
  ["MULVN", BCM.dst, BCM.var, BCM.num], ["DIVVN", BCM.dst, BCM.var, BCM.num], ["MODVN", BCM.dst, BCM.var, BCM.num],
  ["ADDNV", BCM.dst, BCM.var, BCM.num], ["SUBNV", BCM.dst, BCM.var, BCM.num],
  ["MULNV", BCM.dst, BCM.var, BCM.num], ["DIVNV", BCM.dst, BCM.var, BCM.num], ["MODNV", BCM.dst, BCM.var, BCM.num],
  ["ADDVV", BCM.dst, BCM.var, BCM.var], ["SUBVV", BCM.dst, BCM.var, BCM.var],
  ["MULVV", BCM.dst, BCM.var, BCM.var], ["DIVVV", BCM.dst, BCM.var, BCM.var], ["MODVV", BCM.dst, BCM.var, BCM.var],
  ["POW", BCM.dst, BCM.var, BCM.var], ["CAT", BCM.dst, BCM.rbase, BCM.rbase],
  ["KSTR", BCM.dst, BCM.none, BCM.str], ["KCDATA", BCM.dst, BCM.none, BCM.cdata],
  ["KSHORT", BCM.dst, BCM.none, BCM.lits], ["KNUM", BCM.dst, BCM.none, BCM.num],
  ["KPRI", BCM.dst, BCM.none, BCM.pri], ["KNIL", BCM.base, BCM.none, BCM.base],
  ["UGET", BCM.dst, BCM.none, BCM.uv], ["USETV", BCM.uv, BCM.none, BCM.var],
  ["USETS", BCM.uv, BCM.none, BCM.str], ["USETN", BCM.uv, BCM.none, BCM.num],
  ["USETP", BCM.uv, BCM.none, BCM.pri], ["UCLO", BCM.rbase, BCM.none, BCM.jump],
  ["FNEW", BCM.dst, BCM.none, BCM.func], ["TNEW", BCM.dst, BCM.none, BCM.lit],
  ["TDUP", BCM.dst, BCM.none, BCM.tab], ["GGET", BCM.dst, BCM.none, BCM.str],
  ["GSET", BCM.var, BCM.none, BCM.str], ["TGETV", BCM.dst, BCM.var, BCM.var],
  ["TGETS", BCM.dst, BCM.var, BCM.str], ["TGETB", BCM.dst, BCM.var, BCM.lit],
  ["TSETV", BCM.var, BCM.var, BCM.var], ["TSETS", BCM.var, BCM.var, BCM.str],
  ["TSETB", BCM.var, BCM.var, BCM.lit], ["TSETM", BCM.base, BCM.none, BCM.num],
  ["CALLM", BCM.base, BCM.lit, BCM.lit], ["CALL", BCM.base, BCM.lit, BCM.lit],
  ["CALLMT", BCM.base, BCM.none, BCM.lit], ["CALLT", BCM.base, BCM.none, BCM.lit],
  ["ITERC", BCM.base, BCM.lit, BCM.lit], ["ITERN", BCM.base, BCM.lit, BCM.lit],
  ["VARG", BCM.base, BCM.lit, BCM.lit], ["ISNEXT", BCM.base, BCM.none, BCM.jump],
  ["RETM", BCM.base, BCM.none, BCM.lit], ["RET", BCM.rbase, BCM.none, BCM.lit],
  ["RET0", BCM.rbase, BCM.none, BCM.lit], ["RET1", BCM.rbase, BCM.none, BCM.lit],
  ["FORI", BCM.base, BCM.none, BCM.jump], ["JFORI", BCM.base, BCM.none, BCM.jump],
  ["FORL", BCM.base, BCM.none, BCM.jump], ["IFORL", BCM.base, BCM.none, BCM.jump],
  ["JFORL", BCM.base, BCM.none, BCM.lit], ["ITERL", BCM.base, BCM.none, BCM.jump],
  ["IITERL", BCM.base, BCM.none, BCM.jump], ["JITERL", BCM.base, BCM.none, BCM.lit],
  ["LOOP", BCM.rbase, BCM.none, BCM.jump], ["ILOOP", BCM.rbase, BCM.none, BCM.jump],
  ["JLOOP", BCM.rbase, BCM.none, BCM.lit], ["JMP", BCM.rbase, BCM.none, BCM.jump],
  ["FUNCF", BCM.rbase, BCM.none, BCM.none], ["IFUNCF", BCM.rbase, BCM.none, BCM.none],
  ["JFUNCF", BCM.rbase, BCM.none, BCM.lit], ["FUNCV", BCM.rbase, BCM.none, BCM.none],
  ["IFUNCV", BCM.rbase, BCM.none, BCM.none], ["JFUNCV", BCM.rbase, BCM.none, BCM.lit],
  ["FUNCC", BCM.rbase, BCM.none, BCM.none], ["FUNCCW", BCM.rbase, BCM.none, BCM.none],
];

/** BCMode of operand A per opcode as a number (BCM.none=0, dst=1, base=2, ...). */
export const OP_A_MODE: Uint8Array = Uint8Array.from(OPS, (o) => o[1] as number);

/** Opcode numbers used by the interpreter. */
export const OP: Record<string, number> = Object.fromEntries(OPS.map((o, i) => [o[0], i]));

export type KGC = string | LuaTable | Proto;

export class Proto {
  /** Instruction stream; index 0 is the synthesized FUNCF/FUNCV header, so listing numbers == array indices. */
  bc!: Uint32Array;
  uv!: Uint16Array;
  /** KGC constants indexed by the instruction operand (strings / template tables / child protos). */
  kgc!: KGC[];
  /** Number constants indexed by the operand. */
  kn!: Float64Array;
  flags = 0;
  numparams = 0;
  framesize = 0;
  firstline = 0;
  numline = 0;
  chunkname = "";
  /** per-instruction line numbers when the dump is not stripped */
  lineinfo: Uint8Array | Uint16Array | Uint32Array | null = null;
  uvnames: string[] | null = null;
  /** synthesized by the VM (pcall/xpcall bodies): behaves like a C function for names and locations */
  synthetic = false;
  /** 1 = pcall body, 2 = xpcall body (error handler in the frame's second parameter slot) */
  pcallKind = 0;
  get isVararg(): boolean { return (this.flags & PROTO_VARARG) !== 0; }
}

class Reader {
  pos = 0;
  constructor(readonly d: Uint8Array) {}
  u8(): number {
    if (this.pos >= this.d.length) throw new Error("bad bytecode (truncated)");
    return this.d[this.pos++]!;
  }
  uleb(): number {
    let v = this.u8();
    if (v >= 0x80) {
      let sh = 0;
      v &= 0x7f;
      let b: number;
      do {
        b = this.u8();
        sh += 7;
        v |= (b & 0x7f) << sh;
      } while (b >= 0x80);
    }
    return v >>> 0;
  }
  /** bcread_uleb128_33: bit0 of the first byte is the "is double" flag, the value has 33 bits. */
  uleb33(): number {
    const first = this.d[this.pos]!;
    let v = first >>> 1;
    this.pos++;
    if (v >= 0x40) {
      let sh = -1;
      v &= 0x3f;
      let b: number;
      do {
        b = this.u8();
        sh += 7;
        v |= (b & 0x7f) << sh;
      } while (b >= 0x80);
    }
    return v >>> 0;
  }
  bytes(n: number): string {
    if (this.pos + n > this.d.length) throw new Error("bad bytecode (truncated)");
    let s = "";
    for (let i = 0; i < n; i += 0x2000) s += String.fromCharCode(...this.d.subarray(this.pos + i, this.pos + Math.min(n, i + 0x2000)));
    this.pos += n;
    return s;
  }
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function readKtabk(r: Reader): LuaValue {
  const tp = r.uleb();
  if (tp >= 5) return r.bytes(tp - 5);
  switch (tp) {
    case 0: return undefined;
    case 1: return false;
    case 2: return true;
    case 3: return r.uleb() | 0; // BCDUMP_KTAB_INT
    default: { // BCDUMP_KTAB_NUM: lo, hi
      u32[0] = r.uleb();
      u32[1] = r.uleb();
      return f64[0]!;
    }
  }
}

function readKtab(r: Reader): LuaTable {
  const narray = r.uleb();
  const nhash = r.uleb();
  const hbits = nhash ? (nhash === 1 ? 1 : 1 + (31 - Math.clz32(nhash - 1))) : 0;
  const t = new LuaTable(narray, hbits);
  for (let i = 0; i < narray; i++) t.array[i] = readKtabk(r);
  for (let i = 0; i < nhash; i++) {
    const key = readKtabk(r);
    const val = readKtabk(r);
    t.set(key, val);
  }
  return t;
}

export interface LoadOptions {
  /** chunk name used for stripped dumps (the loader's `chunkarg`) */
  chunkname?: string;
}

/** Loads a binary chunk; returns the main prototype. Throws on any format error. */
export function loadBytecode(data: Uint8Array, opts: LoadOptions = {}): Proto {
  const r = new Reader(data);
  for (let i = 0; i < 4; i++) {
    if (r.u8() !== BCDUMP_HEAD[i]) throw new Error("bad bytecode header (not a KOG LuaJIT 2.0 dump)");
  }
  const flags = r.uleb();
  if (flags & ~7) throw new Error(`bad bytecode flags ${flags}`);
  if (flags & BCDUMP_F_BE) throw new Error("big-endian bytecode is not supported");
  if (flags & BCDUMP_F_FFI) throw new Error("FFI bytecode is not supported");
  const strip = (flags & BCDUMP_F_STRIP) !== 0;
  let chunkname: string;
  if (strip) chunkname = opts.chunkname ?? "=?";
  else chunkname = r.bytes(r.uleb());

  const stack: Proto[] = [];
  for (;;) {
    if (r.pos >= data.length) throw new Error("bad bytecode (missing terminator)");
    if (data[r.pos] === 0) { r.pos++; break; }
    const len = r.uleb();
    if (len === 0) break;
    const start = r.pos;
    const pt = new Proto();
    pt.flags = r.u8();
    pt.numparams = r.u8();
    pt.framesize = r.u8();
    const sizeuv = r.u8();
    const sizekgc = r.uleb();
    const sizekn = r.uleb();
    const sizebc = r.uleb();
    let sizedbg = 0;
    if (!strip) {
      sizedbg = r.uleb();
      if (sizedbg) {
        pt.firstline = r.uleb();
        pt.numline = r.uleb();
      }
    }
    pt.chunkname = chunkname;
    // bytecode: synthesized header + sizebc instructions
    pt.bc = new Uint32Array(sizebc + 1);
    const OP_FUNCF = OPS.findIndex((o) => o[0] === "FUNCF"), OP_FUNCV = OPS.findIndex((o) => o[0] === "FUNCV");
    pt.bc[0] = ((pt.framesize << 8) | (pt.flags & PROTO_VARARG ? OP_FUNCV : OP_FUNCF)) >>> 0;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < sizebc; i++) pt.bc[i + 1] = dv.getUint32(r.pos + i * 4, true);
    r.pos += sizebc * 4;
    // upvalue descriptors
    pt.uv = new Uint16Array(sizeuv);
    for (let i = 0; i < sizeuv; i++) pt.uv[i] = dv.getUint16(r.pos + i * 2, true);
    r.pos += sizeuv * 2;
    // KGC (stored in reverse operand order: the first entry read has the highest operand index)
    const kgcRead: KGC[] = [];
    for (let i = 0; i < sizekgc; i++) {
      const tp = r.uleb();
      if (tp >= 5) kgcRead.push(r.bytes(tp - 5));
      else if (tp === 1) kgcRead.push(readKtab(r));
      else if (tp === 0) {
        const child = stack.pop();
        if (!child) throw new Error("bad bytecode (child proto underflow)");
        kgcRead.push(child);
      } else throw new Error(`unsupported KGC constant type ${tp} (FFI cdata)`);
    }
    pt.kgc = kgcRead.reverse();
    // KN
    pt.kn = new Float64Array(sizekn);
    for (let i = 0; i < sizekn; i++) {
      const isnum = r.d[r.pos]! & 1;
      const lo = r.uleb33();
      if (isnum) {
        u32[0] = lo;
        u32[1] = r.uleb();
        pt.kn[i] = f64[0]!;
      } else {
        pt.kn[i] = lo | 0;
      }
    }
    // debug info
    if (sizedbg) {
      const dbgStart = r.pos;
      const per = pt.numline >= 65536 ? 4 : pt.numline >= 256 ? 2 : 1;
      const li = new DataView(data.buffer, data.byteOffset + r.pos, sizebc * per);
      pt.lineinfo = per === 1 ? new Uint8Array(sizebc) : per === 2 ? new Uint16Array(sizebc) : new Uint32Array(sizebc);
      for (let i = 0; i < sizebc; i++) pt.lineinfo[i] = per === 1 ? li.getUint8(i) : per === 2 ? li.getUint16(i * 2, true) : li.getUint32(i * 4, true);
      r.pos += sizebc * per;
      pt.uvnames = [];
      for (let i = 0; i < sizeuv; i++) {
        let s = "";
        for (let c = r.u8(); c !== 0; c = r.u8()) s += String.fromCharCode(c);
        pt.uvnames.push(s);
      }
      r.pos = dbgStart + sizedbg; // skip variable info
    }
    if (r.pos - start !== len) throw new Error("bad bytecode (proto length mismatch)");
    stack.push(pt);
  }
  if (stack.length !== 1) throw new Error(`bad bytecode (${stack.length} top-level protos)`);
  if (r.pos !== data.length) throw new Error("bad bytecode (trailing data)");
  return stack[0]!;
}

// ---- listing in `jit.bc` format ------------------------------------------------------------------------

function fmtNumber(n: number): string {
  return luaNumberToString(n);
}

export { luaNumberToString, fmtG } from "./numfmt.ts";

function ctlsub(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]/g, (c) => {
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\t") return "\\t";
    return "\\" + String(c.charCodeAt(0)).padStart(3, "0");
  });
}

function protoLoc(pt: Proto): string {
  return `${pt.chunkname.replace(/^[@=]/, "")}:${pt.firstline}`;
}

function bcLine(pt: Proto, pc: number, prefix: string): string | null {
  if (pc >= pt.bc.length) return null;
  const ins = pt.bc[pc]!;
  const opc = ins & 0xff;
  const [name, ma, mb, mc] = OPS[opc]!;
  const a = (ins >>> 8) & 0xff;
  let s = `${String(pc).padStart(4, "0")} ${prefix} ${name.padEnd(6)} ${(ma === BCM.none ? "" : String(a)).padStart(3)} `;
  let d = ins >>> 16;
  if (mc === BCM.jump) return `${s}=> ${String(pc + d - 0x7fff).padStart(4, "0")}\n`;
  if (mb !== BCM.none) d &= 0xff;
  else if (mc === BCM.none) return s + "\n";
  let kc: string | undefined;
  if (mc === BCM.str) {
    const k = pt.kgc[d] as string;
    const x = ctlsub(k);
    kc = x.length > 40 ? `"${x.slice(0, 40)}"~` : `"${x}"`;
  } else if (mc === BCM.num) {
    let k = pt.kn[d]!;
    if (name === "TSETM") k -= 2 ** 52;
    kc = fmtNumber(k);
  } else if (mc === BCM.func) {
    kc = protoLoc(pt.kgc[d] as Proto);
  } else if (mc === BCM.uv) {
    kc = pt.uvnames?.[d] ?? "";
  }
  if (ma === BCM.uv) {
    const ka = pt.uvnames?.[a] ?? "";
    kc = kc !== undefined ? `${ka} ; ${kc}` : ka;
  }
  if (mb !== BCM.none) {
    const b = ins >>> 24;
    if (kc !== undefined) return `${s}${String(b).padStart(3)} ${String(d).padStart(3)}  ; ${kc}\n`;
    return `${s}${String(b).padStart(3)} ${String(d).padStart(3)}\n`;
  }
  if (kc !== undefined) return `${s}${String(d).padStart(3)}      ; ${kc}\n`;
  if (mc === BCM.lits && d > 32767) d -= 65536;
  return `${s}${String(d).padStart(3)}\n`;
}

/** Equivalent of `require("jit.bc").dump(func, out, true)` — children first, in constant order. */
export function disassemble(pt: Proto): string {
  let out = "";
  const walk = (p: Proto): void => {
    for (let n = 0; n < p.kgc.length; n++) {
      const k = p.kgc[n];
      if (k instanceof Proto) walk(k);
    }
    out += `-- BYTECODE -- ${protoLoc(p)}-${p.firstline + p.numline}\n`;
    const targets = new Set<number>();
    for (let pc = 1; pc < p.bc.length; pc++) {
      const ins = p.bc[pc]!;
      if (OPS[ins & 0xff]![3] === BCM.jump) targets.add(pc + (ins >>> 16) - 0x7fff);
    }
    for (let pc = 1; pc < p.bc.length; pc++) out += bcLine(p, pc, targets.has(pc) ? "=>" : "  ")!;
    out += "\n";
  };
  walk(pt);
  return out;
}

export { strHash };
