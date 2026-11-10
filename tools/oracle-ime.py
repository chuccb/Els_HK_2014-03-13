#!/usr/bin/env python3
"""
The input of the IME edit box (`CKTDGUIIMEEditBox`) of x2.exe on the Unicorn CPU emulator: the oracle of `CKTDGUIIMEEditBox.msgProc`, `ebProc`,
`handleKeyboard`, `handleMouse`, `onFocusIn`, `onFocusOut`, `CheckToggleState`, `ClearText`, `DeleteSelectionText`, `CopyToClipboard`,
`PasteFromClipboard`, `GetNowText`, `SendCompString`, `SendKey`, `GetPrev/NextIMEEditBox` (packages/ui/src/imeeditbox.ts; tested by
packages/ui/test/ime-input.test.ts, which replays packages/ui/test/ime-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-ime.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-ime.py --json FILE    (and writes the script and the exe's answers to FILE)

It is the edit box oracle (tools/oracle-edits.py: the dialog, the stage, the focus probe, the clipboard, the keys, the timer) with the IME box in place of
the plain one: the real vtable (0x334AF7F0: MsgProc slot 6 = 329387A0, HandleKeyboard 7 = 32937C10, HandleMouse 8 = 32937EF0, OnFocusIn 9 = 329391F0,
OnFocusOut 10 = 329392A0) or the members by address.  What the box asks of the window system is answered by stubs that write the call down (the contract the
replay keeps in every scene):
  * USER32: `kbl` (GetKeyboardLayout), `aks(vk)` (GetAsyncKeyState), `focus` (GetFocus), `post(hwnd,msg,wParam,lParam)`, `send(msg,wParam,lParam)` (to the
    app's window), `keybd(vk,flags)` (keybd_event), `loc(lcid)` (GetLocaleInfoW: the three letters of the language);
  * imm32 (the exe's function-pointer table at 0x33625D4C, rewritten to the stubs): `imm.get` (ImmGetContext), `imm.release(himc)`, `imm.assoc(himc)`,
    `imm.notify(himc,action,index,value)`, `imm.isime(hkl)`, `imm.open(himc)`, `imm.conv(himc)`, `imm.file(hkl)` (ImmGetIMEFileNameA: no file),
    `imm.comp(himc,index,bytes)` (ImmGetCompositionStringW: what the scene's `imm` says the IME has) and `imm.cand(himc,index,bytes)` (ImmGetCandidateListW);
    `kll(count)` (GetKeyboardLayoutList) and `lang(lcid)` (GetLocaleInfoW: the name of the language); PtInRect is answered with its definition and not written
    down, and so are the heap (HeapAlloc, HeapFree), `realloc` and `__stdio_common_vswprintf` the strsafe functions of the exe run on.
The statics of the class (the IME system: `s_bEnableImeSystem`, the composition string, the candidate list, the layout ...) are in the emulated memory at their
addresses (0x33641750 on); `ime_state` sets them for a scene, and the state written down after a call has the ones that matter.
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


oe = load("oracle_edits", "oracle-edits.py")
ol, ou, ob, oc, oi, om = oe.ol, oe.ou, oe.ob, oe.oc, oe.oi, oe.om
EAX = oi.EAX
esc, lp = oe.esc, oe.lp
APP_HWND = oi.APP_HWND

PROCESS_HEAP = 0x00A10000  # what GetProcessHeap answers
IME_VTABLE, UCT_IME = 0x334AF7F0, 4
IME_MSG_PROC, IME_HANDLE_KEYBOARD, IME_HANDLE_MOUSE, IME_ON_FOCUS_IN, IME_ON_FOCUS_OUT = 0x329387A0, 0x32937C10, 0x32937EF0, 0x329391F0, 0x329392A0
BUFFER = 0x2BC  # m_Buffer in the box
om.VTABLE["Ime"], om.UCT["Ime"] = IME_VTABLE, UCT_IME
oc.HANDLERS["ime"] = IME_HANDLE_MOUSE
oc.MSG_PROCS["ime"] = (6, IME_MSG_PROC)

SLOTS = {  # the virtual functions: name -> (slot, the exe's function, the number of arguments, whether the window handle comes first)
    "key": (7, IME_HANDLE_KEYBOARD, 3, False), "msg": (6, IME_MSG_PROC, 3, True), "mouse": (8, IME_HANDLE_MOUSE, 5, False), "in": (9, IME_ON_FOCUS_IN, 0, False),
    "out": (10, IME_ON_FOCUS_OUT, 0, False),
}
CALLS = {  # the members called by address: name -> (address, the number of arguments, what it answers: bool | None)
    "ebproc": (0x32936A30, 3, True), "contain": (0x329331C0, 2, True), "clear": (0x32936370, 0, False), "delete": (0x32936480, 0, False),
    "copy": (0x329363A0, 0, False), "paste": (0x32939AC0, 0, False), "place": (0x32939B50, 1, False), "sendcomp": (0x3293AA90, 0, False),
    "korean": (0x32938780, 0, True), "prev": (0x32937300, 0, "box"), "next": (0x32937150, 0, "box"), "trunc": (0x3293B3A0, 2, False),
}
CDECLS = {  # called without a box: name -> (address, the number of arguments, whether it answers a char)
    "toggle": (0x329361B0, 0, False), "sendkey": (0x3293AB00, 1, False), "static": (0x3293AF10, 2, True), "private": (0x329373A0, 0, False),
    "imeid": (0x32936EA0, 1, "u32"),
}
# ---- the statics of CKTDGUIIMEEditBox
S = {
    "hDllImm32": 0x33641750, "hDllVer": 0x33641754, "hImcDef": 0x33641758, "hklCurrent": 0x3364175C, "verticalCand": 0x33641760, "insertOnType": 0x33641761,
    "enable": 0x33641762, "showReading": 0x33641763, "hDllIme": 0x33641764, "imeState": 0x33641768, "ptComp": 0x3364176C, "compCaret": 0x33641774,
    "firstTarget": 0x33641778, "horizontalReading": 0x3364177C, "chineseIme": 0x3364177D, "createDeviceCheck": 0x3364177E, "hideCaret": 0x3364177F,
    "compAttr": 0x33641780, "compClause": 0x33641880, "readingString": 0x33641C80, "compString": 0x33641CC0, "candList": 0x33641E90, "horiCand": 0x33643290,
    "locale": 0x33643488, "readingEntries": 0x33625D9C,
    "candFirstSelected": 0x3364345C, "candHoriLen": 0x33643460, "candCount": 0x33643464, "candSelection": 0x33643468, "candPageSize": 0x3364346C,
    "candReadingError": 0x33643470, "candShow": 0x33643474, "candRect": 0x33643478,
    "currIndicator": 0x33625DB0, "indicators": 0x33625DB4, "lAlt": 0x33625DD4, "lCtrl": 0x33625DD8, "lShift": 0x33625DDC, "hklToggle": 0x336434A0,
    "focusOutBusy": 0x336434A4, "hklPrev": 0x33643494, "dwID": 0x33643498,
}
IMM = {  # the exe's function pointers for imm32.dll: name -> (address of the variable, the number of stdcall arguments)
    "GetCompositionString": (0x33625D60, 4), "GetCandidateList": (0x33625D64, 4), "GetContext": (0x33625D68, 1), "ReleaseContext": (0x33625D6C, 2), "AssociateContext": (0x33625D70, 2), "GetOpenStatus": (0x33625D74, 1),
    "GetConversionStatus": (0x33625D7C, 3), "NotifyIME": (0x33625D8C, 4), "IsIME": (0x33625D98, 1), "GetIMEFileName": (0x33625D84, 3),
}
USER = {  # the imports the box calls: name -> (the IAT slot, the number of stdcall arguments)
    "GetAsyncKeyState": (0x3348F5F0, 1), "GetFocus": (0x3348F658, 0), "keybd_event": (0x3348F65C, 4), "GetKeyboardLayout": (0x3348F654, 1),
    "PtInRect": (0x3348F628, 3), "PostMessageW": (0x3362EAF0, 4), "SendMessageW": (0x3362EAF8, 4), "GetLocaleInfoW": (0x3362EA60, 4),
    "GetKeyboardLayoutList": (0x3348F650, 2), "HeapAlloc": (0x3348F160, 3), "GetProcessHeap": (0x3348F17C, 0), "HeapFree": (0x3348F0E0, 3),
}
REALLOC, VSWPRINTF = 0x3348F834, 0x3348F9E0  # the C runtime imports (cdecl) the growable array and StringCchPrintfW call
TOWLOWER = 0x3348FA0C
LOCALES = {  # GetLocaleInfoW(lcid, LOCALE_SABBREVLANGNAME): the three letters of the language (the default of a scene; the replay has the same table)
    0x0409: "ENU", 0x0404: "CHT", 0x0804: "CHS", 0x0411: "JPN", 0x0412: "KOR", 0x0C04: "ZHH", 0x0407: "DEU", 0x040C: "FRA", 0x1004: "ZHI", 0x0419: "RUS", 0x0001: "x",
}
LANGUAGES = {  # GetLocaleInfoW(lcid, LOCALE_SLANGUAGE): the name of the language (the default of a scene; the replay has the same table)
    0x0409: "English (United States)", 0x0404: "Chinese (Traditional, Taiwan)", 0x0804: "Chinese (Simplified, PRC)", 0x0411: "Japanese", 0x0412: "Korean",
    0x0C04: "Chinese (Traditional, Hong Kong S.A.R.)", 0x0407: "German (Germany)", 0x040C: "French (France)", 0x1004: "Chinese (Simplified, Singapore)",
    0x0419: "Russian", 0x0001: "Arabic",
}
KEYBOARD_EXTRA_ENTER, KEYBOARD_LOCKS = 0x560, 0x118
IME_STATE_KEYS = (
    "hasFocus", "focus", "text", "caret", "selstart", "first", "insert", "caretOn", "blink", "mdrag", "size", "analyse", "clip",
    "hide", "comp", "ccaret", "imeState", "hkl", "vert", "chinese", "ind", "lalt", "lctrl", "lshift", "extra", "lock", "toggle", "busy", "attr", "ids",
)
# the keys a scene can ask for in addition (`act(.., keys=..)`): the insert-on-type flag, the reading window, the candidate list (its numbers, its ten
# texts, its line), the clauses, the list of the keyboard layouts, the five indicators, the last 16 attributes and the last 4 clauses
EXTRA_STATE_KEYS = ("ins", "read", "cand", "texts", "hori", "clause", "locale", "inds", "attrtail", "clausetail")


def u32(v):
    return v & 0xFFFFFFFF


def comp_data(cursor=None, string=None, result=None, attr=None, clause=None):
    """what `ImmGetCompositionStringW` has by index (GCS_*): `cursor` (0x80: an int, the position or an error), `string` (8) and `result` (0x800) as text
    or as the raw bytes (or an int: the error), `attr` (0x10: bytes), `clause` (0x20: the numbers); what is left out is nothing (the answer 0)"""
    out = {}
    if cursor is not None:
        out[0x80] = cursor
    for index, text in ((8, string), (0x800, result)):
        if text is not None:
            out[index] = text if isinstance(text, (bytes, int)) else text.encode("utf-16-le", "surrogatepass")
    if attr is not None:
        out[0x10] = bytes(attr)
    if clause is not None:
        out[0x20] = b"".join(struct.pack("<I", c) for c in clause)
    return out


def cand_list(texts, selection=0, page_start=0, page_size=10, count=None, style=0):
    """a CANDIDATELIST as `ImmGetCandidateListW` writes it: dwSize, dwStyle, dwCount (the number of texts unless `count`), dwSelection, dwPageStart,
    dwPageSize and the offsets of the strings (UTF-16, NUL-ended) behind them"""
    count = len(texts) if count is None else count
    head = 0x18 + 4 * max(1, len(texts))
    blobs = [t.encode("utf-16-le", "surrogatepass") + b"\0\0" for t in texts]
    offsets, at = [], head
    for blob in blobs:
        offsets.append(at)
        at += len(blob)
    offsets += [0] * (max(1, len(texts)) - len(texts))
    return struct.pack("<6I", at, style, count, u32(selection), page_start, page_size) + b"".join(struct.pack("<I", o) for o in offsets) + b"".join(blobs)


def s32(v):
    v &= 0xFFFFFFFF
    return v - (1 << 32) if v & 0x80000000 else v


def comp_text(o, c):
    data = o.emu.u32(S["compString"] + 0xC)
    return "null" if data == 0 else esc(o.wstr(data))


def indicator(o, c):
    pointer = o.emu.u32(S["currIndicator"])
    return "%d:%s" % ((pointer - S["indicators"]) // 6, esc(o.wstr(pointer)))


def flag(address):
    return lambda o, c: str(o.b(address))


def locale_state(o, c):
    data, size = o.emu.u32(S["locale"]), o.emu.u32(S["locale"] + 4)
    out = []
    for i in range(size):
        p = data + 0x8C * i
        out.append("%d/%s/%s" % (u32(o.emu.u32(p)), esc(o.wstr(p + 4)), esc(o.wstr(p + 10))))
    return "%d:%s" % (size, ";".join(out))


oc.STATE_KEYS["ime"] = IME_STATE_KEYS
oc.FIELD_OFFSETS["ime"] = {
    "text": lambda o, c: "null" if o.emu.u32(c + BUFFER + 0xC) == 0 else esc(o.wstr(o.emu.u32(c + BUFFER + 0xC))),
    "caret": (0x4AC, "i"), "selstart": (0x4B4, "i"), "first": (0x4B8, "i"), "insert": 0x4B0, "caretOn": 0x4A8, "blink": (0x4A0, "d"), "mdrag": 0x4D8,
    "size": (BUFFER, "i"), "analyse": BUFFER + 0xFC, "clip": lambda o, c: "null" if o.clip is None else esc(o.clip),
    "hide": flag(S["hideCaret"]), "comp": comp_text, "ccaret": lambda o, c: str(s32(o.emu.u32(S["compCaret"]))),
    "imeState": lambda o, c: str(o.emu.u32(S["imeState"])), "hkl": lambda o, c: str(u32(o.emu.u32(S["hklCurrent"]))),
    "vert": flag(S["verticalCand"]), "chinese": flag(S["chineseIme"]), "ind": indicator,
    "lalt": lambda o, c: str(u32(o.emu.u32(S["lAlt"]))), "lctrl": lambda o, c: str(u32(o.emu.u32(S["lCtrl"]))),
    "lshift": lambda o, c: str(u32(o.emu.u32(S["lShift"]))),
    "extra": lambda o, c: str(o.emu.u32(o.keyboard + KEYBOARD_EXTRA_ENTER)), "lock": lambda o, c: str(o.emu.u32(o.keyboard + KEYBOARD_LOCKS + 4 * 0x1C)),
    "toggle": lambda o, c: str(u32(o.emu.u32(S["hklToggle"]))), "busy": flag(S["focusOutBusy"]),
    "attr": lambda o, c: o.emu.read(S["compAttr"], 12).hex(),
    "ids": lambda o, c: "%d:%d,%d" % struct.unpack("<3I", o.emu.read(S["hklPrev"], 12)),
    "ins": flag(S["insertOnType"]),
    "read": lambda o, c: "%d,%d,%s" % (o.b(S["showReading"]), o.b(S["horizontalReading"]), esc(o.wstr(S["readingString"]))),
    "cand": lambda o, c: "%d,%d,%d,%d,%d,%d,%d" % (
        u32(o.emu.u32(S["candCount"])), u32(o.emu.u32(S["candSelection"])), u32(o.emu.u32(S["candPageSize"])), s32(o.emu.u32(S["candReadingError"])),
        o.b(S["candShow"]), s32(o.emu.u32(S["candFirstSelected"])), s32(o.emu.u32(S["candHoriLen"]))),
    "texts": lambda o, c: "|".join(esc(o.wstr(S["candList"] + 512 * i)) for i in range(10)),
    "hori": lambda o, c: "null" if o.emu.u32(S["horiCand"] + 0xC) == 0 else esc(o.wstr(o.emu.u32(S["horiCand"] + 0xC))),
    "clause": lambda o, c: ",".join(str(v) for v in struct.unpack("<12I", o.emu.read(S["compClause"], 48))),
    "locale": locale_state,
    "inds": lambda o, c: "|".join(esc(o.wstr(S["indicators"] + 6 * k)) for k in range(5)),
    "attrtail": lambda o, c: o.emu.read(S["compAttr"] + 0xF0, 16).hex(),
    "clausetail": lambda o, c: ",".join(str(v) for v in struct.unpack("<4I", o.emu.read(S["compClause"] + 0x3F0, 16))),
}


class ImeOracle(oe.EditOracle):
    def __init__(self):
        super().__init__()
        emu = self.emu
        # ResetCompositionString (3293AA60) runs as the exe has it here (the dialog scenes' oracle puts a stub that only writes the call down)
        emu.write(0x3293AA60, emu.pe.get_data(0x3293AA60 - emu.base, 5))
        self.keyboard = None
        # what the window system answers (the scene sets it: `window`, `imm`)
        self.hkl, self.async_keys, self.focus_window, self.locales = 0x04090409, {}, 0, dict(LOCALES)
        self.himc, self.is_ime, self.open_status, self.conv_status = 0, False, False, (1, 0)
        self.imc_assoc = 0
        self.layouts, self.languages, self.comp, self.cand = [0x04090409], dict(LANGUAGES), {}, None
        user = {
            "GetAsyncKeyState": self._get_async_key_state, "GetFocus": self._get_focus, "keybd_event": self._keybd_event,
            "GetKeyboardLayout": self._get_keyboard_layout, "PtInRect": self._pt_in_rect, "PostMessageW": self._post_message, "SendMessageW": self._send_message,
            "GetLocaleInfoW": self._get_locale_info, "GetKeyboardLayoutList": self._get_keyboard_layout_list, "HeapAlloc": self._heap_alloc,
            "GetProcessHeap": self._get_process_heap, "HeapFree": self._heap_free,
        }
        for name, (slot, n) in USER.items():
            emu.hook(emu.stub(slot, b"\xC3" if n == 0 else b"\xC2" + struct.pack("<H", 4 * n)), user[name])
        imm = {
            "GetContext": self._imm_get_context, "ReleaseContext": self._imm_release_context, "AssociateContext": self._imm_associate_context,
            "GetOpenStatus": self._imm_get_open_status, "GetConversionStatus": self._imm_get_conversion_status, "NotifyIME": self._imm_notify_ime,
            "IsIME": self._imm_is_ime, "GetIMEFileName": self._imm_get_ime_file_name, "GetCompositionString": self._imm_get_composition_string,
            "GetCandidateList": self._imm_get_candidate_list,
        }
        for name, (var, n) in IMM.items():
            emu.hook(emu.stub(var, b"\xC2" + struct.pack("<H", 4 * n)), imm[name])
        emu.hook(emu.stub(TOWLOWER, b"\xC3"), self._towlower)
        emu.hook(emu.stub(REALLOC, b"\xC3"), self._realloc)
        emu.hook(emu.stub(VSWPRINTF, b"\xC3"), self._vswprintf)
        self.mark = emu.heap_ptr
        self.extra_keys = ()
        self.only = tuple(name for name in os.environ.get("ONLY", "").split(",") if name)  # (for developing scenes: the cases that start with one of these)

    # ---- the window system's answers
    def _ret(self, v):
        self.emu.set_reg(EAX, u32(v))

    def _get_async_key_state(self, emu):
        (vk,) = emu.args(1)
        self.log("aks(%d)" % vk)
        self._ret(self.async_keys.get(vk, 0))

    def _get_focus(self, emu):
        self.log("focus")
        self._ret(self.focus_window)

    def _keybd_event(self, emu):
        vk, scan, flags, extra = emu.args(4)
        # `bVk` and `bScan` are BYTEs: the exe pushes the key it kept in a byte of its frame as a whole dword (the three bytes above it are whatever the stack held)
        assert scan & 0xFF == 0 and extra == 0, (scan, extra)
        self.log("keybd(%d,%d)" % (vk & 0xFF, flags))

    def _get_keyboard_layout(self, emu):
        (thread,) = emu.args(1)
        assert thread == 0
        self.log("kbl")
        self._ret(self.hkl)

    def _pt_in_rect(self, emu):
        rc, x, y = emu.args(3)
        left, top, right, bottom = struct.unpack("<4i", emu.read(rc, 16))
        x, y = s32(x), s32(y)
        self._ret(1 if left <= x < right and top <= y < bottom else 0)

    def _post_message(self, emu):
        hwnd, msg, wparam, lparam = emu.args(4)
        self.log("post(%d,%d,%d,%d)" % (hwnd, msg, wparam, lparam))
        self._ret(1)

    def _send_message(self, emu):
        hwnd, msg, wparam, lparam = emu.args(4)
        assert hwnd == APP_HWND, hex(hwnd)
        self.log("send(%d,%d,%d)" % (msg, wparam, lparam))
        self._ret(0)

    def _get_locale_info(self, emu):
        lcid, kind, buf, count = emu.args(4)
        if kind == 3:  # LOCALE_SABBREVLANGNAME: CheckToggleState gives room for 5 characters, the list of the keyboard layouts for 128
            assert count in (5, 0x80), count
            self.log("loc(%d)" % lcid)
            table = self.locales
        else:  # LOCALE_SLANGUAGE
            assert kind == 2 and count == 0x80, (kind, count)
            self.log("lang(%d)" % lcid)
            table = self.languages
        if lcid not in table:  # a failing call writes nothing: the list of the layouts zeroed its buffer first, CheckToggleState did not
            assert count == 0x80, "a failing call leaves the buffer of 5 characters as the stack had it"
            self._ret(0)
            return
        name = table[lcid]
        emu.write(buf, name.encode("utf-16-le") + b"\0\0")
        self._ret(len(name) + 1)

    def _get_keyboard_layout_list(self, emu):
        count, buf = emu.args(2)
        if count == 0:  # (the count of the layouts; the second call of an empty list has a buffer, which a count of 0 does not write)
            assert buf == 0 or not self.layouts
            self.log("kll(0)")
            self._ret(len(self.layouts))
            return
        self.log("kll(%d)" % count)
        n = min(count, len(self.layouts))
        emu.write(buf, b"".join(struct.pack("<I", u32(h)) for h in self.layouts[:n]))
        self._ret(n)

    def _heap_alloc(self, emu):
        heap, flags, size = emu.args(3)
        assert heap == PROCESS_HEAP and flags == 0, (hex(heap), flags)
        self._ret(emu.alloc(max(size, 1), 16))

    def _get_process_heap(self, emu):
        self._ret(PROCESS_HEAP)

    def _heap_free(self, emu):
        heap, flags, p = emu.args(3)
        assert heap == PROCESS_HEAP and flags == 0, (hex(heap), flags)
        self._ret(1)

    def _realloc(self, emu):
        p, n = self._arg(0), self._arg(1)
        q = emu.alloc(max(n, 1), 16)
        if p:
            emu.write(q, emu.read(p, min(self.blocks[p], n)))
        self.blocks[q] = n
        self._ret(q)

    def _vswprintf(self, emu):
        """`__stdio_common_vswprintf` as `_vsnwprintf` is for StringCchPrintfW(.., L"%s ", text): at most `count` characters; the NUL only when they fit;
        -1 when the text is longer"""
        lo, hi, buf, count, fmt, locale, argp = emu.args(7)
        assert self.wstr(fmt) == "%s ", self.wstr(fmt)
        text = self.wstr(emu.u32(argp)) + " "
        if len(text) < count:
            emu.write(buf, (text + "\0").encode("utf-16-le", "surrogatepass"))
            self._ret(len(text))
        else:
            emu.write(buf, text[:count].encode("utf-16-le", "surrogatepass"))
            self._ret(count if len(text) == count else -1)

    def _towlower(self, emu):
        (c,) = emu.args(1)
        c &= 0xFFFF
        self._ret(c + 32 if 0x41 <= c <= 0x5A else c)

    def _imm_get_context(self, emu):
        (hwnd,) = emu.args(1)
        assert hwnd == APP_HWND, hex(hwnd)
        self.log("imm.get")
        self._ret(self.himc)

    def _imm_release_context(self, emu):
        hwnd, himc = emu.args(2)
        assert hwnd == APP_HWND, hex(hwnd)
        self.log("imm.release(%d)" % himc)
        self._ret(1)

    def _imm_associate_context(self, emu):
        hwnd, himc = emu.args(2)
        assert hwnd == APP_HWND, hex(hwnd)
        self.log("imm.assoc(%d)" % himc)
        self._ret(self.imc_assoc)

    def _imm_get_open_status(self, emu):
        (himc,) = emu.args(1)
        self.log("imm.open(%d)" % himc)
        self._ret(1 if self.open_status else 0)

    def _imm_get_conversion_status(self, emu):
        himc, conv, sent = emu.args(3)
        self.log("imm.conv(%d)" % himc)
        emu.w32(conv, self.conv_status[0])
        emu.w32(sent, self.conv_status[1])
        self._ret(1)

    def _imm_notify_ime(self, emu):
        himc, action, index, value = emu.args(4)
        self.log("imm.notify(%d,%d,%d,%d)" % (himc, action, index, value))
        self._ret(1)

    def _imm_is_ime(self, emu):
        (hkl,) = emu.args(1)
        self.log("imm.isime(%d)" % hkl)
        self._ret(1 if self.is_ime else 0)

    def _imm_get_composition_string(self, emu):
        himc, index, buf, size = emu.args(4)
        self.log("imm.comp(%d,%d,%d)" % (himc, index, size))
        assert (index, buf == 0, size) in ((0x80, True, 0), (0x8, False, 0x200), (0x800, False, 0x200), (0x10, False, 0x100), (0x20, False, 0x400)), (index, buf, size)
        item = self.comp.get(index)
        if isinstance(item, int):
            self._ret(item)
            return
        data = item or b""
        if buf:
            emu.write(buf, data[:size])
        self._ret(len(data))

    def _imm_get_candidate_list(self, emu):
        himc, index, buf, size = emu.args(4)
        self.log("imm.cand(%d,%d,%d)" % (himc, index, size))
        assert index == 0 and (buf == 0) == (size == 0), (index, buf, size)
        data = self.cand or b""
        if buf:
            emu.write(buf, data[:size])
        self._ret(len(data))

    def _imm_get_ime_file_name(self, emu):
        hkl, buf, size = emu.args(3)
        assert size in (0x3FF, 0x104), size
        self.log("imm.file(%d)" % hkl)
        self._ret(0)  # no IME file: the exe does not look for a version resource (a file would need CompareStringA and GetFileVersionInfo)

    def _stage_msg(self, emu):
        super()._stage_msg(emu)
        lparam = emu.args(4)[3]
        if self.kind.get(lparam) == "ime":
            self.events[-1] += "[text=%s caret=%d sel=%d first=%d on=%d blink=%s]" % (
                oc.FIELD_OFFSETS["ime"]["text"](self, lparam), self.i(lparam + 0x4AC), self.i(lparam + 0x4B4), self.i(lparam + 0x4B8), self.b(lparam + 0x4A8),
                self.read_field(lparam, (0x4A0, "d")))

    # ---- the scene
    def reset(self):
        super().reset()
        if self.keyboard is None:
            self.keyboard = self.emu.alloc(0x1200)
            self.emu.w32(self.di + 0x34, self.keyboard)
        self.emu.write(self.keyboard, bytes(0x1200))
        self.hkl, self.async_keys, self.focus_window, self.himc, self.is_ime, self.open_status, self.conv_status, self.imc_assoc = \
            0x04090409, {}, 0, 0, False, False, (1, 0), 0
        self.layouts, self.languages, self.comp, self.cand = [0x04090409], dict(LANGUAGES), {}, None

    def window(self, hkl=0x04090409, async_keys=None, focus=0, locales=None, layouts=None, languages=None):
        """what USER32 answers: the keyboard layout, the keys that are down (`GetAsyncKeyState`: VK -> the SHORT), the focus window, the language names (the
        three letters: `locales`, the whole names: `languages`; lcid -> text), the keyboard layouts of the machine (`layouts`: the one of the thread unless given)"""
        self.hkl, self.async_keys, self.focus_window = hkl, dict(async_keys or {}), focus
        self.locales = dict(LOCALES if locales is None else locales)
        self.languages = dict(LANGUAGES if languages is None else languages)
        self.layouts = [hkl] if layouts is None else list(layouts)
        self.op("window", u32(hkl), {str(k): v for k, v in self.async_keys.items()}, focus, None if locales is None else {str(k): v for k, v in self.locales.items()},
                None if layouts is None else [u32(h) for h in layouts], None if languages is None else {str(k): v for k, v in self.languages.items()})

    def imm(self, himc=0, is_ime=False, open_status=False, conv=(1, 0), assoc=0, comp=None, cand=None):
        """what imm32.dll answers: the input context of the window (0: none), whether the layout is an IME, whether it is open, its conversion mode,
        the context `ImmAssociateContext` finds the window had, what the IME has of the composition (`comp`: see `comp_data`) and its candidate list
        (`cand`: the bytes, see `cand_list`)"""
        self.himc, self.is_ime, self.open_status, self.conv_status, self.imc_assoc = himc, is_ime, open_status, conv, assoc
        self.comp, self.cand = dict(comp or {}), cand
        self.op("imm", himc, is_ime, open_status, list(conv), assoc, {str(k): (v if isinstance(v, int) else v.hex()) for k, v in self.comp.items()},
                None if cand is None else cand.hex())

    def ime_state(self, enable=True, insert_on_type=False, hkl=0, ime_state=0, vertical=False, pt=(0, 0), comp_caret=0, first_target=-1, hide_caret=False,
                  comp="", comp_font=True, clause=(), cands=None, l_alt=0x80000000, l_ctrl=0x80000000, l_shift=0x80000000, toggle_hkl=0, busy=False, imc_def=0,
                  indicator_index=0, chinese=False, attr=(), ids=(0, 0, 0), show_reading=False, horizontal_reading=False, reading="", locales=()):
        """the statics of the class for a scene: the IME system on or off, the layout `hkl` and the layout `CheckToggleState` saw last, the state, the position
        and the text of the composition string, its caret and clauses, the candidate list `cands` (dict: count, selection, page, show, rect, texts, hori,
        reading_error, first_selected, hori_len), the modifiers' last `lParam`s, the indicator (which of the five), the cache of GetImeId (`ids`: the layout it was asked about last
        and its two ids), the reading window (shown, horizontal, its string), the list of the keyboard layouts `locales` ((hkl, indicator, language name) each)"""
        emu = self.emu
        emu.heap_ptr = max(emu.heap_ptr, self.mark)
        emu.write(S["hklCurrent"], struct.pack("<I", u32(hkl)))
        emu.write(S["verticalCand"], bytes([1 if vertical else 0, 1 if insert_on_type else 0, 1 if enable else 0, 1 if show_reading else 0]))
        emu.write(S["horizontalReading"], bytes([1 if horizontal_reading else 0]))
        emu.w32(S["imeState"], ime_state)
        emu.write(S["ptComp"], struct.pack("<2i", *pt))
        emu.write(S["compCaret"], struct.pack("<2i", comp_caret, first_target))
        emu.write(S["chineseIme"], bytes([1 if chinese else 0]))
        emu.write(S["hideCaret"], bytes([1 if hide_caret else 0]))
        emu.write(S["compAttr"], bytes(attr).ljust(256, b"\0"))
        emu.write(S["compClause"], b"".join(struct.pack("<I", c) for c in clause).ljust(1024, b"\0"))
        emu.write(S["readingString"], reading.encode("utf-16-le") + b"\0\0")
        data = emu.alloc(0x8C * len(locales) + 16)
        for i, (locale_hkl, abbreviation, language) in enumerate(locales):
            entry = bytearray(0x8C)
            entry[0:4] = struct.pack("<I", u32(locale_hkl))
            entry[4:4 + 2 * len(abbreviation) + 2] = (abbreviation + "\0").encode("utf-16-le")
            entry[10:10 + 2 * len(language) + 2] = (language + "\0").encode("utf-16-le")
            emu.write(data + 0x8C * i, bytes(entry))
        emu.write(S["locale"], struct.pack("<3I", data if locales else 0, len(locales), len(locales)))
        self.fill_buffer(S["compString"], comp, 256, 0xFFFF, False, False, 99999, 99999, False, False, True, False, 0, False, (False, 0), (17, 1) if comp_font else None, False)
        c = cands or {}
        emu.write(S["candList"], bytes(0x1400))
        for i, text in enumerate(c.get("texts", ())):
            emu.write(S["candList"] + 512 * i, text.encode("utf-16-le") + b"\0\0")
        self.fill_buffer(S["horiCand"], c.get("hori", ""), 300, 0xFFFF, False, False, 99999, 99999, False, False, True, False, 0, False, (False, 0), (17, 1), False)
        emu.write(S["candFirstSelected"], struct.pack("<2i", c.get("first_selected", 0), c.get("hori_len", 0)))
        emu.write(S["candCount"], struct.pack("<4I", c.get("count", 0), c.get("selection", 0) & 0xFFFFFFFF, c.get("page", 0), c.get("reading_error", 0) & 0xFFFFFFFF))
        emu.write(S["candShow"], bytes([1 if c.get("show", False) else 0]))
        emu.write(S["candRect"], struct.pack("<4i", *c.get("rect", (0, 0, 0, 0))))
        emu.write(S["lAlt"], struct.pack("<3I", u32(l_alt), u32(l_ctrl), u32(l_shift)))
        emu.w32(S["hklToggle"], u32(toggle_hkl))
        emu.write(S["focusOutBusy"], bytes([1 if busy else 0]))
        emu.w32(S["hImcDef"], imc_def)
        emu.write(S["hklPrev"], struct.pack("<3I", *(u32(v) for v in ids)))
        emu.w32(S["currIndicator"], S["indicators"] + 6 * indicator_index)
        for k, text in enumerate(("En", "\u7b80", "\u7e41", "\uac00", "\u3042")):
            emu.write(S["indicators"] + 6 * k, text.encode("utf-16-le") + b"\0\0")
        self.op("imestate", {
            "enable": enable, "insertOnType": insert_on_type, "hkl": u32(hkl), "imeState": ime_state, "vertical": vertical, "pt": list(pt), "compCaret": comp_caret,
            "firstTarget": first_target, "hideCaret": hide_caret, "comp": ou.enc(comp), "compFont": comp_font, "clause": list(clause),
            "cands": {k: (list(v) if isinstance(v, tuple) else v) for k, v in c.items()}, "lAlt": u32(l_alt), "lCtrl": u32(l_ctrl), "lShift": u32(l_shift),
            "toggleHkl": u32(toggle_hkl), "busy": busy, "imcDef": imc_def, "indicator": indicator_index, "chinese": chinese, "attr": list(attr), "ids": [u32(v) for v in ids],
            "showReading": show_reading, "horizontalReading": horizontal_reading, "reading": reading, "locales": [[u32(h), a, n] for h, a, n in locales],
        })

    def ime_(self, label, dialog, index=1, rect=(0, 0, 100, 20), offset=(0.0, 0.0), text="abc", size=64, caret=None, sel=None, first=0, insert=True, caret_on=False,
             blink=3.25, drag=False, enable=True, show=True, change=-1, enter=-1, focus_out=-1, focus_in=-1, sound=True, rc_text=(5, 0, 85, 20), length_limit=0xFFFF,
             one_char=False, only_num=False, width_limit=99999, line_limit=99999, auto_upper=False, byte_limit=False, byte_max=0, has_focus=False, group=(-1, -1),
             enable_paste=True, force_change=False, align=(0, 0), font=True):
        """an IME edit box: `rect` is its current point, `rc_text` the text rectangle, `group` (id, sequence) of a multi-line box, `align` the offset the text is
        aligned by; the text is `text` in room for `size` characters; the caret and the start of the selection are at the end of the text unless given"""
        emu = self.emu
        caret = len(text) if caret is None else caret
        sel = caret if sel is None else sel
        c = self.control("Ime", label, corners=om.rect(*rect), dialog=index, show=show, enable=enable, offset=offset, size=0x560)
        emu.write(c + 0xB0, bytes([1 if has_focus else 0]))
        emu.w32(c + 0x21C, self.font if font else 0)
        emu.write(c + 0x258, struct.pack("<4i", change, enter, focus_out, focus_in))
        emu.write(c + 0x268, bytes([1 if force_change else 0]))
        self.fill_buffer(c + BUFFER, text, size, length_limit=length_limit, one_char=one_char, only_num=only_num, width_limit=width_limit, line_limit=line_limit,
                         only_num_english=False, check_case=False, big=True, byte_limit=byte_limit, byte_max=byte_max, auto_upper=auto_upper, hide=(False, 0),
                         font=(17, 1), analyse=False)
        emu.write(c + 0x488, struct.pack("<4i", *rc_text))
        emu.write(c + 0x4A0, struct.pack("<d", blink))
        emu.write(c + 0x4A8, bytes([1 if caret_on else 0]))
        emu.write(c + 0x4AC, struct.pack("<i", caret))
        emu.write(c + 0x4B0, bytes([1 if insert else 0]))
        emu.write(c + 0x4B4, struct.pack("<2i", sel, first))
        emu.write(c + 0x4D0, struct.pack("<2i", *align))
        emu.write(c + 0x4D8, bytes([1 if drag else 0]))
        emu.w32(c + 0x54C, oc.SOUND_DOWN if sound else 0)
        emu.write(c + 0x550, struct.pack("<2i", *group))
        emu.write(c + 0x558, bytes([1 if enable_paste else 0]))
        self._adopt(c, label, dialog, "ime")
        self.op("imebox", label, dialog, {
            "rect": list(rect), "offset": list(offset), "text": ou.enc(text), "size": size, "caret": caret, "sel": sel, "first": first, "insert": insert,
            "caretOn": caret_on, "blink": blink, "drag": drag, "enable": enable, "show": show, "change": change, "enter": enter, "focusOut": focus_out,
            "focusIn": focus_in, "sound": sound, "rcText": list(rc_text), "lengthLimit": length_limit, "oneChar": one_char, "onlyNum": only_num,
            "widthLimit": width_limit, "lineLimit": line_limit, "autoUpper": auto_upper, "byteLimit": byte_limit, "byteMax": byte_max, "hasFocus": has_focus,
            "group": list(group), "enablePaste": enable_paste, "forceChange": force_change, "align": list(align), "font": font,
        })
        return c

    def state_of(self, label):
        """the state of the box and the statics (`IME_STATE_KEYS`), and the keys the call asked for (`EXTRA_STATE_KEYS`)"""
        state = super().state_of(label)
        c = self.addr[label]
        return " ".join([state] + ["%s=%s" % (key, self.read_field(c, oc.FIELD_OFFSETS["ime"][key])) for key in self.extra_keys])

    # ---- the calls
    def act(self, case, label, what, *args, keys=(), crash=False):
        """send `what` to the box and write down the answer, the calls and the state: `key(uMsg, wParam, lParam)`, `msg(uMsg, wParam, lParam)`,
        `mouse(uMsg, x, y, wParam, lParam)`, `in()`, `out()` (the virtual functions), a member by its address (`ebproc(uMsg, wParam, lParam)`, `contain(x, y)`,
        `clear()`, `delete()`, `copy()`, `paste()`, `place(cp)`, `sendcomp()`, `trunc(backspace, length)`, `korean()`, `prev()`, `next()`: the label of the box it
        answers), or a function
        that needs no box (`toggle()`, `sendkey(vk)`, `static(uMsg, wParam)`, `private()`, `imeid(index)`: the id as a number).  `keys`: more keys of the state to write down
        (`EXTRA_STATE_KEYS`).  `crash`: the exe ends (a range check: `int 0x29`); the answer is `crash` and the state is what it had done till then"""
        if self.only and not case.startswith(self.only):
            return None
        c = self.addr[label]
        self.events = []
        self.extra_keys = tuple(keys)
        args = list(args)
        try:
            ret = self._call(what, c, args)
        except RuntimeError as e:
            if not crash:
                raise
            eip = self.emu.reg(UC_X86_REG_EIP)  # (behind the `int 0x29` of __report_rangecheckfailure: `mov ecx, 8; int 0x29; ret`)
            assert self.emu.read(eip - 2, 2) == b"\xCD\x29" and self.emu.read(eip - 7, 5) == b"\xB9\x08\x00\x00\x00", (hex(eip), str(e)[:300])
            ret = "crash"
        else:
            assert not crash, "the exe did not end"
        events = list(self.events)
        state = self.state_of(label)
        self.extra_keys = ()
        print("%-100s -> %s | %s | %s" % (case, ret, ",".join(events), state))
        self.op("act_ime", case, label, what, args, {"ret": ret, "events": events, "state": state})
        return ret

    def _call(self, what, c, args):
        if what in SLOTS:
            slot, fn, count, hwnd = SLOTS[what]
            assert len(args) == count, (what, args)
            handler = self.emu.u32(self.emu.u32(c) + 4 * slot)
            assert handler == fn, hex(handler)
            ret = self.thiscall(handler, c, ([APP_HWND] if hwnd else []) + args)
            ret = ret & 0xFF if what not in ("in", "out") else 0
        elif what in CALLS:
            addr, count, answers = CALLS[what]
            assert len(args) == count, (what, args)
            ret = self.thiscall(addr, c, args)
            if answers == "box":
                ret = self.controls.get(u32(ret), "none" if ret == 0 else "?")
            else:
                ret = (ret & 0xFF) if answers else 0
        else:
            addr, count, answers = CDECLS[what]
            assert len(args) == count, (what, args)
            ret = self.emu.call(addr, args)
            ret = u32(ret) if answers == "u32" else (ret & 0xFF) if answers else 0
        return ret

    def act_text(self, case, label):
        """`GetNowText()` (it answers a std::wstring through a hidden pointer): the text, escaped, is the answer"""
        c = self.addr[label]
        self.events = []
        result = self.emu.alloc(0x20)
        self.emu.write(result, bytes(0x20))
        self.emu.set_reg(oi.ECX, c)
        self.emu.call(0x329371F0, [result])
        size = self.emu.u32(result + 0x10)
        data = self.emu.u32(result) if self.emu.u32(result + 0x14) > 7 else result  # (_Bx: the 8 characters it holds itself, or the pointer to the heap's)
        text = "".join(chr(struct.unpack("<H", self.emu.read(data + 2 * i, 2))[0]) for i in range(size))
        ret = esc(text)
        events = list(self.events)
        state = self.state_of(label)
        print("%-100s -> %s | %s | %s" % (case, ret, ",".join(events), state))
        self.op("act_ime", case, label, "nowtext", [], {"ret": ret, "events": events, "state": state})
        return ret


def main():
    o = ImeOracle()
    WM_KEYDOWN, WM_CHAR = 0x100, 0x102
    TAB, ESC, END, HOME, LEFT, UP, RIGHT, DOWN_, INSERT, DELETE = 9, 27, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E
    SHIFT, CTRL = 0x10, 0x11
    DOWN = 0x8000
    NAMES = {TAB: "Tab", ESC: "Esc", END: "End", HOME: "Home", LEFT: "Left", UP: "Up", RIGHT: "Right", DOWN_: "Down", INSERT: "Insert", DELETE: "Delete"}
    NARROW = (5, 0, 45, 20)  # a text rectangle 40 wide: about five characters of the oracle's font show

    def name(vk):
        return NAMES.get(vk, "0x%X" % vk)

    def fresh(text="abc", caret=None, sel=None, keys=None, clip=None, dpos=(10.0, 20.0), scale=None, window=None, imm=None, state=None, boxes=(), **kw):
        """the dialog D (at (10, 20), managed, with a stage), the probe Y that can take the focus, and the IME box E (0,0)-(100,20) in it, holding `text` with the
        caret (and the start of the selection) at the end unless given; `boxes`: more IME boxes of the dialog ((label, keyword arguments of ime_), in the
        dialog's order after E); the keys in `keys` are down (VK: the SHORT GetKeyState answers); `clip`: the arguments of `clipboard`; `window`, `imm`, `state`:
        the arguments of `window`, `imm` and `ime_state` (the IME system is on); the timer answers 100.5, 100.75, ... and the last blink of the box was at 3.25"""
        o.reset()
        if scale is not None:
            o.scale(*scale)
        o.dialog_("D", pos=dpos)
        o.managed_("D", True)
        o.control_("Y", "D", rect=(200, 0, 240, 40))
        o.ime_("E", "D", text=text, caret=caret, sel=sel, **kw)
        for label, box in boxes:
            o.ime_(label, "D", **box)
        o.register("D", ["E", "Y"] + [label for label, _ in boxes])
        o.key_states(keys or {})
        o.timer(100.5, 0.25)
        o.window(**(window or {}))
        o.imm(**(imm or {}))
        o.ime_state(**(state or {}))
        if clip is not None:
            o.clipboard(**clip)

    def key(case, vk, uMsg=WM_KEYDOWN, lParam=0x12345678):
        return o.act(case, "E", "key", uMsg, vk, lParam)

    def msg(case, uMsg, wParam, lParam=0x12345678):
        return o.act(case, "E", "msg", uMsg, wParam, lParam)

    def char(case, ch, uMsg=WM_CHAR, lParam=0x12345678):
        return o.act(case, "E", "msg", uMsg, ch, lParam)

    SYSTEMS = (("IME system on", {"enable": True}), ("IME system off", {"enable": False}))

    # ================================================================ MsgProc (329387A0) and EBProc (32936A30)
    # ---- the gates: enabled and shown, (the IME system on or off), a character message
    for sname, system in SYSTEMS:
        for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False}), ("disabled, hidden", {"enable": False, "show": False})):
            for ch in (ord("a"), 8, 13, 0x16, 1, 3, 0x18):
                fresh("hello", caret=2, sel=2, change=7, enter=8, clip={"text": "xyz"}, state=system, **kw)
                char("E1 character 0x%X, box %s, %s" % (ch, tag, sname), ch)
    for sname, system in SYSTEMS:
        for uMsg in (0x103, 0x104, 0x106, 0x0, 0x286, 0x200, 0x80000102, 0x10102):
            fresh("hello", caret=2, sel=2, state=system)
            msg("E1 message 0x%X, wParam a, %s" % (uMsg, sname), uMsg, ord("a"))
    # ---- the characters, one by one, in a box of one line (the IME system on and off)
    for sname, system in SYSTEMS:
        for ch in range(0, 0x20):
            fresh("abc", 1, 1, change=7, enter=8, clip={"text": "xyz"}, state=system)
            char("E2 character 0x%02X, caret 1, no selection, %s" % (ch, sname), ch)
        for ch in (1, 3, 8, 13, 0x16, 0x18, 2, 0x1D, 0x1E, 0x1F):
            fresh("abc", 1, 3, change=7, enter=8, clip={"text": "xyz"}, state=system)
            char("E2 character 0x%02X, selection 1..3, %s" % (ch, sname), ch)
        for ch in (0x20, 0x41, 0x7E, 0x7F, 0x80, 0xFF, 0x100, 0x4E2D, 0xD800, 0xFFFF):
            fresh("abc", 1, 1, state=system)
            char("E2 character 0x%04X typed, %s" % (ch, sname), ch)
    for wp in (0x10061, 0xABCD0061, 0xFFFF0001, 0x00010008, 0xFFFF0008, 0x1000D, 0xFFFFFFFF, 0x12340016, 0x80000041, 0x00020003):
        fresh("abc", 1, 1, change=7, enter=8, clip={"text": "xyz"})
        char("E2 wParam 0x%08X: the character is the signed low 16 bits" % wp, wp)

    # ================================================================ HandleKeyboard (32937C10)
    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False}), ("disabled, hidden", {"enable": False, "show": False})):
        for vk in (LEFT, DELETE, TAB, ESC, 0x41, HOME, UP):
            fresh("hello", caret=2, sel=2, **kw)
            key("K1 key down %s, box %s" % (name(vk), tag), vk)
    for uMsg in (0x101, 0x102, 0x104, 0x105, 0, 0xFF, 0x1000, 0x80000100, 0x200):
        fresh("hello", caret=2, sel=2)
        key("K1 message 0x%X is no key down: Left" % uMsg, LEFT, uMsg)

    # ================================================================ EBProc: typing
    for caret, sel in ((3, 3), (1, 1), (0, 0), (1, 3), (3, 1), (0, 3), (3, 0), (2, 8), (8, 2)):
        for insert in (True, False):
            fresh("abc", caret, sel, insert=insert, change=7)
            char("E3 type x, insert mode %s, caret %d, selection from %d" % (insert, caret, sel), ord("x"))
    fresh("abc", 1, 1, insert=False, sound=False)
    char("E3 type x over the second character, without a key sound", ord("x"))
    for change in (-1, 0, -2):
        fresh("abc", 1, 1, change=change)
        char("E3 type x, change message %d" % change, ord("x"))
    for tag, kw, text, ch in (("length limit 3", {"length_limit": 3}, "abc", "d"), ("length limit 4", {"length_limit": 4}, "abc", "d"),
                              ("only digits", {"only_num": True}, "123", "a"), ("only digits", {"only_num": True}, "123", "4"),
                              ("auto upper case", {"auto_upper": True}, "abc", "x"), ("one character mode", {"one_char": True}, "a", "x"),
                              ("width limit 30", {"width_limit": 30}, "abc", "x"), ("line limit 1", {"line_limit": 1}, "abc", "x"),
                              ("byte limit 4", {"byte_limit": True, "byte_max": 4}, "abc", "x"), ("a buffer of 4", {"size": 4}, "abc", "x"),
                              ("a buffer of 8", {"size": 8}, "abcdefg", "x")):
        for caret in (0, len(text)):
            fresh(text, caret, caret, change=7, **kw)
            char("E3 type %s, %s, caret %d" % (ch, tag, caret), ord(ch))
    for keys in ({SHIFT: DOWN}, {CTRL: DOWN}, {SHIFT: DOWN, CTRL: DOWN}, {SHIFT: 1, CTRL: 1}, {SHIFT: DOWN | 1, CTRL: DOWN | 1}):
        for ch in (ord("x"), 13, 0, 0x20):
            fresh("abc", 1, 3, keys=keys, change=7, enter=8)
            char("E4 character 0x%X typed with the keys %s down" % (ch, sorted(keys.items())), ch)
    # a text that scrolls, and a stale first visible character
    for caret, first in ((5, 0), (6, 0), (8, 3), (11, 6), (3, 3), (4, 4), (12, 0), (3, 10)):
        fresh("hello world again", caret=caret, first=first, rc_text=NARROW)
        char("E3 type x in a narrow box: caret %d, first visible %d" % (caret, first), ord("x"))
    # ---- backspace, enter, cut, paste
    for caret, sel in ((0, 0), (1, 1), (3, 3), (5, 5), (1, 3), (3, 1), (0, 5), (5, 0), (2, 8), (8, 2)):
        for change in (-1, 7):
            fresh("hello", caret, sel, change=change)
            char("E5 backspace, caret %d, selection from %d, change message %d" % (caret, sel, change), 8)
    fresh("hello", 3, 3, sound=False)
    char("E5 backspace without a key sound", 8)
    for caret, sel, first in ((5, 5, 5), (6, 6, 5), (8, 8, 4), (3, 3, 3), (8, 2, 4), (2, 8, 4), (11, 11, 6), (5, 5, 0), (12, 12, 0)):
        fresh("hello world", caret=caret, sel=sel, first=first, rc_text=NARROW)
        char("E5 backspace in a narrow box: caret %d, selection from %d, first visible %d" % (caret, sel, first), 8)
    for enter in (-1, 0, 5, -2):
        fresh("hello", 2, 4, change=7, enter=enter)
        char("E6 Enter, enter message %d, a selection (the change message is 7)" % enter, 13)
    for ch in (3, 0x18):
        what = "copy" if ch == 3 else "cut"
        for caret, sel in ((1, 3), (3, 1), (0, 5), (5, 0), (2, 2), (0, 0), (5, 5), (1, 6), (6, 1), (4, 6)):
            fresh("hello", caret, sel, change=-1, clip={"text": "old"})
            char("E6 %s, caret %d, selection from %d" % (what, caret, sel), ch)
        fresh("hello", 1, 3, change=7, clip={"text": "old", "busy": True})
        char("E6 %s with the clipboard busy" % what, ch)
    for ch in (1,):
        for caret, sel in ((0, 0), (2, 2), (5, 5), (1, 3), (3, 1), (0, 5), (5, 0), (2, 4)):
            fresh("hello", caret, sel)
            char("E6 Ctrl+A, caret %d, selection from %d" % (caret, sel), ch)
    CLIPS = (("holding xyz", {"text": "xyz"}), ("holding nothing", {}), ("busy", {"busy": True, "text": "xyz"}), ("holding an empty text", {"text": ""}),
             ("holding a line break", {"text": "x\ny"}), ("whose block cannot be locked", {"text": "xyz", "lock_fails": True}), ("holding a long text", {"text": "0123456789" * 3}))
    for tag, clip in CLIPS:
        for paste in (True, False):
            for caret, sel in ((2, 2), (1, 3), (0, 0), (5, 5)):
                fresh("hello", caret, sel, change=7, clip=clip, enable_paste=paste)
                char("E7 Ctrl+V, clipboard %s, paste %s, caret %d, selection from %d" % (tag, "enabled" if paste else "disabled", caret, sel), 0x16)
    for tag, kw in (("length limit 7", {"length_limit": 7}), ("a buffer of 6", {"size": 6}), ("one character mode", {"one_char": True}), ("only digits", {"only_num": True})):
        fresh("12345" if "only" in tag else ("a" if "one" in tag else "hello"), 1, 1, change=7, clip={"text": "678" if "only" in tag else "xyz"}, **kw)
        char("E7 Ctrl+V of 3 characters, %s" % tag, 0x16)

    # ---- the single-line Enter: the keyboard's extra Enter and lock
    for enter in (-1, 0, 9):
        fresh("hello", 2, 2, change=7, enter=enter)
        char("E8 Enter, enter message %d: the keyboard's Enter is extra, and locked when there is a message" % enter, 13)

    # ================================================================ boxes of a group: the line breaks, the previous and the next box
    GROUP = (1, 0)
    for caret, sel in ((3, 3), (1, 1), (0, 0), (2, 1)):
        for insert in (True, False):
            fresh("abc", caret, sel, group=GROUP, insert=insert, change=7)
            char("G1 Enter in a box of a group, insert mode %s, caret %d, selection from %d" % (insert, caret, sel), 13)
    fresh("abc", 3, 3, group=GROUP, line_limit=1)
    char("G1 Enter in a box of a group, line limit 1", 13)
    fresh("abc", 3, 3, group=GROUP, line_limit=2)
    char("G1 Enter in a box of a group, line limit 2", 13)
    fresh("abc", 3, 3, group=GROUP, keys={SHIFT: DOWN, CTRL: DOWN})
    char("G1 Enter in a box of a group with shift and control down", 13)
    for width, caret in ((22, 3), (23, 3), (21, 3), (30, 3), (22, 2), (40, 1)):
        for group in ((-1, -1), GROUP):
            fresh("abc", caret, caret, group=group, width_limit=width, change=7)
            char("G2 type x, width limit %d, caret %d, group %s" % (width, caret, group), ord("x"))
    fresh("ab\ncd", 5, 5, group=GROUP, width_limit=22)
    char("G2 type x at the end of the second line, width limit 22", ord("x"))
    fresh("ab\ncd", 2, 2, group=GROUP, width_limit=11)
    char("G2 type x at the end of the first line, width limit 11", ord("x"))
    for caret in (0, 1, 3):
        fresh("hello", caret, caret, group=(2, 1), boxes=[("F", dict(text="front", group=(2, 0))), ("G", dict(text="after", group=(2, 2)))])
        char("G3 backspace at caret %d of the box 1 of a group of three (the previous box is F)" % caret, 8)
    for focus in (None, "E", "Y", "F"):
        fresh("hello", 0, 0, group=(2, 1), boxes=[("F", dict(text="front", group=(2, 0)))])
        if focus:
            o.focus(focus)
        char("G3 backspace at the start, the focus is %s" % focus, 8)
    fresh("hello", 0, 0, group=(2, 0), boxes=[("F", dict(text="front", group=(2, 1)))])
    char("G3 backspace at the start of the first box of a group: no previous box", 8)
    fresh("hello", 0, 0, group=(2, 1), boxes=[("F", dict(text="front", group=(3, 0)))])
    char("G3 backspace at the start, the box before is of another group", 8)
    fresh("hello", 0, 0, group=(2, 1), boxes=[("F", dict(text="front", group=(2, 0), enable=False))])
    char("G3 backspace at the start, the previous box is disabled", 8)
    for sel in (0, 3):
        fresh("hello", 0, sel, group=(2, 1), boxes=[("F", dict(text="front", group=(2, 0)))])
        char("G3 backspace at caret 0 with the selection from %d" % sel, 8)
    for caret in (0, 3, 5):
        fresh("abc", 3, 3, length_limit=3, group=(2, 0), boxes=[("F", dict(text="next", group=(2, 1)))], change=7)
        char("G4 type x into a full box with a next box (caret 3)", ord("x"))
    for focus in (None, "E", "Y", "F"):
        fresh("abc", 3, 3, length_limit=3, group=(2, 0), boxes=[("F", dict(text="next", group=(2, 1)))], change=7)
        if focus:
            o.focus(focus)
        char("G4 type x into a full box, the next box F, the focus is %s" % focus, ord("x"))
    fresh("abc", 3, 3, length_limit=3, group=(2, 0), boxes=[("F", dict(text="abc", length_limit=3, group=(2, 1)), ), ("G", dict(text="", group=(2, 2)))], change=7)
    char("G4 type x into a full box, the next box is full, too", ord("x"))
    fresh("abc", 3, 3, length_limit=3, group=(2, 0), boxes=[("F", dict(text="far", group=(2, 2)))], change=7)
    char("G4 type x into a full box, the next box is not the next in the sequence", ord("x"))
    fresh("abc", 3, 3, length_limit=3, change=7)
    char("G4 type x into a full box with no next box", ord("x"))

    # ================================================================ MsgProc with the IME system on: the keys of the modifiers
    NONE = 0x80000000
    PRESSED = 0x00380001
    for sname, system in (("IME system on", {"enable": True}),):
        for uMsg in (0x100, 0x104):
            for wp in (0x10, 0x11, 0x12, 0x41, 0x20, 0x0, 0xFFFF, 0x10010):
                for lParam in (0x00010001, 0x12345678, 0xC0010001, 0x80000000):
                    fresh("hello", 2, 2, state={**system, "l_alt": 1, "l_ctrl": 2, "l_shift": 3})
                    msg("E9 key down 0x%X, wParam 0x%X, lParam 0x%08X" % (uMsg, wp, lParam), uMsg, wp, lParam)
    for uMsg in (0x101, 0x105):
        for wp in (0x10, 0x11, 0x12, 0x41):
            for downs in ((NONE, NONE, NONE), (PRESSED, NONE, NONE), (NONE, PRESSED, NONE), (NONE, NONE, PRESSED), (PRESSED, PRESSED, NONE),
                          (PRESSED, NONE, PRESSED), (NONE, PRESSED, PRESSED), (PRESSED, PRESSED, PRESSED)):
                for async_keys in ({}, {0x12: DOWN, 0x11: DOWN, 0x10: DOWN}, {0x12: DOWN}, {0x11: DOWN}, {0x10: DOWN}, {0x11: DOWN, 0x10: DOWN}):
                    fresh("hello", 2, 2, window={"async_keys": async_keys, "focus": 0x1234},
                          state={"enable": True, "l_alt": downs[0], "l_ctrl": downs[1], "l_shift": downs[2]})
                    msg("E9 key up 0x%X, wParam 0x%X, the modifiers' last lParams %s, GetAsyncKeyState %s" % (
                        uMsg, wp, ["%08X" % d for d in downs], sorted(async_keys.items())), uMsg, wp, 0x00C10001)
    for lastp in (0x00380001, 0x7FFFFFFF, 0x01FF0001, 0x00000001, 0x3FFF0000):
        fresh("hello", 2, 2, window={"async_keys": {}, "focus": 0x77}, state={"enable": True, "l_alt": lastp, "l_ctrl": NONE, "l_shift": NONE})
        msg("E9 key up of Alt that was down with lParam 0x%08X: what is posted" % lastp, 0x101, 0x41, 0x12345678)
    for wp in (0x41, 0x12):
        fresh("hello", 2, 2, state={"enable": False, "l_alt": 1, "l_ctrl": 2, "l_shift": 3})
        msg("E9 key down, IME system off, wParam 0x%X: the modifiers are not looked at" % wp, 0x100, wp, 0x00010001)
    for tag, kw in (("disabled", {"enable": False}), ("hidden", {"show": False})):
        fresh("hello", 2, 2, **kw)
        msg("E9 key down of Shift, box %s: not looked at" % tag, 0x100, 0x10, 0x00010001)

    # ================================================================ HandleKeyboard (32937C10)
    for vk in (TAB, ESC, 0x41, 0x20, 0x70, 8, 13, 0x21, 0x22, 0x2F, 0, 0xFF, 0x10025, 0xFFFFFFFF, 0x1B + 0x10000):
        fresh("hello", caret=2, sel=4, keys={SHIFT: DOWN, CTRL: DOWN})
        key("K2 key down %s, a selection, shift and control down" % name(vk), vk)
    for vk in (HOME, END):
        for tag, keys in (("no shift", {}), ("shift down", {SHIFT: DOWN}), ("shift only toggled", {SHIFT: 1}), ("ctrl down", {CTRL: DOWN})):
            for caret, sel in ((2, 2), (2, 4), (4, 2), (0, 0), (5, 5), (0, 5)):
                fresh("hello", caret, sel, keys=keys)
                key("K3 %s, %s, caret %d, selection from %d" % (name(vk), tag, caret, sel), vk)
    for vk, caret, first in ((END, 0, 0), (END, 3, 0), (HOME, 11, 6), (HOME, 11, 3), (END, 11, 4), (END, 5, 2), (HOME, 4, 4), (HOME, 5, 4)):
        fresh("hello world", caret=caret, first=first, rc_text=NARROW)
        key("K3 %s in a narrow box: caret %d, first visible %d" % (name(vk), caret, first), vk)
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
            for stag, skeys in (("shift down", {SHIFT: DOWN}), ("shift toggled", {SHIFT: 1}), ("shift down and toggled", {SHIFT: DOWN | 1})):
                for caret, sel in ((0, 0), (3, 3), (11, 11), (3, 1), (1, 3)):
                    fresh(TEXT, caret, sel, keys={**ckeys, **skeys})
                    key("K4 %s, %s, %s, caret %d, selection from %d" % (name(vk), ctag, stag, caret, sel), vk)
    for vk in (LEFT, RIGHT):
        for ctag, ckeys in (("no ctrl", {}), ("ctrl", {CTRL: DOWN})):
            for stag, skeys in (("no shift", {}), ("shift down", {SHIFT: DOWN})):
                text, places = ("hello", ((2, 0), (0, 3), (3, 5), (5, 3), (5, 0), (0, 5), (4, 1), (1, 4))) if not ckeys else \
                    (TEXT, ((5, 10), (10, 5), (7, 0), (0, 7), (11, 6), (6, 11), (3, 8), (8, 3), (11, 0), (0, 11)))
                for caret, sel in places:
                    fresh(text, caret, sel, keys={**ckeys, **skeys})
                    key("K4 %s, %s, %s, caret %d, selection from %d of %r (the caret decides)" % (name(vk), ctag, stag, caret, sel, text), vk)
    for vk, caret, first, keys in ((RIGHT, 4, 0, {}), (RIGHT, 5, 0, {}), (RIGHT, 6, 3, {}), (LEFT, 3, 3, {}), (LEFT, 4, 4, {}), (LEFT, 5, 4, {}),
                                   (RIGHT, 3, 0, {CTRL: DOWN}), (RIGHT, 8, 0, {CTRL: DOWN}), (LEFT, 10, 6, {CTRL: DOWN}), (LEFT, 7, 7, {CTRL: DOWN})):
        fresh("hello world again", caret=caret, first=first, rc_text=NARROW, keys=keys)
        key("K4 %s in a narrow box: caret %d, first visible %d%s" % (name(vk), caret, first, ", ctrl" if keys else ""), vk)
    for vk in (LEFT, RIGHT):
        fresh("", keys={})
        key("K4 %s in an empty text" % name(vk), vk)
    # Up and Down: a box that is no line of a group takes them and does nothing; a box of a group goes a line
    for vk in (UP, DOWN_):
        for keys in ({}, {SHIFT: DOWN}, {CTRL: DOWN}):
            fresh("ab\ncd\nef", 4, 1, keys=keys)
            key("K5 %s, no group, caret 4, selection from 1" % name(vk), vk)
    ML = "ab\ncd\nef\n\ngh"
    for vk in (UP, DOWN_):
        for keys in ({}, {SHIFT: DOWN}):
            for caret in range(0, len(ML) + 1):
                fresh(ML, caret, caret, keys=keys, group=(1, 0))
                key("K5 %s in a group, %s, caret %d of %r" % (name(vk), "shift" if keys else "no shift", caret, ML), vk)
    for vk in (UP, DOWN_):
        for caret, sel in ((4, 1), (1, 4), (0, 6), (6, 0)):
            fresh(ML, caret, sel, group=(1, 0))
            key("K5 %s in a group, caret %d, selection from %d: the selection collapses" % (name(vk), caret, sel), vk)
    for vk in (UP, DOWN_):
        for caret in (3, 6, 8):
            fresh("hello\nworld wide\nagain", caret, caret, group=(1, 0), rc_text=NARROW, first=2)
            key("K5 %s in a narrow group box, caret %d, first visible 2" % (name(vk), caret), vk)
        fresh("", 0, 0, group=(1, 0))
        key("K5 %s in an empty group box" % name(vk), vk)
    # Insert
    CL = (("holding xyz", {"text": "xyz"}), ("holding nothing", {}), ("busy", {"busy": True, "text": "xyz"}))
    for ctag, ckeys in (("no mods", {}), ("shift", {SHIFT: DOWN}), ("ctrl", {CTRL: DOWN}), ("ctrl and shift", {CTRL: DOWN, SHIFT: DOWN}),
                        ("shift toggled only", {SHIFT: 1}), ("ctrl toggled only", {CTRL: 1})):
        for caret, sel in ((2, 2), (1, 3), (3, 1)):
            for ctag2, clip in CL:
                fresh("hello", caret, sel, keys=ckeys, clip=clip)
                key("K6 Insert, %s, caret %d, selection from %d, clipboard %s" % (ctag, caret, sel, ctag2), INSERT)
    for insert in (True, False):
        fresh("hello", 2, 2, insert=insert)
        key("K6 Insert toggles the insert mode (now %s)" % insert, INSERT)
    for paste in (True, False):
        fresh("hello", 2, 2, keys={SHIFT: DOWN}, clip={"text": "xyz"}, enable_paste=paste)
        key("K6 Shift+Insert, paste %s" % ("enabled" if paste else "disabled"), INSERT)
    # Delete
    for change in (-1, 7, 0, -2):
        for caret, sel in ((0, 0), (2, 2), (4, 4), (5, 5), (1, 3), (3, 1), (0, 5), (5, 0), (3, 8), (8, 3)):
            if change in (0, -2) and (caret, sel) != (2, 2):
                continue
            fresh("hello", caret, sel, change=change)
            key("K7 Delete, caret %d, selection from %d, change message %d" % (caret, sel, change), DELETE)
    for caret, sel, first in ((2, 8, 4), (8, 2, 4), (7, 7, 4), (8, 5, 6), (9, 3, 3), (12, 12, 0), (3, 3, 10)):
        fresh("hello world", caret=caret, sel=sel, first=first, rc_text=NARROW)
        key("K7 Delete in a narrow box: caret %d, selection from %d, first visible %d" % (caret, sel, first), DELETE)
    fresh("", change=7)
    key("K7 Delete in an empty text", DELETE)
    # a box whose first visible character is stale
    STALE = (("right of the box", 12, 0), ("far right of the box", 17, 0), ("left of the first visible character", 3, 10))
    LONG = "hello world again"
    for tag, caret, first in STALE:
        for vk in (HOME, END, LEFT, RIGHT, DELETE):
            fresh(LONG, caret, caret, first=first, rc_text=NARROW, change=7)
            key("K8 key %s, the caret %s (%d, first visible %d)" % (name(vk), tag, caret, first), vk)
        for ch in (ord("x"), 8, 1, 13, 3, 0x18, 0x16):
            fresh(LONG, caret, caret, first=first, rc_text=NARROW, change=7, enter=8, clip={"text": "xy"})
            char("E3 character 0x%X, the caret %s (%d, first visible %d)" % (ch, tag, caret, first), ch)
    # ================================================================ HandleMouse (32937EF0)
    def mouse(case, uMsg, x, y, wp=5, who="E"):
        """the pixel (x, y) of the back buffer is in `lParam` (the point the dialog hands over is not looked at: -77, 88)"""
        return o.act(case, who, "mouse", uMsg, -77, 88, wp, ((y & 0xFFFF) << 16) | (x & 0xFFFF))

    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False}), ("disabled, hidden", {"enable": False, "show": False})):
        for uMsg in (0x201, 0x203, 0x200, 0x202):
            fresh("hello", 2, 2, drag=True, **kw)
            mouse("M1 message 0x%X at (40, 30), box %s, dragging" % (uMsg, tag), uMsg, 40, 30)
    for uMsg in (0x0, 0x1FF, 0x204, 0x205, 0x206, 0x207, 0x208, 0x20A, 0x300, 0x80000201, 0x10201, 0x80000200):
        fresh("hello", 2, 2, drag=True)
        mouse("M1 message 0x%X at (40, 30), dragging" % uMsg, uMsg, 40, 30)
    # ---- the left button: the caret goes under the point (the IME's windows are not shown)
    for uMsg in (0x201, 0x203):
        for x in (9, 10, 14, 15, 16, 20, 27, 33, 40, 55, 70, 85, 100, 109, 110, 150, -5):
            fresh("hello world", 4, 2)
            mouse("M2 message 0x%X at (%d, 30), caret 4, selection from 2" % (uMsg, x), uMsg, x, 30)
    for y in (19, 20, 21, 30, 39, 40, 41, -1, 0):
        fresh("hello world", 4, 2)
        mouse("M2 click at (40, %d)" % y, 0x201, 40, y)
    for first, align, rc in ((3, (0, 0), (5, 0, 85, 20)), (3, (2, 0), (5, 0, 85, 20)), (0, (4, 0), (5, 0, 85, 20)), (3, (0, 0), (8, 0, 88, 20)),
                             (2, (-3, 0), (2, 0, 82, 20)), (5, (1, 0), (0, 0, 80, 20))):
        for x in (12, 20, 36, 60, 80, 105):
            fresh("hello world again", 4, 2, first=first, align=align, rc_text=rc)
            mouse("M2 click at (%d, 30), first visible %d, text aligned by %s, text rectangle %s" % (x, first, align, rc), 0x201, x, 30)
    for tag, kw in (("hello", {}), ("an empty text", {"text": ""}), ("a wide text", {"text": "w" * 30})):
        for x in (12, 60, 109):
            fresh(**{"text": "hello", **kw})
            mouse("M2 click at (%d, 30), %s" % (x, tag), 0x201, x, 30)
    # the focus: a click asks for it (also one next to the box); the box that has it is not asked again
    for focus in (None, "Y", "E"):
        for x in (40, 150):
            for has in (False, True):
                fresh("hello", 4, 2, has_focus=has, focus_in=11, focus_out=12)
                if focus:
                    o.focus(focus)
                mouse("M3 click at (%d, 30), the focus is %s, the box %s the focus flag, focus messages 11 / 12" % (x, focus, "has" if has else "has not"), 0x201, x, 30)
    fresh("hello", 4, 2, boxes=[("F", dict(text="front", has_focus=True, focus_out=15, focus_in=16))])
    o.focus("F")
    mouse("M3 click at (40, 30) while the box F has the focus", 0x201, 40, 30)
    fresh("hello", 4, 2, enable=True, imm={"himc": 5, "is_ime": True, "open_status": True}, state={"enable": True, "hkl": 0x04110411, "imc_def": 9})
    mouse("M3 click at (40, 30), IME on, himc 5: the box takes the focus", 0x201, 40, 30)
    # the scale: the point is in the pixels of the back buffer
    for scale in ((1.5, 0.75), (2.0, 2.0), (0.5, 1.25), (1.25, 1.5), (3.0, 1.0)):
        for x, y in ((20, 30), (35, 45), (60, 15), (100, 60), (150, 50), (200, 75), (80, 70)):
            fresh("hello world", 4, 2, scale=scale)
            mouse("M4 click at the pixel (%d, %d) of the back buffer, scale %s" % (x, y, scale), 0x201, x, y)
    # ---- a box of a group: the caret goes to the line under the point
    GL = "ab\ncd efg\nh"
    for rc in ((5, 0, 85, 20), (5, 4, 85, 24), (5, 10, 85, 30)):
        for y in (20, 24, 28, 32, 36, 39):
            for x in (10, 20, 36, 60):
                fresh(GL, 3, 3, group=(1, 0), rc_text=rc)
                mouse("M5 click at (%d, %d) in a box of a group, text rectangle %s" % (x, y, rc), 0x201, x, y)
    for first, align in ((3, (0, 0)), (0, (3, 6)), (4, (-2, 3))):
        for x, y in ((12, 22), (30, 30), (45, 36)):
            fresh(GL, 3, 3, group=(1, 0), first=first, align=align, rc_text=(5, 2, 85, 22))
            mouse("M5 click at (%d, %d) in a box of a group, first visible %d, text aligned by %s" % (x, y, first, align), 0x201, x, y)
    # ---- the mouse moves while the box is dragging
    for x in (9, 10, 12, 25, 40, 70, 100, 109, 110, 150, -20):
        for y in (30, 19, 20, 39, 40, 80):
            if y != 30 and x not in (10, 40, 109, 110):
                continue
            fresh("hello world", 4, 2, drag=True)
            mouse("M6 move to (%d, %d) while dragging" % (x, y), 0x200, x, y)
    for drag in (False, True):
        for group in ((-1, -1), (0, 0), (3, 1), (-1, 5)):
            fresh("hello world", 4, 2, drag=drag, group=group)
            mouse("M6 move to (150, 30), dragging %s, group %s" % (drag, group), 0x200, 150, 30)
    for first, align, rc in ((3, (0, 0), (5, 0, 85, 20)), (3, (2, 0), (8, 0, 88, 20)), (0, (-4, 0), (2, 0, 82, 20))):
        for x in (20, 36, 60, 105):
            fresh("hello world again", 4, 2, first=first, align=align, rc_text=rc, drag=True)
            mouse("M6 move to (%d, 30) while dragging, first visible %d, text aligned by %s, text rectangle %s" % (x, first, align, rc), 0x200, x, 30)
    for scale in ((1.5, 0.75), (0.5, 1.25)):
        for x, y in ((20, 30), (150, 20), (60, 75), (100, 20)):
            fresh("hello world", 4, 2, drag=True, scale=scale)
            mouse("M6 move to the pixel (%d, %d) while dragging, scale %s" % (x, y, scale), 0x200, x, y)
    for drag in (False, True):
        for sel in (2, 4):
            fresh("hello world", 4, sel, drag=drag)
            mouse("M7 button up, dragging %s, selection from %d" % (drag, sel), 0x202, 40, 30)

    # ---- the IME's windows: a click on the composition string "abcde" (the characters are 11, 5, 6, 7, 8 wide: 37 in all) at (50, 60), a line (18) high
    HKLS = {"Chinese (Taiwan)": 0x04040404, "Chinese (PRC)": 0x08040804, "Japanese": 0x04110411, "Korean": 0x04120412, "English": 0x04090409, "no layout": 0}
    COMP = dict(pt=(50, 60), comp="abcde", comp_caret=1, first_target=-1, clause=(0, 5))
    for hname, hkl in HKLS.items():
        for himc in (0, 5):
            for x in (49, 50, 55, 61, 66, 72, 79, 86, 87, 88):
                fresh("hello", 2, 2, state={**COMP, "hkl": hkl}, imm={"himc": himc})
                mouse("M8 click at (%d, 70) on the composition string, %s layout, input context %d, caret of the composition 1" % (x, hname, himc), 0x201, x, 70)
    for y in (58, 59, 60, 61, 70, 76, 77, 78, 79):
        fresh("hello", 2, 2, state={**COMP, "hkl": 0x04040404}, imm={"himc": 5})
        mouse("M8 click at (60, %d) on the composition string, Chinese layout" % y, 0x201, 60, y)
    for uMsg in (0x203, 0x200, 0x202):
        fresh("hello", 2, 2, state={**COMP, "hkl": 0x04040404}, imm={"himc": 5}, drag=(uMsg == 0x200))
        mouse("M8 message 0x%X at (80, 70) on the composition string, Chinese layout" % uMsg, uMsg, 80, 70)
    for ccaret in (0, 2, 4, 5, 9):
        for x in (52, 63, 80):
            fresh("hello", 2, 2, state={**COMP, "hkl": 0x04040404, "comp_caret": ccaret}, imm={"himc": 5})
            mouse("M8 click at (%d, 70) on the composition string, Chinese layout, caret of the composition %d" % (x, ccaret), 0x201, x, 70)
    CLAUSES = ((0, 2, 4, 5), (0, 1, 3, 5), (0, 5), (0, 3, 5), (0, 1, 2, 3, 4, 5))
    for clause in CLAUSES:
        for target in (-1, 0, 1, 2, 3, 4):
            for x in (52, 63, 68, 74, 82):
                fresh("hello", 2, 2, state={**COMP, "hkl": 0x04110411, "clause": clause, "first_target": target, "comp_caret": 3}, imm={"himc": 5})
                mouse("M8 click at (%d, 70) on the composition string, Japanese layout, clauses %s, first target character %d, caret of the composition 3" % (x, clause, target), 0x201, x, 70)
    for hkl in (0x04040404, 0x04120412):
        for target in (1, 3):
            fresh("hello", 2, 2, state={**COMP, "hkl": hkl, "clause": (0, 2, 4, 5), "first_target": target, "comp_caret": 3}, imm={"himc": 5})
            mouse("M8 click at (82, 70) on the composition string, layout 0x%08X, first target character %d: only Japanese has clauses" % (hkl, target), 0x201, 82, 70)
    for x in (52, 80):
        fresh("hello", 2, 2, state={**COMP, "hkl": 0x04040404, "comp": "", "clause": (0, 0)}, imm={"himc": 5})
        mouse("M8 click at (%d, 70) where an empty composition string has been" % x, 0x201, x, 70)
    for x in (52, 80):
        fresh("hello", 2, 2, state={**COMP, "hkl": 0x04040404, "pt": (30, 25)}, imm={"himc": 5})
        mouse("M8 click at (%d, 30): the composition string is inside the box, and the click on it is not the box's" % (x - 20), 0x201, x - 20, 30)
    for scale in ((1.5, 0.75), (0.5, 2.0)):
        for x, y in ((75, 52), (30, 140), (60, 40), (90, 80), (33, 60)):
            fresh("hello", 2, 2, state={**COMP, "hkl": 0x04040404, "pt": (40, 30)}, imm={"himc": 5}, scale=scale)
            mouse("M8 click at the pixel (%d, %d), scale %s, the composition string at (40, 30)" % (x, y, scale), 0x201, x, y)

    # ---- the candidate window of the IME at (120, 50)-(200, 122): four rows of 18, the second selected
    VERT = dict(show=True, rect=(120, 50, 200, 122), count=4, selection=1, page=5, texts=["ab", "cde", "f", "ghij"], hori="ab cde f ghij ")
    for hname, hkl in HKLS.items():
        for selection in (0, 1, 3):
            for y in (49, 50, 67, 68, 85, 86, 103, 104, 121, 122):
                for x in ((119, 120, 160, 199, 200) if selection == 1 and y in (50, 68, 121) else (160,)):
                    fresh("hello", 2, 2, state={"hkl": hkl, "vertical": True, "cands": {**VERT, "selection": selection}})
                    mouse("M9 click at (%d, %d) on the vertical candidate window, %s layout, the row %d selected" % (x, y, hname, selection), 0x201, x, y)
    for selection in (0xFFFFFFFF, 7, 4):
        for y in (55, 75, 95, 115):
            fresh("hello", 2, 2, state={"hkl": 0x04110411, "vertical": True, "cands": {**VERT, "selection": selection}})
            mouse("M9 click at (160, %d) on the vertical candidate window, Japanese layout, the row %d selected" % (y, selection), 0x201, 160, y)
    for count in (0, 1, 2, 3, 4, 10):
        for y in (55, 75, 95, 115):
            for hkl in (0x04040404, 0x04110411, 0x04120412):
                fresh("hello", 2, 2, state={"hkl": hkl, "vertical": True, "cands": {**VERT, "count": count, "texts": ["t%d" % i for i in range(count)]}})
                mouse("M9 click at (160, %d) on the vertical candidate window of %d candidates, layout 0x%08X" % (y, count, hkl), 0x201, 160, y)
    for show in (False, True):
        for hkl in (0x04040404, 0x04110411):
            fresh("hello", 2, 2, state={"hkl": hkl, "vertical": True, "cands": {**VERT, "show": show, "rect": (20, 22, 100, 94)}})
            mouse("M9 click at (60, 50) on a candidate window over the box, shown %s, layout 0x%08X" % (show, hkl), 0x201, 60, 50)
    for uMsg in (0x203, 0x200, 0x202):
        fresh("hello", 2, 2, state={"hkl": 0x04040404, "vertical": True, "cands": VERT}, drag=(uMsg == 0x200))
        mouse("M9 message 0x%X at (160, 90) on the vertical candidate window, Chinese layout" % uMsg, uMsg, 160, 90)
    # the rows' height is the box's font's line (a click at y - top = 17, 18, 35, 36)
    for rect in ((120, 50, 200, 122), (120, 53, 200, 125), (120, 47, 200, 119)):
        for y in (65, 67, 68, 70, 71, 72, 83, 85, 89, 90, 91):
            fresh("hello", 2, 2, state={"hkl": 0x04040404, "vertical": True, "cands": {**VERT, "rect": rect}})
            mouse("M9 click at (160, %d) on the vertical candidate window whose top is %d, Chinese layout" % (y, rect[1]), 0x201, 160, y)
    # ---- a horizontal window (80 wide, a line high): "ab cde f ghij "
    HORI = dict(show=True, rect=(120, 50, 235, 68), count=4, selection=1, page=5, texts=["ab", "cde", "f", "ghij"], hori="ab cde f ghij ")
    for hname, hkl in HKLS.items():
        for x in (119, 120, 125, 131, 136, 145, 150, 160, 170, 180, 190, 198, 206, 215, 225, 234, 235):
            fresh("hello", 2, 2, state={"hkl": hkl, "vertical": False, "cands": HORI})
            mouse("M10 click at (%d, 55) on the horizontal candidate window, %s layout" % (x, hname), 0x201, x, 55)
    for y in (49, 50, 67, 68):
        fresh("hello", 2, 2, state={"hkl": 0x04040404, "vertical": False, "cands": HORI})
        mouse("M10 click at (150, %d) on the horizontal candidate window, Chinese layout" % y, 0x201, 150, y)
    for count in (0, 1, 2, 3, 4, 5, 10):
        for x in (122, 140, 160, 190, 220, 232):
            fresh("hello", 2, 2, state={"hkl": 0x04120412, "vertical": False, "cands": {**HORI, "count": count, "texts": ["ab", "cde", "f", "ghij", "k", "lm", "n", "op", "q", "r"][:count]}})
            mouse("M10 click at (%d, 55) on the horizontal candidate window of %d candidates, Korean layout" % (x, count), 0x201, x, 55)
    # ten one-letter candidates (the most the window has) under a line much wider than their widths: a click far on the line is past the last one
    for hname, hkl in (("Chinese", 0x04040404), ("Korean", 0x04120412), ("Japanese", 0x04110411)):
        for x in (130, 200, 300, 400, 500, 590):
            fresh("hello", 2, 2, state={"hkl": hkl, "vertical": False, "cands": {**HORI, "rect": (120, 50, 600, 68), "count": 10, "texts": list("abcdefghij"), "hori": "a" * 40}})
            mouse("M10 click at (%d, 55) on a wide horizontal window of ten one-letter candidates, %s layout" % (x, hname), 0x201, x, 55)
    for hori, texts in (("1ab 2cde 3f ", ["ab", "cde", "f"]), ("ab  cde", ["ab", "", "cde"]), ("", ["ab", "cde"]), ("abcdefghijklmnop", ["ab", "cde"]), ("ab cde f ghij ", ["abcdef", "g"])):
        for x in (122, 135, 150, 170, 200, 230):
            fresh("hello", 2, 2, state={"hkl": 0x04040404, "vertical": False, "cands": {**HORI, "hori": hori, "texts": texts, "count": len(texts)}})
            mouse("M10 click at (%d, 55) on the horizontal window %r of the candidates %s, Chinese layout" % (x, hori, texts), 0x201, x, 55)
    for scale in ((1.5, 0.75), (0.5, 2.0)):
        for x, y in ((200, 45), (240, 55), (100, 100), (150, 30), (300, 70)):
            fresh("hello", 2, 2, state={"hkl": 0x04040404, "vertical": False, "cands": HORI}, scale=scale)
            mouse("M10 click at the pixel (%d, %d) on the horizontal candidate window, scale %s, Chinese layout" % (x, y, scale), 0x201, x, y)
    # ---- both windows under the point: the composition string takes it
    for hkl in (0x04040404, 0x04110411):
        fresh("hello", 2, 2, state={**COMP, "hkl": hkl, "pt": (130, 55), "vertical": True, "cands": VERT}, imm={"himc": 5})
        mouse("M11 click at (140, 60), on both the composition string and the candidate window, layout 0x%08X" % hkl, 0x201, 140, 60)
        fresh("hello", 2, 2, state={**COMP, "hkl": hkl, "pt": (130, 55), "vertical": True, "cands": VERT}, imm={"himc": 5})
        mouse("M11 click at (140, 100), on the candidate window only, layout 0x%08X" % hkl, 0x201, 140, 100)

    # ================================================================ CheckToggleState (329361B0)
    LAYOUTS = {"Chinese (Taiwan)": 0x04040404, "Chinese (Taiwan, an IME with an id)": 0xE0080404, "Chinese (PRC)": 0x08040804, "Chinese (Hong Kong)": 0x0C040C04,
               "Chinese (Singapore)": 0x10041004, "Japanese": 0x04110411, "Korean": 0x04120412, "English": 0x04090409, "German": 0x04070407, "French": 0x040C040C,
               "Russian": 0x04190419, "a layout of one language and another's keyboard": 0x08090404,
               "Chinese (Taiwan, the Chang Jie IME)": 0xE0090404, "Chinese (PRC, the Pinyin IME with an id)": 0xE00E0804, "Chinese (PRC, another IME)": 0xE0040804}

    def is_chinese(hkl):
        return hkl & 0x3FF == 4

    def toggle_scenes(case, **kw):
        for lname, hkl in LAYOUTS.items():
            for last in (0, hkl, 0x04190419 if hkl != 0x04190419 else 0x04090409):
                for himc in (0, 5):
                    for is_ime in (False, True):
                        modes = [{}]
                        if himc and is_ime and is_chinese(hkl):
                            modes = [{"conv": (1, 0)}, {"conv": (0, 0)}, {"conv": (0x401, 8)}, {"conv": (0x400, 0)}]
                        elif himc and is_ime:
                            modes = [{"open_status": False}, {"open_status": True}]
                        for mode in modes:
                            fresh("hello", 2, 2, window={"hkl": hkl}, imm={"himc": himc, "is_ime": is_ime, **mode},
                                  state={**kw, "toggle_hkl": last, "hkl": 0x00010001, "ime_state": 7, "vertical": True, "chinese": True, "indicator_index": 4})
                            o.act("T1 %s on a %s layout (the last one seen 0x%08X), input context %d, an IME: %s, %s" % (case, lname, last, himc, is_ime, mode), "E", "toggle")
    toggle_scenes("CheckToggleState", enable=True)
    toggle_scenes("CheckToggleState with the IME system off", enable=False)
    for hkl in (0x04040404, 0x08040804, 0x04110411, 0x04090409):
        for state_hkl in (0, hkl, 0x7FFF7FFF):
            fresh("hello", 2, 2, window={"hkl": hkl}, imm={"himc": 5, "is_ime": True, "open_status": True, "conv": (1, 0)}, state={"hkl": state_hkl, "toggle_hkl": hkl})
            o.act("T2 CheckToggleState: the layout 0x%08X is the last seen, s_hklCurrent was 0x%08X" % (hkl, state_hkl), "E", "toggle")
    # the cache of GetImeId (asked for the simplified Chinese layouts only: the IMEs with an id name three layouts, which the host is asked about)
    for hkl in (0x08040804, 0xE00E0804, 0xE0040804, 0x08040409):
        for last in (0, 0x04190419):
            for ids in ((0, 0, 0), (hkl, 0, 0), (hkl, 5, 0), (hkl, 0, 9), (hkl, 5, 9), (0x04190419, 5, 9), (0, 5, 9)):
                for vertical in (False, True):
                    fresh("hello", 2, 2, window={"hkl": hkl}, imm={"himc": 5, "is_ime": True, "open_status": True, "conv": (1, 0)},
                          state={"toggle_hkl": last, "ids": ids, "vertical": vertical, "hkl": 0x00010001})
                    o.act("T4 CheckToggleState on the layout 0x%08X (the last one seen 0x%08X), GetImeId's cache holds (layout, ids) %s, vertical %s" % (
                        hkl, last, tuple(hex(v) for v in ids), vertical), "E", "toggle")
    # the third letter and the case: the indicator of a language is its name's first letter and the second one in lower case
    for name_, lcid in (("DEU", 0x0407), ("RUS", 0x0419), ("x", 0x0001), ("ABC", 0x0409), ("aBC", 0x0409), ("E1U", 0x0409), ("\u00c9NU", 0x0409), ("ab", 0x0409), ("Ab", 0x0409),
                        ("AB", 0x0409), ("abcd", 0x0409)):
        fresh("hello", 2, 2, window={"hkl": (lcid << 16) | lcid, "locales": {lcid: name_}}, imm={"himc": 0})
        o.act("T3 the indicator of the language %r" % name_, "E", "toggle")

    # ================================================================ OnFocusIn (329391F0)
    FOCUS_LAYOUTS = (("Chinese (Taiwan)", 0x04040404), ("Chinese (PRC)", 0x08040804), ("Japanese", 0x04110411), ("Korean", 0x04120412), ("English", 0x04090409))
    for enable in (True, False):
        for lname, hkl in FOCUS_LAYOUTS:
            for himc, is_ime, mode in ((0, False, {}), (0, True, {}), (5, False, {}), (5, True, {"open_status": False}), (5, True, {"open_status": True}),
                                        (5, True, {"conv": (0, 0)}), (5, True, {"conv": (1, 0)})):
                for imc_def in (0, 9):
                    if imc_def and himc == 0 and is_ime:
                        continue
                    fresh("hello", 2, 2, focus_in=11, window={"hkl": hkl}, imm={"himc": himc, "is_ime": is_ime, **mode},
                          state={"enable": enable, "imc_def": imc_def, "ime_state": 2})
                    o.act("F1 OnFocusIn, IME system %s, %s layout, input context %d, an IME: %s %s, default context %d, the state was 2" % (
                        "on" if enable else "off", lname, himc, is_ime, mode, imc_def), "E", "in")
    for focus_in in (-1, 0, 11):
        for has in (False, True):
            fresh("hello", 2, 2, focus_in=focus_in, has_focus=has, imm={"himc": 5, "is_ime": True, "open_status": True})
            o.act("F1 OnFocusIn, focus message %d, the box %s the flag" % (focus_in, "had" if has else "had not"), "E", "in")
    for toggle in (0, 0x04090409):
        fresh("hello", 2, 2, state={"toggle_hkl": toggle}, imm={"himc": 5, "is_ime": True, "open_status": True})
        o.act("F1 OnFocusIn, the last layout seen was 0x%08X (English is the thread's)" % toggle, "E", "in")
    # a click that takes the focus from another box of the dialog
    fresh("hello", 2, 2, has_focus=False, focus_in=11, boxes=[("F", dict(text="front", has_focus=True, focus_out=15, focus_in=16))], imm={"himc": 5, "is_ime": True, "open_status": True})
    o.focus("F")
    o.act("F1 OnFocusIn of E after F had the focus (F's flag stays: the dialog does not ask F)", "E", "in")

    # ================================================================ OnFocusOut (329392A0)
    COMPOSING = dict(comp="abc", comp_caret=2, attr=(1, 3, 3, 1, 3, 3, 7, 7, 7, 7, 7, 7), ime_state=1, hide_caret=True, first_target=1, clause=(0, 1, 3))
    for has in (True, False):
        for himc in (0, 5):
            for busy in (False, True):
                for focus_out in (-1, 9):
                    for drag in (False, True):
                        fresh("hello", 2, 2, has_focus=has, focus_out=focus_out, drag=drag, imm={"himc": himc}, state={**COMPOSING, "busy": busy})
                        o.act("F2 OnFocusOut, the box %s the flag, input context %d, cancelling already: %s, focus message %d, dragging %s" % (
                            "had" if has else "had not", himc, busy, focus_out, drag), "E", "out")
    for enable in (True, False):
        fresh("hello", 2, 2, has_focus=True, focus_out=9, imm={"himc": 5}, state={**COMPOSING, "enable": enable})
        o.act("F2 OnFocusOut with the IME system %s" % ("on" if enable else "off"), "E", "out")
    # ================================================================ the members
    LONG = "hello world again"
    # ---- ContainPTForEditBox (329331C0), which the IME box calls on itself
    for dpos, offset in (((10.0, 20.0), (0.0, 0.0)), ((10.25, 20.5), (0.75, 0.25)), ((-60.0, -40.0), (0.0, 0.0)), ((0.0, 0.0), (10.0, 20.0)), ((10.0, 20.0), (-10.0, -20.0))):
        for x, y in ((10, 20), (11, 21), (60, 30), (109, 39), (110, 40), (111, 41), (9, 30), (60, 19), (60, 41), (0, 0), (-5, -5), (300, 300), (-60, -40), (40, -20)):
            fresh("abc", dpos=dpos, offset=offset)
            o.act("C1 ContainPT at (%d, %d), the dialog at (%g, %g), the offset (%g, %g)" % (x, y, *dpos, *offset), "E", "contain", x & 0xFFFFFFFF, y & 0xFFFFFFFF)
    for rect in ((0, 0, 100, 20), (5, 5, 15, 9), (-20, -10, 50, 60), (0.5, 0.25, 99.75, 19.5), (30, 30, 30, 30)):
        for x, y in ((10, 20), (15, 25), (40, 35), (110, 40), (25, 30), (60, 30), (-10, 10), (60, 85)):
            fresh("abc", rect=rect)
            o.act("C1 ContainPT at (%d, %d), the rectangle %s" % (x, y, rect), "E", "contain", x & 0xFFFFFFFF, y & 0xFFFFFFFF)
    for scale in ((1.5, 0.75), (0.5, 2.0)):
        for x, y in ((10, 20), (60, 30), (110, 40), (150, 50)):
            fresh("abc", scale=scale)
            o.act("C1 ContainPT at (%d, %d), scale %s" % (x, y, scale), "E", "contain", x, y)
    # ---- PlaceCaret (32939B50): the first visible character follows the caret
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
    prefix = [ou.width_of(LONG[:n]) for n in range(len(LONG) + 1)]
    for first in (0, 2, 5):
        for cp in range(first + 1, first + 6):
            width = prefix[cp] - prefix[first]
            for delta in (-1, 0, 1):
                fresh(LONG, 2, 2, first=first, rc_text=(3, 0, 3 + width + delta, 20))
                o.act("P2 PlaceCaret(%d), first visible %d, the text rectangle %d wide%+d" % (cp, first, width, delta), "E", "place", cp)
    for cp in (3, 5, 8, 12):
        for k in range(1, cp):
            width = prefix[cp] - prefix[k]
            for delta in (-1, 0, 1):
                fresh(LONG, 2, 2, first=0, rc_text=(3, 0, 3 + width + delta, 20))
                o.act("P2 PlaceCaret(%d), first visible 0, the text rectangle %d wide%+d (the new left edge at character %d)" % (cp, width, delta, k), "E", "place", cp)
    # ---- ClearText (32936370)
    for text, caret, sel, first in (("hello", 3, 1, 2), ("", 0, 0, 0), (LONG, 17, 4, 9), ("a", 1, 1, 1)):
        for group in ((-1, -1), (1, 0)):
            fresh(text, caret, sel, first=first, rc_text=NARROW, group=group)
            o.act("X1 ClearText of %r, caret %d, selection from %d, first visible %d, group %s" % (text, caret, sel, first, group), "E", "clear")
    # ---- DeleteSelectionText (32936480)
    for caret, sel, first in ((2, 8, 0), (8, 2, 0), (3, 3, 0), (0, 17, 0), (17, 0, 9), (6, 12, 6), (12, 6, 9), (5, 5, 3), (16, 17, 10), (17, 16, 10), (0, 0, 0)):
        fresh(LONG, caret, sel, first=first, rc_text=NARROW, change=7)
        o.act("X2 DeleteSelectionText, caret %d, selection from %d, first visible %d" % (caret, sel, first), "E", "delete")
    for caret, sel, first in ((3, 30, 0), (30, 3, 0), (5, 9, 0), (9, 5, 2), (7, 7, 0)):
        fresh("hello", caret, sel, first=first, change=7)
        o.act("X2 DeleteSelectionText of hello, caret %d, selection from %d (beyond the text), first visible %d" % (caret, sel, first), "E", "delete")
    # ---- CopyToClipboard (329363A0): a selection of more characters than the text has would write behind the block the exe asks for: no scene
    for caret, sel in ((1, 3), (3, 1), (0, 5), (5, 0), (2, 2), (0, 0), (5, 5), (1, 6), (6, 1), (4, 6), (1, 5)):
        for tag, clip in (("holding old", {"text": "old"}), ("holding nothing", {}), ("busy", {"text": "old", "busy": True})):
            fresh("hello", caret, sel, clip=clip)
            o.act("X3 CopyToClipboard, caret %d, selection from %d, clipboard %s" % (caret, sel, tag), "E", "copy")
    fresh("", 0, 0, clip={"text": "old"})
    o.act("X3 CopyToClipboard of an empty text", "E", "copy")
    # ---- PasteFromClipboard (32939AC0)
    for paste in (True, False):
        for caret, sel in ((2, 2), (1, 3), (3, 1), (0, 0), (5, 5), (0, 5), (5, 0)):
            for tag, clip in (("xyz", {"text": "xyz"}), ("nothing", {}), ("busy", {"text": "xyz", "busy": True}), ("a block that cannot be locked", {"text": "xyz", "lock_fails": True}),
                              ("an empty text", {"text": ""}), ("two lines", {"text": "x\ny"}), ("a NUL inside", {"text": "x\0y"})):
                fresh("hello", caret, sel, clip=clip, change=7, enable_paste=paste)
                o.act("X4 PasteFromClipboard, paste %s, caret %d, selection from %d, clipboard holds %s" % ("enabled" if paste else "disabled", caret, sel, tag), "E", "paste")
    for tag, kw in (("length limit 7", {"length_limit": 7}), ("length limit 5", {"length_limit": 5}), ("a buffer of 7", {"size": 7}), ("one character mode", {"one_char": True}),
                    ("only digits", {"only_num": True}), ("width limit 30", {"width_limit": 30}), ("line limit 1", {"line_limit": 1}), ("a group", {"group": (1, 0)})):
        for caret, sel in ((2, 2), (1, 3), (5, 5)):
            fresh("hello" if "digits" not in tag else "12345", caret, sel, clip={"text": "xyz" if "digits" not in tag else "678"}, **kw)
            o.act("X4 PasteFromClipboard of 3 characters, %s, caret %d, selection from %d" % (tag, caret, sel), "E", "paste")
    fresh("hello world again", 2, 2, first=0, rc_text=NARROW, clip={"text": "0123456789"})
    o.act("X4 PasteFromClipboard in a narrow box", "E", "paste")
    fresh("hello world again", 12, 3, first=6, rc_text=NARROW, clip={"text": "01234"})
    o.act("X4 PasteFromClipboard over a selection in a narrow box", "E", "paste")
    # ---- SendCompString (3293AA90): every character of the composition string goes through MsgProc as WM_CHAR
    for enable in (True, False):
        for comp in ("xyz", "a", "", "ab\x08c", "\u4e2d\u6587", "x\ry", "\x01\x03\x18", "123"):
            for tag, kw in (("a short text", {}), ("a full box", {"length_limit": 6}), ("only digits", {"only_num": True}), ("a group", {"group": (1, 0)})):
                fresh("hello", 2, 2, change=7, enter=8, state={"enable": enable, "comp": comp}, **kw)
                o.act("Q1 SendCompString of %r, IME system %s, %s" % (comp, "on" if enable else "off", tag), "E", "sendcomp")
    for caret, sel in ((0, 0), (2, 4), (5, 5), (4, 1)):
        fresh("hello", caret, sel, change=7, state={"comp": "xy"})
        o.act("Q1 SendCompString of xy, caret %d, selection from %d" % (caret, sel), "E", "sendcomp")
    fresh("hello world again", 12, 12, rc_text=NARROW, state={"comp": "0123456789"})
    o.act("Q1 SendCompString of ten characters in a narrow box", "E", "sendcomp")
    # ---- IsKorean (32938780), SendKey (3293AB00)
    for hkl in (0x04120412, 0x04090409, 0x04110411, 0x00120012, 0x04520452, 0x04040404, 0, 0x0412, 0x00000012, 0x7FFF0012, 0x04130413, 0x04110012):
        fresh("hello", state={"hkl": hkl})
        o.act("Q2 IsKorean, the layout 0x%08X" % hkl, "E", "korean")
    for vk in (0x25, 0x41, 0x31, 0xFF, 0x100, 0x1FF, 0x228, 0, 0x7FFFFFFF):
        fresh("hello")
        o.act("Q3 SendKey(0x%X)" % vk, "E", "sendkey", vk)
    # ---- GetNowText (329371F0)
    for text in ("hello", "", "a b"):
        for hide in (False, True):
            for comp in ("", "xyz", "\u4e2d"):
                fresh(text, state={"hide_caret": hide, "comp": comp})
                o.act_text("Q4 GetNowText of %r, the IME hides the caret: %s, the composition string %r" % (text, hide, comp), "E")
    # ---- GetPrevIMEEditBox (32937300), GetNextIMEEditBox (32937150)
    ALL = [("F", dict(text="front", group=(2, 0))), ("G", dict(text="after", group=(2, 2))), ("H", dict(text="far", group=(2, 4))), ("I", dict(text="other", group=(3, 1))),
           ("J", dict(text="dup", group=(2, 2))), ("K", dict(text="none", group=(-1, 0))), ("L", dict(text="hidden", group=(2, 3), show=False)),
           ("M", dict(text="off", group=(2, 5), enable=False))]
    for what in ("prev", "next"):
        for group in ((2, 1), (2, 0), (2, 2), (2, 3), (2, 4), (2, 5), (2, 6), (3, 1), (3, 0), (-1, 0), (-1, -1), (2, -1), (4, 4)):
            fresh("hello", group=group, boxes=ALL)
            o.act("Q5 Get%sIMEEditBox of the box %s among the boxes %s" % (what.capitalize(), group, [(b[0], b[1]["group"]) for b in ALL]), "E", what)
    for what in ("prev", "next"):
        fresh("hello", group=(2, 1), boxes=ALL[:2][::-1])
        o.act("Q5 Get%sIMEEditBox of the box (2, 1), the dialog lists G before F" % what.capitalize(), "E", what)

    # ================================================================ what the IME says: WM_IME_ENDCOMPOSITION (0x10E), WM_IME_COMPOSITION (0x10F), WM_IME_NOTIFY (0x282)
    ALL = EXTRA_STATE_KEYS
    ENGLISH, TAIWAN, CHINA, JAPAN, KOREA, HK = 0x04090409, 0x04040404, 0x08040804, 0x04110411, 0x04120412, 0x0C040C04

    def msgx(case, uMsg, wParam=0, lParam=0, crash=False):
        return o.act(case, "E", "msg", uMsg, wParam, lParam, keys=ALL, crash=crash)

    # ---- 0x10E: the composition string is taken back out of the box (a Korean IME typed it in), cleared; the caret and the reading window go
    for on_type in (False, True):
        for insert in (True, False):
            for comp, ccaret in (("", 0), ("xyz", 0), ("xyz", 1), ("xyz", 3), ("abcde", 2), ("ab", 5)):
                for hide, reading in ((True, True), (False, False)):
                    fresh("hello", 2, 2, insert=insert, state={"insert_on_type": on_type, "comp": comp, "comp_caret": ccaret, "hide_caret": hide, "show_reading": reading,
                                                              "attr": (1, 3, 1, 3, 0, 7)})
                    msgx("W1 0x10E, insert on type %s, the box's insert mode %s, the composition %r with its caret at %d, caret hidden %s, reading shown %s"
                         % (on_type, insert, comp, ccaret, hide, reading), 0x10E, 0x1234, 0x5678)
    for tag, kw in (("disabled", {"enable": False}), ("hidden", {"show": False}), ("disabled and hidden", {"enable": False, "show": False})):
        for uMsg, wp, lp in ((0x10E, 0x1234, 0x5678), (0x10F, 0, 0x8B8), (0x282, 3, 0), (0x282, 0xE, 1)):
            fresh("hello", 2, 2, window={"hkl": KOREA}, imm={"himc": 77, "comp": comp_data(cursor=1, string="ab", result="xy", attr=[1, 3], clause=[0, 2]),
                                                          "cand": cand_list(["x", "yy"], selection=1)},
                  state={"hkl": KOREA, "insert_on_type": True, "comp": "old", "comp_caret": 1, "hide_caret": True, "show_reading": True}, **kw)
            msgx("W2 message 0x%X, wParam 0x%X, box %s" % (uMsg, wp, tag), uMsg, wp, lp)
    for uMsg, wp, lp in ((0x10E, 0x1234, 0x5678), (0x10F, 0, 0x8B8), (0x282, 3, 0), (0x282, 5, 0), (0x282, 4, 0), (0x282, 6, 0), (0x282, 0xE, 1)):
        for tag, kw in (("", {}), (", disabled", {"enable": False}), (", hidden", {"show": False})):
            fresh("hello", 2, 2, window={"hkl": KOREA}, imm={"himc": 77, "comp": comp_data(cursor=1, string="ab", result="xy", attr=[1, 3], clause=[0, 2]),
                                                          "cand": cand_list(["x", "yy"], selection=1)},
                  state={"enable": False, "hkl": KOREA, "insert_on_type": True, "comp": "old", "comp_caret": 1, "hide_caret": True, "show_reading": True}, **kw)
            msgx("W3 message 0x%X, wParam 0x%X, IME system off%s: the box's own EBProc" % (uMsg, wp, tag), uMsg, wp, lp)

    for uMsg in (0x10D, 0x10C, 0x110, 0x281, 0x283, 0x80000282, 0x1000010E, 0x1000010F):
        fresh("hello", 2, 2, window={"hkl": KOREA}, imm={"himc": 77, "comp": comp_data(cursor=1, string="ab", result="xy", attr=[1, 3], clause=[0, 2]), "cand": cand_list(["x", "yy"], selection=1)},
              state={"hkl": KOREA, "insert_on_type": True, "comp": "old", "comp_caret": 1, "hide_caret": True, "show_reading": True})
        msgx("W4 message 0x%X goes to EBProc, which is for characters only" % uMsg, uMsg, 3, 0x88)
    # TruncateCompString by itself: the keys that take the composition string a Korean IME typed out of the box
    for on_type in (False, True):
        for insert in (True, False):
            for old in ("", "a", "abc", "abcde"):
                for ccaret in sorted({0, 1, len(old), len(old) + 1}):
                    for backspace, length in ((True, 0), (True, 5), (False, -1), (False, 0), (False, 1), (False, 2), (False, len(old)), (False, len(old) + 1), (False, 7)):
                        fresh("hello", 2, 2, insert=insert, state={"insert_on_type": on_type, "comp": old, "comp_caret": ccaret})
                        o.act("W5 TruncateCompString(%s, %d), insert on type %s, the box's insert mode %s, the composition %r with its caret at %d" % (backspace, length, on_type, insert, old, ccaret),
                              "E", "trunc", int(backspace), length, keys=ALL)

    # ---- 0x10F: what the IME has of the composition, by the bits of lParam
    def comp_scene(case, lParam, comp, hkl=ENGLISH, on_type=False, insert=True, old="", ccaret=0, himc=77, force=False, change=-1, state=None, crash=False, text="hello",
                   caret=2, **kw):
        fresh(text, caret, caret, insert=insert, force_change=force, change=change, window={"hkl": hkl}, imm={"himc": himc, "comp": comp},
              state={"hkl": hkl, "insert_on_type": on_type, "comp": old, "comp_caret": ccaret, **(state or {})}, **kw)
        return msgx(case, 0x10F, 0, lParam, crash=crash)

    FULL = comp_data(cursor=2, string="ab\u4e2d", result="xy", attr=[1, 3, 1], clause=[0, 2, 3])
    for lParam in (0x80, 0x800, 0x8, 0x10, 0x20, 0x8B8, 0):
        comp_scene("R1 0x10F lParam 0x%X without an input context" % lParam, lParam, FULL, himc=0, on_type=True, old="old", ccaret=1, hkl=KOREA, force=True, change=7)
    for lParam in (0x1, 0x2, 0x4, 0x100, 0x200, 0x400, 0x1000, 0x2000, 0x4000, 0x7C47, 0xFFFF7C47):
        comp_scene("R1 0x10F lParam 0x%X: nothing the box looks at" % lParam, lParam, FULL, on_type=True, old="old", ccaret=1, hkl=KOREA, force=True, change=7)
    # the caret of the composition
    for cursor in (0, 1, 2, 5, 40, -1, -2, 0x7FFFFFFF, -0x80000000):
        for ccaret in (0, 3):
            comp_scene("R2 GCS_CURSORPOS %d, the caret of the composition was %d" % (cursor, ccaret), 0x80, comp_data(cursor=cursor, string="abc"), ccaret=ccaret, old="abcd")
    comp_scene("R2 the cursor is not asked for (0x38): the caret stays", 0x38, comp_data(cursor=4, string="ab", attr=[1], clause=[0, 2]), ccaret=3, old="abcd")
    # the result and the composition strings
    NEW = ("xyz", "a", "\u4e2d\u6587\u5b57", "abcdef")
    for flag, tag in ((0x800, "GCS_RESULTSTR"), (0x8, "GCS_COMPSTR")):
        for on_type in (False, True):
            for insert in (True, False):
                for old in ("", "pre", "abcde"):
                    for ccaret in sorted({0, 2, len(old)}):
                        if ccaret > len(old):
                            continue
                        for new in NEW:
                            if flag == 8 and on_type and ccaret > len(new):
                                continue  # (the exe measures what stands behind the string: not modelled)
                            comp_scene("R3 %s %r, insert on type %s, the box's insert mode %s, the composition was %r with its caret at %d" % (tag, new, on_type, insert, old, ccaret),
                                       flag, comp_data(**{"result" if flag == 0x800 else "string": new}), hkl=KOREA if on_type else ENGLISH, on_type=on_type, insert=insert,
                                       old=old, ccaret=ccaret)
    # the sizes of the strings
    EDGES = (  # (what, the IME's answer, the characters the exe makes of it)
        ("an empty text", "", 0), ("one byte", b"x", 0), ("three bytes", b"x\0y", 1), ("a NUL inside", "ab\0cd", 2), ("a NUL first", "\0ab", 0), ("an error", -1, 0),
        ("another error", -2, 0), ("255 characters", "k" * 255, 255), ("511 bytes", ("m" * 255).encode("utf-16-le") + b"n", 255), ("254 characters", "j" * 254, 254),
        ("one character", "\u4e2d", 1),
    )
    for flag, tag in ((0x800, "GCS_RESULTSTR"), (0x8, "GCS_COMPSTR")):
        for on_type in (False, True):
            for etag, data, n in EDGES:
                comp_scene("R3 %s of %s, insert on type %s" % (tag, etag, on_type), flag, comp_data(**{"result" if flag == 0x800 else "string": data}),
                           hkl=KOREA if on_type else ENGLISH, on_type=on_type, insert=False, old="pre", ccaret=min(2, n), size=300 if "character" in etag else 64)
    for flag, tag in ((0x800, "GCS_RESULTSTR"), (0x8, "GCS_COMPSTR")):
        for on_type in (False, True):
            for etag, data in (("512 bytes", "q" * 256), ("600 bytes", "r" * 300), ("0x201 bytes", ("s" * 256).encode("utf-16-le") + b"t")):
                comp_scene("R3 %s of %s ends the exe, insert on type %s" % (tag, etag, on_type), flag, comp_data(**{"result" if flag == 0x800 else "string": data}),
                           hkl=KOREA if on_type else ENGLISH, on_type=on_type, old="pre", ccaret=2, crash=True)
    # the composition string and the change message
    for force in (False, True):
        for change in (-1, 7):
            for tag, comp in (("ab", comp_data(string="ab")), ("nothing", comp_data()), ("an error", comp_data(string=-1))):
                for caret_on in (False, True):
                    comp_scene("R4 GCS_COMPSTR %s, forced change message %s with the message %d, the caret on %s" % (tag, force, change, caret_on), 0x8, comp, force=force, change=change,
                               old="old", ccaret=1, caret_on=caret_on)
    comp_scene("R4 GCS_RESULTSTR does not blink and sends no change message of its own", 0x800, comp_data(result="ab"), force=True, change=7, old="old", ccaret=1, caret_on=False)
    # the Taiwanese IME without an id: the first five characters of the composition are the reading
    STALE = {"show_reading": False, "reading": "stale", "cands": {"count": 9, "selection": 2, "page": 7, "reading_error": 3, "texts": ["p%d" % i for i in range(8)], "show": True,
                                                                     "first_selected": 4, "hori_len": 5, "hori": "oldline"}}
    for hkl, ids, tag in ((TAIWAN, (0, 0, 0), "Taiwan, no id"), (0xE0080404, (0, 0, 0), "a phonetic IME layout, its file unknown"), (0x00000404, (0, 0, 0), "language 0x0404 only"),
                          (CHINA, (0, 0, 0), "China"), (HK, (0, 0, 0), "Hong Kong"), (TAIWAN, (TAIWAN, 0x4010804, 0), "Taiwan, an id"), (TAIWAN, (TAIWAN, 0, 5), "Taiwan, the id 0 and a revision"),
                          (0x04040409, (0, 0, 0), "the language 0x0409 of a Taiwanese layout"), (0x0404040A, (0, 0, 0), "the language 0x040A"), (JAPAN, (0, 0, 0), "Japan"),
                          (0x04050405, (0, 0, 0), "the language 0x0405 (Czech)"), (0x04040405, (0, 0, 0), "the language 0x0405 of a Taiwanese layout"),
                          (0x04030403, (0, 0, 0), "the language 0x0403"), (0x84048404, (0, 0, 0), "the language 0x8404")):
        for new in ("a", "ab", "abcde", "abcdefg", "\u4e2d\u6587", "\u4e2d\u6587\u5b57\u8a5e\u5178\u7684"):
            comp_scene("R5 GCS_COMPSTR %r, %s" % (new, tag), 0x8, comp_data(string=new), hkl=hkl, old="old", ccaret=0, state={**STALE, "ids": ids})
        for etag, data in (("empty (a NUL first)", b"\0\0"), ("one byte", b"x")):
            for shown in (False, True):
                comp_scene("R5 GCS_COMPSTR %s, %s, the reading window %s" % (etag, tag, "shown" if shown else "hidden"), 0x8, comp_data(string=data), hkl=hkl, old="old", ccaret=0,
                           state={**STALE, "ids": ids, "show_reading": shown})
    for new in ("ab", "abcdefg"):
        for insert in (True, False):
            comp_scene("R5 GCS_COMPSTR %r, Taiwan, no id, insert on type on, the box's insert mode %s" % (new, insert), 0x8, comp_data(string=new), hkl=TAIWAN, on_type=True, insert=insert,
                       old="old", ccaret=0, state=STALE)
    comp_scene("R5 GCS_RESULTSTR 'ab', Taiwan, no id: no reading", 0x800, comp_data(result="ab"), hkl=TAIWAN, old="old", ccaret=0, state=STALE)
    for new, cursor in (("abcdefg", 5), ("abcdefg", 4), ("abcdefg", 7), ("abcdefg", 3), ("abcdefg", 0), ("abcdefghijkl", 6), ("abcde", 4), ("abcde", 5), ("abcd", 4), ("abcd", 3), ("ab", 2),
                        ("ab", 0), ("abcdefghij", 9)):
        for insert in (True, False):
            comp_scene("R5 GCS_COMPSTR %r with the cursor %d, Taiwan, no id, insert on type on, the box's insert mode %s" % (new, cursor, insert), 0x88, comp_data(cursor=cursor, string=new),
                       hkl=TAIWAN, on_type=True, insert=insert, old="old", ccaret=0, state=STALE)
    # the attributes and the clauses
    ATTRS = (([1, 3, 1, 1, 3, 0, 7], "7 attributes"), ([5], "1 attribute"), ([], "none"), (list(range(1, 200)), "199 attributes"), ([9] * 255, "255 attributes"), ([4] * 128, "128 attributes"))
    for attr, tag in ATTRS:
        comp_scene("R6 GCS_COMPATTR, %s" % tag, 0x10, comp_data(attr=attr), old="old", ccaret=1, state={"attr": (2,) * 40})
    comp_scene("R6 GCS_COMPATTR, an error", 0x10, {0x10: -1}, old="old", ccaret=1, state={"attr": (2,) * 40})
    comp_scene("R6 GCS_COMPATTR, 256 attributes end the exe", 0x10, comp_data(attr=[9] * 256), old="old", ccaret=1, state={"attr": (2,) * 40}, crash=True)
    comp_scene("R6 GCS_COMPATTR, 300 attributes end the exe", 0x10, comp_data(attr=[8] * 300), old="old", ccaret=1, state={"attr": (2,) * 40}, crash=True)
    CLAUSES = (([0, 2, 3], "3 clauses"), ([4], "1 clause"), ([], "none"), ([7] * 12, "12 clauses"), ([7] * 13, "13 clauses"), (list(range(1, 256)), "255 clauses"), ([6] * 100, "100 clauses"))
    for clause, tag in CLAUSES:
        comp_scene("R7 GCS_COMPCLAUSE, %s" % tag, 0x20, comp_data(clause=clause), old="old", ccaret=1, state={"clause": (9,) * 20})
    # an error is the unsigned index 0x3FFFFFFF, and the array is written at its address minus 4 (32 bits wrap): the last four attributes, which precede it
    for error in (-1, -2, -3, -4, -5, -100, -255, -256):
        comp_scene("R7 GCS_COMPCLAUSE, the error %d: the 0 goes %d bytes before the array" % (error, -(error & ~3)), 0x20, {0x20: error}, old="old", ccaret=1,
                   state={"clause": (9,) * 20, "attr": (2,) * 256})
    # all the bits together, with the Korean IME and without
    for lParam in (0x80 | 0x800, 0x80 | 0x8, 0x800 | 0x8, 0x80 | 0x800 | 0x8, 0xB8, 0xB8 | 0x1000, 0x38, 0x18, 0x28, 0x30, 0x88, 0x808, 0x890, 0x8A0, 0x98, 0xA8, 0x1B8):
        for on_type in (False, True):
            for hkl in ((KOREA, TAIWAN) if on_type else (ENGLISH, TAIWAN)):
                comp_scene("R8 0x10F lParam 0x%X, insert on type %s, layout 0x%08X" % (lParam, on_type, hkl), lParam,
                           comp_data(cursor=1, string="ab", result="xyz", attr=[1, 3], clause=[0, 1, 2]), hkl=hkl, on_type=on_type, insert=False, old="pre", ccaret=2,
                           force=True, change=7, state={"attr": (2,) * 12, "clause": (9,) * 12})


    # ---- 0x282: IMN_CHANGECANDIDATE / IMN_OPENCANDIDATE (3, 5), IMN_CLOSECANDIDATE (4), IMN_SETCONVERSIONMODE / IMN_SETOPENSTATUS (6, 8), IMN_PRIVATE (0xE)
    PREV = {"count": 9, "selection": 5, "page": 7, "reading_error": 3, "texts": ["p%d" % i for i in range(10)], "show": False, "first_selected": 4, "hori_len": 5, "hori": "oldline"}

    def cand_scene(case, wParam, lParam=0, hkl=ENGLISH, vertical=False, cand=None, ids=None, himc=77, state=None, crash=False, text="hello", **kw):
        st = {"hkl": hkl, "vertical": vertical, "cands": dict(PREV), "show_reading": True, "reading": "rd", **(state or {})}
        if ids is not None:
            st["ids"] = (hkl, ids, 0)
        fresh(text, 2, 2, window={"hkl": hkl}, imm={"himc": himc, "cand": cand}, state=st, **kw)
        return msgx(case, 0x282, wParam, lParam, crash=crash)

    TWELVE = ["c%d" % i for i in range(12)]
    HKLS = ((ENGLISH, None, "English"), (TAIWAN, None, "Taiwan, no id"), (TAIWAN, 0x4010804, "Taiwan, an id"), (CHINA, None, "China, no id"), (CHINA, 0x5030804, "China, an id"),
            (JAPAN, None, "Japan"), (KOREA, None, "Korea"), (HK, None, "Hong Kong"))
    LISTS = (
        ("three candidates, the second selected", ["x", "yy", "zzz"], 1, 0, 10, None), ("three, none selected (-1)", ["x", "yy", "zzz"], -1, 0, 10, None),
        ("twelve, the page from 10, the last selected", TWELVE, 11, 10, 10, None), ("twelve, pages of 5, the 8th selected, the page from 5", TWELVE, 7, 5, 5, None),
        ("twelve, a page of 12 (the window shows 10)", TWELVE, 2, 0, 12, None), ("the selection behind the end", ["a", "b", "c"], 20, 0, 10, None),
        ("count 2 of 3 texts", ["a", "b", "c"], 0, 0, 10, 2), ("the page starts behind the count", ["a", "b", "c"], 1, 5, 10, None), ("no candidate", [], 0, 0, 10, None),
        ("twelve, pages of 3, the 5th selected, the page from 3", TWELVE, 4, 3, 3, None), ("ten, the 10th selected (its number is 0)", TWELVE[:10], 9, 0, 10, None),
        ("one candidate, a page of 1", ["only"], 0, 0, 1, None), ("twelve, a page of 0", TWELVE, 3, 0, 0, None),
    )

    def entries(hkl, texts, selection, page_start, page_size, count):
        size = min(page_size, 10)
        n = len(texts) if count is None else count
        if hkl & 0x3FF == 0x11:
            if size == 0:
                return None  # (a division by 0: the exe has an exception, not a scene)
            start = size * ((selection & 0xFFFFFFFF) // size)
        else:
            start = page_start
        return max(0, min(n - start, size)) if start < n else 0

    # the layouts a mask of the language would take for Chinese (0x405 for 0x404, 0x805 for 0x804) or Korean (primary language 0x13 for 0x12): a few lists each
    NEAR = ((0x04050405, None, "language 0x0405"), (0x08050805, None, "language 0x0805"), (0x04130413, None, "language 0x0413"), (0x04100410, None, "language 0x0410"))
    for hkl, ident, htag in HKLS + NEAR:
        for vertical in (False, True):
            for ltag, texts, selection, page_start, page_size, count in LISTS:
                if (hkl, ident, htag) in NEAR and not ltag.startswith(("three candidates", "three, none", "twelve, the page from 10", "twelve, pages of 5")):
                    continue
                n = entries(hkl, texts, selection, page_start, page_size, count)
                if n is None:
                    continue
                for wParam in (3, 5):
                    cand_scene("N1 IMN_%s, %s, %s window, %s" % ("CHANGECANDIDATE" if wParam == 3 else "OPENCANDIDATE", htag, "vertical" if vertical else "horizontal", ltag), wParam, hkl=hkl,
                               vertical=vertical, ids=ident, cand=cand_list(texts, selection, page_start, page_size, count), crash=n == 0 and not vertical)
    for vertical in (False, True):
        for show in (False, True):
            for wParam in (3, 5):
                cand_scene("N2 candidates without an input context, %s window, reading shown %s" % ("vertical" if vertical else "horizontal", show), wParam, vertical=vertical, himc=0,
                           cand=cand_list(["x", "yy"], 1), state={"show_reading": show})
                cand_scene("N2 candidates, the IME has no list (size 0), %s window, reading shown %s" % ("vertical" if vertical else "horizontal", show), wParam, vertical=vertical,
                           cand=None, state={"show_reading": show})
    # the texts: long ones, the line of the candidates (31 characters an entry, 255 the line)
    LONGS = (
        ("ten of 27 characters", ["%02d" % i + "k" * 25 for i in range(10)]), ("one of 28", ["m" * 28]), ("one of 29", ["n" * 29]), ("one of 30", ["o" * 30]), ("one of 40", ["p" * 40]),
        ("one of 100 and a short one", ["q" * 100, "r"]), ("one of 253 (the longest that fits)", ["s" * 253]), ("a pair of surrogates", ["\U0001F600x", "y"]),
        ("a percent sign", ["5%d", "%s%%"]), ("ten of 24", ["t" * 24] * 10), ("ten of 23", ["u" * 23] * 10), ("ten of 26", ["v" * 26] * 10), ("nine of 20 and one of 30", ["w" * 20] * 9 + ["z" * 30]),
        ("ten of 21", ["a" * 21] * 10),
    )
    for ltag, texts in LONGS:
        for vertical in (False, True):
            for selection in (0, 3, len(texts) - 1):
                cand_scene("N3 candidates of %s, %s window, the %dth selected" % (ltag, "vertical" if vertical else "horizontal", selection + 1), 3, vertical=vertical,
                           cand=cand_list(texts, selection, 0, 10), hkl=ENGLISH)
    cand_scene("N3 candidates of 254 characters in a vertical window" + "", 3, vertical=True, cand=cand_list(["x" * 253], 0, 0, 10), hkl=ENGLISH)
    # the window is closed
    for reading in (False, True):
        for count in (0, 3, 9):
            for show in (False, True):
                cand_scene("N4 IMN_CLOSECANDIDATE, %d candidates, window shown %s, reading shown %s" % (count, show, reading), 4, state={"show_reading": reading, "cands": {**PREV, "count": count, "show": show}})
    # the IME's mode changes
    for hkl, is_ime, opened, conv in ((JAPAN, True, True, (9, 0)), (JAPAN, True, False, (1, 0)), (KOREA, True, True, (1, 0)), (CHINA, False, False, (0, 0)), (ENGLISH, False, False, (0, 0)),
                                      (TAIWAN, True, True, (1, 0)), (TAIWAN, True, False, (1, 0)), (CHINA, True, True, (1, 0))):
        for wParam in (6, 8):
            fresh("hello", 2, 2, window={"hkl": hkl}, imm={"himc": 5, "is_ime": is_ime, "open_status": opened, "conv": conv}, state={"hkl": 0})
            msgx("N5 IMN_%s, layout 0x%08X, IME %s, open %s, conversion %s" % ("SETCONVERSIONMODE" if wParam == 6 else "SETOPENSTATUS", hkl, is_ime, opened, conv), 0x282, wParam, 0)
    fresh("hello", 2, 2, window={"hkl": JAPAN}, imm={"himc": 0, "is_ime": True, "open_status": True}, state={"hkl": 0})
    msgx("N5 IMN_SETOPENSTATUS without an input context", 0x282, 8, 0)
    # IMN_PRIVATE: the IMEs that have an id
    IDS = (0, 1, 0x4010804, 0x4020404, 0x4020804, 0x4030404, 0x4040404, 0x4010805, 0x4040403, 0x4010803, 0x5000404, 0x5010404, 0x5020404, 0x5030804, 0x6000404, 0x5000403, 0x5000405,
           0x5030803, 0x5030805, 0x6000403, 0x6000405, 0x4040405, 0x4050404, 0x3000404, 0x7000404, 0xFFFFFFFF, 0x80000000, 0x5010405)
    for ident in IDS:
        for lParam in (0, 1, 2, 3, 0x10, 0x11, 0x12, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x100, 0xFFFFFFFF):
            cand_scene("N6 IMN_PRIVATE with the id 0x%X, lParam 0x%X, the candidate window shown" % (ident, lParam), 0xE, lParam, hkl=TAIWAN, ids=ident, state={"cands": {**PREV, "show": True}})
    for ident, himc in ((0, 0), (0, 77), (0x4010804, 0), (0x5000404, 0), (0x4010804, 5)):
        for reading in (False, True):
            if ident != 0 and himc != 0:
                continue
            for lParam in (1, 0x10, 5):
                cand_scene("N6 IMN_PRIVATE with the id 0x%X, lParam 0x%X, the window not shown, input context %d, reading shown %s" % (ident, lParam, himc, reading), 0xE, lParam, hkl=TAIWAN, ids=ident,
                           himc=himc, state={"show_reading": reading})
    for wParam in (0, 1, 2, 7, 9, 0xA, 0xB, 0xC, 0xD, 0xF, 0x10, 0x11, 0x100, 0x7FFFFFFF, 0xFFFFFFFF, 0x80000003, 0x10000003):
        cand_scene("N7 IMN 0x%X: taken, nothing done" % wParam, wParam, 0x12, hkl=KOREA, cand=cand_list(["x", "yy"], 1), state={"show_reading": True})

    # ---- the list of the keyboard layouts (WM_ACTIVATEAPP), WM_INPUTLANGCHANGE: StaticMsgProc (3293AF10)
    def static_scene(case, uMsg, wParam, layouts=None, is_ime=False, hkl=ENGLISH, locales=None, languages=None, state=None, himc=0, enable=True, opened=False):
        fresh("hello", 2, 2, window={"hkl": hkl, "layouts": layouts, "locales": locales, "languages": languages},
              imm={"himc": himc, "is_ime": is_ime, "open_status": opened}, state={"hkl": hkl, "enable": enable, **(state or {})})
        return o.act(case, "E", "static", uMsg, wParam, keys=ALL)

    TAKEN = {"comp": "xyz", "comp_caret": 2, "attr": (1, 3, 1), "hide_caret": False, "locales": ((0x04090409, "ab", "stale"),)}
    for enable in (True, False):
        for uMsg in (0x1C, 0x10D, 0x51, 0x10E, 0x10F, 0x282, 0x110, 0xFFFFFFFF, 0x80000000, 0, 1, 0x1B, 0x1D, 0x50, 0x52, 0x10C, 0x100, 0x102):
            for wParam in (0, 1):
                static_scene("L1 StaticMsgProc 0x%X, wParam %d, IME system %s" % (uMsg, wParam, "on" if enable else "off"), uMsg, wParam, layouts=[ENGLISH, TAIWAN], is_ime=True,
                             enable=enable, state=TAKEN)
    LAYOUT_SETS = (
        ("English only", [ENGLISH], False), ("five layouts, IMEs", [ENGLISH, TAIWAN, CHINA, JAPAN, KOREA], True), ("five layouts, no IMEs", [ENGLISH, TAIWAN, CHINA, JAPAN, KOREA], False),
        ("a layout twice", [ENGLISH, ENGLISH], True), ("a layout twice in the middle", [ENGLISH, CHINA, ENGLISH, JAPAN], True),
        ("the same language, another high word", [ENGLISH, 0x08090409, JAPAN], True), ("European layouts", [0x04070407, 0x040C040C, 0x04190419, 0x00010001], False),
        ("Hong Kong and Singapore", [HK, 0x10041004], True), ("Hong Kong and Singapore, no IMEs", [HK, 0x10041004], False), ("no layouts", [], True),
        ("layouts of the old Chinese phonetic IMEs", [0xE0080404, 0xE0090804], True), ("Japanese, Korean and Taiwan IMEs", [JAPAN, KOREA, TAIWAN], True),
        ("Korean, Japanese, Korean again", [KOREA, JAPAN, KOREA], True), ("Taiwan then Hong Kong", [TAIWAN, HK], True), ("China then Singapore", [CHINA, 0x10041004], True),
        ("Japanese without an IME, then English", [JAPAN, ENGLISH], False), ("Chinese of sublanguage 0", [0x00040004, 0x00000004], True),
    )
    for tag, layouts, is_ime in LAYOUT_SETS:
        for prefilled in (False, True):
            static_scene("L2 WM_ACTIVATEAPP with %s%s" % (tag, ", a list from before" if prefilled else ""), 0x1C, 1, layouts=layouts, is_ime=is_ime,
                         state={"locales": ((0x04190419, "ru", "old"), (0x04070407, "de", "older")) if prefilled else ()})
    static_scene("L2 WM_ACTIVATEAPP with 17 layouts", 0x1C, 1, layouts=[0x04090409, 0x04070407, 0x040C040C, 0x04190419, 0x00010001, 0x0C040C04, 0x10041004, 0x08040804, 0x04040404, 0x04110411,
                                                                         0x04120412, 0x04100410, 0x04150415, 0x04160416, 0x040A040A, 0x04140414, 0x04130413], is_ime=True,
                 languages={**LANGUAGES, 0x0410: "Italian", 0x0415: "Polish"}, locales={**LOCALES, 0x0410: "ITA", 0x0415: "PLK", 0x0416: "PTB", 0x040A: "ESP", 0x0414: "NOR", 0x0413: "NLD"})
    for tag, locales, languages in (
        ("the abbreviation fails", {}, None), ("the language name fails: the buffer keeps the abbreviation", None, {}), ("both fail", {}, {}), ("a one-letter abbreviation", {0x0409: "x"}, None),
        ("a two-letter abbreviation", {0x0409: "xy"}, None), ("a four-letter abbreviation", {0x0409: "abcd"}, None), ("an upper-case second letter", {0x0409: "ABC"}, None),
        ("a name of 62 characters", None, {0x0409: "n" * 62}), ("a name of 63", None, {0x0409: "n" * 63}), ("a name of 64", None, {0x0409: "n" * 64}), ("a name of 70", None, {0x0409: "n" * 70}),
        ("an empty name", None, {0x0409: ""}), ("an empty abbreviation", {0x0409: ""}, None), ("digits in the abbreviation", {0x0409: "1A2"}, None),
    ):
        static_scene("L3 WM_ACTIVATEAPP, English then German, %s" % tag, 0x1C, 1, layouts=[ENGLISH, 0x04070407, JAPAN], is_ime=False, locales={**LOCALES, **(locales if locales is not None else {})} if locales != {} else {},
                     languages={**LANGUAGES, **(languages if languages is not None else {})} if languages != {} else {})
    static_scene("L3 WM_ACTIVATEAPP, the names of the CJK layouts fail", 0x1C, 1, layouts=[JAPAN, KOREA, TAIWAN, CHINA], is_ime=True, locales={}, languages={})
    static_scene("L3 WM_ACTIVATEAPP, the names of the CJK layouts are 70 characters", 0x1C, 1, layouts=[JAPAN, KOREA], is_ime=True, languages={0x0411: "j" * 70, 0x0412: "k" * 5})
    for before in (0, ENGLISH, KOREA, JAPAN):
        for now in (ENGLISH, KOREA, JAPAN, TAIWAN, 0x08120412):
            for is_ime in (True, False):
                for ins in (False, True):
                    static_scene("L4 WM_INPUTLANGCHANGE, the layout was 0x%08X and is 0x%08X, IME %s, insert on type was %s" % (before, now, is_ime, ins), 0x51, 0, hkl=now, is_ime=is_ime,
                                 state={"hkl": before, "insert_on_type": ins}, himc=5, opened=is_ime)
    for himc in (0, 5):
        static_scene("L4 WM_INPUTLANGCHANGE of a Japanese IME, input context %d" % himc, 0x51, 7, hkl=JAPAN, is_ime=True, state={"hkl": KOREA, "insert_on_type": True}, himc=himc, opened=True)

    # ---- the box that hands a character over to the next box of its group, with an input context
    def hand_scene(case, comp, himc=77, focus=None, state=None, crash=False, ch="x", **kw):
        fresh("abc", 3, 3, length_limit=3, group=(2, 0), change=7, focus_out=15, focus_in=14, window={"hkl": KOREA}, imm={"himc": himc, "comp": comp},
              boxes=[("F", dict(text="next", group=(2, 1), focus_in=16, focus_out=17, change=9))], state={"hkl": KOREA, "comp": "old", **(state or {})}, **kw)
        if focus:
            o.focus(focus)
        return o.act(case, "E", "msg", 0x102, ord(ch), 0x12345678, keys=ALL, crash=crash)

    HANDS = (("no string", comp_data()), ("ab", comp_data(string="ab")), ("a NUL inside", comp_data(string="ab\0cd")), ("a NUL first", comp_data(string=b"\0\0")), ("one byte", comp_data(string=b"x")),
             ("an error", comp_data(string=-1)), ("255 characters", comp_data(string="k" * 255)), ("511 bytes", comp_data(string=("m" * 255).encode("utf-16-le") + b"n")),
             ("an empty text", comp_data(string="")), ("\u4e2d\u6587", comp_data(string="\u4e2d\u6587")))
    for tag, comp in HANDS:
        for himc in (0, 77):
            for focus in (None, "E", "Y", "F"):
                hand_scene("H1 a character handed to the next box, the IME's composition string is %s, input context %d, the focus is %s" % (tag, himc, focus), comp, himc=himc, focus=focus)
    for tag, comp in (("512 bytes", comp_data(string="q" * 256)), ("0x201 bytes", comp_data(string=("s" * 256).encode("utf-16-le") + b"t"))):
        for focus in (None, "E"):
            hand_scene("H2 a character handed to the next box, the IME's composition string is %s: it ends the exe, the focus is %s" % (tag, focus), comp, focus=focus, crash=True)
    for ch in ("y", "\u4e2d"):
        hand_scene("H1 the character %r handed to the next box, the composition string ab" % ch, comp_data(string="ab"), ch=ch)
    # the box beyond: not the next of the sequence, the next that is full
    fresh("abc", 3, 3, length_limit=3, group=(2, 0), change=7, window={"hkl": KOREA}, imm={"himc": 77, "comp": comp_data(string="ab")}, state={"hkl": KOREA, "comp": "old"},
          boxes=[("F", dict(text="far", group=(2, 2)))])
    o.act("H3 a character that does not fit, the next box of the group is none", "E", "msg", 0x102, ord("x"), 0x12345678, keys=ALL)
    fresh("abc", 3, 3, length_limit=3, group=(2, 0), change=7, window={"hkl": KOREA}, imm={"himc": 77, "comp": comp_data(string="ab")}, state={"hkl": KOREA, "comp": "old"},
          boxes=[("F", dict(text="abc", length_limit=3, group=(2, 1))), ("G", dict(text="", group=(2, 2)))])
    o.act("H3 a character that does not fit, the next box is full, too: it is handed on to no one", "E", "msg", 0x102, ord("x"), 0x12345678, keys=ALL)

    # ---- GetPrivateReadingString (329373A0)
    for ident, himc in ((0, 0), (0, 77), (0x4010804, 0), (0x5000404, 0), (0x6000404, 0)):
        for reading in (False, True):
            for hkl in (TAIWAN, CHINA):
                fresh("hello", 2, 2, window={"hkl": hkl}, imm={"himc": himc}, state={"hkl": hkl, "ids": (hkl, ident, 0), "show_reading": reading, "reading": "rd"})
                o.act("Z1 GetPrivateReadingString, the id 0x%X, input context %d, layout 0x%08X, reading shown %s" % (ident, himc, hkl, reading), "E", "private", keys=ALL)


    # ================================================================ more: a group whose id is 0 is a group; PlaceCaret at the edges; the layouts near the CJK languages; OnFocusOut's default context
    GROUP0 = (0, 0)
    for vk in (UP, DOWN_):
        for keys in ({}, {SHIFT: DOWN}):
            for caret in range(0, len(ML) + 1):
                fresh(ML, caret, caret, keys=keys, group=GROUP0)
                key("G5 %s in the group 0, %s, caret %d of %r" % (name(vk), "shift" if keys else "no shift", caret, ML), vk)
    for caret, sel in ((3, 3), (1, 1), (0, 0), (2, 1)):
        for insert in (True, False):
            fresh("abc", caret, sel, group=GROUP0, insert=insert, change=7)
            char("G5 Enter in a box of the group 0, insert mode %s, caret %d, selection from %d" % (insert, caret, sel), 13)
    for kw, tag in (({"line_limit": 1}, "line limit 1"), ({"line_limit": 2}, "line limit 2"), ({"keys": {SHIFT: DOWN, CTRL: DOWN}}, "shift and control down")):
        fresh("abc", 3, 3, group=GROUP0, **kw)
        char("G5 Enter in a box of the group 0, %s" % tag, 13)
    for width, caret in ((22, 3), (23, 3), (21, 3), (30, 3), (22, 2), (40, 1)):
        fresh("abc", caret, caret, group=GROUP0, width_limit=width, change=7)
        char("G5 type x, width limit %d, caret %d, in the group 0" % (width, caret), ord("x"))
    fresh("ab\ncd", 5, 5, group=GROUP0, width_limit=22)
    char("G5 type x at the end of the second line, width limit 22, in the group 0", ord("x"))
    fresh("ab\ncd", 2, 2, group=GROUP0, width_limit=11)
    char("G5 type x at the end of the first line, width limit 11, in the group 0", ord("x"))
    for caret in (0, 1, 3):
        fresh("hello", caret, caret, group=(0, 1), boxes=[("F", dict(text="front", group=(0, 0))), ("G", dict(text="after", group=(0, 2)))])
        char("G5 backspace at caret %d of the box 1 of the group 0 (the previous box is F)" % caret, 8)
    for caret in (0, 3, 5):
        fresh("abc", caret, caret, length_limit=3, group=(0, 0), boxes=[("F", dict(text="next", group=(0, 1)))], change=7)
        char("G5 type x into a box of the group 0 (caret %d, 3 characters of 3), the next box is F" % caret, ord("x"))
    for rc in ((5, 0, 85, 20), (5, 4, 85, 24), (5, 10, 85, 30)):
        for y in (20, 24, 28, 32, 36, 39):
            for x in (10, 20, 36, 60):
                fresh(GL, 3, 3, group=GROUP0, rc_text=rc)
                mouse("G5 click at (%d, %d) in a box of the group 0, text rectangle %s" % (x, y, rc), 0x201, x, y)
    for first, align in ((3, (0, 0)), (0, (3, 6)), (4, (-2, 3))):
        for x, y in ((12, 22), (30, 30), (45, 36)):
            fresh(GL, 3, 3, group=GROUP0, first=first, align=align, rc_text=(5, 2, 85, 22))
            mouse("G5 click at (%d, %d) in a box of the group 0, first visible %d, text aligned by %s" % (x, y, first, align), 0x201, x, y)

    # ---- PlaceCaret by itself: the first visible character moves when the caret's character (its right edge, unless it is the end) leaves the text rectangle
    def positions(text):
        out, x = [0], 0
        for c in text:
            x += 5 + ord(c) % 7
            out.append(x)
        return out

    for text, firsts in (("hello world a", (0, 3)), ("mmmmmmmm", (0, 2))):
        xs = positions(text)
        n = len(text)
        for first in firsts:
            for cp in range(0, n + 1):
                trailing = xs[min(cp + 1, n)]
                widths = {trailing - xs[first] + d for d in (-1, 0, 1)}  # the right edge of the caret's character at the limit of the rectangle
                widths |= {xs[cp] - xs[first] + d for d in (-1, 0, 1)}  # the left edge of it
                widths |= {trailing - xs[k] for k in range(first + 1, min(cp + 1, n) + 1)}  # the new left side of the rectangle exactly at a character
                for width in sorted(w for w in widths if 6 <= w <= 120):
                    fresh(text, 0, 0, first=first, rc_text=(5, 0, 5 + width, 20))
                    o.act("K9 PlaceCaret(%d) of %r, first visible %d, text rectangle %d wide" % (cp, text, first, width), "E", "place", cp)

    # ---- the layouts near the CJK languages (the low ten bits: 5, 0x10, 0x13, 0x104 are none of them)
    for hkl in (0x04050405, 0x04100410, 0x04130413, 0x01040104, 0x04030403, 0x04060406):
        for himc in (0, 5):
            for is_ime in (False, True):
                for mode in ({"open_status": False}, {"open_status": True}, {"conv": (0, 0)}):
                    fresh("hello", 2, 2, window={"hkl": hkl, "locales": {**LOCALES, 0x0405: "CSY", 0x0410: "ITA", 0x0413: "NLD", 0x0104: "ABC", 0x0403: "CAT", 0x0406: "DAN"}},
                          imm={"himc": himc, "is_ime": is_ime, **mode},
                          state={"toggle_hkl": 0, "hkl": 0x00010001, "ime_state": 7, "vertical": True, "chinese": True, "indicator_index": 4})
                    o.act("T5 CheckToggleState on the layout 0x%08X, input context %d, an IME: %s, %s" % (hkl, himc, is_ime, mode), "E", "toggle")

    # ---- GetImeId by itself: an index of 2 or more is answered 0 at once and leaves the cache alone
    for hkl in (0x04090409, 0xE0080404, 0xE0090404, 0xE00E0804, 0x08040804):
        for index in (0, 1, 2, 3, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF):
            for ids in ((0, 0, 0), (hkl, 7, 9), (0x04190419, 7, 9)):
                fresh("hello", 2, 2, state={"hkl": hkl, "ids": ids})
                o.act("I1 GetImeId(0x%X) on the layout 0x%08X, the cache holds %s" % (index, hkl, tuple(hex(v) for v in ids)), "E", "imeid", index, keys=ALL)

    # ---- OnFocusOut gives the window no input context, whatever the default one is
    for himc in (0, 5):
        for imc_def in (0, 9):
            for has in (True, False):
                fresh("hello", 2, 2, has_focus=has, focus_out=9, imm={"himc": himc}, state={**COMPOSING, "imc_def": imc_def})
                o.act("F3 OnFocusOut, input context %d, default context %d, the box %s the flag" % (himc, imc_def, "had" if has else "had not"), "E", "out")

    # ---- a click on a horizontal candidate window with no candidate in it
    for hkl in (0x04040404, 0x04120412, 0x04110411, 0x08040804):
        for x in (110, 120, 150):
            fresh("hello", 2, 2, state={"hkl": hkl, "vertical": False, "cands": {"count": 0, "show": True, "rect": (100, 90, 200, 110), "hori": "x"}}, imm={"himc": 5})
            mouse("M12 click at (%d, 100) on a horizontal candidate window of no candidate, layout 0x%08X" % (x, hkl), 0x201, x, 100)

    return o


if __name__ == "__main__":
    o = main()
    if "--json" in sys.argv:
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w", encoding="utf-8") as fh:  # one step per line
            fh.write("[\n" + ",\n".join(json.dumps(step, ensure_ascii=False) for step in o.script) + "\n]\n")
