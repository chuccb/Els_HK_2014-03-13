/**
 * `CKTDGUIDialogManager` (`g_pKTDXApp->m_pDGManager->m_pDialogManager`): the dialogs a game state shows, in the order they are drawn.
 *
 * **The list** (`m_listDialog`, a `std::list<CKTDGUIDialogHandle>`) runs from the back to the front: the dialogs that are not `m_bFront`
 * come first, each group in ascending `m_iLayer`, and a dialog that is added (`AddDlg` -> `_InsertIntoDialogListTop` 328E1010) goes behind
 * every dialog of its group (the last of its layer).  `ChangeSequence(dialog, false)` puts it in front of the first of its layer instead
 * (328DDF20).  `m_setDialog` holds the same dialogs for `CheckDlg`, and `m_iDialogListChangeCount` counts the changes of the list (it
 * wraps to 1 above 2147483637): each dialog keeps the count of its last change in `m_iDialogListChangeCount` (negative when it went to
 * the back of its layer, 0 when it is out of the list), and `GetDialog` answers a name from `m_mapDialog` while the count has not
 * moved since it last looked the name up.  **Exe bug kept**: a name that was found, then lost (the dialog was taken out) and looked up
 * once (a miss records the count) is answered from `m_mapDialog` the second time: with the dialog that is not in the list any more
 * (a destroyed one is a handle that resolves to nothing).
 *
 * **The handles.**  The exe passes `CKTDGUIDialogHandle`s (an index and a magic number into `KJohnObjMan<CKTDGUIDialog>`'s table).  Here a
 * dialog stands for its handle: `operator!=(handle, nullptr)` (329638A0) is false for a handle whose dialog was destroyed (`Destroy`),
 * which is `live()` below, and a handle compares equal to another by identity.  The list holds nodes (`DialogNode`) like the exe's, because
 * the walks (`m_vecIterator`, `m_vecReverseIterator`: a vector of list iterators that every walk pushes its position on) have to survive a
 * dialog being taken out of the list by the very call they make (`_RemoveFromDialogList` moves the iterators that stand on it).
 *
 * Constructor (328DD5F0): `m_bShow = true`, `m_bCanHide = false`.  `GetHideDialog()` (328DEF40) is `m_bCanHide && !m_bShow`: with a hidden
 * dialog layer `CKTDGUIDialog::OnFrameRender` draws only the chat box's edit box.
 *
 * `ExistDialogAtMousePos` (328DE620) asks every dialog of the set for `GetControlMouseOver` (329574A0).  Not ported: `OnLostDevice` /
 * `OnResetDevice` (328E09A0 / 328E0A40, the device reset the dialogs pass on to their controls), the destructor (328DD8A0) and the dialogs'
 * own `MsgProc` (`CKTDGUIDialog::MsgProc` 32958350, the input), which the manager's `MsgProc` loop (328DEFD0) calls.
 */
import type { CKTDGUIDialogManager_Methods } from "@els/host";
import { UCT } from "./control.ts";
import type { UIContext } from "./control.ts";
import type { CKTDGUIDialog } from "./dialog.ts";
import { CKTDGUISlot } from "./slot.ts";

/** the dialogs `OnFrameMove` and `OnFrameRender` look up by name while the dialog layer is hidden (`m_bCanHide && !m_bShow`), in this order */
const HIDDEN_LAYER_DIALOGS = ["DLG_ChatBox_EditBox", "DLG_MsgBox", "DLG_OKMsgBox", "OkAndCancelMsgBox"] as const;

/** `m_iDialogListChangeCount` goes back to 1 above this */
const CHANGE_COUNT_LIMIT = 2147483637;

/** `WM_LBUTTONUP` / `WM_RBUTTONUP`: the messages after which `MsgProc` gives a dragged slot back */
const WM_LBUTTONUP = 514;
const WM_RBUTTONUP = 516;

/** a node of the exe's `std::list<CKTDGUIDialogHandle>`: `_Next`, `_Prev`, `_Myval` (the sentinel's value is null) */
export class DialogNode {
  next: DialogNode;
  prev: DialogNode;
  constructor(readonly value: CKTDGUIDialog | null) {
    this.next = this;
    this.prev = this;
  }
}

