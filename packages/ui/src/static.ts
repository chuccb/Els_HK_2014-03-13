/**
 * `CKTDGUIStatic` (the Lua class `CKTDGUIStatic`, a `CKTDGUIControl`): a control that draws pictures and strings.
 * CKTDGUIStatic::CKTDGUIStatic 329288F0, AddPicture 328C0DB0, AddString_LUA 32928E40 (its argument table is read by
 * `CKTDGUIControl::SetStringData_`, 329269C0), GetPicture 32929CD0, GetString 32929D50, CanHaveFocus 32928E80.
 */
import { D3DRS } from "@els/d3d9";
import type { Color } from "@els/host";
import { CKTDGUIControl, UCT, readStringData } from "./control.ts";
import type { CPictureData, UIContext, UIPointData, UIStringData, UITextureData } from "./control.ts";
import type { DeviceTexture } from "./device.ts";
import type { CMovieData } from "./movie.ts";
import { VertexUI4 } from "./render.ts";
import { ftoi } from "./rect.ts";
import type { CKTDGUIItem_Methods, CKTDGUIStatic_Methods } from "@els/host";

const f = Math.fround;

/**
 * `std::wstring::find(const wchar_t* ptr, size_type off)` (328EFEC0): the index of the first `ptr` at or after `off`, or -1 (`npos`); an empty
 * `ptr` is found at `off` when `off` is not past the end.  `off` is unsigned: a negative one is past the end.
 */
export function wstringFind(msg: string, ptr: string, off: number): number {
  const n = ptr.length;
  const size = msg.length;
  const o = off >>> 0;
  if (n > size || o > size - n) return -1;
  if (n === 0) return o;
  return msg.indexOf(ptr, o);
}

