import { describe, expect, test } from "bun:test";
import { Bitmap, FT_GLYPH_FORMAT, FT_PIXEL_MODE, FtErr, GlyphSlot, bitmapCopy, bitmapEmbolden, renderGlyph } from "../src/index.ts";
import type { FtFace } from "../src/index.ts";

/**
 * The smooth rasterizer (FT_Render_Glyph -> ft_smooth_render_generic -> gray_convert_glyph) and the bitmap helpers on shapes whose coverage can be worked
 * out on paper: a pixel's value is 256 * (covered fraction), clamped to 255 (ftgrays.c: area >> 9 of an area that is 2 * 256 * 256 for a whole pixel).
 * Outlines are in 26.6 (64 units = 1 pixel), y up.  Real glyphs against the exe's own renderer are in oracle.test.ts.
 */
function slotOf(points: number[][], tags: number[], contours: number[], flags = 0): GlyphSlot {
  const slot = new GlyphSlot(null as unknown as FtFace);
  const o = slot.outline;
  o.nContours = contours.length;
  o.nPoints = points.length;
  o.points = Int32Array.from(points.flat());
  o.tags = Uint8Array.from(tags);
  o.contours = Uint16Array.from(contours);
  o.flags = flags;
  slot.format = FT_GLYPH_FORMAT.OUTLINE;
  return slot;
}

/** the bitmap's rows, top row first */
function rowsOf(b: Bitmap): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < b.rows; r++) out.push(Array.from(b.buffer!.subarray(r * b.pitch, r * b.pitch + b.width)));
  return out;
}

