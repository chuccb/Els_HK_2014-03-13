/** Texture formats: native memory layouts through LockRect, sampled colours, BC compression with and without GPU support. */
import { describe, expect, test } from "bun:test";
import { D3DCLEAR, D3DFMT, D3DLOCK, D3DPOOL, D3DUSAGE, supportedFormats, surfaceBytes, surfacePitch } from "../src/index.ts";
import type { Direct3DDevice9 } from "../src/index.ts";
import { argb, drawRhwQuad, gpuAvailable, initFixed, near, newD3D9, pointSample, snap } from "./gpu-helper.ts";
import { D3DTA, D3DTOP, D3DTSS } from "../src/index.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;

async function sampleTexel(dev: Direct3DDevice9, fmt: number, bytes: number[], w = 4, h = 4): Promise<number[][]> {
  const { tex, hr } = dev.CreateTexture(w, h, 1, 0, fmt, D3DPOOL.MANAGED);
  expect(hr).toBe(0);
  const l = tex!.LockRect(0, null, 0);
  expect(l.hr).toBe(0);
  l.pBits!.set(bytes);
  tex!.UnlockRect(0);
  initFixed(dev);
  dev.SetTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG1); dev.SetTextureStageState(0, D3DTSS.COLORARG1, D3DTA.TEXTURE);
  dev.SetTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG1); dev.SetTextureStageState(0, D3DTSS.ALPHAARG1, D3DTA.TEXTURE);
  dev.SetTexture(0, tex);
  pointSample(dev);
  dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(7, 7, 7, 7), 1, 0);
  drawRhwQuad(dev, -0.5, -0.5, w - 0.5, h - 0.5, argb(255, 255, 255, 255), [0, 0, 1, 1]);
  const img = await snap(dev);
  expect(await dev.takeErrorsAsync()).toEqual([]);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = img.at(x, y); out.push([p.r, p.g, p.b, p.a]); }
  return out;
}

describe("uncompressed formats (needs a WebGPU adapter)", () => {
  const px16 = (v: number[]): number[] => v.flatMap((x) => [x & 255, x >> 8]);
  const cases: { name: string; fmt: number; bytes: number[]; first: number[]; second: number[] }[] = [
    { name: "A8R8G8B8", fmt: D3DFMT.A8R8G8B8, bytes: [3, 2, 1, 4, 30, 20, 10, 40], first: [1, 2, 3, 4], second: [10, 20, 30, 40] },
    { name: "X8R8G8B8", fmt: D3DFMT.X8R8G8B8, bytes: [3, 2, 1, 4, 30, 20, 10, 40], first: [1, 2, 3, 255], second: [10, 20, 30, 255] },
    { name: "R8G8B8", fmt: D3DFMT.R8G8B8, bytes: [3, 2, 1, 30, 20, 10], first: [1, 2, 3, 255], second: [10, 20, 30, 255] },
    { name: "R5G6B5", fmt: D3DFMT.R5G6B5, bytes: px16([0xf800, 0x07e0]), first: [255, 0, 0, 255], second: [0, 255, 0, 255] },
    { name: "R5G6B5 mid", fmt: D3DFMT.R5G6B5, bytes: px16([(16 << 11) | (32 << 5) | 16, 0x001f]), first: [(16 << 3) | (16 >> 2), (32 << 2) | (32 >> 4), (16 << 3) | (16 >> 2), 255], second: [0, 0, 255, 255] },
    { name: "A1R5G5B5", fmt: D3DFMT.A1R5G5B5, bytes: px16([0x8000 | (31 << 10), 0x001f]), first: [255, 0, 0, 255], second: [0, 0, 255, 0] },
    { name: "X1R5G5B5", fmt: D3DFMT.X1R5G5B5, bytes: px16([31 << 10, 0x3e0]), first: [255, 0, 0, 255], second: [0, 255, 0, 255] },
    { name: "A4R4G4B4", fmt: D3DFMT.A4R4G4B4, bytes: px16([0x8421, 0xf00f]), first: [0x44, 0x22, 0x11, 0x88], second: [0, 0, 255, 255] },
    { name: "X4R4G4B4", fmt: D3DFMT.X4R4G4B4, bytes: px16([0x0f00, 0x00f0]), first: [255, 0, 0, 255], second: [0, 255, 0, 255] },
    { name: "A8", fmt: D3DFMT.A8, bytes: [77, 200], first: [0, 0, 0, 77], second: [0, 0, 0, 200] },
    { name: "L8", fmt: D3DFMT.L8, bytes: [77, 200], first: [77, 77, 77, 255], second: [200, 200, 200, 255] },
    { name: "A8L8", fmt: D3DFMT.A8L8, bytes: [77, 10, 200, 20], first: [77, 77, 77, 10], second: [200, 200, 200, 20] },
  ];
  for (const c of cases) {
    gpuTest(`${c.name}: native bytes -> sampled colour`, async () => {
      const dev = await newD3D9(4, 4, { backBufferFormat: D3DFMT.A8R8G8B8 });
      const bpp = surfacePitch(c.fmt, 1);
      const bytes = new Array<number>(4 * 4 * bpp).fill(0);
      c.bytes.forEach((b, i) => { bytes[i] = b; });
      const out = await sampleTexel(dev, c.fmt, bytes);
      expect(out[0]!.map((v, i) => near(v, c.first[i]!, 1))).toEqual([true, true, true, true]);
      expect(out[1]!.map((v, i) => near(v, c.second[i]!, 1))).toEqual([true, true, true, true]);
    });
  }

  gpuTest("LockRect: sub-rectangles address the right bytes, pitch matches D3D, READONLY keeps data", async () => {
    const dev = await newD3D9(4, 4);
    const { tex } = dev.CreateTexture(8, 8, 1, 0, D3DFMT.A8R8G8B8, D3DPOOL.MANAGED);
    const full = tex!.LockRect(0, null, 0);
    expect(full.pitch).toBe(32);
    full.pBits!.fill(0);
    tex!.UnlockRect(0);
    const part = tex!.LockRect(0, { left: 2, top: 3, right: 5, bottom: 6 }, 0);
    part.pBits![0] = 99;
    tex!.UnlockRect(0);
    const again = tex!.LockRect(0, null, D3DLOCK.READONLY);
    expect(again.pBits![3 * 32 + 2 * 4]).toBe(99);
    tex!.UnlockRect(0);
    // double lock and out-of-range rectangles fail like D3D
    expect(tex!.LockRect(0, null, 0).hr).toBe(0);
    expect(tex!.LockRect(0, null, 0).hr).toBeLessThan(0);
    tex!.UnlockRect(0);
    expect(tex!.LockRect(0, { left: 0, top: 0, right: 9, bottom: 8 }, 0).hr).toBeLessThan(0);
    expect(tex!.LockRect(1, null, 0).hr).toBe(-2005530516); // level 1 does not exist (1 level requested)
  });

  test("format table: sizes of surfaces", () => {
    expect(surfaceBytes(D3DFMT.A8R8G8B8, 5, 3)).toBe(60);
    expect(surfaceBytes(D3DFMT.R8G8B8, 5, 3)).toBe(45);
    expect(surfaceBytes(D3DFMT.DXT1, 5, 3)).toBe(2 * 1 * 8);
    expect(surfaceBytes(D3DFMT.DXT5, 8, 8)).toBe(4 * 16);
    expect(supportedFormats().length).toBeGreaterThan(20);
  });
});

