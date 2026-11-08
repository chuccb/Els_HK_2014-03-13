/**
 * `CKTDGUIIMEEditBox` (the Lua class `CKTDGUIIMEEditBox`, a `CKTDGUIControl`): the single- and multi-line text box with an input method
 * editor (DXUT's `CDXUTIMEEditBox` with the game's limits).  Constructor 32935240, and the Lua setters: SetNormalTex_LUA 32935020,
 * SetDisableTex_LUA 32934BA0, SetNormalPoint_LUA 32934F70, SetDisablePoint_LUA 32934AF0, SetTextPoint_LUA 3293ADE0, SetFont_LUA 32934D40,
 * SetText_LUA 3293AE40 (-> SetText 3293ABF0 -> PlaceCaret 32939B50), the four SetCustomMsg* 328CD0E0 / 328CD140 / 328CD160 / 328CD150,
 * the colour setters 328CE2A0 / 328CDF20 / 328CDE20 / 328CCF90 / 328CD9F0, SetMultiLineOption_LUA 3293AB30, and the one-line setters that
 * write the buffer's limits and modes (328CD200, 328CCEF0, 328CE420, 328CD880, 328CD9A0, 328CD9E0, 328CD9B0, 328CCE40) or the box's
 * (328CD2F0, 328CD480, 328CD7B0).
 *
 * Drawing: `OnFrameRender` 32939580 with `DrawTextW` 32936930, `CalcTextRect` 32936140, `DrawRect` 329364E0 (not the plain edit box's: the
 * rectangle is moved by the text's alignment offset and its width is not scaled), and the two windows of the IME, `RenderComposition`
 * 3293A2F0 (the string being composed) and `RenderCandidateReadingWindow` 32939C50 (the candidates, or the reading).
 *
 * Not ported: what the box does while the game runs (`MsgProc`, the keyboard / mouse / IME handling): that needs the window system and the
 * IME.  The constructor's calls into `imm32.dll` are answered as a window without an IME would, and so is `GetImeId`.
 */
