/**
 * The drawing of the combo box: `CKTDGUIComboBox::OnFrameRender` (3293DB00) and `OnFrameRenderEnd` (3293E390).  The font is a UK font with
 * a glyph font of size 8 enlarged twice (`m_iFontSize` 16, `m_EnlargeNum` 2: a line of text is 16 / 2 + 1 = 9 high) whose drawing calls
 * are written down; every number is worked out from the decompile.
 *
 * The world is 1024 x 768, so the layout is not scaled; the scene of stringspy.ts puts the dialog at (10.25, 20.5) and the control at the
 * offset (0.75, 0.25), so a quad at (x, y) of the layout is drawn at (x + 11, y + 20) (the sums are 10.25 + 0.75 = 11 and
 * 20.5 + 0.25 = 20.75, cut to a whole pixel) and a string whose place is (x, y) is spoken at (x + 11, y + 20) too.
 *
 * The rectangles of the box: button (200, 40, 230, 62), text (100, 40, 198, 62), dropdown (100, 62, 230, 180), dropdown text
 * (104, 66, 214, 160), which is 94 high: ten rows of 9 fit (90), the eleventh would leave -5.
 */
import { describe, expect, test } from "bun:test";
import { CKTDGUIComboBox, CKTDGUIControl, CKTDGUIDialog, CKTDGUIScrollBar, setRect } from "../src/index.ts";
import type { ComboBoxItem } from "../src/index.ts";
import { fontWorld } from "./fontworld.ts";
import { drawnQuads, quad } from "./rig.ts";
import { data, outText, place, spied } from "./stringspy.ts";
import type { Call } from "./stringspy.ts";

/** a control that writes down the offset it was drawn at */
class Probe extends CKTDGUIControl {
  readonly seen: [number, number][] = [];
  override onFrameRender(): number {
    this.seen.push([this.m_OffsetPos.x, this.m_OffsetPos.y]);
    return 0;
  }
}

function scene() {
  const s = fontWorld({}, { device: true, backBuffer: { width: 1024, height: 768 } });
  const { w, dev } = s;
  const ft = s.font(8, 0, 2, true, true);
  const calls: Call[] = [];
  const font = spied(dev!, w.fonts, 2, calls, ft);
  const dialog = new CKTDGUIDialog(w);
  const box = new CKTDGUIComboBox(w);
  place(dialog, box);
  setRect(box.m_rcButton, 200, 40, 230, 62);
  setRect(box.m_rcText, 100, 40, 198, 62);
  setRect(box.m_rcDropdown, 100, 62, 230, 180);
  setRect(box.m_rcDropdownText, 104, 66, 214, 160);
  const tex = (name: string) => quad(w, 0, 0, name).pUITextureData!;
  box.m_pButtonTex = tex("BTN.TGA");
  box.m_pButtonMouseOverTex = tex("OVER.TGA");
  box.m_pButtonMouseDownTex = tex("DOWN.TGA");
  box.m_pTextTex = tex("TEXT.TGA");
  box.m_pDropdownTex = tex("DROP.TGA");
  box.m_pDropdownTextTex = tex("ROW.TGA");
  box.m_pStringData = data("");
  dev!.log.length = 0;
  const row = (text: string, pControl: CKTDGUIControl | null = null): ComboBoxItem => {
    const item: ComboBoxItem = { strText: text, pData: null, rcActive: { left: 7, top: 7, right: 7, bottom: 7 }, bVisible: true, pControl };
    box.m_Items.push(item);
    return item;
  };
  const bar = () => {
    const b = new CKTDGUIScrollBar(w);
    b.m_width = 16;
    box.m_pScrollBar = b;
    return b;
  };
  const probe = () => new Probe(w);
  return { ...s, dev: dev!, ft, calls, font, dialog, box, row, bar, probe, tex };
}

type R4 = [number, number, number, number];
const BUTTON: R4 = [211, 60, 241, 82];
const TEXT: R4 = [111, 60, 209, 82];
const DROP: R4 = [111, 82, 241, 200];

