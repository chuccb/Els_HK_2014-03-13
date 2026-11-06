/**
 * `KLuaManagerProxy`: KOG's own interpreter for the few *text* configuration files of the client.
 *
 * x2.exe cannot compile Lua source (see `loadChunk`), so everything the player or a tool may edit by hand is read by this small interpreter
 * instead of the Lua VM: `GameOption.txt` (saved options, CX2GameOption::OpenScriptFile 32D...), `GameOptionPreset.txt`, the server group file
 * (CX2InstanceData::OpenScriptServerGroupFile, `SERVER_GROUP = SERVER_GROUP_ID["SGI_GAIA"]`), the tutor system file
 * (CX2TutorSystem::OpenScriptFile, tables `UNIT0`, `UNIT1`, ...), and the debug console (CX2GameEdit::ExecCommand parses every argument with
 * `LuaParse` and calls the Lua function through `LuaCall`).
 *
 * It understands a tiny subset of Lua: `NAME = value` statements and table constructors whose entries are `NAME = value` or a bare value.
 * A value is a number, a `"string"`, `true`/`false`/`nil` (all case sensitive), a table constructor, an identifier (resolved against the
 * statements read so far, then against the Lua *globals*: `TRUE`, `OPTION_LEVEL` ... come from Enum.lua), or `NAME["key"]` / `NAME[n]`.
 * There are no operators, no function calls, no multi-line strings or comments (`--` simply cuts the rest of the line, even inside a string).
 * The result is not a Lua table: the file is read into `ProxyTable`s (an array part and a name map) that the game queries by name with
 * `BeginTable`/`EndTable`/`StackGetValue`/`GetValue`/`GetNumberFromLuaValue`.
 *
 * Source map (decompile line numbers in data/x2.exe.c; the C++ is std::deque/unordered_map/boost::tokenizer, the logic is ported literally,
 * including its quirks, e.g. `A = TRUE` followed by another statement without a comma is an error, `RemoveQuotes`-style cuts do not exist):
 *   333DFB00 ctor 2579858 · 333DFEB0 dtor · 333DFFE0/333E00E0 BeginTable 2580156/2580194 · 333E0190 DoMemoryNotEncrypt 2580226
 *   333E1B10 EndTable · 333E1B30 GetStringFromLuaValue · 333E1CF0/333E1D10 GetValue · 333E1D70 LuaCall · 333E1E90 LuaKeyword
 *   333E1F40 LuaParse 2581791 · 333E2790 LuaResetFromTop · 333E28B0 LuaTableIndex · 333E29C0 LuaTableKey · 333E2AB0 Reset
 *   333E2B10/333E2B80 StackGetValue; `GetNumberFromLuaValue<int>` 982041 and `<float>` 996114 (callers' file).
 *
 * Strings are byte strings (one char per byte, UTF-8 as in the file), like everywhere in `@els/lua`.
 */
import { LuaClosure, LuaNative } from "./value.ts";
import type { LuaValue } from "./value.ts";
import { LuaTable } from "./table.ts";
import { call, index } from "./vm.ts";
import type { LuaThread } from "./vm.ts";
import { fmtG } from "./numfmt.ts";

/** `KLuaManagerProxyLuaValueType` */
export const LuaValueType = { NIL: 0, BOOLEAN: 1, NUMBER: 2, STRING: 3, TABLE: 4 } as const;
export type LuaValueType = (typeof LuaValueType)[keyof typeof LuaValueType];

/** `KLuaManagerProxy::ELuaParse`: what `LuaParse` made of a token */
export const LuaParseResult = { ERROR: 0, VALUE: 1, KEYWORD: 2 } as const;
export type LuaParseResult = (typeof LuaParseResult)[keyof typeof LuaParseResult];

/** `KLuaManagerProxy::DoMemoryNotEncrypt::EState`: the statement parser's states (one per open table). */
export const EState = {
  NONE: 0,
  DONE: 1,
  KEYWORD: 2,
  KEYWORD_REF_LEFT: 3,
  KEYWORD_REF_KEY: 4,
  KEYWORD_ASSIGN: 5,
  KEYWORD_ASSIGN_KEYWORD: 6,
  KEYWORD_ASSIGN_KEYWORD_REF_LEFT: 7,
  KEYWORD_ASSIGN_KEYWORD_REF_KEY: 8,
} as const;
type EState = (typeof EState)[keyof typeof EState];

