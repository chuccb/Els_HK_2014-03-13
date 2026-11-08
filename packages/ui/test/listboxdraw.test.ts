/**
 * The drawing of the list box: `CKTDGUIListBox::OnFrameRender` (32943BA0).  Three UK fonts with a glyph font each, whose drawing calls are
 * written down: id 2 (size 8 enlarged twice: a line of text is 16 / 2 + 1 = 9 high) is the dialog manager's font that the string data names and
 * so sets the height of a row, id 3 (size 10: 11 high, so a test sees when its line is taken by mistake) is `m_pUKFont` that draws the text of
 * a row and id 4 is `m_pGroupUKFont` that draws the text of a group row.  Every number is worked out from the decompile.
 *
 * The world is 1024 x 768 (not scaled; the mouse tests also use 1536 x 1536 = (1.5, 2)), the scene of stringspy.ts puts the dialog at
 * (10.25, 20.5) and the control at the offset (0.75, 0.25): a quad at (x, y) of the layout is drawn at (x + 11, y + 20) (10.25 + 0.75 = 11 and
 * 20.5 + 0.25 = 20.75, cut to a pixel), a string whose place is the corner (x, y) of a row is spoken at (x + 11, y + 20) as well.
 *
 * The rectangles of the box: bounding box (100, 50, 300, 170), selection (106, 56, 278, 164), text (111, 56, 273, 164): 108 high, so 12 rows of
 * 9 fit exactly; the box is at (100, 50), 200 wide; its scroll bar is 16 wide.  Row k is at the top 56 + 9k, so its text is spoken at
 * (122, 76 + 9k) (111 + 11, and 56 + 9k + 20: 20.75 cut) and its highlight is drawn from (117, 76 + 9k) to (305, 85 + 9k) (the selection's right
 * 278 + 16 + 11).
 */
import { describe, expect, test } from "bun:test";
import { CKTDGUIControl, CKTDGUIDialog, CKTDGUIListBox, CKTDGUIScrollBar, LBIT, UIMouse, setRect } from "../src/index.ts";
import { Color } from "@els/host";
import { fontWorld } from "./fontworld.ts";
import { drawnQuads, quad } from "./rig.ts";
import type { Recorder } from "./rig.ts";
import { COLOR, OUTLINE, data, place, spied } from "./stringspy.ts";
import type { Call } from "./stringspy.ts";

/** how many primitives the device was asked to draw in the first `n` lines of its log */
const draws = (dev: Recorder, n: number): number => dev.log.slice(0, n).filter((l) => l.startsWith("draw ")).length;

/** a control that writes down the offset it was drawn at, and how many primitives had been drawn by then */
class Probe extends CKTDGUIControl {
  readonly seen: [number, number][] = [];
  readonly after: number[] = [];
  stamp: () => number = () => 0;
  override onFrameRender(): number {
    this.seen.push([this.m_OffsetPos.x, this.m_OffsetPos.y]);
    this.after.push(this.stamp());
    return 0;
  }
}

/** the 0.8f of the call, as the float it is */
const LS = 0.800000011920929;
/** `OutTextMultiline(x, y, text, colour, style, outline, 0.8f, no rectangle, 0, all, 1, 1)` */
const rowText = (text: string, x: number, y: number, color = COLOR, style = 2, outline = OUTLINE) => [x, y, text, color, style, outline, LS, null, 0, -1, 1, 1];
/** the colours of the group string data of the scene: (0.8, 0.5, 0.25, 0.6) and the outline (0.3, 0.2, 0.1, 0.9) */
const GROUP_COLOR = 0x565c3911;
const GROUP_OUTLINE = 0x81221707;

function scene(back = { width: 1024, height: 768 }) {
  const s = fontWorld({}, { device: true, backBuffer: back });
  const { w, dev } = s;
  const rowCalls: Call[] = [];
  const calls: Call[] = [];
  const groupCalls: Call[] = [];
  spied(dev!, w.fonts, 2, rowCalls, s.font(8, 0, 2, true, true));
  const textFont = spied(dev!, w.fonts, 3, calls, s.font(10, 0, 2, true, true));
  const groupFont = spied(dev!, w.fonts, 4, groupCalls, s.font(10, 0, 2, true, true));
  const dialog = new CKTDGUIDialog(w);
  const box = new CKTDGUIListBox(w);
  place(dialog, box);
  setRect(box.m_rcBoundingBox, 100, 50, 300, 170);
  setRect(box.m_rcSelection, 106, 56, 278, 164);
  setRect(box.m_rcText, 111, 56, 273, 164);
  box.m_x = 100;
  box.m_y = 50;
  box.m_width = 200;
  box.m_height = 120;
  const tex = (name: string) => quad(w, 0, 0, name).pUITextureData!;
  box.m_pBoudingBoxTex = tex("BOX.TGA");
  box.m_pTextTex = tex("TEXT.TGA");
  box.m_pButtonMouseOverTex = tex("OVER.TGA");
  box.m_pStringData = data("");
  box.m_pUKFont = textFont;
  box.m_pGroupUKFont = groupFont;
  const g = data("", { fontIndex: 4, fontStyle: 3 });
  g.color.set(0.8, 0.5, 0.25, 0.6);
  g.outlineColor.set(0.3, 0.2, 0.1, 0.9);
  box.m_pGroupStringData = g;
  dev!.log.length = 0;
  const bar = () => {
    const b = new CKTDGUIScrollBar(w);
    b.m_width = 16;
    box.m_pScrollBar = b;
    return b;
  };
  /** n rows Row0, Row1, ... (the box's `AddItem`) */
  const rows = (n: number, from = 0) => {
    for (let k = 0; k < n; k++) box.addItem(`Row${from + k}`, null, 0, LBIT.DEFAULT, false, 0);
    return box.m_Items;
  };
  const probe = () => {
    const p = new Probe(w);
    p.stamp = () => draws(dev!, dev!.log.length);
    return p;
  };
  return { ...s, dev: dev!, rowCalls, calls, groupCalls, dialog, box, bar, rows, probe, tex };
}

