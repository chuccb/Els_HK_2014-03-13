import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable, decodeTga, parseTet } from "@els/assets";
import { HostNotPortedError } from "@els/host";
import { LuaError } from "@els/lua";
import type { MassFileSource } from "@els/host";
import { CKTDGUIDialog, CKTDGUIDialogManager, CKTDGUIStatic, CPictureData, UIWorld } from "../src/index.ts";
import { indexAllKoms, KomMassFileSource } from "../../../tools/komindex.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const t = test.skipIf(!haveData);

// ---- the model on its own (no client data) ----------------------------------------------------------------------------------

const NOTHING: MassFileSource = { has: () => false, read: () => undefined };
const bare = () => new UIWorld({ source: NOTHING, strings: new StringTable([]), notPorted: "throw" });

describe("CKTDGUIDialog: controls and names", () => {
  test("a new dialog has the constructor's defaults and no script", () => {
    const d = new CKTDGUIDialog(bare());
    expect([d.m_Pos.x, d.m_Pos.y]).toEqual([0, 0]);
    expect([d.m_Color.r, d.m_Color.g, d.m_Color.b, d.m_Color.a]).toEqual([1, 1, 1, 1]);
    expect([d.m_bModal, d.m_bEnable, d.m_bShow, d.m_bMaximize, d.m_bFront, d.m_bCloseOnFocusOut]).toEqual([true, true, true, false, false, false]);
    expect([d.m_vDraggingRangeCenter.x, d.m_vDraggingRangeCenter.y, d.m_vDraggingRange.x, d.m_vDraggingRange.y]).toEqual([512, 384, 1024, 768]);
    expect([d.m_CloseCustomUIEventID, d.m_CustomMsgMouseOver, d.m_CustomMsgRMouseUp]).toEqual([-1, -1, -1]);
    expect(d.m_bFadeInOut).toBe(true);
    expect(d.m_bSuccessInitOpenScript).toBe(false);
    expect(d.m_ControlsMap.size).toBe(0);
  });

  test("a script that is not there is error log 0x87 (LoadDataFile) and 0x48 (OpenScriptFile) and an unsuccessful dialog; g_pUIDialog stays set", () => {
    const w = bare();
    const d = new CKTDGUIDialog(w, { scriptFileName: "NOT_THERE.lua" });
    expect(d.m_bSuccessInitOpenScript).toBe(false);
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x87, text: "NOT_THERE.LUA" }, { id: 0x48, text: "NOT_THERE.lua" }]);
    expect(w.world.G.globals.getStr("g_pUIDialog")).toBeDefined();
    expect(new CKTDGUIDialog(w, { scriptFileName: "" }).m_bSuccessInitOpenScript).toBe(false); // an empty name does not even try
    expect(w.devices.massFiles.log.entries.length).toBe(2);
  });

  test("AddControl: the dialog is told to the control, a taken name becomes name100, name101, ...", () => {
    const w = bare();
    const d = new CKTDGUIDialog(w);
    const [a, b, c, e] = [1, 2, 3, 4].map(() => new CKTDGUIStatic(w));
    a!.SetName("Back");
    for (const x of [b!, c!, e!]) x.setNameByForce("Back");
    d.AddControl(a);
    d.AddControl(b);
    d.AddControl(c);
    expect(a!.m_pDialog).toBe(d);
    expect([a, b, c].map((x) => x!.m_Name)).toEqual(["Back", "Back100", "Back101"]);
    expect(d.m_ControlsMap.keys()).toEqual(["Back", "Back100", "Back101"]); // std::map: ordered by name
    expect(d.m_ControlsList).toEqual([a!, b!, c!]);
    d.AddControl(undefined); // a null control is ignored
    expect(d.m_ControlsList.length).toBe(3);
    d.AddControl(e); // the 4th one: Back, Back100 and Back101 are taken
    expect(e!.m_Name).toBe("Back102");
  });

  test("unnamed controls are named like any other: the first keeps the empty name, the next ones are 100, 101", () => {
    const w = bare();
    const d = new CKTDGUIDialog(w);
    const xs = [1, 2, 3].map(() => new CKTDGUIStatic(w));
    for (const x of xs) d.AddControl(x);
    expect(xs.map((x) => x.m_Name)).toEqual(["", "100", "101"]);
  });

  test("renaming a control of a dialog moves its entry (ReNameControl) and makes the new name unique", () => {
    const w = bare();
    const d = new CKTDGUIDialog(w);
    const a = new CKTDGUIStatic(w), b = new CKTDGUIStatic(w);
    a.setNameByForce("A");
    b.setNameByForce("B");
    d.AddControl(a);
    d.AddControl(b);
    a.SetName("C");
    expect(d.m_ControlsMap.keys()).toEqual(["B", "C"]);
    expect(d.m_ControlsMap.get("C")).toBe(a);
    b.SetName("C"); // taken by a: b becomes C100
    expect(b.m_Name).toBe("C100");
    expect(d.m_ControlsMap.keys()).toEqual(["C", "C100"]);
    expect(d.m_ControlsMap.get("C100")).toBe(b);
    expect(d.m_ControlsList).toEqual([a, b]); // the list keeps the drawing order
    // the name the control already has is taken, by the control itself: the exe makes it name100 (the check does not exempt the owner)
    a.SetName("C");
    expect(a.m_Name).toBe("C100" === b.m_Name ? "C101" : "C100");
    expect(d.m_ControlsMap.get(a.m_Name)).toBe(a);
    // a name of more than 255 characters is cut to 255 (wchar_t buff[256])
    a.SetName("x".repeat(300));
    expect(a.m_Name.length).toBe(255);
    expect(d.m_ControlsMap.get("x".repeat(255))).toBe(a);
  });

  test("a control that is in no dialog just takes the name", () => {
    const c = new CKTDGUIStatic(bare());
    expect(c.setName("Lonely")).toBe(true);
    expect(c.m_Name).toBe("Lonely");
  });

  test("SetPos: a dialog that is not moving jumps; one that is moving drags its goal along", () => {
    const d = new CKTDGUIDialog(bare());
    d.SetPos(10, 20);
    expect([d.m_Pos.x, d.m_Pos.y, d.m_GoalPos.x, d.m_GoalPos.y]).toEqual([10, 20, 0, 0]);
    d.m_fChangeTime = 1; // a move is under way: m_fChangeTime > m_fAnimateTime
    d.SetPos(30, 40);
    expect([d.m_Pos.x, d.m_Pos.y, d.m_GoalPos.x, d.m_GoalPos.y]).toEqual([30, 40, 30, 40]);
    d.SetPos(0.1, 0.2); // float32 members
    expect([d.m_Pos.x, d.m_Pos.y]).toEqual([Math.fround(0.1), Math.fround(0.2)]);
  });

  test("SetFront / SetLayer (3295B700 / 3295B790): a dialog of a manager asks the manager, which only moves the dialogs of its own set", () => {
    const w = bare();
    const d = new CKTDGUIDialog(w);
    d.SetFront(true);
    d.SetLayer(7);
    expect([d.m_bFront, d.m_iLayer]).toEqual([true, 7]);
    const manager = new CKTDGUIDialogManager(w);
    d.m_pkUIDialogManager = manager; // a manager the dialog knows but does not hold: ChangeFront / ChangeLayer fail CheckDlg and change nothing
    d.SetFront(false);
    d.SetLayer(8);
    expect([d.m_bFront, d.m_iLayer, manager.m_iDialogListChangeCount]).toEqual([true, 7, 0]);
    d.m_pkUIDialogManager = null;
    expect(manager.addDlg(d)).toBe(true); // now the manager holds it: the change goes through the manager (the list moves, the count of changes goes up)
    d.SetFront(false);
    d.SetLayer(8);
    expect([d.m_bFront, d.m_iLayer, manager.m_iDialogListChangeCount]).toEqual([false, 8, 5]);
  });

  test("a fade-in is not ported", () => {
    expect(() => new CKTDGUIDialog(bare(), { moveTime: 0.5 })).toThrow("not ported");
  });

  test("OpenScriptFile: a Lua error in the script is error log 0x49; a method nobody ported is not swallowed", () => {
    const w = bare();
    w.world.execScript = () => {
      throw new LuaError("DLG_X.lua:3: boom");
    };
    const d = new CKTDGUIDialog(w, { scriptFileName: "DLG_X.lua" });
    expect(d.m_bSuccessInitOpenScript).toBe(false);
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x49, text: "DLG_X.lua: DLG_X.lua:3: boom" }]);
    w.world.execScript = () => {
      throw new HostNotPortedError("CKTDGUIDialog.Nothing @0");
    };
    expect(() => new CKTDGUIDialog(w, { scriptFileName: "DLG_Y.lua" })).toThrow(HostNotPortedError);
  });
});

