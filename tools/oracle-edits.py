#!/usr/bin/env python3
"""
The input of the edit box (`CKTDGUIEditBox`) of x2.exe on the Unicorn CPU emulator: the oracle of `CKTDGUIEditBox.handleKeyboard`, `msgProc`, `handleMouse`,
`onFocusOut`, `ContainPTForEditBox`, `CopyToClipboard`, `PasteFromClipboard`, `DeleteSelectionText`, `ClearText` and `PlaceCaret` (packages/ui/src/editbox.ts;
tested by packages/ui/test/edits-input.test.ts, which replays packages/ui/test/edits-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-edits.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-edits.py --json FILE    (and writes the script and the exe's answers to FILE)

The exe's functions run as they are, through the real vtable of the class (0x334AF730: MsgProc slot 6 = 32933F70, HandleKeyboard slot 7 = 32933AB0,
HandleMouse slot 8 = 32933D80, OnFocusOut slot 10 = 32934290) or called by their address (ContainPTForEditBox 329331C0, ClearText 32933190,
DeleteSelectionText 32933540, CopyToClipboard 32933460, PasteFromClipboard 32934970, PlaceCaret 32934A00), with what they call: the text buffer
(`CKTDGUIUniBuffer`, built into the box at +0x268; see oracle-unibuf.py for the C runtime, `lstrlenW` and the UK font it runs on), `SendInternelEvent`
329253D0, `RequestFocus` 3295B490 and the control's base functions.  The box is built by hand in the emulated memory inside a dialog with a stage, a
dialog manager and a probe control that can take the focus (oracle-input.py, oracle-lists.py).  What is replaced by a stub that writes the call down:
  * the window system: `GetKeyState` (`ks(16)`: it answers what the case says the key's state is, as the SHORT in AX: 0x8000 is down, the low bit is
    the toggle), `SetCapture` / `ReleaseCapture` (`capture` / `release`), the clipboard (`clip.open`, `clip.empty`, `clip.set(text)`, `clip.get`,
    `clip.close`: `OpenClipboard`, `EmptyClipboard`, `SetClipboardData(CF_UNICODETEXT, block)` with the text the exe wrote into its block,
    `GetClipboardData`, `CloseClipboard`; `GlobalAlloc` / `GlobalLock` / `GlobalUnlock` / `GlobalFree` work on the emulator's heap: nobody sees them);
  * `CKTDGUIControl::PlaySoundW` 329251E0 (`E.sound(down)` / `E.sound(none)`), and the stage's MsgProc (`stage(1127,5,E)`), which writes the state of the
    box at that moment behind the message (`[text=abc caret=1 sel=1 first=0 on=1 blink=100.5]`: the handler of a message may ask the box);
  * the timer of DXUT: `DXUTGetGlobalTimer` 328A76B0 answers a fake object and `GetAbsoluteTime` 328A7F70 (`time`) the seconds the case says, plus a step
    for every call before (the first call answers the base, the next one base + step ...), so the number of calls shows in `blink`.
The layout is the exe's: control +0xB0 has focus, +0xB2 enable, +0xB3 show, +0xBC the current point, +0x58 the offset; edit box +0x258 m_CustomMsgEditBoxChange,
+0x25C Enter, +0x260 FocusOut, +0x264 m_bEnableInput, +0x268 m_Buffer (0x1CC bytes), +0x434 m_rcText, +0x450 m_dfLastBlink, +0x458 m_bCaretOn, +0x45C
m_nCaret, +0x460 m_bInsertMode, +0x464 m_nSelStart, +0x468 m_nFirstVisible, +0x480 m_bMouseDrag, +0x4F4 the key sound; the box is 0x4F8 bytes.
The state written down after a call: the focus, the text (the characters up to the NUL, anything but `!`..`~` as %XXXX), the caret, the selection's
start, the first visible character, the insert mode, the caret's blink, the drag, the room of the buffer and whether it has to be analysed again, and the
text on the clipboard.
"""
import importlib.util, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from peemu import *


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ol = load("oracle_lists", "oracle-lists.py")
ou = load("oracle_unibuf", "oracle-unibuf.py")
ob, oc, oi, om = ol.ob, ol.oc, ol.oi, ol.om
EAX, ECX = oi.EAX, oi.ECX

EDIT_VTABLE, UCT_EDIT = 0x334AF730, 3
EDIT_MSG_PROC, EDIT_HANDLE_KEYBOARD, EDIT_HANDLE_MOUSE, EDIT_ON_FOCUS_OUT = 0x32933F70, 0x32933AB0, 0x32933D80, 0x32934290
SLOTS = {  # the virtual functions the scenes call: name -> (slot, the exe's function, the number of arguments, whether the window handle comes first)
    "key": (7, EDIT_HANDLE_KEYBOARD, 3, False), "msg": (6, EDIT_MSG_PROC, 3, True), "mouse": (8, EDIT_HANDLE_MOUSE, 5, False), "out": (10, EDIT_ON_FOCUS_OUT, 0, False),
}
CALLS = {  # the members the scenes call by address: name -> (address, the number of arguments, whether it answers a bool)
    "contain": (0x329331C0, 2, True), "clear": (0x32933190, 0, False), "delete": (0x32933540, 0, False), "copy": (0x32933460, 0, False),
    "paste": (0x32934970, 0, False), "place": (0x32934A00, 1, False),
}
GET_KEY_STATE, OPEN_CB, EMPTY_CB, SET_CB_DATA, CLOSE_CB = 0x3348F644, 0x3348F634, 0x3348F640, 0x3348F63C, 0x3348F6DC
GET_CB_DATA = 0x3362EACC
GLOBAL_ALLOC, GLOBAL_UNLOCK, GLOBAL_LOCK, GLOBAL_FREE = 0x3348F0A8, 0x3348F0AC, 0x3348F0B0, 0x3348F0B4
DXUT_GET_GLOBAL_TIMER, GET_ABSOLUTE_TIME = 0x328A76B0, 0x328A7F70
BUFFER = 0x268  # the offset of m_Buffer in the box
CF_UNICODETEXT = 0xD
om.VTABLE["Edit"], om.UCT["Edit"] = EDIT_VTABLE, UCT_EDIT
oc.HANDLERS["edit"] = EDIT_HANDLE_MOUSE
oc.MSG_PROCS["edit"] = (6, EDIT_MSG_PROC)


def esc(text):
    """a text for a line of the state: the printable ASCII as it is, every other character (and the space and the percent sign) as %XXXX"""
    return "".join(ch if 0x21 <= ord(ch) <= 0x7E and ch != "%" else "%%%04X" % ord(ch) for ch in text)


def text_of(o, c):
    data = o.emu.u32(c + BUFFER + 0xC)
    return "null" if data == 0 else esc(o.wstr(data))


oc.STATE_KEYS["edit"] = ("hasFocus", "focus", "text", "caret", "selstart", "first", "insert", "caretOn", "blink", "mdrag", "size", "analyse", "clip")
oc.FIELD_OFFSETS["edit"] = {
    "text": text_of, "caret": (0x45C, "i"), "selstart": (0x464, "i"), "first": (0x468, "i"), "insert": 0x460, "caretOn": 0x458, "blink": (0x450, "d"),
    "mdrag": 0x480, "size": (BUFFER, "i"), "analyse": BUFFER + 0xFC, "clip": lambda o, c: "null" if o.clip is None else esc(o.clip),
}


