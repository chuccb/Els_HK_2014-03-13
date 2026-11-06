/**
 * D3D9 resource objects (vertex/index buffers, textures, surfaces, vertex declarations) over WebGPU.
 *
 * Every lockable resource keeps a CPU shadow in D3D's native layout; `Lock*` hands out views into it and the GPU copy is refreshed
 * lazily when the device next needs it.  The hazard rules (the GPU only sees data when the encoder is submitted, but `queue.write*`
 * executes immediately): data written after the resource was used by a not-yet-submitted draw is written to a *fresh* GPU object
 * ("renaming", like a driver does for D3DLOCK_DISCARD) unless the lock promised not to overwrite data in flight (NOOVERWRITE).
 */
import { D3DLOCK, D3DPOOL, D3DUSAGE, D3DFMT, D3DRTYPE } from "./enums.ts";
import { formatInfo, fromRgba8, mipSize, surfaceBytes, surfacePitch, toRgba8 } from "./formats.ts";
import type { VertexElement } from "./vertex.ts";
import { D3DERR_INVALIDCALL, D3D_OK } from "./hresult.ts";

/** What resources need from the device that owns them. */
export interface ResourceHost {
  readonly gpu: GPUDevice;
  /** counts queue submissions; a resource whose `lastUseEpoch` equals it is referenced by a recorded, unsubmitted draw */
  readonly epoch: number;
  readonly hasBC: boolean;
}

export abstract class D3DResource {
  private refs = 1;
  constructor(readonly host: ResourceHost) {}
  AddRef(): number { return ++this.refs; }
  Release(): number {
    if (this.refs <= 0) return 0;
    if (--this.refs === 0) this.destroy();
    return this.refs;
  }
  protected destroy(): void {}
}

const align4 = (n: number): number => (n + 3) & ~3;

// ----------------------------------------------------------------------------------------------------- buffers
abstract class BufferBase extends D3DResource {
  readonly cpu: Uint8Array;
  gpu: GPUBuffer | null = null;
  lastUseEpoch = -1;
  private dirtyLo = Infinity;
  private dirtyHi = 0;
  private dirtyKeep = true; // every pending write promised not to touch data in flight
  private lockOff = 0;
  private lockLen = 0;
  private lockFlags = 0;
  private locked = false;
  protected abstract readonly gpuUsage: number;

  constructor(host: ResourceHost, readonly length: number, readonly usage: number, readonly pool: number) {
    super(host);
    this.cpu = new Uint8Array(align4(length));
  }

  get isDynamic(): boolean { return (this.usage & D3DUSAGE.DYNAMIC) !== 0; }

  /** `Lock`: size 0 = to the end of the buffer.  The returned view aliases the shadow. */
  Lock(offset: number, size: number, flags: number): { hr: number; data: Uint8Array | null } {
    if (this.locked || offset < 0 || offset > this.length || size < 0 || (size !== 0 && offset + size > this.length)) return { hr: D3DERR_INVALIDCALL, data: null };
    const len = size === 0 ? this.length - offset : size;
    this.locked = true;
    this.lockOff = offset; this.lockLen = len; this.lockFlags = flags;
    return { hr: D3D_OK, data: this.cpu.subarray(offset, offset + len) };
  }

  Unlock(): number {
    if (!this.locked) return D3DERR_INVALIDCALL;
    this.locked = false;
    if (!(this.lockFlags & D3DLOCK.READONLY)) this.markDirty(this.lockOff, this.lockLen, (this.lockFlags & D3DLOCK.NOOVERWRITE) !== 0);
    return D3D_OK;
  }

  /** Content written directly into `cpu` (by D3DX-style helpers) must be announced. */
  markDirty(offset: number, length: number, noOverwrite = false): void {
    this.dirtyLo = Math.min(this.dirtyLo, offset);
    this.dirtyHi = Math.max(this.dirtyHi, offset + length);
    if (!noOverwrite) this.dirtyKeep = false;
  }

