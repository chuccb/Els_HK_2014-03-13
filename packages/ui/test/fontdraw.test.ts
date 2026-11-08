import { describe, expect, test } from "bun:test";
import { FONT_STYLE, FontArticle, UKFont } from "../src/font.ts";
import type { ColorF } from "../src/font.ts";
import type { Rect } from "../src/rect.ts";
import { drawnCalls } from "./rig.ts";
import type { DrawnCall } from "./rig.ts";
import { fontWorld } from "./fontworld.ts";

/**
 * The rest of `CUKFont` that the text boxes and the font manager use: `DrawFontStyle` 328B5890 (the outline and the shadow of a text),
 * `DrawTextFont` 328B6610 (a text in a rectangle, aligned by `sortFlag`), the queue of 2D texts (`Push2DText` 328B7EA0, `Delete2DFont`
 * 328B5320, `Get2DArticle` 328B6D20, `~CUKFont` 328B4F30) and `CKTDGFontManager::OnFrameMove` 328B7940, which spreads them.  Every
 * number is worked out by hand from the decompile (and the float and integer arithmetic checked in Python).
 *
 * The scene: a back buffer of 1536 x 1536, so the layout (1024 x 768) is scaled by (1.5, 2); a UK font on a glyph font of 16 px that does
 * not follow the resolution (the cell of `A` is 10 x 14; `GetWidth("AB")` is 20, `GetWidth("A")` 9, a line is 17 high) whose
 * `OutTextMultiline` writes its calls down.  The colours: the text (0.25, 0.375, 0.125, 0.5) is 0x80406020 (each channel
 * `(int)((float)(c * 255) + 0.5)`: 64, 96, 32, 128; cutting without the 0.5 would give 63, 95, 31, 127) and the outline
 * (0.875, 0.0625, 0.9375, 0.8125) is 0xCFDF10EF (223, 16, 239, 207).
 *
 * Some tests use a second scene, a back buffer of 1536 x 1152, the scale (1.5, 1.5): the y scale of the first (2) turns every int side into
 * a whole number and a float into a float, so there only the x sides show how a side is rounded.
 */

const TEXT: ColorF = { r: 0.25, g: 0.375, b: 0.125, a: 0.5 };
const TEXT_ARGB = 0x80406020;
const OUTLINE: ColorF = { r: 0.875, g: 0.0625, b: 0.9375, a: 0.8125 };
const OUTLINE_ARGB = 0xcfdf10ef;
const BLACK = 0xff000000;

type Call = { x: number; y: number; text: string | null; color: number; outline: number; lineSpace: number; rect: number[] | null; flag: number; count: number; sx: number; sy: number };

/** a UK font whose glyph font writes its `OutTextMultiline` calls down (and draws nothing) */
function scene(size = 16, enlarge = 1, backBuffer?: { width: number; height: number }) {
  const w = fontWorld({}, backBuffer ? { backBuffer } : {});
  const ft = w.font(size, 0, enlarge, true);
  expect(ft.Load()).toBe(true);
  const uk = w.w.fonts.addUKFont(1, ft);
  const calls: Call[] = [];
  ft.OutTextMultiline = ((x: number, y: number, text: string | null, color: number, outline: number, lineSpace: number, rect: Rect | null, flag: number, count: number, sx: number, sy: number) => {
    calls.push({ x, y, text, color, outline, lineSpace, rect: rect ? [rect.left, rect.top, rect.right, rect.bottom] : null, flag, count, sx, sy });
  }) as typeof ft.OutTextMultiline;
  return { ...w, ft, uk, calls };
}

/** what a call of the glyph font is: the text at the rectangle's top left, in the colour, with the outline colour 0xFF000000, line space 1, scale 1 */
const call = (rect: number[], color: number, flag: number, text = "AB", count = -1): Call => ({ x: rect[0]!, y: rect[1]!, text, color, outline: BLACK, lineSpace: 1, rect, flag, count, sx: 1, sy: 1 });

const rc = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });

/** the eight copies of an outline for the layout rectangle (11, 7, 111, 25): left, right, up, down, left up, left down, right up, right down */
const SHELL_11_7: number[][] = [
  [15, 14, 165, 50],
  [18, 14, 168, 50],
  [16, 12, 166, 48],
  [16, 16, 166, 52],
  [15, 12, 165, 48],
  [15, 16, 165, 52],
  [18, 12, 168, 48],
  [18, 16, 168, 52],
];

