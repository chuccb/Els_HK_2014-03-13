#!/usr/bin/env python3
"""
The mouse input of the list box (`CKTDGUIListBox`) of x2.exe on the Unicorn CPU emulator: the oracle of `CKTDGUIListBox.handleMouse` and
`listBoxMsgProc` (packages/ui/src/listbox.ts; tested by packages/ui/test/lists-input.test.ts, which replays packages/ui/test/lists-cases.json).

    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-lists.py                (prints one line per case: `case -> answer | calls | state`)
    PYTHONPATH=/home/user/work/pycap python3 tools/oracle-lists.py --json FILE    (and writes the script and the exe's answers to FILE)

The exe's functions run as they are: CKTDGUIListBox::HandleMouse 32942EA0 (through slot 8 of the real vtable of the class), MsgProc 32943960 (slot 41),
and what they call: GetItem 32942DD0, SendInternelEvent 329253D0, RequestFocus 3295B490.  What is replaced by a stub that writes the call down
(see oracle-controls.py, oracle-bars.py and oracle-combos.py for the rest): PtInRect, SetCapture / ReleaseCapture (`capture` / `release`), PlaySoundW
(`A.sound(down)`), the scroll bar's `Scroll` (`S.scroll(delta)`; the bar is a probe control whose `HandleMouse` answers what the case says and whose
`m_nPosition` and `m_nPageSize` are the case's) and `SystemParametersInfoW(SPI_GETWHEELSCROLLLINES)` (`spi`; the case says how many lines a notch is).
A message to the stage is written down with the selection of that moment: `stage(1126,1,A)[sel=2 start=2 rows=00100]` (the handler of the message may ask
the box which rows are selected: the flags must already be the new ones).
The layout is the exe's: list box +0x21C m_rcText, +0x22C m_rcSelection, +0x268 m_pScrollBar, +0x278 m_nTextHeight, +0x27C m_dwStyle, +0x280 m_nSelected,
+0x284 m_nSelStart, +0x288 m_bDrag, +0x28C m_Items (the array of pointers, the count, the room), +0x380 m_CustomMsgItemDoubleClick, +0x384 m_CustomMsgSelection,
+0x388 m_CustomMsgSelection_End, +0x38C m_CustomMsgSelectionByRButton, +0x3AC the mouse down sound, +0x3B8 m_bIgnoreListClick, +0x3D8 m_bUseItemDisappear,
+0x3DB m_bIsSelectItemAtMouseMove; a row (`ListBoxItem`, 0x26C bytes) has +0x214 bSelected, +0x218 pControl, +0x234 m_bShow, +0x238 m_fTimeLeftShow;
the scroll bar +0x340 m_nPosition, +0x344 m_nPageSize.
"""
import importlib.util, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from peemu import *

_spec = importlib.util.spec_from_file_location("oracle_combos", os.path.join(HERE, "oracle-combos.py"))
oco = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oco)
ob, oc, oi, om = oco.ob, oco.oc, oco.oi, oco.om

LIST_HANDLE_MOUSE, LIST_MSG_PROC = 0x32942EA0, 0x32943960
oc.HANDLERS["listbox"] = LIST_HANDLE_MOUSE
oi.CONTROL_FIELDS.update({"m_nPageSize": (0x344, "i")})


def rows_of(o, c):
    data, size = o.emu.u32(c + 0x28C), o.i(c + 0x290)
    return [o.emu.u32(data + 4 * i) for i in range(size)]


def flags(o, c):
    return "".join("1" if o.b(r + 0x214) else "0" for r in rows_of(o, c))


def shown(o, c):
    return "".join("1" if o.b(r + 0x234) else "0" for r in rows_of(o, c))


def left(o, c):
    """the time left of each row, equal neighbours grouped: `7.5*3|50`"""
    values = [struct.unpack("<f", o.emu.read(r + 0x238, 4))[0] for r in rows_of(o, c)]
    out = []
    for v in values:
        text = ("%g" % v)
        if out and out[-1][0] == text:
            out[-1][1] += 1
        else:
            out.append([text, 1])
    return "|".join(t if n == 1 else "%s*%d" % (t, n) for t, n in out)


oc.STATE_KEYS["listbox"] = ("hasFocus", "focus", "sel", "start", "drag", "rows", "shown", "left")
oc.FIELD_OFFSETS["listbox"] = {"sel": (0x280, "i"), "start": (0x284, "i"), "drag": 0x288, "rows": flags, "shown": shown, "left": left}


