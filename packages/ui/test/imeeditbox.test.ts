import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringTable } from "@els/assets";
import { CKTDGUIDialog, CKTDGUIIMEEditBox, CKTDGUIUniBuffer, UCT, UIFonts, UKFont, UIWorld } from "../src/index.ts";
import { indexAllKoms, KomMassFileSource } from "../../../tools/komindex.ts";
import { setup } from "./harness.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const t = test.skipIf(!haveData);

const f = Math.fround;
const rgba = (c: { r: number; g: number; b: number; a: number }) => [c.r, c.g, c.b, c.a];

describe("CKTDGUIUniBuffer (32963A70)", () => {
  const log = { entries: [] as [number, string][], push(id: number, text = "") { this.entries.push([id, text]); } };

  test("the first allocation: a request for n characters gets 2n; no request gets 256; -1 doubles; never more than 0xFFFF", () => {
    const b = new CKTDGUIUniBuffer(log, 1);
    expect([b.m_nBufferSize, b.m_pwszBuffer]).toEqual([2, ""]);
    expect(b.SetBufferSize(-1)).toBe(true);
    expect(b.m_nBufferSize).toBe(4);
    expect(b.SetBufferSize(100)).toBe(true); // more than twice: twice the request
    expect(b.m_nBufferSize).toBe(200);
    expect(b.SetBufferSize(3)).toBe(true); // less than twice the size: twice the size
    expect(b.m_nBufferSize).toBe(400);
    expect(new CKTDGUIUniBuffer(log, 0).m_pwszBuffer).toBeNull();
    const none = new CKTDGUIUniBuffer(log, 0);
    none.SetBufferSize(-1);
    expect(none.m_nBufferSize).toBe(256);
    const big = new CKTDGUIUniBuffer(log, 40000);
    expect(big.m_nBufferSize).toBe(0xffff);
    expect(big.SetBufferSize(-1)).toBe(false); // already at the maximum: error log 0x27
    expect(log.entries).toEqual([[0x27, ""]]);
  });

  test("the defaults of the limits and modes", () => {
    const b = new CKTDGUIUniBuffer(log, 1);
    expect([b.m_nLengthLimit, b.m_WidthLimit, b.m_LineLimit, b.m_ByteLimit, b.m_bByteLimit]).toEqual([0xffff, 99999, 99999, 0, false]);
    expect([b.m_bOneCharMode, b.m_bOnlyNumMode, b.m_bOnlyNumAndEnglishMode, b.m_bCheckEnglishBigAndSmall, b.m_bBigEnglish, b.m_bAutoChangeBigEnglish]).toEqual([false, false, false, false, true, false]);
    expect([b.m_bUseHideChar, b.m_cHideChar, b.m_pFontNode, b.m_bAnalyseRequired]).toEqual([false, 0, null, true]);
  });

  test("SetText: grows the buffer as needed; a text over the length limit (or two characters in one-char mode) is refused and leaves the text as it was", () => {
    const b = new CKTDGUIUniBuffer(log, 1);
    expect(b.SetText("hello")).toBe(true);
    expect([b.m_pwszBuffer, b.m_nBufferSize, b.GetTextSize()]).toEqual(["hello", 8, 5]);
    b.m_nLengthLimit = 3;
    expect(b.SetText("four")).toBe(false);
    expect(b.m_pwszBuffer).toBe("hello");
    expect(b.SetText("abc")).toBe(true);
    b.m_bOneCharMode = true;
    expect(b.SetText("ab")).toBe(false);
    expect(b.SetText("a")).toBe(true);
    expect(b.m_pwszBuffer).toBe("a");
    b.m_nLengthLimit = 0xffff;
    b.m_bOneCharMode = false;
    expect(b.SetText("x".repeat(0xfffe))).toBe(false); // wcslen + 1 must stay under 0xFFFF
    expect(b.SetText("ab\0cd")).toBe(true); // wcslen: up to the NUL
    expect(b.m_pwszBuffer).toBe("ab");
  });

  test("Clear needs an allocated buffer; CPtoX and XtoCP without a font answer 0, with a font they need the font manager", () => {
    const b = new CKTDGUIUniBuffer(log, 0);
    expect(() => b.Clear()).toThrow(/no buffer/);
    expect(b.CPtoX(3, false)).toBe(0);
    expect(b.XtoCP(100)).toEqual({ cp: 0, trail: 0 });
    b.m_pFontNode = new UKFont(1);
    expect(() => b.CPtoX(3, false)).toThrow(/not ported/);
    expect(() => b.XtoCP(1)).toThrow(/not ported/);
  });
});

