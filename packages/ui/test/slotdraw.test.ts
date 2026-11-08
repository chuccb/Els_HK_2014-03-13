/**
 * The drawing of the slot: `CKTDGUISlot::OnFrameRender` (32952670), `DrawEdge` (32951310), `UpdateDraggingVertex` (329545B0) and
 * `RenderDragSlot` (32952DD0).  Every number is worked out from the decompile by hand.
 *
 * The scene of the first four groups is a world of 1024 x 768 (the layout is not scaled): the dialog is at (10.25, 20.5), the slot has the
 * offset (0.75, 0.25), so a quad at the layout position (x, y) is drawn with its corner at (x + 11, y + 20) (10.25 + 0.75 = 11 and
 * 20.5 + 0.25 = 20.75, cut to a whole pixel) and a 64 x 32 picture covers (x + 11, y + 20) to (x + 75, y + 52).  Every point of the slot
 * has a texture of its own, so a point that is drawn by mistake shows.  The slot's string is the scene of stringspy.ts (font 2, the call
 * of the font is written down).  The last two groups (the dragged slot) use the back buffer of rig.ts (1536 x 1536: the scale is (1.5, 2)).
 */
import { describe, expect, test } from "bun:test";
import { Color } from "@els/host";
import { CKTDGUIDialog, CKTDGUISlot, CPictureData, SCS, VertexUI4 } from "../src/index.ts";
import type { UIContext, UIPointData } from "../src/index.ts";
import { fontWorld } from "./fontworld.ts";
import { drawnCalls, drawnQuads, quad, rig, verts } from "./rig.ts";
import type { Recorder } from "./rig.ts";
import { COLOR, OUTLINE, data, outText, place, spied } from "./stringspy.ts";
import type { Call } from "./stringspy.ts";

type R4 = [number, number, number, number];

/** the pixels of the 64 x 32 quad at the layout position (x, y) in the scene */
const R = (x: number, y: number): R4 => [x + 11, y + 20, x + 75, y + 52];

function scene() {
  const s = fontWorld({}, { device: true, backBuffer: { width: 1024, height: 768 } });
  const { w, dev } = s;
  const calls: Call[] = [];
  spied(dev!, w.fonts, 2, calls);
  const dialog = new CKTDGUIDialog(w);
  const slot = new CKTDGUISlot(w);
  place(dialog, slot);
  slot.m_NowPoint.assign(quad(w, 20, 30, "NOW.TGA"));
  slot.m_EndPoint.assign(quad(w, 21, 31, "END.TGA"));
  slot.m_pNormalPoint = quad(w, 22, 32, "NORMAL.TGA");
  slot.m_pMouseOverPoint = quad(w, 40, 50, "OVER.TGA");
  slot.m_pDraggingPoint = quad(w, 60, 70, "DRAG.TGA");
  slot.m_pStringData = data("Hi");
  dev!.log.length = 0;
  return { ...s, dev: dev!, calls, dialog, slot };
}

/** an additional picture: a 64 x 32 texture at the layout position (x, y) */
function picture(w: UIContext, slot: CKTDGUISlot, key: number, x: number, y: number, texture: string): CPictureData {
  const p = new CPictureData(w);
  const point = quad(w, x, y, texture);
  p.pPoint = point;
  p.pTexture = point.pUITextureData;
  slot.addPicture(key, p);
  return p;
}

/**
 * every strip of two triangles (`draw 5`) the UI drew from `from` on: the texture on stage 0 at the time and the pixels it covers, as
 * [left, top, right, bottom].  A control's quad (left-top, right-top, left-bottom, right-bottom; the vertices are half a pixel up and
 * to the left) and a bar of an edge, which is `CKTDXDeviceTexture::Draw(x, y, width, height)` (left-top, left-bottom, right-top,
 * right-bottom; only the left and top sides are moved half a pixel) are both given as x, y to x + width, y + height.
 */
function strips(dev: Recorder, from = 0): { texture: string; rect: R4 }[] {
  const textures: string[] = [];
  let current = "";
  dev.log.forEach((line, i) => {
    if (line.startsWith("tex 0 ")) current = line.slice(6);
    else if (line.startsWith("draw ") && i >= from) textures.push(current);
  });
  const out: { texture: string; rect: R4 }[] = [];
  drawnCalls(dev, from).forEach((c, i) => {
    if (c.type !== 5) return;
    const [v0, v1, v2, v3] = c.vertices as [number[], number[], number[], number[]];
    const control = v0[0] === v2[0]; // left-top and left-bottom have the same x
    const rect: R4 = control ? [v0[0]! + 0.5, v0[1]! + 0.5, v1[0]! + 0.5, v2[1]! + 0.5] : [v0[0]! + 0.5, v0[1]! + 0.5, v2[0]!, v1[1]!];
    if (control) expect([v0[0] === v2[0], v1[0] === v3[0], v0[1] === v1[1], v2[1] === v3[1]]).toEqual([true, true, true, true]);
    else expect([v0[0] === v1[0], v2[0] === v3[0], v0[1] === v2[1], v1[1] === v3[1]]).toEqual([true, true, true, true]);
    out.push({ texture: textures[i]!, rect });
  });
  return out;
}

