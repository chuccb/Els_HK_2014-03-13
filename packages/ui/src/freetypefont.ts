/**
 * `CKTDGFreeTypeFont` (0x1000C8 bytes): the glyph-cache font every `CKTDGFontManager::CUKFont` draws its text with.  A `CUKFont` is a
 * thin wrapper (font.ts); everything that decides how text looks is here.
 *
 * **Faces.**  `Load` (328DAC90) opens up to three FreeType faces from the font manager's installed fonts, all of one `FT_Library` (the
 * font manager's: the TrueType bytecode interpreter's state is shared by every face): the font itself (`GetFontMemory(name)`), the sub
 * font `"JhengHeiBold"` and the Korean font `"GULIM"` (skipped when the font IS GULIM).  Each face is set to `size << 6` at 72 dpi.  A
 * character is taken from the first face that has it (`CharToSystemTexture`, 328DA300): `FT_Load_Glyph(.., FT_LOAD_NO_BITMAP)` then
 * `FT_Render_Glyph(.., NORMAL)`; the bitmap goes into a 256 x 256 `D3DFMT_A8R8G8B8` page as `(coverage << 24) | 0xFFFFFF`.  A font with
 * an outline keeps a second set of pages: the bitmap embolden-ed by `outline << 7` (26.6: `outline` pixels) in `FT_Bitmap_Embolden`.
 *
 * **Cache.**  A cell is `m_iFontCacheSize = size + 2 * outline + 2` square; a page holds `(256 / cell)^2` of them, four pages.
 * `GetFontCache` (328DA870) hashes by character code (`m_FontCacheHashTable[65536]`); a character that is not cached takes the next
 * free cell, and when all `m_iTotalCache` cells are used the least recently used one (`dwLastUse`; `OutTextXY` restarts the stamp at
 * `timeGetTime()`).  `m_iTotalCache = 4 * 256 / cell * (256 / cell)` is NOT `4 * (256 / cell)^2` for every cell (it is more for 19:
 * 689 against 676): the cells past the fourth page take `m_pTexture[4]`, which is `m_pTextureOutLine[0]` in the object (null for a font
 * without outline): the exe dereferences it and crashes, here it is a thrown error.
 *
 * **Drawing.**  `Buffering` (328D9D40) writes a quad (two triangles, six vertices) per character into the page's vertex memory and
 * counts it in `m_iCandidate[page]`; `Flush` (328DA610) draws the counted quads of the pages with the font's render states
 * (`s_akStates`) through the dynamic vertex buffer manager.  `OutTextXY` (328DC670) is one line (an alignment flag and a rectangle
 * place it), `OutTextMultiline` (328DB3F0) splits at CR / LF.  In the text `#c` followed by six hex digits sets the colour (its alpha
 * stays), `#cx` is the default colour again; neither takes room.  The outline pass is drawn first, with the outline colour.
 *
 * Every number the exe computes in single precision (`cvtdq2ps`, `mulss`, `addss`, `subss`) is rounded to a float here at every step.
 * `nCount` / `colorOutLine` / `color` are what the exe calls pointers (`int *`) but passes as values: a "null" is 0.
 *
 * | member | address |
 * |---|---|
 * | ctor | 328D9620 |
 * | `Buffering` | 328D9D40 |
 * | `CharToSystemTexture` | 328DA300 |
 * | `Flush` | 328DA610 |
 * | `GetFontCache` | 328DA870 |
 * | `GetWidth` | 328DAAD0 |
 * | `Load` | 328DAC90 |
 * | `OutTextMultiline` | 328DB3F0 |
 * | `OutTextXY` | 328DC670 |
 * | `_EstimateFontSize` / `_EstimateStringHeight` / `_EstimateStringWidth` | 328DCFA0 / 328DD020 / 328DD090 |
 */
import { FtError, FtErr, FtFace, bitmapCopy, bitmapEmbolden, loadGlyph, renderGlyph, setCharSize, Bitmap } from "@els/freetype";
import type { FtLibrary } from "@els/freetype";
import { D3DBLEND, D3DRS, D3DSAMP, D3DTA, D3DTEXF, D3DTOP, D3DTSS } from "@els/d3d9";
import type { Direct3DDevice9 } from "@els/d3d9";
import { KD3DStack, STATE_TYPE } from "@els/engine";
import type { KStateID } from "@els/engine";
import { CKTDGDynamicTexture } from "./dynamictexture.ts";
import type { DynamicTextureHost } from "./dynamictexture.ts";
import { ftoi, idiv } from "./rect.ts";
import type { Rect } from "./rect.ts";
import type { UIRender } from "./render.ts";
import type { ErrorLogLike } from "./device.ts";

const f = Math.fround;

