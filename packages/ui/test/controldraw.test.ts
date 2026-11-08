/**
 * The drawing of the controls after the static and the button: `CKTDXDeviceTexture::Draw` and the edges that use it (the static's, the
 * button's and the radio button's), and `OnFrameRender` of the radio button, the check box, the slider, the navigation, the control list and
 * the scroll bar.  The device is a recorder (test/rig.ts: the layout of 1024 x 768 is scaled by (1.5, 2)); every expected number is worked
 * out by hand from the decompile of x2.exe, the comments show the arithmetic.
 *
 * A dialog sits at (10.25, 20.5), so the corner of a quad at layout (x, y) is ((10.25 + x) * 1.5, (20.5 + y) * 2) cut to whole pixels and
 * moved half a pixel up and left.  A bar of an edge is a `CKTDXDeviceTexture::Draw(nX, nY, nWidth, nHeight)`: from (1.5 * nX - 0.5, 2 * nY - 0.5)
 * to (1.5 * nWidth + 1.5 * nX, 2 * nHeight + 2 * nY) (the right and bottom sides without the half pixel).
 */
import { describe, expect, test } from "bun:test";
import {
  ARROWSTATE, CKTDGUIButton, CKTDGUICheckBox, CKTDGUIContolList, CKTDGUIDialog, CKTDGUINavigation, CKTDGUIRadioButton, CKTDGUIScrollBar,
  CKTDGUISlider, CKTDGUIStatic, CPictureData, DeviceTexture, RSI_DEVICE_TEXTURE, UIPointData,
} from "../src/index.ts";
import type { UITextureData } from "../src/index.ts";
import { Recorder, quad, rig } from "./rig.ts";

interface Vertex { x: number; y: number; color: number; u: number; v: number }

/**
 * the quads drawn since the log was cleared (`count` of them: a quad drawn several times counts once), four vertices each, in the order
 * they were drawn; the dynamic buffer of the vertex type 3 (the buffer 12) holds each at the vertex its `draw` names
 */
function quadsOf(dev: Recorder, count: number): Vertex[][] {
  const starts: number[] = [];
  for (const line of dev.log) {
    const m = /^draw 5 (\d+) 2$/.exec(line);
    if (m && starts[starts.length - 1] !== Number(m[1])) starts.push(Number(m[1]));
  }
  expect(starts.length).toBe(count);
  const bytes = dev.vbs[12]!.data;
  const f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length >> 2);
  const u = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >> 2);
  return starts.map((start) => [0, 1, 2, 3].map((i) => {
    const o = (start + i) * 7;
    return { x: f[o]!, y: f[o + 1]!, color: u[o + 4]!, u: f[o + 5]!, v: f[o + 6]! };
  }));
}

/** [left, top, right, bottom] of a control's quad (vertices: left-top, right-top, left-bottom, right-bottom) */
const uiBox = (q: Vertex[]) => [q[0]!.x, q[0]!.y, q[1]!.x, q[2]!.y];
/** [left, top, right, bottom] of the quad of `CKTDXDeviceTexture::Draw` (vertices: left-top, left-bottom, right-top, right-bottom) */
const drawBox = (q: Vertex[]) => [q[0]!.x, q[0]!.y, q[2]!.x, q[3]!.y];

/** the textures set on stage 0, in order */
const texturesSet = (dev: Recorder) => dev.log.filter((l) => l.startsWith("tex 0 ")).map((l) => l.slice(6));
const draws = (dev: Recorder) => dev.log.filter((l) => l.startsWith("draw ")).length;

/** the device calls of one `Draw` from the baseline: akRSICKTDXDeviceTexture pushed (only what differs from the baseline reaches the device) and popped */
const DRAW_PUSH = ["rs 25 6", "rs 27 1", "rs 7 0", "rs 14 0", "rs 22 2", "tss 0 4 4", "tss 0 5 0", "tss 0 6 2"];
const DRAW_POP = ["tss 0 6 1", "tss 0 5 2", "tss 0 4 2", "rs 22 3", "rs 14 1", "rs 7 1", "rs 27 0", "rs 25 8"];

