/**
 * The fonts a control draws its text with.
 *
 * `CKTDGFontManager::CUKFont` (a font the font manager made with `CreateNewUIUKFont_LUA`, 328B5110) is not ported: a font is only an id
 * here.  What the controls need from the font side already is the lookup `CKTDGUIDialogManager` keeps: `m_mapFontToUKFont` (the font index a
 * script uses -> the id of a UK font; `CKTDGFontManager::MapUIFontToUKFont`, 328B7800) and `m_mapUKFontList` (id -> font).
 */
export class UKFont {
  constructor(readonly id: number) {}
}

export class UIFonts {
  /** `CKTDGUIDialogManager::m_mapUKFontList` (std::map<int, CUKFont*>): a null entry is what `operator[]` leaves for an id nobody made */
  readonly m_mapUKFontList = new Map<number, UKFont | null>();
  /** `CKTDGUIDialogManager::m_mapFontToUKFont` (std::map<int, int>) */
  readonly m_mapFontToUKFont = new Map<number, number>();

  /** `CKTDGFontManager::CreateNewUIUKFont_LUA` ends by listing the new font under its id; here a font that exists only as an id */
  addUKFont(id: number): UKFont {
    const font = new UKFont(id);
    this.m_mapUKFontList.set(id, font);
    return font;
  }

  /** `CKTDGFontManager::MapUIFontToUKFont(fontID, ukFontID)` (328B7800): only a UK font that exists can be mapped to */
  mapUIFontToUKFont(fontID: number, ukFontID: number): void {
    if (this.m_mapUKFontList.has(ukFontID)) this.m_mapFontToUKFont.set(fontID, ukFontID);
  }

  /**
   * The lookup of `SetFont_LUA` (32934D40): the font a control gets for the font index of a script.  An index that is not mapped gives null;
   * a mapped one reads `m_mapUKFontList[ukFontID]`, and `operator[]` inserts a null entry for an id that is not there.
   */
  getUKFont(fontIndex: number): UKFont | null {
    const ukFontID = this.m_mapFontToUKFont.get(fontIndex);
    if (ukFontID === undefined) return null;
    let font = this.m_mapUKFontList.get(ukFontID);
    if (font === undefined) {
      font = null;
      this.m_mapUKFontList.set(ukFontID, font);
    }
    return font;
  }
}