/** `CKTDGFreeTypeFont::s_akStates` (x2.exe.c L140730): the 13 states `Flush` draws with */
export const RSI_FREETYPE_FONT: KStateID = [
  { m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: D3DRS.ALPHABLENDENABLE, m_dwValue: 1 },
  { m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: D3DRS.ZWRITEENABLE, m_dwValue: 0 },
  { m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: D3DRS.SRCBLEND, m_dwValue: D3DBLEND.SRCALPHA },
  { m_eType: STATE_TYPE.RENDER, m_dwStage: 0, m_dwType: D3DRS.DESTBLEND, m_dwValue: D3DBLEND.INVSRCALPHA },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLOROP, m_dwValue: D3DTOP.MODULATE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLORARG1, m_dwValue: D3DTA.TEXTURE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.COLORARG2, m_dwValue: D3DTA.DIFFUSE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAOP, m_dwValue: D3DTOP.MODULATE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAARG1, m_dwValue: D3DTA.TEXTURE },
  { m_eType: STATE_TYPE.TEXTURE_STAGE, m_dwStage: 0, m_dwType: D3DTSS.ALPHAARG2, m_dwValue: D3DTA.DIFFUSE },
  { m_eType: STATE_TYPE.SAMPLER, m_dwStage: 0, m_dwType: D3DSAMP.MINFILTER, m_dwValue: D3DTEXF.LINEAR },
  { m_eType: STATE_TYPE.SAMPLER, m_dwStage: 0, m_dwType: D3DSAMP.MAGFILTER, m_dwValue: D3DTEXF.LINEAR },
  { m_eType: STATE_TYPE.SAMPLER, m_dwStage: 0, m_dwType: D3DSAMP.MIPFILTER, m_dwValue: D3DTEXF.LINEAR },
];

/** `SGCFontCache::PixelToTex` (x2.exe.c L140729): 1 / 256 */
export const PIXEL_TO_TEX = 0.00390625;

/** `CKTDXDynamicVBManager` vertex types `Flush` draws with: `XYZRHW_DIFFUSE_TEX1` (3) when `m_bRHW`, else `XYZ_DIFFUSE_TEX1` (1) */
const DVB_XYZRHW_DIFFUSE_TEX1 = 3;
const DVB_XYZ_DIFFUSE_TEX1 = 1;
const D3DPT_TRIANGLELIST = 4;

/** the glyph cell `GetFontCache` hands out (`SGCFontCache`, 0x2C bytes) */
export class SGCFontCache {
  iLeft = 0;
  iTop = 0;
  _Char = 0;
  dwLastUse = 0;
  iWidth = 0;
  iHeight = 0;
  iPage = 0;
  _texLeft = 0;
  _texRight = 0;
  _texTop = 0;
  _texBottom = 0;
}

/** what the font reaches in the client (`g_pKTDXApp`, `g_CKTDXLog`, `MessageBoxA`, `timeGetTime`): `UIWorld` is one */
export interface FontHost {
  /** the device, state mirror, dynamic vertex buffer manager and resolution scale; null: nothing is drawn (the text is still measured) */
  readonly render: UIRender | null;
  readonly devices: {
    readonly d3dDevice: Direct3DDevice9 | null;
    readonly massFiles: { readonly log: ErrorLogLike };
  };
  messageBox(text: string, caption: string): void;
  /** `timeGetTime()` in milliseconds (the same source as `GetTickCount`) */
  clock(): number;
}

/** `g_pKTDXApp->m_pDGManager->m_pFontManager`: what a font takes from the font manager */
export interface FontOwner {
  /** `m_FreeTypeLibrary`: one `FT_Library` for every face of every font */
  readonly m_FreeTypeLibrary: FtLibrary;
  readonly host: FontHost;
  /** `GetFontMemory(name)` (328B6D80): the installed file's bytes, empty when there is none */
  GetFontMemory(fontName: string): Uint8Array;
}

/** `wcslen`: the characters up to the first NUL */
export function wcslen(s: string): number {
  const at = s.indexOf("\0");
  return at < 0 ? s.length : at;
}

/**
 * `swscanf_s(buf, L"%x", &value)` on the up to six characters of a colour code: optional white space and sign, an optional `0x`, hex
 * digits; null when there is no digit (the exe's `iCol` then keeps what it had).
 */
function scanHex(buf: string): number | null {
  const m = /^[ \t\n\v\f\r]*([+-]?)(?:0[xX](?=[0-9a-fA-F]))?([0-9a-fA-F]+)/.exec(buf);
  if (!m) return null;
  let v = parseInt(m[2]!, 16);
  if (m[1] === "-") v = -v;
  return v >>> 0;
}

/** a FreeType call that answers an error code: an error the library reports is a failure, a feature the port lacks is thrown on */
function ftFailed(call: () => number): boolean {
  try {
    return call() !== 0;
  } catch (e) {
    if (e instanceof FtError && !(e.code === FtErr.Unimplemented_Feature && /not ported/.test(e.message))) return true;
    throw e;
  }
}

export class CKTDGFreeTypeFont {
  readonly m_strFontName: string;
  /** `m_EnlargeNum`: at least 1 */
  readonly m_EnlargeNum: number;
  /** `m_iOrgFontSize`: `enlargeNum * iFontSize` (of the argument, which can be below 1 while `m_EnlargeNum` cannot) */
  readonly m_iOrgFontSize: number;
  /** `m_iFontSize`: the same until `Load` scales it by `m_ResolutionScale.y` (unless `m_bNoRes`) */
  m_iFontSize: number;
  readonly m_iOutLineSize: number;
  readonly m_iFontWeight: number;
  /** `m_iFontCacheSize`: the size of a glyph cell: the font and its outline on both sides, `m_iFontSize + 2 * (m_iOutLineSize + 1)` */
  m_iFontCacheSize: number;
  readonly m_bRHW: boolean;
  readonly m_bNoRes: boolean;
  /** `m_bLoad`: `Load` has opened the faces and made the pages */
  m_bLoad = false;

  /** `m_FreeTypeFace` / `m_FreeTypeSubFace` / `m_KoreanFreeTypeFace` (null until `Load`) */
  m_FreeTypeFace: FtFace | null = null;
  m_FreeTypeSubFace: FtFace | null = null;
  m_KoreanFreeTypeFace: FtFace | null = null;

