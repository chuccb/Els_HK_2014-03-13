/**
 * `CKTDGUIDialogManager` (`g_pKTDXApp->m_pDGManager->m_pDialogManager`) as far as the controls and the dialogs ask of it.  The rest of the
 * class (`AddDlg`, `DeleteDlg`, the layers, `OnFrameMove` / `OnFrameRender` of the whole list) is not ported yet, so the list of dialogs is
 * empty unless a test fills it: every dialog a script opens is one the manager does not know (`m_pkUIDialogManager` is null).
 *
 * Constructor (328DD5F0): `m_bShow = true`, `m_bCanHide = false`.  `GetHideDialog()` (328DEF40) is `m_bCanHide && !m_bShow`: with a hidden
 * dialog layer `CKTDGUIDialog::OnFrameRender` draws only the chat box's edit box.
 */
import type { CKTDGUIDialog } from "./dialog.ts";

export class CKTDGUIDialogManager {
  m_bShow = true;
  m_bCanHide = false;
  /** `m_setDialog`: the handles of the dialogs the manager owns (a `std::set`; here the dialogs) */
  readonly m_setDialog = new Set<CKTDGUIDialog>();
  /** `m_listDialog`: the dialogs in the order they were added, the last being the front one (a `std::list`) */
  readonly m_listDialog: CKTDGUIDialog[] = [];
  /** `m_iModalDialogCount`: the shown dialogs that are not modal and have no slot (`CountModalDialog`) */
  m_iModalDialogCount = 0;

  /** `GetHideDialog()` */
  getHideDialog(): boolean {
    return this.m_bCanHide && !this.m_bShow;
  }

  /** `CheckDlg(pDialogToCheck)` (328DE0F0): the dialog is not null, is in the manager's set, and knows a manager */
  checkDlg(dialog: CKTDGUIDialog | null): boolean {
    return dialog !== null && this.m_setDialog.has(dialog) && dialog.m_pkUIDialogManager !== null;
  }

  /**
   * `CheckFrontModalDlg(pPivotDialog)` (328DE180): true when a dialog in front of the pivot (the list is walked from the front one
   * backwards) is shown, enabled and not modal; false when the pivot comes first, when the list is empty, or when the manager does not
   * know the pivot (`CheckDlg`).
   */
  checkFrontModalDlg(pivot: CKTDGUIDialog | null): boolean {
    if (!this.checkDlg(pivot)) return false;
    for (let i = this.m_listDialog.length - 1; i >= 0; i--) {
      const dialog = this.m_listDialog[i]!;
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
}
