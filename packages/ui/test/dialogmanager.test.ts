/**
 * `CKTDGUIDialogManager` (328DD5F0 .. 328E1180): the list of dialogs in drawing order, the lookups, the walks that move, draw and message the
 * dialogs, and `~CKTDGUIDialog` (329554D0).  Every expected value is worked out by hand from the decompile of x2.exe (the address is in the name
 * of each test); the sequences of list changes were also run through a small Python model of the rules (kept apart from the port).  The dialogs'
 * own `OnFrameMove` / `OnFrameRender` / `MsgProc` are other units: each test replaces them with recorders.
 */
import { describe, expect, test } from "bun:test";
import { CKTDGUIDialog, CKTDGUIDialogManager, CKTDGUINavigation, CKTDGUISlot, CKTDGUIStatic, SCS, UCT, UIPointData } from "../src/index.ts";
import { setup } from "./harness.ts";

// A failing comparison of dialogs would print the whole world: they are compared by identity.
const is = (a: unknown, b: unknown): boolean => a === b;

/** a world, a manager and dialogs that are not modal (what `CountModalDialog` counts) unless said otherwise */
function managerWorld() {
  const { w, wrap, m } = setup();
  const manager = new CKTDGUIDialogManager(w);
  const made = (name: string, front = false, layer = 0, modal = false): CKTDGUIDialog => {
    const d = new CKTDGUIDialog(w);
    d.m_Name = name;
    d.m_bFront = front;
    d.m_iLayer = layer;
    d.m_bModal = modal;
    return d;
  };
  type Spec = [name: string, front?: boolean, layer?: number, modal?: boolean];
  const added = (...specs: Spec[]): CKTDGUIDialog[] =>
    specs.map(([n, f, l, m]) => {
      const d = made(n, f, l, m);
      expect(manager.addDlg(d)).toBe(true);
      return d;
    });
  const order = (): string[] => [...manager.m_listDialog].map((d) => d.m_Name);
  const counts = (): number[] => [...manager.m_listDialog].map((d) => d.m_iDialogListChangeCount);
  return { w, manager, made, added, order, counts, wrap, m };
}

describe("CKTDGUIDialogManager: AddDlg (328DDB40) and _InsertIntoDialogListTop (328E1010)", () => {
  test("AddDlg: a dialog that is there and has no manager joins; null, a destroyed dialog and one that has a manager do not", () => {
    const { w, manager, made, order } = managerWorld();
    expect(manager.addDlg(null)).toBe(false);
    const a = made("A");
    expect(manager.addDlg(a)).toBe(true);
    expect([is(a.m_pkUIDialogManager, manager), manager.m_setDialog.has(a), order(), manager.m_iDialogListChangeCount, a.m_iDialogListChangeCount]).toEqual([
      true, true, ["A"], 1, 1,
    ]);
    expect(manager.addDlg(a)).toBe(false); // it has a manager (this one)
    expect(new CKTDGUIDialogManager(w).addDlg(a)).toBe(false); // (or another one)
    const gone = made("G");
    gone.Destroy();
    expect(manager.addDlg(gone)).toBe(false);
    expect([gone.m_pkUIDialogManager, order(), manager.m_iDialogListChangeCount]).toEqual([null, ["A"], 1]);
    const other = new CKTDGUIDialogManager(w);
    const b = made("B");
    b.m_pkUIDialogManager = other;
    expect(manager.addDlg(b)).toBe(false);
    expect([is(b.m_pkUIDialogManager, other), order(), manager.m_setDialog.has(b)]).toEqual([true, ["A"], false]);
  });

  test("a dialog goes behind the dialogs of its layer and in front of the lower layers; the m_bFront dialogs come after all the others", () => {
    const { manager, made, order, counts } = managerWorld();
    const specs: [string, boolean, number][] = [
      ["A", false, 5], ["B", false, 3], ["C", false, 5], ["D", true, 0], ["E", false, 4], ["F", true, -1], ["G", true, 0], ["H", false, 9],
    ];
    const want = [
      ["A"], ["B", "A"], ["B", "A", "C"], ["B", "A", "C", "D"], ["B", "E", "A", "C", "D"], ["B", "E", "A", "C", "F", "D"],
      ["B", "E", "A", "C", "F", "D", "G"], ["B", "E", "A", "C", "H", "F", "D", "G"],
    ];
    specs.forEach(([n, f, l], i) => {
      expect(manager.addDlg(made(n, f, l))).toBe(true);
      expect(order()).toEqual(want[i]!);
    });
    // each dialog keeps the count of the change that put it there (A 1 .. H 8): B 2, E 5, A 1, C 3, H 8, F 6, D 4, G 7
    expect([manager.m_iDialogListChangeCount, counts()]).toEqual([8, [2, 5, 1, 3, 8, 6, 4, 7]]);
  });

  test("the count of changes goes back to 1 above 2147483637, on every change of the list", () => {
    const { manager, made } = managerWorld();
    manager.m_iDialogListChangeCount = 2147483636;
    const [a, b, c] = [made("A"), made("B"), made("C")] as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    manager.addDlg(a);
    expect([manager.m_iDialogListChangeCount, a.m_iDialogListChangeCount]).toEqual([2147483637, 2147483637]);
    manager.addDlg(b);
    expect([manager.m_iDialogListChangeCount, b.m_iDialogListChangeCount]).toEqual([1, 1]);
    manager.addDlg(c);
    manager.m_iDialogListChangeCount = 2147483637;
    expect(manager.removeFromDialogList(c)).toBe(true);
    expect([manager.m_iDialogListChangeCount, c.m_iDialogListChangeCount]).toEqual([1, 0]);
    manager.m_iDialogListChangeCount = 2147483636; // the removal inside ChangeSequence makes 2147483637, the insertion wraps
    manager.changeSequence(a, false);
    expect([manager.m_iDialogListChangeCount, a.m_iDialogListChangeCount]).toEqual([1, -1]);
    manager.m_iDialogListChangeCount = 2147483636;
    expect(manager.changeSequence(a, b, true, true)).toBe(true);
    expect([manager.m_iDialogListChangeCount, a.m_iDialogListChangeCount]).toEqual([1, 1]);
  });

  test("CountModalDialog is asked for the added dialog: +1 when it is not modal, is shown and has no slot", () => {
    const { manager, made } = managerWorld();
    manager.addDlg(made("a"));
    expect(manager.m_iModalDialogCount).toBe(1);
    manager.addDlg(made("modal", false, 0, true));
    const hidden = made("hidden");
    hidden.m_bShow = false;
    manager.addDlg(hidden);
    const slotted = made("slotted");
    slotted.m_bHasSlot = true;
    manager.addDlg(slotted);
    expect(manager.m_iModalDialogCount).toBe(1);
    manager.addDlg(made("b"));
    expect(manager.m_iModalDialogCount).toBe(2);
  });

  test("CheckModalDlg (328DE260): more than 0 dialogs that are not modal", () => {
    const { manager } = managerWorld();
    const answers = [-1, 0, 1, 2].map((n) => {
      manager.m_iModalDialogCount = n;
      return manager.checkModalDlg();
    });
    expect(answers).toEqual([false, false, true, true]);
  });
});

