import { describe, expect, test } from "bun:test";
import {
  CKTDGUIButton, CKTDGUIContolList, CKTDGUIControl, CKTDGUIDialog, CKTDGUIDialogManager, CKTDGUIListBox, CKTDGUINavigation, CKTDGUIScrollBar,
  CKTDGUISlot, CKTDGUIStatic, CPictureData, UIPointData, localAxis, pick2DRect, pick2DRectOfRect, setRect,
} from "../src/index.ts";
import type { UIContext } from "../src/index.ts";
import { rig } from "./rig.ts";
import { setup } from "./harness.ts";

/**
 * Where the mouse is: `Pick2DRect` and the `ContainsPoint` of the control classes, the point a dialog hands its controls, and what the
 * dialog does with the answers (`GetControlAtPointAbsolute`, `GetControlAtPointForStatic`, `OnMouseMove`, `GetControlMouseOver`,
 * `SetShow(true)`, the manager's `ExistDialogAtMousePos`).
 *
 * The expected numbers are the exe's own: `tools/oracle-mouse.py` runs x2.exe's functions (32946C10, 32924310, 32928E90, 3292D460, 32942D10,
 * 3294F490, 3294E000, 32957310, 329573C0, 3295A4D0) on the Unicorn emulator, on controls and a dialog built in its memory, and every row
 * below was also worked out by hand from the decompile first (the cross products of the four edges, the truncations, the scale).
 * Points are integers; every quadrilateral is walked left-top, right-top, right-bottom, left-bottom, and a point on an edge is outside.
 */

type P = [number, number];
const quad = (l: number, t: number, r: number, b: number): [P, P, P, P] => [[l, t], [r, t], [l, b], [r, b]];

/** a point data made of the corners left-top, right-top, left-bottom, right-bottom */
function pointOf(corners: P[]): UIPointData {
  const p = new UIPointData();
  p.leftTopPoint.set(...corners[0]!);
  p.rightTopPoint.set(...corners[1]!);
  p.leftBottomPoint.set(...corners[2]!);
  p.rightBottomPoint.set(...corners[3]!);
  return p;
}

const E = 2 ** -15;
const A = quad(10, 20, 110, 70);
/** A walked the other way round: left and right swapped */
const R: P[] = [[110, 20], [10, 20], [110, 70], [10, 70]];
/** a skewed quadrilateral: left-top (0, 0), right-top (100, 20), left-bottom (30, 60), right-bottom (130, 80) */
const S: P[] = [[0, 0], [100, 20], [30, 60], [130, 80]];
/** the products of this one round off to 0 in single precision: the exe says no, exact arithmetic says yes */
const Q: P[] = [[0, -E], [1 + E, 1 + E], [-1, 3], [2.5, 4]];

/** [shape, point, the exe's answer] */
const PICKS: [string, P[], P, boolean][] = [
  ["A", A, [50, 40], true], ["A", A, [10, 40], false], ["A", A, [110, 40], false], ["A", A, [50, 20], false], ["A", A, [50, 70], false],
  ["A", A, [11, 21], true], ["A", A, [109, 69], true], ["A", A, [9, 40], false], ["A", A, [111, 40], false], ["A", A, [50, 19], false],
  ["A", A, [50, 71], false],
  ["R", R, [50, 40], true], ["R", R, [10, 40], false], ["R", R, [110, 40], false], ["R", R, [50, 20], false],
  ["S", S, [50, 11], true], ["S", S, [50, 9], false], ["S", S, [50, 10], false], ["S", S, [65, 35], true], ["S", S, [30, 60], false],
  ["S", S, [31, 60], true], ["S", S, [100, 20], false], ["S", S, [99, 21], true], ["S", S, [130, 80], false], ["S", S, [129, 79], true],
  ["S", S, [20, 30], true], ["S", S, [110, 60], true],
  ["Q", Q, [1, 1], false],
];

const answers = (c: CKTDGUIControl, points: P[]): boolean[] => points.map(([x, y]) => c.containsPoint(x, y));

