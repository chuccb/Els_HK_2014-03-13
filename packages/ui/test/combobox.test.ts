import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable } from "@els/assets";
import { index, LuaTable } from "@els/lua";
import {
  ARROWSTATE, CKTDGFontManager, CKTDGFreeTypeFont, CKTDGUIComboBox, CKTDGUIScrollBar, CKTDGUIStatic, CX2CouponBox, CX2PostBox, CX2SlotManager, UCT,
  UIFonts, UIM, UIWorld, UKFont,
} from "../src/index.ts";
import type { Rect } from "../src/index.ts";
import { indexAllKoms, KomMassFileSource } from "../../../tools/komindex.ts";
import { setup } from "./harness.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const t = test.skipIf(!haveData);

const rc = (r: Rect) => [r.left, r.top, r.right, r.bottom];

describe("CKTDGUIScrollBar", () => {
  test("the constructor's defaults (32984D70)", () => {
    const { w } = setup();
    const b = new CKTDGUIScrollBar(w);
    expect(b.m_ControlType).toBe(UCT.SCROLLBAR);
    expect([b.m_nPosition, b.m_nPageSize, b.m_nStart, b.m_nEnd]).toEqual([0, 1, 0, 1]);
    expect([b.m_bShowThumb, b.m_bDrag, b.m_bIsUpButtonClicked, b.m_bIsDownButtonClicked]).toEqual([true, false, false, false]);
    expect([b.m_bEnableThumb, b.m_bEnableTrack]).toEqual([true, true]);
    expect([b.m_Arrow, b.m_dArrowTS]).toEqual([ARROWSTATE.CLEAR, 0]);
    expect([b.m_x, b.m_y, b.m_width, b.m_height]).toEqual([0, 0, 0, 0]);
    expect([b.m_pUpButtonTex, b.m_pDownButtonTex, b.m_pUpButtonDownTex, b.m_pDownButtonDownTex, b.m_pTrackTex, b.m_pThumbTex]).toEqual([null, null, null, null, null, null]);
    expect(rc(b.m_rcTrack)).toEqual([0, 0, 0, 0]);
    expect([b.m_TempPoint.color.r, b.m_TempPoint.bUseTextureSize, b.m_TempPoint.kResize.x, b.m_TempPoint.m_iDrawCount]).toEqual([1, true, 1, 1]);
  });

  test("SetEnableTrack / SetEnableThumb (the registered one-line setters of 328CD4C0 / 328CD4B0)", () => {
    const { w, wrap, m } = setup();
    const b = new CKTDGUIScrollBar(w);
    const ud = wrap(b, "CKTDGUIScrollBar");
    m(ud, "SetEnableTrack", false);
    expect([b.m_bEnableTrack, b.m_bEnableThumb]).toEqual([false, true]);
    m(ud, "SetEnableThumb", false);
    m(ud, "SetEnableTrack", true);
    expect([b.m_bEnableTrack, b.m_bEnableThumb]).toEqual([true, false]);
  });

  test("UpdateRects: square buttons at both ends, the track between them, the thumb as wide as the bar", () => {
    const { w } = setup();
    const b = new CKTDGUIScrollBar(w);
    [b.m_x, b.m_y, b.m_width, b.m_height] = [10, 20, 16, 100];
    b.updateRects();
    expect(rc(b.m_rcBoundingBox)).toEqual([10, 20, 26, 120]);
    expect(rc(b.m_rcUpButton)).toEqual([10, 20, 26, 36]);
    expect(rc(b.m_rcDownButton)).toEqual([10, 104, 26, 120]);
    expect(rc(b.m_rcTrack)).toEqual([10, 36, 26, 104]);
    expect([b.m_rcThumb.left, b.m_rcThumb.right]).toEqual([10, 26]);
    // the default range (0..1) has no more than its page: nothing to drag
    expect([b.m_bShowThumb, b.m_rcThumb.top, b.m_rcThumb.bottom]).toEqual([false, 0, 0]);
  });

  test("UpdateThumbRect: the page's share of the track (at least 8 pixels) at the position's share of the rest", () => {
    const { w } = setup();
    const b = new CKTDGUIScrollBar(w);
    [b.m_x, b.m_y, b.m_width, b.m_height] = [10, 20, 16, 100]; // the track is 68 high, from 36
    b.updateRects();
    b.m_nPageSize = 3;
    b.setTrackRange(0, 10);
    expect([b.m_bShowThumb, b.m_rcThumb.top, b.m_rcThumb.bottom]).toEqual([true, 36, 56]); // 3 * 68 / 10 = 20
    b.setTrackPos(7);
    expect([b.m_nPosition, b.m_rcThumb.top, b.m_rcThumb.bottom]).toEqual([7, 84, 104]); // 36 + 48 * 7 / 7
    b.setTrackPos(3);
    expect([b.m_rcThumb.top, b.m_rcThumb.bottom]).toEqual([36 + Math.trunc((48 * 3) / 7), 36 + Math.trunc((48 * 3) / 7) + 20]);
    b.m_nPageSize = 1;
    b.setTrackRange(0, 100);
    expect(b.m_rcThumb.bottom - b.m_rcThumb.top).toBe(8); // 68 / 100 = 0: the minimum
  });

  test("Cap / SetTrackPos / SetTrackRange / Scroll keep the position inside [start, end - page]", () => {
    const { w } = setup();
    const b = new CKTDGUIScrollBar(w);
    b.m_nPageSize = 3;
    b.setTrackRange(2, 12);
    expect(b.m_nPosition).toBe(2); // below the start
    b.setTrackPos(100);
    expect(b.m_nPosition).toBe(9); // end - page
    b.setTrackPos(-5);
    expect(b.m_nPosition).toBe(2);
    b.scroll(4);
    expect(b.m_nPosition).toBe(6);
    b.scroll(-100);
    expect(b.m_nPosition).toBe(2);
    b.setTrackRange(0, 3); // no longer than the page: the start
    b.setTrackPos(1);
    expect(b.m_nPosition).toBe(0);
    b.m_nPosition = 40;
    b.cap();
    expect(b.m_nPosition).toBe(0);
  });

  test("ShowItem: scrolls only as far as it takes to bring the item into the page", () => {
    const { w } = setup();
    const b = new CKTDGUIScrollBar(w);
    b.m_nPageSize = 3;
    b.setTrackRange(0, 10);
    b.showItem(1);
    expect(b.m_nPosition).toBe(0); // already in the page 0..2
    b.showItem(5);
    expect(b.m_nPosition).toBe(3); // item 5 is the last row of the page
    b.showItem(4);
    expect(b.m_nPosition).toBe(3);
    b.showItem(2);
    expect(b.m_nPosition).toBe(2); // above the page: it becomes the first row
    b.showItem(99);
    expect(b.m_nPosition).toBe(7); // the last item is end - 1
    b.showItem(-4);
    expect(b.m_nPosition).toBe(0);
  });

  test("a texture setter takes the pointer it is given and destroys the one it had", () => {
    const { w, m, wrap } = setup();
    const combo = new CKTDGUIComboBox(w);
    const cud = wrap(combo, "CKTDGUIComboBox");
    m(cud, "SetScollBarThumbTex", "SB.TGA", "THUMB");
    const first = combo.m_pScollBarThumbTex!;
    const bar = new CKTDGUIScrollBar(w);
    bar.setThumbTex(first);
    expect(bar.m_pThumbTex).toBe(first);
    expect(first.pTexture).not.toBeNull();
    const second = combo.m_pScollBarTrackTex;
    bar.setThumbTex(second);
    expect(first.pTexture).toBeNull(); // ~UITextureData
    expect(bar.m_pThumbTex).toBeNull();
    const t = (m(cud, "SetScollBarTrackTex", "SB.TGA", "TRACK"), combo.m_pScollBarTrackTex!);
    bar.setTrackTex(t);
    bar.setUpButtonTex(t);
    bar.setUpButtonDownTex(t);
    bar.setDownButtonTex(t);
    bar.setDownButtonDownTex(t);
    const out: unknown[] = [];
    bar.textureData(out as never);
    expect(out.length).toBe(5);
  });
});