describe("akRSICKTDXDeviceTexture and CKTDXDeviceTexture.draw (329675F0)", () => {
  test("the table, as numbers (x2.exe.c L140832): [type, stage, state, value]", () => {
    expect(RSI_DEVICE_TEXTURE.map((s) => [s.m_eType, s.m_dwStage, s.m_dwType, s.m_dwValue])).toEqual([
      [0, 0, 15, 1], [0, 0, 25, 6], [0, 0, 24, 0], // alpha test on, not equal to 0
      [0, 0, 27, 1], [0, 0, 19, 5], [0, 0, 20, 6], // alpha blend SRCALPHA / INVSRCALPHA
      [0, 0, 7, 0], [0, 0, 14, 0], [0, 0, 22, 2], // no z test, no z write, cull clockwise
      [1, 0, 4, 4], [1, 0, 5, 0], [1, 0, 6, 2], // stage alpha: modulate (diffuse, texture)
    ]);
  });

  test("the quad: left / top = scale * n - 0.5, right / bottom = scale * size + scale * n; left-top, left-bottom, right-top, right-bottom; z = rhw = 1", () => {
    const { w, dev } = rig();
    const t = w.devices.openTexture("E.TGA")!;
    t.draw(w.render!, 10, 20, 30, 8, 0x80ff4020, 0);
    // x = 1.5 * 10 = 15 -> left 14.5, right 1.5 * 30 + 15 = 60; y = 2 * 20 = 40 -> top 39.5, bottom 2 * 8 + 40 = 56
    expect(dev.log).toEqual([...DRAW_PUSH, "tex 0 E.TGA", "fvf 324", "src 12 28", "draw 5 0 2", ...DRAW_POP]);
    const f = new Float32Array(dev.vbs[12]!.data.buffer, 0, 28);
    const u = new Uint32Array(dev.vbs[12]!.data.buffer, 0, 28);
    const v = [0, 1, 2, 3].map((i) => [f[i * 7], f[i * 7 + 1], f[i * 7 + 2], f[i * 7 + 3], u[i * 7 + 4], f[i * 7 + 5], f[i * 7 + 6]]);
    expect(v).toEqual([
      [14.5, 39.5, 1, 1, 0x80ff4020, 0, 0],
      [14.5, 56, 1, 1, 0x80ff4020, 0, 1],
      [60, 39.5, 1, 1, 0x80ff4020, 1, 0],
      [60, 56, 1, 1, 0x80ff4020, 1, 1],
    ]);
    expect(w.render!.states.stackPointer).toBe(0);
  });

  test("nothing is cut to whole pixels: scale (1.25, 0.9375), Draw(3, 5, 7, 9) -> 3.25, 4.1875 .. 12.5, 13.125", () => {
    const { w, dev } = rig({ backBuffer: { width: 1280, height: 720 } });
    // x = 1.25 * 3 = 3.75 -> left 3.25, right 1.25 * 7 + 3.75 = 12.5; y = 0.9375 * 5 = 4.6875 -> top 4.1875, bottom 0.9375 * 9 + 4.6875 = 13.125
    w.devices.openTexture("E.TGA")!.draw(w.render!, 3, 5, 7, 9, 0xffffffff, 0);
    expect(drawBox(quadsOf(dev, 1)[0]!)).toEqual([3.25, 4.1875, 12.5, 13.125]);
  });

  test("a texture that is not there is error 0x5E and the quad is drawn anyway, with what the stage holds", () => {
    const { w, dev } = rig();
    const t = new DeviceTexture("E.TGA", w.devices.massFiles.log); // no Direct3D texture
    t.draw(w.render!, 0, 0, 1, 1, 0xffffffff, 0);
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x5e, text: "E.TGA" }]);
    expect(texturesSet(dev)).toEqual([]);
    expect(draws(dev)).toBe(1);
  });

  test("the rotated quad is not ported: it throws, and nothing has been drawn or pushed", () => {
    const { w, dev } = rig();
    expect(() => w.devices.openTexture("E.TGA")!.draw(w.render!, 0, 0, 1, 1, 0xffffffff, 45)).toThrow("not ported");
    expect(dev.log).toEqual([]);
    expect(w.render!.states.stackPointer).toBe(0);
  });
});