  /** `m_pTexture[4]` / `m_pTextureOutLine[4]`: the pages (the outline ones only for a font with an outline) */
  readonly m_pTexture: (CKTDGDynamicTexture | null)[] = [null, null, null, null];
  readonly m_pTextureOutLine: (CKTDGDynamicTexture | null)[] = [null, null, null, null];
  /** `m_iCandidate[4]`: the quads `Buffering` has written to a page since its last `Flush` */
  readonly m_iCandidate = [0, 0, 0, 0];
  /** `m_apPageVertex[4]`: the vertex memory of a page, `6 * m_iNumCandidatesInAPage` vertices of 28 (`m_bRHW`) or 24 bytes */
  readonly m_apPageVertex: (ArrayBuffer | null)[] = [null, null, null, null];
  private readonly pageF32: (Float32Array | null)[] = [null, null, null, null];
  private readonly pageU32: (Uint32Array | null)[] = [null, null, null, null];
  m_iNumCandidatesInAPage = 0;
  m_iTotalCache = 0;
  m_iSizeArray = 0;
  /** `m_FontCacheArray`: the cells (`m_iTotalCache` of them) */
  m_FontCacheArray: SGCFontCache[] | null = null;
  /**
   * `m_FontCacheHashTable[65536]` (`m_pFontCache`, `m_bFontSize`, `m_size`): the index of the character's cell in `m_FontCacheArray`
   * (-1: none), whether its size is known, and that size
   */
  readonly hashCell = new Int32Array(0x10000).fill(-1);
  readonly hashSizeKnown = new Uint8Array(0x10000);
  readonly hashCx = new Int32Array(0x10000);
  readonly hashCy = new Int32Array(0x10000);
  /** `m_dwCurrentStamp` (a DWORD): the "time" of the least-recently-used rule */
  m_dwCurrentStamp = 1;
  /** `m_RenderStateID`: `s_akStates` */
  readonly m_RenderStateID: KStateID = RSI_FREETYPE_FONT;

  /**
   * `owner` is what the exe reads from `g_pKTDXApp->m_pDGManager->m_pFontManager` (the `FT_Library`, the font files); without one
   * (a font that only has sizes) `Load` is an error.
   */
  constructor(
    strFontName: string,
    iFontSize: number,
    iOutLineSize: number,
    bRHW: boolean,
    fontWeight: number,
    enlargeNum: number,
    bNoRes: boolean,
    private readonly owner: FontOwner | null = null,
  ) {
    this.m_strFontName = strFontName;
    this.m_EnlargeNum = enlargeNum < 1 ? 1 : enlargeNum;
    this.m_iFontSize = this.m_iOrgFontSize = Math.imul(enlargeNum, iFontSize);
    this.m_iOutLineSize = iOutLineSize;
    this.m_iFontWeight = fontWeight;
    this.m_iFontCacheSize = (this.m_iFontSize + 2 * (iOutLineSize + 1)) | 0;
    this.m_bRHW = bRHW;
    this.m_bNoRes = bNoRes;
  }

  private get host(): FontHost {
    if (!this.owner) throw new Error("CKTDGFreeTypeFont has no font manager: the exe reads g_pKTDXApp->m_pDGManager->m_pFontManager");
    return this.owner.host;
  }

  /** `g_pKTDXApp->m_ResolutionScale` (1, 1 without a render: no back buffer to scale to) */
  get resolutionScale(): { readonly x: number; readonly y: number } {
    return this.host.render?.resolutionScale ?? { x: 1, y: 1 };
  }

  /** what the page textures reach */
  private textureHost(): DynamicTextureHost {
    const host = this.host;
    return { device: host.devices.d3dDevice, target: host.render, log: host.devices.massFiles.log };
  }

  /** the vertex type (and stride) a quad is written in */
  private get vertexStride(): number {
    return this.m_bRHW ? 28 : 24;
  }

  // ---- Load (328DAC90) ---------------------------------------------------------------------------------------------------------------

