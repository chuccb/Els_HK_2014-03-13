/**
 * The device reset of the dialogs and the end of the dialog manager: `CKTDGUIDialogManager::OnLostDevice` / `OnResetDevice` (328E09A0 / 328E0A40),
 * `CKTDGUIDialog::OnLostDevice` / `OnResetDevice` (3295A480 / 3295A610), the controls' own `OnLostDevice` / `OnResetDevice` (the base's
 * `xor eax, eax; ret`, 32840850), the destructor `~CKTDGUIDialogManager` (328DD8A0) and what it lets go of: `CKTDGUIIMEEditBox::Uninitialize`
 * (3293B4B0, the table of `imm32.dll`'s functions goes back to its dummies, 328A8420 / 32935200 / 32935210 / 32935220 / 328CF730).  Every expected
 * value is worked out by hand from the decompile and the disassembly of x2.exe (the address is in the name of each test); the dialogs' and the
 * controls' own functions that the walks call are replaced with recorders where the order is the point.
 */
import { describe, expect, test } from "bun:test";
import { LuaUserdata } from "@els/lua";
import {
  CKTDGUIButton, CKTDGUICheckBox, CKTDGUIComboBox, CKTDGUIContolList, CKTDGUIControl, CKTDGUIDialog, CKTDGUIDialogManager, CKTDGUIEditBox,
  CKTDGUIIMEEditBox, CKTDGUIListBox, CKTDGUINavigation, CKTDGUIRadioButton, CKTDGUIScrollBar, CKTDGUISlider, CKTDGUISlot, CKTDGUIStatic, DummyImmHost,
  NoImeHost, UCT,
} from "../src/index.ts";
import type { ImeHost } from "../src/index.ts";
import { setup } from "./harness.ts";

// A failing comparison of dialogs or controls would print the whole world: they are compared by identity.
const is = (a: unknown, b: unknown): boolean => a === b;

/** a world, a dialog manager of its own and dialogs that are not modal */
function managerWorld() {
  const s = setup();
  const manager = new CKTDGUIDialogManager(s.w);
  const added = (...names: string[]): CKTDGUIDialog[] =>
    names.map((name) => {
      const d = new CKTDGUIDialog(s.w);
      d.m_Name = name;
      expect(manager.addDlg(d)).toBe(true);
      return d;
    });
  const order = (): string[] => [...manager.m_listDialog].map((d) => d.m_Name);
  return { ...s, manager, added, order };
}

/** a control that is named and added to the dialog (the name is the one `AddControl` finds free) */
function named<T extends CKTDGUIControl>(dialog: CKTDGUIDialog, name: string, control: T): T {
  control.m_Name = name;
  dialog.AddControl(control);
  return control;
}

/** every control class of the exe that has a constructor of its own (the thirteen whose vtables were read), made in the world `w` */
function allControlClasses(w: ReturnType<typeof setup>["w"]): CKTDGUIControl[] {
  return [
    new CKTDGUIStatic(w), new CKTDGUIButton(w), new CKTDGUIRadioButton(w), new CKTDGUICheckBox(w), new CKTDGUISlot(w), new CKTDGUIComboBox(w),
    new CKTDGUIListBox(w), new CKTDGUIEditBox(w), new CKTDGUIIMEEditBox(w), new CKTDGUIContolList(w), new CKTDGUISlider(w), new CKTDGUIScrollBar(w),
    new CKTDGUINavigation(w),
  ];
}

describe("CKTDGUIControl::OnLostDevice / OnResetDevice (virtual slots 5 / 4, the base's xor eax, eax; ret at 32840850)", () => {
  test("every control class answers 0 to both, and none overrides them (the thirteen constructors' vtables hold the base's)", () => {
    const { w } = setup();
    const all = allControlClasses(w);
    expect(all.length).toBe(13);
    for (const c of all) {
      const name = c.constructor.name;
      expect([name, c.onLostDevice(), c.onResetDevice()]).toEqual([name, 0, 0]);
      expect([name, c.onLostDevice === CKTDGUIControl.prototype.onLostDevice, c.onResetDevice === CKTDGUIControl.prototype.onResetDevice]).toEqual([
        name, true, true,
      ]);
    }
  });

  test("a call changes nothing of the control: its position, its colour, its state, the focus", () => {
    const { w } = setup();
    const button = new CKTDGUIButton(w);
    button.m_OffsetPos.set(3, 4);
    button.m_Color.set(0.25, 0.5, 0.75, 0.5);
    button.m_bShow = true;
    button.m_ButtonState = 2;
    w.controlFocus = button;
    const look = () => [
      button.m_OffsetPos.x, button.m_OffsetPos.y, button.m_Color.r, button.m_Color.g, button.m_Color.b, button.m_Color.a, button.m_bShow, button.m_bEnable,
      button.m_ButtonState, button.m_bHasFocus,
    ];
    const before = look();
    expect(button.onLostDevice()).toBe(0);
    expect(button.onResetDevice()).toBe(0);
    expect(look()).toEqual(before);
    expect(is(w.controlFocus, button)).toBe(true);
  });
});

