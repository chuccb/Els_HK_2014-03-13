/**
 * The fakes the movie tests share: a Direct3D device that writes down the calls a render target texture and a video texture make (the textures it makes
 * hold their pixels in a plain byte array with a row pitch that is not the row's size), and a world that draws on it.
 */
import { StringTable } from "@els/assets";
import { D3DFMT } from "@els/d3d9";
import type { Direct3DDevice9 } from "@els/d3d9";
import { VertexUI4 } from "../src/index.ts";
import { Recorder, verts } from "./rig.ts";
import { setup } from "./harness.ts";

export const E_FAIL = -2147467259;

/** a surface of the fake device: counts its references */
export class Surface {
  refs = 1;
  constructor(readonly name: string, readonly format: number) {}
  AddRef(): number { return ++this.refs; }
  Release(): number { return --this.refs; }
  GetDesc(): { Format: number; MultiSampleType: number; MultiSampleQuality: number } { return { Format: this.format, MultiSampleType: 0, MultiSampleQuality: 0 }; }
}

/** a texture of the fake device: its pixels start as 0xAA, the rows are `pitch` bytes apart */
export class FakeTexture {
  refs = 1;
  locks = 0;
  unlocks = 0;
  lockHr = 0;
  readonly bits: Uint8Array;
  readonly surface: Surface;
  surfaceGiven = true;
  constructor(readonly id: number, readonly width: number, readonly height: number, readonly levels: number, readonly usage: number, readonly format: number, readonly pool: number, readonly pitch: number) {
    this.bits = new Uint8Array(pitch * height).fill(0xaa);
    this.surface = new Surface(`level0 of tex${id}`, format);
  }
  get name(): string { return `tex${this.id}`; }
  AddRef(): number { return ++this.refs; }
  Release(): number { return --this.refs; }
  LockRect(level: number, rect: unknown, flags: number): { hr: number; pBits: Uint8Array | null; pitch: number } {
    void level; void rect; void flags;
    this.locks++;
    return { hr: this.lockHr, pBits: this.lockHr < 0 ? null : this.bits, pitch: this.pitch };
  }
  UnlockRect(): number { this.unlocks++; return 0; }
  GetSurfaceLevel(level: number): Surface | null { return level === 0 && this.surfaceGiven ? this.surface : null; }
}

/** the bytes of a pixel of the formats the tests make textures of */
const BYTES: Record<number, number> = { [D3DFMT.A8R8G8B8]: 4, [D3DFMT.X8R8G8B8]: 4, [D3DFMT.R8G8B8]: 3, [D3DFMT.R5G6B5]: 2, [D3DFMT.X1R5G5B5]: 2 };

/** a Direct3D device that writes down the calls a render target texture and a video texture make */
export class MovieDevice extends Recorder {
  readonly back = new Surface("back", D3DFMT.A8R8G8B8);
  readonly backZ = new Surface("backZ", D3DFMT.D24S8);
  target: Surface | null = this.back;
  depth: Surface | null = this.backZ;
  textureCaps = 0x100;
  /** bytes added to the row of a texture (a pitch that is not the row's size) */
  pitchPadding = 8;
  failGetTarget = false;
  failGetDepth = false;
  failDepthCreate = false;
  failSetTexture = false;
  /** the textures made from now on give no level 0 (`GetSurfaceLevel` fails) */
  surfaceMissing = false;
  /** the `usage` of the `CreateTexture` calls that are refused (the call fails, whatever the answers queued) */
  refuseUsage: number | null = null;
  readonly made: FakeTexture[] = [];
  readonly depths: Surface[] = [];
  override GetDeviceCaps(): { MaxPrimitiveCount: number; MaxTextureWidth: number; MaxTextureHeight: number; TextureCaps: number } {
    return { MaxPrimitiveCount: 0xfffff, MaxTextureWidth: 4096, MaxTextureHeight: 4096, TextureCaps: this.textureCaps };
  }
  override CreateTexture(width: number, height: number, levels: number, usage: number, format: number, pool: number): { hr: number; tex: never | null } {
    const queued = this.textureResults.shift() ?? 0;
    this.log.push(`create ${width}x${height} levels ${levels} usage ${usage} format ${format} pool ${pool}`);
    if (queued < 0 || usage === this.refuseUsage) return { hr: queued < 0 ? queued : -2005530516, tex: null };
    const texture = new FakeTexture(this.made.length, width, height, levels, usage, format, pool, width * (BYTES[format] ?? 4) + this.pitchPadding);
    texture.surfaceGiven = !this.surfaceMissing;
    this.made.push(texture);
    return { hr: 0, tex: texture as never };
  }
  override SetTexture(stage: number, texture: { name: string } | null): number {
    this.log.push(`tex ${stage} ${texture ? texture.name : "null"}`);
    return this.failSetTexture ? E_FAIL : 0;
  }
  GetRenderTarget(): Surface | null { this.log.push("getrt"); return this.failGetTarget ? null : this.target; }
  SetRenderTarget(index: number, surface: Surface | null): number { this.log.push(`settarget ${index} ${surface ? surface.name : "null"}`); this.target = surface; return 0; }
  GetDepthStencilSurface(): Surface | null { this.log.push("getdepth"); return this.failGetDepth ? null : this.depth; }
  SetDepthStencilSurface(surface: Surface | null): number { this.log.push(`setdepth ${surface ? surface.name : "null"}`); this.depth = surface; return 0; }
  CreateDepthStencilSurface(width: number, height: number, format: number): { hr: number; surface: Surface | null } {
    this.log.push(`createz ${width}x${height} format ${format}`);
    if (this.failDepthCreate) return { hr: E_FAIL, surface: null };
    const surface = new Surface(`z${this.depths.length}`, format);
    this.depths.push(surface);
    return { hr: 0, surface };
  }
  Clear(rects: unknown, flags: number, color: number, z: number, stencil: number): number {
    this.log.push(`clear ${rects === null ? "all" : "rects"} ${flags} ${color} ${z} ${stencil}`);
    return 0;
  }
}

/** a world that draws on the movie device; `dvb` is what reached the vertex buffer manager (also written down in the device's log, as `dvb type primitive count draws`) */
export function movieWorld() {
  const dev = new MovieDevice();
  const s = setup(new StringTable([]), { device: dev as unknown as Direct3DDevice9, backBuffer: { width: 1536, height: 1536 } });
  const render = s.w.render!;
  const dvb: { type: number; primitive: number; count: number; draws: number; data: Uint8Array; texture: unknown }[] = [];
  render.dvb.drawPrimitive = (type, primitive, count, data, draws) => {
    dev.log.push(`dvb ${type} ${primitive} ${count} ${draws}`);
    dvb.push({ type, primitive, count, draws, data: data!.slice(), texture: render.states.apd3dTextures[0] });
  };
  dev.log.length = 0; // what bringing the device to the baseline cost is pinned by a test of its own
  return { ...s, dev, render, dvb };
}

/** the four vertices a `drawPrimitive` was given */
export function quadOf(data: Uint8Array): number[][] {
  const v = new VertexUI4();
  v.bytes.set(data);
  return verts(v);
}