describe("Pick2DRect (32946C10) and CKTDGUIControl::ContainsPoint (32924310)", () => {
  test("a point is inside when it is on the same side of all four edges; a point on an edge is outside; the walk may run either way round", () => {
    const got = PICKS.map(([, s, [x, y]]) => pick2DRect(x, y, ...(s.map(([cx, cy]) => ({ x: cx, y: cy })) as [never, never, never, never])));
    expect(got).toEqual(PICKS.map(([, , , want]) => want));
  });

  test("every step is a single-precision operation: a quadrilateral whose exact products are positive can answer no", () => {
    // (1 + 2^-15)^2 = 1 + 2^-14 + 2^-30 rounds to 1 + 2^-14, so the first cross product is 0 (exact arithmetic: 9.3e-10)
    expect(pick2DRect(1, 1, { x: 0, y: -E }, { x: 1 + E, y: 1 + E }, { x: -1, y: 3 }, { x: 2.5, y: 4 })).toBe(false);
  });

  test("the control's own test reads its current point, m_NowPoint, with the same four roles", () => {
    const { w } = setup();
    for (const [name, shape] of [["A", A], ["R", R], ["S", S], ["Q", Q]] as const) {
      const c = new CKTDGUIControl(w);
      c.m_NowPoint.assign(pointOf(shape));
      const rows = PICKS.filter(([n]) => n === name);
      expect([name, answers(c, rows.map(([, , p]) => p))]).toEqual([name, rows.map(([, , , want]) => want)]);
    }
  });

  test("a control that has not been given a point holds nothing (all four corners are the same point)", () => {
    const { w } = setup();
    const c = new CKTDGUIControl(w);
    expect(answers(c, [[0, 0], [1, 1], [-1, -1]])).toEqual([false, false, false]);
  });

  test("the base class takes no input: HandleMouse / HandleKeyboard / MsgProc answer no; OnFocusIn / OnFocusOut set m_bHasFocus", () => {
    const { w } = setup();
    const c = new CKTDGUIControl(w);
    expect([c.handleMouse(512, 5, 6, 0, 0), c.handleKeyboard(256, 13, 0), c.msgProc(null, 256, 13, 0)]).toEqual([false, false, false]);
    c.onFocusIn();
    expect(c.m_bHasFocus).toBe(true);
    c.onFocusOut();
    expect(c.m_bHasFocus).toBe(false);
  });
});

describe("CKTDGUIStatic::ContainsPoint (32928E90)", () => {
  function staticOf(shapes: (P[] | null)[]): CKTDGUIStatic {
    const { w } = setup();
    const st = new CKTDGUIStatic(w);
    for (const shape of shapes) {
      const pic = new CPictureData(w);
      pic.pPoint = shape ? pointOf(shape) : null;
      st.m_PictureDataList.push(pic);
    }
    return st;
  }

  test("the point of any picture may hold it; a picture without a point is passed over, not the end of the search", () => {
    const st = staticOf([quad(0, 0, 50, 50), null, quad(100, 100, 200, 160), S]);
    const points: P[] = [[25, 25], [50, 25], [60, 60], [150, 130], [100, 130], [65, 35], [30, 60], [5, 5], [-1, 5]];
    // (50, 25) is on the right edge of the first picture and inside the fourth; (100, 130) is on the left edge of the third
    expect(answers(st, points)).toEqual([true, true, true, true, false, true, false, true, false]);
  });

  test("no picture, or no point: nothing is held", () => {
    expect(answers(staticOf([]), [[1, 1]])).toEqual([false]);
    expect(answers(staticOf([null]), [[1, 1]])).toEqual([false]);
  });

  test("a static does not use its own current point (the base class's) at all", () => {
    const st = staticOf([]);
    st.m_NowPoint.assign(pointOf(A));
    expect(answers(st, [[50, 40]])).toEqual([false]);
  });
});

