/**
 * The texture half of D3DX9 (d3dx9_43.dll) as the exe uses it: `D3DXGetImageInfoFromFileInMemory`, `D3DXCheckTextureRequirements`,
 * `D3DXCreateTextureFromFileInMemoryEx`, `D3DXCreateTexture`, `D3DXSaveSurfaceToFileW` (x2.exe.c: CKTDXDeviceTexture::LoadTexture
 * ~L423340..423700, CKTDXDeviceRenderTargetTexture::OnResetDevice L431600, CrashReport L575901).
 *
 * The exe's call is
 *   D3DXGetImageInfoFromFileInMemory(data, size, &info);
 *   D3DXCheckTextureRequirements(dev, &w, &h, &mips, 0, &fmt, D3DPOOL_MANAGED);
 *   D3DXCreateTextureFromFileInMemoryEx(dev, data, size, w, h, 1, 0, fmt, D3DPOOL_MANAGED,
 *       w == info.Width && h == info.Height ? D3DX_FILTER_NONE : D3DX_FILTER_LINEAR, D3DX_FILTER_NONE, 0 /* no colour key *\/, &info, 0, &tex);
 * with `w`/`h` halved or quartered by the texture detail setting and `fmt` = the caller's format (D3DFMT_UNKNOWN in practice).
 *
 * Decisions (the real D3DX is closed source; checked against the documented behaviour):
 *  - D3DFMT_UNKNOWN keeps the file's format, with the substitutions every real device forces: R8G8B8 -> X8R8G8B8, P8 -> A8R8G8B8.
 *  - Compressed DDS files are copied block for block (no re-encoding); compressing *to* DXT (texture detail "medium"/"low" asks for
 *    it) is not implemented: those textures get the reduced size in an uncompressed format.
 *  - JPEG is not decoded here (see @els/assets); `D3DXGetImageInfoFromFileInMemory` still reports its size.
 */
import { decodeImage, encodePng, ImageFormatError, readDdsHeader, ddsSourceFormat, readTgaInfo, sniffImage } from "@els/assets";
import type { DecodedImage, ImageContainer, SourceFormat } from "@els/assets";
import { D3DFMT, D3DPOOL, D3DRTYPE } from "./enums.ts";
import { formatInfo, fromRgba8, mipSize, surfaceBytes, surfacePitch } from "./formats.ts";
import { D3DERR_INVALIDCALL, D3DERR_NOTAVAILABLE, D3DXERR_INVALIDDATA, D3D_OK } from "./hresult.ts";
import type { Direct3DDevice9 } from "./device.ts";
import type { Direct3DSurface9, Direct3DTexture9 } from "./resources.ts";

export const D3DX_DEFAULT = 0xffffffff;
export const D3DX_DEFAULT_NONPOW2 = 0xfffffffe;
export const D3DX_FILTER = { NONE: 1, POINT: 2, LINEAR: 3, TRIANGLE: 4, BOX: 5 } as const;
/** D3DXIMAGE_FILEFORMAT */
export const D3DXIFF = { BMP: 0, JPG: 1, TGA: 2, PNG: 3, DDS: 4, PPM: 5, DIB: 6, HDR: 7, PFM: 8 } as const;

/** D3DXIMAGE_INFO */
export interface D3DXImageInfo {
  Width: number; Height: number; Depth: number; MipLevels: number; Format: number; ResourceType: number; ImageFileFormat: number;
}

const FMT_BY_NAME: Record<SourceFormat, number> = {
  A8R8G8B8: D3DFMT.A8R8G8B8, X8R8G8B8: D3DFMT.X8R8G8B8, R8G8B8: D3DFMT.R8G8B8, A1R5G5B5: D3DFMT.A1R5G5B5, X1R5G5B5: D3DFMT.X1R5G5B5, R5G6B5: D3DFMT.R5G6B5,
  A4R4G4B4: D3DFMT.A4R4G4B4, L8: D3DFMT.L8, P8: D3DFMT.P8, A8L8: D3DFMT.A8L8, DXT1: D3DFMT.DXT1, DXT2: D3DFMT.DXT2, DXT3: D3DFMT.DXT3, DXT4: D3DFMT.DXT4, DXT5: D3DFMT.DXT5, OTHER: D3DFMT.UNKNOWN,
};
const IFF_BY_CONTAINER: Record<ImageContainer, number> = { bmp: D3DXIFF.BMP, jpeg: D3DXIFF.JPG, tga: D3DXIFF.TGA, png: D3DXIFF.PNG, dds: D3DXIFF.DDS };

