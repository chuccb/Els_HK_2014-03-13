import { describe, expect, test } from "bun:test";
import type { TetFile } from "@els/assets";
import { Color, Vec2, Vec3 } from "@els/host";
import {
  CKTDGUIButton, CKTDGUICheckBox, CKTDGUIComboBox, CKTDGUIContolList, CKTDGUIControl, CKTDGUIDialog, CKTDGUIEditBox, CKTDGUIIMEEditBox,
  CKTDGUIListBox, CKTDGUINavigation, CKTDGUIRadioButton, CKTDGUIScrollBar, CKTDGUISlider, CKTDGUISlot, CKTDGUIStatic, CMovieData, CPictureData,
  CX2Slot, DeviceTexture, RadioButtonGroupInfo, TexChangeData, UIPointData, UIStringData, destroyDialogs, setTexureData,
} from "../src/index.ts";
import type { DeviceSound, UKFont, UISlotData, UITextureData } from "../src/index.ts";
import { setup } from "./harness.ts";

/**
 * The destructors of the controls (`Destroy()`; each class's own destructor and then `~CKTDGUIControl` 32923680).  What they release is
 * the point: every texture, sound and render target a control opened is a reference in the device manager (`m_DeviceMap`), and the exe
 * closes them one by one in the order of the destructor's code.  The world here counts them: the stub of `OpenTexture` registers its
 * textures (the harness's does not), `closeDevice` writes down the id of each device that is closed, and `held()` lists what is still open
 * as `ID=references`.
 *
 * Every expected list is read off the decompile of the destructor, member by member (`this->m_pNormalTex`, `~UITextureData`, `CloseDevice`,
 * ...): the textures are destroyed in the order the code reads them, then the points and the string data are freed (a field that becomes
 * null), the sounds and the edge texture are closed, and so on.  Each texture and sound of a control has a name of its own so that the
 * order shows.
 */

// Controls, textures and dialogs each hold the whole world: a failing comparison of two of them would print all of it.  They are
// compared by identity, as booleans, or by name.
const is = (a: unknown, b: unknown): boolean => a === b;
const some = (...xs: unknown[]): string[] => xs.map((x) => (x === null || x === undefined ? "none" : "some"));
const f = Math.fround;

function scene() {
  const s = setup();
  const w = s.w;
  const d = w.devices;
  d.openTexture = ((id: string) => {
    if (id.length === 0) return undefined;
    const key = id.toUpperCase();
    const known = d.devices.get(key);
    if (known) {
      known.refCount++;
      return known;
    }
    const t = new DeviceTexture(key);
    t.info = { ...t.info, Width: 64, Height: 32 };
    t.tet = { getTexUV: () => ({ leftTop: [0, 0], rightTop: [64, 0], leftBottom: [0, 32], rightBottom: [64, 32], rectSize: [64, 32] }) } as unknown as TetFile;
    t.refCount = 1;
    d.devices.set(key, t);
    return t;
  }) as typeof d.openTexture;
  d.soundSystemInitialised = true;
  d.massFiles.isValidFile = () => true;
  const closed: string[] = [];
  const close = d.closeDevice.bind(d);
  d.closeDevice = (id: string) => {
    closed.push(id.toUpperCase());
    close(id);
  };
  /** the ids that were closed since the last call, in order */
  const take = (): string[] => closed.splice(0, closed.length);
  /** every device that is open, with its number of references */
  const held = (): string[] => [...d.devices, ...d.sounds, ...d.renderTargets].map(([id, x]) => `${id}=${x.refCount}`).sort();
  const tex = (file: string): UITextureData => setTexureData(w, file, "k")!;
  const snd = (file: string): DeviceSound => d.openSound(file)!;
  const dialog = new CKTDGUIDialog(w);
  return { ...s, d, dialog, tex, snd, take, held, log: closed };
}

/** the log of `scene()`: the ids of the devices that are closed, and what a spy of the test puts in between */
type Scene = ReturnType<typeof scene>;

/** a texture animation step that shows a texture */
const step = (data: UITextureData): TexChangeData => {
  const t = new TexChangeData();
  t.m_pTexData = data;
  return t;
};

// ---- the data a control holds --------------------------------------------------------------------------------------------------

describe("~UITextureData (32923950), ~TexChangeData (329238B0), ~CPictureData (329237F0)", () => {
  test("a texture data closes the device of its texture once and forgets it; a second destruction finds nothing", () => {
    const { d, tex, take, held } = scene();
    const a = tex("A.TGA");
    tex("A.TGA");
    expect(held()).toEqual(["A.TGA=2"]);
    a.Destroy(d);
    expect([take(), held(), some(a.pTexture)]).toEqual([["A.TGA"], ["A.TGA=1"], ["none"]]);
    a.Destroy(d);
    expect([take(), held()]).toEqual([[], ["A.TGA=1"]]);
  });

  test("an animation step destroys its texture data (when it has a texture) and forgets it", () => {
    const { d, tex, take, held } = scene();
    const a = step(tex("S.TGA"));
    a.Destroy(d);
    expect([take(), held(), some(a.m_pTexData)]).toEqual([["S.TGA"], [], ["none"]]);
    a.Destroy(d); // no texture data
    const b = step(tex("T.TGA"));
    b.m_pTexData!.pTexture = null; // a data without a texture closes nothing, but the step still lets go of it
    b.Destroy(d);
    expect([take(), some(b.m_pTexData)]).toEqual([[], ["none"]]);
  });

  test("a picture closes its texture's device and frees its point data", () => {
    const { w, take, held } = scene();
    const pic = new CPictureData(w);
    pic.SetTex("P.TGA", "k");
    pic.pPoint = new UIPointData();
    expect(held()).toEqual(["P.TGA=1"]);
    pic.Destroy();
    expect([take(), held(), some(pic.pTexture, pic.pPoint)]).toEqual([["P.TGA"], [], ["none", "none"]]);
    pic.Destroy(); // nothing left
    expect(take()).toEqual([]);
  });
});

// ---- ~CKTDGUIControl (32923680) --------------------------------------------------------------------------------------------------

describe("~CKTDGUIControl (32923680)", () => {
  test("the control forgets its dialog and its name, destroys the texture of its running animation, and empties its text, lists and move queue", () => {
    const { w, dialog, tex, take, held } = scene();
    const c = new CKTDGUIControl(w);
    c.m_Name = "ctl";
    dialog.AddControl(c);
    c.m_GuideDesc = "guide";
    c.m_TabControlName = "tab";
    c.m_PrevTabControlName = "prev";
    c.m_DummyIntList.push(1, 2);
    c.m_DummyStringList.push("a");
    c.m_DummyPosList.push(new Vec3(1, 2, 3));
    c.move(new Vec2(1, 2), new Color(1, 1, 1, 1), 1, false, false, false, 2);
    c.m_NowTexChangeData.m_pTexData = tex("NOW.TGA");
    expect([is(c.m_pDialog, dialog), c.m_Name, c.m_queMoveItems.length, held()]).toEqual([true, "ctl", 2, ["NOW.TGA=1"]]);
    c.Destroy();
    expect([c.m_pDialog === null, c.m_Name, c.m_GuideDesc, c.m_TabControlName, c.m_PrevTabControlName]).toEqual([true, "", "", "", ""]);
    expect([c.m_DummyIntList.length, c.m_DummyStringList.length, c.m_DummyPosList.length, c.m_queMoveItems.length]).toEqual([0, 0, 0, 0]);
    expect([take(), held(), some(c.m_NowTexChangeData.m_pTexData)]).toEqual([["NOW.TGA"], [], ["none"]]);
  });
});

// ---- the simple controls ---------------------------------------------------------------------------------------------------------