const rect = (x0: number, y0: number, x1: number, y1: number): number[][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ON = 1;

describe("FT_Render_Glyph with the smooth renderer", () => {
  test("a 10 x 10 pixel square is fully covered", () => {
    const s = slotOf(rect(0, 0, 640, 640), [ON, ON, ON, ON], [3]);
    expect(renderGlyph(s, 0)).toBe(0);
    expect(s.format).toBe(FT_GLYPH_FORMAT.BITMAP);
    const b = s.bitmap;
    expect([b.rows, b.width, b.pitch, b.pixelMode, b.numGrays]).toEqual([10, 10, 10, FT_PIXEL_MODE.GRAY, 256]);
    expect([s.bitmapLeft, s.bitmapTop]).toEqual([0, 10]);
    expect(rowsOf(b).every((r) => r.every((v) => v === 255))).toBe(true);
  });

  test("the winding direction does not matter for one contour", () => {
    const s = slotOf([...rect(0, 0, 640, 640)].reverse(), [ON, ON, ON, ON], [3]);
    expect(renderGlyph(s, 0)).toBe(0);
    expect(rowsOf(s.bitmap).every((r) => r.every((v) => v === 255))).toBe(true);
  });

  test("a diagonal edge covers half of each pixel it crosses", () => {
    const s = slotOf([[0, 0], [640, 0], [640, 640]], [ON, ON, ON], [2]);
    expect(renderGlyph(s, 0)).toBe(0);
    // the triangle is y <= x; bitmap row r (0 = top) is y in [9 - r, 10 - r)
    const want = Array.from({ length: 10 }, (_, r) => Array.from({ length: 10 }, (_, c) => (c > 9 - r ? 255 : c === 9 - r ? 128 : 0)));
    expect(rowsOf(s.bitmap)).toEqual(want);
  });

  test("a rectangle with fractional edges: coverage is the product of the horizontal and the vertical fraction; left and top follow the floored cbox", () => {
    // x -1.5 .. 2.5 px, y -0.5 .. 1.5 px: the cbox grows to x -2 .. 3, y -1 .. 2 -> 5 x 3 pixels, left -2, top 2
    const s = slotOf(rect(-96, -32, 160, 96), [ON, ON, ON, ON], [3]);
    expect(renderGlyph(s, 0)).toBe(0);
    expect([s.bitmapLeft, s.bitmapTop, s.bitmap.width, s.bitmap.rows]).toEqual([-2, 2, 5, 3]);
    expect(rowsOf(s.bitmap)).toEqual([
      [64, 128, 128, 128, 64], // y 1 .. 1.5: half a pixel high
      [128, 255, 255, 255, 128],
      [64, 128, 128, 128, 64], // y -1 .. -0.5 is empty, -0.5 .. 0 is half
    ]);
  });

  test("a quarter-pixel rule and a half-pixel sliver", () => {
    const rule = slotOf(rect(0, 0, 640, 16), [ON, ON, ON, ON], [3]);
    renderGlyph(rule, 0);
    expect(rowsOf(rule.bitmap)).toEqual([new Array(10).fill(64)]);
    const sliver = slotOf(rect(0, 0, 32, 192), [ON, ON, ON, ON], [3]);
    renderGlyph(sliver, 0);
    expect(rowsOf(sliver.bitmap)).toEqual([[128], [128], [128]]);
  });

  test("a straight conic and a straight cubic make the same square", () => {
    const conic = slotOf([[0, 0], [320, 0], [640, 0], [640, 640], [0, 640]], [ON, 0, ON, ON, ON], [4]);
    expect(renderGlyph(conic, 0)).toBe(0);
    const cubic = slotOf([[0, 0], [213, 0], [427, 0], [640, 0], [640, 640], [0, 640]], [ON, 2, 2, ON, ON, ON], [5]);
    expect(renderGlyph(cubic, 0)).toBe(0);
    for (const s of [conic, cubic]) {
      expect([s.bitmap.rows, s.bitmap.width, s.bitmapTop]).toEqual([10, 10, 10]);
      expect(rowsOf(s.bitmap).every((r) => r.every((v) => v === 255))).toBe(true);
    }
  });

  describe("two contours: the fill rule", () => {
    const inner = (reverse: boolean) => (reverse ? [[128, 128], [128, 512], [512, 512], [512, 128]] : rect(128, 128, 512, 512));
    const ring = (flags: number, reverse: boolean) => {
      const s = slotOf([...rect(0, 0, 640, 640), ...inner(reverse)], new Array(8).fill(ON), [3, 7], flags);
      expect(renderGlyph(s, 0)).toBe(0);
      return rowsOf(s.bitmap);
    };
    const withHole = Array.from({ length: 10 }, (_, r) => Array.from({ length: 10 }, (_, c) => (r >= 2 && r < 8 && c >= 2 && c < 8 ? 0 : 255)));
    const solid = Array.from({ length: 10 }, () => new Array(10).fill(255));
    test("same direction: non-zero winding fills the inside (winding 2 clamps to 255), even-odd leaves a hole", () => {
      expect(ring(0, false)).toEqual(solid);
      expect(ring(2, false)).toEqual(withHole); // FT_OUTLINE_EVEN_ODD_FILL
    });
    test("opposite direction: a hole under either rule", () => {
      expect(ring(0, true)).toEqual(withHole);
      expect(ring(2, true)).toEqual(withHole);
    });
  });

  test("an empty outline renders to an empty bitmap", () => {
    const s = slotOf([], [], []);
    expect(renderGlyph(s, 0)).toBe(0);
    expect(s.format).toBe(FT_GLYPH_FORMAT.BITMAP);
    expect([s.bitmap.rows, s.bitmap.width, s.bitmapLeft, s.bitmapTop]).toEqual([0, 0, 0, 0]);
    expect(s.bitmap.buffer).toBeNull();
  });

  test("a bitmap that is already a bitmap is left alone; mono / LCD modes are not ported and say so", () => {
    const s = slotOf(rect(0, 0, 640, 640), [ON, ON, ON, ON], [3]);
    expect(() => renderGlyph(s, 2)).toThrow(/not ported/);
    expect(renderGlyph(s, 0)).toBe(0);
    const before = rowsOf(s.bitmap);
    expect(renderGlyph(s, 2)).toBe(0); // FT_GLYPH_FORMAT_BITMAP returns at once, whatever the mode
    expect(rowsOf(s.bitmap)).toEqual(before);
  });

  test("an outline wider than 0x7FFF pixels is refused with Raster_Overflow", () => {
    const s = slotOf(rect(0, 0, 0x8000 * 64, 64), [ON, ON, ON, ON], [3]);
    expect(renderGlyph(s, 0)).toBe(FtErr.Raster_Overflow);
    expect(FtErr.Raster_Overflow).toBe(0x62);
  });

  test("an outline the decomposer rejects comes back as error 1; a contour table that stops short as Invalid_Outline", () => {
    expect(renderGlyph(slotOf(rect(0, 0, 640, 640), [2, ON, ON, ON], [3]), 0)).toBe(1); // the first point is a cubic control point
    expect(renderGlyph(slotOf(rect(0, 0, 640, 640), [ON, ON, ON, ON], [2]), 0)).toBe(FtErr.Invalid_Outline);
  });
});

describe("FT_Bitmap_Copy and FT_Bitmap_Embolden", () => {
  const gray = (rows: number, width: number, pixels: number[], pitch = width): Bitmap => {
    const b = new Bitmap();
    b.rows = rows;
    b.width = width;
    b.pitch = pitch;
    b.pixelMode = FT_PIXEL_MODE.GRAY;
    b.numGrays = 256;
    b.buffer = Uint8Array.from(pixels);
    return b;
  };
  const hex = (b: Bitmap): string => Buffer.from(b.buffer!.subarray(0, b.rows * b.pitch)).toString("hex");

  test("a copy has its own buffer", () => {
    const src = gray(2, 3, [1, 2, 3, 4, 5, 6]);
    const dst = new Bitmap();
    expect(bitmapCopy(src, dst)).toBe(0);
    expect([dst.rows, dst.width, dst.pitch, dst.pixelMode, dst.numGrays]).toEqual([2, 3, 3, FT_PIXEL_MODE.GRAY, 256]);
    expect(hex(dst)).toBe("010203040506");
    src.buffer![0] = 99;
    expect(dst.buffer![0]).toBe(1);
    expect(bitmapCopy(src, src)).toBe(0); // a bitmap onto itself is a no-op
  });

  test("a bitmap without a buffer copies to one without a buffer", () => {
    const src = gray(0, 0, []);
    src.buffer = null;
    const dst = new Bitmap();
    expect(bitmapCopy(src, dst)).toBe(0);
    expect(dst.buffer).toBeNull();
  });

  test("horizontally: each pixel gets the pixel before it added, from the right; the bitmap grows to the right", () => {
    // [100, 0] with one pixel of strength: width 3.  From the last pixel on: p2 += p1 (0 + 0), p1 += p0 (0 + 100); p0 has no pixel before it
    const a = gray(1, 2, [100, 0]);
    expect(bitmapEmbolden(a, 64, 0)).toBe(0);
    expect([a.rows, a.width, a.pitch, hex(a)]).toEqual([1, 3, 3, "646400"]);
    const b = gray(1, 2, [0, 100]);
    bitmapEmbolden(b, 64, 0);
    expect(hex(b)).toBe("006464");
    // the sum saturates at num_grays - 1: p2 = 0 + 100, p1 = 100 + 200 -> 255
    const c = gray(1, 2, [200, 100]);
    bitmapEmbolden(c, 64, 0);
    expect(hex(c)).toBe("c8ff64");
  });

  test("vertically: the rows above are or'ed with the row; the bitmap grows upwards", () => {
    const a = gray(1, 1, [50]);
    expect(bitmapEmbolden(a, 0, 64)).toBe(0);
    expect([a.rows, a.width, a.pitch, hex(a)]).toEqual([2, 1, 1, "3232"]);
    // two rows [0x0f], [0xf0] with one pixel of strength: the buffer has a new empty row on top, the loop starts at the first old row and goes down:
    // the first old row is or'ed into the new top row (0x0f), then the second old row into the first one (0x0f | 0xf0 = 0xff)
    const b = gray(2, 1, [0x0f, 0xf0]);
    bitmapEmbolden(b, 0, 64);
    expect(b.rows).toBe(3);
    expect(hex(b)).toBe("0f" + "ff" + "f0");
  });

  test("both ways: a single pixel becomes a 2 x 2 block", () => {
    const a = gray(1, 1, [50]);
    expect(bitmapEmbolden(a, 64, 64)).toBe(0);
    expect([a.rows, a.width, a.pitch, hex(a)]).toEqual([2, 2, 2, "32323232"]);
  });

  test("the strength is rounded to whole pixels: (x + 32) >> 6", () => {
    const a = gray(1, 2, [100, 0]);
    bitmapEmbolden(a, 31, 31); // rounds to 0 pixels: nothing happens
    expect([a.width, a.rows, hex(a)]).toEqual([2, 1, "6400"]);
    const b = gray(1, 2, [100, 0]);
    bitmapEmbolden(b, 32, 0); // rounds to 1
    expect([b.width, hex(b)]).toEqual([3, "646400"]);
    const c = gray(1, 3, [10, 0, 0]);
    bitmapEmbolden(c, 128 + 31, 0); // 2.48 pixels -> 2
    expect([c.width, hex(c)]).toEqual([5, "0a0a0a0000"]);
  });

  test("a mono bitmap is emboldened bit by bit", () => {
    const b = new Bitmap();
    b.rows = 1;
    b.width = 3;
    b.pitch = 1;
    b.pixelMode = FT_PIXEL_MODE.MONO;
    b.numGrays = 2;
    b.buffer = Uint8Array.of(0xa0); // 1 0 1
    expect(bitmapEmbolden(b, 64, 0)).toBe(0);
    expect([b.width, hex(b)]).toEqual([4, "f0"]); // 1 1 1 1: p |= p >> 1
  });

  test("errors: no buffer, a negative strength", () => {
    const empty = gray(0, 0, []);
    empty.buffer = null;
    expect(bitmapEmbolden(empty, 64, 64)).toBe(FtErr.Invalid_Argument);
    expect(bitmapEmbolden(gray(1, 1, [1]), -64, 64)).toBe(FtErr.Invalid_Argument);
    expect(bitmapEmbolden(gray(1, 1, [1]), 64, -64)).toBe(FtErr.Invalid_Argument);
  });
});
