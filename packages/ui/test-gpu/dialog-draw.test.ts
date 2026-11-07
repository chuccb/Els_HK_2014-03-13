/**
 * Dialogs of the client drawn through the whole stack: the real DLG script on the Lua VM, the ported UI classes (`UIWorld`: Static and Button
 * pictures through `CKTDGUIDialog::OnFrameRender`), the state manager, the dynamic vertex buffers, and `Direct3DDevice9` on WebGPU.
 *
 * Every quad the UI hands to `DrawPrimitive` is written down with the device state it is drawn with, composed again on the CPU by the rules
 * of Direct3D 9 (`reference.ts`, itself pinned by test/reference.test.ts), and the picture the device made has to agree with that.  The
 * pictures are saved when `D3D9_TEST_OUT` names a folder.
 *
 * Needs a WebGPU adapter (`./tools/gpu.sh`: SwiftShader) and the client's data; skipped without them.  Heavy (all the textures of a
 * dialog are decoded and uploaded), so `tools/test-packages.sh` runs this folder in a process of its own.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable, decodeImage } from "@els/assets";
import { D3DCLEAR, D3DRS, D3DSAMP } from "@els/d3d9";
import type { Direct3DDevice9, Direct3DTexture9 } from "@els/d3d9";
import { CKTDGUIStatic, CX2SlotManager, UIWorld } from "../src/index.ts";
import type { CKTDGUIDialog } from "../src/index.ts";
import { gpuAvailable, newD3D9, snap } from "../../d3d9/test/gpu-helper.ts";
import { indexAllKoms, KomMassFileSource } from "../../../tools/komindex.ts";
import { compareImages, drawQuad, newTarget } from "./reference.ts";
import type { Difference, RefImage } from "./reference.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const HAVE_GPU = haveData && (await gpuAvailable());

/** the back buffer of the game's default window; the dialogs are laid out in 1024 x 768 */
const WIDTH = 1024;
const HEIGHT = 768;
const CLEAR = [0x2d, 0x33, 0x40];

interface Fixture {
  source: KomMassFileSource;
  strings: StringTable;
  dev: Direct3DDevice9;
}
let fixture: Promise<Fixture> | undefined;
const getFixture = (): Promise<Fixture> =>
  (fixture ??= (async () => {
    const index = await indexAllKoms();
    const source = new KomMassFileSource(index); // the whole textures: they are decoded and uploaded
    await source.load([...index.keys()].filter((n) => n.endsWith(".LUA")));
    const strings = StringTable.fromEss(new Uint8Array(readFileSync(join(dataDir, "general.ess"))));
    return { source, strings, dev: await newD3D9(WIDTH, HEIGHT) };
  })());

/** one `DrawPrimitive` of the dynamic vertex buffer manager and the device state it was made with */
interface Draw {
  type: number;
  primitive: number;
  numPrimitives: number;
  data: Uint8Array;
  numDraws: number;
  texture: Direct3DTexture9 | null;
  blendEnable: number;
  srcBlend: number;
  destBlend: number;
  alphaTest: number;
  zEnable: number;
  minFilter: number;
  magFilter: number;
  addressU: number;
  addressV: number;
}

interface Drawn {
  w: UIWorld;
  dlg: CKTDGUIDialog;
  ret: number;
  draws: Draw[];
  image: RefImage;
  reference: RefImage;
}