describe("CKTDGUIComboBox", () => {
  function box() {
    const s = setup();
    const d = s.dialog();
    d.m_pStage = s.stage;
    const b = new CKTDGUIComboBox(s.w);
    d.AddControl(b);
    return { ...s, d, b, ud: s.wrap(b, "CKTDGUIComboBox") };
  }
  const stringData = (fontIndex: number) => {
    const t = new LuaTable();
    t.setStr("FONT_INDEX", fontIndex);
    return t;
  };

  test("the constructor's defaults (3293B660)", () => {
    const { w } = setup();
    const b = new CKTDGUIComboBox(w);
    expect(b.m_ControlType).toBe(UCT.COMBOBOX);
    expect([b.m_iSelected, b.m_iFocused]).toEqual([-1, -1]);
    expect([b.m_nDropHeight, b.m_nStaticHeight, b.m_bIsStaticComboBox, b.m_nSBWidth]).toEqual([100, 0, false, 16]);
    expect([b.m_bOpened, b.m_bPressed, b.m_bMouseOverCheck, b.m_bIsReverseDropDown, b.m_bMousePointAdjust]).toEqual([false, false, false, false, false]);
    expect([b.m_TextStringOffsetPosX, b.m_TextStringOffsetPosY]).toEqual([5, 5]);
    expect([b.m_CustomMsgSelectionChanged, b.m_CustomMsgOpenDropdown, b.m_CustomMsgCloseDropdown]).toEqual([-1, -1, -1]);
    expect([b.m_bSelectTextShow, b.m_iTextLimit, b.m_ItemScriptName]).toEqual([true, 0, ""]);
    expect([b.m_pStringData, b.m_pScrollBar, b.m_Items.length]).toEqual([null, null, 0]);
    expect([b.m_pTextTex, b.m_pButtonTex, b.m_pDropdownTex, b.m_pScollBarThumbTex]).toEqual([null, null, null, null]);
    expect(rc(b.m_rcDropdown)).toEqual([0, 0, 0, 0]);
    expect([b.m_TempPoint.bUseTextureSize, b.m_TempPoint.color.a]).toEqual([true, 1]);
  });

  test("the twelve texture setters each fill their own pointer and destroy the texture they replace", () => {
    const { b, ud, m } = box();
    const fields = {
      SetTextTex: "m_pTextTex", SetButtonTex: "m_pButtonTex", SetButtonMouseOverTex: "m_pButtonMouseOverTex", SetButtonMouseDownTex: "m_pButtonMouseDownTex",
      SetDropdownTex: "m_pDropdownTex", SetDropdownTextTex: "m_pDropdownTextTex", SetScollBarUpButtonTex: "m_pScollBarUpButtonTex",
      SetScollBarUpButtonDownTex: "m_pScollBarUpButtonDownTex", SetScollBarDownButtonTex: "m_pScollBarDownButtonTex",
      SetScollBarDownButtonDownTex: "m_pScollBarDownButtonDownTex", SetScollBarTrackTex: "m_pScollBarTrackTex", SetScollBarThumbTex: "m_pScollBarThumbTex",
    } as const;
    for (const [lua, field] of Object.entries(fields)) {
      m(ud, lua, "C.TGA", lua);
      const first = b[field]!;
      expect(first.keyName).toBe(lua);
      expect(first.pTexture).not.toBeNull();
      m(ud, lua, "C.TGA", `${lua}2`);
      expect(first.pTexture).toBeNull();
      expect(b[field]!.keyName).toBe(`${lua}2`);
    }
    const all: unknown[] = [];
    b.textureData(all as never);
    expect(all.length).toBe(12);
  });

  test("UpdateRects of a plain box: a square button at the right end, the text up to it, the dropdown 0.9 of a text height below", () => {
    const { b, ud, m } = box();
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 24);
    expect(rc(b.m_rcBoundingBox)).toEqual([10, 20, 110, 44]);
    expect(rc(b.m_rcButton)).toEqual([86, 20, 110, 44]); // left = top + right - bottom
    expect(rc(b.m_rcText)).toEqual([10, 20, 86, 44]); // right = where the button begins
    // the dropdown: the text offset down by (int)(24 * 0.9f) = 21, then m_nDropHeight (100) below that rectangle's bottom
    expect(rc(b.m_rcDropdown)).toEqual([10, 41, 86, 165]);
    // its text area: 10% off each side ((int)(76 * 0.1f) = 7) and 10% down ((int)(124 * -0.1f) = -12 subtracted)
    expect(rc(b.m_rcDropdownText)).toEqual([17, 53, 79, 165]);
    m(ud, "SetDropHeight", 40);
    expect(b.m_nDropHeight).toBe(40);
    expect(rc(b.m_rcDropdown)).toEqual([10, 41, 86, 105]);
  });

  test("UpdateRects of a reverse dropdown: it opens upwards, twice the drop height above the text", () => {
    const { b, ud, m } = box();
    m(ud, "SetReverseDropdown", true);
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 24);
    expect(b.m_bIsReverseDropDown).toBe(true);
    expect(rc(b.m_rcDropdown)).toEqual([10, 20 - 200, 86, 20]);
  });

  test("UpdateRects of a static box: the bounding box is a button wider, the rows are m_nStaticHeight high", () => {
    const { b, ud, m } = box();
    m(ud, "SetStaticHeight", 18);
    expect([b.m_bIsStaticComboBox, b.m_nStaticHeight]).toEqual([true, 18]);
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 24);
    expect(rc(b.m_rcBoundingBox)).toEqual([10, 20, 134, 44]);
  });

  test("an explicit button and text rectangle replace the derived ones; the button grows by m_ButtonAdd*", () => {
    const { b, ud, m } = box();
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 24);
    m(ud, "SetButtonPos", 70, 22);
    expect(rc(b.m_rcButton)).toEqual([86, 20, 110, 44]); // a size is needed as well
    m(ud, "SetButtonSize", 30, 20);
    expect(rc(b.m_rcButton)).toEqual([70, 22, 100, 42]);
    expect(rc(b.m_rcText)).toEqual([10, 20, 70, 44]); // still up to the button
    m(ud, "SetTextPos", 12, 21);
    m(ud, "SetTextSize", 60, 22);
    expect(rc(b.m_rcText)).toEqual([12, 21, 72, 43]);
    m(ud, "SetButtonSize", 0, 0);
    m(ud, "SetButtonAddSize", 4, 7);
    // the derived button (86, 20, 110, 44), wider by 4 to the right and 7 / 2 = 3 taller on each side
    expect(rc(b.m_rcButton)).toEqual([86, 17, 114, 47]);
    m(ud, "SetButtonAddSize", 0, -7);
    expect([b.m_rcButton.top, b.m_rcButton.bottom]).toEqual([23, 41]); // -7 / 2 truncates toward zero: -3
  });

  test("SetTextStringOffsetPos and the message setters store without touching the rectangles", () => {
    const { b, ud, m } = box();
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 24);
    const before = rc(b.m_rcDropdown);
    m(ud, "SetTextStringOffsetPos", 7, 9);
    expect([b.m_TextStringOffsetPosX, b.m_TextStringOffsetPosY]).toEqual([7, 9]);
    m(ud, "SetCustomMsgSelectionChanged", 11);
    m(ud, "SetCustomMsgOpenDropdown", 12);
    m(ud, "SetCustomMsgCloseDropdown", 13);
    m(ud, "SetSelectTextShow", false);
    expect([b.m_CustomMsgSelectionChanged, b.m_CustomMsgOpenDropdown, b.m_CustomMsgCloseDropdown, b.m_bSelectTextShow]).toEqual([11, 12, 13, false]);
    expect(rc(b.m_rcDropdown)).toEqual(before);
  });

  test("SetString keeps the string data (font, colour ...) the table describes", () => {
    const { b, ud, m } = box();
    m(ud, "SetString", stringData(9));
    expect(b.m_pStringData?.fontIndex).toBe(9);
  });

  test("AddItem: the first item is selected and the selection message sent (0x466 0, or the custom id as 0x467)", () => {
    const { b, ud, m, stageLog } = box();
    m(ud, "AddItem", "one");
    expect([b.m_iSelected, b.m_iFocused, b.m_Items.length, b.m_Items[0]!.strText]).toEqual([0, 0, 1, "one"]);
    expect(stageLog).toEqual([[UIM.CONTROL_EVENT, 0]]);
    m(ud, "AddItem", "two");
    expect([b.m_iSelected, b.m_Items.length, stageLog.length]).toEqual([0, 2, 1]);
  });

  test("AddItem with a custom selection message sends that message as 0x467", () => {
    const { ud, m, stageLog } = box();
    m(ud, "SetCustomMsgSelectionChanged", 77);
    m(ud, "AddItem", "x");
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 77]]);
  });

  test("AddItem without a scroll bar sizes the dropdown: m_nStaticHeight per row (static), a font line per row, nothing without string data or font", () => {
    const { b, ud, m, w } = box();
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 24);
    m(ud, "AddItem", "a"); // no string data: the height stays
    expect(b.m_nDropHeight).toBe(100);
    m(ud, "SetString", stringData(5));
    m(ud, "AddItem", "b"); // string data, no such font
    expect(b.m_nDropHeight).toBe(100);
    w.fonts.addUKFont(5, new CKTDGFreeTypeFont("F", 13, 0, true, 400, 2, false)); // 26 pixels enlarged twice: a line is 26 / 2 + 1 = 14
    m(ud, "AddItem", "c");
    expect(b.m_nDropHeight).toBe(3 * 14);
    expect(rc(b.m_rcDropdown)).toEqual([10, 41, 86, 65 + 42]); // UpdateRects ran with the new height
    m(ud, "SetStaticHeight", 18);
    m(ud, "AddItem", "d");
    expect(b.m_nDropHeight).toBe(4 * 18);
  });

  test("AddItem keeps 255 characters of the text and none after a NUL", () => {
    const { b } = box();
    b.addItem("x".repeat(300), null, false);
    b.addItem("ab\0cd", null, false);
    expect(b.m_Items[0]!.strText.length).toBe(255);
    expect(b.m_Items[1]!.strText).toBe("ab");
  });

  test("AddItem(…, false) selects the first item without sending the message", () => {
    const { b, stageLog } = box();
    b.addItem("a", { id: 1 }, false);
    expect([b.m_iSelected, stageLog.length, b.m_Items[0]!.pData]).toEqual([0, 0, { id: 1 }]);
  });

  test("AddItemStrID adds the text of the string table", () => {
    const strings = { get: (i: number) => (i === 3 ? "three\0ignored" : "?") };
    const { b, ud, m, w } = box();
    (w as unknown as { strings: unknown }).strings = strings;
    m(ud, "AddItemStrID", 3);
    expect(b.m_Items[0]!.strText).toBe("three");
  });

  test("InitScrollBar: a bar in the box's dialog with the box's six textures; the items then give it its range and AddItem leaves the drop height alone", () => {
    const { b, ud, m, d } = box();
    m(ud, "SetScollBarDownButtonTex", "SB.TGA", "DOWN");
    m(ud, "SetScollBarDownButtonDownTex", "SB.TGA", "DOWN_DOWN");
    m(ud, "SetScollBarUpButtonTex", "SB.TGA", "UP");
    m(ud, "SetScollBarUpButtonDownTex", "SB.TGA", "UP_DOWN");
    m(ud, "SetScollBarTrackTex", "SB.TGA", "TRACK");
    m(ud, "SetScollBarThumbTex", "SB.TGA", "THUMB");
    m(ud, "InitScrollBar");
    const bar = b.m_pScrollBar!;
    expect(bar).toBeInstanceOf(CKTDGUIScrollBar);
    expect(bar.m_pDialog).toBe(d);
    expect([bar.m_pDownButtonTex, bar.m_pDownButtonDownTex, bar.m_pUpButtonTex, bar.m_pUpButtonDownTex, bar.m_pTrackTex, bar.m_pThumbTex]).toEqual([
      b.m_pScollBarDownButtonTex, b.m_pScollBarDownButtonDownTex, b.m_pScollBarUpButtonTex, b.m_pScollBarUpButtonDownTex, b.m_pScollBarTrackTex,
      b.m_pScollBarThumbTex,
    ]);
    m(ud, "AddItem", "a");
    m(ud, "AddItem", "b");
    expect([bar.m_nStart, bar.m_nEnd]).toEqual([0, 2]);
    expect(b.m_nDropHeight).toBe(100);
  });

  test("UpdateRects with a scroll bar: the bar stands right of the dropdown, its page is the rows that fit, the selected item is shown", () => {
    const { b, ud, m, w } = box();
    w.fonts.addUKFont(5, new CKTDGFreeTypeFont("F", 18, 0, true, 400, 1, false)); // 19 pixels per row
    m(ud, "SetString", stringData(5));
    m(ud, "InitScrollBar");
    for (let i = 0; i < 20; i++) b.addItem(`item ${i}`, null, false);
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 24);
    const bar = b.m_pScrollBar!;
    expect(rc(b.m_rcDropdown)).toEqual([10, 41, 86, 165]);
    expect([bar.m_x, bar.m_y, bar.m_width, bar.m_height]).toEqual([86, 43, 16, 122]);
    expect(rc(bar.m_rcBoundingBox)).toEqual([86, 43, 102, 165]);
    expect(rc(b.m_rcDropdownText)).toEqual([17, 53, 63, 165]); // the bar's width is off the right of the text area
    expect(bar.m_nPageSize).toBe(Math.trunc((165 - 53) / 19)); // 5
    expect([bar.m_nStart, bar.m_nEnd]).toEqual([0, 20]);
    b.SetSelectedByIndex(12);
    b.updateRects();
    expect(bar.m_nPosition).toBe(12 - bar.m_nPageSize + 1); // item 12 is the last row of the page
  });

  test("UpdateRects of a static box with a scroll bar divides by m_nStaticHeight; without a font a non-static one is a null dereference", () => {
    const a = box();
    a.m(a.ud, "SetString", stringData(5));
    a.m(a.ud, "InitScrollBar");
    expect(() => a.m(a.ud, "SetPos", 1, 2)).toThrow(/no UK font/);
    const b = box();
    b.m(b.ud, "SetString", stringData(5));
    b.m(b.ud, "InitScrollBar");
    b.m(b.ud, "SetStaticHeight", 0);
    expect(() => b.m(b.ud, "SetPos", 1, 2)).toThrow(/division by zero/);
    b.m(b.ud, "SetStaticHeight", 10);
    b.m(b.ud, "SetSize", 100, 24);
    expect(b.b.m_pScrollBar!.m_nPageSize).toBe(Math.trunc((b.b.m_rcDropdownText.bottom - b.b.m_rcDropdownText.top) / 10));
  });

  test("AddControl: a row named like the control that is given the box's dialog; the first one is selected and the message always sent", () => {
    const { b, ud, d, m, w, wrap, stageLog } = box();
    const c1 = new CKTDGUIStatic(w);
    c1.setNameByForce("first");
    const c2 = new CKTDGUIStatic(w);
    c2.setNameByForce("second");
    expect(m(ud, "AddControl", wrap(c1, "CKTDGUIStatic"))[0]).toBe(0);
    expect([b.m_Items[0]!.strText, b.m_Items[0]!.pControl, c1.m_pDialog]).toEqual(["first", c1, d]);
    expect([b.m_iSelected, b.m_iFocused]).toEqual([0, 0]);
    expect(stageLog).toEqual([[UIM.CONTROL_EVENT, 0]]);
    m(ud, "AddControl", wrap(c2, "CKTDGUIStatic"));
    expect([b.m_Items.length, b.m_iSelected, stageLog.length]).toEqual([2, 0, 1]);
    expect(() => m(ud, "AddControl", undefined)).toThrow(); // the binder reads a class pointer: nil is "no class at first argument"
    expect(b.AddControl(undefined)).toBe(0); // (called from TS)
    expect(b.m_Items.length).toBe(2);
  });

  test("SetSelectedByIndex: an index past the items (or a negative one) is E_INVALIDARG; a valid one selects, focuses and sends the message", () => {
    const { b, ud, m, stageLog } = box();
    b.addItem("a", null, false);
    b.addItem("b", null, false);
    const E_INVALIDARG = -2147024809;
    expect(m(ud, "SetSelectedByIndex", 2)[0]).toBe(E_INVALIDARG);
    expect(m(ud, "SetSelectedByIndex", -1)[0]).toBe(E_INVALIDARG);
    expect(stageLog.length).toBe(0);
    expect(m(ud, "SetSelectedByIndex", 1)[0]).toBe(0);
    expect([b.m_iSelected, b.m_iFocused, stageLog]).toEqual([1, 1, [[UIM.CONTROL_EVENT, 0]]]);
    m(ud, "SetCustomMsgSelectionChanged", 5);
    m(ud, "SetSelectedByIndex", 0);
    expect(stageLog.at(-1)).toEqual([UIM.CUSTOM_MSG, 5]);
    m(ud, "SetUnSelected");
    expect([b.m_iSelected, b.m_iFocused]).toEqual([-1, -1]);
  });
});

