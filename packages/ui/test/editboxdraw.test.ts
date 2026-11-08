import { describe, expect, test } from "bun:test";
import { CKTDGUIDialog, CKTDGUIEditBox } from "../src/index.ts";
import type { ColorF, UKFont } from "../src/font.ts";
import type { Rect } from "../src/rect.ts";
import { fontWorld } from "./fontworld.ts";
import { drawnCalls, drawnQuads, quad } from "./rig.ts";
import { place } from "./stringspy.ts";

/**
 * What `CKTDGUIEditBox` draws: `OnFrameRender` 32934400, with `PlaceCaret` 32934A00, `DrawTextW` 329339F0 and `DrawRect` 329335A0.  Every
 * expected number is worked out by hand from the decompile (and the float and integer arithmetic checked in Python).
 *
 * The scene: the dialog is at (10.25, 20.5) and the box has the offset (0.75, 0.25) (stringspy.ts), so the text is moved by
 * (int)(float)(10.25 + 0.75) = 11 and (int)(float)(20.5 + 0.25) = 20 (20.75 cut); a back buffer of 1536 x 1536, so the layout (1024 x 768) is
 * scaled by (1.5, 2); a UK font on the box font of fontworld.ts at 16 px (the width of A is 9, B 11, # 7, the sum on a line: "AB" 20; a line
 * is 17 high) whose `DrawTextFont` writes its calls down.  The text rectangle of the box is (4, 6, 104, 30).  The x of a character is the
 * width of the text before it over 1.5 cut: "ABABAB" has the x 0, 6, 13, 19, 26, 32, 40 (the widths 0, 9, 20, 29, 40, 49, 60).
 *
 * The colours: the text colour 0x80C0A040 is (192, 160, 64, 128) bytes, each times 1/255 as a float: (0.7529412508010864, 0.6274510025978088,
 * 0.250980406999588, 0.501960813999176); the selection's text colour 0xFF305090 is (0.1882353127002716, 0.3137255012989044, 0.5647059082984924, 1).
 */

const TEXT_COLOR = [0.7529412508010864, 0.6274510025978088, 0.250980406999588, 0.501960813999176];
const SEL_COLOR = [0.1882353127002716, 0.3137255012989044, 0.5647059082984924, 1];
const WHITE = [1, 1, 1, 1];
const SEL_BK = 0xff28325c;

type Ev =
  | { k: "text"; text: string; rect: number[]; count: number; color: number[]; outline: boolean; outlineColor: number[]; flag: number }
  | { k: "rect"; rect: number[]; color: number };

const text = (t: string, rect: number[], count: number, color: number[], flag = 4, outline = false, outlineColor = WHITE): Ev => ({ k: "text", text: t, rect, count, color, outline, outlineColor, flag });
const fill = (rect: number[], color: number): Ev => ({ k: "rect", rect, color });
const rgba = (c: ColorF): number[] => [c.r, c.g, c.b, c.a];

function scene(content: string, backBuffer?: { width: number; height: number }) {
  const fw = fontWorld({}, backBuffer ? { backBuffer } : {});
  const ft = fw.font(16, 0, 1, true);
  expect(ft.Load()).toBe(true);
  const uk = fw.w.fonts.addUKFont(1, ft);
  const dialog = new CKTDGUIDialog(fw.w);
  const e = new CKTDGUIEditBox(fw.w);
  place(dialog, e);
  e.m_pFont = uk;
  Object.assign(e.m_rcText, { left: 4, top: 6, right: 104, bottom: 30 });
  expect(e.m_Buffer.SetText(content)).toBe(true);
  e.m_TextColor = 0x80c0a040;
  e.m_SelTextColor = 0xff305090;
  return { ...fw, dev: fw.dev!, ft, uk, dialog, e };
}

/** the calls of the font and of `DrawRect` written down (in order); nothing is drawn */
function spy(s: ReturnType<typeof scene>): Ev[] {
  const events: Ev[] = [];
  s.uk.DrawTextFont = ((strMsg: string | null, pos: Rect | null, nCount: number, color: ColorF, bOutline: boolean, outlineColor: ColorF, sortFlag: number) => {
    events.push({ k: "text", text: strMsg!, rect: [pos!.left, pos!.top, pos!.right, pos!.bottom], count: nCount, color: rgba(color), outline: bOutline, outlineColor: rgba(outlineColor), flag: sortFlag });
  }) as UKFont["DrawTextFont"];
  s.e.DrawRect = ((rc: Rect, color: number) => {
    events.push({ k: "rect", rect: [rc.left, rc.top, rc.right, rc.bottom], color });
    return 0;
  }) as typeof s.e.DrawRect;
  return events;
}

/** the caret and the selection of a box: the caret at `caret`, the selection from `start` */
function select(e: CKTDGUIEditBox, caret: number, start: number): void {
  e.m_nCaret = caret;
  e.m_nSelStart = start;
}

