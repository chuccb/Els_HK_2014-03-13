/**
 * The input of the IME edit box against what x2.exe answers: `tools/oracle-ime.py` runs `CKTDGUIIMEEditBox`'s own functions on a CPU emulator -- the keys
 * (`HandleKeyboard`), the messages (`MsgProc`, `EBProc`), the mouse (`HandleMouse`), the focus (`OnFocusIn`, `OnFocusOut`, `CheckToggleState`) and the members
 * that copy, paste and delete -- on boxes built by hand with the IME system on and off, and writes down every call: the answer, the calls that left the box (the
 * stage's messages, the key sound, USER32 and imm32.dll) and the box and the statics of the IME afterwards (`ime-cases.json`).  The replay builds the same
 * boxes on the port and expects the same.
 */
import { describe, expect, test } from "bun:test";
import { CKTDGUIDialog, CKTDGUIEditBox, CKTDGUIIMEEditBox, MemoryClipboard, NoImeHost, type ImeHost, type ImmBytes } from "../src/index.ts";
import { describeCases } from "./replay.ts";
import { setup } from "./harness.ts";
import { configureBuffer, type BufferSpec } from "./unifont.ts";

describeCases("CKTDGUIIMEEditBox's input against the exe's own answers (tools/oracle-ime.py)", "./ime-cases.json", ["act_ime"]);

/** by hand: what the oracle cannot show (the exe reads memory it never wrote, or calls code the port does not have) */
describe("CKTDGUIIMEEditBox's input: the host's answers the exe's code does not look at", () => {
  const withHost = (over: Partial<ImeHost>) => {
    const { w } = setup();
    (w.ime as { host: ImeHost }).host = Object.assign(new NoImeHost(), over);
    return w.ime;
  };

  test("a language the window cannot name (GetLocaleInfoW fails: the exe's buffer is uninitialised there) has no letters in its indicator", () => {
    for (const hkl of [0x04090409, 0x04070407, 0x00040004]) {
      const ime = withHost({ getKeyboardLayout: () => hkl, getLocaleAbbreviation: () => "" });
      expect(ime.s_aszIndicator[0]).toBe("En");
      ime.checkToggleState();
      expect(ime.s_aszIndicator[0]).toBe("");
    }
  });

  test("GetImeId of a layout of the Chinese phonetic / Chang Jie / Pinyin IMEs asks the host for the IME's file, once for the layout; an IME that has a file is an Error (its version resource is not read)", () => {
    for (const hkl of [0xe0080404, 0xe0090404, 0xe00e0804]) {
      const asked: number[] = [];
      const ime = withHost({ immGetIMEFileName: (h) => (asked.push(h >>> 0), "") });
      ime.s_hklCurrent = hkl | 0;
      expect([ime.getImeId(0), ime.getImeId(1), ime.getImeId(0)]).toEqual([0, 0, 0]);
      expect(asked).toEqual([hkl]);
      const withFile = withHost({ immGetIMEFileName: () => "MSTCIPHA.IME" });
      withFile.s_hklCurrent = hkl | 0;
      expect(() => withFile.getImeId(0)).toThrow(/version resource/);
    }
    // the other layouts are not asked
    const ime = withHost({ immGetIMEFileName: () => { throw new Error("asked"); } });
    for (const hkl of [0x04040404, 0xe0010404, 0x08040804, 0xe0040804, 0xe00e0404, 0]) {
      ime.s_hklCurrent = hkl | 0;
      expect(ime.getImeId(0)).toBe(0);
    }
  });
});

/**
 * by hand: what an IME's answers do in the exe, where the exe's code runs on into memory that is not its own or calls code the port does not have.  Each
 * of them is an Error here (the effects before it are those of the exe).
 */