describe("CKTDGFontManager (g_pFontManager)", () => {
  test("CKTDGFreeTypeFont's constructor: the size is enlargeNum * height, the cache cell has the outline on both sides, the enlargement is at least 1", () => {
    const f = new CKTDGFreeTypeFont("Face", 13, 1, true, 600, 3, true);
    expect([f.m_iFontSize, f.m_iOrgFontSize, f.m_EnlargeNum, f.m_iFontCacheSize, f.m_iOutLineSize, f.m_iFontWeight, f.m_bRHW, f.m_bNoRes]).toEqual([
      39, 39, 3, 43, 1, 600, true, true,
    ]);
    expect(f.m_bLoad).toBe(false);
    const g = new CKTDGFreeTypeFont("Face", 13, 2, true, 400, 0, false);
    expect([g.m_EnlargeNum, g.m_iFontSize]).toEqual([1, 0]); // the clamp does not reach the size
  });

  test("CreateNewUIUKFont lists the font and enters it under its id; MapUIFontToUKFont maps to a font that exists; CreateNewUIFont does nothing", () => {
    const fonts = new UIFonts();
    const mgr = new CKTDGFontManager(fonts);
    mgr.CreateNewUIFont(1, "Face", 13, 600);
    expect([mgr.m_UKFontList.length, fonts.m_mapUKFontList.size]).toEqual([0, 0]);
    mgr.CreateNewUIUKFont(30, "Face", 13, 600, 1, 1, true);
    mgr.CreateNewUIUKFont(31, undefined, 15, 600, 2, 0, true);
    expect(mgr.m_UKFontList.length).toBe(2);
    const f30 = fonts.getUKFont(30)!;
    expect(f30).toBeInstanceOf(UKFont);
    expect([f30.m_pUKFont!.m_strFontName, f30.m_pUKFont!.m_iFontSize, f30.lineHeight()]).toEqual(["Face", 13, 14]);
    expect([fonts.getUKFont(31)!.m_pUKFont!.m_strFontName, fonts.getUKFont(31)!.lineHeight()]).toEqual(["", 30 / 2 + 1]);
    mgr.MapUIFontToUKFont(5, 30);
    mgr.MapUIFontToUKFont(6, 99);
    expect(fonts.getMappedUKFont(5)).toBe(f30);
    expect(fonts.getMappedUKFont(6)).toBeNull();
  });

  test("a UK font without a glyph font is a null dereference when a control asks for its line height", () => {
    expect(() => new UKFont(1).lineHeight()).toThrow(/null/);
  });
});