describe("CKTDGUIStatic.drawEdge (32929090)", () => {
  /** a dialog at (10.25, 20.5) with a static whose picture is the 64 x 32 texture at (10, 20), an edge of width 3 */
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    const control = new CKTDGUIStatic(s.w);
    dialog.AddControl(control);
    const picture = new CPictureData(s.w);
    const ud = s.wrap(picture, "CKTDGUIControl::CPictureData");
    s.m(ud, "SetTex", "P.TGA", "K");
    s.m(ud, "SetPoint", s.point(10, 20));
    control.AddPicture(picture);
    picture.m_EdgeWidth = 3;
    return { ...s, dialog, control, picture };
  }

  // x of the left corners: (10.25 + 10) = 20.25; of the right ones 10.25 + 74 = 84.25; y of the top ones: 20.5 + 20 = 40.5, of the bottom ones 20.5 + 52 = 72.5
  const OUTSIDE = [
    // (17, 37, 3, 35), (17, 72, 67, 3), (84, 40, 3, 35), (20, 37, 67, 3): the bars go round the picture like a pinwheel
    [25, 73.5, 30, 144], [25, 143.5, 126, 150], [125.5, 79.5, 130.5, 150], [29.5, 73.5, 130.5, 80],
  ];
  const INSIDE = [
    // (20, 40, 3, 32), (20, 69, 64, 3), (81, 40, 3, 32), (20, 40, 64, 3): on the edge of the picture, the corners twice
    [29.5, 79.5, 34.5, 144], [29.5, 137.5, 126, 144], [121, 79.5, 126, 144], [29.5, 79.5, 126, 86],
  ];
  const PICTURE = [29.5, 80.5, 125.5, 144.5];

  test("outside: the edge before the picture and again after it (the picture's own m_bDrawEdgeOut is used both times)", () => {
    const { control, dev, picture } = scene();
    expect(picture.m_bDrawEdgeOut).toBe(true);
    control.onFrameRender();
    const q = quadsOf(dev, 9);
    expect(q.map((x, i) => (i === 4 ? uiBox(x) : drawBox(x)))).toEqual([...OUTSIDE, PICTURE, ...OUTSIDE]);
    expect(texturesSet(dev)).toEqual(["UIEDGE.TGA", "P.TGA", "UIEDGE.TGA"]);
    expect(draws(dev)).toBe(9);
    // every bar: white, the whole texture
    expect(q[0]!.map((v) => [v.color, v.u, v.v])).toEqual([[0xffffffff, 0, 0], [0xffffffff, 0, 1], [0xffffffff, 1, 0], [0xffffffff, 1, 1]]);
  });

  test("inside: the bars lie on the picture", () => {
    const { control, dev, picture } = scene();
    picture.m_bDrawEdgeOut = false;
    control.onFrameRender();
    expect(quadsOf(dev, 9).map((x, i) => (i === 4 ? uiBox(x) : drawBox(x)))).toEqual([...INSIDE, PICTURE, ...INSIDE]);
  });

  test("the colour of a bar is the dialog's times the edge colour times the control's, per channel, (int)(c * 255 + 0.5)", () => {
    const { control, dev, dialog, picture } = scene();
    dialog.m_Color.set(0.625, 0.5, 0.75, 0.5); // r g b a
    picture.m_EdgeColor.set(0.5, 0.25, 0.625, 0.75);
    control.m_Color.set(0.75, 0.5, 0.875, 0.5);
    control.drawEdge(true, 3, picture.m_EdgeColor, picture.pPoint);
    // a = 0.5 * 0.75 * 0.5 = 0.1875 -> 47.8125 + 0.5 -> 48 = 0x30; r = 0.625 * 0.5 * 0.75 = 0.234375 -> 59.77 + 0.5 -> 60 = 0x3c;
    // g = 0.5 * 0.25 * 0.5 = 0.0625 -> 15.94 + 0.5 -> 16 = 0x10; b = 0.75 * 0.625 * 0.875 = 0.41015625 -> 104.59 + 0.5 -> 105 = 0x69
    expect(quadsOf(dev, 4).map((q) => q.map((v) => v.color))).toEqual(new Array(4).fill(new Array(4).fill(0x303c1069)));
  });

  test("the offset of the control moves the bars: (2, 4) -> X(lt) = 22.25, X(rt) = 86.25, Y(lt) = 44.5, Y(lb) = 76.5", () => {
    const { control, dev } = scene();
    control.m_OffsetPos.set(2, 4);
    control.onFrameRender();
    // (ftoi(19.25), ftoi(41.5), 3, 35) = (19, 41, 3, 35); (19, 76, 67, 3); (86, 44, 3, 35); (22, 41, 67, 3)
    const q = quadsOf(dev, 9);
    expect(q.slice(0, 4).map(drawBox)).toEqual([[28, 81.5, 33, 152], [28, 151.5, 129, 158], [128.5, 87.5, 133.5, 158], [32.5, 81.5, 133.5, 88]]);
    // the picture moves with the offset, too: x (10.25 + 2 + 10) * 1.5 = 33.375 -> 32.5, y (20.5 + 4 + 20) * 2 = 89 -> 88.5
    expect([uiBox(q[4]!)[0], uiBox(q[4]!)[1]]).toEqual([32.5, 88.5]);
  });

  test("a width of 0, no edge texture or no point: nothing", () => {
    const { control, dev, picture } = scene();
    const point = picture.pPoint!;
    control.drawEdge(true, 0, picture.m_EdgeColor, point);
    control.drawEdge(true, 3, picture.m_EdgeColor, null);
    (control as unknown as { m_pEdgeTexture: undefined }).m_pEdgeTexture = undefined;
    control.drawEdge(true, 3, picture.m_EdgeColor, point);
    expect(dev.log).toEqual([]);
  });

  test("the width of the quad is the right-top corner's distance from the left-top one (the radio button takes the right-bottom corner's)", () => {
    const { control, dev, picture } = scene();
    const p = new UIPointData();
    p.leftTopPoint.set(10, 20);
    p.rightTopPoint.set(74, 20); // 64 wide here ...
    p.leftBottomPoint.set(10, 52);
    p.rightBottomPoint.set(90, 52); // ... and 80 wide here
    control.drawEdge(false, 3, picture.m_EdgeColor, p);
    // the bottom bar is nWidth wide: Draw(20, 69, 64, 3): right = 1.5 * 64 + 30 = 126
    expect(drawBox(quadsOf(dev, 4)[1]!)).toEqual([29.5, 137.5, 126, 144]);
  });
});

