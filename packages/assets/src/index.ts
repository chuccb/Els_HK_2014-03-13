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
export { Kim, KimFormatError, KIM_MAGIC, KIM_VERSION, UNIT_TYPE, decodeItemFlags, itemNameColor, setItemOptions, frameOffsetFor, renderRotateFor, renderScaleFor, commonItemModelNameFor, commonItemXETNameFor, slashTraceColors } from "./kim.ts";
export type { KimItem, KimSetItem, KimItemFlags, KimVec3, KimStat, KimStatRelLV, KimSpecialAbility, KimAttachedParticle, KimAttachedMesh, KimPerUnit, KimSlashTrace, KimColor, KimOpenOptions } from "./kim.ts";
export {
  EffectScriptError, MsvcRand, randomNumber, randomInt, tokenize as tokenizeEffectScript, catof, removeQuotes, cInt, f32, DEG2RAD,
  D3DBLEND_NAMES, D3DCULL_NAMES, BILLBOARD_TYPES, RENDER_TYPES, EFFECT_SYSTEMS,
} from "./effectscript.ts";
export type { Token, TokenType, MinMax, Range, Vec2, Vec3, Color4, ScriptKind, ScriptStats, EffectSystem } from "./effectscript.ts";
export {
  parseParticleScript, classifyParticleToken, newParticleSequence, ParticleLibrary, PARTICLE_TYPES, PARTICLE_MESH_RENDER_TYPES,
  PARTICLE_EVENT_TYPES, PARTICLE_PROPERTY_NAMES,
} from "./particle.ts";
export type { ParticleScript, ParticleSequence, ParticleEvent, ParticleEventKind } from "./particle.ts";
export {
  parseXMeshPlayerScript, classifyXMeshToken, newXMeshTemplet, XMeshLibrary, XMESH_LIFE_TYPES, XMESH_MESH_TYPES,
  XMESH_CARTOON_TEX_TYPES, XSKIN_ANIM_PLAYTYPES, XMESH_EVENT_TYPES, XMESH_PROPERTY_NAMES,
} from "./xmeshplayer.ts";
export type { XMeshPlayerScript, XMeshTemplet, XMeshEvent, XMeshEventKind } from "./xmeshplayer.ts";
