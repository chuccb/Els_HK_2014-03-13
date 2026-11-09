/**
 * The input of the combo box (`CKTDGUIComboBox.handleMouse`, `onFocusOut`, `onHotkey`) against what x2.exe answers: `tools/oracle-combos.py` runs the exe's
 * own functions on a CPU emulator, on boxes built by hand (rows, a scroll bar that is a probe control, a stage), and writes every case down
 * (`combos-cases.json`): the message sent, the return value, the calls the box makes (the sound, the messages to the stage with the box's selection at
 * that moment, the focus calls, the scroll bar's calls, the controls of the rows) and the state afterwards.  The replay builds the same box on the
 * TypeScript port and expects the same three things.  The second part is worked out by hand from the decompile, with a REAL scroll bar.
 */
import { describe, expect, test } from "bun:test";
import { CKTDGUIComboBox, CKTDGUIScrollBar, UIM } from "../src/index.ts";
import { setup } from "./harness.ts";
import { describeCases } from "./replay.ts";

describeCases("CKTDGUIComboBox HandleMouse / OnFocusOut / OnHotkey against the exe's own answers (tools/oracle-combos.py)", "./combos-cases.json", ["act_ctl", "act_out", "act_hotkey"]);

describe("CKTDGUIComboBox with a real scroll bar and a real world", () => {
  const rig = (rows: number, page: number) => {
    const { w, dialog, stage, stageLog } = setup();
    const d = dialog();
    d.m_pStage = stage as never;
    d.m_pkUIDialogManager = w.dialogManager;
    w.dialogManager.m_setDialog.add(d);
    const box = new CKTDGUIComboBox(w);
    d.AddControl(box);
    const bar = new CKTDGUIScrollBar(w);
    bar.setDialog(box.m_pDialog);
    bar.m_nPageSize = page;
    bar.setTrackRange(0, rows);
    box.m_pScrollBar = bar;
    for (let i = 0; i < rows; i++) {
      const rc = { left: 0, top: 20 + 20 * i, right: 100, bottom: 40 + 20 * i };
      box.m_Items.push({ strText: `row${i}`, pData: null, rcActive: rc, bVisible: i < page, pControl: null });
    }
    box.m_rcDropdown.left = 0;
    box.m_rcDropdown.top = 20;
    box.m_rcDropdown.right = 100;
    box.m_rcDropdown.bottom = 20 + 20 * page;
    box.m_bOpened = true;
    return { w, box, bar, stageLog };
  };

  test("the world's lines per wheel notch are Windows' default, 3, and the setting is what is asked", () => {
    const { w } = setup();
    expect(w.wheelScrollLines()).toBe(3);
    w.scrollLines = 5;
    expect(w.wheelScrollLines()).toBe(5);
  });

  test("a wheel turn over the open dropdown scrolls the real bar by lines x notches the other way: 10 rows, a page of 3: down 1 notch from 0: 3; down 3 notches: 9, capped to 10 - 3 = 7", () => {
    const { box, bar } = rig(10, 3);
    expect(bar.m_nPosition).toBe(0);
    box.handleMouse(0x20a, 50, 30, 0xff880000, 0); // -120: one notch down: -(3 * -1) = +3
    expect(bar.m_nPosition).toBe(3);
    box.handleMouse(0x20a, 50, 30, 0xfe480000, 0); // -440: three notches (cut towards zero): -(3 * -3) = +9: 12, capped to 7
    expect(bar.m_nPosition).toBe(7);
    box.handleMouse(0x20a, 50, 30, 0x01680000, 0); // +360: three notches up: -(3 * 3) = -9: -2, capped to 0
    expect(bar.m_nPosition).toBe(0);
  });

  test("a click in the open dropdown picks the visible row from the bar's position: the bar at 4, the first row on screen is row 4 (its rectangle holds the point)", () => {
    const { box, bar, stageLog } = rig(10, 3);
    for (const [i, top] of [[4, 20], [5, 40], [6, 60]] as const) {
      box.m_Items[i]!.rcActive.top = top;
      box.m_Items[i]!.rcActive.bottom = top + 20;
      box.m_Items[i]!.bVisible = true;
    }
    bar.setTrackPos(4);
    expect(bar.m_nPosition).toBe(4);
    // rows 0..2 still hold (50, 30) and are visible: they are not searched, the bar is at 4
    box.handleMouse(0x201, 50, 30, 0, 0);
    expect([box.m_iSelected, box.m_iFocused, box.m_bOpened]).toEqual([4, 4, false]);
    expect(stageLog).toEqual([[UIM.CONTROL_EVENT, 0]]);
  });

  test("a bar before the first row (the exe reads the memory before the array) throws", () => {
    const { box, bar } = rig(3, 3);
    bar.m_nPosition = -1;
    expect(() => box.handleMouse(0x201, 50, 30, 0, 0)).toThrow(/before the first row/);
  });
});