describe("CKTDGUIDialogManager: _RemoveFromDialogList (328E1180) and the walks that stand on a dialog", () => {
  test("false for a dialog that is not in the list; else it leaves the list and the set, the dialogs are counted again", () => {
    const { manager, made, added, order } = managerWorld();
    const [a, b, c] = added(["A"], ["B"], ["C"]) as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    const hidden = made("H");
    hidden.m_bShow = false;
    manager.addDlg(hidden);
    expect(manager.m_iModalDialogCount).toBe(3);
    const stranger = made("S");
    manager.m_setDialog.add(stranger); // in the set but not in the list: nothing happens
    expect(manager.removeFromDialogList(stranger)).toBe(false);
    expect([manager.m_iDialogListChangeCount, manager.m_setDialog.has(stranger), stranger.m_iDialogListChangeCount]).toEqual([4, true, 0]);
    manager.m_iModalDialogCount = 99; // (the removal counts them again from nothing)
    expect(manager.removeFromDialogList(b)).toBe(true);
    expect([order(), manager.m_setDialog.has(b), manager.m_iDialogListChangeCount, b.m_iDialogListChangeCount, manager.m_iModalDialogCount]).toEqual([
      ["A", "C", "H"], false, 5, 0, 2,
    ]);
    expect(is(b.m_pkUIDialogManager, manager)).toBe(true); // it keeps its manager (UnmanageDlg lets it go)
    expect(manager.removeFromDialogList(b)).toBe(false);
    expect(manager.m_iDialogListChangeCount).toBe(5);
    void a;
    void c;
  });

  /** the dialogs of a list `A, B, C ..` that record when they are drawn / moved */
  function walkers(...names: string[]) {
    const s = managerWorld();
    const ds = s.added(...names.map((n): [string] => [n]));
    const log: string[] = [];
    for (const d of ds) {
      d.onFrameRender = (force?: boolean) => {
        log.push(`${d.m_Name}${force === false ? "" : "?"}`);
        return 0;
      };
      d.onFrameMove = () => {
        log.push(d.m_Name);
        return 0;
      };
      d.m_bModal = true;
    }
    return { ...s, ds, log };
  }

  test("a forward walk (OnFrameRender) that has a dialog taken out in front of it goes on with the dialog after it", () => {
    const { manager, ds, log } = walkers("A", "B", "C");
    const [a, b, c] = ds as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    a.onFrameRender = () => {
      log.push("A");
      manager.removeFromDialogList(b);
      return 0;
    };
    manager.onFrameRender(false);
    expect(log).toEqual(["A", "C"]);
    expect(manager.m_vecIterator.length).toBe(0);
    // the last dialog taken out: the walk is over; the dialog that is being visited may take itself out
    const w2 = walkers("A", "B", "C");
    w2.ds[0]!.onFrameRender = () => {
      w2.log.push("A");
      w2.manager.removeFromDialogList(w2.ds[1]!);
      w2.manager.removeFromDialogList(w2.ds[2]!);
      return 0;
    };
    w2.manager.onFrameRender(false);
    expect(w2.log).toEqual(["A"]);
    const w3 = walkers("A", "B", "C");
    w3.ds[0]!.onFrameRender = () => {
      w3.log.push("A");
      w3.manager.removeFromDialogList(w3.ds[0]!);
      return 0;
    };
    w3.manager.onFrameRender(false);
    expect(w3.log).toEqual(["A", "B", "C"]);
    void c;
  });

  test("a backward walk (OnFrameMove) that has a dialog taken out behind it goes on with the dialog before it; the first one taken out ends the walk", () => {
    const { manager, ds, log } = walkers("A", "B", "C");
    const [, b, c] = ds as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    c.onFrameMove = () => {
      log.push("C");
      manager.removeFromDialogList(b);
      return 0;
    };
    manager.onFrameMove(0, 0);
    expect(log).toEqual(["C", "A"]);
    expect(manager.m_vecReverseIterator.length).toBe(0);
    const w2 = walkers("A", "B");
    w2.ds[1]!.onFrameMove = () => {
      w2.log.push("B");
      w2.manager.removeFromDialogList(w2.ds[0]!);
      return 0;
    };
    w2.manager.onFrameMove(0, 0);
    expect(w2.log).toEqual(["B"]);
    const w3 = walkers("A", "B", "C");
    w3.ds[2]!.onFrameMove = () => {
      w3.log.push("C");
      w3.manager.removeFromDialogList(w3.ds[2]!);
      return 0;
    };
    w3.manager.onFrameMove(0, 0);
    expect(w3.log).toEqual(["C", "B", "A"]);
  });

  test("a dialog that joins during a walk and lands between the one being visited and the next one is not visited: the position moves on before the visit", () => {
    // forward (OnFrameRender): A (layer 0) is visited, B (layer 5) is next; X (layer 3) lands between them
    const f = managerWorld();
    const [fa, fb] = f.added(["A", false, 0], ["B", false, 5]) as [CKTDGUIDialog, CKTDGUIDialog];
    const fx = f.made("X", false, 3);
    const flog: string[] = [];
    for (const d of [fa, fb, fx]) {
      d.onFrameRender = () => {
        flog.push(d.m_Name);
        return 0;
      };
    }
    fa.onFrameRender = () => {
      flog.push("A");
      expect(f.manager.addDlg(fx)).toBe(true);
      return 0;
    };
    f.manager.onFrameRender(false);
    expect([flog, f.order(), f.manager.m_vecIterator.length]).toEqual([["A", "B"], ["A", "X", "B"], 0]);
    // backward (OnFrameMove): B is visited first, A is next; X lands between them
    const b = managerWorld();
    const [ba, bb] = b.added(["A", false, 0], ["B", false, 5]) as [CKTDGUIDialog, CKTDGUIDialog];
    const bx = b.made("X", false, 3);
    const blog: string[] = [];
    for (const d of [ba, bb, bx]) {
      d.onFrameMove = () => {
        blog.push(d.m_Name);
        return 0;
      };
    }
    bb.onFrameMove = () => {
      blog.push("B");
      expect(b.manager.addDlg(bx)).toBe(true);
      return 0;
    };
    b.manager.onFrameMove(0, 0);
    expect([blog, b.order(), b.manager.m_vecReverseIterator.length]).toEqual([["B", "A"], ["A", "X", "B"], 0]);
  });

  test("every walk that is going on is moved, not only the last one (forward walks inside a forward walk)", () => {
    const { manager, ds, log } = walkers("A", "B", "C", "D");
    const [a, b] = ds as [CKTDGUIDialog, CKTDGUIDialog];
    let calls = 0;
    a.onFrameRender = () => {
      log.push("A");
      if (calls++ === 0) manager.onFrameRender(false); // the nested walk visits A again, and then B is taken out while both walks stand on it
      else manager.deleteDlg(b);
      return 0;
    };
    manager.onFrameRender(false);
    expect(log).toEqual(["A", "A", "C", "D", "C", "D"]);
    expect([manager.m_vecIterator.length, b.destroyed]).toEqual([0, true]);
  });

  test("every walk that is going on is moved (backward walks inside a backward walk)", () => {
    const { manager, ds, log } = walkers("A", "B", "C", "D");
    const [, , c, d] = ds as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    let calls = 0;
    d.onFrameMove = () => {
      log.push("D");
      if (calls++ === 0) manager.onFrameMove(0, 0);
      else manager.deleteDlg(c);
      return 0;
    };
    manager.onFrameMove(0, 0);
    expect(log).toEqual(["D", "D", "B", "A", "B", "A"]);
    expect([manager.m_vecReverseIterator.length, c.destroyed]).toEqual([0, true]);
  });

  test("a walk that is cut short by an Error leaves no position behind", () => {
    const { manager, ds } = walkers("A", "B");
    ds[0]!.onFrameRender = () => {
      throw new Error("boom");
    };
    ds[1]!.onFrameMove = () => {
      throw new Error("boom");
    };
    expect(() => manager.onFrameRender(false)).toThrow("boom");
    expect(() => manager.onFrameMove(0, 0)).toThrow("boom");
    expect([manager.m_vecIterator.length, manager.m_vecReverseIterator.length]).toEqual([0, 0]);
  });
});

describe("CKTDGUIDialogManager: ChangeFront (328DDBE0), ChangeLayer (328DDC90)", () => {
  test("a dialog that is not the manager's is not changed; a value that does not change leaves the list alone", () => {
    const { manager, made, added, order } = managerWorld();
    const [p, q] = added(["P", false, 1], ["Q", false, 2]) as [CKTDGUIDialog, CKTDGUIDialog];
    const stranger = made("S", false, 3);
    expect(manager.changeLayer(null, 1)).toBe(false);
    expect(manager.changeFront(null, true)).toBe(false);
    expect(manager.changeLayer(stranger, 9)).toBe(false);
    expect(manager.changeFront(stranger, true)).toBe(false);
    expect([stranger.m_iLayer, stranger.m_bFront]).toEqual([3, false]);
    expect(manager.changeLayer(q, 2)).toBe(true);
    expect(manager.changeFront(q, false)).toBe(true);
    expect([order(), manager.m_iDialogListChangeCount]).toEqual([["P", "Q"], 2]);
    manager.unmanageDlg(p);
    expect(manager.changeLayer(p, 7)).toBe(false); // its manager is gone
    expect(p.m_iLayer).toBe(1);
  });

  test("a dialog whose layer or front flag changes leaves the list and comes back on top of its new group", () => {
    const { manager, added, order, counts } = managerWorld();
    const [p, q, , s] = added(["P", false, 1], ["Q", false, 2], ["R", false, 2], ["S", true, 0]) as CKTDGUIDialog[] as [
      CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog,
    ];
    expect([order(), manager.m_iDialogListChangeCount, counts()]).toEqual([["P", "Q", "R", "S"], 4, [1, 2, 3, 4]]);
    // P goes to layer 2: out (5), behind Q and R (6)
    expect(manager.changeLayer(p, 2)).toBe(true);
    expect([order(), manager.m_iDialogListChangeCount, counts(), p.m_iLayer]).toEqual([["Q", "R", "P", "S"], 6, [2, 3, 6, 4], 2]);
    // Q becomes a front dialog: out (7), behind S (8)
    expect(manager.changeFront(q, true)).toBe(true);
    expect([order(), manager.m_iDialogListChangeCount, counts(), q.m_bFront]).toEqual([["R", "P", "S", "Q"], 8, [3, 6, 4, 8], true]);
    expect(manager.changeFront(s, true)).toBe(true); // already front
    expect([order(), manager.m_iDialogListChangeCount]).toEqual([["R", "P", "S", "Q"], 8]);
    // S is not a front dialog any more: it goes in front of layer 2 (layer 0 < 2), out (9), in (10)
    expect(manager.changeFront(s, false)).toBe(true);
    expect([order(), manager.m_iDialogListChangeCount, counts(), s.m_bFront]).toEqual([["S", "R", "P", "Q"], 10, [10, 3, 6, 8], false]);
  });
});

