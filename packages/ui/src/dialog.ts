/**
 * `CKTDGUIDialog` (the Lua class `CKTDGUIDialog`): a window of controls that a `DLG_*.lua` script builds.
 *
 * `CKTDGUIDialog::CKTDGUIDialog(pStage, scriptFileName, fMoveTime, iLayer)` (32954EF0) sets the defaults below, and when the script file
 * name is not empty runs `OpenScriptFile` (3295A6B0): the global `g_pUIDialog` becomes this dialog (a new userdata of the class
 * `CKTDGUIDialog`), the script is loaded from the mass-file manager and executed in the one Lua state; an error in the script is an
 * error log (0x48 / 0x49) and `m_bSuccessInitOpenScript = false`.  The script then calls the registered methods:
 *   SetName_LUA 3295B7E0 (UTF-8 -> wide, `m_Name`), SetPos_LUA 328CDBD0 -> SetPos 3295B8D0, SetModal 328CD8F0, SetFront 3295B700,
 *   SetLayer 3295B790, CreatePicture 328C16C0, CreateStatic 328C19B0, AddControl 329559D0, ReNameControl 3295AF30.
 * `SetFront` / `SetLayer` hand over to the dialog manager when the dialog belongs to one; during construction `m_pkUIDialogManager`
 * is null, which is the only case ported so far.
 */
import { LuaError } from "@els/lua";
import { Color, Vec2 } from "@els/host";
import type { CKTDGUIDialog_Methods } from "@els/host";
import { CKTDGUIControl, CPictureData } from "./control.ts";
import { WStringMap } from "./stdmap.ts";
import type { UIContext } from "./control.ts";
import { CKTDGUIStatic } from "./static.ts";

/** `wchar_t buff[256]` of `StringCchPrintfW(buff, 0x100, L"%s%d", name, n)` and the copy in ReNameControl: at most 255 characters */
const clip255 = (s: string): string => (s.length > 255 ? s.slice(0, 255) : s);

export interface DialogOptions {
  /** `pStage` (the game state that owns the dialog; opaque here) */
  stage?: unknown;
  /** `wstrScriptFileName` (empty: no script) */
  scriptFileName?: string;
  /** `fMoveTime`: > 0 fades the dialog in over that time (not ported) */
  moveTime?: number;
  /** `iLayer` */
  layer?: number;
}

export class CKTDGUIDialog implements Partial<CKTDGUIDialog_Methods> {
  readonly ctx: UIContext;
  m_Name = "";
  m_pStage: unknown;
  m_iLayer: number;
  /** the owning CKTDGUIDialogManager (null while the dialog is being built) */
  m_pkUIDialogManager: unknown = null;
  readonly m_Pos = new Vec2();
  readonly m_Color = new Color(1, 1, 1, 1);
  m_bModal = true;
  m_bEnable = true;
  m_bShow = true;
  m_bMaximize = false;
  m_bFront = false;
  m_bCloseOnFocusOut = false;
  m_fAnimateTime = 0;
  readonly m_GoalPos = new Vec2();
  readonly m_GoalColor = new Color(1, 1, 1, 1);
  m_fChangeTime = 0;
  m_bAutoDelete = false;
  m_bCheckAutoDeleteEnd = false;
  m_bEnableMoveByDrag = false;
  m_bMouseDownForDrag = false;
  readonly m_vSize = new Vec2();
  m_bEnableDraggingRange = false;
  readonly m_vDraggingRangeCenter = new Vec2(512, 384);
  readonly m_vDraggingRange = new Vec2(1024, 768);
  m_CloseCustomUIEventID = -1;
  m_CustomMsgMouseOut = -1;
  m_CustomMsgMouseOver = -1;
  m_CustomMsgStopDragging = -1;
  m_CustomMsgStartDragging = -1;
  m_CustomMsgFocusOutEventID = -1;
  m_CustomMsgRMouseUp = -1;
  m_bFadeInOut = true;
  m_wstrCustomButtonMouseOverSndFileName = "";
  m_wstrCustomButtonMouseUpSndFileName = "";
  m_bSuccessInitOpenScript = false;
  /** `std::map<std::wstring, CKTDGUIControl*>`: the controls by name (in name order) */
  readonly m_ControlsMap = new WStringMap<CKTDGUIControl>();
  /** `std::vector<CKTDGUIControl*>`: the controls in the order they were added (the order they are drawn in) */
  readonly m_ControlsList: CKTDGUIControl[] = [];

  constructor(ctx: UIContext, opts: DialogOptions = {}) {
    this.ctx = ctx;
    this.m_pStage = opts.stage;
    this.m_iLayer = opts.layer ?? 0;
    const script = opts.scriptFileName ?? "";
    if (script.length !== 0) this.m_bSuccessInitOpenScript = this.openScriptFile(script);
    if ((opts.moveTime ?? 0) > 0) throw new Error("CKTDGUIDialog: the fade-in of fMoveTime > 0 is not ported");
  }

