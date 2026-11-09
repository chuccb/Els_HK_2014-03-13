/**
 * The input of the list box (`CKTDGUIListBox.handleMouse` and `listBoxMsgProc`) against what x2.exe answers: `tools/oracle-lists.py` runs the exe's own
 * functions on a CPU emulator, on boxes built by hand (rows with flags and controls, a scroll bar that is a probe control, a stage), and writes every case
 * down (`lists-cases.json`): the message sent, the return value, the calls the box makes (the sound, the messages to the stage with the selection and the rows'
 * flags at that moment, the focus calls, the capture, the scroll bar's calls, the controls of the rows) and the state afterwards.  The replay builds the same
 * box on the TypeScript port and expects the same three things.  The second part is worked out by hand from the decompile, with a REAL scroll bar, and covers
 * what the exe cannot be asked: the places where it reads and writes past its array.
 */
import { describe, expect, test } from "bun:test";
import { CKTDGUIListBox, CKTDGUIScrollBar, UIM } from "../src/index.ts";
import { setup } from "./harness.ts";
import { describeCases } from "./replay.ts";

describeCases("CKTDGUIListBox HandleMouse / MsgProc against the exe's own answers (tools/oracle-lists.py)", "./lists-cases.json", ["act_ctl", "act_listproc"]);

