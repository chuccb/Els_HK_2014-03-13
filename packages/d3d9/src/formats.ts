/**
 * D3DFORMAT metadata and the CPU conversions from D3D's native memory layout to what we upload to the GPU.
 *
 * Colour formats are uploaded as `rgba8unorm` (or `bgra8unorm` for the back buffer / render targets) after expanding to 8 bits per
 * channel the way the hardware does (n-bit -> 8-bit by bit replication); formats without alpha sample with alpha = 1 (X8R8G8B8, R5G6B5,
 * L8, R8G8B8, ...), A8 samples as (0, 0, 0, a), L8 as (l, l, l, 1), A8L8 as (l, l, l, a).  DXT1/3/5 stay compressed when the device
 * has `texture-compression-bc`; otherwise they are decoded on the CPU (@els/assets) and uploaded as RGBA8.
 */
import { decodeBc1, decodeBc2, decodeBc3 } from "@els/assets";
import { D3DFMT } from "./enums.ts";

export interface FormatInfo {
  readonly id: number;
  readonly name: string;
  /** bytes per pixel, or per 4x4 block for compressed formats */
  readonly bytes: number;
  readonly compressed: boolean;
  readonly depth: boolean;
  readonly stencilBits: number;
  readonly hasAlpha: boolean;
  /** GPU format used for a sampled copy of this format (rgba8unorm for most); null when unsupported */
  readonly gpu: GPUTextureFormat | null;
  /** GPU format when the device supports BC compression (compressed formats only) */
  readonly gpuBc?: GPUTextureFormat;
}

const F = (id: number, name: string, bytes: number, o: Partial<FormatInfo> = {}): FormatInfo =>
  ({ id, name, bytes, compressed: false, depth: false, stencilBits: 0, hasAlpha: false, gpu: "rgba8unorm", ...o });

const LIST: FormatInfo[] = [
  F(D3DFMT.A8R8G8B8, "A8R8G8B8", 4, { hasAlpha: true }),
  F(D3DFMT.X8R8G8B8, "X8R8G8B8", 4),
  F(D3DFMT.A8B8G8R8, "A8B8G8R8", 4, { hasAlpha: true }),
  F(D3DFMT.X8B8G8R8, "X8B8G8R8", 4),
  F(D3DFMT.R8G8B8, "R8G8B8", 3),
  F(D3DFMT.R5G6B5, "R5G6B5", 2),
  F(D3DFMT.X1R5G5B5, "X1R5G5B5", 2),
  F(D3DFMT.A1R5G5B5, "A1R5G5B5", 2, { hasAlpha: true }),
  F(D3DFMT.A4R4G4B4, "A4R4G4B4", 2, { hasAlpha: true }),
  F(D3DFMT.X4R4G4B4, "X4R4G4B4", 2),
  F(D3DFMT.A8, "A8", 1, { hasAlpha: true }),
  F(D3DFMT.L8, "L8", 1),
  F(D3DFMT.A8L8, "A8L8", 2, { hasAlpha: true }),
  F(D3DFMT.DXT1, "DXT1", 8, { compressed: true, hasAlpha: true, gpuBc: "bc1-rgba-unorm" }),
  F(D3DFMT.DXT2, "DXT2", 16, { compressed: true, hasAlpha: true, gpuBc: "bc2-rgba-unorm" }),
  F(D3DFMT.DXT3, "DXT3", 16, { compressed: true, hasAlpha: true, gpuBc: "bc2-rgba-unorm" }),
  F(D3DFMT.DXT4, "DXT4", 16, { compressed: true, hasAlpha: true, gpuBc: "bc3-rgba-unorm" }),
  F(D3DFMT.DXT5, "DXT5", 16, { compressed: true, hasAlpha: true, gpuBc: "bc3-rgba-unorm" }),
  F(D3DFMT.D16, "D16", 2, { depth: true, gpu: "depth16unorm" }),
  F(D3DFMT.D16_LOCKABLE, "D16_LOCKABLE", 2, { depth: true, gpu: "depth16unorm" }),
  F(D3DFMT.D24S8, "D24S8", 4, { depth: true, stencilBits: 8, gpu: "depth24plus-stencil8" }),
  F(D3DFMT.D24X8, "D24X8", 4, { depth: true, gpu: "depth24plus" }),
  F(D3DFMT.D24X4S4, "D24X4S4", 4, { depth: true, stencilBits: 4, gpu: "depth24plus-stencil8" }),
  F(D3DFMT.D32, "D32", 4, { depth: true, gpu: "depth32float" }),
  F(D3DFMT.D32F_LOCKABLE, "D32F_LOCKABLE", 4, { depth: true, gpu: "depth32float" }),
  F(D3DFMT.R16F, "R16F", 2, { gpu: "r16float" }),
  F(D3DFMT.G16R16F, "G16R16F", 4, { gpu: "rg16float" }),
  F(D3DFMT.A16B16G16R16F, "A16B16G16R16F", 8, { hasAlpha: true, gpu: "rgba16float" }),
  F(D3DFMT.R32F, "R32F", 4, { gpu: "r32float" }),
  F(D3DFMT.G32R32F, "G32R32F", 8, { gpu: "rg32float" }),
  F(D3DFMT.A32B32G32R32F, "A32B32G32R32F", 16, { hasAlpha: true, gpu: "rgba32float" }),
];
const BY_ID = new Map(LIST.map((f) => [f.id, f]));