describe("CKTDGUIDialog::OnLostDevice (3295A480)", () => {
  test("every control of the list is told, in the order of the list; 0", () => {
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    const log: string[] = [];
    const cs = ["S", "B", "C", "L"].map((n, i) => {
      const c = named(d, n, [new CKTDGUIStatic(w), new CKTDGUIButton(w), new CKTDGUIComboBox(w), new CKTDGUIListBox(w)][i]!);
      c.onLostDevice = () => {
        log.push(`lost:${n}`);
        return 0;
      };
      c.onResetDevice = () => {
        log.push(`reset:${n}`);
        return 0;
      };
      return c;
    });
    expect(cs.length).toBe(4);
    expect(d.onLostDevice()).toBe(0);
    expect(log).toEqual(["lost:S", "lost:B", "lost:C", "lost:L"]);
  });

  test("a dialog without controls answers 0; a dialog that is hidden or disabled tells its controls all the same", () => {
    const { w } = setup();
    const empty = new CKTDGUIDialog(w);
    expect([empty.onLostDevice(), empty.onResetDevice()]).toEqual([0, 0]);
    const d = new CKTDGUIDialog(w);
    d.m_bShow = false;
    d.m_bEnable = false;
    const log: string[] = [];
    const c = named(d, "S", new CKTDGUIStatic(w));
    c.m_bShow = false;
    c.onLostDevice = () => (log.push("lost"), 0);
    c.onResetDevice = () => (log.push("reset"), 0);
    d.onLostDevice();
    d.onResetDevice();
    expect(log).toEqual(["lost", "reset"]);
  });

  test("the length of the list is read again after each call: a control that is added during the walk is told, one that was taken out is not", () => {
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    const log: string[] = [];
    const [a, b, c] = ["A", "B", "C"].map((n) => {
      const x = named(d, n, new CKTDGUIStatic(w));
      x.onLostDevice = () => (log.push(n), 0);
      return x;
    }) as [CKTDGUIStatic, CKTDGUIStatic, CKTDGUIStatic];
    const extra = new CKTDGUIStatic(w);
    extra.m_Name = "X";
    extra.onLostDevice = () => (log.push("X"), 0);
    a.onLostDevice = () => {
      log.push("A");
      d.AddControl(extra); // joins behind C
      d.m_ControlsList.splice(d.m_ControlsList.indexOf(b), 1); // B is gone before its turn
      return 0;
    };
    d.onLostDevice();
    expect([log, d.m_ControlsList.map((x) => x.m_Name), is(c, d.m_ControlsList[1])]).toEqual([["A", "C", "X"], ["A", "C", "X"], true]);
  });
});

