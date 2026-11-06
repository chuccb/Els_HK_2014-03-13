/**
 * `CKTDGUIStatic` (the Lua class `CKTDGUIStatic`, a `CKTDGUIControl`): a control that draws pictures and strings.
 * CKTDGUIStatic::CKTDGUIStatic 329288F0, AddPicture 328C0DB0, AddString_LUA 32928E40 (its argument table is read by
 * `CKTDGUIControl::SetStringData_`, 329269C0), GetPicture 32929CD0, GetString 32929D50, CanHaveFocus 32928E80.
 */
import { CKTDGUIControl, UCT, readStringData } from "./control.ts";
import type { CPictureData, UIContext, UIStringData, UITextureData } from "./control.ts";
import type { DeviceTexture } from "./device.ts";
import type { CKTDGUIItem_Methods, CKTDGUIStatic_Methods } from "@els/host";

export class CKTDGUIStatic extends CKTDGUIControl implements Partial<CKTDGUIStatic_Methods> {
  readonly m_PictureDataList: CPictureData[] = [];
  readonly m_StringDataList: UIStringData[] = [];
  /** the movie data a static plays (`AddMovieData`; the movie classes are not ported) */
  readonly m_MovieDataList: unknown[] = [];
  m_CustomMsgMouseDblClk = -1;
  m_CustomMsgMouseUp = -1;
  /** `m_pEdgeTexture`: every static opens `UIEdge.tga` */
  readonly m_pEdgeTexture: DeviceTexture | undefined;

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

  /** `AddPicture(CPictureData*)` (328C0DB0) */
  AddPicture(picture: CPictureData): void {
    this.m_PictureDataList.push(picture);
  }

  /** `AddString_LUA()` (32928E40): the string described by the table on top of the stack is appended */
  AddString(): void {
    this.m_StringDataList.push(readStringData(this.ctx));
  }

  /** `AddMovieData_LUA(CMovieData*)` (328C0D80) */
  AddMovieData(movie: unknown): void {
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
