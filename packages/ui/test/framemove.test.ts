/**
 * `OnFrameMove`, the update half of a frame: the base control (`Animate`, `ChangePoint`, `UpdateTexChangeData`), the animations of a picture
 * (`CPictureData::OnFrameMove`), the strings a static spreads, and the state machine of every control class.  Every expected number is worked out
 * by hand from the decompile of x2.exe (the address is in the name of the test, the arithmetic in a comment); values are powers of two where the
 * exe's single precision would make a hand calculation a guess, and a few are not, to pin that every step rounds to a float.
 */
import { describe, expect, test } from "bun:test";
import { Color, Vec2 } from "@els/host";
import { StringTable } from "@els/assets";
import {
  BCS, CBCS, CKTDGUIButton, CKTDGUICheckBox, CKTDGUIComboBox, CKTDGUIContolList, CKTDGUIDialog, CKTDGUIDialogManager, CKTDGUIEditBox, CKTDGUIIMEEditBox,
  CKTDGFreeTypeFont, CKTDGUIListBox, CKTDGUINavigation, CKTDGUIRadioButton, CKTDGUIScrollBar, CKTDGUISlider, CKTDGUISlot, CKTDGUIStatic, CMovieData, CPictureData, DeviceSound,
  RBCS, SCS, STAGE_STATE, TA, TexChangeData, UIInputManager, UIKeyboard, UIM, UIPointData, UIStringData, UKFont, newRect, setTexureData, setRect,
} from "../src/index.ts";
import type { CKTDGUIControl, ListBoxItem } from "../src/index.ts";
import { wstringFind } from "../src/static.ts";
import { rig } from "./rig.ts";
import { fontWorld } from "./fontworld.ts";
import { setup } from "./harness.ts";

/** what a dialog is asked to show a guide text for (`ShowGuideDesc` itself is the subject of guide.test.ts): the controls, in order */
function askedFor(d: CKTDGUIDialog): CKTDGUIControl[] {
  const asked: CKTDGUIControl[] = [];
  d.showGuideDesc = (control: CKTDGUIControl): void => void asked.push(control);
  return asked;
}

const f = Math.fround;
const corners = (p: UIPointData) => [
  p.leftTopPoint.x, p.leftTopPoint.y, p.rightTopPoint.x, p.rightTopPoint.y, p.leftBottomPoint.x, p.leftBottomPoint.y, p.rightBottomPoint.x, p.rightBottomPoint.y,
];
const setCorners = (p: UIPointData, c: number[]) => {
  p.leftTopPoint.set(c[0]!, c[1]!);
  p.rightTopPoint.set(c[2]!, c[3]!);
  p.leftBottomPoint.set(c[4]!, c[5]!);
  p.rightBottomPoint.set(c[6]!, c[7]!);
};
const rgba = (c: { r: number; g: number; b: number; a: number }) => [c.r, c.g, c.b, c.a];
// A failing comparison of controls would print the whole world: they are compared by identity.
const is = (a: unknown, b: unknown): boolean => a === b;
const names = (list: readonly { m_Name: string }[]): string[] => list.map((c) => c.m_Name);

/** a control the frame moves: a navigation is the base control's `OnFrameMove` and nothing else */
const mover = () => {
  const s = setup();
  const c = new CKTDGUINavigation(s.w);
  return { ...s, c };
};

describe("CKTDGUIControl::OnFrameMove (32924DB0) and Animate (32923EB0)", () => {
  test("a hidden control does not move; a shown one keeps the frame's time as a float and counts the move's time", () => {
    const { c } = mover();
    c.m_fChangeTime = 2;
    c.m_GoalPos.set(10, -4);
    c.m_bShow = false;
    expect(c.onFrameMove(0, 0.1)).toBe(0);
    expect([c.m_fElapsedTime, c.m_fAnimateTime, c.m_OffsetPos.x]).toEqual([0, 0, 0]);
    c.m_bShow = true;
    expect(c.onFrameMove(0, 0.1)).toBe(0);
    expect(c.m_fElapsedTime).toBe(f(0.1));
    expect(c.m_fAnimateTime).toBe(f(f(0.1) + 0));
  });

  test("offset and colour approach the goal by (goal - now) / (changeTime - animateTime) * elapsed: change time 2, three frames of 1 s", () => {
    const { c } = mover();
    c.m_fChangeTime = 2;
    c.m_GoalPos.set(10, -4);
    c.m_Color.set(1, 1, 1, 1);
    c.m_GoalColor.set(0, 0.5, 1, 0.25);
    // frame 1: k = 1 / (2 - 0) = 0.5: x = 0 + (10 - 0) * 0.5 * 1 = 5, y = 0 + (-4) * 0.5 = -2; r = 1 + (0 - 1) * 0.5 = 0.5, g = 1 + (0.5 - 1) * 0.5 = 0.75,
    // b = 1, a = 1 + (0.25 - 1) * 0.5 = 0.625; the animate time is 0 + 1
    c.onFrameMove(0, 1);
    expect([c.m_OffsetPos.x, c.m_OffsetPos.y, ...rgba(c.m_Color), c.m_fAnimateTime]).toEqual([5, -2, 0.5, 0.75, 1, 0.625, 1]);
    // frame 2: k = 1 / (2 - 1) = 1: x = 5 + (10 - 5) = 10, y = -2 + (-4 + 2) = -4, r = 0.5 - 0.5 = 0, g = 0.75 - 0.25 = 0.5, a = 0.625 - 0.375 = 0.25; animate time 2
    c.onFrameMove(0, 1);
    expect([c.m_OffsetPos.x, c.m_OffsetPos.y, ...rgba(c.m_Color), c.m_fAnimateTime]).toEqual([10, -4, 0, 0.5, 1, 0.25, 2]);
    // frame 3: the animate time (2) is not below the change time (2): the move is over, the animate and change times are 0, the offset is the goal
    c.onFrameMove(0, 1);
    expect([c.m_OffsetPos.x, c.m_OffsetPos.y, c.m_fAnimateTime, c.m_fChangeTime, c.m_bCheckAutoDeleteEnd]).toEqual([10, -4, 0, 0, false]);
    // and a control with no move does nothing any more
    c.m_GoalPos.set(99, 99);
    c.onFrameMove(0, 1);
    expect([c.m_OffsetPos.x, c.m_OffsetPos.y]).toEqual([10, -4]);
  });

  test("steps of 0.75 s overshoot (k = 1 / 0.5 = 2 on the last step), and the jump at the end sets the offset to the goal and leaves the colour", () => {
    const { c } = mover();
    c.m_fChangeTime = 2;
    c.m_GoalPos.set(10, 0);
    c.m_Color.set(1, 1, 1, 1);
    c.m_GoalColor.set(0, 1, 1, 1);
    // frame 1: k = 0.5: x = 0 + 10 * 0.5 * 0.75 = 3.75, r = 1 + (0 - 1) * 0.5 * 0.75 = 0.625; animate time 0.75
    c.onFrameMove(0, 0.75);
    expect([c.m_OffsetPos.x, c.m_Color.r, c.m_fAnimateTime]).toEqual([3.75, 0.625, 0.75]);
    // frame 2: k = (float)(1 / 1.25) = 0.800000011920929: x = 3.75 + (float)((float)(6.25 * k) * 0.75): 6.25 * k = 5.0000000745 is 5 as a float, * 0.75 = 3.75, so 7.5;
    // r = 0.625 + (float)((float)((0 - 0.625) * k) * 0.75): -0.5000000075 is -0.5 as a float, * 0.75 = -0.375, so 0.25; animate time 1.5
    c.onFrameMove(0, 0.75);
    expect([c.m_OffsetPos.x, c.m_Color.r, c.m_fAnimateTime]).toEqual([7.5, 0.25, 1.5]);
    // frame 3: k = 1 / 0.5 = 2: x = 7.5 + (10 - 7.5) * 2 * 0.75 = 11.25 (past the goal), r = 0.25 + (0 - 0.25) * 2 * 0.75 = -0.125; animate time 2.25
    c.onFrameMove(0, 0.75);
    expect([c.m_OffsetPos.x, c.m_Color.r, c.m_fAnimateTime]).toEqual([11.25, -0.125, 2.25]);
    // frame 4: 2.25 is not below 2: the offset is the goal; the colour stays where the overshoot left it
    c.onFrameMove(0, 0.75);
    expect([c.m_OffsetPos.x, c.m_Color.r, c.m_fAnimateTime, c.m_fChangeTime]).toEqual([10, -0.125, 0, 0]);
  });

  test("the move queue: the next item becomes the goal in the frame that ends the move, and an auto-delete move marks the control when it ends", () => {
    const { c } = mover();
    c.m_fChangeTime = 1;
    c.m_GoalPos.set(2, 2);
    c.m_queMoveItems.push({ pos: new Vec2(6, 8), color: new Color(0.5, 0.25, 0.125, 0.0625), fChangeTime: 4, bIsAutoDelete: true });
    // frame 1: k = 1: the offset reaches (2, 2); the move has not ended, so the queue is not touched
    c.onFrameMove(0, 1);
    expect([c.m_OffsetPos.x, c.m_OffsetPos.y, c.m_queMoveItems.length, c.m_fChangeTime]).toEqual([2, 2, 1, 1]);
    // frame 2: the move ends (the old move was not an auto-delete one: nothing is marked) and the item is taken in the same call
    c.onFrameMove(0, 1);
    expect([c.m_GoalPos.x, c.m_GoalPos.y, ...rgba(c.m_GoalColor), c.m_fChangeTime, c.m_bAutoDelete, c.m_queMoveItems.length, c.m_bCheckAutoDeleteEnd, c.m_fAnimateTime])
      .toEqual([6, 8, 0.5, 0.25, 0.125, 0.0625, 4, true, 0, false, 0]);
    // frame 3: k = 1 / (4 - 0) = 0.25: x = 2 + (6 - 2) * 0.25 = 3, y = 2 + (8 - 2) * 0.25 = 3.5
    c.onFrameMove(0, 1);
    expect([c.m_OffsetPos.x, c.m_OffsetPos.y, c.m_fAnimateTime]).toEqual([3, 3.5, 1]);
    // the end of a move that is an auto-delete one marks the control
    c.m_fAnimateTime = 4;
    c.onFrameMove(0, 1);
    expect([c.m_OffsetPos.x, c.m_OffsetPos.y, c.m_fChangeTime, c.m_bCheckAutoDeleteEnd]).toEqual([6, 8, 0, true]);
  });
});

