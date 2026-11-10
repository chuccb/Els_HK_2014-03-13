/**
 * `CKTDGUIIMEEditBox` (the Lua class `CKTDGUIIMEEditBox`, a `CKTDGUIControl`): the single- and multi-line text box with an input method
 * editor (DXUT's `CDXUTIMEEditBox` with the game's limits).  Constructor 32935240, and the Lua setters: SetNormalTex_LUA 32935020,
 * SetDisableTex_LUA 32934BA0, SetNormalPoint_LUA 32934F70, SetDisablePoint_LUA 32934AF0, SetTextPoint_LUA 3293ADE0, SetFont_LUA 32934D40,
 * SetText_LUA 3293AE40 (-> SetText 3293ABF0 -> PlaceCaret 32939B50), the four SetCustomMsg* 328CD0E0 / 328CD140 / 328CD160 / 328CD150,
 * the colour setters 328CE2A0 / 328CDF20 / 328CDE20 / 328CCF90 / 328CD9F0, SetMultiLineOption_LUA 3293AB30, and the one-line setters that
 * write the buffer's limits and modes (328CD200, 328CCEF0, 328CE420, 328CD880, 328CD9A0, 328CD9E0, 328CD9B0, 328CCE40) or the box's
 * (328CD2F0, 328CD480, 328CD7B0).
 *
 * Drawing: `OnFrameRender` 32939580 with `DrawTextW` 32936930, `CalcTextRect` 32936140, `DrawRect` 329364E0 (not the plain edit box's: the
 * rectangle is moved by the text's alignment offset and its width is not scaled), and the two windows of the IME, `RenderComposition`
 * 3293A2F0 (the string being composed) and `RenderCandidateReadingWindow` 32939C50 (the candidates, or the reading).
 *
 * Not ported: what the box does while the game runs (`MsgProc`, the keyboard / mouse / IME handling): that needs the window system and the
 * IME.  The constructor's calls into `imm32.dll` are answered as a window without an IME would, and so is `GetImeId`.
 */
import { D3DTOP, D3DTSS } from "@els/d3d9";
import { Color } from "@els/host";
import type { CKTDGUIIMEEditBox_Methods } from "@els/host";
import { CKTDGUIControl, UCT, UIM, destroyTexture, requestFocus } from "./control.ts";
import type { UIContext, UIPointData, UITextureData } from "./control.ts";
import type { DeviceSound } from "./device.ts";
import type { UKFont } from "./font.ts";
import { byte, channel, d3dColor, ONE_OVER_255, packArgb } from "./d3dcolor.ts";
import { wcslen } from "./freetypefont.ts";
import { DummyImmHost, NoImeHost } from "./imehost.ts";
import type { ImeHost, ImmBytes } from "./imehost.ts";
import { resolutionScale } from "./pick.ts";
import { ftoi, idiv, intersectRect, newRect, offsetRect, ptInRect, setRect } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { VertexUI4 } from "./render.ts";
import { CKTDGUIUniBuffer, untilNul } from "./unibuffer.ts";
import type { UniBufferLog } from "./unibuffer.ts";

const f = Math.fround;

/**
 * `CKTDGUIIMEEditBox::CCandList`: what the IME tells about the candidates (up to ten of them, `awszCandidate[10][256]`), the same as one line
 * (`HoriCand`, a buffer the static initialiser makes with `CKTDGUIUniBuffer(1)`), which of them is selected, and where their window was drawn.
 */
export class CandList {
  readonly awszCandidate: string[] = Array.from({ length: 10 }, () => "");
  readonly HoriCand: CKTDGUIUniBuffer;
  nFirstSelected = 0;
  nHoriSelectedLen = 0;
  dwCount = 0;
  dwSelection = 0;
  dwPageSize = 0;
  nReadingError = 0;
  bShowWindow = false;
  /** the rectangle `RenderCandidateReadingWindow` drew the candidate window in */
  readonly rcCandidate: Rect = newRect();

  constructor(log: UniBufferLog) {
    this.HoriCand = new CKTDGUIUniBuffer(log, 1);
  }
}

/**
 * `CKTDGUIIMEEditBox::CInputLocale` (0x8C bytes): a keyboard layout of the machine (`m_hKL`), the sign or the letters that name it (`m_wszLangAbb`: at most
 * two characters) and the name of its language (`m_wszLang`: at most 63).
 */
export class InputLocale {
  constructor(
    readonly m_hKL: number,
    readonly m_wszLangAbb: string,
    readonly m_wszLang: string,
  ) {}
}

/** the characters of what an `Imm*` call wrote as UTF-16 text (an odd last byte is no character) */
function utf16(data: Uint8Array, bytes: number): string {
  let text = "";
  for (let i = 0; i + 1 < bytes; i += 2) text += String.fromCharCode(data[i]! | (data[i + 1]! << 8));
  return text;
}

/**
 * What the exe makes of `ImmGetCompositionStringW(himc, index, wszCand, 0x200)` for `GCS_COMPSTR` and `GCS_RESULTSTR`: nothing for an answer of no
 * bytes (or an error); else the characters of its first `n & ~1` bytes, up to a NUL (the exe writes the NUL behind them).  An answer of 0x200 bytes or
 * more puts the NUL behind the buffer: the range check of the exe (`__report_rangecheckfailure`) ends the program, the port throws.
 */
function compositionText(host: ImeHost, himc: number, index: number): string | null {
  return compositionString(host.immGetCompositionString(himc, index, 0x200));
}

/** the second half of `compositionText`: what the exe makes of the answer (the hand-over of a character asks for the focus between the two) */
function compositionString(got: ImmBytes): string | null {
  const n = got.result | 0;
  if (n <= 0) return null;
  const bytes = n & -2;
  if (bytes >= 0x200) throw new Error(`CKTDGUIIMEEditBox: the IME's composition string of ${n} bytes does not fit the 512 bytes of the buffer; the exe's range check ends the program`);
  if (got.data.length < bytes) throw new Error(`CKTDGUIIMEEditBox: the host answered ${n} bytes of the composition string and gave ${got.data.length}`);
  return untilNul(utf16(got.data, bytes));
}

/**
 * The statics of `CKTDGUIIMEEditBox` that every box shares: `s_bCreateDeviceCheck`, `s_hImcDef`, `s_bHideCaret`, `s_bEnableImeSystem`
 * and `s_CompString` (the buffer of the composition string, made with no storage and given 256 characters by `Initialize`, 329384B0,
 * the first time a box is built: the part of it that loads `imm32.dll` is not modelled), and what the two windows of the IME draw from: the
 * keyboard layout `s_hklCurrent` (`GetKeyboardLayout`, which `CheckToggleState` 329361B0 reads: 0, as the static is, until an input event of a
 * window brings one), the attributes of the composition string (`s_abCompStringAttr`: 1 is converted and 3 is not converted, the two
 * kinds of text the target clause is drawn for), its caret (`s_nCompCaret`) and the first character of the target clause
 * (`s_nFirstTargetConv`, which `RenderComposition` finds), where `RenderComposition` put the string (`s_ptCompString`: the candidate
 * window goes next to it), the reading string, whether the candidates and the reading are vertical, and the candidate list `s_CandList`.
 */
export class ImeSystem {
  s_bCreateDeviceCheck = false;
  /** `ImmGetContext(hwnd)` of the first box: the default input context (no window, no context: 0) */
  s_hImcDef = 0;
  s_bHideCaret = false;
  s_bEnableImeSystem = false;
  s_bInitialised = false;
  readonly s_CompString: CKTDGUIUniBuffer;
  /** `HKL`: the low word is the language (`0x0404` is Chinese, Taiwan), the low ten bits of it the primary language (4 Chinese, 0x11 Japanese, 0x12 Korean) */
  s_hklCurrent = 0;
  s_bVerticalCand = false;
  s_bShowReadingWindow = false;
  s_bHorizontalReading = false;
  s_nCompCaret = 0;
  s_nFirstTargetConv = 0;
  readonly s_ptCompString = { x: 0, y: 0 };
  readonly s_abCompStringAttr = new Uint8Array(256);
  /** `s_wszReadingString[32]` */
  s_wszReadingString = "";
  readonly s_CandList: CandList;
  /** `s_bInsertOnType`: the composition string goes into the box while it is typed (the Korean IME: `StaticMsgProc` sets it for the layout) */
  s_bInsertOnType = false;
  /** `s_ImeState`: `IMEUI_STATE_OFF` (0), `IMEUI_STATE_ON` (1), `IMEUI_STATE_ENGLISH` (2): what `CheckToggleState` finds the IME doing */
  s_ImeState = 0;
  /** `s_bChineseIME`: the layout is Chinese and an IME */
  s_bChineseIME = false;
  /** `s_aszIndicator[5][3]`: the texts that tell the layout (`En`, 簡, 繁, 가, あ); the first is written for a layout none of the other four is */
  readonly s_aszIndicator = ["En", "\u7b80", "\u7e41", "\uac00", "\u3042"];
  /** `s_wszCurrIndicator`: which of the five is the layout's */
  s_nCurrIndicator = 0;
  /** `s_Locale`: the keyboard layouts `WM_ACTIVATEAPP` found (those of an IME's language, and the others; the first of each language) */
  readonly s_Locale: InputLocale[] = [];
  /** `s_adwCompStringClause[256]`: where the clauses of the composition string begin (`GCS_COMPCLAUSE`) */
  readonly s_adwCompStringClause = new Uint32Array(256);
  /** `lAlt`, `lCtrl`, `lShift`: the `lParam` of the last key-down of each modifier (the function-level statics of `MsgProc`; bit 31 set: no key down) */
  lAlt = 0x80000000 | 0;
  lCtrl = 0x80000000 | 0;
  lShift = 0x80000000 | 0;
  /** `dword_336434A0`: the layout `CheckToggleState` looked at last */
  hklToggle = 0;
  /** `byte_336434A4`: `OnFocusOut` is cancelling the composition (the input context calls back into the box) */
  focusOutBusy = false;
  /** the cache of `GetImeId`: the keyboard layout it was asked for last, and the two ids (`hklPrev`, `dwID[2]`) */
  private hklPrev = 0;
  private readonly dwID: [number, number] = [0, 0];

  /**
   * What the IME calls go to (imehost.ts): the platform's host, which stands for USER32, KERNEL32 and the `imm32.dll` the exe loads.  A platform puts
   * its own here; `uninitialize()` puts the dummies of the imm32 table in front of it.
   */
  host: ImeHost;
  /**
   * `s_hDllImm32 != nullptr`: the imm32 table holds the library's functions.  A world has it from the start (the `LoadLibrary` of `Initialize` is
   * not modelled), so `Uninitialize` has something to let go of in every world.
   */
  private immLoaded = true;

  constructor(log: UniBufferLog, host: ImeHost = new NoImeHost()) {
    this.host = host;
    this.s_CompString = new CKTDGUIUniBuffer(log, 0); // 328776C0
    this.s_CandList = new CandList(log);
  }

  /**
   * `CheckToggleState()` (329361B0): what the keyboard layout is and what the IME does.  `s_hklCurrent` is the layout of the thread; when it is not the
   * layout the last call saw the indicator and `s_bVerticalCand` follow it (a Chinese layout's sublanguage 1 is the traditional one, 2 the simplified,
   * whose candidates are vertical unless the IME has an id; Japanese 0x11 and Korean 0x12 have their own; the others are named by the three letters of
   * their language, the second one in lower case).  Then, always: `s_bChineseIME` (Chinese and an IME) and `s_ImeState` (off without an input
   * context; Chinese: on in the native mode and `ENGLISH` else; the others: on when the IME is open).
   */
  checkToggleState(): void {
    const host = this.host;
    const hkl = host.getKeyboardLayout() | 0;
    this.s_hklCurrent = hkl;
    if (this.hklToggle !== hkl) {
      this.hklToggle = hkl;
      const language = hkl & 0x3ff;
      const sub = (hkl & 0xffff) >>> 10;
      let named = false; // the three letters of the locale name the indicator
      if (language === 4) {
        this.s_bVerticalCand = true;
        if (sub === 1) {
          this.s_nCurrIndicator = 2;
        } else if (sub === 2) {
          this.s_nCurrIndicator = 1;
          this.s_bVerticalCand = this.getImeId(0) === 0;
        } else {
          this.s_nCurrIndicator = 0;
          named = true;
        }
      } else if (language === 17) {
        this.s_nCurrIndicator = 4;
        this.s_bVerticalCand = true;
      } else if (language === 18) {
        this.s_nCurrIndicator = 3;
        this.s_bVerticalCand = false;
      } else {
        this.s_nCurrIndicator = 0;
        named = true;
      }
      if (named) this.s_aszIndicator[this.s_nCurrIndicator] = this.localeIndicator(host.getLocaleAbbreviation(hkl & 0xffff));
    }
    const isIme = host.immIsIME(this.s_hklCurrent);
    this.s_bChineseIME = (this.s_hklCurrent & 0x3ff) === 4 && isIme;
    const himc = host.immGetContext();
    if (himc === 0) {
      this.s_ImeState = 0;
      return;
    }
    if (this.s_bChineseIME) {
      const status = host.immGetConversionStatus(himc);
      if (status === null) throw new Error("CKTDGUIIMEEditBox::CheckToggleState (329361B0): ImmGetConversionStatus failed; the exe reads the mode from a stack variable nobody wrote");
      this.s_ImeState = (status.conversion & 1) === 0 ? 2 : 1;
    } else {
      this.s_ImeState = isIme && host.immGetOpenStatus(himc) ? 1 : 0;
    }
    host.immReleaseContext(himc);
  }

  /**
   * The three letters of a language (`GetLocaleInfoW(.., LOCALE_SABBREVLANGNAME, ..)`) as the indicator shows them: the first as it is, the second in lower
   * case (a C string: a name of one letter has its second character NUL, a failed call has both).
   */
  private localeIndicator(abbreviation: string): string {
    const first = abbreviation.length > 0 ? abbreviation[0]! : "\0";
    const second = abbreviation.length > 1 ? abbreviation[1]!.toLowerCase() : "\0";
    return untilNul(first + second);
  }