describe("~CKTDGUIStatic (32928B20)", () => {
  test("the pictures, the movies and the edge texture are released in this order; the lists are empty", () => {
    const { w, dialog, take, held } = scene();
    const st = new CKTDGUIStatic(w);
    st.m_Name = "st";
    dialog.AddControl(st);
    const p0 = new CPictureData(w);
    p0.SetTex("A.TGA", "k");
    const p1 = new CPictureData(w);
    p1.SetTex("B.TGA", "k");
    st.m_PictureDataList.push(p0, p1);
    st.m_StringDataList.push(new UIStringData(), new UIStringData());
    const m0 = new CMovieData(w);
    m0.SetRect(0, 0, 640, 360);
    const m1 = new CMovieData(w);
    m1.SetRect(0, 0, 320, 180); // the render target "MoveData" is shared
    st.m_MovieDataList.push(m0, m1);
    expect(held()).toEqual(["A.TGA=1", "B.TGA=1", "MOVEDATA=2", "UIEDGE.TGA=1"]);
    st.Destroy();
    expect(take()).toEqual(["A.TGA", "B.TGA", "MOVEDATA", "MOVEDATA", "UIEDGE.TGA"]);
    expect(held()).toEqual([]);
    expect([st.m_PictureDataList.length, st.m_StringDataList.length, st.m_MovieDataList.length, some(st.m_pEdgeTexture)]).toEqual([0, 0, 0, ["none"]]);
    expect([some(p0.pTexture, p1.pTexture, m0.m_pRenderTargetTexture, m1.m_pRenderTargetTexture), st.m_Name, st.m_pDialog === null]).toEqual([["none", "none", "none", "none"], "", true]);
  });
});

describe("~CKTDGUICheckBox (329314A0)", () => {
  test("four textures, the two points and the check sound", () => {
    const { w, dialog, tex, snd, take, held } = scene();
    const c = new CKTDGUICheckBox(w);
    c.m_Name = "chk";
    dialog.AddControl(c);
    c.m_pNormalTex = tex("N.TGA");
    c.m_pMouseOverTex = tex("O.TGA");
    c.m_pDisableTex = tex("X.TGA");
    c.m_pCheckedTex = tex("C.TGA");
    c.m_pBGPoint = new UIPointData();
    c.m_pCheckedPoint = new UIPointData();
    c.m_pSndCheck = snd("chk.wav");
    expect(held()).toEqual(["C.TGA=1", "CHK.WAV=1", "N.TGA=1", "O.TGA=1", "X.TGA=1"]);
    c.Destroy();
    expect(take()).toEqual(["N.TGA", "O.TGA", "X.TGA", "C.TGA", "CHK.WAV"]);
    expect(held()).toEqual([]);
    expect(some(c.m_pNormalTex, c.m_pMouseOverTex, c.m_pDisableTex, c.m_pCheckedTex, c.m_pBGPoint, c.m_pCheckedPoint, c.m_pSndCheck)).toEqual(Array(7).fill("none"));
    expect([c.m_Name, c.m_pDialog === null]).toEqual(["", true]);
  });
});

describe("~CKTDGUIRadioButton (32949310)", () => {
  function radio(s: ReturnType<typeof scene>, name: string, group: number): CKTDGUIRadioButton {
    const r = new CKTDGUIRadioButton(s.w);
    r.m_Name = name;
    s.dialog.AddControl(r);
    r.SetGroupID(group);
    return r;
  }

  test("four textures, the five points and the text, the two sounds and the checked edge texture are released", () => {
    const s = scene();
    const r = radio(s, "r", 3);
    r.m_pNormalTex = s.tex("N.TGA");
    r.m_pMouseOverTex = s.tex("O.TGA");
    r.m_pDisableTex = s.tex("X.TGA");
    r.m_pCheckedTex = s.tex("C.TGA");
    for (const key of ["m_pBGPoint", "m_pCheckedPoint", "m_pBGMouseOverPoint", "m_pRadioButtonPoint", "m_pDisabledPoint"] as const) r[key] = new UIPointData();
    r.m_pStringData = new UIStringData();
    r.m_pSndCheck = s.snd("chk.wav");
    r.m_pSndMouseOver = s.snd("over.wav");
    expect(s.held()).toEqual(["C.TGA=1", "CHK.WAV=1", "N.TGA=1", "O.TGA=1", "OVER.WAV=1", "UIEDGE.TGA=1", "X.TGA=1"]);
    r.Destroy();
    expect(s.take()).toEqual(["N.TGA", "O.TGA", "X.TGA", "C.TGA", "CHK.WAV", "OVER.WAV", "UIEDGE.TGA"]);
    expect(s.held()).toEqual([]);
    expect(some(r.m_pNormalTex, r.m_pCheckedTex, r.m_pBGPoint, r.m_pCheckedPoint, r.m_pBGMouseOverPoint, r.m_pRadioButtonPoint, r.m_pDisabledPoint, r.m_pStringData))
      .toEqual(Array(8).fill("none"));
    expect([some(r.m_pSndCheck, r.m_pSndMouseOver, r.m_pCheckedEdgeTexture), r.m_Name, r.m_pDialog === null]).toEqual([["none", "none", "none"], "", true]);
  });

  test("a button in a dialog leaves the checked order of its group: the first place only, the others stay", () => {
    const s = scene();
    const a = radio(s, "a", 3);
    const b = radio(s, "b", 3);
    const other = radio(s, "c", 4);
    const info = s.dialog.m_mapRadioButtonGroupInfo.get(3)!;
    const otherInfo = s.dialog.m_mapRadioButtonGroupInfo.get(4)!;
    info.m_vecpCheckedOrder.push(a, b, a);
    otherInfo.m_vecpCheckedOrder.push(a, other);
    const who = (x: CKTDGUIRadioButton) => (is(x, a) ? "a" : is(x, b) ? "b" : "c"); // a destroyed button has no name any more
    a.Destroy();
    expect(info.m_vecpCheckedOrder.map(who)).toEqual(["b", "a"]);
    expect(otherInfo.m_vecpCheckedOrder.map(who)).toEqual(["a", "c"]); // another group's list is not looked at
  });

  test("a button that is not in its group's order, one whose group the dialog does not know and one in no dialog change nothing", () => {
    const s = scene();
    const a = radio(s, "a", 3);
    const b = radio(s, "b", 3);
    const info = s.dialog.m_mapRadioButtonGroupInfo.get(3)!;
    info.m_vecpCheckedOrder.push(b);
    a.Destroy();
    expect(info.m_vecpCheckedOrder.map((x) => is(x, b))).toEqual([true]);
    const lost = radio(s, "lost", 5);
    s.dialog.m_mapRadioButtonGroupInfo.delete(5);
    lost.Destroy();
    expect(s.dialog.m_mapRadioButtonGroupInfo.size).toBe(1);
    const alone = new CKTDGUIRadioButton(s.w);
    alone.Destroy();
    expect(alone.m_pDialog === null).toBe(true);
  });

  test("a button whose dialog is gone does not touch the dialog's groups (the handle is stale)", () => {
    const s = scene();
    const a = radio(s, "a", 3);
    const info = s.dialog.m_mapRadioButtonGroupInfo.get(3)! as RadioButtonGroupInfo;
    info.m_vecpCheckedOrder.push(a);
    s.dialog.destroyed = true;
    a.Destroy();
    expect(info.m_vecpCheckedOrder.length).toBe(1);
  });
});

describe("~CKTDGUIEditBox (32932FE0) and ~CKTDGUIIMEEditBox (32935F90)", () => {
  for (const [label, make] of [
    ["the edit box", (w: ReturnType<typeof scene>["w"]) => new CKTDGUIEditBox(w)],
    ["the IME edit box", (w: ReturnType<typeof scene>["w"]) => new CKTDGUIIMEEditBox(w)],
  ] as const) {
    test(`${label}: two textures, three points, the key sound, and the text buffer`, () => {
      const { w, dialog, tex, snd, take, held } = scene();
      const e = make(w);
      e.m_Name = "edit";
      dialog.AddControl(e);
      e.m_pNormalTex = tex("N.TGA");
      e.m_pDisableTex = tex("X.TGA");
      e.m_pNormalPoint = new UIPointData();
      e.m_pDisablePoint = new UIPointData();
      e.m_pTextPoint = new UIPointData();
      e.m_pSndKeyDown = snd("key.wav");
      expect(e.m_Buffer.m_pwszBuffer).toBe("");
      expect(held()).toEqual(["KEY.WAV=1", "N.TGA=1", "X.TGA=1"]);
      e.Destroy();
      expect(take()).toEqual(["N.TGA", "X.TGA", "KEY.WAV"]);
      expect(held()).toEqual([]);
      expect(some(e.m_pNormalTex, e.m_pDisableTex, e.m_pNormalPoint, e.m_pDisablePoint, e.m_pTextPoint, e.m_pSndKeyDown)).toEqual(Array(6).fill("none"));
      expect([e.m_Buffer.m_pwszBuffer, e.m_Name, e.m_pDialog === null]).toEqual([null, "", true]);
    });
  }
});