describe("CKTDGUIEditBox::OnFrameRender (32934400): the text", () => {
  test("a box that is not shown draws nothing, and does not touch its buffer", () => {
    const s = scene("AB#");
    const events = spy(s);
    s.e.m_bShow = false;
    s.e.m_bHasFocus = true;
    expect(s.e.onFrameRender()).toBe(0);
    expect(events).toEqual([]);
    expect(s.e.m_Buffer.m_pFontNode).toBe(null);
  });

  test("the buffer is given the box's font; the text is drawn in the text rectangle moved by the dialog's place and the offset (11, 20), centred vertically (format 4), count -1, in the text colour", () => {
    const s = scene("AB#");
    const events = spy(s);
    select(s.e, 3, 3);
    expect(s.e.onFrameRender()).toBe(0);
    expect(s.e.m_Buffer.m_pFontNode).toBe(s.uk);
    expect(events).toEqual([text("AB#", [15, 26, 115, 50], -1, TEXT_COLOR)]);
    expect(rgba(s.e.m_NowFontColor)).toEqual(TEXT_COLOR);
  });

  test("the text starts at the first visible character", () => {
    const s = scene("AB#");
    const events = spy(s);
    s.e.m_nFirstVisible = 1;
    select(s.e, 3, 3);
    s.e.onFrameRender();
    expect(events).toEqual([text("B#", [15, 26, 115, 50], -1, TEXT_COLOR)]);
  });

  test("the caret is placed first: past the right side of the text rectangle (a width of 24: 4 .. 28) the first visible character moves so that it fits, and the text starts there", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_rcText.right = 28;
    select(s.e, 5, 5);
    s.e.onFrameRender();
    // x of the caret 32 > 24: x of the new first = 32 + 4 - 28 = 8; XtoCP(8) = 1 (12 px: A is 9, AB 20), whose x (6) is short of 8: the first visible is 2
    expect(s.e.m_nFirstVisible).toBe(2);
    expect(events).toEqual([text("ABAB", [15, 26, 39, 50], -1, TEXT_COLOR)]);
  });

  test("a password box draws its hide character for each character of the text (and measures it so too)", () => {
    const s = scene("AB#");
    const events = spy(s);
    s.e.SetHideChar("#");
    s.e.m_nFirstVisible = 1;
    select(s.e, 3, 3);
    s.e.onFrameRender();
    expect(events).toEqual([text("##", [15, 26, 115, 50], -1, TEXT_COLOR)]);
  });

  test("the outline: a box with an outline colour draws its text with it (colour 1.0, 0.25, 0.5, 0.75 as the exe's four floats), the others without", () => {
    const s = scene("AB#");
    const events = spy(s);
    select(s.e, 3, 3);
    s.e.m_bOutlineCheck = true;
    s.e.m_OutlineColor.r = 1;
    s.e.m_OutlineColor.g = 0.25;
    s.e.m_OutlineColor.b = 0.5;
    s.e.m_OutlineColor.a = 0.75;
    s.e.onFrameRender();
    expect(events).toEqual([text("AB#", [15, 26, 115, 50], -1, TEXT_COLOR, 4, true, [1, 0.25, 0.5, 0.75])]);
  });

  test("the text colour is rebuilt from its packed bytes every frame: each channel is the byte times 1/255, rounded to a float", () => {
    const s = scene("AB#");
    spy(s);
    select(s.e, 3, 3);
    s.e.m_TextColor = 0xff101010;
    s.e.onFrameRender();
    expect(rgba(s.e.m_NowFontColor)).toEqual([0.062745101749897, 0.062745101749897, 0.062745101749897, 1]);
    s.e.m_TextColor = 0x01020304;
    s.e.onFrameRender();
    expect(rgba(s.e.m_NowFontColor)).toEqual([f32(2 * ONE), f32(3 * ONE), f32(4 * ONE), f32(1 * ONE)]);
    // bytes (alpha 3, red 6, green 7, blue 12) whose float product with the float 1/255 is not the float of the quotient (nor of the double 1/255): checked in Python
    s.e.m_TextColor = 0x0306070c;
    s.e.onFrameRender();
    expect(rgba(s.e.m_NowFontColor)).toEqual([0.02352941408753395, 0.027450982481241226, 0.0470588281750679, 0.011764707043766975]);
  });
});

const ONE = Math.fround(0.003921569);
const f32 = Math.fround;

