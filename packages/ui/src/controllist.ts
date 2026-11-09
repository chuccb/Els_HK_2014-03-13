/**
 * `CKTDGUIContolList` (the Lua class `CKTDGUIContolList`, sic; a `CKTDGUIControl`): a grid of controls of which a window of `m_iViewSizeX`
 * by `m_iViewSizeY` cells is shown, moved by one scroll bar for each axis.  `CKTDGUIDialog::CreateControlList` 328C1270 (sizeof 0x2A4).
 *
 * Constructor 3294F030: no controls, the top cell (0, 0), nothing at the largest index, a view of 1 by 1 cells of 1 by 1 pixel (the
 * scroll offsets), no custom message, the position (0, 0), an empty bounding box, no scroll bars, no textures, no sounds.
 *
 * The cells are `m_mapControls`, a `std::map<std::pair<int,int>, std::vector<ControlInfo>>` keyed by (row, column), walked in key order.
 *
 * The Lua methods (25):
 *   - the twelve scroll bar texture setters, six for each axis (X: Up 329502F0 / UpDown 32950160 / Down 3294FFD0 / DownDown 329471B0 /
 *     Track 329480B0 / Thumb 32947340, Y: Up 32947DF0 / UpDown 32947C60 / Down 329477B0 / DownDown 32947620 / Track 32947AD0 /
 *     Thumb 32947940); the old texture is destroyed, the new one (null when the file does not open) replaces it.  The Thumb and Track of X
 *     and the DownDown of X are folded by the linker with the list box's setters of the same offset;
 *   - InitXScrollBar_LUA 3294F670 / InitYScrollBar_LUA 3294F780: the bar the list had is deleted, a new one is made in the list's dialog with
 *     the six textures of its axis, and the script gets it back;
 *   - SetXScrollBarPos 328CE430 / SetXScrollBarSize 328CE460 / SetYScrollBarPos 328CE490 / SetYScrollBarSize 328CE4C0 (the bar is
 *     not checked for: the exe faults without one) and SetShowEnableXScroolBar 328CDFD0 / SetShowEnableYScroolBar 328CDFE0 (sic: the
 *     virtual `SetShowEnable` of the bar, also unchecked);
 *   - SetPos_LUA 328CDBA0 (`m_Pos` only: no rectangles are updated), SetScrollOffset 3294FE20, SetViewSize 3294FF40,
 *     SetCustomMsgScroll 328CD280 and InsertItem 3294F890 (the control is appended to its cell, which is made when it is not there; the
 *     largest column and row grow; a control that is in no dialog is added to the list's dialog; the result is always false).
 *
 * Also ported, for the classes that own control lists: `SetIndex` 3294FDC0, `SetShow(bShow, row, col)` 3294FEA0, `UpdateRects` 32950480,
 * `UpdateRenderControlList` 329504F0 and `UpdateScrollBar` 329506E0.  `UpdateScrollBar` has a bug that is kept: when the X bar needs showing
 * it sets the *Y* bar's track position to the X index (and faults when there is no Y bar).
 *
 * `ContainsPoint` (3294F490) holds the quadrilateral and the bounding boxes of the two scroll bars; `HandleMouse` (3294F5F0) gives the mouse
 * to them.
 */
import { Vec2 } from "@els/host";
import type { CKTDGUIContolList_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIM, destroyTexture } from "./control.ts";
import type { UIContext, UITextureData } from "./control.ts";
import { pick2DRect, pick2DRectOfRect } from "./pick.ts";
import { ftoi, imul, newRect, setRect } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { CKTDGUIScrollBar } from "./scrollbar.ts";
import { IntPairMap } from "./stdmap.ts";

const f = Math.fround;

/** `CKTDGUIContolList::ControlInfo` (8 bytes) */
export interface ControlInfo {
  m_pControl: CKTDGUIControl;
  m_bUseAbsolutePos: boolean;
}

/** the six textures of one scroll bar: the order of `SetDownButtonTex`, `SetUpButtonTex`, ... in `InitXScrollBar` */
interface BarTextures {
  upButton: UITextureData | null;
  upButtonDown: UITextureData | null;
  downButton: UITextureData | null;
  downButtonDown: UITextureData | null;
  track: UITextureData | null;
  thumb: UITextureData | null;
}

const noTextures = (): BarTextures => ({ upButton: null, upButtonDown: null, downButton: null, downButtonDown: null, track: null, thumb: null });

