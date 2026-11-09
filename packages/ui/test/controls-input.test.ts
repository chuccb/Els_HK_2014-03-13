import { describeCases } from "./replay.ts";

/**
 * The mouse input of the Static and the Button: `CKTDGUIStatic::HandleMouse` (32929E60), `CKTDGUIButton::HandleMouse` (3292E520) and
 * `LButtonMouseUp` (3292E6D0), against the exe's own answers.
 *
 * `tools/oracle-controls.py` runs those functions of x2.exe on the Unicorn CPU emulator, on a dialog, a stage and the controls built in its
 * memory (the real vtable of the class; ContainsPoint, SendInternelEvent, RequestFocus, ClearFocus and the base focus functions are the exe's
 * too), and writes down for every message the return value, the calls (`A.change(2,0)`: ChangeState, `A.sound(down)`: PlaySoundW,
 * `gameMsg(1126,2,A,1)`: SendGameMessage, `stage(1127,77,A)`: the stage's MsgProc) and the state afterwards.  `controls-cases.json` is that
 * script with the answers; `replay.ts` runs the same steps on the TypeScript port.  Every case was worked out by hand from the decompile
 * first; the oracle disagreed once: the left button up of a static also ends the drag of the dialog (Hex-Rays shows a `break` where the
 * code runs on into the right button cases).
 */
describeCases(
  "CKTDGUIStatic / CKTDGUIButton HandleMouse and LButtonMouseUp against the exe's own answers (tools/oracle-controls.py)",
  "./controls-cases.json",
);