  /**
   * `Load()`: size, faces, pages, cells.  The font size is scaled by `m_ResolutionScale.y` (unless `m_bNoRes`) and cut to an integer.
   * A face that cannot be opened (no installed file, or FreeType refuses it) is `FT_New_Memory_Face` error 0x1AA and a message box
   * `"Font Load Error!"` (the text is the font's name; for the Korean face `GULIM`); a size FreeType refuses is `"Font Size Error!"`
   * with the log text `FT_Set_Char_Size`; a page that cannot be made is error 6 (7 for an outline page) with the font's name.  The
   * answer is false then; true when it is loaded already.
   */
  Load(): boolean {
    if (this.m_bLoad) return true;
    const host = this.host;
    const owner = this.owner!;
    const log = host.devices.massFiles.log;
    let org = f(this.m_iOrgFontSize);
    if (!this.m_bNoRes) org = f(org * (host.render ? host.render.resolutionScale.y : 1));
    this.m_iFontSize = ftoi(org);
    const cell = (this.m_iFontSize + 2 * this.m_iOutLineSize + 2) | 0;
    this.m_iFontCacheSize = cell;
    this.m_iNumCandidatesInAPage = Math.imul(idiv(3 * 256, cell), idiv(256, cell));
    const name = this.m_strFontName;

    const openFace = (fontName: string): { face: FtFace | null; failed: boolean } => {
      const mem = owner.GetFontMemory(fontName);
      if (mem.length === 0) return { face: null, failed: true };
      try {
        return { face: FtFace.open(mem, 0, owner.m_FreeTypeLibrary), failed: false };
      } catch (e) {
        if (e instanceof FtError && !(e.code === FtErr.Unimplemented_Feature && /not ported/.test(e.message))) return { face: null, failed: true };
        throw e;
      }
    };
    const sizeFails = (face: FtFace): boolean => ftFailed(() => setCharSize(face, this.m_iFontSize << 6, 0, 72, 72));

    // the font's own face
    const main = openFace(name);
    if (main.failed) {
      log.push(0x1aa, "FT_New_Memory_Face");
      host.messageBox(name, "Font Load Error!");
      return false;
    }
    this.m_FreeTypeFace = main.face;
    if (sizeFails(main.face!)) {
      host.messageBox(name, "Font Size Error!");
      log.push(0x1aa, "FT_Set_Char_Size");
      return false;
    }
    // the sub face (JhengHeiBold): when it cannot be opened the exe reports the MAIN font's name as the one that did not load
    const sub = openFace("JhengHeiBold");
    if (sub.failed) {
      log.push(0x1aa, "FT_New_Memory_Face");
      host.messageBox(name, "Font Load Error!");
      return false;
    }
    this.m_FreeTypeSubFace = sub.face;
    if (sizeFails(sub.face!)) {
      host.messageBox(name, "Font Size Error!");
      log.push(0x1aa, "FT_Set_Char_Size");
      return false;
    }
    // the Korean face, unless the font is GULIM itself (an exact, case-sensitive comparison)
    if (name !== "GULIM") {
      const kor = openFace("GULIM");
      if (kor.failed) {
        log.push(0x1aa, "FT_New_Memory_Face");
        host.messageBox("GULIM", "Font Load Error!");
        return false;
      }
      this.m_KoreanFreeTypeFace = kor.face;
      if (sizeFails(kor.face!)) {
        log.push(0x1aa, "FT_Set_Char_Size");
        host.messageBox("GULIM", "Font Size Error!");
        return false;
      }
    }
    // four pages (and four outline pages)
    for (let page = 0; page < 4; page++) {
      const tex = new CKTDGDynamicTexture(this.textureHost());
      this.m_pTexture[page] = tex;
      if (!tex.CreateTexture(256, 256, 21)) {
        log.push(6, name);
        return false;
      }
      if (this.m_iOutLineSize > 0) {
        const outline = new CKTDGDynamicTexture(this.textureHost());
        this.m_pTextureOutLine[page] = outline;
        if (!outline.CreateTexture(256, 256, 21)) {
          log.push(7, name);
          return false;
        }
      }
    }
    this.m_iSizeArray = 0;
    this.m_iTotalCache = Math.imul(idiv(4 * 256, cell), idiv(256, cell));
    this.m_FontCacheArray = Array.from({ length: this.m_iTotalCache }, () => new SGCFontCache());
    this.hashCell.fill(-1);
    this.hashSizeKnown.fill(0);
    this.hashCx.fill(0);
    this.hashCy.fill(0);
    for (let page = 0; page < 4; page++) {
      const bytes = 6 * this.m_iNumCandidatesInAPage * this.vertexStride;
      const buffer = new ArrayBuffer(bytes);
      this.m_apPageVertex[page] = buffer;
      this.pageF32[page] = new Float32Array(buffer);
      this.pageU32[page] = new Uint32Array(buffer);
    }
    this.m_bLoad = true;
    return true;
  }

  // ---- the glyph cache ----------------------------------------------------------------------------------------------------------------

  /** the page texture of a cell: the exe indexes `m_pTexture[iPage]` with whatever `iPage` the cell has */
  private pageTexture(page: number, outline: boolean): CKTDGDynamicTexture {
    if (page > 3) {
      // m_pTexture[4..7] is m_pTextureOutLine[0..3] in the object, and m_pTextureOutLine[4] is m_iCandidate[0]: not a texture at all
      const alias = page < 8 && !outline ? this.m_pTextureOutLine[page - 4] : null;
      if (!alias) throw new Error(`CKTDGFreeTypeFont: glyph cell on page ${page}: m_pTexture[${page}] is not a texture (m_iTotalCache is above 4 pages of cells); the exe crashes here`);
      return alias;
    }
    const tex = outline ? this.m_pTextureOutLine[page] : this.m_pTexture[page];
    if (!tex) throw new Error(`CKTDGFreeTypeFont: no ${outline ? "outline " : ""}page ${page} (not loaded?): the exe dereferences null here`);
    return tex;
  }