import { D3DTOP, D3DTSS } from "@els/d3d9";
import { Color } from "@els/host";
import type { CKTDGUIIMEEditBox_Methods } from "@els/host";
import { CKTDGUIControl, UCT } from "./control.ts";
import type { UIContext, UIPointData, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import type { UKFont } from "./font.ts";
import { byte, channel, d3dColor, ONE_OVER_255, packArgb } from "./d3dcolor.ts";
import { wcslen } from "./freetypefont.ts";
import { ftoi, intersectRect, newRect, offsetRect, setRect } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { VertexUI4 } from "./render.ts";
import { CKTDGUIUniBuffer } from "./unibuffer.ts";
import type { UniBufferLog } from "./unibuffer.ts";

const f = Math.fround;

/**
 * `CKTDGUIIMEEditBox::CCandList`: what the IME tells about the candidates (up to ten of them, `awszCandidate[10][256]`), the same as one line
 * (`HoriCand`, a buffer the static initialiser makes with `CKTDGUIUniBuffer(1)`), which of them is selected, and where their window was drawn.
 */
export class CandList {
  readonly awszCandidate: string[] = Array.from({ length: 10 }, () => "");
  readonly HoriCand: CKTDGUIUniBuffer;
  nFirstSelected = 0;
  nHoriSelectedLen = 0;
  dwCount = 0;
  dwSelection = 0;
  dwPageSize = 0;
  nReadingError = 0;
  bShowWindow = false;
  /** the rectangle `RenderCandidateReadingWindow` drew the candidate window in */
  readonly rcCandidate: Rect = newRect();

  constructor(log: UniBufferLog) {
    this.HoriCand = new CKTDGUIUniBuffer(log, 1);
  }
}

/**
 * The statics of `CKTDGUIIMEEditBox` that every box shares: `s_bCreateDeviceCheck`, `s_hImcDef`, `s_bHideCaret`, `s_bEnableImeSystem`
 * and `s_CompString` (the buffer of the composition string, made with no storage and given 256 characters by `Initialize`, 329384B0,
 * the first time a box is built: the part of it that loads `imm32.dll` is not modelled), and what the two windows of the IME draw from: the
 * keyboard layout `s_hklCurrent` (`GetKeyboardLayout`, which `CheckToggleState` 329361B0 reads: 0, as the static is, until an input event of a
 * window brings one), the attributes of the composition string (`s_abCompStringAttr`: 1 is converted and 3 is not converted, the two
 * kinds of text the target clause is drawn for), its caret (`s_nCompCaret`) and the first character of the target clause
 * (`s_nFirstTargetConv`, which `RenderComposition` finds), where `RenderComposition` put the string (`s_ptCompString`: the candidate
 * window goes next to it), the reading string, whether the candidates and the reading are vertical, and the candidate list `s_CandList`.
 */
export class ImeSystem {
  s_bCreateDeviceCheck = false;
  /** `ImmGetContext(hwnd)` of the first box: the default input context (no window, no context: 0) */
  s_hImcDef = 0;
  s_bHideCaret = false;
  s_bEnableImeSystem = false;
  s_bInitialised = false;
  readonly s_CompString: CKTDGUIUniBuffer;
  /** `HKL`: the low word is the language (`0x0404` is Chinese, Taiwan), the low ten bits of it the primary language (4 Chinese, 0x11 Japanese, 0x12 Korean) */
  s_hklCurrent = 0;
  s_bVerticalCand = false;
  s_bShowReadingWindow = false;
  s_bHorizontalReading = false;
  s_nCompCaret = 0;
  s_nFirstTargetConv = 0;
  readonly s_ptCompString = { x: 0, y: 0 };
  readonly s_abCompStringAttr = new Uint8Array(256);
  /** `s_wszReadingString[32]` */
  s_wszReadingString = "";
  readonly s_CandList: CandList;
  /** the cache of `GetImeId`: the keyboard layout it was asked for last, and the two ids (`hklPrev`, `dwID[2]`) */
  private hklPrev = 0;
  private readonly dwID: [number, number] = [0, 0];

  constructor(log: UniBufferLog) {
    this.s_CompString = new CKTDGUIUniBuffer(log, 0); // 328776C0
    this.s_CandList = new CandList(log);
  }

  /** `CKTDGUIIMEEditBox::Initialize()` (329384B0) */
  initialize(): void {
    if (this.s_bInitialised) return;
    this.s_CompString.SetBufferSize(256);
    this.s_bInitialised = true;
  }

  /**
   * `GetImeId(uIndex)` (32936EA0): the id of the IME of the keyboard layout (index 0: the layout's language and the IME's version, 1: its
   * revision), cached for the layout it was last asked for; 0 for an index of 2 or more.  The ids come from the version resource of the
   * IME's file, which only the three Chinese phonetic / Chang Jie / quick layouts have (`ImmGetIMEFileNameA`): a window without an IME has
   * none of them, so every layout the cache is made for has the ids 0.
   */
  getImeId(uIndex: number): number {
    if ((uIndex >>> 0) >= 2) return 0;
    if (this.hklPrev !== this.s_hklCurrent) {
      this.hklPrev = this.s_hklCurrent;
      this.dwID[1] = 0;
      this.dwID[0] = 0;
    }
    return this.dwID[uIndex]!;
  }
}


export class CKTDGUIIMEEditBox extends CKTDGUIControl implements Partial<CKTDGUIIMEEditBox_Methods> {
  m_pFont: UKFont | null = null;
  readonly m_NowFontColor = new Color(0, 0, 0, 1);
  readonly m_OutlineColor = new Color(1, 1, 1, 1);
  m_bOutlineCheck = false;
  m_bBGCheck = false;
  m_pNormalTex: UITextureData | null = null;
  m_pDisableTex: UITextureData | null = null;
  m_pNormalPoint: UIPointData | null = null;
  m_pDisablePoint: UIPointData | null = null;
  m_pTextPoint: UIPointData | null = null;
  m_CustomMsgEditBoxChange = -1;
  m_CustomMsgEditBoxEnter = -1;
  m_CustomMsgEditBoxFocusOut = -1;
  m_CustomMsgEditBoxFocusIn = -1;
  m_bIsForceSendCustomMsgChange = false;
  // the colours of the IME's own windows (DXUT's defaults, ARGB)
  m_ReadingColor = 0xbcffffff;
  m_ReadingWinColor = 0x80000000;
  m_ReadingSelColor = 0xffff0000;
  m_ReadingSelBkColor = 0x80505050;
  m_CandidateColor = 0xffc8c8c8;
  m_CandidateWinColor = 0x80000000;
  m_CandidateSelColor = 0xffffffff;
  m_CandidateSelBkColor = 0x809e9e9e;
  m_CompColor = 0xffc8c8ff;
  m_CompWinColor = 0xc6000000;
  m_CompCaretColor = 0xffffffff;
  m_CompTargetColor = 0xffffffff;
  m_CompTargetBkColor = 0xff969696;
  m_CompTargetNonColor = 0xffffff00;
  m_CompTargetNonBkColor = 0xff969696;
  m_nIndicatorWidth = 0;
  readonly m_rcIndicator: Rect = newRect();
  readonly m_Buffer: CKTDGUIUniBuffer;
  readonly m_rcText: Rect = newRect();
  /** seconds between the blinks of the caret: the system's caret blink time times 0.0005 (half of it, in seconds) */
  m_dfBlink: number;
  m_dfLastBlink: number;
  m_bCaretOn = true;
  m_nCaret = 0;
  m_bInsertMode = true;
  m_nSelStart = 0;
  m_nFirstVisible = 0;
  m_TextColor = 0xff000000;
  m_SelTextColor = 0xffffffff;
  m_SelBkColor = 0xff28325c;
  m_CaretColor = 0xff000000;
  m_DefTextAlign = 0xffffffff;
  readonly m_ptTextAlignOffset = { x: 0, y: 0 };
  m_bMouseDrag = false;
  /** `m_Vertex[4]`: the quad of the background */
  readonly m_Vertex = new VertexUI4();
  m_pSndKeyDown: DeviceSound | undefined;
  m_GroupID = -1;
  m_GroupSequence = -1;
  m_bEnablePaste = true;

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_Buffer = new CKTDGUIUniBuffer(ctx.devices.massFiles.log, 1);
    const ime = ctx.ime;
    ime.initialize();
    if (!ime.s_bCreateDeviceCheck) {
      ime.s_hImcDef = 0; // ImmGetContext(DXUTGetHWND()) then ImmReleaseContext
      ime.s_bCreateDeviceCheck = true;
    }
    this.m_ControlType = UCT.IME_EDITBOX;
    this.m_dfBlink = f(f(ctx.devices.caretBlinkTime) * f(0.0005));
    this.m_dfLastBlink = ctx.devices.absoluteTime();
    ime.s_bHideCaret = false;
    ime.s_bEnableImeSystem = true;
    [this.m_pSndKeyDown] = this.openControlSounds(["EditBox_KeyDown"]);
    this.m_bEnablePaste = true;
    this.m_Buffer.Clear();
  }

  /**
   * `OnFrameMove` (32939380): a shown IME edit box runs the control's and, with a background (`m_bBGCheck`), makes its normal (or, disabled, its
   * disabled) point the end point; its current point is that point (or, without a background, its text point).  The text rectangle is the text point's
   * left-top and right-bottom corners, cut to ints, moved by the box's offset.  `m_ptTextAlignOffset` is centred (`m_DefTextAlign` with bit 0)
   * on the text that is visible when it fits in the rectangle: `(int)(width of the point / 2 - visible text width / 2)`, the text measured by
   * `CKTDGUIUniBuffer::CPtoX` with the font the buffer has (the box gives it its font when it draws: 0 before the first frame).  Otherwise
   * the offset is 0.
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!this.m_bShow) return 0;
    super.onFrameMove(fTime, fElapsedTime);
    this.m_fElapsedTime = Math.fround(fElapsedTime);
    let point: UIPointData | null;
    if (this.m_bBGCheck) {
      point = this.m_bEnable ? this.m_pNormalPoint : this.m_pDisablePoint;
      if (!point) throw new Error("CKTDGUIIMEEditBox::OnFrameMove: the box has a background but no point for its state; the exe dereferences null");
      this.m_EndPoint.assign(point);
    } else {
      point = this.m_pTextPoint;
    }
    const text = this.m_pTextPoint;
    if (!point || !text) throw new Error("CKTDGUIIMEEditBox::OnFrameMove: the box has no text point (SetTextPoint); the exe dereferences null");
    this.m_NowPoint.assign(point);
    const x = ftoi(this.m_OffsetPos.x), y = ftoi(this.m_OffsetPos.y);
    const rc = this.m_rcText;
    rc.left = (x + ftoi(text.leftTopPoint.x)) | 0;
    rc.top = (y + ftoi(text.leftTopPoint.y)) | 0;
    rc.right = (x + ftoi(text.rightBottomPoint.x)) | 0;
    rc.bottom = (y + ftoi(text.rightBottomPoint.y)) | 0;
    let offset = 0;
    const align = this.m_DefTextAlign;
    if (align !== 0xffffffff && (align & 1) !== 0) {
      const b = this.m_Buffer;
      const whole = b.CPtoX(b.GetTextSize(), false);
      if (!(whole > ((rc.right - rc.left) | 0))) {
        const end = b.CPtoX(b.GetTextSize(), false);
        const first = b.CPtoX(this.m_nFirstVisible, false);
        const n = this.m_NowPoint;
        offset = ftoi(Math.fround(Math.fround(Math.fround(n.rightTopPoint.x - n.leftTopPoint.x) * 0.5) - Math.fround(Math.fround((end - first) | 0) * 0.5)));
      }
    }
    this.m_ptTextAlignOffset.x = offset;
    this.m_ptTextAlignOffset.y = 0;
    return 0;
  }

  /** the font colour the text is drawn in: each channel is the byte of the packed colour times 1/255 (as a float) */
  private setFontColor(packed: number): void {
    const c = this.m_NowFontColor;
    c.r = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);
    c.g = f(f((packed >>> 8) & 0xff) * ONE_OVER_255);
    c.b = f(f(packed & 0xff) * ONE_OVER_255);
    c.a = f(f((packed >>> 24) & 0xff) * ONE_OVER_255);
  }

  /** `m_pFont->m_pUKFont->m_iFontSize / m_pFont->m_pUKFont->m_EnlargeNum + 1`, the height of a line (the exe dereferences a box without a font) */
  private lineHeight(): number {
    const font = this.m_pFont;
    if (!font) throw new Error("CKTDGUIIMEEditBox: the box has no font (SetFont); the exe dereferences null here");
    return font.lineHeight();
  }

  /** `lstrlenW(m_Buffer.m_pwszBuffer)`: the length of the box's own text (`lstrlenW(NULL)` is 0) */
  private textLength(): number {
    const text = this.m_Buffer.m_pwszBuffer;
    return text === null ? 0 : wcslen(text);
  }

  /**
   * The format a text of the box is measured or drawn with when the box has a default alignment: `m_DefTextAlign` while the whole text fits in the
   * text rectangle (`CPtoX` of its end is not beyond the width), else `format`.  `CalcTextRect` 32936140 and `DrawTextW` 32936930 start with
   * it, and so do the loops of the two windows (with `format` 0x404, or 0x400 for a box of a group).
   */
  private alignedFormat(format: number): number {
    if (this.m_DefTextAlign === 0xffffffff) return format;
    const x = this.m_Buffer.CPtoX(this.textLength(), false);
    return x <= ((this.m_rcText.right - this.m_rcText.left) | 0) ? this.m_DefTextAlign : format;
  }

  /**
   * `CalcTextRect(strText, prcDest, nCount, format)` (32936140): the font's, with the box's default alignment (`m_DefTextAlign`, while the whole
   * text of the box fits in the text rectangle) in place of `format`.  A box without a font calls it through a null pointer: that makes the
   * rectangle of a text it measures nothing of (empty, count 0) empty, and is a crash otherwise (an Error here).
   */
  CalcTextRect(strText: string, prcDest: Rect, nCount: number, format: number): number {
    this.fontCalcTextRect(strText, prcDest, nCount, this.alignedFormat(format));
    return 0;
  }

  /**
   * `CUKFont::CalcTextRect(m_pFont, ...)`, which the two windows of the IME call directly.  A box without a font calls it through a null
   * pointer: that makes the rectangle of a text it measures nothing of (empty, count 0) empty, and is a crash otherwise (an Error here).
   */
  private fontCalcTextRect(strText: string, prcDest: Rect, nCount: number, format: number): void {
    const font = this.m_pFont;
    if (font === null) {
      if (wcslen(strText) !== 0 && nCount !== 0) throw new Error("CKTDGUIIMEEditBox: the box has no font (SetFont); the exe calls CalcTextRect through a null pointer");
      prcDest.left = prcDest.top = prcDest.right = prcDest.bottom = 0;
      return;
    }
    font.CalcTextRect(strText, prcDest, nCount, format);
  }

  /**
   * `DrawTextW(strText, prcDest, nCount, format)` (32936930): the font draws the text (`DrawTextFont`, with the box's font colour and the
   * outline when `m_bOutlineCheck`) in the rectangle moved by the dialog's place plus the box's offset, each cut to whole pixels; the box's
   * default alignment (see `alignedFormat`) replaces `format` while the whole text fits.  A box without a font calls `DrawTextFont` through a
   * null pointer: that returns at once for a text it draws nothing of (empty, count 0), and is a crash otherwise.
   */
  DrawTextW(strText: string, prcDest: Rect, nCount: number, format: number): number {
    const aligned = this.alignedFormat(format);
    const dialog = this.m_pDialog;
    if (!dialog) throw new Error("CKTDGUIIMEEditBox::DrawTextW: the box is in no dialog (the exe's handle answers a null object)");
    const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.right, bottom: prcDest.bottom };
    offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)), ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));
    const font = this.m_pFont;
    if (font === null) {
      if (wcslen(strText) === 0 || nCount === 0) return 0;
      throw new Error("CKTDGUIIMEEditBox::DrawTextW: the box has no font (SetFont); the exe calls DrawTextFont through a null pointer");
    }
    font.DrawTextFont(strText, rcScreen, nCount, this.m_NowFontColor, this.m_bOutlineCheck, this.m_OutlineColor, aligned);
    return 0;
  }

  /**
   * `DrawRect(prcDest, color)` (329364E0): a rectangle of one colour, an untextured quad (the stage's colour and alpha operations are pushed as
   * `SELECTARG2` for the draw: the diffuse colour alone; unlike the plain edit box's, nothing sets them to `MODULATE` before they are popped).
   * The rectangle is moved by `m_ptTextAlignOffset` first.  The **corner** is in the pixels of the back buffer, `(int)(float)((float)(scale * (float)side)
   * + (float)(scale * dialog.m_Pos))`, but the **width and the height are in layout pixels**: `(int)(float)(((float)right + pos) - ((float)left + pos))`
   * with no scale in them (a box of 100 pixels is 100 pixels wide at any resolution: a bug that is kept).  The vertices lie half a pixel up and
   * left, `z` 0.5, `rhw` 1, the UVs 0.
   */
  DrawRect(prcDest: Rect, color: number): number {
    const dialog = this.m_pDialog;
    if (!dialog) throw new Error("CKTDGUIIMEEditBox::DrawRect: the box is in no dialog (the exe's handle answers a null object)");
    const render = this.ctx.render;
    const sx = render ? render.resolutionScale.x : 1, sy = render ? render.resolutionScale.y : 1;
    const x = this.m_ptTextAlignOffset.x, y = this.m_ptTextAlignOffset.y;
    const left = (x + prcDest.left) | 0, right = (x + prcDest.right) | 0;
    const top = (y + prcDest.top) | 0, bottom = (y + prcDest.bottom) | 0;
    const posX = dialog.m_Pos.x, posY = dialog.m_Pos.y;
    const width = ftoi(f(f(f(right) + posX) - f(f(left) + posX)));
    const height = ftoi(f(f(f(bottom) + posY) - f(f(top) + posY)));
    const pixelLeft = ftoi(f(f(sx * f(left)) + f(sx * posX)));
    const pixelTop = ftoi(f(f(sy * f(top)) + f(sy * posY)));
    const x0 = f(f(pixelLeft) - 0.5), x1 = f(f((pixelLeft + width) | 0) - 0.5);
    const y0 = f(f(pixelTop) - 0.5), y1 = f(f((height + pixelTop) | 0) - 0.5);
    const quad = new VertexUI4();
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const;
    for (let i = 0; i < 4; i++) {
      quad.setX(i, corners[i]![0]);
      quad.setY(i, corners[i]![1]);
      quad.setZ(i, 0.5);
      quad.setRhw(i, 1);
      quad.setColor(i, color);
      quad.setU(i, 0);
      quad.setV(i, 0);
    }
    const states = render?.states;
    const top0 = states?.stackPointer ?? 0;
    states?.setTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG2);
    states?.setTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG2);
    this.renderVertex(quad, true);
    states?.popTo(top0);
    return 0;
  }

  /**
   * `OnFrameRender` (32939580): a shown box gives its buffer the box's font, places the caret and draws, in this order:
   * - the background (`m_bBGCheck`): the current point's quad;
   * - the selection, when the caret is not at the selection's start: a rectangle of `m_SelBkColor` from the smaller to the larger of the two x
   *   positions, moved by the text rectangle's left minus the x of the first visible character, cut to the text rectangle.  A box of a group
   *   (`m_GroupID` 0 or more: the lines of one text) has a selection one line high, at the line of the caret: from the text rectangle's top plus
   *   the caret's y to that plus the height of a line (it is not moved by the y of the first visible line, as the caret is);
   * - the text from the first visible character on in `m_TextColor`, in the text rectangle moved back by the box's offset (the format is 4: the
   *   text is centred vertically, 0 for a box of a group);
   * - the selected part again in `m_SelTextColor`, in the selection's rectangle moved by the alignment offset minus the box's offset;
   * - the blink: when `m_dfBlink` seconds have gone since `m_dfLastBlink` the caret toggles and the time is taken again;
   * - the caret (a focused box whose caret is on, unless `s_bHideCaret`): a rectangle of `m_CaretColor`, two pixels wide around the x of the
   *   caret (one in the overwrite mode: the trailing edge is the same x), the height of the text rectangle or, in a group, of one line at the
   *   caret's y minus the first visible line's;
   * - the windows of the IME, for the focused box: the composition string (`RenderComposition`) and then the reading or the candidates.
   * The composition string and the candidate line are given the box's font first.
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    const ime = this.ctx.ime;
    const buffer = this.m_Buffer;
    buffer.m_pFontNode = this.m_pFont;
    this.PlaceCaret(this.m_nCaret);
    if (this.m_bBGCheck) {
      this.updateVertex(this.m_Vertex, this.m_NowPoint);
      this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);
    }
    const text = this.m_rcText;
    const grouped = this.m_GroupID >= 0;
    const nXFirst = buffer.CPtoX(this.m_nFirstVisible, false);
    const nCaretX = buffer.CPtoX(this.m_nCaret, false);
    let nCaretY = 0, nYFirst = 0;
    if (grouped) {
      nCaretY = buffer.CPtoY(this.m_nCaret, false);
      nYFirst = buffer.CPtoY(this.m_nFirstVisible, false);
    }
    let nSelStartX = nCaretX;
    if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nSelStart, false);
    const rcSelection = newRect();
    if (this.m_nCaret !== this.m_nSelStart) {
      const left = nCaretX <= nSelStartX ? nCaretX : nSelStartX;
      const right = nCaretX <= nSelStartX ? nSelStartX : nCaretX;
      if (!grouped) setRect(rcSelection, left, text.top, right, text.bottom);
      else setRect(rcSelection, left, (text.top + nCaretY) | 0, right, (nCaretY + text.top + this.lineHeight()) | 0);
      offsetRect(rcSelection, (text.left - nXFirst) | 0, 0);
      intersectRect(rcSelection, text, rcSelection);
      this.DrawRect(rcSelection, this.m_SelBkColor);
    }
    this.setFontColor(this.m_TextColor);
    const typed = buffer.m_pwszBuffer ?? "";
    const ox = ftoi(this.m_OffsetPos.x), oy = ftoi(this.m_OffsetPos.y);
    const rcText: Rect = { left: (text.left - ox) | 0, top: (text.top - oy) | 0, right: (text.right - ox) | 0, bottom: (text.bottom - oy) | 0 };
    this.DrawTextW(typed.slice(this.m_nFirstVisible), rcText, -1, (this.m_GroupID >> 31) & 4);
    const caret = this.m_nCaret, selStart = this.m_nSelStart;
    if (caret !== selStart) {
      const dx = ftoi(f(f(this.m_ptTextAlignOffset.x) - this.m_OffsetPos.x));
      const dy = ftoi(f(f(this.m_ptTextAlignOffset.y) - this.m_OffsetPos.y));
      const rcSelected: Rect = {
        left: (dx + rcSelection.left) | 0, top: (dy + rcSelection.top) | 0, right: (dx + rcSelection.right) | 0, bottom: (dy + rcSelection.bottom) | 0,
      };
      const lower = Math.min(caret, selStart);
      const start = this.m_nFirstVisible <= lower ? lower : this.m_nFirstVisible;
      const end = Math.max(caret, selStart);
      this.setFontColor(this.m_SelTextColor);
      this.DrawTextW(typed.slice(start), rcSelected, (end - start) | 0, grouped ? 0 : 4);
    }
    const devices = this.ctx.devices;
    if (devices.absoluteTime() - this.m_dfLastBlink >= this.m_dfBlink) {
      this.m_bCaretOn = !this.m_bCaretOn;
      this.m_dfLastBlink = devices.absoluteTime();
    }
    if (this.m_bHasFocus && this.m_bCaretOn && !ime.s_bHideCaret) {
      const x = (text.left - nXFirst) | 0;
      const rcCaret: Rect = { left: (x + nCaretX - 1) | 0, top: text.top, right: (x + nCaretX + 1) | 0, bottom: text.bottom };
      if (grouped) {
        rcCaret.top = (nCaretY + text.top - nYFirst) | 0;
        rcCaret.bottom = (nCaretY + text.top + this.lineHeight() - nYFirst) | 0;
      }
      if (!this.m_bInsertMode) rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;
      this.DrawRect(rcCaret, this.m_CaretColor);
    }
    ime.s_CompString.m_pFontNode = this.m_pFont;
    ime.s_CandList.HoriCand.m_pFontNode = this.m_pFont;
    if (this.m_bHasFocus) {
      this.RenderComposition(null, this.m_fElapsedTime);
      if (ime.s_bShowReadingWindow) this.RenderCandidateReadingWindow(null, this.m_fElapsedTime, true);
      else if (ime.s_CandList.bShowWindow) this.RenderCandidateReadingWindow(null, this.m_fElapsedTime, false);
    }
    return 0;
  }

  /**
   * `RenderComposition(pd3dDevice, fElapsedTime)` (3293A2F0): the string the IME is composing (`s_CompString`), drawn at the caret of the box in
   * a window of its own colour; neither argument is used.  The string starts at the x of the box's caret (the text rectangle's left minus the first
   * visible character's x plus the caret's: and in a box of a group at the caret's line); when it ends beyond the right side of the text rectangle it
   * starts again at the left side, one line down.  Then it is drawn in pieces, as many characters as `XtoCP` finds room for in the rest of the
   * line: for each a window (`m_CompWinColor`, but not for a Korean layout while the caret is off) and the text in `m_CompColor`.  The target
   * clause is drawn over it a character at a time: those with the attribute 1 (converted) or 3 (not converted) get a background
   * (`m_CompTargetBkColor` or `m_CompTargetNonBkColor`) and their own text colour, and the first of them is remembered in `s_nFirstTargetConv`
   * (-1 when there is none).  At last the caret of the composition string, in `m_CompCaretColor`, when the box's caret is on: at the character of
   * `s_nCompCaret` (or at the end of the string), and when it is nowhere on the string as the rectangle (0, 0, 0, 0), drawn all the same.
   * The exe's loop of pieces does not end when not one character fits the whole text rectangle; here that is an Error.
   */
  RenderComposition(pd3dDevice: unknown, fElapsedTime: number): void {
    void pd3dDevice;
    void fElapsedTime;
    const ime = this.ctx.ime;
    const comp = ime.s_CompString;
    const buffer = this.m_Buffer;
    const text = this.m_rcText;
    const grouped = this.m_GroupID >= 0;
    const compText = comp.m_pwszBuffer ?? "";
    const nX = buffer.CPtoX(this.m_nCaret, false);
    const nXFirst = buffer.CPtoX(this.m_nFirstVisible, false);
    let nY = 0, nYFirst = 0;
    if (grouped) {
      nY = buffer.CPtoY(this.m_nCaret, false);
      nYFirst = buffer.CPtoY(this.m_nFirstVisible, false);
    }
    const startX = (text.left - nXFirst + nX) | 0;
    const rc: Rect = { left: startX, top: text.top, right: startX, bottom: text.bottom };
    if (grouped) {
      rc.top = (text.top - nYFirst + nY) | 0;
      rc.bottom = (nY + text.top + this.lineHeight() - nYFirst) | 0;
    }
    let rcCaret: Rect = newRect();
    this.fontCalcTextRect(compText, rc, -1, this.alignedFormat(0x404));
    let right = rc.right;
    let wrapped = false;
    if (rc.right > text.right) {
      offsetRect(rc, (text.left - rc.left) | 0, (rc.bottom - rc.top) | 0);
      wrapped = true;
      right = rc.right;
    }
    ime.s_ptCompString.y = rc.top;
    ime.s_ptCompString.x = rc.left;
    const firstLeft = rc.left, firstTop = rc.top, firstBottom = rc.bottom;
    this.setFontColor(this.m_CompColor);
    const ox = ftoi(this.m_OffsetPos.x), oy = ftoi(this.m_OffsetPos.y);
    let nCount = wcslen(compText);
    let at = 0;
    let secondLine = false;
    let rcTemp: Rect = newRect();
    for (;;) {
      const startLeft = rc.left;
      const { cp } = comp.XtoCP((text.right - rc.left) | 0);
      const length = nCount < cp ? nCount : cp;
      this.fontCalcTextRect(compText.slice(at), rc, length, this.alignedFormat(grouped ? 0x400 : 0x404));
      rcTemp = { left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom };
      if (wrapped) setRect(rcTemp, (rc.left + text.right - rc.right) | 0, (2 * rc.top - rc.bottom) | 0, text.right, rc.top);
      if ((ime.s_hklCurrent & 0x3ff) !== 0x12 || this.m_bCaretOn) this.DrawRect(rcTemp, this.m_CompWinColor);
      const target: Rect = { left: (rcTemp.left - ox) | 0, top: (rcTemp.top - oy) | 0, right: (rcTemp.right - ox) | 0, bottom: (rcTemp.bottom - oy) | 0 };
      this.DrawTextW(compText.slice(at), target, length, (this.m_GroupID >> 31) & 4);
      nCount = (nCount - length) | 0;
      at += length;
      if (nCount <= 0) break;
      if (length === 0 && startLeft === text.left) throw new Error("CKTDGUIIMEEditBox::RenderComposition: not one character of the composition string fits the text rectangle; the exe loops here for ever");
      offsetRect(rc, (text.left - rc.left) | 0, (rc.bottom - rc.top) | 0);
      wrapped = true;
      secondLine = true;
    }
    setRect(rc, firstLeft, firstTop, right, firstBottom);
    rcTemp = { left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom };
    if (wrapped && !secondLine) setRect(rcTemp, (firstLeft + text.right - right) | 0, (2 * firstTop - firstBottom) | 0, text.right, firstTop);
    // the target clause, a character at a time
    let nXFirstAttr = 0;
    ime.s_nFirstTargetConv = -1;
    const attributes = ime.s_abCompStringAttr;
    const compLength = wcslen(compText);
    for (let i = 0; i < compLength; i++) {
      const nXLeft = comp.CPtoX(i, false);
      const nXRight = comp.CPtoX(i, true);
      let left = rc.left, sub = nXFirstAttr;
      if (((nXRight - nXFirstAttr) | 0) > ((text.right - rc.left) | 0)) {
        offsetRect(rc, (text.left - rc.left) | 0, (rc.bottom - rc.top) | 0);
        nXFirstAttr = comp.CPtoX(i, false);
        left = rc.left;
        sub = nXFirstAttr;
      }
      if (ime.s_nCompCaret === i) {
        rcCaret = { left: rcTemp.left, top: rcTemp.top, right: rcTemp.right, bottom: rcTemp.bottom };
        rcCaret.left = (nXLeft - nXFirstAttr + rcTemp.left - 1) | 0;
        rcCaret.right = (nXLeft - nXFirstAttr + rcTemp.left + 1) | 0;
      }
      const attribute = attributes[i]!;
      let background: number;
      if (attribute === 1) {
        this.setFontColor(this.m_CompTargetColor);
        background = this.m_CompTargetBkColor;
      } else if (attribute === 3) {
        this.setFontColor(this.m_CompTargetNonColor);
        background = this.m_CompTargetNonBkColor;
      } else {
        continue;
      }
      const clause: Rect = { left: (nXLeft - nXFirstAttr + left) | 0, top: rc.top, right: (left + nXRight - sub) | 0, bottom: rc.bottom };
      this.DrawRect(clause, background);
      const target: Rect = { left: (clause.left - ox) | 0, top: (rc.top - oy) | 0, right: (clause.right - ox) | 0, bottom: (rc.bottom - oy) | 0 };
      this.DrawTextW(compText.slice(i), target, 1, 4);
      if (ime.s_nFirstTargetConv === -1) ime.s_nFirstTargetConv = i;
    }
    if (this.m_bCaretOn) {
      if (ime.s_nCompCaret === compLength) {
        const x = comp.CPtoX(ime.s_nCompCaret, false);
        rcCaret = { left: rcTemp.left, top: rcTemp.top, right: rcTemp.right, bottom: rcTemp.bottom };
        rcCaret.left = (x - nXFirstAttr + rcTemp.left - 1) | 0;
        rcCaret.right = (rcCaret.left + 2) | 0;
      }
      this.DrawRect(rcCaret, this.m_CompCaretColor);
    }
  }

  /**
   * `RenderCandidateReadingWindow(pd3dDevice, fElapsedTime, bReading)` (32939C50): the window of the candidates (up to 10; `bReading` false) or of
   * the reading (up to 5; the colours of the reading), under the composition string that `RenderComposition` left at `s_ptCompString`.  Neither
   * `pd3dDevice` nor `fElapsedTime` is used.  The colours are `m_Reading*` or `m_Candidate*` (text, window, selected text, selection's background).
   * - `nXComp` is the x in the composition string the window hangs from: 0 for a Taiwan layout (low word 0x0404) whose IME has no id
   *   (`GetImeId(0)`), else the x of `s_nFirstTargetConv` for a Japanese layout (primary language 0x11) and of `s_nCompCaret` for any other.
   * - The window is a line of text (the candidates as one line, `HoriCand`; the reading string) when the layout is not a vertical one or it is the
   *   reading, and the reading is horizontal or it is the candidates: its size is that of the box's `CalcTextRect` of the line (format 0x404).
   *   Otherwise it is a column: `awszCandidate`, each measured (format 0x404, the box's default alignment when the text fits) up to the
   *   first empty one; the width of the widest and the height of the highest, times 5 or 10 (every row, empty ones too).
   * - It sits under the string (`s_ptCompString.y` plus the text rectangle's height) at `s_ptCompString.x + nXComp`; a Chinese layout
   *   (primary language 4) puts it above.  A window beyond the right side of the view port is moved back; one beyond its bottom is tried above
   *   the string, then (when that is above the view port) at the string's end, then left of the string's x, at the top of the view port.
   * - The candidates' window is remembered in `s_CandList.rcCandidate`.  The window is drawn in its colour; a line of text is drawn in
   *   the text colour (the candidates' selected part again over a rectangle of the selection's colours); a column is drawn a row at a time,
   *   each in `rowHeight`, the selected one (`dwSelection`) over a rectangle.
   */
  RenderCandidateReadingWindow(pd3dDevice: unknown, fElapsedTime: number, bReading: boolean): void {
    void pd3dDevice;
    void fElapsedTime;
    const ime = this.ctx.ime;
    const comp = ime.s_CompString;
    const cand = ime.s_CandList;
    const buffer = this.m_Buffer;
    const text = this.m_rcText;
    const rows = bReading ? 5 : 10;
    buffer.CPtoX(this.m_nCaret, false);
    buffer.CPtoX(this.m_nFirstVisible, false);
    const textColor = bReading ? this.m_ReadingColor : this.m_CandidateColor;
    const winColor = bReading ? this.m_ReadingWinColor : this.m_CandidateWinColor;
    const selColor = bReading ? this.m_ReadingSelColor : this.m_CandidateSelColor;
    const selBkColor = bReading ? this.m_ReadingSelBkColor : this.m_CandidateSelBkColor;
    let nXComp: number;
    if ((ime.s_hklCurrent & 0xffff) === 0x404 && ime.getImeId(0) === 0) nXComp = 0;
    else if ((ime.s_hklCurrent & 0x3ff) === 0x11) nXComp = comp.CPtoX(ime.s_nFirstTargetConv, false);
    else nXComp = comp.CPtoX(ime.s_nCompCaret, false);
    const asLine = (!ime.s_bVerticalCand || bReading) && (ime.s_bHorizontalReading || !bReading);
    const horiText = cand.HoriCand.m_pwszBuffer ?? "";
    const rc = newRect();
    let width = 0, rowHeight = 0, total: number;
    if (asLine) {
      this.CalcTextRect(bReading ? ime.s_wszReadingString : horiText, rc, -1, 0x404);
      width = (rc.right - rc.left) | 0;
      rowHeight = total = (rc.bottom - rc.top) | 0;
    } else {
      for (let i = 0; i < rows; i++) {
        const candidate = cand.awszCandidate[i]!;
        if (candidate === "") break;
        setRect(rc, 0, 0, 0, 0);
        this.fontCalcTextRect(candidate, rc, -1, this.alignedFormat(0x404));
        const w = (rc.right - rc.left) | 0, h = (rc.bottom - rc.top) | 0;
        width = width > w ? width : w;
        rowHeight = rowHeight > h ? rowHeight : h;
      }
      total = Math.imul(rows, rowHeight);
    }
    const at = ime.s_ptCompString;
    const viewport = this.ctx.render?.viewport ?? { width: 1024, height: 768 };
    if ((ime.s_hklCurrent & 0x3ff) === 4) {
      setRect(rc, (at.x + nXComp) | 0, (at.y - total) | 0, (nXComp + at.x + width) | 0, at.y);
    } else {
      const top = (at.y + text.bottom - text.top) | 0;
      setRect(rc, (at.x + nXComp) | 0, top, (nXComp + at.x + width) | 0, (top + total) | 0);
    }
    const pullBack = (): void => {
      if (rc.right > viewport.width) {
        rc.left = (rc.left + viewport.width - rc.right) | 0;
        rc.right = viewport.width;
      }
    };
    pullBack();
    if (rc.bottom > viewport.height) {
      setRect(rc, (at.x + nXComp) | 0, (at.y - total) | 0, (nXComp + at.x + width) | 0, at.y);
      pullBack();
      let placed = rc.top >= 0;
      if (!placed) {
        const trail = comp.CPtoX(ime.s_nCompCaret, true);
        setRect(rc, (at.x + trail) | 0, 0, (at.x + trail + width) | 0, total);
        placed = rc.right <= viewport.width;
      }
      if (!placed) {
        setRect(rc, (nXComp + at.x - width) | 0, 0, (at.x + nXComp) | 0, total);
        if (rc.right < 0) {
          rc.left = 0;
          rc.right = width;
        }
      }
    }
    if (!bReading) {
      const keep = cand.rcCandidate;
      keep.left = rc.left;
      keep.top = rc.top;
      keep.right = rc.right;
      keep.bottom = rc.bottom;
    }
    this.DrawRect(rc, winColor);
    if (asLine) {
      this.setFontColor(textColor);
      if (bReading) {
        this.DrawTextW(ime.s_wszReadingString, rc, -1, 4);
        return;
      }
      this.DrawTextW(horiText, rc, -1, 4);
      const nXLeft = cand.HoriCand.CPtoX(cand.nFirstSelected, false);
      const nXRight = cand.HoriCand.CPtoX((cand.nFirstSelected + cand.nHoriSelectedLen) | 0, false);
      rc.right = (rc.left + nXRight) | 0;
      rc.left = (rc.left + nXLeft) | 0;
      this.DrawRect(rc, selBkColor);
      this.setFontColor(selColor);
      this.DrawTextW(horiText.slice(cand.nFirstSelected), rc, cand.nHoriSelectedLen, 4);
      return;
    }
    for (let i = 0; i < rows; i++) {
      rc.bottom = (rowHeight + rc.top) | 0;
      const selected = (cand.dwSelection >>> 0) === i;
      if (selected) this.DrawRect(rc, selBkColor);
      this.setFontColor(selected ? selColor : textColor);
      this.DrawTextW(cand.awszCandidate[i]!, rc, -1, 4);
      rc.top = (rc.top + rowHeight) | 0;
    }
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [this.m_pNormalTex, this.m_pDisableTex]) if (t) out.push(t);
  }

  // ---- the Lua setters ------------------------------------------------------------------------------------------------------

  /** `SetNormalTex_LUA(file, key)` (32935020): the texture of the background; a point that exists is handed it */
  SetNormalTex(fileName: string, key: string): void {
    this.m_pNormalTex = this.replaceTexture(this.m_pNormalTex, fileName, key);
    if (this.m_pNormalPoint) this.m_pNormalPoint.pUITextureData = this.m_pNormalTex;
    this.m_bBGCheck = true;
  }

  /** `SetDisableTex_LUA(file, key)` (32934BA0) */
  SetDisableTex(fileName: string, key: string): void {
    this.m_pDisableTex = this.replaceTexture(this.m_pDisableTex, fileName, key);
    if (this.m_pDisablePoint) this.m_pDisablePoint.pUITextureData = this.m_pDisableTex;
    this.m_bBGCheck = true;
  }

  /** `SetNormalPoint_LUA()` (32934F70): the point is read from the table on the Lua stack; with a normal texture it is that texture's size */
  SetNormalPoint(): void {
    this.m_pNormalPoint = this.pointOf(this.m_pNormalTex);
    this.m_bBGCheck = true;
  }

  /** `SetDisablePoint_LUA()` (32934AF0) */
  SetDisablePoint(): void {
    this.m_pDisablePoint = this.pointOf(this.m_pDisableTex);
    this.m_bBGCheck = true;
  }

  /** a background point: the texture, when there is one, is drawn at its own size unless the table says otherwise */
  private pointOf(tex: UITextureData | null): UIPointData {
    const p = this.makePoint(null);
    if (tex) {
      p.pUITextureData = tex;
      p.applyTextureSize();
    }
    return p;
  }

  /** `SetTextPoint_LUA()` (3293ADE0): the rectangle the text is drawn in (corners cut to whole pixels) */
  SetTextPoint(): void {
    const p = this.makePoint(null);
    this.m_pTextPoint = p;
    this.m_rcText.left = Math.trunc(p.leftTopPoint.x);
    this.m_rcText.top = Math.trunc(p.leftTopPoint.y);
    this.m_rcText.right = Math.trunc(p.rightBottomPoint.x);
    this.m_rcText.bottom = Math.trunc(p.rightBottomPoint.y);
  }

  /** `SetFont_LUA(fontIndex)` (32934D40): the UK font the dialog manager maps the index to (none for an index it does not know) */
  SetFont(nFontIndex: number): void {
    this.m_pFont = this.ctx.fonts.getMappedUKFont(nFontIndex);
  }

  /** `SetText_LUA(text)` (3293AE40): `SetText(text, false)` */
  SetText(text: string | undefined): void {
    this.setText(text ?? "", false);
  }

  /**
   * `SetText(wszText, bSelected)` (3293ABF0): the text is cut to the byte limit (when there is one) or the length limit, put in the buffer,
   * and the caret placed after it (or the whole text selected).
   */
  setText(text: string, bSelected: boolean): void {
    const b = this.m_Buffer;
    const limit = b.m_bByteLimit ? b.m_ByteLimit : b.m_nLengthLimit;
    const nz = text.indexOf("\0");
    const wsz = nz < 0 ? text : text.slice(0, nz);
    b.SetText(wsz.length > limit ? wsz.slice(0, Math.max(limit, 0)) : wsz);
    this.m_nFirstVisible = 0;
    this.PlaceCaret(b.GetTextSize());
    this.m_nSelStart = bSelected ? 0 : this.m_nCaret;
  }

  /**
   * `PlaceCaret(nCP)` (32939B50): the caret goes to character `nCP`; the first visible character moves so that the caret is inside the text
   * rectangle.
   */
  PlaceCaret(nCP: number): void {
    const b = this.m_Buffer;
    this.m_nCaret = nCP;
    const nX1st = b.CPtoX(this.m_nFirstVisible, false);
    const nX = b.CPtoX(nCP, false);
    const nX2 = nCP === b.GetTextSize() ? nX : b.CPtoX(nCP, true);
    if (nX < nX1st) {
      this.m_nFirstVisible = nCP;
    } else if (nX2 > nX1st + this.m_rcText.right - this.m_rcText.left) {
      const nXNewLeft = nX2 + this.m_rcText.left - this.m_rcText.right;
      const { cp } = b.XtoCP(nXNewLeft);
      const nXNew1st = b.CPtoX(cp, false);
      this.m_nFirstVisible = nXNew1st < nXNewLeft ? cp + 1 : cp;
    }
  }

  SetCustomMsgChange(msg: number): void { this.m_CustomMsgEditBoxChange = msg; }
  SetCustomMsgEnter(msg: number): void { this.m_CustomMsgEditBoxEnter = msg; }
  SetCustomMsgFocusOut(msg: number): void { this.m_CustomMsgEditBoxFocusOut = msg; }
  SetCustomMsgFocusIn(msg: number): void { this.m_CustomMsgEditBoxFocusIn = msg; }
  SetForceSendCustomMsgChange(on: boolean): void { this.m_bIsForceSendCustomMsgChange = on; }

  /** `SetTextColor_LUA(r, g, b, a)` (328CE2A0) */
  SetTextColor(r: number, g: number, b: number, a: number): void { this.m_TextColor = d3dColor(r, g, b, a); }
  /** `SetSelectedTextColor_LUA` (328CDF20) */
  SetSelectedTextColor(r: number, g: number, b: number, a: number): void { this.m_SelTextColor = d3dColor(r, g, b, a); }
  /** `SetSelectedBackColor_LUA` (328CDE20) */
  SetSelectedBackColor(r: number, g: number, b: number, a: number): void { this.m_SelBkColor = d3dColor(r, g, b, a); }
  /** `SetCaretColor_LUA` (328CCF90): the caret of the composition string takes the same colour */
  SetCaretColor(r: number, g: number, b: number, a: number): void {
    this.m_CaretColor = this.m_CompCaretColor = d3dColor(r, g, b, a);
  }

  /**
   * `SetOutlineColor_LUA` (328CD9F0): the outline colour as four floats, each the byte of the packed colour times 1/255.  (The alpha is
   * the whole 64-bit value shifted down, as the exe has it: a value above 1 stays above 1.)
   */
  SetOutlineColor(r: number, g: number, b: number, a: number): void {
    const packed = packArgb(r, g, b, a);
    const o = this.m_OutlineColor;
    o.r = f(f(Number(BigInt.asUintN(8, packed >> 16n))) * ONE_OVER_255);
    o.g = f(f(Number(byte(channel(g)))) * ONE_OVER_255);
    o.b = f(f(Number(byte(channel(b)))) * ONE_OVER_255);
    o.a = f(f(Number(BigInt.asUintN(64, packed >> 24n))) * ONE_OVER_255);
    this.m_bOutlineCheck = true;
  }

  /** `SetLengthLimit(n)` (328CD200): the buffer's `m_nLengthLimit` */
  SetLengthLimit(n: number): void { this.m_Buffer.m_nLengthLimit = n; }
  /** `SetByteLimit_LUA(n)` (328CCEF0): a byte limit replaces the length limit in `SetText` */
  SetByteLimit(n: number): void {
    this.m_Buffer.m_bByteLimit = true;
    this.m_Buffer.m_ByteLimit = n;
  }
  SetWidthLimit(n: number): void { this.m_Buffer.m_WidthLimit = n; }
  SetLineLimit(n: number): void { this.m_Buffer.m_LineLimit = n; }
  SetOneCharMode(on: boolean): void { this.m_Buffer.m_bOneCharMode = on; }
  SetOnlyNumMode(on: boolean): void { this.m_Buffer.m_bOnlyNumMode = on; }
  SetOnlyNumAndEnglishMode(on: boolean, checkBigAndSmall: boolean, bigEnglish: boolean): void {
    this.m_Buffer.m_bOnlyNumAndEnglishMode = on;
    this.m_Buffer.m_bCheckEnglishBigAndSmall = checkBigAndSmall;
    this.m_Buffer.m_bBigEnglish = bigEnglish;
  }
  SetAutoChangeBigEnglish(on: boolean): void { this.m_Buffer.m_bAutoChangeBigEnglish = on; }

  /** `SetDefTextAlign_LUA(flags)` (328CD2F0): the `DT_*` flags text is aligned with (an unsigned long) */
  SetDefTextAlign(flags: number): void { this.m_DefTextAlign = flags >>> 0; }
  SetEnablePaste(on: boolean): void { this.m_bEnablePaste = on; }

  /** `SetMultiLineOption_LUA(groupID, groupSequence)` (3293AB30): the boxes of one group are the lines of one text (Tab moves between them) */
  SetMultiLineOption(groupID: number, groupSequence: number): void {
    this.m_GroupID = groupID;
    this.m_GroupSequence = groupSequence;
  }
}
