import { describeCases } from "./replay.ts";

/**
 * The mouse input of the controls that hold other things: `CKTDGUIContolList::HandleMouse` (3294F5F0: the two scroll bars), `CKTDGUINavigation::HandleMouse`
 * (3294E160, with FromUIPointToRect, BoundRectInRect and FromRectToPoint) and the navigation's own `MsgProc` (3294E510, slot 41, no window handle), against
 * the exe's own answers.
 *
 * `tools/oracle-containers.py` runs those functions of x2.exe on the Unicorn CPU emulator, on a dialog, a stage and the controls built in its memory (the
 * real vtable of the class; the scroll bars of a list are controls whose HandleMouse writes the call down and answers what the case says), and writes
 * down for every message the return value, the calls (`capture` / `release`: SetCapture / ReleaseCapture, `A.sound(down)`: PlaySoundW,
 * `gameMsg(1126,0,A,1)`: SendGameMessage, `stage(1127,5,A)`: the stage's MsgProc) and the state afterwards (the rectangles and the eight corner
 * coordinates of the window point).  `containers-cases.json` is that script with the answers; `replay.ts` runs the same steps on the TypeScript port.
 * The window's centring and the move use single precision (`(int)((float)x - (float)last)`, a half size times 0.5): the cases at 16777217 show it.
 */
describeCases(
  "CKTDGUIContolList / CKTDGUINavigation HandleMouse and MsgProc against the exe's own answers (tools/oracle-containers.py)",
  "./containers-cases.json",
  ["act_ctl", "act_msg"],
);