describe("CKTDGUIControl::ChangePoint (329240D0), through a check box", () => {
  /**
   * a check box whose current point is at (0, 0) .. (8, 16), white, with the change time 0.5, and whose end point goes to (4, 8) .. (16, 24), blue,
   * half transparent, with the change time 2.5: 2 s to go
   */
  function box() {
    const s = setup();
    const c = new CKTDGUICheckBox(s.w);
    c.m_pBGPoint = new UIPointData();
    setCorners(c.m_NowPoint, [0, 0, 8, 0, 0, 16, 8, 16]);
    setCorners(c.m_EndPoint, [4, 8, 16, 8, 4, 24, 16, 24]);
    c.m_EndPoint.color.set(0, 0, 1, 0.5);
    c.m_NowPoint.fChangeTime = 0.5;
    c.m_EndPoint.fChangeTime = 2.5;
    const texture = setTexureData(s.w, "E.TGA", "K")!;
    c.m_EndPoint.pUITextureData = texture;
    return { ...s, c, texture };
  }

  test("a frame shorter than what is left moves every corner and colour channel the share (elapsed / left) of the way and counts up", () => {
    const { c } = box();
    // k = 1 / (2.5 - 0.5) = 0.5, elapsed 1: corners 0 + (4 - 0) * 0.5 = 2, 0 + 8 * 0.5 = 4, 8 + (16 - 8) * 0.5 = 12, 16 + 8 * 0.5 = 20 ...; r = 1 + (0 - 1) * 0.5 = 0.5, a = 1 + (0.5 - 1) * 0.5 = 0.75
    c.onFrameMove(0, 1);
    expect(corners(c.m_NowPoint)).toEqual([2, 4, 12, 4, 2, 20, 12, 20]);
    expect(rgba(c.m_NowPoint.color)).toEqual([0.5, 0.5, 1, 0.75]);
    expect(c.m_NowPoint.fChangeTime).toBe(1.5); // 0.5 + 1
  });

  test("a frame that is not shorter than what is left makes the current point the end point (the texture and the change time too); equal change times do nothing", () => {
    const { c, texture } = box();
    c.onFrameMove(0, 1);
    // left = 2.5 - 1.5 = 1; 1 < 1 is false: *now = *end
    c.onFrameMove(0, 1);
    expect(corners(c.m_NowPoint)).toEqual([4, 8, 16, 8, 4, 24, 16, 24]);
    expect(rgba(c.m_NowPoint.color)).toEqual([0, 0, 1, 0.5]);
    expect([c.m_NowPoint.fChangeTime, is(c.m_NowPoint.pUITextureData, texture)]).toEqual([2.5, true]);
    setCorners(c.m_NowPoint, [1, 1, 1, 1, 1, 1, 1, 1]); // the change times agree now: the frame leaves the current point alone
    c.onFrameMove(0, 1);
    expect(corners(c.m_NowPoint)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    c.changePoint(c.m_NowPoint, c.m_EndPoint); // ... and so does ChangePoint itself: it starts with the test of the change times
    expect(corners(c.m_NowPoint)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  test("every step rounds to a float: a corner at 1 moving to 2 in 3 s takes (float)((float)((2 - 1) * (float)(1 / 3)) * 0.1) more", () => {
    const { c } = box();
    setCorners(c.m_NowPoint, [1, 0, 0, 0, 0, 0, 0, 0]);
    setCorners(c.m_EndPoint, [2, 0, 0, 0, 0, 0, 0, 0]);
    c.m_NowPoint.fChangeTime = 1;
    c.m_EndPoint.fChangeTime = 4;
    c.onFrameMove(0, 0.1);
    const k = f(1 / 3), dt = f(0.1);
    expect(c.m_NowPoint.leftTopPoint.x).toBe(f(f(f(f(2 - 1) * k) * dt) + 1));
    expect(c.m_NowPoint.fChangeTime).toBe(f(dt + 1));
    expect(c.m_NowPoint.leftTopPoint.x).not.toBe(1);
  });
});

describe("CKTDGUIControl::UpdateTexChangeData (32927DE0), through the texture animation of a button", () => {
  /** a button in the normal state whose normal-state animation has one step: 5 s, rotation 8, position (4, 12), scale (5, 3), scale rotation 16 */
  function animated() {
    const s = setup();
    const b = new CKTDGUIButton(s.w);
    s.m(s.wrap(b, "CKTDGUIButton"), "SetNormalTex", "B.TGA", "N");
    s.m(s.wrap(b, "CKTDGUIButton"), "SetNormalPoint", s.point(10, 20));
    const step = new TexChangeData();
    step.m_fShowTime = 5;
    step.m_fRotateDegree = 8;
    step.m_Pos.set(4, 12);
    step.m_Scale.set(5, 3);
    step.m_fScaleRotationDegree = 16;
    b.m_mapMouseNormalTex.set(0, step);
    return { ...s, b, step };
  }
  const now = (b: CKTDGUIButton) => {
    const n = b.m_NowTexChangeData;
    return [n.m_fShowTime, n.m_fRotateDegree, n.m_Pos.x, n.m_Pos.y, n.m_Scale.x, n.m_Scale.y, n.m_fScaleRotationDegree];
  };

  test("a frame moves rotation, position, scale and scale rotation by (goal - now) / (showTime - elapsed show time) * elapsed", () => {
    const { b } = animated();
    // show time 0 + 1 = 1, left = 5 - 1 = 4: rotation 0 + (8 - 0) / 4 * 1 = 2, x = 0 + (4 - 0) * 0.25 * 1 = 1, y = 12 * 0.25 = 3,
    // scale x = 3 + (5 - 3) * 0.25 = 3.5, y = 1 + (3 - 1) * 0.25 = 1.5, scale rotation 0 + 16 / 4 * 1 = 4
    b.m_NowTexChangeData.m_Scale.set(3, 1);
    b.onFrameMove(0, 1);
    expect(now(b)).toEqual([1, 2, 1, 3, 3.5, 1.5, 4]);
    expect(b.m_NowTexChangeData.m_SequenceID).toBe(0);
  });

  test("a step that has been shown for its time ends: the values are the step's, the sequence goes on (or to m_SequenceIDToGo), the animation ends on the last step", () => {
    const { b, step } = animated();
    b.m_NowTexChangeData.m_fShowTime = 4.5;
    // 4.5 + 1 = 5.5 >= 5
    b.onFrameMove(0, 1);
    expect(now(b)).toEqual([0, 8, 4, 12, 5, 3, 16]);
    expect([b.m_NowTexChangeData.m_SequenceID, b.m_NowTexChangeData.m_bEndTexChange]).toEqual([1, false]);
    // with a sequence id to go to
    b.m_NowTexChangeData.m_SequenceID = 0;
    b.m_NowTexChangeData.m_SequenceIDToGo = 7;
    b.m_NowTexChangeData.m_fShowTime = 4.5;
    b.onFrameMove(0, 1);
    expect(b.m_NowTexChangeData.m_SequenceID).toBe(7);
    // the last step ends the animation and the sequence id stays; the button no longer runs the step
    b.m_NowTexChangeData.m_SequenceID = 0;
    step.m_bEndTexChange = true;
    b.m_NowTexChangeData.m_fShowTime = 4.5;
    b.onFrameMove(0, 1);
    expect([b.m_NowTexChangeData.m_SequenceID, b.m_NowTexChangeData.m_bEndTexChange]).toEqual([0, true]);
    b.m_NowTexChangeData.m_fShowTime = 0.5;
    b.onFrameMove(0, 1);
    expect(b.m_NowTexChangeData.m_fShowTime).toBe(0.5);
  });

  test("a frame that lands exactly on the step's show time ends the step (>=): without a time left the values are the step's", () => {
    const { b } = animated();
    b.m_NowTexChangeData.m_fShowTime = 4;
    b.onFrameMove(0, 1); // 4 + 1 = 5 >= 5
    expect(now(b)).toEqual([0, 8, 4, 12, 5, 3, 16]);
    expect(b.m_NowTexChangeData.m_SequenceID).toBe(1);
  });

  test("the axes are taken from a step that has one; a sequence id the map does not have goes back to 0 and leaves the rest", () => {
    const { b, step } = animated();
    step.m_RotateAxis = TA.CENTER_CENTER;
    step.m_ScaleAxis = TA.TOP_LEFT;
    b.onFrameMove(0, 1);
    expect([b.m_NowTexChangeData.m_RotateAxis, b.m_NowTexChangeData.m_ScaleAxis]).toEqual([TA.CENTER_CENTER, TA.TOP_LEFT]);
    step.m_RotateAxis = TA.NONE; // NONE does not overwrite
    step.m_ScaleAxis = TA.NONE;
    b.m_NowTexChangeData.m_RotateAxis = TA.BOTTOM_RIGHT;
    b.m_NowTexChangeData.m_ScaleAxis = TA.WORLD;
    b.onFrameMove(0, 1);
    expect([b.m_NowTexChangeData.m_RotateAxis, b.m_NowTexChangeData.m_ScaleAxis]).toEqual([TA.BOTTOM_RIGHT, TA.WORLD]);
    b.m_NowTexChangeData.m_SequenceID = 3;
    const before = now(b);
    b.onFrameMove(0, 1);
    expect(b.m_NowTexChangeData.m_SequenceID).toBe(0);
    expect(now(b)).toEqual(before);
  });

  test("a step with another texture gives the state's point that texture (sized from it) and enters the state again", () => {
    const { b, step, w } = animated();
    const other = setTexureData(w, "O.TGA", "K")!; // the harness texture is 64 x 32 with the UV rectangle of the whole image
    step.m_pTexData = other;
    b.m_NowPoint.leftTopPoint.set(99, 99);
    b.onFrameMove(0, 1);
    const point = b.m_pNormalPoint!;
    expect(is(point.pUITextureData, other)).toBe(true);
    // the point is at (10, 20): sized from the texture: right = 10 + 64, bottom = 20 + 32; ChangeState(NORMAL, true) makes it the current point
    expect([point.rightTopPoint.x, point.leftBottomPoint.y, point.rightBottomPoint.x, point.rightBottomPoint.y]).toEqual([74, 52, 74, 52]);
    expect(corners(b.m_NowPoint)).toEqual(corners(point));
    expect(is(b.m_NowPoint.pUITextureData, other)).toBe(true);
    // the same texture again: the state is not entered again
    b.m_NowPoint.leftTopPoint.set(99, 99);
    b.onFrameMove(0, 1);
    expect(b.m_NowPoint.leftTopPoint.x).toBe(99);
  });
});

describe("CPictureData::OnFrameMove (32924E80)", () => {
  /** a picture with a point (so that its alpha can be seen) at (10, 20), 8 x 6 */
  function picture() {
    const { w } = setup();
    const p = new CPictureData(w);
    p.pPoint = new UIPointData();
    p.pos.set(10, 20);
    p.size.set(8, 6);
    p.pPoint.leftTopPoint.set(10, 20);
    p.m_fOriginalAlpha = 0.75;
    return p;
  }
  const alpha = (p: CPictureData) => p.pPoint!.color.a;

  test("twinkle: the time left counts down, the alpha is 0 while (t - (float)(int)(t / 0.7f)) < 0.2 and the original after, and the end restores the original", () => {
    const p = picture();
    p.m_bTwinkle = true;
    p.m_fRemainTwinkleTime = 1;
    // t = 0.75: (int)(0.75 / 0.7f) = 1 (the exe subtracts 1, not 0.7): 0.75 - 1 = -0.25 < 0.2: alpha 0
    p.onFrameMove(0, 0.25);
    expect([p.m_fRemainTwinkleTime, alpha(p)]).toEqual([0.75, 0]);
    // t = 0.5: (int)(0.714) = 0: 0.5 >= 0.2: original alpha; t = 0.25: 0.25 >= 0.2: original
    p.onFrameMove(0, 0.25);
    expect([p.m_fRemainTwinkleTime, alpha(p)]).toEqual([0.5, 0.75]);
    p.onFrameMove(0, 0.25);
    expect([p.m_fRemainTwinkleTime, alpha(p)]).toEqual([0.25, 0.75]);
    // t = 0: 0 < 0.2: alpha 0 (the time left is not above 0 only from the next frame)
    p.onFrameMove(0, 0.25);
    expect([p.m_fRemainTwinkleTime, alpha(p)]).toEqual([0, 0]);
    // time left 0: without a loop the twinkle ends and the alpha is the original; with one it starts again
    p.onFrameMove(0, 0.25);
    expect([p.m_bTwinkle, alpha(p)]).toEqual([false, 0.75]);
    p.m_bTwinkle = true;
    p.m_bLoop = true;
    p.m_fTwinkleTime = 3;
    p.pPoint!.color.a = 0.5;
    p.onFrameMove(0, 0.25);
    expect([p.m_bTwinkle, p.m_fRemainTwinkleTime, alpha(p)]).toEqual([true, 3, 0.75]);
  });

  test("twinkle: a phase of exactly 0.2f is not below 0.2f (the original alpha), and the periods taken off are (int)(t / 0.7f): cut, not rounded, not a remainder", () => {
    const p = picture();
    p.m_bTwinkle = true;
    // dt 0: t = 0.2f, (int)(0.2f / 0.7f) = 0, the phase is 0.2f: 0.2f < 0.2f is false: the original alpha
    p.m_fRemainTwinkleTime = f(0.2);
    p.onFrameMove(0, 0);
    expect([p.m_fRemainTwinkleTime, alpha(p)]).toEqual([f(0.2), 0.75]);
    // the float below 0.2f (0x3E4CCCCC) is below it: alpha 0
    const below = new Float32Array(new Uint32Array([0x3e4ccccc]).buffer)[0]!;
    expect(below < f(0.2)).toBe(true);
    p.m_fRemainTwinkleTime = below;
    p.onFrameMove(0, 0);
    expect([p.m_fRemainTwinkleTime, alpha(p)]).toEqual([below, 0]);
    // t = 1: (int)(1 / 0.7f) = (int)1.43 = 1: the phase is 1 - 1 = 0 < 0.2: alpha 0 (a remainder, 1 mod 0.7 = 0.3, would show the original)
    p.m_fRemainTwinkleTime = 1.25;
    p.onFrameMove(0, 0.25);
    expect([p.m_fRemainTwinkleTime, alpha(p)]).toEqual([1, 0]);
    // t = 1.25: (int)(1.25 / 0.7f) = (int)1.79 = 1 (cut: rounding would give 2): the phase is 0.25: the original alpha
    p.m_fRemainTwinkleTime = 1.5;
    p.onFrameMove(0, 0.25);
    expect([p.m_fRemainTwinkleTime, alpha(p)]).toEqual([1.25, 0.75]);
    // t = 1.75: (int)(2.5) = 2: the phase is -0.25: alpha 0
    p.m_fRemainTwinkleTime = 2;
    p.onFrameMove(0, 0.25);
    expect([p.m_fRemainTwinkleTime, alpha(p)]).toEqual([1.75, 0]);
  });

  test("flicker: the time goes up to m_fFlickerTime and down to 0 and the alpha is (max - min) * t / flickerTime + min", () => {
    const p = picture();
    p.m_bFlicker = true;
    p.m_fFlickerTime = 2;
    p.m_fFlickerMaxAlpha = 1;
    p.m_fFlickerMinAlpha = 0.25;
    p.m_bFlickerGainAlpha = true;
    const frames: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      p.onFrameMove(0, 0.5);
      frames.push([p.m_fRemainFlickerTime, alpha(p)]);
    }
    // t = 0.5: (1 - 0.25) * 0.5 / 2 + 0.25 = 0.4375; 1: 0.625; 1.5: 0.8125; 2: 1; then 2.5 is past the time: it turns round on that frame, with the alpha 0.9375 + 0.25 = 1.1875;
    // going down: 2: 1
    expect(frames).toEqual([[0.5, 0.4375], [1, 0.625], [1.5, 0.8125], [2, 1], [2.5, 1.1875], [2, 1]]);
    expect(p.m_bFlickerGainAlpha).toBe(false);
    // down to 0: alpha 0.25; below 0 the flicker ends (or turns round with a loop)
    p.m_fRemainFlickerTime = 0.5;
    p.onFrameMove(0, 0.5);
    expect([p.m_fRemainFlickerTime, alpha(p), p.m_bFlicker]).toEqual([0, 0.25, true]);
    p.onFrameMove(0, 0.5);
    // t = -0.5: 0.75 * -0.5 / 2 + 0.25 = 0.0625
    expect([p.m_fRemainFlickerTime, alpha(p), p.m_bFlicker, p.m_bFlickerGainAlpha]).toEqual([-0.5, 0.0625, false, false]);
    p.m_bFlicker = true;
    p.m_bFlickerLoop = true;
    p.onFrameMove(0, 0.5);
    expect([p.m_bFlicker, p.m_bFlickerGainAlpha]).toEqual([true, true]);
  });

  test("vibrate: the picture goes away from where it was by dirSpeed * elapsed until it is m_fDistance away (a double sqrt rounded to a float), comes back, and is put back after m_fMaxTime", () => {
    const p = picture();
    const v = p.m_VibrateData;
    v.m_fMaxTime = 1;
    v.m_fDistance = 4;
    v.m_vDirSpeed.set(3, 4);
    v.m_vOriginalPos.set(10, 20);
    v.m_bGoingAway = true;
    // frame 1: elapsed 0.5, the step is (3, 4) * 0.5 = (1.5, 2): pos (11.5, 22); the length is sqrt(2 * 2 + 1.5 * 1.5) = 2.5, not past 4
    p.onFrameMove(0, 0.5);
    expect([p.pos.x, p.pos.y, v.m_fElapsedTime, v.m_bGoingAway]).toEqual([11.5, 22, 0.5, true]);
    expect(p.pPoint!.leftTopPoint.x).toBe(11.5); // SetPos moves the point with the picture
    // frame 2: pos (13, 24): the length is sqrt(16 + 9) = 5 > 4: it turns round
    p.onFrameMove(0, 0.5);
    expect([p.pos.x, p.pos.y, v.m_fElapsedTime, v.m_bGoingAway]).toEqual([13, 24, 1, false]);
    // frame 3: the maximum time (1) is not above the elapsed time (1): the position is put back (the point is not moved), and the time is cleared
    p.onFrameMove(0, 0.5);
    expect([p.pos.x, p.pos.y, v.m_fMaxTime, p.pPoint!.leftTopPoint.x, p.pPoint!.leftTopPoint.y]).toEqual([10, 20, 0, 13, 24]);
    p.pos.set(5, 5);
    p.onFrameMove(0, 0.5); // a maximum time of 0 has nothing to put back
    expect([p.pos.x, p.pos.y]).toEqual([5, 5]);
  });

  test("vibrate, coming back: the picture moves by the step the other way and turns away again when (pos - original) . dirSpeed <= 0", () => {
    const p = picture();
    const v = p.m_VibrateData;
    v.m_fMaxTime = 10;
    v.m_vDirSpeed.set(3, 4);
    v.m_vOriginalPos.set(10, 20);
    v.m_bGoingAway = false;
    p.pos.set(13, 24);
    // step (0.75, 1): pos (12.25, 23); (23 - 20) * 4 + (12.25 - 10) * 3 = 18.75 > 0: it keeps coming back
    p.onFrameMove(0, 0.25);
    expect([p.pos.x, p.pos.y, v.m_bGoingAway]).toEqual([12.25, 23, false]);
    expect([p.pPoint!.leftTopPoint.x, p.pPoint!.leftTopPoint.y]).toEqual([12.25, 23]); // SetPos moves the point with the picture
    // from (10.5, 20.5): (9.75, 19.5): (19.5 - 20) * 4 + (9.75 - 10) * 3 = -2.75 <= 0: it turns away
    p.pos.set(10.5, 20.5);
    p.onFrameMove(0, 0.25);
    expect([p.pos.x, p.pos.y, v.m_bGoingAway]).toEqual([9.75, 19.5, true]);
    // a product of exactly 0 turns away too: from (10.75, 21) the step (0.75, 1) leaves (10, 20), where (20 - 20) * 4 + (10 - 10) * 3 = 0
    v.m_bGoingAway = false;
    p.pos.set(10.75, 21);
    p.onFrameMove(0, 0.25);
    expect([p.pos.x, p.pos.y, v.m_bGoingAway]).toEqual([10, 20, true]);
  });

  test("vibrate: the length is the distance from the original position in both axes", () => {
    const p = picture();
    const v = p.m_VibrateData;
    v.m_fMaxTime = 10;
    v.m_fDistance = 5;
    v.m_vDirSpeed.set(1, 7);
    v.m_vOriginalPos.set(10, 20);
    v.m_bGoingAway = true;
    // the step is (1, 7): (11, 27); sqrt(1 * 1 + 7 * 7) = 7.07 is past 5: it turns round (the x part alone, 1, would not)
    p.onFrameMove(0, 1);
    expect([p.pos.x, p.pos.y, v.m_bGoingAway]).toEqual([11, 27, false]);
    // the same with the axes the other way round
    v.m_vDirSpeed.set(7, 1);
    v.m_bGoingAway = true;
    p.pos.set(10, 20);
    p.onFrameMove(0, 1);
    expect([p.pos.x, p.pos.y, v.m_bGoingAway]).toEqual([17, 21, false]);
    // a short way in both axes is not past 5: sqrt(2 * 2 + 3 * 3) = 3.6
    v.m_vDirSpeed.set(2, 3);
    v.m_bGoingAway = true;
    p.pos.set(10, 20);
    p.onFrameMove(0, 1);
    expect([p.pos.x, p.pos.y, v.m_bGoingAway]).toEqual([12, 23, true]);
  });

  test("vibrate: it turns round only when the length is past m_fDistance: a length of exactly m_fDistance keeps going away", () => {
    const p = picture();
    const v = p.m_VibrateData;
    v.m_fMaxTime = 10;
    v.m_fDistance = 5;
    v.m_vDirSpeed.set(3, 4);
    v.m_vOriginalPos.set(10, 20);
    v.m_bGoingAway = true;
    // frame 1: the step is (1.5, 2): (11.5, 22), the length 2.5; frame 2: (13, 24): sqrt(3 * 3 + 4 * 4) = 5 exactly, not past 5
    p.onFrameMove(0, 0.5);
    p.onFrameMove(0, 0.5);
    expect([p.pos.x, p.pos.y, v.m_bGoingAway]).toEqual([13, 24, true]);
    // frame 3: (14.5, 26): sqrt(4.5 * 4.5 + 6 * 6) = sqrt(56.25) = 7.5, past 5: it turns round
    p.onFrameMove(0, 0.5);
    expect([p.pos.x, p.pos.y, v.m_bGoingAway]).toEqual([14.5, 26, false]);
  });

  test("vibrate, coming back: the product pairs the offset of an axis with the speed of the same axis", () => {
    const p = picture();
    const v = p.m_VibrateData;
    v.m_fMaxTime = 10;
    v.m_vDirSpeed.set(1, 2);
    v.m_vOriginalPos.set(10, 20);
    v.m_bGoingAway = false;
    // the step (1, 2) takes (15, 19.5) to (14, 17.5), the offset (4, -2.5): (17.5 - 20) * 2 + (14 - 10) * 1 = -5 + 4 = -1 <= 0: it turns away
    // (with the speeds the other way round it would be -2.5 * 1 + 4 * 2 = 5.5 > 0: it would keep coming back)
    p.pos.set(15, 19.5);
    p.onFrameMove(0, 1);
    expect([p.pos.x, p.pos.y, v.m_bGoingAway]).toEqual([14, 17.5, true]);
  });

  test("fade in: the alpha is t / fadeTime and past the fade time it is 1 and the fade ends; fade out: 1 - t / fadeTime, then 0", () => {
    const p = picture();
    p.m_bFadeIn = true;
    p.m_fFadeTime = 2;
    p.onFrameMove(0, 0.5);
    expect([p.m_fRemainFadeTime, alpha(p)]).toEqual([0.5, 0.25]);
    p.onFrameMove(0, 1);
    expect([p.m_fRemainFadeTime, alpha(p)]).toEqual([1.5, 0.75]);
    p.m_fRemainFadeTime = 2; // not past the time yet (2 < 2 is false)
    p.onFrameMove(0, 1);
    expect([p.m_fRemainFadeTime, alpha(p), p.m_bFadeIn]).toEqual([3, 1.5, true]);
    p.onFrameMove(0, 1); // 2 < 3: the end
    expect([alpha(p), p.m_bFadeIn]).toEqual([1, false]);
    const q = picture();
    q.m_bFadeOut = true;
    q.m_fFadeTime = 4;
    q.onFrameMove(0, 1);
    expect([q.m_fRemainFadeTime, alpha(q)]).toEqual([1, 0.75]);
    q.m_fRemainFadeTime = 4; // not past the time yet (4 < 4 is false): 5 / 4 gives an alpha below 0
    q.onFrameMove(0, 1);
    expect([q.m_fRemainFadeTime, alpha(q), q.m_bFadeOut]).toEqual([5, -0.25, true]);
    q.m_fRemainFadeTime = 5;
    q.onFrameMove(0, 1);
    expect([alpha(q), q.m_bFadeOut]).toEqual([0, false]);
  });

  test("a picture without a point runs the same animations and writes nothing", () => {
    const p = picture();
    p.pPoint = null;
    p.m_bTwinkle = true;
    p.m_fRemainTwinkleTime = 1;
    p.m_bFlicker = true;
    p.m_bFlickerGainAlpha = true;
    p.m_fFlickerTime = 2;
    p.m_bFadeIn = true;
    p.m_fFadeTime = 2;
    p.onFrameMove(0, 0.5);
    expect([p.m_fRemainTwinkleTime, p.m_fRemainFlickerTime, p.m_fRemainFadeTime]).toEqual([0.5, 0.5, 0.5]);
  });
});

describe("std::wstring::find(const wchar_t*, off) (328EFEC0)", () => {
  test("the first place at or after off where the pattern fits; npos (-1) past the last place it fits, for a pattern longer than the string and for an off that is negative (unsigned)", () => {
    expect(wstringFind("abcabc", "bc", 0)).toBe(1);
    expect(wstringFind("abcabc", "bc", 2)).toBe(4);
    expect(wstringFind("abcabc", "bc", 4)).toBe(4); // the last place it fits (size - n = 4)
    expect(wstringFind("abcabc", "bc", 5)).toBe(-1);
    expect(wstringFind("abc", "abc", 0)).toBe(0);
    expect(wstringFind("abc", "abc", 1)).toBe(-1);
    expect(wstringFind("abc", "abcd", 0)).toBe(-1);
    expect(wstringFind("abc", "z", 0)).toBe(-1);
    expect(wstringFind("abcabc", "bc", -1)).toBe(-1); // off is unsigned: -1 is 0xffffffff, past the end
    expect(wstringFind("#CX1", "#CX", 0)).toBe(0);
  });

  test("an empty pattern is found at off when off is not past the end", () => {
    expect(wstringFind("abc", "", 0)).toBe(0);
    expect(wstringFind("abc", "", 3)).toBe(3);
    expect(wstringFind("abc", "", 4)).toBe(-1);
    expect(wstringFind("", "", 0)).toBe(0);
  });
});

describe("CKTDGUIStatic::OnFrameMove (3292A120)", () => {
  const spreading = (msg: string, gap: number): UIStringData => {
    const t = new UIStringData();
    t.msg = msg;
    t.bSpread = true;
    t.fSpreadTimeGap = gap;
    return t;
  };

  test("a hidden static does nothing; a shown one keeps the frame's time and runs the move of the control", () => {
    const { w } = setup();
    const s = new CKTDGUIStatic(w);
    const t = spreading("abcd", 0.5);
    s.m_StringDataList.push(t);
    s.m_bShow = false;
    s.onFrameMove(0, 1);
    expect([s.m_fElapsedTime, t.fNowSpreadTime]).toEqual([0, 0]);
    s.m_bShow = true;
    s.m_fChangeTime = 2;
    s.m_GoalPos.set(10, 0);
    s.onFrameMove(0, 0.25);
    expect([s.m_fElapsedTime, s.m_fAnimateTime, s.m_OffsetPos.x]).toEqual([0.25, 0.25, f(f(f(10 - 0) * 0.5) * 0.25)]);
  });

  test("a spreading string shows one more character each time the gap is passed (not reached: 0.5 s is not above 0.5 s) and stops when it has shown all", () => {
    const { w } = setup();
    const s = new CKTDGUIStatic(w);
    const t = spreading("abcd", 0.5);
    s.m_StringDataList.push(t);
    s.onFrameMove(0, 0.25);
    expect([t.fNowSpreadTime, t.iSpreadCount]).toEqual([0.25, 0]);
    s.onFrameMove(0, 0.25);
    expect([t.fNowSpreadTime, t.iSpreadCount]).toEqual([0.5, 0]); // jbe: 0.5 <= 0.5 does not count
    s.onFrameMove(0, 0.25);
    expect([t.fNowSpreadTime, t.iSpreadCount]).toEqual([0, 1]);
    for (let i = 0; i < 3; i++) s.onFrameMove(0, 1); // 1 s each: 2, 3, 4
    expect([t.iSpreadCount, t.bSpread]).toEqual([4, true]);
    s.onFrameMove(0, 1); // 4 >= 4: done
    expect([t.iSpreadCount, t.bSpread, t.fNowSpreadTime]).toEqual([4, false, 0]);
    s.onFrameMove(0, 1); // no longer spreading
    expect(t.fNowSpreadTime).toBe(0);
  });

  test("the colour codes: with the count at 0, a message that starts with #CX advances by 2 more and one that starts with #C by 7 more (the exe compares the find with 0)", () => {
    const { w } = setup();
    const s = new CKTDGUIStatic(w);
    const x = spreading("#CXab", 0.5), c = spreading("#C123456789", 0.5), other = spreading("ab#CXcd#C", 0.5);
    s.m_StringDataList.push(x, c, other);
    s.onFrameMove(0, 1);
    // #CX at 0: 0 + 1 + 2; #C at 0: 0 + 1 + 7; a message with the codes later: only 1
    expect([x.iSpreadCount, c.iSpreadCount, other.iSpreadCount]).toEqual([3, 8, 1]);
    s.onFrameMove(0, 1);
    // #CXab has 5 characters: 3 -> 4 (the codes are not found at 3); #C...: 11 characters, 8 -> 9; the third -> 2
    expect([x.iSpreadCount, c.iSpreadCount, other.iSpreadCount]).toEqual([4, 9, 2]);
  });

  test("only a picture with an animation on is moved: twinkle, flicker, fade in, fade out or a vibration", () => {
    const { w } = setup();
    const s = new CKTDGUIStatic(w);
    const make = () => {
      const p = new CPictureData(w);
      p.pPoint = new UIPointData();
      p.m_fOriginalAlpha = 0.5;
      p.m_fFadeTime = 2;
      p.m_fFlickerTime = 2;
      p.m_fFlickerMaxAlpha = 1;
      p.m_bFlickerGainAlpha = true;
      s.AddPicture(p);
      return p;
    };
    const [twinkle, flicker, fadeIn, fadeOut, vibrate, none] = [make(), make(), make(), make(), make(), make()];
    twinkle.m_bTwinkle = true;
    twinkle.m_fRemainTwinkleTime = 1;
    flicker.m_bFlicker = true;
    fadeIn.m_bFadeIn = true;
    fadeOut.m_bFadeOut = true;
    vibrate.m_VibrateData.m_fMaxTime = 1;
    vibrate.m_VibrateData.m_vDirSpeed.set(2, 0);
    none.m_fRemainTwinkleTime = 1;
    none.m_fRemainFadeTime = 1;
    s.onFrameMove(0, 0.5);
    expect(twinkle.m_fRemainTwinkleTime).toBe(0.5);
    expect(flicker.m_fRemainFlickerTime).toBe(0.5);
    expect(fadeIn.m_fRemainFadeTime).toBe(0.5);
    expect(fadeOut.m_fRemainFadeTime).toBe(0.5);
    expect(vibrate.pos.x).toBe(1);
    expect([none.m_fRemainTwinkleTime, none.m_fRemainFadeTime]).toEqual([1, 1]);
  });

  test("a movie's frame is not ported: it is counted, once for each movie, and a hidden static counts none", () => {
    const { w } = rig();
    const s = new CKTDGUIStatic(w);
    s.AddMovieData(new CMovieData(w));
    s.AddMovieData(new CMovieData(w));
    s.m_bShow = false;
    s.onFrameMove(0, 1);
    expect([...w.render!.undrawn]).toEqual([]);
    s.m_bShow = true;
    s.onFrameMove(0, 1);
    expect([...w.render!.undrawn]).toEqual([["CMovieData::OnFrameMove", 2]]);
  });
});


// ---- the control classes' state machines --------------------------------------------------------------------------------------------

/**
 * a dialog at the back and one in front of it, both in a manager: a control of `back` has a dialog in front of it.  A dialog is modal when
 * it is made, and `CheckFrontModalDlg` is about the ones that are not, so the front one is made not modal.
 */
function stacked(w: ReturnType<typeof setup>["w"]) {
  const back = new CKTDGUIDialog(w), front = new CKTDGUIDialog(w);
  front.m_bModal = false;
  const manager = w.dialogManager;
  manager.m_setDialog.add(back);
  back.m_pkUIDialogManager = manager;
  manager.m_listDialog.push(back, front);
  return { back, front, manager };
}

describe("CKTDGUIButton::OnFrameMove (3292EA10)", () => {
  function button() {
    const s = setup();
    const b = new CKTDGUIButton(s.w);
    const ud = s.wrap(b, "CKTDGUIButton");
    s.m(ud, "SetNormalTex", "B.TGA", "N");
    s.m(ud, "SetNormalPoint", s.point(10, 20));
    const sound = new DeviceSound("OVER.OGG", false);
    b.m_pSndMouseOver = sound;
    return { ...s, b, sound };
  }
  interface Flags { over?: boolean; enable?: boolean; overAtNormal?: boolean; downAtNormal?: boolean }
  const run = (state: number, flags: Flags) => {
    const { b, sound } = button();
    b.m_ButtonState = state;
    b.m_bMouseOver = flags.over ?? false;
    b.m_bEnable = flags.enable ?? true;
    b.m_bOverStateAtNormal = flags.overAtNormal ?? false;
    b.m_bDownStateAtNormal = flags.downAtNormal ?? false;
    expect(b.onFrameMove(0, 0.1)).toBe(0);
    return [b.m_ButtonState, sound.plays];
  };
  const { NORMAL: N, MOUSEOVER: O, MOUSEDOWN: D, DISABLE: X } = BCS;

  test("normal: the mouse over (or m_bOverStateAtNormal, or m_bDownStateAtNormal for mouse down, in that order) enters the state and plays the over sound; a disabled button is disabled", () => {
    expect(run(N, {})).toEqual([N, 0]);
    expect(run(N, { over: true })).toEqual([O, 1]);
    expect(run(N, { overAtNormal: true })).toEqual([O, 1]);
    expect(run(N, { downAtNormal: true })).toEqual([D, 1]);
    expect(run(N, { overAtNormal: true, downAtNormal: true })).toEqual([O, 1]);
    expect(run(N, { enable: false })).toEqual([X, 0]);
    expect(run(N, { over: true, enable: false })).toEqual([O, 1]); // the mouse is looked at before the enabling
  });

  test("mouse over: it stays while the mouse is over (or m_bOverStateAtNormal), goes back to normal when the mouse left, to normal or disabled with m_bDownStateAtNormal, and to disabled when not enabled", () => {
    expect(run(O, { over: true })).toEqual([O, 0]);
    expect(run(O, {})).toEqual([N, 0]);
    expect(run(O, { over: true, enable: false })).toEqual([X, 0]);
    expect(run(O, { enable: false })).toEqual([N, 0]); // the mouse left: normal (a disabled button that is not over goes back to normal, then disabled in the next frame)
    expect(run(O, { overAtNormal: true })).toEqual([O, 0]);
    expect(run(O, { overAtNormal: true, enable: false })).toEqual([X, 0]);
    expect(run(O, { downAtNormal: true })).toEqual([N, 0]);
    expect(run(O, { downAtNormal: true, over: true })).toEqual([N, 0]);
    expect(run(O, { downAtNormal: true, enable: false })).toEqual([X, 0]);
    expect(run(O, { overAtNormal: true, downAtNormal: true })).toEqual([O, 0]);
  });

  test("mouse down: it stays while the mouse is over (or m_bDownStateAtNormal), goes back to normal otherwise, and a disabled button that is held is disabled", () => {
    expect(run(D, { over: true })).toEqual([D, 0]);
    expect(run(D, {})).toEqual([N, 0]);
    expect(run(D, { downAtNormal: true })).toEqual([D, 0]);
    expect(run(D, { over: true, enable: false })).toEqual([X, 0]);
    expect(run(D, { downAtNormal: true, enable: false })).toEqual([X, 0]);
    expect(run(D, { enable: false })).toEqual([N, 0]);
    expect(run(D, { overAtNormal: true })).toEqual([N, 0]);
  });

  test("disabled: it is normal once enabled, and stays otherwise", () => {
    expect(run(X, {})).toEqual([N, 0]);
    expect(run(X, { enable: false })).toEqual([X, 0]);
    expect(run(X, { enable: false, over: true })).toEqual([X, 0]);
  });

  test("leaving mouse over sends m_CustomMsgMouseOut (m_bMouseOut is set and ChangeState clears it)", () => {
    const { b, d, stageLog } = (() => {
      const x = button();
      const d = x.dialog();
      d.m_pStage = x.stage;
      d.AddControl(x.b);
      return { ...x, d };
    })();
    void d;
    b.m_CustomMsgMouseOut = 5;
    b.m_ButtonState = BCS.MOUSEOVER;
    b.onFrameMove(0, 0.1);
    expect([b.m_ButtonState, b.m_bMouseOut]).toEqual([BCS.NORMAL, false]);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 5]]);
  });

  test("each state runs the steps of its own map and gives the texture to its own point (sized from it, the state entered again); the disabled state has no steps", () => {
    const make = () => {
      const x = button();
      const ud = x.wrap(x.b, "CKTDGUIButton");
      x.m(ud, "SetOverTex", "B.TGA", "O");
      x.m(ud, "SetOverPoint", x.point(30, 40));
      x.m(ud, "SetDownTex", "B.TGA", "D");
      x.m(ud, "SetDownPoint", x.point(50, 60));
      return x;
    };
    const step = (w: ReturnType<typeof setup>["w"], width: number, height: number) => {
      const s = new TexChangeData();
      s.m_fShowTime = 5;
      s.m_pTexData = setTexureData(w, "S.TGA", "K")!;
      s.m_pTexData.texSize.set(width, height);
      return s;
    };
    for (const [state, field, left, top, width, height] of [
      [BCS.NORMAL, "m_mapMouseNormalTex", 10, 20, 16, 8],
      [BCS.MOUSEOVER, "m_mapMouseOverTex", 30, 40, 12, 6],
      [BCS.MOUSEDOWN, "m_mapMouseDownTex", 50, 60, 20, 10],
    ] as const) {
      const { b, w } = make();
      const own = step(w, width, height);
      b[field].set(0, own);
      b.m_ButtonState = state;
      b.m_bMouseOver = state !== BCS.NORMAL; // it stays in its state
      b.onFrameMove(0, 0.1);
      const point = state === BCS.NORMAL ? b.m_pNormalPoint! : state === BCS.MOUSEOVER ? b.m_pMouseOverPoint! : b.m_pMouseDownPoint!;
      expect([b.m_ButtonState, b.m_NowTexChangeData.m_fShowTime]).toEqual([state, f(0.1)]);
      expect(is(point.pUITextureData, own.m_pTexData)).toBe(true);
      expect([point.leftTopPoint.x, point.leftTopPoint.y, point.rightBottomPoint.x, point.rightBottomPoint.y]).toEqual([left, top, left + width, top + height]);
      // the other states' points keep their texture
      const others = [b.m_pNormalPoint!, b.m_pMouseOverPoint!, b.m_pMouseDownPoint!].filter((q) => !is(q, point));
      expect(others.map((q) => is(q.pUITextureData, own.m_pTexData))).toEqual([false, false]);
    }
    // disabled: the steps of every map are left alone
    const { b, w } = make();
    for (const map of [b.m_mapMouseNormalTex, b.m_mapMouseOverTex, b.m_mapMouseDownTex]) map.set(0, step(w, 16, 8));
    b.m_ButtonState = BCS.DISABLE;
    b.m_bEnable = false;
    b.onFrameMove(0, 0.1);
    expect([b.m_ButtonState, b.m_NowTexChangeData.m_fShowTime]).toEqual([BCS.DISABLE, 0]);
  });

  test("a hidden button does nothing", () => {
    const { b, sound } = button();
    b.m_bShow = false;
    b.m_bMouseOver = true;
    b.m_fChangeTime = 2;
    expect(b.onFrameMove(0, 1)).toBe(0);
    expect([b.m_ButtonState, sound.plays, b.m_fElapsedTime, b.m_fAnimateTime]).toEqual([BCS.NORMAL, 0, 0, 0]);
  });

  test("the mouse over is lost when a dialog in front of the button's is not modal (CheckFrontModalDlg); a modal one in front does not count", () => {
    const { b, sound, w } = button();
    const { back, front } = stacked(w);
    back.AddControl(b);
    b.m_bMouseOver = true;
    b.onFrameMove(0, 0.1);
    expect([b.m_bMouseOver, b.m_ButtonState, sound.plays]).toEqual([false, BCS.NORMAL, 0]);
    front.m_bModal = true;
    b.m_bMouseOver = true;
    b.onFrameMove(0, 0.1);
    expect([b.m_bMouseOver, b.m_ButtonState, sound.plays]).toEqual([true, BCS.MOUSEOVER, 1]);
  });

  test("the point moves towards its end point (ChangePoint) with the button's frame time", () => {
    const { b } = button();
    setCorners(b.m_NowPoint, [0, 0, 8, 0, 0, 16, 8, 16]);
    setCorners(b.m_EndPoint, [4, 8, 16, 8, 4, 24, 16, 24]);
    b.m_EndPoint.fChangeTime = 2;
    b.m_NowPoint.fChangeTime = 0;
    b.onFrameMove(0, 1);
    expect(corners(b.m_NowPoint)).toEqual([2, 4, 12, 4, 2, 20, 12, 20]);
  });

  test("the guide text is asked for in the mouse over state (and, with m_bShowDescriptionWhenDisable and the mouse over, in the disabled one)", () => {
    const { b, w } = button();
    const d = new CKTDGUIDialog(w);
    const asked = askedFor(d);
    d.AddControl(b);
    b.m_ButtonState = BCS.MOUSEOVER;
    b.m_bMouseOver = true;
    b.onFrameMove(0, 0.1); // no guide text: nothing is asked
    expect(asked.length).toBe(0);
    b.m_GuideDesc = "a hint";
    b.onFrameMove(0, 0.1);
    expect([asked.length, asked[0] === b]).toEqual([1, true]);
    b.m_ButtonState = BCS.DISABLE;
    b.m_bEnable = false;
    b.onFrameMove(0, 0.1); // not asked in the disabled state without m_bShowDescriptionWhenDisable
    expect(asked.length).toBe(1);
    b.m_bShowDescriptionWhenDisable = true;
    b.onFrameMove(0, 0.1);
    expect(asked.length).toBe(2);
    b.m_bMouseOver = false;
    b.onFrameMove(0, 0.1); // ... or without the mouse over it
    expect(asked.length).toBe(2);
    b.m_pDialog = null; // a control that is in no dialog has nobody to ask
    b.m_bMouseOver = true;
    b.m_ButtonState = BCS.MOUSEOVER;
    b.m_bEnable = true;
    b.onFrameMove(0, 0.1);
    expect(asked.length).toBe(2);
  });

  test("the Enter key: a button with the focus and an edge answers it with a click (LButtonMouseUp) and takes the key's lock; any other case leaves the key alone", () => {
    const { b, w } = button();
    const key = 0x1c;
    w.keyboard.m_State[key] = -128;
    b.m_EdgeWidth = 2;
    b.m_bHasFocus = false;
    b.onFrameMove(0, 0.1);
    expect(w.keyboard.m_Locks[key]).toBe(0);
    b.m_bHasFocus = true;
    b.m_EdgeWidth = 0;
    b.onFrameMove(0, 0.1);
    expect(w.keyboard.m_Locks[key]).toBe(0);
    b.m_EdgeWidth = 2;
    const { back, front } = stacked(w);
    back.AddControl(b);
    b.onFrameMove(0, 0.1); // a dialog in front: the key is not read
    expect(w.keyboard.m_Locks[key]).toBe(0);
    front.m_bShow = false;
    w.keyboard.m_State[key] = 0; // the key is up
    b.onFrameMove(0, 0.1);
    expect(w.keyboard.m_Locks[key]).toBe(0);
    // the click: no mouse up message, so the game gets the control message 0x466 (2, the button) at once; the mouse up sound plays
    const sent: [number, number, boolean][] = [];
    w.stageChain.push({ m_eStageState: STAGE_STATE.ACTIVE, MsgProc: (m, wParam, lParam) => { sent.push([m, wParam as number, lParam === b]); return true; } });
    const up = new DeviceSound("UP.OGG", false);
    b.m_pSndMouseUp = up;
    w.keyboard.m_State[key] = -128;
    b.onFrameMove(0, 0.1);
    expect(w.keyboard.m_Locks[key]).toBe(1);
    expect(sent).toEqual([[0x466, 2, true]]);
    expect(up.plays).toBe(1);
    b.onFrameMove(0, 0.1); // the lock: the same press answers once
    expect(sent.length).toBe(1);
    expect(up.plays).toBe(1);
  });
});

