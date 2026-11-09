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
 * `OnFrameRender` 32985EE0 (the repeat of a held arrow, then the four quads); `HandleMouse` 32985B00 and `MsgProc` 32985E10 are the input.
 */
import type { CKTDGUIScrollBar_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIPointData } from "./control.ts";
import type { UIContext, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import { idiv, imul, newRect, offsetRect, ptInRect, setRect } from "./rect.ts";
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

  /** `OnFrameMove` (32985E30): a shown scroll bar runs the control's and takes the corners of its track as its current point */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (this.m_bShow) {
      super.onFrameMove(fTime, fElapsedTime);
      const t = this.m_rcTrack, p = this.m_NowPoint;
      p.leftTopPoint.set(t.left, t.top);
      p.rightTopPoint.set(t.right, t.top);
      p.leftBottomPoint.set(t.left, t.bottom);
      p.rightBottomPoint.set(t.right, t.bottom);
    }
    return 0;
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [this.m_pUpButtonTex, this.m_pDownButtonTex, this.m_pUpButtonDownTex, this.m_pDownButtonDownTex, this.m_pTrackTex, this.m_pThumbTex]) {
      if (t) out.push(t);
    }
  }

  /**
   * The destructor (329859C0, `delete`), then the control's: the sound it opened is closed.  The six textures are not destroyed (their owner,
   * the list box, the combo box or the control list, does that).
   */
  override Destroy(): void {
    this.m_pSndMouseDown = this.closeHeldDevice(this.m_pSndMouseDown);
    super.Destroy();
  }

  // ---- input -----------------------------------------------------------------------------------------------------------------

  /**
   * `CKTDGUIScrollBar::MsgProc(uMsg, wParam, lParam)` (32985E10), a virtual of its own in slot 41 (the control's `MsgProc(hWnd, ...)` of slot 6 stays
   * the base's `return false`, so a dialog never reaches this one: the owners, the list box and the like, call it): the window losing the mouse
   * capture (0x215, `WM_CAPTURECHANGED`) ends a drag; never taken.  Named apart from `msgProc` because the arguments are not the same.
   */
  scrollBarMsgProc(uMsg: number, _wParam: number, _lParam: number): boolean {
    if (uMsg === 0x215) this.m_bDrag = false;
    return false;
  }

  /**
   * `HandleMouse(uMsg, pt, wParam, lParam)` (32985B00), virtual: a shown and enabled bar first remembers the point (`m_LastMouse`, whatever the
   * message) and then takes
   *  - 0x201 / 0x203 (left button down, double click): on the up button the window captures the mouse, the position goes one back (not below the
   *    start), the thumb is updated, `m_Arrow` is `CLICKED_UP`, `m_bIsUpButtonClicked` is set, the time is noted (`m_dArrowTS = DXUTGetTime()`, the
   *    base of the repeat `OnFrameRender` does) and the mouse-down sound plays; taken.  The down button is the same one forward (not when the page
   *    would pass the end), `CLICKED_DOWN`.  On the thumb (`m_bEnableThumb`): the capture, `ThumbOffsetY` (a static shared by all bars) is where in
   *    the thumb the point is, `m_bDrag`; taken.  On the track beside the thumb (`m_bEnableTrack`, `m_bShowThumb`, the thumb's columns; the
   *    capture is taken as soon as those hold, and kept when the point turns out to be outside the track): above the thumb a page up
   *    (`Scroll(1 - page)`), below it a page down (`Scroll(page - 1)`); taken.  Anywhere else: not taken.
   *  - 0x200 (move) while dragging: the thumb is put where the mouse holds it (`pt.y - ThumbOffsetY`), pushed back into the track when it left it,
   *    and the position is the thumb's share of the track, `start + range * (top + gap / (2 * range) - trackTop) / gap` (`range = end - start -
   *    page`, `gap` the track's height less the thumb's; with no range or no gap the position stays); taken.  Not dragging: not taken.
   *  - 0x202 (left button up): the held arrows and the drag end, the capture is given back, the thumb is updated and `m_Arrow` is `CLEAR`; NOT taken.
   * Every other message is not taken.
   */
  override handleMouse(uMsg: number, x: number, y: number, _wParam: number, _lParam: number): boolean {
    if (!this.m_bShow || !this.m_bEnable) return false;
    this.m_LastMouse.x = x;
    this.m_LastMouse.y = y;
    const pt = { x, y };
    const statics = this.ctx.statics;
    switch (uMsg) {
      case 0x200: {
        if (!this.m_bDrag) return false;
        const thumb = this.m_rcThumb, track = this.m_rcTrack;
        const bottom = (y + thumb.bottom - thumb.top - statics.thumbOffsetY) | 0;
        const top = (y - statics.thumbOffsetY) | 0;
        thumb.bottom = bottom;
        thumb.top = top;
        if (top < track.top) offsetRect(thumb, 0, (track.top - top) | 0);
        else if (bottom > track.bottom) offsetRect(thumb, 0, (track.bottom - bottom) | 0);
        const gap = (thumb.top - thumb.bottom - track.top + track.bottom) | 0;
        const range = (this.m_nEnd - this.m_nStart - this.m_nPageSize) | 0;
        if (range === 0 || gap === 0) return true;
        const share = idiv(imul(range, (idiv(gap, (2 * range) | 0) - track.top + thumb.top) | 0), gap);
        this.m_nPosition = (share + this.m_nStart) | 0;
        return true;
      }
      case 0x201:
      case 0x203: {
        if (ptInRect(this.m_rcUpButton, pt)) {
          this.ctx.setCapture();
          if (this.m_nPosition > this.m_nStart) this.m_nPosition = (this.m_nPosition - 1) | 0;
          this.updateThumbRect();
          this.m_Arrow = ARROWSTATE.CLICKED_UP;
          const now = this.ctx.devices.absoluteTime();
          this.m_bIsUpButtonClicked = true;
          this.m_dArrowTS = now;
          this.playSound(this.m_pSndMouseDown);
          return true;
        }
        if (ptInRect(this.m_rcDownButton, pt)) {
          this.ctx.setCapture();
          if (((this.m_nPageSize + this.m_nPosition) | 0) < this.m_nEnd) this.m_nPosition = (this.m_nPosition + 1) | 0;
          this.updateThumbRect();
          this.m_Arrow = ARROWSTATE.CLICKED_DOWN;
          const now = this.ctx.devices.absoluteTime();
          this.m_bIsDownButtonClicked = true;
          this.m_dArrowTS = now;
          this.playSound(this.m_pSndMouseDown);
          return true;
        }
        const thumb = this.m_rcThumb, track = this.m_rcTrack;
        if (this.m_bEnableThumb && ptInRect(thumb, pt)) {
          this.ctx.setCapture();
          statics.thumbOffsetY = (y - thumb.top) | 0;
          this.m_bDrag = true;
          return true;
        }
        if (this.m_bEnableTrack && thumb.left <= x && thumb.right > x && this.m_bShowThumb) {
          this.ctx.setCapture();
          if (thumb.top > y && track.top <= y) {
            this.scroll((1 - this.m_nPageSize) | 0);
            return true;
          }
          if (thumb.bottom <= y && track.bottom > y) {
            this.scroll((this.m_nPageSize - 1) | 0);
            return true;
          }
        }
        return false;
      }
      case 0x202:
        this.m_bIsUpButtonClicked = false;
        this.m_bIsDownButtonClicked = false;
        this.m_bDrag = false;
        this.ctx.releaseCapture();
        this.updateThumbRect();
        this.m_Arrow = ARROWSTATE.CLEAR;
        return false;
      default:
        return false;
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
    old?.Destroy(this.ctx.devices); // ~UITextureData: the texture it had is destroyed, the new pointer is simply taken
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

  /** `UpdateRects()` (329866A0), virtual slot 42 (41 is `MsgProc`): the buttons are squares at the two ends, the track between them */
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
