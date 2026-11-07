/**
 * `CKTDGUIEditBox` (the Lua class `CKTDGUIEditBox`, a `CKTDGUIControl`): the single-line text box without an input method editor
 * (DXUT's `CDXUTEditBox` with the game's changes).  `CKTDGUIDialog::CreateEditBox` 328C12E0 (sizeof 0x4F8).
 *
 * Constructor 329323E0: the font none, a text colour of 0xFF101010, selected text white, the selection background 0xFF28325C, a black caret,
 * the caret on and blinking at the system's blink time times 0.0005 (`m_dfBlink`), the insert mode, no custom messages, no textures or points,
 * the hide character `*` (not used until `SetHideChar`), input enabled, a text buffer (`CKTDGUIUniBuffer`) of one character, and
 * `UI_Control_Sound.lua` run for the sound of its global `EditBox_KeyDown`.  It also clears the class's `s_bHideCaret`.
 *
 * The Lua methods: SetNormalTex_LUA 32935020, SetDisableTex_LUA 32934BA0, SetNormalPoint_LUA 32934F70, SetDisablePoint_LUA 32934AF0 and
 * SetFont_LUA 32934D40 (identical code, folded with the IME edit box's: the two classes lay out their first 0x270 bytes alike), SetTextPoint_LUA
 * 329351C0 (unlike the IME box's: the point only, `m_rcText` is not touched), SetCustomMsgChange 328CD0E0 and SetCustomMsgEnter 328CD140 (also
 * folded), the colour setters SetTextColor_LUA 328CE220 / SetSelectedTextColor_LUA 328CDEA0 / SetSelectedBackColor_LUA 328CDDA0 /
 * SetCaretColor_LUA 328CCF10 (the IME box's, at other members), SetOutlineColor_LUA 328CD9F0 (the IME box's own function) and SetHideChar_ 32934E90.
 *
 * Not ported: what the box does while the game runs (`MsgProc`, `HandleKeyboard`, `HandleMouse`, `OnFocusOut`, `OnFrameMove`, `OnFrameRender`, the
 * clipboard and caret helpers).
 */
import { Color } from "@els/host";
import type { CKTDGUIEditBox_Methods } from "@els/host";
import { CKTDGUIControl, UCT, readPointData } from "./control.ts";
import type { UIContext, UIPointData, UITextureData } from "./control.ts";
import { byte, channel, d3dColor, ONE_OVER_255, packArgb } from "./d3dcolor.ts";
import type { DeviceSound } from "./device.ts";
import type { UKFont } from "./font.ts";
import { ftoi, newRect, newVertices } from "./rect.ts";
import type { Rect, VertexUI } from "./rect.ts";
import { CKTDGUIUniBuffer } from "./unibuffer.ts";

const f = Math.fround;

