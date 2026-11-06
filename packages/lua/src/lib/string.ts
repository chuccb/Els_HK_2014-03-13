import { LuaTable } from "../table.ts";
import { LuaError, LuaNative, callerError, typeName } from "../value.ts";
import type { LuaValue } from "../value.ts";
import { fmtE, fmtF, fmtG, luaNumberToString } from "../numfmt.ts";
import { call, index, metaOf, rawToString, tostringMeta, EMPTY } from "../vm.ts";
import type { LuaState, LuaThread } from "../vm.ts";
import { argError, checkBit, checkInt, checkNum, checkStr, makeLib, optInt } from "./util.ts";
import { MatchState, doMatch, getCaptures, getOneCapture, noSpecials } from "./pattern.ts";

const posrelat = (pos: number, len: number): number => (pos < 0 ? Math.max(0, pos + len + 1) : pos);

function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}
function asciiUpper(s: string): string {
  return s.replace(/[a-z]+/g, (m) => m.toUpperCase());
}

// ---- string.format ------------------------------------------------------------------------------------------
// Follows the client's lj_cf_string_format (x2.exe.c L2511566): integer conversions go through lj_lib_checkbit (32-bit
// wrap-around of the *rounded* value, because the Win32 `long` is 32 bits), results are cut at the first NUL because they
// pass through sprintf + strlen, non-finite doubles print as "nan"/"inf"/"-inf", and there is no %F.

function padField(body: string, width: number, left: boolean, zero: boolean): string {
  if (body.length >= width) return body;
  if (left) return body + " ".repeat(width - body.length);
  if (zero) {
    const m = /^([+\- ]?(?:0[xX])?)(.*)$/.exec(body)!;
    return m[1] + "0".repeat(width - body.length) + m[2];
  }
  return " ".repeat(width - body.length) + body;
}

/**
 * `%q`: x2.exe.c addquoted @33390F50 (L2511966).  `"`, `\` and newline get a backslash; control characters (0-31, 127) become
 * `\d`, `\dd` or `\ddd` (three digits when the value is >= 100 or the next character is a digit).
 */
function quoteStr(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34 || c === 92 || c === 10) out += "\\" + s[i];
    else if (c < 32 || c === 127) {
      const next = s.charCodeAt(i + 1); // NaN past the end (the C code reads the terminating NUL)
      out += "\\" + (c >= 100 || (next >= 48 && next <= 57) ? String(c).padStart(3, "0") : String(c));
    } else out += s[i];
  }
  return out + '"';
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

/** `%s` argument text: strings as is, else __tostring (when it returns a string), else the default representation. */
function formatArgText(L: LuaThread, v: LuaValue): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return luaNumberToString(v);
  const tm = metaOf(L.state, v, "__tostring");
  if (tm !== undefined) {
    const r = call(L, tm, [v])[0];
    if (typeof r === "string") return r;
  }
  return rawToString(v);
}

const cstr = (s: string): string => {
  const z = s.indexOf("\0");
  return z < 0 ? s : s.slice(0, z);
};

