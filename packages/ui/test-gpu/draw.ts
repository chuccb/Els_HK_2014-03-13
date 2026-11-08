/**
 * A dialog of the client drawn through the whole stack: the real DLG script on the Lua VM, the ported UI classes (`UIWorld`: the pictures of
 * the controls and the edges through `CKTDGUIDialog::OnFrameRender`), the state manager, the dynamic vertex buffers, and `Direct3DDevice9` on
 * WebGPU; and the same quads composed again on the CPU by the rules of Direct3D 9 (`reference.ts`).
 *
 * Shared by `dialog-draw.test.ts` (14 dialogs, asserted), `text-draw.test.ts` (text of the client's fonts) and `tools/ui-draw.ts` (every DLG
 * script, counted).  The strings of the controls are drawn too: their glyph pages are textures that no file owns, so the pixels of the page
 * on stage 0 are copied at each draw (`pageSnapshot`).  Needs a WebGPU adapter (`./tools/gpu.sh`: SwiftShader) and the client's data.
 *
 * `drawScene` is the common part: whatever the UI hands to `DrawPrimitive` while a body runs is written down with the device state of each
 * draw (`recordDraws`), the picture is read back, and the same draws are composed again on the CPU (`composeDraws`).  A dialog's textures
 * are the files of its device textures; the pages of a glyph font change between draws, so their pixels are copied at each draw.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable, decodeImage } from "@els/assets";
import { D3DCLEAR, D3DRS, D3DSAMP } from "@els/d3d9";
import type { Direct3DDevice9, Direct3DTexture9 } from "@els/d3d9";
import { CX2SlotManager, UIWorld } from "../src/index.ts";
import type { CKTDGUIControl, CKTDGUIDialog } from "../src/index.ts";
import type { CKTDGDynamicTexture } from "../src/dynamictexture.ts";
import { SGCFontCache } from "../src/freetypefont.ts";
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
  /** the pixels of `texture` at the time of the draw, when the recording was given a `snapshot` (a texture the CPU changes between draws) */
  image?: RefImage | null;
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

type Render = NonNullable<UIWorld["render"]>;
/** `D3DPT_TRIANGLELIST`: what the glyph fonts draw (the controls' quads are triangle strips) */
const D3DPT_TRIANGLELIST = 4;
/** the dynamic buffer manager's vertex type 3 (XYZRHW, diffuse, one set of coordinates): 28 bytes */
const DVB_XYZRHW_DIFFUSE_TEX1 = 3;
const VERTEX_RHW = 28;

export interface Recording {
  draws: Draw[];
  /** put the buffer manager back as it was */
  stop(): void;
}

/**
 * Write down every `DrawPrimitive` of the render's dynamic vertex buffer manager with the device state it is made with (the manager
 * still draws).  `snapshot` is asked for the pixels of the texture on stage 0 at the moment of each draw.
 */
