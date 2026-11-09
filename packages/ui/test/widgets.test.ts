import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable } from "@els/assets";
import { LuaError, LuaTable } from "@els/lua";
import {
  CKTDGUIContolList, CKTDGUIEditBox, CKTDGUINavigation, CKTDGUIScrollBar, CKTDGUISlider, CKTDGUIStatic, CMovieData, CX2MapSelectWindow,
  CX2SlotManager, D3DFMT_A8R8G8B8, E_FAIL, IntPairMap, NoVideoLibrary, UCT, UIM, UIWorld, WStringMap, ftoi, setRect,
} from "../src/index.ts";
import type { BandiVideoLibrary, BandiVideoTexture, Rect } from "../src/index.ts";
import { indexAllKoms, KomMassFileSource } from "../../../tools/komindex.ts";
import { setup } from "./harness.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const t = test.skipIf(!haveData);

const rc = (r: Rect) => [r.left, r.top, r.right, r.bottom];
// Controls, textures and dialogs each hold the whole world: a failing comparison of two of them would print all of it (and a mutation run
// would run out of memory).  They are compared by identity, as booleans, or by name.
const is = (a: unknown, b: unknown): boolean => a === b;
const names = (list: readonly { m_Name: string }[]): string[] => list.map((c) => c.m_Name);
const some = (...xs: unknown[]): string[] => xs.map((x) => (x === null || x === undefined ? "none" : "some"));
const corners = (p: { leftTopPoint: { x: number; y: number }; rightTopPoint: { x: number; y: number }; leftBottomPoint: { x: number; y: number }; rightBottomPoint: { x: number; y: number } }) => [
  p.leftTopPoint.x, p.leftTopPoint.y, p.rightTopPoint.x, p.rightTopPoint.y, p.leftBottomPoint.x, p.leftBottomPoint.y, p.rightBottomPoint.x, p.rightBottomPoint.y,
];

// ---- the helpers the new classes share ---------------------------------------------------------------------------------------

describe("ftoi, IntPairMap and the render target devices", () => {
  test("ftoi is (int)x: truncation toward zero, and the processor's 0x80000000 for NaN, infinity and out of range", () => {
    expect([ftoi(3.9), ftoi(-3.9), ftoi(0.5), ftoi(-0.5), ftoi(2147483647)]).toEqual([3, -3, 0, 0, 2147483647]);
    expect([ftoi(NaN), ftoi(Infinity), ftoi(-Infinity), ftoi(2147483648), ftoi(-2147483648), ftoi(-2147483649)]).toEqual([-2147483648, -2147483648, -2147483648, -2147483648, -2147483648, -2147483648]);
  });

  test("IntPairMap iterates in std::pair order (first, then second) and getOrInsert keeps what is there", () => {
    const map = new IntPairMap<string>();
    for (const [a, b] of [[1, 2], [0, 5], [1, 0], [0, 1]] as const) map.getOrInsert(a, b, () => `${a},${b}`);
    expect([...map].map(([a, b, v]) => [a, b, v])).toEqual([[0, 1, "0,1"], [0, 5, "0,5"], [1, 0, "1,0"], [1, 2, "1,2"]]);
    expect(map.size).toBe(4);
    expect(map.getOrInsert(1, 0, () => "other")).toBe("1,0");
    expect([map.get(0, 5), map.get(5, 0), map.get(1, 1)]).toEqual(["0,5", undefined, undefined]);
    expect(map.size).toBe(4);
  });

  test("WStringMap keeps its keys in order, emplace keeps the first value of a key, erase and clear empty it for good", () => {
    const map = new WStringMap<number>();
    expect([map.emplace("b", 2), map.emplace("a", 1), map.emplace("b", 9), map.emplace("c", 3)]).toEqual([true, true, false, true]);
    expect([map.keys(), map.get("b"), map.size]).toEqual([["a", "b", "c"], 2, 3]);
    expect([map.erase("b"), map.erase("b"), map.keys()]).toEqual([true, false, ["a", "c"]]);
    map.clear();
    expect([map.size, map.keys(), [...map], map.has("a"), map.has("c"), map.get("a")]).toEqual([0, [], [], false, false, undefined]);
    // it works as a new map afterwards: the keys that were there do not come back, the order is kept
    expect([map.emplace("z", 26), map.emplace("c", 30), map.emplace("a", 10)]).toEqual([true, true, true]);
    expect([map.keys(), [...map].map(([k, v]) => `${k}${v}`), map.size]).toEqual([["a", "c", "z"], ["a10", "c30", "z26"], 3]);
  });

  test("OpenRenderTargetTexture (328EE4C0): no id, no device; the id is upper case; an open device is referenced again and keeps its size; CloseDevice unreferences", () => {
    const { w } = setup();
    const d = w.devices;
    expect(d.openRenderTargetTexture("", 10, 10, D3DFMT_A8R8G8B8)).toBeUndefined();
    const a = d.openRenderTargetTexture("MoveData", 640, 480, D3DFMT_A8R8G8B8)!;
    expect([a.deviceID, a.width, a.height, a.format, a.refCount]).toEqual(["MOVEDATA", 640, 480, 21, 1]);
    const b = d.openRenderTargetTexture("movedata", 100, 50, 22)!;
    expect([b === a, a.width, a.height, a.format, a.refCount]).toEqual([true, 640, 480, 21, 2]);
    d.closeDevice("MoveData");
    expect(d.renderTargets.size).toBe(1);
    d.closeDevice("MOVEDATA");
    expect(d.renderTargets.size).toBe(0);
  });

  test("CKTDGUIScrollBar's destructor closes the sound it opened and nothing else", () => {
    const { w } = setup();
    w.devices.soundSystemInitialised = true;
    w.devices.massFiles.isValidFile = () => true;
    const bar = new CKTDGUIScrollBar(w);
    bar.m_pSndMouseDown = w.devices.openSound("a.wav");
    bar.setThumbTex(null);
    expect(w.devices.sounds.size).toBe(1);
    bar.Destroy();
    expect([w.devices.sounds.size, bar.m_pSndMouseDown]).toEqual([0, undefined]);
    bar.Destroy(); // nothing left to close
  });
});

// ---- CKTDGUINavigation -------------------------------------------------------------------------------------------------------

describe("CKTDGUINavigation", () => {
  function nav() {
    const s = setup();
    const b = new CKTDGUINavigation(s.w);
    return { ...s, b, ud: s.wrap(b, "CKTDGUINavigation") };
  }

  test("the constructor's defaults (3294D3A0); it runs UI_Control_Sound.lua", () => {
    const { w, b } = nav();
    expect(b.m_ControlType).toBe(UCT.NAVIGATION);
    expect([b.m_CustomMsgLButtonDown, b.m_CustomMsgMouseDragging, b.m_bDraggingWindow]).toEqual([-1, -1, false]);
    expect(some(b.m_pBGTex, b.m_pWindowTex, b.m_pBGPoint, b.m_pWindowPoint, b.m_pSndMouseDown)).toEqual(new Array(5).fill("none"));
    expect([b.m_ptLastMouse.x, b.m_ptLastMouse.y, ...rc(b.m_rcBG), ...rc(b.m_rcWindow)]).toEqual(new Array(10).fill(0));
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x87, text: "UI_CONTROL_SOUND.LUA" }, { id: 0x48, text: "UI_Control_Sound.lua" }]);
  });

  test("SetBGTex / SetWindowTex destroy the texture they replace and hand the new one to the point that exists", () => {
    const { b, ud, m, point } = nav();
    m(ud, "SetBGTex_LUA", "BG.TGA", "A");
    const first = b.m_pBGTex!;
    expect([first.texName, first.keyName]).toEqual(["BG.TGA", "A"]);
    m(ud, "SetBGPoint_LUA", point(10, 20));
    expect(is(b.m_pBGPoint!.pUITextureData, first)).toBe(true);
    m(ud, "SetBGTex_LUA", "BG.TGA", "B");
    expect(first.pTexture).toBeNull();
    expect([b.m_pBGTex!.keyName, is(b.m_pBGPoint!.pUITextureData, b.m_pBGTex)]).toEqual(["B", true]);
    m(ud, "SetWindowTex_LUA", "W.TGA", "C");
    const win = b.m_pWindowTex!;
    m(ud, "SetWindowPoint_LUA", point(1, 2));
    m(ud, "SetWindowTex_LUA", "W.TGA", "D");
    expect(win.pTexture).toBeNull();
    expect(is(b.m_pWindowPoint!.pUITextureData, b.m_pWindowTex)).toBe(true);
    const all: unknown[] = [];
    b.textureData(all as never);
    expect(all.length).toBe(2);
  });

  test("SetBGPoint_LUA: a point at LEFT_TOP as big as the texture; SetWindowPoint_LUA draws the BACKGROUND texture too (the exe reads the wrong member)", () => {
    const { b, ud, m, point } = nav();
    m(ud, "SetBGTex_LUA", "BG.TGA", "A");
    m(ud, "SetWindowTex_LUA", "W.TGA", "B");
    m(ud, "SetBGPoint_LUA", point(10, 20));
    expect(corners(b.m_pBGPoint!)).toEqual([10, 20, 74, 20, 10, 52, 74, 52]); // the texture is 64 x 32
    m(ud, "SetWindowPoint_LUA", point(100, 200));
    const q = b.m_pWindowPoint!;
    expect([q.pUITextureData === b.m_pBGTex, q.pUITextureData === b.m_pWindowTex]).toEqual([true, false]);
    expect(corners(q)).toEqual([100, 200, 164, 200, 100, 232, 164, 232]);
  });

  test("SetCustomMsgLButtonDown (328CD120) and SetCustomMsgMouseDragging (328CD1B0, folded with the radio button's) write 0x2CC and 0x2D0", () => {
    const { b, ud, m } = nav();
    m(ud, "SetCustomMsgLButtonDown", 11);
    m(ud, "SetCustomMsgMouseDragging", 12);
    expect([b.m_CustomMsgLButtonDown, b.m_CustomMsgMouseDragging]).toEqual([11, 12]);
  });
});

