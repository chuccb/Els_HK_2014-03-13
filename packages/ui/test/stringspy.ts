/**
 * What the tests of the strings share (stringdraw.test.ts and the tests of the combo box, list box and slot drawing): the scene's colours,
 * a string data, the dialog and control it is put in, and a UK font whose drawing calls are written down instead of made.
 *
 * The scene: the dialog is at (10.25, 20.5) with the colour (r 0.5, g 0.75, b 0.9, a 0.8); the control has the colour (0.9, 0.6, 0.3, 0.7) and
 * the offset (0.75, 0.25); the string is at (3.8, 5.9) in (0.7, 0.4, 0.2, 0.9) with the outline (0.1, 0.2, 0.3, 0.5).  So
 *   x = (float)(10.25 + 3.8) + 0.75 = 14.8 (cut to 14), y = (float)(20.5 + 5.9) + 0.25 = 26.65 (cut to 26),
 *   colour channel = (float)(dialog * string) * control: r 0.315 -> 80, g 0.18 -> 46, b 0.054 -> 14, a 0.504 -> 129: 0x81502E0E,
 *   outline: r 0.045 -> 11, g 0.09 -> 23, b 0.081 -> 21, a 0.28 -> 71: 0x470B1715
 * (a channel is `c < 1 ? (c > 0 ? (int)(c * 255 + 0.5) : 0) : 255`).
 */
import { UIStringData } from "../src/index.ts";
import type { CKTDGUIControl, CKTDGUIDialog, UKFont } from "../src/index.ts";
import type { CKTDGFreeTypeFont } from "../src/freetypefont.ts";
import type { Recorder } from "./rig.ts";

export const COLOR = 0x81502e0e;
export const OUTLINE = 0x470b1715;
/** the colours as the floats the exe leaves them in (`Draw2DText` takes them so) */
export const COLOR_F = { r: 0.3149999976158142, g: 0.18000000715255737, b: 0.05400000140070915, a: 0.5039999485015869 };
export const OUTLINE_F = { r: 0.044999998062849045, g: 0.09000000357627869, b: 0.08100000768899918, a: 0.2800000011920929 };

/** the string data of the scene (UK font 2, `SORT_FLAG` 5, `FONT_STYLE` 2) */
export function data(msg = "Hi", over: Partial<UIStringData> = {}): UIStringData {
  const d = new UIStringData();
  d.fontIndex = 2;
  d.msg = msg;
  d.pos.set(3.8, 5.9);
  d.color.set(0.7, 0.4, 0.2, 0.9);
  d.outlineColor.set(0.1, 0.2, 0.3, 0.5);
  d.sortFlag = 5;
  d.fontStyle = 2;
  return Object.assign(d, over);
}

/** the dialog and the control the scene puts a string in */
export function place(dialog: CKTDGUIDialog, control: CKTDGUIControl): void {
  dialog.m_Pos.set(10.25, 20.5);
  dialog.m_Color.set(0.5, 0.75, 0.9, 0.8);
  dialog.AddControl(control);
  control.m_Color.set(0.9, 0.6, 0.3, 0.7);
  control.m_OffsetPos.set(0.75, 0.25);
}

export interface Call {
  method: string;
  args: unknown[];
  /** how many lines the device log had when the font was called: what was drawn before */
  log: number;
}

/** a UK font (id `id`, no glyph font) whose drawing calls are written down instead of made */
export function spied(dev: Recorder, ukFonts: { addUKFont(id: number, ft?: CKTDGFreeTypeFont): UKFont }, id: number, calls: Call[], glyphFont?: CKTDGFreeTypeFont): UKFont {
  const font = ukFonts.addUKFont(id, glyphFont);
  font.OutTextMultiline = ((...args: unknown[]) => { calls.push({ method: "OutTextMultiline", args, log: dev.log.length }); }) as UKFont["OutTextMultiline"];
  font.Draw2DText = ((...args: unknown[]) => { calls.push({ method: "Draw2DText", args, log: dev.log.length }); }) as UKFont["Draw2DText"];
  return font;
}

/** `OutTextMultiline(x, y, text, colour, style, outline, 1.0, no rectangle, sortFlag, all, 1.0, 1.0)` */
export const outText = (text: string, x = 14, y = 26, color = COLOR, style = 2, outline = OUTLINE, flag = 5) => [x, y, text, color, style, outline, 1, null, flag, -1, 1, 1];
