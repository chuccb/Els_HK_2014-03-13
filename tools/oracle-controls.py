#!/usr/bin/env python3
"""
The mouse input of the simple controls of x2.exe on the Unicorn CPU emulator: the oracle of `CKTDGUIStatic.handleMouse`,
`CKTDGUIButton.handleMouse` and `CKTDGUIButton.lButtonMouseUp` (packages/ui/src/static.ts, button.ts; tested by
packages/ui/test/controls-input.test.ts, which replays packages/ui/test/controls-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-controls.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-controls.py --json FILE    (and writes the script and the exe's answers to FILE)

The exe's functions run as they are: CKTDGUIStatic::HandleMouse 32929E60 (through its vtable slot 8, on a control whose vtable pointer is the
real vtable of the class), CKTDGUIButton::HandleMouse 3292E520 and LButtonMouseUp 3292E6D0 (called by it), and what they call: ContainsPoint
(CKTDGUIStatic 32928E90 over the pictures' points, the control's own 32924310 for a button), SendInternelEvent 329253D0, RequestFocus
3295B490, ClearFocus 32956B90 and the base OnFocusIn / OnFocusOut / CanHaveFocus.  The objects are built by hand in the emulated memory (see
oracle-input.py for the dialog, the stage and the probe controls).  What is replaced by a stub that writes the call down:
  * `CKTDGUIButton::ChangeState` (virtual slot 41 of a copy of the button's vtable): `A.change(state,force)`;
  * `CKTDGUIControl::PlaySoundW` 329251E0: `A.sound(up)` / `A.sound(down)` / `A.sound(none)` (the pointers the button holds are fake);
  * `CKTDXApp::SendGameMessage` 328CCCD0: `gameMsg(uMsg,wParam,lParam,direct)`;
  * `CKTDGUIDialogManager::CheckDlg` 328DE0F0 (the dialog is known to the manager or not) and `operator!=(CKTDGUIDialogHandle, const
    CKTDGUIDialog*)` 329638A0 (the table of `KJohnObjMan` is not built: a handle whose index names no dialog is a stale one, which compares as
    null; `gone` makes a dialog's handle stale).
The layout is the exe's: control +0xB0 has focus, +0xB1 mouse over, +0xB2 enable, +0xB3 show; Static +0x2B4 double click message, +0x2B8 mouse up
message, +0x21C the pictures; Button +0x250 mouse up message, +0x254 right mouse up, +0x258 double click, +0x28C / +0x29C / +0x2A0 the custom
function name of the mouse up (a `std::string`: 16 bytes of buffer, size, capacity), +0x2A8 the mouse up sound, +0x2AC the mouse down sound,
+0x326 `m_bEnableClick`; the dialog +0x77 `m_bMouseDownForDrag`.
"""
import importlib.util, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from peemu import *

_spec = importlib.util.spec_from_file_location("oracle_input", os.path.join(HERE, "oracle-input.py"))
oi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oi)
om = oi.om
EAX, ECX = oi.EAX, oi.ECX
s32 = oi.s32

oi.CONTROL_FIELDS["m_bHasFocus"] = (0xB0, "B")
SOUND_UP, SOUND_DOWN = 0x5550, 0x5554
SOUNDS = {0: "none", SOUND_UP: "up", SOUND_DOWN: "down"}
STATIC_HANDLE_MOUSE, BUTTON_HANDLE_MOUSE = 0x32929E60, 0x3292E520
# what `act_ctl` calls (virtual slot 8 of the control's class) and which fields it writes down, by kind of control; `down` is the dialog's
# m_bMouseDownForDrag, the others are fields of the control at the offset of FIELD_OFFSETS: an offset (a byte), or (offset, format) with the
# format "B" (byte), "i" (int), "d" (double, printed the way JavaScript prints a number: `12.375`, `12`), "pt" (two ints, `x,y`) or "rect"
# (four ints, `l,t,r,b`), or a function (oracle, control address) -> text
HANDLERS = {"button": BUTTON_HANDLE_MOUSE, "static": STATIC_HANDLE_MOUSE}
MSG_PROCS = {}  # the MsgProc `act_msg` calls, by kind of control: (the virtual slot, the exe's function)
STATE_KEYS = {"button": ("hasFocus", "focus", "down"), "static": ("hasFocus", "focus", "down")}
FIELD_OFFSETS = {}


