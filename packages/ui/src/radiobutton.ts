/**
 * `CKTDGUIRadioButton` (the Lua class `CKTDGUIRadioButton`, a `CKTDGUIControl`): a button that stays pressed.  Radio buttons of a dialog
 * that share a group id (`SetGroupID`) form a group; the dialog keeps one `RadioButtonGroupInfo` per group id
 * (`m_mapRadioButtonGroupInfo`), which remembers in which order the group's buttons were checked and unchecks the oldest ones when more
 * than `m_iMaxCheckCount` (default 1) would be checked.
 *
 * `CKTDGUIRadioButton::CKTDGUIRadioButton` (329486F0) sets the defaults below, opens `UIEdge.tga` for the checked edge and, like the
 * button, runs `UI_Control_Sound.lua` and opens the sounds of its globals `RadioButton_Check` and `RadioButton_MouseOver`.  The Lua
 * setters: SetNormalTex_LUA 3294C2F0, SetOverTex_LUA 3294C480, SetDisableTex_LUA 3294BEE0, SetCheckedTex_LUA 3294BBF0, SetBGPoint_LUA
 * 3294B810, SetBGMouseOverPoint_LUA 3294B770, SetCheckPoint_LUA 3294B8B0, SetRBPoint_LUA 3294C610, SetDisabledPoint_LUA 3294C070,
 * SetGroupID_LUA 3294C110, SetGroupMaxCheckCount 3294C270, SetChecked_LUA 328CD020 (-> SetCheckedInternal 3294BA90 ->
 * RadioButtonGroupInfo::SetChecked 3294B950), SetCheckedEdge 3294BA60, SetString_LUA 328CE110, GetCheckedControl 3294A4C0; the
 * one-line field setters are 328CD1B0 .. 328CD4C0.
 *
 * What the exe does not guard and this port reports instead of reading garbage: `SetChecked` of a radio button that is in no dialog
 * dereferences the null dialog handle, and `ChangeState` of one without a `SetRBPoint` point dereferences a null point.
 */
import { Color } from "@els/host";
import type { CKTDGUIRadioButton_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIM, UIPointData, destroyTexture, readStringData, requestFocus } from "./control.ts";
import type { UIContext, UIStringData, UITextureData } from "./control.ts";
import type { DeviceSound, DeviceTexture } from "./device.ts";
import { ftoi } from "./rect.ts";
import { VertexUI4 } from "./render.ts";
import { drawUKString } from "./stringdraw.ts";

const f = Math.fround;

/** `CKTDGUIRadioButton::RADIOBUTTON_CONTROL_STATE` */
export const RBCS = { NORMAL: 0, MOUSEOVER: 1, DISABLE: 2 } as const;

/** `CKTDGUIRadioButton::RadioButtonGroupInfo` (0x14 bytes: group id, maximum of checked buttons, the checked buttons in order) */
export class RadioButtonGroupInfo {
  m_iMaxCheckCount = 1;
  /** `m_vecpCheckedOrder`: the checked buttons, the oldest first */
  readonly m_vecpCheckedOrder: CKTDGUIRadioButton[] = [];

  constructor(readonly m_iGroupID: number) {}

  /**
   * `SetChecked(pRadio, bChecked)` (3294B950): the button leaves the list (every occurrence); a checked one then makes room (the oldest
   * buttons are unchecked, `SetCheckedInternal(false, false, false)`, until fewer than the maximum are left) and joins at the end.
   */
  setChecked(pRadio: CKTDGUIRadioButton, bChecked: boolean): void {
    const order = this.m_vecpCheckedOrder;
    for (let i = 0; i < order.length; i++) {
      if (order[i] === pRadio) {
        order.splice(i, 1);
        i--;
      }
    }
    if (!bChecked) return;
    if (order.length >= this.m_iMaxCheckCount) {
      do {
        if (order.length === 0) break;
        const oldest = order.shift()!;
        oldest.setCheckedInternal(false, false, false);
      } while (order.length >= this.m_iMaxCheckCount);
    }
    order.push(pRadio);
  }
}

