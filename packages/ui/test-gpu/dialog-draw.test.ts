/**
 * Dialogs of the client drawn through the whole stack: the real DLG script on the Lua VM, the ported UI classes (`UIWorld`: the pictures of
 * the controls and the edges through `CKTDGUIDialog::OnFrameRender`), the state manager, the dynamic vertex buffers, and `Direct3DDevice9` on WebGPU.
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
import { CKTDGUIButton, CKTDGUIRadioButton, CKTDGUIStatic, CX2SlotManager, UIWorld } from "../src/index.ts";
import type { CKTDGUIControl, CKTDGUIDialog } from "../src/index.ts";
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
      alphaTest: s.adwRenderState[D3DRS.ALPHATESTENABLE]!, alphaFunc: s.adwRenderState[D3DRS.ALPHAFUNC]!, alphaRef: s.adwRenderState[D3DRS.ALPHAREF]!,
      cullMode: s.adwRenderState[D3DRS.CULLMODE]!, zEnable: s.adwRenderState[D3DRS.ZENABLE]!, zWrite: s.adwRenderState[D3DRS.ZWRITEENABLE]!,
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
      alphaTest: d.alphaTest !== 0, alphaFunc: d.alphaFunc, alphaRef: d.alphaRef, cullMode: d.cullMode,
    });
  }
  return { w, dlg, ret, draws, image, reference };
}

/** the controls the dialog draws: those that are shown and in its list (a hidden control draws nothing, DLG_UNIT_CREATE_BACK has 84 strings in Statics that are not shown) */
const drawnControls = (dlg: CKTDGUIDialog): CKTDGUIControl[] => dlg.m_ControlsList.filter((c) => c.m_bShow && !c.m_bOutofList);

/**
 * What the dialog counts as not drawn: the drawing of text is not ported, so each string of a shown static (those with text), button and radio
 * button is counted, and each movie of a static; nothing else is missing (every control class of these dialogs is drawn)
 */
function expectedUndrawn(dlg: CKTDGUIDialog): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (key: string, n: number): void => { if (n > 0) out[key] = (out[key] ?? 0) + n; };
  for (const c of drawnControls(dlg)) {
    if (c instanceof CKTDGUIStatic) {
      add("CKTDGUIStatic string", c.m_StringDataList.filter((t) => t.msg.length !== 0).length);
      add("CMovieData::OnFrameRender", c.m_MovieDataList.length);
    } else if (c instanceof CKTDGUIButton) add("CKTDGUIButton string", c.m_pStringData ? 1 : 0);
    else if (c instanceof CKTDGUIRadioButton) add("CKTDGUIRadioButton string", c.m_pStringData ? 1 : 0);
  }
  return out;
}

/**
 * How many bars of edges the dialog draws (`CKTDXDeviceTexture::Draw` each; an edge is eight of them, two passes of four before and after the
 * quad): a shown static's picture that has an edge width, a button that has the focus (none at the start) and a width, a checked radio button
 * with a width
 */
function expectedEdgeBars(dlg: CKTDGUIDialog): number {
  let edges = 0;
  for (const c of drawnControls(dlg)) {
    if (c instanceof CKTDGUIStatic) edges += c.m_PictureDataList.filter((p) => p.bShow && p.pPoint && p.pTexture?.pTexture && p.m_EdgeWidth !== 0).length;
    else if (c instanceof CKTDGUIButton) edges += c.m_bHasFocus && c.m_EdgeWidth > 0 ? 1 : 0;
    else if (c instanceof CKTDGUIRadioButton) edges += c.m_bChecked && c.m_CheckedEdgeWidth !== 0 ? 1 : 0;
  }
  return edges * 8;
}

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
 * What every draw of the UI looks like at the device: a strip of two triangles from the buffer of the vertex type 3 (XYZRHW, diffuse, one set
 * of coordinates), alpha blending on and the z test off, linear filters, mirrored addressing, blend factors SRCALPHA / INVSRCALPHA (a
 * button pushes none of its own: it blends with what `CKTDGManager::OnResetDevice` left).  Of two kinds:
 *  - a control's quad (`RenderVertex`): the dialog's states, so no alpha test, and clockwise (culled counter-clockwise);
 *  - a bar of an edge (`CKTDXDeviceTexture::Draw`): `akRSICKTDXDeviceTexture`, so the alpha test on (not equal to 0), no z write, and
 *    counter-clockwise (culled clockwise): left-top, left-bottom, right-top, right-bottom.
 * Returns how many bars of edges there are.
 */