type R4 = [number, number, number, number];
/** the bounding box at (100, 50) to (300, 170) of the layout */
const BOX: R4 = [111, 70, 311, 190];
/** the highlight of row k: 278 + 16 per highlighted row so far (+ 11) to the right unless the row is a mega row (the box's 300, 311) */
const hl = (k: number, right = 305): R4 => [117, 76 + 9 * k, right, 85 + 9 * k];
const names = (calls: Call[]) => calls.map((c) => c.args[2]);

describe("OnFrameRender (32943BA0): what a box draws, and when", () => {
  test("a shown box draws its bounding box, its rows (the text of m_pUKFont; the rows are as high as the dialog manager's font) and its scroll bar, in that order", () => {
    const t = scene();
    const b = t.bar();
    t.rows(3);
    let barAfter = -1;
    b.onFrameRender = () => {
      barAfter = t.calls.length;
      return 0;
    };
    expect(t.box.onFrameRender()).toBe(0);
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }]);
    expect(t.calls.map((c) => [c.method, c.args])).toEqual([0, 1, 2].map((k) => ["OutTextMultiline", rowText(`Row${k}`, 122, 76 + 9 * k)]));
    expect(t.calls.map((c) => draws(t.dev, c.log))).toEqual([1, 1, 1]);
    expect(barAfter).toBe(3);
    // the line of m_pUKFont is 11: it is not what the rows are made of
    expect(t.box.m_nTextHeight).toBe(9);
    expect(t.rowCalls).toEqual([]);
    expect(t.groupCalls).toEqual([]);
  });

  test("a hidden box draws nothing, and does not use up the first-box rule", () => {
    const t = scene();
    const b = t.bar();
    t.rows(2);
    t.box.m_bShow = false;
    let barDrawn = 0;
    b.onFrameRender = () => {
      barDrawn++;
      return 0;
    };
    expect(t.box.onFrameRender()).toBe(0);
    expect(t.dev.log).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(barDrawn).toBe(0);
    expect(t.w.statics.bSBInit_0).toBe(false);
    expect(b.m_nPageSize).toBe(1);
    expect(t.box.m_nTextHeight).toBe(0);
  });

  test("a box without string data is the exe's null dereference: it throws before anything is drawn", () => {
    const t = scene();
    t.bar();
    t.rows(2);
    t.box.m_pStringData = null;
    expect(() => t.box.onFrameRender()).toThrow(/no string data/);
    expect(t.dev.log).toEqual([]);
  });

  test("a font index nobody made: a message box (string 954 the text, 955 the caption), and nothing is drawn, not even the bounding box", () => {
    const t = scene();
    (t.w.strings as unknown as { strings: string[] }).strings = Array.from({ length: 956 }, (_, i) => (i === 954 ? "NO FONT" : i === 955 ? "LIST BOX" : ""));
    const b = t.bar();
    t.rows(2);
    t.box.m_pStringData = data("", { fontIndex: 9 });
    let barDrawn = 0;
    b.onFrameRender = () => {
      barDrawn++;
      return 0;
    };
    expect(t.box.onFrameRender()).toBe(0);
    expect(t.w.messageBoxes).toEqual([{ text: "NO FONT", caption: "LIST BOX" }]);
    expect(t.dev.log).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(barDrawn).toBe(0);
    expect(t.w.statics.bSBInit_0).toBe(false);
    // a second frame asks again
    t.box.onFrameRender();
    expect(t.w.messageBoxes.length).toBe(2);
  });

  test("without a scroll bar no row is drawn at all (the rows are inside the bar's branch), but the first-box flag is used up and the row height is set", () => {
    const t = scene();
    t.rows(3);
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }]);
    expect(t.calls).toEqual([]);
    expect(t.w.statics.bSBInit_0).toBe(true);
    expect(t.box.m_nTextHeight).toBe(9);
  });

  test("an empty box draws its bounding box and its bar; with no row the flag is not used up and the row height is not set", () => {
    const t = scene();
    const b = t.bar();
    let barDrawn = 0;
    b.onFrameRender = () => {
      barDrawn++;
      return 0;
    };
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }]);
    expect(barDrawn).toBe(1);
    expect(t.w.statics.bSBInit_0).toBe(false);
    expect(t.box.m_nTextHeight).toBe(0);
    expect(b.m_nPageSize).toBe(1);
  });

  test("a box without a bounding-box texture draws the point as it was left: nothing at first, then the texture of the last quad drawn", () => {
    const t = scene();
    t.bar();
    t.rows(3);
    t.w.statics.bSBInit_0 = true;
    t.box.m_nSelected = 1;
    t.box.m_pBoudingBoxTex = null;
    t.box.onFrameRender();
    // no texture yet: RenderVertex draws nothing for the bounding box; the highlight has its own
    expect(drawnQuads(t.dev)).toEqual([{ texture: "TEXT.TGA", rect: hl(1) }]);
    const from = t.dev.log.length;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev, from)).toEqual([{ texture: "TEXT.TGA", rect: BOX }, { texture: "TEXT.TGA", rect: hl(1) }]);
  });
});