describe("~CKTDGUISlider (3294C970), ~CKTDGUINavigation (3294DE30), ~CKTDGUIScrollBar (329859C0)", () => {
  test("a slider destroys its background and button textures", () => {
    const { w, dialog, tex, take, held } = scene();
    const c = new CKTDGUISlider(w);
    c.m_Name = "sl";
    dialog.AddControl(c);
    c.m_pBGTex = tex("BG.TGA");
    c.m_pButtonTex = tex("BTN.TGA");
    c.Destroy();
    expect([take(), held(), some(c.m_pBGTex, c.m_pButtonTex), c.m_Name, c.m_pDialog === null]).toEqual([["BG.TGA", "BTN.TGA"], [], ["none", "none"], "", true]);
  });

  test("a navigation destroys its two textures, frees its two points and closes its sound", () => {
    const { w, dialog, tex, snd, take, held } = scene();
    const c = new CKTDGUINavigation(w);
    c.m_Name = "nav";
    dialog.AddControl(c);
    c.m_pBGTex = tex("BG.TGA");
    c.m_pWindowTex = tex("WIN.TGA");
    c.m_pBGPoint = new UIPointData();
    c.m_pWindowPoint = new UIPointData();
    c.m_pSndMouseDown = snd("nav.wav");
    c.Destroy();
    expect([take(), held()]).toEqual([["BG.TGA", "WIN.TGA", "NAV.WAV"], []]);
    expect(some(c.m_pBGTex, c.m_pWindowTex, c.m_pBGPoint, c.m_pWindowPoint, c.m_pSndMouseDown)).toEqual(Array(5).fill("none"));
    expect([c.m_Name, c.m_pDialog === null]).toEqual(["", true]);
  });

  test("a scroll bar closes its sound and nothing else: the six textures it draws with belong to its owner", () => {
    const { w, dialog, tex, snd, take, held } = scene();
    const bar = new CKTDGUIScrollBar(w);
    bar.m_Name = "bar";
    dialog.AddControl(bar);
    bar.m_pSndMouseDown = snd("bar.wav");
    const thumb = tex("TH.TGA");
    bar.setThumbTex(thumb);
    bar.setTrackTex(tex("TR.TGA"));
    bar.Destroy();
    expect([take(), held()]).toEqual([["BAR.WAV"], ["TH.TGA=1", "TR.TGA=1"]]);
    expect([some(bar.m_pSndMouseDown)[0], bar.m_Name, bar.m_pDialog === null, is(bar.m_pThumbTex, thumb)]).toEqual(["none", "", true, true]);
  });
});

// ---- the button -------------------------------------------------------------------------------------------------------------------

describe("~CKTDGUIButton (3292C4C0)", () => {
  /**
   * A button in a dialog with four statics (one per state) at offsets of their own: the first and third are in the dialog, the second is in
   * no dialog, the fourth in another one.
   */
  function buttonScene() {
    const s = scene();
    const { w, dialog } = s;
    const b = new CKTDGUIButton(w);
    b.m_Name = "btn";
    b.m_OffsetPos.set(100, 200);
    dialog.AddControl(b);
    const other = new CKTDGUIDialog(w);
    const statics = [0, 1, 2, 3].map((i) => {
      const st = new CKTDGUIStatic(w);
      st.m_Name = `st${i}`;
      st.m_OffsetPos.set(i + 0.5, i + 10);
      b.m_StaticControls[i] = st;
      return st;
    });
    dialog.AddControl(statics[0]);
    dialog.AddControl(statics[2]);
    other.AddControl(statics[3]);
    return { ...s, b, statics, other };
  }

  test("textures, points, the string, the over and up sounds, the edge texture, then the animation steps of the over, normal and down states in key order", () => {
    const s = scene();
    const { w, dialog, tex, snd, take, held } = s;
    const b = new CKTDGUIButton(w);
    b.m_Name = "btn";
    dialog.AddControl(b);
    b.m_pNormalTex = tex("N.TGA");
    b.m_pMouseOverTex = tex("O.TGA");
    b.m_pMouseDownTex = tex("D.TGA");
    b.m_pDisableTex = tex("X.TGA");
    b.m_pNormalPoint = new UIPointData();
    b.m_pMouseOverPoint = new UIPointData();
    b.m_pMouseDownPoint = new UIPointData();
    b.m_pDisablePoint = new UIPointData();
    b.m_pStringData = new UIStringData();
    b.m_pSndMouseOver = snd("over.wav");
    b.m_pSndMouseUp = snd("up.wav");
    b.ChangeMouseDownSound_LUA("down.wav");
    b.m_mapMouseOverTex.set(5, step(tex("O5.TGA")));
    b.m_mapMouseOverTex.set(1, step(tex("O1.TGA")));
    b.m_mapMouseNormalTex.set(3, step(tex("N3.TGA")));
    b.m_mapMouseNormalTex.set(2, step(tex("N2.TGA")));
    b.m_mapMouseDownTex.set(9, step(tex("D9.TGA")));
    b.m_mapMouseDownTex.set(4, step(tex("D4.TGA")));
    expect(held()).toEqual([
      "D.TGA=1", "D4.TGA=1", "D9.TGA=1", "DOWN.WAV=1", "N.TGA=1", "N2.TGA=1", "N3.TGA=1", "O.TGA=1", "O1.TGA=1", "O5.TGA=1", "OVER.WAV=1", "UIEDGE.TGA=1", "UP.WAV=1", "X.TGA=1",
    ]);
    b.Destroy();
    expect(take()).toEqual([
      "N.TGA", "O.TGA", "D.TGA", "X.TGA", "OVER.WAV", "UP.WAV", "UIEDGE.TGA", "O1.TGA", "O5.TGA", "N2.TGA", "N3.TGA", "D4.TGA", "D9.TGA",
    ]);
    expect(held()).toEqual(["DOWN.WAV=1"]); // the exe never closes the mouse down sound: the reference leaks
    expect(some(b.m_pNormalTex, b.m_pMouseOverTex, b.m_pMouseDownTex, b.m_pDisableTex, b.m_pNormalPoint, b.m_pMouseOverPoint, b.m_pMouseDownPoint, b.m_pDisablePoint, b.m_pStringData))
      .toEqual(Array(9).fill("none"));
    expect(some(b.m_pSndMouseOver, b.m_pSndMouseUp, b.m_pEdgeTexture, b.m_pSndMouseDown)).toEqual(["none", "none", "none", "some"]);
    expect([b.m_mapMouseOverTex.size, b.m_mapMouseNormalTex.size, b.m_mapMouseDownTex.size, b.m_Name, b.m_pDialog === null]).toEqual([0, 0, 0, "", true]);
  });

  test("the mouse down sound's reference outlives the button: a sound two buttons share keeps the other's reference and the leaked one", () => {
    const { w, snd, held } = scene();
    const a = new CKTDGUIButton(w);
    const b = new CKTDGUIButton(w);
    a.ChangeMouseDownSound_LUA("down.wav");
    b.ChangeMouseDownSound_LUA("down.wav");
    a.m_pSndMouseOver = snd("down.wav");
    expect(held()).toContain("DOWN.WAV=3");
    a.Destroy();
    expect(held().filter((x) => x.startsWith("DOWN"))).toEqual(["DOWN.WAV=2"]); // the over sound went, the down sound did not
    b.Destroy();
    expect(held().filter((x) => x.startsWith("DOWN"))).toEqual(["DOWN.WAV=2"]);
  });

  test("each static of a state that is in the button's dialog is moved to where it is, to colour 0, in 0.07 s, directly and deleted on arrival: Move(OffsetPos, 0, 0.07f, true, true, false, 1)", () => {
    const { b, statics } = buttonScene();
    const calls: (string | number | boolean)[][] = [];
    for (const st of statics) {
      st.move = (pos, color, time, direct, autoDelete, pingPong, repeat) => {
        calls.push([st.m_Name, pos.x, pos.y, color.r, color.g, color.b, color.a, time, direct, autoDelete, pingPong, repeat]);
      };
    }
    b.Destroy();
    // the first and third static only (the others are not in the dialog), in the order of the states; the offset is the static's own
    expect(calls).toEqual([
      ["st0", 0.5, 10, 0, 0, 0, 0, f(0.07), true, true, false, 1],
      ["st2", 2.5, 12, 0, 0, 0, 0, f(0.07), true, true, false, 1],
    ]);
  });

  test("the move is the real one: the static's goal is its own place and colour 0, reached in 0.07 s, then it is deleted", () => {
    const { b, statics } = buttonScene();
    const [st0, st1] = statics;
    st0!.m_queMoveItems.push({ pos: new Vec2(7, 7), color: new Color(1, 1, 1, 1), fChangeTime: 3, bIsAutoDelete: false });
    b.Destroy();
    expect([st0!.m_GoalPos.x, st0!.m_GoalPos.y, st0!.m_GoalColor.r, st0!.m_GoalColor.a, st0!.m_fChangeTime, st0!.m_bAutoDelete, st0!.m_queMoveItems.length])
      .toEqual([0.5, 10, 0, 0, f(0.07), true, 0]);
    expect([st1!.m_fChangeTime, st1!.m_bAutoDelete]).toEqual([0, false]); // not in the dialog: untouched
  });

  test("no move when the dialog is gone (the handle is stale) or the button is in no dialog", () => {
    const { w, b, statics, dialog } = buttonScene();
    const moves: string[] = [];
    for (const st of statics) st.move = () => void moves.push(st.m_Name);
    dialog.destroyed = true;
    b.Destroy();
    expect(moves).toEqual([]);
    const lone = new CKTDGUIButton(w);
    lone.m_StaticControls[0] = statics[0]!;
    lone.Destroy();
    expect(moves).toEqual([]);
  });

  test("a static that is not in the button's dialog list is not moved even when it belongs to the dialog by name", () => {
    const { b, statics, dialog } = buttonScene();
    const moves: string[] = [];
    for (const st of statics) st.move = () => void moves.push(st.m_Name);
    dialog.m_ControlsList.splice(dialog.m_ControlsList.indexOf(statics[0]!), 1); // CheckControl walks the list
    b.Destroy();
    expect(moves).toEqual(["st2"]);
  });
});

