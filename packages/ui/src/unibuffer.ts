/**
 * `CKTDGUIUniBuffer`: the text of an edit box (DXUT's `CUniBuffer`) with the limits the game added: a length limit, a byte limit, a width
 * and a line limit, and the modes that let only digits, only digits and letters, or one character through.  Constructor 32963A70,
 * Clear 32964210, SetBufferSize 32965870, SetText 329659E0, SetHideChar 329659C0, CPtoX 32963BA0, XtoCP 32965CC0.
 *
 * The buffer is a pair of `wchar_t` arrays in the exe (the text and the text with the hide character); here the text is a string and the
 * capacity (`m_nBufferSize`, in characters) is a number, which is all the limits look at.  The text layout (`CPtoX`, `XtoCP`, the line
 * functions) measures with the font (`m_pFontNode`); a buffer without a font answers the way the exe does, and one with a font needs the
 * font manager, which is not ported.
 */
import type { UKFont } from "./font.ts";

/** where the buffer reports its errors (the exe's `g_CKTDXLog.PushErrorLog`) */
export interface UniBufferLog {
  push(id: number, text?: string): void;
}

export class CKTDGUIUniBuffer {
  /** capacity in characters (the terminating NUL included) */
  m_nBufferSize = 0;
  m_nLengthLimit = 0xffff;
  m_bOneCharMode = false;
  /** the text (the characters before the NUL of `m_pwszBuffer`); null while no buffer is allocated */
  m_pwszBuffer: string | null = null;
  m_bOnlyNumMode = false;
  m_WidthLimit = 99999;
  m_LineLimit = 99999;
  m_bOnlyNumAndEnglishMode = false;
  m_bCheckEnglishBigAndSmall = false;
  m_bBigEnglish = true;
  m_bByteLimit = false;
  m_ByteLimit = 0;
  m_bAutoChangeBigEnglish = false;
  m_cHideChar = 0;
  m_bUseHideChar = false;
  m_pFontNode: UKFont | null = null;
  m_bAnalyseRequired = true;

  constructor(private readonly log: UniBufferLog, nInitialSize: number) {
    if (nInitialSize > 0) this.SetBufferSize(nInitialSize);
  }

  /**
   * `SetBufferSize(nNewSize)` (32965870): grows the capacity, to twice the request (twice the old size for -1, 256 for the first
   * allocation), at most 0xFFFF.  A buffer that is at the maximum already is error log 0x27.
   */
  SetBufferSize(nNewSize: number): boolean {
    if (this.m_nBufferSize === 0xffff) {
      this.log.push(0x27);
      return false;
    }
    let size = 2 * this.m_nBufferSize;
    if (nNewSize === -1 || nNewSize < size) {
      if (this.m_nBufferSize !== 0) {
        if (size > 0xffff) size = 0xffff;
      } else size = 256;
    } else {
      size = 2 * nNewSize;
      if (size > 0xffff) size = 0xffff;
    }
    this.m_nBufferSize = size;
    if (this.m_pwszBuffer === null) this.m_pwszBuffer = "";
    return true;
  }

  /** `SetText(wszText)` (329659E0): false when the text is too long for the limits (the buffer is left as it was) */
  SetText(text: string): boolean {
    const nz = text.indexOf("\0");
    const wsz = nz < 0 ? text : text.slice(0, nz); // wcslen
    const need = wsz.length + 1;
    if (need >= 0xffff || need > this.m_nLengthLimit + 1 || (this.m_bOneCharMode && need >= 3)) return false;
    if (this.m_nBufferSize < need) while (this.SetBufferSize(-1) && this.m_nBufferSize < need);
    if (this.m_nBufferSize < need) return false;
    this.m_pwszBuffer = wsz.slice(0, this.m_nBufferSize - 1); // StringCchCopyW: at most capacity - 1 characters and the NUL
    this.m_bAnalyseRequired = true;
    return true;
  }

  /** `Clear()` (32964210): `*m_pwszBuffer = 0` (the exe dereferences a buffer that was never allocated) */
  Clear(): void {
    if (this.m_pwszBuffer === null) throw new Error("CKTDGUIUniBuffer::Clear: no buffer is allocated; the exe writes through a null pointer");
    this.m_pwszBuffer = "";
    this.m_bAnalyseRequired = true;
  }

  SetHideChar(bUseHideChar: boolean, cHideChar: number): void {
    this.m_bUseHideChar = bUseHideChar;
    this.m_cHideChar = cHideChar;
  }

  /** `GetTextSize()`: `lstrlenW(m_pwszBuffer)` */
  GetTextSize(): number {
    return this.m_pwszBuffer?.length ?? 0;
  }

  /** `CPtoX(nCP, bTrail, &x)` (32963BA0): without a font the x is 0 */
  CPtoX(_nCP: number, _bTrail: boolean): number {
    if (this.m_pFontNode === null) return 0;
    throw new Error("CKTDGUIUniBuffer::CPtoX: measuring text with a font (CUKFont::GetWidth) is not ported");
  }

  /** `XtoCP(nX, &cp, &trail)` (32965CC0): without a font the character position is 0 (and the call reports failure) */
  XtoCP(_nX: number): { cp: number; trail: number } {
    if (this.m_pFontNode === null) return { cp: 0, trail: 0 };
    throw new Error("CKTDGUIUniBuffer::XtoCP: measuring text with a font (CUKFont::GetWidth) is not ported");
  }
}
