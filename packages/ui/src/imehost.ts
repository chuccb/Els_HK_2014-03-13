/**
 * What the IME edit box asks of the window system.  DXUT's IME code (`CKTDGUIIMEEditBox`, 32935240 and following) talks to three libraries: USER32
 * directly (the keyboard layout, the state of the keys, the focus window, the message queue, `keybd_event`), KERNEL32 (the name of a locale) and
 * `imm32.dll`, which `CKTDGUIIMEEditBox::Initialize` (329384B0) loads at run time and reaches through a table of function pointers: each of them starts
 * as a `Dummy_*` function that answers 0 (a missing library, or a function it lacks, leaves the dummy in place).  The port keeps the calls in one place,
 * the host of the world's `ImeSystem`; `NoImeHost` is the machine without an input method editor, the host of a world until a platform plugs in its own.
 *
 * The signatures are those of the Win32 calls, with the window handles left out (the window is always `DXUTGetHWND()`) and handles
 * (`HIMC`, `HKL`, `HWND`) as numbers.
 */

/** the ways the exe finds out what an IME is doing: `ImmGetConversionStatus` fills two numbers */
export interface ImeConversionStatus {
  /** `IME_CMODE_*`: bit 0 is `IME_CMODE_NATIVE` */
  readonly conversion: number;
  /** `IME_SMODE_*` */
  readonly sentence: number;
}

/**
 * What an `Imm*` call that fills a buffer answers (`ImmGetCompositionStringW`, `ImmGetCandidateListW`): the value it returns (a size in bytes, or what the
 * index asks for, or a negative error) and the bytes it wrote into the buffer (at most the size of the buffer; none for a call without one).
 */
export interface ImmBytes {
  readonly result: number;
  readonly data: Uint8Array;
}

export interface ImeHost {
  // ---- USER32
  /** `GetKeyboardLayout(0)`: the HKL of the thread (the low word is the language, `0x0404` Chinese Taiwan) */
  getKeyboardLayout(): number;
  /** `GetAsyncKeyState(vk)`: a SHORT, negative while the key is down (by the hardware, whatever the thread has been told) */
  getAsyncKeyState(vk: number): number;
  /** `GetFocus()`: the window with the keyboard focus of the thread */
  getFocus(): number;
  /** `PostMessageW(hwnd, msg, wParam, lParam)` */
  postMessage(hwnd: number, msg: number, wParam: number, lParam: number): void;
  /** `SendMessageW(DXUTGetHWND(), msg, wParam, lParam)`: the game window's own procedure runs before this returns */
  sendMessage(msg: number, wParam: number, lParam: number): void;
  /** `keybd_event(vk, 0, flags, 0)`: a key goes down (flags 0) or up (flags 2, `KEYEVENTF_KEYUP`) as if the user had pressed it */
  keybdEvent(vk: number, flags: number): void;
  /** `GetKeyboardLayoutList(0, NULL)`: how many keyboard layouts the machine has */
  getKeyboardLayoutCount(): number;
  /** `GetKeyboardLayoutList(count, buffer)`: the first `count` layouts (HKLs) */
  getKeyboardLayoutList(count: number): number[];

  // ---- KERNEL32
  /** `GetLocaleInfoW(lcid, LOCALE_SABBREVLANGNAME, buffer, 5)`: the three letters of the language (`ENU`, `CHT`), "" when the call fails */
  getLocaleAbbreviation(lcid: number): string;
  /**
   * `GetLocaleInfoW(lcid, LOCALE_SLANGUAGE, buffer, 0x80)`: the name of the language (`Chinese (Traditional, Taiwan)`); null when the call fails (it then
   * leaves the buffer as it was)
   */
  getLocaleLanguage(lcid: number): string | null;

  // ---- imm32.dll (the exe's function pointers; every answer below is the dummy's, 0, for a machine without the library)
  /** `ImmGetContext(DXUTGetHWND())`: the input context of the game window (0: none) */
  immGetContext(): number;
  /** `ImmReleaseContext(DXUTGetHWND(), himc)` */
  immReleaseContext(himc: number): void;
  /** `ImmAssociateContext(DXUTGetHWND(), himc)`: the context the window had before */
  immAssociateContext(himc: number): number;
  /** `ImmNotifyIME(himc, action, index, value)` */
  immNotifyIME(himc: number, action: number, index: number, value: number): number;
  /** `ImmIsIME(hkl)` */
  immIsIME(hkl: number): boolean;
  /** `ImmGetOpenStatus(himc)` */
  immGetOpenStatus(himc: number): boolean;
  /** `ImmGetConversionStatus(himc, &conversion, &sentence)`: null when the call fails */
  immGetConversionStatus(himc: number): ImeConversionStatus | null;
  /** `ImmGetIMEFileNameA(hkl, buffer, size)`: the file name of the layout's IME, "" when there is none (the Dummy answers 0) */
  immGetIMEFileName(hkl: number): string;
  /**
   * `ImmGetCompositionStringW(himc, index, buffer, bufferBytes)`: what the IME has of the composition: `GCS_CURSORPOS` (0x80: the position as the result,
   * no buffer), `GCS_COMPSTR` (8) and `GCS_RESULTSTR` (0x800: UTF-16 text), `GCS_COMPATTR` (0x10: a byte per character), `GCS_COMPCLAUSE` (0x20: a
   * 32-bit number per clause); the result is the size in bytes (0 for nothing, negative for an error)
   */
  immGetCompositionString(himc: number, index: number, bufferBytes: number): ImmBytes;
  /** `ImmGetCandidateListW(himc, index, buffer, bufferBytes)`: a `CANDIDATELIST` (the result is its size, 0 for none; called with no buffer it only tells the size) */
  immGetCandidateList(himc: number, index: number, bufferBytes: number): ImmBytes;
}

