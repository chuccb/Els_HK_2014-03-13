import { describe, expect, test } from "bun:test";
import { CKTDGUIDialog, CKTDGUIIMEEditBox } from "../src/index.ts";
import type { ColorF, UKFont } from "../src/font.ts";
import type { Rect } from "../src/rect.ts";
import { fontWorld } from "./fontworld.ts";
import { drawnCalls, drawnQuads, quad } from "./rig.ts";
import { place } from "./stringspy.ts";

/**
 * What `CKTDGUIIMEEditBox` draws: `OnFrameRender` 32939580, `DrawTextW` 32936930, `CalcTextRect` 32936140, `DrawRect` 329364E0,
 * `RenderComposition` 3293A2F0 and `RenderCandidateReadingWindow` 32939C50.  Every expected number is worked out by hand from the decompile
 * and the disassembly (the decompile hides the constants of `LOBYTE(x) = 4`: the formats of the loops are really 0x404 and 0x400) and the
 * float and integer arithmetic checked in Python.
 *
 * The scene is that of `editboxdraw.test.ts`: the dialog is at (10.25, 20.5) and the box has the offset (0.75, 0.25) (stringspy.ts), so the text
 * is moved by (int)(float)(10.25 + 0.75) = 11 and (int)(float)(20.5 + 0.25) = 20 (20.75 cut); a back buffer of 1536 x 1536, so the layout
 * (1024 x 768) is scaled by (1.5, 2); a UK font on the box font of fontworld.ts at 16 px (the width of A is 9, B 11, # 7; a line is 17 high)
 * whose `DrawTextFont` writes its calls down.  The text rectangle of the box is (4, 6, 104, 30).  The x of a character is the width of the
 * text before it over 1.5 cut: "ABABAB" has the x 0, 6, 13, 19, 26, 32, 40 (the widths 0, 9, 20, 29, 40, 49, 60); the y of a line is
 * 17 / 2 = 8.5 times the line breaks before it, cut: 8 for one.  `CPtoX` does not look at the trail, so the x of a character and of its
 * trailing edge are the same.
 *
 * The colours: the text colour 0x80C0A040 is (192, 160, 64, 128) bytes, each times 1/255 as a float; the selected text 0xFF305090; the
 * composition string 0xFFC8C8FF; the candidates 0xFFC8C8C8 and the reading 0xBCFFFFFF are the constructor's.
 */

const TEXT_COLOR = [0.7529412508010864, 0.6274510025978088, 0.250980406999588, 0.501960813999176];
const SEL_COLOR = [0.1882353127002716, 0.3137255012989044, 0.5647059082984924, 1];
const COMP_COLOR = [0.7843137979507446, 0.7843137979507446, 1, 1];
const GREY_COLOR = [0.7843137979507446, 0.7843137979507446, 0.7843137979507446, 1];
const READING_COLOR = [1, 1, 1, 0.7372549176216125];
const WHITE = [1, 1, 1, 1];
const YELLOW = [1, 1, 0, 1];
const RED = [1, 0, 0, 1];
const SEL_BK = 0xff28325c;
const COMP_WIN = 0xc6000000;
const COMP_CARET = 0xffffffff;
const TARGET_BK = 0xff969696;
const CAND_WIN = 0x80000000;
const CAND_SEL_BK = 0x809e9e9e;
const READING_SEL_BK = 0x80505050;

/**
 * The colours the composition and window tests give the box (`recolor`): every one is its own, and the bytes of the ones the font gets are
 * among those for which byte * 0.003921569 as a float is not byte / 255, so a wrong constant or a swapped field shows.  `F` is what the font
 * gets (the channels r, g, b, a), worked out in Python.
 */
const PACKED = {
  comp: 0x3c1a1e31, compWin: 0xa04d5e6f, compCaret: 0xb07f8091, target: 0x6e0c3a1b, targetBk: 0xd4e5f607,
  nonTarget: 0x71620d3d, nonTargetBk: 0xf6071829,
  reading: 0x77180e63, readingWin: 0x81111111, readingSel: 0x6a190f35, readingSelBk: 0x82222222,
  cand: 0x6b1c0733, candWin: 0x83333333, candSel: 0x6c1d0636, candSelBk: 0x84444444,
};
const F = {
  comp: [0.10196079313755035, 0.11764706671237946, 0.19215688109397888, 0.2352941334247589],
  target: [0.0470588281750679, 0.22745099663734436, 0.10588236153125763, 0.43137258291244507],
  nonTarget: [0.38431376218795776, 0.05098039656877518, 0.2392157018184662, 0.4431372880935669],
  reading: [0.0941176563501358, 0.05490196496248245, 0.38823533058166504, 0.46666669845581055],
  readingSel: [0.09803922474384308, 0.05882353335618973, 0.20784315466880798, 0.41568630933761597],
  cand: [0.1098039299249649, 0.027450982481241226, 0.20000001788139343, 0.41960787773132324],
  candSel: [0.11372549831867218, 0.02352941408753395, 0.21176472306251526, 0.4235294461250305],
};

function recolor(e: CKTDGUIIMEEditBox): void {
  e.m_CompColor = PACKED.comp;
  e.m_CompWinColor = PACKED.compWin;
  e.m_CompCaretColor = PACKED.compCaret;
  e.m_CompTargetColor = PACKED.target;
  e.m_CompTargetBkColor = PACKED.targetBk;
  e.m_CompTargetNonColor = PACKED.nonTarget;
  e.m_CompTargetNonBkColor = PACKED.nonTargetBk;
  e.m_ReadingColor = PACKED.reading;
  e.m_ReadingWinColor = PACKED.readingWin;
  e.m_ReadingSelColor = PACKED.readingSel;
  e.m_ReadingSelBkColor = PACKED.readingSelBk;
  e.m_CandidateColor = PACKED.cand;
  e.m_CandidateWinColor = PACKED.candWin;
  e.m_CandidateSelColor = PACKED.candSel;
  e.m_CandidateSelBkColor = PACKED.candSelBk;
}

type Ev =
  | { k: "text"; text: string; rect: number[]; count: number; color: number[]; outline: boolean; outlineColor: number[]; flag: number }
  | { k: "rect"; rect: number[]; color: number };

const text = (t: string, rect: number[], count: number, color: number[], flag = 4, outline = false, outlineColor = WHITE): Ev => ({ k: "text", text: t, rect, count, color, outline, outlineColor, flag });
const fill = (rect: number[], color: number): Ev => ({ k: "rect", rect, color });
const rgba = (c: ColorF): number[] => [c.r, c.g, c.b, c.a];

function scene(content: string, backBuffer?: { width: number; height: number }, device = true) {
  const fw = fontWorld({}, { ...(backBuffer ? { backBuffer } : {}), device });
  const ft = fw.font(16, 0, 1, true);
  expect(ft.Load()).toBe(true);
  const uk = fw.w.fonts.addUKFont(1, ft);
  const dialog = new CKTDGUIDialog(fw.w);
  const e = new CKTDGUIIMEEditBox(fw.w);
  place(dialog, e);
  e.m_pFont = uk;
  Object.assign(e.m_rcText, { left: 4, top: 6, right: 104, bottom: 30 });
  expect(e.m_Buffer.SetText(content)).toBe(true);
  e.m_TextColor = 0x80c0a040;
  e.m_SelTextColor = 0xff305090;
  return { ...fw, dev: fw.dev!, ft, uk, dialog, e };
}

type Scene = ReturnType<typeof scene>;

/** the calls of the font and of `DrawRect` written down (in order); nothing is drawn */
function spy(s: Scene): Ev[] {
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

/** the calls of the font's `CalcTextRect` written down (the text, the count and the format), the font still measuring */
function measures(s: Scene): [string, number, number][] {
  const calls: [string, number, number][] = [];
  const real = s.uk.CalcTextRect.bind(s.uk);
  s.uk.CalcTextRect = ((strMsg: string | null, pos: Rect | null, nCount: number, format: number) => {
    calls.push([strMsg!, nCount, format]);
    real(strMsg, pos, nCount, format);
  }) as UKFont["CalcTextRect"];
  return calls;
}

/** the two windows of the IME written down instead of drawn */
function windows(s: Scene): string[] {
  const calls: string[] = [];
  s.e.RenderComposition = ((device: unknown, elapsed: number) => {
    calls.push(`composition ${device} ${elapsed}`);
  }) as typeof s.e.RenderComposition;
  s.e.RenderCandidateReadingWindow = ((device: unknown, elapsed: number, reading: boolean) => {
    calls.push(`${reading ? "reading" : "candidates"} ${device} ${elapsed}`);
  }) as typeof s.e.RenderCandidateReadingWindow;
  return calls;
}

/** the caret and the selection of a box: the caret at `caret`, the selection from `start` */
function select(e: CKTDGUIIMEEditBox, caret: number, start: number): void {
  e.m_nCaret = caret;
  e.m_nSelStart = start;
}

describe("CKTDGUIIMEEditBox::OnFrameRender (32939580): the text", () => {
  test("a hidden box draws nothing and answers 0 (not even the font reaches the buffer)", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    const calls = windows(s);
    s.e.m_bShow = false;
    s.e.m_bHasFocus = true;
    expect(s.e.onFrameRender()).toBe(0);
    expect(events).toEqual([]);
    expect(calls).toEqual([]);
    expect(s.e.m_Buffer.m_pFontNode).toBe(null);
  });

  test("the text from the first visible character on, in the text rectangle moved by (11, 20), format 4, the text colour; the font goes to the buffer", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_nFirstVisible = 2;
    select(s.e, 3, 3);
    expect(s.e.onFrameRender()).toBe(0);
    expect(s.e.m_Buffer.m_pFontNode).toBe(s.uk);
    // the caret (x 19) is inside the rectangle: the first visible character stays
    expect(s.e.m_nFirstVisible).toBe(2);
    expect(events).toEqual([text("ABAB", [15, 26, 115, 50], -1, TEXT_COLOR)]);
    expect(rgba(s.e.m_NowFontColor)).toEqual(TEXT_COLOR);
  });

  test("the rectangle is moved back by the box's offset cut to whole pixels (2.5 -> 2, -3.5 -> -3: 2 .. 102 and 9 .. 33), then by the dialog's place plus the offset (10.25 + 2.5 = 12.75 -> 12, 20.5 - 3.5 = 17: 14 .. 114, 26 .. 50)", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_OffsetPos.set(2.5, -3.5);
    s.e.onFrameRender();
    expect(events).toEqual([text("ABABAB", [14, 26, 114, 50], -1, TEXT_COLOR)]);
  });

  test("the format is 4 (centred vertically) for a box of its own and 0 for a box of a group (m_GroupID 0 or more): (m_GroupID >> 31) & 4", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    const flags: number[] = [];
    for (const group of [-1, 0, 5, -7, 2147483647, -2147483648]) {
      s.e.m_GroupID = group;
      events.length = 0;
      s.e.onFrameRender();
      flags.push((events[0] as Ev & { k: "text" }).flag);
    }
    expect(flags).toEqual([4, 0, 0, 4, 0, 4]);
  });

  test("a default alignment (m_DefTextAlign) replaces the format while the whole text fits in the text rectangle (its end at x 40 <= 100): 0x21 here, the 4 otherwise", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_DefTextAlign = 0x21;
    s.e.onFrameRender();
    expect((events[0] as Ev & { k: "text" }).flag).toBe(0x21);
    events.length = 0;
    s.e.m_rcText.right = 43; // the text rectangle is 39 wide: 40 does not fit
    s.e.onFrameRender();
    expect((events[0] as Ev & { k: "text" }).flag).toBe(4);
  });

  test("the first visible character moves with the caret before the frame is drawn (PlaceCaret): a caret left of it brings it back", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_nFirstVisible = 4;
    select(s.e, 1, 1);
    s.e.onFrameRender();
    expect(s.e.m_nFirstVisible).toBe(1);
    expect(events).toEqual([text("BABAB", [15, 26, 115, 50], -1, TEXT_COLOR)]);
  });

  test("the font of the box goes to the buffer, to the composition string and to the line of candidates, whether the box has the focus or not", () => {
    const s = scene("ABABAB");
    spy(s);
    windows(s);
    s.e.onFrameRender();
    expect(s.w.ime.s_CompString.m_pFontNode).toBe(s.uk);
    expect(s.w.ime.s_CandList.HoriCand.m_pFontNode).toBe(s.uk);
    s.e.m_pFont = null;
    s.e.m_Buffer.SetText("");
    s.e.onFrameRender();
    expect(s.e.m_Buffer.m_pFontNode).toBe(null);
    expect(s.w.ime.s_CompString.m_pFontNode).toBe(null);
    expect(s.w.ime.s_CandList.HoriCand.m_pFontNode).toBe(null);
  });
});

