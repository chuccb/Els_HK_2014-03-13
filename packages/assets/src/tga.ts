/**
 * Truevision TGA decoder with the semantics of D3DX9 (the exe loads TGA through `D3DXCreateTextureFromFileInMemoryEx`).
 *
 * Census of the client's 23,784 `.tga` entries (tools/census-images.ts): 23,477 uncompressed true-colour (24 bpp 20,226,
 * 32 bpp 3,227, 16 bpp 24), 299 RLE true-colour, 3 colour-mapped (8 bpp, 24-bit palette), 1 grey; descriptor 0x00 (bottom-left),
 * 0x08 (8 alpha bits), 0x01 (1 alpha bit, the 16 bpp files), 0x20 (top-left); 13,521 have the "TRUEVISION-XFILE" footer.
 * Four entries are BMP/JPEG files with a `.tga` name (see image.ts).
 *
 * Alpha rules assumed to be D3DX's: 32 bpp files are A8R8G8B8 whatever the descriptor's alpha-bit count says; 24 bpp = X8R8G8B8
 * (A = 255); 16 bpp is A1R5G5B5 when the descriptor declares 1 alpha bit and X1R5G5B5 otherwise; 5 -> 8 bit expansion by bit
 * replication. (No D3DX is available here to confirm the 32 bpp rule; see docs/FINDINGS.md.)
 */
import { ImageFormatError } from "./image.ts";
import type { DecodedImage, SourceFormat } from "./image.ts";

export interface TgaHeader {
  idLength: number;
  colorMapType: number;
  imageType: number;
  cmapFirst: number;
  cmapLength: number;
  cmapEntryBits: number;
  xOrigin: number;
  yOrigin: number;
  width: number;
  height: number;
  bpp: number;
  descriptor: number;
}

export function readTgaHeader(b: Uint8Array): TgaHeader {
  if (b.length < 18) throw new ImageFormatError("TGA: file shorter than the 18-byte header", "tga");
  const u16 = (o: number): number => b[o]! | (b[o + 1]! << 8);
  return {
    idLength: b[0]!, colorMapType: b[1]!, imageType: b[2]!,
    cmapFirst: u16(3), cmapLength: u16(5), cmapEntryBits: b[7]!,
    xOrigin: u16(8), yOrigin: u16(10), width: u16(12), height: u16(14), bpp: b[16]!, descriptor: b[17]!,
  };
}

/** the header checks of `decodeTga` (the file kinds it can read) */
function checkTgaHeader(h: TgaHeader): void {
  const { width, height, bpp, imageType } = h;
  const base = imageType & 7; // 1 = colour-mapped, 2 = true colour, 3 = grey
  if (base < 1 || base > 3 || imageType > 11) throw new ImageFormatError(`TGA: unsupported image type ${imageType}`, "tga");
  if (width === 0 || height === 0) throw new ImageFormatError("TGA: zero-sized image", "tga");
  if (base === 1 && (h.colorMapType !== 1 || bpp !== 8)) throw new ImageFormatError("TGA: colour-mapped image needs an 8 bpp index and a palette", "tga");
  if (base === 2 && ![15, 16, 24, 32].includes(bpp)) throw new ImageFormatError(`TGA: unsupported true-colour depth ${bpp}`, "tga");
  if (base === 3 && bpp !== 8 && bpp !== 16) throw new ImageFormatError(`TGA: unsupported grey depth ${bpp}`, "tga");
}

/** the format D3DX reports for a TGA (see the alpha rules above) */
function tgaSourceFormat(h: TgaHeader): { format: SourceFormat; hasAlpha: boolean } {
  const { bpp } = h;
  const base = h.imageType & 7;
  const alphaBits = h.descriptor & 0x0f;
  if (base === 1) return { format: "P8", hasAlpha: false };
  if (base === 3) return { format: bpp === 8 ? "L8" : "A8L8", hasAlpha: bpp === 16 };
  if (bpp === 32) return { format: "A8R8G8B8", hasAlpha: true };
  if (bpp === 24) return { format: "R8G8B8", hasAlpha: false }; // D3DX reports 24 bpp TGA like 24 bpp BMP; the exe itself tests for R8G8B8 to pick DXT1 at low detail
  if (alphaBits === 1 && bpp === 16) return { format: "A1R5G5B5", hasAlpha: true };
  return { format: "X1R5G5B5", hasAlpha: false };
}

/**
 * Width, height and format of a TGA without decoding its pixels (what `D3DXGetImageInfoFromFileInMemory` reads: the header).
 * Throws ImageFormatError for the files `decodeTga` rejects on their header.
 */
export function readTgaInfo(b: Uint8Array): { width: number; height: number; format: SourceFormat } {
  const h = readTgaHeader(b);
  checkTgaHeader(h);
  return { width: h.width, height: h.height, format: tgaSourceFormat(h).format };
}