describe("the ContainsPoint of Button and Slot (3292D460: one function): the quadrilateral and the enable rectangle", () => {
  const BIG = quad(0, 0, 200, 200);
  /** [dialog position, the answers at (50,40) (25,40) (26,40) (36,40) (35,40) (84,40) (85,40) (50,18) (50,19) (50,20) (50,52) (50,53) (50,59) (50,60) (95,40)] */
  const POINTS: P[] = [[50, 40], [25, 40], [26, 40], [36, 40], [35, 40], [84, 40], [85, 40], [50, 18], [50, 19], [50, 20], [50, 52], [50, 53], [50, 59], [50, 60], [95, 40]];
  const RUNS: [string, P, boolean[]][] = [
    // the point is put in the dialog's coordinates (+ (int) position): 30 < x + 5 < 90, 25 < y + 7 < 60
    ["dialog (5, 7)", [5, 7], [true, false, true, true, true, true, false, false, true, true, true, false, false, false, false]],
    // (int) cuts towards 0: 5.9 is 5, 7.9 is 7
    ["dialog (5.9, 7.9)", [5.9, 7.9], [true, false, true, true, true, true, false, false, true, true, true, false, false, false, false]],
    // and -5.9 is -5, -7.9 is -7 (not -6, -8): 35 < x < 95, 32 < y < 67
    ["dialog (-5.9, -7.9)", [-5.9, -7.9], [true, false, false, true, false, true, true, false, false, false, true, true, true, true, false]],
  ];

  function inDialog(make: (w: UIContext) => CKTDGUIControl, pos: [number, number] | null, lt: P, rb: P, shape: P[] = BIG) {
    const { w } = setup();
    const c = make(w);
    c.m_NowPoint.assign(pointOf(shape));
    if (pos) {
      const d = new CKTDGUIDialog(w);
      d.m_Pos.set(...pos);
      d.AddControl(c);
    }
    c.m_vEnableLeftTop.set(...lt);
    c.m_vEnableRightBottom.set(...rb);
    return c;
  }

  for (const [cls, make] of [["Button", (w: UIContext) => new CKTDGUIButton(w)], ["Slot", (w: UIContext) => new CKTDGUISlot(w)]] as const) {
    test(`${cls}: inside the quadrilateral and strictly inside the enable rectangle (30, 25)-(90, 60) in the dialog's coordinates`, () => {
      for (const [name, pos, want] of RUNS) {
        const c = inDialog(make, pos, [30, 25], [90, 60]);
        expect([name, answers(c, POINTS)]).toEqual([name, want]);
      }
    });
  }

  test("the quadrilateral comes first: a point outside it is no, whatever the rectangle says", () => {
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    d.m_Pos.set(5, 7);
    const c = new CKTDGUIButton(w);
    c.m_NowPoint.assign(pointOf(A));
    d.AddControl(c);
    c.m_vEnableLeftTop.set(30, 25);
    c.m_vEnableRightBottom.set(90, 60);
    expect(answers(c, [[50, 40], [50, 19], [50, 20], [50, 21], [111, 40]])).toEqual([true, false, false, true, false]);
  });

  test("a rectangle with a corner at (0, 0) is no rectangle: the quadrilateral decides; a corner at (0, 5) is a corner", () => {
    const POINTS4: P[] = [[50, 40], [36, 40], [84, 40], [50, 52]];
    for (const [lt, rb] of [[[0, 0], [90, 60]], [[30, 25], [0, 0]], [[0, 5], [90, 60]]] as [P, P][]) {
      expect(answers(inDialog((w) => new CKTDGUIButton(w), [5, 7], lt, rb), POINTS4)).toEqual([true, true, true, true]);
    }
    // a corner (0, 5) is a corner: the rectangle (0, 5)-(90, 60) holds 0 < x + 5 < 90 and 5 < y + 7 < 60, i.e. -5 < x < 85 and -2 < y < 53
    const wide = inDialog((w) => new CKTDGUIButton(w), [5, 7], [0, 5], [90, 60], quad(-50, -50, 200, 200));
    expect(answers(wide, [[-10, 40], [-5, 40], [-4, 40], [84, 40], [85, 40], [86, 40], [50, -3], [50, -2], [50, -1], [50, 52], [50, 53]])).toEqual([
      false, false, true, true, false, false, false, false, true, true, false,
    ]);
  });

  test("the rectangle is the box the two corners span, whichever way they are given; a corner pair with no width or no height holds nothing", () => {
    const POINTS4: P[] = [[50, 40], [36, 40], [84, 40], [50, 52]];
    const cases: [string, P, P, boolean][] = [
      ["walked left and up", [90, 60], [30, 25], true],
      ["x1 < x2, y1 > y2", [30, 60], [90, 25], true],
      ["x1 > x2, y1 < y2", [90, 25], [30, 60], true],
      ["no width", [30, 25], [30, 60], false],
      ["no height", [30, 25], [90, 25], false],
    ];
    for (const [name, lt, rb, want] of cases) {
      expect([name, answers(inDialog((w) => new CKTDGUIButton(w), [5, 7], lt, rb), POINTS4)]).toEqual([name, [want, want, want, want]]);
    }
  });

  test("a control in no dialog (or a dialog that is gone) is asked of the null dialog at (0, 0)", () => {
    const POINTS6: P[] = [[30, 40], [31, 40], [89, 40], [90, 40], [50, 25], [50, 26]];
    const want = [false, true, true, false, false, true];
    expect(answers(inDialog((w) => new CKTDGUIButton(w), null, [30, 25], [90, 60]), POINTS6)).toEqual(want);
    const { w } = setup();
    const d = new CKTDGUIDialog(w);
    d.m_Pos.set(5, 7);
    const c = new CKTDGUIButton(w);
    c.m_NowPoint.assign(pointOf(BIG));
    d.AddControl(c);
    c.m_vEnableLeftTop.set(30, 25);
    c.m_vEnableRightBottom.set(90, 60);
    d.destroyed = true; // the handle no longer resolves
    expect(answers(c, POINTS6)).toEqual(want);
  });
});

