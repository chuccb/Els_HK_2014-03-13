/**
 * The dialog manager's frame on the device: `CKTDGUIDialogManager::OnFrameRender(bFront)` (328DFE30) and `OnFrameRenderTopModal` (328E0910) over real
 * dialogs of the client (the DLG scripts on the Lua VM, the ported controls, the state manager, the dynamic vertex buffers and `Direct3DDevice9` on
 * WebGPU).  The manager's list (`_InsertIntoDialogListTop`, `ChangeLayer`, `ChangeFront`, `ChangeSequence`) is pinned against a model by
 * test/dialogmanager.test.ts; what this file adds is that the list is what the picture shows:
 *
 *  - the dialogs are drawn from the back of the list to the front, `OnFrameRender(false)` the dialogs that are not in front and `OnFrameRender(true)`
 *    the others, and the draws a dialog makes inside the manager's frame are the draws it makes when it is drawn alone;
 *  - the picture the device makes of those draws is the CPU composition of the same quads in the order they were drawn (`reference.ts`), and the order
 *    shows: two full-screen backgrounds change places when the list does;
 *  - the guide text's static of a dialog is drawn after all the dialogs of its group, and the slot that is being dragged after that, by
 *    `OnFrameRender(true)` only;
 *  - a dialog that is not shown is not drawn, a manager that is not shown (and cannot hide) draws nothing, one that can hide draws four named dialogs,
 *    and `OnFrameRenderTopModal` draws one dialog.
 *
 * Needs a WebGPU adapter (`./tools/gpu.sh`: SwiftShader) and the client's data; skipped without them.  Heavy, so `tools/test-packages.sh` runs this
 * folder in a process of its own.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CKTDGUIButton, CKTDGUISlot, CX2SlotManager, SCS } from "../src/index.ts";
import type { CKTDGUIDialog, CKTDGUIStatic, UIWorld } from "../src/index.ts";
import { gpuAvailable } from "../../d3d9/test/gpu-helper.ts";
import { compareImages } from "./reference.ts";
import type { RefImage } from "./reference.ts";
import { TOLERANCE, drawScene, fileTextures, newWorld, pageSnapshot, releaseTextures } from "./draw.ts";
import type { Draw } from "./draw.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const HAVE_GPU = haveData && (await gpuAvailable());
const suite = HAVE_GPU ? describe : describe.skip;

/** two backgrounds that cover the whole screen: not in front, layer 0, modal (3 and 2 quads) */
const BACK = "DLG_UNIT_CREATE_BACK.LUA";
const LOBBY = "DLG_UI_PVP_LOBBY_BG.LUA";
/** a list of the party: in front, layer 4, not modal; 146 quads and 332 glyphs */
const PARTY = "DLG_UI_PARTYLIST.LUA";
/** a full-screen picture: in front, layer 500, not modal (2 quads) */
const GLOW = "DLG_UI_BUFF_APINK.LUA";
/** 142 slots and 21 buttons: in front, not modal */
const KEYS = "DLG_UI_KEY_SETTING.LUA";

/** what a draw is, as text: the vertex data, the primitive count, the texture's number and the states that decide how it is blended */
function signature(d: Draw, textures: Map<unknown, number>): string {
  if (d.texture && !textures.has(d.texture)) textures.set(d.texture, textures.size + 1);
  return [d.type, d.primitive, d.numPrimitives, d.numDraws, textures.get(d.texture) ?? 0, d.blendEnable, d.srcBlend, d.destBlend, d.alphaTest, d.alphaFunc, d.alphaRef, Buffer.from(d.data).toString("base64")].join(" ");
}