export class CKTDGUIEditBox extends CKTDGUIControl implements Partial<CKTDGUIEditBox_Methods> {
  /** `CKTDGUIEditBox::s_bHideCaret` (the constructor clears it) */
  static s_bHideCaret = false;

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
  m_bEnableInput = true;
  readonly m_Buffer: CKTDGUIUniBuffer;
  readonly m_rcText: Rect = newRect();
  /** seconds between the blinks of the caret: the system's caret blink time times 0.0005 */
  m_dfBlink: number;
  m_dfLastBlink: number;
  m_bCaretOn = true;
  m_nCaret = 0;
  m_bInsertMode = true;
  m_nSelStart = 0;
  m_nFirstVisible = 0;
  m_TextColor = 0xff101010;
  m_SelTextColor = 0xffffffff;
  m_SelBkColor = 0xff28325c;
  m_CaretColor = 0xff000000;
  m_bPasswordEditBox = false;
  /** the `wchar_t` the box shows for each character of a password */
  m_HideChar = 42;
  m_bMouseDrag = false;
  readonly m_Vertex: VertexUI[] = newVertices();
  m_pSndKeyDown: DeviceSound | undefined;

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_Buffer = new CKTDGUIUniBuffer(ctx.devices.massFiles.log, 1);
    this.m_ControlType = UCT.EDITBOX;
    this.m_dfBlink = f(f(ctx.devices.caretBlinkTime) * f(0.0005));
    this.m_dfLastBlink = ctx.devices.absoluteTime();
    CKTDGUIEditBox.s_bHideCaret = false;
    [this.m_pSndKeyDown] = this.openControlSounds(["EditBox_KeyDown"]);
  }

  /**
   * `OnFrameMove` (329342D0): an enabled edit box runs the control's and, with a background (`m_bBGCheck`), makes its normal point the end point;
   * its current point is that point (or, without a background, its text point), and the text rectangle is the text point's left-top and
   * right-bottom corners cut to ints.  The exe dereferences null when a point it needs is missing; so does the port (an Error).
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!this.m_bEnable) return 0;
    super.onFrameMove(fTime, fElapsedTime);
    this.m_fElapsedTime = Math.fround(fElapsedTime);
    let point: UIPointData | null;
    if (this.m_bBGCheck) {
      point = this.m_pNormalPoint;
      if (!point) throw new Error("CKTDGUIEditBox::OnFrameMove: the box has a background but no normal point; the exe dereferences null");
      this.m_EndPoint.assign(point);
    } else {
      point = this.m_pTextPoint;
    }
    const text = this.m_pTextPoint;
    if (!point || !text) throw new Error("CKTDGUIEditBox::OnFrameMove: the box has no text point (SetTextPoint); the exe dereferences null");
    this.m_NowPoint.assign(point);
    const rc = this.m_rcText;
    rc.left = ftoi(text.leftTopPoint.x);
    rc.top = ftoi(text.leftTopPoint.y);
    rc.right = ftoi(text.rightBottomPoint.x);
    rc.bottom = ftoi(text.rightBottomPoint.y);
    return 0;
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [this.m_pNormalTex, this.m_pDisableTex]) if (t) out.push(t);
  }

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

  private pointOf(tex: UITextureData | null): UIPointData {
    const p = this.makePoint(null);
    if (tex) {
      p.pUITextureData = tex;
      p.applyTextureSize();
    }
    return p;
  }

  /** `SetTextPoint_LUA()` (329351C0): the point of the text, as the table gives it; the old one goes */
  SetTextPoint(): void {
    this.m_pTextPoint = readPointData(this.ctx);
  }

  /** `SetFont_LUA(fontIndex)` (32934D40): the UK font the dialog manager maps the index to (none for an index it does not know) */
  SetFont(nFontIndex: number): void {
    this.m_pFont = this.ctx.fonts.getMappedUKFont(nFontIndex);
  }

  SetCustomMsgChange(msg: number): void {
    this.m_CustomMsgEditBoxChange = msg | 0;
  }

  SetCustomMsgEnter(msg: number): void {
    this.m_CustomMsgEditBoxEnter = msg | 0;
  }

  /** `SetTextColor_LUA(r, g, b, a)` (328CE220) */
  SetTextColor(r: number, g: number, b: number, a: number): void {
    this.m_TextColor = d3dColor(r, g, b, a);
  }

  /** `SetSelectedTextColor_LUA` (328CDEA0) */
  SetSelectedTextColor(r: number, g: number, b: number, a: number): void {
    this.m_SelTextColor = d3dColor(r, g, b, a);
  }

  /** `SetSelectedBackColor_LUA` (328CDDA0) */
  SetSelectedBackColor(r: number, g: number, b: number, a: number): void {
    this.m_SelBkColor = d3dColor(r, g, b, a);
  }

  /** `SetCaretColor_LUA` (328CCF10) */
  SetCaretColor(r: number, g: number, b: number, a: number): void {
    this.m_CaretColor = d3dColor(r, g, b, a);
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

  /**
   * `SetHideChar_(const char*)` (32934E90): the first character of the string (0 for an empty one or none) is what each character of the text
   * is shown as; the box is a password box from now on.
   */
  SetHideChar(hideChar: string | undefined): void {
    const code = hideChar ? hideChar.charCodeAt(0) : 0;
    this.m_HideChar = code;
    this.m_bPasswordEditBox = true;
    this.m_Buffer.SetHideChar(true, code);
  }
}
