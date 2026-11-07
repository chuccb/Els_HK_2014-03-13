/**
 * The drawing side of the UI: the 28-byte vertex, the tables the dialog draws with, `UpdateVertex` / `GetAxisPos` / `UpdateAnimVertex` /
 * `RenderVertex` of `CKTDGUIControl`, and `OnFrameRender` of the static, the button and the dialog.  The device is a recorder; every
 * expected number is worked out by hand from the decompile of x2.exe (the comments show the arithmetic), not taken from the code.
 *
 * The world is 1536 x 1536 pixels, so the layout of 1024 x 768 is scaled by (1536 * 0.0009765625, 1536 / 768) = (1.5, 2).
 */
import { describe, expect, test } from "bun:test";
import {
  BCS, CKTDGUIButton, CKTDGUIControl, CKTDGUIDialog, CKTDGUIEditBox, CKTDGUIStatic, CPictureData, DIALOG_SAMPLER_STATES, RSI_UI_DIALOG, TA,
  TexChangeData, UITextureData, UIRender, VertexUI4,
} from "../src/index.ts";
import type { UIContext } from "../src/index.ts";
import { E_FAIL, Recorder, headless, quad, rig, verts } from "./rig.ts";

describe("VertexUI4 and the tables", () => {
  test("a vertex is x, y, z, rhw (floats), the colour (ARGB dword), u, v (floats): 28 bytes, four of them", () => {
    const v = new VertexUI4();
    expect(v.bytes.length).toBe(112);
    v.setX(1, 1.5);
    v.setY(1, -2);
    v.setZ(1, 1);
    v.setRhw(1, 0.25);
    v.setColor(1, 0xff804020);
    v.setU(1, 0.5);
    v.setV(1, 0.75);
    const dv = new DataView(v.bytes.buffer);
    expect([28, 32, 36, 40].map((o) => dv.getFloat32(o, true))).toEqual([1.5, -2, 1, 0.25]);
    expect(dv.getUint32(44, true)).toBe(0xff804020);
    expect([dv.getFloat32(48, true), dv.getFloat32(52, true)]).toEqual([0.5, 0.75]);
    expect([v.x(1), v.y(1), v.z(1), v.rhw(1), v.color(1), v.u(1), v.v(1)]).toEqual([1.5, -2, 1, 0.25, 0xff804020, 0.5, 0.75]);
    expect([v.x(0), v.color(0), v.x(2), v.v(3)]).toEqual([0, 0, 0, 0]); // the others are untouched
  });

  test("akRSICKTDGUIDialog (x2.exe.c L140886) and the sampler states OnFrameRender sets, as numbers", () => {
    expect(RSI_UI_DIALOG.map((s) => [s.m_eType, s.m_dwStage, s.m_dwType, s.m_dwValue])).toEqual([
      [0, 0, 27, 1], [0, 0, 15, 0], [0, 0, 7, 0], [0, 0, 14, 0], // alpha blend on, alpha test off, no z test, no z write
      [1, 0, 1, 4], [1, 0, 2, 2], [1, 0, 3, 0], // colour: modulate (texture, diffuse)
      [1, 0, 4, 4], [1, 0, 5, 2], [1, 0, 6, 0], // alpha: modulate (texture, diffuse)
    ]);
    expect(DIALOG_SAMPLER_STATES.map((s) => [s.stage, s.type, s.value])).toEqual([
      [0, 6, 2], [0, 5, 2], [0, 7, 2], [1, 6, 2], [1, 5, 2], [1, 7, 2], // min, mag, mip filter: linear, on both stages
      [0, 1, 2], [0, 2, 2], [1, 1, 2], [1, 2, 2], // address u, v: mirror
    ]);
  });

  test("the render object brings the device to the baseline of CKTDGManager::OnResetDevice (akStates) before anything is drawn", () => {
    const dev = new Recorder();
    const r = new UIRender(dev as never);
    // the Direct3D defaults already hold SPECULAR 0, ALPHABLEND 0, Z 1 / 1 and CULL 3; LIGHTING, ALPHATEST, SRCBLEND, DESTBLEND and
    // the three filters of sampler 0 are changed
    expect(dev.log).toEqual(["rs 137 0", "rs 15 1", "rs 19 5", "rs 20 6", "ss 0 6 2", "ss 0 5 2", "ss 0 7 2"]);
    expect(r.states.stackPointer).toBe(0);
    expect([r.states.adwRenderState[19], r.states.adwRenderState[20]]).toEqual([5, 6]); // SRCALPHA, INVSRCALPHA
  });

  test("m_ResolutionScale = (width * 0.0009765625, height / 768) (CKTDXApp::OnResetDevice 328C4FC0)", () => {
    const r = new UIRender(new Recorder() as never);
    expect([r.resolutionScale.x, r.resolutionScale.y]).toEqual([1, 1]);
    r.setBackBufferSize(1024, 768);
    expect([r.resolutionScale.x, r.resolutionScale.y]).toEqual([1, 1]);
    r.setBackBufferSize(800, 600); // 800 / 1024, 600 / 768
    expect([r.resolutionScale.x, r.resolutionScale.y]).toEqual([0.78125, 0.78125]);
    r.setBackBufferSize(1280, 720); // 1280 / 1024, 720 / 768
    expect([r.resolutionScale.x, r.resolutionScale.y]).toEqual([1.25, 0.9375]);
  });
});

