/**
 * `CKTDGUIControl` and the data a control draws from: `CKTDGUIControl::CPictureData`, `UIPointData`, `UITextureData`, `UIStringData`,
 * `TexChangeData`.
 *
 * Naming: a method written like the Lua name (`SetName`, `SetPoint`, `AddString`) is the function the exe registers with lua_tinker under
 * that name (`CKTDGUIControl::SetName_LUA` ...), found by the binder on the receiver; a method in lower camel case (`setName`) is the
 * C++ member function of that name that the Lua-facing one calls.  When the exe registers a virtual member function itself
 * (`SetShow`, `SetEnable`, `SetColor` ...) there is only the one method, named like the Lua name, and subclasses override it.
 * Members keep their C++ names.  `float` members are stored as floats (`Vec2` / `Color` are Float32Array backed) and every intermediate
 * of the exe's float arithmetic is rounded with `Math.fround`.
 *
 * Decompile references: CKTDGUIControl::CKTDGUIControl 32922F50 (defaults), CPictureData::CPictureData 32923280, UIPointData 32923430,
 * UITextureData 329234D0, TexChangeData 329233B0, UIStringData 32F56BC0, SetPointData_ 32926010, SetStringData_ 329269C0,
 * SetTexureData_ 32927A60, SetTexChangeData_ 32927130, AddTexChangeData 32923CE0, UITextureData::SetTextureUV 329279A0,
 * CPictureData::SetTex_LUA 329277D0, SetTex_LUA2 32927620, SetPoint_LUA 329262D0, SetPos 329263B0, Move 329248A0, Move_LUA 32924C30.
 */
import { KLuaManager, Color, Vec2, Vec3, towupperAscii } from "@els/host";
import type { CKTDGUIControl__CPictureData_Methods, CKTDGUIControl_Methods, HostWorld } from "@els/host";
import type { StringTable } from "@els/assets";
import type { DeviceManager, DeviceTexture } from "./device.ts";
import type { CKTDGUIDialog } from "./dialog.ts";

/** `CKTDGUIControl::UI_CONTROL_TYPE` */
export const UCT = {
  NONE: 0, BUTTON: 1, CHECKBOX: 2, EDITBOX: 3, IME_EDITBOX: 4, STATIC: 5, RADIOBUTTON: 6, SCROLLBAR: 7, COMBOBOX: 8, LISTBOX: 9,
  SLIDER: 10, NAVIGATION: 11, CONTROLLIST: 12, SLOT: 13,
} as const;

/** `CKTDGUIControl::TEX_AXIS` */
export const TA = {
  NONE: 0, TOP_LEFT: 1, TOP_CENTER: 2, TOP_RIGHT: 3, CENTER_LEFT: 4, CENTER_CENTER: 5, CENTER_RIGHT: 6, BOTTOM_LEFT: 7, BOTTOM_CENTER: 8,
  BOTTOM_RIGHT: 9, WORLD: 10,
} as const;

/** `D3DBLEND` values the point data defaults to */
export const D3DBLEND_SRCALPHA = 5;
export const D3DBLEND_INVSRCALPHA = 6;

/**
 * The window messages a control sends its stage (`CKTDGUIControl::SendInternelEvent(this, g_pKTDXApp->m_hWnd, msg, wParam, lParam)`):
 * 0x466 a control event with a default parameter, 0x467 a custom message id the script chose, 0x468 a Lua function name.
 */
export const UIM = { CONTROL_EVENT: 0x466, CUSTOM_MSG: 0x467, CUSTOM_FUNC: 0x468 } as const;

/** the part of a game state (`CKTDXStage`) a control talks to */
export interface UIStage {
  MsgProc?(msg: number, wParam: number | string, lParam: unknown): boolean;
}

/** what the C++ code reaches through its globals: `g_pKTDXApp->m_pDeviceManager`, `CKTDXStringTable::GetInstance()`, `CKTDXApp::ms_pLuaBinder` */
export interface UIContext {
  readonly devices: DeviceManager;
  readonly strings: StringTable;
  /** the one Lua state (`CKTDXApp::ms_pLuaBinder`) */
  readonly world: HostWorld;
  /** `CKTDGUIDialog::s_pControlFocus`: the control that has the keyboard focus */
  controlFocus: CKTDGUIControl | null;
  /** `MessageBoxA(g_pKTDXApp->m_hWnd, text, caption, 0)` (a modal box the exe shows when a script asks for a control that is not there) */
  messageBox(text: string, caption: string): void;
}

const f = Math.fround;

