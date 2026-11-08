/**
 * The strings the controls draw (stringdraw.ts: `CKTDGUIStatic::OnFrameRender` 3292A2B0, `CKTDGUIButton::OnFrameRender` 3292ED40,
 * `CKTDGUIRadioButton::OnFrameRender` 3294AE80).  The first half puts a spy on the UK font, so what the control asks of the font is
 * what the tests pin, argument by argument; the second half draws on a real glyph font (the box font of fontworld.ts) and looks at the
 * quads that reach the device.  Every expected number is worked out from the decompile: the arithmetic is in the comments, and the
 * float products were checked with a script that rounds each operation to a float.
 *
 * The scene: the dialog is at (10.25, 20.5) with the colour (r 0.5, g 0.75, b 0.9, a 0.8); the control has the colour (0.9, 0.6, 0.3, 0.7) and
 * the offset (0.75, 0.25); the string is at (3.8, 5.9) in (0.7, 0.4, 0.2, 0.9) with the outline (0.1, 0.2, 0.3, 0.5).  So
 *   x = (float)(10.25 + 3.8) + 0.75 = 14.8 (cut to 14), y = (float)(20.5 + 5.9) + 0.25 = 26.65 (cut to 26),
 *   colour channel = (float)(dialog * string) * control: r 0.315 -> 80, g 0.18 -> 46, b 0.054 -> 14, a 0.504 -> 129: 0x81502E0E,
 *   outline: r 0.045 -> 11, g 0.09 -> 23, b 0.081 -> 21, a 0.28 -> 71: 0x470B1715
 * (a channel is `c < 1 ? (c > 0 ? (int)(c * 255 + 0.5) : 0) : 255`).
 */
import { describe, expect, test } from "bun:test";
import { CKTDGUIButton, CKTDGUIDialog, CKTDGUIRadioButton, CKTDGUIStatic, CPictureData, UIStringData, drawUKString, draw2DString, spreadText, stringColors, stringPosition } from "../src/index.ts";
import type { UKFont } from "../src/index.ts";
import { fontWorld } from "./fontworld.ts";
import { drawnCalls, quad, rig } from "./rig.ts";
import type { DrawnCall, Recorder } from "./rig.ts";

const COLOR = 0x81502e0e;
const OUTLINE = 0x470b1715;
/** the colours as the floats the exe leaves them in (`Draw2DText` takes them so) */
const COLOR_F = { r: 0.3149999976158142, g: 0.18000000715255737, b: 0.05400000140070915, a: 0.5039999485015869 };
const OUTLINE_F = { r: 0.044999998062849045, g: 0.09000000357627869, b: 0.08100000768899918, a: 0.2800000011920929 };

/** the string data of the scene (UK font 2, `SORT_FLAG` 5, `FONT_STYLE` 2) */
function data(msg = "Hi", over: Partial<UIStringData> = {}): UIStringData {
  const d = new UIStringData();
  d.fontIndex = 2;
  d.msg = msg;
  d.pos.set(3.8, 5.9);
  d.color.set(0.7, 0.4, 0.2, 0.9);
  d.outlineColor.set(0.1, 0.2, 0.3, 0.5);
  d.sortFlag = 5;
  d.fontStyle = 2;
  return Object.assign(d, over);
}

/** the dialog and the control the scene puts a string in */
function place(dialog: CKTDGUIDialog, control: CKTDGUIStatic | CKTDGUIButton | CKTDGUIRadioButton): void {
  dialog.m_Pos.set(10.25, 20.5);
  dialog.m_Color.set(0.5, 0.75, 0.9, 0.8);
  dialog.AddControl(control);
  control.m_Color.set(0.9, 0.6, 0.3, 0.7);
  control.m_OffsetPos.set(0.75, 0.25);
}

interface Call {
  method: string;
  args: unknown[];
  /** how many lines the device log had when the font was called: what was drawn before */
  log: number;
}

/** a UK font (id `id`, no glyph font) whose drawing calls are written down instead of made */
function spied(dev: Recorder, ukFonts: { addUKFont(id: number): UKFont }, id: number, calls: Call[]): UKFont {
  const font = ukFonts.addUKFont(id);
  font.OutTextMultiline = ((...args: unknown[]) => { calls.push({ method: "OutTextMultiline", args, log: dev.log.length }); }) as UKFont["OutTextMultiline"];
  font.Draw2DText = ((...args: unknown[]) => { calls.push({ method: "Draw2DText", args, log: dev.log.length }); }) as UKFont["Draw2DText"];
  return font;
}