describe("CKTDGUIEditBox::OnFrameRender (32934400): the selection", () => {
  test("a selection from 1 to 3 (x 6 .. 18) is a rectangle of the selection's colour (the text rectangle's left 4 minus the first visible x 0 added: 10 .. 22), drawn first; the text, then the selected part from its start in the selection's text colour, count 2, in the rectangle", () => {
    const s = scene("AB#");
    const events = spy(s);
    select(s.e, 1, 3);
    s.e.onFrameRender();
    expect(events).toEqual([
      fill([10, 6, 22, 30], SEL_BK),
      text("AB#", [15, 26, 115, 50], -1, TEXT_COLOR),
      text("B#", [21, 26, 33, 50], 2, SEL_COLOR),
    ]);
    expect(rgba(s.e.m_NowFontColor)).toEqual(SEL_COLOR);
  });

  test("the same selection the other way round (the caret at its end) is drawn the same", () => {
    const s = scene("AB#");
    const events = spy(s);
    select(s.e, 3, 1);
    s.e.onFrameRender();
    expect(events).toEqual([
      fill([10, 6, 22, 30], SEL_BK),
      text("AB#", [15, 26, 115, 50], -1, TEXT_COLOR),
      text("B#", [21, 26, 33, 50], 2, SEL_COLOR),
    ]);
  });

  test("scrolled (first visible 2, x 13): the selection 3 .. 5 (x 19 .. 32) is moved by 4 - 13 = -9 to 10 .. 23; the selected text starts at 3", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_rcText.right = 28;
    select(s.e, 5, 3);
    s.e.onFrameRender();
    expect(s.e.m_nFirstVisible).toBe(2);
    expect(events).toEqual([
      fill([10, 6, 23, 30], SEL_BK),
      text("ABAB", [15, 26, 39, 50], -1, TEXT_COLOR),
      text("BAB", [21, 26, 34, 50], 2, SEL_COLOR),
    ]);
  });

  test("a selection that starts before the first visible character is cut at it: the rectangle to the text rectangle's left (4 .. 23), the selected text from the first visible character (2) to the end of the selection (5)", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_rcText.right = 28;
    select(s.e, 5, 0);
    s.e.onFrameRender();
    expect(s.e.m_nFirstVisible).toBe(2);
    expect(events).toEqual([
      fill([4, 6, 23, 30], SEL_BK),
      text("ABAB", [15, 26, 39, 50], -1, TEXT_COLOR),
      text("ABAB", [15, 26, 34, 50], 3, SEL_COLOR),
    ]);
  });

  test("a selection that goes on past the right side of the text rectangle is cut there (4 .. 28)", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_rcText.right = 28;
    select(s.e, 1, 6);
    s.e.onFrameRender();
    // the caret (x 6) is inside: no scrolling; the selection is x 6 .. 40, moved by 4: 10 .. 44, cut to 10 .. 28
    expect(s.e.m_nFirstVisible).toBe(0);
    expect(events[0]).toEqual(fill([10, 6, 28, 30], SEL_BK));
  });

  test("a selection whose two ends have the same x is empty: the cut is the rectangle (0, 0, 0, 0), which is drawn all the same", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_Buffer.CPtoX = (() => 10) as typeof s.e.m_Buffer.CPtoX;
    select(s.e, 1, 3);
    s.e.onFrameRender();
    expect(events[0]).toEqual(fill([0, 0, 0, 0], SEL_BK));
  });

  test("a password box's selected text is made of hide characters too", () => {
    const s = scene("AB#");
    const events = spy(s);
    s.e.SetHideChar("#");
    select(s.e, 1, 3);
    s.e.onFrameRender();
    // # is 7: the x of 1 and 3 are 4 and 14 (7, 21 over 1.5): the rectangle 4 + 4 .. 14 + 4
    expect(events).toEqual([
      fill([8, 6, 18, 30], SEL_BK),
      text("###", [15, 26, 115, 50], -1, TEXT_COLOR),
      text("##", [19, 26, 29, 50], 2, SEL_COLOR),
    ]);
  });
});