describe("CKTDGUIControl.updateVertex (32927FB0)", () => {
  /** a dialog at (10.25, 20.5) with a static that is moved by (3, 4), and the point data of a 64 x 32 picture at the origin */
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    const control = new CKTDGUIStatic(s.w);
    dialog.AddControl(control);
    control.m_OffsetPos.set(3, 4);
    return { ...s, dialog, control, point: quad(s.w, 0, 0) };
  }

  test("the corners are (dialog + corner + offset) * scale, cut to whole pixels and moved half a pixel up and left; z = rhw = 1; the UVs are the texture's", () => {
    const { control, point } = scene();
    const v = new VertexUI4();
    control.updateVertex(v, point);
    // x of the left corners: (10.25 + 0 + 3) * 1.5 = 19.875 -> 19 -> 18.5; of the right ones: (10.25 + 64 + 3) * 1.5 = 115.875 -> 114.5
    // y of the top corners: (20.5 + 0 + 4) * 2 = 49 -> 48.5; of the bottom ones: (20.5 + 32 + 4) * 2 = 113 -> 112.5
    const colour = 0xffffffff;
    expect(verts(v)).toEqual([
      [18.5, 48.5, 1, 1, colour, 0, 0],
      [114.5, 48.5, 1, 1, colour, 1, 0],
      [18.5, 112.5, 1, 1, colour, 0, 0.5],
      [114.5, 112.5, 1, 1, colour, 1, 0.5],
    ]);
  });

  test("a coordinate that is not a whole pixel is cut toward zero first: 19.875 -> 19, and -0.75 -> 0 -> -0.5", () => {
    const { control, dialog, point } = scene();
    dialog.m_Pos.set(-5, 0);
    control.m_OffsetPos.set(0, 0);
    point.leftTopPoint.set(4.25, -0.375); // x: (-5 + 4.25) * 1.5 = -1.125 -> -1 -> -1.5; y: -0.375 * 2 = -0.75 -> 0 -> -0.5
    const v = new VertexUI4();
    control.updateVertex(v, point);
    expect([v.x(0), v.y(0)]).toEqual([-1.5, -0.5]);
  });

  test("the colour is dialog * point * control per channel, (int)(c * 255 + 0.5) packed ARGB; 1 or more is 255, 0 or less 0, NaN 255", () => {
    const { control, dialog, point } = scene();
    dialog.m_Color.set(1, 0.5, 0.25, 1); // r g b a
    point.color.set(1, 1, 1, 0.5);
    control.m_Color.set(1, 1, 0.5, 0.5);
    const v = new VertexUI4();
    control.updateVertex(v, point);
    // a = 1 * 0.5 * 0.5 = 0.25 -> 63.75 + 0.5 = 64.25 -> 0x40; r = 1 -> 0xff; g = 0.5 -> 127.5 + 0.5 = 128 -> 0x80; b = 0.25 * 0.5 = 0.125 -> 31.875 + 0.5 = 32.375 -> 0x20
    expect([0, 1, 2, 3].map((i) => v.color(i))).toEqual([0x40ff8020, 0x40ff8020, 0x40ff8020, 0x40ff8020]);
    dialog.m_Color.set(2, -1, 0, NaN);
    point.color.set(1, 1, 1, 1);
    control.m_Color.set(1, 1, 1, 1);
    control.updateVertex(v, point);
    expect(v.color(0)).toBe(0xffff0000); // r 2 -> 255, g -1 -> 0, b 0 -> 0, a NaN -> 255
  });

  test("a control that is in no dialog changes nothing; a point without a texture leaves the UVs", () => {
    const { w, control, point } = scene();
    const loose = new CKTDGUIStatic(w);
    const v = new VertexUI4();
    loose.updateVertex(v, point);
    expect(verts(v).flat()).toEqual(new Array(28).fill(0));
    point.pUITextureData = null;
    v.setU(2, 0.125);
    v.setV(3, 0.375);
    control.updateVertex(v, point);
    expect([v.u(2), v.v(3), v.x(0)]).toEqual([0.125, 0.375, 18.5]);
  });

  test("without a device the scale is 1: x (10.25 + 0 + 3) = 13.25 -> 13 -> 12.5, y (20.5 + 0 + 4) = 24.5 -> 24 -> 23.5", () => {
    const { w } = headless();
    const dialog = new CKTDGUIDialog(w);
    dialog.m_Pos.set(10.25, 20.5);
    const control = new CKTDGUIStatic(w);
    dialog.AddControl(control);
    control.m_OffsetPos.set(3, 4);
    const v = new VertexUI4();
    control.updateVertex(v, quad(w, 0, 0));
    // the right-bottom corner: x (10.25 + 64 + 3) = 77.25 -> 77 -> 76.5, y (20.5 + 32 + 4) = 56.5 -> 56 -> 55.5
    expect([v.x(0), v.y(0), v.x(3), v.y(3)]).toEqual([12.5, 23.5, 76.5, 55.5]);
  });
});

