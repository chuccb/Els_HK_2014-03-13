/**
 * DirectDraw Surface decoder (level 0 only: the exe asks D3DX for MipLevels = 1, see image.ts).
 *
 * Census of the client's 31,593 `.dds` entries (tools/census-images.ts): DXT1 27,439; DXT5 1,824; DXT3 1,021; uncompressed
 * R8G8B8 848; A8R8G8B8 428; X8R8G8B8 16; A4R4G4B4 12; one FourCC 63 (D3DFMT_Q8W8V8U8 bump map, kept raw); 45 volume textures
 * (caps2 0x200000; only the first slice is decoded; the exe only calls the 2D loader, never D3DXCreateVolumeTexture*); 4 entries are not DDS at all (PNG,
 * TGA, two empty files) and are reported as such by `sniffImage`.
 *
 * Block decoding follows the D3D9 reference: 565 -> 888 by bit replication, 4-colour interpolation `(2a + b) / 3` in 8-bit
 * integer arithmetic, the 3-colour + transparent mode only for DXT1 when c0 <= c1, always 4-colour for DXT2-5.
 */
import { ImageFormatError } from "./image.ts";
import type { DecodedImage, SourceFormat } from "./image.ts";

export interface DdsPixelFormat {
  flags: number;
  fourCC: number;
  bitCount: number;
  rMask: number;
  gMask: number;
  bMask: number;
  aMask: number;
}

export interface DdsHeader {
  flags: number;
  height: number;
  width: number;
  pitchOrLinearSize: number;
  depth: number;
  mipCount: number;
  pf: DdsPixelFormat;
  caps: number;
  caps2: number;
}

export const DDPF_ALPHAPIXELS = 0x1;
export const DDPF_FOURCC = 0x4;
export const DDPF_RGB = 0x40;
export const DDSCAPS2_CUBEMAP = 0x200;
export const DDSCAPS2_VOLUME = 0x200000;

const fourCCOf = (s: string): number => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
const FOURCC_DXT: Record<number, SourceFormat> = {
  [fourCCOf("DXT1")]: "DXT1", [fourCCOf("DXT2")]: "DXT2", [fourCCOf("DXT3")]: "DXT3", [fourCCOf("DXT4")]: "DXT4", [fourCCOf("DXT5")]: "DXT5",
};

export function readDdsHeader(b: Uint8Array): DdsHeader {
  if (b.length < 128) throw new ImageFormatError("DDS: file shorter than the 128-byte header", "dds");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0x20534444) throw new ImageFormatError("DDS: bad magic", "dds");
  if (dv.getUint32(4, true) !== 124) throw new ImageFormatError(`DDS: header size ${dv.getUint32(4, true)} (expected 124)`, "dds");
  const u = (o: number): number => dv.getUint32(o, true);
  return {
    flags: u(8), height: u(12), width: u(16), pitchOrLinearSize: u(20), depth: u(24), mipCount: u(28),
    pf: { flags: u(80), fourCC: u(84), bitCount: u(88), rMask: u(92), gMask: u(96), bMask: u(100), aMask: u(104) },
    caps: u(108), caps2: u(112),
  };
}

/** The D3D9 format D3DX would report for the header, or "OTHER" when it is not one of the formats in the census. */
export function ddsSourceFormat(h: DdsHeader): SourceFormat {
  const pf = h.pf;
  if (pf.flags & DDPF_FOURCC) return FOURCC_DXT[pf.fourCC] ?? "OTHER";
  if (pf.flags & DDPF_RGB) {
    const a = pf.flags & DDPF_ALPHAPIXELS ? pf.aMask : 0;
    if (pf.bitCount === 32) return a === 0xff000000 ? "A8R8G8B8" : "X8R8G8B8";
    if (pf.bitCount === 24) return "R8G8B8";
    if (pf.bitCount === 16) {
      if (pf.rMask === 0xf800) return "R5G6B5";
      if (pf.rMask === 0x7c00) return a ? "A1R5G5B5" : "X1R5G5B5";
      if (pf.rMask === 0x0f00) return "A4R4G4B4";
    }
  }
  return "OTHER";
}