export function recordDraws(render: Render, snapshot?: (texture: Direct3DTexture9 | null) => RefImage | null): Recording {
  const draws: Draw[] = [];
  const real = render.dvb.drawPrimitive.bind(render.dvb);
  render.dvb.drawPrimitive = (type, primitive, numPrimitives, data, numDraws) => {
    const s = render.states;
    const texture = s.apd3dTextures[0] ?? null;
    draws.push({
      type, primitive, numPrimitives, numDraws, data: data ? data.slice() : new Uint8Array(0), texture,
      ...(snapshot ? { image: snapshot(texture) } : {}),
      blendEnable: s.adwRenderState[D3DRS.ALPHABLENDENABLE]!, srcBlend: s.adwRenderState[D3DRS.SRCBLEND]!, destBlend: s.adwRenderState[D3DRS.DESTBLEND]!,
      alphaTest: s.adwRenderState[D3DRS.ALPHATESTENABLE]!, alphaFunc: s.adwRenderState[D3DRS.ALPHAFUNC]!, alphaRef: s.adwRenderState[D3DRS.ALPHAREF]!,
      cullMode: s.adwRenderState[D3DRS.CULLMODE]!, zEnable: s.adwRenderState[D3DRS.ZENABLE]!, zWrite: s.adwRenderState[D3DRS.ZWRITEENABLE]!,
      minFilter: s.adwSamplerState[D3DSAMP.MINFILTER]!, magFilter: s.adwSamplerState[D3DSAMP.MAGFILTER]!,
      addressU: s.adwSamplerState[D3DSAMP.ADDRESSU]!, addressV: s.adwSamplerState[D3DSAMP.ADDRESSV]!,
    });
    real(type, primitive, numPrimitives, data, numDraws);
  };
  return { draws, stop: () => { render.dvb.drawPrimitive = real; } };
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The quads of a triangle list the glyph fonts draw: six vertices (v0 v1 v2 | v3 v4 v5) of the 28-byte RHW type, the second triangle's
 * first vertex the first's second (v3 = v1) and its last the first's last (v5 = v2).  The reference draws a quad as a strip of four
 * vertices; v0 v1 v2 v4 is the same two triangles (the shared edge v1 - v2, the same winding).
 */
export function listQuads(d: Draw): Uint8Array[] {
  if (d.primitive !== D3DPT_TRIANGLELIST || d.type !== DVB_XYZRHW_DIFFUSE_TEX1) throw new Error(`a draw of primitive ${d.primitive}, vertex type ${d.type} is not a list of RHW quads`);
  if (d.numPrimitives % 2 !== 0) throw new Error(`a list of ${d.numPrimitives} triangles is not made of quads`);
  const quads: Uint8Array[] = [];
  for (let q = 0; q < d.numPrimitives / 2; q++) {
    const v = (k: number): Uint8Array => d.data.subarray((q * 6 + k) * VERTEX_RHW, (q * 6 + k + 1) * VERTEX_RHW);
    if (!same(v(3), v(1)) || !same(v(5), v(2))) throw new Error(`the six vertices of quad ${q} of a list are not two triangles of one quad`);
    const strip = new Uint8Array(4 * VERTEX_RHW);
    [0, 1, 2, 4].forEach((k, i) => strip.set(v(k), i * VERTEX_RHW));
    quads.push(strip);
  }
  return quads;
}

/**
 * Compose the draws on a cleared target by the rules of Direct3D 9 (`reference.ts`).  `textureOf` gives the pixels of the texture a draw
 * had on stage 0.  A quad it has no rule for, or a texture it cannot give, stops the composition: `referenceError` says why and
 * `reference` is what was composed before.
 */
export function composeDraws(draws: Draw[], textureOf: (d: Draw) => RefImage | null): { reference: RefImage; referenceError?: string } {
  const reference = newTarget(WIDTH, HEIGHT, CLEAR[0]!, CLEAR[1]!, CLEAR[2]!);
  try {
    for (const d of draws) {
      const state = {
        texture: textureOf(d), blendEnable: d.blendEnable !== 0, srcBlend: d.srcBlend, destBlend: d.destBlend,
        minFilter: d.minFilter, magFilter: d.magFilter, addressU: d.addressU, addressV: d.addressV, numDraws: d.numDraws,
        alphaTest: d.alphaTest !== 0, alphaFunc: d.alphaFunc, alphaRef: d.alphaRef, cullMode: d.cullMode,
      };
      if (d.primitive === D3DPT_TRIANGLELIST) for (const vertices of listQuads(d)) drawQuad(reference, { ...state, vertices });
      else drawQuad(reference, { ...state, vertices: d.data });
    }
    return { reference };
  } catch (e) {
    return { reference, referenceError: e instanceof Error ? e.message : String(e) };
  }
}

export interface SceneOptions {
  /** the pixels of a texture on stage 0 at the time of a draw (see `recordDraws`) */
  snapshot?: (texture: Direct3DTexture9 | null) => RefImage | null;
  /** the pixels the CPU composition samples for a draw (default: what `snapshot` copied) */
  textureOf?: (d: Draw) => RefImage | null;
  /** the file name the picture is saved as in `D3D9_TEST_OUT` */
  savedAs?: string;
}

export interface Scene<T> {
  /** what the body answered */
  ret: T;
  draws: Draw[];
  image: RefImage;
  reference: RefImage;
  referenceError?: string;
}

/**
 * Run `body` inside a scene on the cleared back buffer of the fixture's device, with the draws of `w` recorded; then read the picture
 * back and compose the draws on the CPU.  A body that throws leaves neither the device inside a scene nor the recording in the buffer
 * manager of a world that goes on.
 */
export async function drawScene<T>(w: UIWorld, body: () => T, options: SceneOptions = {}): Promise<Scene<T>> {
  const { dev } = await getFixture();
  const rec = recordDraws(w.render!, options.snapshot);
  dev.BeginScene();
  let ret: T;
  try {
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, (0xff000000 | (CLEAR[0]! << 16) | (CLEAR[1]! << 8) | CLEAR[2]!) >>> 0, 1, 0);
    ret = body();
  } finally {
    dev.EndScene();
    rec.stop();
  }
  const shot = await snap(dev);
  if (options.savedAs) shot.save(options.savedAs);
  const image: RefImage = { width: shot.width, height: shot.height, rgba: shot.rgba };
  const { reference, referenceError } = composeDraws(rec.draws, options.textureOf ?? ((d) => d.image ?? null));
  return { ret, draws: rec.draws, image, reference, referenceError };
}