// ---- the list box and the combo box ----------------------------------------------------------------------------------------------

const white = new Color(1, 1, 1, 1);

/** the destructor of a control that writes down that it ran (the timeline of the scene's log) and then runs */
function spyOnDestroy(c: CKTDGUIControl, label: string, log: string[]): void {
  const destroy = c.Destroy.bind(c);
  c.Destroy = () => {
    log.push(label);
    destroy();
  };
}

function spyOnBar(bar: CKTDGUIScrollBar, log: string[]): void {
  const track = bar.setTrackRange.bind(bar);
  bar.setTrackRange = (start, end) => {
    log.push(`track ${start} ${end}`);
    track(start, end);
  };
  spyOnDestroy(bar, "bar", log);
}

describe("~CKTDGUIListBox (329420E0)", () => {
  function listBox(s: Scene) {
    const { w, dialog, snd, log } = s;
    const box = new CKTDGUIListBox(w);
    box.m_Name = "lb";
    dialog.AddControl(box);
    box.SetBoundingBoxTex("LBB.TGA", "k");
    box.SetTextTex("LTX.TGA", "k");
    box.SetButtonMouseOverTex("LMO.TGA", "k");
    box.SetScollBarUpButtonTex("UP.TGA", "k");
    box.SetScollBarUpButtonDownTex("UPD.TGA", "k");
    box.SetScollBarDownButtonTex("DN.TGA", "k");
    box.SetScollBarDownButtonDownTex("DND.TGA", "k");
    box.SetScollBarTrackTex("TR.TGA", "k");
    box.SetScollBarThumbTex("TH.TGA", "k");
    const bar = box.InitScrollBar();
    bar.m_pSndMouseDown = snd("bar.wav");
    box.m_pStringData = new UIStringData();
    box.m_pGroupStringData = new UIStringData();
    box.m_pSndMouseDown = snd("lb.wav");
    box.m_pUKFont = {} as UKFont;
    box.m_pGroupUKFont = {} as UKFont;
    const rows = [0, 1].map((i) => {
      const c = new CKTDGUIStatic(w);
      c.m_Name = `row${i}`;
      box.addString(`t${i}`, white, null, c);
      spyOnDestroy(c, `row${i}`, log);
      return c;
    });
    box.addString("plain", white, null, null); // a row without a control
    box.m_nSelected = 2;
    spyOnBar(bar, log);
    return { box, bar, rows };
  }

  test("the rows' controls go first, then the bar is told the track 0..1 and the textures, string data, bar, scroll bar textures, sound, group mark and fonts follow", () => {
    const s = scene();
    const { box } = listBox(s);
    s.take();
    expect(s.held()).toEqual([
      "BAR.WAV=1", "DLG_MESSENGER.TGA=2", "DN.TGA=1", "DND.TGA=1", "LB.WAV=1", "LBB.TGA=1", "LMO.TGA=1", "LTX.TGA=1", "TH.TGA=1", "TR.TGA=1", "UIEDGE.TGA=3", "UP.TGA=1", "UPD.TGA=1",
    ]);
    box.Destroy();
    expect(s.take()).toEqual([
      "row0", "UIEDGE.TGA", "row1", "UIEDGE.TGA", // the control of each row (a static: its edge texture)
      "track 0 1", "LBB.TGA", "LTX.TGA", // the bar is told the range 0..1; the bounding box and text textures
      "bar", "BAR.WAV", // the bar (its sound; its textures are the box's)
      "LMO.TGA", "DN.TGA", "DND.TGA", "UPD.TGA", "UP.TGA", "TR.TGA", "TH.TGA", // the mouse over texture and the six scroll bar textures
      "LB.WAV", "DLG_MESSENGER.TGA", "DLG_MESSENGER.TGA", "UIEDGE.TGA", // the sound; the group mark (two pictures, then its edge texture)
    ]);
    expect(s.held()).toEqual([]);
  });

  test("the rows are gone, nothing is selected and every field the destructor frees is null", () => {
    const s = scene();
    const { box, rows } = listBox(s);
    box.Destroy();
    expect([box.m_Items.length, box.m_nSelected, box.m_Name, box.m_pDialog === null]).toEqual([0, -1, "", true]);
    expect(some(box.m_pBoudingBoxTex, box.m_pTextTex, box.m_pButtonMouseOverTex, box.m_pStringData, box.m_pGroupStringData, box.m_pScrollBar, box.m_pSndMouseDown, box.m_pGroupMark,
      box.m_pUKFont, box.m_pGroupUKFont)).toEqual(Array(10).fill("none"));
    expect(some(box.m_pScollBarUpButtonTex, box.m_pScollBarUpButtonDownTex, box.m_pScollBarDownButtonTex, box.m_pScollBarDownButtonDownTex, box.m_pScollBarTrackTex,
      box.m_pScollBarThumbTex)).toEqual(Array(6).fill("none"));
    expect(rows.map((r) => r.m_Name)).toEqual(["", ""]); // each row's control was destroyed
  });

  test("a box without a scroll bar or rows destroys what it has", () => {
    const s = scene();
    const box = new CKTDGUIListBox(s.w);
    box.m_nSelected = 4;
    box.Destroy();
    expect([box.m_nSelected, s.take(), s.held()]).toEqual([-1, ["DLG_MESSENGER.TGA", "DLG_MESSENGER.TGA", "UIEDGE.TGA"], []]);
  });
});