  /** `ResetCompositionString()` (3293AA60): no composition string, the caret at 0, no attributes */
  resetCompositionString(): void {
    this.s_nCompCaret = 0;
    this.s_CompString.SetText("");
    this.s_abCompStringAttr.fill(0);
  }

  /**
   * `StaticMsgProc(uMsg, wParam)` (3293AF10), the first thing a dialog asks of a window message: 1 when the IME took it.  Nothing is taken
   * while the IME system is off (`s_bEnableImeSystem`, which a window without an IME never turns on) or for a message above 0x10D.
   * `WM_IME_STARTCOMPOSITION` (0x10D) clears the composition string and hides the caret and is taken.  Nothing else is taken (the answer is 0 for the
   * others) but `WM_INPUTLANGCHANGE` (0x51), whose answer is 1:
   * - `WM_ACTIVATEAPP` (0x1C) of an app that becomes active (`wParam` not 0) writes down the keyboard layouts of the machine (`s_Locale`): the list
   *   starts afresh; each layout (an IME layout, when its primary language is Chinese, Japanese or Korean) whose language (the low 16 bits) is not in the
   *   list yet is added with its indicator (Japanese, Korean, Chinese Traditional and Simplified: those of `s_aszIndicator`; the others: the letters of
   *   the locale) and the name of its language; the first layout whose language is listed already ends the enumeration;
   * - `WM_INPUTLANGCHANGE` finds what the keyboard layout is (`CheckToggleState`); a change of the primary language sets `s_bInsertOnType` for Korean
   *   (and clears it for the others).  The IME's own file (the entry points that show the reading) is not loaded: a layout whose IME has a file is
   *   an Error.
   */
  staticMsgProc(uMsg: number, wParam: number): number {
    const msg = uMsg >>> 0;
    if (!this.s_bEnableImeSystem) return 0; // (the exe also answers 0 for a message above 0x10D before its jump table: the default of the switch does)
    switch (msg) {
      case 0x1c:
        if ((wParam >>> 0) === 0) return 0;
        this.listKeyboardLayouts();
        return 0;
      case 0x51:
        return this.inputLanguageChanged();
      case 0x10d:
        this.resetCompositionString();
        this.s_bHideCaret = true;
        return 1;
      default:
        return 0;
    }
  }

  /** `WM_ACTIVATEAPP` of `StaticMsgProc`: the list of the keyboard layouts (`s_Locale`) */
  private listKeyboardLayouts(): void {
    const host = this.host;
    const count = host.getKeyboardLayoutCount();
    this.s_Locale.length = 0; // ~CGrowableArray: the list starts afresh
    const layouts = host.getKeyboardLayoutList(count);
    if (layouts.length < count) throw new Error(`CKTDGUIIMEEditBox::StaticMsgProc (3293AF10): the host listed ${layouts.length} of its ${count} keyboard layouts; the exe reads the rest from the heap`);
    for (let i = 0; i < count; i++) {
      const hkl = layouts[i]! | 0;
      const language = hkl & 0x3ff;
      if ((language === 4 || language === 0x11 || language === 0x12) && !host.immIsIME(hkl)) continue;
      if (this.s_Locale.some((known) => (known.m_hKL & 0xffff) === (hkl & 0xffff))) return; // (the exe's loop ends there)
      const sub = (hkl & 0xffff) >>> 10;
      let indicator: string;
      let buffer = ""; // the 128 characters the layout's calls write to (zeroed first): the abbreviation stays there when the call for the name fails
      if (language === 17) indicator = this.s_aszIndicator[4]!;
      else if (language === 18) indicator = this.s_aszIndicator[3]!;
      else if (language === 4 && sub === 1) indicator = this.s_aszIndicator[2]!;
      else if (language === 4 && sub === 2) indicator = this.s_aszIndicator[1]!;
      else {
        buffer = untilNul(host.getLocaleAbbreviation(hkl & 0xffff));
        indicator = this.localeIndicator(buffer);
      }
      const name = host.getLocaleLanguage(hkl & 0xffff);
      this.s_Locale.push(new InputLocale(hkl, untilNul(indicator).slice(0, 2), untilNul(name ?? buffer).slice(0, 63))); // (room for 3 and 64 characters with the NUL)
    }
  }

  /** `WM_INPUTLANGCHANGE` of `StaticMsgProc` */
  private inputLanguageChanged(): number {
    const before = this.s_hklCurrent & 0x3ff;
    this.checkToggleState();
    const language = this.s_hklCurrent & 0x3ff;
    if (before !== language) this.s_bInsertOnType = language === 18;
    // (the entry points of the IME's DLL, `_GetReadingString` and `_ShowReadingWindow`, are forgotten: they are never loaded)
    if (this.host.immGetIMEFileName(this.s_hklCurrent) !== "") {
      throw new Error("CKTDGUIIMEEditBox::StaticMsgProc (3293AF10): WM_INPUTLANGCHANGE loads the file of the layout's IME (LoadLibraryA, GetProcAddress), which is not ported");
    }
    return 1;
  }

  /**
   * `GetPrivateReadingString()` (329373A0): what the IME of some Chinese layouts keeps privately as the reading of the composition.  A layout whose IME has
   * no id (GetImeId 0) shows no reading; so does a window without an input context.  Otherwise the private data of the input context
   * (`ImmLockIMC`, the structures of each IME) is read: not ported.
   */
  getPrivateReadingString(): void {
    if (this.getImeId(0) === 0 || this.host.immGetContext() === 0) {
      this.s_bShowReadingWindow = false;
      return;
    }
    throw new Error("CKTDGUIIMEEditBox::GetPrivateReadingString (329373A0): reading the private data of the IME's input context (ImmLockIMC) is not ported");
  }

  /** `CKTDGUIIMEEditBox::Initialize()` (329384B0) */
  initialize(): void {
    if (this.s_bInitialised) return;
    this.s_CompString.SetBufferSize(256);
    this.s_bInitialised = true;
  }

  /**
   * `CKTDGUIIMEEditBox::Uninitialize()` (3293B4B0), which the dialog manager's destructor calls: when `imm32.dll` is loaded its function table holds the
   * `Dummy_*` functions again and the library is freed (`DummyImmHost`); the same for the IME's own DLL (`_GetReadingString`, `_ShowReadingWindow`) and
   * `version.dll` (`_VerQueryValueA`, `_GetFileVersionInfoA`, `_GetFileVersionInfoSizeA`), which this port never loads.  A second call finds nothing
   * loaded.  **Kept**: `s_bInitialised` stays set, so no `Initialize` loads the libraries again.
   */
  uninitialize(): void {
    if (!this.immLoaded) return;
    this.immLoaded = false;
    this.host = new DummyImmHost(this.host);
  }

  /**
   * `GetImeId(uIndex)` (32936EA0): the id of the IME of the keyboard layout (index 0: the layout's language and the IME's version, 1: its
   * revision), cached for the layout it was last asked for; 0 for an index of 2 or more.  The ids come from the version resource of the
   * IME's file, which only three layouts are asked for (0xE0080404, 0xE0090404 and 0xE00E0804, the Chinese phonetic, Chang Jie and Pinyin IMEs:
   * `ImmGetIMEFileNameA`, which the host answers): a window without such an IME has none, so every layout the cache is made for has the ids 0.  An
   * IME that has a file is an Error (CompareStringA and the version resource of the exe's code are not ported).
   */
  getImeId(uIndex: number): number {
    if ((uIndex >>> 0) >= 2) return 0;
    if (this.hklPrev !== this.s_hklCurrent) {
      this.hklPrev = this.s_hklCurrent;
      const hkl = this.s_hklCurrent >>> 0;
      // the three layouts of the Chinese phonetic / Chang Jie / Pinyin IMEs: the exe reads the version resource of the IME's file for their ids
      if ((hkl === 0xe0080404 || hkl === 0xe0090404 || hkl === 0xe00e0804) && this.host.immGetIMEFileName(this.s_hklCurrent) !== "") {
        throw new Error("CKTDGUIIMEEditBox::GetImeId (32936EA0): the version resource of the IME's file (GetFileVersionInfo) is not ported");
      }
      this.dwID[1] = 0;
      this.dwID[0] = 0;
    }
    return this.dwID[uIndex]!;
  }
}


export class CKTDGUIIMEEditBox extends CKTDGUIControl implements Partial<CKTDGUIIMEEditBox_Methods> {
  m_pFont: UKFont | null = null;
  readonly m_NowFontColor = new Color(0, 0, 0, 1);
  readonly m_OutlineColor = new Color(1, 1, 1, 1);
  m_bOutlineCheck = false;
  m_bBGCheck = false;
  m_pNormalTex: UITextureData | null = null;
  m_pDisableTex: UITextureData | null = null;
  m_pNormalPoint: UIPointData | null = null;
  m_pDisablePoint: UIPointData | null = null;
  m_pTextPoint: UIPointData | null = null;
  m_CustomMsgEditBoxChange = -1;
  m_CustomMsgEditBoxEnter = -1;
  m_CustomMsgEditBoxFocusOut = -1;
  m_CustomMsgEditBoxFocusIn = -1;
  m_bIsForceSendCustomMsgChange = false;
  // the colours of the IME's own windows (DXUT's defaults, ARGB)
  m_ReadingColor = 0xbcffffff;
  m_ReadingWinColor = 0x80000000;
  m_ReadingSelColor = 0xffff0000;
  m_ReadingSelBkColor = 0x80505050;
  m_CandidateColor = 0xffc8c8c8;
  m_CandidateWinColor = 0x80000000;
  m_CandidateSelColor = 0xffffffff;
  m_CandidateSelBkColor = 0x809e9e9e;
  m_CompColor = 0xffc8c8ff;
  m_CompWinColor = 0xc6000000;
  m_CompCaretColor = 0xffffffff;
  m_CompTargetColor = 0xffffffff;
  m_CompTargetBkColor = 0xff969696;
  m_CompTargetNonColor = 0xffffff00;
  m_CompTargetNonBkColor = 0xff969696;
  m_nIndicatorWidth = 0;
  readonly m_rcIndicator: Rect = newRect();
  readonly m_Buffer: CKTDGUIUniBuffer;
  readonly m_rcText: Rect = newRect();
  /** seconds between the blinks of the caret: the system's caret blink time times 0.0005 (half of it, in seconds) */
  m_dfBlink: number;
  m_dfLastBlink: number;
  m_bCaretOn = true;
  m_nCaret = 0;
  m_bInsertMode = true;
  m_nSelStart = 0;
  m_nFirstVisible = 0;
  m_TextColor = 0xff000000;
  m_SelTextColor = 0xffffffff;
  m_SelBkColor = 0xff28325c;
  m_CaretColor = 0xff000000;
  m_DefTextAlign = 0xffffffff;
  readonly m_ptTextAlignOffset = { x: 0, y: 0 };
  m_bMouseDrag = false;
  /** `m_Vertex[4]`: the quad of the background */
  readonly m_Vertex = new VertexUI4();
  m_pSndKeyDown: DeviceSound | undefined;
  m_GroupID = -1;
  m_GroupSequence = -1;
  m_bEnablePaste = true;

  constructor(ctx: UIContext) {
    super(ctx);
    this.m_Buffer = new CKTDGUIUniBuffer(ctx.devices.massFiles.log, 1);
    const ime = ctx.ime;
    ime.initialize();
    if (!ime.s_bCreateDeviceCheck) {
      ime.s_hImcDef = 0; // ImmGetContext(DXUTGetHWND()) then ImmReleaseContext
      ime.s_bCreateDeviceCheck = true;
    }
    this.m_ControlType = UCT.IME_EDITBOX;
    this.m_dfBlink = f(f(ctx.devices.caretBlinkTime) * f(0.0005));
    this.m_dfLastBlink = ctx.devices.absoluteTime();
    ime.s_bHideCaret = false;
    ime.s_bEnableImeSystem = true;
    [this.m_pSndKeyDown] = this.openControlSounds(["EditBox_KeyDown"]);
    this.m_bEnablePaste = true;
    this.m_Buffer.Clear();
  }

  /**
   * `~CKTDGUIIMEEditBox` (32935F90), then the control's: the same as the edit box's destructor: the two textures are destroyed (their devices
   * closed), the three points freed, the key sound closed and the text buffer destroyed.
   */
  override Destroy(): void {
    const devices = this.ctx.devices;
    this.m_pNormalTex = destroyTexture(devices, this.m_pNormalTex);
    this.m_pDisableTex = destroyTexture(devices, this.m_pDisableTex);
    this.m_pNormalPoint = null;
    this.m_pDisablePoint = null;
    this.m_pTextPoint = null;
    this.m_pSndKeyDown = this.closeHeldDevice(this.m_pSndKeyDown);
    this.m_Buffer.Destroy();
    super.Destroy();
  }