describe("the UI classes that publish their own global", () => {
  test("CX2PostBox is g_pPostBoxInventory and CX2CouponBox g_pCouponBox; neither is g_pCX2SlotManager", () => {
    const { w } = setup();
    const { postBox, couponBox } = w.createOwners();
    const g = w.world.G.globals;
    expect([postBox, couponBox].every((o) => o instanceof CX2SlotManager)).toBe(true);
    expect((g.getStr("g_pPostBoxInventory") as { data: unknown }).data).toBe(postBox);
    expect((g.getStr("g_pCouponBox") as { data: unknown }).data).toBe(couponBox);
    expect(g.getStr("g_pCX2SlotManager")).toBeUndefined();
    new CX2SlotManager(w).registerLuaBind();
    expect((g.getStr("g_pCX2SlotManager") as { data: unknown }).data).not.toBe(postBox);
    expect(new CX2PostBox(w)).toBeInstanceOf(CX2SlotManager);
    expect(new CX2CouponBox(w)).toBeInstanceOf(CX2SlotManager);
  });
});

// ---- the real client data ---------------------------------------------------------------------------------------------------

let source: KomMassFileSource;
let strings: StringTable;

beforeAll(async () => {
  if (!haveData) return;
  source = new KomMassFileSource(await indexAllKoms(), 64 * 1024);
  strings = StringTable.fromEss(new Uint8Array(readFileSync(join(dataDir, "general.ess"))));
}, 60_000);

