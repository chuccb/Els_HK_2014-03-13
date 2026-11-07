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
 * `OnFrameRender` 32985EE0 (the repeat of a held arrow, then the four quads).  Not ported: what the bar does while the game runs (`MsgProc`,
 * `HandleMouse`, `OnFrameMove`).
 */
import type { CKTDGUIScrollBar_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIPointData } from "./control.ts";
import type { UIContext, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import { idiv, imul, newRect, ptInRect, setRect } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { VertexUI4 } from "./render.ts";

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
  /** `m_Vertex[4]`: the quad being drawn */
  readonly m_Vertex = new VertexUI4();
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

  // ---- drawing ---------------------------------------------------------------------------------------------------------------

  /**
   * `OnFrameRender` (32985EE0), DXUT's `CDXUTScrollBar::Render`: a shown bar first repeats a held arrow: with an arrow down
   * (`m_Arrow` not `CLEAR`) and the last mouse position (`m_LastMouse`) on the matching button, a click scrolls once after 0.33 s (and
   * the arrow is then held), a held arrow every 0.05 s, by one step (`Scroll(-1)` for the up button, `Scroll(1)` for the down one), the time
   * being `DXUTGetTime()`.  Then it draws, each with the scratch point `m_TempPoint` whose corners are the rectangle's: the track (when
   * `m_bEnableTrack`, with the track texture, and only if there is one), the up button and the down button (the pressed texture while the button is
   * clicked, if there is one, else the normal one; nothing without a texture), and the thumb (when `m_bEnableThumb` and `m_bShowThumb`,
   * with the thumb texture, if there is one).
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    if (this.m_Arrow !== ARROWSTATE.CLEAR) this.repeatArrow();
    const point = this.m_TempPoint;
    const draw = (rc: Rect, tex: UITextureData | null): void => {
      point.leftTopPoint.set(rc.left, rc.top);
      point.rightTopPoint.set(rc.right, rc.top);
      point.leftBottomPoint.set(rc.left, rc.bottom);
      point.rightBottomPoint.set(rc.right, rc.bottom);
      if (!tex) return;
      point.pUITextureData = tex;
      this.updateVertex(this.m_Vertex, point);
      this.renderVertex(this.m_Vertex, point, 1);
    };
    if (this.m_bEnableTrack) draw(this.m_rcTrack, this.m_pTrackTex);
    draw(this.m_rcUpButton, (this.m_bIsUpButtonClicked && this.m_pUpButtonDownTex) || this.m_pUpButtonTex);
    draw(this.m_rcDownButton, (this.m_bIsDownButtonClicked && this.m_pDownButtonDownTex) || this.m_pDownButtonTex);
    if (this.m_bEnableThumb && this.m_bShowThumb) draw(this.m_rcThumb, this.m_pThumbTex);
    return 0;
  }

  /** the first part of `OnFrameRender`: the arrow that is held scrolls again (`m_dArrowTS` is the time of the last step) */
  private repeatArrow(): void {
    const now = this.ctx.devices.absoluteTime();
    if (ptInRect(this.m_rcUpButton, this.m_LastMouse)) {
      if (this.m_Arrow === ARROWSTATE.CLICKED_UP) {
        if (now - this.m_dArrowTS <= 0.33) return;
        this.scroll(-1);
        this.m_Arrow = ARROWSTATE.HELD_UP;
      } else {
        if (this.m_Arrow !== ARROWSTATE.HELD_UP || now - this.m_dArrowTS <= 0.05) return;
        this.scroll(-1);
      }
    } else {
      if (!ptInRect(this.m_rcDownButton, this.m_LastMouse)) return;
      if (this.m_Arrow === ARROWSTATE.CLICKED_DOWN) {
        if (now - this.m_dArrowTS <= 0.33) return;
        this.scroll(1);
        this.m_Arrow = ARROWSTATE.HELD_DOWN;
      } else {
        if (this.m_Arrow !== ARROWSTATE.HELD_DOWN || now - this.m_dArrowTS <= 0.05) return;
        this.scroll(1);
      }
    }
    this.m_dArrowTS = now;
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
