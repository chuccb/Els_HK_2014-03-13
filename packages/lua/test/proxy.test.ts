import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { KomArchive, fileSource } from "@els/kom";
import {
  BadLexicalCast, call, createLuaState, cvttsd2si, lexicalCastDouble, lexicalCastInt, loadChunk, LuaManagerProxy, LuaNative, LuaParseResult,
  LuaTable, LuaValueType, ProxyTable, ProxyValue,
} from "../src/index.ts";
import type { LuaValue } from "../src/index.ts";

/**
 * KLuaManagerProxy: KOG's reader for the text configuration files (x2.exe 333E0190 DoMemoryNotEncrypt and friends).
 * There is no native oracle for it (it only exists inside the exe), so the expectations below were derived by hand from the decompile; the
 * shipped GameOption.txt / GameOptionPreset.txt are read from data036.kom (and Enum.lua is run to get TRUE / OPTION_LEVEL).
 */

const bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const BOM = "\xef\xbb\xbf";

type Plain = { vec: unknown[]; map: Record<string, unknown> };
/** the plain form of a table: `T({A: 1}, [2, 3])` is `{ A = 1, 2, 3 }` */
const T = (map: Record<string, unknown> = {}, vec: unknown[] = []): Plain => ({ vec, map });

function luaTable(entries: Record<string, LuaValue>, array: LuaValue[] = []): LuaTable {
  const t = new LuaTable();
  for (const [k, v] of Object.entries(entries)) t.setStr(k, v);
  array.forEach((v, i) => t.setInt(i + 1, v));
  return t;
}

/** what Enum.lua defines (values read from the shipped script, see the data test below) */
const enumGlobals = (): Record<string, LuaValue> => ({
  TRUE: 1,
  FALSE: 0,
  OPTION_LEVEL: luaTable({ OL_HIGH: 0, OL_MEDIUM: 1, OL_LOW: 2 }),
  SERVER_GROUP_ID: luaTable({ SGI_INVALID: -1, SGI_SOLES: 0, SGI_GAIA: 1, SGI_END: 2 }),
});

function makeProxy(globals: Record<string, LuaValue> = enumGlobals()) {
  const G = createLuaState({ write: () => {} });
  for (const [k, v] of Object.entries(globals)) G.globals.setStr(k, v);
  return { G, p: new LuaManagerProxy(G.main) };
}

function load(text: string | Uint8Array, globals?: Record<string, LuaValue>) {
  const { G, p } = makeProxy(globals);
  const ok = p.doMemoryNotEncrypt(typeof text === "string" ? bytes(text) : text);
  return {
    G, p, ok,
    /** the root table in plain form (a getter: tables that contain themselves cannot be converted) */
    get root(): Plain {
      return p.root.toJS() as Plain;
    },
  };
}