/** Width and height from a JPEG's start-of-frame marker (the one thing about JPEG this layer can answer). */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1]!;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    const len = (b[p + 2]! << 8) | b[p + 3]!;
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[p + 5]! << 8) | b[p + 6]!, width: (b[p + 7]! << 8) | b[p + 8]! };
    p += 2 + len;
  }
  return null;
}

export function D3DXGetImageInfoFromFileInMemory(data: Uint8Array): { hr: number; info: D3DXImageInfo | null } {
  const container = sniffImage(data);
  if (!container) return { hr: D3DXERR_INVALIDDATA, info: null };
  try {
    if (container === "jpeg") {
      const s = jpegSize(data);
      if (!s) return { hr: D3DXERR_INVALIDDATA, info: null };
      return { hr: D3D_OK, info: { Width: s.width, Height: s.height, Depth: 1, MipLevels: 1, Format: D3DFMT.X8R8G8B8, ResourceType: D3DRTYPE.TEXTURE, ImageFileFormat: D3DXIFF.JPG } };
    }
    if (container === "dds") {
      const h = readDdsHeader(data);
      return { hr: D3D_OK, info: { Width: h.width, Height: h.height, Depth: Math.max(1, h.depth), MipLevels: Math.max(1, h.mipCount), Format: FMT_BY_NAME[ddsSourceFormat(h)], ResourceType: D3DRTYPE.TEXTURE, ImageFileFormat: D3DXIFF.DDS } };
    }
    if (container === "tga") {
      // the header is all the info call reads (a 2048x2048 atlas would cost a full decode otherwise)
      const t = readTgaInfo(data);
      return { hr: D3D_OK, info: { Width: t.width, Height: t.height, Depth: 1, MipLevels: 1, Format: FMT_BY_NAME[t.format], ResourceType: D3DRTYPE.TEXTURE, ImageFileFormat: D3DXIFF.TGA } };
    }
    const img = decodeImage(data);
    return { hr: D3D_OK, info: { Width: img.width, Height: img.height, Depth: 1, MipLevels: 1, Format: FMT_BY_NAME[img.format], ResourceType: D3DRTYPE.TEXTURE, ImageFileFormat: IFF_BY_CONTAINER[container] } };
  } catch (e) {
    if (e instanceof ImageFormatError) return { hr: D3DXERR_INVALIDDATA, info: null };
    throw e;
  }
}

/** The format a device really creates for a requested one (R8G8B8 and P8 do not exist as textures on any current device). */
function supportedTextureFormat(fmt: number): number {
  if (fmt === D3DFMT.R8G8B8) return D3DFMT.X8R8G8B8;
  if (fmt === D3DFMT.P8) return D3DFMT.A8R8G8B8;
  const i = formatInfo(fmt);
  return i && !i.depth ? fmt : D3DFMT.A8R8G8B8;
}

export function D3DXCheckTextureRequirements(
  device: Direct3DDevice9, width: number, height: number, mipLevels: number, usage: number, format: number, pool: number,
): { hr: number; width: number; height: number; mipLevels: number; format: number } {
  const caps = device.GetDeviceCaps();
  let w = width === 0 || width >= D3DX_DEFAULT_NONPOW2 ? 1 : width, h = height === 0 || height >= D3DX_DEFAULT_NONPOW2 ? 1 : height;
  void usage; void pool;
  w = Math.min(w, caps.MaxTextureWidth); h = Math.min(h, caps.MaxTextureHeight);
  const full = 32 - Math.clz32(Math.max(w, h));
  const levels = mipLevels === 0 || mipLevels >= D3DX_DEFAULT_NONPOW2 ? full : Math.min(mipLevels, full);
  let f = format === D3DFMT.UNKNOWN || format >= D3DX_DEFAULT_NONPOW2 ? D3DFMT.A8R8G8B8 : supportedTextureFormat(format);
  // compressed formats need whole blocks: a texture smaller than 4x4 cannot be BC compressed on the GPU, fall back like D3DX does
  if (formatInfo(f)?.compressed && (w < 4 || h < 4)) f = D3DFMT.A8R8G8B8;
  return { hr: D3D_OK, width: w, height: h, mipLevels: levels, format: f };
}

// ----------------------------------------------------------------------------------------------------- resampling
/** Resample straight RGBA8.  POINT/NONE sample the nearest texel to the pixel centre; LINEAR is a bilinear tap at the pixel centre
 * (D3DX_FILTER_LINEAR); BOX and TRIANGLE average the source footprint. */
