import { describe, expect, test } from "bun:test";
import { CKTDGUISlot, SCS, UIM, UIPointData } from "../src/index.ts";
import { setup } from "./harness.ts";
import { describeCases } from "./replay.ts";

/**
 * The input of the slot control: `CKTDGUISlot::HandleMouse` (329520A0: the focus request, the states DOWN / ONDRAG / MOUSEOVER, dropping the slot that is being
 * dragged, the custom messages and the two sounds), `OnFocusOut` (329523D0) and `GetGuideDescPos` (32951F20, with the control's own 329247A0 and
 * `GetIsGuideDescAbsolutePos` 329247E0), against the exe's own answers.
 *
 * `tools/oracle-slots.py` runs those functions of x2.exe on the Unicorn CPU emulator, on a dialog, a stage and slots built in its memory (the real vtable of the
 * class; `ChangeState` and `ReturnDraggingItem` are stubs that write the call down), and writes down for every message the return value, the calls
 * (`A.change(3,0)`: ChangeState(state, force), `returnDrag`, `A.sound(down)`, `stage(1127,11,A)`: the stage's MsgProc) and the state afterwards (the flag, the global
 * focus, the slot's state, the slot that was dropped on it, `s_pDragSlot`).  `slots-cases.json` is that script with the answers; `replay.ts` runs the same
 * steps on the TypeScript port.  The guide text's position is the middle of the mouse-over point's top edge plus the offset in single precision: the cases at
 * 16777216 show it.
 */
describeCases(
  "CKTDGUISlot HandleMouse / OnFocusOut / GetGuideDescPos against the exe's own answers (tools/oracle-slots.py)",
  "./slots-cases.json",
  ["act_ctl", "act_out", "act_guide"],
);

/**
 * The same functions with the REAL `ChangeState` (32950FB0), which the replay above stubs on both sides.  Every expected value is worked out by hand from
 * the decompile:
 *  - `ChangeState(state, bForce)`: `if (m_eControlState == state) { if (!bForce) return; m_eControlState = state; } else { m_eControlState = state; if (!bForce)
 *    <the texture animation is reset> }`, then by state: NORMAL (when `m_bMouseOut`: clear it and send `m_CustomMsgMouseOut` unless -1; the normal colour),
 *    DOWN (the normal colour), ONDRAG (`RequestFocus` unless it has the focus; `s_pDragSlot = this`; the dragged colour);
 *  - `OnFocusOut` 329523D0 writes the state BEFORE it calls `ChangeState(state, false)`, which therefore finds the state set and returns at once: nothing of
 *    the NORMAL branch runs (a pending mouse-out message is not sent, the colour stays);
 *  - `ReturnDraggingItem` 329534A0: `if (s_pDragSlot) { s_pDragSlot->ChangeState(NORMAL, true); s_pDragSlot = nullptr; }`.
 */
