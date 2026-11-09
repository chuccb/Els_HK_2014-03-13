/**
 * The font and the buffers of the oracle runs of the text buffer (`tools/oracle-unibuf.py`) and of the edit box (`tools/oracle-edits.py`): both run the
 * exe's own functions on a `CKTDGUIUniBuffer` whose font is a stand-in with known numbers -- a character is `5 + c mod 7` wide (a line break 0), a text
 * is as wide as its widest line, `GetHeight` is `11 + length mod 5 + 6 * line breaks`, the height of a line is `fontSize / enlarge + 1` -- and replay
 * them on the port, which gets the same font and the same buffer settings from the script.
 */
import { CKTDGUIUniBuffer } from "../src/unibuffer.ts";
import type { UniBufferFont } from "../src/unibuffer.ts";
import { idiv } from "../src/rect.ts";

/** a text of a script: a string, or (long ones) its runs `[character, count]` */
export type Enc = string | null | { runs: [string, number][] };

export function dec(v: Enc): string | null {
  if (v === null || typeof v === "string") return v;
  return v.runs.map(([c, n]) => c.repeat(n)).join("");
}

/** the oracle's font; `scale` is read at every call (the exe asks `g_pKTDXApp->m_ResolutionScale` each time) */
export function stubFont(size: number, enlarge: number, scale: { readonly x: number; readonly y: number }): UniBufferFont {
  const charWidth = (c: number) => (c === 10 ? 0 : 5 + (c % 7));
  return {
    GetWidth: (text) =>
      Math.max(...text.split("\n").map((line) => Array.from(line, (_, i) => charWidth(line.charCodeAt(i))).reduce((a, b) => a + b, 0))),
    GetHeight: (text) => 11 + (text.length % 5) + 6 * (text.split("\n").length - 1),
    lineHeight: () => (idiv(size, enlarge) + 1) | 0,
    scale,
  };
}

/** what a script says of a buffer (the oracle's `buffer` and `edit_`): its text and room, the limits and the modes, the font */
export interface BufferSpec {
  text: Enc;
  size: number;
  lengthLimit: number;
  oneChar: boolean;
  onlyNum: boolean;
  widthLimit: number;
  lineLimit: number;
  onlyNumEnglish: boolean;
  checkCase: boolean;
  big: boolean;
  byteLimit: boolean;
  byteMax: number;
  autoUpper: boolean;
  hide: [boolean, number];
  font: [number, number] | null;
  analyse: boolean;
}

/** the buffer the script describes: `buf` is made by the caller (it needs the error log of its world) */
export function configureBuffer(buf: CKTDGUIUniBuffer, c: BufferSpec, scale: { readonly x: number; readonly y: number }): void {
  buf.m_pwszBuffer = dec(c.text);
  buf.m_nBufferSize = c.size;
  buf.m_nLengthLimit = c.lengthLimit;
  buf.m_bOneCharMode = c.oneChar;
  buf.m_bOnlyNumMode = c.onlyNum;
  buf.m_WidthLimit = c.widthLimit;
  buf.m_LineLimit = c.lineLimit;
  buf.m_bOnlyNumAndEnglishMode = c.onlyNumEnglish;
  buf.m_bCheckEnglishBigAndSmall = c.checkCase;
  buf.m_bBigEnglish = c.big;
  buf.m_bByteLimit = c.byteLimit;
  buf.m_ByteLimit = c.byteMax;
  buf.m_bAutoChangeBigEnglish = c.autoUpper;
  buf.SetHideChar(c.hide[0], c.hide[1]);
  buf.m_pFontNode = c.font ? stubFont(c.font[0], c.font[1], scale) : null;
  buf.m_bAnalyseRequired = c.analyse;
}