/** The exceptions the exe lets escape from `boost::lexical_cast` (nothing in the loader catches them). */
export class BadLexicalCast extends Error {
  constructor(readonly text: string, readonly target: string) {
    super(`bad lexical cast: source type value could not be interpreted as target (${JSON.stringify(text)} -> ${target})`);
    this.name = "BadLexicalCast";
  }
}

/** `KLuaManagerProxyLuaValue`: a nil, boolean, number, string or table (tables are shared by reference, like the intrusive_ptr). */
export class ProxyValue {
  type: LuaValueType = LuaValueType.NIL;
  bool = false;
  num = 0;
  str = "";
  table: ProxyTable | null = null;

  /** `Reset` (333E2AB0) */
  reset(): void {
    this.type = LuaValueType.NIL;
    this.bool = false;
    this.num = 0;
    this.str = "";
    this.table = null;
  }

  /** `operator=`: copies every field (the table is shared). */
  assign(o: ProxyValue): void {
    this.type = o.type;
    this.bool = o.bool;
    this.num = o.num;
    this.str = o.str;
    this.table = o.table;
  }

  clone(): ProxyValue {
    const v = new ProxyValue();
    v.assign(this);
    return v;
  }

  static boolean(b: boolean): ProxyValue {
    const v = new ProxyValue();
    v.type = LuaValueType.BOOLEAN;
    v.bool = b;
    return v;
  }
  static number(n: number): ProxyValue {
    const v = new ProxyValue();
    v.type = LuaValueType.NUMBER;
    v.num = n;
    return v;
  }
  static string(s: string): ProxyValue {
    const v = new ProxyValue();
    v.type = LuaValueType.STRING;
    v.str = s;
    return v;
  }
  static tableOf(t: ProxyTable): ProxyValue {
    const v = new ProxyValue();
    v.type = LuaValueType.TABLE;
    v.table = t;
    return v;
  }

  /** A plain JS rendering for inspection and tests: nil -> null, tables -> `{ vec, map }`. */
  toJS(): unknown {
    switch (this.type) {
      case LuaValueType.NIL: return null;
      case LuaValueType.BOOLEAN: return this.bool;
      case LuaValueType.NUMBER: return this.num;
      case LuaValueType.STRING: return this.str;
      default: return this.table ? this.table.toJS() : null;
    }
  }
}

/** `KLuaManagerProxyLuaTable`: the array part (`m_vec`, 1-based for the game) and the name map (`m_map`). */
export class ProxyTable {
  readonly vec: ProxyValue[] = [];
  readonly map = new Map<string, ProxyValue>();

  /** `m_map[key] = value` */
  set(key: string, value: ProxyValue): void {
    this.map.set(key, value.clone());
  }

  toJS(): { vec: unknown[]; map: Record<string, unknown> } {
    const map: Record<string, unknown> = {};
    for (const k of [...this.map.keys()].sort()) map[k] = this.map.get(k)!.toJS();
    return { vec: this.vec.map((v) => v.toJS()), map };
  }
}

// ---- character classes of the exe's C locale (MSVC ctype table) and boost helpers -------------------------

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isAlpha = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isAlnum = (c: number): boolean => isDigit(c) || isAlpha(c);
/** std::isspace in the C locale (boost::algorithm::trim) */
const isSpace = (c: number): boolean => c === 0x20 || (c >= 0x09 && c <= 0x0d);