describe("statements", () => {
  test("NAME = value needs no commas at the top level", () => {
    const r = load('A = 1\nB = "two"\nC = true\nD = false\nE = nil\nF = -2.5\nG = +7\nH = 1e3\n');
    expect(r.ok).toBe(true);
    expect(r.root).toEqual(T({ A: 1, B: "two", C: true, D: false, F: -2.5, G: 7, H: 1000 }));
  });

  test("= , { } [ ] separate tokens even without blanks", () => {
    expect(load("A=1,B=2").root).toEqual(T({ A: 1, B: 2 }));
    expect(load("T={A=1,B={C=2}}").root).toEqual(T({ T: T({ A: 1, B: T({ C: 2 }) }) }));
  });

  test("CR, LF and CR LF all end a line; tabs and vertical tabs are blanks", () => {
    expect(load("A = 1\r\nB = 2\rC = 3\nD = 4").root).toEqual(T({ A: 1, B: 2, C: 3, D: 4 }));
    expect(load("\tA\t=\v1\t").root).toEqual(T({ A: 1 }));
  });

  test("comments: -- cuts the rest of the line, anywhere", () => {
    const r = load("-- header\nA = 1 -- trailing, B = 2\n-- B = 3\nC = 4--glued\nD = 5 -- end");
    expect(r.ok).toBe(true);
    expect(r.root).toEqual(T({ A: 1, C: 4, D: 5 }));
    // there is no string syntax for comments: "--" inside quotes still starts one, which leaves an unterminated string
    const q = load('A = "x--y"');
    expect(q.ok).toBe(false);
    expect(q.p.failure).toMatchObject({ line: 1, token: '"x' });
  });

  test("the text ends at the first NUL; a NUL right at the start, an empty text and a lone BOM are refused", () => {
    expect(load("A = 1\0B = 2").root).toEqual(T({ A: 1 }));
    expect(load("A = 1\0B = 2").ok).toBe(true);
    expect(load("\0A = 1").ok).toBe(false);
    expect(load(BOM + "\0A = 1").ok).toBe(false);
    expect(load("").ok).toBe(false);
    expect(load(BOM).ok).toBe(false);
    expect(load(BOM + "A = 1").root).toEqual(T({ A: 1 }));
    // a text that is only comments / blanks is fine (and empty)
    expect(load("-- nothing\n  \n").ok).toBe(true);
  });

  test("nested tables, array part and map part", () => {
    const r = load('T = { A = 1, B = { C = 2 }, 3, "x", { 4 } }');
    expect(r.ok).toBe(true);
    expect(r.root).toEqual(T({ T: T({ A: 1, B: T({ C: 2 }) }, [3, "x", T({}, [4])]) }));
    // the shape of the shipped files: line breaks anywhere, a comma before the closing brace
    const m = load("T =\r\n{ \r\n\tA\t= 1, \r\n\tB = { \r\n\t\t1, 2,\r\n\t},\r\n}\r\n");
    expect(m.root).toEqual(T({ T: T({ A: 1, B: T({}, [1, 2]) }) }));
  });

  test("a table without a name at the top level goes to the array part of the root", () => {
    // the second '{' follows a finished table without a comma (state DONE at the top level only allows a name)
    expect(load("{ 1, 2 }\n{ }").ok).toBe(false);
    const ok = load("{ 1, 2 },\n{ }");
    expect(ok.ok).toBe(true);
    expect(ok.root).toEqual(T({}, [T({}, [1, 2]), T()]));
    expect(load("1, 2, 3").root).toEqual(T({}, [1, 2, 3]));
  });

  test("empty entries are allowed, and a trailing comma too", () => {
    expect(load("T = { , , }").root).toEqual(T({ T: T() }));
    expect(load("T = { 1, 2, }").root).toEqual(T({ T: T({}, [1, 2]) }));
  });

  test("inside braces entries need a comma (the top level does not)", () => {
    const r = load("T = { A = 1 B = 2 }");
    expect(r.ok).toBe(false);
    expect(r.p.failure).toMatchObject({ line: 1, token: "B" });
    expect(load("A = 1 B = 2").ok).toBe(true);
    expect(load("A = 1 2").ok).toBe(false);
    expect(load('A = "x" "y"').ok).toBe(false);
  });

  test("unbalanced braces fail; what was read so far stays and the stacks are not unwound", () => {
    const r = load("A = 1\nT = { B = 2,");
    expect(r.ok).toBe(false);
    expect(r.p.tables.length).toBe(2);
    expect(r.p.root.map.get("A")!.num).toBe(1);
    expect(load("}").ok).toBe(false);
    expect(load("A = 1 }").ok).toBe(false);
    expect(load("T = { A = 1 } }").ok).toBe(false);
    expect(load("T = {").ok).toBe(false);
  });

  test("assigning nil removes the name, later statements overwrite earlier ones", () => {
    expect(load("A = 1 A = nil B = 2 B = 3 C = 4").root).toEqual(T({ B: 3, C: 4 }));
  });

  test("identifiers: statements read so far win over the Lua globals; unknown names are nil; globals that are tables are refused", () => {
    const g = { X: 5, S: "str", Flag: true, Tab: luaTable({}), Fn: new LuaNative("f", () => {}) };
    const r = load("X = 1,\nA = X,\nB = S,\nC = Flag,\nD = Missing,\nT = { E = X, F = S, G = Flag },", g);
    expect(r.ok).toBe(true);
    expect(r.root).toEqual(T({ X: 1, A: 1, B: "str", C: true, T: T({ E: 1, F: "str", G: true }) }));
    expect(load("A = Tab,", g).ok).toBe(false);
    expect(load("A = Fn,", g).ok).toBe(false);
    expect(load("T = { Tab }", g).ok).toBe(false);
    // nil / true / false are case sensitive: True, NIL and FALSE here are just unknown names, i.e. nil, and nil removes the name
    expect(load("A = 1, A = True, B = 2, B = NIL, C = FALSE,", g).root).toEqual(T());
  });

  test("an identifier is only resolved at the next comma / closing brace / end of text, so the next statement needs one", () => {
    expect(load("A = TRUE\nB = 2").ok).toBe(false);
    expect(load("A = TRUE,\nB = 2").root).toEqual(T({ A: 1, B: 2 }));
    expect(load("A = TRUE").root).toEqual(T({ A: 1 }));
    expect(load("T = { A = TRUE }").root).toEqual(T({ T: T({ A: 1 }) }));
    // a string global is cut at its first NUL (lua_tolstring + strlen)
    expect(load("A = S,", { S: "ab\0cd" }).root).toEqual(T({ A: "ab" }));
  });

  test("a bare name is a list entry (nil when unknown)", () => {
    const r = load("T = { X, S, Missing }", { X: 1, S: "s" });
    expect(r.root).toEqual(T({ T: T({}, [1, "s", null]) }));
    expect(load("A = 5 A").root).toEqual(T({ A: 5 }, [5]));
  });

  test("tables are shared by reference; a table can contain itself", () => {
    const { p } = load("T = { X = 1 }\nU = T,\nV = { Me = T },");
    expect(p.root.map.get("U")!.table).toBe(p.root.map.get("T")!.table);
    const self = load("T = { Me = T, }");
    expect(self.ok).toBe(true);
    const t = self.p.root.map.get("T")!.table!;
    expect(t.map.get("Me")!.table).toBe(t);
  });

  test("references NAME[n] and NAME[\"key\"]", () => {
    const r = load('T = { A = 1, B = 2, 30, 40 }\nX = T["A"]\nY = T[2]\nZ = T[9]\nL = { T[1], T["B"], T[3] }');
    expect(r.ok).toBe(true);
    expect(r.root).toEqual(T({ T: T({ A: 1, B: 2 }, [30, 40]), X: 1, Y: 40, L: T({}, [30, 2, null]) }));
    // out of range / missing key: nil, which removes the name
    expect(load('A = 5\nT = { 1 }\nA = T[2]\nB = 6\nB = T["x"]').root).toEqual(T({ T: T({}, [1]) }));
    // a Lua global table is indexed too (this is how GameOption.txt gets its OPTION_LEVEL values)
    expect(load('A = OPTION_LEVEL["OL_LOW"]\nB = OPTION_LEVEL["NOPE"]\nC = SERVER_GROUP_ID["SGI_GAIA"]\nD = ARR[2]', { ...enumGlobals(), ARR: luaTable({}, [10, 20]) }).root)
      .toEqual(T({ A: 2, C: 1, D: 20 }));
  });

  test("references that cannot be resolved fail the whole read", () => {
    for (const bad of [
      "T = { 1 }\nW = T[0]", // index must be >= 1
      "T = { 1 }\nW = T[-1]",
      "T = { 1 }\nW = T[1.5]", // and an integer
      'W = Q["a"]', // unknown name
      'A = 1\nW = A["a"]', // not a table
      'W = TRUE["x"]', // global that is not a table
      "T = { 1 }\nW = T[ ]", // empty brackets: no value
      "T = { 1 }\nW = T[nil]",
      "A [ 1 ]",
      "]",
      "[",
      'T = { 1 }\nT[1] = 3', // '=' needs a plain name
    ]) {
      expect(load(bad).ok).toBe(false);
    }
  });

  test("grammar errors", () => {
    for (const bad of [
      "= 1",
      "A = = 1",
      "A B",
      "A = B = C",
      "A = 1 {",
      "A = }",
      '"A" = 1',
      "1 = 2",
      "A.B = 1",
      "A = f(1)",
      "A = 1 + 2",
      ".5",
      "A = .5",
      "A = -x",
      "A = - 5",
      'A = "unterminated',
      'A = "',
      "A = 'single'",
      "A = [[long]]",
      'A = "hello world"', // a string cannot contain blanks ...
      'A = "a,b"', // ... or any of = , { } [ ]
      'A = "x=y"',
      'A = "[x]"',
    ]) {
      expect(load(bad).ok).toBe(false);
    }
  });

  test("malformed numbers throw like boost::lexical_cast (the exe's loader does not catch it)", () => {
    for (const bad of ["A = 0x10", "A = 12abc", "A = 1e", "A = 1;", "A = 1.2.3", "A = -1x", "A = 9e999", "T = { 1_000 }"]) {
      expect(() => load(bad)).toThrow(BadLexicalCast);
    }
    expect(load("A = 1.").root).toEqual(T({ A: 1 }));
    expect(load("A = 007").root).toEqual(T({ A: 7 }));
    expect(load("A = 1E+2").root).toEqual(T({ A: 100 }));
    expect(load("A = -0").root.map.A).toBe(-0);
  });

  test("empty strings and UTF-8 bytes are kept as they are", () => {
    const r = load(utf8('A = "", B = "한글"'));
    expect(r.root).toEqual(T({ A: "", B: String.fromCharCode(...utf8("한글")) }));
    expect(r.p.getString("B")).toBe("한글");
    expect(r.p.getString("A")).toBe("");
  });

  test("a token keeps its raw text as the name, only LuaParse trims it (form feed quirk)", () => {
    const r = load("A\f = 1\f");
    expect(r.root).toEqual(T({ "A\f": 1 }));
  });

  test("failure reports the line (CR LF counts once), the token and the state", () => {
    const r = load("A = 1\r\nB = = 2\r\n");
    expect(r.ok).toBe(false);
    expect(r.p.failure).toMatchObject({ line: 2, token: "=" });
    expect(load("A = 1").p.failure).toBeNull();
  });
});