/** open a dialog script in a world with the device, draw it once on a cleared back buffer, and compose the same quads on the CPU */
async function drawDialog(script: string, savedAs?: string): Promise<Drawn> {
  const { source, strings, dev } = await getFixture();
  const build = (device?: Direct3DDevice9) => {
    const w = new UIWorld({ source, strings, notPorted: "throw", device, backBuffer: { width: WIDTH, height: HEIGHT } });
    w.boot();
    w.createOwners();
    return { w, dlg: w.openDialog(script, 0, new CX2SlotManager(w)) };
  };
  await source.settle(() => build()); // a run that touched a member that was not loaded yet does not count: load them first
  const { w, dlg } = build(dev);
  const render = w.render!;

  const draws: Draw[] = [];
  const real = render.dvb.drawPrimitive.bind(render.dvb);
  render.dvb.drawPrimitive = (type, primitive, numPrimitives, data, numDraws) => {
    const s = render.states;
    draws.push({
      type, primitive, numPrimitives, numDraws, data: data ? data.slice() : new Uint8Array(0), texture: s.apd3dTextures[0] ?? null,
      blendEnable: s.adwRenderState[D3DRS.ALPHABLENDENABLE]!, srcBlend: s.adwRenderState[D3DRS.SRCBLEND]!, destBlend: s.adwRenderState[D3DRS.DESTBLEND]!,
      alphaTest: s.adwRenderState[D3DRS.ALPHATESTENABLE]!, zEnable: s.adwRenderState[D3DRS.ZENABLE]!,
      minFilter: s.adwSamplerState[D3DSAMP.MINFILTER]!, magFilter: s.adwSamplerState[D3DSAMP.MAGFILTER]!,
      addressU: s.adwSamplerState[D3DSAMP.ADDRESSU]!, addressV: s.adwSamplerState[D3DSAMP.ADDRESSV]!,
    });
    real(type, primitive, numPrimitives, data, numDraws);
  };

  dev.BeginScene();
  dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, (0xff000000 | (CLEAR[0]! << 16) | (CLEAR[1]! << 8) | CLEAR[2]!) >>> 0, 1, 0);
  const ret = dlg.onFrameRender(true);
  dev.EndScene();
  const shot = await snap(dev);
  if (savedAs) shot.save(savedAs);
  const image: RefImage = { width: shot.width, height: shot.height, rgba: shot.rgba };

  // the textures as the files say they are, found through the Direct3D texture the stage held
  const owner = new Map<Direct3DTexture9, Uint8Array>();
  for (const t of w.devices.devices.values()) if (t.m_pTexture) owner.set(t.m_pTexture, t.data);
  const decoded = new Map<Direct3DTexture9, RefImage>();
  const textureOf = (t: Direct3DTexture9 | null): RefImage | null => {
    if (!t) return null;
    let img = decoded.get(t);
    if (!img) {
      const bytes = owner.get(t);
      if (!bytes) throw new Error("a texture on stage 0 that no device texture owns");
      const d = decodeImage(bytes);
      img = { width: d.width, height: d.height, rgba: d.rgba };
      decoded.set(t, img);
    }
    return img;
  };
  const reference = newTarget(WIDTH, HEIGHT, CLEAR[0]!, CLEAR[1]!, CLEAR[2]!);
  for (const d of draws) {
    drawQuad(reference, {
      vertices: d.data, texture: textureOf(d.texture), blendEnable: d.blendEnable !== 0, srcBlend: d.srcBlend, destBlend: d.destBlend,
      minFilter: d.minFilter, magFilter: d.magFilter, addressU: d.addressU, addressV: d.addressV, numDraws: d.numDraws,
    });
  }
  return { w, dlg, ret, draws, image, reference };
}

/**
 * the strings a dialog would draw: those of its shown Statics that are in its list (the drawing of text is not ported: each one is counted;
 * a hidden control draws nothing, and DLG_UNIT_CREATE_BACK has 84 strings in Statics that are not shown)
 */
const staticStrings = (dlg: CKTDGUIDialog): number =>
  dlg.m_ControlsList.reduce(
    (n, c) => n + (c instanceof CKTDGUIStatic && c.m_bShow && !c.m_bOutofList ? c.m_StringDataList.filter((t) => t.msg.length !== 0).length : 0),
    0,
  );

/**
 * What a picture of the dialog may differ by from the reference in a colour channel.  The device (SwiftShader) is off by 1 level in a few
 * hundred of 786,432 pixels at most, because it samples and blends with its own rounding; a GPU may add a level or two.  A wrong blend
 * factor, a half-pixel shift or a missed quad is off by tens of levels over thousands of pixels.
 */