describe("CKTDGUIControl.getAxisPos (329244F0) and updateAnimVertex (32927C70)", () => {
  /** a slightly skewed quad: left-top (10, 20), right-top (30, 22), left-bottom (12, 60), right-bottom (34, 64) */
  function skewed(): VertexUI4 {
    const v = new VertexUI4();
    [[10, 20], [30, 22], [12, 60], [34, 64]].forEach(([x, y], i) => { v.setX(i, x!); v.setY(i, y!); });
    return v;
  }
  const pos = (c: CKTDGUIControl, v: VertexUI4 | null, axis: number) => { const p = c.getAxisPos(v, axis); return [p.x, p.y]; };

  test("the nine places of the quad: corners and middles of the sides, from the left-top, right-top and left-bottom vertices", () => {
    const { w } = headless();
    const c = new CKTDGUIStatic(w);
    const v = skewed();
    // the middle of the top side: (30 - 10) * 0.5 + 10 = 20; of the left side: (60 - 20) * 0.5 + 20 = 40
    expect([TA.TOP_LEFT, TA.TOP_CENTER, TA.TOP_RIGHT].map((a) => pos(c, v, a))).toEqual([[10, 20], [20, 20], [30, 20]]);
    expect([TA.CENTER_LEFT, TA.CENTER_CENTER, TA.CENTER_RIGHT].map((a) => pos(c, v, a))).toEqual([[10, 40], [20, 40], [30, 40]]);
    expect([TA.BOTTOM_LEFT, TA.BOTTOM_CENTER, TA.BOTTOM_RIGHT].map((a) => pos(c, v, a))).toEqual([[10, 60], [20, 60], [34, 64]]);
  });

  test("NONE, WORLD and a value out of range are the origin, and so is a missing vertex", () => {
    const { w } = headless();
    const c = new CKTDGUIStatic(w);
    const v = skewed();
    expect([TA.NONE, TA.WORLD, 11, -1].map((a) => pos(c, v, a))).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
    expect([TA.TOP_LEFT, TA.BOTTOM_RIGHT].map((a) => pos(c, null, a))).toEqual([[0, 0], [0, 0]]);
  });

  test("a step that only translates moves every vertex by m_Pos", () => {
    const { w } = headless();
    const c = new CKTDGUIStatic(w);
    const v = skewed();
    const d = new TexChangeData();
    d.m_Pos.set(5, 7);
    c.updateAnimVertex(v, d);
    expect(verts(v).map(([x, y]) => [x, y])).toEqual([[15, 27], [35, 29], [17, 67], [39, 71]]);
  });

  test("a scale about the left-top vertex keeps it and stretches the others away from it", () => {
    const { w } = headless();
    const c = new CKTDGUIStatic(w);
    const v = skewed();
    const d = new TexChangeData();
    d.m_Scale.set(2, 3);
    d.m_ScaleAxis = TA.TOP_LEFT;
    c.updateAnimVertex(v, d);
    // (10, 20) + (dx * 2, dy * 3): right-top (20, 2) -> (50, 26); left-bottom (2, 40) -> (14, 140); right-bottom (24, 44) -> (58, 152)
    const got = verts(v).map(([x, y]) => [x!, y!]);
    const want = [[10, 20], [50, 26], [14, 140], [58, 152]];
    got.forEach((p, i) => { expect(p[0]).toBeCloseTo(want[i]![0]!, 4); expect(p[1]).toBeCloseTo(want[i]![1]!, 4); });
  });

  test("TA_WORLD takes the point of the data: a quarter turn about (0, 0) sends (x, y) to (-y, x); a scale about a point of the world", () => {
    const { w } = headless();
    const c = new CKTDGUIStatic(w);
    const v = skewed();
    const d = new TexChangeData();
    d.m_RotateAxis = TA.WORLD;
    d.m_RotateAxisPos.set(0, 0);
    d.m_fRotateDegree = 90;
    c.updateAnimVertex(v, d);
    const want = [[-20, 10], [-22, 30], [-60, 12], [-64, 34]];
    verts(v).forEach(([x, y], i) => { expect(x).toBeCloseTo(want[i]![0]!, 4); expect(y).toBeCloseTo(want[i]![1]!, 4); });
    const u = skewed();
    const e = new TexChangeData();
    e.m_Scale.set(2, 2);
    e.m_ScaleAxis = TA.WORLD;
    e.m_ScaleAxisPos.set(10, 20);
    c.updateAnimVertex(u, e);
    expect([u.x(1), u.y(1)].map((n) => Math.round(n * 1000) / 1000)).toEqual([50, 24]); // (10, 20) + (20, 2) * 2
  });

  test("without a vertex or without a step nothing happens", () => {
    const { w } = headless();
    const c = new CKTDGUIStatic(w);
    const v = skewed();
    c.updateAnimVertex(v, null);
    c.updateAnimVertex(null, new TexChangeData());
    expect(verts(v).map(([x, y]) => [x, y])).toEqual([[10, 20], [30, 22], [12, 60], [34, 64]]);
  });
});

