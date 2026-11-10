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
 * Input: `HandleKeyboard` 32933AB0 (the keys that move the caret, Insert, Delete), `MsgProc` 32933F70 (the characters: typing, backspace, Enter,
 * Ctrl+A, copy, cut, paste), `HandleMouse` 32933D80 (the caret goes where the left button goes down; drag), `OnFocusOut` 32934290, and the helpers
 * `CopyToClipboard` 32933460, `PasteFromClipboard` 32934970, `DeleteSelectionText` 32933540, `ClearText` 32933190 (a C++ member only) and
 * `ContainPTForEditBox` 329331C0.  The window system is `UIContext`'s: the state of Shift and Control (`getKeyState`) and the clipboard.
 */
import { D3DTOP, D3DTSS } from "@els/d3d9";
import { STATE_TYPE } from "@els/engine";
import type { KStateID } from "@els/engine";
import { Color } from "@els/host";
import type { CKTDGUIEditBox_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIM, destroyTexture, readPointData, requestFocus } from "./control.ts";
import type { UIContext, UIPointData, UITextureData } from "./control.ts";
import { byte, channel, d3dColor, ONE_OVER_255, packArgb } from "./d3dcolor.ts";
import type { DeviceSound } from "./device.ts";
import type { UKFont } from "./font.ts";
import { wcslen } from "./freetypefont.ts";
import { resolutionScale } from "./pick.ts";
import { ftoi, intersectRect, newRect, offsetRect, setRect } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { VertexUI4 } from "./render.ts";
import { CKTDGUIUniBuffer, untilNul } from "./unibuffer.ts";

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

  // ---- the input

  /** `m_bCaretOn = true; m_dfLastBlink = DXUTGetGlobalTimer()->GetAbsoluteTime()`: the caret shows at once and blinks from now on */
  private blink(): void {
    this.m_bCaretOn = true;
    this.m_dfLastBlink = this.ctx.devices.absoluteTime();
  }

  /** what an edit of the text tells the stage: the custom message of `SetCustomMsgChange` (0x467), without one the control event 0x466 with 0 */
  private sendChange(): void {
    const msg = this.m_CustomMsgEditBoxChange;
    if (msg === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 0);
    else this.sendInternelEvent(UIM.CUSTOM_MSG, msg);
  }

  /** the end of Home, End, Left and Right: without Shift the selection collapses to the caret; the caret shows and blinks anew; the key is taken */
  private caretMoved(): true {
    if (this.ctx.getKeyState(0x10) >= 0) this.m_nSelStart = this.m_nCaret;
    this.blink();
    return true;
  }

  /**
   * `HandleKeyboard(uMsg, wParam, lParam)` (32933AB0), virtual slot 7: a key going down (0x100) of a box that is enabled.  A box that does not
   * take input takes every key.  Tab is left to the dialog and so are the keys the box has no use for, except Escape (27), which the box takes.
   * - Home / End: the caret goes to the start / the end; Left / Right: one character (a word with Ctrl, `GetPriorItemPos` / `GetNextItemPos`),
   *   not past the text; then, for these four, the selection collapses to the caret unless Shift is down, and the caret blinks anew.  Ctrl is asked
   *   first (Left, Right), Shift after the move; Home and End ask Shift only.  Up and Down are taken and do nothing (the exe has an arm for them
   *   that only answers true, as the default arm does for every key but Escape).
   * - Insert: with Ctrl the selection is copied, else with Shift the clipboard is pasted, else the insert mode is toggled.  Never taken.
   * - Delete: the selection is deleted, else the character at the caret; then the change message goes out (a failed `RemoveChar` sends nothing)
   *   and the caret blinks anew either way.
   */
  override handleKeyboard(uMsg: number, wParam: number, _lParam: number): boolean {
    if (!this.m_bEnable) return false;
    if (uMsg !== 0x100) return false;
    if (!this.m_bEnableInput) return true;
    const buffer = this.m_Buffer;
    const ctx = this.ctx;
    switch (wParam) {
      case 9: // VK_TAB
        return false;
      case 0x23: // VK_END
        this.PlaceCaret(buffer.GetTextSize());
        return this.caretMoved();
      case 0x24: // VK_HOME
        this.PlaceCaret(0);
        return this.caretMoved();
      case 0x25: // VK_LEFT
        if (ctx.getKeyState(0x11) >= 0) {
          if (this.m_nCaret > 0) this.PlaceCaret(this.m_nCaret - 1);
        } else {
          this.m_nCaret = buffer.GetPriorItemPos(this.m_nCaret);
          this.PlaceCaret(this.m_nCaret);
        }
        return this.caretMoved();
      case 0x27: // VK_RIGHT
        if (ctx.getKeyState(0x11) >= 0) {
          if (this.m_nCaret < buffer.GetTextSize()) this.PlaceCaret(this.m_nCaret + 1);
        } else {
          this.m_nCaret = buffer.GetNextItemPos(this.m_nCaret);
          this.PlaceCaret(this.m_nCaret);
        }
        return this.caretMoved();
      case 0x2d: // VK_INSERT
        if (ctx.getKeyState(0x11) >= 0) {
          if (ctx.getKeyState(0x10) >= 0) this.m_bInsertMode = !this.m_bInsertMode;
          else this.PasteFromClipboard();
        } else this.CopyToClipboard();
        return false;
      case 0x2e: // VK_DELETE
        if (this.m_nCaret !== this.m_nSelStart) {
          this.DeleteSelectionText();
          this.sendChange();
        } else if (buffer.RemoveChar(this.m_nCaret)) this.sendChange();
        this.blink();
        return true;
      default:
        return wParam !== 27;
    }
  }

  /**
   * `MsgProc(hWnd, uMsg, wParam, lParam)` (32933F70), virtual slot 6: a character (`WM_CHAR`, 0x102) of a box that is enabled and shown; a box
   * that does not take input takes all of them.  Only the low 16 bits of `wParam` are the character.  The control characters:
   * - 1 (Ctrl+A): with no selection, everything is selected (the selection starts at 0, the caret goes to the end); with one, nothing happens;
   * - 3 (Ctrl+C) copies, 24 (Ctrl+X) copies and deletes the selection (the change message goes out even when nothing was selected);
   * - 8 (backspace): the key's sound; the selection goes, else the character before the caret (nothing at the start of the text); the change message
   *   goes out for all but the start of the text; the caret blinks anew;
   * - 13 (Enter): the control event 0x466 with 1, or the custom message of `SetCustomMsgEnter`; 22 (Ctrl+V) pastes and sends the change message;
   * - the others below 32 that are not a character of a text (2, 4 to 7, 9 to 12, 14 to 21, 23, 25 to 29): taken, nothing happens.
   * Anything else (0, 30 and above) is typed: the key's sound, the selection is replaced; in the insert mode, or with the caret at the end, the
   * character is inserted (a refused one moves nothing), else it takes the place of the character at the caret; the caret moves behind it and
   * the selection collapses to it; the caret blinks anew and the change message goes out in every case.
   */
  override msgProc(_hWnd: unknown, uMsg: number, wParam: number, _lParam: number): boolean {
    if (!this.m_bEnable || !this.m_bShow || uMsg !== 0x102) return false;
    if (!this.m_bEnableInput) return true;
    const ch = wParam & 0xffff;
    const buffer = this.m_Buffer;
    switch (ch) {
      case 1:
        if (this.m_nSelStart === this.m_nCaret) {
          this.m_nSelStart = 0;
          this.PlaceCaret(buffer.GetTextSize());
        }
        return true;
      case 2: case 4: case 5: case 6: case 7: case 9: case 10: case 11: case 12:
      case 14: case 15: case 16: case 17: case 18: case 19: case 20: case 21:
      case 23: case 25: case 26: case 27: case 28: case 29:
        return true;
      case 3:
      case 24:
        this.CopyToClipboard();
        if (ch !== 24) return true;
        this.DeleteSelectionText();
        this.sendChange();
        return true;
      case 8:
        this.playSound(this.m_pSndKeyDown);
        if (this.m_nCaret !== this.m_nSelStart) {
          this.DeleteSelectionText();
          this.sendChange();
        } else if (this.m_nCaret > 0) {
          this.PlaceCaret(this.m_nCaret - 1);
          this.m_nSelStart = this.m_nCaret;
          buffer.RemoveChar(this.m_nCaret);
          this.sendChange();
        }
        this.blink();
        return true;
      case 13:
        if (this.m_CustomMsgEditBoxEnter === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 1);
        else this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgEditBoxEnter);
        return true;
      case 22:
        this.PasteFromClipboard();
        this.sendChange();
        return true;
      default:
        this.playSound(this.m_pSndKeyDown);
        if (this.m_nCaret !== this.m_nSelStart) this.DeleteSelectionText();
        let moved = true;
        if (this.m_bInsertMode || this.m_nCaret >= buffer.GetTextSize()) moved = buffer.InsertChar(this.m_nCaret, ch);
        else buffer.setCharAt(this.m_nCaret, ch);
        if (moved) {
          this.PlaceCaret(this.m_nCaret + 1);
          this.m_nSelStart = this.m_nCaret;
        }
        this.blink();
        this.sendChange();
        return true;
    }
  }

  /**
   * `HandleMouse(uMsg, pt, wParam, lParam)` (32933D80), virtual slot 8, of an enabled box.  The point the dialog hands it is not looked at: the
   * position comes from `lParam` (the signed low and high words, in the pixels of the back buffer, divided by the resolution scale and cut), as in
   * DXUT.  The character under it is `XtoCP` of that x plus the x of the first visible character minus the text rectangle's left (`XtoCP`'s
   * trailing flag is always 0, so the branch that would move the caret one on is never taken).
   * - 0x200 (move): while the box is dragging, the caret follows the mouse (the selection keeps its start); not taken;
   * - 0x201 / 0x203 (left button down, double click): a box without the focus asks for it (before it knows whether the point is on it); a point
   *   outside the box (`ContainPTForEditBox`) is not taken; else the mouse is captured, the box is dragging, the caret goes under the point, the
   *   selection collapses to it, the caret blinks anew; taken;
   * - 0x202 (left button up): the capture is released, the drag ends; not taken.
   */
  override handleMouse(uMsg: number, _x: number, _y: number, _wParam: number, lParam: number): boolean {
    if (!this.m_bEnable) return false;
    const scale = resolutionScale(this.ctx);
    const x = ftoi(f(f((lParam << 16) >> 16) / scale.x));
    const y = ftoi(f(f(lParam >> 16) / scale.y));
    switch (uMsg) {
      case 0x200:
        if (!this.m_bMouseDrag) return false;
        this.PlaceCaret(this.charAt(x));
        return false;
      case 0x201:
      case 0x203:
        if (!this.m_bHasFocus) requestFocus(this.ctx, this);
        if (!this.ContainPTForEditBox(x, y)) return false;
        this.m_bMouseDrag = true;
        this.ctx.setCapture();
        this.PlaceCaret(this.charAt(x));
        this.m_nSelStart = this.m_nCaret;
        this.blink();
        return true;
      case 0x202:
        this.ctx.releaseCapture();
        this.m_bMouseDrag = false;
        return false;
      default:
        return false;
    }
  }

  /** the character of the text under the layout x `x` of the mouse: `XtoCP(CPtoX(m_nFirstVisible) + x - m_rcText.left)` */
  private charAt(x: number): number {
    const buffer = this.m_Buffer;
    return buffer.XtoCP((buffer.CPtoX(this.m_nFirstVisible, false) + x - this.m_rcText.left) | 0).cp;
  }

  /**
   * `OnFocusOut()` (32934290), virtual slot 10: the focus flag goes; a box that had the focus tells the stage with the custom message of
   * `m_CustomMsgEditBoxFocusOut` (0x467), if it has one.  (The base class's `OnFocusOut` is not called: it only clears the flag, too.)
   */
  override onFocusOut(): void {
    const had = this.m_bHasFocus;
    this.m_bHasFocus = false;
    if (had && this.m_CustomMsgEditBoxFocusOut !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgEditBoxFocusOut);
  }

  /**
   * `ContainPTForEditBox(pt)` (329331C0): the point (the position `HandleMouse` worked out, in layout pixels) is inside the box's current quad: its
   * four corners moved by the dialog's position (the global null dialog's, (0, 0), for a box in no dialog) and the box's offset, each sum rounded to
   * a float; the test of `Pick2DRect`, with every step in single precision (see `CKTDGUIControl.containPTForEditBox`, which the IME box shares).
   */
  ContainPTForEditBox(x: number, y: number): boolean {
    return this.containPTForEditBox(x, y);
  }

  /**
   * `CopyToClipboard()` (32933460): with a selection, the clipboard is opened (a box that cannot do that does nothing), emptied, and given the
   * selected text as `CF_UNICODETEXT`.  The exe asks `GlobalAlloc` for room for the whole text and a NUL, locks it, copies the selection and sets the
   * block as the clipboard's data; it then frees the block, which the clipboard owns (an error, not modelled), and closes the clipboard.  A selection
   * that is not inside the text reads (and writes) outside the arrays: an error here (a selection that is the whole text and one more writes a
   * terminating NUL behind the block, too).
   */
  CopyToClipboard(): void {
    const caret = this.m_nCaret, start = this.m_nSelStart;
    if (caret === start) return;
    const clipboard = this.ctx.clipboard;
    if (!clipboard.open()) return;
    clipboard.empty();
    const text = this.m_Buffer.m_pwszBuffer;
    if (text === null) throw new Error("CKTDGUIEditBox::CopyToClipboard: the buffer is gone; the exe copies from a null pointer");
    const lo = Math.min(caret, start), hi = Math.max(caret, start);
    if (lo < 0 || hi > text.length + 1 || hi - lo > text.length) {
      throw new Error(`CKTDGUIEditBox::CopyToClipboard: the selection ${lo}..${hi} is not inside the text of ${text.length} characters; the exe reads and writes outside its arrays`);
    }
    clipboard.setText(untilNul(`${text}\0`.slice(lo, hi)));
    clipboard.close();
  }

  /**
   * `DeleteSelectionText()` (32933540): the caret goes to the start of the selection (`PlaceCaret`, which may move the first visible character),
   * the selection collapses to it, and the selected characters are removed.  Called with no selection it re-places the caret and removes nothing.
   */
  DeleteSelectionText(): void {
    const lo = Math.min(this.m_nCaret, this.m_nSelStart), hi = Math.max(this.m_nCaret, this.m_nSelStart);
    this.PlaceCaret(lo);
    this.m_nSelStart = this.m_nCaret;
    for (let i = lo; i < hi; i++) this.m_Buffer.RemoveChar(lo);
  }

  /**
   * `PasteFromClipboard()` (32934970): the selection is deleted first, whatever the clipboard holds.  Then the clipboard is opened (if it cannot be,
   * that is all); if it holds `CF_UNICODETEXT` that can be locked, the text goes in at the caret (`InsertString`, all of it: its limits may refuse)
   * and, when it was taken, the caret moves behind it; the selection collapses to the caret either way.  The clipboard is closed.
   */
  PasteFromClipboard(): void {
    this.DeleteSelectionText();
    const clipboard = this.ctx.clipboard;
    if (!clipboard.open()) return;
    const text = clipboard.getText();
    if (text !== null) {
      const caret = this.m_nCaret;
      if (this.m_Buffer.InsertString(caret, text, -1)) this.PlaceCaret(caret + wcslen(text));
      this.m_nSelStart = this.m_nCaret;
    }
    clipboard.close();
  }

  /** `ClearText()` (32933190), a member the scripts do not reach: the text is cleared, the first visible character, the caret and the selection are at the start */
  ClearText(): void {
    this.m_Buffer.Clear();
    this.m_nFirstVisible = 0;
    this.PlaceCaret(0);
    this.m_nSelStart = 0;
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