describe("OnFrameRender (3293DB00): the button and the text rectangle", () => {
  test("a shown box draws its button, then its text rectangle", () => {
    const { box, dev } = scene();
    expect(box.onFrameRender()).toBe(0);
    expect(drawnQuads(dev)).toEqual([{ texture: "BTN.TGA", rect: BUTTON }, { texture: "TEXT.TGA", rect: TEXT }]);
  });

  test("a hidden box draws nothing, and does not use up the first-box rule", () => {
    const { box, dev, w, bar } = scene();
    const b = bar();
    box.m_bShow = false;
    expect(box.onFrameRender()).toBe(0);
    expect(dev.log).toEqual([]);
    expect(w.statics.bSBInit).toBe(false);
    expect(b.m_nPageSize).toBe(1);
  });

  test("the textures: pressed and enabled the mouse-down one, else with the mouse over it the mouse-over one, else the button's", () => {
    const { box, dev } = scene();
    const draw = (): string => {
      const from = dev.log.length;
      box.onFrameRender();
      return drawnQuads(dev, from)[0]!.texture;
    };
    expect(draw()).toBe("BTN.TGA");
    box.m_bPressed = true;
    expect(draw()).toBe("DOWN.TGA");
    box.m_bMouseOver = true; // the mouse-down texture wins over the mouse-over one
    expect(draw()).toBe("DOWN.TGA");
    box.m_bEnable = false; // a disabled box is not pressed
    expect(draw()).toBe("OVER.TGA");
    box.m_bMouseOver = false;
    expect(draw()).toBe("BTN.TGA");
    box.m_bEnable = true;
    box.m_pButtonMouseDownTex = null; // pressed, no mouse-down texture: the mouse-over one if the mouse is over, else the button's
    expect(draw()).toBe("BTN.TGA");
    box.m_bMouseOver = true;
    expect(draw()).toBe("OVER.TGA");
    box.m_bPressed = false;
    expect(draw()).toBe("OVER.TGA");
  });

  test("the mouse is over a box that has no mouse-over texture: the button is not drawn (the point has no texture), the text rectangle is", () => {
    const { box, dev } = scene();
    box.m_bMouseOver = true;
    box.m_pButtonMouseOverTex = null;
    box.onFrameRender();
    expect(drawnQuads(dev)).toEqual([{ texture: "TEXT.TGA", rect: TEXT }]);
  });

  test("a box without a button texture draws the button with whatever texture its point held from the last draw (the text rectangle's)", () => {
    const { box, dev } = scene();
    box.onFrameRender();
    const from = dev.log.length;
    box.m_pButtonTex = null;
    box.onFrameRender();
    expect(drawnQuads(dev, from)).toEqual([{ texture: "TEXT.TGA", rect: BUTTON }, { texture: "TEXT.TGA", rect: TEXT }]);
    // and the first time there is no texture: only the text rectangle
    const t = scene();
    t.box.m_pButtonTex = null;
    t.box.onFrameRender();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "TEXT.TGA", rect: TEXT }]);
  });

  test("a rectangle without a texture leaves the point's texture alone: the next button quad without a texture of its own still has it", () => {
    const { box, dev } = scene();
    box.m_pTextTex = null;
    box.onFrameRender(); // the point holds the button texture; the text rectangle has no texture
    const from = dev.log.length;
    box.m_pButtonTex = null;
    box.onFrameRender();
    expect(drawnQuads(dev, from)).toEqual([{ texture: "BTN.TGA", rect: BUTTON }]);
  });

  test("a box without a text texture draws no text rectangle", () => {
    const { box, dev } = scene();
    box.m_pTextTex = null;
    box.onFrameRender();
    expect(drawnQuads(dev)).toEqual([{ texture: "BTN.TGA", rect: BUTTON }]);
  });
});

