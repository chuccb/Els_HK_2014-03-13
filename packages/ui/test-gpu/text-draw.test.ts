/**
 * Text of the client's fonts drawn through the whole stack: the real fonts of the HK client (the seven `CUKFont`s the config script makes,
 * FreeType 2.4.11 as the exe has it, `DFT_P7.TTC` / `MSJH` / `GULIM`), the glyph cache and its pages (`CKTDGDynamicTexture`), the quads of
 * `CKTDGFreeTypeFont::Buffering` as triangle LISTS through the dynamic vertex buffers, and `Direct3DDevice9` on WebGPU.
 *
 * As in `dialog-draw.test.ts`, every draw is written down with its device state and composed again on the CPU by the rules of Direct3D 9
 * (`reference.ts`), and the picture the device made has to agree with that.  A glyph page is not a file: it is what the glyph cache wrote
 * into it, and it changes between the draws of one scene, so its pixels are copied at the moment of each draw (`recordDraws`'s snapshot).
 * The pictures are saved when `D3D9_TEST_OUT` names a folder.
 *
 * Needs a WebGPU adapter (`./tools/gpu.sh`: SwiftShader) and the client's data; skipped without them.  Run in the process of the GPU tests.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Direct3DTexture9 } from "@els/d3d9";
import { FONT_STYLE } from "../src/index.ts";
import type { UKFont, UIWorld } from "../src/index.ts";
import { gpuAvailable } from "../../d3d9/test/gpu-helper.ts";
import { compareImages } from "./reference.ts";
import type { Difference, RefImage } from "./reference.ts";
import { CLEAR, TOLERANCE, drawScene, newWorld, pageSnapshot, releaseDrawn } from "./draw.ts";
import type { Draw, Scene } from "./draw.ts";

const dataDir = join(import.meta.dir, "..", "..", "..", "data");
const haveData = existsSync(join(dataDir, "x2.exe")) && existsSync(join(dataDir, "data036.kom")) && existsSync(join(dataDir, "general.ess"));
const HAVE_GPU = haveData && (await gpuAvailable());

const BLACK = 0xff000000;
const WHITE = 0xffffffff;

function report(name: string, d: Difference): string {
  return `${name}: ${d.over} of ${d.pixels} pixels differ by more than ${TOLERANCE}, the largest difference ${d.max}, the mean ${d.mean.toFixed(4)}, first at ${JSON.stringify(d.firstOver)}`;
}

/** a world with the client's fonts: the seven UK fonts, in the order outline first, then by size */
function clientFonts(w: UIWorld): UKFont[] {
  const fonts = [...w.fonts.m_mapUKFontList.values()].filter((f): f is UKFont => !!f?.m_pUKFont);
  fonts.sort((a, b) => b.m_pUKFont!.m_iOutLineSize - a.m_pUKFont!.m_iOutLineSize || a.m_pUKFont!.m_iFontSize - b.m_pUKFont!.m_iFontSize);
  return fonts;
}

/** how many pixels of a rectangle of the picture are not the clear colour (by more than a little) */
function ink(image: RefImage, x0: number, y0: number, x1: number, y1: number, pixel?: (r: number, g: number, b: number) => boolean): number {
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x++) {
      const o = 4 * (y * image.width + x);
      const [r, g, b] = [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
      if (pixel ? pixel(r, g, b) : Math.max(Math.abs(r - CLEAR[0]!), Math.abs(g - CLEAR[1]!), Math.abs(b - CLEAR[2]!)) > 12) n++;
    }
  }
  return n;
}

/** the first and the last column that have ink in a rectangle (-1 when it has none) */
function inkColumns(image: RefImage, x0: number, y0: number, x1: number, y1: number): [number, number] {
  let first = -1;
  let last = -1;
  for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x++) {
    if (ink(image, x, y0, x + 1, y1) === 0) continue;
    if (first < 0) first = x;
    last = x;
  }
  return [first, last];
}

