/**
 * The slots: `CKTDGUISlot` (the control that shows an item picture and can be dragged) and the game-layer `CX2SlotManager` /
 * `CX2SlotManager::CX2Slot` / `CX2SlotItem` that DLG scripts reach through the global `g_pCX2SlotManager`.
 *
 * `CX2SlotManager::RegisterLuaBind` (32E5E840) puts the manager into the global `g_pCX2SlotManager`; the UI classes that derive from it
 * (the inventory, the shops, the quick slot ...) call it before they build their dialog, so the script of the dialog finds it.  The
 * script asks it for slots (`CreateItemSlot` 32E5E540: a `CX2SlotItem`, 0x128 bytes), hands each back (`AddSlot` 32E5E510: the slot learns
 * its manager, the manager keeps a list) and describes it (`CX2Slot::SetSlotData_LUA` 32E5DAE0, which first lets the slot read its own
 * keys: `CX2Slot::LuaGetValue` 32E5DD90 for SLOT_ID, ENABLE, SHOW, SLOT_TYPE, then `CX2SlotItem::LuaGetValue` 331CAAA0 for SORT_TYPE,
 * FASHION, EQUIP_POS, SLOT_DESC; afterwards POS and SIZE).  A `SLOT_BACK_DLG_FILE` key would open a second dialog in the manager's
 * layer; no script of the client has one, so that is reported as not ported.
 *
 * `CKTDGUISlot::CKTDGUISlot` 329507F0, SetItemTex_LUA 32953E40 (-> SetItemTex(file, key) 329535F0), SetItemTex_LUA2 32953B00,
 * SetMouseOverTex_LUA 32954140, SetPoint_LUA 329543F0, SetMouseOverPoint_LUA 32954030, SetString_LUA 32954570,
 * SetAllPointDatabyNormalPoint 329534D0, ChangeState 32950FB0, SetEnable 329535C0, SetShow 329544F0.  The drawing: OnFrameRender 32952670,
 * DrawEdge 32951310, RenderDragSlot 32952DD0, UpdateDraggingVertex 329545B0.
 */
import { D3DRS } from "@els/d3d9";
import { Color, KLuaManager, Vec2 } from "@els/host";
import type { CKTDGUISlot_Methods, CX2CouponBox_Methods, CX2PostBox_Methods, CX2SlotManager_Methods, CX2SlotManager__CX2Slot_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIM, UIPointData, clampedByte, readStringData, setTexureData, wholeTextureData } from "./control.ts";
import type { CPictureData, UIContext, UIStringData, UITextureData } from "./control.ts";
import type { DeviceSound, DeviceTexture } from "./device.ts";
import { ftoi } from "./rect.ts";
import { DIALOG_SAMPLER_STATES, RSI_UI_DIALOG, VertexUI4 } from "./render.ts";
import { drawUKString } from "./stringdraw.ts";

const f = Math.fround;

/** `CKTDGUISlot::SLOT_CONTROL_STATE` */
export const SCS = { NORMAL: 0, DOWN: 1, MOUSEOVER: 2, ONDRAG: 3, DISABLE: 4, END: 5 } as const;

/** the texture the slot shows when an item's picture does not open (`CKTDGUISlot::vftable[42]`) */
export const SLOT_NO_IMAGE = "HQ_Shop_Ui_Noimage.dds";

/** `CKTDGUISlotData` (the data a slot shows; only the flag the slot sets is modelled) */
export interface UISlotData {
  m_bDataUpdated: boolean;
  /** the virtual `UpdateUI(slot)` of the game's data class: puts what the data holds into the slot's textures and strings */
  UpdateUI(slot: CKTDGUISlot): void;
}

export class CKTDGUISlot extends CKTDGUIControl implements Partial<CKTDGUISlot_Methods> {
  /** `CKTDGUISlot::s_pDragSlot`: the slot that is being dragged */
  static s_pDragSlot: CKTDGUISlot | null = null;

  /** `ReturnDraggingItem()` (329534A0): the slot being dragged goes back to the normal state (forced) and nobody is dragging */
  static returnDraggingItem(): void {
    const dragged = CKTDGUISlot.s_pDragSlot;
    if (dragged !== null) {
      dragged.ChangeState(SCS.NORMAL, true);
      CKTDGUISlot.s_pDragSlot = null;
    }
  }