describe("CKTDGUIIMEEditBox's messages: the answers of an IME the exe's code takes without a look", () => {
  const nothing: ImmBytes = { result: 0, data: new Uint8Array(0) };
  const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(0x41);
  /** a box in a world whose IME answers by `host` (an input context 5 unless said otherwise) */
  const box = (host: Partial<ImeHost>) => {
    const { w } = setup();
    (w.ime as { host: ImeHost }).host = Object.assign(new NoImeHost(), { immGetContext: () => 5 }, host);
    const e = new CKTDGUIIMEEditBox(w);
    return { ime: w.ime, e, send: (msg: number, wParam: number, lParam: number) => e.msgProc(null, msg, wParam, lParam) };
  };
  /** what `ImmGetCompositionStringW` answers by its index */
  const comp = (items: Record<number, ImmBytes>): Partial<ImeHost> => ({ immGetCompositionString: (_himc, index) => items[index] ?? nothing });
  /** a CANDIDATELIST as the IME writes it (see `cand_list` of tools/oracle-ime.py) */
  const candidates = (texts: string[], pageSize = 10, selection = 0, pageStart = 0): Uint8Array => {
    const head = 0x18 + 4 * texts.length;
    const blobs = texts.map((t) => Uint8Array.from([...t].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]).concat([0, 0])));
    const size = blobs.reduce((n, b) => n + b.length, head);
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    [size, 0, texts.length, selection, pageStart, pageSize].forEach((v, i) => view.setUint32(4 * i, v, true));
    let at = head;
    blobs.forEach((b, i) => {
      view.setUint32(0x18 + 4 * i, at, true);
      out.set(b, at);
      at += b.length;
    });
    return out;
  };

  test("the clauses end in a 0 at the index the size says: an error before the attributes (the unsigned index wraps), more than the array has is out of it", () => {
    for (const result of [0x400, 0x404, 0x7fffffff]) {
      expect(() => box(comp({ 0x20: { result, data: bytes(0x400) } })).send(0x10f, 0, 0x20)).toThrow(/behind the array of 256/);
    }
    for (const result of [-257, -260, -300, -0x7fffffff - 1]) {
      expect(() => box(comp({ 0x20: { result, data: new Uint8Array(0) } })).send(0x10f, 0, 0x20)).toThrow(/before the attributes/);
    }
    const { ime, send } = box(comp({ 0x20: { result: -256, data: new Uint8Array(0) } }));
    ime.s_abCompStringAttr.fill(2);
    expect(send(0x10f, 0, 0x20)).toBe(true);
    expect(Array.from(ime.s_abCompStringAttr.subarray(0, 6))).toEqual([0, 0, 0, 0, 2, 2]);
  });

  test("an IME that tells more bytes than it wrote is an Error (the exe uses what was in the buffer)", () => {
    for (const [index, lParam] of [[0x20, 0x20], [0x10, 0x10], [8, 8], [0x800, 0x800]] as const) {
      expect(() => box(comp({ [index]: { result: 10, data: bytes(4) } })).send(0x10f, 0, lParam)).toThrow(/gave 4/);
    }
  });

  test("a Korean composition string typed into the box with a caret behind its end: the exe measures what stands behind the string", () => {
    const { ime, send } = box(comp({ 0x80: { result: 5, data: new Uint8Array(0) }, 8: { result: 2, data: new Uint8Array(2) } }));
    ime.s_bInsertOnType = true;
    expect(() => send(0x10f, 0, 0x88)).toThrow(/behind its string/);
  });

  test("the candidates: a text the exe's 256 characters do not hold, a Japanese page of 0, a list that ends before what it says", () => {
    for (const vertical of [false, true]) {
      const { ime, send } = box({ immGetCandidateList: (_h, _i, n) => ({ result: candidates(["x".repeat(254)]).length, data: candidates(["x".repeat(254)]).subarray(0, n) }) });
      ime.s_bVerticalCand = vertical;
      expect(() => send(0x282, 3, 0)).toThrow(/does not fit the 256 characters/);
    }
    const japanese = box({ immGetCandidateList: (_h, _i, n) => ({ result: candidates(["x"], 0).length, data: candidates(["x"], 0).subarray(0, n) }) });
    japanese.ime.s_hklCurrent = 0x04110411 | 0;
    expect(() => japanese.send(0x282, 3, 0)).toThrow(/divides by 0/);
    const whole = candidates(["abc", "de"]);
    for (const [cut, pattern] of [[0x1a, /read at 24/], [0x1c, /has no end/], [whole.length - 2, /has no end/]] as const) {
      const { send } = box({ immGetCandidateList: (_h, _i, n) => ({ result: cut, data: whole.subarray(0, Math.min(n, cut)) }) });
      expect(() => send(0x282, 5, 0)).toThrow(pattern);
    }
  });

  test("the private data of the IME's input context (IMN_PRIVATE of a layout with an id, GetPrivateReadingString) is not read", () => {
    const hkl = 0x04040404;
    const ready = () => {
      const made = box({});
      made.ime.s_hklCurrent = hkl;
      made.ime["hklPrev"] = hkl;
      made.ime["dwID"][0] = 0x4010804;
      return made;
    };
    const { send } = ready();
    expect(() => send(0x282, 0xe, 1)).toThrow(/ImmLockIMC/);
    expect(() => ready().ime.getPrivateReadingString()).toThrow(/ImmLockIMC/);
    // with the candidate window shown the private data is not asked for: the answer is the id's
    const shown = ready();
    shown.ime.s_CandList.bShowWindow = true;
    expect([1, 2, 3].map((lParam) => shown.send(0x282, 0xe, lParam))).toEqual([true, true, false]);
  });

  test("WM_INPUTLANGCHANGE of a layout whose IME has a file would load the file (LoadLibraryA); the layouts the machine lists are all there or the list is an Error", () => {
    const { ime } = box({ immGetIMEFileName: () => "MSPY.IME" });
    expect(() => ime.staticMsgProc(0x51, 0)).toThrow(/LoadLibraryA/);
    const short = box({ getKeyboardLayoutCount: () => 3, getKeyboardLayoutList: () => [0x04090409] });
    expect(() => short.ime.staticMsgProc(0x1c, 1)).toThrow(/listed 1 of its 3/);
  });
});