class ControlOracle(oi.InputOracle):
    def __init__(self):
        super().__init__()
        self.managed = set()  # handle indices of the dialogs the dialog manager knows
        self.kind = {}  # control address -> "button" | "static"
        self.replace(0x329638A0, self._opne)
        self.replace(0x329251E0, self._sound, b"\xC2\x04\x00")
        self.replace(0x328CCCD0, self._game_message, b"\xC2\x10\x00")
        self.replace(0x328DE0F0, self._check_dlg, b"\xC2\x08\x00")
        self.change_stub = self.hooked(self._change, b"\xC2\x08\x00")

    # ---- the stubs
    def _opne(self, emu):  # cdecl operator!=(handle, ptr): the handle is stale when its index names no dialog
        idx, magic, ptr = emu.args(3)
        idx = s32(idx)
        target = self.dialogs.get(idx) if idx >= 0 and magic != 0 else None
        emu.set_reg(EAX, 0 if (ptr == 0 if target is None else target == ptr) else 1)

    def _sound(self, emu):
        (snd,) = emu.args(1)
        self.log("%s.sound(%s)" % (self.name(emu.reg(ECX)), SOUNDS[snd]))

    def _game_message(self, emu):
        uMsg, wParam, lParam, direct = emu.args(4)
        self.log("gameMsg(%d,%d,%s,%d)" % (uMsg, s32(wParam), self.name(lParam), direct & 0xFF))
        emu.set_reg(EAX, 0)

    def _check_dlg(self, emu):
        idx, magic = emu.args(2)
        idx = s32(idx)
        known = idx in self.managed and idx in self.dialogs and magic != 0
        emu.set_reg(EAX, 1 if known else 0)

    def _change(self, emu):
        state, force = emu.args(2)
        self.log("%s.change(%d,%d)" % (self.name(emu.reg(ECX)), s32(state), force & 0xFF))

    def _stage_msg(self, emu):  # 0x468 carries a C string
        hwnd, msg, wparam, lparam = emu.args(4)
        assert hwnd == oi.APP_HWND, hex(hwnd)
        if msg == 0x468:
            text = b""
            while emu.read(wparam + len(text), 1) != b"\0":
                text += emu.read(wparam + len(text), 1)
            self.log("stage(%d,%s,%s)" % (msg, text.decode("ascii"), self.name(lparam)))
        else:
            self.log("stage(%d,%d,%s)" % (msg, s32(wparam), self.name(lparam)))

    # ---- the objects
    def managed_(self, dialog, known):
        index = [i for i, a in self.dialogs.items() if a == self.addr[dialog]][0]
        (self.managed.add if known else self.managed.discard)(index)
        self.op("managed", dialog, known)

    def gone(self, dialog):
        """the dialog is destroyed: a handle to it is stale (the memory stays, to show that nothing is written to it)"""
        index = [i for i, a in self.dialogs.items() if a == self.addr[dialog]][0]
        del self.dialogs[index]
        self.op("gone", dialog)

    def button_(self, label, dialog, index=1, rect=(0, 0, 40, 40), enable=True, show=True, enable_click=True, up=-1, right_up=-1, dbl=-1, func=""):
        emu = self.emu
        l, t, r, b = rect
        c = self.control("Button", label, corners=om.rect(l, t, r, b), dialog=index, show=show, enable=enable)
        vt = emu.alloc(4 * 64)
        emu.write(vt, emu.read(om.VTABLE["Button"], 4 * 42))
        emu.w32(vt + 4 * 41, self.change_stub)
        emu.w32(c, vt)
        emu.write(c + 0x250, struct.pack("<3i", up, right_up, dbl))
        emu.write(c + 0x28C, func.encode("ascii").ljust(16, b"\0"))
        emu.write(c + 0x29C, struct.pack("<II", len(func), 15))
        emu.write(c + 0x2A8, struct.pack("<II", SOUND_UP, SOUND_DOWN))
        emu.write(c + 0x326, bytes([1 if enable_click else 0]))
        self.addr[label] = c
        self.owner[c] = self.addr[dialog]
        self.kind[c] = "button"
        self.op("button", label, dialog, {"rect": list(rect), "enable": enable, "show": show, "enableClick": enable_click, "up": up, "rightUp": right_up,
                                          "dbl": dbl, "func": func})
        return c

    def static_(self, label, dialog, index=1, pictures=((0, 0, 40, 40),), enable=True, show=True, up=-1, dbl=-1):
        emu = self.emu
        c = self.control("Static", label, dialog=index, show=show, enable=enable, pictures=[om.rect(*p) if p else None for p in pictures])
        emu.write(c + 0x2B4, struct.pack("<2i", dbl, up))
        self.addr[label] = c
        self.owner[c] = self.addr[dialog]
        self.kind[c] = "static"
        self.op("static", label, dialog, {"pictures": [list(p) if p else None for p in pictures], "enable": enable, "show": show, "up": up, "dbl": dbl})
        return c

    def give_focus(self, label):
        """the control has the focus: the global and its own flag"""
        self.focus(label)
        self.set(label, "m_bHasFocus", 1)

    def state_of(self, label):
        c = self.addr[label]
        d = self.owner[c]
        kind = self.kind[c]
        out = []
        for key in STATE_KEYS[kind]:
            if key == "hasFocus":
                v = self.b(c + 0xB0)
            elif key == "focus":
                v = self.get_focus()
            elif key == "down":
                v = self.b(d + 0x77)
            else:
                v = self.read_field(c, FIELD_OFFSETS[kind][key])
            out.append("%s=%s" % (key, v))
        return " ".join(out)

    def read_field(self, c, spec):
        if callable(spec):
            return spec(self, c)
        off, fmt = spec if isinstance(spec, tuple) else (spec, "B")
        if fmt == "B":
            return self.b(c + off)
        if fmt == "i":
            return self.i(c + off)
        if fmt == "d":
            text = repr(struct.unpack("<d", self.emu.read(c + off, 8))[0])
            return text[:-2] if text.endswith(".0") else text
        n = {"pt": 2, "rect": 4}[fmt]
        return ",".join(str(v) for v in struct.unpack("<%di" % n, self.emu.read(c + off, 4 * n)))

    def act_ctl(self, case, label, uMsg, x, y, wParam=0, lParam=0):
        """send `HandleMouse(uMsg, (x, y), wParam, lParam)` to the control through its vtable"""
        c = self.addr[label]
        self.events = []
        handler = self.emu.u32(self.emu.u32(c) + 4 * 8)
        assert handler == HANDLERS[self.kind[c]], hex(handler)
        ret = self.thiscall(handler, c, [uMsg, x, y, wParam, lParam]) & 0xFF
        events = list(self.events)
        state = self.state_of(label)
        print("%-100s -> %d | %s | %s" % (case, ret, ",".join(events), state))
        self.op("act_ctl", case, label, [uMsg, x, y, wParam, lParam], {"ret": ret, "events": events, "state": state})
        return ret

    def act_msg(self, case, label, uMsg, wParam=0, lParam=0):
        """send `MsgProc(hWnd, uMsg, wParam, lParam)` to the control through its vtable (slot 6; the scroll bar's own `MsgProc(uMsg, wParam,
        lParam)` is slot 41)"""
        c = self.addr[label]
        self.events = []
        slot, fn = MSG_PROCS[self.kind[c]]
        handler = self.emu.u32(self.emu.u32(c) + 4 * slot)
        assert handler == fn, hex(handler)
        args = [uMsg, wParam, lParam] if slot != 6 else [oi.APP_HWND, uMsg, wParam, lParam]
        ret = self.thiscall(handler, c, args) & 0xFF
        events = list(self.events)
        state = self.state_of(label)
        print("%-100s -> %d | %s | %s" % (case, ret, ",".join(events), state))
        self.op("act_msg", case, label, [uMsg, wParam, lParam], {"ret": ret, "events": events, "state": state})
        return ret


