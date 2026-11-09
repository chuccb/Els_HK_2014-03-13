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
import { LuaError } from "@els/lua";
import { D3DPT, matTransformation2D, vec2Transform } from "@els/d3d9";
import { DVB_TYPE } from "@els/engine";
import type { DeviceManager, DeviceSound, DeviceTexture } from "./device.ts";
import type { CKTDGUIDialog } from "./dialog.ts";
import type { CKTDGUIDialogManager } from "./dialogmanager.ts";
import type { UIInputManager, UIKeyboard, UIMouse } from "./input.ts";
import type { UIRender, VertexUI4 } from "./render.ts";
import { ftoi } from "./rect.ts";
import { pick2DRect } from "./pick.ts";
import type { UIFonts } from "./font.ts";
import type { ImeSystem } from "./imeeditbox.ts";

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
  /** the font lookup of the dialog manager (`m_mapFontToUKFont`, `m_mapUKFontList`) */
  readonly fonts: UIFonts;
  /** the statics of the IME edit box class */
  readonly ime: ImeSystem;
  /** `MessageBoxA(g_pKTDXApp->m_hWnd, text, caption, 0)` (a modal box the exe shows when a script asks for a control that is not there) */
  messageBox(text: string, caption: string): void;
  /**
   * What the UI draws with (`g_pKTDXApp->m_pd3dDevice`, `m_pDVBManager`, `m_ResolutionScale`).  Null: nothing is drawn (the census and most
   * tests build dialogs without a device; a draw call then fails the way the exe's does without a device).
   */
  readonly render: UIRender | null;
  /** `g_pKTDXApp->m_pDGManager->m_pDialogManager`: what the dialogs ask of it (so far: whether the dialogs are hidden) */
  readonly dialogManager: CKTDGUIDialogManager;
  /** `_clock()` in milliseconds: the CRT's clock the `boost::timer` of a dialog counts from */
  clock(): number;
  /** `g_pKTDXApp->m_pDIManager`: the input manager's flag the dialog manager sets (`m_bEnabled`) */
  readonly diManager: UIInputManager;
  /** `g_pKTDXApp->m_pDIManager->m_KTDIKeyboard`: the keys the controls ask for (a focused button answers the Enter key) */
  readonly keyboard: UIKeyboard;
  /** `g_pKTDXApp->m_pDIManager->m_KTDIMouse`: where the mouse is (the list box asks which row it is over) */
  readonly mouse: UIMouse;
  /** the function-level statics of the `OnFrameRender`s: what the exe keeps for the life of its process, a world keeps here */
  readonly statics: RenderStatics;
}

/**
 * The `static bool`s the exe's combo box and list box `OnFrameRender`s keep in their .bss (`bSBInit` 388113, `bSBInit_0` 393019): each sets
 * the page size of its scroll bar the FIRST time any box of its class is drawn and never again, so a second box keeps the page size it was
 * given when it was made.
 */
export class RenderStatics {
  /** `bSBInit`: `CKTDGUIComboBox::OnFrameRender` (3293DB00) has run once */
  bSBInit = false;
  /** `bSBInit_0`: `CKTDGUIListBox::OnFrameRender` (32943BA0) has run once */
  bSBInit_0 = false;
}

const f = Math.fround;

/** the position of `fs_uiDialogNullObject` (a dialog made by the plain constructor, 328776F0, at 0x336434B8), the dialog a handle that resolves to nothing answers */
const NULL_DIALOG_POS = { x: 0, y: 0 };

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

  /**
   * `~UITextureData` (32923950): the texture device is closed (`CloseDevice` of its id: the reference this data holds) and forgotten.  The
   * exe reads `g_pKTDXApp->m_pDeviceManager`; the caller hands the device manager over.
   */
  Destroy(devices: DeviceManager): void {
    if (this.pTexture) {
      devices.closeDevice(this.pTexture.deviceID);
      this.pTexture = null;
    }
  }
}

/**
 * What every destructor does for a texture data it holds (`if (p != nullptr) { p->~UITextureData(); operator delete(p); p = nullptr; }`):
 * the data is destroyed (its texture device closed); the answer is the new value of the field.
 */
