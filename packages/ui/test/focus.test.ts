import { describe, expect, test } from "bun:test";
import { CKTDGUIControl, CKTDGUIDialog, RadioButtonGroupInfo, requestFocus } from "../src/index.ts";
import { setup } from "./harness.ts";

/**
 * The focus and the two lookups of a dialog the input handlers use.  Every expected value is worked out by hand from the decompile:
 *  - `CKTDGUIDialog::RequestFocus(pControl)` 3295B490: `if (s_pControlFocus != pControl && pControl->CanHaveFocus()) { if (s_pControlFocus)
 *    s_pControlFocus->OnFocusOut(); pControl->OnFocusIn(); s_pControlFocus = pControl; }`; it reads nothing of the dialog it is called on;
 *  - `CKTDGUIControl::RequestFocus()` 32925390: `if (operator!=(m_pDialog, nullptr)) CKTDGUIDialog::RequestFocus(m_pDialog.operator->(), this)`
 *    (a handle that is null or stale: nothing);
 *  - `CKTDGUIDialog::GetControl(int)` 329572D0: null for an index below 0 or past the end of the list, else the control there;
 *  - `CKTDGUIDialog::GetRadioButtonGroupInfo(int)` 3294A630: the record of the group in the map, null when there is none.
 */
class Probe extends CKTDGUIControl {
  readonly calls: string[] = [];
  constructor(ctx: ConstructorParameters<typeof CKTDGUIControl>[0], readonly label: string, calls?: string[]) {
    super(ctx);
    if (calls) this.calls = calls;
  }
  override onFocusIn(): void {
    this.calls.push(`${this.label}.in`);
    super.onFocusIn();
  }
  override onFocusOut(): void {
    this.calls.push(`${this.label}.out`);
    super.onFocusOut();
  }
}

describe("RequestFocus (3295B490 and 32925390)", () => {
  const rigFocus = () => {
    const { w } = setup();
    const calls: string[] = [];
    const a = new Probe(w, "A", calls), b = new Probe(w, "B", calls);
    return { w, a, b, calls };
  };

  test("a control takes the focus: the old one loses it first, the new one gets it, and the global names the new one", () => {
    const { w, a, b, calls } = rigFocus();
    requestFocus(w, a);
    expect(calls).toEqual(["A.in"]);
    expect(w.controlFocus === a).toBe(true);
    expect(a.m_bHasFocus).toBe(true);
    requestFocus(w, b);
    expect(calls).toEqual(["A.in", "A.out", "B.in"]);
    expect(w.controlFocus === b).toBe(true);
    expect([a.m_bHasFocus, b.m_bHasFocus]).toEqual([false, true]);
  });

  test("the control that has the focus asks again: nothing happens", () => {
    const { w, a, calls } = rigFocus();
    requestFocus(w, a);
    requestFocus(w, a);
    expect(calls).toEqual(["A.in"]);
  });

  test("a control that cannot have the focus (disabled, hidden) does not take it and the old one keeps it", () => {
    const { w, a, b, calls } = rigFocus();
    requestFocus(w, a);
    b.m_bEnable = false;
    requestFocus(w, b);
    b.m_bEnable = true;
    b.m_bShow = false;
    requestFocus(w, b);
    expect(calls).toEqual(["A.in"]);
    expect(w.controlFocus === a).toBe(true);
  });

  test("the dialog's RequestFocus is the same function (it reads nothing of the dialog)", () => {
    const { w, a, b, calls } = rigFocus();
    const d = new CKTDGUIDialog(w);
    d.requestFocus(a);
    d.requestFocus(b);
    expect(calls).toEqual(["A.in", "A.out", "B.in"]);
  });

  test("a control's RequestFocus asks its dialog when the handle is valid; a control in no dialog, or one whose dialog is gone, asks nobody", () => {
    const { w, a, b, calls } = rigFocus();
    a.RequestFocus();
    expect(calls).toEqual([]);
    const d = new CKTDGUIDialog(w);
    a.m_pDialog = d;
    a.RequestFocus();
    expect(calls).toEqual(["A.in"]);
    b.m_pDialog = d;
    d.destroyed = true;
    b.RequestFocus();
    expect(calls).toEqual(["A.in"]);
    expect(w.controlFocus === a).toBe(true);
    d.destroyed = false;
    b.RequestFocus();
    expect(calls).toEqual(["A.in", "A.out", "B.in"]);
  });
});

describe("CKTDGUIDialog::GetControl(int) (329572D0) and GetRadioButtonGroupInfo (3294A630)", () => {
  test("the control at an index of the list; null below 0 and from the size on", () => {
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    const a = new Probe(w, "A"), b = new Probe(w, "B");
    a.m_Name = "A";
    b.m_Name = "B";
    d.AddControl(a);
    d.AddControl(b);
    expect([d.getControl(0) === a, d.getControl(1) === b]).toEqual([true, true]);
    expect([d.getControl(-1), d.getControl(2), d.getControl(100)]).toEqual([null, null, null]);
    expect(d.getControl("B") === b).toBe(true);
  });

  test("the record of a group id; null for an id that has none", () => {
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    const info = new RadioButtonGroupInfo(3);
    d.m_mapRadioButtonGroupInfo.set(3, info);
    expect(d.getRadioButtonGroupInfo(3) === info).toBe(true);
    expect([d.getRadioButtonGroupInfo(0), d.getRadioButtonGroupInfo(4), d.getRadioButtonGroupInfo(-3)]).toEqual([null, null, null]);
  });
});
