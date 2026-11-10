/**
 * The movies: `CKTDGUIControl::CMovieData::OnFrameMove` (32924DE0) and `OnFrameRender` (32925150), the loops of the static that call them
 * (`CKTDGUIStatic::OnFrameMove` 3292A120 / `OnFrameRender` 3292A2B0), `CKTDXDeviceRenderTargetTexture` (ctor 32970D60, `OnResetDevice` 32971480,
 * `OnLostDevice` 32971400, `SetDeviceTexture` 32971750, `BeginRender` 32971050, `Clear` 329710B0, `EndRender` 329713D0, `Draw` 32971200, the deleting
 * destructor 32970F70) and `CBandiVideoTexture_DX9` (ctor 32984470, `Open` 32984BC0, `CalcTexSize` 32984660, `Close` 329846E0, `Lock` 32984B80, `Unlock`
 * 32984D60, `Draw` 32984720, `GetFormat` 3289C7D0).  There is no oracle for them (the player is a DLL, the texture code draws on a device): every number is
 * worked out from the decompile and the disassembly, the arithmetic is in the comments.  The device is a recorder that writes down what it is asked,
 * the player and the video texture of the movie are spies where the test is about the movie.
 *
 * The world is 1536 x 1536 pixels, so the layout of 1024 x 768 is scaled by (1536 * 0.0009765625, 1536 / 768) = (1.5, 2).
 */
import { describe, expect, test } from "bun:test";
import { D3DFMT, D3DPOOL, D3DUSAGE } from "@els/d3d9";
import type { Direct3DDevice9 } from "@els/d3d9";
import {
  BVLPF, BVL_E_NOT_CREATED, BVL_SEEK, BVL_STATUS, BandiVideoTextureDX9, CKTDGUIDialog, CKTDGUIStatic, CMovieData, DeviceRenderTargetTexture, NoVideoLibrary, NoVideoTexture,
} from "../src/index.ts";
import type { BandiVideoLibrary, BandiVideoTexture, BvlFrame } from "../src/index.ts";
import { E_FAIL, FakeTexture, MovieDevice, movieWorld, quadOf } from "./moviedevice.ts";
import { setup } from "./harness.ts";

/** a video player that answers like a created one and writes down what it is asked; `status` and `next` are what it says */
function player(script: { status?: number; next?: number; created?: boolean; statusFails?: boolean } = {}) {
  const calls: string[] = [];
  const frames: BvlFrame[] = [];
  const library: BandiVideoLibrary = {
    isCreated: () => script.created ?? true,
    create: () => 0,
    verify: () => 0,
    close: () => void calls.push("close"),
    open: () => 0,
    getVideoInfo: () => ({ width: 0, height: 0 }),
    play: () => (calls.push("play"), 0),
    stop: () => (calls.push("stop"), 0),
    seek: (value, flag) => (calls.push(`seek ${value} ${flag}`), 0),
    getStatus: (out) => {
      calls.push("status");
      if (script.statusFails) return BVL_E_NOT_CREATED; // (the status is not written)
      out.status = script.status ?? 0;
      return 0;
    },
    isNextFrame: () => (calls.push("next"), script.next ?? 0),
    getFrame: (frame, canSkip) => {
      calls.push(`frame ${canSkip}`);
      frames.push({ ...frame });
      return 0;
    },
    destroy: () => void calls.push("destroy"),
  };
  return { calls, frames, library };
}

/** a video texture that answers as the script says and writes down what it is asked */
function videoTexture(calls: string[], lockResult: { bits: Uint8Array; pitch: number } | null = null) {
  const draws: number[][] = [];
  const texture: BandiVideoTexture = {
    open: () => 0,
    close: () => void calls.push("tclose"),
    lock: () => (calls.push("lock"), lockResult),
    unlock: () => void calls.push("unlock"),
    draw: (x, y, width, height) => (calls.push(`draw ${x} ${y} ${width} ${height}`), draws.push([x, y, width, height]), 0),
    getFormat: () => (calls.push("format"), 7),
    Destroy: () => void calls.push("tdestroy"),
  };
  return { texture, draws };
}