function trim(s: string): string {
  let a = 0, b = s.length;
  while (a < b && isSpace(s.charCodeAt(a))) a++;
  while (b > a && isSpace(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

/** boost::char_separator<char>(dropped_delims = " \t\n\v" (data 140077), kept_delims = "=,{}[]", drop_empty_tokens) */
const DROPPED = " \t\n\v";
const KEPT = "=,{}[]";

function tokenize(line: string): string[] {
  const out: string[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    while (i < n && DROPPED.includes(line[i]!)) i++;
    if (i >= n) break;
    if (KEPT.includes(line[i]!)) {
      out.push(line[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < n && !DROPPED.includes(line[j]!) && !KEPT.includes(line[j]!)) j++;
    out.push(line.slice(i, j));
    i = j;
  }
  return out;
}

/** `(int)double` as the x87/SSE conversion does it: truncation, 0x80000000 for NaN and out-of-range values. */
export function cvttsd2si(x: number): number {
  return x > -2147483649 && x < 2147483648 ? Math.trunc(x) | 0 : -2147483648;
}

const DOUBLE_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * `boost::lexical_cast<double>(std::string)` of the (pre-1.54) boost the exe links: `istream >> double` with skipws off and a final EOF check,
 * so the whole text must be a decimal floating-point literal; overflow sets failbit. Anything else throws `BadLexicalCast`.
 */
export function lexicalCastDouble(text: string, target = "double"): number {
  if (!DOUBLE_TEXT.test(text)) throw new BadLexicalCast(text, target);
  const v = Number(text);
  if (!Number.isFinite(v)) throw new BadLexicalCast(text, target);
  return v;
}

/** `boost::lexical_cast<int>(std::string)`: `[+-]?digits` in base 10, nothing else, must fit in 32 bits. */
export function lexicalCastInt(text: string): number {
  if (!/^[+-]?\d+$/.test(text)) throw new BadLexicalCast(text, "int");
  const v = Number(text);
  if (v > 2147483647 || v < -2147483648) throw new BadLexicalCast(text, "int");
  return v === 0 ? 0 : v; // "-0"
}

/** `boost::lexical_cast<std::wstring>(double)`: iostream formatting with precision 17 (std::numeric_limits<double>::digits10 + 2) = "%.17g". */
export function lexicalCastString(n: number): string {
  return fmtG(n, 17);
}

// ---- the interpreter ---------------------------------------------------------------------------------------------------

/** Why `doMemoryNotEncrypt` returned false (not part of the exe: it just returns 0): the 1-based line, the token and the parser state. */
export interface ProxyFailure {
  reason: string;
  line: number;
  token: string;
  state: EState | undefined;
}

export class LuaManagerProxy {
  /** `m_dequeLuaTable`: the root table first, then one table per open `BeginTable` / `{` */
  readonly tables: ProxyTable[] = [new ProxyTable()];
  /** set by `doMemoryNotEncrypt` when it fails (diagnostics only) */
  failure: ProxyFailure | null = null;

  /** `L` = the Lua thread whose globals are consulted (`lua_getfield(L, LUA_GLOBALSINDEX, ...)`), or null for a proxy without a Lua state. */
  constructor(readonly L: LuaThread | null = null) {}

  get root(): ProxyTable {
    return this.tables[0]!;
  }
  get top(): ProxyTable {
    return this.tables[this.tables.length - 1]!;
  }

  // ---- Lua state access (LuaResetFromTop and friends) ---------------------------------------------------------------------

  /** `KLuaManagerProxyLuaValue::LuaResetFromTop` (333E2790): nil, booleans, numbers and strings convert; anything else makes it fail. */
  private static fromLua(out: ProxyValue, v: LuaValue): boolean {
    switch (typeof v) {
      case "undefined":
        out.reset();
        return true;
      case "boolean":
        out.reset();
        out.type = LuaValueType.BOOLEAN;
        out.bool = v;
        return true;
      case "number":
        out.reset();
        out.type = LuaValueType.NUMBER;
        out.num = v;
        return true;
      case "string": {
        out.reset();
        out.type = LuaValueType.STRING;
        const nul = v.indexOf("\0"); // lua_tolstring + strlen: the value ends at an embedded NUL
        out.str = nul < 0 ? v : v.slice(0, nul);
        return true;
      }
      default:
        return false;
    }
  }

  private getGlobal(name: string): LuaValue {
    return index(this.L!, this.L!.state.globals, name);
  }

  /** `LuaKeyword` (333E1E90): the name in the root table's map, else the Lua global of that name. */
  luaKeyword(name: string, out: ProxyValue): boolean {
    out.reset();
    const found = this.root.map.get(name);
    if (found === undefined) {
      if (this.L === null) return false;
      return LuaManagerProxy.fromLua(out, this.getGlobal(name));
    }
    out.assign(found);
    return true;
  }

  /** `LuaTableIndex` (333E28B0): `name[iIndex]` of a table read earlier from the file (1-based, out of range gives nil) or of a Lua global table. */
  luaTableIndex(name: string, iIndex: number, out: ProxyValue): boolean {
    out.reset();
    const found = this.root.map.get(name);
    if (found === undefined) {
      if (this.L === null) return false;
      const g = this.getGlobal(name);
      if (!(g instanceof LuaTable)) return false;
      return LuaManagerProxy.fromLua(out, index(this.L, g, iIndex));
    }
    if (found.type !== LuaValueType.TABLE) return false;
    const vec = found.table!.vec;
    if (iIndex > 0 && iIndex <= vec.length) out.assign(vec[iIndex - 1]!);
    return true;
  }

  /** `LuaTableKey` (333E29C0): `name["key"]`, same lookup order as `luaTableIndex`. */
  luaTableKey(name: string, key: string, out: ProxyValue): boolean {
    out.reset();
    const found = this.root.map.get(name);
    if (found !== undefined) {
      if (found.type !== LuaValueType.TABLE) return false;
      const v = found.table!.map.get(key);
      if (v !== undefined) out.assign(v);
      return true;
    }
    if (this.L === null) return false;
    const g = this.getGlobal(name);
    if (!(g instanceof LuaTable)) return false;
    return LuaManagerProxy.fromLua(out, index(this.L, g, key));
  }

  /**
   * `LuaParse` (333E1F40): classifies one token. Quoted text `"..."` (the first and last char must be quotes, nothing is unescaped), a number
   * (starts with a digit, or a sign and a digit: `lexical_cast<double>`), `nil`/`true`/`false`, an identifier (`[A-Za-z_][A-Za-z0-9_]*`,
   * returned as KEYWORD, or with `expandKeyword` resolved by `luaKeyword`), or `identifier[index-or-key]` (only reachable from the console).
   * Anything else is an ERROR. May throw `BadLexicalCast` for a malformed number.
   */
  luaParse(token: string, expandKeyword: boolean, out: ProxyValue): LuaParseResult {
    out.reset();
    const s = trim(token);
    if (s.length === 0) return LuaParseResult.ERROR;
    const c0 = s.charCodeAt(0);
    if (c0 === 0x22) {
      if (s.length >= 2 && s.charCodeAt(s.length - 1) === 0x22) {
        out.type = LuaValueType.STRING;
        out.str = s.slice(1, s.length - 1);
        return LuaParseResult.VALUE;
      }
      return LuaParseResult.ERROR;
    }
    if (isDigit(c0)) {
      out.type = LuaValueType.NUMBER;
      out.num = lexicalCastDouble(s);
      return LuaParseResult.VALUE;
    }
    if (c0 !== 0x2b && c0 !== 0x2d) {
      if (s === "nil") return LuaParseResult.VALUE;
      if (s === "true") {
        out.type = LuaValueType.BOOLEAN;
        out.bool = true;
        return LuaParseResult.VALUE;
      }
      if (s === "false") {
        out.type = LuaValueType.BOOLEAN;
        out.bool = false;
        return LuaParseResult.VALUE;
      }
      if (!isAlpha(c0) && c0 !== 0x5f) return LuaParseResult.ERROR;
      let i = 1;
      for (;; i++) {
        if (i === s.length) {
          if (!expandKeyword) return LuaParseResult.KEYWORD;
          return this.luaKeyword(s, out) ? LuaParseResult.VALUE : LuaParseResult.ERROR;
        }
        const c = s.charCodeAt(i);
        if (!isAlnum(c) && c === 0x5b) break; // '['
        if (!isAlnum(c) && c !== 0x5f) return LuaParseResult.ERROR;
      }
      if (s.charCodeAt(s.length - 1) !== 0x5d) return LuaParseResult.ERROR; // must end with ']'
      const key = new ProxyValue();
      if (this.luaParse(trim(s.slice(i + 1, s.length - 1)), true, key) !== LuaParseResult.VALUE) return LuaParseResult.ERROR;
      const name = s.slice(0, i);
      if (key.type === LuaValueType.NUMBER) {
        const m = cvttsd2si(key.num);
        if (key.num !== m) return LuaParseResult.ERROR;
        return this.luaTableIndex(name, m, out) ? LuaParseResult.VALUE : LuaParseResult.ERROR;
      }
      if (key.type === LuaValueType.STRING) return this.luaTableKey(name, key.str, out) ? LuaParseResult.VALUE : LuaParseResult.ERROR;
      return LuaParseResult.ERROR;
    }
    // '+' or '-': only a signed number
    if (s.length >= 2 && isDigit(s.charCodeAt(1))) {
      out.type = LuaValueType.NUMBER;
      out.num = lexicalCastDouble(s);
      return LuaParseResult.VALUE;
    }
    return LuaParseResult.ERROR;
  }

  // ---- reading the text ----------------------------------------------------------------------------------------------------

  /**
   * `DoMemoryNotEncrypt` (333E0190): reads the file image into the root table; false when the text is empty (after an optional UTF-8 BOM),
   * starts with a NUL, or is not valid for the grammar above (`failure` says where). Statements already read stay in the tables.
   * May throw `BadLexicalCast` (a malformed number is not caught by the exe's loader).
   */
  doMemoryNotEncrypt(data: Uint8Array | string): boolean {
    this.failure = null;
    const text = typeof data === "string" ? data : latin1(data);
    let start = 0;
    let size = text.length;
    if (size >= 3) {
      if (text.charCodeAt(0) === 0xef && text.charCodeAt(1) === 0xbb && text.charCodeAt(2) === 0xbf) {
        size -= 3;
        start = 3;
        if (size <= 0) return false;
      }
    } else if (size <= 0) return false;
    if (text.charCodeAt(start) === 0) return false;
    const end = start + size;

    const states: EState[] = [EState.NONE];
    let strKeyword = "";
    let strKeyword2 = "";
    let eof = false;
    let inComment = false;
    let lineStart = start; // v4
    let p = start; // v7
    let lineTok = ""; // for the diagnostics
    const state = (): EState => states[states.length - 1]!;
    const setState = (s: EState): void => {
      states[states.length - 1] = s;
    };
    const fail = (reason: string, at: number): false => {
      this.failure = { reason, line: lineOf(text, at), token: lineTok, state: states.length ? state() : undefined };
      return false;
    };

    /** the `,` / `}` handling: settles the pending statement of the current table, `}` then closes the table */
    const flush = (close: boolean, at: number): boolean => {
      const top = this.top;
      switch (state()) {
        case EState.NONE:
          break;
        case EState.DONE:
          setState(EState.NONE);
          break;
        case EState.KEYWORD: {
          const v = new ProxyValue();
          if (!this.luaKeyword(strKeyword, v)) return fail(`unknown name '${strKeyword}'`, at);
          top.vec.push(v);
          setState(EState.NONE);
          break;
        }
        case EState.KEYWORD_ASSIGN_KEYWORD: {
          const v = new ProxyValue();
          if (!this.luaKeyword(strKeyword2, v)) return fail(`unknown name '${strKeyword2}'`, at);
          if (v.type !== LuaValueType.NIL) top.set(strKeyword, v);
          else top.map.delete(strKeyword);
          setState(EState.NONE);
          break;
        }
        default:
          return fail("unexpected end of entry", at);
      }
      if (close) {
        states.pop();
        this.tables.pop();
      }
      return true;
    };

    /** one token; false = the whole read fails */
    const handle = (tok: string, at: number): boolean => {
      const top = this.top;
      if (tok.length === 1) {
        switch (tok) {
          case ",":
            return flush(false, at);
          case "}":
            if (states.length <= 1 || this.tables.length <= 1) return fail("'}' without '{'", at);
            return flush(true, at);
          case "=":
            if (state() !== EState.KEYWORD) return fail("unexpected '='", at);
            setState(EState.KEYWORD_ASSIGN);
            return true;
          case "[":
            if (state() === EState.KEYWORD) setState(EState.KEYWORD_REF_LEFT);
            else if (state() === EState.KEYWORD_ASSIGN_KEYWORD) setState(EState.KEYWORD_ASSIGN_KEYWORD_REF_LEFT);
            else return fail("unexpected '['", at);
            return true;
          case "]":
            if (state() !== EState.KEYWORD_REF_KEY && state() !== EState.KEYWORD_ASSIGN_KEYWORD_REF_KEY) return fail("unexpected ']'", at);
            setState(EState.DONE);
            return true;
          case "{": {
            const t = new ProxyTable();
            const tv = ProxyValue.tableOf(t);
            if (state() !== EState.NONE) {
              if (state() !== EState.KEYWORD_ASSIGN) return fail("unexpected '{'", at);
              setState(EState.DONE);
              top.set(strKeyword, tv); // NAME = {
            } else {
              setState(EState.DONE);
              top.vec.push(tv); // an unnamed table in a list
            }
            states.push(EState.NONE);
            this.tables.push(t);
            return true;
          }
          default:
            break;
        }
      }
      const v = new ProxyValue();
      const r = this.luaParse(tok, false, v);
      if (r === LuaParseResult.ERROR) return fail(`cannot parse '${tok}'`, at);
      if (r === LuaParseResult.KEYWORD) {
        switch (state()) {
          case EState.NONE:
            strKeyword = tok;
            setState(EState.KEYWORD);
            return true;
          case EState.DONE:
            if (states.length !== 1) return fail(`'${tok}' after a finished entry (missing ',')`, at);
            strKeyword = tok;
            setState(EState.KEYWORD);
            return true;
          case EState.KEYWORD_ASSIGN:
            strKeyword2 = tok;
            setState(EState.KEYWORD_ASSIGN_KEYWORD);
            return true;
          default:
            return fail(`unexpected name '${tok}'`, at);
        }
      }
      // a value
      const st = state();
      switch (v.type) {
        case LuaValueType.NIL:
          if (st !== EState.NONE) {
            if (st !== EState.KEYWORD_ASSIGN) return fail("unexpected 'nil'", at);
            top.map.delete(strKeyword);
          } else top.vec.push(new ProxyValue());
          setState(EState.DONE);
          return true;
        case LuaValueType.BOOLEAN:
          if (st !== EState.NONE) {
            if (st !== EState.KEYWORD_ASSIGN) return fail(`unexpected '${tok}'`, at);
            top.set(strKeyword, v);
          } else top.vec.push(v);
          setState(EState.DONE);
          return true;
        case LuaValueType.NUMBER: {
          const n = cvttsd2si(v.num);
          const isIndex = n >= 1 && n === v.num;
          const out = new ProxyValue();
          switch (st) {
            case EState.NONE:
              top.vec.push(v);
              setState(EState.DONE);
              return true;
            case EState.KEYWORD_REF_LEFT:
              if (!isIndex || !this.luaTableIndex(strKeyword, n, out)) return fail(`cannot index '${strKeyword}' with ${tok}`, at);
              top.vec.push(out);
              setState(EState.KEYWORD_REF_KEY);
              return true;
            case EState.KEYWORD_ASSIGN:
              top.set(strKeyword, v);
              setState(EState.DONE);
              return true;
            case EState.KEYWORD_ASSIGN_KEYWORD_REF_LEFT:
              if (!isIndex || !this.luaTableIndex(strKeyword2, n, out)) return fail(`cannot index '${strKeyword2}' with ${tok}`, at);
              if (out.type !== LuaValueType.NIL) top.set(strKeyword, out);
              else top.map.delete(strKeyword);
              setState(EState.KEYWORD_ASSIGN_KEYWORD_REF_KEY);
              return true;
            default:
              return fail(`unexpected number ${tok}`, at);
          }
        }
        case LuaValueType.STRING: {
          const out = new ProxyValue();
          switch (st) {
            case EState.NONE:
              top.vec.push(v);
              setState(EState.DONE);
              return true;
            case EState.KEYWORD_REF_LEFT:
              if (!this.luaTableKey(strKeyword, v.str, out)) return fail(`cannot index '${strKeyword}' with ${tok}`, at);
              top.vec.push(out);
              setState(EState.KEYWORD_REF_KEY);
              return true;
            case EState.KEYWORD_ASSIGN:
              top.set(strKeyword, v);
              setState(EState.DONE);
              return true;
            case EState.KEYWORD_ASSIGN_KEYWORD_REF_LEFT:
              if (!this.luaTableKey(strKeyword2, v.str, out)) return fail(`cannot index '${strKeyword2}' with ${tok}`, at);
              if (out.type !== LuaValueType.NIL) top.set(strKeyword, out);
              else top.map.delete(strKeyword);
              setState(EState.KEYWORD_ASSIGN_KEYWORD_REF_KEY);
              return true;
            default:
              return fail(`unexpected string ${tok}`, at);
          }
        }
        default:
          return fail("unexpected value", at);
      }
    };

    /** the end of the text (label 187): settle what is pending; the read succeeds only if every '{' was closed */
    const finish = (at: number): boolean => {
      const top = this.top;
      switch (state()) {
        case EState.NONE:
          break;
        case EState.DONE:
          setState(EState.NONE);
          break;
        case EState.KEYWORD: {
          const v = new ProxyValue();
          if (!this.luaKeyword(strKeyword, v)) return fail(`unknown name '${strKeyword}'`, at);
          top.vec.push(v);
          setState(EState.NONE);
          break;
        }
        case EState.KEYWORD_ASSIGN_KEYWORD: {
          const v = new ProxyValue();
          if (!this.luaKeyword(strKeyword2, v)) return fail(`unknown name '${strKeyword2}'`, at);
          if (v.type !== LuaValueType.NIL) top.set(strKeyword, v);
          else top.map.delete(strKeyword);
          setState(EState.NONE);
          break;
        }
        default:
          return fail("unfinished entry at the end of the text", at);
      }
      if (states.length !== 1) return fail("missing '}' at the end of the text", at);
      this.tables.length = 1; // m_dequeLuaTable.resize(1)
      return true;
    };

    for (;;) {
      // find the end of the line: LF or CR, a "--" comment (which then runs to the next LF/CR), or the end / a NUL
      let lineEnd = p;
      let skip = 1;
      for (;;) {
        lineEnd = p;
        if (inComment) {
          if (p === end || text.charCodeAt(p) === 0) return finish(p);
          const c = text.charCodeAt(p);
          if (c !== 10 && c !== 13) {
            p++;
            continue;
          }
          inComment = false;
          p++;
          lineStart = p;
          continue;
        }
        if (p === end || text.charCodeAt(p) === 0) {
          eof = true;
          break;
        }
        const c = text.charCodeAt(p);
        if (c === 10 || c === 13) break;
        if (c === 0x2d && p + 1 < end && text.charCodeAt(p + 1) === 0x2d) {
          inComment = true;
          skip = 2;
          break;
        }
        p++;
      }
      p += skip;
      if (lineStart < lineEnd) {
        const line = text.slice(lineStart, lineEnd);
        lineTok = line;
        for (const tok of tokenize(line)) {
          lineTok = tok;
          if (!handle(tok, lineStart)) return false;
        }
      }
      lineStart = p;
      if (eof) return finish(Math.min(p, end));
    }
  }

  // ---- queries (what the game's loaders call) ---------------------------------------------------------------------------------

  /** `StackGetValue(const char *)` (333E2B80): the named entry of the current (innermost) table. */
  stackGetValue(name: string): ProxyValue | undefined;
  /** `StackGetValue(int)` (333E2B10): the 1-based entry of the current table's array part. */
  stackGetValue(index: number): ProxyValue | undefined;
  stackGetValue(key: string | number): ProxyValue | undefined {
    if (typeof key === "number") {
      if (key <= 0) return undefined;
      return this.top.vec[key - 1];
    }
    if (key === "") return undefined;
    return this.top.map.get(key);
  }

  /** `BeginTable(name)` (333E00E0) / `BeginTable(name, index)` (333DFFE0, looks up `name` followed by the decimal index: `UNIT` + 3 = `UNIT3`). */
  beginTable(name: string, tableIndex?: number): boolean {
    if (name === "") return false;
    let full = name;
    if (tableIndex !== undefined) {
      full = (name + String(tableIndex | 0)).slice(0, 254); // StringCchPrintfA(szText, 0xFF, "%s%d", ...)
      if (full === "") return false;
    }
    const v = this.stackGetValue(full);
    if (v === undefined || v.type !== LuaValueType.TABLE || v.table === null) return false;
    this.tables.push(v.table);
    return true;
  }

  /** `EndTable` (333E1B10): never pops the root table. */
  endTable(): boolean {
    if (this.tables.length <= 1) return false;
    this.tables.pop();
    return true;
  }

  /** `GetValue(name, bool *)` (333E1D10): nil is false, a boolean is itself, a number is `(int)n != 0`; strings and tables fail (undefined). */
  getBool(name: string): boolean | undefined {
    const v = this.stackGetValue(name);
    if (v === undefined) return undefined;
    switch (v.type) {
      case LuaValueType.NIL: return false;
      case LuaValueType.BOOLEAN: return v.bool;
      case LuaValueType.NUMBER: return cvttsd2si(v.num) !== 0;
      default: return undefined;
    }
  }

  /**
   * `GetValue(name, std::wstring *)` (333E1CF0 + GetStringFromLuaValue 333E1B30): numbers are formatted (`lexical_cast`, 17 digits), strings are
   * converted from UTF-8 (MultiByteToWideChar; invalid sequences become U+FFFD); nil, booleans, tables and missing names fail (undefined).
   */
  getString(name: string): string | undefined {
    return LuaManagerProxy.stringFromValue(this.stackGetValue(name));
  }

  static stringFromValue(v: ProxyValue | undefined): string | undefined {
    if (v === undefined) return undefined;
    if (v.type === LuaValueType.NUMBER) return lexicalCastString(v.num);
    if (v.type !== LuaValueType.STRING) return undefined;
    return v.str === "" ? "" : new TextDecoder("utf-8", { ignoreBOM: true }).decode(Uint8Array.from(v.str, (c) => c.charCodeAt(0)));
  }

  /**
   * `GetNumberFromLuaValue<int>` (982041): booleans are 0/1, numbers are truncated like `(int)`, strings go through `lexical_cast<int>`
   * (throws `BadLexicalCast`); nil, tables and a missing value fail (undefined).
   */
  static intFromValue(v: ProxyValue | undefined): number | undefined {
    if (v === undefined) return undefined;
    switch (v.type) {
      case LuaValueType.BOOLEAN: return v.bool ? 1 : 0;
      case LuaValueType.NUMBER: return cvttsd2si(v.num);
      case LuaValueType.STRING: return lexicalCastInt(v.str);
      default: return undefined;
    }
  }

  /** `GetNumberFromLuaValue<float>` (996114): like the int version, with `float` results (numbers are narrowed, strings are `lexical_cast<float>`). */
  static floatFromValue(v: ProxyValue | undefined): number | undefined {
    if (v === undefined) return undefined;
    switch (v.type) {
      case LuaValueType.BOOLEAN: return v.bool ? 1 : 0;
      case LuaValueType.NUMBER: return Math.fround(v.num);
      case LuaValueType.STRING: {
        const x = Math.fround(lexicalCastDouble(v.str, "float"));
        if (!Number.isFinite(x)) throw new BadLexicalCast(v.str, "float");
        return x;
      }
      default: return undefined;
    }
  }

  getInt(name: string): number | undefined {
    return LuaManagerProxy.intFromValue(this.stackGetValue(name));
  }
  getFloat(name: string): number | undefined {
    return LuaManagerProxy.floatFromValue(this.stackGetValue(name));
  }

  /**
   * `LuaCall` (333E1D70): calls the Lua global function `name` with the proxy values as arguments (nil and tables are passed as nil) and discards
   * the results. False when there is no such function. Errors of the function propagate (the exe's `lua_call` is unprotected).
   */
  luaCall(name: string, args: ProxyValue[]): boolean {
    if (this.L === null || name === "") return false;
    const fn = this.getGlobal(name);
    if (!(fn instanceof LuaClosure) && !(fn instanceof LuaNative)) return false;
    const a: LuaValue[] = args.map((v) => {
      switch (v.type) {
        case LuaValueType.BOOLEAN: return v.bool;
        case LuaValueType.NUMBER: return v.num;
        case LuaValueType.STRING: return v.str;
        default: return undefined;
      }
    });
    call(this.L, fn, a);
    return true;
  }
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode(...b.subarray(i, i + 0x2000));
  return s;
}

/** 1-based line number of `offset` (CR LF, LF and CR each end one line). */
function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) line++;
  }
  return line;
}