describe("CKTDGUICheckBox::OnFrameMove (329319A0)", () => {
  const run = (state: number, over: boolean, enable: boolean) => {
    const { w } = setup();
    const c = new CKTDGUICheckBox(w);
    c.m_pBGPoint = new UIPointData();
    c.m_CheckBoxState = state;
    c.m_bMouseOver = over;
    c.m_bEnable = enable;
    expect(c.onFrameMove(0, 0.1)).toBe(0);
    return c.m_CheckBoxState;
  };
  const { NORMAL: N, MOUSEOVER: O, DISABLE: X } = CBCS;

  test("normal goes to mouse over when the mouse is over, mouse over back to normal when it left; a box that is not enabled becomes disabled and one that is enabled again becomes normal", () => {
    expect([run(N, false, true), run(N, true, true), run(N, false, false), run(N, true, false)]).toEqual([N, O, X, O]);
    expect([run(O, true, true), run(O, false, true), run(O, true, false), run(O, false, false)]).toEqual([O, N, X, N]);
    expect([run(X, false, true), run(X, false, false), run(X, true, true), run(X, true, false)]).toEqual([N, X, N, X]);
    expect(run(3, false, false)).toBe(3); // a state it does not know
  });

  test("a hidden box does nothing; the current point moves towards the end point", () => {
    const { w } = setup();
    const c = new CKTDGUICheckBox(w);
    c.m_pBGPoint = new UIPointData();
    c.m_bEnable = false;
    c.m_bShow = false;
    c.onFrameMove(0, 0.1);
    expect([c.m_CheckBoxState, c.m_fElapsedTime]).toEqual([CBCS.NORMAL, 0]);
    c.m_bShow = true;
    setCorners(c.m_NowPoint, [0, 0, 0, 0, 0, 0, 0, 0]);
    setCorners(c.m_EndPoint, [4, 0, 0, 0, 0, 0, 0, 0]);
    c.m_EndPoint.fChangeTime = 4;
    c.m_NowPoint.fChangeTime = 0;
    c.m_bEnable = true;
    c.onFrameMove(0, 1);
    expect(c.m_NowPoint.leftTopPoint.x).toBe(1);
  });
});

