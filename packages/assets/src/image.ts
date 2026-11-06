/**
 * Common types for the decoded images the engine's texture loader (`CKTDXDeviceTexture`, x2.exe.c ~L423400) works with.
 *
 * The exe hands the file bytes to `D3DXGetImageInfoFromFileInMemory` + `D3DXCreateTextureFromFileInMemoryEx` with MipLevels = 1,
 * so (1) the container is recognised from the *content*, never from the file name (KOMs contain BMP, JPEG, PNG and TGA files named
 * `.tga` / `.dds`), and (2) only the top mip level is ever used. The decoders here therefore return level 0 as straight (not
 * premultiplied) RGBA8 with the first row at the top, which is what a WebGPU `rgba8unorm` texture expects.
 */

/** Source pixel format, named after the D3D9 format D3DX would report for the file (`D3DFMT_*`). */
export type SourceFormat =
  | "A8R8G8B8" | "X8R8G8B8" | "R8G8B8" | "A1R5G5B5" | "X1R5G5B5" | "R5G6B5" | "A4R4G4B4" | "L8" | "P8" | "A8L8"
  | "DXT1" | "DXT2" | "DXT3" | "DXT4" | "DXT5" | "OTHER";

export type ImageContainer = "tga" | "dds" | "bmp" | "png" | "jpeg";

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** width * height * 4 bytes, R G B A, first row = top of the picture */
  readonly rgba: Uint8Array;
  /** container the bytes were recognised as */
  readonly container: ImageContainer;
  /** D3D9 format name D3DX reports for this file; formats without an alpha channel decode with A = 255 */
  readonly format: SourceFormat;
  /** false when the format has no alpha channel (A is 255 everywhere) */
  readonly hasAlpha: boolean;
}

export class ImageFormatError extends Error {
  constructor(message: string, readonly container?: ImageContainer) {
    super(message);
    this.name = "ImageFormatError";
  }
}

/** Recognise the container from the content (D3DX does not look at the extension). TGA has no magic: it is the fallback. */
export function sniffImage(b: Uint8Array): ImageContainer | undefined {
  if (b.length >= 4 && b[0] === 0x44 && b[1] === 0x44 && b[2] === 0x53 && b[3] === 0x20) return "dds";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (looksLikeTga(b)) return "tga";
  return undefined;
}

function looksLikeTga(b: Uint8Array): boolean {
  if (b.length < 18) return false;
  const cmapType = b[1]!, type = b[2]!, bpp = b[16]!;
  if (cmapType > 1) return false;
  if (![1, 2, 3, 9, 10, 11].includes(type)) return false;
  const w = b[12]! | (b[13]! << 8), h = b[14]! | (b[15]! << 8);
  if (w === 0 || h === 0) return false;
  if (type === 1 || type === 9) return cmapType === 1 && bpp === 8;
  if (type === 3 || type === 11) return bpp === 8 || bpp === 16;
  return bpp === 15 || bpp === 16 || bpp === 24 || bpp === 32;
}