describe("CKTDGUIDialogManager: ChangeSequence (328DDF20)", () => {
  test("to the top: behind the dialogs of its layer; to the bottom: in front of them; a dialog that is where it is told and made the last change stays", () => {
    const { manager, made, added, order, counts } = managerWorld();
    const [a, b, c, d, e] = added(["A"], ["B"], ["C"], ["D", false, 1], ["E", true]) as [
      CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog,
    ];
    void b;
    void c;
    const state = (): [string[], number, number[]] => [order(), manager.m_iDialogListChangeCount, counts()];
    expect(manager.changeSequence(null, true)).toBe(false);
    expect(manager.changeSequence(made("S"), false)).toBe(false);
    expect(state()).toEqual([["A", "B", "C", "D", "E"], 5, [1, 2, 3, 4, 5]]);
    expect(manager.changeSequence(e, true)).toBe(true); // the last change put it on top
    expect(state()).toEqual([["A", "B", "C", "D", "E"], 5, [1, 2, 3, 4, 5]]);
    expect(manager.changeSequence(a, true)).toBe(true); // out (6), in (7): in front of D (layer 1) and behind B, C (layer 0)
    expect(state()).toEqual([["B", "C", "A", "D", "E"], 7, [2, 3, 7, 4, 5]]);
    expect(manager.changeSequence(a, true)).toBe(true);
    expect(state()).toEqual([["B", "C", "A", "D", "E"], 7, [2, 3, 7, 4, 5]]);
    expect(manager.changeSequence(a, false)).toBe(true); // a positive count is not "at the bottom": out (8), before B (layer 0 <= 0), count -9
    expect(state()).toEqual([["A", "B", "C", "D", "E"], 9, [-9, 2, 3, 4, 5]]);
    expect(manager.changeSequence(a, false)).toBe(true);
    expect(state()).toEqual([["A", "B", "C", "D", "E"], 9, [-9, 2, 3, 4, 5]]);
    expect(manager.changeSequence(a, true)).toBe(true); // a negative count is not "on top"
    expect(state()).toEqual([["B", "C", "A", "D", "E"], 11, [2, 3, 11, 4, 5]]);
    expect(manager.changeSequence(e, false)).toBe(true); // a front dialog: nobody else is front: it stays at the end, with a negative count
    expect(state()).toEqual([["B", "C", "A", "D", "E"], 13, [2, 3, 11, 4, -13]]);
    const f = made("F", true);
    manager.addDlg(f);
    expect(state()).toEqual([["B", "C", "A", "D", "E", "F"], 14, [2, 3, 11, 4, -13, 14]]);
    expect(manager.changeSequence(e, false)).toBe(true); // another dialog changed the list since: its count -13 is not the last one's: before F
    expect(state()).toEqual([["B", "C", "A", "D", "E", "F"], 16, [2, 3, 11, 4, -16, 14]]);
    expect(manager.changeSequence(f, false)).toBe(true); // the front dialogs: before E (layer 0 <= 0)
    expect(state()).toEqual([["B", "C", "A", "D", "F", "E"], 18, [2, 3, 11, 4, -18, -16]]);
    const x = made("X", false, 1);
    manager.addDlg(x); // behind D (layer 1: not before an equal layer) and before the front dialogs
    expect(state()).toEqual([["B", "C", "A", "D", "X", "F", "E"], 19, [2, 3, 11, 4, 19, -18, -16]]);
    expect(manager.changeSequence(x, false)).toBe(true); // before D: an equal layer counts for the bottom
    expect(state()).toEqual([["B", "C", "A", "X", "D", "F", "E"], 21, [2, 3, 11, -21, 4, -18, -16]]);
    expect(manager.changeSequence(x, true)).toBe(true);
    expect(state()).toEqual([["B", "C", "A", "D", "X", "F", "E"], 23, [2, 3, 11, 4, 23, -18, -16]]);
    expect(manager.changeSequence(d, false)).toBe(true);
    expect(state()).toEqual([["B", "C", "A", "D", "X", "F", "E"], 25, [2, 3, 11, -25, 23, -18, -16]]);
  });

  test("a non-front dialog at the bottom goes in front of the first front dialog even when its layer is higher; the modal dialogs are counted again", () => {
    const { manager, added, order } = managerWorld();
    const [z, , , g] = added(["Z", false, 9], ["B", false, 1], ["F", true, 0], ["G", true, 5]) as [
      CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog,
    ];
    expect(order()).toEqual(["B", "Z", "F", "G"]);
    manager.m_iModalDialogCount = 0;
    expect(manager.changeSequence(z, false)).toBe(true); // B (layer 1) is below; F is front: before F
    expect(order()).toEqual(["B", "Z", "F", "G"]);
    expect(manager.m_iModalDialogCount).toBe(4); // out: counted again (3), in: +1
    expect(manager.changeSequence(g, false)).toBe(true); // a front dialog (layer 5): F has layer 0 < 5: behind it, at the end
    expect(order()).toEqual(["B", "Z", "F", "G"]);
  });
});

describe("CKTDGUIDialogManager: ChangeSequence to the bottom, a dialog the list does not hold", () => {
  test("the removal finds nothing and recounts nothing: the modal dialogs are counted with the dialog (+1), not again", () => {
    const { manager, made, added, order, counts } = managerWorld();
    added(["A"], ["B"]);
    const ghost = made("G");
    ghost.m_pkUIDialogManager = manager;
    manager.m_setDialog.add(ghost); // in the set and not in the list
    manager.m_iModalDialogCount = 99;
    expect(manager.changeSequence(ghost, false)).toBe(true);
    expect([order(), counts(), manager.m_iDialogListChangeCount, manager.m_iModalDialogCount]).toEqual([["G", "A", "B"], [-3, 1, 2], 3, 100]);
  });
});