describe("CMovieData::OnFrameMove (32924DE0)", () => {
  function scene(script: { status?: number; next?: number; created?: boolean; statusFails?: boolean } = {}, loop = false) {
    const s = setup();
    const p = player(script);
    s.w.devices.createVideoLibrary = () => p.library;
    const mv = new CMovieData(s.w);
    mv.m_bLoop = loop;
    mv.m_Info = { width: 640, height: 360 };
    return { ...s, ...p, mv };
  }

  test("a movie at BVL_STATUS_PLAYEND (5) seeks to time 0 and plays again when it loops: GetStatus, Seek(0, 0, 0), Play, then IsNextFrame", () => {
    const { mv, calls } = scene({ status: BVL_STATUS.PLAYEND }, true);
    mv.onFrameMove();
    expect(calls).toEqual(["status", `seek 0 ${BVL_SEEK.TIME}`, "play", "next"]);
    expect(BVL_SEEK.TIME).toBe(0);
  });

  test("a movie that does not loop stops instead of playing again", () => {
    const { mv, calls } = scene({ status: 5 }, false);
    mv.onFrameMove();
    expect(calls).toEqual(["status", "seek 0 0", "stop", "next"]);
  });

  test("the status is compared with 5 only: every other (-1 .. 4) leaves the player alone", () => {
    for (const status of [-1, 0, 1, 2, 3, 4, 6]) {
      const { mv, calls } = scene({ status }, true);
      mv.onFrameMove();
      expect(calls).toEqual(["status", "next"]);
    }
  });

  test("a GetStatus that fails does not write the status, which the exe's local has not been given either: no branch acts on it (no seek, no play, no stop)", () => {
    for (const loop of [false, true]) {
      const { mv, calls } = scene({ statusFails: true, status: BVL_STATUS.PLAYEND }, loop);
      mv.onFrameMove();
      expect(calls).toEqual(["status", "next"]);
    }
  });

  test("no frame is due: the texture is not locked", () => {
    const { mv, calls } = scene({ next: 0 });
    const t = videoTexture(calls, { bits: new Uint8Array(8), pitch: 4 });
    mv.m_pBvt = t.texture;
    mv.onFrameMove();
    expect(calls).toEqual(["status", "next"]);
  });

  test("a frame is due: Lock, the texture's format, GetFrame(&frame, 1), Unlock; the frame is the locked bytes, the pitch, pitch * height bytes, the video's size and the texture's format", () => {
    const { mv, calls, frames } = scene({ next: 1 });
    const bits = new Uint8Array(4096);
    const t = videoTexture(calls, { bits, pitch: 2568 }); // a pitch that is not 4 * 640
    mv.m_pBvt = t.texture;
    mv.m_Info = { width: 641, height: 359 };
    mv.onFrameMove();
    expect(calls).toEqual(["status", "next", "lock", "format", "frame 1", "unlock"]);
    const f = frames[0]!;
    // frame_buf_size = pitch * m_Info.height = 2568 * 359 = 921,912
    expect([f.frame_buf === bits, f.frame_buf_size, f.pitch, f.width, f.height, f.pixel_format]).toEqual([true, 921912, 2568, 641, 359, 7]);
  });

  test("without a video texture, or when Lock gives no place, nothing is copied and nothing is unlocked", () => {
    const a = scene({ next: 1 });
    a.mv.onFrameMove();
    expect(a.calls).toEqual(["status", "next"]);
    const b = scene({ next: 1 });
    b.mv.m_pBvt = videoTexture(b.calls, null).texture;
    b.mv.onFrameMove();
    expect(b.calls).toEqual(["status", "next", "lock"]);
  });

  test("a player that is not created fails every call and writes nothing: the movie does nothing (and the status the exe reads uninitialised cannot matter)", () => {
    const s = setup();
    s.w.devices.createVideoLibrary = () => new NoVideoLibrary();
    const mv = new CMovieData(s.w);
    const calls: string[] = [];
    mv.m_pBvt = videoTexture(calls, { bits: new Uint8Array(8), pitch: 4 }).texture;
    mv.onFrameMove();
    expect(calls).toEqual([]);
    const lib = new NoVideoLibrary();
    const out = { status: 99 };
    expect([lib.getStatus(), lib.isNextFrame(), lib.seek(), lib.stop(), lib.play(), lib.getFrame(), lib.open(), lib.verify()]).toEqual([
      BVL_E_NOT_CREATED, 0, BVL_E_NOT_CREATED, BVL_E_NOT_CREATED, BVL_E_NOT_CREATED, BVL_E_NOT_CREATED, BVL_E_NOT_CREATED, BVL_E_NOT_CREATED,
    ]);
    expect(out.status).toBe(99);
    expect(lib.create()).toBe(-2054811616); // LoadLibraryW cannot find bdvid32.dll: 0x85861020
  });

  test("the frame is copied after a restart in the same call: the PLAYEND handling comes first, then the frame", () => {
    const { mv, calls } = scene({ status: 5, next: 1 }, true);
    mv.m_pBvt = videoTexture(calls, { bits: new Uint8Array(16), pitch: 4 }).texture;
    mv.onFrameMove();
    expect(calls).toEqual(["status", "seek 0 0", "play", "next", "lock", "format", "frame 1", "unlock"]);
  });
});

