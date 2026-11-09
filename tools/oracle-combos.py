#!/usr/bin/env python3
"""
The input of the combo box (`CKTDGUIComboBox`) of x2.exe on the Unicorn CPU emulator: the oracle of `CKTDGUIComboBox.handleMouse`, `onFocusOut` and
`onHotkey` (packages/ui/src/combobox.ts; tested by packages/ui/test/combos-input.test.ts, which replays packages/ui/test/combos-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-combos.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-combos.py --json FILE    (and writes the script and the exe's answers to FILE)

The exe's functions run as they are: CKTDGUIComboBox::HandleMouse 3293D340 (through slot 8 of the real vtable of the class), OnFocusOut 3293D930
(slot 10), OnHotkey 3293F790 (slot 41), and what they call: SendInternelEvent 329253D0, RequestFocus 3295B490, ClearFocus 32956B90 and the base
OnFocusIn / CanHaveFocus.  What is replaced by a stub that writes the call down (see oracle-controls.py and oracle-bars.py for the rest):
  * `PtInRect` (USER32, the Win32 rule: left <= x < right, top <= y < bottom);
  * `SetCapture` / `ReleaseCapture`: `capture` / `release`; `CKTDGUIControl::PlaySoundW` 329251E0: `A.sound(down)` / `A.sound(none)`;
  * `CKTDGUIScrollBar::Scroll` 329863A0: `S.scroll(delta)` (the scroll bar of a box is a probe control: its `HandleMouse` is a stub that writes the
    call down and answers what the case says, and its `m_nPosition` is the case's);
  * `SystemParametersInfoW(SPI_GETWHEELSCROLLLINES, 0, &lines, 0)`, called through the pointer at 0x3362EB0C: `spi`, and `lines` is written to the
    place the caller gave (the case says how many lines a notch scrolls).
A message that a box sends to the stage is written down with the box's selection at that moment: `stage(1127,21,A)[sel=1 foc=1 open=1]` (the handler
of the message may ask the box which row is selected: it must already be the new one).
The layout is the exe's: combo box +0x21C m_iSelected, +0x220 m_iFocused, +0x24C m_bOpened, +0x24D m_bPressed, +0x270 m_rcDropdown, +0x2C8
m_ButtonOffsetX / Y, +0x364 m_pScrollBar, +0x378 m_rcBoundingBox2, +0x3F8 m_Items (the array of pointers, the count, the room), +0x404
m_CustomMsgSelectionChanged, +0x408 OpenDropdown, +0x40C CloseDropdown, +0x410 m_bMousePointAdjust, +0x414 the mouse down sound; a row
(`ComboBoxItem`, 0x21C bytes) has +0x204 rcActive, +0x214 bVisible, +0x218 pControl; the scroll bar +0x340 m_nPosition.
"""
import importlib.util, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from peemu import *

_spec = importlib.util.spec_from_file_location("oracle_bars", os.path.join(HERE, "oracle-bars.py"))
ob = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ob)
oc, oi, om = ob.oc, ob.oi, ob.om
EAX, ECX = oi.EAX, oi.ECX
s32 = oi.s32

COMBO_HANDLE_MOUSE, COMBO_ON_FOCUS_OUT, COMBO_ON_HOTKEY = 0x3293D340, 0x3293D930, 0x3293F790
SCROLL, SPI_PTR = 0x329863A0, 0x3362EB0C
om.VTABLE["ComboBox"], om.UCT["ComboBox"] = 0x334AFC5C, 8
oc.HANDLERS["combobox"] = COMBO_HANDLE_MOUSE
oc.STATE_KEYS["combobox"] = ("hasFocus", "focus", "opened", "pressed", "selected", "focused", "adjust", "btnOffset")
oc.FIELD_OFFSETS["combobox"] = {
    "opened": 0x24C, "pressed": 0x24D, "selected": (0x21C, "i"), "focused": (0x220, "i"), "adjust": 0x410, "btnOffset": (0x2C8, "pt"),
}
oi.CONTROL_FIELDS.update({
    "m_bOpened": (0x24C, "B"), "m_bPressed": (0x24D, "B"), "m_iSelected": (0x21C, "i"), "m_iFocused": (0x220, "i"), "m_bMousePointAdjust": (0x410, "B"),
    "m_ButtonOffsetX": (0x2C8, "i"), "m_ButtonOffsetY": (0x2CC, "i"), "m_nPosition": (0x340, "i"),
})


