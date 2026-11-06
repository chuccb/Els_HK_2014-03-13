import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { call, LuaTable } from "@els/lua";
import type { LuaValue } from "@els/lua";
import { StringTable } from "@els/assets";
import type { Color } from "@els/host";
import { CKTDGUIDialog, CKTDGUISlot, CX2Slot, CX2SlotItem, CX2SlotManager, SCS, SLOT_NO_IMAGE, UCT, UIM, UIWorld } from "../src/index.ts";
import { indexAllKoms, KomMassFileSource } from "../../../tools/komindex.ts";
import { setup } from "./harness.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const t = test.skipIf(!haveData);

const rgba = (c: Color) => [c.r, c.g, c.b, c.a];

describe("CKTDGUISlot", () => {
  test("the constructor's defaults (329507F0): no control sounds (the slot does not run UI_Control_Sound.lua), UIEdge.tga is opened", () => {
    const { w } = setup();
    const s = new CKTDGUISlot(w);
    expect(s.m_ControlType).toBe(UCT.SLOT);
    expect(s.m_eControlState).toBe(SCS.NORMAL);
    expect([s.m_bDragable, s.m_bMouseOut, s.m_iID]).toEqual([true, false, -1]);
    expect([s.m_CustomMsgMouseOut, s.m_CustomMsgMouseOver, s.m_CustomMsgMouseDown, s.m_CustomMsgMouseUp, s.m_CustomMsgMouseRightUp, s.m_CustomMsgDropped]).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(rgba(s.m_cDraggingSlotColor)).toEqual([1, 1, 1, 1]);
    expect(rgba(s.m_cDraggedSlotColor)).toEqual([1, 1, 1, Math.fround(0.4)]);
    expect(rgba(s.m_cNormalSlotColor)).toEqual([1, 1, 1, 1]);
    expect(rgba(s.m_cMouseOverColor)).toEqual([1, 1, 1, 1]);
    expect([s.m_pItemTex, s.m_pMouseOverTex, s.m_pStringData, s.m_pNormalPoint, s.m_pMouseOverPoint, s.m_pDraggingPoint, s.m_pDroppedSlot, s.m_pSlotData]).toEqual([null, null, null, null, null, null, null, null]);
    expect([s.m_pSndMouseOver, s.m_pSndMouseUp, s.m_pSndMouseDown]).toEqual([undefined, undefined, undefined]);
    expect(s.m_pEdgeTexture?.deviceID).toBe("UIEDGE.TGA");
    expect(w.devices.massFiles.log.entries).toEqual([]);
  });

  test("SetPoint: the normal point shows the item texture; the dragging and mouse over points are made from it (the exe colours the dragging point twice)", () => {
    const { w, wrap, m, point } = setup();
    const s = new CKTDGUISlot(w);
    const ud = wrap(s, "CKTDGUISlot");
    m(ud, "SetItemTex", "ITEM.TGA", "KEY");
    expect(s.m_pItemTex?.texName).toBe("ITEM.TGA");
    s.m_cDraggingSlotColor.set(0.5, 0.5, 0.5, 0.5);
    s.m_cMouseOverColor.set(0.25, 0.5, 0.75, 1);
    m(ud, "SetPoint", point(10, 20));
    const n = s.m_pNormalPoint!;
    expect(n.pUITextureData).toBe(s.m_pItemTex);
    expect([n.leftTopPoint.x, n.leftTopPoint.y, n.rightBottomPoint.x, n.rightBottomPoint.y]).toEqual([10, 20, 74, 52]); // sized from the 64 x 32 texture
    expect(s.m_pDraggingPoint).not.toBeNull();
    expect(s.m_pDraggingPoint).not.toBe(n);
    expect(s.m_pDraggingPoint!.pUITextureData).toBe(s.m_pItemTex);
    expect(s.m_pMouseOverPoint).not.toBeNull();
    expect(s.m_pMouseOverPoint!.pUITextureData).toBeNull(); // the mouse over texture is not set
    expect([s.m_pMouseOverPoint!.leftTopPoint.x, s.m_pMouseOverPoint!.leftTopPoint.y]).toEqual([10, 20]);
    // 329534D0: the point made for the mouse over state is left as the normal point had it; the dragging point is the one given the mouse over colour
    expect(rgba(s.m_pDraggingPoint!.color)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(rgba(s.m_pMouseOverPoint!.color)).toEqual(rgba(n.color));
    // the control's current point is the normal point
    expect([s.m_NowPoint.leftTopPoint.x, s.m_NowPoint.rightBottomPoint.x]).toEqual([10, 74]);
    // a second SetPoint keeps the points that exist
    const dragging = s.m_pDraggingPoint, over = s.m_pMouseOverPoint;
    m(ud, "SetPoint", point(1, 2));
    expect([s.m_pDraggingPoint, s.m_pMouseOverPoint]).toEqual([dragging, over]);
    expect(s.m_pNormalPoint).not.toBe(n);
  });

  test("SetItemTex: a texture that does not open is replaced by HQ_Shop_Ui_Noimage.dds, the whole image; when that does not open either nothing changes", () => {
    const { w, wrap, m, point } = setup();
    const open = w.devices.openTexture.bind(w.devices);
    const s = new CKTDGUISlot(w);
    const ud = wrap(s, "CKTDGUISlot");
    m(ud, "SetPoint", point(0, 0));
    w.devices.openTexture = ((id: string) => (id.toUpperCase() === "NOPE.TGA" ? undefined : open(id))) as typeof w.devices.openTexture;
    m(ud, "SetItemTex", "NOPE.TGA", "K");
    expect(s.m_pItemTex?.texName).toBe(SLOT_NO_IMAGE);
    expect(s.m_pItemTex?.keyName).toBe("");
    expect(s.m_pItemTex?.keyFound).toBe(true);
    expect(s.m_pItemTex?.uvTexture.map((v) => [v.x, v.y])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    expect(s.m_pNormalPoint!.pUITextureData).toBe(s.m_pItemTex);
    expect(s.m_pDraggingPoint!.pUITextureData).toBe(s.m_pItemTex);
    const before = s.m_pItemTex;
    w.devices.openTexture = (() => undefined) as typeof w.devices.openTexture;
    m(ud, "SetItemTex", "NOPE.TGA", "K");
    expect(s.m_pItemTex).toBeNull(); // the old texture is destroyed first; the default does not open
    expect(before).not.toBeNull();
    expect(s.m_pNormalPoint!.pUITextureData).toBe(before); // (left as it was)
  });

  test("SetItemTex2: the whole image of the file; a missing file falls back to the no-image texture, also for an empty name", () => {
    const { w, wrap, m } = setup();
    const open = w.devices.openTexture.bind(w.devices);
    const s = new CKTDGUISlot(w);
    const ud = wrap(s, "CKTDGUISlot");
    m(ud, "SetItemTex2", "ICON.DDS");
    expect(s.m_pItemTex?.texName).toBe("ICON.DDS");
    expect(s.m_pItemTex?.uvTexture.map((v) => [v.x, v.y])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    expect([s.m_pItemTex?.texSize.x, s.m_pItemTex?.texSize.y]).toEqual([64, 32]);
    w.devices.openTexture = ((id: string) => (id.toUpperCase() === SLOT_NO_IMAGE.toUpperCase() ? open(id) : undefined)) as typeof w.devices.openTexture;
    m(ud, "SetItemTex2", "GONE.DDS");
    expect(s.m_pItemTex?.texName).toBe(SLOT_NO_IMAGE);
    m(ud, "SetItemTex2", "");
    expect(s.m_pItemTex?.texName).toBe(SLOT_NO_IMAGE);
    w.devices.openTexture = (() => undefined) as typeof w.devices.openTexture;
    const keep = s.m_pItemTex;
    m(ud, "SetItemTex2", "GONE.DDS");
    expect(s.m_pItemTex).toBe(keep); // nothing opens: the slot keeps what it shows (this setter does not destroy it first)
  });

  test("SetMouseOverTex / SetMouseOverPoint: the mouse over point shows the mouse over texture", () => {
    const { w, wrap, m, point } = setup();
    const s = new CKTDGUISlot(w);
    const ud = wrap(s, "CKTDGUISlot");
    m(ud, "SetMouseOverTex", "OVER.TGA", "OVER_KEY");
    expect([s.m_pMouseOverTex?.texName, s.m_pMouseOverTex?.keyName]).toEqual(["OVER.TGA", "OVER_KEY"]);
    m(ud, "SetMouseOverPoint", point(3, 4));
    expect(s.m_pMouseOverPoint!.pUITextureData).toBe(s.m_pMouseOverTex);
    expect([s.m_pMouseOverPoint!.leftTopPoint.x, s.m_pMouseOverPoint!.rightBottomPoint.y]).toEqual([3, 36]);
    const first = s.m_pMouseOverTex;
    m(ud, "SetMouseOverTex", "OVER2.TGA", "K2");
    expect(s.m_pMouseOverTex).not.toBe(first);
    expect(s.m_pMouseOverPoint!.pUITextureData).toBe(s.m_pMouseOverTex);
  });

  test("ChangeState: mouse over needs its point and tells the stage; normal after mouse out tells the stage; drag takes the focus and the colour of a dragged slot", () => {
    const { w, wrap, m, point, dialog, stage, stageLog } = setup();
    const d = dialog();
    d.m_pStage = stage as never;
    const s = new CKTDGUISlot(w);
    d.AddControl(s);
    const ud = wrap(s, "CKTDGUISlot");
    s.m_CustomMsgMouseOver = 5;
    s.m_CustomMsgMouseOut = 6;
    expect(() => new CKTDGUISlot(w).ChangeState(SCS.MOUSEOVER, false)).toThrow(/mouse over point/); // the exe dereferences null
    m(ud, "SetPoint", point(10, 20));
    s.m_cMouseOverColor.set(1, 0.5, 1, 1);
    s.ChangeState(SCS.MOUSEOVER, false);
    expect(s.m_eControlState).toBe(SCS.MOUSEOVER);
    expect(rgba(s.m_pMouseOverPoint!.color)).toEqual([1, 0.5, 1, 1]);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 5]]);
    s.m_bMouseOut = true;
    s.ChangeState(SCS.NORMAL, false);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 5], [UIM.CUSTOM_MSG, 6]]);
    expect(s.m_bMouseOut).toBe(false);
    // dragging
    expect(CKTDGUISlot.s_pDragSlot).toBeNull();
    s.ChangeState(SCS.ONDRAG, false);
    expect(CKTDGUISlot.s_pDragSlot).toBe(s);
    expect(s.m_bHasFocus).toBe(true);
    expect(rgba(s.m_Color)).toEqual([1, 1, 1, Math.fround(0.4)]);
    // hiding the dragged slot returns the drag
    s.SetShow(false);
    expect(CKTDGUISlot.s_pDragSlot).toBeNull();
    expect(s.m_eControlState).toBe(SCS.NORMAL);
    expect(rgba(s.m_Color)).toEqual([1, 1, 1, 1]);
  });

  test("SetEnable only records the state (ChangeState finds it already set and returns); a disabled slot lets go of the focus when told to change", () => {
    const { w } = setup();
    const s = new CKTDGUISlot(w);
    s.SetEnable(false);
    expect([s.m_bEnable, s.m_eControlState]).toEqual([false, SCS.DISABLE]);
    s.SetEnable(true);
    expect([s.m_bEnable, s.m_eControlState]).toEqual([true, SCS.NORMAL]);
  });

  test("the one-line setters write their members; GetDroppedSlot / GetDragable read them", () => {
    const { w, wrap, m } = setup();
    const s = new CKTDGUISlot(w);
    const ud = wrap(s, "CKTDGUISlot");
    m(ud, "SetCustomMsgMouseOut", 1);
    m(ud, "SetCustomMsgMouseOver", 2);
    m(ud, "SetCustomMsgMouseDown", 3);
    m(ud, "SetCustomMsgMouseUp", 4);
    m(ud, "SetCustomMsgMouseRightUp", 5);
    m(ud, "SetCustomMsgDropped", 6);
    expect([s.m_CustomMsgMouseOut, s.m_CustomMsgMouseOver, s.m_CustomMsgMouseDown, s.m_CustomMsgMouseUp, s.m_CustomMsgMouseRightUp, s.m_CustomMsgDropped]).toEqual([1, 2, 3, 4, 5, 6]);
    m(ud, "SetID", 77);
    expect(s.m_iID).toBe(77);
    expect(m(ud, "GetDragable")).toEqual([true]);
    m(ud, "SetDragable", false);
    expect([s.m_bDragable, ...m(ud, "GetDragable")]).toEqual([false, false]);
    expect(m(ud, "GetDroppedSlot")).toEqual([undefined]);
    const color = (r: number, g: number, b: number, a: number): LuaValue => call(w.world.G.main, w.world.G.globals.getStr("D3DXCOLOR"), [r, g, b, a])[0];
    m(ud, "SetDraggingSlotColor", color(0.1, 0.2, 0.3, 0.4));
    m(ud, "SetDraggedSlotColor", color(0.5, 0.6, 0.7, 0.8));
    expect(rgba(s.m_cDraggingSlotColor)).toEqual([0.1, 0.2, 0.3, 0.4].map(Math.fround));
    expect(rgba(s.m_cDraggedSlotColor)).toEqual([0.5, 0.6, 0.7, 0.8].map(Math.fround));
  });
});

