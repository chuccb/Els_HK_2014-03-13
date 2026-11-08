import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FtFace, FT_SIZE_REQUEST_TYPE, requestSize, setCharSize } from "../src/index.ts";
import { divFix } from "../src/calc.ts";
import { fontBytes } from "./probe.ts";

/**
 * FT_Set_Char_Size / FT_Request_Size on a face whose units-per-em is a power of two (DFT_P7.TTC face 0: 1024), so every scale can be worked out by hand:
 * the 16.16 scale is divFix(pixels * 64, 1024) = pixels * 64 * 64, and the ppem is the scale times 1024 rounded to whole pixels.  What the exe's own
 * FreeType makes of the sizes it asks for (13, 15, 17 and more) is in oracle.test.ts.
 */
let face: FtFace;
beforeAll(async () => {
  face = FtFace.open(await fontBytes(join(import.meta.dir, "../../../data"), "dft_p7.ttc"), 0);
});

const ppems = (): number[] => [face.size.metrics.xPpem, face.size.metrics.yPpem];
const scales = (): number[] => [face.size.metrics.xScale, face.size.metrics.yScale];

describe("FT_Set_Char_Size", () => {
  test("the face under test has 1024 units per em", () => {
    expect(face.unitsPerEM).toBe(1024);
  });

  test("16 pixels at 72 dpi: ppem 16, scale 1.0 (a font unit is 1/64 pixel)", () => {
    expect(setCharSize(face, 16 << 6, 0, 72, 72)).toBe(0);
    expect(ppems()).toEqual([16, 16]);
    expect(scales()).toEqual([0x10000, 0x10000]);
    expect(face.size.ttmetrics.ppem).toBe(16);
    expect(face.size.ttmetrics.scale).toBe(0x10000);
  });

  test("a height of 0 takes the width, a resolution of 0 takes the other one, both 0 mean 72", () => {
    setCharSize(face, 16 << 6, 0, 0, 0);
    expect(ppems()).toEqual([16, 16]);
    setCharSize(face, 0, 16 << 6, 72, 0);
    expect(ppems()).toEqual([16, 16]);
    setCharSize(face, 8 << 6, 0, 144, 0); // 8 points at 144 dpi are 16 pixels
    expect(ppems()).toEqual([16, 16]);
  });

  test("less than one pixel is one pixel", () => {
    setCharSize(face, 10, 0, 72, 72);
    expect(ppems()).toEqual([1, 1]);
    expect(scales()).toEqual([0x1000, 0x1000]); // divFix(64, 1024) = 1/16
  });

  test("the ppem is rounded, not truncated: 16.5 pixels are 17", () => {
    setCharSize(face, (16 << 6) + 32, 0, 72, 72);
    expect(ppems()).toEqual([17, 17]);
    expect(scales()).toEqual([67584, 67584]); // 1056 / 1024 = 1.03125
  });

  test("the pixel size of a point size is rounded to the nearest: (width * dpi + 36) / 72", () => {
    // 65 * 36 = 2340 = 32 * 72 + 36: exactly half, rounds up to 33 pixels in 26.6 (not down to 32)
    expect(requestSize(face, { type: FT_SIZE_REQUEST_TYPE.NOMINAL, width: 65, height: 65, horiResolution: 36, vertResolution: 36 })).toBe(0);
    expect(scales()).toEqual([divFix(33, 1024), divFix(33, 1024)]);
    expect(scales()[0]).toBe(2112);
  });

  test("different width and height: the scales and ppems differ, the larger ppem is the reference of the TrueType size", () => {
    expect(requestSize(face, { type: FT_SIZE_REQUEST_TYPE.NOMINAL, width: 16 << 6, height: 20 << 6, horiResolution: 72, vertResolution: 72 })).toBe(0);
    expect(ppems()).toEqual([16, 20]);
    expect(scales()).toEqual([0x10000, 0x14000]);
    let t = face.size.ttmetrics;
    expect([t.ppem, t.scale, t.xRatio, t.yRatio]).toEqual([20, 0x14000, 0xcccd, 0x10000]); // divFix(16, 20) = (16 * 65536 + 10) / 20 = 52429
    requestSize(face, { type: FT_SIZE_REQUEST_TYPE.NOMINAL, width: 20 << 6, height: 16 << 6, horiResolution: 72, vertResolution: 72 });
    t = face.size.ttmetrics;
    expect([t.ppem, t.scale, t.xRatio, t.yRatio]).toEqual([20, 0x14000, 0x10000, 0xcccd]);
    requestSize(face, { type: FT_SIZE_REQUEST_TYPE.NOMINAL, width: 16 << 6, height: 16 << 6, horiResolution: 72, vertResolution: 72 });
    t = face.size.ttmetrics;
    expect([t.ppem, t.xRatio, t.yRatio]).toEqual([16, 0x10000, 0x10000]);
  });

  test("a negative size or an unknown request type is refused", () => {
    expect(requestSize(face, { type: FT_SIZE_REQUEST_TYPE.NOMINAL, width: -64, height: 64, horiResolution: 72, vertResolution: 72 })).not.toBe(0);
    expect(requestSize(face, { type: FT_SIZE_REQUEST_TYPE.MAX, width: 64, height: 64, horiResolution: 72, vertResolution: 72 })).not.toBe(0);
  });

  test("a fractional size keeps its fraction in the scale; each metric rounds its own way", () => {
    // 16.25 px: scale divFix(1040, 1024) = 66560.  ascender 820 -> mulFix 833 (832.8) -> ceiled 896; descender -204 -> -207 (-207.2) -> floored -256;
    // height 1024 -> 1040 -> rounded 1024 (a ceiling would say 1088); max advance 1024 -> 1040 -> 1024
    setCharSize(face, (16 << 6) + 16, 0, 72, 72);
    expect(scales()).toEqual([66560, 66560]);
    expect(ppems()).toEqual([16, 16]);
    let m = face.size.metrics;
    expect([m.ascender, m.descender, m.height, m.maxAdvance]).toEqual([896, -256, 1024, 1024]);
    // 16.75 px: scale 68608.  ascender 858 -> 896; descender -214 -> -256; height 1072 -> rounded 1088 (a floor would say 1024); max advance 1072 -> 1088
    setCharSize(face, (16 << 6) + 48, 0, 72, 72);
    expect(scales()).toEqual([68608, 68608]);
    expect(ppems()).toEqual([17, 17]);
    m = face.size.metrics;
    expect([m.ascender, m.descender, m.height, m.maxAdvance]).toEqual([896, -256, 1088, 1088]);
  });

  test("the metrics follow the scale: ascender ceiled, descender floored, height and max advance rounded, all to whole pixels", () => {
    setCharSize(face, 16 << 6, 0, 72, 72); // scale 1.0: the font's values are 26.6 numbers already
    const m = face.size.metrics;
    expect(m.ascender).toBe((face.ascender + 63) & ~63);
    expect(m.descender).toBe(face.descender & ~63);
    expect(m.height).toBe((face.height + 32) & ~63);
    expect(m.maxAdvance).toBe((face.maxAdvanceWidth + 32) & ~63);
  });
});

