/**
 * `IDirect3DDevice9` over WebGPU (docs/ARCHITECTURE.md "D3D9 layer"; coverage rules in docs/ledger-classes.tsv).
 *
 * The client talks to Direct3D almost exclusively through a few wrappers (CKTDGStateManager, CKTDGEffectStateManager,
 * CKTDGDynamicVBManager, the XMesh/XSkinMesh renderers); their calls are what this class implements, with D3D's names and HRESULT
 * results so the ported engine code can stay line-for-line.  Rendering is recorded into one command encoder per frame and a render
 * pass is (re)started whenever the render target changes or a clear has to precede further drawing.
 *
 * Not emulated (reported once via `warn`): wireframe/point fill, point sprites, clip planes, border/mirror-once addressing,
 * dual-source blending, bump mapping, multiple render targets, multisampling.
 */
import { D3DCLEAR, D3DCMP, D3DFMT, D3DFOG, D3DFVF, D3DLIGHT, D3DMCS, D3DPOOL, D3DPT, D3DRS, D3DSAMP, D3DTA, D3DTOP, D3DTS, D3DTSS, D3DTSS_TCI, D3DTTFF, D3DUSAGE, D3DTEXF, D3DFILL, D3DSHADE, D3DZB, D3DDECLUSAGE, d3dtsWorldMatrix, D3DTS_WORLD, D3DCOLORWRITEENABLE } from "./enums.ts";
import { matInverse, matMultiply, matTranspose, vec3Normalize, vec3TransformNormal, vec3Transform } from "./d3dx-math.ts";
import type { Mat4 } from "./d3dx-math.ts";
import { FixedFunctionState, NUM_STAGES, NUM_TSS, NUM_SAMP, NUM_SAMPLER_SLOTS, dwordToFloat, samplerSlot } from "./state.ts";
import type { Light, Material, Rect, Viewport } from "./state.ts";
import { buildLayouts, DECL_END, fvfToElements, fvfVertexSize } from "./vertex.ts";
import type { BufferLayout, VertexElement } from "./vertex.ts";
import { generateWgsl, LIGHTB, MISC, programKey, XFORM } from "./ffp.ts";
import type { FogSource, ProgramDesc, StageDesc } from "./ffp.ts";
import { blendState, colorWriteMask, compareFunc, cullState, samplerDescriptor, samplerKey, stencilOp, topology, vertexCountFor } from "./pipeline-state.ts";
import { Direct3DIndexBuffer9, Direct3DSurface9, Direct3DTexture9, Direct3DVertexBuffer9, Direct3DVertexDeclaration9 } from "./resources.ts";
import type { D3DRect, ResourceHost } from "./resources.ts";
import { defaultCaps } from "./caps.ts";
import type { D3DCAPS9 } from "./caps.ts";
import { TransientArena } from "./arena.ts";
import type { ArenaAlloc } from "./arena.ts";
import { D3DERR_INVALIDCALL, D3DERR_NOTAVAILABLE, D3D_OK } from "./hresult.ts";
import { formatInfo } from "./formats.ts";

export interface DeviceOptions {
  gpu: GPUDevice;
  width: number;
  height: number;
  /** D3DFMT_X8R8G8B8 (default) or D3DFMT_A8R8G8B8 */
  backBufferFormat?: number;
  /** default true: a D24S8 depth buffer like the client's presentation parameters */
  autoDepthStencil?: boolean;
  /** GPU format of the back buffer texture (default rgba8unorm; browsers prefer the canvas format) */
  backBufferGpuFormat?: GPUTextureFormat;
  /** called by Present() after the frame was submitted, with the back buffer */
  onPresent?: (backBuffer: GPUTexture) => void;
  warn?: (message: string) => void;
  /** decode DXT textures on the CPU even when the GPU could sample them compressed (tests both paths) */
  disableBc?: boolean;
  /** debugging aid: receives the program key and the WGSL of every shader generated */
  dumpWgsl?: (key: string, code: string) => void;
}

interface StreamBinding { vb: Direct3DVertexBuffer9; offset: number; stride: number }

const BLOCK_ALIGN = 256;

export class Direct3DDevice9 implements ResourceHost {
  readonly gpu: GPUDevice;
  epoch = 0;
  readonly hasBC: boolean;
  state: FixedFunctionState;
  readonly opts: DeviceOptions;

  private fvf = 0;
  private decl: Direct3DVertexDeclaration9 | null = null;
  private streams: (StreamBinding | null)[] = new Array(16).fill(null);
  private indices: Direct3DIndexBuffer9 | null = null;
  private textures: (Direct3DTexture9 | null)[] = new Array(NUM_SAMPLER_SLOTS).fill(null);
  private renderTarget!: Direct3DSurface9;
  private depthStencil: Direct3DSurface9 | null = null;
  /** the depth buffer as far as WebGPU can use it: it must have exactly the size of the render target (D3D9 only needs it to be >=) */
  private get ds(): Direct3DSurface9 | null {
    const d = this.depthStencil;
    if (!d) return null;
    if (d.width === this.renderTarget.width && d.height === this.renderTarget.height) return d;
    this.warn("ds-size", `depth-stencil surface ${d.width}x${d.height} does not match the ${this.renderTarget.width}x${this.renderTarget.height} render target: depth testing disabled`);
    return null;
  }
  backBuffer!: Direct3DSurface9;
  private autoDepth: Direct3DSurface9 | null = null;

  // ---- command recording
  private encoder: GPUCommandEncoder | null = null;
  private pass: GPURenderPassEncoder | null = null;
  private passDraws = 0;
  private pending: { color?: [number, number, number, number]; depth?: number; stencil?: number } | null = null;
  private inScene = false;
  private readonly arena: TransientArena;
  private readonly warned = new Set<string>();
  /** number of draw calls recorded since creation (diagnostics) */
  drawCalls = 0;

  // ---- caches
  private readonly bgl0: GPUBindGroupLayout;
  private readonly bgl1: GPUBindGroupLayout;
  private readonly pipelineLayout: GPUPipelineLayout;
  private readonly modules = new Map<string, GPUShaderModule>();
  private readonly pipelines = new Map<string, GPURenderPipeline>();
  private readonly samplers = new Map<string, GPUSampler>();
  private readonly bindGroups0 = new Map<string, GPUBindGroup>();
  private readonly bindGroups1 = new Map<string, { group: GPUBindGroup; views: GPUTextureView[] }>();
  private readonly dummyView: GPUTextureView;
  private readonly dummyTexture: GPUTexture;
  private defaultSampler: GPUSampler;
  /** validation errors reported by the GPU since the last `takeErrors()` */
  private gpuErrors: string[] = [];

  // ---- uniform block snapshots (re-allocated when the state feeding them changes)
  private xform: { alloc: ArenaAlloc; verT: number; screen0: number; screen1: number; screen2: number; screen3: number } | null = null;
  private light: { alloc: ArenaAlloc; ver: number; nLights: string } | null = null;
  private misc: { alloc: ArenaAlloc; ver: number } | null = null;
  private scratch = new Float32Array(Math.max(XFORM.size, LIGHTB.size, MISC.size));

