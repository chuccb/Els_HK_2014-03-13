import { describe, expect, test } from "bun:test";
import { CKTDGUIUniBuffer } from "../src/unibuffer.ts";
import { UKFont } from "../src/font.ts";
import { fontWorld } from "./fontworld.ts";

/**
 * The measuring of `CKTDGUIUniBuffer`: `CPtoX` 32963BA0, `CPtoY` 32963E60, `GetLineWidth` 329648B0, `XtoCP` 32965CC0.  The buffer asks its UK
 * font for the width and the height of pieces of the text and divides by the resolution scale; every expected number is worked out by
 * hand from the decompile (and the float and integer arithmetic checked in Python).
 *
 * The scene: a back buffer of 1536 x 1536, so the layout (1024 x 768) is scaled by (1.5, 2); a UK font on the box font of fontworld.ts at 16 px
 * (no resolution following, E = 1).  The widths of the characters, in back buffer pixels, are A 9, B 11, space 5, # 7, W 15 (the width of a
 * text is the sum on its widest line: "AB" is 20, "A#" 16, "AB#" 27); a line is 17 high.  So a width of 20 is 20 / 1.5 = 13.33 layout
 * pixels, cut to 13, and a line of 17 is 17 / 2 = 8.5, times the number of line breaks.
 */
function scene(text: string, backBuffer?: { width: number; height: number }) {
  const w = fontWorld({}, backBuffer ? { backBuffer } : {});
  const ft = w.font(16, 0, 1, true);
  expect(ft.Load()).toBe(true);
  const uk = w.w.fonts.addUKFont(1, ft);
  const b = new CKTDGUIUniBuffer(w.w.devices.massFiles.log, 1);
  expect(b.SetText(text)).toBe(true);
  b.m_pFontNode = uk;
  return { ...w, b, uk };
}

const upTo = (n: number, fn: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => fn(i));

describe("CKTDGUIUniBuffer::CPtoX (32963BA0)", () => {
  test("the width of the text before the character, in layout pixels cut towards 0: A is 9 / 1.5 = 6, AB 20 / 1.5 = 13.33 -> 13, AB# 27 / 1.5 = 18", () => {
    const { b } = scene("AB#");
    expect(upTo(4, (n) => b.CPtoX(n, false))).toEqual([0, 6, 13, 18]);
  });

  test("... cut, not rounded: A# is 16 / 1.5 = 10.67 -> 10", () => {
    const { b } = scene("A#");
    expect(b.CPtoX(2, false)).toBe(10);
  });

  test("the count is unsigned: past the end (or -1, 0xFFFFFFFF) is all of the text", () => {
    const { b } = scene("AB#");
    expect([b.CPtoX(4, false), b.CPtoX(100, false), b.CPtoX(-1, false), b.CPtoX(0xffffffff, false)]).toEqual([18, 18, 18, 18]);
  });

  test("only what follows the last line break of the first nCP characters is measured: AB / A# / B", () => {
    const { b } = scene("AB\nA#\nB");
    // AB\nA#\nB: 0 "" -> 0, 1 A -> 6, 2 AB -> 13, 3 (the break last: an empty line) -> 0, 4 A -> 6, 5 A# -> 10, 6 (break) -> 0, 7 B: 11 / 1.5 = 7.33 -> 7
    expect(upTo(8, (n) => b.CPtoX(n, false))).toEqual([0, 6, 13, 0, 6, 10, 0, 7]);
  });

  test("bTrail is not looked at: the width up to a character and up to its trailing edge are the same", () => {
    const { b } = scene("AB#");
    expect(b.CPtoX(2, true)).toBe(13);
    expect(b.CPtoX(3, true)).toBe(18);
  });

  test("a buffer that hides its text measures the hide character, once for each character, and has no line breaks: # is 7, ## 14 / 1.5 = 9.33 -> 9, ### 21 / 1.5 = 14", () => {
    const { b } = scene("AB#");
    b.SetHideChar(true, 0x23);
    expect(upTo(4, (n) => b.CPtoX(n, false))).toEqual([0, 4, 9, 14]);
    // "A\nB" is three characters of a single line: 21 / 1.5 = 14 (the plain text's B alone would be 7)
    b.SetText("A\nB");
    expect(b.CPtoX(3, false)).toBe(14);
    b.SetHideChar(false, 0x23);
    expect(b.CPtoX(3, false)).toBe(7);
  });

  test("without a font: 0 (also for a buffer that was never allocated); with a font a buffer that was never allocated is the exe's wcslen(NULL)", () => {
    const { b, uk } = scene("AB#");
    b.m_pFontNode = null;
    expect(b.CPtoX(2, false)).toBe(0);
    const none = new CKTDGUIUniBuffer(scene("").w.devices.massFiles.log, 0);
    expect(none.CPtoX(2, false)).toBe(0);
    none.m_pFontNode = uk;
    expect(() => none.CPtoX(2, false)).toThrow(/no buffer/);
  });
});