describe("OnFrameRender: the first list box that is drawn gives its scroll bar its page size (the exe's static bSBInit_0)", () => {
  function withBar() {
    const t = scene();
    const b = t.bar();
    t.rows(30);
    b.m_nPosition = 99;
    b.m_rcTrack.top = 20;
    b.m_rcTrack.bottom = 120;
    return { ...t, b };
  }

  test("the page is the text rectangle's height over the row height: 108 / 9 = 12; the bar is capped (99 to 30 - 12 = 18), its thumb made, and the rows start at the capped position", () => {
    const { box, b, w, calls } = withBar();
    box.onFrameRender();
    // the thumb: 12 * 100 / 30 = 40 high, at 20 + (100 - 40) * 18 / (30 - 12) = 80
    expect([b.m_nPageSize, b.m_nPosition, b.m_rcThumb.top, b.m_rcThumb.bottom, b.m_bShowThumb]).toEqual([12, 18, 80, 120, true]);
    expect(w.statics.bSBInit_0).toBe(true);
    expect(w.statics.bSBInit).toBe(false); // the combo box's flag is another one
    expect(names(calls)).toEqual(Array.from({ length: 12 }, (_, k) => `Row${18 + k}`));
  });

  test("a static box has m_nTextHeight (20) for the row height: 108 / 20 = 5 rows to a page; with a height of 0 the page is the whole height (no thumb)", () => {
    const t = withBar();
    t.box.m_bIsStaticListBox = true;
    t.box.m_nTextHeight = 20;
    t.box.onFrameRender();
    // the thumb: 5 * 100 / 30 = 16 high, at 20 + (100 - 16) * 25 / (30 - 5) = 104; the position 99 is capped to 30 - 5
    expect([t.b.m_nPageSize, t.b.m_nPosition, t.b.m_rcThumb.top, t.b.m_rcThumb.bottom, t.b.m_bShowThumb]).toEqual([5, 25, 104, 120, true]);
    const z = withBar();
    z.box.m_bIsStaticListBox = true;
    z.box.m_nTextHeight = 0;
    z.box.onFrameRender();
    expect([z.b.m_nPageSize, z.b.m_nPosition, z.b.m_bShowThumb]).toEqual([108, 0, false]);
    expect(z.b.m_rcThumb.bottom).toBe(z.b.m_rcThumb.top);
  });

  test("only once: the next box keeps the page size it has, and a box without a bar uses the rule up", () => {
    const first = withBar();
    first.box.onFrameRender();
    const other = new CKTDGUIListBox(first.w);
    place(first.dialog, other);
    other.m_pStringData = data("");
    const b2 = new CKTDGUIScrollBar(first.w);
    other.m_pScrollBar = b2;
    other.addItem("x", null, 0, LBIT.DEFAULT, false, 0);
    other.onFrameRender();
    expect(b2.m_nPageSize).toBe(1);
    // a box with no bar draws first: the next one, with a bar, is not given a page either
    const second = scene();
    second.rows(2);
    second.box.onFrameRender();
    expect(second.w.statics.bSBInit_0).toBe(true);
    const b3 = second.bar();
    second.box.onFrameRender();
    expect(b3.m_nPageSize).toBe(1);
  });
});