describe("OnFrameRender: the selected row", () => {
  // the place of the text is the corner of the text rectangle (100, 40) plus the offset (7, 9): (107, 49) and the scene adds 11 and 20
  const at = [118, 69] as const;
  function selected() {
    const t = scene();
    t.box.m_TextStringOffsetPosX = 7;
    t.box.m_TextStringOffsetPosY = 9;
    t.row("Abc");
    t.row("Hello world");
    t.box.m_iSelected = 1;
    return t;
  }

  test("the text of the selected row is spoken after the quads, at the corner of the text rectangle plus the offset", () => {
    const { box, calls, dev } = selected();
    box.onFrameRender();
    expect(calls.map((c) => [c.method, c.args, c.log])).toEqual([["OutTextMultiline", outText("Hello world", at[0], at[1]), dev.log.length]]);
    expect(drawnQuads(dev).length).toBe(2);
  });

  test("m_iTextLimit above 0 cuts the text to that many characters; a limit at or over the length, 0 and a negative one leave it whole", () => {
    const { box, calls } = selected();
    const spoken = (limit: number): unknown => {
      calls.length = 0;
      box.m_iTextLimit = limit;
      box.onFrameRender();
      return calls[0]!.args[2];
    };
    expect(spoken(5)).toBe("Hello");
    expect(spoken(1)).toBe("H");
    expect(spoken(11)).toBe("Hello world");
    expect(spoken(40)).toBe("Hello world");
    expect(spoken(0)).toBe("Hello world");
    expect(spoken(-3)).toBe("Hello world");
  });

  test("the row is chosen by m_iSelected; nothing for -1, for an index past the rows, with m_bSelectTextShow off, or without string data", () => {
    const { box, calls } = selected();
    box.m_iSelected = 0;
    box.onFrameRender();
    expect(calls.map((c) => c.args[2])).toEqual(["Abc"]);
    for (const off of [() => { box.m_iSelected = -1; }, () => { box.m_iSelected = 2; }, () => { box.m_iSelected = 1; box.m_bSelectTextShow = false; }, () => { box.m_bSelectTextShow = true; box.m_pStringData = null; }]) {
      calls.length = 0;
      off();
      box.onFrameRender();
      expect(calls).toEqual([]);
    }
  });

  test("the text uses the colours of the string data (the dialog's times the string's times the control's), its style, sort flag and outline", () => {
    const { box, calls } = selected();
    box.m_pStringData = data("", { fontStyle: 3, sortFlag: 9 });
    box.onFrameRender();
    expect(calls[0]!.args.slice(3)).toEqual([0x81502e0e, 3, 0x470b1715, 1, null, 9, -1, 1, 1]);
  });

  test("a font that does not exist is the exe's crash, at the text; the quads before it were drawn and the font map gained the index", () => {
    const { box, dev, w } = selected();
    box.m_pStringData = data("", { fontIndex: 9 });
    expect(() => box.onFrameRender()).toThrow(/no UK font for the font index 9/);
    expect(drawnQuads(dev).length).toBe(2);
    expect(w.fonts.m_mapUKFontList.has(9)).toBe(true);
    // without a selected row the font is looked up but nothing needs it
    box.m_iSelected = -1;
    expect(box.onFrameRender()).toBe(0);
  });
});

describe("OnFrameRender: a static box draws the control of its selected row", () => {
  function selected() {
    const t = scene();
    t.box.m_bIsStaticComboBox = true;
    const a = t.probe(), b = t.probe();
    t.row("a", a);
    t.row("b", b);
    t.box.m_iSelected = 1;
    return { ...t, a, b };
  }

  test("the control is moved to ((dialog.x + offset.x) + text.left, text.top + (dialog.y + offset.y)) and drawn, after the quads; no text", () => {
    const { box, a, b, calls, dev } = selected();
    box.onFrameRender();
    // (10.25 + 0.75) + 100 = 111; 40 + (20.5 + 0.25) = 60.75
    expect([a.seen, b.seen]).toEqual([[], [[111, 60.75]]]);
    expect(calls).toEqual([]);
    expect(drawnQuads(dev).length).toBe(2);
  });

  test("the box's own offset and the dialog's position are both in it; a row without a control draws nothing", () => {
    const { box, b, row } = selected();
    box.m_OffsetPos.set(1.5, -3);
    box.m_rcText.left = 20;
    box.m_rcText.top = 30;
    box.onFrameRender();
    // (10.25 + 1.5) + 20 = 31.75; 30 + (20.5 - 3) = 47.5
    expect(b.seen).toEqual([[31.75, 47.5]]);
    row("c", null);
    box.m_iSelected = 2;
    expect(box.onFrameRender()).toBe(0);
    expect(b.seen.length).toBe(1);
  });

  test("the first-box rule gives a static box's bar its page from the static height (a zero height is the exe's divide error)", () => {
    const { box, bar, w } = selected();
    const b = bar();
    b.m_nStart = 0;
    b.m_nEnd = 30;
    b.m_nPosition = 99;
    b.m_rcTrack.top = 20;
    b.m_rcTrack.bottom = 120;
    box.m_nStaticHeight = 0;
    expect(() => box.onFrameRender()).toThrow(/division by zero/);
    expect(w.statics.bSBInit).toBe(false);
    box.m_nStaticHeight = 11;
    box.onFrameRender();
    // 94 / 11 = 8; the position 99 is capped to 30 - 8 = 22; the thumb is 8 * 100 / 30 = 26 high at 20 + 74 * 22 / 22 = 94
    expect([b.m_nPageSize, b.m_nPosition, b.m_rcThumb.top, b.m_rcThumb.bottom]).toEqual([8, 22, 94, 120]);
  });
});

