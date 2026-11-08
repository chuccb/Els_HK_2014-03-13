import { describe, expect, test } from "bun:test";
import { packColor, UKFont } from "../src/font.ts";
import { drawnCalls, E_FAIL } from "./rig.ts";
import type { DrawnCall } from "./rig.ts";
import { fontWorld, HUGE, LETTERS, NOT_A_FONT, pageQuads, rhwQuad, SHAPES, xyzQuad } from "./fontworld.ts";

/**
 * CKTDGFreeTypeFont (freetypefont.ts): every expectation below is worked out by hand from the decompile (the addresses are in the header
 * comment of the port) and from the box fonts of fontworld.ts, whose glyphs have the metrics the table there lists at 16 px.
 */

const D3DERR_OUTOFVIDEOMEMORY = -2005532292;
const code = (c: string) => c.charCodeAt(0);

describe("Load (328DAC90)", () => {
  test("the font size is scaled by the resolution (y), the cell is size + 2 * outline + 2, the pages hold (768 / cell) * (256 / cell) candidates and (1024 / cell) * (256 / cell) cells", () => {
    const { font, dev } = fontWorld(); // back buffer 1536 x 1536: scale (1.5, 2)
    const ft = font(8, 0, 2); // enlarge 2: 16 px as the layout has it
    // before Load: the constructor's numbers (unscaled): 2 * 8, and a cell of 16 + 2 * (0 + 1)
    expect([ft.m_EnlargeNum, ft.m_iOrgFontSize, ft.m_iFontSize, ft.m_iFontCacheSize, ft.m_bLoad]).toEqual([2, 16, 16, 18, false]);
    expect(ft.Load()).toBe(true);
    // (int)(16 * 2) = 32, a cell of 34, 768 / 34 = 22 and 256 / 34 = 7, 1024 / 34 = 30
    expect([ft.m_iFontSize, ft.m_iOrgFontSize, ft.m_iFontCacheSize, ft.m_iNumCandidatesInAPage, ft.m_iTotalCache, ft.m_FontCacheArray!.length, ft.m_iSizeArray]).toEqual([32, 16, 34, 22 * 7, 30 * 7, 210, 0]);
    // 6 vertices of 28 bytes (x, y, z, rhw, color, u, v) for each candidate of each of the 4 pages
    expect(ft.m_apPageVertex.map((b) => b!.byteLength)).toEqual([4, 4, 4, 4].map(() => 6 * 154 * 28));
    expect(ft.m_bLoad).toBe(true);
    // the faces are set to 32 px (the boxes' head table has the flag 8: the ascender is rounded to whole pixels): 800 * 32 / 1024 = 25 px,
    // the sub font's 700 * 32 / 1024 = 21.875 -> 22, the Korean 900 * 32 / 1024 = 28.125 -> 28
    expect([ft.m_FreeTypeFace!.size.metrics.ascender, ft.m_FreeTypeSubFace!.size.metrics.ascender, ft.m_KoreanFreeTypeFace!.size.metrics.ascender]).toEqual([25 * 64, 22 * 64, 28 * 64]);
    // 4 pages, each a system texture then a video texture; no outline pages
    expect(dev!.log).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => `create ${i} pool ${i % 2 === 0 ? 2 : 0} 256x256`));
    expect(ft.m_pTextureOutLine.every((t) => t === null)).toBe(true);
    expect(ft.m_pTexture.map((t, p) => t!.m_pTextureSys === dev!.textures[2 * p]! as never)).toEqual([true, true, true, true]);
  });

  test("a font that does not follow the resolution (bNoRes) keeps its size; the vertex memory of a font that is not RHW is 24 bytes a vertex", () => {
    const { font } = fontWorld();
    const ft = font(16, 0, 1, true);
    expect(ft.Load()).toBe(true);
    // 768 / 18 = 42, 256 / 18 = 14, 1024 / 18 = 56
    expect([ft.m_iFontSize, ft.m_iFontCacheSize, ft.m_iNumCandidatesInAPage, ft.m_iTotalCache]).toEqual([16, 18, 42 * 14, 56 * 14]);
    expect(ft.m_apPageVertex[2]!.byteLength).toBe(6 * 588 * 28);
    const flat = font(16, 0, 1, true, false);
    flat.Load();
    expect(flat.m_apPageVertex[2]!.byteLength).toBe(6 * 588 * 24);
    expect(flat.m_apPageVertex[0]).not.toBe(flat.m_apPageVertex[1]);
    // 800 / 64 = 12.5 -> 13, 700 / 64 = 10.9 -> 11, 900 / 64 = 14.06 -> 14
    expect([ft.m_FreeTypeFace!.size.metrics.ascender, ft.m_FreeTypeSubFace!.size.metrics.ascender, ft.m_KoreanFreeTypeFace!.size.metrics.ascender]).toEqual([13 * 64, 11 * 64, 14 * 64]);
  });

  test("an outline adds 2 to the cell for each pixel and a second set of pages, made after the page they belong to", () => {
    const { font, dev } = fontWorld();
    const ft = font(16, 1, 1, true);
    expect(ft.Load()).toBe(true);
    // a cell of 16 + 2 + 2 = 20: 768 / 20 = 38, 256 / 20 = 12, 1024 / 20 = 51
    expect([ft.m_iFontCacheSize, ft.m_iNumCandidatesInAPage, ft.m_iTotalCache]).toEqual([20, 38 * 12, 51 * 12]);
    expect(dev!.log).toEqual(Array.from({ length: 16 }, (_, i) => `create ${i} pool ${i % 2 === 0 ? 2 : 0} 256x256`));
    expect(ft.m_pTexture.map((t) => dev!.textures.indexOf(t!.m_pTextureSys as never))).toEqual([0, 4, 8, 12]);
    expect(ft.m_pTextureOutLine.map((t) => dev!.textures.indexOf(t!.m_pTextureSys as never))).toEqual([2, 6, 10, 14]);
  });

  test("the cells of the seven fonts of the client: 17 / 19 / 21 / 27 / 37 with an outline, 15 / 19 without; the totals are NOT always 4 pages of cells (689 against 676 for 19)", () => {
    const { font } = fontWorld();
    // (height, outline) -> cell, candidates in a page, total
    const table: [number, number, number, number, number][] = [
      [13, 1, 17, 45 * 15, 60 * 15],
      [15, 1, 19, 40 * 13, 53 * 13],
      [17, 1, 21, 36 * 12, 48 * 12],
      [23, 1, 27, 28 * 9, 37 * 9],
      [33, 1, 37, 20 * 6, 27 * 6],
      [13, 0, 15, 51 * 17, 68 * 17],
      [17, 0, 19, 40 * 13, 53 * 13],
    ];
    for (const [h, o, cell, cand, total] of table) {
      const ft = font(h, o, 1, true);
      ft.Load();
      expect([h, o, ft.m_iFontCacheSize, ft.m_iNumCandidatesInAPage, ft.m_iTotalCache]).toEqual([h, o, cell, cand, total]);
    }
    // the candidates and the totals of the notes (FINDINGS 17.12)
    expect([675, 520, 432, 252, 120, 867, 520]).toEqual(table.map((r) => r[3]));
    expect([900, 689, 576, 333, 162, 1156, 689]).toEqual(table.map((r) => r[4]));
    expect(53 * 13).toBe(689);
    expect(4 * 13 * 13).toBe(676);
  });

  test("a second Load changes nothing", () => {
    const { font, dev } = fontWorld();
    const ft = font(16, 0, 1, true);
    ft.Load();
    const calls = dev!.log.length;
    const pages = [...ft.m_apPageVertex];
    expect(ft.Load()).toBe(true);
    expect(dev!.log.length).toBe(calls);
    expect(ft.m_apPageVertex).toEqual(pages);
  });

  test("a font called GULIM has no Korean face of its own (the comparison is exact: Gulim has one)", () => {
    const { font } = fontWorld();
    const gulim = font(16, 0, 1, true, true, "GULIM");
    expect(gulim.Load()).toBe(true);
    // its own face is the Korean file: ascender 900 -> 14 px
    expect([gulim.m_FreeTypeFace!.size.metrics.ascender, gulim.m_FreeTypeSubFace!.size.metrics.ascender, gulim.m_KoreanFreeTypeFace]).toEqual([14 * 64, 11 * 64, null]);
    const lower = font(16, 0, 1, true, true, "Gulim");
    expect(lower.Load()).toBe(true);
    expect(lower.m_KoreanFreeTypeFace!.size.metrics.ascender).toBe(14 * 64);
  });

  test("no file for the font: error 0x1AA FT_New_Memory_Face and a message box with the font's name; nothing is made", () => {
    const { font, w } = fontWorld({ main: null }, { device: false });
    const ft = font(16, 0, 1, true);
    expect(ft.Load()).toBe(false);
    expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x1aa, text: "FT_New_Memory_Face" }]);
    expect(w.messageBoxes).toEqual([{ text: "BOXFONT", caption: "Font Load Error!" }]);
    expect([ft.m_bLoad, ft.m_FreeTypeFace, ft.m_FreeTypeSubFace, ft.m_pTexture[0], ft.m_FontCacheArray]).toEqual([false, null, null, null, null]);
  });

  test("a file FreeType cannot open is the same error; a missing or bad sub font is reported under the MAIN font's name, a Korean one under GULIM", () => {
    for (const [files, text, faces] of [
      [{ main: NOT_A_FONT }, "BOXFONT", [false, false, false]],
      [{ sub: null }, "BOXFONT", [true, false, false]],
      [{ sub: NOT_A_FONT }, "BOXFONT", [true, false, false]],
      [{ kor: null }, "GULIM", [true, true, false]],
      [{ kor: NOT_A_FONT }, "GULIM", [true, true, false]],
    ] as const) {
      const { font, w } = fontWorld(files, { device: false });
      const ft = font(16, 0, 1, true);
      expect(ft.Load()).toBe(false);
      expect(w.devices.massFiles.log.entries).toEqual([{ id: 0x1aa, text: "FT_New_Memory_Face" }]);
      expect(w.messageBoxes).toEqual([{ text, caption: "Font Load Error!" }]);
      expect([ft.m_FreeTypeFace !== null, ft.m_FreeTypeSubFace !== null, ft.m_KoreanFreeTypeFace !== null]).toEqual([...faces]);
      expect([ft.m_bLoad, ft.m_pTexture[0]]).toEqual([false, null]);
    }
  });

  test("a page that cannot be made: the texture's own error, then 6 with the font's name (7 for an outline page); the answer is false", () => {
    // [the HRESULTs CreateTexture answers in order, the outline, the log]
    const cases: [number[], number, { id: number; text: string }[]][] = [
      [[D3DERR_OUTOFVIDEOMEMORY], 0, [{ id: 9, text: "D3DERR_OUTOFVIDEOMEMORY" }, { id: 6, text: "BOXFONT" }]],
      [[0, E_FAIL], 0, [{ id: 0x72, text: "" }, { id: 6, text: "BOXFONT" }]],
      [[0, 0, 0, 0, E_FAIL], 0, [{ id: 9, text: "" }, { id: 6, text: "BOXFONT" }]],
      [[0, 0, E_FAIL], 1, [{ id: 9, text: "" }, { id: 7, text: "BOXFONT" }]],
      [[0, 0, 0, E_FAIL], 1, [{ id: 0x72, text: "" }, { id: 7, text: "BOXFONT" }]],
    ];
    for (const [results, outline, log] of cases) {
      const { font, w, dev } = fontWorld();
      dev!.textureResults.push(...results);
      const ft = font(16, outline, 1, true);
      expect(ft.Load()).toBe(false);
      expect(w.devices.massFiles.log.entries).toEqual(log);
      expect([ft.m_bLoad, ft.m_FontCacheArray]).toEqual([false, null]);
    }
  });

  test("the glyph cache cannot be used before Load (the exe dereferences null there)", () => {
    const { font } = fontWorld();
    expect(() => font(16, 0, 1, true).GetFontCache(code("A"))).toThrow(/before Load/);
  });
});

function loaded(size = 16, outline = 0, enlarge = 1, rhw = true, files = {}) {
  const w = fontWorld(files, { device: false });
  const ft = w.font(size, outline, enlarge, true, rhw);
  expect(ft.Load()).toBe(true);
  return { ...w, ft };
}

/** the texel of a cell: a covered one is white with the coverage as alpha, one outside the bitmap is 0 */
const WHITE = (cov: number) => ((cov << 24) | 0xffffff) >>> 0;