describe("CKTDGUIDialogManager: ChangeSequence with a pivot (328DDD40)", () => {
  function pivots() {
    const s = managerWorld();
    const [p, q, r, t] = s.added(["P", false, 1], ["Q", false, 1], ["R", false, 2], ["T", true, 1]) as [
      CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog,
    ];
    return { ...s, p, q, r, t };
  }

  test("the dialogs must be the manager's and different; without bChangeLayer they must be in one layer; nothing changes when it fails", () => {
    const { manager, made, order, counts, p, q, r, t } = pivots();
    const stranger = made("S");
    const state = () => [order(), manager.m_iDialogListChangeCount, counts()];
    const before = state();
    expect(before).toEqual([["P", "Q", "R", "T"], 4, [1, 2, 3, 4]]);
    expect(manager.changeSequence(null, q, true, true)).toBe(false);
    expect(manager.changeSequence(stranger, q, true, true)).toBe(false);
    expect(manager.changeSequence(p, null, true, true)).toBe(false);
    expect(manager.changeSequence(p, stranger, true, true)).toBe(false);
    expect(manager.changeSequence(p, p, true, true)).toBe(false);
    expect(manager.changeSequence(p, r, true, false)).toBe(false); // another layer
    expect(manager.changeSequence(r, t, true, false)).toBe(false); // another front flag (and layer)
    expect(manager.changeSequence(t, r, false, false)).toBe(false);
    expect(manager.changeSequence(p, t, true, false)).toBe(false); // another front flag, the same layer
    expect(manager.changeSequence(t, q, false, false)).toBe(false);
    expect(state()).toEqual(before);
    expect([p.m_iLayer, r.m_iLayer, t.m_bFront, t.m_iLayer]).toEqual([1, 2, true, 1]);
    void q;
  });

  test("the dialog goes before the pivot, or after it (bOver); with bChangeLayer it takes the pivot's front flag and layer; the modal dialogs are not counted again for it", () => {
    const { manager, added, order, counts, p, q, r, t } = pivots();
    const state = () => [order(), manager.m_iDialogListChangeCount, counts()];
    expect(manager.changeSequence(p, q, false, false)).toBe(true); // out (5), before Q (6)
    expect(state()).toEqual([["P", "Q", "R", "T"], 6, [6, 2, 3, 4]]);
    expect(manager.m_iModalDialogCount).toBe(3); // the removal counted the other three; P came back without being counted
    expect(manager.changeSequence(p, q, true, false)).toBe(true); // out (7), after Q (8)
    expect(state()).toEqual([["Q", "P", "R", "T"], 8, [2, 8, 3, 4]]);
    expect(manager.changeSequence(t, p, false, true)).toBe(true); // T takes (not front, layer 1): out (9), before P (10)
    expect(state()).toEqual([["Q", "T", "P", "R"], 10, [2, 10, 8, 3]]);
    expect([t.m_bFront, t.m_iLayer]).toEqual([false, 1]);
    expect(manager.changeSequence(r, q, true, true)).toBe(true); // R takes layer 1: out (11), after Q (12)
    expect(state()).toEqual([["Q", "R", "T", "P"], 12, [2, 12, 10, 8]]);
    expect([r.m_bFront, r.m_iLayer]).toEqual([false, 1]);
    expect(manager.m_iModalDialogCount).toBe(3);
    // the count stays one short (four dialogs): a dialog that joins adds its one to it, nothing is counted again
    added(["U", false, 1]);
    expect([manager.m_iModalDialogCount, order()]).toEqual([4, ["Q", "R", "T", "P", "U"]]);
  });

  test("a pivot that the set knows but the list does not: the dialog is taken out and takes the flags, and stays out", () => {
    const { manager, made, order, p } = pivots();
    const ghost = made("X", true, 7);
    ghost.m_pkUIDialogManager = manager;
    manager.m_setDialog.add(ghost);
    expect(manager.changeSequence(p, ghost, true, true)).toBe(false);
    expect([order(), manager.m_setDialog.has(p), p.m_iDialogListChangeCount, p.m_bFront, p.m_iLayer, manager.m_iDialogListChangeCount]).toEqual([
      ["Q", "R", "T"], false, 0, true, 7, 5,
    ]);
    // the same with a list that is empty afterwards
    const s = managerWorld();
    const [only] = s.added(["O"]) as [CKTDGUIDialog];
    const g2 = s.made("G", true, 3);
    g2.m_pkUIDialogManager = s.manager;
    s.manager.m_setDialog.add(g2);
    expect(s.manager.changeSequence(only, g2, false, true)).toBe(false);
    expect([s.order(), only.m_bFront, only.m_iLayer]).toEqual([[], true, 3]);
  });
});

describe("CKTDGUIDialogManager: UnmanageDlg (328E0C90), DeleteDlg (328DE540), ClearAllDlg (328DE270), ClearAllOKAndCancelMsgDlg (328DE360)", () => {
  test("UnmanageDlg takes a dialog of the manager out of the list and the manager, and it lives on; DeleteDlg also destroys it", () => {
    const { manager, made, added, order } = managerWorld();
    const [, b, c] = added(["A"], ["B"], ["C"]) as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    expect(manager.unmanageDlg(null)).toBe(false);
    expect(manager.unmanageDlg(made("S"))).toBe(false);
    expect(manager.unmanageDlg(b)).toBe(true);
    expect([order(), b.m_pkUIDialogManager, manager.m_setDialog.has(b), b.destroyed, b.m_iDialogListChangeCount]).toEqual([["A", "C"], null, false, false, 0]);
    expect(manager.unmanageDlg(b)).toBe(false);
    expect(manager.deleteDlg(b)).toBe(false); // not the manager's any more: it is not destroyed
    expect(b.destroyed).toBe(false);
    expect(manager.deleteDlg(null)).toBe(false);
    expect(manager.deleteDlg(made("S"))).toBe(false);
    const real = c.Destroy.bind(c);
    let atDestroy: unknown[] = [];
    c.Destroy = () => {
      atDestroy = [is(c.m_pkUIDialogManager, null), order()];
      real();
    };
    expect(manager.deleteDlg(c)).toBe(true);
    expect(atDestroy).toEqual([true, ["A"]]); // UnmanageDlg came first
    expect([order(), c.m_pkUIDialogManager, c.destroyed, manager.m_setDialog.has(c)]).toEqual([["A"], null, true, false]);
  });

  test("ClearAllDlg: the first dialog of the list leaves and is destroyed, until none is left", () => {
    const { manager, added, order } = managerWorld();
    const ds = added(["A"], ["B", false, 1], ["C"]);
    const log: string[] = [];
    for (const d of ds) {
      const real = d.Destroy.bind(d);
      d.Destroy = () => {
        log.push(d.m_Name);
        real();
      };
    }
    manager.clearAllDlg();
    expect(log).toEqual(["A", "C", "B"]);
    expect([order(), manager.m_setDialog.size, ds.map((d) => d.destroyed), ds.map((d) => d.m_pkUIDialogManager)]).toEqual([
      [], 0, [true, true, true], [null, null, null],
    ]);
    manager.clearAllDlg(); // nothing to do
  });

  test("ClearAllDlg: a first dialog that the manager does not know (CheckDlg) never leaves: the exe loops forever, the port reports it", () => {
    const { manager, made } = managerWorld();
    const stray = made("S");
    manager.m_listDialog.push(stray);
    expect(() => manager.clearAllDlg()).toThrow("never leaves the loop");
    expect(stray.destroyed).toBe(true);
  });

  test("ClearAllOKAndCancelMsgDlg: the OK / Cancel message boxes are taken out and destroyed; the others stay; true", () => {
    const { manager, made, added, order } = managerWorld();
    const [a, b, c, d] = added(["A"], ["B"], ["C"], ["D"]) as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    b.m_bOKAndCancelMsgBox = true;
    d.m_bOKAndCancelMsgBox = true;
    expect(manager.clearAllOKAndCancelMsgDlg()).toBe(true);
    expect([order(), [a, b, c, d].map((x) => x.destroyed), [a, b, c, d].map((x) => x.m_pkUIDialogManager === null)]).toEqual([
      ["A", "C"], [false, true, false, true], [false, true, false, true],
    ]);
    expect(manager.m_vecIterator.length).toBe(0);
    // a box the manager does not know is destroyed but its entry stays in the list
    const e = made("E");
    e.m_bOKAndCancelMsgBox = true;
    manager.m_listDialog.push(e);
    expect(manager.clearAllOKAndCancelMsgDlg()).toBe(true);
    expect([order(), e.destroyed]).toEqual([["A", "C", "E"], true]);
  });

  test("DeleteDlg and ClearAllDlg destroy the dialog the way ~CKTDGUIDialog does: its controls are destroyed", () => {
    const { w, manager, added } = managerWorld();
    const [a] = added(["A"]) as [CKTDGUIDialog];
    const c = new CKTDGUINavigation(w);
    c.m_Name = "control";
    const log: string[] = [];
    c.Destroy = () => void log.push("control");
    a.AddControl(c);
    expect(manager.deleteDlg(a)).toBe(true);
    expect(log).toEqual(["control"]);
  });
});