describe("CKTDGUIControl.renderVertex (32925200, 329252C0)", () => {
  test("the picture's texture goes to stage 0 and the quad is drawn as a strip of two triangles from the dynamic buffer of the vertex type 3", () => {
    const { w, dev } = rig();
    const c = new CKTDGUIStatic(w);
    const point = quad(w, 0, 0);
    const v = new VertexUI4();
    v.setX(2, 7.5);
    v.setColor(3, 0x01020304);
    expect(c.renderVertex(v, point, 1)).toBe(0);
    // the buffers are made by type: 1 + 10 + 1 + 10, so type 3 starts at buffer 12; 324 = XYZRHW | DIFFUSE | TEX1, strip = 5
    expect(dev.log).toEqual(["tex 0 QUAD.TGA", "fvf 324", "src 12 28", "draw 5 0 2"]);
    expect(Array.from(dev.vbs[12]!.data.subarray(0, 112))).toEqual(Array.from(v.bytes));
  });

  test("the same texture is not set again; the draw count draws the quad that many times", () => {
    const { w, dev } = rig();
    const c = new CKTDGUIStatic(w);
    const point = quad(w, 0, 0);
    const v = new VertexUI4();
    c.renderVertex(v, point, 1);
    dev.log.length = 0;
    c.renderVertex(v, point, 3);
    // stage 0 holds the texture (the state manager remembers it); the next quad goes after the first one in the buffer
    expect(dev.log).toEqual(["fvf 324", "src 12 28", "draw 5 4 2", "draw 5 4 2", "draw 5 4 2"]);
  });

  test("without a device: error 0x82 \"device null\"; without a vertex 0x82 \"null\"; both E_FAIL", () => {
    const h = headless();
    const c = new CKTDGUIStatic(h.w);
    expect(c.renderVertex(new VertexUI4(), quad(h.w, 0, 0), 1)).toBe(E_FAIL);
    expect(c.renderVertex(new VertexUI4(), true)).toBe(E_FAIL);
    expect(h.w.devices.massFiles.log.entries).toEqual([{ id: 0x82, text: "device null" }, { id: 0x82, text: "device null" }]);
    const r = rig();
    const d = new CKTDGUIStatic(r.w);
    expect(d.renderVertex(null, quad(r.w, 0, 0), 1)).toBe(E_FAIL);
    expect(d.renderVertex(null, false)).toBe(E_FAIL);
    expect(r.w.devices.massFiles.log.entries).toEqual([{ id: 0x82, text: "null" }, { id: 0x82, text: "null" }]);
    expect(r.dev.log).toEqual([]);
  });

  test("a point without texture data is E_FAIL and silent; texture data without a texture is error 0x83 with the control's name", () => {
    const { w, dev } = rig();
    const c = new CKTDGUIStatic(w);
    c.setNameByForce("Back");
    const point = quad(w, 0, 0);
    point.pUITextureData = null;
    expect(c.renderVertex(new VertexUI4(), point, 1)).toBe(E_FAIL);
    expect(w.devices.massFiles.log.entries).toEqual([]);
    point.pUITextureData = new UITextureData();
    expect(c.renderVertex(new VertexUI4(), point, 1)).toBe(E_FAIL);
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x83, text: "Back" }]);
    expect(dev.log).toEqual([]);
  });

  test("the overload without point data draws with whatever texture the device holds; the vertex declaration is kept around the draw on request", () => {
    const { w, dev } = rig();
    const c = new CKTDGUIStatic(w);
    const v = new VertexUI4();
    expect(c.renderVertex(v, false)).toBe(0);
    expect(dev.log).toEqual(["fvf 324", "src 12 28", "draw 5 0 2"]);
    dev.log.length = 0;
    expect(c.renderVertex(v, true)).toBe(0);
    expect(dev.log).toEqual(["getdecl", "fvf 324", "src 12 28", "draw 5 4 2", "setdecl"]);
    expect(dev.declaration.released).toBe(1);
  });
});