const TOLERANCE = 3;

function report(name: string, d: Difference): string {
  return `${name}: ${d.over} of ${d.pixels} pixels differ by more than ${TOLERANCE}, the largest difference ${d.max}, the mean ${d.mean.toFixed(4)}, first at ${JSON.stringify(d.firstOver)}`;
}

/**
 * What every draw of the UI looks like at the device: a quad as a strip of two triangles from the buffer of the vertex type 3 (XYZRHW,
 * diffuse, one set of coordinates), drawn with the states of the dialog (alpha blending on, alpha test and z test off, linear filters,
 * mirrored addressing) and the blend factors of the game's baseline, SRCALPHA / INVSRCALPHA: a button pushes none of its own, so it blends
 * with what `CKTDGManager::OnResetDevice` left.
 */
function expectUIQuads(draws: Draw[]): void {
  for (const d of draws) {
    expect([d.type, d.primitive, d.numPrimitives, d.data.length]).toEqual([3, 5, 2, 112]);
    expect([d.blendEnable, d.alphaTest, d.zEnable, d.srcBlend, d.destBlend]).toEqual([1, 0, 0, 5, 6]);
    expect([d.minFilter, d.magFilter, d.addressU, d.addressV]).toEqual([2, 2, 2, 2]);
    expect(d.texture).not.toBeNull();
  }
}

/** the checks of a dialog that is drawn without anything but its text missing; the picture is the one the rules of Direct3D 9 give */
function expectDrawnLikeDirect3D(name: string, r: Drawn): void {
  expect(r.dlg.m_bSuccessInitOpenScript).toBe(true);
  expect(r.ret).toBe(0);
  expect(r.w.devices.massFiles.log.entries).toEqual([]);
  expect(r.draws.length).toBeGreaterThan(0);
  expectUIQuads(r.draws);
  expect(r.w.render!.states.stackPointer).toBe(0);
  // the text is not ported: each string of a static is counted, nothing else is missing (no control class, no edge, no movie)
  const strings = staticStrings(r.dlg);
  expect(Object.fromEntries(r.w.render!.undrawn)).toEqual(strings > 0 ? { "CKTDGUIStatic string": strings } : {});
  const d = compareImages(r.image, r.reference, TOLERANCE);
  expect(d.over, report(name, d)).toBe(0);
  // it is a picture: a good part of the window is not the clear colour
  expect(compareImages(r.image, newTarget(WIDTH, HEIGHT, CLEAR[0]!, CLEAR[1]!, CLEAR[2]!), 0).over).toBeGreaterThan(200_000);
}

const suite = HAVE_GPU ? describe : describe.skip;

suite("dialogs drawn through @els/d3d9 by the ported UI", () => {
  test("DLG_UI_EVENT_BINGO_MAIN (pictures and buttons with alpha: the buttons' own blend states are the baseline's)", async () => {
    const r = await drawDialog("DLG_UI_EVENT_BINGO_MAIN.LUA", "ui-DLG_UI_EVENT_BINGO_MAIN");
    expectDrawnLikeDirect3D("DLG_UI_EVENT_BINGO_MAIN", r);
    expect(r.draws.length).toBeGreaterThan(50);
  }, 120_000);

  // a window of pictures and buttons, the character sheet, a list of 52 controls, the backdrop of three stretched textures, a world map
  for (const name of ["DLG_MAP_SELECT_WINDOW", "DLG_UI_CHARACTER_NEW", "DLG_UI_CHANNEL_SELECTION", "DLG_UNIT_CREATE_BACK", "DLG_UI_WORLD_MAP_NEW"]) {
    test(name, async () => {
      expectDrawnLikeDirect3D(name, await drawDialog(`${name}.LUA`, `ui-${name}`));
    }, 120_000);
  }
});