describe("the glyph cache: a cell for each character (GetFontCache 328DA870, CharToSystemTexture 328DA300)", () => {
  test("A (advance 10, bitmap 8 x 10 at 1 / 10, yOff 3): a cell 10 wide and 3 + 10 + 1 = 14 high, the texels white with the coverage as alpha", () => {
    const { ft } = loaded();
    const a = ft.GetFontCache(code("A"));
    expect([a.iPage, a.iLeft, a.iTop, a._Char, a.iWidth, a.iHeight]).toEqual([0, 0, 0, 65, 10, 14]);
    // (cell + 0.5) / 256
    expect([a._texLeft, a._texTop, a._texRight, a._texBottom]).toEqual([0.5 / 256, 0.5 / 256, 10.5 / 256, 14.5 / 256]);
    const bits = ft.m_pTexture[0]!.pBits!;
    for (let r = 0; r < 14; r++) {
      for (let c = 0; c < 10; c++) {
        const inside = c >= 1 && c < 9 && r >= 3 && r < 13; // x = c - 0 - 1 in [0, 8), y = r - 0 - 3 in [0, 10)
        expect(bits[(r << 8) + c]).toBe(inside ? WHITE(255) : 0);
      }
    }
    // nothing outside the cell
    expect(bits[10]).toBe(0);
    expect(bits[14 << 8]).toBe(0);
  });

  test("the next cells go along the row of the page and wrap at 256 / 18 = 14 to the next row; the cell's rectangle goes to the page as changed", () => {
    const { ft } = loaded();
    const cells = [..."ABABAAA"].map((c) => c);
    expect(cells.length).toBe(7);
    const b = (ft.GetFontCache(code("A")), ft.GetFontCache(code("B")));
    // B: advance 12, bitmap 8 x 12 at 2 / 11, yOff (832 - 704) >> 6 = 2: 12 wide, 2 + 12 + 1 = 15 high; the second cell: left 18
    expect([b.iPage, b.iLeft, b.iTop, b.iWidth, b.iHeight]).toEqual([0, 18, 0, 12, 15]);
    expect([b._texLeft, b._texTop, b._texRight, b._texBottom]).toEqual([18.5 / 256, 0.5 / 256, 30.5 / 256, 15.5 / 256]);
    const bits = ft.m_pTexture[0]!.pBits!;
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 12; c++) {
        const inside = c >= 2 && c < 10 && r >= 2 && r < 14; // x = c - 2 in [0, 8), y = r - 2 in [0, 12)
        expect(bits[(r << 8) + 18 + c]).toBe(inside ? WHITE(255) : 0);
      }
    }
    expect(ft.m_pTexture[0]!.dirtyRects).toEqual([
      { left: 0, top: 0, right: 10, bottom: 14 },
      { left: 18, top: 0, right: 30, bottom: 15 },
    ]);
    // the 15th character: 14 per row, so column 0 of the second row (18 down)
    const more = [..."CDEFGHIJKLMNO"]; // 13 more distinct characters make 15 in all
    expect(more.length).toBe(13);
  });

  test("the fifteenth cell is the first of the second row; the 197th the first of the second page", () => {
    const { ft } = loaded(16, 0, 1, true, { main: LETTERS });
    const chars = [..."abcdefghijklmnopqrstuvwxyz"];
    const cells = chars.map((c) => ft.GetFontCache(code(c)));
    expect(cells.slice(12, 15).map((c) => [c.iPage, c.iLeft, c.iTop])).toEqual([[0, 18 * 12, 0], [0, 18 * 13, 0], [0, 0, 18]]);
    expect(cells[25]).toMatchObject({ iPage: 0, iLeft: 18 * 11, iTop: 18 });
  });

  test("the cells of a font of 120 px: 4 to a page (256 / 122 = 2 across), page by page", () => {
    const { ft } = loaded(120, 0, 1, true, { main: LETTERS });
    expect([ft.m_iFontCacheSize, ft.m_iTotalCache]).toEqual([122, 16]);
    const cells = [..."abcdefghijklmnop"].map((c) => ft.GetFontCache(code(c)));
    expect(cells.map((c) => [c.iPage, c.iLeft, c.iTop])).toEqual([
      [0, 0, 0], [0, 122, 0], [0, 0, 122], [0, 122, 122],
      [1, 0, 0], [1, 122, 0], [1, 0, 122], [1, 122, 122],
      [2, 0, 0], [2, 122, 0], [2, 0, 122], [2, 122, 122],
      [3, 0, 0], [3, 122, 0], [3, 0, 122], [3, 122, 122],
    ]);
  });

  test("a character that is cached is the same cell and gets the newest stamp (the stamp starts at 1 and counts up for every use)", () => {
    const { ft } = loaded();
    const a = ft.GetFontCache(code("A"));
    const b = ft.GetFontCache(code("B"));
    expect([a.dwLastUse, b.dwLastUse, ft.m_dwCurrentStamp, ft.m_iSizeArray]).toEqual([1, 2, 3, 2]);
    expect(ft.GetFontCache(code("A"))).toBe(a);
    expect([a.dwLastUse, b.dwLastUse, ft.m_dwCurrentStamp, ft.m_iSizeArray]).toEqual([3, 2, 4, 2]);
    // the stamp wraps like a DWORD
    ft.m_dwCurrentStamp = 0xffffffff;
    expect(ft.GetFontCache(code("B")).dwLastUse).toBe(0xffffffff);
    expect(ft.m_dwCurrentStamp).toBe(0);
  });

  test("a space has no bitmap: its cell is as wide as its advance (6) and 13 + 0 + 1 = 14 high, and all of it is 0", () => {
    const { ft } = loaded();
    const s = ft.GetFontCache(code(" "));
    expect([s.iWidth, s.iHeight]).toEqual([6, 14]);
    const bits = ft.m_pTexture[0]!.pBits!;
    expect(bits.every((v) => v === 0)).toBe(true);
  });

  test("a bitmap wider than the advance sets the width (W: 16 against 8); one wider or taller than the cell is cut to it (M: 32 wide, T: 22 high, cell 18)", () => {
    const { ft } = loaded();
    const w = ft.GetFontCache(code("W"));
    // 16 x 5 at (0, 5), yOff 8
    expect([w.iWidth, w.iHeight]).toEqual([16, 14]);
    const bits = ft.m_pTexture[0]!.pBits!;
    for (let r = 0; r < 14; r++) for (let c = 0; c < 16; c++) expect(bits[(r << 8) + c]).toBe(r >= 8 && r < 13 ? WHITE(255) : 0);
    const m = ft.GetFontCache(code("M"));
    expect([m.iWidth, m.iHeight, m.iLeft]).toEqual([18, 14, 18]);
    for (let r = 0; r < 14; r++) for (let c = 0; c < 18; c++) expect(bits[(r << 8) + 18 + c]).toBe(r >= 8 && r < 13 ? WHITE(255) : 0);
    // T: 8 x 32 at (1, 24): yOff (832 - 1536) >> 6 = -11, so 32 rows from -11: 22 high, cut to 18; the cell shows rows 11 .. 28
    const t = ft.GetFontCache(code("T"));
    expect([t.iWidth, t.iHeight]).toEqual([10, 18]);
    for (let r = 0; r < 18; r++) for (let c = 0; c < 10; c++) expect(bits[(r << 8) + 36 + c]).toBe(c >= 1 && c < 9 ? WHITE(255) : 0);
    expect(t.iLeft).toBe(36);
  });

  test("the character comes from the first face that has it: A and B from the font (B is in JhengHeiBold too), C from JhengHeiBold (and GULIM), D from GULIM; E from none", () => {
    const { ft } = loaded();
    const b = ft.GetFontCache(code("B"));
    expect([b.iWidth, b.iHeight]).toEqual([12, 15]); // the font's B (advance 12): the sub font's would be 14 wide
    // C of JhengHeiBold: advance 11, bitmap 9 x 8 at (1, 8), ascender 11 px: yOff (704 - 512) >> 6 = 3: 11 wide, 3 + 8 + 1 = 12 high
    const c = ft.GetFontCache(code("C"));
    expect([c.iWidth, c.iHeight]).toEqual([11, 12]);
    const bits = ft.m_pTexture[0]!.pBits!;
    for (let r = 0; r < 12; r++) for (let x = 0; x < 11; x++) expect(bits[(r << 8) + c.iLeft + x]).toBe(x >= 1 && x < 10 && r >= 3 && r < 11 ? WHITE(255) : 0);
    // D of GULIM: advance 8, bitmap 8 x 8 at (0, 8), ascender 14 px (896): yOff (896 - 512) >> 6 = 6: 8 wide, 6 + 8 + 1 = 15 high
    const d = ft.GetFontCache(code("D"));
    expect([d.iWidth, d.iHeight]).toEqual([8, 15]);
    for (let r = 0; r < 15; r++) for (let x = 0; x < 8; x++) expect(bits[(r << 8) + d.iLeft + x]).toBe(r >= 6 && r < 14 ? WHITE(255) : 0);
    // E: nobody has it: the cell is made and stays 0 x 0
    const e = ft.GetFontCache(code("E"));
    expect([e.iWidth, e.iHeight, e._texRight, e._texBottom, e._Char, e.iLeft]).toEqual([0, 0, 0, 0, 69, 3 * 18]); // B, C, D, E: the fourth cell
    expect(ft.m_iSizeArray).toBe(4);
  });

  test("with an outline the cell has the outline's width and the second page holds the bitmap grown by 2 * outline pixels", () => {
    const { ft } = loaded(16, 1);
    const a = ft.GetFontCache(code("A"));
    // the bitmap grows by 2 to the right and to the top (FT_Bitmap_Embolden by 128 = 2 px): 10 x 12; width max(10 + 2, 10) = 12, height 3 + 12 + 1 = 16; a cell of 20
    expect([ft.m_iFontCacheSize, a.iWidth, a.iHeight, a._texRight, a._texBottom]).toEqual([20, 12, 16, 12.5 / 256, 16.5 / 256]);
    const main = ft.m_pTexture[0]!.pBits!;
    const outline = ft.m_pTextureOutLine[0]!.pBits!;
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 12; c++) {
        // main: x = c - 1 - 1 in [0, 8), y = r - 1 - 3 in [0, 10); outline: x = c - 1 in [0, 10), y = r - 3 in [0, 12)
        expect(main[(r << 8) + c]).toBe(c >= 2 && c < 10 && r >= 4 && r < 14 ? WHITE(255) : 0);
        expect(outline[(r << 8) + c]).toBe(c >= 1 && c < 11 && r >= 3 && r < 15 ? WHITE(255) : 0);
      }
    }
    expect(ft.m_pTextureOutLine[0]!.dirtyRects).toEqual([{ left: 0, top: 0, right: 12, bottom: 16 }]);
    expect(ft.m_pTexture[0]!.dirtyRects).toEqual([{ left: 0, top: 0, right: 12, bottom: 16 }]);
  });
});

describe("the least recently used cell is given up when all of them are in use", () => {
  /** a font of 120 px: 16 cells, the letters a-p fill them (stamps 1 .. 16) */
  function full() {
    const { ft } = loaded(120, 0, 1, true, { main: LETTERS });
    const cells = [..."abcdefghijklmnop"].map((c) => ft.GetFontCache(code(c)));
    return { ft, cells };
  }

  test("the new character takes the cell with the oldest stamp, which loses its character; the hash follows", () => {
    const { ft, cells } = full();
    expect([ft.m_iSizeArray, ft.m_iTotalCache, ft.m_dwCurrentStamp]).toEqual([16, 16, 17]);
    ft.GetFontCache(code("a")); // 'a' is the newest now (17): 'b' (2) is the oldest
    const q = ft.GetFontCache(code("q"));
    expect(q).toBe(cells[1]!);
    expect([q._Char, q.dwLastUse, q.iPage, q.iLeft, q.iTop, ft.m_iSizeArray]).toEqual([code("q"), 18, 0, 122, 0, 16]);
    expect([ft.hashCell[code("b")], ft.hashCell[code("q")]]).toEqual([-1, 1]);
    // 'b' again: it takes the cell of 'c' (3), the oldest left
    const b = ft.GetFontCache(code("b"));
    expect(b).toBe(cells[2]!);
    expect([ft.hashCell[code("c")], ft.hashCell[code("b")], b.iLeft, b.iTop]).toEqual([-1, 2, 0, 122]);
    // and 'q' (19) is still where it was
    expect(ft.GetFontCache(code("q"))).toBe(cells[1]!);
  });

  test("the cell's texels are redrawn for the new character (a W after an A: the cell is replaced, its page told)", () => {
    const { ft, cells } = full();
    const before = ft.m_pTexture[0]!.dirtyRects.length;
    ft.m_FontCacheArray![0]!.dwLastUse = 0; // the oldest: its character 'a' goes
    expect(ft.GetFontCache(code("q"))).toBe(cells[0]!);
    expect(ft.m_pTexture[0]!.dirtyRects.length).toBe(before + 1);
  });

  test("equal stamps: the first of them goes (the comparison is strict)", () => {
    const { ft, cells } = full();
    for (const c of cells) c.dwLastUse = 50;
    cells[5]!.dwLastUse = 7;
    cells[9]!.dwLastUse = 7;
    cells[12]!.dwLastUse = 7;
    expect(ft.GetFontCache(code("q"))).toBe(cells[5]!);
    // all equal: the very first
    for (const c of ft.m_FontCacheArray!) c.dwLastUse = 9;
    expect(ft.GetFontCache(code("r"))).toBe(cells[0]!);
  });

  test("the stamps are compared as a DWORD that wraps: 0xFFFFFFF0 is older than 10", () => {
    const { ft, cells } = full();
    for (const c of cells) c.dwLastUse = 10;
    cells[7]!.dwLastUse = 0xfffffff0;
    expect(ft.GetFontCache(code("q"))).toBe(cells[7]!);
    for (const c of ft.m_FontCacheArray!) c.dwLastUse = 0xfffffff0;
    ft.m_FontCacheArray![11]!.dwLastUse = 3; // 3 - 0xFFFFFFF0 is 19: newer than the rest
    ft.m_FontCacheArray![4]!.dwLastUse = 0xffffffe0; // older than 0xFFFFFFF0 by 16
    expect(ft.GetFontCache(code("r"))).toBe(cells[4]!);
  });

  test("a size that is known stays known after the cell is given up: _EstimateFontSize does not bring the character back", () => {
    const { ft, cells } = full();
    // 120 px: a is 75 wide (640 * 120 / 1024) with a box from 7.5 to 67.5 (a bitmap 61 wide and 75 high at 7 / 75), the ascender 93.75 -> 94: yOff 19;
    // a cell 75 wide and 19 + 75 + 1 = 95 high, so the size is 75 - 1 by 95 - 1
    expect(cells[1]!.iWidth).toBe(75);
    expect(cells[1]!.iHeight).toBe(95);
    expect(ft._EstimateFontSize(code("b"))).toEqual({ cx: 74, cy: 94 });
    // measuring b used its cell (stamp 17); use the other fifteen once, so that b is the oldest: the next character takes its cell
    for (const c of "acdefghijklmnop") ft.GetFontCache(code(c));
    expect(ft.GetFontCache(code("q"))).toBe(cells[1]!);
    expect(ft.hashCell[code("b")]).toBe(-1);
    // the size of b is known: no new cell for it, nothing counted
    const stamp = ft.m_dwCurrentStamp;
    expect(ft._EstimateFontSize(code("b"))).toEqual({ cx: 74, cy: 94 });
    expect(ft.hashCell[code("b")]).toBe(-1);
    expect(ft.m_dwCurrentStamp).toBe(stamp);
    // a character whose size is not known yet makes its cell, and the size is that of the cell it got
    expect(ft._EstimateFontSize(code("s"))).toEqual({ cx: 74, cy: 94 });
    expect(ft.hashCell[code("s")]).not.toBe(-1);
    expect(ft.m_dwCurrentStamp).toBe(stamp + 1);
    expect([ft.hashSizeKnown[code("b")], ft.hashSizeKnown[code("s")], ft.hashSizeKnown[code("t")]]).toEqual([1, 1, 0]);
  });
});

describe("the exe's cache of more than 4 pages of cells (cell 19: 689 against 676)", () => {
  test("without an outline the 677th character is on page 4, which is no texture: the exe dereferences null there (the port throws)", () => {
    const { ft } = loaded(17, 0, 1, true, { main: HUGE });
    expect([ft.m_iFontCacheSize, ft.m_iTotalCache]).toEqual([19, 689]);
    for (let i = 0; i < 676; i++) expect(ft.GetFontCache(0x100 + i).iPage).toBe(Math.floor(i / 169));
    expect(() => ft.GetFontCache(0x100 + 676)).toThrow(/glyph cell on page 4: m_pTexture\[4\] is not a texture/);
  });

  test("with an outline too: the main pass would draw into outline page 0 (m_pTexture[4] is m_pTextureOutLine[0]), then the outline pass reads m_pTextureOutLine[4], which is m_iCandidate[0] and no texture: the exe crashes there as well", () => {
    const { ft } = loaded(15, 1, 1, true, { main: HUGE });
    expect([ft.m_iFontCacheSize, ft.m_iTotalCache]).toEqual([19, 689]);
    for (let i = 0; i < 676; i++) ft.GetFontCache(0x100 + i);
    const rects = ft.m_pTextureOutLine[0]!.dirtyRects.length;
    expect(() => ft.GetFontCache(0x100 + 676)).toThrow(/glyph cell on page 4: m_pTexture\[4\] is not a texture/);
    // nothing was drawn before the throw
    expect(ft.m_pTextureOutLine[0]!.dirtyRects.length).toBe(rects);
  });
});

