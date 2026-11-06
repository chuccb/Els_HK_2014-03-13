/**
 * `CKTDGUIComboBox` (the Lua class `CKTDGUIComboBox`, a `CKTDGUIControl`): DXUT's `CDXUTComboBox` with a dropdown that can open upwards, a
 * "static" form (a fixed row height) and an optional scroll bar.  Constructor 3293B660: the defaults below, then `UI_Control_Sound.lua`
 * runs and the sounds of its globals `ComboBox_Mouse_Down` and `ComboBox_Mouse_Over` are opened.
 *
 * The Lua setters: the twelve texture setters (SetTextTex_LUA 32940C30, SetButtonTex_LUA 3293FC60, SetButtonMouseOverTex_LUA 3293FA70,
 * SetButtonMouseDownTex_LUA 3293F8E0, SetDropdownTex_LUA 3293FDF0, SetDropdownTextTex_LUA 3293FF80 and the six SetScollBar*Tex_LUA
 * 32940910 / 32940780 / 329402D0 / 32940140 / 329405F0 / 32940460), the seven that set a position or a size and call `UpdateRects`
 * (SetPos_LUA 32940110, SetSize_LUA 32940BA0, SetTextPos_LUA 32940BD0, SetTextSize_LUA 32940C00, SetButtonPos_LUA 3293FC00,
 * SetButtonSize_LUA 3293FC30, SetButtonAddSize 3293F8B0), the one-line setters (SetTextStringOffsetPos 328CE320, SetDropHeight 328CD3C0,
 * SetStaticHeight 328CE0A0, SetCustomMsg* 328CD2A0 / 328CD260 / 328CD110, SetReverseDropdown 328CDC30, SetSelectTextShow 328CDD90,
 * SetUnSelected 32940DC0), SetString_LUA 328CE0E0, AddItem_LUA 3293D190 / AddItemStrID_LUA 3293CB60 (-> AddItem 3293C990), AddControl
 * 3293C800, InitScrollBar_LUA 3293D840 and SetSelectedByIndex 32940AA0.
 *
 * Not ported: what the box does while the game runs (`MsgProc`, `HandleMouse`, `OnFrameMove`, `OnFrameRender`, `OnFrameRenderEnd`,
 * `OnFocusOut`, `OnHotkey`).  The virtual functions the Lua methods of the base class reach are the base class's: the box overrides only those
 * and `UpdateRects` (vtable slot 42, which is where `SetDropHeight` and the setters go).
 */
