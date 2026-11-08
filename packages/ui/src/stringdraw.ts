/**
 * The strings the controls draw.  `CKTDGUIStatic::OnFrameRender` (3292A2B0), `CKTDGUIButton::OnFrameRender` (3292ED40) and
 * `CKTDGUIRadioButton::OnFrameRender` (3294AE80) each inline the same code after their pictures; here it is written once.
 *
 * A string (`UIStringData`) is drawn by a UK font (`CKTDGFontManager::CUKFont`, font.ts):
 *
 * - the font is `m_mapUKFontList[fontIndex]` of the dialog manager (an inlined `CKTDGUIDialogManager::GetUKFont`, 32929D80): the map's
 *   `operator[]` enters a null for an index nobody made, and a null font is the exe's crash in `CUKFont::OutTextMultiline`;
 * - the colour is the dialog's times the string's times the control's, channel by channel, every product rounded to a float
 *   (`(float)(dialog * string) * control`); the outline colour the same from the string's outline colour.  `OutTextMultiline` gets both
 *   as `D3DCOLOR`s (every channel `c < 1 ? (c > 0 ? (int)(c * 255 + 0.5) : 0) : 255`, `clampedByte`);
 * - the place is `(float)(dialog.m_Pos + string.pos) + control.m_OffsetPos`, cut to whole layout pixels (the font scales it to the
 *   back buffer);
 * - the call is `OutTextMultiline(x, y, text, colour, fontStyle, outlineColour, 1.0, no rectangle, sortFlag, all characters, 1.0, 1.0)`:
 *   `sortFlag` is the `SORT_FLAG` of the script (the font reads its alignment bits).
 *
 * A static whose string has `USE_UK_FONT = false` goes through the font map instead (`m_mapFontToUKFont[fontIndex]`, then the same
 * `GetUKFont`; an index that is not mapped is a null font) and `CUKFont::Draw2DText`, which takes the colours as floats.  A static string
 * with `SPREAD` shows only the first `iSpreadCount` characters (`OnFrameMove` raises the count).
 *
 * The exe's `CKTDGUIDialogHandle::operator->` answers a static null dialog for a handle that does not resolve; a control in no dialog is
 * not drawn by the dialog, so the port throws (it is not reachable).
 */
import type { CKTDGUIControl, UIContext, UIStringData } from "./control.ts";
import type { CKTDGUIDialog } from "./dialog.ts";
import { packColor } from "./font.ts";
import type { ColorF, UKFont } from "./font.ts";
import { ftoi } from "./rect.ts";

const f = Math.fround;

/** `(float)((float)(dialog * string) * control)`: one channel of the colour of a string */
const channel = (dialog: number, string: number, control: number): number => f(f(dialog * string) * control);

/** the colours a control draws a string in: the dialog's times the string's times the control's, and the same from the outline colour */
export function stringColors(dialog: CKTDGUIDialog, control: CKTDGUIControl, data: UIStringData): { color: ColorF; outline: ColorF } {
  const d = dialog.m_Color, c = control.m_Color, s = data.color, o = data.outlineColor;
  return {
    color: { a: channel(d.a, s.a, c.a), r: channel(d.r, s.r, c.r), g: channel(d.g, s.g, c.g), b: channel(d.b, s.b, c.b) },
    outline: { a: channel(d.a, o.a, c.a), r: channel(d.r, o.r, c.r), g: channel(d.g, o.g, c.g), b: channel(d.b, o.b, c.b) },
  };
}

/** where a string is put in its dialog: a place in layout pixels, floats */
export interface StringPlace {
  readonly x: number;
  readonly y: number;
}

/**
 * `(float)(dialog.m_Pos + at) + control.m_OffsetPos`: where the string starts, in layout pixels (a float).  `at` is the string's own place
 * (`UIStringData::pos`) unless the control puts it somewhere else: a combo box puts its rows at the corner of the row and its selected
 * text at the corner of its text rectangle plus an offset.
 */
export function stringPosition(dialog: CKTDGUIDialog, control: CKTDGUIControl, data: UIStringData, at: StringPlace = data.pos): { x: number; y: number } {
  return {
    x: f(f(dialog.m_Pos.x + at.x) + control.m_OffsetPos.x),
    y: f(f(dialog.m_Pos.y + at.y) + control.m_OffsetPos.y),
  };
}

/** `CKTDGUIDialogHandle::operator->` of a control that is in a dialog */
export function dialogOf(control: CKTDGUIControl): CKTDGUIDialog {
  const dialog = control.m_pDialog;
  if (!dialog) throw new Error("CKTDGUIDialogHandle::operator->: the control is in no dialog (the exe answers fs_uiDialogNullObject; not ported)");
  return dialog;
}

/** the font of a string, which the exe calls through without a look: a null one is a crash there */
function needFont(font: UKFont | null, method: string, fontIndex: number): UKFont {
  if (!font) throw new Error(`CUKFont::${method}: there is no UK font for the font index ${fontIndex} (the exe's this is null and it crashes)`);
  return font;
}

/**
 * The UK-font path (`OutTextMultiline`) of a string: what a button and a radio button do with the whole message of their string data
 * and a static with a string that uses a UK font does with the message or the part of it that has spread.  A combo box (3293DB00,
 * 3293E390) calls the font the same way for the text of a row: `at` is where it puts it.
 */
export function drawUKString(ctx: UIContext, control: CKTDGUIControl, data: UIStringData, text: string, at: StringPlace = data.pos): void {
  const font = ctx.fonts.getUKFont(data.fontIndex);
  const dialog = dialogOf(control);
  const { color, outline } = stringColors(dialog, control, data);
  const { x, y } = stringPosition(dialog, control, data, at);
  needFont(font, "OutTextMultiline", data.fontIndex).OutTextMultiline(ftoi(x), ftoi(y), text, packColor(color), data.fontStyle, packColor(outline), 1, null, data.sortFlag, -1, 1, 1);
}

/**
 * The font-map path (`Draw2DText`) of a static's string whose `USE_UK_FONT` is false: the font index is mapped to a UK font by
 * `MapUIFontToUKFont` (`m_mapFontToUKFont`; not mapped: no font), the colours go to the font as floats, and the character count is the
 * length of the text that is drawn.
 */
export function draw2DString(ctx: UIContext, control: CKTDGUIControl, data: UIStringData, text: string): void {
  const font = ctx.fonts.getMappedUKFont(data.fontIndex);
  const dialog = dialogOf(control);
  const { color, outline } = stringColors(dialog, control, data);
  const { x, y } = stringPosition(dialog, control, data);
  needFont(font, "Draw2DText", data.fontIndex).Draw2DText(text, ftoi(x), ftoi(y), color, outline, data.sortFlag, data.fontStyle, text.length);
}

/**
 * The part of a spreading string that is shown: `std::wstring(msg, min(iSpreadCount, size))`.  A count below 0 is a `size_t` the
 * string constructor refuses (`std::length_error`: a crash).
 */
export function spreadText(data: UIStringData): string {
  const count = Math.min(data.iSpreadCount, data.msg.length);
  if (count < 0) throw new Error("std::wstring(ptr, count): a negative spread count is a length error in the exe");
  return data.msg.slice(0, count);
}
