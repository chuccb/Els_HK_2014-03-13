/**
 * `CKTDGUIScrollBar` (the Lua class `CKTDGUIScrollBar`, a `CKTDGUIControl`): DXUT's `CDXUTScrollBar`, the bar of the combo box, the list box
 * and the control list.  The scripts get one back from `ListBox.InitScrollBar` and `ControlList.InitXScrollBar / InitYScrollBar` and can
 * only switch its track and its thumb off (the two registered methods, `SetEnableTrack` 328CD4C0 and `SetEnableThumb` 328CD4B0).
 *
 * Constructor 32984D70 (defaults; runs `UI_Control_Sound.lua` and opens the sound of its global `ScrollBar_Mouse_Down`).  The members
 * the owners call: SetDownButtonTex 32986440, SetDownButtonDownTex 32986400, SetUpButtonTex 32986610, SetUpButtonDownTex 329865D0,
 * SetTrackTex 32986590, SetThumbTex 32986480 (each destroys the texture it had and takes the pointer it is given), SetTrackRange 32986530,
 * SetTrackPos 329864C0, Scroll 329863A0, ShowItem 32986650, Cap 32985AB0, UpdateRects 329866A0, UpdateThumbRect 32986770.
 *
 * Not ported: what the bar does while the game runs (`MsgProc`, `HandleMouse`, `OnFrameMove`, `OnFrameRender`).
 */