describe("DrawFontStyle (328B5890)", () => {
  test("FS_SHELL: eight copies of the text in the outline colour, each the rectangle moved by a layout pixel (left, right, up, down, then the four diagonals), scaled by (1.5, 2) and cut", () => {
    const { uk, calls } = scene();
    uk.DrawFontStyle("AB", rc(11, 7, 111, 25), 0x100, OUTLINE, FONT_STYLE.FS_SHELL, -1);
    // (11 +- 1) * 1.5 = 15, 18 and 11 * 1.5 = 16.5 -> 16; 111 * 1.5 = 166.5 -> 166; 7 * 2 = 14, 25 * 2 = 50
    expect(calls).toEqual(SHELL_11_7.map((r) => call(r, OUTLINE_ARGB, 0)));
  });

  test("the rectangle is scaled side by side and cut towards 0, also below 0: (-3 * 1.5 = -4.5) is -4, not -5", () => {
    const { uk, calls } = scene();
    uk.DrawFontStyle("AB", rc(-3, -7, 5, 3), 0, OUTLINE, FONT_STYLE.FS_SHELL, -1);
    expect(calls.map((c) => c.rect)).toEqual([
      [-6, -14, 6, 6],
      [-3, -14, 9, 6],
      [-4, -16, 7, 4],
      [-4, -12, 7, 8],
      [-6, -16, 6, 4],
      [-6, -12, 6, 8],
      [-3, -16, 9, 4],
      [-3, -12, 9, 8],
    ]);
    // the position is the rectangle's own corner
    expect(calls.map((c) => [c.x, c.y])).toEqual(calls.map((c) => [c.rect![0], c.rect![1]]));
  });

  test("FS_SHADOW: one copy, a layout pixel right and down: (12, 8, 112, 26) -> (18, 16, 168, 52)", () => {
    const { uk, calls } = scene();
    uk.DrawFontStyle("AB", rc(11, 7, 111, 25), 0, OUTLINE, FONT_STYLE.FS_SHADOW, -1);
    expect(calls).toEqual([call([18, 16, 168, 52], OUTLINE_ARGB, 0)]);
  });

  test("the sort flag is not looked at: the copies are always drawn with the flag 0; the count goes through", () => {
    const { uk, calls } = scene();
    uk.DrawFontStyle("AB", rc(11, 7, 111, 25), 5, OUTLINE, FONT_STYLE.FS_SHELL, 1);
    expect(calls.length).toBe(8);
    expect(calls.every((c) => c.flag === 0 && c.count === 1)).toBe(true);
    uk.DrawFontStyle("AB", rc(11, 7, 111, 25), 0xffffffff, OUTLINE, FONT_STYLE.FS_SHADOW, 7);
    expect(calls[8]).toEqual(call([18, 16, 168, 52], OUTLINE_ARGB, 0, "AB", 7));
  });

  test("the sides are floats first and cut after: (float)16777219 is 16777220 (so the side is 25165830, where 16777219 * 1.5 would make 25165828) and 16777218 * 1.5 is 25165828 (not 25165827)", () => {
    const { uk, calls } = scene();
    uk.DrawFontStyle("AB", rc(16777218, 0, 16777217, 0), 0, OUTLINE, FONT_STYLE.FS_SHADOW, -1);
    expect(calls).toEqual([call([25165830, 2, 25165828, 2], OUTLINE_ARGB, 0)]);
  });

  test("a y scale of 1.5 (a back buffer of 1536 x 1152): the sides are cut towards 0 like the x ones, not rounded and not floored: 7 * 1.5 = 10.5 -> 10, 25 * 1.5 = 37.5 -> 37, -7 * 1.5 = -10.5 -> -10", () => {
    const { uk, calls } = scene(16, 1, { width: 1536, height: 1152 });
    uk.DrawFontStyle("AB", rc(11, 7, 111, 25), 0, OUTLINE, FONT_STYLE.FS_SHELL, -1);
    expect(calls.map((c) => c.rect)).toEqual([
      [15, 10, 165, 37],
      [18, 10, 168, 37],
      [16, 9, 166, 36],
      [16, 12, 166, 39],
      [15, 9, 165, 36],
      [15, 12, 165, 39],
      [18, 9, 168, 36],
      [18, 12, 168, 39],
    ]);
    calls.length = 0;
    uk.DrawFontStyle("AB", rc(-3, -7, 5, 3), 0, OUTLINE, FONT_STYLE.FS_SHELL, -1);
    expect(calls.map((c) => c.rect)).toEqual([
      [-6, -10, 6, 4],
      [-3, -10, 9, 4],
      [-4, -12, 7, 3],
      [-4, -9, 7, 6],
      [-6, -12, 6, 3],
      [-6, -9, 6, 6],
      [-3, -12, 9, 3],
      [-3, -9, 9, 6],
    ]);
  });

  test("... and the y sides are floats first and cut after, as the x ones are (a scale of 1.5 shows it where 2 does not): (float)16777219 is 16777220, so 25165830, and 16777218 * 1.5 is 25165827, a float 25165828", () => {
    const { uk, calls } = scene(16, 1, { width: 1536, height: 1152 });
    uk.DrawFontStyle("AB", rc(0, 16777218, 0, 16777217), 0, OUTLINE, FONT_STYLE.FS_SHADOW, -1);
    expect(calls.map((c) => c.rect)).toEqual([[1, 25165830, 1, 25165828]]);
  });

  test("any other style draws nothing: FS_NONE, an unknown one, a negative one", () => {
    const { uk, calls } = scene();
    for (const style of [FONT_STYLE.FS_NONE, 3, 4, -1, 0x102]) uk.DrawFontStyle("AB", rc(11, 7, 111, 25), 0, OUTLINE, style, -1);
    expect(calls).toEqual([]);
  });

  test("no text, an empty text (its first character is the end) or a count of 0 draws nothing, in either style", () => {
    const { uk, calls } = scene();
    for (const style of [FONT_STYLE.FS_SHELL, FONT_STYLE.FS_SHADOW]) {
      uk.DrawFontStyle(null, rc(11, 7, 111, 25), 0, OUTLINE, style, -1);
      uk.DrawFontStyle("", rc(11, 7, 111, 25), 0, OUTLINE, style, -1);
      uk.DrawFontStyle("\0AB", rc(11, 7, 111, 25), 0, OUTLINE, style, -1);
      uk.DrawFontStyle("AB", rc(11, 7, 111, 25), 0, OUTLINE, style, 0);
    }
    expect(calls).toEqual([]);
    // a negative count is "all of it", not nothing
    uk.DrawFontStyle("AB", rc(11, 7, 111, 25), 0, OUTLINE, FONT_STYLE.FS_SHADOW, -5);
    expect(calls.length).toBe(1);
    expect(calls[0]!.count).toBe(-5);
  });

  test("the colour is the outline's, channel by channel clamped (a channel of 1 or more is 255, of 0 or less 0, NaN 255)", () => {
    const { uk, calls } = scene();
    uk.DrawFontStyle("AB", rc(0, 0, 10, 10), 0, { r: 1.5, g: -0.5, b: Number.NaN, a: 1 }, FONT_STYLE.FS_SHADOW, -1);
    expect(calls[0]!.color).toBe(0xffff00ff);
  });

  test("a glyph font that is not there is the exe's null dereference", () => {
    const { w } = scene();
    const bare = w.fonts.addUKFont(9, null);
    expect(() => bare.DrawFontStyle("AB", rc(11, 7, 111, 25), 0, OUTLINE, FONT_STYLE.FS_SHELL, -1)).toThrow(/m_pUKFont is null/);
    expect(() => bare.DrawFontStyle("AB", rc(11, 7, 111, 25), 0, OUTLINE, FONT_STYLE.FS_NONE, -1)).not.toThrow();
  });
});

