import { describe, expect, test } from "bun:test";
import type { LuaUserdata } from "@els/lua";
import { CKTDGUIButton, CKTDGUIDialog, CKTDGUIStatic, CPictureData, UIRender, UIStringData } from "../src/index.ts";
import type { UKFont } from "../src/index.ts";
import { Recorder, rig } from "./rig.ts";
import { setup } from "./harness.ts";

const f = Math.fround;

/**
 * The fade-in of a dialog (`CKTDGUIDialog::CKTDGUIDialog` 32954EF0 with `fMoveTime > 0`) and the guide text (`CreateGuideDesc` 32956BD0, `ShowGuideDesc`
 * 3295BA30).  Every expected value is worked out by hand from the decompile and the disassembly:
 *
 *  - the constructor, after the script: `if (fMoveTime > 0) { m_Color = (r, g, b, 0); m_GoalColor = (r, g, b, 1); clear m_queMoveItems; m_fAnimateTime = 0;
 *    m_GoalPos = m_Pos; m_bAutoDelete = false; m_fChangeTime = fMoveTime; }`;
 *  - `CreateGuideDesc`: `new CKTDGUIDialog(m_pStage, L"DLG_GuideDesc.lua", 0.07f, 400)`, its `m_Pos` is this dialog's (its goal too when `m_fChangeTime >
 *    m_fAnimateTime`), `AddDlg`, the static `GuideDesc`, a new string data (font 2, colours (1, 1, 1, 1), position (5, 5), empty), the static hidden;
 *  - `ShowGuideDesc`: width `(int)((float)GetWidth(text) / scale.x) + 12`, height `(int)((float)GetHeight(text) / scale.y)` + 12 + the number of line breaks;
 *    the place is `GetGuideDescPos` (left-top corner, `m_bGuideDescPosLT`) or `m_Pos.x + gx - width / 2`, `gy - boxHeight`, cut to the screen (left edge 0,
 *    right edge `screenWidth - width`, top 4); the static's offset is `(px - m_Pos.x, py + control.m_OffsetPos.y)` and, for an absolute guide position,
 *    `(px + control.m_OffsetPos.x - m_Pos.x, py + control.m_OffsetPos.y - m_Pos.y)`.
 */

/** a font that answers the sizes it is told to and writes down the texts it is asked about */
function fakeFont(width: number, height: number) {
  const asked: string[] = [];
  const font = {
    asked,
    GetWidth: (text: string | null) => (asked.push(`W:${text}`), width),
    GetHeight: (text: string | null) => (asked.push(`H:${text}`), height),
  };
  return font;
}

/**
 * a world whose `DLG_GuideDesc.lua` is a function: it makes the static `GuideDesc` with one picture that has a texture and no point (as the real script
 * does: `SetSize` makes the point), the owner dialog at (100, 50), a button, and the UK font 2.
 */
function scene(opts: { backBuffer?: { width: number; height: number }; font?: [number, number] | null; script?: "static" | "none" | "fails"; headless?: boolean } = {}) {
  const s = opts.headless ? setup() : rig({ backBuffer: opts.backBuffer ?? { width: 1024, height: 768 } });
  const scripts: string[] = [];
  const stage = { MsgProc: () => {} };
  const original = s.w.world.execScript.bind(s.w.world);
  s.w.world.execScript = (name: string): boolean => {
    if (name !== "DLG_GuideDesc.lua") return original(name); // (the sounds of a control are a script, too)
    scripts.push(name);
    if ((opts.script ?? "static") === "none") return true;
    if (opts.script === "fails") return false;
    const dialog = (s.w.world.G.globals.getStr("g_pUIDialog") as LuaUserdata).data as CKTDGUIDialog;
    const control = new CKTDGUIStatic(s.w);
    control.m_Name = "GuideDesc";
    dialog.AddControl(control);
    const picture = new CPictureData(s.w);
    s.m(s.wrap(picture, "CKTDGUIControl::CPictureData"), "SetTex", "P.TGA", "K");
    control.AddPicture(picture);
    return true;
  };
  const sizes: [number, number] = opts.font ? opts.font : opts.font === null ? [0, 0] : [60, 30];
  const font = fakeFont(sizes[0], sizes[1]);
  if (opts.font !== null) s.w.fonts.setUKFont(2, font as unknown as UKFont);
  const owner = new CKTDGUIDialog(s.w, { stage });
  owner.m_Pos.set(100, 50);
  const control = new CKTDGUIButton(s.w);
  control.m_OffsetPos.set(7, 9);
  const guide = () => owner.m_pDialogGuideDesc!;
  const stat = () => owner.m_pStaticGuideDesc!;
  /** the static's offset and the picture's size, as numbers */
  const placed = () => ({
    offset: [stat().m_OffsetPos.x, stat().m_OffsetPos.y],
    size: [stat().GetPicture(0)!.size.x, stat().GetPicture(0)!.size.y],
  });
  return { ...s, owner, control, font, stage, scripts, guide, stat, placed };
}

