/**
 * Test helper: a Dawn (node WebGPU) device, or null when this machine has no adapter (no GPU and no software Vulkan driver;
 * `./tools/setup-gpu.sh` + `./tools/gpu.sh` provide SwiftShader).  GPU tests skip themselves on null.
 */
import { create, globals } from "webgpu";
import { encodePng } from "@els/assets";
import { Direct3DDevice9, D3DFMT, fvfToElements } from "../src/index.ts";
import type { DeviceOptions } from "../src/index.ts";
import { writeFileSync, mkdirSync } from "node:fs";

let gpuInstance: GPU | undefined;
let available: Promise<boolean> | undefined;

/** Dawn hands out each adapter once, so every device gets a fresh adapter. */
async function requestAdapter(): Promise<GPUAdapter | null> {
  try {
    Object.assign(globalThis, globals);
    gpuInstance ??= create([]);
    return await gpuInstance.requestAdapter();
  } catch {
    return null;
  }
}

export function gpuAvailable(): Promise<boolean> {
  available ??= requestAdapter().then((a) => a !== null);
  return available;
}

export async function newGpuDevice(): Promise<GPUDevice> {
  const a = await requestAdapter();
  if (!a) throw new Error("no WebGPU adapter");
  const features = (["texture-compression-bc"] as GPUFeatureName[]).filter((f) => a.features.has(f));
  return a.requestDevice({ requiredFeatures: features });
}

export async function newD3D9(width = 64, height = 64, extra: Partial<DeviceOptions> = {}): Promise<Direct3DDevice9> {
  const gpu = await newGpuDevice();
  return new Direct3DDevice9({ gpu, width, height, backBufferFormat: D3DFMT.X8R8G8B8, warn: () => {}, ...extra });
}

export interface Px { r: number; g: number; b: number; a: number }
export class Image {
  constructor(readonly width: number, readonly height: number, readonly rgba: Uint8Array) {}
  at(x: number, y: number): Px { const o = (y * this.width + x) * 4; return { r: this.rgba[o]!, g: this.rgba[o + 1]!, b: this.rgba[o + 2]!, a: this.rgba[o + 3]! }; }
  /** pixels (x,y) that differ from `bg` */
  count(pred: (p: Px) => boolean): number { let n = 0; for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) if (pred(this.at(x, y))) n++; return n; }
  save(name: string): void {
    const dir = process.env.D3D9_TEST_OUT;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${name}.png`, encodePng(this.rgba, this.width, this.height));
  }
}
export async function snap(dev: Direct3DDevice9): Promise<Image> {
  const r = await dev.readPixels();
  return new Image(r.width, r.height, r.rgba);
}

/** Pack vertices (floats + D3DCOLOR dwords) of a given FVF into bytes.  Each vertex is an array of numbers; colour fields are integers. */
export function packVertices(fvf: number, verts: number[][]): { bytes: Uint8Array; stride: number } {
  const { elements, stride } = fvfToElements(fvf);
  const bytes = new Uint8Array(stride * verts.length);
  const dv = new DataView(bytes.buffer);
  verts.forEach((v, i) => {
    let k = 0;
    for (const e of elements) {
      const o = i * stride + e.offset;
      const n = e.type === 4 /* D3DCOLOR */ || e.type === 5 ? 1 : e.type + 1;
      if (e.type === 4) dv.setUint32(o, v[k++]! >>> 0, true);
      else for (let c = 0; c < n; c++) dv.setFloat32(o + c * 4, v[k++]!, true);
    }
  });
  return { bytes, stride };
}

export const near = (a: number, b: number, tol = 1): boolean => Math.abs(a - b) <= tol;
export const argb = (a: number, r: number, g: number, b: number): number => (((a << 24) | (r << 16) | (g << 8) | b) >>> 0);

// ------------------------------------------------------------------------------------------------ drawing helpers
import { D3DPT, D3DRS, D3DCULL, D3DTOP, D3DTA, D3DTSS, D3DTEXF, D3DSAMP, D3DUSAGE, D3DPOOL, Direct3DTexture9 } from "../src/index.ts";

/** Draw an axis-aligned pre-transformed quad (x0,y0)-(x1,y1) with 4 colours (TL, TR, BL, BR) and optional texture coordinates. */
export function drawRhwQuad(dev: Direct3DDevice9, x0: number, y0: number, x1: number, y1: number, colors: number | [number, number, number, number], uv?: [number, number, number, number], z = 0.5): number {
  const c: number[] = typeof colors === "number" ? [colors, colors, colors, colors] : colors;
  const fvf = 0x4 /* XYZRHW */ | 0x40 /* DIFFUSE */ | (uv ? 0x100 : 0);
  const [u0, v0, u1, v1] = uv ?? [0, 0, 0, 0];
  const verts = [
    [x0, y0, z, 1, c[0]!, ...(uv ? [u0, v0] : [])],
    [x1, y0, z, 1, c[1]!, ...(uv ? [u1, v0] : [])],
    [x0, y1, z, 1, c[2]!, ...(uv ? [u0, v1] : [])],
    [x1, y1, z, 1, c[3]!, ...(uv ? [u1, v1] : [])],
  ];
  const { bytes, stride } = packVertices(fvf, verts);
  dev.SetFVF(fvf);
  return dev.DrawPrimitiveUP(D3DPT.TRIANGLESTRIP, 2, bytes, stride);
}

/** A texture filled from RGBA8 (point sampled, clamped). */
export function makeTexture(dev: Direct3DDevice9, w: number, h: number, rgba: number[] | Uint8Array, format = 21 /* A8R8G8B8 */): Direct3DTexture9 {
  const { hr, tex } = dev.CreateTexture(w, h, 1, 0, format, D3DPOOL.MANAGED);
  if (hr < 0 || !tex) throw new Error(`CreateTexture failed ${hr}`);
  tex.setLevelFromRgba8(0, rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba));
  return tex;
}

export function pointSample(dev: Direct3DDevice9, stage = 0): void {
  dev.SetSamplerState(stage, D3DSAMP.MAGFILTER, D3DTEXF.POINT);
  dev.SetSamplerState(stage, D3DSAMP.MINFILTER, D3DTEXF.POINT);
  dev.SetSamplerState(stage, D3DSAMP.MIPFILTER, D3DTEXF.NONE);
  dev.SetSamplerState(stage, D3DSAMP.ADDRESSU, 3 /* CLAMP */);
  dev.SetSamplerState(stage, D3DSAMP.ADDRESSV, 3);
}

export function initFixed(dev: Direct3DDevice9): void {
  dev.SetRenderState(D3DRS.LIGHTING, 0);
  dev.SetRenderState(D3DRS.CULLMODE, D3DCULL.NONE);
}
export { D3DTOP, D3DTA, D3DTSS, D3DUSAGE };