// ---- CMovieData and the video player -----------------------------------------------------------------------------------------

describe("CMovieData", () => {
  function movie() {
    const s = setup();
    const mv = new CMovieData(s.w);
    return { ...s, mv, ud: s.wrap(mv, "CKTDGUIControl::CMovieData") };
  }

  /** a video player that records what it is asked and opens every file at 640 x 360 */
  function fakePlayer(openResult = 0) {
    const calls: string[] = [];
    let created = false;
    const library: BandiVideoLibrary = {
      isCreated: () => created,
      create: (dll) => (calls.push(`create ${dll}`), (created = true), 0),
      verify: (name, key) => (calls.push(`verify ${name} ${key}`), 0),
      close: () => void calls.push("close"),
      open: (path, flags) => (calls.push(`open ${path} ${flags}`), openResult),
      getVideoInfo: () => (calls.push("info"), { width: 640, height: 360 }),
      play: () => (calls.push("play"), 0),
      destroy: () => void calls.push("destroy"),
    };
    const texture = {
      opens: [] as number[][],
      closes: 0,
      deleted: 0,
      open(width: number, height: number) {
        this.opens.push([width, height]);
        return 0;
      },
      close() {
        this.closes++;
      },
      Destroy() {
        this.deleted++;
      },
    } satisfies BandiVideoTexture & { opens: number[][]; closes: number; deleted: number };
    return { calls, library, texture };
  }

  test("the constructor's defaults (329231E0): a player of its own that is not created, no texture, an empty name, hidden, not looping", () => {
    const { mv } = movie();
    expect([mv.m_wstrMovieFileName, mv.m_bShow, mv.m_bLoop, ...some(mv.m_pBvt, mv.m_pRenderTargetTexture)]).toEqual(["", false, false, "none", "none"]);
    expect([mv.m_vSize.x, mv.m_vSize.y, mv.m_vOriginPos.x, mv.m_vOriginPos.y, mv.m_vPos.x, mv.m_vPos.y]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(mv.m_Bvl.isCreated()).toBe(false);
  });

  test("SetLoop (328CD8B0) writes 0x71 and SetShow (328CDAF0, folded with CXMeshInstance::SetPerFrameSimulation) writes 0x70", () => {
    const { mv, ud, m } = movie();
    m(ud, "SetShow", true);
    expect([mv.m_bShow, mv.m_bLoop]).toEqual([true, false]);
    m(ud, "SetLoop", true);
    m(ud, "SetShow", false);
    expect([mv.m_bShow, mv.m_bLoop]).toEqual([false, true]);
  });

  test("SetRect keeps the position and size as floats and opens the render target \"MoveData\" at the size cut to whole pixels; a second call shares it", () => {
    const { w, mv, ud, m } = movie();
    m(ud, "SetRect", 10.5, 20, 640.7, 480.2);
    expect([mv.m_vOriginPos.x, mv.m_vOriginPos.y, mv.m_vSize.x, mv.m_vSize.y]).toEqual([10.5, 20, Math.fround(640.7), Math.fround(480.2)]);
    const target = mv.m_pRenderTargetTexture!;
    expect([target.deviceID, target.width, target.height, target.format, target.refCount]).toEqual(["MOVEDATA", 640, 480, D3DFMT_A8R8G8B8, 1]);
    m(ud, "SetRect", 0, 0, 100, 50);
    expect([is(mv.m_pRenderTargetTexture, target), target.width, target.height, target.refCount, w.devices.renderTargets.size]).toEqual([true, 640, 480, 2, 1]);
    expect([mv.m_vSize.x, mv.m_vSize.y]).toEqual([100, 50]);
  });

  test("SetMovieFileName on a machine without the player: the name is <current directory>\\movie\\<file>, nothing opens", () => {
    const { w, mv, ud, m } = movie();
    w.devices.currentDirectory = "C:\\Els";
    expect(new NoVideoLibrary().open()).toBe(E_FAIL);
    m(ud, "SetMovieFileName", "intro.avi");
    expect([mv.m_wstrMovieFileName, ...some(mv.m_pBvt), mv.m_Bvl.isCreated()]).toEqual(["C:\\Els\\movie\\intro.avi", "none", false]);
  });

  test("SetMovieFileName with a player that opens the file: create (once), verify, close, open, the video's size to the texture (made once), play", () => {
    const s = setup();
    const { calls, library, texture } = fakePlayer();
    s.w.devices.currentDirectory = "C:\\Els";
    s.w.devices.createVideoLibrary = () => library;
    s.w.devices.createVideoTexture = () => texture;
    const mv = new CMovieData(s.w);
    mv.SetMovieFileName("a.avi");
    expect(calls).toEqual([
      "create bdvid32.dll", "verify KOG_ELSWORD_20131203 1b9b533c", "close", "open C:\\Els\\movie\\a.avi 0", "info", "play",
    ]);
    expect([is(mv.m_pBvt, texture), texture.opens, texture.closes, mv.m_Info.width, mv.m_Info.height]).toEqual([true, [[640, 360]], 0, 640, 360]);
    calls.length = 0;
    mv.SetMovieFileName("b.avi");
    expect(calls).toEqual(["verify KOG_ELSWORD_20131203 1b9b533c", "close", "open C:\\Els\\movie\\b.avi 0", "info", "play"]);
    expect([texture.opens, texture.closes]).toEqual([[[640, 360], [640, 360]], 1]); // the texture is closed and opened again, not made again
  });

  test("a file the player cannot open stops SetMovieFileName after the open", () => {
    const s = setup();
    const { calls, library } = fakePlayer(E_FAIL);
    s.w.devices.createVideoLibrary = () => library;
    const mv = new CMovieData(s.w);
    mv.SetMovieFileName("missing.avi");
    expect(calls.slice(-1)).toEqual(["open \\movie\\missing.avi 0"]);
    expect(some(mv.m_pBvt)).toEqual(["none"]);
  });

  test("~CMovieData (32923740): the render target is closed, the player destroyed (it was created), the texture closed and deleted, then ~CBandiVideoLibrary (329840E0) runs", () => {
    const s = setup();
    const { calls, library, texture } = fakePlayer();
    s.w.devices.createVideoLibrary = () => library;
    s.w.devices.createVideoTexture = () => texture;
    const mv = new CMovieData(s.w);
    mv.SetRect(0, 0, 640, 360);
    mv.SetMovieFileName("a.avi");
    const events: string[] = [];
    library.destroy = () => void events.push(`destroy with ${s.w.devices.renderTargets.size} render targets open`);
    texture.close = () => void events.push("texture close");
    texture.Destroy = () => void events.push("texture delete");
    calls.length = 0;
    expect(s.w.devices.renderTargets.size).toBe(1);
    mv.Destroy();
    expect(events).toEqual(["destroy with 0 render targets open", "texture close", "texture delete", "destroy with 0 render targets open"]);
    expect([some(mv.m_pBvt, mv.m_pRenderTargetTexture), s.w.devices.renderTargets.size]).toEqual([["none", "none"], 0]);
  });

  test("~CMovieData of a movie that never played: nothing to close and no player to destroy, but ~CBandiVideoLibrary still runs (once)", () => {
    const s = setup();
    const { calls, library } = fakePlayer();
    s.w.devices.createVideoLibrary = () => library;
    const mv = new CMovieData(s.w);
    expect(library.isCreated()).toBe(false);
    mv.Destroy();
    expect(calls).toEqual(["destroy"]);
    mv.Destroy();
    expect(calls).toEqual(["destroy", "destroy"]);
  });

  test("CreateMovie makes one; a static keeps the movies it is given (AddMovieData)", () => {
    const { w, dialog, wrap, m } = setup();
    const mv = dialog().CreateMovie();
    expect(mv instanceof CMovieData).toBe(true);
    const st = new CKTDGUIStatic(w);
    m(wrap(st, "CKTDGUIStatic"), "AddMovieData", wrap(mv, "CKTDGUIControl::CMovieData"));
    expect(st.m_MovieDataList.map((x) => is(x, mv))).toEqual([true]);
  });
});

// ---- CKTDGUISlider -----------------------------------------------------------------------------------------------------------

describe("CKTDGUISlider", () => {
  function slider() {
    const s = setup();
    const d = s.dialog();
    d.m_pStage = s.stage;
    const b = new CKTDGUISlider(s.w);
    d.AddControl(b);
    return { ...s, d, b, ud: s.wrap(b, "CKTDGUISlider") };
  }

  test("the constructor's defaults (3294C6B0): 0..100 at 50, no size, no sounds", () => {
    const { w } = setup();
    const b = new CKTDGUISlider(w);
    expect(b.m_ControlType).toBe(UCT.SLIDER);
    expect([b.m_nMin, b.m_nMax, b.m_nValue, b.m_nDragOffset, b.m_nDragX, b.m_bPressed, b.m_CustomMsgValueChanged]).toEqual([0, 100, 50, 0, 0, false, -1]);
    expect([b.m_x, b.m_y, b.m_width, b.m_height, b.m_iButtonWidth, b.m_iButtonHeight, ...some(b.m_pBGTex, b.m_pButtonTex)]).toEqual([0, 0, 0, 0, 0, 0, "none", "none"]);
    expect([rc(b.m_rcButton), rc(b.m_rcBoundingBox)]).toEqual([[0, 0, 0, 0], [0, 0, 0, 0]]);
    expect([b.m_TempPoint.bUseTextureSize, b.m_TempPoint.color.a, b.m_TempPoint.kResize.x]).toEqual([true, 1, 1]);
    expect(w.devices.massFiles.log.entries).toEqual([]);
  });

  test("UpdateRects needs a width and a height; a button of no size is a square as high as the slider; the button's middle is at the value", () => {
    const { b, ud, m } = slider();
    m(ud, "SetPos", 10, 20);
    expect(rc(b.m_rcBoundingBox)).toEqual([0, 0, 0, 0]); // no size yet
    m(ud, "SetSize", 100, 0); // a width without a height
    expect(rc(b.m_rcBoundingBox)).toEqual([0, 0, 0, 0]);
    m(ud, "SetSize", 0, 20); // a height without a width
    expect(rc(b.m_rcBoundingBox)).toEqual([0, 0, 0, 0]);
    m(ud, "SetSize", 100, 20);
    expect([b.m_iButtonWidth, b.m_iButtonHeight]).toEqual([20, 20]);
    expect(rc(b.m_rcBoundingBox)).toEqual([10, 20, 110, 40]);
    // 50 of 0..100 over 100 pixels: 50 from the left, the middle of the 20 pixel button there
    expect([b.m_nButtonX, ...rc(b.m_rcButton)]).toEqual([50, 50, 20, 70, 40]);
  });

  test("SetButtonSize: the button is centred vertically with the integer division the exe does (toward zero), also when it is higher than the slider", () => {
    const { b, ud, m } = slider();
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 20);
    m(ud, "SetButtonSize", 10, 30);
    expect(rc(b.m_rcButton)).toEqual([55, 15, 65, 45]); // (20 - 30) / 2 = -5; 50 - 10 / 2 = 45 to the right
    m(ud, "SetButtonSize", 10, 31);
    expect(rc(b.m_rcButton)).toEqual([55, 15, 65, 46]); // (20 - 31) / 2 = -5 (not -6)
    m(ud, "SetButtonSize", 11, 20);
    expect(rc(b.m_rcButton)).toEqual([10 + 50 - 5, 20, 10 + 50 - 5 + 11, 40]); // 11 / 2 = 5
  });

  test("SetRange moves the value into the new range (a change is the control event 0x466 with 0) and the button with it", () => {
    const { b, ud, m, stageLog } = slider();
    m(ud, "SetPos", 10, 20);
    m(ud, "SetSize", 100, 20);
    m(ud, "SetRange", 0, 10);
    expect([b.m_nMin, b.m_nMax, b.m_nValue, stageLog]).toEqual([0, 10, 10, [[UIM.CONTROL_EVENT, 0]]]);
    expect([b.m_nButtonX, ...rc(b.m_rcButton)]).toEqual([100, 100, 20, 120, 40]);
    m(ud, "SetRange", 0, 10); // the value fits: no message
    expect(stageLog.length).toBe(1);
    m(ud, "SetValue", 5);
    expect([b.m_nValue, b.m_nButtonX, stageLog.length]).toEqual([5, 50, 2]);
    m(ud, "SetValue", 5); // unchanged: nothing
    expect(stageLog.length).toBe(2);
    m(ud, "SetValue", 99);
    expect(b.m_nValue).toBe(10);
    m(ud, "SetValue", -4);
    expect([b.m_nValue, stageLog.length]).toEqual([0, 4]);
  });

  test("a backwards range gives its maximum; an empty range divides by zero in floating point (the conversion is 0x80000000)", () => {
    const a = slider();
    a.m(a.ud, "SetValue", 5);
    a.m(a.ud, "SetRange", 10, 0); // min(0, max(5, 10)) = 0
    expect(a.b.m_nValue).toBe(0);
    const e = slider();
    e.m(e.ud, "SetSize", 100, 20);
    e.m(e.ud, "SetRange", 5, 5); // the value 50 becomes 5; (5 - 5) * 100 / (5 - 5) is NaN
    expect([e.b.m_nValue, e.b.m_nButtonX]).toEqual([5, -2147483648]);
  });

  test("the range starts anywhere: (value - min) * width / (max - min), cut to whole pixels (the sound option of the options window)", () => {
    const { b, ud, m } = slider();
    m(ud, "SetPos", 395, 352);
    m(ud, "SetSize", 228, 12);
    m(ud, "SetButtonSize", 12, 12);
    m(ud, "SetRange", -3000, -500);
    m(ud, "SetValue", -1500);
    expect([b.m_nButtonX, ...rc(b.m_rcButton)]).toEqual([136, 525, 352, 537, 364]); // 1500 * 228 / 2500 = 136.8
    m(ud, "SetValue", -500);
    expect([b.m_nButtonX, ...rc(b.m_rcButton)]).toEqual([228, 617, 352, 629, 364]);
    m(ud, "SetValue", -3000);
    expect([b.m_nButtonX, ...rc(b.m_rcButton)]).toEqual([0, 389, 352, 401, 364]);
  });

  test("SetCustomMsgValueChanged makes the message a custom one", () => {
    const { b, ud, m, stageLog } = slider();
    m(ud, "SetCustomMsgValueChanged", 33);
    expect(b.m_CustomMsgValueChanged).toBe(33);
    m(ud, "SetValue", 7);
    expect(stageLog).toEqual([[UIM.CUSTOM_MSG, 33]]);
  });

  test("SetBGTex / SetButtonTex destroy the texture they replace", () => {
    const { b, ud, m } = slider();
    m(ud, "SetBGTex", "S.TGA", "BG");
    m(ud, "SetButtonTex", "S.TGA", "BUTTON");
    const [bg, button] = [b.m_pBGTex!, b.m_pButtonTex!];
    expect([bg.keyName, button.keyName]).toEqual(["BG", "BUTTON"]);
    m(ud, "SetBGTex", "S.TGA", "BG2");
    m(ud, "SetButtonTex", "S.TGA", "BUTTON2");
    expect([bg.pTexture, button.pTexture]).toEqual([null, null]);
    const all: unknown[] = [];
    b.textureData(all as never);
    expect(all.length).toBe(2);
  });
});