describe("measuring (_EstimateFontSize 328DCFA0, _EstimateStringWidth 328DD090, _EstimateStringHeight 328DD020, GetWidth 328DAAD0)", () => {
  test("the size of a character is its cell less the outline's share on both sides and 1: A 10 x 14 -> 9 x 13, B 12 x 15 -> 11 x 14; a CR has none", () => {
    const { ft } = loaded();
    expect(ft._EstimateFontSize(code("A"))).toEqual({ cx: 9, cy: 13 });
    expect(ft._EstimateFontSize(code("B"))).toEqual({ cx: 11, cy: 14 });
    expect(ft._EstimateFontSize(13)).toEqual({ cx: 0, cy: 0 });
    // a CR makes no cell; the LF (10) has none in the font: its cell is empty, 0 x 0, so -1 x -1
    expect(ft.m_iSizeArray).toBe(2);
    expect(ft._EstimateFontSize(10)).toEqual({ cx: -1, cy: -1 });
    expect(ft.m_iSizeArray).toBe(3);
    // the size is looked up once: asking again does not touch the cache's stamps
    const stamp = ft.m_dwCurrentStamp;
    ft._EstimateFontSize(code("A"));
    expect(ft.m_dwCurrentStamp).toBe(stamp);
  });

  test("with an outline the size is the cell less 2 * outline + 1: A 12 x 16 -> 9 x 13", () => {
    const { ft } = loaded(16, 1);
    expect(ft._EstimateFontSize(code("A"))).toEqual({ cx: 9, cy: 13 });
  });

  test("the width of a string is the sum of its characters' widths without the CRs; at most `size` characters; none for size 0", () => {
    const { ft } = loaded();
    expect(ft._EstimateStringWidth("AB", 2)).toBe(9 + 11);
    expect(ft._EstimateStringWidth("AB", 1)).toBe(9);
    expect(ft._EstimateStringWidth("A\rB", 3)).toBe(9 + 11);
    expect(ft._EstimateStringWidth("AAB", 3)).toBe(9 + 9 + 11);
    expect(ft._EstimateStringWidth("AB", 0)).toBe(0);
    expect(ft._EstimateStringWidth("AB", -3)).toBe(0);
    // a character nobody has is -1 wide: E, E, A
    expect(ft._EstimateStringWidth("EEA", 3)).toBe(-1 - 1 + 9);
  });

  test("the height of a string: a font size + 1 (17) for each LF; any other character counts only as the last one (a CR too)", () => {
    const { ft } = loaded();
    const h = (s: string, n = s.length) => ft._EstimateStringHeight(s, n);
    expect(h("abc")).toBe(17);
    expect(h("a\nb")).toBe(34);
    expect(h("a\n")).toBe(17); // the LF counts, the last character is the LF
    expect(h("\n\n")).toBe(34);
    expect(h("\n\nx")).toBe(51);
    expect(h("a\r")).toBe(17);
    expect(h("a\rb")).toBe(17);
    expect(h("\r\n")).toBe(17);
    expect(h("a\r\nb")).toBe(34);
    expect(h("ab\ncd", 3)).toBe(17); // only the first three characters: a, b, LF
    expect(h("ab\ncd", 5)).toBe(34);
    expect(h("abc", 0)).toBe(0);
    expect(h("abc", -1)).toBe(0);
    expect(h("a", 1)).toBe(17);
    expect(h("\r", 1)).toBe(17);
    expect(h("\r\r", 2)).toBe(17); // the first CR counts nothing, the last one does
    expect(h("\n\r", 2)).toBe(34);
  });

  test("GetWidth: the widest line, colour codes (#c + 6 characters, #cx) take no room, the text can be cut to nCount characters", () => {
    const { ft } = loaded();
    expect(ft.GetWidth("AB", -1)).toBe(20);
    expect(ft.GetWidth("A\nB", -1)).toBe(11);
    expect(ft.GetWidth("AB\nA", -1)).toBe(20);
    expect(ft.GetWidth("AAB", 2)).toBe(18);
    expect(ft.GetWidth("AB", 0)).toBe(0);
    expect(ft.GetWidth("", -1)).toBe(0);
    expect(ft.GetWidth(null, -1)).toBe(0);
    // #cFF0000 is 8 characters, #cx 3, a code is also recognised in capitals
    expect(ft.GetWidth("#cFF0000AB", -1)).toBe(20);
    expect(ft.GetWidth("A#c00FF00B", -1)).toBe(20);
    expect(ft.GetWidth("A#CFF0000B#cxA", -1)).toBe(9 + 11 + 9);
    expect(ft.GetWidth("A#CXB", -1)).toBe(20);
    // a code that is cut short (nCount) or shorter than 6 characters swallows the rest
    expect(ft.GetWidth("A#c12", -1)).toBe(9);
    expect(ft.GetWidth("A#cFF0000B", 5)).toBe(9);
    // a # that is not a code is a character: '#' is 8 wide, 7 for the layout; at the end, or before something else
    expect(ft.GetWidth("#", -1)).toBe(7);
    expect(ft.GetWidth("A#", -1)).toBe(9 + 7);
    expect(ft.GetWidth("#A", -1)).toBe(7 + 9);
    expect(ft.GetWidth("##cxA", -1)).toBe(7 + 9);
    // a text with no characters is 0 wide, one with a character nobody has too (-1 is not less than the 0 the widest line starts at)
    expect(ft.GetWidth("E", -1)).toBe(0);
    expect(ft.GetWidth("A\0B", -1)).toBe(9);
  });

  test("GetWidth with an outline adds (2 * outline - 1) for each character of a line: AB is 9 + 11 + 2 * 1", () => {
    const { ft } = loaded(16, 1);
    expect(ft.GetWidth("AB", -1)).toBe(9 + 11 + 2);
    expect(ft.GetWidth("A\nAB", -1)).toBe(9 + 11 + 2);
    expect(ft.GetWidth("A", -1)).toBe(9 + 1);
  });

  test("GetWidth of an enlarged font divides the sum of the characters by the enlargement (towards 0) before the outline", () => {
    const { ft } = loaded(8, 0, 2); // 16 px on the sheet
    // A 9 and B 11 -> 20 / 2 = 10; A alone 9 / 2 = 4
    expect(ft.GetWidth("AB", -1)).toBe(10);
    expect(ft.GetWidth("A", -1)).toBe(4);
    const o = loaded(8, 1, 2).ft; // a cell of 20, 9 and 9: A 12 x 16 -> cx 9
    expect(o.GetWidth("A", -1)).toBe(4 + 1);
    expect(o.GetWidth("AB", -1)).toBe(10 + 2);
  });
});


/** a font loaded on the recorder (the world is 1536 x 1536: scale (1.5, 2)); `noRes` keeps the size at what the test says */
function onDevice(size = 16, outline = 0, enlarge = 1, rhw = true, files = {}, noRes = true, backBuffer?: { width: number; height: number }) {
  const w = fontWorld(files, { device: true, ...(backBuffer ? { backBuffer } : {}) });
  const ft = w.font(size, outline, enlarge, noRes, rhw);
  expect(ft.Load()).toBe(true);
  w.dev!.log.length = 0;
  return { ...w, dev: w.dev!, ft };
}

