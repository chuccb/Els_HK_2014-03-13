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
import { CKTDGUIControl, CPictureData, UCT, UIM, UIStringData, approach, clearFocus, requestFocus } from "./control.ts";
import type { UIStage } from "./control.ts";
import { CKTDGUIButton } from "./button.ts";
import { CKTDGUICheckBox } from "./checkbox.ts";
import { CKTDGUIRadioButton } from "./radiobutton.ts";
import { CKTDGUISlot } from "./slot.ts";
import { CKTDGUIIMEEditBox } from "./imeeditbox.ts";
import { CKTDGUIComboBox } from "./combobox.ts";
import { CKTDGUIListBox } from "./listbox.ts";
import { CMovieData } from "./movie.ts";
import { CKTDGUIContolList } from "./controllist.ts";
import { CKTDGUISlider } from "./slider.ts";
import { CKTDGUIEditBox } from "./editbox.ts";
import { CKTDGUINavigation } from "./navigation.ts";
import type { RadioButtonGroupInfo } from "./radiobutton.ts";
import { backBufferWidth, localAxis, localPoint, resolutionScale } from "./pick.ts";
import { ftoi } from "./rect.ts";
import { DIALOG_SAMPLER_STATES, RSI_UI_DIALOG } from "./render.ts";
import type { CKTDGUIDialogManager } from "./dialogmanager.ts";
import { WStringMap } from "./stdmap.ts";
import { untilNul } from "./unibuffer.ts";
import type { UIContext } from "./control.ts";
import { CKTDGUIItem, CKTDGUIStatic } from "./static.ts";

const f = Math.fround;

/** `wchar_t buff[256]` of `StringCchPrintfW(buff, 0x100, L"%s%d", name, n)` and the copy in ReNameControl: at most 255 characters */
const clip255 = (s: string): string => (s.length > 255 ? s.slice(0, 255) : s);

