#!/usr/bin/env python3
"""
The input of a dialog in x2.exe on the Unicorn CPU emulator: the oracle of `CKTDGUIDialog.msgProc` / `handleMouse`
(packages/ui/src/dialog.ts, tested by packages/ui/test/input.test.ts).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-input.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-input.py --json FILE    (and writes the script and the exe's answers to FILE)

Every step of a case (the objects it builds, the fields it sets, the focus, the answers the stubs give, the mouse, the message it sends)
is also recorded; `--json` writes the whole script with the exe's answers, which packages/ui/test/input.test.ts replays on the TypeScript
port (packages/ui/test/input-cases.json is that file).

The exe's functions run as they are -- CKTDGUIDialog::MsgProc 32958350 and HandleMouse 32957AA0, with what they call (GetControlAtPointAbsolute,
GetControlAtPointForStatic, OnMouseMove, RequestFocus 3295B490, SetShow 3295B900, SetPos 3295B8D0, SendInternelEvent 3295B610, the base
ContainsPoint / GetEnable / GetShow / CanHaveFocus of CKTDGUIControl, GetHideDialog 328DEF40, CKTDGUIIMEEditBox::StaticMsgProc 3293AF10) -- on a dialog,
controls, a stage and a dialog manager built by hand in the emulated memory.  The controls are `CKTDGUIControl`s whose vtable is a copy of the base
class's with the five input slots (MsgProc 6, HandleKeyboard 7, HandleMouse 8, OnFocusIn 9, OnFocusOut 10) replaced by stubs that write down
the call and answer what the case says; the stage's MsgProc (vtable slot 3) writes down the messages the dialog sends.  What is replaced:
  * what needs the heap, the CRT or the window system: `operator==(CKTDGUIDialogHandle, const CKTDGUIDialog*)` 329637A0 (the table of
    `KJohnObjMan` is not built: the handle's index names the dialog), `CKTDIDevice::GetXPos / GetYPos` (the mouse), `_clock` of the CRT,
    `CKTDXApp::CheckStage` 328C0FD0 (answers yes), the `std::wstring` constructor 328971E0 and `std::map::find` 328EFE70 (the control map of the
    dialog: a lookup by name), `CKTDGUISlot::ReturnDraggingItem` 329534A0, `CKTDGUIDialogManager::CountModalDialog` 328DE4C0 and
    `CKTDGUIIMEEditBox::ResetCompositionString` 3293AA60 (each writes down that it was called).
The layout is the exe's: dialog +0x2C position, +0x44 / +0x60 animate / change time, +0x48 goal, +0x64 stage, +0x68 modal, +0x69 enable, +0x6A show,
+0x6C close on focus out, +0x70 close event, +0x76 move by drag, +0x77 mouse down for drag, +0x84 control list, +0x90 control map, +0xE0 / +0xE4 previous
mouse point, +0x104 guide dialog, +0x10D mouse over, +0x110 .. +0x130 the custom messages, +0x144 manager, +0x150 disable under window, +0x151 over
control, +0x158 / +0x15C self delete; control +0x28 / +0x40 the previous / next tab control name (a `std::wstring`); the application +4 window,
+0x1A8 input (+0x38 the mouse), +0x1AC the game's manager (+0x32C the dialog manager: +0x28 shown, +0x7C can hide).
"""
import importlib.util, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from peemu import *

_spec = importlib.util.spec_from_file_location("oracle_mouse", os.path.join(HERE, "oracle-mouse.py"))
om = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(om)

APP_HWND = 0x00C0FFEE
EAX, ECX = UC_X86_REG_EAX, UC_X86_REG_ECX
UCT_COMBOBOX, UCT_IME_EDITBOX, UCT_BUTTON = 8, 4, 1
# the input slots of CKTDGUIControl's vtable and their arguments (stack dwords)
SLOTS = {6: ("msg", 4), 7: ("key", 3), 8: ("mouse", 5), 9: ("in", 0), 10: ("out", 0)}


def s32(v):
    return struct.unpack("<i", struct.pack("<I", v & 0xFFFFFFFF))[0]


# the fields of CKTDGUIDialog and CKTDGUIControl the cases set, by their names in the exe: (offset, struct format)
DIALOG_FIELDS = {
    "m_bModal": (0x68, "B"), "m_bEnable": (0x69, "B"), "m_bShow": (0x6A, "B"), "m_bCloseOnFocusOut": (0x6C, "B"),
    "m_CloseCustomUIEventID": (0x70, "i"), "m_bEnableMoveByDrag": (0x76, "B"), "m_bMouseDownForDrag": (0x77, "B"),
    "m_PrevMousePointX": (0xE0, "i"), "m_PrevMousePointY": (0xE4, "i"), "m_bIsMouseOver": (0x10D, "B"),
    "m_CustomMsgMouseOut": (0x110, "i"), "m_CustomMsgMouseOver": (0x114, "i"), "m_CustomMsgStopDragging": (0x118, "i"),
    "m_CustomMsgStartDragging": (0x11C, "i"), "m_CustomMsgFocusOutEventID": (0x120, "i"), "m_CustomMsgRMouseUp": (0x130, "i"),
    "m_bDisableUnderWindow": (0x150, "B"), "m_bIsOverControl": (0x151, "B"), "m_fTimeForSelfDelete": (0x15C, "f"),
    "m_fChangeTime": (0x60, "f"), "m_fAnimateTime": (0x44, "f"), "timerStart": (0x158, "i"),
}
CONTROL_FIELDS = {"m_bMouseOver": (0xB1, "B"), "m_bEnable": (0xB2, "B"), "m_bShow": (0xB3, "B"), "m_bOutofList": (0xB5, "B")}
TYPES = {"button": UCT_BUTTON, "combobox": UCT_COMBOBOX, "ime": UCT_IME_EDITBOX}
STD_RECTS = {"A": (0, 0, 40, 40), "B": (60, 0, 100, 40), "C": (0, 60, 40, 100)}