describe("CKTDGUIDialogManager: GetDialog (328DE820) and the registered GetDialog (328DEB20)", () => {
  test("the list is walked from the back for the first dialog of the name when the count of changes moved since the name was looked up", () => {
    const { manager, made, added } = managerWorld();
    expect(manager.getDialog(null)).toBe(null);
    expect(manager.m_mapDialogListChangeCountWhenLastGetDialog.size).toBe(0);
    expect(manager.getDialog("X")).toBe(null); // 0 is 0: not walked; operator[] made the entry
    expect([manager.m_mapDialogListChangeCountWhenLastGetDialog.get("X"), manager.m_mapDialogListChangeCountWhenLastGetDialog.size]).toEqual([0, 1]);
    const early = made("P");
    manager.m_listDialog.push(early); // not through AddDlg: the count of changes is still 0, and so is the count of the name
    expect(manager.getDialog("P")).toBe(null);
    expect(manager.m_mapDialogListChangeCountWhenLastGetDialog.get("P")).toBe(0);
    manager.m_listDialog.erase(manager.m_listDialog.head.next);
    const [a] = added(["A"]) as [CKTDGUIDialog];
    expect(is(manager.getDialog("A"), a)).toBe(true); // 0 is not 1: walked, found
    expect([manager.m_mapDialogListChangeCountWhenLastGetDialog.get("A"), is(manager.m_mapDialog.get("A"), a)]).toEqual([1, true]);
    expect(manager.getDialog("a")).toBe(null); // the name is compared exactly
    expect(manager.getDialog("B")).toBe(null); // walked: none; the count is noted
    expect(manager.m_mapDialogListChangeCountWhenLastGetDialog.get("B")).toBe(1);
    // the list changes without the count (not through the manager's functions): the cache does not see it
    const b = made("B");
    manager.m_listDialog.push(b);
    expect(manager.getDialog("B")).toBe(null);
    manager.m_iDialogListChangeCount = 5; // a change the cache has not seen
    expect(is(manager.getDialog("B"), b)).toBe(true);
    expect(is(manager.getDialog("A"), a)).toBe(true);
    expect(manager.m_mapDialogListChangeCountWhenLastGetDialog.get("A")).toBe(5);
  });

  test("a name of two dialogs is the first one of the list, not the first added", () => {
    const { manager, added } = managerWorld();
    const [high, low] = added(["D", false, 5], ["D", false, 1]) as [CKTDGUIDialog, CKTDGUIDialog];
    expect(is(manager.getDialog("D"), low)).toBe(true);
    expect(is(manager.getDialog("D"), low)).toBe(true); // (and from the cache)
    void high;
  });

  test("exe bug: a name that was found and then lost is answered from the old entry the second time", () => {
    const { manager, added } = managerWorld();
    const [a] = added(["A"]) as [CKTDGUIDialog];
    expect(is(manager.getDialog("A"), a)).toBe(true);
    manager.unmanageDlg(a); // the count moves (2): a is not in the list any more
    expect(manager.getDialog("A")).toBe(null); // walked: not found; the count is noted
    expect(is(manager.getDialog("A"), a)).toBe(true); // not walked: m_mapDialog still holds it
    expect(is(manager.GetDialog("A"), a)).toBe(true);
  });

  test("the registered GetDialog answers nothing for no name, an empty name, an unknown name and a dialog that was destroyed", () => {
    const { manager, added } = managerWorld();
    const [a, b] = added(["A"], ["B"]) as [CKTDGUIDialog, CKTDGUIDialog];
    expect(manager.GetDialog(undefined)).toBe(undefined);
    expect(manager.GetDialog("")).toBe(undefined);
    expect(manager.m_mapDialogListChangeCountWhenLastGetDialog.size).toBe(0);
    expect(manager.GetDialog("nobody")).toBe(undefined);
    expect(manager.m_mapDialogListChangeCountWhenLastGetDialog.get("nobody")).toBe(2); // walked: none; the count is noted
    expect(is(manager.GetDialog("A"), a)).toBe(true);
    expect(is(manager.GetDialog("B"), b)).toBe(true);
    manager.deleteDlg(b);
    expect(manager.getDialog("B")).toBe(null); // walked: gone
    expect(is(manager.getDialog("B"), b)).toBe(true); // the old entry: a destroyed dialog
    expect(manager.GetDialog("B")).toBe(undefined); // its handle is stale: nothing
  });
});

describe("CKTDGUIDialogManager: what the scripts call (SetShow 328CDFA0, GetDialog 328DEB20)", () => {
  test("SetShow(bool) sets m_bShow; GetDialog(name) answers the dialog, nil for an unknown or an empty name and for a dialog that was destroyed", () => {
    const { manager, added, wrap, m } = managerWorld();
    const [a, b] = added(["A"], ["B"]) as [CKTDGUIDialog, CKTDGUIDialog];
    const o = wrap(manager, "CKTDGUIDialogManager");
    m(o, "SetShow", false);
    expect(manager.m_bShow).toBe(false);
    m(o, "SetShow", true);
    expect(manager.m_bShow).toBe(true);
    const found = m(o, "GetDialog", "A");
    expect([found.length, is((found[0] as { data: unknown }).data, a)]).toEqual([1, true]);
    expect(is((m(o, "GetDialog", "B")[0] as { data: unknown }).data, b)).toBe(true);
    expect([m(o, "GetDialog", "nobody")[0], m(o, "GetDialog", "")[0]]).toEqual([undefined, undefined]);
    manager.deleteDlg(b);
    expect(m(o, "GetDialog", "B")[0]).toBe(undefined);
  });
});