/** the pixels of a glyph page as the texture holds them: A8R8G8B8 (the glyph cache writes `coverage << 24 | 0xFFFFFF`), as R G B A bytes */
export function pageImage(page: CKTDGDynamicTexture): RefImage {
  const px = page.pBits;
  if (!px) throw new Error("a glyph page that is not locked has no pixels to copy");
  const rgba = new Uint8Array(px.length * 4);
  for (let i = 0; i < px.length; i++) {
    const v = px[i]!;
    rgba[4 * i] = (v >>> 16) & 255;
    rgba[4 * i + 1] = (v >>> 8) & 255;
    rgba[4 * i + 2] = v & 255;
    rgba[4 * i + 3] = v >>> 24;
  }
  return { width: page.m_dwWidth, height: page.m_dwHeight, rgba };
}

/** every glyph page (main and outline) of every font of the world, by the Direct3D texture it is drawn through */
export function glyphPages(w: UIWorld): Map<Direct3DTexture9, CKTDGDynamicTexture> {
  const pages = new Map<Direct3DTexture9, CKTDGDynamicTexture>();
  for (const font of w.fonts.m_mapUKFontList.values()) {
    const ft = font?.m_pUKFont;
    if (!ft) continue;
    for (const p of [...ft.m_pTexture, ...ft.m_pTextureOutLine]) if (p?.m_pTextureVid) pages.set(p.m_pTextureVid, p);
  }
  return pages;
}

/**
 * The snapshot of a recording (`recordDraws`): the pixels of the glyph page that is on stage 0.  A texture that is no glyph page is a
 * file of the dialog and gives null (the composition decodes it), unless `strict`: a text draw without a page is then a failure.
 */
export function pageSnapshot(w: UIWorld, strict = false): (texture: Direct3DTexture9 | null) => RefImage | null {
  const pages = glyphPages(w);
  return (texture) => {
    const page = texture ? pages.get(texture) : undefined;
    if (!page) {
      if (strict) throw new Error("a draw whose texture on stage 0 is no glyph page");
      return null;
    }
    return pageImage(page);
  };
}

/**
 * Make every font of the world forget its glyphs, as a client that has drawn nothing yet: the cells, the hash of the characters and the
 * stamp are what `Load` makes (`m_iSizeArray` 0, `m_iTotalCache` cells of 0, no character known, stamp 1); the faces and the pages stay.  A
 * world that draws a thousand dialogs would otherwise fill the cells of a font and reach the exe's crash on its fifth page (FINDINGS
 * 17.12), which one dialog never does.
 */
