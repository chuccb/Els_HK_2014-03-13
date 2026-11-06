import { describe, expect, test } from "bun:test";
import { call, index, LuaTable } from "@els/lua";
import type { LuaUserdata, LuaValue } from "@els/lua";
import { StringTable } from "@els/assets";
import type { TetFile } from "@els/assets";
import { Vec2 } from "@els/host";
import type { MassFileSource } from "@els/host";
import {
  BCS, CBCS, CKTDGUIButton, CKTDGUICheckBox, CKTDGUIDialog, CKTDGUIRadioButton, CKTDGUIStatic, CPictureData, DeviceSound, DeviceTexture, RBCS, UCT,
  UIM, UIWorld,
} from "../src/index.ts";

/**
 * The control classes on their own (no client data): a world whose every texture opens (64 x 32 texels, one UV rectangle for every key),
 * and the Lua side driven from TS the way the interpreter would (`o:Method(...)`), because the setters that read a table read the one
 * on top of the Lua stack of the call that reaches them.
 */
const NOTHING: MassFileSource = { has: () => false, read: () => undefined };

function setup() {
  const w = new UIWorld({ source: NOTHING, strings: new StringTable([]), notPorted: "throw" });
  w.devices.openTexture = ((id: string) => {
    const t = new DeviceTexture(id.toUpperCase());
    t.info = { ...t.info, Width: 64, Height: 32 };
    t.tet = { getTexUV: () => ({ leftTop: [0, 0], rightTop: [64, 0], leftBottom: [0, 32], rightBottom: [64, 32], rectSize: [64, 32] }) } as unknown as TetFile;
    return t;
  }) as typeof w.devices.openTexture;
  const G = w.world.G;
  const L = G.main;
  /** a control as a script holds it */
  const wrap = (obj: object, cpp: string): LuaUserdata => {
    w.world.rt.setObject("g_pWrapped", obj, cpp);
    return G.globals.getStr("g_pWrapped") as LuaUserdata;
  };
  const m = (o: LuaValue, name: string, ...args: LuaValue[]) => call(L, index(L, o, name), [o, ...args]);
  const vec2 = (x: number, y: number): LuaValue => call(L, G.globals.getStr("D3DXVECTOR2"), [x, y])[0];
  /** the table of a `Set*Point`: the left-top corner (the size comes from the texture) */
  const point = (x: number, y: number, extra: Record<string, LuaValue> = {}): LuaTable => {
    const t = new LuaTable();
    t.setStr("LEFT_TOP", vec2(x, y));
    for (const [k, v] of Object.entries(extra)) t.setStr(k, v);
    return t;
  };
  const dialog = () => new CKTDGUIDialog(w);
  /** the messages a stage receives */
  const stageLog: [number, number | string][] = [];
  const stage = { MsgProc: (msg: number, wParam: number | string) => void stageLog.push([msg, wParam]) };
  return { w, wrap, m, vec2, point, dialog, stage, stageLog };
}

const corner = (p: { leftTopPoint: Vec2 } | null | undefined) => [p?.leftTopPoint.x, p?.leftTopPoint.y];

describe("CKTDGUIControl: sounds, points and textures the interactive controls share", () => {
  test("every constructor runs UI_Control_Sound.lua (a missing script is error log 0x87 then 0x48) and opens its sounds only when FMOD is up", () => {
    const { w } = setup();
    new CKTDGUIButton(w);
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x87, text: "UI_CONTROL_SOUND.LUA" }, { id: 0x48, text: "UI_Control_Sound.lua" }]);
    new CKTDGUIRadioButton(w);
    new CKTDGUICheckBox(w);
    expect(w.devices.massFiles.log.entries.length).toBe(6);
    expect(w.devices.sounds.size).toBe(0);
  });

  test("PlaySoundW: a control that has its sound on plays the sound once, without 3D; one that muted it does not", () => {
    const { w } = setup();
    const c = new CKTDGUICheckBox(w);
    const s = new DeviceSound("X2_CHECK.OGG", false);
    c.playSound(s);
    c.playSound(undefined);
    expect(s.plays).toBe(1);
    c.m_bSound = false;
    c.playSound(s);
    expect(s.plays).toBe(1);
  });
});