  /**
   * `CharToSystemTexture(cache)` (328DA300): the glyph of `cache._Char` from the first of the three faces that has it, drawn into the
   * cell (`iWidth` x `iHeight`, set here) of the page, and into the outline page when the font has an outline.  A character no face
   * has leaves the cell as it was (a new cell is all zero: nothing is drawn, the character is `-1` / `-2` wide).
   */
  CharToSystemTexture(cache: SGCFontCache): void {
    let face: FtFace | null = null;
    for (const candidate of [this.m_FreeTypeFace, this.m_FreeTypeSubFace, this.m_KoreanFreeTypeFace]) {
      if (!candidate) continue;
      const index = candidate.getCharIndex(cache._Char);
      if (index !== 0 && !ftFailed(() => loadGlyph(candidate, index, 8)) && !ftFailed(() => renderGlyph(candidate.glyph, 0))) {
        face = candidate;
        break;
      }
    }
    if (!face) return;
    const glyph = face.glyph;
    const outline = this.m_iOutLineSize;
    const bm = glyph.bitmap;
    const width = bm.width, rows = bm.rows;
    let owidth = width, orows = rows;
    let obitmap: Bitmap | null = null;
    if (outline > 0) {
      obitmap = new Bitmap();
      bitmapCopy(bm, obitmap);
      bitmapEmbolden(obitmap, outline << 7, outline << 7);
      owidth = obitmap.width;
      orows = obitmap.rows;
    }
    const bearing = glyph.metrics.horiBearingX >> 6;
    const xOff = bearing <= 0 ? 0 : bearing; // v45
    const advance = glyph.metrics.horiAdvance;
    const yOff = (face.size.metrics.ascender - glyph.metrics.horiBearingY) >> 6; // v47
    let cw = (advance >> 6) + 2 * outline;
    let cell = this.m_iFontCacheSize;
    if (cw <= owidth) cw = owidth;
    let ch = yOff + orows + 1;
    if (ch >= cell) ch = cell;
    cache.iHeight = ch;
    if (cw < cell) cell = cw;
    cache.iWidth = cell;
    cache._texRight = f(f(f(cell + cache.iLeft) + 0.5) * PIXEL_TO_TEX);
    cache._texBottom = f(f(f(ch + cache.iTop) + 0.5) * PIXEL_TO_TEX);
    const pBits = this.pageTexture(cache.iPage, false).pBits!;
    const oBits = outline > 0 ? this.pageTexture(cache.iPage, true).pBits! : null;
    const src = bm.buffer, osrc = obitmap?.buffer ?? null;
    for (let r = 0; r < cache.iHeight; r++) {
      const y = r - outline - yOff;
      const oy = r - yOff;
      for (let c = 0; c < cache.iWidth; c++) {
        const x = c - outline - xOff;
        const at = c + cache.iLeft + (r << 8) + (cache.iTop << 8);
        pBits[at] = y < 0 || y >= rows || x < 0 || x >= width ? 0 : (((src![width * y + x]! << 24) | 0xffffff) >>> 0);
        if (outline > 0) {
          const ox = c - xOff;
          oBits![at] = oy < 0 || oy >= orows || ox < 0 || ox >= owidth ? 0 : (((osrc![owidth * oy + ox]! << 24) | 0xffffff) >>> 0);
        }
      }
    }
  }

  /**
   * `GetFontCache(ch)` (328DA870): the cell of a character.  A cached one gets the newest stamp; a new one takes the next free cell
   * (page `i / v^2`, column `i % v^2 % v`, row `i % v^2 / v`, `v = 256 / cell`) or, when there is none, the cell with the oldest stamp
   * (the first of equals; `(int)(oldest - this) > 0`), which is taken from its previous character's hash entry.
   */
  GetFontCache(ch: number): SGCFontCache {
    ch &= 0xffff;
    const cells = this.m_FontCacheArray;
    if (!cells) throw new Error("CKTDGFreeTypeFont::GetFontCache before Load: the exe dereferences a null m_FontCacheArray");
    const hit = this.hashCell[ch]!;
    if (hit >= 0) {
      const cache = cells[hit]!;
      cache.dwLastUse = this.m_dwCurrentStamp;
      this.m_dwCurrentStamp = (this.m_dwCurrentStamp + 1) >>> 0;
      return cache;
    }
    if (this.m_iSizeArray < this.m_iTotalCache) {
      const i = this.m_iSizeArray;
      this.hashCell[ch] = i;
      const cache = cells[i]!;
      const v = idiv(256, this.m_iFontCacheSize);
      const inPage = i % (v * v);
      cache.iPage = idiv(i, v * v);
      cache.iLeft = Math.imul(this.m_iFontCacheSize, inPage % v);
      cache.iTop = Math.imul(this.m_iFontCacheSize, idiv(inPage, v));
      cache._texLeft = f(f(cache.iLeft + 0.5) * PIXEL_TO_TEX);
      cache._texTop = f(f(cache.iTop + 0.5) * PIXEL_TO_TEX);
      cache._Char = ch;
      cache.dwLastUse = this.m_dwCurrentStamp;
      this.m_dwCurrentStamp = (this.m_dwCurrentStamp + 1) >>> 0;
      this.fillCell(cache);
      this.m_iSizeArray++;
      return cache;
    }
    let victim = 0;
    let oldest = cells[0]!.dwLastUse;
    for (let i = 1; i < this.m_iTotalCache; i++) {
      const stamp = cells[i]!.dwLastUse;
      if (((oldest - stamp) | 0) > 0) {
        oldest = stamp;
        victim = i;
      }
    }
    const cache = cells[victim]!;
    this.hashCell[cache._Char] = -1;
    this.hashCell[ch] = victim;
    cache._Char = ch;
    cache.dwLastUse = this.m_dwCurrentStamp;
    this.m_dwCurrentStamp = (this.m_dwCurrentStamp + 1) >>> 0;
    this.fillCell(cache);
    return cache;
  }

  /** the end of both branches of `GetFontCache`: draw the glyph and tell the pages which rectangle changed */
  private fillCell(cache: SGCFontCache): void {
    this.CharToSystemTexture(cache);
    const rect: Rect = { left: cache.iLeft, top: cache.iTop, right: cache.iLeft + cache.iWidth, bottom: cache.iTop + cache.iHeight };
    this.pageTexture(cache.iPage, false).SetChange(rect);
    const outline = cache.iPage < 4 ? this.m_pTextureOutLine[cache.iPage] : null;
    if (outline) outline.SetChange(rect);
  }

  // ---- measuring -----------------------------------------------------------------------------------------------------------------------