suite("the dialog manager draws the dialogs of its list", () => {
  afterEach(() => {
    CKTDGUISlot.s_pDragSlot = null;
  });

  interface Rig {
    w: UIWorld;
    back: CKTDGUIDialog;
    lobby: CKTDGUIDialog;
    party: CKTDGUIDialog;
    glow: CKTDGUIDialog;
    names: Map<CKTDGUIDialog, string>;
    /** the dialogs of the manager's list, from the back to the front, by name */
    list(): (string | undefined)[];
  }

  /** the four dialogs in one manager, added in this order; one frame of no time run */
  async function rig(): Promise<Rig> {
    const w = await newWorld();
    const open = (script: string): CKTDGUIDialog => {
      const dialog = w.openDialog(script, 0, new CX2SlotManager(w));
      expect(w.dialogManager.addDlg(dialog)).toBe(true);
      return dialog;
    };
    const back = open(BACK);
    const lobby = open(LOBBY);
    const party = open(PARTY);
    const glow = open(GLOW);
    w.dialogManager.onFrameMove(0, 0);
    const names = new Map<CKTDGUIDialog, string>([[back, "back"], [lobby, "lobby"], [party, "party"], [glow, "glow"]]);
    return { w, back, lobby, party, glow, names, list: () => [...w.dialogManager.m_listDialog].map((d) => names.get(d)) };
  }

  /**
   * Run `body` in a scene and write down which dialog's `onFrameRender` (or which guide static's) made which draws: a count in a wrapper of the
   * buffer manager's draw, and of each dialog's `onFrameRender`, under the recording.  `spans` are the calls the body made itself, `inside` those a
   * dialog's `onFrameRender` made (the guide dialog's static is drawn by its dialog, and again by the manager).
   */
  async function frame(m: Rig, body: (w: UIWorld) => void, savedAs?: string) {
    const dvb = m.w.render!.dvb;
    const realDraw = dvb.drawPrimitive.bind(dvb);
    let count = 0;
    dvb.drawPrimitive = (...args) => {
      count++;
      realDraw(...args);
    };
    interface Span {
      name: string;
      from: number;
      to: number;
    }
    const spans: Span[] = [];
    const inside: Span[] = [];
    let depth = 0;
    const restore: (() => void)[] = [];
    const watch = (name: string, target: { onFrameRender(...args: never[]): number }): void => {
      const original = target.onFrameRender;
      const real = original.bind(target) as (...args: unknown[]) => number;
      (target as { onFrameRender: unknown }).onFrameRender = (...args: unknown[]) => {
        const from = count;
        depth++;
        let ret: number;
        try {
          ret = real(...args);
        } finally {
          depth--;
        }
        (depth === 0 ? spans : inside).push({ name, from, to: count });
        return ret;
      };
      restore.push(() => void ((target as { onFrameRender: unknown }).onFrameRender = original));
    };
    for (const [dialog, name] of m.names) {
      watch(name, dialog);
      if (dialog.m_pStaticGuideDesc) watch(`${name} guide`, dialog.m_pStaticGuideDesc as unknown as { onFrameRender(...args: never[]): number });
    }
    try {
      const scene = await drawScene(m.w, () => body(m.w), { snapshot: pageSnapshot(m.w), textureOf: (() => {
        const files = fileTextures(m.w);
        return (d: Draw) => d.image ?? files(d);
      })(), ...(savedAs ? { savedAs } : {}) });
      return { ...scene, spans, inside };
    } finally {
      dvb.drawPrimitive = realDraw;
      for (const undo of restore) undo();
    }
  }

  /**
   * The draws and the picture of one dialog drawn alone on a cleared buffer.  It is drawn twice and the second is the answer: the first one fills the glyph
   * cache, and a string whose glyphs are not all there yet is sent to the device in more pieces than one that finds them (the cache flushes the page it
   * changed), so only a warm cache makes the draws that a frame of the manager makes.
   */
  async function alone(m: Rig, dialog: CKTDGUIDialog) {
    const files = fileTextures(m.w);
    const once = () => drawScene(m.w, () => void dialog.onFrameRender(false), { snapshot: pageSnapshot(m.w), textureOf: (d) => d.image ?? files(d) });
    await once();
    const scene = await once();
    expect(scene.referenceError).toBeUndefined();
    return scene;
  }

  /** the draws that no call the body made itself was responsible for (what the manager draws on its own: the slot that is being dragged) */
  const unspanned = (scene: { draws: Draw[]; spans: { from: number; to: number }[] }): number =>
    scene.draws.length - scene.spans.reduce((n, span) => n + (span.to - span.from), 0);

  const agrees = (image: RefImage, reference: RefImage): void => {
    const d = compareImages(image, reference, TOLERANCE);
    expect([d.over, d.max <= TOLERANCE]).toEqual([0, true]);
  };
  /** how many pixels differ from the other picture by more than the tolerance */
  const differing = (a: RefImage, b: RefImage): number => compareImages(a, b, TOLERANCE).over;

  test("the dialogs are drawn from the back of the list to the front, each making the draws it makes alone, and the picture is Direct3D 9's composition of them in that order", async () => {
    const m = await rig();
    // `_InsertIntoDialogListTop`: the dialogs that are not in front come first, then those in front by their layer (the party at 4, the glow at 500)
    expect(m.list()).toEqual(["back", "lobby", "party", "glow"]);
    expect([m.back, m.lobby, m.party, m.glow].map((d) => [d.m_bFront, d.m_iLayer])).toEqual([[false, 0], [false, 0], [true, 4], [true, 500]]);
    const textures = new Map<unknown, number>();
    const sign = (draws: Draw[]) => draws.map((d) => signature(d, textures));
    const alones = { back: await alone(m, m.back), lobby: await alone(m, m.lobby), party: await alone(m, m.party), glow: await alone(m, m.glow) };
    expect([alones.back.draws.length, alones.lobby.draws.length, alones.glow.draws.length]).toEqual([3, 2, 2]);
    expect(alones.party.draws.length).toBeGreaterThan(100);

    const rear = await frame(m, (w) => void w.dialogManager.onFrameRender(false), "ui-manager-rear");
    expect(rear.spans.map((s) => s.name)).toEqual(["back", "lobby"]);
    expect(unspanned(rear)).toBe(0);
    expect(sign(rear.draws)).toEqual([...sign(alones.back.draws), ...sign(alones.lobby.draws)]);
    expect(rear.referenceError).toBeUndefined();
    agrees(rear.image, rear.reference);

    const front = await frame(m, (w) => void w.dialogManager.onFrameRender(true), "ui-manager-front");
    expect(front.spans.map((s) => s.name)).toEqual(["party", "glow"]);
    expect(unspanned(front)).toBe(0);
    expect(sign(front.draws)).toEqual([...sign(alones.party.draws), ...sign(alones.glow.draws)]);
    expect(front.referenceError).toBeUndefined();
    agrees(front.image, front.reference);

    // the client's two calls of a frame, one scene: the rear dialogs, then the front ones
    const both = await frame(m, (w) => {
      w.dialogManager.onFrameRender(false);
      w.dialogManager.onFrameRender(true);
    }, "ui-manager-both");
    expect(both.spans.map((s) => s.name)).toEqual(["back", "lobby", "party", "glow"]);
    expect(both.draws.length).toBe(rear.draws.length + front.draws.length);
    agrees(both.image, both.reference);
    releaseTextures(m.w);
  }, 300_000);

  test("the order is what the picture shows: the dialog that is drawn last covers the ones before it, and a higher layer stays in front of a dialog brought to the top", async () => {
    const m = await rig();
    const backAlone = (await alone(m, m.back)).image;
    const lobbyAlone = (await alone(m, m.lobby)).image;
    const gap = differing(backAlone, lobbyAlone);
    expect(gap).toBeGreaterThan(100000); // two different pictures of the whole screen

    // the lobby background is drawn after the other and covers it: its pixels are the picture where it is opaque
    const first = await frame(m, (w) => void w.dialogManager.onFrameRender(false), "ui-manager-lobby-on-top");
    expect(first.spans.map((s) => s.name)).toEqual(["back", "lobby"]);
    agrees(first.image, first.reference);
    const firstNearLobby = differing(first.image, lobbyAlone);
    const firstNearBack = differing(first.image, backAlone);
    expect(firstNearLobby).toBeLessThan(firstNearBack);

    // `ChangeSequence(back, top)`: the background goes to the top of its layer, behind the dialogs in front
    expect(m.w.dialogManager.changeSequence(m.back, true)).toBe(true);
    expect(m.list()).toEqual(["lobby", "back", "party", "glow"]);
    const second = await frame(m, (w) => void w.dialogManager.onFrameRender(false), "ui-manager-back-on-top");
    expect(second.spans.map((s) => s.name)).toEqual(["lobby", "back"]);
    agrees(second.image, second.reference);
    expect(differing(second.image, backAlone)).toBeLessThan(differing(second.image, lobbyAlone));

    // `ChangeLayer(back, 3)` and then the lobby background to the top of ITS layer: layer 3 is above layer 0, the lobby stays behind
    expect(m.w.dialogManager.changeLayer(m.back, 3)).toBe(true);
    expect(m.w.dialogManager.changeSequence(m.lobby, true)).toBe(true);
    expect(m.list()).toEqual(["lobby", "back", "party", "glow"]);
    const third = await frame(m, (w) => void w.dialogManager.onFrameRender(false), "ui-manager-layer");
    expect(third.spans.map((s) => s.name)).toEqual(["lobby", "back"]);
    agrees(third.image, third.reference);
    expect(differing(third.image, second.image)).toBe(0);

    // ... and the other way round: the lobby background in layer 5 is above the other one's 3
    expect(m.w.dialogManager.changeLayer(m.lobby, 5)).toBe(true);
    expect(m.list()).toEqual(["back", "lobby", "party", "glow"]);
    const fourth = await frame(m, (w) => void w.dialogManager.onFrameRender(false));
    expect(fourth.spans.map((s) => s.name)).toEqual(["back", "lobby"]);
    expect(differing(fourth.image, first.image)).toBe(0);
    releaseTextures(m.w);
  }, 300_000);

  test("OnFrameRender(false) draws the dialogs that are not in front and OnFrameRender(true) those that are (ChangeFront): a background that goes to the front is drawn under the dialogs of the front", async () => {
    const m = await rig();
    expect(m.w.dialogManager.changeFront(m.back, true)).toBe(true);
    expect(m.list()).toEqual(["lobby", "back", "party", "glow"]); // in front, layer 0: before the party at layer 4
    const rear = await frame(m, (w) => void w.dialogManager.onFrameRender(false));
    expect(rear.spans.map((s) => s.name)).toEqual(["lobby"]);
    agrees(rear.image, rear.reference);
    const front = await frame(m, (w) => void w.dialogManager.onFrameRender(true), "ui-manager-back-in-front");
    expect(front.spans.map((s) => s.name)).toEqual(["back", "party", "glow"]);
    agrees(front.image, front.reference);
    // the party's list is drawn over the background: the picture of the party alone on the background is the picture of the three
    const textures = new Map<unknown, number>();
    const draws = front.draws.map((d) => signature(d, textures));
    const backDraws = (await alone(m, m.back)).draws.map((d) => signature(d, textures));
    expect(draws.slice(0, backDraws.length)).toEqual(backDraws);
    releaseTextures(m.w);
  }, 300_000);

  test("the guide text of a dialog is drawn after all the dialogs of its group, and the slot that is being dragged after that: only by OnFrameRender(true)", async () => {
    const m = await rig();
    const button = m.party.m_ControlsList.find((c): c is CKTDGUIButton => c instanceof CKTDGUIButton)!;
    button.m_GuideDesc = "the guide text of a button";
    m.party.showGuideDesc(button); // CreateGuideDesc: the dialog `DLG_GuideDesc.lua` (layer 400, handed to the manager) and the static the party keeps
    const guide = m.party.m_pStaticGuideDesc as CKTDGUIStatic;
    expect(guide).not.toBeNull();
    expect(guide.m_bShow).toBe(true);
    const guideDialog = m.party.m_pDialogGuideDesc!;
    expect([guideDialog.m_bFront, guideDialog.m_iLayer]).toEqual([true, 400]);
    m.names.set(guideDialog, "guide dialog");
    guideDialog.onFrameMove(0.1, 0.1); // the fade-in (0.07 s) of the guide dialog is over (a frame of the party would hide it again: the control asks for it anew each frame)

    // the slot that is being dragged: a key of the key setting dialog, in the same manager
    const keys = m.w.openDialog(KEYS, 0, new CX2SlotManager(m.w));
    expect(m.w.dialogManager.addDlg(keys)).toBe(true);
    m.names.set(keys, "keys");
    expect([keys.m_bFront, keys.m_iLayer]).toEqual([true, 400]); // the same layer as the guide dialog: behind none of it
    expect(m.list()).toEqual(["back", "lobby", "party", "guide dialog", "keys", "glow"]);
    const slot = keys.m_ControlsList.find((c): c is CKTDGUISlot => c instanceof CKTDGUISlot)!;
    slot.m_eControlState = SCS.ONDRAG;
    slot.m_bHasFocus = true;
    m.w.mouse.m_XPos = 600;
    m.w.mouse.m_YPos = 600;
    CKTDGUISlot.s_pDragSlot = slot;

    // not in front: the dialogs that are not in front, and nothing else (no guide text, no slot)
    const rear = await frame(m, (w) => void w.dialogManager.onFrameRender(false), "ui-manager-guide-rear");
    expect(rear.spans.map((s) => s.name)).toEqual(["back", "lobby"]);
    expect(unspanned(rear)).toBe(0); // (not the guide text of the party, not the slot)
    agrees(rear.image, rear.reference);

    // in front: the dialogs of the front in the order of the list, then the guide text's static (a second time: its dialog is one of them), then the slot
    const front = await frame(m, (w) => void w.dialogManager.onFrameRender(true), "ui-manager-guide-front");
    expect(front.spans.map((s) => s.name)).toEqual(["party", "guide dialog", "keys", "glow", "party guide"]);
    expect(front.inside.map((s) => s.name)).toEqual(["party guide"]); // (the guide dialog's own draw of its static)
    const own = front.inside[0]!;
    const guideDialogSpan = front.spans[1]!;
    expect([own.from >= guideDialogSpan.from, own.to <= guideDialogSpan.to, own.to > own.from]).toEqual([true, true, true]);
    expect(front.referenceError).toBeUndefined();
    agrees(front.image, front.reference);
    const last = front.spans[front.spans.length - 1]!;
    const dragged = front.draws.slice(last.to); // what no dialog's `onFrameRender` made: the slot's own draw
    expect(dragged.length).toBe(1);
    expect(unspanned(front)).toBe(1);
    const v = new Float32Array(dragged[0]!.data.buffer, dragged[0]!.data.byteOffset, 28);
    // a key is 35 x 35, centred on the mouse (600, 600): 582.5 .. 617.5, moved half a pixel
    expect([v[0], v[1], v[7], v[8], v[14], v[15], v[21], v[22]]).toEqual([581.5, 581.5, 616.5, 581.5, 581.5, 616.5, 616.5, 616.5]);
    expect(last.to - last.from).toBe(own.to - own.from); // the second pass makes the draws of the first again

    // the same frame without the drag: one draw fewer
    CKTDGUISlot.s_pDragSlot = null;
    const dropped = await frame(m, (w) => void w.dialogManager.onFrameRender(true));
    expect(dropped.draws.length).toBe(front.draws.length - 1);
    expect(unspanned(dropped)).toBe(0);

    // the guide text of a dialog that is not shown is not drawn (its dialog is: nothing hides it here)
    m.party.m_bShow = false;
    const hiddenParty = await frame(m, (w) => void w.dialogManager.onFrameRender(true));
    expect(hiddenParty.spans.map((s) => s.name)).toEqual(["guide dialog", "keys", "glow"]);
    expect(hiddenParty.inside.map((s) => s.name)).toEqual(["party guide"]);
    releaseTextures(m.w);
  }, 300_000);

  test("a dialog that is not shown is not drawn; a manager that is not shown draws nothing, or, when it can hide, the four dialogs it names", async () => {
    const m = await rig();
    m.lobby.m_bShow = false;
    const hidden = await frame(m, (w) => void w.dialogManager.onFrameRender(false));
    expect(hidden.spans.map((s) => s.name)).toEqual(["back"]);
    agrees(hidden.image, hidden.reference);
    m.lobby.m_bShow = true;

    m.w.dialogManager.SetShow(false);
    expect(m.w.dialogManager.m_bCanHide).toBe(false);
    const none = await frame(m, (w) => {
      w.dialogManager.onFrameRender(false);
      w.dialogManager.onFrameRender(true);
    });
    expect([none.spans.length, none.draws.length]).toEqual([0, 0]);
    expect(differing(none.image, none.reference)).toBe(0); // the cleared buffer

    // a manager that can hide draws, hidden, the dialogs named `DLG_ChatBox_EditBox`, `DLG_MsgBox`, `DLG_OKMsgBox` and `OkAndCancelMsgBox` that are shown
    m.w.dialogManager.m_bCanHide = true;
    m.lobby.m_Name = "DLG_MsgBox";
    m.glow.m_Name = "OkAndCancelMsgBox";
    m.party.m_Name = "DLG_OKMsgBox";
    const named = await frame(m, (w) => void w.dialogManager.onFrameRender(false), "ui-manager-hidden");
    expect(named.spans.map((s) => s.name)).toEqual(["lobby", "party", "glow"]); // in the manager's order of names: MsgBox, OKMsgBox, OkAndCancelMsgBox
    expect(unspanned(named)).toBe(0);
    agrees(named.image, named.reference);
    // one that is not shown is passed over, and the rest of the dialogs are not drawn whatever their names
    m.party.m_bShow = false;
    const shownOnly = await frame(m, (w) => void w.dialogManager.onFrameRender(false));
    expect(shownOnly.spans.map((s) => s.name)).toEqual(["lobby", "glow"]);
    m.w.dialogManager.m_bShow = true;
    m.party.m_bShow = true;
    const shown = await frame(m, (w) => void w.dialogManager.onFrameRender(false)); // shown: the dialogs that are not in front, whatever their names
    expect(shown.spans.map((s) => s.name)).toEqual(["back", "lobby"]);
    releaseTextures(m.w);
  }, 300_000);

  test("OnFrameRenderTopModal draws the dialog nearest the front that is enabled, shown and not modal, and only that one", async () => {
    const m = await rig();
    expect([m.back.m_bModal, m.lobby.m_bModal, m.party.m_bModal, m.glow.m_bModal]).toEqual([true, true, false, false]);
    const top = await frame(m, (w) => void w.dialogManager.onFrameRenderTopModal());
    expect(top.spans.map((s) => s.name)).toEqual(["glow"]);
    agrees(top.image, top.reference);
    m.glow.m_bShow = false;
    const next = await frame(m, (w) => void w.dialogManager.onFrameRenderTopModal());
    expect(next.spans.map((s) => s.name)).toEqual(["party"]);
    m.party.m_bEnable = false;
    const none = await frame(m, (w) => void w.dialogManager.onFrameRenderTopModal());
    expect(none.spans.length).toBe(0); // the two backgrounds are modal
    expect(none.draws.length).toBe(0);
    // a manager that can hide and is hidden draws none of them
    m.party.m_bEnable = true;
    m.party.m_bShow = true;
    m.w.dialogManager.m_bCanHide = true;
    m.w.dialogManager.SetShow(false);
    const hidden = await frame(m, (w) => void w.dialogManager.onFrameRenderTopModal());
    expect([hidden.spans.length, hidden.draws.length]).toEqual([0, 0]);
    m.w.dialogManager.SetShow(true);
    const again = await frame(m, (w) => void w.dialogManager.onFrameRenderTopModal());
    expect(again.spans.map((s) => s.name)).toEqual(["party"]); // (the glow is not shown)
    releaseTextures(m.w);
  }, 300_000);
});