/**
 * by hand: what no scene can show (the exe reads and writes memory it does not own, or an IME is told to cancel while it is cancelling).  The numbers are
 * worked out from the decompile: `CopyToClipboard` (329363A0) asks `GlobalAlloc` for `2 * lstrlenW(text) + 2` bytes, which are `length + 1` characters, copies the
 * `hi - lo` characters of the selection and writes the NUL after them: a selection of `length + 1` characters or more reaches behind the block.
 */
describe("CKTDGUIIMEEditBox::CopyToClipboard outside the text", () => {
  function box(text: string, caret: number, sel: number) {
    const s = setup();
    const e = new CKTDGUIIMEEditBox(s.w);
    expect(e.m_Buffer.SetText(text)).toBe(true);
    e.m_nCaret = caret;
    e.m_nSelStart = sel;
    return { ...s, e, clip: s.w.clipboard as MemoryClipboard };
  }

  test("a selection of more characters than the text has is an error: the block is one character longer than the text", () => {
    expect(() => box("hello", 0, 6).e.CopyToClipboard()).toThrow("not inside the text of 5 characters");
    expect(() => box("hello", 6, 0).e.CopyToClipboard()).toThrow("not inside the text of 5 characters");
  });

  test("a selection that ends more than one behind the text is an error", () => {
    expect(() => box("hello", 2, 7).e.CopyToClipboard()).toThrow("2..7 is not inside the text");
    expect(() => box("hello", 7, 2).e.CopyToClipboard()).toThrow("2..7 is not inside the text");
    expect(() => box("hello", 0, 7).e.CopyToClipboard()).toThrow("0..7 is not inside the text");
  });

  test("a selection that starts before the text is an error", () => {
    expect(() => box("hello", -1, 2).e.CopyToClipboard()).toThrow("-1..2 is not inside the text");
    expect(() => box("hello", -1, 0).e.CopyToClipboard()).toThrow("-1..0 is not inside the text");
  });

  test("the exe has opened the clipboard and emptied it by then (what it held is gone)", () => {
    const { e, clip } = box("hello", 0, 6);
    clip.text = "old";
    expect(() => e.CopyToClipboard()).toThrow("not inside the text");
    expect(clip.text as string | null).toBe(null);
  });

  test("a buffer nobody allocated has nothing to copy from", () => {
    const { e } = box("hello", 0, 2);
    e.m_Buffer.m_pwszBuffer = null;
    expect(() => e.CopyToClipboard()).toThrow("the buffer is gone");
  });

  test("a selection that ends at the text's NUL is the last one that fits: its last character is the NUL, which ends the copy", () => {
    const { e, clip } = box("hello", 1, 6);
    e.CopyToClipboard();
    expect(clip.text).toBe("ello");
    expect(clip.opened).toBe(false);
    const whole = box("hello", 0, 5);
    whole.e.CopyToClipboard();
    expect(whole.clip.text).toBe("hello");
  });

  test("no selection: the clipboard is not even opened", () => {
    const { e, clip } = box("hello", 3, 3);
    clip.busy = true;
    clip.text = "old";
    e.CopyToClipboard();
    expect(clip.text).toBe("old");
    expect(clip.opened).toBe(false);
  });
});

