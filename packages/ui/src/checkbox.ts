/**
 * `CKTDGUICheckBox` (the Lua class `CKTDGUICheckBox`, a `CKTDGUIControl`): a box that is checked or not.
 *
 * `CKTDGUICheckBox::CKTDGUICheckBox` (32930980) sets the defaults below and, like the button, runs `UI_Control_Sound.lua` and opens the
 * sound of its global `CheckBox_Check`.  The Lua setters: SetNormalTex_LUA 329320C0, SetOverTex_LUA 32932250, SetDisableTex_LUA
 * 32931F30, SetCheckedTex_LUA 32931DA0, SetBGPoint_LUA 32931B40, SetCheckPoint_LUA 32931C30, SetChecked 328CD010 (->
 * SetCheckedInternal 32931CD0), SetCustomMsgChecked 328CD0F0, SetCustomMsgUnChecked 328CD180, SetEmptyBGWhenChecked 328CD400.
 *
 * Unlike the radio button's, the background point setter also makes the point the current point of the control, and only the normal
 * and the checked texture are handed on to a point (the over and disable textures are taken from the box by `ChangeState`).
 */
import type { CKTDGUICheckBox_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIM, UIPointData, destroyTexture, requestFocus } from "./control.ts";
import type { UIContext, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import { VertexUI4 } from "./render.ts";

/** `CKTDGUICheckBox::CHECKBOX_CONTROL_STATE` */
export const CBCS = { NORMAL: 0, MOUSEOVER: 1, DISABLE: 2 } as const;

export class CKTDGUICheckBox extends CKTDGUIControl implements Partial<CKTDGUICheckBox_Methods> {
  m_bChecked = false;
  m_bPressed = false;
  m_bEmptyBGWhenChecked = false;
  m_CheckBoxState: number = CBCS.NORMAL;
  m_pNormalTex: UITextureData | null = null;
  m_pMouseOverTex: UITextureData | null = null;
  m_pDisableTex: UITextureData | null = null;
  m_pCheckedTex: UITextureData | null = null;
  m_pBGPoint: UIPointData | null = null;
  m_pCheckedPoint: UIPointData | null = null;
  m_pSndCheck: DeviceSound | undefined;
  m_CustomMsgChecked = -1;
  m_CustomMsgUnChecked = -1;
  m_CustomFuncChecked = "";
  m_CustomFuncUnChecked = "";
  /** `m_Vertex[4]`: the quad being drawn */
  readonly m_Vertex = new VertexUI4();

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.CHECKBOX;
    [this.m_pSndCheck] = this.openControlSounds(["CheckBox_Check"]);
  }

  /**
   * `~CKTDGUICheckBox` (329314A0), then the control's: the four textures are destroyed (their devices closed), the two points freed and the
   * check sound closed.
   */
  override Destroy(): void {
    const devices = this.ctx.devices;
    this.m_pNormalTex = destroyTexture(devices, this.m_pNormalTex);
    this.m_pMouseOverTex = destroyTexture(devices, this.m_pMouseOverTex);
    this.m_pDisableTex = destroyTexture(devices, this.m_pDisableTex);
    this.m_pCheckedTex = destroyTexture(devices, this.m_pCheckedTex);
    this.m_pBGPoint = null;
    this.m_pCheckedPoint = null;
    this.m_pSndCheck = this.closeHeldDevice(this.m_pSndCheck);
    super.Destroy();
  }

  /**
   * `OnFrameMove` (329319A0): a shown box runs the control's, moves its current point towards its end point (`ChangePoint`) and follows the
   * mouse: normal goes to mouse over, mouse over back to normal, a disabled box to normal once it is enabled again, and a box
   * that is still normal or mouse over but not enabled becomes disabled.  Returns 0.
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!this.m_bShow) return 0;
    super.onFrameMove(fTime, fElapsedTime);
    this.m_fElapsedTime = Math.fround(fElapsedTime);
    if (this.m_EndPoint.fChangeTime !== this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);
    switch (this.m_CheckBoxState) {
      case CBCS.NORMAL:
        if (this.m_bMouseOver) {
          this.ChangeState(CBCS.MOUSEOVER);
          return 0;
        }
        break;
      case CBCS.MOUSEOVER:
        if (!this.m_bMouseOver) {
          this.ChangeState(CBCS.NORMAL);
          return 0;
        }
        break;
      case CBCS.DISABLE:
        if (this.m_bEnable) this.ChangeState(CBCS.NORMAL);
        return 0;
      default:
        return 0;
    }
    if (!this.m_bEnable) this.ChangeState(CBCS.DISABLE);
    return 0;
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [this.m_pNormalTex, this.m_pMouseOverTex, this.m_pDisableTex, this.m_pCheckedTex]) if (t) out.push(t);
  }

  /**
   * `OnFrameRender` (32931A90): a shown box draws the quad of its current point (`m_NowPoint`: the normal, over or disabled texture) unless
   * it is checked and `m_bEmptyBGWhenChecked` is set, then, when it is checked, the quad of the check point.  A checked box without a
   * check point (`SetCheckPoint` not called) is a null dereference in the exe.
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    if (!(this.m_bEmptyBGWhenChecked && this.m_bChecked)) {
      this.updateVertex(this.m_Vertex, this.m_NowPoint);
      this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);
    }
    if (this.m_bChecked) {
      const point = this.m_pCheckedPoint;
      if (!point) throw new Error("CKTDGUICheckBox::OnFrameRender: the box is checked but has no check point (SetCheckPoint); the exe dereferences null");
      this.updateVertex(this.m_Vertex, point);
      this.renderVertex(this.m_Vertex, point, 1);
    }
    return 0;
  }

  /**
   * `ChangeState(state)` (32931720): a new state makes the background point the current and end point; the texture it shows is the one of
   * the state (the mouse over one, the disabled one, each falling back to the normal texture); a disabled box loses the focus.
   */
  ChangeState(state: number): void {
    if (this.m_CheckBoxState === state) return;
    const bg = this.m_pBGPoint;
    if (!bg) throw new Error("CKTDGUICheckBox::ChangeState: the box has no background point (SetBGPoint); the exe dereferences null");
    this.m_CheckBoxState = state;
    this.m_EndPoint.assign(bg);
    this.m_NowPoint.assign(this.m_EndPoint);
    switch (state) {
      case CBCS.NORMAL:
        this.m_NowPoint.pUITextureData = this.m_pNormalTex;
        break;
      case CBCS.MOUSEOVER:
        this.m_NowPoint.pUITextureData = this.m_pMouseOverTex ?? this.m_pNormalTex;
        break;
      case CBCS.DISABLE:
        this.m_NowPoint.pUITextureData = this.m_pDisableTex ?? this.m_pNormalTex;
        if (this.m_bHasFocus && this.m_pDialog) this.m_pDialog.clearFocus();
        break;
      default:
        break;
    }
  }

  /**
   * `HandleMouse(uMsg, pt, wParam, lParam)` (32931830), virtual: an enabled, shown box takes
   *  - 0x201 / 0x203 (left button down, double click) in its area: it is pressed, the window captures the mouse, the box asks for the focus
   *    when it has none; taken.
   *  - 0x202 (left button up): not taken when it was not pressed; otherwise it is no longer pressed, the capture is given back and the
   *    message is taken; when the point is in the area the box is toggled by input (`SetCheckedInternal(!m_bChecked, true)`: the stage's
   *    message, the custom function, the sound).
   * Every other message is not taken.  (`DXUTGetHWND` is the window of the current device; the port has one world.)
   */
  override handleMouse(uMsg: number, x: number, y: number, _wParam: number, _lParam: number): boolean {
    if (!this.m_bEnable || !this.m_bShow) return false;
    switch (uMsg) {
      case 0x201:
      case 0x203:
        if (!this.containsPoint(x, y)) return false;
        this.m_bPressed = true;
        this.ctx.setCapture();
        if (!this.m_bHasFocus) requestFocus(this.ctx, this);
        return true;
      case 0x202:
        if (!this.m_bPressed) return false;
        this.m_bPressed = false;
        this.ctx.releaseCapture();
        if (!this.containsPoint(x, y)) return true;
        this.setCheckedInternal(!this.m_bChecked, true);
        return true;
      default:
        return false;
    }
  }

  /**
   * `SetCheckedInternal(bChecked, bFromInput)` (32931CD0): the box is checked or not; input also sends the stage the message (checked 0 /
   * unchecked 1 as 0x466, or the custom id as 0x467), then the custom function name as 0x468 when there is one, and plays the sound.
   */
  setCheckedInternal(bChecked: boolean, bFromInput: boolean): void {
    this.m_bChecked = bChecked;
    if (!bFromInput) return;
    const custom = bChecked ? this.m_CustomMsgChecked : this.m_CustomMsgUnChecked;
    if (custom === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, bChecked ? 0 : 1);
    else this.sendInternelEvent(UIM.CUSTOM_MSG, custom);
    const func = bChecked ? this.m_CustomFuncChecked : this.m_CustomFuncUnChecked;
    if (func.length !== 0) this.sendInternelEvent(UIM.CUSTOM_FUNC, func);
    this.playSound(this.m_pSndCheck);
  }

  /** `SetChecked(bool bChecked, bool bFromInput)` (328CD010) */
  SetChecked(bChecked: boolean, bFromInput: boolean): void {
    this.setCheckedInternal(bChecked, bFromInput);
  }

  // ---- textures and points ---------------------------------------------------------------------------------------------------

  /** `SetNormalTex_LUA(file, key)` (329320C0): the background point shows it */
  SetNormalTex(fileName: string, key: string): void {
    this.m_pNormalTex = this.replaceTexture(this.m_pNormalTex, fileName, key);
    if (this.m_pBGPoint) this.m_pBGPoint.pUITextureData = this.m_pNormalTex;
  }

  /** `SetOverTex_LUA(file, key)` (32932250) */
  SetOverTex(fileName: string, key: string): void {
    this.m_pMouseOverTex = this.replaceTexture(this.m_pMouseOverTex, fileName, key);
  }

  /** `SetDisableTex_LUA(file, key)` (32931F30) */
  SetDisableTex(fileName: string, key: string): void {
    this.m_pDisableTex = this.replaceTexture(this.m_pDisableTex, fileName, key);
  }

  /** `SetCheckedTex_LUA(file, key)` (32931DA0): the check point shows it */
  SetCheckedTex(fileName: string, key: string): void {
    this.m_pCheckedTex = this.replaceTexture(this.m_pCheckedTex, fileName, key);
    if (this.m_pCheckedPoint) this.m_pCheckedPoint.pUITextureData = this.m_pCheckedTex;
  }

  /** `SetBGPoint_LUA()` (32931B40): the background point (showing the normal texture) is also the current point of the control */
  SetBGPoint(): void {
    this.m_pBGPoint = this.makePoint(this.m_pNormalTex);
    this.m_NowPoint.assign(this.m_pBGPoint);
  }

  /** `SetCheckPoint_LUA()` (32931C30): the point of the mark of a checked box, showing the checked texture */
  SetCheckPoint(): void {
    this.m_pCheckedPoint = this.makePoint(this.m_pCheckedTex);
  }

  // ---- messages and options --------------------------------------------------------------------------------------------------

  /** `SetCustomMsgChecked(int)` (328CD0F0) */
  SetCustomMsgChecked(msg: number): void {
    this.m_CustomMsgChecked = msg | 0;
  }

  /** `SetCustomMsgUnChecked(int)` (328CD180) */
  SetCustomMsgUnChecked(msg: number): void {
    this.m_CustomMsgUnChecked = msg | 0;
  }

  /** `SetEmptyBGWhenChecked(bool)` (328CD400) */
  SetEmptyBGWhenChecked(empty: boolean): void {
    this.m_bEmptyBGWhenChecked = empty;
  }
}