describe("CKTDGUIDialogManager: the getters", () => {
  test("GetFirstFrontModalDlg (328DEE90): from the front, the first dialog that is shown and not modal; null when there is none", () => {
    const { manager, added } = managerWorld();
    expect(manager.getFirstFrontModalDlg()).toBe(null);
    const [a, b, c, d] = added(["A", false, 0, true], ["B", false, 0, false], ["C", false, 0, false], ["D", false, 0, true]) as [
      CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog,
    ];
    c.m_bShow = false;
    expect(is(manager.getFirstFrontModalDlg(), b)).toBe(true); // D is modal, C is hidden
    b.m_bEnable = false; // (enabled or not does not matter)
    expect(is(manager.getFirstFrontModalDlg(), b)).toBe(true);
    b.m_bShow = false;
    expect(manager.getFirstFrontModalDlg()).toBe(null);
    c.m_bShow = true;
    expect(is(manager.getFirstFrontModalDlg(), c)).toBe(true);
    b.m_bShow = true; // B and C both qualify: the one nearer the front
    expect(is(manager.getFirstFrontModalDlg(), c)).toBe(true);
    void a;
    void d;
  });

  test("GetCloseDialogByESC (328DE690): from the front; DLG_MsgBox is passed; a message box that is shown is the answer and turns the input on", () => {
    const { w, manager, added } = managerWorld();
    expect(manager.getCloseDialogByESC()).toBe(null);
    const [a, b, c, d] = added(["A", false, 0, true], ["B", false, 0, true], ["C", false, 0, true], ["DLG_MsgBox", false, 0, false]) as [
      CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog,
    ];
    w.diManager.m_bEnabled = false;
    // nothing wants Escape: the modal dialogs are passed, and the message box is skipped even though it is not modal
    d.m_CloseCustomUIEventID = 5;
    expect(manager.getCloseDialogByESC()).toBe(null);
    a.m_CloseCustomUIEventID = 3;
    expect(is(manager.getCloseDialogByESC(), a)).toBe(true); // the close event makes it the answer (the input is left as it is)
    expect(w.diManager.m_bEnabled).toBe(false);
    b.m_CloseCustomUIEventID = 4;
    expect(is(manager.getCloseDialogByESC(), b)).toBe(true); // nearer the front
    b.m_bEnable = false;
    expect(is(manager.getCloseDialogByESC(), a)).toBe(true);
    b.m_bEnable = true;
    b.m_bShow = false;
    expect(is(manager.getCloseDialogByESC(), a)).toBe(true);
    b.m_bShow = true;
    // a dialog that is shown, enabled and not modal that has no close event ends the search with nothing
    c.m_bModal = false;
    expect(manager.getCloseDialogByESC()).toBe(null);
    c.m_CloseCustomUIEventID = 9; // a close event first: the answer
    expect(is(manager.getCloseDialogByESC(), c)).toBe(true);
    c.m_CloseCustomUIEventID = -1;
    c.m_bEnable = false; // not enabled: passed
    expect(is(manager.getCloseDialogByESC(), b)).toBe(true);
    c.m_bEnable = true;
    c.m_bShow = false; // hidden: passed
    expect(is(manager.getCloseDialogByESC(), b)).toBe(true);
  });

  test("GetCloseDialogByESC: an OK / Cancel box or DLG_OKMsgBox that is shown is the answer even with no close event, and the input is turned on", () => {
    const { w, manager, added } = managerWorld();
    const [a, b, c] = added(["A", false, 0, true], ["DLG_OKMsgBox", false, 0, true], ["C", false, 0, true]) as [
      CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog,
    ];
    a.m_CloseCustomUIEventID = 3;
    c.m_bOKAndCancelMsgBox = true;
    w.diManager.m_bEnabled = false;
    expect(is(manager.getCloseDialogByESC(), c)).toBe(true);
    expect(w.diManager.m_bEnabled).toBe(true);
    w.diManager.m_bEnabled = false;
    c.m_bShow = false; // hidden: it is passed (and does not stop the search)
    expect(is(manager.getCloseDialogByESC(), b)).toBe(true);
    expect(w.diManager.m_bEnabled).toBe(true);
    w.diManager.m_bEnabled = false;
    b.m_bShow = false;
    expect(is(manager.getCloseDialogByESC(), a)).toBe(true);
    expect(w.diManager.m_bEnabled).toBe(false);
    b.m_bShow = true;
    b.m_bEnable = false; // (a message box is the answer whether or not it is enabled)
    expect(is(manager.getCloseDialogByESC(), b)).toBe(true);
  });

  test("GetFocusInEditBox (328DEF20): the control that has the focus is an edit box or an IME edit box", () => {
    const { w, manager } = managerWorld();
    expect(manager.getFocusInEditBox()).toBe(false);
    const c = new CKTDGUINavigation(w);
    w.controlFocus = c;
    const answers = Object.values(UCT).map((type) => {
      c.m_ControlType = type;
      return manager.getFocusInEditBox();
    });
    expect(answers).toEqual(Object.values(UCT).map((type) => type === UCT.EDITBOX || type === UCT.IME_EDITBOX));
    expect(answers.filter(Boolean).length).toBe(2);
    w.controlFocus = null;
  });

  test("IsDraggingDialog (328DEF60): a dialog that is shown, enabled, can be moved by dragging and has the mouse down", () => {
    const { manager, added } = managerWorld();
    expect(manager.isDraggingDialog()).toBe(false);
    const [a, b] = added(["A"], ["B"]) as [CKTDGUIDialog, CKTDGUIDialog];
    const flags = ["m_bShow", "m_bEnable", "m_bEnableMoveByDrag", "m_bMouseDownForDrag"] as const;
    for (const d of [a, b]) for (const f of flags) d[f] = true;
    expect(manager.isDraggingDialog()).toBe(true);
    for (const flag of flags) {
      a[flag] = false;
      expect(manager.isDraggingDialog()).toBe(true); // B is still dragged
      b[flag] = false;
      expect(manager.isDraggingDialog()).toBe(false); // each of the four is needed
      a[flag] = true;
      expect(manager.isDraggingDialog()).toBe(true); // any dialog of the list will do: A alone
      b[flag] = true;
    }
    for (const f of flags) a[f] = false;
    expect(manager.isDraggingDialog()).toBe(true); // B alone
    for (const f of flags) b[f] = false;
    expect(manager.isDraggingDialog()).toBe(false);
  });

  test("SetStage (328E0B60): every dialog of the list belongs to the stage", () => {
    const { manager, made, added } = managerWorld();
    const ds = added(["A"], ["B"], ["C"]);
    const stage = { name: "stage" };
    manager.setStage(stage);
    expect(ds.map((d) => is(d.m_pStage, stage))).toEqual([true, true, true]);
    const late = made("L");
    expect(is(late.m_pStage, stage)).toBe(false);
  });
});

describe("CKTDGUIDialogManager::OnFrameMove (328DF0E0)", () => {
  function movers(...specs: [string, boolean?, number?][]) {
    const s = managerWorld();
    const ds = s.added(...specs);
    const log: string[] = [];
    for (const d of ds) {
      d.onFrameMove = (t: number, e: number) => {
        log.push(`${d.m_Name}@${t},${e}|${s.w.devices.massFiles.log.lastErrorLog}`);
        return 0;
      };
    }
    return { ...s, ds, log };
  }

  test("the dialogs that are enabled and shown move, from the front to the back, each with its name as the last error; 0", () => {
    const { w, manager, ds, log } = movers(["A"], ["B"], ["C"], ["D"], ["E"]);
    const [, b, c] = ds as CKTDGUIDialog[] as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    b.m_bEnable = false;
    c.m_bShow = false;
    expect(manager.onFrameMove(1.5, 0.25)).toBe(0);
    expect(log).toEqual(["E@1.5,0.25|E", "D@1.5,0.25|D", "A@1.5,0.25|A"]);
    expect(w.devices.massFiles.log.lastErrorLog).toBe("A");
    // nothing moves: the last error is left as it is
    const empty = movers();
    empty.w.devices.massFiles.log.lastErrorLog = "before";
    expect(empty.manager.onFrameMove(0, 0)).toBe(0);
    expect(empty.w.devices.massFiles.log.lastErrorLog).toBe("before");
    const hidden = movers(["A"]);
    hidden.ds[0]!.m_bShow = false;
    hidden.w.devices.massFiles.log.lastErrorLog = "before";
    hidden.manager.onFrameMove(0, 0);
    expect([hidden.log.length, hidden.w.devices.massFiles.log.lastErrorLog]).toEqual([0, "before"]);
  });

  test("the dialogs marked for deletion leave the list and the manager and are destroyed first; the others then move", () => {
    const { manager, ds, log, order } = movers(["A"], ["B"], ["C"]);
    const [a, b, c] = ds as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    b.m_bCheckAutoDeleteEnd = true;
    manager.onFrameMove(0, 0);
    expect(log).toEqual(["C@0,0|C", "A@0,0|A"]);
    expect([order(), b.destroyed, b.m_pkUIDialogManager, manager.m_setDialog.has(b), a.destroyed, c.destroyed]).toEqual([["A", "C"], true, null, false, false, false]);
    // two marked dialogs, one of them the dialog the walk is going to visit next
    const m2 = movers(["A"], ["B"], ["C"], ["D"]);
    m2.ds[0]!.m_bCheckAutoDeleteEnd = true;
    m2.ds[1]!.m_bCheckAutoDeleteEnd = true;
    m2.ds[3]!.m_bCheckAutoDeleteEnd = true;
    m2.manager.onFrameMove(0, 0);
    expect([m2.log, m2.order(), m2.ds.map((d) => d.destroyed)]).toEqual([["C@0,0|C"], ["C"], [true, true, false, true]]);
    expect(m2.manager.m_vecIterator.length).toBe(0);
  });

  test("a marked dialog that the manager does not know (CheckDlg) is destroyed but stays in the list", () => {
    const { manager, made } = movers();
    const stray = made("S");
    stray.m_bCheckAutoDeleteEnd = true;
    manager.m_listDialog.push(stray);
    stray.onFrameMove = () => 0;
    manager.onFrameMove(0, 0);
    expect(stray.destroyed).toBe(true);
    expect([...manager.m_listDialog].length).toBe(1);
  });

  test("a marked dialog that stays in the list (the manager does not know it) and whose destruction makes another marked dialog join in front of the next one: the walk does not visit it", () => {
    const { manager, made, added, order } = movers();
    const stray = made("S");
    stray.m_bCheckAutoDeleteEnd = true;
    manager.m_listDialog.push(stray);
    const [b] = added(["B", false, 5]) as [CKTDGUIDialog];
    const x = made("X", false, 3);
    x.m_bCheckAutoDeleteEnd = true;
    const real = stray.Destroy.bind(stray);
    stray.Destroy = () => {
      expect(manager.addDlg(x)).toBe(true); // between S and B
      real();
    };
    manager.onFrameMove(0, 0);
    expect([order(), x.destroyed, b.destroyed, stray.destroyed, manager.m_vecIterator.length]).toEqual([["S", "X", "B"], false, false, true, 0]);
    // the next frame: X is marked and is the manager's: it goes; the destroyed stray is not destroyed again
    let again = 0;
    stray.Destroy = () => void again++;
    manager.onFrameMove(0, 0);
    expect([order(), x.destroyed, again]).toEqual([["S", "B"], true, 0]);
  });

  test("a layer that can be hidden and is: only DLG_ChatBox_EditBox, DLG_MsgBox, DLG_OKMsgBox and OkAndCancelMsgBox move, in that order, shown or not", () => {
    const { manager, ds, log } = movers(["OkAndCancelMsgBox"], ["x"], ["DLG_OKMsgBox"], ["DLG_MsgBox"], ["y"], ["DLG_ChatBox_EditBox"]);
    ds[2]!.m_bShow = false;
    ds[3]!.m_bEnable = false;
    manager.m_bCanHide = true;
    manager.m_bShow = false;
    expect(manager.onFrameMove(2, 3)).toBe(0);
    expect(log.map((s) => s.split("|")[0])).toEqual(["DLG_ChatBox_EditBox@2,3", "DLG_MsgBox@2,3", "DLG_OKMsgBox@2,3", "OkAndCancelMsgBox@2,3"]);
    expect(log.map((s) => s.split("|")[1])).toEqual(["", "", "", ""]); // (no last error here)
    // a layer that can be hidden and is not: every dialog moves; a layer that cannot be hidden moves whether or not it is shown
    const moved = () => log.map((s) => s.split("@")[0]);
    log.length = 0;
    manager.m_bShow = true;
    manager.onFrameMove(0, 0);
    expect(moved()).toEqual(["DLG_ChatBox_EditBox", "y", "x", "OkAndCancelMsgBox"]); // 6 dialogs, from the front: DLG_OKMsgBox is hidden and DLG_MsgBox is disabled
    log.length = 0;
    manager.m_bCanHide = false;
    manager.m_bShow = false;
    manager.onFrameMove(0, 0);
    expect(moved()).toEqual(["DLG_ChatBox_EditBox", "y", "x", "OkAndCancelMsgBox"]);
    log.length = 0;
    manager.m_bShow = true;
    manager.onFrameMove(0, 0);
    expect(moved()).toEqual(["DLG_ChatBox_EditBox", "y", "x", "OkAndCancelMsgBox"]);
  });

  test("a layer that is hidden: a destroyed dialog that the cache still names does not move", () => {
    const { manager, ds, log } = movers(["DLG_MsgBox"]);
    manager.m_bCanHide = true;
    manager.m_bShow = false;
    manager.onFrameMove(0, 0);
    manager.onFrameMove(0, 0);
    expect(log.length).toBe(2);
    manager.deleteDlg(ds[0]!);
    manager.onFrameMove(0, 0); // walked: gone
    manager.onFrameMove(0, 0); // the stale cache entry names a destroyed dialog: its handle is stale
    expect(log.length).toBe(2);
  });
});