describe("the fade-in of a dialog (fMoveTime > 0)", () => {
  /** a script that leaves the dialog in a state the fade-in has to overwrite: the colour (0.25, 0.5, 0.75, 0.5), a move under way, two queued moves */
  function fade(moveTime: number | undefined) {
    const s = rig();
    s.w.world.execScript = (name: string) => {
      if (name !== "DLG_X.lua") return false;
      const d = (s.w.world.G.globals.getStr("g_pUIDialog") as LuaUserdata).data as CKTDGUIDialog;
      d.m_Color.set(0.25, 0.5, 0.75, 0.5);
      d.m_Pos.set(30, 40);
      d.m_GoalPos.set(1, 2);
      d.m_GoalColor.set(0, 0, 0, 0);
      d.m_fAnimateTime = 3;
      d.m_fChangeTime = 9;
      d.m_bAutoDelete = true;
      d.m_queMoveItems.push({ pos: d.m_Pos.clone(), color: d.m_Color.clone(), fChangeTime: 1, bIsAutoDelete: false }, { pos: d.m_Pos.clone(), color: d.m_Color.clone(), fChangeTime: 2, bIsAutoDelete: true });
      return true;
    };
    return new CKTDGUIDialog(s.w, { scriptFileName: "DLG_X.lua", ...(moveTime === undefined ? {} : { moveTime }) });
  }

  test("the colour the script left fades from alpha 0 to 1 where the dialog is, in fMoveTime; the queue is empty, nothing is deleted when it is over", () => {
    const d = fade(0.25);
    expect([d.m_Color.r, d.m_Color.g, d.m_Color.b, d.m_Color.a]).toEqual([0.25, 0.5, 0.75, 0]);
    expect([d.m_GoalColor.r, d.m_GoalColor.g, d.m_GoalColor.b, d.m_GoalColor.a]).toEqual([0.25, 0.5, 0.75, 1]);
    expect([d.m_Pos.x, d.m_Pos.y, d.m_GoalPos.x, d.m_GoalPos.y]).toEqual([30, 40, 30, 40]);
    expect([d.m_fAnimateTime, d.m_fChangeTime, d.m_bAutoDelete, d.m_queMoveItems.length, d.m_bFadeInOut]).toEqual([0, 0.25, false, 0, true]);
  });

  test("fMoveTime is a float: 0.07 is the float 0.07; below one float's smallest it is 0 and nothing happens", () => {
    expect(fade(0.07).m_fChangeTime).toBe(f(0.07));
    const none = fade(1e-50);
    expect([none.m_Color.a, none.m_GoalColor.a, none.m_fAnimateTime, none.m_fChangeTime, none.m_bAutoDelete, none.m_queMoveItems.length]).toEqual([0.5, 0, 3, 9, true, 2]);
  });

  test("0, a negative time and no time leave what the script made", () => {
    for (const moveTime of [0, -1, undefined]) {
      const d = fade(moveTime);
      expect([d.m_Color.a, d.m_fChangeTime, d.m_queMoveItems.length]).toEqual([0.5, 9, 2]);
    }
  });

  test("OnFrameMove then brings the alpha up with the time: half of the time, half of the alpha", () => {
    const d = fade(0.25);
    d.onFrameMove(0, 0.125);
    expect(d.m_Color.a).toBe(0.5);
    expect(d.m_fAnimateTime).toBe(0.125);
    d.onFrameMove(0, 0.0625); // k = 1 / (0.25 - 0.125) = 8: alpha 0.5 + (1 - 0.5) * 8 * 0.0625
    expect([d.m_Color.a, d.m_fAnimateTime]).toEqual([0.75, 0.1875]);
  });
});

