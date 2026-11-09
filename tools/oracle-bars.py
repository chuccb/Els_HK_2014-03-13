#!/usr/bin/env python3
"""
The mouse input of the slider and the scroll bar of x2.exe on the Unicorn CPU emulator: the oracle of `CKTDGUISlider.handleMouse`,
`CKTDGUIScrollBar.handleMouse` and `CKTDGUIScrollBar.scrollBarMsgProc` (packages/ui/src/slider.ts, scrollbar.ts; tested by
packages/ui/test/bars-input.test.ts, which replays packages/ui/test/bars-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-bars.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-bars.py --json FILE    (and writes the script and the exe's answers to FILE)

The exe's functions run as they are: CKTDGUISlider::HandleMouse 3294C9F0 and CKTDGUIScrollBar::HandleMouse 32985B00 (through slot 8 of the
real vtable of the class), the scroll bar's own MsgProc 32985E10 (slot 41: it takes (uMsg, wParam, lParam), the control's MsgProc of slot 6 is
the base's `return false`), and what they call: SetValueInternal 3294D210, UpdateRects (slider 3294D290, scroll bar 329866A0), Scroll 329863A0,
Cap 32985AB0, UpdateThumbRect 32986770, DXUTGetTime 328A10D0 (over a fake DXUT state whose `m_Time` the cases set), SendInternelEvent 329253D0,
RequestFocus 3295B490 and the base focus functions.  What is replaced by a stub that writes the call down (see oracle-controls.py for the
objects, the stage and the other stubs; oracle-toggles.py for the capture):
  * `SetCapture` / `ReleaseCapture` (the imports at 0x3348F61C / 0x3348F620; `DXUTGetHWND` 328A0F30 answers a fake window): `capture` / `release`;
  * `CKTDGUIControl::PlaySoundW` 329251E0: `A.sound(down)` (the scroll bar's mouse down sound is a fake pointer) / `A.sound(none)`;
  * the critical section DXUTGetTime enters and leaves (`EnterCriticalSection` / `LeaveCriticalSection`, the imports at 0x3348F1EC / 0x3348F1B4):
    nothing happens (one thread).
`SetRect` and `OffsetRect` (the imports at 0x3348F6C8 / 0x3348F64C) are written in Python (they are the Win32 functions).  A control's
rectangles come from the exe's UpdateRects when the case builds it, or from the case (`put`).
The layout is the exe's: slider +0x21C m_x, +0x220 m_y, +0x224 m_width, +0x228 m_height, +0x22C / +0x230 the button's size, +0x294
m_CustomMsgValueChanged, +0x298 m_nValue, +0x29C m_nMin, +0x2A0 m_nMax, +0x2A4 m_nDragX, +0x2A8 m_nDragOffset, +0x2AC m_nButtonX, +0x2B0
m_bPressed, +0x2B4 m_rcButton, +0x2C4 m_rcBoundingBox; scroll bar +0x21C m_bShowThumb, +0x21D m_bDrag, +0x21E / +0x21F the clicked flags, +0x220
m_rcUpButton, +0x230 m_rcDownButton, +0x240 m_rcTrack, +0x250 m_rcThumb, +0x340 m_nPosition, +0x344 m_nPageSize, +0x348 m_nStart, +0x34C
m_nEnd, +0x350 m_LastMouse, +0x358 m_Arrow, +0x360 m_dArrowTS, +0x368 m_x, +0x36C m_y, +0x370 m_width, +0x374 m_height, +0x378 m_rcBoundingBox,
+0x388 the mouse down sound, +0x38C m_bEnableThumb, +0x38D m_bEnableTrack; the `static int ThumbOffsetY` is at 0x33643688.
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

SLIDER_HANDLE_MOUSE, SCROLLBAR_HANDLE_MOUSE, SCROLLBAR_MSG_PROC = 0x3294C9F0, 0x32985B00, 0x32985E10
SET_CAPTURE_IAT, RELEASE_CAPTURE_IAT = 0x3348F61C, 0x3348F620
SET_RECT_IAT, OFFSET_RECT_IAT = 0x3348F6C8, 0x3348F64C
DXUT_GET_HWND, GET_DXUT_STATE = 0x328A0F30, 0x328A5B80
ENTER_CS_IAT, LEAVE_CS_IAT = 0x3348F1EC, 0x3348F1B4
THUMB_OFFSET_Y = 0x33643688
om.VTABLE["Slider"], om.UCT["Slider"] = 0x334AFF24, 10
om.VTABLE["ScrollBar"], om.UCT["ScrollBar"] = 0x334B1104, 7
oc.HANDLERS.update({"slider": SLIDER_HANDLE_MOUSE, "scrollbar": SCROLLBAR_HANDLE_MOUSE})
oc.MSG_PROCS["scrollbar"] = (41, SCROLLBAR_MSG_PROC)

# the fields the cases can set (`put`) and the state writes down: (offset, format)
SLIDER_FIELDS = {
    "m_nValue": (0x298, "i"), "m_nDragX": (0x2A4, "i"), "m_nDragOffset": (0x2A8, "i"), "m_nButtonX": (0x2AC, "i"), "m_bPressed": (0x2B0, "B"),
    "m_rcButton": (0x2B4, "rect"), "m_rcBoundingBox": (0x2C4, "rect"), "m_bHasFocus": (0xB0, "B"),
}
SCROLLBAR_FIELDS = {
    "m_bShowThumb": (0x21C, "B"), "m_bDrag": (0x21D, "B"), "m_bIsUpButtonClicked": (0x21E, "B"), "m_bIsDownButtonClicked": (0x21F, "B"),
    "m_rcThumb": (0x250, "rect"), "m_rcTrack": (0x240, "rect"), "m_rcUpButton": (0x220, "rect"), "m_rcDownButton": (0x230, "rect"), "m_nPosition": (0x340, "i"), "m_Arrow": (0x358, "i"), "m_dArrowTS": (0x360, "d"),
    "m_LastMouse": (0x350, "pt"), "m_rcBoundingBox": (0x378, "rect"), "m_bEnableThumb": (0x38C, "B"), "m_bEnableTrack": (0x38D, "B"),
}
BAR_FIELDS = {"slider": SLIDER_FIELDS, "scrollbar": SCROLLBAR_FIELDS}
oc.STATE_KEYS.update({
    "slider": ("hasFocus", "focus", "value", "pressed", "dragX", "dragOffset", "buttonX", "button", "box"),
    "scrollbar": ("pos", "arrow", "arrowTS", "upClicked", "downClicked", "drag", "showThumb", "thumbOffsetY", "last", "thumb"),
})
oc.FIELD_OFFSETS.update({
    "slider": {"value": (0x298, "i"), "pressed": 0x2B0, "dragX": (0x2A4, "i"), "dragOffset": (0x2A8, "i"), "buttonX": (0x2AC, "i"),
               "button": (0x2B4, "rect"), "box": (0x2C4, "rect")},
    "scrollbar": {"pos": (0x340, "i"), "arrow": (0x358, "i"), "arrowTS": (0x360, "d"), "upClicked": 0x21E, "downClicked": 0x21F, "drag": 0x21D,
                  "showThumb": 0x21C, "thumbOffsetY": lambda o, c: str(o.i(THUMB_OFFSET_Y)), "last": (0x350, "pt"), "thumb": (0x250, "rect")},
})
oc.SOUNDS[oc.SOUND_DOWN] = "down"


class BarOracle(oc.ControlOracle):
    def __init__(self):
        super().__init__()
        emu = self.emu
        self.dxut_state = emu.alloc(0x400)
        # DXUTGetTime (g_bThreadSafe is set) enters and leaves a critical section around its read: nothing to do for one thread
        emu.stub(ENTER_CS_IAT, b"\xC2\x04\x00")
        emu.stub(LEAVE_CS_IAT, b"\xC2\x04\x00")
        emu.hook(emu.stub(SET_CAPTURE_IAT, b"\xC2\x04\x00"), lambda e: self.log("capture"))
        emu.hook(emu.stub(RELEASE_CAPTURE_IAT, b"\xC3"), lambda e: self.log("release"))
        emu.hook(emu.stub(SET_RECT_IAT, b"\xC2\x14\x00"), self._set_rect)
        emu.hook(emu.stub(OFFSET_RECT_IAT, b"\xC2\x0C\x00"), self._offset_rect)
        self.replace(DXUT_GET_HWND, lambda e: e.set_reg(EAX, oi.APP_HWND))
        self.replace(GET_DXUT_STATE, lambda e: e.set_reg(EAX, self.dxut_state))

    def _set_rect(self, emu):
        rc, l, t, r, b = emu.args(5)
        emu.write(rc, struct.pack("<4I", l, t, r, b))
        emu.set_reg(EAX, 1)

    def _offset_rect(self, emu):
        rc, dx, dy = emu.args(3)
        l, t, r, b = struct.unpack("<4i", emu.read(rc, 16))
        dx, dy = s32(dx), s32(dy)
        emu.write(rc, struct.pack("<4i", *[s32(v) for v in (l + dx, t + dy, r + dx, b + dy)]))
        emu.set_reg(EAX, 1)

    def reset(self):
        self.emu.w32(THUMB_OFFSET_Y, 0)
        self.emu.write(self.dxut_state + 0x1C0, struct.pack("<d", 0.0))
        super().reset()

    # ---- the objects
    def _adopt(self, c, label, dialog, kind):
        self.addr[label] = c
        self.owner[c] = self.addr[dialog]
        self.kind[c] = kind

    def slider_(self, label, dialog, index=1, x=10, y=0, width=200, height=20, bw=0, bh=0, value=50, vmin=0, vmax=100, msg=-1, pressed=False,
                enable=True, show=True, update=True):
        """a slider; its rectangles come from the exe's UpdateRects (the button is as high as the bar and as wide as high when bw / bh are 0)"""
        emu = self.emu
        c = self.control("Slider", label, dialog=index, show=show, enable=enable)
        emu.write(c + 0x21C, struct.pack("<6i", x, y, width, height, bw, bh))
        emu.write(c + 0x294, struct.pack("<4i", msg, value, vmin, vmax))
        emu.write(c + 0x2B0, bytes([1 if pressed else 0]))
        self._adopt(c, label, dialog, "slider")
        if update:
            self.thiscall(emu.u32(emu.u32(c) + 4 * 41), c)
        self.op("slider", label, dialog, {"x": x, "y": y, "width": width, "height": height, "bw": bw, "bh": bh, "value": value, "min": vmin,
                                           "max": vmax, "msg": msg, "pressed": pressed, "enable": enable, "show": show, "update": update})
        return c

    def scrollbar_(self, label, dialog, index=1, x=0, y=0, width=20, height=100, pos=10, page=10, start=0, end=50, enable=True, show=True,
                   thumb=True, track=True, sound=True):
        """a scroll bar; its rectangles come from the exe's UpdateRects (slot 42), which also sets the thumb"""
        emu = self.emu
        c = self.control("ScrollBar", label, dialog=index, show=show, enable=enable)
        emu.write(c + 0x21C, bytes([1]))  # m_bShowThumb (the constructor's value)
        emu.write(c + 0x340, struct.pack("<4i", pos, page, start, end))
        emu.write(c + 0x368, struct.pack("<4i", x, y, width, height))
        emu.w32(c + 0x388, oc.SOUND_DOWN if sound else 0)
        emu.write(c + 0x38C, bytes([1 if thumb else 0, 1 if track else 0]))
        self._adopt(c, label, dialog, "scrollbar")
        self.thiscall(emu.u32(emu.u32(c) + 4 * 42), c)
        self.op("scrollbar", label, dialog, {"x": x, "y": y, "width": width, "height": height, "pos": pos, "page": page, "start": start, "end": end,
                                              "enable": enable, "show": show, "thumb": thumb, "track": track, "sound": sound})
        return c

    def put(self, label, field, value):
        """a field of the slider or the scroll bar (a number, a flag as 0 / 1, a rectangle or a point as a list)"""
        c = self.addr[label]
        off, fmt = BAR_FIELDS[self.kind[c]][field]
        if fmt in ("rect", "pt"):
            self.emu.write(c + off, struct.pack("<%di" % len(value), *value))
        elif fmt == "d":
            self.emu.write(c + off, struct.pack("<d", value))
        else:
            self.poke(c + off, "<" + fmt, value)
        self.op("put", label, field, value)

    def time_(self, t):
        """DXUTGetTime() answers t from now on"""
        self.emu.write(self.dxut_state + 0x1C0, struct.pack("<d", t))
        self.op("time", t)

    def thumb_offset_(self, v):
        """the static `ThumbOffsetY` that every scroll bar shares"""
        self.emu.w32(THUMB_OFFSET_Y, v & 0xFFFFFFFF)
        self.op("thumbOffset", v)


