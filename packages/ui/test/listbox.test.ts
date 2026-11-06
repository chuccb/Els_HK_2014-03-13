import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable } from "@els/assets";
import { LuaTable } from "@els/lua";
import { Color, Vec2 } from "@els/host";
import {
  CKTDGFreeTypeFont, CKTDGUIItem, CKTDGUIListBox, CKTDGUIScrollBar, CKTDGUIStatic, CPictureData, CX2SlotManager, LBIT, UCT, UIM, UIWorld,
} from "../src/index.ts";
import type { Rect } from "../src/index.ts";
import { indexAllKoms, KomMassFileSource } from "../../../tools/komindex.ts";
import { setup } from "./harness.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const t = test.skipIf(!haveData);

const rc = (r: Rect) => [r.left, r.top, r.right, r.bottom];

const stringData = (fontIndex: number) => {
  const table = new LuaTable();
  table.setStr("FONT_INDEX", fontIndex);
  return table;
};

/** a list box in a dialog with a stage; font 1 is registered (a 15 pixel font: a row is 15 / 1 + 1 = 16) */
function box(strings?: StringTable) {
  const s = setup(strings);
  const d = s.dialog();
  d.m_pStage = s.stage;
  const b = new CKTDGUIListBox(s.w);
  d.AddControl(b);
  s.w.fonts.addUKFont(1, new CKTDGFreeTypeFont("F", 15, 0, true, 400, 1, false));
  return { ...s, d, b, ud: s.wrap(b, "CKTDGUIListBox") };
}

describe("CPictureData.setDefaultPoint / setSize (the SetPoint() 32925F30 and SetSize 32926600 that C++ code calls)", () => {
  test("setDefaultPoint gives a picture with a texture a point as big as the texture, and leaves a picture that has one alone", () => {
    const { w } = setup();
    const p = new CPictureData(w);
    p.setDefaultPoint(); // no texture: nothing
    expect(p.pPoint).toBeNull();
    p.SetTex("T.TGA", "KEY");
    p.setDefaultPoint();
    const pt = p.pPoint!;
    expect([p.pos.x, p.pos.y, p.size.x, p.size.y, p.originalPos.x, p.originalSize.x, p.originalSize.y]).toEqual([0, 0, 64, 32, 0, 64, 32]);
    expect([pt.leftTopPoint.x, pt.rightTopPoint.x, pt.leftBottomPoint.y, pt.rightBottomPoint.x, pt.rightBottomPoint.y]).toEqual([0, 64, 32, 64, 32]);
    p.size.set(5, 5);
    p.setDefaultPoint();
    expect(p.pPoint).toBe(pt);
    expect(p.size.x).toBe(5);
  });

  test("setSize rewrites the corners from the left-top one; the original size stays what SetPoint made it", () => {
    const { w } = setup();
    const p = new CPictureData(w);
    p.SetTex("T.TGA", "KEY");
    p.setDefaultPoint();
    p.setSize(new Vec2(62, 29));
    const pt = p.pPoint!;
    expect([p.size.x, p.size.y, p.originalSize.x, p.originalSize.y]).toEqual([62, 29, 64, 32]);
    expect([pt.rightTopPoint.x, pt.rightTopPoint.y, pt.leftBottomPoint.x, pt.leftBottomPoint.y, pt.rightBottomPoint.x, pt.rightBottomPoint.y]).toEqual([62, 0, 0, 29, 62, 29]);
  });

  test("setSize on a picture with a texture and no point makes the point first (the new size is the original size); with neither it is log 0x159", () => {
    const { w } = setup();
    const p = new CPictureData(w);
    p.SetTex("T.TGA", "KEY");
    p.setSize(new Vec2(10, 20));
    expect([p.pPoint !== null, p.originalSize.x, p.originalSize.y, p.size.x, p.size.y]).toEqual([true, 10, 20, 10, 20]);
    expect([p.pPoint!.rightBottomPoint.x, p.pPoint!.rightBottomPoint.y]).toEqual([10, 20]);
    const q = new CPictureData(w);
    q.setSize(new Vec2(3, 4));
    expect([q.size.x, q.size.y, q.pPoint]).toEqual([3, 4, null]);
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x159, text: "" }]);
  });
});

