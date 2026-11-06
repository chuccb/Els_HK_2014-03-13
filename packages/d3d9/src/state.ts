/**
 * The device state machine of `IDirect3DDevice9` (fixed-function part): render states, texture-stage states, sampler states,
 * transforms, lights, material, viewport.  Defaults are the Direct3D 9 defaults; they are exactly the values the client writes
 * back in CKTDGStateManager::RestoreDeviceObjects (tables aeDRS / aeDTSS / aeDSSS, x2.exe.c L140586..L140740), including the
 * float-valued states that the client patches in as raw IEEE bit patterns (D3DRS_FOGEND = 1.0f, ...).
 */
import { D3DBLEND, D3DBLENDOP, D3DCMP, D3DCULL, D3DFILL, D3DMCS, D3DRS, D3DSAMP, D3DSHADE, D3DSTENCILOP, D3DTA, D3DTADDRESS, D3DTEXF, D3DTOP, D3DTSS, D3DTS, D3DZB, D3DFOG, D3DVBF, D3DTSS_TCI } from "./enums.ts";
import { matIdentity } from "./d3dx-math.ts";
import type { Mat4 } from "./d3dx-math.ts";
import { VS_REGISTERS } from "./vshader.ts";
import type { Direct3DVertexShader9 } from "./vshader.ts";

const cvt = new DataView(new ArrayBuffer(4));
/** `*(DWORD *)&f` */
export function floatToDword(f: number): number { cvt.setFloat32(0, f, true); return cvt.getUint32(0, true); }
/** `*(float *)&dw` */
export function dwordToFloat(dw: number): number { cvt.setUint32(0, dw >>> 0, true); return cvt.getFloat32(0, true); }

export const NUM_RENDER_STATES = 256;
export const NUM_STAGES = 8;
export const NUM_TSS = 33;
/** 16 pixel samplers + displacement-map sampler (256) + 4 vertex samplers (257..260), as D3D9: mapped to slots 16, 17..20. */
export const NUM_SAMPLER_SLOTS = 21;
export const NUM_SAMP = 14;
export const MAX_LIGHTS_ACTIVE = 8;

export interface Color4 { r: number; g: number; b: number; a: number }
export interface Vec3f { x: number; y: number; z: number }

/** D3DMATERIAL9. */
export interface Material { diffuse: Color4; ambient: Color4; specular: Color4; emissive: Color4; power: number }

/** D3DLIGHT9. */
export interface Light {
  type: number; // D3DLIGHT_*
  diffuse: Color4; specular: Color4; ambient: Color4;
  position: Vec3f; direction: Vec3f;
  range: number; falloff: number; attenuation0: number; attenuation1: number; attenuation2: number; theta: number; phi: number;
}

export interface Viewport { x: number; y: number; width: number; height: number; minZ: number; maxZ: number }
export interface Rect { left: number; top: number; right: number; bottom: number }

const black = (): Color4 => ({ r: 0, g: 0, b: 0, a: 0 });
export const defaultMaterial = (): Material => ({ diffuse: black(), ambient: black(), specular: black(), emissive: black(), power: 0 });