export function decodeDds(b: Uint8Array): DecodedImage {
  const h = readDdsHeader(b);
  const { width, height } = h;
  if (width === 0 || height === 0) throw new ImageFormatError("DDS: zero-sized image", "dds");
  const format = ddsSourceFormat(h);
  const data = b.subarray(128);
  let rgba: Uint8Array;
  let hasAlpha = true;
  switch (format) {
    case "DXT1": case "DXT2": case "DXT3": case "DXT4": case "DXT5": {
      const block = format === "DXT1" ? 8 : 16;
      const need = Math.ceil(width / 4) * Math.ceil(height / 4) * block;
      if (data.length < need) throw new ImageFormatError(`DDS: truncated ${format} data (${data.length} of ${need} bytes)`, "dds");
      rgba = format === "DXT1" ? decodeBc1(data, width, height) : format === "DXT2" || format === "DXT3" ? decodeBc2(data, width, height) : decodeBc3(data, width, height);
      break;
    }
    case "OTHER":
      throw new ImageFormatError(`DDS: unsupported pixel format (flags 0x${h.pf.flags.toString(16)} fourCC 0x${h.pf.fourCC.toString(16)} ${h.pf.bitCount} bpp)`, "dds");
    default: {
      const bytesPP = h.pf.bitCount >> 3;
      const need = width * height * bytesPP;
      if (data.length < need) throw new ImageFormatError(`DDS: truncated ${format} data (${data.length} of ${need} bytes)`, "dds");
      const hasA = (h.pf.flags & DDPF_ALPHAPIXELS) !== 0 && h.pf.aMask !== 0;
      hasAlpha = hasA && format !== "X8R8G8B8" && format !== "X1R5G5B5" && format !== "R5G6B5" && format !== "R8G8B8";
      rgba = decodeMasked(data, width, height, bytesPP, h.pf, hasAlpha);
    }
  }
  if (format === "DXT1") hasAlpha = true; // 1-bit alpha is possible (c0 <= c1 blocks)
  return { width, height, rgba, container: "dds", format, hasAlpha };
}

const expand = (v: number, bits: number): number => {
  if (bits >= 8) return v >> (bits - 8);
  let r = v << (8 - bits);
  for (let s = bits; s < 8; s *= 2) r |= r >> s;
  return r;
};

function maskInfo(mask: number): { shift: number; bits: number } {
  if (mask === 0) return { shift: 0, bits: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while (((mask >>> (shift + bits)) & 1) === 1 && shift + bits < 32) bits++;
  return { shift, bits };
}

/** Uncompressed formats described by bit masks (R8G8B8, A8R8G8B8, X8R8G8B8, A4R4G4B4, R5G6B5, ...). */
function decodeMasked(src: Uint8Array, width: number, height: number, bytesPP: number, pf: DdsPixelFormat, hasAlpha: boolean): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const r = maskInfo(pf.rMask), g = maskInfo(pf.gMask), bl = maskInfo(pf.bMask), a = maskInfo(pf.aMask);
  for (let i = 0, s = 0, d = 0; i < width * height; i++, s += bytesPP, d += 4) {
    let v = 0;
    for (let k = bytesPP - 1; k >= 0; k--) v = v * 256 + src[s + k]!;
    out[d] = expand(Math.floor(v / 2 ** r.shift) % 2 ** r.bits, r.bits);
    out[d + 1] = expand(Math.floor(v / 2 ** g.shift) % 2 ** g.bits, g.bits);
    out[d + 2] = expand(Math.floor(v / 2 ** bl.shift) % 2 ** bl.bits, bl.bits);
    out[d + 3] = hasAlpha ? expand(Math.floor(v / 2 ** a.shift) % 2 ** a.bits, a.bits) : 255;
  }
  return out;
}

