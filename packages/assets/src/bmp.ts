/**
 * Windows BMP decoder (uncompressed 1/4/8/16/24/32 bpp, BITMAPINFOHEADER and later). Only two 1x1 / 2x2 24-bit files of the client
 * use it (`UIEdge.tga`, `HQ_ShopEqipedBorder2.tga` are BMP files with a `.tga` name); D3DX reports them as R8G8B8.
 */
import { ImageFormatError } from "./image.ts";
import type { DecodedImage, SourceFormat } from "./image.ts";

export function decodeBmp(b: Uint8Array): DecodedImage {
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) throw new ImageFormatError("BMP: bad magic", "bmp");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dataOffset = dv.getUint32(10, true);
  const hdrSize = dv.getUint32(14, true);
  let width: number, height: number, bpp: number, compression = 0, colours = 0;
  if (hdrSize === 12) {
    width = dv.getUint16(18, true); height = dv.getUint16(20, true); bpp = dv.getUint16(24, true);
  } else {
    if (hdrSize < 40 || b.length < 14 + hdrSize) throw new ImageFormatError("BMP: unsupported header", "bmp");
    width = dv.getInt32(18, true); height = dv.getInt32(22, true); bpp = dv.getUint16(28, true);
    compression = dv.getUint32(30, true); colours = dv.getUint32(46, true);
  }
  const topDown = height < 0;
  height = Math.abs(height);
  if (width <= 0 || height === 0) throw new ImageFormatError("BMP: bad size", "bmp");
  if (compression !== 0 && !(compression === 3 && (bpp === 16 || bpp === 32))) throw new ImageFormatError(`BMP: unsupported compression ${compression}`, "bmp");
  const stride = (((width * bpp + 31) >> 5) << 2);
  if (dataOffset + stride * height > b.length) throw new ImageFormatError("BMP: truncated pixel data", "bmp");
  let palette: Uint8Array | undefined;
  if (bpp <= 8) {
    const n = colours || 1 << bpp;
    const entry = hdrSize === 12 ? 3 : 4;
    const po = 14 + hdrSize;
    palette = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      palette[i * 4] = b[po + i * entry + 2]!; palette[i * 4 + 1] = b[po + i * entry + 1]!; palette[i * 4 + 2] = b[po + i * entry]!; palette[i * 4 + 3] = 255;
    }
  }
  let masks = bpp === 16 ? [0x7c00, 0x03e0, 0x001f] : [0xff0000, 0xff00, 0xff];
  if (compression === 3 && hdrSize >= 52) masks = [dv.getUint32(54, true), dv.getUint32(58, true), dv.getUint32(62, true)];
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = topDown ? y : height - 1 - y;
    const row = dataOffset + sy * stride;
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      if (bpp === 24) {
        const s = row + x * 3;
        out[d] = b[s + 2]!; out[d + 1] = b[s + 1]!; out[d + 2] = b[s]!; out[d + 3] = 255;
      } else if (bpp === 32) {
        const v = dv.getUint32(row + x * 4, true);
        out[d] = chan(v, masks[0]!); out[d + 1] = chan(v, masks[1]!); out[d + 2] = chan(v, masks[2]!); out[d + 3] = 255;
      } else if (bpp === 16) {
        const v = dv.getUint16(row + x * 2, true);
        out[d] = chan(v, masks[0]!); out[d + 1] = chan(v, masks[1]!); out[d + 2] = chan(v, masks[2]!); out[d + 3] = 255;
      } else {
        const perByte = 8 / bpp;
        const byte = b[row + Math.floor(x / perByte)]!;
        const idx = (byte >> (8 - bpp - (x % perByte) * bpp)) & ((1 << bpp) - 1);
        out[d] = palette![idx * 4]!; out[d + 1] = palette![idx * 4 + 1]!; out[d + 2] = palette![idx * 4 + 2]!; out[d + 3] = 255;
      }
    }
  }
  const format: SourceFormat = bpp === 24 ? "R8G8B8" : bpp === 32 ? "X8R8G8B8" : bpp === 16 ? "R5G6B5" : "P8";
  return { width, height, rgba: out, container: "bmp", format, hasAlpha: false };
}

function chan(v: number, mask: number): number {
  if (mask === 0) return 0;
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while (shift + bits < 32 && ((mask >>> (shift + bits)) & 1) === 1) bits++;
  const x = (v >>> shift) & (2 ** bits - 1);
  if (bits >= 8) return x >> (bits - 8);
  let r = x << (8 - bits);
  for (let s = bits; s < 8; s *= 2) r |= r >> s;
  return r;
}