class ComboOracle(ob.BarOracle):
    def __init__(self):
        super().__init__()
        self.lines = 3
        self.replace(SCROLL, self._scroll, b"\xC2\x04\x00")
        self.emu.w32(SPI_PTR, self.hooked(self._spi, b"\xC2\x10\x00"))  # the delay-load pointer: the real function is not there

    def _scroll(self, emu):
        (delta,) = emu.args(1)
        self.log("%s.scroll(%d)" % (self.name(emu.reg(ECX)), s32(delta)))

    def _spi(self, emu):
        action, param, out, ini = emu.args(4)
        assert (action, param, ini) == (0x68, 0, 0), (hex(action), param, ini)
        self.log("spi")
        emu.w32(out, self.lines & 0xFFFFFFFF)
        emu.set_reg(EAX, 1)

    def _stage_msg(self, emu):
        super()._stage_msg(emu)
        lparam = emu.args(4)[3]
        if self.kind.get(lparam) == "combobox":
            self.events[-1] += "[sel=%d foc=%d open=%d]" % (self.i(lparam + 0x21C), self.i(lparam + 0x220), self.b(lparam + 0x24C))

    def wheel(self, lines):
        """a notch of the wheel scrolls `lines` lines (the operating system's setting)"""
        self.lines = lines
        self.op("wheel", lines)

    def combo_(self, label, dialog, index=1, box=(0, 0, 100, 20), drop=(0, 20, 100, 80), items=(), bar=None, selected=-1, focused=-1, opened=False,
               pressed=False, enable=True, show=True, sel_msg=-1, open_msg=-1, close_msg=-1, sound=True, adjust=False, btn_off=(0, 0)):
        """a combo box: `box` is m_rcBoundingBox2, `drop` the dropdown's rectangle; `items`: the rows, (active rectangle, visible, label of the control the
        row holds or None); `bar`: the label of its scroll bar (a probe control) or None"""
        emu = self.emu
        c = self.control("ComboBox", label, dialog=index, show=show, enable=enable, size=0x430)
        emu.write(c + 0x21C, struct.pack("<2i", selected, focused))
        emu.write(c + 0x24C, bytes([1 if opened else 0, 1 if pressed else 0]))
        emu.write(c + 0x270, struct.pack("<4i", *drop))
        emu.write(c + 0x2C8, struct.pack("<2i", *btn_off))
        emu.w32(c + 0x364, self.addr[bar] if bar else 0)
        emu.write(c + 0x378, struct.pack("<4i", *box))
        rows = []
        for rect, visible, control in items:
            row = emu.alloc(0x21C)
            emu.write(row + 0x204, struct.pack("<4i", *rect))
            emu.write(row + 0x214, bytes([1 if visible else 0]))
            emu.w32(row + 0x218, self.addr[control] if control else 0)
            rows.append(row)
        data = emu.alloc(4 * max(1, len(rows)))
        emu.write(data, b"".join(struct.pack("<I", r) for r in rows))
        emu.write(c + 0x3F8, struct.pack("<3I", data, len(rows), max(1, len(rows))))
        emu.write(c + 0x404, struct.pack("<3i", sel_msg, open_msg, close_msg))
        emu.write(c + 0x410, bytes([1 if adjust else 0]))
        emu.w32(c + 0x414, oc.SOUND_DOWN if sound else 0)
        self._adopt(c, label, dialog, "combobox")
        self.op("combo", label, dialog, {
            "box": list(box), "drop": list(drop), "items": [[list(r), v, k] for r, v, k in items], "bar": bar, "selected": selected, "focused": focused,
            "opened": opened, "pressed": pressed, "enable": enable, "show": show, "selMsg": sel_msg, "openMsg": open_msg, "closeMsg": close_msg,
            "sound": sound, "adjust": adjust, "btnOff": list(btn_off),
        })
        return c

    def act_virtual(self, case, label, slot, fn):
        """call the virtual function `slot` (no arguments) of the control; it must be the exe's function `fn`"""
        c = self.addr[label]
        self.events = []
        handler = self.emu.u32(self.emu.u32(c) + 4 * slot)
        assert handler == fn, hex(handler)
        self.thiscall(handler, c, [])
        events = list(self.events)
        state = self.state_of(label)
        print("%-100s -> | %s | %s" % (case, ",".join(events), state))
        return events, state

    def act_out(self, case, label):
        """send `OnFocusOut()` (virtual slot 10) to the control"""
        events, state = self.act_virtual(case, label, 10, COMBO_ON_FOCUS_OUT)
        self.op("act_out", case, label, {"ret": 0, "events": events, "state": state})

    def act_hotkey(self, case, label):
        """send `OnHotkey()` (virtual slot 41) to the control"""
        events, state = self.act_virtual(case, label, 41, COMBO_ON_HOTKEY)
        self.op("act_hotkey", case, label, {"ret": 0, "events": events, "state": state})