describe("CKTDGUIUniBuffer::CPtoY (32963E60)", () => {
  test("the height of one line over the y scale (17 / 2 = 8.5) times the number of line breaks in the first nCP characters, cut towards 0: 0, 8, 17, 25", () => {
    const { b } = scene("A\nB\n#\nA");
    // A\nB\n#\nA: 0 "" and 1 A: none; 2 A\n and 3 A\nB: one (8.5 -> 8); 4 A\nB\n and 5 A\nB\n#: two (17); 6 and 7: three (25.5 -> 25)
    expect(upTo(8, (n) => b.CPtoY(n, false))).toEqual([0, 0, 8, 8, 17, 17, 25, 25]);
    expect(b.CPtoY(100, false)).toBe(25);
    expect(b.CPtoY(-1, false)).toBe(25);
    // the count is unsigned: -1 is all of the text, also when its last character is the break that counts (two breaks: 17, not one: 8)
    expect(scene("A\nB\n").b.CPtoY(-1, false)).toBe(17);
  });

  test("a line break that is the last character is counted, and the text it ends is what is measured: A\\n\\n is two breaks (17), an empty line is 17 high as well", () => {
    expect(scene("\n\n").b.CPtoY(2, false)).toBe(17);
    expect(scene("A\n\n").b.CPtoY(3, false)).toBe(17);
    expect(scene("A\n").b.CPtoY(2, false)).toBe(8);
  });

  test("no line break, no text and no font are 0; the text a buffer hides has no line breaks", () => {
    expect(scene("AB#").b.CPtoY(3, false)).toBe(0);
    expect(scene("").b.CPtoY(5, false)).toBe(0);
    const { b } = scene("A\nB");
    expect(b.CPtoY(3, false)).toBe(8);
    b.SetHideChar(true, 0x23);
    expect(b.CPtoY(3, false)).toBe(0);
    b.SetHideChar(false, 0x23);
    b.m_pFontNode = null;
    expect(b.CPtoY(3, false)).toBe(0);
  });

  test("the height is a float (17 over the y scale), and so is its product with the number of line breaks, cut after: a back buffer 1152 high (scale 1.5): 17 / 1.5 = 11.333333015441895, three times 33.999999046 is the float 34.0 -> 34 (a double would cut it to 33)", () => {
    const { b } = scene("A\nB\n#\nA", { width: 1536, height: 1152 });
    expect(upTo(8, (n) => b.CPtoY(n, false))).toEqual([0, 0, 11, 11, 22, 22, 34, 34]);
  });

  test("... and the quotient is a float before it is multiplied: 952 high (scale 1.2395833730697632): 17 / scale is the float 13.714284896850586, seven times it 95.99999428 -> 95 (the double quotient makes 96)", () => {
    const { b } = scene("A\nB\n#\nA\nB\n#\nA\nB", { width: 1536, height: 952 });
    expect(b.CPtoY(100, false)).toBe(95);
  });

  test("bTrail is not looked at; a buffer that was never allocated is the exe's wcslen(NULL)", () => {
    const { b, uk } = scene("A\nB");
    expect(b.CPtoY(3, true)).toBe(8);
    const none = new CKTDGUIUniBuffer(scene("").w.devices.massFiles.log, 0);
    none.m_pFontNode = uk;
    expect(() => none.CPtoY(1, false)).toThrow(/no buffer/);
  });
});