def wheel(delta):
    return (delta & 0xFFFF) << 16


def main():
    o = BarOracle()

    def hit(case, label, uMsg, x, y, wParam=0):
        return o.act_ctl(case, label, uMsg, x, y, wParam, 0)

    # ================================================================ CKTDGUISlider::HandleMouse
    def fresh_slider(**kw):
        """D (managed, with a stage), the slider A at (10, 0), 200 x 20, value 50 of 0..100: its box (10,0)-(210,20), its button (100,0)-(120,20) at 100,
        and a probe control Y (300,0)-(340,40) that can take the focus"""
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        o.slider_("A", "D", **kw)
        o.control_("Y", "D", rect=(300, 0, 340, 40))
        o.register("D", ["A", "Y"])

    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False})):
        for m, extra in ((0x201, {}), (0x200, {"pressed": True}), (0x20A, {})):
            fresh_slider(**kw, **extra)
            hit("S1 message 0x%X at (110,10), %s" % (m, tag), "A", m, 110, 10, wheel(-120) if m == 0x20A else 0)
    for m in (0x204, 0x205, 0x206, 0x207, 0x100, 0x401, 0x211, 0x215):
        fresh_slider(pressed=True)
        hit("S1 message 0x%X on the button (not taken)" % m, "A", m, 110, 10)

    # ---- the left button down on the button
    for m in (0x201, 0x203):
        fresh_slider()
        hit("S2 message 0x%X on the button, no focus: pressed, the capture, the drag point and offset, the focus" % m, "A", m, 110, 10)
        fresh_slider(); o.give_focus("Y")
        hit("S2 message 0x%X on the button, Y has the focus: Y loses it" % m, "A", m, 107, 3)
        fresh_slider(); o.give_focus("A")
        hit("S2 message 0x%X on the button, A has the focus already: no request" % m, "A", m, 119, 19)
    fresh_slider()
    hit("S2 the button's left edge (inside)", "A", 0x201, 100, 0)
    fresh_slider()
    hit("S2 the button's right edge (outside the button, inside the bar: right of its place, a step up)", "A", 0x201, 120, 10)
    fresh_slider()
    hit("S2 the button's bottom edge (outside the button and the bar)", "A", 0x201, 110, 20)
    fresh_slider(); o.focus("Y"); o.put("A", "m_bHasFocus", 1)
    hit("S2 on the button, m_bHasFocus set but the global focus is Y: no request", "A", 0x201, 110, 10)
    fresh_slider(); o.gone("D"); o.give_focus("Y")
    hit("S2 on the button, D is gone: the focus is requested all the same", "A", 0x201, 110, 10)
    fresh_slider(x=-30, width=90, height=30, bw=12, bh=8, value=-4, vmin=-10, vmax=20)
    hit("S2 another slider (x -30, 90 x 30, button 12 x 8, value -4 of -10..20, so its button is (-18,11)-(-6,19) at 18): on its button, offset 18 + 8", "A", 0x201, -8, 15)
    fresh_slider(x=-30, width=90, height=30, bw=12, bh=8, value=-4, vmin=-10, vmax=20)
    hit("S2 the same slider, on the bar left of its button: a step down", "A", 0x201, -25, 15)
    fresh_slider(x=-30, width=90, height=30, bw=12, bh=8, value=-4, vmin=-10, vmax=20)
    hit("S2 the same slider, on the bar right of its button: a step up", "A", 0x201, 40, 5)

    # ---- the left button down on the bar, off the button
    for m in (0x201, 0x203):
        fresh_slider()
        hit("S3 message 0x%X on the bar left of the button: the value goes down by one (0x466 / 0), not pressed, offset 0" % m, "A", m, 50, 10)
        fresh_slider()
        hit("S3 message 0x%X on the bar right of the button: the value goes up by one" % m, "A", m, 150, 10)
    fresh_slider(msg=7)
    hit("S3 left of the button, custom message 7: the stage gets 0x467 / 7", "A", 0x201, 50, 10)
    fresh_slider(value=100); o.put("A", "m_nButtonX", 20)
    hit("S3 right of the button's place (m_nButtonX 20 + m_x 10), the value at its maximum: taken, no change, no message", "A", 0x201, 150, 10)
    fresh_slider(value=0); o.put("A", "m_nButtonX", 190)
    hit("S3 left of the button's place (200), the value at its minimum: taken, no change, no message", "A", 0x201, 50, 10)
    fresh_slider(value=99); o.put("A", "m_nButtonX", 20)
    hit("S3 right of the button's place, 99 of 0..100: the value goes to the maximum", "A", 0x201, 150, 10)
    fresh_slider(value=1); o.put("A", "m_nButtonX", 190)
    hit("S3 left of the button's place, 1 of 0..100: the value goes to the minimum", "A", 0x201, 50, 10)
    fresh_slider(value=100, msg=7); o.put("A", "m_nButtonX", 20)
    hit("S3 at the maximum with the custom message 7: no message", "A", 0x201, 150, 10)
    fresh_slider(); o.give_focus("Y")
    hit("S3 on the bar, Y has the focus: Y loses it, A gets it, then the value moves", "A", 0x201, 150, 10)
    fresh_slider(); o.give_focus("A")
    hit("S3 on the bar, A has the focus: no request", "A", 0x201, 150, 10)
    fresh_slider(); o.focus("Y"); o.put("A", "m_bHasFocus", 1)
    hit("S3 on the bar, m_bHasFocus set but the global focus is Y: no request, the value moves", "A", 0x201, 150, 10)
    fresh_slider(); o.put("A", "m_nDragOffset", 7)
    hit("S3 on the bar with a drag offset of 7 left from before: the offset is 0 again", "A", 0x201, 150, 10)
    fresh_slider(); o.put("A", "m_nDragOffset", 7)
    hit("S3 above the bar (not taken): the offset of 7 stays", "A", 0x201, 150, -1)
    fresh_slider()
    hit("S3 above the bar: not taken, no state change", "A", 0x201, 150, -1)
    fresh_slider()
    hit("S3 left of the bar (x 9): not taken", "A", 0x201, 9, 10)
    fresh_slider()
    hit("S3 right of the bar (x 210): not taken", "A", 0x201, 210, 10)
    fresh_slider(); o.put("A", "m_rcButton", [150, 0, 170, 20])
    hit("S3 the button's rectangle somewhere else; the point at x 110 = m_nButtonX + m_x: taken as neither side, not taken", "A", 0x201, 110, 10)
    fresh_slider(); o.put("A", "m_rcButton", [150, 0, 170, 20])
    hit("S3 the same, one to the right (a step up)", "A", 0x201, 111, 10)
    fresh_slider(); o.put("A", "m_rcButton", [150, 0, 170, 20])
    hit("S3 the same, one to the left (a step down)", "A", 0x201, 109, 10)
    fresh_slider(); o.gone("D"); o.give_focus("Y")
    hit("S3 on the bar, D is gone: the focus is requested all the same, the value moves", "A", 0x201, 150, 10)

    # ---- the move while the button is held
    fresh_slider(pressed=True)
    hit("S4 move to x 150 with the button held: value (int)(0 + 0.5 + 0.5 * 150) = 75", "A", 0x200, 150, 10)
    fresh_slider()
    hit("S4 move with the button not held: not taken", "A", 0x200, 150, 10)
    for x in (10, 11, 12, 61, 110, 209, 210, 211, 500):
        fresh_slider(pressed=True)
        hit("S4 move to x %d (button held, value 50 of 0..100, box 10..210)" % x, "A", 0x200, x, 10)
    for x in (-40, -3, 0, 7, 9):
        fresh_slider(pressed=True, vmin=5)
        hit("S4 move to x %d, minimum 5 (below it the value is clamped)" % x, "A", 0x200, x, 10)
    for x in (-5, 3, 29, 60, 77, 200):
        fresh_slider(pressed=True, x=10, width=90, vmin=-20, vmax=80, value=-20)
        hit("S4 move to x %d: box 10..100 (width 90), range -20..80: negative values are cut towards zero" % x, "A", 0x200, x, 10)
    for x in (13, 41, 77, 100, 176):
        fresh_slider(pressed=True, width=30, vmin=0, vmax=100, value=0)
        hit("S4 move to x %d: a range of 100 over 30 pixels" % x, "A", 0x200, x, 10)
    fresh_slider(pressed=True, width=300, vmin=-7, vmax=3, value=0)
    for x in (10, 52, 100, 160, 311):
        hit("S4 move to x %d: a range of 10 over 300 pixels (single precision: 0.0333...)" % x, "A", 0x200, x, 10)
    fresh_slider(pressed=True); o.put("A", "m_nDragOffset", -13)
    hit("S4 move to x 150 with the drag offset -13: value (int)(0.5 + 0.5 * 137) = 69", "A", 0x200, 150, 10)
    fresh_slider(pressed=True); o.put("A", "m_nDragOffset", 40)
    hit("S4 move to x 150 with the drag offset 40: (int)(0.5 + 0.5 * 190) = 95", "A", 0x200, 150, 10)
    fresh_slider(pressed=True, msg=9)
    hit("S4 move to x 60 with the custom message 9: the stage gets 0x467 / 9", "A", 0x200, 60, 10)
    fresh_slider(pressed=True); o.put("A", "m_rcBoundingBox", [4, 0, 164, 20])
    hit("S4 move to x 150: the box (4..164) is not the slider's (10..210): the value is read from the box's edges and the slider's m_x", "A", 0x200, 150, 10)
    fresh_slider(pressed=True); o.put("A", "m_rcBoundingBox", [10, 0, 10, 20])
    hit("S4 move with an empty box: a division by zero in single precision, the conversion gives the integer indefinite, the value is the minimum", "A", 0x200, 150, 10)
    fresh_slider(pressed=True, vmin=-50); o.put("A", "m_rcBoundingBox", [10, 0, 10, 20])
    hit("S4 move with an empty box, minimum -50: the minimum", "A", 0x200, 10, 10)
    fresh_slider(pressed=True, vmin=0, vmax=0, value=0); o.put("A", "m_rcBoundingBox", [10, 0, 10, 20])
    hit("S4 move with an empty box and an empty range: 0 / 0 is not a number, the conversion gives the integer indefinite", "A", 0x200, 10, 10)
    fresh_slider(pressed=True, vmin=0, vmax=2000000000, value=5, width=1)
    hit("S4 move with a range of two billion over one pixel: past 2^31 the conversion gives the integer indefinite, the value is the minimum", "A", 0x200, 1011, 10)
    fresh_slider(pressed=True, vmin=0, vmax=2000000000, value=5, width=1)
    hit("S4 the same with the product just in range (x 1: 2000000000)", "A", 0x200, 1, 10)
    fresh_slider(pressed=True, vmin=0, vmax=1000000, value=5, width=1000)
    hit("S4 move with a range of a million over 1000 pixels (single precision loses the low bits)", "A", 0x200, 700, 10)
    fresh_slider(pressed=True, vmin=16777001, vmax=16777301, value=16777100, width=100)
    hit("S4 move with an odd minimum near 2^24: min + 0.5 is rounded to even in single precision (16777002), not kept", "A", 0x200, 80, 10)
    fresh_slider(pressed=True, vmin=16777000, vmax=16777300, value=16777100, width=100)
    hit("S4 move with an even minimum near 2^24: min + 0.5 is rounded down", "A", 0x200, 80, 10)
    fresh_slider(pressed=True, vmin=-100000, vmax=100000, value=0, width=200)
    hit("S4 move over a range of 200000 (single precision, negative minimum)", "A", 0x200, 130, 10)
    # past 2^24 an int is not a float any more: each operand is rounded to single precision before it is used (the cases were found with a model of the
    # formula: each one gives another value when one operand is kept exact, which the other cases cannot show)
    fresh_slider(pressed=True, vmin=0, vmax=16777217, value=5)
    hit("S4 a range of 16777217 over 200 pixels, x 18: the range is 16777216 in single precision, the step per pixel is rounded before it is multiplied", "A", 0x200, 18, 10)
    fresh_slider(pressed=True, vmin=16777217, vmax=16777317, value=16777250)
    hit("S4 a minimum of 16777217, x 50: the minimum is 16777216 in single precision, plus the half it stays 16777216, then the sum is rounded", "A", 0x200, 50, 10)
    fresh_slider(pressed=True, vmin=0, vmax=2000000001, value=5, width=16777217)
    hit("S4 a box of 16777217 pixels, x 16777217: the width and the distance are 16777216 in single precision", "A", 0x200, 16777217, 10)

    # ---- the left button up
    fresh_slider(pressed=True)
    hit("S5 up with the button held: let go, released, the control event 0x466 / 0", "A", 0x202, 110, 10)
    fresh_slider(pressed=True, msg=7)
    hit("S5 up with the button held, custom message 7: the stage gets 0x467 / 7", "A", 0x202, 110, 10)
    fresh_slider(pressed=True)
    hit("S5 up far away from the slider with the button held: the same (the point is not asked)", "A", 0x202, 900, 900)
    fresh_slider()
    hit("S5 up with the button not held: not taken", "A", 0x202, 110, 10)
    fresh_slider(pressed=True); o.gone("D")
    hit("S5 up with the button held, D is gone: let go, released, no message (no dialog to ask)", "A", 0x202, 110, 10)

    # ---- the wheel
    for delta, tag in ((120, "one notch up"), (-120, "one notch down"), (240, "two up"), (-360, "three down"), (119, "119: less than a notch, cut towards zero"),
                       (-119, "-119: cut towards zero, not down"), (121, "121"), (-121, "-121"), (1, "1"), (-1, "-1"), (32767, "the largest"),
                       (-32768, "the smallest"), (0, "zero")):
        fresh_slider()
        hit("S6 wheel %s (%d)" % (tag, delta), "A", 0x20A, 110, 10, wheel(delta))
    fresh_slider()
    hit("S6 wheel with keys in the low word of wParam (0x0008, 0x0004): they are ignored", "A", 0x20A, 110, 10, wheel(-120) | 0x000C)
    fresh_slider()
    hit("S6 wheel far outside the slider: taken all the same", "A", 0x20A, 900, 900, wheel(120))
    fresh_slider(value=100)
    hit("S6 wheel down at the maximum: taken, no change, no message", "A", 0x20A, 110, 10, wheel(-120))
    fresh_slider(value=0)
    hit("S6 wheel up at the minimum: taken, no change", "A", 0x20A, 110, 10, wheel(120))
    fresh_slider(msg=7)
    hit("S6 wheel with the custom message 7", "A", 0x20A, 110, 10, wheel(-240))

    # ---- a sequence: the exe's UpdateRects moves the button as the value changes
    fresh_slider(width=90, height=30, bw=12, bh=8, value=-4, vmin=-10, vmax=20)
    hit("S7 a drag, the slider (x 10, 90 x 30, button 12 x 8, value -4 of -10..20): down on the bar right of the button: a step, the button moves", "A", 0x201, 70, 12)
    hit("S7 a drag: down on the button where it is now (25..37)", "A", 0x201, 30, 15)
    hit("S7 a drag: move to x 70 (the button follows)", "A", 0x200, 70, 15)
    hit("S7 a drag: move to x 3", "A", 0x200, 3, 15)
    hit("S7 a drag: move to x 400", "A", 0x200, 400, 15)
    hit("S7 a drag: up", "A", 0x202, 400, 15)
    hit("S7 a drag: move after the up (not held)", "A", 0x200, 70, 15)
    hit("S7 a drag: the wheel", "A", 0x20A, 70, 15, wheel(240))
    hit("S7 a drag: a double click on the button where it is now (88..100, the value is 18)", "A", 0x203, 90, 15)

    # ================================================================ CKTDGUIScrollBar::HandleMouse
    def fresh_bar(**kw):
        """D (managed) and the scroll bar A at (0,0), 20 x 100, position 10 of 0..50 with a page of 10: the up button (0,0)-(20,20), the down button
        (0,80)-(20,100), the track (0,20)-(20,80), the thumb (0,32)-(20,44); the time is 12.375"""
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        o.scrollbar_("A", "D", **kw)
        o.register("D", ["A"])
        o.time_(12.375)

    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False})):
        fresh_bar(**kw)
        hit("B1 left button down on the up button, %s" % tag, "A", 0x201, 5, 5)
    for m in (0x204, 0x205, 0x206, 0x207, 0x20A, 0x100, 0x401, 0x215):
        fresh_bar()
        hit("B1 message 0x%X at (-7,123): not taken, but the point is remembered" % m, "A", m, -7, 123)
    fresh_bar()
    hit("B1 move while not dragging at (33,44): not taken, the point is remembered", "A", 0x200, 33, 44)
    fresh_bar(enable=False)
    hit("B1 move at (33,44) of a disabled bar: the point is NOT remembered", "A", 0x200, 33, 44)

    # ---- the up button
    for m in (0x201, 0x203):
        fresh_bar()
        hit("B2 message 0x%X on the up button: the capture, one back, the thumb, the arrow, the time, the sound" % m, "A", m, 5, 5)
    fresh_bar(pos=0)
    hit("B2 up button with the position at the start: no step back", "A", 0x201, 5, 5)
    fresh_bar(pos=-5, start=-5, end=45)
    hit("B2 up button with a start of -5 and the position at it", "A", 0x201, 5, 5)
    fresh_bar(pos=-4, start=-5, end=45)
    hit("B2 up button with a start of -5 and the position one above it", "A", 0x201, 5, 5)
    fresh_bar(pos=1)
    hit("B2 up button with the position at 1", "A", 0x201, 5, 5)
    fresh_bar(sound=False)
    hit("B2 up button of a bar with no sound", "A", 0x201, 5, 5)
    fresh_bar()
    hit("B2 the up button's corners: (0,0)", "A", 0x201, 0, 0)
    hit("B2 the up button's corners: (19,19)", "A", 0x201, 19, 19)
    fresh_bar()
    hit("B2 just outside the up button on its right (x 20): not on the bar either (the thumb's columns end at 20)", "A", 0x201, 20, 5)
    fresh_bar(); o.time_(0.0)
    hit("B2 up button at the time 0", "A", 0x201, 5, 5)
    fresh_bar(); o.time_(123456.789)
    hit("B2 up button at the time 123456.789", "A", 0x201, 5, 5)

    # ---- the down button
    for m in (0x201, 0x203):
        fresh_bar()
        hit("B3 message 0x%X on the down button: the capture, one forward, the thumb, the arrow, the time, the sound" % m, "A", m, 5, 90)
    fresh_bar(pos=40)
    hit("B3 down button with the position at the last page (40 + 10 = 50): no step", "A", 0x201, 5, 90)
    fresh_bar(pos=39)
    hit("B3 down button with the position one before the last page", "A", 0x201, 5, 90)
    fresh_bar(pos=45)
    hit("B3 down button with the position past the last page (45 + 10 > 50): no step", "A", 0x201, 5, 90)
    fresh_bar(page=1, end=3, pos=1)
    hit("B3 down button of a bar of 3 items with a page of 1", "A", 0x201, 5, 90)
    fresh_bar(sound=False)
    hit("B3 down button of a bar with no sound", "A", 0x201, 5, 90)
    fresh_bar()
    hit("B3 the down button's corners: (0,80)", "A", 0x201, 0, 80)
    hit("B3 the down button's corners: (19,99)", "A", 0x201, 19, 99)
    fresh_bar()
    hit("B3 just below the down button (y 100)", "A", 0x201, 5, 100)

    # ---- the thumb
    fresh_bar()
    hit("B4 down on the thumb (10,35): the capture, ThumbOffsetY = 35 - 32 = 3, dragging", "A", 0x201, 10, 35)
    fresh_bar()
    hit("B4 double click on the thumb's top row (10,32): offset 0", "A", 0x203, 10, 32)
    fresh_bar()
    hit("B4 down on the thumb's last row (19,43): offset 11", "A", 0x201, 19, 43)
    fresh_bar(thumb=False)
    hit("B4 down on the thumb of a bar whose thumb is off: the capture (the track branch takes it), not taken", "A", 0x201, 10, 35)
    fresh_bar(thumb=False, track=False)
    hit("B4 down on the thumb of a bar with no thumb and no track: not taken, no capture", "A", 0x201, 10, 35)
    fresh_bar()
    o.thumb_offset_(77)
    hit("B4 down on the thumb: ThumbOffsetY is replaced (it was 77)", "A", 0x201, 10, 40)

    # ---- the track beside the thumb
    fresh_bar()
    hit("B5 down on the track above the thumb (10,25): the capture, a page up (position 10 + 1 - 10 = 1)", "A", 0x201, 10, 25)
    fresh_bar()
    hit("B5 down on the track below the thumb (10,60): the capture, a page down (position 10 + 10 - 1 = 19)", "A", 0x201, 10, 60)
    fresh_bar(pos=3)
    hit("B5 page up with the position at 3 (the thumb is at 23): 3 + 1 - 10 is below the start, capped to 0", "A", 0x203, 10, 22)
    fresh_bar(pos=38)
    hit("B5 page down with the position at 38 (the thumb is at 65..77): 38 + 10 - 1 is past the last page, capped to 40", "A", 0x201, 10, 78)
    fresh_bar()
    hit("B5 the track's first row (10,20): above the thumb", "A", 0x201, 10, 20)
    fresh_bar()
    hit("B5 the row above the thumb (10,31)", "A", 0x201, 10, 31)
    fresh_bar()
    hit("B5 the row below the thumb (10,44): `bottom <= y`", "A", 0x201, 10, 44)
    fresh_bar()
    hit("B5 the track's last row (10,79)", "A", 0x201, 10, 79)
    fresh_bar(track=False)
    hit("B5 down on the track of a bar whose track is off: not taken, no capture", "A", 0x201, 10, 25)
    fresh_bar()
    o.put("A", "m_bShowThumb", 0)
    hit("B5 down on the track of a bar with the thumb hidden (m_bShowThumb 0): not taken, no capture", "A", 0x201, 10, 25)
    fresh_bar()
    hit("B5 above the whole bar (10,-5): the thumb's columns, the capture is taken, but no page: not taken", "A", 0x201, 10, -5)
    fresh_bar()
    hit("B5 below the whole bar (10,200): the capture is taken, no page: not taken", "A", 0x201, 10, 200)
    fresh_bar()
    hit("B5 right of the bar (20,60): outside the thumb's columns, not taken, no capture", "A", 0x201, 20, 60)
    fresh_bar()
    hit("B5 left of the bar (-1,60): not taken, no capture", "A", 0x201, -1, 60)
    fresh_bar()
    hit("B5 down on the track's left column (0,25): the thumb's columns include their left edge: a page up", "A", 0x201, 0, 25)
    fresh_bar()
    hit("B5 down on the track's left column (0,60): a page down", "A", 0x201, 0, 60)
    fresh_bar()
    hit("B5 down on the track's right column (19,60): a page down", "A", 0x201, 19, 60)
    fresh_bar(thumb=False)
    hit("B5 the thumb is off, the point on the thumb's top row (10,32): neither above nor below it: the capture, no page, not taken", "A", 0x201, 10, 32)
    fresh_bar(thumb=False)
    hit("B5 the thumb is off, the point on the thumb's last row (10,43): neither above nor below it: no page", "A", 0x201, 10, 43)
    fresh_bar(thumb=False)
    hit("B5 the thumb is off, the point on the row below the thumb (10,44): a page down", "A", 0x201, 10, 44)
    fresh_bar(); o.put("A", "m_rcDownButton", [0, 90, 20, 100])
    hit("B5 the down button moved to y 90: the track's bottom edge (10,80) is not on it and not on the track: the capture, no page, not taken", "A", 0x201, 10, 80)
    fresh_bar(); o.put("A", "m_rcDownButton", [0, 90, 20, 100])
    hit("B5 the same, one row up (10,79): the last row of the track, a page down", "A", 0x201, 10, 79)
    fresh_bar(end=10)
    hit("B5 a bar whose range fits in a page (end 10, page 10: no thumb, m_bShowThumb 0): the track does nothing", "A", 0x201, 10, 60)
    fresh_bar(pos=10, page=3, start=0, end=300, height=200)
    hit("B5 a long bar (page 3 of 300, 200 pixels high): page down is 2", "A", 0x201, 10, 100)

    # ---- the move while dragging
    def drag(case_prefix, moves, **kw):
        fresh_bar(**kw)
        top = o.i(o.addr["A"] + 0x254)  # the thumb's top, as the exe's UpdateRects left it
        hit("%s: down on the thumb (10,%d), one row below its top" % (case_prefix, top + 1), "A", 0x201, 10, top + 1)
        for y in moves:
            hit("%s: move to y %d" % (case_prefix, y), "A", 0x200, 10, y)

    drag("B6 drag", [35, 50, 62, 41, 0, -50, 100, 400, 80, 79, 20])
    drag("B6 drag of a bar with a step of 1 (50 items, page 1)", [40, 55, 70], page=1, pos=25, end=50)
    drag("B6 drag of a long bar (300 items, page 3, 200 pixels high)", [60, 100, 140, 170], pos=100, page=3, end=300, height=200)
    drag("B6 drag with a start of -10", [45, 60], pos=5, start=-10, end=40)
    drag("B6 drag of a big range (100000 items, page 7)", [45, 60, 75], pos=500, page=7, start=0, end=100000)
    fresh_bar(pos=10)
    hit("B6 drag, down on the thumb at its first row (10,32)", "A", 0x201, 10, 32)
    hit("B6 drag, move to y 32 (the thumb stays)", "A", 0x200, 10, 32)
    hit("B6 drag, move to y 33", "A", 0x200, 10, 33)
    fresh_bar(pos=10, height=48)
    o.put("A", "m_bDrag", 1)
    hit("B6 a track exactly as high as its thumb (gap 0): the position stays, taken", "A", 0x200, 10, 40)
    fresh_bar(pos=10, height=44)
    o.put("A", "m_bDrag", 1)
    o.thumb_offset_(2)
    hit("B6 a track shorter than the smallest thumb (gap -4): signed division", "A", 0x200, 10, 25)
    fresh_bar(end=10)
    o.put("A", "m_bDrag", 1)
    hit("B6 no range (end - start = page): the thumb is moved, the position stays, taken", "A", 0x200, 10, 40)
    fresh_bar(end=5, page=10)
    o.put("A", "m_bDrag", 1)
    o.thumb_offset_(1)
    hit("B6 a page larger than the range (range -5): negative divisor of the share", "A", 0x200, 10, 50)
    fresh_bar()
    o.put("A", "m_bDrag", 1)
    o.thumb_offset_(5)
    hit("B6 dragging set without a press: move to y 50 with ThumbOffsetY 5", "A", 0x200, 10, 50)
    # the offset is shared by every bar: the press on A sets it, the move of B uses it
    o.reset()
    o.dialog_("D")
    o.managed_("D", True)
    o.scrollbar_("A", "D")
    o.scrollbar_("B", "D", x=100, y=0, pos=20)
    o.register("D", ["A", "B"])
    hit("B7 two bars: down on A's thumb (10,40): ThumbOffsetY = 8", "A", 0x201, 10, 40)
    o.put("B", "m_bDrag", 1)
    hit("B7 two bars: B (dragging) moves to y 60 with A's offset", "B", 0x200, 110, 60)
    hit("B7 two bars: A (also dragging) moves to y 20", "A", 0x200, 10, 20)
    hit("B7 two bars: up on A: A's flags are cleared, B's are not", "A", 0x202, 10, 20)
    hit("B7 two bars: B moves again (still dragging)", "B", 0x200, 110, 61)

    # ---- the left button up
    fresh_bar()
    hit("B8 up on a quiet bar: everything cleared, released, the thumb updated, NOT taken", "A", 0x202, 50, 50)
    fresh_bar(pos=17)
    hit("B8 up on the bar: the thumb is recomputed from the position (17)", "A", 0x202, 50, 50)
    fresh_bar()
    hit("B8 down on the up button", "A", 0x201, 5, 5)
    hit("B8 then up: the arrow is clear, the clicked flag is off", "A", 0x202, 5, 5)
    fresh_bar()
    hit("B8 down on the down button", "A", 0x201, 5, 90)
    hit("B8 then up elsewhere", "A", 0x202, 500, 500)
    fresh_bar()
    hit("B8 down on the thumb", "A", 0x201, 10, 35)
    hit("B8 move up the track", "A", 0x200, 10, 25)
    hit("B8 up: the drag ends, the thumb is recomputed from the position", "A", 0x202, 10, 25)
    hit("B8 a move after the up: not dragging", "A", 0x200, 10, 50)
    fresh_bar(end=10)
    hit("B8 up on a bar with no range: m_bShowThumb becomes 0, the thumb is empty", "A", 0x202, 10, 50)
    fresh_bar(enable=False)
    hit("B8 up on a disabled bar: nothing happens", "A", 0x202, 10, 50)

    # ---- MsgProc (slot 41)
    for m in (0x215, 0x200, 0x201, 0x202, 0x214, 0x216, 0x0, 0x100):
        fresh_bar(); o.put("A", "m_bDrag", 1)
        o.act_msg("B9 MsgProc 0x%X while dragging: only 0x215 (the capture changed) ends the drag; never taken" % m, "A", m, 3, 4)
    fresh_bar()
    o.act_msg("B9 MsgProc 0x215 on a quiet bar", "A", 0x215, 0, 0)
    fresh_bar(enable=False, show=False); o.put("A", "m_bDrag", 1)
    o.act_msg("B9 MsgProc 0x215 on a hidden and disabled bar: the drag ends all the same", "A", 0x215, 0, 0)

    # ---- a press, a held arrow, the release
    fresh_bar()
    hit("B10 a scroll: down on the down button", "A", 0x201, 5, 90)
    hit("B10 a scroll: down on the down button again", "A", 0x201, 5, 90)
    hit("B10 a scroll: down on the track below the thumb", "A", 0x201, 10, 70)
    hit("B10 a scroll: down on the up button", "A", 0x201, 5, 5)
    hit("B10 a scroll: down on the track above the thumb", "A", 0x201, 10, 22)
    hit("B10 a scroll: up", "A", 0x202, 10, 22)

    if "--json" in sys.argv:
        import json
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w") as fh:
            json.dump(o.script, fh, indent=0, separators=(",", ":"))
            fh.write("\n")


if __name__ == "__main__":
    main()
