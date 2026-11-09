/**
 * `CKTDGUINavigation` (the Lua class `CKTDGUINavigation`, a `CKTDGUIControl`): the window of a mini map whose background is dragged
 * about.  `CKTDGUIDialog::CreateNavigation` 328C1650 (sizeof 0x2D4).
 *
 * Constructor 3294D3A0: the defaults below, then `UI_Control_Sound.lua` runs and the sound of its global `Button_Mouse_Up` (the constructor
 * was copied from the button's, the name is not a navigation sound) becomes `m_pSndMouseDown`.
 *
 * The Lua methods: SetBGTex_LUA 3294E7C0 / SetWindowTex_LUA 3294EC40 (the old texture is destroyed, the new one goes to the point that
 * already exists), SetBGPoint_LUA 3294E6C0 / SetWindowPoint_LUA 3294EBA0 (a new point, sized from the texture; **both points draw the
 * background texture**: `SetWindowPoint_LUA` reads `m_pBGTex` (`[this + 0x28C]`), not `m_pWindowTex`, so the window's point and its own
 * texture only meet when `SetWindowTex_LUA` runs after `SetWindowPoint_LUA`), SetCustomMsgLButtonDown 328CD120 and SetCustomMsgMouseDragging
 * 328CD1B0 (folded by the linker with the radio button's `SetCustomMsgRButtonUp`; the member it writes is `m_CustomMsgMouseDragging`, 0x2D0).
 *
 * `OnFrameRender` (3294E560) draws the background and the window, `ContainsPoint` (3294E000) asks `PtInRect` of the rectangle that the
 * background point makes.  The input: `HandleMouse` (3294E160) and its helpers FromUIPointToRect 3294E0D0, BoundRectInRect 3294DFA0 and
 * FromRectToPoint 3294E050; `MsgProc` (3294E510, a virtual of its own in slot 41, so `navigationMsgProc` here).
 */
