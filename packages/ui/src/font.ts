/**
 * The fonts a control measures and draws its text with.
 *
 * `CKTDGFontManager::CUKFont` (a font the font manager made with `CreateNewUIUKFont_LUA`, 328B5110: see fontmanager.ts) is a thin wrapper
 * around its `CKTDGFreeTypeFont` (freetypefont.ts, which holds the faces, the glyph cache and does the drawing): it scales the
 * coordinates from the 1024 x 768 layout to the back buffer (`m_ResolutionScale`), takes the outline colour away from a style that has
 * no outline (`FONT_STYLE` below `FS_SHELL`), turns `D3DXCOLOR`s into `D3DCOLOR`s and measures the height of a text.  Not ported:
 * `DrawFontStyle`, `DrawTextFont`, `Push2DText` (the queued 2D text) and `OutProjectionText`.  The lookups `CKTDGUIDialogManager`
 * keeps are `m_mapUKFontList` (UK font id -> font) and `m_mapFontToUKFont` (the font index a script uses -> the id of a UK font;
 * `CKTDGFontManager::MapUIFontToUKFont`, 328B7800).
 *
 * | `CUKFont` member | address |
 * |---|---|
 * | `~CUKFont` (`Destroy`) | 328B4F30 |
 * | `CalcTextRect` | 328B5010 |
 * | `Draw2DText` | 328B53C0 |
 * | `GetHeight` / `GetPaddedHeight` | 328B6EF0 / 328B7020 |
 * | `GetWidth(wchar_t *)` / `GetWidth(wchar_t)` | 328B7150 / 328B7170 |
 * | `OutTextMultiline` | 328B7C50 |
 * | `OutTextXY` | 328B7D80 |
 */
import { idiv, ftoi } from "./rect.ts";
import type { Rect } from "./rect.ts";
import { CKTDGFreeTypeFont, wcslen } from "./freetypefont.ts";
import { clampedByte } from "./control.ts";

export { CKTDGFreeTypeFont } from "./freetypefont.ts";

const f = Math.fround;

/** `CKTDGFontManager::FONT_STYLE` */
export const FONT_STYLE = { FS_NONE: 0, FS_SHADOW: 1, FS_SHELL: 2 } as const;

/** `D3DXCOLOR` (floats) */
export interface ColorF {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** what `Draw2DText` makes of a `D3DXCOLOR`: every channel clamped (`clampedByte`), packed `D3DCOLOR_ARGB` */
export function packColor(c: ColorF): number {
  return (((clampedByte(c.a) << 24) | (clampedByte(c.r) << 16) | (clampedByte(c.g) << 8) | clampedByte(c.b)) >>> 0);
}

/** `CKTDGFontManager::CUKFont`: a font of the UI */
export class UKFont {
  constructor(
    /** not in the exe: the id the font was entered under (a diagnostic) */
    readonly id: number,
    /** `CUKFont::m_pUKFont` (null after `Destroy`) */
    public m_pUKFont: CKTDGFreeTypeFont | null = null,
  ) {}

  /**
   * `~CUKFont` (328B4F30): the queued 2D texts are dropped (`m_vecFont2D`: `Push2DText` is not ported, so there are none), the glyph font
   * is unloaded (`UnLoad(true)`: its pages, cells and vertex memory go) and deleted.  The exe dereferences `m_pUKFont` without a look.
   */
  Destroy(): void {
    this.ft.UnLoad(true);
    this.m_pUKFont = null;
  }

  /** `m_pUKFont`, which the exe dereferences without a look (a null one is a crash there) */
  private get ft(): CKTDGFreeTypeFont {
    if (!this.m_pUKFont) throw new Error("CUKFont::m_pUKFont is null: the exe dereferences it here");
    return this.m_pUKFont;
  }

  /**
   * `m_pUKFont->m_iFontSize / m_pUKFont->m_EnlargeNum + 1`, the height of a line of text as the combo and list boxes count it (integer
   * division; a font without its glyph font is a null dereference in the exe, a division by zero an `idiv` fault).
   */
  lineHeight(): number {
    const ft = this.ft;
    return (idiv(ft.m_iFontSize, ft.m_EnlargeNum) + 1) | 0;
  }

  /** `g_pKTDXApp->m_ResolutionScale` */
  private get scale(): { x: number; y: number } {
    return this.ft.resolutionScale;
  }

  /** the rectangle, in the pixels of the back buffer (`(int)((float)v * scale)` for each side) */
  private scaledRect(pRt: Rect | null): Rect | null {
    if (!pRt) return null;
    const s = this.scale;
    return {
      left: ftoi(f(f(pRt.left) * s.x)),
      top: ftoi(f(f(pRt.top) * s.y)),
      right: ftoi(f(f(pRt.right) * s.x)),
      bottom: ftoi(f(f(pRt.bottom) * s.y)),
    };
  }