/**
 * What every draw of a font looks like at the device: a list of quads (two triangles each, `numPrimitives` even) from the buffer of the vertex
 * type 3 (XYZRHW, diffuse, one set of coordinates; z 0 and rhw 1, so that the z test, which is on in a world that draws no dialog, passes
 * against the cleared buffer), alpha blending on, no z write, the blend factors SRCALPHA / INVSRCALPHA, linear filters, and the baseline's
 * clockwise winding (culled counter-clockwise); the texture is a glyph page (the snapshot copied it).  The alpha test is the baseline's
 * (a world that draws no dialog has `CKTDGManager`'s, which is on): the font does not touch it, and the reference models it.
 */
function expectTextDraws(draws: Draw[]): void {
  expect(draws.length).toBeGreaterThan(0);
  for (const d of draws) {
    expect([d.type, d.primitive, d.numDraws, d.numPrimitives % 2, d.numPrimitives > 0]).toEqual([3, 4, 1, 0, true]);
    expect([d.blendEnable, d.zWrite, d.srcBlend, d.destBlend]).toEqual([1, 0, 5, 6]);
    expect([d.minFilter, d.magFilter, d.cullMode]).toEqual([2, 2, 3]);
    expect(d.texture).not.toBeNull();
    expect(d.image).toBeTruthy();
    expect(d.data.length).toBeGreaterThanOrEqual(d.numPrimitives * 3 * 28);
    const v = new Float32Array(d.data.buffer, d.data.byteOffset, d.numPrimitives * 3 * 7);
    let notFlat = 0;
    for (let k = 0; k < d.numPrimitives * 3; k++) if (v[7 * k + 2] !== 0 || v[7 * k + 3] !== 1) notFlat++;
    expect(notFlat).toBe(0);
  }
}

function expectSameAsDirect3D(name: string, scene: Scene<unknown>): void {
  expect(scene.referenceError).toBeUndefined(); // the CPU composition has a rule for every quad
  const d = compareImages(scene.image, scene.reference, TOLERANCE);
  expect(d.over, report(name, d)).toBe(0);
}

const suite = HAVE_GPU ? describe : describe.skip;