class ListOracle(oco.ComboOracle):
    def _stage_msg(self, emu):
        super()._stage_msg(emu)
        lparam = emu.args(4)[3]
        if self.kind.get(lparam) == "listbox":
            self.events[-1] += "[sel=%d start=%d rows=%s]" % (self.i(lparam + 0x280), self.i(lparam + 0x284), flags(self, lparam))

    def list_(self, label, dialog, index=1, sel=(10, 10, 110, 70), text=(10, 20, 100, 60), th=10, items=(), bar=None, style=0, selected=-1, sel_start=0,
              drag=False, at_move=False, disappear=False, ignore=False, enable=True, show=True, sel_msg=-1, dbl_msg=-1, end_msg=-1, r_msg=-1, sound=True):
        """a list box: `sel` is m_rcSelection ("in the box"), `text` m_rcText, `th` the height of a row; `items`: the rows, (selected, label of the control the
        row holds or None, shown, time left); `bar`: the label of its scroll bar (a probe control) or None; `style` m_dwStyle (1: multi selection)"""
        emu = self.emu
        c = self.control("ListBox", label, dialog=index, show=show, enable=enable, size=0x3E0)
        emu.write(c + 0x21C, struct.pack("<8i", *text, *sel))
        emu.w32(c + 0x268, self.addr[bar] if bar else 0)
        emu.write(c + 0x278, struct.pack("<iI", th, style))
        emu.write(c + 0x280, struct.pack("<2i", selected, sel_start))
        emu.write(c + 0x288, bytes([1 if drag else 0]))
        rows = []
        for flag, control, is_shown, time_left in items:
            row = emu.alloc(0x26C)
            emu.write(row + 0x214, bytes([1 if flag else 0]))
            emu.w32(row + 0x218, self.addr[control] if control else 0)
            emu.write(row + 0x234, bytes([1 if is_shown else 0]))
            emu.write(row + 0x238, struct.pack("<f", time_left))
            rows.append(row)
        data = emu.alloc(4 * max(1, len(rows)))
        emu.write(data, b"".join(struct.pack("<I", r) for r in rows))
        emu.write(c + 0x28C, struct.pack("<3I", data, len(rows), max(1, len(rows))))
        emu.write(c + 0x380, struct.pack("<4i", dbl_msg, sel_msg, end_msg, r_msg))
        emu.w32(c + 0x3AC, oc.SOUND_DOWN if sound else 0)
        emu.write(c + 0x3B8, bytes([1 if ignore else 0]))
        emu.write(c + 0x3D8, bytes([1 if disappear else 0]))
        emu.write(c + 0x3DB, bytes([1 if at_move else 0]))
        self._adopt(c, label, dialog, "listbox")
        self.op("list", label, dialog, {
            "sel": list(sel), "text": list(text), "th": th, "items": [[bool(f), k, bool(s), t] for f, k, s, t in items], "bar": bar, "style": style,
            "selected": selected, "start": sel_start, "drag": drag, "atMove": at_move, "disappear": disappear, "ignore": ignore, "enable": enable, "show": show,
            "selMsg": sel_msg, "dblMsg": dbl_msg, "endMsg": end_msg, "rMsg": r_msg, "sound": sound,
        })
        return c

    def act_msgproc(self, case, label, uMsg, wParam=0, lParam=0):
        """send `MsgProc(uMsg, wParam, lParam)` (virtual slot 41) to the control"""
        c = self.addr[label]
        self.events = []
        handler = self.emu.u32(self.emu.u32(c) + 4 * 41)
        assert handler == LIST_MSG_PROC, hex(handler)
        ret = self.thiscall(handler, c, [uMsg, wParam, lParam]) & 0xFF
        events = list(self.events)
        state = self.state_of(label)
        print("%-100s -> %d | %s | %s" % (case, ret, ",".join(events), state))
        self.op("act_listproc", case, label, [uMsg, wParam, lParam], {"ret": ret, "events": events, "state": state})
        return ret