describe("OnFrameRender: the first combo box that is drawn gives its scroll bar its page size (the exe's static bSBInit)", () => {
  function withBar() {
    const t = scene();
    const b = t.bar();
    b.m_nStart = 0;
    b.m_nEnd = 30;
    b.m_nPosition = 99;
    b.m_rcTrack.top = 20;
    b.m_rcTrack.bottom = 120;
    return { ...t, b };
  }

  test("with a UK font the page is the dropdown text's height over the line height: 94 / 9 = 10; the bar is capped (99 to 30 - 10) and its thumb made", () => {
    const { box, b, w } = withBar();
    box.onFrameRender();
    // the thumb: 10 * 100 / 30 = 33 high, at 20 + 67 * 20 / 20 = 87
    expect([b.m_nPageSize, b.m_nPosition, b.m_rcThumb.top, b.m_rcThumb.bottom, b.m_bShowThumb]).toEqual([10, 20, 87, 120, true]);
    expect(w.statics.bSBInit).toBe(true);
  });

  test("without string data (no font) the page is the whole height, 94: the track is no longer than a page, so the position is the start and there is no thumb", () => {
    const { box, b } = withBar();
    box.m_pStringData = null;
    box.onFrameRender();
    expect([b.m_nPageSize, b.m_nPosition, b.m_bShowThumb]).toEqual([94, 0, false]);
    expect(b.m_rcThumb.bottom).toBe(b.m_rcThumb.top);
  });

  test("a font index nobody made is no font either (and the lookup enters it in the map)", () => {
    const { box, b, w } = withBar();
    box.m_pStringData = data("", { fontIndex: 9 });
    box.onFrameRender();
    expect(b.m_nPageSize).toBe(94);
    expect(w.fonts.m_mapUKFontList.has(9)).toBe(true);
  });

  test("only once: the next box keeps the page size it has, and a box without a bar uses the rule up", () => {
    const first = withBar();
    first.box.onFrameRender();
    const other = new CKTDGUIComboBox(first.w);
    place(first.dialog, other);
    other.m_pStringData = data("");
    const b2 = new CKTDGUIScrollBar(first.w);
    other.m_pScrollBar = b2;
    other.onFrameRender();
    expect(b2.m_nPageSize).toBe(1);
    // a box with no bar draws first: the next one, with a bar, is not given a page either
    const second = scene();
    second.box.onFrameRender();
    expect(second.w.statics.bSBInit).toBe(true);
    const b3 = second.bar();
    second.box.onFrameRender();
    expect(b3.m_nPageSize).toBe(1);
  });
});