describe("CKTDGUIButton.drawEdge (3292D750)", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    const b = new CKTDGUIButton(s.w);
    dialog.AddControl(b);
    const ud = s.wrap(b, "CKTDGUIButton");
    s.m(ud, "SetNormalTex", "B.TGA", "N");
    s.m(ud, "SetNormalPoint", s.point(10, 20));
    // the edge point of the button: the 64 x 32 quad at (10, 20)
    const e = b.m_edgePoint;
    e.leftTopPoint.set(10, 20);
    e.rightTopPoint.set(74, 20);
    e.leftBottomPoint.set(10, 52);
    e.rightBottomPoint.set(74, 52);
    b.m_EdgeWidth = 3;
    b.m_EdgeEnlargeValue = 2;
    b.m_bHasFocus = true;
    return { ...s, dialog, b };
  }

  // width W = 3, enlargement E = 2, v45 = 64, v46 = 32; X(lt) = 20.25, X(rt) = 84.25, Y(lt) = 40.5, Y(lb) = 72.5
  const OUTSIDE = [
    // (ftoi(17.25) - 2, ftoi(37.5) - 2, 3, 32 + 3 + 4) = (15, 35, 3, 39); (15, 2 + 72, 64 + 2 + 3, 3) = (15, 74, 69, 3);
    // (2 + 84, 40, 3, 32 + 2 + 3) = (86, 40, 3, 37); (20, 35, 64 + 3 + 4, 3) = (20, 35, 71, 3)
    [22, 69.5, 27, 148], [22, 147.5, 126, 154], [128.5, 79.5, 133.5, 154], [29.5, 69.5, 136.5, 76],
  ];
  const INSIDE = [
    // (20 - 2, 40 - 2, 3, 32 + 4) = (18, 38, 3, 36); (18, 2 + ftoi(69.5), 2 + 64, 3) = (18, 71, 66, 3);
    // (2 + ftoi(81.25), 40, 3, 2 + 32) = (83, 40, 3, 34); (20, 38, 64 + 4, 3) = (20, 38, 68, 3)
    [26.5, 75.5, 31.5, 148], [26.5, 141.5, 126, 148], [124, 79.5, 129, 148], [29.5, 75.5, 132, 82],
  ];

  test("a button with the focus and an edge: the bars outside, the quad, the bars inside, all pushed out by the enlargement", () => {
    const { b, dev } = scene();
    b.onFrameRender();
    // the quad of the button: 10 -> (10.25 + 10) * 1.5 = 30.375 -> 29.5 .. 125.5, 80.5 .. 144.5
    expect(quadsOf(dev, 9).map((x, i) => (i === 4 ? uiBox(x) : drawBox(x)))).toEqual([...OUTSIDE, [29.5, 80.5, 125.5, 144.5], ...INSIDE]);
    expect(texturesSet(dev)).toEqual(["UIEDGE.TGA", "B.TGA", "UIEDGE.TGA"]);
  });

  test("no edge without the focus, or with a width of 0 or less; drawEdge itself needs a width and the texture", () => {
    const { b, dev } = scene();
    b.m_bHasFocus = false;
    b.onFrameRender();
    expect(draws(dev)).toBe(1);
    dev.log.length = 0;
    b.m_bHasFocus = true;
    b.m_EdgeWidth = -1;
    b.onFrameRender();
    expect(draws(dev)).toBe(1); // only the quad
    dev.log.length = 0;
    b.m_EdgeWidth = 0;
    b.drawEdge(true);
    expect(dev.log).toEqual([]);
  });

  test("the colour is the edge colour of the button, times the dialog's and the button's, per channel", () => {
    const { b, dev, dialog } = scene();
    dialog.m_Color.set(0.625, 0.5, 0.75, 0.5); // r g b a
    b.m_EdgeColor.set(0.5, 0.25, 0.625, 0.75);
    b.m_Color.set(0.75, 0.5, 0.875, 0.5);
    b.drawEdge(true);
    // the same sums as the static's: a 0x30, r 0x3c, g 0x10, b 0x69
    expect(quadsOf(dev, 4).map((q) => q.map((v) => v.color))).toEqual(new Array(4).fill(new Array(4).fill(0x303c1069)));
  });

  test("the offset of the button moves the bars (2, 4): X(lt) = 22.25, X(rt) = 86.25, Y(lt) = 44.5, Y(lb) = 76.5", () => {
    const { b, dev } = scene();
    b.m_OffsetPos.set(2, 4);
    b.drawEdge(true);
    // (ftoi(19.25) - 2, ftoi(41.5) - 2, 3, 39) = (17, 39, 3, 39); (17, 2 + 76, 69, 3); (2 + 86, 44, 3, 37); (22, 39, 71, 3)
    expect(quadsOf(dev, 4).map(drawBox)).toEqual([[25, 77.5, 30, 156], [25, 155.5, 129, 162], [131.5, 87.5, 136.5, 162], [32.5, 77.5, 139.5, 84]]);
  });

  test("the size of the quad is the right-bottom corner's distance from the left-top one; the other corners only place the bars", () => {
    const { b, dev } = scene();
    const e = b.m_edgePoint;
    e.rightTopPoint.set(70, 20); // X(rt) = 80.25 -> 80
    e.leftBottomPoint.set(10, 50); // Y(lb) = 70.5 -> 70
    b.drawEdge(true);
    // the bars 2 and 3 move: (15, 2 + 70, 69, 3) and (2 + 80, 40, 3, 37); the size (64 x 32) is the same
    expect(quadsOf(dev, 4).map(drawBox)).toEqual([[22, 69.5, 27, 148], [22, 143.5, 126, 150], [122.5, 79.5, 127.5, 154], [29.5, 69.5, 136.5, 76]]);
  });
});

