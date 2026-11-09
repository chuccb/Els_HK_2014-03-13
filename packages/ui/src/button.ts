/**
 * `CKTDGUIButton` (the Lua class `CKTDGUIButton`, a `CKTDGUIControl`): a push button with a texture, a point (position and size) and
 * optionally a static for each of its four states.
 *
 * `CKTDGUIButton::CKTDGUIButton` (3292B490) sets the defaults below, opens `UIEdge.tga`, runs the script `UI_Control_Sound.lua` in the
 * Lua state (a missing script is error log 0x48, a failing one 0x49) and opens the sounds its globals `Button_Mouse_Over` and
 * `Button_Mouse_Up` name.  The setters the DLG scripts call (all `*_LUA`, registered by CKTDXApp::RegisterLuabind 328C5370) finish with
 * `ChangeState(m_ButtonState, true)`, which re-selects the end point of the current state and shows the static of that state.
 * SetNormalPoint_LUA 329300D0, SetOverPoint_LUA 329304F0, SetDownPoint_LUA 3292FC00, SetDisablePoint_LUA 3292F890, SetNormalTex_LUA 32930230,
 * SetOverTex_LUA 329306A0, SetDownTex_LUA 3292FD70, SetDisableTex_LUA 3292F980, Set{Normal,Over,Down}AnimTex_LUA 32930000 / 32930420 /
 * 3292FB30, Set{Normal,Over,Down,Disable}Static_LUA 32930180 / 329305F0 / 3292FCC0 / 3292F940, SetString_LUA 329308E0, ChangeState 3292D020,
 * ReNameStatics 3292F280, SetOffsetPos 329303E0, SetShow 32930880, SetName 3292FFE0.
 */
import { Color, Vec2 } from "@els/host";
import type { CKTDGUIButton_Methods } from "@els/host";
import { CKTDGUIControl, TexChangeData, UCT, UIM, UIPointData, clampedByte, destroyTexture, readPointData, readStringData, readTexChangeData, setTexureData } from "./control.ts";
import type { UIContext, UIStringData, UITextureData } from "./control.ts";
import type { DeviceSound, DeviceTexture } from "./device.ts";
import { VertexUI4 } from "./render.ts";
import { ftoi } from "./rect.ts";
import type { CKTDGUIStatic } from "./static.ts";
import { drawUKString } from "./stringdraw.ts";

const f = Math.fround;

/** the DirectInput scan code of the Enter key (`DIK_RETURN`) that a focused button answers */
const KEY_ENTER = 0x1c;

/** `CKTDGUIButton::BUTTON_CONTROL_STATE` */
export const BCS = { NORMAL: 0, MOUSEOVER: 1, MOUSEDOWN: 2, DISABLE: 3, END: 4 } as const;

/** `StringCchPrintfW(buff, 256, ...)` keeps at most 255 characters */
const clip255 = (s: string): string => (s.length > 255 ? s.slice(0, 255) : s);