describe("DrawTextFont (328B6610)", () => {
  const POS = rc(100, 40, 300, 80);

  test("sort flag 0, no outline: one call of the glyph font at the scaled rectangle's top left; the rectangle is scaled and cut (11 * 1.5 = 16.5 -> 16, 111 * 1.5 = 166.5 -> 166)", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("AB", rc(11, 7, 111, 25), -1, TEXT, false, OUTLINE, 0);
    expect(calls).toEqual([call([16, 14, 166, 50], TEXT_ARGB, 0)]);
  });

  test("with an outline the eight copies come first (the outline colour), then the text (its own colour) with the sort flag; the caller's rectangle is not changed", () => {
    const { uk, calls } = scene();
    const pos = rc(11, 7, 111, 25);
    uk.DrawTextFont("AB", pos, -1, TEXT, true, OUTLINE, 0);
    expect(calls).toEqual([...SHELL_11_7.map((r) => call(r, OUTLINE_ARGB, 0)), call([16, 14, 166, 50], TEXT_ARGB, 0)]);
    expect(pos).toEqual(rc(11, 7, 111, 25));
  });

  test("the copies are drawn in the rectangle the sort flag moved, with the flag 0; the text itself with the flag", () => {
    const { uk, calls } = scene();
    // flag 5 on (100, 40, 300, 80): CalcTextRect makes (100, 40, 120, 57), moved left by 20 / 2: (90, 40, 110, 57)
    uk.DrawTextFont("AB", POS, -1, TEXT, true, OUTLINE, 5);
    const shell = [
      [133, 80, 163, 114],
      [136, 80, 166, 114],
      [135, 78, 165, 112],
      [135, 82, 165, 116],
      [133, 78, 163, 112],
      [133, 82, 163, 116],
      [136, 78, 166, 112],
      [136, 82, 166, 116],
    ];
    expect(calls).toEqual([...shell.map((r) => call(r, OUTLINE_ARGB, 0)), call([135, 80, 165, 114], TEXT_ARGB, 5)]);
  });

  test("a text of two lines: CalcTextRect is asked for the whole height (34) and the widest line (`B`, 11): flag 1 and 5 (95, 40, 106, 74), flag 2 (89, 40, 100, 74)", () => {
    const one = scene();
    one.uk.DrawTextFont("A\nB", POS, -1, TEXT, false, OUTLINE, 1);
    one.uk.DrawTextFont("A\nB", POS, -1, TEXT, false, OUTLINE, 5);
    one.uk.DrawTextFont("A\nB", POS, -1, TEXT, false, OUTLINE, 2);
    expect(one.calls).toEqual([call([142, 80, 159, 148], TEXT_ARGB, 1, "A\nB"), call([142, 80, 159, 148], TEXT_ARGB, 5, "A\nB"), call([133, 80, 150, 148], TEXT_ARGB, 2, "A\nB")]);
  });

  test("the sides are floats first and cut after (as DrawFontStyle's)", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("AB", rc(16777219, 0, 16777218, 0), -1, TEXT, false, OUTLINE, 0);
    expect(calls).toEqual([call([25165830, 0, 25165828, 0], TEXT_ARGB, 0)]);
  });

  test("a left side below 0 is cut towards 0, not down: -3 * 1.5 = -4.5 is -4 (and 7 * 1.5 = 10.5 is 10, not rounded: the y scale here is 1.5 too)", () => {
    const { uk, calls } = scene(16, 1, { width: 1536, height: 1152 });
    uk.DrawTextFont("AB", rc(-3, -7, 5, 3), -1, TEXT, false, OUTLINE, 0);
    expect(calls).toEqual([call([-4, -10, 7, 4], TEXT_ARGB, 0)]);
    calls.length = 0;
    uk.DrawTextFont("AB", rc(11, 7, 111, 25), -1, TEXT, false, OUTLINE, 0);
    // 11 * 1.5 = 16.5 -> 16, 7 * 1.5 = 10.5 -> 10, 111 * 1.5 = 166.5 -> 166, 25 * 1.5 = 37.5 -> 37
    expect(calls).toEqual([call([16, 10, 166, 37], TEXT_ARGB, 0)]);
  });

  test("the y sides are floats first as well: (float)16777219 is 16777220 (25165830 where the double 16777219 * 1.5 = 25165828.5 would make 25165828)", () => {
    const { uk, calls } = scene(16, 1, { width: 1536, height: 1152 });
    uk.DrawTextFont("AB", rc(16777219, 16777219, 16777218, 16777218), -1, TEXT, false, OUTLINE, 0);
    expect(calls).toEqual([call([25165830, 25165830, 25165828, 25165828], TEXT_ARGB, 0)]);
  });

  test("the count goes to the copies and to the text, and sets the width the flag moves by: one character of `AB` is 9 wide, (100, 40, 109, 57) -> (96, 40, 105, 57)", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("AB", POS, 1, TEXT, true, OUTLINE, 5);
    const shell = [
      [142, 80, 156, 114],
      [145, 80, 159, 114],
      [144, 78, 157, 112],
      [144, 82, 157, 116],
      [142, 78, 156, 112],
      [142, 82, 156, 116],
      [145, 78, 159, 112],
      [145, 82, 159, 116],
    ];
    expect(calls).toEqual([...shell.map((r) => call(r, OUTLINE_ARGB, 0, "AB", 1)), call([144, 80, 157, 114], TEXT_ARGB, 5, "AB", 1)]);
  });

  test("the caller's rectangle is never changed, whatever the flag", () => {
    for (const flag of [0, 1, 2, 4, 5, 3]) {
      for (const outline of [false, true]) {
        const { uk } = scene();
        const pos = rc(100, 40, 300, 80);
        uk.DrawTextFont("AB", pos, -1, TEXT, outline, OUTLINE, flag);
        expect(pos).toEqual(rc(100, 40, 300, 80));
      }
    }
  });

  test("flag 1 centres the text on the rectangle's left side: the rectangle becomes the text's (width 20, a line of 17) moved left by half the width; the bottom is the text's, not the caller's", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("AB", POS, -1, TEXT, false, OUTLINE, 1);
    // (100, 40, 120, 57) -> (90, 40, 110, 57) -> (135, 80, 165, 114)
    expect(calls).toEqual([call([135, 80, 165, 114], TEXT_ARGB, 1)]);
  });

  test("half the width is the int division: 9 / 2 = 4 for an `A`, not 4.5", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("A", POS, -1, TEXT, false, OUTLINE, 1);
    // (100, 40, 109, 57) -> (96, 40, 105, 57) -> (144, 80, 157, 114): 105 * 1.5 = 157.5
    expect(calls).toEqual([call([144, 80, 157, 114], TEXT_ARGB, 1, "A")]);
  });

  test("flag 2 ends the text at the rectangle's left side: (left - width, left); an odd width stays whole", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("AB", POS, -1, TEXT, false, OUTLINE, 2);
    expect(calls).toEqual([call([120, 80, 150, 114], TEXT_ARGB, 2)]);
    calls.length = 0;
    uk.DrawTextFont("A", POS, -1, TEXT, false, OUTLINE, 2);
    // (91, 40, 100, 57) -> (136, 80, 150, 114): 91 * 1.5 = 136.5
    expect(calls).toEqual([call([136, 80, 150, 114], TEXT_ARGB, 2, "A")]);
  });

  test("flag 4 centres the text vertically in the caller's rectangle: top + h / 2 - t / 2, bottom + t / 2 - h / 2 (h = 40, t = 17: 52 and 68); left and right stay", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("AB", POS, -1, TEXT, false, OUTLINE, 4);
    expect(calls).toEqual([call([150, 104, 450, 136], TEXT_ARGB, 4)]);
  });

  test("... with int divisions towards 0: a rectangle of height -5 (top 40, bottom 35): -5 / 2 = -2, 17 / 2 = 8: (30, 45)", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("AB", rc(100, 40, 300, 35), -1, TEXT, false, OUTLINE, 4);
    expect(calls).toEqual([call([150, 60, 450, 90], TEXT_ARGB, 4)]);
  });

  test("... the height of the text is that of the first count characters (`A\\nB`: 34 for all of it, 17 for one character) over m_EnlargeNum", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("A\nB", POS, -1, TEXT, false, OUTLINE, 4);
    // t = 34: top = 40 + 20 - 17 = 43, bottom = 80 + 17 - 20 = 77
    expect(calls).toEqual([call([150, 86, 450, 154], TEXT_ARGB, 4, "A\nB")]);
    calls.length = 0;
    uk.DrawTextFont("A\nB", POS, 1, TEXT, false, OUTLINE, 4);
    expect(calls).toEqual([call([150, 104, 450, 136], TEXT_ARGB, 4, "A\nB", 1)]);
    // E = 2: the text of 34 is 17 high
    const e2 = scene(8, 2);
    e2.uk.DrawTextFont("A\nB", POS, -1, TEXT, false, OUTLINE, 4);
    expect(e2.calls).toEqual([call([150, 104, 450, 136], TEXT_ARGB, 4, "A\nB")]);
  });

  test("... the text's height is the glyph font's over m_EnlargeNum cut towards 0 (E = 2, a line of 19: 9, not 10): top 40 + 20 - 4, bottom 80 + 4 - 20", () => {
    const { uk, calls } = scene(9, 2);
    uk.DrawTextFont("AB", POS, -1, TEXT, false, OUTLINE, 4);
    // 9 * 2 = 18 px a glyph font: a line is 19 high, over 2 is 9 (half of it 4); the rectangle (56, 64) scaled by 2
    expect(calls).toEqual([call([150, 112, 450, 128], TEXT_ARGB, 4)]);
  });

  test("... and a rectangle that ends below 0: (top -60, bottom -55) h = 5, t = 17: top -60 + 2 - 8 = -66, bottom -55 + 8 - 2 = -49 (a float 8.5 would give -48.5 cut to -48)", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("AB", rc(100, -60, 300, -55), -1, TEXT, false, OUTLINE, 4);
    expect(calls).toEqual([call([150, -132, 450, -98], TEXT_ARGB, 4)]);
  });

  test("flag 5 is both: the width as flag 1 and, because CalcTextRect left the rectangle as high as the text, no change of top and bottom (top 40, bottom 57)", () => {
    const { uk, calls } = scene();
    uk.DrawTextFont("AB", POS, -1, TEXT, false, OUTLINE, 5);
    expect(calls).toEqual([call([135, 80, 165, 114], TEXT_ARGB, 5)]);
    calls.length = 0;
    uk.DrawTextFont("A", POS, -1, TEXT, false, OUTLINE, 5);
    expect(calls).toEqual([call([144, 80, 157, 114], TEXT_ARGB, 5, "A")]);
    // the count: the first character of `AB` is 9 wide, so 4 is taken off both sides
    calls.length = 0;
    uk.DrawTextFont("AB", POS, 1, TEXT, false, OUTLINE, 5);
    expect(calls).toEqual([call([144, 80, 157, 114], TEXT_ARGB, 5, "AB", 1)]);
  });

  test("any other flag leaves the rectangle: 0, 3, 6, 0x20 (the flag still goes through)", () => {
    for (const flag of [0, 3, 6, 0x20, 0x21, 0xffffffff]) {
      const { uk, calls } = scene();
      uk.DrawTextFont("AB", POS, -1, TEXT, false, OUTLINE, flag);
      expect(calls).toEqual([call([150, 80, 450, 160], TEXT_ARGB, flag)]);
    }
  });

  test("a rectangle, a text that is not empty and a count that is not 0 are needed; a negative count is all of it", () => {
    const { uk, calls } = scene();
    for (const outline of [false, true]) {
      uk.DrawTextFont("AB", null, -1, TEXT, outline, OUTLINE, 0);
      uk.DrawTextFont(null, POS, -1, TEXT, outline, OUTLINE, 0);
      uk.DrawTextFont("", POS, -1, TEXT, outline, OUTLINE, 0);
      uk.DrawTextFont("\0AB", POS, -1, TEXT, outline, OUTLINE, 0);
      uk.DrawTextFont("AB", POS, 0, TEXT, outline, OUTLINE, 0);
    }
    expect(calls).toEqual([]);
    uk.DrawTextFont("AB", POS, -3, TEXT, false, OUTLINE, 0);
    expect(calls).toEqual([call([150, 80, 450, 160], TEXT_ARGB, 0, "AB", -3)]);
  });

  test("a glyph font that is not there is the exe's null dereference", () => {
    const { w } = scene();
    const bare = w.fonts.addUKFont(9, null);
    expect(() => bare.DrawTextFont("AB", POS, -1, TEXT, false, OUTLINE, 0)).toThrow(/m_pUKFont is null/);
  });

  test("drawn: the text is a quad per glyph at the pixel the call names, behind eight outline copies one pixel (1.5 and 2 device pixels) around it", () => {
    const { w, dev, font } = fontWorld();
    const glyph = font(16, 0, 1, true);
    expect(glyph.Load()).toBe(true);
    const uk = w.fonts.addUKFont(1, glyph);
    dev!.log.length = 0;
    uk.DrawTextFont("A", rc(11, 7, 111, 25), -1, TEXT, true, OUTLINE, 0);
    const calls: DrawnCall[] = drawnCalls(dev!);
    // nine flushes of one glyph each: the cell of `A` is 10 x 14
    expect(calls.length).toBe(9);
    const quads = calls.flatMap((c) => {
      const out: number[][] = [];
      for (let i = 0; i < c.vertices.length; i += 6) out.push([c.vertices[i]![0]!, c.vertices[i]![1]!, c.vertices[i + 4]![0]!, c.vertices[i + 4]![1]!, c.vertices[i]![4]!]);
      return out;
    });
    const at = (x: number, y: number, color: number) => [x, y, x + 10, y + 14, color];
    expect(quads).toEqual([...SHELL_11_7.map((r) => at(r[0]!, r[1]!, OUTLINE_ARGB)), at(16, 14, TEXT_ARGB)]);
  });
});