describe("CKTDGUIRadioButton.onFrameRender (3294AE80) and drawCheckedEdge (32949850)", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    const r = new CKTDGUIRadioButton(s.w);
    dialog.AddControl(r);
    r.m_MyNowPoint.assign(quad(s.w, 10, 20, "BG.TGA"));
    r.m_pCheckedPoint = quad(s.w, 100, 120, "CHK.TGA");
    return { ...s, dialog, r };
  }
  const BG = [29.5, 80.5, 125.5, 144.5];
  // the checked point at (100, 120): x (110.25 * 1.5 = 165.375 -> 164.5, 174.25 * 1.5 = 261.375 -> 260.5), y (140.5 * 2 = 281 -> 280.5, 172.5 * 2 = 345 -> 344.5)
  const CHECKED = [164.5, 280.5, 260.5, 344.5];
  // the edge goes round the point of the background, 3 wide: the same bars as the static's
  const OUTSIDE = [[25, 73.5, 30, 144], [25, 143.5, 126, 150], [125.5, 79.5, 130.5, 150], [29.5, 73.5, 130.5, 80]];
  const INSIDE = [[29.5, 79.5, 34.5, 144], [29.5, 137.5, 126, 144], [121, 79.5, 126, 144], [29.5, 79.5, 126, 86]];

  test("an unchecked button draws the quad of its own point and nothing else", () => {
    const { r, dev } = scene();
    expect(r.onFrameRender()).toBe(0);
    expect(quadsOf(dev, 1).map(uiBox)).toEqual([BG]);
    expect(draws(dev)).toBe(1);
    expect(texturesSet(dev)).toEqual(["BG.TGA"]);
  });

  test("a checked button draws the background and then the quad of the check point", () => {
    const { r, dev } = scene();
    r.m_bChecked = true;
    r.onFrameRender();
    expect(quadsOf(dev, 2).map(uiBox)).toEqual([BG, CHECKED]);
    expect(texturesSet(dev)).toEqual(["BG.TGA", "CHK.TGA"]);
  });

  test("m_bShowOffBGByCheck: a checked button does not draw the background", () => {
    const { r, dev } = scene();
    r.m_bChecked = true;
    r.m_bShowOffBGByCheck = true;
    r.onFrameRender();
    expect(quadsOf(dev, 1).map(uiBox)).toEqual([CHECKED]);
    expect(draws(dev)).toBe(1);
    // unchecked, the flag changes nothing
    dev.log.length = 0;
    r.m_bChecked = false;
    r.onFrameRender();
    expect(quadsOf(dev, 1).map(uiBox)).toEqual([BG]);
  });

  test("a checked button with an edge: the bars outside, the background, the bars inside, the check point", () => {
    const { r, dev } = scene();
    r.m_bChecked = true;
    r.m_CheckedEdgeWidth = 3;
    r.onFrameRender();
    const q = quadsOf(dev, 10);
    expect(q.map((x, i) => (i === 4 || i === 9 ? uiBox(x) : drawBox(x)))).toEqual([...OUTSIDE, BG, ...INSIDE, CHECKED]);
    expect(texturesSet(dev)).toEqual(["UIEDGE.TGA", "BG.TGA", "UIEDGE.TGA", "CHK.TGA"]);
  });

  test("with the background off the edge is still drawn, twice, round and on the point of the background", () => {
    const { r, dev } = scene();
    r.m_bChecked = true;
    r.m_bShowOffBGByCheck = true;
    r.m_CheckedEdgeWidth = 3;
    r.onFrameRender();
    expect(quadsOf(dev, 9).map((x, i) => (i === 8 ? uiBox(x) : drawBox(x)))).toEqual([...OUTSIDE, ...INSIDE, CHECKED]);
  });

  test("an unchecked button draws no edge, and the edge needs a width", () => {
    const { r, dev } = scene();
    r.m_CheckedEdgeWidth = 3;
    r.onFrameRender();
    expect(draws(dev)).toBe(1);
    dev.log.length = 0;
    r.m_bChecked = true;
    r.m_CheckedEdgeWidth = 0;
    r.onFrameRender();
    expect(draws(dev)).toBe(2);
  });

  test("the width of the quad is the right-bottom corner's distance from the left-top one (the static takes the right-top corner's)", () => {
    const { r, dev } = scene();
    r.m_CheckedEdgeWidth = 3;
    r.m_MyNowPoint.rightBottomPoint.set(90, 52); // 80 wide at the bottom, 64 wide at the top
    r.drawCheckedEdge(false);
    // the bottom bar is nWidth wide: Draw(20, 69, 80, 3): right = 1.5 * 80 + 30 = 150
    expect(drawBox(quadsOf(dev, 4)[1]!)).toEqual([29.5, 137.5, 150, 144]);
  });

  test("a hidden button draws nothing; a checked one without a check point is the exe's null dereference (the string is stringdraw.test.ts)", () => {
    const { r, dev } = scene();
    r.m_bShow = false;
    r.onFrameRender();
    expect(dev.log).toEqual([]);
    r.m_bShow = true;
    r.m_bChecked = true;
    r.m_pCheckedPoint = null;
    expect(() => r.onFrameRender()).toThrow("no check point");
  });
});

describe("CKTDGUICheckBox.onFrameRender (32931A90)", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    const c = new CKTDGUICheckBox(s.w);
    dialog.AddControl(c);
    c.m_NowPoint.assign(quad(s.w, 10, 20, "BG.TGA"));
    c.m_pCheckedPoint = quad(s.w, 100, 120, "CHK.TGA");
    return { ...s, dialog, c };
  }
  const BG = [29.5, 80.5, 125.5, 144.5];
  const CHECKED = [164.5, 280.5, 260.5, 344.5];

  test("unchecked: the quad of the current point; checked: that and then the quad of the check point", () => {
    const { c, dev } = scene();
    expect(c.onFrameRender()).toBe(0);
    expect(quadsOf(dev, 1).map(uiBox)).toEqual([BG]);
    expect(draws(dev)).toBe(1);
    dev.log.length = 0;
    c.m_bChecked = true;
    c.onFrameRender();
    expect(quadsOf(dev, 2).map(uiBox)).toEqual([BG, CHECKED]);
    expect(texturesSet(dev)).toEqual(["CHK.TGA"]); // the background texture is on stage 0 already
  });

  test("an empty background when checked: only the check point is drawn", () => {
    const { c, dev } = scene();
    c.m_bChecked = true;
    c.m_bEmptyBGWhenChecked = true;
    c.onFrameRender();
    expect(quadsOf(dev, 1).map(uiBox)).toEqual([CHECKED]);
    expect(draws(dev)).toBe(1);
    dev.log.length = 0;
    c.m_bChecked = false; // unchecked it is drawn
    c.onFrameRender();
    expect(quadsOf(dev, 1).map(uiBox)).toEqual([BG]);
  });

  test("a hidden box draws nothing; a checked box without a check point is the exe's null dereference", () => {
    const { c, dev } = scene();
    c.m_bShow = false;
    c.onFrameRender();
    expect(dev.log).toEqual([]);
    c.m_bShow = true;
    c.m_bChecked = true;
    c.m_pCheckedPoint = null;
    expect(() => c.onFrameRender()).toThrow("no check point");
  });
});