export class CKTDGUIStatic extends CKTDGUIControl implements Partial<CKTDGUIStatic_Methods> {
  readonly m_PictureDataList: CPictureData[] = [];
  readonly m_StringDataList: UIStringData[] = [];
  /** the movie data a static plays (`AddMovieData`) */
  readonly m_MovieDataList: CMovieData[] = [];
  m_CustomMsgMouseDblClk = -1;
  m_CustomMsgMouseUp = -1;
  /** `m_pEdgeTexture`: every static opens `UIEdge.tga` */
  readonly m_pEdgeTexture: DeviceTexture | undefined;
  /** `m_Vertex[4]`: the quad of the picture being drawn */
  readonly m_Vertex = new VertexUI4();

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_ControlType = UCT.STATIC;
    this.m_bEnable = false; // a static does not take the mouse
    this.m_pEdgeTexture = ctx.devices.openTexture("UIEdge.tga");
  }

  /** `CanHaveFocus` (32928E80), virtual: a static can have the focus whenever it is shown */
  override canHaveFocus(): boolean {
    return this.m_bShow;
  }

  override textureData(out: UITextureData[]): void {
    for (const p of this.m_PictureDataList) if (p.pTexture) out.push(p.pTexture);
  }

  /**
   * `OnFrameRender` (3292A2B0): a shown static draws its pictures, then its strings, then its movies.  A picture is drawn when it is shown
   * and has a point and a loaded texture: the edge (when `m_EdgeWidth` is not 0), the quad (`UpdateVertex`, the picture's two blend
   * states pushed around `RenderVertex(..., m_iDrawCount)`), the edge again (both times with the picture's own `m_bDrawEdgeOut`).  The
   * strings (the UK font's `OutTextMultiline` / `Draw2DText`) and the movies (`CMovieData::OnFrameRender` 32925150) are not ported: they
   * are counted in `render.undrawn`.
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    const render = this.ctx.render;
    for (let i = 0; i < this.m_PictureDataList.length; i++) {
      const picture = this.m_PictureDataList[i]!;
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
    for (const text of this.m_StringDataList) if (text.msg.length !== 0) render?.noteUndrawn("CKTDGUIStatic string");
    for (let i = 0; i < this.m_MovieDataList.length; i++) render?.noteUndrawn("CMovieData::OnFrameRender");
    return 0;
  }

  /**
   * `OnFrameMove` (3292A120): a shown static runs the control's, then spreads its strings (`bSpread`: `iSpreadCount`, the number of characters shown,
   * goes up by one each `fSpreadTimeGap` seconds and the string stops spreading when it has shown all), runs the animations of the pictures that
   * have one on (`CPictureData::OnFrameMove`) and of the movies (`CMovieData::OnFrameMove`, 32924DE0: the Bandi library is not ported, so it
   * is counted in `render.undrawn`), and keeps the frame's time.
   *
   * The exe skips colour codes while spreading with two `find` calls whose result it compares with 0 (not with the offset): a message that
   * starts with `#CX` while the count was 0 advances the count by 2 more, one that starts with `#C` (count - 1 = 0) by 7 more, and no other
   * spreading step ever finds either at 0 (kept).
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!this.m_bShow) return 0;
    super.onFrameMove(fTime, fElapsedTime);
    const dt = f(fElapsedTime);
    for (let i = 0; i < this.m_StringDataList.length; i++) {
      const text = this.m_StringDataList[i];
      if (!text || !text.bSpread) continue;
      const count = text.iSpreadCount;
      if (count >= text.msg.length) {
        text.bSpread = false;
        continue;
      }
      const t = f(dt + text.fNowSpreadTime);
      text.fNowSpreadTime = t;
      if (!(t > text.fSpreadTimeGap)) continue;
      text.fNowSpreadTime = 0;
      text.iSpreadCount = (count + 1) | 0;
      if (count + 1 > 0) {
        if (wstringFind(text.msg, "#CX", count) !== 0) {
          if (wstringFind(text.msg, "#C", (text.iSpreadCount - 1) | 0) === 0) text.iSpreadCount = (text.iSpreadCount + 7) | 0;
        } else {
          text.iSpreadCount = (text.iSpreadCount + 2) | 0;
        }
      }
    }
    for (let i = 0; i < this.m_PictureDataList.length; i++) {
      const picture = this.m_PictureDataList[i];
      if (picture && (picture.m_bTwinkle || picture.m_bFlicker || picture.m_bFadeIn || picture.m_bFadeOut || picture.m_VibrateData.m_fMaxTime !== 0)) {
        picture.onFrameMove(fTime, fElapsedTime);
      }
    }
    for (let i = 0; i < this.m_MovieDataList.length; i++) this.ctx.render?.noteUndrawn("CMovieData::OnFrameMove");
    this.m_fElapsedTime = dt;
    return 0;
  }

  /**
   * `DrawEdge(bDrawOut, edgeWidth, edgeColor, pPoint)` (32929090): the edge of a picture, four bars of the edge texture (`drawEdgeBars`)
   * round or on the quad of `pPoint`; nothing for a width of 0, without the edge texture or without a point.  The size of the quad is
   * taken from the right-top corner (width) and the right-bottom one (height).
   */
  drawEdge(drawOut: boolean, edgeWidth: number, edgeColor: Color, point: UIPointData | null): void {
    if (edgeWidth === 0 || !this.m_pEdgeTexture || !point) return;
    const nWidth = ftoi(f(point.rightTopPoint.x - point.leftTopPoint.x));
    const nHeight = ftoi(f(point.rightBottomPoint.y - point.leftTopPoint.y));
    this.drawEdgeBars(this.m_pEdgeTexture, drawOut, edgeWidth, edgeColor, point, nWidth, nHeight);
  }

  /** `AddPicture(CPictureData*)` (328C0DB0) */
  AddPicture(picture: CPictureData): void {
    this.m_PictureDataList.push(picture);
  }

  /** `AddString_LUA()` (32928E40): the string described by the table on top of the stack is appended */
  AddString(): void {
    this.m_StringDataList.push(readStringData(this.ctx));
  }

  /** `AddMovieData_LUA(CMovieData*)` (328C0D80) */
  AddMovieData(movie: CMovieData): void {
    this.m_MovieDataList.push(movie);
  }

  /** `GetPicture(int)` (32929CD0): null for an index out of range */
  GetPicture(index: number): CPictureData | undefined {
    return index < 0 ? undefined : this.m_PictureDataList[index];
  }

  /** `GetString(int)` (32929D50): null for an index out of range */
  GetString(index: number): UIStringData | undefined {
    return index < 0 ? undefined : this.m_StringDataList[index];
  }

  /** `SetCustomMsgMouseDblClk(int)` (328CD180) */
  SetCustomMsgMouseDblClk(msg: number): void {
    this.m_CustomMsgMouseDblClk = msg;
  }

  /** `SetCustomMsgMouseUp(int)` (328CD250) */
  SetCustomMsgMouseUp(msg: number): void {
    this.m_CustomMsgMouseUp = msg;
  }
}

/**
 * `CKTDGUIItem` (the Lua class `CKTDGUIItem`, a `CKTDGUIStatic`; `CKTDGUIDialog::CreateItem` 328C1500): a static that is a row of a list.  The constructor
 * (3293B600) is the static's with a width and a height of 0; the class registers no method of its own and overrides no virtual function.
 */
export class CKTDGUIItem extends CKTDGUIStatic implements Partial<CKTDGUIItem_Methods> {
  m_Width = 0;
  m_Height = 0;
}