  /** `_EstimateFontSize(wChar, &size)` (328DCFA0): the size of a character as `GetFontCache` knows it, cut to what the layout uses */
  _EstimateFontSize(wChar: number): { cx: number; cy: number } {
    wChar &= 0xffff;
    if (wChar === 13) return { cx: 0, cy: 0 };
    this.knowSize(wChar);
    return { cx: this.hashCx[wChar]!, cy: this.hashCy[wChar]! };
  }

  private knowSize(ch: number): void {
    if (this.hashSizeKnown[ch]) return;
    this.hashSizeKnown[ch] = 1;
    const cache = this.GetFontCache(ch);
    this.hashCx[ch] = (cache.iWidth - 2 * this.m_iOutLineSize - 1) | 0;
    this.hashCy[ch] = (cache.iHeight - 2 * this.m_iOutLineSize - 1) | 0;
  }

  /** `_EstimateStringWidth(str, size)` (328DD090): the sum of the characters' widths (a CR has none) */
  _EstimateStringWidth(str: string, size: number): number {
    if (size <= 0) return 0;
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const c = str.charCodeAt(i) & 0xffff; // past the end the exe reads the terminator
      if (c === 13) continue;
      this.knowSize(c);
      sum = (sum + this.hashCx[c]!) | 0;
    }
    return sum;
  }

  /**
   * `_EstimateStringHeight(str, size)` (328DD020): `m_iFontSize + 1` for every LF; any other character counts only when it is the last
   * of the `size` (a CR too: a CR in the middle counts nothing).  A text of one line without LF is one line, counted at its last character.
   */
  _EstimateStringHeight(str: string, size: number): number {
    if (size <= 0) return 0;
    let height = 0;
    const last = size - 1;
    for (let i = 0; i < size; i++) {
      const c = str.charCodeAt(i);
      if (c === 13) {
        if (i === last) height = (height + this.m_iFontSize + 1) | 0;
      } else if (c !== 10) {
        if (i === last) height = (height + this.m_iFontSize + 1) | 0;
      } else {
        height = (height + this.m_iFontSize + 1) | 0;
      }
    }
    return height;
  }

  /** the width of one line as the layout counts it: the characters' widths in enlarged pixels, divided by `m_EnlargeNum`, plus the outline's share */
  private lineWidth(buf: string): number {
    const n = buf.length;
    let w = idiv(this._EstimateStringWidth(buf, n), this.m_EnlargeNum);
    if (this.m_iOutLineSize !== 0) w = (w + Math.imul(n, 2 * this.m_iOutLineSize - 1)) | 0;
    return w;
  }

  /**
   * The loop `GetWidth`, `OutTextXY` and `OutTextMultiline` share: the characters of the first `n` of `text` without the colour codes
   * (`#c` + six digits: 8 characters; `#cx`: 3) go into a buffer; an LF measures the buffer and clears it; the answer is the widest
   * line.  A NUL is skipped.
   */
  private widest(text: string, n: number): number {
    let buf = "";
    let max = 0;
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c === 10) {
        const w = this.lineWidth(buf);
        if (w > max) max = w;
        buf = "";
      } else if (c === 35) {
        if (i < n - 1) {
          const next = text.charCodeAt(i + 1);
          if (next === 99 || next === 67) {
            const code = text.charCodeAt(i + 2);
            i += code === 120 || code === 88 ? 2 : 7;
            continue;
          }
        }
        buf += "#";
      } else if (c !== 0 && !Number.isNaN(c)) {
        buf += String.fromCharCode(c);
      }
    }
    const w = this.lineWidth(buf);
    return w > max ? w : max;
  }

  /** `GetWidth(wszText, nCount)` (328DAAD0): the width of the widest line of the first `nCount` characters (all of them when negative) */
  GetWidth(wszText: string | null, nCount: number): number {
    if (wszText === null) return 0;
    if (nCount === 0 || wcslen(wszText) === 0) return 0;
    return this.widest(wszText, nCount < 0 ? wcslen(wszText) : nCount);
  }

  // ---- drawing -------------------------------------------------------------------------------------------------------------------------

  /**
   * `Buffering(bOutLine, iLeft, iTop, str, color, DefColor, bNoColor, nCount, fScaleX, fScaleY, iRight)` (328D9D40): a quad per
   * character, written into the vertex memory of the character's page.  The pen starts at `iLeft` and moves by the cell's width
   * `- 1` (`- 2` with an outline) times the scale; it stops once it is past `iRight` (when that is above 0).  A page whose quads
   * are used up is flushed first.  `color` is the ARGB of the glyphs (`bNoColor` keeps the colour codes from changing it).
   */
  Buffering(
    bOutLine: boolean,
    iLeft: number,
    iTop: number,
    str: string | null,
    color: number,
    DefColor: number,
    bNoColor: boolean,
    nCount: number,
    fScaleX: number,
    fScaleY: number,
    iRight: number,
  ): void {
    if (str === null) return;
    const n = nCount < 0 ? wcslen(str) : nCount;
    let x = f(iLeft);
    let col = color >>> 0;
    let iCol = 0;
    const top = f(iTop);
    if (n <= 0) return;
    const last = n - 1;
    for (let i = 0; iRight <= 0 || x <= f(iRight); ) {
      const c = str.charCodeAt(i) || 0;
      if (c !== 10 && c !== 13) {
        const next = str.charCodeAt(i + 1);
        if (c === 35 && i !== last && (next === 67 || next === 99)) {
          const code = str.charCodeAt(i + 2);
          if (code === 88 || code === 120) {
            i += 2;
            if (!bNoColor) col = DefColor >>> 0;
          } else {
            if (!bNoColor) {
              const digits = wcslenSlice(str, i + 2, 6);
              const v = scanHex(digits);
              if (v !== null) iCol = v;
              col = ((iCol | (col & 0xff000000)) >>> 0);
            }
            i += 7;
          }
        } else {
          const fc = this.GetFontCache(c);
          if (fc.iPage > 3) return;
          const page = fc.iPage;
          if (this.m_apPageVertex[page] === null) {
            this.m_iCandidate[page] = 0;
            return;
          }
          if (this.m_iCandidate[page]! >= this.m_iNumCandidatesInAPage) {
            this.Flush(bOutLine, page);
            if (this.m_iCandidate[page]! >= this.m_iNumCandidatesInAPage) {
              this.m_iCandidate[page] = 0;
              return;
            }
          }
          this.writeQuad(page, this.m_iCandidate[page]!, x, top, fc, col, fScaleX, fScaleY);
          const advance = (-(this.m_iOutLineSize !== 0 ? 1 : 0) - 1 + idiv(fc.iWidth, this.m_EnlargeNum)) | 0;
          this.m_iCandidate[page]!++;
          x = f(x + f(f(advance) * fScaleX));
        }
      }
      if (++i >= n) return;
    }
  }

  /** the six vertices of a glyph's quad (two triangles), in the order and with the arithmetic of `Buffering` */
  private writeQuad(page: number, slot: number, x: number, top: number, fc: SGCFontCache, col: number, fScaleX: number, fScaleY: number): void {
    const v = this.pageF32[page]!;
    const u = this.pageU32[page]!;
    const w = f(f(fc.iWidth) * fScaleX);
    const h = f(f(fc.iHeight) * fScaleY);
    let insetX = 0, insetY = 0;
    if (this.m_EnlargeNum > 1) {
      insetX = f(f(idiv(fc.iWidth, 4 * this.m_EnlargeNum - 4)) * fScaleX);
      insetY = f(f(idiv(fc.iHeight, 2 * this.m_EnlargeNum - 2)) * fScaleY);
    }
    const { _texLeft: u0, _texRight: u1, _texTop: v0, _texBottom: v1 } = fc;
    if (this.m_bRHW) {
      const b = 42 * slot;
      const x0 = f(insetX + x);
      const x1 = f(f(w + x) - insetX);
      const y1 = f(f(top + h) - insetY);
      const put = (k: number, px: number, py: number, pu: number, pv: number): void => {
        const o = b + 7 * k;
        v[o] = px; v[o + 1] = py; v[o + 2] = 0; v[o + 3] = 1; u[o + 4] = col; v[o + 5] = pu; v[o + 6] = pv;
      };
      put(0, x0, top, u0, v0);
      put(1, x1, top, u1, v0);
      put(2, x0, y1, u0, v1);
      put(3, x1, top, u1, v0);
      put(4, x1, y1, u1, v1);
      put(5, x0, y1, u0, v1);
    } else {
      const b = 36 * slot;
      const x1 = f(w + x);
      const y1 = f(top - h);
      const put = (k: number, px: number, py: number, pu: number, pv: number): void => {
        const o = b + 6 * k;
        v[o] = px; v[o + 1] = py; v[o + 2] = 0.5; u[o + 3] = col; v[o + 4] = pu; v[o + 5] = pv;
      };
      put(0, x, top, u0, v0);
      put(1, x1, top, u1, v0);
      put(2, x, y1, u0, v1);
      put(3, x1, top, u1, v0);
      put(4, x1, y1, u1, v1);
      put(5, x, y1, u0, v1);
    }
  }

  /**
   * `Flush(bOutLine, iPage)` (328DA610): draw the quads of page `iPage` (all four pages when it is negative) with the font's states, the
   * page's texture (the outline's when `bOutLine`) on stage 0, and forget them.  A page past 3 is left alone.
   */
  Flush(bOutLine: boolean, iPage: number): void {
    if (iPage >= 4) return;
    const first = iPage < 0 ? 0 : iPage;
    const lastPage = iPage < 0 ? 3 : iPage;
    const render = this.host.render;
    const stack = render ? new KD3DStack(render.states, this.m_RenderStateID) : null;
    try {
      for (let p = first; p <= lastPage; p++) {
        if (this.m_iCandidate[p] !== 0) {
          const memory = this.m_apPageVertex[p];
          if (memory) {
            const tex = bOutLine ? this.m_pTextureOutLine[p] : this.m_pTexture[p];
            if (!tex) throw new Error(`CKTDGFreeTypeFont::Flush: no ${bOutLine ? "outline " : ""}page ${p}: the exe dereferences null here`);
            tex.SetTexture(0);
            render?.dvb.drawPrimitive(this.m_bRHW ? DVB_XYZRHW_DIFFUSE_TEX1 : DVB_XYZ_DIFFUSE_TEX1, D3DPT_TRIANGLELIST, 2 * this.m_iCandidate[p]!, new Uint8Array(memory), 1);
          }
          this.m_iCandidate[p] = 0;
        }
      }
    } finally {
      stack?.dispose();
    }
  }

  /**
   * The x a line starts at (the part of `OutTextXY` / `OutTextMultiline` before `Buffering`): with a rectangle `pRt`, flag 1 centres
   * the line in it and flag 2 puts its right end at `pRt->right`; without one flag 1 centres on `iLeft` and flag 2 ends the line at
   * `iLeft + m_iFontSize / m_EnlargeNum`.  `width` is the widest line (0 when `nCount` is 0).
   */
  private alignX(iLeft: number, pRt: Rect | null, dwFlag: number, width: () => number, fScaleX: number): number {
    if (pRt) {
      if (dwFlag & 1) {
        const rectWidth = (pRt.right - pRt.left) | 0;
        return (pRt.left - ftoi(f(f(f(rectWidth) - f(f(width()) * fScaleX)) * -0.5))) | 0;
      }
      if ((dwFlag & 2) === 0) return iLeft;
      return (pRt.right - ftoi(f(f(width()) * fScaleX))) | 0;
    }
    if (dwFlag & 1) return (iLeft - ftoi(f(f(f(width()) * fScaleX) * 0.5))) | 0;
    if ((dwFlag & 2) === 0) return iLeft;
    return (iLeft + ftoi(f(f(idiv(this.m_iFontSize, this.m_EnlargeNum)) - f(f(width()) * fScaleX)))) | 0;
  }

  /**
   * `OutTextXY(iLeft, iTop, wszText, color, colorOutLine, pRt, dwFlag, nCount, fScaleX, fScaleY)` (328DC670): one text at (`iLeft`, `iTop`),
   * placed by `dwFlag` (1: centred, 2: right-aligned; see `alignX`) and clipped at `pRt->right` when the rectangle has a width.  An
   * LF in the text only matters for the alignment (the measuring stops a line there).  The pen runs over the whole text.  The stamp of
   * the glyph cache restarts at `timeGetTime()`.  With an outline the outline pass (colour `colorOutLine`, `bNoColor`) comes first; the
   * main pass honours the colour codes unless `dwFlag` has a bit of 0xF0000000.
   */
  OutTextXY(
    iLeft: number,
    iTop: number,
    wszText: string | null,
    color: number,
    colorOutLine: number,
    pRt: Rect | null,
    dwFlag: number,
    nCount: number,
    fScaleX: number,
    fScaleY: number,
  ): void {
    if (wszText === null || wcslen(wszText) === 0) return;
    const x = this.alignX(iLeft, pRt, dwFlag, () => (nCount !== 0 ? this.widest(wszText, nCount >= 0 ? nCount : wcslen(wszText)) : 0), fScaleX);
    this.m_dwCurrentStamp = this.host.clock() >>> 0;
    const right = pRt && pRt.right > pRt.left ? pRt.right : 0;
    if (this.m_iOutLineSize !== 0) {
      this.Buffering(true, x, iTop, wszText, colorOutLine, colorOutLine, true, nCount, fScaleX, fScaleY, right);
      this.Flush(true, -1);
    }
    this.Buffering(false, x, iTop, wszText, color, color, (dwFlag & 0xf0000000) !== 0, nCount, fScaleX, fScaleY, right);
    this.Flush(false, -1);
  }

  /**
   * `OutTextMultiline(iLeft, iTop, wszText, color, colorOutLine, fLineSpace, pRt, dwFlag, nCount, fScaleX, fScaleY)` (328DB3F0): the first
   * `nCount` characters (all when negative, at most 2999: the exe copies them into a static 3000-character buffer) cut into lines at
   * every CR and LF; each line is aligned on its own width and drawn with `Buffering`; an LF (not a CR) moves the next line down by
   * `(int)((m_iFontCacheSize / m_EnlargeNum - 1) * fLineSpace * fScaleY)` (up for a font that is not `m_bRHW`).  The colour of a line
   * starts again at `color`.  A text that ends in a CR / LF has no empty last line.  The outline pass comes first.
   */
  OutTextMultiline(
    iLeft: number,
    iTop: number,
    wszText: string | null,
    color: number,
    colorOutLine: number,
    fLineSpace: number,
    pRt: Rect | null,
    dwFlag: number,
    nCount: number,
    fScaleX: number,
    fScaleY: number,
  ): void {
    if (wszText === null || wcslen(wszText) === 0 || nCount === 0) return;
    let len = wcslen(wszText);
    if (nCount >= 0 && nCount < len) len = nCount;
    const n = Math.min(len, 2999);
    const text = wszText.slice(0, n);
    const step = ftoi(f(f(f(idiv(this.m_iFontCacheSize, this.m_EnlargeNum) - 1) * fLineSpace) * fScaleY));
    const right = pRt && pRt.right > pRt.left ? pRt.right : 0;
    const pass = (outlinePass: boolean): void => {
      const lineColor = outlinePass ? colorOutLine : color;
      let y = iTop;
      let start = 0;
      const line = (end: number): void => {
        const s = text.slice(start, end);
        const len = s.length;
        const x = this.alignX(iLeft, pRt, dwFlag, () => (len === 0 ? 0 : this.widest(s, len)), fScaleX);
        this.Buffering(outlinePass, x, y, s, lineColor, color, outlinePass ? true : (dwFlag & 0xf0000000) !== 0, -1, fScaleX, fScaleY, right);
      };
      for (let i = 0; i < n; i++) {
        const c = text.charCodeAt(i);
        if (c === 13 || c === 10) {
          line(i);
          if (c === 10) y = this.m_bRHW ? (y + step) | 0 : (y - step) | 0;
          start = i + 1;
        } else if (i === n - 1) {
          line(n);
        }
      }
    };
    if (this.m_iOutLineSize !== 0) {
      pass(true);
      this.Flush(true, -1);
    }
    pass(false);
    this.Flush(false, -1);
  }
}

/** `_wcsncpy_s(dest, 7, &str[at], 6)`: up to `count` characters from `at`, stopping at the end or a NUL */
function wcslenSlice(str: string, at: number, count: number): string {
  const part = str.slice(at, at + count);
  return part.slice(0, wcslen(part));
}
