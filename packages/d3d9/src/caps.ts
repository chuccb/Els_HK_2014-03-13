/**
 * D3DCAPS9 of the device we present.  The exe reads very little of it (MaxPrimitiveCount and MaxVertexShaderConst in the game code,
 * DevCaps / TextureCaps / PresentationIntervals / shader versions in the DXUT device selection), so this describes a typical
 * hardware-vertex-processing Shader Model 3 HAL device, with the limits of what the WebGPU backend can really do.
 */
import { D3DDEVTYPE } from "./enums.ts";

export interface D3DCAPS9 {
  DeviceType: number; AdapterOrdinal: number;
  Caps: number; Caps2: number; Caps3: number; PresentationIntervals: number; CursorCaps: number; DevCaps: number;
  PrimitiveMiscCaps: number; RasterCaps: number; ZCmpCaps: number; SrcBlendCaps: number; DestBlendCaps: number; AlphaCmpCaps: number;
  ShadeCaps: number; TextureCaps: number; TextureFilterCaps: number; CubeTextureFilterCaps: number; VolumeTextureFilterCaps: number;
  TextureAddressCaps: number; VolumeTextureAddressCaps: number; LineCaps: number;
  MaxTextureWidth: number; MaxTextureHeight: number; MaxVolumeExtent: number; MaxTextureRepeat: number; MaxTextureAspectRatio: number; MaxAnisotropy: number;
  MaxVertexW: number; GuardBandLeft: number; GuardBandTop: number; GuardBandRight: number; GuardBandBottom: number; ExtentsAdjust: number;
  StencilCaps: number; FVFCaps: number; TextureOpCaps: number; MaxTextureBlendStages: number; MaxSimultaneousTextures: number;
  VertexProcessingCaps: number; MaxActiveLights: number; MaxUserClipPlanes: number; MaxVertexBlendMatrices: number; MaxVertexBlendMatrixIndex: number;
  MaxPointSize: number; MaxPrimitiveCount: number; MaxVertexIndex: number; MaxStreams: number; MaxStreamStride: number;
  VertexShaderVersion: number; MaxVertexShaderConst: number; PixelShaderVersion: number; PixelShader1xMaxValue: number;
  DevCaps2: number; MaxNpatchTessellationLevel: number; MasterAdapterOrdinal: number; AdapterOrdinalInGroup: number; NumberOfAdaptersInGroup: number;
  DeclTypes: number; NumSimultaneousRTs: number; StretchRectFilterCaps: number; VertexTextureFilterCaps: number;
  MaxVShaderInstructionsExecuted: number; MaxPShaderInstructionsExecuted: number; MaxVertexShader30InstructionSlots: number; MaxPixelShader30InstructionSlots: number;
}

/** d3d9caps.h bit values used below. */
const DEVCAPS = 0x10 | 0x20 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800 | 0x1000 | 0x2000 | 0x8000 | 0x10000 | 0x20000 | 0x80000 | 0x100000;
const PRASTERCAPS = 0x1 /* DITHER */ | 0x8 /* ZTEST */ | 0x10 /* FOGVERTEX */ | 0x20 /* FOGTABLE */ | 0x80 /* MIPMAPLODBIAS */ | 0x100 /* ZBUFFERLESSHSR */ | 0x400 /* FOGRANGE */ | 0x1000 /* ANISOTROPY */ | 0x4000 /* WFOG */ | 0x8000 /* ZFOG */ | 0x10000 /* COLORPERSPECTIVE */ | 0x20000 /* SCISSORTEST */ | 0x40000 /* SLOPESCALEDEPTHBIAS */ | 0x200000 /* DEPTHBIAS */;
const CMPCAPS = 0xff;
const BLENDCAPS = 0x1fff;
const TEXOPCAPS = 0x3ffffff & ~0; // every D3DTOP up to LERP