describe("CKTDGUIStatic.onFrameRender (3292A2B0)", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    const control = new CKTDGUIStatic(s.w);
    dialog.AddControl(control);
    const picture = new CPictureData(s.w);
    const ud = s.wrap(picture, "CKTDGUIControl::CPictureData");
    s.m(ud, "SetTex", "P.TGA", "K");
    s.m(ud, "SetPoint", s.point(10, 20)); // the texture is 64 x 32
    control.AddPicture(picture);
    return { ...s, dialog, control, picture };
  }

  test("a picture is drawn with the blend states of its point pushed around the draw; the baseline holds them already, so the device is not told", () => {
    const { control, dev, picture, w } = scene();
    expect(control.onFrameRender()).toBe(0);
    // the corners: x = (10.25 + 10) * 1.5 = 30.375 -> 29.5, (10.25 + 74) * 1.5 = 126.375 -> 125.5; y = (20.5 + 20) * 2 = 81 -> 80.5, (20.5 + 52) * 2 = 145 -> 144.5
    expect(dev.log).toEqual(["tex 0 P.TGA", "fvf 324", "src 12 28", "draw 5 0 2"]);
    expect(w.render!.states.stackPointer).toBe(0);
    const bytes = new Float32Array(dev.vbs[12]!.data.buffer, 0, 28);
    expect([bytes[0], bytes[1], bytes[7], bytes[8], bytes[14], bytes[15], bytes[21], bytes[22]]).toEqual([29.5, 80.5, 125.5, 80.5, 29.5, 144.5, 125.5, 144.5]);
    expect(picture.pPoint!.m_iDrawCount).toBe(1);
  });

  test("a picture's own blend states and draw count", () => {
    const { control, dev, picture } = scene();
    picture.pPoint!.m_eSrcBlend = 2; // ONE
    picture.pPoint!.m_eDestBlend = 2; // ONE
    picture.pPoint!.m_iDrawCount = 2;
    control.onFrameRender();
    // SRCBLEND goes from SRCALPHA (5) to ONE (2) and DESTBLEND from INVSRCALPHA (6) to ONE (2); popped newest first
    expect(dev.log).toEqual(["rs 19 2", "rs 20 2", "tex 0 P.TGA", "fvf 324", "src 12 28", "draw 5 0 2", "draw 5 0 2", "rs 20 6", "rs 19 5"]);
    // the texture is the one stage 0 holds; the second quad goes after the first one in the buffer (4 vertices on)
    dev.log.length = 0;
    control.onFrameRender();
    expect(dev.log).toEqual(["rs 19 2", "rs 20 2", "fvf 324", "src 12 28", "draw 5 4 2", "draw 5 4 2", "rs 20 6", "rs 19 5"]);
  });

  test("a hidden static, a hidden picture, a picture without a point or a texture draw nothing", () => {
    const { control, dev, picture } = scene();
    control.m_bShow = false;
    control.onFrameRender();
    control.m_bShow = true;
    picture.bShow = false;
    control.onFrameRender();
    picture.bShow = true;
    const point = picture.pPoint;
    picture.pPoint = null;
    control.onFrameRender();
    picture.pPoint = point;
    const texture = picture.pTexture;
    picture.pTexture = null;
    control.onFrameRender();
    picture.pTexture = texture;
    expect(dev.log).toEqual([]);
    control.onFrameRender();
    expect(dev.log).toEqual(["tex 0 P.TGA", "fvf 324", "src 12 28", "draw 5 0 2"]);
  });

  test("the pictures are drawn in the order they were added", () => {
    const { control, dev, w, wrap, m, point } = scene();
    const second = new CPictureData(w);
    const ud = wrap(second, "CKTDGUIControl::CPictureData");
    m(ud, "SetTex", "Q.TGA", "K");
    m(ud, "SetPoint", point(0, 0));
    control.AddPicture(second);
    control.onFrameRender();
    expect(dev.log.filter((l) => l.startsWith("tex"))).toEqual(["tex 0 P.TGA", "tex 0 Q.TGA"]);
  });

  test("what is not ported is counted, not drawn: a string with text (one without is not), a movie; the edge is drawn now (controldraw.test.ts)", () => {
    const { control, picture, w } = scene();
    picture.m_EdgeWidth = 0;
    control.m_StringDataList.push({ msg: "" } as never, { msg: "Hi" } as never);
    control.m_MovieDataList.push({} as never);
    control.onFrameRender();
    expect([...w.render!.undrawn]).toEqual([["CKTDGUIStatic string", 1], ["CMovieData::OnFrameRender", 1]]);
  });

  test("without a device each picture is error 0x82 and nothing else happens", () => {
    const h = headless();
    const control = new CKTDGUIStatic(h.w);
    const dialog = new CKTDGUIDialog(h.w);
    dialog.AddControl(control);
    const picture = new CPictureData(h.w);
    const ud = h.wrap(picture, "CKTDGUIControl::CPictureData");
    h.m(ud, "SetTex", "P.TGA", "K");
    h.m(ud, "SetPoint", h.point(0, 0));
    control.AddPicture(picture);
    expect(control.onFrameRender()).toBe(0);
    expect(h.w.devices.massFiles.log.entries).toEqual([{ id: 0x82, text: "device null" }]);
  });
});