describe("ListBox (32942D10), ControlList (3294F490) and Navigation (3294E000): ContainsPoint", () => {
  const BOX = quad(10, 20, 110, 70);

  function listBox(bar: [number, number, number, number]) {
    const { w } = setup();
    const b = new CKTDGUIListBox(w);
    b.m_NowPoint.assign(pointOf(BOX));
    const scrollBar = new CKTDGUIScrollBar(w);
    setRect(scrollBar.m_rcBoundingBox, ...bar);
    b.m_pScrollBar = scrollBar;
    return b;
  }

  function controlList(x: [number, number, number, number] | null, y: [number, number, number, number] | null) {
    const { w } = setup();
    const c = new CKTDGUIContolList(w);
    c.m_NowPoint.assign(pointOf(BOX));
    for (const [axis, box] of [["m_pScrollBarX", x], ["m_pScrollBarY", y]] as const) {
      if (box) {
        const bar = new CKTDGUIScrollBar(w);
        setRect(bar.m_rcBoundingBox, ...box);
        c[axis] = bar;
      } else {
        c[axis] = null;
      }
    }
    return c;
  }

  test("a list box holds the points of its quadrilateral and of its scroll bar's bounding box (both strictly inside)", () => {
    const b = listBox([120, 20, 140, 70]);
    const points: P[] = [[50, 40], [10, 40], [11, 21], [110, 40], [121, 40], [120, 40], [139, 69], [140, 40], [130, 20], [130, 21], [130, 69], [130, 70], [115, 40]];
    expect(answers(b, points)).toEqual([true, false, true, false, true, false, true, false, false, true, true, false, false]);
  });

  test("a list box with no scroll bar is a null dereference in the exe as soon as the point is outside its quadrilateral", () => {
    const b = listBox([120, 20, 140, 70]);
    b.m_pScrollBar = null;
    expect(b.containsPoint(50, 40)).toBe(true);
    expect(() => b.containsPoint(130, 40)).toThrow(/no scroll bar/);
  });

  test("a control list holds its quadrilateral, then the box of the horizontal bar, then the box of the vertical bar", () => {
    const c = controlList([10, 80, 110, 95], [120, 20, 140, 70]);
    const points: P[] = [[50, 40], [50, 85], [50, 80], [50, 81], [11, 94], [11, 95], [121, 40], [130, 20], [130, 21], [115, 85], [111, 90], [139, 69], [140, 40]];
    expect(answers(c, points)).toEqual([true, true, false, true, true, false, true, false, true, false, false, true, false]);
  });

  test("a control list without a bar holds nothing of it", () => {
    expect(answers(controlList(null, [120, 20, 140, 70]), [[130, 40], [50, 85]])).toEqual([true, false]);
    expect(answers(controlList(null, null), [[130, 40], [50, 85], [50, 40]])).toEqual([false, false, true]);
    expect(answers(controlList([10, 80, 110, 95], null), [[130, 40], [50, 85]])).toEqual([false, true]);
  });

  test("pick2DRectOfRect is Pick2DRect on the four corners of an integer rectangle", () => {
    expect([[100, 20], [101, 21], [139, 69], [140, 69], [101, 70]].map(([x, y]) => pick2DRectOfRect(x!, y!, { left: 100, top: 20, right: 140, bottom: 70 }))).toEqual([false, true, true, false, false]);
  });

  test("a navigation makes its rectangle again from the background point (each coordinate cut towards 0) and asks PtInRect: right and bottom are outside", () => {
    const { w } = setup();
    const nav = new CKTDGUINavigation(w);
    nav.m_pBGPoint = pointOf([[10.9, 20.9], [110.9, 20.9], [10.9, 70.9], [110.9, 70.9]]);
    expect(answers(nav, [[10, 20], [9, 20], [10, 19], [109, 69], [110, 40], [50, 70], [50, 69], [-1, -1]])).toEqual([true, false, false, true, false, false, true, false]);
    expect([nav.m_rcBG.left, nav.m_rcBG.top, nav.m_rcBG.right, nav.m_rcBG.bottom]).toEqual([10, 20, 110, 70]);
    nav.m_pBGPoint = pointOf([[-10.9, -20.9], [10.9, -20.9], [-10.9, 20.9], [10.9, 20.9]]);
    expect(answers(nav, [[-10, -20], [-11, -20], [0, 0], [9, 19], [10, 0], [0, 20]])).toEqual([true, false, true, true, false, false]);
    expect([nav.m_rcBG.left, nav.m_rcBG.top, nav.m_rcBG.right, nav.m_rcBG.bottom]).toEqual([-10, -20, 10, 20]);
  });

  test("a navigation without a background point is a null dereference in the exe", () => {
    const { w } = setup();
    expect(() => new CKTDGUINavigation(w).containsPoint(1, 1)).toThrow(/no background point/);
  });
});