  m_pItemTex: UITextureData | null = null;
  m_pMouseOverTex: UITextureData | null = null;
  m_pStringData: UIStringData | null = null;
  m_pNormalPoint: UIPointData | null = null;
  m_pMouseOverPoint: UIPointData | null = null;
  m_pDraggingPoint: UIPointData | null = null;
  m_bDragable = true;
  readonly m_cDraggingSlotColor = new Color(1, 1, 1, 1);
  readonly m_cDraggedSlotColor = new Color(1, 1, 1, 0.4);
  readonly m_cNormalSlotColor = new Color(1, 1, 1, 1);
  readonly m_cMouseOverColor = new Color(1, 1, 1, 1);
  /** `m_mapAdditionalPictureDataList` (`std::map<int, CPictureData*>`) */
  readonly m_mapAdditionalPictureDataList = new Map<number, CPictureData>();
  m_pDroppedSlot: CKTDGUISlot | null = null;
  m_eControlState: number = SCS.NORMAL;
  m_pSndMouseOver: DeviceSound | undefined;
  m_pSndMouseUp: DeviceSound | undefined;
  m_pSndMouseDown: DeviceSound | undefined;
  m_CustomMsgMouseOut = -1;
  m_CustomMsgMouseOver = -1;
  m_CustomMsgMouseDown = -1;
  m_CustomMsgMouseUp = -1;
  m_CustomMsgMouseRightUp = -1;
  m_CustomMsgDropped = -1;
  m_bMouseOut = false;
  m_pSlotData: UISlotData | null = null;
  m_iID = -1;
  /** `UIEdge.tga` */
  readonly m_pEdgeTexture: DeviceTexture | undefined;
  /** `m_Vertex[4]`: the quad being drawn */
  readonly m_Vertex = new VertexUI4();
  /** `m_DragVertex[4]`: the quad of the slot being dragged, which follows the mouse */
  readonly m_DragVertex = new VertexUI4();

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.SLOT;
    this.m_pEdgeTexture = ctx.devices.openTexture("UIEdge.tga");
  }

  /**
   * `OnFrameMove` (32952430): a shown slot runs the control's, moves its current point towards its end point, loses `m_bMouseOver` when a
   * dialog in front of it is not modal, lets updated slot data refresh the slot (`UpdateUI`), and follows the mouse: normal goes to mouse over (with
   * the over sound), mouse down and mouse over go back to normal (mouse over sets `m_bMouseOut` and asks for the guide text), a dragged slot that does
   * not have the focus any more is returned (`ReturnDraggingItem`) and goes to normal, a disabled one goes to normal once enabled again, and one that
   * is not enabled becomes disabled.  Last, the additional pictures (`m_mapAdditionalPictureDataList`, in key order) that are shown move.
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!this.m_bShow) return 0;
    super.onFrameMove(fTime, fElapsedTime);
    this.m_fElapsedTime = Math.fround(fElapsedTime);
    if (this.m_EndPoint.fChangeTime !== this.m_NowPoint.fChangeTime) this.changePoint(this.m_NowPoint, this.m_EndPoint);
    if (this.m_pDialog !== null && this.m_bMouseOver && this.ctx.dialogManager.checkFrontModalDlg(this.m_pDialog)) this.m_bMouseOver = false;
    const data = this.m_pSlotData;
    if (data !== null && data.m_bDataUpdated) {
      data.UpdateUI(this);
      data.m_bDataUpdated = false;
    }
    const disableIfNotEnabled = (): void => {
      if (!this.m_bEnable) this.ChangeState(SCS.DISABLE, false);
    };
    const normal = (): void => this.ChangeState(SCS.NORMAL, false);
    switch (this.m_eControlState) {
      case SCS.NORMAL:
        if (!this.m_bMouseOver) disableIfNotEnabled();
        else {
          this.ChangeState(SCS.MOUSEOVER, false);
          this.playSound(this.m_pSndMouseOver);
        }
        break;
      case SCS.DOWN:
        if (!this.m_bMouseOver) normal();
        else disableIfNotEnabled();
        break;
      case SCS.MOUSEOVER:
        this.showGuideDesc();
        if (this.m_bMouseOver) disableIfNotEnabled();
        else {
          this.m_bMouseOut = true;
          normal();
        }
        break;
      case SCS.ONDRAG:
        disableIfNotEnabled();
        if (!this.m_bHasFocus) {
          CKTDGUISlot.returnDraggingItem();
          normal();
        }
        break;
      case SCS.DISABLE:
        if (this.m_bShowDescriptionWhenDisable && this.m_bMouseOver) this.showGuideDesc();
        if (this.m_bEnable) normal();
        break;
      default:
        break;
    }
    for (const picture of this.additionalPictures()) if (picture.bShow) picture.onFrameMove(fTime, fElapsedTime);
    return 0;
  }

  /** `m_mapAdditionalPictureDataList` walked the way a `std::map<int, ...>` is: in the order of the keys */
  private additionalPictures(): CPictureData[] {
    return [...this.m_mapAdditionalPictureDataList.keys()].sort((a, b) => a - b).map((key) => this.m_mapAdditionalPictureDataList.get(key)!);
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [this.m_pItemTex, this.m_pMouseOverTex]) if (t) out.push(t);
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------------------

  /**
   * `OnFrameRender` (32952670): a shown slot draws the quad of its current point (`m_NowPoint`: the item's picture) once; while the mouse is over
   * it, it is not being dragged and it is enabled, the quad of the mouse over point on top of that; then its additional pictures, in the order
   * of their keys, each one that is shown and has a point and a loaded texture the way a static draws a picture (the edge when `m_EdgeWidth` is
   * not 0, the quad with the point's two blend states pushed round `RenderVertex(..., m_iDrawCount)`, the edge again); last the slot's string.
   *
   * The string (only when `SetString` made one: `fontIndex` is the first member of the string data, so the exe's `&m_pStringData->fontIndex != 0`
   * is a test of the data) is always the UK font's `OutTextMultiline` of the whole message (no `USE_UK_FONT`, no spreading), and it is called
   * even for an empty message.  A font index nobody made a font for is the exe's crash (a null font; the port throws), and so is a mouse over
   * a slot without a mouse over point (a null dereference).
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    this.updateVertex(this.m_Vertex, this.m_NowPoint);
    this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);
    if (this.m_bMouseOver && this.m_eControlState !== SCS.ONDRAG && this.m_bEnable) {
      const over = this.m_pMouseOverPoint;
      if (!over) throw new Error("CKTDGUISlot::OnFrameRender: the mouse is over a slot that has no mouse over point (SetPoint makes it); the exe dereferences null");
      this.updateVertex(this.m_Vertex, over);
      this.renderVertex(this.m_Vertex, over, 1);
    }
    const render = this.ctx.render;
    for (const picture of this.additionalPictures()) {
      const point = picture.pPoint;
      if (!(picture.bShow && point && picture.pTexture && picture.pTexture.pTexture)) continue;
      if (picture.m_EdgeWidth !== 0) this.drawEdge(picture.m_bDrawEdgeOut, picture.m_EdgeWidth, picture.m_EdgeColor, point);
      this.updateVertex(this.m_Vertex, point);
      const top = render?.states.stackPointer ?? 0;
      render?.states.setRenderState(D3DRS.SRCBLEND, point.m_eSrcBlend);
      render?.states.setRenderState(D3DRS.DESTBLEND, point.m_eDestBlend);
      this.renderVertex(this.m_Vertex, point, point.m_iDrawCount);
      render?.states.popTo(top);
      if (picture.m_EdgeWidth !== 0) this.drawEdge(picture.m_bDrawEdgeOut, picture.m_EdgeWidth, picture.m_EdgeColor, point);
    }
    const data = this.m_pStringData;
    if (data) drawUKString(this.ctx, this, data, data.msg);
    return 0;
  }

  /**
   * `DrawEdge(bDrawOut, edgeWidth, edgeColor, pPoint)` (32951310): the edge of a picture, the same eight bars of `UIEdge.tga` the static's `DrawEdge`
   * draws (`drawEdgeBars`): round the quad of `pPoint` or on it; nothing for a width of 0, without the edge texture or without a point.  The size
   * of the quad is taken from the right-top corner (width) and the right-bottom one (height).
   */
  drawEdge(drawOut: boolean, edgeWidth: number, edgeColor: Color, point: UIPointData | null): void {
    if (edgeWidth === 0 || !this.m_pEdgeTexture || !point) return;
    const nWidth = ftoi(f(point.rightTopPoint.x - point.leftTopPoint.x));
    const nHeight = ftoi(f(point.rightBottomPoint.y - point.leftTopPoint.y));
    this.drawEdgeBars(this.m_pEdgeTexture, drawOut, edgeWidth, edgeColor, point, nWidth, nHeight);
  }

  /**
   * `UpdateDraggingVertex(vertexLT, vertexRT, vertexLB, vertexRB, pointData)` (329545B0): `UpdateVertex` for the slot that is being dragged.  The
   * corners of the point are only scaled to the back buffer (the dialog's position and the control's offset are not added: the point is where the
   * mouse is) and the colour is the point's alone (the dialog's and the control's are not multiplied in); the corners are then cut to whole pixels
   * and moved half a pixel up and left, and the texture coordinates come from the point's texture.  A slot in no dialog changes nothing.
   */
  updateDraggingVertex(vertex: VertexUI4, point: UIPointData): void {
    if (!this.m_pDialog) return;
    const scale = this.ctx.render?.resolutionScale;
    const sx = scale ? scale.x : 1, sy = scale ? scale.y : 1;
    const c = point.color;
    const argb = ((((clampedByte(c.a) << 8) | clampedByte(c.r)) << 8 | clampedByte(c.g)) << 8 | clampedByte(c.b)) >>> 0;
    const corners = [point.leftTopPoint, point.rightTopPoint, point.leftBottomPoint, point.rightBottomPoint];
    for (let i = 0; i < 4; i++) {
      const corner = corners[i]!;
      vertex.setX(i, f(sx * corner.x));
      vertex.setY(i, f(sy * corner.y));
      vertex.setZ(i, 1);
      vertex.setRhw(i, 1);
      vertex.setColor(i, argb);
    }
    const texture = point.pUITextureData;
    if (texture) {
      for (let i = 0; i < 4; i++) {
        vertex.setU(i, texture.uvTexture[i]!.x);
        vertex.setV(i, texture.uvTexture[i]!.y);
      }
    }
    for (let i = 0; i < 4; i++) {
      vertex.setX(i, f(f(ftoi(vertex.x(i))) - 0.5));
      vertex.setY(i, f(f(ftoi(vertex.y(i))) - 0.5));
    }
  }

  /**
   * `RenderDragSlot()` (32952DD0), which the dialog manager calls for `s_pDragSlot` once the dialogs are drawn.  It pushes the states a dialog
   * draws its controls with (the ten sampler states and `m_RSICKTDGUIDialog`, as `CKTDGUIDialog::OnFrameRender` does) and, for a slot that is
   * being dragged, has the focus and whose normal point has a texture, puts the quad of the dragging point on the mouse and draws it: the
   * quad keeps its size (the width from the right-top corner, the height from the left-bottom one) and is centred on the mouse position divided
   * by the resolution scale, in layout pixels; `UpdateDraggingVertex`, `RenderVertex(m_DragVertex, m_pDraggingPoint, 1)`.  Then the states are popped.
   * The dragging point is made by `SetPoint`; without it the exe dereferences null.
   */
  renderDragSlot(): number {
    const states = this.ctx.render?.states;
    const top = states?.stackPointer ?? 0;
    if (states) {
      for (const s of DIALOG_SAMPLER_STATES) states.setSamplerState(s.stage, s.type, s.value);
      states.apply(RSI_UI_DIALOG);
    }
    const normal = this.m_pNormalPoint;
    if (this.m_eControlState === SCS.ONDRAG && this.m_bHasFocus && normal && normal.pUITextureData) {
      const drag = this.m_pDraggingPoint;
      if (!drag) throw new Error("CKTDGUISlot::RenderDragSlot: the dragged slot has no dragging point (SetPoint makes it); the exe dereferences null");
      const scale = this.ctx.render?.resolutionScale;
      const x = f(f(this.ctx.mouse.GetXPos()) / (scale ? scale.x : 1));
      const y = f(f(this.ctx.mouse.GetYPos()) / (scale ? scale.y : 1));
      const halfWidth = f(f(drag.rightTopPoint.x - drag.leftTopPoint.x) * 0.5);
      const halfHeight = f(f(drag.leftBottomPoint.y - drag.leftTopPoint.y) * 0.5);
      const left = f(-halfWidth + x), right = f(halfWidth + x);
      const upper = f(-halfHeight + y), lower = f(halfHeight + y);
      drag.leftTopPoint.set(left, upper);
      drag.rightTopPoint.set(right, upper);
      drag.leftBottomPoint.set(left, lower);
      drag.rightBottomPoint.set(right, lower);
      this.updateDraggingVertex(this.m_DragVertex, drag);
      this.renderVertex(this.m_DragVertex, drag, 1);
    }
    states?.popTo(top);
    return 0;
  }

  /**
   * `ChangeState(state, bForce)` (32950FB0): a new state resets the running texture animation (unless forced); the normal point becomes
   * the end point (the current one at once when it has no transition time) and the slot's colour follows the state; mouse over and mouse
   * out send the custom messages; a dragged slot takes the focus and becomes `s_pDragSlot`.
   */
  ChangeState(state: number, bForce: boolean): void {
    if (this.m_eControlState === state) {
      if (!bForce) return;
    } else {
      this.m_eControlState = state;
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
    const normal = this.m_pNormalPoint;
    const toEnd = (): void => {
      if (!normal) return;
      this.m_EndPoint.assign(normal);
      this.m_NowPoint.fChangeTime = 0;
    };
    const setColor = (c: Color): void => {
      this.m_Color.set(c.r, c.g, c.b, c.a);
    };
    switch (state) {
      case SCS.NORMAL:
        if (this.m_bMouseOut) {
          this.m_bMouseOut = false;
          if (this.m_CustomMsgMouseOut !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOut);
        }
        toEnd();
        setColor(this.m_cNormalSlotColor);
        break;
      case SCS.DOWN:
        setColor(this.m_cNormalSlotColor);
        toEnd();
        break;
      case SCS.MOUSEOVER: {
        setColor(this.m_cNormalSlotColor);
        const over = this.m_pMouseOverPoint;
        if (!over) throw new Error("CKTDGUISlot::ChangeState: the slot has no mouse over point (SetPoint makes it); the exe dereferences null");
        over.color.set(this.m_cMouseOverColor.r, this.m_cMouseOverColor.g, this.m_cMouseOverColor.b, this.m_cMouseOverColor.a);
        if (this.m_CustomMsgMouseOver !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgMouseOver);
        toEnd();
        break;
      }
      case SCS.ONDRAG:
        if (!this.m_bHasFocus) this.RequestFocus();
        CKTDGUISlot.s_pDragSlot = this;
        toEnd();
        setColor(this.m_cDraggedSlotColor);
        break;
      case SCS.DISABLE:
        if (this.m_bHasFocus && this.m_pDialog) this.m_pDialog.clearFocus();
        setColor(this.m_cNormalSlotColor);
        break;
      default:
        break;
    }
    if (this.m_EndPoint.fChangeTime === 0) this.m_NowPoint.assign(this.m_EndPoint);
  }

  /** `SetEnable(bool)` (329535C0), virtual: a disabled slot is in the disabled state */
  override SetEnable(enable: boolean): void {
    this.m_bEnable = enable;
    this.m_eControlState = enable ? SCS.NORMAL : SCS.DISABLE;
    this.ChangeState(this.m_eControlState, false);
  }

  /** `SetShow(bool)` (329544F0), virtual: hiding a dragged slot drops the drag */
  override SetShow(show: boolean): void {
    const dragged = this.m_eControlState === SCS.ONDRAG;
    this.m_bShow = show;
    if (dragged && !show && CKTDGUISlot.s_pDragSlot) {
      CKTDGUISlot.s_pDragSlot.ChangeState(SCS.NORMAL, true);
      CKTDGUISlot.s_pDragSlot = null;
    }
    this.ChangeState(this.m_eControlState, false);
  }

  /** `SetAllPointDatabyNormalPoint` (329534D0): the dragging and mouse over points the slot does not have yet are copies of the normal point */
  private setAllPointDataByNormalPoint(): void {
    const normal = this.m_pNormalPoint!;
    if (!this.m_pDraggingPoint) {
      const p = new UIPointData().assign(normal);
      p.color.set(this.m_cDraggingSlotColor.r, this.m_cDraggingSlotColor.g, this.m_cDraggingSlotColor.b, this.m_cDraggingSlotColor.a);
      this.m_pDraggingPoint = p;
      p.pUITextureData = this.m_pItemTex;
    }
    if (!this.m_pMouseOverPoint) {
      const p = new UIPointData().assign(normal);
      this.m_pMouseOverPoint = p;
      p.pUITextureData = this.m_pMouseOverTex;
      // (the exe colours the dragging point here, not the one it just made)
      const c = this.m_cMouseOverColor;
      this.m_pDraggingPoint.color.set(c.r, c.g, c.b, c.a);
    }
  }

  // ---- textures and points ---------------------------------------------------------------------------------------------------

  /** the end of the item texture setters: the item texture is the one the normal and the dragging point draw, then the state is shown again */
  private takeItemTex(data: UITextureData | null): void {
    this.m_pItemTex?.release(this.ctx.devices);
    this.m_pItemTex = data;
    if (this.m_pNormalPoint) this.m_pNormalPoint.pUITextureData = data;
    if (this.m_pDraggingPoint) this.m_pDraggingPoint.pUITextureData = this.m_pItemTex;
    this.ChangeState(this.m_eControlState, true);
  }

  /**
   * `SetItemTex(file, key)` (329535F0): the old item texture is destroyed; a texture that does not open is replaced by the whole
   * `HQ_Shop_Ui_Noimage.dds` (nothing happens when that does not open either).
   */
  setItemTex(fileName: string, key: string): void {
    this.m_pItemTex?.release(this.ctx.devices);
    this.m_pItemTex = null;
    let data = setTexureData(this.ctx, fileName, key);
    if (data) {
      this.m_pItemTex = data;
      if (this.m_pNormalPoint) this.m_pNormalPoint.pUITextureData = data;
    } else {
      data = wholeTextureData(this.ctx, SLOT_NO_IMAGE);
      if (!data) return;
      this.m_pItemTex = data;
      if (this.m_pNormalPoint) this.m_pNormalPoint.pUITextureData = data;
    }
    if (this.m_pDraggingPoint) this.m_pDraggingPoint.pUITextureData = this.m_pItemTex;
    this.ChangeState(this.m_eControlState, true);
  }

  /**
   * `SetItemTex(file)` (32953870): the whole image of the file, or (when it does not open) of `HQ_Shop_Ui_Noimage.dds`; a file that is
   * not there as well changes nothing.
   */
  private setItemTexWhole(fileName: string): void {
    let data = wholeTextureData(this.ctx, fileName);
    if (!data && fileName !== SLOT_NO_IMAGE) data = wholeTextureData(this.ctx, SLOT_NO_IMAGE);
    if (!data) return;
    this.takeItemTex(data);
  }

  /** `SetItemTex_LUA(file, key)` (32953E40) */
  SetItemTex(fileName: string, key: string): void {
    this.setItemTex(fileName, key);
  }

  /** `SetItemTex_LUA2(file)` (32953B00), the Lua method `SetItemTex2`: the whole image of the file */
  SetItemTex2(fileName: string): void {
    this.setItemTexWhole(fileName);
  }

  /** `SetMouseOverTex_LUA(file, key)` (32954140): the mouse over point shows it */
  SetMouseOverTex(fileName: string, key: string): void {
    this.m_pMouseOverTex = this.replaceTexture(this.m_pMouseOverTex, fileName, key);
    if (this.m_pMouseOverPoint) this.m_pMouseOverPoint.pUITextureData = this.m_pMouseOverTex;
    this.ChangeState(this.m_eControlState, true);
  }

  /**
   * `SetPoint_LUA()` (329543F0): the normal point (showing the item texture), then the dragging and the mouse over point it makes from
   * it when the slot has none, the control's current point, and the state is shown again.
   */
  SetPoint(): void {
    this.m_pNormalPoint = this.makePoint(this.m_pItemTex);
    this.setAllPointDataByNormalPoint();
    this.m_NowPoint.assign(this.m_pNormalPoint);
    this.ChangeState(this.m_eControlState, true);
  }

  /** `SetMouseOverPoint_LUA()` (32954030): the point of the mouse over state, showing the mouse over texture */
  SetMouseOverPoint(): void {
    this.m_pMouseOverPoint = this.makePoint(this.m_pMouseOverTex);
  }

  /** `SetString_LUA()` (32954570): the slot's text (the old one is destroyed) */
  SetString(): void {
    this.m_pStringData = readStringData(this.ctx);
  }

  // ---- messages and options --------------------------------------------------------------------------------------------------

  /** `SetCustomMsgMouseOut(int)` (328CD1E0) */
  SetCustomMsgMouseOut(msg: number): void {
    this.m_CustomMsgMouseOut = msg | 0;
  }

  /** `SetCustomMsgMouseOver(int)` (328CD210) */
  SetCustomMsgMouseOver(msg: number): void {
    this.m_CustomMsgMouseOver = msg | 0;
  }

  /** `SetCustomMsgMouseDown(int)` (328CD1A0) */
  SetCustomMsgMouseDown(msg: number): void {
    this.m_CustomMsgMouseDown = msg | 0;
  }

  /** `SetCustomMsgMouseUp(int)` (328CD170, shared with `CKTDGUIListBox::SetCustomMsgItemDoubleClick`) */
  SetCustomMsgMouseUp(msg: number): void {
    this.m_CustomMsgMouseUp = msg | 0;
  }

  /** `SetCustomMsgMouseRightUp(int)` (328CD230) */
  SetCustomMsgMouseRightUp(msg: number): void {
    this.m_CustomMsgMouseRightUp = msg | 0;
  }

  /** `SetCustomMsgDropped(int)` (328CD130, shared with `CKTDGUIListBox::SetCustomMsgSelection_End`) */
  SetCustomMsgDropped(msg: number): void {
    this.m_CustomMsgDropped = msg | 0;
  }

  /** `SetDraggingSlotColor(D3DXCOLOR)` (328CD390) */
  SetDraggingSlotColor(color: Color): void {
    this.m_cDraggingSlotColor.set(color.r, color.g, color.b, color.a);
  }

  /** `SetDraggedSlotColor(D3DXCOLOR)` (328CD310) */
  SetDraggedSlotColor(color: Color): void {
    this.m_cDraggedSlotColor.set(color.r, color.g, color.b, color.a);
  }

  /** `SetDragable(bool)` (328CD300) */
  SetDragable(dragable: boolean): void {
    this.m_bDragable = dragable;
  }

  /** `GetDragable()` (328C2120) */
  GetDragable(): boolean {
    return this.m_bDragable;
  }

  /** `SetID(int)` (328CD7E0) */
  SetID(id: number): void {
    this.m_iID = id | 0;
  }

  /** `GetDroppedSlot()` (328C2130): the slot that was dropped on this one */
  GetDroppedSlot(): CKTDGUISlot | undefined {
    return this.m_pDroppedSlot ?? undefined;
  }

  /** `SetSlotData(CKTDGUISlotData*)` (32954550) */
  setSlotData(data: UISlotData): void {
    this.m_pSlotData = data;
    data.m_bDataUpdated = true;
  }

  /** `GetPicture(int)` (32951FC0) */
  getPicture(index: number): CPictureData | undefined {
    return this.m_mapAdditionalPictureDataList.get(index);
  }

  /** `AddPicture(int, CPictureData*)` (32CCFFD0): the first picture of a key stays */
  addPicture(key: number, picture: CPictureData): void {
    if (!this.m_mapAdditionalPictureDataList.has(key)) this.m_mapAdditionalPictureDataList.set(key, picture);
  }
}