describe("OnFrameRender: which rows are drawn", () => {
  function fixed(n: number) {
    const t = scene();
    const b = t.bar();
    t.rows(n);
    t.w.statics.bSBInit_0 = true; // the page size is the tests above's
    return { ...t, b };
  }
  const placed = (calls: Call[]) => calls.map((c) => [c.args[2], c.args[1]]);

  test("from the bar's position, as many rows as fit in the text rectangle: 108 / 9 = 12; one pixel less and it is 11", () => {
    const t = fixed(20);
    t.box.onFrameRender();
    expect(placed(t.calls)).toEqual(Array.from({ length: 12 }, (_, k) => [`Row${k}`, 76 + 9 * k]));
    t.calls.length = 0;
    t.box.m_rcText.bottom = 163;
    t.box.onFrameRender();
    expect(names(t.calls)).toEqual(Array.from({ length: 11 }, (_, k) => `Row${k}`));
  });

  test("the first row is the bar's position", () => {
    const t = fixed(20);
    t.b.m_nPosition = 5;
    t.box.onFrameRender();
    expect(placed(t.calls)).toEqual(Array.from({ length: 12 }, (_, k) => [`Row${5 + k}`, 76 + 9 * k]));
  });

  test("a row that is not shown takes its place and draws nothing", () => {
    const t = fixed(20);
    t.box.m_Items[3]!.m_bShow = false;
    t.box.onFrameRender();
    expect(placed(t.calls)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => [`Row${k}`, 76 + 9 * k]));
  });

  test("fewer rows than fit: all of them; a position at or past the last row: none", () => {
    const t = fixed(3);
    t.box.onFrameRender();
    expect(placed(t.calls)).toEqual([0, 1, 2].map((k) => [`Row${k}`, 76 + 9 * k]));
    t.calls.length = 0;
    t.b.m_nPosition = 2;
    t.box.onFrameRender();
    expect(placed(t.calls)).toEqual([["Row2", 76]]);
    t.calls.length = 0;
    t.b.m_nPosition = 3;
    t.box.onFrameRender();
    expect(t.calls).toEqual([]);
    t.b.m_nPosition = 7;
    t.box.onFrameRender();
    expect(t.calls).toEqual([]);
  });

  test("a position below 0 is set to 0 first (SetTrackPos)", () => {
    const t = fixed(4);
    t.b.m_nPosition = -3;
    t.box.onFrameRender();
    expect(t.b.m_nPosition).toBe(0);
    expect(names(t.calls)).toEqual(["Row0", "Row1", "Row2", "Row3"]);
  });
});

describe("OnFrameRender: the highlight of a row (not a multi selection)", () => {
  function six() {
    const t = scene();
    const b = t.bar();
    t.rows(6);
    t.w.statics.bSBInit_0 = true;
    return { ...t, b };
  }

  test("the selected row: a quad from the selection's left to its right plus the bar's width, drawn just before its text", () => {
    const t = six();
    t.box.m_nSelected = 2;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }, { texture: "TEXT.TGA", rect: hl(2) }]);
    expect(t.calls.map((c) => draws(t.dev, c.log))).toEqual([1, 1, 2, 2, 2, 2]);
    expect(t.calls.length).toBe(6);
  });

  test("m_bShowTextTex off: no quad, the text is still drawn; without m_pTextTex the point keeps the bounding box's texture", () => {
    const t = six();
    t.box.m_nSelected = 2;
    t.box.m_bShowTextTex = false;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }]);
    expect(t.calls.length).toBe(6);
    const from = t.dev.log.length;
    t.box.m_bShowTextTex = true;
    t.box.m_pTextTex = null;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev, from)).toEqual([{ texture: "BOX.TGA", rect: BOX }, { texture: "BOX.TGA", rect: hl(2) }]);
  });

  test("a mega row (m_bMegaSelect or m_bMegaOver) is highlighted to the box's right edge, 100 + 200 = 300 (311 drawn); a row that is only m_bMegaOver has the mouse-over texture", () => {
    const t = six();
    t.box.m_Items[1]!.m_bMegaSelect = true;
    t.box.m_Items[3]!.m_bMegaOver = true;
    t.box.m_Items[4]!.m_bMegaOver = true;
    t.box.m_Items[4]!.m_bMegaSelect = true;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([
      { texture: "BOX.TGA", rect: BOX },
      { texture: "TEXT.TGA", rect: hl(1, 311) },
      { texture: "OVER.TGA", rect: hl(3, 311) },
      { texture: "TEXT.TGA", rect: hl(4, 311) },
    ]);
  });

  test("a row that is only m_bMegaOver has the text texture when the box has no mouse-over texture", () => {
    const t = six();
    t.box.m_pButtonMouseOverTex = null;
    t.box.m_Items[3]!.m_bMegaOver = true;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }, { texture: "TEXT.TGA", rect: hl(3, 311) }]);
  });

  test("the right edge grows by the bar's width for every highlighted row so far, mega rows included: the selected row after a mega row ends at 278 + 32", () => {
    const t = six();
    t.box.m_Items[1]!.m_bMegaOver = true;
    t.box.m_nSelected = 3;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([
      { texture: "BOX.TGA", rect: BOX },
      { texture: "OVER.TGA", rect: hl(1, 311) },
      { texture: "TEXT.TGA", rect: hl(3, 321) },
    ]);
    // the order: each quad just before the text of its row
    expect(t.calls.map((c) => draws(t.dev, c.log))).toEqual([1, 2, 2, 3, 3, 3]);
  });

  test("a NOT_ENABLE row has a quad, a group row or a row of any larger type has none", () => {
    const t = six();
    t.box.m_Items[1]!.itemType = LBIT.NOT_ENABLE;
    t.box.m_Items[2]!.itemType = LBIT.GROUP_PLUS;
    t.box.m_Items[3]!.itemType = 7;
    for (const k of [1, 2, 3]) t.box.m_Items[k]!.m_bMegaSelect = true;
    t.box.m_pGroupMark.onFrameRender = () => 0;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }, { texture: "TEXT.TGA", rect: hl(1, 311) }]);
    // Row0, Row1 (NOT_ENABLE), Row4, Row5 by the text font; the group row (2) by the group font; row 3 (type 7) by nobody
    expect(names(t.calls)).toEqual(["Row0", "Row1", "Row4", "Row5"]);
    expect(names(t.groupCalls)).toEqual(["Row2"]);
  });
});