describe("CKTDGUIIMEEditBox: a box in no dialog, a window whose IME says nothing, an IME that calls back", () => {
  test("a box that is in no dialog, or in one that is gone, has no neighbour in its group (the dialog the exe finds is the null object's, with no controls)", () => {
    const { w } = setup();
    const lone = new CKTDGUIIMEEditBox(w);
    lone.m_GroupID = 2;
    lone.m_GroupSequence = 1;
    expect([lone.GetPrevIMEEditBox(), lone.GetNextIMEEditBox()]).toEqual([null, null]);
    const dialog = new CKTDGUIDialog(w);
    const other = new CKTDGUIIMEEditBox(w);
    other.m_GroupID = 2;
    other.m_GroupSequence = 2;
    dialog.m_ControlsList.push(lone, other);
    lone.m_pDialog = dialog;
    other.m_pDialog = dialog;
    expect(lone.GetNextIMEEditBox() === other).toBe(true);
    expect(other.GetPrevIMEEditBox() === lone).toBe(true);
    // only an IME box is a neighbour: another control whose bytes at the group's offsets say the same is not (the port's other controls have no such members)
    const plain = Object.assign(new CKTDGUIEditBox(w), { m_GroupID: 2, m_GroupSequence: 3 });
    const before = Object.assign(new CKTDGUIEditBox(w), { m_GroupID: 2, m_GroupSequence: 0 });
    dialog.m_ControlsList.unshift(before);
    dialog.m_ControlsList.push(plain);
    expect([lone.GetPrevIMEEditBox(), other.GetNextIMEEditBox()]).toEqual([null, null]);
    expect(lone.GetNextIMEEditBox() === other).toBe(true);
    dialog.m_ControlsList.length = 0;
    dialog.m_ControlsList.push(lone, other);
    dialog.destroyed = true;
    expect([lone.GetPrevIMEEditBox(), lone.GetNextIMEEditBox(), other.GetPrevIMEEditBox()]).toEqual([null, null, null]);
  });

  test("CheckToggleState of a Chinese IME the window cannot ask for its mode (the Dummy ImmGetConversionStatus answers 0 and leaves the exe a stack variable nobody wrote) is an Error", () => {
    const { w } = setup();
    (w.ime as { host: ImeHost }).host = Object.assign(new NoImeHost(), {
      getKeyboardLayout: () => 0x08040804,
      immIsIME: () => true,
      immGetContext: () => 5,
      immGetConversionStatus: () => null,
    });
    expect(() => w.ime.checkToggleState()).toThrow(/ImmGetConversionStatus failed/);
  });

  test("OnFocusOut while the IME is told to cancel (the input context calls back into the box) does not cancel again, and lets go of the context", () => {
    const { w } = setup();
    const e = new CKTDGUIIMEEditBox(w);
    const calls: string[] = [];
    let told = 0;
    (w.ime as { host: ImeHost }).host = Object.assign(new NoImeHost(), {
      immGetContext: () => 5,
      immNotifyIME: (_himc: number, action: number, index: number) => {
        calls.push(`notify(${action},${index})`);
        if (told++ === 0) e.onFocusOut(); // the IME calls back, once
        return 1;
      },
      immReleaseContext: (himc: number) => void calls.push(`release(${himc})`),
      immAssociateContext: (himc: number) => (calls.push(`associate(${himc})`), 0),
    });
    e.m_bHasFocus = true;
    e.onFocusOut();
    expect(calls).toEqual(["notify(21,4)", "release(5)", "associate(0)", "notify(17,0)", "release(5)", "associate(0)"]);
    expect(w.ime.focusOutBusy).toBe(false);
  });
});