// ---- the game layer: slot manager and slots ----------------------------------------------------------------------------------------

/** `CX2SlotManager::CX2Slot` (the Lua class `CX2Slot`): a slot of a slot manager */
export class CX2Slot implements Partial<CX2SlotManager__CX2Slot_Methods> {
  m_SlotID = -1;
  m_pSlotManager: CX2SlotManager | null = null;
  m_bEnable = true;
  m_bShow = true;
  m_bClickable = true;
  m_SlotType = 0;
  readonly m_Pos = new Vec2();
  readonly m_Size = new Vec2();
  /** `m_pDLGSlotFixBack` / `m_pDLGSlot` (dialog handles; no script of the client makes one) */
  m_pDLGSlotFixBack: unknown = null;
  m_pDLGSlot: unknown = null;
  /** `X2_DIALOG_LAYER::XDL_NORMAL_1` */
  m_NormalLayer = 1;

  constructor(protected readonly ctx: UIContext) {}

  /** `SetClickable(bool)` (32E5DA30), virtual */
  SetClickable(clickable: boolean): void {
    this.m_bClickable = clickable;
  }

  /** `GetClickable()` (32E5DA20), virtual */
  getClickable(): boolean {
    return this.m_bClickable;
  }

  /**
   * `LuaGetValue(KLuaManager&)` (32E5DD90), virtual: SLOT_ID (default 0), ENABLE and SHOW (default true), SLOT_TYPE (default 0) and
   * the dialog of SLOT_BACK_DLG_FILE
   */
  luaGetValue(m: KLuaManager): void {
    this.m_SlotID = m.getInt("SLOT_ID") ?? 0;
    this.m_bEnable = m.getBool("ENABLE") ?? true;
    this.m_bShow = m.getBool("SHOW") ?? true;
    this.m_SlotType = m.getInt("SLOT_TYPE") ?? 0;
    const dlgFileName = m.getString("SLOT_BACK_DLG_FILE") ?? "";
    if (dlgFileName.length !== 0) throw new Error(`CX2Slot::LuaGetValue: SLOT_BACK_DLG_FILE (${dlgFileName}) opens a second dialog, which is not ported`);
  }