describe("OnFrameRender: a multi selection (m_dwStyle bit 0)", () => {
  function multi(own: number[], start: number, sel: number, drag: boolean) {
    const t = scene();
    t.bar();
    t.rows(8);
    t.w.statics.bSBInit_0 = true;
    t.box.m_dwStyle = 1;
    t.box.m_nSelStart = start;
    t.box.m_nSelected = sel;
    t.box.m_bDrag = drag;
    for (const k of own) t.box.m_Items[k]!.bSelected = true;
    t.box.onFrameRender();
    return t;
  }
  /** the rows that have a highlight */
  const highlighted = (t: ReturnType<typeof scene>) => drawnQuads(t.dev).slice(1).map((q) => (q.rect[1] - 76) / 9);

  test("a row is highlighted when it is selected; the selected row (m_nSelected) and the mega flags mean nothing; the right edge grows 16 a row", () => {
    const t = scene();
    t.bar();
    t.rows(8);
    t.w.statics.bSBInit_0 = true;
    t.box.m_dwStyle = 1;
    t.box.m_nSelected = 2;
    t.box.m_Items[1]!.bSelected = true;
    t.box.m_Items[4]!.bSelected = true;
    t.box.m_Items[3]!.m_bMegaOver = true;
    t.box.m_Items[5]!.m_bMegaSelect = true;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([
      { texture: "BOX.TGA", rect: BOX },
      { texture: "TEXT.TGA", rect: hl(1, 305) },
      { texture: "TEXT.TGA", rect: hl(4, 321) },
    ]);
  });

  test("dragging from row 2 to row 5: rows 3 to 5 have the state of row 2, which is selected: rows 2 to 5", () => {
    expect(highlighted(multi([2], 2, 5, true))).toEqual([2, 3, 4, 5]);
  });

  test("dragging from row 2 to row 5 with row 2 not selected: rows 3 to 5 are not (whatever their own state), the others are as they are", () => {
    expect(highlighted(multi([4, 7], 2, 5, true))).toEqual([7]);
  });

  test("dragging back from row 5 to row 2: rows 2 to 4 have the state of row 5, row 5 and the others their own", () => {
    expect(highlighted(multi([5, 0], 5, 2, true))).toEqual([0, 2, 3, 4, 5]);
    expect(highlighted(multi([3], 5, 2, true))).toEqual([]);
  });

  test("the start is the end: the rows are their own", () => {
    expect(highlighted(multi([1, 3], 3, 3, true))).toEqual([1, 3]);
  });

  test("not dragging: the range means nothing", () => {
    expect(highlighted(multi([4], 2, 5, false))).toEqual([4]);
  });
});

describe("OnFrameRender: the text of a row", () => {
  function plain() {
    const t = scene();
    t.bar();
    t.w.statics.bSBInit_0 = true;
    return t;
  }

  test("a row's text is at the corner of the row, whatever the string data's own position is; the depth moves it right by itemDepth * m_BlankWidthByDepth (5 by default)", () => {
    const t = plain();
    t.box.m_pStringData!.pos.set(50, 60);
    for (const depth of [0, 1, 3]) t.box.addItem(`D${depth}`, null, depth, LBIT.DEFAULT, false, 0);
    t.box.onFrameRender();
    expect(t.calls.map((c) => [c.args[2], c.args[0], c.args[1]])).toEqual([["D0", 122, 76], ["D1", 127, 85], ["D3", 137, 94]]);
    t.calls.length = 0;
    t.box.m_BlankWidthByDepth = 7;
    t.box.onFrameRender();
    expect(t.calls.map((c) => c.args[0])).toEqual([122, 129, 143]);
  });

  test("the colour is the dialog's times the string's times the box's, the style and the outline are the string data's; the sort flag is not (the call has 0)", () => {
    const t = plain();
    t.box.m_pStringData = data("", { fontStyle: 1, sortFlag: 9 });
    t.box.m_pStringData.color.set(0.2, 0.6, 0.8, 0.3);
    t.box.m_pStringData.outlineColor.set(0.9, 0.7, 0.5, 0.4);
    t.rows(1);
    t.box.onFrameRender();
    expect(t.calls.map((c) => c.args)).toEqual([rowText("Row0", 122, 76, 0x2b174537, 1, 0x39675022)]);
  });

  test("NOT_ENABLE: the string's alpha is halved first, 0.9 * 0.5 * 0.8 * 0.7 = 0.252 -> 64; the outline is not touched", () => {
    const t = plain();
    t.box.addItem("Off", null, 0, LBIT.NOT_ENABLE, false, 0);
    t.box.onFrameRender();
    expect(t.calls.map((c) => c.args)).toEqual([rowText("Off", 122, 76, 0x40502e0e)]);
  });

  test("a row with a colour of its own (AddString): its red, green and blue instead of the product; the alpha is still the product (129; 64 for NOT_ENABLE)", () => {
    const t = plain();
    t.box.addString("Own", new Color(0.25, 0.5, 0.75, 1), null, null);
    t.box.addString("Own too", new Color(0.25, 0.5, 0.75, 1), null, null);
    t.box.m_Items[1]!.itemType = LBIT.NOT_ENABLE;
    t.box.onFrameRender();
    expect(t.calls.map((c) => c.args)).toEqual([rowText("Own", 122, 76, 0x814080bf), rowText("Own too", 122, 85, 0x404080bf)]);
  });

  test("a spreading row shows its first iSpreadCount characters: count 2 of Three is Th, a count past the end or below 0 (an unsigned compare) shows all, 0 shows none", () => {
    const t = plain();
    for (const count of [2, 9, 0, -1, 5]) {
      t.box.addItem("Three", null, 0, LBIT.DEFAULT, true, 0.5);
      t.box.m_Items[t.box.m_Items.length - 1]!.iSpreadCount = count;
    }
    t.box.addItem("Whole", null, 0, LBIT.DEFAULT, false, 0);
    t.box.m_Items[5]!.iSpreadCount = 1; // a row that does not spread is whole
    t.box.onFrameRender();
    expect(names(t.calls)).toEqual(["Th", "Three", "", "Three", "Three", "Whole"]);
  });

  test("without m_pUKFont nothing is spoken (the highlight is still drawn); the group font is not used for a plain row", () => {
    const t = plain();
    t.rows(3);
    t.box.m_nSelected = 1;
    t.box.m_pUKFont = null;
    t.box.onFrameRender();
    expect(t.calls).toEqual([]);
    expect(t.groupCalls).toEqual([]);
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }, { texture: "TEXT.TGA", rect: hl(1) }]);
  });
});