describe("CKTDGUIIMEEditBox::OnFrameRender (32939580): the selection", () => {
  test("a selection from 1 to 3 (x 6 .. 18) is a rectangle of the selection's colour (the text rectangle's left 4 minus the first visible x 0 added: 10 .. 22), drawn first; the text, then the selected part from its start in the selection's text colour, count 2, in the rectangle moved by (0, 0)", () => {
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

  test("the selected part is moved by the alignment offset minus the box's offset, each cut to whole pixels: (5 - 2.5 = 2.5 -> 2, -2 - -3.5 = 1.5 -> 1); the rectangle of the selection itself is not", () => {
    const s = scene("ABABAB");
    const events = spy(s);
    s.e.m_ptTextAlignOffset.x = 5;
    s.e.m_ptTextAlignOffset.y = -2;
    s.e.m_OffsetPos.set(2.5, -3.5);
    select(s.e, 1, 4);
    s.e.onFrameRender();
    // the selection x 6 .. 26 moved by 4: 10 .. 30; the text (14, 26, 114, 50) as before; the selected rectangle (10 + 2, 6 + 1, 30 + 2, 30 + 1) = (12, 7, 32, 31), then the dialog's (12, 17): (24, 24, 44, 48)
    expect(events).toEqual([
      fill([10, 6, 30, 30], SEL_BK),
      text("ABABAB", [14, 26, 114, 50], -1, TEXT_COLOR),
      text("BABAB", [24, 24, 44, 48], 3, SEL_COLOR),
    ]);
  });

  test("the move of the selected part is cut towards 0 (not floored) for a negative sum: (-3 - 0.5 = -3.5 -> -3, not -4) in x, (0 - 0.75 = -0.75 -> 0, not -1) in y", () => {
    const s = scene("AB#");
    const events = spy(s);
    s.e.m_ptTextAlignOffset.x = -3;
    s.e.m_ptTextAlignOffset.y = 0;
    s.e.m_OffsetPos.set(0.5, 0.75);
    select(s.e, 1, 3);
    s.e.onFrameRender();
    // the selection (10, 6, 22, 30) moved by (-3, 0) is (7, 6, 19, 30); the text is moved by (int)(10.25 + 0.5) = 10 and (int)(20.5 + 0.75) = 21
    expect((events[2] as Ev & { k: "text" }).rect).toEqual([17, 27, 29, 51]);
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

  test("a box of a group has a selection one line high at the line of the caret (y 8 for the second line): from the text top 6 + 8 = 14 to 8 + 6 + 17 = 31 (the height of a line is the font's 16 + 1), cut to the text rectangle's bottom; the text and the selected part are drawn with the format 0", () => {
    const s = scene("AB\nABAB");
    const events = spy(s);
    s.e.m_GroupID = 0;
    s.e.m_rcText.bottom = 60;
    select(s.e, 5, 3);
    s.e.onFrameRender();
    // the x of 5 is that of "AB" (13), of 3 that of "" (0): 0 .. 13 moved by 4: 4 .. 17
    expect(events).toEqual([
      fill([4, 14, 17, 31], SEL_BK),
      text("AB\nABAB", [15, 26, 115, 80], -1, TEXT_COLOR, 0),
      text("ABAB", [15, 34, 28, 51], 2, SEL_COLOR, 0),
    ]);
    // with the text rectangle ending at 30 the selection is cut there
    events.length = 0;
    s.e.m_rcText.bottom = 30;
    s.e.onFrameRender();
    expect(events[0]).toEqual(fill([4, 14, 17, 30], SEL_BK));
  });

  test("the selection of a group's box is not moved up by the first visible line (the caret is): first visible 3 (line 1, y 8) and the caret in it still has the rectangle 14 .. 31", () => {
    const s = scene("AB\nABAB");
    const events = spy(s);
    s.e.m_GroupID = 0;
    s.e.m_rcText.bottom = 60;
    s.e.m_nFirstVisible = 3;
    select(s.e, 5, 3);
    s.e.onFrameRender();
    expect(s.e.m_nFirstVisible).toBe(3);
    expect((events[0] as Ev & { k: "rect" }).rect).toEqual([4, 14, 17, 31]);
  });

  test("a box of a group without a font crashes where it needs the height of a line (the exe dereferences m_pFont there): an Error", () => {
    const s = scene("AB\nABAB");
    spy(s);
    s.e.m_GroupID = 0;
    select(s.e, 5, 3);
    s.e.m_pFont = null;
    expect(() => s.e.onFrameRender()).toThrow(/no font/);
  });

  test("the buffer is asked in this order: PlaceCaret (the first visible character, the caret, the caret's trailing edge), then the frame (the first visible character, the caret, the selection's start only with a selection)", () => {
    const s = scene("AB#");
    spy(s);
    const b = s.e.m_Buffer;
    const asked: [number, boolean][] = [];
    const real = b.CPtoX.bind(b);
    b.CPtoX = ((cp: number, trail: boolean) => {
      asked.push([cp, trail]);
      return real(cp, trail);
    }) as typeof b.CPtoX;
    select(s.e, 1, 3);
    s.e.onFrameRender();
    expect(asked).toEqual([[0, false], [1, false], [1, true], [0, false], [1, false], [3, false]]);
    asked.length = 0;
    select(s.e, 1, 1);
    s.e.onFrameRender();
    expect(asked).toEqual([[0, false], [1, false], [1, true], [0, false], [1, false]]);
    // a box of its own asks for no y; a group's box asks for the y of the caret and then of the first visible character
    const ys: [number, boolean][] = [];
    const realY = b.CPtoY.bind(b);
    b.CPtoY = ((cp: number, trail: boolean) => {
      ys.push([cp, trail]);
      return realY(cp, trail);
    }) as typeof b.CPtoY;
    s.e.onFrameRender();
    expect(ys).toEqual([]);
    s.e.m_GroupID = 0;
    s.e.onFrameRender();
    expect(ys).toEqual([[1, false], [0, false]]);
  });
});

describe("CKTDGUIIMEEditBox::OnFrameRender (32939580): the blink and the caret", () => {
  /** the box with the clock a test sets, the blink 0.5 s and the last blink at 10; the windows of the IME are written down, not drawn */
  function blinking() {
    const s = scene("AB#");
    const events = spy(s);
    const calls = windows(s);
    let now = 10;
    const reads: number[] = [];
    s.w.devices.absoluteTime = () => {
      reads.push(now);
      return now;
    };
    s.e.m_dfBlink = 0.5;
    s.e.m_dfLastBlink = 10;
    s.e.m_bHasFocus = true;
    s.e.m_CaretColor = 0xff123456;
    select(s.e, 3, 3);
    return { ...s, events, calls, reads, at: (t: number) => { now = t; reads.length = 0; events.length = 0; } };
  }

  test("a focused box with its caret on draws the caret: two pixels wide around the caret's x (18: 17 .. 19, moved by 4), as high as the text rectangle (6 .. 30), in the caret colour", () => {
    const s = blinking();
    s.e.onFrameRender();
    expect(s.events).toEqual([text("AB#", [15, 26, 115, 50], -1, TEXT_COLOR), fill([21, 6, 23, 30], 0xff123456)]);
    // the height is that of the text rectangle, wherever it is
    s.events.length = 0;
    Object.assign(s.e.m_rcText, { top: 8, bottom: 41 });
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([21, 8, 23, 41], 0xff123456));
  });

  test("the caret is moved by the text rectangle's left minus the x of the first visible character: 4 - 6 = -2: 15 .. 17 (in the overwrite mode the trailing edge is moved the same way: 18 + 4 - 6 = 16)", () => {
    const s = blinking();
    s.e.m_nFirstVisible = 1;
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([15, 6, 17, 30], 0xff123456));
    s.events.length = 0;
    s.e.m_bInsertMode = false;
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([15, 6, 16, 30], 0xff123456));
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
    s.w.ime.s_bHideCaret = true;
    try {
      s.e.onFrameRender();
      expect(s.events.map((ev) => ev.k)).toEqual(["text"]);
    } finally {
      s.w.ime.s_bHideCaret = false;
    }
  });

  test("in the overwrite mode the caret reaches from its x minus one to the x of its trailing edge (CPtoX does not look at the trail: the same x): one pixel wide", () => {
    const s = blinking();
    s.e.m_bInsertMode = false;
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([21, 6, 22, 30], 0xff123456));
    // the trailing edge is asked of the buffer (with bTrail set), and its answer is the right side, moved like the left one
    s.events.length = 0;
    s.e.m_Buffer.CPtoX = ((cp: number, trail: boolean) => (cp === 0 ? 0 : trail ? 30 : 18)) as typeof s.e.m_Buffer.CPtoX;
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([21, 6, 34, 30], 0xff123456));
  });

  test("a box of a group draws a caret one line high at the line of the caret minus the first visible line: y 8 and the text top 6 and the line's 17 make 14 .. 31 (the caret is not cut to the text rectangle); first visible on line 1 (y 8): 6 .. 23", () => {
    const s = blinking();
    s.e.m_Buffer.SetText("AB\nABAB");
    s.e.m_GroupID = 0;
    select(s.e, 5, 5);
    s.e.onFrameRender();
    // the x of 5 is 13: from 4 + 13 - 1 to 4 + 13 + 1
    expect(s.events[1]).toEqual(fill([16, 14, 18, 31], 0xff123456));
    s.events.length = 0;
    s.e.m_nFirstVisible = 3;
    s.e.onFrameRender();
    expect(s.events[1]).toEqual(fill([16, 6, 18, 23], 0xff123456));
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

  test("a box without the focus blinks all the same, and the time stored is the second reading of the clock", () => {
    const s = blinking();
    const readings = [10.75, 12.25];
    s.w.devices.absoluteTime = () => readings.shift()!;
    s.e.m_bHasFocus = false;
    s.e.onFrameRender();
    expect(s.e.m_bCaretOn).toBe(false);
    expect(s.e.m_dfLastBlink).toBe(12.25);
    expect(readings).toEqual([]);
  });

  test("the blink and the caret are done after the text (the order of the calls: selection, text, selected text, caret)", () => {
    const s = blinking();
    select(s.e, 1, 3);
    s.e.onFrameRender();
    expect(s.events.map((ev) => ev.k)).toEqual(["rect", "text", "text", "rect"]);
  });
});

describe("CKTDGUIIMEEditBox::OnFrameRender (32939580): the windows of the IME", () => {
  test("a focused box draws the composition string after the caret, with no device and the frame's elapsed time", () => {
    const s = scene("AB#");
    const events = spy(s);
    const calls = windows(s);
    s.e.m_bHasFocus = true;
    s.e.m_fElapsedTime = 0.0625;
    s.e.m_bCaretOn = true;
    s.w.devices.absoluteTime = () => 0;
    const order: string[] = [];
    const draw = s.e.DrawRect;
    s.e.DrawRect = ((rc: Rect, c: number) => {
      order.push("caret");
      return draw.call(s.e, rc, c);
    }) as typeof s.e.DrawRect;
    s.e.RenderComposition = ((device: unknown, elapsed: number) => {
      order.push(`composition ${device} ${elapsed}`);
    }) as typeof s.e.RenderComposition;
    s.e.onFrameRender();
    expect(order).toEqual(["caret", "composition null 0.0625"]);
    expect(calls).toEqual([]);
    expect(events.map((ev) => ev.k)).toEqual(["text", "rect"]);
  });

  test("a box without the focus draws neither the composition string nor a window", () => {
    const s = scene("AB#");
    spy(s);
    const calls = windows(s);
    s.w.ime.s_bShowReadingWindow = true;
    s.w.ime.s_CandList.bShowWindow = true;
    s.e.onFrameRender();
    expect(calls).toEqual([]);
  });

  test("the reading window when it is shown (and the candidates not, even if they are shown too); the candidates when only they are; else none", () => {
    const s = scene("AB#");
    spy(s);
    const calls = windows(s);
    s.e.m_bHasFocus = true;
    s.e.m_fElapsedTime = 0.5;
    s.w.ime.s_bShowReadingWindow = true;
    s.w.ime.s_CandList.bShowWindow = true;
    s.e.onFrameRender();
    expect(calls).toEqual(["composition null 0.5", "reading null 0.5"]);
    calls.length = 0;
    s.w.ime.s_bShowReadingWindow = true;
    s.w.ime.s_CandList.bShowWindow = false;
    s.e.onFrameRender();
    expect(calls).toEqual(["composition null 0.5", "reading null 0.5"]);
    calls.length = 0;
    s.w.ime.s_bShowReadingWindow = false;
    s.w.ime.s_CandList.bShowWindow = true;
    s.e.onFrameRender();
    expect(calls).toEqual(["composition null 0.5", "candidates null 0.5"]);
    calls.length = 0;
    s.w.ime.s_CandList.bShowWindow = false;
    s.e.onFrameRender();
    expect(calls).toEqual(["composition null 0.5"]);
  });
});

describe("CKTDGUIIMEEditBox::OnFrameRender (32939580): the background", () => {
  test("a box with a background (m_bBGCheck) draws the quad of its current point first: the dialog's place, the point's corner and the offset times the scale, cut", () => {
    const s = scene("AB#");
    windows(s);
    s.e.m_bBGCheck = true;
    s.e.m_NowPoint.assign(quad(s.w, 10, 20, "BG.TGA"));
    select(s.e, 1, 3);
    const from = s.dev.log.length;
    s.e.onFrameRender();
    // (10.25 + 10 + 0.75) * 1.5 = 31.5 -> 31 and (20.5 + 20 + 0.25) * 2 = 81.5 -> 81; the right side (10 + 64 + 11) * 1.5 = 127.5 -> 127, the bottom (20 + 32 + 20.75) * 2 = 145.5 -> 145
    const quads = drawnQuads(s.dev, from);
    expect(quads[0]).toEqual({ texture: "BG.TGA", rect: [31, 81, 127, 145] });
    // then the selection's rectangle: (10, 6, 22, 30), its corner 10 * 1.5 + 15.375 = 30.375 -> 30 and 6 * 2 + 41 = 53, its size 12 x 24 (not scaled)
    expect(quads[1]!.rect).toEqual([30, 53, 42, 77]);
  });

  test("a box without one (m_bBGCheck off) draws no quad but the selection, whatever its current point holds", () => {
    const s = scene("AB#");
    windows(s);
    s.e.m_NowPoint.assign(quad(s.w, 10, 20, "BG.TGA"));
    select(s.e, 1, 3);
    const from = s.dev.log.length;
    s.e.onFrameRender();
    expect(drawnQuads(s.dev, from).map((q) => q.rect)).toEqual([[30, 53, 42, 77]]);
  });
});

describe("CKTDGUIIMEEditBox::DrawRect (329364E0)", () => {
  test("an untextured quad: the corner is (int)(float)(side * scale + scale * the dialog's place), the size the layout's: 10 * 1.5 + 15.375 = 30.375 -> 30 and 6 * 2 + 41 = 53 for a rectangle 12 x 24; the vertices half a pixel up and left, z 0.5, rhw 1, UV 0, in the colour", () => {
    const s = scene("");
    const from = s.dev.log.length;
    expect(s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c)).toBe(0);
    const calls = drawnCalls(s.dev, from);
    expect(calls.length).toBe(1);
    expect([calls[0]!.type, calls[0]!.prims]).toEqual([5, 2]);
    // the width is (22 + 10.25) - (10 + 10.25) = 12, the height (30 + 20.5) - (6 + 20.5) = 24 (the plain edit box scales them: 18 x 48)
    const c = 0xff28325c;
    expect(calls[0]!.vertices).toEqual([
      [29.5, 52.5, 0.5, 1, c, 0, 0],
      [41.5, 52.5, 0.5, 1, c, 0, 0],
      [29.5, 76.5, 0.5, 1, c, 0, 0],
      [41.5, 76.5, 0.5, 1, c, 0, 0],
    ]);
  });

  test("the size does not grow with the scale: at the scale 1.5 in both directions the rectangle is 12 x 24 all the same, the corner (10 * 1.5 + 15.375 -> 30, 6 * 1.5 + 30.75 = 39.75 -> 39) moves", () => {
    const s = scene("", { width: 1536, height: 1152 });
    const from = s.dev.log.length;
    s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c);
    const v = drawnCalls(s.dev, from)[0]!.vertices;
    expect([v[0]![0], v[0]![1], v[3]![0], v[3]![1]]).toEqual([29.5, 38.5, 41.5, 62.5]);
  });

  test("the rectangle is moved by the alignment offset first (5, -2): 15 .. 27 and 4 .. 28 -> the corner 15 * 1.5 + 15.375 = 37.875 -> 37 and 4 * 2 + 41 = 49", () => {
    const s = scene("");
    s.e.m_ptTextAlignOffset.x = 5;
    s.e.m_ptTextAlignOffset.y = -2;
    const from = s.dev.log.length;
    s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c);
    const v = drawnCalls(s.dev, from)[0]!.vertices;
    expect([v[0]![0], v[0]![1], v[3]![0], v[3]![1]]).toEqual([36.5, 48.5, 48.5, 72.5]);
  });

  test("corners are cut towards 0, not rounded or floored, also below 0: -20 * 1.5 + 15.375 = -14.625 -> -14, 5 * 1.5 + 15.375 = 22.875 -> 22 (a scale of 1.5 in y: -9 * 1.5 + 30.75 = 17.25)", () => {
    const s = scene("", { width: 1536, height: 1152 });
    const from = s.dev.log.length;
    s.e.DrawRect({ left: -20, top: -9, right: 5, bottom: 3 }, 0xff112233);
    // the size 25 x 12 from the corner (-14, 17)
    const v = drawnCalls(s.dev, from)[0]!.vertices;
    expect([v[0]![0], v[0]![1], v[3]![0], v[3]![1]]).toEqual([-14.5, 16.5, 10.5, 28.5]);
    // x 1 .. 3: 1 * 1.5 + 15.375 = 16.875 -> 16 (not 17); y 2 .. 4: 2 * 1.5 + 30.75 = 33.75 -> 33 (not 34)
    const from2 = s.dev.log.length;
    s.e.DrawRect({ left: 1, top: 2, right: 3, bottom: 4 }, 0xff112233);
    const w = drawnCalls(s.dev, from2)[0]!.vertices;
    expect([w[0]![0], w[0]![1], w[3]![0], w[3]![1]]).toEqual([15.5, 32.5, 17.5, 34.5]);
    // below 0 on all four sides: x -20 .. -12: -14.625 -> -14 (not -15); y -30 .. -25: -45 + 30.75 = -14.25 -> -14 (not -15)
    const from3 = s.dev.log.length;
    s.e.DrawRect({ left: -20, top: -30, right: -12, bottom: -25 }, 0xff112233);
    const n = drawnCalls(s.dev, from3)[0]!.vertices;
    expect([n[0]![0], n[0]![1], n[3]![0], n[3]![1]]).toEqual([-14.5, -14.5, -6.5, -9.5]);
  });

  test("the size is a float computation, cut: at the dialog's place 0.05 a rectangle 4 .. 16 is 16.049999 - 4.050000 = 11.999999 -> 11 wide (not 12), in y 11 high; the corner 4 * 1.5 + 0.075 -> 6, 4 * 2 + 0.1 -> 8", () => {
    const s = scene("");
    s.dialog.m_Pos.set(0.05, 0.05);
    const from = s.dev.log.length;
    s.e.DrawRect({ left: 4, top: 4, right: 16, bottom: 16 }, 0xff112233);
    const v = drawnCalls(s.dev, from)[0]!.vertices;
    expect([v[0]![0], v[0]![1], v[3]![0], v[3]![1]]).toEqual([5.5, 7.5, 16.5, 18.5]);
  });

  test("every step of a corner is a float: 277 and the place 99.66664123535156 (x1.5 = 149.49996948242188 as a float) make 564.99996948 + .. = 565, 206 and 219.99998474121094 make 638.99996948 = 639 (ties to even), 16777218 * 1.5 is 25165828 as a float, 16777219 is 16777220 as a float", () => {
    // each case: the four sides all L (degenerate), the dialog at (P, P) in a scene of the scale (1.5, 1.5); the arithmetic is float32, worked out in Python (the exact sum, or the exact product, is cut to another int)
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

  test("the stage's colour and alpha operations are SELECTARG2 (3) for the draw, then the old values come back (nothing sets them to MODULATE first, unlike the plain edit box): from the baseline (colour MODULATE 4, alpha SELECTARG1 2) 3, 3, draw, alpha 2, colour 4", () => {
    const s = scene("");
    const from = s.dev.log.length;
    s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c);
    expect(s.dev.log.slice(from).filter((l) => l.startsWith("tss") || l.startsWith("draw"))).toEqual(["tss 0 1 3", "tss 0 4 3", "draw 5 0 2", "tss 0 4 2", "tss 0 1 4"]);
    expect(s.w.render!.states.stackPointer).toBe(0);
  });

  test("... from a SELECTARG2 baseline nothing is set or restored: the draw alone", () => {
    const s = scene("");
    s.w.render!.states.setTextureStageState(0, 1, 3);
    s.w.render!.states.setTextureStageState(0, 4, 3);
    const top = s.w.render!.states.stackPointer;
    const from = s.dev.log.length;
    s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c);
    expect(s.dev.log.slice(from).filter((l) => l.startsWith("tss") || l.startsWith("draw"))).toEqual(["draw 5 0 2"]);
    expect(s.w.render!.states.stackPointer).toBe(top);
    s.w.render!.states.popTo(0);
  });

  test("the whole of the device's calls: the operations, the vertex declaration kept around the draw (GetVertexDeclaration before, SetVertexDeclaration after), the FVF of the quad, the draw, then the operations back", () => {
    const s = scene("");
    const from = s.dev.log.length;
    s.e.DrawRect({ left: 10, top: 6, right: 22, bottom: 30 }, 0xff28325c);
    // FVF 324 = XYZRHW (4) + DIFFUSE (0x40) + TEX1 (0x100); the stream's source line (its buffer id) is not looked at
    expect(s.dev.log.slice(from).filter((l) => !l.startsWith("src"))).toEqual(["tss 0 1 3", "tss 0 4 3", "getdecl", "fvf 324", "draw 5 0 2", "setdecl", "tss 0 4 2", "tss 0 1 4"]);
  });

  test("without a device nothing is drawn: the failure is reported as the error 0x82 \"device null\" (once), the call answers 0 all the same", () => {
    const s = fontWorld({}, { device: false });
    const dialog = new CKTDGUIDialog(s.w);
    const e = new CKTDGUIIMEEditBox(s.w);
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

describe("CKTDGUIIMEEditBox::DrawTextW (32936930)", () => {
  const RECT = (): Rect => ({ left: 4, top: 6, right: 104, bottom: 30 });

  test("the font draws the text in the rectangle moved by (int)(float)(dialog + offset): (11, 20) here (10.25 + 0.75 = 11, 20.5 + 0.25 = 20.75 cut), in the font colour; the caller's rectangle is not changed", () => {
    const s = scene("");
    const events = spy(s);
    const rc = RECT();
    s.e.m_NowFontColor.r = 0.25;
    s.e.m_NowFontColor.g = 0.5;
    s.e.m_NowFontColor.b = 0.75;
    s.e.m_NowFontColor.a = 0.125;
    expect(s.e.DrawTextW("AB#", rc, 3, 4)).toBe(0);
    expect(events).toEqual([text("AB#", [15, 26, 115, 50], 3, [0.25, 0.5, 0.75, 0.125])]);
    expect(rc).toEqual(RECT());
  });

  test("the move is cut towards 0 below 0 too (not floored): 10.25 - 12 = -1.75 -> -1 (not -2), 20.5 - 30 = -9.5 -> -9", () => {
    const s = scene("");
    const events = spy(s);
    s.e.m_OffsetPos.set(-12, -30);
    s.e.DrawTextW("AB#", RECT(), -1, 4);
    expect((events[0] as Ev & { k: "text" }).rect).toEqual([3, -3, 103, 21]);
  });

  test("the sum of the place and the offset is a float: 16777215 + 2.5 = 16777217.5 is 16777218 as a float (not 16777217)", () => {
    const s = scene("");
    const events = spy(s);
    s.dialog.m_Pos.set(16777215, 20.5);
    s.e.m_OffsetPos.set(2.5, 0.25);
    s.e.DrawTextW("AB#", RECT(), -1, 4);
    expect((events[0] as Ev & { k: "text" }).rect).toEqual([16777222, 26, 16777322, 50]);
  });

  test("the outline: the box's outline flag and colour go to the font, the count and the format as given", () => {
    const s = scene("");
    const events = spy(s);
    s.e.m_bOutlineCheck = true;
    s.e.m_OutlineColor.r = 0.5;
    s.e.m_OutlineColor.g = 0.25;
    s.e.m_OutlineColor.b = 0.125;
    s.e.m_OutlineColor.a = 0.75;
    s.e.DrawTextW("AB#", RECT(), 2, 0x25);
    const ev = events[0] as Ev & { k: "text" };
    expect([ev.outline, ev.outlineColor, ev.count, ev.flag]).toEqual([true, [0.5, 0.25, 0.125, 0.75], 2, 0x25]);
    events.length = 0;
    s.e.m_bOutlineCheck = false;
    s.e.DrawTextW("AB#", RECT(), 2, 0x25);
    expect((events[0] as Ev & { k: "text" }).outline).toBe(false);
  });

  test("the default alignment replaces the format while the box's own text fits (its end at x 18 <= the width of the text rectangle, a tie fits too: 18); not otherwise; -1 is none", () => {
    const s = scene("AB#");
    s.e.m_Buffer.m_pFontNode = s.uk; // the frame gives the buffer the font
    const events = spy(s);
    const formats = (): number[] => {
      events.length = 0;
      s.e.DrawTextW("AB#", RECT(), -1, 4);
      return events.map((ev) => (ev as Ev & { k: "text" }).flag);
    };
    s.e.m_DefTextAlign = 0x21;
    s.e.m_rcText.right = s.e.m_rcText.left + 18;
    expect(formats()).toEqual([0x21]);
    s.e.m_rcText.right = s.e.m_rcText.left + 17;
    expect(formats()).toEqual([4]);
    s.e.m_rcText.right = s.e.m_rcText.left + 100;
    s.e.m_DefTextAlign = 0xffffffff;
    expect(formats()).toEqual([4]);
  });

  test("... and it is the text of the box that is measured, not the text drawn: a long text drawn in a box whose own text is short gets the alignment, a short text in a long box does not", () => {
    const s = scene("AB#");
    s.e.m_Buffer.m_pFontNode = s.uk;
    const events = spy(s);
    s.e.m_DefTextAlign = 0x21;
    s.e.m_rcText.right = s.e.m_rcText.left + 30;
    s.e.DrawTextW("ABABABABABABABAB", RECT(), -1, 4);
    expect((events[0] as Ev & { k: "text" }).flag).toBe(0x21);
    events.length = 0;
    s.e.m_Buffer.SetText("ABABABABAB");
    s.e.DrawTextW("A", RECT(), -1, 4);
    expect((events[0] as Ev & { k: "text" }).flag).toBe(4);
  });

  test("a box without a font draws nothing of an empty text or with the count 0, and crashes otherwise (the exe calls DrawTextFont through a null pointer): an Error", () => {
    const s = scene("");
    const events = spy(s);
    s.e.m_pFont = null;
    expect(s.e.DrawTextW("", RECT(), -1, 4)).toBe(0);
    expect(s.e.DrawTextW("AB", RECT(), 0, 4)).toBe(0);
    expect(events).toEqual([]);
    expect(() => s.e.DrawTextW("AB", RECT(), -1, 4)).toThrow(/no font/);
    expect(() => s.e.DrawTextW("AB", RECT(), 1, 4)).toThrow(/no font/);
  });

  test("a box in no dialog is the exe's null object: an Error here", () => {
    const s = scene("");
    spy(s);
    s.e.m_pDialog = null;
    expect(() => s.e.DrawTextW("AB", RECT(), -1, 4)).toThrow(/no dialog/);
  });
});

describe("CKTDGUIIMEEditBox::CalcTextRect (32936140)", () => {
  test("the font measures the text: the rectangle's right is its left plus the width of the text (AB: 20), the bottom its top plus a line (17); the font is given the text, the count and the format", () => {
    const s = scene("");
    const calls = measures(s);
    const rc: Rect = { left: 22, top: 6, right: 22, bottom: 30 };
    expect(s.e.CalcTextRect("AB", rc, -1, 0x404)).toBe(0);
    expect([rc.left, rc.top, rc.right, rc.bottom]).toEqual([22, 6, 42, 23]);
    expect(calls).toEqual([["AB", -1, 0x404]]);
    // the count: only the first 2 characters of ABAB
    const rc2: Rect = { left: 22, top: 6, right: 22, bottom: 30 };
    s.e.CalcTextRect("ABAB", rc2, 3, 0x404);
    expect([rc2.left, rc2.right]).toEqual([22, 22 + 29]);
  });

  test("the default alignment replaces the format while the box's own text fits (as in DrawTextW): 0x21 here; the format as given when it does not or without an alignment (-1)", () => {
    const s = scene("AB#");
    s.e.m_Buffer.m_pFontNode = s.uk;
    const calls = measures(s);
    const rc = (): Rect => ({ left: 0, top: 0, right: 0, bottom: 0 });
    s.e.m_DefTextAlign = 0x21;
    s.e.CalcTextRect("AB", rc(), -1, 0x404);
    s.e.m_rcText.right = s.e.m_rcText.left + 17;
    s.e.CalcTextRect("AB", rc(), -1, 0x404);
    s.e.m_rcText.right = s.e.m_rcText.left + 18;
    s.e.CalcTextRect("AB", rc(), -1, 0x404);
    s.e.m_DefTextAlign = 0xffffffff;
    s.e.CalcTextRect("AB", rc(), -1, 0x404);
    expect(calls.map((c) => c[2])).toEqual([0x21, 0x404, 0x21, 0x404]);
  });

  test("a box without a font measures an empty text, or with the count 0, as the empty rectangle (0, 0, 0, 0), and crashes otherwise (the exe calls CalcTextRect through a null pointer): an Error", () => {
    const s = scene("");
    s.e.m_pFont = null;
    const rc: Rect = { left: 5, top: 6, right: 7, bottom: 8 };
    expect(s.e.CalcTextRect("", rc, -1, 0x404)).toBe(0);
    expect([rc.left, rc.top, rc.right, rc.bottom]).toEqual([0, 0, 0, 0]);
    const rc2: Rect = { left: 5, top: 6, right: 7, bottom: 8 };
    s.e.CalcTextRect("AB", rc2, 0, 0x404);
    expect([rc2.left, rc2.top, rc2.right, rc2.bottom]).toEqual([0, 0, 0, 0]);
    expect(() => s.e.CalcTextRect("AB", { left: 5, top: 6, right: 7, bottom: 8 }, -1, 0x404)).toThrow(/no font/);
  });
});

describe("CKTDGUIIMEEditBox::RenderComposition (3293A2F0)", () => {
  /** a box with the caret at `caret` (default: the end of `content`), the composition string `comp` with its attributes and caret, and the colours of PACKED; only the calls are written down */
  function composing(content: string, comp: string, attr: number[], compCaret: number, caret = content.length, backBuffer?: { width: number; height: number }) {
    const s = scene(content, backBuffer);
    const events = spy(s);
    recolor(s.e);
    s.e.m_Buffer.m_pFontNode = s.uk;
    const ime = s.w.ime;
    expect(ime.s_CompString.SetText(comp)).toBe(true);
    ime.s_CompString.m_pFontNode = s.uk;
    attr.forEach((a, i) => {
      ime.s_abCompStringAttr[i] = a;
    });
    ime.s_nCompCaret = compCaret;
    select(s.e, caret, caret);
    return { ...s, events, ime };
  }

  test("the string starts at the box's caret (4 - 0 + 18 = 22) in a window of its own, 22 .. 42 (the width of AB) by 6 .. 23 (a line), the text in it in the composition colour (the rectangle moved by (11, 20)); the target clause (attribute 1: converted, 3: not converted) is drawn over it a character at a time, each in a rectangle that is as wide as the x of its trailing edge less its x: none (CPtoX does not look at the trail), then the caret of the string at its character (6 + 22 - 1 .. + 1)", () => {
    const s = composing("AB#", "AB", [1, 3], 1);
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([22, 6, 42, 23], PACKED.compWin),
      text("AB", [33, 26, 53, 43], 2, F.comp),
      fill([22, 6, 22, 23], PACKED.targetBk),
      text("AB", [33, 26, 33, 43], 1, F.target),
      fill([28, 6, 28, 23], PACKED.nonTargetBk),
      text("B", [39, 26, 39, 43], 1, F.nonTarget),
      fill([27, 6, 29, 23], PACKED.compCaret),
    ]);
    // the first character of the target clause, and where the string was put
    expect(s.ime.s_nFirstTargetConv).toBe(0);
    expect([s.ime.s_ptCompString.x, s.ime.s_ptCompString.y]).toEqual([22, 6]);
  });

  test("the caret of the string is at its end when it is there (x 13 + 22 - 1 = 34, two pixels wide) and the string has no attributes: no clause is drawn and no first target is found (-1)", () => {
    const s = composing("AB#", "AB", [], 2);
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([22, 6, 42, 23], PACKED.compWin),
      text("AB", [33, 26, 53, 43], 2, F.comp),
      fill([34, 6, 36, 23], PACKED.compCaret),
    ]);
    expect(s.ime.s_nFirstTargetConv).toBe(-1);
  });

  test("an empty string: the window is the empty rectangle (0, 0, 0, 0), the font is given the empty text (count 0), and the caret is at the end of the string (x 0 + 0 - 1): (-1, 0, 1, 0), a rectangle without a height, drawn all the same", () => {
    const s = composing("AB#", "", [], 0);
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([0, 0, 0, 0], PACKED.compWin),
      text("", [11, 20, 11, 20], 0, F.comp),
      fill([-1, 0, 1, 0], PACKED.compCaret),
    ]);
    expect([s.ime.s_ptCompString.x, s.ime.s_ptCompString.y]).toEqual([0, 0]);
  });

  test("a box without a font draws an empty string, but the font is not given the empty text: the same rectangles (no call to DrawTextFont)", () => {
    const s = composing("AB#", "", [], 0);
    s.e.m_pFont = null;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([fill([0, 0, 0, 0], PACKED.compWin), fill([-1, 0, 1, 0], PACKED.compCaret)]);
  });

  test("... and crashes (an Error) for a string with characters: the exe calls CalcTextRect through a null pointer", () => {
    const s = composing("AB#", "AB", [], 0);
    s.e.m_pFont = null;
    expect(() => s.e.RenderComposition(null, 0)).toThrow(/no font/);
  });

  test("a string that ends beyond the right side of the text rectangle (the caret at x 40: 4 + 40 + 80 = 124 > 104) starts again at its left side one line down (4, 23, 84, 40), and its window is put at the right side of the line above (24 .. 104, 6 .. 23: the rectangle's left plus the text rectangle's right less its right; 2 * 23 - 40)", () => {
    const s = composing("ABABAB", "ABABABAB", [], 0);
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([24, 6, 104, 23], PACKED.compWin),
      text("ABABABAB", [35, 26, 115, 43], 8, F.comp),
      fill([23, 6, 25, 23], PACKED.compCaret),
    ]);
    expect([s.ime.s_ptCompString.x, s.ime.s_ptCompString.y]).toEqual([4, 23]);
  });

  test("a string longer than the line is drawn in pieces of the characters that XtoCP finds room for in the rest of the line (36 pixels: 5 of ABABAB), the next piece one line down at the text rectangle's left: the windows are placed at the right side of the rectangle (the first piece -9 .. 40, the second 29 .. 40), the caret at the start of the first piece", () => {
    const s = composing("ABABAB", "ABABAB", [], 0, 0);
    s.e.m_rcText.right = 40;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([-9, 6, 40, 23], PACKED.compWin),
      text("ABABAB", [2, 26, 51, 43], 5, F.comp),
      fill([29, 23, 40, 40], PACKED.compWin),
      text("B", [40, 43, 51, 60], 1, F.comp),
      fill([3, 23, 5, 40], PACKED.compCaret),
    ]);
  });

  test("the target clause goes on to the next line when a character is beyond the right side (x 19 > 20 - 4: the fourth), and its x is then counted from that character (19): 3 pieces first (2 characters of 16 pixels each), then the clause of the 6 characters in rectangles of no width; the caret of the string at its end (40 - 19 + 4 - 1 = 24) in the line of the second piece", () => {
    const s = composing("AB#", "ABABAB", [1, 1, 1, 1, 1, 1], 6, 0);
    s.e.m_rcText.right = 20;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([0, 6, 20, 23], PACKED.compWin),
      text("ABABAB", [11, 26, 31, 43], 2, F.comp),
      fill([0, 23, 20, 40], PACKED.compWin),
      text("ABAB", [11, 43, 31, 60], 2, F.comp),
      fill([0, 40, 20, 57], PACKED.compWin),
      text("AB", [11, 60, 31, 77], 2, F.comp),
      fill([4, 23, 4, 40], PACKED.targetBk),
      text("ABABAB", [15, 43, 15, 60], 1, F.target),
      fill([10, 23, 10, 40], PACKED.targetBk),
      text("BABAB", [21, 43, 21, 60], 1, F.target),
      fill([17, 23, 17, 40], PACKED.targetBk),
      text("ABAB", [28, 43, 28, 60], 1, F.target),
      fill([4, 40, 4, 57], PACKED.targetBk),
      text("BAB", [15, 60, 15, 77], 1, F.target),
      fill([11, 40, 11, 57], PACKED.targetBk),
      text("AB", [22, 60, 22, 77], 1, F.target),
      fill([17, 40, 17, 57], PACKED.targetBk),
      text("B", [28, 60, 28, 77], 1, F.target),
      fill([24, 23, 26, 40], PACKED.compCaret),
    ]);
    expect([s.ime.s_ptCompString.x, s.ime.s_ptCompString.y, s.ime.s_nFirstTargetConv]).toEqual([4, 23, 0]);
  });

  test("a box of a group puts the string at the line of the caret (y 8 for line 1: 14 .. 31; the caret at the end of it: x 4 + 13 = 17) and draws it with the format 0 (the clause with 4 all the same)", () => {
    const s = composing("AB\nAB", "AB", [], 0);
    s.e.m_GroupID = 0;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([17, 14, 37, 31], PACKED.compWin),
      text("AB", [28, 34, 48, 51], 2, F.comp, 0),
      fill([16, 14, 18, 31], PACKED.compCaret),
    ]);
    expect([s.ime.s_ptCompString.x, s.ime.s_ptCompString.y]).toEqual([17, 14]);
  });

  test("... in pieces too (the format 0 for each)", () => {
    const s = composing("AB#", "ABABAB", [], 0, 0);
    s.e.m_GroupID = 0;
    s.e.m_rcText.right = 40;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([-9, 6, 40, 23], PACKED.compWin),
      text("ABABAB", [2, 26, 51, 43], 5, F.comp, 0),
      fill([29, 23, 40, 40], PACKED.compWin),
      text("B", [40, 43, 51, 60], 1, F.comp, 0),
      fill([3, 23, 5, 40], PACKED.compCaret),
    ]);
  });

  test("only the attributes 1 and 3 have a clause: 2 (converted) and 4 (an input error) have none, nor has 0 or 5; the first target character is the first of attribute 1 or 3 (1 here)", () => {
    const s = composing("AB#", "ABA", [2, 3, 4], 0);
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([22, 6, 51, 23], PACKED.compWin),
      text("ABA", [33, 26, 62, 43], 3, F.comp),
      fill([28, 6, 28, 23], PACKED.nonTargetBk),
      text("BA", [39, 26, 39, 43], 1, F.nonTarget),
      fill([21, 6, 23, 23], PACKED.compCaret),
    ]);
    expect(s.ime.s_nFirstTargetConv).toBe(1);
    for (const other of [0, 2, 4, 5, 6, 255]) {
      s.events.length = 0;
      s.ime.s_abCompStringAttr.fill(other);
      s.e.RenderComposition(null, 0);
      expect(s.events.length).toBe(3);
      expect(s.ime.s_nFirstTargetConv).toBe(-1);
    }
  });

  test("a Korean layout (the low ten bits of the keyboard layout are 0x12: 0x0412, 0x0812, 0x0012, and with a device handle in the high word 0xE0120412) draws no window for the string while the box's caret is off, and no caret", () => {
    const s = composing("AB#", "AB", [], 0);
    for (const hkl of [0x0412, 0x0812, 0x0012, 0xe0120412]) {
      s.w.ime.s_hklCurrent = hkl;
      s.e.m_bCaretOn = false;
      s.events.length = 0;
      s.e.RenderComposition(null, 0);
      expect(s.events).toEqual([
        text("AB", [33, 26, 53, 43], 2, F.comp),
      ]);
    }
  });

  test("... but with the caret on it draws both; other layouts draw the window with the caret off (0x0411, 0x0413, 0x0112, 0 and 0xE0010411 are not Korean)", () => {
    const s = composing("AB#", "AB", [], 0);
    s.w.ime.s_hklCurrent = 0x0412;
    s.e.m_bCaretOn = true;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([22, 6, 42, 23], PACKED.compWin),
      text("AB", [33, 26, 53, 43], 2, F.comp),
      fill([21, 6, 23, 23], PACKED.compCaret),
    ]);
    for (const hkl of [0x0411, 0x0413, 0x0112, 0x0000, 0xe0010411]) {
      s.w.ime.s_hklCurrent = hkl;
      s.e.m_bCaretOn = false;
      s.events.length = 0;
      s.e.RenderComposition(null, 0);
      expect(s.events.map((ev) => ev.k)).toEqual(["rect", "text"]);
    }
  });

  test("the box's offset is taken off the rectangles before the font draws them (2.5 -> 2, -3.5 -> -3: cut) and the font moves them by the dialog's place plus the offset ((int)12.75 = 12, (int)17.0 = 17); the windows are not moved by it", () => {
    const s = composing("AB#", "AB", [1, 3], 2);
    s.e.m_OffsetPos.set(2.5, -3.5);
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([22, 6, 42, 23], PACKED.compWin),
      text("AB", [32, 26, 52, 43], 2, F.comp),
      fill([22, 6, 22, 23], PACKED.targetBk),
      text("AB", [32, 26, 32, 43], 1, F.target),
      fill([28, 6, 28, 23], PACKED.nonTargetBk),
      text("B", [38, 26, 38, 43], 1, F.nonTarget),
      fill([34, 6, 36, 23], PACKED.compCaret),
    ]);
  });

  test("the caret of the string is drawn when the box's caret is on only; the caret that is on no character of the string (5 of 2) is the rectangle (0, 0, 0, 0), drawn all the same", () => {
    const s = composing("AB#", "AB", [], 1);
    s.e.m_bCaretOn = false;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([22, 6, 42, 23], PACKED.compWin),
      text("AB", [33, 26, 53, 43], 2, F.comp),
    ]);
    s.events.length = 0;
    s.e.m_bCaretOn = true;
    s.ime.s_nCompCaret = 5;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([22, 6, 42, 23], PACKED.compWin),
      text("AB", [33, 26, 53, 43], 2, F.comp),
      fill([0, 0, 0, 0], PACKED.compCaret),
    ]);
  });

  test("the formats the string is measured with: 0x404, and 0x400 for the pieces of a box of a group; the box's default alignment instead while the box's own text fits (x 18 <= the 18 of the text rectangle), and the text is drawn in it too", () => {
    const s = composing("AB#", "AB", [1], 0);
    const calls = measures(s);
    s.e.RenderComposition(null, 0);
    expect(calls).toEqual([["AB", -1, 0x404], ["AB", 2, 0x404]]);
    calls.length = 0;
    s.e.m_GroupID = 0;
    s.events.length = 0;
    s.e.RenderComposition(null, 0);
    expect(calls).toEqual([["AB", -1, 0x404], ["AB", 2, 0x400]]);
    expect(s.events.filter((ev) => ev.k === "text").map((ev) => (ev as Ev & { k: "text" }).flag)).toEqual([0, 4]);
    s.e.m_GroupID = -1;
    s.e.m_DefTextAlign = 0x21;
    s.e.m_rcText.right = s.e.m_rcText.left + 18;
    calls.length = 0;
    s.events.length = 0;
    s.e.RenderComposition(null, 0);
    expect(calls).toEqual([["AB", -1, 0x21], ["AB", 2, 0x21]]);
    expect(s.events.filter((ev) => ev.k === "text").map((ev) => (ev as Ev & { k: "text" }).flag)).toEqual([0x21, 0x21]);
    s.e.m_rcText.right = s.e.m_rcText.left + 17;
    calls.length = 0;
    s.e.RenderComposition(null, 0);
    expect(calls).toEqual([["AB", -1, 0x404], ["AB", 2, 0x404]]);
  });

  test("the box is asked for the x of its caret and of its first visible character (and the y of both for a group) before the string is measured", () => {
    const s = composing("AB#", "AB", [], 0);
    const b = s.e.m_Buffer;
    const asked: [string, number, boolean][] = [];
    const real = b.CPtoX.bind(b);
    b.CPtoX = ((cp: number, trail: boolean) => {
      asked.push(["x", cp, trail]);
      return real(cp, trail);
    }) as typeof b.CPtoX;
    const realY = b.CPtoY.bind(b);
    b.CPtoY = ((cp: number, trail: boolean) => {
      asked.push(["y", cp, trail]);
      return realY(cp, trail);
    }) as typeof b.CPtoY;
    s.e.m_nFirstVisible = 1;
    s.e.RenderComposition(null, 0);
    expect(asked).toEqual([["x", 3, false], ["x", 1, false]]);
    asked.length = 0;
    s.e.m_GroupID = 0;
    s.e.RenderComposition(null, 0);
    expect(asked).toEqual([["x", 3, false], ["x", 1, false], ["y", 3, false], ["y", 1, false]]);
  });

  test("when not one character of the string fits the text rectangle the exe's loop of pieces never ends: an Error here (the first piece is empty at the left side of the line)", () => {
    const s = composing("AB#", "ABAB", [], 0, 0);
    s.e.m_rcText.right = 5;
    expect(() => s.e.RenderComposition(null, 0)).toThrow(/not one character/);
    // at the end of the first turn: its empty window (the text rectangle's right 5 less the empty rectangle's right 0: 5 .. 5) and its empty text, once
    expect(s.events).toEqual([fill([5, 0, 5, 0], PACKED.compWin), text("ABAB", [16, 20, 16, 20], 0, F.comp)]);
  });

  test("the format of the pieces is (m_GroupID >> 31) & 4, as in OnFrameRender: 4 for a box of its own, 0 for a box of a group, whichever bits the ID has (6 and -8 tell a shift by 31 from none: 6 & 4 is 4, -8 & 4 is 0)", () => {
    const flags: number[] = [];
    for (const group of [-1, 0, 5, 6, -8, -5, 2147483647, -2147483648]) {
      const s = composing("AB#", "AB", [], 0);
      s.e.m_GroupID = group;
      s.e.RenderComposition(null, 0);
      flags.push((s.events.find((e) => e.k === "text") as Ev & { k: "text" }).flag);
    }
    expect(flags).toEqual([4, 0, 0, 0, 4, 4, 0, 4]);
  });

  test("the string starts at the box's caret less the x of its first visible character, from the text rectangle's left: 4 - 13 + 32 = 23 for the caret at 5 and the first visible character at 2 (20 / 1.5 = 13, 49 / 1.5 = 32)", () => {
    const s = composing("ABABAB", "AB", [1, 3], 1, 5);
    s.e.m_nFirstVisible = 2;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([23, 6, 43, 23], PACKED.compWin),
      text("AB", [34, 26, 54, 43], 2, F.comp),
      fill([23, 6, 23, 23], PACKED.targetBk),
      text("AB", [34, 26, 34, 43], 1, F.target),
      fill([29, 6, 29, 23], PACKED.nonTargetBk),
      text("B", [40, 26, 40, 43], 1, F.nonTarget),
      fill([28, 6, 30, 23], PACKED.compCaret),
    ]);
    expect([s.ime.s_ptCompString.x, s.ime.s_ptCompString.y]).toEqual([23, 6]);
  });

  test("a box of a group puts the string at the line of the caret less the line of its first visible character: the caret on line 2 (y 17), the first visible character on line 1 (y 8): from 6 - 8 + 17 = 15 to 17 + 6 + 17 - 8 = 32", () => {
    const s = composing("ABAB\nAB\nAB", "AB", [1, 3], 1, 8);
    s.e.m_GroupID = 0;
    s.e.m_nFirstVisible = 5;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([4, 15, 24, 32], PACKED.compWin),
      text("AB", [15, 35, 35, 52], 2, F.comp, 0),
      fill([4, 15, 4, 32], PACKED.targetBk),
      text("AB", [15, 35, 15, 52], 1, F.target),
      fill([10, 15, 10, 32], PACKED.nonTargetBk),
      text("B", [21, 35, 21, 52], 1, F.nonTarget),
      fill([9, 15, 11, 32], PACKED.compCaret),
    ]);
    expect([s.ime.s_ptCompString.x, s.ime.s_ptCompString.y]).toEqual([4, 15]);
  });

  test("a string that ends exactly at the right side of the text rectangle (4 + 20 = 24) is not moved down: one piece in the first line, its window 4 .. 24", () => {
    const s = composing("AB#", "AB", [1, 3], 1, 0);
    s.e.m_rcText.right = 24;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([4, 6, 24, 23], PACKED.compWin),
      text("AB", [15, 26, 35, 43], 2, F.comp),
      fill([4, 6, 4, 23], PACKED.targetBk),
      text("AB", [15, 26, 15, 43], 1, F.target),
      fill([10, 6, 10, 23], PACKED.nonTargetBk),
      text("B", [21, 26, 21, 43], 1, F.nonTarget),
      fill([9, 6, 11, 23], PACKED.compCaret),
    ]);
    expect([s.ime.s_ptCompString.x, s.ime.s_ptCompString.y]).toEqual([4, 6]);
  });

  test("a character of the clause whose x is exactly the room left in the line (19 on 23 - 4) stays in it: the clause goes on to the next line at the character after it (26), counted from there; the pieces are 2 characters (28 pixels of room) each", () => {
    const s = composing("AB#", "ABABAB", [1, 1, 1, 1, 1, 1], 3, 0);
    s.e.m_rcText.right = 23;
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([3, 6, 23, 23], PACKED.compWin),
      text("ABABAB", [14, 26, 34, 43], 2, F.comp),
      fill([3, 23, 23, 40], PACKED.compWin),
      text("ABAB", [14, 43, 34, 60], 2, F.comp),
      fill([3, 40, 23, 57], PACKED.compWin),
      text("AB", [14, 60, 34, 77], 2, F.comp),
      fill([4, 23, 4, 40], PACKED.targetBk),
      text("ABABAB", [15, 43, 15, 60], 1, F.target),
      fill([10, 23, 10, 40], PACKED.targetBk),
      text("BABAB", [21, 43, 21, 60], 1, F.target),
      fill([17, 23, 17, 40], PACKED.targetBk),
      text("ABAB", [28, 43, 28, 60], 1, F.target),
      fill([23, 23, 23, 40], PACKED.targetBk),
      text("BAB", [34, 43, 34, 60], 1, F.target),
      fill([4, 40, 4, 57], PACKED.targetBk),
      text("AB", [15, 60, 15, 77], 1, F.target),
      fill([10, 40, 10, 57], PACKED.targetBk),
      text("B", [21, 60, 21, 77], 1, F.target),
      fill([22, 23, 24, 40], PACKED.compCaret),
    ]);
    expect(s.ime.s_nFirstTargetConv).toBe(0);
  });

  test("on a back buffer smaller than the layout (scale 0.5: a character is twice as wide in the layout as in the font) the string fits the line by the font's width (22 + 60 = 82 <= 104) but XtoCP finds room for 4 characters of 6 (82 * 0.5 = 41 pixels): it is drawn in two pieces all the same, the second window placed as for a string that has wrapped (84 .. 104, 6 .. 23); the clause goes on to the next line at the character at x 98 > 82, counted from there (4, 23 .. 40), and the caret of the string, on that character, is counted from the first line's window: 98 - 98 + 22 - 1 = 21 .. 23", () => {
    const s = composing("AB#", "ABABAB", [1, 1, 1, 1, 1, 1], 5, 1, { width: 512, height: 384 });
    s.e.RenderComposition(null, 0);
    expect(s.events).toEqual([
      fill([22, 6, 62, 23], PACKED.compWin),
      text("ABABAB", [33, 26, 73, 43], 4, F.comp),
      fill([84, 6, 104, 23], PACKED.compWin),
      text("AB", [95, 26, 115, 43], 2, F.comp),
      fill([22, 6, 22, 23], PACKED.targetBk),
      text("ABABAB", [33, 26, 33, 43], 1, F.target),
      fill([40, 6, 40, 23], PACKED.targetBk),
      text("BABAB", [51, 26, 51, 43], 1, F.target),
      fill([62, 6, 62, 23], PACKED.targetBk),
      text("ABAB", [73, 26, 73, 43], 1, F.target),
      fill([80, 6, 80, 23], PACKED.targetBk),
      text("BAB", [91, 26, 91, 43], 1, F.target),
      fill([102, 6, 102, 23], PACKED.targetBk),
      text("AB", [113, 26, 113, 43], 1, F.target),
      fill([4, 23, 4, 40], PACKED.targetBk),
      text("B", [15, 43, 15, 60], 1, F.target),
      fill([21, 6, 23, 23], PACKED.compCaret),
    ]);
    expect([s.ime.s_ptCompString.x, s.ime.s_ptCompString.y]).toEqual([22, 6]);
  });

});