describe("CKTDGUIDialog::OnResetDevice (3295A610)", () => {
  /** a dialog with one of each kind that has an `UpdateRects`, and a static and a button, which have none; all calls are recorded */
  function recorded() {
    const { w, ...rest } = setup();
    const d = new CKTDGUIDialog(w);
    const log: string[] = [];
    const spy = (c: CKTDGUIControl, n: string) => {
      c.onResetDevice = () => (log.push(`reset:${n}`), 0);
      const rects = c as unknown as { updateRects?: () => void };
      if (typeof rects.updateRects === "function") rects.updateRects = () => void log.push(`rects:${n}`);
      return c;
    };
    const s = spy(named(d, "S", new CKTDGUIStatic(w)), "S");
    const combo = spy(named(d, "C", new CKTDGUIComboBox(w)), "C");
    const b = spy(named(d, "B", new CKTDGUIButton(w)), "B");
    const list = spy(named(d, "L", new CKTDGUIListBox(w)), "L");
    const slider = spy(named(d, "R", new CKTDGUISlider(w)), "R");
    const cl = spy(named(d, "T", new CKTDGUIContolList(w)), "T");
    const bar = spy(named(d, "V", new CKTDGUIScrollBar(w)), "V");
    return { w, ...rest, d, log, s, combo, b, list, slider, cl, bar };
  }

  test("pass 1: every control is told, in the order of the list; pass 2: the combo boxes, the list boxes and the control lists make their rectangles; 0", () => {
    const { d, log } = recorded();
    expect(d.onResetDevice()).toBe(0);
    expect(log).toEqual([
      "reset:S", "reset:C", "reset:B", "reset:L", "reset:R", "reset:T", "reset:V",
      "rects:C", "rects:L", "rects:T",
    ]);
  });

  test("the second pass goes by m_ControlType (8, 9, 12), not by what the control can do: a slider and a scroll bar have an UpdateRects and are left alone", () => {
    const { d, log, combo, list, cl, slider, bar, s, b } = recorded();
    expect([combo.m_ControlType, list.m_ControlType, cl.m_ControlType, slider.m_ControlType, bar.m_ControlType, s.m_ControlType, b.m_ControlType]).toEqual([
      UCT.COMBOBOX, UCT.LISTBOX, UCT.CONTROLLIST, UCT.SLIDER, UCT.SCROLLBAR, UCT.STATIC, UCT.BUTTON,
    ]);
    expect([UCT.COMBOBOX, UCT.LISTBOX, UCT.CONTROLLIST]).toEqual([8, 9, 12]);
    d.onResetDevice();
    expect(log.filter((l) => l.startsWith("rects:"))).toEqual(["rects:C", "rects:L", "rects:T"]);
    // a control of another type that takes a type of the three (the type is what the exe reads) is asked for its rectangles
    const typed = new CKTDGUIListBox(d.ctx);
    typed.m_ControlType = UCT.SLIDER;
    (typed as unknown as { updateRects: () => void }).updateRects = () => void log.push("rects:typed");
    d.AddControl(typed);
    log.length = 0;
    d.onResetDevice();
    expect(log.filter((l) => l.startsWith("rects:"))).toEqual(["rects:C", "rects:L", "rects:T"]);
  });

  test("the combo box's rectangles are made again (the real UpdateRects 32940DE0): the bounding box is the position and the size", () => {
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    const combo = named(d, "C", new CKTDGUIComboBox(w));
    combo.m_x = 11;
    combo.m_y = 12;
    combo.m_width = 130;
    combo.m_height = 21;
    combo.m_rcBoundingBox.left = -5;
    combo.m_rcBoundingBox.top = -6;
    combo.m_rcBoundingBox.right = -7;
    combo.m_rcBoundingBox.bottom = -8;
    expect(d.onResetDevice()).toBe(0);
    const bb = combo.m_rcBoundingBox;
    expect([bb.left, bb.top, bb.right, bb.bottom]).toEqual([11, 12, 141, 33]);
  });

  test("the control list's bounding box is made again (the real UpdateRects 32950480): the view in cells of the scroll offsets, from the position", () => {
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    const list = named(d, "T", new CKTDGUIContolList(w));
    list.m_Pos.set(20, 30);
    list.m_iViewSizeX = 3;
    list.m_iViewSizeY = 2;
    list.m_iScrollOffsetX = 10;
    list.m_iScrollOffsetY = 7;
    const bb = list.m_rcBoundingBox;
    bb.left = bb.top = bb.right = bb.bottom = -1;
    d.onResetDevice();
    expect([bb.left, bb.top, bb.right, bb.bottom]).toEqual([20, 30, 50, 44]);
  });

  test("a list box that has no string data is a null dereference of the exe (UpdateRects 32948240): an Error; a combo box without string data is fine", () => {
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    named(d, "C", new CKTDGUIComboBox(w));
    expect(d.onResetDevice()).toBe(0);
    const list = named(d, "L", new CKTDGUIListBox(w));
    expect(() => d.onResetDevice()).toThrow(/no string data/);
    expect(list.m_rcBoundingBox.right).toBe(0);
  });

  test("the first pass is finished before the second one begins, and both read the length of the list again", () => {
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    const log: string[] = [];
    const first = named(d, "S", new CKTDGUIStatic(w));
    const combo = named(d, "C", new CKTDGUIComboBox(w));
    const late = new CKTDGUIComboBox(w);
    late.m_Name = "Late";
    (late as unknown as { updateRects: () => void }).updateRects = () => void log.push("rects:Late");
    late.onResetDevice = () => (log.push("reset:Late"), 0);
    (combo as unknown as { updateRects: () => void }).updateRects = () => void log.push("rects:C");
    first.onResetDevice = () => {
      log.push("reset:S");
      d.AddControl(late); // joins during the first pass: told in it, and asked for its rectangles in the second
      return 0;
    };
    combo.onResetDevice = () => (log.push("reset:C"), 0);
    d.onResetDevice();
    expect(log).toEqual(["reset:S", "reset:C", "reset:Late", "rects:C", "rects:Late"]);
  });
});

