#!/usr/bin/env python3
"""
The input of the slot control (`CKTDGUISlot`) of x2.exe on the Unicorn CPU emulator: the oracle of `CKTDGUISlot.handleMouse`,
`CKTDGUISlot.onFocusOut` and `getGuideDescPos` / `getIsGuideDescAbsolutePos` (packages/ui/src/slot.ts, control.ts; tested by
packages/ui/test/slots-input.test.ts, which replays packages/ui/test/slots-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-slots.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-slots.py --json FILE    (and writes the script and the exe's answers to FILE)

The exe's functions run as they are: CKTDGUISlot::HandleMouse 329520A0 (through slot 8 of a copy of the real vtable of the class), OnFocusOut
329523D0 (slot 10), GetGuideDescPos 32951F20 (slot 34), the control's GetGuideDescPos 329247A0 and GetIsGuideDescAbsolutePos 329247E0, and what they call:
ContainsPoint 3292D460 (the control's own test over the current point), SendInternelEvent 329253D0, RequestFocus 3295B490 and the base OnFocusIn /
CanHaveFocus.  What is replaced by a stub that writes the call down (see oracle-controls.py and oracle-input.py): `CKTDGUISlot::ChangeState` (virtual
slot 41 of the vtable copy of every slot): `A.change(state,force)`; `CKTDGUISlot::ReturnDraggingItem` 329534A0: `returnDrag` (it does not clear
`s_pDragSlot` here); `CKTDGUIControl::PlaySoundW`: `A.sound(up)` / `A.sound(down)` / `A.sound(none)`; CheckDlg and the handle comparison.
The layout is the exe's: slot +0x1C4 m_vGuideDescAbsolutePos, +0x1CC m_vGuideDescOffsetPos, +0x22C m_pMouseOverPoint, +0x314 m_bDragable, +0x360
m_pDroppedSlot, +0x364 m_eControlState (NORMAL 0, DOWN 1, MOUSEOVER 2, ONDRAG 3, DISABLE 4, END 5), +0x36C the mouse-up sound, +0x370 the mouse-down
sound, +0x37C m_CustomMsgMouseDown, +0x380 MouseUp, +0x384 MouseRightUp, +0x388 Dropped; the static `s_pDragSlot` is at 0x336434A8.
"""
import importlib.util, math, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from peemu import *

_spec = importlib.util.spec_from_file_location("oracle_controls", os.path.join(HERE, "oracle-controls.py"))
oc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oc)
oi = oc.oi
om = oi.om
EAX, ECX = oi.EAX, oi.ECX

SLOT_HANDLE_MOUSE, SLOT_ON_FOCUS_OUT, SLOT_GET_GUIDE_DESC_POS = 0x329520A0, 0x329523D0, 0x32951F20
BASE_GET_GUIDE_DESC_POS, BASE_GET_IS_GUIDE_DESC_ABSOLUTE_POS = 0x329247A0, 0x329247E0
oc.HANDLERS["slot"] = SLOT_HANDLE_MOUSE


def num(v):
    """a number the way JavaScript prints it"""
    if math.isnan(v):
        return "NaN"
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    if v == 0:
        return "0"
    text = repr(v)
    return text[:-2] if text.endswith(".0") else text


def jf(v):
    """a float for the script (JSON has no NaN: it is written as the text NaN, which the replay turns back with `Number`)"""
    return "NaN" if math.isnan(v) else v


def quad(l, t, r, b):
    """the eight coordinates of a rectangle's corners: left-top, right-top, left-bottom, right-bottom"""
    return (l, t, r, t, l, b, r, b)


def named(o, address):
    return o.name(address) if address else "none"


oc.STATE_KEYS["slot"] = ("hasFocus", "focus", "state", "dropped", "dragSlot")
oc.FIELD_OFFSETS["slot"] = {
    "state": (0x364, "i"),
    "dropped": lambda o, c: named(o, o.emu.u32(c + 0x360)),
    "dragSlot": lambda o, c: named(o, o.emu.u32(o.DRAG)),
}