/** `OutTextMultiline(x, y, text, colour, style, outline, 1.0, no rectangle, sortFlag, all, 1.0, 1.0)` */
const outText = (text: string, x = 14, y = 26, color = COLOR, style = 2, outline = OUTLINE, flag = 5) => [x, y, text, color, style, outline, 1, null, flag, -1, 1, 1];

describe("stringColors and stringPosition: what the three controls work out before they draw a string", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    const control = new CKTDGUIStatic(s.w);
    place(dialog, control);
    return { dialog, control };
  }

  test("the colour is (dialog * string) * control for each of a, r, g, b, every product rounded to a float; the outline the same from the outline colour", () => {
    const { dialog, control } = scene();
    const { color, outline } = stringColors(dialog, control, data());
    expect(color).toEqual(COLOR_F);
    expect(outline).toEqual(OUTLINE_F);
    // every channel has its own factors: a different colour in one place changes that channel and no other
    const d = data();
    d.color.set(0.7, 0.4, 1, 0.9); // blue 1: (0.9 * 1) * 0.3, floats: 0.27000001072883606
    expect(stringColors(dialog, control, d).color).toEqual({ ...COLOR_F, b: 0.27000001072883606 });
    d.outlineColor.set(0.5, 0.2, 0.3, 0.5); // red 0.5: (0.5 * 0.5) * 0.9: 0.22499999403953552
    expect(stringColors(dialog, control, d).outline).toEqual({ ...OUTLINE_F, r: 0.22499999403953552 });
  });

  test("the place is (dialog.m_Pos + string.pos) + control.m_OffsetPos, in floats, not yet cut: (14.8, 26.65)", () => {
    const { dialog, control } = scene();
    const { x, y } = stringPosition(dialog, control, data());
    expect([x, y]).toEqual([14.800000190734863, 26.649999618530273]);
    dialog.m_Pos.set(-30.5, 0);
    control.m_OffsetPos.set(0, -40);
    const p = stringPosition(dialog, control, data());
    // -30.5 + 3.8 = -26.7 (+ 0); (0 + 5.9) - 40 = -34.1: floats
    expect([p.x, p.y]).toEqual([-26.700000762939453, -34.099998474121094]);
  });

  test("every sum and product is rounded to a float before the next one: (a + b) + c and (d * s) * c, neither a sum of three nor s * c first", () => {
    const { dialog, control } = scene();
    // 0.1f + 0.2f = 0.3 (as a float) and + 1.1f gives 1.4000000953674316; in one step it would be 1.399999976158142 (the y: 0.1 + 0.7, + 1.1)
    dialog.m_Pos.set(0.1, 0.1);
    control.m_OffsetPos.set(1.1, 1.1);
    const d = data();
    d.pos.set(0.2, 0.7);
    const p = stringPosition(dialog, control, d);
    expect([p.x, p.y]).toEqual([1.4000000953674316, 1.9000000953674316]);
    // 0.3 * 0.3 = 0.09 (a float) * 0.9 is 0.08100000023841858; (0.3 * 0.3 * 0.9) in one step would be 0.08100000768899918, 0.3 * (0.3 * 0.9) too
    dialog.m_Color.set(0.3, 0.3, 0.3, 0.3);
    control.m_Color.set(0.55, 0.55, 0.65, 0.9);
    d.color.set(0.7, 0.35, 0.65, 0.3);
    d.outlineColor.set(0.7, 0.35, 0.65, 0.3);
    const want = { r: 0.11550001055002213, g: 0.05775000527501106, b: 0.12675000727176666, a: 0.08100000023841858 };
    const { color, outline } = stringColors(dialog, control, d);
    expect(color).toEqual(want);
    expect(outline).toEqual(want);
  });

  test("a spreading string shows min(iSpreadCount, length) characters; a negative count is the string constructor's length error", () => {
    expect(spreadText(data("Hello", { iSpreadCount: 3 }))).toBe("Hel");
    expect(spreadText(data("Hello", { iSpreadCount: 0 }))).toBe("");
    expect(spreadText(data("Hello", { iSpreadCount: 5 }))).toBe("Hello");
    expect(spreadText(data("Hello", { iSpreadCount: 9 }))).toBe("Hello");
    expect(() => spreadText(data("Hello", { iSpreadCount: -1 }))).toThrow(/negative spread count/);
  });
});