describe("the queue of 2D texts: Push2DText (328B7EA0), Delete2DFont (328B5320), Get2DArticle (328B6D20), ~CUKFont (328B4F30)", () => {
  const push = (uk: UKFont, text = "Hi", over: { x?: number; y?: number; spread?: boolean; gap?: number; sort?: number; style?: number; instance?: boolean } = {}) =>
    uk.Push2DText(text, over.x ?? 10, over.y ?? 20, TEXT, OUTLINE, over.sort ?? 5, over.style ?? 2, over.instance ?? true, over.spread ?? false, over.gap ?? 0);

  test("a new font has an empty queue and the id 0; an article is all zero until it is filled (the constructor 328B4AC0)", () => {
    const { uk } = scene();
    expect([uk.m_TextID, uk.m_vecFont2D.length]).toEqual([0, 0]);
    const a = new FontArticle();
    expect([a.ID, a.strMsg, a.bInstance, a.sortFlag, a.fontStyle, a.bSpread, a.iSpreadCount, a.fSpreadTimeGap, a.fNowSpreadTime]).toEqual([0, "", false, 0, 0, false, 0, 0, 0]);
    expect([a.color, a.outLineColor, a.pos, a.rect]).toEqual([{ r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 0 }, { x: 0, y: 0, z: 0 }, rc(0, 0, 0, 0)]);
  });

  test("the ids count from 1 and are the answer; the article holds what was pushed (z and the rectangle stay 0), in the order of the pushes", () => {
    const { uk } = scene();
    expect(push(uk, "first", { x: 10, y: 20, sort: 5, style: 2, instance: true })).toBe(1);
    expect(push(uk, "second", { x: -3, y: 7, sort: -1, style: 1, instance: false })).toBe(2); // an `unsigned int`
    expect(uk.m_TextID).toBe(2);
    const [a, b] = uk.m_vecFont2D;
    expect([a!.ID, a!.strMsg, a!.pos, a!.sortFlag, a!.fontStyle, a!.bInstance, a!.rect]).toEqual([1, "first", { x: 10, y: 20, z: 0 }, 5, 2, true, rc(0, 0, 0, 0)]);
    expect([b!.ID, b!.strMsg, b!.pos, b!.sortFlag, b!.fontStyle, b!.bInstance]).toEqual([2, "second", { x: -3, y: 7, z: 0 }, 0xffffffff, 1, false]);
    expect(a!.color).toEqual(TEXT);
    expect(a!.outLineColor).toEqual(OUTLINE);
  });

  test("the position is a float: (float)16777217 is 16777216; the colours are copied, not shared; the text stops at its first NUL", () => {
    const { uk } = scene();
    const color = { ...TEXT };
    uk.Push2DText("ab\0cd", 16777217, -16777217, color, OUTLINE, 0, 0, false, false, 0);
    color.r = 0.9;
    const a = uk.m_vecFont2D[0]!;
    expect([a.pos.x, a.pos.y, a.strMsg, a.color.r]).toEqual([16777216, -16777216, "ab", 0.25]);
  });

  test("a text that spreads has the gap (a float: 0.3 is 0.30000001192092896), the time 0 and the count 0; one that does not drops the gap (it stays 0)", () => {
    const { uk } = scene();
    push(uk, "spreads", { spread: true, gap: 0.3 });
    push(uk, "still", { spread: false, gap: 0.3 });
    const [a, b] = uk.m_vecFont2D;
    expect([a!.bSpread, a!.fSpreadTimeGap, a!.fNowSpreadTime, a!.iSpreadCount]).toEqual([true, 0.30000001192092896, 0, 0]);
    expect([b!.bSpread, b!.fSpreadTimeGap, b!.fNowSpreadTime, b!.iSpreadCount]).toEqual([false, 0, 0, 0]);
  });

  test("Delete2DFont deletes the first article with the id, the later ones move up in order; false for an id nobody has (also in an empty queue), and the ids do not come back", () => {
    const { uk } = scene();
    expect(uk.Delete2DFont(1)).toBe(false);
    for (const t of ["a", "b", "c", "d"]) push(uk, t);
    expect(uk.Delete2DFont(2)).toBe(true);
    expect(uk.m_vecFont2D.map((x) => [x.ID, x.strMsg])).toEqual([[1, "a"], [3, "c"], [4, "d"]]);
    expect(uk.Delete2DFont(2)).toBe(false);
    expect(uk.Delete2DFont(5)).toBe(false);
    expect(uk.Delete2DFont(0)).toBe(false);
    expect(uk.Delete2DFont(4)).toBe(true);
    expect(uk.Delete2DFont(1)).toBe(true);
    expect(uk.m_vecFont2D.map((x) => x.ID)).toEqual([3]);
    // the next id is not reused
    expect(push(uk, "e")).toBe(5);
    expect(uk.m_vecFont2D.map((x) => x.ID)).toEqual([3, 5]);
  });

  test("with two articles of one id (only a test can make that) the first is the one that is found and deleted", () => {
    const { uk } = scene();
    for (const t of ["a", "b"]) push(uk, t);
    uk.m_vecFont2D[1]!.ID = 1;
    expect(uk.Get2DArticle(1)!.strMsg).toBe("a");
    expect(uk.Delete2DFont(1)).toBe(true);
    expect(uk.m_vecFont2D.map((x) => x.strMsg)).toEqual(["b"]);
  });

  test("Get2DArticle answers the article itself (not a copy) or null", () => {
    const { uk } = scene();
    expect(uk.Get2DArticle(1)).toBeNull();
    push(uk, "a");
    push(uk, "b");
    expect(uk.Get2DArticle(2)).toBe(uk.m_vecFont2D[1]!);
    expect(uk.Get2DArticle(1)).toBe(uk.m_vecFont2D[0]!);
    expect(uk.Get2DArticle(0)).toBeNull();
    expect(uk.Get2DArticle(3)).toBeNull();
    uk.Delete2DFont(1);
    expect(uk.Get2DArticle(1)).toBeNull();
  });

  test("~CUKFont deletes the queue first and then the glyph font; a font without one is the null dereference (after the queue has gone)", () => {
    const { uk, ft } = scene();
    push(uk, "a");
    push(uk, "b");
    uk.Destroy();
    expect(uk.m_vecFont2D.length).toBe(0);
    expect(uk.m_pUKFont).toBeNull();
    expect(ft.m_bLoad).toBe(false);
    const { w } = scene();
    const bare = w.fonts.addUKFont(9, null);
    push(bare, "c");
    expect(() => bare.Destroy()).toThrow(/m_pUKFont is null/);
    expect(bare.m_vecFont2D.length).toBe(0);
  });
});