class SlotOracle(oc.ControlOracle):
    watch_dropped = False

    def reset(self):
        super().reset()
        self.watch_dropped = False

    def watch(self, on=True):
        """from now on a message of a slot to the stage is written down with the slot's `m_pDroppedSlot` of that moment: `stage(1127,14,A)[dropped=B]`
        (what the stage's handler sees when it asks the slot which slot was dropped on it)"""
        self.watch_dropped = on
        self.op("watch", on)

    def _stage_msg(self, emu):
        super()._stage_msg(emu)
        lparam = emu.args(4)[3]
        if self.watch_dropped and self.kind.get(lparam) == "slot":
            self.events[-1] += "[dropped=%s]" % named(self, emu.u32(lparam + 0x360))

    def slot_(self, label, dialog, index=1, rect=(0, 0, 40, 40), enable=True, show=True, state=0, dragable=True, down=11, up=12, right_up=13, drop=14,
              snd_up=True, snd_down=True, guide=(0.0, 0.0), offset=(0.0, 0.0), over=None):
        """a slot: its current point is the rectangle `rect`; `over`: its mouse-over point, the eight coordinates of its corners (left-top, right-top,
        left-bottom, right-bottom: x then y; `quad(l, t, r, b)` makes a rectangle's) or none"""
        emu = self.emu
        l, t, r, b = rect
        c = self.control("Slot", label, corners=om.rect(l, t, r, b), dialog=index, show=show, enable=enable)
        vt = emu.alloc(4 * 64)
        emu.write(vt, emu.read(om.VTABLE["Slot"], 4 * 42))
        emu.w32(vt + 4 * 41, self.change_stub)
        emu.w32(c, vt)
        emu.write(c + 0x1C4, struct.pack("<4f", guide[0], guide[1], offset[0], offset[1]))
        if over is not None:
            point = emu.alloc(0x60)
            emu.write(point, struct.pack("<8f", *over))
            emu.w32(c + 0x22C, point)
        emu.write(c + 0x314, bytes([1 if dragable else 0]))
        emu.w32(c + 0x364, state)
        emu.write(c + 0x36C, struct.pack("<II", oc.SOUND_UP if snd_up else 0, oc.SOUND_DOWN if snd_down else 0))
        emu.write(c + 0x37C, struct.pack("<4i", down, up, right_up, drop))
        self.addr[label] = c
        self.owner[c] = self.addr[dialog]
        self.kind[c] = "slot"
        self.op("slotctl", label, dialog, {"rect": list(rect), "enable": enable, "show": show, "state": state, "dragable": dragable, "down": down, "up": up,
                                         "rightUp": right_up, "drop": drop, "sndUp": snd_up, "sndDown": snd_down, "guide": [jf(v) for v in guide],
                                         "offset": [jf(v) for v in offset], "over": list(over) if over is not None else None})
        return c

    def put_guide(self, label, guide, offset):
        """the guide text's absolute position and offset of any control (the base members at +0x1C4 and +0x1CC)"""
        self.emu.write(self.addr[label] + 0x1C4, struct.pack("<4f", guide[0], guide[1], offset[0], offset[1]))
        self.op("putGuide", label, [jf(v) for v in guide], [jf(v) for v in offset])

    def drag_(self, label):
        """`CKTDGUISlot::s_pDragSlot` is the slot `label` (none: null)"""
        self.emu.w32(self.DRAG, self.addr[label] if label else 0)
        self.op("dragslot", label)

    def act_out(self, case, label):
        """send `OnFocusOut()` (virtual slot 10) to the control"""
        c = self.addr[label]
        self.events = []
        handler = self.emu.u32(self.emu.u32(c) + 4 * 10)
        assert handler == SLOT_ON_FOCUS_OUT, hex(handler)
        self.thiscall(handler, c, [])
        events = list(self.events)
        state = self.state_of(label)
        print("%-100s -> | %s | %s" % (case, ",".join(events), state))
        self.op("act_out", case, label, {"ret": 0, "events": events, "state": state})

    def act_guide(self, case, label, what):
        """ask the control for `GetGuideDescPos` (virtual slot 34, `what` = "pos": the point `x,y`) or `GetIsGuideDescAbsolutePos` (slot 36, "isAbsolute")"""
        c = self.addr[label]
        emu = self.emu
        vt = emu.u32(c)
        if what == "pos":
            fn = emu.u32(vt + 4 * 34)
            assert fn in (SLOT_GET_GUIDE_DESC_POS, BASE_GET_GUIDE_DESC_POS), hex(fn)
            out = emu.alloc(8)
            self.thiscall(fn, c, [out])
            x, y = struct.unpack("<2f", emu.read(out, 8))
            value = "%s,%s" % (num(x), num(y))
        else:
            fn = emu.u32(vt + 4 * 36)
            assert fn == BASE_GET_IS_GUIDE_DESC_ABSOLUTE_POS, hex(fn)
            value = str(self.thiscall(fn, c, []) & 0xFF)
        print("%-100s -> %s" % (case, value))
        self.op("act_guide", case, label, what, value)
        return value