// ---- CKTDGUIEditBox ----------------------------------------------------------------------------------------------------------

describe("CKTDGUIEditBox", () => {
  function edit() {
    const s = setup();
    const b = new CKTDGUIEditBox(s.w);
    return { ...s, b, ud: s.wrap(b, "CKTDGUIEditBox") };
  }

  test("the constructor's defaults (329323E0); it clears s_bHideCaret and runs UI_Control_Sound.lua", () => {
    const s = setup();
    CKTDGUIEditBox.s_bHideCaret = true;
    const b = new CKTDGUIEditBox(s.w);
    expect(CKTDGUIEditBox.s_bHideCaret).toBe(false);
    expect(b.m_ControlType).toBe(UCT.EDITBOX);
    expect([b.m_TextColor, b.m_SelTextColor, b.m_SelBkColor, b.m_CaretColor]).toEqual([0xff101010, 0xffffffff, 0xff28325c, 0xff000000]);
    expect([b.m_bCaretOn, b.m_bInsertMode, b.m_bMouseDrag, b.m_nCaret, b.m_nSelStart, b.m_nFirstVisible, b.m_bEnableInput]).toEqual([true, true, false, 0, 0, 0, true]);
    expect([b.m_bPasswordEditBox, b.m_HideChar, b.m_bOutlineCheck, b.m_bBGCheck]).toEqual([false, 42, false, false]);
    expect([b.m_CustomMsgEditBoxChange, b.m_CustomMsgEditBoxEnter, b.m_CustomMsgEditBoxFocusOut]).toEqual([-1, -1, -1]);
    expect(some(b.m_pFont, b.m_pNormalTex, b.m_pDisableTex, b.m_pNormalPoint, b.m_pDisablePoint, b.m_pTextPoint, b.m_pSndKeyDown)).toEqual(new Array(7).fill("none"));
    expect([b.m_NowFontColor.r, b.m_NowFontColor.a, b.m_OutlineColor.r, b.m_OutlineColor.a]).toEqual([0, 1, 1, 1]);
    expect(b.m_dfBlink).toBe(Math.fround(Math.fround(530) * Math.fround(0.0005)));
    expect([b.m_Buffer.GetTextSize(), rc(b.m_rcText)]).toEqual([0, [0, 0, 0, 0]]);
    expect(s.w.devices.massFiles.log.entries).toEqual([{ id: 0x87, text: "UI_CONTROL_SOUND.LUA" }, { id: 0x48, text: "UI_Control_Sound.lua" }]);
  });

  test("the textures and points: a texture setter hands the texture to the point that exists and marks the background; a point is sized from its texture", () => {
    const { b, ud, m, point } = edit();
    m(ud, "SetNormalTex", "E.TGA", "N");
    expect([b.m_pNormalTex!.keyName, b.m_bBGCheck]).toEqual(["N", true]);
    m(ud, "SetNormalPoint", point(3, 4));
    expect(corners(b.m_pNormalPoint!)).toEqual([3, 4, 67, 4, 3, 36, 67, 36]); // the texture is 64 x 32
    const first = b.m_pNormalTex!;
    m(ud, "SetNormalTex", "E.TGA", "N2");
    expect([first.pTexture, is(b.m_pNormalPoint!.pUITextureData, b.m_pNormalTex)]).toEqual([null, true]);
    m(ud, "SetDisablePoint", point(7, 8)); // no disable texture yet: no size
    expect(some(b.m_pDisablePoint!.pUITextureData)).toEqual(["none"]);
    m(ud, "SetDisableTex", "E.TGA", "D");
    expect([b.m_pDisableTex!.keyName, is(b.m_pDisablePoint!.pUITextureData, b.m_pDisableTex)]).toEqual(["D", true]);
    const all: unknown[] = [];
    b.textureData(all as never);
    expect(all.length).toBe(2);
  });

  test("SetTextPoint only keeps the point (the IME box also cuts m_rcText from it)", () => {
    const { b, ud, m, point } = edit();
    m(ud, "SetTextPoint", point(5, 6));
    expect([b.m_pTextPoint!.leftTopPoint.x, b.m_pTextPoint!.leftTopPoint.y]).toEqual([5, 6]);
    expect(rc(b.m_rcText)).toEqual([0, 0, 0, 0]);
  });

  test("SetFont looks the index up in the dialog manager's maps; the custom messages", () => {
    const { w, b, ud, m } = edit();
    m(ud, "SetFont", 4);
    expect(some(b.m_pFont)).toEqual(["none"]);
    const font = w.fonts.addUKFont(2);
    w.fonts.mapUIFontToUKFont(4, 2);
    m(ud, "SetFont", 4);
    expect(is(b.m_pFont, font)).toBe(true);
    m(ud, "SetCustomMsgChange", 21);
    m(ud, "SetCustomMsgEnter", 22);
    expect([b.m_CustomMsgEditBoxChange, b.m_CustomMsgEditBoxEnter, b.m_CustomMsgEditBoxFocusOut]).toEqual([21, 22, -1]);
  });

  test("the colour setters pack (int)(c * 255) per channel as ARGB, no rounding; the outline colour keeps four floats", () => {
    const { b, ud, m } = edit();
    m(ud, "SetTextColor", 1, 0.5, 0.25, 1);
    expect(b.m_TextColor).toBe(0xffff7f3f); // 127.5 -> 127, 63.75 -> 63
    m(ud, "SetSelectedTextColor", 0, 0, 0, 0.5);
    expect(b.m_SelTextColor).toBe(0x7f000000);
    m(ud, "SetSelectedBackColor", 0.2, 0.4, 0.6, 0.8);
    expect(b.m_SelBkColor).toBe(((204 << 24) | (51 << 16) | (102 << 8) | 153) >>> 0);
    m(ud, "SetCaretColor", 1, 1, 1, 1);
    expect(b.m_CaretColor).toBe(0xffffffff);
    m(ud, "SetOutlineColor", 1, 0, 0, 1);
    expect([b.m_bOutlineCheck, b.m_OutlineColor.r, b.m_OutlineColor.g, b.m_OutlineColor.b]).toEqual([true, Math.fround(255 * Math.fround(0.003921569)), 0, 0]);
    expect(b.m_OutlineColor.a).toBeCloseTo(1, 5);
  });

  test("SetHideChar makes a password box of the first character (0 for an empty string) and tells the buffer", () => {
    const { b, ud, m } = edit();
    m(ud, "SetHideChar", "\xe2\x97\x8f?"); // U+25CF as the script's UTF-8 bytes
    expect([b.m_HideChar, b.m_bPasswordEditBox, b.m_Buffer.m_bUseHideChar, b.m_Buffer.m_cHideChar]).toEqual([0x25cf, true, true, 0x25cf]);
    b.SetHideChar("");
    expect([b.m_HideChar, b.m_Buffer.m_cHideChar]).toEqual([0, 0]);
    b.SetHideChar(undefined);
    expect(b.m_HideChar).toBe(0);
  });
});

