#!/usr/bin/env python3
"""
The text buffer of the edit boxes (`CKTDGUIUniBuffer`, DXUT's `CUniBuffer` with the game's limits) of x2.exe on the Unicorn CPU emulator: the oracle
of packages/ui/src/unibuffer.ts (tested by packages/ui/test/unibuffer-ops.test.ts, which replays packages/ui/test/unibuffer-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-unibuf.py                (prints one line per case: `case -> answer | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-unibuf.py --json FILE    (and writes the script and the exe's answers to FILE)

The exe's functions run as they are, on a buffer built by hand in the emulated memory (the layout of tools/layout.py CKTDGUIUniBuffer: +0 m_nBufferSize,
+4 m_nLengthLimit, +8 m_bOneCharMode, +0xC m_pwszBuffer, +0x10 m_pwszBufferHC, +0x14 m_bOnlyNumMode, +0x18 m_WidthLimit, +0x1C m_LineLimit, +0x20
m_bOnlyNumAndEnglishMode, +0x21 m_bCheckEnglishBigAndSmall, +0x22 m_bBigEnglish, +0x23 m_bByteLimit, +0x24 m_ByteLimit, +0x28 m_bAutoChangeBigEnglish,
+0x2A m_cHideChar, +0x2C m_bUseHideChar, +0xF8 m_pFontNode, +0xFC m_bAnalyseRequired): CPtoX 32963BA0, CPtoY 32963E60, GetLineWidth 329648B0, XtoCP 32965CC0,
XYtoCP 32965B30, GetLineCount 329645E0, GetCaretLineMove 32964220, GetNextItemPos 32964E50, GetPriorItemPos 32964F40, InsertChar 329651C0,
InsertString 32965480, RemoveChar 32965810, operator[] 32963B80, SetText 329659E0, SetBufferSize 32965870, Clear 32964210 -- and what they call:
`std::wstring::_Construct` and the STL's vectorised search (`__std_search_2`, `__std_find_end_2`) are the exe's own code.

What is replaced (the emulator has no Windows and no C runtime):
  * the C runtime's `memcpy` / `memmove` / `memset` / `malloc` / `free` / `towupper` (the C locale: a to z only) / `iswdigit` (ASCII digits below 256, Unicode `Nd`
    above: Python's tables) as traps on the imports; `lstrlenW` (0 for a null pointer) and `WideCharToMultiByte` (a character below 0x80 is one byte, any other
    two: a double byte code page) through their delay-load pointers (0x3362EA98, 0x3362EA90);
  * the UK font: `CUKFont::GetWidth(wszText)` 328B7150 answers the sum of the widths of the characters of the widest line (a character is 5 + c mod 7 wide, a
    line break 0) and `GetHeight(wszText)` 328B6EF0 `11 + length mod 5 + 6 * line breaks`: numbers that depend on the exact piece of text the buffer asks about.
    The font's `m_pUKFont->m_iFontSize` (+0x30) and `m_EnlargeNum` (+0x1000AC) are the case's (XYtoCP divides them), the application's `m_ResolutionScale` too;
  * `CKTDXLog::PushErrorLog` 328B0E20 / 328B10A0 (`error 39` / `error 42 out of memory`).
The buffer's state after a call is its text (read up to the NUL), `m_nBufferSize`, `m_bAnalyseRequired`, and the errors the call wrote down.
"""
import os, struct, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from peemu import *

EXE = os.path.join(HERE, "..", "data", "x2.exe")
APP_PTR = 0x33639898
FUNCS = {  # name -> (address, number of arguments)
    "CPtoX": 0x32963BA0, "CPtoY": 0x32963E60, "GetLineWidth": 0x329648B0, "XtoCP": 0x32965CC0, "XYtoCP": 0x32965B30, "GetLineCount": 0x329645E0,
    "GetCaretLineMove": 0x32964220, "GetNextItemPos": 0x32964E50, "GetPriorItemPos": 0x32964F40, "InsertChar": 0x329651C0, "InsertString": 0x32965480,
    "RemoveChar": 0x32965810, "operator[]": 0x32963B80, "SetText": 0x329659E0, "SetBufferSize": 0x32965870, "Clear": 0x32964210,
}
FONT_SIZE, ENLARGE = 0x30, 0x1000AC
DLL = {"memcpy", "memmove", "memset", "malloc", "free", "towupper", "iswdigit"}


def patch_seh(emu):
    """The functions with exception handling link a frame through `fs:[0]` (the emulator has no thread block): `mov eax, fs:[0]` becomes `xor eax, eax`,
    the stores `mov fs:[0], reg` nothing.  Nothing is thrown here, so no frame is ever looked at.  Returns how many instructions were changed."""
    text = [sec for sec in emu.pe.sections if sec.Name.startswith(b".text")][0]
    base, data = emu.base + text.VirtualAddress, bytearray(text.get_data())
    n = 0
    for i in range(len(data) - 7):
        if data[i] != 0x64:
            continue
        if data[i + 1] == 0xA1 and data[i + 2:i + 6] == b"\0\0\0\0":  # mov eax, fs:[0]
            emu.write(base + i, b"\x31\xC0\x90\x90\x90\x90")
            n += 1
        elif data[i + 1] == 0xA3 and data[i + 2:i + 6] == b"\0\0\0\0":  # mov fs:[0], eax
            emu.write(base + i, b"\x90" * 6)
            n += 1
        elif data[i + 1] in (0x89, 0x8B) and data[i + 2] & 0xC7 == 0x05 and data[i + 3:i + 7] == b"\0\0\0\0":  # mov fs:[0], r32 / mov r32, fs:[0]
            reg = (data[i + 2] >> 3) & 7
            if data[i + 1] == 0x8B:
                emu.write(base + i, bytes([0x31, 0xC0 | (reg << 3) | reg]) + b"\x90" * 5)
            else:
                emu.write(base + i, b"\x90" * 7)
            n += 1
    return n