describe("UIFonts (the dialog manager's font lookup)", () => {
  test("a font index is mapped to a UK font that exists; an unmapped index has no font", () => {
    const fonts = new UIFonts();
    const f3 = fonts.addUKFont(3);
    fonts.mapUIFontToUKFont(1, 3);
    fonts.mapUIFontToUKFont(2, 99); // no such UK font: not mapped
    expect(fonts.getUKFont(1)).toBe(f3);
    expect(fonts.getUKFont(2)).toBeNull();
    expect(fonts.m_mapFontToUKFont.has(2)).toBe(false);
    expect(fonts.getUKFont(7)).toBeNull();
  });

  test("a mapped id whose font is gone reads as null and operator[] leaves an entry for it", () => {
    const fonts = new UIFonts();
    fonts.addUKFont(5);
    fonts.mapUIFontToUKFont(1, 5);
    fonts.m_mapUKFontList.delete(5);
    expect(fonts.getUKFont(1)).toBeNull();
    expect(fonts.m_mapUKFontList.has(5)).toBe(true);
    expect(fonts.m_mapUKFontList.get(5)).toBeNull();
  });
});

describe("CKTDGUIIMEEditBox", () => {
  test("the constructor's defaults (32935240)", () => {
    const { w } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    expect(e.m_ControlType).toBe(UCT.IME_EDITBOX);
    expect([e.m_CustomMsgEditBoxChange, e.m_CustomMsgEditBoxEnter, e.m_CustomMsgEditBoxFocusOut, e.m_CustomMsgEditBoxFocusIn]).toEqual([-1, -1, -1, -1]);
    expect([e.m_TextColor, e.m_SelTextColor, e.m_SelBkColor, e.m_CaretColor, e.m_DefTextAlign]).toEqual([0xff000000, 0xffffffff, 0xff28325c, 0xff000000, 0xffffffff]);
    expect([e.m_ReadingColor, e.m_CandidateColor, e.m_CompColor, e.m_CompCaretColor, e.m_CompTargetNonColor]).toEqual([0xbcffffff, 0xffc8c8c8, 0xffc8c8ff, 0xffffffff, 0xffffff00]);
    expect(rgba(e.m_NowFontColor)).toEqual([0, 0, 0, 1]);
    expect(rgba(e.m_OutlineColor)).toEqual([1, 1, 1, 1]);
    expect([e.m_bOutlineCheck, e.m_bBGCheck, e.m_bCaretOn, e.m_bInsertMode, e.m_bMouseDrag, e.m_bEnablePaste, e.m_bIsForceSendCustomMsgChange]).toEqual([false, false, true, true, false, true, false]);
    expect([e.m_nCaret, e.m_nSelStart, e.m_nFirstVisible, e.m_GroupID, e.m_GroupSequence]).toEqual([0, 0, 0, -1, -1]);
    expect([e.m_pFont, e.m_pNormalTex, e.m_pDisableTex, e.m_pNormalPoint, e.m_pDisablePoint, e.m_pTextPoint]).toEqual([null, null, null, null, null, null]);
    expect(e.m_Vertex.length).toBe(4);
    expect(e.m_rcText).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    // the buffer: made with one character (room for two), cleared
    expect([e.m_Buffer.m_nBufferSize, e.m_Buffer.m_pwszBuffer]).toEqual([2, ""]);
    // the caret blinks at 530 ms * 0.0005 (single precision), the timer starts where the application's clock is
    expect(e.m_dfBlink).toBe(f(f(530) * f(0.0005)));
    expect(e.m_dfLastBlink).toBe(0);
    // the statics: the first box initialises the IME (the composition string is given room for 256 characters: twice that is allocated) and creates the device check
    expect([w.ime.s_bCreateDeviceCheck, w.ime.s_bHideCaret, w.ime.s_bEnableImeSystem, w.ime.s_CompString.m_nBufferSize]).toEqual([true, false, true, 512]);
    // UI_Control_Sound.lua is not in this world: error log 0x87 then 0x48
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x87, text: "UI_CONTROL_SOUND.LUA" }, { id: 0x48, text: "UI_Control_Sound.lua" }]);
    expect(e.m_pSndKeyDown).toBeUndefined();
  });

  test("the blink time and the clock come from the system", () => {
    const { w } = setup();
    w.devices.caretBlinkTime = 1000;
    w.devices.absoluteTime = () => 12.5;
    const e = new CKTDGUIIMEEditBox(w);
    expect(e.m_dfBlink).toBe(f(f(1000) * f(0.0005)));
    expect(e.m_dfLastBlink).toBe(12.5);
  });

  test("the colour setters: each channel is (float)(c * 255) cut to an integer, packed A R G B; the caret colour is also the composition caret's", () => {
    const { w, wrap, m } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    const ud = wrap(e, "CKTDGUIIMEEditBox");
    m(ud, "SetTextColor", 1, 0.5, 0.25, 1);
    expect(e.m_TextColor).toBe(0xffff7f3f); // 127.5 -> 127, 63.75 -> 63: truncated, not rounded
    m(ud, "SetSelectedTextColor", 0, 0, 0, 0.5);
    expect(e.m_SelTextColor).toBe(0x7f000000);
    m(ud, "SetSelectedBackColor", 0.7, 0, 0, 1);
    expect(e.m_SelBkColor).toBe(0xffb20000); // 0.7 * 255 = 178.5
    m(ud, "SetCaretColor", 0, 1, 0, 1);
    expect([e.m_CaretColor, e.m_CompCaretColor]).toEqual([0xff00ff00, 0xff00ff00]);
    // nothing clamps: an alpha of 2 loses its high bit in the 32-bit store, a negative red is taken modulo 256
    m(ud, "SetTextColor", 0, 0, 0, 2);
    expect(e.m_TextColor).toBe(0xfe000000);
    m(ud, "SetTextColor", -1, 0, 0, 1);
    expect(e.m_TextColor).toBe(0xff010000);
  });

  test("SetOutlineColor: the bytes of the colour times 1/255 (single precision); switches the outline on", () => {
    const { w, wrap, m } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    const ud = wrap(e, "CKTDGUIIMEEditBox");
    m(ud, "SetOutlineColor", 1, 0.5, 0.25, 0.75);
    expect(e.m_bOutlineCheck).toBe(true);
    const k = f(0.003921569);
    expect(rgba(e.m_OutlineColor)).toEqual([f(255 * k), f(127 * k), f(63 * k), f(191 * k)]); // 0.75 * 255 = 191.25
    expect(e.m_OutlineColor.r).toBeCloseTo(1, 6);
    expect(e.m_OutlineColor.g).toBeCloseTo(127 / 255, 6);
    // the alpha is not cut to a byte: 2 -> 510 / 255
    m(ud, "SetOutlineColor", 0, 0, 0, 2);
    expect(e.m_OutlineColor.a).toBeCloseTo(2, 5);
  });

  test("SetText: the text goes to the buffer, the caret behind it; a limit cuts the text first", () => {
    const { w, wrap, m } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    const ud = wrap(e, "CKTDGUIIMEEditBox");
    m(ud, "SetText", "hello");
    expect([e.m_Buffer.m_pwszBuffer, e.m_nCaret, e.m_nSelStart, e.m_nFirstVisible]).toEqual(["hello", 5, 5, 0]);
    m(ud, "SetLengthLimit", 3);
    m(ud, "SetText", "abcdef");
    expect(e.m_Buffer.m_pwszBuffer).toBe("abc");
    expect(e.m_nCaret).toBe(3);
    m(ud, "SetLengthLimit", 65535);
    m(ud, "SetByteLimit", 4); // a byte limit replaces the length limit (here it is still a number of characters)
    expect(e.m_Buffer.m_bByteLimit).toBe(true);
    m(ud, "SetText", "abcdefgh");
    expect(e.m_Buffer.m_pwszBuffer).toBe("abcd");
    e.setText("xy", true); // selected: the selection starts at 0, the caret is at the end
    expect([e.m_nSelStart, e.m_nCaret]).toEqual([0, 2]);
    m(ud, "SetText", undefined); // a NULL char*: the empty text
    expect([e.m_Buffer.m_pwszBuffer, e.m_nCaret]).toEqual(["", 0]);
  });

  test("SetText that the buffer refuses (one-character mode) keeps the old text, and the caret is still placed behind it", () => {
    const { w, wrap, m } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    const ud = wrap(e, "CKTDGUIIMEEditBox");
    m(ud, "SetText", "a");
    m(ud, "SetOneCharMode", true);
    m(ud, "SetText", "bc");
    expect(e.m_Buffer.m_pwszBuffer).toBe("a");
    expect(e.m_nCaret).toBe(1);
  });

  test("PlaceCaret without a font: the first visible character only moves when the text rectangle has a negative width", () => {
    const { w, wrap, m, point, vec2 } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    const ud = wrap(e, "CKTDGUIIMEEditBox");
    m(ud, "SetTextPoint", point(10, 20, { USE_TEXTURE_SIZE: 0, RIGHT_BOTTOM: vec2(110, 40) }));
    m(ud, "SetText", "hello");
    expect(e.m_nFirstVisible).toBe(0);
    m(ud, "SetTextPoint", point(100, 20, { USE_TEXTURE_SIZE: 0, RIGHT_BOTTOM: vec2(10, 40) })); // right < left
    m(ud, "SetText", "hello");
    expect(e.m_nFirstVisible).toBe(1); // the exe's arithmetic with every x = 0
  });

  test("SetTextPoint: the text rectangle is the left-top and right-bottom corners cut to whole pixels", () => {
    const { w, wrap, m, point, vec2 } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    const ud = wrap(e, "CKTDGUIIMEEditBox");
    m(ud, "SetTextPoint", point(116.9, 147.5, { RIGHT_BOTTOM: vec2(250.9, 165.1), USE_TEXTURE_SIZE: 0 }));
    expect(e.m_rcText).toEqual({ left: 116, top: 147, right: 250, bottom: 165 });
    expect(e.m_pTextPoint).not.toBeNull();
    expect(e.m_bBGCheck).toBe(false); // the text point is not a background
  });

  test("SetNormalTex / SetNormalPoint: the point of a box with a texture is the texture's size, in either order", () => {
    const { w, wrap, m, point } = setup();
    const a = new CKTDGUIIMEEditBox(w);
    const ua = wrap(a, "CKTDGUIIMEEditBox");
    m(ua, "SetNormalTex", "BACK.TGA", "BACK");
    expect(a.m_bBGCheck).toBe(true);
    expect([a.m_pNormalTex?.texName, a.m_pNormalTex?.keyName]).toEqual(["BACK.TGA", "BACK"]);
    m(ua, "SetNormalPoint", point(10, 20));
    expect(a.m_pNormalPoint!.pUITextureData).toBe(a.m_pNormalTex);
    expect([a.m_pNormalPoint!.rightBottomPoint.x, a.m_pNormalPoint!.rightBottomPoint.y]).toEqual([74, 52]);
    // the point first, the texture after: the texture is handed to the point (its size is not recomputed)
    const b = new CKTDGUIIMEEditBox(w);
    const ub = wrap(b, "CKTDGUIIMEEditBox");
    m(ub, "SetNormalPoint", point(10, 20));
    expect(b.m_pNormalPoint!.pUITextureData).toBeNull();
    expect([b.m_pNormalPoint!.rightBottomPoint.x, b.m_pNormalPoint!.rightBottomPoint.y]).toEqual([0, 0]);
    m(ub, "SetNormalTex", "BACK.TGA", "BACK");
    expect(b.m_pNormalPoint!.pUITextureData).toBe(b.m_pNormalTex);
    // the disabled ones work the same way
    m(ub, "SetDisableTex", "OFF.TGA", "OFF");
    m(ub, "SetDisablePoint", point(1, 2));
    expect(b.m_pDisablePoint!.pUITextureData).toBe(b.m_pDisableTex);
    expect([b.m_pDisablePoint!.rightBottomPoint.x, b.m_pDisablePoint!.rightBottomPoint.y]).toEqual([65, 34]);
    // a second texture replaces the first, also in the point
    const first = b.m_pNormalTex;
    m(ub, "SetNormalTex", "BACK2.TGA", "B2");
    expect(b.m_pNormalTex).not.toBe(first);
    expect(b.m_pNormalPoint!.pUITextureData).toBe(b.m_pNormalTex);
  });

  test("SetFont looks the index up in the dialog manager's maps", () => {
    const { w, wrap, m } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    const ud = wrap(e, "CKTDGUIIMEEditBox");
    m(ud, "SetFont", 4);
    expect(e.m_pFont).toBeNull();
    const font = w.fonts.addUKFont(2);
    w.fonts.mapUIFontToUKFont(4, 2);
    m(ud, "SetFont", 4);
    expect(e.m_pFont).toBe(font);
    m(ud, "SetFont", 5);
    expect(e.m_pFont).toBeNull();
  });

  test("the limits and modes go to the buffer; the custom messages, group and flags to the box", () => {
    const { w, wrap, m } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    const ud = wrap(e, "CKTDGUIIMEEditBox");
    m(ud, "SetWidthLimit", 120);
    m(ud, "SetLineLimit", 3);
    m(ud, "SetOnlyNumMode", true);
    m(ud, "SetOneCharMode", true);
    m(ud, "SetOnlyNumAndEnglishMode", true, false, true);
    m(ud, "SetAutoChangeBigEnglish", true);
    const b = e.m_Buffer;
    expect([b.m_WidthLimit, b.m_LineLimit, b.m_bOnlyNumMode, b.m_bOneCharMode, b.m_bOnlyNumAndEnglishMode, b.m_bCheckEnglishBigAndSmall, b.m_bBigEnglish, b.m_bAutoChangeBigEnglish])
      .toEqual([120, 3, true, true, true, false, true, true]);
    m(ud, "SetOnlyNumAndEnglishMode", false, true, false);
    expect([b.m_bOnlyNumAndEnglishMode, b.m_bCheckEnglishBigAndSmall, b.m_bBigEnglish]).toEqual([false, true, false]);
    m(ud, "SetCustomMsgChange", 1);
    m(ud, "SetCustomMsgEnter", 2);
    m(ud, "SetCustomMsgFocusOut", 3);
    m(ud, "SetCustomMsgFocusIn", 4);
    expect([e.m_CustomMsgEditBoxChange, e.m_CustomMsgEditBoxEnter, e.m_CustomMsgEditBoxFocusOut, e.m_CustomMsgEditBoxFocusIn]).toEqual([1, 2, 3, 4]);
    m(ud, "SetMultiLineOption", 7, 2);
    expect([e.m_GroupID, e.m_GroupSequence]).toEqual([7, 2]);
    m(ud, "SetForceSendCustomMsgChange", true);
    m(ud, "SetEnablePaste", false);
    expect([e.m_bIsForceSendCustomMsgChange, e.m_bEnablePaste]).toEqual([true, false]);
    m(ud, "SetDefTextAlign", 5);
    expect(e.m_DefTextAlign).toBe(5);
  });

  test("Dialog.CreateIMEEditBox makes a box", () => {
    const { w, wrap, m } = setup();
    const d = new CKTDGUIDialog(w);
    const [e] = m(wrap(d, "CKTDGUIDialog"), "CreateIMEEditBox");
    expect((e as { data: unknown }).data).toBeInstanceOf(CKTDGUIIMEEditBox);
  });
});

