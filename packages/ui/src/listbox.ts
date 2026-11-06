/**
 * `CKTDGUIListBox` (the Lua class `CKTDGUIListBox`, a `CKTDGUIControl`): DXUT's `CDXUTListBox` with a scroll bar of its own, group rows
 * (a plus / minus mark in front of the group's title), rows that hold a control (`CKTDGUIItem`) and rows of a fixed height.
 *
 * Constructor 329410D0: the defaults below; a `CKTDGUIStatic` (the group mark) with the two pictures of `DLG_Messenger.tga`, "Plus_Box" and
 * "Minus_Box", each as big as its texture plus `m_GroupMarkAddSize`; then `UI_Control_Sound.lua` runs and the sound of its global
 * `ListBox_Mouse_Down` is opened.  Not set by it (the heap as it was: zero here): `m_nTextHeight`, `m_dwStyle`, `m_nSelStart`.
 *
 * The Lua methods: the nine texture setters (SetButtonMouseOverTex_LUA 32947340, SetTextTex 329480B0, SetBoundingBoxTex 329471B0 and the six
 * scroll bar ones 329477B0 / 32947620 / 32947940 / 32947AD0 / 32947DF0 / 32947C60: each of the last eight is a function the linker folded
 * with the control list's setter of the same member offset), the setters that call `UpdateRects` (SetPos_LUA 328CDC00, SetSize_LUA 328CE050,
 * SetScrollBarWidth 328CDD50), the scroll bar's (SetScrollBarPos 328CDCF0, SetScrollBarSize 328CDD20: no check for a missing bar,
 * SetScrollBarTrackRange 32947FB0), the one-line setters (SetStaticHeight 328CE0C0, SetMultiSelection_LUA 328CD940, SetIgnoreListClick 328CD7F0,
 * SetCustomMsgSelection 328CD230, _End 328CD130, ItemDoubleClick 328CD170, SelectionByRButton 328CD290, SetUseItemDisappear 328CE370,
 * SetUpdateScrollBarOnUpdate 328CE360, SetScrollToEndOnUpdateRects 328CDD70, SetSelectItemAtMouseMove 328CDD80), SetString_LUA 328CE0F0 and
 * SetGroupString_LUA 328CD7C0, AddItem_LUA 32942A20, AddControl 329424B0 and InitScrollBar_LUA 32943870.
 *
 * Also ported, for the classes that own list boxes: the other `AddItem` (32942630, 32942840) and `AddString` (32942B00), GetItem, GetLastItem,
 * GetSelectedIndex, ClearSelect, SelectItem, RemoveItem, RemoveItemByText, RemoveAllItems, SetScrollBarEndPos, SetShowAllItems,
 * SetShowTimeAllItems, GetPos and the `SetDialog` override.
 *
 * Not ported: what the box does while the game runs (`MsgProc`, `HandleMouse`, `OnFrameMove`, `OnFrameRender`, `ContainsPoint`,
 * `SetMaximize`).  The virtual functions the Lua methods of the base class reach are the base class's: the box overrides only those and
 * `UpdateRects` (vtable slot 42, which is where the setters go), `SetDialog` (slot 15) and `GetPos` (slot 27).
 */
