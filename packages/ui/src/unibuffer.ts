/**
 * `CKTDGUIUniBuffer`: the text of an edit box (DXUT's `CUniBuffer`) with the limits the game added: a length limit, a byte limit, a width
 * and a line limit, and the modes that let only digits, only digits and letters, or one character through.  Constructor 32963A70,
 * Clear 32964210, SetBufferSize 32965870, SetText 329659E0, SetHideChar 329659C0, CPtoX 32963BA0, CPtoY 32963E60, GetLineWidth 329648B0,
 * XtoCP 32965CC0, and what edits it: RemoveChar 32965810, InsertChar 329651C0, InsertString 32965480, `operator[]` 32963B80 (`setCharAt`),
 * the measuring that finds a line or a caret position (GetLineCount 329645E0, XYtoCP 32965B30, GetCaretLineMove 32964220) and the
 * word steps of the caret (GetNextItemPos 32964E50, GetPriorItemPos 32964F40).
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
 *
 * The editing: a character goes in only if the modes let it through (digits, digits and letters of the right case, upper case made of
 * every letter), the byte limit (`WideCharToMultiByte(CP_ACP)` of the text, here `ansiLength`) and the length limit leave room, and the
 * width and the line limits are kept (a character that does not fit the width goes on a new line of its own).  The one character mode
 * changes the first character in place and answers "nothing inserted" all the same.  `lstrlenW` of a buffer nobody allocated is 0.
 */
import { ftoi, idiv } from "./rect.ts";

const f = Math.fround;

/** where the buffer reports its errors (the exe's `g_CKTDXLog.PushErrorLog`) */
export interface UniBufferLog {
  push(id: number, text?: string): void;
}

/** what the buffer asks of its font (`CUKFont`): the width and the height of a text, the height of a line, the app's resolution scale */
export interface UniBufferFont {
  GetWidth(text: string): number;
  GetHeight(text: string): number;
  lineHeight(): number;
  readonly scale: { readonly x: number; readonly y: number };
}

/**
 * `WideCharToMultiByte(CP_ACP, 0, text, len, ...)` of `ConvertWCHARToChar` (328AFAB0): how many bytes the text takes in the ANSI code
 * page of the machine.  The model of a double byte code page (the Chinese builds': 950 for Hong Kong): a character below 0x80 is
 * one byte, any other two.
 */
export function ansiLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) n += text.charCodeAt(i) < 0x80 ? 1 : 2;
  return n;
}

/** `towupper` of the C locale (the exe never changes it): only a to z change */
export function towupper(c: number): number {
  return c >= 0x61 && c <= 0x7a ? c - 32 : c;
}

/**
 * `iswdigit` of the UCRT in the C locale: below 256 the table of the locale (the ASCII digits), above what `GetStringTypeW` calls a decimal
 * digit.  Both are the Unicode decimal digits (`Nd`; below 256 only 0 to 9 are), which is all this model knows: it is a model of the Windows
 * tables, nothing of the exe's own code.
 */
export function iswdigit(c: number): boolean {
  return /^\p{Nd}$/u.test(String.fromCharCode(c));
}

/**
 * What the exe makes of an array of `wchar_t`: its text ends at the first NUL (`lstrlenW`, `wcslen`), and what lies behind that is no part of
 * the text (the edits move the NUL along and never read past it).  A NUL that is put into the text (`InsertChar(n, 0)`, `buffer[n] = 0`)
 * therefore cuts the text off there.
 */
