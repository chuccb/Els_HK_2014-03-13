/** `@els/d3d9`: Direct3D 9 on WebGPU (docs/ROADMAP.md Phase 3). */
export * from "./enums.ts";
export * from "./hresult.ts";
export * from "./d3dx-math.ts";
export { FixedFunctionState, floatToDword, dwordToFloat, defaultRenderStates, defaultTextureStageStates, defaultSamplerStates, samplerSlot, NUM_STAGES, NUM_TSS, NUM_SAMP } from "./state.ts";
export type { Light, Material, Color4, Rect, Viewport as D3DViewport } from "./state.ts";
export { fvfToElements, fvfVertexSize, fvfPositionInfo, fvfTexCoordComponents, DECL_END, DECL_TYPES, declTypeSize, buildLayouts, semanticLocation } from "./vertex.ts";
export type { VertexElement, BufferLayout } from "./vertex.ts";
export { formatInfo, supportedFormats, surfacePitch, surfaceBytes, mipSize, toRgba8, fromRgba8 } from "./formats.ts";
export type { FormatInfo } from "./formats.ts";
export { Direct3DDevice9 } from "./device.ts";
export type { DeviceOptions } from "./device.ts";
export { Direct3DTexture9, Direct3DSurface9, Direct3DVertexBuffer9, Direct3DIndexBuffer9, Direct3DVertexDeclaration9 } from "./resources.ts";
export { generateWgsl, programKey } from "./ffp.ts";
export type { ProgramDesc, StageDesc } from "./ffp.ts";
export * from "./caps.ts";
export * from "./d3dx-texture.ts";