/** `std::list<CKTDGUIDialogHandle>`: a ring through a sentinel (`head`), `head.next` being `begin()` and `head.prev` the last dialog */
export class DialogList implements Iterable<CKTDGUIDialog> {
  readonly head = new DialogNode(null);
  /** `_Mysize` */
  size = 0;

  /** `list.insert(where, dialog)`: before the node `where` (the sentinel appends); the new node */
  insert(where: DialogNode, dialog: CKTDGUIDialog): DialogNode {
    const node = new DialogNode(dialog);
    node.next = where;
    node.prev = where.prev;
    where.prev.next = node;
    where.prev = node;
    this.size++;
    return node;
  }

  /** `push_back(dialog ...)` */
  push(...dialogs: CKTDGUIDialog[]): void {
    for (const d of dialogs) this.insert(this.head, d);
  }

  /** the node that holds the dialog (from the front of the list: the first) or null */
  find(dialog: CKTDGUIDialog): DialogNode | null {
    for (let n = this.head.next; n !== this.head; n = n.next) if (n.value === dialog) return n;
    return null;
  }

  /** unlinks the node */
  erase(node: DialogNode): void {
    node.prev.next = node.next;
    node.next.prev = node.prev;
    this.size--;
  }

  *[Symbol.iterator](): Iterator<CKTDGUIDialog> {
    for (let n = this.head.next; n !== this.head; n = n.next) yield n.value!;
  }
}

/** `operator!=(handle, nullptr)` (329638A0): the dialog is there (not null, not destroyed) */
function live(dialog: CKTDGUIDialog | null): dialog is CKTDGUIDialog {
  return dialog !== null && !dialog.destroyed;
}

export class CKTDGUIDialogManager implements CKTDGUIDialogManager_Methods {
  m_bShow = true;
  m_bCanHide = false;
  /** `m_mapDialog`: the dialogs `GetDialog` found, by name (a cache: see the class comment) */
  readonly m_mapDialog = new Map<string, CKTDGUIDialog>();
  /** `m_setDialog`: the dialogs the manager owns (a `std::set` of handles) */
  readonly m_setDialog = new Set<CKTDGUIDialog>();
  /** `m_listDialog`: the dialogs from the back to the front (a `std::list`) */
  readonly m_listDialog = new DialogList();
  /** `m_vecIterator`: the forward walks that are going on, each at the node it will visit next (the sentinel: it is done) */
  readonly m_vecIterator: DialogNode[] = [];
  /** `m_vecReverseIterator`: the backward walks that are going on, each at the node it will visit next (the sentinel: it is done) */
  readonly m_vecReverseIterator: DialogNode[] = [];
  /** `m_iModalDialogCount`: the shown dialogs that are not modal and have no slot (`CountModalDialog`) */
  m_iModalDialogCount = 0;
  /** `m_iDialogListChangeCount`: how many times the list changed (1 .. 2147483637) */
  m_iDialogListChangeCount = 0;
  /** `m_mapDialogListChangeCountWhenLastGetDialog`: the change count when each name was last looked up */
  readonly m_mapDialogListChangeCountWhenLastGetDialog = new Map<string, number>();

  /** `ctx`: the world the manager belongs to (the exe's globals the manager reads: the control that has the focus, `s_pControlFocus`) */
  constructor(readonly ctx: UIContext) {}

  /** `SetShow(bool)` (328CDFA0), registered in Lua: `m_bShow`, which `OnFrameMove` and `OnFrameRender` read together with `m_bCanHide` */
  SetShow(show: boolean): void {
    this.m_bShow = show;
  }

  /** `GetHideDialog()` (328DEF40) */
  getHideDialog(): boolean {
    return this.m_bCanHide && !this.m_bShow;
  }

  /** `CheckModalDlg()` (328DE260): a dialog that is not modal is shown */
  checkModalDlg(): boolean {
    return this.m_iModalDialogCount > 0;
  }

