#!/usr/bin/env python3
"""
The mouse input of the check box and the radio button of x2.exe on the Unicorn CPU emulator: the oracle of `CKTDGUICheckBox.handleMouse`
and `CKTDGUIRadioButton.handleMouse` (packages/ui/src/checkbox.ts, radiobutton.ts; tested by packages/ui/test/toggles-input.test.ts, which
replays packages/ui/test/toggles-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-toggles.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-toggles.py --json FILE    (and writes the script and the exe's answers to FILE)

The exe's functions run as they are: CKTDGUICheckBox::HandleMouse 32931830 and CKTDGUIRadioButton::HandleMouse 3294A680 (through slot 8 of the
real vtable of the class), and what they call: ContainsPoint (the base class's 32924310), SendInternelEvent 329253D0, RequestFocus 3295B490
and the base OnFocusIn / OnFocusOut / CanHaveFocus, CKTDGUIDialog::GetControl(int) 329572D0 over the dialog's real list of controls.  What is
replaced by a stub that writes the call down (see oracle-controls.py for the objects, the stage and the other stubs):
  * `SetCapture` / `ReleaseCapture` (the imports at 0x3348F61C / 0x3348F620; `DXUTGetHWND` 328A0F30 answers a fake window): `capture` /
    `release`;
  * `CKTDGUIControl::PlaySoundW` 329251E0: `A.sound(check)` (the check sound the control holds is a fake pointer);
  * `CKTDGUIRadioButton::SetCheckedInternal` 3294BA90: `A.setChecked(bChecked,bClickedDouble,bFromInput)`; the stub does the first thing the
    function does, `m_bChecked = bChecked` (the rest of it is the subject of the radio button's own tests);
  * `CKTDGUIDialog::GetRadioButtonGroupInfo` 3294A630 (a `std::map` lookup): the record of the group that the case made, `{id, max}`, or null.
A handle that names no dialog (`gone`) resolves to the null object `fs_uiDialogNullObject`, which is all zeros here: no record, no controls.
The layout is the exe's: check box +0x21C m_bChecked, +0x21D m_bPressed, +0x2AC the check sound, +0x2B0 / +0x2B4 the custom messages of
checked / unchecked, +0x2B8 / +0x2D0 their function names (a `std::string`: 16 bytes of buffer, size, capacity); radio button +0x21C
m_bChecked, +0x21D m_bPressed, +0x21E m_bRButtonDown, +0x21F m_bEnableDoubleClick, +0x220 m_bEnableCheckToggle, +0x2D0 m_CustomMsgRButtonUp,
+0x2D8 m_GroupID, +0x390 the check sound.
"""
import importlib.util, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from peemu import *

_spec = importlib.util.spec_from_file_location("oracle_controls", os.path.join(HERE, "oracle-controls.py"))
oc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oc)
oi, om = oc.oi, oc.om
EAX, ECX = oi.EAX, oi.ECX
s32 = oi.s32

CHECKBOX_HANDLE_MOUSE, RADIO_HANDLE_MOUSE = 0x32931830, 0x3294A680
SET_CAPTURE_IAT, RELEASE_CAPTURE_IAT = 0x3348F61C, 0x3348F620
DXUT_GET_HWND, SET_CHECKED_INTERNAL, GET_GROUP_INFO = 0x328A0F30, 0x3294BA90, 0x3294A630
SOUND_CHECK = 0x5558
oc.SOUNDS[SOUND_CHECK] = "check"
om.VTABLE["CheckBox"], om.UCT["CheckBox"] = 0x334AF674, 2
om.VTABLE["RadioButton"], om.UCT["RadioButton"] = 0x334AFE4C, 6
oc.HANDLERS.update({"checkbox": CHECKBOX_HANDLE_MOUSE, "radio": RADIO_HANDLE_MOUSE})
oc.STATE_KEYS.update({"checkbox": ("hasFocus", "focus", "checked", "pressed"), "radio": ("hasFocus", "focus", "checked", "pressed", "rdown")})
oc.FIELD_OFFSETS.update({"checkbox": {"checked": 0x21C, "pressed": 0x21D}, "radio": {"checked": 0x21C, "pressed": 0x21D, "rdown": 0x21E}})
oi.CONTROL_FIELDS.update({"m_bChecked": (0x21C, "B"), "m_bPressed": (0x21D, "B"), "m_GroupID": (0x2D8, "i")})


