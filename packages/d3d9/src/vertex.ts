/**
 * Vertex formats: D3DFVF codes and D3DVERTEXELEMENT9 declarations -> a neutral element list -> WebGPU vertex buffer layouts.
 *
 * Every attribute is bound to a fixed shader location by its semantic (see `LOC`) so that one generated shader works for any
 * buffer layout that supplies the same semantics.  D3DCOLOR is stored as bytes B,G,R,A, so it is fetched as `unorm8x4` and
 * swizzled in the shader (`.zyxw`); that is the only attribute type that needs a swizzle.
 */
import { D3DDECLTYPE, D3DDECLUSAGE } from "./enums.ts";
import { D3DFVF } from "./enums.ts";

/** D3DVERTEXELEMENT9. */
export interface VertexElement { stream: number; offset: number; type: number; method: number; usage: number; usageIndex: number }

export const DECL_END: VertexElement = { stream: 0xff, offset: 0, type: D3DDECLTYPE.UNUSED, method: 0, usage: 0, usageIndex: 0 };

interface DeclTypeInfo { size: number; gpu: GPUVertexFormat; /** WGSL scalar class of the attribute. */ kind: "f32" | "u32" | "i32"; components: number; /** value must be swizzled from BGRA. */ bgra?: boolean }

/** D3DDECLTYPE -> byte size, WebGPU format and component class (null where WebGPU has no equivalent). */
export const DECL_TYPES: Record<number, DeclTypeInfo | null> = {
  [D3DDECLTYPE.FLOAT1]: { size: 4, gpu: "float32", kind: "f32", components: 1 },
  [D3DDECLTYPE.FLOAT2]: { size: 8, gpu: "float32x2", kind: "f32", components: 2 },
  [D3DDECLTYPE.FLOAT3]: { size: 12, gpu: "float32x3", kind: "f32", components: 3 },
  [D3DDECLTYPE.FLOAT4]: { size: 16, gpu: "float32x4", kind: "f32", components: 4 },
  [D3DDECLTYPE.D3DCOLOR]: { size: 4, gpu: "unorm8x4", kind: "f32", components: 4, bgra: true },
  [D3DDECLTYPE.UBYTE4]: { size: 4, gpu: "uint8x4", kind: "u32", components: 4 },
  [D3DDECLTYPE.SHORT2]: { size: 4, gpu: "sint16x2", kind: "i32", components: 2 },
  [D3DDECLTYPE.SHORT4]: { size: 8, gpu: "sint16x4", kind: "i32", components: 4 },
  [D3DDECLTYPE.UBYTE4N]: { size: 4, gpu: "unorm8x4", kind: "f32", components: 4 },
  [D3DDECLTYPE.SHORT2N]: { size: 4, gpu: "snorm16x2", kind: "f32", components: 2 },
  [D3DDECLTYPE.SHORT4N]: { size: 8, gpu: "snorm16x4", kind: "f32", components: 4 },
  [D3DDECLTYPE.USHORT2N]: { size: 4, gpu: "unorm16x2", kind: "f32", components: 2 },
  [D3DDECLTYPE.USHORT4N]: { size: 8, gpu: "unorm16x4", kind: "f32", components: 4 },
  [D3DDECLTYPE.UDEC3]: null,
  [D3DDECLTYPE.DEC3N]: null,
  [D3DDECLTYPE.FLOAT16_2]: { size: 4, gpu: "float16x2", kind: "f32", components: 2 },
  [D3DDECLTYPE.FLOAT16_4]: { size: 8, gpu: "float16x4", kind: "f32", components: 4 },
};

export function declTypeSize(type: number): number {
  const i = DECL_TYPES[type];
  if (!i) throw new Error(`unsupported D3DDECLTYPE ${type}`);
  return i.size;
}

/** Semantic -> shader location (16 attribute slots in WebGPU's default limits). */
export const LOC = {
  POSITION: 0, BLENDWEIGHT: 1, BLENDINDICES: 2, NORMAL: 3, PSIZE: 4, COLOR0: 5, COLOR1: 6, TEXCOORD0: 7, // TEXCOORD0..7 = 7..14
  TANGENT: 15,
} as const;

