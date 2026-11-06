/**
 * `CKTDGUIDialog` (the Lua class `CKTDGUIDialog`): a window of controls that a `DLG_*.lua` script builds.
 *
 * `CKTDGUIDialog::CKTDGUIDialog(pStage, scriptFileName, fMoveTime, iLayer)` (32954EF0) sets the defaults below, and when the script file
 * name is not empty runs `OpenScriptFile` (3295A6B0): the global `g_pUIDialog` becomes this dialog (a new userdata of the class
 * `CKTDGUIDialog`), the script is loaded from the mass-file manager and executed in the one Lua state; an error in the script is an
 * error log (0x48 / 0x49) and `m_bSuccessInitOpenScript = false`.  The script then calls the registered methods:
 *   SetName_LUA 3295B7E0 (UTF-8 -> wide, `m_Name`), SetPos_LUA 328CDBD0 -> SetPos 3295B8D0, SetModal 328CD8F0, SetFront 3295B700,
 *   SetLayer 3295B790, CreatePicture 328C16C0, CreateStatic 328C19B0, CreateButton 328C1120, AddControl 329559D0, ReNameControl 3295AF30,
 *   Move_LUA 32958070, Get*_LUA 32957000.. (`_GetControl` 3295C090), RequestFocus 3295B490, ClearFocus 32956B90, and the plain setters
 *   (SetCloseCustomUIEventID 328CD040, SetColor 328CD070, SetSize 328CDFF0, the dragging range ...).
 * `SetFront` / `SetLayer` hand over to the dialog manager when the dialog belongs to one; during construction `m_pkUIDialogManager`
 * is null, which is the only case ported so far.
 */
import { LuaError } from "@els/lua";
import { Color, KLuaManager, Vec2, Vec3 } from "@els/host";
import type { CKTDGUIDialog_Methods } from "@els/host";
import { CKTDGUIControl, CPictureData } from "./control.ts";
import { CKTDGUIButton } from "./button.ts";
import { CKTDGUICheckBox } from "./checkbox.ts";
import { CKTDGUIRadioButton } from "./radiobutton.ts";
import { CKTDGUISlot } from "./slot.ts";
import { CKTDGUIIMEEditBox } from "./imeeditbox.ts";
import { CKTDGUIComboBox } from "./combobox.ts";
import { CKTDGUIListBox } from "./listbox.ts";
import type { RadioButtonGroupInfo } from "./radiobutton.ts";
import { WStringMap } from "./stdmap.ts";
import type { UIContext } from "./control.ts";
import { CKTDGUIItem, CKTDGUIStatic } from "./static.ts";

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

/** `CKTDGUIDialog::DialogMoveItem`: a step of the dialog's move queue */
export interface DialogMoveItem {
  pos: Vec2;
  color: Color;
  fChangeTime: number;
  bIsAutoDelete: boolean;
}

/**
 * The text of error log 0x24 (`_GetControl` of a name the dialog does not have): the control's name, then the two Korean fragments the
 * exe appends ("<- 이 컨트롤 찾기 실패! " = "<- failed to find this control! ", "-부모 다이얼로그 이름 : " = "-parent dialog name : "), then the dialog's name.
 */
const CONTROL_NOT_FOUND = " <- 이 컨트롤 찾기 실패! ";
const PARENT_DIALOG_NAME = "-부모 다이얼로그 이름 : ";

export class CKTDGUIDialog implements Partial<CKTDGUIDialog_Methods> {
  readonly ctx: UIContext;
  m_Name = "";
  m_pStage: unknown;
  m_iLayer: number;
  /** the owning CKTDGUIDialogManager (null while the dialog is being built) */
  m_pkUIDialogManager: unknown = null;
  m_ID = 0;
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
  m_fTimeForSelfDelete = 0;
  m_wstrCustomButtonMouseOverSndFileName = "";
  m_wstrCustomButtonMouseUpSndFileName = "";
  m_bSuccessInitOpenScript = false;
  /** `std::map<std::wstring, CKTDGUIControl*>`: the controls by name (in name order) */
  readonly m_ControlsMap = new WStringMap<CKTDGUIControl>();
  /** `std::vector<CKTDGUIControl*>`: the controls in the order they were added (the order they are drawn in) */
  readonly m_ControlsList: CKTDGUIControl[] = [];
  /** `m_mapRadioButtonGroupInfo` (`std::map<int, RadioButtonGroupInfo*>`): the radio button groups by group id */
  readonly m_mapRadioButtonGroupInfo = new Map<number, RadioButtonGroupInfo>();
  /** `std::queue<DialogMoveItem>` */
  readonly m_queMoveItems: DialogMoveItem[] = [];
  readonly m_DummyPosList: Vec3[] = [];
  readonly m_DummyStringList: string[] = [];
  readonly m_DummyIntList: number[] = [];

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