  /**
   * `OutTextXY(iLeft, iTop, wszText, color, fontStyle, colorOutLine, pRt, dwFlag, nCount, fScaleX, fScaleY)` (328B7D80): the position and
   * the rectangle are scaled to the back buffer; a style below `FS_SHELL` has no outline colour (0).  `color` and `colorOutLine` are
   * `D3DCOLOR`s, `nCount` the number of characters (negative: all; 0: none).
   */
  OutTextXY(iLeft: number, iTop: number, wszText: string | null, color: number, fontStyle: number, colorOutLine: number, pRt: Rect | null, dwFlag: number, nCount: number, fScaleX: number, fScaleY: number): void {
    if (fontStyle >>> 0 < FONT_STYLE.FS_SHELL) colorOutLine = 0;
    const rect = this.scaledRect(pRt);
    const s = this.scale;
    const x = ftoi(f(f(iLeft) * s.x));
    const y = ftoi(f(f(iTop) * s.y));
    this.ft.OutTextXY(x, y, wszText, color, colorOutLine, rect, dwFlag, nCount, fScaleX, fScaleY);
  }

  /** `OutTextMultiline(iLeft, iTop, wszText, color, fontStyle, colorOutLine, fLineSpace, pRt, dwFlag, nCount, fScaleX, fScaleY)` (328B7C50): as `OutTextXY`, over several lines */
  OutTextMultiline(iLeft: number, iTop: number, wszText: string | null, color: number, fontStyle: number, colorOutLine: number, fLineSpace: number, pRt: Rect | null, dwFlag: number, nCount: number, fScaleX: number, fScaleY: number): void {
    if (fontStyle >>> 0 < FONT_STYLE.FS_SHELL) colorOutLine = 0;
    const rect = this.scaledRect(pRt);
    const s = this.scale;
    const x = ftoi(f(f(iLeft) * s.x));
    const y = ftoi(f(f(iTop) * s.y));
    this.ft.OutTextMultiline(x, y, wszText, color, colorOutLine, fLineSpace, rect, dwFlag, nCount, fScaleX, fScaleY);
  }

  /**
   * `Draw2DText(strMsg, xPos, yPos, color, outlineColor, sortFlag, fontStyle, nCount)` (328B53C0): the text at (`xPos`, `yPos`) in a
   * rectangle of no size there (so `sortFlag` 1 centres it on `xPos`, 2 ends it there).  With `sortFlag & 0x20` it is one line
   * (`OutTextXY`), otherwise it is cut into lines (`OutTextMultiline`, line space 1).
   */
  Draw2DText(strMsg: string | null, xPos: number, yPos: number, color: ColorF, outlineColor: ColorF, sortFlag: number, fontStyle: number, nCount: number): void {
    if (strMsg === null) return;
    const rect: Rect = { left: xPos, top: yPos, right: xPos, bottom: yPos };
    const outline = packColor(outlineColor);
    const packed = packColor(color);
    if (sortFlag & 0x20) this.OutTextXY(xPos, yPos, strMsg, packed, fontStyle, outline, rect, sortFlag, nCount, 1, 1);
    else this.OutTextMultiline(xPos, yPos, strMsg, packed, fontStyle, outline, 1, rect, sortFlag, nCount, 1, 1);
  }

  /** `GetWidth(wszText)` (328B7150): the width of the widest line, in layout pixels */
  GetWidth(wszText: string | null): number {
    return this.ft.GetWidth(wszText, -1);
  }

  /** `GetWidth(wLetter)` (328B7170): one character: its width / `m_EnlargeNum` plus `2 * outline - 1` */
  GetWidthOfChar(wLetter: number): number {
    const ft = this.ft;
    const size = ft._EstimateFontSize(wLetter);
    return (idiv(size.cx, ft.m_EnlargeNum) + 2 * ft.m_iOutLineSize - 1) | 0;
  }

  /** the number of lines the text has for `GetHeight`: 1 + the LFs it finds (a trailing LF counts a line) */
  private static lines(wszText: string | null): number {
    let lines = 1;
    if (wszText !== null) {
      const s = wszText.slice(0, wcslen(wszText));
      let at = 0;
      while (s.length !== 0 && at <= s.length - 1) {
        const lf = s.indexOf("\n", at);
        if (lf < 0) break;
        at = lf + 1;
        lines++;
      }
    }
    return lines;
  }

