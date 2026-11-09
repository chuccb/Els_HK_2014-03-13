import { describeCases } from "./replay.ts";

/**
 * The input of a dialog: `CKTDGUIDialog::MsgProc` (32958350) and `HandleMouse` (32957AA0).
 *
 * Every case below is a script that `tools/oracle-input.py` ran on x2.exe itself, on the Unicorn CPU emulator: the exe's MsgProc and
 * HandleMouse (with GetControlAtPointAbsolute / ForStatic, OnMouseMove, RequestFocus, SetShow, SetPos, SendInternelEvent, the base
 * ContainsPoint, GetHideDialog, the IME's StaticMsgProc ...) on a dialog, three or four controls, a stage and a dialog manager built in the
 * emulated memory.  The controls' input slots are stubs that write down the call (`A.mouse(513,20,20,0,0)`, `A.key(257,9,1)`, `A.msg(...)`,
 * `A.in`, `A.out`) and answer what the case says; the stage writes down the messages (`stage(1127,5,0)`: 0x467, the custom message 5, lParam 0).
 * `packages/ui/test/input-cases.json` is the script with the exe's answers (the return value, the calls in order, and the state of the dialog
 * afterwards); this file runs the same steps on the TypeScript port: it builds the same objects, sets the same fields, answers the same way,
 * and compares everything.  Every case was also worked out by hand from the decompile first (see the comments of `MsgProc` in dialog.ts and
 * the switches of 32958350: the jump tables at 329589C4 / 329589D4 / 329589E8).
 */

describeCases(
  "CKTDGUIDialog::MsgProc (32958350) and HandleMouse (32957AA0) against the exe's own answers (tools/oracle-input.py)",
  "./input-cases.json",
);