describe("Buffering (328D9D40): a quad of six vertices for each character", () => {
  const col = 0xffaabbcc;

  test("RHW: (x, y, 0, 1, colour, u, v); A is cell (0, 0) 10 x 14, the pen then moves by its width - 1 = 9 to B, cell (18, 0) 12 x 15", () => {
    const { ft } = loaded();
    ft.Buffering(false, 100, 50, "AB", col, col, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate).toEqual([2, 0, 0, 0]);
    const [a, b] = pageQuads(ft, 0);
    expect(a).toEqual(rhwQuad(100, 50, 110, 64, 0.5 / 256, 0.5 / 256, 10.5 / 256, 14.5 / 256, col));
    expect(b).toEqual(rhwQuad(109, 50, 121, 65, 18.5 / 256, 0.5 / 256, 30.5 / 256, 15.5 / 256, col));
  });

  test("the scales multiply the width and height of the quad and the pen's step (9 * 1.5), not the texture", () => {
    const { ft } = loaded();
    ft.Buffering(false, 100, 50, "AB", col, col, false, -1, 1.5, 2, 0);
    const [a, b] = pageQuads(ft, 0);
    expect(a).toEqual(rhwQuad(100, 50, 115, 78, 0.5 / 256, 0.5 / 256, 10.5 / 256, 14.5 / 256, col));
    expect(b).toEqual(rhwQuad(113.5, 50, 131.5, 80, 18.5 / 256, 0.5 / 256, 30.5 / 256, 15.5 / 256, col));
  });

  test("an enlarged font (E = 2, 16 px): the quad is cut by iWidth / (4E - 4) at each side and iHeight / (2E - 2) at the bottom, whole-number divisions, then scaled; the step is iWidth / E - 1", () => {
    const { ft } = loaded(8, 0, 2);
    ft.Buffering(false, 100, 50, "AB", col, col, false, -1, 1, 1, 0);
    let [a, b] = pageQuads(ft, 0);
    // A 10 x 14: 10 / 4 = 2 and 14 / 2 = 7; the step 10 / 2 - 1 = 4.  B 12 x 15: 12 / 4 = 3 and 15 / 2 = 7
    expect(a).toEqual(rhwQuad(102, 50, 108, 57, 0.5 / 256, 0.5 / 256, 10.5 / 256, 14.5 / 256, col));
    expect(b).toEqual(rhwQuad(107, 50, 113, 58, 18.5 / 256, 0.5 / 256, 30.5 / 256, 15.5 / 256, col));
    // scaled by (1.5, 2): 2 * 1.5 = 3, 7 * 2 = 14, a step of 4 * 1.5 = 6
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 100, 50, "AB", col, col, false, -1, 1.5, 2, 0);
    [a, b] = pageQuads(ft, 0);
    expect(a).toEqual(rhwQuad(103, 50, 112, 64, 0.5 / 256, 0.5 / 256, 10.5 / 256, 14.5 / 256, col));
    // B: 12 / 4 = 3 -> 4.5, 15 / 2 = 7 -> 14: x0 = 4.5 + 106, x1 = (18 + 106) - 4.5, y1 = (50 + 30) - 14
    expect(b).toEqual(rhwQuad(110.5, 50, 119.5, 66, 18.5 / 256, 0.5 / 256, 30.5 / 256, 15.5 / 256, col));
  });

  test("E = 4: the insets are 10 / 12 = 0 and 14 / 6 = 2 (A), 12 / 12 = 1 and 15 / 6 = 2 (B); the step 10 / 4 - 1 = 1", () => {
    const { ft } = loaded(4, 0, 4);
    ft.Buffering(false, 100, 50, "AB", col, col, false, -1, 1, 1, 0);
    const [a, b] = pageQuads(ft, 0);
    expect(a).toEqual(rhwQuad(100, 50, 110, 62, 0.5 / 256, 0.5 / 256, 10.5 / 256, 14.5 / 256, col));
    expect(b).toEqual(rhwQuad(102, 50, 112, 63, 18.5 / 256, 0.5 / 256, 30.5 / 256, 15.5 / 256, col));
  });

  test("a font that is not RHW: (x, y, 0.5, colour, u, v) and a quad that goes DOWN the y axis (bottom = top - height); no insets, even enlarged", () => {
    const { ft } = loaded(16, 0, 1, false);
    ft.Buffering(false, 100, 50, "AB", col, col, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate).toEqual([2, 0, 0, 0]);
    const [a, b] = pageQuads(ft, 0);
    expect(a).toEqual(xyzQuad(100, 50, 110, 36, 0.5 / 256, 0.5 / 256, 10.5 / 256, 14.5 / 256, col));
    expect(b).toEqual(xyzQuad(109, 50, 121, 35, 18.5 / 256, 0.5 / 256, 30.5 / 256, 15.5 / 256, col));
    const e = loaded(8, 0, 2, false).ft;
    e.Buffering(false, 100, 50, "AB", col, col, false, -1, 1.5, 2, 0);
    const [ea, eb] = pageQuads(e, 0);
    // x1 = 100 + 15, y1 = 50 - 28; the step (10 / 2 - 1) * 1.5 = 6
    expect(ea).toEqual(xyzQuad(100, 50, 115, 22, 0.5 / 256, 0.5 / 256, 10.5 / 256, 14.5 / 256, col));
    expect(eb).toEqual(xyzQuad(106, 50, 124, 20, 18.5 / 256, 0.5 / 256, 30.5 / 256, 15.5 / 256, col));
  });

  test("with an outline the pen steps by iWidth - 2: A is 12 x 16 in a cell of 20, B 14 x 17 (the bitmap grown by 2 is 10 x 14, 2 + 14 + 1 high)", () => {
    const { ft } = loaded(16, 1);
    ft.Buffering(false, 0, 0, "AB", col, col, false, -1, 1, 1, 0);
    const [a, b] = pageQuads(ft, 0);
    expect(a).toEqual(rhwQuad(0, 0, 12, 16, 0.5 / 256, 0.5 / 256, 12.5 / 256, 16.5 / 256, col));
    expect(b).toEqual(rhwQuad(10, 0, 24, 17, 20.5 / 256, 0.5 / 256, 34.5 / 256, 17.5 / 256, col));
    // the second pass of the outline draws the same quads from the outline pages: the cells are the same
    const o = loaded(16, 1).ft;
    o.Buffering(true, 0, 0, "AB", col, col, true, -1, 1, 1, 0);
    expect(pageQuads(o, 0)).toEqual(pageQuads(ft, 0));
  });

  test("the text stops once the pen is past iRight (when that is above 0); the glyph that starts at or before it is drawn whole", () => {
    const x0s = (right: number): number[] => {
      const { ft } = loaded();
      ft.Buffering(false, 100, 50, "AAAA", col, col, false, -1, 1, 1, right);
      return pageQuads(ft, 0).map((q) => q[0]![0]!);
    };
    expect(x0s(105)).toEqual([100]);
    expect(x0s(108)).toEqual([100]);
    expect(x0s(109)).toEqual([100, 109]); // the pen is at 109: not past it
    expect(x0s(117)).toEqual([100, 109]);
    expect(x0s(118)).toEqual([100, 109, 118]);
    expect(x0s(0)).toEqual([100, 109, 118, 127]);
    expect(x0s(-5)).toEqual([100, 109, 118, 127]);
    // a pen that starts past iRight draws nothing
    const { ft } = loaded();
    ft.Buffering(false, 100, 50, "AAAA", col, col, false, -1, 1, 1, 99);
    expect(ft.m_iCandidate).toEqual([0, 0, 0, 0]);
  });

  test("#c + six hex digits sets the colour and keeps the alpha of the colour it has; #cx goes back to DefColor whole; neither takes room (A 0, B 9, A 20, A 29)", () => {
    const { ft } = loaded();
    ft.Buffering(false, 0, 0, "A#cFF0000B#c00FF00A#cxA", 0xffffffff, 0x80123456, false, -1, 1, 1, 0);
    const q = pageQuads(ft, 0);
    expect(q.map((v) => [v[0]![0], v[0]![4]])).toEqual([[0, 0xffffffff], [9, 0xffff0000], [20, 0xff00ff00], [29, 0x80123456]]);
    // the alpha is that of the colour at the time: the DefColor's after #cx, then a code keeps it
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "#cxA#c102030A", 0x11ffffff, 0x80123456, false, -1, 1, 1, 0);
    expect(pageQuads(ft, 0).map((v) => v[0]![4])).toEqual([0x80123456, 0x80102030]);
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "#c102030A", 0x11ffffff, 0x80123456, false, -1, 1, 1, 0);
    expect(pageQuads(ft, 0).map((v) => v[0]![4])).toEqual([0x11102030]);
  });

  test("capital C and X work too; a code that is cut short or follows the last character swallows the rest", () => {
    const { ft } = loaded();
    ft.Buffering(false, 0, 0, "#CFF0000A#CXA", 0xffffffff, 0xff00ffff, false, -1, 1, 1, 0);
    expect(pageQuads(ft, 0).map((v) => v[0]![4])).toEqual([0xffff0000, 0xff00ffff]);
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "A#cFF", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(1);
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "A#c", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(1);
    // the code needs one more character after the #: a lone # at the end is a character
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "A#", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(2);
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "#c", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(0);
    // a # that no c follows is a character
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "#A#x", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(4); // '#', 'A', '#', 'x': there is no glyph for x, whose quad has no size, but it is a quad
  });

  test("the digits are read like scanf %x: a bad digit ends them (1G3456 is 1), a 0x or white space or a sign before them is allowed, nothing readable keeps the colour the last code gave", () => {
    const run = (text: string): number[] => {
      const { ft } = loaded();
      ft.Buffering(false, 0, 0, text, 0xff000000, 0, false, -1, 1, 1, 0);
      return pageQuads(ft, 0).map((v) => v[0]![4]!);
    };
    expect(run("#c1G3456A")).toEqual([0xff000001]);
    expect(run("#c0x1234A")).toEqual([0xff001234]);
    expect(run("#c  1234A")).toEqual([0xff001234]);
    expect(run("#c-00001A")).toEqual([0xffffffff]);
    expect(run("#c+00001A")).toEqual([0xff000001]);
    expect(run("#c0000FFA")).toEqual([0xff0000ff]);
    expect(run("#c000000A")).toEqual([0xff000000]);
    // not a digit at all: the previous code's value, 0 before there was one
    expect(run("#cZZZZZZA")).toEqual([0xff000000]);
    expect(run("#cFF0000A#cZZZZZZB#c000000B")).toEqual([0xffff0000, 0xffff0000, 0xff000000]);
  });

  test("bNoColor: the codes are skipped (no room, no colour)", () => {
    const { ft } = loaded();
    ft.Buffering(false, 0, 0, "A#cFF0000B#cxA", 0xff112233, 0xff445566, true, -1, 1, 1, 0);
    expect(pageQuads(ft, 0).map((v) => [v[0]![0], v[0]![4]])).toEqual([[0, 0xff112233], [9, 0xff112233], [20, 0xff112233]]);
  });

  test("CR and LF draw nothing and take no room; nCount cuts the text (0: nothing, negative: all)", () => {
    const { ft } = loaded();
    ft.Buffering(false, 0, 0, "A\nB\rA", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(pageQuads(ft, 0).map((v) => v[0]![0])).toEqual([0, 9, 20]);
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "ABAB", 0xffffffff, 0, false, 2, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(2);
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "ABAB", 0xffffffff, 0, false, 0, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(0);
    ft.Buffering(false, 0, 0, null, 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(0);
    ft.Buffering(false, 0, 0, "ABAB", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(4);
  });

  test("a count past the end reads the terminating NUL: a quad of no size (a cell nobody fills), and the pen steps back by 1", () => {
    const { ft } = loaded();
    ft.Buffering(false, 0, 0, "AB", 0xffffffff, 0, false, 3, 1, 1, 0);
    const q = pageQuads(ft, 0);
    expect(q.length).toBe(3);
    // the third cell is cell 2: left 36; 0 wide and 0 high, its right and bottom never set
    expect(q[2]).toEqual(rhwQuad(20, 0, 20, 0, 36.5 / 256, 0.5 / 256, 0, 0, 0xffffffff));
    // the pen moves back by 1 for each NUL: 20, 19, 18
    ft.m_iCandidate.fill(0);
    ft.Buffering(false, 0, 0, "AB", 0xffffffff, 0, false, 5, 1, 1, 0);
    expect(pageQuads(ft, 0).map((v) => v[0]![0])).toEqual([0, 9, 20, 19, 18]);
  });

  test("a page without vertex memory: the count of the page is set to 0 and the text stops", () => {
    const { ft } = loaded();
    ft.m_apPageVertex[0] = null;
    ft.m_iCandidate[0] = 5;
    ft.Buffering(false, 0, 0, "AB", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate).toEqual([0, 0, 0, 0]);
  });

  test("a page that holds its candidates (cell 102: 7 * 2 = 14) is drawn before the next quad goes in", () => {
    const { ft, dev } = onDevice(100);
    expect(ft.m_iNumCandidatesInAPage).toBe(14);
    ft.Buffering(false, 0, 0, "A".repeat(14), 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(14);
    expect(drawnCalls(dev)).toEqual([]);
    // the 15th: the 14 are drawn (28 triangles) and the page starts again with this one
    ft.Buffering(false, 0, 0, "A".repeat(15), 0xffffffff, 0, false, -1, 1, 1, 0);
    const calls = drawnCalls(dev);
    expect(calls.map((c) => [c.type, c.prims, c.stride])).toEqual([[4, 28, 28], [4, 28, 28]]);
    // A at 100 px: advance 62.5 -> 63 (the phantom points are rounded), the bitmap 51 wide: a cell 63 wide, so the pen steps by 62
    expect(ft.GetFontCache(65).iWidth).toBe(63);
    expect(calls[0]!.vertices.filter((_, i) => i % 6 === 0).map((v) => v[0])).toEqual(Array.from({ length: 14 }, (_, k) => 62 * k));
    // the 15th quad stays in the page until the next Flush
    expect(ft.m_iCandidate).toEqual([1, 0, 0, 0]);
  });
});

/** every call but the stream source (whose buffer number depends on how many buffers the rig has made) */
const nonSrc = (log: string[]): string[] => log.filter((l) => !l.startsWith("src "));
/**
 * What the 13 states of `s_akStates` cost on the recorder, which starts with the baseline of the state manager (ALPHABLENDENABLE 0,
 * ZWRITEENABLE 1, stage 0: SELECTARG1 / CURRENT in the alpha and the second colour argument, linear filters): of the 13 only 5 differ
 * (the others, source and destination blend, the colour op and its first argument, the first alpha argument and the filters, are already
 * what the font wants).  The pops put the baseline back in the reverse order.
 */
const PUSH = ["rs 27 1", "rs 14 0", "tss 0 3 0", "tss 0 4 4", "tss 0 6 0"];
const POP = ["tss 0 6 1", "tss 0 4 2", "tss 0 3 1", "rs 14 1", "rs 27 0"];
/** [x0, y0, x1, y1] of each quad of the calls (vertices 0 and 4 of its six) */
const rects = (calls: DrawnCall[]): number[][] =>
  calls.flatMap((c) => {
    const out: number[][] = [];
    for (let i = 0; i < c.vertices.length; i += 6) out.push([c.vertices[i]![0]!, c.vertices[i]![1]!, c.vertices[i + 4]![0]!, c.vertices[i + 4]![1]!]);
    return out;
  });
/** the colour of each quad of the calls */
const colorsOf = (calls: DrawnCall[]): number[] => calls.flatMap((c) => c.vertices.filter((_, i) => i % 6 === 0).map((v) => v[c.stride === 28 ? 4 : 3]!));

describe("Flush (328DA610)", () => {
  test("the 13 states are pushed, the page's texture goes on stage 0 (changed pixels first go to the video texture), the quads are drawn as a triangle list of the RHW type (3), the states are popped", () => {
    const { ft, dev } = onDevice();
    ft.Buffering(false, 100, 50, "ABA", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(dev.log).toEqual([]); // nothing reaches the device while the quads are only collected
    ft.Flush(false, -1);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "update 0 1", "tex 0 page1", "fvf 324", "draw 4 0 6", ...POP]);
    expect(dev.log.filter((l) => l.startsWith("src "))).toEqual([expect.stringMatching(/^src \d+ 28$/)]);
    expect(ft.m_iCandidate).toEqual([0, 0, 0, 0]);
    const calls = drawnCalls(dev);
    expect(calls.map((c) => [c.type, c.prims, c.stride])).toEqual([[4, 6, 28]]);
    expect(rects(calls)).toEqual([[100, 50, 110, 64], [109, 50, 121, 65], [120, 50, 130, 64]]);
    // nothing changed on the page: the next Flush draws again without the update and without setting the same texture; the dynamic
    // buffer goes on where the 18 vertices of the first draw ended
    dev.log.length = 0;
    ft.Buffering(false, 100, 50, "A", 0xffffffff, 0, false, -1, 1, 1, 0);
    ft.Flush(false, -1);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "fvf 324", "draw 4 18 2", ...POP]);
  });

  test("with nothing buffered the states are still pushed and popped (the stack is made before the pages are looked at) and nothing is drawn", () => {
    const { ft, dev } = onDevice();
    ft.Flush(false, -1);
    expect(dev.log).toEqual([...PUSH, ...POP]);
    dev.log.length = 0;
    ft.Flush(true, 2);
    expect(dev.log).toEqual([...PUSH, ...POP]);
  });

  test("a page number from 4 on is left alone: not even the states", () => {
    const { ft, dev } = onDevice();
    ft.Buffering(false, 0, 0, "A", 0xffffffff, 0, false, -1, 1, 1, 0);
    ft.Flush(false, 4);
    ft.Flush(false, 9);
    expect(dev.log).toEqual([]);
    expect(ft.m_iCandidate).toEqual([1, 0, 0, 0]);
  });

  test("a page number from 0 to 3 flushes that page, a negative one all four in order; pages with no quads are skipped; each page has its own texture (video texture 2p + 1)", () => {
    // 120 px: 4 cells to a page; the cells go to the characters in the order they are first used: a-d are on page 0, e-h on page 1,
    // i-l on page 2, m-p on page 3
    const { ft, dev } = onDevice(120, 0, 1, true, { main: LETTERS });
    for (const c of "abcdefghijklmnop") ft.GetFontCache(c.charCodeAt(0));
    ft.Buffering(false, 0, 0, "aebimc", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate).toEqual([3, 1, 1, 1]);
    ft.Flush(false, 1);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "update 2 3", "tex 0 page3", "fvf 324", "draw 4 0 2", ...POP]);
    expect(ft.m_iCandidate).toEqual([3, 0, 1, 1]);
    dev.log.length = 0;
    ft.Flush(false, -1);
    // the dynamic buffer goes on after the 6 vertices of the first draw: 6, then 6 + 18, then 24 + 6
    expect(nonSrc(dev.log)).toEqual([
      ...PUSH,
      "update 0 1", "tex 0 page1", "fvf 324", "draw 4 6 6",
      "update 4 5", "tex 0 page5", "fvf 324", "draw 4 24 2",
      "update 6 7", "tex 0 page7", "fvf 324", "draw 4 30 2",
      ...POP,
    ]);
    expect(ft.m_iCandidate).toEqual([0, 0, 0, 0]);
    // any negative number is "all"
    ft.Buffering(false, 0, 0, "ai", 0xffffffff, 0, false, -1, 1, 1, 0);
    dev.log.length = 0;
    ft.Flush(false, -7);
    expect(drawnCalls(dev).map((c) => c.prims)).toEqual([2, 2]);
  });

  test("a font that is not RHW draws the type with no rhw (FVF 322, 24 bytes a vertex): (x, y, 0.5, colour, u, v)", () => {
    const { ft, dev } = onDevice(16, 0, 1, false);
    ft.Buffering(false, 100, 50, "A", 0xffaabbcc, 0, false, -1, 1, 1, 0);
    ft.Flush(false, -1);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "update 0 1", "tex 0 page1", "fvf 322", "draw 4 0 2", ...POP]);
    const [call] = drawnCalls(dev);
    expect(call!.stride).toBe(24);
    expect(call!.vertices[0]).toEqual([100, 50, 0.5, 0xffaabbcc, 0.5 / 256, 0.5 / 256]);
    expect(call!.vertices[4]).toEqual([110, 36, 0.5, 0xffaabbcc, 10.5 / 256, 14.5 / 256]);
  });

  test("bOutLine takes the outline page's texture: with an outline, the pages are made main, outline (system + video each), so the outline of page 0 is video texture 3", () => {
    const { ft, dev } = onDevice(16, 1);
    ft.Buffering(true, 100, 50, "A", 0xff112233, 0xff112233, true, -1, 1, 1, 0);
    ft.Flush(true, -1);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "update 2 3", "tex 0 page3", "fvf 324", "draw 4 0 2", ...POP]);
    dev.log.length = 0;
    ft.Buffering(false, 100, 50, "A", 0xff112233, 0xff112233, false, -1, 1, 1, 0);
    ft.Flush(false, -1);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "update 0 1", "tex 0 page1", "fvf 324", "draw 4 6 2", ...POP]);
  });

  test("an outline pass of a font that has no outline pages is a null dereference in the exe (the port throws, with the states popped)", () => {
    const { ft, dev } = onDevice();
    ft.Buffering(true, 0, 0, "A", 0xffffffff, 0, true, -1, 1, 1, 0);
    expect(() => ft.Flush(true, -1)).toThrow(/outline page 0/);
    expect(dev.log.slice(-5)).toEqual(POP);
  });

  test("without a device (no render) the quads are dropped and the counts start again", () => {
    const { ft } = loaded();
    ft.Buffering(false, 0, 0, "ABA", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate).toEqual([3, 0, 0, 0]);
    ft.Flush(false, -1);
    expect(ft.m_iCandidate).toEqual([0, 0, 0, 0]);
  });
});