class EditOracle(ou.UniRuntime, ol.ListOracle):
    def __init__(self):
        super().__init__()
        emu = self.emu
        self.errors = []
        self.install_runtime()
        self.make_font()
        self.keys, self.clip, self.clip_busy, self.clip_lock_fails = {}, None, False, False
        self.clip_block = 0
        self.time_base, self.time_step, self.time_calls = 0.0, 0.0, 0
        # the window system
        emu.hook(emu.stub(GET_KEY_STATE, b"\xC2\x04\x00"), self._get_key_state)
        emu.hook(emu.stub(OPEN_CB, b"\xC2\x04\x00"), self._open_clipboard)
        emu.hook(emu.stub(EMPTY_CB, b"\xC3"), self._empty_clipboard)
        emu.hook(emu.stub(SET_CB_DATA, b"\xC2\x08\x00"), self._set_clipboard_data)
        emu.hook(emu.stub(GET_CB_DATA, b"\xC2\x04\x00"), self._get_clipboard_data)
        emu.hook(emu.stub(CLOSE_CB, b"\xC3"), lambda e: (self.log("clip.close"), e.set_reg(EAX, 1)))
        emu.hook(emu.stub(GLOBAL_ALLOC, b"\xC2\x08\x00"), self._global_alloc)
        emu.hook(emu.stub(GLOBAL_LOCK, b"\xC2\x04\x00"), self._global_lock)
        emu.stub(GLOBAL_UNLOCK, b"\x31\xC0\xC2\x04\x00")  # xor eax, eax; ret 4
        emu.stub(GLOBAL_FREE, b"\x31\xC0\xC2\x04\x00")
        # the timer: GetAbsoluteTime's double is loaded from a cell the hook fills in
        self.time_cell = emu.alloc(16)
        stub = self.emu.stub(None, b"\xDD\x05" + struct.pack("<I", self.time_cell) + b"\xC3")  # fld qword ptr [cell]; ret
        emu.hook(stub, self._absolute_time)
        emu.write(GET_ABSOLUTE_TIME, b"\xE9" + struct.pack("<i", stub - (GET_ABSOLUTE_TIME + 5)))
        self.timer_object = emu.alloc(0x40)
        self.replace(DXUT_GET_GLOBAL_TIMER, lambda e: e.set_reg(EAX, self.timer_object))
        # the key sound
        self.mark = emu.heap_ptr

    # ---- the stubs
    def note_error(self, text):
        self.log(text)

    def _get_key_state(self, emu):
        (vk,) = emu.args(1)
        self.log("ks(%d)" % vk)
        emu.set_reg(EAX, self.keys.get(vk, 0))

    def _open_clipboard(self, emu):
        (hwnd,) = emu.args(1)
        assert hwnd == 0, "the exe opens the clipboard for no window"
        self.log("clip.open")
        emu.set_reg(EAX, 0 if self.clip_busy else 1)

    def _empty_clipboard(self, emu):
        self.log("clip.empty")
        self.clip, self.clip_block = None, 0
        emu.set_reg(EAX, 1)

    def _set_clipboard_data(self, emu):
        fmt, block = emu.args(2)
        assert fmt == CF_UNICODETEXT, fmt
        self.clip, self.clip_block = self.wstr(block), block
        self.log("clip.set(%s)" % esc(self.clip))
        emu.set_reg(EAX, block)

    def _get_clipboard_data(self, emu):
        (fmt,) = emu.args(1)
        assert fmt == CF_UNICODETEXT, fmt
        self.log("clip.get")
        emu.set_reg(EAX, self.clip_block if self.clip is not None else 0)

    def _global_alloc(self, emu):
        flags, size = emu.args(2)
        assert flags == 2, flags  # GMEM_MOVEABLE
        emu.set_reg(EAX, emu.alloc(max(size, 1), 16))

    def _global_lock(self, emu):
        (handle,) = emu.args(1)
        emu.set_reg(EAX, 0 if self.clip_lock_fails and handle == self.clip_block else handle)

    def _absolute_time(self, emu):
        self.log("time")
        emu.write(self.time_cell, struct.pack("<d", self.time_base + self.time_step * self.time_calls))
        self.time_calls += 1

    def _stage_msg(self, emu):
        super()._stage_msg(emu)
        lparam = emu.args(4)[3]
        if self.kind.get(lparam) == "edit":
            self.events[-1] += "[text=%s caret=%d sel=%d first=%d on=%d blink=%s]" % (
                text_of(self, lparam), self.i(lparam + 0x45C), self.i(lparam + 0x464), self.i(lparam + 0x468), self.b(lparam + 0x458),
                self.read_field(lparam, (0x450, "d")))

    # ---- the scene
    def reset(self):
        super().reset()
        self.keys, self.clip, self.clip_busy, self.clip_lock_fails, self.clip_block = {}, None, False, False, 0
        self.time_base, self.time_step, self.time_calls = 0.0, 0.0, 0

    def key_states(self, states):
        """what `GetKeyState(vk)` answers (AX): `{vk: value}`, 0x8000 for down, 1 for up but toggled; a key that is not there is up"""
        self.keys = dict(states)
        self.op("keys", {str(k): v for k, v in states.items()})

    def clipboard(self, text=None, busy=False, lock_fails=False):
        """the clipboard: it holds `text` (None: no CF_UNICODETEXT data) or is open in another program (`busy`); `lock_fails`: the exe cannot lock the block of
        what it holds"""
        self.clip, self.clip_busy, self.clip_lock_fails = text, busy, lock_fails
        self.clip_block = self.put_wstr(text) if text is not None else 0
        self.op("clip", ou.enc(text), busy, lock_fails)

    def timer(self, base, step):
        """`GetAbsoluteTime()` answers `base + step * n` for its n-th call from now on"""
        self.time_base, self.time_step, self.time_calls = base, step, 0
        self.op("timer", base, step)

    def edit_(self, label, dialog, index=1, rect=(0, 0, 100, 20), quad=None, offset=(0.0, 0.0), text="abc", size=64, caret=None, sel=None, first=0, insert=True,
              caret_on=False, blink=3.25, drag=False, enable=True, show=True, enable_input=True, change=-1, enter=-1, focus_out=-1, sound=True,
              rc_text=(5, 0, 85, 20), length_limit=0xFFFF, one_char=False, only_num=False, width_limit=99999, line_limit=99999, auto_upper=False,
              byte_limit=False, byte_max=0, has_focus=False):
        """an edit box: `rect` (left, top, right, bottom) or `quad` (the four corners left-top, right-top, left-bottom, right-bottom as (x, y)) is its
        current point, `rc_text` the text rectangle; the text is `text` in room for `size` characters; the caret and the start of the selection are at the end
        of the text unless given"""
        emu = self.emu
        caret = len(text) if caret is None else caret
        sel = caret if sel is None else sel
        corners = [tuple(p) for p in quad] if quad is not None else om.rect(*rect)
        c = self.control("Edit", label, corners=corners, dialog=index, show=show, enable=enable, offset=offset, size=0x4F8)
        emu.write(c + 0xB0, bytes([1 if has_focus else 0]))
        emu.write(c + 0x258, struct.pack("<3i", change, enter, focus_out))
        emu.write(c + 0x264, bytes([1 if enable_input else 0]))
        self.fill_buffer(c + BUFFER, text, size, length_limit=length_limit, one_char=one_char, only_num=only_num, width_limit=width_limit, line_limit=line_limit,
                         only_num_english=False, check_case=False, big=True, byte_limit=byte_limit, byte_max=byte_max, auto_upper=auto_upper, hide=(False, 0),
                         font=(17, 1), analyse=False)
        emu.write(c + 0x434, struct.pack("<4i", *rc_text))
        emu.write(c + 0x450, struct.pack("<d", blink))
        emu.write(c + 0x458, bytes([1 if caret_on else 0]))
        emu.write(c + 0x45C, struct.pack("<i", caret))
        emu.write(c + 0x460, bytes([1 if insert else 0]))
        emu.write(c + 0x464, struct.pack("<2i", sel, first))
        emu.write(c + 0x480, bytes([1 if drag else 0]))
        emu.w32(c + 0x4F4, oc.SOUND_DOWN if sound else 0)
        self._adopt(c, label, dialog, "edit")
        self.op("edit", label, dialog, {
            "rect": list(rect), "quad": [list(p) for p in quad] if quad is not None else None, "offset": list(offset), "text": ou.enc(text), "size": size,
            "caret": caret, "sel": sel, "first": first, "insert": insert, "caretOn": caret_on, "blink": blink, "drag": drag, "enable": enable, "show": show,
            "enableInput": enable_input, "change": change, "enter": enter, "focusOut": focus_out, "sound": sound, "rcText": list(rc_text),
            "lengthLimit": length_limit, "oneChar": one_char, "onlyNum": only_num, "widthLimit": width_limit, "lineLimit": line_limit, "autoUpper": auto_upper,
            "byteLimit": byte_limit, "byteMax": byte_max, "hasFocus": has_focus,
        })
        return c

    # ---- the calls
    def act(self, case, label, what, *args):
        """send `what` to the box and write down the answer, the calls and the state: `key(uMsg, wParam, lParam)` (HandleKeyboard, virtual slot 7),
        `msg(uMsg, wParam, lParam)` (MsgProc, slot 6), `mouse(uMsg, x, y, wParam, lParam)` (HandleMouse, slot 8), `out()` (OnFocusOut, slot 10), or a member
        by its address: `contain(x, y)` (answers a bool), `clear()`, `delete()`, `copy()`, `paste()`, `place(cp)`"""
        c = self.addr[label]
        self.events = []
        args = list(args)
        if what in SLOTS:
            slot, fn, count, hwnd = SLOTS[what]
            assert len(args) == count, (what, args)
            handler = self.emu.u32(self.emu.u32(c) + 4 * slot)
            assert handler == fn, hex(handler)
            ret = self.thiscall(handler, c, ([oi.APP_HWND] if hwnd else []) + args)
            ret = ret & 0xFF if what != "out" else 0
        else:
            addr, count, answers = CALLS[what]
            assert len(args) == count, (what, args)
            ret = self.thiscall(addr, c, args)
            ret = (ret & 0xFF) if answers else 0
        events = list(self.events)
        state = self.state_of(label)
        print("%-100s -> %s | %s | %s" % (case, ret, ",".join(events), state))
        self.op("act_edit", case, label, what, args, {"ret": ret, "events": events, "state": state})
        return ret


