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
 * Drawing: `OnFrameRender` 32934400 (with `PlaceCaret` 32934A00, `DrawTextW` 329339F0 and `DrawRect` 329335A0): the background, the selection,
 * the text (and the selected part of it again in the selection's colour), the blinking caret.
 *
 * Not ported: what the box does while the game runs (`MsgProc`, `HandleKeyboard`, `HandleMouse`, `OnFocusOut`, the clipboard helpers).
 */
import { D3DTOP, D3DTSS } from "@els/d3d9";
import { STATE_TYPE } from "@els/engine";
import type { KStateID } from "@els/engine";
import { Color } from "@els/host";
import type { CKTDGUIEditBox_Methods } from "@els/host";
import { CKTDGUIControl, UCT, destroyTexture, readPointData } from "./control.ts";
import type { UIContext, UIPointData, UITextureData } from "./control.ts";
import { byte, channel, d3dColor, ONE_OVER_255, packArgb } from "./d3dcolor.ts";
import type { DeviceSound } from "./device.ts";
import type { UKFont } from "./font.ts";
import { wcslen } from "./freetypefont.ts";
import { ftoi, intersectRect, newRect, offsetRect, setRect } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { VertexUI4 } from "./render.ts";
import { CKTDGUIUniBuffer } from "./unibuffer.ts";

const f = Math.fround;

/** what `DrawRect` sets the stage's colour and alpha operations to once the rectangle is drawn (through the mirror: nothing is pushed) */
const MODULATE_OPERATIONS: KStateID = [
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.MODULATE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.MODULATE },
];

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
  /** `m_Vertex[4]`: the quad of the background */
  readonly m_Vertex = new VertexUI4();
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
   * `~CKTDGUIEditBox` (32932FE0), then the control's: the two textures are destroyed (their devices closed), the three points freed, the key
   * sound closed and the text buffer destroyed (`~CKTDGUIUniBuffer`).
   */
  override Destroy(): void {
    const devices = this.ctx.devices;
    this.m_pNormalTex = destroyTexture(devices, this.m_pNormalTex);
    this.m_pDisableTex = destroyTexture(devices, this.m_pDisableTex);
    this.m_pNormalPoint = null;
    this.m_pDisablePoint = null;
    this.m_pTextPoint = null;
    this.m_pSndKeyDown = this.closeHeldDevice(this.m_pSndKeyDown);
    this.m_Buffer.Destroy();
    super.Destroy();
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

  /**
   * `PlaceCaret(nCP)` (32934A00): the caret goes to character `nCP`; the first visible character moves so that the caret is inside the text
   * rectangle: back to the caret when it is left of the first visible character, else (when the caret's trailing edge is beyond the right
   * side of the rectangle) to the first character whose x is not left of what the caret needs, `XtoCP` and one more if that x is short.
   */
  PlaceCaret(nCP: number): void {
    const b = this.m_Buffer;
    this.m_nCaret = nCP;
    const nX1st = b.CPtoX(this.m_nFirstVisible, false);
    const nX = b.CPtoX(nCP, false);
    const nX2 = nCP === b.GetTextSize() ? nX : b.CPtoX(nCP, true);
    if (nX >= nX1st) {
      const left = this.m_rcText.left;
      if (nX2 > nX1st + this.m_rcText.right - left) {
        const nXNewLeft = nX2 + left - this.m_rcText.right;
        const { cp } = b.XtoCP(nXNewLeft);
        const nXNew1st = b.CPtoX(cp, false);
        this.m_nFirstVisible = nXNew1st < nXNewLeft ? cp + 1 : cp;
      }
    } else {
      this.m_nFirstVisible = nCP;
    }
  }

  /**
   * `DrawRect(prcDest, color)` (329335A0): a rectangle of one colour, drawn as an untextured quad (the stage's colour and alpha operations
   * are `SELECTARG2` for the draw: the diffuse colour alone, then set to `MODULATE` and popped back).  Each side is `(int)(float)((float)side *
   * scale + (float)(scale * dialog.m_Pos))`, in the pixels of the back buffer; the vertices lie half a pixel up and left, `z` 0.5, `rhw` 1, the
   * UVs 0.
   */
  DrawRect(prcDest: Rect, color: number): number {
    const dialog = this.m_pDialog;
    if (!dialog) throw new Error("CKTDGUIEditBox::DrawRect: the box is in no dialog (the exe's handle answers a null object)");
    const render = this.ctx.render;
    const sx = render ? render.resolutionScale.x : 1, sy = render ? render.resolutionScale.y : 1;
    const px = f(sx * dialog.m_Pos.x), py = f(sy * dialog.m_Pos.y);
    const left = ftoi(f(f(f(prcDest.left) * sx) + px));
    const top = ftoi(f(f(f(prcDest.top) * sy) + py));
    const right = ftoi(f(f(f(prcDest.right) * sx) + px));
    const bottom = ftoi(f(f(f(prcDest.bottom) * sy) + py));
    const x0 = f(f(left) - 0.5), x1 = f(f(right) - 0.5), y0 = f(f(top) - 0.5), y1 = f(f(bottom) - 0.5);
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
    states?.set(MODULATE_OPERATIONS);
    states?.popTo(top0);
    return 0;
  }

  /**
   * `DrawTextW(strText, prcDest, nCount, format)` (329339F0): the font draws the text (`DrawTextFont`, with the box's font colour and the
   * outline when `m_bOutlineCheck`) in the rectangle moved by the dialog's place plus the box's offset, each cut to whole pixels.  A box
   * without a font calls `DrawTextFont` through a null pointer: that returns at once for a text it draws nothing of (empty, count 0), and
   * is a crash otherwise.
   */
  DrawTextW(strText: string, prcDest: Rect, nCount: number, format: number): number {
    const dialog = this.m_pDialog;
    if (!dialog) throw new Error("CKTDGUIEditBox::DrawTextW: the box is in no dialog (the exe's handle answers a null object)");
    const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.right, bottom: prcDest.bottom };
    offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)), ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));
    const font = this.m_pFont;
    if (font === null) {
      if (wcslen(strText) === 0 || nCount === 0) return 0;
      throw new Error("CKTDGUIEditBox::DrawTextW: the box has no font (SetFont); the exe calls DrawTextFont through a null pointer");
    }
    font.DrawTextFont(strText, rcScreen, nCount, this.m_NowFontColor, this.m_bOutlineCheck, this.m_OutlineColor, format);
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

  /**
   * `OnFrameRender` (32934400): a shown box gives its buffer the box's font, places the caret and draws, in this order:
   * - the background (`m_bBGCheck`): the current point's quad;
   * - the selection, when the caret is not at the selection's start: a rectangle of `m_SelBkColor` from the smaller to the larger of the
   *   two x positions, moved by the text rectangle's left minus the x of the first visible character, cut to the text rectangle (an empty
   *   cut is the rectangle (0, 0, 0, 0), drawn all the same);
   * - the text from the first visible character on (a password box: its hide character for each character of the text) in
   *   `m_TextColor`, in the text rectangle, vertically centred (`DrawTextW` with the format 4);
   * - the selected part again, in `m_SelTextColor` in the selection's rectangle: from the larger of the first visible character and the
   *   selection's start to the selection's end (a selection that ends before the first visible character has a negative count: all of the
   *   text);
   * - the blink: when `m_dfBlink` seconds have gone since `m_dfLastBlink` the caret toggles and the time is taken again;
   * - the caret (a focused box whose caret is on, unless `s_bHideCaret`): a rectangle of `m_CaretColor`, two pixels wide around the x of the
   *   caret (one pixel of the box's overwrite mode: from the x minus one to the x of the trailing edge, the same x, `CPtoX` not looking at the trail).
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    const buffer = this.m_Buffer;
    buffer.m_pFontNode = this.m_pFont;
    this.PlaceCaret(this.m_nCaret);
    if (this.m_bBGCheck) {
      this.updateVertex(this.m_Vertex, this.m_NowPoint);
      this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);
    }
    const text = this.m_rcText;
    const nXFirst = buffer.CPtoX(this.m_nFirstVisible, false);
    const nCaretX = buffer.CPtoX(this.m_nCaret, false);
    let nSelStartX = nCaretX;
    if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nSelStart, false);
    const rcSelection = newRect();
    if (this.m_nCaret !== this.m_nSelStart) {
      const left = nCaretX <= nSelStartX ? nCaretX : nSelStartX;
      const right = nCaretX <= nSelStartX ? nSelStartX : nCaretX;
      setRect(rcSelection, left, text.top, right, text.bottom);
      offsetRect(rcSelection, (text.left - nXFirst) | 0, 0);
      intersectRect(rcSelection, text, rcSelection);
      this.DrawRect(rcSelection, this.m_SelBkColor);
    }
    this.setFontColor(this.m_TextColor);
    const typed = buffer.m_pwszBuffer ?? "";
    const hidden = (): string => String.fromCharCode(this.m_HideChar).repeat(buffer.GetTextSize());
    const shown = this.m_bPasswordEditBox ? hidden() : typed;
    this.DrawTextW(shown.slice(this.m_nFirstVisible), text, -1, 4);
    const caret = this.m_nCaret, selStart = this.m_nSelStart;
    if (caret !== selStart) {
      const lower = Math.min(caret, selStart);
      const start = this.m_nFirstVisible <= lower ? lower : this.m_nFirstVisible;
      const end = Math.max(caret, selStart);
      this.setFontColor(this.m_SelTextColor);
      const selected = this.m_bPasswordEditBox ? hidden() : typed;
      this.DrawTextW(selected.slice(start), rcSelection, (end - start) | 0, 4);
    }
    const devices = this.ctx.devices;
    if (devices.absoluteTime() - this.m_dfLastBlink >= this.m_dfBlink) {
      this.m_bCaretOn = !this.m_bCaretOn;
      this.m_dfLastBlink = devices.absoluteTime();
    }
    if (this.m_bHasFocus && this.m_bCaretOn && !CKTDGUIEditBox.s_bHideCaret) {
      const x = (text.left - nXFirst) | 0;
      const rcCaret: Rect = { left: (nCaretX - 1 + x) | 0, top: text.top, right: (nCaretX + 1 + x) | 0, bottom: text.bottom };
      if (!this.m_bInsertMode) rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;
      this.DrawRect(rcCaret, this.m_CaretColor);
    }
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