describe("OutTextXY (328DC670)", () => {
  const col = 0xff102030;
  const outc = 0xff405060;
  /** the x of the first quad of each call, for the placement tests */
  const firstX = (dev: ReturnType<typeof onDevice>["dev"]): number => rects(drawnCalls(dev))[0]![0]!;

  test("flag 0: the text at (iLeft, iTop), drawn with one Flush (the states once, one draw); the stamp restarts at timeGetTime() and counts the characters it makes or finds", () => {
    const { ft, dev } = onDevice();
    ft.OutTextXY(100, 50, "AB", col, outc, null, 0, -1, 1, 1);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "update 0 1", "tex 0 page1", "fvf 324", "draw 4 0 4", ...POP]);
    const calls = drawnCalls(dev);
    expect(rects(calls)).toEqual([[100, 50, 110, 64], [109, 50, 121, 65]]);
    expect(colorsOf(calls)).toEqual([col, col]); // no outline: the outline colour is not used
    const cell = (c: string) => ft.m_FontCacheArray![ft.hashCell[c.charCodeAt(0)]!]!;
    expect([cell("A").dwLastUse, cell("B").dwLastUse, ft.m_dwCurrentStamp]).toEqual([5000, 5001, 5002]);
  });

  test("the stamp is the clock again on the next call: the cells found get 7000, 7001 in the order of the text", () => {
    const { ft, clock } = onDevice();
    ft.OutTextXY(0, 0, "AB", col, outc, null, 0, -1, 1, 1);
    clock.now = 7000;
    ft.OutTextXY(0, 0, "BA", col, outc, null, 0, -1, 1, 1);
    const cell = (c: string) => ft.m_FontCacheArray![ft.hashCell[c.charCodeAt(0)]!]!;
    expect([cell("B").dwLastUse, cell("A").dwLastUse, ft.m_dwCurrentStamp]).toEqual([7000, 7001, 7002]);
    // the stamp wraps like the clock's DWORD (timeGetTime is 32 bits)
    clock.now = 0xfffffffe;
    ft.OutTextXY(0, 0, "AB", col, outc, null, 0, -1, 1, 1);
    expect([cell("A").dwLastUse, cell("B").dwLastUse, ft.m_dwCurrentStamp]).toEqual([0xfffffffe, 0xffffffff, 0]);
  });

  test("no text, or an empty one: nothing happens (not even the stamp)", () => {
    const { ft, dev } = onDevice();
    ft.OutTextXY(0, 0, null, col, outc, null, 0, -1, 1, 1);
    ft.OutTextXY(0, 0, "", col, outc, null, 1, -1, 1, 1);
    expect(dev.log).toEqual([]);
    expect(ft.m_dwCurrentStamp).toBe(1);
  });

  test("flag 1 without a rectangle centres the text on iLeft: iLeft - (int)(width * scaleX * 0.5); the width is the widest line (AB 20, A 9)", () => {
    const { ft, dev } = onDevice();
    ft.OutTextXY(100, 50, "AB", col, outc, null, 1, -1, 1, 1);
    expect(firstX(dev)).toBe(90);
    dev.log.length = 0;
    ft.OutTextXY(100, 50, "AB", col, outc, null, 1, -1, 1.5, 1);
    expect(rects(drawnCalls(dev)).map((r) => r[0])).toEqual([85, 98.5]); // 30 * 0.5 = 15
    dev.log.length = 0;
    ft.OutTextXY(100, 50, "A", col, outc, null, 1, -1, 1.5, 1);
    expect(firstX(dev)).toBe(94); // 13.5 * 0.5 = 6.75, cut to 6
    dev.log.length = 0;
    ft.OutTextXY(100, 50, "A\nB", col, outc, null, 1, -1, 1, 1);
    expect(firstX(dev)).toBe(95); // the widest line: B, 11 * 0.5 = 5.5 -> 5; the LF draws nothing, the pen goes on
    expect(rects(drawnCalls(dev)).map((r) => r[0])).toEqual([95, 104]);
  });

  test("flag 2 without a rectangle ends the text at iLeft + fontSize / E: iLeft + (int)(16 / E - width * scaleX), truncated towards 0", () => {
    const { ft, dev } = onDevice();
    ft.OutTextXY(100, 50, "AB", col, outc, null, 2, -1, 1, 1);
    expect(firstX(dev)).toBe(96); // 16 - 20
    dev.log.length = 0;
    ft.OutTextXY(100, 50, "A", col, outc, null, 2, -1, 2.5, 1);
    expect(firstX(dev)).toBe(94); // 16 - 22.5 = -6.5 -> -6
    const e = onDevice(8, 0, 2);
    e.ft.OutTextXY(100, 50, "A", col, outc, null, 2, -1, 1, 1);
    // the text starts at 100 + (8 - 9 / 2) = 104; the quad of an enlarged font is cut by 10 / 4 = 2 at the left
    expect(firstX(e.dev)).toBe(106);
  });

  test("with a rectangle: flag 1 centres on it (left - (int)((width of the rectangle - text) * -0.5)), flag 2 ends at its right edge, flag 0 ignores it for the start; flag 1 wins over 2", () => {
    const rt = { left: 10, top: 0, right: 110, bottom: 20 };
    const run = (flag: number, text = "AB", scale = 1) => {
      const { ft, dev } = onDevice();
      ft.OutTextXY(100, 50, text, col, outc, rt, flag, -1, scale, 1);
      return firstX(dev);
    };
    expect(run(1)).toBe(50); // 10 - (int)((100 - 20) * -0.5) = 10 + 40
    expect(run(2)).toBe(90); // 110 - 20
    expect(run(3)).toBe(50);
    expect(run(0)).toBe(100);
    expect(run(1, "A", 1.5)).toBe(53); // 10 - (int)((100 - 13.5) * -0.5 = -43.25)
    expect(run(2, "A", 1.5)).toBe(97); // 110 - (int)13.5
    // a bit on the high nibble does not touch the alignment
    const { ft, dev } = onDevice();
    ft.OutTextXY(100, 50, "AB", col, outc, rt, 0x10000001, -1, 1, 1);
    expect(firstX(dev)).toBe(50);
  });

  test("a rectangle with a width cuts the text where the pen is past its right edge (12 of 13 A from 10: 10 + 9 * 11 = 109 is the last start <= 110); one without a width does not", () => {
    const { ft, dev } = onDevice();
    ft.OutTextXY(10, 0, "A".repeat(13), col, outc, { left: 10, top: 0, right: 110, bottom: 20 }, 0, -1, 1, 1);
    expect(rects(drawnCalls(dev)).map((r) => r[0])).toEqual(Array.from({ length: 12 }, (_, k) => 10 + 9 * k));
    dev.log.length = 0;
    ft.OutTextXY(10, 0, "A".repeat(13), col, outc, { left: 10, top: 0, right: 10, bottom: 20 }, 0, -1, 1, 1);
    expect(rects(drawnCalls(dev)).length).toBe(13);
    dev.log.length = 0;
    ft.OutTextXY(10, 0, "A".repeat(13), col, outc, { left: 10, top: 0, right: 5, bottom: 20 }, 0, -1, 1, 1);
    expect(rects(drawnCalls(dev)).length).toBe(13);
  });

  test("colour codes are followed unless dwFlag has a bit of 0xF0000000 (bNoColor); the colour is the one given, #cx goes back to it", () => {
    const { ft, dev } = onDevice();
    ft.OutTextXY(0, 0, "A#cFF0000A#cxA", col, outc, null, 0, -1, 1, 1);
    expect(colorsOf(drawnCalls(dev))).toEqual([col, 0xffff0000, col]);
    for (const flag of [0x10000000, 0x20000000, 0x40000000, 0x80000000, 0xf0000000]) {
      dev.log.length = 0;
      ft.OutTextXY(0, 0, "A#cFF0000A#cxA", col, outc, null, flag >>> 0, -1, 1, 1);
      expect(colorsOf(drawnCalls(dev))).toEqual([col, col, col]);
    }
    dev.log.length = 0;
    ft.OutTextXY(0, 0, "A#cFF0000A", col, outc, null, 0x0ffffffc, -1, 1, 1);
    expect(colorsOf(drawnCalls(dev))).toEqual([col, 0xffff0000]);
  });

  test("nCount cuts the text, for the alignment too; 0 draws nothing (but the stamp is set); negative is all", () => {
    const { ft, dev } = onDevice();
    ft.OutTextXY(100, 50, "ABAB", col, outc, null, 1, 2, 1, 1);
    expect(rects(drawnCalls(dev)).map((r) => r[0])).toEqual([90, 99]);
    dev.log.length = 0;
    ft.m_dwCurrentStamp = 99;
    ft.OutTextXY(100, 50, "ABAB", col, outc, null, 1, 0, 1, 1);
    expect(nonSrc(dev.log)).toEqual([...PUSH, ...POP]);
    expect(ft.m_dwCurrentStamp).toBe(5000);
    dev.log.length = 0;
    ft.OutTextXY(100, 50, "ABAB", col, outc, null, 0, -1, 1, 1);
    expect(rects(drawnCalls(dev)).length).toBe(4);
  });

  test("with an outline the outline pass comes first (the outline pages, colorOutLine, no colour codes), then the text with its colours; each pass is one Flush", () => {
    const { ft, dev } = onDevice(16, 1);
    ft.OutTextXY(100, 50, "#cFF0000A", 0xffff8040, 0x80102030, null, 0, -1, 1, 1);
    expect(nonSrc(dev.log)).toEqual([
      ...PUSH, "update 2 3", "tex 0 page3", "fvf 324", "draw 4 0 2", ...POP,
      ...PUSH, "update 0 1", "tex 0 page1", "fvf 324", "draw 4 6 2", ...POP,
    ]);
    const calls = drawnCalls(dev);
    expect(colorsOf(calls)).toEqual([0x80102030, 0xffff0000]);
    // the cell of A with an outline is 12 x 16; both passes are at the same place
    expect(rects(calls)).toEqual([[100, 50, 112, 66], [100, 50, 112, 66]]);
  });

  test("a flag for the outline pass does not change it: bNoColor is always on there", () => {
    const { ft, dev } = onDevice(16, 1);
    ft.OutTextXY(0, 0, "A#cxA", 0xffff8040, 0x80102030, null, 0x10000000, -1, 1, 1);
    expect(colorsOf(drawnCalls(dev))).toEqual([0x80102030, 0x80102030, 0xffff8040, 0xffff8040]);
  });
});

describe("OutTextMultiline (328DB3F0)", () => {
  const col = 0xff102030;
  const outc = 0xff405060;
  const multi = (text: string | null, opts: { ft?: ReturnType<typeof onDevice>; rt?: { left: number; top: number; right: number; bottom: number } | null; flag?: number; n?: number; space?: number; sx?: number; sy?: number; left?: number; top?: number } = {}) => {
    const w = opts.ft ?? onDevice();
    w.ft.OutTextMultiline(opts.left ?? 100, opts.top ?? 50, text, col, outc, opts.space ?? 1, opts.rt ?? null, opts.flag ?? 0, opts.n ?? -1, opts.sx ?? 1, opts.sy ?? 1);
    return { ...w, calls: drawnCalls(w.dev), rs: rects(drawnCalls(w.dev)) };
  };

  test("a line for each LF: the next one starts again at iLeft, (cell / E - 1) * lineSpace * scaleY lower (A 10 x 14 at y 50, B 12 x 15 at y 50 + 17); one Flush for all", () => {
    const { rs, dev } = multi("A\nB");
    expect(rs).toEqual([[100, 50, 110, 64], [100, 67, 112, 82]]);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "update 0 1", "tex 0 page1", "fvf 324", "draw 4 0 4", ...POP]);
  });

  test("the step is truncated after the three factors: 17 * 1.25 = 21.25 -> 21; (17 * 1.5) * 2 = 51 with the glyphs twice as high", () => {
    expect(multi("A\nB", { space: 1.25 }).rs).toEqual([[100, 50, 110, 64], [100, 71, 112, 86]]);
    expect(multi("A\nB", { space: 1.5, sy: 2 }).rs).toEqual([[100, 50, 110, 78], [100, 101, 112, 131]]);
    // 17 * 1.1f = 18.7 -> 18; 17 * 0.9 = 15.3 -> 15
    expect(multi("A\nB", { space: 1.1 }).rs[1]![1]).toBe(68);
    expect(multi("A\nB", { space: 0.9 }).rs[1]![1]).toBe(65);
    expect(multi("A\nB", { space: 0 }).rs[1]![1]).toBe(50);
    expect(multi("A\nB", { space: -1 }).rs[1]![1]).toBe(33);
  });

  test("the step goes by the CELL (outline included) over E, not by the font size: an outline of 1 makes the cell 20 and the step 19; E = 2 with the cell 18: 18 / 2 - 1 = 8", () => {
    const o = multi("A\nB", { ft: onDevice(16, 1) });
    // outline pass then text: both with A 12 x 16 at y 50 and B 14 x 17 at 50 + 19
    expect(o.rs).toEqual([[100, 50, 112, 66], [100, 69, 114, 86], [100, 50, 112, 66], [100, 69, 114, 86]]);
    const e = multi("A\nB", { ft: onDevice(8, 0, 2) });
    // inset by 10 / 4 = 2 and 14 / 2 = 7 for A; 12 / 4 = 3 and 15 / 2 = 7 for B (y0 = 50 + 8)
    expect(e.rs).toEqual([[102, 50, 108, 57], [103, 58, 109, 66]]);
  });

  test("a CR starts the next line at iLeft but does not move down; CR LF is one step; two LFs two", () => {
    expect(multi("A\rB").rs).toEqual([[100, 50, 110, 64], [100, 50, 112, 65]]);
    expect(multi("A\r\nB").rs).toEqual([[100, 50, 110, 64], [100, 67, 112, 82]]);
    expect(multi("A\n\nB").rs).toEqual([[100, 50, 110, 64], [100, 84, 112, 99]]);
    expect(multi("A\n\rB").rs).toEqual([[100, 50, 110, 64], [100, 67, 112, 82]]);
    expect(multi("A\r\rB").rs).toEqual([[100, 50, 110, 64], [100, 50, 112, 65]]);
  });

  test("a text that ends in a line break has no empty last line; one that starts with it has an empty first line", () => {
    expect(multi("A\n").rs).toEqual([[100, 50, 110, 64]]);
    expect(multi("A\r").rs).toEqual([[100, 50, 110, 64]]);
    expect(multi("A\r\n").rs).toEqual([[100, 50, 110, 64]]);
    expect(multi("\nA").rs).toEqual([[100, 67, 110, 81]]);
    expect(multi("\rA").rs).toEqual([[100, 50, 110, 64]]);
    const only = multi("\n");
    expect(only.rs).toEqual([]);
    expect(nonSrc(only.dev.log)).toEqual([...PUSH, ...POP]);
  });

  test("nothing at all (no states either) for no text, an empty text or a count of 0", () => {
    for (const [text, n] of [[null, -1], ["", -1], ["AB", 0]] as const) {
      const { dev } = multi(text, { n });
      expect(dev.log).toEqual([]);
    }
  });

  test("nCount takes the first characters (a count past the end is the whole text), at most 2999 in all: 3100 characters make 2999 quads (588 to a page: 5 pages full, then 59)", () => {
    expect(multi("AB\nA", { n: 2 }).rs).toEqual([[100, 50, 110, 64], [109, 50, 121, 65]]);
    expect(multi("AB\nA", { n: 3 }).rs).toEqual([[100, 50, 110, 64], [109, 50, 121, 65]]); // the LF is the last one: no empty line
    expect(multi("AB\nA", { n: 4 }).rs).toEqual([[100, 50, 110, 64], [109, 50, 121, 65], [100, 67, 110, 81]]);
    expect(multi("AB\nA", { n: 99 }).rs.length).toBe(3);
    const big = multi("A".repeat(3100), { left: 0 });
    expect(big.calls.map((c) => c.prims / 2)).toEqual([588, 588, 588, 588, 588, 59]);
    expect(multi("A".repeat(3000), { left: 0 }).rs.length).toBe(2999);
    expect(multi("A".repeat(2999), { left: 0 }).rs.length).toBe(2999);
    expect(multi("A".repeat(2998), { left: 0 }).rs.length).toBe(2998);
    expect(multi("A".repeat(3100), { left: 0, n: 5 }).rs.length).toBe(5);
    expect(multi("A".repeat(3100), { left: 0, n: 5000 }).rs.length).toBe(2999);
  });

  test("each line is aligned on its own width: flag 1 centres on iLeft, flag 2 ends at iLeft + 16 (no rectangle)", () => {
    // AB is 20 wide, A is 9: 100 - 10 = 90 and 100 - (int)4.5 = 96
    expect(multi("AB\nA", { flag: 1 }).rs.map((r) => [r[0], r[1]])).toEqual([[90, 50], [99, 50], [96, 67]]);
    // 100 + (16 - 20) and 100 + (16 - 9)
    expect(multi("AB\nA", { flag: 2 }).rs.map((r) => [r[0], r[1]])).toEqual([[96, 50], [105, 50], [107, 67]]);
    // 20 * 1.5 * 0.5 = 15, 9 * 1.5 * 0.5 = 6.75 -> 6
    expect(multi("AB\nA", { flag: 1, sx: 1.5 }).rs.map((r) => r[0])).toEqual([85, 98.5, 94]);
  });

  test("with a rectangle (10 .. 110) each line is centred in it (flag 1), ends at its right edge (flag 2), or starts at iLeft and is cut at the edge (flag 0)", () => {
    const rt = { left: 10, top: 0, right: 110, bottom: 20 };
    // 10 - (int)((100 - 20) * -0.5) = 50; 10 - (int)((100 - 9) * -0.5 = -45.5) = 55
    expect(multi("AB\nA", { rt, flag: 1 }).rs.map((r) => [r[0], r[1]])).toEqual([[50, 50], [59, 50], [55, 67]]);
    // 110 - 20, 110 - 9
    expect(multi("AB\nA", { rt, flag: 2 }).rs.map((r) => [r[0], r[1]])).toEqual([[90, 50], [99, 50], [101, 67]]);
    expect(multi("AB\nA", { rt, flag: 0 }).rs.map((r) => [r[0], r[1]])).toEqual([[100, 50], [109, 50], [100, 67]]);
    // cut: from 10 a line of A's has its quads at 10, 19, 28, 37 (the next pen is 46, past 40)
    const cut = multi("AAAAA\nAAAAA", { left: 10, rt: { left: 10, top: 0, right: 40, bottom: 20 }, flag: 0 });
    expect(cut.rs.map((r) => [r[0], r[1]])).toEqual([[10, 50], [19, 50], [28, 50], [37, 50], [10, 67], [19, 67], [28, 67], [37, 67]]);
    // a rectangle without a width does not cut
    const wide = multi("AAAAA", { left: 10, rt: { left: 10, top: 0, right: 10, bottom: 20 }, flag: 0 });
    expect(wide.rs.length).toBe(5);
  });

  test("a line of no characters (an empty line, or an LF only) is 0 wide for the alignment and draws nothing", () => {
    const rt = { left: 10, top: 0, right: 110, bottom: 20 };
    expect(multi("\nA", { rt, flag: 1 }).rs.map((r) => [r[0], r[1]])).toEqual([[55, 67]]);
    expect(multi("\nA", { flag: 2 }).rs.map((r) => [r[0], r[1]])).toEqual([[107, 67]]);
  });

  test("the colour starts again at the given colour on each line; #cx is the given colour; codes work as in OutTextXY and are off with bNoColor", () => {
    expect(colorsOf(multi("#cFF0000A\nB").calls)).toEqual([0xffff0000, col]);
    expect(colorsOf(multi("#cFF0000A#cxA\nA#c00FF00A").calls)).toEqual([0xffff0000, col, col, 0xff00ff00]);
    expect(colorsOf(multi("#cFF0000A\nB", { flag: 0x10000000 }).calls)).toEqual([col, col]);
    expect(colorsOf(multi("#cFF0000A\nB", { flag: 0x0ffffffc }).calls)).toEqual([0xffff0000, col]);
  });

  test("a font that is not RHW goes DOWN from the top: the next line is `step` lower in y numbers (50 - 17) and the quads are top - height high", () => {
    const { calls } = multi("A\nB", { ft: onDevice(16, 0, 1, false) });
    expect(calls.map((c) => [c.stride, c.prims])).toEqual([[24, 4]]);
    const v = calls[0]!.vertices;
    expect([v[0], v[4], v[6], v[10]].map((p) => [p![0], p![1]])).toEqual([[100, 50], [110, 36], [100, 33], [112, 18]]);
  });

  test("with an outline the outline pass is made first, for all the lines, then flushed; the text follows (bNoColor in the first, the colour restarting in the second)", () => {
    const w = onDevice(16, 1);
    w.ft.OutTextMultiline(100, 50, "#cFF0000A\nB", 0xffff8040, 0x80102030, 1, null, 0, -1, 1, 1);
    expect(nonSrc(w.dev.log)).toEqual([
      ...PUSH, "update 2 3", "tex 0 page3", "fvf 324", "draw 4 0 4", ...POP,
      ...PUSH, "update 0 1", "tex 0 page1", "fvf 324", "draw 4 12 4", ...POP,
    ]);
    const calls = drawnCalls(w.dev);
    expect(colorsOf(calls)).toEqual([0x80102030, 0x80102030, 0xffff0000, 0xffff8040]);
    expect(rects(calls)).toEqual([[100, 50, 112, 66], [100, 69, 114, 86], [100, 50, 112, 66], [100, 69, 114, 86]]);
  });

  test("the stamp of the glyph cache is not reset (only OutTextXY reads the clock): the cells of A and B get 1 and 2", () => {
    const { ft } = multi("A\nB");
    expect(ft.m_dwCurrentStamp).toBe(3);
  });

  test("a negative line space moves the next line up, and the step is cut towards 0: 17 * -0.5 = -8.5 -> -8 (B at 50 - 8)", () => {
    expect(multi("A\nB", { space: -0.5 }).rs).toEqual([[100, 50, 110, 64], [100, 42, 112, 57]]);
  });

  test("bNoColor is any bit of the high nibble, the top one (0x80000000) too", () => {
    expect(colorsOf(multi("#cFF0000A\nB", { flag: 0x80000000 }).calls)).toEqual([col, col]);
  });

  test("a line is measured without the CR that ends it and without the one that starts it: with an outline each character of the line adds 1 (A CR B at scale 2, centred: A starts 10 left of 100, B 12)", () => {
    const a = [90, 50, 114, 66]; // A of the outline font is 12 x 16: 24 wide at scale 2
    const b = [88, 50, 116, 67]; // B is 14 x 17
    // the outline pass and the text are the same
    expect(multi("A\rB", { ft: onDevice(16, 1), flag: 1, sx: 2 }).rs).toEqual([a, b, a, b]);
  });
});