  /**
   * `SetSlotData_LUA()` (32E5DAE0): the slot reads its keys from the table on top of the stack, then POS and SIZE (both default to 0, 0)
   */
  SetSlotData(): void {
    const m = new KLuaManager(this.ctx.world.rt, 1);
    this.luaGetValue(m);
    const pos = m.getVec2("POS");
    this.m_Pos.set(pos?.x ?? 0, pos?.y ?? 0);
    const size = m.getVec2("SIZE");
    this.m_Size.set(size?.x ?? 0, size?.y ?? 0);
  }
}

/** `CX2SlotItem` (the Lua class `CX2SlotItem`, a `CX2Slot`): a slot that holds an item */
export class CX2SlotItem extends CX2Slot {
  m_SortType = 0;
  m_bFashion = false;
  /** `CX2Unit::EQIP_POSITION::EP_NONE` */
  m_EquipPos = 0;
  m_SlotDesc = "";
  m_ItemUID = -1n;
  m_ItemTID = -1;
  m_bReset = false;
  m_Period = 0;
  m_hEffectExchangeReady = -1;

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_SlotID = -1;
  }

  /** `LuaGetValue` (331CAAA0): the slot's keys, then SORT_TYPE, FASHION, EQUIP_POS and SLOT_DESC (a string id of general.ess; -1 when missing) */
  override luaGetValue(m: KLuaManager): void {
    super.luaGetValue(m);
    this.m_SortType = m.getInt("SORT_TYPE") ?? 0;
    this.m_bFashion = m.getBool("FASHION") ?? false;
    this.m_EquipPos = m.getInt("EQUIP_POS") ?? 0;
    const iIndex = m.getInt("SLOT_DESC") ?? -1;
    this.m_SlotDesc = this.ctx.strings.get(iIndex); // GetGeneralString (the debug-info variant is not ported)
  }
}