describe("the rows' controls of CKTDGUIListBox's RemoveItem (32946E90), RemoveItemByText (32946F90), RemoveAllItems (32946DE0)", () => {
  function rowsBox(s: Scene, texts: string[]) {
    const box = new CKTDGUIListBox(s.w);
    const events: string[] = [];
    const controls = texts.map((t, i) => {
      const c = new CKTDGUIStatic(s.w);
      box.addString(t, white, null, c);
      spyOnDestroy(c, `${t}#${i}`, events);
      return c;
    });
    box.addString("none", white, null, null);
    return { box, controls, events };
  }

  test("RemoveItem deletes the control of the row it removes and no other; an index outside the list does nothing", () => {
    const s = scene();
    const { box, events } = rowsBox(s, ["a", "b", "c"]);
    box.removeItem(7);
    box.removeItem(-1);
    expect([events, box.m_Items.length]).toEqual([[], 4]);
    box.removeItem(1);
    expect([events, box.m_Items.map((r) => r.strText)]).toEqual([["b#1"], ["a", "c", "none"]]);
    box.removeItem(2); // a row without a control
    expect([events, box.m_Items.length]).toEqual([["b#1"], 2]);
  });

  test("RemoveItemByText deletes the control of each row with that text, in order, and no other", () => {
    const s = scene();
    const { box, events } = rowsBox(s, ["x", "y", "x", "x"]);
    expect(box.removeItemByText("x")).toBe(3);
    expect(events).toEqual(["x#0", "x#2", "x#3"]);
    expect(box.m_Items.map((r) => r.strText)).toEqual(["y", "none"]);
    expect(box.removeItemByText("nothing")).toBe(0);
    expect(events.length).toBe(3);
  });

  test("RemoveAllItems deletes every row's control, in order", () => {
    const s = scene();
    const { box, controls, events } = rowsBox(s, ["a", "b", "c"]);
    box.removeAllItems();
    expect([events, box.m_Items.length, controls.map((c) => c.m_Name)]).toEqual([["a#0", "b#1", "c#2"], 0, ["", "", ""]]);
  });
});

describe("~CKTDGUIComboBox (3293C440)", () => {
  function comboBox(s: Scene) {
    const { w, dialog, snd, log } = s;
    const box = new CKTDGUIComboBox(w);
    box.m_Name = "cb";
    dialog.AddControl(box);
    box.SetTextTex("CTX.TGA", "k");
    box.SetButtonTex("CBT.TGA", "k");
    box.SetButtonMouseOverTex("CMO.TGA", "k");
    box.SetButtonMouseDownTex("CMD.TGA", "k");
    box.SetDropdownTex("CDD.TGA", "k");
    box.SetDropdownTextTex("CDT.TGA", "k");
    box.SetScollBarUpButtonTex("UP.TGA", "k");
    box.SetScollBarUpButtonDownTex("UPD.TGA", "k");
    box.SetScollBarDownButtonTex("DN.TGA", "k");
    box.SetScollBarDownButtonDownTex("DND.TGA", "k");
    box.SetScollBarTrackTex("TR.TGA", "k");
    box.SetScollBarThumbTex("TH.TGA", "k");
    box.InitScrollBar();
    const bar = box.m_pScrollBar!;
    bar.m_pSndMouseDown = snd("bar.wav");
    box.m_pStringData = new UIStringData();
    box.m_pSndButtonMouseDown = snd("cbd.wav");
    box.m_pSndButtonMouseOver = snd("cbo.wav");
    const rows = [0, 1].map((i) => {
      const c = new CKTDGUIStatic(w);
      c.m_Name = `row${i}`;
      box.AddControl(c);
      spyOnDestroy(c, `row${i}`, log);
      return c;
    });
    box.m_iSelected = 1;
    box.m_iFocused = 1;
    spyOnBar(bar, log);
    return { box, bar, rows };
  }

  test("the rows' controls go first, then the bar is told the track 0..1 and the textures, string data, bar, scroll bar textures and the two sounds follow", () => {
    const s = scene();
    const { box } = comboBox(s);
    s.take();
    expect(s.held()).toEqual([
      "BAR.WAV=1", "CBD.WAV=1", "CBO.WAV=1", "CBT.TGA=1", "CDD.TGA=1", "CDT.TGA=1", "CMD.TGA=1", "CMO.TGA=1", "CTX.TGA=1", "DN.TGA=1", "DND.TGA=1", "TH.TGA=1", "TR.TGA=1",
      "UIEDGE.TGA=2", "UP.TGA=1", "UPD.TGA=1",
    ]);
    box.Destroy();
    expect(s.take()).toEqual([
      "row0", "UIEDGE.TGA", "row1", "UIEDGE.TGA", // the control of each row (a static: its edge texture)
      "track 0 1", "CTX.TGA", "CBT.TGA", "CMD.TGA", "CMO.TGA", "CDD.TGA", "CDT.TGA", // the bar is told the range 0..1; the six textures of the box
      "bar", "BAR.WAV", // the bar (its sound; its textures are the box's)
      "DN.TGA", "DND.TGA", "UP.TGA", "UPD.TGA", "TR.TGA", "TH.TGA", // the six scroll bar textures
      "CBD.WAV", "CBO.WAV",
    ]);
    expect(s.held()).toEqual([]);
  });

  test("the rows are gone, nothing is selected or focused and every field the destructor frees is null", () => {
    const s = scene();
    const { box, rows } = comboBox(s);
    box.Destroy();
    expect([box.m_Items.length, box.m_iSelected, box.m_iFocused, box.m_Name, box.m_pDialog === null]).toEqual([0, -1, -1, "", true]);
    expect(some(box.m_pTextTex, box.m_pButtonTex, box.m_pButtonMouseDownTex, box.m_pButtonMouseOverTex, box.m_pDropdownTex, box.m_pDropdownTextTex, box.m_pStringData, box.m_pScrollBar,
      box.m_pSndButtonMouseDown, box.m_pSndButtonMouseOver)).toEqual(Array(10).fill("none"));
    expect(some(box.m_pScollBarUpButtonTex, box.m_pScollBarUpButtonDownTex, box.m_pScollBarDownButtonTex, box.m_pScollBarDownButtonDownTex, box.m_pScollBarTrackTex,
      box.m_pScollBarThumbTex)).toEqual(Array(6).fill("none"));
    expect(rows.map((r) => r.m_Name)).toEqual(["", ""]);
  });

  test("a box without a scroll bar or rows destroys what it has", () => {
    const s = scene();
    const box = new CKTDGUIComboBox(s.w);
    box.m_pTextTex = s.tex("CTX.TGA");
    box.m_iSelected = 3;
    box.m_iFocused = 2;
    box.Destroy();
    expect([box.m_iSelected, box.m_iFocused, s.take(), s.held()]).toEqual([-1, -1, ["CTX.TGA"], []]);
  });
});

// ---- the control list ------------------------------------------------------------------------------------------------------------

describe("~CKTDGUIContolList (3294F200)", () => {
  test("the cells are forgotten (their controls are the dialog's), both scroll bars are deleted, then the twelve textures, X before Y", () => {
    const { w, dialog, tex, snd, take, held, log } = scene();
    const list = new CKTDGUIContolList(w);
    list.m_Name = "list";
    dialog.AddControl(list);
    for (const [axis, tag] of [[list.xTex, "X"], [list.yTex, "Y"]] as const) {
      axis.upButton = tex(`${tag}UP.TGA`);
      axis.upButtonDown = tex(`${tag}UPD.TGA`);
      axis.downButton = tex(`${tag}DN.TGA`);
      axis.downButtonDown = tex(`${tag}DND.TGA`);
      axis.track = tex(`${tag}TR.TGA`);
      axis.thumb = tex(`${tag}TH.TGA`);
    }
    const barX = list.InitXScrollBar();
    const barY = list.InitYScrollBar();
    barX.m_pSndMouseDown = snd("bx.wav");
    barY.m_pSndMouseDown = snd("by.wav");
    const cell = new CKTDGUIStatic(w);
    cell.m_Name = "cell";
    spyOnDestroy(cell, "cell", log);
    list.m_mapControls.getOrInsert(1, 2, () => []).push({ m_pControl: cell, m_bUseAbsolutePos: false });
    list.m_mapControls.getOrInsert(0, 5, () => []).push({ m_pControl: cell, m_bUseAbsolutePos: true });
    list.m_vecNowControls.push(cell);
    take();
    expect(held().length).toBe(12 + 2 + 1);
    list.Destroy();
    expect(take()).toEqual([
      "BX.WAV", "BY.WAV", // the bars
      "XUP.TGA", "XUPD.TGA", "XDN.TGA", "XDND.TGA", "XTR.TGA", "XTH.TGA",
      "YUP.TGA", "YUPD.TGA", "YDN.TGA", "YDND.TGA", "YTR.TGA", "YTH.TGA",
    ]);
    expect(held()).toEqual(["UIEDGE.TGA=1"]); // the cell's control is still there, open
    expect([list.m_mapControls.size, list.m_vecNowControls.length, some(list.m_pScrollBarX, list.m_pScrollBarY), list.m_Name, list.m_pDialog === null, cell.m_Name])
      .toEqual([0, 0, ["none", "none"], "", true, "cell"]);
    expect(some(list.xTex.upButton, list.xTex.upButtonDown, list.xTex.downButton, list.xTex.downButtonDown, list.xTex.track, list.xTex.thumb,
      list.yTex.upButton, list.yTex.upButtonDown, list.yTex.downButton, list.yTex.downButtonDown, list.yTex.track, list.yTex.thumb)).toEqual(Array(12).fill("none"));
  });

  test("a list without scroll bars or textures destroys what it has", () => {
    const s = scene();
    const list = new CKTDGUIContolList(s.w);
    list.m_mapControls.getOrInsert(0, 0, () => []);
    list.Destroy();
    expect([list.m_mapControls.size, s.take()]).toEqual([0, []]);
  });
});