/** the names `GetLocaleInfoW(.., LOCALE_SLANGUAGE, ..)` has for the languages a layout is likely to be */
const LANGUAGE_NAMES = new Map<number, string>([
  [0x0409, "English (United States)"], [0x0404, "Chinese (Traditional, Taiwan)"], [0x0804, "Chinese (Simplified, PRC)"], [0x0411, "Japanese"],
  [0x0412, "Korean"],
]);

/** the names `GetLocaleInfoW(.., LOCALE_SABBREVLANGNAME, ..)` has for the languages a layout is likely to be */
const LANGUAGE_ABBREVIATIONS = new Map<number, string>([
  [0x0409, "ENU"], [0x0809, "ENG"], [0x0c09, "ENA"], [0x0404, "CHT"], [0x0804, "CHS"], [0x0c04, "ZHH"], [0x1004, "ZHI"], [0x1404, "ZHM"],
  [0x0411, "JPN"], [0x0412, "KOR"], [0x0407, "DEU"], [0x040c, "FRA"], [0x0419, "RUS"], [0x041e, "THA"], [0x042a, "VIT"],
]);

/** a machine without an input method editor: no input context, no composition, an English keyboard, no key down, nothing happens to the keys sent */
export class NoImeHost implements ImeHost {
  getKeyboardLayout(): number { return 0x04090409; }
  getAsyncKeyState(_vk: number): number { return 0; }
  getFocus(): number { return 0; }
  postMessage(_hwnd: number, _msg: number, _wParam: number, _lParam: number): void {}
  sendMessage(_msg: number, _wParam: number, _lParam: number): void {}
  keybdEvent(_vk: number, _flags: number): void {}
  getKeyboardLayoutCount(): number { return 1; }
  getKeyboardLayoutList(count: number): number[] { return [0x04090409].slice(0, count); }
  getLocaleAbbreviation(lcid: number): string { return LANGUAGE_ABBREVIATIONS.get(lcid & 0xffff) ?? ""; }
  getLocaleLanguage(lcid: number): string | null { return LANGUAGE_NAMES.get(lcid & 0xffff) ?? null; }
  immGetContext(): number { return 0; }
  immReleaseContext(_himc: number): void {}
  immAssociateContext(_himc: number): number { return 0; }
  immNotifyIME(_himc: number, _action: number, _index: number, _value: number): number { return 0; }
  immIsIME(_hkl: number): boolean { return false; }
  immGetOpenStatus(_himc: number): boolean { return false; }
  immGetConversionStatus(_himc: number): ImeConversionStatus | null { return null; }
  immGetIMEFileName(_hkl: number): string { return ""; }
  immGetCompositionString(_himc: number, _index: number, _bufferBytes: number): ImmBytes { return { result: 0, data: new Uint8Array(0) }; }
  immGetCandidateList(_himc: number, _index: number, _bufferBytes: number): ImmBytes { return { result: 0, data: new Uint8Array(0) }; }
}

/**
 * The host of a world after `CKTDGUIIMEEditBox::Uninitialize` (3293B4B0): the table of the functions of `imm32.dll` holds the `Dummy_*` functions again
 * (the library is freed), while USER32 and KERNEL32, which the table never held, are still the platform's.  A dummy answers 0 (no input context, false,
 * no file of an IME, no candidates; a failing `ImmGetConversionStatus` leaves its two numbers alone) except `ImmGetCompositionStringW`'s, which answers
 * `IMM_ERROR_GENERAL` (-2; 32935200).
 */
export class DummyImmHost implements ImeHost {
  constructor(private readonly platform: ImeHost) {}
  getKeyboardLayout(): number { return this.platform.getKeyboardLayout(); }
  getAsyncKeyState(vk: number): number { return this.platform.getAsyncKeyState(vk); }
  getFocus(): number { return this.platform.getFocus(); }
  postMessage(hwnd: number, msg: number, wParam: number, lParam: number): void { this.platform.postMessage(hwnd, msg, wParam, lParam); }
  sendMessage(msg: number, wParam: number, lParam: number): void { this.platform.sendMessage(msg, wParam, lParam); }
  keybdEvent(vk: number, flags: number): void { this.platform.keybdEvent(vk, flags); }
  getKeyboardLayoutCount(): number { return this.platform.getKeyboardLayoutCount(); }
  getKeyboardLayoutList(count: number): number[] { return this.platform.getKeyboardLayoutList(count); }
  getLocaleAbbreviation(lcid: number): string { return this.platform.getLocaleAbbreviation(lcid); }
  getLocaleLanguage(lcid: number): string | null { return this.platform.getLocaleLanguage(lcid); }
  immGetContext(): number { return 0; }
  immReleaseContext(_himc: number): void {}
  immAssociateContext(_himc: number): number { return 0; }
  immNotifyIME(_himc: number, _action: number, _index: number, _value: number): number { return 0; }
  immIsIME(_hkl: number): boolean { return false; }
  immGetOpenStatus(_himc: number): boolean { return false; }
  immGetConversionStatus(_himc: number): ImeConversionStatus | null { return null; }
  immGetIMEFileName(_hkl: number): string { return ""; }
  immGetCompositionString(_himc: number, _index: number, _bufferBytes: number): ImmBytes { return { result: -2, data: new Uint8Array(0) }; }
  immGetCandidateList(_himc: number, _index: number, _bufferBytes: number): ImmBytes { return { result: 0, data: new Uint8Array(0) }; }
}