describe("CKTDGUIControl::CPictureData.SetPos", () => {
  test("moves the picture and its point; without a point it is error log 0x15B", () => {
    const { w, wrap, m, vec2, point } = setup();
    const pic = new CPictureData(w);
    pic.SetPos(new Vec2(5, 6));
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x15b, text: "" }]);
    expect([pic.pos.x, pic.pos.y]).toEqual([5, 6]);
    const ud = wrap(pic, "CKTDGUIControl::CPictureData");
    m(ud, "SetTex", "P.TGA", "K");
    m(ud, "SetPoint", point(10, 20));
    expect([pic.size.x, pic.size.y]).toEqual([64, 32]);
    m(ud, "SetPos", vec2(100, 200));
    const p = pic.pPoint!;
    expect([p.leftTopPoint.x, p.leftTopPoint.y, p.rightTopPoint.x, p.rightTopPoint.y]).toEqual([100, 200, 164, 200]);
    expect([p.leftBottomPoint.x, p.leftBottomPoint.y, p.rightBottomPoint.x, p.rightBottomPoint.y]).toEqual([100, 232, 164, 232]);
    expect(w.devices.massFiles.log.entries.length).toBe(1);
  });
});

describe("CKTDGUIButton", () => {
  test("the constructor's defaults", () => {
    const { w } = setup();
    const b = new CKTDGUIButton(w);
    expect(b.m_ControlType).toBe(UCT.BUTTON);
    expect(b.m_ButtonState).toBe(BCS.NORMAL);
    expect([b.m_CustomMsgMouseOut, b.m_CustomMsgMouseOver, b.m_CustomMsgMouseDown, b.m_CustomMsgMouseUp]).toEqual([-1, -1, -1, -1]);
    expect(b.m_bEnableClick).toBe(true);
    expect(b.m_StaticControls).toEqual([null, null, null, null]);
  });

  test("the over, down and disabled states fall back to the normal point; a point without a transition time is current at once", () => {
    const { w, wrap, m, point } = setup();
    const b = new CKTDGUIButton(w);
    const ud = wrap(b, "CKTDGUIButton");
    m(ud, "SetNormalTex", "B.TGA", "NORMAL");
    m(ud, "SetNormalPoint", point(10, 20));
    expect(corner(b.m_NowPoint)).toEqual([10, 20]); // the setter ends in ChangeState(state, true)
    m(ud, "SetOverTex", "B.TGA", "OVER");
    m(ud, "SetOverPoint", point(30, 40));
    b.ChangeState(BCS.MOUSEOVER, false);
    expect(corner(b.m_EndPoint)).toEqual([30, 40]);
    expect(corner(b.m_NowPoint)).toEqual([30, 40]);
    b.ChangeState(BCS.MOUSEDOWN, false); // no down point: the normal one
    expect(corner(b.m_EndPoint)).toEqual([10, 20]);
    b.ChangeState(BCS.DISABLE, false);
    expect(corner(b.m_EndPoint)).toEqual([10, 20]);
    // a transition time keeps the current point where it was
    m(ud, "SetNormalPoint", point(50, 60, { CHANGE_TIME: 0.5 }));
    b.ChangeState(BCS.NORMAL, false);
    expect(b.m_EndPoint.fChangeTime).toBe(0.5);
    expect(corner(b.m_NowPoint)).toEqual([10, 20]);
  });

  test("entering a state sends the stage a message: 0x466 with 0 / 1, or the custom id as 0x467, then the custom function name as 0x468", () => {
    const { w, wrap, m, dialog, stage, stageLog, point } = setup();
    const d = dialog();
    d.m_pStage = stage;
    const b = new CKTDGUIButton(w);
    d.AddControl(b);
    const ud = wrap(b, "CKTDGUIButton");
    m(ud, "SetNormalTex", "B.TGA", "N");
    m(ud, "SetNormalPoint", point(0, 0));
    b.ChangeState(BCS.MOUSEOVER, false);
    b.ChangeState(BCS.MOUSEDOWN, false);
    expect(stageLog).toEqual([[UIM.CONTROL_EVENT, 0], [UIM.CONTROL_EVENT, 1]]);
    stageLog.length = 0;
    m(ud, "SetCustomMsgMouseOver", 7);
    m(ud, "SetCustomFuncMouseOver", "OnOver");
    b.ChangeState(BCS.NORMAL, false);
    b.ChangeState(BCS.MOUSEOVER, false);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 7], [UIM.CUSTOM_FUNC, "OnOver"]]);
  });

  test("SetShow: hiding hides the statics of all four states, showing shows the one of the current state", () => {
    const { w } = setup();
    const b = new CKTDGUIButton(w);
    const statics = [0, 1, 2, 3].map(() => new CKTDGUIStatic(w));
    statics.forEach((s, i) => (b.m_StaticControls[i] = s));
    b.SetShow(false);
    expect(statics.map((s) => s.m_bShow)).toEqual([false, false, false, false]);
    b.m_ButtonState = BCS.MOUSEDOWN;
    b.SetShow(true);
    expect(statics.map((s) => s.m_bShow)).toEqual([false, false, true, false]);
  });
});