// ---- the slot --------------------------------------------------------------------------------------------------------------------

describe("~CKTDGUISlot (32950CA0)", () => {
  function slotScene() {
    const s = scene();
    const { w, dialog, tex, snd, log } = s;
    const slot = new CKTDGUISlot(w);
    slot.m_Name = "slot";
    dialog.AddControl(slot);
    for (const key of [2, 0, 1]) {
      const p = new CPictureData(w);
      p.SetTex(`P${key}.TGA`, "k");
      slot.m_mapAdditionalPictureDataList.set(key, p);
    }
    slot.m_pItemTex = tex("ITEM.TGA");
    slot.m_pMouseOverTex = tex("MO.TGA");
    slot.m_pStringData = new UIStringData();
    slot.m_pNormalPoint = new UIPointData();
    slot.m_pMouseOverPoint = new UIPointData();
    slot.m_pDraggingPoint = new UIPointData();
    slot.m_pSndMouseOver = snd("so.wav");
    slot.m_pSndMouseUp = snd("su.wav");
    slot.m_pSndMouseDown = snd("sd.wav");
    const data: UISlotData = { m_bDataUpdated: false, Destroy: () => void log.push("slot data"), UpdateUI: () => {} };
    slot.m_pSlotData = data;
    return { ...s, slot, data };
  }

  test("the additional pictures in key order, the two textures, the sounds, the edge texture and the slot data are released", () => {
    const s = slotScene();
    s.take();
    CKTDGUISlot.s_pDragSlot = null;
    s.slot.Destroy();
    expect(s.take()).toEqual(["P0.TGA", "P1.TGA", "P2.TGA", "ITEM.TGA", "MO.TGA", "SO.WAV", "SU.WAV", "SD.WAV", "UIEDGE.TGA", "slot data"]);
    expect(s.held()).toEqual([]);
    expect([s.slot.m_mapAdditionalPictureDataList.size, some(s.slot.m_pItemTex, s.slot.m_pMouseOverTex, s.slot.m_pStringData, s.slot.m_pNormalPoint, s.slot.m_pMouseOverPoint,
      s.slot.m_pDraggingPoint, s.slot.m_pSndMouseOver, s.slot.m_pSndMouseUp, s.slot.m_pSndMouseDown, s.slot.m_pEdgeTexture, s.slot.m_pSlotData), s.slot.m_Name, s.slot.m_pDialog === null])
      .toEqual([0, Array(11).fill("none"), "", true]);
  });

  test("the slot that is being dragged stops being it; another one is left alone", () => {
    const s = slotScene();
    CKTDGUISlot.s_pDragSlot = s.slot;
    s.slot.Destroy();
    expect(CKTDGUISlot.s_pDragSlot === null).toBe(true);
    const other = new CKTDGUISlot(s.w);
    const mine = new CKTDGUISlot(s.w);
    CKTDGUISlot.s_pDragSlot = other;
    mine.Destroy();
    expect(is(CKTDGUISlot.s_pDragSlot, other)).toBe(true);
    CKTDGUISlot.s_pDragSlot = null;
  });

  test("a slot without data or pictures destroys what it has", () => {
    const s = scene();
    const slot = new CKTDGUISlot(s.w);
    CKTDGUISlot.s_pDragSlot = null;
    slot.Destroy();
    expect([s.take(), s.held(), slot.m_pSlotData === null]).toEqual([["UIEDGE.TGA"], [], true]);
  });
});

describe("~CX2Slot (32E5D830)", () => {
  function dialogOf(s: Scene, events: string[], label: string, managed = true): CKTDGUIDialog {
    const d = new CKTDGUIDialog(s.w);
    if (managed) s.w.dialogManager.addDlg(d);
    const destroy = d.Destroy.bind(d);
    d.Destroy = () => {
      events.push(label);
      destroy();
    };
    return d;
  }

  test("the slot's dialog and then its fixed back dialog are deleted from the application's manager and forgotten", () => {
    const s = scene();
    const events: string[] = [];
    const slot = new CX2Slot(s.w);
    const a = dialogOf(s, events, "slot");
    const b = dialogOf(s, events, "back");
    slot.m_pDLGSlotFixBack = b;
    slot.m_pDLGSlot = a;
    slot.Destroy();
    expect(events).toEqual(["slot", "back"]);
    expect([some(slot.m_pDLGSlot, slot.m_pDLGSlotFixBack), a.destroyed, b.destroyed, s.w.dialogManager.checkDlg(a), s.w.dialogManager.checkDlg(b)]).toEqual([["none", "none"], true, true, false, false]);
  });

  test("a handle whose dialog is gone is left as it is; the other one is still deleted", () => {
    const s = scene();
    const events: string[] = [];
    const slot = new CX2Slot(s.w);
    const gone = dialogOf(s, events, "gone");
    gone.destroyed = true;
    const back = dialogOf(s, events, "back");
    slot.m_pDLGSlot = gone;
    slot.m_pDLGSlotFixBack = back;
    slot.Destroy();
    expect(events).toEqual(["back"]);
    expect([is(slot.m_pDLGSlot, gone), some(slot.m_pDLGSlotFixBack)]).toEqual([true, ["none"]]);
    const only = new CX2Slot(s.w);
    only.m_pDLGSlotFixBack = gone;
    only.Destroy(); // nothing is done for a stale fixed back handle either
    expect([events, is(only.m_pDLGSlotFixBack, gone)]).toEqual([["back"], true]);
  });

  test("a live dialog that the manager does not know is not destroyed, but the handle is cleared all the same", () => {
    const s = scene();
    const events: string[] = [];
    const slot = new CX2Slot(s.w);
    const stranger = dialogOf(s, events, "stranger", false);
    slot.m_pDLGSlot = stranger;
    slot.Destroy();
    expect([events, stranger.destroyed, some(slot.m_pDLGSlot)]).toEqual([[], false, ["none"]]);
    new CX2Slot(s.w).Destroy(); // no dialogs at all
  });
});

// ---- the dialog destroys its controls --------------------------------------------------------------------------------------------

describe("~CKTDGUIDialog (329554D0) with the destructors of the controls", () => {
  test("a button's static that comes later in the dialog's list is still moved when the button goes; one that came earlier was destroyed (and taken out of the list) already", () => {
    const s = scene();
    const { w, dialog, held } = s;
    const early = new CKTDGUIStatic(w);
    early.m_Name = "early";
    const b = new CKTDGUIButton(w);
    b.m_Name = "btn";
    const late = new CKTDGUIStatic(w);
    late.m_Name = "late";
    for (const c of [early, b, late]) dialog.AddControl(c);
    b.m_StaticControls[0] = early;
    b.m_StaticControls[1] = late;
    const moves: string[] = [];
    early.move = () => void moves.push("early");
    late.move = () => void moves.push("late");
    dialog.Destroy();
    expect(moves).toEqual(["late"]);
    expect([dialog.m_ControlsList.length, dialog.m_ControlsMap.size, held()]).toEqual([0, 0, []]);
    expect([early.m_Name, b.m_Name, late.m_Name]).toEqual(["", "", ""]); // every control was destroyed
  });
});

describe("std::map::clear of the control list's cells", () => {
  test("clear() empties the map and it can be filled again", () => {
    const list = new CKTDGUIContolList(scene().w);
    const map = list.m_mapControls;
    map.getOrInsert(2, 1, () => []);
    map.getOrInsert(0, 0, () => []);
    expect(map.size).toBe(2);
    map.clear();
    expect([map.size, map.get(2, 1) === undefined, [...map].length]).toEqual([0, true, 0]);
    map.getOrInsert(5, 5, () => []);
    expect(map.size).toBe(1);
  });
});