def main():
    o = ControlOracle()
    IN, OUT = (20, 20), (100, 100)

    def fresh_button(**kw):
        """the dialog D (managed, with a stage), the button A (0,0)-(40,40) and a probe control Y (60,0)-(100,40) that can take the focus"""
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        o.button_("A", "D", **kw)
        o.control_("Y", "D", rect=(60, 0, 100, 40))
        o.register("D", ["A", "Y"])

    def fresh_static(**kw):
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        o.static_("S", "D", **kw)
        o.register("D", ["S"])

    def hit(case, label, uMsg, point=IN, wParam=0, lParam=0):
        return o.act_ctl(case, label, uMsg, point[0], point[1], wParam, lParam)

    # ================================================================ CKTDGUIButton::HandleMouse
    # ---- the gates: enabled, shown, m_bEnableClick
    for tag, kw in (("all on", {}), ("disabled", {"enable": False}), ("hidden", {"show": False}), ("m_bEnableClick off", {"enable_click": False})):
        fresh_button(**kw)
        hit("B1 left button down inside, %s" % tag, "A", 0x201)
    # ---- the messages a button does not take: the move, the right double click, the rest
    for m in (0x200, 0x206, 0x207, 0x20A, 0x100, 0x401):
        fresh_button()
        hit("B1 message 0x%X inside" % m, "A", m)

    # ---- the button down (left 0x201 and right 0x204): the focus, the sound, the state
    for m in (0x201, 0x204):
        fresh_button()
        hit("B2 message 0x%X inside, no focus, the manager knows D: the button takes the focus" % m, "A", m)
    fresh_button(); o.give_focus("Y")
    hit("B2 inside, Y has the focus: Y loses it, A gets it", "A", 0x201)
    fresh_button(); o.give_focus("A")
    hit("B2 inside, A has the focus already: no request", "A", 0x201)
    fresh_button(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    hit("B2 inside, m_bHasFocus set but the global focus is Y: no request (the flag is what is asked)", "A", 0x201)
    fresh_button(); o.managed_("D", False); o.give_focus("Y")
    hit("B2 inside, the manager does not know D (CheckDlg no): no request, the sound and the state change", "A", 0x201)
    fresh_button(); o.gone("D"); o.give_focus("Y")
    hit("B2 inside, D is gone (a stale handle): no request", "A", 0x201)
    for point, tag in (((100, 100), "outside"), ((40, 40), "on the corner (the edge is outside)"), ((39, 39), "just inside")):
        fresh_button()
        hit("B2 left button down %s" % tag, "A", 0x201, point)
    fresh_button(); o.give_focus("A")
    hit("B2 right button down outside, A has the focus: nothing", "A", 0x204, OUT)

    # ---- the left button up: a click when the point is in the button and the button has the focus; taken in every case
    fresh_button(); o.give_focus("A")
    hit("B3 up inside, focus, no message: the focus is cleared, the game message 0x466 (2, A, direct), normal state, sound up", "A", 0x202)
    fresh_button(up=77); o.give_focus("A")
    hit("B3 up inside, focus, mouse up message 77: the stage gets it (no game message)", "A", 0x202)
    fresh_button(func="fn"); o.give_focus("A")
    hit("B3 up inside, focus, no message, function name fn: the game message, then the stage gets fn (0x468)", "A", 0x202)
    fresh_button(up=77, func="Click"); o.give_focus("A")
    hit("B3 up inside, focus, message 77 and function Click: the message, then the function", "A", 0x202)
    fresh_button(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    hit("B3 up inside, A's flag set but the global focus is Y: ClearFocus takes it from Y", "A", 0x202)
    fresh_button()
    hit("B3 up inside, no focus: taken, nothing happens", "A", 0x202)
    fresh_button(up=77); o.give_focus("A")
    hit("B3 up OUTSIDE, focus: taken, nothing happens", "A", 0x202, OUT)
    fresh_button(up=77)
    hit("B3 up outside, no focus: taken", "A", 0x202, OUT)
    fresh_button(up=77, func="fn"); o.give_focus("A"); o.gone("D")
    hit("B3 up inside, focus, D is gone: no ClearFocus, no stage message (SendInternelEvent finds no dialog)", "A", 0x202)
    fresh_button(func="fn"); o.give_focus("A"); o.gone("D")
    hit("B3 up inside, focus, D is gone, no message: the game message goes out all the same", "A", 0x202)
    o.reset(); o.dialog_("D", stage=False); o.managed_("D", True); o.button_("A", "D", up=77, func="fn"); o.register("D", ["A"]); o.give_focus("A")
    hit("B3 up inside, focus, D has no stage: no stage message", "A", 0x202)

    # ---- the left double click
    fresh_button(dbl=5)
    hit("B4 double click inside, message 5: the stage gets it, the up sound", "A", 0x203)
    fresh_button()
    hit("B4 double click inside, no message: the up sound only", "A", 0x203)
    fresh_button(dbl=5)
    hit("B4 double click outside: not taken", "A", 0x203, OUT)
    fresh_button(dbl=5); o.give_focus("A")
    hit("B4 double click inside with the focus: the focus is not touched", "A", 0x203)

    # ---- the right button up: with the focus and inside, the message, the over state and the up sound; taken in every case
    fresh_button(); o.give_focus("A")
    hit("B5 right up inside, focus, no message: the over state, the up sound", "A", 0x205)
    fresh_button(right_up=9); o.give_focus("A")
    hit("B5 right up inside, focus, message 9: the stage gets it first", "A", 0x205)
    fresh_button(right_up=9)
    hit("B5 right up inside, no focus: taken, nothing happens", "A", 0x205)
    fresh_button(right_up=9); o.give_focus("A")
    hit("B5 right up outside, focus: taken, nothing happens", "A", 0x205, OUT)

    # ================================================================ CKTDGUIStatic::HandleMouse
    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False})):
        fresh_static(**kw)
        hit("S1 left button down inside, %s" % tag, "S", 0x201)
    for m in (0x200, 0x207, 0x20A, 0x100):
        fresh_static(up=77, dbl=5)
        hit("S1 message 0x%X inside (move: taken without a message; the others are not taken)" % m, "S", m)
    fresh_static()
    hit("S2 mouse move outside: not taken", "S", 0x200, OUT)
    # the pictures: the point of any of them
    fresh_static(pictures=((0, 0, 40, 40), None, (100, 0, 140, 40)))
    hit("S2 move in the third picture (the second has no point)", "S", 0x200, (120, 20))
    hit("S2 move between the pictures", "S", 0x200, (60, 20))
    fresh_static(pictures=())
    hit("S2 move, no picture", "S", 0x200)
    # button down: the drag flag
    fresh_static()
    hit("S3 left button down inside: the dialog starts a drag", "S", 0x201)
    fresh_static(); o.gone("D")
    hit("S3 left button down inside, D is gone: taken, no flag", "S", 0x201)
    fresh_static()
    hit("S3 left button down outside: not taken, no flag", "S", 0x201, OUT)
    # button up: the message, the flag is left alone
    fresh_static(up=77); o.set("D", "m_bMouseDownForDrag", 1)
    hit("S4 left button up inside, message 77: the stage gets it, then the drag ends (the code runs on into 0x204's)", "S", 0x202)
    fresh_static(); o.set("D", "m_bMouseDownForDrag", 1)
    hit("S4 left button up inside, no message: taken, the drag ends", "S", 0x202)
    fresh_static(up=77); o.set("D", "m_bMouseDownForDrag", 1)
    hit("S4 left button up outside: not taken, the flag stays", "S", 0x202, OUT)
    fresh_static(up=77); o.set("D", "m_bMouseDownForDrag", 1); o.gone("D")
    hit("S4 left button up inside, D is gone: the message is not sent (no dialog, no stage), the gone dialog's flag stays", "S", 0x202)
    # the right button: the drag flag is cleared
    for m in (0x204, 0x205, 0x206):
        fresh_static(up=77, dbl=5); o.set("D", "m_bMouseDownForDrag", 1)
        hit("S5 message 0x%X inside: the drag flag is cleared, taken, no message" % m, "S", m)
    fresh_static(); o.set("D", "m_bMouseDownForDrag", 1); o.gone("D")
    hit("S5 right button down inside, D is gone: taken, the flag of the gone dialog stays", "S", 0x204)
    fresh_static(); o.set("D", "m_bMouseDownForDrag", 1)
    hit("S5 right button down outside: not taken, the flag stays", "S", 0x204, OUT)
    # the double click
    fresh_static(dbl=5, up=77)
    hit("S6 left double click inside, message 5: the stage gets it, taken", "S", 0x203)
    fresh_static(up=77)
    hit("S6 left double click inside, no message: not taken", "S", 0x203)
    fresh_static(dbl=5)
    hit("S6 left double click outside: not taken", "S", 0x203, OUT)
    return o


if __name__ == "__main__":
    o = main()
    if "--json" in sys.argv:
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w", encoding="utf-8") as fh:  # one step per line
            import json
            fh.write("[\n" + ",\n".join(json.dumps(step, ensure_ascii=False) for step in o.script) + "\n]\n")