class ToggleOracle(oc.ControlOracle):
    def __init__(self):
        super().__init__()
        self.groups = {}  # (dialog address, group id) -> the address of its record
        emu = self.emu
        emu.hook(emu.stub(SET_CAPTURE_IAT, b"\xC2\x04\x00"), lambda e: self.log("capture"))
        emu.hook(emu.stub(RELEASE_CAPTURE_IAT, b"\xC3"), lambda e: self.log("release"))
        self.replace(DXUT_GET_HWND, lambda e: e.set_reg(EAX, oi.APP_HWND))
        self.replace(SET_CHECKED_INTERNAL, self._set_checked, b"\xC2\x0C\x00")
        self.replace(GET_GROUP_INFO, self._group_info, b"\xC2\x04\x00")

    # ---- the stubs
    def _set_checked(self, emu):
        this = emu.reg(ECX)
        checked, double, from_input = emu.args(3)
        emu.write(this + 0x21C, bytes([1 if checked & 0xFFFFFFFF else 0]))
        self.log("%s.setChecked(%d,%d,%d)" % (self.name(this), 1 if checked & 0xFFFFFFFF else 0, double & 0xFF, from_input & 0xFF))

    def _group_info(self, emu):
        (group,) = emu.args(1)
        emu.set_reg(EAX, self.groups.get((emu.reg(ECX), s32(group)), 0))

    def reset(self):
        self.groups.clear()
        super().reset()

    # ---- the objects
    def group_(self, dialog, group, max_count):
        """the dialog has a record for the group (`m_iMaxCheckCount` = max_count)"""
        record = self.emu.alloc(0x20)
        self.emu.write(record, struct.pack("<2i", group, max_count))
        self.groups[(self.addr[dialog], group)] = record
        self.op("group", dialog, group, max_count)

    def checkbox_(self, label, dialog, index=1, rect=(0, 0, 40, 40), enable=True, show=True, checked=False, pressed=False,
                  msg_checked=-1, msg_unchecked=-1, func_checked="", func_unchecked=""):
        emu = self.emu
        l, t, r, b = rect
        c = self.control("CheckBox", label, corners=om.rect(l, t, r, b), dialog=index, show=show, enable=enable)
        emu.write(c + 0x21C, bytes([1 if checked else 0, 1 if pressed else 0]))
        emu.w32(c + 0x2AC, SOUND_CHECK)
        emu.write(c + 0x2B0, struct.pack("<2i", msg_checked, msg_unchecked))
        for at, text in ((0x2B8, func_checked), (0x2D0, func_unchecked)):
            emu.write(c + at, text.encode("ascii").ljust(16, b"\0"))
            emu.write(c + at + 16, struct.pack("<II", len(text), 15))
        self.addr[label] = c
        self.owner[c] = self.addr[dialog]
        self.kind[c] = "checkbox"
        self.op("checkbox", label, dialog, {"rect": list(rect), "enable": enable, "show": show, "checked": checked, "pressed": pressed,
                                            "msgChecked": msg_checked, "msgUnchecked": msg_unchecked, "funcChecked": func_checked,
                                            "funcUnchecked": func_unchecked})
        return c

    def radio_(self, label, dialog, index=1, rect=(0, 0, 40, 40), group=1, enable=True, show=True, checked=False, pressed=False, rdown=False,
               dbl=False, toggle=False, rmsg=-1):
        emu = self.emu
        l, t, r, b = rect
        c = self.control("RadioButton", label, corners=om.rect(l, t, r, b), dialog=index, show=show, enable=enable)
        emu.write(c + 0x21C, bytes([1 if checked else 0, 1 if pressed else 0, 1 if rdown else 0, 1 if dbl else 0, 1 if toggle else 0]))
        emu.w32(c + 0x2D0, rmsg & 0xFFFFFFFF)
        emu.w32(c + 0x2D8, group & 0xFFFFFFFF)
        emu.w32(c + 0x390, SOUND_CHECK)
        self.addr[label] = c
        self.owner[c] = self.addr[dialog]
        self.kind[c] = "radio"
        self.op("radio", label, dialog, {"rect": list(rect), "group": group, "enable": enable, "show": show, "checked": checked, "pressed": pressed,
                                         "rdown": rdown, "dbl": dbl, "toggle": toggle, "rmsg": rmsg})
        return c