// ---- CKTDGUIContolList -------------------------------------------------------------------------------------------------------

describe("CKTDGUIContolList", () => {
  function list() {
    const s = setup();
    const d = s.dialog();
    d.m_pStage = s.stage;
    const b = new CKTDGUIContolList(s.w);
    d.AddControl(b);
    return { ...s, d, b, ud: s.wrap(b, "CKTDGUIContolList") };
  }

  test("the constructor's defaults (3294F030): no cells, the top (0, 0), a view and cells of 1 by 1, no bars, no sounds", () => {
    const { w } = setup();
    const b = new CKTDGUIContolList(w);
    expect(b.m_ControlType).toBe(UCT.CONTROLLIST);
    expect([b.m_mapControls.size, b.m_vecNowControls.length, ...some(b.m_pScrollBarX, b.m_pScrollBarY)]).toEqual([0, 0, "none", "none"]);
    expect([b.m_iTopIndexX, b.m_iTopIndexY, b.m_iMaxIndexX, b.m_iMaxIndexY, b.m_iViewSizeX, b.m_iViewSizeY, b.m_iScrollOffsetX, b.m_iScrollOffsetY]).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect([b.m_CustomMsgScroll, b.m_Pos.x, b.m_Pos.y, rc(b.m_rcBoundingBox)]).toEqual([-1, 0, 0, [0, 0, 0, 0]]);
    expect(w.devices.massFiles.log.entries).toEqual([]);
  });

  test("the twelve scroll bar texture setters each fill their own pointer (the offsets 0x230..0x25C) and destroy the texture they replace", () => {
    const { b, ud, m } = list();
    const fields = {
      SetXScollBarUpButtonTex: ["xTex", "upButton"], SetXScollBarUpButtonDownTex: ["xTex", "upButtonDown"], SetXScollBarDownButtonTex: ["xTex", "downButton"],
      SetXScollBarDownButtonDownTex: ["xTex", "downButtonDown"], SetXScollBarTrackTex: ["xTex", "track"], SetXScollBarThumbTex: ["xTex", "thumb"],
      SetYScollBarUpButtonTex: ["yTex", "upButton"], SetYScollBarUpButtonDownTex: ["yTex", "upButtonDown"], SetYScollBarDownButtonTex: ["yTex", "downButton"],
      SetYScollBarDownButtonDownTex: ["yTex", "downButtonDown"], SetYScollBarTrackTex: ["yTex", "track"], SetYScollBarThumbTex: ["yTex", "thumb"],
    } as const;
    for (const [lua, [axis, field]] of Object.entries(fields)) {
      m(ud, lua, "C.TGA", lua);
      const first = b[axis][field]!;
      expect(first.keyName).toBe(lua);
      m(ud, lua, "C.TGA", `${lua}2`);
      expect(first.pTexture).toBeNull();
      expect(b[axis][field]!.keyName).toBe(`${lua}2`);
    }
    const all: unknown[] = [];
    b.textureData(all as never);
    expect(all.length).toBe(12);
  });

  test("InitXScrollBar / InitYScrollBar make a bar in the list's dialog with the six textures of their axis and return it; the old bar is deleted", () => {
    const { w, b, ud, m, d } = list();
    for (const [axis, tag] of [["X", "x"], ["Y", "y"]] as const) {
      for (const part of ["UpButton", "UpButtonDown", "DownButton", "DownButtonDown", "Track", "Thumb"]) m(ud, `Set${axis}ScollBar${part}Tex`, "SB.TGA", `${tag}${part}`);
    }
    const [retX] = m(ud, "InitXScrollBar");
    const [retY] = m(ud, "InitYScrollBar");
    const [bx, by] = [b.m_pScrollBarX!, b.m_pScrollBarY!];
    expect([is((retX as { data: unknown }).data, bx), is((retY as { data: unknown }).data, by)]).toEqual([true, true]);
    expect([is(bx.m_pDialog, d), is(by.m_pDialog, d)]).toEqual([true, true]);
    expect([bx.m_pUpButtonTex!.keyName, bx.m_pUpButtonDownTex!.keyName, bx.m_pDownButtonTex!.keyName, bx.m_pDownButtonDownTex!.keyName, bx.m_pTrackTex!.keyName, bx.m_pThumbTex!.keyName]).toEqual([
      "xUpButton", "xUpButtonDown", "xDownButton", "xDownButtonDown", "xTrack", "xThumb",
    ]);
    expect(by.m_pThumbTex!.keyName).toBe("yThumb");
    expect(is(bx.m_pThumbTex, b.xTex.thumb)).toBe(true);
    // the old bar goes: the sound it had is closed
    w.devices.soundSystemInitialised = true;
    w.devices.massFiles.isValidFile = () => true;
    bx.m_pSndMouseDown = w.devices.openSound("a.wav");
    expect(w.devices.sounds.size).toBe(1);
    const [again] = m(ud, "InitXScrollBar");
    expect([is((again as { data: unknown }).data, bx), is(b.m_pScrollBarX, bx), w.devices.sounds.size, some(bx.m_pSndMouseDown)[0]]).toEqual([false, false, 0, "none"]);
  });

  test("the bar setters move and size a bar and update it; without the bar the exe faults (here: an error)", () => {
    const { b, ud, m } = list();
    for (const name of ["SetXScrollBarPos", "SetXScrollBarSize", "SetYScrollBarPos", "SetYScrollBarSize"]) expect(() => m(ud, name, 1, 2)).toThrow(/scroll bar/);
    expect(() => m(ud, "SetShowEnableXScroolBar", true, true)).toThrow(/X scroll bar/);
    expect(() => m(ud, "SetShowEnableYScroolBar", true, true)).toThrow(/Y scroll bar/);
    m(ud, "InitXScrollBar");
    m(ud, "InitYScrollBar");
    // each call updates the bar: a size with no position yet, the move, a new size
    const barX = b.m_pScrollBarX!, barY = b.m_pScrollBarY!;
    m(ud, "SetXScrollBarSize", 100, 16);
    expect([barX.m_width, barX.m_height, ...rc(barX.m_rcBoundingBox)]).toEqual([100, 16, 0, 0, 100, 16]);
    m(ud, "SetXScrollBarPos", 10, 20);
    expect([barX.m_x, barX.m_y, ...rc(barX.m_rcBoundingBox)]).toEqual([10, 20, 10, 20, 110, 36]);
    m(ud, "SetXScrollBarSize", 50, 8);
    expect(rc(barX.m_rcBoundingBox)).toEqual([10, 20, 60, 28]);
    m(ud, "SetYScrollBarSize", 16, 120);
    expect([barY.m_width, barY.m_height, ...rc(barY.m_rcBoundingBox)]).toEqual([16, 120, 0, 0, 16, 120]);
    m(ud, "SetYScrollBarPos", 300, 40);
    expect([barY.m_x, barY.m_y, ...rc(barY.m_rcBoundingBox)]).toEqual([300, 40, 300, 40, 316, 160]);
    m(ud, "SetYScrollBarSize", 8, 60);
    expect(rc(barY.m_rcBoundingBox)).toEqual([300, 40, 308, 100]);
    m(ud, "SetShowEnableYScroolBar", false, false);
    expect([b.m_pScrollBarY!.m_bShow, b.m_pScrollBarY!.m_bEnable]).toEqual([false, false]);
    m(ud, "SetShowEnableXScroolBar", true, false);
    expect([b.m_pScrollBarX!.m_bShow, b.m_pScrollBarX!.m_bEnable]).toEqual([true, false]);
  });

  test("SetPos only moves; SetScrollOffset and SetViewSize make the bounding box of view x cell size cells from the position, in float arithmetic", () => {
    const { b, ud, m } = list();
    m(ud, "SetPos", 10.7, 20.2);
    expect([b.m_Pos.x, b.m_Pos.y, rc(b.m_rcBoundingBox)]).toEqual([Math.fround(10.7), Math.fround(20.2), [0, 0, 0, 0]]);
    m(ud, "SetScrollOffset", 40, 30); // a view of 1 x 1
    expect(rc(b.m_rcBoundingBox)).toEqual([10, 20, 50, 50]);
    m(ud, "SetViewSize", 3, 4);
    expect([b.m_iViewSizeX, b.m_iViewSizeY, b.m_iScrollOffsetX, b.m_iScrollOffsetY]).toEqual([3, 4, 40, 30]);
    expect(rc(b.m_rcBoundingBox)).toEqual([10, 20, 130, 140]); // 3 * 40 + 10.7 = 130.7; 4 * 30 + 20.2 = 140.2
    setRect(b.m_rcBoundingBox, 0, 0, 0, 0);
    b.updateRects();
    expect(rc(b.m_rcBoundingBox)).toEqual([10, 20, 130, 140]);
    m(ud, "SetScrollOffset", 10, 20); // smaller cells: 3 * 10 + 10.7 = 40.7, 4 * 20 + 20.2 = 100.2
    expect(rc(b.m_rcBoundingBox)).toEqual([10, 20, 40, 100]);
    m(ud, "SetCustomMsgScroll", 77);
    expect(b.m_CustomMsgScroll).toBe(77);
  });

  test("InsertItem puts the control in its cell (row, column), grows the largest index, adds a control without a dialog to the list's dialog; the answer is false", () => {
    const { b, ud, m, d, w, wrap, dialog } = list();
    const make = (name: string) => {
      const x = new CKTDGUIStatic(w);
      x.SetName(name);
      return x;
    };
    const [a, c, e] = [make("a"), make("c"), make("e")];
    expect(m(ud, "InsertItem", wrap(a, "CKTDGUIStatic"), 2, 5, false)).toEqual([false]);
    m(ud, "InsertItem", wrap(c, "CKTDGUIStatic"), 2, 5, true);
    m(ud, "InsertItem", wrap(e, "CKTDGUIStatic"), 0, 1, false);
    expect([...b.m_mapControls].map(([r, col, infos]) => [r, col, infos.map((i) => [i.m_pControl.m_Name, i.m_bUseAbsolutePos])])).toEqual([
      [0, 1, [["e", false]]], [2, 5, [["a", false], ["c", true]]],
    ]);
    expect([b.m_iMaxIndexX, b.m_iMaxIndexY]).toEqual([5, 2]);
    expect([a, c, e].map((x) => is(x.m_pDialog, d))).toEqual([true, true, true]);
    expect(names(d.m_ControlsList.slice(-3))).toEqual(["a", "c", "e"]);
    // a control that is in a dialog already is not added again
    const other = make("other");
    dialog().AddControl(other);
    const before = d.m_ControlsList.length;
    b.InsertItem(other, 0, 0, false);
    expect([d.m_ControlsList.length, is(other.m_pDialog, d)]).toEqual([before, false]);
    // neither the list nor the control in a dialog: the exe dereferences a null handle
    const lonely = new CKTDGUIContolList(w);
    expect(() => lonely.InsertItem(make("x"), 0, 0, false)).toThrow(/dialog/);
  });

  test("UpdateRenderControlList places the controls inside the window (absolute ones from the list's position less the scroll) and marks the others out of the list", () => {
    const { b, ud, m, w, wrap } = list();
    m(ud, "SetPos", 100, 200);
    m(ud, "SetScrollOffset", 50, 30);
    m(ud, "SetViewSize", 2, 2);
    const cell = (row: number, col: number, abs = false) => {
      const c = new CKTDGUIStatic(w);
      c.SetName(`c${row}${col}`);
      m(ud, "InsertItem", wrap(c, "CKTDGUIStatic"), row, col, abs);
      return c;
    };
    const [c00, c01, c02, c10, c11, c12] = [cell(0, 0), cell(0, 1), cell(0, 2), cell(1, 0), cell(1, 1), cell(1, 2, true)];
    // the first cells beyond the window in each direction
    const [c03, c14, c21, c32] = [cell(0, 3), cell(1, 4), cell(2, 1), cell(3, 2)];
    b.setIndex(1, 0, true, false);
    const at = (c: CKTDGUIStatic) => [c.m_OffsetPos.x, c.m_OffsetPos.y];
    // columns 1..2 and rows 0..1 are in the window
    expect(names(b.m_vecNowControls)).toEqual(["c01", "c02", "c11", "c12"]);
    expect([c00, c10, c03, c14, c21, c32].map((c) => c.m_bOutofList)).toEqual([true, true, true, true, true, true]);
    expect([c01, c02, c11, c12].map((c) => c.m_bOutofList)).toEqual([false, false, false, false]);
    expect([at(c01), at(c02), at(c11)]).toEqual([[100, 200], [150, 200], [100, 230]]);
    expect(at(c12)).toEqual([100 - 1 * 50, 200 - 0 * 30]); // absolute: the list's position less the scroll
    // scrolled on: columns 2..3 and rows 1..2; (1, 4) is the first column and (3, 2) the first row beyond
    b.setIndex(2, 1, true, false);
    expect(names(b.m_vecNowControls)).toEqual(["c12"]);
    expect([c01, c12, c10, c14, c32, c21].map((c) => c.m_bOutofList)).toEqual([true, false, true, true, true, true]);
    expect(at(c12)).toEqual([100 - 2 * 50, 200 - 1 * 30]);
    // columns 1..2 and rows 1..2: the cells are placed from the top cell, not from the first
    b.setIndex(1, 1, true, false);
    expect(names(b.m_vecNowControls)).toEqual(["c11", "c12", "c21"]);
    expect([at(c11), at(c21)]).toEqual([[100, 200], [100, 230]]);
    expect(at(c12)).toEqual([100 - 1 * 50, 200 - 1 * 30]);
  });

  test("setIndex sends the custom scroll message when there is one and it is asked to; setShowAt shows or hides the cells that match (-1 matches all)", () => {
    const { b, ud, m, w, wrap, stageLog } = list();
    const cell = (row: number, col: number) => {
      const c = new CKTDGUIStatic(w);
      m(ud, "InsertItem", wrap(c, "CKTDGUIStatic"), row, col, false);
      return c;
    };
    const [a, c, e] = [cell(0, 0), cell(0, 1), cell(1, 1)];
    b.setIndex(0, 0, false, true); // no custom message: none sent
    expect(stageLog.length).toBe(0);
    m(ud, "SetCustomMsgScroll", 61);
    b.setIndex(0, 1, false, false);
    expect(stageLog.length).toBe(0);
    b.setIndex(0, 2, false, true);
    expect([b.m_iTopIndexX, b.m_iTopIndexY, stageLog]).toEqual([0, 2, [[UIM.CUSTOM_MSG, 61]]]);
    b.setShowAt(false, -1, 1);
    expect([a.m_bShow, c.m_bShow, e.m_bShow]).toEqual([true, false, false]);
    b.setShowAt(true, 1, -1);
    expect([a.m_bShow, c.m_bShow, e.m_bShow]).toEqual([true, false, true]);
    b.setShowAt(false, -1, -1);
    expect([a.m_bShow, c.m_bShow, e.m_bShow]).toEqual([false, false, false]);
  });

  test("UpdateScrollBar (through SetViewSize): a bar whose axis has more cells than the view is shown and ranged 0 .. max - view + 2", () => {
    const { b, ud, m, w, wrap } = list();
    m(ud, "InitYScrollBar");
    for (let row = 0; row < 10; row++) m(ud, "InsertItem", wrap(new CKTDGUIStatic(w), "CKTDGUIStatic"), row, 0, false);
    const bar = b.m_pScrollBarY!;
    bar.SetShowEnable(false, false);
    m(ud, "SetViewSize", 1, 4);
    expect([bar.m_bShow, bar.m_bEnable, bar.m_nStart, bar.m_nEnd]).toEqual([true, true, 0, 7]); // 9 - 4 + 2
    // a view that holds all ten rows: the bar is left alone; one row fewer (the largest index 9 is not less than the view): it is there
    bar.SetShowEnable(false, false);
    m(ud, "SetViewSize", 1, 10);
    expect([bar.m_bShow, bar.m_nEnd]).toEqual([false, 7]);
    m(ud, "SetViewSize", 1, 9);
    expect([bar.m_bShow, bar.m_bEnable, bar.m_nEnd]).toEqual([true, true, 2]); // 9 - 9 + 2
  });

  test("UpdateScrollBar's bug: the X bar's position is set on the Y bar (and an X bar without a Y bar faults)", () => {
    const { b, ud, m, w, wrap } = list();
    m(ud, "InitXScrollBar");
    for (let col = 0; col < 2; col++) m(ud, "InsertItem", wrap(new CKTDGUIStatic(w), "CKTDGUIStatic"), 0, col, false);
    m(ud, "SetViewSize", 2, 2); // the view holds both columns (the largest index 1 is less than 2): the X bar is left alone
    expect(() => m(ud, "SetViewSize", 1, 2)).toThrow(/Y scroll bar/); // the largest index is not less than the view: the X bar is looked after, and with it the Y bar
    for (let col = 2; col < 6; col++) m(ud, "InsertItem", wrap(new CKTDGUIStatic(w), "CKTDGUIStatic"), 0, col, false);
    expect(() => m(ud, "SetViewSize", 2, 2)).toThrow(/Y scroll bar/);
    m(ud, "InitYScrollBar");
    const [bx, by] = [b.m_pScrollBarX!, b.m_pScrollBarY!];
    by.setTrackRange(0, 10);
    by.m_nPageSize = 2;
    m(ud, "SetViewSize", 2, 2); // the Y bar needs nothing: its axis has one row, the view two
    expect([bx.m_nStart, bx.m_nEnd, bx.m_nPosition]).toEqual([0, 5, 0]); // 5 - 2 + 2
    b.setIndex(3, 0, false, false);
    expect([by.m_nPosition, bx.m_nPosition]).toEqual([3, 0]); // the X index went to the Y bar
  });
});