  constructor(opts: DeviceOptions) {
    this.opts = { ...opts };
    this.gpu = opts.gpu;
    this.hasBC = !opts.disableBc && opts.gpu.features.has("texture-compression-bc");
    this.state = new FixedFunctionState(opts.autoDepthStencil !== false);
    this.arena = new TransientArena(opts.gpu);
    opts.gpu.addEventListener("uncapturederror", (e) => { this.gpuErrors.push((e as GPUUncapturedErrorEvent).error.message); });

    this.createBackBuffers();
    this.state.viewport = { x: 0, y: 0, width: opts.width, height: opts.height, minZ: 0, maxZ: 1 };
    this.state.scissor = { left: 0, top: 0, right: opts.width, bottom: opts.height };

    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const ub = (binding: number, floats: number): GPUBindGroupLayoutEntry => ({ binding, visibility: VF, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: floats * 4 } });
    this.bgl0 = this.gpu.createBindGroupLayout({ entries: [ub(0, XFORM.size), ub(1, LIGHTB.size), ub(2, MISC.size)] });
    const e1: GPUBindGroupLayoutEntry[] = [];
    for (let i = 0; i < 8; i++) {
      e1.push({ binding: i * 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d" } });
      e1.push({ binding: i * 2 + 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } });
    }
    this.bgl1 = this.gpu.createBindGroupLayout({ entries: e1 });
    this.pipelineLayout = this.gpu.createPipelineLayout({ bindGroupLayouts: [this.bgl0, this.bgl1] });
    this.dummyTexture = this.gpu.createTexture({ size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.gpu.queue.writeTexture({ texture: this.dummyTexture }, new Uint8Array([0, 0, 0, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.dummyView = this.dummyTexture.createView();
    this.defaultSampler = this.gpu.createSampler({});
  }

  // =============================================================================================== diagnostics
  warn(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    (this.opts.warn ?? ((m) => console.warn(`[d3d9] ${m}`)))(message);
  }
  /** GPU validation errors since the last call (tests assert this stays empty). */
  takeErrors(): string[] { const e = this.gpuErrors; this.gpuErrors = []; return e; }
  /** Like takeErrors() but first lets the queue drain, so errors raised by already submitted work are included. */
  async takeErrorsAsync(): Promise<string[]> {
    this.flush();
    await this.gpu.queue.onSubmittedWorkDone();
    await new Promise((r) => setTimeout(r, 0));
    return this.takeErrors();
  }


  private createBackBuffers(): void {
    const opts = this.opts;
    const fmt = opts.backBufferFormat ?? D3DFMT.X8R8G8B8;
    const gpuFmt = opts.backBufferGpuFormat ?? "rgba8unorm";
    const bbTex = this.gpu.createTexture({ size: [opts.width, opts.height], format: gpuFmt, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    this.backBuffer = new Direct3DSurface9(this, opts.width, opts.height, fmt, D3DUSAGE.RENDERTARGET, D3DPOOL.DEFAULT, null, 0, bbTex);
    this.renderTarget = this.backBuffer;
    if (opts.autoDepthStencil !== false) {
      const dTex = this.gpu.createTexture({ size: [opts.width, opts.height], format: "depth24plus-stencil8", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      this.autoDepth = new Direct3DSurface9(this, opts.width, opts.height, D3DFMT.D24S8, D3DUSAGE.DEPTHSTENCIL, D3DPOOL.DEFAULT, null, 0, dTex);
      this.depthStencil = this.autoDepth;
    } else { this.autoDepth = null; this.depthStencil = null; }
  }

  // ========================================================================================== state accessors
  SetRenderState(state: number, value: number): number {
    if (state < 0 || state >= this.state.renderStates.length) return D3DERR_INVALIDCALL;
    this.state.renderStates[state] = value >>> 0;
    this.noteRenderState(state);
    return D3D_OK;
  }
  GetRenderState(state: number): { hr: number; value: number } {
    if (state < 0 || state >= this.state.renderStates.length) return { hr: D3DERR_INVALIDCALL, value: 0 };
    return { hr: D3D_OK, value: this.state.renderStates[state]! };
  }
  private noteRenderState(state: number): void {
    switch (state) {
      case D3DRS.TEXTUREFACTOR: case D3DRS.FOGCOLOR: case D3DRS.FOGSTART: case D3DRS.FOGEND: case D3DRS.FOGDENSITY: case D3DRS.ALPHAREF:
        this.state.versionMisc++; break;
      case D3DRS.AMBIENT:
        this.state.versionLighting++; break;
      default:
    }
  }

  SetTextureStageState(stage: number, type: number, value: number): number {
    if (stage < 0 || stage >= NUM_STAGES || type < 0 || type >= NUM_TSS) return D3DERR_INVALIDCALL;
    this.state.tss[stage * NUM_TSS + type] = value >>> 0;
    if (type === D3DTSS.CONSTANT) this.state.versionMisc++;
    return D3D_OK;
  }
  GetTextureStageState(stage: number, type: number): { hr: number; value: number } {
    if (stage < 0 || stage >= NUM_STAGES || type < 0 || type >= NUM_TSS) return { hr: D3DERR_INVALIDCALL, value: 0 };
    return { hr: D3D_OK, value: this.state.tss[stage * NUM_TSS + type]! };
  }

  SetSamplerState(sampler: number, type: number, value: number): number {
    const slot = samplerSlot(sampler);
    if (slot < 0 || type < 0 || type >= NUM_SAMP) return D3DERR_INVALIDCALL;
    this.state.samp[slot * NUM_SAMP + type] = value >>> 0;
    if (type === D3DSAMP.MIPMAPLODBIAS) this.state.versionMisc++;
    return D3D_OK;
  }
  GetSamplerState(sampler: number, type: number): { hr: number; value: number } {
    const slot = samplerSlot(sampler);
    if (slot < 0 || type < 0 || type >= NUM_SAMP) return { hr: D3DERR_INVALIDCALL, value: 0 };
    return { hr: D3D_OK, value: this.state.samp[slot * NUM_SAMP + type]! };
  }

  SetTransform(state: number, matrix: ArrayLike<number>): number {
    if (!(state === D3DTS.VIEW || state === D3DTS.PROJECTION || (state >= D3DTS.TEXTURE0 && state <= D3DTS.TEXTURE7) || (state >= 256 && state < 512))) return D3DERR_INVALIDCALL;
    this.state.setTransform(state, matrix);
    return D3D_OK;
  }
  GetTransform(state: number): Mat4 { return new Float32Array(this.state.getTransform(state)); }
  MultiplyTransform(state: number, matrix: ArrayLike<number>): number {
    this.state.setTransform(state, matMultiply(matrix, this.state.getTransform(state)));
    return D3D_OK;
  }

  SetMaterial(m: Material): number { this.state.material = structuredClone(m); this.state.versionLighting++; return D3D_OK; }
  GetMaterial(): Material { return structuredClone(this.state.material); }
  SetLight(index: number, light: Light): number {
    if (index < 0) return D3DERR_INVALIDCALL;
    this.state.lights.set(index, structuredClone(light));
    this.state.versionLighting++;
    return D3D_OK;
  }
  GetLight(index: number): { hr: number; light: Light | null } {
    const l = this.state.lights.get(index);
    return l ? { hr: D3D_OK, light: structuredClone(l) } : { hr: D3DERR_INVALIDCALL, light: null };
  }
  LightEnable(index: number, enable: boolean): number {
    if (index < 0) return D3DERR_INVALIDCALL;
    if (enable) this.state.lightEnabled.add(index); else this.state.lightEnabled.delete(index);
    this.state.versionLighting++;
    return D3D_OK;
  }
  GetLightEnable(index: number): { hr: number; enabled: boolean } { return { hr: D3D_OK, enabled: this.state.lightEnabled.has(index) }; }

  SetViewport(vp: Viewport): number { this.state.viewport = { ...vp }; return D3D_OK; }
  GetViewport(): Viewport { return { ...this.state.viewport }; }
  SetScissorRect(r: Rect): number { this.state.scissor = { ...r }; return D3D_OK; }
  GetScissorRect(): Rect { return { ...this.state.scissor }; }
  SetClipPlane(index: number, plane: ArrayLike<number>): number {
    if (index < 0 || index > 5) return D3DERR_INVALIDCALL;
    this.state.clipPlanes[index]!.set(plane as ArrayLike<number>);
    return D3D_OK;
  }

  // ============================================================================================ vertex sources
  SetFVF(fvf: number): number { this.fvf = fvf >>> 0; this.decl = null; return D3D_OK; }
  GetFVF(): number { return this.fvf; }
  SetVertexDeclaration(decl: Direct3DVertexDeclaration9 | null): number { this.decl = decl; if (decl) this.fvf = 0; return D3D_OK; }
  GetVertexDeclaration(): Direct3DVertexDeclaration9 | null { return this.decl; }
  SetStreamSource(stream: number, vb: Direct3DVertexBuffer9 | null, offset: number, stride: number): number {
    if (stream < 0 || stream >= 16) return D3DERR_INVALIDCALL;
    this.streams[stream] = vb ? { vb, offset, stride } : null;
    return D3D_OK;
  }
  GetStreamSource(stream: number): { hr: number; vb: Direct3DVertexBuffer9 | null; offset: number; stride: number } {
    const s = this.streams[stream];
    return { hr: D3D_OK, vb: s?.vb ?? null, offset: s?.offset ?? 0, stride: s?.stride ?? 0 };
  }
  SetIndices(ib: Direct3DIndexBuffer9 | null): number { this.indices = ib; return D3D_OK; }
  GetIndices(): Direct3DIndexBuffer9 | null { return this.indices; }

  SetTexture(stage: number, tex: Direct3DTexture9 | null): number {
    const slot = samplerSlot(stage);
    if (slot < 0) return D3DERR_INVALIDCALL;
    this.textures[slot] = tex;
    return D3D_OK;
  }
  GetTexture(stage: number): Direct3DTexture9 | null { const s = samplerSlot(stage); return s < 0 ? null : this.textures[s]!; }

  // ============================================================================================ resource factory
  CreateVertexBuffer(length: number, usage: number, fvf: number, pool: number): { hr: number; vb: Direct3DVertexBuffer9 | null } {
    if (length <= 0) return { hr: D3DERR_INVALIDCALL, vb: null };
    return { hr: D3D_OK, vb: new Direct3DVertexBuffer9(this, length, usage, fvf, pool) };
  }
  CreateIndexBuffer(length: number, usage: number, format: number, pool: number): { hr: number; ib: Direct3DIndexBuffer9 | null } {
    if (length <= 0 || (format !== D3DFMT.INDEX16 && format !== D3DFMT.INDEX32)) return { hr: D3DERR_INVALIDCALL, ib: null };
    return { hr: D3D_OK, ib: new Direct3DIndexBuffer9(this, length, usage, format, pool) };
  }
  CreateVertexDeclaration(elements: readonly VertexElement[]): { hr: number; decl: Direct3DVertexDeclaration9 | null } {
    const list: VertexElement[] = [];
    for (const e of elements) { if (e.stream === DECL_END.stream) break; list.push(e); }
    return { hr: D3D_OK, decl: new Direct3DVertexDeclaration9(this, list) };
  }
  CreateTexture(width: number, height: number, levels: number, usage: number, format: number, pool: number): { hr: number; tex: Direct3DTexture9 | null } {
    if (!formatInfo(format) || width <= 0 || height <= 0) return { hr: D3DERR_NOTAVAILABLE, tex: null };
    const fi = formatInfo(format)!;
    if (usage & D3DUSAGE.RENDERTARGET && fi.compressed) return { hr: D3DERR_INVALIDCALL, tex: null };
    // floating point formats exist only as render targets here (the CPU side conversions are 8-bit)
    if (!(usage & D3DUSAGE.RENDERTARGET) && fi.gpu !== null && fi.gpu !== "rgba8unorm" && !fi.compressed && !fi.depth) return { hr: D3DERR_NOTAVAILABLE, tex: null };
    return { hr: D3D_OK, tex: new Direct3DTexture9(this, width, height, levels, usage, format, pool) };
  }
  CreateDepthStencilSurface(width: number, height: number, format: number): { hr: number; surface: Direct3DSurface9 | null } {
    const info = formatInfo(format);
    if (!info?.depth) return { hr: D3DERR_NOTAVAILABLE, surface: null };
    const tex = this.gpu.createTexture({ size: [width, height], format: info.gpu!, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    return { hr: D3D_OK, surface: new Direct3DSurface9(this, width, height, format, D3DUSAGE.DEPTHSTENCIL, D3DPOOL.DEFAULT, null, 0, tex) };
  }

  // ================================================================================================ render targets
  GetBackBuffer(): Direct3DSurface9 { this.backBuffer.AddRef(); return this.backBuffer; }
  SetRenderTarget(index: number, surface: Direct3DSurface9 | null): number {
    if (index !== 0) { this.warn("mrt", "multiple render targets are not supported"); return D3DERR_INVALIDCALL; }
    if (!surface) return D3DERR_INVALIDCALL;
    this.endPass(true);
    this.renderTarget = surface;
    this.state.viewport = { x: 0, y: 0, width: surface.width, height: surface.height, minZ: 0, maxZ: 1 };
    this.state.scissor = { left: 0, top: 0, right: surface.width, bottom: surface.height };
    return D3D_OK;
  }
  GetRenderTarget(index: number): Direct3DSurface9 | null { return index === 0 ? this.renderTarget : null; }
  SetDepthStencilSurface(surface: Direct3DSurface9 | null): number {
    this.endPass(true);
    this.depthStencil = surface;
    return D3D_OK;
  }
  GetDepthStencilSurface(): Direct3DSurface9 | null { return this.depthStencil; }

  private blitPipelines = new Map<string, GPURenderPipeline>();
  private blitLayout: GPUBindGroupLayout | null = null;

  /**
   * `IDirect3DDevice9::StretchRect` between render targets / render-target texture levels: a copy when the rectangles have the same
   * size and format, otherwise a textured quad with point or linear filtering (pixel centres line up, so equal sizes are exact).
   */
  StretchRect(src: Direct3DSurface9, srcRect: D3DRect | null, dst: Direct3DSurface9, dstRect: D3DRect | null, filter: number): number {
    if (src === dst || src.isDepth || dst.isDepth) return D3DERR_INVALIDCALL;
    const sr = srcRect ?? { left: 0, top: 0, right: src.width, bottom: src.height };
    const dr = dstRect ?? { left: 0, top: 0, right: dst.width, bottom: dst.height };
    const inside = (r: D3DRect, w: number, h: number): boolean => r.left >= 0 && r.top >= 0 && r.right <= w && r.bottom <= h && r.right > r.left && r.bottom > r.top;
    if (!inside(sr, src.width, src.height) || !inside(dr, dst.width, dst.height)) return D3DERR_INVALIDCALL;
    this.endPass(true);
    const enc = this.ensureEncoder();
    const sw = sr.right - sr.left, sh = sr.bottom - sr.top, dw = dr.right - dr.left, dh = dr.bottom - dr.top;
    const srcAlpha = this.targetHasAlpha(src), dstAlpha = this.targetHasAlpha(dst);
    if (sw === dw && sh === dh && src.gpuFormat === dst.gpuFormat && (dstAlpha || !srcAlpha)) {
      enc.copyTextureToTexture({ texture: src.texture, mipLevel: src.level, origin: [sr.left, sr.top] }, { texture: dst.texture, mipLevel: dst.level, origin: [dr.left, dr.top] }, [sw, sh]);
      return D3D_OK;
    }
    const linear = filter === D3DTEXF.LINEAR || filter === D3DTEXF.ANISOTROPIC;
    const format = dst.gpuFormat;
    const key = `${format}|${linear ? 1 : 0}|${dstAlpha ? 1 : 0}`;
    let pipe = this.blitPipelines.get(key);
    if (!pipe) {
      this.blitLayout ??= this.gpu.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 32 } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ] });
      const module = this.gpu.createShaderModule({ code: /* wgsl */ `
struct U { src: vec4f, flags: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var t: texture_2d<f32>;
@group(0) @binding(2) var s: sampler;
struct O { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> O {
  var q = array<vec2f, 4>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(1, 1));
  let p = q[i];
  var o: O;
  o.pos = vec4f(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  o.uv = vec2f(mix(u.src.x, u.src.z, p.x), mix(u.src.y, u.src.w, p.y));
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let c = textureSampleLevel(t, s, i.uv, 0.0);
  return vec4f(c.rgb, select(1.0, c.a, u.flags.x > 0.5));
}` });
      pipe = this.gpu.createRenderPipeline({
        layout: this.gpu.createPipelineLayout({ bindGroupLayouts: [this.blitLayout] }),
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format, writeMask: dstAlpha ? GPUColorWrite.ALL : GPUColorWrite.RED | GPUColorWrite.GREEN | GPUColorWrite.BLUE }] },
        primitive: { topology: "triangle-strip" },
      });
      this.blitPipelines.set(key, pipe);
    }
    const al = this.arena.alloc(32, BLOCK_ALIGN);
    new Float32Array(al.chunk.cpu.buffer, al.chunk.cpu.byteOffset + al.offset, 8).set([sr.left / src.width, sr.top / src.height, sr.right / src.width, sr.bottom / src.height, srcAlpha ? 1 : 0, 0, 0, 0]);
    const sampler = this.gpu.createSampler({ magFilter: linear ? "linear" : "nearest", minFilter: linear ? "linear" : "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    const group = this.gpu.createBindGroup({ layout: this.blitLayout!, entries: [
      { binding: 0, resource: { buffer: al.chunk.gpu, offset: 0, size: 32 } },
      { binding: 1, resource: src.texture.createView({ baseMipLevel: src.level, mipLevelCount: 1, dimension: "2d" }) },
      { binding: 2, resource: sampler },
    ] });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst.renderView(), loadOp: "load", storeOp: "store" }] });
    pass.setPipeline(pipe);
    pass.setViewport(dr.left, dr.top, dw, dh, 0, 1);
    pass.setScissorRect(dr.left, dr.top, dw, dh);
    pass.setBindGroup(0, group, [al.offset]);
    pass.draw(4);
    pass.end();
    return D3D_OK;
  }

  /** `UpdateTexture`: copy the levels of a system-memory texture into a default-pool texture of the same format and size. */
  UpdateTexture(src: Direct3DTexture9, dst: Direct3DTexture9): number {
    return dst.copyFrom(src) ? D3D_OK : D3DERR_INVALIDCALL;
  }

  /**
   * `IDirect3DDevice9::Reset` for a windowed device: new back buffer (and automatic depth buffer), every state back to its default and all
   * bindings dropped, like the real thing.  Callers release their default-pool resources first (the exe does in OnLostDevice).
   */
  Reset(width: number, height: number, format?: number): number {
    if (width <= 0 || height <= 0) return D3DERR_INVALIDCALL;
    this.flush();
    this.backBuffer.destroyNow();
    this.autoDepth?.destroyNow();
    this.opts.width = width; this.opts.height = height;
    if (format !== undefined) this.opts.backBufferFormat = format;
    this.createBackBuffers();
    this.state = new FixedFunctionState(this.opts.autoDepthStencil !== false);
    this.state.viewport = { x: 0, y: 0, width, height, minZ: 0, maxZ: 1 };
    this.state.scissor = { left: 0, top: 0, right: width, bottom: height };
    this.streams.fill(null); this.indices = null; this.textures.fill(null); this.decl = null; this.fvf = 0;
    this.xform = null; this.light = null; this.misc = null;
    return D3D_OK;
  }

  // =================================================================================================== frame control
  BeginScene(): number { if (this.inScene) return D3DERR_INVALIDCALL; this.inScene = true; return D3D_OK; }
  EndScene(): number { if (!this.inScene) return D3DERR_INVALIDCALL; this.inScene = false; return D3D_OK; }
  TestCooperativeLevel(): number { return D3D_OK; }
  GetDeviceCaps(): D3DCAPS9 { return defaultCaps(); }

  Present(): number {
    this.flush();
    this.opts.onPresent?.(this.backBuffer.texture);
    return D3D_OK;
  }

  /** Submit everything recorded so far. */
  flush(): void {
    this.endPass(true);
    if (!this.encoder) return;
    this.arena.upload();
    this.gpu.queue.submit([this.encoder.finish()]);
    this.encoder = null;
    this.arena.reset();
    this.epoch++;
    this.xform = null; this.light = null; this.misc = null;
    if (this.bindGroups1.size > 4096) this.bindGroups1.clear();
    if (this.bindGroups0.size > 256) this.bindGroups0.clear();
  }

  /** Read the render target back as RGBA8 (top row first). */
  async readPixels(surface: Direct3DSurface9 = this.renderTarget): Promise<{ width: number; height: number; rgba: Uint8Array }> {
    this.flush();
    const tex = surface.texture;
    const { width, height } = surface;
    const bpr = Math.ceil((width * 4) / 256) * 256;
    const buf = this.gpu.createBuffer({ size: bpr * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.gpu.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex, mipLevel: surface.level }, { buffer: buf, bytesPerRow: bpr }, [width, height]);
    this.gpu.queue.submit([enc.finish()]);
    this.epoch++;
    await buf.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buf.getMappedRange());
    const out = new Uint8Array(width * height * 4);
    const bgra = tex.format.startsWith("bgra");
    for (let y = 0; y < height; y++) {
      const row = mapped.subarray(y * bpr, y * bpr + width * 4);
      if (bgra) for (let x = 0; x < width * 4; x += 4) { out[y * width * 4 + x] = row[x + 2]!; out[y * width * 4 + x + 1] = row[x + 1]!; out[y * width * 4 + x + 2] = row[x]!; out[y * width * 4 + x + 3] = row[x + 3]!; }
      else out.set(row, y * width * 4);
    }
    buf.unmap();
    buf.destroy();
    return { width, height, rgba: out };
  }

  // ======================================================================================================== passes
  private targetHasAlpha(s: Direct3DSurface9): boolean { return !!formatInfo(s.format)?.hasAlpha; }

  private ensureEncoder(): GPUCommandEncoder { return (this.encoder ??= this.gpu.createCommandEncoder()); }

  /** End the render pass; with `materialize` a pending clear is executed first (an empty clearing pass). */
  private endPass(materialize: boolean): void {
    if (!this.pass && materialize && this.pending) this.beginPass();
    if (this.pass) { this.pass.end(); this.pass = null; this.passDraws = 0; }
    if (materialize) this.pending = null;
  }

  private beginPass(): GPURenderPassEncoder {
    const enc = this.ensureEncoder();
    const rt = this.renderTarget;
    const p = this.pending;
    const desc: GPURenderPassDescriptor = {
      colorAttachments: [{
        view: rt.renderView(),
        loadOp: p?.color ? "clear" : "load",
        storeOp: "store",
        clearValue: p?.color ? { r: p.color[0], g: p.color[1], b: p.color[2], a: this.targetHasAlpha(rt) ? p.color[3] : 1 } : undefined,
      }],
    };
    const ds = this.ds;
    if (ds) {
      const hasStencil = (formatInfo(ds.format)?.stencilBits ?? 0) > 0;
      desc.depthStencilAttachment = {
        view: ds.renderView(),
        depthLoadOp: p?.depth !== undefined ? "clear" : "load", depthStoreOp: "store", depthClearValue: p?.depth ?? 1,
        ...(hasStencil ? { stencilLoadOp: p?.stencil !== undefined ? "clear" : "load", stencilStoreOp: "store", stencilClearValue: p?.stencil ?? 0 } as const : {}),
      };
    }
    this.pending = null;
    this.pass = enc.beginRenderPass(desc);
    this.passDraws = 0;
    return this.pass;
  }

  /** `IDirect3DDevice9::Clear`.  Without rects the whole viewport is cleared. */
  Clear(rects: readonly Rect[] | null, flags: number, color: number, z: number, stencil: number): number {
    const rt = this.renderTarget;
    const vp = this.state.viewport;
    const full = (!rects || rects.length === 0) && vp.x === 0 && vp.y === 0 && vp.width >= rt.width && vp.height >= rt.height && !this.state.renderStates[D3DRS.SCISSORTESTENABLE];
    const doColor = (flags & D3DCLEAR.TARGET) !== 0;
    const dsNow = this.ds;
    const doDepth = (flags & D3DCLEAR.ZBUFFER) !== 0 && !!dsNow;
    const hasStencil = !!dsNow && (formatInfo(dsNow.format)?.stencilBits ?? 0) > 0;
    const doStencil = (flags & D3DCLEAR.STENCIL) !== 0 && hasStencil;
    if (!doColor && !doDepth && !doStencil) return D3D_OK;
    if (!full) { this.clearRects(rects, doColor, doDepth, doStencil, color, z, stencil); return D3D_OK; }
    // a clear in the middle of a pass ends it; the next pass starts with the clear as its load op
    if (this.pass) this.endPass(false);
    const p = (this.pending ??= {});
    if (doColor) p.color = [((color >>> 16) & 255) / 255, ((color >>> 8) & 255) / 255, (color & 255) / 255, ((color >>> 24) & 255) / 255];
    if (doDepth) p.depth = Math.min(1, Math.max(0, z));
    if (doStencil) p.stencil = stencil & 255;
    return D3D_OK;
  }

  private clearPipelines = new Map<string, GPURenderPipeline>();
  /** Partial clear (viewport smaller than the target, scissor or explicit rects): a quad per rect with colour/depth/stencil forced. */
  private clearRects(rects: readonly Rect[] | null, color: boolean, depth: boolean, stencil: boolean, c: number, z: number, st: number): void {
    const rt = this.renderTarget;
    const vp = this.state.viewport;
    const list: Rect[] = rects && rects.length ? [...rects] : [{ left: vp.x, top: vp.y, right: vp.x + vp.width, bottom: vp.y + vp.height }];
    const ds = this.ds;
    const hasStencilFmt = !!ds && (formatInfo(ds.format)?.stencilBits ?? 0) > 0;
    const key = `${rt.gpuFormat}|${ds ? ds.gpuFormat : ""}|${color ? 1 : 0}${depth ? 1 : 0}${stencil ? 1 : 0}|${this.targetHasAlpha(rt) ? 1 : 0}`;
    let pipe = this.clearPipelines.get(key);
    if (!pipe) {
      const module = this.gpu.createShaderModule({
        code: /* wgsl */ `
struct U { rect: vec4f, color: vec4f, depth: vec4f }
@group(0) @binding(0) var<uniform> u: U;
struct O { @builtin(position) pos: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> O {
  var q = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
  let p = q[i];
  return O(vec4f(mix(u.rect.x, u.rect.z, p.x), mix(u.rect.y, u.rect.w, p.y), u.depth.x, 1.0));
}
${ds ? "struct F { @location(0) c: vec4f, @builtin(frag_depth) d: f32 }\n@fragment fn fs() -> F { return F(u.color, u.depth.x); }" : "@fragment fn fs() -> @location(0) vec4f { return u.color; }"}`,
      });
      const bgl = this.gpu.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 48 } }] });
      const stFace: GPUStencilFaceState = { compare: "always", failOp: "replace", depthFailOp: "replace", passOp: "replace" };
      pipe = this.gpu.createRenderPipeline({
        layout: this.gpu.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: rt.gpuFormat, writeMask: color ? colorWriteMask(15, this.targetHasAlpha(rt)) : 0 }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: ds ? {
          format: ds.gpuFormat, depthWriteEnabled: depth, depthCompare: "always",
          ...(hasStencilFmt ? { stencilFront: stencil ? stFace : { compare: "always" as const }, stencilBack: stencil ? stFace : { compare: "always" as const }, stencilReadMask: 0xff, stencilWriteMask: stencil ? 0xff : 0 } : {}),
        } : undefined,
      });
      this.clearPipelines.set(key, pipe);
    }
    const pass = this.pass ?? this.beginPass();
    const bgl = pipe.getBindGroupLayout(0);
    for (const r of list) {
      const a = this.arena.alloc(48, BLOCK_ALIGN);
      const f = new Float32Array(a.chunk.cpu.buffer, a.chunk.cpu.byteOffset + a.offset, 12);
      f.set([r.left / rt.width * 2 - 1, 1 - r.top / rt.height * 2, r.right / rt.width * 2 - 1, 1 - r.bottom / rt.height * 2,
        ((c >>> 16) & 255) / 255, ((c >>> 8) & 255) / 255, (c & 255) / 255, this.targetHasAlpha(rt) ? ((c >>> 24) & 255) / 255 : 1, z, 0, 0, 0]);
      const bg = this.gpu.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: a.chunk.gpu, offset: 0, size: 48 } }] });
      pass.setViewport(0, 0, rt.width, rt.height, 0, 1);
      pass.setScissorRect(0, 0, rt.width, rt.height);
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bg, [a.offset]);
      if (stencil && hasStencilFmt) pass.setStencilReference(st & 255);
      pass.draw(6);
    }
    this.passDraws++;
  }

  // ========================================================================================================= draws
  DrawPrimitive(primType: number, startVertex: number, primCount: number): number {
    return this.draw({ prim: primType, primCount, indexed: false, baseVertex: startVertex, minVertex: 0, numVertices: vertexCountFor(primType, primCount), startIndex: 0 });
  }
  DrawIndexedPrimitive(primType: number, baseVertexIndex: number, minVertexIndex: number, numVertices: number, startIndex: number, primCount: number): number {
    return this.draw({ prim: primType, primCount, indexed: true, baseVertex: baseVertexIndex, minVertex: minVertexIndex, numVertices, startIndex });
  }
  DrawPrimitiveUP(primType: number, primCount: number, vertexData: Uint8Array, stride: number): number {
    return this.draw({ prim: primType, primCount, indexed: false, baseVertex: 0, minVertex: 0, numVertices: vertexCountFor(primType, primCount), startIndex: 0, userVertices: vertexData, userStride: stride });
  }
  DrawIndexedPrimitiveUP(primType: number, minVertexIndex: number, numVertices: number, primCount: number, indexData: Uint8Array, indexFormat: number, vertexData: Uint8Array, stride: number): number {
    return this.draw({ prim: primType, primCount, indexed: true, baseVertex: 0, minVertex: minVertexIndex, numVertices, startIndex: 0, userVertices: vertexData, userStride: stride, userIndices: indexData, userIndex32: indexFormat === D3DFMT.INDEX32 });
  }

  private resolveElements(): { elements: readonly VertexElement[]; fvf: number } | null {
    if (this.decl) return { elements: this.decl.elements, fvf: 0 };
    if (this.fvf) return { elements: fvfToElements(this.fvf).elements, fvf: this.fvf };
    return null;
  }

  private draw(a: DrawArgs): number {
    if (a.primCount <= 0) return D3D_OK;
    const src = this.resolveElements();
    if (!src) return D3DERR_INVALIDCALL;
    const rs = this.state.renderStates;
    const topo = topology(a.prim);

    // ---- strides per stream
    const strides = new Map<number, number>();
    if (a.userVertices) strides.set(0, a.userStride!);
    else for (let s = 0; s < 16; s++) { const b = this.streams[s]; if (b) strides.set(s, b.stride || (src.fvf ? fvfVertexSize(src.fvf) : 0)); }
    const layouts = buildLayouts(src.elements, strides);
    if (layouts.length === 0) return D3DERR_INVALIDCALL;
    for (const l of layouts) if (l.stride === 0 || l.stride % 4 !== 0) { this.warn(`stride${l.stride}`, `vertex stride ${l.stride} is not supported`); return D3DERR_INVALIDCALL; }

    // ---- program
    const desc = this.makeProgramDesc(layouts, src.elements);
    const pkey = programKey(desc);
    let module = this.modules.get(pkey);
    if (!module) {
      const code = generateWgsl(desc);
      this.opts.dumpWgsl?.(pkey, code);
      module = this.gpu.createShaderModule({ code });
      this.modules.set(pkey, module);
    }

    // ---- where vertex data comes from.  User-pointer draws and dynamic buffers are snapshotted into the per-frame arena (every
    // stream, so that one base vertex fits all); static buffers are bound as they are.
    const snapshot = !!a.userVertices || layouts.some((l) => this.streams[l.stream]!.vb.isDynamic);
    let snapFirst = 0, snapCount = 0;
    let baseVertex = a.baseVertex;
    if (snapshot) {
      if (a.indexed) { snapFirst = a.userVertices ? a.minVertex : a.baseVertex + a.minVertex; snapCount = a.numVertices; baseVertex = -a.minVertex; }
      else { snapFirst = a.userVertices ? 0 : a.baseVertex; snapCount = vertexCountFor(a.prim, a.primCount); baseVertex = 0; }
    }

    // ---- indices
    const indexCount = vertexCountFor(a.prim, a.primCount);
    let ibGpu: GPUBuffer | null = null, ibOffset = 0, ibFormat: GPUIndexFormat = "uint16", firstIndex = a.startIndex;
    let drawCount = indexCount;
    if (a.indexed) {
      const ib = a.userIndices ? null : this.indices;
      if (!a.userIndices && !ib) return D3DERR_INVALIDCALL;
      const is32 = a.userIndices ? !!a.userIndex32 : ib!.is32;
      const isz = is32 ? 4 : 2;
      ibFormat = is32 ? "uint32" : "uint16";
      if (topo.isFan || a.userIndices || ib!.isDynamic) {
        const bytes = a.userIndices ?? ib!.cpu;
        const from = a.userIndices ? 0 : a.startIndex * isz;
        const raw = bytes.subarray(from, from + indexCount * isz);
        const aligned = raw.byteOffset % isz === 0 ? raw : raw.slice();
        const view = is32 ? new Uint32Array(aligned.buffer, aligned.byteOffset, indexCount) : new Uint16Array(aligned.buffer, aligned.byteOffset, indexCount);
        const out = topo.isFan ? fanIndices(view, a.primCount, is32) : view;
        const al = this.arena.alloc(out.byteLength, 4);
        al.chunk.cpu.set(new Uint8Array(out.buffer, out.byteOffset, out.byteLength), al.offset);
        ibGpu = al.chunk.gpu; ibOffset = al.offset; firstIndex = 0; drawCount = out.length;
      } else {
        ibGpu = ib!.gpuBuffer(); firstIndex = a.startIndex;
      }
    } else if (topo.isFan) {
      // non-indexed fan: sequential indices 0..n+1 relative to the first vertex drawn
      const out = fanIndices(null, a.primCount, false);
      const al = this.arena.alloc(out.byteLength, 4);
      al.chunk.cpu.set(new Uint8Array(out.buffer, out.byteOffset, out.byteLength), al.offset);
      ibGpu = al.chunk.gpu; ibOffset = al.offset; ibFormat = "uint16"; firstIndex = 0; drawCount = out.length;
    }

    // ---- vertex buffers (slot i = layouts[i])
    const vbSetup: { slot: number; buffer: GPUBuffer; offset: number }[] = [];
    for (let i = 0; i < layouts.length; i++) {
      const l = layouts[i]!;
      if (snapshot) {
        const bytes = snapCount * l.stride;
        let byteStart: number;
        let srcBytes: Uint8Array;
        if (a.userVertices) { byteStart = snapFirst * l.stride; srcBytes = a.userVertices; }
        else { const sb = this.streams[l.stream]!; byteStart = sb.offset + snapFirst * l.stride; srcBytes = sb.vb.cpu; }
        const al = this.arena.alloc(Math.max(4, bytes), 4);
        al.chunk.cpu.set(srcBytes.subarray(byteStart, Math.min(srcBytes.length, byteStart + bytes)), al.offset);
        vbSetup.push({ slot: i, buffer: al.chunk.gpu, offset: al.offset });
      } else {
        const sb = this.streams[l.stream]!;
        vbSetup.push({ slot: i, buffer: sb.vb.gpuBuffer(), offset: sb.offset });
      }
    }

    // ---- pipeline
    const rt = this.renderTarget;
    const ds = this.ds;
    const hasAlpha = this.targetHasAlpha(rt);
    const blend = blendState(rs);
    const writeMask = colorWriteMask(rs[D3DRS.COLORWRITEENABLE]!, hasAlpha);
    const cull = cullState(rs[D3DRS.CULLMODE]!);
    const zEnable = !!ds && rs[D3DRS.ZENABLE] !== D3DZB.FALSE;
    const hasStencil = !!ds && (formatInfo(ds.format)?.stencilBits ?? 0) > 0;
    const stencilOn = hasStencil && !!rs[D3DRS.STENCILENABLE];
    const twoSided = stencilOn && !!rs[D3DRS.TWOSIDEDSTENCILMODE];
    const depthBias = Math.round(dwordToFloat(rs[D3DRS.DEPTHBIAS]!) * 16777216);
    const slopeBias = dwordToFloat(rs[D3DRS.SLOPESCALEDEPTHBIAS]!);
    const stripFmt = topo.topology === "triangle-strip" || topo.topology === "line-strip" ? (a.indexed ? ibFormat : undefined) : undefined;

    const front: GPUStencilFaceState = {
      compare: compareFunc(rs[D3DRS.STENCILFUNC]!), failOp: stencilOp(rs[D3DRS.STENCILFAIL]!), depthFailOp: stencilOp(rs[D3DRS.STENCILZFAIL]!), passOp: stencilOp(rs[D3DRS.STENCILPASS]!),
    };
    const back: GPUStencilFaceState = twoSided ? {
      compare: compareFunc(rs[D3DRS.CCW_STENCILFUNC]!), failOp: stencilOp(rs[D3DRS.CCW_STENCILFAIL]!), depthFailOp: stencilOp(rs[D3DRS.CCW_STENCILZFAIL]!), passOp: stencilOp(rs[D3DRS.CCW_STENCILPASS]!),
    } : front;
    // D3D's "CCW" stencil state applies to counter-clockwise faces = WebGPU's back faces when front faces are clockwise
    const depthKey = ds ? `${ds.gpuFormat}:${zEnable ? 1 : 0}${rs[D3DRS.ZWRITEENABLE] ? 1 : 0}${rs[D3DRS.ZFUNC]}:${stencilOn ? `${JSON.stringify(front)}${JSON.stringify(back)}${rs[D3DRS.STENCILMASK]! & 255},${rs[D3DRS.STENCILWRITEMASK]! & 255}` : "-"}:${depthBias},${slopeBias}` : "nods";
    const layoutKey = layouts.map((l) => `${l.stride}[${l.attributes.map((x) => `${x.location}:${x.format}@${x.offset}`).join(",")}]`).join(";");
    const key = [pkey, layoutKey, topo.topology, stripFmt ?? "", rt.gpuFormat, writeMask, blend ? JSON.stringify(blend) : "noblend", cull.cullMode, depthKey].join("#");
    let pipeline = this.pipelines.get(key);
    if (!pipeline) {
      const desc2: GPURenderPipelineDescriptor = {
        layout: this.pipelineLayout,
        vertex: {
          module, entryPoint: "vs_main",
          buffers: layouts.map((l) => ({
            arrayStride: l.stride, stepMode: "vertex" as const,
            attributes: l.attributes.map((x) => ({ shaderLocation: x.location, offset: x.offset, format: x.format })),
          })),
        },
        fragment: { module, entryPoint: "fs_main", targets: [{ format: rt.gpuFormat, writeMask, ...(blend ? { blend } : {}) }] },
        primitive: { topology: topo.topology, ...(stripFmt ? { stripIndexFormat: stripFmt } : {}), frontFace: cull.frontFace, cullMode: cull.cullMode },
      };
      if (ds) {
        desc2.depthStencil = {
          format: ds.gpuFormat,
          depthWriteEnabled: zEnable && !!rs[D3DRS.ZWRITEENABLE],
          depthCompare: zEnable ? compareFunc(rs[D3DRS.ZFUNC]!) : "always",
          depthBias, depthBiasSlopeScale: slopeBias,
          ...(stencilOn ? { stencilFront: front, stencilBack: back, stencilReadMask: rs[D3DRS.STENCILMASK]! & 255, stencilWriteMask: rs[D3DRS.STENCILWRITEMASK]! & 255 } : {}),
        };
      }
      pipeline = this.gpu.createRenderPipeline(desc2);
      this.pipelines.set(key, pipeline);
    }

    // ---- uniforms and textures
    const rhw = desc.rhw;
    const bg0 = this.uniformBindGroup(desc, rhw);
    const bg1 = this.textureBindGroup(desc);

    // ---- encode
    const pass = this.pass ?? this.beginPass();
    const vp = this.state.viewport;
    if (rhw) {
      // pre-transformed vertices are in render-target coordinates; the viewport only clips (scissor)
      pass.setViewport(0, 0, rt.width, rt.height, vp.minZ, vp.maxZ);
      const sc = this.scissorFor(rt, vp);
      pass.setScissorRect(sc.x, sc.y, sc.w, sc.h);
    } else {
      pass.setViewport(vp.x, vp.y, vp.width, vp.height, vp.minZ, vp.maxZ);
      const sc = this.scissorFor(rt, null);
      pass.setScissorRect(sc.x, sc.y, sc.w, sc.h);
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg0.group, bg0.offsets);
    pass.setBindGroup(1, bg1);
    for (const v of vbSetup) pass.setVertexBuffer(v.slot, v.buffer, v.offset);
    if (stencilOn) pass.setStencilReference(rs[D3DRS.STENCILREF]! & 255);
    if (blend) {
      const bf = rs[D3DRS.BLENDFACTOR]!;
      pass.setBlendConstant([((bf >>> 16) & 255) / 255, ((bf >>> 8) & 255) / 255, (bf & 255) / 255, ((bf >>> 24) & 255) / 255]);
    }
    if (ibGpu) {
      pass.setIndexBuffer(ibGpu, ibFormat, ibOffset);
      pass.drawIndexed(drawCount, 1, firstIndex, baseVertex);
    } else {
      pass.draw(drawCount, 1, baseVertex);
    }
    this.passDraws++;
    this.drawCalls++;
    this.noteUnsupported(rs, desc);
    return D3D_OK;
  }

  private scissorFor(rt: Direct3DSurface9, clipTo: Viewport | null): { x: number; y: number; w: number; h: number } {
    let x0 = 0, y0 = 0, x1 = rt.width, y1 = rt.height;
    if (clipTo) { x0 = Math.max(x0, clipTo.x); y0 = Math.max(y0, clipTo.y); x1 = Math.min(x1, clipTo.x + clipTo.width); y1 = Math.min(y1, clipTo.y + clipTo.height); }
    if (this.state.renderStates[D3DRS.SCISSORTESTENABLE]) {
      const s = this.state.scissor;
      x0 = Math.max(x0, s.left); y0 = Math.max(y0, s.top); x1 = Math.min(x1, s.right); y1 = Math.min(y1, s.bottom);
    }
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }

  private noteUnsupported(rs: Uint32Array, desc: ProgramDesc): void {
    if (rs[D3DRS.FILLMODE] !== D3DFILL.SOLID) this.warn("fill", "D3DRS_FILLMODE other than SOLID is not emulated");
    if (rs[D3DRS.POINTSPRITEENABLE]) this.warn("psprite", "point sprites are not emulated");
    if (rs[D3DRS.CLIPPLANEENABLE]) this.warn("clipplane", "user clip planes are not emulated");
    for (const s of desc.stages) {
      if (s.colorOp === D3DTOP.BUMPENVMAP || s.colorOp === D3DTOP.BUMPENVMAPLUMINANCE) this.warn("bump", "bump mapping texture ops are not emulated");
    }
  }

  // ======================================================================================== program description
  private makeProgramDesc(layouts: BufferLayout[], elements: readonly VertexElement[]): ProgramDesc {
    const st = this.state;
    const rs = st.renderStates;
    const rhw = elements.some((e) => e.usage === D3DDECLUSAGE.POSITIONT);
    const xyzw = !rhw && elements.some((e) => e.usage === D3DDECLUSAGE.POSITION && e.type === 3 /* FLOAT4 */);
    const colorVertex = !!rs[D3DRS.COLORVERTEX];
    const has0 = layouts.some((l) => l.attributes.some((x) => x.usage === D3DDECLUSAGE.COLOR && x.usageIndex === 0));
    const has1 = layouts.some((l) => l.attributes.some((x) => x.usage === D3DDECLUSAGE.COLOR && x.usageIndex === 1));
    // D3DMCS_COLOR1/COLOR2 only apply when COLORVERTEX is on and the vertex really carries that colour; otherwise the material is used
    const ms = (r: number): number => {
      if (!colorVertex) return D3DMCS.MATERIAL;
      const v = rs[r]!;
      return (v === D3DMCS.COLOR1 && !has0) || (v === D3DMCS.COLOR2 && !has1) ? D3DMCS.MATERIAL : v;
    };
    const lighting = !!rs[D3DRS.LIGHTING] && !rhw;
    const lights: number[] = [];
    if (lighting) for (const i of [...st.lightEnabled].sort((x, y) => x - y)) { const l = st.lights.get(i); if (l && lights.length < 8) lights.push(l.type); }
    const stages: StageDesc[] = [];
    for (let i = 0; i < NUM_STAGES; i++) {
      const o = i * NUM_TSS;
      const t = st.tss;
      if (t[o + D3DTSS.COLOROP] === D3DTOP.DISABLE) break;
      const hasTexture = this.textures[i] !== null;
      // A stage that needs its texture while none is bound ends the cascade, as if it were disabled.  (The default stage 0 state is
      // MODULATE(TEXTURE, CURRENT); untextured geometry must still come out as its diffuse colour, as in the D3D9 SDK tutorials.)
      if (!hasTexture && stageUsesTexture(t, o)) break;
      const tcIndex = t[o + D3DTSS.TEXCOORDINDEX]!;
      const ttff = t[o + D3DTSS.TEXTURETRANSFORMFLAGS]!;
      stages.push({
        index: i,
        colorOp: t[o + D3DTSS.COLOROP]!, colorArg0: t[o + D3DTSS.COLORARG0]!, colorArg1: t[o + D3DTSS.COLORARG1]!, colorArg2: t[o + D3DTSS.COLORARG2]!,
        alphaOp: t[o + D3DTSS.ALPHAOP]!, alphaArg0: t[o + D3DTSS.ALPHAARG0]!, alphaArg1: t[o + D3DTSS.ALPHAARG1]!, alphaArg2: t[o + D3DTSS.ALPHAARG2]!,
        resultTemp: t[o + D3DTSS.RESULTARG] === D3DTA.TEMP,
        texCoordSet: tcIndex & 7,
        tci: tcIndex & 0xffff0000,
        ttffCount: ttff & 0xff,
        projected: (ttff & D3DTTFF.PROJECTED) !== 0,
        hasTexture,
      });
    }
    let fogSource: FogSource = "none", fogMode: number = D3DFOG.NONE;
    if (rs[D3DRS.FOGENABLE]) {
      if (rs[D3DRS.FOGTABLEMODE] !== D3DFOG.NONE) { fogSource = "table"; fogMode = rs[D3DRS.FOGTABLEMODE]!; }
      else if (rs[D3DRS.FOGVERTEXMODE] !== D3DFOG.NONE) { fogSource = "vertex"; fogMode = rs[D3DRS.FOGVERTEXMODE]!; }
    }
    return {
      layouts, rhw, xyzw, lighting, lights,
      matSource: [ms(D3DRS.DIFFUSEMATERIALSOURCE), ms(D3DRS.SPECULARMATERIALSOURCE), ms(D3DRS.AMBIENTMATERIALSOURCE), ms(D3DRS.EMISSIVEMATERIALSOURCE)],
      specular: !!rs[D3DRS.SPECULARENABLE], localViewer: !!rs[D3DRS.LOCALVIEWER], normalize: !!rs[D3DRS.NORMALIZENORMALS],
      fogSource, fogMode, rangeFog: !!rs[D3DRS.RANGEFOGENABLE],
      stages,
      alphaFunc: rs[D3DRS.ALPHATESTENABLE] ? rs[D3DRS.ALPHAFUNC]! : 0,
      flatShade: rs[D3DRS.SHADEMODE] === D3DSHADE.FLAT,
    };
  }

  // =========================================================================================== uniform + bindings
  private blockView(a: ArenaAlloc, floats: number): Float32Array {
    return new Float32Array(a.chunk.cpu.buffer, a.chunk.cpu.byteOffset + a.offset, floats);
  }

  private uniformBindGroup(desc: ProgramDesc, rhw: boolean): { group: GPUBindGroup; offsets: number[] } {
    const st = this.state;
    const rt = this.renderTarget, vp = st.viewport;
    // ---- transforms
    const w = rhw ? rt.width : vp.width, h = rhw ? rt.height : vp.height;
    if (!this.xform || this.xform.verT !== st.versionTransform || this.xform.screen2 !== w || this.xform.screen3 !== h) {
      const alloc = this.arena.alloc(XFORM.size * 4, BLOCK_ALIGN);
      const f = this.blockView(alloc, XFORM.size);
      const world = st.getTransform(D3DTS_WORLD), view = st.getTransform(D3DTS.VIEW), proj = st.getTransform(D3DTS.PROJECTION);
      const wv = matMultiply(world, view);
      const wvp = matMultiply(wv, proj);
      const inv = matInverse(wv);
      const nrm = inv ? matTranspose(inv.matrix) : wv;
      f.set(world, XFORM.world); f.set(view, XFORM.view); f.set(proj, XFORM.proj); f.set(wv, XFORM.wv); f.set(wvp, XFORM.wvp); f.set(nrm, XFORM.nrm);
      for (let i = 0; i < 8; i++) f.set(st.getTransform(D3DTS.TEXTURE0 + i), XFORM.tex + i * 16);
      f.set([1 / w, 1 / h, w, h], XFORM.screen);
      this.xform = { alloc, verT: st.versionTransform, screen0: 1 / w, screen1: 1 / h, screen2: w, screen3: h };
    }
    // ---- lighting
    const lkey = desc.lights.join("");
    if (!this.light || this.light.ver !== st.versionLighting || this.light.nLights !== lkey) {
      const alloc = this.arena.alloc(LIGHTB.size * 4, BLOCK_ALIGN);
      const f = this.blockView(alloc, LIGHTB.size);
      const m = st.material;
      f.set([m.diffuse.r, m.diffuse.g, m.diffuse.b, m.diffuse.a], LIGHTB.matDiffuse);
      f.set([m.ambient.r, m.ambient.g, m.ambient.b, m.ambient.a], LIGHTB.matAmbient);
      f.set([m.specular.r, m.specular.g, m.specular.b, m.specular.a], LIGHTB.matSpecular);
      f.set([m.emissive.r, m.emissive.g, m.emissive.b, m.emissive.a], LIGHTB.matEmissive);
      f.set([m.power, 0, 0, 0], LIGHTB.matPower);
      const amb = st.renderStates[D3DRS.AMBIENT]!;
      f.set([((amb >>> 16) & 255) / 255, ((amb >>> 8) & 255) / 255, (amb & 255) / 255, ((amb >>> 24) & 255) / 255], LIGHTB.ambient);
      const view = st.getTransform(D3DTS.VIEW);
      let slot = 0;
      for (const i of [...st.lightEnabled].sort((x, y) => x - y)) {
        const l = st.lights.get(i);
        if (!l || slot >= 8) continue;
        const o = LIGHTB.lights + slot * LIGHTB.lightStride;
        const pv = vec3Transform(l.position, view);
        const dv = vec3Normalize(vec3TransformNormal(l.direction, view));
        f.set([l.diffuse.r, l.diffuse.g, l.diffuse.b, l.diffuse.a, l.specular.r, l.specular.g, l.specular.b, l.specular.a, l.ambient.r, l.ambient.g, l.ambient.b, l.ambient.a], o);
        f.set([pv.x, pv.y, pv.z, l.type], o + 12);
        f.set([dv.x, dv.y, dv.z, l.range], o + 16);
        f.set([l.attenuation0, l.attenuation1, l.attenuation2, l.falloff], o + 20);
        f.set([Math.cos(l.theta / 2), Math.cos(l.phi / 2), 0, 0], o + 24);
        slot++;
      }
      this.light = { alloc, ver: st.versionLighting, nLights: lkey };
    }
    // ---- misc
    if (!this.misc || this.misc.ver !== st.versionMisc) {
      const alloc = this.arena.alloc(MISC.size * 4, BLOCK_ALIGN);
      const f = this.blockView(alloc, MISC.size);
      const rs = st.renderStates;
      const col = (c: number): number[] => [((c >>> 16) & 255) / 255, ((c >>> 8) & 255) / 255, (c & 255) / 255, ((c >>> 24) & 255) / 255];
      f.set(col(rs[D3DRS.TEXTUREFACTOR]!), MISC.tfactor);
      f.set(col(rs[D3DRS.FOGCOLOR]!), MISC.fogColor);
      f.set([dwordToFloat(rs[D3DRS.FOGSTART]!), dwordToFloat(rs[D3DRS.FOGEND]!), dwordToFloat(rs[D3DRS.FOGDENSITY]!), 0], MISC.fogParams);
      f.set([rs[D3DRS.ALPHAREF]! & 255, 0, 0, 0], MISC.alphaRef);
      for (let i = 0; i < 8; i++) f.set(col(st.tss[i * NUM_TSS + D3DTSS.CONSTANT]!), MISC.stageConst + i * 4);
      for (let i = 0; i < 8; i++) f[MISC.lodBias + i] = dwordToFloat(st.samp[i * NUM_SAMP + D3DSAMP.MIPMAPLODBIAS]!);
      this.misc = { alloc, ver: st.versionMisc };
    }
    const x = this.xform.alloc, l = this.light.alloc, m = this.misc.alloc;
    const key = `${x.chunk.id}.${l.chunk.id}.${m.chunk.id}`;
    let group = this.bindGroups0.get(key);
    if (!group) {
      group = this.gpu.createBindGroup({
        layout: this.bgl0,
        entries: [
          { binding: 0, resource: { buffer: x.chunk.gpu, offset: 0, size: XFORM.size * 4 } },
          { binding: 1, resource: { buffer: l.chunk.gpu, offset: 0, size: LIGHTB.size * 4 } },
          { binding: 2, resource: { buffer: m.chunk.gpu, offset: 0, size: MISC.size * 4 } },
        ],
      });
      this.bindGroups0.set(key, group);
    }
    return { group, offsets: [x.offset, l.offset, m.offset] };
  }

  private samplerFor(slot: number): GPUSampler {
    const d = samplerDescriptor(this.state.samp, slot);
    const k = samplerKey(d);
    let s = this.samplers.get(k);
    if (!s) { s = this.gpu.createSampler(d); this.samplers.set(k, s); }
    return s;
  }

  private textureBindGroup(desc: ProgramDesc): GPUBindGroup {
    const entries: GPUBindGroupEntry[] = [];
    const keyParts: string[] = [];
    const used = new Set(desc.stages.filter((s) => s.hasTexture).map((s) => s.index));
    for (let i = 0; i < 8; i++) {
      const tex = used.has(i) ? this.textures[i]! : null;
      const view = tex ? tex.view() : this.dummyView;
      const sampler = tex ? this.samplerFor(i) : this.defaultSampler;
      const sk = tex ? samplerKey(samplerDescriptor(this.state.samp, i)) : "d";
      entries.push({ binding: i * 2, resource: view }, { binding: i * 2 + 1, resource: sampler });
      keyParts.push(`${tex ? tex.gpuId : 0}.${sk}`);
    }
    const key = keyParts.join("|");
    const views = entries.filter((_, i) => i % 2 === 0).map((e) => e.resource as GPUTextureView);
    let g = this.bindGroups1.get(key);
    // a texture that was renamed (new GPU object, new view) invalidates the cached group
    if (g && g.views.some((v, i) => v !== views[i])) g = undefined;
    if (!g) { g = { group: this.gpu.createBindGroup({ layout: this.bgl1, entries }), views }; this.bindGroups1.set(key, g); }
    return g.group;
  }

  /** Free GPU objects (tests call this to check for leaks of validation errors at teardown). */
  destroy(): void {
    this.flush();
    this.backBuffer.Release();
    this.autoDepth?.Release();
    this.dummyTexture.destroy();
    this.opts.gpu.destroy();
  }
}