import type { CKTDGUIScrollBar_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIPointData } from "./control.ts";
import type { UIContext, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import { idiv, imul, newRect, newVertices, setRect } from "./rect.ts";
import type { Rect, VertexUI } from "./rect.ts";

/** `CDXUTScrollBar::ARROWSTATE` */
export const ARROWSTATE = { CLEAR: 0, CLICKED_UP: 1, CLICKED_DOWN: 2, HELD_UP: 3, HELD_DOWN: 4 } as const;

/** `SCROLLBAR_MINTHUMBSIZE`: the thumb is never shorter than this */
const MIN_THUMB_SIZE = 8;

export class CKTDGUIScrollBar extends CKTDGUIControl implements Partial<CKTDGUIScrollBar_Methods> {
  m_bShowThumb = true;
  m_bDrag = false;
  m_bIsUpButtonClicked = false;
  m_bIsDownButtonClicked = false;
  readonly m_rcUpButton: Rect = newRect();
  readonly m_rcDownButton: Rect = newRect();
  readonly m_rcTrack: Rect = newRect();
  readonly m_rcThumb: Rect = newRect();
  /** `m_TempPoint`: the scratch point of the drawing code (the constructor's defaults) */
  readonly m_TempPoint = new UIPointData();
  m_pUpButtonTex: UITextureData | null = null;
  m_pDownButtonTex: UITextureData | null = null;
  m_pUpButtonDownTex: UITextureData | null = null;
  m_pDownButtonDownTex: UITextureData | null = null;
  m_pTrackTex: UITextureData | null = null;
  m_pThumbTex: UITextureData | null = null;
  readonly m_Vertex: VertexUI[] = newVertices();
  m_nPosition = 0;
  m_nPageSize = 1;
  m_nStart = 0;
  m_nEnd = 1;
  readonly m_LastMouse = { x: 0, y: 0 };
  m_Arrow: number = ARROWSTATE.CLEAR;
  m_dArrowTS = 0;
  m_x = 0;
  m_y = 0;
  m_width = 0;
  m_height = 0;
  readonly m_rcBoundingBox: Rect = newRect();
  m_pSndMouseDown: DeviceSound | undefined;
  m_bEnableThumb = true;
  m_bEnableTrack = true;

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.SCROLLBAR;
    [this.m_pSndMouseDown] = this.openControlSounds(["ScrollBar_Mouse_Down"]);
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [this.m_pUpButtonTex, this.m_pDownButtonTex, this.m_pUpButtonDownTex, this.m_pDownButtonDownTex, this.m_pTrackTex, this.m_pThumbTex]) {
      if (t) out.push(t);
    }
  }

  /**
   * The destructor (329859C0, `delete`): the sound it opened is closed.  The six textures are not destroyed (their owner, the list box or
   * the control list, does that) and neither is the dialog told.
   */
  destroy(): void {
    if (this.m_pSndMouseDown) {
      this.ctx.devices.closeDevice(this.m_pSndMouseDown.deviceID);
      this.m_pSndMouseDown = undefined;
    }
  }

  // ---- the Lua methods (one-line setters the linker folded into the radio button's) ----------------------------------------------

  /** `SetEnableTrack(bool)` (328CD4C0): `m_bEnableTrack` */
  SetEnableTrack(enable: boolean): void {
    this.m_bEnableTrack = enable;
  }

  /** `SetEnableThumb(bool)` (328CD4B0): `m_bEnableThumb` */
  SetEnableThumb(enable: boolean): void {
    this.m_bEnableThumb = enable;
  }

  // ---- what the owner (a combo box, a list box, a control list) calls ----------------------------------------------------------

  private replace(old: UITextureData | null, tex: UITextureData | null): UITextureData | null {
    old?.release(this.ctx.devices); // ~UITextureData: the texture it had is destroyed, the new pointer is simply taken
    return tex;
  }

  setUpButtonTex(tex: UITextureData | null): void {
    this.m_pUpButtonTex = this.replace(this.m_pUpButtonTex, tex);
  }

  setUpButtonDownTex(tex: UITextureData | null): void {
    this.m_pUpButtonDownTex = this.replace(this.m_pUpButtonDownTex, tex);
  }

  setDownButtonTex(tex: UITextureData | null): void {
    this.m_pDownButtonTex = this.replace(this.m_pDownButtonTex, tex);
  }

  setDownButtonDownTex(tex: UITextureData | null): void {
    this.m_pDownButtonDownTex = this.replace(this.m_pDownButtonDownTex, tex);
  }

  setTrackTex(tex: UITextureData | null): void {
    this.m_pTrackTex = this.replace(this.m_pTrackTex, tex);
  }

  setThumbTex(tex: UITextureData | null): void {
    this.m_pThumbTex = this.replace(this.m_pThumbTex, tex);
  }

  /**
   * `Cap()` (32985AB0): keeps the position in the track: below the start, or with a track no longer than a page, it is the start; past
   * the last full page it is `m_nEnd - m_nPageSize`.
   */
  cap(): void {
    if (this.m_nPosition < this.m_nStart || this.m_nEnd - this.m_nStart <= this.m_nPageSize) this.m_nPosition = this.m_nStart;
    else if (this.m_nPageSize + this.m_nPosition > this.m_nEnd) this.m_nPosition = (this.m_nEnd - this.m_nPageSize) | 0;
  }

  /** `Scroll(nDelta)` (329863A0) */
  scroll(delta: number): void {
    this.m_nPosition = (this.m_nPosition + delta) | 0;
    this.cap();
    this.updateThumbRect();
  }

  /** `SetTrackPos(nPosition)` (329864C0): clamped to `[m_nStart, m_nEnd]`, then capped */
  setTrackPos(position: number): void {
    let p = position | 0;
    if (p <= this.m_nStart) p = this.m_nStart;
    this.m_nPosition = p < this.m_nEnd ? p : this.m_nEnd;
    this.cap();
    this.updateThumbRect();
  }

  /** `SetTrackRange(nStart, nEnd)` (32986530) */
  setTrackRange(start: number, end: number): void {
    this.m_nStart = start | 0;
    this.m_nEnd = end | 0;
    this.cap();
    this.updateThumbRect();
  }

  /** `ShowItem(nIndex)` (32986650): scrolls just far enough to bring item `nIndex` into the page */
  showItem(index: number): void {
    let i = index | 0;
    if (i < 0) i = 0;
    if (i >= this.m_nEnd) i = (this.m_nEnd - 1) | 0;
    if (this.m_nPosition > i) this.m_nPosition = i;
    else if (this.m_nPosition + this.m_nPageSize <= i) this.m_nPosition = (i - this.m_nPageSize + 1) | 0;
    this.updateThumbRect();
  }

  /** `UpdateRects()` (329866A0), virtual slot 42: the buttons are squares at the two ends, the track between them */
  updateRects(): void {
    const bb = this.m_rcBoundingBox;
    setRect(bb, this.m_x, this.m_y, this.m_x + this.m_width, this.m_y + this.m_height);
    setRect(this.m_rcUpButton, bb.left, bb.top, bb.right, bb.top + bb.right - bb.left);
    setRect(this.m_rcDownButton, bb.left, bb.left + bb.bottom - bb.right, bb.right, bb.bottom);
    setRect(this.m_rcTrack, this.m_rcUpButton.left, this.m_rcUpButton.bottom, this.m_rcDownButton.right, this.m_rcDownButton.top);
    this.m_rcThumb.left = this.m_rcUpButton.left;
    this.m_rcThumb.right = this.m_rcUpButton.right;
    this.updateThumbRect();
  }

  /** `UpdateThumbRect()` (32986770): the thumb is the page's share of the track, at least 8 pixels, at the position's share of the rest */
  updateThumbRect(): void {
    const maxPosition = (this.m_nEnd - this.m_nStart) | 0;
    if (maxPosition <= this.m_nPageSize) {
      this.m_rcThumb.bottom = this.m_rcThumb.top;
      this.m_bShowThumb = false;
      return;
    }
    const trackHeight = (this.m_rcTrack.bottom - this.m_rcTrack.top) | 0;
    const share = idiv(imul(this.m_nPageSize, trackHeight), maxPosition);
    const thumbHeight = share > MIN_THUMB_SIZE ? share : MIN_THUMB_SIZE;
    const top = (this.m_rcTrack.top + idiv(imul((trackHeight - thumbHeight) | 0, (this.m_nPosition - this.m_nStart) | 0), (maxPosition - this.m_nPageSize) | 0)) | 0;
    this.m_rcThumb.top = top;
    this.m_rcThumb.bottom = (thumbHeight + top) | 0;
    this.m_bShowThumb = true;
  }
}