export interface DialogOptions {
  /** `pStage` (the game state that owns the dialog; opaque here) */
  stage?: unknown;
  /** `wstrScriptFileName` (empty: no script) */
  scriptFileName?: string;
  /** `fMoveTime`: > 0 fades the dialog in over that time (its colour from alpha 0 to 1, where it is) */
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
  m_pkUIDialogManager: CKTDGUIDialogManager | null = null;
  /** `m_bHasSlot`: set by the game's code for a dialog of slots (the constructor makes it false); `CountModalDialog` leaves such a dialog out */
  m_bHasSlot = false;
  /**
   * `m_iDialogListChangeCount`: the manager's count of changes of its list at the last change that moved this dialog (negative: it was put at the
   * bottom of its layer; 0: it is not in the list)
   */
  m_iDialogListChangeCount = 0;
  /** `m_bOKAndCancelMsgBox`: the dialog is an OK / Cancel message box (the game's code says so; the constructor makes it false) */
  m_bOKAndCancelMsgBox = false;
  /** not in the exe: the dialog's slot of the `KJohnObjMan` table was freed (`Destroy`), so every handle to it resolves to nothing */
  destroyed = false;
  /** the guide text's static and dialog (made by `CreateGuideDesc` when a control shows its guide text; the guide text is not ported, so null) */
  m_pStaticGuideDesc: CKTDGUIStatic | null = null;
  m_pDialogGuideDesc: CKTDGUIDialog | null = null;
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
  /** `m_bIsOverControl` (0x151): the mouse is over a shown control of this dialog (`MsgProc` and `HandleMouse` set it) */
  m_bIsOverControl = false;
  /** `m_bIsMouseOver` (0x10D): the mouse is over some control (shown or not): the change sends `m_CustomMsgMouseOver` / `m_CustomMsgMouseOut` */
  m_bIsMouseOver = false;
  /** `m_PrevMousePointX` / `m_PrevMousePointY` (0xE0, 0xE4): the local point of the last mouse move that was no drag */
  m_PrevMousePointX = 0;
  m_PrevMousePointY = 0;
  /** `m_bDisableUnderWindow` (0x150): the dialog takes the mouse messages that fall on its controls (the game's code sets it, never a script) */
  m_bDisableUnderWindow = false;
  /** `m_bEnableShortCutEnter`: a button reads it for the Enter key (the game's code sets it) */
  m_bEnableShortCutEnter = false;
  /**
   * `m_pControlMouseOver`: the control the mouse is over, the last of the list that is not a static, holds the point and is shown (`OnMouseMove`);
   * `m_pControlMouseOverStatic`: the last control of any kind that holds the point and is shown; `m_pControlMouseOverShowDlg`: the last control
   * that holds the point, shown or not, for a dialog with `m_bMouseOverShowDlg` (only the chat window's: the game's code sets it).  The exe never
   * clears them when a control is destroyed.
   */
  m_pControlMouseOver: CKTDGUIControl | null = null;
  m_pControlMouseOverShowDlg: CKTDGUIControl | null = null;
  m_pControlMouseOverStatic: CKTDGUIControl | null = null;
  m_bMouseOverShowDlg = false;
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
  /** `m_TimerToSelfDelete` (a `boost::timer`): `_clock()` when the dialog was made */
  readonly m_TimerToSelfDelete = { _start_time: 0 };
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
    this.m_TimerToSelfDelete._start_time = ctx.clock();
    this.m_pStage = opts.stage;
    this.m_iLayer = opts.layer ?? 0;
    const script = opts.scriptFileName ?? "";
    if (script.length !== 0) this.m_bSuccessInitOpenScript = this.openScriptFile(script);
    const fMoveTime = f(opts.moveTime ?? 0);
    if (fMoveTime > 0) {
      // the fade-in: the colour the script left is the colour to fade to, from alpha 0 to 1, in place; nothing the script queued is left to do and a
      // finished move does not delete the dialog.  (The exe stores `m_bFadeInOut = true` again behind this: it is the constructor's default.)
      const { r, g, b } = this.m_Color;
      const x = this.m_Pos.x, y = this.m_Pos.y;
      this.m_Color.set(r, g, b, 0);
      this.m_queMoveItems.length = 0;
      this.m_fAnimateTime = 0;
      this.m_GoalPos.set(x, y);
      this.m_GoalColor.set(r, g, b, 1);
      this.m_bAutoDelete = false;
      this.m_fChangeTime = fMoveTime;
    }
  }

  /**
   * `OnFrameMove(fTime, fElapsedTime)` (32958A00).  The guide text's static is hidden and its dialog (when there is one, shown) too, with the
   * count of the modal dialogs made again; a dragged slot of that dialog is returned.  A dialog that is enabled and shown then
   * - moves towards its goal position (`m_Pos`, by `(goal - pos) / (changeTime - animateTime) * elapsed`) and, when `m_bFadeInOut`, its colour (without it the
   *   colour is the goal at once); a move that is over puts it on the goal (an auto-delete dialog is marked);
   * - is marked for deletion when its self-delete time (`SetTimeForSelfDelete`, counted from its making) is up;
   * - takes the next item of its move queue when it is not moving;
   * - moves its controls, **from the last to the first**: a control that is marked for deletion (`m_bCheckAutoDeleteEnd`) and found in the name map has
   *   its entry taken out of the map; the control the map held (not necessarily the marked one: two controls can share a name) then, if it is in the
   *   list, loses the focus if it has it, is destroyed (`Destroy`) and is taken out of the list, and nobody is moved for that index; the others
   *   (also a marked control whose name the map does not know, or whose map entry is not in the list) that are not out of the list are moved
   *   (`OnFrameMove`);
   * - when it can be moved by dragging inside a range, has its position held inside the range (the range's rectangle shrunk by half the dialog's size; the
   *   goal too while it is moving).
   * Returns 0.
   */
  onFrameMove(fTime: number, fElapsedTime: number): number {
    const dt = f(fElapsedTime);
    this.m_pStaticGuideDesc?.SetShow(false);
    const guide = this.m_pDialogGuideDesc;
    if (guide !== null) {
      if (guide.m_bShow) {
        const inner = guide.m_pDialogGuideDesc;
        guide.m_bShow = false;
        if (inner !== null) inner.setShow(false);
        if (!guide.m_bModal && guide.m_pkUIDialogManager !== null) guide.m_pkUIDialogManager.countModalDialog(null);
      }
      if (CKTDGUISlot.s_pDragSlot !== null && CKTDGUISlot.s_pDragSlot.m_pDialog === guide) CKTDGUISlot.returnDraggingItem();
    }
    if (!(this.m_bEnable && this.m_bShow)) return 0;
    if (this.m_fChangeTime > 0) {
      const at = this.m_fAnimateTime;
      if (at < this.m_fChangeTime) {
        const k = f(1 / f(this.m_fChangeTime - at));
        const p = this.m_Pos, g = this.m_GoalPos;
        p.x = approach(p.x, g.x, k, dt);
        p.y = approach(p.y, g.y, k, dt);
        const c = this.m_Color, gc = this.m_GoalColor;
        if (!this.m_bFadeInOut) {
          c.set(gc.r, gc.g, gc.b, gc.a);
        } else {
          c.r = approach(c.r, gc.r, k, dt);
          c.g = approach(c.g, gc.g, k, dt);
          c.b = approach(c.b, gc.b, k, dt);
          c.a = approach(c.a, gc.a, k, dt);
        }
        this.m_fAnimateTime = f(dt + at);
      } else {
        this.m_fAnimateTime = 0;
        this.m_fChangeTime = 0;
        this.m_Pos.set(this.m_GoalPos.x, this.m_GoalPos.y);
        if (this.m_bAutoDelete) this.m_bCheckAutoDeleteEnd = true;
      }
    }
    if (this.m_fTimeForSelfDelete > 0) {
      if (((this.ctx.clock() - this.m_TimerToSelfDelete._start_time) | 0) / 1000 > this.m_fTimeForSelfDelete) this.m_bCheckAutoDeleteEnd = true;
    }
    if (this.m_fChangeTime === 0 && this.m_queMoveItems.length !== 0) {
      const item = this.m_queMoveItems.shift()!;
      this.m_GoalPos.set(item.pos.x, item.pos.y);
      this.m_GoalColor.set(item.color.r, item.color.g, item.color.b, item.color.a);
      this.m_bAutoDelete = item.bIsAutoDelete;
      this.m_fChangeTime = item.fChangeTime;
    }
    for (let i = this.m_ControlsList.length - 1; i >= 0; i--) {
      const control = this.m_ControlsList[i]!;
      if (control.m_bCheckAutoDeleteEnd) {
        const named = this.m_ControlsMap.get(control.m_Name);
        if (named !== undefined) {
          this.m_ControlsMap.erase(control.m_Name); // the entry goes whether or not the control is in the list
          const at = this.m_ControlsList.indexOf(named);
          if (at >= 0) {
            const focus = this.ctx.controlFocus;
            if (focus === named) {
              focus.onFocusOut();
              this.ctx.controlFocus = null;
            }
            named.Destroy();
            this.m_ControlsList.splice(at, 1);
            continue; // a control that was deleted is not moved
          }
        }
      }
      if (!control.m_bOutofList) control.onFrameMove(fTime, fElapsedTime);
    }
    if (this.m_bEnableMoveByDrag && this.m_bEnableDraggingRange) {
      const halfRangeX = f(this.m_vDraggingRange.x * 0.5), halfRangeY = f(this.m_vDraggingRange.y * 0.5);
      const halfSizeX = f(this.m_vSize.x * 0.5), halfSizeY = f(this.m_vSize.y * 0.5);
      const cx = this.m_vDraggingRangeCenter.x, cy = this.m_vDraggingRangeCenter.y;
      const minX = f(f(cx - halfRangeX) - halfSizeX), maxX = f(f(cx + halfRangeX) - halfSizeX);
      const minY = f(f(cy - halfRangeY) - halfSizeY), maxY = f(f(cy + halfRangeY) - halfSizeY);
      const p = this.m_Pos;
      if (minX > p.x) p.x = minX;
      if (p.x > maxX) p.x = maxX;
      if (minY > p.y) p.y = minY;
      if (p.y > maxY) p.y = maxY;
      if (!(this.m_fChangeTime <= this.m_fAnimateTime)) this.m_GoalPos.set(p.x, p.y);
    }
    return 0;
  }

  /**
   * `SetShow(bShow)` (3295B900), the dialog's own: a change of the flag; hiding also hides the guide dialog, and shows/hides count the modal dialogs of the
   * manager again (a dialog that is not modal); a hidden dialog's dragged slot is returned.  Showing makes the dialog take the mouse position
   * (`OnMouseMove` with the mouse, in pixels of the back buffer, less the dialog's position scaled: `x - (int)(float)(m_Pos.x * scale.x)`).
   */
  setShow(show: boolean): void {
    if (show !== this.m_bShow) {
      this.m_bShow = show;
      if (show) {
        const scale = resolutionScale(this.ctx);
        const mouse = this.ctx.mouse;
        const x = mouse.GetXPos();
        const y = mouse.GetYPos();
        this.onMouseMove((x - ftoi(f(this.m_Pos.x * scale.x))) | 0, (y - ftoi(f(this.m_Pos.y * scale.y))) | 0);
      } else {
        this.m_pDialogGuideDesc?.setShow(false);
      }
      if (!this.m_bModal && this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.countModalDialog(null);
    }
    if (CKTDGUISlot.s_pDragSlot !== null && CKTDGUISlot.s_pDragSlot.m_pDialog === this && !show) CKTDGUISlot.returnDraggingItem();
  }

  /**
   * `GetControlAtPointAbsolute(pt)` (32957310): the last control of the list (the one drawn on top) that holds the point, whatever its type
   * or whether it is shown; `(x, y)` is the point in the dialog's pixels (the mouse less the dialog's position), and each control is asked
   * for it in its own layout pixels (`localPoint`).
   */
  getControlAtPointAbsolute(x: number, y: number): CKTDGUIControl | null {
    const list = this.m_ControlsList;
    for (let i = list.length - 1; i >= 0; i--) {
      const control = list[i];
      if (!control) continue;
      const p = localPoint(this.ctx, control, x, y);
      if (control.containsPoint(p.x, p.y)) return control;
    }
    return null;
  }

  /** `GetControlAtPointForStatic(pt)` (329573C0): the last control of the list that holds the point, is shown and is not out of the list (a static too) */
  getControlAtPointForStatic(x: number, y: number): CKTDGUIControl | null {
    const list = this.m_ControlsList;
    for (let i = list.length - 1; i >= 0; i--) {
      const control = list[i];
      if (!control) continue;
      const p = localPoint(this.ctx, control, x, y);
      if (control.containsPoint(p.x, p.y) && control.m_bShow && !control.m_bOutofList) return control;
    }
    return null;
  }

  /**
   * `GetControlMouseOver()` (329574A0): the control under the mouse as far as the outside world is concerned: none for a dialog that is
   * disabled or hidden or almost transparent (`m_Color.a < 0.01`), or when the mouse is over nothing, or over a control named `INVISIBLE`;
   * otherwise `m_pControlMouseOverStatic`.
   */
  getControlMouseOver(): CKTDGUIControl | null {
    const over = this.m_pControlMouseOverStatic;
    if (!this.m_bEnable || !this.m_bShow || this.m_Color.a < f(0.01) || over === null) return null;
    return over.m_Name === "INVISIBLE" ? null : over;
  }

  /**
   * `OnMouseMove(pt)` (3295A4D0): the mouse is at `(x, y)` in the dialog's pixels.  `m_pControlMouseOverStatic` becomes the control
   * `GetControlAtPointForStatic` finds.  The control the mouse is over (`m_pControlMouseOver`) becomes the last of the list that is not a
   * static, holds the point, is shown and is not out of the list; the control it was loses `m_bMouseOver` and the new one gets it (when they are
   * not the same).  A dialog with `m_bMouseOverShowDlg` does the same for `m_pControlMouseOverShowDlg` with the control `GetControlAtPointAbsolute`
   * finds (shown or not).
   */
  onMouseMove(x: number, y: number): void {
    this.m_pControlMouseOverStatic = this.getControlAtPointForStatic(x, y);
    let found: CKTDGUIControl | null = null;
    const list = this.m_ControlsList;
    for (let i = list.length - 1; i >= 0; i--) {
      const control = list[i];
      if (!control || control.m_ControlType === UCT.STATIC) continue;
      const p = localPoint(this.ctx, control, x, y);
      if (control.containsPoint(p.x, p.y) && control.m_bShow && !control.m_bOutofList) {
        found = control;
        break;
      }
    }
    if (this.m_bMouseOverShowDlg) {
      const absolute = this.getControlAtPointAbsolute(x, y);
      const old = this.m_pControlMouseOverShowDlg;
      if (old !== absolute) {
        if (old !== null) old.m_bMouseOver = false;
        this.m_pControlMouseOverShowDlg = absolute;
        if (absolute !== null) absolute.m_bMouseOver = true;
      }
    }
    const old = this.m_pControlMouseOver;
    if (found !== old) {
      if (old !== null) old.m_bMouseOver = false;
      this.m_pControlMouseOver = found;
      if (found !== null) found.m_bMouseOver = true;
    }
  }

  /**
   * `CreateGuideDesc()` (32956BD0): the first time a control of the dialog shows its guide text the dialog that shows it is made: `DLG_GuideDesc.lua`
   * (a static named `GuideDesc` and nothing else), layer 400, with the stage of this dialog and a fade-in of 0.07 s; it is put where this dialog is
   * (and its goal too, as it is fading in), handed to the dialog manager, and its static gets the one string it shows: UK font 2, white with a white
   * outline, at (5, 5), empty, none of the other flags; the static is hidden.  A dialog that already has one does nothing.  A script that makes no
   * `GuideDesc` leaves the exe with a null static: an Error here.
   */
  createGuideDesc(): void {
    if (this.m_pDialogGuideDesc !== null) return;
    const guide = new CKTDGUIDialog(this.ctx, { stage: this.m_pStage, scriptFileName: "DLG_GuideDesc.lua", moveTime: 0.07, layer: 400 });
    const x = this.m_Pos.x, y = this.m_Pos.y;
    this.m_pDialogGuideDesc = guide;
    guide.m_Pos.set(x, y);
    guide.m_GoalPos.set(x, y); // (the exe asks whether it is fading in, `m_fChangeTime > m_fAnimateTime`: with the 0.07 s it was given, it is)
    this.ctx.dialogManager.addDlg(guide);
    const found = guide.GetStatic("GuideDesc");
    if (!(found instanceof CKTDGUIStatic)) throw new Error("CKTDGUIDialog::CreateGuideDesc (32956BD0): DLG_GuideDesc.lua made no static \"GuideDesc\"; the exe goes on with a null pointer");
    this.m_pStaticGuideDesc = found;
    const data = new UIStringData();
    found.m_StringDataList.push(data);
    data.fontIndex = 2;
    data.color.set(1, 1, 1, 1);
    data.outlineColor.set(1, 1, 1, 1);
    data.pos.set(5, 5);
    found.SetShow(false);
  }

  /**
   * `ShowGuideDesc(pControl)` (3295BA30): the control's guide text goes up in the guide dialog (`CreateGuideDesc`), a black box of 70 % with the text in
   * UK font 2, next to the control.  The box is as wide as the widest line plus 12 and as high as the lines plus 12 plus one for each line break, all
   * in layout pixels (`(int)((float)size / scale)`).  Its place is the control's `GetGuideDescPos`, centred on it and above it (the box's bottom edge
   * there) or, when the control says `m_bGuideDescPosLT`, with its left-top corner there; it is then moved into the screen: to the left edge, or to
   * the right edge when it would pass the back buffer, 4 pixels from the top at least.  The static gets that place as its offset, relative to this
   * dialog's position (a control whose guide position is absolute also adds its own offset and takes the dialog's position off the height, which
   * is how the exe does it: the height always gets the control's offset, the width only for an absolute position).  The exe first asks THIS dialog to
   * bring the guide's static to the front, and it is not in this dialog's list: nothing happens.  A font 2 that does not exist or a static without a
   * picture or a string leaves the exe with a null pointer: an Error here.
   */
  showGuideDesc(control: CKTDGUIControl): void {
    this.createGuideDesc();
    const guide = this.m_pDialogGuideDesc!;
    const stat = this.m_pStaticGuideDesc;
    if (stat === null) throw new Error("CKTDGUIDialog::ShowGuideDesc (3295BA30): the guide dialog has no static (CreateGuideDesc found none); the exe calls through a null pointer");
    this.changeSequence(stat, true);
    stat.SetShow(true);
    guide.setShow(true);
    const x0 = this.m_Pos.x, y0 = this.m_Pos.y;
    const moving = guide.m_fChangeTime > guide.m_fAnimateTime;
    guide.m_Pos.set(x0, y0);
    if (moving) guide.m_GoalPos.set(x0, y0);
    const text = control.m_GuideDesc;
    const line = untilNul(text);
    const font = this.ctx.fonts.getUKFont(2);
    if (font === null) throw new Error("CKTDGUIDialog::ShowGuideDesc (3295BA30): UK font 2 does not exist; the exe measures the text with a null pointer");
    const scale = resolutionScale(this.ctx);
    const screenW = ftoi(f(f(backBufferWidth(this.ctx) >>> 0) / scale.x));
    const width = (ftoi(f(f(font.GetWidth(line)) / scale.x)) + 12) | 0;
    const height = ftoi(f(f(font.GetHeight(line)) / scale.y));
    const breaks = text.split("\n").length - 1;
    const boxHeight = (height + 12 + breaks) | 0;
    const w = f(width);
    let x: number, y: number;
    if (control.m_bGuideDescPosLT) {
      x = control.getGuideDescPos().x;
      y = control.getGuideDescPos().y;
    } else {
      x = f(f(x0 + control.getGuideDescPos().x) - f(w * 0.5));
      y = f(control.getGuideDescPos().y - f(boxHeight));
    }
    // (a comparison with NaN is "below": the box goes to the edge)
    let px: number;
    if (!(x >= 0)) px = 0;
    else if (f(w + x) < f(screenW)) px = ftoi(x);
    else px = (screenW - width) | 0;
    const py = !(y >= 0) ? 4 : ftoi(y);
    const absolute = control.getIsGuideDescAbsolutePos();
    let ox = f(px);
    let oy = f(f(py) + control.m_OffsetPos.y);
    if (absolute) {
      oy = f(oy - y0);
      ox = f(ox + control.m_OffsetPos.x);
    }
    ox = f(ox - x0);
    stat.setOffsetPos(new Vec2(ox, oy));
    const picture = stat.GetPicture(0);
    if (picture === undefined) throw new Error("CKTDGUIDialog::ShowGuideDesc (3295BA30): the static of the guide text has no picture; the exe writes through a null pointer");
    picture.setSize(new Vec2(w, f(boxHeight)));
    const point = stat.GetPicture(0)!.pPoint;
    if (!point) throw new Error("CKTDGUIDialog::ShowGuideDesc (3295BA30): the picture of the guide text has no point; the exe writes through a null pointer");
    point.color.set(0, 0, 0, f(0.7));
    const string = stat.GetString(0);
    if (string === undefined) throw new Error("CKTDGUIDialog::ShowGuideDesc (3295BA30): the static of the guide text has no string; the exe writes through a null pointer");
    string.msg = line;
  }

  /**
   * `OnFrameRender(bForceDraw)` (32958FF0): a dialog that is shown (or forced) and whose self-delete time (`SetTimeForSelfDelete`, counted
   * from its making) is not up draws its controls.  While the dialog manager hides the dialogs only the chat box's edit box
   * (`DLG_ChatBox_EditBox`) is drawn and every other dialog answers 1.  The sampler states (linear filters, mirrored addressing on the
   * stages 0 and 1) and the states of `m_RSICKTDGUIDialog` (alpha blending on, no alpha test, no depth test or write, modulate the texture
   * by the diffuse colour for colour and alpha) are pushed, every control that is not out of the list is drawn (`OnFrameRender`), then each
   * of them gets `OnFrameRenderEnd`, then the states are popped.  The unit viewer and the particle blocks of the exe (`m_bHasUnit`,
   * `m_bHasParticle`: set by C++ only, never by a script) are not ported.  Returns 0.
   */
  onFrameRender(bForceDraw = false): number {
    if (!(bForceDraw || this.m_bShow)) return 0;
    if (this.m_fTimeForSelfDelete > 0) {
      const elapsed = ((this.ctx.clock() - this.m_TimerToSelfDelete._start_time) | 0) / 1000;
      if (!(elapsed <= this.m_fTimeForSelfDelete)) return 0;
    }
    if (this.ctx.dialogManager.getHideDialog() && this.m_Name !== "DLG_ChatBox_EditBox") return 1;
    const states = this.ctx.render?.states;
    const top = states?.stackPointer ?? 0;
    if (states) {
      for (const s of DIALOG_SAMPLER_STATES) states.setSamplerState(s.stage, s.type, s.value);
      states.apply(RSI_UI_DIALOG);
    }
    for (let i = 0; i < this.m_ControlsList.length; i++) {
      const control = this.m_ControlsList[i];
      if (control && !control.m_bOutofList) control.onFrameRender();
    }
    for (let i = 0; i < this.m_ControlsList.length; i++) {
      const control = this.m_ControlsList[i]!;
      if (!control.m_bOutofList) control.onFrameRenderEnd();
    }
    states?.popTo(top);
    return 0;
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

  // ---- the order the controls are drawn and ask for the mouse in ------------------------------------------------------------

  /**
   * `ChangeSequence(pControlToChange, bFront)` (329566E0): the control (the first of that identity in `m_ControlsList`) moves to the end of
   * the list (`bFront`: it is drawn last, on top) or to its beginning.  False when there is no such control.
   */
  changeSequence(control: CKTDGUIControl | undefined, front: boolean): boolean {
    if (!control) return false;
    const at = this.m_ControlsList.indexOf(control);
    if (at < 0) return false;
    this.m_ControlsList.splice(at, 1);
    if (front) this.m_ControlsList.push(control);
    else this.m_ControlsList.unshift(control);
    return true;
  }

  /**
   * `ChangeSequence(pControlToChange, pPivotControl, bFront)` (32956590): both controls must be in the list; the control is taken out and put
   * right behind the pivot (`bFront`) or in front of it.  A pivot that is the control itself is not in the list any more when it is looked for:
   * the control is gone from the list (the exe goes on looking for another entry of the control and, finding none, ends).
   */
  changeSequenceByPivot(control: CKTDGUIControl | undefined, pivot: CKTDGUIControl | undefined, front: boolean): void {
    const list = this.m_ControlsList;
    if (!control || list.length <= 0 || !list.includes(control)) return;
    if (!pivot || !list.includes(pivot)) return;
    for (let i = 0; i < list.length; i++) {
      if (list[i] !== control) continue;
      list.splice(i, 1);
      const p = list.indexOf(pivot);
      if (p < 0) continue; // the entry that moved into place i is not looked at
      list.splice(front ? p + 1 : p, 0, control);
      return;
    }
  }

  /** `ChangeSequenceByName_LUA(name, bFront)` (32956920) */
  ChangeSequenceByName(name: string, front: boolean): void {
    this.changeSequence(this.getControl(name), front);
  }

  /** `ChangeSequenceByNameAndPivot_LUA(name, pivotName, bFront)` (329567B0): the control is looked up first, then the pivot */
  ChangeSequenceByNameAndPivot(name: string, pivotName: string, front: boolean): void {
    const control = this.getControl(name);
    const pivot = this.getControl(pivotName);
    this.changeSequenceByPivot(control, pivot, front);
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

  /** `SetFront(BOOL)` (3295B700): a dialog of a manager asks the manager (`ChangeFront`: the dialog moves in the list) */
  SetFront(front: boolean): void {
    if (this.m_bFront === front) return;
    if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeFront(this, front);
    else this.m_bFront = front;
  }

  /** `SetLayer(int)` (3295B790): a dialog of a manager asks the manager (`ChangeLayer`: the dialog moves in the list) */
  SetLayer(layer: number): void {
    if (layer === this.m_iLayer) return;
    if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.changeLayer(this, layer);
    else this.m_iLayer = layer;
  }

  /** `GetIsOverControl()` (32957790): the mouse is over a control, for a dialog that takes the messages under it */
  getIsOverControl(): boolean {
    return this.m_bDisableUnderWindow && this.m_bIsOverControl;
  }

  /** `SetIsOverControl(val)` (3295B770): only a dialog that takes the messages under it keeps it */
  setIsOverControl(val: boolean): void {
    if (this.m_bDisableUnderWindow) this.m_bIsOverControl = val;
  }

  /**
   * `SendInternelEvent(hWnd, uMsg, wParam, lParam)` (3295B610): the dialog hands the message to its stage; false when it has none.
   * (`CKTDXApp::CheckStage`, which asks whether the stage is still alive, is always true here.)
   */
  sendInternelEvent(msg: number, wParam: number | string, lParam: unknown = this): boolean {
    const stage = this.m_pStage as UIStage | undefined | null;
    if (!stage) return false;
    stage.MsgProc?.(msg, wParam, lParam);
    return true;
  }

  /**
   * `HandleMouse(uMsg, pt, wParam, lParam)` (32957AA0): a mouse message at `(x, y)` (the mouse less the dialog's position, in pixels of the
   * back buffer).  A combo box or IME edit box of this dialog that has the focus is asked first, with its own local point.  Otherwise
   * the controls are walked from the last (the one drawn on top): each that holds the point and is shown makes `m_bIsOverControl` true; the
   * first that holds the point, is enabled and shown and is not out of the list gets `OnMouseMove` for the dialog and then its own
   * `HandleMouse`; the walk stops when one answers true.
   */
  handleMouse(uMsg: number, x: number, y: number, wParam: number, lParam: number): boolean {
    const ctx = this.ctx;
    const focus = ctx.controlFocus;
    if (
      focus !== null && focus.m_pDialog === this && focus.m_bEnable && focus.m_bShow &&
      (focus.m_ControlType === UCT.COMBOBOX || focus.m_ControlType === UCT.IME_EDITBOX)
    ) {
      const p = localPoint(ctx, focus, x, y);
      if (focus.handleMouse(uMsg, p.x, p.y, wParam, lParam)) return true;
    }
    const list = this.m_ControlsList;
    for (let i = list.length - 1; i >= 0; i--) {
      const control = list[i];
      if (!control) continue;
      const p = localPoint(ctx, control, x, y);
      const holds = control.containsPoint(p.x, p.y);
      if (holds && control.m_bShow) this.m_bIsOverControl = true;
      if (holds && control.m_bEnable && control.m_bShow && !control.m_bOutofList) {
        this.onMouseMove(x, y);
        if (control.handleMouse(uMsg, p.x, p.y, wParam, lParam)) return true;
      }
    }
    return false;
  }

  /**
   * `MsgProc(hWnd, uMsg, wParam, lParam)` (32958350): the dialog's share of the window messages; true when the dialog took the message.
   *
   * A dialog that is disabled or hidden, or whose self-delete time is up, takes nothing; the IME's static message proc comes next.  The
   * keyboard messages (0x100, 0x101, 0x104, 0x105): a key up of Tab, Right or Down moves the focus to the control the focused control's
   * `m_TabControlName` names in this dialog's map, Left or Up to its `m_PrevTabControlName`; every other key goes to the focused control's
   * `HandleKeyboard`.  The mouse messages (0x200 .. 0x20D) are the dialog's own: with the dialogs hidden (`GetHideDialog`) they are taken
   * and nothing else happens; otherwise the mouse over / out message of the dialog (`m_CustomMsgMouseOver` / `m_CustomMsgMouseOut`), the
   * drag of the dialog (`m_bEnableMoveByDrag`), `HandleMouse`, and, when no control took the message, the click outside (the focus is
   * lost, the dialog may close, `m_CustomMsgFocusOutEventID`), `OnMouseMove`, the start and the stop of a drag (`m_CustomMsgStartDragging`,
   * `m_CustomMsgStopDragging`), the right button up (`m_CustomMsgRMouseUp`); the answer is whether the dialog takes the messages under it
   * (`m_bDisableUnderWindow`) and the mouse is over one of its controls.  Every other message goes to the focused control's `MsgProc`.
   */
  msgProc(hWnd: unknown, uMsg: number, wParam: number, lParam: number): boolean {
    if (!this.m_bEnable) return false;
    if (!this.m_bShow) return false;
    const ctx = this.ctx;
    if (this.m_fTimeForSelfDelete > 0) {
      if (((ctx.clock() - this.m_TimerToSelfDelete._start_time) | 0) / 1000 > this.m_fTimeForSelfDelete) return false;
    }
    if (ctx.ime.staticMsgProc(uMsg, wParam) === 1) return true;
    const msg = uMsg >>> 0;
    if (msg === 0x200 || (msg > 0x200 && msg - 0x201 <= 0xc)) return this.mouseMsgProc(msg, wParam, lParam);
    const kind = msg - 0x100;
    if (kind >= 0 && kind <= 5 && kind !== 2 && kind !== 3) {
      // WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP
      let focus = ctx.controlFocus;
      if (msg === 0x101) {
        if (focus === null) return false;
        let name: string | null = null;
        if (wParam === 9 || wParam === 0x27 || wParam === 0x28) name = focus.m_TabControlName;
        else if (wParam === 0x25 || wParam === 0x26) name = focus.m_PrevTabControlName;
        if (name !== null) {
          const target = this.m_ControlsMap.get(name);
          if (target !== undefined) {
            this.requestFocus(target);
            return true;
          }
        }
        focus = ctx.controlFocus;
      }
      if (focus === null || focus.m_pDialog !== this || !focus.m_bEnable || !focus.m_bShow) return false;
      return focus.handleKeyboard(msg, wParam, lParam);
    }
    const focus = ctx.controlFocus;
    return focus !== null && focus.m_pDialog === this && focus.m_bEnable && focus.m_bShow && focus.msgProc(hWnd, msg, wParam, lParam);
  }

  /** the mouse half of `MsgProc` (32958350): `uMsg` is 0x200 .. 0x20D */
  private mouseMsgProc(uMsg: number, wParam: number, lParam: number): boolean {
    const ctx = this.ctx;
    if (ctx.dialogManager.getHideDialog()) return true;
    this.m_bIsOverControl = false;
    const scale = resolutionScale(ctx);
    const px = (ctx.mouse.GetXPos() - ftoi(f(this.m_Pos.x * scale.x))) | 0;
    const py = (ctx.mouse.GetYPos() - ftoi(f(this.m_Pos.y * scale.y))) | 0;
    // the mouse over / out message of the dialog: when the mouse comes onto a control (shown or not) and when it leaves them all
    const onControl = this.getControlAtPointAbsolute(px, py) !== null;
    let overMsg = -1;
    if (onControl) {
      if (!this.m_bIsMouseOver) {
        overMsg = this.m_CustomMsgMouseOver;
        this.m_bIsMouseOver = true;
      }
    } else if (this.m_bIsMouseOver) {
      overMsg = this.m_CustomMsgMouseOut;
      this.m_bIsMouseOver = false;
    }
    if (overMsg !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, overMsg, 0);
    // the drag of the dialog: the control with the focus (of any dialog), else the control under the mouse, gives the local point
    if (this.m_bEnableMoveByDrag && uMsg === 0x200) {
      const target = ctx.controlFocus ?? this.getControlAtPointForStatic(px, py);
      if (target !== null) {
        const lx = localAxis(px, scale.x, target.m_OffsetPos.x);
        const ly = localAxis(py, scale.y, target.m_OffsetPos.y);
        const dx = (lx - this.m_PrevMousePointX) | 0;
        const dy = (ly - this.m_PrevMousePointY) | 0;
        if (this.m_bMouseDownForDrag) {
          this.setPos(new Vec2(f(f(dx) + this.m_Pos.x), f(f(dy) + this.m_Pos.y)));
          return true;
        }
        this.m_PrevMousePointX = lx;
        this.m_PrevMousePointY = ly;
      }
    }
    if (this.handleMouse(uMsg, px, py, wParam, lParam)) return true;
    if (uMsg === 0x201) {
      // a click that no control took: the control with the focus loses it, and the dialog may close
      const focus = ctx.controlFocus;
      if (focus !== null && focus.m_pDialog === this) {
        focus.onFocusOut();
        ctx.controlFocus = null;
      }
      if (this.m_bCloseOnFocusOut) {
        if (this.m_bShow) {
          const guide = this.m_pDialogGuideDesc;
          this.m_bShow = false;
          if (guide !== null) guide.setShow(false);
          if (!this.m_bModal && this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.countModalDialog(null);
        }
        if (CKTDGUISlot.s_pDragSlot !== null && CKTDGUISlot.s_pDragSlot.m_pDialog === this) CKTDGUISlot.returnDraggingItem();
        this.m_bEnable = false;
        const stage = this.m_pStage as UIStage | undefined | null;
        stage?.MsgProc?.(UIM.CUSTOM_MSG, this.m_CloseCustomUIEventID, this);
      }
      const focusOutMsg = this.m_CustomMsgFocusOutEventID;
      const stage = this.m_pStage as UIStage | undefined | null;
      if (focusOutMsg !== -1 && stage) stage.MsgProc?.(UIM.CUSTOM_MSG, focusOutMsg, this);
    }
    this.m_bMouseDownForDrag = false;
    switch (uMsg - 0x200) {
      case 0: // WM_MOUSEMOVE
        this.onMouseMove(px, py);
        break;
      case 1: { // WM_LBUTTONDOWN: a drag of the dialog starts on a shown control that is in it
        const control = this.getControlAtPointForStatic(px, py);
        if (control !== null && control.m_pDialog === this && control.m_bShow) {
          this.m_bMouseDownForDrag = true;
          if (this.m_CustomMsgStartDragging !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgStartDragging, this);
        }
        break;
      }
      case 2: // WM_LBUTTONUP
        if (this.m_CustomMsgStopDragging !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgStopDragging, this);
        break;
      case 5: // WM_RBUTTONUP: not even the messages under the dialog are taken
        if (this.m_CustomMsgRMouseUp !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgRMouseUp, this);
        return false;
      default: // WM_LBUTTONDBLCLK, WM_RBUTTONDOWN and all above WM_RBUTTONUP
        break;
    }
    return this.m_bDisableUnderWindow && this.m_bIsOverControl;
  }

  /**
   * `~CKTDGUIDialog` (329554D0), the deleting destructor the dialog manager calls (and `KJohnObjMan<CKTDGUIDialog>::Destroy`, which then frees the
   * dialog's slot: `destroyed`).  The guide text's dialog is deleted from the application's manager; the dialog leaves the manager it belongs
   * to (`UnmanageDlg`); a control of this dialog that has the focus loses it (`OnFocusOut`); the radio button groups are dropped, every control
   * is destroyed (its own destructor) and the control list and the name map are emptied.
   */
  Destroy(): void {
    if (this.m_pDialogGuideDesc !== null) {
      this.ctx.dialogManager.deleteDlg(this.m_pDialogGuideDesc);
      this.m_pDialogGuideDesc = null;
    }
    if (this.m_pkUIDialogManager !== null) this.m_pkUIDialogManager.unmanageDlg(this);
    const focus = this.ctx.controlFocus;
    if (focus !== null && focus.m_pDialog === this) {
      focus.onFocusOut();
      this.ctx.controlFocus = null;
    }
    this.m_mapRadioButtonGroupInfo.clear();
    for (let i = 0; i < this.m_ControlsList.length; i++) {
      const control = this.m_ControlsList[i];
      if (control) control.Destroy();
      this.m_ControlsList[i] = null as never;
    }
    this.m_ControlsList.length = 0;
    this.m_ControlsMap.clear();
    this.destroyed = true;
  }

  /** `CheckControl(pControl)` (32956A00): the control is in the dialog's list (null never is) */
  checkControl(control: CKTDGUIControl | null): boolean {
    return control !== null && this.m_ControlsList.includes(control);
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

  /** `CreateEditBox()` (328C12E0) */
  CreateEditBox(): CKTDGUIEditBox {
    return new CKTDGUIEditBox(this.ctx);
  }

  /** `CreateSlider()` (328C18D0) */
  CreateSlider(): CKTDGUISlider {
    return new CKTDGUISlider(this.ctx);
  }

  /** `CreateControlList()` (328C1270) */
  CreateControlList(): CKTDGUIContolList {
    return new CKTDGUIContolList(this.ctx);
  }

  /** `CreateMovie()` (328C15E0) */
  CreateMovie(): CMovieData {
    return new CMovieData(this.ctx);
  }

  /** `CreateNavigation()` (328C1650) */
  CreateNavigation(): CKTDGUINavigation {
    return new CKTDGUINavigation(this.ctx);
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
  getControl(name: string): CKTDGUIControl | undefined;
  /** `GetControl(int index)` (329572D0): the control at that place of the list, null for an index out of range */
  getControl(index: number): CKTDGUIControl | null;
  getControl(key: string | number): CKTDGUIControl | undefined | null {
    if (typeof key === "number") return this.m_ControlsList[key] ?? null;
    const name = key;
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

  /** `GetRadioButtonGroupInfo(iGroupID)` (3294A630): the group, null when there is none of that id */
  getRadioButtonGroupInfo(groupID: number): RadioButtonGroupInfo | null {
    return this.m_mapRadioButtonGroupInfo.get(groupID) ?? null;
  }

  /** `RequestFocus(CKTDGUIControl*)` (3295B490): the control takes the focus from the one that has it, if it can have it */
  requestFocus(control: CKTDGUIControl): void {
    requestFocus(this.ctx, control);
  }

  /** `CKTDGUIDialog::ClearFocus()` (32956B90), a static function: the control that has the focus loses it */
  clearFocus(): void {
    clearFocus(this.ctx);
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
