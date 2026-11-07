/**
 * `CKTDGUIDialogManager` (`g_pKTDXApp->m_pDGManager->m_pDialogManager`) as far as the drawing code asks of it.  The rest of the class (the
 * dialog list, `CheckFrontModalDlg`, `GetDialog` ...) is not ported yet.
 *
 * Constructor (328DD5F0): `m_bShow = true`, `m_bCanHide = false`.  `GetHideDialog()` (328DEF40) is `m_bCanHide && !m_bShow`: with a hidden
 * dialog layer `CKTDGUIDialog::OnFrameRender` draws only the chat box's edit box.
 */
export class CKTDGUIDialogManager {
  m_bShow = true;
  m_bCanHide = false;

  /** `GetHideDialog()` */
  getHideDialog(): boolean {
    return this.m_bCanHide && !this.m_bShow;
  }
}