export function strFormat(L: LuaThread, a: LuaValue[]): string {
  const fmt = checkStr(a, 0, "format");
  const top = a.length;
  let out = "";
  let narg = 1;
  const n = fmt.length;
  let i = 0;
  while (i < n) {
    const c = fmt[i]!;
    if (c !== "%") {
      out += c;
      i++;
      continue;
    }
    if (fmt[i + 1] === "%") {
      out += "%";
      i += 2;
      continue;
    }
    narg++;
    if (narg > top) argError(narg - 1, "format", "no value");
    const start = i + 1;
    let p = start;
    while (p < n && "-+ #0".includes(fmt[p]!)) p++;
    if (p - start >= 6) throw callerError("invalid format (repeated flags)");
    const flags = fmt.slice(start, p);
    let w = "";
    if (isDigit(fmt[p])) w += fmt[p++];
    if (isDigit(fmt[p])) w += fmt[p++];
    let prec: number | undefined;
    if (fmt[p] === ".") {
      p++;
      let pr = "";
      if (isDigit(fmt[p])) pr += fmt[p++];
      if (isDigit(fmt[p])) pr += fmt[p++];
      prec = pr === "" ? 0 : parseInt(pr, 10);
    }
    if (isDigit(fmt[p])) throw callerError("invalid format (width or precision too long)");
    const conv = fmt[p];
    i = p + 1;
    const width = w === "" ? 0 : parseInt(w, 10);
    const left = flags.includes("-"), zero = flags.includes("0") && !left, plus = flags.includes("+"), space = flags.includes(" "), alt = flags.includes("#");
    const ai = narg - 1; // 0-based index into `a`
    switch (conv) {
      case "d": case "i": {
        const v = checkBit(a, ai, "format"); // int32
        const neg = v < 0;
        let digits = String(neg ? -v : v);
        if (prec !== undefined && digits.length < prec) digits = "0".repeat(prec - digits.length) + digits;
        if (prec === 0 && v === 0) digits = "";
        const sign = neg ? "-" : plus ? "+" : space ? " " : "";
        out += cstr(padField(sign + digits, width, left, zero && prec === undefined));
        break;
      }
      case "u": case "o": case "x": case "X": {
        const v = checkBit(a, ai, "format") >>> 0;
        let digits = v.toString(conv === "u" ? 10 : conv === "o" ? 8 : 16);
        if (conv === "X") digits = digits.toUpperCase();
        if (prec !== undefined && digits.length < prec) digits = "0".repeat(prec - digits.length) + digits;
        if (prec === 0 && v === 0) digits = "";
        let prefix = "";
        if (alt) {
          if (conv === "o") { if (!digits.startsWith("0")) digits = "0" + digits; }
          else if (v !== 0 && (conv === "x" || conv === "X")) prefix = conv === "x" ? "0x" : "0X";
        }
        out += cstr(padField(prefix + digits, width, left, zero && prec === undefined));
        break;
      }
      case "c": {
        const v = checkInt(a, ai, "format") | 0;
        out += cstr(padField(String.fromCharCode(v & 255), width, left, false));
        break;
      }
      case "e": case "E": case "f": case "g": case "G": {
        const v = checkNum(a, ai, "format");
        if (!Number.isFinite(v)) {
          // canonical text through "%<flags><width>s"
          let t = Number.isNaN(v) ? "nan" : v < 0 ? "-inf" : "inf";
          if (conv === "E" || conv === "G") t = t.toUpperCase();
          out += padField(t, width, left, false);
          break;
        }
        const neg = v < 0 || Object.is(v, -0);
        let body: string;
        const av = Math.abs(v);
        if (conv === "e" || conv === "E") body = fmtE(av, prec ?? 6, conv === "E", alt);
        else if (conv === "f") body = fmtF(av, prec ?? 6, alt);
        else body = fmtG(av, prec ?? 6, alt, conv === "G");
        const sign = neg ? "-" : plus ? "+" : space ? " " : "";
        out += padField(sign + body, width, left, zero);
        break;
      }
      case "p": {
        const v = a[ai];
        out += typeof v === "object" || typeof v === "function" ? "0x" + ((v as { id?: number }).id ?? 0).toString(16).padStart(8, "0") : "(null)";
        break;
      }
      case "q":
        out += quoteStr(checkStr(a, ai, "format"));
        break;
      case "s": {
        let s = formatArgText(L, a[ai]);
        if (prec !== undefined || s.length < 100) {
          s = cstr(s);
          if (prec !== undefined) s = s.slice(0, prec);
          out += padField(s, width, left, false);
        } else out += s;
        break;
      }
      default:
        throw callerError(`invalid option '%${conv ?? "\0"}' to 'format'`);
    }
  }
  return out;
}

// ---- find / match / gmatch / gsub ---------------------------------------------------------------------------

function findAux(a: LuaValue[], find: boolean): LuaValue[] {
  const fname = find ? "find" : "match";
  const s = checkStr(a, 0, fname);
  const p = checkStr(a, 1, fname);
  const ls = s.length;
  let init = posrelat(optInt(a, 2, fname, 1), ls) - 1;
  if (init < 0) init = 0;
  else if (init > ls) init = ls;
  if (find && ((a[3] !== undefined && a[3] !== false) || noSpecials(p))) {
    const pos = s.indexOf(p, init);
    if (pos >= 0) return [pos + 1, pos + p.length];
  } else {
    const anchor = p.charCodeAt(0) === 0x5e;
    const ps = anchor ? 1 : 0;
    const ms = new MatchState(s, p);
    let s1 = init;
    do {
      ms.level = 0;
      const e = doMatch(ms, s1, ps);
      if (e !== -1) {
        if (find) return [s1 + 1, e, ...getCaptures(ms, s1, e, false)];
        return getCaptures(ms, s1, e, true);
      }
    } while (s1++ < ls && !anchor);
  }
  return [undefined];
}

function addValue(L: LuaThread, ms: MatchState, repl: LuaValue, s: number, e: number): string {
  let v: LuaValue;
  if (typeof repl === "string" || typeof repl === "number") {
    const news = typeof repl === "string" ? repl : luaNumberToString(repl);
    let out = "";
    for (let i = 0; i < news.length; i++) {
      const ch = news.charCodeAt(i);
      if (ch !== 0x25) {
        out += news[i];
      } else {
        i++;
        // Lua 5.1 add_s: "%" + non-digit adds that character (a trailing "%" adds the string's NUL terminator)
        const d = i < news.length ? news.charCodeAt(i) : 0;
        if (!(d >= 48 && d <= 57)) {
          out += String.fromCharCode(d);
        } else if (d === 48) out += ms.src.slice(s, e);
        else {
          const cap = getOneCapture(ms, d - 0x31, s, e);
          out += typeof cap === "number" ? luaNumberToString(cap) : cap;
        }
      }
    }
    return out;
  }
  if (repl instanceof LuaTable) {
    v = index(L, repl, getOneCapture(ms, 0, s, e));
  } else {
    v = call(L, repl, getCaptures(ms, s, e, true))[0];
  }
  if (v === undefined || v === false) return ms.src.slice(s, e); // keep original text
  if (typeof v === "string") return v;
  if (typeof v === "number") return luaNumberToString(v);
  throw callerError(`invalid replacement value (a ${typeName(v)})`);
}