function expectUIQuads(draws: Draw[]): number {
  let edgeBars = 0;
  for (const d of draws) {
    expect([d.type, d.primitive, d.numPrimitives, d.data.length]).toEqual([3, 5, 2, 112]);
    expect([d.blendEnable, d.zEnable, d.srcBlend, d.destBlend]).toEqual([1, 0, 5, 6]);
    expect([d.minFilter, d.magFilter, d.addressU, d.addressV]).toEqual([2, 2, 2, 2]);
    expect(d.texture).not.toBeNull();
    const f = new Float32Array(d.data.buffer, d.data.byteOffset, 28);
    if (d.alphaTest === 0) {
      expect([d.cullMode, d.numDraws > 0]).toEqual([3, true]);
      expect([f[0] === f[14], f[7] === f[21], f[1] === f[8], f[15] === f[22]]).toEqual([true, true, true, true]); // left-top, right-top, left-bottom, right-bottom
    } else {
      edgeBars++;
      expect([d.alphaTest, d.alphaFunc, d.alphaRef, d.cullMode, d.zWrite, d.numDraws]).toEqual([1, 6, 0, 2, 0, 1]);
      expect([f[0] === f[7], f[14] === f[21], f[1] === f[15], f[8] === f[22]]).toEqual([true, true, true, true]); // left-top, left-bottom, right-top, right-bottom
    }
  }
  return edgeBars;
}

/**
 * the checks of a dialog that is drawn without anything but its text missing; the picture is the one the rules of Direct3D 9 give.
 * `covers`: how many pixels of the window at least are not the clear colour (a window of the game fills much of it, a popup little)
 */
function expectDrawnLikeDirect3D(name: string, r: Drawn, covers = 200_000): { edgeBars: number } {
  expect(r.dlg.m_bSuccessInitOpenScript).toBe(true);
  expect(r.ret).toBe(0);
  expect(r.w.devices.massFiles.log.entries).toEqual([]);
  expect(r.draws.length).toBeGreaterThan(0);
  const edgeBars = expectUIQuads(r.draws);
  expect(edgeBars).toBe(expectedEdgeBars(r.dlg));
  expect(r.w.render!.states.stackPointer).toBe(0);
  // the text is not ported: each string is counted, nothing else is missing (no control class, no edge, no movie)
  expect(Object.fromEntries(r.w.render!.undrawn)).toEqual(expectedUndrawn(r.dlg));
  const d = compareImages(r.image, r.reference, TOLERANCE);
  expect(d.over, report(name, d)).toBe(0);
  // it is a picture: a good part of the window is not the clear colour
  expect(compareImages(r.image, newTarget(WIDTH, HEIGHT, CLEAR[0]!, CLEAR[1]!, CLEAR[2]!), 0).over).toBeGreaterThan(covers);
  return { edgeBars };
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

  // the rest of the controls and the edges: Static pictures with an edge, radio buttons (a tab that is checked), a slider, check boxes (one that
  // is checked), a list with a scroll bar, a navigation with one, a dialog with pictures of a key that its TET lacks (quads without area)
  const more: { name: string; covers: number; classes: Record<string, number>; edgeBars?: number }[] = [
    { name: "DLG_SKILL_INFO_POPUP", covers: 70_000, classes: { CKTDGUIStatic: 1 }, edgeBars: 8 },
    { name: "DLG_UI_SKILL_DESC", covers: 15_000, classes: { CKTDGUIStatic: 2 }, edgeBars: 8 },
    { name: "DLG_COMMAND_SKILL", covers: 200_000, classes: { CKTDGUIRadioButton: 5, CKTDGUISlider: 1, CKTDGUIButton: 2 } },
    { name: "DLG_CASH_SHOP_POPUP_BUY_HK", covers: 200_000, classes: { CKTDGUICheckBox: 1, CKTDGUIButton: 6 } },
    { name: "DLG_CHATBOX_POPUP", covers: 5_000, classes: { CKTDGUICheckBox: 8 } },
    { name: "DLG_UI_GUILD_SKILL_TREE", covers: 100_000, classes: { CKTDGUIContolList: 1, CKTDGUIRadioButton: 3 } },
    { name: "DLG_UI_NEW_QUEST_LIST", covers: 200_000, classes: { CKTDGUINavigation: 1, CKTDGUIRadioButton: 16, CKTDGUICheckBox: 1 } },
    { name: "DLG_UI_PARTYLIST", covers: 200_000, classes: { CKTDGUIRadioButton: 12 } },
  ];
  for (const { name, covers, classes, edgeBars } of more) {
    test(name, async () => {
      const r = await drawDialog(`${name}.LUA`, `ui-${name}`);
      const counts: Record<string, number> = {};
      for (const c of r.dlg.m_ControlsList) counts[c.constructor.name] = (counts[c.constructor.name] ?? 0) + 1;
      expect(counts).toMatchObject(classes);
      expect(expectDrawnLikeDirect3D(name, r, covers).edgeBars).toBe(edgeBars ?? 0);
      if (name === "DLG_UI_PARTYLIST") {
        // ten pictures name the key Henir_Normal, which DLG_UI_Title01.TET does not have: an unknown key leaves the rectangle 0 (FINDINGS 17.3), so
        // their quads have four equal corners and UV 0: they are sent to the device and cover nothing
        const flat = r.draws.filter((d) => {
          const f = new Float32Array(d.data.buffer, d.data.byteOffset, 28);
          return new Set([f[0], f[7], f[14], f[21]]).size === 1 && new Set([f[1], f[8], f[15], f[22]]).size === 1;
        });
        expect(flat.length).toBeGreaterThan(0);
      }
    }, 120_000);
  }
});