export function formatInfo(fmt: number): FormatInfo | undefined { return BY_ID.get(fmt); }
export const supportedFormats = (): readonly FormatInfo[] => LIST;

/** Row pitch in bytes of a surface of `width` pixels. */
export function surfacePitch(fmt: number, width: number): number {
  const i = BY_ID.get(fmt);
  if (!i) throw new Error(`unsupported D3DFORMAT ${fmt}`);
  return i.compressed ? Math.max(1, (width + 3) >> 2) * i.bytes : width * i.bytes;
}
/** Byte size of a whole surface. */
export function surfaceBytes(fmt: number, width: number, height: number): number {
  const i = BY_ID.get(fmt);
  if (!i) throw new Error(`unsupported D3DFORMAT ${fmt}`);
  return i.compressed ? surfacePitch(fmt, width) * Math.max(1, (height + 3) >> 2) : width * height * i.bytes;
}
/** Dimensions of mip level `level`. */
export const mipSize = (v: number, level: number): number => Math.max(1, v >> level);

const e5 = (v: number): number => (v << 3) | (v >> 2);
const e6 = (v: number): number => (v << 2) | (v >> 4);
const e4 = (v: number): number => (v << 4) | v;

/**
 * Convert a block of native pixels to RGBA8 (R,G,B,A byte order).  `src` rows are `pitch` bytes apart.  DXT formats decode the
 * blocks on the CPU.  Formats that stay compressed or are not colour formats throw.
 */
export function toRgba8(fmt: number, src: Uint8Array, width: number, height: number, pitch: number): Uint8Array {
  const info = BY_ID.get(fmt);
  if (!info || info.depth) throw new Error(`cannot convert D3DFORMAT ${fmt} to RGBA8`);
  const dst = new Uint8Array(width * height * 4);
  if (info.compressed) {
    const tight = pitch === surfacePitch(fmt, width) ? src : packRows(src, surfacePitch(fmt, width), Math.max(1, (height + 3) >> 2), pitch);
    const out = fmt === D3DFMT.DXT1 ? decodeBc1(tight, width, height) : fmt === D3DFMT.DXT2 || fmt === D3DFMT.DXT3 ? decodeBc2(tight, width, height) : decodeBc3(tight, width, height);
    return out;
  }
  for (let y = 0; y < height; y++) {
    let s = y * pitch;
    let d = y * width * 4;
    for (let x = 0; x < width; x++, d += 4) {
      switch (fmt) {
        case D3DFMT.A8R8G8B8: dst[d] = src[s + 2]!; dst[d + 1] = src[s + 1]!; dst[d + 2] = src[s]!; dst[d + 3] = src[s + 3]!; s += 4; break;
        case D3DFMT.X8R8G8B8: dst[d] = src[s + 2]!; dst[d + 1] = src[s + 1]!; dst[d + 2] = src[s]!; dst[d + 3] = 255; s += 4; break;
        case D3DFMT.A8B8G8R8: dst[d] = src[s]!; dst[d + 1] = src[s + 1]!; dst[d + 2] = src[s + 2]!; dst[d + 3] = src[s + 3]!; s += 4; break;
        case D3DFMT.X8B8G8R8: dst[d] = src[s]!; dst[d + 1] = src[s + 1]!; dst[d + 2] = src[s + 2]!; dst[d + 3] = 255; s += 4; break;
        case D3DFMT.R8G8B8: dst[d] = src[s + 2]!; dst[d + 1] = src[s + 1]!; dst[d + 2] = src[s]!; dst[d + 3] = 255; s += 3; break;
        case D3DFMT.R5G6B5: { const v = src[s]! | (src[s + 1]! << 8); dst[d] = e5(v >> 11); dst[d + 1] = e6((v >> 5) & 63); dst[d + 2] = e5(v & 31); dst[d + 3] = 255; s += 2; break; }
        case D3DFMT.X1R5G5B5: { const v = src[s]! | (src[s + 1]! << 8); dst[d] = e5((v >> 10) & 31); dst[d + 1] = e5((v >> 5) & 31); dst[d + 2] = e5(v & 31); dst[d + 3] = 255; s += 2; break; }
        case D3DFMT.A1R5G5B5: { const v = src[s]! | (src[s + 1]! << 8); dst[d] = e5((v >> 10) & 31); dst[d + 1] = e5((v >> 5) & 31); dst[d + 2] = e5(v & 31); dst[d + 3] = v & 0x8000 ? 255 : 0; s += 2; break; }
        case D3DFMT.A4R4G4B4: { const v = src[s]! | (src[s + 1]! << 8); dst[d] = e4((v >> 8) & 15); dst[d + 1] = e4((v >> 4) & 15); dst[d + 2] = e4(v & 15); dst[d + 3] = e4(v >> 12); s += 2; break; }
        case D3DFMT.X4R4G4B4: { const v = src[s]! | (src[s + 1]! << 8); dst[d] = e4((v >> 8) & 15); dst[d + 1] = e4((v >> 4) & 15); dst[d + 2] = e4(v & 15); dst[d + 3] = 255; s += 2; break; }
        case D3DFMT.A8: dst[d] = 0; dst[d + 1] = 0; dst[d + 2] = 0; dst[d + 3] = src[s]!; s += 1; break;
        case D3DFMT.L8: dst[d] = src[s]!; dst[d + 1] = src[s]!; dst[d + 2] = src[s]!; dst[d + 3] = 255; s += 1; break;
        case D3DFMT.A8L8: dst[d] = src[s]!; dst[d + 1] = src[s]!; dst[d + 2] = src[s]!; dst[d + 3] = src[s + 1]!; s += 2; break;
        default: throw new Error(`no RGBA8 conversion for ${info.name}`);
      }
    }
  }
  return dst;
}