describe("CKTDGUIEditBox::OnFrameRender (32934400): the blink and the caret", () => {
  /** the box with the clock a test sets, the blink 0.5 s and the last blink at 10 */
  function blinking() {
    const s = scene("AB#");
    const events = spy(s);
    let now = 10;
    const reads: number[] = [];
    s.w.devices.absoluteTime = () => {
      reads.push(now);
      return now;
    };
    s.e.m_dfBlink = 0.5;
    s.e.m_dfLastBlink = 10;
    s.e.m_bHasFocus = true;
    select(s.e, 3, 3);
    return { ...s, events, reads, at: (t: number) => { now = t; reads.length = 0; events.length = 0; } };
  }

  test("a focused box with its caret on draws the caret: two pixels wide around the caret's x (18: 17 .. 19, moved by 4), as high as the text rectangle (6 .. 30), in the caret colour", () => {
    const s = blinking();
    s.e.m_CaretColor = 0xff123456;
    s.e.onFrameRender();
    expect(s.events).toEqual([text("AB#", [15, 26, 115, 50], -1, TEXT_COLOR), fill([21, 6, 23, 30], 0xff123456)]);
  });

  test("the caret is moved by the text rectangle's left minus the x of the first visible character: 4 - 6 = -2: 15 .. 17 (in the overwrite mode the trailing edge is moved the same way: 18 + 4 - 6 = 16)", () => {
    const s = blinking();
    s.e.m_nFirstVisible = 1;
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([15, 6, 17, 30], 0xff000000));
    s.events.length = 0;
    s.e.m_bInsertMode = false;
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([15, 6, 16, 30], 0xff000000));
  });

  test("no caret without focus, with the caret off, or when the class hides carets", () => {
    const s = blinking();
    s.e.m_bHasFocus = false;
    s.e.onFrameRender();
    expect(s.events.map((ev) => ev.k)).toEqual(["text"]);
    s.events.length = 0;
    s.e.m_bHasFocus = true;
    s.e.m_bCaretOn = false;
    s.e.onFrameRender();
    expect(s.events.map((ev) => ev.k)).toEqual(["text"]);
    s.events.length = 0;
    s.e.m_bCaretOn = true;
    CKTDGUIEditBox.s_bHideCaret = true;
    try {
      s.e.onFrameRender();
      expect(s.events.map((ev) => ev.k)).toEqual(["text"]);
    } finally {
      CKTDGUIEditBox.s_bHideCaret = false;
    }
  });

  test("in the overwrite mode the caret reaches from its x minus one to the x of its trailing edge (CPtoX does not look at the trail: the same x): one pixel wide", () => {
    const s = blinking();
    s.e.m_bInsertMode = false;
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([21, 6, 22, 30], 0xff000000));
    // the trailing edge is asked of the buffer (with bTrail set), and its answer is the right side, moved like the left one
    s.events.length = 0;
    s.e.m_Buffer.CPtoX = ((cp: number, trail: boolean) => (cp === 0 ? 0 : trail ? 30 : 18)) as typeof s.e.m_Buffer.CPtoX;
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([21, 6, 34, 30], 0xff000000));
  });

  test("the caret toggles when the blink time has passed since the last blink (not before: 10.4 - 10 < 0.5; at 10.5 it has), and the time is taken again: the clock is read twice", () => {
    const s = blinking();
    s.at(10.4);
    s.e.onFrameRender();
    expect(s.e.m_bCaretOn).toBe(true);
    expect(s.e.m_dfLastBlink).toBe(10);
    expect(s.reads).toEqual([10.4]);
    expect(s.events.map((ev) => ev.k)).toEqual(["text", "rect"]);
    s.at(10.5);
    s.e.onFrameRender();
    // the caret went off in this frame already: it is not drawn
    expect(s.e.m_bCaretOn).toBe(false);
    expect(s.e.m_dfLastBlink).toBe(10.5);
    expect(s.reads).toEqual([10.5, 10.5]);
    expect(s.events.map((ev) => ev.k)).toEqual(["text"]);
    s.at(11.5);
    s.e.onFrameRender();
    // 11.5 - 10.5 = 1 >= 0.5: on again, and drawn
    expect(s.e.m_bCaretOn).toBe(true);
    expect(s.e.m_dfLastBlink).toBe(11.5);
    expect(s.events.map((ev) => ev.k)).toEqual(["text", "rect"]);
  });

  test("the time stored is the second reading of the clock", () => {
    const s = blinking();
    const readings = [10.75, 12.25];
    s.w.devices.absoluteTime = () => readings.shift()!;
    s.e.onFrameRender();
    expect(s.e.m_dfLastBlink).toBe(12.25);
    expect(readings).toEqual([]);
  });

  test("the buffer is asked in this order: PlaceCaret (the first visible character, the caret, the caret's trailing edge), then the frame (the first visible character, the caret, the selection's start only with a selection), then the overwrite mode's trailing edge", () => {
    const s = blinking();
    s.e.m_bInsertMode = false;
    const b = s.e.m_Buffer;
    const asked: [number, boolean][] = [];
    const real = b.CPtoX.bind(b);
    b.CPtoX = ((cp: number, trail: boolean) => {
      asked.push([cp, trail]);
      return real(cp, trail);
    }) as typeof b.CPtoX;
    select(s.e, 1, 3);
    s.e.onFrameRender();
    expect(asked).toEqual([[0, false], [1, false], [1, true], [0, false], [1, false], [3, false], [1, true]]);
    asked.length = 0;
    select(s.e, 1, 1);
    s.e.onFrameRender();
    expect(asked).toEqual([[0, false], [1, false], [1, true], [0, false], [1, false], [1, true]]);
    // the insert mode asks no more
    asked.length = 0;
    s.e.m_bInsertMode = true;
    s.e.onFrameRender();
    expect(asked).toEqual([[0, false], [1, false], [1, true], [0, false], [1, false]]);
  });

  test("the blink and the caret are done after the text (the order of the calls: text, selected text, caret)", () => {
    const s = blinking();
    select(s.e, 1, 3);
    s.e.onFrameRender();
    expect(s.events.map((ev) => ev.k)).toEqual(["rect", "text", "text", "rect"]);
  });
});