describe("OnFrameRenderEnd (3293E390): the layout of the rows", () => {
  function rows(t: ReturnType<typeof scene>, count: number): ComboBoxItem[] {
    return Array.from({ length: count }, (_, k) => t.row(`Item${k}`));
  }
  const rect = (r: ComboBoxItem) => [r.rcActive.left, r.rcActive.top, r.rcActive.right, r.rcActive.bottom];

  test("a closed box with a font lays its rows out from the first one, 9 high from the top of the dropdown text: ten fit, the others are hidden and untouched", () => {
    const t = scene();
    const items = rows(t, 12);
    for (const before of [true, false]) {
      // whether the rows were visible before or not
      items.forEach((r) => {
        r.bVisible = before;
        setRect(r.rcActive, 7, 7, 7, 7);
      });
      expect(t.box.onFrameRenderEnd()).toBe(0);
      items.slice(0, 10).forEach((r, k) => {
        expect([before, k, rect(r), r.bVisible]).toEqual([before, k, [104, 66 + 9 * k, 214, 75 + 9 * k], true]);
      });
      items.slice(10).forEach((r) => expect([before, rect(r), r.bVisible]).toEqual([before, [7, 7, 7, 7], false]));
    }
    expect(t.dev.log).toEqual([]);
    expect(t.calls).toEqual([]);
  });

  test("a row that leaves exactly 0 of the height is still shown (the eleventh of a 90 high text area is not)", () => {
    const t = scene();
    t.box.m_rcDropdownText.bottom = 156; // 90
    const items = rows(t, 11);
    t.box.onFrameRenderEnd();
    expect(items.map((r) => r.bVisible)).toEqual([...Array(10).fill(true), false]);
    expect(rect(items[9]!)).toEqual([104, 147, 214, 156]);
    t.box.m_rcDropdownText.bottom = 155; // 89: the tenth does not fit any more
    t.box.onFrameRenderEnd();
    expect(items.map((r) => r.bVisible)).toEqual([...Array(9).fill(true), false, false]);
  });

  test("with a scroll bar the rows start at its position (the rows before it are not touched) and are as wide as the text plus the bar", () => {
    const t = scene();
    const items = rows(t, 8);
    const b = t.bar();
    b.m_nPosition = 3;
    t.box.onFrameRenderEnd();
    items.slice(0, 3).forEach((r) => expect([rect(r), r.bVisible]).toEqual([[7, 7, 7, 7], true]));
    items.slice(3).forEach((r, k) => expect([rect(r), r.bVisible]).toEqual([[104, 66 + 9 * k, 230, 75 + 9 * k], true]));
    // a position past the last row: nothing to lay out
    b.m_nPosition = 8;
    items.forEach((r) => { r.bVisible = true; });
    t.box.onFrameRenderEnd();
    expect(items.every((r) => r.bVisible)).toBe(true);
  });

  test("a static box's rows are m_nStaticHeight high: 11, eight fit in 94", () => {
    const t = scene();
    t.box.m_bIsStaticComboBox = true;
    t.box.m_nStaticHeight = 11;
    const items = rows(t, 10);
    t.box.onFrameRenderEnd();
    items.slice(0, 8).forEach((r, k) => expect([k, rect(r), r.bVisible]).toEqual([k, [104, 66 + 11 * k, 214, 77 + 11 * k], true]));
    expect(items.slice(8).map((r) => r.bVisible)).toEqual([false, false]);
  });

  test("a box without a UK font (no string data, or a font index nobody made) lays out nothing", () => {
    const t = scene();
    const items = rows(t, 3);
    t.box.m_pStringData = null;
    t.box.onFrameRenderEnd();
    t.box.m_pStringData = data("", { fontIndex: 9 });
    t.box.onFrameRenderEnd();
    expect(items.map((r) => [rect(r), r.bVisible])).toEqual([[[7, 7, 7, 7], true], [[7, 7, 7, 7], true], [[7, 7, 7, 7], true]]);
  });

  test("a hidden box does nothing", () => {
    const t = scene();
    const items = rows(t, 3);
    t.box.m_bOpened = true;
    t.box.m_bShow = false;
    expect(t.box.onFrameRenderEnd()).toBe(0);
    expect([t.dev.log, t.calls, items.map((r) => rect(r))]).toEqual([[], [], [[7, 7, 7, 7], [7, 7, 7, 7], [7, 7, 7, 7]]]);
  });
});