  // ---- the controls a script creates -----------------------------------------------------------------------------------------

  /** `CreatePicture()` (328C16C0): a new CPictureData (the script owns it until `AddPicture`) */
  CreatePicture(): CPictureData {
    return new CPictureData(this.ctx);
  }

  /** `CreateStatic()` (328C19B0) */
  CreateStatic(): CKTDGUIStatic {
    return new CKTDGUIStatic(this.ctx);
  }

  /** `CreateButton()` (328C1120) */
  CreateButton(): CKTDGUIButton {
    return new CKTDGUIButton(this.ctx);
  }

  /** `CreateRadioButton()` (328C1730) */
  CreateRadioButton(): CKTDGUIRadioButton {
    return new CKTDGUIRadioButton(this.ctx);
  }

  /** `CreateCheckBox()` (328C1190) */
  CreateCheckBox(): CKTDGUICheckBox {
    return new CKTDGUICheckBox(this.ctx);
  }

  /** `CreateSlot()` (328C1940) */
  CreateSlot(): CKTDGUISlot {
    return new CKTDGUISlot(this.ctx);
  }

  /** `CreateListBox()` (328C1570) */
  CreateListBox(): CKTDGUIListBox {
    return new CKTDGUIListBox(this.ctx);
  }

  /** `CreateItem()` (328C1500) */
  CreateItem(): CKTDGUIItem {
    return new CKTDGUIItem(this.ctx);
  }

  /** `CreateComboBox()` (328C1200) */
  CreateComboBox(): CKTDGUIComboBox {
    return new CKTDGUIComboBox(this.ctx);
  }

  /** `CreateIMEEditBox()` (328C1350) */
  CreateIMEEditBox(): CKTDGUIIMEEditBox {
    return new CKTDGUIIMEEditBox(this.ctx);
  }

