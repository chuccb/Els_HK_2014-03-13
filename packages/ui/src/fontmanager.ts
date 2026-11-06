/**
 * `CKTDGFontManager` (the Lua class `CKTDGFontManager`, the global object `g_pFontManager`): the object the start-up config script
 * (`Config_HK_SERVICE.lua`) tells which fonts the game has.  Three Lua methods are registered:
 *
 * - `CreateNewUIFont(id, name, size, weight)`: the registered function is the one at 328B5100, which is `ret 0x10` (it takes four
 *   arguments and does nothing: the font the old UI drew with is gone and the script still asks for it);
 * - `CreateNewUIUKFont(id, name, height, weight, enlargeNum, outlineSize, noRes)` (328B5110): a `CUKFont` (328B4850) around a
 *   `CKTDGFreeTypeFont` (328D9620) is made and entered into the dialog manager's list of UK fonts under `id`
 *   (`CKTDGUIDialogManager::SetUKFont`, 328E0BA0) and into the manager's own list;
 * - `MapUIFontToUKFont(fontID, ukFontID)` (328B7800): see `UIFonts.mapUIFontToUKFont`.
 *
 * Only what the controls read of a font is ported: the sizes the `CKTDGFreeTypeFont` constructor computes.  `CKTDGFreeTypeFont::Load` (the
 * FreeType face of the installed TTF / TTC, `InstallFont` 328B71A0) and the drawing (`CUKFont::Draw2DText` ...) wait for the text renderer.
 */
import type { CKTDGFontManager_Methods } from "@els/host";
import { CKTDGFreeTypeFont, UKFont } from "./font.ts";
import type { UIFonts } from "./font.ts";

export class CKTDGFontManager implements Partial<CKTDGFontManager_Methods> {
  /** `m_UKFontList`: every UK font made, in order */
  readonly m_UKFontList: UKFont[] = [];

  /** the dialog manager's lookup the manager fills (`g_pKTDXApp->m_pDGManager->m_pDialogManager`) */
  constructor(private readonly fonts: UIFonts) {}

  /** `CreateNewUIFont(id, name, size, weight)` (328B5100, `ret 0x10`): nothing */
  CreateNewUIFont(fontID: number, fontName: string, size: number, weight: number): void {
    void fontID, fontName, size, weight;
  }

  /**
   * `CreateNewUIUKFont_LUA(fontID, pFontName, Height, Weight, enlargeNum, iOutlineSize, bNoRes)` (328B5110): the name (UTF-8, none for a NULL
   * or an empty one) goes to the `CUKFont` constructor, which makes the glyph font (`bRHW` true) of `Height` pixels; the font is
   * listed and entered under `fontID`.
   */
  CreateNewUIUKFont(fontID: number, fontName: string | undefined, height: number, weight: number, enlargeNum: number, outlineSize: number, bNoRes: boolean): void {
    const font = new UKFont(fontID, new CKTDGFreeTypeFont(fontName ?? "", height, outlineSize, true, weight, enlargeNum, bNoRes));
    this.m_UKFontList.push(font);
    this.fonts.setUKFont(fontID, font);
  }

  /** `MapUIFontToUKFont(fontID, ukFontID)` (328B7800) */
  MapUIFontToUKFont(fontID: number, ukFontID: number): void {
    this.fonts.mapUIFontToUKFont(fontID, ukFontID);
  }
}