  /** The persistent GPU copy, brought up to date.  Marks the buffer as used in the pending encoder. */
  gpuBuffer(): GPUBuffer {
    const gpu = this.host.gpu;
    let fresh = false;
    if (!this.gpu) {
      this.gpu = gpu.createBuffer({ size: Math.max(4, this.cpu.length), usage: this.gpuUsage | GPUBufferUsage.COPY_DST });
      fresh = true;
      this.dirtyLo = 0; this.dirtyHi = this.length; this.dirtyKeep = true;
    }
    if (this.dirtyHi > this.dirtyLo) {
      const inFlight = !fresh && this.lastUseEpoch === this.host.epoch;
      if (inFlight && !this.dirtyKeep) {
        // rename: earlier recorded draws keep the old buffer
        this.gpu = gpu.createBuffer({ size: Math.max(4, this.cpu.length), usage: this.gpuUsage | GPUBufferUsage.COPY_DST });
        this.dirtyLo = 0; this.dirtyHi = this.length;
      }
      const lo = this.dirtyLo & ~3, hi = align4(this.dirtyHi);
      gpu.queue.writeBuffer(this.gpu, lo, this.cpu, lo, hi - lo);
      this.dirtyLo = Infinity; this.dirtyHi = 0; this.dirtyKeep = true;
    }
    this.lastUseEpoch = this.host.epoch;
    return this.gpu;
  }

  protected override destroy(): void { this.gpu?.destroy(); this.gpu = null; }
}

export class Direct3DVertexBuffer9 extends BufferBase {
  protected readonly gpuUsage = GPUBufferUsage.VERTEX;
  constructor(host: ResourceHost, length: number, usage: number, readonly fvf: number, pool: number) { super(host, length, usage, pool); }
  GetType(): number { return D3DRTYPE.VERTEXBUFFER; }
  GetDesc() { return { Format: D3DFMT.VERTEXDATA, Type: D3DRTYPE.VERTEXBUFFER, Usage: this.usage, Pool: this.pool, Size: this.length, FVF: this.fvf }; }
}

export class Direct3DIndexBuffer9 extends BufferBase {
  protected readonly gpuUsage = GPUBufferUsage.INDEX;
  constructor(host: ResourceHost, length: number, usage: number, readonly format: number, pool: number) { super(host, length, usage, pool); }
  get is32(): boolean { return this.format === D3DFMT.INDEX32; }
  GetType(): number { return D3DRTYPE.INDEXBUFFER; }
  GetDesc() { return { Format: this.format, Type: D3DRTYPE.INDEXBUFFER, Usage: this.usage, Pool: this.pool, Size: this.length }; }
}

export class Direct3DVertexDeclaration9 extends D3DResource {
  constructor(host: ResourceHost, readonly elements: readonly VertexElement[]) { super(host); }
  GetDeclaration(): VertexElement[] { return [...this.elements]; }
}

// ------------------------------------------------------------------------------------------------------ textures
export interface SurfaceDesc { Format: number; Type: number; Usage: number; Pool: number; MultiSampleType: number; MultiSampleQuality: number; Width: number; Height: number }
export interface D3DRect { left: number; top: number; right: number; bottom: number }