/** `CKTDGUIControl::UITextureData`: a texture of a picture and the UV rectangle it draws */
export class UITextureData {
  texName = "";
  keyName = "";
  pTexture: DeviceTexture | null = null;
  /** the corners in the order left-top, right-top, left-bottom, right-bottom: in texels (uvOrgTexture) and in 0..1 (uvTexture) */
  readonly uvTexture = [new Vec2(), new Vec2(), new Vec2(), new Vec2()];
  readonly uvOrgTexture = [new Vec2(), new Vec2(), new Vec2(), new Vec2()];
  readonly texSize = new Vec2();
  /** not in the exe: whether the key was found in the texture's UV table (a diagnostic for the census) */
  keyFound = false;

  /** `SetTextureUV` (329279A0): `uvTexture[i] = uvOrgTexture[i] / (float)m_Info.Width|Height` (`divss`) */
  setTextureUV(): void {
    const t = this.pTexture;
    if (!t) return;
    const w = f(t.info.Width), h = f(t.info.Height);
    for (let i = 0; i < 4; i++) {
      this.uvTexture[i]!.x = f(this.uvOrgTexture[i]!.x / w);
      this.uvTexture[i]!.y = f(this.uvOrgTexture[i]!.y / h);
    }
  }

  /** `~UITextureData` (32923950): the texture device is closed */
  release(devices: DeviceManager): void {
    if (this.pTexture) {
      devices.closeDevice(this.pTexture.deviceID);
      this.pTexture = null;
    }
  }
}

/** `CKTDGUIControl::UIPointData`: where and how a picture is drawn */
export class UIPointData {
  readonly leftTopPoint = new Vec2();
  readonly rightTopPoint = new Vec2();
  readonly leftBottomPoint = new Vec2();
  readonly rightBottomPoint = new Vec2();
  readonly color = new Color(1, 1, 1, 1);
  fChangeTime = 0;
  pUITextureData: UITextureData | null = null;
  bUseTextureSize = true;
  readonly addSize = new Vec2();
  readonly kResize = new Vec2(1, 1);
  m_iDrawCount = 1;
  m_eSrcBlend = D3DBLEND_SRCALPHA;
  m_eDestBlend = D3DBLEND_INVSRCALPHA;

  /** C++ struct assignment: every member, the texture pointer included */
  assign(o: UIPointData): this {
    this.leftTopPoint.set(o.leftTopPoint.x, o.leftTopPoint.y);
    this.rightTopPoint.set(o.rightTopPoint.x, o.rightTopPoint.y);
    this.leftBottomPoint.set(o.leftBottomPoint.x, o.leftBottomPoint.y);
    this.rightBottomPoint.set(o.rightBottomPoint.x, o.rightBottomPoint.y);
    this.color.set(o.color.r, o.color.g, o.color.b, o.color.a);
    this.fChangeTime = o.fChangeTime;
    this.pUITextureData = o.pUITextureData;
    this.bUseTextureSize = o.bUseTextureSize;
    this.addSize.set(o.addSize.x, o.addSize.y);
    this.kResize.set(o.kResize.x, o.kResize.y);
    this.m_iDrawCount = o.m_iDrawCount;
    this.m_eSrcBlend = o.m_eSrcBlend;
    this.m_eDestBlend = o.m_eDestBlend;
    return this;
  }

  /**
   * The size-from-texture rule the point setters of buttons and pictures share: with `bUseTextureSize` and a loaded texture the quad is the
   * texture rectangle times `kResize` from the left-top corner, plus `addSize` (single precision: `(float)(w + x) + addSize.x`).
   */
  applyTextureSize(): void {
    if (!this.bUseTextureSize) return;
    const t = this.pUITextureData;
    if (!t || !t.pTexture) return;
    const w = f(t.texSize.x * this.kResize.x), h = f(t.texSize.y * this.kResize.y);
    const x = this.leftTopPoint.x, y = this.leftTopPoint.y;
    this.rightTopPoint.y = y;
    this.leftBottomPoint.x = x;
    const right = f(f(w + x) + this.addSize.x), bottom = f(f(y + h) + this.addSize.y);
    this.rightTopPoint.x = right;
    this.leftBottomPoint.y = bottom;
    this.rightBottomPoint.x = right;
    this.rightBottomPoint.y = bottom;
  }
}

/** `CKTDGUIControl::UIStringData`: a string of a static */
export class UIStringData {
  fontIndex = 0;
  stringTableID = -1;
  msg = "";
  readonly pos = new Vec2();
  readonly color = new Color(0, 0, 0, 1);
  readonly outlineColor = new Color(0, 0, 0, 1);
  sortFlag = 0;
  fontStyle = 0; // FS_NONE
  bUseUkFont = true;
  bSpread = false;
  fSpreadTimeGap = 0;
  iSpreadCount = 0;
  fNowSpreadTime = 0;
}

