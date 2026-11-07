/**
 * `CKTDGUIIMEEditBox` (the Lua class `CKTDGUIIMEEditBox`, a `CKTDGUIControl`): the single- and multi-line text box with an input method
 * editor (DXUT's `CDXUTIMEEditBox` with the game's limits).  Constructor 32935240, and the Lua setters: SetNormalTex_LUA 32935020,
 * SetDisableTex_LUA 32934BA0, SetNormalPoint_LUA 32934F70, SetDisablePoint_LUA 32934AF0, SetTextPoint_LUA 3293ADE0, SetFont_LUA 32934D40,
 * SetText_LUA 3293AE40 (-> SetText 3293ABF0 -> PlaceCaret 32939B50), the four SetCustomMsg* 328CD0E0 / 328CD140 / 328CD160 / 328CD150,
 * the colour setters 328CE2A0 / 328CDF20 / 328CDE20 / 328CCF90 / 328CD9F0, SetMultiLineOption_LUA 3293AB30, and the one-line setters that
 * write the buffer's limits and modes (328CD200, 328CCEF0, 328CE420, 328CD880, 328CD9A0, 328CD9E0, 328CD9B0, 328CCE40) or the box's
 * (328CD2F0, 328CD480, 328CD7B0).
 *
 * Not ported: what the box does while the game runs (`MsgProc`, the keyboard / mouse / IME handling, `OnFrameMove`, `OnFrameRender`, the
 * candidate and composition windows): that needs the window system, the IME and the font manager.  The constructor's calls into
 * `imm32.dll` are answered as a window without an IME would.
 */
import { Color } from "@els/host";
import type { CKTDGUIIMEEditBox_Methods } from "@els/host";
import { CKTDGUIControl, UCT } from "./control.ts";
import type { UIContext, UIPointData, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import type { UKFont } from "./font.ts";
import { byte, channel, d3dColor, ONE_OVER_255, packArgb } from "./d3dcolor.ts";
import { ftoi, newRect, newVertices } from "./rect.ts";
import type { Rect, VertexUI } from "./rect.ts";
import { CKTDGUIUniBuffer } from "./unibuffer.ts";
import type { UniBufferLog } from "./unibuffer.ts";

const f = Math.fround;

/**
 * The statics of `CKTDGUIIMEEditBox` that every box shares: `s_bCreateDeviceCheck`, `s_hImcDef`, `s_bHideCaret`, `s_bEnableImeSystem`
 * and `s_CompString` (the buffer of the composition string, made with no storage and given 256 characters by `Initialize`, 329384B0,
 * the first time a box is built: the part of it that loads `imm32.dll` is not modelled).
 */
export class ImeSystem {
  s_bCreateDeviceCheck = false;
  /** `ImmGetContext(hwnd)` of the first box: the default input context (no window, no context: 0) */
  s_hImcDef = 0;
  s_bHideCaret = false;
  s_bEnableImeSystem = false;
  s_bInitialised = false;
  readonly s_CompString: CKTDGUIUniBuffer;

  constructor(log: UniBufferLog) {
    this.s_CompString = new CKTDGUIUniBuffer(log, 0); // 328776C0
  }

  /** `CKTDGUIIMEEditBox::Initialize()` (329384B0) */
  initialize(): void {
    if (this.s_bInitialised) return;
    this.s_CompString.SetBufferSize(256);
    this.s_bInitialised = true;
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
  readonly m_Vertex: VertexUI[] = newVertices();
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
   * on the text that is visible when it fits in the rectangle: `(int)(width of the point / 2 - visible text width / 2)`; the text is measured by
   * `CKTDGUIUniBuffer::CPtoX`, which needs a font and is not ported (it throws).  Otherwise the offset is 0.
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