describe("CMovieData::OnFrameRender (32925150)", () => {
  /** a movie of 300.75 x 100.5 (SetRect: the render target texture is 300 x 100) at m_vPos (155.25, 65.75) */
  function scene() {
    const m = movieWorld();
    const mv = new CMovieData(m.w);
    mv.SetRect(10.5, 20.25, 300.75, 100.5);
    mv.m_vPos.set(155.25, 65.75);
    m.dev.log.length = 0;
    return { ...m, mv };
  }

  test("the render target texture becomes the target and is cleared twice, the video texture draws over (0, 0) to (int)size, the target is put back, the texture is drawn at the place", () => {
    const { mv, dev, dvb } = scene();
    const calls: string[] = [];
    mv.m_pBvt = videoTexture(calls).texture;
    mv.m_pBvt.draw = (x, y, w, h) => (dev.log.push(`video ${x} ${y} ${w} ${h}`), 0);
    mv.onFrameRender();
    const draw = dev.log.indexOf("dvb 3 5 2 1");
    // BeginRender(true): SetRenderTarget, SetDepthStencilSurface, Clear(0, 0, D3DCLEAR_TARGET | D3DCLEAR_ZBUFFER = 3, 0, 1.0, 0); Clear(0): the same; (int)300.75 = 300, (int)100.5 = 100; EndRender
    expect(dev.log.slice(0, 7)).toEqual([
      "settarget 0 level0 of tex0", "setdepth z0", "clear all 3 0 1 0", "clear all 3 0 1 0", "video 0 0 300 100", "settarget 0 back", "setdepth backZ",
    ]);
    expect(dev.log[draw - 1]).toBe("tex 0 tex0"); // the render target's texture goes to stage 0 for the last draw
    expect(dvb.length).toBe(1);
    expect(dev.log.slice(7, draw - 1).every((l) => l.startsWith("rs ") || l.startsWith("tss "))).toBe(true); // akRSICKTDXDeviceTexture: render and texture stage states pushed
    expect(draw).toBeGreaterThan(7);
  });

  test("the quad: m_vPos / scale cut to whole numbers, over (__int64)size, white; the corners are scale * n - 0.5 on the left and top, scale * size + scale * n on the right and bottom", () => {
    const { mv, dvb } = scene();
    mv.onFrameRender();
    // x = (int)(155.25 / 1.5) = (int)103.5 = 103; y = (int)(65.75 / 2) = (int)32.875 = 32; width 300, height 100 (the size 300.75 x 100.5 cut)
    // left = 1.5 * 103 - 0.5 = 154; top = 2 * 32 - 0.5 = 63.5; right = 300 * 1.5 + 154.5 = 604.5; bottom = 100 * 2 + 64 = 264
    expect(quadOf(dvb[0]!.data)).toEqual([
      [154, 63.5, 1, 1, 0xffffffff, 0, 0],
      [154, 264, 1, 1, 0xffffffff, 0, 1],
      [604.5, 63.5, 1, 1, 0xffffffff, 1, 0],
      [604.5, 264, 1, 1, 0xffffffff, 1, 1],
    ]);
    expect([dvb[0]!.type, dvb[0]!.primitive, dvb[0]!.count, dvb[0]!.draws]).toEqual([3, 5, 2, 1]);
  });

  test("a place that is below zero is cut toward zero: -77.4 / 1.5 = -51.6 -> -51, -9.5 / 2 = -4.75 -> -4", () => {
    const { mv, dvb } = scene();
    mv.m_vPos.set(-77.4, -9.5);
    mv.onFrameRender();
    // left = 1.5 * -51 - 0.5 = -77, top = 2 * -4 - 0.5 = -8.5; right = 450 + -76.5 = 373.5; bottom = 200 + -8 = 192
    const q = quadOf(dvb[0]!.data);
    expect([q[0]![0], q[0]![1], q[3]![0], q[3]![1]]).toEqual([-77, -8.5, 373.5, 192]);
  });

  test("without a video texture the target is still cleared and the (empty) texture still drawn; the states are popped", () => {
    const { mv, dev, render, dvb } = scene();
    mv.onFrameRender();
    expect(dev.log.filter((l) => l.startsWith("clear"))).toEqual(["clear all 3 0 1 0", "clear all 3 0 1 0"]);
    expect(dvb.length).toBe(1);
    expect(render.states.stackPointer).toBe(0);
    // the texture was put on stage 0 and stays in the state manager's list
    expect(render.states.apd3dTextures[0]).not.toBeNull();
  });

  test("the size is cut two ways: the video texture's by cvttss2si (an overflow is -2^31), the render target's by the 64-bit conversion (the low 32 bits)", () => {
    const { mv, dev } = scene();
    const calls: string[] = [];
    mv.m_pBvt = videoTexture(calls).texture;
    const drawn: number[][] = [];
    mv.m_pBvt.draw = (x, y, w, h) => (drawn.push([x, y, w, h]), 0);
    const target = mv.m_pRenderTargetTexture!;
    const real = target.draw.bind(target);
    const asked: number[][] = [];
    target.draw = (render, x, y, w, h, color) => {
      asked.push([x, y, w, h, color]);
      real(render, x, y, w, h, color);
    };
    mv.m_vSize.set(3e9, -5.9); // 3e9 does not fit an int: -2^31 for the first draw, 3e9 mod 2^32 as a signed number for the second
    mv.onFrameRender();
    expect(drawn).toEqual([[0, 0, -2147483648, -5]]);
    expect(asked.map((a) => a.slice(2))).toEqual([[3e9 - 2 ** 32, -5, 0xffffffff]]);
    mv.m_vSize.set(NaN, 2 ** 70); // the 64-bit conversion's indefinite is 0x8000000000000000: its low dword is 0; cvttss2si's is -2^31
    drawn.length = 0;
    asked.length = 0;
    mv.onFrameRender();
    expect(drawn).toEqual([[0, 0, -2147483648, -2147483648]]);
    expect(asked.map((a) => a.slice(2, 4))).toEqual([[0, 0]]);
    expect(dev.log.length).toBeGreaterThan(0);
  });

  test("the place is divided by the resolution scale as a float (the quotient is rounded to a float before it is cut): 0.9f / 0.1f is 9 and 4.2f / 1.4f is 3, though in double they are 8.99999963 and 2.99999991", () => {
    const { mv, render } = scene();
    render.resolutionScale.set(Math.fround(0.1), Math.fround(1.4));
    mv.m_vPos.set(0.9, 4.2);
    const asked: number[][] = [];
    const target = mv.m_pRenderTargetTexture!;
    target.draw = (_render, x, y, w, h, color) => void asked.push([x, y, w, h, color]);
    mv.onFrameRender();
    expect(asked).toEqual([[9, 3, 300, 100, 0xffffffff]]);
  });

  test("a movie without a render target texture (SetRect did not make one) is a null dereference of the exe: an Error; without a device it draws nothing", () => {
    const m = movieWorld();
    const mv = new CMovieData(m.w);
    expect(() => mv.onFrameRender()).toThrow(/no render target texture/);
    expect(m.dev.log).toEqual([]);
    const h = setup();
    const quiet = new CMovieData(h.w);
    quiet.SetRect(0, 0, 10, 10);
    expect(() => quiet.onFrameRender()).not.toThrow();
  });
});