/**
 * GULIM.TTC is scalable and also has bitmap strikes 11 x 11 .. 25 x 25 (EBLC / EBDT).  FT_Set_Char_Size selects the strike when the rounded width AND height
 * of the request are those of a strike (FT_Match_Size); the metrics then follow the strike, not the request.  The exe asks for whole pixel sizes, so only
 * `strikeIndex` tells the two ways apart for them; a size between two strikes shows in the scale too.
 */
describe("bitmap strikes (GULIM.TTC)", () => {
  let gulim: FtFace;
  beforeAll(async () => {
    gulim = FtFace.open(await fontBytes(join(import.meta.dir, "../../../data"), "kom:datai022.kom:gulim.ttc"), 0);
  });
  const NONE = 0xffffffff;
  const req = (w: number, h: number) => ({ type: FT_SIZE_REQUEST_TYPE.NOMINAL, width: w << 6, height: h << 6, horiResolution: 72, vertResolution: 72 });

  test("the face has the strikes 11 .. 25 pixels", () => {
    expect(gulim.unitsPerEM).toBe(1024);
    expect(gulim.availableSizes.map((s) => [s.xPpem >> 6, s.yPpem >> 6])).toEqual(Array.from({ length: 15 }, (_, i) => [11 + i, 11 + i]));
  });

  test("a whole pixel size 11 .. 25 selects its strike, every other size none", () => {
    for (let px = 8; px <= 48; px++) {
      expect(setCharSize(gulim, px << 6, 0, 72, 72)).toBe(0);
      expect(gulim.size.strikeIndex).toBe(px >= 11 && px <= 25 ? px - 11 : NONE);
      expect([gulim.size.metrics.xPpem, gulim.size.metrics.yPpem]).toEqual([px, px]);
    }
  });

  test("a size is matched after rounding to whole pixels, and the metrics are those of the strike: 13.25 px is the 13 px strike, with the scale of 13 px", () => {
    expect(setCharSize(gulim, (13 << 6) + 16, 0, 72, 72)).toBe(0);
    expect(gulim.size.strikeIndex).toBe(2);
    expect(gulim.size.metrics.xScale).toBe(53248); // divFix(13 * 64, 1024), not divFix(848, 1024) = 54272
    // 13.75 px rounds to 14: the 14 px strike
    expect(setCharSize(gulim, (13 << 6) + 48, 0, 72, 72)).toBe(0);
    expect(gulim.size.strikeIndex).toBe(3);
    expect(gulim.size.metrics.xScale).toBe(57344); // divFix(14 * 64, 1024)
    // 10.75 px rounds to 11: the first strike; 25.25 px is the last
    setCharSize(gulim, (10 << 6) + 48, 0, 72, 72);
    expect(gulim.size.strikeIndex).toBe(0);
    setCharSize(gulim, (25 << 6) + 16, 0, 72, 72);
    expect(gulim.size.strikeIndex).toBe(14);
  });

  test("the width and the height must both match: a strike is only chosen for a request of its own shape", () => {
    expect(requestSize(gulim, req(12, 12))).toBe(0);
    expect(gulim.size.strikeIndex).toBe(1);
    // no strike is 12 wide and 20 high, or 20 wide and 12 high: the request is scaled instead and its two ppems stay different
    expect(requestSize(gulim, req(12, 20))).toBe(0);
    expect(gulim.size.strikeIndex).toBe(NONE);
    expect([gulim.size.metrics.xPpem, gulim.size.metrics.yPpem]).toEqual([12, 20]);
    expect(requestSize(gulim, req(20, 12))).toBe(0);
    expect(gulim.size.strikeIndex).toBe(NONE);
    expect([gulim.size.metrics.xPpem, gulim.size.metrics.yPpem]).toEqual([20, 12]);
    expect(requestSize(gulim, req(13, 14))).toBe(0);
    expect(gulim.size.strikeIndex).toBe(NONE);
  });
});