def enc(text):
    """a text for the script: as it is, or (more than 80 characters) as its runs `{"runs": [[character, count], ...]}`; None stays None"""
    if text is None or len(text) <= 80:
        return text
    runs = []
    for c in text:
        if runs and runs[-1][0] == c:
            runs[-1][1] += 1
        else:
            runs.append([c, 1])
    return {"runs": runs}


def s32(v):
    v &= 0xFFFFFFFF
    return v - (1 << 32) if v & 0x80000000 else v


def char_width(c):
    return 0 if c == 10 else 5 + c % 7


def width_of(text):
    return max(sum(char_width(ord(c)) for c in line) for line in text.split("\n"))


def height_of(text):
    return 11 + len(text) % 5 + 6 * text.count("\n")


class UniOracle:
    def __init__(self, exe=EXE):
        self.emu = emu = PEEmu(exe)
        pe = emu.pe
        pe.parse_data_directories()
        self.script, self.errors = [], []
        self.blocks = {}
        self.seh = patch_seh(emu)
        # the C runtime: a `ret` per import, a hook that does the work
        self.traps = {}
        base = emu.stub(None, b"\xC3" * 64)
        slot = 0
        impl = {"memcpy": self._memcpy, "memmove": self._memcpy, "memset": self._memset, "malloc": self._malloc, "free": self._free,
                "towupper": self._towupper, "iswdigit": self._iswdigit}
        for e in pe.DIRECTORY_ENTRY_IMPORT:
            for imp in e.imports:
                name = imp.name.decode() if imp.name else None
                if name in impl:
                    emu.w32(imp.address, base + slot)
                    emu.hook(base + slot, impl[name])
                    slot += 1
        assert slot == len(DLL), slot
        emu.hook(emu.stub(0x3362EA98, b"\xC2\x04\x00"), self._lstrlen)
        emu.hook(emu.stub(0x3362EA90, b"\xC2\x20\x00"), self._wctmb)
        self.replace(0x328B7150, lambda e: self._ret(width_of(self.wstr(e.args(1)[0]))), b"\xC2\x04\x00")
        self.replace(0x328B6EF0, lambda e: self._ret(height_of(self.wstr(e.args(1)[0]))), b"\xC2\x04\x00")
        self.replace(0x328B0E20, lambda e: self.errors.append("error %d" % e.args(1)[0]), b"\xC2\x04\x00")
        self.replace(0x328B10A0, lambda e: self.errors.append("error %d %s" % (e.args(2)[0], self.cstr(e.args(2)[1]))), b"\xC2\x08\x00")
        # the application block (+0x178 m_ResolutionScale), the UK font and the glyph font it has
        self.app = emu.alloc(0x400)
        emu.w32(APP_PTR, self.app)
        self.font = emu.alloc(0x40)
        self.inner = emu.alloc(0x100100)
        emu.w32(self.font + 4, self.inner)
        self.this = emu.alloc(0x200)
        self.mark = emu.heap_ptr

    # ---- plumbing
    def hooked(self, fn, ret=b"\xC3"):
        stub = self.emu.stub(None, ret)
        self.emu.hook(stub, fn)
        return stub

    def replace(self, addr, fn, ret=b"\xC3"):
        stub = self.hooked(fn, ret)
        self.emu.write(addr, b"\xE9" + struct.pack("<i", stub - (addr + 5)))

    def _arg(self, n):
        return self.emu.u32(self.emu.reg(UC_X86_REG_ESP) + 4 + 4 * n)

    def _ret(self, v):
        self.emu.set_reg(UC_X86_REG_EAX, v & 0xFFFFFFFF)

    def wstr(self, p, n=None):
        """the characters at p up to the NUL (or n characters)"""
        out = []
        while n is None or len(out) < n:
            c = struct.unpack("<H", self.emu.read(p + 2 * len(out), 2))[0]
            if n is None and c == 0:
                break
            out.append(c)
        return "".join(chr(c) for c in out)

    def cstr(self, p):
        out = b""
        while True:
            c = self.emu.read(p + len(out), 1)
            if c == b"\0":
                return out.decode()
            out += c

    def put_wstr(self, text, capacity=None):
        data = text.encode("utf-16-le", "surrogatepass") + b"\0\0"
        p = self.emu.alloc(max(len(data), 2 * (capacity or 0)) + 8)
        self.emu.write(p, data)
        return p

    # ---- the C runtime
    def _memcpy(self, emu):
        d, s, n = self._arg(0), self._arg(1), self._arg(2)
        if n:
            emu.write(d, emu.read(s, n))
        self._ret(d)

    def _memset(self, emu):
        d, c, n = self._arg(0), self._arg(1), self._arg(2)
        if n:
            emu.write(d, bytes([c & 255]) * n)
        self._ret(d)

    def _malloc(self, emu):
        n = self._arg(0)
        p = emu.alloc(max(n, 1), 16)
        self.blocks[p] = n
        self._ret(p)

    def _free(self, emu):
        pass

    def _towupper(self, emu):
        c = self._arg(0) & 0xFFFF
        self._ret(c - 32 if 0x61 <= c <= 0x7A else c)

    def _iswdigit(self, emu):
        c = self._arg(0) & 0xFFFF
        self._ret(1 if (0x30 <= c <= 0x39 if c < 256 else unicodedata.category(chr(c)) == "Nd") else 0)

    def _lstrlen(self, emu):
        p = emu.args(1)[0]
        self._ret(0 if p == 0 else len(self.wstr(p)))

    def _wctmb(self, emu):
        cp, flags, src, cch, dst, cb = emu.args(8)[:6]
        text = self.wstr(src, cch)
        data = b"".join(bytes([0x41]) if ord(c) < 0x80 else bytes([0xA4, 0x40]) for c in text)
        if cb == 0:
            self._ret(len(data))
        elif cb >= len(data):
            emu.write(dst, data)
            self._ret(len(data))
        else:
            self._ret(0)

    # ---- the buffer
    def reset(self):
        self.emu.heap_ptr = self.mark
        self.op("reset")

    def op(self, *a):
        self.script.append(list(a))

    def buffer(self, text="", size=256, length_limit=0xFFFF, one_char=False, only_num=False, width_limit=99999, line_limit=99999, only_num_english=False,
               check_case=False, big=True, byte_limit=False, byte_max=0, auto_upper=False, hide=(False, 0), font=(17, 1), scale=(1.5, 2.0), analyse=False):
        """a buffer with `text` in room for `size` characters (text None: never allocated); `font`: (m_iFontSize, m_EnlargeNum) or None for no font"""
        emu = self.emu
        emu.heap_ptr = self.mark
        p = self.this
        emu.write(p, bytes(0x1CC))
        if text is not None:
            assert size > len(text), "the text fills the buffer"
            data = emu.alloc(2 * size + 16)
            emu.write(data, bytes(2 * size))
            emu.write(data, text.encode("utf-16-le", "surrogatepass"))
            hc = emu.alloc(2 * size + 16)
            emu.write(hc, bytes(2 * size))
            emu.w32(p + 0xC, data)
            emu.w32(p + 0x10, hc)
            emu.w32(p, size)
        emu.write(p + 4, struct.pack("<i", length_limit))
        emu.write(p + 8, bytes([1 if one_char else 0]))
        emu.write(p + 0x14, bytes([1 if only_num else 0]))
        emu.write(p + 0x18, struct.pack("<ii", width_limit, line_limit))
        emu.write(p + 0x20, bytes([1 if only_num_english else 0, 1 if check_case else 0, 1 if big else 0, 1 if byte_limit else 0]))
        emu.write(p + 0x24, struct.pack("<i", byte_max))
        emu.write(p + 0x28, bytes([1 if auto_upper else 0]))
        emu.write(p + 0x2A, struct.pack("<H", hide[1]))
        emu.write(p + 0x2C, bytes([1 if hide[0] else 0]))
        emu.write(p + 0xFC, bytes([1 if analyse else 0]))
        if font is not None:
            emu.w32(p + 0xF8, self.font)
            emu.write(self.inner + FONT_SIZE, struct.pack("<i", font[0]))
            emu.write(self.inner + ENLARGE, struct.pack("<i", font[1]))
        emu.write(self.app + 0x178, struct.pack("<2f", *scale))
        self.op("buf", {"text": enc(text), "size": size, "lengthLimit": length_limit, "oneChar": one_char, "onlyNum": only_num, "widthLimit": width_limit,
                        "lineLimit": line_limit, "onlyNumEnglish": only_num_english, "checkCase": check_case, "big": big, "byteLimit": byte_limit,
                        "byteMax": byte_max, "autoUpper": auto_upper, "hide": [bool(hide[0]), hide[1]], "font": list(font) if font else None,
                        "scale": list(scale), "analyse": analyse})

    def state(self):
        emu = self.emu
        p = self.this
        data = emu.u32(p + 0xC)
        return {"text": None if data == 0 else self.wstr(data), "size": s32(emu.u32(p)), "analyse": bool(emu.read(p + 0xFC, 1)[0]), "errors": list(self.errors)}

    def call(self, case, name, *args):
        """run a method; a string argument is a wide string, `out` pointers are made for the out parameters (`outs` of them follow the arguments)"""
        emu = self.emu
        addr = FUNCS[name]
        self.errors = []
        outs = {"CPtoX": 1, "CPtoY": 1, "XtoCP": 2, "XYtoCP": 2, "GetNextItemPos": 1, "GetPriorItemPos": 1}.get(name, 0)
        real = [self.put_wstr(a) if isinstance(a, str) else a for a in args]
        ptrs = [emu.alloc(4) for _ in range(outs)]
        for q in ptrs:
            emu.w32(q, 0xDEADBEEF)
        emu.set_reg(UC_X86_REG_ECX, self.this)
        ret = emu.call(addr, real + ptrs)
        out = [s32(emu.u32(q)) for q in ptrs]
        if name in ("InsertChar", "InsertString", "RemoveChar", "SetText", "SetBufferSize"):
            ans = bool(ret & 0xFF)
        elif name in ("GetLineWidth", "GetLineCount", "GetCaretLineMove"):
            ans = s32(ret)
        elif name == "operator[]":
            ans = ret
        else:
            ans = None
        st = self.state()
        result = {"ret": ans, "out": out, **st}
        if name == "operator[]":  # the pointer to a character: where it is in the text
            result["ret"] = (ans - emu.u32(self.this + 0xC)) // 2
        print("%-84s -> %s" % (case, self.fmt(name, result)))
        self.op("call", case, name, [enc(a) if isinstance(a, str) else a for a in args], dict(result, text=enc(result["text"])))
        return result

    def fmt(self, name, r):
        text = r["text"]
        shown = repr(text) if text is None or len(text) <= 60 else "%r...(%d characters)" % (text[:20], len(text))
        return "%s %s | %s size=%d analyse=%d %s" % (r["ret"], r["out"], shown, r["size"], r["analyse"], ",".join(r["errors"]))

    def write_char(self, n, c):
        """`buffer[n] = c`: `operator[]` and then the store the caller does; one step (`setCharAt`), its state is the one after the store"""
        emu = self.emu
        self.errors = []
        emu.set_reg(UC_X86_REG_ECX, self.this)
        ptr = emu.call(FUNCS["operator[]"], [n])
        data = emu.u32(self.this + 0xC)
        assert ptr == data + 2 * n, (hex(ptr), hex(data))
        emu.write(ptr, struct.pack("<H", c))
        result = {"ret": None, "out": [], **self.state()}
        case = "operator[](%d) = %d" % (n, c)
        print("%-84s -> %s" % (case, self.fmt("setCharAt", result)))
        self.op("call", case, "setCharAt", [n, c], dict(result, text=enc(result["text"])))
        return result