/** `CX2SlotManager` (the Lua class `CX2SlotManager`): what the scripts of the slot UIs (inventory, shops, quick slot ...) talk to */
export class CX2SlotManager implements Partial<CX2SlotManager_Methods> {
  m_pNowState: unknown = null;
  readonly m_SlotList: CX2Slot[] = [];
  readonly m_Pos = new Vec2();
  m_pNowOverItemSlot: CX2SlotItem | null = null;
  m_SlotManagerLayer = 1;
  m_iDummyValue = -1;

  constructor(protected readonly ctx: UIContext) {}

  /** `RegisterLuaBind()` (32E5E840): the global `g_pCX2SlotManager` is this manager from now on */
  registerLuaBind(): void {
    this.ctx.world.rt.setObject("g_pCX2SlotManager", this, "CX2SlotManager");
  }

  /** `AddSlot(CX2Slot*)` (32E5E510), virtual: the slot learns its manager and joins the list (null is ignored) */
  AddSlot(slot: CX2Slot | undefined): void {
    if (!(slot instanceof CX2Slot)) return;
    slot.m_pSlotManager = this;
    this.m_SlotList.push(slot);
  }

  /** `CreateItemSlot()` (32E5E540): a new `CX2SlotItem` (the script owns it until `AddSlot`) */
  CreateItemSlot(): CX2SlotItem {
    return new CX2SlotItem(this.ctx);
  }