/** The `aeDRS` table: every render state the client resets, with the value it resets it to. */
export function defaultRenderStates(hasDepthStencil = true): Uint32Array {
  const rs = new Uint32Array(NUM_RENDER_STATES);
  const one = floatToDword(1), sixtyFour = floatToDword(64);
  rs[D3DRS.ZENABLE] = hasDepthStencil ? D3DZB.TRUE : D3DZB.FALSE;
  rs[D3DRS.FILLMODE] = D3DFILL.SOLID;
  rs[D3DRS.SHADEMODE] = D3DSHADE.GOURAUD;
  rs[D3DRS.ZWRITEENABLE] = 1;
  rs[D3DRS.ALPHATESTENABLE] = 0;
  rs[D3DRS.LASTPIXEL] = 1;
  rs[D3DRS.SRCBLEND] = D3DBLEND.ONE;
  rs[D3DRS.DESTBLEND] = D3DBLEND.ZERO;
  rs[D3DRS.CULLMODE] = D3DCULL.CCW;
  rs[D3DRS.ZFUNC] = D3DCMP.LESSEQUAL;
  rs[D3DRS.ALPHAREF] = 0;
  rs[D3DRS.ALPHAFUNC] = D3DCMP.ALWAYS;
  rs[D3DRS.DITHERENABLE] = 0;
  rs[D3DRS.ALPHABLENDENABLE] = 0;
  rs[D3DRS.FOGENABLE] = 0;
  rs[D3DRS.SPECULARENABLE] = 0;
  rs[D3DRS.FOGCOLOR] = 0;
  rs[D3DRS.FOGTABLEMODE] = D3DFOG.NONE;
  rs[D3DRS.FOGSTART] = 0;
  rs[D3DRS.FOGEND] = one;
  rs[D3DRS.FOGDENSITY] = one;
  rs[D3DRS.RANGEFOGENABLE] = 0;
  rs[D3DRS.STENCILENABLE] = 0;
  rs[D3DRS.STENCILFAIL] = D3DSTENCILOP.KEEP;
  rs[D3DRS.STENCILZFAIL] = D3DSTENCILOP.KEEP;
  rs[D3DRS.STENCILPASS] = D3DSTENCILOP.KEEP;
  rs[D3DRS.STENCILFUNC] = D3DCMP.ALWAYS;
  rs[D3DRS.STENCILREF] = 0;
  rs[D3DRS.STENCILMASK] = 0xffffffff;
  rs[D3DRS.STENCILWRITEMASK] = 0xffffffff;
  rs[D3DRS.TEXTUREFACTOR] = 0xffffffff;
  for (let i = 0; i < 8; i++) rs[D3DRS.WRAP0 + i] = 0;
  for (let i = 8; i < 16; i++) rs[D3DRS.WRAP8 + i - 8] = 0;
  rs[D3DRS.CLIPPING] = 1;
  rs[D3DRS.LIGHTING] = 1;
  rs[D3DRS.AMBIENT] = 0;
  rs[D3DRS.FOGVERTEXMODE] = D3DFOG.NONE;
  rs[D3DRS.COLORVERTEX] = 1;
  rs[D3DRS.LOCALVIEWER] = 1;
  rs[D3DRS.NORMALIZENORMALS] = 0;
  rs[D3DRS.DIFFUSEMATERIALSOURCE] = D3DMCS.COLOR1;
  rs[D3DRS.SPECULARMATERIALSOURCE] = D3DMCS.COLOR2;
  rs[D3DRS.AMBIENTMATERIALSOURCE] = D3DMCS.MATERIAL;
  rs[D3DRS.EMISSIVEMATERIALSOURCE] = D3DMCS.MATERIAL;
  rs[D3DRS.VERTEXBLEND] = D3DVBF.DISABLE;
  rs[D3DRS.CLIPPLANEENABLE] = 0;
  rs[D3DRS.POINTSIZE] = one;
  rs[D3DRS.POINTSIZE_MIN] = one;
  rs[D3DRS.POINTSPRITEENABLE] = 0;
  rs[D3DRS.POINTSCALEENABLE] = 0;
  rs[D3DRS.POINTSCALE_A] = one;
  rs[D3DRS.POINTSCALE_B] = 0;
  rs[D3DRS.POINTSCALE_C] = 0;
  rs[D3DRS.MULTISAMPLEANTIALIAS] = 1;
  rs[D3DRS.MULTISAMPLEMASK] = 0xffffffff;
  rs[D3DRS.PATCHEDGESTYLE] = 0;
  rs[D3DRS.DEBUGMONITORTOKEN] = 0;
  rs[D3DRS.POINTSIZE_MAX] = sixtyFour;
  rs[D3DRS.INDEXEDVERTEXBLENDENABLE] = 0;
  rs[D3DRS.COLORWRITEENABLE] = 15;
  rs[D3DRS.TWEENFACTOR] = 0;
  rs[D3DRS.BLENDOP] = D3DBLENDOP.ADD;
  rs[D3DRS.POSITIONDEGREE] = 3;
  rs[D3DRS.NORMALDEGREE] = 1;
  rs[D3DRS.SCISSORTESTENABLE] = 0;
  rs[D3DRS.SLOPESCALEDEPTHBIAS] = 0;
  rs[D3DRS.ANTIALIASEDLINEENABLE] = 0;
  rs[D3DRS.MINTESSELLATIONLEVEL] = one;
  rs[D3DRS.MAXTESSELLATIONLEVEL] = one;
  rs[D3DRS.ADAPTIVETESS_X] = 0;
  rs[D3DRS.ADAPTIVETESS_Y] = 0;
  rs[D3DRS.ADAPTIVETESS_Z] = 0;
  rs[D3DRS.ADAPTIVETESS_W] = 0;
  rs[D3DRS.ENABLEADAPTIVETESSELLATION] = 0;
  rs[D3DRS.TWOSIDEDSTENCILMODE] = 0;
  rs[D3DRS.CCW_STENCILFAIL] = D3DSTENCILOP.KEEP;
  rs[D3DRS.CCW_STENCILZFAIL] = D3DSTENCILOP.KEEP;
  rs[D3DRS.CCW_STENCILPASS] = D3DSTENCILOP.KEEP;
  rs[D3DRS.CCW_STENCILFUNC] = D3DCMP.ALWAYS;
  rs[D3DRS.COLORWRITEENABLE1] = 15;
  rs[D3DRS.COLORWRITEENABLE2] = 15;
  rs[D3DRS.COLORWRITEENABLE3] = 15;
  rs[D3DRS.BLENDFACTOR] = 0xffffffff;
  rs[D3DRS.SRGBWRITEENABLE] = 0;
  rs[D3DRS.DEPTHBIAS] = 0;
  rs[D3DRS.SEPARATEALPHABLENDENABLE] = 0;
  rs[D3DRS.SRCBLENDALPHA] = D3DBLEND.ONE;
  rs[D3DRS.DESTBLENDALPHA] = D3DBLEND.ZERO;
  rs[D3DRS.BLENDOPALPHA] = D3DBLENDOP.ADD;
  return rs;
}