describe("OnFrameRenderEnd: the open dropdown", () => {
  function open(count: number) {
    const t = scene();
    t.box.m_bOpened = true;
    const items = Array.from({ length: count }, (_, k) => t.row(`Item${k}`));
    return { ...t, items };
  }
  const drawsBefore = (t: { dev: { log: string[] } }, n: number): number => t.dev.log.slice(0, n).filter((l) => l.startsWith("draw ")).length;

  test("the dropdown is drawn first, then each row's text at the corner of its rectangle; the focused row has its highlight drawn just before its text", () => {
    const t = open(12);
    t.box.m_iFocused = 2;
    expect(t.box.onFrameRenderEnd()).toBe(0);
    // the highlight: the dropdown's left and right, the row's top - 2 and bottom + 2: (100, 82, 230, 95), drawn at (111, 102, 241, 115)
    expect(drawnQuads(t.dev)).toEqual([{ texture: "DROP.TGA", rect: DROP }, { texture: "ROW.TGA", rect: [111, 102, 241, 115] }]);
    expect(t.calls.map((c) => [c.args[0], c.args[1], c.args[2]])).toEqual(Array.from({ length: 10 }, (_, k) => [115, 86 + 9 * k, `Item${k}`]));
    expect(t.calls.map((c) => drawsBefore(t, c.log))).toEqual([1, 1, 2, 2, 2, 2, 2, 2, 2, 2]);
    // the colours and the rest of the call are those of the string data
    expect(t.calls[0]!.args).toEqual(outText("Item0", 115, 86));
  });

  test("the rows' text is whole whatever m_iTextLimit says; a row that is not shown is not spoken", () => {
    const t = open(11);
    t.box.m_iTextLimit = 3;
    t.box.m_rcDropdownText.bottom = 148; // 82: nine rows
    t.box.onFrameRenderEnd();
    expect(t.calls.map((c) => c.args[2])).toEqual(Array.from({ length: 9 }, (_, k) => `Item${k}`));
  });

  test("without string data there is no text and no layout, but the dropdown is drawn", () => {
    const t = open(3);
    t.box.m_pStringData = null;
    t.box.m_iFocused = 1;
    t.box.onFrameRenderEnd();
    expect(drawnQuads(t.dev)).toEqual([{ texture: "DROP.TGA", rect: DROP }]);
    expect(t.calls).toEqual([]);
  });

  test("a box without a dropdown texture draws no dropdown, one without a highlight texture no highlight (the text is still spoken)", () => {
    const t = open(3);
    t.box.m_pDropdownTex = null;
    t.box.m_pDropdownTextTex = null;
    t.box.m_iFocused = 1;
    t.box.onFrameRenderEnd();
    expect(drawnQuads(t.dev)).toEqual([]);
    expect(t.calls.length).toBe(3);
  });

  test("a row is highlighted only when it is the focused one and the box is not static", () => {
    const t = open(3);
    t.box.m_iFocused = -1;
    t.box.onFrameRenderEnd();
    expect(drawnQuads(t.dev).map((q) => q.texture)).toEqual(["DROP.TGA"]);
    const from = t.dev.log.length;
    t.box.m_iFocused = 2;
    t.box.onFrameRenderEnd();
    // row 2 is at 84 .. 93: rc (100, 82, 230, 95), drawn at (111, 102, 241, 115)
    expect(drawnQuads(t.dev, from)).toEqual([{ texture: "DROP.TGA", rect: DROP }, { texture: "ROW.TGA", rect: [111, 102, 241, 115] }]);
  });

  test("a static box draws the control of each visible row at (the dropdown's left, the row's top - 2), in order, no text and no highlight", () => {
    const t = scene();
    t.box.m_bOpened = true;
    t.box.m_bIsStaticComboBox = true;
    t.box.m_nStaticHeight = 11;
    t.box.m_iFocused = 1;
    const probes = [t.probe(), t.probe(), t.probe()];
    probes.forEach((p, k) => t.row(`row${k}`, p));
    t.row("without a control");
    t.box.onFrameRenderEnd();
    // the rows are at 66, 77, 88, 99; their controls at (100, 64), (100, 75), (100, 86)
    expect(probes.map((p) => p.seen)).toEqual([[[100, 64]], [[100, 75]], [[100, 86]]]);
    expect(drawnQuads(t.dev)).toEqual([{ texture: "DROP.TGA", rect: DROP }]);
    expect(t.calls).toEqual([]);
  });

  test("a closed static box does not draw its controls (it only lays the rows out)", () => {
    const t = scene();
    t.box.m_bIsStaticComboBox = true;
    t.box.m_nStaticHeight = 11;
    const p = t.probe();
    t.row("a", p);
    t.box.onFrameRenderEnd();
    expect(p.seen).toEqual([]);
  });
});