class InputOracle(om.MouseOracle):
    FOCUS = 0x336434AC
    DRAG = 0x336434A8
    CLOCK_IAT = 0x3348FA80
    ENABLE_IME = 0x33641762
    HIDE_CARET = 0x3364177F

    def __init__(self):
        super().__init__()
        emu = self.emu
        self.events = []
        self.script = []  # the recorded steps
        self.addr = {}  # label -> address
        self.mouse = [0, 0]
        self.clock = 0
        self.answers = {}  # (control address, "mouse" | "key" | "msg") -> the answer of its stub
        self.effects = {}  # (control address, "mouse") -> a function the stub runs (a control that hides its dialog)
        self.owner = {}  # control address -> its dialog's address
        self.maps = {}  # control map address -> {name: node}
        # the stage: a vtable whose slot 3 is MsgProc(hWnd, uMsg, wParam, lParam)
        self.stage = emu.alloc(0x40)
        vt = emu.alloc(0x40)
        emu.w32(self.stage, vt)
        emu.w32(vt + 0xC, self.hooked(self._stage_msg, b"\xC2\x10\x00"))
        self.controls[self.stage] = "stage"
        # what the exe's functions need and the emulator does not have
        self.replace(0x329637A0, self._opeq)
        self.replace(0x32962E60, lambda e: e.set_reg(EAX, self.mouse[0] & 0xFFFFFFFF))
        self.replace(0x32962EB0, lambda e: e.set_reg(EAX, self.mouse[1] & 0xFFFFFFFF))
        self.replace(0x329534A0, lambda e: self.log("returnDrag"))
        self.replace(0x328DE4C0, self._count_modal, b"\xC2\x04\x00")
        self.replace(0x328C0FD0, lambda e: e.set_reg(EAX, 1), b"\xC2\x04\x00")
        self.replace(0x328EFE70, self._find, b"\xC2\x08\x00")
        self.replace(0x328971E0, self._wstring, b"\xC2\x04\x00")
        self.replace(0x3293AA60, lambda e: self.log("resetComp"))
        emu.hook(emu.stub(self.CLOCK_IAT, b"\xC3"), lambda e: e.set_reg(EAX, self.clock & 0xFFFFFFFF))
        # the input slots of every probe control: one stub each (the call knows its control from ECX)
        self.slot_stubs = {
            slot: self.hooked(self._slot(kind, argc), (b"\xC2" + struct.pack("<H", 4 * argc)) if argc else b"\xC3")
            for slot, (kind, argc) in SLOTS.items()
        }

    # ---- plumbing
    def hooked(self, fn, ret=b"\xC3"):
        stub = self.emu.stub(None, ret)
        self.emu.hook(stub, fn)
        return stub

    def replace(self, addr, fn, ret=b"\xC3"):
        stub = self.hooked(fn, ret)
        self.emu.write(addr, b"\xE9" + struct.pack("<i", stub - (addr + 5)))

    def log(self, text):
        self.events.append(text)

    def name(self, v):
        v &= 0xFFFFFFFF
        return self.controls.get(v, str(s32(v)))

    def op(self, *a):
        self.script.append(list(a))

    def set_scale(self, sx, sy):
        emu = self.emu
        if not hasattr(self, "mgr"):
            self.mgr = emu.alloc(0x400)  # the dialog manager: the dialogs' +0x144
            self.dg = emu.alloc(0x400)
            emu.w32(self.dg + 0x32C, self.mgr)
            self.di = emu.alloc(0x400)
            emu.w32(self.di + 0x38, emu.alloc(0x100))
            self.controls[self.mgr] = "manager"
        super().set_scale(sx, sy)
        app = emu.u32(om.APP_PTR)
        emu.w32(app + 4, APP_HWND)
        emu.w32(app + 0x1A8, self.di)
        emu.w32(app + 0x1AC, self.dg)

    def _stage_msg(self, emu):
        hwnd, msg, wparam, lparam = emu.args(4)
        assert hwnd == APP_HWND, hex(hwnd)
        self.log("stage(%d,%d,%s)" % (msg, s32(wparam), self.name(lparam)))

    def _opeq(self, emu):
        idx, magic, ptr = emu.args(3)
        idx = s32(idx)
        same = (ptr == 0) if (idx < 0 or magic == 0) else (self.dialogs.get(idx, 0) == ptr)
        emu.set_reg(EAX, 1 if same else 0)

    def _count_modal(self, emu):
        (arg,) = emu.args(1)
        self.log("modalCount(%s)" % self.name(arg))

    def _wstring(self, emu):
        this = emu.reg(ECX)
        (p,) = emu.args(1)
        chars = b""
        while emu.read(p + len(chars), 2) != b"\0\0":
            chars += emu.read(p + len(chars), 2)
        assert len(chars) <= 14, "a name of up to 7 characters"
        emu.write(this, chars.ljust(16, b"\0"))
        emu.write(this + 0x10, struct.pack("<II", len(chars) // 2, 7))
        emu.set_reg(EAX, this)

    def read_wstring(self, a):
        size, res = struct.unpack("<II", self.emu.read(a + 0x10, 8))
        p = self.emu.u32(a) if res > 7 else a
        return self.emu.read(p, 2 * size).decode("utf-16-le")

    def _find(self, emu):
        this = emu.reg(ECX)
        out, key = emu.args(2)
        node = self.maps.get(this, {}).get(self.read_wstring(key))
        emu.w32(out, node if node else emu.u32(this))  # the head is end()
        emu.set_reg(EAX, out)

    def write_wstring(self, a, text):
        data = text.encode("utf-16-le")
        assert len(data) <= 14
        self.emu.write(a, data.ljust(16, b"\0"))
        self.emu.write(a + 0x10, struct.pack("<II", len(data) // 2, 7))

    def _slot(self, kind, argc):
        def run(emu):
            this = emu.reg(ECX)
            args = emu.args(argc) if argc else ()
            tag = "%s.%s" % (self.name(this), kind)
            if args:
                tag += "(" + ",".join(str(s32(a)) for a in args) + ")"
            self.log(tag)
            effect = self.effects.get((this, kind))
            if effect:
                effect()
            emu.set_reg(EAX, self.answers.get((this, kind), 0))
        return run

    # ---- the steps of a case (each one is recorded)
    def reset(self):
        """a new scene: no focus, no dragged slot, no answers, the scale 1, the dialogs shown, the IME system off"""
        self.emu.w32(self.FOCUS, 0)
        self.emu.w32(self.DRAG, 0)
        self.answers.clear()
        self.effects.clear()
        self.set_scale(1.0, 1.0)
        self.poke(self.mgr + 0x7C, "<B", 0)
        self.poke(self.ENABLE_IME, "<B", 0)
        self.poke(self.HIDE_CARET, "<B", 0)
        self.mouse = [0, 0]
        self.clock = 0
        self.op("reset")

    def scale(self, sx, sy):
        self.set_scale(sx, sy)
        self.op("scale", sx, sy)

    def dialog_(self, label, index=1, pos=(10.0, 20.0), modal=False, enable=True, show=True, stage=True, manager=True, guide=False):
        """a dialog (`index` is its handle); `guide`: it has a guide dialog (modal, enabled, shown)"""
        emu = self.emu
        d = self.dialog(index, pos)
        self.controls[d] = label
        self.addr[label] = d
        emu.write(d + 0x68, bytes([1 if modal else 0, 1 if enable else 0, 1 if show else 0]))
        emu.w32(d + 0x64, self.stage if stage else 0)
        emu.w32(d + 0x144, self.mgr if manager else 0)
        emu.write(d + 0x110, struct.pack("<7i", -1, -1, -1, -1, -1, 0, 0))  # out, over, stop, start, focus out (+0x120)
        emu.write(d + 0x130, struct.pack("<i", -1))  # right mouse up
        emu.w32(d + 0x70, 0xFFFFFFFF)
        head = emu.alloc(0x40)
        emu.w32(d + 0x90, head)
        self.maps[d + 0x90] = {}
        if guide:
            g = self.dialog(index + 100, (0.0, 0.0))
            self.controls[g] = label + ".guide"
            self.addr[label + ".guide"] = g
            emu.write(g + 0x68, bytes([1, 1, 1]))
            emu.w32(d + 0x104, g)
        self.op("dialog", label, index, {"pos": list(pos), "modal": modal, "enable": enable, "show": show, "stage": stage, "manager": manager, "guide": guide})
        return d

    def control_(self, label, dialog, index=1, rect=None, type="button", offset=(0.0, 0.0), show=True, enable=True, out_of_list=False, tab="", prev=""):
        """a control (its input slots are stubs) of the dialog `dialog` (a label); it is put in the dialog's list by `register`"""
        emu = self.emu
        rect = rect or STD_RECTS[label]
        l, t, r, b = rect
        c = self.control("Control", label, corners=om.rect(l, t, r, b), dialog=index, offset=offset, show=show, enable=enable, out_of_list=out_of_list)
        emu.w32(c + 0xC, TYPES[type])
        vt = emu.alloc(4 * 64)
        emu.write(vt, emu.read(emu.u32(c), 4 * 64))
        for slot, stub in self.slot_stubs.items():
            emu.w32(vt + 4 * slot, stub)
        emu.w32(c, vt)
        self.write_wstring(c + 0x40, tab)
        self.write_wstring(c + 0x28, prev)
        self.addr[label] = c
        self.owner[c] = self.addr[dialog]
        self.op("control", label, dialog, {"rect": list(rect), "type": type, "offset": list(offset), "show": show, "enable": enable, "outOfList": out_of_list, "tab": tab, "prev": prev})
        return c

    def register(self, dialog, labels):
        """the dialog's list of controls (the drawing order) and its name map: each control's name is its label"""
        d = self.addr[dialog]
        self.fill(d, [self.addr[n] for n in labels])
        self.maps[d + 0x90] = {}
        for n in labels:
            node = self.emu.alloc(0x40)
            self.emu.w32(node + 0x28, self.addr[n])
            self.maps[d + 0x90][n] = node
        self.op("register", dialog, list(labels))

    def poke(self, a, fmt, *v):
        self.emu.write(a, struct.pack(fmt, *v))

    def set(self, label, field, value):
        """a field of a dialog or a control; `tab` / `prev` (the names of the next and the previous control) are the control's strings"""
        a = self.addr[label]
        if field in ("tab", "prev"):
            self.write_wstring(a + (0x40 if field == "tab" else 0x28), value)
        elif field == "rect":
            l, t, r, b = value
            self.emu.write(a + 0xBC, struct.pack("<8f", l, t, r, t, l, b, r, b))
        elif field == "offset":
            self.emu.write(a + 0x58, struct.pack("<2f", *value))
        else:
            off, fmt = (CONTROL_FIELDS if a in self.owner else DIALOG_FIELDS)[field]
            self.poke(a + off, "<" + fmt, *(value if isinstance(value, (list, tuple)) else (value,)))
        self.op("set", label, field, value)

    def focus(self, label):
        self.emu.w32(self.FOCUS, self.addr[label] if label else 0)
        self.op("focus", label)

    def answer(self, label, kind, value, effect=None):
        """what the stub of a control's `mouse` / `key` / `msg` slot answers; `effect` "hide": it also hides its dialog (m_bShow = 0)"""
        c = self.addr[label]
        self.answers[(c, kind)] = value
        if effect == "hide":
            d = self.owner[c]
            self.effects[(c, kind)] = lambda: self.poke(d + 0x6A, "<B", 0)
        self.op("answer", label, kind, value, effect)

    def mouse_at(self, x, y):
        self.mouse = [x, y]
        self.op("mouse", x, y)

    def now(self, ms):
        self.clock = ms
        self.op("clock", ms)

    def hide_dialogs(self, hide):
        """the application's dialog manager hides every dialog (`GetHideDialog`: can hide and not shown)"""
        self.poke(self.mgr + 0x7C, "<B", 1 if hide else 0)
        self.poke(self.mgr + 0x28, "<B", 0)
        self.op("hideDialogs", hide)

    def ime(self, enabled):
        self.poke(self.ENABLE_IME, "<B", 1 if enabled else 0)
        self.op("ime", enabled)

    def slot(self, dialog):
        """a slot that is being dragged (`s_pDragSlot`) and belongs to `dialog`"""
        slot = self.emu.alloc(0x40)
        d = self.addr[dialog]
        index = [i for i, a in self.dialogs.items() if a == d][0]
        self.emu.write(slot + 4, struct.pack("<ii", index, 1))
        self.controls[slot] = "slot"
        self.emu.w32(self.DRAG, slot)
        self.op("slot", dialog)

    # ---- the state
    def b(self, a):
        return self.emu.read(a, 1)[0]

    def f(self, a):
        return struct.unpack("<f", self.emu.read(a, 4))[0]

    def i(self, a):
        return struct.unpack("<i", self.emu.read(a, 4))[0]

    def get_focus(self):
        a = self.emu.u32(self.FOCUS)
        return self.name(a) if a else "none"

    def state(self, d, flags=()):
        s = "over=%d mouseOver=%d down=%d show=%d enable=%d pos=(%g,%g) goal=(%g,%g) prev=(%d,%d) focus=%s" % (
            self.b(d + 0x151), self.b(d + 0x10D), self.b(d + 0x77), self.b(d + 0x6A), self.b(d + 0x69), self.f(d + 0x2C), self.f(d + 0x30),
            self.f(d + 0x48), self.f(d + 0x4C), self.i(d + 0xE0), self.i(d + 0xE4), self.get_focus())
        g = self.emu.u32(d + 0x104)
        if g:
            s += " guide.show=%d" % self.b(g + 0x6A)
        if flags:
            s += " mouseOverFlags=" + "".join(str(self.b(self.addr[c] + 0xB1)) for c in flags)
        return s

    def act(self, case, dialog, kind, args, flags=()):
        """send the message to `dialog`: kind "msg" (uMsg, wParam, lParam) is `CKTDGUIDialog::MsgProc`, "mouse" (uMsg, x, y, wParam, lParam) is `HandleMouse`"""
        d = self.addr[dialog]
        self.events = []
        if kind == "msg":
            uMsg, wParam, lParam = (list(args) + [0, 0])[:3]
            ret = self.thiscall(0x32958350, d, [APP_HWND, uMsg, wParam, lParam])
            args = [uMsg, wParam, lParam]
        else:
            uMsg, x, y, wParam, lParam = (list(args) + [0, 0])[:5]
            ret = self.thiscall(0x32957AA0, d, [uMsg, x, y, wParam, lParam])
            args = [uMsg, x, y, wParam, lParam]
        ret &= 0xFF
        events = list(self.events)
        state = self.state(d, flags)
        extra = ""
        if case.startswith("I1"):
            extra = " hideCaret=%d" % self.b(self.HIDE_CARET)
        line = "%-100s -> %d | %s | %s%s" % (case, ret, ",".join(events), state, extra)
        print(line)
        self.op("act", case, dialog, kind, args, list(flags), {"ret": ret, "events": events, "state": state + extra})
        return ret


def main():
    o = InputOracle()

    def fresh(**kw):
        """the dialog D (at (10, 20), the stage, the manager) with the controls A (0,0)-(40,40), B (60,0)-(100,40), C (0,60)-(40,100): A's next
        control is B and its previous C, B's C and A, C's A and B; the focus on nothing"""
        o.reset()
        o.dialog_("D", **kw)
        o.control_("A", "D", tab="B", prev="C")
        o.control_("B", "D", tab="C", prev="A")
        o.control_("C", "D", tab="A", prev="B")
        o.register("D", ["A", "B", "C"])

    def other_dialog():
        """a second dialog E with a control X"""
        o.dialog_("E", index=2)
        o.control_("X", "E", index=2, rect=(0, 0, 40, 40))
        o.register("E", ["X"])

    ABC = ["A", "B", "C"]

    def msg(case, uMsg, wParam=0, lParam=0, flags=()):
        return o.act(case, "D", "msg", [uMsg, wParam, lParam], flags)

    def hm(case, uMsg, x, y, wParam=0, lParam=0, flags=ABC):
        return o.act(case, "D", "mouse", [uMsg, x, y, wParam, lParam], flags)

    # ================================================================ the window messages that are not the mouse
    # ---- a dialog that is disabled, hidden or whose time is up takes nothing
    fresh(enable=False); o.focus("A"); o.answer("A", "key", 1)
    msg("K1 disabled dialog, focus A answers 1: key down 65", 0x100, 65, 1)
    fresh(show=False); o.focus("A"); o.answer("A", "key", 1)
    msg("K2 hidden dialog: key down 65", 0x100, 65, 1)
    for now, tag in ((3000, "elapsed 2000 ms"), (3001, "elapsed 2001 ms")):
        fresh(); o.focus("A"); o.answer("A", "key", 1)
        o.set("D", "timerStart", 1000); o.set("D", "m_fTimeForSelfDelete", 2.0); o.now(now)
        msg("K3 self delete after 2 s, %s: key down 65" % tag, 0x100, 65, 1)
    fresh(); o.focus("A"); o.answer("A", "key", 1)
    o.set("D", "timerStart", 2147483000); o.set("D", "m_fTimeForSelfDelete", 2.0); o.now(2147483000 + 5000)  # the clock passed 2^31: the difference is 5000
    msg("K3 self delete after 2 s, the difference 5000 ms across the sign bit: key down 65", 0x100, 65, 1)
    fresh(); o.focus("A"); o.answer("A", "key", 1)
    o.set("D", "timerStart", 1000); o.set("D", "m_fTimeForSelfDelete", 0.0); o.now(99999999)
    msg("K3 no self delete time (0): key down 65", 0x100, 65, 1)

    # ---- the keyboard
    for ans in (1, 0):
        fresh(); o.focus("A"); o.answer("A", "key", ans)
        msg("K4 key down 65, focus A (in D, enabled, shown) answers %d" % ans, 0x100, 65, 0x1E0001)
    for m in (0x101, 0x104, 0x105):
        fresh(); o.focus("A"); o.answer("A", "key", 1)
        msg("K4 message 0x%X, wParam 65 -> HandleKeyboard" % m, m, 65, 7)
    fresh()
    msg("K5 no focus: key down", 0x100, 65, 1)
    msg("K5 no focus: key up Tab", 0x101, 9, 1)
    fresh(); other_dialog(); o.focus("X"); o.answer("X", "key", 1)
    msg("K5 the focus is in another dialog: key down", 0x100, 65, 1)
    fresh(); o.control_("D2", "D", rect=(0, 0, 40, 40), enable=False); o.register("D", ABC + ["D2"]); o.focus("D2"); o.answer("D2", "key", 1)
    msg("K5 the focus is disabled: key down", 0x100, 65, 1)
    fresh(); o.control_("H", "D", rect=(0, 0, 40, 40), show=False); o.register("D", ABC + ["H"]); o.focus("H"); o.answer("H", "key", 1)
    msg("K5 the focus is hidden: key down", 0x100, 65, 1)
    # tabbing: only a key UP of Tab / Right / Down (the next control) and Left / Up (the previous one)
    for key, tag in ((9, "Tab"), (0x27, "Right"), (0x28, "Down"), (0x25, "Left"), (0x26, "Up")):
        fresh(); o.focus("A"); o.answer("A", "key", 1)
        msg("K6 key up %s, focus A (tab B, previous C)" % tag, 0x101, key, 0x123)
    fresh(); o.focus("A"); o.answer("A", "key", 1)
    msg("K6 key DOWN Tab: no tabbing, the key goes to A", 0x100, 9, 1)
    fresh(); o.focus("A"); o.answer("A", "key", 0); o.set("A", "tab", "Z")
    msg("K6 key up Tab, no control named Z: the key goes to A (answer 0)", 0x101, 9, 1)
    fresh(); o.focus("A"); o.answer("A", "key", 1); o.set("A", "tab", "")
    msg("K6 key up Tab, the name is empty: the key goes to A (answer 1)", 0x101, 9, 1)
    fresh(); o.focus("A"); o.answer("A", "key", 0); o.set("A", "tab", "A")
    msg("K6 key up Tab, the name is the focus itself: RequestFocus does nothing, the answer is yes", 0x101, 9, 1)
    fresh(); o.focus("A"); o.answer("A", "key", 0); o.set("B", "m_bEnable", 0)
    msg("K6 key up Tab, B cannot take the focus: yes, nothing moves", 0x101, 9, 1)
    fresh(); o.focus("A"); o.answer("A", "key", 0)
    msg("K6 key up 65 (not a tab key): the key goes to A", 0x101, 65, 1)
    fresh(); o.focus("A"); o.answer("A", "key", 1)
    msg("K6 key up Enter 13", 0x101, 13, 1)
    fresh(); o.focus("A"); o.answer("A", "key", 1)
    msg("K6 SYSKEYUP (0x105) Tab: no tabbing, the key goes to A", 0x105, 9, 1)

    # ---- every other message goes to the MsgProc of the focused control
    for m in (0x0F, 0xFF, 0x102, 0x103, 0x106, 0x10D, 0x286, 0x20E, 0x2A3, 0x8000):
        fresh(); o.focus("A"); o.answer("A", "msg", 1)
        msg("M0 message 0x%X goes to A.MsgProc (answers 1)" % m, m, 5, 6)
    fresh(); o.focus("A"); o.answer("A", "msg", 0)
    msg("M0 message 0x102 goes to A.MsgProc (answers 0)", 0x102, 5, 6)
    fresh()
    msg("M0 message 0x102, no focus", 0x102, 5, 6)
    fresh(); o.control_("D2", "D", rect=(0, 0, 40, 40), enable=False); o.register("D", ABC + ["D2"]); o.focus("D2"); o.answer("D2", "msg", 1)
    msg("M0 message 0x102, the focus is disabled", 0x102, 5, 6)
    fresh(); o.control_("H", "D", rect=(0, 0, 40, 40), show=False); o.register("D", ABC + ["H"]); o.focus("H"); o.answer("H", "msg", 1)
    msg("M0 message 0x102, the focus is hidden", 0x102, 5, 6)
    fresh(); other_dialog(); o.focus("X"); o.answer("X", "msg", 1)
    msg("M0 message 0x102, the focus is in another dialog", 0x102, 5, 6)

    # ---- the IME's static message proc
    for enabled, m, tag in ((0, 0x10D, "IME system off"), (1, 0x10D, "IME system on"), (1, 0x102, "IME system on, WM_CHAR"), (1, 0x10E, "IME system on, 0x10E")):
        fresh(); o.focus("A"); o.answer("A", "msg", 1); o.ime(bool(enabled))
        msg("I1 %s: message 0x%X" % (tag, m), m, 5, 6)

    # ================================================================ the mouse (the dialog is at (10, 20), the scale is 1)
    fresh(); o.hide_dialogs(True); o.set("D", "m_bIsOverControl", 1); o.mouse_at(30, 40); o.answer("A", "mouse", 1)
    msg("N1 the dialogs are hidden (GetHideDialog): the message is taken, nothing else happens", 0x200, flags=ABC)
    fresh(); o.set("D", "m_bIsOverControl", 1); o.mouse_at(500, 500)
    msg("N2 m_bIsOverControl is cleared at the start; the mouse is over nothing", 0x200, flags=ABC)

    # ---- the mouse over / out message of the dialog (the control under the point, shown or not)
    fresh(); o.set("D", "m_CustomMsgMouseOut", 6); o.set("D", "m_CustomMsgMouseOver", 5); o.mouse_at(30, 40)
    msg("O1 onto A: the over message (5), lParam 0", 0x200, flags=ABC)
    msg("O1 again over A: nothing", 0x200, flags=ABC)
    o.mouse_at(500, 500)
    msg("O1 off: the out message (6)", 0x200, flags=ABC)
    msg("O1 off again: nothing", 0x200, flags=ABC)
    fresh(); o.mouse_at(30, 40)
    msg("O2 onto A, the over message is -1: nothing is sent, the flag is set", 0x200, flags=ABC)
    o.mouse_at(500, 500)
    msg("O2 off, the out message is -1: the flag is cleared", 0x200, flags=ABC)
    fresh(); o.set("D", "m_CustomMsgMouseOut", 6); o.set("D", "m_CustomMsgMouseOver", 5)
    o.control_("H", "D", rect=(200, 200, 240, 240), show=False); o.register("D", ABC + ["H"]); o.mouse_at(220, 230)
    msg("O3 onto a HIDDEN control: it counts (GetControlAtPointAbsolute)", 0x200, flags=ABC)
    fresh(); o.set("D", "m_CustomMsgMouseOut", 6); o.set("D", "m_CustomMsgMouseOver", 5)
    o.control_("L", "D", rect=(200, 200, 240, 240), out_of_list=True, enable=False); o.register("D", ABC + ["L"]); o.mouse_at(220, 230)
    msg("O3 onto a disabled, out-of-list control: it counts", 0x200, flags=ABC)
    fresh(); o.set("D", "m_CustomMsgMouseOut", 6); o.set("D", "m_CustomMsgMouseOver", 5); o.mouse_at(30, 40)
    msg("O4 right button down 0x204: the over / out logic runs for every mouse message", 0x204, flags=ABC)

    # ---- the drag of the dialog
    for down in (0, 1):
        fresh(); o.set("D", "m_bEnableMoveByDrag", 1); o.set("D", "m_bMouseDownForDrag", down)
        o.set("D", "m_PrevMousePointX", 5); o.set("D", "m_PrevMousePointY", 7); o.mouse_at(40, 55)  # (30, 35) in D: over A (the control for static)
        msg("D1 move by drag, mouse button down for drag = %d: mouse move at (30, 35), previous (5, 7)" % down, 0x200, flags=ABC)
    fresh(); o.set("D", "m_bEnableMoveByDrag", 1); o.set("D", "m_bMouseDownForDrag", 1)
    o.set("D", "m_PrevMousePointX", 5); o.set("D", "m_PrevMousePointY", 7); o.mouse_at(500, 500)
    msg("D2 drag, nothing under the mouse and no focus: nothing (falls through)", 0x200, flags=ABC)
    fresh(); o.set("D", "m_bEnableMoveByDrag", 1); o.set("D", "m_bMouseDownForDrag", 1)
    o.set("D", "m_PrevMousePointX", 5); o.set("D", "m_PrevMousePointY", 7); o.mouse_at(500, 500); o.focus("A")
    msg("D3 drag, the focus is A (the mouse is over nothing): A gives the local point (490, 480)", 0x200, flags=ABC)
    fresh(); o.set("D", "m_bEnableMoveByDrag", 1); o.set("D", "m_bMouseDownForDrag", 1)
    o.set("D", "m_PrevMousePointX", 5); o.set("D", "m_PrevMousePointY", 7); o.mouse_at(500, 500)
    o.dialog_("E", index=2); o.control_("X", "E", index=2, rect=(0, 0, 40, 40), offset=(100.0, 50.0)); o.register("E", ["X"]); o.focus("X")
    msg("D3 drag, the focus is X of ANOTHER dialog, offset (100, 50): X's offset gives the local point (390, 430)", 0x200, flags=ABC)
    for m in (0x201, 0x202, 0x204):
        fresh(); o.set("D", "m_bEnableMoveByDrag", 1); o.set("D", "m_bMouseDownForDrag", 1)
        o.set("D", "m_PrevMousePointX", 5); o.set("D", "m_PrevMousePointY", 7); o.mouse_at(40, 55)
        msg("D4 drag enabled and down, message 0x%X (not a mouse move): no drag step" % m, m, flags=ABC)
    # the scale and the control's offset: D at (10.5, 20.25), scale (1.5, 2): the origin is (int)(15.75) = 15, (int)(40.5) = 40
    for down in (1, 0):
        fresh(pos=(10.5, 20.25)); o.scale(1.5, 2.0); o.set("A", "offset", [3.5, 2.25])  # A's origin: (int)(5.25) = 5, (int)(4.5) = 4
        o.set("A", "rect", [0, 0, 100, 100])
        o.set("D", "m_bEnableMoveByDrag", 1); o.set("D", "m_bMouseDownForDrag", down)
        o.set("D", "m_PrevMousePointX", 2); o.set("D", "m_PrevMousePointY", 3)
        o.mouse_at(80, 90)  # px = 80 - 15 = 65, py = 90 - 40 = 50; A: (65 - 5) / 1.5 = 40, (50 - 4) / 2 = 23
        msg("D5 scale (1.5, 2), D at (10.5, 20.25), A's offset (3.5, 2.25), previous (2, 3), mouse down for drag = %d: local (40, 23)" % down, 0x200, flags=ABC)
    for change in (2.0, 1.0):
        fresh(); o.set("D", "m_bEnableMoveByDrag", 1); o.set("D", "m_bMouseDownForDrag", 1)
        o.set("D", "m_PrevMousePointX", 5); o.set("D", "m_PrevMousePointY", 7)
        o.set("D", "m_fChangeTime", change); o.set("D", "m_fAnimateTime", 1.0); o.mouse_at(40, 55)
        msg("D6 change time %g, animate time 1: the goal %s" % (change, "follows (a dialog still moving)" if change > 1 else "stays"), 0x200, flags=ABC)
    fresh(); o.set("D", "m_bMouseDownForDrag", 1); o.set("D", "m_PrevMousePointX", 5); o.set("D", "m_PrevMousePointY", 7); o.mouse_at(40, 55)
    msg("D7 move by drag OFF (m_bMouseDownForDrag left from earlier): reset by the end of MsgProc", 0x200, flags=ABC)

    # ---- a mouse message a control takes
    fresh(); o.set("D", "m_bCloseOnFocusOut", 1); o.focus("C"); o.set("D", "m_CustomMsgFocusOutEventID", 9); o.mouse_at(30, 40); o.answer("A", "mouse", 1)
    msg("T1 left button down on A, A takes it: nothing else happens (the focus stays on C, the dialog stays)", 0x201, flags=ABC)
    fresh(); o.mouse_at(30, 40); o.answer("A", "mouse", 0)
    msg("T2 left button down on A, A answers no: the dialog does not take it either", 0x201, flags=ABC)

    # ---- a click that nothing takes
    fresh(); o.focus("C"); o.mouse_at(500, 500)
    msg("U1 left button down on nothing, the focus C is in D: C loses it", 0x201, flags=ABC)
    fresh(); other_dialog(); o.focus("X"); o.mouse_at(500, 500)
    msg("U1 left button down on nothing, the focus X is in another dialog: kept", 0x201, flags=ABC)
    fresh(); o.focus("C"); o.mouse_at(500, 500)
    msg("U1 right button down 0x204: the focus is kept", 0x204, flags=ABC)
    fresh(); o.focus("C"); o.set("D", "m_CustomMsgFocusOutEventID", 9); o.mouse_at(500, 500)
    msg("U2 the focus out message is 9: sent after the focus is cleared", 0x201, flags=ABC)
    fresh(stage=False); o.set("D", "m_CustomMsgFocusOutEventID", 9); o.mouse_at(500, 500)
    msg("U2 the focus out message is 9 but the dialog has no stage", 0x201, flags=ABC)
    fresh(); o.set("D", "m_CustomMsgFocusOutEventID", 9); o.mouse_at(500, 500)
    msg("U2 the focus out message is only for the left button down: right button up 0x205", 0x205, flags=ABC)
    fresh(); o.set("D", "m_bMouseDownForDrag", 1); o.mouse_at(500, 500)
    msg("U3 the drag flag is cleared by every message that gets this far: left button double click 0x203", 0x203, flags=ABC)

    # ---- close on focus out
    def closing(tag, m=0x201, shown=True, modal=False, guide=True, manager=True, stage=True, slot=None, hides=False):
        fresh(modal=modal, stage=stage, manager=manager, guide=guide)
        o.set("D", "m_bCloseOnFocusOut", 1); o.set("D", "m_CloseCustomUIEventID", 77)
        if slot == "this":
            o.slot("D")
        elif slot == "other":
            o.dialog_("E", index=2); o.slot("E")
        o.focus("C"); o.mouse_at(500, 500)
        if hides:  # a control that answers no but hides the dialog (the mouse point is on A)
            o.mouse_at(30, 40); o.answer("A", "mouse", 0, effect="hide")
        msg("V %s" % tag, m, flags=ABC)

    closing("close on focus out: shown, not modal, guide dialog, manager")
    closing("modal: no recount of the modal dialogs", modal=True)
    closing("no manager: no recount", manager=False)
    closing("no guide dialog", guide=False)
    closing("no stage: no message", stage=False)
    closing("a dragged slot of this dialog is given back", slot="this")
    closing("a dragged slot of ANOTHER dialog stays", slot="other")
    closing("A answers no but hides the dialog: no guide hide, no recount, but it is disabled and the message is sent", hides=True)
    closing("right button down 0x204: nothing closes", m=0x204)
    closing("left button up 0x202: nothing closes", m=0x202)

    # ---- the cases of the switch
    fresh(); o.mouse_at(30, 40)
    msg("S0 mouse move over A: OnMouseMove sets A's mouse over flag", 0x200, flags=ABC)
    fresh(); o.set("D", "m_CustomMsgStartDragging", 21); o.set("D", "m_CustomMsgStopDragging", 22); o.mouse_at(30, 40)
    msg("S1 left button down on A: a drag starts, the start message (21), lParam the dialog", 0x201, flags=ABC)
    fresh(); o.mouse_at(30, 40)
    msg("S1 left button down on A, the start message is -1: the drag starts silently", 0x201, flags=ABC)
    fresh(); o.set("D", "m_CustomMsgStartDragging", 21); o.mouse_at(500, 500)
    msg("S1 left button down on nothing: no drag", 0x201, flags=ABC)
    fresh(); o.set("D", "m_CustomMsgStartDragging", 21)
    o.control_("H", "D", rect=(200, 200, 240, 240), show=False); o.register("D", ABC + ["H"]); o.mouse_at(220, 230)
    msg("S1 left button down on a hidden control: no drag", 0x201, flags=ABC)
    fresh(); o.set("D", "m_CustomMsgStopDragging", 22); o.set("D", "m_bMouseDownForDrag", 1); o.mouse_at(30, 40)
    msg("S2 left button up: the drag ends, the stop message (22), lParam the dialog", 0x202, flags=ABC)
    fresh(); o.set("D", "m_bMouseDownForDrag", 1); o.mouse_at(30, 40)
    msg("S2 left button up, the stop message is -1", 0x202, flags=ABC)
    fresh(); o.set("D", "m_CustomMsgRMouseUp", 23); o.set("D", "m_bDisableUnderWindow", 1); o.mouse_at(30, 40)
    msg("S5 right button up over A, disable-under-window on: the message (23) is sent and the answer is NO", 0x205, flags=ABC)
    fresh(); o.set("D", "m_bDisableUnderWindow", 1); o.mouse_at(30, 40)
    msg("S5 right button up, the message is -1", 0x205, flags=ABC)
    for flag, x, y, m in ((1, 30, 40, 0x203), (1, 30, 40, 0x204), (1, 30, 40, 0x20A), (1, 30, 40, 0x20D), (1, 500, 500, 0x204), (0, 30, 40, 0x204),
                          (1, 30, 40, 0x200), (1, 30, 40, 0x201), (1, 30, 40, 0x202)):
        fresh(); o.set("D", "m_bDisableUnderWindow", flag); o.mouse_at(x, y)
        msg("S3 message 0x%X at (%d, %d), disable under window = %d" % (m, x, y, flag), m, flags=ABC)
    fresh(); o.set("D", "m_bDisableUnderWindow", 1)
    o.control_("H", "D", rect=(200, 200, 240, 240), show=False); o.register("D", ABC + ["H"]); o.mouse_at(220, 230)
    msg("S3 right button down 0x204 over a hidden control, disable under window: not over (a hidden control does not count)", 0x204, flags=ABC)
    fresh(); o.set("D", "m_bDisableUnderWindow", 1)
    o.control_("D2", "D", rect=(200, 200, 240, 240), enable=False); o.control_("L", "D", rect=(300, 300, 340, 340), out_of_list=True)
    o.register("D", ABC + ["D2", "L"]); o.mouse_at(220, 230)
    msg("S3 0x204 over a DISABLED control: over (shown is enough)", 0x204, flags=ABC)
    o.mouse_at(320, 330)
    msg("S3 0x204 over an out-of-list control: over", 0x204, flags=ABC)

    # ================================================================ CKTDGUIDialog::HandleMouse
    fresh(); o.answer("A", "mouse", 1)
    hm("H1 a point on A, A answers 1: A.HandleMouse(513, 20, 20, 5, 6), OnMouseMove first", 0x201, 20, 20, 5, 6)
    fresh()
    hm("H1 a point on A, A answers 0: no control takes it (OnMouseMove still ran)", 0x201, 20, 20)
    fresh()
    hm("H1 a point on nothing: no calls", 0x201, 500, 500)
    fresh(); o.set("B", "m_bEnable", 0); o.answer("B", "mouse", 1)
    hm("H2 a disabled control: over is set (shown), HandleMouse is not called", 0x201, 70, 20)
    fresh(); o.set("B", "m_bShow", 0); o.answer("B", "mouse", 1)
    hm("H2 a hidden control: neither", 0x201, 70, 20)
    fresh(); o.set("B", "m_bOutofList", 1); o.answer("B", "mouse", 1)
    hm("H2 an out-of-list control: over is set, HandleMouse is not called", 0x201, 70, 20)
    # the walk: from the last control to the first
    fresh(); o.control_("A2", "D", rect=(0, 0, 40, 40)); o.control_("A3", "D", rect=(0, 0, 40, 40)); o.register("D", ["A", "A2", "A3", "B", "C"]); o.answer("A", "mouse", 1)
    hm("H3 A, A2, A3 overlap: A3 (the last) is asked first, then A2, then A (answers 1)", 0x201, 20, 20, flags=["A", "A2", "A3"])
    o.answer("A2", "mouse", 1)
    hm("H3 the same with A2 answering 1: A is not asked", 0x201, 20, 20, flags=["A", "A2", "A3"])
    # the focus: a combo box or an IME box of this dialog first
    for ctype, tag in (("combobox", "a combo box"), ("ime", "an IME edit box"), ("button", "a button")):
        fresh(); o.control_("F", "D", rect=(200, 200, 240, 240), type=ctype); o.register("D", ABC + ["F"]); o.focus("F"); o.answer("F", "mouse", 1); o.answer("A", "mouse", 1)
        hm("H4 the focus is %s (F, answers 1): a point on A" % tag, 0x201, 20, 20)
    fresh(); o.control_("F", "D", rect=(200, 200, 240, 240), type="combobox", offset=(30.0, 40.0)); o.register("D", ABC + ["F"]); o.focus("F"); o.answer("A", "mouse", 1)
    hm("H4 the focus is a combo box answering 0, offset (30, 40): its local point (-10, -20), then A is asked", 0x201, 20, 20)
    for kind in ("another dialog", "disabled", "hidden"):
        fresh()
        if kind == "another dialog":
            o.dialog_("E", index=2); o.control_("F", "E", index=2, rect=(200, 200, 240, 240), type="combobox"); o.register("E", ["F"])
        else:
            o.control_("F", "D", rect=(200, 200, 240, 240), type="combobox", enable=(kind != "disabled"), show=(kind != "hidden")); o.register("D", ABC + ["F"])
        o.focus("F"); o.answer("F", "mouse", 1)
        hm("H5 the focus is a combo box that is %s: not asked" % kind, 0x201, 20, 20)
    fresh(); o.control_("F", "D", rect=(200, 200, 240, 240), type="combobox"); o.register("D", ABC + ["F"]); o.focus("F"); o.answer("F", "mouse", 1)
    hm("H5 the focus is a combo box answering 1: the walk does not run (no OnMouseMove, over is not set)", 0x200, 20, 20, flags=ABC + ["F"])
    # the scale
    fresh(); o.scale(1.5, 2.0); o.set("A", "offset", [3.5, 2.25]); o.set("A", "rect", [0, 0, 100, 100]); o.answer("A", "mouse", 1)
    hm("H6 scale (1.5, 2), A's offset (3.5, 2.25), point (65, 50): A gets (40, 23)", 0x201, 65, 50)
    return o


if __name__ == "__main__":
    o = main()
    if "--json" in sys.argv:
        import json
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w", encoding="utf-8") as fh:  # one step per line
            fh.write("[\n" + ",\n".join(json.dumps(step, ensure_ascii=False) for step in o.script) + "\n]\n")