describe("OnFrameRender: group rows", () => {
  function groups() {
    const t = scene();
    t.bar();
    t.w.statics.bSBInit_0 = true;
    t.box.addItem("Plain", null, 0, LBIT.DEFAULT, false, 0);
    t.box.addItem("Plus", null, 1, LBIT.GROUP_PLUS, false, 0);
    t.box.addItem("Minus", null, 2, LBIT.GROUP_MINUS, false, 0);
    const marks: { at: [number, number]; shown: [boolean, boolean]; groupTexts: number }[] = [];
    const mark = t.box.m_pGroupMark;
    mark.onFrameRender = () => {
      marks.push({ at: [mark.m_OffsetPos.x, mark.m_OffsetPos.y], shown: [mark.GetPicture(0)!.bShow, mark.GetPicture(1)!.bShow], groupTexts: t.groupCalls.length });
      return 0;
    };
    return { ...t, marks };
  }

  test("a group row moves the mark to the row's corner plus the depth and (-10, -1), shows the picture of its type and draws it before the text, which the group font speaks in the group colours", () => {
    const t = groups();
    t.box.onFrameRender();
    // the row's corner is (111, 65) and (111, 74), the depth 5 and 10: x = depth + (left - 10); the dialog's position is not added
    expect(t.marks).toEqual([
      { at: [106, 64], shown: [true, false], groupTexts: 0 },
      { at: [111, 73], shown: [false, true], groupTexts: 1 },
    ]);
    // x = 122 + depth + 10 (m_BlankWidthToGroupMark); the style is the group string data's (3)
    expect(t.groupCalls.map((c) => c.args)).toEqual([rowText("Plus", 137, 85, GROUP_COLOR, 3, GROUP_OUTLINE), rowText("Minus", 142, 94, GROUP_COLOR, 3, GROUP_OUTLINE)]);
    expect(t.calls.map((c) => c.args)).toEqual([rowText("Plain", 122, 76)]);
  });

  test("the offsets are floats: m_GroupMarkOffsetPos (-7.5, 2.25), m_BlankWidthByDepth 7 and m_BlankWidthToGroupMark 13", () => {
    const t = groups();
    t.box.m_GroupMarkOffsetPos.set(-7.5, 2.25);
    t.box.m_BlankWidthByDepth = 7;
    t.box.m_BlankWidthToGroupMark = 13;
    t.box.onFrameRender();
    expect(t.marks.map((m) => m.at)).toEqual([[110.5, 67.25], [117.5, 76.25]]);
    expect(t.groupCalls.map((c) => [c.args[0], c.args[1]])).toEqual([[142, 85], [149, 94]]);
  });

  test("a group row is drawn also when it is the highlighted one (it has no quad); a group row without the group font draws its mark only", () => {
    const t = groups();
    t.box.m_nSelected = 1;
    t.box.m_pGroupUKFont = null;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }]);
    expect(t.marks.length).toBe(2);
    expect(t.groupCalls).toEqual([]);
    expect(names(t.calls)).toEqual(["Plain"]);
  });

  test("the group string data is not looked at: a group row without it is the exe's null dereference", () => {
    const t = groups();
    t.box.m_pGroupStringData = null;
    expect(() => t.box.onFrameRender()).toThrow(/group string data/);
    // a box with no group row never looks
    const u = scene();
    u.bar();
    u.rows(2);
    u.box.m_pGroupStringData = null;
    expect(() => u.box.onFrameRender()).not.toThrow();
  });

  test("the mark is a static with the pictures of DLG_Messenger.tga: its quad is the picture's size, 64 x 32 less (2, 3), at the mark's place plus the dialog's", () => {
    const t = scene();
    t.bar();
    t.w.statics.bSBInit_0 = true;
    t.box.addItem("Plus", null, 1, LBIT.GROUP_PLUS, false, 0);
    t.box.addItem("Minus", null, 2, LBIT.GROUP_MINUS, false, 0);
    t.box.onFrameRender();
    // the rows are the first two, at 56 and 65: the marks at (5 + 111 - 10, 56 - 1) = (106, 55) and (10 + 111 - 10, 65 - 1) = (111, 64); plus the dialog's (10.25, 20.5)
    // it is (116.25, 75.5) -> (116, 75) and 62 and 29 further (178.25, 104.5); (121.25, 84.5) -> (121, 84), (183.25, 113.5)
    expect(drawnQuads(t.dev)).toEqual([
      { texture: "BOX.TGA", rect: BOX },
      { texture: "DLG_MESSENGER.TGA", rect: [116, 75, 178, 104] },
      { texture: "DLG_MESSENGER.TGA", rect: [121, 84, 183, 113] },
    ]);
  });
});