describe("CKTDGUIRadioButton", () => {
  /** a radio button of group `group` in the dialog, with a point of its own so that it can change state */
  function radios(group: number[]) {
    const s = setup();
    const d = s.dialog();
    d.m_pStage = s.stage;
    const buttons = group.map((g, i) => {
      const b = new CKTDGUIRadioButton(s.w);
      b.setNameByForce(`R${i}`);
      d.AddControl(b);
      const ud = s.wrap(b, "CKTDGUIRadioButton");
      s.m(ud, "SetGroupID", g);
      s.m(ud, "SetNormalTex", "R.TGA", "N");
      s.m(ud, "SetRBPoint", s.point(i, i));
      return b;
    });
    return { ...s, d, buttons };
  }

  test("the constructor's defaults (329486F0): it starts in the mouse over state; the checked edge is drawn out, white", () => {
    const { w } = setup();
    const b = new CKTDGUIRadioButton(w);
    expect(b.m_ControlType).toBe(UCT.RADIOBUTTON);
    expect(b.m_RadioButtonState).toBe(RBCS.MOUSEOVER);
    expect([b.m_bChecked, b.m_bPressed, b.m_bRButtonDown, b.m_bEnableDoubleClick, b.m_bEnableCheckToggle, b.m_bShowOffBGByCheck, b.m_bFixOverByCheck]).toEqual(
      [false, false, false, false, false, false, false],
    );
    expect([b.m_CustomMsgMouseOut, b.m_CustomMsgMouseOver, b.m_CustomMsgChecked, b.m_CustomMsgUnChecked, b.m_CustomMsgDoubleClicked, b.m_CustomMsgRButtonUp]).toEqual(
      [-1, -1, -1, -1, -1, -1],
    );
    expect([b.m_GroupID, b.m_bDrawCheckedEdgeOut, b.m_CheckedEdgeWidth, b.m_CheckedEdgeColor.r, b.m_CheckedEdgeColor.a]).toEqual([-1, true, 0, 1, 1]);
    expect(b.m_pCheckedEdgeTexture?.deviceID).toBe("UIEDGE.TGA");
  });

  test("SetGroupID: only a button in a dialog gives its group the RadioButtonGroupInfo (one per id, one button at a time)", () => {
    const { w, wrap, m, dialog } = setup();
    const lonely = new CKTDGUIRadioButton(w);
    m(wrap(lonely, "CKTDGUIRadioButton"), "SetGroupID", 3);
    expect(lonely.m_GroupID).toBe(3);
    const d = dialog();
    expect(d.m_mapRadioButtonGroupInfo.size).toBe(0);
    const a = new CKTDGUIRadioButton(w), b = new CKTDGUIRadioButton(w);
    d.AddControl(a);
    d.AddControl(b);
    m(wrap(a, "CKTDGUIRadioButton"), "SetGroupID", 3);
    m(wrap(b, "CKTDGUIRadioButton"), "SetGroupID", 3);
    expect([...d.m_mapRadioButtonGroupInfo.keys()]).toEqual([3]);
    const info = d.m_mapRadioButtonGroupInfo.get(3)!;
    expect([info.m_iGroupID, info.m_iMaxCheckCount, info.m_vecpCheckedOrder.length]).toEqual([3, 1, 0]);
    expect(lonely.m_pDialog).toBeNull();
  });

  test("checking a button of a group of one unchecks the one before; the checked order is kept", () => {
    const { buttons, d } = radios([1, 1, 2]);
    const [a, b, c] = buttons as [CKTDGUIRadioButton, CKTDGUIRadioButton, CKTDGUIRadioButton];
    a.SetChecked(true);
    c.SetChecked(true);
    expect([a.m_bChecked, b.m_bChecked, c.m_bChecked]).toEqual([true, false, true]); // another group does not interfere
    b.SetChecked(true);
    expect([a.m_bChecked, b.m_bChecked, c.m_bChecked]).toEqual([false, true, true]);
    expect(d.m_mapRadioButtonGroupInfo.get(1)!.m_vecpCheckedOrder).toEqual([b]);
    expect(d.m_mapRadioButtonGroupInfo.get(2)!.m_vecpCheckedOrder).toEqual([c]);
    expect(a.m_RadioButtonState).toBe(RBCS.NORMAL); // the unchecked one went back to normal (it started in mouse over)
  });

  test("SetGroupMaxCheckCount: the oldest checked buttons are unchecked first; checking a checked button again makes it the newest", () => {
    const { buttons, d, wrap, m } = radios([1, 1, 1]);
    const [a, b, c] = buttons as [CKTDGUIRadioButton, CKTDGUIRadioButton, CKTDGUIRadioButton];
    m(wrap(c, "CKTDGUIRadioButton"), "SetGroupMaxCheckCount", 2);
    expect(d.m_mapRadioButtonGroupInfo.get(1)!.m_iMaxCheckCount).toBe(2);
    a.SetChecked(true);
    b.SetChecked(true);
    expect([a.m_bChecked, b.m_bChecked, c.m_bChecked]).toEqual([true, true, false]);
    a.SetChecked(true); // a is the newest now
    expect(d.m_mapRadioButtonGroupInfo.get(1)!.m_vecpCheckedOrder).toEqual([b, a]);
    c.SetChecked(true); // room for one more: b, the oldest, goes
    expect([a.m_bChecked, b.m_bChecked, c.m_bChecked]).toEqual([true, false, true]);
    expect(d.m_mapRadioButtonGroupInfo.get(1)!.m_vecpCheckedOrder).toEqual([a, c]);
    // a maximum of 0 or less: the group empties and the button is entered anyway
    m(wrap(c, "CKTDGUIRadioButton"), "SetGroupMaxCheckCount", 0);
    b.SetChecked(true);
    expect([a.m_bChecked, b.m_bChecked, c.m_bChecked]).toEqual([false, true, false]);
    expect(d.m_mapRadioButtonGroupInfo.get(1)!.m_vecpCheckedOrder).toEqual([b]);
  });

  test("SetChecked(false) unchecks and returns to normal but leaves the button in the order (the exe only enters checked buttons)", () => {
    const { buttons, d } = radios([1]);
    const [a] = buttons as [CKTDGUIRadioButton];
    a.SetChecked(true);
    a.m_RadioButtonState = RBCS.MOUSEOVER;
    a.SetChecked(false);
    expect(a.m_bChecked).toBe(false);
    expect(a.m_RadioButtonState).toBe(RBCS.NORMAL);
    expect(d.m_mapRadioButtonGroupInfo.get(1)!.m_vecpCheckedOrder).toEqual([a]);
  });

  test("what the exe does not guard is reported: no dialog (null handle) and no radio button point (null point)", () => {
    const { w } = setup();
    const lonely = new CKTDGUIRadioButton(w);
    expect(() => lonely.SetChecked(true)).toThrow("no dialog");
    const d = new CKTDGUIDialog(w);
    const b = new CKTDGUIRadioButton(w);
    d.AddControl(b);
    b.SetGroupID(1);
    expect(() => b.SetChecked(false)).toThrow("SetRBPoint");
    b.m_RadioButtonState = RBCS.NORMAL; // the same state: nothing to do, nothing dereferenced
    expect(() => b.SetChecked(false)).not.toThrow();
  });

  test("ChangeState: the radio button point is the control's point; the background point (or the mouse over one) is the end point of the drawing", () => {
    const { buttons, wrap, m, point } = radios([1]);
    const [b] = buttons as [CKTDGUIRadioButton];
    const ud = wrap(b, "CKTDGUIRadioButton");
    m(ud, "SetBGPoint", point(10, 20));
    m(ud, "SetBGMouseOverPoint", point(30, 40));
    m(ud, "SetDisabledPoint", point(70, 80));
    b.ChangeState(RBCS.NORMAL);
    expect(corner(b.m_EndPoint)).toEqual([0, 0]); // SetRBPoint(point(0, 0))
    expect(corner(b.m_NowPoint)).toEqual([0, 0]);
    expect(corner(b.m_MyEndPoint)).toEqual([10, 20]);
    expect(corner(b.m_MyNowPoint)).toEqual([10, 20]);
    b.ChangeState(RBCS.MOUSEOVER);
    expect(corner(b.m_MyEndPoint)).toEqual([30, 40]);
    b.ChangeState(RBCS.DISABLE);
    expect(corner(b.m_MyEndPoint)).toEqual([70, 80]);
    b.m_pBGMouseOverPoint = null; // without a mouse over point the background one stands in
    b.ChangeState(RBCS.MOUSEOVER);
    expect(corner(b.m_MyEndPoint)).toEqual([10, 20]);
    b.m_bChecked = true; // a checked button keeps its state
    b.ChangeState(RBCS.NORMAL);
    expect(b.m_RadioButtonState).toBe(RBCS.MOUSEOVER);
  });

  test("ChangeState to disabled takes the focus away from a button that has it", () => {
    const { buttons, d } = radios([1]);
    const [b] = buttons as [CKTDGUIRadioButton];
    d.requestFocus(b);
    expect(b.m_bHasFocus).toBe(true);
    b.ChangeState(RBCS.DISABLE);
    expect(b.m_bHasFocus).toBe(false);
  });

  test("SetNormalTex feeds the background point; the radio button point keeps the texture it was made with", () => {
    const { w, wrap, m, point } = setup();
    const b = new CKTDGUIRadioButton(w);
    const ud = wrap(b, "CKTDGUIRadioButton");
    m(ud, "SetNormalTex", "A.TGA", "N");
    const first = b.m_pNormalTex;
    expect(first?.texName).toBe("A.TGA");
    m(ud, "SetBGPoint", point(10, 20));
    m(ud, "SetRBPoint", point(10, 20));
    expect(b.m_pBGPoint!.pUITextureData).toBe(first);
    expect(b.m_pRadioButtonPoint!.pUITextureData).toBe(first);
    expect([b.m_pBGPoint!.rightBottomPoint.x, b.m_pBGPoint!.rightBottomPoint.y]).toEqual([74, 52]); // sized from the texture
    m(ud, "SetNormalTex", "B.TGA", "N");
    expect(b.m_pNormalTex).not.toBe(first);
    expect(b.m_pBGPoint!.pUITextureData).toBe(b.m_pNormalTex);
    expect(b.m_pRadioButtonPoint!.pUITextureData).toBe(first);
  });

  test("the other textures feed their points: over -> mouse over background, disable -> disabled, checked -> check point", () => {
    const { w, wrap, m, point } = setup();
    const b = new CKTDGUIRadioButton(w);
    const ud = wrap(b, "CKTDGUIRadioButton");
    for (const [tex, pt] of [["SetOverTex", "SetBGMouseOverPoint"], ["SetDisableTex", "SetDisabledPoint"], ["SetCheckedTex", "SetCheckPoint"]] as const) {
      m(ud, tex, "X.TGA", "K"); // the texture first: the point shows it from the start
      m(ud, pt, point(1, 2));
      m(ud, tex, "Y.TGA", "K"); // a later texture reaches the point as well
    }
    expect(b.m_pBGMouseOverPoint!.pUITextureData).toBe(b.m_pMouseOverTex);
    expect(b.m_pDisabledPoint!.pUITextureData).toBe(b.m_pDisableTex);
    expect(b.m_pCheckedPoint!.pUITextureData).toBe(b.m_pCheckedTex);
    expect(b.m_pMouseOverTex!.texName).toBe("Y.TGA");
    expect(b.m_pBGPoint).toBeNull(); // no background point was made
  });

  test("input sends the stage a message: checked 0, unchecked 1, double click 2 (0x466), or the custom id (0x467)", () => {
    const { buttons, stageLog } = radios([1]);
    const [b] = buttons as [CKTDGUIRadioButton];
    b.setCheckedInternal(true, false, false);
    expect(stageLog).toEqual([]); // from a script nothing is sent
    b.setCheckedInternal(true, false, true);
    b.setCheckedInternal(true, true, true);
    b.setCheckedInternal(false, false, true);
    expect(stageLog).toEqual([[UIM.CONTROL_EVENT, 0], [UIM.CONTROL_EVENT, 2], [UIM.CONTROL_EVENT, 1]]);
    stageLog.length = 0;
    b.SetCustomMsgChecked(11);
    b.SetCustomMsgUnChecked(12);
    b.SetCustomMsgDoubleClicked(13);
    b.setCheckedInternal(true, false, true);
    b.setCheckedInternal(true, true, true);
    b.setCheckedInternal(false, false, true);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 11], [UIM.CUSTOM_MSG, 13], [UIM.CUSTOM_MSG, 12]]);
  });

  test("GetCheckedControl: the first checked button of the group in the order of the dialog", () => {
    const { buttons } = radios([1, 2, 1]);
    const [a, b, c] = buttons as [CKTDGUIRadioButton, CKTDGUIRadioButton, CKTDGUIRadioButton];
    expect(a.GetCheckedControl()).toBeUndefined();
    b.SetChecked(true);
    expect(a.GetCheckedControl()).toBeUndefined(); // b is in another group
    expect(b.GetCheckedControl()).toBe(b);
    c.SetChecked(true);
    expect(a.GetCheckedControl()).toBe(c);
    expect(new CKTDGUIRadioButton(setup().w).GetCheckedControl()).toBeUndefined(); // no dialog
  });

  test("the one-line setters write their members; SetCheckedEdge copies the colour", () => {
    const { w } = setup();
    const b = new CKTDGUIRadioButton(w);
    b.SetCustomMsgMouseOut(1);
    b.SetCustomMsgMouseOver(2);
    b.SetCustomMsgRButtonUp(3);
    b.SetEnableDoubleClick(true);
    b.SetEnableCheckToggle(true);
    b.SetShowOffBGByCheck(true);
    b.SetFixOverByCheck(true);
    expect([b.m_CustomMsgMouseOut, b.m_CustomMsgMouseOver, b.m_CustomMsgRButtonUp]).toEqual([1, 2, 3]);
    expect([b.m_bEnableDoubleClick, b.m_bEnableCheckToggle, b.m_bShowOffBGByCheck, b.m_bFixOverByCheck]).toEqual([true, true, true, true]);
    const color = { r: 0.25, g: 0.5, b: 0.75, a: 0.125 };
    b.SetCheckedEdge(false, 3, color as never);
    expect([b.m_bDrawCheckedEdgeOut, b.m_CheckedEdgeWidth, b.m_CheckedEdgeColor.r, b.m_CheckedEdgeColor.g, b.m_CheckedEdgeColor.b, b.m_CheckedEdgeColor.a]).toEqual(
      [false, 3, 0.25, 0.5, 0.75, 0.125],
    );
  });

  test("SetCustomMouseOverSound / SetCustomMouseUpSound (virtual; the dialog hands its custom sounds to the controls it gets) open the sounds", () => {
    const { w } = setup();
    w.devices.soundSystemInitialised = true;
    w.devices.massFiles.isValidFile = () => true; // every sound file is there
    const d = new CKTDGUIDialog(w);
    d.SetCustomButtonMouseOverSndFile("OVER.OGG");
    d.SetCustomButtonMouseUpSndFile("UP.OGG");
    const b = new CKTDGUIRadioButton(w);
    d.AddControl(b);
    expect(b.m_pSndMouseOver?.deviceID).toBe("OVER.OGG");
    expect(b.m_pSndCheck?.deviceID).toBe("UP.OGG");
  });
});