describe("CKTDGUIStatic: the loops over its movies (3292A120, 3292A2B0)", () => {
  function scene() {
    const m = movieWorld();
    const dialog = new CKTDGUIDialog(m.w);
    dialog.m_Pos.set(10.25, 20.5);
    const control = new CKTDGUIStatic(m.w);
    dialog.AddControl(control);
    control.m_OffsetPos.set(0.1, 0.3);
    return { ...m, dialog, control };
  }

  function spyMovie(w: ReturnType<typeof scene>["w"], name: string, shown: boolean, origin: [number, number], log: string[]): CMovieData {
    const mv = new CMovieData(w);
    mv.m_bShow = shown;
    mv.m_vOriginPos.set(origin[0], origin[1]);
    mv.m_vPos.set(-1, -1);
    mv.onFrameRender = () => void log.push(`render ${name} ${mv.m_vPos.x} ${mv.m_vPos.y}`);
    mv.onFrameMove = () => void log.push(`move ${name}`);
    return mv;
  }

  test("OnFrameRender: m_vPos = ((dialog + origin) + offset) * scale, each sum a float, for the shown movies only, in order; the others' place is left alone", () => {
    const { w, control, dialog } = scene();
    const log: string[] = [];
    control.AddMovieData(spyMovie(w, "a", true, [1.1, 2.2], log));
    control.AddMovieData(spyMovie(w, "hidden", false, [5, 6], log));
    control.AddMovieData(spyMovie(w, "c", true, [-0.7, 0.4], log));
    dialog.m_Pos.set(10.25, 20.5);
    control.onFrameRender();
    // every number is a float (a Vec2 holds floats: 1.1 is 1.100000023841858, 0.1 is 0.10000000149011612, ...) and every sum is rounded to a float:
    // a: x = ((10.25 + 1.1f) + 0.1f) * 1.5 = (11.350000381469727 + 0.10000000149011612 = 11.450000762939453) * 1.5 = 17.17500114440918
    //    y = ((20.5 + 2.2f) + 0.3f) * 2 = (22.700000762939453 + 0.30000001192092896 = 23.000000774860382 -> 23) * 2 = 46
    // c: x = ((10.25 - 0.7f) + 0.1f) * 1.5 = (9.550000190734863 + 0.10000000149011612 = 9.65000057220459) * 1.5 = 14.475000858306885 -> 14.475000381469727
    //    y = ((20.5 + 0.4f) + 0.3f) * 2 = (20.899999618530273 + 0.30000001192092896 = 21.19999885559082) * 2 = 42.39999771118164
    expect(log).toEqual([
      "render a 17.17500114440918 46",
      "render c 14.475000381469727 42.39999771118164",
    ]);
  });

  test("OnFrameRender: each sum is rounded to a float before the next one (a sum of three at once would give 3.799999952316284 for the y)", () => {
    const { w, control, dialog } = scene();
    const log: string[] = [];
    control.AddMovieData(spyMovie(w, "a", true, [0.2, 0.7], log));
    dialog.m_Pos.set(0.1, 0.1);
    control.m_OffsetPos.set(1.1, 1.1);
    control.onFrameRender();
    // x: (0.1f + 0.2f) = 0.30000001192092896, + 1.1f = 1.4000000953674316, * 1.5 = 2.1000001430511475
    // y: (0.1f + 0.7f) = 0.800000011920929, + 1.1f = 1.9000000953674316, * 2 = 3.8000001907348633
    expect(log).toEqual(["render a 2.1000001430511475 3.8000001907348633"]);
  });

  test("OnFrameRender: a static that is hidden draws no movie; a movie in a static of no dialog is placed from the null dialog's (0, 0)", () => {
    const { w, control } = scene();
    const log: string[] = [];
    control.AddMovieData(spyMovie(w, "a", true, [2, 4], log));
    control.m_bShow = false;
    control.onFrameRender();
    expect(log).toEqual([]);
    const loose = new CKTDGUIStatic(w);
    loose.m_OffsetPos.set(1, 1);
    const mv = spyMovie(w, "loose", true, [2, 4], log);
    loose.AddMovieData(mv);
    loose.onFrameRender();
    // ((0 + 2) + 1) * 1.5 = 4.5, ((0 + 4) + 1) * 2 = 10
    expect(log).toEqual(["render loose 4.5 10"]);
  });

  test("OnFrameMove: every movie of a shown static is moved (a hidden movie too), in order; a hidden static moves none", () => {
    const { w, control } = scene();
    const log: string[] = [];
    control.AddMovieData(spyMovie(w, "a", true, [0, 0], log));
    control.AddMovieData(spyMovie(w, "hidden", false, [0, 0], log));
    control.m_bShow = false;
    control.onFrameMove(0, 1);
    expect(log).toEqual([]);
    control.m_bShow = true;
    control.onFrameMove(0, 1);
    expect(log).toEqual(["move a", "move hidden"]);
  });

  test("a real movie in a real static: the frame time reaches the player and the picture reaches the device (the whole path, no spies on the movie)", () => {
    const { w, control, dev, dvb } = scene();
    const p = player({ next: 1 });
    w.devices.createVideoLibrary = () => p.library;
    const mv = new CMovieData(w);
    mv.SetRect(0, 0, 64, 32);
    mv.m_bShow = true;
    mv.m_Info = { width: 16, height: 8 };
    const bits = new Uint8Array(1024);
    mv.m_pBvt = videoTexture([], { bits, pitch: 64 }).texture;
    control.AddMovieData(mv);
    dev.log.length = 0;
    control.onFrameMove(0, 0.5);
    expect(p.calls).toEqual(["status", "next", "frame 1"]);
    control.onFrameRender();
    expect(dvb.length).toBe(1);
    expect(dev.log[0]).toBe("settarget 0 level0 of tex0");
  });
});