describe("OnFrameRenderEnd: the scroll bar of an open box is drawn when the rows do not fit the dropdown's height", () => {
  function counted(nItems: number, dropHeight: number, opts: { static?: boolean } = {}) {
    const t = scene();
    t.box.m_bOpened = true;
    t.box.m_nDropHeight = dropHeight;
    if (opts.static) {
      t.box.m_bIsStaticComboBox = true;
      t.box.m_nStaticHeight = 11;
    }
    for (let k = 0; k < nItems; k++) t.row(`Item${k}`);
    const b = t.bar();
    let drawn = 0;
    b.onFrameRender = () => { drawn++; return 0; };
    t.box.onFrameRenderEnd();
    return drawn;
  }

  test("rows * 9 above m_nDropHeight: drawn; equal or below: not", () => {
    expect(counted(12, 107)).toBe(1); // 108 > 107
    expect(counted(12, 108)).toBe(0); // 108 is not above 108
    expect(counted(12, 109)).toBe(0);
    expect(counted(11, 98)).toBe(1); // 99
    expect(counted(11, 99)).toBe(0);
  });

  test("a static box counts m_nStaticHeight (11) a row", () => {
    expect(counted(10, 109, { static: true })).toBe(1); // 110 > 109
    expect(counted(10, 110, { static: true })).toBe(0);
  });

  test("it is drawn after the rows, and only by an open box that has a bar (a non-static one also needs a font)", () => {
    const t = scene();
    t.box.m_bOpened = true;
    t.box.m_nDropHeight = 10;
    for (let k = 0; k < 4; k++) t.row(`Item${k}`);
    const b = t.bar();
    let at = -1;
    b.onFrameRender = () => { at = t.calls.length; return 0; };
    t.box.onFrameRenderEnd();
    expect(at).toBe(4);
    // closed
    at = -1;
    t.box.m_bOpened = false;
    t.box.onFrameRenderEnd();
    expect(at).toBe(-1);
    // open, no font
    t.box.m_bOpened = true;
    t.box.m_pStringData = null;
    t.box.onFrameRenderEnd();
    expect(at).toBe(-1);
    // open, no bar (nothing to draw and no failure)
    t.box.m_pScrollBar = null;
    expect(t.box.onFrameRenderEnd()).toBe(0);
    // a static box needs no font for its bar, only the bar
    t.box.m_bIsStaticComboBox = true;
    t.box.m_nStaticHeight = 11;
    t.box.m_pScrollBar = b;
    t.box.onFrameRenderEnd();
    expect(at).toBe(4);
    t.box.m_pScrollBar = null;
    expect(t.box.onFrameRenderEnd()).toBe(0);
  });
});

describe("the dialog draws the combo box in two passes", () => {
  test("OnFrameRender of every control first, then OnFrameRenderEnd of every control: the dropdown is over the controls drawn after the box", () => {
    const t = scene();
    t.box.m_bOpened = true;
    t.box.m_pStringData = null;
    const after = new CKTDGUIComboBox(t.w);
    place(t.dialog, after);
    setRect(after.m_rcButton, 300, 40, 330, 62);
    after.m_pButtonTex = t.tex("AFTER.TGA");
    t.dev.log.length = 0;
    t.dialog.onFrameRender();
    // the first box's button and text rectangle, the second box's button, then the first box's dropdown
    expect(drawnQuads(t.dev).map((q) => q.texture)).toEqual(["BTN.TGA", "TEXT.TGA", "AFTER.TGA", "DROP.TGA"]);
  });
});