describe("CKTDGUIRadioButton::OnFrameMove (3294ACD0)", () => {
  function radio() {
    const s = setup();
    const r = new CKTDGUIRadioButton(s.w);
    r.m_pRadioButtonPoint = new UIPointData();
    r.m_pBGPoint = new UIPointData();
    setCorners(r.m_pBGPoint, [1, 2, 3, 2, 1, 4, 3, 4]);
    const d = s.dialog();
    d.m_pStage = s.stage;
    d.AddControl(r);
    const sound = new DeviceSound("OVER.OGG", false);
    r.m_pSndMouseOver = sound;
    return { ...s, r, d, sound };
  }
  const { NORMAL: N, MOUSEOVER: O, DISABLE: X } = RBCS;
  interface Flags { over?: boolean; enable?: boolean; checked?: boolean }
  const run = (state: number, flags: Flags) => {
    const { r, sound, stageLog } = radio();
    r.m_RadioButtonState = state;
    r.m_bMouseOver = flags.over ?? false;
    r.m_bEnable = flags.enable ?? true;
    r.m_bChecked = flags.checked ?? false;
    expect(r.onFrameMove(0, 0.1)).toBe(0);
    return { state: r.m_RadioButtonState, plays: sound.plays, stageLog, r };
  };

  test("normal: the mouse over plays the over sound (unchecked only) and enters mouse over; a checked button does not change state (ChangeState leaves a checked one alone); not enabled: disabled", () => {
    expect([run(N, {}).state, run(N, {}).plays]).toEqual([N, 0]);
    expect([run(N, { over: true }).state, run(N, { over: true }).plays]).toEqual([O, 1]);
    const checked = run(N, { over: true, checked: true });
    expect([checked.state, checked.plays]).toEqual([N, 0]);
    expect(run(N, { enable: false }).state).toBe(X);
    expect(run(N, { over: true, enable: false }).state).toBe(O);
  });

  test("normal -> mouse over sends the over message when there is one (0x467), also from a checked button", () => {
    const { r, stageLog } = radio();
    r.m_RadioButtonState = N;
    r.m_bMouseOver = true;
    r.m_CustomMsgMouseOver = 7;
    r.onFrameMove(0, 0.1);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 7]]);
    const c = radio();
    c.r.m_RadioButtonState = N;
    c.r.m_bMouseOver = true;
    c.r.m_bChecked = true;
    c.r.m_CustomMsgMouseOver = 7;
    c.r.onFrameMove(0, 0.1);
    expect(c.stageLog).toEqual([[UIM.CUSTOM_MSG, 7]]);
    expect(c.sound.plays).toBe(0);
  });

  test("mouse over: stays while the mouse is over, becomes disabled when not enabled, goes back to normal when the mouse left", () => {
    expect(run(O, { over: true }).state).toBe(O);
    expect(run(O, { over: true, enable: false }).state).toBe(X);
    expect(run(O, {}).state).toBe(N);
    expect(run(O, { enable: false }).state).toBe(N);
  });

  test("leaving mouse over sends m_CustomMsgMouseOut, but only when m_CustomMsgMouseOver is set (the exe tests the wrong one)", () => {
    const a = radio();
    a.r.m_CustomMsgMouseOut = 8;
    a.r.onFrameMove(0, 0.1);
    expect(a.stageLog).toEqual([]);
    const b = radio();
    b.r.m_CustomMsgMouseOut = 8;
    b.r.m_CustomMsgMouseOver = 7;
    b.r.onFrameMove(0, 0.1);
    expect(b.stageLog).toEqual([[UIM.CUSTOM_MSG, 8]]);
    const c = radio();
    c.r.m_CustomMsgMouseOver = 7; // m_CustomMsgMouseOut is -1: it is sent as -1
    c.r.onFrameMove(0, 0.1);
    expect(c.stageLog).toEqual([[UIM.CUSTOM_MSG, -1]]);
  });

  test("disabled: normal once enabled; stays otherwise", () => {
    expect(run(X, {}).state).toBe(N);
    expect(run(X, { enable: false }).state).toBe(X);
  });

  test("the first frame gives an unchecked button the picture it draws: a new button is in the mouse over state, the mouse is elsewhere, so ChangeState(NORMAL) makes the background point the current point", () => {
    const { r } = radio();
    expect(r.m_RadioButtonState).toBe(O);
    expect(corners(r.m_MyNowPoint)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    r.onFrameMove(0, 0.1);
    expect(r.m_RadioButtonState).toBe(N);
    expect(corners(r.m_MyNowPoint)).toEqual([1, 2, 3, 2, 1, 4, 3, 4]);
  });

  test("both points move towards their end points: the control's and the button's own background", () => {
    const { r } = radio();
    r.m_RadioButtonState = N; // no state change
    setCorners(r.m_NowPoint, [0, 0, 0, 0, 0, 0, 0, 0]);
    setCorners(r.m_EndPoint, [8, 0, 0, 0, 0, 0, 0, 0]);
    r.m_EndPoint.fChangeTime = 4;
    setCorners(r.m_MyNowPoint, [0, 0, 0, 0, 0, 0, 0, 0]);
    setCorners(r.m_MyEndPoint, [0, 12, 0, 0, 0, 0, 0, 0]);
    r.m_MyEndPoint.fChangeTime = 2;
    r.onFrameMove(0, 1);
    // (8 - 0) / (4 - 0) * 1 = 2; (12 - 0) / (2 - 0) * 1 = 6
    expect([r.m_NowPoint.leftTopPoint.x, r.m_MyNowPoint.leftTopPoint.y]).toEqual([2, 6]);
  });

  test("a hidden button does nothing; the guide text is asked for in the mouse over state", () => {
    const { r, d } = radio();
    const asked = askedFor(d);
    r.m_bShow = false;
    r.onFrameMove(0, 0.1);
    expect(r.m_RadioButtonState).toBe(O);
    r.m_bShow = true;
    r.m_RadioButtonState = O;
    r.m_bMouseOver = true;
    r.m_GuideDesc = "hint";
    r.onFrameMove(0, 0.1);
    expect([asked.length, asked[0] === r]).toEqual([1, true]);
    r.m_RadioButtonState = X;
    r.m_bEnable = false;
    r.onFrameMove(0, 0.1);
    expect(asked.length).toBe(1);
    r.m_bShowDescriptionWhenDisable = true;
    r.onFrameMove(0, 0.1);
    expect(asked.length).toBe(2);
  });
});

