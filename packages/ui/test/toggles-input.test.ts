import { describeCases } from "./replay.ts";

/**
 * The mouse input of the check box and the radio button: `CKTDGUICheckBox::HandleMouse` (32931830) and `CKTDGUIRadioButton::HandleMouse`
 * (3294A680), against the exe's own answers.
 *
 * `tools/oracle-toggles.py` runs those functions of x2.exe on the Unicorn CPU emulator, on a dialog, a stage and the controls built in its
 * memory (the real vtable of the class; ContainsPoint, SendInternelEvent, RequestFocus, the base focus functions and `GetControl(int)` are the
 * exe's too), and writes down for every message the return value, the calls (`capture` / `release`: SetCapture / ReleaseCapture,
 * `A.sound(check)`: PlaySoundW, `A.setChecked(1,0,1)`: SetCheckedInternal, `stage(1127,9,A)`: the stage's MsgProc) and the state afterwards.
 * `toggles-cases.json` is that script with the answers; `replay.ts` runs the same steps on the TypeScript port.  Every case was worked out by
 * hand from the decompile first; two of them show quirks of the exe that are kept: the radio button's group scan on a left button up includes
 * the button itself (a toggling button of a group that takes one is unchecked first, so it is checked again), and a double click is taken
 * (and does nothing) wherever it is when double clicks are off.
 */
describeCases(
  "CKTDGUICheckBox / CKTDGUIRadioButton HandleMouse against the exe's own answers (tools/oracle-toggles.py)",
  "./toggles-cases.json",
);