  /** `OpenScriptFile` (3295A6B0) */
  openScriptFile(fileName: string): boolean {
    if (fileName.length === 0) return false;
    const world = this.ctx.world;
    world.rt.setObject("g_pUIDialog", this, "CKTDGUIDialog");
    try {
      if (world.execScript(fileName)) return true;
      this.ctx.devices.massFiles.log.push(0x48, fileName); // the script could not be opened (LoadDataFile logged 0x87 for a missing file)
      return false;
    } catch (e) {
      if (!(e instanceof LuaError)) throw e;
      this.ctx.devices.massFiles.log.push(0x49, `${fileName}: ${String(e.message)}`); // the script failed
      return false;
    }
  }

  /** `SetName_LUA(const char*)` (3295B7E0) */
  SetName(name: string): void {
    this.m_Name = name;
  }

  /** `SetPos(const D3DXVECTOR2*)` (3295B8D0): a dialog that is still moving to a goal moves the goal as well */
  setPos(pos: Vec2): void {
    const settled = this.m_fChangeTime <= this.m_fAnimateTime;
    this.m_Pos.set(pos.x, pos.y);
    if (!settled) this.m_GoalPos.set(pos.x, pos.y);
  }

  /** `SetPos_LUA(float, float)` (328CDBD0) */
  SetPos(x: number, y: number): void {
    this.setPos(new Vec2(x, y));
  }

  /** `SetModal(bool)` (328CD8F0) */
  SetModal(modal: boolean): void {
    this.m_bModal = modal;
  }

  /** `SetFront(BOOL)` (3295B700): a dialog of a manager asks the manager (`ChangeFront`) */
  SetFront(front: boolean): void {
    if (this.m_bFront === front) return;
    if (this.m_pkUIDialogManager !== null) throw new Error("CKTDGUIDialogManager::ChangeFront is not ported");
    this.m_bFront = front;
  }

  /** `SetLayer(int)` (3295B790): a dialog of a manager asks the manager (`ChangeLayer`) */
  SetLayer(layer: number): void {
    if (layer === this.m_iLayer) return;
    if (this.m_pkUIDialogManager !== null) throw new Error("CKTDGUIDialogManager::ChangeLayer is not ported");
    this.m_iLayer = layer;
  }

  /** `CreatePicture()` (328C16C0): a new CPictureData (the script owns it until `AddPicture`) */
  CreatePicture(): CPictureData {
    return new CPictureData(this.ctx);
  }

  /** `CreateStatic()` (328C19B0) */
  CreateStatic(): CKTDGUIStatic {
    return new CKTDGUIStatic(this.ctx);
  }

  /**
   * `AddControl(CKTDGUIControl*)` (329559D0): the control learns its dialog; a name that is taken becomes `name100`, `name101`, ...
   * (the first free one; `StringCchPrintfW(buff, 256, L"%s%d", name, n)`); the dialog's custom button sounds are handed on; the control
   * is entered in `m_ControlsMap` under its name and appended to `m_ControlsList`.  (The exe's default name `unnamed_control_` for a
   * control with a NULL name cannot happen: an unnamed control has the empty name, which is a name like any other.)
   */
  AddControl(control: CKTDGUIControl | undefined): void {
    if (!control) return;
    control.setDialog(this);
    if (this.m_ControlsMap.has(control.m_Name)) {
      for (let n = 100; ; n++) {
        const candidate = clip255(`${control.m_Name}${n}`);
        if (!this.m_ControlsMap.has(candidate)) {
          control.setNameByForce(candidate);
          break;
        }
      }
    }
    if (this.m_wstrCustomButtonMouseOverSndFileName !== "") control.setCustomMouseOverSound(this.m_wstrCustomButtonMouseOverSndFileName);
    if (this.m_wstrCustomButtonMouseUpSndFileName !== "") control.setCustomMouseUpSound(this.m_wstrCustomButtonMouseUpSndFileName);
    this.m_ControlsMap.emplace(control.m_Name, control);
    this.m_ControlsList.push(control);
  }

  /**
   * `ReNameControl(CKTDGUIControl*)` (3295AF30): called by `CKTDGUIControl::SetName` for a control that is in the dialog, after the
   * control took its new name.  A name that is already in the map (also the control's own, so renaming a control to the name it has
   * gives `name100`) is made unique and set again (returns false); otherwise the control's old entry is replaced by the new one.
   */
  reNameControl(control: CKTDGUIControl | undefined): boolean {
    if (!control) return false;
    let buff = clip255(control.m_Name);
    if (this.m_ControlsMap.has(control.m_Name)) {
      for (let n = 100; ; n++) {
        buff = clip255(`${control.m_Name}${n}`);
        if (!this.m_ControlsMap.has(buff)) break;
      }
      control.setName(buff);
      return false;
    }
    for (const [key, value] of this.m_ControlsMap) {
      if (value === control) {
        this.m_ControlsMap.erase(key);
        break;
      }
    }
    control.setNameByForce(buff);
    this.m_ControlsMap.emplace(control.m_Name, control);
    return true;
  }
}