// ---- CX2MapSelectWindow ------------------------------------------------------------------------------------------------------

describe("CX2MapSelectWindow", () => {
  const names = Array.from({ length: 10 }, (_, i) => `map ${i}`);

  function window() {
    const s = setup(new StringTable(names));
    const win = new CX2MapSelectWindow(s.w);
    return { ...s, win, ud: s.wrap(win, "CX2StatePVPRoom::CX2MapSelectWindow") };
  }

  const info = (fields: Record<string, number | string>) => {
    const table = new LuaTable();
    for (const [k, v] of Object.entries(fields)) table.setStr(k, v);
    return table;
  };

  test("AddMapInfo_LUA reads the table: ids, flags, the name from the string table and the four texture names", () => {
    const { win, ud, m } = window();
    m(ud, "AddMapInfo_LUA", info({
      m_WorldID: 546, m_bHot: 1, m_bNew: 0, m_MapName: 3, m_MapTexName: "P.dds", m_MapTexKeyName: "IMG", m_MapNameTexName: "T.dds", m_MapNameTexKeyName: "TITLE",
    }));
    expect(win.m_vecpMapInfo).toEqual([{
      m_WorldID: 546, m_bHot: true, m_bNew: false, m_MapName: "map 3", m_MapTexName: "P.dds", m_MapTexKeyName: "IMG", m_MapNameTexName: "T.dds", m_MapNameTexKeyName: "TITLE",
    }]);
    m(ud, "AddMapInfo_LUA", info({}));
    expect(win.m_vecpMapInfo[1]).toEqual({
      m_WorldID: 0, m_bHot: false, m_bNew: false, m_MapName: "", m_MapTexName: "", m_MapTexKeyName: "", m_MapNameTexName: "", m_MapNameTexKeyName: "",
    });
  });

  test("a new map goes in front of the first one that is not new, the others to the end", () => {
    const { win, ud, m } = window();
    for (const [id, isNew] of [[1, 0], [2, 1], [3, 0], [4, 1], [5, 1]] as const) m(ud, "AddMapInfo_LUA", info({ m_WorldID: id, m_bNew: isNew }));
    // 1; 2 before 1 -> 2 1; 3 -> 2 1 3; 4 before the first old one (1) -> 2 4 1 3; 5 -> 2 4 5 1 3
    expect(win.m_vecpMapInfo.map((i) => i.m_WorldID)).toEqual([2, 4, 5, 1, 3]);
    // all new: appended
    const all = window();
    for (const id of [1, 2, 3]) all.m(all.ud, "AddMapInfo_LUA", info({ m_WorldID: id, m_bNew: 1 }));
    expect(all.win.m_vecpMapInfo.map((i) => i.m_WorldID)).toEqual([1, 2, 3]);
  });

  test("OpenScript: the list is emptied, the object becomes g_pMapSelectWindow, and a script that is not there is 0x87, 0x48 and 0x2793", () => {
    const { w, win, ud, m } = window();
    m(ud, "AddMapInfo_LUA", info({ m_WorldID: 1 }));
    expect(win.openScript("NOT_THERE.lua")).toBe(false);
    expect(win.m_vecpMapInfo.length).toBe(0);
    expect(is((w.world.G.globals.getStr("g_pMapSelectWindow") as { data: unknown }).data, win)).toBe(true);
    expect(w.devices.massFiles.log.entries).toEqual([
      { id: 0x87, text: "NOT_THERE.LUA" }, { id: 0x48, text: "NOT_THERE.lua" }, { id: 0x2793, text: "NOT_THERE.lua" },
    ]);
  });

  test("OpenScript: an empty name, a script that fails, a script that runs", () => {
    const { w, win } = window();
    expect(win.openScript("")).toBe(false);
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x48, text: "" }, { id: 0x2793, text: "" }]);
    w.devices.massFiles.log.entries.length = 0;
    w.world.execScript = () => {
      throw new LuaError("X.lua:1: boom");
    };
    expect(win.openScript("X.lua")).toBe(false);
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x49, text: "X.lua" }, { id: 0x2793, text: "X.lua" }]);
    w.devices.massFiles.log.entries.length = 0;
    w.world.execScript = () => true;
    expect(win.openScript("Y.lua")).toBe(true);
    expect(w.devices.massFiles.log.entries).toEqual([]);
  });
});