import type { CKTDGUIComboBox_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIM, UIPointData, readStringData } from "./control.ts";
import type { UIContext, UIStringData, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import { idiv, newRect, newVertices, offsetRect, setRect, copyRect } from "./rect.ts";
import type { Rect, VertexUI } from "./rect.ts";
import { CKTDGUIScrollBar } from "./scrollbar.ts";

const f = Math.fround;

/** `E_INVALIDARG` as the `long` a function returns */
const E_INVALIDARG = -2147024809;

/** `CKTDGUIComboBox::ComboBoxItem` (0x21C bytes): the text of a row (255 characters at most), what it stands for and the control it holds */
export interface ComboBoxItem {
  strText: string;
  pData: unknown;
  rcActive: Rect;
  bVisible: boolean;
  pControl: CKTDGUIControl | null;
}

/** the text a `wchar_t[256]` keeps: the characters up to a NUL, at most 255 */
const itemText = (text: string): string => {
  const nul = text.indexOf("\0");
  return (nul < 0 ? text : text.slice(0, nul)).slice(0, 255);
};

export class CKTDGUIComboBox extends CKTDGUIControl implements Partial<CKTDGUIComboBox_Methods> {
  m_iSelected = -1;
  m_iFocused = -1;
  m_nDropHeight = 100;
  m_nStaticHeight = 0;
  m_bIsStaticComboBox = false;
  m_ItemScriptName = "";
  m_nSBWidth = 16;
  m_bOpened = false;
  m_bPressed = false;
  m_bMouseOverCheck = false;
  readonly m_rcText: Rect = newRect();
  readonly m_rcButton: Rect = newRect();
  /** the constructor leaves it as the heap had it; zero here */
  readonly m_rcDropdown: Rect = newRect();
  readonly m_rcDropdownText: Rect = newRect();
  m_x = 0;
  m_y = 0;
  m_width = 0;
  m_height = 0;
  m_TextX = 0;
  m_TextY = 0;
  m_TextWidth = 0;
  m_TextHeight = 0;
  m_TextStringOffsetPosX = 5;
  m_TextStringOffsetPosY = 5;
  m_ButtonX = 0;
  m_ButtonY = 0;
  m_ButtonWidth = 0;
  m_ButtonHeight = 0;
  m_ButtonOffsetX = 0;
  m_ButtonOffsetY = 0;
  m_ButtonAddWidth = 0;
  m_ButtonAddHeight = 0;
  m_pTextTex: UITextureData | null = null;
  m_pButtonTex: UITextureData | null = null;
  m_pButtonMouseOverTex: UITextureData | null = null;
  m_pButtonMouseDownTex: UITextureData | null = null;
  m_pDropdownTex: UITextureData | null = null;
  m_pDropdownTextTex: UITextureData | null = null;
  m_pScollBarUpButtonTex: UITextureData | null = null;
  m_pScollBarUpButtonDownTex: UITextureData | null = null;
  m_pScollBarDownButtonTex: UITextureData | null = null;
  m_pScollBarDownButtonDownTex: UITextureData | null = null;
  m_pScollBarTrackTex: UITextureData | null = null;
  m_pScollBarThumbTex: UITextureData | null = null;
  readonly m_TempPoint = new UIPointData();
  m_pStringData: UIStringData | null = null;
  m_pScrollBar: CKTDGUIScrollBar | null = null;
  readonly m_rcBoundingBox: Rect = newRect();
  readonly m_rcBoundingBox2: Rect = newRect();
  readonly m_Vertex: VertexUI[] = newVertices();
  /** `CGrowableArray<ComboBoxItem*> m_Items` */
  readonly m_Items: ComboBoxItem[] = [];
  m_CustomMsgSelectionChanged = -1;
  m_CustomMsgOpenDropdown = -1;
  m_CustomMsgCloseDropdown = -1;
  m_bMousePointAdjust = false;
  m_bIsReverseDropDown = false;
  m_pSndButtonMouseDown: DeviceSound | undefined;
  m_pSndButtonMouseOver: DeviceSound | undefined;
  m_bSelectTextShow = true;
  m_iTextLimit = 0;

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.COMBOBOX;
    [this.m_pSndButtonMouseDown, this.m_pSndButtonMouseOver] = this.openControlSounds(["ComboBox_Mouse_Down", "ComboBox_Mouse_Over"]);
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [
      this.m_pTextTex, this.m_pButtonTex, this.m_pButtonMouseOverTex, this.m_pButtonMouseDownTex, this.m_pDropdownTex, this.m_pDropdownTextTex,
      this.m_pScollBarUpButtonTex, this.m_pScollBarUpButtonDownTex, this.m_pScollBarDownButtonTex, this.m_pScollBarDownButtonDownTex,
      this.m_pScollBarTrackTex, this.m_pScollBarThumbTex,
    ]) {
      if (t) out.push(t);
    }
  }

  // ---- the texture setters: the old UITextureData is destroyed, the new one (null when the file does not open) replaces it -------

  SetTextTex(file: string, key: string): void {
    this.m_pTextTex = this.replaceTexture(this.m_pTextTex, file, key);
  }

  SetButtonTex(file: string, key: string): void {
    this.m_pButtonTex = this.replaceTexture(this.m_pButtonTex, file, key);
  }

  SetButtonMouseOverTex(file: string, key: string): void {
    this.m_pButtonMouseOverTex = this.replaceTexture(this.m_pButtonMouseOverTex, file, key);
  }

  SetButtonMouseDownTex(file: string, key: string): void {
    this.m_pButtonMouseDownTex = this.replaceTexture(this.m_pButtonMouseDownTex, file, key);
  }

  SetDropdownTex(file: string, key: string): void {
    this.m_pDropdownTex = this.replaceTexture(this.m_pDropdownTex, file, key);
  }

  SetDropdownTextTex(file: string, key: string): void {
    this.m_pDropdownTextTex = this.replaceTexture(this.m_pDropdownTextTex, file, key);
  }

  SetScollBarUpButtonTex(file: string, key: string): void {
    this.m_pScollBarUpButtonTex = this.replaceTexture(this.m_pScollBarUpButtonTex, file, key);
  }

  SetScollBarUpButtonDownTex(file: string, key: string): void {
    this.m_pScollBarUpButtonDownTex = this.replaceTexture(this.m_pScollBarUpButtonDownTex, file, key);
  }

  SetScollBarDownButtonTex(file: string, key: string): void {
    this.m_pScollBarDownButtonTex = this.replaceTexture(this.m_pScollBarDownButtonTex, file, key);
  }

  SetScollBarDownButtonDownTex(file: string, key: string): void {
    this.m_pScollBarDownButtonDownTex = this.replaceTexture(this.m_pScollBarDownButtonDownTex, file, key);
  }

  SetScollBarTrackTex(file: string, key: string): void {
    this.m_pScollBarTrackTex = this.replaceTexture(this.m_pScollBarTrackTex, file, key);
  }

  SetScollBarThumbTex(file: string, key: string): void {
    this.m_pScollBarThumbTex = this.replaceTexture(this.m_pScollBarThumbTex, file, key);
  }

  // ---- positions and sizes: store, then recompute every rectangle ---------------------------------------------------------------

  SetPos(x: number, y: number): void {
    this.m_x = x | 0;
    this.m_y = y | 0;
    this.updateRects();
  }

  SetSize(width: number, height: number): void {
    this.m_width = width | 0;
    this.m_height = height | 0;
    this.updateRects();
  }

  SetTextPos(x: number, y: number): void {
    this.m_TextX = x | 0;
    this.m_TextY = y | 0;
    this.updateRects();
  }

  SetTextSize(width: number, height: number): void {
    this.m_TextWidth = width | 0;
    this.m_TextHeight = height | 0;
    this.updateRects();
  }

  SetButtonPos(x: number, y: number): void {
    this.m_ButtonX = x | 0;
    this.m_ButtonY = y | 0;
    this.updateRects();
  }

  SetButtonSize(width: number, height: number): void {
    this.m_ButtonWidth = width | 0;
    this.m_ButtonHeight = height | 0;
    this.updateRects();
  }

  SetButtonAddSize(addWidth: number, addHeight: number): void {
    this.m_ButtonAddWidth = addWidth | 0;
    this.m_ButtonAddHeight = addHeight | 0;
    this.updateRects();
  }

  /** `SetTextStringOffsetPos(x, y)` (328CE320): where the selected text starts inside the text rectangle (no `UpdateRects`) */
  SetTextStringOffsetPos(x: number, y: number): void {
    this.m_TextStringOffsetPosX = x | 0;
    this.m_TextStringOffsetPosY = y | 0;
  }

  /** `SetDropHeight(height)` (328CD3C0): then the virtual `UpdateRects` */
  SetDropHeight(height: number): void {
    this.m_nDropHeight = height | 0;
    this.updateRects();
  }

  /** `SetStaticHeight(height)` (328CE0A0): rows of a fixed height make it a static combo box */
  SetStaticHeight(height: number): void {
    this.m_bIsStaticComboBox = true;
    this.m_nStaticHeight = height | 0;
  }

  SetCustomMsgSelectionChanged(msg: number): void {
    this.m_CustomMsgSelectionChanged = msg | 0;
  }

  SetCustomMsgOpenDropdown(msg: number): void {
    this.m_CustomMsgOpenDropdown = msg | 0;
  }

  SetCustomMsgCloseDropdown(msg: number): void {
    this.m_CustomMsgCloseDropdown = msg | 0;
  }

  SetReverseDropdown(reverse: boolean): void {
    this.m_bIsReverseDropDown = reverse;
  }

  SetSelectTextShow(show: boolean): void {
    this.m_bSelectTextShow = show;
  }

  /** `SetUnSelected()` (32940DC0) */
  SetUnSelected(): void {
    this.m_iFocused = -1;
    this.m_iSelected = -1;
  }

  /** `SetString_LUA()` (328CE0E0): the string data (font, colour, ...) the table on top of the stack describes; the old one is not freed */
  SetString(): void {
    this.m_pStringData = readStringData(this.ctx);
  }

  // ---- the items ------------------------------------------------------------------------------------------------------------------

  /** `AddItem_LUA(const char*)` (3293D190): `AddItem(name, NULL, true)` */
  AddItem(name: string): void {
    this.addItem(name, null, true);
  }

  /** `AddItemStrID_LUA(int)` (3293CB60): the item is the string table's text (the debug-info variant is not ported) */
  AddItemStrID(index: number): void {
    const text = this.ctx.strings.get(index | 0);
    const nul = text.indexOf("\0"); // wcslen
    this.addItem(nul < 0 ? text : text.slice(0, nul), null, true);
  }

  /**
   * `AddItem(strText, pData, bSendChangeMsg)` (3293C990): a row is appended; the scroll bar learns the new length; the first row is selected
   * (and the selection message sent when asked to); without a scroll bar the dropdown gets the height of its rows (a static box:
   * `m_nStaticHeight` each; else a line of the string's font each: nothing changes while that font is not known) and the rectangles are
   * recomputed.  Returns the HRESULT.
   */
  addItem(text: string, data: unknown, bSendChangeMsg: boolean): number {
    this.m_Items.push({ strText: itemText(text), pData: data, rcActive: newRect(), bVisible: false, pControl: null });
    this.m_pScrollBar?.setTrackRange(0, this.m_Items.length);
    if (this.m_Items.length === 1) {
      this.m_iSelected = 0;
      this.m_iFocused = 0;
      if (bSendChangeMsg) this.sendSelectionChanged();
    }
    if (this.m_pScrollBar) return 0;
    let height: number;
    if (this.m_bIsStaticComboBox) {
      height = Math.imul(this.m_nStaticHeight, this.m_Items.length);
    } else {
      if (!this.m_pStringData) return 0;
      const font = this.ctx.fonts.getUKFont(this.m_pStringData.fontIndex);
      if (!font) return 0;
      height = Math.imul(this.m_Items.length, font.lineHeight());
    }
    this.m_nDropHeight = height;
    this.updateRects();
    return 0;
  }

  /**
   * `AddControl(pControl)` (3293C800): a row whose text is the control's name; the control learns its dialog.  The first row is selected
   * and the selection message is always sent.  Returns the HRESULT (an object that is not a control, which only a census run on typed stubs
   * can pass, is ignored).
   */
  AddControl(control: CKTDGUIControl | undefined): number {
    if (!(control instanceof CKTDGUIControl)) return 0;
    const item: ComboBoxItem = { strText: itemText(control.m_Name), pData: null, rcActive: newRect(), bVisible: false, pControl: null };
    control.setDialog(this.m_pDialog);
    item.pControl = control;
    this.m_Items.push(item);
    this.m_pScrollBar?.setTrackRange(0, this.m_Items.length);
    if (this.m_Items.length === 1) {
      this.m_iSelected = 0;
      this.m_iFocused = 0;
      this.sendSelectionChanged();
    }
    return 0;
  }

  /** `SetSelectedByIndex(index)` (32940AA0): an index outside the rows (also a negative one: the parameter is unsigned) is `E_INVALIDARG` */
  SetSelectedByIndex(index: number): number {
    if (index >>> 0 >= this.m_Items.length) return E_INVALIDARG;
    this.m_iSelected = index;
    this.m_iFocused = index;
    this.sendSelectionChanged();
    return 0;
  }

  /** the message of a changed selection: the script's custom message when it set one, else the generic control event 0 */
  private sendSelectionChanged(): void {
    const custom = this.m_CustomMsgSelectionChanged;
    if (custom === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 0);
    else this.sendInternelEvent(UIM.CUSTOM_MSG, custom);
  }

  /**
   * `InitScrollBar_LUA()` (3293D840): a scroll bar in the box's dialog that draws with the box's six scroll bar textures (the bar takes the
   * pointers over: it destroys them when it is replaced or destroyed).  The previous bar, if any, is forgotten, not freed.
   */
  InitScrollBar(): void {
    const bar = new CKTDGUIScrollBar(this.ctx);
    this.m_pScrollBar = bar;
    bar.setDialog(this.m_pDialog);
    bar.setDownButtonTex(this.m_pScollBarDownButtonTex);
    bar.setDownButtonDownTex(this.m_pScollBarDownButtonDownTex);
    bar.setUpButtonTex(this.m_pScollBarUpButtonTex);
    bar.setUpButtonDownTex(this.m_pScollBarUpButtonDownTex);
    bar.setTrackTex(this.m_pScollBarTrackTex);
    bar.setThumbTex(this.m_pScollBarThumbTex);
  }

  /**
   * `UpdateRects()` (32940DE0), virtual slot 42: the bounding box, the button (an explicit one, else a square at the right end made wider and
   * taller by `m_ButtonAdd*`), the text rectangle (an explicit one, else what is left of the box up to the button), the dropdown below (0.9 of
   * the text height down, `m_nDropHeight` high) or above (twice `m_nDropHeight` above the text) it, the text area inside the dropdown (10% off each
   * side, the scroll bar's width off the right) and the scroll bar, whose page is the number of rows that fit.
   */
  updateRects(): void {
    const bb = this.m_rcBoundingBox;
    let width = this.m_width;
    if (this.m_bIsStaticComboBox) width = (width + this.m_height) | 0;
    setRect(bb, this.m_x, this.m_y, this.m_x + width, this.m_y + this.m_height);

    const btn = this.m_rcButton;
    let buttonLeft: number;
    if (this.m_ButtonHeight !== 0 && this.m_ButtonWidth !== 0) {
      buttonLeft = this.m_ButtonX;
      btn.right = (this.m_ButtonX + this.m_ButtonWidth) | 0;
      btn.top = this.m_ButtonY;
      btn.bottom = (this.m_ButtonHeight + this.m_ButtonY) | 0;
    } else {
      copyRect(btn, bb);
      buttonLeft = (btn.top + btn.right - btn.bottom) | 0;
      btn.right = (btn.right + this.m_ButtonAddWidth) | 0;
      const half = idiv(this.m_ButtonAddHeight, 2);
      btn.top = (btn.top - half) | 0;
      btn.bottom = (btn.bottom + half) | 0;
    }
    btn.left = buttonLeft;

    const text = this.m_rcText;
    let textRight: number;
    if (this.m_TextHeight !== 0 && this.m_TextWidth !== 0) {
      text.top = this.m_TextY;
      text.left = this.m_TextX;
      textRight = (this.m_TextX + this.m_TextWidth) | 0;
      text.bottom = (this.m_TextHeight + this.m_TextY) | 0;
    } else {
      copyRect(text, bb);
      textRight = buttonLeft; // up to where the button begins
    }
    text.right = textRight;

    const drop = this.m_rcDropdown;
    copyRect(drop, text);
    let dropBottom: number;
    if (!this.m_bIsReverseDropDown) {
      offsetRect(drop, 0, Math.trunc(f(f((text.bottom - text.top) | 0) * f(0.9)))); // (int)(float)((float)h * 0.9f)
      dropBottom = (this.m_nDropHeight + drop.bottom) | 0;
    } else {
      dropBottom = text.top;
      drop.top = (drop.top - Math.imul(2, this.m_nDropHeight)) | 0;
    }
    drop.bottom = dropBottom;

    const dt = this.m_rcDropdownText;
    copyRect(dt, drop);
    const bar = this.m_pScrollBar;
    dt.left = (dt.left + Math.trunc(f(f((drop.right - drop.left) | 0) * f(0.1)))) | 0;
    let dtRight = (drop.right - Math.trunc(f(f((drop.right - drop.left) | 0) * f(0.1)))) | 0;
    if (bar) dtRight = (dtRight - bar.m_width) | 0;
    dt.right = dtRight;
    dt.top = (dt.top - Math.trunc(f(f((drop.bottom - drop.top) | 0) * f(-0.1)))) | 0;

    if (bar) {
      bar.m_x = drop.right;
      bar.m_y = (drop.top + 2) | 0;
      bar.updateRects();
      bar.m_width = this.m_nSBWidth;
      bar.m_height = (drop.bottom - drop.top - 2) | 0;
      bar.updateRects();
    }

    if (this.m_pStringData && bar) {
      const font = this.ctx.fonts.getUKFont(this.m_pStringData.fontIndex);
      const rows = (dt.bottom - dt.top) | 0;
      if (this.m_bIsStaticComboBox) {
        bar.m_nPageSize = idiv(rows, this.m_nStaticHeight);
      } else {
        if (!font) throw new Error("CKTDGUIComboBox::UpdateRects: no UK font for the string's font index; the exe dereferences null");
        bar.m_nPageSize = idiv(rows, font.lineHeight());
      }
      bar.cap();
      bar.updateThumbRect();
      bar.showItem(this.m_iSelected);
    }
  }
}