describe("the slot manager, its slots and the slot items (game layer)", () => {
  const strings = new StringTable(["zero", "one", "two", "three"]);
  const table = (kv: Record<string, LuaValue>): LuaTable => {
    const tb = new LuaTable();
    for (const [k, v] of Object.entries(kv)) tb.setStr(k, v);
    return tb;
  };

  test("CX2SlotManager's defaults (32E5DFB0); RegisterLuaBind makes it the global g_pCX2SlotManager, which a script can use", () => {
    const { w, m } = setup(strings);
    const mgr = new CX2SlotManager(w);
    expect([mgr.m_SlotList.length, mgr.m_SlotManagerLayer, mgr.m_iDummyValue, mgr.m_Pos.x, mgr.m_Pos.y, mgr.m_pNowOverItemSlot]).toEqual([0, 1, -1, 0, 0, null]);
    expect(w.world.G.globals.getStr("g_pCX2SlotManager")).toBeUndefined();
    mgr.registerLuaBind();
    const g = w.world.G.globals.getStr("g_pCX2SlotManager")!;
    expect(m(g, "GetDummyValue")).toEqual([-1]);
    mgr.m_iDummyValue = 9;
    expect(m(g, "GetDummyValue")).toEqual([9]);
    // another manager takes the global over
    const other = new CX2SlotManager(w);
    other.registerLuaBind();
    expect(m(w.world.G.globals.getStr("g_pCX2SlotManager")!, "GetDummyValue")).toEqual([-1]);
  });

  test("CreateItemSlot is a CX2SlotItem with the constructor's defaults (331C7E50); AddSlot gives it its manager and keeps it in the list", () => {
    const { w, m } = setup(strings);
    const mgr = new CX2SlotManager(w);
    mgr.registerLuaBind();
    const g = w.world.G.globals.getStr("g_pCX2SlotManager")!;
    const [ud] = m(g, "CreateItemSlot");
    const slot = (ud as { data: unknown }).data as CX2SlotItem;
    expect(slot).toBeInstanceOf(CX2SlotItem);
    expect(slot).toBeInstanceOf(CX2Slot);
    expect([slot.m_SlotID, slot.m_bEnable, slot.m_bShow, slot.m_bClickable, slot.m_SlotType, slot.m_pSlotManager]).toEqual([-1, true, true, true, 0, null]);
    expect([slot.m_SortType, slot.m_bFashion, slot.m_EquipPos, slot.m_SlotDesc, slot.m_ItemUID, slot.m_ItemTID, slot.m_bReset, slot.m_Period]).toEqual([0, false, 0, "", -1n, -1, false, 0]);
    expect([slot.m_Pos.x, slot.m_Pos.y, slot.m_Size.x, slot.m_Size.y]).toEqual([0, 0, 0, 0]);
    expect(mgr.m_SlotList.length).toBe(0); // not yet
    m(g, "AddSlot", ud);
    expect(mgr.m_SlotList).toEqual([slot]);
    expect(slot.m_pSlotManager).toBe(mgr);
    mgr.AddSlot(undefined); // a null slot is ignored (from C++; a script cannot pass nil for a class pointer)
    expect(mgr.m_SlotList.length).toBe(1);
    const [ud2] = m(g, "CreateItemSlot");
    m(g, "AddSlot", ud2);
    expect(mgr.m_SlotList.length).toBe(2);
  });

  test("SetSlotData: an empty table gives the defaults (SLOT_ID 0, ENABLE and SHOW true, the rest 0 / false, no description, POS and SIZE 0)", () => {
    const { w, wrap, m } = setup(strings);
    const mgr = new CX2SlotManager(w);
    const slot = mgr.CreateItemSlot();
    slot.m_SlotID = 5;
    slot.m_bEnable = false;
    slot.m_Pos.set(3, 4);
    slot.m_SlotDesc = "old";
    m(wrap(slot, "CX2SlotItem"), "SetSlotData", table({}));
    expect([slot.m_SlotID, slot.m_bEnable, slot.m_bShow, slot.m_SlotType, slot.m_SortType, slot.m_bFashion, slot.m_EquipPos]).toEqual([0, true, true, 0, 0, false, 0]);
    expect(slot.m_SlotDesc).toBe(""); // string id -1
    expect([slot.m_Pos.x, slot.m_Pos.y, slot.m_Size.x, slot.m_Size.y]).toEqual([0, 0, 0, 0]);
  });

  test("SetSlotData: SLOT_ID, ENABLE, SHOW, SLOT_TYPE, SORT_TYPE, FASHION, EQUIP_POS, SLOT_DESC (a string id), POS and SIZE", () => {
    const { w, wrap, m, vec2 } = setup(strings);
    const mgr = new CX2SlotManager(w);
    const slot = mgr.CreateItemSlot();
    const ud = wrap(slot, "CX2SlotItem");
    m(ud, "SetSlotData", table({
      SLOT_ID: 3, ENABLE: 0, SHOW: 0, SLOT_TYPE: 4, SORT_TYPE: 11, FASHION: 1, EQUIP_POS: 7, SLOT_DESC: 2, // TRUE and FALSE of the scripts are numbers
      POS: vec2(9, 691), SIZE: vec2(40, 41),
    }));
    expect([slot.m_SlotID, slot.m_bEnable, slot.m_bShow, slot.m_SlotType, slot.m_SortType, slot.m_bFashion, slot.m_EquipPos]).toEqual([3, false, false, 4, 11, true, 7]);
    expect(slot.m_SlotDesc).toBe("two");
    expect([slot.m_Pos.x, slot.m_Pos.y, slot.m_Size.x, slot.m_Size.y]).toEqual([9, 691, 40, 41]);
    // a table without POS / SIZE resets them to 0
    m(ud, "SetSlotData", table({ SLOT_ID: 1 }));
    expect([slot.m_SlotID, slot.m_Pos.x, slot.m_Pos.y, slot.m_Size.x, slot.m_Size.y, slot.m_SlotDesc]).toEqual([1, 0, 0, 0, 0, ""]);
    // an id outside the table has no text
    m(ud, "SetSlotData", table({ SLOT_DESC: 99 }));
    expect(slot.m_SlotDesc).toBe("");
  });

  test("SetClickable only sets the flag; SLOT_BACK_DLG_FILE (a second dialog) is not ported and says so", () => {
    const { w, wrap, m } = setup(strings);
    const slot = new CX2SlotManager(w).CreateItemSlot();
    const ud = wrap(slot, "CX2SlotItem");
    m(ud, "SetClickable", false);
    expect(slot.m_bClickable).toBe(false);
    expect(() => m(ud, "SetSlotData", table({ SLOT_BACK_DLG_FILE: "DLG_BACK.LUA" }))).toThrow(/SLOT_BACK_DLG_FILE/);
    expect(() => m(ud, "SetSlotData", table({ SLOT_BACK_DLG_FILE: "" }))).not.toThrow();
  });

  test("Dialog.CreateSlot makes a CKTDGUISlot", () => {
    const { w, wrap, m } = setup(strings);
    const d = new CKTDGUIDialog(w);
    const [s] = m(wrap(d, "CKTDGUIDialog"), "CreateSlot");
    expect((s as { data: unknown }).data).toBeInstanceOf(CKTDGUISlot);
  });
});