export function untilNul(text: string): string {
  const at = text.indexOf("\0");
  return at < 0 ? text : text.slice(0, at);
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
  m_pFontNode: UniBufferFont | null = null;
  m_bAnalyseRequired = true;

  constructor(
    private readonly log: UniBufferLog,
    nInitialSize: number,
    private readonly ansi: (text: string) => number = ansiLength,
  ) {
    if (nInitialSize > 0) this.SetBufferSize(nInitialSize);
  }

  /**
   * `~CKTDGUIUniBuffer` (32963B20): both character arrays (the text and the text with the hide character) are freed and the script string
   * analysis released.  The exe keeps the dangling pointers; here the text is gone (`m_pwszBuffer` null: a buffer that was never allocated).
   */
  Destroy(): void {
    this.m_pwszBuffer = null;
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
    const wsz = untilNul(text);
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
  private layoutWidth(font: UniBufferFont, text: string): number {
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

  /**
   * `std::wstring(m_pwszBuffer, wcslen(m_pwszBuffer))` without the hide character: what the item steps and `XYtoCP` look at (`wcslen(NULL)`
   * for a buffer nobody allocated).
   */
  private plain(): string {
    const text = this.m_pwszBuffer;
    if (text === null) throw new Error("CKTDGUIUniBuffer: no buffer is allocated; the exe measures a null pointer (wcslen)");
    return text;
  }

  /**
   * `GetLineCount(nCP)` (329645E0): 0 without a font, else the number of lines in the first `nCP` characters (an unsigned count, all of the
   * text when it is larger) of the measured text: one more than its line breaks (a line break at the end starts a line that is empty).
   */
  GetLineCount(nCP: number): number {
    if (this.m_pFontNode === null) return 0;
    const text = this.measured().slice(0, nCP >>> 0);
    let lines = 1;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
    return lines;
  }

  /**
   * `GetNextItemPos(nCP, &next)` (32964E50): where Ctrl+Right goes: after the first space that is followed by a character that is no space,
   * looking from `nCP + 1` on (a space as the last character does not count), else the end of the text.  The text is the plain one
   * (the hide character is not looked at).  A start before -1 reads before the text in the exe.
   */
  GetNextItemPos(nCP: number): number {
    const text = this.plain();
    const size = text.length;
    let i = (nCP + 1) | 0;
    if (i < size - 1) {
      if (i < 0) throw new Error("CKTDGUIUniBuffer::GetNextItemPos: reads before the text; the exe reads the memory before the string");
      for (;;) {
        if (text.charCodeAt(i) === 32 && text.charCodeAt(i + 1) !== 32) return i + 1;
        if (++i >= size - 1) return size;
      }
    }
    return size;
  }

  /**
   * `GetPriorItemPos(nCP, &prior)` (32964F40): where Ctrl+Left goes: the nearest character before `nCP` that is no space and follows a
   * space (looking from `nCP - 1` back to 1), else the start of the text.  The plain text; the character just past the end reads the
   * terminating NUL, any further the memory behind the string (an error here).
   */
  GetPriorItemPos(nCP: number): number {
    const text = this.plain();
    const at = (i: number): number => {
      if (i > text.length) throw new Error("CKTDGUIUniBuffer::GetPriorItemPos: reads past the text; the exe reads the memory behind the string");
      return i < text.length ? text.charCodeAt(i) : 0;
    };
    let i = (nCP - 1) | 0;
    if (i <= 0) return 0;
    for (;;) {
      if (at(i) !== 32 && at(i - 1) === 32) return i;
      if (--i <= 0) return 0;
    }
  }

  /**
   * `RemoveChar(nIndex)` (32965810): the character goes and the rest moves up; false for an empty text (a buffer nobody allocated is one) and
   * an index outside it.
   */
  RemoveChar(nIndex: number): boolean {
    const text = this.m_pwszBuffer;
    if (text === null || nIndex < 0 || nIndex >= text.length) return false;
    this.m_pwszBuffer = text.slice(0, nIndex) + text.slice(nIndex + 1);
    this.m_bAnalyseRequired = true;
    return true;
  }

  /**
   * `operator[](n)` (32963B80) used as `buffer[n] = wChar`: the character at `n` is replaced (the box's overwrite mode) and the text is to
   * be analysed again.  `n` is at a character of the text in every use of the box; any other index writes outside the text in the exe.
   */
  setCharAt(n: number, wChar: number): void {
    const text = this.m_pwszBuffer;
    this.m_bAnalyseRequired = true;
    if (text === null || n < 0 || n >= text.length) throw new Error("CKTDGUIUniBuffer::operator[]: a write outside the text; the exe writes through the pointer all the same");
    this.m_pwszBuffer = untilNul(text.slice(0, n) + String.fromCharCode(wChar & 0xffff) + text.slice(n + 1));
  }

  /**
   * `InsertChar(nIndex, wChar)` (329651C0): true when the character was put in at `nIndex`.  In the order of the exe: no index outside the
   * text (or past 0xFFFE characters); the character is made upper case when `m_bAutoChangeBigEnglish`; with `m_bOnlyNumMode` it has to be
   * a digit; with `m_bOnlyNumAndEnglishMode` a digit or a letter (of the case `m_bBigEnglish` names when `m_bCheckEnglishBigAndSmall`,
   * else of either); the one character mode puts it at the first place and answers false (the exe's "nothing was inserted" for a
   * thing that was); then the byte limit (the text already takes that many bytes or more), the length limit (the text is that long
   * already), the width limit (a character that does not fit the line, and is no line break, is preceded by a line break of its own: two
   * `InsertChar`s) and the line limit; the buffer grows when it is full (error 0x2A when it cannot).
   */
  InsertChar(nIndex: number, wChar: number): boolean {
    if (nIndex < 0) return false;
    if (nIndex > this.GetTextSize()) return false;
    if (this.GetTextSize() + 1 >= 0xffff) return false;
    const c = this.m_bAutoChangeBigEnglish ? towupper(wChar) : wChar;
    if (this.m_bOnlyNumMode && !iswdigit(c)) return false;
    if (this.m_bOnlyNumAndEnglishMode && !iswdigit(c)) {
      if (this.m_bCheckEnglishBigAndSmall) {
        if (((c - (this.m_bBigEnglish ? 65 : 97)) >>> 0) > 0x19) return false;
      } else if ((c < 0x41 || c > 0x5a) && ((c - 97) >>> 0) > 0x19) return false;
    }
    if (this.m_bOneCharMode) {
      if (this.m_nBufferSize > 2 || this.SetBufferSize(-1)) {
        const text = this.m_pwszBuffer ?? "";
        this.m_pwszBuffer = untilNul(String.fromCharCode(c & 0xffff) + text.slice(1));
        this.m_bAnalyseRequired = true;
        return false;
      }
      this.log.push(0x2a, "out of memory");
      return false;
    }
    if (this.m_bByteLimit && this.m_ByteLimit <= this.ansi(this.m_pwszBuffer ?? "")) return false;
    if (this.GetTextSize() >= this.m_nLengthLimit) return false;
    const lineWidth = this.GetLineWidth(nIndex);
    if (c === 10 || lineWidth < this.m_WidthLimit) {
      const lineCount = this.GetLineCount(this.GetTextSize());
      if (lineCount > this.m_LineLimit || (c === 10 && lineCount >= this.m_LineLimit)) return false;
      if (this.GetTextSize() + 1 >= this.m_nBufferSize && !this.SetBufferSize(-1)) {
        this.log.push(0x2a, "out of memory");
        return false;
      }
      const text = this.m_pwszBuffer ?? "";
      this.m_pwszBuffer = untilNul(text.slice(0, nIndex) + String.fromCharCode(c & 0xffff) + text.slice(nIndex));
      this.m_bAnalyseRequired = true;
      return true;
    }
    this.InsertChar(nIndex, 10);
    this.InsertChar(nIndex + 1, c);
    return true;
  }

  /**
   * `InsertString(nIndex, pStr, nCount)` (32965480): the first `nCount` characters of `pStr` (all of its text for -1) go in at `nIndex`;
   * false and nothing changed when `nIndex` is past the end, the text would reach 0xFFFF, the length limit (which is `m_nLengthLimit + 1`
   * here, unlike `InsertChar`'s), the line the index is in is as wide as the width limit allows already, the text has more lines than the line limit
   * allows, the byte limit would be crossed (the bytes of the whole of `pStr` count, whatever `nCount` is) or the one character mode
   * would get a second character; the buffer grows to take them (error 0x28 or 0x27 are `SetBufferSize`'s).  `m_bAutoChangeBigEnglish`
   * makes the inserted text upper case.  The text of `pStr` ends at its first NUL (`wcslen`); a count beyond that (or below -1) makes the
   * exe copy what lies behind the string, which is an error here (every caller of the exe passes -1).
   */
  InsertString(nIndex: number, pStr: string, nCount: number): boolean {
    const len = this.GetTextSize();
    if (nIndex > len) return false;
    const source = untilNul(pStr);
    const count = nCount === -1 ? source.length : nCount;
    const ins = this.m_bAutoChangeBigEnglish ? source.split("").map((ch) => String.fromCharCode(towupper(ch.charCodeAt(0)))).join("") : source;
    if (count + len >= 0xffff) return false;
    if (len + count > this.m_nLengthLimit + 1) return false;
    if (this.GetLineWidth(nIndex) >= this.m_WidthLimit) return false;
    if (this.GetLineCount(len) > this.m_LineLimit) return false;
    if (this.m_bByteLimit && this.m_ByteLimit < this.ansi(ins) + this.ansi(this.m_pwszBuffer ?? "")) return false;
    if ((this.m_bOneCharMode && len + count >= 3) || (len + count >= this.m_nBufferSize && !this.SetBufferSize(count + 1 + len))) return false;
    if (nIndex < 0) throw new Error("CKTDGUIUniBuffer::InsertString: an index before the text; the exe moves and writes the memory before the buffer");
    if (count < 0 || count > source.length) throw new Error("CKTDGUIUniBuffer::InsertString: a count that is not within the string; the exe copies from behind its end (or by a negative size)");
    const text = this.m_pwszBuffer ?? "";
    this.m_pwszBuffer = text.slice(0, nIndex) + ins.slice(0, count) + text.slice(nIndex);
    this.m_bAnalyseRequired = true;
    return true;
  }

  /**
   * `XYtoCP(nX, nY, &cp, &trail)` (32965B30): the character at a point of the box, in layout pixels: the characters are looked at one
   * by one (`CPtoX`, `CPtoY`); the first one on the line of `nY` (its top at or above `nY`, `nY` at most a line height + 1 below it) whose
   * x is right of `nX` gives the character before it, one whose line is left behind the last one on the line; with none the last
   * character of the text.  A point left of the first character of the line is the one before it (-1 for the first line).  The
   * trail is 0.  An empty text is character 0, without a font the result is 0.  The line height divides by the font's `m_EnlargeNum`
   * (zero is a divide error).
   */
  XYtoCP(nX: number, nY: number): { cp: number; trail: number } {
    const font = this.m_pFontNode;
    if (font === null) return { cp: 0, trail: 0 };
    const size = this.plain().length;
    let onLine = false;
    let rx = 0;
    for (let i = 0; i < size; i++) {
      const tx = this.CPtoX(i, false);
      const ty = this.CPtoY(i, false);
      if (nY > ((ty + font.lineHeight()) | 0) || nY < ty) {
        if (onLine) return { cp: rx, trail: 0 };
      } else {
        onLine = true;
        if (nX < tx) return { cp: i - 1, trail: 0 };
        rx = i;
      }
    }
    return { cp: size === 0 ? 0 : size - 1, trail: 0 };
  }

  /**
   * `GetCaretLineMove(nCP, stepLine)` (32964220): the caret position `stepLine` lines below (above for a negative step) the one `nCP` is
   * in, in the same column (cut at the end of that line); -1 when there is no such line or no font.  A line is the characters from
   * after a line break to the next one (that position included: the end of a line is the position of its line break; the last line
   * ends at the end of the text); an `nCP` that is in none (past the end, or negative) is taken for a position of the first line.  The
   * exe keeps the lines in two arrays of 2000.
   */
  GetCaretLineMove(nCP: number, stepLine: number): number {
    if (this.m_pFontNode === null) return -1;
    const text = this.measured();
    const len = this.GetTextSize();
    const begin = [0];
    const end: number[] = [];
    let last = 0;
    for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) {
      if (last + 1 >= 2000) throw new Error("CKTDGUIUniBuffer::GetCaretLineMove: more than 2000 lines; the exe writes behind its arrays on the stack");
      end[last] = i;
      begin[last + 1] = i + 1;
      last++;
    }
    end[last] = len;
    let line = 0;
    for (let k = 0; k <= last; k++) {
      if (begin[k] <= nCP && end[k] >= nCP) {
        line = k;
        break;
      }
    }
    const col = (nCP - begin[line]) | 0;
    const target = (line + stepLine) | 0;
    if (target < 0 || target > last) return -1;
    return Math.min(end[target], (col + begin[target]) | 0);
  }
}