def main():
    o = ComboOracle()
    BOX, ROW0, ROW1, ROW2, OUT = (50, 10), (50, 30), (50, 50), (50, 70), (150, 150)
    ROWS = [(0, 20, 100, 40), (0, 40, 100, 60), (0, 60, 100, 80)]
    ARGS = dict(wParam=0x1234, lParam=0x5678)

    def fresh(rows=ROWS, vis=None, ctl=None, bar=False, pos=0, **kw):
        """D (managed, with a stage), the combo A (the box (0,0)-(100,20), the dropdown (0,20)-(100,80), the rows `rows`: three of 20 each, each holding
        the probe control P0 / P1 / P2; selected 1, focused 2, the messages 21 (selection), 22 (open), 23 (close)), a probe Y that can take the focus and,
        with `bar`, the probe S, its scroll bar, at the position `pos`"""
        vis = vis or [True] * len(rows)
        ctl = ctl or [True] * len(rows)
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        labels = ["A"]
        for k, has in enumerate(ctl):
            if has:
                o.control_("P%d" % k, "D", rect=(300 + 50 * k, 0, 340 + 50 * k, 40))
                labels.append("P%d" % k)
        if bar:
            o.control_("S", "D", rect=(400, 0, 440, 100))
            o.set("S", "m_nPosition", pos)
            labels.append("S")
        o.control_("Y", "D", rect=(200, 0, 240, 40))
        labels.append("Y")
        items = [(r, v, "P%d" % k if has else None) for k, (r, v, has) in enumerate(zip(rows, vis, ctl))]
        opts = dict(selected=1, focused=2, sel_msg=21, open_msg=22, close_msg=23)
        opts.update(kw)
        o.combo_("A", "D", items=items, bar="S" if bar else None, **opts)
        o.register("D", labels)
        o.wheel(3)  # a notch scrolls three lines (every scene writes down the question)

    def hit(case, uMsg, point=BOX, wParam=0, lParam=0):
        return o.act_ctl(case, "A", uMsg, point[0], point[1], wParam, lParam)

    # ================================================================ HandleMouse (3293D340): the gates, the scroll bar
    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False})):
        for m in (0x200, 0x201, 0x20A):
            fresh(bar=True, **kw)
            hit("C1 message 0x%X on the box, %s, a scroll bar that answers no" % (m, tag), m, BOX if m != 0x200 else ROW0, 0x00780000 if m == 0x20A else 0)
    for m in (0x200, 0x201, 0x202, 0x203, 0x204, 0x20A, 0x100):
        fresh(bar=True, opened=True, pressed=True)
        o.answer("S", "mouse", 1)
        hit("C1 message 0x%X: the scroll bar takes it (answers 1): taken, nothing else, not even the rows' controls" % m, m, ROW0, **ARGS)
        fresh(bar=True, opened=True, pressed=True)
        o.answer("S", "mouse", 0)
        hit("C1 message 0x%X: the scroll bar is asked (with the message as it is) and does not take it" % m, m, ROW0, **ARGS)

    # ---- the messages the box does not use, and what a closed box does with a move: the rows' controls get them
    for m in (0x200, 0x204, 0x205, 0x206, 0x207, 0x100, 0x401, 0x215):
        fresh()
        hit("C2 message 0x%X, closed: every row's control gets it as it is, in order; not taken" % m, m, ROW1, **ARGS)
    fresh(ctl=[True, False, True])
    o.answer("P0", "mouse", 1)
    hit("C2 move, closed, the second row holds no control, the first answers yes: the third still gets it, not taken", 0x200, ROW1, **ARGS)
    fresh(vis=[False, True, False])
    hit("C2 move, closed, the rows 0 and 2 are not visible: their controls get it all the same", 0x200, ROW1, **ARGS)
    fresh(rows=[])
    hit("C2 move, closed, no rows: not taken", 0x200, ROW1)
    fresh(opened=True)
    hit("C2 move, open, the point outside the dropdown: the rows' controls get it, nothing changes", 0x200, OUT, **ARGS)
    fresh(opened=True)
    hit("C2 move, open, the point on the box (above the dropdown): the rows' controls get it", 0x200, BOX, **ARGS)

    # ================================================================ 0x200: the focused row
    for point, k in ((ROW0, 0), (ROW1, 1), (ROW2, 2)):
        fresh(opened=True, focused=-1)
        hit("C3 move, open, over row %d: it is focused, taken, the rows' controls do not get it" % k, 0x200, point, **ARGS)
    fresh(opened=True)
    hit("C3 move, open, over the first row's top row of pixels (0,20): row 0", 0x200, (0, 20))
    fresh(opened=True)
    hit("C3 move, open, over the last pixel of the dropdown (99,79): row 2", 0x200, (99, 79))
    fresh(opened=True)
    hit("C3 move, open, over the first row's last line (50,39): row 0", 0x200, (50, 39))
    fresh(opened=True)
    hit("C3 move, open, over the second row's first line (50,40): row 1", 0x200, (50, 40))
    for point, tag in (((100, 50), "x = right"), ((50, 80), "y = bottom"), ((-1, 50), "x = left - 1"), ((50, 19), "y = top - 1")):
        fresh(opened=True)
        hit("C3 move, open, just outside the dropdown (%s): the rows' controls get it, nothing changes" % tag, 0x200, point)
    overlap = [(0, 20, 100, 60), (0, 40, 100, 80), (0, 20, 100, 80)]
    fresh(rows=overlap, opened=True, focused=-1)
    hit("C3 move, open, three rows hold (50,50): the last one is focused (the loop does not stop)", 0x200, (50, 50))
    fresh(rows=overlap, vis=[True, True, False], opened=True, focused=-1)
    hit("C3 move, open, three rows hold (50,50), the last is not visible: the second", 0x200, (50, 50))
    fresh(rows=overlap, vis=[False, False, False], opened=True)
    hit("C3 move, open, no row is visible: taken, focused stays", 0x200, (50, 50))
    fresh(rows=overlap, vis=[True, False, True], opened=True, focused=-1)
    hit("C3 move, open, (50,30) is in rows 0 and 2 only: the last of them", 0x200, (50, 30))
    fresh(rows=[(0, 20, 100, 50)], opened=True)
    hit("C3 move, open, in the dropdown but in no row: taken, focused stays", 0x200, (50, 70))
    fresh(rows=[], opened=True)
    hit("C3 move, open, no rows at all, over the dropdown: taken", 0x200, ROW1)
    fresh(opened=True, bar=True, pos=2)
    hit("C3 move, open, a scroll bar at the position 2, over row 0: row 0 is focused all the same (the move looks at every row)", 0x200, ROW0)

    # ================================================================ 0x201 / 0x203 on the box
    for m in (0x201, 0x203):
        fresh()
        hit("C4 0x%X on the box, closed, nobody has the focus: pressed, the window takes the mouse, the box gets the focus, the sound, it opens, message 22" % m, m)
        fresh(); o.give_focus("Y")
        hit("C4 0x%X on the box, closed, Y has the focus: Y loses it, the box gets it, opens" % m, m)
        fresh(); o.give_focus("A")
        hit("C4 0x%X on the box, closed, it has the focus already: no request, opens" % m, m)
        fresh(opened=True); o.give_focus("A")
        hit("C4 0x%X on the box, open, it has the focus: the focus is cleared (OnFocusOut of the box: closed, adjust set), message 23" % m, m)
        fresh(opened=True); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
        hit("C4 0x%X on the box, open, its flag is set but Y is the focused control: ClearFocus tells Y, the flag stays, closed, message 23" % m, m)
        fresh(opened=True)
        hit("C4 0x%X on the box, open, it does not have the focus: it asks for it, gets it, and closes (the close clears the focus it just got)" % m, m)
        fresh(); o.focus("A")
        hit("C4 0x%X on the box, closed, A is the focused control but its flag is off: RequestFocus does nothing, no sound, no change, taken" % m, m)
        fresh(opened=True); o.focus("A")
        hit("C4 0x%X on the box, open, the same: nothing happens but the press and the capture" % m, m)
    fresh(pressed=True)
    hit("C4 left button down on the box, it is pressed already: still pressed", 0x201)
    fresh(open_msg=-1)
    hit("C4 down on the box, closed, no open message (-1): opens, nothing is sent", 0x201)
    fresh(open_msg=0)
    hit("C4 down on the box, closed, the open message 0: sent", 0x201)
    fresh(open_msg=-2)
    hit("C4 down on the box, closed, the open message -2: sent", 0x201)
    fresh(opened=True, close_msg=-1); o.give_focus("A")
    hit("C4 down on the box, open, no close message (-1): closes, nothing is sent", 0x201)
    fresh(opened=True, close_msg=0); o.give_focus("A")
    hit("C4 down on the box, open, the close message 0: sent", 0x201)
    fresh(opened=True, close_msg=-2, open_msg=-1); o.give_focus("A")
    hit("C4 down on the box, open, the close message -2, no open message: the close message goes out", 0x201)
    fresh(opened=True, close_msg=-1, open_msg=33); o.give_focus("A")
    hit("C4 down on the box, open, no close message but an open message 33: nothing is sent", 0x201)
    fresh(sound=False)
    hit("C4 down on the box, closed, no mouse down sound: the call is made with none", 0x201)
    fresh(sel_msg=-1)
    hit("C4 down on the box, closed, no selection message: the open message goes out (22), not the selection message", 0x201)
    fresh(); o.managed_("D", False)
    hit("C4 down on the box, the manager does not know D: no difference (no CheckDlg here)", 0x201)
    fresh(); o.give_focus("Y"); o.gone("D")
    hit("C4 down on the box, D is gone: the focus moves (RequestFocus reads no dialog), no message to the stage (no dialog)", 0x201)
    fresh(box=(0, 0, 100, 30))
    hit("C4 down on a point of the box that is also in the dropdown (50,25): the box wins", 0x201, (50, 25))
    for point, tag in (((0, 0), "the left-top corner"), ((99, 19), "the last pixel"), ((100, 10), "x = right: outside"), ((50, 20), "y = bottom: outside"),
                       ((-1, 10), "x = left - 1: outside"), ((50, -1), "y = top - 1: outside")):
        fresh()
        hit("C4 down at %s of the box (0,0)-(100,20)" % tag, 0x201, point)

    # ================================================================ 0x201 / 0x203 off the box
    for m in (0x201, 0x203):
        fresh(pressed=True); o.give_focus("A")
        hit("C5 0x%X outside, closed, it has the focus: not pressed, ClearFocus (OnFocusOut of the box), the rows' controls get it, not taken" % m, m, OUT, **ARGS)
        fresh(pressed=True); o.give_focus("Y")
        hit("C5 0x%X outside, closed, Y has the focus: ClearFocus tells Y" % m, m, OUT, **ARGS)
        fresh(pressed=True)
        hit("C5 0x%X outside, closed, nobody has the focus: only the flag and the rows" % m, m, OUT, **ARGS)
        fresh(pressed=True, opened=True); o.give_focus("A")
        hit("C5 0x%X outside, open, selected 1, focused 2: the focus goes back to 1, the sound, the selection message 21 (selected 1, focused 1, still open), closes, not pressed, ClearFocus, the rows" % m, m, OUT, **ARGS)
        fresh(pressed=True, opened=True); o.give_focus("Y")
        hit("C5 0x%X outside, open, Y has the focus: the same, ClearFocus tells Y" % m, m, OUT, **ARGS)
    fresh(opened=True, sel_msg=-1); o.give_focus("A")
    hit("C5 down outside, open, no selection message (-1): the control event 0x466 with 0", 0x201, OUT)
    fresh(opened=True, sel_msg=0); o.give_focus("A")
    hit("C5 down outside, open, the selection message 0: 0x467 with 0", 0x201, OUT)
    fresh(opened=True, sel_msg=-2); o.give_focus("A")
    hit("C5 down outside, open, the selection message -2: 0x467 with -2", 0x201, OUT)
    fresh(opened=True, sound=False)
    hit("C5 down outside, open, no mouse down sound: the call is made with none", 0x201, OUT)
    fresh(opened=True, selected=-1, focused=3); o.give_focus("A")
    hit("C5 down outside, open, nothing selected (-1): the focused row becomes -1", 0x201, OUT)
    fresh(opened=True); o.give_focus("A"); o.gone("D")
    hit("C5 down outside, open, D is gone: no message to the stage, the rest is done", 0x201, OUT)
    fresh(opened=True); o.give_focus("A")
    hit("C5 down on the box's row of pixels just above the dropdown (50,19) (the box is (0,0)-(100,20): inside it)", 0x201, (50, 19))
    fresh(opened=True); o.give_focus("A")
    hit("C5 down just below the dropdown (50,80): outside it", 0x201, (50, 80))
    for m in (0x201, 0x203):
        fresh(pressed=True); o.give_focus("A")
        hit("C5 0x%X in the dropdown area of a CLOSED box (50,50): it is not picked, the focus is cleared, the rows' controls get it" % m, m, ROW1, **ARGS)

    # ---- inside the open dropdown, no scroll bar
    for point, k in ((ROW0, 0), (ROW1, 1), (ROW2, 2)):
        fresh(opened=True, pressed=True, selected=-1, focused=-1); o.give_focus("A")
        hit("C6 down in the open dropdown on row %d, no bar: selected and focused, the sound, message 21 (the row already selected, still open), closes; taken; no ClearFocus, not unpressed, the rows get nothing" % k, 0x201, point)
    fresh(opened=True); o.give_focus("A")
    hit("C6 0x203 in the open dropdown on row 0: the same", 0x203, ROW0)
    fresh(opened=True); o.give_focus("Y")
    hit("C6 down in the open dropdown on row 2, Y has the focus: Y keeps it", 0x201, ROW2)
    fresh(opened=True, sel_msg=-1)
    hit("C6 down in the open dropdown on row 1, no selection message: 0x466 with 0", 0x201, ROW1)
    fresh(opened=True, sel_msg=0)
    hit("C6 down in the open dropdown on row 1, the selection message 0", 0x201, ROW1)
    fresh(opened=True, sound=False)
    hit("C6 down in the open dropdown on row 1, no sound: the call is made with none", 0x201, ROW1)
    fresh(opened=True); o.gone("D")
    hit("C6 down in the open dropdown, D is gone: no message to the stage", 0x201, ROW1)
    fresh(rows=overlap, opened=True, selected=-1, focused=-1)
    hit("C6 down at (50,50) in the open dropdown, three rows hold it: the FIRST is selected", 0x201, (50, 50))
    fresh(rows=overlap, vis=[False, True, True], opened=True, selected=-1, focused=-1)
    hit("C6 the same, the first is not visible: the second", 0x201, (50, 50))
    fresh(rows=overlap, vis=[False, False, False], opened=True)
    hit("C6 the same, no row is visible: taken, nothing changes (still open)", 0x201, (50, 50))
    fresh(rows=[(0, 20, 100, 50)], opened=True)
    hit("C6 down in the open dropdown, in no row: taken, nothing changes (still open, no sound, no message)", 0x201, (50, 70))
    fresh(rows=[], opened=True)
    hit("C6 down in the open dropdown, no rows: taken, nothing changes", 0x201, ROW1)
    fresh(opened=True); o.give_focus("A")
    hit("C6 down on the dropdown's first pixel (0,20): row 0", 0x201, (0, 20))

    # ---- inside the open dropdown, with a scroll bar: the rows are searched from the bar's position, and the focus is cleared
    for pos, point, tag in ((0, ROW0, "row 0 from 0"), (1, ROW1, "row 1 from 1"), (2, ROW2, "row 2 from 2"), (1, ROW2, "row 2 from 1"), (0, ROW2, "row 2 from 0")):
        fresh(opened=True, bar=True, pos=pos, pressed=True, selected=-1, focused=-1); o.give_focus("A")
        hit("C7 down in the open dropdown, the bar at %d, the point in %s: selected and focused, the sound, message 21, closes; ClearFocus (the box loses the focus), taken" % (pos, tag), 0x201, point)
    fresh(opened=True, bar=True, pos=1); o.give_focus("A")
    hit("C7 down in the open dropdown, the bar at 1, the point in row 0 (not searched): taken, nothing changes", 0x201, ROW0)
    fresh(opened=True, bar=True, pos=2); o.give_focus("A")
    hit("C7 down in the open dropdown, the bar at 2, the point in row 1: nothing changes", 0x201, ROW1)
    fresh(opened=True, bar=True, pos=3); o.give_focus("A")
    hit("C7 down in the open dropdown, the bar at 3 (= the number of rows): taken, nothing happens", 0x201, ROW2)
    fresh(opened=True, bar=True, pos=7); o.give_focus("A")
    hit("C7 down in the open dropdown, the bar at 7 (past the rows): taken, nothing happens", 0x201, ROW2)
    fresh(rows=overlap, opened=True, bar=True, pos=1, selected=-1, focused=-1); o.give_focus("A")
    hit("C7 the bar at 1, three rows hold (50,50): the first from the position is selected (row 1)", 0x201, (50, 50))
    fresh(rows=overlap, vis=[True, False, True], opened=True, bar=True, pos=1, selected=-1, focused=-1); o.give_focus("A")
    hit("C7 the bar at 1, row 1 is not visible: row 2", 0x201, (50, 50))
    fresh(rows=overlap, vis=[True, False, False], opened=True, bar=True, pos=1, selected=-1, focused=-1); o.give_focus("A")
    hit("C7 the bar at 1, no row from 1 on is visible: taken, nothing changes", 0x201, (50, 50))
    fresh(opened=True, bar=True, pos=0); o.give_focus("Y")
    hit("C7 down in the open dropdown on row 1, a bar, Y has the focus: ClearFocus tells Y", 0x201, ROW1)
    fresh(opened=True, bar=True, pos=0, sel_msg=-1); o.give_focus("A")
    hit("C7 down on row 1, a bar, no selection message: 0x466 with 0", 0x201, ROW1)
    fresh(opened=True, bar=True, pos=0, sound=False); o.give_focus("A")
    hit("C7 down on row 1, a bar, no sound: the call is made with none", 0x201, ROW1)
    fresh(opened=True, bar=True, pos=0); o.give_focus("A"); o.gone("D")
    hit("C7 down on row 1, a bar, D is gone: no message to the stage, the focus is cleared", 0x201, ROW1)
    fresh(opened=True, bar=True, pos=0)
    hit("C7 down on row 1, a bar, nobody has the focus: nothing to clear", 0x201, ROW1)
    fresh(opened=True, bar=True, pos=1, selected=0, focused=0); o.give_focus("A")
    hit("C7 down outside the dropdown, open, a bar: the focus goes back to the selection, the message, closes, ClearFocus once, the rows", 0x201, OUT, **ARGS)
    fresh(bar=True, pos=1); o.give_focus("A")
    hit("C7 down on the box with a bar (the bar answers no): it opens as without one", 0x201)

    # ================================================================ 0x202
    fresh(pressed=True)
    hit("C8 left button up on the box while it is pressed: let go, the mouse is given back, taken, the rows' controls get nothing", 0x202, BOX, **ARGS)
    fresh(pressed=True, opened=True); o.give_focus("A")
    hit("C8 up on the box, pressed, open: let go, taken; it stays open and keeps the focus", 0x202)
    fresh(pressed=True)
    hit("C8 up outside the box while it is pressed: it stays pressed, no release, the rows' controls get it, not taken", 0x202, OUT, **ARGS)
    fresh(pressed=True)
    hit("C8 up on the dropdown while it is pressed: the rows' controls get it, still pressed", 0x202, ROW1, **ARGS)
    fresh(pressed=False)
    hit("C8 up on the box, not pressed: the rows' controls get it, not taken, no release", 0x202, BOX, **ARGS)
    fresh(pressed=False)
    hit("C8 up outside the box, not pressed: the rows' controls get it", 0x202, OUT, **ARGS)
    fresh(pressed=True)
    hit("C8 up at (100,10), just outside the box's right edge, pressed: not let go", 0x202, (100, 10))
    fresh(pressed=True)
    hit("C8 up at (99,19), the last pixel of the box, pressed: let go", 0x202, (99, 19))

    # ================================================================ 0x20A
    for tag, wp in (("120", 0x00780000), ("-120", 0xFF880000), ("240", 0x00F00000), ("119", 0x00770000), ("-119", 0xFF890000), ("-121", 0xFF870000),
                    ("0", 0), ("120 with noise in the low word", 0x00780001), ("32767", 0x7FFF0000), ("-32768", 0x80000000)):
        fresh(opened=True, bar=True)
        o.wheel(3)
        hit("C9 wheel %s, open, a scroll bar, 3 lines a notch: the bar scrolls by -(3 * notches)" % tag, 0x20A, ROW1, wp)
    for lines, wp in ((5, 0xFF880000), (5, 0xFF100000), (0, 0x00780000), (1 << 30, 0x00F00000), (1, 0x80000000), (7, 0x00780000)):
        fresh(opened=True, bar=True)
        o.wheel(lines)
        hit("C9 wheel 0x%08X, open, a bar, %d lines a notch" % (wp, lines), 0x20A, ROW1, wp)
    fresh(opened=True)
    o.wheel(3)
    hit("C9 wheel, open, no scroll bar: the system is asked for the lines all the same, nothing else; not taken", 0x20A, ROW1, 0x00780000)
    fresh(opened=True, bar=True)
    o.wheel(3)
    hit("C9 wheel, open, the point outside the dropdown: the same", 0x20A, OUT, 0x00780000)
    # closed: one row up or down
    for focused, wp, tag in ((2, 0x00780000, "up from row 2"), (1, 0x00780000, "up from row 1"), (0, 0x00780000, "up from row 0: nothing"),
                             (-1, 0x00780000, "up from -1: nothing"), (1, 0x00F00000, "up by two notches from row 1: one row"),
                             (0, 0xFF880000, "down from row 0"), (1, 0xFF880000, "down from row 1"), (2, 0xFF880000, "down from row 2 (the last): nothing"),
                             (-1, 0xFF880000, "down from -1: row 0"), (0, 0x00770000, "119 (0 notches) from row 0: down"),
                             (1, 0xFF890000, "-119 (0 notches) from row 1: down"), (1, 0, "no wheel (0) from row 1: down"),
                             (2, 0xFF100000, "down by 14 notches from row 2: nothing"), (5, 0xFF880000, "down from row 5 (past the rows): nothing"),
                             (5, 0x00780000, "up from row 5 (past the rows): row 4")):
        fresh(focused=focused, selected=0)
        hit("C10 wheel %s, closed: the focused and the selected row both become the new one, message 21" % tag, 0x20A, ROW1, wp)
    fresh(sel_msg=-1, focused=1)
    hit("C10 wheel up, closed, no selection message: 0x466 with 0", 0x20A, ROW1, 0x00780000)
    fresh(sel_msg=0, focused=1)
    hit("C10 wheel down, closed, the selection message 0", 0x20A, ROW1, 0xFF880000)
    fresh(focused=1); o.gone("D")
    hit("C10 wheel down, closed, D is gone: the row moves, no message to the stage", 0x20A, ROW1, 0xFF880000)
    fresh(rows=[], focused=-1)
    hit("C10 wheel down, closed, no rows: nothing", 0x20A, ROW1, 0xFF880000)
    fresh(rows=[ROWS[0]], focused=0)
    hit("C10 wheel down, closed, one row, focused 0: nothing", 0x20A, ROW1, 0xFF880000)
    fresh(focused=0x7FFFFFFF, selected=0)
    hit("C10 wheel down, closed, focused 2147483647: the next row wraps to -2147483648 (a 32-bit sum), which is below the end: it is taken", 0x20A, ROW1, 0xFF880000)
    fresh(focused=-0x80000000, selected=0)
    hit("C10 wheel up, closed, focused -2147483648: nothing above the first row", 0x20A, ROW1, 0x00780000)
    fresh(focused=0x7FFFFFFF, selected=0)
    hit("C10 wheel up, closed, focused 2147483647: one row up", 0x20A, ROW1, 0x00780000)
    fresh(focused=1)
    o.wheel(3)
    hit("C10 wheel, closed: the system is not asked (no spi)", 0x20A, OUT, 0xFF880000)
    fresh(bar=True, focused=1)
    hit("C10 wheel down, closed, with a scroll bar that answers no: the bar is asked, then the row moves", 0x20A, ROW1, 0xFF880000)

    # ================================================================ OnFocusOut (3293D930) and OnHotkey (3293F790)
    fresh(opened=True, pressed=True, adjust=False, btn_off=(5, -7)); o.give_focus("A")
    o.act_out("C11 OnFocusOut: the flag is cleared, the dropdown closes, the button offset is 0, the mouse point is to be adjusted (the focused control is not cleared)", "A")
    fresh(opened=False, adjust=True, btn_off=(0, 0))
    o.act_out("C11 OnFocusOut of a box that has none of it: only the adjust flag is set (already)", "A")
    fresh(opened=True, adjust=False, btn_off=(-3, 9)); o.focus("Y")
    o.act_out("C11 OnFocusOut, the global focus is Y: Y keeps it", "A")
    for sel, opened, tag in ((0, False, "0 -> 1"), (1, False, "1 -> 2"), (2, False, "2 (the last) -> 0"), (-1, False, "-1: nothing"), (1, True, "open: nothing"),
                             (5, False, "5 (past the rows) -> 0"), (-2, False, "-2 -> -1 (the row before the first is the 'next')")):
        fresh(selected=sel, focused=0, opened=opened)
        o.act_hotkey("C12 OnHotkey, selected %s" % tag, "A")
    fresh(selected=0x7FFFFFFF, focused=0)
    o.act_hotkey("C12 OnHotkey, selected 2147483647: the next is -2147483648 (a 32-bit sum), below the end", "A")
    fresh(selected=-0x80000000, focused=0)
    o.act_hotkey("C12 OnHotkey, selected -2147483648: the next is -2147483647", "A")
    fresh(selected=0, focused=2, sel_msg=-1)
    o.act_hotkey("C12 OnHotkey, no selection message: 0x466 with 0", "A")
    fresh(selected=0, focused=2, sel_msg=0)
    o.act_hotkey("C12 OnHotkey, the selection message 0", "A")
    fresh(selected=0, focused=2); o.gone("D")
    o.act_hotkey("C12 OnHotkey, D is gone: the selection moves, no message to the stage", "A")
    fresh(rows=[], selected=0, focused=-1)
    o.act_hotkey("C12 OnHotkey, no rows, selected 0: 1 is past the end, so 0", "A")
    return o


if __name__ == "__main__":
    o = main()
    if "--json" in sys.argv:
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w", encoding="utf-8") as fh:  # one step per line
            import json
            fh.write("[\n" + ",\n".join(json.dumps(step, ensure_ascii=False) for step in o.script) + "\n]\n")