describe("the start-up config and the combo boxes of the real scripts", () => {
  t("Config_HK_SERVICE.lua makes the UK fonts through g_pFontManager; its calls to g_pMain are recorded, not run", async () => {
    await source.settle(() => {
      const w = new UIWorld({ source, strings, notPorted: "throw" });
      w.boot();
      const id = (name: string) => w.world.G.globals.getStr(name) as number;
      // (name, height, enlargeNum, outline size); the weight is FW_SEMIBOLD and bNoRes false (`KPRI 1`) for all
      const made: [string, number, number, number][] = [
        ["XUF_DODUM_11_NORMAL", 13, 1, 1],
        ["XUF_DODUM_13_SEMIBOLD", 15, 1, 1],
        ["XUF_DODUM_15_BOLD", 17, 1, 1],
        ["XUF_DODUM_20_BOLD", 23, 1, 1],
        ["XUF_HEADLINE_30_NORMAL", 33, 1, 1],
        ["XUF_DODUM_11_NORMAL_MAPPED", 13, 1, 0],
        ["XUF_DODUM_15_NORMAL_MAPPED", 17, 1, 0],
      ];
      expect(w.fontManager.m_UKFontList.length).toBe(made.length);
      for (const [name, height, enlarge, outline] of made) {
        const font = w.fonts.getUKFont(id(name))!;
        const ft = font.m_pUKFont!;
        expect([name, ft.m_strFontName, ft.m_iFontSize, ft.m_EnlargeNum, ft.m_iOutLineSize, ft.m_bNoRes, ft.m_bRHW]).toEqual([name, "DFPPOP1W7U-B5", height, enlarge, outline, false, true]);
        expect(font.lineHeight()).toBe(height + 1);
      }
      // MapUIFontToUKFont
      expect(w.fonts.getMappedUKFont(id("XF_DODUM_11_NORMAL"))).toBe(w.fonts.getUKFont(id("XUF_DODUM_11_NORMAL_MAPPED")));
      expect(w.fonts.getMappedUKFont(id("XF_DODUM_15_NORMAL"))).toBe(w.fonts.getUKFont(id("XUF_DODUM_15_NORMAL_MAPPED")));
      // what the script asked of g_pMain went to the recorder (and the world is strict again)
      const calls = w.world.rt.notPortedCalls;
      expect([...calls.entries()].filter(([k]) => k.startsWith("CX2Main.")).map(([k, v]) => [k.replace(/ @.*/, ""), v]).sort()).toContainEqual(["CX2Main.InstallFont", 3]);
      expect(w.world.rt.notPorted).toBe("throw");
      return 0;
    });
  }, 60_000);

  t("the controls open the sounds UI_Control_Sound.lua names (ScrollBar_Mouse_Down, ComboBox_Mouse_Down, ComboBox_Mouse_Over) when the sound system is up", async () => {
    await source.settle(() => {
      const w = new UIWorld({ source, strings, notPorted: "throw" });
      w.boot();
      w.devices.soundSystemInitialised = true;
      w.devices.massFiles.isValidFile = () => true;
      const g = (name: string) => String(w.world.G.globals.getStr(name)).toUpperCase();
      const bar = new CKTDGUIScrollBar(w);
      const combo = new CKTDGUIComboBox(w);
      expect(bar.m_pSndMouseDown?.deviceID).toBe(g("ScrollBar_Mouse_Down"));
      expect([combo.m_pSndButtonMouseDown?.deviceID, combo.m_pSndButtonMouseOver?.deviceID]).toEqual([g("ComboBox_Mouse_Down"), g("ComboBox_Mouse_Over")]);
      expect(bar.m_pSndMouseDown?.deviceID).not.toBe("UNDEFINED");
      return 0;
    });
  }, 60_000);

  t("DLG_FIND_USER.LUA: a reverse dropdown with a scroll bar, explicit text and button rectangles", async () => {
    await source.settle(() => {
      const w = new UIWorld({ source, strings, notPorted: "throw" });
      w.boot();
      w.createOwners();
      const d = w.openDialog("DLG_FIND_USER.LUA", 0, new CX2SlotManager(w));
      expect(d.m_bSuccessInitOpenScript).toBe(true);
      const c = d.m_ControlsList.find((x) => x instanceof CKTDGUIComboBox) as CKTDGUIComboBox;
      expect(c.m_Name).toBe("ComboBoxUser_Search_Window");
      expect([c.m_bIsReverseDropDown, c.m_nDropHeight, c.m_TextStringOffsetPosX, c.m_TextStringOffsetPosY]).toEqual([true, 50, 39, 6]);
      expect(rc(c.m_rcText)).toEqual([450, 352, 600, 377]); // SetTextPos / SetTextSize
      expect(rc(c.m_rcButton)).toEqual([610, 352, 633, 375]); // SetButtonPos / SetButtonSize
      expect(rc(c.m_rcDropdown)).toEqual([450, 252, 600, 352]); // twice 50 above the text
      expect(rc(c.m_rcDropdownText)).toEqual([465, 262, 569, 352]); // 15 off each side, the bar's 16 off the right
      const bar = c.m_pScrollBar!;
      expect([bar.m_x, bar.m_y, bar.m_width, bar.m_height]).toEqual([600, 254, 16, 98]);
      // XUF_DODUM_13_SEMIBOLD is 15 pixels: a row is 16, so 90 / 16 rows fit
      expect([c.m_pStringData!.fontIndex, bar.m_nPageSize]).toEqual([w.world.G.globals.getStr("XUF_DODUM_13_SEMIBOLD") as number, 5]);
      const G = w.world.G;
      expect(c.m_CustomMsgSelectionChanged).toBe(index(G.main, G.globals.getStr("STATE_MENU_UI_CUSTOM_MSG"), "SMUCM_FIND_USER_SELECT") as number);
      expect(c.m_CustomMsgSelectionChanged).not.toBe(-1);
      expect([bar.m_pUpButtonTex, bar.m_pThumbTex, bar.m_pTrackTex, bar.m_pDownButtonTex].every((x) => x !== null && x.pTexture !== null)).toBe(true);
      return 0;
    });
  }, 60_000);
});