describe("CKTDGUIEditBox::OnFrameRender (32934400): the background", () => {
  test("a box with a background (m_bBGCheck) draws the quad of its current point first: the dialog's place, the point's corner and the offset times the scale, cut", () => {
    const s = scene("AB#");
    s.e.m_bBGCheck = true;
    s.e.m_NowPoint.assign(quad(s.w, 10, 20, "BG.TGA"));
    select(s.e, 1, 3);
    s.e.m_bHasFocus = true;
    const from = s.dev.log.length;
    s.e.onFrameRender();
    // (10.25 + 10 + 0.75) * 1.5 = 31.5 -> 31 and (20.5 + 20 + 0.25) * 2 = 81.5 -> 81; the right side (10 + 64 + 11) * 1.5 = 127.5 -> 127, the bottom (20 + 32 + 20.75) * 2 = 145.5 -> 145
    const quads = drawnQuads(s.dev, from);
    expect(quads[0]).toEqual({ texture: "BG.TGA", rect: [31, 81, 127, 145] });
    // then the selection's rectangle: (10, 6, 22, 30) -> x 30 .. 48, y 53 .. 101 (the layout 10 * 1.5 + 15.375, 22 * 1.5 + 15.375; 6 * 2 + 41, 30 * 2 + 41)
    expect(quads[1]!.rect).toEqual([30, 53, 48, 101]);
  });

  test("a box without one draws no quad but the selection and the caret", () => {
    const s = scene("AB#");
    select(s.e, 1, 3);
    const from = s.dev.log.length;
    s.e.onFrameRender();
    expect(drawnQuads(s.dev, from).map((q) => q.rect)).toEqual([[30, 53, 48, 101]]);
  });
});