suite("text drawn through @els/d3d9 by the ported fonts", () => {
  const LATIN = "The quick brown fox jumps over 0123456789";
  const CHINESE = "艾爾之光：勇者們的冒險";
  const KOREAN = "엘소드: 용사들의 모험";

  test("the seven fonts of the client draw Latin, Chinese and Korean text where OutTextXY puts it, and the picture is Direct3D 9's", async () => {
    const w = await newWorld();
    try {
      const fonts = clientFonts(w);
      expect(fonts.map((f) => [f.m_pUKFont!.m_iFontSize, f.m_pUKFont!.m_iOutLineSize, f.m_pUKFont!.m_EnlargeNum])).toEqual([
        [13, 1, 1], [15, 1, 1], [17, 1, 1], [23, 1, 1], [33, 1, 1], [13, 0, 1], [17, 0, 1],
      ]);

      // three lines of each font, one under the other, each in a box of its own (the padding: what an outline and the bilinear edge may add)
      const colors = [WHITE, 0xffffe060, 0xff80ff80, 0xff80e0ff, 0xffff9060, 0xffff80c0, WHITE];
      const rows: { font: UKFont; text: string; color: number; x: number; y: number; width: number; cell: number; pad: number }[] = [];
      let y = 8;
      fonts.forEach((font, i) => {
        const ft = font.m_pUKFont!;
        const pad = ft.m_iOutLineSize + 2;
        for (const text of [LATIN, CHINESE, KOREAN]) {
          y += pad;
          rows.push({ font, text, color: colors[i]!, x: 14, y, width: font.GetWidth(text), cell: ft.m_iFontCacheSize, pad });
          y += ft.m_iFontCacheSize + pad + 2;
        }
      });

      const scene = await drawScene(w, () => {
        for (const r of rows) r.font.OutTextXY(r.x, r.y, r.text, r.color, FONT_STYLE.FS_SHELL, BLACK, null, 0, -1, 1, 1);
      }, { snapshot: pageSnapshot(w, true), savedAs: "ui-text-fonts" });

      expectTextDraws(scene.draws);
      expectSameAsDirect3D("text of the seven fonts", scene);

      // the text is where it is put: every line has its ink in its box, and there is none outside the boxes
      let inBoxes = 0;
      for (const r of rows) {
        const n = ink(scene.image, r.x - r.pad, r.y - r.pad, r.x + r.width + r.pad, r.y + r.cell + r.pad);
        const glyphs = [...r.text].filter((c) => c !== " ").length;
        expect(n, `${r.text} in font ${r.font.m_pUKFont!.m_iFontSize}`).toBeGreaterThan(glyphs * 4);
        inBoxes += n;
      }
      expect(ink(scene.image, 0, 0, scene.image.width, scene.image.height)).toBe(inBoxes);

      // an outline font draws its outline pass first, with the pages of the outline; the others have the main pass only
      const outlinePages = new Set<Direct3DTexture9>();
      for (const font of fonts) for (const p of font.m_pUKFont!.m_pTextureOutLine) if (p?.m_pTextureVid) outlinePages.add(p.m_pTextureVid);
      const passes = scene.draws.map((d) => outlinePages.has(d.texture!));
      expect(passes.includes(true)).toBe(true);
      expect(passes.includes(false)).toBe(true);
      expect(passes[0]).toBe(true);
    } finally {
      releaseDrawn({ w });
    }
  }, 120_000);

  test("lines of OutTextMultiline, the colour codes, a line centred and one right-aligned in a box, and a scaled one", async () => {
    const w = await newWorld();
    try {
      const fonts = clientFonts(w);
      const big = fonts[3]!; // 23 px with an outline
      const small = fonts[0]!; // 13 px with an outline
      const box = { left: 560, top: 20, right: 1000, bottom: 120 };
      const MULTI = "Elsword\nThe quick brown fox\n艾爾之光\n엘소드 한글";
      const CODES = "plain #cff4040red#cx plain #c40ff40green#cx plain";
      const CENTRED = "in the middle";
      const RIGHT = "at the right end";

      const scene = await drawScene(w, () => {
        big.OutTextMultiline(20, 20, MULTI, WHITE, FONT_STYLE.FS_SHELL, BLACK, 1.2, null, 0, -1, 1, 1);
        small.OutTextXY(20, 220, CODES, WHITE, FONT_STYLE.FS_SHELL, BLACK, null, 0, -1, 1, 1);
        big.OutTextXY(0, 60, CENTRED, 0xffffe060, FONT_STYLE.FS_SHELL, BLACK, box, 1, -1, 1, 1);
        big.OutTextXY(0, 90, RIGHT, 0xff80e0ff, FONT_STYLE.FS_SHELL, BLACK, box, 2, -1, 1, 1);
        small.OutTextXY(20, 300, "scaled 2 x 3", WHITE, FONT_STYLE.FS_SHELL, BLACK, null, 0, -1, 2, 3);
        small.OutTextMultiline(20, 420, "two\nlines\nscaled", WHITE, FONT_STYLE.FS_SHELL, BLACK, 1, null, 0, -1, 1.5, 1.5);
      }, { snapshot: pageSnapshot(w, true), savedAs: "ui-text-multiline" });

      expectTextDraws(scene.draws);
      expectSameAsDirect3D("multi-line text", scene);

      // the four lines of the multi-line text are one under the other
      const cell = big.m_pUKFont!.m_iFontCacheSize;
      for (let line = 0; line < 4; line++) {
        expect(ink(scene.image, 14, 20 + Math.floor(line * 1.2 * cell) - 2, 400, 20 + Math.floor(line * 1.2 * cell) + cell + 2), `line ${line}`).toBeGreaterThan(40);
      }
      // the colour codes colour their words and nothing else, and are not drawn
      const red = ink(scene.image, 14, 214, 600, 240, (r, g, b) => r > 200 && g < 140 && b < 140);
      const green = ink(scene.image, 14, 214, 600, 240, (r, g, b) => g > 200 && r < 140 && b < 140);
      const white = ink(scene.image, 14, 214, 600, 240, (r, g, b) => r > 220 && g > 220 && b > 220);
      expect([red > 20, green > 20, white > 40]).toEqual([true, true, true]);
      // a line centred in the box is as far from its left side as from its right, one that ends at the right of it touches it there
      const [cl, cr] = inkColumns(scene.image, box.left - 20, 60, box.right + 20, 60 + big.m_pUKFont!.m_iFontCacheSize);
      expect([cl >= box.left - 3, cr <= box.right + 3, Math.abs(cl - box.left - (box.right - cr)) <= 6]).toEqual([true, true, true]);
      const [rl, rr] = inkColumns(scene.image, box.left - 20, 90, box.right + 20, 90 + big.m_pUKFont!.m_iFontCacheSize);
      expect([rl > cl, Math.abs(rr - box.right) <= 6]).toEqual([true, true]);
    } finally {
      releaseDrawn({ w });
    }
  }, 120_000);

  test("a glyph cell that is given to another character in the middle of a scene: the draws before it still show the old glyph", async () => {
    const w = await newWorld();
    try {
      // 13 px, no outline: 15-pixel cells, 17 x 17 on each of four pages: 1156 cells, exactly what four pages hold
      const font = clientFonts(w)[5]!;
      const ft = font.m_pUKFont!;
      expect([ft.m_iFontSize, ft.m_iOutLineSize, ft.m_iTotalCache]).toEqual([13, 0, 1156]);
      // the stamp of a line is the clock when it is drawn: later lines are newer, whatever the speed of the test
      let now = 100_000;
      w.devices.massFiles.tickCount = () => (now += 1000);
      const line = (first: number, n: number): string => Array.from({ length: n }, (_, i) => String.fromCharCode(first + i)).join("");

      // 100 characters, then 1100 others: 1156 cells are all there are, so the 44 oldest (the first 44 of the 100) are taken over, by the
      // last 44 of the 1100, while the first line has been drawn already
      const A = [line(0x4e00, 50), line(0x4e32, 50)];
      const B = Array.from({ length: 22 }, (_, k) => line(0x5000 + 50 * k, 50));
      const scene = await drawScene(w, () => {
        A.forEach((text, k) => font.OutTextXY(2, 4 + 16 * k, text, WHITE, FONT_STYLE.FS_NONE, 0, null, 0, -1, 1, 1));
        B.forEach((text, k) => font.OutTextXY(2, 44 + 16 * k, text, 0xffffe060, FONT_STYLE.FS_NONE, 0, null, 0, -1, 1, 1));
      }, { snapshot: pageSnapshot(w, true), savedAs: "ui-text-evicted" });

      expect([ft.m_iSizeArray, ft.hashCell[0x4e00]!, ft.hashCell[0x4e00 + 43]!, ft.hashCell[0x4e00 + 44]! >= 0, ft.hashCell[0x5000 + 1099]! >= 0]).toEqual([1156, -1, -1, true, true]);
      expectTextDraws(scene.draws);
      expectSameAsDirect3D("cells taken over in the middle of a scene", scene);

      // the first draw of the scene (the first line, page 0) and the last one of that page have the first cell with different glyphs
      const page0 = scene.draws.filter((d) => d.image === scene.draws[0]!.image || d.texture === scene.draws[0]!.texture);
      expect(page0.length).toBeGreaterThan(2);
      const cell = ft.m_FontCacheArray![0]!;
      const region = (img: RefImage): number[] => {
        const out: number[] = [];
        for (let y = cell.iTop; y < cell.iTop + 15; y++) for (let x = cell.iLeft; x < cell.iLeft + 15; x++) out.push(img.rgba[4 * (y * img.width + x) + 3]!);
        return out;
      };
      expect(region(page0[0]!.image!)).not.toEqual(region(page0[page0.length - 1]!.image!));
      // the picture of the first line is drawn with the old cell: the 44 first glyphs of it are there, not those that took their cells
      expect(ink(scene.image, 2, 4, 2 + 50 * 13, 4 + 15)).toBeGreaterThan(50 * 10);
    } finally {
      releaseDrawn({ w });
    }
  }, 120_000);
});
