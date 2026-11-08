/**
 * The fonts a control measures and draws its text with.
 *
 * `CKTDGFontManager::CUKFont` (a font the font manager made with `CreateNewUIUKFont_LUA`, 328B5110: see fontmanager.ts) is a thin wrapper
 * around its `CKTDGFreeTypeFont` (freetypefont.ts, which holds the faces, the glyph cache and does the drawing): it scales the
 * coordinates from the 1024 x 768 layout to the back buffer (`m_ResolutionScale`), takes the outline colour away from a style that has
 * no outline (`FONT_STYLE` below `FS_SHELL`), turns `D3DXCOLOR`s into `D3DCOLOR`s, measures the height of a text, draws the text boxes' text
 * with its outline or shadow (`DrawTextFont`, `DrawFontStyle`) and keeps a queue of 2D texts (`Push2DText`: `FontArticle`s that
 * `CKTDGFontManager::OnFrameMove` spreads over time; nothing in the exe draws them).  Not ported: `OutProjectionText`.  The lookups `CKTDGUIDialogManager`
 * keeps are `m_mapUKFontList` (UK font id -> font) and `m_mapFontToUKFont` (the font index a script uses -> the id of a UK font;
 * `CKTDGFontManager::MapUIFontToUKFont`, 328B7800).
 *
 * | `CUKFont` member | address |
 * |---|---|
 * | `FontArticle::FontArticle` | 328B4AC0 |
 * | `~CUKFont` (`Destroy`) | 328B4F30 |
 * | `CalcTextRect` | 328B5010 |
 * | `Delete2DFont` | 328B5320 |
 * | `Draw2DText` | 328B53C0 |
 * | `DrawFontStyle` | 328B5890 |
 * | `DrawTextFont` | 328B6610 |
 * | `Get2DArticle` | 328B6D20 |
 * | `GetHeight` / `GetPaddedHeight` | 328B6EF0 / 328B7020 |
 * | `GetWidth(wchar_t *)` / `GetWidth(wchar_t)` | 328B7150 / 328B7170 |
 * | `OutTextMultiline` | 328B7C50 |
 * | `OutTextXY` | 328B7D80 |
 * | `Push2DText` | 328B7EA0 |
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

/** `CKTDGFontManager::FontArticle` (0x74 bytes, constructor 328B4AC0): a text of the font's queue (`Push2DText`); the constructor zeroes everything */
export class FontArticle {
  ID = 0;
  strMsg = "";
  readonly color: ColorF = { r: 0, g: 0, b: 0, a: 0 };
  readonly outLineColor: ColorF = { r: 0, g: 0, b: 0, a: 0 };
  bInstance = false;
  sortFlag = 0;
  fontStyle: number = FONT_STYLE.FS_NONE;
  readonly pos = { x: 0, y: 0, z: 0 };
  readonly rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  /** the text appears one character at a time: `CKTDGFontManager::OnFrameMove` counts `iSpreadCount` up every `fSpreadTimeGap` seconds */
  bSpread = false;
  iSpreadCount = 0;
  fSpreadTimeGap = 0;
  fNowSpreadTime = 0;
}

/** `CKTDGFontManager::CUKFont`: a font of the UI */
export class UKFont {
  /** `m_TextID` (0x1A0): the id of the text pushed last (the constructor makes it 0) */
  m_TextID = 0;
  /** `m_vecFont2D` (0x1A4): the queued texts in the order they were pushed */
  readonly m_vecFont2D: FontArticle[] = [];

  constructor(
    /** not in the exe: the id the font was entered under (a diagnostic) */
    readonly id: number,
    /** `CUKFont::m_pUKFont` (null after `Destroy`) */
    public m_pUKFont: CKTDGFreeTypeFont | null = null,
  ) {}

