/**
 * Programmable vertex stage for the layer.
 *
 * D3D9 takes vs_1_1 / vs_2_0 byte code in `CreateVertexShader`; this layer has no byte code at all.  The only shaders the exe ever uses
 * are the `vs_1_1` vertex shaders of XRenderer.fx (docs/FINDINGS.md 12.1), which a D3DX effect hands to the device through
 * `ID3DXEffectStateManager::SetVertexShader`, so a shader here is an *emulated* one: WGSL written (or generated, see
 * `xrenderer-shaders.ts`) from the HLSL of the shipped file.  The device contract stays Direct3D's:
 *
 *  - `SetVertexShader(shader)` replaces the fixed-function transform / lighting / texture-coordinate generation.  World / view /
 *    projection, material, lights and texture transforms are ignored, the viewport transform is applied to what the shader writes.
 *  - `SetVertexShaderConstantF(start, data, count)` fills the register file `c0 .. c255` (float4 each); WGSL reads it as `vc[n]`.
 *  - The pixel stage stays fixed-function: stage `i` reads the texture coordinate output `oT[i]` (`TEXCOORDINDEX` and the texture
 *    transform belong to the fixed-function vertex stage and do not apply), `Diffuse` / `Specular` are `oD0` / `oD1` (saturated),
 *    and fog comes from `oFog` (1 = no fog) when `FOGENABLE` is set, `FOGVERTEXMODE` is not NONE and the shader writes it.
 *
 * The vertex inputs are what the vertex declaration (or FVF) supplies, by semantic; a semantic that is missing reads (0, 0, 0, 1).
 * D3DCOLOR elements arrive as (r, g, b, a) in [0, 1] like on D3D9 hardware (so `D3DCOLORtoUBYTE4(v) = v.zyxw * 255.001953`), UBYTE4 as
 * floats 0..255.
 */

/** Number of float4 constant registers (`D3DCAPS9::MaxVertexShaderConst` of the emulated device is 256). */
export const VS_REGISTERS = 256;

export interface EmulatedVertexShader {
  /** unique per shader body (it is part of the program cache key) */
  readonly name: string;
  /**
   * WGSL that defines `fn user_vs(i: SIn) -> SOut`.  Provided by the device:
   *   struct SIn  { pos, weights, indices, normal, psize, color0, color1, tangent: vec4f, tex: array<vec4f, 8> }
   *   struct SOut { pos, c0, c1: vec4f, t: array<vec4f, 8>, fog: f32 }      (all zero-initialised with `var o: SOut;`)
   *   var<uniform> vc: array<vec4f, 256>                                     (the constant registers)
   */
  readonly wgsl: string;
  /** which outputs the shader writes (the others read as 0) */
  readonly writes: { readonly diffuse: boolean; readonly specular: boolean; readonly fog: boolean; readonly texCoords: number };
}

/** `IDirect3DVertexShader9` of an emulated shader. */
export class Direct3DVertexShader9 {
  private refs = 1;
  constructor(readonly def: EmulatedVertexShader) {}
  AddRef(): number { return ++this.refs; }
  Release(): number { return this.refs > 0 ? --this.refs : 0; }
}

/** The structs and the constant register file every emulated shader is compiled with. */
export const VS_PRELUDE = /* wgsl */ `
struct SIn { pos: vec4f, weights: vec4f, indices: vec4f, normal: vec4f, psize: vec4f, color0: vec4f, color1: vec4f, tangent: vec4f, tex: array<vec4f, 8> }
struct SOut { pos: vec4f, c0: vec4f, c1: vec4f, t: array<vec4f, 8>, fog: f32 }
@group(0) @binding(3) var<uniform> vc: array<vec4f, ${VS_REGISTERS}>;
`;