import type { CKTDGUINavigation_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIM, destroyTexture } from "./control.ts";
import type { UIContext, UIPointData, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import { ftoi, newRect, offsetRect, ptInRect, setRect } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { VertexUI4 } from "./render.ts";

const f = Math.fround;

export class CKTDGUINavigation extends CKTDGUIControl implements Partial<CKTDGUINavigation_Methods> {
  /** `m_Vertex[4]`: the quad being drawn */
  readonly m_Vertex = new VertexUI4();
  m_pBGTex: UITextureData | null = null;
  m_pWindowTex: UITextureData | null = null;
  m_pBGPoint: UIPointData | null = null;
  m_pWindowPoint: UIPointData | null = null;
  readonly m_rcBG: Rect = newRect();
  readonly m_rcWindow: Rect = newRect();
  m_bDraggingWindow = false;
  readonly m_ptLastMouse = { x: 0, y: 0 };
  m_pSndMouseDown: DeviceSound | undefined;
  m_CustomMsgLButtonDown = -1;
  m_CustomMsgMouseDragging = -1;

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.NAVIGATION;
    [this.m_pSndMouseDown] = this.openControlSounds(["Button_Mouse_Up"]);
  }

  /**
   * The destructor (inlined in the deleting destructor 3294DE30), then the control's: the background and window textures are destroyed
   * (their devices closed), the two points freed and the sound closed.
   */
  override Destroy(): void {
    this.m_pBGTex = destroyTexture(this.ctx.devices, this.m_pBGTex);
    this.m_pWindowTex = destroyTexture(this.ctx.devices, this.m_pWindowTex);
    this.m_pBGPoint = null;
    this.m_pWindowPoint = null;
    this.m_pSndMouseDown = this.closeHeldDevice(this.m_pSndMouseDown);
    super.Destroy();
  }

  /** `OnFrameMove` (3294E530): an enabled navigation runs the control's (a disabled one does nothing, not even for the move queue) */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (this.m_bEnable) super.onFrameMove(fTime, fElapsedTime);
    return 0;
  }

  /**
   * `ContainsPoint` (3294E000), virtual: the background rectangle `m_rcBG` is made again from the background point (the left-top and the
   * right-bottom corner, each coordinate cut to an int) and the point must be in it, `PtInRect` (the right and bottom edges are outside).
   * A navigation without a background point is a null dereference in the exe.
   */
  override containsPoint(x: number, y: number): boolean {
    const p = this.m_pBGPoint;
    if (!p) throw new Error("CKTDGUINavigation::ContainsPoint: the navigation has no background point (the exe reads it through a null pointer)");
    const rc = this.m_rcBG;
    rc.left = ftoi(p.leftTopPoint.x);
    rc.right = ftoi(p.rightBottomPoint.x);
    rc.top = ftoi(p.leftTopPoint.y);
    rc.bottom = ftoi(p.rightBottomPoint.y);
    return ptInRect(rc, { x, y });
  }

  // ---- input ---------------------------------------------------------------------------------------------------------------

  /** `FromUIPointToRect(pRect, pPointData)` (3294E0D0): the rectangle from the left-top and right-bottom corners, each coordinate cut to an int */
  private fromUIPointToRect(rect: Rect, point: UIPointData): void {
    rect.left = ftoi(point.leftTopPoint.x);
    rect.right = ftoi(point.rightBottomPoint.x);
    rect.top = ftoi(point.leftTopPoint.y);
    rect.bottom = ftoi(point.rightBottomPoint.y);
  }

  /** `FromRectToPoint(rect, point)` (3294E050): the four corners of the point from the rectangle */
  private fromRectToPoint(rect: Rect, point: UIPointData): void {
    point.leftTopPoint.set(rect.left, rect.top);
    point.rightTopPoint.set(rect.right, rect.top);
    point.leftBottomPoint.set(rect.left, rect.bottom);
    point.rightBottomPoint.set(rect.right, rect.bottom);
  }

  /**
   * `BoundRectInRect(pInsideRect, outsideRect)` (3294DFA0): the rectangle is moved into the other one.  A left edge outside is moved in (and the
   * right edge is not asked then), else a right edge outside is; the same for the top and the bottom edge; it is moved only if a step is not 0.
   */
  private boundRectInRect(inside: Rect, outside: Rect): void {
    let dx = 0, dy = 0;
    if (inside.left < outside.left) dx = (outside.left - inside.left) | 0;
    else if (inside.right > outside.right) dx = (outside.right - inside.right) | 0;
    if (inside.top < outside.top) dy = (outside.top - inside.top) | 0;
    else if (inside.bottom > outside.bottom) dy = (outside.bottom - inside.bottom) | 0;
    if (dx !== 0 || dy !== 0) offsetRect(inside, dx, dy);
  }

  /**
   * `MsgProc(uMsg, wParam, lParam)` (3294E510), a virtual of its own in slot 41 (the control's `MsgProc(hWnd, ...)` of slot 6 stays the base's
   * `return false`; named apart from `msgProc` because the arguments are not the same): the window losing the mouse capture (0x215) ends the
   * drag; never taken.
   */
  navigationMsgProc(uMsg: number, _wParam: number, _lParam: number): boolean {
    if (uMsg === 0x215) this.m_bDraggingWindow = false;
    return false;
  }

  /**
   * `HandleMouse(uMsg, pt, wParam, lParam)` (3294E160), virtual.  A disabled navigation takes nothing (a hidden one does).
   *  - 0x200 (move) is taken always.  While the window is dragged: its rectangle is made from the window point, moved by the distance from the last
   *    mouse point (each coordinate difference in single precision, cut to an int), pushed back into the background rectangle `m_rcBG` as it was
   *    left by the last press or `ContainsPoint`, and written back to the window point; the point becomes the last mouse point; the stage is told
   *    (the game message 0x466 / 1 when there is no custom message for the dragging, else 0x467 with it).
   *  - 0x201 / 0x203 (left button down, double click): both rectangles are made from the points.  On the window: the focus is requested when
   *    the control has none and its dialog is known to the manager, the window is dragged and the window captures the mouse.  On the background
   *    off the window: the same, the sound plays, and the window is centred on the point (a width and height of half the window's in single
   *    precision, each corner cut to an int) and pushed into the background.  Both then send the message (0x466 / 0 as a game message, or 0x467
   *    with `m_CustomMsgLButtonDown`) and play the sound.  Anywhere else nothing of this happens.  Taken always, and the point is remembered.
   *  - 0x202 (left button up): the drag ends and the mouse is given back; taken always.
   * Other messages are not taken.  A navigation without its points is a null dereference in the exe (here a TypeError).
   */
  override handleMouse(uMsg: number, x: number, y: number, _wParam: number, _lParam: number): boolean {
    if (!this.m_bEnable) return false;
    const rc = this.m_rcWindow;
    switch (uMsg) {
      case 0x200: {
        if (!this.m_bDraggingWindow) return true;
        this.fromUIPointToRect(rc, this.m_pWindowPoint!);
        offsetRect(rc, ftoi(f(f(x) - f(this.m_ptLastMouse.x))), ftoi(f(f(y) - f(this.m_ptLastMouse.y))));
        this.boundRectInRect(rc, this.m_rcBG);
        this.fromRectToPoint(rc, this.m_pWindowPoint!);
        const dragging = this.m_CustomMsgMouseDragging;
        this.m_ptLastMouse.x = x;
        this.m_ptLastMouse.y = y;
        if (dragging === -1) this.ctx.sendGameMessage(UIM.CONTROL_EVENT, 1, this, true);
        else this.sendInternelEvent(UIM.CUSTOM_MSG, dragging);
        return true;
      }
      case 0x201:
      case 0x203: {
        this.fromUIPointToRect(this.m_rcBG, this.m_pBGPoint!);
        this.fromUIPointToRect(rc, this.m_pWindowPoint!);
        const pt = { x, y };
        const takeFocus = (): void => {
          const dialog = this.m_pDialog;
          if (!this.m_bHasFocus && this.ctx.dialogManager.checkDlg(dialog)) dialog.requestFocus(this);
        };
        if (ptInRect(rc, pt)) {
          takeFocus();
          this.m_bDraggingWindow = true;
          this.ctx.setCapture();
        } else if (ptInRect(this.m_rcBG, pt)) {
          takeFocus();
          this.m_bDraggingWindow = true;
          this.ctx.setCapture();
          this.playSound(this.m_pSndMouseDown);
          const halfHeight = f(f((rc.bottom - rc.top) | 0) * 0.5);
          const halfWidth = f(f((rc.right - rc.left) | 0) * 0.5);
          setRect(rc, ftoi(f(f(x) - halfWidth)), ftoi(f(f(y) - halfHeight)), ftoi(f(halfWidth + f(x))), ftoi(f(halfHeight + f(y))));
          this.boundRectInRect(rc, this.m_rcBG);
          this.fromRectToPoint(rc, this.m_pWindowPoint!);
        } else {
          this.m_ptLastMouse.x = x;
          this.m_ptLastMouse.y = y;
          return true;
        }
        const down = this.m_CustomMsgLButtonDown;
        if (down === -1) this.ctx.sendGameMessage(UIM.CONTROL_EVENT, 0, this, true);
        else this.sendInternelEvent(UIM.CUSTOM_MSG, down);
        this.playSound(this.m_pSndMouseDown);
        this.m_ptLastMouse.x = x;
        this.m_ptLastMouse.y = y;
        return true;
      }
      case 0x202:
        this.m_bDraggingWindow = false;
        this.ctx.releaseCapture();
        return true;
      default:
        return false;
    }
  }

  override textureData(out: UITextureData[]): void {
    if (this.m_pBGTex) out.push(this.m_pBGTex);
    if (this.m_pWindowTex) out.push(this.m_pWindowTex);
  }

  /**
   * `OnFrameRender` (3294E560): a shown control draws the quad of its background point with the background texture, then the quad of
   * its window point with the window texture; a quad is skipped when the texture or the point is missing (the point is given the texture
   * just before it is drawn).
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    for (const [tex, point] of [[this.m_pBGTex, this.m_pBGPoint], [this.m_pWindowTex, this.m_pWindowPoint]] as const) {
      if (!tex || !point) continue;
      point.pUITextureData = tex;
      this.updateVertex(this.m_Vertex, point);
      this.renderVertex(this.m_Vertex, point, 1);
    }
    return 0;
  }

  SetBGTex_LUA(file: string, key: string): void {
    this.m_pBGTex = this.replaceTexture(this.m_pBGTex, file, key);
    if (this.m_pBGPoint) this.m_pBGPoint.pUITextureData = this.m_pBGTex;
  }

  SetWindowTex_LUA(file: string, key: string): void {
    this.m_pWindowTex = this.replaceTexture(this.m_pWindowTex, file, key);
    if (this.m_pWindowPoint) this.m_pWindowPoint.pUITextureData = this.m_pWindowTex;
  }

  SetBGPoint_LUA(): void {
    this.m_pBGPoint = this.makePoint(this.m_pBGTex);
  }

  /** the window's point draws the *background* texture (the exe reads the wrong member) */
  SetWindowPoint_LUA(): void {
    this.m_pWindowPoint = this.makePoint(this.m_pBGTex);
  }

  SetCustomMsgLButtonDown(msg: number): void {
    this.m_CustomMsgLButtonDown = msg | 0;
  }

  SetCustomMsgMouseDragging(msg: number): void {
    this.m_CustomMsgMouseDragging = msg | 0;
  }
}