  /**
   * `AddControl(CKTDGUIControl*)` (329559D0): the control learns its dialog; a name that is taken becomes `name100`, `name101`, ...
   * (the first free one; `StringCchPrintfW(buff, 256, L"%s%d", name, n)`); the dialog's custom button sounds are handed on; the control
   * is entered in `m_ControlsMap` under its name and appended to `m_ControlsList`.  (The exe's default name `unnamed_control_` for a
   * control with a NULL name cannot happen: an unnamed control has the empty name, which is a name like any other.)  Anything that is not
   * a control (the typed stub a census run hands over for a control class nobody ported) is ignored.
   */
  AddControl(control: CKTDGUIControl | undefined): void {
    if (!(control instanceof CKTDGUIControl)) return;
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

  // ---- finding controls ------------------------------------------------------------------------------------------------------

  /**
   * `_GetControl(const wchar_t*)` (3295C090): the control of that name; in a dialog that has controls a name that is not there is
   * error log 0x24 (an empty dialog answers null silently).
   */
  getControl(name: string): CKTDGUIControl | undefined {
    if (this.m_ControlsMap.size === 0) return undefined;
    const found = this.m_ControlsMap.get(name);
    if (found) return found;
    this.ctx.devices.massFiles.log.push(0x24, `${name}${CONTROL_NOT_FOUND}${PARENT_DIALOG_NAME}${this.m_Name}`);
    return undefined;
  }

  /** the `Get*_LUA` family: `_GetControl`, and a message box titled with the function's name when there is no such control */
  private getLua(name: string, title: string): CKTDGUIControl | undefined {
    const control = this.getControl(name);
    if (!control) this.ctx.messageBox(name, title);
    return control;
  }

  /** `GetButton_LUA(const char*)` (32957000): the control, whatever its type (the exe casts the pointer) */
  GetButton(name: string): CKTDGUIControl | undefined {
    return this.getLua(name, "GetButton_LUA ");
  }

  /** `GetCheckBox_LUA` (329570F0) */
  GetCheckBox(name: string): CKTDGUIControl | undefined {
    return this.getLua(name, "GetCheckBox_LUA ");
  }

  /** `GetComboBox_LUA` (329571E0) */
  GetComboBox(name: string): CKTDGUIControl | undefined {
    return this.getLua(name, "GetComboBox_LUA ");
  }

  /** `GetEditBox_LUA` (32957580) */
  GetEditBox(name: string): CKTDGUIControl | undefined {
    return this.getLua(name, "GetEditBox_LUA ");
  }

  /** `GetIMEEdieBox_LUA` (32957670; the typo is the exe's) */
  GetIMEEdieBox(name: string): CKTDGUIControl | undefined {
    return this.getLua(name, "GetIMEEdieBox_LUA ");
  }

  /** `GetListBox_LUA` (329577B0) */
  GetListBox(name: string): CKTDGUIControl | undefined {
    return this.getLua(name, "GetListBox_LUA ");
  }

  /** `GetRadioButton_LUA` (329578A0) */
  GetRadioButton(name: string): CKTDGUIControl | undefined {
    return this.getLua(name, "GetRadioButton_LUA ");
  }

  /** `GetStatic_LUA` (329579B0) */
  GetStatic(name: string): CKTDGUIControl | undefined {
    return this.getLua(name, "GetStatic_LUA ");
  }

  // ---- focus -----------------------------------------------------------------------------------------------------------------

  /** `RequestFocus(CKTDGUIControl*)` (3295B490): the control takes the focus from the one that has it, if it can have it */
  requestFocus(control: CKTDGUIControl): void {
    const ctx = this.ctx;
    if (ctx.controlFocus !== control && control.canHaveFocus()) {
      ctx.controlFocus?.onFocusOut();
      control.onFocusIn();
      ctx.controlFocus = control;
    }
  }

  /** `CKTDGUIDialog::ClearFocus()` (32956B90), a static function: the control that has the focus loses it */
  clearFocus(): void {
    const ctx = this.ctx;
    if (ctx.controlFocus) {
      ctx.controlFocus.onFocusOut();
      ctx.controlFocus = null;
    }
  }

  // ---- moving ----------------------------------------------------------------------------------------------------------------

  /**
   * `Move_LUA()` (32958070): the table on top of the stack: `IS_DIRECT`, `CHANGE_TIME`, `AUTO_DELETE`, `POS` (default 0, 0), `COLOR`
   * (default white).  Direct: the queue is cleared and the dialog moves to the goal; otherwise the step is queued.
   */
  Move(): void {
    const m = new KLuaManager(this.ctx.world.rt, 1);
    const bDirect = m.getBool("IS_DIRECT") ?? false;
    const fChangeTime = m.getFloat("CHANGE_TIME") ?? 0;
    const bAutoDelete = m.getBool("AUTO_DELETE") ?? false;
    const pos = m.getVec2("POS") ?? new Vec2();
    const color = m.getColor("COLOR") ?? new Color(1, 1, 1, 1);
    if (bDirect) {
      this.m_queMoveItems.length = 0;
      this.m_GoalPos.set(pos.x, pos.y);
      this.m_fAnimateTime = 0;
      this.m_GoalColor.set(color.r, color.g, color.b, color.a);
      this.m_fChangeTime = fChangeTime;
      this.m_bAutoDelete = bAutoDelete;
    } else {
      this.m_queMoveItems.push({ pos: pos.clone(), color: color.clone(), fChangeTime, bIsAutoDelete: bAutoDelete });
    }
  }

  // ---- dummies ---------------------------------------------------------------------------------------------------------------

  /** `AddDummyPos(D3DXVECTOR3)` (328C0D40) */
  AddDummyPos(pos: Vec3): void {
    this.m_DummyPosList.push(new Vec3(pos.x, pos.y, pos.z));
  }

  /** `GetDummyPos(int)` (328C2170): (0, 0, 0) for an index out of range */
  GetDummyPos(index: number): Vec3 {
    const p = index < 0 ? undefined : this.m_DummyPosList[index];
    return p ? new Vec3(p.x, p.y, p.z) : new Vec3();
  }

  /** `AddDummyString_LUA(int)` (32955E50): the text of that string table entry (the debug-info variant is not ported) */
  AddDummyString(stringIndex: number): void {
    this.m_DummyStringList.push(this.ctx.strings.get(stringIndex));
  }

  /** `GetDummyString(int)` (328C21E0): no range check in the exe (an index out of range reads garbage); "" here */
  GetDummyString(index: number): string {
    return (index < 0 ? undefined : this.m_DummyStringList[index]) ?? "";
  }

  /** `AddDummyInt(int)` (328C0CD0) */
  AddDummyInt(value: number): void {
    this.m_DummyIntList.push(value | 0);
  }

  /** `GetDummyInt(int)` (328C2140): 0 for an index out of range (a control answers -1) */
  GetDummyInt(index: number): number {
    return (index < 0 ? undefined : this.m_DummyIntList[index]) ?? 0;
  }

  // ---- plain setters ---------------------------------------------------------------------------------------------------------

  /** `SetEnableMoveByDrag_LUA(bool)` (328CD470) */
  SetEnableMoveByDrag(enable: boolean): void {
    this.m_bEnableMoveByDrag = enable;
  }

  /** `SetColor(D3DXCOLOR)` (328CD070) */
  SetColor(color: Color): void {
    this.m_Color.set(color.r, color.g, color.b, color.a);
  }

  /** `SetCloseOnFocusOut(bool)` (328CD050) */
  SetCloseOnFocusOut(close: boolean): void {
    this.m_bCloseOnFocusOut = close;
  }

  /** `SetCloseOnFocusOutEvent(int)` (328CD060) */
  SetCloseOnFocusOutEvent(eventID: number): void {
    this.m_CustomMsgFocusOutEventID = eventID | 0;
  }

  /** `SetSize(float, float)` (328CDFF0) */
  SetSize(width: number, height: number): void {
    this.m_vSize.set(width, height);
  }

  /** `SetEnableDraggingRange(bool)` (328CD440) */
  SetEnableDraggingRange(enable: boolean): void {
    this.m_bEnableDraggingRange = enable;
  }

  /** `SetDraggingRangeCenter(float, float)` (328CD360) */
  SetDraggingRangeCenter(x: number, y: number): void {
    this.m_vDraggingRangeCenter.set(x, y);
  }

  /** `SetDraggingRange(float, float)` (328CD330) */
  SetDraggingRange(width: number, height: number): void {
    this.m_vDraggingRange.set(width, height);
  }

  /** `SetCloseCustomUIEventID(int)` (328CD040) */
  SetCloseCustomUIEventID(eventID: number): void {
    this.m_CloseCustomUIEventID = eventID | 0;
  }

  /** `SetCustomMsgStopDragging(int)` (328CD2C0) */
  SetCustomMsgStopDragging(msg: number): void {
    this.m_CustomMsgStopDragging = msg | 0;
  }

  /** `SetCustomMsgStartDragging(int)` (328CD2B0) */
  SetCustomMsgStartDragging(msg: number): void {
    this.m_CustomMsgStartDragging = msg | 0;
  }

  /** `SetCustomMsgRMouseUp(int)` (328CD270) */
  SetCustomMsgRMouseUp(msg: number): void {
    this.m_CustomMsgRMouseUp = msg | 0;
  }

  /** `SetTimeForSelfDelete(float)` (328CE340) */
  SetTimeForSelfDelete(seconds: number): void {
    this.m_fTimeForSelfDelete = Math.fround(seconds);
  }

  /** `SetCustomButtonMouseOverSndFile_LUA(const char*)` (3295B650): handed to every button added afterwards */
  SetCustomButtonMouseOverSndFile(fileName: string | undefined): void {
    if (fileName !== undefined) this.m_wstrCustomButtonMouseOverSndFileName = fileName;
  }

  /** `SetCustomButtonMouseUpSndFile_LUA(const char*)` (3295B670) */
  SetCustomButtonMouseUpSndFile(fileName: string | undefined): void {
    if (fileName !== undefined) this.m_wstrCustomButtonMouseUpSndFileName = fileName;
  }
}