describe("CKTDGFontManager::OnFrameMove (328B7940)", () => {
  const world = () => {
    const s = scene();
    s.w.fontManager.m_UKFontList.push(s.uk);
    return s;
  };
  const state = (uk: UKFont) => uk.m_vecFont2D.map((a) => [a.fNowSpreadTime, a.iSpreadCount]);
  const spread = (uk: UKFont, text: string, gap: number) => uk.Push2DText(text, 0, 0, TEXT, OUTLINE, 0, 0, false, true, gap);

  test("the time is added (a float sum, stored first); at the gap it is 0 again and one more character shows; texts that do not spread are not touched", () => {
    const { uk, w } = world();
    spread(uk, "abc", 0.5);
    uk.Push2DText("still", 0, 0, TEXT, OUTLINE, 0, 0, false, false, 0);
    w.fontManager.OnFrameMove(3, 0.25);
    expect(state(uk)).toEqual([[0.25, 0], [0, 0]]);
    w.fontManager.OnFrameMove(3, 0.25);
    expect(state(uk)).toEqual([[0, 1], [0, 0]]);
    w.fontManager.OnFrameMove(3, 0.125);
    expect(state(uk)).toEqual([[0.125, 1], [0, 0]]);
  });

  test("the sums are floats: 0.1f three times is 0.30000001192092896, which reaches a gap of 0.3f; in doubles (0.30000000447) it would not", () => {
    const { uk, w } = world();
    spread(uk, "abc", 0.3);
    w.fontManager.OnFrameMove(0, 0.1);
    expect(uk.m_vecFont2D[0]!.fNowSpreadTime).toBe(0.10000000149011612);
    w.fontManager.OnFrameMove(0, 0.1);
    expect(uk.m_vecFont2D[0]!.fNowSpreadTime).toBe(0.20000000298023224);
    expect(uk.m_vecFont2D[0]!.iSpreadCount).toBe(0);
    w.fontManager.OnFrameMove(0, 0.1);
    expect(state(uk)).toEqual([[0, 1]]);
  });

  test("the elapsed time is a float before it is added: 16777217 is 16777216, and 16777216 + 0.5 is 16777216 (the double 16777217.5 would make 16777218)", () => {
    const { uk, w } = world();
    spread(uk, "abc", 1e9);
    w.fontManager.OnFrameMove(0, 0.5);
    w.fontManager.OnFrameMove(0, 16777217);
    expect(uk.m_vecFont2D[0]!.fNowSpreadTime).toBe(16777216);
  });

  test("a time equal to the gap counts (the gap must not be greater): gap 0.5, 0.5 at once", () => {
    const { uk, w } = world();
    spread(uk, "abc", 0.5);
    w.fontManager.OnFrameMove(0, 0.5);
    expect(state(uk)).toEqual([[0, 1]]);
  });

  test("the count stops at the length of the text (the comparison is strict) and the time still starts again", () => {
    const { uk, w } = world();
    spread(uk, "ab", 0.25);
    for (let i = 0; i < 5; i++) w.fontManager.OnFrameMove(0, 0.25);
    expect(state(uk)).toEqual([[0, 2]]);
    spread(uk, "", 0.25);
    w.fontManager.OnFrameMove(0, 0.25);
    expect(state(uk)).toEqual([[0, 2], [0, 0]]);
  });

  test("a time that is more than the gap loses the rest (0, not the difference) and still shows one character, not several", () => {
    const { uk, w } = world();
    spread(uk, "abcdef", 0.25);
    w.fontManager.OnFrameMove(0, 1);
    expect(state(uk)).toEqual([[0, 1]]);
  });

  test("a NaN (the gap or the time) counts as reached: `comiss` + `ja` only skips when the gap is greater", () => {
    const { uk, w } = world();
    spread(uk, "abc", Number.NaN);
    w.fontManager.OnFrameMove(0, 0.25);
    expect(state(uk)).toEqual([[0, 1]]);
    const second = scene();
    second.w.fontManager.m_UKFontList.push(second.uk);
    spread(second.uk, "abc", 0.5);
    second.w.fontManager.OnFrameMove(0, Number.NaN);
    expect(state(second.uk)).toEqual([[0, 1]]);
  });

  test("every article of every font of the list moves, whatever the order; the first argument is not used", () => {
    const a = world();
    const b = scene();
    a.w.fontManager.m_UKFontList.push(b.uk);
    spread(a.uk, "abc", 0.25);
    spread(a.uk, "xyz", 0.5);
    spread(b.uk, "q", 0.75);
    spread(b.uk, "rs", 0.25);
    a.w.fontManager.OnFrameMove(1234.5, 0.25);
    expect(state(a.uk)).toEqual([[0, 1], [0.25, 0]]);
    expect(state(b.uk)).toEqual([[0.25, 0], [0, 1]]);
  });

  test("a font that is not in the list is not moved; an empty list or empty queues do nothing", () => {
    const { uk, w } = world();
    const other = scene();
    spread(other.uk, "abc", 0.25);
    w.fontManager.OnFrameMove(0, 0.25);
    expect(state(uk)).toEqual([]);
    expect(state(other.uk)).toEqual([[0, 0]]);
  });
});
