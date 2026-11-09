#!/usr/bin/env python3
"""
The mouse geometry of x2.exe on the Unicorn CPU emulator: the oracle of packages/ui/src/pick.ts and of the `containsPoint` /
`getControlAtPoint*` / `onMouseMove` of the control classes and the dialog (packages/ui/test/mouse.test.ts).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-mouse.py            (prints a table: one line per case, `case -> exe answer`)

The exe's functions run as they are, on controls and a dialog built by hand in the emulated memory (the vtable pointer of a control is the
real vtable of its class, so `ContainsPoint` and `GetShow` are reached the way the dialog reaches them):
  * Pick2DRect 32946C10, CKTDGUIControl::ContainsPoint 32924310, CKTDGUIStatic::ContainsPoint 32928E90, and the function Button and Slot
    share, 3292D460 (it reads the control's dialog through `CKTDGUIDialogHandle::operator->` 32963910, which is replaced by a stub that
    answers the dialog the handle's index names, or the global null object 0x336434B8 for index -1: the table of `KJohnObjMan` is not built);
  * CKTDGUIListBox::ContainsPoint 32942D10, CKTDGUIContolList::ContainsPoint 3294F490 (the bounding box of their scroll bars: +0x378) and
    CKTDGUINavigation::ContainsPoint 3294E000 (its background point +0x294, its rectangle +0x29C; `PtInRect` of USER32, IAT 0x3348F628, is a
    stub that answers the Win32 rule: left <= x < right, top <= y < bottom);
  * CKTDGUIDialog::GetControlAtPointAbsolute 32957310, GetControlAtPointForStatic 329573C0 and OnMouseMove 3295A4D0, which scale the point
    into each control's own pixels with `g_pKTDXApp->m_ResolutionScale` (a fake application block at the pointer 0x33639898).
Nothing else is emulated: a function that needs the heap, the CRT or the window system (GetControlMouseOver builds a std::wstring) is not run.

The layout of the objects is the exe's (tools/layout.py): control +0x04 dialog handle (index, magic), +0x0C type, +0x58 offset, +0xB1 mouse over,
+0xB2 enable, +0xB3 show, +0xB5 out of list, +0xBC the current point (four corners), +0x19C / +0x1A4 the enable rectangle; Static +0x21C the
picture list (a vector of CPictureData*, `pPoint` at +4); dialog +0x2C position, +0x78 / +0x7C / +0x80 the mouse over controls, +0x84 the
list of controls (first, last, end), +0x152 `m_bMouseOverShowDlg`; the application +0x178 the scale.
"""
import os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from peemu import *

EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "x2.exe")
APP_PTR = 0x33639898
NULL_DIALOG = 0x336434B8
OPERATOR_ARROW = 0x32963910
PTINRECT_IAT = 0x3348F628
VTABLE = {
    "Control": 0x334AF154, "Static": 0x334AF484, "Button": 0x334AF544, "Slot": 0x334B0130, "ListBox": 0x334AFD3C,
    "Navigation": 0x334AFFD0, "ContolList": 0x334B007C,
}
UCT = {"Control": 0, "Static": 5, "Button": 1, "Slot": 13, "ListBox": 9, "Navigation": 11, "ContolList": 12}


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


