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
 * `OnFrameMove` (32943980), `OnFrameRender` (32943BA0, see `onFrameRender`) and `ContainsPoint` (32942D10: the quadrilateral, then the
 * bounding box of the scroll bar) are ported.  Not ported: what the box does with the input while the game runs (`HandleMouse` 32942EA0,
 * `MsgProc` 32943960) and `SetMaximize`.  The virtual functions the Lua methods of the base class reach are the base class's: the box overrides only those and
 * `UpdateRects` (vtable slot 42, which is where the setters go), `SetDialog` (slot 15) and `GetPos` (slot 27).
 */
import { Color, Vec2 } from "@els/host";
import type { CKTDGUIListBox_Methods } from "@els/host";
import { CKTDGUIControl, CPictureData, UCT, UIM, UIPointData, destroyTexture, readStringData, wcharText } from "./control.ts";
import type { CKTDGUIDialog } from "./dialog.ts";
import type { UIContext, UIStringData, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import { packColor } from "./font.ts";
import type { ColorF, UKFont } from "./font.ts";
import { pick2DRect, pick2DRectOfRect } from "./pick.ts";
import { copyRect, ftoi, idiv, inflateRect, newRect, offsetRect, setRect } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { VertexUI4 } from "./render.ts";
import { CKTDGUIScrollBar } from "./scrollbar.ts";
import { CKTDGUIItem, CKTDGUIStatic } from "./static.ts";
import { channel, dialogOf, stringPosition } from "./stringdraw.ts";

const f = Math.fround;

/** the line space of the text of a row: `OutTextMultiline(…, 0.8f, …)` */
const LINE_SPACE = f(0.8);

/** a copy of a rectangle */
function rectOf(src: Rect): Rect {
  const rc = newRect();
  copyRect(rc, src);
  return rc;
}

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
  /** `m_Vertex[4]`: the quad being drawn */
  readonly m_Vertex = new VertexUI4();
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
  /** the group mark (a static); the destructor deletes it (the exe then holds null: only a destroyed box has none, so the type has no null) */
  m_pGroupMark: CKTDGUIStatic;
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

  /**
   * `~CKTDGUIListBox` (329420E0), then the control's.  The control of every row is deleted (its own destructor) and the rows freed; the scroll
   * bar is told the track 0..1 and nothing is selected; the bounding box and text textures, both string data and the scroll bar are destroyed
   * (the bar before the six scroll bar textures it holds, which the box then destroys), then the mouse over texture, the six scroll bar
   * textures, the sound, the group mark (a static: its pictures' textures and its edge texture go) and the two fonts are let go.
   */
  override Destroy(): void {
    const devices = this.ctx.devices;
    for (const item of this.m_Items) {
      if (item.pControl) {
        item.pControl.Destroy();
        item.pControl = null;
      }
    }
    this.m_Items.length = 0;
    this.m_pScrollBar?.setTrackRange(0, 1);
    this.m_nSelected = -1;
    this.m_pBoudingBoxTex = destroyTexture(devices, this.m_pBoudingBoxTex);
    this.m_pTextTex = destroyTexture(devices, this.m_pTextTex);
    this.m_pStringData = null;
    this.m_pGroupStringData = null;
    if (this.m_pScrollBar) {
      this.m_pScrollBar.Destroy();
      this.m_pScrollBar = null;
    }
    this.m_pButtonMouseOverTex = destroyTexture(devices, this.m_pButtonMouseOverTex);
    this.m_pScollBarDownButtonTex = destroyTexture(devices, this.m_pScollBarDownButtonTex);
    this.m_pScollBarDownButtonDownTex = destroyTexture(devices, this.m_pScollBarDownButtonDownTex);
    this.m_pScollBarUpButtonDownTex = destroyTexture(devices, this.m_pScollBarUpButtonDownTex);
    this.m_pScollBarUpButtonTex = destroyTexture(devices, this.m_pScollBarUpButtonTex);
    this.m_pScollBarTrackTex = destroyTexture(devices, this.m_pScollBarTrackTex);
    this.m_pScollBarThumbTex = destroyTexture(devices, this.m_pScollBarThumbTex);
    this.m_pSndMouseDown = this.closeHeldDevice(this.m_pSndMouseDown);
    this.m_pGroupMark.Destroy();
    this.m_pGroupMark = null as never;
    this.m_pUKFont = null;
    this.m_pGroupUKFont = null;
    super.Destroy();
  }

  /**
   * `ContainsPoint` (32942D10), virtual: the point is inside the box's quadrilateral (`m_NowPoint`) or inside the bounding box of its scroll
   * bar (`Pick2DRect` on the four corners of the integer rectangle).  The exe does not look whether the box has a scroll bar when the point is
   * outside the box: no bar is a null dereference there, and an error here.
   */
  override containsPoint(x: number, y: number): boolean {
    const p = this.m_NowPoint;
    if (pick2DRect(x, y, p.leftTopPoint, p.rightTopPoint, p.leftBottomPoint, p.rightBottomPoint)) return true;
    const bar = this.m_pScrollBar;
    if (!bar) throw new Error("CKTDGUIListBox::ContainsPoint: the box has no scroll bar (the exe reads its bounding box through a null pointer)");
    return pick2DRectOfRect(x, y, bar.m_rcBoundingBox);
  }

  /**
   * `OnFrameMove` (32943980): a shown and enabled list box moves its group mark (a static), runs the control's and its scroll bar's, and takes its
   * bounding box, moved right by the bar's width, as its current point (ints).  Each row then counts down its show time (`m_fTimeLeftShow`; the row
   * is hidden when it runs out), spreads its text (`bSpread`: one more character each `fSpreadTimeGap`; no colour codes are skipped here) and moves its control.
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!this.m_bShow || !this.m_bEnable) return 0;
    this.m_pGroupMark.onFrameMove(fTime, fElapsedTime);
    super.onFrameMove(fTime, fElapsedTime);
    const bar = this.m_pScrollBar;
    bar?.onFrameMove(fTime, fElapsedTime);
    const b = this.m_rcBoundingBox;
    let left = b.left, right = b.right;
    if (bar) {
      left = (left + bar.m_width) | 0;
      right = (right + bar.m_width) | 0;
    }
    const p = this.m_NowPoint;
    p.leftTopPoint.y = b.top;
    p.rightTopPoint.y = b.top;
    p.leftTopPoint.x = left;
    p.rightTopPoint.x = right;
    p.leftBottomPoint.x = left;
    p.leftBottomPoint.y = b.bottom;
    p.rightBottomPoint.x = right;
    p.rightBottomPoint.y = b.bottom;
    const dt = Math.fround(fElapsedTime);
    for (let i = 0; i < this.m_Items.length; i++) {
      const item = this.m_Items[i]!;
      if (item.m_fTimeLeftShow > 0) {
        const t = Math.fround(item.m_fTimeLeftShow - dt);
        item.m_fTimeLeftShow = t;
        if (t < 0) {
          item.m_fTimeLeftShow = 0;
          item.m_bShow = false;
        }
      }
      if (item.bSpread) {
        if (item.iSpreadCount >= item.strText.length) {
          item.bSpread = false;
        } else {
          const t = Math.fround(dt + item.fNowSpreadTime);
          item.fNowSpreadTime = t;
          if (t > item.fSpreadTimeGap) {
            item.fNowSpreadTime = 0;
            item.iSpreadCount = (item.iSpreadCount + 1) | 0;
          }
        }
      }
      item.pControl?.onFrameMove(fTime, fElapsedTime);
    }
    return 0;
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

  /** `if (row->pControl != nullptr) { delete row->pControl; row->pControl = nullptr; }` of the three removals and the destructor */
  private destroyRowControl(row: ListBoxItem): void {
    if (row.pControl) {
      row.pControl.Destroy();
      row.pControl = null;
    }
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
    this.destroyRowControl(this.m_Items[index]!);
    this.m_Items.splice(index, 1);
    this.afterRemove();
  }

  /** `RemoveItemByText(wszText)` (32946F90): every row with that text goes; returns how many */
  removeItemByText(text: string): number {
    let removed = 0;
    for (let i = 0; i < this.m_Items.length; i++) {
      if (this.m_Items[i]!.strText !== text) continue;
      this.destroyRowControl(this.m_Items[i]!);
      this.m_Items.splice(i, 1);
      this.afterRemove();
      i--;
      removed++;
    }
    return removed;
  }

  /** `RemoveAllItems()` (32946DE0): the list is empty, the scroll bar's range 0..1 and nothing selected (no message) */
  removeAllItems(): void {
    for (const item of this.m_Items) this.destroyRowControl(item);
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
   * `InitScrollBar_LUA()` (32943870): a scroll bar in the box's dialog that draws with the box's six scroll bar textures (the bar holds the
   * same pointers: its own setters destroy the pointer they replace, its destructor does not).  The script gets the bar back.  The previous
   * bar, if any, is forgotten, not freed.
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

  // ---- drawing ------------------------------------------------------------------------------------------------------------------

  /** the four corners of `m_TempPoint` (the exe sets the eight floats one by one) */
  private setCorners(left: number, top: number, right: number, bottom: number): UIPointData {
    const p = this.m_TempPoint;
    p.leftTopPoint.set(left, top);
    p.rightTopPoint.set(right, top);
    p.leftBottomPoint.set(left, bottom);
    p.rightBottomPoint.set(right, bottom);
    return p;
  }

  /** `UpdateVertex` and `RenderVertex(m_Vertex, &m_TempPoint, 1)`: the quad of `m_TempPoint` */
  private drawTempPoint(): void {
    this.updateVertex(this.m_Vertex, this.m_TempPoint);
    this.renderVertex(this.m_Vertex, this.m_TempPoint, 1);
  }

  /**
   * `OnFrameRender` (32943BA0).  A shown box draws, in this order,
   *  1. its bounding box (`m_rcBoundingBox` with `m_pBoudingBoxTex`: the point keeps the texture it had when the box has none);
   *  2. with at least one row AND a scroll bar (without a bar no row is drawn at all):
   *     - the first time any list box is drawn (the exe's `static bool bSBInit_0`, `ctx.statics`) the page size of its bar: the height of
   *       the text rectangle over `m_nTextHeight` (the whole height when that is 0), then `Cap` and `UpdateThumbRect`; the flag is set
   *       even by a box without a bar;
   *     - a bar whose position is below 0 is set to 0 (`SetTrackPos`);
   *     - the mouse-over pass (`updateMegaOver`);
   *     - the rows, from the bar's position while they fit in the text rectangle (`drawRows`);
   *  3. the scroll bar.
   * A box without string data is the exe's null dereference (the port throws); a font that does not exist is a message box (strings
   * 954 and 955) and nothing is drawn.  The rows are as high as the line of the dialog manager's UK font of the string data's font
   * index (`m_nTextHeight` is set to it each frame); the text is drawn by the box's own fonts (`m_pUKFont`, `m_pGroupUKFont`).
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    const data = this.m_pStringData;
    if (!data) throw new Error("CKTDGUIListBox::OnFrameRender: no string data (SetString was not called); the exe dereferences null");
    const font = this.ctx.fonts.getUKFont(data.fontIndex);
    if (!font) {
      this.ctx.messageBox(this.ctx.strings.get(954), this.ctx.strings.get(955));
      return 0;
    }
    const bb = this.m_rcBoundingBox;
    const point = this.setCorners(bb.left, bb.top, bb.right, bb.bottom);
    if (this.m_pBoudingBoxTex) point.pUITextureData = this.m_pBoudingBoxTex;
    this.drawTempPoint();
    if (this.m_Items.length > 0) this.drawItems(font);
    this.m_pScrollBar?.onFrameRender();
    return 0;
  }

  /** the part of `OnFrameRender` that needs a row: the page size of the bar (once), the mouse pass and the rows */
  private drawItems(font: UKFont): void {
    const text = this.m_rcText;
    const rc = rectOf(text);
    if (!this.m_bIsStaticListBox) {
      rc.bottom = (rc.top + font.lineHeight()) | 0;
      this.m_nTextHeight = (rc.bottom - rc.top) | 0;
    } else {
      rc.bottom = (rc.top + this.m_nTextHeight) | 0;
    }
    const bar = this.m_pScrollBar;
    const statics = this.ctx.statics;
    if (!statics.bSBInit_0) {
      if (bar) {
        const height = (text.bottom - text.top) | 0;
        bar.m_nPageSize = this.m_nTextHeight !== 0 ? idiv(height, this.m_nTextHeight) : height;
        bar.cap();
        bar.updateThumbRect();
      }
      statics.bSBInit_0 = true;
    }
    if (!bar) return;
    if (bar.m_nPosition < 0) bar.setTrackPos(0);
    this.updateMegaOver(bar, rectOf(rc));
    this.drawRows(bar, rectOf(text), font);
  }

  /**
   * The first pass over the rows (a copy of the loop of `drawRows` that draws nothing): for each shown row of a box that is not a
   * multi selection and has a message id (`m_iMessageID > -1`, the rows of the messenger), the mouse (`GetXPos`, `GetYPos` of the
   * DirectInput mouse over the resolution scale, minus the dialog's position) is tested against the row's rectangle: from
   * `m_rcSelection.left` to the box's `GetPos().x + m_width`, the row's top and bottom.  The row under the mouse makes every row from the
   * bar's position on with its message id (and not `m_bMyMessage`) `m_bMegaOver` and ends the pass; a row that is not under it is
   * `m_bMegaOver = false`.
   */
  private updateMegaOver(bar: CKTDGUIScrollBar, rc: Rect): void {
    const size = this.m_Items.length;
    let i = bar.m_nPosition;
    if (i >= size) return;
    while (rc.bottom <= this.m_rcText.bottom) {
      const item = this.m_Items[i]!;
      if (item.m_bShow && (this.m_dwStyle & 1) === 0 && item.m_iMessageID > -1) {
        const scale = this.ctx.render?.resolutionScale;
        const dialog = dialogOf(this);
        const mouse = this.ctx.mouse;
        const x = f(f(f(mouse.GetXPos()) / (scale ? scale.x : 1)) - dialog.m_Pos.x);
        const y = f(f(f(mouse.GetYPos()) / (scale ? scale.y : 1)) - dialog.m_Pos.y);
        const right = f(f(this.m_width) + this.getPos().x);
        if (x > f(this.m_rcSelection.left) && right > x && y > f(rc.top) && f(rc.bottom) > y) {
          const id = item.m_iMessageID;
          for (let j = bar.m_nPosition; j < this.m_Items.length; j++) {
            const other = this.m_Items[j]!;
            other.m_bMegaOver = id === other.m_iMessageID && !other.m_bMyMessage;
          }
          break;
        }
        item.m_bMegaOver = false;
      }
      offsetRect(rc, 0, this.m_nTextHeight);
      if (++i >= size) break;
    }
  }

  /**
   * Whether a row of a multi selection is drawn selected: a row of the range the mouse is dragging over (from `m_nSelStart` to
   * `m_nSelected`, the start itself and the far end excluded or included as the exe's three comparisons say) has the state the row
   * under `m_nSelStart` has, any other its own.
   */
  private multiSelected(i: number, item: ListBoxItem): boolean {
    if (this.m_bDrag) {
      let fromStart: boolean;
      if (i < this.m_nSelected) fromStart = i > this.m_nSelStart;
      else if (i < this.m_nSelStart) fromStart = true;
      else if (i <= this.m_nSelected) fromStart = i > this.m_nSelStart;
      else fromStart = false;
      if (fromStart) return this.m_Items[this.m_nSelStart]!.bSelected;
    }
    return item.bSelected;
  }

  /**
   * The rows: from the bar's position, each shown row (a hidden one takes its place and nothing else) inside the text rectangle,
   * `m_nTextHeight` high.  A row is highlighted when the box is not a multi selection and the row is `m_bMegaSelect`, `m_bMegaOver` or
   * the selected one, and in a multi selection when it is selected (`multiSelected`).
   *  - A static box (`m_bIsStaticListBox`) puts the row's control at the corner of the text rectangle, or at the selection's left for a
   *    highlighted row, and draws it (a row without a control draws nothing).
   *  - Otherwise a highlighted row of type DEFAULT or NOT_ENABLE first draws the quad of the selection (`m_rcSelection.left`, the row's
   *    top and bottom, `m_rcSelection.right` plus the bar's width **once more for every highlighted row so far**; to `GetPos().x +
   *    m_width` for a row that is `m_bMegaSelect` or `m_bMegaOver`) with `m_pTextTex`, or `m_pButtonMouseOverTex` for a row that is only
   *    `m_bMegaOver`, when `m_bShowTextTex`; then every row draws its text (`drawRowString`) if the box has string data.
   */
  private drawRows(bar: CKTDGUIScrollBar, rc: Rect, font: UKFont): void {
    const size = this.m_Items.length;
    const left = this.m_rcSelection.left;
    let selectionRight = this.m_rcSelection.right;
    rc.bottom = this.m_bIsStaticListBox ? (rc.top + this.m_nTextHeight) | 0 : (rc.top + font.lineHeight()) | 0;
    let i = bar.m_nPosition;
    if (i >= size) return;
    while (rc.bottom <= this.m_rcText.bottom) {
      const item = this.m_Items[i]!;
      if (item.m_bShow) {
        const highlighted = (this.m_dwStyle & 1) === 0 ? item.m_bMegaSelect || item.m_bMegaOver || i === this.m_nSelected : this.multiSelected(i, item);
        if (!highlighted) {
          if (this.m_bIsStaticListBox) this.drawRowControl(item, rc.left, rc.top);
          else if (this.m_pStringData) this.drawRowString(item, rc);
        } else {
          selectionRight = (selectionRight + bar.m_width) | 0;
          if (this.m_bIsStaticListBox) {
            this.drawRowControl(item, left, rc.top);
          } else {
            if (item.itemType >>> 0 <= LBIT.NOT_ENABLE && this.m_bShowTextTex) {
              const point = this.setCorners(left, rc.top, selectionRight, rc.bottom);
              if (item.m_bMegaSelect || item.m_bMegaOver) {
                const right = f(f(this.m_width) + this.getPos().x);
                point.rightTopPoint.x = right;
                point.rightBottomPoint.x = right;
              }
              if (this.m_pTextTex) point.pUITextureData = this.m_pTextTex;
              if (this.m_pButtonMouseOverTex && item.m_bMegaOver && !item.m_bMegaSelect) point.pUITextureData = this.m_pButtonMouseOverTex;
              this.drawTempPoint();
            }
            if (this.m_pStringData) this.drawRowString(item, rc);
          }
        }
      }
      offsetRect(rc, 0, this.m_nTextHeight);
      if (++i >= size) break;
    }
  }

  /** a row of a static box: its control at (`x`, `y`), drawn */
  private drawRowControl(item: ListBoxItem, x: number, y: number): void {
    const control = item.pControl;
    if (!control) return;
    control.setOffsetPos(new Vec2(x, y));
    control.onFrameRender();
  }

  /**
   * The text of a row (the same code in the exe for a highlighted row and for the others), at the corner of the row `rc`:
   * `(float)(dialog.m_Pos + rc.left) + m_OffsetPos` cut to a whole pixel, then the depth (`itemDepth * m_BlankWidthByDepth` pixels) added.
   *  - A row of type DEFAULT or NOT_ENABLE (an unsigned compare: below 2) is drawn by `m_pUKFont` (nothing without it) with the string
   *    data's style: the colour is the dialog's times the string's times the box's per channel, or, with `m_bColor`, the row's own red,
   *    green and blue; alpha is dialog times string times box, the string's alpha halved for NOT_ENABLE; the outline colour is the
   *    plain product.
   *  - A group row (GROUP_PLUS 2, GROUP_MINUS 3) first moves the group mark (`m_pGroupMark`, a static with the pictures Plus_Box and
   *    Minus_Box) to the corner of the row plus the depth and `m_GroupMarkOffsetPos`, shows the picture of its type and draws it, then
   *    its text through `m_pGroupUKFont` (nothing without it) with the group string data (`m_pGroupStringData`: the exe does not
   *    look at whether there is one), `m_BlankWidthToGroupMark` further right.
   *  - Any other type is not drawn.
   * A spreading row shows the first `iSpreadCount` characters: the exe compares with the length as unsigned numbers, so a count below 0
   * shows everything.  The call is `OutTextMultiline(x, y, text, colour, style, outline, 0.8, no rectangle, 0, all, 1, 1)`: a line
   * space of 0.8 (a float) and the alignment flag 0, not the string data's `sortFlag`.
   */
  private drawRowString(item: ListBoxItem, rc: Rect): void {
    const data = this.m_pStringData!;
    const dialog = dialogOf(this);
    const { x, y } = stringPosition(dialog, this, data, { x: rc.left, y: rc.top });
    const depth = Math.imul(item.itemDepth, this.m_BlankWidthByDepth);
    const type = item.itemType >>> 0;
    const text = item.bSpread ? item.strText.slice(0, (item.strText.length >>> 0) < (item.iSpreadCount >>> 0) ? item.strText.length : item.iSpreadCount) : item.strText;
    const d = dialog.m_Color, c = this.m_Color;
    if (type < 2) {
      const s = data.color, o = data.outlineColor;
      const alpha = f(f(type !== 0 ? f(f(s.a * 0.5) * d.a) : f(d.a * s.a)) * c.a);
      const own = item.m_bColor;
      const color: ColorF = {
        a: alpha,
        r: own ? item.m_color.r : channel(d.r, s.r, c.r),
        g: own ? item.m_color.g : channel(d.g, s.g, c.g),
        b: own ? item.m_color.b : channel(d.b, s.b, c.b),
      };
      const outline: ColorF = { a: channel(d.a, o.a, c.a), r: channel(d.r, o.r, c.r), g: channel(d.g, o.g, c.g), b: channel(d.b, o.b, c.b) };
      this.m_pUKFont?.OutTextMultiline((ftoi(x) + depth) | 0, ftoi(y), text, packColor(color), data.fontStyle, packColor(outline), LINE_SPACE, null, 0, -1, 1, 1);
    } else if (type === 2 || type === 3) {
      const g = this.m_pGroupStringData;
      if (!g) throw new Error("CKTDGUIListBox::OnFrameRender: a group row without group string data (SetGroupString was not called); the exe dereferences null");
      const s = g.color, o = g.outlineColor;
      const color: ColorF = { a: channel(d.a, s.a, c.a), r: channel(d.r, s.r, c.r), g: channel(d.g, s.g, c.g), b: channel(d.b, s.b, c.b) };
      const outline: ColorF = { a: channel(d.a, o.a, c.a), r: channel(d.r, o.r, c.r), g: channel(d.g, o.g, c.g), b: channel(d.b, o.b, c.b) };
      const mark = this.m_pGroupMark;
      const plus = item.itemType === LBIT.GROUP_PLUS;
      mark.GetPicture(0)!.bShow = plus;
      mark.GetPicture(1)!.bShow = !plus;
      mark.setOffsetPos(new Vec2(f(f(depth) + f(f(rc.left) + this.m_GroupMarkOffsetPos.x)), f(f(rc.top) + this.m_GroupMarkOffsetPos.y)));
      mark.onFrameRender();
      this.m_pGroupUKFont?.OutTextMultiline((ftoi(x) + depth + this.m_BlankWidthToGroupMark) | 0, ftoi(y), text, packColor(color), g.fontStyle, packColor(outline), LINE_SPACE, null, 0, -1, 1, 1);
    }
  }
}