  /** `CheckDlg(pDialogToCheck)` (328DE0F0): the dialog is not null, is in the manager's set, and knows a manager */
  checkDlg(dialog: CKTDGUIDialog | null): dialog is CKTDGUIDialog {
    return dialog !== null && this.m_setDialog.has(dialog) && dialog.m_pkUIDialogManager !== null;
  }

  /**
   * `CheckFrontModalDlg(pPivotDialog)` (328DE180): true when a dialog in front of the pivot (the list is walked from the front one
   * backwards) is shown, enabled and not modal; false when the pivot comes first, when the list is empty, or when the manager does not
   * know the pivot (`CheckDlg`).
   */
  checkFrontModalDlg(pivot: CKTDGUIDialog | null): boolean {
    if (!this.checkDlg(pivot)) return false;
    for (let n = this.m_listDialog.head.prev; n !== this.m_listDialog.head; n = n.prev) {
      const dialog = n.value!;
      if (dialog === pivot) return false;
      if (dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal) return true;
    }
    return false;
  }

  /**
   * `CountModalDialog(pDialog)` (328DE4C0): with a dialog, the count goes up by one when the dialog is not modal, is shown and has no slot;
   * with null the count is made again over the whole list.
   */
  countModalDialog(dialog: CKTDGUIDialog | null): void {
    const counts = (d: CKTDGUIDialog): boolean => !d.m_bModal && d.m_bShow && !d.m_bHasSlot;
    if (dialog !== null) {
      if (counts(dialog)) this.m_iModalDialogCount = (this.m_iModalDialogCount + 1) | 0;
      return;
    }
    this.m_iModalDialogCount = 0;
    for (const d of this.m_listDialog) if (counts(d)) this.m_iModalDialogCount = (this.m_iModalDialogCount + 1) | 0;
  }

  // ---- the list ---------------------------------------------------------------------------------------------------------------

  /** the count of changes goes up by one (back to 1 above 2147483637); the new count */
  private bumpChangeCount(): number {
    let count = this.m_iDialogListChangeCount + 1;
    this.m_iDialogListChangeCount = count;
    if (count > CHANGE_COUNT_LIMIT) {
      this.m_iDialogListChangeCount = 1;
      count = 1;
    }
    return count;
  }

  /**
   * `AddDlg(pDialog)` (328DDB40): a dialog that is there and has no manager yet joins this one and goes to the top of its layer
   * (`_InsertIntoDialogListTop`); false for null, a destroyed dialog, or one that already has a manager (this one too).
   */
  addDlg(dialog: CKTDGUIDialog | null): boolean {
    if (!live(dialog) || dialog.m_pkUIDialogManager !== null) return false;
    dialog.m_pkUIDialogManager = this;
    this.insertIntoDialogListTop(dialog);
    return true;
  }

  /**
   * `_InsertIntoDialogListTop(pkInDialog_)` (328E1010): the dialog goes in front of the dialogs that are behind it and behind the dialogs
   * in front of it: before the first dialog of the list that is `m_bFront` while the new one is not, or that has the same `m_bFront` and
   * a layer above the new one's (a new dialog is behind none of the dialogs of its own layer); at the end when there is none.  It joins
   * the set, the count of changes goes up, the dialog takes it, and the modal dialogs are counted (with the dialog).
   */
  insertIntoDialogListTop(dialog: CKTDGUIDialog): void {
    const list = this.m_listDialog;
    let at = list.head.next;
    while (at !== list.head) {
      const other = at.value!;
      const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer < other.m_iLayer : other.m_bFront || dialog.m_iLayer < other.m_iLayer;
      if (before) break;
      at = at.next;
    }
    list.insert(at, dialog);
    this.m_setDialog.add(dialog);
    dialog.m_iDialogListChangeCount = this.bumpChangeCount();
    this.countModalDialog(dialog);
  }