/** Inverse of the 8888 conversions: RGBA8 -> native bytes (used when D3DX-style loaders fill a texture of a given format). */
export function fromRgba8(fmt: number, rgba: Uint8Array, width: number, height: number, dst: Uint8Array, pitch: number): void {
  const info = BY_ID.get(fmt);
  if (!info || info.depth || info.compressed) throw new Error(`cannot convert RGBA8 to D3DFORMAT ${fmt}`);
  for (let y = 0; y < height; y++) {
    let d = y * pitch;
    let s = y * width * 4;
    for (let x = 0; x < width; x++, s += 4) {
      const r = rgba[s]!, g = rgba[s + 1]!, b = rgba[s + 2]!, a = rgba[s + 3]!;
      switch (fmt) {
        case D3DFMT.A8R8G8B8: dst[d] = b; dst[d + 1] = g; dst[d + 2] = r; dst[d + 3] = a; d += 4; break;
        case D3DFMT.X8R8G8B8: dst[d] = b; dst[d + 1] = g; dst[d + 2] = r; dst[d + 3] = 255; d += 4; break;
        case D3DFMT.A8B8G8R8: dst[d] = r; dst[d + 1] = g; dst[d + 2] = b; dst[d + 3] = a; d += 4; break;
        case D3DFMT.X8B8G8R8: dst[d] = r; dst[d + 1] = g; dst[d + 2] = b; dst[d + 3] = 255; d += 4; break;
        case D3DFMT.R8G8B8: dst[d] = b; dst[d + 1] = g; dst[d + 2] = r; d += 3; break;
        case D3DFMT.R5G6B5: { const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3); dst[d] = v & 255; dst[d + 1] = v >> 8; d += 2; break; }
        case D3DFMT.X1R5G5B5: { const v = 0x8000 | ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); dst[d] = v & 255; dst[d + 1] = v >> 8; d += 2; break; }
        case D3DFMT.A1R5G5B5: { const v = (a >= 128 ? 0x8000 : 0) | ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); dst[d] = v & 255; dst[d + 1] = v >> 8; d += 2; break; }
        case D3DFMT.A4R4G4B4: { const v = ((a >> 4) << 12) | ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); dst[d] = v & 255; dst[d + 1] = v >> 8; d += 2; break; }
        case D3DFMT.X4R4G4B4: { const v = 0xf000 | ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); dst[d] = v & 255; dst[d + 1] = v >> 8; d += 2; break; }
        case D3DFMT.A8: dst[d] = a; d += 1; break;
        case D3DFMT.L8: dst[d] = r; d += 1; break;
        case D3DFMT.A8L8: dst[d] = r; dst[d + 1] = a; d += 2; break;
        default: throw new Error(`no RGBA8 -> ${info.name} conversion`);
      }
    }
  }
}

function packRows(src: Uint8Array, rowBytes: number, rows: number, pitch: number): Uint8Array {
  const out = new Uint8Array(rowBytes * rows);
  for (let r = 0; r < rows; r++) out.set(src.subarray(r * pitch, r * pitch + rowBytes), r * rowBytes);
  return out;
}
