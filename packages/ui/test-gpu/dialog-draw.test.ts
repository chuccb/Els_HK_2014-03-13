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
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CKTDGUIButton, CKTDGUIComboBox, CKTDGUIEditBox, CKTDGUIIMEEditBox, CKTDGUIListBox, CKTDGUIRadioButton, CKTDGUISlot, CKTDGUIStatic, FONT_STYLE, LBIT, SCS, UIStringData, UKFont } from "../src/index.ts";
import type { CKTDGUIDialog, UIWorld } from "../src/index.ts";
import { Color } from "@els/host";
import { gpuAvailable } from "../../d3d9/test/gpu-helper.ts";
import { compareImages, newTarget } from "./reference.ts";
import type { Difference } from "./reference.ts";
import { CLEAR, HEIGHT, TOLERANCE, WIDTH, drawDialog, drawnControls, releaseDrawn } from "./draw.ts";
import type { Draw, Drawn } from "./draw.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const HAVE_GPU = haveData && (await gpuAvailable());

/** a call of a UK font that draws (`OutTextMultiline`, or `Draw2DText` for a static's string that does not use a UK font) and the text it was given */
interface Spoken {
  method: string;
  text: string;
}

/**
 * The strings the dialog hands to the fonts, in the order of its control list, as its scripts say them: a shown static's strings that have
 * text (a spreading one shows `iSpreadCount` characters), and the string of each shown button and radio button (one with an empty message
 * is drawn too).  A static's string goes to `Draw2DText` unless it uses a UK font.  A closed combo box that is not static speaks the text
 * of its selected row (cut to `m_iTextLimit` characters when that is above 0) if it shows it and has string data.  (None of these dialogs
 * has an open box or a static one, whose rows are controls.)  A list box speaks the text of the rows from its bar's position that fit in the
 * text rectangle (`listBoxStrings`).  A slot with string data speaks its whole message, an empty one too (the key setting has 142 of them).
 */
function expectedStrings(dlg: CKTDGUIDialog, w: UIWorld): Spoken[] {
  const out: Spoken[] = [];
  for (const c of drawnControls(dlg)) {
    if (c instanceof CKTDGUIStatic) {
      for (const t of c.m_StringDataList) {
        if (t.msg.length === 0) continue;
        out.push({ method: t.bUseUkFont ? "OutTextMultiline" : "Draw2DText", text: t.bSpread ? t.msg.slice(0, Math.min(t.iSpreadCount, t.msg.length)) : t.msg });
      }
    } else if ((c instanceof CKTDGUIButton || c instanceof CKTDGUIRadioButton) && c.m_pStringData) out.push({ method: "OutTextMultiline", text: c.m_pStringData.msg });
    else if (c instanceof CKTDGUIComboBox) {
      expect([c.m_bOpened, c.m_bIsStaticComboBox]).toEqual([false, false]);
      const row = c.m_Items[c.m_iSelected];
      if (c.m_bSelectTextShow && c.m_pStringData && c.m_iSelected >= 0 && row) {
        out.push({ method: "OutTextMultiline", text: c.m_iTextLimit > 0 ? row.strText.slice(0, c.m_iTextLimit) : row.strText });
      }
    } else if (c instanceof CKTDGUIListBox) out.push(...listBoxStrings(c, w));
    else if (c instanceof CKTDGUISlot && c.m_pStringData) out.push({ method: "OutTextMultiline", text: c.m_pStringData.msg });
    else if (c instanceof CKTDGUIEditBox) out.push(...editBoxStrings(c));
    else if (c instanceof CKTDGUIIMEEditBox) out.push(...imeBoxStrings(c, w));
  }
  return out;
}

/**
 * What an edit box says (`DrawTextW` of the text, which is `DrawTextFont` of its font): the text from the first visible character on (a password
 * box says its hide character for each character of the text), and, when the caret is not at the selection's start, the selected part again: from
 * the larger of the first visible character and the smaller of the caret and the selection's start, as far as the larger of those two.
 */