describe("CKTDXDeviceRenderTargetTexture", () => {
  function scene(format = D3DFMT.A8R8G8B8) {
    const m = movieWorld();
    const target = m.w.devices.openRenderTargetTexture("MoveData", 300, 100, format)!;
    return { ...m, target };
  }

  test("without a device the constructor only keeps the id, the size and the format as whole numbers: no reference (the manager gives the first), no object", () => {
    const rt = new DeviceRenderTargetTexture("X", 300.7, 200.2, 21.9);
    expect([rt.deviceID, rt.refCount, rt.width, rt.height, rt.format]).toEqual(["X", 0, 300, 200, 21]);
    expect([rt.m_pRenderTargetTexture, rt.m_pRenderTargetSurface, rt.m_pRenderTargetZSurface, rt.m_pBackupBuffer, rt.m_pBackupZBuffer]).toEqual([null, null, null, null, null]);
  });

  test("the constructor makes the device objects when there is a device: the backups (a reference each), the texture, level 0, a depth surface of the size and the back depth's format", () => {
    const { target, dev } = scene();
    expect(dev.log).toEqual(["getrt", "getdepth", `create 300x100 levels 1 usage ${D3DUSAGE.RENDERTARGET} format ${D3DFMT.A8R8G8B8} pool ${D3DPOOL.DEFAULT}`, `createz 300x100 format ${D3DFMT.D24S8}`]);
    expect([target.m_pBackupBuffer === (dev.back as unknown), target.m_pBackupZBuffer === (dev.backZ as unknown), dev.back.refs, dev.backZ.refs]).toEqual([true, true, 2, 2]);
    expect([target.m_pRenderTargetTexture === (dev.made[0] as unknown), target.m_pRenderTargetSurface === (dev.made[0]!.surface as unknown), target.m_pRenderTargetZSurface === (dev.depths[0] as unknown)]).toEqual([true, true, true]);
    expect([target.deviceID, target.refCount, target.width, target.height, target.format]).toEqual(["MOVEDATA", 1, 300, 100, D3DFMT.A8R8G8B8]);
  });

  test("an unknown format becomes the back buffer's (once: it stays)", () => {
    const m = movieWorld();
    m.dev.back.format; // A8R8G8B8
    const target = m.w.devices.openRenderTargetTexture("Other", 64, 32, D3DFMT.UNKNOWN)!;
    expect(target.format).toBe(D3DFMT.A8R8G8B8);
    expect(m.dev.made[0]!.format).toBe(D3DFMT.A8R8G8B8);
  });

  test("OnResetDevice starts with OnLostDevice: what was made is released, and made again", () => {
    const { target, dev } = scene();
    const first = dev.made[0]!;
    const z = dev.depths[0]!;
    expect(target.onResetDevice(dev as unknown as Direct3DDevice9)).toBe(0);
    expect([first.refs, z.refs, first.surface.refs]).toEqual([0, 0, 0]);
    expect([dev.back.refs, dev.backZ.refs]).toEqual([2, 2]); // released once, taken once more
    expect([dev.made.length, target.m_pRenderTargetTexture === (dev.made[1] as unknown)]).toEqual([2, true]);
  });

  test("OnLostDevice releases the texture, its surface, the depth surface and both backups, forgets them, and is S_OK; a second one finds nothing", () => {
    const { target, dev } = scene();
    const t = dev.made[0]!;
    expect(target.onLostDevice()).toBe(0);
    expect([t.refs, t.surface.refs, dev.depths[0]!.refs, dev.back.refs, dev.backZ.refs]).toEqual([0, 0, 0, 1, 1]);
    expect([target.m_pRenderTargetTexture, target.m_pRenderTargetSurface, target.m_pRenderTargetZSurface, target.m_pBackupBuffer, target.m_pBackupZBuffer]).toEqual([null, null, null, null, null]);
    expect(target.onLostDevice()).toBe(0);
    expect(t.refs).toBe(0);
  });

  test("every step that fails is its own error with the id and E_FAIL; what was made before it stays", () => {
    const steps: [string, (d: MovieDevice) => void, number, (t: DeviceRenderTargetTexture, d: MovieDevice) => boolean][] = [
      ["GetRenderTarget", (d) => void (d.failGetTarget = true), 0x4c, (t) => t.m_pBackupBuffer === null && t.m_pBackupZBuffer === null],
      ["GetDepthStencilSurface", (d) => void (d.failGetDepth = true), 0x4d, (t, d) => t.m_pBackupBuffer === (d.back as unknown) && t.m_pBackupZBuffer === null && d.back.refs === 2],
      ["D3DXCreateTexture", (d) => void d.textureResults.push(E_FAIL, E_FAIL), 0x4e, (t, d) => t.m_pRenderTargetTexture === null && d.made.length === 0 && t.m_pBackupZBuffer !== null],
      ["GetSurfaceLevel", (d) => void (d.surfaceMissing = true), 0x4f, (t) => t.m_pRenderTargetTexture !== null && t.m_pRenderTargetSurface === null],
      ["CreateDepthStencilSurface", (d) => void (d.failDepthCreate = true), 0x50, (t) => t.m_pRenderTargetSurface !== null && t.m_pRenderTargetZSurface === null],
    ];
    for (const [name, arrange, id, state] of steps) {
      const m = movieWorld();
      arrange(m.dev);
      const log: [number, string | undefined][] = [];
      m.w.devices.massFiles.log.push = ((i: number, t?: string) => void log.push([i, t])) as never;
      const target = m.w.devices.openRenderTargetTexture("MoveData", 300, 100, D3DFMT.A8R8G8B8)!;
      expect([name, log]).toEqual([name, [[id, "MOVEDATA"]]]);
      expect([name, state(target, m.dev)]).toEqual([name, true]);
      expect(target.onResetDevice(m.dev as unknown as Direct3DDevice9)).toBe(E_FAIL);
    }
  });

  test("a surface that does not exist (the device has none) is BeginRender's null: the device refuses it, the exe reads the field as it is", () => {
    const m = movieWorld();
    m.dev.failGetTarget = true;
    const target = m.w.devices.openRenderTargetTexture("MoveData", 300, 100, D3DFMT.A8R8G8B8)!;
    m.dev.log.length = 0;
    target.beginRender(m.dev as never, false);
    expect(m.dev.log).toEqual(["settarget 0 null", "setdepth null"]);
  });

  test("BeginRender(false) sets the target and the depth surface and clears nothing; Clear(color) clears both to the colour with depth 1; EndRender puts the backups back", () => {
    const { target, dev } = scene();
    dev.log.length = 0;
    target.beginRender(dev as never, false);
    target.clear(dev as never, 0xff102030);
    target.endRender(dev as never);
    expect(dev.log).toEqual(["settarget 0 level0 of tex0", "setdepth z0", `clear all ${3} ${0xff102030} 1 0`, "settarget 0 back", "setdepth backZ"]);
  });

  test("SetDeviceTexture: a stage below 16 is remembered and a second call does nothing; the old one is released and the new one referenced; a failure is error 0x51 and SetTexture(null)", () => {
    const { target, dev, render, w } = scene();
    const texture = dev.made[0]!;
    const log: [number, string | undefined][] = [];
    w.devices.massFiles.log.push = ((i: number, t?: string) => void log.push([i, t])) as never;
    dev.log.length = 0;
    target.setDeviceTexture(render, 3);
    expect(dev.log).toEqual(["tex 3 tex0"]);
    expect([texture.refs, render.states.apd3dTextures[3] === (texture as unknown)]).toEqual([2, true]);
    target.setDeviceTexture(render, 3);
    expect(dev.log).toEqual(["tex 3 tex0"]);
    const old = new FakeTexture(9, 1, 1, 1, 0, 21, 0, 4);
    render.states.apd3dTextures[4] = old as never;
    dev.failSetTexture = true;
    target.setDeviceTexture(render, 4);
    expect(dev.log.slice(1)).toEqual(["tex 4 tex0", "tex 4 null"]);
    expect([old.refs, texture.refs, log]).toEqual([0, 3, [[0x51, "MOVEDATA"]]]);
    dev.failSetTexture = false;
    dev.log.length = 0;
    target.setDeviceTexture(render, 20);
    expect(dev.log).toEqual(["tex 20 tex0"]);
    expect(render.states.apd3dTextures.length).toBe(16);
    target.setDeviceTexture(render, 15); // the last stage of the list is remembered, too
    expect(render.states.apd3dTextures[15] === (texture as unknown)).toBe(true);
  });

  test("Draw pushes akRSICKTDXDeviceTexture for its quad and pops it; the vertices are the whole texture over the rectangle", () => {
    const { target, dev, render, dvb } = scene();
    dev.log.length = 0;
    target.draw(render, 8, 4, 100, 50, 0x80ffffff);
    // x = 1.5 * 8 = 12 -> 11.5 left, 1.5 * 100 + 12 = 162 right; y = 2 * 4 = 8 -> 7.5 top, 2 * 50 + 8 = 108 bottom
    expect(quadOf(dvb[0]!.data)).toEqual([
      [11.5, 7.5, 1, 1, 0x80ffffff, 0, 0],
      [11.5, 108, 1, 1, 0x80ffffff, 0, 1],
      [162, 7.5, 1, 1, 0x80ffffff, 1, 0],
      [162, 108, 1, 1, 0x80ffffff, 1, 1],
    ]);
    expect(render.states.stackPointer).toBe(0);
    // akRSICKTDXDeviceTexture (12 states) against the baseline of the device: the alpha function (25) NOTEQUAL (6), alpha blending (27), no z test (7),
    // no z write (14), clockwise culling (22) are new; the alpha test, its reference, the blend factors are the baseline's already; the alpha operation (stage 0,
    // type 4) is MODULATE (4), its arguments (5, 6) DIFFUSE (0) and TEXTURE (2).  The texture goes to stage 0, the strip is drawn, the states come back newest first.
    expect(dev.log).toEqual([
      "rs 25 6", "rs 27 1", "rs 7 0", "rs 14 0", "rs 22 2", "tss 0 4 4", "tss 0 5 0", "tss 0 6 2", "tex 0 tex0", "dvb 3 5 2 1",
      "tss 0 6 1", "tss 0 5 2", "tss 0 4 2", "rs 22 3", "rs 14 1", "rs 7 1", "rs 27 0", "rs 25 8",
    ]);
  });

  test("closeDevice at the last reference deletes the device (Destroy releases its objects); a reference that is left keeps them", () => {
    const { target, dev, w } = scene();
    const second = w.devices.openRenderTargetTexture("movedata", 1, 1, 0)!; // the same device, referenced again, keeps its size
    expect([second === target, target.refCount, target.width]).toEqual([true, 2, 300]);
    w.devices.closeDevice("MoveData");
    expect([target.refCount, dev.made[0]!.refs, w.devices.renderTargets.has("MOVEDATA")]).toEqual([1, 1, true]);
    w.devices.closeDevice("movedata");
    expect([w.devices.renderTargets.has("MOVEDATA"), dev.made[0]!.refs, dev.depths[0]!.refs, target.m_pRenderTargetTexture]).toEqual([false, 0, 0, null]);
  });

  test("without a device the render target has no objects (nothing to release, nothing drawn)", () => {
    const h = setup();
    const target = h.w.devices.openRenderTargetTexture("MoveData", 300, 100, D3DFMT.A8R8G8B8)!;
    expect([target.m_pRenderTargetTexture, target.m_pRenderTargetSurface, target.m_pBackupBuffer]).toEqual([null, null, null]);
    h.w.devices.closeDevice("MoveData");
    expect(h.w.devices.renderTargets.size).toBe(0);
  });
});