// ---- the order of the controls -----------------------------------------------------------------------------------------------

describe("CKTDGUIDialog.ChangeSequence*", () => {
  function four() {
    const s = setup();
    const d = s.dialog();
    const [a, b, c, e] = ["A", "B", "C", "E"].map((name) => {
      const x = new CKTDGUIStatic(s.w);
      x.SetName(name);
      d.AddControl(x);
      return x;
    }) as [CKTDGUIStatic, CKTDGUIStatic, CKTDGUIStatic, CKTDGUIStatic];
    return { ...s, d, a, b, c, e, order: () => names(d.m_ControlsList).join("") };
  }

  test("changeSequence (329566E0): to the end (bFront: drawn last) or to the beginning; false for a control that is not in the list", () => {
    const { w, d, b, order } = four();
    expect(d.changeSequence(b, true)).toBe(true);
    expect(order()).toBe("ACEB");
    expect(d.changeSequence(b, false)).toBe(true);
    expect(order()).toBe("BACE");
    expect([d.changeSequence(undefined, true), d.changeSequence(new CKTDGUIStatic(w), true)]).toEqual([false, false]);
    expect(order()).toBe("BACE");
  });

  test("changeSequenceByPivot (32956590): right behind the pivot (bFront) or in front of it; nothing when either is missing; a control that is its own pivot disappears", () => {
    const { w, d, a, b, c, e, order } = four();
    d.changeSequenceByPivot(a, c, true);
    expect(order()).toBe("BCAE");
    d.changeSequenceByPivot(e, b, false);
    expect(order()).toBe("EBCA");
    const stranger = new CKTDGUIStatic(w);
    d.changeSequenceByPivot(stranger, b, true);
    d.changeSequenceByPivot(a, stranger, true);
    d.changeSequenceByPivot(undefined, b, true);
    d.changeSequenceByPivot(a, undefined, true);
    expect(order()).toBe("EBCA");
    d.changeSequenceByPivot(b, b, true);
    expect(order()).toBe("ECA");
  });

  test("the Lua methods look the control up first, then the pivot (a name that is not there is error 0x24 and the order stays)", () => {
    const { w, d, order } = four();
    d.ChangeSequenceByName("B", true);
    expect(order()).toBe("ACEB");
    d.ChangeSequenceByNameAndPivot("A", "C", true);
    expect(order()).toBe("CAEB");
    w.devices.massFiles.log.entries.length = 0;
    d.ChangeSequenceByNameAndPivot("A", "NOPE", true);
    d.ChangeSequenceByNameAndPivot("NOPE1", "NOPE2", false);
    d.ChangeSequenceByName("NOPE3", false);
    expect(order()).toBe("CAEB");
    expect(w.devices.massFiles.log.entries.map((x) => [x.id, x.text.split(" ")[0]])).toEqual([[0x24, "NOPE"], [0x24, "NOPE1"], [0x24, "NOPE2"], [0x24, "NOPE3"]]);
  });
});