def lp(x, y):
    """the `lParam` of a mouse message: x in the low word, y in the high word (each a signed 16-bit number)"""
    return ((y & 0xFFFF) << 16) | (x & 0xFFFF)


def main():
    o = EditOracle()
    # ---- the vocabulary
    WM_KEYDOWN, WM_CHAR = 0x100, 0x102
    TAB, ESC, END, HOME, LEFT, UP, RIGHT, DOWN_, INSERT, DELETE = 9, 27, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E
    SHIFT, CTRL = 0x10, 0x11
    DOWN = 0x8000
    NAMES = {TAB: "Tab", ESC: "Esc", END: "End", HOME: "Home", LEFT: "Left", UP: "Up", RIGHT: "Right", DOWN_: "Down", INSERT: "Insert", DELETE: "Delete"}
    SHIFTS = (("no shift", {}), ("shift down", {SHIFT: DOWN}), ("shift only toggled", {SHIFT: 1}), ("shift down and toggled", {SHIFT: DOWN | 1}))
    NARROW = (5, 0, 45, 20)  # a text rectangle 40 wide: about five characters of the oracle's font show
    OUT = (500, 500)

    def name(vk):
        return NAMES.get(vk, "0x%X" % vk)

    def fresh(text="abc", caret=None, sel=None, keys=None, clip=None, dpos=(10.0, 20.0), scale=None, **kw):
        """the dialog D (at (10, 20), managed, with a stage), the probe Y that can take the focus, and the box E (0,0)-(100,20) in it, holding `text` with the
        caret (and the start of the selection) at the end unless given; the keys in `keys` are down (VK: the SHORT GetKeyState answers); `clip`: the
        arguments of `clipboard`; the timer answers 100.5, 100.75, ... and the last blink of the box was at 3.25; `dpos`: where the dialog is; `scale`: the
        resolution scale (1 unless given)"""
        o.reset()
        if scale is not None:
            o.scale(*scale)
        o.dialog_("D", pos=dpos)
        o.managed_("D", True)
        o.control_("Y", "D", rect=(200, 0, 240, 40))
        o.edit_("E", "D", text=text, caret=caret, sel=sel, **kw)
        o.register("D", ["E", "Y"])
        o.key_states(keys or {})
        o.timer(100.5, 0.25)
        if clip is not None:
            o.clipboard(**clip)

    def key(case, vk, uMsg=WM_KEYDOWN, lParam=0x12345678):
        return o.act(case, "E", "key", uMsg, vk, lParam)

    def char(case, ch, uMsg=WM_CHAR, lParam=0x12345678):
        return o.act(case, "E", "msg", uMsg, ch, lParam)

    def hit(case, uMsg, x=50, y=30, wParam=0x1234, lParam=None):
        """a mouse message at the position (x, y) of the back buffer (the point the dialog hands the box is garbage: the box reads the position from lParam)"""
        return o.act(case, "E", "mouse", uMsg, 7777, 8888, wParam, lp(x, y) if lParam is None else lParam)

    # ================================================================ HandleKeyboard (32933AB0)
    # ---- the gates: the box is enabled (shown or not), the message is a key going down, the box takes input
    for tag, kw in (("enabled", {}), ("disabled", {"enable": False}), ("hidden", {"show": False}), ("input off", {"enable_input": False}),
                    ("disabled, input off", {"enable": False, "enable_input": False})):
        for vk in (LEFT, DELETE, TAB, ESC, 0x41):
            fresh("hello", caret=2, sel=2, **kw)
            key("K1 key down %s, box %s" % (name(vk), tag), vk)
    for uMsg in (0x101, 0x102, 0x104, 0x105, 0, 0xFF, 0x1000, 0x80000100, 0x200):
        fresh("hello", caret=2, sel=2)
        key("K1 message 0x%X is no key down: Left" % uMsg, LEFT, uMsg)
    # ---- the keys the box does not take, Tab (the dialog's), Escape (taken), Up and Down (taken, nothing happens)
    for vk in (TAB, ESC, UP, DOWN_, 0x41, 0x20, 0x70, 8, 13, 0x21, 0x22, 0x2F, 0, 0xFF, 0x10025, 0xFFFFFFFF, 0x80000025, 0x100000, 0x7FFFFFFF, 0x1B + 0x10000):
        fresh("hello", caret=2, sel=4, keys={SHIFT: DOWN, CTRL: DOWN})
        key("K2 key down %s, a selection, shift and control down" % name(vk), vk)
    # ---- Home and End: the caret goes to the start / the end; the selection collapses unless Shift is down; the caret blinks anew
    for vk in (HOME, END):
        for tag, keys in SHIFTS + (("ctrl down", {CTRL: DOWN}),):
            for caret, sel in ((2, 2), (2, 4), (4, 2), (0, 0), (5, 5), (0, 5)):
                fresh("hello", caret, sel, keys=keys)
                key("K3 %s, %s, caret %d, selection from %d" % (name(vk), tag, caret, sel), vk)
    for vk, caret, first in ((END, 0, 0), (END, 3, 0), (HOME, 11, 6), (HOME, 11, 3), (END, 11, 4), (HOME, 0, 0), (END, 5, 2), (HOME, 4, 4), (HOME, 5, 4)):
        fresh("hello world", caret=caret, first=first, rc_text=NARROW)
        key("K3 %s in a narrow box: caret %d, first visible %d" % (name(vk), caret, first), vk)
    fresh("", keys={SHIFT: DOWN})
    key("K3 End in an empty text, shift", END)
    fresh("")
    key("K3 Home in an empty text", HOME)
    # ---- Left and Right: one character, a word with Ctrl (the position comes from the buffer and goes into m_nCaret); Ctrl is asked first, Shift after
    TEXT = "ab cd  ef g"
    for vk in (LEFT, RIGHT):
        for ctag, ckeys in (("no ctrl", {}), ("ctrl", {CTRL: DOWN})):
            for caret in range(0, len(TEXT) + 1):
                if not ckeys and caret not in (0, 1, 2, 5, 10, 11):
                    continue
                fresh(TEXT, caret, caret, keys=dict(ckeys))
                key("K4 %s, %s, shift up, caret %d of %r" % (name(vk), ctag, caret, TEXT), vk)
    for vk in (LEFT, RIGHT):
        for ctag, ckeys in (("no ctrl", {}), ("ctrl", {CTRL: DOWN})):
            for stag, skeys in SHIFTS[1:]:
                for caret, sel in ((0, 0), (3, 3), (11, 11), (3, 1), (1, 3)):
                    fresh(TEXT, caret, sel, keys={**ckeys, **skeys})
                    key("K4 %s, %s, %s, caret %d, selection from %d" % (name(vk), ctag, stag, caret, sel), vk)
    for tag, keys in (("ctrl only toggled", {CTRL: 1}), ("ctrl down and toggled", {CTRL: DOWN | 1}), ("shift down: not ctrl", {SHIFT: DOWN})):
        for vk in (LEFT, RIGHT):
            fresh(TEXT, 5, 5, keys=keys)
            key("K4 %s, %s, caret 5" % (name(vk), tag), vk)
    for vk, caret, first, keys in ((RIGHT, 4, 0, {}), (RIGHT, 5, 0, {}), (RIGHT, 6, 3, {}), (LEFT, 3, 3, {}), (LEFT, 4, 4, {}), (LEFT, 5, 4, {}),
                                   (RIGHT, 3, 0, {CTRL: DOWN}), (RIGHT, 8, 0, {CTRL: DOWN}), (LEFT, 10, 6, {CTRL: DOWN}), (LEFT, 7, 7, {CTRL: DOWN})):
        fresh("hello world again", caret=caret, first=first, rc_text=NARROW, keys=keys)
        key("K4 %s in a narrow box: caret %d, first visible %d%s" % (name(vk), caret, first, ", ctrl" if keys else ""), vk)
    for vk in (LEFT, RIGHT):
        fresh("", keys={})
        key("K4 %s in an empty text" % name(vk), vk)
        fresh("", keys={CTRL: DOWN, SHIFT: DOWN})
        key("K4 %s in an empty text, ctrl and shift" % name(vk), vk)
    # ---- Insert: Ctrl copies, Shift pastes, neither toggles the insert mode; the key is never taken and the caret does not blink
    CLIPS = (("holding xyz", {"text": "xyz"}), ("holding nothing", {}), ("busy", {"busy": True, "text": "xyz"}), ("holding an empty text", {"text": ""}))
    for ctag, ckeys in (("no mods", {}), ("shift", {SHIFT: DOWN}), ("ctrl", {CTRL: DOWN}), ("ctrl and shift", {CTRL: DOWN, SHIFT: DOWN}),
                        ("shift toggled only", {SHIFT: 1}), ("ctrl toggled only", {CTRL: 1})):
        for caret, sel in ((2, 2), (1, 3), (3, 1)):
            for ctag2, clip in CLIPS[:2]:
                fresh("hello", caret, sel, keys=ckeys, clip=clip)
                key("K5 Insert, %s, caret %d, selection from %d, clipboard %s" % (ctag, caret, sel, ctag2), INSERT)
    for insert in (True, False):
        fresh("hello", 2, 2, insert=insert)
        key("K5 Insert toggles the insert mode (now %s)" % insert, INSERT)
    for ckeys in ({SHIFT: DOWN}, {CTRL: DOWN}):
        for ctag2, clip in CLIPS[2:]:
            for caret, sel in ((2, 2), (1, 3)):
                fresh("hello", caret, sel, keys=ckeys, clip=clip)
                key("K5 Insert, %s, caret %d, selection from %d, clipboard %s" % ("shift" if SHIFT in ckeys else "ctrl", caret, sel, ctag2), INSERT)
    # ---- Delete: the selection, else the character at the caret; the change message goes out when something was removed; the caret blinks anew either way
    for change in (-1, 7):
        for caret, sel in ((0, 0), (2, 2), (4, 4), (5, 5), (1, 3), (3, 1), (0, 5), (5, 0), (3, 8), (8, 3)):
            fresh("hello", caret, sel, change=change)
            key("K6 Delete, caret %d, selection from %d, change message %d" % (caret, sel, change), DELETE)
    for change in (0, -2):
        fresh("hello", 2, 2, change=change)
        key("K6 Delete a character, change message %d" % change, DELETE)
    for caret, sel, first in ((2, 8, 4), (8, 2, 4), (7, 7, 4), (8, 5, 6), (9, 3, 3)):
        fresh("hello world", caret=caret, sel=sel, first=first, rc_text=NARROW)
        key("K6 Delete in a narrow box: caret %d, selection from %d, first visible %d" % (caret, sel, first), DELETE)
    fresh("", change=7)
    key("K6 Delete in an empty text", DELETE)
    fresh("a", 0, 0, change=7)
    key("K6 Delete the only character", DELETE)

    # ================================================================ MsgProc (32933F70)
    # ---- the gates: enabled and shown, a character message (0x102), the box takes input
    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False}), ("input off", {"enable_input": False}),
                    ("hidden, input off", {"show": False, "enable_input": False})):
        for ch in (ord("a"), 8, 13, 0x16, 1, 3, 0x18):
            fresh("hello", caret=2, sel=2, change=7, enter=8, clip={"text": "xyz"}, **kw)
            char("M1 character 0x%X, box %s" % (ch, tag), ch)
    for uMsg in (0x100, 0x101, 0x103, 0x104, 0x286, 0x0, 0x402, 0x80000102, 0x10102):
        fresh("hello", caret=2, sel=2)
        char("M1 message 0x%X is no WM_CHAR: a" % uMsg, ord("a"), uMsg)
    # ---- the control characters, one by one (a text of three characters, the caret at 1)
    for ch in range(0, 0x20):
        fresh("abc", 1, 1, change=7, enter=8, clip={"text": "xyz"})
        char("M2 character 0x%02X, caret 1, no selection" % ch, ch)
    for ch in (1, 3, 8, 13, 0x16, 0x18, 2, 0x1D, 0x1E, 0x1F):
        fresh("abc", 1, 3, change=7, enter=8, clip={"text": "xyz"})
        char("M2 character 0x%02X, selection 1..3" % ch, ch)
    for ch in (0x20, 0x41, 0x7E, 0x7F, 0x80, 0xFF, 0x100, 0x4E2D, 0xD800, 0xDFFF, 0xFEFF, 0xFFFF):
        fresh("abc", 1, 1)
        char("M2 character 0x%04X typed" % ch, ch)
    for wp in (0x10061, 0xABCD0061, 0xFFFF0001, 0x00010008, 0xFFFF0008, 0x1000D, 0xFFFFFFFF, 0x12340016, 0x80000041, 0x00020003, 0x10000, 0x20000, 0x1E0000):
        fresh("abc", 1, 1, change=7, enter=8, clip={"text": "xyz"})
        char("M2 wParam 0x%08X: only the low 16 bits are the character" % wp, wp)
    # ---- Ctrl+A: with no selection the whole text is selected (the caret to the end); with a selection nothing happens
    for caret, sel in ((0, 0), (2, 2), (5, 5), (1, 3), (3, 1), (0, 5), (5, 0), (2, 4)):
        fresh("hello", caret, sel)
        char("M3 Ctrl+A, caret %d, selection from %d" % (caret, sel), 1)
    for caret, first in ((0, 0), (4, 2), (11, 5)):
        fresh("hello world", caret=caret, first=first, rc_text=NARROW)
        char("M3 Ctrl+A in a narrow box: caret %d, first visible %d" % (caret, first), 1)
    fresh("")
    char("M3 Ctrl+A in an empty text", 1)
    # ---- copy and cut
    for ch in (3, 0x18):
        what = "copy" if ch == 3 else "cut"
        for caret, sel in ((1, 3), (3, 1), (0, 5), (5, 0), (2, 2), (0, 0), (5, 5), (1, 6), (6, 1), (0, 3), (4, 5)):
            fresh("hello", caret, sel, change=-1, clip={"text": "old"})
            char("M4 %s, caret %d, selection from %d" % (what, caret, sel), ch)
        fresh("hello", 1, 3, change=7, clip={"text": "old", "busy": True})
        char("M4 %s with the clipboard busy: nothing happens (a cut still deletes and tells)" % what, ch)
        fresh("hello", 1, 3, change=7, clip={})
        char("M4 %s, change message 7" % what, ch)
        fresh("hello", 2, 2, change=7, clip={})
        char("M4 %s without a selection, change message 7" % what, ch)
        fresh("hello world", caret=8, sel=2, first=4, rc_text=NARROW, clip={})
        char("M4 %s in a narrow box: caret 8, selection from 2, first visible 4" % what, ch)
    fresh("hello", 0, 3, clip={"text": "old"}, change=0)
    char("M4 cut, change message 0", 0x18)
    fresh("", 0, 0, clip={"text": "old"}, change=-2)
    char("M4 cut in an empty text, change message -2", 0x18)
    # ---- backspace
    for caret, sel in ((0, 0), (1, 1), (3, 3), (5, 5), (1, 3), (3, 1), (0, 5), (5, 0), (2, 8), (8, 2)):
        for change in (-1, 7):
            fresh("hello", caret, sel, change=change)
            char("M5 backspace, caret %d, selection from %d, change message %d" % (caret, sel, change), 8)
    fresh("hello", 3, 3, sound=False)
    char("M5 backspace without a key sound", 8)
    fresh("hello", 0, 0, sound=False)
    char("M5 backspace at the start, without a key sound", 8)
    fresh("hello", 3, 1, sound=False, change=0)
    char("M5 backspace with a selection, change message 0, without a key sound", 8)
    for caret, sel, first in ((5, 5, 5), (6, 6, 5), (8, 8, 4), (3, 3, 3), (4, 4, 4), (8, 2, 4), (2, 8, 4), (11, 11, 6), (5, 5, 0)):
        fresh("hello world", caret=caret, sel=sel, first=first, rc_text=NARROW)
        char("M5 backspace in a narrow box: caret %d, selection from %d, first visible %d" % (caret, sel, first), 8)
    fresh("a", 1, 1, change=7)
    char("M5 backspace removes the only character", 8)
    fresh("", 0, 0, change=7)
    char("M5 backspace in an empty text", 8)
    # ---- Enter
    for enter in (-1, 0, 5, -2):
        fresh("hello", 2, 4, change=7, enter=enter)
        char("M6 Enter, enter message %d, a selection (the change message is 7)" % enter, 13)
    fresh("hello", 2, 2, change=7, enter=9, sound=False)
    char("M6 Enter without a key sound", 13)
    # ---- Ctrl+V
    for tag, clip in CLIPS + (("holding a line break", {"text": "x\ny"}), ("whose block cannot be locked", {"text": "xyz", "lock_fails": True}),
                              ("holding a NUL inside", {"text": "xy\0z"}), ("holding a long text", {"text": "0123456789" * 3})):
        for caret, sel in ((2, 2), (1, 3), (3, 1), (0, 0), (5, 5)):
            fresh("hello", caret, sel, change=7, clip=clip)
            char("M7 Ctrl+V, clipboard %s, caret %d, selection from %d" % (tag, caret, sel), 0x16)
    for tag, kw in (("length limit 7", {"length_limit": 7}), ("length limit 5 (full)", {"length_limit": 5}), ("width limit 20", {"width_limit": 20}),
                    ("only digits", {"only_num": True}), ("one character mode", {"one_char": True}), ("a buffer of 6", {"size": 6}), ("line limit 1", {"line_limit": 1}),
                    ("auto upper case", {"auto_upper": True}), ("byte limit 7", {"byte_limit": True, "byte_max": 7})):
        for caret, sel in ((2, 2), (1, 3)):
            fresh("hello" if "only" not in tag and "one" not in tag else "12345" if "only" in tag else "a", caret if "one" not in tag else 1, sel if "one" not in tag else 1,
                  change=7, clip={"text": "xyz" if "only" not in tag else "678"}, **kw)
            char("M7 Ctrl+V of 3 characters, %s, caret %d, selection from %d" % (tag, caret, sel), 0x16)
    fresh("hello world", caret=3, sel=3, first=0, rc_text=NARROW, clip={"text": "0123456789"})
    char("M7 Ctrl+V in a narrow box scrolls", 0x16)
    fresh("", 0, 0, clip={"text": "abc"}, size=2)
    char("M7 Ctrl+V into an empty text with room for 1", 0x16)

    # ---- typing: the key sound, the selection replaced, the character inserted (or, with the insert mode off and the caret inside the text, written over
    # the one at the caret), the caret behind it, the blink and the change message in every case (a refused character moves nothing)
    for caret, sel in ((3, 3), (1, 1), (0, 0), (1, 3), (3, 1), (0, 3), (3, 0), (2, 8), (8, 2)):
        for insert in (True, False):
            fresh("abc", caret, sel, insert=insert, change=7)
            char("M8 type x, insert mode %s, caret %d, selection from %d" % (insert, caret, sel), ord("x"))
    fresh("abc", 1, 1, insert=False, sound=False)
    char("M8 type x over the second character, without a key sound", ord("x"))
    for change in (-1, 0, -2):
        fresh("abc", 1, 1, change=change)
        char("M8 type x, change message %d" % change, ord("x"))
    for tag, kw, text, ch in (("length limit 3", {"length_limit": 3}, "abc", "d"), ("length limit 4", {"length_limit": 4}, "abc", "d"),
                              ("only digits", {"only_num": True}, "123", "a"), ("only digits", {"only_num": True}, "123", "4"),
                              ("auto upper case", {"auto_upper": True}, "abc", "x"), ("auto upper case", {"auto_upper": True}, "abc", "7"),
                              ("one character mode", {"one_char": True}, "a", "x"), ("one character mode", {"one_char": True}, "", "x"),
                              ("width limit 30", {"width_limit": 30}, "abc", "x"), ("width limit 22", {"width_limit": 22}, "abc", "x"),
                              ("line limit 1", {"line_limit": 1}, "abc", "x"), ("byte limit 4", {"byte_limit": True, "byte_max": 4}, "abc", "x"),
                              ("byte limit 3", {"byte_limit": True, "byte_max": 3}, "abc", "x"), ("a buffer of 4", {"size": 4}, "abc", "x"),
                              ("a buffer of 5", {"size": 5}, "abc", "x"), ("a buffer of 8", {"size": 8}, "abcdefg", "x")):
        for caret in (0, len(text)):
            if tag == "width limit 22" and caret == 0:
                continue  # the exe would put the line break in front of "abc" and ask again with the same line for ever (its stack overflows)
            fresh(text, caret, caret, change=7, **kw)
            char("M8 type %s, %s, caret %d" % (ch, tag, caret), ord(ch))
    fresh("abc", 1, 1, length_limit=3)
    char("M8 type x over the second character with the length limit reached, insert mode on: refused", ord("x"))
    fresh("abc", 1, 1, length_limit=3, insert=False)
    char("M8 type x over the second character with the length limit reached, insert mode off: written over", ord("x"))
    fresh("abc", 1, 3, length_limit=3)
    char("M8 type x over the selection 1..3 with the length limit reached: the selection goes first", ord("x"))
    for ch in (0, 0x1E, 0x1F, 0x20, 0x4E2D, 0xFFFF, 0xD800):
        for insert in (True, False):
            for caret in (1, 3):
                fresh("abc", caret, caret, insert=insert)
                char("M8 type 0x%04X, insert mode %s, caret %d" % (ch, insert, caret), ch)
    fresh("abc", 1, 3)
    char("M8 type NUL over the selection 1..3", 0)
    fresh("abcd", 2, 2, size=5)
    for ch in (ord("x"), ord("y"), ord("z")):
        char("M8 a text that outgrows its buffer: type %s" % chr(ch), ch)
    # a text that scrolls: the typed character is behind the right edge of the box
    for caret, first in ((5, 0), (6, 0), (8, 3), (11, 6), (3, 3), (4, 4)):
        fresh("hello world", caret=caret, first=first, rc_text=NARROW)
        char("M8 type x in a narrow box: caret %d, first visible %d" % (caret, first), ord("x"))
    fresh("hello world", caret=2, sel=8, first=6, rc_text=NARROW)
    char("M8 type x over the selection 2..8 in a narrow box, first visible 6", ord("x"))
    fresh("", 0, 0)
    for ch in (ord("a"), ord("b"), ord("c")):
        char("M8 type %s into an empty text, one after the other" % chr(ch), ch)
    fresh("abc", 3, 3, change=7)
    for ch in (ord("d"), 8, ord("e"), 8, 8, 8, 8, 8):
        char("M8 a run of keys: 0x%02X" % ch, ch)


    # ================================================================ HandleMouse (32933D80)
    TEXT7 = "abcdefg"  # the prefixes of the oracle's font are 0, 11, 16, 22, 29, 37, 46, 56 wide

    def mouse(case, uMsg, x=50, y=30, caret=1, sel=4, **kw):
        """a box holding TEXT7 with the caret at `caret` (the selection from `sel`) that has the focus (unless `has_focus`); then the message at (x, y)"""
        kw.setdefault("has_focus", True)
        fresh(TEXT7, caret, sel, **kw)
        return hit(case, uMsg, x, y)

    # ---- the gates: the box is enabled (shown or not); a message the box takes
    for tag, kw in (("enabled", {}), ("disabled", {"enable": False}), ("hidden", {"show": False}), ("disabled, hidden", {"enable": False, "show": False})):
        for uMsg in (0x200, 0x201, 0x202, 0x203):
            for focus in (True, False):
                mouse("H1 message 0x%X inside, box %s, %s, dragging" % (uMsg, tag, "focused" if focus else "not focused"), uMsg, drag=True, has_focus=focus, **kw)
    for uMsg in (0x204, 0x205, 0x206, 0x207, 0x208, 0x209, 0x20A, 0x100, 0x102, 0x0, 0x1000, 0x401, 0x80000201, 0x10201, 0x2000201):
        mouse("H1 message 0x%X inside, dragging" % uMsg, uMsg, drag=True)
    # ---- the left button down and the double click: the focus is asked for first, then the point is looked at
    for uMsg in (0x201, 0x203):
        for tag, kw in (("the box has the focus", {"has_focus": True}), ("nobody has the focus", {"has_focus": False}),
                        ("the box has the focus flag, Y the focus", {"has_focus": True, "focus": "Y"}),
                        ("Y has the focus", {"has_focus": False, "focus": "Y"}), ("the box is focused, no flag", {"has_focus": False, "focus": "E"}),
                        ("the box is hidden, nobody has the focus", {"has_focus": False, "show": False}),
                        ("the box is hidden, Y has the focus", {"has_focus": False, "show": False, "focus": "Y"})):
            for where, (x, y) in (("inside", (50, 30)), ("outside", (300, 30)), ("above", (50, 10))):
                focus = kw.get("focus")
                kw2 = {k: v for k, v in kw.items() if k != "focus"}
                fresh(TEXT7, 1, 4, **kw2)
                if focus:
                    o.focus(focus)
                hit("H2 0x%X %s, %s" % (uMsg, where, tag), uMsg, x, y)
    # ---- the point: the box is the dialog's (10, 20)-(110, 40) on the screen
    for uMsg in (0x201, 0x203):
        for x in (9, 10, 11, 60, 109, 110, 111):
            for y in (19, 20, 21, 30, 39, 40, 41):
                if uMsg == 0x203 and x not in (10, 11, 109, 110) and y not in (20, 21, 39, 40):
                    continue
                mouse("H3 0x%X at (%d, %d)" % (uMsg, x, y), uMsg, x, y)
    for x, y in ((0, 0), (-1, -1), (-100, 30), (50, -100), (32767, 30), (50, 32767), (-32768, 30), (50, -32768), (110, 40), (10, 20)):
        mouse("H3 0x201 at (%d, %d)" % (x, y), 0x201, x, y)
    for lParam in (0xFFFFFFFF, 0x80008000, 0x7FFF7FFF, 0, 0x001E0032, 0xFFE2FFE2, 0x0032001E, 0x00010001):
        fresh(TEXT7, 1, 4, has_focus=True)
        hit("H3 0x201, lParam 0x%08X" % lParam, 0x201, lParam=lParam)
    # a dialog left and above of the screen's corner: the points the sign bits of the words make
    for x, y in ((-30, -30), (-61, -30), (-60, -30), (-59, -30), (-30, -41), (-30, -40), (-30, -39), (39, -21), (40, -21), (-30, -20), (-30, -19), (-1, -1)):
        fresh(TEXT7, 1, 4, has_focus=True, dpos=(-60.0, -40.0))
        hit("H3 0x201 at (%d, %d), the dialog at (-60, -40)" % (x, y), 0x201, x, y)
    # a dialog and a box off the whole numbers
    for x, y in ((10, 20), (11, 20), (11, 21), (12, 21), (110, 40), (111, 40), (111, 41), (112, 41), (60, 21), (60, 40)):
        fresh(TEXT7, 1, 4, has_focus=True, dpos=(10.25, 20.5), offset=(0.75, 0.25))
        hit("H3 0x201 at (%d, %d), the dialog at (10.25, 20.5), the offset (0.75, 0.25)" % (x, y), 0x201, x, y)
    # ---- the character under the point: the text from the box's left (the text rectangle's left is 5, so the point x = 5 + 10 is the first character's left edge)
    for x in range(10, 76, 3):
        mouse("H4 0x201 at x %d, caret 1, selection from 4" % x, 0x201, x, 30)
    for x in (10, 12, 15, 16, 17, 20, 21, 22, 26, 27, 32, 33, 38, 39, 40, 45, 50, 60, 75, 100):
        mouse("H4 0x201 at x %d, caret 6, selection from 2, first visible 2" % x, 0x201, x, 30, caret=6, sel=2, first=2)
    for left in (0, 20, -6, 5):
        for x in (10, 20, 30, 40, 50, 60):
            mouse("H4 0x201 at x %d, the text rectangle's left is %d" % (x, left), 0x201, x, 30, rc_text=(left, 0, 85, 20))
    for first in (0, 1, 3, 5, 7):
        for x in (12, 25, 40, 70):
            mouse("H4 0x201 at x %d, first visible %d" % (x, first), 0x201, x, 30, first=first, caret=first, sel=first)
    for x in (10, 30, 50, 80, 100):
        fresh("", 0, 0, has_focus=True)
        hit("H4 0x201 at x %d in an empty text" % x, 0x201, x, 30)
    for x in (12, 25, 45, 60, 90):
        mouse("H4 0x201 at x %d in a narrow box, first visible 3" % x, 0x201, x, 30, rc_text=NARROW, first=3, caret=3, sel=3)
    for x in (40, 60, 109):
        fresh("hello world again", 2, 6, has_focus=True, rc_text=NARROW, first=5)
        hit("H4 0x201 at x %d in a long text, narrow box, first visible 5" % x, 0x201, x, 30)
    # ---- the move: while the box drags the caret follows the mouse (the selection keeps its start), outside the box too
    for x, y in ((10, 30), (20, 30), (27, 30), (40, 30), (70, 30), (300, 30), (-50, 30), (50, 200), (50, -200)):
        mouse("H5 0x200 at (%d, %d), dragging, caret 2, selection from 5" % (x, y), 0x200, x, y, caret=2, sel=5, drag=True)
    for x in (30, 70, 300):
        mouse("H5 0x200 at x %d, not dragging" % x, 0x200, x, 30, caret=2, sel=5, drag=False)
    for x in (12, 30, 60, 90, 105):
        mouse("H5 0x200 at x %d, dragging, a narrow box, first visible 2" % x, 0x200, x, 30, caret=3, sel=3, first=2, drag=True, rc_text=NARROW)
    for x in (30, 70):
        mouse("H5 0x200 at x %d, dragging, no focus flag" % x, 0x200, x, 30, caret=2, sel=5, drag=True, has_focus=False)
    # ---- the button up: the mouse is released, the drag is over
    for drag in (True, False):
        for focus in (True, False):
            for x, y in ((50, 30), (300, 300)):
                mouse("H6 0x202 at (%d, %d), %s, %s" % (x, y, "dragging" if drag else "not dragging", "focused" if focus else "not focused"), 0x202, x, y, drag=drag, has_focus=focus)
    # ---- a drag from the click to the release
    fresh(TEXT7, 1, 4, has_focus=False)
    hit("H7 click at x 30 (the box takes the focus)", 0x201, 30, 30)
    hit("H7 move to x 60", 0x200, 60, 30)
    hit("H7 move to x 15", 0x200, 15, 30)
    hit("H7 release at x 15", 0x202, 15, 30)
    hit("H7 move to x 60 after the release", 0x200, 60, 30)
    # ---- the scale of the back buffer: the position divides by it and is cut (toward zero)
    for scale, xs, ys in (((1.5, 0.75), (14, 15, 16, 30, 90, 164, 165, 166), (14, 15, 16, 29, 30, 31)), ((0.75, 1.25), (7, 8, 9, 30, 62, 82, 83), (24, 25, 26, 49, 50, 51)),
                          ((2.0, 0.5), (19, 20, 21, 90, 219, 220, 221), (9, 10, 11, 19, 20, 21))):
        for x in xs:
            for y in ys:
                if len(xs) * len(ys) > 30 and (x, y) != (xs[len(xs) // 2], ys[len(ys) // 2]) and x not in (xs[1], xs[2], xs[-3], xs[-2]) and y not in (ys[1], ys[2], ys[-3], ys[-2]):
                    continue
                mouse("H8 0x201 at (%d, %d), scale (%g, %g)" % (x, y, *scale), 0x201, x, y, scale=scale)
    for scale in ((1.5, 0.75), (0.75, 1.25)):
        for x in (16, 25, 30, 38, 45, 52, 60, 75, 90, 100, 120):
            mouse("H8 0x201 at x %d, scale (%g, %g): the character under it" % (x, *scale), 0x201, x, 30, scale=scale)
        for x in (-31, -20, -1, -2):
            fresh(TEXT7, 1, 4, has_focus=True, dpos=(-60.0, -40.0), scale=scale)
            hit("H8 0x201 at (%d, %d), scale (%g, %g), the dialog at (-60, -40): cut toward zero" % (x, x, *scale), 0x201, x, x)
        for x in (30, 70):
            mouse("H8 0x200 at x %d, dragging, scale (%g, %g)" % (x, *scale), 0x200, x, 30, scale=scale, drag=True, caret=2, sel=5)

    # ================================================================ OnFocusOut (32934290)
    for focus in (True, False):
        for msg in (-1, 0, 5, -2, 0x7FFFFFFF):
            for tag, glob in (("the box holds the focus", "E"), ("nobody holds it", None), ("Y holds it", "Y")):
                fresh("abc", has_focus=focus, focus_out=msg, change=7)
                if glob:
                    o.focus(glob)
                o.act("O1 OnFocusOut, flag %d, focus-out message %d, %s" % (focus, msg, tag), "E", "out")
    fresh("abc", has_focus=True, focus_out=5, enable=False)
    o.act("O1 OnFocusOut of a disabled box", "E", "out")
    fresh("abc", has_focus=True, focus_out=5, show=False, drag=True, caret_on=True)
    o.act("O1 OnFocusOut of a hidden box that drags and shows its caret", "E", "out")
    fresh("abc", has_focus=True, focus_out=5, sound=False)
    o.act("O1 OnFocusOut of a box without a sound", "E", "out")

    # ================================================================ the members the scripts do not reach
    # ---- ContainPTForEditBox (329331C0): the point is inside the current quad moved by the dialog and the offset
    QUADS = (
        ("rectangle", [(0, 0), (100, 0), (0, 20), (100, 20)]),
        ("parallelogram", [(10, 0), (110, 0), (0, 20), (100, 20)]),
        ("trapezoid", [(20, 0), (80, 0), (0, 20), (100, 20)]),
        ("mirrored", [(100, 0), (0, 0), (100, 20), (0, 20)]),
        ("upside down", [(0, 20), (100, 20), (0, 0), (100, 0)]),
        ("a line", [(0, 0), (100, 0), (0, 0), (100, 0)]),
        ("a point", [(5, 5), (5, 5), (5, 5), (5, 5)]),
        ("a bow tie", [(0, 0), (100, 20), (0, 20), (100, 0)]),
        ("fractions", [(0.5, 0.25), (99.75, 0.5), (0.25, 19.5), (100.5, 20.75)]),
    )
    POINTS = ((10, 20), (60, 30), (110, 40), (10, 40), (110, 20), (9, 30), (111, 30), (60, 19), (60, 41), (35, 22), (95, 38), (20, 21), (105, 21), (0, 0), (-5, -5), (300, 300))
    for name, quad in QUADS:
        for x, y in POINTS:
            o.reset()
            o.dialog_("D")
            o.managed_("D", True)
            o.control_("Y", "D", rect=(200, 0, 240, 40))
            o.edit_("E", "D", text="abc", quad=quad)
            o.register("D", ["E", "Y"])
            o.key_states({})
            o.timer(100.5, 0.25)
            o.act("C1 ContainPT at (%d, %d), %s" % (x, y, name), "E", "contain", x, y)
    for dpos, offset in (((10.25, 20.5), (0.75, 0.25)), ((-60.0, -40.0), (0.0, 0.0)), ((0.0, 0.0), (10.0, 20.0)), ((10.0, 20.0), (-10.0, -20.0)),
                         ((0.1, 0.2), (0.3, 0.4)), ((1e7, 1e7), (0.5, 0.5))):
        for x, y in ((10, 20), (11, 21), (60, 30), (110, 40), (111, 41), (0, 0), (10000000, 10000000), (10000001, 10000001), (-60, -40), (-59, -39), (40, -20)):
            fresh("abc", dpos=dpos, offset=offset)
            o.act("C2 ContainPT at (%d, %d), the dialog at (%g, %g), the offset (%g, %g)" % (x, y, *dpos, *offset), "E", "contain", x, y)
    # a point that is not on the screen: sums that overflow a float
    for quad, dpos in (([(3e38, 0), (3e38, 0), (3e38, 20), (3e38, 20)], (3e38, 20.0)), ([(0, 0), (100, 0), (0, 20), (100, 20)], (3e38, 3e38)),
                       ([(-3e38, -3e38), (3e38, -3e38), (-3e38, 3e38), (3e38, 3e38)], (0.0, 0.0)), ([(-3e38, -3e38), (3e38, -3e38), (-3e38, 3e38), (3e38, 3e38)], (3e38, 3e38)),
                       ([(1e30, 1e30), (2e30, 1e30), (1e30, 2e30), (2e30, 2e30)], (0.0, 0.0))):
        for x, y in ((0, 0), (50, 30), (-1000, 1000), (0x7FFFFFFF, 0x7FFFFFFF), (-0x80000000, -0x80000000)):
            o.reset()
            o.dialog_("D", pos=dpos)
            o.managed_("D", True)
            o.control_("Y", "D", rect=(200, 0, 240, 40))
            o.edit_("E", "D", text="abc", quad=quad)
            o.register("D", ["E", "Y"])
            o.key_states({})
            o.timer(100.5, 0.25)
            o.act("C3 ContainPT at (%d, %d), the quad %s, the dialog at %s" % (x, y, quad[0], dpos), "E", "contain", x & 0xFFFFFFFF, y & 0xFFFFFFFF)

    # ---- PlaceCaret (32934A00): the first visible character follows the caret
    LONG = "hello world again"
    for cp in (0, 1, 4, 5, 6, 8, 10, 12, 16, 17, 18, 20):
        for first in (0, 3, 6, 10):
            fresh(LONG, 2, 2, first=first, rc_text=NARROW)
            o.act("P1 PlaceCaret(%d), first visible %d, a narrow box" % (cp, first), "E", "place", cp)
    for cp in (0, 2, 3, 5, 6):
        for first in (0, 2, 3, 5):
            fresh("abcde", 1, 1, first=first)
            o.act("P1 PlaceCaret(%d), first visible %d, a wide box" % (cp, first), "E", "place", cp)
    for left, right in ((5, 85), (0, 40), (0, 7), (10, 12), (30, 30), (40, 30)):
        for cp in (0, 3, 6, 9, 17):
            fresh(LONG, 2, 4, first=2, rc_text=(left, 0, right, 20))
            o.act("P1 PlaceCaret(%d), the text rectangle %d..%d, first visible 2" % (cp, left, right), "E", "place", cp)
    fresh("", 0, 0)
    o.act("P1 PlaceCaret(0) in an empty text", "E", "place", 0)
    fresh("", 0, 0)
    o.act("P1 PlaceCaret(3) in an empty text", "E", "place", 3)
    for scale in ((1.5, 0.75), (0.75, 1.25)):
        for cp in (0, 4, 9, 17):
            fresh(LONG, 2, 2, first=1, rc_text=NARROW, scale=scale)
            o.act("P1 PlaceCaret(%d), scale (%g, %g)" % (cp, *scale), "E", "place", cp)
    # ---- ClearText (32933190)
    for text, caret, sel, first in (("hello", 3, 1, 2), ("", 0, 0, 0), ("hello world again", 17, 4, 9), ("a", 1, 1, 1)):
        fresh(text, caret, sel, first=first, rc_text=NARROW)
        o.act("X1 ClearText of %r, caret %d, selection from %d, first visible %d" % (text, caret, sel, first), "E", "clear")
    # ---- DeleteSelectionText (32933540)
    for caret, sel, first in ((2, 8, 0), (8, 2, 0), (3, 3, 0), (0, 17, 0), (17, 0, 9), (6, 12, 6), (12, 6, 9), (5, 5, 3), (16, 17, 10), (17, 16, 10), (0, 0, 0)):
        fresh(LONG, caret, sel, first=first, rc_text=NARROW, change=7)
        o.act("X2 DeleteSelectionText, caret %d, selection from %d, first visible %d" % (caret, sel, first), "E", "delete")
    for caret, sel, first in ((3, 30, 0), (30, 3, 0), (5, 9, 0), (9, 5, 2), (7, 7, 0)):
        fresh("hello", caret, sel, first=first, change=7)
        o.act("X2 DeleteSelectionText of hello, caret %d, selection from %d (beyond the text), first visible %d" % (caret, sel, first), "E", "delete")
    # ---- CopyToClipboard (32933460)
    # (a selection of more characters than the text has would write behind the block the exe asks for: no scene; one that ends at the text's NUL is the
    # last that fits)
    for caret, sel in ((1, 3), (3, 1), (0, 5), (5, 0), (2, 2), (0, 0), (5, 5), (1, 6), (6, 1), (4, 6), (1, 5)):
        for tag, clip in (("holding old", {"text": "old"}), ("holding nothing", {}), ("busy", {"text": "old", "busy": True})):
            fresh("hello", caret, sel, clip=clip)
            o.act("X3 CopyToClipboard, caret %d, selection from %d, clipboard %s" % (caret, sel, tag), "E", "copy")
    fresh("", 0, 0, clip={"text": "old"})
    o.act("X3 CopyToClipboard of an empty text", "E", "copy")
    # ---- PasteFromClipboard (32934970)
    for caret, sel in ((2, 2), (1, 3), (3, 1), (0, 0), (5, 5), (0, 5), (5, 0)):
        for tag, clip in (("xyz", {"text": "xyz"}), ("nothing", {}), ("busy", {"text": "xyz", "busy": True}), ("a block that cannot be locked", {"text": "xyz", "lock_fails": True}),
                          ("an empty text", {"text": ""}), ("two lines", {"text": "x\ny"}), ("a NUL inside", {"text": "x\0y"})):
            fresh("hello", caret, sel, clip=clip, change=7)
            o.act("X4 PasteFromClipboard, caret %d, selection from %d, clipboard holds %s" % (caret, sel, tag), "E", "paste")
    for tag, kw in (("length limit 7", {"length_limit": 7}), ("length limit 5", {"length_limit": 5}), ("a buffer of 7", {"size": 7}), ("one character mode", {"one_char": True})):
        for caret, sel in ((2, 2), (1, 3), (5, 5)):
            fresh("hello", caret, sel, clip={"text": "xyz"}, **kw)
            o.act("X4 PasteFromClipboard of xyz, %s, caret %d, selection from %d" % (tag, caret, sel), "E", "paste")
    fresh("hello world again", 2, 2, first=0, rc_text=NARROW, clip={"text": "0123456789"})
    o.act("X4 PasteFromClipboard in a narrow box", "E", "paste")
    fresh("hello world again", 12, 3, first=6, rc_text=NARROW, clip={"text": "01234"})
    o.act("X4 PasteFromClipboard over a selection in a narrow box", "E", "paste")

    return o


if __name__ == "__main__":
    o = main()
    if "--json" in sys.argv:
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w", encoding="utf-8") as fh:  # one step per line
            fh.write("[\n" + ",\n".join(json.dumps(step, ensure_ascii=False) for step in o.script) + "\n]\n")