describe("CKTDGUICheckBox", () => {
  function box() {
    const s = setup();
    const d = s.dialog();
    d.m_pStage = s.stage;
    const b = new CKTDGUICheckBox(s.w);
    d.AddControl(b);
    return { ...s, d, b, ud: s.wrap(b, "CKTDGUICheckBox") };
  }

  test("the constructor's defaults (32930980)", () => {
    const { w } = setup();
    const b = new CKTDGUICheckBox(w);
    expect(b.m_ControlType).toBe(UCT.CHECKBOX);
    expect(b.m_CheckBoxState).toBe(CBCS.NORMAL);
    expect([b.m_bChecked, b.m_bPressed, b.m_bEmptyBGWhenChecked, b.m_CustomMsgChecked, b.m_CustomMsgUnChecked]).toEqual([false, false, false, -1, -1]);
    expect([b.m_CustomFuncChecked, b.m_CustomFuncUnChecked]).toEqual(["", ""]);
  });

  test("SetChecked from a script only sets the state; from input it sends the message (checked 0, unchecked 1, or the custom id) and plays the sound", () => {
    const { b, ud, m, stageLog } = box();
    const snd = new DeviceSound("CHECK.OGG", false);
    b.m_pSndCheck = snd;
    m(ud, "SetChecked", true, false);
    m(ud, "SetChecked", true); // the second argument reads as false
    expect([b.m_bChecked, stageLog.length, snd.plays]).toEqual([true, 0, 0]);
    m(ud, "SetChecked", true, true);
    m(ud, "SetChecked", false, true);
    expect(stageLog).toEqual([[UIM.CONTROL_EVENT, 0], [UIM.CONTROL_EVENT, 1]]);
    expect(snd.plays).toBe(2);
    stageLog.length = 0;
    m(ud, "SetCustomMsgChecked", 5);
    m(ud, "SetCustomMsgUnChecked", 6);
    b.m_CustomFuncChecked = "OnChecked";
    m(ud, "SetChecked", true, true);
    m(ud, "SetChecked", false, true);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 5], [UIM.CUSTOM_FUNC, "OnChecked"], [UIM.CUSTOM_MSG, 6]]);
  });

  test("SetBGPoint makes the point the control's current point too; the normal texture reaches the background point, the checked one the check point", () => {
    const { b, ud, m, point } = box();
    m(ud, "SetNormalTex", "C.TGA", "N");
    m(ud, "SetCheckedTex", "C.TGA", "CK");
    m(ud, "SetBGPoint", point(10, 20));
    m(ud, "SetCheckPoint", point(11, 21));
    expect(corner(b.m_NowPoint)).toEqual([10, 20]);
    expect(b.m_pBGPoint!.pUITextureData).toBe(b.m_pNormalTex);
    expect(b.m_pCheckedPoint!.pUITextureData).toBe(b.m_pCheckedTex);
    const normal = b.m_pNormalTex;
    m(ud, "SetNormalTex", "D.TGA", "N");
    expect(b.m_pNormalTex).not.toBe(normal);
    expect(b.m_pBGPoint!.pUITextureData).toBe(b.m_pNormalTex);
    m(ud, "SetOverTex", "C.TGA", "O");
    m(ud, "SetDisableTex", "C.TGA", "D");
    expect(b.m_pBGPoint!.pUITextureData).toBe(b.m_pNormalTex); // the over and disable textures do not go to a point
    expect([b.m_pMouseOverTex?.keyName, b.m_pDisableTex?.keyName]).toEqual(["O", "D"]);
  });

  test("ChangeState shows the texture of the state on the current point; over and disable fall back to the normal texture", () => {
    const { b, ud, m, point } = box();
    m(ud, "SetNormalTex", "C.TGA", "N");
    m(ud, "SetBGPoint", point(10, 20));
    b.ChangeState(CBCS.MOUSEOVER);
    expect(b.m_NowPoint.pUITextureData).toBe(b.m_pNormalTex);
    m(ud, "SetOverTex", "C.TGA", "O");
    b.ChangeState(CBCS.NORMAL);
    b.ChangeState(CBCS.MOUSEOVER);
    expect(b.m_NowPoint.pUITextureData).toBe(b.m_pMouseOverTex);
    b.ChangeState(CBCS.DISABLE);
    expect(b.m_NowPoint.pUITextureData).toBe(b.m_pNormalTex);
    m(ud, "SetDisableTex", "C.TGA", "D");
    b.ChangeState(CBCS.NORMAL);
    b.ChangeState(CBCS.DISABLE);
    expect(b.m_NowPoint.pUITextureData).toBe(b.m_pDisableTex);
    expect(() => new CKTDGUICheckBox(setup().w).ChangeState(CBCS.DISABLE)).toThrow("SetBGPoint");
  });

  test("SetEmptyBGWhenChecked", () => {
    const { b, ud, m } = box();
    m(ud, "SetEmptyBGWhenChecked", true);
    expect(b.m_bEmptyBGWhenChecked).toBe(true);
  });
});