/** `CKTDGUIControl::TexChangeData`: one step of a button's texture animation (`SetOverAnimTex` ...) */
export class TexChangeData {
  m_SequenceID = 0;
  m_fShowTime = 0;
  m_pTexData: UITextureData | null = null;
  m_RotateAxis: number = TA.NONE;
  readonly m_RotateAxisPos = new Vec2();
  m_fRotateDegree = 0;
  readonly m_Pos = new Vec2();
  m_ScaleAxis: number = TA.NONE;
  readonly m_ScaleAxisPos = new Vec2();
  readonly m_Scale = new Vec2(1, 1);
  m_fScaleRotationDegree = 0;
  m_bEndTexChange = false;
  m_SequenceIDToGo = -1;

  /** `~TexChangeData` (329238B0): the step's texture device is closed */
  release(devices: DeviceManager): void {
    const t = this.m_pTexData;
    if (t) {
      if (t.pTexture) {
        devices.closeDevice(t.pTexture.deviceID);
        t.pTexture = null;
      }
      this.m_pTexData = null;
    }
  }
}

/** `CKTDGUIControl::ControlMoveItem`: a step of the move queue (`Move` with `IS_DIRECT = false`) */
export interface ControlMoveItem {
  pos: Vec2;
  color: Color;
  fChangeTime: number;
  bIsAutoDelete: boolean;
}

// ---- the static helpers of CKTDGUIControl that read Lua tables -------------------------------------------------------------------

/** `CKTDGUIControl::SetTexureData_(file, key)` (32927A60): opens the texture and looks the key up in its UV table */
export function setTexureData(ctx: UIContext, fileName: string, keyName: string): UITextureData | null {
  const data = new UITextureData();
  data.texName = fileName;
  data.keyName = keyName;
  data.pTexture = ctx.devices.openTexture(fileName) ?? null;
  if (!data.pTexture) return null; // the UITextureData is deleted
  const uv = data.pTexture.tet?.getTexUV(towupperAscii(keyName));
  if (uv) {
    // the UV table stores left-top, right-bottom, left-bottom, right-top; the quad is drawn left-top, right-top, left-bottom, right-bottom
    data.uvOrgTexture[0]!.set(uv.leftTop[0], uv.leftTop[1]);
    data.uvOrgTexture[1]!.set(uv.rightTop[0], uv.rightTop[1]);
    data.uvOrgTexture[2]!.set(uv.leftBottom[0], uv.leftBottom[1]);
    data.uvOrgTexture[3]!.set(uv.rightBottom[0], uv.rightBottom[1]);
    data.texSize.set(uv.rectSize[0], uv.rectSize[1]);
    data.setTextureUV();
    data.keyFound = true;
  }
  return data;
}

/** `CKTDGUIControl::SetPointData_()` (32926010): the point data of the table on top of the stack */
export function readPointData(ctx: UIContext): UIPointData {
  const m = new KLuaManager(ctx.world.rt, 1);
  const p = new UIPointData();
  p.bUseTextureSize = m.getBool("USE_TEXTURE_SIZE") ?? true;
  p.fChangeTime = m.getFloat("CHANGE_TIME") ?? 0;
  p.addSize.x = m.getFloat("ADD_SIZE_X") ?? 0;
  p.addSize.y = m.getFloat("ADD_SIZE_Y") ?? 0;
  p.kResize.x = m.getFloat("RESIZE_X") ?? 1;
  p.kResize.y = m.getFloat("RESIZE_Y") ?? 1;
  p.m_iDrawCount = m.getInt("DRAW_COUNT") ?? 1;
  p.m_eSrcBlend = m.getInt("SRC_BLEND") ?? D3DBLEND_SRCALPHA;
  p.m_eDestBlend = m.getInt("DEST_BLEND") ?? D3DBLEND_INVSRCALPHA;
  const bRect = m.getBool("IS_RECT") ?? true;
  const leftTop = m.getVec2("LEFT_TOP");
  p.leftTopPoint.set(leftTop?.x ?? 0, leftTop?.y ?? 0);
  if (!p.bUseTextureSize) {
    if (bRect) {
      const rb = m.getVec2("RIGHT_BOTTOM");
      p.rightBottomPoint.set(rb?.x ?? 0, rb?.y ?? 0);
      p.rightTopPoint.set(p.rightBottomPoint.x, p.leftTopPoint.y);
      p.leftBottomPoint.set(p.leftTopPoint.x, p.rightBottomPoint.y);
    } else {
      const rt = m.getVec2("RIGHT_TOP"), lb = m.getVec2("LEFT_BOTTOM"), rb = m.getVec2("RIGHT_BOTTOM");
      p.rightTopPoint.set(rt?.x ?? 0, rt?.y ?? 0);
      p.leftBottomPoint.set(lb?.x ?? 0, lb?.y ?? 0);
      p.rightBottomPoint.set(rb?.x ?? 0, rb?.y ?? 0);
    }
  }
  const c = m.getColor("COLOR");
  p.color.set(c?.r ?? 1, c?.g ?? 1, c?.b ?? 1, c?.a ?? 1);
  return p;
}