def main():
    o = SlotOracle()
    IN, OUT = (20, 20), (100, 100)

    def fresh_slot(drag=None, bstate=0, **kw):
        """D (managed, with a stage), the slot A (0,0)-(40,40), a second slot B (60,0)-(100,40) in the state `bstate`, a probe control Y (0,60)-(40,100) that
        can take the focus; `drag`: the slot that is `s_pDragSlot` (A or B)"""
        o.reset()
        o.watch()
        o.dialog_("D")
        o.managed_("D", True)
        o.slot_("A", "D", **kw)
        o.slot_("B", "D", rect=(60, 0, 100, 40), state=bstate)
        o.control_("Y", "D", rect=(0, 60, 40, 100))
        o.register("D", ["A", "B", "Y"])
        if drag:
            o.drag_(drag)

    def hit(case, uMsg, point=IN, label="A"):
        return o.act_ctl(case, label, uMsg, point[0], point[1], 0, 0)

    # ================================================================ CKTDGUISlot::HandleMouse (329520A0)
    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False})):
        fresh_slot(**kw)
        hit("SL1 left button down inside, %s" % tag, 0x201)
    for m in (0x202, 0x204, 0x205):
        for tag, kw in (("disabled", {"enable": False}), ("hidden", {"show": False})):
            fresh_slot(drag="B", bstate=3, **kw)
            o.give_focus("A")
            hit("SL1 message 0x%X inside, %s: not taken, nothing changes" % (m, tag), m)
    for m in (0x200, 0x203, 0x206, 0x207, 0x20A, 0x100, 0x401, 0x215):
        fresh_slot()
        hit("SL1 message 0x%X inside: not taken" % m, m)

    # ---- the left button down
    fresh_slot()
    hit("SL2 down inside, dragable, no focus: the focus (nobody had it), the mouse-down sound, ChangeState(ONDRAG), the custom message 11, taken", 0x201)
    fresh_slot(); o.give_focus("Y")
    hit("SL2 down inside, Y has the focus: Y loses it, A gets it", 0x201)
    fresh_slot(); o.give_focus("A")
    hit("SL2 down inside, A has the focus already: no request", 0x201)
    fresh_slot(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    hit("SL2 down inside, m_bHasFocus set but the global focus is Y: no request", 0x201)
    fresh_slot(); o.give_focus("Y"); o.managed_("D", False)
    hit("SL2 down inside, the manager does not know D: no request (CheckDlg), the rest is the same", 0x201)
    fresh_slot(); o.give_focus("Y"); o.gone("D")
    hit("SL2 down inside, D is gone: no request, no message to the stage (no dialog), the rest is the same", 0x201)
    fresh_slot(dragable=False)
    hit("SL2 down inside, not dragable: ChangeState(DOWN)", 0x201)
    fresh_slot(); o.give_focus("Y")
    hit("SL2 down outside (100,100): not taken, no request", 0x201, OUT)
    fresh_slot(); o.give_focus("Y")
    hit("SL2 down on B's place (70,20), outside A: not taken", 0x201, (70, 20))
    fresh_slot(down=-1)
    hit("SL2 down inside with no custom message (-1): the state is set, nothing is sent, taken", 0x201)
    fresh_slot(down=0)
    hit("SL2 down inside with the custom message 0: it is sent", 0x201)
    fresh_slot(down=-2)
    hit("SL2 down inside with the custom message -2: it is sent", 0x201)
    fresh_slot(snd_down=False)
    hit("SL2 down inside, no mouse-down sound: the call is made with none", 0x201)
    for st in (0, 1, 2, 3, 5, 6):
        fresh_slot(state=st)
        hit("SL2 down inside, A in the state %d: ChangeState(ONDRAG) all the same" % st, 0x201)
    fresh_slot(state=4)
    hit("SL2 down inside, A in the state DISABLE (enabled, shown): the focus and the sound, no ChangeState, no message, taken", 0x201)
    fresh_slot(state=4, dragable=False); o.give_focus("Y")
    hit("SL2 the same, not dragable", 0x201)
    fresh_slot(state=4, down=-1)
    hit("SL2 the same, no custom message", 0x201)

    # ---- the left button up
    fresh_slot(drag="B", bstate=3)
    hit("SL3 up outside the slot: taken, nothing happens (B is still dragged)", 0x202, OUT)
    fresh_slot(drag="B", bstate=3, state=1)
    hit("SL3 up outside the slot in the state DOWN: taken, nothing happens", 0x202, OUT)
    fresh_slot(drag="B", bstate=3, state=3)
    hit("SL3 up outside the slot in the state ONDRAG: taken, nothing happens", 0x202, OUT)
    for st, name in ((0, "NORMAL"), (2, "MOUSEOVER")):
        fresh_slot(state=st)
        hit("SL3 up inside, %s, nobody is dragged: the mouse-up sound, taken" % name, 0x202)
        fresh_slot(state=st, drag="B", bstate=3)
        hit("SL3 up inside, %s, B is dragged (ONDRAG): B is dropped on A: m_pDroppedSlot = B, the custom message 14, ReturnDraggingItem (B goes back), the sound" % name, 0x202)
        for bst in (0, 1, 2, 4):
            fresh_slot(state=st, drag="B", bstate=bst)
            hit("SL3 up inside, %s, B is the dragged slot but in the state %d (not ONDRAG): only the sound" % (name, bst), 0x202)
        fresh_slot(state=st, drag="A")
        hit("SL3 up inside, %s, A itself is the dragged slot (its state is not ONDRAG): only the sound" % name, 0x202)
    fresh_slot(drop=-1, drag="B", bstate=3)
    hit("SL3 up inside, NORMAL, B dropped with no custom message (-1): it is sent all the same (wParam -1)", 0x202)
    fresh_slot(drop=0, drag="B", bstate=3)
    hit("SL3 up inside, NORMAL, B dropped with the custom message 0", 0x202)
    fresh_slot(drag="B", bstate=3); o.gone("D")
    hit("SL3 up inside, NORMAL, B dropped, D is gone: no message to the stage, the drop is made", 0x202)
    fresh_slot(drag="B", bstate=3); o.give_focus("Y")
    hit("SL3 up inside, NORMAL, B dropped, Y has the focus: the focus does not move", 0x202)
    fresh_slot(state=1)
    hit("SL3 up inside, DOWN, nobody is dragged: the custom message 12, ChangeState(NORMAL), the sound", 0x202)
    fresh_slot(state=1, drag="B", bstate=3)
    hit("SL3 up inside, DOWN, B is dragged: the message, A to normal, then B goes back (forced) and nobody is dragged, the sound", 0x202)
    fresh_slot(state=1, drag="B", bstate=0)
    hit("SL3 up inside, DOWN, B is the dragged slot in the state NORMAL: B goes back all the same", 0x202)
    fresh_slot(state=1, drag="A")
    hit("SL3 up inside, DOWN, A itself is the dragged slot: A.change(NORMAL, false), then A.change(NORMAL, true), nobody is dragged", 0x202)
    fresh_slot(state=1, up=-1)
    hit("SL3 up inside, DOWN, no custom message (-1): it is sent all the same (wParam -1)", 0x202)
    fresh_slot(state=1, up=0)
    hit("SL3 up inside, DOWN, the custom message 0", 0x202)
    fresh_slot(state=1); o.gone("D")
    hit("SL3 up inside, DOWN, D is gone: no message to the stage", 0x202)
    fresh_slot(state=3, drag="A")
    hit("SL3 up inside, ONDRAG, A is the dragged slot: ReturnDraggingItem (A.change(NORMAL, true), nobody is dragged), the sound", 0x202)
    fresh_slot(state=3, drag="B", bstate=3)
    hit("SL3 up inside, ONDRAG, B is the dragged slot: only the sound", 0x202)
    fresh_slot(state=3)
    hit("SL3 up inside, ONDRAG, nobody is dragged: only the sound", 0x202)
    for st in (4, 5, 6, 7):
        fresh_slot(state=st)
        hit("SL3 up inside, the state %d, nobody is dragged: the sound" % st, 0x202)
        fresh_slot(state=st, drag="B", bstate=3)
        hit("SL3 up inside, the state %d, B is dragged: B goes back (forced), nobody is dragged, the sound" % st, 0x202)
        fresh_slot(state=st, drag="A")
        hit("SL3 up inside, the state %d, A is the dragged slot: A goes back (forced)" % st, 0x202)
    fresh_slot(state=0, snd_up=False)
    hit("SL3 up inside, NORMAL, no mouse-up sound: the call is made with none", 0x202)

    # ---- the right button down
    fresh_slot(); o.give_focus("Y")
    hit("SL4 right down inside, Y has the focus: A asks for it and gets it, A.change(DOWN), the mouse-down sound, taken", 0x204)
    fresh_slot(); o.give_focus("A")
    hit("SL4 right down inside, A has the focus already: no request", 0x204)
    fresh_slot(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    hit("SL4 right down inside, m_bHasFocus set but the global focus is Y: no request, the rest is done", 0x204)
    fresh_slot(); o.give_focus("Y")
    hit("SL4 right down outside (100,100): the focus is requested all the same, nothing else, taken", 0x204, OUT)
    fresh_slot(); o.give_focus("Y")
    hit("SL4 right down on B's place (70,20), outside A: the focus is requested all the same", 0x204, (70, 20))
    fresh_slot(); o.give_focus("A")
    hit("SL4 right down outside, A has the focus: nothing", 0x204, OUT)
    fresh_slot(); o.give_focus("Y"); o.managed_("D", False)
    hit("SL4 right down inside, the manager does not know D: no request, A does not have the focus: taken, nothing else", 0x204)
    fresh_slot(); o.give_focus("Y"); o.gone("D")
    hit("SL4 right down inside, D is gone: no request, nothing else", 0x204)
    fresh_slot(state=3, drag="A"); o.give_focus("A")
    hit("SL4 right down inside, ONDRAG, A is the dragged slot: ReturnDraggingItem (A.change(NORMAL, true)), then A.change(DOWN)", 0x204)
    fresh_slot(state=3, drag="B", bstate=3); o.give_focus("A")
    hit("SL4 right down inside, ONDRAG, B is the dragged slot: ReturnDraggingItem sends B back (not A), then A.change(DOWN)", 0x204)
    fresh_slot(state=3); o.give_focus("A")
    hit("SL4 right down inside, ONDRAG, nobody is dragged: ReturnDraggingItem does nothing, A.change(DOWN)", 0x204)
    for st in (0, 1, 2, 4, 5):
        fresh_slot(state=st, drag="B", bstate=3); o.give_focus("A")
        hit("SL4 right down inside, the state %d, B is dragged: nobody goes back, A.change(DOWN)" % st, 0x204)
    fresh_slot(snd_down=False); o.give_focus("A")
    hit("SL4 right down inside, no mouse-down sound: the call is made with none", 0x204)

    # ---- the right button up
    fresh_slot(); o.give_focus("A")
    hit("SL5 right up inside, A has the focus: the custom message 13, A.change(MOUSEOVER), the mouse-up sound, taken", 0x205)
    fresh_slot(right_up=-1); o.give_focus("A")
    hit("SL5 right up inside with no custom message (-1): nothing is sent, A.change(MOUSEOVER), the sound", 0x205)
    fresh_slot(right_up=0); o.give_focus("A")
    hit("SL5 right up inside with the custom message 0: it is sent", 0x205)
    fresh_slot(right_up=-2); o.give_focus("A")
    hit("SL5 right up inside with the custom message -2: it is sent", 0x205)
    fresh_slot()
    hit("SL5 right up inside, A does not have the focus: taken, nothing happens (no request either)", 0x205)
    fresh_slot(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    hit("SL5 right up inside, m_bHasFocus set while the global focus is Y: the flag counts", 0x205)
    fresh_slot(); o.give_focus("A")
    hit("SL5 right up outside, A has the focus: taken, nothing happens", 0x205, OUT)
    fresh_slot(); o.give_focus("A"); o.gone("D")
    hit("SL5 right up inside, D is gone: no message to the stage, the state and the sound", 0x205)
    fresh_slot(snd_up=False); o.give_focus("A")
    hit("SL5 right up inside, no mouse-up sound: the call is made with none", 0x205)
    fresh_slot(state=3, drag="A"); o.give_focus("A")
    hit("SL5 right up inside, ONDRAG, A is dragged: nobody goes back, A.change(MOUSEOVER)", 0x205)

    # ================================================================ CKTDGUISlot::OnFocusOut (329523D0)
    def out(case, **kw):
        o.act_out(case, "A")

    fresh_slot(); o.give_focus("A")
    out("SL6 focus out of a normal slot: the flag is cleared, the state is NORMAL, ChangeState(NORMAL) finds nothing to change (it is asked all the same)")
    fresh_slot(state=1); o.give_focus("A")
    out("SL6 focus out in the state DOWN: the state is NORMAL")
    fresh_slot(state=2); o.give_focus("A")
    out("SL6 focus out in the state MOUSEOVER: the state is NORMAL")
    fresh_slot(state=4); o.give_focus("A")
    out("SL6 focus out in the state DISABLE of an enabled slot: the state is NORMAL")
    fresh_slot(state=5); o.give_focus("A")
    out("SL6 focus out in the state END: the state is NORMAL")
    fresh_slot(state=3, drag="A"); o.give_focus("A")
    out("SL6 focus out while A is dragged (ONDRAG, s_pDragSlot is A): A.change(NORMAL, true), nobody is dragged, the state NORMAL, A.change(NORMAL, false)")
    fresh_slot(state=3, drag="B", bstate=3); o.give_focus("A")
    out("SL6 focus out in the state ONDRAG while B is the dragged slot: B goes back (forced), nobody is dragged, A is NORMAL")
    fresh_slot(state=3); o.give_focus("A")
    out("SL6 focus out in the state ONDRAG with nobody dragged: only the state")
    fresh_slot(state=1, drag="B", bstate=3); o.give_focus("A")
    out("SL6 focus out in the state DOWN while B is dragged: B stays dragged")
    fresh_slot(state=0, drag="A"); o.give_focus("A")
    out("SL6 focus out in the state NORMAL while A is s_pDragSlot: it stays")
    fresh_slot(enable=False); o.give_focus("A")
    out("SL6 focus out of a disabled slot (state NORMAL): the state is DISABLE")
    fresh_slot(enable=False, state=3, drag="A"); o.give_focus("A")
    out("SL6 focus out of a disabled slot that is dragged: it goes back, the state is DISABLE")
    fresh_slot(enable=False, state=1); o.give_focus("A")
    out("SL6 focus out of a disabled slot in the state DOWN: the state is DISABLE")
    fresh_slot(show=False); o.give_focus("A")
    out("SL6 focus out of a hidden slot: the state is NORMAL")
    fresh_slot(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    out("SL6 focus out with m_bHasFocus set while the global focus is Y: the flag is cleared, the global focus stays Y")

    # ================================================================ GetGuideDescPos (32951F20) and the control's (329247A0, 329247E0)
    def guide(case, **kw):
        fresh_slot(**kw)
        return o.act_guide(case, "A", "pos")

    ROOM = quad(10.0, 20.0, 50.0, 60.0)
    guide("SG1 no absolute position, a mouse-over point (10,20)-(50,60): the middle of its top edge (30,20), no offset", over=ROOM)
    guide("SG1 the same with the offset (3,4): (33,24)", over=ROOM, offset=(3.0, 4.0))
    guide("SG1 the same with the offset (-3.5,-24.25)", over=ROOM, offset=(-3.5, -24.25))
    guide("SG1 absolute (5,0): y is 0, so the mouse-over point is used", over=ROOM, guide=(5.0, 0.0), offset=(3.0, 4.0))
    guide("SG1 absolute (0,7): x is 0, so the mouse-over point is used", over=ROOM, guide=(0.0, 7.0), offset=(3.0, 4.0))
    guide("SG1 absolute (5,7) and a mouse-over point: the absolute position is used", over=ROOM, guide=(5.0, 7.0), offset=(3.0, 4.0))
    guide("SG1 absolute (-5,-7): used", over=ROOM, guide=(-5.0, -7.0), offset=(3.0, 4.0))
    guide("SG1 absolute (0,0) and no mouse-over point: (0,0) plus the offset", guide=(0.0, 0.0), offset=(3.0, 4.0))
    guide("SG1 absolute (5,0) and no mouse-over point: the absolute position (5,0) plus the offset", guide=(5.0, 0.0), offset=(3.0, 4.0))
    guide("SG1 absolute (0,7) and no mouse-over point: (0,7) plus the offset", guide=(0.0, 7.0), offset=(3.0, 4.0))
    guide("SG1 absolute (5,7), no mouse-over point", guide=(5.0, 7.0), offset=(3.0, 4.0))
    guide("SG1 absolute (-0.0,7): a negative zero is 0", over=ROOM, guide=(-0.0, 7.0), offset=(1.0, 2.0))
    guide("SG1 absolute (5,-0.0): a negative zero is 0", over=ROOM, guide=(5.0, -0.0), offset=(1.0, 2.0))
    nan = float("nan")
    guide("SG1 absolute (NaN,0): NaN is not 0 but y is: the mouse-over point is used", over=ROOM, guide=(nan, 0.0), offset=(1.0, 2.0))
    guide("SG1 absolute (NaN,7): neither is 0: NaN plus the offset", over=ROOM, guide=(nan, 7.0), offset=(1.0, 2.0))
    guide("SG1 absolute (0,NaN): x is 0: the mouse-over point is used", over=ROOM, guide=(0.0, nan), offset=(1.0, 2.0))
    guide("SG1 a mouse-over point with the corners (0.1,0.2)-(7.3,9.7) and the offset (0.7,0.9): single precision", over=quad(0.1, 0.2, 7.3, 9.7), offset=(0.7, 0.9))
    # the corners all different: x is half the sum of the two TOP corners' x, y the LEFT-TOP corner's y
    skew = (1.0, 2.0, 9.0, 3.0, 4.0, 20.0, 12.0, 30.0)
    guide("SG1 a mouse-over point with every corner different (lt (1,2), rt (9,3), lb (4,20), rb (12,30)): x = (9 + 1) / 2, y = 2", over=skew)
    guide("SG1 the same with the offset (0.5,-0.25)", over=skew, offset=(0.5, -0.25))
    guide("SG1 the same, absolute (6,0): y is 0, so the point is used", over=skew, guide=(6.0, 0.0), offset=(0.5, -0.25))
    guide("SG1 the same, absolute (6,8): the absolute position is used", over=skew, guide=(6.0, 8.0), offset=(0.5, -0.25))
    guide("SG1 an offset only: absolute (7,9)", guide=(7.0, 9.0), offset=(0.3, 0.6))
    # a sum single precision cannot hold: 16777216 + 1 is rounded to 16777216, the half is 8388608, the offset 0.25 is lost; kept exact the sum is 16777217,
    # the half 8388608.5 and the point 8388608.75 -> 8388609 (found with a model of the formula)
    guide("SG1 the corners 1 and 16777216 (the sum 16777217 is not a single precision number), the offset 0.25: the sum is rounded before the half", over=quad(1.0, 5.0, 16777216.0, 9.0), offset=(0.25, 0.0))
    guide("SG1 the same with the corners the other way round", over=quad(16777216.0, 5.0, 1.0, 9.0), offset=(0.25, 0.0))
    # the smallest single precision number (2^-149): halved it is not one, and the half rounds to 0 before the offset (also 2^-149) is added: 2^-149; kept
    # exact the half 2^-150 plus the offset is 1.5 * 2^-149, which rounds to 2^-148
    tiny = 2.0 ** -149
    # two corners of 3e38: the sum overflows in single precision (Infinity) and so does the half; kept exact, the half would be 3e38
    guide("SG1 the corners 3e38 and 3e38: the sum is Infinity in single precision", over=quad(3e38, 5.0, 3e38, 9.0))
    guide("SG1 the corners 3e38 and -3e38: the sum is 0", over=quad(3e38, 5.0, -3e38, 9.0))
    guide("SG1 the corners 0 and 2^-149 and the offset 2^-149 in x: the half rounds to 0 first", over=quad(0.0, 5.0, tiny, 9.0), offset=(tiny, 0.0))
    guide("SG1 the same, the offset 2^-149 in y: the y is the left-top corner's, plus the offset", over=quad(0.0, tiny, tiny, 9.0), offset=(0.0, tiny))
    # a control (the probe Y has the base's methods): the offset added to the absolute position, lane by lane
    for (ax, ay, ox, oy) in ((0.0, 0.0, 0.0, 0.0), (5.0, 7.0, 3.0, 4.0), (0.1, 0.2, 0.7, 0.9), (-5.5, 7.25, 3.5, -4.0), (1e30, -1e30, 1e-30, 1e-30)):
        fresh_slot()
        o.put_guide("Y", (ax, ay), (ox, oy))
        o.act_guide("CG1 the base's GetGuideDescPos: absolute (%s,%s) + offset (%s,%s), a lane at a time" % (ax, ay, ox, oy), "Y", "pos")
    for (ax, ay) in ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1e-30, 0.0), (0.0, -1e-30), (-0.0, 0.0), (0.0, -0.0), (nan, 0.0), (0.0, nan), (3.0, 4.0)):
        fresh_slot()
        o.put_guide("Y", (ax, ay), (9.0, 9.0))
        o.act_guide("CG2 GetIsGuideDescAbsolutePos: absolute (%s,%s)" % (ax, ay), "Y", "isAbsolute")

    if "--json" in sys.argv:
        import json
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w") as fh:
            json.dump(o.script, fh, indent=0, separators=(",", ":"))
            fh.write("\n")


if __name__ == "__main__":
    main()