describe("CKTDGUIButton.onFrameRender (3292ED40)", () => {
  function scene() {
    const s = rig();
    const dialog = new CKTDGUIDialog(s.w);
    const b = new CKTDGUIButton(s.w);
    dialog.AddControl(b);
    const ud = s.wrap(b, "CKTDGUIButton");
    s.m(ud, "SetNormalTex", "B.TGA", "N");
    s.m(ud, "SetNormalPoint", s.point(10, 20));
    return { ...s, dialog, b, ud };
  }

  test("the quad of the current point is drawn: (10 * 1.5 = 15 -> 14.5, 74 * 1.5 = 111 -> 110.5; 20 * 2 = 40 -> 39.5, 52 * 2 = 104 -> 103.5)", () => {
    const { b, dev, w } = scene();
    expect(b.onFrameRender()).toBe(0);
    // no blend state is pushed: the button blends with the SRCALPHA / INVSRCALPHA of the baseline
    expect(dev.log).toEqual(["tex 0 B.TGA", "fvf 324", "src 12 28", "draw 5 0 2"]);
    expect([w.render!.states.adwRenderState[19], w.render!.states.adwRenderState[20]]).toEqual([5, 6]);
    const f = new Float32Array(dev.vbs[12]!.data.buffer, 0, 28);
    expect([f[0], f[1], f[7], f[8], f[14], f[15], f[21], f[22]]).toEqual([14.5, 39.5, 110.5, 39.5, 14.5, 103.5, 110.5, 103.5]);
  });

  test("the step of the texture animation the button is in moves the quad (m_Pos is added after the pixels are cut)", () => {
    const { b, dev } = scene();
    b.m_NowTexChangeData.m_Pos.set(100, 50);
    b.onFrameRender();
    const f = new Float32Array(dev.vbs[12]!.data.buffer, 0, 28);
    expect([f[0], f[1], f[7], f[8]]).toEqual([114.5, 89.5, 210.5, 89.5]);
  });

  test("a hidden button draws nothing; its string is not ported and is counted (the edge is drawn: controldraw.test.ts)", () => {
    const { b, dev, w } = scene();
    b.SetShow(false);
    b.onFrameRender();
    expect(dev.log).toEqual([]);
    b.SetShow(true);
    b.onFrameRender();
    expect([...w.render!.undrawn]).toEqual([]);
    b.m_pStringData = { msg: "Hi" } as never;
    b.onFrameRender();
    expect([...w.render!.undrawn]).toEqual([["CKTDGUIButton string", 1]]);
    expect(b.m_ButtonState).toBe(BCS.NORMAL);
  });
});