describe("the point a dialog hands its controls: (int)((pt - (int)(scale * offset)) / scale)", () => {
  test("localAxis: the origin and the quotient are cut towards 0 (toward zero, not down)", () => {
    // scale 1.5, offset 30.5: origin (int)45.75 = 45
    expect([47, 74, 75, 46, 45, 44, 43].map((p) => localAxis(p, 1.5, 30.5))).toEqual([1, 19, 20, 0, 0, 0, -1]);
    // offset -30.5: origin (int)-45.75 = -45
    expect([10, -45, -46, -47].map((p) => localAxis(p, 1.5, -30.5))).toEqual([36, 0, 0, -1]);
    // no scale, a fractional offset: the origin is cut (30), so 29 is -1
    expect([31, 30, 29].map((p) => localAxis(p, 1, 30.5))).toEqual([1, 0, -1]);
  });

  /**
   * A static at offset (30.5, 40.25) with a picture (0, 0)-(20, 10) holds the points whose local point is strictly inside: 0 < lx < 20 and
   * 0 < ly < 10.  The screen points found (x from .. to, how many; y from .. to, how many; in all) for each resolution scale, which the exe
   * gives and which follow from the formula: scale (1.5, 2): origin (45, 80); (0.75, 0.5): (22, 20); (1, 1): (30, 40); (1.25, 0.9375): (38, 37).
   */
  const SCALES: [number, number, number, number][] = [
    // [width, height of the back buffer, ...] -> see below
    [1536, 1536, 0, 0], [768, 384, 0, 0], [1024, 768, 0, 0], [1280, 720, 0, 0],
  ];
  const WANT = [
    [47, 74, 28, 82, 99, 18, 504], // 1.5 x 2
    [23, 36, 14, 21, 24, 4, 56], // 0.75 x 0.5
    [31, 49, 19, 41, 49, 9, 171], // 1 x 1
    [40, 62, 23, 38, 46, 9, 207], // 1.25 x 0.9375
  ];
  test("GetControlAtPointForStatic scales the point into the control's own pixels: the screen points a static holds, for four resolution scales", () => {
    const got = SCALES.map(([width, height]) => {
      const s = rig({ backBuffer: { width: width!, height: height! } });
      const d = s.dialog();
      const st = new CKTDGUIStatic(s.w);
      const pic = new CPictureData(s.w);
      pic.pPoint = pointOf(quad(0, 0, 20, 10));
      st.m_PictureDataList.push(pic);
      st.m_OffsetPos.set(30.5, 40.25);
      d.AddControl(st);
      const xs = new Set<number>(), ys = new Set<number>();
      let total = 0;
      for (let px = -2; px < 80; px++) {
        for (let py = -2; py < 100; py++) {
          if (d.getControlAtPointForStatic(px, py) === st) {
            xs.add(px);
            ys.add(py);
            total++;
          }
        }
      }
      const sx = [...xs].sort((a, b) => a - b), sy = [...ys].sort((a, b) => a - b);
      return [sx[0]!, sx[sx.length - 1]!, sx.length, sy[0]!, sy[sy.length - 1]!, sy.length, total];
    });
    expect(got).toEqual(WANT);
  });
});

