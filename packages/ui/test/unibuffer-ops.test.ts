/**
 * The editing and the measuring of `CKTDGUIUniBuffer` against what x2.exe answers: `tools/oracle-unibuf.py` runs the exe's own functions on a CPU emulator,
 * on buffers built by hand (a text in room for so many characters, the limits and modes, a font whose widths and heights are known numbers) and writes every
 * call down (`unibuffer-cases.json`): the arguments, the answer, the out values and the buffer afterwards (its text, its room, whether it has to be
 * analysed again, the errors written to the log).  The replay builds the same buffer on the port and expects the same.  The font is the oracle's: a
 * character is `5 + c mod 7` wide (a line break 0), a text is as wide as its widest line, `GetHeight` is `11 + length mod 5 + 6 * line breaks`; the
 * line height is `fontSize / enlarge + 1`.
 */
import { describe, expect, test } from "bun:test";
import { CKTDGUIUniBuffer, ansiLength, iswdigit, towupper } from "../src/unibuffer.ts";
import cases from "./unibuffer-cases.json";
import { configureBuffer, dec, stubFont } from "./unifont.ts";
import type { BufferSpec, Enc } from "./unifont.ts";

type Json = unknown;
type Op = Json[];
const script = cases as unknown as Op[];

/** the buffer's case of the script: the settings of `unifont.ts` and the resolution scale of the app */
interface BufferCase extends BufferSpec {
  scale: [number, number];
}

interface Result {
  ret: boolean | number | null;
  out: number[];
  text: Json;
  size: number;
  analyse: boolean;
  errors: string[];
}

let log: string[] = [];
let buf: CKTDGUIUniBuffer;

function build(c: BufferCase): void {
  log = [];
  buf = new CKTDGUIUniBuffer({ push: (id, text) => log.push(text === undefined ? `error ${id}` : `error ${id} ${text}`) }, 0);
  configureBuffer(buf, c, { x: c.scale[0], y: c.scale[1] });
}

function run(name: string, args: Json[]): { ret: boolean | number | null; out: number[] } {
  const n = args[0] as number;
  switch (name) {
    case "CPtoX":
      return { ret: null, out: [buf.CPtoX(n >>> 0, false)] };
    case "CPtoY":
      return { ret: null, out: [buf.CPtoY(n >>> 0, false)] };
    case "GetLineWidth":
      return { ret: buf.GetLineWidth(n), out: [] };
    case "XtoCP": {
      const r = buf.XtoCP(n);
      return { ret: null, out: [r.cp, r.trail] };
    }
    case "XYtoCP": {
      const r = buf.XYtoCP(n, args[1] as number);
      return { ret: null, out: [r.cp, r.trail] };
    }
    case "GetLineCount":
      return { ret: buf.GetLineCount(n >>> 0), out: [] };
    case "GetCaretLineMove":
      return { ret: buf.GetCaretLineMove(n, args[1] as number), out: [] };
    case "GetNextItemPos":
      return { ret: null, out: [buf.GetNextItemPos(n)] };
    case "GetPriorItemPos":
      return { ret: null, out: [buf.GetPriorItemPos(n)] };
    case "InsertChar":
      return { ret: buf.InsertChar(n, args[1] as number), out: [] };
    case "InsertString":
      return { ret: buf.InsertString(n, dec(args[1] as Enc) as string, args[2] as number), out: [] };
    case "RemoveChar":
      return { ret: buf.RemoveChar(n), out: [] };
    case "SetText":
      return { ret: buf.SetText(dec(args[0] as Enc) as string), out: [] };
    case "SetBufferSize":
      return { ret: buf.SetBufferSize(n), out: [] };
    case "Clear":
      buf.Clear();
      return { ret: null, out: [] };
    case "setCharAt":
      buf.setCharAt(n, args[1] as number);
      return { ret: null, out: [] };
  }
  throw new Error(`no such call: ${name}`);
}

describe("CKTDGUIUniBuffer against the exe's own answers (tools/oracle-unibuf.py)", () => {
  const calls = script.filter((op) => op[0] === "call");
  test(`the script has ${calls.length} calls`, () => {
    expect(calls.length).toBeGreaterThan(1500);
  });
  test("every call: the answer, the out values and the state of the buffer are the exe's", () => {
    const bad: string[] = [];
    for (const op of script) {
      if (op[0] === "reset") continue;
      if (op[0] === "buf") {
        build(op[1] as BufferCase);
        continue;
      }
      const [, label, name, args, want] = op as [string, string, string, Json[], Result];
      log.length = 0;
      let got: Result | string;
      try {
        const r = run(name, args);
        got = { ...r, text: buf.m_pwszBuffer, size: buf.m_nBufferSize, analyse: buf.m_bAnalyseRequired, errors: [...log] };
      } catch (e) {
        got = `threw ${(e as Error).message}`;
      }
      const same =
        typeof got !== "string" &&
        got.ret === want.ret &&
        got.out.join() === want.out.join() &&
        got.text === dec(want.text as Enc) &&
        got.size === want.size &&
        got.analyse === want.analyse &&
        got.errors.join("|") === want.errors.join("|");
      if (!same) bad.push(`${label}: want ${JSON.stringify(want).slice(0, 300)}, got ${typeof got === "string" ? got : JSON.stringify(got).slice(0, 300)}`);
    }
    expect(bad.length).toBe(0);
    if (bad.length) throw new Error(bad.slice(0, 12).join("\n"));
  });
});