describe("CKTDGUISlider.onFrameRender (3294CD20)", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    const slider = new CKTDGUISlider(s.w);
    dialog.AddControl(slider);
    Object.assign(slider.m_rcBoundingBox, { left: 10, top: 20, right: 74, bottom: 52 });
    Object.assign(slider.m_rcButton, { left: 30, top: 22, right: 46, bottom: 50 });
    const bg = quad(s.w, 0, 0, "SBG.TGA").pUITextureData!;
    const button = quad(s.w, 0, 0, "SBTN.TGA").pUITextureData!;
    return { ...s, dialog, slider, bg, button };
  }
  const BOUNDING = [29.5, 80.5, 125.5, 144.5];
  // the button: x (40.25 * 1.5 = 60.375 -> 59.5, 56.25 * 1.5 = 84.375 -> 83.5), y (42.5 * 2 = 85 -> 84.5, 70.5 * 2 = 141 -> 140.5)
  const BUTTON = [59.5, 84.5, 83.5, 140.5];

  test("the bounding box with the background texture, then the button's rectangle with the button texture; the UVs are the textures'", () => {
    const { slider, dev, bg, button } = scene();
    slider.m_pBGTex = bg;
    slider.m_pButtonTex = button;
    expect(slider.onFrameRender()).toBe(0);
    const q = quadsOf(dev, 2);
    expect(q.map(uiBox)).toEqual([BOUNDING, BUTTON]);
    expect(texturesSet(dev)).toEqual(["SBG.TGA", "SBTN.TGA"]);
    expect(q[0]!.map((v) => [v.u, v.v])).toEqual([[0, 0], [1, 0], [0, 0.5], [1, 0.5]]);
  });

  test("the scratch point keeps the texture it had: without a background texture the first frame draws only the button, the second the bounding box with the button's texture", () => {
    const { slider, dev, button } = scene();
    slider.m_pButtonTex = button;
    slider.onFrameRender();
    expect(draws(dev)).toBe(1);
    expect(quadsOf(dev, 1).map(uiBox)).toEqual([BUTTON]);
    dev.log.length = 0;
    slider.onFrameRender();
    expect(draws(dev)).toBe(2);
    expect(quadsOf(dev, 2).map(uiBox)).toEqual([BOUNDING, BUTTON]);
    expect(texturesSet(dev)).toEqual([]); // SBTN.TGA is on stage 0 already
  });

  test("a hidden slider draws nothing", () => {
    const { slider, dev, bg } = scene();
    slider.m_pBGTex = bg;
    slider.m_bShow = false;
    slider.onFrameRender();
    expect(dev.log).toEqual([]);
  });
});

describe("CKTDGUINavigation.onFrameRender (3294E560)", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    const nav = new CKTDGUINavigation(s.w);
    dialog.AddControl(nav);
    nav.m_pBGTex = quad(s.w, 0, 0, "NBG.TGA").pUITextureData;
    nav.m_pBGPoint = quad(s.w, 10, 20, "OTHER.TGA");
    nav.m_pWindowTex = quad(s.w, 0, 0, "NWIN.TGA").pUITextureData;
    nav.m_pWindowPoint = quad(s.w, 100, 120, "OTHER.TGA");
    return { ...s, dialog, nav };
  }

  test("the background and then the window, each point is given its texture just before it is drawn", () => {
    const { nav, dev } = scene();
    expect(nav.onFrameRender()).toBe(0);
    expect(quadsOf(dev, 2).map(uiBox)).toEqual([[29.5, 80.5, 125.5, 144.5], [164.5, 280.5, 260.5, 344.5]]);
    expect(texturesSet(dev)).toEqual(["NBG.TGA", "NWIN.TGA"]);
    expect(nav.m_pBGPoint!.pUITextureData === nav.m_pBGTex).toBe(true);
    expect(nav.m_pWindowPoint!.pUITextureData === nav.m_pWindowTex).toBe(true);
  });

  test("a quad is skipped when its texture or its point is missing; a hidden control draws nothing", () => {
    const { nav, dev } = scene();
    const kept = nav.m_pBGPoint!.pUITextureData;
    nav.m_pBGTex = null;
    nav.onFrameRender();
    expect(texturesSet(dev)).toEqual(["NWIN.TGA"]);
    expect(nav.m_pBGPoint!.pUITextureData === kept).toBe(true); // a point is given a texture only when there is one
    dev.log.length = 0;
    nav.m_pBGTex = quad(nav["ctx"] as never, 0, 0, "NBG.TGA").pUITextureData;
    nav.m_pWindowPoint = null;
    nav.onFrameRender();
    expect(texturesSet(dev)).toEqual(["NBG.TGA"]);
    expect(draws(dev)).toBe(1);
    dev.log.length = 0;
    nav.m_bShow = false;
    nav.onFrameRender();
    expect(dev.log).toEqual([]);
  });
});