describe("CKTDGUIDialog: GetControlAtPointAbsolute (32957310), GetControlAtPointForStatic (329573C0) and OnMouseMove (3295A4D0)", () => {
  /**
   * The list from the back: bottom (a button holding the box 0..100), middle (a static holding it), hidden (a button, not shown), outOfList (a
   * button that is out of the list) and off (a button disabled, at 200..300).  Both walks start at the last control.
   */
  function dialogOf() {
    const { w, dialog } = setup();
    const d = dialog();
    const button = (name: string, shape: P[], flags: Partial<{ show: boolean; outOfList: boolean; enable: boolean }> = {}) => {
      const b = new CKTDGUIButton(w);
      b.m_Name = name;
      b.m_NowPoint.assign(pointOf(shape));
      if (flags.show === false) b.m_bShow = false;
      if (flags.outOfList) b.m_bOutofList = true;
      if (flags.enable === false) b.m_bEnable = false;
      d.AddControl(b);
      return b;
    };
    const bottom = button("bottom", quad(0, 0, 100, 100));
    const middle = new CKTDGUIStatic(w);
    middle.m_Name = "middle";
    const pic = new CPictureData(w);
    pic.pPoint = pointOf(quad(0, 0, 100, 100));
    middle.m_PictureDataList.push(pic);
    d.AddControl(middle);
    const hidden = button("hidden", quad(0, 0, 100, 100), { show: false });
    const outOfList = button("outOfList", quad(0, 0, 100, 100), { outOfList: true });
    const off = button("disabledButAbsolute", quad(200, 200, 300, 300), { enable: false });
    const name = (c: CKTDGUIControl | null) => (c ? c.m_Name : null);
    const over = () => [bottom, middle, hidden, outOfList, off].map((c) => c.m_bMouseOver);
    return { w, d, bottom, middle, hidden, outOfList, off, name, over };
  }

  test("GetControlAtPointForStatic: the last control that holds the point, is shown and is not out of the list (a static too)", () => {
    const { d, name } = dialogOf();
    expect([name(d.getControlAtPointForStatic(50, 50)), name(d.getControlAtPointForStatic(250, 250)), name(d.getControlAtPointForStatic(500, 500))]).toEqual(["middle", "disabledButAbsolute", null]);
  });

  test("GetControlAtPointAbsolute: the last control that holds the point, shown or not, out of the list or not", () => {
    const { d, name } = dialogOf();
    expect([name(d.getControlAtPointAbsolute(50, 50)), name(d.getControlAtPointAbsolute(250, 250)), name(d.getControlAtPointAbsolute(500, 500))]).toEqual(["outOfList", "disabledButAbsolute", null]);
  });

  test("OnMouseMove: m_pControlMouseOverStatic is the static walk's, m_pControlMouseOver the last control that is not a static (an enable flag is not asked); the flags follow", () => {
    const { d, name, over } = dialogOf();
    d.onMouseMove(50, 50);
    expect([name(d.m_pControlMouseOver), name(d.m_pControlMouseOverStatic), name(d.m_pControlMouseOverShowDlg), over()]).toEqual(["bottom", "middle", null, [true, false, false, false, false]]);
    d.onMouseMove(250, 250);
    expect([name(d.m_pControlMouseOver), name(d.m_pControlMouseOverStatic), name(d.m_pControlMouseOverShowDlg), over()]).toEqual([
      "disabledButAbsolute", "disabledButAbsolute", null, [false, false, false, false, true],
    ]);
    d.onMouseMove(500, 500);
    expect([name(d.m_pControlMouseOver), name(d.m_pControlMouseOverStatic), over()]).toEqual([null, null, [false, false, false, false, false]]);
  });

  test("with m_bMouseOverShowDlg the dialog also follows the absolute walk (m_pControlMouseOverShowDlg), whose control gets m_bMouseOver too", () => {
    const { d, name, over } = dialogOf();
    d.m_bMouseOverShowDlg = true;
    d.onMouseMove(50, 50);
    expect([name(d.m_pControlMouseOver), name(d.m_pControlMouseOverShowDlg), name(d.m_pControlMouseOverStatic), over()]).toEqual([
      "bottom", "outOfList", "middle", [true, false, false, true, false],
    ]);
    d.onMouseMove(250, 250);
    expect([name(d.m_pControlMouseOver), name(d.m_pControlMouseOverShowDlg), name(d.m_pControlMouseOverStatic), over()]).toEqual([
      "disabledButAbsolute", "disabledButAbsolute", "disabledButAbsolute", [false, false, false, false, true],
    ]);
    d.onMouseMove(500, 500);
    expect([name(d.m_pControlMouseOver), name(d.m_pControlMouseOverShowDlg), over()]).toEqual([null, null, [false, false, false, false, false]]);
  });

  test("the control the mouse stays over keeps its flag (the old one is cleared only when another comes)", () => {
    const { d, bottom, off } = dialogOf();
    d.onMouseMove(50, 50);
    bottom.m_bMouseOver = false; // someone cleared it (the button's own OnFrameMove does when the mouse is gone)
    d.onMouseMove(60, 60); // the same control: not set again
    expect(bottom.m_bMouseOver).toBe(false);
    d.onMouseMove(250, 250);
    expect([bottom.m_bMouseOver, off.m_bMouseOver]).toEqual([false, true]);
  });

  test("a statics-only dialog: no control but the static is found, nothing is the control the mouse is over", () => {
    const { w, dialog } = setup();
    const d = dialog();
    const st = new CKTDGUIStatic(w);
    const pic = new CPictureData(w);
    pic.pPoint = pointOf(quad(0, 0, 10, 10));
    st.m_PictureDataList.push(pic);
    d.AddControl(st);
    d.onMouseMove(5, 5);
    expect([d.m_pControlMouseOverStatic === st, d.m_pControlMouseOver, st.m_bMouseOver]).toEqual([true, null, false]);
  });
});