export function installString(G: LuaState): void {
  const lib = makeLib(G.globals, "string", {
    len(_L, a) {
      return [checkStr(a, 0, "len").length];
    },
    sub(_L, a) {
      const s = checkStr(a, 0, "sub");
      const l = s.length;
      let start = posrelat(checkInt(a, 1, "sub"), l);
      let end = posrelat(optInt(a, 2, "sub", -1), l);
      if (start < 1) start = 1;
      if (end > l) end = l;
      return [start <= end ? s.slice(start - 1, end) : ""];
    },
    upper(_L, a) {
      return [asciiUpper(checkStr(a, 0, "upper"))];
    },
    lower(_L, a) {
      return [asciiLower(checkStr(a, 0, "lower"))];
    },
    rep(_L, a) {
      const s = checkStr(a, 0, "rep");
      const n = checkInt(a, 1, "rep");
      if (n <= 0) return [""];
      if (s.length * n > 0x7fffff00) throw callerError("not enough memory");
      return [s.repeat(n)];
    },
    reverse(_L, a) {
      const s = checkStr(a, 0, "reverse");
      let out = "";
      for (let i = s.length - 1; i >= 0; i--) out += s[i];
      return [out];
    },
    byte(_L, a) {
      const s = checkStr(a, 0, "byte");
      const l = s.length;
      let pi = posrelat(optInt(a, 1, "byte", 1), l);
      let pe = posrelat(optInt(a, 2, "byte", pi), l);
      if (pi < 1) pi = 1;
      if (pe > l) pe = l;
      if (pi > pe) return EMPTY;
      const out: LuaValue[] = [];
      for (let i = pi; i <= pe; i++) out.push(s.charCodeAt(i - 1));
      return out;
    },
    char(_L, a) {
      let out = "";
      for (let i = 0; i < a.length; i++) {
        const c = checkInt(a, i, "char");
        if (c < 0 || c > 255) argError(i, "char", "invalid value");
        out += String.fromCharCode(c);
      }
      return [out];
    },
    format(L, a) {
      return [strFormat(L, a)];
    },
    find(_L, a) {
      return findAux(a, true);
    },
    match(_L, a) {
      return findAux(a, false);
    },
    gmatch(_L, a) {
      const s = checkStr(a, 0, "gmatch");
      const p = checkStr(a, 1, "gmatch");
      const ms = new MatchState(s, p);
      let src = 0;
      return [new LuaNative("gmatch_iter", () => {
        for (; src <= s.length; src++) {
          ms.level = 0;
          const e = doMatch(ms, src, 0);
          if (e !== -1) {
            const newstart = e;
            const start = src;
            src = newstart === start ? newstart + 1 : newstart; // empty match: advance
            return getCaptures(ms, start, e, true);
          }
        }
        return EMPTY;
      })];
    },
    gsub(L, a) {
      const s = checkStr(a, 0, "gsub");
      const p = checkStr(a, 1, "gsub");
      const repl = a[2];
      if (!(typeof repl === "string" || typeof repl === "number" || repl instanceof LuaTable || typeName(repl) === "function")) {
        argError(2, "gsub", "string/function/table expected");
      }
      const srcl = s.length;
      const maxS = a[3] === undefined ? srcl + 1 : checkInt(a, 3, "gsub");
      const anchor = p.charCodeAt(0) === 0x5e;
      const ps = anchor ? 1 : 0;
      const ms = new MatchState(s, p);
      let src = 0;
      let n = 0;
      let out = "";
      while (n < maxS) {
        ms.level = 0;
        const e = doMatch(ms, src, ps);
        if (e !== -1) {
          n++;
          out += addValue(L, ms, repl, src, e);
        }
        if (e !== -1 && e > src) src = e;
        else if (src < srcl) out += s[src++];
        else break;
        if (anchor) break;
      }
      out += s.slice(src);
      return [out, n];
    },
    dump() {
      throw callerError("unable to dump given function");
    },
  });
  lib.setStr("gfind", lib.getStr("gmatch")); // LUA_COMPAT_GFIND, luaopen_string L2511176
  const meta = new LuaTable(0, 1);
  meta.setStr("__index", lib);
  G.stringMeta = meta;
}