  /**
   * `_RemoveFromDialogList(pkInDialog_)` (328E1180): false when the dialog is not in the list.  Otherwise the walks that stand on its node
   * move on (a forward one to the next node, a backward one to the previous node, the sentinel after the first), the node goes, the dialog
   * leaves the set, the count of changes goes up, the dialog's own count is 0 and the modal dialogs are counted again.
   */
  removeFromDialogList(dialog: CKTDGUIDialog): boolean {
    const list = this.m_listDialog;
    const node = list.find(dialog);
    if (node === null) return false;
    const head = list.head;
    const forward = this.m_vecIterator;
    for (let i = 0; i < forward.length; i++) {
      const it = forward[i]!;
      if (it !== head && it.value === dialog) forward[i] = it.next;
    }
    const backward = this.m_vecReverseIterator;
    for (let i = 0; i < backward.length; i++) {
      const it = backward[i]!;
      if (it !== head && it.value === dialog) backward[i] = it.prev; // (the exe tests for the first node: its `_Prev` is the sentinel, too)
    }
    list.erase(node);
    this.m_setDialog.delete(dialog);
    this.bumpChangeCount();
    dialog.m_iDialogListChangeCount = 0;
    this.countModalDialog(null);
    return true;
  }

  /** `ChangeFront(pDialog, bFront)` (328DDBE0): false for a dialog the manager does not know; one whose flag changes leaves the list and comes back to the top of its new group */
  changeFront(dialog: CKTDGUIDialog | null, front: boolean): boolean {
    if (!this.checkDlg(dialog)) return false;
    if (dialog.m_bFront !== front) {
      this.removeFromDialogList(dialog);
      dialog.m_bFront = front;
      this.insertIntoDialogListTop(dialog);
    }
    return true;
  }

  /** `ChangeLayer(pDialog, layerToChange)` (328DDC90): false for a dialog the manager does not know; one whose layer changes leaves the list and comes back to the top of its new layer */
  changeLayer(dialog: CKTDGUIDialog | null, layer: number): boolean {
    if (!this.checkDlg(dialog)) return false;
    if (dialog.m_iLayer !== layer) {
      this.removeFromDialogList(dialog);
      dialog.m_iLayer = layer;
      this.insertIntoDialogListTop(dialog);
    }
    return true;
  }

  /**
   * `ChangeSequence(pDialog, bTop)` (328DDF20): the dialog goes to the top (`_InsertIntoDialogListTop`) or to the bottom of its layer.  A dialog
   * that was the last to change the list and is already where it is asked to be (its count positive for the top, negative for the bottom)
   * stays.  The bottom is before the first dialog of the list that is `m_bFront` while this one is not, or that has the same `m_bFront` and a
   * layer that is not below this one's; its count is minus the new count of changes.  False for a dialog the manager does not know.
   */
  changeSequence(dialog: CKTDGUIDialog | null, top: boolean): boolean;
  /**
   * `ChangeSequence(pDialogToChange, pPivotDialog, bOver, bChangeLayer)` (328DDD40): the dialog goes next to the pivot, behind it
   * (`bOver`: in front of it).  False when either is not known to the manager, when they are one dialog, or (without `bChangeLayer`) when
   * their `m_bFront` or layer differ; the dialog takes the pivot's front flag and layer (`CKTDGUIDialogManagerAccess`).  **Kept**: it joins
   * the set and takes the (positive) count, but the modal dialogs are not counted again.
   */
  changeSequence(dialog: CKTDGUIDialog | null, pivot: CKTDGUIDialog | null, over: boolean, changeLayer: boolean): boolean;
  changeSequence(dialog: CKTDGUIDialog | null, topOrPivot: boolean | CKTDGUIDialog | null, over?: boolean, changeLayer?: boolean): boolean {
    if (typeof topOrPivot !== "boolean") return this.changeSequenceToPivot(dialog, topOrPivot, over!, changeLayer!);
    const top = topOrPivot;
    if (!this.checkDlg(dialog)) return false;
    if (Math.abs(dialog.m_iDialogListChangeCount) === this.m_iDialogListChangeCount) {
      if (top) {
        if (dialog.m_iDialogListChangeCount > 0) return true;
      } else if (dialog.m_iDialogListChangeCount < 0) {
        return true;
      }
    }
    this.removeFromDialogList(dialog);
    if (top) {
      this.insertIntoDialogListTop(dialog);
      return true;
    }
    const list = this.m_listDialog;
    let at = list.head.next;
    while (at !== list.head) {
      const other = at.value!;
      const before = dialog.m_bFront ? other.m_bFront && dialog.m_iLayer <= other.m_iLayer : other.m_bFront || dialog.m_iLayer <= other.m_iLayer;
      if (before) break;
      at = at.next;
    }
    list.insert(at, dialog);
    this.m_setDialog.add(dialog);
    dialog.m_iDialogListChangeCount = -this.bumpChangeCount();
    this.countModalDialog(dialog);
    return true;
  }