/** BC1 colour block -> 16 RGBA pixels written at `out[o...]` (row stride `stride` pixels). */
function colourBlock(src: Uint8Array, p: number, out: Uint8Array, bx: number, by: number, width: number, height: number, allowTransparent: boolean): void {
  const c0 = src[p]! | (src[p + 1]! << 8);
  const c1 = src[p + 2]! | (src[p + 3]! << 8);
  const pal = new Uint8Array(16);
  const unpack = (c: number, o: number): void => {
    const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
    pal[o] = (r << 3) | (r >> 2); pal[o + 1] = (g << 2) | (g >> 4); pal[o + 2] = (b << 3) | (b >> 2); pal[o + 3] = 255;
  };
  unpack(c0, 0);
  unpack(c1, 4);
  if (c0 > c1 || !allowTransparent) {
    for (let k = 0; k < 3; k++) {
      pal[8 + k] = Math.floor((2 * pal[k]! + pal[4 + k]!) / 3);
      pal[12 + k] = Math.floor((pal[k]! + 2 * pal[4 + k]!) / 3);
    }
    pal[11] = 255; pal[15] = 255;
  } else {
    for (let k = 0; k < 3; k++) pal[8 + k] = (pal[k]! + pal[4 + k]!) >> 1;
    pal[11] = 255;
    pal[12] = 0; pal[13] = 0; pal[14] = 0; pal[15] = 0;
  }
  const bits = (src[p + 4]! | (src[p + 5]! << 8) | (src[p + 6]! << 16) | (src[p + 7]! << 24)) >>> 0;
  for (let py = 0; py < 4; py++) {
    const y = by * 4 + py;
    if (y >= height) break;
    for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px;
      if (x >= width) continue;
      const sel = (bits >>> (2 * (py * 4 + px))) & 3;
      const d = (y * width + x) * 4;
      out[d] = pal[sel * 4]!; out[d + 1] = pal[sel * 4 + 1]!; out[d + 2] = pal[sel * 4 + 2]!; out[d + 3] = pal[sel * 4 + 3]!;
    }
  }
}

export function decodeBc1(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  for (let by = 0, p = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, p += 8) colourBlock(src, p, out, bx, by, width, height, true);
  return out;
}

export function decodeBc2(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  for (let by = 0, p = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, p += 16) {
      colourBlock(src, p + 8, out, bx, by, width, height, false);
      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= height) break;
        const row = src[p + py * 2]! | (src[p + py * 2 + 1]! << 8);
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x < width) out[(y * width + x) * 4 + 3] = ((row >> (4 * px)) & 15) * 17;
        }
      }
    }
  }
  return out;
}

export function decodeBc3(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  const alpha = new Uint8Array(8);
  for (let by = 0, p = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, p += 16) {
      colourBlock(src, p + 8, out, bx, by, width, height, false);
      const a0 = src[p]!, a1 = src[p + 1]!;
      alpha[0] = a0; alpha[1] = a1;
      if (a0 > a1) {
        for (let i = 1; i <= 6; i++) alpha[1 + i] = Math.floor(((7 - i) * a0 + i * a1) / 7);
      } else {
        for (let i = 1; i <= 4; i++) alpha[1 + i] = Math.floor(((5 - i) * a0 + i * a1) / 5);
        alpha[6] = 0; alpha[7] = 255;
      }
      // 48 bits of 3-bit indices, little endian
      const lo = (src[p + 2]! | (src[p + 3]! << 8) | (src[p + 4]! << 16)) >>> 0;
      const hi = (src[p + 5]! | (src[p + 6]! << 8) | (src[p + 7]! << 16)) >>> 0;
      for (let k = 0; k < 16; k++) {
        const y = by * 4 + (k >> 2), x = bx * 4 + (k & 3);
        if (y >= height || x >= width) continue;
        const idx = k < 8 ? (lo >>> (3 * k)) & 7 : (hi >>> (3 * (k - 8))) & 7;
        out[(y * width + x) * 4 + 3] = alpha[idx]!;
      }
    }
  }
  return out;
}