describe("what the exe's tables are in the port", () => {
  test("towupper changes a to z only (the C locale), iswdigit knows the ASCII digits and the Unicode decimal digits, ansiLength is 1 below 0x80 and 2 above", () => {
    expect([0x60, 0x61, 0x7a, 0x7b, 0xe9, 0x41].map(towupper)).toEqual([0x60, 0x41, 0x5a, 0x7b, 0xe9, 0x41]);
    expect([0x2f, 0x30, 0x39, 0x3a, 0xb2, 0x660, 0xff11, 0x6211].map(iswdigit)).toEqual([false, true, true, false, false, true, true, false]);
    expect([ansiLength(""), ansiLength("abc"), ansiLength("a\u6211"), ansiLength("\u00e9")]).toEqual([0, 3, 3, 2]);
    // the border of the model: DEL is the last one byte character
    expect([0x7f, 0x80, 0x81].map((c) => ansiLength(String.fromCharCode(c)))).toEqual([1, 2, 2]);
  });
});

/**
 * What the exe does with memory it does not own is not something an emulator run can show (it reads and writes whatever lies there), so the port stops
 * with an error where the exe would go outside its text: an index before the text or a count past the string, a position behind the terminating NUL,
 * more than the 2000 lines the arrays of `GetCaretLineMove` hold, a buffer nobody allocated.  What the exe answers before it gets there (a limit that says
 * no) is the answer here too.
 */
describe("outside the buffer", () => {
  const quiet = { push: () => {} };
  const make = (text: string | null, font = true): CKTDGUIUniBuffer => {
    const b = new CKTDGUIUniBuffer(quiet, 0);
    b.m_pwszBuffer = text;
    b.m_nBufferSize = 4096;
    b.m_pFontNode = font ? stubFont(17, 1, { x: 1, y: 1 }) : null;
    return b;
  };

  test("a buffer nobody allocated has no words to walk over, no character to replace and no lines to count", () => {
    const none = (): CKTDGUIUniBuffer => make(null);
    expect(() => none().GetNextItemPos(0)).toThrow("no buffer is allocated");
    expect(() => none().GetPriorItemPos(5)).toThrow("no buffer is allocated");
    expect(() => none().XYtoCP(0, 0)).toThrow("no buffer is allocated");
    expect(() => none().GetCaretLineMove(0, 0)).toThrow("no buffer is allocated");
    expect(() => none().setCharAt(0, 65)).toThrow("outside the text");
    expect(none().RemoveChar(0)).toBe(false);
  });

  test("GetNextItemPos reads from the character after the one it is given: before the text is an error, an empty text has nothing to read", () => {
    expect(() => make("abc").GetNextItemPos(-3)).toThrow("before the text");
    expect(() => make("a").GetNextItemPos(-2)).toThrow("before the text");
    expect(make("abc").GetNextItemPos(-1)).toBe(3);
    expect(make("").GetNextItemPos(-2)).toBe(0);
  });

  test("GetPriorItemPos may look at the terminating NUL but not past it", () => {
    expect(make("ab cd").GetPriorItemPos(6)).toBe(3);
    expect(() => make("ab cd").GetPriorItemPos(7)).toThrow("past the text");
  });

  test("operator[] writes to a character of the text only", () => {
    const b = make("abc");
    expect(() => b.setCharAt(-1, 65)).toThrow("outside the text");
    expect(() => b.setCharAt(3, 65)).toThrow("outside the text");
    expect(b.m_pwszBuffer).toBe("abc");
    b.setCharAt(2, 65);
    expect(b.m_pwszBuffer).toBe("abA");
  });

  test("InsertString: an index before the text and a count that is not within the string are errors, but only once no limit has said no", () => {
    expect(() => make("abc", false).InsertString(-1, "x", -1)).toThrow("before the text");
    expect(() => make("abc").InsertString(1, "ab", 3)).toThrow("not within the string");
    expect(() => make("abc").InsertString(1, "ab", -2)).toThrow("not within the string");
    expect(() => make("abc").InsertString(1, "ab\0cd", 3)).toThrow("not within the string");
    const limited = make("abc", false);
    limited.m_nLengthLimit = 0;
    expect(limited.InsertString(-1, "x", -1)).toBe(false);
    expect(limited.InsertString(1, "ab", 3)).toBe(false);
    expect(limited.m_pwszBuffer).toBe("abc");
    const ok = make("abc");
    expect(ok.InsertString(1, "ab", 2)).toBe(true);
    expect(ok.m_pwszBuffer).toBe("aabbc");
    expect(ok.InsertString(0, "z", 0)).toBe(true);
    expect(ok.m_pwszBuffer).toBe("aabbc");
  });

  test("GetCaretLineMove keeps its lines in two arrays of 2000: 1999 line breaks are the most", () => {
    expect(make("\n".repeat(1999)).GetCaretLineMove(0, 1999)).toBe(1999);
    expect(() => make("\n".repeat(2000)).GetCaretLineMove(0, 1)).toThrow("more than 2000 lines");
  });
});
