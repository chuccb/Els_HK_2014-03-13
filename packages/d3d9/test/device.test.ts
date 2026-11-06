import { describe, expect, test } from "bun:test";
import { D3DCLEAR, D3DFVF, D3DPT, D3DRS, D3DCULL } from "../src/index.ts";
import { argb, gpuAvailable, near, newD3D9, packVertices, snap } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;

const RHW = D3DFVF.XYZRHW | D3DFVF.DIFFUSE;

describe("device basics (needs a WebGPU adapter)", () => {
  gpuTest("clear fills the render target; X8R8G8B8 keeps alpha at 1", async () => {
    const dev = await newD3D9(16, 16);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(0, 10, 200, 30), 1, 0);
    const img = await snap(dev);
    expect(img.at(0, 0)).toEqual({ r: 10, g: 200, b: 30, a: 255 });
    expect(img.at(15, 15)).toEqual({ r: 10, g: 200, b: 30, a: 255 });
    expect(dev.takeErrors()).toEqual([]);
  });

  gpuTest("pre-transformed quad covering the target covers every pixel and nothing else", async () => {
    const dev = await newD3D9(16, 16);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    dev.SetRenderState(D3DRS.LIGHTING, 0);
    dev.SetRenderState(D3DRS.CULLMODE, D3DCULL.NONE);
    // a 8x8 quad at (4,4)-(12,12) in window coordinates: D3D9 covers pixels whose centres (integers) lie inside: 4..11
    const { bytes, stride } = packVertices(RHW, [
      [4, 4, 0.5, 1, argb(255, 255, 0, 0)], [12, 4, 0.5, 1, argb(255, 255, 0, 0)], [4, 12, 0.5, 1, argb(255, 255, 0, 0)], [12, 12, 0.5, 1, argb(255, 255, 0, 0)],
    ]);
    dev.SetFVF(RHW);
    expect(dev.DrawPrimitiveUP(D3DPT.TRIANGLESTRIP, 2, bytes, stride)).toBe(0);
    const img = await snap(dev);
    const red = (p: { r: number; g: number; b: number }): boolean => p.r === 255 && p.g === 0 && p.b === 0;
    expect(img.count(red)).toBe(64);
    for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11]] as const) expect(red(img.at(x, y))).toBe(true);
    for (const [x, y] of [[3, 4], [12, 4], [4, 3], [4, 12], [12, 12]] as const) expect(red(img.at(x, y))).toBe(false);
    expect(dev.takeErrors()).toEqual([]);
    expect(near(img.at(5, 5).r, 255)).toBe(true);
  });
});