describe("OnFrameRender: a static box (m_bIsStaticListBox) draws the controls of its rows", () => {
  function statics(n: number) {
    const t = scene();
    t.bar();
    t.rows(n);
    t.box.m_bIsStaticListBox = true;
    t.box.m_nTextHeight = 20;
    t.w.statics.bSBInit_0 = true;
    const probes = t.box.m_Items.map((item) => (item.pControl = t.probe()) as Probe);
    return { ...t, probes };
  }

  test("each row's control is put at the corner of the text rectangle, 20 (m_nTextHeight) a row, as many as fit: 5; nothing else is drawn, the bounding box first", () => {
    const t = statics(7);
    t.box.onFrameRender();
    expect(t.probes.map((p) => p.seen)).toEqual([[[111, 56]], [[111, 76]], [[111, 96]], [[111, 116]], [[111, 136]], [], []]);
    expect(t.probes.slice(0, 5).map((p) => p.after)).toEqual([[1], [1], [1], [1], [1]]);
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }]);
    expect(t.calls).toEqual([]);
    expect(t.box.m_nTextHeight).toBe(20); // a static box keeps its row height
  });

  test("the highlighted row's control is at the selection's left (106) instead; there is no quad", () => {
    const t = statics(4);
    t.box.m_nSelected = 2;
    t.box.m_Items[3]!.m_bMegaOver = true;
    t.box.onFrameRender();
    expect(t.probes.map((p) => p.seen)).toEqual([[[111, 56]], [[111, 76]], [[106, 96]], [[106, 116]]]);
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }]);
  });

  test("a multi selection highlights the selected rows the same way", () => {
    const t = statics(3);
    t.box.m_dwStyle = 1;
    t.box.m_Items[1]!.bSelected = true;
    t.box.onFrameRender();
    expect(t.probes.map((p) => p.seen)).toEqual([[[111, 56]], [[106, 76]], [[111, 96]]]);
  });

  test("a row that is not shown, or has no control, takes its place and draws nothing", () => {
    const t = statics(4);
    t.box.m_Items[1]!.m_bShow = false;
    t.box.m_Items[2]!.pControl = null;
    t.box.onFrameRender();
    expect(t.probes.map((p) => p.seen)).toEqual([[[111, 56]], [], [], [[111, 116]]]);
  });
});