// ---- a real dialog -------------------------------------------------------------------------------------------------------------

let source: KomMassFileSource;
let realStrings: StringTable;
beforeAll(async () => {
  if (!haveData) return;
  source = new KomMassFileSource(await indexAllKoms());
  realStrings = StringTable.fromEss(new Uint8Array(readFileSync(join(dataDir, "general.ess"))));
}, 60_000);

describe("DLG_UI_QUICK_SLOT.LUA (six item slots through g_pCX2SlotManager)", () => {
  const open = (script: string) =>
    source.settle(() => {
      const w = new UIWorld({ source, strings: realStrings, notPorted: "throw" });
      w.loadEnums();
      const owner = new CX2SlotManager(w);
      return { w, owner, dlg: w.openDialog(script, 0, owner) };
    });

  t("runs in strict mode; the owner holds the six slots the script described", async () => {
    const { w, owner, dlg } = await open("DLG_UI_QUICK_SLOT.LUA");
    expect(dlg.m_bSuccessInitOpenScript).toBe(true);
    expect(w.devices.massFiles.log.entries).toEqual([]);
    expect(owner.m_SlotList.length).toBe(6);
    const slots = owner.m_SlotList as CX2SlotItem[];
    for (const s of slots) {
      expect(s).toBeInstanceOf(CX2SlotItem);
      expect(s.m_pSlotManager).toBe(owner);
      expect([s.m_SlotType, s.m_SortType, s.m_EquipPos, s.m_bFashion, s.m_bEnable, s.m_bShow]).toEqual([1, 11, 1, false, true, true]);
      expect([s.m_Size.x, s.m_Size.y, s.m_Pos.y]).toEqual([40, 40, 691]);
      expect(s.m_SlotDesc).toBe(realStrings.get(981)); // SLOT_DESC = STR_ID_981
      expect(s.m_SlotDesc.length).toBeGreaterThan(0);
    }
    expect(slots.map((s) => s.m_SlotID)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(slots.map((s) => s.m_Pos.x)).toEqual([9, 55, 101, 147, 193, 239]);
  });
});