describe("CKTDGUIUniBuffer::GetLineWidth (329648B0)", () => {
  test("the width of the line the character is in: from after the last break before it to the next break at or after it, in layout pixels cut towards 0", () => {
    const { b } = scene("AB\nA#\nB");
    // AB (20 -> 13), A# (16 -> 10), B (11 -> 7); the break at the end of a line belongs to that line, a position right after a break to the next
    expect(upTo(8, (n) => b.GetLineWidth(n))).toEqual([13, 13, 13, 10, 10, 10, 7, 7]);
  });

  test("a line that starts after a break and ends at one takes the break too (the exe counts one character too many; its width is 0) and no more: A\\nB\\nW", () => {
    const { b } = scene("A\nB\nW");
    // A (9 -> 6), B (11 -> 7), W (15 -> 10): taking the W as well would make the second line 10
    expect(upTo(6, (n) => b.GetLineWidth(n))).toEqual([6, 6, 7, 7, 10, 10]);
  });

  test("without a break the line is all of the text; a position beyond it is std::out_of_range (not caught)", () => {
    const { b } = scene("AB#");
    expect(upTo(4, (n) => b.GetLineWidth(n))).toEqual([18, 18, 18, 18]);
    expect(() => b.GetLineWidth(4)).toThrow(RangeError);
    expect(() => b.GetLineWidth(-1)).toThrow(RangeError);
  });

  test("a buffer that hides its text is one line of hide characters; without a font 0; a buffer that was never allocated is the exe's wcslen(NULL)", () => {
    const { b, uk } = scene("A\nB");
    expect(upTo(4, (n) => b.GetLineWidth(n))).toEqual([6, 6, 7, 7]);
    b.SetHideChar(true, 0x23);
    expect(upTo(4, (n) => b.GetLineWidth(n))).toEqual([14, 14, 14, 14]);
    b.m_pFontNode = null;
    expect(b.GetLineWidth(1)).toBe(0);
    expect(b.GetLineWidth(99)).toBe(0);
    const none = new CKTDGUIUniBuffer(scene("").w.devices.massFiles.log, 0);
    none.m_pFontNode = uk;
    expect(() => none.GetLineWidth(0)).toThrow(/no buffer/);
  });
});

describe("CKTDGUIUniBuffer::XtoCP (32965CC0)", () => {
  test("the first character whose end is at or beyond x (x * 1.5 cut): AB# ends at 9, 20, 27 -> x 0 and 5 and 6 (7, 9) are 0, 7 (10) is 1, 14 (21) is 2", () => {
    const { b } = scene("AB#");
    const at = (x: number) => b.XtoCP(x);
    expect([0, 5, 6, 7, 13, 14, 18].map((x) => at(x).cp)).toEqual([0, 0, 0, 1, 1, 2, 2]);
    // 18 * 1.5 = 27 is the width of all three: it is the last one; 19 -> 28 is beyond all: the length
    expect([at(19).cp, at(100).cp]).toEqual([3, 3]);
    // below 0: the first character already reaches it
    expect(at(-5).cp).toBe(0);
  });

  test("the trail is always 0", () => {
    const { b } = scene("AB#");
    for (const x of [0, 7, 19]) expect(b.XtoCP(x).trail).toBe(0);
  });

  test("x is turned into back buffer pixels as a float and cut (5 * 1.5 = 7.5 -> 7: the first character, 9 wide, reaches 7; 6 * 1.5 = 9 is reached exactly)", () => {
    const { b } = scene("AB#");
    expect(b.XtoCP(5).cp).toBe(0);
    expect(b.XtoCP(6).cp).toBe(0);
    expect(b.XtoCP(7).cp).toBe(1);
    // 27 * 1.5 = 40.5 is cut to 40, not rounded to 41: ABABAB ends at 9, 20, 29, 40, 49, 60: the fourth character reaches 40
    expect(scene("ABABAB").b.XtoCP(27).cp).toBe(3);
  });

  test("the text itself is measured, not the hidden one: x 6 (9) is the first character, where ### (7, 14, 21) would reach it at the second", () => {
    const { b } = scene("AB#");
    b.SetHideChar(true, 0x23);
    expect(b.XtoCP(6).cp).toBe(0);
  });

  test("an empty text is 0; without a font {0, 0}; a buffer that was never allocated is the exe's wcslen(NULL)", () => {
    expect(scene("").b.XtoCP(50)).toEqual({ cp: 0, trail: 0 });
    const { b, uk } = scene("AB#");
    b.m_pFontNode = null;
    expect(b.XtoCP(50)).toEqual({ cp: 0, trail: 0 });
    const none = new CKTDGUIUniBuffer(scene("").w.devices.massFiles.log, 0);
    expect(none.XtoCP(50)).toEqual({ cp: 0, trail: 0 });
    none.m_pFontNode = uk;
    expect(() => none.XtoCP(50)).toThrow(/no buffer/);
  });
});

describe("UKFont.scale", () => {
  test("is the app's resolution scale: (1.5, 2) on the 1536 x 1536 back buffer", () => {
    const { uk } = scene("A");
    expect([uk.scale.x, uk.scale.y]).toEqual([1.5, 2]);
    expect(uk).toBeInstanceOf(UKFont);
  });
});