describe("CUKFont: what the UI calls (font.ts)", () => {
  const col = 0xff102030;
  const outc = 0xff405060;
  /** a UK font around a glyph font loaded on the recorder (the world scale is (1.5, 2)) */
  function uk(size = 16, outline = 0, enlarge = 1, noRes = true) {
    const w = onDevice(size, outline, enlarge, true, {}, noRes);
    return { ...w, uk: w.w.fonts.addUKFont(1, w.ft) };
  }

  test("OutTextXY scales the position to the back buffer ((int)(x * 1.5), (int)(y * 2)), the quad is not scaled", () => {
    const { uk: f, dev } = uk();
    f.OutTextXY(100, 50, "A", col, 0, outc, null, 0, -1, 1, 1);
    expect(rects(drawnCalls(dev))).toEqual([[150, 100, 160, 114]]);
    dev.log.length = 0;
    f.OutTextXY(11, 7, "A", col, 0, outc, null, 0, -1, 1, 1); // 16.5, 14
    expect(rects(drawnCalls(dev))).toEqual([[16, 14, 26, 28]]);
    dev.log.length = 0;
    f.OutTextXY(-11, 7, "A", col, 0, outc, null, 0, -1, 1, 1); // -16.5 is cut towards 0
    expect(rects(drawnCalls(dev))[0]![0]).toBe(-16);
  });

  test("the rectangle is scaled side by side the same way: centred in (11 .. 111) -> (16 .. 166): 16 - (int)((150 - 20) * -0.5) = 81", () => {
    const { uk: f, dev } = uk();
    f.OutTextXY(0, 0, "AB", col, 0, outc, { left: 11, top: 3, right: 111, bottom: 20 }, 1, -1, 1, 1);
    expect(rects(drawnCalls(dev))[0]![0]).toBe(81);
    dev.log.length = 0;
    f.OutTextXY(0, 0, "AB", col, 0, outc, { left: -11, top: 3, right: 111, bottom: 20 }, 2, -1, 1, 1);
    expect(rects(drawnCalls(dev))[0]![0]).toBe(166 - 20); // right (int)166.5 = 166
    dev.log.length = 0;
    // cut at the scaled right edge: (int)(21 * 1.5 = 31.5) = 31: the pens 0, 9, 18, 27 (<= 31), 36 stops
    f.OutTextXY(0, 0, "AAAAAAAA", col, 0, outc, { left: 0, top: 0, right: 21, bottom: 20 }, 0, -1, 1, 1);
    expect(rects(drawnCalls(dev)).map((r) => r[0])).toEqual([0, 9, 18, 27]);
  });

  test("a style below FS_SHELL (2) has no outline colour (0): NONE and SHADOW draw the outline in 0, SHELL in the colour given; the style is compared as unsigned", () => {
    for (const [style, want] of [[0, 0], [1, 0], [2, 0x80102030], [3, 0x80102030], [-1, 0x80102030]] as const) {
      const { uk: f, dev } = uk(16, 1);
      f.OutTextXY(0, 0, "A", 0xffff8040, style, 0x80102030, null, 0, -1, 1, 1);
      expect(colorsOf(drawnCalls(dev))).toEqual([want, 0xffff8040]);
    }
  });

  test("OutTextMultiline: the same scaling, the line space and the lines of the glyph font", () => {
    const { uk: f, dev } = uk();
    f.OutTextMultiline(100, 50, "A\nB", col, 2, outc, 1.25, null, 0, -1, 1, 1);
    // (150, 100); the next line 21 lower
    expect(rects(drawnCalls(dev))).toEqual([[150, 100, 160, 114], [150, 121, 162, 136]]);
    dev.log.length = 0;
    const o = uk(16, 1);
    o.uk.OutTextMultiline(0, 0, "A", 0xffff8040, 1, 0x80102030, 1, null, 0, -1, 1, 1);
    expect(colorsOf(drawnCalls(o.dev))).toEqual([0, 0xffff8040]);
  });

  test("a font with no glyph font is a null dereference in the exe: the port throws; the measuring functions have an answer for it", () => {
    const w = onDevice();
    const none = new UKFont(9, null);
    expect(() => none.OutTextXY(0, 0, "A", col, 0, outc, null, 0, -1, 1, 1)).toThrow(/m_pUKFont is null/);
    expect(() => none.OutTextMultiline(0, 0, "A", col, 0, outc, 1, null, 0, -1, 1, 1)).toThrow(/m_pUKFont is null/);
    expect(() => none.GetWidth("A")).toThrow(/m_pUKFont is null/);
    expect(none.GetHeight("a\nb")).toBe(1);
    expect(none.GetPaddedHeight("a\nb", 4)).toBe(1);
    void w;
  });

  const white = { r: 1, g: 1, b: 1, a: 1 };
  const clear = { r: 0, g: 0, b: 0, a: 0 };

  test("Draw2DText packs a D3DXCOLOR: each channel clamped, (c * 255 + 0.5) cut: (1, 0.5, 0.25, 0.75) is 0xBF FF 80 40; below 0 is 0, from 1 is 255, a NaN is 255", () => {
    expect(packColor({ r: 1, g: 0.5, b: 0.25, a: 0.75 })).toBe(0xbfff8040);
    expect(packColor({ r: -3, g: 7, b: 0, a: 1 })).toBe(0xff00ff00);
    expect(packColor({ r: 0.999, g: 0.001, b: 0.002, a: 0.004 })).toBe(0x01ff0001);
    expect(packColor({ r: Number.NaN, g: 0, b: 0, a: 0 })).toBe(0x00ff0000);
    expect(packColor(white)).toBe(0xffffffff);
    expect(packColor(clear)).toBe(0);
  });

  test("Draw2DText with 0x20 in sortFlag is one line (LF skipped), in a rectangle of no size at (x, y) scaled: flag 0x21 centres on x, 0x22 ends at x", () => {
    const run = (flag: number, n = -1) => {
      const { uk: f, dev } = uk();
      f.Draw2DText("A\nB", 100, 50, white, clear, flag, 0, n);
      return rects(drawnCalls(dev));
    };
    expect(run(0x20)).toEqual([[150, 100, 160, 114], [159, 100, 171, 115]]);
    // the widest line is B, 11: 150 - (int)(11 * 0.5) = 145; 150 - 11 = 139
    expect(run(0x21).map((r) => r[0])).toEqual([145, 154]);
    expect(run(0x22).map((r) => r[0])).toEqual([139, 148]);
    expect(run(0x20, 1)).toEqual([[150, 100, 160, 114]]);
  });

  test("without 0x20 it is cut into lines, a step of 17 (line space 1) lower: flag 1 centres each line on x, flag 2 ends it at x", () => {
    const run = (flag: number, n = -1) => {
      const { uk: f, dev } = uk();
      f.Draw2DText("A\nB", 100, 50, white, clear, flag, 0, n);
      return rects(drawnCalls(dev));
    };
    expect(run(0)).toEqual([[150, 100, 160, 114], [150, 117, 162, 132]]);
    expect(run(1).map((r) => [r[0], r[1]])).toEqual([[146, 100], [145, 117]]); // 150 - (int)4.5, 150 - (int)5.5
    expect(run(2).map((r) => [r[0], r[1]])).toEqual([[141, 100], [139, 117]]); // 150 - 9, 150 - 11
    expect(run(0, 1)).toEqual([[150, 100, 160, 114]]);
  });

  test("the colours go through packColor: the text (1, 0.5, 0.25, 0.75), the outline (0.5 x 4: 0x80808080) of a SHELL font; a style below it has no outline colour", () => {
    const text = { r: 1, g: 0.5, b: 0.25, a: 0.75 };
    const half = { r: 0.5, g: 0.5, b: 0.5, a: 0.5 };
    const shell = uk(16, 1);
    shell.uk.Draw2DText("A", 0, 0, text, half, 0x20, 2, -1);
    expect(colorsOf(drawnCalls(shell.dev))).toEqual([0x80808080, 0xbfff8040]);
    const shell2 = uk(16, 1);
    shell2.uk.Draw2DText("A\nA", 0, 0, text, half, 0, 2, -1);
    expect(colorsOf(drawnCalls(shell2.dev))).toEqual([0x80808080, 0x80808080, 0xbfff8040, 0xbfff8040]);
    const plain = uk(16, 1);
    plain.uk.Draw2DText("A", 0, 0, text, half, 0x20, 1, -1);
    expect(colorsOf(drawnCalls(plain.dev))).toEqual([0, 0xbfff8040]);
  });

  test("Draw2DText with no text does nothing", () => {
    const { uk: f, dev } = uk();
    f.Draw2DText(null, 0, 0, white, clear, 0x20, 0, -1);
    f.Draw2DText(null, 0, 0, white, clear, 0, 0, -1);
    expect(dev.log).toEqual([]);
  });

  test("GetHeight: the lines (1 + the LFs found, a trailing LF counts one) times (fontSize / E + 1): 16 + 1 for a line; the text is read up to a NUL", () => {
    const { uk: f } = uk();
    expect(f.GetHeight("abc")).toBe(17);
    expect(f.GetHeight(null)).toBe(17);
    expect(f.GetHeight("")).toBe(17);
    expect(f.GetHeight("a\nb\nc")).toBe(51);
    expect(f.GetHeight("a\n")).toBe(34);
    expect(f.GetHeight("\n\n")).toBe(51);
    expect(f.GetHeight("a\n\nb")).toBe(51);
    expect(f.GetHeight("a\r\nb")).toBe(34);
    expect(f.GetHeight("a\0\nb")).toBe(17);
    // E = 2 (16 px): 16 / 2 + 1 = 9; a font that follows the resolution has 32 px: 33
    expect(uk(8, 0, 2).uk.GetHeight("a\nb")).toBe(18);
    expect(uk(16, 0, 1, false).uk.GetHeight("a")).toBe(33);
    expect(uk(5, 0, 3, true).uk.GetHeight("a\nb")).toBe(2 * (15 / 3 + 1));
  });

  test("GetPaddedHeight: the lines times (iAddHeight + 1 + fontSize / E); the padding can be negative", () => {
    const { uk: f } = uk();
    expect(f.GetPaddedHeight("a\nb", 4)).toBe(42);
    expect(f.GetPaddedHeight(null, 4)).toBe(21);
    expect(f.GetPaddedHeight("a", -3)).toBe(14);
    expect(f.GetPaddedHeight("a\nb\n", 0)).toBe(51);
    expect(uk(8, 0, 2).uk.GetPaddedHeight("a\nb", 4)).toBe(2 * (4 + 1 + 8));
  });

  test("GetWidth of a text is the glyph font's, of the whole text (AB 20); of a character: its size / E + 2 * outline - 1 (A: 9 - 1 = 8; with an outline 9 + 1 = 10; E = 2: 4 - 1 = 3)", () => {
    const { uk: f } = uk();
    expect(f.GetWidth("AB")).toBe(20);
    expect(f.GetWidth("A\nB")).toBe(11);
    expect(f.GetWidth(null)).toBe(0);
    expect(f.GetWidthOfChar("A".charCodeAt(0))).toBe(8);
    expect(f.GetWidthOfChar("B".charCodeAt(0))).toBe(10);
    expect(uk(16, 1).uk.GetWidthOfChar("A".charCodeAt(0))).toBe(10);
    expect(uk(8, 0, 2).uk.GetWidthOfChar("A".charCodeAt(0))).toBe(3);
    // a character nobody has measures -1: -1 / 1 - 1 = -2; -1 / 2 = 0 (towards 0) - 1 = -1
    expect(f.GetWidthOfChar("E".charCodeAt(0))).toBe(-2);
    expect(uk(8, 0, 2).uk.GetWidthOfChar("E".charCodeAt(0))).toBe(-1);
  });

  test("CalcTextRect: with 0x20 the height is fontSize / E + 1 (17), without it _EstimateStringHeight / E; the width is the widest line; the rectangle grows from its top left", () => {
    const { uk: f } = uk();
    const calc = (text: string | null, n: number, format: number, e = f) => {
      const pos = { left: 5, top: 7, right: 99, bottom: 99 };
      e.CalcTextRect(text, pos, n, format);
      return [pos.left, pos.top, pos.right, pos.bottom];
    };
    expect(calc("A\nB", -1, 0x20)).toEqual([5, 7, 16, 24]);
    expect(calc("A\nB", -1, 0)).toEqual([5, 7, 16, 41]);
    expect(calc("AB", 1, 0)).toEqual([5, 7, 14, 24]); // the first character only: 9 wide, one line
    expect(calc("AB", 1, 0x20)).toEqual([5, 7, 14, 24]);
    expect(calc("A\nB", 2, 0)).toEqual([5, 7, 14, 24]); // "A\n": the LF counts, a line of 17
    expect(calc("A\nB", 2, 0x21)).toEqual([5, 7, 14, 24]);
    // no text, an empty one, or a count of 0: an empty rectangle, wherever it was
    expect(calc(null, -1, 0)).toEqual([0, 0, 0, 0]);
    expect(calc("", -1, 0)).toEqual([0, 0, 0, 0]);
    expect(calc("AB", 0, 0x20)).toEqual([0, 0, 0, 0]);
    // E = 2: 16 / 2 + 1 = 9 high with 0x20, (34 / 2) = 17 without
    const e2 = uk(8, 0, 2).uk;
    expect(calc("A\nB", -1, 0x20, e2)).toEqual([5, 7, 5 + 5, 16]); // widest 11 / 2 = 5
    expect(calc("A\nB", -1, 0, e2)).toEqual([5, 7, 10, 24]);
    // no rectangle: nothing happens
    expect(() => f.CalcTextRect("AB", null, -1, 0)).not.toThrow();
  });

  /** a UK font on a back buffer 1000 x 1000: the scale is (0.9765625, 1.3020833), so a negative coordinate is cut from a fraction */
  function odd() {
    const w = onDevice(16, 0, 1, true, {}, true, { width: 1000, height: 1000 });
    return { ...w, uk: w.w.fonts.addUKFont(1, w.ft) };
  }

  test("a negative position is cut towards 0 after the scaling: (-3, -3) * (0.9765625, 1.3020833) = (-2.93, -3.9) -> (-2, -3)", () => {
    const a = odd();
    a.uk.OutTextXY(-3, -3, "A", col, 0, outc, null, 0, -1, 1, 1);
    expect(rects(drawnCalls(a.dev))).toEqual([[-2, -3, 8, 11]]);
    const b = odd();
    b.uk.OutTextMultiline(-3, -3, "A", col, 0, outc, 1, null, 0, -1, 1, 1);
    expect(rects(drawnCalls(b.dev))).toEqual([[-2, -3, 8, 11]]);
  });

  test("the scales reach the glyph font in order: x 2 and y 3 make the quad of A 20 x 42", () => {
    const a = uk();
    a.uk.OutTextXY(100, 50, "A", col, 0, outc, null, 0, -1, 2, 3);
    expect(rects(drawnCalls(a.dev))).toEqual([[150, 100, 170, 142]]);
    const b = uk();
    b.uk.OutTextMultiline(100, 50, "A", col, 0, outc, 1, null, 0, -1, 2, 3);
    expect(rects(drawnCalls(b.dev))).toEqual([[150, 100, 170, 142]]);
  });

  test("OutTextMultiline: a style below FS_SHELL has no outline colour, compared as unsigned like OutTextXY (-1 is above it)", () => {
    for (const [style, want] of [[0, 0], [1, 0], [2, 0x80102030], [3, 0x80102030], [-1, 0x80102030]] as const) {
      const { uk: f, dev } = uk(16, 1);
      f.OutTextMultiline(0, 0, "A", 0xffff8040, style, 0x80102030, 1, null, 0, -1, 1, 1);
      expect(colorsOf(drawnCalls(dev))).toEqual([want, 0xffff8040]);
    }
  });

  test("a rectangle's left and right are cut towards 0 after the scaling (-3 * 1.5 = -4.5 -> -4): centred in (-3 .. 100) -> (-4 .. 150) the text starts at -4 + 67, right-aligned at -3 -> -4 it starts at -24", () => {
    const { uk: f, dev } = uk();
    f.OutTextXY(0, 0, "AB", col, 0, outc, { left: -3, top: 0, right: 100, bottom: 20 }, 1, -1, 1, 1);
    expect(rects(drawnCalls(dev))[0]![0]).toBe(63); // -4 - (int)((154 - 20) * -0.5)
    dev.log.length = 0;
    f.OutTextXY(0, 0, "AB", col, 0, outc, { left: -20, top: 0, right: -3, bottom: 20 }, 2, -1, 1, 1);
    expect(rects(drawnCalls(dev))[0]![0]).toBe(-24);
  });

  test("no rectangle is no rectangle (not an empty one at 0): flag 1 centres on the scaled x, 150 - (int)(20 * 0.5)", () => {
    const { uk: f, dev } = uk();
    f.OutTextXY(100, 50, "AB", col, 0, outc, null, 1, -1, 1, 1);
    expect(rects(drawnCalls(dev))[0]![0]).toBe(140);
  });

  test("Draw2DText in lines gives the glyph font the style it was given: a style below FS_SHELL has no outline colour", () => {
    const text = { r: 1, g: 0.5, b: 0.25, a: 0.75 };
    const half = { r: 0.5, g: 0.5, b: 0.5, a: 0.5 };
    const plain = uk(16, 1);
    plain.uk.Draw2DText("A\nA", 0, 0, text, half, 0, 1, -1);
    expect(colorsOf(drawnCalls(plain.dev))).toEqual([0, 0, 0xbfff8040, 0xbfff8040]);
  });
});