describe("LuaParse", () => {
  const { p } = makeProxy({ ...enumGlobals(), ARR: luaTable({}, [10, 20, 30]), KEY: "OL_HIGH", NINE: 9 });
  const parse = (s: string, expand: boolean) => {
    const v = new ProxyValue();
    const r = p.luaParse(s, expand, v);
    return [r, v.toJS()] as const;
  };
  const { ERROR, VALUE, KEYWORD } = LuaParseResult;

  test("literals", () => {
    expect(parse('""', false)).toEqual([VALUE, ""]);
    expect(parse('"abc"', false)).toEqual([VALUE, "abc"]);
    expect(parse('"a"b"', false)).toEqual([VALUE, 'a"b']); // the first and the last quote, nothing is unescaped
    expect(parse('"\\n"', false)).toEqual([VALUE, "\\n"]);
    expect(parse('"', false)[0]).toBe(ERROR);
    expect(parse('"abc', false)[0]).toBe(ERROR);
    expect(parse("abc\"", false)[0]).toBe(ERROR);
    expect(parse("nil", false)).toEqual([VALUE, null]);
    expect(parse("true", false)).toEqual([VALUE, true]);
    expect(parse("false", false)).toEqual([VALUE, false]);
    expect(parse("  42  ", false)).toEqual([VALUE, 42]); // trimmed
    expect(parse("", false)[0]).toBe(ERROR);
    expect(parse(" \t ", false)[0]).toBe(ERROR);
  });

  test("numbers", () => {
    expect(parse("1e3", false)).toEqual([VALUE, 1000]);
    expect(parse("-1", false)).toEqual([VALUE, -1]);
    expect(parse("+1.5", false)).toEqual([VALUE, 1.5]);
    expect(parse("-1e2", false)).toEqual([VALUE, -100]);
    expect(parse("0.1", false)).toEqual([VALUE, 0.1]);
    for (const e of ["-", "+", "+x", "-.5", ".5", "-nan", "-inf"]) expect(parse(e, false)[0]).toBe(ERROR);
    for (const e of ["1abc", "0x1f", "1e", "1..2", "1 2"]) expect(() => parse(e, false)).toThrow(BadLexicalCast);
  });

  test("identifiers: KEYWORD, or resolved when expanding", () => {
    expect(parse("abc", false)[0]).toBe(KEYWORD);
    expect(parse("_x1", false)[0]).toBe(KEYWORD);
    expect(parse("TRUE", false)[0]).toBe(KEYWORD);
    expect(parse("TRUE", true)).toEqual([VALUE, 1]);
    expect(parse("NOPE", true)).toEqual([VALUE, null]); // unknown global: nil
    expect(parse("KEY", true)).toEqual([VALUE, "OL_HIGH"]);
    expect(parse("OPTION_LEVEL", true)[0]).toBe(ERROR); // a table cannot be a value
    for (const e of ["a-b", "a.b", "a b", "1a", "a(", "a$"]) {
      if (/^\d/.test(e)) expect(() => parse(e, false)).toThrow(BadLexicalCast);
      else expect(parse(e, false)[0]).toBe(ERROR);
    }
  });

  test("NAME[index] and NAME[\"key\"] (the console form: ExecCommand parses its arguments with expansion on)", () => {
    expect(parse('OPTION_LEVEL["OL_LOW"]', false)).toEqual([VALUE, 2]);
    expect(parse('OPTION_LEVEL[ "OL_LOW" ]', false)).toEqual([VALUE, 2]);
    expect(parse('SERVER_GROUP_ID["SGI_GAIA"]', true)).toEqual([VALUE, 1]);
    expect(parse("OPTION_LEVEL[KEY]", true)).toEqual([VALUE, 0]); // the key is parsed with expansion
    expect(parse("ARR[2]", false)).toEqual([VALUE, 20]);
    expect(parse("ARR[NINE]", true)).toEqual([VALUE, null]);
    expect(parse("ARR[0]", false)).toEqual([VALUE, null]); // no >= 1 check on this path: global[0] is just nil
    expect(parse('OPTION_LEVEL["NOPE"]', false)).toEqual([VALUE, null]);
    for (const e of ["ARR[1.5]", "ARR[", "ARR[]", "ARR[2", "ARR[2]x", "NOPE[1]", "ARR[nil]", "ARR[true]", "TRUE[1]", "ARR[[1]]"]) {
      expect(parse(e, false)[0]).toBe(ERROR);
    }
  });
});