/** The `aeDTSS` table. `tss[stage * NUM_TSS + type]`. */
export function defaultTextureStageStates(): Uint32Array {
  const t = new Uint32Array(NUM_STAGES * NUM_TSS);
  for (let s = 0; s < NUM_STAGES; s++) {
    const o = s * NUM_TSS;
    t[o + D3DTSS.COLOROP] = s === 0 ? D3DTOP.MODULATE : D3DTOP.DISABLE;
    t[o + D3DTSS.COLORARG1] = D3DTA.TEXTURE;
    t[o + D3DTSS.COLORARG2] = D3DTA.CURRENT;
    t[o + D3DTSS.ALPHAOP] = s === 0 ? D3DTOP.SELECTARG1 : D3DTOP.DISABLE;
    t[o + D3DTSS.ALPHAARG1] = D3DTA.TEXTURE;
    t[o + D3DTSS.ALPHAARG2] = D3DTA.CURRENT;
    t[o + D3DTSS.BUMPENVMAT00] = 0;
    t[o + D3DTSS.BUMPENVMAT01] = 0;
    t[o + D3DTSS.BUMPENVMAT10] = 0;
    t[o + D3DTSS.BUMPENVMAT11] = 0;
    t[o + D3DTSS.TEXCOORDINDEX] = s;
    t[o + D3DTSS.BUMPENVLSCALE] = 0;
    t[o + D3DTSS.BUMPENVLOFFSET] = 0;
    t[o + D3DTSS.TEXTURETRANSFORMFLAGS] = 0;
    t[o + D3DTSS.COLORARG0] = D3DTA.CURRENT;
    t[o + D3DTSS.ALPHAARG0] = D3DTA.CURRENT;
    t[o + D3DTSS.RESULTARG] = D3DTA.CURRENT;
    t[o + D3DTSS.CONSTANT] = 0;
  }
  return t;
}