// ---- the references the exe leaves open ------------------------------------------------------------------------------------------

describe("the sound references the exe never closes", () => {
  const ids = (c: CKTDGUIControl): string[] => c.leakedSounds.map((x) => x.deviceID);
  /** the sounds that are open (the controls' edge textures are not the point here) */
  const sounds = (held: () => string[]): string[] => held().filter((x) => x.includes(".WAV="));

  test("a button's custom over and up sounds replace the sounds it opened itself, and those two references stay open for good (3292F680, 3292F730)", () => {
    const { w, snd, held } = scene();
    const b = new CKTDGUIButton(w);
    b.m_pSndMouseOver = snd("over.wav");
    b.m_pSndMouseUp = snd("up.wav");
    b.setCustomMouseOverSound("custom_over.wav");
    b.setCustomMouseUpSound("custom_up.wav");
    expect(sounds(held)).toEqual(["CUSTOM_OVER.WAV=1", "CUSTOM_UP.WAV=1", "OVER.WAV=1", "UP.WAV=1"]);
    expect([ids(b), b.m_pSndMouseOver?.deviceID, b.m_pSndMouseUp?.deviceID]).toEqual([["OVER.WAV", "UP.WAV"], "CUSTOM_OVER.WAV", "CUSTOM_UP.WAV"]);
    b.Destroy();
    expect(sounds(held)).toEqual(["OVER.WAV=1", "UP.WAV=1"]);
  });

  test("a button that had no sound leaks none when it gets a custom one; the custom ones are closed with it", () => {
    const { w, held } = scene();
    const b = new CKTDGUIButton(w);
    b.setCustomMouseOverSound("custom_over.wav");
    b.setCustomMouseUpSound("custom_up.wav");
    expect([ids(b), sounds(held)]).toEqual([[], ["CUSTOM_OVER.WAV=1", "CUSTOM_UP.WAV=1"]]);
    b.Destroy();
    expect([ids(b), sounds(held)]).toEqual([[], []]);
  });

  test("the mouse down sound is listed when the button is destroyed, and it is the only one that is: Change...Sound closes the sound it replaces", () => {
    const { w, snd, held } = scene();
    const b = new CKTDGUIButton(w);
    b.m_pSndMouseOver = snd("over.wav");
    b.ChangeMouseOverSound_LUA("over2.wav");
    b.ChangeMouseUpSound_LUA("up2.wav");
    b.ChangeMouseDownSound_LUA("down1.wav");
    b.ChangeMouseDownSound_LUA("down2.wav");
    expect([ids(b), sounds(held)]).toEqual([[], ["DOWN2.WAV=1", "OVER2.WAV=1", "UP2.WAV=1"]]);
    b.Destroy();
    expect([ids(b), sounds(held)]).toEqual([["DOWN2.WAV"], ["DOWN2.WAV=1"]]);
    const none = new CKTDGUIButton(w);
    none.Destroy();
    expect(ids(none)).toEqual([]);
  });

  test("a radio button's custom over and check sounds leave the old references open (3294BD80, 3294BE30)", () => {
    const { w, snd, held } = scene();
    const r = new CKTDGUIRadioButton(w);
    r.m_pSndMouseOver = snd("over.wav");
    r.m_pSndCheck = snd("check.wav");
    r.setCustomMouseOverSound("custom_over.wav");
    r.setCustomMouseUpSound("custom_check.wav");
    expect([ids(r), r.m_pSndMouseOver?.deviceID, r.m_pSndCheck?.deviceID]).toEqual([["OVER.WAV", "CHECK.WAV"], "CUSTOM_OVER.WAV", "CUSTOM_CHECK.WAV"]);
    r.Destroy();
    expect(sounds(held)).toEqual(["CHECK.WAV=1", "OVER.WAV=1"]);
    const bare = new CKTDGUIRadioButton(w);
    bare.setCustomMouseOverSound("custom_over.wav");
    bare.setCustomMouseUpSound("custom_check.wav");
    expect(ids(bare)).toEqual([]);
  });

  test("a dialog with custom button sounds hands them to the buttons and radio buttons it gets and to nothing else; a destroyed dialog leaves exactly the replaced references", () => {
    const { w, dialog, snd, held } = scene();
    dialog.SetCustomButtonMouseOverSndFile("cover.wav");
    dialog.SetCustomButtonMouseUpSndFile("cup.wav");
    const b = new CKTDGUIButton(w);
    b.m_pSndMouseOver = snd("over.wav");
    b.m_pSndMouseUp = snd("up.wav");
    const r = new CKTDGUIRadioButton(w);
    r.m_pSndMouseOver = snd("over.wav");
    r.m_pSndCheck = snd("check.wav");
    const c = new CKTDGUICheckBox(w);
    c.m_pSndCheck = snd("check.wav");
    const st = new CKTDGUIStatic(w);
    for (const x of [b, r, c, st]) dialog.AddControl(x);
    expect([ids(b), ids(r), ids(c), ids(st)]).toEqual([["OVER.WAV", "UP.WAV"], ["OVER.WAV", "CHECK.WAV"], [], []]);
    dialog.Destroy();
    expect(sounds(held)).toEqual(["CHECK.WAV=1", "OVER.WAV=2", "UP.WAV=1"]); // the check box closed its own check sound, and nothing leaked but the replaced references
  });

  test("a dialog hands on only the custom sounds it has: with none, or only one, the buttons keep the other sound they opened", () => {
    const { w, snd } = scene();
    const make = (dialog: CKTDGUIDialog): { b: CKTDGUIButton; r: CKTDGUIRadioButton } => {
      const b = new CKTDGUIButton(w);
      b.m_pSndMouseOver = snd("over.wav");
      b.m_pSndMouseUp = snd("up.wav");
      const r = new CKTDGUIRadioButton(w);
      r.m_pSndMouseOver = snd("over.wav");
      r.m_pSndCheck = snd("check.wav");
      dialog.AddControl(b);
      dialog.AddControl(r);
      return { b, r };
    };
    const sound = (x: DeviceSound | undefined): string => x?.deviceID ?? "none";
    const none = make(new CKTDGUIDialog(w));
    expect([ids(none.b), ids(none.r)]).toEqual([[], []]);
    expect([sound(none.b.m_pSndMouseOver), sound(none.b.m_pSndMouseUp), sound(none.r.m_pSndMouseOver), sound(none.r.m_pSndCheck)]).toEqual(["OVER.WAV", "UP.WAV", "OVER.WAV", "CHECK.WAV"]);
    const onlyOver = new CKTDGUIDialog(w);
    onlyOver.SetCustomButtonMouseOverSndFile("cover.wav");
    const a = make(onlyOver);
    expect([ids(a.b), ids(a.r)]).toEqual([["OVER.WAV"], ["OVER.WAV"]]);
    expect([sound(a.b.m_pSndMouseOver), sound(a.b.m_pSndMouseUp), sound(a.r.m_pSndMouseOver), sound(a.r.m_pSndCheck)]).toEqual(["COVER.WAV", "UP.WAV", "COVER.WAV", "CHECK.WAV"]);
    const onlyUp = new CKTDGUIDialog(w);
    onlyUp.SetCustomButtonMouseUpSndFile("cup.wav");
    const c = make(onlyUp);
    expect([ids(c.b), ids(c.r)]).toEqual([["UP.WAV"], ["CHECK.WAV"]]);
    expect([sound(c.b.m_pSndMouseOver), sound(c.b.m_pSndMouseUp), sound(c.r.m_pSndMouseOver), sound(c.r.m_pSndCheck)]).toEqual(["OVER.WAV", "CUP.WAV", "OVER.WAV", "CUP.WAV"]);
  });

  test("a button's three Change...Sound methods each close the sound they replace and no other, and leave nothing in the leaked list; the new name may be empty", () => {
    const { w, take, held } = scene();
    const b = new CKTDGUIButton(w);
    b.ChangeMouseOverSound_LUA("o1.wav");
    b.ChangeMouseUpSound_LUA("u1.wav");
    b.ChangeMouseDownSound_LUA("d1.wav");
    take();
    b.ChangeMouseOverSound_LUA("o2.wav");
    expect([take(), sounds(held), b.m_pSndMouseOver?.deviceID]).toEqual([["O1.WAV"], ["D1.WAV=1", "O2.WAV=1", "U1.WAV=1"], "O2.WAV"]);
    b.ChangeMouseUpSound_LUA("u2.wav");
    expect([take(), sounds(held), b.m_pSndMouseUp?.deviceID]).toEqual([["U1.WAV"], ["D1.WAV=1", "O2.WAV=1", "U2.WAV=1"], "U2.WAV"]);
    b.ChangeMouseDownSound_LUA("d2.wav");
    expect([take(), sounds(held), b.m_pSndMouseDown?.deviceID]).toEqual([["D1.WAV"], ["D2.WAV=1", "O2.WAV=1", "U2.WAV=1"], "D2.WAV"]);
    b.ChangeMouseOverSound_LUA("");
    b.ChangeMouseUpSound_LUA("");
    b.ChangeMouseDownSound_LUA("");
    expect([take(), sounds(held), some(b.m_pSndMouseOver, b.m_pSndMouseUp, b.m_pSndMouseDown), ids(b)]).toEqual([["O2.WAV", "U2.WAV", "D2.WAV"], [], ["none", "none", "none"], []]);
    b.ChangeMouseOverSound_LUA(""); // nothing to close
    expect(take()).toEqual([]);
  });

  test("a Change...Sound to the sound the button has closes it first (its device goes) and opens it afresh: a new device object, one reference", () => {
    const { w, take, held } = scene();
    const b = new CKTDGUIButton(w);
    b.ChangeMouseOverSound_LUA("o.wav");
    b.ChangeMouseUpSound_LUA("u.wav");
    b.ChangeMouseDownSound_LUA("d.wav");
    const before = [b.m_pSndMouseOver, b.m_pSndMouseUp, b.m_pSndMouseDown];
    take();
    b.ChangeMouseOverSound_LUA("o.wav");
    b.ChangeMouseUpSound_LUA("u.wav");
    b.ChangeMouseDownSound_LUA("d.wav");
    expect(take()).toEqual(["O.WAV", "U.WAV", "D.WAV"]);
    expect(sounds(held)).toEqual(["D.WAV=1", "O.WAV=1", "U.WAV=1"]);
    expect([is(b.m_pSndMouseOver, before[0]), is(b.m_pSndMouseUp, before[1]), is(b.m_pSndMouseDown, before[2])]).toEqual([false, false, false]);
  });

  test("the device manager tells the stray close hook the id of a close that finds no device: an empty id and an open device do not", () => {
    const { w } = setup();
    const d = w.devices;
    d.soundSystemInitialised = true;
    d.massFiles.isValidFile = () => true;
    const strays: string[] = [];
    d.onStrayClose = (id) => void strays.push(id);
    d.closeDevice("");
    d.closeDevice("nothing.ogg");
    d.openSound("a.ogg");
    d.openSound("a.ogg");
    d.closeDevice("a.ogg");
    d.closeDevice("A.OGG");
    expect([strays, d.sounds.size]).toEqual([["NOTHING.OGG"], 0]);
    d.closeDevice("a.ogg"); // one close too many
    expect(strays).toEqual(["NOTHING.OGG", "A.OGG"]);
    d.onStrayClose = undefined;
    d.closeDevice("a.ogg");
    expect(strays.length).toBe(2);
  });

  test("an open texture or render target is not a stray close; the close after its last reference is", () => {
    const { w } = setup();
    const d = w.devices;
    const strays: string[] = [];
    d.onStrayClose = (id) => void strays.push(id);
    const texture = new DeviceTexture("T.TGA");
    texture.refCount = 2;
    d.devices.set("T.TGA", texture);
    d.openRenderTargetTexture("rt", 8, 8, 0);
    d.closeDevice("t.tga");
    d.closeDevice("T.TGA");
    d.closeDevice("rt");
    expect([strays, d.devices.size, d.renderTargets.size]).toEqual([[], 0, 0]);
    d.closeDevice("t.tga");
    d.closeDevice("RT");
    expect(strays).toEqual(["T.TGA", "RT"]);
  });
});

