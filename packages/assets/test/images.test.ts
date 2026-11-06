import { describe, expect, test } from "bun:test";
import { zlibSync } from "fflate";
import { decodeBc1, decodeBc3, decodeBmp, decodeDds, decodeImage, decodePng, decodeTga, ImageFormatError, sniffImage } from "../src/index.ts";

const u8 = (...v: number[]): Uint8Array => Uint8Array.from(v);
const px = (img: { rgba: Uint8Array; width: number }, x: number, y: number): number[] => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

function tgaHeader(type: number, w: number, h: number, bpp: number, desc: number, extra: { idLen?: number; cmapType?: number; cmapLen?: number; cmapBits?: number } = {}): number[] {
  return [extra.idLen ?? 0, extra.cmapType ?? 0, type, 0, 0, (extra.cmapLen ?? 0) & 255, (extra.cmapLen ?? 0) >> 8, extra.cmapBits ?? 0, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, bpp, desc];
}

describe("TGA", () => {
  test("24 bpp bottom-left origin: BGR order, rows flipped, opaque", () => {
    // file order: bottom row first. bottom row: (1,2,3) (4,5,6) as RGB; top row: (7,8,9) (10,11,12)
    const file = u8(...tgaHeader(2, 2, 2, 24, 0), 3, 2, 1, 6, 5, 4, 9, 8, 7, 12, 11, 10);
    const img = decodeTga(file);
    expect(img.format).toBe("X8R8G8B8");
    expect(img.hasAlpha).toBe(false);
    expect(px(img, 0, 0)).toEqual([7, 8, 9, 255]);
    expect(px(img, 1, 0)).toEqual([10, 11, 12, 255]);
    expect(px(img, 0, 1)).toEqual([1, 2, 3, 255]);
    expect(px(img, 1, 1)).toEqual([4, 5, 6, 255]);
  });

  test("32 bpp top-left origin keeps alpha even when the descriptor declares no alpha bits", () => {
    const file = u8(...tgaHeader(2, 2, 1, 32, 0x20), 3, 2, 1, 128, 6, 5, 4, 0);
    const img = decodeTga(file);
    expect(img.format).toBe("A8R8G8B8");
    expect(px(img, 0, 0)).toEqual([1, 2, 3, 128]);
    expect(px(img, 1, 0)).toEqual([4, 5, 6, 0]);
  });

  test("RLE: run packets and raw packets, runs may cross rows", () => {
    // 3x2 true colour 24 bpp RLE, top-left origin: run of 4 red pixels, raw packet of 2 pixels (green, blue)
    const file = u8(...tgaHeader(10, 3, 2, 24, 0x20), 0x83, 0, 0, 255, 0x01, 0, 255, 0, 255, 0, 0);
    const img = decodeTga(file);
    expect(px(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 0, 1)).toEqual([255, 0, 0, 255]);
    expect(px(img, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(px(img, 2, 1)).toEqual([0, 0, 255, 255]);
  });

  test("colour-mapped 8 bpp with a 24-bit palette", () => {
    const file = u8(...tgaHeader(1, 2, 1, 8, 0x20, { cmapType: 1, cmapLen: 2, cmapBits: 24 }), 10, 20, 30, 40, 50, 60, 1, 0);
    const img = decodeTga(file);
    expect(img.format).toBe("P8");
    expect(px(img, 0, 0)).toEqual([60, 50, 40, 255]);
    expect(px(img, 1, 0)).toEqual([30, 20, 10, 255]);
  });

  test("16 bpp with one alpha bit: A1R5G5B5, bit replication", () => {
    // 0xFC00 = A1 R31 G0 B0 ; 0x03E0 = A0 R0 G31 B0
    const file = u8(...tgaHeader(2, 2, 1, 16, 0x21), 0x00, 0xfc, 0xe0, 0x03);
    const img = decodeTga(file);
    expect(img.format).toBe("A1R5G5B5");
    expect(px(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 1, 0)).toEqual([0, 255, 0, 0]);
  });

  test("truncated data and unsupported types are errors", () => {
    expect(() => decodeTga(u8(...tgaHeader(2, 2, 2, 24, 0), 1, 2, 3))).toThrow(ImageFormatError);
    expect(() => decodeTga(u8(...tgaHeader(70, 2, 2, 24, 0), 1, 2, 3))).toThrow(ImageFormatError);
  });
});

function ddsHeader(w: number, h: number, pf: { flags: number; fourCC?: string; bits?: number; masks?: number[] }): number[] {
  const b = new Uint8Array(128);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x20534444, true); dv.setUint32(4, 124, true); dv.setUint32(8, 0x1007, true);
  dv.setUint32(12, h, true); dv.setUint32(16, w, true); dv.setUint32(76, 32, true); dv.setUint32(80, pf.flags, true);
  if (pf.fourCC) for (let i = 0; i < 4; i++) b[84 + i] = pf.fourCC.charCodeAt(i);
  dv.setUint32(88, pf.bits ?? 0, true);
  (pf.masks ?? [0, 0, 0, 0]).forEach((m, i) => dv.setUint32(92 + 4 * i, m, true));
  dv.setUint32(108, 0x1000, true);
  return [...b];
}

describe("DDS", () => {
  test("DXT1 four-colour block", () => {
    // c0 = red (F800), c1 = blue (001F), indices: px0..3 = 0,1,2,3, everything else 0
    const file = u8(...ddsHeader(4, 4, { flags: 4, fourCC: "DXT1" }), 0x00, 0xf8, 0x1f, 0x00, 0xe4, 0, 0, 0);
    const img = decodeDds(file);
    expect(img.format).toBe("DXT1");
    expect(px(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(px(img, 2, 0)).toEqual([170, 0, 85, 255]);
    expect(px(img, 3, 0)).toEqual([85, 0, 170, 255]);
    expect(px(img, 0, 3)).toEqual([255, 0, 0, 255]);
  });

  test("DXT1 three-colour block with transparent index 3", () => {
    const file = u8(...ddsHeader(4, 4, { flags: 4, fourCC: "DXT1" }), 0x1f, 0x00, 0x00, 0xf8, 0xe4, 0, 0, 0);
    const img = decodeDds(file);
    expect(px(img, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(px(img, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 2, 0)).toEqual([127, 0, 127, 255]);
    expect(px(img, 3, 0)).toEqual([0, 0, 0, 0]);
  });

  test("DXT3 explicit 4-bit alpha, DXT3/5 colour blocks are always four-colour", () => {
    // alpha rows: first row nibbles 0,5,10,15; colours c0 = 0x0000 (black) c1 = 0xFFFF (white): c0 <= c1 but still 4 colours
    const alpha = [0x50, 0xfa, 0, 0, 0, 0, 0, 0]; // px0 = 0 (low nibble), px1 = 5, px2 = 10 (0xa), px3 = 15 (0xf)
    const file = u8(...ddsHeader(4, 4, { flags: 4, fourCC: "DXT3" }), ...alpha, 0x00, 0x00, 0xff, 0xff, 0xe4, 0, 0, 0);
    const img = decodeDds(file);
    expect([0, 1, 2, 3].map((x) => px(img, x, 0)[3])).toEqual([0, 85, 170, 255]);
    expect(px(img, 2, 0).slice(0, 3)).toEqual([85, 85, 85]); // 2/3 * 0 + 1/3 * 255
    expect(px(img, 3, 0).slice(0, 3)).toEqual([170, 170, 170]);
  });

  test("BC3 alpha ramps: 8-value mode and 6-value mode with 0 and 255", () => {
    const mk = (a0: number, a1: number, idx: number[]): Uint8Array => {
      const blk = new Uint8Array(16);
      blk[0] = a0; blk[1] = a1;
      let bits = 0n;
      idx.forEach((v, i) => { bits |= BigInt(v) << BigInt(3 * i); });
      for (let i = 0; i < 6; i++) blk[2 + i] = Number((bits >> BigInt(8 * i)) & 0xffn);
      return blk;
    };
    const eight = decodeBc3(mk(255, 0, [0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0]), 4, 4);
    expect([0, 1, 2, 3].map((x) => eight[x * 4 + 3])).toEqual([255, 0, 218, 182]);
    expect([0, 1, 2, 3].map((x) => eight[(4 + x) * 4 + 3])).toEqual([145, 109, 72, 36]);
    const six = decodeBc3(mk(10, 210, [0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0]), 4, 4);
    expect([0, 1, 2, 3].map((x) => six[x * 4 + 3])).toEqual([10, 210, 50, 90]);
    expect([0, 1, 2, 3].map((x) => six[(4 + x) * 4 + 3])).toEqual([130, 170, 0, 255]);
  });

  test("sizes that are not a multiple of four are cropped from the blocks", () => {
    const blocks = new Uint8Array(16); // 2 blocks of DXT1 for a 5x2 image: all index 0 = c0 = pure green
    blocks.set([0xe0, 0x07, 0x00, 0x00, 0, 0, 0, 0, 0xe0, 0x07, 0x00, 0x00, 0, 0, 0, 0]);
    const rgba = decodeBc1(blocks, 5, 2);
    expect(rgba.length).toBe(5 * 2 * 4);
    expect([...rgba.subarray(16, 20)]).toEqual([0, 255, 0, 255]);
  });

  test("uncompressed masks: R8G8B8, A8R8G8B8, A4R4G4B4, X8R8G8B8", () => {
    const rgb = decodeDds(u8(...ddsHeader(1, 1, { flags: 0x40, bits: 24, masks: [0xff0000, 0xff00, 0xff, 0] }), 3, 2, 1));
    expect(rgb.format).toBe("R8G8B8");
    expect(px(rgb, 0, 0)).toEqual([1, 2, 3, 255]);
    const argb = decodeDds(u8(...ddsHeader(1, 1, { flags: 0x41, bits: 32, masks: [0xff0000, 0xff00, 0xff, 0xff000000] }), 3, 2, 1, 77));
    expect(argb.format).toBe("A8R8G8B8");
    expect(px(argb, 0, 0)).toEqual([1, 2, 3, 77]);
    const a4 = decodeDds(u8(...ddsHeader(1, 1, { flags: 0x41, bits: 16, masks: [0x0f00, 0x00f0, 0x000f, 0xf000] }), 0x21, 0x83));
    expect(a4.format).toBe("A4R4G4B4");
    expect(px(a4, 0, 0)).toEqual([0x33, 0x22, 0x11, 0x88]);
    const x8 = decodeDds(u8(...ddsHeader(1, 1, { flags: 0x40, bits: 32, masks: [0xff0000, 0xff00, 0xff, 0xff000000] }), 3, 2, 1, 77));
    expect(x8.format).toBe("X8R8G8B8");
    expect(px(x8, 0, 0)).toEqual([1, 2, 3, 255]);
  });

  test("unknown FourCC (Q8W8V8U8 bump map) is reported, truncated data is an error", () => {
    const hdr = ddsHeader(1, 1, { flags: 4 });
    hdr[84] = 63;
    expect(() => decodeDds(u8(...hdr, 0, 0, 0, 0))).toThrow(/unsupported pixel format/);
    expect(() => decodeDds(u8(...ddsHeader(8, 8, { flags: 4, fourCC: "DXT1" }), 0, 0))).toThrow(/truncated/);
  });
});

describe("BMP and PNG", () => {
  test("24-bit bottom-up BMP with row padding", () => {
    // 2x2: bottom row (BGR) 1,2,3 / 4,5,6 + 2 pad bytes; top row 7,8,9 / 10,11,12 + pad
    const hdr = new Uint8Array(54);
    const dv = new DataView(hdr.buffer);
    hdr[0] = 0x42; hdr[1] = 0x4d; dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
    dv.setInt32(18, 2, true); dv.setInt32(22, 2, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
    const file = u8(...hdr, 1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 0, 0);
    const img = decodeBmp(file);
    expect(img.format).toBe("R8G8B8");
    expect(px(img, 0, 0)).toEqual([9, 8, 7, 255]);
    expect(px(img, 1, 1)).toEqual([6, 5, 4, 255]);
  });

  test("PNG: RGB and RGBA with Sub / Up / Paeth filters", () => {
    const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const chunk = (type: string, body: number[]): number[] => [...be32(body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0]; // CRC not checked
    const build = (ctype: number, width: number, rows: number[][]): Uint8Array => u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...chunk("IHDR", [...be32(width), ...be32(rows.length), 8, ctype, 0, 0, 0]),
      ...chunk("IDAT", [...zlibSync(u8(...rows.flat()))]), ...chunk("IEND", []));
    // 2x2 RGB: row 0 filter Sub: (10,20,30) then +(1,1,1) -> (11,21,31); row 1 filter Up: adds the row above
    const rgb = decodePng(build(2, 2, [[1, 10, 20, 30, 1, 1, 1], [2, 5, 5, 5, 0, 0, 0]]));
    expect(px(rgb, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(px(rgb, 1, 0)).toEqual([11, 21, 31, 255]);
    expect(px(rgb, 0, 1)).toEqual([15, 25, 35, 255]);
    expect(px(rgb, 1, 1)).toEqual([11, 21, 31, 255]);
    // 1x2 RGBA, row 1 uses Paeth with only the "up" neighbour available for x < bpp: predictor = up
    const rgba = decodePng(build(6, 1, [[0, 1, 2, 3, 4], [4, 1, 1, 1, 1]]));
    expect(rgba.hasAlpha).toBe(true);
    expect(px(rgba, 0, 0)).toEqual([1, 2, 3, 4]);
    expect(px(rgba, 0, 1)).toEqual([2, 3, 4, 5]);
  });
});

describe("sniffing", () => {
  test("content decides, not the extension", () => {
    expect(sniffImage(u8(0x44, 0x44, 0x53, 0x20, 0))).toBe("dds");
    expect(sniffImage(u8(0x42, 0x4d, 0, 0))).toBe("bmp");
    expect(sniffImage(u8(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImage(u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffImage(u8(...tgaHeader(2, 1, 1, 24, 0), 0, 0, 0))).toBe("tga");
    expect(sniffImage(new Uint8Array(0))).toBeUndefined();
    expect(() => decodeImage(new Uint8Array(0))).toThrow(ImageFormatError);
    expect(() => decodeImage(u8(0xff, 0xd8, 0xff, 0xe0))).toThrow(/platform/);
  });
});