/**
 * by hand: the Taiwanese IME's reading with the insert-on-type flag.  The exe takes the first five characters of the composition string as the reading
 * and empties the shared buffer by zeroing its first four characters (the rest of the text stays in the memory); then it counts, with `lstrlenW(buffer +
 * caret)`, how many characters stand behind the caret of the composition.  A caret in the zeroed part counts 0, one inside the old text counts what is left of
 * it, one behind the old text reads the memory behind the string (what it held before), which the port does not have: an Error.
 */
describe("CKTDGUIIMEEditBox::MsgProc 0x10F: the reading of a Taiwanese IME with the composition typed into the box", () => {
  const one = { x: 1, y: 1 };
  const spec = (text: string): BufferSpec => ({
    text, size: 256, lengthLimit: 0xffff, oneChar: false, onlyNum: false, widthLimit: 99999, lineLimit: 99999, onlyNumEnglish: false, checkCase: false, big: true,
    byteLimit: false, byteMax: 0, autoUpper: false, hide: [false, 0], font: [17, 1], analyse: false,
  });
  const utf16le = (text: string): Uint8Array => Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]));
  /** the keys the port sends to the window (`send(msg, wParam)`) for a composition `text` whose caret the IME puts at `caret` */
  function run(text: string, caret: number, hkl = 0x04040404): number[] {
    const { w } = setup();
    const sent: number[] = [];
    (w.ime as { host: ImeHost }).host = Object.assign(new NoImeHost(), {
      immGetContext: () => 5,
      sendMessage: (msg: number, wParam: number) => void sent.push(msg * 0x100 + wParam),
      immGetCompositionString: (_himc: number, index: number, bufferBytes: number): ImmBytes => {
        if (index === 0x80) return { result: caret, data: new Uint8Array(0) };
        const data = utf16le(text);
        return index === 8 ? { result: data.length, data: data.subarray(0, bufferBytes) } : { result: 0, data: new Uint8Array(0) };
      },
    });
    const e = new CKTDGUIIMEEditBox(w);
    configureBuffer(e.m_Buffer, spec(""), one);
    configureBuffer(w.ime.s_CompString, spec(""), one);
    w.ime.s_bInsertOnType = true;
    w.ime.s_hklCurrent = hkl | 0;
    e.msgProc(null, 0x10f, 0, 0x88);
    return sent;
  }
  /** the Left key presses that stand for the characters behind the caret (the first message of `TruncateCompString` is the Right key's up, the last two are the Left key's) */
  const lefts = (sent: number[]): number => sent.filter((m) => m === 0x100 * 0x100 + 0x25).length;

  test("a caret in the first four characters counts 0, whatever the text is", () => {
    for (const caret of [0, 1, 2, 3]) expect(lefts(run("abcdefg", caret))).toBe(0);
    expect(lefts(run("ab", 3))).toBe(0);
    expect(lefts(run("a", 3))).toBe(0);
  });

  test("a caret from the fifth character on counts what stands behind it in the old text", () => {
    expect(lefts(run("abcdefg", 4))).toBe(3);
    expect(lefts(run("abcdefg", 5))).toBe(2);
    expect(lefts(run("abcdefg", 7))).toBe(0);
    expect(lefts(run("abcde", 4))).toBe(1);
    expect(lefts(run("abcd", 4))).toBe(0);
  });

  test("a caret behind the old text reads what the exe's buffer held before: an Error", () => {
    expect(() => run("abcdefg", 8)).toThrow(/behind its string of 7 characters/);
    expect(() => run("abcd", 5)).toThrow(/behind its string of 4 characters/);
    expect(() => run("ab", 4)).toThrow(/behind its string of 2 characters/);
    expect(() => run("a", 6)).toThrow(/behind its string of 1 characters/);
  });

  test("a layout that is not Taiwan's has no reading: the caret is counted in the composition string itself, and the Error is for a caret behind it", () => {
    for (const hkl of [0x04050405, 0x04040405, 0x04030403]) {
      expect(lefts(run("abcdefg", 2, hkl))).toBe(5);
      expect(() => run("ab", 4, hkl)).toThrow(/behind its string of 2 characters/);
    }
    expect(lefts(run("abcdefg", 2))).toBe(0);
  });
});

