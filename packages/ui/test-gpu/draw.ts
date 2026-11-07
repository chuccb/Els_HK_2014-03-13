/**
 * A dialog of the client drawn through the whole stack: the real DLG script on the Lua VM, the ported UI classes (`UIWorld`: the pictures of
 * the controls and the edges through `CKTDGUIDialog::OnFrameRender`), the state manager, the dynamic vertex buffers, and `Direct3DDevice9` on
 * WebGPU; and the same quads composed again on the CPU by the rules of Direct3D 9 (`reference.ts`).
 *
 * Shared by `dialog-draw.test.ts` (14 dialogs, asserted) and `tools/ui-draw.ts` (every DLG script, counted).  Needs a WebGPU adapter
 * (`./tools/gpu.sh`: SwiftShader) and the client's data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable, decodeImage } from "@els/assets";
import { D3DCLEAR, D3DRS, D3DSAMP } from "@els/d3d9";
import type { Direct3DDevice9, Direct3DTexture9 } from "@els/d3d9";
import { CX2SlotManager, UIWorld } from "../src/index.ts";
import type { CKTDGUIControl, CKTDGUIDialog } from "../src/index.ts";
import { newD3D9, snap } from "../../d3d9/test/gpu-helper.ts";
import { indexAllKoms, KomMassFileSource } from "../../../tools/komindex.ts";
import { drawQuad, newTarget } from "./reference.ts";
import type { RefImage } from "./reference.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");

/** the back buffer of the game's default window; the dialogs are laid out in 1024 x 768 */
export const WIDTH = 1024;
export const HEIGHT = 768;
export const CLEAR = [0x2d, 0x33, 0x40];

export interface Fixture {
  source: KomMassFileSource;
  strings: StringTable;
  dev: Direct3DDevice9;
}
let fixture: Promise<Fixture> | undefined;
export const getFixture = (): Promise<Fixture> =>
  (fixture ??= (async () => {
    const index = await indexAllKoms();
    const source = new KomMassFileSource(index, 0, true); // the whole textures, read when a script asks for them: they are decoded and uploaded
    const strings = StringTable.fromEss(new Uint8Array(readFileSync(join(dataDir, "general.ess"))));
    return { source, strings, dev: await newD3D9(WIDTH, HEIGHT) };
  })());

/** one `DrawPrimitive` of the dynamic vertex buffer manager and the device state it was made with */
export interface Draw {
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
  alphaFunc: number;
  alphaRef: number;
  cullMode: number;
  zEnable: number;
  zWrite: number;
  minFilter: number;
  magFilter: number;
  addressU: number;
  addressV: number;
}

export interface Drawn {
  w: UIWorld;
  dlg: CKTDGUIDialog;
  ret: number;
  draws: Draw[];
  image: RefImage;
  reference: RefImage;
  /** why the CPU composition gave up (a quad it has no rule for, a texture it cannot decode); `reference` is then only what was composed before */
  referenceError?: string;
  /** the message of the exception a frame (`OnFrameMove`) ended in (the exe's code that is not ported yet); the dialog is drawn as the frame left it */
  frameError?: string;
}

/**
 * A UI world with the device, booted (the global objects, the enumerations, the start-up config) and with the owners of the dialogs alive.
 * Its Lua state is the client's one state: a script may use a global that another script defined.
 */
export async function newWorld(): Promise<UIWorld> {
  const { source, strings, dev } = await getFixture();
  const w = new UIWorld({ source, strings, notPorted: "throw", device: dev, backBuffer: { width: WIDTH, height: HEIGHT } });
  w.boot();
  w.createOwners();
  return w;
}

/**
 * Open a dialog script (in `world`, or in a new one), run `frames` frames of it, draw it once on a cleared back buffer, and compose the
 * same quads on the CPU.  A world that draws several dialogs one after the other must `releaseTextures` between them.
 *
 * The client calls `OnFrameMove` before every `OnFrameRender`; one frame of no time (`OnFrameMove(0, 0)`: nothing moves, the first
 * `ChangeState` of the buttons that wait for it is made) is what a dialog looks like when it is first drawn.  An exception in a frame
 * (what the frame does that is not ported) is kept in `frameError` and the dialog is drawn as it was left.
 */