const draws = (dev: Recorder) => dev.log.filter((l) => l.startsWith("draw ")).length;

// the bars of an edge 3 wide round and on the 64 x 32 picture at the layout position (10, 20), whose corner is at (21, 40.75): the left
// corners are at x 21, the right ones at x 85; the top ones at y 40.75, the bottom ones at y 72.75.  The outside bars are
// (18, 37, 3, 35), (18, 72, 67, 3), (85, 40, 3, 35), (21, 37, 67, 3); the inside ones (21, 40, 3, 32), (21, 69, 64, 3), (82, 40, 3, 32), (21, 40, 64, 3)
const OUTSIDE: R4[] = [[18, 37, 21, 72], [18, 72, 85, 75], [85, 40, 88, 75], [21, 37, 88, 40]];
const INSIDE: R4[] = [[21, 40, 24, 72], [21, 69, 85, 72], [82, 40, 85, 72], [21, 40, 85, 43]];
const bars = (rects: R4[]) => rects.map((rect) => ({ texture: "UIEDGE.TGA", rect }));

describe("CKTDGUISlot.onFrameRender (32952670): the points", () => {
  test("a shown slot draws the quad of its current point, once; its other points are not drawn", () => {
    const { slot, dev } = scene();
    expect(slot.onFrameRender()).toBe(0);
    expect(drawnQuads(dev)).toEqual([{ texture: "NOW.TGA", rect: R(20, 30) }]);
    // the exe asks for one draw whatever the point's draw count is
    slot.m_NowPoint.m_iDrawCount = 3;
    const from = dev.log.length;
    slot.onFrameRender();
    expect(drawnQuads(dev, from)).toEqual([{ texture: "NOW.TGA", rect: R(20, 30) }]);
  });

  test("a hidden slot draws nothing and says nothing", () => {
    const { slot, dev, calls } = scene();
    slot.m_bShow = false;
    expect(slot.onFrameRender()).toBe(0);
    expect(dev.log).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("the mouse over point is drawn on top of the current one while the mouse is over an enabled slot that is not being dragged", () => {
    const { slot, dev } = scene();
    slot.m_bMouseOver = true;
    slot.onFrameRender();
    expect(drawnQuads(dev)).toEqual([{ texture: "NOW.TGA", rect: R(20, 30) }, { texture: "OVER.TGA", rect: R(40, 50) }]);
    // both quads are made by `UpdateVertex`: their colour is the dialog's times the point's times the slot's (0x8f737345, as the edges below)
    expect(drawnCalls(dev).map((c) => c.vertices.map((v) => v[4]))).toEqual([new Array(4).fill(0x8f737345), new Array(4).fill(0x8f737345)]);
  });

  test("... but not without the mouse, not while it is dragged and not when it is disabled", () => {
    const off = scene();
    off.slot.onFrameRender();
    expect(drawnQuads(off.dev).map((q) => q.texture)).toEqual(["NOW.TGA"]);
    const dragged = scene();
    dragged.slot.m_bMouseOver = true;
    dragged.slot.m_eControlState = SCS.ONDRAG;
    dragged.slot.onFrameRender();
    expect(drawnQuads(dragged.dev).map((q) => q.texture)).toEqual(["NOW.TGA"]);
    const disabled = scene();
    disabled.slot.m_bMouseOver = true;
    disabled.slot.m_bEnable = false;
    disabled.slot.onFrameRender();
    expect(drawnQuads(disabled.dev).map((q) => q.texture)).toEqual(["NOW.TGA"]);
  });

  test("only the dragged state keeps the mouse over point away: every other state draws it", () => {
    for (const state of [SCS.NORMAL, SCS.DOWN, SCS.MOUSEOVER, SCS.DISABLE]) {
      const { slot, dev } = scene();
      slot.m_bMouseOver = true;
      slot.m_eControlState = state;
      slot.onFrameRender();
      expect(drawnQuads(dev).map((q) => q.texture)).toEqual(["NOW.TGA", "OVER.TGA"]);
    }
    const { slot, dev } = scene();
    slot.m_bMouseOver = true;
    slot.m_eControlState = SCS.ONDRAG;
    slot.onFrameRender();
    expect(drawnQuads(dev).map((q) => q.texture)).toEqual(["NOW.TGA"]);
  });

  test("a mouse over a slot without a mouse over point is a null dereference of the exe; the point is not asked for when it is not drawn", () => {
    const { slot } = scene();
    slot.m_pMouseOverPoint = null;
    expect(slot.onFrameRender()).toBe(0);
    slot.m_bMouseOver = true;
    expect(() => slot.onFrameRender()).toThrow("no mouse over point");
    slot.m_bEnable = false;
    expect(slot.onFrameRender()).toBe(0);
    slot.m_bEnable = true;
    slot.m_eControlState = SCS.ONDRAG;
    expect(slot.onFrameRender()).toBe(0);
  });

  test("a point without a texture is drawn as nothing, and the slot goes on", () => {
    const { slot, dev, calls } = scene();
    slot.m_bMouseOver = true;
    slot.m_NowPoint.pUITextureData = null;
    slot.onFrameRender();
    expect(drawnQuads(dev)).toEqual([{ texture: "OVER.TGA", rect: R(40, 50) }]);
    expect(calls.length).toBe(1);
  });
});

describe("CKTDGUISlot.onFrameRender (32952670): the additional pictures", () => {
  test("they are drawn after the points, in the order of their keys (not the order they were added in)", () => {
    const { w, slot, dev } = scene();
    picture(w, slot, 5, 100, 10, "P5.TGA");
    picture(w, slot, -3, 110, 10, "PM3.TGA");
    picture(w, slot, 2, 120, 10, "P2.TGA");
    slot.m_bMouseOver = true;
    slot.onFrameRender();
    expect(drawnQuads(dev)).toEqual([
      { texture: "NOW.TGA", rect: R(20, 30) },
      { texture: "OVER.TGA", rect: R(40, 50) },
      { texture: "PM3.TGA", rect: R(110, 10) },
      { texture: "P2.TGA", rect: R(120, 10) },
      { texture: "P5.TGA", rect: R(100, 10) },
    ]);
  });

  test("a picture that is hidden, has no point, has no texture or has a texture that did not open is not drawn; the others are", () => {
    const { w, slot, dev } = scene();
    picture(w, slot, 1, 100, 10, "HIDDEN.TGA").bShow = false;
    picture(w, slot, 2, 110, 10, "NOPOINT.TGA").pPoint = null;
    picture(w, slot, 3, 120, 10, "NOTEXTURE.TGA").pTexture = null;
    picture(w, slot, 4, 130, 10, "FAILED.TGA").pTexture!.pTexture = null;
    picture(w, slot, 5, 140, 10, "SHOWN.TGA");
    slot.onFrameRender();
    expect(drawnQuads(dev)).toEqual([{ texture: "NOW.TGA", rect: R(20, 30) }, { texture: "SHOWN.TGA", rect: R(140, 10) }]);
  });

  test("a picture is drawn with the blend states of its point pushed round the draw (SRCBLEND from the source, DESTBLEND from the destination) and popped again", () => {
    const { w, slot, dev } = scene();
    const point = picture(w, slot, 1, 100, 10, "P.TGA").pPoint!;
    point.m_eSrcBlend = 2; // ONE
    point.m_eDestBlend = 3; // SRCCOLOR
    point.m_iDrawCount = 2;
    slot.onFrameRender();
    // the slot's own quads draw once and with the states the dialog left; the picture sets its two, draws its quad twice (its draw count; both
    // draws read the same four vertices) and puts the states back, newest first
    expect(dev.log).toEqual([
      "tex 0 NOW.TGA", "fvf 324", "src 12 28", "draw 5 0 2",
      "rs 19 2", "rs 20 3", "tex 0 P.TGA", "fvf 324", "src 12 28", "draw 5 4 2", "draw 5 4 2", "rs 20 6", "rs 19 5",
    ]);
    expect(w.render!.states.stackPointer).toBe(0);
  });

  test("a picture with an edge width has the edge drawn outside the quad before and after it (the picture's own flag is used both times)", () => {
    const { w, slot, dev } = scene();
    const p = picture(w, slot, 1, 10, 20, "P.TGA");
    p.m_EdgeWidth = 3;
    expect(p.m_bDrawEdgeOut).toBe(true);
    slot.onFrameRender();
    expect(draws(dev)).toBe(10);
    expect(strips(dev)).toEqual([
      { texture: "NOW.TGA", rect: R(20, 30) },
      ...bars(OUTSIDE),
      { texture: "P.TGA", rect: R(10, 20) },
      ...bars(OUTSIDE),
    ]);
    expect(w.render!.states.stackPointer).toBe(0);
  });

  test("... inside the quad when the picture says so", () => {
    const { w, slot, dev } = scene();
    const p = picture(w, slot, 1, 10, 20, "P.TGA");
    p.m_EdgeWidth = 3;
    p.m_bDrawEdgeOut = false;
    slot.onFrameRender();
    expect(strips(dev, 0).slice(1)).toEqual([...bars(INSIDE), { texture: "P.TGA", rect: R(10, 20) }, ...bars(INSIDE)]);
  });

  test("a width of 0 draws no bar, a negative width does (a width other than 0)", () => {
    const { w, slot, dev } = scene();
    const p = picture(w, slot, 1, 10, 20, "P.TGA");
    slot.onFrameRender();
    expect(strips(dev).map((s) => s.texture)).toEqual(["NOW.TGA", "P.TGA"]);
    dev.log.length = 0;
    p.m_EdgeWidth = -3; // the width is not tested for its sign: the bars are drawn (with negative sizes, which the texture draws as they come)
    slot.onFrameRender();
    expect(strips(dev).map((s) => s.texture)).toEqual(["NOW.TGA", ...new Array(4).fill("UIEDGE.TGA"), "P.TGA", ...new Array(4).fill("UIEDGE.TGA")]);
  });

  test("the colour of a bar is the dialog's times the picture's edge colour times the slot's, per channel", () => {
    const { w, slot, dev } = scene();
    const p = picture(w, slot, 1, 10, 20, "P.TGA");
    p.m_EdgeWidth = 3;
    p.m_EdgeColor.set(0.5, 0.25, 0.625, 0.75);
    slot.onFrameRender();
    // a 0.8 * 0.75 * 0.7 = 0.42 -> 107 = 0x6b; r 0.5 * 0.5 * 0.9 = 0.225 -> 57 = 0x39; g 0.75 * 0.25 * 0.6 = 0.1125 -> 29 = 0x1d; b 0.9 * 0.625 * 0.3 = 0.16875 -> 43 = 0x2b
    const colors = drawnCalls(dev).map((c) => c.vertices.map((v) => v[4]));
    expect(colors.length).toBe(10);
    for (const i of [1, 2, 3, 4, 6, 7, 8, 9]) expect(colors[i]).toEqual(new Array(4).fill(0x6b391d2b));
    expect(colors[5]).toEqual(new Array(4).fill(0x8f737345)); // the quad of the picture: the point's white
  });

  test("the draw count of the picture's point is the count of its quad, not the edge's", () => {
    const { w, slot, dev } = scene();
    const p = picture(w, slot, 1, 10, 20, "P.TGA");
    p.m_EdgeWidth = 3;
    p.pPoint!.m_iDrawCount = 3;
    slot.onFrameRender();
    expect(draws(dev)).toBe(1 + 4 + 3 + 4);
  });

  test("the pictures of a slot that is hidden are not drawn either", () => {
    const { w, slot, dev } = scene();
    picture(w, slot, 1, 10, 20, "P.TGA").m_EdgeWidth = 3;
    slot.m_bShow = false;
    slot.onFrameRender();
    expect(dev.log).toEqual([]);
  });
});

describe("CKTDGUISlot.drawEdge (32951310)", () => {
  /** a point of the picture at the layout position (10, 20), 64 x 32; the corners can be moved */
  const point = (): UIPointData => quad(scene().w, 10, 20);

  test("outside: four bars round the quad; inside: four bars on it", () => {
    const { slot, dev } = scene();
    slot.drawEdge(true, 3, slot.m_Color, point());
    expect(strips(dev)).toEqual(bars(OUTSIDE));
    const from = dev.log.length; // (the texture stays on the stage: only a change of texture is a line of the log)
    slot.drawEdge(false, 3, slot.m_Color, point());
    expect(strips(dev, from)).toEqual(bars(INSIDE));
  });

  test("a width of 0, no point and no edge texture draw nothing", () => {
    const { slot, dev } = scene();
    slot.drawEdge(true, 0, slot.m_Color, point());
    slot.drawEdge(true, 3, slot.m_Color, null);
    expect(dev.log).toEqual([]);
    (slot as unknown as { m_pEdgeTexture: undefined }).m_pEdgeTexture = undefined;
    slot.drawEdge(true, 3, slot.m_Color, point());
    expect(dev.log).toEqual([]);
  });

  test("the width of the quad is the distance of the right-top corner from the left-top one, the height that of the right-bottom corner", () => {
    const { slot, dev } = scene();
    const p = point();
    p.rightBottomPoint.set(90, 52); // 80 wide here ...
    p.leftBottomPoint.set(10, 56); // ... the left-bottom corner is 36 down
    slot.drawEdge(false, 3, slot.m_Color, p);
    // nWidth 64, nHeight 32; the bottom bars lie on the left-bottom corner's y (20.75 + 56 = 76.75): (21, 40, 3, 32), (21, 73, 64, 3), (82, 40, 3, 32), (21, 40, 64, 3)
    expect(strips(dev)).toEqual(bars([[21, 40, 24, 72], [21, 73, 85, 76], [82, 40, 85, 72], [21, 40, 85, 43]]));
  });

  test("the offset of the slot moves the bars: (2, 4) -> x 10.25 + 2 + 10 = 22.25, y 20.5 + 4 + 20 = 44.5", () => {
    const { slot, dev } = scene();
    slot.m_OffsetPos.set(2, 4);
    slot.drawEdge(false, 3, slot.m_Color, point());
    // (22, 44, 3, 32), (22, 73, 64, 3), (83, 44, 3, 32), (22, 44, 64, 3): x(rt) = 10.25 + 2 + 74 = 86.25, 83.25 inside
    expect(strips(dev)).toEqual(bars([[22, 44, 25, 76], [22, 73, 86, 76], [83, 44, 86, 76], [22, 44, 86, 47]]));
  });

  test("the colour is the dialog's times the edge colour given times the slot's, per channel, (int)(c * 255 + 0.5)", () => {
    const { slot, dev } = scene();
    slot.drawEdge(true, 3, new Color(0.5, 0.25, 0.625, 0.75), point());
    const colors = drawnCalls(dev).map((c) => c.vertices.map((v) => v[4]));
    expect(colors).toEqual(new Array(4).fill(new Array(4).fill(0x6b391d2b)));
  });
});

describe("CKTDGUISlot.onFrameRender (32952670): the string", () => {
  test("the string is the last thing drawn: OutTextMultiline(x, y, msg, colour, style, outline, 1, no rectangle, flag, all, 1, 1) of its font", () => {
    const { slot, dev, calls, w } = scene();
    picture(w, slot, 1, 10, 20, "P.TGA").m_EdgeWidth = 3;
    slot.m_bMouseOver = true;
    expect(slot.onFrameRender()).toBe(0);
    // x = (float)(10.25 + 3.8) + 0.75 = 14.8 -> 14, y = (float)(20.5 + 5.9) + 0.25 = 26.65 -> 26; the colour and the outline of the scene (stringspy.ts)
    expect(calls).toEqual([{ method: "OutTextMultiline", args: outText("Hi", 14, 26, COLOR, 2, OUTLINE, 5), log: dev.log.length }]);
    expect(dev.log.length).toBeGreaterThan(0);
  });

  test("an empty message is drawn too (the exe does not look at it)", () => {
    const { slot, calls } = scene();
    slot.m_pStringData = data("");
    slot.onFrameRender();
    expect(calls.map((c) => c.args[2])).toEqual([""]);
  });

  test("a slot without string data draws its quads and no string; it is not an error", () => {
    const { slot, dev, calls } = scene();
    slot.m_pStringData = null;
    expect(slot.onFrameRender()).toBe(0);
    expect(drawnQuads(dev)).toEqual([{ texture: "NOW.TGA", rect: R(20, 30) }]);
    expect(calls).toEqual([]);
  });

  test("the whole message goes to the UK font whatever the string says about spreading and about the UK font", () => {
    const { slot, calls } = scene();
    slot.m_pStringData = data("Hello", { bSpread: true, iSpreadCount: 2, bUseUkFont: false });
    slot.onFrameRender();
    expect(calls.map((c) => [c.method, c.args[2]])).toEqual([["OutTextMultiline", "Hello"]]);
  });

  test("the font is the one of the string's font index; an index nobody made a font for is the exe's crash", () => {
    const { slot, calls, dev, w } = scene();
    const other: Call[] = [];
    spied(dev, w.fonts, 4, other);
    slot.m_pStringData = data("Hi", { fontIndex: 4 });
    slot.onFrameRender();
    expect([calls.length, other.map((c) => c.args[2])]).toEqual([0, ["Hi"]]);
    slot.m_pStringData = data("Hi", { fontIndex: 9 });
    expect(() => slot.onFrameRender()).toThrow("no UK font for the font index 9");
  });

  test("the colour is the dialog's times the string's times the slot's, the place the dialog's plus the string's plus the slot's offset, cut", () => {
    const { slot, calls } = scene();
    slot.m_OffsetPos.set(2.5, 3.5);
    slot.onFrameRender();
    // x = (float)(10.25 + 3.8) + 2.5 = 16.55 -> 16, y = (float)(20.5 + 5.9) + 3.5 = 29.9 -> 29
    expect(calls[0]!.args).toEqual(outText("Hi", 16, 29));
    const t = scene();
    t.slot.m_pStringData = data("Hi", {});
    t.slot.m_pStringData.pos.set(-20.3, -30.9);
    t.slot.onFrameRender();
    // x = (float)(10.25 - 20.3) + 0.75 = -9.3 -> -9 (cut towards 0), y = (float)(20.5 - 30.9) + 0.25 = -10.15 -> -10
    expect(t.calls[0]!.args).toEqual(outText("Hi", -9, -10));
  });
});

describe("CKTDGUISlot.onFrameRender (32952670): everything together", () => {
  test("the current point, the mouse over point, each picture (its edge, its quad, its edge), then the string", () => {
    const { w, slot, dev, calls } = scene();
    slot.m_bMouseOver = true;
    const a = picture(w, slot, 7, 10, 20, "A.TGA");
    a.m_EdgeWidth = 3;
    picture(w, slot, 1, 100, 100, "B.TGA");
    const c = picture(w, slot, 4, 10, 20, "C.TGA");
    c.m_EdgeWidth = 3;
    c.m_bDrawEdgeOut = false;
    slot.onFrameRender();
    expect(strips(dev)).toEqual([
      { texture: "NOW.TGA", rect: R(20, 30) },
      { texture: "OVER.TGA", rect: R(40, 50) },
      { texture: "B.TGA", rect: R(100, 100) },
      ...bars(INSIDE),
      { texture: "C.TGA", rect: R(10, 20) },
      ...bars(INSIDE),
      ...bars(OUTSIDE),
      { texture: "A.TGA", rect: R(10, 20) },
      ...bars(OUTSIDE),
    ]);
    expect(calls.map((x) => x.log)).toEqual([dev.log.length]); // the font was asked after the last draw
    expect(w.render!.states.stackPointer).toBe(0);
  });
});

/** the corners of a point, left-top, right-top, left-bottom, right-bottom */
const corners = (p: UIPointData) => [p.leftTopPoint, p.rightTopPoint, p.leftBottomPoint, p.rightBottomPoint].map((c) => [c.x, c.y]);

describe("CKTDGUISlot.updateDraggingVertex (329545B0)", () => {
  /** a slot in a dialog at (10.25, 20.5) in a world with the scale (1.5, 2); the dialog's colour and the slot's are not 1 */
  function dragScene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    const slot = new CKTDGUISlot(s.w);
    place(dialog, slot);
    return { ...s, dialog, slot };
  }
  /** a point at (10.25, 20.75), 64.25 x 31.75, in the colour (r 0.25, g 0.5, b 0.75, a 0.875), with a texture (the UVs 0, 0 / 1, 0 / 0, 0.5 / 1, 0.5) */
  const pointOf = (w: UIContext, x = 10.25, y = 20.75): UIPointData => {
    const p = quad(w, 0, 0);
    p.leftTopPoint.set(x, y);
    p.rightTopPoint.set(x + 64.25, y);
    p.leftBottomPoint.set(x, y + 31.75);
    p.rightBottomPoint.set(x + 64.25, y + 31.75);
    p.color.set(0.25, 0.5, 0.75, 0.875);
    return p;
  };

  test("the corners are the point's scaled to the back buffer (the dialog's position and the slot's offset do not count), cut and moved half a pixel up and left", () => {
    const { w, slot } = dragScene();
    const v = new VertexUI4();
    slot.updateDraggingVertex(v, pointOf(w));
    // x 10.25 -> 15.375 -> 15 -> 14.5, 74.5 -> 111.75 -> 111 -> 110.5; y 20.75 -> 41.5 -> 41 -> 40.5, 52.5 -> 105 -> 104.5
    // the colour: r 0.25 -> 64, g 0.5 -> 128, b 0.75 -> 191, a 0.875 -> 223: the point's alone (the dialog's and the slot's colours are not in it)
    const c = 0xdf4080bf;
    expect(verts(v)).toEqual([
      [14.5, 40.5, 1, 1, c, 0, 0],
      [110.5, 40.5, 1, 1, c, 1, 0],
      [14.5, 104.5, 1, 1, c, 0, 0.5],
      [110.5, 104.5, 1, 1, c, 1, 0.5],
    ]);
  });

  test("the cut is towards 0: -5.625 -> -5 -> -5.5, -20.5 -> -20 -> -20.5", () => {
    const { w, slot } = dragScene();
    const v = new VertexUI4();
    slot.updateDraggingVertex(v, pointOf(w, -3.75, -10.25));
    // x -3.75 -> -5.625, 60.5 -> 90.75 -> 90 -> 89.5; y -10.25 -> -20.5, 21.5 -> 43 -> 42.5
    expect(verts(v).map((r) => [r[0], r[1]])).toEqual([[-5.5, -20.5], [89.5, -20.5], [-5.5, 42.5], [89.5, 42.5]]);
  });

  test("a point without a texture leaves the texture coordinates alone", () => {
    const { w, slot } = dragScene();
    const v = new VertexUI4();
    for (let i = 0; i < 4; i++) {
      v.setU(i, 0.25);
      v.setV(i, 0.75);
    }
    const p = pointOf(w);
    p.pUITextureData = null;
    slot.updateDraggingVertex(v, p);
    expect(verts(v).map((r) => [r[0], r[5], r[6]])).toEqual([[14.5, 0.25, 0.75], [110.5, 0.25, 0.75], [14.5, 0.25, 0.75], [110.5, 0.25, 0.75]]);
  });

  test("a slot that is in no dialog changes nothing", () => {
    const { w } = dragScene();
    const loose = new CKTDGUISlot(w);
    const v = new VertexUI4();
    loose.updateDraggingVertex(v, pointOf(w));
    expect(verts(v).flat().every((x) => x === 0)).toBe(true);
  });

  test("without a device the scale is 1: the corners are only cut", () => {
    const s = fontWorld({}, { device: false });
    const dialog = new CKTDGUIDialog(s.w);
    const slot = new CKTDGUISlot(s.w);
    place(dialog, slot);
    const v = new VertexUI4();
    slot.updateDraggingVertex(v, pointOf(s.w));
    // 10.25 -> 10 -> 9.5, 74.5 -> 74 -> 73.5; 20.75 -> 20 -> 19.5, 52.5 -> 52 -> 51.5
    expect(verts(v).map((r) => [r[0], r[1]])).toEqual([[9.5, 19.5], [73.5, 19.5], [9.5, 51.5], [73.5, 51.5]]);
  });
});

describe("CKTDGUISlot.renderDragSlot (32952DD0)", () => {
  // the device calls of the pushes of a dialog's states (the sampler states of stages 0 and 1, then m_RSICKTDGUIDialog) from the baseline of
  // rig.ts, and of the pops, as render.test.ts has worked them out for CKTDGUIDialog::OnFrameRender (the same code in both)
  const PUSH = [
    "ss 1 6 2", "ss 1 5 2", "ss 1 7 2", "ss 0 1 2", "ss 0 2 2", "ss 1 1 2", "ss 1 2 2",
    "rs 27 1", "rs 15 0", "rs 7 0", "rs 14 0", "tss 0 3 0", "tss 0 4 4", "tss 0 6 0",
  ];
  const POP = [
    "tss 0 6 1", "tss 0 4 2", "tss 0 3 1", "rs 14 1", "rs 7 1", "rs 15 1", "rs 27 0",
    "ss 1 2 1", "ss 1 1 1", "ss 0 2 1", "ss 0 1 1", "ss 1 7 0", "ss 1 5 1", "ss 1 6 1",
  ];

  /** a slot that is being dragged and has the focus; the mouse is at (300, 400): (200, 200) in layout pixels; the dragging point is the 64 x 32 quad at (10, 20) */
  function scene2() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    const slot = new CKTDGUISlot(s.w);
    place(dialog, slot);
    slot.m_pNormalPoint = quad(s.w, 22, 32, "NORMAL.TGA");
    slot.m_pDraggingPoint = quad(s.w, 10, 20, "DRAG.TGA");
    slot.m_eControlState = SCS.ONDRAG;
    slot.m_bHasFocus = true;
    s.w.mouse.m_XPos = 300;
    s.w.mouse.m_YPos = 400;
    s.dev.log.length = 0;
    return { ...s, dialog, slot };
  }
  const ORIGINAL = [[10, 20], [74, 20], [10, 52], [74, 52]];

  test("the dragged slot with the focus is drawn centred on the mouse: the states of a dialog pushed, the dragging point's quad, the states popped", () => {
    const { slot, dev, w } = scene2();
    expect(slot.renderDragSlot()).toBe(0);
    expect(dev.log).toEqual([...PUSH, "tex 0 DRAG.TGA", "fvf 324", "src 12 28", "draw 5 0 2", ...POP]);
    expect(w.render!.states.stackPointer).toBe(0);
    // the mouse (300, 400) is (300 / 1.5, 400 / 2) = (200, 200); the quad keeps its 64 x 32: 168 .. 232, 184 .. 216; on the back buffer x1.5, x2: 252 .. 348, 368 .. 432
    expect(drawnQuads(dev, PUSH.length)).toEqual([{ texture: "DRAG.TGA", rect: [252, 368, 348, 432] }]);
    // the dragging point itself has moved
    expect(corners(slot.m_pDraggingPoint!)).toEqual([[168, 184], [232, 184], [168, 216], [232, 216]]);
  });

  test("the position is divided by the scale, in single precision: (301, 403) -> (200.66667, 201.5)", () => {
    const { slot, dev, w } = scene2();
    w.mouse.m_XPos = 301;
    w.mouse.m_YPos = 403;
    slot.renderDragSlot();
    // x 301 / 1.5 = 200.666666 -> 200.66667175 (a float); left 168.66667175, right 232.66667175; y 201.5: top 185.5, bottom 217.5
    expect(corners(slot.m_pDraggingPoint!)).toEqual([[168.6666717529297, 185.5], [232.6666717529297, 185.5], [168.6666717529297, 217.5], [232.6666717529297, 217.5]]);
    // on the back buffer: 1.5 * 168.66667175 = 253.0000076 -> 253 -> 252.5, 1.5 * 232.66667175 = 349.0000076 -> 348.5; 2 * 185.5 = 371 -> 370.5, 2 * 217.5 = 435 -> 434.5
    expect(drawnQuads(dev, PUSH.length)).toEqual([{ texture: "DRAG.TGA", rect: [253, 371, 349, 435] }]);
  });

  test("the size is the width from the left-top to the right-top corner and the height from the left-top to the left-bottom one; the quad becomes a rectangle", () => {
    const { slot, dev, w } = scene2();
    const p = slot.m_pDraggingPoint!;
    p.rightTopPoint.set(74, 22); // 64 wide
    p.leftBottomPoint.set(12, 52); // 32 high
    p.rightBottomPoint.set(80, 60); // (68 wide from the bottom, 38 high from the right top, 70 and 40 from the left top)
    slot.renderDragSlot();
    expect(corners(p)).toEqual([[168, 184], [232, 184], [168, 216], [232, 216]]);
    expect(drawnQuads(dev, PUSH.length)).toEqual([{ texture: "DRAG.TGA", rect: [252, 368, 348, 432] }]);
    expect(w.render!.states.stackPointer).toBe(0);
  });

  test("the quad is the dragging point's own (its texture and its colour alone: the dialog's and the slot's colours are not in it), made with the slot's drag vertices", () => {
    const { slot, dev } = scene2();
    slot.m_pDraggingPoint!.color.set(0.25, 0.5, 0.75, 0.875);
    slot.renderDragSlot();
    expect(drawnCalls(dev, PUSH.length)[0]!.vertices.map((v) => [v[4], v[5], v[6]])).toEqual([
      [0xdf4080bf, 0, 0], [0xdf4080bf, 1, 0], [0xdf4080bf, 0, 0.5], [0xdf4080bf, 1, 0.5],
    ]);
    expect(verts(slot.m_DragVertex).map((r) => [r[0], r[1]])).toEqual([[251.5, 367.5], [347.5, 367.5], [251.5, 431.5], [347.5, 431.5]]);
    expect(verts(slot.m_Vertex).flat().every((x) => x === 0)).toBe(true); // the other vertices are not used
  });

  test("a slot that is not being dragged only pushes and pops the states", () => {
    for (const state of [SCS.NORMAL, SCS.DOWN, SCS.MOUSEOVER, SCS.DISABLE]) {
      const { slot, dev } = scene2();
      slot.m_eControlState = state;
      expect(slot.renderDragSlot()).toBe(0);
      expect(dev.log).toEqual([...PUSH, ...POP]);
      expect(corners(slot.m_pDraggingPoint!)).toEqual(ORIGINAL);
    }
  });

  test("a dragged slot without the focus, one whose normal point has no texture and one without a normal point are not drawn", () => {
    const noFocus = scene2();
    noFocus.slot.m_bHasFocus = false;
    noFocus.slot.renderDragSlot();
    expect(noFocus.dev.log).toEqual([...PUSH, ...POP]);
    const bare = scene2();
    bare.slot.m_pNormalPoint!.pUITextureData = null;
    bare.slot.renderDragSlot();
    expect(bare.dev.log).toEqual([...PUSH, ...POP]);
    const none = scene2();
    none.slot.m_pNormalPoint = null;
    none.slot.renderDragSlot();
    expect(none.dev.log).toEqual([...PUSH, ...POP]);
    for (const t of [noFocus, bare, none]) expect(corners(t.slot.m_pDraggingPoint!)).toEqual(ORIGINAL);
  });

  test("the normal point's texture is only asked for; the dragging point's is drawn, and without one only the point moves", () => {
    const { slot, dev } = scene2();
    slot.m_pDraggingPoint!.pUITextureData = null;
    slot.renderDragSlot();
    expect(dev.log).toEqual([...PUSH, ...POP]);
    expect(corners(slot.m_pDraggingPoint!)).toEqual([[168, 184], [232, 184], [168, 216], [232, 216]]);
  });

  test("the slot does not need to be shown, and there is no dragging point to make a quad of: the exe dereferences null", () => {
    const { slot, dev } = scene2();
    slot.m_bShow = false;
    slot.renderDragSlot();
    expect(drawnQuads(dev, PUSH.length).length).toBe(1);
    slot.m_pDraggingPoint = null;
    expect(() => slot.renderDragSlot()).toThrow("no dragging point");
    slot.m_bHasFocus = false; // not asked for when it is not drawn
    expect(slot.renderDragSlot()).toBe(0);
  });
});