class MouseOracle:
    def __init__(self, exe=EXE):
        self.emu = emu = PEEmu(exe)
        self.dialogs = {}  # handle index -> address
        self.controls = {}  # address -> name
        # CKTDGUIDialogHandle::operator->: a stub that answers by the handle's index
        stub = emu.stub(None, b"\xC3")
        emu.write(OPERATOR_ARROW, b"\xE9" + struct.pack("<i", stub - (OPERATOR_ARROW + 5)))
        emu.hook(stub, self._arrow)
        emu.hook(emu.stub(PTINRECT_IAT, b"\xC2\x0C\x00"), self._ptinrect)  # stdcall (const RECT*, POINT)
        self.set_scale(1.0, 1.0)

    def _ptinrect(self, emu):
        rc, x, y = emu.args(3)
        left, top, right, bottom = struct.unpack("<4i", emu.read(rc, 16))
        sx, sy = struct.unpack("<ii", struct.pack("<II", x, y))
        emu.set_reg(UC_X86_REG_EAX, 1 if left <= sx < right and top <= sy < bottom else 0)

    def _arrow(self, emu):
        handle = emu.reg(UC_X86_REG_ECX)
        index = struct.unpack("<i", emu.read(handle, 4))[0]
        emu.set_reg(UC_X86_REG_EAX, self.dialogs.get(index, NULL_DIALOG) if index >= 0 else NULL_DIALOG)

    # ---- objects
    def set_scale(self, sx, sy):
        emu = self.emu
        app = emu.alloc(0x400)
        emu.write(app + 0x178, struct.pack("<2f", sx, sy))
        emu.w32(APP_PTR, app)

    def dialog(self, index, pos=(0.0, 0.0)):
        emu = self.emu
        d = emu.alloc(0x400)
        emu.write(d + 0x2C, struct.pack("<2f", *pos))
        self.dialogs[index] = d
        self.controls[d] = "dialog%d" % index
        return d

    def control(self, cls, name, corners=None, offset=(0.0, 0.0), show=True, enable=True, out_of_list=False, dialog=-1,
                enable_lt=(0.0, 0.0), enable_rb=(0.0, 0.0), pictures=None, mouse_over=False, bars=None, bg=None, size=0x400):
        """corners: left-top, right-top, left-bottom, right-bottom (the current point); pictures (a Static): a list of such corner lists;
        size: the bytes of the object (a combo box is 0x424)"""
        emu = self.emu
        c = emu.alloc(size)
        emu.w32(c, VTABLE[cls])
        emu.write(c + 4, struct.pack("<ii", dialog, 1))
        emu.w32(c + 0xC, UCT[cls])
        emu.write(c + 0x58, struct.pack("<2f", *offset))
        emu.write(c + 0xB1, bytes([1 if mouse_over else 0, 1 if enable else 0, 1 if show else 0, 0, 1 if out_of_list else 0]))
        if corners:
            emu.write(c + 0xBC, struct.pack("<8f", *[v for p in corners for v in p]))
        emu.write(c + 0x19C, struct.pack("<4f", *enable_lt, *enable_rb))
        if pictures is not None:
            ptrs = []
            for cs in pictures:
                point = emu.alloc(0x60)
                emu.write(point, struct.pack("<8f", *[v for p in cs for v in p]) if cs else bytes(32))
                picture = emu.alloc(0xA0)
                emu.w32(picture + 4, point if cs else 0)
                ptrs.append(picture)
            vec = emu.alloc(4 * max(1, len(ptrs)))
            emu.write(vec, b"".join(struct.pack("<I", p) for p in ptrs))
            emu.write(c + 0x21C, struct.pack("<III", vec, vec + 4 * len(ptrs), vec + 4 * len(ptrs)))
        if bars is not None:  # a list box: (bounding box,); a control list: (x bar box or None, y bar box or None)
            ptrs = []
            for box in bars:
                if box is None:
                    ptrs.append(0)
                    continue
                bar = emu.alloc(0x400)
                emu.write(bar + 0x378, struct.pack("<4i", *box))
                ptrs.append(bar)
            if cls == "ListBox":
                emu.w32(c + 0x268, ptrs[0])
            else:
                emu.write(c + 0x29C, struct.pack("<II", *ptrs))
        if bg is not None:  # a navigation's background point (corners)
            point = emu.alloc(0x60)
            emu.write(point, struct.pack("<8f", *[v for p in bg for v in p]))
            emu.w32(c + 0x294, point)
        self.controls[c] = name
        return c

    def fill(self, dialog, controls):
        emu = self.emu
        vec = emu.alloc(4 * max(1, len(controls)))
        emu.write(vec, b"".join(struct.pack("<I", c) for c in controls))
        emu.write(dialog + 0x84, struct.pack("<III", vec, vec + 4 * len(controls), vec + 4 * len(controls)))

    # ---- calls
    def thiscall(self, addr, this, args=()):
        self.emu.set_reg(UC_X86_REG_ECX, this)
        return self.emu.call(addr, list(args))

    def pick2d(self, x, y, lt, rt, lb, rb):
        emu = self.emu
        pt = emu.alloc(8)
        emu.write(pt, struct.pack("<ii", x, y))
        ptrs = []
        for p in (lt, rt, lb, rb):
            a = emu.alloc(8)
            emu.write(a, struct.pack("<2f", *p))
            ptrs.append(a)
        return bool(emu.call(0x32946C10, [pt, *ptrs]) & 0xFF)

    def contains(self, control, x, y):
        """the virtual ContainsPoint (slot 12) of the control's class"""
        vptr = self.emu.u32(control)
        fn = self.emu.u32(vptr + 48)
        return bool(self.thiscall(fn, control, [x, y]) & 0xFF)

    def contains_base(self, control, x, y):
        return bool(self.thiscall(0x32924310, control, [x, y]) & 0xFF)

    def at_point(self, dialog, x, y, absolute=False):
        r = self.thiscall(0x32957310 if absolute else 0x329573C0, dialog, [x, y])
        return self.controls.get(r) if r else None

    def on_mouse_move(self, dialog, x, y):
        self.thiscall(0x3295A4D0, dialog, [x, y])
        read = lambda off: self.controls.get(self.emu.u32(dialog + off))
        return {"over": read(0x78), "overShowDlg": read(0x7C), "overStatic": read(0x80)}

    def mouse_over_flag(self, control):
        return bool(self.emu.read(control + 0xB1, 1)[0])