describe("CKTDGUIDialog::GetControlMouseOver (329574A0) and the manager's ExistDialogAtMousePos (328DE620)", () => {
  function dialogWithStatic(name = "ctl") {
    const s = setup();
    const d = s.dialog();
    const st = new CKTDGUIStatic(s.w);
    st.m_Name = name;
    const pic = new CPictureData(s.w);
    pic.pPoint = pointOf(quad(0, 0, 100, 100));
    st.m_PictureDataList.push(pic);
    d.AddControl(st);
    d.onMouseMove(50, 50);
    return { ...s, d, st };
  }

  test("the control under the mouse, unless the dialog is disabled, hidden or nearly transparent (alpha below the float 0.01), or the control is named INVISIBLE", () => {
    const { d, st } = dialogWithStatic();
    const is = (c: unknown) => c === st;
    expect(is(d.getControlMouseOver())).toBe(true);
    d.m_bEnable = false;
    expect(d.getControlMouseOver()).toBeNull();
    d.m_bEnable = true;
    d.m_bShow = false;
    expect(d.getControlMouseOver()).toBeNull();
    d.m_bShow = true;
    d.m_Color.a = 0.0099;
    expect(d.getControlMouseOver()).toBeNull();
    d.m_Color.a = 0.01; // the float 0.01 itself is not below it (the compare is `comiss` of the float constant)
    expect(is(d.getControlMouseOver())).toBe(true);
    d.m_Color.a = 1;
    st.m_Name = "INVISIBLE";
    expect(d.getControlMouseOver()).toBeNull();
    for (const other of ["invisible", "INVISIBLE ", "INVISIBL", ""]) {
      st.m_Name = other;
      expect([other, is(d.getControlMouseOver())]).toEqual([other, true]);
    }
    st.m_Name = "ctl";
    d.m_pControlMouseOverStatic = null;
    expect(d.getControlMouseOver()).toBeNull();
  });

  test("ExistDialogAtMousePos: some dialog of the manager has a control under the mouse; a dialog that is gone is passed over", () => {
    const { w } = setup();
    const manager = new CKTDGUIDialogManager(w);
    const nothing = new CKTDGUIDialog(w);
    manager.addDlg(nothing);
    expect(manager.existDialogAtMousePos()).toBe(false);
    const a = dialogWithStatic("a");
    const b = dialogWithStatic("b");
    manager.addDlg(a.d);
    expect(manager.existDialogAtMousePos()).toBe(true);
    a.d.m_bShow = false; // nothing under the mouse for a dialog that is hidden
    manager.addDlg(b.d);
    expect(manager.existDialogAtMousePos()).toBe(true);
    b.d.destroyed = true; // its handle no longer resolves
    expect(manager.existDialogAtMousePos()).toBe(false);
    a.d.m_bShow = true;
    expect(manager.existDialogAtMousePos()).toBe(true);
  });
});