describe("the controls that only keep their current point: slider, scroll bar, navigation", () => {
  test("slider (3294CC50): a shown slider takes the corners of its bounding box (ints) as its current point, after the move of the control", () => {
    const { w } = setup();
    const c = new CKTDGUISlider(w);
    setRect(c.m_rcBoundingBox, 3, 5, 11, 13);
    c.m_bShow = false;
    c.onFrameMove(0, 1);
    expect(corners(c.m_NowPoint)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    c.m_bShow = true;
    c.m_fChangeTime = 2;
    c.m_GoalPos.set(4, 0);
    expect(c.onFrameMove(0, 1)).toBe(0);
    expect(corners(c.m_NowPoint)).toEqual([3, 5, 11, 5, 3, 13, 11, 13]);
    expect(c.m_OffsetPos.x).toBe(2);
  });

  test("scroll bar (32985E30): the corners of its track", () => {
    const { w } = setup();
    const c = new CKTDGUIScrollBar(w);
    setRect(c.m_rcTrack, 7, 9, 15, 41);
    c.m_bShow = false;
    c.onFrameMove(0, 1);
    expect(corners(c.m_NowPoint)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    c.m_bShow = true;
    c.m_fChangeTime = 2;
    c.m_GoalPos.set(4, 0);
    expect(c.onFrameMove(0, 1)).toBe(0);
    expect(corners(c.m_NowPoint)).toEqual([7, 9, 15, 9, 7, 41, 15, 41]);
    expect(c.m_OffsetPos.x).toBe(2);
  });

  test("navigation (3294E530): only an enabled one runs the control's move (a hidden one does nothing there either)", () => {
    const { w } = setup();
    const c = new CKTDGUINavigation(w);
    c.m_fChangeTime = 2;
    c.m_GoalPos.set(4, 0);
    c.m_bEnable = false;
    expect(c.onFrameMove(0, 1)).toBe(0);
    expect([c.m_fElapsedTime, c.m_OffsetPos.x]).toEqual([0, 0]);
    c.m_bEnable = true;
    c.onFrameMove(0, 1);
    expect([c.m_fElapsedTime, c.m_OffsetPos.x]).toEqual([1, 2]);
    c.m_bShow = false;
    c.onFrameMove(0, 1);
    expect(c.m_OffsetPos.x).toBe(2);
  });
});

describe("CKTDGUIContolList::OnFrameMove (3294FBF0)", () => {
  function list() {
    const s = setup();
    const d = s.dialog();
    d.m_pStage = s.stage;
    const l = new CKTDGUIContolList(s.w);
    d.AddControl(l);
    setRect(l.m_rcBoundingBox, 10, 20, 110, 220);
    return { ...s, d, l };
  }

  test("a bar whose position is not the top index makes the list take it: UpdateScrollBar, the scroll message (0x467), and the corners move right by the Y bar's width", () => {
    const { w, l, stageLog } = list();
    const bar = new CKTDGUIScrollBar(w);
    bar.m_nEnd = 10;
    bar.m_nPosition = 3;
    bar.m_width = 20;
    l.m_pScrollBarY = bar;
    l.m_iMaxIndexY = 5;
    l.m_iViewSizeY = 2;
    l.m_CustomMsgScroll = 9;
    setRect(bar.m_rcTrack, 7, 9, 15, 41);
    l.m_fChangeTime = 2; // the list moves like a control
    l.m_GoalPos.set(4, 0);
    expect(l.onFrameMove(0, 1)).toBe(0);
    expect([l.m_fElapsedTime, l.m_OffsetPos.x]).toEqual([1, 2]);
    expect(corners(bar.m_NowPoint)).toEqual([7, 9, 15, 9, 7, 41, 15, 41]); // the bar was moved (its current point is its track)
    expect([l.m_iTopIndexX, l.m_iTopIndexY]).toEqual([0, 3]);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 9]]);
    // UpdateScrollBar: the bar has the range 0 .. (5 - 2 + 2) and the top index as its position
    expect([bar.m_nStart, bar.m_nEnd, bar.m_nPosition, bar.m_bShow, bar.m_bEnable]).toEqual([0, 5, 3, true, true]);
    // 10 + 20, 20, 110 + 20, 220
    expect(corners(l.m_NowPoint)).toEqual([30, 20, 130, 20, 30, 220, 130, 220]);
    l.onFrameMove(0, 1); // the bar and the list agree: no new message
    expect(stageLog.length).toBe(1);
  });

  test("the X bar moves the top index X and shifts the corners down by its width; without a message id nothing is sent; no bars: the box itself", () => {
    const { w, l, stageLog } = list();
    l.onFrameMove(0, 1);
    expect(corners(l.m_NowPoint)).toEqual([10, 20, 110, 20, 10, 220, 110, 220]);
    const bar = new CKTDGUIScrollBar(w);
    bar.m_nEnd = 10;
    bar.m_nPosition = 4;
    bar.m_width = 6;
    setRect(bar.m_rcTrack, 7, 9, 15, 41);
    l.m_pScrollBarX = bar;
    l.onFrameMove(0, 1); // only the X position is not the top index
    expect([l.m_iTopIndexX, l.m_iTopIndexY]).toEqual([4, 0]);
    expect(corners(l.m_NowPoint)).toEqual([10, 26, 110, 26, 10, 226, 110, 226]);
    expect(corners(bar.m_NowPoint)).toEqual([7, 9, 15, 9, 7, 41, 15, 41]); // the X bar was moved too
    expect(stageLog).toEqual([]);
    l.m_iTopIndexY = 2; // the Y position (none: 0) is not the top index either
    l.m_iTopIndexX = 4;
    l.onFrameMove(0, 1);
    expect([l.m_iTopIndexX, l.m_iTopIndexY]).toEqual([4, 0]);
  });

  test("a new top index puts the cells of the window in the list (placed) and the others out of it (UpdateRenderControlList)", () => {
    const { w, l } = list();
    const bar = new CKTDGUIScrollBar(w);
    bar.m_nEnd = 10;
    bar.m_nPosition = 3;
    l.m_pScrollBarY = bar;
    const inside = new CKTDGUINavigation(w), outside = new CKTDGUINavigation(w);
    l.InsertItem(inside, 3, 0, false);
    l.InsertItem(outside, 0, 0, false);
    l.m_iViewSizeY = 2;
    l.m_iViewSizeX = 1;
    l.m_iScrollOffsetY = 30;
    l.m_Pos.set(100, 200);
    expect([inside.m_bOutofList, outside.m_bOutofList]).toEqual([false, false]);
    l.onFrameMove(0, 1);
    // rows 3 and 4 are in the window: the cell of row 3 is at the list's position (100, 200); row 0 is out
    expect([inside.m_bOutofList, outside.m_bOutofList, l.m_vecNowControls.length]).toEqual([false, true, 1]);
    expect([inside.m_OffsetPos.x, inside.m_OffsetPos.y]).toEqual([100, 200]);
  });

  test("a hidden or disabled list does nothing", () => {
    const { l } = list();
    l.m_fChangeTime = 2;
    l.m_GoalPos.set(4, 0);
    l.m_bShow = false;
    expect(l.onFrameMove(0, 1)).toBe(0);
    l.m_bShow = true;
    l.m_bEnable = false;
    l.onFrameMove(0, 1);
    expect([l.m_fElapsedTime, l.m_OffsetPos.x, corners(l.m_NowPoint)]).toEqual([0, 0, [0, 0, 0, 0, 0, 0, 0, 0]]);
  });
});