describe("the strings of a static (3292A2B0): after the pictures, in order, through the UK font (or the font map)", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    const control = new CKTDGUIStatic(s.w);
    place(dialog, control);
    const calls: Call[] = [];
    const font = spied(s.dev, s.w.fonts, 2, calls);
    return { ...s, dialog, control, calls, font };
  }

  test("a string with text goes to OutTextMultiline(14, 26, text, colour, style, outline colour, 1.0, no rectangle, sortFlag, -1, 1.0, 1.0)", () => {
    const { control, calls, w } = scene();
    control.m_StringDataList.push(data());
    expect(control.onFrameRender()).toBe(0);
    expect(calls.map((c) => [c.method, c.args])).toEqual([["OutTextMultiline", outText("Hi")]]);
    expect([...w.render!.undrawn]).toEqual([]);
  });

  test("the strings are drawn in the order of the list, each with its own font, place, style and flag; one without text is skipped", () => {
    const { control, calls, w, dev } = scene();
    const second = spied(dev, w.fonts, 6, calls);
    void second;
    control.m_StringDataList.push(data("One"), data("", { fontIndex: 6 }), data("Three", { fontIndex: 6, fontStyle: 1, sortFlag: 0x21 }));
    control.m_StringDataList[2]!.pos.set(1, 2);
    control.onFrameRender();
    // (10.25 + 1) + 0.75 = 12, (20.5 + 2) + 0.25 = 22.75 -> 22
    expect(calls.map((c) => c.args)).toEqual([outText("One"), outText("Three", 12, 22, COLOR, 1, OUTLINE, 0x21)]);
  });

  test("the pictures come first (the quad is on the device when the font is called), the strings after them", () => {
    const { control, calls, w, dev, wrap, m, point } = scene();
    const picture = new CPictureData(w);
    const ud = wrap(picture, "CKTDGUIControl::CPictureData");
    m(ud, "SetTex", "P.TGA", "K");
    m(ud, "SetPoint", point(10, 20));
    control.AddPicture(picture);
    control.m_StringDataList.push(data());
    control.onFrameRender();
    // tex, fvf, src, draw for the quad
    expect(dev.log).toEqual(["tex 0 P.TGA", "fvf 324", "src 12 28", "draw 5 0 2"]);
    expect(calls.map((c) => c.log)).toEqual([4]);
  });

  test("a hidden static draws no string; a string that is not there is not drawn", () => {
    const { control, calls } = scene();
    control.m_StringDataList.push(data());
    control.m_bShow = false;
    control.onFrameRender();
    expect(calls).toEqual([]);
    control.m_bShow = true;
    control.m_StringDataList.length = 0;
    control.onFrameRender();
    expect(calls).toEqual([]);
  });

  test("SPREAD: the first iSpreadCount characters (the part is passed, the whole message is not); a spreading string with count 0 is still drawn, empty", () => {
    const { control, calls } = scene();
    control.m_StringDataList.push(data("Hello", { bSpread: true, iSpreadCount: 3 }), data("Hello", { bSpread: true, iSpreadCount: 0 }), data("Hello", { bSpread: true, iSpreadCount: 7 }), data("Hello", { bSpread: false, iSpreadCount: 2 }));
    control.onFrameRender();
    expect(calls.map((c) => c.args[2])).toEqual(["Hel", "", "Hello", "Hello"]);
  });

  test("USE_UK_FONT = false: the font index is mapped to a UK font (MapUIFontToUKFont) and Draw2DText gets the text, the place, the colours as floats, the flag, the style and the length of the text", () => {
    const { control, calls, w } = scene();
    w.fonts.mapUIFontToUKFont(7, 2);
    control.m_StringDataList.push(data("Hi", { bUseUkFont: false, fontIndex: 7 }), data("Hello", { bUseUkFont: false, fontIndex: 7, bSpread: true, iSpreadCount: 4 }));
    control.onFrameRender();
    expect(calls.map((c) => [c.method, c.args])).toEqual([
      ["Draw2DText", ["Hi", 14, 26, COLOR_F, OUTLINE_F, 5, 2, 2]],
      ["Draw2DText", ["Hell", 14, 26, COLOR_F, OUTLINE_F, 5, 2, 4]],
    ]);
  });

  test("a font index that is not mapped has no font: Draw2DText on null is the exe's crash; the UK-font lookup is not touched", () => {
    const { control, w } = scene();
    control.m_StringDataList.push(data("Hi", { bUseUkFont: false, fontIndex: 8 }));
    expect(() => control.onFrameRender()).toThrow(/Draw2DText: there is no UK font for the font index 8/);
    expect(w.fonts.m_mapUKFontList.has(8)).toBe(false);
  });

  test("the UK font of an index nobody made is null, and map[index] enters that null (std::map::operator[]); OutTextMultiline on it is the exe's crash", () => {
    const { control, w } = scene();
    control.m_StringDataList.push(data("Hi", { fontIndex: 9 }));
    expect(w.fonts.m_mapUKFontList.has(9)).toBe(false);
    expect(() => control.onFrameRender()).toThrow(/OutTextMultiline: there is no UK font for the font index 9/);
    expect(w.fonts.m_mapUKFontList.has(9)).toBe(true);
    expect(w.fonts.m_mapUKFontList.get(9)).toBeNull();
  });

  test("a mapped font index whose UK font is not there is null too (the lookup of the map's value enters a null)", () => {
    const { control, w } = scene();
    w.fonts.m_mapFontToUKFont.set(4, 12);
    control.m_StringDataList.push(data("Hi", { bUseUkFont: false, fontIndex: 4 }));
    expect(() => control.onFrameRender()).toThrow(/Draw2DText: there is no UK font for the font index 4/);
    expect(w.fonts.m_mapUKFontList.get(12)).toBeNull();
  });

  test("a control in no dialog has no dialog colour or place: the exe uses a null object, the port throws", () => {
    const s = rig();
    const control = new CKTDGUIStatic(s.w);
    s.w.fonts.addUKFont(2);
    control.m_StringDataList.push(data());
    expect(() => control.onFrameRender()).toThrow(/in no dialog/);
  });

  test("the movies are still not drawn: they are counted (the strings are not)", () => {
    const { control, w } = scene();
    control.m_StringDataList.push(data());
    control.m_MovieDataList.push({} as never);
    control.onFrameRender();
    expect([...w.render!.undrawn]).toEqual([["CMovieData::OnFrameRender", 1]]);
  });
});