export function resizeRgba(src: Uint8Array, sw: number, sh: number, dw: number, dh: number, filter: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 4);
  if (sw === dw && sh === dh) { out.set(src); return out; }
  const fx = sw / dw, fy = sh / dh;
  if (filter === D3DX_FILTER.NONE || filter === D3DX_FILTER.POINT) {
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor((y + 0.5) * fy));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.floor((x + 0.5) * fx));
        out.set(src.subarray((sy * sw + sx) * 4, (sy * sw + sx) * 4 + 4), (y * dw + x) * 4);
      }
    }
    return out;
  }
  if (filter === D3DX_FILTER.BOX || filter === D3DX_FILTER.TRIANGLE) {
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * fy)));
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * fx)));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const o = (yy * sw + xx) * 4; r += src[o]!; g += src[o + 1]!; b += src[o + 2]!; a += src[o + 3]!; n++; }
        const d = (y * dw + x) * 4;
        out[d] = Math.round(r / n); out[d + 1] = Math.round(g / n); out[d + 2] = Math.round(b / n); out[d + 3] = Math.round(a / n);
      }
    }
    return out;
  }
  for (let y = 0; y < dh; y++) {
    const v = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(v), y1 = Math.min(sh - 1, y0 + 1), ty = v - y0;
    for (let x = 0; x < dw; x++) {
      const u = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(u), x1 = Math.min(sw - 1, x0 + 1), tx = u - x0;
      for (let c = 0; c < 4; c++) {
        const a = src[(y0 * sw + x0) * 4 + c]! * (1 - tx) + src[(y0 * sw + x1) * 4 + c]! * tx;
        const b = src[(y1 * sw + x0) * 4 + c]! * (1 - tx) + src[(y1 * sw + x1) * 4 + c]! * tx;
        out[(y * dw + x) * 4 + c] = Math.round(a * (1 - ty) + b * ty);
      }
    }
  }
  return out;
}

/** Next mip level: 2x2 box average (edges clamp), the D3DX default mip filter. */
export function halveRgba(src: Uint8Array, w: number, h: number): Uint8Array {
  return resizeRgba(src, w, h, Math.max(1, w >> 1), Math.max(1, h >> 1), D3DX_FILTER.BOX);
}

// ------------------------------------------------------------------------------------------------ texture creation
export interface TextureFromFile { hr: number; tex: Direct3DTexture9 | null; info: D3DXImageInfo | null }