def main():
    o = ToggleOracle()
    IN, OUT = (20, 20), (100, 100)

    def fresh_check(**kw):
        """the dialog D (managed, with a stage), the check box A (0,0)-(40,40) and a probe control Y (60,0)-(100,40) that can take the focus"""
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        o.checkbox_("A", "D", **kw)
        o.control_("Y", "D", rect=(60, 0, 100, 40))
        o.register("D", ["A", "Y"])

    def fresh_radio(info=None, **kw):
        """D with the radio buttons A (0,0)-(40,40) and B (60,0)-(100,40) of group 1, C (0,60)-(40,100) of group 2, a probe control Y
        (60,60)-(100,100) that is not a radio button; `info`: the record of group 1 (its `m_iMaxCheckCount`), none by default"""
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        o.radio_("A", "D", **kw)
        o.radio_("B", "D", rect=(60, 0, 100, 40), group=1)
        o.radio_("C", "D", rect=(0, 60, 40, 100), group=2)
        o.control_("Y", "D", rect=(60, 60, 100, 100))
        o.register("D", ["A", "B", "C", "Y"])
        if info is not None:
            o.group_("D", 1, info)

    def hit(case, label, uMsg, point=IN):
        return o.act_ctl(case, label, uMsg, point[0], point[1], 0, 0)

    # ================================================================ CKTDGUICheckBox::HandleMouse
    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False})):
        fresh_check(**kw)
        hit("K1 left button down inside, %s" % tag, "A", 0x201)
    for m in (0x200, 0x204, 0x205, 0x206, 0x207, 0x20A, 0x100, 0x401):
        fresh_check(pressed=True)
        hit("K1 message 0x%X inside (not taken)" % m, "A", m)

    # ---- the button down (0x201 and the double click 0x203): pressed, the capture, the focus
    for m in (0x201, 0x203):
        fresh_check()
        hit("K2 message 0x%X inside, no focus: pressed, the window captures the mouse, A takes the focus" % m, "A", m)
        fresh_check(); o.give_focus("Y")
        hit("K2 message 0x%X inside, Y has the focus: Y loses it, A gets it" % m, "A", m)
        fresh_check(); o.give_focus("A")
        hit("K2 message 0x%X inside, A has the focus already: no request" % m, "A", m)
        fresh_check()
        hit("K2 message 0x%X outside: not taken, not pressed" % m, "A", m, OUT)
    fresh_check(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    hit("K2 down inside, m_bHasFocus set but the global focus is Y: no request (the flag is what is asked)", "A", 0x201)
    fresh_check(); o.gone("D"); o.give_focus("Y")
    hit("K2 down inside, D is gone: the focus is requested all the same (the null object's RequestFocus reads nothing of the dialog)", "A", 0x201)
    fresh_check()
    hit("K2 down on the corner (the edge is outside)", "A", 0x201, (40, 40))
    hit("K2 down just inside", "A", 0x201, (39, 39))

    # ---- the left button up: the toggle
    fresh_check(pressed=True)
    hit("K3 up inside, pressed, unchecked: released, checked (the control event 0x466 / 0), the check sound", "A", 0x202)
    fresh_check(pressed=True, checked=True)
    hit("K3 up inside, pressed, checked: unchecked (the control event 0x466 / 1), the check sound", "A", 0x202)
    fresh_check(pressed=True, msg_checked=7, msg_unchecked=8)
    hit("K3 up, unchecked -> checked, custom messages 7 / 8: the custom message 7 of the checked state (0x467)", "A", 0x202)
    fresh_check(pressed=True, checked=True, msg_checked=7, msg_unchecked=8)
    hit("K3 up, checked -> unchecked, custom messages 7 / 8: the custom message 8 of the unchecked state", "A", 0x202)
    fresh_check(pressed=True, msg_checked=7, func_checked="OnCheck", func_unchecked="OnUncheck")
    hit("K3 up, unchecked -> checked, the functions OnCheck / OnUncheck: the message, then the function OnCheck (0x468)", "A", 0x202)
    fresh_check(pressed=True, checked=True, func_checked="OnCheck", func_unchecked="OnUncheck")
    hit("K3 up, checked -> unchecked, the functions OnCheck / OnUncheck: the control event, then the function OnUncheck", "A", 0x202)
    fresh_check(pressed=True, msg_unchecked=8, func_checked="OnCheck")
    hit("K3 up, unchecked -> checked with a function only for the checked state and a message only for the unchecked: 0x466 / 0, OnCheck", "A", 0x202)
    fresh_check(pressed=True, checked=True, msg_unchecked=8, func_checked="OnCheck")
    hit("K3 up, checked -> unchecked, the unchecked message 8 and no function for that state", "A", 0x202)
    fresh_check()
    hit("K3 up inside, not pressed: not taken, nothing happens", "A", 0x202)
    fresh_check(pressed=True)
    hit("K3 up OUTSIDE, pressed: released, taken, the state does not change, no sound", "A", 0x202, OUT)
    fresh_check(pressed=True, checked=True, func_unchecked="OnUncheck")
    hit("K3 up on the corner (outside), pressed: taken, no toggle", "A", 0x202, (40, 40))
    fresh_check(pressed=True, msg_checked=7, func_checked="OnCheck"); o.gone("D")
    hit("K3 up inside, pressed, D is gone: the box is toggled, no stage message (no dialog to ask), the sound plays", "A", 0x202)
    o.reset(); o.dialog_("D", stage=False); o.managed_("D", True); o.checkbox_("A", "D", pressed=True, func_checked="OnCheck"); o.register("D", ["A"])
    hit("K3 up inside, pressed, D has no stage: toggled, no stage message, the sound plays", "A", 0x202)
    # ---- a click: down, then up
    fresh_check()
    hit("K4 click, down inside", "A", 0x201)
    hit("K4 click, up inside: toggled", "A", 0x202)
    hit("K4 click, a second up: not pressed any more", "A", 0x202)
    fresh_check()
    hit("K4 press inside, release outside: no toggle, down", "A", 0x201)
    hit("K4 press inside, release outside: no toggle, up", "A", 0x202, OUT)
    hit("K4 and a release inside afterwards: not pressed any more", "A", 0x202)

    # ================================================================ CKTDGUIRadioButton::HandleMouse
    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False})):
        fresh_radio(**kw)
        hit("R1 left button down inside, %s" % tag, "A", 0x201)
    for m in (0x200, 0x206, 0x207, 0x20A, 0x100, 0x401):
        fresh_radio(pressed=True, rdown=True, dbl=True)
        hit("R1 message 0x%X inside (not taken)" % m, "A", m)

    # ---- the left button down
    fresh_radio()
    hit("R2 left down inside, unchecked, no focus: pressed, the capture, A takes the focus", "A", 0x201)
    fresh_radio(); o.give_focus("Y")
    hit("R2 left down inside, Y has the focus: Y loses it, A gets it", "A", 0x201)
    fresh_radio(); o.give_focus("A")
    hit("R2 left down inside, A has the focus already: pressed, the capture, no request", "A", 0x201)
    fresh_radio(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    hit("R2 left down inside, m_bHasFocus set but the global focus is Y: no request", "A", 0x201)
    fresh_radio(checked=True)
    hit("R2 left down inside, checked and no toggle: not taken, not pressed", "A", 0x201)
    fresh_radio(checked=True, toggle=True)
    hit("R2 left down inside, checked with the toggle: pressed", "A", 0x201)
    fresh_radio(toggle=True)
    hit("R2 left down inside, unchecked with the toggle: pressed", "A", 0x201)
    fresh_radio()
    hit("R2 left down outside: not taken", "A", 0x201, OUT)
    fresh_radio(checked=True)
    hit("R2 left down outside, checked and no toggle: not taken", "A", 0x201, OUT)
    fresh_radio(); o.gone("D"); o.give_focus("Y")
    hit("R2 left down inside, D is gone: pressed, the capture, the focus is requested all the same", "A", 0x201)

    # ---- the left button up: the group is cleared (no record or max 1), the button is checked
    fresh_radio(pressed=True)
    hit("R3 up inside, pressed, no record of the group: released, the sound, every radio of group 1 unchecked (A too), A checked by input", "A", 0x202)
    fresh_radio(info=1, pressed=True)
    hit("R3 up inside, pressed, the group takes 1: the same", "A", 0x202)
    fresh_radio(info=2, pressed=True)
    hit("R3 up inside, pressed, the group takes 2: the record clears the group (SetChecked), nobody is unchecked here", "A", 0x202)
    fresh_radio(info=0, pressed=True)
    hit("R3 up inside, pressed, the group takes 0 (not 1): nobody is unchecked here", "A", 0x202)
    fresh_radio(pressed=True, toggle=True)
    hit("R3 up inside, pressed, toggle, unchecked, no record: the scan unchecks A, then A is checked", "A", 0x202)
    fresh_radio(pressed=True, toggle=True, checked=True)
    hit("R3 up inside, pressed, toggle, CHECKED, no record: the scan unchecks A first, so the toggle checks it again", "A", 0x202)
    fresh_radio(info=2, pressed=True, toggle=True, checked=True)
    hit("R3 up inside, pressed, toggle, checked, the group takes 2: no scan, the toggle unchecks A", "A", 0x202)
    fresh_radio(info=2, pressed=True, toggle=True)
    hit("R3 up inside, pressed, toggle, unchecked, the group takes 2: A is checked", "A", 0x202)
    fresh_radio(pressed=True, checked=True)
    hit("R3 up inside, pressed, checked, no toggle: A is checked (again)", "A", 0x202)
    fresh_radio()
    hit("R3 up inside, not pressed: not taken, nothing happens", "A", 0x202)
    fresh_radio(pressed=True)
    hit("R3 up OUTSIDE, pressed: released, taken, nothing else", "A", 0x202, OUT)
    fresh_radio(pressed=True); o.gone("D")
    hit("R3 up inside, pressed, D is gone: the sound, no scan (the null object has no controls), A checked", "A", 0x202)
    fresh_radio(pressed=True)
    o.set("B", "m_bChecked", 1)
    hit("R3 B of the same group is checked: it is unchecked by the scan (in list order: A, then B)", "A", 0x202)
    fresh_radio(pressed=True)
    o.set("Y", "m_GroupID", 1)
    hit("R3 Y is not a radio button but holds 1 where a radio button's group id is: the scan leaves it alone (it asks the type first)", "A", 0x202)
    # ---- a click on a radio button of group 2 leaves group 1 alone
    fresh_radio()
    o.radio_("C2", "D", rect=(60, 60, 100, 100), group=2, pressed=True)
    o.register("D", ["A", "B", "C", "Y", "C2"])
    hit("R3 up inside C2 (group 2): C and C2 are unchecked, A and B are not touched", "C2", 0x202, (80, 80))

    # ---- the left double click
    fresh_radio()
    hit("R4 double click inside, double clicks off: taken, nothing happens", "A", 0x203)
    fresh_radio()
    hit("R4 double click outside, double clicks off: taken all the same", "A", 0x203, OUT)
    fresh_radio(dbl=True)
    hit("R4 double click inside, no focus, no record: the focus, the sound, B unchecked (not A), A checked by a double click", "A", 0x203)
    fresh_radio(dbl=True); o.give_focus("A")
    hit("R4 double click inside, A has the focus: no request", "A", 0x203)
    fresh_radio(dbl=True); o.give_focus("Y")
    hit("R4 double click inside, Y has the focus: Y loses it, A gets it", "A", 0x203)
    fresh_radio(dbl=True, info=1)
    hit("R4 double click inside, the group takes 1: the same scan", "A", 0x203)
    fresh_radio(dbl=True, info=3)
    hit("R4 double click inside, the group takes 3: no scan", "A", 0x203)
    fresh_radio(dbl=True)
    hit("R4 double click outside, double clicks on: not taken", "A", 0x203, OUT)
    fresh_radio(dbl=True, checked=True, toggle=True)
    hit("R4 double click inside, checked with the toggle: still checked by a double click (no toggle)", "A", 0x203)
    fresh_radio(dbl=True); o.gone("D"); o.give_focus("Y")
    hit("R4 double click inside, D is gone: the focus, the sound, no scan, checked by a double click", "A", 0x203)

    # ---- the right button down and up
    fresh_radio()
    hit("R5 right down inside, no focus: m_bRButtonDown, the capture, the focus", "A", 0x204)
    fresh_radio(); o.give_focus("A")
    hit("R5 right down inside, A has the focus: no request", "A", 0x204)
    fresh_radio()
    hit("R5 right down outside: not taken", "A", 0x204, OUT)
    fresh_radio(checked=True)
    hit("R5 right down inside, checked: the same (the check state is not asked)", "A", 0x204)
    fresh_radio(rdown=True, rmsg=9); o.give_focus("A")
    hit("R6 right up inside, right button down, focus, message 9: released, the stage gets 9 (0x467), taken", "A", 0x205)
    fresh_radio(rdown=True); o.give_focus("A")
    hit("R6 right up inside, focus, no message (-1): released, taken, no message", "A", 0x205)
    fresh_radio(rdown=True, rmsg=9)
    hit("R6 right up inside, no focus: released, taken, no message", "A", 0x205)
    fresh_radio(rdown=True, rmsg=9); o.give_focus("A")
    hit("R6 right up OUTSIDE: released, taken, no message", "A", 0x205, OUT)
    fresh_radio(rmsg=9); o.give_focus("A")
    hit("R6 right up inside, the right button was not down: not taken", "A", 0x205)
    fresh_radio(rdown=True, rmsg=9); o.give_focus("A"); o.gone("D")
    hit("R6 right up inside, D is gone: released, taken, no stage message", "A", 0x205)
    fresh_radio(rmsg=9)
    hit("R7 a right click: down inside", "A", 0x204)
    hit("R7 a right click: up inside, A took the focus: the message", "A", 0x205)
    hit("R7 a right click: a second up: not down any more", "A", 0x205)

    if "--json" in sys.argv:
        import json
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w") as fh:
            json.dump(o.script, fh, indent=0, separators=(",", ":"))
            fh.write("\n")


if __name__ == "__main__":
    main()