  private changeSequenceToPivot(dialog: CKTDGUIDialog | null, pivot: CKTDGUIDialog | null, over: boolean, changeLayer: boolean): boolean {
    if (!this.checkDlg(dialog)) return false;
    if (!this.checkDlg(pivot)) return false;
    if (dialog === pivot) return false;
    if (!changeLayer) {
      if (dialog.m_bFront !== pivot.m_bFront) return false;
      if (dialog.m_iLayer !== pivot.m_iLayer) return false;
    }
    this.removeFromDialogList(dialog);
    dialog.m_bFront = pivot.m_bFront; // CKTDGUIDialogManagerAccess::SetFront / SetLayer (328E0AE0 / 328E0B20): the fields, no list work
    dialog.m_iLayer = pivot.m_iLayer;
    const list = this.m_listDialog;
    let at = list.find(pivot);
    if (at === null) return false; // the dialog is out of the list now (the exe leaves it so)
    if (over) at = at.next;
    list.insert(at, dialog);
    this.m_setDialog.add(dialog);
    dialog.m_iDialogListChangeCount = this.bumpChangeCount();
    return true;
  }

  /** `UnmanageDlg(pDialog)` (328E0C90): the dialog leaves the list and the manager (it lives on); false for a dialog the manager does not know */
  unmanageDlg(dialog: CKTDGUIDialog | null): boolean {
    if (!this.checkDlg(dialog)) return false;
    this.removeFromDialogList(dialog);
    dialog.m_pkUIDialogManager = null;
    return true;
  }

  /** `KJohnObjMan<CKTDGUIDialog>::Destroy(handle)` / the table lookup the exe repeats: a dialog that is there is destroyed (`OnPreFreeMem` does nothing, then the deleting destructor) */
  private destroy(dialog: CKTDGUIDialog): void {
    if (live(dialog)) dialog.Destroy();
  }

  /** `DeleteDlg(pDialog)` (328DE540): `UnmanageDlg`, then the dialog is destroyed; false for a dialog the manager does not know */
  deleteDlg(dialog: CKTDGUIDialog | null): boolean {
    if (!this.checkDlg(dialog)) return false;
    this.unmanageDlg(dialog);
    this.destroy(dialog);
    return true;
  }

  /**
   * `ClearAllDlg()` (328DE270): the first dialog of the list leaves it and the manager when the manager knows it, and is destroyed, until the list
   * is empty.  The exe never ends when the first dialog is in the list but not in the set (`CheckDlg`): here that is an Error.
   */
  clearAllDlg(): void {
    const list = this.m_listDialog;
    while (list.size !== 0) {
      const first = list.head.next.value!;
      if (this.checkDlg(first)) {
        this.removeFromDialogList(first);
        first.m_pkUIDialogManager = null;
      }
      this.destroy(first);
      if (list.head.next.value === first) throw new Error("CKTDGUIDialogManager::ClearAllDlg: the first dialog is in the list but not known to the manager: the exe never leaves the loop");
    }
  }

  /** `ClearAllOKAndCancelMsgDlg()` (328DE360): every dialog that is an OK / Cancel message box (`m_bOKAndCancelMsgBox`) is taken out and destroyed; 1 */
  clearAllOKAndCancelMsgDlg(): boolean {
    this.walkForward((dialog) => {
      if (!dialog.m_bOKAndCancelMsgBox) return;
      if (this.checkDlg(dialog)) {
        this.removeFromDialogList(dialog);
        dialog.m_pkUIDialogManager = null;
      }
      this.destroy(dialog);
    });
    return true;
  }

  // ---- the walks ----------------------------------------------------------------------------------------------------------------