function editBoxStrings(c: CKTDGUIEditBox): Spoken[] {
  const typed = c.m_Buffer.m_pwszBuffer ?? "";
  const text = c.m_bPasswordEditBox ? String.fromCharCode(c.m_HideChar).repeat(typed.length) : typed;
  const out: Spoken[] = [{ method: "DrawTextFont", text: text.slice(c.m_nFirstVisible) }];
  if (c.m_nCaret !== c.m_nSelStart) {
    const start = Math.max(c.m_nFirstVisible, Math.min(c.m_nCaret, c.m_nSelStart));
    out.push({ method: "DrawTextFont", text: text.slice(start, Math.max(c.m_nCaret, c.m_nSelStart)) });
  }
  return out;
}

/**
 * What an IME edit box says: what the edit box says (the text from the first visible character on, no hiding, and the selected part again), and
 * for a focused box the composition string after them (`RenderComposition`: one piece, as a string that fits the text rectangle is, an empty one
 * too; then each character of the attribute 1 or 3 by itself), then the window of the candidates, one line (the text and its selected part again)
 * when the list is horizontal (the reading window and a vertical list are not said here).
 */
function imeBoxStrings(c: CKTDGUIIMEEditBox, w: UIWorld): Spoken[] {
  const typed = c.m_Buffer.m_pwszBuffer ?? "";
  const out: Spoken[] = [{ method: "DrawTextFont", text: typed.slice(c.m_nFirstVisible) }];
  if (c.m_nCaret !== c.m_nSelStart) {
    const start = Math.max(c.m_nFirstVisible, Math.min(c.m_nCaret, c.m_nSelStart));
    out.push({ method: "DrawTextFont", text: typed.slice(start, Math.max(c.m_nCaret, c.m_nSelStart)) });
  }
  if (!c.m_bHasFocus) return out;
  const ime = w.ime;
  const comp = ime.s_CompString.m_pwszBuffer ?? "";
  out.push({ method: "DrawTextFont", text: comp });
  for (let i = 0; i < comp.length; i++) {
    const attribute = ime.s_abCompStringAttr[i];
    if (attribute === 1 || attribute === 3) out.push({ method: "DrawTextFont", text: comp[i]! });
  }
  expect([ime.s_bShowReadingWindow, ime.s_bVerticalCand]).toEqual([false, false]);
  if (ime.s_CandList.bShowWindow) {
    const line = ime.s_CandList.HoriCand.m_pwszBuffer ?? "";
    out.push({ method: "DrawTextFont", text: line });
    out.push({ method: "DrawTextFont", text: line.slice(ime.s_CandList.nFirstSelected, ime.s_CandList.nFirstSelected + ime.s_CandList.nHoriSelectedLen) });
  }
  return out;
}

/**
 * What a list box (not a static one: its rows are controls) says: with string data, a UK font of the string data's index and a scroll bar, the
 * rows from the bar's position on, as long as one more row (the height of that font's line) ends inside the text rectangle; a row that is
 * not shown takes its place and says nothing; a row of type 0 or 1 is said by the box's font, one of type 2 or 3 (a group) by its group font
 * (which is there or the row is silent).  A spreading row says its first `iSpreadCount` characters.
 */
function listBoxStrings(c: CKTDGUIListBox, w: UIWorld): Spoken[] {
  expect(c.m_bIsStaticListBox).toBe(false);
  const out: Spoken[] = [];
  const font = c.m_pStringData ? w.fonts.getUKFont(c.m_pStringData.fontIndex) : null;
  const bar = c.m_pScrollBar;
  if (!font || !bar) return out;
  const height = font.lineHeight();
  let bottom = c.m_rcText.top + height;
  for (let i = bar.m_nPosition; i < c.m_Items.length && bottom <= c.m_rcText.bottom; i++, bottom += height) {
    const row = c.m_Items[i]!;
    if (!row.m_bShow) continue;
    const spoken = row.bSpread ? row.strText.slice(0, Math.min(row.iSpreadCount, row.strText.length)) : row.strText;
    if (row.itemType === LBIT.DEFAULT || row.itemType === LBIT.NOT_ENABLE ? c.m_pUKFont : row.itemType === LBIT.GROUP_PLUS || row.itemType === LBIT.GROUP_MINUS ? c.m_pGroupUKFont : null) {
      out.push({ method: "OutTextMultiline", text: spoken });
    }
  }
  return out;
}