describe("queries", () => {
  test("BeginTable / EndTable / StackGetValue, with and without an index", () => {
    const { p } = load(
      'UNIT0 = { UNIT_NAME = "Elsword", VIEW_AFTER_A_WEEK = TRUE, LAST_VIEW_YDAY_CANDIDATE_LIST = 45, REFUSE_FOR_A_WEEK = FALSE, 7, 8 },\n' +
        'UNIT1 = { UNIT_NAME = "Aisha", LAST_REFUSE_YDAY_TUTOR_REQUEST = 12 },\nPLAIN = 3,\nNESTED = { INNER = { X = 1 } },',
    );
    expect(p.getInt("PLAIN")).toBe(3);
    expect(p.beginTable("UNIT", 0)).toBe(true);
    expect(p.getString("UNIT_NAME")).toBe("Elsword");
    expect(p.getBool("VIEW_AFTER_A_WEEK")).toBe(true);
    expect(p.getInt("LAST_VIEW_YDAY_CANDIDATE_LIST")).toBe(45);
    expect(p.getBool("REFUSE_FOR_A_WEEK")).toBe(false);
    expect(p.getInt("LAST_REFUSE_YDAY_TUTOR_REQUEST")).toBeUndefined(); // not in this unit
    expect(p.stackGetValue(1)!.num).toBe(7);
    expect(p.stackGetValue(2)!.num).toBe(8);
    expect(p.stackGetValue(0)).toBeUndefined();
    expect(p.stackGetValue(3)).toBeUndefined();
    expect(p.getInt("PLAIN")).toBeUndefined(); // lookups use the innermost table now
    expect(p.endTable()).toBe(true);
    expect(p.endTable()).toBe(false); // the root table stays
    expect(p.beginTable("UNIT", 1)).toBe(true);
    expect(p.getString("UNIT_NAME")).toBe("Aisha");
    expect(p.getInt("LAST_REFUSE_YDAY_TUTOR_REQUEST")).toBe(12);
    p.endTable();
    expect(p.beginTable("UNIT", 2)).toBe(false); // UNIT2 does not exist
    expect(p.beginTable("UNIT", -1)).toBe(false);
    expect(p.beginTable("PLAIN")).toBe(false); // not a table
    expect(p.beginTable("")).toBe(false);
    expect(p.beginTable("NESTED")).toBe(true);
    expect(p.beginTable("INNER")).toBe(true);
    expect(p.getInt("X")).toBe(1);
    expect(p.tables.length).toBe(3);
    expect(p.endTable()).toBe(true);
    expect(p.endTable()).toBe(true);
    expect(p.tables.length).toBe(1);
  });

  test("lookups while reading use the first table, not the open one", () => {
    // an inner table cannot see the names of its parent, only the statements of the root table
    const r = load("T = { A = 1, U = { B = A, C = Inner }, Inner = 2 },");
    expect(r.ok).toBe(true);
    expect(r.root).toEqual(T({ T: T({ A: 1, U: T({}), Inner: 2 }) }));
  });

  test("GetValue(bool): nil, boolean, number != 0 after truncation; strings and tables fail", () => {
    const { p } = load('N = 0, H = 0.5, O = 2, NEG = -0.9, S = "x", T = { }, B = true, F = false, Z = nil,');
    expect(p.root.map.has("Z")).toBe(false);
    expect(p.getBool("N")).toBe(false);
    expect(p.getBool("H")).toBe(false); // (int)0.5 == 0
    expect(p.getBool("NEG")).toBe(false);
    expect(p.getBool("O")).toBe(true);
    expect(p.getBool("B")).toBe(true);
    expect(p.getBool("F")).toBe(false);
    expect(p.getBool("S")).toBeUndefined();
    expect(p.getBool("T")).toBeUndefined();
    expect(p.getBool("MISSING")).toBeUndefined();
    expect(p.getBool("Z")).toBeUndefined(); // nil assignment removed it
  });

  test("GetNumberFromLuaValue<int> / <float>", () => {
    const { p } = load('A = 2.9, B = -2.9, C = 1e10, D = "12", E = "-7", F = true, G = false, H = 0.1, I = "1.5", J = "", K = "2147483648", T = { }, S = "1e3",');
    expect(p.getInt("A")).toBe(2);
    expect(p.getInt("B")).toBe(-2);
    expect(p.getInt("C")).toBe(-2147483648); // cvttsd2si: "integer indefinite"
    expect(p.getInt("D")).toBe(12);
    expect(p.getInt("E")).toBe(-7);
    expect(p.getInt("F")).toBe(1);
    expect(p.getInt("G")).toBe(0);
    expect(() => p.getInt("I")).toThrow(BadLexicalCast);
    expect(() => p.getInt("J")).toThrow(BadLexicalCast);
    expect(() => p.getInt("K")).toThrow(BadLexicalCast); // does not fit
    expect(() => LuaManagerProxy.intFromValue(ProxyValue.string(" 5"))).toThrow(BadLexicalCast); // skipws is off
    expect(p.getInt("T")).toBeUndefined();
    expect(p.getInt("NOPE")).toBeUndefined();
    expect(p.getFloat("H")).toBe(Math.fround(0.1));
    expect(p.getFloat("A")).toBe(Math.fround(2.9));
    expect(p.getFloat("I")).toBe(1.5);
    expect(p.getFloat("S")).toBe(1000);
    expect(p.getFloat("F")).toBe(1);
    expect(() => p.getFloat("J")).toThrow(BadLexicalCast);
    expect(p.getFloat("T")).toBeUndefined();
  });

  test("GetValue(wstring): numbers are formatted with 17 digits, strings are decoded from UTF-8, the rest fails", () => {
    const { p } = load(utf8('A = 1024, B = 0.1, C = -439, D = "엘소드", E = true, T = { }, G = 0.5,'));
    expect(p.getString("A")).toBe("1024");
    expect(p.getString("B")).toBe("0.10000000000000001");
    expect(p.getString("C")).toBe("-439");
    expect(p.getString("D")).toBe("엘소드");
    expect(p.getString("G")).toBe("0.5");
    expect(p.getString("E")).toBeUndefined();
    expect(p.getString("T")).toBeUndefined();
    expect(p.getString("NOPE")).toBeUndefined();
    // invalid UTF-8 becomes U+FFFD (MultiByteToWideChar), a BOM is kept
    const v = new ProxyValue();
    v.type = LuaValueType.STRING;
    v.str = "a\xffb";
    expect(LuaManagerProxy.stringFromValue(v)).toBe("a\ufffdb");
    v.str = BOM + "x";
    expect(LuaManagerProxy.stringFromValue(v)).toBe("\ufeffx");
  });

  test("LuaCall: boolean / number / string arguments, everything else is nil; only functions can be called", () => {
    const seen: LuaValue[][] = [];
    const { p } = makeProxy({ ...enumGlobals(), Echo: new LuaNative("Echo", (_L, args) => void seen.push(args)), NotFn: 3 });
    const nilv = new ProxyValue();
    const tab = ProxyValue.tableOf(new ProxyTable());
    expect(p.luaCall("Echo", [ProxyValue.number(1.5), ProxyValue.string("x"), ProxyValue.boolean(true), nilv, tab])).toBe(true);
    expect(seen).toEqual([[1.5, "x", true, undefined, undefined]]);
    expect(p.luaCall("Echo", [])).toBe(true);
    expect(p.luaCall("NotFn", [])).toBe(false);
    expect(p.luaCall("Missing", [])).toBe(false);
    expect(p.luaCall("", [])).toBe(false);
    expect(new LuaManagerProxy(null).luaCall("Echo", [])).toBe(false);
  });

  test("a proxy without a Lua state only knows the file's own names", () => {
    const p = new LuaManagerProxy(null);
    expect(p.doMemoryNotEncrypt(bytes("A = 1\nB = A,\nC = TRUE,"))).toBe(false); // TRUE is unknown without a state: LuaKeyword fails
    expect(p.root.map.get("B")!.num).toBe(1);
  });

  test("conversions: cvttsd2si, lexical casts", () => {
    expect([cvttsd2si(1.9), cvttsd2si(-1.9), cvttsd2si(2147483647.5), cvttsd2si(2147483648), cvttsd2si(-2147483648.9), cvttsd2si(-2147483649), cvttsd2si(NaN), cvttsd2si(Infinity)])
      .toEqual([1, -1, 2147483647, -2147483648, -2147483648, -2147483648, -2147483648, -2147483648]);
    expect([lexicalCastInt("0"), lexicalCastInt("-0"), lexicalCastInt("+5"), lexicalCastInt("2147483647"), lexicalCastInt("-2147483648")]).toEqual([0, 0, 5, 2147483647, -2147483648]);
    for (const bad of ["", "-", "+", "1.0", "1e3", "0x1", " 1", "1 ", "2147483648", "-2147483649", "١"]) expect(() => lexicalCastInt(bad)).toThrow(BadLexicalCast);
    expect([lexicalCastDouble("1"), lexicalCastDouble("1."), lexicalCastDouble("-.5"), lexicalCastDouble("+1e-2"), lexicalCastDouble("00.5E1")]).toEqual([1, 1, -0.5, 0.01, 5]);
    for (const bad of ["", ".", "e1", "1e", "1e+", "inf", "nan", "0x1p3", " 1", "1 ", "1e999", "--1"]) expect(() => lexicalCastDouble(bad)).toThrow(BadLexicalCast);
  });
});

