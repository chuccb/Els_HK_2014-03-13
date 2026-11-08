/**
 * `CKTDGFontManager` (the Lua class `CKTDGFontManager`, the global object `g_pFontManager`): the object the start-up config script
 * (`Config_HK_SERVICE.lua`) tells which fonts the game has.  Three Lua methods are registered:
 *
 * - `CreateNewUIFont(id, name, size, weight)`: the registered function is the one at 328B5100, which is `ret 0x10` (it takes four
 *   arguments and does nothing: the font the old UI drew with is gone and the script still asks for it);
 * - `CreateNewUIUKFont(id, name, height, weight, enlargeNum, outlineSize, noRes)` (328B5110): a `CUKFont` (328B4850) around a
 *   `CKTDGFreeTypeFont` (328D9620, freetypefont.ts) is made, which LOADS it at once (`CKTDGFreeTypeFont::Load`: the faces of the installed
 *   files, the glyph pages), and entered into the dialog manager's list of UK fonts under `id` (`CKTDGUIDialogManager::SetUKFont`, 328E0BA0)
 *   and into the manager's own list;
 * - `MapUIFontToUKFont(fontID, ukFontID)` (328B7800): see `UIFonts.mapUIFontToUKFont`.
 *
 * Not a Lua method but what the scripts reach through `g_pMain:InstallFont` (main.ts): `InstallFont(name, path)` (328B71A0) reads a font
 * file and files it under the upper-cased name; `GetFontMemory(name)` (328B6D80) is how a glyph font finds its bytes.  The manager
 * also owns the one `FT_Library` (`m_FreeTypeLibrary`, made by its constructor 328B45A0) every face of every font is opened with.
 *
 * The life of the device: `OnLostDevice` (328B79E0) / `OnResetDevice` (328B7A20) pass a reset on to the glyph font of every UK font of
 * the list (freetypefont.ts); `OnFrameMove` (328B7940) lets the queued texts that spread (`CUKFont::Push2DText`) show one more character
 * every so often; the destructor `~CKTDGFontManager` (328B4D90) is `Destroy()` here (a C++ destructor is a TypeScript
 * `Destroy()`): every UK font is deleted (`~CUKFont`, 328B4F30, gives the pages back) and the lists and maps are emptied.
 */
import { FtLibrary } from "@els/freetype";
import type { CKTDGFontManager_Methods } from "@els/host";
import { CKTDGFreeTypeFont } from "./freetypefont.ts";
import type { FontHost, FontOwner } from "./freetypefont.ts";
import { UKFont } from "./font.ts";
import type { UIFonts } from "./font.ts";

/** `_toupper` on every byte: the names and file names are ASCII (a byte that is not a lower-case letter stays) */
const upper = (s: string): string => s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));

const f = Math.fround;

/** `CKTDGFontManager::GetFontMemory`'s `static std::vector<unsigned char> s_vecDummy`: what a font that is not installed has */
const DUMMY_FONT: Uint8Array = new Uint8Array(0);

export class CKTDGFontManager implements Partial<CKTDGFontManager_Methods>, FontOwner {
  /** `m_UKFontList`: every UK font made, in order */
  readonly m_UKFontList: UKFont[] = [];
  /** `m_FreeTypeLibrary` (`FT_Init_FreeType`): ONE library, so one TrueType interpreter whose state every face shares */
  readonly m_FreeTypeLibrary = new FtLibrary();
  /** `m_mapFontNameFile`: the upper-cased name a font is known by -> the upper-cased file it was installed from */
  readonly m_mapFontNameFile = new Map<string, string>();
  /** `m_mapFontFileMemory`: the upper-cased file -> its bytes */
  readonly m_mapFontFileMemory = new Map<string, Uint8Array>();

  /** `fonts`: the dialog manager's lookup the manager fills (`g_pKTDXApp->m_pDGManager->m_pDialogManager`); `host`: the rest of the client */
  constructor(
    private readonly fonts: UIFonts,
    readonly host: FontHost & { readonly devices: { readonly massFiles: { loadDataFile(name: string): Uint8Array | undefined } } },
  ) {}

  /**
   * `InstallFont(strFontName, strFontPath)` (328B71A0): both names are upper-cased (neither may be empty, or nothing happens);
   * `m_mapFontNameFile[name] = path` (an old entry is replaced); a file that is not in `m_mapFontFileMemory` is read through
   * `KGCMassFileManager::LoadDataFile` and kept (once: a second name for a file that is there does not read it again).  A file
   * that cannot be read (nothing, or no bytes) is error 0x10 and a message box `"Font Error!"` with the path; the name stays
   * mapped to a file without bytes.
   */
  InstallFont(strFontName: string, strFontPath: string): void {
    if (strFontName.length === 0 || strFontPath.length === 0) return;
    const name = upper(strFontName);
    const path = upper(strFontPath);
    this.m_mapFontNameFile.set(name, path);
    if (this.m_mapFontFileMemory.has(path)) return;
    const bytes = this.host.devices.massFiles.loadDataFile(path);
    if (bytes !== undefined && bytes.length > 0) {
      this.m_mapFontFileMemory.set(path, bytes);
    } else {
      this.host.devices.massFiles.log.push(0x10, path);
      this.host.messageBox(path, "Font Error!");
    }
  }