  /**
   * `OnFrameMove` (32939380): a shown IME edit box runs the control's and, with a background (`m_bBGCheck`), makes its normal (or, disabled, its
   * disabled) point the end point; its current point is that point (or, without a background, its text point).  The text rectangle is the text point's
   * left-top and right-bottom corners, cut to ints, moved by the box's offset.  `m_ptTextAlignOffset` is centred (`m_DefTextAlign` with bit 0)
   * on the text that is visible when it fits in the rectangle: `(int)(width of the point / 2 - visible text width / 2)`, the text measured by
   * `CKTDGUIUniBuffer::CPtoX` with the font the buffer has (the box gives it its font when it draws: 0 before the first frame).  Otherwise
   * the offset is 0.
   */
  override onFrameMove(fTime: number, fElapsedTime: number): number {
    if (!this.m_bShow) return 0;
    super.onFrameMove(fTime, fElapsedTime);
    this.m_fElapsedTime = Math.fround(fElapsedTime);
    let point: UIPointData | null;
    if (this.m_bBGCheck) {
      point = this.m_bEnable ? this.m_pNormalPoint : this.m_pDisablePoint;
      if (!point) throw new Error("CKTDGUIIMEEditBox::OnFrameMove: the box has a background but no point for its state; the exe dereferences null");
      this.m_EndPoint.assign(point);
    } else {
      point = this.m_pTextPoint;
    }
    const text = this.m_pTextPoint;
    if (!point || !text) throw new Error("CKTDGUIIMEEditBox::OnFrameMove: the box has no text point (SetTextPoint); the exe dereferences null");
    this.m_NowPoint.assign(point);
    const x = ftoi(this.m_OffsetPos.x), y = ftoi(this.m_OffsetPos.y);
    const rc = this.m_rcText;
    rc.left = (x + ftoi(text.leftTopPoint.x)) | 0;
    rc.top = (y + ftoi(text.leftTopPoint.y)) | 0;
    rc.right = (x + ftoi(text.rightBottomPoint.x)) | 0;
    rc.bottom = (y + ftoi(text.rightBottomPoint.y)) | 0;
    let offset = 0;
    const align = this.m_DefTextAlign;
    if (align !== 0xffffffff && (align & 1) !== 0) {
      const b = this.m_Buffer;
      const whole = b.CPtoX(b.GetTextSize(), false);
      if (!(whole > ((rc.right - rc.left) | 0))) {
        const end = b.CPtoX(b.GetTextSize(), false);
        const first = b.CPtoX(this.m_nFirstVisible, false);
        const n = this.m_NowPoint;
        offset = ftoi(Math.fround(Math.fround(Math.fround(n.rightTopPoint.x - n.leftTopPoint.x) * 0.5) - Math.fround(Math.fround((end - first) | 0) * 0.5)));
      }
    }
    this.m_ptTextAlignOffset.x = offset;
    this.m_ptTextAlignOffset.y = 0;
    return 0;
  }

  /** the font colour the text is drawn in: each channel is the byte of the packed colour times 1/255 (as a float) */
  private setFontColor(packed: number): void {
    const c = this.m_NowFontColor;
    c.r = f(f((packed >>> 16) & 0xff) * ONE_OVER_255);
    c.g = f(f((packed >>> 8) & 0xff) * ONE_OVER_255);
    c.b = f(f(packed & 0xff) * ONE_OVER_255);
    c.a = f(f((packed >>> 24) & 0xff) * ONE_OVER_255);
  }

  /** `m_pFont->m_pUKFont->m_iFontSize / m_pFont->m_pUKFont->m_EnlargeNum + 1`, the height of a line (the exe dereferences a box without a font) */
  private lineHeight(): number {
    const font = this.m_pFont;
    if (!font) throw new Error("CKTDGUIIMEEditBox: the box has no font (SetFont); the exe dereferences null here");
    return font.lineHeight();
  }

  /** `lstrlenW(m_Buffer.m_pwszBuffer)`: the length of the box's own text (`lstrlenW(NULL)` is 0) */
  private textLength(): number {
    const text = this.m_Buffer.m_pwszBuffer;
    return text === null ? 0 : wcslen(text);
  }

  /**
   * The format a text of the box is measured or drawn with when the box has a default alignment: `m_DefTextAlign` while the whole text fits in the
   * text rectangle (`CPtoX` of its end is not beyond the width), else `format`.  `CalcTextRect` 32936140 and `DrawTextW` 32936930 start with
   * it, and so do the loops of the two windows (with `format` 0x404, or 0x400 for a box of a group).
   */
  private alignedFormat(format: number): number {
    if (this.m_DefTextAlign === 0xffffffff) return format;
    const x = this.m_Buffer.CPtoX(this.textLength(), false);
    return x <= ((this.m_rcText.right - this.m_rcText.left) | 0) ? this.m_DefTextAlign : format;
  }

  /**
   * `CalcTextRect(strText, prcDest, nCount, format)` (32936140): the font's, with the box's default alignment (`m_DefTextAlign`, while the whole
   * text of the box fits in the text rectangle) in place of `format`.  A box without a font calls it through a null pointer: that makes the
   * rectangle of a text it measures nothing of (empty, count 0) empty, and is a crash otherwise (an Error here).
   */
  CalcTextRect(strText: string, prcDest: Rect, nCount: number, format: number): number {
    this.fontCalcTextRect(strText, prcDest, nCount, this.alignedFormat(format));
    return 0;
  }

  /**
   * `CUKFont::CalcTextRect(m_pFont, ...)`, which the two windows of the IME call directly.  A box without a font calls it through a null
   * pointer: that makes the rectangle of a text it measures nothing of (empty, count 0) empty, and is a crash otherwise (an Error here).
   */
  private fontCalcTextRect(strText: string, prcDest: Rect, nCount: number, format: number): void {
    const font = this.m_pFont;
    if (font === null) {
      if (wcslen(strText) !== 0 && nCount !== 0) throw new Error("CKTDGUIIMEEditBox: the box has no font (SetFont); the exe calls CalcTextRect through a null pointer");
      prcDest.left = prcDest.top = prcDest.right = prcDest.bottom = 0;
      return;
    }
    font.CalcTextRect(strText, prcDest, nCount, format);
  }

  /**
   * `DrawTextW(strText, prcDest, nCount, format)` (32936930): the font draws the text (`DrawTextFont`, with the box's font colour and the
   * outline when `m_bOutlineCheck`) in the rectangle moved by the dialog's place plus the box's offset, each cut to whole pixels; the box's
   * default alignment (see `alignedFormat`) replaces `format` while the whole text fits.  A box without a font calls `DrawTextFont` through a
   * null pointer: that returns at once for a text it draws nothing of (empty, count 0), and is a crash otherwise.
   */
  DrawTextW(strText: string, prcDest: Rect, nCount: number, format: number): number {
    const aligned = this.alignedFormat(format);
    const dialog = this.m_pDialog;
    if (!dialog) throw new Error("CKTDGUIIMEEditBox::DrawTextW: the box is in no dialog (the exe's handle answers a null object)");
    const rcScreen: Rect = { left: prcDest.left, top: prcDest.top, right: prcDest.right, bottom: prcDest.bottom };
    offsetRect(rcScreen, ftoi(f(dialog.m_Pos.x + this.m_OffsetPos.x)), ftoi(f(dialog.m_Pos.y + this.m_OffsetPos.y)));
    const font = this.m_pFont;
    if (font === null) {
      if (wcslen(strText) === 0 || nCount === 0) return 0;
      throw new Error("CKTDGUIIMEEditBox::DrawTextW: the box has no font (SetFont); the exe calls DrawTextFont through a null pointer");
    }
    font.DrawTextFont(strText, rcScreen, nCount, this.m_NowFontColor, this.m_bOutlineCheck, this.m_OutlineColor, aligned);
    return 0;
  }