/** The shader location for (usage, index), or -1 when the semantic cannot be mapped (the element is then ignored). */
export function semanticLocation(usage: number, index: number): number {
  switch (usage) {
    case D3DDECLUSAGE.POSITION: case D3DDECLUSAGE.POSITIONT: return index === 0 ? LOC.POSITION : -1;
    case D3DDECLUSAGE.BLENDWEIGHT: return index === 0 ? LOC.BLENDWEIGHT : -1;
    case D3DDECLUSAGE.BLENDINDICES: return index === 0 ? LOC.BLENDINDICES : -1;
    case D3DDECLUSAGE.NORMAL: return index === 0 ? LOC.NORMAL : -1;
    case D3DDECLUSAGE.PSIZE: return index === 0 ? LOC.PSIZE : -1;
    case D3DDECLUSAGE.COLOR: return index === 0 ? LOC.COLOR0 : index === 1 ? LOC.COLOR1 : -1;
    case D3DDECLUSAGE.TEXCOORD: return index < 8 ? LOC.TEXCOORD0 + index : -1;
    case D3DDECLUSAGE.TANGENT: return index === 0 ? LOC.TANGENT : -1;
    default: return -1;
  }
}

/** Number of floats a position takes (and whether it is pre-transformed) for an FVF. */
export function fvfPositionInfo(fvf: number): { kind: "none" | "xyz" | "xyzrhw" | "xyzw" | "xyzb"; floats: number; betas: number } {
  switch (fvf & D3DFVF.POSITION_MASK) {
    case D3DFVF.XYZ: return { kind: "xyz", floats: 3, betas: 0 };
    case D3DFVF.XYZRHW: return { kind: "xyzrhw", floats: 4, betas: 0 };
    case D3DFVF.XYZW: return { kind: "xyzw", floats: 4, betas: 0 };
    case D3DFVF.XYZB1: return { kind: "xyzb", floats: 3, betas: 1 };
    case D3DFVF.XYZB2: return { kind: "xyzb", floats: 3, betas: 2 };
    case D3DFVF.XYZB3: return { kind: "xyzb", floats: 3, betas: 3 };
    case D3DFVF.XYZB4: return { kind: "xyzb", floats: 3, betas: 4 };
    case D3DFVF.XYZB5: return { kind: "xyzb", floats: 3, betas: 5 };
    default: return { kind: "none", floats: 0, betas: 0 };
  }
}

/** Components of texture-coordinate set `i` from the FVF size bits (default 2). */
export function fvfTexCoordComponents(fvf: number, i: number): 1 | 2 | 3 | 4 {
  switch ((fvf >>> (16 + i * 2)) & 3) { case 0: return 2; case 1: return 3; case 2: return 4; default: return 1; }
}

/** `D3DXGetFVFVertexSize`. */
export function fvfVertexSize(fvf: number): number {
  const p = fvfPositionInfo(fvf);
  let size = p.floats * 4;
  if (p.kind === "xyzb") {
    size += (fvf & (D3DFVF.LASTBETA_UBYTE4 | D3DFVF.LASTBETA_D3DCOLOR)) ? (p.betas - 1) * 4 + 4 : p.betas * 4;
  }
  if (fvf & D3DFVF.NORMAL) size += 12;
  if (fvf & D3DFVF.PSIZE) size += 4;
  if (fvf & D3DFVF.DIFFUSE) size += 4;
  if (fvf & D3DFVF.SPECULAR) size += 4;
  const n = (fvf & D3DFVF.TEXCOUNT_MASK) >> D3DFVF.TEXCOUNT_SHIFT;
  for (let i = 0; i < n; i++) size += fvfTexCoordComponents(fvf, i) * 4;
  return size;
}

