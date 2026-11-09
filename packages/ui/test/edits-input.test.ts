/**
 * The input of the edit box against what x2.exe answers: `tools/oracle-edits.py` runs `CKTDGUIEditBox`'s own functions on a CPU emulator -- the keys
 * (`HandleKeyboard`), the characters (`MsgProc`), the mouse (`HandleMouse`, `ContainPTForEditBox`), `OnFocusOut`, `PlaceCaret` and the members that copy,
 * paste and delete -- on boxes built by hand, and writes down every call: the answer, the calls that left the box (the stage's messages, the key sound, the
 * window system's `GetKeyState`, the clipboard and the timer) and the box afterwards (`edits-cases.json`).  The replay builds the same boxes on the port and
 * expects the same.
 */
import { describe, expect, test } from "bun:test";
import { CKTDGUIDialog, CKTDGUIEditBox, MemoryClipboard } from "../src/index.ts";
import { setup } from "./harness.ts";
import { describeCases } from "./replay.ts";

describeCases("CKTDGUIEditBox's input against the exe's own answers (tools/oracle-edits.py)", "./edits-cases.json", ["act_edit"]);

/**
 * What no emulator run can show (the exe reads and writes memory it does not own there, so the port stops with an error) and what the replay does not
 * reach (the world's own keyboard state and clipboard, a box that is in no dialog).  The numbers are worked out by hand from the decompile: the box's
 * `CopyToClipboard` (32933460) asks `GlobalAlloc` for `2 * lstrlenW(text) + 2` bytes, which are `length + 1` characters, copies the `hi - lo` characters
 * of the selection and writes the NUL after them: a selection of `length + 1` characters or more reaches behind the block.
 */

function box(text: string, caret: number, sel: number) {
  const s = setup();
  const e = new CKTDGUIEditBox(s.w);
  expect(e.m_Buffer.SetText(text)).toBe(true);
  e.m_nCaret = caret;
  e.m_nSelStart = sel;
  return { ...s, e, clip: s.w.clipboard as MemoryClipboard };
}

/** `WM_CHAR` of the control character `c` */
const char = (e: CKTDGUIEditBox, c: number): boolean => e.msgProc(0, 0x102, c, 0);

describe("CKTDGUIEditBox::CopyToClipboard outside the text", () => {
  test("a selection of more characters than the text has is an error: the block is one character longer than the text", () => {
    const { e } = box("hello", 0, 6);
    expect(() => e.CopyToClipboard()).toThrow("not inside the text of 5 characters");
    const back = box("hello", 6, 0);
    expect(() => back.e.CopyToClipboard()).toThrow("not inside the text of 5 characters");
  });

  test("a selection that ends more than one behind the text is an error", () => {
    expect(() => box("hello", 2, 7).e.CopyToClipboard()).toThrow("2..7 is not inside the text");
    expect(() => box("hello", 7, 2).e.CopyToClipboard()).toThrow("2..7 is not inside the text");
  });

  test("a selection that starts before the text is an error", () => {
    expect(() => box("hello", -1, 2).e.CopyToClipboard()).toThrow("-1..2 is not inside the text");
  });

  test("the exe has opened the clipboard and emptied it by then (what it held is gone)", () => {
    const { e, clip } = box("hello", 0, 6);
    clip.text = "old";
    expect(() => e.CopyToClipboard()).toThrow("not inside the text");
    expect(clip.text as string | null).toBe(null);
  });

  test("a buffer nobody allocated has nothing to copy from", () => {
    const { e } = box("hello", 0, 2);
    e.m_Buffer.m_pwszBuffer = null;
    expect(() => e.CopyToClipboard()).toThrow("the buffer is gone");
  });

  test("a selection that ends at the text's NUL is the last one that fits: its last character is the NUL, which ends the copy", () => {
    const { e, clip } = box("hello", 1, 6);
    e.CopyToClipboard();
    expect(clip.text).toBe("ello");
    expect(clip.opened).toBe(false);
  });

  test("no selection: the clipboard is not even opened", () => {
    const { e, clip } = box("hello", 3, 3);
    clip.busy = true;
    clip.text = "old";
    e.CopyToClipboard();
    expect(clip.text).toBe("old");
    expect(clip.opened).toBe(false);
  });
});