/** Does the stage at `t[o..]` read its texture (an argument is D3DTA_TEXTURE, or the op blends by the texture's alpha)? */
function stageUsesTexture(t: Uint32Array, o: number): boolean {
  const isTex = (a: number): boolean => (a & D3DTA.SELECTMASK) === D3DTA.TEXTURE;
  const cop = t[o + D3DTSS.COLOROP]!, aop = t[o + D3DTSS.ALPHAOP]!;
  const uses = (op: number, a0: number, a1: number, a2: number): boolean => {
    switch (op) {
      case D3DTOP.DISABLE: return false;
      case D3DTOP.SELECTARG1: return isTex(a1);
      case D3DTOP.SELECTARG2: return isTex(a2);
      case D3DTOP.BLENDTEXTUREALPHA: case D3DTOP.BLENDTEXTUREALPHAPM: case D3DTOP.BUMPENVMAP: case D3DTOP.BUMPENVMAPLUMINANCE: return true;
      case D3DTOP.MULTIPLYADD: case D3DTOP.LERP: return isTex(a0) || isTex(a1) || isTex(a2);
      default: return isTex(a1) || isTex(a2);
    }
  };
  return uses(cop, t[o + D3DTSS.COLORARG0]!, t[o + D3DTSS.COLORARG1]!, t[o + D3DTSS.COLORARG2]!)
    || (cop !== D3DTOP.DOTPRODUCT3 && uses(aop, t[o + D3DTSS.ALPHAARG0]!, t[o + D3DTSS.ALPHAARG1]!, t[o + D3DTSS.ALPHAARG2]!));
}

interface DrawArgs {
  prim: number; primCount: number; indexed: boolean;
  baseVertex: number; minVertex: number; numVertices: number; startIndex: number;
  userVertices?: Uint8Array; userStride?: number; userIndices?: Uint8Array; userIndex32?: boolean;
}

/** Triangle fan -> triangle list indices.  `src` null = sequential vertices 0..n+1. */
function fanIndices(src: Uint16Array | Uint32Array | null, primCount: number, is32: boolean): Uint16Array | Uint32Array {
  const out = is32 ? new Uint32Array(primCount * 3) : new Uint16Array(primCount * 3);
  for (let i = 0; i < primCount; i++) {
    out[i * 3] = src ? src[0]! : 0;
    out[i * 3 + 1] = src ? src[i + 1]! : i + 1;
    out[i * 3 + 2] = src ? src[i + 2]! : i + 2;
  }
  return out;
}

export { D3DCMP, D3DLIGHT, D3DPT, D3DTEXF, d3dtsWorldMatrix, D3DCOLORWRITEENABLE, D3DFVF, D3DTSS_TCI };
