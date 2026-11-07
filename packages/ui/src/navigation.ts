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
 * Not ported: what the control does while the game runs (`MsgProc`, `HandleMouse`, `OnFrameMove`, `OnFrameRender`, `ContainsPoint`, and the
 * rectangle helpers the mouse handling uses).
 */
import type { CKTDGUINavigation_Methods } from "@els/host";
import { CKTDGUIControl, UCT } from "./control.ts";
import type { UIContext, UIPointData, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import { newRect, newVertices } from "./rect.ts";
import type { Rect, VertexUI } from "./rect.ts";

export class CKTDGUINavigation extends CKTDGUIControl implements Partial<CKTDGUINavigation_Methods> {
  readonly m_Vertex: VertexUI[] = newVertices();
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

  override textureData(out: UITextureData[]): void {
    if (this.m_pBGTex) out.push(this.m_pBGTex);
    if (this.m_pWindowTex) out.push(this.m_pWindowTex);
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