describe("CKTDGUIIMEEditBox::RenderCandidateReadingWindow (32939C50)", () => {
  /** a box "AB#" whose composition string (default "AB", its caret at 1: x 6) is at (22, 6); the colours of PACKED, a view port of 1536 x 1536; only the calls are written down */
  function windowed(over: { comp?: string; compCaret?: number; pt?: [number, number]; hkl?: number; firstTarget?: number; view?: [number, number]; device?: boolean } = {}) {
    const s = scene("AB#", undefined, over.device ?? true);
    const events = spy(s);
    recolor(s.e);
    s.e.m_Buffer.m_pFontNode = s.uk;
    const ime = s.w.ime;
    expect(ime.s_CompString.SetText(over.comp ?? "AB")).toBe(true);
    ime.s_CompString.m_pFontNode = s.uk;
    ime.s_nCompCaret = over.compCaret ?? 1;
    ime.s_nFirstTargetConv = over.firstTarget ?? 0;
    ime.s_ptCompString.x = over.pt?.[0] ?? 22;
    ime.s_ptCompString.y = over.pt?.[1] ?? 6;
    ime.s_hklCurrent = over.hkl ?? 0;
    // a world without a device has no view port (the exe's 1024 x 768 stands in)
    if (s.w.render) {
      const view = over.view ?? [1536, 1536];
      s.w.render.viewport.width = view[0];
      s.w.render.viewport.height = view[1];
    }
    const cand = ime.s_CandList;
    cand.HoriCand.m_pFontNode = s.uk;
    return { ...s, events, ime, cand };
  }

  test("the candidates as one line (the horizontal list, 'AB#B'): the window is the size of the text (38 x 17) under the string (22 + the x of the composition caret 6 = 28, 6 + the text rectangle's height 24 = 30), in the window colour; the line in the candidate colour; then the selected part (from 1, 2 characters: x 6 .. 18) over a rectangle of the selection's colours", () => {
    const s = windowed();
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 30, 66, 47], PACKED.candWin),
      text("AB#B", [39, 50, 77, 67], -1, F.cand),
      fill([34, 30, 46, 47], PACKED.candSelBk),
      text("B#B", [45, 50, 57, 67], 2, F.candSel),
    ]);
    expect([s.cand.rcCandidate.left, s.cand.rcCandidate.top, s.cand.rcCandidate.right, s.cand.rcCandidate.bottom]).toEqual([28, 30, 66, 47]);
  });

  test("the reading as one line (the horizontal reading): its colours, the size of the text (20 x 17), nothing else; the candidates' window is not remembered", () => {
    const s = windowed();
    s.ime.s_bHorizontalReading = true;
    s.ime.s_wszReadingString = "AB";
    s.e.RenderCandidateReadingWindow(null, 0, true);
    expect(s.events).toEqual([
      fill([28, 30, 48, 47], PACKED.readingWin),
      text("AB", [39, 50, 59, 67], -1, F.reading),
    ]);
    expect([s.cand.rcCandidate.left, s.cand.rcCandidate.top, s.cand.rcCandidate.right, s.cand.rcCandidate.bottom]).toEqual([0, 0, 0, 0]);
  });

  test("the reading as a column (not a horizontal reading): the rows of awszCandidate, 5 of them, each a row high (17) and the window the width of the widest (20) up to the first empty one, the row of the selection over a rectangle of the reading's selection colours, every row drawn (the empty ones too)", () => {
    const s = windowed();
    s.cand.awszCandidate.splice(0, 3, "A", "AB", "#");
    s.cand.dwSelection = 2;
    s.e.RenderCandidateReadingWindow(null, 0, true);
    expect(s.events).toEqual([
      fill([28, 30, 48, 115], PACKED.readingWin),
      text("A", [39, 50, 59, 67], -1, F.reading),
      text("AB", [39, 67, 59, 84], -1, F.reading),
      fill([28, 64, 48, 81], PACKED.readingSelBk),
      text("#", [39, 84, 59, 101], -1, F.readingSel),
      text("", [39, 101, 59, 118], -1, F.reading),
      text("", [39, 118, 59, 135], -1, F.reading),
    ]);
  });

  test("... a vertical candidate list does not change the reading (a column all the same), and a horizontal reading is a line even then", () => {
    const s = windowed();
    s.cand.awszCandidate.splice(0, 3, "A", "AB", "#");
    s.cand.dwSelection = 2;
    s.ime.s_bVerticalCand = true;
    s.e.RenderCandidateReadingWindow(null, 0, true);
    expect(s.events).toEqual([
      fill([28, 30, 48, 115], PACKED.readingWin),
      text("A", [39, 50, 59, 67], -1, F.reading),
      text("AB", [39, 67, 59, 84], -1, F.reading),
      fill([28, 64, 48, 81], PACKED.readingSelBk),
      text("#", [39, 84, 59, 101], -1, F.readingSel),
      text("", [39, 101, 59, 118], -1, F.reading),
      text("", [39, 118, 59, 135], -1, F.reading),
    ]);
  });

  test("... a horizontal reading is a line, also when the candidates are vertical", () => {
    const s = windowed();
    s.cand.awszCandidate.splice(0, 3, "A", "AB", "#");
    s.cand.dwSelection = 0;
    s.ime.s_bVerticalCand = true;
    s.ime.s_bHorizontalReading = true;
    s.ime.s_wszReadingString = "AB";
    s.e.RenderCandidateReadingWindow(null, 0, true);
    expect(s.events).toEqual([
      fill([28, 30, 48, 47], PACKED.readingWin),
      text("AB", [39, 50, 59, 67], -1, F.reading),
    ]);
  });

  test("the candidates as a column (a vertical list): 10 rows of 17 high, the width of the widest (20), the row of the selection (1) over a rectangle of the candidates' selection colours; the window is remembered", () => {
    const s = windowed();
    s.cand.awszCandidate.splice(0, 3, "A", "AB", "#");
    s.cand.dwSelection = 1;
    s.ime.s_bVerticalCand = true;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 30, 48, 200], PACKED.candWin),
      text("A", [39, 50, 59, 67], -1, F.cand),
      fill([28, 47, 48, 64], PACKED.candSelBk),
      text("AB", [39, 67, 59, 84], -1, F.candSel),
      text("#", [39, 84, 59, 101], -1, F.cand),
      text("", [39, 101, 59, 118], -1, F.cand),
      text("", [39, 118, 59, 135], -1, F.cand),
      text("", [39, 135, 59, 152], -1, F.cand),
      text("", [39, 152, 59, 169], -1, F.cand),
      text("", [39, 169, 59, 186], -1, F.cand),
      text("", [39, 186, 59, 203], -1, F.cand),
      text("", [39, 203, 59, 220], -1, F.cand),
    ]);
    expect([s.cand.rcCandidate.left, s.cand.rcCandidate.top, s.cand.rcCandidate.right, s.cand.rcCandidate.bottom]).toEqual([28, 30, 48, 200]);
  });

  test("a Chinese layout (primary language 4: 0x0804) puts the window above the string: from 6 - 17 = -11 to 6, at 22 + 6 (the composition caret's x)", () => {
    const s = windowed({ hkl: 0x804 });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, -11, 66, 6], PACKED.candWin),
      text("AB#B", [39, 9, 77, 26], -1, F.cand),
      fill([34, -11, 46, 6], PACKED.candSelBk),
      text("B#B", [45, 9, 57, 26], 2, F.candSel),
    ]);
  });

  test("... also Hong Kong's 0x0C04 (the low word is not 0x0404: the x of the composition caret, 6)", () => {
    const s = windowed({ hkl: 0xc04 });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, -11, 66, 6], PACKED.candWin),
      text("AB#B", [39, 9, 77, 26], -1, F.cand),
      fill([34, -11, 46, 6], PACKED.candSelBk),
      text("B#B", [45, 9, 57, 26], 2, F.candSel),
    ]);
  });

  test("... and 0x0404, whose IME has no id (GetImeId(0) is 0 here): the window is at the string's x without the caret's (22), whatever the caret is", () => {
    const s = windowed({ hkl: 0x404 });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([22, -11, 60, 6], PACKED.candWin),
      text("AB#B", [33, 9, 71, 26], -1, F.cand),
      fill([28, -11, 40, 6], PACKED.candSelBk),
      text("B#B", [39, 9, 51, 26], 2, F.candSel),
    ]);
  });

  test("... with a device handle in the high word the low word 0x0404 is the same", () => {
    const s = windowed({ compCaret: 2, hkl: 0xe0010404 });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([22, -11, 60, 6], PACKED.candWin),
      text("AB#B", [33, 9, 71, 26], -1, F.cand),
      fill([28, -11, 40, 6], PACKED.candSelBk),
      text("B#B", [39, 9, 51, 26], 2, F.candSel),
    ]);
  });

  test("a Japanese layout (primary language 0x11: 0x0411) hangs the window from the first character of the target clause (2: x 13) and not from the composition caret (3: x 19)", () => {
    const s = windowed({ comp: "ABAB", compCaret: 3, hkl: 0x411, firstTarget: 2 });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([35, 30, 73, 47], PACKED.candWin),
      text("AB#B", [46, 50, 84, 67], -1, F.cand),
      fill([41, 30, 53, 47], PACKED.candSelBk),
      text("B#B", [52, 50, 64, 67], 2, F.candSel),
    ]);
  });

  test("... any other layout from the composition caret (3: x 19); the Korean 0x0412 too", () => {
    const s = windowed({ comp: "ABAB", compCaret: 3, hkl: 0x412, firstTarget: 2 });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([41, 30, 79, 47], PACKED.candWin),
      text("AB#B", [52, 50, 90, 67], -1, F.cand),
      fill([47, 30, 59, 47], PACKED.candSelBk),
      text("B#B", [58, 50, 70, 67], 2, F.candSel),
    ]);
  });

  test("a window beyond the right side of the view port (66 > 60) is moved back to end there: 22 .. 60", () => {
    const s = windowed({ view: [60, 1536] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([22, 30, 60, 47], PACKED.candWin),
      text("AB#B", [33, 50, 71, 67], -1, F.cand),
      fill([28, 30, 40, 47], PACKED.candSelBk),
      text("B#B", [39, 50, 51, 67], 2, F.candSel),
    ]);
  });

  test("... one that ends at the right side (66 on 66) is not moved", () => {
    const s = windowed({ view: [66, 1536] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 30, 66, 47], PACKED.candWin),
      text("AB#B", [39, 50, 77, 67], -1, F.cand),
      fill([34, 30, 46, 47], PACKED.candSelBk),
      text("B#B", [45, 50, 57, 67], 2, F.candSel),
    ]);
  });

  test("a window beyond the bottom of the view port (47 > 40) is tried above the string (6 - 17 = -11): that is above the view port (< 0), so it is put at the string's end (the composition caret's trailing edge, 22 + 6 = 28) at the top of the view port: 28, 0, 66, 17", () => {
    const s = windowed({ view: [1536, 40] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 0, 66, 17], PACKED.candWin),
      text("AB#B", [39, 20, 77, 37], -1, F.cand),
      fill([34, 0, 46, 17], PACKED.candSelBk),
      text("B#B", [45, 20, 57, 37], 2, F.candSel),
    ]);
  });

  test("... above the string when that is inside the view port (the string at y 30: 13 .. 30)", () => {
    const s = windowed({ pt: [22, 30], view: [1536, 40] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 13, 66, 30], PACKED.candWin),
      text("AB#B", [39, 33, 77, 50], -1, F.cand),
      fill([34, 13, 46, 30], PACKED.candSelBk),
      text("B#B", [45, 33, 57, 50], 2, F.candSel),
    ]);
  });

  test("... and moved back from the right side there too (66 > 60: 22 .. 60)", () => {
    const s = windowed({ pt: [22, 30], view: [60, 40] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([22, 13, 60, 30], PACKED.candWin),
      text("AB#B", [33, 33, 71, 50], -1, F.cand),
      fill([28, 13, 40, 30], PACKED.candSelBk),
      text("B#B", [39, 33, 51, 50], 2, F.candSel),
    ]);
  });

  test("... a window whose top is 0 above the string is inside the view port (17 high, at y 17)", () => {
    const s = windowed({ pt: [22, 17], view: [1536, 40] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 0, 66, 17], PACKED.candWin),
      text("AB#B", [39, 20, 77, 37], -1, F.cand),
      fill([34, 0, 46, 17], PACKED.candSelBk),
      text("B#B", [45, 20, 57, 37], 2, F.candSel),
    ]);
  });

  test("... a window that ends at the bottom of the view port (47) is not moved", () => {
    const s = windowed({ view: [1536, 47] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 30, 66, 47], PACKED.candWin),
      text("AB#B", [39, 50, 77, 67], -1, F.cand),
      fill([34, 30, 46, 47], PACKED.candSelBk),
      text("B#B", [45, 50, 57, 67], 2, F.candSel),
    ]);
  });

  test("... with the view port a pixel lower (46) it is (47 > 46): above the string that is above the view port, so at the string's end at the top", () => {
    const s = windowed({ view: [1536, 46] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 0, 66, 17], PACKED.candWin),
      text("AB#B", [39, 20, 77, 37], -1, F.cand),
      fill([34, 0, 46, 17], PACKED.candSelBk),
      text("B#B", [45, 20, 57, 37], 2, F.candSel),
    ]);
  });

  test("... at the string's end (28 .. 66) that is beyond the right side of the view port (60) is not taken: the window goes to the left of the string's x, at the top: 28 - 38 = -10 .. 28", () => {
    const s = windowed({ view: [60, 40] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([-10, 0, 28, 17], PACKED.candWin),
      text("AB#B", [1, 20, 39, 37], -1, F.cand),
      fill([-4, 0, 8, 17], PACKED.candSelBk),
      text("B#B", [7, 20, 19, 37], 2, F.candSel),
    ]);
  });

  test("... at the string's end that ends at the right side (66 on 66) is taken", () => {
    const s = windowed({ view: [66, 40] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 0, 66, 17], PACKED.candWin),
      text("AB#B", [39, 20, 77, 37], -1, F.cand),
      fill([34, 0, 46, 17], PACKED.candSelBk),
      text("B#B", [45, 20, 57, 37], 2, F.candSel),
    ]);
  });

  test("... the left of the string that ends below 0 is put at the view port's left side (0 .. 38): a Japanese layout (the x from the first target: 0) with the string at -10 and the composition caret at the end of ABABAB (x 40)", () => {
    const s = windowed({ comp: "ABABAB", compCaret: 6, pt: [-10, 6], hkl: 0x411, view: [60, 40] });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([0, 0, 38, 17], PACKED.candWin),
      text("AB#B", [11, 20, 49, 37], -1, F.cand),
      fill([6, 0, 18, 17], PACKED.candSelBk),
      text("B#B", [17, 20, 29, 37], 2, F.candSel),
    ]);
  });

  test("a column that is beyond the bottom is moved above the string as a whole (10 rows, 170 high): at y 6 that is above the view port, at the string's end at the top", () => {
    const s = windowed({ view: [1536, 40] });
    s.cand.awszCandidate.splice(0, 3, "A", "AB", "#");
    s.cand.dwSelection = 1;
    s.ime.s_bVerticalCand = true;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 0, 48, 170], PACKED.candWin),
      text("A", [39, 20, 59, 37], -1, F.cand),
      fill([28, 17, 48, 34], PACKED.candSelBk),
      text("AB", [39, 37, 59, 54], -1, F.candSel),
      text("#", [39, 54, 59, 71], -1, F.cand),
      text("", [39, 71, 59, 88], -1, F.cand),
      text("", [39, 88, 59, 105], -1, F.cand),
      text("", [39, 105, 59, 122], -1, F.cand),
      text("", [39, 122, 59, 139], -1, F.cand),
      text("", [39, 139, 59, 156], -1, F.cand),
      text("", [39, 156, 59, 173], -1, F.cand),
      text("", [39, 173, 59, 190], -1, F.cand),
    ]);
  });

  test("a column is as wide as its widest row (11: A and B on two lines, the widest line) and every row as high as the highest (34: two lines of 17), the window 10 of them (340) high; every row drawn in that height", () => {
    const s = windowed();
    s.cand.awszCandidate.splice(0, 3, "A", "A\nB", "#");
    s.cand.dwSelection = 1;
    s.ime.s_bVerticalCand = true;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 30, 39, 370], PACKED.candWin),
      text("A", [39, 50, 50, 84], -1, F.cand),
      fill([28, 64, 39, 98], PACKED.candSelBk),
      text("A\nB", [39, 84, 50, 118], -1, F.candSel),
      text("#", [39, 118, 50, 152], -1, F.cand),
      text("", [39, 152, 50, 186], -1, F.cand),
      text("", [39, 186, 50, 220], -1, F.cand),
      text("", [39, 220, 50, 254], -1, F.cand),
      text("", [39, 254, 50, 288], -1, F.cand),
      text("", [39, 288, 50, 322], -1, F.cand),
      text("", [39, 322, 50, 356], -1, F.cand),
      text("", [39, 356, 50, 390], -1, F.cand),
    ]);
  });

  test("... with the default alignment 0x20 (one line: 17 high) the rows are measured at 17 and the text is drawn in 0x20 (the box's own text fits)", () => {
    const s = windowed();
    s.cand.awszCandidate.splice(0, 3, "A", "A\nB", "#");
    s.cand.dwSelection = 1;
    s.ime.s_bVerticalCand = true;
    s.e.m_DefTextAlign = 0x20;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 30, 39, 200], PACKED.candWin),
      text("A", [39, 50, 50, 67], -1, F.cand, 32),
      fill([28, 47, 39, 64], PACKED.candSelBk),
      text("A\nB", [39, 67, 50, 84], -1, F.candSel, 32),
      text("#", [39, 84, 50, 101], -1, F.cand, 32),
      text("", [39, 101, 50, 118], -1, F.cand, 32),
      text("", [39, 118, 50, 135], -1, F.cand, 32),
      text("", [39, 135, 50, 152], -1, F.cand, 32),
      text("", [39, 152, 50, 169], -1, F.cand, 32),
      text("", [39, 169, 50, 186], -1, F.cand, 32),
      text("", [39, 186, 50, 203], -1, F.cand, 32),
      text("", [39, 203, 50, 220], -1, F.cand, 32),
    ]);
  });

  test("the candidates are measured up to the first empty one only (the ones after it are drawn but not measured), with the format 0x404 or the box's default alignment while the box's own text fits (0x21 here)", () => {
    const s = windowed();
    s.ime.s_bVerticalCand = true;
    s.cand.awszCandidate.splice(0, 4, "A", "AB", "", "XYZ");
    const calls = measures(s);
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(calls).toEqual([["A", -1, 0x404], ["AB", -1, 0x404]]);
    expect(s.events.filter((ev) => ev.k === "text").map((ev) => (ev as Ev & { k: "text" }).text)).toEqual(["A", "AB", "", "XYZ", "", "", "", "", "", ""]);
    calls.length = 0;
    s.e.m_DefTextAlign = 0x21;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(calls).toEqual([["A", -1, 0x21], ["AB", -1, 0x21]]);
    s.e.m_rcText.right = s.e.m_rcText.left + 17;
    calls.length = 0;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(calls).toEqual([["A", -1, 0x404], ["AB", -1, 0x404]]);
  });

  test("a line is measured as a whole with the format 0x404 (the box's CalcTextRect: the default alignment instead while it fits)", () => {
    const s = windowed();
    s.cand.HoriCand.SetText("AB#B");
    const calls = measures(s);
    s.e.RenderCandidateReadingWindow(null, 0, false);
    s.ime.s_bHorizontalReading = true;
    s.ime.s_wszReadingString = "AB";
    s.e.RenderCandidateReadingWindow(null, 0, true);
    s.e.m_DefTextAlign = 0x21;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(calls).toEqual([["AB#B", -1, 0x404], ["AB", -1, 0x404], ["AB#B", -1, 0x21]]);
  });

  test("the box is asked for the x of the composition caret (and of its first visible character); a Taiwan layout without an IME id asks the composition string for nothing", () => {
    const s = windowed({ comp: "ABAB", compCaret: 3, firstTarget: 2 });
    const b = s.ime.s_CompString;
    const asked: number[] = [];
    const real = b.CPtoX.bind(b);
    b.CPtoX = ((cp: number, trail: boolean) => {
      asked.push(cp);
      return real(cp, trail);
    }) as typeof b.CPtoX;
    s.cand.HoriCand.SetText("AB#B");
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(asked).toEqual([3]);
    asked.length = 0;
    s.ime.s_hklCurrent = 0x411;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(asked).toEqual([2]);
    asked.length = 0;
    s.ime.s_hklCurrent = 0x404;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(asked).toEqual([]);
    // the layout that is beyond the bottom asks for the trailing edge of the caret too
    s.ime.s_hklCurrent = 0x412;
    s.w.render!.viewport.height = 40;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(asked).toEqual([3, 3]);
  });

  test("a box without a font measures a line of text it has to show: an Error (the exe calls CalcTextRect through a null pointer)", () => {
    const s = windowed();
    s.cand.HoriCand.SetText("AB#B");
    s.e.m_pFont = null;
    expect(() => s.e.RenderCandidateReadingWindow(null, 0, false)).toThrow(/no font/);
  });

  test("the box's own buffer is asked for the x of its caret and then of its first visible character, and the window does not depend on the answers (the exe's calls)", () => {
    const s = windowed();
    s.cand.HoriCand.SetText("AB#B");
    const b = s.e.m_Buffer;
    const asked: [number, boolean][] = [];
    const real = b.CPtoX.bind(b);
    b.CPtoX = ((cp: number, trail: boolean) => {
      asked.push([cp, trail]);
      return real(cp, trail);
    }) as typeof b.CPtoX;
    s.e.m_nCaret = 2;
    s.e.m_nFirstVisible = 1;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(asked).toEqual([[2, false], [1, false]]);
    expect(s.events[0]).toEqual(fill([28, 30, 66, 47], PACKED.candWin));
  });

  test("a layout whose low word is 0x0405 is neither Taiwan's (0x0404: no x) nor Chinese (the primary language is 5, not 4: above the string): the window is below the string at the x of the composition caret, 28", () => {
    const s = windowed({ hkl: 0x405 });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 30, 66, 47], PACKED.candWin),
      text("AB#B", [39, 50, 77, 67], -1, F.cand),
      fill([34, 30, 46, 47], PACKED.candSelBk),
      text("B#B", [45, 50, 57, 67], 2, F.candSel),
    ]);
  });

  test("a Taiwan layout (0x0404) whose IME has an id (GetImeId(0) is 5: the cache of the layout holds it) hangs the window from the composition caret like the others (22 + 6 = 28), above the string (the primary language is 4): -11 .. 6", () => {
    const s = windowed({ hkl: 0x404 });
    s.ime["hklPrev"] = 0x404;
    s.ime["dwID"][0] = 5;
    expect(s.ime.getImeId(0)).toBe(5);
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, -11, 66, 6], PACKED.candWin),
      text("AB#B", [39, 9, 77, 26], -1, F.cand),
      fill([34, -11, 46, 6], PACKED.candSelBk),
      text("B#B", [45, 9, 57, 26], 2, F.candSel),
    ]);
  });

  test("... a window whose top is 0 above the string is inside the view port also when the string's trailing edge is not where the window goes: a Japanese layout (the first target at 0: x 22; the composition caret's trailing edge is at 28) puts it at 22", () => {
    const s = windowed({ pt: [22, 17], view: [1536, 40], hkl: 0x411 });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([22, 0, 60, 17], PACKED.candWin),
      text("AB#B", [33, 20, 71, 37], -1, F.cand),
      fill([28, 0, 40, 17], PACKED.candSelBk),
      text("B#B", [39, 20, 51, 37], 2, F.candSel),
    ]);
  });

  test("... a window to the left of the string that ends at exactly 0 stays there (-38 .. 0): a Japanese layout, the string at x 0 in a view port 30 wide and 20 high (below: 47 > 20; above: -11 < 0; at the trailing edge, 6 .. 44: beyond 30)", () => {
    const s = windowed({ pt: [0, 6], view: [30, 20], hkl: 0x411 });
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([-38, 0, 0, 17], PACKED.candWin),
      text("AB#B", [-27, 20, 11, 37], -1, F.cand),
      fill([-32, 0, -20, 17], PACKED.candSelBk),
      text("B#B", [-21, 20, -9, 37], 2, F.candSel),
    ]);
  });

  test("a column of candidates without a first one has no width and no height: the window is the empty rectangle at the string (28, 30), the ten rows of no height are drawn, the selected one (0) over a rectangle of the selection's colours", () => {
    const s = windowed();
    s.ime.s_bVerticalCand = true;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 30, 28, 30], PACKED.candWin),
      fill([28, 30, 28, 30], PACKED.candSelBk),
      text("", [39, 50, 39, 50], -1, F.candSel),
      ...Array.from({ length: 9 }, () => text("", [39, 50, 39, 50], -1, F.cand)),
    ]);
  });

  test("a column of ten candidates is measured to the tenth (the widest is the last, BBB: 33): ten rows of 17 under the string, the window 33 wide and 170 high, the row of the selection (3) over a rectangle of the selection's colours", () => {
    const s = windowed();
    s.ime.s_bVerticalCand = true;
    s.cand.awszCandidate.splice(0, 10, "A", "B", "#", "AB", "BA", "A#", "B#", "AAA", "###", "BBB");
    s.cand.dwSelection = 3;
    s.e.RenderCandidateReadingWindow(null, 0, false);
    expect(s.events).toEqual([
      fill([28, 30, 61, 200], PACKED.candWin),
      text("A", [39, 50, 72, 67], -1, F.cand),
      text("B", [39, 67, 72, 84], -1, F.cand),
      text("#", [39, 84, 72, 101], -1, F.cand),
      fill([28, 81, 61, 98], PACKED.candSelBk),
      text("AB", [39, 101, 72, 118], -1, F.candSel),
      text("BA", [39, 118, 72, 135], -1, F.cand),
      text("A#", [39, 135, 72, 152], -1, F.cand),
      text("B#", [39, 152, 72, 169], -1, F.cand),
      text("AAA", [39, 169, 72, 186], -1, F.cand),
      text("###", [39, 186, 72, 203], -1, F.cand),
      text("BBB", [39, 203, 72, 220], -1, F.cand),
    ]);
    expect([s.cand.rcCandidate.left, s.cand.rcCandidate.top, s.cand.rcCandidate.right, s.cand.rcCandidate.bottom]).toEqual([28, 30, 61, 200]);
  });

  test("a world without a device has the exe's view port, 1024 x 768 (and scale 1: the x of the composition caret is 9): a window ending at 1025 is pulled back to end at 1024 and one ending at 1024 is not; one whose bottom is 769 is put above the string and one whose bottom is 768 is not", () => {
    const s = windowed({ device: false });
    expect(s.w.render).toBe(null);
    s.cand.HoriCand.SetText("AB#B");
    s.cand.nFirstSelected = 1;
    s.cand.nHoriSelectedLen = 2;
    const at = (x: number, y: number): Ev[] => {
      s.ime.s_ptCompString.x = x;
      s.ime.s_ptCompString.y = y;
      s.events.length = 0;
      s.e.RenderCandidateReadingWindow(null, 0, false);
      return s.events.slice();
    };
    // the right side: 978 + 9 + 38 = 1025, 977 + 9 + 38 = 1024
    const right = [
      fill([986, 30, 1024, 47], PACKED.candWin),
      text("AB#B", [997, 50, 1035, 67], -1, F.cand),
      fill([995, 30, 1013, 47], PACKED.candSelBk),
      text("B#B", [1006, 50, 1024, 67], 2, F.candSel),
    ];
    expect(at(978, 6)).toEqual(right);
    expect(at(977, 6)).toEqual(right);
    // the bottom: 728 + 24 + 17 = 769 (above: 711 .. 728), 727 + 24 + 17 = 768 (stays: 751 .. 768)
    expect(at(22, 728)).toEqual([
      fill([31, 711, 69, 728], PACKED.candWin),
      text("AB#B", [42, 731, 80, 748], -1, F.cand),
      fill([40, 711, 58, 728], PACKED.candSelBk),
      text("B#B", [51, 731, 69, 748], 2, F.candSel),
    ]);
    expect(at(22, 727)).toEqual([
      fill([31, 751, 69, 768], PACKED.candWin),
      text("AB#B", [42, 771, 80, 788], -1, F.cand),
      fill([40, 751, 58, 768], PACKED.candSelBk),
      text("B#B", [51, 771, 69, 788], 2, F.candSel),
    ]);
  });

});