describe("CKTDGUIDialog.onFrameRender (32958FF0)", () => {
  /**
   * the device calls of the pushes, from the state the baseline leaves (akStates over the Direct3D defaults: sampler 0 filters LINEAR,
   * ALPHATEST on, SRCALPHA / INVSRCALPHA, stage 1 point filters and wrap): the filters of sampler 0 are linear already, so only stage 1 and the
   * mirrored addressing reach the device
   */
  const PUSH = [
    "ss 1 6 2", "ss 1 5 2", "ss 1 7 2", "ss 0 1 2", "ss 0 2 2", "ss 1 1 2", "ss 1 2 2",
    // RSI: ALPHABLENDENABLE 0 -> 1, ALPHATESTENABLE 1 -> 0, ZENABLE 1 -> 0, ZWRITEENABLE 1 -> 0; COLOROP modulate and COLORARG1 texture stay,
    // COLORARG2 current -> diffuse, ALPHAOP select-arg-1 -> modulate, ALPHAARG1 texture stays, ALPHAARG2 current -> diffuse
    "rs 27 1", "rs 15 0", "rs 7 0", "rs 14 0", "tss 0 3 0", "tss 0 4 4", "tss 0 6 0",
  ];
  const POP = [
    "tss 0 6 1", "tss 0 4 2", "tss 0 3 1", "rs 14 1", "rs 7 1", "rs 15 1", "rs 27 0",
    "ss 1 2 1", "ss 1 1 1", "ss 0 2 1", "ss 0 1 1", "ss 1 7 0", "ss 1 5 1", "ss 1 6 1",
  ];

  function scene(extra: Parameters<typeof rig>[0] = {}) {
    const s = rig(extra);
    const dialog = new CKTDGUIDialog(s.w);
    dialog.m_Pos.set(10.25, 20.5);
    const control = new CKTDGUIStatic(s.w);
    dialog.AddControl(control);
    const picture = new CPictureData(s.w);
    const ud = s.wrap(picture, "CKTDGUIControl::CPictureData");
    s.m(ud, "SetTex", "P.TGA", "K");
    s.m(ud, "SetPoint", s.point(10, 20));
    control.AddPicture(picture);
    return { ...s, dialog, control };
  }

  test("the sampler states and the states of the table are pushed, the controls drawn, everything popped newest first", () => {
    const { dialog, dev } = scene();
    expect(dialog.onFrameRender()).toBe(0);
    // the point's blend states are the baseline's: no device call for them
    expect(dev.log).toEqual([...PUSH, "tex 0 P.TGA", "fvf 324", "src 12 28", "draw 5 0 2", ...POP]);
    expect(dialog.ctx.render!.states.stackPointer).toBe(0);
  });

  test("a hidden dialog draws nothing unless it is forced", () => {
    const { dialog, dev } = scene();
    dialog.m_bShow = false;
    expect(dialog.onFrameRender()).toBe(0);
    expect(dev.log).toEqual([]);
    expect(dialog.onFrameRender(true)).toBe(0);
    expect(dev.log).toEqual([...PUSH, "tex 0 P.TGA", "fvf 324", "src 12 28", "draw 5 0 2", ...POP]);
  });

  test("while the dialog manager hides the dialogs only DLG_ChatBox_EditBox draws, and the others answer 1", () => {
    const { dialog, dev, w } = scene();
    w.dialogManager.m_bCanHide = true;
    w.dialogManager.m_bShow = true; // can hide, but is shown
    expect(dialog.onFrameRender()).toBe(0);
    expect(dev.log.length).toBeGreaterThan(0);
    dev.log.length = 0;
    w.dialogManager.m_bShow = false;
    expect(dialog.onFrameRender()).toBe(1);
    expect(dev.log).toEqual([]);
    dialog.m_Name = "DLG_ChatBox_EditBox";
    expect(dialog.onFrameRender()).toBe(0);
    expect(dev.log.length).toBeGreaterThan(0);
    dev.log.length = 0;
    dialog.m_Name = "DLG_ChatBox_EditBox2"; // the whole name has to match
    expect(dialog.onFrameRender()).toBe(1);
    expect(dev.log).toEqual([]);
    w.dialogManager.m_bCanHide = false; // not allowed to hide: shown whatever m_bShow says
    expect(dialog.onFrameRender()).toBe(0);
  });

  test("the self-delete time counts from the making of the dialog: drawn while (clock - start) / 1000 <= the time", () => {
    let now = 1000;
    const { dialog, dev } = scene({ tickCount: () => now });
    dialog.SetTimeForSelfDelete(2);
    now = 3000; // exactly 2.000 s
    dialog.onFrameRender();
    expect(dev.log.length).toBeGreaterThan(0);
    dev.log.length = 0;
    now = 3001; // 2.001 s
    expect(dialog.onFrameRender()).toBe(0);
    expect(dev.log).toEqual([]);
    dialog.SetTimeForSelfDelete(0); // no limit
    dialog.onFrameRender();
    expect(dev.log.length).toBeGreaterThan(0);
  });

  test("the controls are drawn in the order of the list, those out of the list are skipped, then each control gets OnFrameRenderEnd", () => {
    const { dialog, w } = scene();
    const calls: string[] = [];
    class Probe extends CKTDGUIControl {
      constructor(ctx: UIContext, readonly tag: string) { super(ctx); }
      override onFrameRender(): number { calls.push(`r${this.tag}`); return 0; }
      override onFrameRenderEnd(): number { calls.push(`e${this.tag}`); return 0; }
    }
    const [a, b, c] = ["a", "b", "c"].map((t) => new Probe(w, t));
    for (const p of [a!, b!, c!]) dialog.AddControl(p);
    b!.m_bOutofList = true;
    dialog.onFrameRender();
    expect(calls).toEqual(["ra", "rc", "ea", "ec"]);
  });

  test("a control whose drawing is not ported is counted by class and draws nothing", () => {
    const { dialog, w, dev } = scene();
    dialog.AddControl(new CKTDGUIEditBox(w));
    dev.log.length = 0;
    dialog.onFrameRender();
    expect([...w.render!.undrawn]).toEqual([["CKTDGUIEditBox", 1]]);
    expect(dev.log.filter((l) => l.startsWith("draw")).length).toBe(1); // the static's picture only
  });

  test("without a device the dialog still walks its controls: the picture is error 0x82, an empty static nothing", () => {
    const h = headless();
    const dialog = new CKTDGUIDialog(h.w);
    expect(dialog.onFrameRender()).toBe(0);
    dialog.AddControl(new CKTDGUIStatic(h.w));
    expect(dialog.onFrameRender()).toBe(0);
    expect(h.w.devices.massFiles.log.entries).toEqual([]);
    const control = new CKTDGUIStatic(h.w);
    dialog.AddControl(control);
    const picture = new CPictureData(h.w);
    const ud = h.wrap(picture, "CKTDGUIControl::CPictureData");
    h.m(ud, "SetTex", "P.TGA", "K");
    h.m(ud, "SetPoint", h.point(0, 0));
    control.AddPicture(picture);
    expect(dialog.onFrameRender()).toBe(0);
    expect(h.w.devices.massFiles.log.entries).toEqual([{ id: 0x82, text: "device null" }]);
  });
});
