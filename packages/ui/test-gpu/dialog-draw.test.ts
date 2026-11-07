/**
 * Dialogs of the client drawn through the whole stack: the real DLG script on the Lua VM, the ported UI classes (`UIWorld`: the pictures of
 * the controls and the edges through `CKTDGUIDialog::OnFrameRender`), the state manager, the dynamic vertex buffers, and `Direct3DDevice9` on WebGPU.
 *
 * Every quad the UI hands to `DrawPrimitive` is written down with the device state it is drawn with, composed again on the CPU by the rules
 * of Direct3D 9 (`reference.ts`, itself pinned by test/reference.test.ts), and the picture the device made has to agree with that.  The
 * pictures are saved when `D3D9_TEST_OUT` names a folder.
 *
 * The drawing and the CPU composition are `draw.ts` (`drawDialog`; `tools/ui-draw.ts` runs it over every DLG script).  Needs a WebGPU
 * adapter (`./tools/gpu.sh`: SwiftShader) and the client's data; skipped without them.  Heavy (all the textures of a dialog are decoded and
 * uploaded), so `tools/test-packages.sh` runs this folder in a process of its own.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CKTDGUIButton, CKTDGUIRadioButton, CKTDGUIStatic } from "../src/index.ts";
import type { CKTDGUIDialog } from "../src/index.ts";
import { gpuAvailable } from "../../d3d9/test/gpu-helper.ts";
import { compareImages, newTarget } from "./reference.ts";
import type { Difference } from "./reference.ts";
import { CLEAR, HEIGHT, TOLERANCE, WIDTH, drawDialog, drawnControls } from "./draw.ts";
import type { Draw, Drawn } from "./draw.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const HAVE_GPU = haveData && (await gpuAvailable());

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
  expect(r.referenceError).toBeUndefined(); // the CPU composition has a rule for every quad
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