/** The `aeDSSS` table. `samp[slot * NUM_SAMP + type]`. */
export function defaultSamplerStates(): Uint32Array {
  const t = new Uint32Array(NUM_SAMPLER_SLOTS * NUM_SAMP);
  for (let s = 0; s < NUM_SAMPLER_SLOTS; s++) {
    const o = s * NUM_SAMP;
    t[o + D3DSAMP.ADDRESSU] = D3DTADDRESS.WRAP;
    t[o + D3DSAMP.ADDRESSV] = D3DTADDRESS.WRAP;
    t[o + D3DSAMP.ADDRESSW] = D3DTADDRESS.WRAP;
    t[o + D3DSAMP.BORDERCOLOR] = 0;
    t[o + D3DSAMP.MAGFILTER] = D3DTEXF.POINT;
    t[o + D3DSAMP.MINFILTER] = D3DTEXF.POINT;
    t[o + D3DSAMP.MIPFILTER] = D3DTEXF.NONE;
    t[o + D3DSAMP.MIPMAPLODBIAS] = 0;
    t[o + D3DSAMP.MAXMIPLEVEL] = 0;
    t[o + D3DSAMP.MAXANISOTROPY] = 1;
    t[o + D3DSAMP.SRGBTEXTURE] = 0;
    t[o + D3DSAMP.ELEMENTINDEX] = 0;
    t[o + D3DSAMP.DMAPOFFSET] = 0;
  }
  return t;
}

/** Sampler index (0..15, 256 = displacement map, 257..260 = vertex samplers) -> slot in our tables, or -1. */
export function samplerSlot(sampler: number): number {
  if (sampler >= 0 && sampler < 16) return sampler;
  if (sampler === 256) return 16;
  if (sampler >= 257 && sampler <= 260) return 17 + (sampler - 257);
  return -1;
}

/** Everything `IDirect3DDevice9::Set*`/`Get*` stores, apart from resource bindings (those live in the device). */
export class FixedFunctionState {
  renderStates: Uint32Array;
  tss = defaultTextureStageStates();
  samp = defaultSamplerStates();
  /** VIEW, PROJECTION, TEXTURE0..7 and WORLDMATRIX(n); identity until set. */
  private transforms = new Map<number, Mat4>();
  lights = new Map<number, Light>();
  lightEnabled = new Set<number>();
  material: Material = defaultMaterial();
  viewport: Viewport = { x: 0, y: 0, width: 0, height: 0, minZ: 0, maxZ: 1 };
  scissor: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  clipPlanes: Float32Array[] = Array.from({ length: 6 }, () => new Float32Array(4));
  /** the emulated vertex shader (vshader.ts) and its float constant registers c0..c255 (float4 each); null = fixed function */
  vertexShader: Direct3DVertexShader9 | null = null;
  readonly vsConstF = new Float32Array(VS_REGISTERS * 4);
  /** Bumped whenever the state that feeds each uniform block changes (the device re-uploads lazily). */
  versionTransform = 0;
  versionLighting = 0;
  versionMisc = 0;
  versionVsConst = 0;

  constructor(hasDepthStencil = true) { this.renderStates = defaultRenderStates(hasDepthStencil); }

  getTransform(state: number): Mat4 {
    let m = this.transforms.get(state);
    if (!m) { m = matIdentity(); this.transforms.set(state, m); }
    return m;
  }
  setTransform(state: number, m: ArrayLike<number>): void {
    this.getTransform(state).set(m as ArrayLike<number>);
    this.versionTransform++;
    if (state === D3DTS.VIEW) this.versionLighting++; // lights are kept in world space and transformed by the view matrix per draw
  }
  /** `MultiplyTransform`: state = m * state. */
  multiplyTransform(state: number, m: ArrayLike<number>, multiply: (a: ArrayLike<number>, b: ArrayLike<number>) => Mat4): void {
    this.setTransform(state, multiply(m, this.getTransform(state)));
  }
}

export { D3DTSS_TCI };
