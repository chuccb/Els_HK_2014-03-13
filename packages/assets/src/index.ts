/** `@els/assets`: decoders for the client's asset formats (images first; see docs/ROADMAP.md Phase 2). */
export { ImageFormatError, sniffImage } from "./image.ts";
export type { DecodedImage, ImageContainer, SourceFormat } from "./image.ts";
export { decodeTga, readTgaHeader } from "./tga.ts";
export type { TgaHeader } from "./tga.ts";
export { decodeDds, decodeBc1, decodeBc2, decodeBc3, readDdsHeader, ddsSourceFormat } from "./dds.ts";
export type { DdsHeader, DdsPixelFormat } from "./dds.ts";
export { decodeBmp } from "./bmp.ts";
export { decodePng } from "./png.ts";
export { decompressXFile, isCompressedXFile, MszipError } from "./mszip.ts";
export { parseXFile, XFileError } from "./xfile.ts";
export { parseKme, parseKsm, parseKac, fvfVertexSize, KFormatError } from "./ksm.ts";
export { parseEss, parseEssWithDiagnostics, StringTable, formatDefaultDouble, formatFixed } from "./ess.ts";
export type { ReplaceArg, EssDiagnostics } from "./ess.ts";
export type { KmeMesh, KsmFile, KsmFrame, KsmMeshContainer, KsmBone, KacFile, KacAnimationSet, KacAnimation, KMaterial, KMeshData } from "./ksm.ts";
export type { XFile, XNode, XObject, XReference, XTemplate, XTemplateMember, XValue } from "./xfile.ts";
export { compareIgnoreCase, parseTet, parseXet, readFormatString, TET_MAGIC, XET_MAGIC } from "./xet.ts";
export type { TetFile, TetRect, XetAniData, XetAniEvent, XetChangeTexture, XetFile, XetMultiStage } from "./xet.ts";

import { ImageFormatError, sniffImage } from "./image.ts";
import type { DecodedImage } from "./image.ts";
import { decodeBmp } from "./bmp.ts";
import { decodeDds } from "./dds.ts";
import { decodePng } from "./png.ts";
import { decodeTga } from "./tga.ts";

/**
 * Decode an image the way `D3DXCreateTextureFromFileInMemoryEx` sees it: the container comes from the content (not the file
 * name) and the result is level 0 as RGBA8. JPEG (2 files, both named `temp*.tga`) is not decoded here; the browser client can
 * use `createImageBitmap` for it.
 */
export function decodeImage(bytes: Uint8Array): DecodedImage {
  switch (sniffImage(bytes)) {
    case "dds": return decodeDds(bytes);
    case "tga": return decodeTga(bytes);
    case "bmp": return decodeBmp(bytes);
    case "png": return decodePng(bytes);
    case "jpeg": throw new ImageFormatError("JPEG is decoded by the platform (createImageBitmap), not by @els/assets", "jpeg");
    default: throw new ImageFormatError(`unrecognised image data (${bytes.length} bytes)`);
  }
}
