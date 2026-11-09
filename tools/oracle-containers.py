#!/usr/bin/env python3
"""
The mouse input of the controls that hold other things, on the Unicorn CPU emulator: the oracle of `CKTDGUIContolList.handleMouse`,
`CKTDGUINavigation.handleMouse` and `CKTDGUINavigation.navigationMsgProc` (packages/ui/src/controllist.ts, navigation.ts; tested by
packages/ui/test/containers-input.test.ts, which replays packages/ui/test/containers-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-containers.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-containers.py --json FILE    (and writes the script and the exe's answers to FILE)

The exe's functions run as they are: CKTDGUIContolList::HandleMouse 3294F5F0 and CKTDGUINavigation::HandleMouse 3294E160 (through slot 8 of the
real vtable of the class), the navigation's own MsgProc 3294E510 (slot 41, no window handle), and what they call: FromUIPointToRect 3294E0D0,
BoundRectInRect 3294DFA0, FromRectToPoint 3294E050, SendInternelEvent 329253D0, RequestFocus 3295B490.  The scroll bars of a control list are probe
controls whose HandleMouse (slot 8) is a stub that writes the call down and answers what the case says.  What is replaced by a stub that writes
the call down (see oracle-bars.py for the capture, `SetRect` and `OffsetRect`, and oracle-controls.py for the rest):
  * `SetCapture` / `ReleaseCapture`: `capture` / `release`;
  * `CKTDGUIControl::PlaySoundW` 329251E0: `A.sound(down)`;
  * `CKTDXApp::SendGameMessage` 328CCCD0: `gameMsg(uMsg,wParam,lParam,direct)`.
The layout is the exe's: control list +0x29C / +0x2A0 the horizontal / vertical scroll bar; navigation +0x294 the background point, +0x298 the window
point (a `UIPointData`: the four corners are eight floats from +0), +0x29C m_rcBG, +0x2AC m_rcWindow, +0x2BC m_bDraggingWindow, +0x2C0 m_ptLastMouse,
+0x2C8 the sound, +0x2CC m_CustomMsgLButtonDown, +0x2D0 m_CustomMsgMouseDragging.
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

CONTROL_LIST_HANDLE_MOUSE, NAVIGATION_HANDLE_MOUSE, NAVIGATION_MSG_PROC = 0x3294F5F0, 0x3294E160, 0x3294E510
oc.HANDLERS.update({"contollist": CONTROL_LIST_HANDLE_MOUSE, "navigation": NAVIGATION_HANDLE_MOUSE})
oc.MSG_PROCS["navigation"] = (41, NAVIGATION_MSG_PROC)


def num(v):
    """a number the way JavaScript prints it"""
    text = repr(v)
    return text[:-2] if text.endswith(".0") else text


def window_point(o, c):
    p = o.emu.u32(c + 0x298)
    return ",".join(num(v) for v in struct.unpack("<8f", o.emu.read(p, 32)))


oc.STATE_KEYS.update({
    "contollist": ("hasFocus", "focus"),
    "navigation": ("hasFocus", "focus", "dragging", "ptLast", "rcBG", "rcWindow", "winPoint"),
})
oc.FIELD_OFFSETS.update({
    "contollist": {},
    "navigation": {"dragging": 0x2BC, "ptLast": (0x2C0, "pt"), "rcBG": (0x29C, "rect"), "rcWindow": (0x2AC, "rect"), "winPoint": window_point},
})
oi.CONTROL_FIELDS.update({"m_bDraggingWindow": (0x2BC, "B")})
om.VTABLE["Navigation"], om.UCT["Navigation"] = 0x334AFFD0, 11
om.VTABLE["ContolList"], om.UCT["ContolList"] = 0x334B007C, 12


class ContainerOracle(ob.BarOracle):
    def contollist_(self, label, dialog, index=1, x=None, y=None, enable=True, show=True):
        """a control list; its scroll bars are the probe controls `x` and `y` (labels; none by default)"""
        emu = self.emu
        c = self.control("ContolList", label, dialog=index, show=show, enable=enable)
        emu.write(c + 0x29C, struct.pack("<II", self.addr[x] if x else 0, self.addr[y] if y else 0))
        self._adopt(c, label, dialog, "contollist")
        self.op("contollist", label, dialog, {"x": x, "y": y, "enable": enable, "show": show})
        return c

    def navigation_(self, label, dialog, index=1, bg=(10, 10, 210, 110), win=(50, 30, 90, 60), enable=True, show=True, drag=False, last=(0, 0),
                    down_msg=-1, drag_msg=-1, sound=True, refresh=True):
        """a navigation: the background point and the window point are the rectangles `bg` and `win` (floats); `refresh`: m_rcBG holds the
        background rectangle (ContainsPoint made it when the dialog asked where the mouse is) and m_rcWindow the window's"""
        emu = self.emu
        c = self.control("Navigation", label, dialog=index, show=show, enable=enable)
        for at, rect in ((0x294, bg), (0x298, win)):
            l, t, r, b = rect
            point = emu.alloc(0x60)
            emu.write(point, struct.pack("<8f", l, t, r, t, l, b, r, b))
            emu.w32(c + at, point)
        if refresh:
            emu.write(c + 0x29C, struct.pack("<4i", *[int(v) for v in bg]))
            emu.write(c + 0x2AC, struct.pack("<4i", *[int(v) for v in win]))
        emu.write(c + 0x2BC, bytes([1 if drag else 0]))
        emu.write(c + 0x2C0, struct.pack("<2i", *last))
        emu.w32(c + 0x2C8, oc.SOUND_DOWN if sound else 0)
        emu.write(c + 0x2CC, struct.pack("<2i", down_msg, drag_msg))
        self._adopt(c, label, dialog, "navigation")
        self.op("navigation", label, dialog, {"bg": list(bg), "win": list(win), "enable": enable, "show": show, "drag": drag, "last": list(last),
                                              "downMsg": down_msg, "dragMsg": drag_msg, "sound": sound, "refresh": refresh})
        return c