  /**
   * `DrawRect(prcDest, color)` (329364E0): a rectangle of one colour, an untextured quad (the stage's colour and alpha operations are pushed as
   * `SELECTARG2` for the draw: the diffuse colour alone; unlike the plain edit box's, nothing sets them to `MODULATE` before they are popped).
   * The rectangle is moved by `m_ptTextAlignOffset` first.  The **corner** is in the pixels of the back buffer, `(int)(float)((float)(scale * (float)side)
   * + (float)(scale * dialog.m_Pos))`, but the **width and the height are in layout pixels**: `(int)(float)(((float)right + pos) - ((float)left + pos))`
   * with no scale in them (a box of 100 pixels is 100 pixels wide at any resolution: a bug that is kept).  The vertices lie half a pixel up and
   * left, `z` 0.5, `rhw` 1, the UVs 0.
   */
  DrawRect(prcDest: Rect, color: number): number {
    const dialog = this.m_pDialog;
    if (!dialog) throw new Error("CKTDGUIIMEEditBox::DrawRect: the box is in no dialog (the exe's handle answers a null object)");
    const render = this.ctx.render;
    const sx = render ? render.resolutionScale.x : 1, sy = render ? render.resolutionScale.y : 1;
    const x = this.m_ptTextAlignOffset.x, y = this.m_ptTextAlignOffset.y;
    const left = (x + prcDest.left) | 0, right = (x + prcDest.right) | 0;
    const top = (y + prcDest.top) | 0, bottom = (y + prcDest.bottom) | 0;
    const posX = dialog.m_Pos.x, posY = dialog.m_Pos.y;
    const width = ftoi(f(f(f(right) + posX) - f(f(left) + posX)));
    const height = ftoi(f(f(f(bottom) + posY) - f(f(top) + posY)));
    const pixelLeft = ftoi(f(f(sx * f(left)) + f(sx * posX)));
    const pixelTop = ftoi(f(f(sy * f(top)) + f(sy * posY)));
    const x0 = f(f(pixelLeft) - 0.5), x1 = f(f((pixelLeft + width) | 0) - 0.5);
    const y0 = f(f(pixelTop) - 0.5), y1 = f(f((height + pixelTop) | 0) - 0.5);
    const quad = new VertexUI4();
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const;
    for (let i = 0; i < 4; i++) {
      quad.setX(i, corners[i]![0]);
      quad.setY(i, corners[i]![1]);
      quad.setZ(i, 0.5);
      quad.setRhw(i, 1);
      quad.setColor(i, color);
      quad.setU(i, 0);
      quad.setV(i, 0);
    }
    const states = render?.states;
    const top0 = states?.stackPointer ?? 0;
    states?.setTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG2);
    states?.setTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG2);
    this.renderVertex(quad, true);
    states?.popTo(top0);
    return 0;
  }

  /**
   * `OnFrameRender` (32939580): a shown box gives its buffer the box's font, places the caret and draws, in this order:
   * - the background (`m_bBGCheck`): the current point's quad;
   * - the selection, when the caret is not at the selection's start: a rectangle of `m_SelBkColor` from the smaller to the larger of the two x
   *   positions, moved by the text rectangle's left minus the x of the first visible character, cut to the text rectangle.  A box of a group
   *   (`m_GroupID` 0 or more: the lines of one text) has a selection one line high, at the line of the caret: from the text rectangle's top plus
   *   the caret's y to that plus the height of a line (it is not moved by the y of the first visible line, as the caret is);
   * - the text from the first visible character on in `m_TextColor`, in the text rectangle moved back by the box's offset (the format is 4: the
   *   text is centred vertically, 0 for a box of a group);
   * - the selected part again in `m_SelTextColor`, in the selection's rectangle moved by the alignment offset minus the box's offset;
   * - the blink: when `m_dfBlink` seconds have gone since `m_dfLastBlink` the caret toggles and the time is taken again;
   * - the caret (a focused box whose caret is on, unless `s_bHideCaret`): a rectangle of `m_CaretColor`, two pixels wide around the x of the
   *   caret (one in the overwrite mode: the trailing edge is the same x), the height of the text rectangle or, in a group, of one line at the
   *   caret's y minus the first visible line's;
   * - the windows of the IME, for the focused box: the composition string (`RenderComposition`) and then the reading or the candidates.
   * The composition string and the candidate line are given the box's font first.
   */
  override onFrameRender(): number {
    if (!this.m_bShow) return 0;
    const ime = this.ctx.ime;
    const buffer = this.m_Buffer;
    buffer.m_pFontNode = this.m_pFont;
    this.PlaceCaret(this.m_nCaret);
    if (this.m_bBGCheck) {
      this.updateVertex(this.m_Vertex, this.m_NowPoint);
      this.renderVertex(this.m_Vertex, this.m_NowPoint, 1);
    }
    const text = this.m_rcText;
    const grouped = this.m_GroupID >= 0;
    const nXFirst = buffer.CPtoX(this.m_nFirstVisible, false);
    const nCaretX = buffer.CPtoX(this.m_nCaret, false);
    let nCaretY = 0, nYFirst = 0;
    if (grouped) {
      nCaretY = buffer.CPtoY(this.m_nCaret, false);
      nYFirst = buffer.CPtoY(this.m_nFirstVisible, false);
    }
    let nSelStartX = nCaretX;
    if (this.m_nCaret !== this.m_nSelStart) nSelStartX = buffer.CPtoX(this.m_nSelStart, false);
    const rcSelection = newRect();
    if (this.m_nCaret !== this.m_nSelStart) {
      const left = nCaretX <= nSelStartX ? nCaretX : nSelStartX;
      const right = nCaretX <= nSelStartX ? nSelStartX : nCaretX;
      if (!grouped) setRect(rcSelection, left, text.top, right, text.bottom);
      else setRect(rcSelection, left, (text.top + nCaretY) | 0, right, (nCaretY + text.top + this.lineHeight()) | 0);
      offsetRect(rcSelection, (text.left - nXFirst) | 0, 0);
      intersectRect(rcSelection, text, rcSelection);
      this.DrawRect(rcSelection, this.m_SelBkColor);
    }
    this.setFontColor(this.m_TextColor);
    const typed = buffer.m_pwszBuffer ?? "";
    const ox = ftoi(this.m_OffsetPos.x), oy = ftoi(this.m_OffsetPos.y);
    const rcText: Rect = { left: (text.left - ox) | 0, top: (text.top - oy) | 0, right: (text.right - ox) | 0, bottom: (text.bottom - oy) | 0 };
    this.DrawTextW(typed.slice(this.m_nFirstVisible), rcText, -1, (this.m_GroupID >> 31) & 4);
    const caret = this.m_nCaret, selStart = this.m_nSelStart;
    if (caret !== selStart) {
      const dx = ftoi(f(f(this.m_ptTextAlignOffset.x) - this.m_OffsetPos.x));
      const dy = ftoi(f(f(this.m_ptTextAlignOffset.y) - this.m_OffsetPos.y));
      const rcSelected: Rect = {
        left: (dx + rcSelection.left) | 0, top: (dy + rcSelection.top) | 0, right: (dx + rcSelection.right) | 0, bottom: (dy + rcSelection.bottom) | 0,
      };
      const lower = Math.min(caret, selStart);
      const start = this.m_nFirstVisible <= lower ? lower : this.m_nFirstVisible;
      const end = Math.max(caret, selStart);
      this.setFontColor(this.m_SelTextColor);
      this.DrawTextW(typed.slice(start), rcSelected, (end - start) | 0, grouped ? 0 : 4);
    }
    const devices = this.ctx.devices;
    if (devices.absoluteTime() - this.m_dfLastBlink >= this.m_dfBlink) {
      this.m_bCaretOn = !this.m_bCaretOn;
      this.m_dfLastBlink = devices.absoluteTime();
    }
    if (this.m_bHasFocus && this.m_bCaretOn && !ime.s_bHideCaret) {
      const x = (text.left - nXFirst) | 0;
      const rcCaret: Rect = { left: (x + nCaretX - 1) | 0, top: text.top, right: (x + nCaretX + 1) | 0, bottom: text.bottom };
      if (grouped) {
        rcCaret.top = (nCaretY + text.top - nYFirst) | 0;
        rcCaret.bottom = (nCaretY + text.top + this.lineHeight() - nYFirst) | 0;
      }
      if (!this.m_bInsertMode) rcCaret.right = (buffer.CPtoX(this.m_nCaret, true) + text.left - nXFirst) | 0;
      this.DrawRect(rcCaret, this.m_CaretColor);
    }
    ime.s_CompString.m_pFontNode = this.m_pFont;
    ime.s_CandList.HoriCand.m_pFontNode = this.m_pFont;
    if (this.m_bHasFocus) {
      this.RenderComposition(null, this.m_fElapsedTime);
      if (ime.s_bShowReadingWindow) this.RenderCandidateReadingWindow(null, this.m_fElapsedTime, true);
      else if (ime.s_CandList.bShowWindow) this.RenderCandidateReadingWindow(null, this.m_fElapsedTime, false);
    }
    return 0;
  }

  /**
   * `RenderComposition(pd3dDevice, fElapsedTime)` (3293A2F0): the string the IME is composing (`s_CompString`), drawn at the caret of the box in
   * a window of its own colour; neither argument is used.  The string starts at the x of the box's caret (the text rectangle's left minus the first
   * visible character's x plus the caret's: and in a box of a group at the caret's line); when it ends beyond the right side of the text rectangle it
   * starts again at the left side, one line down.  Then it is drawn in pieces, as many characters as `XtoCP` finds room for in the rest of the
   * line: for each a window (`m_CompWinColor`, but not for a Korean layout while the caret is off) and the text in `m_CompColor`.  The target
   * clause is drawn over it a character at a time: those with the attribute 1 (converted) or 3 (not converted) get a background
   * (`m_CompTargetBkColor` or `m_CompTargetNonBkColor`) and their own text colour, and the first of them is remembered in `s_nFirstTargetConv`
   * (-1 when there is none).  At last the caret of the composition string, in `m_CompCaretColor`, when the box's caret is on: at the character of
   * `s_nCompCaret` (or at the end of the string), and when it is nowhere on the string as the rectangle (0, 0, 0, 0), drawn all the same.
   * The exe's loop of pieces does not end when not one character fits the whole text rectangle; here that is an Error.
   */
  RenderComposition(pd3dDevice: unknown, fElapsedTime: number): void {
    void pd3dDevice;
    void fElapsedTime;
    const ime = this.ctx.ime;
    const comp = ime.s_CompString;
    const buffer = this.m_Buffer;
    const text = this.m_rcText;
    const grouped = this.m_GroupID >= 0;
    const compText = comp.m_pwszBuffer ?? "";
    const nX = buffer.CPtoX(this.m_nCaret, false);
    const nXFirst = buffer.CPtoX(this.m_nFirstVisible, false);
    let nY = 0, nYFirst = 0;
    if (grouped) {
      nY = buffer.CPtoY(this.m_nCaret, false);
      nYFirst = buffer.CPtoY(this.m_nFirstVisible, false);
    }
    const startX = (text.left - nXFirst + nX) | 0;
    const rc: Rect = { left: startX, top: text.top, right: startX, bottom: text.bottom };
    if (grouped) {
      rc.top = (text.top - nYFirst + nY) | 0;
      rc.bottom = (nY + text.top + this.lineHeight() - nYFirst) | 0;
    }
    let rcCaret: Rect = newRect();
    this.fontCalcTextRect(compText, rc, -1, this.alignedFormat(0x404));
    let right = rc.right;
    let wrapped = false;
    if (rc.right > text.right) {
      offsetRect(rc, (text.left - rc.left) | 0, (rc.bottom - rc.top) | 0);
      wrapped = true;
      right = rc.right;
    }
    ime.s_ptCompString.y = rc.top;
    ime.s_ptCompString.x = rc.left;
    const firstLeft = rc.left, firstTop = rc.top, firstBottom = rc.bottom;
    this.setFontColor(this.m_CompColor);
    const ox = ftoi(this.m_OffsetPos.x), oy = ftoi(this.m_OffsetPos.y);
    let nCount = wcslen(compText);
    let at = 0;
    let secondLine = false;
    let rcTemp: Rect = newRect();
    for (;;) {
      const startLeft = rc.left;
      const { cp } = comp.XtoCP((text.right - rc.left) | 0);
      const length = nCount < cp ? nCount : cp;
      this.fontCalcTextRect(compText.slice(at), rc, length, this.alignedFormat(grouped ? 0x400 : 0x404));
      rcTemp = { left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom };
      if (wrapped) setRect(rcTemp, (rc.left + text.right - rc.right) | 0, (2 * rc.top - rc.bottom) | 0, text.right, rc.top);
      if ((ime.s_hklCurrent & 0x3ff) !== 0x12 || this.m_bCaretOn) this.DrawRect(rcTemp, this.m_CompWinColor);
      const target: Rect = { left: (rcTemp.left - ox) | 0, top: (rcTemp.top - oy) | 0, right: (rcTemp.right - ox) | 0, bottom: (rcTemp.bottom - oy) | 0 };
      this.DrawTextW(compText.slice(at), target, length, (this.m_GroupID >> 31) & 4);
      nCount = (nCount - length) | 0;
      at += length;
      if (nCount <= 0) break;
      if (length === 0 && startLeft === text.left) throw new Error("CKTDGUIIMEEditBox::RenderComposition: not one character of the composition string fits the text rectangle; the exe loops here for ever");
      offsetRect(rc, (text.left - rc.left) | 0, (rc.bottom - rc.top) | 0);
      wrapped = true;
      secondLine = true;
    }
    setRect(rc, firstLeft, firstTop, right, firstBottom);
    rcTemp = { left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom };
    if (wrapped && !secondLine) setRect(rcTemp, (firstLeft + text.right - right) | 0, (2 * firstTop - firstBottom) | 0, text.right, firstTop);
    // the target clause, a character at a time
    let nXFirstAttr = 0;
    ime.s_nFirstTargetConv = -1;
    const attributes = ime.s_abCompStringAttr;
    const compLength = wcslen(compText);
    for (let i = 0; i < compLength; i++) {
      const nXLeft = comp.CPtoX(i, false);
      const nXRight = comp.CPtoX(i, true);
      let left = rc.left, sub = nXFirstAttr;
      if (((nXRight - nXFirstAttr) | 0) > ((text.right - rc.left) | 0)) {
        offsetRect(rc, (text.left - rc.left) | 0, (rc.bottom - rc.top) | 0);
        nXFirstAttr = comp.CPtoX(i, false);
        left = rc.left;
        sub = nXFirstAttr;
      }
      if (ime.s_nCompCaret === i) {
        rcCaret = { left: rcTemp.left, top: rcTemp.top, right: rcTemp.right, bottom: rcTemp.bottom };
        rcCaret.left = (nXLeft - nXFirstAttr + rcTemp.left - 1) | 0;
        rcCaret.right = (nXLeft - nXFirstAttr + rcTemp.left + 1) | 0;
      }
      const attribute = attributes[i]!;
      let background: number;
      if (attribute === 1) {
        this.setFontColor(this.m_CompTargetColor);
        background = this.m_CompTargetBkColor;
      } else if (attribute === 3) {
        this.setFontColor(this.m_CompTargetNonColor);
        background = this.m_CompTargetNonBkColor;
      } else {
        continue;
      }
      const clause: Rect = { left: (nXLeft - nXFirstAttr + left) | 0, top: rc.top, right: (left + nXRight - sub) | 0, bottom: rc.bottom };
      this.DrawRect(clause, background);
      const target: Rect = { left: (clause.left - ox) | 0, top: (rc.top - oy) | 0, right: (clause.right - ox) | 0, bottom: (rc.bottom - oy) | 0 };
      this.DrawTextW(compText.slice(i), target, 1, 4);
      if (ime.s_nFirstTargetConv === -1) ime.s_nFirstTargetConv = i;
    }
    if (this.m_bCaretOn) {
      if (ime.s_nCompCaret === compLength) {
        const x = comp.CPtoX(ime.s_nCompCaret, false);
        rcCaret = { left: rcTemp.left, top: rcTemp.top, right: rcTemp.right, bottom: rcTemp.bottom };
        rcCaret.left = (x - nXFirstAttr + rcTemp.left - 1) | 0;
        rcCaret.right = (rcCaret.left + 2) | 0;
      }
      this.DrawRect(rcCaret, this.m_CompCaretColor);
    }
  }

  /**
   * `RenderCandidateReadingWindow(pd3dDevice, fElapsedTime, bReading)` (32939C50): the window of the candidates (up to 10; `bReading` false) or of
   * the reading (up to 5; the colours of the reading), under the composition string that `RenderComposition` left at `s_ptCompString`.  Neither
   * `pd3dDevice` nor `fElapsedTime` is used.  The colours are `m_Reading*` or `m_Candidate*` (text, window, selected text, selection's background).
   * - `nXComp` is the x in the composition string the window hangs from: 0 for a Taiwan layout (low word 0x0404) whose IME has no id
   *   (`GetImeId(0)`), else the x of `s_nFirstTargetConv` for a Japanese layout (primary language 0x11) and of `s_nCompCaret` for any other.
   * - The window is a line of text (the candidates as one line, `HoriCand`; the reading string) when the layout is not a vertical one or it is the
   *   reading, and the reading is horizontal or it is the candidates: its size is that of the box's `CalcTextRect` of the line (format 0x404).
   *   Otherwise it is a column: `awszCandidate`, each measured (format 0x404, the box's default alignment when the text fits) up to the
   *   first empty one; the width of the widest and the height of the highest, times 5 or 10 (every row, empty ones too).
   * - It sits under the string (`s_ptCompString.y` plus the text rectangle's height) at `s_ptCompString.x + nXComp`; a Chinese layout
   *   (primary language 4) puts it above.  A window beyond the right side of the view port is moved back; one beyond its bottom is tried above
   *   the string, then (when that is above the view port) at the string's end, then left of the string's x, at the top of the view port.
   * - The candidates' window is remembered in `s_CandList.rcCandidate`.  The window is drawn in its colour; a line of text is drawn in
   *   the text colour (the candidates' selected part again over a rectangle of the selection's colours); a column is drawn a row at a time,
   *   each in `rowHeight`, the selected one (`dwSelection`) over a rectangle.
   */
  RenderCandidateReadingWindow(pd3dDevice: unknown, fElapsedTime: number, bReading: boolean): void {
    void pd3dDevice;
    void fElapsedTime;
    const ime = this.ctx.ime;
    const comp = ime.s_CompString;
    const cand = ime.s_CandList;
    const buffer = this.m_Buffer;
    const text = this.m_rcText;
    const rows = bReading ? 5 : 10;
    buffer.CPtoX(this.m_nCaret, false);
    buffer.CPtoX(this.m_nFirstVisible, false);
    const textColor = bReading ? this.m_ReadingColor : this.m_CandidateColor;
    const winColor = bReading ? this.m_ReadingWinColor : this.m_CandidateWinColor;
    const selColor = bReading ? this.m_ReadingSelColor : this.m_CandidateSelColor;
    const selBkColor = bReading ? this.m_ReadingSelBkColor : this.m_CandidateSelBkColor;
    let nXComp: number;
    if ((ime.s_hklCurrent & 0xffff) === 0x404 && ime.getImeId(0) === 0) nXComp = 0;
    else if ((ime.s_hklCurrent & 0x3ff) === 0x11) nXComp = comp.CPtoX(ime.s_nFirstTargetConv, false);
    else nXComp = comp.CPtoX(ime.s_nCompCaret, false);
    const asLine = (!ime.s_bVerticalCand || bReading) && (ime.s_bHorizontalReading || !bReading);
    const horiText = cand.HoriCand.m_pwszBuffer ?? "";
    const rc = newRect();
    let width = 0, rowHeight = 0, total: number;
    if (asLine) {
      this.CalcTextRect(bReading ? ime.s_wszReadingString : horiText, rc, -1, 0x404);
      width = (rc.right - rc.left) | 0;
      rowHeight = total = (rc.bottom - rc.top) | 0;
    } else {
      for (let i = 0; i < rows; i++) {
        const candidate = cand.awszCandidate[i]!;
        if (candidate === "") break;
        setRect(rc, 0, 0, 0, 0);
        this.fontCalcTextRect(candidate, rc, -1, this.alignedFormat(0x404));
        const w = (rc.right - rc.left) | 0, h = (rc.bottom - rc.top) | 0;
        width = width > w ? width : w;
        rowHeight = rowHeight > h ? rowHeight : h;
      }
      total = Math.imul(rows, rowHeight);
    }
    const at = ime.s_ptCompString;
    const viewport = this.ctx.render?.viewport ?? { width: 1024, height: 768 };
    if ((ime.s_hklCurrent & 0x3ff) === 4) {
      setRect(rc, (at.x + nXComp) | 0, (at.y - total) | 0, (nXComp + at.x + width) | 0, at.y);
    } else {
      const top = (at.y + text.bottom - text.top) | 0;
      setRect(rc, (at.x + nXComp) | 0, top, (nXComp + at.x + width) | 0, (top + total) | 0);
    }
    const pullBack = (): void => {
      if (rc.right > viewport.width) {
        rc.left = (rc.left + viewport.width - rc.right) | 0;
        rc.right = viewport.width;
      }
    };
    pullBack();
    if (rc.bottom > viewport.height) {
      setRect(rc, (at.x + nXComp) | 0, (at.y - total) | 0, (nXComp + at.x + width) | 0, at.y);
      pullBack();
      let placed = rc.top >= 0;
      if (!placed) {
        const trail = comp.CPtoX(ime.s_nCompCaret, true);
        setRect(rc, (at.x + trail) | 0, 0, (at.x + trail + width) | 0, total);
        placed = rc.right <= viewport.width;
      }
      if (!placed) {
        setRect(rc, (nXComp + at.x - width) | 0, 0, (at.x + nXComp) | 0, total);
        if (rc.right < 0) {
          rc.left = 0;
          rc.right = width;
        }
      }
    }
    if (!bReading) {
      const keep = cand.rcCandidate;
      keep.left = rc.left;
      keep.top = rc.top;
      keep.right = rc.right;
      keep.bottom = rc.bottom;
    }
    this.DrawRect(rc, winColor);
    if (asLine) {
      this.setFontColor(textColor);
      if (bReading) {
        this.DrawTextW(ime.s_wszReadingString, rc, -1, 4);
        return;
      }
      this.DrawTextW(horiText, rc, -1, 4);
      const nXLeft = cand.HoriCand.CPtoX(cand.nFirstSelected, false);
      const nXRight = cand.HoriCand.CPtoX((cand.nFirstSelected + cand.nHoriSelectedLen) | 0, false);
      rc.right = (rc.left + nXRight) | 0;
      rc.left = (rc.left + nXLeft) | 0;
      this.DrawRect(rc, selBkColor);
      this.setFontColor(selColor);
      this.DrawTextW(horiText.slice(cand.nFirstSelected), rc, cand.nHoriSelectedLen, 4);
      return;
    }
    for (let i = 0; i < rows; i++) {
      rc.bottom = (rowHeight + rc.top) | 0;
      const selected = (cand.dwSelection >>> 0) === i;
      if (selected) this.DrawRect(rc, selBkColor);
      this.setFontColor(selected ? selColor : textColor);
      this.DrawTextW(cand.awszCandidate[i]!, rc, -1, 4);
      rc.top = (rc.top + rowHeight) | 0;
    }
  }

  override textureData(out: UITextureData[]): void {
    for (const t of [this.m_pNormalTex, this.m_pDisableTex]) if (t) out.push(t);
  }

  // ---- the Lua setters ------------------------------------------------------------------------------------------------------

  /** `SetNormalTex_LUA(file, key)` (32935020): the texture of the background; a point that exists is handed it */
  SetNormalTex(fileName: string, key: string): void {
    this.m_pNormalTex = this.replaceTexture(this.m_pNormalTex, fileName, key);
    if (this.m_pNormalPoint) this.m_pNormalPoint.pUITextureData = this.m_pNormalTex;
    this.m_bBGCheck = true;
  }

  /** `SetDisableTex_LUA(file, key)` (32934BA0) */
  SetDisableTex(fileName: string, key: string): void {
    this.m_pDisableTex = this.replaceTexture(this.m_pDisableTex, fileName, key);
    if (this.m_pDisablePoint) this.m_pDisablePoint.pUITextureData = this.m_pDisableTex;
    this.m_bBGCheck = true;
  }

  /** `SetNormalPoint_LUA()` (32934F70): the point is read from the table on the Lua stack; with a normal texture it is that texture's size */
  SetNormalPoint(): void {
    this.m_pNormalPoint = this.pointOf(this.m_pNormalTex);
    this.m_bBGCheck = true;
  }

  /** `SetDisablePoint_LUA()` (32934AF0) */
  SetDisablePoint(): void {
    this.m_pDisablePoint = this.pointOf(this.m_pDisableTex);
    this.m_bBGCheck = true;
  }

  /** a background point: the texture, when there is one, is drawn at its own size unless the table says otherwise */
  private pointOf(tex: UITextureData | null): UIPointData {
    const p = this.makePoint(null);
    if (tex) {
      p.pUITextureData = tex;
      p.applyTextureSize();
    }
    return p;
  }

  /** `SetTextPoint_LUA()` (3293ADE0): the rectangle the text is drawn in (corners cut to whole pixels) */
  SetTextPoint(): void {
    const p = this.makePoint(null);
    this.m_pTextPoint = p;
    this.m_rcText.left = Math.trunc(p.leftTopPoint.x);
    this.m_rcText.top = Math.trunc(p.leftTopPoint.y);
    this.m_rcText.right = Math.trunc(p.rightBottomPoint.x);
    this.m_rcText.bottom = Math.trunc(p.rightBottomPoint.y);
  }

  /** `SetFont_LUA(fontIndex)` (32934D40): the UK font the dialog manager maps the index to (none for an index it does not know) */
  SetFont(nFontIndex: number): void {
    this.m_pFont = this.ctx.fonts.getMappedUKFont(nFontIndex);
  }

  /** `SetText_LUA(text)` (3293AE40): `SetText(text, false)` */
  SetText(text: string | undefined): void {
    this.setText(text ?? "", false);
  }

  /**
   * `SetText(wszText, bSelected)` (3293ABF0): the text is cut to the byte limit (when there is one) or the length limit, put in the buffer,
   * and the caret placed after it (or the whole text selected).
   */
  setText(text: string, bSelected: boolean): void {
    const b = this.m_Buffer;
    const limit = b.m_bByteLimit ? b.m_ByteLimit : b.m_nLengthLimit;
    const nz = text.indexOf("\0");
    const wsz = nz < 0 ? text : text.slice(0, nz);
    b.SetText(wsz.length > limit ? wsz.slice(0, Math.max(limit, 0)) : wsz);
    this.m_nFirstVisible = 0;
    this.PlaceCaret(b.GetTextSize());
    this.m_nSelStart = bSelected ? 0 : this.m_nCaret;
  }

  /**
   * `PlaceCaret(nCP)` (32939B50): the caret goes to character `nCP`; the first visible character moves so that the caret is inside the text
   * rectangle.
   */
  PlaceCaret(nCP: number): void {
    const b = this.m_Buffer;
    this.m_nCaret = nCP;
    const nX1st = b.CPtoX(this.m_nFirstVisible, false);
    const nX = b.CPtoX(nCP, false);
    const nX2 = nCP === b.GetTextSize() ? nX : b.CPtoX(nCP, true);
    if (nX < nX1st) {
      this.m_nFirstVisible = nCP;
    } else if (nX2 > nX1st + this.m_rcText.right - this.m_rcText.left) {
      const nXNewLeft = nX2 + this.m_rcText.left - this.m_rcText.right;
      const { cp } = b.XtoCP(nXNewLeft);
      const nXNew1st = b.CPtoX(cp, false);
      this.m_nFirstVisible = nXNew1st < nXNewLeft ? cp + 1 : cp;
    }
  }

  SetCustomMsgChange(msg: number): void { this.m_CustomMsgEditBoxChange = msg; }
  SetCustomMsgEnter(msg: number): void { this.m_CustomMsgEditBoxEnter = msg; }
  SetCustomMsgFocusOut(msg: number): void { this.m_CustomMsgEditBoxFocusOut = msg; }
  SetCustomMsgFocusIn(msg: number): void { this.m_CustomMsgEditBoxFocusIn = msg; }
  SetForceSendCustomMsgChange(on: boolean): void { this.m_bIsForceSendCustomMsgChange = on; }

  /** `SetTextColor_LUA(r, g, b, a)` (328CE2A0) */
  SetTextColor(r: number, g: number, b: number, a: number): void { this.m_TextColor = d3dColor(r, g, b, a); }
  /** `SetSelectedTextColor_LUA` (328CDF20) */
  SetSelectedTextColor(r: number, g: number, b: number, a: number): void { this.m_SelTextColor = d3dColor(r, g, b, a); }
  /** `SetSelectedBackColor_LUA` (328CDE20) */
  SetSelectedBackColor(r: number, g: number, b: number, a: number): void { this.m_SelBkColor = d3dColor(r, g, b, a); }
  /** `SetCaretColor_LUA` (328CCF90): the caret of the composition string takes the same colour */
  SetCaretColor(r: number, g: number, b: number, a: number): void {
    this.m_CaretColor = this.m_CompCaretColor = d3dColor(r, g, b, a);
  }

  /**
   * `SetOutlineColor_LUA` (328CD9F0): the outline colour as four floats, each the byte of the packed colour times 1/255.  (The alpha is
   * the whole 64-bit value shifted down, as the exe has it: a value above 1 stays above 1.)
   */
  SetOutlineColor(r: number, g: number, b: number, a: number): void {
    const packed = packArgb(r, g, b, a);
    const o = this.m_OutlineColor;
    o.r = f(f(Number(BigInt.asUintN(8, packed >> 16n))) * ONE_OVER_255);
    o.g = f(f(Number(byte(channel(g)))) * ONE_OVER_255);
    o.b = f(f(Number(byte(channel(b)))) * ONE_OVER_255);
    o.a = f(f(Number(BigInt.asUintN(64, packed >> 24n))) * ONE_OVER_255);
    this.m_bOutlineCheck = true;
  }

  /** `SetLengthLimit(n)` (328CD200): the buffer's `m_nLengthLimit` */
  SetLengthLimit(n: number): void { this.m_Buffer.m_nLengthLimit = n; }
  /** `SetByteLimit_LUA(n)` (328CCEF0): a byte limit replaces the length limit in `SetText` */
  SetByteLimit(n: number): void {
    this.m_Buffer.m_bByteLimit = true;
    this.m_Buffer.m_ByteLimit = n;
  }
  SetWidthLimit(n: number): void { this.m_Buffer.m_WidthLimit = n; }
  SetLineLimit(n: number): void { this.m_Buffer.m_LineLimit = n; }
  SetOneCharMode(on: boolean): void { this.m_Buffer.m_bOneCharMode = on; }
  SetOnlyNumMode(on: boolean): void { this.m_Buffer.m_bOnlyNumMode = on; }
  SetOnlyNumAndEnglishMode(on: boolean, checkBigAndSmall: boolean, bigEnglish: boolean): void {
    this.m_Buffer.m_bOnlyNumAndEnglishMode = on;
    this.m_Buffer.m_bCheckEnglishBigAndSmall = checkBigAndSmall;
    this.m_Buffer.m_bBigEnglish = bigEnglish;
  }
  SetAutoChangeBigEnglish(on: boolean): void { this.m_Buffer.m_bAutoChangeBigEnglish = on; }

  /** `SetDefTextAlign_LUA(flags)` (328CD2F0): the `DT_*` flags text is aligned with (an unsigned long) */
  SetDefTextAlign(flags: number): void { this.m_DefTextAlign = flags >>> 0; }
  SetEnablePaste(on: boolean): void { this.m_bEnablePaste = on; }

  /** `SetMultiLineOption_LUA(groupID, groupSequence)` (3293AB30): the boxes of one group are the lines of one text (Tab moves between them) */
  SetMultiLineOption(groupID: number, groupSequence: number): void {
    this.m_GroupID = groupID;
    this.m_GroupSequence = groupSequence;
  }

  // ================================================================ the input

  /** `m_bCaretOn = true; m_dfLastBlink = DXUTGetGlobalTimer()->GetAbsoluteTime()`: the caret shows at once and blinks from now on */
  private blink(): void {
    this.m_bCaretOn = true;
    this.m_dfLastBlink = this.ctx.devices.absoluteTime();
  }

  /** what an edit of the text tells the stage: the custom message of `SetCustomMsgChange` (0x467), without one the control event 0x466 with 0 */
  private sendChange(): void {
    const msg = this.m_CustomMsgEditBoxChange;
    if (msg === -1) this.sendInternelEvent(UIM.CONTROL_EVENT, 0);
    else this.sendInternelEvent(UIM.CUSTOM_MSG, msg);
  }

  /** the end of Home, End, Left and Right: without Shift the selection collapses to the caret; the caret shows and blinks anew; the key is taken */
  private caretMoved(): true {
    if (this.ctx.getKeyState(0x10) >= 0) this.m_nSelStart = this.m_nCaret;
    this.blink();
    return true;
  }

  /**
   * `HandleKeyboard(uMsg, wParam, lParam)` (32937C10), virtual slot 7: a key going down (0x100) of a box that is enabled and shown.  Unlike the plain
   * edit box's it has no `m_bEnableInput`.  Tab is left to the dialog and so are the keys the box has no use for, except Escape (27), which the box
   * takes.  Home / End and Left / Right as the plain box's (Ctrl first, Shift after the move, the selection collapses without Shift, the caret blinks anew);
   * Up and Down of a box of a group (`SetMultiLineOption`) go a line up or down (`GetCaretLineMove`: no line, no move), always collapse the selection
   * and blink, and are taken by every box; Insert is Ctrl: copy, Shift: paste, else the insert mode, and never taken; Delete: the selection or the
   * character at the caret, the change message when something went, the blink either way.
   */
  override handleKeyboard(uMsg: number, wParam: number, _lParam: number): boolean {
    if (!this.m_bEnable || !this.m_bShow) return false;
    if (uMsg !== 0x100) return false;
    const buffer = this.m_Buffer;
    const ctx = this.ctx;
    switch (wParam) {
      case 9: // VK_TAB
        return false;
      case 0x23: // VK_END
        this.PlaceCaret(this.textLength());
        return this.caretMoved();
      case 0x24: // VK_HOME
        this.PlaceCaret(0);
        return this.caretMoved();
      case 0x25: // VK_LEFT
        if (ctx.getKeyState(0x11) >= 0) {
          if (this.m_nCaret > 0) this.PlaceCaret(this.m_nCaret - 1);
        } else {
          this.m_nCaret = buffer.GetPriorItemPos(this.m_nCaret);
          this.PlaceCaret(this.m_nCaret);
        }
        return this.caretMoved();
      case 0x26: // VK_UP
      case 0x28: { // VK_DOWN
        if (this.m_GroupID < 0) return true;
        const line = buffer.GetCaretLineMove(this.m_nCaret, wParam === 0x26 ? -1 : 1);
        if (line < 0) return true;
        this.PlaceCaret(line); // (the exe stores the caret before it calls, and PlaceCaret does it again)
        this.m_nSelStart = this.m_nCaret;
        this.blink();
        return true;
      }
      case 0x27: // VK_RIGHT
        if (ctx.getKeyState(0x11) >= 0) {
          if (this.m_nCaret < this.textLength()) this.PlaceCaret(this.m_nCaret + 1);
        } else {
          this.m_nCaret = buffer.GetNextItemPos(this.m_nCaret);
          this.PlaceCaret(this.m_nCaret);
        }
        return this.caretMoved();
      case 0x2d: // VK_INSERT
        if (ctx.getKeyState(0x11) >= 0) {
          if (ctx.getKeyState(0x10) >= 0) this.m_bInsertMode = !this.m_bInsertMode;
          else this.PasteFromClipboard();
        } else this.CopyToClipboard();
        return false;
      case 0x2e: // VK_DELETE
        if (this.m_nCaret !== this.m_nSelStart) {
          this.DeleteSelectionText();
          this.sendChange();
        } else {
          const caret = this.m_nCaret; // (no selection: the start of it is the caret, too)
          if (buffer.RemoveChar(caret)) this.sendChange();
        }
        this.blink();
        return true;
      default:
        return wParam !== 27;
    }
  }

  /**
   * `MsgProc(hWnd, uMsg, wParam, lParam)` (329387A0), virtual slot 6.  A box that is not enabled and shown takes nothing.  While the IME system is
   * off (`s_bEnableImeSystem`) every message is `EBProc`'s; while it is on (every box turns it on when it is made) the keys of the modifiers are looked at
   * first: a key going down (0x100, 0x104) of Shift, Control or Alt is written down in `lShift`, `lCtrl`, `lAlt` (the `lParam`), and `EBProc` is given
   * the message (Control as 0x11, Alt as 0x12: the keys of the IME's own windows); a key coming up (0x101, 0x105) first finds modifiers whose key-up the IME
   * swallowed (the key was down by the last `lParam` and is up by `GetAsyncKeyState`) and posts it to the focus window as `0xC0000001 | (lParam & 0x1FF0000)`,
   * the first of Alt, Control, Shift only, then goes the way of a key going down.  What the IME says is the box's: `WM_IME_ENDCOMPOSITION` (0x10E),
   * `WM_IME_COMPOSITION` (0x10F) and `WM_IME_NOTIFY` (0x282); anything else is `EBProc`'s.
   * - 0x10E: the composition string is taken back out of the box (`TruncateCompString`), cleared, the caret is shown again and the reading window
   *   hidden.  Not taken.
   * - 0x10F (`lParam` is what changed): taken.  Without an input context that is all.  `GCS_CURSORPOS` (0x80) is the caret of the composition (not
   *   below 0).  `GCS_RESULTSTR` (0x800) is what the user has finished: the composition string is truncated to it, replaced by it, sent to the box and
   *   cleared.  `GCS_COMPSTR` (8) is what is being composed: it replaces the composition string (the box's text of the old composition goes: a Korean
   *   IME's `s_bInsertOnType`); a Taiwanese IME without an id puts the first five characters of it into the reading window (and empties the composition
   *   string); a Korean one types it into the box and steps back to the caret of the composition; whatever the string, the caret blinks anew and the
   *   change message goes out if the box was told to force it.  `GCS_COMPATTR` (0x10) and `GCS_COMPCLAUSE` (0x20) are copied (what does not fit the
   *   arrays ends the exe).  The context is released.
   * - 0x282 by `wParam`: 3 and 5 (`IMN_CHANGECANDIDATE`, `IMN_OPENCANDIDATE`) read the candidate list, 4 closes the window, 6 and 8 (`IMN_SETCONVERSIONMODE`,
   *   `IMN_SETOPENSTATUS`) find what the IME does anew, 0xE (`IMN_PRIVATE`) is taken for the IMEs that have an id and say it with the right `lParam`; the
   *   others are taken.
   */
  override msgProc(_hWnd: unknown, uMsg: number, wParam: number, lParam: number): boolean {
    if (!this.m_bEnable || !this.m_bShow) return false;
    const ime = this.ctx.ime;
    if (!ime.s_bEnableImeSystem) return this.ebProc(uMsg, wParam, lParam);
    const msg = uMsg >>> 0;
    switch (msg) {
      case 0x101:
      case 0x105:
        this.postMissingKeyUps(wParam);
        return this.modifierProc(uMsg, wParam, lParam);
      case 0x100:
      case 0x104:
        return this.modifierProc(uMsg, wParam, lParam);
      case 0x10e:
        this.TruncateCompString(true, 0);
        ime.resetCompositionString();
        ime.s_bHideCaret = false;
        ime.s_bShowReadingWindow = false;
        return false;
      case 0x10f:
        return this.imeComposition(lParam);
      case 0x282:
        return this.imeNotify(wParam, lParam);
      default:
        return this.ebProc(uMsg, wParam, lParam);
    }
  }

  /** `WM_IME_COMPOSITION` of `MsgProc` */
  private imeComposition(lParam: number): boolean {
    const ime = this.ctx.ime;
    const host = ime.host;
    const himc = host.immGetContext();
    if (himc === 0) return true;
    if ((lParam & 0x80) !== 0) ime.s_nCompCaret = Math.max(host.immGetCompositionString(himc, 0x80, 0).result | 0, 0);
    if ((lParam & 0x800) !== 0) {
      const text = compositionText(host, himc, 0x800);
      if (text !== null) {
        this.TruncateCompString(false, text.length);
        ime.s_CompString.SetText(text);
        this.SendCompString();
        ime.resetCompositionString();
      }
    }
    if ((lParam & 8) !== 0) {
      const text = compositionText(host, himc, 8);
      if (text !== null) {
        this.TruncateCompString(false, text.length);
        ime.s_CompString.SetText(text);
        const cleared = (ime.s_hklCurrent & 0xffff) === 0x404 && ime.getImeId(0) === 0 ? this.readingFromComposition() : null;
        if (ime.s_bInsertOnType) {
          this.SendCompString();
          // lstrlenW(buffer + caret): the characters from the caret on.  The composition's own text ends with its NUL; behind it the buffer holds what it held
          // before (not modelled); but the reading of a Taiwanese IME zeroed the first four characters and left the rest of the text standing.
          const caret = ime.s_nCompCaret;
          const text = ime.s_CompString.m_pwszBuffer ?? "";
          let measured: number;
          if (cleared !== null) {
            if (caret >= 4 && caret > cleared.length) throw new Error(`CKTDGUIIMEEditBox::MsgProc (329387A0): the caret of the composition (${caret}) is behind its string of ${cleared.length} characters; the exe measures what the buffer holds there`);
            measured = caret < 4 ? 0 : cleared.length - caret;
          } else {
            if (caret > wcslen(text)) throw new Error(`CKTDGUIIMEEditBox::MsgProc (329387A0): the caret of the composition (${caret}) is behind its string of ${wcslen(text)} characters; the exe measures what the buffer holds there`);
            measured = wcslen(text) - caret;
          }
          for (let n = measured; n > 0; n--) host.sendMessage(0x100, 0x25, 0);
          host.sendMessage(0x101, 0x25, 0);
        }
      }
      if (this.m_bIsForceSendCustomMsgChange) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgEditBoxChange);
      this.blink();
    }
    if ((lParam & 0x10) !== 0) {
      const got = host.immGetCompositionString(himc, 0x10, 0x100);
      const n = got.result | 0;
      if (n > 0) {
        const copied = Math.min(n, 0x100);
        if (got.data.length < copied) throw new Error(`CKTDGUIIMEEditBox: the host answered ${n} attributes and gave ${got.data.length}`);
        ime.s_abCompStringAttr.set(got.data.subarray(0, copied));
        if (n >= 0x100) throw new Error(`CKTDGUIIMEEditBox::MsgProc (329387A0): ${n} attributes of the composition string do not leave room for the 0 behind them; the exe's range check ends the program`);
        ime.s_abCompStringAttr[n] = 0;
      }
    }
    if ((lParam & 0x20) !== 0) {
      const got = host.immGetCompositionString(himc, 0x20, 0x400);
      if (got.result < 0) {
        // an error (-1, -2) copies nothing and is the unsigned index 0x3FFFFFFF: the array is written at its address minus 4 (32 bits wrap), the last four
        // attributes, which precede it in memory
        const at = 0x100 + (got.result & ~3);
        if (at < 0) throw new Error(`CKTDGUIIMEEditBox::MsgProc (329387A0): the IME's error ${got.result} for the clauses puts the 0 ${-at} bytes before the attributes, in another static`);
        ime.s_abCompStringAttr.fill(0, at, at + 4);
      } else {
        // (what the IME wrote stays in the array; the 0 behind the last clause is written at the index `bytes / 4`)
        const index = got.result >>> 2;
        if (index >= 0x100) throw new Error(`CKTDGUIIMEEditBox::MsgProc (329387A0): the clauses (${got.result} bytes) end behind the array of 256; the exe writes the 0 after them outside it`);
        if (got.data.length < got.result) throw new Error(`CKTDGUIIMEEditBox: the host answered ${got.result} bytes of clauses and gave ${got.data.length}`);
        new Uint8Array(ime.s_adwCompStringClause.buffer).set(got.data.subarray(0, got.result));
        ime.s_adwCompStringClause[index] = 0;
      }
    }
    host.immReleaseContext(himc);
    return true;
  }

  /**
   * What a Taiwanese IME without an id (the Chinese phonetic IME of the old systems) does with a composition string: its first five characters are the
   * reading, shown as a window of candidates in a line (none selected; an empty string shows nothing), and the composition string itself is emptied
   * (the exe zeroes the first four characters of its buffer: the answer is the text the buffer had, which stands behind them; null when the text was empty).
   */
  private readingFromComposition(): string | null {
    const ime = this.ctx.ime;
    const comp = ime.s_CompString;
    const list = ime.s_CandList;
    const text = comp.m_pwszBuffer ?? "";
    if (wcslen(text) === 0) {
      list.dwCount = 0;
      ime.s_bShowReadingWindow = false;
      return null;
    }
    list.dwCount = 5;
    list.dwSelection = 0xffffffff;
    for (let k = 4; k >= 0; k--) list.awszCandidate[k] = k <= wcslen(text) - 1 ? text[k]! : "";
    list.dwPageSize = 10;
    comp.m_pwszBuffer = "";
    ime.s_bShowReadingWindow = true;
    ime.s_bHorizontalReading = true;
    list.nReadingError = -1; // (the exe's loop sets it to the reading's length at the candidate that is the selection: the selection is -1, none is)
    // StringCchCatW into 32 characters: five of one character each never reach the end
    ime.s_wszReadingString = list.awszCandidate.slice(0, list.dwCount).join("");
    return text;
  }

  /**
   * `TruncateCompString(bUseBackSpace, iNewStrLen)` (3293B3A0): a Korean IME has typed its composition string into the box (`s_bInsertOnType`); this takes
   * it back out, or all but its first `iNewStrLen` characters (all of it for `bUseBackSpace` or in the box's insert mode), by the keys that would do it:
   * Right for each character the caret of the composition has not passed and its key coming up, then the Backspace (down and the character) for each
   * one that goes and the key coming up, then Left for each that stays and its key coming up.  The window gets them with `SendMessageW`.
   */
  TruncateCompString(bUseBackSpace: boolean, iNewStrLen: number): void {
    const ime = this.ctx.ime;
    if (!ime.s_bInsertOnType) return;
    const host = ime.host;
    const length = wcslen(ime.s_CompString.m_pwszBuffer ?? "");
    for (let i = 0; i < length - ime.s_nCompCaret; i++) host.sendMessage(0x100, 0x27, 0);
    host.sendMessage(0x101, 0x27, 0);
    let keep = bUseBackSpace || this.m_bInsertMode ? 0 : iNewStrLen | 0;
    if (keep >= length) {
      keep = length;
    } else {
      for (let n = length - keep; n > 0; n--) {
        host.sendMessage(0x100, 8, 0);
        host.sendMessage(0x102, 8, 0);
      }
      host.sendMessage(0x101, 8, 0);
    }
    for (let n = keep; n > 0; n--) host.sendMessage(0x100, 0x25, 0);
    host.sendMessage(0x101, 0x25, 0);
  }

  /** `WM_IME_NOTIFY` of `MsgProc` */
  private imeNotify(wParam: number, lParam: number): boolean {
    const ime = this.ctx.ime;
    switch (wParam >>> 0) {
      case 3:
      case 5:
        return this.imeCandidateList();
      case 4:
        ime.s_CandList.bShowWindow = false;
        if (!ime.s_bShowReadingWindow) {
          ime.s_CandList.dwCount = 0;
          ime.s_CandList.awszCandidate.fill("");
        }
        return true;
      case 6:
      case 8:
        ime.checkToggleState();
        return false;
      case 0xe: {
        if (!ime.s_CandList.bShowWindow) ime.getPrivateReadingString();
        // the IMEs that have an id: the first group (the phonetic IMEs of Windows XP and before) takes 1 and 2, the second (the newer ones) 0x10, 0x11, 0x1A, 0x1B, 0x1C
        switch (ime.getImeId(0) >>> 0) {
          case 0x4010804: case 0x4020404: case 0x4020804: case 0x4030404: case 0x4040404:
            return lParam === 1 || lParam === 2;
          case 0x5000404: case 0x5010404: case 0x5020404: case 0x5030804: case 0x6000404:
            return lParam === 0x10 || lParam === 0x11 || lParam === 0x1a || lParam === 0x1b || lParam === 0x1c;
          default:
            return false;
        }
      }
      default:
        return true;
    }
  }

  /**
   * `IMN_CHANGECANDIDATE` / `IMN_OPENCANDIDATE` (3, 5) of `WM_IME_NOTIFY`: the candidate window is shown and the candidate list of the input context read into
   * `s_CandList`; taken.  Without a context, or without a list, nothing more happens (the context is not released).  Else the selection, the count and the
   * page size (at most 10) are the list's; the page starts at the list's `dwPageStart` (a Japanese IME's: at the multiple of the page size the selection is in);
   * the selection is counted from it (none: a Simplified Chinese IME without an id); the page's candidates (at most the page size) are written down, each
   * with its number (1..9 and 0) and, for a vertical window a space after the number, for a horizontal one a space after the text; the count is the number
   * of candidates from the list's own page start, at most its page size.  The Korean IME and the Taiwanese one without an id have no selection.  A horizontal
   * window also has the candidates in one line (`HoriCand`: each as a word with a space behind it, up to 255 characters, the last space left out) and where
   * the selected one starts and how long it is; the exe ends if there is no candidate at all (the range check).
   */
  private imeCandidateList(): boolean {
    const ime = this.ctx.ime;
    const host = ime.host;
    const list = ime.s_CandList;
    list.bShowWindow = true;
    const himc = host.immGetContext();
    if (himc === 0) return true;
    ime.s_bShowReadingWindow = false;
    const size = host.immGetCandidateList(himc, 0, 0).result >>> 0;
    if (size === 0) return true;
    const got = host.immGetCandidateList(himc, 0, size);
    const view = new DataView(got.data.buffer, got.data.byteOffset, got.data.byteLength);
    const u32 = (at: number): number => {
      if (at + 4 > view.byteLength) throw new Error(`CKTDGUIIMEEditBox::MsgProc (329387A0): the candidate list is read at ${at}, behind its ${view.byteLength} bytes; the exe reads what the heap holds there`);
      return view.getUint32(at, true);
    };
    const candidate = (index: number): string => {
      let at = u32(0x18 + 4 * index);
      let text = "";
      for (;;) {
        if (at + 2 > view.byteLength) throw new Error(`CKTDGUIIMEEditBox::MsgProc (329387A0): the candidate ${index} has no end inside the ${view.byteLength} bytes of the list; the exe reads what the heap holds behind it`);
        const c = view.getUint16(at, true);
        if (c === 0) return text;
        text += String.fromCharCode(c);
        at += 2;
      }
    };
    const dwCount = u32(8), dwSelection = u32(0xc), dwPageStart = u32(0x10), dwPageSize = u32(0x14);
    // (the exe writes the selection and the count here, too: both are written again below, before anything reads them)
    list.dwPageSize = Math.min(dwPageSize, 10);
    let start: number;
    if ((ime.s_hklCurrent & 0x3ff) === 0x11) {
      if (list.dwPageSize === 0) throw new Error("CKTDGUIIMEEditBox::MsgProc (329387A0): a Japanese IME's candidate list with a page size of 0 divides by 0 in the exe");
      start = Math.floor(dwSelection / list.dwPageSize) * list.dwPageSize;
    } else {
      start = dwPageStart;
    }
    list.dwSelection = (ime.s_hklCurrent & 0xffff) === 0x804 && ime.getImeId(0) === 0 ? 0xffffffff : (dwSelection - start) >>> 0;
    list.awszCandidate.fill("");
    const vertical = ime.s_bVerticalCand;
    for (let i = 0; start < dwCount && i < list.dwPageSize; i++, start++) {
      const text = `${String.fromCharCode(0x30 + ((i + 1) % 10))}${vertical ? " " : ""}${candidate(start)}${vertical ? "" : " "}`;
      if (text.length > 255) throw new Error("CKTDGUIIMEEditBox::MsgProc (329387A0): a candidate does not fit the 256 characters the exe has for it; it writes behind them");
      list.awszCandidate[i] = text;
    }
    list.dwCount = Math.min((dwCount - dwPageStart) >>> 0, dwPageSize); // (unsigned, like the exe's compare)
    host.immReleaseContext(himc);
    if ((ime.s_hklCurrent & 0x3ff) === 0x12 || ((ime.s_hklCurrent & 0xffff) === 0x404 && ime.getImeId(0) === 0)) list.dwSelection = 0xffffffff;
    if (vertical) return true;
    // a horizontal window: the candidates as a line
    let line = "";
    list.nFirstSelected = 0;
    list.nHoriSelectedLen = 0;
    for (let k = 0; k < 10; k++) {
      const text = list.awszCandidate[k]!;
      if (text === "") break;
      const entry = `${text} `.slice(0, 31); // StringCchPrintfW(wszEntry, 32, L"%s ", ..)
      if (list.dwSelection === k) {
        list.nFirstSelected = line.length;
        list.nHoriSelectedLen = entry.length - 1;
      }
      line = (line + entry).slice(0, 255); // StringCchCatW(wszCand, 256, ..)
    }
    if (line.length === 0) throw new Error("CKTDGUIIMEEditBox::MsgProc (329387A0): a horizontal candidate window without a candidate ends the exe (the range check of the line's last character)");
    list.HoriCand.SetText(line.slice(0, line.length - 1));
    return true;
  }

  /** the first modifier (Alt, Control, Shift) that was down by its last key-down and is up by `GetAsyncKeyState` has its key-up posted to the focus window */
  private postMissingKeyUps(wParam: number): void {
    const ime = this.ctx.ime;
    const host = ime.host;
    const post = (vk: number, last: number): void => host.postMessage(host.getFocus(), 0x101, vk, ((last & 0x1ff0000) | 0xc0000001) | 0);
    if ((ime.lAlt & 0x80000000) === 0 && wParam !== 0x12 && host.getAsyncKeyState(0x12) >= 0) return post(0x12, ime.lAlt);
    if ((ime.lCtrl & 0x80000000) === 0 && wParam !== 0x11 && host.getAsyncKeyState(0x11) >= 0) return post(0x11, ime.lCtrl);
    if ((ime.lShift & 0x80000000) === 0 && wParam !== 0x10 && host.getAsyncKeyState(0x10) >= 0) post(0x10, ime.lShift);
  }

  /** Shift, Control and Alt remember the `lParam` they came with; every key then goes to `EBProc` (which takes a character and nothing else) */
  private modifierProc(uMsg: number, wParam: number, lParam: number): boolean {
    const ime = this.ctx.ime;
    switch (wParam) {
      case 0x10:
        ime.lShift = lParam | 0;
        return this.ebProc(uMsg, wParam, lParam);
      case 0x11:
        ime.lCtrl = lParam | 0;
        return this.ebProc(uMsg, wParam, lParam);
      case 0x12:
        ime.lAlt = lParam | 0;
        return this.ebProc(uMsg, wParam, lParam);
      default:
        return this.ebProc(uMsg, wParam, lParam);
    }
  }

  /**
   * `EBProc(uMsg, wParam, lParam)` (32936A30): the edit box's own handling of a character (`WM_CHAR`, 0x102; anything else is not taken).  The character is
   * `wParam` as a signed 16-bit number.  The control characters:
   * - 1 (Ctrl+A): with no selection, everything is selected; 3 (Ctrl+C) copies, 24 (Ctrl+X) copies and deletes (the change message goes out);
   * - 8 (backspace): the key's sound; the selection goes, else the character before the caret; both send the change message, and the caret blinks anew.
   *   At the start of the text the backspace goes to the previous box of the group (`GetPrevIMEEditBox`): it is given the message and the focus, and is
   *   not taken; a box with no previous one just blinks;
   * - 13 (Enter): in a box of a group it is typed as a line break; else the keyboard's `m_bExtraEnter` is set and the control event 0x466 with 1 (or the
   *   custom message of `SetCustomMsgEnter`, with the keyboard's Enter locked) goes out; 22 (Ctrl+V) pastes and sends the change message;
   * - the others below 32 that are not a character of a text: taken, nothing happens.
   * Anything else is typed: ignored while Shift and Control are both down; the key's sound; the selection is replaced; with the insert mode off and the
   * caret inside the text the character takes the place of the one at the caret; else it is inserted (Enter of a group as a line break) and the caret
   * moves behind it (two on when the character at the caret is then a line break: a character that did not fit the width went on a new line); a character
   * the text refuses goes to the next box of the group (its text goes in there, the composition string is read and the focus moves), without one it is
   * lost.  Then the caret blinks and the change message goes out.
   */
  ebProc(uMsg: number, wParam: number, lParam: number): boolean {
    if (uMsg !== 0x102) return false;
    const buffer = this.m_Buffer;
    const ch = (wParam << 16) >> 16;
    switch (ch) {
      case 1:
        if (this.m_nSelStart === this.m_nCaret) {
          this.m_nSelStart = 0;
          this.PlaceCaret(this.textLength());
        }
        return true;
      case 2: case 4: case 5: case 6: case 7: case 9: case 10: case 11: case 12:
      case 14: case 15: case 16: case 17: case 18: case 19: case 20: case 21:
      case 23: case 25: case 26: case 27: case 28: case 29:
        return true;
      case 3:
      case 24:
        this.CopyToClipboard();
        if (ch !== 24) return true; // (Ctrl+X cuts: it also deletes what it copied)
        this.DeleteSelectionText();
        this.sendChange();
        return true;
      case 8: {
        this.playSound(this.m_pSndKeyDown);
        if (this.m_nCaret !== this.m_nSelStart) {
          this.DeleteSelectionText();
          this.sendChange();
          this.blink();
          return true;
        }
        const caret = this.m_nCaret; // (no selection: the start of it is the caret, too)
        if (caret > 0) {
          this.PlaceCaret(caret - 1);
          this.m_nSelStart = this.m_nCaret;
          buffer.RemoveChar(caret - 1);
          this.sendChange();
          this.blink();
          return true;
        }
        const prev = this.GetPrevIMEEditBox();
        if (prev === null) {
          this.blink();
          return true;
        }
        prev.ebProc(0x102, wParam, lParam);
        this.GetPrevIMEEditBox()!.RequestFocus();
        return false;
      }
      case 13: {
        if (this.m_GroupID >= 0) break;
        const keyboard = this.ctx.keyboard;
        keyboard.m_bExtraEnter = true;
        if (this.m_CustomMsgEditBoxEnter === -1) {
          this.sendInternelEvent(UIM.CONTROL_EVENT, 1);
        } else {
          keyboard.setLock(0x1c, 1);
          this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgEditBoxEnter);
        }
        return true;
      }
      case 22:
        this.PasteFromClipboard();
        this.sendChange();
        return true;
    }
    // a character that is typed
    const ctx = this.ctx;
    if (ctx.getKeyState(0x10) < 0 && ctx.getKeyState(0x11) < 0) return true;
    this.playSound(this.m_pSndKeyDown);
    if (this.m_nCaret !== this.m_nSelStart) this.DeleteSelectionText();
    const caret = this.m_nCaret; // (the selection is gone: the start of it is the caret, too)
    let place: number | null = null; // where the caret goes (null: the character was refused)
    if (!this.m_bInsertMode && caret < this.textLength()) {
      buffer.setCharAt(caret, wParam);
      place = caret + 1;
    } else if (this.m_GroupID >= 0 && wParam === 13) {
      if (buffer.InsertChar(caret, 10)) place = caret + 1;
    } else if (buffer.InsertChar(caret, wParam)) {
      place = caret + 1;
      if (this.m_GroupID >= 0 && buffer.m_pwszBuffer!.charCodeAt(caret) === 10) place = caret + 2;
    } else {
      const next = this.GetNextIMEEditBox();
      if (next !== null) {
        next.ebProc(0x102, wParam, lParam);
        this.readCompositionStringAfterHandOver();
        return false;
      }
    }
    if (place !== null) {
      this.PlaceCaret(place);
      this.m_nSelStart = this.m_nCaret;
    }
    this.blink();
    this.sendChange();
    return true;
  }

  /**
   * What the box does after it handed a character to the next box of its group: the composition string of the input context (`GCS_COMPSTR`, at most 256
   * characters) goes into the shared composition buffer, and the next box takes the focus (the order of the exe: the string is read, then the focus asked
   * for, then the string stored).  Nothing happens to the string without an input context.
   */
  private readCompositionStringAfterHandOver(): void {
    const ime = this.ctx.ime;
    const himc = ime.host.immGetContext();
    if (himc === 0) return;
    // (the exe reads at most 256 characters into a buffer it zeroed; the context is not released)
    const got = ime.host.immGetCompositionString(himc, 8, 0x200);
    this.GetNextIMEEditBox()!.RequestFocus();
    const text = compositionString(got); // (the exe's range check comes after the focus has moved)
    if (text !== null) ime.s_CompString.SetText(text);
  }

  /** `GetPrevIMEEditBox()` (32937300): the box of the same group whose sequence number is one less (the first in the dialog's order), none without one */
  GetPrevIMEEditBox(): CKTDGUIIMEEditBox | null {
    return this.groupNeighbour(-1);
  }

  /** `GetNextIMEEditBox()` (32937150): the box of the same group whose sequence number is one more */
  GetNextIMEEditBox(): CKTDGUIIMEEditBox | null {
    return this.groupNeighbour(1);
  }

  private groupNeighbour(step: number): CKTDGUIIMEEditBox | null {
    const dialog = this.liveDialog();
    if (dialog === null) return null;
    for (const control of dialog.m_ControlsList) {
      if (control.m_ControlType !== UCT.IME_EDITBOX) continue;
      const box = control as CKTDGUIIMEEditBox;
      if (box.m_GroupID === this.m_GroupID && box.m_GroupSequence === this.m_GroupSequence + step) return box;
    }
    return null;
  }

  /**
   * `HandleMouse(uMsg, pt, wParam, lParam)` (32937EF0), virtual slot 8, of a box that is enabled and shown.  The point the dialog hands it is not looked
   * at: the position comes from `lParam` (the signed low and high words, in the pixels of the back buffer, divided by the resolution scale and cut).
   * - The left button down and the double click (0x201, 0x203) first look at the IME's windows: a click inside the composition string (its rectangle
   *   starts at `s_ptCompString`, is `CPtoX` of the string wide and a line high) closes the candidate window and, for a Chinese layout (or a Japanese
   *   one that has no target clause), presses the arrow key as often as the character is far from the caret of the composition, for a Japanese one as often
   *   as the clause is far from the target clause; a click inside the candidate window picks the candidate: a vertical window by the row (Chinese:
   *   the key `1`.., Japanese: the arrows to the row, then right and left, Korean: the key `1`..), a horizontal one by the candidate under the point
   *   (Chinese and Korean: the key `1`..).  All of these take the click.  Otherwise the box asks for the focus (if it has none); a point outside it
   *   (`ContainPTForEditBox`) is not taken; else the mouse is captured, the box is dragging, the caret goes under the point (of the group's line: by
   *   `XYtoCP`), the selection collapses to it and the caret blinks anew.
   * - 0x200 (move) of a box that is not of a group and is dragging: the caret follows the mouse; the box lets go of the mouse when the point is no longer on it;
   *   0x202 (left button up): the mouse is let go, the drag is over.  Neither is taken.
   * The position inside the text is `XtoCP` of the x plus the x of the first visible character minus the alignment offset and the text rectangle's left
   * (`XtoCP`'s trailing flag is always 0, so the branch that would move the caret one on is never taken).
   */
  override handleMouse(uMsg: number, _x: number, _y: number, _wParam: number, lParam: number): boolean {
    if (!this.m_bEnable || !this.m_bShow) return false;
    const scale = resolutionScale(this.ctx);
    const x = ftoi(f(f((lParam << 16) >> 16) / scale.x));
    const y = ftoi(f(f(lParam >> 16) / scale.y));
    switch (uMsg) {
      case 0x200:
        if (this.m_GroupID >= 0 || !this.m_bMouseDrag) return false;
        this.PlaceCaret(this.charAt(x));
        if (!this.containPTForEditBox(x, y)) {
          this.ctx.releaseCapture();
          this.m_bMouseDrag = false;
        }
        return false;
      case 0x201:
      case 0x203: {
        const clicked = this.clickOnImeWindows(x, y);
        if (clicked) return true;
        if (!this.m_bHasFocus) requestFocus(this.ctx, this);
        if (!this.containPTForEditBox(x, y)) return false;
        this.m_bMouseDrag = true;
        this.ctx.setCapture();
        const buffer = this.m_Buffer;
        const nX1st = buffer.CPtoX(this.m_nFirstVisible, false);
        const textX = nX1st - this.m_ptTextAlignOffset.x - this.m_rcText.left + x;
        const cp = this.m_GroupID >= 0
          ? buffer.XYtoCP(textX, this.m_ptTextAlignOffset.y - this.m_rcText.top + y).cp
          : buffer.XtoCP(textX).cp;
        this.PlaceCaret(cp);
        this.m_nSelStart = this.m_nCaret;
        this.blink();
        return true;
      }
      case 0x202:
        this.ctx.releaseCapture();
        this.m_bMouseDrag = false;
        return false;
      default:
        return false;
    }
  }

  /** the character of the text under the layout x `x` of the mouse (of a box that is not of a group) */
  private charAt(x: number): number {
    const buffer = this.m_Buffer;
    return buffer.XtoCP((buffer.CPtoX(this.m_nFirstVisible, false) - this.m_ptTextAlignOffset.x - this.m_rcText.left + x) | 0).cp;
  }

  /**
   * The first thing a left click does (32937F69): is it on the composition string or the candidate window of the IME?  If so the keys that make the IME
   * do what the click means are sent (`keybd_event`) and the click is taken (true).
   */
  private clickOnImeWindows(x: number, y: number): boolean {
    const ime = this.ctx.ime;
    const host = ime.host;
    const comp = ime.s_CompString;
    const compWidth = comp.CPtoX(wcslen(comp.m_pwszBuffer ?? ""), false);
    const key = (vk: number, times: number): void => {
      for (let i = 0; i < times; i++) {
        host.keybdEvent(vk & 0xff, 0);
        host.keybdEvent(vk & 0xff, 2);
      }
    };
    if (!(ime.s_ptCompString.x > x) && !(ime.s_ptCompString.y > y) && compWidth + ime.s_ptCompString.x > x
        && this.lineHeight() + ime.s_ptCompString.y > y) {
      // a click in the composition string: XtoCP of the string at the x inside it (the trailing flag is always 0)
      const cp = comp.XtoCP(x - ime.s_ptCompString.x).cp;
      const himc = host.immGetContext();
      if (himc === 0) return true;
      host.immNotifyIME(himc, 0x11, 0, 0);
      host.immReleaseContext(himc);
      const language = ime.s_hklCurrent & 0x3ff;
      if (language !== 4) {
        if (language !== 0x11) return true;
        if (ime.s_nFirstTargetConv !== -1) {
          const clause = ime.s_adwCompStringClause;
          let at = 0;
          if (clause[1]! <= cp) do at++; while (clause[at + 1]! <= cp);
          let target = 0;
          if (clause[1]! <= ime.s_nFirstTargetConv) do target++; while (clause[target + 1]! <= ime.s_nFirstTargetConv);
          key(at > target ? 0x27 : 0x25, Math.abs(at - target));
          return true;
        }
      }
      key(cp > ime.s_nCompCaret ? 0x27 : 0x25, Math.abs(cp - ime.s_nCompCaret));
      return true;
    }
    const candidates = ime.s_CandList;
    if (!candidates.bShowWindow || !ptInRect(candidates.rcCandidate, { x, y })) return false;
    const language = ime.s_hklCurrent & 0x3ff;
    if (ime.s_bVerticalCand) {
      const row = idiv((y - candidates.rcCandidate.top) | 0, this.lineHeight());
      if (row >= candidates.dwCount) return true;
      if (language === 4 || language === 0x12) {
        key(row + 0x31, 1);
      } else if (language === 0x11) {
        const selection = candidates.dwSelection | 0;
        key(row > selection ? 0x28 : 0x26, Math.abs(row - selection));
        key(0x27, 1);
        key(0x25, 1);
      }
      return true;
    }
    // a horizontal window: the candidate whose text the x is in (the entries are the candidate and a space wide)
    const cp = candidates.HoriCand.XtoCP(x - candidates.rcCandidate.left).cp;
    let index = candidates.dwCount - 1; // (past the last candidate, or none at all: the last one)
    let width = 0;
    for (let k = 0; k < candidates.dwCount; k++) {
      if (cp < width) {
        index = k - 1;
        break;
      }
      width += 1 + wcslen(candidates.awszCandidate[k]!);
    }
    if (language === 4 || language === 0x12) key(index + 0x31, 1);
    return true;
  }

  /**
   * `ContainPTForEditBox(pt)` (329331C0): the plain edit box's function, which the IME box calls on itself: the point is inside the current quad moved by the
   * dialog and the offset (see `CKTDGUIControl.containPTForEditBox`).
   */
  ContainPTForEditBox(x: number, y: number): boolean {
    return this.containPTForEditBox(x, y);
  }

  /**
   * `OnFocusIn()` (329391F0), virtual slot 9: the box has the focus, its caret blinks anew; the window's input context is let go and the default one
   * (`s_hImcDef`) is given back, and `CheckToggleState` finds out what the IME does (twice: a window that has a context while the IME system is off
   * has the state off in between).  Then the message of `SetCustomMsgFocusIn` goes out, if the box has one.
   */
  override onFocusIn(): void {
    this.m_bHasFocus = true;
    const ime = this.ctx.ime;
    const host = ime.host;
    host.immAssociateContext(0);
    this.blink();
    host.immAssociateContext(ime.s_hImcDef);
    ime.checkToggleState();
    const himc = host.immGetContext();
    if (himc !== 0) {
      // (a window that has a context while the IME system is off has the state off for a moment: the exe sets it, and CheckToggleState sets it again)
      host.immReleaseContext(himc);
      ime.checkToggleState();
    }
    // (the exe asks `m_bHasFocus` again here: nothing in between can have taken it away)
    if (this.m_CustomMsgEditBoxFocusIn !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgEditBoxFocusIn);
  }

  /**
   * `OnFocusOut()` (329392A0), virtual slot 10: the flag goes and the mouse is let go (always); with an input context the composition is cancelled
   * (`s_nCompCaret` 0, the composition string and its attributes empty, `NI_COMPOSITIONSTR` with `CPS_CANCEL`, `NI_CLOSECANDIDATE`) unless this
   * is already happening (the notification can come back here); the window has no input context then; a box that had the focus tells the stage with the
   * custom message of `SetCustomMsgFocusOut`, if it has one.
   */
  override onFocusOut(): void {
    const had = this.m_bHasFocus;
    this.m_bHasFocus = false;
    this.ctx.releaseCapture();
    const ime = this.ctx.ime;
    const host = ime.host;
    const himc = host.immGetContext();
    if (himc !== 0) {
      if (ime.focusOutBusy) {
        host.immReleaseContext(himc);
      } else {
        ime.focusOutBusy = true;
        ime.s_nCompCaret = 0;
        ime.s_CompString.SetText("");
        ime.s_abCompStringAttr.fill(0);
        host.immNotifyIME(himc, 0x15, 4, 0);
        host.immNotifyIME(himc, 0x11, 0, 0);
        host.immReleaseContext(himc);
        ime.focusOutBusy = false;
      }
    }
    host.immAssociateContext(0);
    if (had && this.m_CustomMsgEditBoxFocusOut !== -1) this.sendInternelEvent(UIM.CUSTOM_MSG, this.m_CustomMsgEditBoxFocusOut);
  }

  /** `ClearText()` (32936370): the text is cleared, the first visible character, the caret and the selection are at the start */
  ClearText(): void {
    this.m_Buffer.Clear();
    this.m_nFirstVisible = 0;
    this.m_nCaret = 0;
    this.m_nSelStart = 0;
  }

  /**
   * `DeleteSelectionText()` (32936480): the caret goes to the start of the selection (`PlaceCaret`), the selection collapses to it and the selected
   * characters are removed.
   */
  DeleteSelectionText(): void {
    const lo = Math.min(this.m_nCaret, this.m_nSelStart), hi = Math.max(this.m_nCaret, this.m_nSelStart);
    this.PlaceCaret(lo);
    this.m_nSelStart = this.m_nCaret;
    for (let i = lo; i < hi; i++) this.m_Buffer.RemoveChar(lo);
  }

  /** `CopyToClipboard()` (329363A0): the plain edit box's copy (see `CKTDGUIEditBox.CopyToClipboard`) of this box's text */
  CopyToClipboard(): void {
    const caret = this.m_nCaret, start = this.m_nSelStart;
    if (caret === start) return;
    const clipboard = this.ctx.clipboard;
    if (!clipboard.open()) return;
    clipboard.empty();
    const text = this.m_Buffer.m_pwszBuffer;
    if (text === null) throw new Error("CKTDGUIIMEEditBox::CopyToClipboard: the buffer is gone; the exe copies from a null pointer");
    const lo = Math.min(caret, start), hi = Math.max(caret, start);
    if (lo < 0 || hi > text.length + 1 || hi - lo > text.length) {
      throw new Error(`CKTDGUIIMEEditBox::CopyToClipboard: the selection ${lo}..${hi} is not inside the text of ${text.length} characters; the exe reads and writes outside its arrays`);
    }
    clipboard.setText(untilNul(`${text}\0`.slice(lo, hi)));
    clipboard.close();
  }

  /**
   * `PasteFromClipboard()` (32939AC0): the selection is deleted first, whatever the clipboard holds.  A box that does not `SetEnablePaste` is done then.
   * Else the plain edit box's paste: the clipboard is opened (if it cannot be, that is all), the text goes in at the caret (`InsertString`; when it was
   * taken the caret moves behind it) and the selection collapses to the caret, then it is closed.
   */
  PasteFromClipboard(): void {
    this.DeleteSelectionText();
    if (!this.m_bEnablePaste) return;
    const clipboard = this.ctx.clipboard;
    if (!clipboard.open()) return;
    const text = clipboard.getText();
    if (text !== null) {
      const caret = this.m_nCaret;
      if (this.m_Buffer.InsertString(caret, text, -1)) this.PlaceCaret(caret + wcslen(text));
      this.m_nSelStart = this.m_nCaret;
    }
    clipboard.close();
  }

  /**
   * `GetNowText()` (329371F0): the text of the box, and, while the IME hides the caret (a composition string is being typed), the composition string
   * after it.
   */
  GetNowText(): string {
    const ime = this.ctx.ime;
    const text = this.m_Buffer.m_pwszBuffer ?? "";
    const own = text.slice(0, wcslen(text));
    return ime.s_bHideCaret ? own + (ime.s_CompString.m_pwszBuffer ?? "") : own;
  }

  /** `SendKey(vk)` (3293AB00): a key goes down and up as if the user had pressed it */
  static SendKey(host: ImeHost, nVirtKey: number): void {
    host.keybdEvent(nVirtKey & 0xff, 0);
    host.keybdEvent(nVirtKey & 0xff, 2);
  }

  /**
   * `SendCompString()` (3293AA90): every character of the composition string goes through the box's `MsgProc` as a `WM_CHAR` (the length is asked again
   * after each, as the exe does).
   */
  SendCompString(): void {
    const comp = this.ctx.ime.s_CompString;
    for (let i = 0; i < wcslen(comp.m_pwszBuffer ?? ""); i++) {
      this.msgProc(null, 0x102, comp.m_pwszBuffer!.charCodeAt(i), 0); // (the exe passes the window of the app, which no box looks at)
    }
  }

  /**
   * `IsKorean()` (32938780): the layout is Korean
   */
  IsKorean(): boolean {
    return (this.ctx.ime.s_hklCurrent & 0x3ff) === 18;
  }
}