describe("CKTDGUIDialogManager::OnLostDevice (328E09A0) / OnResetDevice (328E0A40)", () => {
  test("every dialog is told, from the back to the front of the list; 0", () => {
    const { manager, added, order } = managerWorld();
    const ds = added("A", "B", "C");
    manager.changeLayer(ds[0]!, 7); // A goes to the front
    expect(order()).toEqual(["B", "C", "A"]);
    const log: string[] = [];
    for (const d of ds) {
      d.onLostDevice = () => (log.push(`lost:${d.m_Name}`), 0);
      d.onResetDevice = () => (log.push(`reset:${d.m_Name}`), 0);
    }
    expect(manager.onLostDevice()).toBe(0);
    expect(log).toEqual(["lost:B", "lost:C", "lost:A"]);
    log.length = 0;
    expect(manager.onResetDevice()).toBe(0);
    expect(log).toEqual(["reset:B", "reset:C", "reset:A"]);
  });

  test("a manager without dialogs answers 0; a hidden, disabled or modal dialog is told all the same", () => {
    const { manager, added } = managerWorld();
    expect([manager.onLostDevice(), manager.onResetDevice()]).toEqual([0, 0]);
    const [a] = added("A") as [CKTDGUIDialog];
    a.m_bShow = false;
    a.m_bEnable = false;
    a.m_bModal = true;
    const log: string[] = [];
    a.onLostDevice = () => (log.push("lost"), 0);
    a.onResetDevice = () => (log.push("reset"), 0);
    manager.onLostDevice();
    manager.onResetDevice();
    expect(log).toEqual(["lost", "reset"]);
  });

  test("a dialog that is gone (its handle resolves to nothing) is passed over; the others are told", () => {
    const { manager, added } = managerWorld();
    const [a, b, c] = added("A", "B", "C") as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    const log: string[] = [];
    for (const d of [a, b, c]) {
      d.onLostDevice = () => (log.push(`lost:${d.m_Name}`), 0);
      d.onResetDevice = () => (log.push(`reset:${d.m_Name}`), 0);
    }
    b.destroyed = true; // destroyed, and still a node of the list
    manager.onLostDevice();
    manager.onResetDevice();
    expect(log).toEqual(["lost:A", "lost:C", "reset:A", "reset:C"]);
  });

  test("the walk stands in m_vecIterator while it goes on and leaves nothing behind; a dialog taken out of the list in front of the walk is not visited", () => {
    const { manager, added } = managerWorld();
    const [a, b, c] = added("A", "B", "C") as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    const seen: number[] = [];
    const log: string[] = [];
    a.onLostDevice = () => {
      seen.push(manager.m_vecIterator.length);
      log.push("A");
      manager.deleteDlg(b); // B was next: the walk moved on before the visit and then moved again
      return 0;
    };
    b.onLostDevice = () => (log.push("B"), 0);
    c.onLostDevice = () => {
      seen.push(manager.m_vecIterator.length);
      log.push("C");
      return 0;
    };
    manager.onLostDevice();
    expect([log, seen, manager.m_vecIterator.length, b.destroyed]).toEqual([["A", "C"], [1, 1], 0, true]);
    // the same for OnResetDevice, with a dialog that joins between the one being visited (X, layer 0) and the next (Z, layer 5): Y (layer 3) is not
    // visited, the position moved on to Z before X was visited
    const m2 = managerWorld();
    const [x, z] = m2.added("X", "Z") as [CKTDGUIDialog, CKTDGUIDialog];
    m2.manager.changeLayer(z, 5);
    const y = new CKTDGUIDialog(m2.w);
    y.m_Name = "Y";
    y.m_iLayer = 3;
    const log2: string[] = [];
    x.onResetDevice = () => {
      log2.push("X");
      expect(m2.manager.m_vecIterator.length).toBe(1);
      m2.manager.addDlg(y);
      return 0;
    };
    y.onResetDevice = () => (log2.push("Y"), 0);
    z.onResetDevice = () => (log2.push("Z"), 0);
    m2.manager.onResetDevice();
    expect([log2, m2.order(), m2.manager.m_vecIterator.length]).toEqual([["X", "Z"], ["X", "Y", "Z"], 0]);
  });

  test("a walk that is cut short by an Error leaves no position behind", () => {
    const { manager, added } = managerWorld();
    const [a] = added("A", "B") as [CKTDGUIDialog];
    a.onLostDevice = () => {
      throw new Error("boom");
    };
    expect(() => manager.onLostDevice()).toThrow("boom");
    expect(manager.m_vecIterator.length).toBe(0);
    a.onResetDevice = () => {
      throw new Error("bang");
    };
    expect(() => manager.onResetDevice()).toThrow("bang");
    expect(manager.m_vecIterator.length).toBe(0);
  });

  test("the whole chain: the manager passes the reset on to the dialogs and they to the controls (a control list's rectangles are made again)", () => {
    const { manager, w } = managerWorld();
    const d = new CKTDGUIDialog(w);
    manager.addDlg(d);
    const list = named(d, "T", new CKTDGUIContolList(w));
    list.m_iViewSizeX = 4;
    list.m_iScrollOffsetX = 5;
    list.m_iViewSizeY = 1;
    list.m_iScrollOffsetY = 9;
    const bb = list.m_rcBoundingBox;
    bb.right = bb.bottom = -1;
    manager.onResetDevice();
    expect([bb.left, bb.top, bb.right, bb.bottom]).toEqual([0, 0, 20, 9]);
  });
});