def rect(l, t, r, b):
    return [(l, t), (r, t), (l, b), (r, b)]


def main():
    o = MouseOracle()
    out = []

    def say(case, value):
        out.append((case, value))
        print("%-86s %s" % (case, value))

    # ---- Pick2DRect and the base ContainsPoint on the same quadrilaterals
    A = rect(10, 20, 110, 70)
    R = [(110, 20), (10, 20), (110, 70), (10, 70)]
    S = [(0, 0), (100, 20), (30, 60), (130, 80)]
    e = 2.0 ** -15
    Q = [(0, -e), (1 + e, 1 + e), (-1, 3), (2.5, 4)]
    shapes = {"A": A, "R": R, "S": S, "Q": Q}
    pts = {
        "A": [(50, 40), (10, 40), (110, 40), (50, 20), (50, 70), (11, 21), (109, 69), (9, 40), (111, 40), (50, 19), (50, 71)],
        "R": [(50, 40), (10, 40), (110, 40), (50, 20)],
        "S": [(50, 11), (50, 9), (50, 10), (65, 35), (30, 60), (31, 60), (100, 20), (99, 21), (130, 80), (129, 79), (20, 30), (110, 60)],
        "Q": [(1, 1)],
    }
    base = {k: o.control("Control", "base" + k, corners=v) for k, v in shapes.items()}
    for k, plist in pts.items():
        for (x, y) in plist:
            p = o.pick2d(x, y, *shapes[k])
            b = o.contains_base(base[k], x, y)
            say("pick2DRect / base %s (%d, %d)" % (k, x, y), (p, b))
            assert p == b

    # ---- a Static: the pictures' points
    st = o.control("Static", "static", pictures=[rect(0, 0, 50, 50), None, rect(100, 100, 200, 160), S])
    for (x, y) in [(25, 25), (50, 25), (60, 60), (150, 130), (100, 130), (65, 35), (30, 60), (5, 5), (-1, 5)]:
        say("static (%d, %d)" % (x, y), o.contains(st, x, y))
    say("static without a picture (1, 1)", o.contains(o.control("Static", "empty", pictures=[]), 1, 1))
    say("static, a picture without a point (1, 1)", o.contains(o.control("Static", "nopoint", pictures=[None]), 1, 1))

    # ---- Button / Slot: the base test and the enable rectangle (+ the dialog's position truncated)
    big = rect(0, 0, 200, 200)
    for dpos, tag in (((5.0, 7.0), "dialog (5, 7)"), ((5.9, 7.9), "dialog (5.9, 7.9)"), ((-5.9, -7.9), "dialog (-5.9, -7.9)")):
        d = o.dialog(1, dpos)
        for cls in ("Button", "Slot"):
            c = o.control(cls, cls, corners=big, dialog=1, enable_lt=(30.0, 25.0), enable_rb=(90.0, 60.0))
            for (x, y) in [(50, 40), (25, 40), (26, 40), (36, 40), (35, 40), (84, 40), (85, 40), (50, 18), (50, 19), (50, 20), (50, 52), (50, 53), (50, 59), (50, 60), (95, 40)]:
                say("%s %s enable (30,25)-(90,60) (%d, %d)" % (cls, tag, x, y), o.contains(c, x, y))
    d = o.dialog(2, (5.0, 7.0))
    for label, lt, rb in (("lt (0,0)", (0.0, 0.0), (90.0, 60.0)), ("rb (0,0)", (30.0, 25.0), (0.0, 0.0)), ("lt (0,5)", (0.0, 5.0), (90.0, 60.0)),
                          ("walked left and up", (90.0, 60.0), (30.0, 25.0)), ("x1 < x2, y1 > y2", (30.0, 60.0), (90.0, 25.0)),
                          ("x1 > x2, y1 < y2", (90.0, 25.0), (30.0, 60.0)), ("dx = 0", (30.0, 25.0), (30.0, 60.0)), ("dy = 0", (30.0, 25.0), (90.0, 25.0))):
        c = o.control("Button", "b", corners=big, dialog=2, enable_lt=lt, enable_rb=rb)
        say("Button dialog (5, 7) enable %s: (50,40) (36,40) (84,40) (50,52)" % label, tuple(o.contains(c, x, y) for (x, y) in [(50, 40), (36, 40), (84, 40), (50, 52)]))
    wide = o.control("Button", "wide", corners=rect(-50, -50, 200, 200), dialog=2, enable_lt=(0.0, 5.0), enable_rb=(90.0, 60.0))
    say("Button base quad (-50,-50)-(200,200) dialog (5, 7) enable (0,5)-(90,60): (-10,40) (-5,40) (-4,40) (84,40) (85,40) (86,40) (50,-3) (50,-2) (50,-1) (50,52) (50,53)",
        tuple(o.contains(wide, x, y) for (x, y) in [(-10, 40), (-5, 40), (-4, 40), (84, 40), (85, 40), (86, 40), (50, -3), (50, -2), (50, -1), (50, 52), (50, 53)]))
    c = o.control("Button", "nodlg", corners=big, dialog=-1, enable_lt=(30.0, 25.0), enable_rb=(90.0, 60.0))
    say("Button without a dialog (null object at (0, 0)): (30,40) (31,40) (89,40) (90,40) (50,25) (50,26)", tuple(o.contains(c, x, y) for (x, y) in [(30, 40), (31, 40), (89, 40), (90, 40), (50, 25), (50, 26)]))
    c = o.control("Button", "outside", corners=rect(10, 20, 110, 70), dialog=2, enable_lt=(30.0, 25.0), enable_rb=(90.0, 60.0))
    say("Button base quad (10,20)-(110,70) dialog (5, 7): (50,40) (50,19) (50,20) (50,21) (111,40)", tuple(o.contains(c, x, y) for (x, y) in [(50, 40), (50, 19), (50, 20), (50, 21), (111, 40)]))

    # ---- ListBox, ControlList, Navigation
    box = rect(10, 20, 110, 70)
    lb = o.control("ListBox", "lb", corners=box, bars=[(120, 20, 140, 70)])
    for (x, y) in [(50, 40), (10, 40), (11, 21), (110, 40), (121, 40), (120, 40), (139, 69), (140, 40), (130, 20), (130, 21), (130, 69), (130, 70), (115, 40)]:
        say("ListBox quad (10,20)-(110,70), bar (120,20)-(140,70): (%d, %d)" % (x, y), o.contains(lb, x, y))
    cl = o.control("ContolList", "cl", corners=box, bars=[(10, 80, 110, 95), (120, 20, 140, 70)])
    for (x, y) in [(50, 40), (50, 85), (50, 80), (50, 81), (11, 94), (11, 95), (121, 40), (130, 20), (130, 21), (115, 85), (111, 90), (139, 69), (140, 40)]:
        say("ContolList quad (10,20)-(110,70), bars x (10,80)-(110,95), y (120,20)-(140,70): (%d, %d)" % (x, y), o.contains(cl, x, y))
    cl_y = o.control("ContolList", "clY", corners=box, bars=[None, (120, 20, 140, 70)])
    cl_n = o.control("ContolList", "clNone", corners=box, bars=[None, None])
    cl_x = o.control("ContolList", "clX", corners=box, bars=[(10, 80, 110, 95), None])
    say("ContolList with the y bar only: (130, 40) (50, 85)", (o.contains(cl_y, 130, 40), o.contains(cl_y, 50, 85)))
    say("ContolList with no bar: (130, 40) (50, 85) (50, 40)", (o.contains(cl_n, 130, 40), o.contains(cl_n, 50, 85), o.contains(cl_n, 50, 40)))
    say("ContolList with the x bar only: (130, 40) (50, 85)", (o.contains(cl_x, 130, 40), o.contains(cl_x, 50, 85)))
    nav = o.control("Navigation", "nav", bg=[(10.9, 20.9), (110.9, 20.9), (10.9, 70.9), (110.9, 70.9)])
    for (x, y) in [(10, 20), (9, 20), (10, 19), (109, 69), (110, 40), (50, 70), (50, 69), (-1, -1)]:
        say("Navigation background (10.9,20.9)-(110.9,70.9) -> rect (10,20,110,70): (%d, %d)" % (x, y), o.contains(nav, x, y))
    nav_neg = o.control("Navigation", "navNeg", bg=[(-10.9, -20.9), (10.9, -20.9), (-10.9, 20.9), (10.9, 20.9)])
    for (x, y) in [(-10, -20), (-11, -20), (0, 0), (9, 19), (10, 0), (0, 20)]:
        say("Navigation background (-10.9,-20.9)-(10.9,20.9) -> rect (-10,-20,10,20): (%d, %d)" % (x, y), o.contains(nav_neg, x, y))

    # ---- the dialog's scaling of the point and its lists
    for sx, sy in ((1.5, 2.0), (0.75, 0.5), (1.0, 1.0), (1.25, 0.9375)):
        o.set_scale(sx, sy)
        d = o.dialog(3)
        # the control's own quad is (0,0)-(20,10) in its layout pixels, its offset (30.5, 40.25)
        c = o.control("Static", "s", pictures=[rect(0, 0, 20, 10)], offset=(30.5, 40.25), dialog=3)
        o.fill(d, [c])
        hits = []
        for px in range(-2, 80):
            for py in range(-2, 100):
                if o.at_point(d, px, py):
                    hits.append((px, py))
        xs = sorted({p[0] for p in hits})
        ys = sorted({p[1] for p in hits})
        say("scale (%s, %s): a static at offset (30.5, 40.25), quad 20 x 10: screen x / y found" % (sx, sy), (xs[0], xs[-1], len(xs), ys[0], ys[-1], len(ys), len(hits)))
    o.set_scale(1.0, 1.0)

    # ---- the order of the list, the filters and OnMouseMove
    d = o.dialog(4)
    q = rect(0, 0, 100, 100)
    bottom = o.control("Button", "bottom", corners=q, dialog=4)
    middle = o.control("Static", "middle", pictures=[q], dialog=4)
    hidden = o.control("Button", "hidden", corners=q, dialog=4, show=False)
    outl = o.control("Button", "outOfList", corners=q, dialog=4, out_of_list=True)
    off = o.control("Button", "disabledButAbsolute", corners=rect(200, 200, 300, 300), dialog=4, enable=False)
    o.fill(d, [bottom, middle, hidden, outl, off])
    say("list bottom, middle(static), hidden, outOfList, off: at (50, 50) for static", o.at_point(d, 50, 50))
    say("... absolute", o.at_point(d, 50, 50, absolute=True))
    say("... (250, 250) for static / absolute", (o.at_point(d, 250, 250), o.at_point(d, 250, 250, absolute=True)))
    r = o.on_mouse_move(d, 50, 50)
    say("OnMouseMove (50, 50)", (r, [o.mouse_over_flag(c) for c in (bottom, middle, hidden, outl, off)]))
    r = o.on_mouse_move(d, 250, 250)
    say("OnMouseMove (250, 250)", (r, [o.mouse_over_flag(c) for c in (bottom, middle, hidden, outl, off)]))
    emu = o.emu
    emu.write(d + 0x152, b"\x01")
    r = o.on_mouse_move(d, 50, 50)
    say("OnMouseMove (50, 50), m_bMouseOverShowDlg", (r, [o.mouse_over_flag(c) for c in (bottom, middle, hidden, outl, off)]))
    r = o.on_mouse_move(d, 250, 250)
    say("OnMouseMove (250, 250), m_bMouseOverShowDlg", (r, [o.mouse_over_flag(c) for c in (bottom, middle, hidden, outl, off)]))
    r = o.on_mouse_move(d, 500, 500)
    say("OnMouseMove (500, 500), m_bMouseOverShowDlg", (r, [o.mouse_over_flag(c) for c in (bottom, middle, hidden, outl, off)]))
    return out


if __name__ == "__main__":
    main()