describe("the keyboard and the clipboard of a world", () => {
  test("GetKeyState answers the sign of the SHORT: a key that is down is negative, the others are 0", () => {
    const { w } = setup();
    expect([w.getKeyState(0x10), w.getKeyState(0x11)]).toEqual([0, 0]);
    w.virtualKeysDown.add(0x10);
    expect([w.getKeyState(0x10), w.getKeyState(0x11)]).toEqual([-0x8000, 0]);
    w.virtualKeysDown.delete(0x10);
    expect(w.getKeyState(0x10)).toBe(0);
  });

  test("the clipboard in memory: open, empty, put text, read it, close; another program that holds it open keeps the box out", () => {
    const clip = new MemoryClipboard();
    expect(clip.getText()).toBe(null);
    expect(clip.open()).toBe(true);
    expect(clip.opened).toBe(true);
    clip.setText("abc");
    expect(clip.getText()).toBe("abc");
    clip.close();
    expect(clip.opened).toBe(false);
    expect(clip.text).toBe("abc");
    clip.open();
    clip.empty();
    expect(clip.getText()).toBe(null);
    clip.close();
    clip.busy = true;
    expect(clip.open()).toBe(false);
    expect(clip.opened).toBe(false);
  });

  test("Ctrl+A, Ctrl+C in one box and Ctrl+V in another: the text travels over the world's clipboard", () => {
    const first = box("hello", 5, 5);
    expect(char(first.e, 1)).toBe(true);
    expect([first.e.m_nSelStart, first.e.m_nCaret]).toEqual([0, 5]);
    expect(char(first.e, 3)).toBe(true);
    expect(first.clip.text).toBe("hello");
    expect(first.clip.opened).toBe(false);
    const second = new CKTDGUIEditBox(first.w);
    expect(second.m_Buffer.SetText("")).toBe(true);
    expect(char(second, 0x16)).toBe(true);
    expect(second.m_Buffer.m_pwszBuffer).toBe("hello");
    expect([second.m_nCaret, second.m_nSelStart]).toEqual([5, 5]);
    expect(first.clip.opened).toBe(false);
  });
});

describe("ContainPTForEditBox without a dialog", () => {
  const quad = (e: CKTDGUIEditBox): void => {
    e.m_NowPoint.leftTopPoint.set(0, 0);
    e.m_NowPoint.rightTopPoint.set(100, 0);
    e.m_NowPoint.leftBottomPoint.set(0, 20);
    e.m_NowPoint.rightBottomPoint.set(100, 20);
  };

  test("a box in no dialog is where its quad is: the handle answers the global null dialog, which is at (0, 0)", () => {
    const { e } = box("abc", 0, 0);
    quad(e);
    expect(e.m_pDialog).toBe(null);
    expect([e.ContainPTForEditBox(50, 10), e.ContainPTForEditBox(150, 10), e.ContainPTForEditBox(50, 30)]).toEqual([true, false, false]);
  });

  test("a box in a dialog is moved by the dialog's position; one in a dialog that is gone is not", () => {
    const { w, e } = box("abc", 0, 0);
    quad(e);
    const dialog = new CKTDGUIDialog(w);
    dialog.m_Pos.set(200, 0);
    dialog.AddControl(e);
    expect([e.ContainPTForEditBox(250, 10), e.ContainPTForEditBox(50, 10)]).toEqual([true, false]);
    dialog.destroyed = true;
    expect([e.ContainPTForEditBox(250, 10), e.ContainPTForEditBox(50, 10)]).toEqual([false, true]);
  });
});