describe("~CKTDGUIDialogManager (328DD8A0)", () => {
  test("ClearAllDlg: every dialog is destroyed and leaves the list, the set and the manager", () => {
    const { manager, added, order } = managerWorld();
    const ds = added("A", "B", "C");
    manager.Destroy();
    expect([order(), manager.m_setDialog.size, manager.m_listDialog.size, ds.map((d) => d.destroyed), ds.map((d) => d.m_pkUIDialogManager === null)]).toEqual([
      [], 0, 0, [true, true, true], [true, true, true],
    ]);
  });

  test("a dialog the manager does not know that is in its list ends the loop for ever in the exe: an Error here", () => {
    const { manager, w } = managerWorld();
    const stray = new CKTDGUIDialog(w);
    stray.m_Name = "Stray";
    manager.m_listDialog.push(stray); // in the list, not in the set
    expect(() => manager.Destroy()).toThrow(/ClearAllDlg/);
  });

  test("the font maps are emptied (the fonts themselves are not destroyed: the map holds pointers)", () => {
    const { manager, w } = managerWorld();
    const f1 = w.fonts.addUKFont(1);
    w.fonts.addUKFont(2);
    w.fonts.mapUIFontToUKFont(10, 1);
    w.fonts.mapUIFontToUKFont(11, 2);
    expect([w.fonts.m_mapUKFontList.size, w.fonts.m_mapFontToUKFont.size]).toEqual([2, 2]);
    manager.Destroy();
    expect([w.fonts.m_mapUKFontList.size, w.fonts.m_mapFontToUKFont.size]).toEqual([0, 0]);
    expect([w.fonts.getMappedUKFont(10), f1.m_pUKFont]).toEqual([null, null]); // (nothing is mapped, and the font object itself was left alone)
  });

  test("the Lua global g_pDialogManager is a new userdata of this manager, which scripts can call (SetShow); nothing set it before", () => {
    const { manager, w, m } = managerWorld();
    const globals = w.world.G.globals;
    expect(globals.getStr("g_pDialogManager")).toBeUndefined();
    manager.Destroy();
    const ud = globals.getStr("g_pDialogManager") as LuaUserdata;
    expect(ud instanceof LuaUserdata).toBe(true);
    expect(is(ud.data, manager)).toBe(true);
    expect(manager.m_bShow).toBe(true);
    m(ud, "SetShow", false); // a method the exe registers for the class
    expect(manager.m_bShow).toBe(false);
    manager.Destroy(); // a second destruction makes another userdata of the same manager
    const again = globals.getStr("g_pDialogManager") as LuaUserdata;
    expect([again instanceof LuaUserdata, again === ud, is(again.data, manager)]).toEqual([true, false, true]);
  });

  test("the order: the dialogs are destroyed first (the fonts are there, the global is not set, the IME's imm32 calls are the platform's)", () => {
    const { manager, added, w } = managerWorld();
    const platform = Object.assign(new NoImeHost(), { immGetContext: () => 7 });
    w.ime.host = platform;
    w.fonts.addUKFont(1);
    const [a] = added("A") as [CKTDGUIDialog];
    const seen: unknown[] = [];
    const real = a.Destroy.bind(a);
    a.Destroy = () => {
      seen.push(w.fonts.m_mapUKFontList.size, w.world.G.globals.getStr("g_pDialogManager") === undefined, w.ime.host.immGetContext());
      real();
    };
    manager.Destroy();
    expect(seen).toEqual([1, true, 7]);
    expect([w.fonts.m_mapUKFontList.size, w.world.G.globals.getStr("g_pDialogManager") instanceof LuaUserdata, w.ime.host.immGetContext()]).toEqual([0, true, 0]);
  });

  test("the lookups and the walks are freed (m_mapDialog, the change counts of the lookups, the two vectors of walks); the set left with the list", () => {
    const { manager, added } = managerWorld();
    added("A", "B");
    expect(manager.getDialog("A")?.m_Name).toBe("A");
    expect([manager.m_mapDialog.size, manager.m_mapDialogListChangeCountWhenLastGetDialog.size, manager.m_setDialog.size]).toEqual([1, 1, 2]);
    manager.m_vecIterator.push(manager.m_listDialog.head);
    manager.m_vecReverseIterator.push(manager.m_listDialog.head);
    manager.Destroy();
    expect([
      manager.m_mapDialog.size, manager.m_mapDialogListChangeCountWhenLastGetDialog.size, manager.m_setDialog.size, manager.m_vecIterator.length,
      manager.m_vecReverseIterator.length, manager.m_listDialog.size,
    ]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("a manager that holds nothing can be destroyed (and twice: the second time finds everything gone)", () => {
    const { manager, w } = managerWorld();
    manager.Destroy();
    manager.Destroy();
    expect([manager.m_listDialog.size, w.fonts.m_mapUKFontList.size]).toEqual([0, 0]);
  });

  test("a dialog that was handed to the manager and is walked by the loop of the destructor: a control with the focus loses it (the dialog's own destructor)", () => {
    const { manager, w } = managerWorld();
    const d = new CKTDGUIDialog(w);
    manager.addDlg(d);
    const button = named(d, "B", new CKTDGUIButton(w));
    w.controlFocus = button;
    manager.Destroy();
    expect([w.controlFocus === null, d.destroyed]).toEqual([true, true]);
  });
});

describe("CKTDGUIIMEEditBox::Uninitialize (3293B4B0): the table of imm32.dll's functions goes back to its dummies", () => {
  /** a platform that answers everything with a value of its own (what the real imm32.dll and USER32 would) */
  function platform(): ImeHost {
    return Object.assign(new NoImeHost(), {
      getKeyboardLayout: () => 0x04040404,
      getAsyncKeyState: (vk: number) => -vk,
      getFocus: () => 99,
      getKeyboardLayoutCount: () => 3,
      getKeyboardLayoutList: (n: number) => [1, 2, 3].slice(0, n),
      getLocaleAbbreviation: (lcid: number) => "L" + lcid.toString(16),
      getLocaleLanguage: (lcid: number) => (lcid === 0x404 ? "Chinese (Traditional, Taiwan)" : null),
      immGetContext: () => 5,
      immAssociateContext: () => 6,
      immNotifyIME: () => 1,
      immIsIME: () => true,
      immGetOpenStatus: () => true,
      immGetConversionStatus: () => ({ conversion: 1, sentence: 2 }),
      immGetIMEFileName: () => "PINTLGNT.IME",
      immGetCompositionString: () => ({ result: 4, data: new Uint8Array(4) }),
      immGetCandidateList: () => ({ result: 12, data: new Uint8Array(12) }),
    } as Partial<ImeHost>);
  }

  test("before: the platform's answers; after: the dummies' (0, false, null, no file name, -2 for the composition string) for the imm32 calls only", () => {
    const { w } = setup();
    w.ime.host = platform();
    const host = w.ime.host;
    expect([host.immGetContext(), host.immAssociateContext(3), host.immNotifyIME(1, 2, 3, 4), host.immIsIME(5), host.immGetOpenStatus(1)]).toEqual([5, 6, 1, true, true]);
    w.ime.uninitialize();
    const after = w.ime.host;
    expect(after instanceof DummyImmHost).toBe(true);
    expect([after.immGetContext(), after.immAssociateContext(3), after.immNotifyIME(1, 2, 3, 4), after.immIsIME(5), after.immGetOpenStatus(1)]).toEqual([
      0, 0, 0, false, false,
    ]);
    expect([after.immGetConversionStatus(1), after.immGetIMEFileName(0x04040404)]).toEqual([null, ""]);
    const comp = after.immGetCompositionString(1, 8, 0x200);
    const cand = after.immGetCandidateList(1, 0, 0);
    expect([comp.result, comp.data.length, cand.result, cand.data.length]).toEqual([-2, 0, 0, 0]);
    expect(after.immReleaseContext(1)).toBeUndefined();
  });

  test("USER32 and KERNEL32 are not in the table: their calls still go to the platform", () => {
    const { w } = setup();
    const posted: number[][] = [];
    const sent: number[][] = [];
    const keys: number[][] = [];
    w.ime.host = Object.assign(platform(), {
      postMessage: (h: number, m: number, wp: number, lp: number) => void posted.push([h, m, wp, lp]),
      sendMessage: (m: number, wp: number, lp: number) => void sent.push([m, wp, lp]),
      keybdEvent: (vk: number, flags: number) => void keys.push([vk, flags]),
    });
    w.ime.uninitialize();
    const host = w.ime.host;
    host.postMessage(1, 2, 3, 4);
    host.sendMessage(5, 6, 7);
    host.keybdEvent(8, 2);
    expect([host.getKeyboardLayout(), host.getAsyncKeyState(9), host.getFocus(), host.getKeyboardLayoutCount(), host.getKeyboardLayoutList(2)]).toEqual([
      0x04040404, -9, 99, 3, [1, 2],
    ]);
    expect([host.getLocaleAbbreviation(0x404), host.getLocaleLanguage(0x404), host.getLocaleAbbreviation(0x411), host.getLocaleLanguage(0x411)]).toEqual([
      "L404", "Chinese (Traditional, Taiwan)", "L411", null,
    ]);
    expect([posted, sent, keys]).toEqual([[[1, 2, 3, 4]], [[5, 6, 7]], [[8, 2]]]);
  });

  test("a second call finds nothing loaded (the same wrapper stays); s_bInitialised stays what it was and Initialize does not load again", () => {
    const { w } = setup();
    w.ime.host = platform();
    expect(w.ime.s_bInitialised).toBe(false);
    w.ime.uninitialize();
    const once = w.ime.host;
    w.ime.uninitialize();
    expect(is(w.ime.host, once)).toBe(true);
    expect(w.ime.s_bInitialised).toBe(false);
    w.ime.initialize(); // runs for the first time and sets the flag: the imm32 table is not loaded again
    expect([w.ime.s_bInitialised, is(w.ime.host, once), w.ime.host.immGetContext()]).toEqual([true, true, 0]);
    // a host that a platform plugs in afterwards is its own: the library is let go already, a second call does not wrap it
    w.ime.host = platform();
    w.ime.uninitialize();
    expect(w.ime.host.immGetContext()).toBe(5);
    // with the flag set before, nothing about it changes either
    const second = setup().w;
    second.ime.initialize();
    second.ime.host = platform();
    second.ime.uninitialize();
    expect([second.ime.s_bInitialised, second.ime.host.immGetContext()]).toEqual([true, 0]);
  });

  test("a box that exists keeps working with the dummies: no input context, no composition (the exe's calls through the table answer 0)", () => {
    const { w } = setup();
    w.ime.host = platform();
    const box = new CKTDGUIIMEEditBox(w);
    w.ime.uninitialize();
    expect([w.ime.host.immGetContext(), w.ime.host.immGetOpenStatus(0), box.m_pFont]).toEqual([0, false, null]);
  });
});