// ---- the edges tools/mutate-font.py found untested: every number below is worked out by hand, like the ones above ------------------------

describe("construction and resolution", () => {
  test("an enlargement below 1 is 1 for the divisions (the sizes keep the number given: 0 * 16, -3 * 16)", () => {
    const { font } = fontWorld();
    const zero = font(16, 0, 0);
    const negative = font(16, 0, -3);
    expect([zero.m_EnlargeNum, zero.m_iOrgFontSize, negative.m_EnlargeNum, negative.m_iOrgFontSize]).toEqual([1, 0, 1, -48]);
  });

  test("without a render the resolution scale is (1, 1); with one it is the back buffer over 1024 x 768", () => {
    const none = fontWorld({}, { device: false }).font(16).resolutionScale;
    expect([none.x, none.y]).toEqual([1, 1]);
    const scale = fontWorld().font(16).resolutionScale;
    expect([scale.x, scale.y]).toEqual([1.5, 2]);
  });

  test("the size the resolution gives is CUT, not rounded: 13 px on a back buffer 1000 high is (int)(13 * 1000 / 768 = 16.93) = 16, a cell of 18", () => {
    const { font } = fontWorld({}, { backBuffer: { width: 1024, height: 1000 } });
    const ft = font(13, 0, 1, false);
    expect(ft.Load()).toBe(true);
    expect([ft.m_iFontSize, ft.m_iFontCacheSize]).toEqual([16, 18]);
  });
});

describe("what the glyphs look like in the cache (shapes the solid boxes of MAIN cannot show: SHAPES, fontworld.ts)", () => {
  const bars = [255, 255, 0, 0, 0, 0, 255, 255];

  test("H, two bars 2 px wide (x 0..2 and 6..8) and 10 high, advance 10: a cell 10 x 14; the bars are white with their coverage, the gap between them is white with 0 coverage, outside the bitmap is 0", () => {
    const { ft } = loaded(16, 0, 1, true, { main: SHAPES });
    const h = ft.GetFontCache(code("H"));
    expect([h.iWidth, h.iHeight]).toEqual([10, 14]);
    const bits = ft.m_pTexture[0]!.pBits!;
    for (let r = 0; r < 14; r++) {
      for (let c = 0; c < 10; c++) {
        const inside = c < 8 && r >= 3 && r < 13; // the bitmap is 8 x 10 at (0, 3)
        expect(bits[(r << 8) + c]).toBe(inside ? WHITE(bars[c]!) : 0);
      }
    }
  });

  test("with an outline of 1 each pixel of the outline's bitmap adds the 2 before it and the rows the 2 below: the bars grow to 4 px, the bitmap to 10 x 12, rows 10 wide; the main bitmap stays 8 wide, 1 px in", () => {
    const { ft } = loaded(16, 1, 1, true, { main: SHAPES });
    const h = ft.GetFontCache(code("H"));
    expect([h.iWidth, h.iHeight]).toEqual([12, 16]); // 10 + 2 against 10; 3 + 12 + 1
    const main = ft.m_pTexture[0]!.pBits!;
    const outline = ft.m_pTextureOutLine[0]!.pBits!;
    const grown = [255, 255, 255, 255, 0, 0, 255, 255, 255, 255];
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 12; c++) {
        // main: x = c - 1 in [0, 8), y = r - 1 - 3 in [0, 10); outline: x = c in [0, 10), y = r - 3 in [0, 12)
        const mainInside = c >= 1 && c < 9 && r >= 4 && r < 14;
        const outlineInside = c < 10 && r >= 3 && r < 15;
        expect(main[(r << 8) + c]).toBe(mainInside ? WHITE(bars[c - 1]!) : 0);
        expect(outline[(r << 8) + c]).toBe(outlineInside ? WHITE(grown[c]!) : 0);
      }
    }
  });

  test("N starts 2 px left of its origin (bearing -2): the bearing is cut at 0, so its bitmap (8 x 10) is drawn from column 0 of the cell", () => {
    const { ft } = loaded(16, 0, 1, true, { main: SHAPES });
    const n = ft.GetFontCache(code("N"));
    expect([n.iWidth, n.iHeight]).toEqual([10, 14]);
    const bits = ft.m_pTexture[0]!.pBits!;
    for (let r = 0; r < 14; r++) for (let c = 0; c < 10; c++) expect(bits[(r << 8) + c]).toBe(c < 8 && r >= 3 && r < 13 ? WHITE(255) : 0);
  });

  test("with an outline a bitmap wider than the advance takes the OUTLINE's width: W (16 wide, advance 8) grows to 18 against 8 + 2; 8 + 7 + 1 high", () => {
    const { ft } = loaded(16, 1);
    const w = ft.GetFontCache(code("W"));
    expect([w.iWidth, w.iHeight, w._texRight, w._texBottom]).toEqual([18, 16, 18.5 / 256, 16.5 / 256]);
  });

  test("a cell in the second row of the page (the 15th: 14 fit across): its texels go 18 rows down and the bottom of its rectangle counts from the top of the page", () => {
    const { ft } = loaded(16, 0, 1, true, { main: LETTERS });
    const cells = [..."abcdefghijklmno"].map((c) => ft.GetFontCache(code(c)));
    const o = cells[14]!;
    expect([o.iPage, o.iLeft, o.iTop]).toEqual([0, 0, 18]);
    // a letter is a box like A: 10 x 14
    expect([o._texTop, o._texBottom, o._texRight]).toEqual([18.5 / 256, 32.5 / 256, 10.5 / 256]);
    const bits = ft.m_pTexture[0]!.pBits!;
    for (let r = 0; r < 14; r++) for (let c = 0; c < 10; c++) expect(bits[((18 + r) << 8) + c]).toBe(c >= 1 && c < 9 && r >= 3 && r < 13 ? WHITE(255) : 0);
  });

  test("a cell on page 1 of a font with an outline tells ITS outline page about the change, not the first one", () => {
    const { ft } = loaded(120, 1, 1, true, { main: LETTERS });
    expect(ft.m_iFontCacheSize).toBe(124); // 120 + 2 + 2: two across, four to a page
    for (const c of "abcd") ft.GetFontCache(code(c));
    const e = ft.GetFontCache(code("e"));
    expect([e.iPage, e.iLeft, e.iTop]).toEqual([1, 0, 0]);
    const changed = { left: 0, top: 0, right: e.iWidth, bottom: e.iHeight };
    expect(ft.m_pTextureOutLine[1]!.dirtyRects).toEqual([changed]);
    expect(ft.m_pTexture[1]!.dirtyRects).toEqual([changed]);
    expect(ft.m_pTextureOutLine[0]!.dirtyRects.length).toBe(4);
    expect(ft.m_pTextureOutLine[2]!.dirtyRects).toEqual([]);
  });

  test("the character is a 16-bit wchar_t: U+10041 is the cell of U+0041, and measures as A", () => {
    const { ft } = loaded();
    const a = ft.GetFontCache(0x41);
    expect(ft.GetFontCache(0x10041)).toBe(a);
    expect(ft.m_iSizeArray).toBe(1);
    expect(ft._EstimateFontSize(0x10041)).toEqual({ cx: 9, cy: 13 });
    expect(loaded().ft._EstimateFontSize(0x10041)).toEqual({ cx: 9, cy: 13 }); // asked first: no cell of its own either
  });

  test("the last cell of the cache can be the one given up, and a cell given up gets the stamp as a DWORD", () => {
    const full = () => {
      const { ft } = loaded(120, 0, 1, true, { main: LETTERS });
      const cells = [..."abcdefghijklmnop"].map((c) => ft.GetFontCache(code(c)));
      return { ft, cells };
    };
    const a = full();
    for (const c of a.cells) c.dwLastUse = 50;
    a.cells[15]!.dwLastUse = 7;
    expect(a.ft.GetFontCache(code("q"))).toBe(a.cells[15]!);
    const b = full();
    b.ft.m_dwCurrentStamp = 0xffffffff;
    const q = b.ft.GetFontCache(code("q"));
    expect([q.dwLastUse, b.ft.m_dwCurrentStamp]).toEqual([0xffffffff, 0]);
  });
});

describe("measuring: the edges", () => {
  test("a count past the end measures the terminating NUL, a glyph nobody has: -1 - 2 * outline wide (AB, 3: 9 + 11 - 1; with an outline of 1: 9 + 11 - 3)", () => {
    expect(loaded().ft._EstimateStringWidth("AB", 3)).toBe(19);
    expect(loaded(16, 1).ft._EstimateStringWidth("AB", 3)).toBe(17);
  });

  test("GetWidth: the widest line counts wherever it is (AB, A, B: 20)", () => {
    expect(loaded().ft.GetWidth("AB\nA\nB", -1)).toBe(20);
  });

  test("GetWidth: a # that is the last of the count is a character, not the start of a code (A#c cut to 2: 9 + 7)", () => {
    expect(loaded().ft.GetWidth("A#c", 2)).toBe(16);
  });

  test("GetWidth: a NUL inside the text measures nothing, nor does a position past its end; a text that starts with a NUL is empty whatever the count", () => {
    const { ft } = loaded();
    expect(ft.GetWidth("A\0B", 3)).toBe(20);
    expect(ft.GetWidth("AB", 5)).toBe(20);
    expect(ft.GetWidth("\0AB", 3)).toBe(0);
  });
});