describe("CKTDGUIEditBox::DrawRect (329335A0)", () => {
  test("an untextured quad: each side is (int)(float)(side * scale + scale * the dialog's place), the vertices half a pixel up and left, z 0.5, rhw 1, UV 0, in the colour", () => {
    const s = scene("");
    const from = s.dev.log.length;
    expect(s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c)).toBe(0);
    const calls = drawnCalls(s.dev, from);
    expect(calls.length).toBe(1);
    expect([calls[0]!.type, calls[0]!.prims]).toEqual([5, 2]);
    // 10 * 1.5 + 15.375 = 30.375 -> 30, 22 * 1.5 + 15.375 = 48.375 -> 48; 6 * 2 + 41 = 53, 30 * 2 + 41 = 101
    const c = 0xff28325c;
    expect(calls[0]!.vertices).toEqual([
      [29.5, 52.5, 0.5, 1, c, 0, 0],
      [47.5, 52.5, 0.5, 1, c, 0, 0],
      [29.5, 100.5, 0.5, 1, c, 0, 0],
      [47.5, 100.5, 0.5, 1, c, 0, 0],
    ]);
  });

  test("sides are cut towards 0, not rounded or floored, also below 0: -20 * 1.5 + 15.375 = -14.625 -> -14, 5 * 1.5 + 15.375 = 22.875 -> 22 (a scale of 1.5 in y: -9 * 1.5 + 30.75 = 17.25, 3 * 1.5 + 30.75 = 35.25)", () => {
    const s = scene("", { width: 1536, height: 1152 });
    const from = s.dev.log.length;
    s.e.DrawRect({ left: -20, top: -9, right: 5, bottom: 3 }, 0xff112233);
    const v = drawnCalls(s.dev, from)[0]!.vertices;
    expect([v[0]![0], v[0]![1], v[3]![0], v[3]![1]]).toEqual([-14.5, 16.5, 21.5, 34.5]);
    // a rectangle of y 2 .. 4 at the scale 1.5: 2 * 1.5 + 30.75 = 33.75 -> 33 (not 34), 4 * 1.5 + 30.75 = 36.75 -> 36 (not 37); x 1 .. 3: 1 * 1.5 + 15.375 = 16.875 -> 16, 3 * 1.5 + 15.375 = 19.875 -> 19
    const from2 = s.dev.log.length;
    s.e.DrawRect({ left: 1, top: 2, right: 3, bottom: 4 }, 0xff112233);
    const w = drawnCalls(s.dev, from2)[0]!.vertices;
    expect([w[0]![0], w[0]![1], w[3]![0], w[3]![1]]).toEqual([15.5, 32.5, 18.5, 35.5]);
    // below 0 on all four sides (not floored, not rounded): x -20 and -12: -14.625 -> -14, -2.625 -> -2 (not -15, -3); y -30 and -25: -45 + 30.75 = -14.25 -> -14 (not -15), -37.5 + 30.75 = -6.75 -> -6 (not -7)
    const from3 = s.dev.log.length;
    s.e.DrawRect({ left: -20, top: -30, right: -12, bottom: -25 }, 0xff112233);
    const n = drawnCalls(s.dev, from3)[0]!.vertices;
    expect([n[0]![0], n[0]![1], n[3]![0], n[3]![1]]).toEqual([-14.5, -14.5, -2.5, -6.5]);
  });

  test("the stage's colour and alpha operations are SELECTARG2 (3) for the draw, then MODULATE (4) through the mirror, then the old values come back: from the baseline (colour MODULATE, alpha SELECTARG1) 3, 3, draw, 4, 4, and the alpha operation back to 2 (the colour operation is 4 again already)", () => {
    const s = scene("");
    const from = s.dev.log.length;
    s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c);
    expect(s.dev.log.slice(from).filter((l) => l.startsWith("tss") || l.startsWith("draw"))).toEqual(["tss 0 1 3", "tss 0 4 3", "draw 5 0 2", "tss 0 1 4", "tss 0 4 4", "tss 0 4 2"]);
    expect(s.w.render!.states.stackPointer).toBe(0);
  });

  test("... from a SELECTARG2 baseline the operations are set to MODULATE and come back last (the alpha operation first): draw, 4, 4, 3 (alpha), 3 (colour)", () => {
    const s = scene("");
    s.w.render!.states.setTextureStageState(0, 1, 3);
    s.w.render!.states.setTextureStageState(0, 4, 3);
    const top = s.w.render!.states.stackPointer;
    const from = s.dev.log.length;
    s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c);
    expect(s.dev.log.slice(from).filter((l) => l.startsWith("tss") || l.startsWith("draw"))).toEqual(["draw 5 0 2", "tss 0 1 4", "tss 0 4 4", "tss 0 4 3", "tss 0 1 3"]);
    expect(s.w.render!.states.stackPointer).toBe(top);
    s.w.render!.states.popTo(0);
  });

  test("every step of a side is a float: 277 and the place 99.66664123535156 (x1.5 = 149.49996948242188 as a float) make 564.99996948 + .. = 565, 206 and 219.99998474121094 make 638.99996948 = 639 (half a float's spacing below, ties to even), 16777218 * 1.5 is 25165828 as a float (25165844 in all), 16777219 is 16777220 as a float (25165846)", () => {
    // each case: the four sides all L (degenerate), the dialog at (P, P) in a scene of the scale (1.5, 1.5); the numbers are float32 arithmetic worked out in Python (an exact sum, or an exact product, is cut to another int)
    const s = scene("", { width: 1536, height: 1152 });
    const cases: [number, number, number][] = [
      [277, 99.66664123535156, 565],
      [206, 219.99998474121094, 639],
      [16777218, 10.25, 25165844],
      [16777219, 10.25, 25165846],
    ];
    for (const [side, place, moved] of cases) {
      s.dialog.m_Pos.set(place, place);
      const from = s.dev.log.length;
      s.e.DrawRect({ left: side, top: side, right: side, bottom: side }, 0xff112233);
      const v = drawnCalls(s.dev, from)[0]!.vertices;
      const want = Math.fround(moved - 0.5);
      expect([v[0]![0], v[0]![1], v[3]![0], v[3]![1]]).toEqual([want, want, want, want]);
    }
  });

  test("the whole of the device's calls: the operations, the vertex declaration kept around the draw (GetVertexDeclaration before, SetVertexDeclaration after), the FVF of the quad, the draw, then the operations back", () => {
    const s = scene("");
    const from = s.dev.log.length;
    s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c);
    // FVF 324 = XYZRHW (4) + DIFFUSE (0x40) + TEX1 (0x100); the stream's source line (its buffer id) is not looked at
    expect(s.dev.log.slice(from).filter((l) => !l.startsWith("src"))).toEqual(["tss 0 1 3", "tss 0 4 3", "getdecl", "fvf 324", "draw 5 0 2", "setdecl", "tss 0 1 4", "tss 0 4 4", "tss 0 4 2"]);
  });

  test("without a device nothing is drawn: the failure is reported as the error 0x82 \"device null\" (once), the call answers 0 all the same", () => {
    const s = fontWorld({}, { device: false });
    const dialog = new CKTDGUIDialog(s.w);
    const e = new CKTDGUIEditBox(s.w);
    place(dialog, e);
    const before = s.w.devices.massFiles.log.entries.length;
    expect(e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c)).toBe(0);
    expect(s.w.devices.massFiles.log.entries.slice(before)).toEqual([{ id: 0x82, text: "device null" }]);
  });

  test("a box in no dialog is the exe's null object: an Error here", () => {
    const s = scene("");
    s.e.m_pDialog = null;
    expect(() => s.e.DrawRect({ left: 0, top: 0, right: 1, bottom: 1 }, 0)).toThrow(/no dialog/);
  });
});