describe("the string of a button (3292ED40): after the quad and the edge, always when there is string data", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    const b = new CKTDGUIButton(s.w);
    place(dialog, b);
    const ud = s.wrap(b, "CKTDGUIButton");
    s.m(ud, "SetNormalTex", "B.TGA", "N");
    s.m(ud, "SetNormalPoint", s.point(10, 20));
    const calls: Call[] = [];
    spied(s.dev, s.w.fonts, 2, calls);
    return { ...s, dialog, b, calls };
  }

  test("the quad first (4 lines on the device), then OutTextMultiline with the same arithmetic as the static's: the control's own colour and offset", () => {
    const { b, calls, dev, w } = scene();
    b.m_pStringData = data();
    b.onFrameRender();
    expect(dev.log).toEqual(["tex 0 B.TGA", "fvf 324", "src 12 28", "draw 5 0 2"]);
    expect(calls.map((c) => [c.method, c.args, c.log])).toEqual([["OutTextMultiline", outText("Hi"), 4]]);
    expect([...w.render!.undrawn]).toEqual([]);
  });

  test("an empty message is drawn too (the font gets the empty text); no string data, nothing", () => {
    const { b, calls } = scene();
    b.m_pStringData = data("");
    b.onFrameRender();
    expect(calls.map((c) => c.args[2])).toEqual([""]);
    calls.length = 0;
    b.m_pStringData = null;
    b.onFrameRender();
    expect(calls).toEqual([]);
  });

  test("a hidden button draws nothing, neither quad nor string; the button always asks for UK font `fontIndex`, whatever USE_UK_FONT says", () => {
    const { b, calls, dev } = scene();
    b.m_pStringData = data("Hi", { bUseUkFont: false });
    b.m_bShow = false;
    b.onFrameRender();
    expect([dev.log, calls]).toEqual([[], []]);
    b.m_bShow = true;
    b.onFrameRender();
    expect(calls.map((c) => c.method)).toEqual(["OutTextMultiline"]);
  });

  test("the focused button's edge is drawn before the quad (outside) and after it (on it), both before the string", () => {
    const { b, calls, dev } = scene();
    b.m_pStringData = data();
    b.m_bHasFocus = true;
    b.m_EdgeWidth = 2;
    b.onFrameRender();
    const draws = dev.log.filter((l) => l.startsWith("draw ")).length;
    expect(draws).toBe(9); // 4 bars, the quad, 4 bars
    expect(calls.map((c) => c.log)).toEqual([dev.log.length]);
  });
});