  /**
   * A walk from the back to the front of the list the way the exe does it: the position is a node of `m_vecIterator` that
   * `_RemoveFromDialogList` keeps valid, and it is moved on BEFORE the dialog is visited, so a visit may take that dialog out.
   */
  private walkForward(visit: (dialog: CKTDGUIDialog) => void): void {
    const walks = this.m_vecIterator;
    const head = this.m_listDialog.head;
    walks.push(head.next);
    try {
      while (walks[walks.length - 1] !== head) {
        const node = walks[walks.length - 1]!;
        walks[walks.length - 1] = node.next;
        visit(node.value!);
      }
    } finally {
      walks.pop();
    }
  }

  /** A walk from the front to the back (`m_vecReverseIterator`): moved on before the visit; `visit` answers true to stop. */
  private walkBackward(visit: (dialog: CKTDGUIDialog) => boolean): void {
    const walks = this.m_vecReverseIterator;
    const head = this.m_listDialog.head;
    walks.push(head.prev);
    try {
      while (walks[walks.length - 1] !== head) {
        const node = walks[walks.length - 1]!;
        walks[walks.length - 1] = node.prev; // (the exe tests for the first node: its `_Prev` is the sentinel, too)
        if (visit(node.value!)) break;
      }
    } finally {
      walks.pop();
    }
  }

  // ---- the lookups --------------------------------------------------------------------------------------------------------------

  /**
   * `GetDialog(pName)` (328DE820): the dialog of that name, null when there is none.  While the count of changes is the one of the last lookup of
   * the name the answer comes from `m_mapDialog` (a name it does not hold is null: no walk of the list); otherwise the list is walked
   * from the back for the first dialog of that name, which `m_mapDialog` then holds; either way the count is the name's.
   */
  getDialog(name: string | null): CKTDGUIDialog | null {
    if (name === null) return null;
    let seen = this.m_mapDialogListChangeCountWhenLastGetDialog.get(name);
    if (seen === undefined) {
      seen = 0; // `operator[]` makes the entry
      this.m_mapDialogListChangeCountWhenLastGetDialog.set(name, 0);
    }
    if (seen === this.m_iDialogListChangeCount) return this.m_mapDialog.get(name) ?? null;
    for (const dialog of this.m_listDialog) {
      if (dialog.m_Name === name) {
        this.m_mapDialog.set(name, dialog);
        this.m_mapDialogListChangeCountWhenLastGetDialog.set(name, this.m_iDialogListChangeCount);
        return dialog;
      }
    }
    this.m_mapDialogListChangeCountWhenLastGetDialog.set(name, this.m_iDialogListChangeCount);
    return null;
  }

  /** `GetDialog_LUA(pName)` (328DEB20), registered in Lua as `GetDialog`: `GetDialog` of the name for a name that is not empty, and the dialog when it is there */
  GetDialog(name: string | undefined): CKTDGUIDialog | undefined {
    if (name === undefined || name.length === 0) return undefined;
    const dialog = this.getDialog(name);
    return live(dialog) ? dialog : undefined;
  }

  /** `GetFirstFrontModalDlg()` (328DEE90): the dialog nearest the front that is shown and not modal; null when there is none */
  getFirstFrontModalDlg(): CKTDGUIDialog | null {
    let found: CKTDGUIDialog | null = null;
    this.walkBackwardPlain((dialog) => {
      if (!(dialog.m_bShow && !dialog.m_bModal)) return false;
      found = dialog;
      return true;
    });
    return found;
  }

  /** a walk from the front with no walk pushed (the exe's loops of `GetFirstFrontModalDlg`, `GetCloseDialogByESC` and `OnFrameRenderTopModal` keep their position in a local) */
  private walkBackwardPlain(visit: (dialog: CKTDGUIDialog) => boolean): void {
    const head = this.m_listDialog.head;
    for (let n = head.prev; n !== head; n = n.prev) if (visit(n.value!)) return;
  }