/** A rendering target / depth buffer / texture level handle (IDirect3DSurface9). */
export class Direct3DSurface9 extends D3DResource {
  /** only for render targets that are not textures (back buffer, CreateRenderTarget) and depth buffers */
  private ownTexture: GPUTexture | null = null;
  constructor(
    host: ResourceHost, readonly width: number, readonly height: number, readonly format: number, readonly usage: number, readonly pool: number,
    readonly owner: Direct3DTexture9 | null, readonly level: number,
    /** the GPU texture for non-texture-owned surfaces (back buffer, depth) */
    gpuTexture?: GPUTexture, readonly sampleCount = 1,
  ) {
    super(host);
    if (gpuTexture) this.ownTexture = gpuTexture;
  }
  GetDesc(): SurfaceDesc {
    return { Format: this.format, Type: D3DRTYPE.SURFACE, Usage: this.usage, Pool: this.pool, MultiSampleType: 0, MultiSampleQuality: 0, Width: this.width, Height: this.height };
  }
  GetContainer(): Direct3DTexture9 | null { return this.owner; }
  get isDepth(): boolean { return !!formatInfo(this.format)?.depth; }
  /** the GPU texture backing the surface */
  get texture(): GPUTexture { return this.owner ? this.owner.gpuTexture() : this.ownTexture!; }
  /** a single-level 2D view usable as a render attachment */
  renderView(): GPUTextureView {
    return this.texture.createView({ baseMipLevel: this.level, mipLevelCount: 1, dimension: "2d" });
  }
  get gpuFormat(): GPUTextureFormat { return this.texture.format; }
  LockRect(rect: D3DRect | null, flags: number): { hr: number; pBits: Uint8Array | null; pitch: number } {
    if (!this.owner) return { hr: D3DERR_INVALIDCALL, pBits: null, pitch: 0 };
    return this.owner.LockRect(this.level, rect, flags);
  }
  UnlockRect(): number { return this.owner ? this.owner.UnlockRect(this.level) : D3DERR_INVALIDCALL; }
  protected override destroy(): void { this.ownTexture?.destroy(); this.ownTexture = null; }
}

export class Direct3DTexture9 extends D3DResource {
  readonly levels: number;
  private tex: GPUTexture | null = null;
  private shadow: (Uint8Array | null)[] = [];
  private dirty: boolean[] = [];
  private locked: boolean[] = [];
  private viewCache: GPUTextureView | null = null;
  lastUseEpoch = -1;
  /** true once the GPU texture was created compressed (BC) */
  private gpuCompressed = false;
  private surfaces: (Direct3DSurface9 | undefined)[] = [];

  constructor(host: ResourceHost, readonly width: number, readonly height: number, levels: number, readonly usage: number, readonly format: number, readonly pool: number) {
    super(host);
    const info = formatInfo(format);
    if (!info) throw new Error(`unsupported texture format ${format}`);
    const maxLevels = 32 - Math.clz32(Math.max(width, height));
    this.levels = levels === 0 ? maxLevels : Math.min(levels, maxLevels);
    this.isRenderTarget = (usage & D3DUSAGE.RENDERTARGET) !== 0;
    this.isDepth = info.depth;
    if (!this.isRenderTarget && !this.isDepth) {
      for (let l = 0; l < this.levels; l++) {
        this.shadow.push(new Uint8Array(surfaceBytes(format, mipSize(width, l), mipSize(height, l))));
        this.dirty.push(true);
        this.locked.push(false);
      }
    }
  }
  readonly isRenderTarget: boolean;
  readonly isDepth: boolean;

  GetType(): number { return D3DRTYPE.TEXTURE; }
  GetLevelCount(): number { return this.levels; }
  GetLevelDesc(level: number): SurfaceDesc | null {
    if (level < 0 || level >= this.levels) return null;
    return { Format: this.format, Type: D3DRTYPE.SURFACE, Usage: this.usage, Pool: this.pool, MultiSampleType: 0, MultiSampleQuality: 0, Width: mipSize(this.width, level), Height: mipSize(this.height, level) };
  }
  GetSurfaceLevel(level: number): Direct3DSurface9 | null {
    if (level < 0 || level >= this.levels) return null;
    let s = this.surfaces[level];
    if (!s) {
      s = new Direct3DSurface9(this.host, mipSize(this.width, level), mipSize(this.height, level), this.format, this.usage, this.pool, this, level);
      this.surfaces[level] = s;
    } else s.AddRef();
    return s;
  }