describe("CKTDGUIListBox with a real scroll bar and a real world", () => {
  /** a box (10,10)-(110,70) whose text starts at y 20 in rows of 10; `rows` rows; a real scroll bar with a page of 3 rows */
  const rig = (rows: number, style = 0) => {
    const { w, dialog, stage, stageLog } = setup();
    const d = dialog();
    d.m_pStage = stage as never;
    d.m_pkUIDialogManager = w.dialogManager;
    w.dialogManager.m_setDialog.add(d);
    const box = new CKTDGUIListBox(w);
    d.AddControl(box);
    for (let i = 0; i < rows; i++) box.addItem(`row${i}`, null, 0, 0, false, 0);
    const bar = new CKTDGUIScrollBar(w);
    bar.setDialog(box.m_pDialog);
    bar.m_nPageSize = 3;
    bar.setTrackRange(0, rows);
    box.m_pScrollBar = bar;
    Object.assign(box.m_rcSelection, { left: 10, top: 10, right: 110, bottom: 70 });
    Object.assign(box.m_rcText, { left: 10, top: 20, right: 100, bottom: 50 });
    box.m_nTextHeight = 10;
    box.m_dwStyle = style;
    return { w, box, bar, stageLog, d };
  };
  const flags = (box: CKTDGUIListBox) => box.m_Items.map((r) => +r.bSelected).join("");

  test("a left button down on the second page row of a bar at 4 selects row 5 (flags follow in the multi selection), 0x466 with 1 goes to the stage", () => {
    const { box, bar, stageLog } = rig(10, 1);
    bar.setTrackPos(4);
    expect(bar.m_nPosition).toBe(4);
    expect(box.handleMouse(0x201, 50, 35, 0, 0)).toBe(true);
    expect([box.m_nSelected, box.m_nSelStart, flags(box), box.m_bDrag]).toEqual([5, 5, "0000010000", true]);
    expect(stageLog).toEqual([[UIM.CONTROL_EVENT, 1]]);
  });

  test("shift extends the range from the start row, control toggles one row: starts at 2, shift on 5 selects 2..5, control on 3 clears it, both keys copy the start's flag between", () => {
    const { box, stageLog } = rig(10, 1);
    box.handleMouse(0x201, 50, 45, 0, 0); // page row 2: row 2
    expect([box.m_nSelected, box.m_nSelStart, flags(box)]).toEqual([2, 2, "0010000000"]);
    box.m_pScrollBar!.m_nPosition = 3; // rows 3, 4, 5 on the page
    box.handleMouse(0x201, 50, 45, 4, 0); // shift on row 5
    expect([box.m_nSelected, box.m_nSelStart, flags(box)]).toEqual([5, 2, "0011110000"]);
    box.handleMouse(0x201, 50, 25, 8, 0); // control on row 3: it becomes the start of a new range, row 3 is toggled off
    expect([box.m_nSelected, box.m_nSelStart, flags(box)]).toEqual([3, 3, "0010110000"]);
    box.m_nSelStart = 1; // the start row 1 is not selected: control and shift copy its flag to the rows between 1 and 4 (2 and 3) and select row 4
    box.handleMouse(0x201, 50, 35, 12, 0);
    expect([box.m_nSelected, box.m_nSelStart, flags(box)]).toEqual([1, 1, "0000110000"]);
    expect(stageLog.length).toBe(4);
  });

  test("a wheel turn scrolls the real bar by 3 lines a notch the other way, and the bar is asked first: a click on its down arrow is the bar's, not a row's", () => {
    const { box, bar, stageLog } = rig(20);
    expect(box.handleMouse(0x20a, 50, 35, 0xff880000, 0)).toBe(true); // -120: one notch down
    expect(bar.m_nPosition).toBe(3);
    expect(box.handleMouse(0x20a, 50, 35, 0x00f00000, 0)).toBe(true); // +240: two notches up: -6, capped to 0
    expect(bar.m_nPosition).toBe(0);
    // the bar's own button: whatever it takes the box does not look at (the point is in the box's rectangle as well: the bar is asked first)
    Object.assign(bar, { m_x: 90, m_y: 10, m_width: 16, m_height: 60 });
    bar.updateRects();
    const down = bar.m_rcDownButton;
    expect(down.right).toBeGreaterThan(down.left);
    const before = [box.m_nSelected, box.m_nSelStart];
    const taken = box.handleMouse(0x201, down.left + 1, down.top + 1, 0, 0);
    expect([taken, bar.m_nPosition, box.m_nSelected, box.m_nSelStart]).toEqual([true, 1, before[0]!, before[1]!]);
    expect(stageLog).toEqual([]);
  });

  test("the start of a range that is no row (the list got shorter) is read and written past the array in the exe: a shift click throws, a click without shift does not", () => {
    const { box } = rig(5, 1);
    box.m_nSelStart = 7;
    expect(() => box.handleMouse(0x201, 50, 25, 4, 0)).toThrow(/is not a row of the list/);
    expect(() => box.handleMouse(0x201, 50, 25, 12, 0)).toThrow(/is not a row of the list/);
    expect(() => box.handleMouse(0x204, 50, 25, 4, 0)).toThrow(/is not a row of the list/);
    box.m_nSelStart = 5; // one past the last row
    expect(() => box.handleMouse(0x201, 50, 25, 4, 0)).toThrow(/is not a row of the list/);
    box.m_nSelStart = -1;
    expect(() => box.handleMouse(0x201, 50, 25, 4, 0)).toThrow(/is not a row of the list/);
    box.m_nSelStart = 4; // the last row is a row
    box.handleMouse(0x201, 50, 25, 4, 0);
    expect([box.m_nSelected, box.m_nSelStart, flags(box)]).toEqual([0, 4, "11111"]);
    box.m_nSelStart = 7;
    box.handleMouse(0x201, 50, 25, 8, 0); // control alone toggles the row and does not look at the start
    expect([box.m_nSelected, box.m_nSelStart, flags(box)]).toEqual([0, 0, "01111"]);
  });

  test("a button up whose range starts before the first row reads the memory before the array in the exe: it throws; a range past the end is just not finished", () => {
    const { box } = rig(5);
    box.m_nSelected = 2;
    box.m_nSelStart = -1;
    expect(() => box.handleMouse(0x202, 50, 35, 0, 0)).toThrow(/starts before the first row/);
    box.m_nSelected = -2;
    box.m_nSelStart = 1;
    expect(() => box.handleMouse(0x205, 50, 35, 0, 0)).toThrow(/starts before the first row/);
    box.m_nSelected = 2;
    box.m_nSelStart = 5;
    expect(box.handleMouse(0x202, 50, 35, 0, 0)).toBe(false);
    expect(box.m_bDrag).toBe(false);
  });

  test("MsgProc 0x215 (the capture was lost) ends a drag; the answer is always no", () => {
    const { box } = rig(2);
    box.m_bDrag = true;
    expect(box.listBoxMsgProc(0x215, 1, 2)).toBe(false);
    expect(box.m_bDrag).toBe(false);
    box.m_bDrag = true;
    expect(box.listBoxMsgProc(0x216, 1, 2)).toBe(false);
    expect(box.m_bDrag).toBe(true);
  });
});
