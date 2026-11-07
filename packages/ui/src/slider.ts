/**
 * `CKTDGUISlider` (the Lua class `CKTDGUISlider`, a `CKTDGUIControl`): DXUT's `CDXUTSlider`, a button on a bar that picks a value between
 * a minimum and a maximum.  `CKTDGUIDialog::CreateSlider` 328C18D0 (sizeof 0x344).
 *
 * Constructor 3294C6B0: no sounds; a range of 0..100 with the value 50, a position, size and button of 0, no textures, not pressed, no
 * custom message.  `UpdateRects` (3294D290, virtual slot 42, so every setter that moves something goes through it) does nothing until the
 * slider has a width and a height; then a button of no size is as high and as wide as the slider is high (a square), the button is centred
 * vertically and put where the value is: `(int)((float)(value - min) * (float)width / (float)(max - min))` from the left, its middle there
 * (an empty range divides by zero in floating point: the conversion gives 0x80000000).
 *
 * The Lua methods: SetBGTex_LUA 3294CEC0, SetButtonTex_LUA 3294D050, SetPos 328CDB50, SetSize 328CE020, SetButtonSize 328CCEC0, SetRange
 * 3294D1E0 (keeps the value in the new range, which sends the message if it moves), SetValue 328CE3B0 and SetCustomMsgValueChanged 328CD2E0.
 * `SetValueInternal` (3294D210) clamps the value into the range and, if that changes it, updates the rectangles and sends the custom
 * message, or without one the control event 0x466 with 0.
 *
 * `OnFrameRender` (3294CD20) draws the background and the button.  Not ported: what the slider does while the game runs (`HandleMouse`,
 * `OnFrameMove`).
 */
import type { CKTDGUISlider_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIM, UIPointData } from "./control.ts";
import type { UIContext, UITextureData } from "./control.ts";
import { ftoi, idiv, newRect, offsetRect, setRect } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { VertexUI4 } from "./render.ts";

const f = Math.fround;

export class CKTDGUISlider extends CKTDGUIControl implements Partial<CKTDGUISlider_Methods> {
  m_x = 0;
  m_y = 0;
  m_width = 0;
  m_height = 0;
  m_iButtonWidth = 0;
  m_iButtonHeight = 0;
  readonly m_TempPoint = new UIPointData();
  m_pBGTex: UITextureData | null = null;
  m_pButtonTex: UITextureData | null = null;
  m_CustomMsgValueChanged = -1;
  m_nValue = 50;
  m_nMin = 0;
  m_nMax = 100;
  m_nDragX = 0;
  m_nDragOffset = 0;
  /** not set by the constructor: the heap as it was (zero here) */
  m_nButtonX = 0;
  m_bPressed = false;
  readonly m_rcButton: Rect = newRect();
  readonly m_rcBoundingBox: Rect = newRect();
  /** `m_Vertex[4]`: the quad being drawn */
  readonly m_Vertex = new VertexUI4();

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.SLIDER;
  }

  override textureData(out: UITextureData[]): void {
    if (this.m_pBGTex) out.push(this.m_pBGTex);
    if (this.m_pButtonTex) out.push(this.m_pButtonTex);
  }

  /**
   * `OnFrameRender` (3294CD20): a shown slider draws two quads with its scratch point `m_TempPoint`: the bounding box with the background
   * texture, then the button's rectangle with the button texture.  The corners of the point are the rectangle's (as floats); the point
   * keeps the texture data it had when the slider has no texture for the quad (a slider with no background texture still goes through
   * `UpdateVertex` and `RenderVertex`: with no texture data the vertex keeps its UVs and nothing is drawn).
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    const point = this.m_TempPoint;
    for (const [rc, tex] of [[this.m_rcBoundingBox, this.m_pBGTex], [this.m_rcButton, this.m_pButtonTex]] as const) {
      point.leftTopPoint.set(rc.left, rc.top);
      point.rightTopPoint.set(rc.right, rc.top);
      point.leftBottomPoint.set(rc.left, rc.bottom);
      point.rightBottomPoint.set(rc.right, rc.bottom);
      if (tex) point.pUITextureData = tex;
      this.updateVertex(this.m_Vertex, point);
      this.renderVertex(this.m_Vertex, point, 1);
    }
    return 0;
  }

  SetBGTex(file: string, key: string): void {
    this.m_pBGTex = this.replaceTexture(this.m_pBGTex, file, key);
  }

  SetButtonTex(file: string, key: string): void {
    this.m_pButtonTex = this.replaceTexture(this.m_pButtonTex, file, key);
  }

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

  SetButtonSize(width: number, height: number): void {
    this.m_iButtonWidth = width | 0;
    this.m_iButtonHeight = height | 0;
    this.updateRects();
  }

  /** `SetRange(nMin, nMax)` (3294D1E0) */
  SetRange(min: number, max: number): void {
    this.m_nMin = min | 0;
    this.m_nMax = max | 0;
    this.setValueInternal(this.m_nValue, false);
  }

  /** `SetValue(nValue)` (328CE3B0) */
  SetValue(value: number): void {
    this.setValueInternal(value | 0, false);
  }

  SetCustomMsgValueChanged(msg: number): void {
    this.m_CustomMsgValueChanged = msg | 0;
  }

  /** `SetValueInternal(nValue, bFromInput)` (3294D210): `min(max, max(nValue, min))`; a value that moves updates the rectangles and tells the stage */
  setValueInternal(value: number, fromInput: boolean): void {
    void fromInput;
    let v = value | 0;
    if (this.m_nMin > v) v = this.m_nMin;
    if (this.m_nMax < v) v = this.m_nMax; // `if (max >= v) v = ...` of the exe: the smaller of the two
    if (v === this.m_nValue) return;
    this.m_nValue = v;
    this.updateRects();
    const custom = this.m_CustomMsgValueChanged;
    if (custom === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 0);
    else this.sendInternelEvent(UIM.CUSTOM_MSG, custom);
  }

  /** `UpdateRects()` (3294D290), virtual slot 42 */
  updateRects(): void {
    if (this.m_width === 0 || this.m_height === 0) return;
    if (this.m_iButtonHeight === 0) this.m_iButtonHeight = this.m_height;
    if (this.m_iButtonWidth === 0) this.m_iButtonWidth = this.m_height; // the button is a square when it has no width of its own
    setRect(this.m_rcBoundingBox, this.m_x, this.m_y, this.m_width + this.m_x, this.m_y + this.m_height);
    setRect(this.m_rcButton, this.m_x, this.m_y, this.m_x + this.m_iButtonWidth, this.m_y + this.m_iButtonHeight);
    offsetRect(this.m_rcButton, 0, idiv((this.m_height - this.m_iButtonHeight) | 0, 2));
    const along = f(f(f((this.m_nValue - this.m_nMin) | 0) * f(this.m_width)) / f((this.m_nMax - this.m_nMin) | 0));
    this.m_nButtonX = ftoi(along);
    offsetRect(this.m_rcButton, (this.m_nButtonX - idiv(this.m_iButtonWidth, 2)) | 0, 0);
  }
}