describe("CKTDGUIItem (3293B600)", () => {
  test("a static with a width and a height of 0; CreateItem makes one and the class is a registered implementation", () => {
    const { w, dialog } = setup();
    const item = dialog().CreateItem();
    expect(item).toBeInstanceOf(CKTDGUIItem);
    expect(item).toBeInstanceOf(CKTDGUIStatic);
    expect([item.m_ControlType, item.m_Width, item.m_Height, item.m_bEnable]).toEqual([UCT.STATIC, 0, 0, false]);
    const status = w.world.rt.status().find((c) => c.cls === "CKTDGUIItem")!;
    expect([status.lua, status.total, status.missing]).toEqual(["CKTDGUIItem", 0, []]); // it registers no method of its own
  });
});

describe("CKTDGUIListBox", () => {
  test("the constructor's defaults (329410D0)", () => {
    const { w } = setup();
    const b = new CKTDGUIListBox(w);
    expect(b.m_ControlType).toBe(UCT.LISTBOX);
    expect([b.m_nSBWidth, b.m_nBorder, b.m_nMargin, b.m_nSelected]).toEqual([16, 6, 5, -1]);
    expect([b.m_bShowTextTex, b.m_bDrag, b.m_bIsStaticListBox, b.m_bIgnoreListClick, b.m_bUseItemDisappear]).toEqual([true, false, false, false, false]);
    expect([b.m_bUpdateScrollBarOnUpdate, b.m_bScrollToEndOnUpdateRects, b.m_bIsSelectItemAtMouseMove]).toEqual([true, false, false]);
    expect([b.m_CustomMsgSelection, b.m_CustomMsgSelection_End, b.m_CustomMsgItemDoubleClick, b.m_CustomMsgSelectionByRButton]).toEqual([-1, -1, -1, -1]);
    expect([b.m_BlankWidthByDepth, b.m_BlankWidthToGroupMark]).toEqual([5, 10]);
    expect([b.m_GroupMarkOffsetPos.x, b.m_GroupMarkOffsetPos.y, b.m_GroupMarkAddSize.x, b.m_GroupMarkAddSize.y]).toEqual([-10, -1, -2, -3]);
    expect([b.m_pStringData, b.m_pGroupStringData, b.m_pScrollBar, b.m_Items.length, b.m_ItemScriptName]).toEqual([null, null, null, 0, ""]);
    expect([b.m_pBoudingBoxTex, b.m_pTextTex, b.m_pButtonMouseOverTex, b.m_pScollBarThumbTex, b.m_pUKFont, b.m_pGroupUKFont]).toEqual([null, null, null, null, null, null]);
    expect([b.m_x, b.m_y, b.m_width, b.m_height]).toEqual([0, 0, 0, 0]);
    expect([rc(b.m_rcText), rc(b.m_rcSelection), rc(b.m_rcBoundingBox)]).toEqual([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    expect([b.m_TempPoint.bUseTextureSize, b.m_TempPoint.color.a]).toEqual([true, 1]);
  });

  test("the group mark is a static with the pictures Plus_Box and Minus_Box of DLG_Messenger.tga, each the texture's size plus the add size", () => {
    const { w } = setup();
    const b = new CKTDGUIListBox(w);
    const pics = b.m_pGroupMark.m_PictureDataList;
    expect(b.m_pGroupMark).toBeInstanceOf(CKTDGUIStatic);
    expect(pics.map((p) => [p.pTexture!.texName, p.pTexture!.keyName])).toEqual([["DLG_Messenger.tga", "Plus_Box"], ["DLG_Messenger.tga", "Minus_Box"]]);
    for (const p of pics) {
      expect([p.size.x, p.size.y, p.originalSize.x, p.originalSize.y]).toEqual([64 - 2, 32 - 3, 64, 32]);
      const pt = p.pPoint!;
      expect([pt.rightTopPoint.x, pt.leftBottomPoint.y, pt.rightBottomPoint.x, pt.rightBottomPoint.y]).toEqual([62, 29, 62, 29]);
    }
    // a Static opens UIEdge.tga as well
    expect(b.m_pGroupMark.m_pEdgeTexture).toBeDefined();
  });

  test("the nine texture setters each fill their own pointer and destroy the texture they replace", () => {
    const { b, ud, m } = box();
    const fields = {
      SetBoundingBoxTex: "m_pBoudingBoxTex", SetTextTex: "m_pTextTex", SetButtonMouseOverTex: "m_pButtonMouseOverTex",
      SetScollBarUpButtonTex: "m_pScollBarUpButtonTex", SetScollBarUpButtonDownTex: "m_pScollBarUpButtonDownTex",
      SetScollBarDownButtonTex: "m_pScollBarDownButtonTex", SetScollBarDownButtonDownTex: "m_pScollBarDownButtonDownTex",
      SetScollBarTrackTex: "m_pScollBarTrackTex", SetScollBarThumbTex: "m_pScollBarThumbTex",
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
    expect(all.length).toBe(9);
  });

  test("the one-line setters write their own members", () => {
    const { b, ud, m } = box();
    m(ud, "SetCustomMsgSelection", 11);
    m(ud, "SetCustomMsgSelection_End", 12);
    m(ud, "SetCustomMsgItemDoubleClick", 13);
    m(ud, "SetCustomMsgSelectionByRButton", 14);
    expect([b.m_CustomMsgSelection, b.m_CustomMsgSelection_End, b.m_CustomMsgItemDoubleClick, b.m_CustomMsgSelectionByRButton]).toEqual([11, 12, 13, 14]);
    m(ud, "SetIgnoreListClick", true);
    m(ud, "SetUseItemDisappear", true);
    m(ud, "SetUpdateScrollBarOnUpdate", false);
    m(ud, "SetScrollToEndOnUpdateRects", true);
    m(ud, "SetSelectItemAtMouseMove", true);
    expect([b.m_bIgnoreListClick, b.m_bUseItemDisappear, b.m_bUpdateScrollBarOnUpdate, b.m_bScrollToEndOnUpdateRects, b.m_bIsSelectItemAtMouseMove]).toEqual([
      true, true, false, true, true,
    ]);
    expect(b.m_dwStyle).toBe(0);
    m(ud, "SetMultiSelection");
    expect(b.m_dwStyle).toBe(1);
    m(ud, "SetStaticHeight", 18);
    expect([b.m_bIsStaticListBox, b.m_nTextHeight]).toEqual([true, 18]);
  });

  test("SetString / SetGroupString keep the string data and the UK font of its font index (null when there is none)", () => {
    const { b, ud, m, w } = box();
    m(ud, "SetString", stringData(5));
    m(ud, "SetGroupString", stringData(6));
    expect([b.m_pStringData!.fontIndex, b.m_pGroupStringData!.fontIndex, b.m_pUKFont, b.m_pGroupUKFont]).toEqual([5, 6, null, null]);
    w.fonts.addUKFont(5, new CKTDGFreeTypeFont("F", 13, 0, true, 400, 1, false));
    m(ud, "SetString", stringData(5));
    expect(b.m_pUKFont).toBe(w.fonts.getUKFont(5)!);
    expect(b.m_pGroupUKFont).toBeNull();
    m(ud, "SetString", stringData(1));
    expect(b.m_pUKFont).toBe(w.fonts.getUKFont(1)!);
  });

  test("UpdateRects of a plain box: the scroll bar's width off the right, the border off every side, the margin off the text's left and right", () => {
    const { b, ud, m } = box();
    m(ud, "SetString", stringData(1));
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 80);
    expect(rc(b.m_rcBoundingBox)).toEqual([10, 20, 110, 100]);
    expect(rc(b.m_rcSelection)).toEqual([16, 26, 88, 94]); // right 110 - 16 = 94, then 6 off every side
    expect(rc(b.m_rcText)).toEqual([21, 26, 83, 94]);
    m(ud, "SetScrollBarWidth", 30);
    expect(rc(b.m_rcSelection)).toEqual([16, 26, 74, 94]);
    expect(rc(b.m_rcText)).toEqual([21, 26, 69, 94]);
  });

  test("UpdateRects of a static box: no border and no margin", () => {
    const { b, ud, m } = box();
    m(ud, "SetString", stringData(1));
    m(ud, "SetStaticHeight", 20);
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 80);
    expect(rc(b.m_rcSelection)).toEqual([10, 20, 94, 100]);
    expect(rc(b.m_rcText)).toEqual([10, 20, 94, 100]);
  });

  test("UpdateRects without string data is a null dereference; with string data whose font is not registered it is a message box and no more", () => {
    const strings = new StringTable(Object.assign(new Array<string>(956).fill(""), { 954: "font not registered", 955: "list box error" }));
    const { b, ud, m, w } = box(strings);
    expect(() => m(ud, "SetPos", 1, 2)).toThrow(/string data/);
    expect([b.m_x, b.m_y]).toEqual([1, 2]);
    m(ud, "SetString", stringData(9)); // no font 9
    const bar = (m(ud, "InitScrollBar")[0] as { data: CKTDGUIScrollBar }).data;
    bar.m_x = 500;
    m(ud, "SetSize", 100, 80);
    expect(w.messageBoxes).toEqual([{ text: "font not registered", caption: "list box error" }]);
    // the rectangles were computed before the font was asked for, the bar was not touched
    expect(rc(b.m_rcBoundingBox)).toEqual([1, 2, 101, 82]);
    expect([bar.m_x, bar.m_width, bar.m_nPageSize]).toEqual([500, 0, 1]);
  });

  test("InitScrollBar returns a bar in the box's dialog that draws with the box's six textures", () => {
    const { b, ud, m, d } = box();
    m(ud, "SetScollBarDownButtonTex", "SB.TGA", "DOWN");
    m(ud, "SetScollBarDownButtonDownTex", "SB.TGA", "DOWN_DOWN");
    m(ud, "SetScollBarUpButtonTex", "SB.TGA", "UP");
    m(ud, "SetScollBarUpButtonDownTex", "SB.TGA", "UP_DOWN");
    m(ud, "SetScollBarTrackTex", "SB.TGA", "TRACK");
    m(ud, "SetScollBarThumbTex", "SB.TGA", "THUMB");
    const [ret] = m(ud, "InitScrollBar");
    const bar = b.m_pScrollBar!;
    expect(bar).toBeInstanceOf(CKTDGUIScrollBar);
    expect((ret as { data: unknown }).data).toBe(bar); // the script gets the bar
    expect(bar.m_pDialog).toBe(d);
    expect([bar.m_pDownButtonTex, bar.m_pDownButtonDownTex, bar.m_pUpButtonTex, bar.m_pUpButtonDownTex, bar.m_pTrackTex, bar.m_pThumbTex]).toEqual([
      b.m_pScollBarDownButtonTex, b.m_pScollBarDownButtonDownTex, b.m_pScollBarUpButtonTex, b.m_pScollBarUpButtonDownTex, b.m_pScollBarTrackTex,
      b.m_pScollBarThumbTex,
    ]);
  });

  test("the script can call the bar's methods on what InitScrollBar returned", () => {
    const { b, ud, m } = box();
    const [bar] = m(ud, "InitScrollBar");
    m(bar, "SetEnableTrack", false);
    m(bar, "SetEnableThumb", false);
    expect([b.m_pScrollBar!.m_bEnableTrack, b.m_pScrollBar!.m_bEnableThumb]).toEqual([false, false]);
  });

  test("SetScrollBarPos / SetScrollBarSize move the bar and update its rectangles; SetScrollBarTrackRange needs no bar, the other two do", () => {
    const { b, ud, m } = box();
    expect(() => m(ud, "SetScrollBarPos", 1, 2)).toThrow(/scroll bar/);
    expect(() => m(ud, "SetScrollBarSize", 1, 2)).toThrow(/scroll bar/);
    m(ud, "SetScrollBarTrackRange", 0, 5); // no bar: nothing
    m(ud, "InitScrollBar");
    const bar = b.m_pScrollBar!;
    m(ud, "SetScrollBarPos", 300, 40);
    m(ud, "SetScrollBarSize", 16, 120);
    expect([bar.m_x, bar.m_y, bar.m_width, bar.m_height]).toEqual([300, 40, 16, 120]);
    expect(rc(bar.m_rcBoundingBox)).toEqual([300, 40, 316, 160]);
    expect(rc(bar.m_rcTrack)).toEqual([300, 56, 316, 144]);
    m(ud, "SetScrollBarTrackRange", 2, 9);
    expect([bar.m_nStart, bar.m_nEnd]).toEqual([2, 9]);
  });

  test("UpdateRects with a bar: it stands right of the box and as high, its page is the rows that fit the text area, the selected row is shown", () => {
    const { b, ud, m } = box();
    const bar = (m(ud, "InitScrollBar")[0] as { data: CKTDGUIScrollBar }).data;
    m(ud, "SetString", stringData(1));
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 80);
    for (let i = 0; i < 10; i++) m(ud, "AddItem", `row ${i}`);
    expect([bar.m_x, bar.m_y, bar.m_width, bar.m_height]).toEqual([110, 20, 16, 80]);
    expect(rc(bar.m_rcBoundingBox)).toEqual([110, 20, 126, 100]);
    expect(rc(bar.m_rcTrack)).toEqual([110, 36, 126, 84]);
    // the text area is 94 - 26 = 68 high: four 16 pixel rows
    expect([bar.m_nPageSize, bar.m_nStart, bar.m_nEnd, bar.m_nPosition]).toEqual([4, 0, 10, 0]);
    expect([bar.m_rcThumb.top, bar.m_rcThumb.bottom]).toEqual([36, 36 + 19]); // 4 * 48 / 10
    b.selectItem(9, false);
    expect(bar.m_nPosition).toBe(6); // 9 - 4 + 1
    expect([bar.m_rcThumb.top, bar.m_rcThumb.bottom]).toEqual([36 + 29, 84]);
    b.selectItem(0, false);
    expect(bar.m_nPosition).toBe(0);
    // UpdateRects shows the selected row, or, when asked to, the end of the list
    m(ud, "SetSize", 100, 80);
    expect(bar.m_nPosition).toBe(0);
    m(ud, "SetScrollToEndOnUpdateRects", true);
    m(ud, "SetSize", 100, 80);
    expect(bar.m_nPosition).toBe(6); // the end (10) capped to the last full page
    // a static box's page is the text area over the row height
    m(ud, "SetStaticHeight", 25);
    m(ud, "SetSize", 100, 80);
    expect(bar.m_nPageSize).toBe(3); // 80 / 25 (no border: the text area is 80 high)
    m(ud, "SetStaticHeight", 0);
    expect(() => m(ud, "SetSize", 100, 80)).toThrow(/division by zero/);
  });

  test("SetUpdateScrollBarOnUpdate(false): UpdateRects leaves the bar's place and size alone but still sets its page", () => {
    const { b, ud, m } = box();
    const bar = (m(ud, "InitScrollBar")[0] as { data: CKTDGUIScrollBar }).data;
    m(ud, "SetString", stringData(1));
    m(ud, "SetUpdateScrollBarOnUpdate", false);
    m(ud, "SetScrollBarPos", 500, 600);
    m(ud, "SetScrollBarSize", 18, 90);
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 80);
    expect([bar.m_x, bar.m_y, bar.m_width, bar.m_height, bar.m_nPageSize]).toEqual([500, 600, 18, 90, 4]);
    expect(b.m_nSBWidth).toBe(16);
  });

  test("AddItem adds a plain row (no selection, no message) with the ListBoxItem constructor's defaults; the scroll bar learns the length", () => {
    const { b, ud, m, stageLog } = box();
    m(ud, "InitScrollBar");
    expect(m(ud, "AddItem", "first")).toEqual([]);
    const item = b.m_Items[0]!;
    expect([item.strText, item.pData, item.pControl, item.bSelected]).toEqual(["first", null, null, false]);
    expect([item.itemType, item.itemDepth, item.bSpread, item.fSpreadTimeGap, item.iSpreadCount, item.fNowSpreadTime]).toEqual([LBIT.DEFAULT, 0, false, 0, 0, 0]);
    expect([item.m_bShow, item.m_fTimeLeftShow, item.m_bColor, item.m_bMegaSelect, item.m_bMegaOver, item.m_bMyMessage, item.m_wstrData, item.m_iMessageID]).toEqual([
      true, -1, false, false, false, false, "", -1,
    ]);
    expect([item.m_color.r, item.m_color.g, item.m_color.b, item.m_color.a]).toEqual([1, 1, 1, 1]);
    expect(rc(item.rcActive)).toEqual([0, 0, 0, 0]);
    expect([b.m_nSelected, stageLog.length]).toEqual([-1, 0]);
    m(ud, "AddItem", "second");
    expect([b.m_pScrollBar!.m_nStart, b.m_pScrollBar!.m_nEnd]).toEqual([0, 2]);
  });

  test("AddItem keeps 255 characters of the text and none after a NUL", () => {
    const { b } = box();
    b.addItem("x".repeat(300), null, 0, 0, false, 0);
    b.addItem("ab\0cd", null, 0, 0, false, 0);
    expect(b.m_Items[0]!.strText.length).toBe(255);
    expect(b.m_Items[1]!.strText).toBe("ab");
  });

  test("the other ways to add a row: AddItem(…, depth, type, spread, time), the message row and the coloured row", () => {
    const { b, w } = box();
    expect(b.addItem("group", { id: 1 }, 2, LBIT.GROUP_PLUS, true, 0.5)).toBe(0);
    let item = b.m_Items[0]!;
    expect([item.pData, item.itemDepth, item.itemType, item.bSpread, item.fSpreadTimeGap]).toEqual([{ id: 1 }, 2, LBIT.GROUP_PLUS, true, 0.5]);
    expect(b.addMessageItem("hello", null, 77, "Elsword", true)).toBe(0);
    item = b.m_Items[1]!;
    expect([item.strText, item.m_iMessageID, item.m_wstrData, item.m_bMyMessage, item.m_bColor, item.itemType, item.itemDepth]).toEqual(["hello", 77, "Elsword", true, false, LBIT.DEFAULT, 0]);
    const ctl = new CKTDGUIStatic(w);
    expect(b.addString("red", new Color(1, 0, 0, 1), "data", ctl)).toBe(0);
    item = b.m_Items[2]!;
    expect([item.strText, item.pData, item.pControl, item.m_bColor, item.m_color.r, item.m_color.g, item.m_color.a]).toEqual(["red", "data", ctl, true, 1, 0, 1]);
    // the colour is a copy
    const color = new Color(0, 1, 0, 1);
    b.addString("green", color, null, null);
    color.g = 0;
    expect(b.m_Items[3]!.m_color.g).toBe(1);
  });

  test("AddControl makes a row of the item: its text is the item's name, the item joins the box's dialog, the row holds it", () => {
    const { b, ud, m, d, wrap } = box();
    m(ud, "InitScrollBar");
    const item = d.CreateItem();
    item.m_Name = "n".repeat(300);
    expect(m(ud, "AddControl", wrap(item, "CKTDGUIItem"))).toEqual([0]);
    const row = b.m_Items[0]!;
    expect([row.strText.length, row.pControl, row.pData, row.bSelected, item.m_pDialog]).toEqual([255, item, null, false, d]);
    expect(b.m_pScrollBar!.m_nEnd).toBe(1);
  });

  test("selectItem clamps into the list, marks the row in a multi selection list, shows it and sends the selection message (or the custom one)", () => {
    const { b, d, stageLog } = box();
    b.selectItem(3, true); // no rows: nothing at all
    expect([b.m_nSelected, stageLog.length]).toEqual([-1, 0]);
    for (let i = 0; i < 3; i++) b.addItem(`r${i}`, null, 0, 0, false, 0);
    b.selectItem(7, true);
    expect([b.m_nSelected, b.m_nSelStart, stageLog]).toEqual([2, 2, [[UIM.CONTROL_EVENT, 1]]]);
    expect(b.m_Items[2]!.bSelected).toBe(false); // a single selection list does not mark the rows
    b.selectItem(-5, false);
    expect(b.m_nSelected).toBe(0);
    expect(stageLog.length).toBe(1);
    b.m_dwStyle = 1;
    b.selectItem(1, false);
    expect([b.m_nSelected, b.m_Items[1]!.bSelected]).toEqual([1, true]);
    b.selectItem(1, true); // the same row: no change, but the message is sent
    expect(stageLog.length).toBe(2);
    b.SetCustomMsgSelection(40);
    b.selectItem(2, true);
    expect(stageLog[2]).toEqual([UIM.CUSTOM_MSG, 40]);
    expect(d.m_pStage).not.toBeNull();
  });

  test("getSelectedIndex, clearSelect, getItem and getLastItem", () => {
    const { b } = box();
    expect([b.getItem(0), b.getLastItem(), b.getSelectedIndex(-1)]).toEqual([null, null, -1]);
    for (let i = 0; i < 4; i++) b.addItem(`r${i}`, null, 0, 0, false, 0);
    expect([b.getItem(2)!.strText, b.getItem(4), b.getItem(-1), b.getLastItem()!.strText]).toEqual(["r2", null, null, "r3"]);
    b.m_nSelected = 2;
    expect([b.getSelectedIndex(-1), b.getSelectedIndex(5), b.getSelectedIndex(-2)]).toEqual([2, 2, -1]);
    b.m_dwStyle = 1; // multi selection: the next selected row after the previous one
    b.m_Items[1]!.bSelected = true;
    b.m_Items[3]!.bSelected = true;
    expect([b.getSelectedIndex(-1), b.getSelectedIndex(1), b.getSelectedIndex(3), b.getSelectedIndex(9)]).toEqual([1, 3, -1, -1]);
    b.m_Items[0]!.m_bMegaSelect = true;
    b.clearSelect();
    expect([b.m_nSelected, b.m_Items[0]!.m_bMegaSelect, b.m_Items[1]!.bSelected]).toEqual([-1, false, true]); // bSelected stays: only the mega mark goes
  });

  test("removeItem: the row goes, the bar's range follows, the selection stays in the list, the selection message is sent; a bad index does nothing", () => {
    const { b, ud, m, stageLog } = box();
    m(ud, "InitScrollBar");
    for (let i = 0; i < 3; i++) b.addItem(`r${i}`, null, 0, 0, false, 0);
    b.m_nSelected = 2;
    b.removeItem(7);
    b.removeItem(-1);
    expect([b.m_Items.length, stageLog.length]).toEqual([3, 0]);
    b.removeItem(0);
    expect([b.m_Items.map((i) => i.strText), b.m_nSelected, b.m_pScrollBar!.m_nEnd, stageLog]).toEqual([["r1", "r2"], 1, 2, [[UIM.CONTROL_EVENT, 1]]]);
    b.m_CustomMsgSelection = 9;
    b.removeItem(1);
    expect([b.m_nSelected, stageLog[1]]).toEqual([0, [UIM.CUSTOM_MSG, 9]]);
    b.removeItem(0);
    expect([b.m_nSelected, b.m_Items.length]).toEqual([-1, 0]); // an empty list: size - 1
  });

  test("removeItemByText removes every row with that text and counts them; removeAllItems empties the list and sets the bar's range to 0..1 without a message", () => {
    const { b, ud, m, stageLog } = box();
    m(ud, "InitScrollBar");
    for (const text of ["a", "b", "a", "a", "c"]) b.addItem(text, null, 0, 0, false, 0);
    expect(b.removeItemByText("a")).toBe(3);
    expect([b.m_Items.map((i) => i.strText), b.m_pScrollBar!.m_nEnd, stageLog.length]).toEqual([["b", "c"], 2, 3]);
    expect(b.removeItemByText("zzz")).toBe(0);
    b.m_nSelected = 1;
    b.removeAllItems();
    expect([b.m_Items.length, b.m_nSelected, b.m_pScrollBar!.m_nStart, b.m_pScrollBar!.m_nEnd, stageLog.length]).toEqual([0, -1, 0, 1, 3]);
  });

  test("setShowAllItems / setShowTimeAllItems / setScrollBarEndPos", () => {
    const { b, ud, m } = box();
    b.setScrollBarEndPos(); // no bar: nothing
    for (let i = 0; i < 3; i++) b.addItem(`r${i}`, null, 0, 0, false, 0);
    b.setShowTimeAllItems(2.5);
    expect(b.m_Items.map((i) => i.m_fTimeLeftShow)).toEqual([2.5, 2.5, 2.5]);
    b.setShowAllItems(false);
    expect(b.m_Items.map((i) => [i.m_bShow, i.m_fTimeLeftShow])).toEqual([[false, -1], [false, -1], [false, -1]]);
    m(ud, "InitScrollBar");
    const bar = b.m_pScrollBar!;
    bar.m_nPageSize = 1;
    bar.setTrackRange(0, 10);
    b.setScrollBarEndPos();
    expect(bar.m_nPosition).toBe(9);
  });

  test("SetDialog (slot 15) also hands the group mark the dialog; getPos is the position as floats", () => {
    const { w, dialog } = setup();
    const d = dialog();
    const b = new CKTDGUIListBox(w);
    b.setDialog(d);
    expect([b.m_pDialog, b.m_pGroupMark.m_pDialog]).toEqual([d, d]);
    b.setDialog(null);
    expect([b.m_pDialog, b.m_pGroupMark.m_pDialog]).toEqual([null, null]);
    b.m_x = 7;
    b.m_y = -3;
    expect([b.getPos().x, b.getPos().y]).toEqual([7, -3]);
  });

  test("CreateListBox makes a list box and the class is a registered implementation", () => {
    const { w, dialog } = setup();
    expect(dialog().CreateListBox()).toBeInstanceOf(CKTDGUIListBox);
    // every method the exe registers for the class is implemented
    const status = w.world.rt.status().find((c) => c.cls === "CKTDGUIListBox")!;
    expect([status.lua, status.total, status.implemented, status.missing]).toEqual(["CKTDGUIListBox", 31, 31, []]);
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

describe("the list boxes of the real scripts", () => {
  t("DLG_POST_WINDOW_CONFIG.LUA: one list box with 21 rows, a bar to its right and the rectangles that follow from its numbers", async () => {
    await source.settle(() => {
      const w = new UIWorld({ source, strings, notPorted: "throw" });
      w.boot();
      w.createOwners();
      const d = w.openDialog("DLG_POST_WINDOW_CONFIG.LUA", 0, new CX2SlotManager(w));
      expect(d.m_bSuccessInitOpenScript).toBe(true);
      const lists = d.m_ControlsList.filter((c): c is CKTDGUIListBox => c instanceof CKTDGUIListBox);
      expect(lists.length).toBe(1);
      const b = lists[0]!;
      expect(b.m_Name).toBe("ListBoxChatContent");
      expect([b.m_x, b.m_y, b.m_width, b.m_height, b.m_nSBWidth, b.m_pStringData!.fontIndex]).toEqual([18, 111, 318, 272, 21, 1]);
      expect(b.m_Items.length).toBe(21);
      expect(rc(b.m_rcBoundingBox)).toEqual([18, 111, 336, 383]);
      expect(rc(b.m_rcSelection)).toEqual([24, 117, 309, 377]); // 336 - 21 = 315, 6 in
      expect(rc(b.m_rcText)).toEqual([29, 117, 304, 377]);
      const bar = b.m_pScrollBar!;
      expect(bar.m_pDialog).toBe(d);
      expect([bar.m_x, bar.m_y, bar.m_width, bar.m_height]).toEqual([336, 111, 21, 272]);
      // the font of index 1 is XUF_DODUM_13_SEMIBOLD (15 pixels: a 16 pixel row); the text area is 260 high
      expect(w.fonts.getUKFont(1)!.lineHeight()).toBe(16);
      expect([bar.m_nPageSize, bar.m_nStart, bar.m_nEnd, bar.m_nPosition]).toEqual([16, 0, 21, 0]);
      // the group mark's pictures come from DLG_Messenger.tga
      const pics = b.m_pGroupMark.m_PictureDataList;
      expect(pics.map((p) => p.pTexture!.keyName)).toEqual(["Plus_Box", "Minus_Box"]);
      for (const p of pics) {
        const tex = p.pTexture!;
        expect([p.originalSize.x, p.originalSize.y]).toEqual([tex.texSize.x, tex.texSize.y]);
        expect([p.size.x, p.size.y]).toEqual([tex.texSize.x - 2, tex.texSize.y - 3]);
      }
      return d;
    });
  }, 60_000);

  t("DLG_UI_COMMUNITY_FRIEND.LUA: an empty list box whose bar has the range 0..1", async () => {
    await source.settle(() => {
      const w = new UIWorld({ source, strings, notPorted: "throw" });
      w.boot();
      w.createOwners();
      const d = w.openDialog("DLG_UI_COMMUNITY_FRIEND.LUA", 0, new CX2SlotManager(w));
      const b = d.m_ControlsList.find((c): c is CKTDGUIListBox => c instanceof CKTDGUIListBox)!;
      expect([b.m_Name, b.m_x, b.m_y, b.m_width, b.m_height, b.m_nSBWidth, b.m_Items.length]).toEqual(["ListBoxFriend", 33, 96, 233, 317, 21, 0]);
      expect(rc(b.m_rcText)).toEqual([44, 102, 234, 407]);
      expect([b.m_pScrollBar!.m_nPageSize, b.m_pScrollBar!.m_nEnd]).toEqual([19, 1]); // 305 / 16
      return d;
    });
  }, 60_000);
});