describe("CKTDGUIDialogManager::OnFrameRender (328DFE30), OnFrameRenderTopModal (328E0910)", () => {
  function drawers(...specs: [string, boolean?, number?, boolean?][]) {
    const s = managerWorld();
    const ds = s.added(...specs);
    const log: string[] = [];
    for (const d of ds) {
      d.onFrameRender = (force?: boolean) => {
        log.push(`${d.m_Name}(${String(force)})`);
        return 0;
      };
    }
    const guide = (d: CKTDGUIDialog) => {
      const st = new CKTDGUIStatic(s.w);
      st.onFrameRender = () => {
        log.push(`${d.m_Name}.guide`);
        return 0;
      };
      d.m_pStaticGuideDesc = st;
    };
    const drag = new CKTDGUISlot(s.w);
    drag.renderDragSlot = () => {
      log.push("drag");
      return 0;
    };
    return { ...s, ds, log, guide, drag };
  }

  test("the dialogs of the asked front flag that are shown are drawn from the back to the front, with force false; 0", () => {
    const { manager, ds, log } = drawers(["A"], ["B", true], ["C"], ["D"], ["E", true], ["F", true]);
    ds[2]!.m_bShow = false;
    ds[4]!.m_bShow = false;
    expect(manager.onFrameRender(false)).toBe(0);
    expect(log).toEqual(["A(false)", "D(false)"]);
    log.length = 0;
    expect(manager.onFrameRender(true)).toBe(0);
    expect(log).toEqual(["B(false)", "F(false)"]);
  });

  test("then the guide text's static of each of those dialogs, and (for the front dialogs) the dragged slot", () => {
    const { manager, ds, log, guide, drag } = drawers(["A"], ["B", true], ["C"], ["D"], ["E", true]);
    for (const d of ds) guide(d);
    ds[3]!.m_bShow = false; // hidden: no guide
    ds[4]!.m_pStaticGuideDesc = null;
    CKTDGUISlot.s_pDragSlot = drag;
    try {
      manager.onFrameRender(false);
      expect(log).toEqual(["A(false)", "C(false)", "A.guide", "C.guide"]); // the dragged slot waits for the front dialogs
      log.length = 0;
      manager.onFrameRender(true);
      expect(log).toEqual(["B(false)", "E(false)", "B.guide", "drag"]);
      log.length = 0;
      CKTDGUISlot.s_pDragSlot = null;
      manager.onFrameRender(true);
      expect(log).toEqual(["B(false)", "E(false)", "B.guide"]);
    } finally {
      CKTDGUISlot.s_pDragSlot = null;
    }
  });

  test("a guide text that makes a dialog join while the guide texts are drawn: the walk went on to the next dialog before the visit", () => {
    const { manager, made, ds, log, guide, order } = drawers(["A", false, 0], ["B", false, 5]);
    for (const d of ds) guide(d);
    const x = made("X", false, 3);
    guide(x);
    ds[0]!.m_pStaticGuideDesc!.onFrameRender = () => {
      log.push("A.guide");
      expect(manager.addDlg(x)).toBe(true); // between A and B
      return 0;
    };
    manager.onFrameRender(false);
    expect([log, order(), manager.m_vecIterator.length]).toEqual([["A(false)", "B(false)", "A.guide", "B.guide"], ["A", "X", "B"], 0]);
  });

  test("a layer that cannot be hidden and is not shown draws nothing, not even the dragged slot", () => {
    const { manager, log, drag } = drawers(["A"], ["B", true]);
    CKTDGUISlot.s_pDragSlot = drag;
    try {
      manager.m_bShow = false;
      expect(manager.onFrameRender(true)).toBe(0);
      expect(manager.onFrameRender(false)).toBe(0);
      expect(log).toEqual([]);
      manager.m_bCanHide = true; // one that can be hidden draws when it is shown
      manager.m_bShow = true;
      manager.onFrameRender(false);
      expect(log).toEqual(["A(false)"]);
    } finally {
      CKTDGUISlot.s_pDragSlot = null;
    }
  });

  test("a layer that can be hidden and is: DLG_ChatBox_EditBox, DLG_MsgBox, DLG_OKMsgBox and OkAndCancelMsgBox that are shown are drawn, in that order, whatever their front flag", () => {
    const { manager, ds, log, guide, drag } = drawers(["OkAndCancelMsgBox"], ["x"], ["DLG_OKMsgBox", true], ["DLG_MsgBox"], ["y", true], ["DLG_ChatBox_EditBox"]);
    ds[3]!.m_bShow = false;
    guide(ds[5]!);
    CKTDGUISlot.s_pDragSlot = drag;
    manager.m_bCanHide = true;
    manager.m_bShow = false;
    try {
      expect(manager.onFrameRender(true)).toBe(0);
      expect(log).toEqual(["DLG_ChatBox_EditBox(false)", "DLG_OKMsgBox(false)", "OkAndCancelMsgBox(false)"]); // no guide, no dragged slot
      log.length = 0;
      expect(manager.onFrameRender(false)).toBe(0);
      expect(log).toEqual(["DLG_ChatBox_EditBox(false)", "DLG_OKMsgBox(false)", "OkAndCancelMsgBox(false)"]);
    } finally {
      CKTDGUISlot.s_pDragSlot = null;
    }
  });

  test("hidden layer: a dialog the cache names but that was destroyed is not drawn", () => {
    const { manager, ds, log } = drawers(["DLG_MsgBox"]);
    manager.m_bCanHide = true;
    manager.m_bShow = false;
    manager.onFrameRender(false);
    expect(log).toEqual(["DLG_MsgBox(false)"]);
    manager.deleteDlg(ds[0]!);
    manager.onFrameRender(false);
    manager.onFrameRender(false);
    expect(log.length).toBe(1);
  });

  test("OnFrameRenderTopModal: the dialog nearest the front that is enabled, shown and not modal is drawn, with force false; 0", () => {
    const { manager, ds, log } = drawers(["A"], ["B"], ["C"], ["D"]);
    const [a, b, c, d] = ds as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    d.m_bModal = true;
    c.m_bShow = false;
    expect(manager.onFrameRenderTopModal()).toBe(0);
    expect(log).toEqual(["B(false)"]);
    log.length = 0;
    b.m_bEnable = false;
    manager.onFrameRenderTopModal();
    expect(log).toEqual(["A(false)"]);
    log.length = 0;
    a.m_bModal = true;
    expect(manager.onFrameRenderTopModal()).toBe(0);
    expect(log).toEqual([]);
    expect(managerWorld().manager.onFrameRenderTopModal()).toBe(0);
  });

  test("OnFrameRenderTopModal draws unless the layer can be hidden and is", () => {
    const { manager, log } = drawers(["A"]);
    manager.m_bShow = false;
    manager.onFrameRenderTopModal(); // it cannot be hidden: drawn although not shown
    expect(log).toEqual(["A(false)"]);
    manager.m_bCanHide = true;
    manager.onFrameRenderTopModal();
    expect(log).toEqual(["A(false)"]);
    manager.m_bShow = true;
    manager.onFrameRenderTopModal();
    expect(log).toEqual(["A(false)", "A(false)"]);
  });
});

