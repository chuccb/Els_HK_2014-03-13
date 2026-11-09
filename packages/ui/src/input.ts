/**
 * The keyboard as the controls see it: `g_pKTDXApp->m_pDIManager->m_KTDIKeyboard`, a `CKTDIDevice` (DirectInput) of type 1.
 *
 * `m_State` is the 256 bytes DirectInput fills in (the high bit set: the key is down, so a signed byte is negative) and `m_Locks` the
 * per-key lock that makes a press answer once: `GetKeyState(Num)` (32962CF0) is 0 for a key that is up or already locked, and otherwise
 * locks the key and answers 1.  `Read` (32962ED0) polls DirectInput every frame and, for a keyboard, clears the lock of every key that is
 * up (`unlockReleasedKeys`); the poll itself (and the mouse and joystick halves of the class) is not ported: a test, or later the host,
 * puts the key states in `m_State`.
 */
export class UIKeyboard {
  readonly m_State = new Int8Array(256);
  readonly m_Locks = new Uint8Array(256);

  /**
   * `GetKeyState(Num)` (32962CF0): 1 once for a key that went down, 0 otherwise.  `Num` is an `unsigned __int8` in the exe (the callers pass
   * DirectInput scan codes such as 0x1C, Enter), so `& 0xff` is the width of that parameter.
   */
  getKeyState(num: number): number {
    const n = num & 0xff;
    if (this.m_State[n]! >= 0 || this.m_Locks[n] !== 0) return 0;
    this.m_Locks[n] = 1;
    return 1;
  }

  /** the lock loop of `Read` (32962ED0, type 1): a key that is up is unlocked */
  unlockReleasedKeys(): void {
    for (let i = 0; i < 256; i++) if (this.m_State[i]! >= 0) this.m_Locks[i] = 0;
  }
}

/**
 * `g_pKTDXApp->m_pDIManager` (`CKTDIManager`, 328CF0E0) as far as the dialogs reach it: `m_bEnabled` (true at construction) says whether the
 * game's input is on; `CKTDGUIDialogManager::GetCloseDialogByESC` turns it on when it finds a message box to close.  The devices
 * (`m_KTDIKeyboard`, `m_KTDIMouse`) are `UIContext.keyboard` and `.mouse`.
 */
export class UIInputManager {
  m_bEnabled = true;
}

/**
 * The mouse as the controls see it: `g_pKTDXApp->m_pDIManager->m_KTDIMouse`, a `CKTDIDevice` of type 2.  `GetXPos` / `GetYPos`
 * (32962E60 / 32962EB0) answer `m_XPos` / `m_YPos` (a joystick, type 3, would first copy its axes): the position in pixels of the back
 * buffer, which `Read` (32962ED0) keeps up from DirectInput every frame.  The poll is not ported: a test, or later the host, puts the
 * position here.
 */
export class UIMouse {
  m_XPos = 0;
  m_YPos = 0;

  /** `GetXPos` (32962E60) */
  GetXPos(): number {
    return this.m_XPos;
  }

  /** `GetYPos` (32962EB0) */
  GetYPos(): number {
    return this.m_YPos;
  }
}