def main():
    o = UniOracle()
    run(o)
    if "--json" in sys.argv:
        import json
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("[\n" + ",\n".join(json.dumps(step, ensure_ascii=False) for step in o.script) + "\n]\n")


def run(o):
    call = o.call
    big = "x" * 40

    # ---- U1: the measuring that was ported first, against the exe (the font: a character is 5 + c mod 7 wide: a 11, b 5, c 6, d 7, e 8, A 7, B 8, space 9)
    for scale in ((1.5, 2.0), (0.75, 0.5), (1.0, 1.0)):
        for text in ("abc", "ab\nAB\nd", "a\n\nB", "ab  d", "", "\n", "a\n", "\n\na"):
            o.reset()
            o.buffer(text, scale=scale)
            for n in list(range(0, len(text) + 2)) + [50, 0xFFFFFFFF]:
                call("U1 CPtoX(%d) of %r at %s" % (n, text, scale), "CPtoX", n, 0)
                call("U1 CPtoY(%d) of %r at %s" % (n, text, scale), "CPtoY", n, 0)
            for n in range(0, len(text) + 1):
                call("U1 GetLineWidth(%d) of %r at %s" % (n, text, scale), "GetLineWidth", n)
            for x in (-3, 0, 1, 5, 6, 9, 10, 11, 14, 20, 30, 100):
                call("U1 XtoCP(%d) of %r at %s" % (x, text, scale), "XtoCP", x)
    for text in ("abc", "ab\nAB\nd", "a\n\nB"):
        o.reset()
        o.buffer(text, hide=(True, 0x23))
        for n in range(0, len(text) + 2):
            call("U1 hidden (#) CPtoX(%d) of %r" % (n, text), "CPtoX", n, 0)
            call("U1 hidden (#) CPtoY(%d) of %r" % (n, text), "CPtoY", n, 0)
            call("U1 hidden (#) GetLineWidth(%d) of %r" % (n, text), "GetLineWidth", min(n, len(text)))
        call("U1 hidden: XtoCP(20) measures the real text", "XtoCP", 20)
        o.reset()
        o.buffer(text, hide=(True, 0x0A))
        call("U1 hide character is a line break: CPtoY(2) of %r" % text, "CPtoY", 2, 0)
        call("U1 hide character is a line break: CPtoX(3) of %r" % text, "CPtoX", 3, 0)
    o.reset()
    o.buffer("abc", font=None)
    call("U1 no font: CPtoX is 0", "CPtoX", 2, 0)
    call("U1 no font: CPtoY is 0", "CPtoY", 2, 0)
    call("U1 no font: GetLineWidth is 0", "GetLineWidth", 2)
    call("U1 no font: XtoCP is 0", "XtoCP", 9)

    # ---- U2: GetLineCount
    for text in ("", "abc", "a\nb", "a\n", "\n", "\n\n", "a\n\nb\n", "ab\ncd\nef"):
        o.reset()
        o.buffer(text)
        for n in list(range(0, len(text) + 2)) + [99, 0xFFFFFFFF]:
            call("U2 GetLineCount(%d) of %r" % (n, text), "GetLineCount", n)
    o.reset()
    o.buffer("a\nb\nc", hide=(True, 0x2A))
    call("U2 hidden: no line breaks, one line", "GetLineCount", 5)
    o.reset()
    o.buffer("abc", hide=(True, 0x0A))
    call("U2 hidden with a line break: the three characters are four lines", "GetLineCount", 3)
    call("U2 hidden with a line break: two characters are three lines", "GetLineCount", 2)
    o.reset()
    o.buffer("a\nb", font=None)
    call("U2 no font: 0", "GetLineCount", 3)

    # ---- U3: the steps of the caret over words
    for text in ("ab cd  ef", "ab cd  ef ", " a", "  ", "a", "", "a b", "ab  ", "  ab", "a  b  c", "x y z w"):
        o.reset()
        o.buffer(text)
        for n in range(-2 if text == "" else -1, len(text) + 2):  # -2 of an empty text: the start is -1, which is no place to read from
            call("U3 GetNextItemPos(%d) of %r" % (n, text), "GetNextItemPos", n)
        for n in range(0, len(text) + 2):
            call("U3 GetPriorItemPos(%d) of %r" % (n, text), "GetPriorItemPos", n)
    o.reset()
    o.buffer("ab cd", hide=(True, 0x2A))
    call("U3 hidden: the steps look at the plain text (next)", "GetNextItemPos", 0)
    call("U3 hidden: the steps look at the plain text (prior)", "GetPriorItemPos", 5)

    # ---- U4: RemoveChar
    for text in ("", "a", "abc", "abcd"):
        o.reset()
        for n in (-1, 0, 1, 2, 3, 4, 5, 100):
            o.buffer(text)
            call("U4 RemoveChar(%d) of %r" % (n, text), "RemoveChar", n)
    o.reset()
    o.buffer(None, size=0, font=None)
    call("U4 RemoveChar(0) of a buffer nobody allocated (lstrlenW(NULL) is 0)", "RemoveChar", 0)
    o.reset()
    o.buffer("abc")
    call("U4 RemoveChar(1) twice", "RemoveChar", 1)
    call("U4 ... the second", "RemoveChar", 1)
    call("U4 ... and the third: nothing left at 1", "RemoveChar", 1)

    # ---- U5: InsertChar
    X, A = ord("X"), ord("a")
    for text in ("abc",):
        for n in (-1, 0, 1, 2, 3, 4, 100):
            o.reset()
            o.buffer(text)
            call("U5 InsertChar(%d, X) into %r" % (n, text), "InsertChar", n, X)
    for limit in (0, 2, 3, 4, 5):
        o.reset()
        o.buffer("abc", length_limit=limit)
        call("U5 length limit %d, 3 characters" % limit, "InsertChar", 1, X)
    o.reset()
    o.buffer("", length_limit=0)
    call("U5 length limit 0, empty text", "InsertChar", 0, X)
    o.reset()
    o.buffer("", length_limit=1)
    call("U5 length limit 1, empty text", "InsertChar", 0, X)
    for ch in "0129:/a!":
        o.reset()
        o.buffer("ab", only_num=True)
        call("U5 only numbers: %r" % ch, "InsertChar", 1, ord(ch))
    for check, bigc in ((False, True), (False, False), (True, True), (True, False)):
        for ch in "05A Z@[`az{!9":
            o.reset()
            o.buffer("ab", only_num_english=True, check_case=check, big=bigc)
            call("U5 digits and letters (check case %s, big %s): %r" % (check, bigc, ch), "InsertChar", 1, ord(ch))
    for ch in "az5@":
        for check, bigc in ((False, True), (True, True), (True, False)):
            o.reset()
            o.buffer("ab", only_num_english=True, check_case=check, big=bigc, auto_upper=True)
            call("U5 auto upper + digits and letters (check %s, big %s): %r" % (check, bigc, ch), "InsertChar", 1, ord(ch))
    for ch in "aZ{":
        o.reset()
        o.buffer("ab", auto_upper=True)
        call("U5 auto upper alone: %r" % ch, "InsertChar", 1, ord(ch))
    o.reset()
    o.buffer("ab", auto_upper=True, only_num=True)
    call("U5 auto upper + only numbers: a is A, no digit", "InsertChar", 1, A)
    o.reset()
    o.buffer("ab", only_num=True, only_num_english=True)
    call("U5 only numbers, and digits and letters: a (the first test refuses)", "InsertChar", 1, A)
    # the one character mode
    for text, size in (("a", 256), ("", 256), ("a", 2), ("", 1), ("", 2), ("a", 3), ("", 3)):
        o.reset()
        o.buffer(text, size=size, one_char=True) if size > len(text) else None
        if size > len(text):
            call("U5 one character mode, %r in room for %d: replaces the first character, answers no" % (text, size), "InsertChar", 0, ord("b"))
    o.reset()
    o.buffer("a", one_char=True)
    call("U5 one character mode, index 1 is still the first character", "InsertChar", 1, ord("c"))
    call("U5 one character mode, index 2 is past the end", "InsertChar", 2, ord("d"))
    o.reset()
    o.buffer(None, size=0, font=None, one_char=True)
    call("U5 one character mode on a buffer nobody allocated: the buffer is made (256 characters), the character goes first, the answer is no", "InsertChar", 0, X)
    o.reset()
    o.buffer("abc", one_char=True)
    call("U5 one character mode with a longer text (set before the mode was): only the first character is replaced", "InsertChar", 0, X)
    o.reset()
    o.buffer("a", one_char=True, only_num=True)
    call("U5 one character mode with only numbers: the mode test comes first", "InsertChar", 0, A)
    o.reset()
    o.buffer("a", one_char=True, length_limit=0, byte_limit=True, byte_max=0)
    call("U5 one character mode ignores the byte and the length limits", "InsertChar", 0, ord("z"))
    # the byte limit: the text takes that many bytes or more already
    for text, limit in (("abcd", 4), ("abcd", 5), ("abcd", 3), ("", 0), ("", 1), ("\u6211", 2), ("\u6211", 3), ("\u6211a", 3), ("\u6211a", 4)):
        o.reset()
        o.buffer(text, byte_limit=True, byte_max=limit)
        call("U5 byte limit %d, text %r" % (limit, text), "InsertChar", 0, X)
    o.reset()
    o.buffer("abcd", byte_limit=True, byte_max=5)
    call("U5 byte limit 5, 4 bytes: a two byte character still goes in", "InsertChar", 4, 0x6211)
    call("U5 ... and now 6 bytes are over the limit", "InsertChar", 5, X)
    o.reset()
    o.buffer("ab", byte_limit=True, byte_max=2, length_limit=10)
    call("U5 the byte limit refuses before the length limit is looked at", "InsertChar", 0, X)
    o.reset()
    o.buffer(None, size=0, font=None, byte_limit=True, byte_max=0)
    call("U5 byte limit 0 on a buffer nobody allocated: 0 bytes, refused", "InsertChar", 0, X)
    o.reset()
    o.buffer(None, size=0, font=None, byte_limit=True, byte_max=1)
    call("U5 byte limit 1 on a buffer nobody allocated: the buffer is made", "InsertChar", 0, X)
    o.reset()
    o.buffer(None, size=0, font=None)
    call("U5 a buffer nobody allocated: made with 256 characters", "InsertChar", 0, X)
    call("U5 ... and the character is in", "InsertChar", 1, ord("Y"))
    # the width limit: a character that does not fit the line (the line is as wide as the limit already) is preceded by a line break
    for limit in (13, 14, 15, 100):
        o.reset()
        o.buffer("abc", width_limit=limit)
        call("U5 width limit %d, the line is 22 / 1.5 = 14 wide: insert at the end" % limit, "InsertChar", 3, X)
    # (inside the line the break does not help: the line the X lands in is as wide as before, so the breaks pile up until the line limit stops them)
    for n in (0, 1, 2):
        for lines in (2, 3, 5):
            o.reset()
            o.buffer("abc", width_limit=14, line_limit=lines)
            call("U5 width limit 14, line limit %d, insert X at %d" % (lines, n), "InsertChar", n, X)
    o.reset()
    o.buffer("abc", width_limit=14)
    call("U5 width limit 14: the break and the character, then the line is short again", "InsertChar", 3, X)
    call("U5 ... a second character goes on the new line", "InsertChar", 5, ord("Y"))
    o.reset()
    o.buffer("ab\ncd", width_limit=9)
    call("U5 width limit 9, the line of index 4 (\"cd\", 14 / 1.5 = 9 wide)", "InsertChar", 4, X)
    call("U5 ... the line of index 1 (\"ab\", 16 / 1.5 = 10 wide)", "InsertChar", 1, X)
    o.reset()
    o.buffer("abc", width_limit=14, line_limit=1)
    call("U5 the break for a wide line is refused by the line limit: the character is put at index + 1 (past the end: not at all) and the answer is yes", "InsertChar", 3, X)
    o.reset()
    o.buffer("abc", width_limit=14, line_limit=1)
    call("U5 ... in the middle of the text the pair of calls runs on through the rest of the line: the X is never put in, the answer is yes", "InsertChar", 1, X)
    o.reset()
    o.buffer("a1c", width_limit=14, only_num=True)
    call("U5 only numbers: the break is refused (it is no digit), the digit is tried one place further on, each time on a too wide line: never put in, the answer is yes", "InsertChar", 1, ord("5"))
    o.reset()
    o.buffer("abc", width_limit=14, font=None)
    call("U5 no font: no width, no break", "InsertChar", 3, X)
    o.reset()
    o.buffer("abc", width_limit=1)
    call("U5 a line break is never turned away by the width limit", "InsertChar", 1, 10)
    # the line limit
    for limit in (1, 2, 3):
        o.reset()
        o.buffer("a\nb", line_limit=limit)
        call("U5 line limit %d, 2 lines: a line break" % limit, "InsertChar", 1, 10)
        o.reset()
        o.buffer("a\nb", line_limit=limit)
        call("U5 line limit %d, 2 lines: a letter" % limit, "InsertChar", 1, X)
    o.reset()
    o.buffer("a\nb\nc", line_limit=2)
    call("U5 line limit 2, 3 lines: a letter is too much already", "InsertChar", 1, X)
    o.reset()
    o.buffer("a\nb\nc", line_limit=3)
    call("U5 line limit 3, 3 lines: a letter", "InsertChar", 1, X)
    call("U5 ... a line break", "InsertChar", 1, 10)
    o.reset()
    o.buffer("a\n", line_limit=1)
    call("U5 a trailing line break counts as a second line: line limit 1, a letter", "InsertChar", 0, X)
    # the buffer grows
    for size, text in ((4, "abc"), (5, "abc"), (3, "ab"), (2, "a"), (8, "abcdefg"), (256, "a" * 255)):
        o.reset()
        o.buffer(text, size=size)
        call("U5 room for %d, %d characters: insert (the buffer grows when len + 1 >= room)" % (size, len(text)), "InsertChar", 0, X)
    o.reset()
    o.buffer("a" * 0xFFFD, size=0xFFFF, font=None)
    call("U5 0xFFFD characters: one more fits (len + 1 < 0xFFFF)", "InsertChar", 0, X)
    o.reset()
    o.buffer("a" * 0xFFFE, size=0xFFFF, font=None)
    call("U5 0xFFFE characters: no more (len + 1 >= 0xFFFF)", "InsertChar", 0, X)
    o.reset()
    o.buffer("ab", font=None, width_limit=1, line_limit=5)
    call("U5 no font: a wide line is no problem, the line count is 0", "InsertChar", 1, X)
    o.reset()
    o.buffer("a", length_limit=5, auto_upper=True, size=256)
    call("U5 auto upper outside the letters: the character stays", "InsertChar", 0, ord("5"))

    # ---- U6: InsertString
    for n in (-1, 0, 1, 2, 3, 4):
        o.reset()
        o.buffer("abc")
        call("U6 InsertString(%d, xy, -1) into abc" % n, "InsertString", n, "xy", -1) if n >= 0 else None
    for count in (-1, 0, 1, 2, 3):
        o.reset()
        o.buffer("abc")
        call("U6 InsertString(1, wxyz, %d)" % count, "InsertString", 1, "wxyz", count)
    o.reset()
    o.buffer("abc")
    call("U6 empty string", "InsertString", 1, "", -1)
    for string, count in (("ab\0cd", -1), ("\0ab", -1), ("ab\0cd", 2), ("ab\0cd", 1), ("a\0", -1)):
        o.reset()
        o.buffer("xyz")
        call("U6 a NUL ends the string: %r, count %d" % (string, count), "InsertString", 1, string, count)
    for string in ("xy", "xyz", "wxyz"):
        o.reset()
        o.buffer("abc", length_limit=5)
        call("U6 length limit 5, %d + %d characters (refused above limit + 1)" % (3, len(string)), "InsertString", 3, string, -1)
    o.reset()
    o.buffer("", length_limit=0)
    call("U6 length limit 0, one character (0 + 1 > 1 is false)", "InsertString", 0, "x", -1)
    call("U6 length limit 0, two characters", "InsertString", 0, "xy", -1)
    o.reset()
    o.buffer("", size=0xFFFF + 1 if False else 0xFFFF, font=None)
    call("U6 0xFFFE characters into an empty text: grows to the maximum", "InsertString", 0, "z" * 0xFFFE, -1)
    o.reset()
    o.buffer("", size=0xFFFF, font=None)
    call("U6 0xFFFF characters into an empty text: too many", "InsertString", 0, "z" * 0xFFFF, -1)
    o.reset()
    o.buffer("a", size=0xFFFF, font=None)
    call("U6 0xFFFD characters into one: 0xFFFE", "InsertString", 1, "z" * 0xFFFD, -1)
    o.reset()
    o.buffer("a", size=0xFFFF, font=None)
    call("U6 0xFFFE characters into one: 0xFFFF is too many", "InsertString", 1, "z" * 0xFFFE, -1)
    for limit in (13, 14, 15):
        o.reset()
        o.buffer("abc", width_limit=limit)
        call("U6 width limit %d, the line is 14 wide" % limit, "InsertString", 3, "xy", -1)
    o.reset()
    o.buffer("abc\nde", width_limit=14)
    call("U6 width limit 14: the line of index 5 (\"de\") is 15 / 1.5 = 10 wide", "InsertString", 5, "xy", -1)
    call("U6 ... the line of index 1 is 14 wide", "InsertString", 1, "xy", -1)
    for limit in (1, 2, 3):
        o.reset()
        o.buffer("a\nb", line_limit=limit)
        call("U6 line limit %d, a text of 2 lines" % limit, "InsertString", 1, "xy", -1)
    o.reset()
    o.buffer("a\nb", line_limit=1)
    call("U6 line limit 1: the string's own line breaks are not counted", "InsertString", 1, "x\ny\nz", -1)
    o.reset()
    o.buffer("a", line_limit=1)
    call("U6 line limit 1: a string with line breaks into a text of one line", "InsertString", 1, "x\ny\nz", -1)
    for limit in (2, 3, 4, 5):
        o.reset()
        o.buffer("ab", byte_limit=True, byte_max=limit)
        call("U6 byte limit %d: 2 bytes and a two byte character (2)" % limit, "InsertString", 1, "\u6211", -1)
    o.reset()
    o.buffer("ab", byte_limit=True, byte_max=4)
    call("U6 byte limit 4, count 1 of \"xyz\": the bytes of the whole string count (2 + 3 > 4)", "InsertString", 1, "xyz", 1)
    o.reset()
    o.buffer("ab", byte_limit=True, byte_max=5)
    call("U6 byte limit 5: 2 + 3 bytes are enough", "InsertString", 1, "xyz", 1)
    o.reset()
    o.buffer("ab", length_limit=1, byte_limit=True, byte_max=100)
    call("U6 the length limit is the first to say no", "InsertString", 1, "xyz", -1)
    o.reset()
    o.buffer("ab", auto_upper=True)
    call("U6 auto upper: abc 5 {", "InsertString", 1, "abc5{", -1)
    o.reset()
    o.buffer("ab", auto_upper=True)
    call("U6 auto upper cuts nothing: count 2 of abc", "InsertString", 1, "abc", 2)
    for text, string in (("", "ab"), ("a", "b"), ("a", "bc"), ("", "abc"), ("ab", "c"), ("", "")):
        o.reset()
        o.buffer(text, one_char=True)
        call("U6 one character mode: %r and %r (refused from 3 characters on)" % (text, string), "InsertString", len(text), string, -1)
    for size, text, string in ((4, "ab", "cdef"), (4, "ab", "c"), (4, "ab", "cd"), (8, "a" * 7, "b"), (4, "ab", "c" * 10), (256, "a" * 250, "b" * 6), (256, "a" * 250, "b" * 5)):
        o.reset()
        o.buffer(text, size=size)
        call("U6 room for %d, %d + %d characters" % (size, len(text), len(string)), "InsertString", 1, string, -1)
    o.reset()
    o.buffer("abc", font=None, width_limit=1, line_limit=1)
    call("U6 no font: no width, no lines", "InsertString", 1, "xy\nz", -1)
    o.reset()
    o.buffer(None, size=0, font=None)
    call("U6 a buffer nobody allocated: the buffer is made", "InsertString", 0, "xy", -1)

    # ---- U7: operator[]
    for n in (0, 1, 2):
        o.reset()
        o.buffer("abc")
        o.write_char(n, ord("Z"))
        call("U7 ... the line count still sees the new text (index %d)" % n, "GetLineCount", 3)
        call("U7 ... and the width of its line", "GetLineWidth", 0)
    o.reset()
    o.buffer("abc", analyse=False)
    o.write_char(1, 10)
    call("U7 a line break stored with the operator is a line break", "GetLineCount", 3)
    o.write_char(0, 0x6211)
    call("U7 a two byte character", "GetLineWidth", 2)

    # ---- U8: XYtoCP (the line height is size / enlarge + 1)
    grid_x = (-5, 0, 3, 7, 10, 14, 25, 100)
    grid_y = (-1, 0, 5, 9, 10, 17, 18, 19, 20, 30, 40, 100)
    for font in ((17, 1), (17, 2), (17, 3)):
        for text in ("abc", "ab\ncde", "a\n\nB"):
            if font != (17, 1) and text != "ab\ncde":
                continue
            o.reset()
            o.buffer(text, font=font)
            for y in grid_y:
                for x in grid_x:
                    call("U8 XYtoCP(%d, %d) in %r, font %s" % (x, y, text, font), "XYtoCP", x, y)
    for text in ("", "a", "\n", "a\n"):
        o.reset()
        o.buffer(text)
        for x, y in ((0, 0), (5, 5), (-3, -3), (-3, 0), (-3, 3), (50, 3), (50, 50)):
            call("U8 XYtoCP(%d, %d) in %r" % (x, y, text), "XYtoCP", x, y)
    o.reset()
    o.buffer("ab\ncde", hide=(True, 0x23))
    for y in (0, 10, 20, 40):
        for x in (0, 7, 100):
            call("U8 hidden: XYtoCP(%d, %d)" % (x, y), "XYtoCP", x, y)
    o.reset()
    o.buffer("abc", font=None)
    call("U8 no font: 0", "XYtoCP", 9, 9)
    o.reset()
    o.buffer("ab\ncde", scale=(0.75, 0.5))
    for y in (0, 2, 5, 9, 12, 20):
        for x in (0, 10, 25, 40):
            call("U8 scale (0.75, 0.5): XYtoCP(%d, %d)" % (x, y), "XYtoCP", x, y)

    # ---- U9: GetCaretLineMove
    for text in ("ab\ncde\n\nf", "abc", "\n", "a\n", "\nb", ""):
        o.reset()
        o.buffer(text)
        for n in range(-2, len(text) + 3):
            for step in (-3, -2, -1, 0, 1, 2, 3):
                call("U9 GetCaretLineMove(%d, %d) in %r" % (n, step, text), "GetCaretLineMove", n, step)
    o.reset()
    o.buffer("\n" * 1999, size=2048)
    for n, step in ((0, 1), (0, 1998), (0, 1999), (0, 2000), (1000, 1), (1998, 1), (1998, -1), (1999, -1), (1999, -1999), (1999, -2000), (1999, 0), (2000, 0)):
        call("U9 1999 line breaks (2000 lines, the most the arrays hold): GetCaretLineMove(%d, %d)" % (n, step), "GetCaretLineMove", n, step)
    o.reset()
    o.buffer("ab\ncde", hide=(True, 0x23))
    call("U9 hidden: one line", "GetCaretLineMove", 2, 1)
    call("U9 hidden: one line, step 0", "GetCaretLineMove", 2, 0)
    o.reset()
    o.buffer("abc\ndef", hide=(True, 0x0A))
    call("U9 hide character is a line break: every character is a line", "GetCaretLineMove", 2, 1)
    call("U9 ... and back", "GetCaretLineMove", 2, -1)
    o.reset()
    o.buffer("ab\ncde", font=None)
    call("U9 no font: -1", "GetCaretLineMove", 2, 0)

    # ---- U10: SetText, SetBufferSize, Clear
    for text, kw in (("abc", {}), ("", {}), ("abcdefghij", {"size": 4}), ("abcdefghij", {"size": 4, "length_limit": 9}), ("abcdefghij", {"size": 4, "length_limit": 10}),
                     ("ab", {"one_char": True}), ("a", {"one_char": True}), ("", {"one_char": True}), ("abc", {"size": 8}), ("abcdefg", {"size": 8}),
                     ("a" * 300, {}), ("a" * 0xFFFD, {"size": 0xFFFF}), ("z" * 0xFFFE, {"size": 0xFFFF, "font": None}), ("z" * 0xFFFF, {"size": 0xFFFF, "font": None})):
        o.reset()
        o.buffer("old", **kw)
        call("U10 SetText(%d characters) %s" % (len(text), kw), "SetText", text)
    o.reset()
    o.buffer("old")
    call("U10 SetText with an embedded NUL: the text stops there", "SetText", "ab\0cd")
    for size, arg in ((0, 1), (256, -1), (256, 100), (256, 512), (256, 513), (256, 1000), (256, 40000), (0x8000, -1), (0x8000, 3), (0x7FFF, -1), (0xFFFF, 5), (0xFFFF, -1), (2, -1), (2, 6), (2, 4)):
        o.reset()
        o.buffer(None if size == 0 else ("ab" if size > 2 else ""), size=size, font=None)
        call("U10 SetBufferSize(%d) with room for %d" % (arg, size), "SetBufferSize", arg)
    o.reset()
    o.buffer(None, size=0, font=None)
    call("U10 SetBufferSize(7) of a buffer nobody allocated: twice the request (the 256 is for -1 or a request below twice the size)", "SetBufferSize", 7)
    call("U10 ... and again: 7 is below 2 * 14, so the size doubles", "SetBufferSize", 7)
    o.reset()
    o.buffer("abc")
    call("U10 Clear", "Clear")


if __name__ == "__main__":
    main()