/** `CKTDGUIControl::SetStringData_()` (329269C0): the string of the table on top of the stack */
export function readStringData(ctx: UIContext): UIStringData {
  const m = new KLuaManager(ctx.world.rt, 1);
  let msg = "";
  let index = m.getInt("MSG") ?? -1;
  if (index !== -1) {
    msg = ctx.strings.get(index); // CKTDXStringTable::GetGeneralString (the debug-info variant is not ported)
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

/**
 * `CKTDGUIControl::SetTexChangeData_()` (32927130): one animation step from the table on top of the stack.  `POS` is read always,
 * `SCALE` when the scale axis is set, `SCALE_AXIS_POS` / `ROTATE_AXIS_POS` when the axis is TA_WORLD; the step's texture is opened only
 * when both `FileName` and `KeyName` are given.
 */
export function readTexChangeData(ctx: UIContext): TexChangeData {
  const m = new KLuaManager(ctx.world.rt, 1);
  const fileName = m.getString("FileName") ?? "";
  const key = m.getString("KeyName") ?? "";
  const rotateAxis = m.getInt("RotateAxis") ?? 0;
  const fRotateDegree = m.getFloat("RotateDegree") ?? 0;
  const sequenceID = m.getInt("SequenceID") ?? 0;
  const fShowTime = m.getFloat("fShowTime") ?? 0;
  const scaleAxis = m.getInt("ScaleAxis") ?? 0;
  const fScaleRotationDegree = m.getFloat("ScaleRotaionDegree") ?? 0;
  const bEndTexChange = m.getBool("bEndTexChange") ?? false;
  const sequenceIDToGo = m.getInt("SequenceIDToGo") ?? -1;
  const pos = m.getVec2("POS");
  let scale = new Vec2(1, 1);
  let scaleAxisPos = new Vec2();
  let rotateAxisPos = new Vec2();
  if (scaleAxis !== 0) {
    const s = m.getVec2("SCALE");
    scale = new Vec2(s?.x ?? 1, s?.y ?? 1);
    if (scaleAxis === TA.WORLD) {
      const a = m.getVec2("SCALE_AXIS_POS");
      scaleAxisPos = new Vec2(a?.x ?? 0, a?.y ?? 0);
    }
  }
  if (rotateAxis === TA.WORLD) {
    const a = m.getVec2("ROTATE_AXIS_POS");
    rotateAxisPos = new Vec2(a?.x ?? 0, a?.y ?? 0);
  }
  const d = new TexChangeData();
  if (fileName.length !== 0 && key.length !== 0) d.m_pTexData = setTexureData(ctx, fileName, key);
  d.m_SequenceID = sequenceID;
  d.m_fShowTime = fShowTime;
  d.m_RotateAxisPos.set(rotateAxisPos.x, rotateAxisPos.y);
  d.m_RotateAxis = rotateAxis;
  d.m_fRotateDegree = fRotateDegree;
  d.m_Pos.set(pos?.x ?? 0, pos?.y ?? 0);
  d.m_ScaleAxisPos.set(scaleAxisPos.x, scaleAxisPos.y);
  d.m_Scale.set(scale.x, scale.y);
  d.m_ScaleAxis = scaleAxis;
  d.m_fScaleRotationDegree = fScaleRotationDegree;
  d.m_bEndTexChange = bEndTexChange;
  d.m_SequenceIDToGo = sequenceIDToGo;
  return d;
}

/** `CKTDGUIControl::CPictureData` (the Lua class `CPictureData`) */
export class CPictureData implements Partial<CKTDGUIControl__CPictureData_Methods> {
  pTexture: UITextureData | null = null;
  pPoint: UIPointData | null = null;
  bShow = true;
  bMaximizePos = false;
  bMaximizeSize = false;
  readonly pos = new Vec2();
  readonly size = new Vec2();
  readonly originalPos = new Vec2();
  readonly originalSize = new Vec2();
  m_bTwinkle = false;
  m_fOriginalAlpha = 0;
  m_fTwinkleTime = 0;
  m_fRemainTwinkleTime = 0;
  m_bLoop = false;
  m_bFlicker = false;
  m_fFlickerTime = 0;
  m_fFlickerMaxAlpha = 0;
  m_fFlickerMinAlpha = 0;
  m_fRemainFlickerTime = 0;
  m_bFlickerGainAlpha = false;
  m_bFlickerLoop = false;
  readonly m_EdgeColor = new Color(1, 1, 1, 1);
  m_EdgeWidth = 0;
  m_EdgeEnlarge = 0;
  m_bDrawEdgeOut = true;
  /** VIBRATE_DATA */
  readonly m_VibrateData = {
    m_fMaxTime: 0, m_fDistance: 0, m_vDirSpeed: new Vec2(), m_fElapsedTime: 0, m_bGoingAway: true, m_vOriginalPos: new Vec2(),
  };
  m_nIndex = 0;
  m_bFadeIn = false;
  m_bFadeOut = false;
  m_fFadeTime = 0;
  m_fRemainFadeTime = 0;

  constructor(private readonly ctx: UIContext) {}

  /** `SetTex_LUA(file, key)` (329277D0): the old texture is closed and replaced; the point data (if there is one) follows the new texture */
  SetTex(fileName: string, key: string): void {
    const old = this.pTexture;
    if (old) {
      old.release(this.ctx.devices);
      this.pTexture = null;
    }
    const data = setTexureData(this.ctx, fileName, key);
    if (this.pPoint) this.pPoint.pUITextureData = data;
    this.pTexture = data;
  }

  /**
   * `SetTex_LUA2(file)` (32927620), the Lua method `SetTex2`: the whole texture, without a key (`uvOrgTexture` is the file's size in
   * texels, so the UVs are 0..1).  A file that does not open changes nothing.
   */
  SetTex2(fileName: string): void {
    if (fileName === "") return; // the exe's null-pointer test of the converted name
    const data = new UITextureData();
    data.texName = fileName;
    data.pTexture = this.ctx.devices.openTexture(data.texName) ?? null;
    if (!data.pTexture) return; // the UITextureData is deleted
    const w = f(data.pTexture.info.Width), h = f(data.pTexture.info.Height);
    data.uvOrgTexture[0]!.set(0, 0);
    data.uvOrgTexture[1]!.set(w, 0);
    data.uvOrgTexture[2]!.set(0, h);
    data.uvOrgTexture[3]!.set(w, h);
    data.texSize.set(w, h);
    data.setTextureUV();
    data.keyFound = true;
    if (this.pTexture) this.pTexture.release(this.ctx.devices); // the old one: `scalar deleting destructor`
    this.pTexture = data;
    if (this.pPoint) this.pPoint.pUITextureData = data;
  }

  /**
   * `SetPoint_LUA()` (329262D0): the argument is the table on top of the Lua stack (`SetPointData_` reads it with a KLuaManager);
   * the picture's position and size follow from the corners.
   */
  SetPoint(): void {
    this.pPoint = readPointData(this.ctx);
    const p = this.pPoint;
    p.pUITextureData = this.pTexture;
    p.applyTextureSize();
    this.pos.set(p.leftTopPoint.x, p.leftTopPoint.y);
    this.size.set(f(p.rightTopPoint.x - p.leftTopPoint.x), f(p.rightBottomPoint.y - p.leftTopPoint.y));
    this.originalPos.set(this.pos.x, this.pos.y);
    this.originalSize.set(this.size.x, this.size.y);
  }

  /** `SetShow(bool)` (328CDFB0) */
  SetShow(show: boolean): void {
    this.bShow = show;
  }

  /** `SetIndex(int)` (328CD800) */
  SetIndex(index: number): void {
    this.m_nIndex = index;
  }

  /** `GetIndex()` (328C2240) */
  GetIndex(): number {
    return this.m_nIndex;
  }

  /** `SetMaximizeType(bool, bool)` (32925750) */
  SetMaximizeType(pos: boolean, size: boolean): void {
    this.bMaximizePos = pos;
    this.bMaximizeSize = size;
  }

  /** `SetEdge(bool, int, D3DXCOLOR)` (328CD3E0) */
  SetEdge(drawOut: boolean, width: number, color: Color): void {
    this.m_bDrawEdgeOut = drawOut;
    this.m_EdgeWidth = width;
    this.m_EdgeColor.set(color.r, color.g, color.b, color.a);
  }
}

/** the base of every control: `CKTDGUIControl` */
export class CKTDGUIControl implements Partial<CKTDGUIControl_Methods> {
  m_ControlType: number = UCT.NONE;
  m_Name = "";
  /** m_pDialog: the dialog this control was added to */
  m_pDialog: CKTDGUIDialog | null = null;
  readonly m_OffsetPos = new Vec2();
  readonly m_Size = new Vec2();
  readonly m_Color = new Color(1, 1, 1, 1);
  m_bHasFocus = false;
  m_bMouseOver = false;
  m_bEnable = true;
  m_bShow = true;
  m_bSound = true;
  m_bOutofList = false;
  m_bMaximize = false;
  m_bShowDescriptionWhenDisable = false;
  /** `tagPOINT` (ints) */
  readonly m_kMaximizeOffset = { x: 0, y: 0 };
  m_fAnimateTime = 0;
  readonly m_GoalPos = new Vec2();
  readonly m_GoalColor = new Color(1, 1, 1, 1);
  m_fChangeTime = 0;
  m_bAutoDelete = false;
  m_bCheckAutoDeleteEnd = false;
  m_fElapsedTime = 0;
  /** `m_queMoveItems` (`std::queue`: first in, first out) */
  readonly m_queMoveItems: ControlMoveItem[] = [];
  readonly m_vEnableLeftTop = new Vec2();
  readonly m_vEnableRightBottom = new Vec2();
  m_GuideDesc = "";
  readonly m_vGuideDescOffsetPos = new Vec2();
  readonly m_vGuideDescAbsolutePos = new Vec2();
  m_bGuideDescPosLT = false;
  m_PrevTabControlName = "";
  m_TabControlName = "";
  readonly m_NowPoint = new UIPointData();
  readonly m_EndPoint = new UIPointData();
  readonly m_NowTexChangeData = new TexChangeData();
  readonly m_DummyPosList: Vec3[] = [];
  readonly m_DummyStringList: string[] = [];
  readonly m_DummyIntList: number[] = [];
  /** `m_wstrCustomButton...SndFileName` as copied by `CKTDGUIDialog::AddControl` */
  m_wstrCustomMouseOverSnd = "";
  m_wstrCustomMouseUpSnd = "";

  constructor(protected readonly ctx: UIContext) {}

  /**
   * Not in the exe: every `UITextureData` this control holds, for the census that checks the textures the scripts name
   * (a control that has textures overrides this).
   */
  textureData(out: UITextureData[]): void {
    void out;
  }

  /** `SetDialog` (329254A0) */
  setDialog(dialog: CKTDGUIDialog | null): void {
    this.m_pDialog = dialog;
  }

  /** `SetNameByForce` (32925B80) */
  setNameByForce(name: string): void {
    this.m_Name = name;
  }

  /** `SetName(const wchar_t*)` (32925B10): a control in a dialog is renamed there (`ReNameControl`), which makes the name unique */
  setName(name: string): boolean {
    this.m_Name = name;
    if (!this.m_pDialog) return true;
    return this.m_pDialog.reNameControl(this);
  }

  /** `SetName_LUA(const char*)` (32925D70): UTF-8 -> wide, then the virtual `SetName` */
  SetName(name: string): void {
    this.setName(name);
  }

  /** `SetNameStrID_LUA(int)` (32925BB0), virtual: the name is the string table's text; a control in a dialog is renamed there */
  SetNameStrID(index: number): boolean {
    this.m_Name = this.ctx.strings.get(index); // CKTDXStringTable::GetGeneralString (the debug-info variant is not ported)
    if (!this.m_pDialog) return true;
    return this.m_pDialog.reNameControl(this);
  }

  /** `SetTabControlName_LUA(const char*)` (32926E40) */
  SetTabControlName(name: string): void {
    this.m_TabControlName = name;
  }

  /** `SetPrevTabControlName_LUA(const char*)` (32926450) */
  SetPrevTabControlName(name: string): void {
    this.m_PrevTabControlName = name;
  }

  /** `SetCustomMouseOverSound(wstring)`: the base control ignores the sound (only buttons and radio buttons keep it) */
  setCustomMouseOverSound(_soundFileName: string): void {}

  /** `SetCustomMouseUpSound(wstring)` (32925450): the base control frees its argument and returns */
  setCustomMouseUpSound(_soundFileName: string): void {}

  /** `SetOffsetPos(D3DXVECTOR2)` (32925E40) */
  setOffsetPos(pos: Vec2): void {
    this.m_OffsetPos.set(pos.x, pos.y);
  }

  /** `SetOffsetPos_LUA(float, float)` (328CD970): the virtual `SetOffsetPos` */
  SetOffsetPos(x: number, y: number): void {
    this.setOffsetPos(new Vec2(x, y));
  }

  /** `GetOffsetPos()` (328C22D0) */
  GetOffsetPos(): Vec2 {
    return new Vec2(this.m_OffsetPos.x, this.m_OffsetPos.y);
  }

  /** `SetOffsetMaximize(int, int)` (328CD950) */
  SetOffsetMaximize(x: number, y: number): void {
    this.m_kMaximizeOffset.x = x | 0;
    this.m_kMaximizeOffset.y = y | 0;
  }

  /** `SetColor(D3DXCOLOR)` (32925440), virtual slot 31 */
  SetColor(color: Color): void {
    this.m_Color.set(color.r, color.g, color.b, color.a);
  }

  /** `SetEnable(bool)`, virtual slot 23 (the base: the flag; `CKTDGUISlot` overrides it) */
  SetEnable(enable: boolean): void {
    this.m_bEnable = enable;
  }

  /** `SetShow(bool)` (329265B0), virtual slot 25 (`CKTDGUIButton` and `CKTDGUISlot` override it) */
  SetShow(show: boolean): void {
    this.m_bShow = show;
  }

  /** `SetShowEnable(bool, bool)` (329265C0), virtual: the two virtual setters */
  SetShowEnable(show: boolean, enable: boolean): void {
    this.SetShow(show);
    this.SetEnable(enable);
  }

  /** `SetSound(bool)` (329269B0), virtual */
  SetSound(sound: boolean): void {
    this.m_bSound = sound;
  }

  /** `GetMouseOver()` (328C22B0) */
  GetMouseOver(): boolean {
    return this.m_bMouseOver;
  }

  /** `SetEnableLeftTop(D3DXVECTOR2)` (328CD450) */
  SetEnableLeftTop(pos: Vec2): void {
    this.m_vEnableLeftTop.set(pos.x, pos.y);
  }

  /** `SetEnableRightBottom(D3DXVECTOR2)` (328CD490) */
  SetEnableRightBottom(pos: Vec2): void {
    this.m_vEnableRightBottom.set(pos.x, pos.y);
  }

  /** `SetGuideDesc_LUA(int)` (329255C0): the text of a string table entry */
  SetGuideDesc(stringIndex: number): void {
    this.m_GuideDesc = this.ctx.strings.get(stringIndex); // the debug-info variant is not ported
  }

  /** `SetGuideDescByString_LUA(const char*)` (32925580): converted straight into the member, NULL leaves it as it was */
  SetGuideDescByString(text: string | undefined): void {
    if (text !== undefined) this.m_GuideDesc = text;
  }

  /** `SetGuideDescAbsolutePos(D3DXVECTOR2)` (32925560), virtual */
  SetGuideDescAbsolutePos(pos: Vec2): void {
    this.m_vGuideDescAbsolutePos.set(pos.x, pos.y);
  }

  /** `SetGuideDescOffsetPos(D3DXVECTOR2)` (329255A0), virtual */
  SetGuideDescOffsetPos(pos: Vec2): void {
    this.m_vGuideDescOffsetPos.set(pos.x, pos.y);
  }

  /** `SetShowDescriptionWhenDisable(bool)` (328CDFC0) */
  SetShowDescriptionWhenDisable(show: boolean): void {
    this.m_bShowDescriptionWhenDisable = show;
  }

  /** `AddDummyPos(D3DXVECTOR3)` (328C0D00) */
  AddDummyPos(pos: Vec3): void {
    this.m_DummyPosList.push(new Vec3(pos.x, pos.y, pos.z));
  }

  /** `GetDummyPos(int)` (329246B0): (0, 0, 0) for an index out of range */
  GetDummyPos(index: number): Vec3 {
    const p = index < 0 ? undefined : this.m_DummyPosList[index];
    return p ? new Vec3(p.x, p.y, p.z) : new Vec3();
  }

  /** `AddDummyString_LUA(const char*)` (32923B50) */
  AddDummyString(text: string): void {
    this.m_DummyStringList.push(text);
  }

  /** `GetDummyString(int)` (32924720): "Unknown" for an index out of range */
  GetDummyString(index: number): string {
    return (index < 0 ? undefined : this.m_DummyStringList[index]) ?? "Unknown";
  }

  /** `AddDummyInt(int)` (328C0CA0) */
  AddDummyInt(value: number): void {
    this.m_DummyIntList.push(value | 0);
  }

  /** `GetDummyInt(int)` (32924680): -1 for an index out of range */
  GetDummyInt(index: number): number {
    return (index < 0 ? undefined : this.m_DummyIntList[index]) ?? -1;
  }

  /** `RequestFocus()` (32925390), virtual: a control in a dialog asks the dialog */
  RequestFocus(): void {
    this.m_pDialog?.requestFocus(this);
  }

  /** `CanHaveFocus()` (329240B0), virtual slot 14 */
  canHaveFocus(): boolean {
    return this.m_bEnable && this.m_bShow;
  }

  /** `OnFocusIn()`, virtual slot 9 */
  onFocusIn(): void {
    this.m_bHasFocus = true;
  }

  /** `OnFocusOut()`, virtual slot 10 */
  onFocusOut(): void {
    this.m_bHasFocus = false;
  }

  /**
   * `SendInternelEvent(hWnd, uMsg, wParam, lParam)` (329253D0): the control's dialog hands the message to its stage (when there is a
   * stage and it is alive); false when the control has no dialog or the dialog no stage.
   */
  sendInternelEvent(msg: number, wParam: number | string, lParam: unknown = this): boolean {
    const stage = this.m_pDialog?.m_pStage as UIStage | undefined | null;
    if (!stage) return false;
    stage.MsgProc?.(msg, wParam, lParam);
    return true;
  }

  /** `Move(pos, color, fChangeTime, bDirect, bAutoDelete, bPingPong, repeatNum)` (329248A0) */
  move(pos: Vec2, color: Color, fChangeTime: number, bDirect: boolean, bAutoDelete: boolean, bPingPong: boolean, repeatNum: number): void {
    const item = (p: Vec2, c: Color, autoDelete: boolean): ControlMoveItem => ({
      pos: p.clone(), color: c.clone(), fChangeTime, bIsAutoDelete: autoDelete,
    });
    if (bDirect) {
      this.m_queMoveItems.length = 0;
      this.m_fAnimateTime = 0;
      this.m_GoalPos.set(pos.x, pos.y);
      this.m_fChangeTime = fChangeTime;
      this.m_GoalColor.set(color.r, color.g, color.b, color.a);
      if (bPingPong) {
        // the way back: from where the control is now
        this.m_bAutoDelete = false;
        this.m_queMoveItems.push(item(this.m_OffsetPos, this.m_Color, bAutoDelete));
      } else {
        this.m_bAutoDelete = bAutoDelete;
      }
    } else if (repeatNum > 0) {
      for (let n = repeatNum; n > 0; n--) {
        if (bPingPong) {
          this.m_queMoveItems.push(item(pos, color, false));
          this.m_queMoveItems.push(item(this.m_OffsetPos, this.m_Color, bAutoDelete));
        } else {
          this.m_queMoveItems.push(item(pos, color, bAutoDelete));
        }
      }
    }
  }

  /**
   * `Move_LUA()` (32924C30): the table on top of the stack: `IS_DIRECT`, `CHANGE_TIME`, `AUTO_DELETE`, `IS_PINGPONG`, `REPEAT_NUM`,
   * `POS`, `COLOR` (default white).
   */
  Move(): void {
    const m = new KLuaManager(this.ctx.world.rt, 1);
    const bDirect = m.getBool("IS_DIRECT") ?? false;
    const fChangeTime = m.getFloat("CHANGE_TIME") ?? 0;
    const bAutoDelete = m.getBool("AUTO_DELETE") ?? false;
    const bPingPong = m.getBool("IS_PINGPONG") ?? false;
    const repeatNum = m.getInt("REPEAT_NUM") ?? 1;
    const pos = m.getVec2("POS") ?? new Vec2();
    const color = m.getColor("COLOR") ?? new Color(1, 1, 1, 1);
    this.move(pos, color, fChangeTime, bDirect, bAutoDelete, bPingPong, repeatNum);
  }

  /** `MoveStop()` (32924BE0) */
  MoveStop(): void {
    this.m_fAnimateTime = 0;
    this.m_fChangeTime = 0;
    this.m_queMoveItems.length = 0;
  }

  /** `GetIsMoving()` (32924810) */
  GetIsMoving(): boolean {
    return this.m_fAnimateTime !== 0 || this.m_fChangeTime !== 0 || this.m_queMoveItems.length !== 0;
  }

  /**
   * `AddTexChangeData(map, point, data)` (32923CE0): a texture-animation step is entered under its sequence id (an older step with that id
   * is released); the step with id 0 is also the picture the point shows.
   */
  addTexChangeData(map: Map<number, TexChangeData>, point: UIPointData | null, data: TexChangeData | null): void {
    if (!data) return;
    const old = map.get(data.m_SequenceID);
    if (old) {
      if (point && point.pUITextureData === old.m_pTexData) point.pUITextureData = null;
      old.release(this.ctx.devices);
    }
    map.set(data.m_SequenceID, data);
    if (data.m_SequenceID === 0 && point && data.m_pTexData) {
      point.pUITextureData = data.m_pTexData;
      point.applyTextureSize();
    }
  }
}
