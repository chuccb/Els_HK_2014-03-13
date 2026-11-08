/**
 * `CKTDGUIUniBuffer`: the text of an edit box (DXUT's `CUniBuffer`) with the limits the game added: a length limit, a byte limit, a width
 * and a line limit, and the modes that let only digits, only digits and letters, or one character through.  Constructor 32963A70,
 * Clear 32964210, SetBufferSize 32965870, SetText 329659E0, SetHideChar 329659C0, CPtoX 32963BA0, CPtoY 32963E60, GetLineWidth 329648B0,
 * XtoCP 32965CC0.
 *
 * The buffer is a pair of `wchar_t` arrays in the exe (the text and the text with the hide character); here the text is a string and the
 * capacity (`m_nBufferSize`, in characters) is a number, which is all the limits look at.
 *
 * The measuring (`CPtoX`, `CPtoY`, `GetLineWidth`, `XtoCP`) asks the UK font of the box (`m_pFontNode`, set by the box before it draws) for
 * the width and the height of pieces of the text, and divides by the app's resolution scale to get layout pixels; a buffer without a font
 * answers 0.  All of them work on a copy of the text, `std::wstring(m_pwszBuffer, wcslen)`; all but `XtoCP` fill it with the hide character
 * first when the buffer hides its text (so a password's width is that of its mask).  Three of the exe's habits are kept: a trailing
 * line break is counted as a line by `CPtoY` and as part of the line by `GetLineWidth`; `bTrail` is never looked at, so the width up to
 * a character and up to its trailing edge are the same; the HRESULT of `XtoCP` (1 without a font, else 0) is never below 0, so no
 * caller can tell the two apart (the port does not return it).  A buffer that was never allocated is `wcslen(NULL)` in the exe.
 */
import type { UKFont } from "./font.ts";
import { ftoi } from "./rect.ts";

const f = Math.fround;

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

  /**
   * The text the measuring works on: `std::wstring(m_pwszBuffer, wcslen(m_pwszBuffer))`, every character the hide character
   * (`std::fill`) when `m_bUseHideChar`.  A buffer nobody allocated is the exe's `wcslen(NULL)`.
   */
  private measured(): string {
    const text = this.m_pwszBuffer;
    if (text === null) throw new Error("CKTDGUIUniBuffer: no buffer is allocated; the exe measures a null pointer (wcslen)");
    return this.m_bUseHideChar ? String.fromCharCode(this.m_cHideChar).repeat(text.length) : text;
  }

  /** `(int)(float)((float)GetWidth(text) / g_pKTDXApp->m_ResolutionScale.x)`: the width of a text in layout pixels */
  private layoutWidth(font: UKFont, text: string): number {
    return ftoi(f(f(font.GetWidth(text)) / font.scale.x));
  }

  /**
   * `CPtoX(nCP, bTrail, &x)` (32963BA0): the x of character `nCP` in layout pixels, 0 without a font.  Of the first `nCP` characters (an
   * unsigned count, all of the text when it is larger) only what follows the last line break is measured, as one line.  `bTrail` is not
   * looked at.
   */
  CPtoX(nCP: number, bTrail: boolean): number {
    void bTrail;
    const font = this.m_pFontNode;
    if (font === null) return 0;
    let text = this.measured().slice(0, nCP >>> 0);
    const lf = text.lastIndexOf("\n");
    if (lf >= 0) text = text.slice(lf + 1);
    return this.layoutWidth(font, text);
  }

  /**
   * `CPtoY(nCP, bTrail, &y)` (32963E60): the y of character `nCP` in layout pixels, 0 without a font: the height of the text after the
   * last line break among the first `nCP` characters (one line, in layout pixels) times the number of line breaks.  The count stops at a
   * line break that is the last character (it is counted, the text it ends is what is measured, without it).  `bTrail` is not looked at.
   */
  CPtoY(nCP: number, bTrail: boolean): number {
    void bTrail;
    const font = this.m_pFontNode;
    if (font === null) return 0;
    let text = this.measured().slice(0, nCP >>> 0);
    let lines = 0;
    let lf = text.indexOf("\n");
    while (lf >= 0) {
      lines++;
      if (text.length - 1 <= lf) break;
      text = text.slice(lf + 1);
      lf = text.indexOf("\n");
    }
    if (text.length !== 0 && text.charCodeAt(text.length - 1) === 10) text = text.slice(0, -1);
    return ftoi(f(f(f(font.GetHeight(text)) / font.scale.y) * f(lines)));
  }

  /**
   * `GetLineWidth(nCP)` (329648B0): the width in layout pixels of the line `nCP` is in (0 without a font): from the character after the
   * last line break before `nCP` (or the start) to the first line break at or after `nCP` (or the end).  The exe takes one character too
   * many when the line starts after a line break and ends at one (the break itself, which is 0 wide).  `nCP` beyond the text is the
   * `std::out_of_range` of `substr` (the exe does not catch it).
   */
  GetLineWidth(nCP: number): number {
    const font = this.m_pFontNode;
    if (font === null) return 0;
    const n = nCP >>> 0;
    const text = this.measured();
    if (text.length < n) throw new RangeError("CKTDGUIUniBuffer::GetLineWidth: invalid string position (std::out_of_range)");
    const last = text.slice(0, n).lastIndexOf("\n");
    const first = text.slice(n).indexOf("\n");
    // the exe cuts the line at `first + n` (the break itself left out) when it starts at the text's start, and one character
    // further (the break included) when it starts after a break
    let line: string;
    if (last < 0) line = first >= 0 ? text.slice(0, n + first) : text;
    else line = first >= 0 ? text.slice(last + 1, n + first + 1) : text.slice(last + 1);
    return this.layoutWidth(font, line);
  }

  /**
   * `XtoCP(nX, &cp, &trail)` (32965CC0): the first character whose end is at or beyond `nX` (layout pixels, turned into the back buffer's
   * by the scale and cut): the widths of the prefixes of the text (the text itself, not the hidden one) are asked of the font one by one;
   * the text's length when none reaches it.  The trail is always 0.  Without a font the answer is 0 (and the call fails, which nobody
   * looks at).
   */
  XtoCP(nX: number): { cp: number; trail: number } {
    const font = this.m_pFontNode;
    if (font === null) return { cp: 0, trail: 0 };
    const text = this.m_pwszBuffer;
    if (text === null) throw new Error("CKTDGUIUniBuffer::XtoCP: no buffer is allocated; the exe measures a null pointer (wcslen)");
    const x = ftoi(f(f(nX) * font.scale.x));
    const size = text.length;
    for (let i = 0; i < size; i++) {
      if (font.GetWidth(text.slice(0, i + 1)) >= x) return { cp: i, trail: 0 };
    }
    return { cp: size, trail: 0 };
  }
}
