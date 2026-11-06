/**
 * `CKTDGUIStatic` (the Lua class `CKTDGUIStatic`, a `CKTDGUIControl`): a control that draws pictures and strings.
 * CKTDGUIStatic::CKTDGUIStatic 329288F0, AddPicture 328C0DB0, AddString_LUA 32928E40 (its argument table is read by
 * `CKTDGUIControl::SetStringData_`, 329269C0).
 */
import { KLuaManager } from "@els/host";
import type { CKTDGUIStatic_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIStringData } from "./control.ts";
import type { CPictureData, UIContext } from "./control.ts";
import type { DeviceTexture } from "./device.ts";

export class CKTDGUIStatic extends CKTDGUIControl implements Partial<CKTDGUIStatic_Methods> {
  readonly m_PictureDataList: CPictureData[] = [];
  readonly m_StringDataList: UIStringData[] = [];
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

  /** `AddPicture(CPictureData*)` (328C0DB0) */
  AddPicture(picture: CPictureData): void {
    this.m_PictureDataList.push(picture);
  }

  /** `AddString_LUA()` (32928E40): the string described by the table on top of the stack is appended */
  AddString(): void {
    this.m_StringDataList.push(this.setStringData());
  }

  /** `CKTDGUIControl::SetStringData_()` (329269C0) */
  private setStringData(): UIStringData {
    const m = new KLuaManager(this.ctx.world.rt, 1);
    let msg = "";
    let index = m.getInt("MSG") ?? -1;
    if (index !== -1) {
      msg = this.ctx.strings.get(index); // CKTDXStringTable::GetGeneralString (the debug-info variant is not ported)
    } else {
      index = -1;
      msg = m.getString("STRING") ?? "";
    }
    const s = new UIStringData();
    s.fontStyle = m.getInt("FONT_STYLE") ?? 0;
    s.fontIndex = m.getInt("FONT_INDEX") ?? 0;
    s.sortFlag = m.getNumber("SORT_FLAG", "u32") ?? 0;
    s.msg = msg;
    s.stringTableID = index;
    s.bSpread = m.getBool("SPREAD") ?? false;
    if (s.bSpread) s.fSpreadTimeGap = m.getFloat("SPREAD_TIME") ?? 1;
    s.bUseUkFont = m.getBool("USE_UK_FONT") ?? true;
    const pos = m.getVec2("POS");
    s.pos.set(pos?.x ?? 0, pos?.y ?? 0);
    const color = m.getColor("COLOR");
    s.color.set(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1, color?.a ?? 1);
    const outline = m.getColor("OUTLINE_COLOR");
    s.outlineColor.set(outline?.r ?? 1, outline?.g ?? 1, outline?.b ?? 1, outline?.a ?? 1);
    return s;
  }
}