describe("compressed formats: GPU BC and CPU decode agree (needs a WebGPU adapter)", () => {
  // 4x4 blocks: DXT1 colour block + variants
  const c565 = (r: number, g: number, b: number): number[] => { const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3); return [v & 255, v >> 8]; };
  const colorBlock = (c0: number[], c1: number[], idx: number[]): number[] => {
    // idx: 16 two-bit selectors in raster order
    const bits: number[] = [0, 0, 0, 0];
    idx.forEach((v, i) => { bits[i >> 2]! |= v << ((i & 3) * 2); });
    return [...c0, ...c1, ...bits];
  };
  const blockIdx = Array.from({ length: 16 }, (_, i) => i & 3);
  const dxt1 = colorBlock(c565(255, 0, 0), c565(0, 0, 255), blockIdx);
  const dxt3 = [...Array.from({ length: 8 }, (_, i) => (i * 0x22) & 255), ...dxt1];
  const dxt5 = [200, 40, 0, 0, 0, 0, 0, 0, ...dxt1];

  gpuTest("DXT1 / DXT3 / DXT5 texels sampled with BC support equal the CPU decoder", async () => {
    const results: Record<string, number[][][]> = {};
    for (const bc of [true, false]) {
      for (const [name, fmt, data] of [["DXT1", D3DFMT.DXT1, dxt1], ["DXT3", D3DFMT.DXT3, dxt3], ["DXT5", D3DFMT.DXT5, dxt5]] as const) {
        const dev = await newD3D9(4, 4, { backBufferFormat: D3DFMT.A8R8G8B8, ...(bc ? {} : { disableBc: true }) });
        (results[name] ??= [])[bc ? 0 : 1] = await sampleTexel(dev, fmt, [...data]);
      }
    }
    for (const name of ["DXT1", "DXT3", "DXT5"]) {
      const [gpu, cpu] = results[name]!;
      expect(gpu!.length).toBe(16);
      expect({ name, same: gpu!.every((p, i) => p.every((v, k) => near(v, cpu![i]![k]!, 1))) }).toEqual({ name, same: true });
    }
    // spot checks of the decoder: selector 0 = c0 (red), 1 = c1 (blue), 2 = 2/3 c0 + 1/3 c1, 3 = 1/3 c0 + 2/3 c1
    const t = results["DXT1"]![1]!;
    expect(t[0]).toEqual([255, 0, 0, 255]); expect(t[1]).toEqual([0, 0, 255, 255]);
    expect(near(t[2]![0], 170, 1) && near(t[2]![2], 85, 1)).toBe(true);
    expect(near(t[3]![0], 85, 1) && near(t[3]![2], 170, 1)).toBe(true);
    // DXT3 explicit alpha, 4 bits per texel, low nibble first: bytes 00 22 44 .. -> texels 0,1 = 0, texels 2,3 = 0x22 (nibble 2 replicated)
    const a3 = results["DXT3"]![1]!.map((p) => p[3]);
    expect(a3.slice(0, 6)).toEqual([0, 0, 0x22, 0x22, 0x44, 0x44]);
    // DXT5: alpha0 = 200, alpha1 = 40, all selectors 0 -> 200
    expect(results["DXT5"]![1]!.every((p) => p[3] === 200)).toBe(true);
  });
});