describe("the statics of the IME", () => {
  test("GetImeId (32936EA0) is 0 for a window without an IME, whatever the layout and for either index; an index of 2 or more is 0 at once (an unsigned compare: -1 too)", () => {
    const ime = scene("").w.ime;
    for (const hkl of [0, 0x0404, 0xe0010404, 0x0804, 0x0c04, 0x0411, 0xf0010404]) {
      ime.s_hklCurrent = hkl;
      expect([ime.getImeId(0), ime.getImeId(1), ime.getImeId(2), ime.getImeId(3), ime.getImeId(1000), ime.getImeId(-1)]).toEqual([0, 0, 0, 0, 0, 0]);
    }
  });

  test("GetImeId keeps the two ids it has for the layout it was asked about last and clears both when the layout changes (whichever index is asked first), remembering the new layout: the same layout answers them (an index of 2 or more is 0)", () => {
    const ime = scene("").w.ime;
    ime.s_hklCurrent = 0x0404;
    ime["hklPrev"] = 0x0404;
    ime["dwID"][0] = 7;
    ime["dwID"][1] = 9;
    expect([ime.getImeId(0), ime.getImeId(1), ime.getImeId(2), ime.getImeId(3), ime.getImeId(-1)]).toEqual([7, 9, 0, 0, 0]);
    expect([ime["hklPrev"], ime["dwID"][0], ime["dwID"][1]]).toEqual([0x0404, 7, 9]);
    // another layout, index 1 asked first: both ids go and the layout is the one remembered ...
    ime.s_hklCurrent = 0x0804;
    expect(ime.getImeId(1)).toBe(0);
    expect([ime["hklPrev"], ime["dwID"][0], ime["dwID"][1]]).toEqual([0x0804, 0, 0]);
    // ... so what is found for it afterwards stays
    ime["dwID"][0] = 5;
    ime["dwID"][1] = 6;
    expect([ime.getImeId(0), ime.getImeId(1)]).toEqual([5, 6]);
    // a third layout, index 0 asked first
    ime.s_hklCurrent = 0x0c04;
    expect(ime.getImeId(0)).toBe(0);
    expect([ime["hklPrev"], ime["dwID"][0], ime["dwID"][1]]).toEqual([0x0c04, 0, 0]);
  });

  test("the statics start as the exe's (no layout, nothing vertical, no reading, no candidates, the composition caret at 0), and each world has its own", () => {
    const a = scene("").w.ime;
    const b = scene("").w.ime;
    expect(b).not.toBe(a);
    expect([a.s_hklCurrent, a.s_bVerticalCand, a.s_bShowReadingWindow, a.s_bHorizontalReading, a.s_nCompCaret, a.s_nFirstTargetConv]).toEqual([0, false, false, false, 0, 0]);
    expect([a.s_ptCompString.x, a.s_ptCompString.y, a.s_wszReadingString, a.s_abCompStringAttr.length]).toEqual([0, 0, "", 256]);
    expect([a.s_CandList.bShowWindow, a.s_CandList.dwCount, a.s_CandList.dwSelection, a.s_CandList.dwPageSize, a.s_CandList.nFirstSelected, a.s_CandList.nHoriSelectedLen, a.s_CandList.awszCandidate.length]).toEqual([false, 0, 0, 0, 0, 0, 10]);
  });
});

