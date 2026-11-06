/**
 * `CKTDGUIControl` and the data a control draws from: `CKTDGUIControl::CPictureData`, `UIPointData`, `UITextureData`, `UIStringData`.
 *
 * Naming: a method written like the Lua name (`SetName`, `SetPoint`, `AddString`) is the function the exe registers with lua_tinker under
 * that name (`CKTDGUIControl::SetName_LUA` ...), found by the binder on the receiver; a method in lower camel case (`setName`) is the
 * C++ member function of that name that the Lua-facing one calls.  Members keep their C++ names.  `float` members are stored as floats
 * (`Vec2` / `Color` are Float32Array backed) and every intermediate of the exe's float arithmetic is rounded with `Math.fround`.
 *
 * Decompile references: CKTDGUIControl::CKTDGUIControl 32922F50 (defaults), CPictureData::CPictureData 32923280, UIPointData 32923430,
 * UITextureData 329234D0, UIStringData 32F56BC0, SetPointData_ 32926010, SetStringData_ 329269C0, SetTexureData_ 32927A60,
 * UITextureData::SetTextureUV 329279A0, CPictureData::SetTex_LUA 329277D0, SetPoint_LUA 329262D0, SetPos 329263B0.
 */
import { KLuaManager, Color, Vec2, towupperAscii } from "@els/host";
import type { CKTDGUIControl__CPictureData_Methods, CKTDGUIControl_Methods, HostWorld } from "@els/host";
import type { StringTable } from "@els/assets";
import type { DeviceManager, DeviceTexture } from "./device.ts";
import type { CKTDGUIDialog } from "./dialog.ts";

/** `CKTDGUIControl::UI_CONTROL_TYPE` */
export const UCT = {
  NONE: 0, BUTTON: 1, CHECKBOX: 2, EDITBOX: 3, IME_EDITBOX: 4, STATIC: 5, RADIOBUTTON: 6, SCROLLBAR: 7, COMBOBOX: 8, LISTBOX: 9,
  SLIDER: 10, NAVIGATION: 11, CONTROLLIST: 12, SLOT: 13,
} as const;

/** `D3DBLEND` values the point data defaults to */
export const D3DBLEND_SRCALPHA = 5;
export const D3DBLEND_INVSRCALPHA = 6;

/** what the C++ code reaches through its globals: `g_pKTDXApp->m_pDeviceManager`, `CKTDXStringTable::GetInstance()`, `CKTDXApp::ms_pLuaBinder` */
export interface UIContext {
  readonly devices: DeviceManager;
  readonly strings: StringTable;
  /** the one Lua state (`CKTDXApp::ms_pLuaBinder`) */
  readonly world: HostWorld;
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

  /** `CKTDGUIControl::SetTexureData_(file, key)` (32927A60): opens the texture and looks the key up in its UV table */
  private setTexureData(fileName: string, keyName: string): UITextureData | null {
    const data = new UITextureData();
    data.texName = fileName;
    data.keyName = keyName;
    data.pTexture = this.ctx.devices.openTexture(fileName) ?? null;
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
    }
    return data;
  }

  /** `SetTex_LUA(file, key)` (329277D0): the old texture is closed and replaced; the point data (if there is one) follows the new texture */
  SetTex(fileName: string, key: string): void {
    const old = this.pTexture;
    if (old) {
      if (old.pTexture) {
        this.ctx.devices.closeDevice(old.pTexture.deviceID);
        old.pTexture = null;
      }
      this.pTexture = null;
    }
    const data = this.setTexureData(fileName, key);
    if (this.pPoint) this.pPoint.pUITextureData = data;
    this.pTexture = data;
  }

  /**
   * `SetPoint_LUA()` (329262D0): the argument is the table on top of the Lua stack (`SetPointData_` reads it with a KLuaManager);
   * the picture's position and size follow from the corners.
   */
  SetPoint(): void {
    this.pPoint = this.setPointData();
    const p = this.pPoint;
    p.pUITextureData = this.pTexture;
    const t = p.pUITextureData;
    if (p.bUseTextureSize && t && t.pTexture) {
      // the quad is the texture rectangle times kResize, plus addSize (all single precision)
      const w = f(t.texSize.x * p.kResize.x), h = f(t.texSize.y * p.kResize.y);
      const x = p.leftTopPoint.x, y = p.leftTopPoint.y;
      p.rightTopPoint.y = y;
      p.leftBottomPoint.x = x;
      const right = f(f(w + x) + p.addSize.x), bottom = f(f(y + h) + p.addSize.y);
      p.rightTopPoint.x = right;
      p.leftBottomPoint.y = bottom;
      p.rightBottomPoint.x = right;
      p.rightBottomPoint.y = bottom;
    }
    this.pos.set(p.leftTopPoint.x, p.leftTopPoint.y);
    this.size.set(f(p.rightTopPoint.x - p.leftTopPoint.x), f(p.rightBottomPoint.y - p.leftTopPoint.y));
    this.originalPos.set(this.pos.x, this.pos.y);
    this.originalSize.set(this.size.x, this.size.y);
  }

  /** `CKTDGUIControl::SetPointData_()` (32926010) */
  private setPointData(): UIPointData {
    const m = new KLuaManager(this.ctx.world.rt, 1);
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
  readonly m_kMaximizeOffset = new Vec2();
  m_fAnimateTime = 0;
  readonly m_GoalPos = new Vec2();
  readonly m_GoalColor = new Color(1, 1, 1, 1);
  m_fChangeTime = 0;
  m_bAutoDelete = false;
  m_bCheckAutoDeleteEnd = false;
  m_fElapsedTime = 0;
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
  /** `m_wstrCustomButton...SndFileName` as copied by `CKTDGUIDialog::AddControl` */
  m_wstrCustomMouseOverSnd = "";
  m_wstrCustomMouseUpSnd = "";

  constructor(protected readonly ctx: UIContext) {}

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
}