// ---- a real dialog -------------------------------------------------------------------------------------------------------------

let source: KomMassFileSource;
let strings: StringTable;
beforeAll(async () => {
  if (!haveData) return;
  source = new KomMassFileSource(await indexAllKoms());
  strings = StringTable.fromEss(new Uint8Array(readFileSync(join(dataDir, "general.ess"))));
}, 60_000);

describe("DLG_CHANGE_NICKNAME.LUA (an IME edit box for the new nickname)", () => {
  t("runs in strict mode and sets the box up as the script says", async () => {
    const { w, dlg } = await source.settle(() => {
      const world = new UIWorld({ source, strings, notPorted: "throw" });
      world.loadEnums();
      return { w: world, dlg: world.openDialog("DLG_CHANGE_NICKNAME.LUA") };
    });
    expect(dlg.m_bSuccessInitOpenScript).toBe(true);
    expect(w.devices.massFiles.log.entries).toEqual([]);
    const box = dlg.m_ControlsMap.get("IME_NewNick") as CKTDGUIIMEEditBox;
    expect(box).toBeInstanceOf(CKTDGUIIMEEditBox);
    expect(box.m_rcText).toEqual({ left: 116, top: 147, right: 250, bottom: 165 }); // SetTextPoint {LEFT_TOP 116,147  RIGHT_BOTTOM 250,165}
    expect([box.m_TextColor, box.m_SelTextColor, box.m_SelBkColor, box.m_CaretColor]).toEqual([0xff000000, 0xff000000, 0xffb20000, 0xffffffff]);
    expect([box.m_Buffer.m_bByteLimit, box.m_Buffer.m_ByteLimit]).toEqual([true, 12]);
    expect(box.m_CustomMsgEditBoxEnter).toBe(11); // STATE_SERVER_SELECT_UI_CUSTOM_MSG.SUSUCM_RENAME_OK
    expect(box.m_pFont).toBeNull(); // no font manager: the index maps to nothing
    expect(box.m_pTextPoint).not.toBeNull();
    expect(box.m_pNormalPoint).toBeNull();
  });
});
