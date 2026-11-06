/**
 * The fonts a control measures and draws its text with.
 *
 * `CKTDGFontManager::CUKFont` (a font the font manager made with `CreateNewUIUKFont_LUA`, 328B5110: see fontmanager.ts) is ported as far as
 * the controls read it: its `CKTDGFreeTypeFont` (the sizes its constructor computes).  Loading the face and drawing text wait for the text
 * renderer.  The lookups `CKTDGUIDialogManager` keeps are `m_mapUKFontList` (UK font id -> font) and `m_mapFontToUKFont` (the font index a
 * script uses -> the id of a UK font; `CKTDGFontManager::MapUIFontToUKFont`, 328B7800).
 */
import { idiv } from "./rect.ts";

/** `CKTDGFreeTypeFont` (the glyph-cache font of a `CUKFont`): the fields its constructor (328D9620) sets from its arguments */
export class CKTDGFreeTypeFont {
  readonly m_strFontName: string;
  /** `m_EnlargeNum`: at least 1 */
  readonly m_EnlargeNum: number;
  /** `m_iFontSize`, `m_iOrgFontSize`: `enlargeNum * iFontSize` (of the argument, which can be below 1 while `m_EnlargeNum` cannot) */
  readonly m_iFontSize: number;
  readonly m_iOrgFontSize: number;
  readonly m_iOutLineSize: number;
  readonly m_iFontWeight: number;
  /** `m_iFontCacheSize`: the size of a glyph cell: the font and its outline on both sides, `m_iFontSize + 2 * (m_iOutLineSize + 1)` */
  readonly m_iFontCacheSize: number;
  readonly m_bRHW: boolean;
  readonly m_bNoRes: boolean;
  /** `m_bLoad`: the face is loaded by `Load()` (not ported) */
  m_bLoad = false;

  constructor(strFontName: string, iFontSize: number, iOutLineSize: number, bRHW: boolean, fontWeight: number, enlargeNum: number, bNoRes: boolean) {
    this.m_strFontName = strFontName;
    this.m_EnlargeNum = enlargeNum < 1 ? 1 : enlargeNum;
    this.m_iFontSize = this.m_iOrgFontSize = Math.imul(enlargeNum, iFontSize);
    this.m_iOutLineSize = iOutLineSize;
    this.m_iFontWeight = fontWeight;
    this.m_iFontCacheSize = (this.m_iFontSize + 2 * (iOutLineSize + 1)) | 0;
    this.m_bRHW = bRHW;
    this.m_bNoRes = bNoRes;
  }
}

/** `CKTDGFontManager::CUKFont`: a font of the UI (the glyph font it draws with and, not ported, the 2D text it has queued) */
export class UKFont {
  constructor(
    /** not in the exe: the id the font was entered under (a diagnostic) */
    readonly id: number,
    /** `CUKFont::m_pUKFont` */
    readonly m_pUKFont: CKTDGFreeTypeFont | null = null,
  ) {}

  /**
   * `m_pUKFont->m_iFontSize / m_pUKFont->m_EnlargeNum + 1`, the height of a line of text as the combo and list boxes count it (integer
   * division; a font without its glyph font is a null dereference in the exe, a division by zero an `idiv` fault).
   */
  lineHeight(): number {
    const ft = this.m_pUKFont;
    if (!ft) throw new Error("CUKFont::m_pUKFont is null: the exe dereferences it here");
    return (idiv(ft.m_iFontSize, ft.m_EnlargeNum) + 1) | 0;
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