def main():
    o = ListOracle()
    ARGS = dict(wParam=0x1234, lParam=0x5678)
    # the geometry: the box (10,10)-(110,70), the text from y = 20 in rows of 10: y 20-29 is the page's first row, 30-39 the second, ...; the strip above
    # the text (y 10-19) and the rows below the page are still "in the box"
    X = 50
    Y = {-1: 15, 0: 25, 1: 35, 2: 45, 3: 55, 4: 65}
    OUT = (150, 150)

    def fresh(n=5, ctl=None, pos=0, page=3, bar=True, rows="10110", **kw):
        """D (managed, with a stage), the list box A with `n` rows (the flags `rows`; rows 0, 1 and 3 hold the probe controls P0, P1, P2; every row is
        hidden with 7.5 time left), a probe Y that can take the focus and, with `bar`, the probe S, the scroll bar, at the position `pos` with the page `page`"""
        ctl = {0: "P0", 1: "P1", 3: "P2"} if ctl is None else ctl
        o.reset()
        o.dialog_("D")
        o.managed_("D", True)
        labels = ["A"]
        for k, label in enumerate(sorted(set(v for i, v in ctl.items() if i < n))):
            o.control_(label, "D", rect=(300 + 50 * k, 0, 340 + 50 * k, 40))
            labels.append(label)
        if bar:
            o.control_("S", "D", rect=(400, 0, 440, 100))
            o.set("S", "m_nPosition", pos)
            o.set("S", "m_nPageSize", page)
            labels.append("S")
        o.control_("Y", "D", rect=(200, 0, 240, 40))
        labels.append("Y")
        items = [(rows[i] == "1" if i < len(rows) else False, ctl.get(i), False, 7.5) for i in range(n)]
        opts = dict(selected=7, sel_start=6, sel_msg=21, dbl_msg=22, end_msg=23, r_msg=24)  # 6 and 7 are no row: a change shows
        opts.update(kw)
        o.list_("A", "D", items=items, bar="S" if bar else None, **opts)
        o.register("D", labels)
        o.wheel(3)

    def hit(case, uMsg, x=X, y=Y[1], wParam=0, lParam=0):
        return o.act_ctl(case, "A", uMsg, x, y, wParam, lParam)

    # ================================================================ the gates, the focus, the scroll bar
    for tag, kw in (("enabled and shown", {}), ("disabled", {"enable": False}), ("hidden", {"show": False})):
        for m in (0x200, 0x201, 0x204, 0x20A):
            fresh(**kw)
            hit("L1 message 0x%X on a row, %s, a scroll bar that answers no" % (m, tag), m, X, Y[1], 0x00780000 if m == 0x20A else 0)
    for m in (0x201,):
        fresh(); o.give_focus("Y")
        hit("L1 left button down, Y has the focus: the box asks for it first (before the bar), takes it", m)
        fresh(); o.give_focus("A")
        hit("L1 left button down, the box has the focus: no request", m)
        fresh(); o.focus("Y"); o.set("A", "m_bHasFocus", 1)
        hit("L1 left button down, the flag is set but Y is the focused control: no request", m)
        fresh(); o.give_focus("Y")
        hit("L1 left button down outside the box: the box asks for the focus all the same", m, *OUT)
        fresh(); o.focus("A")
        hit("L1 left button down, A is the focused control but its flag is off: RequestFocus does nothing", m)
        fresh(); o.give_focus("Y"); o.managed_("D", False)
        hit("L1 left button down, the manager does not know D: the focus moves all the same", m)
        fresh(); o.give_focus("Y"); o.gone("D")
        hit("L1 left button down, D is gone: the focus moves all the same", m)
        fresh(bar=False); o.give_focus("Y")
        hit("L1 left button down, no scroll bar: the focus moves, the row is -1: taken", m)
    for m in (0x200, 0x201, 0x202, 0x203, 0x204, 0x205, 0x20A, 0x100):
        fresh(); o.give_focus("Y")
        o.answer("S", "mouse", 1)
        hit("L2 message 0x%X: the scroll bar takes it (answers 1): taken, nothing else, no rows' controls (use item disappear off)" % m, m, X, Y[1], **ARGS)
        fresh(disappear=True)
        o.answer("S", "mouse", 1)
        hit("L2 message 0x%X: the scroll bar takes it, use item disappear: every row shown, 50 time left" % m, m, X, Y[1], **ARGS)
        fresh(disappear=True)
        o.answer("S", "mouse", 0)
        hit("L2 message 0x%X: the scroll bar is asked (with the message as it is) and does not take it, use item disappear is no matter" % m, m, X, Y[1], **ARGS)
    fresh(n=0, disappear=True)
    o.answer("S", "mouse", 1)
    hit("L2 the scroll bar takes it, use item disappear, no rows: taken", 0x200)
    fresh(n=1, disappear=True, ctl={})
    o.answer("S", "mouse", 1)
    hit("L2 the scroll bar takes it, use item disappear, one row", 0x200)

    # ================================================================ the messages that go to the rows' controls
    for m in (0x206, 0x207, 0x208, 0x100, 0x401, 0x215, 0x20B, 0x20C):
        fresh()
        hit("L3 message 0x%X, in the box: every row's control gets it as it is, in order; not taken" % m, m, X, Y[1], **ARGS)
    fresh(ctl={0: "P0", 3: "P2"})
    o.answer("P0", "mouse", 1)
    hit("L3 message 0x206, the rows 1, 2 and 4 hold no control, the first answers yes: the others still get it, not taken", 0x206, X, Y[1], **ARGS)
    fresh(ctl={0: "P0", 1: "P1", 4: "P2"})
    hit("L3 message 0x206, the last of the five rows holds a control: it gets it too", 0x206, X, Y[1], **ARGS)
    fresh(ctl={4: "P2"})
    hit("L3 message 0x206, only the last row holds a control", 0x206, X, Y[1], **ARGS)
    fresh(n=0)
    hit("L3 message 0x206, no rows: not taken", 0x206)
    fresh(bar=False)
    hit("L3 message 0x206, no scroll bar: the rows' controls get it", 0x206, X, Y[1], **ARGS)

    # ================================================================ 0x200
    for tag, kw in (("not selecting at the move", {}), ("selecting at the move", {"at_move": True})):
        fresh(**kw)
        hit("L4 move outside the box, %s: the rows' controls get it, the selection is %s" % (tag, "kept" if not kw else "-1"), 0x200, *OUT, **ARGS)
        fresh(**kw)
        hit("L4 move in the box, %s: taken, the rows' controls get nothing" % tag, 0x200, X, Y[1], **ARGS)
    for row in (-1, 0, 1, 2, 3, 4):
        fresh(at_move=True)
        hit("L4 move over the %s (y %d), selecting at the move: %s" % ("strip above the text" if row == -1 else "row %d" % row, Y[row],
            "row 0 (the line above the text is row 0 of the page)" if row == -1 else "the row, if it is on the page"), 0x200, X, Y[row])
    for pos in (1, 2):
        for row in (0, 1, 2, 3):
            fresh(at_move=True, pos=pos)
            hit("L4 move over the page row %d, the bar at %d: row %d" % (row, pos, pos + row), 0x200, X, Y[row])
    fresh(at_move=True, pos=3)
    hit("L4 move, the bar at 3 (rows 3, 4 on the page, 5 is none): row 3", 0x200, X, Y[0])
    hit("L4 move over the third page row, the bar at 3: that row does not exist: taken, nothing changes", 0x200, X, Y[2])
    fresh(n=3, at_move=True)
    hit("L4 move over y 55 (row 3), three rows: no such row: taken, nothing changes", 0x200, X, Y[3])
    fresh(at_move=True, th=0)
    hit("L4 move, row height 0: no row (-1): taken, nothing changes", 0x200, X, Y[1])
    fresh(at_move=True, bar=False)
    hit("L4 move, no scroll bar: no row (-1): taken, nothing changes", 0x200, X, Y[1])
    fresh(n=0, at_move=True)
    hit("L4 move in the box, no rows: nothing selected (-1), taken", 0x200, X, Y[1])
    fresh(n=1, at_move=True, ctl={}, rows="0")
    hit("L4 move over the only row of a list of one row: it is selected", 0x200, X, Y[0])
    fresh(at_move=True, th=7)
    for y in (12, 13, 14, 20, 26, 27, 34, 40):
        hit("L4 move at y %d, row height 7 (the text starts at 20): (y - 20) / 7 cut towards zero is row %d%s" % (y, int((y - 20) / 7), " (no such row)" if y < 14 else ""), 0x200, X, y)
    fresh(at_move=True)
    hit("L4 move at y 10, a whole row above the text: row -1: no such row, taken, nothing changes", 0x200, X, 10)
    fresh(at_move=True, pos=1, page=2)
    for row in (0, 1, 2):
        hit("L4 move over page row %d, the page is 2 rows from 1: row 1 and 2 are on it, 3 is not" % row, 0x200, X, Y[row])
    fresh(at_move=True, pos=0, page=0)
    hit("L4 move, the page has no rows (size 0): nothing is on it", 0x200, X, Y[1])
    for point, tag in (((10, 10), "the left-top pixel"), ((109, 69), "the last pixel"), ((110, 40), "x = right"), ((50, 70), "y = bottom"), ((9, 40), "x = left - 1"),
                       ((50, 9), "y = top - 1")):
        fresh(at_move=True)
        hit("L4 move at %s of the box (10,10)-(110,70)" % tag, 0x200, point[0], point[1], **ARGS)
    fresh(at_move=True, selected=2)
    hit("L4 move over the strip below the text but in the box: row 4 is off the page: nothing changes", 0x200, X, 65)

    # ================================================================ 0x201 / 0x203
    for m in (0x201,):
        for row in (0, 1, 2):
            fresh(selected=7, sel_start=3)
            hit("L5 left button down on page row %d (single selection): selected and start are the row, the capture, the drag, the sound, message 0x466 / 1; taken" % row, m, X, Y[row])
    fresh(selected=7, sel_start=3)
    hit("L5 left button down on the strip above the text: row 0", 0x201, X, Y[-1])
    fresh(sel_msg=-1)
    hit("L5 left button down, no selection message (-1): 0x466 with 1", 0x201)
    fresh(sel_msg=0)
    hit("L5 left button down, the selection message 0: 0x467 with 0", 0x201)
    fresh(sel_msg=-2)
    hit("L5 left button down, the selection message -2: 0x467 with -2", 0x201)
    fresh(sound=False)
    hit("L5 left button down, no sound: the call is made with none", 0x201)
    fresh(ignore=True)
    hit("L5 left button down on a row, clicks are ignored: it is selected, but not taken", 0x201)
    fresh(ignore=True)
    hit("L5 left button down on a row that is off the page, clicks are ignored: not taken", 0x201, X, Y[3])
    fresh(ignore=False)
    hit("L5 left button down on a row that is off the page: taken, nothing changes (no capture)", 0x201, X, Y[3])
    fresh(n=3, ignore=True)
    hit("L5 left button down on a row that does not exist (3 rows), clicks are ignored: taken", 0x201, X, Y[3])
    fresh(pos=3)
    hit("L5 left button down on page row 0 with the bar at 3: row 3", 0x201, X, Y[0])
    fresh(pos=3, ignore=True)
    hit("L5 left button down on page row 2 with the bar at 3 (row 5 is none): taken", 0x201, X, Y[2])
    fresh(pos=2)
    hit("L5 left button down on page row 2 with the bar at 2: row 4", 0x201, X, Y[2])
    fresh(n=0, ignore=True)
    hit("L5 left button down in the box, no rows: nothing selected (-1); not taken (clicks are ignored)", 0x201)
    fresh(n=0)
    hit("L5 left button down in the box, no rows: nothing selected (-1); taken", 0x201)
    fresh(n=1, ctl={}, rows="0")
    hit("L5 left button down on the only row of a list of one row: it is selected", 0x201, X, Y[0])
    fresh(n=1, ctl={}, rows="0")
    hit("L5 double click on the only row of a list of one row", 0x203, X, Y[0])
    fresh(bar=False, ignore=True)
    hit("L5 left button down, no scroll bar: no row: taken, even when clicks are ignored", 0x201)
    fresh(th=0, ignore=True)
    hit("L5 left button down, row height 0: no row: taken even when clicks are ignored", 0x201)
    fresh(page=2, pos=0)
    hit("L5 left button down on page row 2 (a page of 2 rows): the row is off the page: nothing changes", 0x201, X, Y[2])
    fresh(page=2, pos=1)
    hit("L5 left button down on page row 1 (rows 1, 2 on the page): row 2", 0x201, X, Y[1])
    for y in (12, 13, 14, 19, 20, 26, 27, 33, 34):
        fresh(th=7)
        hit("L5 left button down at y %d, row height 7: (y - 20) / 7 cut towards zero is row %d%s" % (y, int((y - 20) / 7), " (no such row: taken)" if y < 14 else ""), 0x201, X, y)
    fresh()
    hit("L5 left button down at y 10, a whole row above the text: row -1: no such row, taken, nothing changes", 0x201, X, 10)
    fresh(ignore=True)
    hit("L5 left button down at y 10, clicks ignored: no such row: taken", 0x201, X, 10)
    for point, tag in (((10, 10), "the left-top pixel"), ((109, 69), "the last pixel"), ((110, 40), "x = right"), ((50, 70), "y = bottom"), ((9, 40), "x = left - 1"),
                       ((50, 9), "y = top - 1")):
        fresh()
        hit("L5 left button down at %s of the box (10,10)-(110,70)" % tag, 0x201, point[0], point[1], **ARGS)
    fresh()
    hit("L5 left button down outside the box: the rows' controls get it, not taken", 0x201, *OUT, **ARGS)
    fresh(drag=True, selected=3)
    hit("L5 left button down outside the box: the drag flag and the selection stay", 0x201, *OUT)
    # the double click
    for row in (0, 1, 2):
        fresh()
        hit("L6 double click on page row %d: the capture, the drag, the sound, message 0x466 / 0, taken; the selection stays" % row, 0x203, X, Y[row])
    fresh(dbl_msg=-1)
    hit("L6 double click, no double click message (-1): 0x466 with 0", 0x203)
    fresh(dbl_msg=0)
    hit("L6 double click, the message 0: 0x467 with 0", 0x203)
    fresh(dbl_msg=-2)
    hit("L6 double click, the message -2: 0x467 with -2", 0x203)
    fresh(sound=False)
    hit("L6 double click, no sound: the call is made with none", 0x203)
    fresh(ignore=True)
    hit("L6 double click, clicks are ignored: taken all the same", 0x203)
    fresh(ignore=True)
    hit("L6 double click on a row that is off the page, clicks are ignored: not taken", 0x203, X, Y[3])
    fresh()
    hit("L6 double click on a row that is off the page: taken, nothing happens", 0x203, X, Y[3])
    fresh(n=0)
    hit("L6 double click, no rows: nothing selected (-1)", 0x203)
    fresh(n=3)
    hit("L6 double click on a row that does not exist: taken", 0x203, X, Y[3])
    fresh(pos=3)
    hit("L6 double click on page row 1, the bar at 3: row 4", 0x203, X, Y[1])
    fresh(); o.give_focus("Y")
    hit("L6 double click: no request for the focus (only the first button down asks)", 0x203)
    fresh()
    hit("L6 double click outside the box: the rows' controls get it", 0x203, *OUT, **ARGS)

    # ================================================================ the multi selection: the rows' flags
    for mods, tag in ((0, "no key"), (4, "shift"), (8, "control"), (0xC, "control and shift"), (0x13, "no key, other bits"), (0x1C, "control and shift, other bits")):
        for start in (0, 1, 2, 3, 4):
            for row in (0, 1, 2):
                fresh(style=1, selected=7, sel_start=start)
                hit("L7 left button down on page row %d, multi selection, %s, the range starts at %d, rows 10110" % (row, tag, start), 0x201, X, Y[row], mods)
    for mods, tag in ((0x1, "the left button"), (0x5, "the left button and shift"), (0x9, "the left button and control"), (0xD, "the left button, control and shift"),
                      (0x6, "the right button and shift"), (0xA, "the right button and control"), (0xE, "the right button, control and shift")):
        for start, row in ((1, 0), (3, 2), (0, 1), (2, 1)):
            fresh(style=1, selected=7, sel_start=start)
            hit("L7 left button down on page row %d, multi selection, wParam %s (0x%X), the range starts at %d, rows 10110" % (row, tag, mods, start), 0x201, X, Y[row], mods)
    for mods, tag in ((0, "no key"), (4, "shift"), (8, "control"), (0xC, "control and shift")):
        fresh(style=1, rows="01001", selected=0, sel_start=2)
        hit("L7 left button down on page row 1, multi selection, %s, the range starts at 2, rows 01001" % tag, 0x201, X, Y[1], mods)
        fresh(style=1, rows="11111", selected=0, sel_start=3)
        hit("L7 left button down on page row 0, multi selection, %s, the range starts at 3, rows 11111" % tag, 0x201, X, Y[0], mods)
        fresh(style=1, rows="00000", selected=0, sel_start=0)
        hit("L7 left button down on page row 2, multi selection, %s, the range starts at 0, rows 00000" % tag, 0x201, X, Y[2], mods)
        fresh(style=0, selected=7, sel_start=0)
        hit("L7 left button down on page row 2, single selection, %s: the flags are not touched" % tag, 0x201, X, Y[2], mods)
        fresh(style=3, selected=7, sel_start=0)
        hit("L7 left button down on page row 2, style 3 (the multi selection bit is 1), %s" % tag, 0x201, X, Y[2], mods)
        fresh(style=2, selected=7, sel_start=0)
        hit("L7 left button down on page row 2, style 2 (no multi selection bit), %s: the flags are not touched" % tag, 0x201, X, Y[2], mods)
    fresh(style=1, sel_msg=-1)
    hit("L7 multi selection, the click: message 0x466 / 1 with the flags already set", 0x201, X, Y[2], 8)
    fresh(style=1, sel_msg=0)
    hit("L7 multi selection, the click: the custom message 0 (sent after the flags)", 0x201, X, Y[2], 0)
    fresh(style=1, n=3, rows="101", sel_start=0)
    hit("L7 multi selection, three rows, shift on row 2 from 0", 0x201, X, Y[2], 4)
    fresh(style=1, n=1, rows="1", sel_start=0, ctl={})
    hit("L7 multi selection, one row, control on row 0: toggled off", 0x201, X, Y[0], 8)
    fresh(style=1, n=2, rows="01", sel_start=1, ctl={}, pos=1, page=1)
    hit("L7 multi selection, two rows, the bar at 1: row 1 on the page, control", 0x201, X, Y[0], 8)

    # ================================================================ 0x202
    for sel, start, tag in ((-1, 0, "nothing selected"), (0, 0, "row 0 only"), (2, 2, "row 2 only"), (1, 3, "from 3 up to 1"), (3, 1, "from 1 down to 3"),
                            (4, 0, "from 0 down to 4"), (0, 4, "from 4 up to 0"), (2, 5, "the start is past the list"), (5, 2, "the selection is past the list"),
                            (1, 1, "row 1 only"), (3, 3, "row 3 only"), (4, 4, "the last row only"), (2, 3, "adjacent rows 3 and 2"),
                            (3, 2, "adjacent rows 2 and 3")):
        fresh(selected=sel, sel_start=start, drag=True, rows="10110")
        hit("L8 left button up, selected %d, start %d (%s), rows 10110: the mouse is given back, the drag is over; the range takes the start's flag" % (sel, start, tag), 0x202, X, Y[1], **ARGS)
        fresh(selected=sel, sel_start=start, drag=True, rows="01001")
        hit("L8 left button up, selected %d, start %d (%s), rows 01001" % (sel, start, tag), 0x202, X, Y[1])
    for sel_msg, end_msg in ((-1, -1), (21, -1), (-1, 23), (21, 23), (0, 0), (-2, -2)):
        fresh(selected=3, sel_start=1, drag=True, sel_msg=sel_msg, end_msg=end_msg)
        hit("L8 left button up, selection message %d, end message %d, start 1 selected 3" % (sel_msg, end_msg), 0x202)
        fresh(selected=2, sel_start=2, drag=True, sel_msg=sel_msg, end_msg=end_msg)
        hit("L8 left button up, selection message %d, end message %d, start 2 selected 2: only the end message" % (sel_msg, end_msg), 0x202)
    fresh(selected=1, sel_start=3, drag=False)
    hit("L8 left button up, not dragging: the same, the mouse is given back", 0x202, *OUT)
    fresh(selected=2, sel_start=0, bar=False, ignore=True)
    hit("L8 left button up, no scroll bar, clicks ignored: no difference", 0x202)
    fresh(n=0, selected=-1)
    hit("L8 left button up, no rows", 0x202)
    fresh(n=0, selected=0, sel_start=0)
    hit("L8 left button up, no rows but selected 0: past the list", 0x202)
    fresh(selected=3, sel_start=1, style=1)
    hit("L8 left button up, multi selection: no difference (the flags are copied all the same)", 0x202)
    fresh(selected=3, sel_start=1, sound=False)
    hit("L8 left button up plays no sound", 0x202)
    fresh(selected=3, sel_start=1, rows="11111")
    hit("L8 left button up from 1 to 3, rows 11111", 0x202)
    fresh(selected=4, sel_start=0, rows="01110")
    hit("L8 left button up from 0 to 4, rows 01110: the start's 0 goes to 1, 2, 3 and 4", 0x202)

    # ================================================================ 0x204, 0x205
    for row in (0, 1, 2):
        fresh(selected=7, sel_start=3)
        hit("L9 right button down on page row %d (single selection): selected, start, the capture, the drag, the sound, message 0x466 / 3; taken" % row, 0x204, X, Y[row])
    fresh(); o.give_focus("Y")
    hit("L9 right button down: the focus is not asked for", 0x204)
    fresh(r_msg=-1)
    hit("L9 right button down, no message (-1): 0x466 with 3", 0x204)
    fresh(r_msg=0)
    hit("L9 right button down, the message 0: 0x467 with 0", 0x204)
    fresh(r_msg=-2)
    hit("L9 right button down, the message -2: 0x467 with -2", 0x204)
    fresh(sel_msg=-1, r_msg=24)
    hit("L9 right button down, the selection message is not the one: 0x467 with 24", 0x204)
    fresh(sound=False)
    hit("L9 right button down, no sound", 0x204)
    fresh(ignore=True)
    hit("L9 right button down on a row, clicks are ignored: no difference, taken", 0x204)
    fresh(ignore=True)
    hit("L9 right button down off the page: taken, nothing changes", 0x204, X, Y[3])
    fresh(n=3)
    hit("L9 right button down on a row that does not exist: taken", 0x204, X, Y[3])
    fresh(n=0)
    hit("L9 right button down, no rows: nothing selected (-1), taken", 0x204)
    fresh(n=1, ctl={}, rows="0")
    hit("L9 right button down on the only row of a list of one row: it is selected", 0x204, X, Y[0])
    fresh(bar=False)
    hit("L9 right button down, no scroll bar: taken", 0x204)
    fresh(th=0)
    hit("L9 right button down, row height 0: taken", 0x204)
    fresh(pos=3)
    hit("L9 right button down on page row 1, the bar at 3: row 4", 0x204, X, Y[1])
    fresh()
    hit("L9 right button down outside the box: the rows' controls get it, not taken", 0x204, *OUT, **ARGS)
    fresh()
    hit("L9 right button down on the strip above the text: row 0", 0x204, X, Y[-1])
    fresh()
    hit("L9 right button down at y 10, a whole row above the text: row -1: no such row, taken, nothing changes", 0x204, X, 10)
    for mods, tag in ((0, "no key"), (4, "shift"), (8, "control"), (0xC, "control and shift"), (0x13, "no key, other bits")):
        for start, row in ((1, 0), (3, 2), (0, 1), (2, 1)):
            fresh(style=1, selected=7, sel_start=start)
            hit("L9 right button down on page row %d, multi selection, %s, the range starts at %d, rows 10110" % (row, tag, start), 0x204, X, Y[row], mods)
    for sel, start, tag in ((-1, 0, "nothing selected"), (0, 0, "row 0 only"), (1, 3, "from 3 up to 1"), (3, 1, "from 1 down to 3"), (2, 5, "the start is past the list"),
                            (5, 2, "the selection is past the list"), (4, 0, "from 0 down to 4"), (2, 2, "row 2 only")):
        fresh(selected=sel, sel_start=start, drag=True, rows="10110")
        hit("L9 right button up, selected %d, start %d (%s), rows 10110: the range takes the start's flag" % (sel, start, tag), 0x205, X, Y[1], **ARGS)
        fresh(selected=sel, sel_start=start, drag=True, rows="01001")
        hit("L9 right button up, selected %d, start %d (%s), rows 01001" % (sel, start, tag), 0x205)
    for sel_msg, r_msg in ((-1, -1), (21, -1), (-1, 24), (21, 24), (0, 0), (-2, 7)):
        fresh(selected=3, sel_start=1, drag=True, sel_msg=sel_msg, r_msg=r_msg)
        hit("L9 right button up, selection message %d, right button message %d, start 1 selected 3: the test is on the selection message, the number is the right button's" % (sel_msg, r_msg), 0x205)
        fresh(selected=2, sel_start=2, drag=True, sel_msg=sel_msg, r_msg=r_msg)
        hit("L9 right button up, selection message %d, right button message %d, start 2 selected 2: no message" % (sel_msg, r_msg), 0x205)

    # ================================================================ 0x20A
    for tag, wp in (("120", 0x00780000), ("-120", 0xFF880000), ("240", 0x00F00000), ("119", 0x00770000), ("-119", 0xFF890000), ("-121", 0xFF870000), ("0", 0),
                    ("120 with noise in the low word", 0x00780001), ("32767", 0x7FFF0000), ("-32768", 0x80000000), ("-240", 0xFF100000)):
        fresh()
        o.wheel(3)
        hit("L10 wheel %s, 3 lines a notch: the bar scrolls by -(3 * notches); taken" % tag, 0x20A, X, Y[1], wp)
    for lines, wp in ((5, 0xFF880000), (5, 0xFF100000), (0, 0x00780000), (1 << 30, 0x00F00000), (1, 0x80000000), (7, 0x00780000), (-4, 0x00780000)):
        fresh()
        o.wheel(lines)
        hit("L10 wheel 0x%08X, %d lines a notch" % (wp, lines), 0x20A, X, Y[1], wp)
    # the product of the lines and the notches is a 32-bit one
    for lines, wp in ((1 << 30, 0x01E00000), (1 << 30, 0xFE200000), (0x7FFFFFFF, 0xFE980000), (0x10000, 0x0F000000)):
        fresh()
        o.wheel(lines)
        hit("L10 wheel 0x%08X, %d lines a notch: the product wraps in 32 bits" % (wp, lines), 0x20A, X, Y[1], wp)
    fresh(bar=False)
    o.wheel(3)
    hit("L10 wheel, no scroll bar: the system is asked all the same, taken", 0x20A, X, Y[1], 0x00780000)
    fresh()
    o.wheel(3)
    hit("L10 wheel outside the box: the same", 0x20A, *OUT, 0xFF880000)
    fresh(ignore=True)
    hit("L10 wheel, clicks ignored: taken", 0x20A, X, Y[1], 0x00780000)
    fresh()
    o.answer("S", "mouse", 1)
    hit("L10 wheel, the scroll bar takes it: no scroll here, no question to the system", 0x20A, X, Y[1], 0x00780000)

    # ================================================================ the row under the mouse and the page, in 32 bits
    # a bar whose position is negative (a track that starts below zero): the row -5 is no row, so GetItem answers none (the page test alone would let it through)
    for m, kw in ((0x200, {"at_move": True}), (0x201, {}), (0x201, {"ignore": True}), (0x203, {}), (0x204, {})):
        fresh(pos=-5, page=10, **kw)
        hit("L12 message 0x%X on page row 0 with the bar at -5 (page 10)%s: row -5 is no row: taken, nothing happens" % (m, ", clicks ignored" if kw.get("ignore") else ""), m, X, Y[0])
    for m, kw in ((0x200, {"at_move": True}), (0x201, {}), (0x204, {})):
        fresh(pos=-2, page=10, **kw)
        hit("L12 message 0x%X on page row 2 with the bar at -2 (page 10): row 0 is on the page" % m, m, X, Y[2])
    # the end of the page is a 32-bit sum: 3 + 2147483647 is -2147483646, so row 3 is not on the page
    for m, kw in ((0x200, {"at_move": True}), (0x201, {}), (0x201, {"ignore": True}), (0x203, {}), (0x204, {})):
        fresh(pos=3, page=0x7FFFFFFF, **kw)
        hit("L12 message 0x%X on page row 0 with the bar at 3 and a page of 2147483647 rows: its end wraps to a negative number, row 3 is not on the page" % m, m, X, Y[0])
    for m in (0x201, 0x204):
        fresh(pos=3, page=0x7FFFFF00)
        hit("L12 message 0x%X on page row 0 with the bar at 3 and a page of 2147483392 rows: the end does not wrap, row 3 is on the page" % m, m, X, Y[0])
    # the row is the position plus the cut quotient, both ints: -2147483648 + -2147483648 is 0 in 32 bits
    big = dict(sel=(-100, -100, 110, 70), text=(10, 2147483647, 100, 60))
    for m in (0x201, 0x203):
        fresh(th=1, pos=-2147483648, page=3, ignore=True, **big)
        hit("L12 message 0x%X at y -1, the text starting at 2147483647 in rows of 1, the bar at -2147483648: the quotient is -2147483648 and the sum wraps to row 0 (not on the page)" % m, m, X, -1)
    # the distance to the top of the text is a 32-bit difference: -2 - 2147483647 wraps to 2147483647, a quotient of 306783378 for rows of 7
    for m in (0x200, 0x201, 0x204):
        fresh(th=7, pos=-306783376, page=400000000, at_move=True, **big)
        hit("L12 message 0x%X at y -2, the text starting at 2147483647 in rows of 7, the bar at -306783376: the difference wraps to 2147483647, row 2 is on the page" % m, m, X, -2)

    # ================================================================ MsgProc (32943960)
    for m in (0x215, 0x214, 0x216, 0x200, 0x201, 0x0, 0x100):
        fresh(drag=True)
        o.act_msgproc("L11 MsgProc 0x%X while dragging: only the lost capture (0x215) ends the drag; never taken" % m, "A", m, **ARGS)
    fresh(drag=False)
    o.act_msgproc("L11 MsgProc 0x215 while not dragging", "A", 0x215)
    return o


if __name__ == "__main__":
    o = main()
    if "--json" in sys.argv:
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w", encoding="utf-8") as fh:  # one step per line
            import json
            fh.write("[\n" + ",\n".join(json.dumps(step, ensure_ascii=False) for step in o.script) + "\n]\n")
