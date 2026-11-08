import { describe, expect, test } from "bun:test";
import { Bytes } from "../src/bytes.ts";
import { buildCmap, cmapFormatSupported, TT_CMAP_FLAG_UNSORTED } from "../src/cmap.ts";

/** big-endian words laid out by hand, the way a font file has them */
const u16 = (...v: number[]): number[] => v.flatMap((x) => [(x >> 8) & 255, x & 255]);
const u32 = (...v: number[]): number[] => v.flatMap((x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
const build = (bytes: number[]) => buildCmap(new Bytes(Uint8Array.from(bytes)), 0, bytes.length, 0);

describe("cmap format 4 (segment mapping to delta values)", () => {
  // three segments: 0x20..0x7E with delta -0x1F; 0x4E00..0x4E02 through glyphIdArray [100, 0, 102] with delta 5; the 0xFFFF terminator
  //  header (14 bytes) | endCode[3] | pad | startCode[3] | idDelta[3] | idRangeOffset[3] | glyphIdArray[3]   length = 14 + 6 + 2 + 6 + 6 + 6 + 6 = 46
  // idRangeOffset[1] sits at byte 36 and the glyph array at byte 40, so its offset is 4
  const table = [
    ...u16(4, 46, 0, 6, 4, 1, 2),
    ...u16(0x7e, 0x4e02, 0xffff),
    ...u16(0),
    ...u16(0x20, 0x4e00, 0xffff),
    ...u16(0xffe1, 5, 1),
    ...u16(0, 4, 0),
    ...u16(100, 0, 102),
  ];
  test("delta segments, glyph-array segments and the terminator", () => {
    const cm = build(table)!;
    expect(cm.format).toBe(4);
    expect(cm.flags).toBe(0);
    expect(cm.charIndex(0x20)).toBe(1); // 0x20 - 0x1F
    expect(cm.charIndex(0x41)).toBe(0x22);
    expect(cm.charIndex(0x7e)).toBe(0x5f);
    expect(cm.charIndex(0x1f)).toBe(0);
    expect(cm.charIndex(0x7f)).toBe(0); // between two segments
    expect(cm.charIndex(0x4e00)).toBe(105); // glyphIdArray[0] = 100, plus the delta
    expect(cm.charIndex(0x4e01)).toBe(0); // glyph 0 stays 0, the delta is not added
    expect(cm.charIndex(0x4e02)).toBe(107);
    expect(cm.charIndex(0x4e03)).toBe(0);
    expect(cm.charIndex(0xffff)).toBe(0); // 0xFFFF + 1 wraps to 0
    expect(cm.charIndex(0x10000)).toBe(0); // beyond 16 bits
  });
  test("segments out of order are searched one by one", () => {
    const unsorted = [...u16(4, 46, 0, 6, 4, 1, 2), ...u16(0x5f, 0x2f, 0xffff), ...u16(0), ...u16(0x50, 0x20, 0xffff), ...u16(0, 0, 1), ...u16(0, 0, 0), ...u16(0, 0, 0)];
    const cm = build(unsorted)!;
    expect(cm.flags & TT_CMAP_FLAG_UNSORTED).toBe(TT_CMAP_FLAG_UNSORTED);
    expect(cm.charIndex(0x25)).toBe(0x25);
    expect(cm.charIndex(0x55)).toBe(0x55);
    expect(cm.charIndex(0x30)).toBe(0);
    expect(cm.charIndex(0x60)).toBe(0);
  });
  test("out of order, with a glyph array: the first segment that holds the code answers, a 0 in the array stays 0", () => {
    // segments: 0x4E00..0x4E02 through glyphIdArray [100, 0, 102] with delta 5 (idRangeOffset[0] is at byte 34, the array at 40: offset 6), then 0x20..0x7E with
    // delta -0x1F; the second starts below the first, so the validator calls the table unsorted and the lookup walks the segments in order
    const unsorted = [
      ...u16(4, 46, 0, 6, 4, 1, 2),
      ...u16(0x4e02, 0x7e, 0xffff),
      ...u16(0),
      ...u16(0x4e00, 0x20, 0xffff),
      ...u16(5, 0xffe1, 1),
      ...u16(6, 0, 0),
      ...u16(100, 0, 102),
    ];
    const cm = build(unsorted)!;
    expect(cm.flags & TT_CMAP_FLAG_UNSORTED).toBe(TT_CMAP_FLAG_UNSORTED);
    expect(cm.charIndex(0x4e00)).toBe(105);
    expect(cm.charIndex(0x4e01)).toBe(0); // the array holds 0: no delta
    expect(cm.charIndex(0x4e02)).toBe(107);
    expect(cm.charIndex(0x4e03)).toBe(0);
    expect(cm.charIndex(0x20)).toBe(1);
    expect(cm.charIndex(0x41)).toBe(0x22);
    expect(cm.charIndex(0x7f)).toBe(0);
    expect(cm.charIndex(0xffff)).toBe(0);
  });
  test("a segment that ends before it starts is refused", () => {
    const bad = [...u16(4, 46, 0, 6, 4, 1, 2), ...u16(0x1f, 0x4e02, 0xffff), ...u16(0), ...u16(0x20, 0x4e00, 0xffff), ...u16(0xffe1, 5, 1), ...u16(0, 4, 0), ...u16(100, 0, 102)];
    expect(build(bad)).toBeNull();
  });
  test("a table shorter than its segments need is refused", () => {
    expect(build([...u16(4, 12, 0, 6, 4, 1, 2), 0, 0, 0, 0])).toBeNull();
  });
});

describe("cmap format 6 (trimmed table)", () => {
  const table = [...u16(6, 16, 0, 0x30, 3), ...u16(7, 8, 9)];
  test("codes inside the run map through the array, others to 0", () => {
    const cm = build(table)!;
    expect(cm.format).toBe(6);
    expect(cm.charIndex(0x2f)).toBe(0);
    expect(cm.charIndex(0x30)).toBe(7);
    expect(cm.charIndex(0x31)).toBe(8);
    expect(cm.charIndex(0x32)).toBe(9);
    expect(cm.charIndex(0x33)).toBe(0);
  });
  test("a count the length cannot hold is refused", () => {
    expect(build([...u16(6, 14, 0, 0x30, 3), ...u16(7, 8)])).toBeNull();
  });
});

describe("cmap format 12 (segmented coverage)", () => {
  // length = 16 + 12 * 2 groups = 40
  const table = [...u16(12, 0), ...u32(40, 0, 2), ...u32(0x20, 0x7e, 1), ...u32(0x1f600, 0x1f64f, 1000)];
  test("groups: a code maps to startGlyph + code - start", () => {
    const cm = build(table)!;
    expect(cm.format).toBe(12);
    expect(cm.charIndex(0x20)).toBe(1);
    expect(cm.charIndex(0x7e)).toBe(0x5f);
    expect(cm.charIndex(0x7f)).toBe(0);
    expect(cm.charIndex(0x1f)).toBe(0);
    expect(cm.charIndex(0x1f600)).toBe(1000);
    expect(cm.charIndex(0x1f64f)).toBe(1079);
    expect(cm.charIndex(0x1f650)).toBe(0);
    expect(cm.charIndex(0xffffffff)).toBe(0);
  });
  test("five groups: every group is found, whichever side of the middle it is on", () => {
    // length = 16 + 12 * 5 = 76
    const five = [
      ...u16(12, 0),
      ...u32(76, 0, 5),
      ...u32(0x20, 0x7e, 1),
      ...u32(0xa0, 0xff, 200),
      ...u32(0x4e00, 0x4e10, 500),
      ...u32(0x1f600, 0x1f64f, 1000),
      ...u32(0x20000, 0x2000f, 3000),
    ];
    const cm = build(five)!;
    const want: [number, number][] = [
      [0x20, 1], [0x50, 0x31], [0x7e, 0x5f],
      [0xa0, 200], [0xb0, 216], [0xff, 295],
      [0x4e00, 500], [0x4e08, 508], [0x4e10, 516],
      [0x1f600, 1000], [0x1f62a, 1042], [0x1f64f, 1079],
      [0x20000, 3000], [0x20007, 3007], [0x2000f, 3015],
    ];
    for (const [code, glyph] of want) expect(cm.charIndex(code)).toBe(glyph);
    for (const code of [0x1f, 0x7f, 0x9f, 0x100, 0x4dff, 0x4e11, 0x1f5ff, 0x1f650, 0x1ffff, 0x20010]) expect(cm.charIndex(code)).toBe(0);
  });
  test("overlapping or reversed groups are refused", () => {
    expect(build([...u16(12, 0), ...u32(40, 0, 2), ...u32(0x20, 0x7e, 1), ...u32(0x7e, 0x90, 1000)])).toBeNull();
    expect(build([...u16(12, 0), ...u32(28, 0, 1), ...u32(0x7e, 0x20, 1)])).toBeNull();
  });
});

describe("other formats", () => {
  test("only 4, 6 and 12 are built (the shipped fonts have no other)", () => {
    expect(cmapFormatSupported(4) && cmapFormatSupported(6) && cmapFormatSupported(12)).toBe(true);
    for (const f of [0, 2, 8, 10, 13, 14]) expect(cmapFormatSupported(f)).toBe(false);
    expect(build([...u16(0, 262, 0), ...new Array(256).fill(0)])).toBeNull();
  });
});