export class CKTDGUIRadioButton extends CKTDGUIControl implements Partial<CKTDGUIRadioButton_Methods> {
  m_bChecked = false;
  m_bPressed = false;
  m_bRButtonDown = false;
  m_bEnableDoubleClick = false;
  m_bEnableCheckToggle = false;
  m_RadioButtonState: number = RBCS.MOUSEOVER;
  m_pNormalTex: UITextureData | null = null;
  m_pMouseOverTex: UITextureData | null = null;
  m_pDisableTex: UITextureData | null = null;
  m_pCheckedTex: UITextureData | null = null;
  m_pBGPoint: UIPointData | null = null;
  m_pBGMouseOverPoint: UIPointData | null = null;
  m_pCheckedPoint: UIPointData | null = null;
  m_pRadioButtonPoint: UIPointData | null = null;
  m_pDisabledPoint: UIPointData | null = null;
  m_CustomMsgMouseOut = -1;
  m_CustomMsgMouseOver = -1;
  m_CustomMsgChecked = -1;
  m_CustomMsgUnChecked = -1;
  m_CustomMsgDoubleClicked = -1;
  m_CustomMsgRButtonUp = -1;
  m_pStringData: UIStringData | null = null;
  m_GroupID = -1;
  readonly m_MyNowPoint = new UIPointData();
  readonly m_MyEndPoint = new UIPointData();
  m_bShowOffBGByCheck = false;
  m_bFixOverByCheck = false;
  m_pSndCheck: DeviceSound | undefined;
  m_pSndMouseOver: DeviceSound | undefined;
  readonly m_CheckedEdgeColor = new Color(1, 1, 1, 1);
  m_CheckedEdgeWidth = 0;
  /** `UIEdge.tga` (the destructor closes it) */
  m_pCheckedEdgeTexture: DeviceTexture | undefined;
  m_bDrawCheckedEdgeOut = true;
  /** `m_Vertex[4]`: the quad being drawn */
  readonly m_Vertex = new VertexUI4();

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.RADIOBUTTON;
    this.m_pCheckedEdgeTexture = ctx.devices.openTexture("UIEdge.tga");
    [this.m_pSndCheck, this.m_pSndMouseOver] = this.openControlSounds(["RadioButton_Check", "RadioButton_MouseOver"]);
  }

  /**
   * `~CKTDGUIRadioButton` (32949310), then the control's: the four textures are destroyed (their devices closed), the five points and the
   * string data freed, the check and over sounds and the checked edge texture closed.  A button whose dialog handle is still valid
   * leaves its group: the first place of the button in the checked order of the group's `RadioButtonGroupInfo` (the dialog's map, by
   * `m_GroupID`) is taken out.
   */
  override Destroy(): void {
    const devices = this.ctx.devices;
    this.m_pNormalTex = destroyTexture(devices, this.m_pNormalTex);
    this.m_pMouseOverTex = destroyTexture(devices, this.m_pMouseOverTex);
    this.m_pDisableTex = destroyTexture(devices, this.m_pDisableTex);
    this.m_pCheckedTex = destroyTexture(devices, this.m_pCheckedTex);
    this.m_pBGPoint = null;
    this.m_pCheckedPoint = null;
    this.m_pBGMouseOverPoint = null;
    this.m_pRadioButtonPoint = null;
    this.m_pDisabledPoint = null;
    this.m_pStringData = null;
    this.m_pSndCheck = this.closeHeldDevice(this.m_pSndCheck);
    this.m_pSndMouseOver = this.closeHeldDevice(this.m_pSndMouseOver);
    this.m_pCheckedEdgeTexture = this.closeHeldDevice(this.m_pCheckedEdgeTexture);
    const dialog = this.m_pDialog;
    if (dialog !== null && !dialog.destroyed) {
      const order = dialog.m_mapRadioButtonGroupInfo.get(this.m_GroupID)?.m_vecpCheckedOrder;
      const at = order?.indexOf(this) ?? -1;
      if (order && at >= 0) order.splice(at, 1);
    }
    super.Destroy();
  }

  /**
   * `OnFrameMove` (3294ACD0): a shown button runs the control's and moves both of its points (the control's and its own background `m_MyNowPoint`)
   * towards their end points, then follows the mouse.  A button in the normal state that the mouse is over plays the over sound (unless it is
   * checked), tells the stage (0x467 with `m_CustomMsgMouseOver`) and goes to mouse over; one that is not enabled becomes disabled.  A button in the
   * mouse over state goes back to normal when the mouse left (telling the stage `m_CustomMsgMouseOut`, but only when `m_CustomMsgMouseOver` is set: the
   * exe tests the wrong one, kept) and becomes disabled when it is over but not enabled; either way it asks for its guide text.  A disabled one
   * becomes normal once it is enabled.  **The state a radio button is made in is mouse over, and the background it draws (`m_MyNowPoint`) is set
   * only by `ChangeState`: the first `OnFrameMove` with the mouse elsewhere is what gives an unchecked radio button its picture.**
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!this.m_bShow) return 0;
    super.onFrameMove(fTime, fElapsedTime);
    this.m_fElapsedTime = f(fElapsedTime);
    if (this.m_EndPoint.fChangeTime !== this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);
    if (this.m_MyEndPoint.fChangeTime !== this.m_MyNowPoint.fChangeTime) this.changePoint(this.m_MyNowPoint, this.m_MyEndPoint);
    switch (this.m_RadioButtonState) {
      case RBCS.NORMAL:
        if (this.m_bMouseOver) {
          if (!this.m_bChecked) this.playSound(this.m_pSndMouseOver);
          if (this.m_CustomMsgMouseOver !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOver);
          this.ChangeState(RBCS.MOUSEOVER);
          return 0;
        }
        if (!this.m_bEnable) this.ChangeState(RBCS.DISABLE);
        return 0;
      case RBCS.MOUSEOVER:
        if (this.m_bMouseOver) {
          if (!this.m_bEnable) this.ChangeState(RBCS.DISABLE);
        } else {
          if (this.m_CustomMsgMouseOver !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOut);
          this.ChangeState(RBCS.NORMAL);
        }
        this.showGuideDesc();
        return 0;
      case RBCS.DISABLE:
        if (this.m_bShowDescriptionWhenDisable && this.m_bMouseOver) this.showGuideDesc();
        if (this.m_bEnable) this.ChangeState(RBCS.NORMAL);
        return 0;
      default:
        return 0;
    }
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [this.m_pNormalTex, this.m_pMouseOverTex, this.m_pDisableTex, this.m_pCheckedTex]) if (t) out.push(t);
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------------

  /**
   * `OnFrameRender` (3294AE80): a shown button that is checked first draws its checked edge outside (`DrawCheckedEdge(true)`); the
   * quad of its own point (`m_MyNowPoint`, the background of the current state) follows unless it is checked and `m_bShowOffBGByCheck` is
   * set; a checked button then draws the checked edge on the quad (`DrawCheckedEdge(false)`); its string comes next (stringdraw.ts: the UK
   * font's `OutTextMultiline`, with or without text); last, a checked button draws the quad of its check point.  A checked
   * button without a check point (`SetCheckPoint`) is a null dereference in the exe.
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    let background = !this.m_bChecked;
    if (!background) {
      this.drawCheckedEdge(true);
      background = !this.m_bChecked || !this.m_bShowOffBGByCheck;
    }
    if (background) {
      this.updateVertex(this.m_Vertex, this.m_MyNowPoint);
      this.renderVertex(this.m_Vertex, this.m_MyNowPoint, 1);
    }
    if (this.m_bChecked) this.drawCheckedEdge(false);
    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);
    if (this.m_bChecked) {
      const point = this.m_pCheckedPoint;
      if (!point) throw new Error("CKTDGUIRadioButton::OnFrameRender: the button is checked but has no check point (SetCheckPoint); the exe dereferences null");
      this.updateVertex(this.m_Vertex, point);
      this.renderVertex(this.m_Vertex, point, 1);
    }
    return 0;
  }

  /**
   * `DrawCheckedEdge(bDrawOut)` (32949850): the edge of a checked button, four bars of the checked edge texture (`drawEdgeBars`) round
   * or on the quad of `m_MyNowPoint`, in `m_CheckedEdgeColor`; nothing for a width of 0.  The quad's width and height are taken from the
   * right-bottom corner (the static's width comes from the right-top one).
   */
  drawCheckedEdge(drawOut: boolean): void {
    const texture = this.m_pCheckedEdgeTexture;
    if (this.m_CheckedEdgeWidth === 0 || !texture) return;
    const p = this.m_MyNowPoint;
    const nWidth = ftoi(f(p.rightBottomPoint.x - p.leftTopPoint.x));
    const nHeight = ftoi(f(p.rightBottomPoint.y - p.leftTopPoint.y));
    this.drawEdgeBars(texture, drawOut, this.m_CheckedEdgeWidth, this.m_CheckedEdgeColor, p, nWidth, nHeight);
  }

  /** `SetCustomMouseOverSound(wstring)` (3294BD80): opens the sound (the old one is not closed: its reference is leaked) */
  override setCustomMouseOverSound(soundFileName: string): void {
    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);
    this.m_pSndMouseOver = this.ctx.devices.openSound(soundFileName);
  }

  /** `SetCustomMouseUpSound(wstring)` (3294BE30): the sound of checking (the old one is leaked the same way) */
  override setCustomMouseUpSound(soundFileName: string): void {
    if (this.m_pSndCheck) this.leakedSounds.push(this.m_pSndCheck);
    this.m_pSndCheck = this.ctx.devices.openSound(soundFileName);
  }

  // ---- state -----------------------------------------------------------------------------------------------------------------

  /**
   * `ChangeState(state)` (32949630): an unchecked button that changes state takes the radio button point as the (current and end) point of
   * the control and the point of the state as the end point of its own drawing: the mouse over point (or the background point) for
   * normal and over, the disabled point for disabled (which also takes the focus away from the button).  A transition time of 0 makes
   * the current point the end point at once.
   */
  ChangeState(state: number): void {
    if (this.m_RadioButtonState === state || this.m_bChecked) return;
    const rb = this.m_pRadioButtonPoint;
    if (!rb) throw new Error("CKTDGUIRadioButton::ChangeState: the button has no radio button point (SetRBPoint); the exe dereferences null");
    this.m_RadioButtonState = state;
    this.m_EndPoint.assign(rb);
    this.m_NowPoint.assign(this.m_EndPoint);
    if (state === RBCS.DISABLE) {
      if (this.m_pDisabledPoint) this.m_MyEndPoint.assign(this.m_pDisabledPoint);
      this.m_MyNowPoint.fChangeTime = 0;
      if (this.m_bHasFocus && this.m_pDialog) this.m_pDialog.clearFocus();
    } else {
      const point = state === RBCS.MOUSEOVER && this.m_pBGMouseOverPoint ? this.m_pBGMouseOverPoint : this.m_pBGPoint;
      if (point) this.m_MyEndPoint.assign(point);
      this.m_MyNowPoint.fChangeTime = 0;
    }
    if (this.m_MyEndPoint.fChangeTime === 0) this.m_MyNowPoint.assign(this.m_MyEndPoint);
  }

  /**
   * `HandleMouse(uMsg, pt, wParam, lParam)` (3294A680), virtual: an enabled, shown button takes
   *  - 0x201 (left button down) in its area, unless it is checked and does not toggle: it is pressed, then `ButtonDown`.
   *  - 0x204 (right button down) in its area: `m_bRButtonDown`, then `ButtonDown` (the window captures the mouse, the button asks for the
   *    focus when it has none; taken).
   *  - 0x202 (left button up): not taken when it was not pressed; otherwise the capture is given back and the message taken; with the point in
   *    its area the check sound plays, the group is cleared (see below) and the button is checked by input, or toggled with `m_bEnableCheckToggle`.
   *  - 0x203 (left double click): taken and nothing more without `m_bEnableDoubleClick`; with it, in the area: the focus, the sound, the group
   *    cleared except this button, and the button is checked by a double click (`SetCheckedInternal(true, true, true)`).
   *  - 0x205 (right button up): not taken when the right button was not down; otherwise the capture is given back, taken, and with the point
   *    in the area, the focus and a message id other than -1 the stage is sent the custom message `m_CustomMsgRButtonUp`.
   * Every other message is not taken.
   *
   * "The group is cleared" is done only for a group without a record or with `m_iMaxCheckCount == 1` (a group that takes more is left to the
   * record, `RadioButtonGroupInfo::SetChecked`): every radio button of the dialog with the group's id is unchecked without input.  On a
   * left button up the button itself is among them (so a toggling button of such a group, unchecked first, is always checked again: the
   * exe's behaviour), on a double click it is not.  A handle that names no dialog answers the null object: no record and no controls.
   */
  override handleMouse(uMsg: number, x: number, y: number, _wParam: number, _lParam: number): boolean {
    if (!this.m_bEnable || !this.m_bShow) return false;
    switch (uMsg) {
      case 0x201:
        if ((!this.m_bEnableCheckToggle && this.m_bChecked) || !this.containsPoint(x, y)) return false;
        this.m_bPressed = true;
        return this.buttonDown();
      case 0x202:
        if (!this.m_bPressed) return false;
        this.m_bPressed = false;
        this.ctx.releaseCapture();
        if (!this.containsPoint(x, y)) return true;
        this.playSound(this.m_pSndCheck);
        this.clearGroup(true);
        this.setCheckedInternal(this.m_bEnableCheckToggle ? !this.m_bChecked : true, false, true);
        return true;
      case 0x203:
        if (!this.m_bEnableDoubleClick) return true;
        if (!this.containsPoint(x, y)) return false;
        if (!this.m_bHasFocus) requestFocus(this.ctx, this);
        this.playSound(this.m_pSndCheck);
        this.clearGroup(false);
        this.setCheckedInternal(true, true, true);
        return true;
      case 0x204:
        if (!this.containsPoint(x, y)) return false;
        this.m_bRButtonDown = true;
        return this.buttonDown();
      case 0x205:
        if (!this.m_bRButtonDown) return false;
        this.m_bRButtonDown = false;
        this.ctx.releaseCapture();
        if (!this.containsPoint(x, y) || !this.m_bHasFocus || this.m_CustomMsgRButtonUp === -1) return true;
        this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgRButtonUp);
        return true;
      default:
        return false;
    }
  }

  /** the end of the button down cases of `HandleMouse` (`LABEL_15`): the capture, the focus; taken */
  private buttonDown(): boolean {
    this.ctx.setCapture();
    if (!this.m_bHasFocus) requestFocus(this.ctx, this);
    return true;
  }

  /** the loop of `HandleMouse` that unchecks the radio buttons of this button's group (`includeThis`: this button too) */
  private clearGroup(includeThis: boolean): void {
    const dialog = this.liveDialog();
    const info = dialog?.getRadioButtonGroupInfo(this.m_GroupID) ?? null;
    if (info !== null && info.m_iMaxCheckCount !== 1) return;
    if (dialog === null) return;
    for (let i = 0; i < dialog.m_ControlsList.length; i++) {
      const control = dialog.getControl(i);
      if (control === null || control.m_ControlType !== UCT.RADIOBUTTON) continue;
      const radio = control as CKTDGUIRadioButton;
      if (radio.m_GroupID === this.m_GroupID && (includeThis || radio !== this)) radio.setCheckedInternal(false, false, false);
    }
  }

  /**
   * `SetCheckedInternal(bChecked, bClickedDouble, bFromInput)` (3294BA90): the button is checked or not; a checked one is entered in the
   * checked order of its group (which may uncheck others), an unchecked one goes back to the normal state.  Input also sends the stage a
   * message: double click 0x466 with 2 (or 0x467 with the custom id), checked 0x466 / 0 (or the custom id), unchecked 0x466 / 1.
   */
  setCheckedInternal(bChecked: boolean, bClickedDouble: boolean, bFromInput: boolean): void {
    this.m_bChecked = bChecked;
    const dialog = this.m_pDialog;
    if (!dialog) throw new Error("CKTDGUIRadioButton::SetCheckedInternal: the button is in no dialog; the exe dereferences a null dialog handle");
    const info = dialog.m_mapRadioButtonGroupInfo.get(this.m_GroupID);
    if (info && bChecked) info.setChecked(this, true);
    if (!this.m_bChecked) this.ChangeState(RBCS.NORMAL);
    if (!bFromInput) return;
    if (this.m_bChecked) {
      const custom = bClickedDouble ? this.m_CustomMsgDoubleClicked : this.m_CustomMsgChecked;
      if (custom === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, bClickedDouble ? 2 : 0);
      else this.sendInternelEvent(UIM.CUSTOM_MSG, custom);
    } else if (this.m_CustomMsgUnChecked === -1) {
      this.sendInternelEvent(UIM.CONTROL_EVENT, 1);
    } else {
      this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgUnChecked);
    }
  }

  // ---- textures and points ---------------------------------------------------------------------------------------------------

  /** `SetNormalTex_LUA(file, key)` (3294C2F0): the background point shows it (the radio button point does not follow) */
  SetNormalTex(fileName: string, key: string): void {
    this.m_pNormalTex = this.replaceTexture(this.m_pNormalTex, fileName, key);
    if (this.m_pBGPoint) this.m_pBGPoint.pUITextureData = this.m_pNormalTex;
  }

  /** `SetOverTex_LUA(file, key)` (3294C480) */
  SetOverTex(fileName: string, key: string): void {
    this.m_pMouseOverTex = this.replaceTexture(this.m_pMouseOverTex, fileName, key);
    if (this.m_pBGMouseOverPoint) this.m_pBGMouseOverPoint.pUITextureData = this.m_pMouseOverTex;
  }

  /** `SetDisableTex_LUA(file, key)` (3294BEE0) */
  SetDisableTex(fileName: string, key: string): void {
    this.m_pDisableTex = this.replaceTexture(this.m_pDisableTex, fileName, key);
    if (this.m_pDisabledPoint) this.m_pDisabledPoint.pUITextureData = this.m_pDisableTex;
  }

  /** `SetCheckedTex_LUA(file, key)` (3294BBF0) */
  SetCheckedTex(fileName: string, key: string): void {
    this.m_pCheckedTex = this.replaceTexture(this.m_pCheckedTex, fileName, key);
    if (this.m_pCheckedPoint) this.m_pCheckedPoint.pUITextureData = this.m_pCheckedTex;
  }

  /** `SetBGPoint_LUA()` (3294B810): the point of the background, showing the normal texture */
  SetBGPoint(): void {
    this.m_pBGPoint = this.makePoint(this.m_pNormalTex);
  }

  /** `SetBGMouseOverPoint_LUA()` (3294B770): the background while the mouse is over the button, showing the mouse over texture */
  SetBGMouseOverPoint(): void {
    this.m_pBGMouseOverPoint = this.makePoint(this.m_pMouseOverTex);
  }

  /** `SetCheckPoint_LUA()` (3294B8B0): the point of the mark of a checked button, showing the checked texture */
  SetCheckPoint(): void {
    this.m_pCheckedPoint = this.makePoint(this.m_pCheckedTex);
  }

  /** `SetRBPoint_LUA()` (3294C610): the point of the radio button itself, showing the normal texture */
  SetRBPoint(): void {
    this.m_pRadioButtonPoint = this.makePoint(this.m_pNormalTex);
  }

  /** `SetDisabledPoint_LUA()` (3294C070): the point of the disabled button, showing the disable texture */
  SetDisabledPoint(): void {
    this.m_pDisabledPoint = this.makePoint(this.m_pDisableTex);
  }

  /** `SetString_LUA()` (328CE110): the button's text, from the table on top of the stack */
  SetString(): void {
    this.m_pStringData = readStringData(this.ctx);
  }

  // ---- groups ----------------------------------------------------------------------------------------------------------------

  /**
   * `SetGroupID_LUA(int)` (3294C110): in a dialog the group gets its `RadioButtonGroupInfo` when it has none yet (before the button is
   * added to a dialog only the id is kept).
   */
  SetGroupID(groupID: number): void {
    this.m_GroupID = groupID | 0;
    const dialog = this.m_pDialog;
    if (!dialog) return;
    const map = dialog.m_mapRadioButtonGroupInfo;
    if (!map.get(this.m_GroupID)) map.set(this.m_GroupID, new RadioButtonGroupInfo(this.m_GroupID));
  }

  /** `SetGroupMaxCheckCount(int)` (3294C270): how many buttons of the group may be checked at once */
  SetGroupMaxCheckCount(maxCheckCount: number): void {
    const info = this.m_pDialog?.m_mapRadioButtonGroupInfo.get(this.m_GroupID);
    if (info) info.m_iMaxCheckCount = maxCheckCount | 0;
  }

  /** `SetChecked_LUA(bool)` (328CD020): `SetCheckedInternal(checked, false, false)` */
  SetChecked(bChecked: boolean): void {
    this.setCheckedInternal(bChecked, false, false);
  }

  /** `GetCheckedControl()` (3294A4C0): the first button of the group, in the order of the dialog, that is checked */
  GetCheckedControl(): CKTDGUIRadioButton | undefined {
    const list = this.m_pDialog?.m_ControlsList;
    if (!list) return undefined;
    for (const c of list) {
      if (c.m_ControlType === UCT.RADIOBUTTON) {
        const r = c as CKTDGUIRadioButton;
        if (r.m_GroupID === this.m_GroupID && r.m_bChecked) return r;
      }
    }
    return undefined;
  }

  // ---- messages and options --------------------------------------------------------------------------------------------------

  /** `SetCustomMsgMouseOut(int)` (328CD1D0) */
  SetCustomMsgMouseOut(msg: number): void {
    this.m_CustomMsgMouseOut = msg | 0;
  }

  /** `SetCustomMsgMouseOver(int)` (328CD200) */
  SetCustomMsgMouseOver(msg: number): void {
    this.m_CustomMsgMouseOver = msg | 0;
  }

  /** `SetCustomMsgChecked(int)` (328CD100) */
  SetCustomMsgChecked(msg: number): void {
    this.m_CustomMsgChecked = msg | 0;
  }

  /** `SetCustomMsgUnChecked(int)` (328CD2D0) */
  SetCustomMsgUnChecked(msg: number): void {
    this.m_CustomMsgUnChecked = msg | 0;
  }

  /** `SetCustomMsgDoubleClicked(int)` (328CD120, shared with `CKTDGUINavigation::SetCustomMsgLButtonDown`) */
  SetCustomMsgDoubleClicked(msg: number): void {
    this.m_CustomMsgDoubleClicked = msg | 0;
  }

  /** `SetCustomMsgRButtonUp(int)` (328CD1B0) */
  SetCustomMsgRButtonUp(msg: number): void {
    this.m_CustomMsgRButtonUp = msg | 0;
  }

  /** `SetEnableDoubleClick(bool)` (328CD430) */
  SetEnableDoubleClick(enable: boolean): void {
    this.m_bEnableDoubleClick = enable;
  }

  /** `SetEnableCheckToggle(bool)` (328CD410): a click on a checked button unchecks it */
  SetEnableCheckToggle(enable: boolean): void {
    this.m_bEnableCheckToggle = enable;
  }

  /** `SetShowOffBGByCheck(bool)` (328CD4B0) */
  SetShowOffBGByCheck(show: boolean): void {
    this.m_bShowOffBGByCheck = show;
  }

  /** `SetFixOverByCheck(bool)` (328CD4C0) */
  SetFixOverByCheck(fix: boolean): void {
    this.m_bFixOverByCheck = fix;
  }

  /** `SetCheckedEdge(bool, int, D3DXCOLOR)` (3294BA60) */
  SetCheckedEdge(drawOut: boolean, width: number, color: Color): void {
    this.m_bDrawCheckedEdgeOut = drawOut;
    this.m_CheckedEdgeWidth = width | 0;
    this.m_CheckedEdgeColor.set(color.r, color.g, color.b, color.a);
  }
}