describe("CKTDGUIEditBox::DrawTextW (329339F0)", () => {
  test("the font draws the text in the rectangle moved by (int)(float)(dialog + offset): (11, 20) here (10.25 + 0.75 = 11, 20.5 + 0.25 = 20.75 cut); the caller's rectangle is not changed", () => {
    const s = scene("");
    const events = spy(s);
    const rc = { left: 4, top: 6, right: 104, bottom: 30 };
    expect(s.e.DrawTextW("Hi", rc, 7, 3)).toBe(0);
    expect(events).toEqual([text("Hi", [15, 26, 115, 50], 7, [0, 0, 0, 1], 3)]);
    expect(rc).toEqual({ left: 4, top: 6, right: 104, bottom: 30 });
  });

  test("the offset is cut towards 0, below 0 too (-10.25 + -0.5 = -10.75 is -10), and the sum is a float first (16777215 + 2.5 is 16777218, not 16777217)", () => {
    const s = scene("");
    const events = spy(s);
    s.dialog.m_Pos.set(-10.25, 16777215);
    s.e.m_OffsetPos.set(-0.5, 2.5);
    s.e.DrawTextW("Hi", { left: 0, top: 0, right: 1, bottom: 2 }, -1, 0);
    expect(events[0]).toMatchObject({ rect: [-10, 16777218, -9, 16777220] });
    // y below 0 is cut towards 0 as well: -20.5 + -0.25 = -20.75 is -20 (not -21)
    s.dialog.m_Pos.set(-10.25, -20.5);
    s.e.m_OffsetPos.set(-0.5, -0.25);
    s.e.DrawTextW("Hi", { left: 0, top: 0, right: 1, bottom: 2 }, -1, 0);
    expect(events[1]).toMatchObject({ rect: [-10, -20, -9, -18] });
  });

  test("the sum of x is a float too: 0.99999994 + 4e-8 = 0.99999998 is 1 as a float (cut to 0 as an exact sum)", () => {
    const s = scene("");
    const events = spy(s);
    s.dialog.m_Pos.set(0.99999994, 0.99999994);
    s.e.m_OffsetPos.set(4e-8, 4e-8);
    s.e.DrawTextW("Hi", { left: 0, top: 0, right: 1, bottom: 2 }, -1, 0);
    expect(events[0]).toMatchObject({ rect: [1, 1, 2, 3] });
  });

  test("the font colour and the outline colour go with the call; the outline flag is the box's m_bOutlineCheck", () => {
    const s = scene("");
    const events = spy(s);
    s.e.m_NowFontColor.set(0.5, 0.25, 0.125, 0.75);
    s.e.m_OutlineColor.set(0.1, 0.2, 0.3, 0.4);
    s.e.DrawTextW("Hi", { left: 0, top: 0, right: 1, bottom: 2 }, -1, 0);
    expect(events[0]).toMatchObject({ color: [0.5, 0.25, 0.125, 0.75], outline: false, outlineColor: [0.10000000149011612, 0.20000000298023224, 0.30000001192092896, 0.4000000059604645] });
    s.e.m_bOutlineCheck = true;
    s.e.DrawTextW("Hi", { left: 0, top: 0, right: 1, bottom: 2 }, -1, 0);
    expect(events[1]).toMatchObject({ outline: true });
  });

  test("a box without a font calls DrawTextFont through a null pointer: nothing for an empty text or a count of 0, a crash (an Error) for anything else; a box in no dialog is an Error", () => {
    const s = scene("");
    s.e.m_pFont = null;
    expect(s.e.DrawTextW("", { left: 0, top: 0, right: 1, bottom: 2 }, -1, 0)).toBe(0);
    expect(s.e.DrawTextW("Hi", { left: 0, top: 0, right: 1, bottom: 2 }, 0, 0)).toBe(0);
    expect(() => s.e.DrawTextW("Hi", { left: 0, top: 0, right: 1, bottom: 2 }, -1, 0)).toThrow(/no font/);
    s.e.m_pDialog = null;
    expect(() => s.e.DrawTextW("Hi", { left: 0, top: 0, right: 1, bottom: 2 }, -1, 0)).toThrow(/no dialog/);
  });
});