describe("the IME system: Initialize runs once", () => {
  test("the shared composition buffer is made when the first box is built (`SetBufferSize(256)` allocates twice the request: 512 characters) and not again for the next boxes (which would make it 1024)", () => {
    const { w } = setup();
    expect(w.ime.s_CompString.m_nBufferSize).toBe(0);
    new CKTDGUIIMEEditBox(w);
    expect(w.ime.s_CompString.m_nBufferSize).toBe(512);
    new CKTDGUIIMEEditBox(w);
    new CKTDGUIIMEEditBox(w);
    expect(w.ime.s_CompString.m_nBufferSize).toBe(512);
  });
});

/**
 * by hand: `ImmGetCandidateListW` gives the exe a block of `size` bytes and the exe reads the numbers and the strings of the list by their offsets, with no
 * look at the size; the port has only the bytes the host gave, so a read behind them (what the heap holds there in the exe) is an Error.  The header is
 * six numbers (`dwSize`, `dwStyle`, `dwCount`, `dwSelection`, `dwPageStart`, `dwPageSize`: 0x18 bytes), then the offsets of the strings.
 */
describe("CKTDGUIIMEEditBox::MsgProc 0x282 (IMN_OPENCANDIDATE): a candidate list that ends before the place the exe reads", () => {
  const u32 = (...numbers: number[]): number[] => numbers.flatMap((v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24]);
  /** a vertical candidate window of a world whose host answers with these bytes; returns the message and the world's candidate list */
  function open(bytes: number[]): { send: () => boolean; list: () => string[] } {
    const { w } = setup();
    (w.ime as { host: ImeHost }).host = Object.assign(new NoImeHost(), {
      immGetContext: () => 5,
      immGetCandidateList: (_himc: number, _index: number, bufferBytes: number): ImmBytes => ({ result: bytes.length, data: bufferBytes === 0 ? new Uint8Array(0) : Uint8Array.from(bytes) }),
    });
    w.ime.s_bVerticalCand = true;
    const e = new CKTDGUIIMEEditBox(w);
    return { send: () => e.msgProc(null, 0x282, 3, 0), list: () => [...w.ime.s_CandList.awszCandidate] };
  }

  test("the header is read with its last number: 0x18 bytes are enough, one less is not", () => {
    expect(open(u32(0x18, 0, 0, 0, 0, 10)).send()).toBe(true);
    expect(() => open(u32(0x18, 0, 0, 0, 0, 10).slice(0, 0x17)).send()).toThrow(/candidate list is read at 20, behind its 23 bytes/);
    expect(() => open(u32(0x18, 0, 0, 0, 0, 10).slice(0, 0x14)).send()).toThrow(/candidate list is read at 20, behind its 20 bytes/);
  });

  test("the offset of a string is read in full: a list of 0x1C bytes holds the offset of its first string, one of 0x1B does not", () => {
    expect(() => open(u32(0x1b, 0, 1, 0, 0, 10, 0x1c).slice(0, 0x1b)).send()).toThrow(/candidate list is read at 24, behind its 27 bytes/);
    expect(() => open(u32(0x1c, 0, 1, 0, 0, 10, 0x1c)).send()).toThrow(/the candidate 0 has no end inside the 28 bytes/);
  });

  test("a string has to end inside the list: its NUL is the last two bytes of 0x20 bytes, and a list of 0x1F bytes has none", () => {
    const list = open([...u32(0x20, 0, 1, 0, 0, 10, 0x1c), 0x61, 0, 0, 0]);
    expect(list.send()).toBe(true);
    expect(list.list()[0]).toBe("1 a");
    expect(() => open([...u32(0x1f, 0, 1, 0, 0, 10, 0x1c), 0x61, 0, 0x62]).send()).toThrow(/the candidate 0 has no end inside the 31 bytes/);
    expect(() => open([...u32(0x1e, 0, 1, 0, 0, 10, 0x1c), 0x61, 0]).send()).toThrow(/the candidate 0 has no end inside the 30 bytes/);
  });
});