  /** `GetFontMemory(strFontName)` (328B6D80): the bytes of the file installed under the (upper-cased) name; empty for a name that is empty, not installed, or whose file could not be read */
  GetFontMemory(strFontName: string): Uint8Array {
    if (strFontName.length === 0) return DUMMY_FONT;
    const path = this.m_mapFontNameFile.get(upper(strFontName));
    if (path === undefined) return DUMMY_FONT;
    return this.m_mapFontFileMemory.get(path) ?? DUMMY_FONT;
  }

  /** `CreateNewUIFont(id, name, size, weight)` (328B5100, `ret 0x10`): nothing */
  CreateNewUIFont(fontID: number, fontName: string, size: number, weight: number): void {
    void fontID, fontName, size, weight;
  }

  /**
   * `CreateNewUIUKFont_LUA(fontID, pFontName, Height, Weight, enlargeNum, iOutlineSize, bNoRes)` (328B5110): the name (UTF-8, none for a NULL
   * or an empty one) goes to the `CUKFont` constructor, which makes the glyph font (`bRHW` true) of `Height` pixels and loads it (a
   * font whose files are not installed reports it as `Load` does and stays without faces); the font is listed and entered under `fontID`.
   */
  CreateNewUIUKFont(fontID: number, fontName: string | undefined, height: number, weight: number, enlargeNum: number, outlineSize: number, bNoRes: boolean): void {
    const glyphFont = new CKTDGFreeTypeFont(fontName ?? "", height, outlineSize, true, weight, enlargeNum, bNoRes, this);
    glyphFont.Load(); // the CUKFont constructor: `m_pUKFont->Load()`, the answer is not looked at
    const font = new UKFont(fontID, glyphFont);
    this.m_UKFontList.push(font);
    this.fonts.setUKFont(fontID, font);
  }

  /** `MapUIFontToUKFont(fontID, ukFontID)` (328B7800) */
  MapUIFontToUKFont(fontID: number, ukFontID: number): void {
    this.fonts.mapUIFontToUKFont(fontID, ukFontID);
  }

  /**
   * `~CKTDGFontManager` (328B4D90): the `FT_Library` is done (`FT_Done_FreeType`: the port's library is plain memory), every UK font of
   * the list is deleted (`~CUKFont`: its glyph font gives the page textures back) and the list emptied, then the maps of the font
   * names and files are erased.  The dialog manager's lookups still hold the deleted fonts (the exe's dangling pointers): a font used
   * after this has no glyph font and throws.
   */
  Destroy(): void {
    for (const font of this.m_UKFontList) font.Destroy();
    this.m_UKFontList.length = 0;
    this.m_mapFontFileMemory.clear();
    this.m_mapFontNameFile.clear();
  }

  /** `OnLostDevice()` (328B79E0): the glyph font of every UK font of the list loses its video textures; S_OK */
  OnLostDevice(): number {
    for (const font of this.m_UKFontList) font.m_pUKFont?.OnLostDevice();
    return 0;
  }

  /** `OnResetDevice()` (328B7A20): the glyph font of every UK font of the list makes its video textures again; S_OK */
  OnResetDevice(): number {
    for (const font of this.m_UKFontList) font.m_pUKFont?.OnResetDevice();
    return 0;
  }

  /**
   * `OnFrameMove(fTime, fElapsedTime)` (328B7940): of every queued text (`CUKFont::m_vecFont2D`) of every UK font, in the order of the list and
   * of the queues, those that spread (`bSpread`) have `fElapsedTime` added to the time they have waited (a float sum, stored first); when
   * that is not below the gap (`fSpreadTimeGap`: the `comiss` + `ja` skip only when the gap is greater, so a NaN counts as reached) the time
   * is 0 again and the count of shown characters (`iSpreadCount`) goes up by one while it is below the length of the text.  `fTime` is not used.
   */
  OnFrameMove(fTime: number, fElapsedTime: number): void {
    void fTime;
    for (const font of this.m_UKFontList) {
      for (const article of font.m_vecFont2D) {
        if (!article.bSpread) continue;
        article.fNowSpreadTime = f(f(fElapsedTime) + article.fNowSpreadTime);
        if (!(article.fSpreadTimeGap > article.fNowSpreadTime)) {
          article.fNowSpreadTime = 0;
          if (article.iSpreadCount < article.strMsg.length) article.iSpreadCount++;
        }
      }
    }
  }
}