// ---- the real client data ----------------------------------------------------------------------------------------------------

let source: KomMassFileSource;
let strings: StringTable;

beforeAll(async () => {
  if (!haveData) return;
  source = new KomMassFileSource(await indexAllKoms(), 64 * 1024);
  strings = StringTable.fromEss(new Uint8Array(readFileSync(join(dataDir, "general.ess"))));
}, 60_000);

/** run one script the way the census does and hand the dialog and the owners to `check` */
async function run<T>(script: string, check: (w: UIWorld, d: ReturnType<UIWorld["openDialog"]>, owners: ReturnType<UIWorld["createOwners"]>) => T): Promise<void> {
  await source.settle(() => {
    const w = new UIWorld({ source, strings, notPorted: "throw" });
    w.boot();
    const owners = w.createOwners();
    const d = w.openDialog(script, 0, new CX2SlotManager(w));
    check(w, d, owners);
    return d;
  });
}

describe("the controls of the real scripts", () => {
  t("DLG_UI_QUEST.LUA: two navigations; the window point draws the background texture, and the custom messages are the script's", async () => {
    await run("DLG_UI_QUEST.LUA", (_w, d) => {
      expect(d.m_bSuccessInitOpenScript).toBe(true);
      const navs = d.m_ControlsList.filter((c): c is CKTDGUINavigation => c instanceof CKTDGUINavigation);
      expect(navs.map((n) => n.m_Name)).toEqual(["Navi_QuestList", "Navi_QuestComment"]);
      const n = navs[0]!;
      expect([n.m_pBGTex!.texName, n.m_pBGTex!.keyName, n.m_pWindowTex!.texName, n.m_pWindowTex!.keyName]).toEqual([
        "DLG_Room_Button0.tga", "Invisible", "DLG_Common_New_Texture61.tga", "Scroll_Bar",
      ]);
      expect([n.m_CustomMsgLButtonDown, n.m_CustomMsgMouseDragging, navs[1]!.m_CustomMsgLButtonDown, navs[1]!.m_CustomMsgMouseDragging]).toEqual([25010, 25011, 25012, 25013]);
      const [bg, win] = [n.m_pBGPoint!, n.m_pWindowPoint!];
      expect([bg.leftTopPoint.x, bg.leftTopPoint.y, bg.rightBottomPoint.x, bg.rightBottomPoint.y]).toEqual([398, 95, 421, 221]);
      expect([win.leftTopPoint.x, win.leftTopPoint.y, win.rightBottomPoint.x, win.rightBottomPoint.y]).toEqual([398, 95, 421, 135]);
      expect(is(win.pUITextureData, n.m_pBGTex)).toBe(true); // the exe's bug, in the data that shows it
    });
  }, 60_000);

  t("DLG_OPTION_WINDOW_SOUND.LUA: two sliders whose buttons stand where their values are", async () => {
    await run("DLG_OPTION_WINDOW_SOUND.LUA", (_w, d) => {
      const sliders = d.m_ControlsList.filter((c): c is CKTDGUISlider => c instanceof CKTDGUISlider);
      expect(sliders.map((s) => s.m_Name)).toEqual(["Slider_BGM_Volume", "Slider_Sound_Volume"]);
      const s = sliders[0]!;
      expect([s.m_x, s.m_y, s.m_width, s.m_height, s.m_iButtonWidth, s.m_iButtonHeight, s.m_nMin, s.m_nMax, s.m_nValue]).toEqual([395, 352, 228, 12, 12, 12, -3000, -500, -1500]);
      // (-1500 - -3000) * 228 / (-500 - -3000) = 136.8 -> 136; the button's middle is there
      expect([s.m_nButtonX, ...rc(s.m_rcButton), ...rc(s.m_rcBoundingBox)]).toEqual([136, 525, 352, 537, 364, 395, 352, 623, 364]);
      expect([s.m_CustomMsgValueChanged, sliders[1]!.m_CustomMsgValueChanged]).toEqual([2026, 2025]);
    });
  }, 60_000);

  t("DLG_LOGIN_BACK.LUA: the password boxes hide their text with '*' and have the script's colours and text rectangle", async () => {
    await run("DLG_LOGIN_BACK.LUA", (_w, d) => {
      const boxes = d.m_ControlsList.filter((c): c is CKTDGUIEditBox => c instanceof CKTDGUIEditBox);
      expect(boxes.map((b) => b.m_Name)).toEqual(["EditBoxLoginPassword", "EditBoxLoginPassword100"]);
      const b = boxes[0]!;
      expect([b.m_TextColor, b.m_SelTextColor, b.m_SelBkColor, b.m_CaretColor]).toEqual([0xffffffff, 0xff000000, 0xffff0000, 0xffffffff]);
      expect([b.m_bPasswordEditBox, b.m_HideChar, b.m_Buffer.m_bUseHideChar, b.m_pFont !== null]).toEqual([true, 42, true, true]);
      expect([b.m_pTextPoint!.leftTopPoint.x, b.m_pTextPoint!.leftTopPoint.y, b.m_pTextPoint!.rightBottomPoint.x, b.m_pTextPoint!.rightBottomPoint.y]).toEqual([250, 535, 388, 553]);
      expect(boxes[1]!.m_TextColor).toBe(0xff002e52);
    });
  }, 60_000);

  t("DLG_UNIT_SELECT_BACK_NEW.LUA: the promotion movie is a static's movie data with its rectangle, its render target and the name under \\movie\\", async () => {
    await run("DLG_UNIT_SELECT_BACK_NEW.LUA", (w, d) => {
      const st = d.m_ControlsList.find((c) => c.m_Name === "PromotionMovie") as CKTDGUIStatic;
      expect(st.m_MovieDataList.length).toBe(1);
      const mv = st.m_MovieDataList[0]!;
      expect([mv.m_wstrMovieFileName, mv.m_vOriginPos.x, mv.m_vOriginPos.y, mv.m_vSize.x, mv.m_vSize.y, mv.m_bShow, mv.m_bLoop]).toEqual(["\\movie\\Movie_Title.avi", 0, 96, 1024, 576, true, false]);
      expect([mv.m_pRenderTargetTexture!.deviceID, mv.m_pRenderTargetTexture!.width, mv.m_pRenderTargetTexture!.height, mv.m_pRenderTargetTexture!.refCount]).toEqual(["MOVEDATA", 1024, 576, 1]);
      expect([mv.m_Bvl.isCreated(), mv.m_pBvt, w.devices.renderTargets.size]).toEqual([false, null, 1]);
    });
  }, 60_000);

  t("DLG_MEMOLIST.LUA and DLG_UI_SKILL_TREE.LUA: control lists with the bounding box their view and cell size make, and a Y bar", async () => {
    await run("DLG_MEMOLIST.LUA", (_w, d) => {
      const l = d.m_ControlsList.find((c): c is CKTDGUIContolList => c instanceof CKTDGUIContolList)!;
      expect([l.m_Name, l.m_Pos.x, l.m_Pos.y, l.m_iViewSizeX, l.m_iViewSizeY, l.m_iScrollOffsetX, l.m_iScrollOffsetY]).toEqual(["MemoControlList", 562, 67, 3, 8, 0, 48]);
      expect(rc(l.m_rcBoundingBox)).toEqual([562, 67, 562, 451]); // 3 * 0, 8 * 48 + 67
      const bar = l.m_pScrollBarY!;
      expect([l.m_pScrollBarX, bar.m_x, bar.m_y, bar.m_width, bar.m_height, bar.m_pDialog]).toEqual([null, 700, 69, 16, 382, d]);
      expect([l.m_CustomMsgScroll, l.m_mapControls.size]).toEqual([-1, 0]);
    });
    await run("DLG_UI_SKILL_TREE.LUA", (_w, d) => {
      const l = d.m_ControlsList.find((c): c is CKTDGUIContolList => c instanceof CKTDGUIContolList)!;
      expect([l.m_Name, l.m_iViewSizeX, l.m_iViewSizeY, l.m_iScrollOffsetX, l.m_iScrollOffsetY, l.m_CustomMsgScroll]).toEqual(["SkillTreeControlList", 5, 5, 80, 92, 29019]);
      expect(rc(l.m_rcBoundingBox)).toEqual([19, 84, 19 + 5 * 80, 84 + 5 * 92]);
      expect([l.m_pScrollBarY!.m_x, l.m_pScrollBarY!.m_y, l.m_pScrollBarY!.m_width, l.m_pScrollBarY!.m_height]).toEqual([415, 80, 21, 467]);
    });
  }, 60_000);

  t("DLG_PVP_MAP_LIST.LUA: 14 maps in the window's list, the new ones in front, the names from the string table", async () => {
    await run("DLG_PVP_MAP_LIST.LUA", (_w, _d, owners) => {
      const maps = owners.mapSelectWindow.m_vecpMapInfo;
      expect(maps.length).toBe(14);
      expect(maps.map((x) => (x.m_bNew ? "N" : x.m_bHot ? "H" : "-")).join("")).toBe("NNH---H-------");
      expect([maps[0]!.m_WorldID, maps[0]!.m_MapTexName, maps[0]!.m_MapTexKeyName, maps[0]!.m_MapNameTexKeyName]).toEqual([
        546, "DLG_New_PVP_Image05.dds", "MAP_SELECT_IMAGE_KARUPAI", "MAP_TITLE_ALL_KARUPAI",
      ]);
      for (const map of maps) expect(map.m_MapName.length).toBeGreaterThan(0);
    });
  }, 60_000);

  t("DLG_PVP_LOBBY_CHARBG.LUA: the pivot it names is in another dialog: error 0x24 and the order stays", async () => {
    await run("DLG_PVP_LOBBY_CHARBG.LUA", (w, d) => {
      expect(d.m_ControlsList.map((c) => c.m_Name)).toEqual(["StaticPVP_Lobby_CharBG"]);
      const missing = w.devices.massFiles.log.entries.filter((e) => e.id === 0x24);
      expect(missing.length).toBe(1);
      expect(missing[0]!.text.startsWith("CommonBlackUpDownBG")).toBe(true);
    });
  }, 60_000);
});