/** what the fonts were asked to draw while a dialog was drawn (the calls the controls make; those the fonts make of each other are not written down) */
const spoken: Spoken[] = [];
let listening: (() => void) | undefined;
function listen(): void {
  const { OutTextMultiline, Draw2DText, DrawTextFont } = UKFont.prototype;
  let depth = 0;
  const note = (method: string, text: string, call: () => void): void => {
    if (depth === 0) spoken.push({ method, text });
    depth++;
    try {
      call();
    } finally {
      depth--;
    }
  };
  UKFont.prototype.OutTextMultiline = function (this: UKFont, ...args: Parameters<UKFont["OutTextMultiline"]>): void {
    note("OutTextMultiline", args[2] ?? "<null>", () => OutTextMultiline.apply(this, args));
  };
  UKFont.prototype.Draw2DText = function (this: UKFont, ...args: Parameters<UKFont["Draw2DText"]>): void {
    note("Draw2DText", args[0] ?? "<null>", () => Draw2DText.apply(this, args));
  };
  UKFont.prototype.DrawTextFont = function (this: UKFont, ...args: Parameters<UKFont["DrawTextFont"]>): void {
    const [text, , count] = args;
    note("DrawTextFont", text === null ? "<null>" : count < 0 ? text : text.slice(0, count), () => DrawTextFont.apply(this, args));
  };
  listening = () => {
    UKFont.prototype.OutTextMultiline = OutTextMultiline;
    UKFont.prototype.Draw2DText = Draw2DText;
    UKFont.prototype.DrawTextFont = DrawTextFont;
  };
}
beforeAll(listen);
afterAll(() => listening?.());

/**
 * How many bars of edges the dialog draws (`CKTDXDeviceTexture::Draw` each; an edge is eight of them, two passes of four before and after the
 * quad): a shown static's picture that has an edge width, a button that has the focus (none at the start) and a width, a checked radio button
 * with a width, a shown additional picture of a slot that has an edge width
 */