  /** `GetDummyValue_LUA()` (32A28C90) */
  GetDummyValue(): number {
    return this.m_iDummyValue;
  }

  /** `GetPos()` (32B7DDF0) */
  getPos(): Vec2 {
    return this.m_Pos;
  }
}

/**
 * `CX2PostBox` (the Lua class `CX2PostBox`, a `CX2ItemSlotManager`, so a `CX2SlotManager`): the post box, which builds the dialogs
 * `DLG_Mail_Shop_Popup_Send.lua` and `DLG_POST_LETTER_WINDOW.LUA` ... for itself.  Its `RegisterLuaBind` (32CA5F80) publishes it as the global
 * `g_pPostBoxInventory`, not as `g_pCX2SlotManager`.  It registers no Lua method of its own; the rest of the post box is not ported.
 */
export class CX2PostBox extends CX2SlotManager implements Partial<CX2PostBox_Methods> {
  override registerLuaBind(): void {
    this.ctx.world.rt.setObject("g_pPostBoxInventory", this, "CX2PostBox");
  }
}

/**
 * `CX2CouponBox` (the Lua class `CX2CouponBox`, a `CX2SlotManager`): the coupon box (`DLG_GIFT_BOX.LUA` ...).  Its `RegisterLuaBind`
 * (32EB5900) publishes it as the global `g_pCouponBox`.  It registers no Lua method of its own; the rest of the coupon box is not ported.
 */
export class CX2CouponBox extends CX2SlotManager implements Partial<CX2CouponBox_Methods> {
  override registerLuaBind(): void {
    this.ctx.world.rt.setObject("g_pCouponBox", this, "CX2CouponBox");
  }
}