export function defaultCaps(): D3DCAPS9 {
  return {
    DeviceType: D3DDEVTYPE.HAL, AdapterOrdinal: 0,
    Caps: 0x20000, Caps2: 0x20000000 | 0x40000000 | 0x20000, Caps3: 0x20 | 0x80 | 0x100 | 0x200, PresentationIntervals: 0x80000000 | 1 | 2 | 4 | 8, CursorCaps: 1 | 2, DevCaps: DEVCAPS,
    PrimitiveMiscCaps: 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x80 | 0x400 | 0x800 | 0x1000 | 0x4000 | 0x20000 | 0x40000,
    RasterCaps: PRASTERCAPS, ZCmpCaps: CMPCAPS, SrcBlendCaps: BLENDCAPS, DestBlendCaps: BLENDCAPS, AlphaCmpCaps: CMPCAPS, ShadeCaps: 0x8 | 0x20 | 0x200 | 0x4000,
    // ALPHA | PERSPECTIVE | MIPMAP | PROJECTED | CUBEMAP | VOLUMEMAP | NONPOW2CONDITIONAL | MIPCUBEMAP | MIPVOLUMEMAP
    TextureCaps: 0x4 | 0x1 | 0x8 | 0x400 | 0x800 | 0x2000 | 0x100 /* NONPOW2CONDITIONAL */ | 0x10000 | 0x8000,
    TextureFilterCaps: 0x100 | 0x200 | 0x400 | 0x1000000 | 0x2000000 | 0x4000000 | 0x10000000 | 0x20000000 | 0x40000000, CubeTextureFilterCaps: 0x2000000 | 0x4000000, VolumeTextureFilterCaps: 0x2000000 | 0x4000000,
    TextureAddressCaps: 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20, VolumeTextureAddressCaps: 0x3f, LineCaps: 0x1 | 0x2 | 0x4 | 0x8 | 0x10,
    MaxTextureWidth: 8192, MaxTextureHeight: 8192, MaxVolumeExtent: 2048, MaxTextureRepeat: 8192, MaxTextureAspectRatio: 8192, MaxAnisotropy: 16,
    MaxVertexW: 1e10, GuardBandLeft: -32768, GuardBandTop: -32768, GuardBandRight: 32768, GuardBandBottom: 32768, ExtentsAdjust: 0,
    StencilCaps: 0xff, FVFCaps: 8 | 0x40000 /* 8 texcoord sets | DONOTSTRIPELEMENTS */, TextureOpCaps: TEXOPCAPS, MaxTextureBlendStages: 8, MaxSimultaneousTextures: 8,
    VertexProcessingCaps: 0x1 | 0x2 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80 | 0x100, MaxActiveLights: 8, MaxUserClipPlanes: 6, MaxVertexBlendMatrices: 4, MaxVertexBlendMatrixIndex: 0,
    MaxPointSize: 8192, MaxPrimitiveCount: 0xfffff, MaxVertexIndex: 0xffffff, MaxStreams: 16, MaxStreamStride: 508,
    VertexShaderVersion: 0xfffe0300, MaxVertexShaderConst: 256, PixelShaderVersion: 0xffff0300, PixelShader1xMaxValue: 1e10,
    DevCaps2: 0x1 | 0x2 | 0x10 | 0x20 | 0x40, MaxNpatchTessellationLevel: 1, MasterAdapterOrdinal: 0, AdapterOrdinalInGroup: 0, NumberOfAdaptersInGroup: 1,
    DeclTypes: 0x3ff, NumSimultaneousRTs: 1, StretchRectFilterCaps: 0x100 | 0x200 | 0x1000000 | 0x2000000, VertexTextureFilterCaps: 0x2000000 | 0x4000000,
    MaxVShaderInstructionsExecuted: 65535, MaxPShaderInstructionsExecuted: 65535, MaxVertexShader30InstructionSlots: 32768, MaxPixelShader30InstructionSlots: 32768,
  };
}