describe("CKTDGUISlot input with the real ChangeState", () => {
  /** the slot's place: the current point and the normal point (`ChangeState` copies the normal point to the end point and, with no transition time, the end point to
   * the current one: a slot without a normal point has the all-zero end point and loses its place at the first change) */
  const quad = (c: CKTDGUISlot, l: number, t: number, r: number, b: number): void => {
    const p = new UIPointData();
    for (const at of [c.m_NowPoint, p]) {
      at.leftTopPoint.set(l, t);
      at.rightTopPoint.set(r, t);
      at.leftBottomPoint.set(l, b);
      at.rightBottomPoint.set(r, b);
    }
    c.m_pNormalPoint = p;
  };
  const rgba = (c: { r: number; g: number; b: number; a: number }): number[] => [c.r, c.g, c.b, c.a];
  const rig = () => {
    const { w, dialog, stage, stageLog } = setup();
    const d = dialog();
    d.m_pStage = stage as never;
    d.m_pkUIDialogManager = w.dialogManager;
    w.dialogManager.m_setDialog.add(d);
    const a = new CKTDGUISlot(w);
    const b = new CKTDGUISlot(w);
    for (const [s, l, r] of [[a, 0, 40], [b, 50, 90]] as const) {
      quad(s, l, 0, r, 40);
      d.AddControl(s);
    }
    a.m_CustomMsgMouseDown = 7;
    b.m_CustomMsgDropped = 9;
    return { w, d, a, b, stageLog };
  };

  test("a press on a dragable slot takes the focus, drags it (the state ONDRAG, s_pDragSlot, the dragged colour) and sends the custom message; the slot is dropped on another: its message, the dragged slot goes back", () => {
    const { w, a, b, stageLog } = rig();
    expect(a.handleMouse(0x201, 20, 20, 0, 0)).toBe(true);
    expect([a.m_eControlState, CKTDGUISlot.s_pDragSlot === a, a.m_bHasFocus, w.controlFocus === a]).toEqual([SCS.ONDRAG, true, true, true]);
    expect(rgba(a.m_Color)).toEqual([1, 1, 1, Math.fround(0.4)]);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 7]]);
    stageLog.length = 0;
    expect(b.handleMouse(0x202, 60, 20, 0, 0)).toBe(true);
    expect(b.m_pDroppedSlot === a).toBe(true);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 9]]);
    expect([a.m_eControlState, CKTDGUISlot.s_pDragSlot === null, a.m_bHasFocus]).toEqual([SCS.NORMAL, true, true]);
    expect(rgba(a.m_Color)).toEqual([1, 1, 1, 1]);
    CKTDGUISlot.s_pDragSlot = null;
  });

  test("the button up on the slot that is dragged puts it back; the right button down on it puts it back too and presses it (DOWN)", () => {
    const { a, stageLog } = rig();
    a.handleMouse(0x201, 20, 20, 0, 0);
    stageLog.length = 0;
    expect(a.handleMouse(0x202, 20, 20, 0, 0)).toBe(true);
    expect([a.m_eControlState, CKTDGUISlot.s_pDragSlot === null]).toEqual([SCS.NORMAL, true]);
    expect(stageLog).toEqual([]);
    a.handleMouse(0x201, 20, 20, 0, 0);
    expect(a.m_eControlState).toBe(SCS.ONDRAG);
    expect(a.handleMouse(0x204, 20, 20, 0, 0)).toBe(true);
    expect([a.m_eControlState, CKTDGUISlot.s_pDragSlot === null]).toEqual([SCS.DOWN, true]);
    CKTDGUISlot.s_pDragSlot = null;
  });

  test("OnFocusOut writes the state before ChangeState, which then returns at once: a pending mouse-out is neither cleared nor sent, the colour stays, the animation is not reset", () => {
    const { a, stageLog } = rig();
    a.m_eControlState = SCS.DOWN;
    a.m_bHasFocus = true;
    a.m_bMouseOut = true;
    a.m_CustomMsgMouseOut = 6;
    a.m_Color.set(0.5, 0.25, 0.125, 0.0625);
    a.m_NowTexChangeData.m_SequenceID = 5;
    a.onFocusOut();
    expect([a.m_bHasFocus, a.m_eControlState, a.m_bMouseOut]).toEqual([false, SCS.NORMAL, true]);
    expect(stageLog).toEqual([]);
    expect(rgba(a.m_Color)).toEqual([0.5, 0.25, 0.125, 0.0625]);
    expect(a.m_NowTexChangeData.m_SequenceID).toBe(5);
    // a disabled slot becomes DISABLE the same way
    a.m_bEnable = false;
    a.onFocusOut();
    expect(a.m_eControlState).toBe(SCS.DISABLE);
    expect(rgba(a.m_Color)).toEqual([0.5, 0.25, 0.125, 0.0625]);
  });

  test("OnFocusOut of the dragged slot: ReturnDraggingItem-like: the slot goes back to NORMAL (forced: the normal branch runs, the colour is the normal one) and nobody is dragged", () => {
    const { a } = rig();
    a.handleMouse(0x201, 20, 20, 0, 0);
    expect(CKTDGUISlot.s_pDragSlot === a).toBe(true);
    a.onFocusOut();
    expect([a.m_eControlState, CKTDGUISlot.s_pDragSlot === null, a.m_bHasFocus]).toEqual([SCS.NORMAL, true, false]);
    expect(rgba(a.m_Color)).toEqual([1, 1, 1, 1]);
  });
});