describe("OnFrameRender: the mouse over a row of a message list (the rows with a message id)", () => {
  function mouse(ids: number[], mine: number[] = [], back?: { width: number; height: number }) {
    const t = scene(back);
    const b = t.bar();
    ids.forEach((id, k) => t.box.addMessageItem(`Msg${k}`, null, id, "name", mine.includes(k)));
    t.w.statics.bSBInit_0 = true;
    const over = () => t.box.m_Items.map((i) => i.m_bMegaOver);
    const hover = (x: number, y: number) => {
      t.w.mouse.m_XPos = x;
      t.w.mouse.m_YPos = y;
      t.box.onFrameRender();
      return over();
    };
    return { ...t, b, over, hover };
  }
  const only = (n: number, k: number) => Array.from({ length: n }, (_, i) => i === k);

  test("the mouse is over a row: every row with its message id that is not the sender's own gets m_bMegaOver, the others lose it", () => {
    const t = mouse([10, 10, 11, 12, 10], [4]);
    expect(t.hover(150, 96)).toEqual([false, false, true, false, false]);
    expect(t.hover(150, 90)).toEqual([true, true, false, false, false]);
    // the quad of the hovered row: the mouse-over texture over the box's whole width, before its text
    t.hover(150, 96);
    const from = t.dev.log.length;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev, from)).toEqual([{ texture: "BOX.TGA", rect: BOX }, { texture: "OVER.TGA", rect: hl(2, 311) }]);
  });

  test("the row's rectangle is from the selection's left (106) to the box's x + width (300), the row's top and bottom, all four sides left out (the mouse is a whole pixel, the layout 10.25 and 20.5 off)", () => {
    const t = mouse([20, 21, 22, 23, 24]);
    const none = [false, false, false, false, false];
    // the mouse in the layout is (x - 10.25, y - 20.5): 105.75 | 106.75 for the left side
    expect(t.hover(116, 96)).toEqual(none);
    expect(t.hover(117, 96)).toEqual(only(5, 2));
    expect(t.hover(310, 96)).toEqual(only(5, 2)); // 299.75
    expect(t.hover(311, 96)).toEqual(none); // 300.75
    // row 0 is (56, 65): 55.5 | 56.5 and 64.5 | 65.5
    expect(t.hover(150, 76)).toEqual(none);
    expect(t.hover(150, 77)).toEqual(only(5, 0));
    expect(t.hover(150, 85)).toEqual(only(5, 0));
    expect(t.hover(150, 86)).toEqual(only(5, 1));
    expect(t.hover(150, 94)).toEqual(only(5, 1));
    expect(t.hover(150, 95)).toEqual(only(5, 2));
    // row 4 is (92, 101): 92.5 .. 100.5, then the rows are over
    expect(t.hover(150, 113)).toEqual(only(5, 4));
    expect(t.hover(150, 121)).toEqual(only(5, 4));
    expect(t.hover(150, 122)).toEqual(none);
  });

  test("the right side is the box's GetPos().x + m_width: at x 90 and 200 wide it is 290", () => {
    const t = mouse([20, 21, 22]);
    t.box.m_x = 90;
    expect(t.hover(300, 96)).toEqual(only(3, 2)); // 289.75
    expect(t.hover(301, 96)).toEqual([false, false, false]); // 290.75
    t.box.m_x = 100;
    t.box.m_width = 150;
    expect(t.hover(259, 96)).toEqual(only(3, 2)); // 248.75 (of 250)
    expect(t.hover(261, 96)).toEqual([false, false, false]);
  });

  test("the mouse is divided by the resolution scale, (1.5, 2) at 1536 x 1536: (225, 192) is the layout's (139.75, 75.5), row 2", () => {
    const t = mouse([20, 21, 22, 23, 24], [], { width: 1536, height: 1536 });
    expect(t.hover(225, 192)).toEqual(only(5, 2));
    expect(t.hover(150, 96)).toEqual([false, false, false, false, false]); // (89.75, 27.5)
  });

  test("a row that is hidden, has no message id (-1) or belongs to a multi selection is not visited: it keeps its flag; a row that is visited and not hit loses it", () => {
    const t = mouse([10, 10, -1, 10]);
    t.box.m_Items[1]!.m_bShow = false;
    for (const i of t.box.m_Items) i.m_bMegaOver = true;
    expect(t.hover(5, 5)).toEqual([false, true, true, false]);
    // a hit sets every row from the bar's position, hidden or not: rows with its message id, 10, and not the sender's own
    expect(t.hover(150, 78)).toEqual([true, true, false, true]);
    // a multi selection is not visited at all
    t.box.m_dwStyle = 1;
    for (const i of t.box.m_Items) i.m_bMegaOver = true;
    expect(t.hover(5, 5)).toEqual([true, true, true, true]);
  });

  test("the pass starts at the bar's position and a hit changes the rows from there on only, those below the text rectangle too; with no hit those below it keep their flag", () => {
    const t = mouse([10, 10, 10, 11, 10, 12]);
    t.b.m_nPosition = 2;
    t.box.m_Items[0]!.m_bMegaOver = true;
    t.box.m_Items[1]!.m_bMegaOver = true;
    // the second visible row (65) is row 3, message 11
    expect(t.hover(150, 90)).toEqual([true, true, false, true, false, false]);
    const long = mouse(Array.from({ length: 14 }, () => 10));
    expect(long.hover(150, 96)).toEqual(Array.from({ length: 14 }, () => true));
    for (const i of long.box.m_Items) i.m_bMegaOver = true;
    // a miss: the 12 rows that fit lose the flag, the 2 below the text rectangle do not
    expect(long.hover(5, 5)).toEqual([...Array.from({ length: 12 }, () => false), true, true]);
  });
});

describe("the dialog draws the list box", () => {
  test("the dialog's OnFrameRender draws the box (and it is no longer counted as undrawn)", () => {
    const t = scene();
    t.bar();
    t.rows(2);
    t.dialog.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "BOX.TGA", rect: BOX }]);
    expect(names(t.calls)).toEqual(["Row0", "Row1"]);
    expect(t.w.render!.undrawn.has("CKTDGUIListBox")).toBe(false);
  });
});

describe("the mouse of the world (CKTDIDevice::GetXPos 32962E60, GetYPos 32962EB0)", () => {
  test("GetXPos / GetYPos answer the position the device was given; it starts at (0, 0)", () => {
    const m = new UIMouse();
    expect([m.GetXPos(), m.GetYPos()]).toEqual([0, 0]);
    m.m_XPos = 7;
    m.m_YPos = -3;
    expect([m.GetXPos(), m.GetYPos()]).toEqual([7, -3]);
    expect(scene().w.mouse).toBeInstanceOf(UIMouse);
  });
});
