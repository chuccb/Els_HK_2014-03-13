import { describeCases } from "./replay.ts";

/**
 * The mouse input of the slider and the scroll bar: `CKTDGUISlider::HandleMouse` (3294C9F0), `CKTDGUIScrollBar::HandleMouse` (32985B00) and the
 * scroll bar's own `MsgProc` (32985E10, a virtual of slot 41 that takes no window handle), against the exe's own answers.
 *
 * `tools/oracle-bars.py` runs those functions of x2.exe on the Unicorn CPU emulator, on a dialog, a stage and the controls built in its memory (the
 * real vtable of the class; the rectangles come from the exe's own UpdateRects, the position steps and the thumb from Scroll / Cap /
 * UpdateThumbRect, the time from DXUTGetTime, the value changes from SetValueInternal), and writes down for every message the return value, the
 * calls (`capture` / `release`: SetCapture / ReleaseCapture, `A.sound(down)`: PlaySoundW, `stage(1126,0,A)`: the stage's MsgProc) and the state
 * afterwards.  `bars-cases.json` is that script with the answers; `replay.ts` runs the same steps on the TypeScript port.  Every kind of case was
 * worked out by hand from the decompile first (the slider's `(int)((float)(min) + 0.5 + range / width * along)` in single precision, the scroll bar's
 * thumb and position arithmetic with its truncating divisions, the `ThumbOffsetY` that every bar shares).
 */
describeCases(
  "CKTDGUISlider / CKTDGUIScrollBar HandleMouse and MsgProc against the exe's own answers (tools/oracle-bars.py)",
  "./bars-cases.json",
  ["act_ctl", "act_msg"],
);