describe("the sounds of the new controls", () => {
  t("the navigation opens Button_Mouse_Up and the edit box EditBox_KeyDown (UI_Control_Sound.lua); a slider and a control list have none", async () => {
    await source.settle(() => {
      const w = new UIWorld({ source, strings, notPorted: "throw" });
      w.boot();
      w.devices.soundSystemInitialised = true;
      w.devices.massFiles.isValidFile = () => true;
      const g = (name: string) => String(w.world.G.globals.getStr(name)).toUpperCase();
      const nav = new CKTDGUINavigation(w);
      const edit = new CKTDGUIEditBox(w);
      expect([nav.m_pSndMouseDown?.deviceID, edit.m_pSndKeyDown?.deviceID]).toEqual([g("Button_Mouse_Up"), g("EditBox_KeyDown")]);
      expect(g("Button_Mouse_Up")).not.toBe(g("EditBox_KeyDown"));
      expect(g("Button_Mouse_Up")).not.toBe("UNDEFINED");
      expect(w.devices.sounds.size).toBe(2);
      new CKTDGUISlider(w);
      new CKTDGUIContolList(w);
      expect(w.devices.sounds.size).toBe(2);
      return 0;
    });
  }, 60_000);
});

describe("every method the exe registers for the new classes is implemented", () => {
  test("Navigation 6, CMovieData 4, Slider 8, ControlList 25, EditBox 14, MapSelectWindow 1", () => {
    const { w } = setup();
    const status = w.world.rt.status();
    const want: Record<string, number> = {
      CKTDGUINavigation: 6, "CKTDGUIControl::CMovieData": 4, CKTDGUISlider: 8, CKTDGUIContolList: 25, CKTDGUIEditBox: 14, "CX2StatePVPRoom::CX2MapSelectWindow": 1,
    };
    for (const [cls, total] of Object.entries(want)) {
      const s = status.find((c) => c.cls === cls)!;
      expect([cls, s.total, s.implemented, s.missing]).toEqual([cls, total, total, []]);
    }
  });
});