describe("CBandiVideoTexture_DX9", () => {
  /** a render whose Direct3D object answers as the script says */
  function scene(accepted: number[] = [D3DFMT.X8R8G8B8, D3DFMT.R8G8B8, D3DFMT.R5G6B5, D3DFMT.X1R5G5B5], displayFormat: number = D3DFMT.X8R8G8B8, displayHr = 0) {
    const m = movieWorld();
    const asked: number[][] = [];
    m.render.d3d = {
      GetAdapterDisplayMode: (adapter: number) => (asked.push([-1, adapter]), displayHr < 0 ? { hr: displayHr, mode: null } : { hr: 0, mode: { Width: 1, Height: 1, RefreshRate: 60, Format: displayFormat } }),
      CheckDeviceFormat: (...args: number[]) => (asked.push(args), accepted.includes(args[5]!) ? 0 : -2005530518),
    } as never;
    return { ...m, asked };
  }

  test("the constructor takes the first of X8R8G8B8, R8G8B8, R5G6B5, X1R5G5B5 that the adapter takes as a texture of its desktop: the D3D format, the BVL format, the bytes of a pixel", () => {
    const cases: [number[], number[]][] = [
      [[D3DFMT.X8R8G8B8, D3DFMT.R5G6B5], [D3DFMT.X8R8G8B8, BVLPF.X8R8G8B8, 4]],
      [[D3DFMT.R8G8B8, D3DFMT.R5G6B5], [D3DFMT.R8G8B8, BVLPF.R8G8B8, 3]],
      [[D3DFMT.R5G6B5, D3DFMT.X1R5G5B5], [D3DFMT.R5G6B5, BVLPF.R5G6B5, 2]],
      [[D3DFMT.X1R5G5B5], [D3DFMT.X1R5G5B5, BVLPF.R5G5B5, 2]],
      [[], [0, 0, 0]],
    ];
    for (const [accepted, want] of cases) {
      const { render } = scene(accepted);
      const t = new BandiVideoTextureDX9(render);
      expect([accepted, t.m_fmt_d3d, t.m_fmt_bvl, t.m_pixel_size]).toEqual([accepted, ...want]);
      expect(t.getFormat()).toBe(want[1]!);
    }
  });

  test("CheckDeviceFormat(adapter 0, HAL, the desktop's format, usage 0, D3DRTYPE_TEXTURE, the format) is asked in the order of the table until one is taken", () => {
    const { render, asked } = scene([D3DFMT.R5G6B5], D3DFMT.R5G6B5);
    new BandiVideoTextureDX9(render);
    expect(asked).toEqual([
      [-1, 0],
      [0, 1, D3DFMT.R5G6B5, 0, 3, D3DFMT.X8R8G8B8],
      [0, 1, D3DFMT.R5G6B5, 0, 3, D3DFMT.R8G8B8],
      [0, 1, D3DFMT.R5G6B5, 0, 3, D3DFMT.R5G6B5],
    ]);
  });

  test("a display mode that cannot be had leaves the format unknown without asking for a format; so does a world with no Direct3D at all", () => {
    const { render, asked } = scene([D3DFMT.X8R8G8B8], D3DFMT.X8R8G8B8, -5);
    const t = new BandiVideoTextureDX9(render);
    expect([t.m_fmt_d3d, t.m_fmt_bvl, t.m_pixel_size, asked]).toEqual([0, 0, 0, [[-1, 0]]]);
    const none = new BandiVideoTextureDX9(null);
    expect([none.m_fmt_d3d, none.getFormat(), none.open(10, 10), none.draw(0, 0, 1, 1)]).toEqual([0, 0, E_FAIL, 0]);
  });

  test("Open: the device wants no power of two (conditional non-power-of-two caps, 0x100): the texture is the video's size; a dynamic managed texture is tried first", () => {
    const { render, dev } = scene();
    const t = new BandiVideoTextureDX9(render);
    dev.log.length = 0;
    dev.refuseUsage = D3DUSAGE.DYNAMIC; // the runtime refuses a dynamic managed texture
    expect(t.open(300, 100)).toBe(0);
    expect(dev.log).toEqual([
      `create 300x100 levels 1 usage ${D3DUSAGE.DYNAMIC} format ${D3DFMT.X8R8G8B8} pool ${D3DPOOL.MANAGED}`,
      `create 300x100 levels 1 usage 0 format ${D3DFMT.X8R8G8B8} pool ${D3DPOOL.MANAGED}`,
    ]);
    expect([t.m_vid_width, t.m_vid_height, t.m_tex_width, t.m_tex_height, t.m_texture === (dev.made[0] as unknown)]).toEqual([300, 100, 300, 100, true]);
  });

  test("Open: a texture the first call makes is kept (one call); both refused is Beep(1000, 1000) and the error, the texture stays unmade", () => {
    const { render, dev } = scene();
    const t = new BandiVideoTextureDX9(render);
    dev.log.length = 0;
    expect(t.open(64, 32)).toBe(0);
    expect(dev.log.length).toBe(1);
    const u = new BandiVideoTextureDX9(render);
    dev.textureResults.push(-5, -6);
    expect(u.open(64, 32)).toBe(-6);
    expect([u.beeps, u.m_texture, u.m_tex_width, u.m_vid_width]).toEqual([[[1000, 1000]], null, 0, 0]);
    const v = new BandiVideoTextureDX9(render);
    dev.textureResults.push(-5);
    expect(v.open(64, 32)).toBe(0);
    expect(v.beeps).toEqual([]);
  });

  test("CalcTexSize: with TextureCaps' power-of-two bit (2) and without the conditional bit, a size is rounded up to a power of two from 16; with the conditional bit, or without the bit, it is the video's", () => {
    const cases: [number, [number, number], [number, number]][] = [
      [0x2, [300, 100], [512, 128]],
      [0x2, [16, 17], [16, 32]],
      [0x2, [1, 640], [16, 1024]],
      [0x2 | 0x100, [300, 100], [300, 100]],
      [0x0, [300, 100], [300, 100]],
      [0x4, [300, 100], [300, 100]],
    ];
    for (const [caps, [w, h], want] of cases) {
      const { render, dev } = scene();
      dev.textureCaps = caps;
      const t = new BandiVideoTextureDX9(render);
      expect(t.open(w, h)).toBe(0);
      expect([caps, t.m_tex_width, t.m_tex_height, t.m_vid_width, t.m_vid_height]).toEqual([caps, want[0], want[1], w, h]);
    }
  });

  test("Open clears the texture to zeros, row by row (pixel size * texture width bytes, the rows `pitch` apart); the bytes between the rows are not touched; it is locked once and unlocked once", () => {
    const { render, dev } = scene();
    const t = new BandiVideoTextureDX9(render);
    expect(t.open(10, 6)).toBe(0);
    const tex = dev.made[0]!;
    // X8R8G8B8: 4 bytes * 10 = 40 bytes of each row, rows 48 bytes apart (the fake adds 8)
    expect(tex.pitch).toBe(48);
    for (let row = 0; row < 6; row++) {
      expect([row, tex.bits.slice(row * 48, row * 48 + 40).every((b) => b === 0)]).toEqual([row, true]);
      expect([row, tex.bits.slice(row * 48 + 40, row * 48 + 48).every((b) => b === 0xaa)]).toEqual([row, true]);
    }
    expect([tex.locks, tex.unlocks]).toEqual([1, 1]);
  });

  test("Open with another pixel size (R5G6B5: 2 bytes) clears 2 * width bytes of a row", () => {
    const { render, dev } = scene([D3DFMT.R5G6B5]);
    const t = new BandiVideoTextureDX9(render);
    expect(t.open(10, 3)).toBe(0);
    const tex = dev.made[0]!;
    expect([tex.pitch, tex.bits.slice(0, 20).every((b) => b === 0), tex.bits[20]]).toEqual([28, true, 0xaa]);
  });

  test("a texture that cannot be locked is still the movie's (the clearing is skipped, there is no unlock)", () => {
    const { render, dev } = scene();
    const t = new BandiVideoTextureDX9(render);
    const original = dev.CreateTexture.bind(dev);
    dev.CreateTexture = ((...args: Parameters<MovieDevice["CreateTexture"]>) => {
      const made = original(...args);
      (made.tex as unknown as FakeTexture).lockHr = -9;
      return made;
    }) as typeof dev.CreateTexture;
    expect(t.open(8, 8)).toBe(0);
    const tex = dev.made[0]!;
    expect([tex.locks, tex.unlocks, tex.bits[0], t.m_texture === (tex as unknown)]).toEqual([1, 0, 0xaa, true]);
  });

  test("Close forgets the sizes and releases the texture; the deleting destructor does the same", () => {
    const { render, dev } = scene();
    const t = new BandiVideoTextureDX9(render);
    t.open(64, 32);
    const tex = dev.made[0]!;
    t.close();
    expect([t.m_texture, t.m_vid_width, t.m_vid_height, t.m_tex_width, t.m_tex_height, tex.refs]).toEqual([null, 0, 0, 0, 0, 0]);
    t.close(); // nothing to release
    const u = new BandiVideoTextureDX9(render);
    u.open(64, 32);
    u.Destroy();
    expect([u.m_texture, u.m_tex_width, dev.made[1]!.refs]).toEqual([null, 0, 0]);
  });

  test("Lock gives the pixels and the pitch (every call locks again); no texture gives null; Unlock unlocks; Unlock of no texture is a null dereference", () => {
    const { render, dev } = scene();
    const t = new BandiVideoTextureDX9(render);
    expect(t.lock()).toBeNull();
    expect(() => t.unlock()).toThrow(/no texture/);
    t.open(10, 6);
    const tex = dev.made[0]!;
    const locked = t.lock()!;
    expect([locked.bits === tex.bits, locked.pitch, tex.locks]).toEqual([true, 48, 2]); // one lock by Open, one by Lock
    t.unlock();
    expect(tex.unlocks).toBe(2);
    tex.lockHr = -3;
    expect(() => t.lock()).toThrow(/LockRect failed/);
  });

  test("Draw: stage 0 gets the texture, clamped addressing and linear filters are pushed, the quad is handed over once (no half pixel: x, y, x + width, y + height; the video's part of the texture), the states are popped", () => {
    const { render, dev, dvb } = scene();
    dev.textureCaps = 0x2; // the texture is 512 x 128 for a video of 300 x 100
    const t = new BandiVideoTextureDX9(render);
    t.open(300, 100);
    dev.log.length = 0;
    expect(t.draw(3.9, 4.1, 20, 30)).toBe(0);
    // ADDRESSU / ADDRESSV are WRAP (1) in the baseline: set to CLAMP (3) and set back; the filters of sampler 0 are LINEAR already (the baseline): pushed, not set
    expect(dev.log).toEqual(["tex 0 tex0", "ss 0 1 3", "ss 0 2 3", "dvb 3 5 2 1", "ss 0 2 1", "ss 0 1 1"]);
    // u = 300 / 512 = 0.5859375, v = 100 / 128 = 0.78125; x = (float)3.9 = 3.9000000953674316, x + 20 = 23.899999618530273 (as a float: 23.9), y = 4.099999904632568, + 30 = 34.099998474121094
    expect(quadOf(dvb[0]!.data)).toEqual([
      [3.9000000953674316, 4.099999904632568, 0, 1, 0xffffffff, 0, 0],
      [23.899999618530273, 4.099999904632568, 0, 1, 0xffffffff, 0.5859375, 0],
      [3.9000000953674316, 34.099998474121094, 0, 1, 0xffffffff, 0, 0.78125],
      [23.899999618530273, 34.099998474121094, 0, 1, 0xffffffff, 0.5859375, 0.78125],
    ]);
    expect(render.states.stackPointer).toBe(0);
    expect([render.states.adwSamplerState[1], render.states.adwSamplerState[2]]).toEqual([1, 1]);
  });

  test("Draw: the state manager's list remembers the texture (a second Draw does not set it again; the old one is released and the new one referenced)", () => {
    const { render, dev } = scene();
    const t = new BandiVideoTextureDX9(render);
    t.open(64, 32);
    const tex = dev.made[0]!;
    const old = new FakeTexture(9, 1, 1, 1, 0, 21, 0, 4);
    render.states.apd3dTextures[0] = old as never;
    t.draw(0, 0, 1, 1);
    expect([old.refs, tex.refs, render.states.apd3dTextures[0] === (tex as unknown)]).toEqual([0, 2, true]);
    dev.log.length = 0;
    t.draw(0, 0, 1, 1);
    expect(dev.log.filter((l) => l.startsWith("tex"))).toEqual([]);
  });

  test("Draw: a SetTexture that fails is the result, after SetTexture(0, null); the list keeps the texture; nothing is pushed or drawn", () => {
    const { render, dev, dvb } = scene();
    const t = new BandiVideoTextureDX9(render);
    t.open(64, 32);
    dev.failSetTexture = true;
    dev.log.length = 0;
    expect(t.draw(0, 0, 1, 1)).toBe(E_FAIL);
    expect(dev.log).toEqual(["tex 0 tex0", "tex 0 null"]);
    expect([dvb.length, render.states.stackPointer, render.states.apd3dTextures[0] === (dev.made[0] as unknown)]).toEqual([0, 0, true]);
  });

  test("Draw without a texture sets none on stage 0 (a texture that is not there is a texture of null)", () => {
    const { render, dev } = scene();
    const t = new BandiVideoTextureDX9(render);
    render.states.apd3dTextures[0] = new FakeTexture(5, 1, 1, 1, 0, 21, 0, 4) as never;
    dev.log.length = 0;
    t.draw(0, 0, 1, 1);
    expect(dev.log[0]).toBe("tex 0 null");
    expect(render.states.apd3dTextures[0]).toBeNull();
  });
});

describe("a machine without bdvid32.dll (what the world's devices are until a platform installs a player)", () => {
  test("NoVideoLibrary: nothing is created, no video has a size, closing and destroying do nothing", () => {
    const lib = new NoVideoLibrary();
    expect(lib.isCreated()).toBe(false);
    expect(lib.getVideoInfo()).toEqual({ width: 0, height: 0 });
    expect(lib.close()).toBeUndefined();
    expect(lib.destroy()).toBeUndefined();
    expect(lib.create()).toBe(-2054811616); // and the DLL is still not there: it stays not created
    expect(lib.isCreated()).toBe(false);
  });

  test("NoVideoTexture: it does not open, does not lock, draws nothing and takes no pixel format", () => {
    const texture = new NoVideoTexture();
    expect([texture.open(), texture.lock(), texture.draw(), texture.getFormat()]).toEqual([E_FAIL, null, 0, BVLPF.NULL]);
    expect([texture.close(), texture.unlock(), texture.Destroy()]).toEqual([undefined, undefined, undefined]);
  });
});