import { Color, Vec2 } from "@els/host";
import type { CKTDGUIListBox_Methods } from "@els/host";
import { CKTDGUIControl, CPictureData, UCT, UIM, UIPointData, readStringData, wcharText } from "./control.ts";
import type { CKTDGUIDialog } from "./dialog.ts";
import type { UIContext, UIStringData, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import type { UKFont } from "./font.ts";
import { copyRect, idiv, inflateRect, newRect, newVertices, setRect } from "./rect.ts";
import type { Rect, VertexUI } from "./rect.ts";
import { CKTDGUIScrollBar } from "./scrollbar.ts";
import { CKTDGUIItem, CKTDGUIStatic } from "./static.ts";

const f = Math.fround;

/** `CKTDGUIListBox::LIST_BOX_ITEM_TYPE` */
export const LBIT = { DEFAULT: 0, NOT_ENABLE: 1, GROUP_PLUS: 2, GROUP_MINUS: 3 } as const;

/** `CKTDGUIListBox::ListBoxItem` (0x26C bytes): a row.  Its constructor (32942000) sets what `AddItem` and the others do not. */
export interface ListBoxItem {
  strText: string;
  pData: unknown;
  rcActive: Rect;
  bSelected: boolean;
  pControl: CKTDGUIControl | null;
  itemType: number;
  itemDepth: number;
  bSpread: boolean;
  fSpreadTimeGap: number;
  iSpreadCount: number;
  fNowSpreadTime: number;
  m_bShow: boolean;
  m_fTimeLeftShow: number;
  m_color: Color;
  m_bColor: boolean;
  m_bMegaSelect: boolean;
  m_bMegaOver: boolean;
  m_bMyMessage: boolean;
  m_wstrData: string;
  m_iMessageID: number;
}

/** `ListBoxItem::ListBoxItem()` (32942000) */
function newListBoxItem(): ListBoxItem {
  return {
    strText: "", pData: null, rcActive: newRect(), bSelected: false, pControl: null, itemType: LBIT.DEFAULT, itemDepth: 0, bSpread: false,
    fSpreadTimeGap: 0, iSpreadCount: 0, fNowSpreadTime: 0, m_bShow: true, m_fTimeLeftShow: -1, m_color: new Color(1, 1, 1, 1), m_bColor: false,
    m_bMegaSelect: false, m_bMegaOver: false, m_bMyMessage: false, m_wstrData: "", m_iMessageID: -1,
  };
}

export class CKTDGUIListBox extends CKTDGUIControl implements Partial<CKTDGUIListBox_Methods> {
  readonly m_rcText: Rect = newRect();
  readonly m_rcSelection: Rect = newRect();
  m_pBoudingBoxTex: UITextureData | null = null;
  m_pTextTex: UITextureData | null = null;
  m_pButtonMouseOverTex: UITextureData | null = null;
  m_pScollBarUpButtonTex: UITextureData | null = null;
  m_pScollBarUpButtonDownTex: UITextureData | null = null;
  m_pScollBarDownButtonTex: UITextureData | null = null;
  m_pScollBarDownButtonDownTex: UITextureData | null = null;
  m_pScollBarTrackTex: UITextureData | null = null;
  m_pScollBarThumbTex: UITextureData | null = null;
  m_pStringData: UIStringData | null = null;
  m_pGroupStringData: UIStringData | null = null;
  m_pScrollBar: CKTDGUIScrollBar | null = null;
  m_nSBWidth = 16;
  m_nBorder = 6;
  m_nMargin = 5;
  m_nTextHeight = 0;
  /** `m_dwStyle`: bit 0 is the multi selection */
  m_dwStyle = 0;
  m_nSelected = -1;
  m_nSelStart = 0;
  m_bDrag = false;
  m_bShowTextTex = true;
  /** `CGrowableArray<ListBoxItem*> m_Items` */
  readonly m_Items: ListBoxItem[] = [];
  readonly m_TempPoint = new UIPointData();
  readonly m_Vertex: VertexUI[] = newVertices();
  readonly m_rcBoundingBox: Rect = newRect();
  m_x = 0;
  m_y = 0;
  m_width = 0;
  m_height = 0;
  m_CustomMsgItemDoubleClick = -1;
  m_CustomMsgSelection = -1;
  m_CustomMsgSelection_End = -1;
  m_CustomMsgSelectionByRButton = -1;
  m_bIsStaticListBox = false;
  m_ItemScriptName = "";
  m_pSndMouseDown: DeviceSound | undefined;
  /** `m_pUKFont`, `m_pGroupUKFont`: the fonts `SetString` / `SetGroupString` looked up (null: the id was not registered) */
  m_pUKFont: UKFont | null = null;
  m_pGroupUKFont: UKFont | null = null;
  m_bIgnoreListClick = false;
  m_BlankWidthByDepth = 5;
  m_BlankWidthToGroupMark = 10;
  readonly m_pGroupMark: CKTDGUIStatic;
  readonly m_GroupMarkOffsetPos = new Vec2(-10, -1);
  readonly m_GroupMarkAddSize = new Vec2(-2, -3);
  m_bUseItemDisappear = false;
  m_bUpdateScrollBarOnUpdate = true;
  m_bScrollToEndOnUpdateRects = false;
  m_bIsSelectItemAtMouseMove = false;

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.LISTBOX;
    const mark = new CKTDGUIStatic(ctx);
    this.m_pGroupMark = mark;
    mark.setDialog(null);
    for (const key of ["Plus_Box", "Minus_Box"]) {
      const picture = new CPictureData(ctx);
      picture.SetTex("DLG_Messenger.tga", key);
      picture.setDefaultPoint();
      picture.setSize(new Vec2(f(picture.size.x + this.m_GroupMarkAddSize.x), f(picture.size.y + this.m_GroupMarkAddSize.y)));
      mark.m_PictureDataList.push(picture);
    }
    [this.m_pSndMouseDown] = this.openControlSounds(["ListBox_Mouse_Down"]);
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [
      this.m_pBoudingBoxTex, this.m_pTextTex, this.m_pButtonMouseOverTex, this.m_pScollBarUpButtonTex, this.m_pScollBarUpButtonDownTex,
      this.m_pScollBarDownButtonTex, this.m_pScollBarDownButtonDownTex, this.m_pScollBarTrackTex, this.m_pScollBarThumbTex,
    ]) {
      if (t) out.push(t);
    }
  }

  /** `SetDialog(handle)` (329474D0), virtual slot 15: the box and its group mark belong to the dialog */
  override setDialog(dialog: CKTDGUIDialog | null): void {
    this.m_pDialog = dialog;
    this.m_pGroupMark.setDialog(dialog);
  }

  /** `GetPos()` (32942E20), virtual slot 27 (the base class's, 32924850, leaves its argument as it was): the position as floats */
  getPos(): Vec2 {
    return new Vec2(f(this.m_x), f(this.m_y));
  }

  // ---- the texture setters: the old UITextureData is destroyed, the new one (null when the file does not open) replaces it -------

  SetBoundingBoxTex(file: string, key: string): void {
    this.m_pBoudingBoxTex = this.replaceTexture(this.m_pBoudingBoxTex, file, key);
  }

  SetTextTex(file: string, key: string): void {
    this.m_pTextTex = this.replaceTexture(this.m_pTextTex, file, key);
  }

  SetButtonMouseOverTex(file: string, key: string): void {
    this.m_pButtonMouseOverTex = this.replaceTexture(this.m_pButtonMouseOverTex, file, key);
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

  // ---- positions and sizes ------------------------------------------------------------------------------------------------------

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

  SetScrollBarWidth(width: number): void {
    this.m_nSBWidth = width | 0;
    this.updateRects();
  }

  /** the scroll bar the setters below write to without asking whether there is one (the exe faults on a box that has none) */
  private bar(): CKTDGUIScrollBar {
    if (!this.m_pScrollBar) throw new Error("CKTDGUIListBox: no scroll bar (InitScrollBar was not called); the exe dereferences null here");
    return this.m_pScrollBar;
  }

  /** `SetScrollBarPos(x, y)` (328CDCF0) */
  SetScrollBarPos(x: number, y: number): void {
    const bar = this.bar();
    bar.m_x = x | 0;
    bar.m_y = y | 0;
    bar.updateRects();
  }

  /** `SetScrollBarSize(width, height)` (328CDD20) */
  SetScrollBarSize(width: number, height: number): void {
    const bar = this.bar();
    bar.m_width = width | 0;
    bar.m_height = height | 0;
    bar.updateRects();
  }

  /** `SetScrollBarTrackRange(start, end)` (32947FB0) */
  SetScrollBarTrackRange(start: number, end: number): void {
    this.m_pScrollBar?.setTrackRange(start | 0, end | 0);
  }

  /** `SetScrollBarEndPos()` (32947F80): the bar shows the end of the list */
  setScrollBarEndPos(): void {
    const bar = this.m_pScrollBar;
    if (!bar) return;
    bar.m_nPosition = bar.m_nEnd;
    bar.cap();
    bar.updateThumbRect();
  }

  // ---- one-line setters ---------------------------------------------------------------------------------------------------------

  /** `SetStaticHeight(height)` (328CE0C0): rows of a fixed height make it a static list box */
  SetStaticHeight(height: number): void {
    this.m_bIsStaticListBox = true;
    this.m_nTextHeight = height | 0;
  }

  /** `SetMultiSelection_LUA()` (328CD940): the style is the multi selection (it takes no argument) */
  SetMultiSelection(): void {
    this.m_dwStyle = 1;
  }

  SetIgnoreListClick(ignore: boolean): void {
    this.m_bIgnoreListClick = ignore;
  }

  SetCustomMsgSelection(msg: number): void {
    this.m_CustomMsgSelection = msg | 0;
  }

  SetCustomMsgSelection_End(msg: number): void {
    this.m_CustomMsgSelection_End = msg | 0;
  }

  SetCustomMsgItemDoubleClick(msg: number): void {
    this.m_CustomMsgItemDoubleClick = msg | 0;
  }

  SetCustomMsgSelectionByRButton(msg: number): void {
    this.m_CustomMsgSelectionByRButton = msg | 0;
  }

  SetUseItemDisappear(use: boolean): void {
    this.m_bUseItemDisappear = use;
  }

  SetUpdateScrollBarOnUpdate(update: boolean): void {
    this.m_bUpdateScrollBarOnUpdate = update;
  }

  SetScrollToEndOnUpdateRects(toEnd: boolean): void {
    this.m_bScrollToEndOnUpdateRects = toEnd;
  }

  SetSelectItemAtMouseMove(atMove: boolean): void {
    this.m_bIsSelectItemAtMouseMove = atMove;
  }

  // ---- strings ------------------------------------------------------------------------------------------------------------------

  /** `SetString_LUA()` (328CE0F0): `SetString(SetStringData_())`; the box's font is the UK font of the string's font index (null if there is none) */
  SetString(): void {
    this.setString(readStringData(this.ctx));
  }

  /** `SetString(pString)` (32948050) */
  setString(data: UIStringData): void {
    this.m_pStringData = data;
    this.m_pUKFont = this.ctx.fonts.getUKFont(data.fontIndex);
  }

  /** `SetGroupString_LUA()` (328CD7C0) */
  SetGroupString(): void {
    this.setGroupString(readStringData(this.ctx));
  }

  /** `SetGroupString(pString)` (32947500) */
  setGroupString(data: UIStringData): void {
    this.m_pGroupStringData = data;
    this.m_pGroupUKFont = this.ctx.fonts.getUKFont(data.fontIndex);
  }

  // ---- the rows -----------------------------------------------------------------------------------------------------------------

  /** a row joins the list; the scroll bar learns the new length.  Returns the HRESULT. */
  private append(item: ListBoxItem): number {
    this.m_Items.push(item);
    this.m_pScrollBar?.setTrackRange(0, this.m_Items.length);
    return 0;
  }

  /** `AddItem_LUA(const char*)` (32942A20): `AddItem(text, NULL, 0, LBIT_DEFAULT, false, 0.0f)` */
  AddItem(name: string): void {
    this.addItem(name, null, 0, LBIT.DEFAULT, false, 0);
  }

  /** `AddItem(wszText, pData, itemDepth, itemType, bSpread, fSpreadTime)` (32942840) */
  addItem(text: string, data: unknown, itemDepth: number, itemType: number, bSpread: boolean, fSpreadTime: number): number {
    const item = newListBoxItem();
    item.strText = wcharText(text);
    item.pData = data;
    item.itemDepth = itemDepth | 0;
    item.itemType = itemType | 0;
    item.bSpread = bSpread;
    item.fSpreadTimeGap = f(fSpreadTime);
    return this.append(item);
  }

  /** `AddItem(wszText, pData, iMessageID, wstrName, bIsMine)` (32942630): a row of a message list */
  addMessageItem(text: string, data: unknown, iMessageID: number, wstrName: string, bIsMine: boolean): number {
    const item = newListBoxItem();
    item.strText = wcharText(text);
    item.pData = data;
    item.m_iMessageID = iMessageID | 0;
    item.m_wstrData = wstrName;
    item.m_bMyMessage = bIsMine;
    return this.append(item);
  }

  /** `AddString(wszText, aColor, pData, pControl)` (32942B00): a coloured row */
  addString(text: string, color: Color, data: unknown, control: CKTDGUIControl | null): number {
    const item = newListBoxItem();
    item.strText = wcharText(text);
    item.pData = data;
    item.pControl = control;
    item.m_bColor = true;
    item.m_color = new Color(color.r, color.g, color.b, color.a);
    return this.append(item);
  }

  /**
   * `AddControl(pItem)` (329424B0): a row whose text is the item's name (255 characters at most); the item learns the box's dialog and the
   * row holds it.  Returns the HRESULT (an object that is not an item, which only a census run on typed stubs can pass, is ignored).
   */
  AddControl(item: CKTDGUIItem | undefined): number {
    if (!(item instanceof CKTDGUIItem)) return 0;
    const row = newListBoxItem();
    row.strText = wcharText(item.m_Name);
    item.setDialog(this.m_pDialog);
    row.pControl = item;
    return this.append(row);
  }

  /** `GetItem(nIndex)` (32942DD0) */
  getItem(index: number): ListBoxItem | null {
    return index < 0 || index >= this.m_Items.length ? null : this.m_Items[index]!;
  }

  /** `GetLastItem()` (32942E00) */
  getLastItem(): ListBoxItem | null {
    return this.m_Items[this.m_Items.length - 1] ?? null;
  }

  /**
   * `GetSelectedIndex(nPreviousSelected)` (32942E40): the selected row; with the multi selection the first selected row after the previous
   * one (-1: there is none)
   */
  getSelectedIndex(previous: number): number {
    if (previous < -1) return -1;
    if ((this.m_dwStyle & 1) === 0) return this.m_nSelected;
    for (let i = previous + 1; i < this.m_Items.length; i++) if (this.m_Items[i]!.bSelected) return i;
    return -1;
  }

  /** `ClearSelect()` (32942CC0) */
  clearSelect(): void {
    this.m_nSelected = -1;
    for (const item of this.m_Items) item.m_bMegaSelect = false;
  }

  /** the message of a changed selection: the script's custom message when it set one, else the generic control event with `wParam` */
  private sendSelection(wParam: number): void {
    const custom = this.m_CustomMsgSelection;
    if (custom === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, wParam);
    else this.sendInternelEvent(UIM.CUSTOM_MSG, custom);
  }

  /** `SelectItem(nNewIndex, bSendMessage)` (329470F0): the index is clamped into the list; a list without rows ignores the call */
  selectItem(index: number, sendMessage: boolean): void {
    const count = this.m_Items.length;
    if (count === 0) return;
    const previous = this.m_nSelected;
    let now = index | 0;
    if (now < 0) now = 0;
    if (now >= count) now = count - 1;
    this.m_nSelected = now;
    if (previous !== now) {
      if ((this.m_dwStyle & 1) !== 0) this.m_Items[now]!.bSelected = true;
      this.m_nSelStart = now;
      this.m_pScrollBar?.showItem(now);
    }
    if (sendMessage) this.sendSelection(1);
  }

  /** the tail of `RemoveItem`: the scroll bar learns the length, the selection is kept inside the list and the selection message sent */
  private afterRemove(): void {
    const count = this.m_Items.length;
    this.m_pScrollBar?.setTrackRange(0, count);
    if (this.m_nSelected >= count) this.m_nSelected = count - 1;
    this.sendSelection(1);
  }

  /** `RemoveItem(nIndex)` (32946E90): an index outside the list does nothing */
  removeItem(index: number): void {
    if (index < 0 || index >= this.m_Items.length) return;
    this.m_Items.splice(index, 1)[0]!.pControl = null; // the row's control is destroyed
    this.afterRemove();
  }

  /** `RemoveItemByText(wszText)` (32946F90): every row with that text goes; returns how many */
  removeItemByText(text: string): number {
    let removed = 0;
    for (let i = 0; i < this.m_Items.length; i++) {
      if (this.m_Items[i]!.strText !== text) continue;
      this.m_Items.splice(i, 1);
      this.afterRemove();
      i--;
      removed++;
    }
    return removed;
  }

  /** `RemoveAllItems()` (32946DE0): the list is empty, the scroll bar's range 0..1 and nothing selected (no message) */
  removeAllItems(): void {
    for (const item of this.m_Items) item.pControl = null; // the rows' controls are destroyed
    this.m_Items.length = 0;
    this.m_pScrollBar?.setTrackRange(0, 1);
    this.m_nSelected = -1;
  }

  /** `SetShowAllItems(bShow)` (32947FD0) */
  setShowAllItems(show: boolean): void {
    for (const item of this.m_Items) {
      item.m_bShow = show;
      item.m_fTimeLeftShow = -1;
    }
  }

  /** `SetShowTimeAllItems(fTimeLeft)` (32948010) */
  setShowTimeAllItems(timeLeft: number): void {
    for (const item of this.m_Items) item.m_fTimeLeftShow = f(timeLeft);
  }

  // ---- the scroll bar -----------------------------------------------------------------------------------------------------------

  /**
   * `InitScrollBar_LUA()` (32943870): a scroll bar in the box's dialog that draws with the box's six scroll bar textures (the bar takes the
   * pointers over: it destroys them when it is replaced or destroyed).  The script gets the bar back.  The previous bar, if any, is
   * forgotten, not freed.
   */
  InitScrollBar(): CKTDGUIScrollBar {
    const bar = new CKTDGUIScrollBar(this.ctx);
    this.m_pScrollBar = bar;
    bar.setDialog(this.m_pDialog);
    bar.setDownButtonTex(this.m_pScollBarDownButtonTex);
    bar.setUpButtonTex(this.m_pScollBarUpButtonTex);
    bar.setDownButtonDownTex(this.m_pScollBarDownButtonDownTex);
    bar.setUpButtonDownTex(this.m_pScollBarUpButtonDownTex);
    bar.setTrackTex(this.m_pScollBarTrackTex);
    bar.setThumbTex(this.m_pScollBarThumbTex);
    return bar;
  }

  /**
   * `UpdateRects()` (32948240), virtual slot 42: the bounding box; the selection area inside it (the scroll bar's width off the right; a
   * non-static box also `m_nBorder` off every side) and the text area inside that (a non-static box: `m_nMargin` off left and right); the
   * scroll bar, which is put at the right edge of the box and as high as it, and whose page is the number of rows that fit the text area,
   * is told to show the end of the list (`m_bScrollToEndOnUpdateRects`) or the selected row.  A string whose font is not registered is a
   * message box ("font未獲登記。", "list box error") and the end of the function; no string at all is a null dereference.
   */
  updateRects(): void {
    const bb = this.m_rcBoundingBox;
    setRect(bb, this.m_x, this.m_y, this.m_x + this.m_width, this.m_y + this.m_height);
    copyRect(this.m_rcSelection, bb);
    this.m_rcSelection.right = (this.m_rcSelection.right - this.m_nSBWidth) | 0;
    if (!this.m_bIsStaticListBox) inflateRect(this.m_rcSelection, -this.m_nBorder, -this.m_nBorder);
    copyRect(this.m_rcText, this.m_rcSelection);
    if (!this.m_bIsStaticListBox) inflateRect(this.m_rcText, -this.m_nMargin, 0);

    const data = this.m_pStringData;
    if (!data) throw new Error("CKTDGUIListBox::UpdateRects: no string data (SetString was not called); the exe dereferences null");
    const font = this.ctx.fonts.getUKFont(data.fontIndex);
    if (!font) {
      this.ctx.messageBox(this.ctx.strings.get(954), this.ctx.strings.get(955));
      return;
    }

    const bar = this.m_pScrollBar;
    if (bar && this.m_bUpdateScrollBarOnUpdate) {
      bar.m_x = bb.right;
      bar.m_y = bb.top;
      bar.updateRects();
      bar.m_width = this.m_nSBWidth;
      bar.m_height = this.m_height;
      bar.updateRects();
    }
    if (bar) {
      const rows = (this.m_rcText.bottom - this.m_rcText.top) | 0;
      bar.m_nPageSize = idiv(rows, this.m_bIsStaticListBox ? this.m_nTextHeight : font.lineHeight());
      bar.cap();
      bar.updateThumbRect();
      if (this.m_bScrollToEndOnUpdateRects) {
        bar.m_nPosition = bar.m_nEnd;
        bar.cap();
        bar.updateThumbRect();
      } else {
        bar.showItem(this.m_nSelected);
      }
    }
  }
}