// ---- destroying every dialog of a census world -----------------------------------------------------------------------------------

describe("destroyDialogs: what the census reports after it destroys the dialogs of a world", () => {
  /** two dialogs: a static with a picture in the first, a button with a custom over sound and a mouse down sound in the second */
  function twoDialogs(s: Scene) {
    const { w, snd } = s;
    const d1 = new CKTDGUIDialog(w);
    const d2 = new CKTDGUIDialog(w);
    const st = new CKTDGUIStatic(w);
    st.m_Name = "st";
    d1.AddControl(st);
    const picture = new CPictureData(w);
    picture.SetTex("P.TGA", "k");
    st.m_PictureDataList.push(picture);
    const b = new CKTDGUIButton(w);
    b.m_Name = "b";
    d2.AddControl(b);
    b.m_pSndMouseOver = snd("over.wav");
    b.setCustomMouseOverSound("custom.wav");
    b.ChangeMouseDownSound_LUA("down.wav");
    const order: string[] = [];
    spyOnDestroy(st, "st", order);
    spyOnDestroy(b, "b", order);
    return { d1, d2, st, b, order };
  }

  test("the dialogs are destroyed in order; the count of dialogs and controls, what stays open (against the baseline) and the leaks the controls recorded", () => {
    const s = scene();
    const { d1, d2, order } = twoDialogs(s);
    s.tex("KEEP.TGA"); // open before the scripts ran: the baseline
    const report = destroyDialogs({ ui: s.w, runs: [], dialogs: [d1, d2], baseline: new Map([["KEEP.TGA", 1]]), strayCloses: [] });
    expect(order).toEqual(["st", "b"]);
    expect(report).toEqual({
      dialogs: 2, controls: 2, errors: [], strays: {},
      left: { "DOWN.WAV": 1, "OVER.WAV": 1 }, // the over sound the custom one replaced, and the mouse down sound
      leaked: { "DOWN.WAV": 1, "OVER.WAV": 1 },
    });
    expect([d1.destroyed, d2.destroyed, s.held()]).toEqual([true, true, ["DOWN.WAV=1", "KEEP.TGA=1", "OVER.WAV=1"]]);
  });

  test("a destruction that throws is reported with the index of its dialog and the others are destroyed all the same", () => {
    const s = scene();
    const { d1, d2, order } = twoDialogs(s);
    d1.Destroy = () => {
      throw new Error("boom");
    };
    const report = destroyDialogs({ ui: s.w, runs: [], dialogs: [d1, d2], baseline: new Map(), strayCloses: [] });
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]).toMatch(/^0: .*boom/);
    expect([order, d2.destroyed, report.dialogs, report.controls]).toEqual([["b"], true, 2, 2]);
  });

  test("only the closes that found no device during the destruction are reported", () => {
    const s = scene();
    const { d1, d2, st } = twoDialogs(s);
    st.m_pEdgeTexture = new DeviceTexture("GHOST.TGA"); // a texture the device manager does not hold
    const strays: string[] = ["EARLIER.TGA"]; // a close of the scripts themselves, before the destruction
    s.d.onStrayClose = (id) => void strays.push(id);
    const report = destroyDialogs({ ui: s.w, runs: [], dialogs: [d1, d2], baseline: new Map(), strayCloses: strays });
    expect(report.strays).toEqual({ "GHOST.TGA": 1 });
  });

  test("what stays open is the difference to the baseline, in both directions and in the order of the ids", () => {
    const s = scene();
    const { d1, d2 } = twoDialogs(s);
    s.tex("LEFT.TGA");
    s.tex("LEFT.TGA");
    const report = destroyDialogs({ ui: s.w, runs: [], dialogs: [d1, d2], baseline: new Map([["LEFT.TGA", 1], ["GONE.TGA", 3]]), strayCloses: [] });
    expect(report.left).toEqual({ "DOWN.WAV": 1, "GONE.TGA": -3, "LEFT.TGA": 1, "OVER.WAV": 1 });
    expect(Object.keys(report.left)).toEqual(["DOWN.WAV", "GONE.TGA", "LEFT.TGA", "OVER.WAV"]);
    expect(Object.keys(report.leaked)).toEqual(["DOWN.WAV", "OVER.WAV"]);
  });
});