function expectedEdgeBars(dlg: CKTDGUIDialog): number {
  let edges = 0;
  for (const c of drawnControls(dlg)) {
    if (c instanceof CKTDGUIStatic) edges += c.m_PictureDataList.filter((p) => p.bShow && p.pPoint && p.pTexture?.pTexture && p.m_EdgeWidth !== 0).length;
    else if (c instanceof CKTDGUIButton) edges += c.m_bHasFocus && c.m_EdgeWidth > 0 ? 1 : 0;
    else if (c instanceof CKTDGUIRadioButton) edges += c.m_bChecked && c.m_CheckedEdgeWidth !== 0 ? 1 : 0;
    else if (c instanceof CKTDGUISlot) edges += [...c.m_mapAdditionalPictureDataList.values()].filter((p) => p.bShow && p.pPoint && p.pTexture?.pTexture && p.m_EdgeWidth !== 0).length;
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
 *    counter-clockwise (culled clockwise): left-top, left-bottom, right-top, right-bottom;
 *  - a flush of a glyph page (`CKTDGFreeTypeFont::Flush`): a list of quads (primitive 4) with the 13 states of the font (blending SRCALPHA /
 *    INVSRCALPHA, no z write, linear filters) over the dialog's own (no z test, no alpha test, clockwise, mirrored addressing), the texture a
 *    glyph page (`image`: the pixels it had at the draw).
 * Returns how many bars of edges and how many flushes of text there are.
 */
function expectUIQuads(draws: Draw[]): { edgeBars: number; textDraws: number; flatQuads: number } {
  let edgeBars = 0;
  let textDraws = 0;
  let flatQuads = 0;
  for (const d of draws) {
    if (d.primitive === 4) {
      textDraws++;
      expect([d.type, d.primitive, d.numDraws, d.numPrimitives % 2, d.numPrimitives > 0]).toEqual([3, 4, 1, 0, true]);
      expect([d.blendEnable, d.zWrite, d.srcBlend, d.destBlend]).toEqual([1, 0, 5, 6]);
      expect([d.minFilter, d.magFilter, d.addressU, d.addressV]).toEqual([2, 2, 2, 2]);
      expect([d.zEnable, d.alphaTest, d.cullMode]).toEqual([0, 0, 3]);
      expect(d.texture).not.toBeNull();
      expect(d.image).toBeTruthy();
      expect(d.data.length).toBeGreaterThanOrEqual(d.numPrimitives * 3 * 28);
      continue;
    }
    expect([d.type, d.primitive, d.numPrimitives, d.data.length]).toEqual([3, 5, 2, 112]);
    expect([d.blendEnable, d.zEnable, d.srcBlend, d.destBlend]).toEqual([1, 0, 5, 6]);
    expect([d.minFilter, d.magFilter, d.addressU, d.addressV]).toEqual([2, 2, 2, 2]);
    // the rectangle of an edit box (`DrawRect`) has stage 0 select the diffuse colour for the colour and the alpha, whatever texture is on the
    // stage; every other quad of the UI has a texture
    if (d.colorOp === 3 && d.alphaOp === 3) flatQuads++;
    else expect(d.texture).not.toBeNull();
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
  return { edgeBars, textDraws, flatQuads };
}

/**
 * the checks of a dialog that is drawn completely: nothing is left uncounted and the picture is the one the rules of Direct3D 9 give.
 * `covers`: how many pixels of the window at least are not the clear colour (a window of the game fills much of it, a popup little)
 */
function expectDrawnLikeDirect3D(name: string, r: Drawn, covers = 200_000): { edgeBars: number; textDraws: number; flatQuads: number } {
  expect(r.dlg.m_bSuccessInitOpenScript).toBe(true);
  expect(r.frameError).toBeUndefined(); // the frame (OnFrameMove) before the drawing needs nothing that is not ported
  expect(r.ret).toBe(0);
  expect(r.referenceError).toBeUndefined(); // the CPU composition has a rule for every quad
  expect(r.w.devices.massFiles.log.entries).toEqual([]);
  expect(r.draws.length).toBeGreaterThan(0);
  const { edgeBars, textDraws, flatQuads } = expectUIQuads(r.draws);
  expect(edgeBars).toBe(expectedEdgeBars(r.dlg));
  expect(r.w.render!.states.stackPointer).toBe(0);
  // nothing is counted as not drawn: every control class of these dialogs is drawn, the strings of the statics, buttons, radio buttons, combo boxes, list
  // boxes and slots included, the edit boxes and the IME edit boxes, and the movies (a movie without a player draws its empty render target texture)
  expect(Object.fromEntries(r.w.render!.undrawn)).toEqual({});
  // the controls asked the fonts for the strings the scripts say, and a string with something to see made quads
  expect(spoken).toEqual(expectedStrings(r.dlg, r.w));
  expect(textDraws > 0).toBe(spoken.some((t) => /\S/.test(t.text)));
  const d = compareImages(r.image, r.reference, TOLERANCE);
  expect(d.over, report(name, d)).toBe(0);
  // it is a picture: a good part of the window is not the clear colour
  expect(compareImages(r.image, newTarget(WIDTH, HEIGHT, CLEAR[0]!, CLEAR[1]!, CLEAR[2]!), 0).over).toBeGreaterThan(covers);
  return { edgeBars, textDraws, flatQuads };
}

const suite = HAVE_GPU ? describe : describe.skip;

/**
 * Every dialog is drawn in a world of its own, and a world keeps its GPU memory until it is released: the textures of the dialog, the buffers
 * of the dynamic vertex buffer manager and the page textures of the fonts (48 for the client's seven).  A test that fails gives it back too.
 */
const drawn: Drawn[] = [];
afterEach(() => {
  for (const r of drawn.splice(0)) releaseDrawn(r);
});
async function draw(script: string, savedAs: string, prepare?: (dlg: CKTDGUIDialog, w: UIWorld) => void, after?: (dlg: CKTDGUIDialog, w: UIWorld) => void): Promise<Drawn> {
  spoken.length = 0;
  const r = await drawDialog(script, savedAs, undefined, 1, prepare, after);
  drawn.push(r);
  return r;
}

suite("dialogs drawn through @els/d3d9 by the ported UI", () => {
  test("DLG_UI_EVENT_BINGO_MAIN (pictures and buttons with alpha: the buttons' own blend states are the baseline's)", async () => {
    const r = await draw("DLG_UI_EVENT_BINGO_MAIN.LUA", "ui-DLG_UI_EVENT_BINGO_MAIN");
    expectDrawnLikeDirect3D("DLG_UI_EVENT_BINGO_MAIN", r);
    expect(r.draws.length).toBeGreaterThan(50);
  }, 120_000);

  // a window of pictures and buttons, the character sheet, a list of 52 controls, the backdrop of three stretched textures, a world map
  for (const name of ["DLG_MAP_SELECT_WINDOW", "DLG_UI_CHARACTER_NEW", "DLG_UI_CHANNEL_SELECTION", "DLG_UNIT_CREATE_BACK", "DLG_UI_WORLD_MAP_NEW"]) {
    test(name, async () => {
      expectDrawnLikeDirect3D(name, await draw(`${name}.LUA`, `ui-${name}`));
    }, 120_000);
  }

  // the rest of the controls and the edges: Static pictures with an edge, radio buttons (a tab that is checked), a slider, check boxes (one that
  // is checked), a list with a scroll bar, a navigation with one, a dialog with pictures of a key that its TET lacks (quads without area)
  const more: { name: string; covers: number; classes: Record<string, number>; edgeBars?: number; flatQuads?: number; prepare?: (dlg: CKTDGUIDialog, w: UIWorld) => void }[] = [
    { name: "DLG_SKILL_INFO_POPUP", covers: 70_000, classes: { CKTDGUIStatic: 1 }, edgeBars: 8 },
    { name: "DLG_UI_SKILL_DESC", covers: 15_000, classes: { CKTDGUIStatic: 2 }, edgeBars: 8 },
    { name: "DLG_COMMAND_SKILL", covers: 200_000, classes: { CKTDGUIRadioButton: 5, CKTDGUISlider: 1, CKTDGUIButton: 2 } },
    { name: "DLG_CASH_SHOP_POPUP_BUY_HK", covers: 200_000, classes: { CKTDGUICheckBox: 1, CKTDGUIButton: 6 } },
    { name: "DLG_CHATBOX_POPUP", covers: 5_000, classes: { CKTDGUICheckBox: 8 } },
    { name: "DLG_UI_GUILD_SKILL_TREE", covers: 100_000, classes: { CKTDGUIContolList: 1, CKTDGUIRadioButton: 3 } },
    { name: "DLG_UI_NEW_QUEST_LIST", covers: 200_000, classes: { CKTDGUINavigation: 1, CKTDGUIRadioButton: 16, CKTDGUICheckBox: 1 } },
    { name: "DLG_UI_PARTYLIST", covers: 200_000, classes: { CKTDGUIRadioButton: 12 } },
    // the combo boxes: a button and a text rectangle each, the selected row's text
    { name: "DLG_UI_OPTION_GRAPHIC", covers: 20_000, classes: { CKTDGUIComboBox: 1, CKTDGUIRadioButton: 15, CKTDGUICheckBox: 4 } },
    { name: "DLG_UI_OPTION_CAM_EX", covers: 20_000, classes: { CKTDGUIComboBox: 4, CKTDGUIRadioButton: 5 } },
    { name: "DLG_UI_SYNTHESIS", covers: 20_000, classes: { CKTDGUIComboBox: 1, CKTDGUIButton: 3 } },
    // the list boxes: the bounding box, the rows the script put in (the emotions of the chat: seven rows, six fit; the description of a title, in
    // Korean) and the scroll bar
    { name: "DLG_CHATBOX_EMOTION_LIST", covers: 5_000, classes: { CKTDGUIListBox: 1, CKTDGUIStatic: 1 } },
    { name: "DLG_TITLE_WINDOW", covers: 150_000, classes: { CKTDGUIListBox: 3, CKTDGUIButton: 14, CKTDGUIStatic: 4, CKTDGUICheckBox: 1 } },
    // a list the game fills: group rows (the plus and minus marks), a selected row, a dimmed one, one of its own colour, more rows than fit; and
    // the chat line (an IME edit box that has the focus): five typed characters with four of them selected, a composition string of two
    // characters (the first converted, the second not: the clause is drawn over it a character at a time) with the caret between them, and the
    // candidates of a Hong Kong layout (0x0C04) as one line with the second one selected.  Drawn as rectangles (`DrawRect`, the diffuse colour
    // alone): the selection, the caret, the window of the composition string, two clauses (without a width: the x of a trailing edge is the x
    // of the character), the caret of the string, the window of the candidates and its selection
    {
      name: "DLG_MESSENGER_WINDOW",
      covers: 20_000,
      classes: { CKTDGUIListBox: 1, CKTDGUIButton: 7, CKTDGUIIMEEditBox: 1 },
      flatQuads: 8,
      prepare: (dlg, w) => {
        const chat = dlg.m_ControlsList.find((c): c is CKTDGUIIMEEditBox => c instanceof CKTDGUIIMEEditBox)!;
        expect([chat.m_bHasFocus, chat.m_bShow, chat.m_pFont !== null]).toEqual([true, true, true]);
        expect(chat.m_Buffer.SetText("Hello")).toBe(true);
        chat.m_nSelStart = 1;
        chat.m_nCaret = 5;
        const ime = w.ime;
        ime.s_hklCurrent = 0x0c04;
        expect(ime.s_CompString.SetText("\u4f60\u597d")).toBe(true);
        ime.s_abCompStringAttr[0] = 1;
        ime.s_abCompStringAttr[1] = 3;
        ime.s_nCompCaret = 1;
        expect(ime.s_CandList.HoriCand.SetText("1.\u4f60 2.\u59b3 3.\u6ce5 4.\u5c3c")).toBe(true);
        ime.s_CandList.nFirstSelected = 4; // "2.\u59b3"
        ime.s_CandList.nHoriSelectedLen = 3;
        ime.s_CandList.bShowWindow = true;
        const box = dlg.m_ControlsList.find((c): c is CKTDGUIListBox => c instanceof CKTDGUIListBox)!;
        box.addItem("Friends (3)", null, 0, LBIT.GROUP_MINUS, false, 0);
        box.addItem("Aisha", null, 1, LBIT.DEFAULT, false, 0);
        box.addItem("Rena", null, 1, LBIT.NOT_ENABLE, false, 0);
        box.addString("Raven", new Color(0.9, 0.2, 0.1, 1), null, null);
        box.addItem("Guild (12)", null, 0, LBIT.GROUP_PLUS, false, 0);
        for (let k = 0; k < 40; k++) box.addItem(`Guildmate ${k + 1}`, null, 1, LBIT.DEFAULT, false, 0);
        box.m_nSelected = 1;
      },
    },
    // the edit box (the password box of a confirmation window, `SetHideChar`): the script gives it a font, colours (a red selection, black text and
    // caret) and the focus; the test types eight characters and selects four of them.  Drawn: the rectangle of the selection (a quad of the
    // diffuse colour alone, `DrawRect`), the eight hide characters, the four selected ones again, and the caret (a second rectangle)
    {
      name: "DLG_UI_OKANDCANCELEDITBOX_HIDE",
      covers: 40_000,
      classes: { CKTDGUIStatic: 2, CKTDGUIButton: 2, CKTDGUIEditBox: 1 },
      flatQuads: 2,
      prepare: (dlg) => {
        const box = dlg.m_ControlsList.find((c): c is CKTDGUIEditBox => c instanceof CKTDGUIEditBox)!;
        expect([box.m_bPasswordEditBox, box.m_HideChar, box.m_bHasFocus]).toEqual([true, 0x2a, true]);
        box.m_Buffer.SetText("Secret99");
        box.m_nSelStart = 2;
        box.m_nCaret = 6;
      },
    },
    // the slots: the quad of each one's current point (the item's picture); none has a mouse over point drawn (the mouse is nowhere), pictures
    // or an edge.  The key setting gives each of its 142 slots an empty string (the font is asked, and draws nothing); the skill slots have no
    // string, so the test gives the eight slots of DLG_GAME_SKILL_SLOT_NEW one (a number at the bottom right of the picture, font 0)
    { name: "DLG_UI_KEY_SETTING", covers: 300_000, classes: { CKTDGUISlot: 142, CKTDGUIButton: 21, CKTDGUIStatic: 2 } },
    { name: "DLG_RIDING_SKILL_SLOT", covers: 8_000, classes: { CKTDGUISlot: 4, CKTDGUIStatic: 5 } },
    {
      name: "DLG_GAME_SKILL_SLOT_NEW",
      covers: 15_000,
      classes: { CKTDGUISlot: 8, CKTDGUIStatic: 14, CKTDGUIButton: 1 },
      prepare: (dlg) => {
        dlg.m_ControlsList.filter((c): c is CKTDGUISlot => c instanceof CKTDGUISlot).forEach((slot, i) => {
          const corner = slot.m_pNormalPoint!.leftTopPoint;
          const text = new UIStringData();
          text.fontIndex = 0;
          text.msg = String(i + 1);
          text.pos.set(corner.x + 32, corner.y + 28);
          text.color.set(1, 1, 1, 1);
          text.outlineColor.set(0, 0, 0, 1);
          text.fontStyle = FONT_STYLE.FS_SHELL;
          slot.m_pStringData = text;
        });
      },
    },
  ];
  for (const { name, covers, classes, edgeBars, flatQuads, prepare } of more) {
    test(name, async () => {
      const r = await draw(`${name}.LUA`, `ui-${name}`, prepare);
      const counts: Record<string, number> = {};
      for (const c of r.dlg.m_ControlsList) counts[c.constructor.name] = (counts[c.constructor.name] ?? 0) + 1;
      expect(counts).toMatchObject(classes);
      const shown = expectDrawnLikeDirect3D(name, r, covers);
      expect(shown.edgeBars).toBe(edgeBars ?? 0);
      expect(shown.flatQuads).toBe(flatQuads ?? 0);
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

  // what the dialog manager does after the dialogs: `RenderDragSlot` of the slot that is being dragged, in the same scene
  test("DLG_UI_KEY_SETTING with a key being dragged: the dialog manager's last draw puts it under the mouse", async () => {
    const name = "DLG_UI_KEY_SETTING";
    const first = (dlg: CKTDGUIDialog): CKTDGUISlot => dlg.m_ControlsList.find((c): c is CKTDGUISlot => c instanceof CKTDGUISlot)!;
    const r = await draw(
      `${name}.LUA`,
      `ui-${name}-drag`,
      (dlg, w) => {
        first(dlg).m_eControlState = SCS.ONDRAG;
        first(dlg).m_bHasFocus = true;
        w.mouse.m_XPos = 600;
        w.mouse.m_YPos = 600;
      },
      (dlg) => expect(first(dlg).renderDragSlot()).toBe(0),
    );
    expectDrawnLikeDirect3D(name, r, 300_000);
    expect(r.draws.length).toBe(183); // the 182 quads of the dialog, and the dragged one after them
    // the key is 35 x 35, (92, 180) .. (127, 215); centred on the mouse (600, 600) it covers 582.5 .. 617.5 both ways: cut, moved half a pixel
    const last = r.draws[182]!;
    const f = new Float32Array(last.data.buffer, last.data.byteOffset, 28);
    expect([f[0], f[1], f[7], f[8], f[14], f[15], f[21], f[22]]).toEqual([581.5, 581.5, 616.5, 581.5, 581.5, 616.5, 616.5, 616.5]);
  }, 120_000);
});