// ---- the real scripts -------------------------------------------------------------------------------------------------------

let source: KomMassFileSource;
let strings: StringTable;

beforeAll(async () => {
  if (!haveData) return;
  source = new KomMassFileSource(await indexAllKoms());
  strings = StringTable.fromEss(new Uint8Array(readFileSync(join(dataDir, "general.ess"))));
}, 60_000);

const uv = (c: CPictureData) => c.pTexture!.uvTexture.map((v) => [v.x, v.y]);

describe("DLG_First_Loading_Front_HK.lua (the first dialog the client opens)", () => {
  const open = (script: string) =>
    source.settle(() => {
      const w = new UIWorld({ source, strings, notPorted: "throw" });
      w.loadEnums();
      return { w, dlg: w.openDialog(script) };
    });

  t("runs in strict mode: every method it calls is ported", async () => {
    const { w, dlg } = await open("DLG_First_Loading_Front_HK.lua");
    expect(dlg.m_bSuccessInitOpenScript).toBe(true);
    expect(w.devices.massFiles.log.entries).toEqual([]);
    expect(dlg.m_Name).toBe("DLG_First_Loading_Front");
    expect([dlg.m_Pos.x, dlg.m_Pos.y, dlg.m_bModal, dlg.m_bFront, dlg.m_iLayer]).toEqual([0, 0, true, true, 0]);
    expect(dlg.m_ControlsMap.keys()).toEqual(["First_Loading", "First_Loading_Back", "Static_Client_Version"]); // by name
    expect(dlg.m_ControlsList.map((c) => c.m_Name)).toEqual(["First_Loading_Back", "First_Loading", "Static_Client_Version"]); // as added
    for (const c of dlg.m_ControlsList) expect(c.m_pDialog).toBe(dlg);
  });

  t("the background: two 512x512 TGAs, each drawn 512x768 with the whole image as its UV rectangle", async () => {
    const { dlg } = await open("DLG_First_Loading_Front_HK.lua");
    const back = dlg.m_ControlsMap.get("First_Loading_Back") as CKTDGUIStatic;
    expect(back).toBeInstanceOf(CKTDGUIStatic);
    expect(back.m_PictureDataList.length).toBe(2);
    const [left, right] = back.m_PictureDataList as [CPictureData, CPictureData];
    expect([left.pTexture!.texName, left.pTexture!.keyName]).toEqual(["DLG_First_Loading0_HK.TGA", "DLG_First_Loading0"]);
    expect([right.pTexture!.texName, right.pTexture!.keyName]).toEqual(["DLG_First_Loading1_HK.TGA", "DLG_First_Loading1"]);
    expect([left.pos.x, left.pos.y, left.size.x, left.size.y]).toEqual([0, 0, 512, 768]);
    expect([right.pos.x, right.pos.y, right.size.x, right.size.y]).toEqual([512, 0, 512, 768]);
    expect(left.pTexture!.pTexture!.info.Width).toBe(512);
    expect(left.pTexture!.pTexture!.info.Height).toBe(512);
    expect(uv(left)).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]); // left-top, right-top, left-bottom, right-bottom
    expect(uv(right)).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    expect(left.pPoint!.bUseTextureSize).toBe(false);
    expect(left.pPoint!.pUITextureData).toBe(left.pTexture);
  });

  t("the gauge: UV rectangles come from the TET next to the image, divided by the image size as float32", async () => {
    const { w, dlg } = await open("DLG_First_Loading_Front_HK.lua");
    const gauge = dlg.m_ControlsMap.get("First_Loading") as CKTDGUIStatic;
    const pics = gauge.m_PictureDataList;
    expect(pics.map((p) => [p.pTexture!.texName, p.pTexture!.keyName])).toEqual([
      ["DLG_First_Loading2.TGA", "Gauge"],
      ["DLG_First_Loading2.tga", "Gauge_Line0"], // the script spells it in lower case: the same device, the key is looked up as given
      ["DLG_First_Loading2.tga", "Gauge_Line1"],
      ["DLG_First_Loading2.tga", "Gauge_Line2"],
    ]);
    expect(pics.map((p) => [p.pos.x, p.pos.y, p.size.x, p.size.y])).toEqual([[0, 761, 1024, 7], [0, 761, 10, 8], [10, 761, 1004, 8], [1014, 761, 10, 8]]);
    // independent of the UI code: the rectangle of key "GAUGE" in DLG_FIRST_LOADING2.TET over the size of the .TGA
    const tet = parseTet(source.read("DLG_FIRST_LOADING2.TET")!)!;
    const img = decodeTga(source.read("DLG_FIRST_LOADING2.TGA")!)!;
    const rect = tet.getTexUV("GAUGE")!;
    const f = Math.fround;
    expect(uv(pics[0]!)).toEqual([
      [f(rect.leftTop[0] / img.width), f(rect.leftTop[1] / img.height)],
      [f(rect.rightTop[0] / img.width), f(rect.rightTop[1] / img.height)],
      [f(rect.leftBottom[0] / img.width), f(rect.leftBottom[1] / img.height)],
      [f(rect.rightBottom[0] / img.width), f(rect.rightBottom[1] / img.height)],
    ]);
    expect(rect.leftTop[0]).toBeLessThan(rect.rightBottom[0]); // the quad is not flipped
    // all four pictures share one device: DLG_FIRST_LOADING2.TGA with four references (the key case does not matter for the file)
    expect(w.devices.devices.get("DLG_FIRST_LOADING2.TGA")!.refCount).toBe(4);
    expect([...w.devices.devices.keys()]).toEqual(["UIEDGE.TGA", "DLG_FIRST_LOADING0_HK.TGA", "DLG_FIRST_LOADING1_HK.TGA", "DLG_FIRST_LOADING2.TGA"]);
  });

  t("the strings: STR_ID_992 and STR_ID_1 come from general.ess", async () => {
    const { dlg } = await open("DLG_First_Loading_Front_HK.lua");
    const s992 = (dlg.m_ControlsMap.get("First_Loading") as CKTDGUIStatic).m_StringDataList;
    const s1 = (dlg.m_ControlsMap.get("Static_Client_Version") as CKTDGUIStatic).m_StringDataList;
    expect(s992.length).toBe(1);
    expect(s992[0]!.stringTableID).toBe(992);
    expect(s992[0]!.msg).toBe(strings.get(992));
    expect(s1[0]!.stringTableID).toBe(1);
    expect(s1[0]!.msg).toBe(strings.get(1));
    expect(s1[0]!.msg.length).toBeGreaterThan(0);
    expect([s992[0]!.pos.x, s992[0]!.pos.y]).toEqual([1000, 730]);
    expect([s1[0]!.pos.x, s1[0]!.pos.y]).toEqual([6, 730]);
  });

});