describe("CKTDGUIDialog::SetShow (3295B900): showing a dialog makes it take the mouse", () => {
  function scene() {
    // back buffer 1536 x 1536: the scale is (1.5, 2)
    const s = rig({ backBuffer: { width: 1536, height: 1536 } });
    const d = s.dialog();
    const b = new CKTDGUIButton(s.w);
    b.m_NowPoint.assign(pointOf(quad(0, 0, 10, 10)));
    d.AddControl(b);
    d.m_bShow = false;
    d.m_Pos.set(10.5, 20.25);
    return { ...s, d, b };
  }

  test("OnMouseMove is told the mouse less the dialog's position scaled and cut: x - (int)(10.5 * 1.5), y - (int)(20.25 * 2) = x - 15, y - 40", () => {
    const { w, d, b } = scene();
    w.mouse.m_XPos = 24;
    w.mouse.m_YPos = 44;
    d.setShow(true);
    // (24 - 15, 44 - 40) = (9, 4): the control's own pixels (int)(9 / 1.5) = 6, (int)(4 / 2) = 2: inside the box 0..10
    expect([d.m_bShow, d.m_pControlMouseOver === b, b.m_bMouseOver]).toEqual([true, true, true]);
  });

  test("without the dialog's position the same mouse would be outside: the subtraction is what puts it inside", () => {
    const { w, d, b } = scene();
    w.mouse.m_XPos = 24;
    w.mouse.m_YPos = 44;
    d.m_Pos.set(0, 0);
    d.setShow(true);
    // (24, 44) -> (16, 22): outside
    expect([d.m_pControlMouseOver, b.m_bMouseOver]).toEqual([null, false]);
  });

  test("a dialog that is shown already does nothing (the flag did not change); hiding hides the guide dialog and takes no mouse", () => {
    const { w, d, b } = scene();
    d.m_bShow = true;
    w.mouse.m_XPos = 24;
    w.mouse.m_YPos = 44;
    d.setShow(true);
    expect([d.m_pControlMouseOver, b.m_bMouseOver]).toEqual([null, false]);
    d.setShow(false);
    expect(d.m_bShow).toBe(false);
  });

  test("a dialog that is not modal and has a manager makes the manager count the dialogs again when it is shown", () => {
    const { w, d } = scene();
    const manager = new CKTDGUIDialogManager(w);
    d.m_bModal = false;
    d.m_bShow = true;
    manager.addDlg(d);
    expect(manager.m_iModalDialogCount).toBe(1);
    d.setShow(false);
    expect(manager.m_iModalDialogCount).toBe(0);
    d.setShow(true);
    expect(manager.m_iModalDialogCount).toBe(1);
  });
});