describe("the string of a radio button (3294AE80): after the background and the checked edge, before the check point", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    const r = new CKTDGUIRadioButton(s.w);
    place(dialog, r);
    r.m_MyNowPoint.assign(quad(s.w, 10, 20, "BG.TGA"));
    r.m_pCheckedPoint = quad(s.w, 100, 120, "CHK.TGA");
    const calls: Call[] = [];
    spied(s.dev, s.w.fonts, 2, calls);
    return { ...s, dialog, r, calls };
  }

  test("unchecked: the background, then the string", () => {
    const { r, calls, dev } = scene();
    r.m_pStringData = data();
    r.onFrameRender();
    expect(dev.log).toEqual(["tex 0 BG.TGA", "fvf 324", "src 12 28", "draw 5 0 2"]);
    expect(calls.map((c) => [c.method, c.args, c.log])).toEqual([["OutTextMultiline", outText("Hi"), 4]]);
  });

  test("checked: the background, the string, and last the quad of the check point", () => {
    const { r, calls, dev } = scene();
    r.m_pStringData = data("Hi", { sortFlag: 9 });
    r.m_bChecked = true;
    r.onFrameRender();
    expect(calls.map((c) => [c.args[8], c.log])).toEqual([[9, 4]]);
    expect(dev.log.slice(4)).toEqual(["tex 0 CHK.TGA", "fvf 324", "src 12 28", "draw 5 4 2"]);
  });

  test("checked with a checked edge: the bars outside, the background, the bars on it, then the string, and last the check point", () => {
    const { r, calls, dev } = scene();
    r.m_pStringData = data();
    r.m_bChecked = true;
    r.m_CheckedEdgeWidth = 2;
    r.onFrameRender();
    const drawsBefore = (n: number): number => dev.log.slice(0, n).filter((l) => l.startsWith("draw ")).length;
    expect(calls.map((c) => drawsBefore(c.log))).toEqual([9]); // 4 bars, the quad, 4 bars
    expect(drawsBefore(dev.log.length)).toBe(10); // the quad of the check point comes after the string
  });

  test("no string data, no string; an empty message is drawn", () => {
    const { r, calls } = scene();
    r.onFrameRender();
    expect(calls).toEqual([]);
    r.m_pStringData = data("");
    r.onFrameRender();
    expect(calls.map((c) => c.args[2])).toEqual([""]);
  });
});