describe("colour codes, pages and the clock: the edges", () => {
  /** the colour of each quad of `text` drawn over 0xFF000000 */
  const colours = (text: string): number[] => {
    const { ft } = loaded();
    ft.Buffering(false, 0, 0, text, 0xff000000, 0, false, -1, 1, 1, 0);
    return pageQuads(ft, 0).map((v) => v[0]![4]!);
  };

  test("the six characters after #c are read like scanf %x: 0X as well as 0x, a tab as white space, lower case digits", () => {
    expect(colours("#c0XFF00A")).toEqual([0xff00ff00]); // 0XFF00
    expect(colours("#c\tAB12CB")).toEqual([0xff0ab12c]); // <tab>AB12C
    expect(colours("#cff00aaA")).toEqual([0xffff00aa]);
  });

  test("a # that is the last character of the count is a character even when a code follows it in the text: A#cFF0000B cut to 2 makes two quads", () => {
    const { ft } = loaded();
    ft.Buffering(false, 0, 0, "A#cFF0000B", 0xffffffff, 0, false, 2, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(2);
  });

  test("a page that fills during the OUTLINE pass is drawn with the outline's texture (cell 104: 14 to a page; the 15th quad starts the page again)", () => {
    const { ft, dev } = onDevice(100, 1);
    expect(ft.m_iNumCandidatesInAPage).toBe(14);
    ft.Buffering(true, 0, 0, "A".repeat(15), 0xffffffff, 0xffffffff, true, -1, 1, 1, 0);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "update 2 3", "tex 0 page3", "fvf 324", "draw 4 0 28", ...POP]);
    expect(ft.m_iCandidate).toEqual([1, 0, 0, 0]);
  });

  test("a page that fills is drawn alone: the quads waiting on another page stay where they are", () => {
    const { ft, dev } = onDevice(120, 0, 1, true, { main: LETTERS });
    for (const c of "abcdefghijklmnop") ft.GetFontCache(code(c)); // a-d on page 0, e-h on page 1
    expect(ft.m_iNumCandidatesInAPage).toBe(12);
    dev.log.length = 0;
    // e is on page 1; the 12 a's fill page 0; the 13th makes page 0 go out
    ft.Buffering(false, 0, 0, "e" + "a".repeat(13), 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(drawnCalls(dev).map((c) => c.prims)).toEqual([24]);
    expect(ft.m_iCandidate).toEqual([1, 1, 0, 0]);
  });

  test("a Flush that frees nothing: the exe's second check empties the page and the text stops", () => {
    const { ft } = loaded(100);
    expect(ft.m_iNumCandidatesInAPage).toBe(14);
    ft.Flush = () => {};
    ft.Buffering(false, 0, 0, "A".repeat(20), 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate[0]).toBe(0);
  });

  test("Flush of page 0 draws page 0 only (0 is a page, a negative number is all of them)", () => {
    const { ft, dev } = onDevice(120, 0, 1, true, { main: LETTERS });
    for (const c of "abcdefghijklmnop") ft.GetFontCache(code(c));
    ft.Buffering(false, 0, 0, "aeb", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect(ft.m_iCandidate).toEqual([2, 1, 0, 0]);
    dev.log.length = 0;
    ft.Flush(false, 0);
    expect(nonSrc(dev.log)).toEqual([...PUSH, "update 0 1", "tex 0 page1", "fvf 324", "draw 4 0 4", ...POP]);
    expect(ft.m_iCandidate).toEqual([0, 1, 0, 0]);
  });

  test("a page with no vertex memory is not drawn, not even its texture is set, and its count is cleared", () => {
    const { ft, dev } = onDevice();
    ft.m_apPageVertex[0] = null;
    ft.m_iCandidate[0] = 3;
    ft.Flush(false, 0);
    expect(nonSrc(dev.log)).toEqual([...PUSH, ...POP]);
    expect(ft.m_iCandidate).toEqual([0, 0, 0, 0]);
  });

  test("OutTextXY clips at the rectangle's right edge itself: with right 108 the starts 10 + 9k reach 109 at k = 11, which is one past it and is not drawn", () => {
    const { ft, dev } = onDevice();
    ft.OutTextXY(10, 0, "A".repeat(13), 0xff102030, 0xff405060, { left: 10, top: 0, right: 108, bottom: 20 }, 0, -1, 1, 1);
    expect(rects(drawnCalls(dev)).map((r) => r[0])).toEqual(Array.from({ length: 11 }, (_, k) => 10 + 9 * k));
  });

  test("OutTextXY: the stamp is the clock as a DWORD (2^32 + 5 is 5), and it is set after the alignment has been measured (the measuring's own uses do not count)", () => {
    const { ft, clock } = onDevice();
    clock.now = 2 ** 32 + 5;
    ft.OutTextXY(0, 0, "A", 0xff102030, 0xff405060, null, 0, -1, 1, 1);
    const cell = (c: string) => ft.m_FontCacheArray![ft.hashCell[c.charCodeAt(0)]!]!;
    expect([cell("A").dwLastUse, ft.m_dwCurrentStamp]).toEqual([5, 6]);
    // flag 1 measures AB first (which makes the two cells, stamps 1 and 2 of the font): the clock goes in after that
    const centred = onDevice();
    centred.ft.OutTextXY(100, 50, "AB", 0xff102030, 0xff405060, null, 1, -1, 1, 1);
    const cell2 = (c: string) => centred.ft.m_FontCacheArray![centred.ft.hashCell[c.charCodeAt(0)]!]!;
    expect([cell2("A").dwLastUse, cell2("B").dwLastUse, centred.ft.m_dwCurrentStamp]).toEqual([5000, 5001, 5002]);
  });
});

describe("the life of the device: UnLoad (328DCE70), OnLostDevice (328DB240), OnResetDevice (328DB270)", () => {
  const A = code("A");
  /** the creates of `n` textures made after `first` (the recorder gives them ids in order): a system texture, then its video texture */
  const creates = (first: number, n: number) => Array.from({ length: n }, (_, i) => `create ${first + i} pool ${i % 2 === 0 ? 2 : 0} 256x256`);
  const allClear = (ft: ReturnType<typeof onDevice>["ft"]) => ft.hashCell.every((v) => v === -1) && ft.hashSizeKnown.every((v) => v === 0) && ft.hashCx.every((v) => v === 0) && ft.hashCy.every((v) => v === 0);

  test("UnLoad: the font is not loaded any more, its eight page textures are destroyed (unlocked, released) and dropped, the cells, the hash table and the vertex memory are gone; the faces, the counts and the quads that wait in a page stay", () => {
    const { ft, dev } = onDevice(16, 1);
    ft.GetFontCache(A);
    ft._EstimateFontSize(code("B"));
    ft.Buffering(false, 10, 10, "A", 0xffffffff, 0, false, -1, 1, 1, 0);
    expect([ft.hashCell[65], ft.hashSizeKnown[66]]).toEqual([0, 1]);
    expect(ft.hashCx[66]).toBeGreaterThan(0);
    expect(ft.hashCy[66]).toBeGreaterThan(0);
    expect(dev.textures.every((t) => t.refs === 1)).toBe(true);
    const [face, sub, kor] = [ft.m_FreeTypeFace, ft.m_FreeTypeSubFace, ft.m_KoreanFreeTypeFace];
    const [total, size, stamp] = [ft.m_iTotalCache, ft.m_iSizeArray, ft.m_dwCurrentStamp];
    expect([ft.m_pTexture, ft.m_pTextureOutLine].flat().every((t) => t !== null)).toBe(true);

    ft.UnLoad(true);
    expect(ft.m_bLoad).toBe(false);
    expect(ft.m_pTexture.every((t) => t === null) && ft.m_pTextureOutLine.every((t) => t === null)).toBe(true);
    expect(dev.textures.length).toBe(16);
    expect(dev.textures.map((t) => [t.refs, t.locked])).toEqual(Array.from({ length: 16 }, () => [0, false]));
    expect(ft.m_FontCacheArray).toBeNull();
    expect(ft.m_apPageVertex.every((b) => b === null)).toBe(true);
    expect(allClear(ft)).toBe(true);
    // what UnLoad does not touch
    expect([ft.m_iTotalCache, ft.m_iSizeArray, ft.m_dwCurrentStamp, ft.m_iCandidate]).toEqual([total, size, stamp, [1, 0, 0, 0]]);
    expect([ft.m_FreeTypeFace === face, ft.m_FreeTypeSubFace === sub, ft.m_KoreanFreeTypeFace === kor]).toEqual([true, true, true]);
    expect([face, sub, kor].every((x) => x !== null)).toBe(true);
  });

  test("bComplete is not looked at: UnLoad(false) does the same, for a font without an outline too (four pages)", () => {
    const { ft, dev } = onDevice(16, 0);
    ft.UnLoad(false);
    expect([ft.m_bLoad, ft.m_pTexture.every((t) => t === null), ft.m_FontCacheArray, ft.m_apPageVertex.every((b) => b === null)]).toEqual([false, true, null, true]);
    expect(dev.textures.map((t) => t.refs)).toEqual(Array(8).fill(0));
  });

  test("a font that is not loaded keeps everything it has (a font made loaded by hand: UnLoad does nothing); one that never was has nothing to give back", () => {
    const { ft, dev } = onDevice(16, 1);
    ft.m_bLoad = false;
    ft.UnLoad(true);
    expect(ft.m_pTexture.every((t) => t !== null) && ft.m_pTextureOutLine.every((t) => t !== null)).toBe(true);
    expect([ft.m_FontCacheArray === null, ft.m_apPageVertex.every((b) => b !== null)]).toEqual([false, true]);
    expect(dev.textures.every((t) => t.refs === 1)).toBe(true);
    const { font } = fontWorld();
    const never = font(16);
    never.UnLoad(true);
    expect([never.m_bLoad, never.m_FontCacheArray]).toEqual([false, null]);
  });

  test("a Load after UnLoad starts afresh: new page textures, an empty cache (the first character takes the first cell again)", () => {
    const { ft, dev } = onDevice(16, 0);
    expect(ft.GetFontCache(A).iLeft).toBe(0);
    expect(ft.GetFontCache(code("B")).iLeft).toBe(18); // B is in the second cell of the first row (cells are 18 wide)
    ft.UnLoad(true);
    dev.log.length = 0;
    expect(ft.Load()).toBe(true);
    expect(dev.log).toEqual(creates(8, 8));
    expect(allClear(ft)).toBe(true);
    const b = ft.GetFontCache(code("B"));
    expect([b.iPage, b.iLeft, b.iTop]).toEqual([0, 0, 0]);
  });

  test("OnLostDevice: every page texture, the outline pages too, loses its video texture (released); the system textures stay, locked", () => {
    const { ft, dev } = onDevice(16, 1);
    ft.OnLostDevice();
    // 16 textures: a system one then a video one for every page, the outline page after its page
    expect(dev.textures.map((t) => t.refs)).toEqual(Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 1 : 0)));
    expect(dev.textures.filter((_, i) => i % 2 === 0).every((t) => t.locked)).toBe(true);
    expect([ft.m_pTexture, ft.m_pTextureOutLine].flat().map((t) => t!.m_pTextureVid)).toEqual(Array(8).fill(null));
    expect(ft.m_bLoad).toBe(true);
  });

  test("OnLostDevice of a font without an outline loses four video textures; of one that is not loaded it does nothing", () => {
    const { ft, dev } = onDevice(16, 0);
    ft.OnLostDevice();
    expect(dev.textures.map((t) => t.refs)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    const { font } = fontWorld();
    expect(() => font(16).OnLostDevice()).not.toThrow();
  });

  test("OnResetDevice of a loaded font whose size is unchanged makes every page's video texture again, page 0, its outline page, page 1, ... from the system texture; the cells, the faces and the pages stay", () => {
    const { ft, dev } = onDevice(16, 1);
    const cell = ft.GetFontCache(A);
    const [cache, face, page0] = [ft.m_FontCacheArray, ft.m_FreeTypeFace, ft.m_pTexture[0]!];
    expect(page0.m_bUpdateTexture).toBe(true); // the glyph is in the system texture only
    ft.OnLostDevice();
    ft.OnResetDevice();
    // the pages' system textures are 0, 2, 4, ... (the video ones 1, 3, ...): the new video textures are 16, 17, ...
    const want: string[] = [];
    for (let n = 0; n < 4; n++) want.push(`create ${16 + 2 * n} pool 0 256x256`, `update ${4 * n} ${16 + 2 * n}`, `create ${17 + 2 * n} pool 0 256x256`, `update ${4 * n + 2} ${17 + 2 * n}`);
    expect(dev.log).toEqual(want);
    expect([ft.m_bLoad, ft.m_FontCacheArray === cache, ft.m_FreeTypeFace === face, ft.m_pTexture[0] === page0, ft.GetFontCache(A) === cell]).toEqual([true, true, true, true, true]);
    expect(page0.m_bUpdateTexture).toBe(false);
    // the glyph is in the new video texture
    expect(dev.textures[0]!.bits.some((b) => b !== 0)).toBe(true);
    expect(Buffer.compare(dev.textures[16]!.bits, dev.textures[0]!.bits)).toBe(0);
    expect(dev.textures.map((t) => t.refs)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, ...Array(8).fill(1)]);
  });

  test("OnResetDevice of a font whose size the resolution scale has changed unloads it and loads it again (new cells, new pages), then makes the video textures once more", () => {
    const { font, w, dev } = fontWorld(); // 1536 x 1536: scale (1.5, 2)
    const ft = font(8, 1, 2); // 16 px by the layout: 32 on this back buffer, a cell of 32 + 2 + 2 = 36
    expect(ft.Load()).toBe(true);
    expect([ft.m_iFontSize, ft.m_iFontCacheSize, ft.m_iTotalCache]).toEqual([32, 36, 28 * 7]); // 1024 / 36 = 28, 256 / 36 = 7
    ft.GetFontCache(A);
    const [cache, page0, face] = [ft.m_FontCacheArray, ft.m_pTexture[0], ft.m_FreeTypeFace];
    w.render!.setBackBufferSize(1536, 768); // scale (1.5, 1)
    dev!.log.length = 0;
    ft.OnResetDevice();
    // 16 px, a cell of 20: 1024 / 20 = 51, 256 / 20 = 12, 768 / 20 = 38
    expect([ft.m_iFontSize, ft.m_iFontCacheSize, ft.m_iTotalCache, ft.m_iNumCandidatesInAPage, ft.m_bLoad]).toEqual([16, 20, 51 * 12, 38 * 12, true]);
    expect([ft.m_FontCacheArray === cache, ft.m_pTexture[0] === page0, ft.m_FreeTypeFace === face, ft.hashCell[65]]).toEqual([false, false, false, -1]);
    expect(dev!.textures.slice(0, 16).map((t) => [t.refs, t.locked])).toEqual(Array.from({ length: 16 }, () => [0, false])); // the old pages are destroyed
    // Load made 16 textures (16 .. 31: main 0 is 16 and 17, its outline page 18 and 19, ...), then ResetDevice makes the 8 video textures again
    const want = creates(16, 16);
    for (let n = 0; n < 4; n++) want.push(`create ${32 + 2 * n} pool 0 256x256`, `update ${16 + 4 * n} ${32 + 2 * n}`, `create ${33 + 2 * n} pool 0 256x256`, `update ${18 + 4 * n} ${33 + 2 * n}`);
    expect(dev!.log).toEqual(want);
  });

  test("the size is the original size times the scale's y (x is not looked at), cut to an integer, and a size that is the same is left alone: scale (2, 1.5) takes 16 to 24 and a cell of 28; 13 at 1.5 is 19, not 20", () => {
    const { ft, w } = onDevice(8, 1, 2, true, {}, false); // 1536 x 1536: 16 -> 32
    const cache = ft.m_FontCacheArray;
    ft.OnResetDevice();
    expect(ft.m_FontCacheArray === cache).toBe(true); // 32 = (int)(16 * 2): the same size (with x it would be 24)
    w.render!.setBackBufferSize(2048, 1152); // (2, 1.5)
    ft.OnResetDevice();
    expect([ft.m_iFontSize, ft.m_iFontCacheSize, ft.m_FontCacheArray === cache]).toEqual([24, 28, false]);
    const odd = onDevice(13, 0, 1, true, {}, false, { width: 1536, height: 1152 }); // (1.5, 1.5)
    expect(odd.ft.m_iFontSize).toBe(19); // (int)19.5
    const oddCache = odd.ft.m_FontCacheArray;
    odd.ft.OnResetDevice();
    expect(odd.ft.m_FontCacheArray === oddCache).toBe(true);
  });

  test("a font that does not follow the resolution (bNoRes) is not made again when the scale changes; one that is not the size it should be is", () => {
    const { ft, w } = onDevice(16, 0, 1, true, {}, true);
    const cache = ft.m_FontCacheArray;
    w.render!.setBackBufferSize(512, 384);
    ft.OnResetDevice();
    expect([ft.m_FontCacheArray === cache, ft.m_iFontSize]).toEqual([true, 16]);
    ft.m_iFontSize = 5; // not what the font wants: 16
    ft.OnResetDevice();
    expect([ft.m_FontCacheArray === cache, ft.m_iFontSize]).toEqual([false, 16]);
  });

  test("OnResetDevice of a font that is not loaded loads it (and makes no video texture again); a font whose files are not there stays unloaded, the error is the one Load reports", () => {
    const { ft, dev } = onDevice(16, 0);
    ft.UnLoad(true);
    dev.log.length = 0;
    ft.OnResetDevice();
    expect(ft.m_bLoad).toBe(true);
    expect(dev.log).toEqual(creates(8, 8)); // Load's pages and nothing else: no `update`
    const { font, w } = fontWorld({ main: null });
    const lost = font(16);
    lost.OnResetDevice();
    expect(lost.m_bLoad).toBe(false);
    expect(w.messageBoxes).toEqual([{ text: "BOXFONT", caption: "Font Load Error!" }]);
  });
});