export function forgetGlyphs(w: UIWorld): void {
  for (const font of w.fonts.m_mapUKFontList.values()) {
    const ft = font?.m_pUKFont;
    if (!ft?.m_bLoad) continue;
    ft.m_iSizeArray = 0;
    ft.m_FontCacheArray = Array.from({ length: ft.m_iTotalCache }, () => new SGCFontCache());
    ft.hashCell.fill(-1);
    ft.hashSizeKnown.fill(0);
    ft.hashCx.fill(0);
    ft.hashCy.fill(0);
    ft.m_dwCurrentStamp = 1;
  }
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
  const w = world ?? (await newWorld());
  try {
    const dlg = w.openDialog(script, 0, new CX2SlotManager(w));
    let frameError: string | undefined;
    for (let i = 0; i < frames && frameError === undefined; i++) {
      try {
        dlg.onFrameMove(0, 0);
      } catch (e) {
        frameError = e instanceof Error ? e.message : String(e);
      }
    }

    // the textures as the files say they are, found through the Direct3D texture the stage held (looked up when the composition asks, which is
    // after the drawing)
    let owner: Map<Direct3DTexture9, Uint8Array> | undefined;
    const decoded = new Map<Direct3DTexture9, RefImage>();
    const textureOf = (d: Draw): RefImage | null => {
      const t = d.texture;
      if (!t) return null;
      let img = decoded.get(t);
      if (!img) {
        if (!owner) {
          owner = new Map();
          for (const c of w.devices.devices.values()) if (c.m_pTexture) owner.set(c.m_pTexture, c.data);
        }
        const bytes = owner.get(t);
        if (!bytes) throw new Error("a texture on stage 0 that no device texture owns");
        const decodedImage = decodeImage(bytes);
        img = { width: decodedImage.width, height: decodedImage.height, rgba: decodedImage.rgba };
        decoded.set(t, img);
      }
      return img;
    };
    const scene = await drawScene(w, () => dlg.onFrameRender(true), { ...(savedAs ? { savedAs } : {}), snapshot: pageSnapshot(w), textureOf: (d) => d.image ?? textureOf(d) });
    return { w, dlg, ret: scene.ret, draws: scene.draws, image: scene.image, reference: scene.reference, referenceError: scene.referenceError, frameError };
  } catch (e) {
    // the textures of a dialog that failed half way (and, for a world of its own, all it held)
    if (world) releaseTextures(w);
    else releaseDrawn({ w });
    throw e;
  }
}

/** the controls the dialog draws: those that are shown and in its list (a hidden control draws nothing, DLG_UNIT_CREATE_BACK has 84 strings in Statics that are not shown) */
export const drawnControls = (dlg: CKTDGUIDialog): CKTDGUIControl[] => dlg.m_ControlsList.filter((c) => c.m_bShow && !c.m_bOutofList);

/**
 * Close the textures a drawn dialog opened: the GPU gets them back (a WebGPU texture is freed only when it is destroyed) and the device
 * manager forgets them, as if every control of the dialog had been destroyed; the fonts forget their glyphs (`forgetGlyphs`).  A census
 * draws a thousand dialogs on one device.
 */
export function releaseTextures(w: UIWorld): void {
  forgetGlyphs(w);
  for (const t of w.devices.devices.values()) {
    t.m_pTexture?.Release();
    t.m_pTexture = null;
    t.data = new Uint8Array(0); // a global of the Lua state may still hold a control of the dialog, and the control its texture
  }
  w.devices.devices.clear();
}

/**
 * Give the GPU back everything a world held: its textures, the vertex buffers of its dynamic buffer manager and the page textures of its
 * fonts (`~CKTDGFontManager`: every font of a booted world has up to eight, 48 for the client's seven; the world is done).
 */
export function releaseDrawn(r: Pick<Drawn, "w">): void {
  releaseTextures(r.w);
  r.w.render?.dvb.onLostDevice();
  r.w.fontManager.Destroy();
}

/**
 * What a picture of the dialog may differ by from the reference in a colour channel.  The device (SwiftShader) is off by 1 level in a few
 * hundred of 786,432 pixels at most, because it samples and blends with its own rounding; a GPU may add a level or two.  A wrong blend
 * factor, a half-pixel shift or a missed quad is off by tens of levels over thousands of pixels.
 */
export const TOLERANCE = 3;