def main():
    o = ContainerOracle()

    def hit(case, label, uMsg, x, y, wParam=0, lParam=0):
        return o.act_ctl(case, label, uMsg, x, y, wParam, lParam)

    # ================================================================ CKTDGUIContolList::HandleMouse (3294F5F0)
    def fresh_list(bars="XY", **kw):
        """D (managed), the control list A and its probe scroll bars X (horizontal) and Y (vertical), as `bars` says"""
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        if "X" in bars:
            o.control_("X", "D", rect=(100, 0, 140, 40))
        if "Y" in bars:
            o.control_("Y", "D", rect=(200, 0, 240, 40))
        o.contollist_("A", "D", x="X" if "X" in bars else None, y="Y" if "Y" in bars else None, **kw)
        o.register("D", ["A"] + [b for b in "XY" if b in bars])

    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False})):
        fresh_list(**kw)
        hit("L1 message 0x201 at (20,30) with two bars, %s" % tag, "A", 0x201, 20, 30)
    for bars in ("XY", "X", "Y", ""):
        for ax, ay in ((0, 0), (1, 0), (0, 1), (1, 1)):
            fresh_list(bars)
            if "X" in bars:
                o.answer("X", "mouse", ax)
            if "Y" in bars:
                o.answer("Y", "mouse", ay)
            hit("L2 bars '%s', X answers %d, Y answers %d: the message 0x20A (wParam 0x00780008, lParam 0x1234) at (-3,77) goes to X, then to Y if X did not take it"
                % (bars, ax, ay), "A", 0x20A, -3, 77, 0x00780008, 0x1234)
    for m in (0x200, 0x201, 0x202, 0x203, 0x204, 0x205, 0x206, 0x100, 0x401):
        fresh_list("XY")
        o.answer("Y", "mouse", 1)
        hit("L3 message 0x%X reaches the bars as it is" % m, "A", m, 31, -8, 5, 6)

    # ================================================================ CKTDGUINavigation::HandleMouse (3294E160)
    def fresh_nav(**kw):
        """D (managed, with a stage), the navigation A (the background (10,10)-(210,110), the window (50,30)-(90,60), a sound, no custom messages)
        and a probe control Y (300,0)-(340,40) that can take the focus"""
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        o.navigation_("A", "D", **kw)
        o.control_("Y", "D", rect=(300, 0, 340, 40))
        o.register("D", ["A", "Y"])

    # ---- the gates and the messages that are not taken
    fresh_nav(enable=False)
    hit("N1 left button down on the window of a disabled navigation: not taken", "A", 0x201, 60, 40)
    fresh_nav(enable=False, drag=True)
    hit("N1 move while dragging, disabled: not taken", "A", 0x200, 60, 40)
    fresh_nav(show=False)
    hit("N1 left button down on the window of a hidden (but enabled) navigation: taken", "A", 0x201, 60, 40)
    for m in (0x204, 0x205, 0x206, 0x207, 0x20A, 0x100, 0x401, 0x215):
        fresh_nav(drag=True)
        hit("N1 message 0x%X while dragging (not taken)" % m, "A", m, 60, 40)

    # ---- the left button up
    fresh_nav(drag=True)
    hit("N2 up while dragging: the drag ends, the mouse is given back, taken", "A", 0x202, 60, 40)
    fresh_nav()
    hit("N2 up while not dragging: the same, taken", "A", 0x202, 600, 400)
    fresh_nav(drag=True, last=(5, 6))
    hit("N2 up far away: taken, the last point is not touched", "A", 0x202, 600, 400)

    # ---- the left button down on the window
    for m in (0x201, 0x203):
        fresh_nav()
        hit("N3 message 0x%X on the window, no focus: the focus, the drag, the capture, the message 0x466 / 0 to the game, the sound, the point" % m, "A", m, 60, 40)
        fresh_nav(); o.give_focus("Y")
        hit("N3 message 0x%X on the window, Y has the focus: Y loses it" % m, "A", m, 89, 59)
        fresh_nav(); o.give_focus("A")
        hit("N3 message 0x%X on the window, A has the focus already: no request" % m, "A", m, 50, 30)
    fresh_nav(down_msg=5)
    hit("N3 on the window, the custom message 5: the stage gets 0x467 / 5, not the game", "A", 0x201, 60, 40)
    fresh_nav(sound=False)
    hit("N3 on the window of a navigation with no sound", "A", 0x201, 60, 40)
    fresh_nav(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    hit("N3 on the window, m_bHasFocus set but the global focus is Y: no request", "A", 0x201, 60, 40)
    fresh_nav(); o.managed_("D", False); o.give_focus("Y")
    hit("N3 on the window, the dialog is not known to the manager: no request", "A", 0x201, 60, 40)
    fresh_nav(); o.gone("D"); o.give_focus("Y")
    hit("N3 on the window, the dialog is gone: no request; the game message goes out all the same", "A", 0x201, 60, 40)
    fresh_nav(down_msg=5); o.gone("D")
    hit("N3 on the window, the dialog is gone, custom message 5: no message reaches the stage", "A", 0x201, 60, 40)
    fresh_nav(win=(50.7, 30.9, 90.7, 60.5))
    hit("N3 the window point has fractions (50.7,30.9)-(90.7,60.5): the rectangle is cut to (50,30,90,60); (50,30) is on it", "A", 0x201, 50, 30)
    fresh_nav(win=(50.7, 30.9, 90.7, 60.5))
    hit("N3 the same, (90,60): off the window (the right and bottom edges are outside), on the background: the window is centred", "A", 0x201, 90, 60)
    fresh_nav(refresh=False)
    hit("N3 on the window, the rectangles not made yet: both are made from the points first", "A", 0x201, 60, 40)
    fresh_nav(last=(-9, 99))
    hit("N3 the last point is replaced", "A", 0x201, 60, 40)

    # ---- the left button down on the background, off the window: the window is centred on the point
    for m in (0x201, 0x203):
        fresh_nav()
        hit("N4 message 0x%X on the background off the window at (100,80): the window (40 x 30) is centred there, twice the sound" % m, "A", m, 100, 80)
    fresh_nav(); o.give_focus("Y")
    hit("N4 on the background, Y has the focus: Y loses it", "A", 0x201, 100, 80)
    fresh_nav(); o.give_focus("A")
    hit("N4 on the background, A has the focus already: no request", "A", 0x201, 100, 80)
    fresh_nav(down_msg=5)
    hit("N4 on the background, the custom message 5: the stage gets 0x467 / 5", "A", 0x201, 100, 80)
    fresh_nav(sound=False)
    hit("N4 on the background of a navigation with no sound", "A", 0x201, 100, 80)
    fresh_nav(); o.managed_("D", False); o.give_focus("Y")
    hit("N4 on the background, the dialog is not known to the manager: no request", "A", 0x201, 100, 80)
    fresh_nav(); o.gone("D"); o.give_focus("Y")
    hit("N4 on the background, the dialog is gone: no request", "A", 0x201, 100, 80)
    fresh_nav(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
    hit("N4 on the background, m_bHasFocus set but the global focus is Y: no request", "A", 0x201, 100, 80)
    for pt in ((15, 15), (12, 108), (205, 12), (205, 105), (10, 10), (209, 109), (30, 60), (130, 40)):
        fresh_nav()
        hit("N4 on the background at %s: the window centred there and pushed into the background" % (pt,), "A", 0x201, pt[0], pt[1])
    fresh_nav(win=(50, 30, 91, 61))
    hit("N4 a window of 41 x 31 (half a pixel more): each corner is cut to an int in single precision", "A", 0x201, 100, 80)
    fresh_nav(win=(50, 30, 91, 61))
    hit("N4 the same at (101,81)", "A", 0x201, 101, 81)
    fresh_nav(win=(50, 30, 52, 31))
    hit("N4 a window of 2 x 1: the half of the height is 0.5", "A", 0x201, 100, 80)
    fresh_nav(win=(0, 0, 300, 50))
    hit("N4 a window wider than the background (300 > 200): the left edge is pushed in, the right edge is not asked", "A", 0x201, 100, 80)
    fresh_nav(win=(0, 0, 40, 200))
    hit("N4 a window higher than the background (200 > 100): the top edge is pushed in, the bottom edge is not asked", "A", 0x201, 100, 80)
    fresh_nav(win=(0.5, 0.25, 40.75, 30.5))
    hit("N4 a window point with fractions (0.5,0.25)-(40.75,30.5): its rectangle is (0,0,40,30)", "A", 0x201, 100, 80)
    fresh_nav(bg=(10.9, 10.9, 210.9, 110.9))
    hit("N4 a background point with fractions: the rectangle is cut to (10,10,210,110)", "A", 0x201, 100, 80)
    fresh_nav(bg=(-10.7, -10.7, 210.7, 110.7))
    hit("N4 a background point with negative fractions: the rectangle is (-10,-10,210,110); the centred window is pushed to its left edge", "A", 0x201, -5, 50)
    fresh_nav(bg=(-300.7, -200.7, -100.7, -50.7), win=(-250.2, -150.2, -210.2, -120.2))
    hit("N4 a background wholly below zero (-300.7,-200.7)-(-100.7,-50.7): its rectangle is (-300,-200,-100,-50), cut towards zero", "A", 0x201, -120, -60)
    fresh_nav(bg=(-300.7, -200.7, -100.7, -50.7), win=(-250.2, -150.2, -210.2, -120.2))
    hit("N4 the same, the point (-100,-50) is outside (the right and bottom edges are outside)", "A", 0x201, -100, -50)
    fresh_nav(bg=(10.9, 10.9, 210.9, 110.9))
    hit("N4 the same, (210,110) is outside the cut rectangle: nothing happens", "A", 0x201, 210, 110)
    fresh_nav(bg=(10.9, 10.9, 210.9, 110.9))
    hit("N4 the same, (10,10) is inside", "A", 0x201, 10, 10)

    # ---- the left button down off the background
    for pt in ((300, 300), (9, 50), (210, 50), (100, 9), (100, 110), (-5, -5)):
        fresh_nav(last=(1, 2))
        hit("N5 left button down at %s, off the background: only the last point is remembered, taken" % (pt,), "A", 0x201, pt[0], pt[1])
    fresh_nav(drag=True, last=(1, 2))
    hit("N5 left button down off the background while dragging: the drag goes on", "A", 0x203, 300, 300)

    # ---- the move while dragging
    fresh_nav()
    hit("N6 move while not dragging: taken, nothing else (the last point stays)", "A", 0x200, 70, 55)
    fresh_nav(last=(3, 4))
    hit("N6 move while not dragging, far away: taken, nothing else", "A", 0x200, 700, 550)
    fresh_nav(drag=True, last=(60, 40))
    hit("N6 move from (60,40) to (70,55): the window moves by (10,15), the stage gets the game message 0x466 / 1", "A", 0x200, 70, 55)
    fresh_nav(drag=True, last=(60, 40), drag_msg=7)
    hit("N6 the same with the custom message 7 for the dragging: the stage gets 0x467 / 7", "A", 0x200, 70, 55)
    fresh_nav(drag=True, last=(60, 40)); o.gone("D")
    hit("N6 the same move, the dialog gone: the game message goes out all the same (it does not use the dialog)", "A", 0x200, 70, 55)
    fresh_nav(drag=True, last=(60, 40), drag_msg=7); o.gone("D")
    hit("N6 the same with the custom message, the dialog gone: nothing reaches the stage", "A", 0x200, 70, 55)
    for pt in ((60, 40), (61, 41), (-30, 40), (60, -50), (400, 40), (60, 300), (-900, -900), (900, 900), (40, 90), (130, 40)):
        fresh_nav(drag=True, last=(60, 40))
        hit("N6 move from (60,40) to %s: the window moves by the difference and is pushed into the background" % (pt,), "A", 0x200, pt[0], pt[1])
    fresh_nav(drag=True, last=(-60, -40))
    hit("N6 move from (-60,-40) to (-50,-30): the last point is negative", "A", 0x200, -50, -30)
    fresh_nav(drag=True, last=(60, 40), win=(50.7, 30.9, 90.7, 60.5))
    hit("N6 move with a window point with fractions: its rectangle (50,30,90,60) is moved, the fractions are gone", "A", 0x200, 70, 55)
    fresh_nav(drag=True, last=(60, 40), win=(-20.7, -30.7, -2.7, -1.7), bg=(-100, -100, 300, 300))
    hit("N6 move of a window point with negative fractions (-20.7,-30.7)-(-2.7,-1.7): cut towards zero, the rectangle is (-20,-30,-2,-1)", "A", 0x200, 70, 55)
    fresh_nav(drag=True, last=(60, 40), win=(50, 30, 90, 60), bg=(-10.7, -20.7, 210.7, 110.7))
    hit("N6 move into a background with fractions (-10.7,-20.7)-(210.7,110.7), pushed to its cut edges (-10,-20,210,110)", "A", 0x200, -900, -900)
    fresh_nav(drag=True, last=(60, 40), win=(50, 30, 90, 60), bg=(-10.7, -20.7, 210.7, 110.7))
    hit("N6 the same pushed to the far corner", "A", 0x200, 900, 900)
    fresh_nav(drag=True, last=(60, 40), win=(0, 0, 300, 50))
    hit("N6 move of a window wider than the background: the left edge wins", "A", 0x200, 60, 40)
    fresh_nav(drag=True, last=(60, 40), win=(0, 0, 40, 200))
    hit("N6 move of a window higher than the background: the top edge wins", "A", 0x200, 60, 40)
    fresh_nav(drag=True, last=(60, 40), win=(10, 30, 300, 60))
    hit("N6 move of a window flush with the background's left edge and wider: the left edge is in (not outside), so the right edge is asked", "A", 0x200, 60, 40)
    fresh_nav(drag=True, last=(60, 40), win=(20, 10, 60, 300))
    hit("N6 move of a window flush with the background's top edge and higher: the top edge is in, so the bottom edge is asked", "A", 0x200, 60, 40)
    fresh_nav(drag=True, last=(60, 40), win=(20, 30, 210, 60))
    hit("N6 move of a window flush with the background's right edge: no step", "A", 0x200, 60, 40)
    fresh_nav(drag=True, last=(60, 40), win=(20, 30, 60, 110))
    hit("N6 move of a window flush with the background's bottom edge: no step", "A", 0x200, 60, 40)
    fresh_nav(drag=True, last=(60, 40), win=(20, 20, 300, 50))
    hit("N6 move of a window whose left edge is inside the background and whose right edge is outside: the right edge is asked", "A", 0x200, 60, 40)
    fresh_nav(drag=True, last=(60, 40), win=(20, 20, 60, 300))
    hit("N6 move of a window whose top edge is inside the background and whose bottom edge is outside: the bottom edge is asked", "A", 0x200, 60, 40)
    fresh_nav(drag=True, last=(60, 40), refresh=False)
    hit("N6 move while dragging with m_rcBG not made (all zero): the window is pushed into an empty rectangle", "A", 0x200, 70, 55)
    fresh_nav(drag=True, last=(0, 0), bg=(0, 0, 2000000000, 100), win=(10, 10, 50, 40))
    hit("N6 a move of 16777217 pixels: the difference is taken in single precision (16777216)", "A", 0x200, 16777217, 20)
    fresh_nav(drag=True, last=(16777217, 0), bg=(0, 0, 2000000000, 100), win=(10, 10, 50, 40))
    hit("N6 a move from 16777217 to 16777219: single precision (16777216 to 16777220, a step of 4)", "A", 0x200, 16777219, 20)
    fresh_nav(drag=True, last=(-16777217, 0), bg=(-2000000000, 0, 2000000000, 100), win=(10, 10, 50, 40))
    hit("N6 a move from -16777217 to 3", "A", 0x200, 3, 20)

    # past 2^24 an int is not a float any more (the cases were found with a model of the formula: each gives another corner when one operand is kept
    # exact); the background is wider than 2^24 so that the window stays where it is put
    for x in (16777217, 16777219):
        fresh_nav(bg=(0, 0, 2000000000, 100), win=(50, 30, 91, 61))
        hit("N4 a window of 41 x 31 centred on x %d: x is rounded to single precision before the half width is added or taken (the corners differ by 1)" % x, "A", 0x201, x, 80)
    for y in (16777217, 16777219):
        fresh_nav(bg=(0, 0, 100, 2000000000), win=(10, 10, 50, 41))
        hit("N4 a window of 40 x 31 centred on y %d: y is rounded to single precision before the half height is added or taken" % y, "A", 0x201, 70, y)
    fresh_nav(bg=(-2147483648, -2147483648, 2147483520, 2147483520), win=(-2000000000, -2000000000, 2000000000, 2000000000))
    hit("N4 a window 4000000000 wide and high (its width is -294967296 in 32 bits): the half is -147483648, a corner past the int range is the integer indefinite", "A", 0x201, -2100000000, 0)
    # a corner below zero with a fraction is cut towards zero (-15.5 is -15), not down (-16): the background reaches below zero so that nothing pushes it
    fresh_nav(bg=(-100, -100, 210, 110), win=(50, 30, 91, 61))
    hit("N4 a window of 41 x 31 centred on (5,5), the background reaches below zero: left 5 - 20.5 = -15.5 and top 5 - 15.5 = -10.5 are cut towards zero (-15, -10)", "A", 0x201, 5, 5)
    fresh_nav(bg=(-100, -100, 210, 110), win=(50, 30, 91, 61))
    hit("N4 the same centred on (-3,-4): left -23.5 and top -19.5 give -23 and -19; right 17.5 and bottom 11.5 give 17 and 11", "A", 0x201, -3, -4)
    for axis in "xy":
        def pos(v, other=20):
            return (v, other) if axis == "x" else (other, v)
        wide = (0, 0, 2000000000, 100) if axis == "x" else (0, 0, 100, 2000000000)
        for last, to, tag in ((0, 16777217, "a move of 16777217 pixels is 16777216 in single precision"),
                              (16777217, 16777219, "a move from 16777217 to 16777219 is a step of 4 (16777216 to 16777220)"),
                              (-16777217, 3, "a move from -16777217 to 3 is 16777219 rounded to 16777220")):
            fresh_nav(drag=True, last=pos(last, 0), bg=(-2000000000, -2000000000, 2000000000, 2000000000) if last < 0 else wide, win=(10, 10, 50, 40))
            hit("N6 (%s) %s" % (axis, tag), "A", 0x200, *pos(to))

    # ---- a drag from the press to the release
    fresh_nav()
    hit("N7 a drag: down on the background at (100,80)", "A", 0x201, 100, 80)
    hit("N7 a drag: move to (110,90)", "A", 0x200, 110, 90)
    hit("N7 a drag: move to (300,300) (the window is pushed into the background)", "A", 0x200, 300, 300)
    hit("N7 a drag: move back to (10,10)", "A", 0x200, 10, 10)
    hit("N7 a drag: up", "A", 0x202, 10, 10)
    hit("N7 a drag: move after the up (not dragging)", "A", 0x200, 50, 50)
    hit("N7 a drag: down on the window where it is now", "A", 0x201, 12, 12)
    hit("N7 a drag: move", "A", 0x200, 20, 33)
    hit("N7 a drag: double click on the background", "A", 0x203, 150, 100)
    fresh_nav(down_msg=3, drag_msg=4)
    hit("N7 a drag with custom messages: down on the window", "A", 0x201, 60, 40)
    hit("N7 a drag with custom messages: move", "A", 0x200, 65, 45)
    hit("N7 a drag with custom messages: up", "A", 0x202, 65, 45)

    # ---- MsgProc (slot 41)
    for m in (0x215, 0x200, 0x201, 0x202, 0x214, 0x216, 0x0, 0x100):
        fresh_nav(drag=True)
        o.act_msg("N8 MsgProc 0x%X while dragging: only 0x215 (the capture changed) ends the drag; never taken" % m, "A", m, 3, 4)
    fresh_nav()
    o.act_msg("N8 MsgProc 0x215 while not dragging", "A", 0x215, 0, 0)
    fresh_nav(enable=False, show=False, drag=True)
    o.act_msg("N8 MsgProc 0x215 of a disabled and hidden navigation: the drag ends all the same", "A", 0x215, 0, 0)

    if "--json" in sys.argv:
        import json
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w") as fh:
            json.dump(o.script, fh, indent=0, separators=(",", ":"))
            fh.write("\n")


if __name__ == "__main__":
    main()