  /**
   * `GetCloseDialogByESC()` (328DE690): the dialog the Escape key closes, null when there is none.  From the front: a dialog named `DLG_MsgBox`
   * is passed; an OK / Cancel message box (`m_bOKAndCancelMsgBox`) or one named `DLG_OKMsgBox` that is shown is the answer, and the input is
   * enabled (`m_pDIManager->m_bEnabled`); a shown, enabled dialog with a close event is the answer; a shown, enabled dialog that is not
   * modal ends the search with null.
   */
  getCloseDialogByESC(): CKTDGUIDialog | null {
    let found: CKTDGUIDialog | null = null;
    this.walkBackwardPlain((dialog) => {
      if (dialog.m_Name === "DLG_MsgBox") return false;
      if (dialog.m_bOKAndCancelMsgBox || dialog.m_Name === "DLG_OKMsgBox") {
        if (dialog.m_bShow) {
          dialog.ctx.diManager.m_bEnabled = true;
          found = dialog;
          return true;
        }
      }
      if (dialog.m_bShow && dialog.m_bEnable && dialog.m_CloseCustomUIEventID !== -1) {
        found = dialog;
        return true;
      }
      return dialog.m_bShow && dialog.m_bEnable && !dialog.m_bModal;
    });
    return found;
  }

  /** `GetFocusInEditBox()` (328DEF20): the control with the keyboard focus is an edit box or an IME edit box */
  getFocusInEditBox(): boolean {
    const focus = this.ctx.controlFocus;
    if (focus === null) return false;
    return focus.m_ControlType === UCT.IME_EDITBOX || focus.m_ControlType === UCT.EDITBOX;
  }

  /** `IsDraggingDialog()` (328DEF60): a dialog that is shown, enabled and can be moved by dragging is being dragged */
  isDraggingDialog(): boolean {
    for (const d of this.m_listDialog) if (d.m_bShow && d.m_bEnable && d.m_bEnableMoveByDrag && d.m_bMouseDownForDrag) return true;
    return false;
  }

  /** `SetStage(pStage)` (328E0B60): every dialog of the list belongs to the stage */
  setStage(stage: unknown): void {
    for (const d of this.m_listDialog) d.m_pStage = stage;
  }

  // ---- the frame ----------------------------------------------------------------------------------------------------------------

  /**
   * `OnFrameMove(fTime, fElapsedTime)` (328DF0E0).  First the dialogs that are marked for deletion (`m_bCheckAutoDeleteEnd`) leave the list and the
   * manager (when the manager knows them) and are destroyed.  Then, with the dialogs shown (or the layer one that cannot be hidden), the
   * dialogs that are enabled and shown move from the front to the back, each after its name is put in the log as the last error
   * (`g_CKTDXLog.SetLastErrorLog`); with the layer hidden the dialogs named `DLG_ChatBox_EditBox`, `DLG_MsgBox`, `DLG_OKMsgBox` and
   * `OkAndCancelMsgBox` move (`GetDialog`, in that order, each if it is there).  Returns 0.
   */
  onFrameMove(fTime: number, fElapsedTime: number): number {
    this.walkForward((dialog) => {
      if (!dialog.m_bCheckAutoDeleteEnd) return;
      if (this.checkDlg(dialog)) {
        this.removeFromDialogList(dialog);
        dialog.m_pkUIDialogManager = null;
      }
      this.destroy(dialog);
    });
    if (!this.m_bCanHide || this.m_bShow) {
      if (this.m_listDialog.size !== 0) {
        this.walkBackward((dialog) => {
          if (dialog.m_bEnable && dialog.m_bShow) {
            dialog.ctx.devices.massFiles.log.setLastErrorLog(dialog.m_Name);
            dialog.onFrameMove(fTime, fElapsedTime);
          }
          return false;
        });
      }
    } else {
      for (const name of HIDDEN_LAYER_DIALOGS) {
        const dialog = this.getDialog(name);
        if (live(dialog)) dialog.onFrameMove(fTime, fElapsedTime);
      }
    }
    return 0;
  }