describe("CKTDGUIEditBox::PlaceCaret (32934A00)", () => {
  // "ABABAB": the x of the characters 0 .. 6 are 0, 6, 13, 19, 26, 32, 40; the text rectangle 4 .. 28 is 24 wide
  const boxed = () => {
    const s = scene("ABABAB");
    s.e.m_rcText.right = 28;
    return s;
  };

  test("the caret is stored; inside the text rectangle the first visible character stays", () => {
    const s = boxed();
    s.e.m_Buffer.m_pFontNode = s.uk;
    s.e.PlaceCaret(3);
    expect([s.e.m_nCaret, s.e.m_nFirstVisible]).toEqual([3, 0]);
    // x 19 + the trailing x 19 is not past 0 + 24; 24 itself is not past it either (the end of "ABABA" is 32, the x of a character at 24 does not exist: use a stub below)
  });

  test("past the right side: the first visible character is the first one whose x is not short of (the caret's trailing x + left - right): caret 5 (x 32): 8 -> XtoCP 1 (x 6 < 8) -> 2; caret 6 (the end, x 40): 16 -> XtoCP 2 (x 13 < 16) -> 3", () => {
    const s = boxed();
    s.e.m_Buffer.m_pFontNode = s.uk;
    s.e.PlaceCaret(5);
    expect(s.e.m_nFirstVisible).toBe(2);
    s.e.m_nFirstVisible = 0;
    s.e.PlaceCaret(6);
    expect([s.e.m_nCaret, s.e.m_nFirstVisible]).toEqual([6, 3]);
  });

  test("left of the first visible character the first visible character is the caret", () => {
    const s = boxed();
    s.e.m_Buffer.m_pFontNode = s.uk;
    s.e.m_nFirstVisible = 4;
    s.e.PlaceCaret(1);
    expect([s.e.m_nCaret, s.e.m_nFirstVisible]).toEqual([1, 1]);
    // at the first visible character itself it stays
    s.e.m_nFirstVisible = 4;
    s.e.PlaceCaret(4);
    expect(s.e.m_nFirstVisible).toBe(4);
  });

  test("with a font that gives 8 pixels a character the trailing x decides at the end of the text (the caret at the end has no trail asked for) and an x that is hit exactly stays: first = XtoCP, not one more", () => {
    const s = boxed();
    const b = s.e.m_Buffer;
    b.m_pFontNode = s.uk;
    const asked: [number, boolean][] = [];
    b.CPtoX = ((cp: number, trail: boolean) => { asked.push([cp, trail]); return cp * 8 + (trail ? 3 : 0); }) as typeof b.CPtoX;
    b.XtoCP = ((x: number) => ({ cp: Math.floor(x / 8), trail: 0 })) as typeof b.XtoCP;
    // caret 4: x 32, trail 35 > 24: x of the new first = 35 + 4 - 28 = 11; XtoCP 1, its x 8 < 11: 2
    s.e.PlaceCaret(4);
    expect(s.e.m_nFirstVisible).toBe(2);
    expect(asked).toEqual([[0, false], [4, false], [4, true], [1, false]]);
    // caret 5, no trail: x 40 > 24: 40 + 4 - 28 = 16: XtoCP 2, its x 16 is not < 16: 2 (hit exactly)
    asked.length = 0;
    s.e.m_nFirstVisible = 0;
    b.CPtoX = ((cp: number, trail: boolean) => { asked.push([cp, trail]); return cp * 8; }) as typeof b.CPtoX;
    s.e.PlaceCaret(5);
    expect(s.e.m_nFirstVisible).toBe(2);
    // the end of the text (6): the trail is not asked
    asked.length = 0;
    s.e.m_nFirstVisible = 0;
    s.e.PlaceCaret(6);
    expect(asked.some(([, t]) => t)).toBe(false);
    expect(s.e.m_nFirstVisible).toBe(3);
  });

  test("a caret whose x is the first visible character's x is not left of it: nothing moves the first visible character (all x are equal here, XtoCP is never asked)", () => {
    const s = boxed();
    const b = s.e.m_Buffer;
    b.m_pFontNode = s.uk;
    b.CPtoX = (() => 0) as typeof b.CPtoX;
    b.XtoCP = (() => {
      throw new Error("XtoCP is not asked");
    }) as typeof b.XtoCP;
    s.e.m_nFirstVisible = 4;
    s.e.PlaceCaret(1);
    expect([s.e.m_nCaret, s.e.m_nFirstVisible]).toEqual([1, 4]);
  });

  test("the trailing edge scrolls only past the right side counted from the first visible character's x: first 2 (x 16), the edge at 40 = 16 + 24 stays, 41 scrolls (XtoCP of 41 + 4 - 28 = 17 is 2, whose x 16 is short: 3)", () => {
    const s = boxed();
    const b = s.e.m_Buffer;
    b.m_pFontNode = s.uk;
    const asked: number[] = [];
    let trail = 0;
    b.CPtoX = ((cp: number, tr: boolean) => cp * 8 + (tr ? trail : 0)) as typeof b.CPtoX;
    b.XtoCP = ((x: number) => {
      asked.push(x);
      return { cp: Math.floor(x / 8), trail: 0 };
    }) as typeof b.XtoCP;
    s.e.m_nFirstVisible = 2;
    s.e.PlaceCaret(5);
    expect([s.e.m_nFirstVisible, asked]).toEqual([2, []]);
    trail = 1;
    s.e.PlaceCaret(5);
    expect([s.e.m_nFirstVisible, asked]).toEqual([3, [17]]);
  });

  test("the trailing edge, not the caret's x, decides whether to scroll: caret 3 (x 24) with the edge at 27 > 24 scrolls: XtoCP of 27 + 4 - 28 = 3 is 0, whose x 0 is short: 1", () => {
    const s = boxed();
    const b = s.e.m_Buffer;
    b.m_pFontNode = s.uk;
    b.CPtoX = ((cp: number, tr: boolean) => cp * 8 + (tr ? 3 : 0)) as typeof b.CPtoX;
    b.XtoCP = ((x: number) => ({ cp: Math.floor(x / 8), trail: 0 })) as typeof b.XtoCP;
    s.e.PlaceCaret(3);
    expect(s.e.m_nFirstVisible).toBe(1);
  });

  test("a box without a font: every x is 0, so the first visible character stays", () => {
    const s = boxed();
    s.e.m_nFirstVisible = 2;
    s.e.PlaceCaret(5);
    expect([s.e.m_nCaret, s.e.m_nFirstVisible]).toEqual([5, 2]);
  });
});