export function D3DXCreateTextureFromFileInMemoryEx(
  device: Direct3DDevice9, data: Uint8Array, width: number, height: number, mipLevels: number, usage: number, format: number, pool: number,
  filter: number, mipFilter: number, colorKey: number,
): TextureFromFile {
  const { hr: ihr, info } = D3DXGetImageInfoFromFileInMemory(data);
  if (ihr < 0 || !info) return { hr: ihr, tex: null, info: null };
  let img: DecodedImage;
  try { img = decodeImage(data); } catch (e) {
    if (e instanceof ImageFormatError) return { hr: e.container === "jpeg" ? D3DERR_NOTAVAILABLE : D3DXERR_INVALIDDATA, tex: null, info };
    throw e;
  }
  const w = width === 0 || width >= D3DX_DEFAULT_NONPOW2 ? img.width : width;
  const h = height === 0 || height >= D3DX_DEFAULT_NONPOW2 ? img.height : height;
  let fmt = format === D3DFMT.UNKNOWN || format >= D3DX_DEFAULT_NONPOW2 ? FMT_BY_NAME[img.format] : format;
  if (fmt === D3DFMT.UNKNOWN) fmt = D3DFMT.A8R8G8B8;
  const chk = D3DXCheckTextureRequirements(device, w, h, mipLevels, usage, fmt, pool);
  // compressed targets: only block-for-block copies of DDS data are possible (see the file header)
  const srcIsDxt = img.container === "dds" && formatInfo(FMT_BY_NAME[img.format])?.compressed === true;
  let targetFormat = chk.format;
  if (formatInfo(targetFormat)?.compressed && !(srcIsDxt && targetFormat === FMT_BY_NAME[img.format] && w === img.width && h === img.height)) targetFormat = D3DFMT.A8R8G8B8;
  let levels = chk.mipLevels;
  const ddsMips = img.container === "dds" ? Math.max(1, readDdsHeader(data).mipCount) : 1;
  const native = formatInfo(targetFormat)?.compressed === true;
  if (native) levels = Math.min(levels, ddsMips);
  const { hr, tex } = device.CreateTexture(chk.width, chk.height, levels, usage === D3DX_DEFAULT ? 0 : usage, targetFormat, pool === D3DX_DEFAULT ? D3DPOOL.MANAGED : pool);
  if (hr < 0 || !tex) return { hr, tex: null, info };
  if (native) {
    // DDS payload: magic + 124 byte header (+ 20 bytes of DX10 extension), then the levels from the largest down
    const hdr = readDdsHeader(data);
    let off = 128 + (hdr.pf.fourCC === 0x30315844 ? 20 : 0);
    for (let l = 0; l < ddsMips; l++) {
      const lw = mipSize(hdr.width, l), lh = mipSize(hdr.height, l);
      const bytes = surfaceBytes(targetFormat, lw, lh);
      if (l < tex.levels) {
        const lk = tex.LockRect(l, null, 0);
        if (lk.hr < 0 || !lk.pBits) return { hr: lk.hr, tex: null, info };
        lk.pBits.set(data.subarray(off, off + bytes));
        tex.UnlockRect(l);
      }
      off += bytes;
    }
    return { hr: D3D_OK, tex, info };
  }
  let rgba = img.rgba;
  if (colorKey !== 0) {
    rgba = new Uint8Array(rgba);
    const kr = (colorKey >>> 16) & 255, kg = (colorKey >>> 8) & 255, kb = colorKey & 255, ka = (colorKey >>> 24) & 255;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i] === kr && rgba[i + 1] === kg && rgba[i + 2] === kb && rgba[i + 3] === ka) rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
  }
  let level = resizeRgba(rgba, img.width, img.height, chk.width, chk.height, filter === 0 || filter >= D3DX_DEFAULT_NONPOW2 ? D3DX_FILTER.TRIANGLE : filter);
  tex.setLevelFromRgba8(0, level);
  // lower levels (the exe asks for exactly one level; other callers get the D3DX default box filter)
  void mipFilter;
  for (let l = 1; l < tex.levels; l++) {
    level = halveRgba(level, mipSize(chk.width, l - 1), mipSize(chk.height, l - 1));
    tex.setLevelFromRgba8(l, level);
  }
  return { hr: D3D_OK, tex, info };
}

/** `D3DXCreateTexture`: CheckTextureRequirements, then CreateTexture. */
export function D3DXCreateTexture(device: Direct3DDevice9, width: number, height: number, mipLevels: number, usage: number, format: number, pool: number): { hr: number; tex: Direct3DTexture9 | null } {
  const c = D3DXCheckTextureRequirements(device, width, height, mipLevels, usage, format, pool);
  if (c.hr < 0) return { hr: c.hr, tex: null };
  return device.CreateTexture(c.width, c.height, c.mipLevels, usage === D3DX_DEFAULT ? 0 : usage, c.format, pool === D3DX_DEFAULT ? D3DPOOL.MANAGED : pool);
}

/**
 * `D3DXSaveSurfaceToFileW` to memory.  PNG is written natively; the exe only asks for JPEG (the crash screenshot), which this layer
 * writes as PNG data (the platform layer may re-encode it).
 */
export async function D3DXSaveSurfaceToFileInMemory(device: Direct3DDevice9, fileFormat: number, surface: Direct3DSurface9): Promise<{ hr: number; data: Uint8Array | null; format: number }> {
  if (fileFormat !== D3DXIFF.PNG && fileFormat !== D3DXIFF.JPG) return { hr: D3DERR_INVALIDCALL, data: null, format: fileFormat };
  const px = await device.readPixels(surface);
  return { hr: D3D_OK, data: encodePng(px.rgba, px.width, px.height), format: D3DXIFF.PNG };
}

/** `ID3DXBuffer` (D3DXCreateBuffer): a byte array with the two COM accessors. */
export class D3DXBuffer {
  readonly data: Uint8Array;
  constructor(size: number) { this.data = new Uint8Array(size); }
  GetBufferPointer(): Uint8Array { return this.data; }
  GetBufferSize(): number { return this.data.length; }
}
export const D3DXCreateBuffer = (size: number): { hr: number; buffer: D3DXBuffer } => ({ hr: D3D_OK, buffer: new D3DXBuffer(size) });
export const D3DXCheckVersion = (_d3dSdkVersion: number, _d3dxSdkVersion: number): boolean => true;

export { surfacePitch, fromRgba8 };