  /**
   * `~CUKFont` (328B4F30): the queued 2D texts are deleted and the queue emptied, the glyph font is unloaded (`UnLoad(true)`: its
   * pages, cells and vertex memory go) and deleted.  The exe dereferences `m_pUKFont` without a look (after it has emptied the queue).
   */
  Destroy(): void {
    this.m_vecFont2D.length = 0;
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

  /** `g_pKTDXApp->m_ResolutionScale` (the app's global: the text boxes' measuring, `CKTDGUIUniBuffer::CPtoX`, divides by it too) */
  get scale(): { x: number; y: number } {
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

  /**
   * `Push2DText(strMsg, xPos, yPos, color, outlineColor, sortFlag, fontStyle, bInstance, bSpread, fSpreadTimeGap)` (328B7EA0): a new
   * article (all zero, as its constructor makes it) gets the next id (`++m_TextID`), the two colours, the position `(float)xPos`,
   * `(float)yPos` (z stays 0), the text up to its first NUL, `bInstance`, `sortFlag` and `fontStyle`, and goes to the end of the queue;
   * the id is the answer.  Only when `bSpread` is set do `bSpread` and `fSpreadTimeGap` come into the article (the gap of a text that
   * does not spread is dropped: it stays 0), with the time and the count of the spreading at 0.  The rectangle stays empty.
   */
  Push2DText(strMsg: string, xPos: number, yPos: number, color: ColorF, outlineColor: ColorF, sortFlag: number, fontStyle: number, bInstance: boolean, bSpread: boolean, fSpreadTimeGap: number): number {
    const article = new FontArticle();
    this.m_TextID = (this.m_TextID + 1) | 0;
    if (bSpread) {
      article.bSpread = true;
      article.fSpreadTimeGap = f(fSpreadTimeGap);
      article.fNowSpreadTime = 0;
      article.iSpreadCount = 0;
    }
    Object.assign(article.color, color);
    Object.assign(article.outLineColor, outlineColor);
    article.pos.x = f(xPos);
    article.pos.y = f(yPos);
    article.strMsg = strMsg.slice(0, wcslen(strMsg));
    article.bInstance = bInstance;
    article.sortFlag = sortFlag >>> 0;
    article.ID = this.m_TextID;
    article.fontStyle = fontStyle;
    this.m_vecFont2D.push(article);
    return this.m_TextID;
  }

  /** `Delete2DFont(ID)` (328B5320): the first article with this id is deleted and the later ones move up (the order stays); false when there is none */
  Delete2DFont(ID: number): boolean {
    const at = this.m_vecFont2D.findIndex((a) => a.ID === ID);
    if (at < 0) return false;
    this.m_vecFont2D.splice(at, 1);
    return true;
  }

  /** `Get2DArticle(ID)` (328B6D20): the first article with this id, null when there is none */
  Get2DArticle(ID: number): FontArticle | null {
    return this.m_vecFont2D.find((a) => a.ID === ID) ?? null;
  }

  /**
   * `DrawFontStyle(strMsg, rt, sortFlag, outlineColor, fontStyle, nCount)` (328B5890): the outline or the shadow of a text, drawn BEFORE
   * the text itself, by the glyph font directly (the exe scales the rectangle here, so it does not go through `OutTextMultiline`):
   * `OutTextMultiline(left, top, text, outline colour, 0xFF000000, 1.0, scaled rt, flag 0, nCount, 1.0, 1.0)` (`sortFlag` is taken and
   * not looked at).  `FS_SHADOW` is one copy one layout pixel right and down; `FS_SHELL` is eight, in the order left, right, up, down,
   * left up, left down, right up, right down, each of them the rectangle moved by one layout pixel (then scaled and cut: `(int)((float)v * scale)`);
   * any other style draws nothing, and so does an empty text or a count of 0.
   */
  DrawFontStyle(strMsg: string | null, rt: Rect, sortFlag: number, outlineColor: ColorF, fontStyle: number, nCount: number): void {
    void sortFlag;
    if (strMsg === null || wcslen(strMsg) === 0 || nCount === 0) return;
    // the style is looked at before the glyph font is: the exe reads the global scale, and a style that draws nothing leaves m_pUKFont alone
    if (fontStyle !== FONT_STYLE.FS_SHADOW && fontStyle !== FONT_STYLE.FS_SHELL) return;
    const s = this.scale;
    const sx = (v: number): number => ftoi(f(f(v) * s.x));
    const sy = (v: number): number => ftoi(f(f(v) * s.y));
    const ft = this.ft;
    const color = packColor(outlineColor);
    const draw = (dx: number, dy: number): void => {
      const rect: Rect = { left: sx((rt.left + dx) | 0), top: sy((rt.top + dy) | 0), right: sx((rt.right + dx) | 0), bottom: sy((rt.bottom + dy) | 0) };
      ft.OutTextMultiline(rect.left, rect.top, strMsg, color, 0xff000000, 1, rect, 0, nCount, 1, 1);
    };
    if (fontStyle === FONT_STYLE.FS_SHADOW) {
      draw(1, 1);
      return;
    }
    draw(-1, 0);
    draw(1, 0);
    draw(0, -1);
    draw(0, 1);
    draw(-1, -1);
    draw(-1, 1);
    draw(1, -1);
    draw(1, 1);
  }

  /**
   * `DrawTextFont(strMsg, pos, nCount, color, bOutline, outlineColor, sortFlag)` (328B6610): what the edit boxes draw their text with.
   * `pos` (layout pixels; the caller's rectangle is not changed) is moved by `sortFlag`: 1 centres the text on its left side
   * (`CalcTextRect` of the text, then half its width to the left), 2 ends it there, 4 centres it vertically (the rectangle gets the
   * text's height: top `+ h/2 - t/2`, bottom `+ t/2 - h/2`, `h` the rectangle's height and `t` the height of the text over
   * `m_EnlargeNum`), 5 does both (the height is then the one `CalcTextRect` left); any other value leaves it.  The text is drawn
   * after its `FS_SHELL` outline (`DrawFontStyle`, with the moved rectangle) when `bOutline`, and drawn by
   * `OutTextMultiline(left, top, text, colour, 0xFF000000, 1.0, scaled rectangle, sortFlag, nCount, 1.0, 1.0)` of the glyph font
   * in both cases.  No rectangle, no text, an empty one or a count of 0 draws nothing.
   */
  DrawTextFont(strMsg: string | null, pos: Rect | null, nCount: number, color: ColorF, bOutline: boolean, outlineColor: ColorF, sortFlag: number): void {
    if (pos === null || strMsg === null || wcslen(strMsg) === 0 || nCount === 0) return;
    const rt: Rect = { left: pos.left, top: pos.top, right: pos.right, bottom: pos.bottom };
    switch (sortFlag >>> 0) {
      case 1:
        this.CalcTextRect(strMsg, rt, nCount, 0);
        this.shiftHalfWidth(rt);
        break;
      case 2: {
        this.CalcTextRect(strMsg, rt, nCount, 0);
        const width = (rt.right - rt.left) | 0;
        rt.right = rt.left;
        rt.left = (rt.left - width) | 0;
        break;
      }
      case 4:
        this.centreVertically(strMsg, rt, nCount);
        break;
      case 5:
        this.CalcTextRect(strMsg, rt, nCount, 0);
        this.shiftHalfWidth(rt);
        this.centreVertically(strMsg, rt, nCount);
        break;
      default:
        break;
    }
    if (bOutline) this.DrawFontStyle(strMsg, rt, 0x100, outlineColor, FONT_STYLE.FS_SHELL, nCount);
    const s = this.scale;
    const scaled: Rect = {
      left: ftoi(f(f(rt.left) * s.x)),
      top: ftoi(f(f(rt.top) * s.y)),
      right: ftoi(f(f(rt.right) * s.x)),
      bottom: ftoi(f(f(rt.bottom) * s.y)),
    };
    this.ft.OutTextMultiline(scaled.left, scaled.top, strMsg, packColor(color), 0xff000000, 1, scaled, sortFlag, nCount, 1, 1);
  }

  /** the rectangle moved left by half its width (`/ 2` of ints) */
  private shiftHalfWidth(rt: Rect): void {
    const half = idiv((rt.right - rt.left) | 0, 2);
    rt.left = (rt.left - half) | 0;
    rt.right = (rt.right - half) | 0;
  }

  /** the rectangle cut down to the height of the text, centred (`h` its height, `t` the text's: top `+ h/2 - t/2`, bottom `+ t/2 - h/2`) */
  private centreVertically(strMsg: string, rt: Rect, nCount: number): void {
    const ft = this.ft;
    const h = (rt.bottom - rt.top) | 0;
    const t = idiv(ft._EstimateStringHeight(strMsg, nCount >= 0 ? nCount : wcslen(strMsg)), ft.m_EnlargeNum);
    rt.top = (rt.top + idiv(h, 2) - idiv(t, 2)) | 0;
    rt.bottom = (rt.bottom + idiv(t, 2) - idiv(h, 2)) | 0;
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