export function destroyTexture(devices: DeviceManager, data: UITextureData | null): null {
  data?.Destroy(devices);
  return null;
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

  /** `~TexChangeData` (329238B0): the step's texture data is destroyed (its texture device is closed) and forgotten */
  Destroy(devices: DeviceManager): void {
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

/**
 * The texture of a whole image, without a key (`CPictureData::SetTex_LUA2`, `CKTDGUISlot::SetItemTex(file)` build it by hand):
 * `uvOrgTexture` is the image's rectangle in texels, so the UVs are 0..1, and `texSize` its size.  Null when the file does not open.
 */
export function wholeTextureData(ctx: UIContext, fileName: string): UITextureData | null {
  const data = new UITextureData();
  data.texName = fileName;
  data.pTexture = ctx.devices.openTexture(fileName) ?? null;
  if (!data.pTexture) return null; // the UITextureData is deleted
  const w = f(data.pTexture.info.Width), h = f(data.pTexture.info.Height);
  data.uvOrgTexture[0]!.set(0, 0);
  data.uvOrgTexture[1]!.set(w, 0);
  data.uvOrgTexture[2]!.set(0, h);
  data.uvOrgTexture[3]!.set(w, h);
  data.texSize.set(w, h);
  data.setTextureUV();
  data.keyFound = true;
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

/**
 * What a `wchar_t[capacity]` keeps of a string the exe copies into it with the loop of `AddItem` (up to a NUL, at most `capacity - 1`
 * characters, the last one the terminator)
 */
export function wcharText(text: string, capacity = 256): string {
  const nul = text.indexOf("\0");
  return (nul < 0 ? text : text.slice(0, nul)).slice(0, capacity - 1);
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

  /**
   * `~CPictureData` (329237F0): the texture data is destroyed (the texture device it holds is closed: the exe inlines `~UITextureData` here)
   * and the point data is freed; both pointers are null afterwards.
   */
  Destroy(): void {
    if (this.pTexture) {
      this.pTexture.Destroy(this.ctx.devices);
      this.pTexture = null;
    }
    this.pPoint = null;
  }

  /** `SetTex_LUA(file, key)` (329277D0): the old texture is closed and replaced; the point data (if there is one) follows the new texture */
  SetTex(fileName: string, key: string): void {
    const old = this.pTexture;
    if (old) {
      old.Destroy(this.ctx.devices);
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
    const data = wholeTextureData(this.ctx, fileName);
    if (!data) return;
    if (this.pTexture) this.pTexture.Destroy(this.ctx.devices); // the old one: `scalar deleting destructor`
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

  /**
   * The `SetPoint()` without an argument (32925F30), which C++ code calls on a picture that has a texture and no point yet: a default point
   * (`UIPointData()`) that draws the texture, sized from it, at the origin; the picture is as big as the texture.
   */
  setDefaultPoint(): void {
    if (this.pPoint || !this.pTexture) return;
    const p = new UIPointData();
    this.pPoint = p;
    p.pUITextureData = this.pTexture;
    p.applyTextureSize();
    this.pos.set(p.leftTopPoint.x, p.leftTopPoint.y);
    this.originalPos.set(this.pos.x, this.pos.y);
    this.size.set(this.pTexture.texSize.x, this.pTexture.texSize.y);
    this.originalSize.set(this.size.x, this.size.y);
  }

  /**
   * `SetSize(D3DXVECTOR2)` (32926600): the picture gets the size and its point the corners that follow from it, from the left-top corner.  A
   * picture with a texture and no point is given the default point first (the original size is then the new size); without a texture
   * either it is error log 0x159.
   */
  setSize(size: Vec2): void {
    this.size.set(size.x, size.y);
    if (!this.pPoint) {
      if (!this.pTexture) {
        this.ctx.devices.massFiles.log.push(0x159);
        return;
      }
      const q = new UIPointData();
      this.pPoint = q;
      q.pUITextureData = this.pTexture;
      q.applyTextureSize();
      this.pos.set(q.leftTopPoint.x, q.leftTopPoint.y);
      this.originalPos.set(this.pos.x, this.pos.y);
      this.originalSize.set(this.size.x, this.size.y);
    }
    const p = this.pPoint;
    const w = this.size.x, h = this.size.y;
    p.rightTopPoint.set(f(p.leftTopPoint.x + w), p.leftTopPoint.y);
    p.leftBottomPoint.set(p.leftTopPoint.x, f(p.leftTopPoint.y + h));
    p.rightBottomPoint.set(f(p.leftTopPoint.x + w), f(p.leftTopPoint.y + h));
  }

  /**
   * `SetPos(D3DXVECTOR2)` (329263B0): the picture moves, its point (the quad of the picture) with it; without a point (`SetPoint` was not
   * called yet) it is error log 0x15B
   */
  SetPos(pos: Vec2): void {
    this.pos.set(pos.x, pos.y);
    const p = this.pPoint;
    if (!p) {
      this.ctx.devices.massFiles.log.push(0x15b);
      return;
    }
    const x = this.pos.x, y = this.pos.y, w = this.size.x, h = this.size.y;
    p.leftTopPoint.set(x, y);
    p.rightTopPoint.set(w + x, y);
    p.leftBottomPoint.set(x, h + y);
    p.rightBottomPoint.set(w + x, h + y);
  }

  /**
   * `OnFrameMove(fTime, fElapsedTime)` (32924E80), the animations a picture can be given (`SetTwinkle`, `SetFlicker`, `Vibrate`, `FadeIn`,
   * `FadeOut`): the picture's point is the one they write to (its alpha, or the picture's position).  A static runs it only for a picture
   * that has one of them on.
   * * Twinkle: the remaining time counts down; while it is above 0 the alpha is 0 when `(float)(t - (float)(int)(t / 0.7f)) < 0.2f` (the exe
   *   subtracts the whole number of 0.7 s, not 0.7 times it) and the original alpha otherwise; at 0 it starts again (loop) or ends, with the original alpha.
   * * Flicker: the remaining time goes up to `m_fFlickerTime` and down to 0 (the loop turns it round again) and the alpha is
   *   `(max - min) * t / flickerTime + min`.
   * * Vibrate: the picture moves away from where it was along `m_vDirSpeed` until it is `m_fDistance` away (the length is a double's square root
   *   rounded to a float), then back until it is no longer on the way out; after `m_fMaxTime` it is put back (`pos` only; the point is not moved).
   * * FadeIn / FadeOut: the alpha is `t / fadeTime` or `1 - t / fadeTime`; a time past the fade time sets it to 1 or 0 and ends.
   */
  onFrameMove(fTime: number, fElapsedTime: number): void {
    void fTime;
    const dt = f(fElapsedTime);
    const point = this.pPoint;
    if (this.m_bTwinkle) {
      let original = true; // `LABEL_10`: the alpha goes back to the original
      if (this.m_fRemainTwinkleTime > 0) {
        const t = f(this.m_fRemainTwinkleTime - dt);
        this.m_fRemainTwinkleTime = t;
        original = false;
        if (point) {
          const phase = f(t - f(cvttss2si(f(t / TWINKLE_PERIOD))));
          if (phase < TWINKLE_OFF) point.color.a = 0;
          else original = true;
        }
      } else if (this.m_bLoop) this.m_fRemainTwinkleTime = this.m_fTwinkleTime;
      else this.m_bTwinkle = false;
      if (original && point) point.color.a = this.m_fOriginalAlpha;
    }
    if (this.m_bFlicker) {
      let t: number;
      if (this.m_bFlickerGainAlpha) {
        t = f(this.m_fRemainFlickerTime + dt);
        this.m_fRemainFlickerTime = t;
        if (!(t <= this.m_fFlickerTime)) this.m_bFlickerGainAlpha = false;
      } else {
        t = f(this.m_fRemainFlickerTime - dt);
        this.m_fRemainFlickerTime = t;
        if (t < 0) {
          if (this.m_bFlickerLoop) this.m_bFlickerGainAlpha = true;
          else this.m_bFlicker = false;
        }
      }
      if (point) point.color.a = f(f(f(f(this.m_fFlickerMaxAlpha - this.m_fFlickerMinAlpha) * t) / this.m_fFlickerTime) + this.m_fFlickerMinAlpha);
    }
    const v = this.m_VibrateData;
    if (v.m_fMaxTime <= v.m_fElapsedTime) {
      if (v.m_fMaxTime !== 0) {
        v.m_fMaxTime = 0;
        this.pos.set(v.m_vOriginalPos.x, v.m_vOriginalPos.y);
      }
    } else {
      const goingAway = v.m_bGoingAway;
      v.m_fElapsedTime = f(v.m_fElapsedTime + dt);
      const px = this.pos.x, py = this.pos.y;
      const sx = f(v.m_vDirSpeed.x * dt), sy = f(v.m_vDirSpeed.y * dt);
      if (goingAway) {
        this.pos.set(f(px + sx), f(py + sy));
        this.SetPos(this.pos);
        const dx = f(this.pos.x - v.m_vOriginalPos.x), dy = f(this.pos.y - v.m_vOriginalPos.y);
        const length = f(Math.sqrt(f(f(dy * dy) + f(dx * dx))));
        if (length > v.m_fDistance) v.m_bGoingAway = false;
      } else {
        this.pos.set(f(px - sx), f(py - sy));
        this.SetPos(this.pos);
        const along = f(f(f(this.pos.y - v.m_vOriginalPos.y) * v.m_vDirSpeed.y) + f(f(this.pos.x - v.m_vOriginalPos.x) * v.m_vDirSpeed.x));
        if (along <= 0) v.m_bGoingAway = true;
      }
    }
    if (this.m_bFadeIn) {
      if (this.m_fFadeTime < this.m_fRemainFadeTime) {
        if (point) point.color.a = 1;
        this.m_bFadeIn = false;
      } else {
        const t = f(this.m_fRemainFadeTime + dt);
        this.m_fRemainFadeTime = t;
        if (point) point.color.a = f(t / this.m_fFadeTime);
      }
    }
    if (this.m_bFadeOut) {
      if (this.m_fFadeTime < this.m_fRemainFadeTime) {
        if (point) point.color.a = 0;
        this.m_bFadeOut = false;
      } else {
        const t = f(this.m_fRemainFadeTime + dt);
        this.m_fRemainFadeTime = t;
        if (point) point.color.a = f(1 - f(t / this.m_fFadeTime));
      }
    }
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
/** `E_FAIL`: what `RenderVertex` answers when it cannot draw */
const E_FAIL = -2147467259;
/** the `0.017453292f` of the animation's angles (degrees to radians, a float) */
const DEGREES_TO_RADIANS = f(0.017453292);

/** the `0.7f` and `0.2f` of the twinkle */
const TWINKLE_PERIOD = f(0.7);
const TWINKLE_OFF = f(0.2);

/** `(float)(int)x`'s `(int)`: `cvttss2si` truncates, and a value that does not fit an int (or a NaN) is `0x80000000` */
function cvttss2si(x: number): number {
  const t = Math.trunc(x);
  return t >= -2147483648 && t <= 2147483647 ? t : -2147483648;
}

/** `(float)((float)((float)(goal - now) * k) * dt) + now`: one frame of the linear approach `Animate` and `ChangePoint` make (every operation rounds to a float) */
export function approach(now: number, goal: number, k: number, dt: number): number {
  return f(f(f(f(goal - now) * k) * dt) + now);
}

/** `c < 1 ? (c > 0 ? (int)(float)((float)(c * 255) + 0.5) : 0) : 255` (a NaN is 255), the clamp `UpdateVertex` makes of each colour channel */
export function clampedByte(c: number): number {
  if (!(c < 1)) return 255;
  if (!(c > 0)) return 0;
  return Math.trunc(f(f(c * 255) + 0.5));
}

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
  /**
   * Not in the exe (a check for the census): the sound references this control leaves open for good, because the exe overwrites the pointer
   * without closing the sound (`SetCustomMouseOverSound` / `SetCustomMouseUpSound` of a button and a radio button) or its destructor never
   * closes it (a button's mouse down sound).  The census adds them up and expects the device manager to hold exactly these once every
   * dialog is destroyed.
   */
  readonly leakedSounds: DeviceSound[] = [];

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

  // ---- drawing -------------------------------------------------------------------------------------------------------------------

  /**
   * Virtual `OnFrameRender`: draws the control.  A control class whose drawing is not ported yet draws nothing (and is counted in
   * `render.undrawn`); the classes that are override this.
   */
  onFrameRender(): number {
    this.ctx.render?.noteUndrawn(this.constructor.name);
    return 0;
  }

  /** virtual `OnFrameRenderEnd`: the second pass over the controls of a dialog, after all of them are drawn (only the combo box has one) */
  onFrameRenderEnd(): number {
    return 0;
  }

  // ---- the frame's update (`OnFrameMove`) ----------------------------------------------------------------------------------------

  /**
   * Virtual `OnFrameMove(fTime, fElapsedTime)` (32924DB0): a shown control keeps the frame's time (`m_fElapsedTime`, a float) and runs
   * `Animate`.  Always 0 (`S_OK`).  Every class's override calls it first.
   */
  onFrameMove(fTime: number, fElapsedTime: number): number {
    void fTime;
    if (this.m_bShow) {
      this.m_fElapsedTime = f(fElapsedTime);
      this.animate();
    }
    return 0;
  }

  /**
   * `Animate()` (32923EB0), the work of `Move`: with a change time the offset (and the colour) go towards the goal by
   * `(goal - now) / (changeTime - animateTime) * elapsed` a frame while `m_fAnimateTime` counts up; once it is no longer below the change time
   * the control jumps to its goal (an auto-delete control is marked, `m_bCheckAutoDeleteEnd`).  A control with no running move takes the
   * next item of its queue as the goal (in the same call that finished the last one).  Every operation rounds to a float.
   */
  animate(): void {
    if (this.m_fChangeTime > 0) {
      const at = this.m_fAnimateTime;
      if (at < this.m_fChangeTime) {
        const o = this.m_OffsetPos, g = this.m_GoalPos, c = this.m_Color, gc = this.m_GoalColor;
        const k = f(1 / f(this.m_fChangeTime - at));
        const dt = this.m_fElapsedTime;
        o.x = approach(o.x, g.x, k, dt);
        o.y = approach(o.y, g.y, k, dt);
        c.r = approach(c.r, gc.r, k, dt);
        c.g = approach(c.g, gc.g, k, dt);
        c.b = approach(c.b, gc.b, k, dt);
        c.a = approach(c.a, gc.a, k, dt);
        this.m_fAnimateTime = f(dt + at);
      } else {
        this.m_fAnimateTime = 0;
        this.m_fChangeTime = 0;
        this.m_OffsetPos.set(this.m_GoalPos.x, this.m_GoalPos.y);
        if (this.m_bAutoDelete) this.m_bCheckAutoDeleteEnd = true;
      }
    }
    if (this.m_fChangeTime === 0 && this.m_queMoveItems.length !== 0) {
      const item = this.m_queMoveItems.shift()!;
      this.m_GoalPos.set(item.pos.x, item.pos.y);
      this.m_GoalColor.set(item.color.r, item.color.g, item.color.b, item.color.a);
      this.m_fChangeTime = item.fChangeTime;
      this.m_bAutoDelete = item.bIsAutoDelete;
    }
  }

  /**
   * `ChangePoint(pNowPoint, pEndPoint)` (329240D0): the point (colour and the four corners) goes from `now` towards `end` in the time
   * that is left, `pNowPoint->fChangeTime` counting up by the frame's time; when the frame is not shorter than what is left it
   * becomes the end point (`*pNowPoint = *pEndPoint`, the texture pointer and the blend states with it).  Nothing when both change times agree.
   */
  changePoint(now: UIPointData, end: UIPointData): void {
    const ct = now.fChangeTime;
    if (end.fChangeTime === ct) return;
    const dt = this.m_fElapsedTime;
    const span = f(end.fChangeTime - ct);
    if (dt < span) {
      const k = f(1 / span);
      for (const ch of ["r", "g", "b", "a"] as const) now.color[ch] = approach(now.color[ch], end.color[ch], k, dt);
      for (const corner of ["leftTopPoint", "rightTopPoint", "leftBottomPoint", "rightBottomPoint"] as const) {
        const n = now[corner], e = end[corner];
        n.x = approach(n.x, e.x, k, dt);
        n.y = approach(n.y, e.y, k, dt);
      }
      now.fChangeTime = f(dt + ct);
    } else {
      now.assign(end);
    }
  }

  /**
   * `UpdateTexChangeData(pTexChangeData)` (32927DE0): the running texture animation (`m_NowTexChangeData`) goes one frame towards the step it is
   * heading for (rotation, position, scale and the scale rotation by `(goal - now) / (showTime - elapsedShowTime) * elapsed`); a step that has
   * been shown for its time ends: the values become the step's, and the sequence goes on to the next id (`m_SequenceID + 1`, or the running data's own
   * `m_SequenceIDToGo` when that is not -1: the exe reads it from `m_NowTexChangeData`, not from the step), or the animation ends (`m_bEndTexChange`) when the
   * step is the last.  With no step the sequence id is 0.
   */
  updateTexChangeData(step: TexChangeData | null | undefined): void {
    const now = this.m_NowTexChangeData;
    if (!step) {
      now.m_SequenceID = 0;
      return;
    }
    if (step.m_RotateAxis !== TA.NONE) now.m_RotateAxis = step.m_RotateAxis;
    if (step.m_ScaleAxis !== TA.NONE) now.m_ScaleAxis = step.m_ScaleAxis;
    const dt = this.m_fElapsedTime;
    const rotate0 = now.m_fRotateDegree;
    now.m_fShowTime = f(dt + now.m_fShowTime);
    const left = f(step.m_fShowTime - now.m_fShowTime); // `v8`
    now.m_fRotateDegree = f(f(f(f(step.m_fRotateDegree - rotate0) / left) * dt) + rotate0);
    const inv = f(1 / left);
    const dy = f(step.m_Pos.y - now.m_Pos.y);
    now.m_Pos.x = f(f(f(f(step.m_Pos.x - now.m_Pos.x) * inv) * dt) + now.m_Pos.x);
    now.m_Pos.y = f(f(f(inv * dy) * dt) + now.m_Pos.y);
    const scaleY = f(f(f(inv * f(step.m_Scale.y - now.m_Scale.y)) * dt) + now.m_Scale.y);
    now.m_Scale.x = f(f(f(f(step.m_Scale.x - now.m_Scale.x) * inv) * dt) + now.m_Scale.x);
    now.m_Scale.y = scaleY;
    now.m_fScaleRotationDegree = f(f(f(f(step.m_fScaleRotationDegree - now.m_fScaleRotationDegree) / left) * dt) + now.m_fScaleRotationDegree);
    if (now.m_fShowTime >= step.m_fShowTime) {
      now.m_fShowTime = 0;
      now.m_fRotateDegree = step.m_fRotateDegree;
      now.m_fScaleRotationDegree = step.m_fScaleRotationDegree;
      now.m_Pos.set(step.m_Pos.x, step.m_Pos.y);
      now.m_Scale.set(step.m_Scale.x, step.m_Scale.y);
      if (step.m_bEndTexChange) now.m_bEndTexChange = true;
      else if (now.m_SequenceIDToGo === -1) now.m_SequenceID = (now.m_SequenceID + 1) | 0;
      else now.m_SequenceID = now.m_SequenceIDToGo;
    }
  }

  /**
   * `ShowGuideDesc()` (32927C30): a control with a guide text asks its dialog to show it (`CKTDGUIDialog::ShowGuideDesc` 3295BA30 builds the
   * guide dialog and measures the text with a font: not ported, so it throws).
   */
  showGuideDesc(): void {
    if (this.m_GuideDesc.length !== 0 && this.m_pDialog !== null) this.m_pDialog.showGuideDesc(this);
  }

  /**
   * `UpdateVertex(vertexLT, vertexRT, vertexLB, vertexRB, pointData)` (32927FB0; every caller passes the control's `m_Vertex[0..3]`).  A
   * control that is in no dialog does nothing.  Each corner is `(dialog.m_Pos + corner + m_OffsetPos) * m_ResolutionScale`, cut to whole
   * pixels and moved half a pixel up and left (`(float)(int)x - 0.5`, the texel-centre offset of Direct3D 9), at `z = rhw = 1`; the colour
   * of all four is the dialog's times the point data's times the control's, per channel clamped to 0..1, `(int)(c * 255 + 0.5)`, packed
   * `ARGB`; the UVs are the texture data's four `uvTexture` (kept as they were when the point data has no texture).
   */
  updateVertex(vertex: VertexUI4, pointData: UIPointData): void {
    const dialog = this.m_pDialog;
    if (!dialog) return;
    const scale = this.ctx.render?.resolutionScale;
    const sx = scale ? scale.x : 1, sy = scale ? scale.y : 1;
    const dc = dialog.m_Color, pc = pointData.color, cc = this.m_Color;
    const a = f(f(dc.a * pc.a) * cc.a);
    const r = f(f(dc.r * pc.r) * cc.r);
    const g = f(f(dc.g * pc.g) * cc.g);
    const b = f(f(dc.b * pc.b) * cc.b);
    const argb = ((((clampedByte(a) << 8) | clampedByte(r)) << 8 | clampedByte(g)) << 8 | clampedByte(b)) >>> 0;
    const corners = [pointData.leftTopPoint, pointData.rightTopPoint, pointData.leftBottomPoint, pointData.rightBottomPoint];
    for (let i = 0; i < 4; i++) {
      const c = corners[i]!;
      vertex.setX(i, f(f(f(dialog.m_Pos.x + c.x) + this.m_OffsetPos.x) * sx));
      vertex.setY(i, f(f(f(dialog.m_Pos.y + c.y) + this.m_OffsetPos.y) * sy));
      vertex.setZ(i, 1);
      vertex.setRhw(i, 1);
      vertex.setColor(i, argb);
    }
    for (let i = 0; i < 4; i++) {
      vertex.setX(i, f(f(ftoi(vertex.x(i))) - 0.5));
      vertex.setY(i, f(f(ftoi(vertex.y(i))) - 0.5));
    }
    const texture = pointData.pUITextureData;
    if (texture) {
      for (let i = 0; i < 4; i++) {
        vertex.setU(i, texture.uvTexture[i]!.x);
        vertex.setV(i, texture.uvTexture[i]!.y);
      }
    }
  }

  /**
   * The edge `CKTDGUIStatic::DrawEdge` (32929090), `CKTDGUISlot::DrawEdge` (32951310) and `CKTDGUIRadioButton::DrawCheckedEdge`
   * (32949850) draw around the quad of `point`: the same eight calls in the three classes (compared one by one; they differ only in where
   * the edge, its colour and the quad come from, and in how a class takes the width of the quad: the static's and the slot's from the
   * right-top corner, the radio button's from the right-bottom one, hence the arguments `nWidth` and `nHeight`).
   *
   * The colour of the bars is the dialog's times `edgeColor` times the control's, per channel clamped to a byte (as `UpdateVertex` does).
   * A bar is a `CKTDXDeviceTexture::Draw` of the edge texture; the corners are whole pixels, cut after the offsets are added.  Outside
   * (`drawOut`): the four bars go round the quad like a pinwheel, `edgeWidth` wide, none of them covering another (left: from the
   * top-left corner of the outside down to the bottom of the quad, bottom: from the left outside to the right edge of the quad, right: from the top
   * of the quad down to the bottom outside, top: from the left edge of the quad to the right outside).  Inside: the four bars lie on the
   * quad's own edge, the left and the right one as high as the quad, the bottom and the top one as wide as it, so the corners are drawn twice.
   */
  protected drawEdgeBars(texture: DeviceTexture, drawOut: boolean, edgeWidth: number, edgeColor: Color, point: UIPointData, nWidth: number, nHeight: number): void {
    const render = this.ctx.render;
    if (!render) return;
    const dialog = this.m_pDialog!;
    const dc = dialog.m_Color, cc = this.m_Color;
    const argb = (((((clampedByte(f(f(dc.a * edgeColor.a) * cc.a)) << 8) | clampedByte(f(f(dc.r * edgeColor.r) * cc.r))) << 8 |
      clampedByte(f(f(dc.g * edgeColor.g) * cc.g))) << 8) | clampedByte(f(f(dc.b * edgeColor.b) * cc.b))) >>> 0;
    const x = (corner: number): number => f(f(dialog.m_Pos.x + this.m_OffsetPos.x) + corner);
    const y = (corner: number): number => f(f(dialog.m_Pos.y + this.m_OffsetPos.y) + corner);
    const w = edgeWidth | 0;
    const lt = point.leftTopPoint, rt = point.rightTopPoint, lb = point.leftBottomPoint;
    if (drawOut) {
      texture.draw(render, ftoi(f(x(lt.x) - w)), ftoi(f(y(lt.y) - w)), w, (w + nHeight) | 0, argb, 0);
      texture.draw(render, ftoi(f(x(lt.x) - w)), ftoi(y(lb.y)), (w + nWidth) | 0, w, argb, 0);
      texture.draw(render, ftoi(x(rt.x)), ftoi(y(lt.y)), w, (w + nHeight) | 0, argb, 0);
      texture.draw(render, ftoi(x(lt.x)), ftoi(f(y(lt.y) - w)), (w + nWidth) | 0, w, argb, 0);
    } else {
      texture.draw(render, ftoi(x(lt.x)), ftoi(y(lt.y)), w, nHeight, argb, 0);
      texture.draw(render, ftoi(x(lt.x)), ftoi(f(y(lb.y) - w)), nWidth, w, argb, 0);
      texture.draw(render, ftoi(f(x(rt.x) - w)), ftoi(y(lt.y)), w, nHeight, argb, 0);
      texture.draw(render, ftoi(x(lt.x)), ftoi(y(lt.y)), nWidth, w, argb, 0);
    }
  }

  /**
   * `GetAxisPos(pVertex, texAxis)` (329244F0): a point of the quad the animation turns or scales about, given as one of the nine places of
   * the quad (corners and middles of the sides, from the left-top, right-top and left-bottom vertices; `BOTTOM_RIGHT` is the fourth
   * vertex); `NONE`, `WORLD` and anything else is the origin (the caller takes the data's own point for `WORLD`).
   */
  getAxisPos(vertex: VertexUI4 | null, axis: number): Vec2 {
    const out = new Vec2(0, 0);
    if (!vertex) return out;
    const midX = (): number => f(f(f(vertex.x(1) - vertex.x(0)) * 0.5) + vertex.x(0));
    const midY = (): number => f(f(f(vertex.y(2) - vertex.y(0)) * 0.5) + vertex.y(0));
    switch (axis) {
      case TA.TOP_LEFT: out.set(vertex.x(0), vertex.y(0)); break;
      case TA.TOP_CENTER: out.set(midX(), vertex.y(0)); break;
      case TA.TOP_RIGHT: out.set(vertex.x(1), vertex.y(0)); break;
      case TA.CENTER_LEFT: out.set(vertex.x(0), midY()); break;
      case TA.CENTER_CENTER: out.set(midX(), midY()); break;
      case TA.CENTER_RIGHT: out.set(vertex.x(1), midY()); break;
      case TA.BOTTOM_LEFT: out.set(vertex.x(0), vertex.y(2)); break;
      case TA.BOTTOM_CENTER: out.set(midX(), vertex.y(2)); break;
      case TA.BOTTOM_RIGHT: out.set(vertex.x(3), vertex.y(3)); break;
      default: break;
    }
    return out;
  }

  /**
   * `UpdateAnimVertex(pVertex, pTexChangeData)` (32927C70): the four vertices go through `D3DXMatrixTransformation2D` with the step's
   * scale (about its axis point, the scale rotated by `m_fScaleRotationDegree`), rotation (about its axis point) and translation `m_Pos`.
   * An axis is a place of the quad (`getAxisPos`), or the data's own point for `TA_WORLD`.
   */
  updateAnimVertex(vertex: VertexUI4 | null, data: TexChangeData | null): void {
    if (!vertex || !data) return;
    const translation = new Vec2(data.m_Pos.x, data.m_Pos.y);
    let rotationAxisPos = this.getAxisPos(vertex, data.m_RotateAxis);
    if (data.m_RotateAxis === TA.WORLD) rotationAxisPos = data.m_RotateAxisPos;
    let scaleAxisPos = this.getAxisPos(vertex, data.m_ScaleAxis);
    if (data.m_ScaleAxis === TA.WORLD) scaleAxisPos = data.m_ScaleAxisPos;
    const matrix = matTransformation2D(scaleAxisPos, f(data.m_fScaleRotationDegree * DEGREES_TO_RADIANS), data.m_Scale, rotationAxisPos, f(data.m_fRotateDegree * DEGREES_TO_RADIANS), translation);
    for (let i = 0; i < 4; i++) {
      const moved = vec2Transform({ x: vertex.x(i), y: vertex.y(i) }, matrix);
      vertex.setX(i, moved.x);
      vertex.setY(i, moved.y);
    }
  }

  /**
   * `RenderVertex(pVertex, pointData, renderCount)` (32925200): the point data's texture goes to stage 0 and the quad is drawn through
   * the dynamic vertex buffer manager as a two-triangle strip, `renderCount` times.  Without a device (error 0x82 "device null"), a vertex
   * (0x82 "null") or a texture data nothing is drawn; a texture data without a texture is error 0x83 with the control's name.  Returns
   * `E_FAIL` for each of those, else 0.
   */
  renderVertex(vertex: VertexUI4 | null, pointData: UIPointData, renderCount: number): number;
  /**
   * `RenderVertex(pVertex, bRestoreVertexDecl)` (329252C0): draws the quad with whatever texture the device holds; `bRestoreVertexDecl`
   * keeps the vertex declaration around the draw (`GetVertexDeclaration` before, `SetVertexDeclaration` and a `Release` after).
   */
  renderVertex(vertex: VertexUI4 | null, restoreVertexDecl: boolean): number;
  renderVertex(vertex: VertexUI4 | null, second: UIPointData | boolean, renderCount = 1): number {
    const log = this.ctx.devices.massFiles.log;
    const render = this.ctx.render;
    if (typeof second === "boolean") {
      if (!render) {
        log.push(0x82, "device null");
        return E_FAIL;
      }
      if (!vertex) {
        log.push(0x82, "null");
        return E_FAIL;
      }
      const decl = second ? render.device.GetVertexDeclaration() : null;
      render.dvb.drawPrimitive(DVB_TYPE.XYZRHW_DIFFUSE_TEX1, D3DPT.TRIANGLESTRIP, 2, vertex.bytes, 1);
      if (second) {
        render.device.SetVertexDeclaration(decl);
        decl?.Release();
      }
      return 0;
    }
    if (!render) {
      log.push(0x82, "device null");
      return E_FAIL;
    }
    if (!vertex) {
      log.push(0x82, "null");
      return E_FAIL;
    }
    const data = second.pUITextureData;
    if (!data) return E_FAIL;
    const texture = data.pTexture;
    if (!texture) {
      log.push(0x83, this.m_Name);
      return E_FAIL;
    }
    texture.setDeviceTexture(render, 0);
    render.dvb.drawPrimitive(DVB_TYPE.XYZRHW_DIFFUSE_TEX1, D3DPT.TRIANGLESTRIP, 2, vertex.bytes, renderCount);
    return 0;
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

  /**
   * `ContainsPoint(pt)` (32924310), virtual slot 12: the point (in the control's own layout pixels: `localPoint`) is inside the quadrilateral
   * of the control's current point, `m_NowPoint`, which it is walked left-top, right-top, right-bottom, left-bottom (`Pick2DRect`).
   */
  containsPoint(x: number, y: number): boolean {
    const p = this.m_NowPoint;
    return pick2DRect(x, y, p.leftTopPoint, p.rightTopPoint, p.leftBottomPoint, p.rightBottomPoint);
  }

  /**
   * `ContainsPoint` of Button and Slot (3292D460: the compiler folded the two): the control's own test (`CKTDGUIControl::ContainsPoint`,
   * called directly) and, when the control has an enable rectangle (`m_vEnableLeftTop` and `m_vEnableRightBottom`, each other than (0, 0)),
   * the point put in the dialog's coordinates (`+ (int)dialog.m_Pos`) inside that rectangle too.  The exe tests the rectangle with the four
   * cross products of the left-top and right-bottom corners, the other two corners being made of the same numbers (so for the corner
   * pair `(x1, y1)`, `(x2, y2)` the products are `(py - y1)(x2 - x1)`, `-(px - x2)(y2 - y1)`, `(py - y2)(x1 - x2)` and `-(px - x1)(y1 - y2)`, each
   * in single precision with the zero products it keeps): inside means all four above 0 (a rectangle walked right and down, the point
   * strictly inside) or all four below 0 (the other orientations: the box is the same).  The exe asks the dialog handle for the dialog: a control
   * in no dialog (or in one that is gone) gets the global null object `fs_uiDialogNullObject`, a dialog made by the plain constructor, whose
   * position is (0, 0).
   */
  protected containsPointInEnableRect(x: number, y: number): boolean {
    if (!CKTDGUIControl.prototype.containsPoint.call(this, x, y)) return false;
    const lt = this.m_vEnableLeftTop, rb = this.m_vEnableRightBottom;
    const x1 = lt.x;
    if (x1 === 0 && lt.y === 0) return true;
    const x2 = rb.x;
    if (x2 === 0 && rb.y === 0) return true;
    const y1 = lt.y, y2 = rb.y;
    const dialog = this.m_pDialog;
    const pos = dialog !== null && !dialog.destroyed ? dialog.m_Pos : NULL_DIALOG_POS;
    const px = f((x + ftoi(pos.x)) | 0);
    const py = f((y + ftoi(pos.y)) | 0);
    const c1 = f(f(f(py - y1) * f(x2 - x1)) - f(f(px - x1) * f(y1 - y1)));
    const c2 = f(f(f(py - y1) * f(x2 - x2)) - f(f(px - x2) * f(y2 - y1)));
    const c3 = f(f(f(py - y2) * f(x1 - x2)) - f(f(px - x2) * f(y2 - y2)));
    const c4 = f(f(f(py - y2) * f(x1 - x1)) - f(f(px - x1) * f(y1 - y2)));
    return (c1 > 0 && c2 > 0 && c3 > 0 && c4 > 0) || (c1 < 0 && c2 < 0 && c3 < 0 && c4 < 0);
  }

  /**
   * `MsgProc(hWnd, uMsg, wParam, lParam)`, virtual slot 6: a window message the focused control may answer.  The base class answers no
   * (`xor al, al; ret 10h`, 328CF610, shared with other classes' empty functions); the edit boxes override it.
   */
  msgProc(_hWnd: unknown, _uMsg: number, _wParam: number, _lParam: number): boolean {
    return false;
  }

  /** `HandleKeyboard(uMsg, wParam, lParam)` (32924880), virtual slot 7: a key message; the base class answers no */
  handleKeyboard(_uMsg: number, _wParam: number, _lParam: number): boolean {
    return false;
  }

  /**
   * `HandleMouse(uMsg, pt, wParam, lParam)` (32924890), virtual slot 8: a mouse message with the point `(x, y)` in the control's own layout
   * pixels (`localPoint`); the base class answers no.
   */
  handleMouse(_uMsg: number, _x: number, _y: number, _wParam: number, _lParam: number): boolean {
    return false;
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
   * The deleting destructor (virtual slot 0) that `~CKTDGUIDialog` and `CKTDGUIDialog::OnFrameMove` call.  Each class's `Destroy()` first
   * does what its own destructor does and then this, `~CKTDGUIControl` (32923680): the control forgets its dialog (`m_pDialog = nullptr`) and
   * its name, the texture of the animation it is running goes (`~TexChangeData`), and the strings, lists and the queue of moves it owns
   * are freed (here: emptied).
   */
  Destroy(): void {
    this.m_pDialog = null;
    this.m_Name = "";
    this.m_NowTexChangeData.Destroy(this.ctx.devices);
    this.m_GuideDesc = "";
    this.m_DummyIntList.length = 0;
    this.m_DummyStringList.length = 0;
    this.m_DummyPosList.length = 0;
    this.m_queMoveItems.length = 0;
    this.m_TabControlName = "";
    this.m_PrevTabControlName = "";
  }

  /**
   * What the destructors do for a sound or an edge texture they opened (`if (p != nullptr) { CloseDevice(g_pKTDXApp->m_pDeviceManager,
   * p->m_DeviceID); p = nullptr; }`): the device is closed once; the answer is the new value of the field.
   */
  protected closeHeldDevice(device: { readonly deviceID: string } | undefined): undefined {
    if (device) this.ctx.devices.closeDevice(device.deviceID);
    return undefined;
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
      old.Destroy(this.ctx.devices);
    }
    map.set(data.m_SequenceID, data);
    if (data.m_SequenceID === 0 && point && data.m_pTexData) {
      point.pUITextureData = data.m_pTexData;
      point.applyTextureSize();
    }
  }

  // ---- what the constructors and setters of the interactive controls share ---------------------------------------------------

  /**
   * The start of the constructors of buttons, check boxes, radio buttons, combo boxes ...: `UI_Control_Sound.lua` runs in the Lua state
   * (a missing script is error log 0x48, a failing one 0x49; the sounds stay null), then the sounds that the globals `names` hold are
   * opened (`OpenSound(name, 10, true, -1.0)`; a global that is not there reads as "", the sound system that is not initialised answers
   * null).
   */
  protected openControlSounds(names: readonly string[]): (DeviceSound | undefined)[] {
    const world = this.ctx.world;
    const log = this.ctx.devices.massFiles.log;
    const script = "UI_Control_Sound.lua";
    try {
      if (!world.execScript(script)) {
        log.push(0x48, script);
        return names.map(() => undefined);
      }
    } catch (e) {
      if (!(e instanceof LuaError)) throw e;
      log.push(0x49, script);
      return names.map(() => undefined);
    }
    const m = new KLuaManager(world.rt, 0);
    return names.map((n) => this.ctx.devices.openSound(m.getString(n) ?? ""));
  }

  /** `PlaySoundW(pSound)` (329251E0): a control that has its sound on plays the sound once, without 3D */
  playSound(pSound: DeviceSound | undefined): void {
    if (this.m_bSound && pSound) pSound.play(false, false);
  }

  /** the `Set*Tex_LUA(file, key)` setters: the old UITextureData is destroyed, the new one (null when the file does not open) replaces it */
  protected replaceTexture(old: UITextureData | null, fileName: string, key: string): UITextureData | null {
    old?.Destroy(this.ctx.devices);
    return setTexureData(this.ctx, fileName, key);
  }

  /** the `Set*Point_LUA()` setters: the table on top of the Lua stack is the point; it draws `tex`, sized from it when it asks to be */
  protected makePoint(tex: UITextureData | null): UIPointData {
    const p = readPointData(this.ctx);
    p.pUITextureData = tex;
    p.applyTextureSize();
    return p;
  }
}