export function decodeTga(b: Uint8Array): DecodedImage {
  const h = readTgaHeader(b);
  const { width, height, bpp, imageType } = h;
  const rle = imageType >= 9;
  const base = imageType & 7; // 1 = colour-mapped, 2 = true colour, 3 = grey
  checkTgaHeader(h);
  const alphaBits = h.descriptor & 0x0f;

  // colour map (RGBA per entry, indexed by absolute index = first + position)
  let p = 18 + h.idLength;
  let palette: Uint8Array | undefined;
  if (h.colorMapType === 1) {
    const entryBytes = (h.cmapEntryBits + 7) >> 3;
    if (p + h.cmapLength * entryBytes > b.length) throw new ImageFormatError("TGA: truncated colour map", "tga");
    if (base === 1) {
      if (![15, 16, 24, 32].includes(h.cmapEntryBits)) throw new ImageFormatError(`TGA: unsupported colour map entry size ${h.cmapEntryBits}`, "tga");
      palette = new Uint8Array((h.cmapFirst + h.cmapLength) * 4);
      for (let i = 0; i < h.cmapLength; i++) {
        trueColour(palette, (h.cmapFirst + i) * 4, b, p + i * entryBytes, h.cmapEntryBits, alphaBits);
      }
    }
    p += h.cmapLength * entryBytes;
  }

  const bytesPP = base === 1 ? 1 : (bpp + 7) >> 3;
  const count = width * height;
  let raw: Uint8Array; // packed pixels in file order
  if (!rle) {
    const need = count * bytesPP;
    if (p + need > b.length) throw new ImageFormatError(`TGA: truncated pixel data (${b.length - p} of ${need} bytes)`, "tga");
    raw = b.subarray(p, p + need);
  } else {
    raw = new Uint8Array(count * bytesPP);
    let o = 0;
    while (o < raw.length) {
      if (p >= b.length) throw new ImageFormatError("TGA: truncated RLE data", "tga");
      const c = b[p++]!;
      const bytes = Math.min((c & 0x7f) + 1, (raw.length - o) / bytesPP) * bytesPP;
      if (c & 0x80) {
        if (p + bytesPP > b.length) throw new ImageFormatError("TGA: truncated RLE run", "tga");
        for (let i = 0; i < bytes; i += bytesPP) for (let k = 0; k < bytesPP; k++) raw[o + i + k] = b[p + k]!;
        p += bytesPP;
      } else {
        if (p + bytes > b.length) throw new ImageFormatError("TGA: truncated RLE literal", "tga");
        raw.set(b.subarray(p, p + bytes), o);
        p += bytes;
      }
      o += bytes;
    }
  }

  const topDown = (h.descriptor & 0x20) !== 0;
  const rightToLeft = (h.descriptor & 0x10) !== 0;
  const { format, hasAlpha } = tgaSourceFormat(h);

  const out = new Uint8Array(count * 4);
  for (let y = 0; y < height; y++) {
    const dy = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const dx = rightToLeft ? width - 1 - x : x;
      const s = (y * width + x) * bytesPP;
      const d = (dy * width + dx) * 4;
      if (base === 1) {
        const idx = raw[s]!;
        const pi = idx * 4;
        if (!palette || pi + 3 >= palette.length) throw new ImageFormatError(`TGA: palette index ${idx} outside the colour map`, "tga");
        out[d] = palette[pi]!; out[d + 1] = palette[pi + 1]!; out[d + 2] = palette[pi + 2]!; out[d + 3] = palette[pi + 3]!;
      } else if (base === 3) {
        const v = raw[s]!;
        out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = bpp === 16 ? raw[s + 1]! : 255;
      } else {
        trueColour(out, d, raw, s, bpp, alphaBits);
      }
    }
  }
  return { width, height, rgba: out, container: "tga", format, hasAlpha };
}

/** One true-colour pixel (B G R [A] or A1R5G5B5) -> RGBA8. */
function trueColour(dst: Uint8Array, d: number, src: Uint8Array, s: number, bits: number, alphaBits: number): void {
  if (bits === 32) {
    dst[d] = src[s + 2]!; dst[d + 1] = src[s + 1]!; dst[d + 2] = src[s]!; dst[d + 3] = src[s + 3]!;
  } else if (bits === 24) {
    dst[d] = src[s + 2]!; dst[d + 1] = src[s + 1]!; dst[d + 2] = src[s]!; dst[d + 3] = 255;
  } else {
    const v = src[s]! | (src[s + 1]! << 8);
    const r = (v >> 10) & 31, g = (v >> 5) & 31, bl = v & 31;
    dst[d] = (r << 3) | (r >> 2); dst[d + 1] = (g << 3) | (g >> 2); dst[d + 2] = (bl << 3) | (bl >> 2);
    dst[d + 3] = alphaBits === 1 && (v & 0x8000) === 0 ? 0 : 255;
  }
}