describe("the shipped files", () => {
  const dataDir = new URL("../../../data/", import.meta.url).pathname;
  const path = dataDir + "data036.kom";

  async function shipped() {
    const kom = await KomArchive.open(fileSource(path));
    const read = async (name: string) => await kom.read(kom.find(name)!);
    // the globals the game scripts define before these files are read
    const G = createLuaState({ write: () => {} });
    call(G.main, loadChunk(G.main, await read("Enum.lua"), "@Enum.lua"), []);
    return { G, read };
  }

  test("Enum.lua defines what the test globals above assume", async () => {
    if (!existsSync(path)) return;
    const { G } = await shipped();
    const plain = (t: LuaValue) => {
      const o: Record<string, LuaValue> = {};
      let nx = (t as LuaTable).next(undefined);
      while (nx) {
        o[String(nx[0])] = nx[1];
        nx = (t as LuaTable).next(nx[0]);
      }
      return o;
    };
    expect([G.globals.getStr("TRUE"), G.globals.getStr("FALSE")]).toEqual([1, 0]);
    expect(plain(G.globals.getStr("OPTION_LEVEL"))).toEqual({ OL_HIGH: 0, OL_MEDIUM: 1, OL_LOW: 2 });
    expect(plain(G.globals.getStr("SERVER_GROUP_ID"))).toEqual({ SGI_INVALID: -1, SGI_SOLES: 0, SGI_GAIA: 1, SGI_END: 2 });
  });

  test("GameOption.txt", async () => {
    if (!existsSync(path)) return;
    const { G, read } = await shipped();
    const p = new LuaManagerProxy(G.main);
    expect(p.doMemoryNotEncrypt(await read("GameOption.txt"))).toBe(true);
    expect(p.root.toJS()).toEqual(
      T({
        GAME_OPTION_CURRENT: T({
          AUTOSET_LEVEL: 0, GRAPHIC_UNIT: 0, GRAPHIC_TEXTURE: 0, GRAPHIC_MAP: 0, GRAPHIC_EFFECT: 1, RESOLUTION_X: 1024, RESOLUTION_Y: 768,
          SOUND: 1, MUSIC: 1, SOUND_VOLUME: -439, MUSIC_VOLUME: -1871, DYNAMIC_CAMERA: 1, DUNGEON_ZOOM_CAMERA: 1,
        }),
      }),
    );
    // what CX2GameOption::OpenScriptFile does with it
    expect(p.beginTable("GAME_OPTION_CURRENT")).toBe(true);
    expect(p.getInt("RESOLUTION_X")).toBe(1024);
    expect(p.getInt("SOUND_VOLUME")).toBe(-439);
    expect(p.getBool("GRAPHIC_EFFECT")).toBe(true);
    expect(p.getBool("AUTOSET_LEVEL")).toBe(false);
    expect(p.endTable()).toBe(true);
  });

  test("GameOptionPreset.txt", async () => {
    if (!existsSync(path)) return;
    const { G, read } = await shipped();
    const p = new LuaManagerProxy(G.main);
    expect(p.doMemoryNotEncrypt(await read("GameOptionPreset.txt"))).toBe(true);
    const preset = (level: number, ol: number, effect: number, x: number, y: number) =>
      T({ AUTOSET_LEVEL: level, GRAPHIC_UNIT: ol, GRAPHIC_TEXTURE: ol, GRAPHIC_MAP: ol, GRAPHIC_EFFECT: effect, RESOLUTION_X: x, RESOLUTION_Y: y });
    expect(p.root.toJS()).toEqual(
      T({
        GAME_OPTION_PRESET0: preset(0, 2, 0, 640, 480),
        GAME_OPTION_PRESET1: preset(1, 2, 1, 1024, 768),
        GAME_OPTION_PRESET2: preset(2, 1, 1, 1024, 768),
        GAME_OPTION_PRESET3: preset(3, 0, 1, 1600, 1200),
      }),
    );
    expect(p.beginTable("GAME_OPTION_PRESET", 3)).toBe(true);
    expect(p.getInt("RESOLUTION_Y")).toBe(1200);
    expect(p.endTable()).toBe(true);
    expect(p.beginTable("GAME_OPTION_PRESET", 4)).toBe(false);
  });

  test("the server group file and the tutor file, as the game reads them", async () => {
    if (!existsSync(path)) return;
    const { G } = await shipped();
    // CX2InstanceData::OpenScriptServerGroupFile: `SERVER_GROUP = SERVER_GROUP_ID["SGI_GAIA"]`
    const sg = new LuaManagerProxy(G.main);
    expect(sg.doMemoryNotEncrypt(bytes(BOM + '-- lua header\r\nSERVER_GROUP = SERVER_GROUP_ID["SGI_GAIA"]\r\n'))).toBe(true);
    expect(sg.getInt("SERVER_GROUP")).toBe(1);
    // the BOM-only TutorSystem.lua that ships with the client is "empty": the loader returns false
    expect(new LuaManagerProxy(G.main).doMemoryNotEncrypt(bytes(BOM))).toBe(false);
  });
});