describe("CKTDGUIIMEEditBox::PlaceCaret (32939B50)", () => {
  // "ABABAB" (6 characters); the text rectangle 4 .. 28 is 24 wide.  The buffer is a stand-in whose x is 8 a character and whose trailing edge is 3 (or
  // `trail`) further: the exe's own `CPtoX` does not look at the trail, so only the calls and the decisions are what these tests pin down.
  const boxed = () => {
    const s = scene("ABABAB");
    s.e.m_rcText.right = 28;
    const b = s.e.m_Buffer;
    const asked: [number, boolean][] = [];
    const xs: number[] = [];
    const edge = { trail: 3 };
    b.CPtoX = ((cp: number, trail: boolean) => {
      asked.push([cp, trail]);
      return cp * 8 + (trail ? edge.trail : 0);
    }) as typeof b.CPtoX;
    b.XtoCP = ((x: number) => {
      xs.push(x);
      return { cp: Math.floor(x / 8), trail: 0 };
    }) as typeof b.XtoCP;
    return { ...s, asked, xs, edge };
  };

  test("the caret is stored; the buffer is asked for the x of the first visible character, of the caret and of the caret's trailing edge, in this order", () => {
    const s = boxed();
    s.e.PlaceCaret(2); // x 16, trailing 19: inside the 24 pixels, so XtoCP is not asked
    expect([s.e.m_nCaret, s.e.m_nFirstVisible, s.xs]).toEqual([2, 0, []]);
    expect(s.asked).toEqual([[0, false], [2, false], [2, true]]);
  });

  test("past the right side: the new first x is the trailing x + left - right (35 + 4 - 28 = 11); the first character that ends at it is 1, whose x 8 is short of 11: 2", () => {
    const s = boxed();
    s.e.PlaceCaret(4); // x 32, trailing 35 > 0 + 24
    expect(s.e.m_nFirstVisible).toBe(2);
    expect(s.xs).toEqual([11]);
    expect(s.asked).toEqual([[0, false], [4, false], [4, true], [1, false]]);
  });

  test("an x that is hit exactly stays (first = XtoCP, not one more): caret 5 with no trailing edge, x 40 > 24: 40 + 4 - 28 = 16; XtoCP 2, its x 16 is not short of 16", () => {
    const s = boxed();
    s.edge.trail = 0;
    s.e.PlaceCaret(5);
    expect(s.e.m_nFirstVisible).toBe(2);
    expect(s.xs).toEqual([16]);
    expect(s.asked).toEqual([[0, false], [5, false], [5, true], [2, false]]);
  });

  test("the end of the text (6) asks for no trailing edge: its x 48 decides, 48 + 4 - 28 = 24, XtoCP 3 whose x 24 is hit exactly: 3 (with the trailing edge it would be 51: 27, XtoCP 3, 24 < 27: 4)", () => {
    const s = boxed();
    s.e.PlaceCaret(6);
    expect([s.e.m_nCaret, s.e.m_nFirstVisible]).toEqual([6, 3]);
    expect(s.xs).toEqual([24]);
    expect(s.asked).toEqual([[0, false], [6, false], [3, false]]);
  });

  test("the trailing edge scrolls only past the right side counted from the first visible character's x: first 2 (x 16), the edge at 40 = 16 + 24 stays, 41 scrolls (XtoCP of 41 + 4 - 28 = 17 is 2, whose x 16 is short: 3)", () => {
    const s = boxed();
    s.edge.trail = 0;
    s.e.m_nFirstVisible = 2;
    s.e.PlaceCaret(5); // x 40 and its trailing edge 40: not past 16 + 24
    expect([s.e.m_nFirstVisible, s.xs]).toEqual([2, []]);
    s.edge.trail = 1;
    s.e.PlaceCaret(5);
    expect([s.e.m_nFirstVisible, s.xs]).toEqual([3, [17]]);
  });

  test("the trailing edge, not the caret's x, decides whether to scroll: caret 3 (x 24) with the edge at 27 > 24 scrolls: XtoCP of 27 + 4 - 28 = 3 is 0, whose x 0 is short: 1", () => {
    const s = boxed();
    s.e.PlaceCaret(3);
    expect(s.e.m_nFirstVisible).toBe(1);
    expect(s.xs).toEqual([3]);
  });

  test("left of the first visible character the first visible character is the caret (the buffer is not asked for more); at it, it stays", () => {
    const s = boxed();
    s.e.m_nFirstVisible = 4;
    s.e.PlaceCaret(1);
    expect([s.e.m_nCaret, s.e.m_nFirstVisible, s.xs]).toEqual([1, 1, []]);
    s.e.m_nFirstVisible = 4;
    s.e.PlaceCaret(4);
    expect(s.e.m_nFirstVisible).toBe(4);
  });

  test("a caret whose x is the first visible character's x is not left of it: nothing moves the first visible character (every x is equal here, XtoCP is never asked)", () => {
    const s = boxed();
    s.e.m_Buffer.CPtoX = (() => 0) as typeof s.e.m_Buffer.CPtoX;
    s.e.m_nFirstVisible = 4;
    s.e.PlaceCaret(1);
    expect([s.e.m_nCaret, s.e.m_nFirstVisible, s.xs]).toEqual([1, 4, []]);
  });
});