/** The declaration D3D9 derives from an FVF (single stream 0). */
export function fvfToElements(fvf: number): { elements: VertexElement[]; stride: number } {
  const elements: VertexElement[] = [];
  let off = 0;
  const add = (type: number, usage: number, usageIndex: number): void => {
    elements.push({ stream: 0, offset: off, type, method: 0, usage, usageIndex });
    off += declTypeSize(type);
  };
  const p = fvfPositionInfo(fvf);
  if (p.kind === "xyz" || p.kind === "xyzb") add(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.POSITION, 0);
  else if (p.kind === "xyzrhw") add(D3DDECLTYPE.FLOAT4, D3DDECLUSAGE.POSITIONT, 0);
  else if (p.kind === "xyzw") add(D3DDECLTYPE.FLOAT4, D3DDECLUSAGE.POSITION, 0);
  if (p.kind === "xyzb" && p.betas > 0) {
    const lastBeta = (fvf & D3DFVF.LASTBETA_UBYTE4) ? D3DDECLTYPE.UBYTE4 : (fvf & D3DFVF.LASTBETA_D3DCOLOR) ? D3DDECLTYPE.D3DCOLOR : 0;
    const weights = lastBeta ? p.betas - 1 : p.betas;
    if (weights > 0) add([0, D3DDECLTYPE.FLOAT1, D3DDECLTYPE.FLOAT2, D3DDECLTYPE.FLOAT3, D3DDECLTYPE.FLOAT4][weights] ?? D3DDECLTYPE.FLOAT4, D3DDECLUSAGE.BLENDWEIGHT, 0);
    if (lastBeta) add(lastBeta, D3DDECLUSAGE.BLENDINDICES, 0);
  }
  if (fvf & D3DFVF.NORMAL) add(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.NORMAL, 0);
  if (fvf & D3DFVF.PSIZE) add(D3DDECLTYPE.FLOAT1, D3DDECLUSAGE.PSIZE, 0);
  if (fvf & D3DFVF.DIFFUSE) add(D3DDECLTYPE.D3DCOLOR, D3DDECLUSAGE.COLOR, 0);
  if (fvf & D3DFVF.SPECULAR) add(D3DDECLTYPE.D3DCOLOR, D3DDECLUSAGE.COLOR, 1);
  const n = (fvf & D3DFVF.TEXCOUNT_MASK) >> D3DFVF.TEXCOUNT_SHIFT;
  for (let i = 0; i < n; i++) add([0, D3DDECLTYPE.FLOAT1, D3DDECLTYPE.FLOAT2, D3DDECLTYPE.FLOAT3, D3DDECLTYPE.FLOAT4][fvfTexCoordComponents(fvf, i)]!, D3DDECLUSAGE.TEXCOORD, i);
  return { elements, stride: off };
}

/** One attribute the shader will read. */
export interface LayoutAttribute { location: number; format: GPUVertexFormat; kind: "f32" | "u32" | "i32"; bgra: boolean; components: number; usage: number; usageIndex: number }

export interface BufferLayout { stream: number; stride: number; attributes: (LayoutAttribute & { offset: number })[] }

/**
 * Group the elements by stream into WebGPU buffer layouts.  `strides[stream]` is the stride of the bound stream; elements whose
 * semantic has no shader location, or whose stream is unbound, are dropped.
 */
export function buildLayouts(elements: readonly VertexElement[], strides: ReadonlyMap<number, number>): BufferLayout[] {
  const byStream = new Map<number, BufferLayout>();
  for (const e of elements) {
    const loc = semanticLocation(e.usage, e.usageIndex);
    const info = DECL_TYPES[e.type];
    const stride = strides.get(e.stream);
    if (loc < 0 || !info || stride === undefined) continue;
    let l = byStream.get(e.stream);
    if (!l) { l = { stream: e.stream, stride, attributes: [] }; byStream.set(e.stream, l); }
    l.attributes.push({ location: loc, format: info.gpu, kind: info.kind, bgra: !!info.bgra, components: info.components, usage: e.usage, usageIndex: e.usageIndex, offset: e.offset });
  }
  return [...byStream.values()].sort((a, b) => a.stream - b.stream);
}

/** A string that identifies everything about a layout the generated shader depends on (semantic, format class). */
export function layoutSignature(layouts: readonly BufferLayout[]): string {
  const parts: string[] = [];
  for (const l of layouts) for (const a of l.attributes) parts.push(`${a.location}:${a.format}`);
  return parts.sort().join(",");
}