describe("CKTDGUIDialog::CreateGuideDesc (32956BD0)", () => {
  test("makes the guide dialog from DLG_GuideDesc.lua: layer 400, this dialog's stage and place, fading in, held by the manager", () => {
    const s = scene();
    s.owner.createGuideDesc();
    const g = s.guide();
    expect(s.scripts).toEqual(["DLG_GuideDesc.lua"]);
    expect([g.m_iLayer, g.m_pStage === s.stage, g.m_fChangeTime, g.m_fAnimateTime]).toEqual([400, true, f(0.07), 0]);
    expect([g.m_Pos.x, g.m_Pos.y, g.m_GoalPos.x, g.m_GoalPos.y]).toEqual([100, 50, 100, 50]);
    expect([g.m_Color.a, g.m_GoalColor.a]).toEqual([0, 1]);
    expect(s.w.dialogManager.checkDlg(g)).toBe(true);
    expect(g.m_pkUIDialogManager).toBe(s.w.dialogManager);
    expect(s.owner.m_pStaticGuideDesc === g.GetStatic("GuideDesc")).toBe(true);
  });

  test("the static gets the one string it shows: UK font 2, white with a white outline, at (5, 5), empty; and is hidden", () => {
    const s = scene();
    s.owner.createGuideDesc();
    const list = s.stat().m_StringDataList;
    expect(list.length).toBe(1);
    const d = list[0]!;
    expect([d.fontIndex, d.stringTableID, d.msg, d.pos.x, d.pos.y]).toEqual([2, -1, "", 5, 5]);
    expect([d.color.r, d.color.g, d.color.b, d.color.a, d.outlineColor.r, d.outlineColor.g, d.outlineColor.b, d.outlineColor.a]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect([d.sortFlag, d.fontStyle, d.bUseUkFont, d.bSpread, d.fSpreadTimeGap, d.iSpreadCount, d.fNowSpreadTime]).toEqual([0, 0, true, false, 0, 0, 0]);
    expect(s.stat().m_bShow).toBe(false);
  });

  test("a second call does nothing: the dialog, the static and the strings stay", () => {
    const s = scene();
    s.owner.createGuideDesc();
    const [g, st] = [s.guide(), s.stat()];
    s.owner.m_Pos.set(1, 2);
    s.owner.createGuideDesc();
    expect([s.guide() === g, s.stat() === st, st.m_StringDataList.length, s.scripts.length, g.m_Pos.x]).toEqual([true, true, 1, 1, 100]);
  });

  test("the dialog is where this dialog is, but its goal only while it is fading in: not when 0.07 s is over", () => {
    const s = scene();
    s.owner.m_Pos.set(33.5, 44.25);
    s.owner.createGuideDesc();
    expect([s.guide().m_GoalPos.x, s.guide().m_GoalPos.y]).toEqual([33.5, 44.25]);
  });

  test("a script that makes no GuideDesc leaves the exe with a null static: an Error, after the dialog was made and handed to the manager", () => {
    const s = scene({ script: "none" });
    expect(() => s.owner.createGuideDesc()).toThrow("DLG_GuideDesc.lua made no static");
    expect(s.owner.m_pDialogGuideDesc).not.toBeNull();
    expect(s.owner.m_pStaticGuideDesc).toBeNull();
    expect(s.w.dialogManager.checkDlg(s.owner.m_pDialogGuideDesc)).toBe(true);
    // the dialog is there, so a second call makes nothing (it does not ask for the static): the next ShowGuideDesc finds the static null
    const made = s.owner.m_pDialogGuideDesc;
    s.owner.createGuideDesc();
    expect([s.owner.m_pDialogGuideDesc === made, s.scripts.length]).toEqual([true, 1]);
    s.control.m_GuideDesc = "x";
    expect(() => s.owner.showGuideDesc(s.control)).toThrow("has no static");
  });

  test("a script that cannot be opened is the error log of any dialog (0x48) and then the same Error", () => {
    const s = scene({ script: "fails" });
    expect(() => s.owner.createGuideDesc()).toThrow("made no static");
    expect(s.w.devices.massFiles.log.entries.some((e) => e.id === 0x48 && e.text === "DLG_GuideDesc.lua")).toBe(true);
  });
});

describe("CKTDGUIDialog::ShowGuideDesc (3295BA30)", () => {
  test("above the control's guide position, centred: two lines, scale 1; every size and place is cut to whole pixels", () => {
    const s = scene();
    s.control.m_GuideDesc = "Hello\nWorld!";
    s.control.m_vGuideDescOffsetPos.set(200.75, 300.75);
    s.owner.showGuideDesc(s.control);
    // width 60 + 12 = 72, height 30 + 12 + 1 break = 43; x = (100 + 200.75) - 72 / 2 = 264.75, y = 300.75 - 43 = 257.75: px = 264, py = 257
    expect(s.placed()).toEqual({ offset: [264 - 100, 257 + 9], size: [72, 43] });
    expect(s.font.asked).toEqual(["W:Hello\nWorld!", "H:Hello\nWorld!"]);
    expect(s.stat().GetString(0)!.msg).toBe("Hello\nWorld!");
    expect(s.stat().m_bShow).toBe(true);
    expect(s.guide().m_bShow).toBe(true);
    const p = s.stat().GetPicture(0)!.pPoint!;
    expect([p.color.r, p.color.g, p.color.b, p.color.a]).toEqual([0, 0, 0, f(0.7)]);
    expect([f(p.rightTopPoint.x - p.leftTopPoint.x), f(p.rightBottomPoint.y - p.leftTopPoint.y)]).toEqual([72, 43]);
  });

  test("with its left-top corner at the guide position when the control says so", () => {
    const s = scene();
    s.control.m_GuideDesc = "Hello\nWorld!";
    s.control.m_vGuideDescOffsetPos.set(200.75, 300.75);
    s.control.m_bGuideDescPosLT = true;
    s.owner.showGuideDesc(s.control);
    expect(s.placed()).toEqual({ offset: [200 - 100, 300 + 9], size: [72, 43] });
  });

  test("the position is the control's own (a slot's differs): GetGuideDescPos is asked twice, the x and then the y", () => {
    const s = scene();
    s.control.m_GuideDesc = "x";
    let asks = 0;
    s.control.getGuideDescPos = () => ((asks++ % 2 === 0) ? ({ x: 200, y: 999 } as never) : ({ x: 999, y: 300 } as never));
    s.owner.showGuideDesc(s.control);
    // the first answer's x and the second answer's y: (100 + 200) - 36 = 264 (width 60 + 12), 300 - (30 + 12) = 258
    expect(asks).toBe(2);
    expect(s.placed()).toEqual({ offset: [264 - 100, 258 + 9], size: [72, 42] });
    asks = 0;
    s.control.m_bGuideDescPosLT = true;
    s.owner.showGuideDesc(s.control);
    expect(asks).toBe(2);
    expect(s.placed().offset).toEqual([200 - 100, 300 + 9]);
  });

  test("an absolute guide position adds the control's offset to the width too and takes the dialog's height off; the others only add it to the height", () => {
    const s = scene();
    s.control.m_GuideDesc = "Hello\nWorld!";
    s.control.m_vGuideDescOffsetPos.set(195.75, 294.75);
    s.control.m_vGuideDescAbsolutePos.set(5, 6); // not (0, 0): absolute; the position is the sum, (200.75, 300.75) as before
    expect(s.control.getIsGuideDescAbsolutePos()).toBe(true);
    s.owner.showGuideDesc(s.control);
    // px = 264, py = 257: x = (264 + 7) - 100, y = (257 + 9) - 50
    expect(s.placed().offset).toEqual([264 + 7 - 100, 257 + 9 - 50]);
    s.control.m_vGuideDescAbsolutePos.set(0, 0);
    s.control.m_vGuideDescOffsetPos.set(200.75, 300.75);
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset).toEqual([264 - 100, 257 + 9]);
  });

  test("inside the screen: the left edge is 0, the top 4 pixels, the right edge is the width of the screen less the box", () => {
    const s = scene();
    s.control.m_GuideDesc = "Hello\nWorld!";
    s.control.m_vGuideDescOffsetPos.set(-500, -20);
    s.owner.showGuideDesc(s.control); // x = (100 - 500) - 36 < 0, y = -20 - 43 < 0
    expect(s.placed().offset).toEqual([0 - 100, 4 + 9]);
    s.control.m_vGuideDescOffsetPos.set(950, 300); // x = 1050 - 36 = 1014: 72 + 1014 is past 1024
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset).toEqual([1024 - 72 - 100, 300 - 43 + 9]);
    s.control.m_vGuideDescOffsetPos.set(896, 300); // x = 960: the width (72) is past the screen, the height (43) alone would not be
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset[0]).toBe(952 - 100);
    s.control.m_vGuideDescOffsetPos.set(887.5, 300); // x = 951.5: 72 + 951.5 < 1024, cut to 951
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset[0]).toBe(951 - 100);
    s.control.m_vGuideDescOffsetPos.set(0, 0); // y = -43: the top is 4, not 0
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset[1]).toBe(4 + 9);
    s.control.m_vGuideDescOffsetPos.set(300, 43); // y = 0 exactly is not above the screen
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset[1]).toBe(0 + 9);
  });

  test("a box wider than the screen: from x = 0 on its left edge is the screen's width less its own (negative); below 0 it is 0", () => {
    const s = scene({ font: [2000, 30] }); // 2012 wide
    s.control.m_GuideDesc = "wide";
    for (const [gx, px] of [[906, -988], [906.5, -988], [905.5, 0], [905, 0]] as const) { // x = (100 + gx) - 1006
      s.control.m_vGuideDescOffsetPos.set(gx, 300);
      s.owner.showGuideDesc(s.control);
      expect(s.placed().offset[0]).toBe(px - 100);
    }
  });

  test("the left-top corner is cut the same way: its right edge may not pass the screen either", () => {
    const s = scene();
    s.control.m_GuideDesc = "Hello\nWorld!";
    s.control.m_bGuideDescPosLT = true;
    s.control.m_vGuideDescOffsetPos.set(1000, 700);
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset).toEqual([952 - 100, 700 + 9]);
    s.control.m_vGuideDescOffsetPos.set(-3, -3);
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset).toEqual([0 - 100, 4 + 9]);
  });

  test("a place that is not a number goes to the left edge and 4 pixels from the top (a comparison with NaN is below)", () => {
    const s = scene();
    s.control.m_GuideDesc = "Hello";
    s.control.m_vGuideDescOffsetPos.set(NaN, NaN);
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset).toEqual([0 - 100, 4 + 9]);
    s.control.m_bGuideDescPosLT = true;
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset).toEqual([0 - 100, 4 + 9]);
  });

  test("the sizes are in layout pixels: the font's size over the scale of the window, cut; the screen is the back buffer over it", () => {
    // 1536 x 576: the scale is (1.5, 0.75) and the screen 1536 / 1.5 = 1024 wide
    const s = scene({ backBuffer: { width: 1536, height: 576 }, font: [61, 32] });
    s.control.m_GuideDesc = "Hello\nWorld!";
    s.control.m_vGuideDescOffsetPos.set(200, 300);
    s.owner.showGuideDesc(s.control);
    // width (int)(61 / 1.5 = 40.67) + 12 = 52, height (int)(32 / 0.75 = 42.67) = 42, + 12 + 1 = 55; x = 300 - 26 = 274, y = 300 - 55 = 245
    expect(s.placed()).toEqual({ offset: [274 - 100, 245 + 9], size: [52, 55] });
    s.control.m_vGuideDescOffsetPos.set(950, 300); // x = 1050 - 26 = 1024: 52 + 1024 is past the screen of 1024 (not of 1536)
    s.owner.showGuideDesc(s.control);
    expect(s.placed().offset[0]).toBe(1024 - 52 - 100);
  });

  test("a world with no device lays the box out on the 1024 x 768 the layout is made for", () => {
    const s = scene({ headless: true });
    expect(s.w.render).toBeNull();
    s.control.m_GuideDesc = "Hello\nWorld!";
    s.control.m_vGuideDescOffsetPos.set(950, 300); // x = 1050 - 36 = 1014: past 1024
    s.owner.showGuideDesc(s.control);
    expect(s.placed()).toEqual({ offset: [1024 - 72 - 100, 300 - 43 + 9], size: [72, 43] });
  });

  test("the size of the back buffer is the render's (1024 x 768 until it is told) and comes with the scale", () => {
    const r = new UIRender(new Recorder() as never);
    expect([r.backBuffer.width, r.backBuffer.height]).toEqual([1024, 768]);
    r.setBackBufferSize(1280, 720);
    expect([r.backBuffer.width, r.backBuffer.height, r.resolutionScale.x, r.resolutionScale.y]).toEqual([1280, 720, 1.25, f(720 / 768)]);
  });

  test("the box is as wide as the font says plus 12; the line breaks add a pixel each: counted in the whole text, the font asked about the text up to a NUL", () => {
    const s = scene({ font: [10, 20] });
    s.control.m_GuideDesc = "a\0b\nc\nd";
    s.control.m_vGuideDescOffsetPos.set(500, 500);
    s.owner.showGuideDesc(s.control);
    expect(s.font.asked).toEqual(["W:a", "H:a"]);
    expect(s.placed().size).toEqual([22, 20 + 12 + 2]);
    expect(s.stat().GetString(0)!.msg).toBe("a");
    s.control.m_GuideDesc = "";
    s.owner.showGuideDesc(s.control);
    expect(s.placed().size).toEqual([22, 32]);
    expect(s.stat().GetString(0)!.msg).toBe("");
  });

  test("a text of nothing but line breaks counts each of them", () => {
    const s = scene({ font: [0, 0] });
    s.control.m_GuideDesc = "\n\n\n";
    s.owner.showGuideDesc(s.control);
    expect(s.placed().size).toEqual([12, 12 + 3]);
  });

  test("the dialog is moved to this one while it fades in; its goal only until the fade is over", () => {
    const s = scene();
    s.control.m_GuideDesc = "x";
    s.owner.showGuideDesc(s.control);
    s.owner.m_Pos.set(110, 60);
    s.owner.showGuideDesc(s.control); // still fading in (0.07 > 0): the goal goes too
    expect([s.guide().m_Pos.x, s.guide().m_Pos.y, s.guide().m_GoalPos.x, s.guide().m_GoalPos.y]).toEqual([110, 60, 110, 60]);
    s.guide().m_bShow = false; // what the owner's OnFrameMove does to them every frame
    s.stat().m_bShow = false;
    s.owner.showGuideDesc(s.control);
    expect([s.guide().m_bShow, s.stat().m_bShow]).toEqual([true, true]);
    s.guide().m_fAnimateTime = s.guide().m_fChangeTime; // over
    s.owner.m_Pos.set(120, 70);
    s.owner.showGuideDesc(s.control);
    expect([s.guide().m_Pos.x, s.guide().m_Pos.y, s.guide().m_GoalPos.x, s.guide().m_GoalPos.y]).toEqual([120, 70, 110, 60]);
    expect(s.scripts.length).toBe(1);
    expect(s.stat().m_StringDataList.length).toBe(1);
  });

  test("the exe asks THIS dialog to bring the guide's static to the front, and it is not in its list: the order of the controls is unchanged", () => {
    const s = scene();
    const a = new CKTDGUIStatic(s.w);
    a.m_Name = "A";
    const b = new CKTDGUIStatic(s.w);
    b.m_Name = "B";
    s.owner.AddControl(a);
    s.owner.AddControl(b);
    s.control.m_GuideDesc = "x";
    s.owner.showGuideDesc(s.control);
    expect(s.owner.m_ControlsList.map((c) => c.m_Name)).toEqual(["A", "B"]);
    expect(s.guide().m_ControlsList.map((c) => c.m_Name)).toEqual(["GuideDesc"]);
    s.owner.m_ControlsList.unshift(s.stat()); // were it in the list, the call would bring it to the end (drawn last)
    s.owner.showGuideDesc(s.control);
    expect(s.owner.m_ControlsList.map((c) => c.m_Name)).toEqual(["A", "B", "GuideDesc"]);
  });

  test("a control asks its dialog for the guide text only when it has one", () => {
    const s = scene();
    s.owner.AddControl(s.control);
    expect(s.control.m_pDialog).not.toBeNull();
    s.control.showGuideDesc();
    expect(s.owner.m_pDialogGuideDesc).toBeNull();
    s.control.m_GuideDesc = "text";
    s.control.showGuideDesc();
    expect(s.owner.m_pDialogGuideDesc).not.toBeNull();
    expect(s.stat().GetString(0)!.msg).toBe("text");
  });

  test("without a UK font 2 the exe measures with a null pointer: an Error, and the empty entry of the font map is the exe's too", () => {
    const s = scene({ font: null });
    s.control.m_GuideDesc = "x";
    expect(s.w.fonts.m_mapUKFontList.has(2)).toBe(false);
    expect(() => s.owner.showGuideDesc(s.control)).toThrow("UK font 2 does not exist");
    expect(s.w.fonts.m_mapUKFontList.has(2)).toBe(true);
    expect(s.w.fonts.m_mapUKFontList.get(2)).toBeNull();
  });

  test("a static without a picture, a picture without a texture or a static that already has a string: what the exe does with them", () => {
    // no picture: GetPicture(0) is null and the exe writes through it
    const none = scene();
    none.owner.createGuideDesc();
    none.stat().m_PictureDataList.length = 0;
    none.control.m_GuideDesc = "x";
    expect(() => none.owner.showGuideDesc(none.control)).toThrow("no picture");
    // a picture with neither point nor texture: SetSize logs 0x159 and leaves it without a point, and the exe writes through that null point
    const bare = scene();
    bare.owner.createGuideDesc();
    bare.stat().m_PictureDataList[0] = new CPictureData(bare.w);
    bare.control.m_GuideDesc = "x";
    expect(() => bare.owner.showGuideDesc(bare.control)).toThrow("no point");
    expect(bare.w.devices.massFiles.log.entries.some((e) => e.id === 0x159)).toBe(true);
    // the string the exe made was taken away
    const gone = scene();
    gone.owner.createGuideDesc();
    gone.stat().m_StringDataList.length = 0;
    gone.control.m_GuideDesc = "x";
    expect(() => gone.owner.showGuideDesc(gone.control)).toThrow("no string");
    // a string of the script's own comes first: it is the one that gets the text
    const own = scene();
    own.owner.createGuideDesc();
    const theirs = new UIStringData();
    theirs.msg = "script's own";
    own.stat().m_StringDataList.unshift(theirs);
    own.control.m_GuideDesc = "guide";
    own.owner.showGuideDesc(own.control);
    expect(own.stat().m_StringDataList.map((d) => d.msg)).toEqual(["guide", ""]);
  });
});