export class CKTDGUIButton extends CKTDGUIControl implements Partial<CKTDGUIButton_Methods> {
  m_ButtonState: number = BCS.NORMAL;
  m_pNormalTex: UITextureData | null = null;
  m_pMouseOverTex: UITextureData | null = null;
  m_pMouseDownTex: UITextureData | null = null;
  m_pDisableTex: UITextureData | null = null;
  m_pNormalPoint: UIPointData | null = null;
  m_pMouseOverPoint: UIPointData | null = null;
  m_pMouseDownPoint: UIPointData | null = null;
  m_pDisablePoint: UIPointData | null = null;
  m_pStringData: UIStringData | null = null;
  m_CustomMsgMouseOut = -1;
  m_CustomMsgMouseOver = -1;
  m_CustomMsgMouseDown = -1;
  m_CustomMsgMouseUp = -1;
  m_CustomMsgMouseRightUp = -1;
  m_CustomMsgMouseDblClk = -1;
  m_CustomFuncMouseOver = "";
  m_CustomFuncMouseDown = "";
  m_CustomFuncMouseUp = "";
  m_pSndMouseOver: DeviceSound | undefined;
  m_pSndMouseUp: DeviceSound | undefined;
  m_pSndMouseDown: DeviceSound | undefined;
  m_bIsSameNormalAndOverButton = false;
  m_bOverStateAtNormal = false;
  m_bDownStateAtNormal = false;
  m_bEnableClick = true;
  m_bClicked = false;
  m_bMouseOut = false;
  /** the statics of the four states (normal, mouse over, mouse down, disabled) */
  readonly m_StaticControls: (CKTDGUIStatic | null)[] = [null, null, null, null];
  readonly m_EdgeColor = new Color(1, 1, 1, 1);
  m_EdgeWidth = 0;
  m_EdgeEnlargeValue = 0;
  /** `UIEdge.tga` */
  m_pEdgeTexture: DeviceTexture | undefined;
  m_bDrawEdgeOut = false;
  /** `std::map<int, TexChangeData*>`: the animation steps of a state by sequence id */
  readonly m_mapMouseOverTex = new Map<number, TexChangeData>();
  readonly m_mapMouseNormalTex = new Map<number, TexChangeData>();
  readonly m_mapMouseDownTex = new Map<number, TexChangeData>();
  readonly m_edgePoint = new UIPointData();
  /** `m_Vertex[4]`: the quad of the button */
  readonly m_Vertex = new VertexUI4();

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.BUTTON;
    this.m_pEdgeTexture = ctx.devices.openTexture("UIEdge.tga");
    [this.m_pSndMouseOver, this.m_pSndMouseUp] = this.openControlSounds(["Button_Mouse_Over", "Button_Mouse_Up"]);
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [this.m_pNormalTex, this.m_pMouseOverTex, this.m_pMouseDownTex, this.m_pDisableTex]) if (t) out.push(t);
    for (const map of [this.m_mapMouseNormalTex, this.m_mapMouseOverTex, this.m_mapMouseDownTex]) {
      for (const d of map.values()) if (d.m_pTexData) out.push(d.m_pTexData);
    }
    for (const s of this.m_StaticControls) s?.textureData(out);
  }

  /**
   * `~CKTDGUIButton` (3292C4C0), then the control's.  The four textures are destroyed (their devices closed), the four points and the string
   * data freed, and the sounds `m_pSndMouseOver` and `m_pSndMouseUp` and the edge texture closed; `m_pSndMouseDown` is not: the exe never
   * closes it (a leaked reference, kept).  Each static of a state that is still in the button's dialog (the dialog handle is valid and
   * `CheckControl` finds it) is sent to where it is, to the colour 0, in 0.07 s, and deleted when it gets there
   * (`Move(m_OffsetPos, 0, 0.07f, true, true, false, 1)`).  Last the textures of the animation steps are destroyed, the maps of the over,
   * normal and down states in this order and each in the order of its keys, and the three maps emptied.
   */
  override Destroy(): void {
    const devices = this.ctx.devices;
    this.m_pNormalTex = destroyTexture(devices, this.m_pNormalTex);
    this.m_pMouseOverTex = destroyTexture(devices, this.m_pMouseOverTex);
    this.m_pMouseDownTex = destroyTexture(devices, this.m_pMouseDownTex);
    this.m_pDisableTex = destroyTexture(devices, this.m_pDisableTex);
    this.m_pNormalPoint = null;
    this.m_pMouseOverPoint = null;
    this.m_pMouseDownPoint = null;
    this.m_pDisablePoint = null;
    this.m_pStringData = null;
    this.m_pSndMouseOver = this.closeHeldDevice(this.m_pSndMouseOver);
    this.m_pSndMouseUp = this.closeHeldDevice(this.m_pSndMouseUp);
    if (this.m_pSndMouseDown) this.leakedSounds.push(this.m_pSndMouseDown); // the destructor never closes it
    this.m_pEdgeTexture = this.closeHeldDevice(this.m_pEdgeTexture);
    for (let i = 0; i < 4; i++) {
      const s = this.m_StaticControls[i];
      if (!s) continue;
      const dialog = this.m_pDialog;
      if (dialog !== null && !dialog.destroyed && dialog.checkControl(s)) s.move(s.m_OffsetPos, new Color(0, 0, 0, 0), f(0.07), true, true, false, 1);
    }
    for (const map of [this.m_mapMouseOverTex, this.m_mapMouseNormalTex, this.m_mapMouseDownTex]) {
      for (const sequenceID of [...map.keys()].sort((a, b) => a - b)) map.get(sequenceID)!.Destroy(devices); // a `std::map<int, ...>` is walked in key order
      map.clear();
    }
    super.Destroy();
  }

  // ---- virtual overrides -----------------------------------------------------------------------------------------------------

  /** `ContainsPoint` (3292D460, the function Slot has too): the control's quadrilateral and, with one, its enable rectangle: `containsPointInEnableRect` */
  override containsPoint(x: number, y: number): boolean {
    return this.containsPointInEnableRect(x, y);
  }

  /**
   * `OnFrameRender` (3292ED40): a shown button draws its quad from `m_NowPoint` (`UpdateVertex`, then `UpdateAnimVertex` with the texture
   * change step it is in, then `RenderVertex`), with the edge before (`DrawEdge(true)`: outside the quad) and after (`DrawEdge(false)`:
   * on it) while it has the focus and an edge width; then its string (stringdraw.ts: the UK font's `OutTextMultiline`, with or without text).
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    const edge = this.m_bHasFocus && this.m_EdgeWidth > 0;
    if (edge) this.drawEdge(true);
    this.updateVertex(this.m_Vertex, this.m_NowPoint);
    this.updateAnimVertex(this.m_Vertex, this.m_NowTexChangeData);
    this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);
    if (edge) this.drawEdge(false);
    if (this.m_pStringData) drawUKString(this.ctx, this, this.m_pStringData, this.m_pStringData.msg);
    return 0;
  }

  /**
   * `OnFrameMove` (3292EA10): a shown button runs the control's, answers the Enter key when it has the focus and an edge (`LButtonMouseUp`:
   * not ported, it throws), moves its current point towards its end point (`ChangePoint`), loses `m_bMouseOver` when a dialog in front of it is not
   * modal (`CheckFrontModalDlg`), runs the texture animation of the state it is in (`UpdateTexChangeData` with the step of the sequence id; a step
   * with another texture gives the state's point that texture, sized from it, and the state is entered again), and then follows the mouse:
   * normal goes to mouse over (or mouse down with `m_bDownStateAtNormal`: both play the over sound) or, when it is disabled, to disable; mouse over
   * goes back to normal (`m_bMouseOut`) when the mouse left, or to disable, and asks for the guide text; mouse down goes to normal or disable;
   * disable goes to normal once it is enabled again.  Returns 0.
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!this.m_bShow) return 0;
    super.onFrameMove(fTime, fElapsedTime);
    const manager = this.ctx.dialogManager;
    if (this.m_bHasFocus && this.m_EdgeWidth > 0 && !manager.checkFrontModalDlg(this.m_pDialog) && this.ctx.keyboard.getKeyState(KEY_ENTER) === 1) {
      throw new Error("CKTDGUIButton::LButtonMouseUp (3292E6D0: the click messages of the Enter key) is not ported");
    }
    this.m_fElapsedTime = f(fElapsedTime);
    if (this.m_EndPoint.fChangeTime !== this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);
    if (this.m_pDialog !== null && this.m_bMouseOver && manager.checkFrontModalDlg(this.m_pDialog)) this.m_bMouseOver = false;
    let point: UIPointData | null = null;
    let steps: Map<number, TexChangeData> | null = null;
    switch (this.m_ButtonState) {
      case BCS.NORMAL: point = this.m_pNormalPoint; steps = this.m_mapMouseNormalTex; break;
      case BCS.MOUSEOVER: point = this.m_pMouseOverPoint; steps = this.m_mapMouseOverTex; break;
      case BCS.MOUSEDOWN: point = this.m_pMouseDownPoint; steps = this.m_mapMouseDownTex; break;
      default: break;
    }
    if (steps && steps.size !== 0 && !this.m_NowTexChangeData.m_bEndTexChange) {
      const step = steps.get(this.m_NowTexChangeData.m_SequenceID) ?? null;
      this.updateTexChangeData(step);
      const texture = step?.m_pTexData ?? null;
      if (texture && point && point.pUITextureData !== texture) {
        point.pUITextureData = texture;
        point.applyTextureSize();
        this.ChangeState(this.m_ButtonState, true);
      }
    }
    switch (this.m_ButtonState) {
      case BCS.NORMAL:
        if (this.m_bOverStateAtNormal) {
          this.ChangeState(BCS.MOUSEOVER, false);
          this.playSound(this.m_pSndMouseOver);
        } else if (this.m_bDownStateAtNormal) {
          this.ChangeState(BCS.MOUSEDOWN, false);
          this.playSound(this.m_pSndMouseOver);
        } else if (this.m_bMouseOver) {
          this.ChangeState(BCS.MOUSEOVER, false);
          this.playSound(this.m_pSndMouseOver);
        } else if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);
        return 0;
      case BCS.MOUSEOVER:
        if (this.m_bOverStateAtNormal) {
          if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);
        } else if (this.m_bDownStateAtNormal) {
          this.ChangeState(this.m_bEnable ? BCS.NORMAL : BCS.DISABLE, false);
        } else if (this.m_bMouseOver) {
          if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);
        } else {
          this.m_bMouseOut = true;
          this.ChangeState(BCS.NORMAL, false);
        }
        this.showGuideDesc();
        return 0;
      case BCS.MOUSEDOWN:
        if (this.m_bDownStateAtNormal || this.m_bMouseOver) {
          if (!this.m_bEnable) this.ChangeState(BCS.DISABLE, false);
        } else this.ChangeState(BCS.NORMAL, false);
        return 0;
      case BCS.DISABLE:
        if (this.m_bShowDescriptionWhenDisable && this.m_bMouseOver) this.showGuideDesc();
        if (this.m_bEnable) this.ChangeState(BCS.NORMAL, false);
        return 0;
      default:
        return 0;
    }
  }

  /**
   * `DrawEdge(bDrawOut)` (3292D750): four bars of the edge texture round (`bDrawOut`) or on the quad of `m_edgePoint`, in `m_EdgeColor`
   * (times the dialog's and the button's colour), each pushed out by `m_EdgeEnlargeValue`; nothing for a width of 0 or without the
   * texture.  It is not the static's code: the bars grow with the enlargement, and the size of the quad is the right-bottom corner's distance
   * from the left-top one in both directions.  The corners are whole pixels (cut after the offsets are added, before the enlargement and
   * the width of the edge texture are added).
   */
  drawEdge(drawOut: boolean): void {
    const render = this.ctx.render;
    const texture = this.m_pEdgeTexture;
    if (this.m_EdgeWidth === 0 || !texture || !render) return;
    const dialog = this.m_pDialog!;
    const dc = dialog.m_Color, cc = this.m_Color, ec = this.m_EdgeColor;
    const argb = (((((clampedByte(f(f(dc.a * ec.a) * cc.a)) << 8) | clampedByte(f(f(dc.r * ec.r) * cc.r))) << 8 |
      clampedByte(f(f(dc.g * ec.g) * cc.g))) << 8) | clampedByte(f(f(dc.b * ec.b) * cc.b))) >>> 0;
    const p = this.m_edgePoint;
    const v45 = ftoi(f(p.rightBottomPoint.x - p.leftTopPoint.x));
    const v46 = ftoi(f(p.rightBottomPoint.y - p.leftTopPoint.y));
    const x = (corner: number): number => f(f(dialog.m_Pos.x + this.m_OffsetPos.x) + corner);
    const y = (corner: number): number => f(f(dialog.m_Pos.y + this.m_OffsetPos.y) + corner);
    const w = this.m_EdgeWidth | 0;
    const e = this.m_EdgeEnlargeValue | 0;
    const lt = p.leftTopPoint, rt = p.rightTopPoint, lb = p.leftBottomPoint;
    const draw = (px: number, py: number, pw: number, ph: number): void => texture.draw(render, px | 0, py | 0, pw | 0, ph | 0, argb, 0);
    if (drawOut) {
      draw(ftoi(f(x(lt.x) - w)) - e, ftoi(f(y(lt.y) - w)) - e, w, v46 + w + 2 * e);
      draw(ftoi(f(x(lt.x) - w)) - e, e + ftoi(y(lb.y)), v45 + e + w, w);
      draw(e + ftoi(x(rt.x)), ftoi(y(lt.y)), w, v46 + e + w);
      draw(ftoi(x(lt.x)), ftoi(f(y(lt.y) - w)) - e, v45 + w + 2 * e, w);
    } else {
      draw(ftoi(x(lt.x)) - e, ftoi(y(lt.y)) - e, w, v46 + 2 * e);
      draw(ftoi(x(lt.x)) - e, e + ftoi(f(y(lb.y) - w)), e + v45, w);
      draw(e + ftoi(f(x(rt.x) - w)), ftoi(y(lt.y)), w, e + v46);
      draw(ftoi(x(lt.x)), ftoi(y(lt.y)) - e, v45 + 2 * e, w);
    }
  }


  /** `SetName` (3292FFE0): the statics are renamed after the button */
  override setName(name: string): boolean {
    if (super.setName(name)) this.reNameStatics();
    return true;
  }

  /** `SetOffsetPos` (329303E0): the statics move with the button */
  override setOffsetPos(pos: Vec2): void {
    this.m_OffsetPos.set(pos.x, pos.y);
    for (const s of this.m_StaticControls) s?.setOffsetPos(pos);
  }

  /** `SetShow` (32930880): showing shows the static of the current state, hiding hides all four */
  override SetShow(show: boolean): void {
    this.m_bShow = show;
    if (show) {
      this.m_StaticControls[this.m_ButtonState]?.SetShow(true);
    } else {
      for (const s of this.m_StaticControls) s?.SetShow(false);
    }
  }

  /** `ReNameStatics` (3292F280): `<name>_Static_Uniqe_Button_<i>` for every static, once the button is in a dialog */
  reNameStatics(): void {
    for (let i = 0; i < 4; i++) {
      const s = this.m_StaticControls[i];
      if (s && this.m_pDialog) s.setName(clip255(`${this.m_Name}_Static_Uniqe_Button_${i}`));
    }
  }

  /** `SetCustomMouseOverSound(wstring)` (3292F680): opens the sound (the old one is not closed: its reference is leaked) */
  override setCustomMouseOverSound(soundFileName: string): void {
    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);
    this.m_pSndMouseOver = this.ctx.devices.openSound(soundFileName);
  }

  /** `SetCustomMouseUpSound(wstring)` (3292F730): the same for the sound of the mouse button going up */
  override setCustomMouseUpSound(soundFileName: string): void {
    if (this.m_pSndMouseUp) this.leakedSounds.push(this.m_pSndMouseUp);
    this.m_pSndMouseUp = this.ctx.devices.openSound(soundFileName);
  }

  // ---- state -----------------------------------------------------------------------------------------------------------------

  /** the point a state shows (the over and down states fall back to the normal point, the disabled one too) */
  private pointOf(state: number): UIPointData | null {
    switch (state) {
      case BCS.NORMAL: return this.m_pNormalPoint;
      case BCS.MOUSEOVER: return this.m_pMouseOverPoint ?? this.m_pNormalPoint;
      case BCS.MOUSEDOWN: return this.m_pMouseDownPoint ?? this.m_pNormalPoint;
      default: return this.m_pDisablePoint ?? this.m_pNormalPoint;
    }
  }

  /**
   * `ChangeState(state, bForce)` (3292D020): a new state resets the running texture animation (unless forced); the point of the state
   * becomes the end point of the transition (and the current one at once when it has no transition time); entering a state sends the
   * stage its message (mouse out 0x467 with the custom id; over / down 0x466 with 0 / 1 or 0x467 with the custom id, then the custom
   * function name as 0x468); the statics show the one of the state.
   */
  ChangeState(state: number, bForce: boolean): void {
    if (this.m_ButtonState === state) {
      if (!bForce) return;
    } else {
      this.m_ButtonState = state;
      if (!bForce) {
        const d = this.m_NowTexChangeData;
        d.m_SequenceID = 0;
        d.m_fShowTime = 0;
        d.m_bEndTexChange = false;
        d.m_fRotateDegree = 0;
        d.m_fScaleRotationDegree = 0;
        d.m_Pos.set(0, 0);
        d.m_Scale.set(1, 1);
      }
    }
    this.m_ButtonState = state;
    switch (state) {
      case BCS.NORMAL: {
        if (this.m_bMouseOut) {
          this.m_bMouseOut = false;
          if (this.m_CustomMsgMouseOut !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOut);
        }
        const p = this.m_pNormalPoint;
        if (p) {
          this.m_EndPoint.assign(p);
          this.m_NowPoint.fChangeTime = 0;
        }
        break;
      }
      case BCS.MOUSEOVER:
      case BCS.MOUSEDOWN: {
        const over = state === BCS.MOUSEOVER;
        const p = this.pointOf(state);
        const custom = over ? this.m_CustomMsgMouseOver : this.m_CustomMsgMouseDown;
        // (a button without a normal point has nothing to enter: the exe dereferences null there; not reproduced)
        if (p) this.m_EndPoint.assign(p);
        this.m_NowPoint.fChangeTime = 0;
        if (custom === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, over ? 0 : 1);
        else this.sendInternelEvent(UIM.CUSTOM_MSG, custom);
        const func = over ? this.m_CustomFuncMouseOver : this.m_CustomFuncMouseDown;
        if (func.length !== 0) this.sendInternelEvent(UIM.CUSTOM_FUNC, func);
        break;
      }
      case BCS.DISABLE: {
        const p = this.pointOf(state);
        if (p) this.m_EndPoint.assign(p);
        this.m_NowPoint.fChangeTime = 0;
        if (this.m_bHasFocus && this.m_pDialog) this.m_pDialog.clearFocus();
        break;
      }
      default:
        break;
    }
    for (const s of this.m_StaticControls) s?.SetShow(false);
    this.m_StaticControls[this.m_ButtonState]?.SetShow(true);
    if (this.m_EndPoint.fChangeTime === 0) {
      this.m_NowPoint.assign(this.m_EndPoint);
      this.m_edgePoint.assign(this.m_EndPoint);
    }
  }

  // ---- textures and points (the Lua-registered setters) ----------------------------------------------------------------------

  /** the texture setters: the old texture data is released, the new one (null when the file does not open) goes to the point as well */
  private replaceTex(old: UITextureData | null, point: UIPointData | null, fileName: string, key: string): UITextureData | null {
    old?.Destroy(this.ctx.devices);
    const data = setTexureData(this.ctx, fileName, key);
    if (point) point.pUITextureData = data;
    return data;
  }

  /** `SetNormalTex_LUA(file, key)` (32930230) */
  SetNormalTex(fileName: string, key: string): void {
    this.m_pNormalTex = this.replaceTex(this.m_pNormalTex, this.m_pNormalPoint, fileName, key);
    this.ChangeState(this.m_ButtonState, true);
  }

  /** `SetOverTex_LUA(file, key)` (329306A0) */
  SetOverTex(fileName: string, key: string): void {
    this.m_pMouseOverTex = this.replaceTex(this.m_pMouseOverTex, this.m_pMouseOverPoint, fileName, key);
    this.ChangeState(this.m_ButtonState, true);
  }

  /** `SetDownTex_LUA(file, key)` (3292FD70) */
  SetDownTex(fileName: string, key: string): void {
    this.m_pMouseDownTex = this.replaceTex(this.m_pMouseDownTex, this.m_pMouseDownPoint, fileName, key);
    this.ChangeState(this.m_ButtonState, true);
  }

  /** `SetDisableTex_LUA(file, key)` (3292F980) */
  SetDisableTex(fileName: string, key: string): void {
    this.m_pDisableTex = this.replaceTex(this.m_pDisableTex, this.m_pDisablePoint, fileName, key);
    this.ChangeState(this.m_ButtonState, true);
  }

  /** the point setters: the table on top of the stack is the point; it shows the state's texture, sized from it when asked to */
  private newPoint(tex: UITextureData | null): UIPointData {
    const p = readPointData(this.ctx);
    p.pUITextureData = tex;
    return p;
  }

  /** `SetNormalPoint_LUA()` (329300D0) */
  SetNormalPoint(): void {
    const p = (this.m_pNormalPoint = this.newPoint(this.m_pNormalTex));
    p.applyTextureSize();
    this.ChangeState(this.m_ButtonState, true);
  }

  /**
   * `SetOverPoint_LUA()` (329304F0): without a texture of its own the point shows the animation step 0 of the over state when there is one
   */
  SetOverPoint(): void {
    const p = (this.m_pMouseOverPoint = this.newPoint(this.m_pMouseOverTex));
    if (p.pUITextureData === null && this.m_mapMouseOverTex.size !== 0) {
      const step0 = this.m_mapMouseOverTex.get(0);
      if (step0) p.pUITextureData = step0.m_pTexData;
    }
    p.applyTextureSize();
    this.ChangeState(this.m_ButtonState, true);
  }

  /** `SetDownPoint_LUA()` (3292FC00) */
  SetDownPoint(): void {
    const p = (this.m_pMouseDownPoint = this.newPoint(this.m_pMouseDownTex));
    p.applyTextureSize();
    this.ChangeState(this.m_ButtonState, true);
  }

  /** `SetDisablePoint_LUA()` (3292F890) */
  SetDisablePoint(): void {
    const p = (this.m_pDisablePoint = this.newPoint(this.m_pDisableTex));
    p.applyTextureSize();
    this.ChangeState(this.m_ButtonState, true);
  }

  /** `SetNormalAnimTex_LUA()` (32930000): the table on top of the stack is one animation step */
  SetNormalAnimTex(): void {
    this.addTexChangeData(this.m_mapMouseNormalTex, this.m_pNormalPoint, readTexChangeData(this.ctx));
  }

  /** `SetOverAnimTex_LUA()` (32930420) */
  SetOverAnimTex(): void {
    this.addTexChangeData(this.m_mapMouseOverTex, this.m_pMouseOverPoint, readTexChangeData(this.ctx));
  }

  /** `SetDownAnimTex_LUA()` (3292FB30) */
  SetDownAnimTex(): void {
    this.addTexChangeData(this.m_mapMouseDownTex, this.m_pMouseDownPoint, readTexChangeData(this.ctx));
  }

  // ---- statics ---------------------------------------------------------------------------------------------------------------

  private setStatic(index: number, pStatic: CKTDGUIStatic | undefined): void {
    this.m_StaticControls[index] = pStatic ?? null;
    if (pStatic) pStatic.setOffsetPos(this.m_OffsetPos);
    this.reNameStatics();
    this.ChangeState(this.m_ButtonState, true);
  }

  /** `SetNormalStatic_LUA(CKTDGUIStatic*)` (32930180) */
  SetNormalStatic(pStatic: CKTDGUIStatic | undefined): void {
    this.setStatic(BCS.NORMAL, pStatic);
  }

  /** `SetOverStatic_LUA(CKTDGUIStatic*)` (329305F0) */
  SetOverStatic(pStatic: CKTDGUIStatic | undefined): void {
    this.setStatic(BCS.MOUSEOVER, pStatic);
  }

  /** `SetDownStatic_LUA(CKTDGUIStatic*)` (3292FCC0) */
  SetDownStatic(pStatic: CKTDGUIStatic | undefined): void {
    this.setStatic(BCS.MOUSEDOWN, pStatic);
  }

  /** `SetDisableStatic_LUA(CKTDGUIStatic*)` (3292F940) */
  SetDisableStatic(pStatic: CKTDGUIStatic | undefined): void {
    this.setStatic(BCS.DISABLE, pStatic);
  }

  /** `SetString_LUA()` (329308E0): the button's text, from the table on top of the stack */
  SetString(): void {
    this.m_pStringData = readStringData(this.ctx);
    this.ChangeState(this.m_ButtonState, true);
  }

  // ---- messages, functions, edge, sounds -------------------------------------------------------------------------------------

  /** `SetCustomMsgMouseOut(int)` (328CD1C0) */
  SetCustomMsgMouseOut(msg: number): void {
    this.m_CustomMsgMouseOut = msg | 0;
  }

  /** `SetCustomMsgMouseOver(int)` (328CD1F0) */
  SetCustomMsgMouseOver(msg: number): void {
    this.m_CustomMsgMouseOver = msg | 0;
  }

  /** `SetCustomMsgMouseDown(int)` (328CD190) */
  SetCustomMsgMouseDown(msg: number): void {
    this.m_CustomMsgMouseDown = msg | 0;
  }

  /** `SetCustomMsgMouseUp(int)` (328CD240) */
  SetCustomMsgMouseUp(msg: number): void {
    this.m_CustomMsgMouseUp = msg | 0;
  }

  /** `SetCustomMsgMouseRightUp(int)` (328CD220) */
  SetCustomMsgMouseRightUp(msg: number): void {
    this.m_CustomMsgMouseRightUp = msg | 0;
  }

  /** `SetCustomMsgMouseDblClk(int)` (328CD0E0; the exe shares the setter with `CKTDGUIEditBox::SetCustomMsgChange`) */
  SetCustomMsgMouseDblClk(msg: number): void {
    this.m_CustomMsgMouseDblClk = msg | 0;
  }

  /** `SetCustomFuncMouseOver(const char*)` (328CD0A0) */
  SetCustomFuncMouseOver(funcName: string | undefined): void {
    this.m_CustomFuncMouseOver = funcName ?? "";
  }

  /** `SetCustomFuncMouseDown(const char*)` (328CD080) */
  SetCustomFuncMouseDown(funcName: string | undefined): void {
    this.m_CustomFuncMouseDown = funcName ?? "";
  }

  /** `SetCustomFuncMouseUp(const char*)` (328CD0C0) */
  SetCustomFuncMouseUp(funcName: string | undefined): void {
    this.m_CustomFuncMouseUp = funcName ?? "";
  }

  /** `SetEnableClick(bool)` (328CD420) */
  SetEnableClick(enable: boolean): void {
    this.m_bEnableClick = enable;
  }

  /** `SetEdge(bool, int, D3DXCOLOR)` (3292FF50) */
  SetEdge(drawOut: boolean, width: number, color: Color): void {
    this.m_bDrawEdgeOut = drawOut;
    this.m_EdgeWidth = width | 0;
    this.m_EdgeColor.set(color.r, color.g, color.b, color.a);
  }

  /** `SetEdge2(bool, int, D3DXCOLOR, int)` (3292FF20) */
  SetEdge2(drawOut: boolean, width: number, color: Color, enlargeValue: number): void {
    this.m_bDrawEdgeOut = drawOut;
    this.m_EdgeWidth = width | 0;
    this.m_EdgeColor.set(color.r, color.g, color.b, color.a);
    this.m_EdgeEnlargeValue = enlargeValue | 0;
  }

  /**
   * `ChangeMouseOverSound_LUA(const char*)` (3292CC90; `ChangeMouseOverSound` 3292CBF0 is the wide-string twin): the old sound is closed,
   * the new one opened (null for an empty name)
   */
  ChangeMouseOverSound_LUA(fileName: string): void {
    if (this.m_pSndMouseOver) this.ctx.devices.closeDevice(this.m_pSndMouseOver.deviceID);
    this.m_pSndMouseOver = this.ctx.devices.openSound(fileName);
  }

  /** `ChangeMouseUpSound_LUA(const char*)` (3292CEA0) */
  ChangeMouseUpSound_LUA(fileName: string): void {
    if (this.m_pSndMouseUp) this.ctx.devices.closeDevice(this.m_pSndMouseUp.deviceID);
    this.m_pSndMouseUp = this.ctx.devices.openSound(fileName);
  }

  /** `ChangeMouseDownSound_LUA(const char*)` (3292CAA0) */
  ChangeMouseDownSound_LUA(fileName: string): void {
    if (this.m_pSndMouseDown) this.ctx.devices.closeDevice(this.m_pSndMouseDown.deviceID);
    this.m_pSndMouseDown = this.ctx.devices.openSound(fileName);
  }
}