describe("CKTDGUIComboBox::OnFrameMove (3293D960)", () => {
  function combo() {
    const s = setup();
    const c = new CKTDGUIComboBox(s.w);
    setRect(c.m_rcButton, 30, 40, 50, 60);
    const sound = new DeviceSound("OVER.OGG", false);
    c.m_pSndButtonMouseOver = sound;
    return { ...s, c, sound };
  }

  test("the button's rectangle is the second bounding box and the current point; the scroll bar and the rows' controls are moved", () => {
    const { w, c } = combo();
    const bar = new CKTDGUIScrollBar(w);
    c.m_pScrollBar = bar;
    const rows = [0, 1].map(() => {
      const control = new CKTDGUINavigation(w);
      c.m_Items.push({ strText: "x", pData: null, rcActive: newRect(), bVisible: false, pControl: control });
      return control;
    });
    c.m_Items.push({ strText: "y", pData: null, rcActive: newRect(), bVisible: false, pControl: null });
    expect(c.onFrameMove(0, 0.5)).toBe(0);
    expect([c.m_rcBoundingBox2.left, c.m_rcBoundingBox2.top, c.m_rcBoundingBox2.right, c.m_rcBoundingBox2.bottom]).toEqual([30, 40, 50, 60]);
    expect(corners(c.m_NowPoint)).toEqual([30, 40, 50, 40, 30, 60, 50, 60]);
    expect([c.m_fElapsedTime, bar.m_fElapsedTime, rows[0]!.m_fElapsedTime, rows[1]!.m_fElapsedTime]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  test("the over sound is played once when the mouse comes over the box, and again after it left", () => {
    const { c, sound } = combo();
    c.onFrameMove(0, 0.1);
    expect([sound.plays, c.m_bMouseOverCheck]).toEqual([0, false]);
    c.m_bMouseOver = true;
    c.onFrameMove(0, 0.1);
    expect([sound.plays, c.m_bMouseOverCheck]).toEqual([1, true]);
    c.onFrameMove(0, 0.1);
    expect(sound.plays).toBe(1);
    c.m_bMouseOver = false;
    c.onFrameMove(0, 0.1);
    expect([sound.plays, c.m_bMouseOverCheck]).toEqual([1, false]);
    c.m_bMouseOver = true;
    c.onFrameMove(0, 0.1);
    expect(sound.plays).toBe(2);
  });

  test("a hidden or disabled box does nothing", () => {
    const { c, sound } = combo();
    c.m_bMouseOver = true;
    c.m_bShow = false;
    c.onFrameMove(0, 0.1);
    c.m_bShow = true;
    c.m_bEnable = false;
    c.onFrameMove(0, 0.1);
    expect([sound.plays, c.m_bMouseOverCheck, c.m_fElapsedTime, corners(c.m_NowPoint)]).toEqual([0, false, 0, [0, 0, 0, 0, 0, 0, 0, 0]]);
  });
});

describe("CKTDGUIListBox::OnFrameMove (32943980)", () => {
  const item = (extra: Partial<ListBoxItem> = {}): ListBoxItem => ({
    strText: "abc", pData: null, rcActive: newRect(), bSelected: false, pControl: null, itemType: 0, itemDepth: 0, bSpread: false, fSpreadTimeGap: 0,
    iSpreadCount: 0, fNowSpreadTime: 0, m_bShow: true, m_fTimeLeftShow: -1, m_color: new Color(1, 1, 1, 1),
    m_bColor: false, m_bMegaSelect: false, m_bMegaOver: false, m_bMyMessage: false, m_wstrData: "", m_iMessageID: -1, ...extra,
  });
  function box() {
    const s = setup();
    const b = new CKTDGUIListBox(s.w);
    setRect(b.m_rcBoundingBox, 10, 20, 110, 220);
    return { ...s, b };
  }

  test("the corners are the bounding box moved right by the scroll bar's width; the group mark, the bar and the rows' controls are moved too", () => {
    const { w, b } = box();
    const bar = new CKTDGUIScrollBar(w);
    bar.m_width = 12;
    b.m_pScrollBar = bar;
    b.m_pGroupMark.m_fChangeTime = 2;
    b.m_pGroupMark.m_GoalPos.set(4, 0);
    const control = new CKTDGUINavigation(w);
    b.m_Items.push(item({ pControl: control }), item());
    expect(b.onFrameMove(0, 0.5)).toBe(0);
    expect(corners(b.m_NowPoint)).toEqual([22, 20, 122, 20, 22, 220, 122, 220]);
    expect([b.m_fElapsedTime, bar.m_fElapsedTime, control.m_fElapsedTime, b.m_pGroupMark.m_fElapsedTime]).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(b.m_pGroupMark.m_OffsetPos.x).toBe(1); // 0 + (4 - 0) / (2 - 0) * 0.5
    const bare = box().b; // without a bar: the box itself
    bare.onFrameMove(0, 0.5);
    expect(corners(bare.m_NowPoint)).toEqual([10, 20, 110, 20, 10, 220, 110, 220]);
  });

  test("a row's show time counts down and hides it when it is below 0 (exactly 0 does not); -1 is no limit", () => {
    const { b } = box();
    const rows = [item({ m_fTimeLeftShow: 0.5 }), item({ m_fTimeLeftShow: 0.5 }), item({ m_fTimeLeftShow: -1 }), item({ m_fTimeLeftShow: 0 })];
    b.m_Items.push(...rows);
    b.onFrameMove(0, 0.25);
    expect(rows.map((r) => [r.m_fTimeLeftShow, r.m_bShow])).toEqual([[0.25, true], [0.25, true], [-1, true], [0, true]]);
    b.onFrameMove(0, 0.25); // 0.25 - 0.25 = 0: not below 0
    expect(rows.map((r) => [r.m_fTimeLeftShow, r.m_bShow])).toEqual([[0, true], [0, true], [-1, true], [0, true]]);
    const late = item({ m_fTimeLeftShow: 0.5 });
    b.m_Items.push(late);
    b.onFrameMove(0, 0.75); // 0.5 - 0.75 < 0: 0 and hidden
    expect([late.m_fTimeLeftShow, late.m_bShow]).toEqual([0, false]);
  });

  test("a spreading row shows one more character each time the gap is passed (0.5 is not above 0.5) and stops when it has shown all; no colour codes are skipped", () => {
    const { b } = box();
    const row = item({ strText: "#CXab", bSpread: true, fSpreadTimeGap: 0.5 });
    b.m_Items.push(row);
    b.onFrameMove(0, 0.25);
    b.onFrameMove(0, 0.25);
    expect([row.fNowSpreadTime, row.iSpreadCount]).toEqual([0.5, 0]);
    b.onFrameMove(0, 0.25);
    expect([row.fNowSpreadTime, row.iSpreadCount]).toEqual([0, 1]);
    for (let i = 0; i < 4; i++) b.onFrameMove(0, 1);
    expect([row.iSpreadCount, row.bSpread]).toEqual([5, true]);
    b.onFrameMove(0, 1); // 5 >= 5: done
    expect([row.iSpreadCount, row.bSpread]).toEqual([5, false]);
  });

  test("a hidden or disabled list box does nothing, not even its group mark", () => {
    const { b } = box();
    b.m_pGroupMark.m_fChangeTime = 2;
    b.m_bShow = false;
    expect(b.onFrameMove(0, 1)).toBe(0);
    b.m_bShow = true;
    b.m_bEnable = false;
    b.onFrameMove(0, 1);
    expect([b.m_pGroupMark.m_fElapsedTime, b.m_fElapsedTime, corners(b.m_NowPoint)]).toEqual([0, 0, [0, 0, 0, 0, 0, 0, 0, 0]]);
  });
});

describe("CKTDGUIEditBox::OnFrameMove (329342D0) and CKTDGUIIMEEditBox::OnFrameMove (32939380)", () => {
  const point = (c: number[]) => {
    const p = new UIPointData();
    setCorners(p, c);
    return p;
  };
  const rc = (r: { left: number; top: number; right: number; bottom: number }) => [r.left, r.top, r.right, r.bottom];

  test("edit box: the text rectangle is the text point's left-top and right-bottom corners cut to ints; with a background the normal point is also the end point; the current point is that point", () => {
    const { w } = setup();
    const e = new CKTDGUIEditBox(w);
    e.m_pTextPoint = point([10.9, 20.9, 0, 0, 0, 0, 110.5, 40.5]);
    e.m_pNormalPoint = point([1, 2, 3, 4, 5, 6, 7, 8]);
    e.m_pNormalPoint.fChangeTime = 3;
    e.m_pNormalPoint.color.set(0.5, 0.25, 1, 0.125);
    expect(e.onFrameMove(0, 0.5)).toBe(0);
    // without a background the text point is the current point; the end point is not touched
    expect(rc(e.m_rcText)).toEqual([10, 20, 110, 40]);
    expect(corners(e.m_NowPoint)).toEqual(corners(e.m_pTextPoint));
    expect(corners(e.m_EndPoint)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(e.m_fElapsedTime).toBe(0.5);
    e.m_bBGCheck = true;
    e.onFrameMove(0, 0.5);
    expect(corners(e.m_NowPoint)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(corners(e.m_EndPoint)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([e.m_NowPoint.fChangeTime, e.m_EndPoint.fChangeTime, ...rgba(e.m_NowPoint.color)]).toEqual([3, 3, 0.5, 0.25, 1, 0.125]);
    expect(rc(e.m_rcText)).toEqual([10, 20, 110, 40]);
    e.m_pTextPoint.leftTopPoint.set(-3.7, -0.5); // (int) cuts towards 0
    e.onFrameMove(0, 0.5);
    expect([e.m_rcText.left, e.m_rcText.top]).toEqual([-3, 0]);
  });

  test("edit box and IME edit box move like a control and keep the frame time as a float", () => {
    for (const make of [() => new CKTDGUIEditBox(setup().w), () => new CKTDGUIIMEEditBox(setup().w)]) {
      const e = make();
      e.m_pTextPoint = point([0, 0, 0, 0, 0, 0, 1, 1]);
      e.m_fChangeTime = 2;
      e.m_GoalPos.set(4, 0);
      e.onFrameMove(0, 0.1);
      expect(e.m_fElapsedTime).toBe(f(0.1));
      expect(e.m_OffsetPos.x).toBe(f(f(0.1) * 2)); // (4 - 0) * (1 / 2) * 0.1f
    }
  });

  test("edit box: a disabled one does nothing; a point it needs and does not have is a null dereference in the exe (an Error here)", () => {
    const { w } = setup();
    const e = new CKTDGUIEditBox(w);
    e.m_bEnable = false;
    e.onFrameMove(0, 0.5);
    expect(e.m_fElapsedTime).toBe(0);
    e.m_bEnable = true;
    expect(() => e.onFrameMove(0, 0.5)).toThrow("text point");
    e.m_pTextPoint = point([0, 0, 0, 0, 0, 0, 1, 1]);
    e.m_bBGCheck = true;
    expect(() => e.onFrameMove(0, 0.5)).toThrow("normal point");
  });

  test("IME edit box: the text rectangle is moved by the box's offset (cut to ints) and the offset of the text is 0 without the centring alignment", () => {
    const { w } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    e.m_pTextPoint = point([10.9, 20.9, 0, 0, 0, 0, 110.5, 40.5]);
    e.m_OffsetPos.set(5.9, -2.9);
    e.m_ptTextAlignOffset.x = 99;
    e.m_ptTextAlignOffset.y = 99;
    expect(e.onFrameMove(0, 0.5)).toBe(0);
    // (int)5.9 = 5 and (int)-2.9 = -2: left 5 + 10, top -2 + 20, right 5 + 110, bottom -2 + 40
    expect(rc(e.m_rcText)).toEqual([15, 18, 115, 38]);
    expect([e.m_ptTextAlignOffset.x, e.m_ptTextAlignOffset.y]).toEqual([0, 0]);
    expect(corners(e.m_NowPoint)).toEqual(corners(e.m_pTextPoint));
    e.m_DefTextAlign = 2; // bit 0 is not set: no centring
    e.m_ptTextAlignOffset.x = 99;
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(0);
    e.m_pNormalPoint = point([1, 2, 3, 4, 5, 6, 7, 8]);
    e.m_pDisablePoint = point([9, 9, 9, 9, 9, 9, 9, 9]);
    e.m_bBGCheck = true;
    e.onFrameMove(0, 0.5);
    expect(corners(e.m_EndPoint)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    e.m_bEnable = false; // unlike the edit box, a disabled IME box moves: with its disabled point
    e.onFrameMove(0, 0.5);
    expect(corners(e.m_EndPoint)).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
    expect(corners(e.m_NowPoint)).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
  });

  test("IME edit box: with the centring alignment (bit 0 of m_DefTextAlign) the text is centred when it fits the text rectangle: (int)((right - left of the point) * 0.5 - (x of the end - x of the first visible) * 0.5)", () => {
    const { w } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    // without a font CPtoX is 0 (the exe's answer for a buffer without a font): (51 - 10) * 0.5 - 0 = 20.5, cut to 20
    e.m_pTextPoint = point([10, 20, 51, 20, 10, 40, 110.5, 40.5]);
    for (const [align, offset] of [[1, 20], [3, 20], [2, 0], [0, 0], [0xffffffff, 0]] as const) {
      e.m_DefTextAlign = align;
      e.m_ptTextAlignOffset.x = 99;
      e.onFrameMove(0, 0.5);
      expect([align, e.m_ptTextAlignOffset.x, e.m_ptTextAlignOffset.y]).toEqual([align, offset, 0]);
    }
    // a text that is wider than the rectangle (here: a rectangle of negative width, the width being measured as 0) is not centred
    e.m_DefTextAlign = 1;
    e.m_pTextPoint = point([10, 20, 51, 20, 10, 40, 5, 40.5]);
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(0);
    e.m_pTextPoint = point([10, 20, 51, 20, 10, 40, 10, 40.5]); // a rectangle of width 0 holds a text of width 0
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(20);
  });

  test("IME edit box: the centring offset is (width of the point) * 0.5 - (x of the end - x of the first visible) * 0.5 cut to an int, and 0 when the text is wider than the rectangle", () => {
    const { w } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    e.m_pTextPoint = point([10, 20, 51, 20, 10, 40, 110, 40]); // the rectangle is 10 .. 110 (100 wide), the point is 41 wide
    e.m_DefTextAlign = 1;
    e.m_Buffer.SetText("abcd");
    e.m_Buffer.CPtoX = ((cp: number) => cp * 8) as typeof e.m_Buffer.CPtoX; // a font of 8 pixels a character
    e.m_nFirstVisible = 1;
    e.onFrameMove(0, 0.5);
    // the text is CPtoX(4) = 32 wide and fits; the end is at 32, the first visible character at 8: (51 - 10) * 0.5 - (32 - 8) * 0.5 = 20.5 - 12 = 8.5, cut to 8
    expect(e.m_ptTextAlignOffset.x).toBe(8);
    e.m_nFirstVisible = 3; // (32 - 24) * 0.5 = 4: 20.5 - 4 = 16.5, cut to 16
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(16);
    e.m_Buffer.CPtoX = ((cp: number) => cp * 40) as typeof e.m_Buffer.CPtoX; // 160 wide: wider than 100
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(0);
    e.m_Buffer.CPtoX = ((cp: number) => cp * 25) as typeof e.m_Buffer.CPtoX; // exactly 100 wide: it fits (not wider)
    e.m_nFirstVisible = 0;
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(f(20.5 - 50) | 0); // (51 - 10) * 0.5 - (100 - 0) * 0.5 = -29.5, cut towards 0: -29
  });

  test("IME edit box: a buffer with a font is centred by the widths the font gives (CKTDGUIUniBuffer::CPtoX); a hidden box does nothing; missing points are Errors", () => {
    const fw = fontWorld();
    const w = fw.w;
    const e = new CKTDGUIIMEEditBox(w);
    e.m_bShow = false;
    e.onFrameMove(0, 0.5);
    expect(e.m_fElapsedTime).toBe(0);
    e.m_bShow = true;
    expect(() => e.onFrameMove(0, 0.5)).toThrow("text point");
    e.m_pTextPoint = point([10, 20, 51, 20, 10, 40, 110, 40]); // the rectangle is 10 .. 110, the point 41 wide
    const ft = fw.font(16, 0, 1, true); // the box font: A is 9 wide, B 11 (back buffer pixels, the scale is 1.5)
    expect(ft.Load()).toBe(true);
    e.m_Buffer.m_pFontNode = w.fonts.addUKFont(1, ft);
    e.m_Buffer.SetText("AB");
    e.m_DefTextAlign = 2; // no centring: the font is not asked
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(0);
    e.m_DefTextAlign = 1;
    // CPtoX(2) = 20 / 1.5 = 13.33 -> 13 at the end, 0 at the first visible character: (51 - 10) * 0.5 - (13 - 0) * 0.5 = 20.5 - 6.5 = 14
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(14);
    e.m_nFirstVisible = 1; // CPtoX(1) = 9 / 1.5 = 6: 20.5 - (13 - 6) * 0.5 = 17
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(17);
    e.m_DefTextAlign = 3;
    e.onFrameMove(0, 0.5);
    expect(e.m_ptTextAlignOffset.x).toBe(17);
    e.m_DefTextAlign = 0xffffffff;
    e.m_bBGCheck = true;
    expect(() => e.onFrameMove(0, 0.5)).toThrow("point for its state");
  });
});

describe("CKTDGUISlot::OnFrameMove (32952430)", () => {
  function slot() {
    const s = setup();
    const c = new CKTDGUISlot(s.w);
    c.m_pNormalPoint = new UIPointData();
    c.m_pMouseOverPoint = new UIPointData();
    const sound = new DeviceSound("OVER.OGG", false);
    c.m_pSndMouseOver = sound;
    return { ...s, c, sound };
  }
  const { NORMAL: N, DOWN: D, MOUSEOVER: O, ONDRAG: G, DISABLE: X } = SCS;
  interface Flags { over?: boolean; enable?: boolean; focus?: boolean }
  const run = (state: number, flags: Flags) => {
    const { c, sound } = slot();
    c.m_eControlState = state;
    c.m_bMouseOver = flags.over ?? false;
    c.m_bEnable = flags.enable ?? true;
    c.m_bHasFocus = flags.focus ?? false;
    CKTDGUISlot.s_pDragSlot = state === G ? c : null;
    expect(c.onFrameMove(0, 0.1)).toBe(0);
    const dragging = CKTDGUISlot.s_pDragSlot === null;
    CKTDGUISlot.s_pDragSlot = null;
    return [c.m_eControlState, sound.plays, dragging];
  };

  test("normal: the mouse over enters mouse over and plays the sound (without looking at enabling); otherwise a slot that is not enabled is disabled", () => {
    expect(run(N, {})).toEqual([N, 0, true]);
    expect(run(N, { over: true })).toEqual([O, 1, true]);
    expect(run(N, { enable: false })).toEqual([X, 0, true]);
    expect(run(N, { over: true, enable: false })).toEqual([O, 1, true]);
  });

  test("down: back to normal when the mouse left, disabled when not enabled and the mouse is still over", () => {
    expect(run(D, { over: true })).toEqual([D, 0, true]);
    expect(run(D, {})).toEqual([N, 0, true]);
    expect(run(D, { over: true, enable: false })).toEqual([X, 0, true]);
    expect(run(D, { enable: false })).toEqual([N, 0, true]);
  });

  test("mouse over: stays while the mouse is over, back to normal when it left, disabled when not enabled", () => {
    expect(run(O, { over: true })).toEqual([O, 0, true]);
    expect(run(O, {})).toEqual([N, 0, true]);
    expect(run(O, { over: true, enable: false })).toEqual([X, 0, true]);
    expect(run(O, { enable: false })).toEqual([N, 0, true]);
  });

  test("on drag: a slot with the focus stays (disabled when not enabled); one that lost the focus returns the dragged item and is normal", () => {
    expect(run(G, { focus: true })).toEqual([G, 0, false]);
    expect(run(G, { focus: true, enable: false })).toEqual([X, 0, false]);
    expect(run(G, {})).toEqual([N, 0, true]);
    expect(run(G, { enable: false })).toEqual([N, 0, true]);
  });

  test("disabled: normal once enabled; the guide text only with m_bShowDescriptionWhenDisable and the mouse over", () => {
    expect(run(X, {})).toEqual([N, 0, true]);
    expect(run(X, { enable: false })).toEqual([X, 0, true]);
    const { c, w } = slot();
    const d = new CKTDGUIDialog(w);
    const asked = askedFor(d);
    d.AddControl(c);
    c.m_GuideDesc = "hint";
    c.m_eControlState = X;
    c.m_bEnable = false;
    c.m_bMouseOver = true;
    c.onFrameMove(0, 0.1);
    expect(asked.length).toBe(0);
    c.m_bShowDescriptionWhenDisable = true;
    c.onFrameMove(0, 0.1);
    expect([asked.length, asked[0] === c]).toEqual([1, true]);
    c.m_eControlState = O; // mouse over asks every frame
    c.m_bShowDescriptionWhenDisable = false;
    c.onFrameMove(0, 0.1);
    expect(asked.length).toBe(2);
    c.m_eControlState = 9; // a state it does not know
    c.onFrameMove(0, 0.1);
    expect(asked.length).toBe(2);
  });

  test("ReturnDraggingItem (329534A0): the dragged slot is normal again (forced: the texture animation is not started again) and nobody drags; nothing dragged: nothing happens", () => {
    const { c } = slot();
    CKTDGUISlot.returnDraggingItem();
    c.m_eControlState = G;
    c.m_cNormalSlotColor.set(0.5, 0.5, 0.5, 0.5);
    c.m_NowTexChangeData.m_fShowTime = 3;
    c.m_NowTexChangeData.m_SequenceID = 2;
    CKTDGUISlot.s_pDragSlot = c;
    CKTDGUISlot.returnDraggingItem();
    expect([c.m_eControlState, CKTDGUISlot.s_pDragSlot === null, c.m_Color.r]).toEqual([N, true, 0.5]);
    expect([c.m_NowTexChangeData.m_fShowTime, c.m_NowTexChangeData.m_SequenceID]).toEqual([3, 2]);
  });

  test("a slot moves like a control: the offset approaches the goal", () => {
    const { c } = slot();
    c.m_fChangeTime = 2;
    c.m_GoalPos.set(4, 0);
    c.onFrameMove(0, 1);
    expect([c.m_fElapsedTime, c.m_OffsetPos.x]).toEqual([1, 2]);
  });

  test("leaving mouse over sends m_CustomMsgMouseOut once (the state change to normal clears m_bMouseOut)", () => {
    const { c, w, stage, stageLog } = slot();
    const d = new CKTDGUIDialog(w);
    d.m_pStage = stage;
    d.AddControl(c);
    c.m_CustomMsgMouseOut = 6;
    c.m_eControlState = O;
    c.onFrameMove(0, 0.1);
    expect([c.m_eControlState, c.m_bMouseOut]).toEqual([N, false]);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 6]]);
  });

  test("a dragged slot that lost the focus is normal after the dragged item went home, whichever slot that was", () => {
    const { c } = slot();
    c.m_eControlState = G;
    CKTDGUISlot.s_pDragSlot = null; // nothing is dragged: the slot goes normal on its own
    c.onFrameMove(0, 0.1);
    expect(c.m_eControlState).toBe(N);
    const other = slot().c; // another slot is dragged: it goes home and this one is normal too
    other.m_eControlState = G;
    c.m_eControlState = G;
    CKTDGUISlot.s_pDragSlot = other;
    c.onFrameMove(0, 0.1);
    expect([c.m_eControlState, other.m_eControlState, CKTDGUISlot.s_pDragSlot === null]).toEqual([N, N, true]);
  });

  test("updated slot data refreshes the slot (UpdateUI) once; the points move; the mouse over is lost behind a dialog that is not modal", () => {
    const { c, w } = slot();
    const calls: unknown[] = [];
    const data = { m_bDataUpdated: false, UpdateUI: (slot: CKTDGUISlot) => void calls.push(slot), Destroy: () => {} };
    c.m_pSlotData = data;
    c.onFrameMove(0, 0.1);
    expect(calls.length).toBe(0);
    data.m_bDataUpdated = true;
    c.onFrameMove(0, 0.1);
    expect([calls.length, calls[0] === c, data.m_bDataUpdated]).toEqual([1, true, false]);
    c.onFrameMove(0, 0.1);
    expect(calls.length).toBe(1);
    setCorners(c.m_NowPoint, [0, 0, 0, 0, 0, 0, 0, 0]);
    setCorners(c.m_EndPoint, [8, 0, 0, 0, 0, 0, 0, 0]);
    c.m_EndPoint.fChangeTime = 4;
    c.m_NowPoint.fChangeTime = 0;
    c.onFrameMove(0, 1);
    expect(c.m_NowPoint.leftTopPoint.x).toBe(2);
    const { back } = stacked(w);
    back.AddControl(c);
    c.m_bMouseOver = true;
    c.onFrameMove(0, 0.1);
    expect([c.m_bMouseOver, c.m_eControlState]).toEqual([false, N]);
  });

  test("the additional pictures that are shown move, in the order of their keys", () => {
    const { c, w } = slot();
    const order: number[] = [];
    for (const [key, shown] of [[9, true], [2, true], [5, false], [4, true]] as const) {
      const p = new CPictureData(w);
      p.bShow = shown;
      p.onFrameMove = () => void order.push(key);
      c.m_mapAdditionalPictureDataList.set(key, p);
    }
    c.onFrameMove(0, 0.1);
    expect(order).toEqual([2, 4, 9]);
    c.m_bShow = false;
    order.length = 0;
    c.onFrameMove(0, 0.1);
    expect(order).toEqual([]);
  });
});


describe("CKTDGUIDialog::OnFrameMove (32958A00)", () => {
  function dlg(extra: Parameters<typeof setup>[1] = {}) {
    const s = setup(new StringTable([]), extra);
    const d = new CKTDGUIDialog(s.w);
    return { ...s, d };
  }
  /** a control that writes down that its `OnFrameMove` was called */
  function spy(w: ReturnType<typeof setup>["w"], log: string[], name: string): CKTDGUIControl {
    const c = new CKTDGUINavigation(w);
    c.m_Name = name;
    c.onFrameMove = () => {
      log.push(name);
      return 0;
    };
    return c;
  }

  test("a dialog that is shown and enabled moves its position towards the goal; the colour jumps to the goal without m_bFadeInOut and goes there with it", () => {
    const { d } = dlg();
    d.m_bFadeInOut = false;
    d.m_GoalPos.set(8, -4);
    d.m_fChangeTime = 2;
    d.m_Color.set(1, 1, 1, 1);
    d.m_GoalColor.set(0, 0.5, 1, 0.25);
    // frame 1: k = 1 / (2 - 0) = 0.5: (0 + 8 * 0.5 * 1, 0 + (-4) * 0.5 * 1) = (4, -2)
    expect(d.onFrameMove(0, 1)).toBe(0);
    expect([d.m_Pos.x, d.m_Pos.y, d.m_fAnimateTime, ...rgba(d.m_Color)]).toEqual([4, -2, 1, 0, 0.5, 1, 0.25]);
    // frame 2: k = 1 / (2 - 1) = 1: (4 + 4, -2 + (-2)) = (8, -4)
    d.onFrameMove(0, 1);
    expect([d.m_Pos.x, d.m_Pos.y, d.m_fAnimateTime]).toEqual([8, -4, 2]);
    // frame 3: the animate time is not below the change time: the position is the goal; no auto-delete
    d.onFrameMove(0, 1);
    expect([d.m_Pos.x, d.m_Pos.y, d.m_fAnimateTime, d.m_fChangeTime, d.m_bCheckAutoDeleteEnd]).toEqual([8, -4, 0, 0, false]);
    const f2 = dlg().d;
    f2.m_bFadeInOut = true;
    f2.m_GoalPos.set(8, -4);
    f2.m_fChangeTime = 2;
    f2.m_Color.set(1, 1, 1, 1);
    f2.m_GoalColor.set(0, 0.5, 1, 0.25);
    // the colour approaches like the position: r 1 + (0 - 1) * 0.5 = 0.5, g 1 + (0.5 - 1) * 0.5 = 0.75, b 1, a 1 + (0.25 - 1) * 0.5 = 0.625; then k = 1: 0, 0.5, 1, 0.25
    f2.onFrameMove(0, 1);
    expect(rgba(f2.m_Color)).toEqual([0.5, 0.75, 1, 0.625]);
    f2.onFrameMove(0, 1);
    expect(rgba(f2.m_Color)).toEqual([0, 0.5, 1, 0.25]);
  });

  test("the end of a move that was an auto-delete move marks the dialog; the queue gives the next move in the same frame", () => {
    const { d } = dlg();
    d.m_bAutoDelete = true;
    d.m_fChangeTime = 1;
    d.m_GoalPos.set(2, 2);
    d.m_queMoveItems.push({ pos: new Vec2(6, 8), color: new Color(0.5, 0.25, 0.125, 0.0625), fChangeTime: 4, bIsAutoDelete: false });
    d.onFrameMove(0, 1); // pos (2, 2): k = 1; the queue waits while the dialog moves
    expect([d.m_Pos.x, d.m_Pos.y, d.m_queMoveItems.length, d.m_bCheckAutoDeleteEnd]).toEqual([2, 2, 1, false]);
    d.onFrameMove(0, 1); // the end: marked, and the next item is the goal
    expect([d.m_bCheckAutoDeleteEnd, d.m_GoalPos.x, d.m_GoalPos.y, ...rgba(d.m_GoalColor), d.m_fChangeTime, d.m_bAutoDelete, d.m_queMoveItems.length])
      .toEqual([true, 6, 8, 0.5, 0.25, 0.125, 0.0625, 4, false, 0]);
    d.onFrameMove(0, 1); // k = 1 / 4: x = 2 + (6 - 2) * 0.25 = 3, y = 2 + (8 - 2) * 0.25 = 3.5
    expect([d.m_Pos.x, d.m_Pos.y]).toEqual([3, 3.5]);
    // a dialog that is not moving takes the item at once, and its position stays
    const { d: e } = dlg();
    e.m_queMoveItems.push({ pos: new Vec2(6, 8), color: new Color(1, 1, 1, 1), fChangeTime: 3, bIsAutoDelete: true });
    e.onFrameMove(0, 1);
    expect([e.m_Pos.x, e.m_GoalPos.x, e.m_fChangeTime, e.m_bAutoDelete]).toEqual([0, 6, 3, true]);
  });

  test("the dialog's self-delete time counts from its making in whole milliseconds / 1000 and marks it when the time is passed (not reached), if there is one", () => {
    let now = 1000;
    const { d } = dlg({ tickCount: () => now });
    d.m_fTimeForSelfDelete = 2;
    now = 3000; // 2.0 s: not above 2
    d.onFrameMove(0, 0);
    expect(d.m_bCheckAutoDeleteEnd).toBe(false);
    now = 3001;
    d.onFrameMove(0, 0);
    expect(d.m_bCheckAutoDeleteEnd).toBe(true);
    const { d: e } = dlg({ tickCount: () => now });
    now = 99999999;
    e.onFrameMove(0, 0); // no self-delete time
    expect(e.m_bCheckAutoDeleteEnd).toBe(false);
  });

  test("a dialog that is hidden or disabled moves nothing: not its position, not the self-delete timer, not its controls", () => {
    const log: string[] = [];
    const { d, w } = dlg({ tickCount: () => 99999999 });
    d.AddControl(spy(w, log, "A"));
    d.m_fChangeTime = 2;
    d.m_GoalPos.set(8, 8);
    d.m_fTimeForSelfDelete = 1;
    d.m_TimerToSelfDelete._start_time = 0;
    d.m_bShow = false;
    expect(d.onFrameMove(0, 1)).toBe(0);
    d.m_bShow = true;
    d.m_bEnable = false;
    d.onFrameMove(0, 1);
    expect([log.length, d.m_Pos.x, d.m_fAnimateTime, d.m_bCheckAutoDeleteEnd]).toEqual([0, 0, 0, false]);
    d.m_bEnable = true;
    d.onFrameMove(0, 1);
    expect([log.length, d.m_Pos.x, d.m_fAnimateTime, d.m_bCheckAutoDeleteEnd]).toEqual([1, 4, 1, true]);
  });

  test("the controls are moved from the last to the first, and one that is out of the list is not", () => {
    const log: string[] = [];
    const { d, w } = dlg();
    for (const name of ["A", "B", "C", "D"]) d.AddControl(spy(w, log, name));
    d.m_ControlsMap.get("C")!.m_bOutofList = true;
    d.onFrameMove(0, 0.1);
    expect(log).toEqual(["D", "B", "A"]);
  });

  test("a control that is marked for deletion: found in the name map and the list it is destroyed (Destroy), its entry and its place in the list go and it is not moved; not in the map it is moved like the others", () => {
    const log: string[] = [];
    const { d, w } = dlg();
    const a = spy(w, log, "A"), b = spy(w, log, "B");
    a.Destroy = () => void log.push("destroy A");
    d.AddControl(a);
    d.AddControl(b);
    a.m_bCheckAutoDeleteEnd = true;
    expect(d.onFrameMove(0, 0.1)).toBe(0);
    expect([names(d.m_ControlsList), d.m_ControlsMap.size, d.m_ControlsMap.has("A"), d.m_ControlsMap.has("B"), log]).toEqual([["B"], 1, false, true, ["B", "destroy A"]]);
    // the map does not know it: it is moved like any other
    log.length = 0;
    const c = spy(w, log, "C");
    d.AddControl(c);
    c.m_bCheckAutoDeleteEnd = true;
    d.m_ControlsMap.erase("C");
    expect(d.onFrameMove(0, 0.1)).toBe(0);
    expect([names(d.m_ControlsList), d.m_ControlsMap.size, log]).toEqual([["B", "C"], 1, ["C", "B"]]);
    // the map has another control under its name, and that one is not in the list: the entry goes, the marked control is moved
    log.length = 0;
    const stranger = spy(w, log, "C");
    stranger.Destroy = () => void log.push("destroy stranger");
    d.m_ControlsMap.emplace("C", stranger);
    expect(d.onFrameMove(0, 0.1)).toBe(0);
    expect([names(d.m_ControlsList), d.m_ControlsMap.size, log]).toEqual([["B", "C"], 1, ["C", "B"]]);
    expect(d.m_ControlsMap.has("C")).toBe(false);
  });

  test("the control the map holds under the marked control's name is the one that is destroyed (and taken out of the list); the marked one stays, and as the list shifted it is looked at again, now that the map has lost the name: it is moved", () => {
    const log: string[] = [];
    const { d, w } = dlg();
    const first = spy(w, log, "X"), second = spy(w, log, "Y"), tail = spy(w, log, "T");
    first.Destroy = () => void log.push("destroy first");
    second.Destroy = () => void log.push("destroy second");
    d.AddControl(first);
    d.AddControl(second);
    d.AddControl(tail);
    second.m_Name = "X"; // the same name as the first control, which the map holds
    second.m_bCheckAutoDeleteEnd = true;
    d.onFrameMove(0, 0.1);
    // the list is walked from the end: T; second is marked and the map's X is `first` (index 0): destroyed and taken out, nobody moved; index 0 is now
    // `second` again, marked, but the map has no X any more: it is moved
    expect(log).toEqual(["T", "destroy first", "Y"]);
    expect([names(d.m_ControlsList), d.m_ControlsMap.size, d.m_ControlsMap.has("X"), d.m_ControlsMap.has("Y")]).toEqual([["X", "T"], 2, false, true]); // `second` (named X now) and T; the map keeps its stale Y and T
  });

  test("a control that is destroyed by the dialog and has the focus loses it first (OnFocusOut); one that does not have it leaves the focus where it is", () => {
    const log: string[] = [];
    const { d, w } = dlg();
    const a = spy(w, log, "A"), b = spy(w, log, "B");
    a.Destroy = () => void log.push("destroy A");
    a.onFocusOut = () => void log.push("out A");
    b.onFocusOut = () => void log.push("out B");
    d.AddControl(a);
    d.AddControl(b);
    w.controlFocus = b;
    a.m_bCheckAutoDeleteEnd = true;
    d.onFrameMove(0, 0.1);
    expect([log, is(w.controlFocus, b)]).toEqual([["B", "destroy A"], true]);
    log.length = 0;
    const c = spy(w, log, "C");
    c.Destroy = () => void log.push("destroy C");
    c.onFocusOut = () => void log.push("out C");
    d.AddControl(c);
    w.controlFocus = c;
    c.m_bCheckAutoDeleteEnd = true;
    d.onFrameMove(0, 0.1);
    expect([log, is(w.controlFocus, null)]).toEqual([["out C", "destroy C", "B"], true]);
    w.controlFocus = null;
  });

  test("a dialog that can be dragged inside a range is held inside it: the range's rectangle shrunk by half the dialog's size; the goal follows while it moves", () => {
    const { d } = dlg();
    d.m_bEnableMoveByDrag = true;
    d.m_bEnableDraggingRange = true;
    d.m_vDraggingRange.set(100, 60);
    d.m_vDraggingRangeCenter.set(200, 100);
    d.m_vSize.set(20, 10);
    // x in [(200 - 50) - 10, (200 + 50) - 10] = [140, 240]; y in [(100 - 30) - 5, (100 + 30) - 5] = [65, 125]
    for (const [pos, want] of [[[100, 200], [140, 125]], [[300, 10], [240, 65]], [[150, 70], [150, 70]], [[140, 65], [140, 65]], [[240, 125], [240, 125]]] as const) {
      d.m_Pos.set(pos[0], pos[1]);
      d.m_GoalPos.set(1, 2);
      d.onFrameMove(0, 0);
      expect([d.m_Pos.x, d.m_Pos.y, d.m_GoalPos.x, d.m_GoalPos.y]).toEqual([want[0], want[1], 1, 2]);
    }
    // while it moves (change time above the animate time) the goal is the clamped position; elapsed 0 keeps the position where it is
    d.m_fChangeTime = 4;
    d.m_fAnimateTime = 1;
    d.m_Pos.set(300, 10);
    d.m_GoalPos.set(1, 2);
    d.onFrameMove(0, 0);
    expect([d.m_Pos.x, d.m_Pos.y, d.m_GoalPos.x, d.m_GoalPos.y]).toEqual([240, 65, 240, 65]);
    // not without the range, not without the drag
    const e = dlg().d;
    e.m_bEnableMoveByDrag = true;
    e.m_vSize.set(20, 10);
    e.m_Pos.set(5000, 5000);
    e.onFrameMove(0, 0);
    expect([e.m_Pos.x, e.m_Pos.y]).toEqual([5000, 5000]);
    e.m_bEnableMoveByDrag = false;
    e.m_bEnableDraggingRange = true;
    e.onFrameMove(0, 0);
    expect([e.m_Pos.x, e.m_Pos.y]).toEqual([5000, 5000]);
  });

  test("the guide text: its static is hidden, its dialog is hidden (with the modal count made again) and a slot dragged in it is returned", () => {
    const { d, w } = dlg();
    const manager = w.dialogManager;
    const guide = new CKTDGUIDialog(w);
    guide.m_bModal = false;
    guide.m_pkUIDialogManager = manager;
    const inner = new CKTDGUIDialog(w);
    inner.m_bModal = false;
    guide.m_pDialogGuideDesc = inner;
    d.m_pDialogGuideDesc = guide;
    const text = new CKTDGUIStatic(w);
    d.m_pStaticGuideDesc = text;
    manager.m_iModalDialogCount = 99;
    d.onFrameMove(0, 0);
    expect([text.m_bShow, guide.m_bShow, inner.m_bShow, manager.m_iModalDialogCount]).toEqual([false, false, false, 0]);
    // already hidden: the count is left alone
    manager.m_iModalDialogCount = 99;
    d.onFrameMove(0, 0);
    expect(manager.m_iModalDialogCount).toBe(99);
    // a modal guide dialog does not recount
    guide.m_bShow = true;
    guide.m_bModal = true;
    d.onFrameMove(0, 0);
    expect([guide.m_bShow, manager.m_iModalDialogCount]).toEqual([false, 99]);
    // a guide dialog that is not modal and knows no manager has nobody to count the dialogs again
    guide.m_bShow = true;
    guide.m_bModal = false;
    guide.m_pkUIDialogManager = null;
    d.onFrameMove(0, 0);
    expect([guide.m_bShow, manager.m_iModalDialogCount]).toEqual([false, 99]);
    guide.m_pkUIDialogManager = manager;
    // the slot dragged in the guide dialog goes home, even when the dialog was already hidden
    const slot = new CKTDGUISlot(w);
    slot.m_pNormalPoint = new UIPointData();
    slot.m_eControlState = SCS.ONDRAG;
    guide.AddControl(slot);
    CKTDGUISlot.s_pDragSlot = slot;
    d.onFrameMove(0, 0);
    expect([slot.m_eControlState, CKTDGUISlot.s_pDragSlot === null]).toEqual([SCS.NORMAL, true]);
    // a slot dragged in another dialog stays
    const other = new CKTDGUISlot(w);
    other.m_eControlState = SCS.ONDRAG;
    other.m_bHasFocus = true; // (a dragged slot that lost the focus returns itself in its own OnFrameMove)
    d.AddControl(other);
    CKTDGUISlot.s_pDragSlot = other;
    d.onFrameMove(0, 0);
    expect([other.m_eControlState, CKTDGUISlot.s_pDragSlot === other]).toEqual([SCS.ONDRAG, true]);
    CKTDGUISlot.s_pDragSlot = null;
  });

  test("SetShow (3295B900): hiding hides the guide dialog and counts the modal dialogs again (not modal ones, with a manager), and so does showing (which also takes the mouse: mouse.test.ts); a hidden dialog returns its dragged slot", () => {
    const { d, w } = dlg();
    const manager = w.dialogManager;
    d.m_pkUIDialogManager = manager;
    d.m_bModal = false;
    const guide = new CKTDGUIDialog(w);
    d.m_pDialogGuideDesc = guide;
    manager.m_iModalDialogCount = 99;
    d.setShow(true); // no change: nothing happens
    expect([d.m_bShow, manager.m_iModalDialogCount]).toEqual([true, 99]);
    d.setShow(false);
    expect([d.m_bShow, guide.m_bShow, manager.m_iModalDialogCount]).toEqual([false, false, 0]);
    manager.m_iModalDialogCount = 99;
    d.setShow(true); // the guide dialog stays hidden; the manager counts again; the mouse is over nothing
    expect([d.m_bShow, guide.m_bShow, manager.m_iModalDialogCount, d.m_pControlMouseOver]).toEqual([true, false, 0, null]);
    // a modal dialog does not recount
    const m = dlg().d;
    m.m_pkUIDialogManager = manager;
    manager.m_iModalDialogCount = 99;
    m.setShow(false);
    expect(manager.m_iModalDialogCount).toBe(99);
    // the dragged slot
    const slot = new CKTDGUISlot(w);
    slot.m_pNormalPoint = new UIPointData();
    slot.m_eControlState = SCS.ONDRAG;
    d.AddControl(slot);
    CKTDGUISlot.s_pDragSlot = slot;
    d.setShow(false); // already hidden: the slot is still returned
    expect([slot.m_eControlState, CKTDGUISlot.s_pDragSlot === null]).toEqual([SCS.NORMAL, true]);
    // a slot dragged in another dialog stays where it is
    const away = new CKTDGUISlot(w);
    away.m_eControlState = SCS.ONDRAG;
    away.m_bHasFocus = true;
    dlg().d.AddControl(away);
    CKTDGUISlot.s_pDragSlot = away;
    d.setShow(false);
    expect([away.m_eControlState, CKTDGUISlot.s_pDragSlot === away]).toEqual([SCS.ONDRAG, true]);
    CKTDGUISlot.s_pDragSlot = null;
  });

});

describe("CKTDGUIDialogManager: CheckDlg (328DE0F0), CheckFrontModalDlg (328DE180), CountModalDialog (328DE4C0)", () => {
  function managed(n: number) {
    const { w } = setup();
    const manager = new CKTDGUIDialogManager(w);
    const dialogs = Array.from({ length: n }, () => {
      const d = new CKTDGUIDialog(w);
      d.m_bModal = false;
      d.m_pkUIDialogManager = manager;
      manager.m_setDialog.add(d);
      manager.m_listDialog.push(d);
      return d;
    });
    return { w, manager, dialogs };
  }

  test("constructor (328DD5F0): shown, cannot be hidden; GetHideDialog is m_bCanHide && !m_bShow", () => {
    const { w } = setup();
    const m = new CKTDGUIDialogManager(w);
    expect([m.m_bShow, m.m_bCanHide, m.getHideDialog(), m.m_iModalDialogCount]).toEqual([true, false, false, 0]);
    m.m_bCanHide = true;
    expect(m.getHideDialog()).toBe(false);
    m.m_bShow = false;
    expect(m.getHideDialog()).toBe(true);
    m.m_bCanHide = false;
    expect(m.getHideDialog()).toBe(false);
  });

  test("CheckDlg: a dialog the manager holds that knows its manager", () => {
    const { w, manager, dialogs } = managed(1);
    expect(manager.checkDlg(null)).toBe(false);
    expect(manager.checkDlg(dialogs[0]!)).toBe(true);
    expect(manager.checkDlg(new CKTDGUIDialog(w))).toBe(false);
    const stray = new CKTDGUIDialog(w); // one that knows the manager but is not in its set
    stray.m_pkUIDialogManager = manager;
    expect(manager.checkDlg(stray)).toBe(false);
    dialogs[0]!.m_pkUIDialogManager = null;
    expect(manager.checkDlg(dialogs[0]!)).toBe(false);
  });

  test("CheckFrontModalDlg: walks from the front one back to the pivot: a dialog in front that is shown, enabled and not modal makes it true", () => {
    const { manager, dialogs } = managed(3);
    const [a, b, c] = dialogs as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    expect(manager.checkFrontModalDlg(a)).toBe(true);
    expect(manager.checkFrontModalDlg(b)).toBe(true);
    expect(manager.checkFrontModalDlg(c)).toBe(false); // the pivot comes first
    c.m_bModal = true;
    expect(manager.checkFrontModalDlg(b)).toBe(false); // a modal one in front does not count; then the pivot
    expect(manager.checkFrontModalDlg(a)).toBe(true); // b is not modal
    c.m_bModal = false;
    c.m_bShow = false;
    expect(manager.checkFrontModalDlg(b)).toBe(false);
    c.m_bShow = true;
    c.m_bEnable = false;
    expect(manager.checkFrontModalDlg(b)).toBe(false);
    expect(manager.checkFrontModalDlg(null)).toBe(false);
  });

  test("CheckFrontModalDlg is false for a dialog the manager does not hold and for one that does not know its manager", () => {
    const { w, manager, dialogs } = managed(2);
    expect(manager.checkFrontModalDlg(new CKTDGUIDialog(w))).toBe(false);
    dialogs[0]!.m_pkUIDialogManager = null;
    expect(manager.checkFrontModalDlg(dialogs[0]!)).toBe(false);
    expect(new CKTDGUIDialogManager(w).checkFrontModalDlg(dialogs[0]!)).toBe(false);
  });

  test("CountModalDialog(dialog): +1 for a dialog that is not modal, shown and has no slot; (null): counted again over the list", () => {
    const { w, manager, dialogs } = managed(4);
    const [a, b, c, d] = dialogs as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    manager.countModalDialog(a);
    manager.countModalDialog(a);
    expect(manager.m_iModalDialogCount).toBe(2);
    b.m_bModal = true;
    manager.countModalDialog(b);
    c.m_bShow = false;
    manager.countModalDialog(c);
    d.m_bHasSlot = true;
    manager.countModalDialog(d);
    expect(manager.m_iModalDialogCount).toBe(2);
    manager.countModalDialog(null); // a (counts), b (modal), c (hidden), d (slot): 1
    expect(manager.m_iModalDialogCount).toBe(1);
    c.m_bShow = true;
    d.m_bHasSlot = false;
    b.m_bModal = false;
    manager.countModalDialog(null);
    expect(manager.m_iModalDialogCount).toBe(4);
    void w;
  });
});

describe("the keyboard (CKTDIDevice::GetKeyState 32962CF0, the lock loop of Read 32962ED0)", () => {
  test("a key that went down answers 1 once (it is locked); a key that is up answers 0", () => {
    const k = new UIKeyboard();
    expect(k.getKeyState(5)).toBe(0);
    k.m_State[5] = -128; // the high bit: down
    expect([k.getKeyState(5), k.getKeyState(5), k.getKeyState(6)]).toEqual([1, 0, 0]);
    expect([k.m_Locks[5], k.m_Locks[6]]).toEqual([1, 0]);
    k.m_State[0xff] = -1;
    expect(k.getKeyState(0xff)).toBe(1);
  });

  test("Read unlocks the keys that are up and keeps the ones that are still down locked", () => {
    const k = new UIKeyboard();
    k.m_State[5] = -128;
    k.m_State[6] = -128;
    k.getKeyState(5);
    k.getKeyState(6);
    k.m_State[6] = 0; // released
    k.unlockReleasedKeys();
    expect([k.m_Locks[5], k.m_Locks[6]]).toEqual([1, 0]);
    expect([k.getKeyState(5), k.getKeyState(6)]).toEqual([0, 0]);
    k.m_State[6] = -128; // pressed again
    expect(k.getKeyState(6)).toBe(1);
  });
});

describe("the input manager (CKTDIManager::CKTDIManager 328CF0E0)", () => {
  test("m_bEnabled is true at construction, in a world's too", () => {
    expect(new UIInputManager().m_bEnabled).toBe(true);
    expect(setup().w.diManager.m_bEnabled).toBe(true);
  });
});