describe("through a glyph font: the quads that reach the device (the box font at 16 px, no outline; the world is 1024 x 768 so the scale is 1)", () => {
  /** the rectangles [left, top, right, bottom] of the glyph quads (a list of six vertices each) */
  const rects = (calls: DrawnCall[]): number[][] =>
    calls.flatMap((c) => {
      const out: number[][] = [];
      for (let i = 0; i < c.vertices.length; i += 6) out.push([c.vertices[i]![0]!, c.vertices[i]![1]!, c.vertices[i + 4]![0]!, c.vertices[i + 4]![1]!]);
      return out;
    });
  const colorsOf = (calls: DrawnCall[]): number[] => calls.flatMap((c) => c.vertices.filter((_, i) => i % 6 === 0).map((v) => v[c.stride === 28 ? 4 : 3]!));

  function real() {
    const s = fontWorld({}, { device: true, backBuffer: { width: 1024, height: 768 } });
    const ft = s.font(16, 0, 1, true, true);
    expect(ft.Load()).toBe(true);
    s.w.fonts.addUKFont(2, ft);
    s.dev!.log.length = 0;
    return { ...s, dev: s.dev!, ft };
  }

  // A (cell 10 x 14) and B (12 x 15), the pen moves by the width less 1 (9): at (x, y) = (14, 26) the quads are [14, 26, 24, 40] and [23, 26, 35, 41]
  const AB = [[14, 26, 24, 40], [23, 26, 35, 41]];

  test("a static: OutTextMultiline at (14, 26) in the colour 0x81502E0E, without an outline pass (the font has no outline)", () => {
    const { w, dev } = real();
    const dialog = new CKTDGUIDialog(w);
    const control = new CKTDGUIStatic(w);
    place(dialog, control);
    control.m_StringDataList.push(data("AB", { sortFlag: 0 }));
    control.onFrameRender();
    const calls = drawnCalls(dev);
    expect(calls.map((c) => [c.type, c.prims])).toEqual([[4, 4]]);
    expect(rects(calls)).toEqual(AB);
    expect(colorsOf(calls)).toEqual([COLOR, COLOR]);
    expect(w.render!.states.stackPointer).toBe(0);
  });

  test("a static whose string does not use a UK font: Draw2DText, one line (flag 0x20) at the same place", () => {
    const { w, dev } = real();
    w.fonts.mapUIFontToUKFont(7, 2);
    const dialog = new CKTDGUIDialog(w);
    const control = new CKTDGUIStatic(w);
    place(dialog, control);
    control.m_StringDataList.push(data("AB", { bUseUkFont: false, fontIndex: 7, sortFlag: 0x20 }));
    control.onFrameRender();
    const calls = drawnCalls(dev);
    expect(rects(calls)).toEqual(AB);
    expect(colorsOf(calls)).toEqual([COLOR, COLOR]);
  });

  test("a spreading static shows only the first characters: 1 of AB", () => {
    const { w, dev } = real();
    const dialog = new CKTDGUIDialog(w);
    const control = new CKTDGUIStatic(w);
    place(dialog, control);
    control.m_StringDataList.push(data("AB", { bSpread: true, iSpreadCount: 1, sortFlag: 0 }));
    control.onFrameRender();
    expect(rects(drawnCalls(dev))).toEqual([AB[0]!]);
  });

  test("a button and a radio button draw their string the same way", () => {
    const { w, dev } = real();
    const dialog = new CKTDGUIDialog(w);
    const b = new CKTDGUIButton(w);
    place(dialog, b);
    b.m_pStringData = data("AB", { sortFlag: 0 });
    b.onFrameRender();
    expect(rects(drawnCalls(dev))).toEqual(AB);
    dev.log.length = 0;
    const r = new CKTDGUIRadioButton(w);
    dialog.AddControl(r);
    r.m_Color.set(0.9, 0.6, 0.3, 0.7);
    r.m_OffsetPos.set(0.75, 0.25);
    r.m_pStringData = data("AB", { sortFlag: 0 });
    r.onFrameRender();
    expect(rects(drawnCalls(dev))).toEqual(AB);
    expect(colorsOf(drawnCalls(dev))).toEqual([COLOR, COLOR]);
  });

  test("the style: SHELL keeps the outline colour for a font with an outline, and the outline pass comes before the text", () => {
    const s = fontWorld({}, { device: true, backBuffer: { width: 1024, height: 768 } });
    const ft = s.font(16, 1, 1, true, true);
    expect(ft.Load()).toBe(true);
    s.w.fonts.addUKFont(2, ft);
    s.dev!.log.length = 0;
    const dialog = new CKTDGUIDialog(s.w);
    const control = new CKTDGUIStatic(s.w);
    place(dialog, control);
    control.m_StringDataList.push(data("A", { sortFlag: 0 }));
    control.onFrameRender();
    // two passes: the outline page first in the colour 0x470B1715, then the glyph in 0x81502E0E
    expect(colorsOf(drawnCalls(s.dev!))).toEqual([OUTLINE, COLOR]);
  });
});

describe("drawUKString and draw2DString as functions", () => {
  test("they are what the controls call: a font that is not there is the error, the dialog is looked up after the font", () => {
    const s = rig();
    const control = new CKTDGUIStatic(s.w);
    expect(() => drawUKString(s.w, control, data("Hi", { fontIndex: 3 }), "Hi")).toThrow(/in no dialog/);
    expect(s.w.fonts.m_mapUKFontList.has(3)).toBe(true); // the lookup came first
    expect(() => draw2DString(s.w, control, data("Hi", { fontIndex: 3 }), "Hi")).toThrow(/in no dialog/);
    // the same for the font map: the font index 5 is mapped to the UK font 12, which is looked up (and entered as a null) before the dialog
    s.w.fonts.m_mapFontToUKFont.set(5, 12);
    expect(() => draw2DString(s.w, control, data("Hi", { fontIndex: 5 }), "Hi")).toThrow(/in no dialog/);
    expect(s.w.fonts.m_mapUKFontList.has(12)).toBe(true);
  });
});