describe("CKTDGUIDialogManager::MsgProc (328DEFD0)", () => {
  function listeners(...specs: [string, boolean?, number?, boolean?][]) {
    const s = managerWorld();
    const ds = s.added(...specs);
    const log: string[] = [];
    const answers = new Map<string, boolean>();
    for (const d of ds) {
      d.msgProc = (h: unknown, msg: number, wParam: number, lParam: number) => {
        log.push(`${d.m_Name}:${String(h)},${msg},${wParam},${lParam}`);
        return answers.get(d.m_Name) ?? false;
      };
    }
    return { ...s, ds, log, answers };
  }

  test("no dialog: false; else from the front to the back until a dialog takes the message", () => {
    const empty = listeners();
    expect(empty.manager.MsgProc("h", 513, 0, 0)).toBe(false);
    const { manager, ds, log, answers } = listeners(["A", false, 0, true], ["B", false, 0, true], ["C", false, 0, true], ["D", false, 0, true]);
    expect(manager.MsgProc("hw", 513, 7, -9)).toBe(false); // every dialog is modal: all of them are asked
    expect(log).toEqual(["D:hw,513,7,-9", "C:hw,513,7,-9", "B:hw,513,7,-9", "A:hw,513,7,-9"]);
    log.length = 0;
    answers.set("C", true);
    expect(manager.MsgProc("hw", 512, 1, 2)).toBe(true);
    expect(log).toEqual(["D:hw,512,1,2", "C:hw,512,1,2"]);
    expect(manager.m_vecReverseIterator.length).toBe(0);
    void ds;
  });

  test("a dialog that is enabled, shown and not modal and does not take the message ends the walk: false", () => {
    const { manager, ds, log } = listeners(["A", false, 0, true], ["B", false, 0, false], ["C", false, 0, true], ["D", false, 0, true]);
    const [, b, c, d] = ds as [CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog, CKTDGUIDialog];
    expect(manager.MsgProc(null, 1, 0, 0)).toBe(false);
    expect(log.map((s) => s.split(":")[0])).toEqual(["D", "C", "B"]);
    log.length = 0;
    b.m_bEnable = false; // not enabled: the walk goes on
    manager.MsgProc(null, 1, 0, 0);
    expect(log.length).toBe(4);
    log.length = 0;
    b.m_bEnable = true;
    b.m_bShow = false; // not shown: it goes on, too
    manager.MsgProc(null, 1, 0, 0);
    expect(log.length).toBe(4);
    log.length = 0;
    b.m_bShow = true;
    d.m_bModal = false;
    manager.MsgProc(null, 1, 0, 0);
    expect(log.map((s) => s.split(":")[0])).toEqual(["D"]);
    void c;
  });

  test("a dialog that deletes itself while it handles the message (its handle is stale after that) does not stop the walk", () => {
    const { manager, ds, log } = listeners(["A", false, 0, true], ["B", false, 0, true], ["C", false, 0, false]);
    const c = ds[2]!;
    c.msgProc = () => {
      log.push("C");
      manager.deleteDlg(c);
      return false;
    };
    expect(manager.MsgProc(null, 1, 0, 0)).toBe(false);
    expect(log.map((s) => s.split(":")[0])).toEqual(["C", "B", "A"]);
  });

  test("after the left or the right mouse button went up a dragged slot is given back; not for other messages, and not when there is no dialog", () => {
    const { w, manager } = listeners(["A", false, 0, true]);
    const slot = new CKTDGUISlot(w);
    slot.m_pNormalPoint = new UIPointData();
    const drag = () => {
      slot.m_eControlState = SCS.ONDRAG;
      CKTDGUISlot.s_pDragSlot = slot;
    };
    try {
      for (const msg of [513, 515, 517, 0, 515 + 100]) {
        drag();
        manager.MsgProc(null, msg, 0, 0);
        expect([msg, slot.m_eControlState, is(CKTDGUISlot.s_pDragSlot, slot)]).toEqual([msg, SCS.ONDRAG, true]);
      }
      for (const msg of [514, 516]) {
        drag();
        manager.MsgProc(null, msg, 0, 0);
        expect([msg, slot.m_eControlState, CKTDGUISlot.s_pDragSlot === null]).toEqual([msg, SCS.NORMAL, true]);
      }
      drag();
      expect(managerWorld().manager.MsgProc(null, 514, 0, 0)).toBe(false); // the empty list answers first
      expect([slot.m_eControlState, is(CKTDGUISlot.s_pDragSlot, slot)]).toEqual([SCS.ONDRAG, true]);
    } finally {
      CKTDGUISlot.s_pDragSlot = null;
    }
  });
});

describe("~CKTDGUIDialog (329554D0)", () => {
  test("the guide text's dialog is deleted from the application's manager; the dialog leaves its manager", () => {
    const { w, manager, made, added, order } = managerWorld();
    const [d] = added(["D"]) as [CKTDGUIDialog];
    const guide = made("G");
    w.dialogManager.addDlg(guide);
    d.m_pDialogGuideDesc = guide;
    d.Destroy();
    expect([d.destroyed, guide.destroyed, [...w.dialogManager.m_listDialog].length]).toEqual([true, true, 0]);
    expect(is(d.m_pDialogGuideDesc, null)).toBe(true);
    expect([order(), is(d.m_pkUIDialogManager, null), manager.m_setDialog.has(d)]).toEqual([[], true, false]);
    // a guide dialog the application's manager does not hold is only let go
    const e = made("E");
    const loose = made("L");
    e.m_pDialogGuideDesc = loose;
    e.Destroy();
    expect([e.destroyed, is(e.m_pDialogGuideDesc, null), loose.destroyed]).toEqual([true, true, false]);
  });

  test("a control of the dialog that has the focus loses it; a control of another dialog keeps it", () => {
    const { w, made } = managerWorld();
    const d = made("D");
    const other = made("O");
    const c = new CKTDGUINavigation(w);
    const log: string[] = [];
    c.onFocusOut = () => void log.push("out");
    c.m_pDialog = d;
    w.controlFocus = c;
    other.Destroy();
    expect([log, is(w.controlFocus, c)]).toEqual([[], true]);
    d.Destroy();
    expect([log, is(w.controlFocus, null)]).toEqual([["out"], true]);
    w.controlFocus = null;
    made("N").Destroy(); // no control has the focus
    expect(w.controlFocus).toBe(null);
  });

  test("every control is destroyed, in the order of the list; the lists and the radio button groups are emptied", () => {
    const { w, made } = managerWorld();
    const d = made("D");
    const log: string[] = [];
    const seen: string[] = [];
    for (const name of ["one", "two", "three"]) {
      const c = new CKTDGUINavigation(w);
      c.m_Name = name;
      c.Destroy = () => {
        log.push(name);
        seen.push(d.m_ControlsList.map((x) => (x === null ? "-" : x.m_Name)).join(","));
      };
      d.AddControl(c);
    }
    d.m_mapRadioButtonGroupInfo.set(1, { m_vecRadioButton: [] } as never);
    d.Destroy();
    expect(log).toEqual(["one", "two", "three"]);
    expect(seen).toEqual(["one,two,three", "-,two,three", "-,-,three"]); // each entry is cleared once its destructor has run
    expect([d.m_ControlsList.length, d.m_ControlsMap.size, d.m_mapRadioButtonGroupInfo.size, d.destroyed]).toEqual([0, 0, 0, true]);
  });
});