describe("CKTDGUIScrollBar.onFrameRender (32985EE0) and CKTDGUIContolList.onFrameRender (3294FD90)", () => {
  /** a bar at (10, 20), 16 wide and 64 high, in the dialog at (10.25, 20.5), a range of 0..10 in pages of 2, with all six textures */
  function bar(s: ReturnType<typeof rig>, dialog: CKTDGUIDialog, x = 10, y = 20, tag = "") {
    const b = new CKTDGUIScrollBar(s.w);
    dialog.AddControl(b);
    b.m_x = x;
    b.m_y = y;
    b.m_width = 16;
    b.m_height = 64;
    b.updateRects();
    b.setTrackRange(0, 10);
    b.m_nPageSize = 2;
    b.updateThumbRect();
    const tex = (name: string): UITextureData => quad(s.w, 0, 0, name + tag).pUITextureData!;
    b.m_pTrackTex = tex("TRK");
    b.m_pUpButtonTex = tex("UP");
    b.m_pUpButtonDownTex = tex("UPD");
    b.m_pDownButtonTex = tex("DN");
    b.m_pDownButtonDownTex = tex("DND");
    b.m_pThumbTex = tex("THB");
    return b;
  }
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    return { ...s, dialog, b: bar(s, dialog) };
  }
  // the rectangles (UpdateRects 329866A0): bounding (10, 20, 26, 84); up (10, 20, 26, 36); down (10, 10 + 84 - 26 = 68, 26, 84); track (10, 36, 26, 68);
  // the thumb (UpdateThumbRect): 2 * 32 / 10 = 6, at least 8, at the top: (10, 36, 26, 44)
  // x: (20.25 * 1.5 = 30.375 -> 29.5, 36.25 * 1.5 = 54.375 -> 53.5); y: 40.5 * 2 = 81 -> 80.5, 56.5 * 2 = 113 -> 112.5, 64.5 * 2 = 129 -> 128.5, 88.5 * 2 = 177 -> 176.5, 104.5 * 2 = 209 -> 208.5
  const TRACK = [29.5, 112.5, 53.5, 176.5];
  const UP = [29.5, 80.5, 53.5, 112.5];
  const DOWN = [29.5, 176.5, 53.5, 208.5];
  const THUMB = [29.5, 112.5, 53.5, 128.5];

  test("the rectangles the drawing uses", () => {
    const { b } = scene();
    const r = (c: { left: number; top: number; right: number; bottom: number }) => [c.left, c.top, c.right, c.bottom];
    expect([r(b.m_rcUpButton), r(b.m_rcDownButton), r(b.m_rcTrack), r(b.m_rcThumb), b.m_bShowThumb]).toEqual([
      [10, 20, 26, 36], [10, 68, 26, 84], [10, 36, 26, 68], [10, 36, 26, 44], true,
    ]);
  });

  test("the track, the up button, the down button and the thumb, in that order, each with its texture", () => {
    const { b, dev } = scene();
    expect(b.onFrameRender()).toBe(0);
    expect(quadsOf(dev, 4).map(uiBox)).toEqual([TRACK, UP, DOWN, THUMB]);
    expect(texturesSet(dev)).toEqual(["TRK", "UP", "DN", "THB"]);
  });

  test("a clicked button shows its pressed texture, the normal one when there is no pressed texture", () => {
    const { b, dev } = scene();
    b.m_bIsUpButtonClicked = true;
    b.m_bIsDownButtonClicked = true;
    b.onFrameRender();
    expect(texturesSet(dev)).toEqual(["TRK", "UPD", "DND", "THB"]);
    dev.log.length = 0;
    b.m_pUpButtonDownTex = null;
    b.onFrameRender();
    expect(texturesSet(dev)).toEqual(["TRK", "UP", "DND", "THB"]);
  });

  test("m_bEnableTrack, m_bEnableThumb and m_bShowThumb switch the track and the thumb off; a part without a texture is not drawn", () => {
    const { b, dev } = scene();
    b.SetEnableTrack(false);
    b.onFrameRender();
    expect(quadsOf(dev, 3).map(uiBox)).toEqual([UP, DOWN, THUMB]);
    dev.log.length = 0;
    b.SetEnableTrack(true);
    b.SetEnableThumb(false);
    b.onFrameRender();
    expect(quadsOf(dev, 3).map(uiBox)).toEqual([TRACK, UP, DOWN]);
    dev.log.length = 0;
    b.SetEnableThumb(true);
    b.m_bShowThumb = false;
    b.m_pTrackTex = null;
    b.m_pDownButtonTex = null;
    b.m_pDownButtonDownTex = null;
    b.onFrameRender();
    expect(quadsOf(dev, 1).map(uiBox)).toEqual([UP]);
    expect(draws(dev)).toBe(1);
  });

  test("a hidden bar draws nothing", () => {
    const { b, dev } = scene();
    b.m_bShow = false;
    b.onFrameRender();
    expect(dev.log).toEqual([]);
  });

  describe("a held arrow scrolls again (DXUT's CDXUTScrollBar::Render)", () => {
    function held(arrow: number, mouse: [number, number], since: number) {
      const s = scene();
      s.b.m_nPosition = 5;
      s.b.m_Arrow = arrow;
      s.b.m_LastMouse.x = mouse[0];
      s.b.m_LastMouse.y = mouse[1];
      s.b.m_dArrowTS = since;
      let now = 0;
      s.w.devices.absoluteTime = () => now;
      return { ...s, at: (t: number) => { now = t; s.b.onFrameRender(); return [s.b.m_nPosition, s.b.m_Arrow, s.b.m_dArrowTS]; } };
    }

    test("up: a click scrolls after more than 0.33 s and is held; a held arrow scrolls every more than 0.05 s", () => {
      const { at } = held(ARROWSTATE.CLICKED_UP, [12, 25], 0);
      expect(at(0.33)).toEqual([5, ARROWSTATE.CLICKED_UP, 0]); // 0.33 is not more than 0.33
      expect(at(0.34)).toEqual([4, ARROWSTATE.HELD_UP, 0.34]); // Scroll(-1)
      expect(at(0.38)).toEqual([4, ARROWSTATE.HELD_UP, 0.34]); // 0.04
      expect(at(0.4)).toEqual([3, ARROWSTATE.HELD_UP, 0.4]); // 0.06
    });

    test("down: Scroll(1), the same delays", () => {
      const { at } = held(ARROWSTATE.CLICKED_DOWN, [12, 70], 1);
      expect(at(1.2)).toEqual([5, ARROWSTATE.CLICKED_DOWN, 1]);
      expect(at(1.31)).toEqual([5, ARROWSTATE.CLICKED_DOWN, 1]); // 0.31 is less than 0.33
      expect(at(1.5)).toEqual([6, ARROWSTATE.HELD_DOWN, 1.5]);
      expect(at(1.52)).toEqual([6, ARROWSTATE.HELD_DOWN, 1.5]);
      expect(at(1.6)).toEqual([7, ARROWSTATE.HELD_DOWN, 1.6]);
    });

    test("only while the mouse is on the matching button; PtInRect leaves the right and bottom sides out", () => {
      for (const [x, y] of [[40, 25], [12, 50], [26, 25], [12, 36], [9, 25], [12, 19]] as [number, number][]) {
        const { at } = held(ARROWSTATE.HELD_UP, [x, y], 0);
        expect(at(5)).toEqual([5, ARROWSTATE.HELD_UP, 0]);
      }
      for (const [x, y] of [[10, 20], [25, 35]] as [number, number][]) { // the corners that are in
        const { at } = held(ARROWSTATE.HELD_UP, [x, y], 0);
        expect(at(5)).toEqual([4, ARROWSTATE.HELD_UP, 5]);
      }
      // the same for the down button, (10, 68, 26, 84): out on the right, bottom, left, top and above it, in at the corners
      for (const [x, y] of [[40, 70], [12, 50], [26, 70], [12, 84], [9, 70], [12, 67]] as [number, number][]) {
        const { at } = held(ARROWSTATE.HELD_DOWN, [x, y], 0);
        expect(at(5)).toEqual([5, ARROWSTATE.HELD_DOWN, 0]);
      }
      for (const [x, y] of [[10, 68], [25, 83]] as [number, number][]) {
        const { at } = held(ARROWSTATE.HELD_DOWN, [x, y], 0);
        expect(at(5)).toEqual([6, ARROWSTATE.HELD_DOWN, 5]);
      }
    });

    test("an arrow of the other button's kind does nothing: a held down arrow over the up button", () => {
      const { at } = held(ARROWSTATE.HELD_DOWN, [12, 25], 0);
      expect(at(5)).toEqual([5, ARROWSTATE.HELD_DOWN, 0]);
      const { at: clickedDown } = held(ARROWSTATE.CLICKED_DOWN, [12, 25], 0);
      expect(clickedDown(5)).toEqual([5, ARROWSTATE.CLICKED_DOWN, 0]);
      const { at: clickedUp } = held(ARROWSTATE.CLICKED_UP, [12, 70], 0); // the down button's rectangle
      expect(clickedUp(5)).toEqual([5, ARROWSTATE.CLICKED_UP, 0]);
    });

    test("no arrow down (CLEAR): nothing scrolls; a hidden bar does not repeat", () => {
      const { at } = held(ARROWSTATE.CLEAR, [12, 25], 0);
      expect(at(5)).toEqual([5, ARROWSTATE.CLEAR, 0]);
      const hidden = held(ARROWSTATE.HELD_UP, [12, 25], 0);
      hidden.b.m_bShow = false;
      expect(hidden.at(5)).toEqual([5, ARROWSTATE.HELD_UP, 0]);
    });
  });

  describe("the control list draws its two bars", () => {
    function listScene() {
      const s = rig();
      const dialog = new CKTDGUIDialog(s.w);
      dialog.m_Pos.set(10.25, 20.5);
      const list = new CKTDGUIContolList(s.w);
      dialog.AddControl(list);
      const x = bar(s, dialog, 10, 20, "X");
      const y = bar(s, dialog, 100, 120, "Y");
      list.m_pScrollBarX = x;
      list.m_pScrollBarY = y;
      return { ...s, dialog, list, x, y };
    }

    test("the X bar first, then the Y bar", () => {
      const { list, dev } = listScene();
      expect(list.onFrameRender()).toBe(0);
      expect(texturesSet(dev)).toEqual(["TRKX", "UPX", "DNX", "THBX", "TRKY", "UPY", "DNY", "THBY"]);
      expect(draws(dev)).toBe(8);
    });

    test("a hidden list draws neither bar; a bar that is hidden is skipped by itself; a list without bars draws nothing", () => {
      const { list, dev, x, y } = listScene();
      list.m_bShow = false;
      list.onFrameRender();
      expect(dev.log).toEqual([]);
      list.m_bShow = true;
      x.m_bShow = false;
      list.onFrameRender();
      expect(texturesSet(dev)).toEqual(["TRKY", "UPY", "DNY", "THBY"]);
      dev.log.length = 0;
      list.m_pScrollBarX = null;
      list.m_pScrollBarY = null;
      expect(list.onFrameRender()).toBe(0);
      expect(dev.log).toEqual([]);
      void y;
    });
  });
});

describe("the dialog draws these controls (they are no longer counted as undrawn)", () => {
  test("a dialog with one of each, none of them with a point or a texture: nothing is counted and no quad is drawn", () => {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    for (const c of [new CKTDGUIRadioButton(s.w), new CKTDGUICheckBox(s.w), new CKTDGUISlider(s.w), new CKTDGUINavigation(s.w), new CKTDGUIContolList(s.w), new CKTDGUIScrollBar(s.w)]) {
      dialog.AddControl(c);
    }
    dialog.onFrameRender();
    expect([...s.w.render!.undrawn]).toEqual([]);
    expect(draws(s.dev)).toBe(0);
  });
});