  /** `GetHeight(wszText)` (328B6EF0): `lines * (m_iFontSize / m_EnlargeNum + 1)` (1 without a glyph font) */
  GetHeight(wszText: string | null): number {
    const ft = this.m_pUKFont;
    if (!ft) return 1;
    return Math.imul(UKFont.lines(wszText), idiv(ft.m_iFontSize, ft.m_EnlargeNum) + 1);
  }

  /** `GetPaddedHeight(wszText, iAddHeight)` (328B7020): `lines * (iAddHeight + 1 + m_iFontSize / m_EnlargeNum)` (1 without a glyph font) */
  GetPaddedHeight(wszText: string | null, iAddHeight: number): number {
    const ft = this.m_pUKFont;
    if (!ft) return 1;
    return Math.imul(UKFont.lines(wszText), (iAddHeight + 1 + idiv(ft.m_iFontSize, ft.m_EnlargeNum)) | 0);
  }

  /**
   * `CalcTextRect(strMsg, pos, nCount, format)` (328B5010): the rectangle of a text whose top left is `pos`: with `format & 0x20` (one
   * line) it is `m_iFontSize / m_EnlargeNum + 1` high, otherwise `_EstimateStringHeight / m_EnlargeNum`; always `GetWidth` wide.  No
   * text, or `nCount` 0, makes the rectangle empty (all four sides 0).
   */
  CalcTextRect(strMsg: string | null, pos: Rect | null, nCount: number, format: number): void {
    if (pos === null) return;
    if (strMsg === null || wcslen(strMsg) === 0 || nCount === 0) {
      pos.left = pos.top = pos.right = pos.bottom = 0;
      return;
    }
    const ft = this.ft;
    if (format & 0x20) {
      pos.bottom = (pos.top + 1 + idiv(ft.m_iFontSize, ft.m_EnlargeNum)) | 0;
      pos.right = (ft.GetWidth(strMsg, nCount) + pos.left) | 0;
    } else {
      pos.right = (ft.GetWidth(strMsg, nCount) + pos.left) | 0;
      const n = nCount < 0 ? wcslen(strMsg) : nCount;
      pos.bottom = (pos.top + idiv(ft._EstimateStringHeight(strMsg, n), ft.m_EnlargeNum)) | 0;
    }
  }
}

export class UIFonts {
  /** `CKTDGUIDialogManager::m_mapUKFontList` (std::map<int, CUKFont*>): a null entry is what `operator[]` leaves for an id nobody made */
  readonly m_mapUKFontList = new Map<number, UKFont | null>();
  /** `CKTDGUIDialogManager::m_mapFontToUKFont` (std::map<int, int>) */
  readonly m_mapFontToUKFont = new Map<number, number>();

  /** `CKTDGUIDialogManager::SetUKFont(id, font)` (328E0BA0): `m_mapUKFontList[id] = font` */
  setUKFont(id: number, font: UKFont | null): void {
    this.m_mapUKFontList.set(id, font);
  }

  /** a font made directly (the tests; the font manager makes its fonts with `CreateNewUIUKFont`) */
  addUKFont(id: number, m_pUKFont: CKTDGFreeTypeFont | null = null): UKFont {
    const font = new UKFont(id, m_pUKFont);
    this.setUKFont(id, font);
    return font;
  }

  /** `CKTDGFontManager::MapUIFontToUKFont(fontID, ukFontID)` (328B7800): only a UK font that exists can be mapped to */
  mapUIFontToUKFont(fontID: number, ukFontID: number): void {
    if (this.m_mapUKFontList.has(ukFontID)) this.m_mapFontToUKFont.set(fontID, ukFontID);
  }

  /**
   * `CKTDGUIDialogManager::GetUKFont(fontID)` (32929D80): `m_mapUKFontList[fontID]`, where `operator[]` inserts a null entry for an id that
   * is not there.  (The combo and list boxes ask for the font index of their string data directly: it is a UK font id.)
   */
  getUKFont(fontID: number): UKFont | null {
    let font = this.m_mapUKFontList.get(fontID);
    if (font === undefined) {
      font = null;
      this.m_mapUKFontList.set(fontID, font);
    }
    return font;
  }

  /**
   * The lookup of `SetFont_LUA` (32934D40): the font a text box gets for the font index of a script.  An index that is not mapped gives null;
   * a mapped one reads `m_mapUKFontList[ukFontID]` (see `getUKFont`).
   */
  getMappedUKFont(fontIndex: number): UKFont | null {
    const ukFontID = this.m_mapFontToUKFont.get(fontIndex);
    return ukFontID === undefined ? null : this.getUKFont(ukFontID);
  }
}