export class CKTDGUIContolList extends CKTDGUIControl implements Partial<CKTDGUIContolList_Methods> {
  /** `m_mapControls`: (row, column) → the controls of the cell */
  readonly m_mapControls = new IntPairMap<ControlInfo[]>();
  /** `m_vecNowControls`: the controls inside the window, as `UpdateRenderControlList` last found them */
  readonly m_vecNowControls: CKTDGUIControl[] = [];
  /** `m_pXScollBar*Tex` */
  readonly xTex: BarTextures = noTextures();
  /** `m_pYScollBar*Tex` */
  readonly yTex: BarTextures = noTextures();
  m_iTopIndexX = 0;
  m_iTopIndexY = 0;
  m_iMaxIndexX = 0;
  m_iMaxIndexY = 0;
  m_iViewSizeX = 1;
  m_iViewSizeY = 1;
  m_iScrollOffsetX = 1;
  m_iScrollOffsetY = 1;
  m_CustomMsgScroll = -1;
  readonly m_Pos = new Vec2(0, 0);
  readonly m_rcBoundingBox: Rect = newRect();
  m_pScrollBarX: CKTDGUIScrollBar | null = null;
  m_pScrollBarY: CKTDGUIScrollBar | null = null;

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.CONTROLLIST;
  }

  /**
   * `~CKTDGUIContolList` (3294F200), then the control's: the cells are forgotten (their controls belong to the dialog), both scroll bars are
   * deleted (their own destructors) and the twelve scroll bar textures destroyed (X, then Y: up, up down, down, down down, track, thumb).
   */
  override Destroy(): void {
    this.m_mapControls.clear();
    for (const axis of ["m_pScrollBarX", "m_pScrollBarY"] as const) {
      const bar = this[axis];
      if (bar) {
        bar.Destroy();
        this[axis] = null;
      }
    }
    for (const tex of [this.xTex, this.yTex]) {
      tex.upButton = destroyTexture(this.ctx.devices, tex.upButton);
      tex.upButtonDown = destroyTexture(this.ctx.devices, tex.upButtonDown);
      tex.downButton = destroyTexture(this.ctx.devices, tex.downButton);
      tex.downButtonDown = destroyTexture(this.ctx.devices, tex.downButtonDown);
      tex.track = destroyTexture(this.ctx.devices, tex.track);
      tex.thumb = destroyTexture(this.ctx.devices, tex.thumb);
    }
    this.m_vecNowControls.length = 0;
    super.Destroy();
  }

  /**
   * `OnFrameMove` (3294FBF0): a shown and enabled list runs the control's and its two scroll bars'; when a bar's position is not the list's top
   * index any more the list takes it (`UpdateScrollBar`, `UpdateRenderControlList`) and sends the scroll message (0x467 with `m_CustomMsgScroll`).  Its current
   * point is its bounding box moved right by the Y bar's width and down by the X bar's (ints).  The cells' own controls are moved by the dialog.
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!(this.m_bShow && this.m_bEnable)) return 0;
    super.onFrameMove(fTime, fElapsedTime);
    const barX = this.m_pScrollBarX, barY = this.m_pScrollBarY;
    let x = 0, y = 0;
    if (barX) {
      barX.onFrameMove(fTime, fElapsedTime);
      x = barX.m_nPosition;
    }
    if (barY) {
      barY.onFrameMove(fTime, fElapsedTime);
      y = barY.m_nPosition;
    }
    if (this.m_iTopIndexX !== x || this.m_iTopIndexY !== y) {
      this.m_iTopIndexY = y;
      this.m_iTopIndexX = x;
      this.updateScrollBar();
      this.updateRenderControlList();
      if (this.m_CustomMsgScroll !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgScroll);
    }
    const b = this.m_rcBoundingBox;
    let left = b.left, top = b.top, right = b.right, bottom = b.bottom;
    if (barY) {
      left = (left + barY.m_width) | 0;
      right = (right + barY.m_width) | 0;
    }
    if (barX) {
      top = (top + barX.m_width) | 0;
      bottom = (bottom + barX.m_width) | 0;
    }
    const p = this.m_NowPoint;
    p.leftTopPoint.set(left, top);
    p.rightTopPoint.set(right, top);
    p.leftBottomPoint.set(left, bottom);
    p.rightBottomPoint.set(right, bottom);
    return 0;
  }

  /**
   * `ContainsPoint` (3294F490), virtual: the point is inside the list's quadrilateral (`m_NowPoint`), or inside the bounding box of the
   * horizontal scroll bar, or inside the bounding box of the vertical one (a bar the list does not have holds nothing).
   */
  override containsPoint(x: number, y: number): boolean {
    const p = this.m_NowPoint;
    if (pick2DRect(x, y, p.leftTopPoint, p.rightTopPoint, p.leftBottomPoint, p.rightBottomPoint)) return true;
    const barX = this.m_pScrollBarX;
    if (barX && pick2DRectOfRect(x, y, barX.m_rcBoundingBox)) return true;
    const barY = this.m_pScrollBarY;
    if (!barY) return false;
    return pick2DRectOfRect(x, y, barY.m_rcBoundingBox);
  }

  /**
   * `HandleMouse(uMsg, pt, wParam, lParam)` (3294F5F0), virtual: a shown and enabled list gives the message to its horizontal scroll bar (if it has
   * one) and, when that one does not take it, to its vertical one; it takes what one of them takes.  Everything else (the cells' controls are the
   * dialog's own) is not taken.
   */
  override handleMouse(uMsg: number, x: number, y: number, wParam: number, lParam: number): boolean {
    if (!this.m_bShow || !this.m_bEnable) return false;
    if (this.m_pScrollBarX !== null && this.m_pScrollBarX.handleMouse(uMsg, x, y, wParam, lParam)) return true;
    return this.m_pScrollBarY !== null && this.m_pScrollBarY.handleMouse(uMsg, x, y, wParam, lParam);
  }

  override textureData(out: UITextureData[]): void {
    for (const set of [this.xTex, this.yTex]) {
      for (const t of [set.upButton, set.upButtonDown, set.downButton, set.downButtonDown, set.track, set.thumb]) if (t) out.push(t);
    }
  }

  // ---- the scroll bar textures ----------------------------------------------------------------------------------------------------

  SetXScollBarUpButtonTex(file: string, key: string): void {
    this.xTex.upButton = this.replaceTexture(this.xTex.upButton, file, key);
  }

  SetXScollBarUpButtonDownTex(file: string, key: string): void {
    this.xTex.upButtonDown = this.replaceTexture(this.xTex.upButtonDown, file, key);
  }

  SetXScollBarDownButtonTex(file: string, key: string): void {
    this.xTex.downButton = this.replaceTexture(this.xTex.downButton, file, key);
  }

  SetXScollBarDownButtonDownTex(file: string, key: string): void {
    this.xTex.downButtonDown = this.replaceTexture(this.xTex.downButtonDown, file, key);
  }

  SetXScollBarTrackTex(file: string, key: string): void {
    this.xTex.track = this.replaceTexture(this.xTex.track, file, key);
  }

  SetXScollBarThumbTex(file: string, key: string): void {
    this.xTex.thumb = this.replaceTexture(this.xTex.thumb, file, key);
  }

  SetYScollBarUpButtonTex(file: string, key: string): void {
    this.yTex.upButton = this.replaceTexture(this.yTex.upButton, file, key);
  }

  SetYScollBarUpButtonDownTex(file: string, key: string): void {
    this.yTex.upButtonDown = this.replaceTexture(this.yTex.upButtonDown, file, key);
  }

  SetYScollBarDownButtonTex(file: string, key: string): void {
    this.yTex.downButton = this.replaceTexture(this.yTex.downButton, file, key);
  }

  SetYScollBarDownButtonDownTex(file: string, key: string): void {
    this.yTex.downButtonDown = this.replaceTexture(this.yTex.downButtonDown, file, key);
  }

  SetYScollBarTrackTex(file: string, key: string): void {
    this.yTex.track = this.replaceTexture(this.yTex.track, file, key);
  }

  SetYScollBarThumbTex(file: string, key: string): void {
    this.yTex.thumb = this.replaceTexture(this.yTex.thumb, file, key);
  }

  // ---- the scroll bars ------------------------------------------------------------------------------------------------------------

  /** `OnFrameRender` (3294FD90): a shown list draws its two scroll bars (the list's controls are drawn by the dialog) */
  override onFrameRender(): number {
    if (this.m_bShow) {
      this.m_pScrollBarX?.onFrameRender();
      this.m_pScrollBarY?.onFrameRender();
    }
    return 0;
  }

  /** a bar in this list's dialog with the textures of one axis (`InitXScrollBar_LUA` / `InitYScrollBar_LUA`); the one it had is deleted */
  private makeBar(old: CKTDGUIScrollBar | null, tex: BarTextures): CKTDGUIScrollBar {
    old?.Destroy();
    const bar = new CKTDGUIScrollBar(this.ctx);
    bar.setDialog(this.m_pDialog);
    bar.setDownButtonTex(tex.downButton);
    bar.setUpButtonTex(tex.upButton);
    bar.setDownButtonDownTex(tex.downButtonDown);
    bar.setUpButtonDownTex(tex.upButtonDown);
    bar.setTrackTex(tex.track);
    bar.setThumbTex(tex.thumb);
    return bar;
  }

  /** `InitXScrollBar_LUA()` (3294F670): the script gets the bar back */
  InitXScrollBar(): CKTDGUIScrollBar {
    this.m_pScrollBarX = this.makeBar(this.m_pScrollBarX, this.xTex);
    return this.m_pScrollBarX;
  }

  /** `InitYScrollBar_LUA()` (3294F780) */
  InitYScrollBar(): CKTDGUIScrollBar {
    this.m_pScrollBarY = this.makeBar(this.m_pScrollBarY, this.yTex);
    return this.m_pScrollBarY;
  }

  /** the bar a setter writes to without asking whether there is one (the exe faults on a list that has none) */
  private bar(axis: "X" | "Y"): CKTDGUIScrollBar {
    const bar = axis === "X" ? this.m_pScrollBarX : this.m_pScrollBarY;
    if (!bar) throw new Error(`CKTDGUIContolList: no ${axis} scroll bar (Init${axis}ScrollBar was not called); the exe dereferences null here`);
    return bar;
  }

  SetXScrollBarPos(x: number, y: number): void {
    const bar = this.bar("X");
    bar.m_x = x | 0;
    bar.m_y = y | 0;
    bar.updateRects();
  }

  SetXScrollBarSize(width: number, height: number): void {
    const bar = this.bar("X");
    bar.m_width = width | 0;
    bar.m_height = height | 0;
    bar.updateRects();
  }

  SetYScrollBarPos(x: number, y: number): void {
    const bar = this.bar("Y");
    bar.m_x = x | 0;
    bar.m_y = y | 0;
    bar.updateRects();
  }

  SetYScrollBarSize(width: number, height: number): void {
    const bar = this.bar("Y");
    bar.m_width = width | 0;
    bar.m_height = height | 0;
    bar.updateRects();
  }

  /** `SetShowEnableXScroolBar(bShow, bEnable)` (328CDFD0) */
  SetShowEnableXScroolBar(show: boolean, enable: boolean): void {
    this.bar("X").SetShowEnable(show, enable);
  }

  /** `SetShowEnableYScroolBar(bShow, bEnable)` (328CDFE0) */
  SetShowEnableYScroolBar(show: boolean, enable: boolean): void {
    this.bar("Y").SetShowEnable(show, enable);
  }

  // ---- the grid -------------------------------------------------------------------------------------------------------------------

  /** `SetPos_LUA(x, y)` (328CDBA0): only the position; the rectangles follow with the next `SetScrollOffset` / `SetViewSize` */
  SetPos(x: number, y: number): void {
    this.m_Pos.set(x, y);
  }

  SetCustomMsgScroll(msg: number): void {
    this.m_CustomMsgScroll = msg | 0;
  }

  /** the bounding box that follows from the position, the view and the scroll offsets (the end of `SetViewSize`, `UpdateRects`) */
  private setBoundingBox(width: number, height: number): void {
    const x = this.m_Pos.x, y = this.m_Pos.y;
    setRect(this.m_rcBoundingBox, ftoi(x), ftoi(y), ftoi(f(f(width) + x)), ftoi(f(f(height) + y)));
  }

  /** `SetScrollOffset(X, Y)` (3294FE20): the size of a cell; the bounding box is the view in cells of that size */
  SetScrollOffset(x: number, y: number): void {
    this.m_iScrollOffsetX = x | 0;
    this.m_iScrollOffsetY = y | 0;
    this.setBoundingBox(imul(x | 0, this.m_iViewSizeX), imul(y | 0, this.m_iViewSizeY));
  }

  /** `SetViewSize(X, Y, bUpdateControl)` (3294FF40): the number of cells shown; the scroll bars follow, the controls only when asked to */
  SetViewSize(x: number, y: number, updateControl = false): void {
    this.m_iViewSizeX = x | 0;
    this.m_iViewSizeY = y | 0;
    this.updateScrollBar();
    if (updateControl) this.updateRenderControlList();
    this.setBoundingBox(imul(this.m_iViewSizeX, this.m_iScrollOffsetX), imul(this.m_iViewSizeY, this.m_iScrollOffsetY));
  }

  /**
   * `InsertItem(pControl, row, col, bUseAbsolutePosition)` (3294F890): the control joins the cell (row, col), which is made when it is not
   * there; the largest column / row grow; a control that belongs to no dialog is added to the list's dialog.  Always false.
   */
  InsertItem(control: CKTDGUIControl | undefined, row: number, col: number, useAbsolutePosition: boolean): boolean {
    if (!(control instanceof CKTDGUIControl)) return false; // (a census on typed stubs hands over something else)
    const r = row | 0, c = col | 0;
    this.m_mapControls.getOrInsert(r, c, () => []).push({ m_pControl: control, m_bUseAbsolutePos: useAbsolutePosition });
    if (c > this.m_iMaxIndexX) this.m_iMaxIndexX = c;
    if (r > this.m_iMaxIndexY) this.m_iMaxIndexY = r;
    if (!control.m_pDialog) {
      if (!this.m_pDialog) throw new Error("CKTDGUIContolList::InsertItem: neither the control nor the list is in a dialog; the exe dereferences a null dialog handle");
      this.m_pDialog.AddControl(control);
    }
    return false;
  }

  /** `SetIndex(X, Y, bUpdateControl, bSendMessage)` (3294FDC0): the top-left cell of the window; the custom scroll message (if any) is sent */
  setIndex(x: number, y: number, updateControl: boolean, sendMessage: boolean): void {
    this.m_iTopIndexX = x | 0;
    this.m_iTopIndexY = y | 0;
    this.updateScrollBar();
    if (updateControl) this.updateRenderControlList();
    if (sendMessage && this.m_CustomMsgScroll !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgScroll);
  }

  /** `SetShow(bShow, row, col)` (3294FEA0): the controls of the cells that match (-1 matches every row / column) are shown or hidden */
  setShowAt(show: boolean, row: number, col: number): void {
    for (const [r, c, infos] of this.m_mapControls) {
      if ((row === -1 || row === r) && (col === -1 || col === c)) for (const info of infos) info.m_pControl.SetShow(show);
    }
  }

  /** `UpdateRects()` (32950480), virtual slot 42 */
  updateRects(): void {
    this.setBoundingBox(imul(this.m_iViewSizeX, this.m_iScrollOffsetX), imul(this.m_iViewSizeY, this.m_iScrollOffsetY));
  }

  /**
   * `UpdateRenderControlList()` (329504F0): the controls of the cells inside the window (`m_iTopIndex` .. + `m_iViewSize` in both
   * directions) are placed (absolute ones at the list's position less the scroll, the others at their cell's place), shown to the dialog (not
   * out of the list) and collected in `m_vecNowControls`; the others are marked out of the list.
   */
  updateRenderControlList(): void {
    this.m_vecNowControls.length = 0;
    for (const [row, col, infos] of this.m_mapControls) {
      const inside = this.m_iTopIndexX <= col && col < this.m_iTopIndexX + this.m_iViewSizeX && this.m_iTopIndexY <= row && row < this.m_iTopIndexY + this.m_iViewSizeY;
      for (const info of infos) {
        const control = info.m_pControl;
        if (!inside) {
          control.m_bOutofList = true;
          continue;
        }
        if (info.m_bUseAbsolutePos) {
          control.setOffsetPos(new Vec2(
            f(f(-imul(this.m_iTopIndexX, this.m_iScrollOffsetX)) + this.m_Pos.x),
            f(f(-imul(this.m_iTopIndexY, this.m_iScrollOffsetY)) + this.m_Pos.y),
          ));
        } else {
          control.setOffsetPos(new Vec2(
            f(f(imul(this.m_iScrollOffsetX, (col - this.m_iTopIndexX) | 0)) + this.m_Pos.x),
            f(f(imul(this.m_iScrollOffsetY, (row - this.m_iTopIndexY) | 0)) + this.m_Pos.y),
          ));
        }
        control.m_bOutofList = false;
        this.m_vecNowControls.push(control);
      }
    }
  }

  /**
   * `UpdateScrollBar()` (329506E0): a bar whose axis has more cells than the view is shown and enabled and gets the range 0 .. (largest
   * index - view size + 2) and the top index as its position.  The X bar's position is set on the *Y* bar (the exe's bug: it faults when
   * there is none).
   */
  updateScrollBar(): void {
    const x = this.m_pScrollBarX;
    if (x && this.m_iMaxIndexX >= this.m_iViewSizeX) {
      x.SetShowEnable(true, true);
      this.bar("Y").setTrackPos(this.m_iTopIndexX);
      x.setTrackRange(0, (this.m_iMaxIndexX - this.m_iViewSizeX + 2) | 0);
    }
    const y = this.m_pScrollBarY;
    if (y && this.m_iMaxIndexY >= this.m_iViewSizeY) {
      y.SetShowEnable(true, true);
      y.setTrackPos(this.m_iTopIndexY);
      y.setTrackRange(0, (this.m_iMaxIndexY - this.m_iViewSizeY + 2) | 0);
    }
  }
}