export async function drawDialog(script: string, savedAs?: string, world?: UIWorld, frames = 1): Promise<Drawn> {
  const { dev } = await getFixture();
  const w = world ?? (await newWorld());
  const dlg = w.openDialog(script, 0, new CX2SlotManager(w));
  try {
    let frameError: string | undefined;
    for (let i = 0; i < frames && frameError === undefined; i++) {
      try {
        dlg.onFrameMove(0, 0);
      } catch (e) {
        frameError = e instanceof Error ? e.message : String(e);
      }
    }
    const render = w.render!;

    const draws: Draw[] = [];
    const real = render.dvb.drawPrimitive.bind(render.dvb);
    render.dvb.drawPrimitive = (type, primitive, numPrimitives, data, numDraws) => {
      const s = render.states;
      draws.push({
        type, primitive, numPrimitives, numDraws, data: data ? data.slice() : new Uint8Array(0), texture: s.apd3dTextures[0] ?? null,
        blendEnable: s.adwRenderState[D3DRS.ALPHABLENDENABLE]!, srcBlend: s.adwRenderState[D3DRS.SRCBLEND]!, destBlend: s.adwRenderState[D3DRS.DESTBLEND]!,
        alphaTest: s.adwRenderState[D3DRS.ALPHATESTENABLE]!, alphaFunc: s.adwRenderState[D3DRS.ALPHAFUNC]!, alphaRef: s.adwRenderState[D3DRS.ALPHAREF]!,
        cullMode: s.adwRenderState[D3DRS.CULLMODE]!, zEnable: s.adwRenderState[D3DRS.ZENABLE]!, zWrite: s.adwRenderState[D3DRS.ZWRITEENABLE]!,
        minFilter: s.adwSamplerState[D3DSAMP.MINFILTER]!, magFilter: s.adwSamplerState[D3DSAMP.MAGFILTER]!,
        addressU: s.adwSamplerState[D3DSAMP.ADDRESSU]!, addressV: s.adwSamplerState[D3DSAMP.ADDRESSV]!,
      });
      real(type, primitive, numPrimitives, data, numDraws);
    };

    dev.BeginScene();
    let ret: number;
    try {
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, (0xff000000 | (CLEAR[0]! << 16) | (CLEAR[1]! << 8) | CLEAR[2]!) >>> 0, 1, 0);
      ret = dlg.onFrameRender(true);
    } finally {
      dev.EndScene(); // a dialog that throws must not leave the device inside a scene for the next one
      render.dvb.drawPrimitive = real; // nor the recording in the buffer manager of a world that goes on
    }
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
    let referenceError: string | undefined;
    try {
      for (const d of draws) {
        drawQuad(reference, {
          vertices: d.data, texture: textureOf(d.texture), blendEnable: d.blendEnable !== 0, srcBlend: d.srcBlend, destBlend: d.destBlend,
          minFilter: d.minFilter, magFilter: d.magFilter, addressU: d.addressU, addressV: d.addressV, numDraws: d.numDraws,
          alphaTest: d.alphaTest !== 0, alphaFunc: d.alphaFunc, alphaRef: d.alphaRef, cullMode: d.cullMode,
        });
      }
    } catch (e) {
      referenceError = e instanceof Error ? e.message : String(e);
    }
    return { w, dlg, ret, draws, image, reference, referenceError, frameError };
  } catch (e) {
    releaseTextures(w); // the textures of a dialog that failed half way
    throw e;
  }
}

/** the controls the dialog draws: those that are shown and in its list (a hidden control draws nothing, DLG_UNIT_CREATE_BACK has 84 strings in Statics that are not shown) */
export const drawnControls = (dlg: CKTDGUIDialog): CKTDGUIControl[] => dlg.m_ControlsList.filter((c) => c.m_bShow && !c.m_bOutofList);

/**
 * Close the textures a drawn dialog opened: the GPU gets them back (a WebGPU texture is freed only when it is destroyed) and the device
 * manager forgets them, as if every control of the dialog had been destroyed.  A census draws a thousand dialogs on one device.
 */
export function releaseTextures(w: UIWorld): void {
  for (const t of w.devices.devices.values()) {
    t.m_pTexture?.Release();
    t.m_pTexture = null;
    t.data = new Uint8Array(0); // a global of the Lua state may still hold a control of the dialog, and the control its texture
  }
  w.devices.devices.clear();
}

/** Give the GPU back everything a world held: its textures and the vertex buffers of its dynamic buffer manager (the world is done). */
export function releaseDrawn(r: Pick<Drawn, "w">): void {
  releaseTextures(r.w);
  r.w.render?.dvb.onLostDevice();
}

/**
 * What a picture of the dialog may differ by from the reference in a colour channel.  The device (SwiftShader) is off by 1 level in a few
 * hundred of 786,432 pixels at most, because it samples and blends with its own rounding; a GPU may add a level or two.  A wrong blend
 * factor, a half-pixel shift or a missed quad is off by tens of levels over thousands of pixels.
 */
export const TOLERANCE = 3;