  /**
   * `OnFrameRender(bFront)` (328DFE30).  A manager that cannot hide and is not shown draws nothing; one that can hide and is not shown draws
   * the dialogs named `DLG_ChatBox_EditBox`, `DLG_MsgBox`, `DLG_OKMsgBox` and `OkAndCancelMsgBox` (`GetDialog`, in that order) that are shown.
   * Otherwise every dialog whose `m_bFront` is `bFront` and that is shown is drawn from the back to the front, then the guide text's static of each of
   * those dialogs that has one (`m_pStaticGuideDesc`: its own `OnFrameRender`, with the states the caller left), then for `bFront`
   * the slot being dragged.  Returns 0.
   */
  onFrameRender(bFront: boolean): number {
    if (!this.m_bCanHide) {
      if (!this.m_bShow) return 0;
    } else if (!this.m_bShow) {
      for (const name of HIDDEN_LAYER_DIALOGS) {
        const dialog = this.getDialog(name);
        if (live(dialog) && dialog.m_bShow) dialog.onFrameRender(false);
      }
      return 0;
    }
    this.walkForwardTwice(
      (dialog) => {
        if (dialog.m_bFront === bFront && dialog.m_bShow) dialog.onFrameRender(false);
      },
      (dialog) => {
        if (dialog.m_bFront === bFront && dialog.m_bShow && dialog.m_pStaticGuideDesc !== null) dialog.m_pStaticGuideDesc.onFrameRender();
      },
    );
    if (CKTDGUISlot.s_pDragSlot !== null && bFront) CKTDGUISlot.s_pDragSlot.renderDragSlot();
    return 0;
  }

  /** the two passes of `OnFrameRender` over the one position in `m_vecIterator`: the second starts again at the beginning of the list as it is then */
  private walkForwardTwice(first: (dialog: CKTDGUIDialog) => void, second: (dialog: CKTDGUIDialog) => void): void {
    const walks = this.m_vecIterator;
    const head = this.m_listDialog.head;
    walks.push(head.next);
    try {
      while (walks[walks.length - 1] !== head) {
        const node = walks[walks.length - 1]!;
        walks[walks.length - 1] = node.next;
        first(node.value!);
      }
      walks[walks.length - 1] = head.next;
      while (walks[walks.length - 1] !== head) {
        const node = walks[walks.length - 1]!;
        walks[walks.length - 1] = node.next;
        second(node.value!);
      }
    } finally {
      walks.pop();
    }
  }

  /** `OnFrameRenderTopModal()` (328E0910): unless the layer is hidden, the dialog nearest the front that is enabled, shown and not modal is drawn.  Returns 0. */
  onFrameRenderTopModal(): number {
    if (!this.m_bCanHide || this.m_bShow) {
      this.walkBackwardPlain((dialog) => {
        if (!(dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal)) return false;
        dialog.onFrameRender(false);
        return true;
      });
    }
    return 0;
  }

  /**
   * `ExistDialogAtMousePos()` (328DE620): some dialog the manager owns has a control under the mouse (`GetControlMouseOver`); a dialog that
   * is gone (its handle no longer resolves) is passed over.
   */
  existDialogAtMousePos(): boolean {
    for (const dialog of this.m_setDialog) {
      if (live(dialog) && dialog.getControlMouseOver() !== null) return true;
    }
    return false;
  }

  /**
   * `MsgProc(hWnd, uMsg, wParam, lParam)` (328DEFD0): the dialogs are asked from the front to the back (`CKTDGUIDialog::MsgProc`) until one
   * takes the message (true); a dialog that is enabled, shown and not modal that does not stops the walk with false.  After the left or
   * the right mouse button went up a dragged slot is given back.
   */
  MsgProc(hWnd: unknown, uMsg: number, wParam: number, lParam: number): boolean {
    if (this.m_listDialog.size === 0) return false;
    let taken = false;
    this.walkBackward((dialog) => {
      if (dialog.msgProc(hWnd, uMsg, wParam, lParam)) {
        taken = true;
        return true;
      }
      // the dialog may have destroyed itself: its handle then reaches the null object, which is modal
      return live(dialog) && dialog.m_bEnable && dialog.m_bShow && !dialog.m_bModal;
    });
    if (CKTDGUISlot.s_pDragSlot !== null && (uMsg === WM_LBUTTONUP || uMsg === WM_RBUTTONUP)) CKTDGUISlot.returnDraggingItem();
    return taken;
  }
}