  LockRect(level: number, rect: D3DRect | null, flags: number): { hr: number; pBits: Uint8Array | null; pitch: number } {
    const sh = this.shadow[level];
    if (!sh || this.locked[level]) return { hr: D3DERR_INVALIDCALL, pBits: null, pitch: 0 };
    const w = mipSize(this.width, level), h = mipSize(this.height, level);
    const info = formatInfo(this.format)!;
    const pitch = surfacePitch(this.format, w);
    let offset = 0;
    if (rect) {
      if (rect.left < 0 || rect.top < 0 || rect.right > w || rect.bottom > h || rect.left >= rect.right || rect.top >= rect.bottom) return { hr: D3DERR_INVALIDCALL, pBits: null, pitch: 0 };
      offset = info.compressed ? (rect.top >> 2) * pitch + (rect.left >> 2) * info.bytes : rect.top * pitch + rect.left * info.bytes;
    }
    this.locked[level] = true;
    if (!(flags & D3DLOCK.READONLY)) this.dirty[level] = true;
    return { hr: D3D_OK, pBits: sh.subarray(offset), pitch };
  }
  UnlockRect(level: number): number {
    if (!this.locked[level]) return D3DERR_INVALIDCALL;
    this.locked[level] = false;
    return D3D_OK;
  }

  /** Replace a whole level with RGBA8 data converted to this texture's native format (used by the D3DX-style loaders). */
  setLevelFromRgba8(level: number, rgba: Uint8Array): void {
    const w = mipSize(this.width, level), h = mipSize(this.height, level);
    const sh = this.shadow[level];
    if (!sh) throw new Error("cannot fill a render target / depth texture");
    const info = formatInfo(this.format)!;
    if (info.compressed) throw new Error("compressed textures are filled with their native data");
    fromRgba8(this.format, rgba, w, h, sh, surfacePitch(this.format, w));
    this.dirty[level] = true;
  }

  /** The GPU texture with all dirty levels uploaded.  Marks the texture as used in the pending encoder. */
  gpuTexture(): GPUTexture {
    const gpu = this.host.gpu;
    const info = formatInfo(this.format)!;
    let fresh = false;
    if (!this.tex) {
      this.createGpu();
      fresh = true;
    }
    if (!this.isRenderTarget && !this.isDepth && this.dirty.some(Boolean)) {
      if (!fresh && this.lastUseEpoch === this.host.epoch) {
        // rename so that recorded draws still see the old contents
        this.createGpu();
        this.dirty.fill(true);
      }
      for (let l = 0; l < this.levels; l++) {
        if (!this.dirty[l]) continue;
        this.dirty[l] = false;
        const w = mipSize(this.width, l), h = mipSize(this.height, l);
        const sh = this.shadow[l]!;
        if (info.compressed && this.gpuCompressed) {
          const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
          gpu.queue.writeTexture({ texture: this.tex!, mipLevel: l }, sh, { bytesPerRow: bw * info.bytes, rowsPerImage: bh }, [bw * 4, bh * 4]);
        } else {
          const rgba = toRgba8(this.format, sh, w, h, surfacePitch(this.format, w));
          gpu.queue.writeTexture({ texture: this.tex!, mipLevel: l }, rgba, { bytesPerRow: w * 4, rowsPerImage: h }, [w, h]);
        }
      }
    }
    this.lastUseEpoch = this.host.epoch;
    return this.tex!;
  }

  /** A full view for sampling. */
  view(): GPUTextureView {
    const t = this.gpuTexture();
    if (!this.viewCache || this.viewTexture !== t) { this.viewCache = t.createView(); this.viewTexture = t; }
    return this.viewCache;
  }
  private viewTexture: GPUTexture | null = null;
  get gpuId(): number { return this.id; }
  private readonly id = ++textureIds;

  private createGpu(): void {
    const info = formatInfo(this.format)!;
    let format: GPUTextureFormat = info.gpu ?? "rgba8unorm";
    this.gpuCompressed = false;
    if (info.compressed && this.host.hasBC && this.width % 4 === 0 && this.height % 4 === 0) { format = info.gpuBc!; this.gpuCompressed = true; }
    else if (info.compressed) format = "rgba8unorm";
    let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    if (this.isRenderTarget || this.isDepth) usage |= GPUTextureUsage.RENDER_ATTACHMENT;
    this.tex = this.host.gpu.createTexture({ size: [this.width, this.height], mipLevelCount: this.levels, format, usage });
    this.viewCache = null;
    // surfaces handed out earlier follow the texture (they call owner.gpuTexture() each time)
  }

  protected override destroy(): void { this.tex?.destroy(); this.tex = null; }
}
let textureIds = 0;

export { D3DPOOL };
