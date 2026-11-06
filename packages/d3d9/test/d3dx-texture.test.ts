/** D3DX texture loading on synthetic files: image info, requirements, format choices, resizing, colour key, mips, saving. */
import { describe, expect, test } from "bun:test";
import { decodePng, encodePng } from "@els/assets";
import {
  D3DFMT, D3DXCheckTextureRequirements, D3DXCreateTexture, D3DXCreateTextureFromFileInMemoryEx, D3DXGetImageInfoFromFileInMemory, D3DXSaveSurfaceToFileInMemory, D3DXIFF,
  D3DX_DEFAULT, D3DX_FILTER, D3DPOOL, D3DUSAGE, D3DCLEAR, D3DXERR_INVALIDDATA, resizeRgba,
} from "../src/index.ts";
import { argb, drawRhwQuad, gpuAvailable, initFixed, newD3D9, pointSample, snap } from "./gpu-helper.ts";
import { D3DTA, D3DTOP, D3DTSS } from "../src/index.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;

const tga = (w: number, h: number, bpp: number, pixels: number[]): Uint8Array =>
  Uint8Array.from([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, bpp, 0x20 /* top-left origin */, ...pixels]);
/** minimal DDS: magic + 124 byte header + payload */
function dds(w: number, h: number, mips: number, fourCC: string, payload: number[]): Uint8Array {
  const b = new Uint8Array(128 + payload.length);
  const dv = new DataView(b.buffer);
  b.set([0x44, 0x44, 0x53, 0x20]);
  dv.setUint32(4, 124, true); dv.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000, true);
  dv.setUint32(12, h, true); dv.setUint32(16, w, true); dv.setUint32(20, payload.length, true); dv.setUint32(28, mips, true);
  dv.setUint32(76, 32, true); dv.setUint32(80, 0x4, true); b.set([...fourCC].map((c) => c.charCodeAt(0)), 84);
  dv.setUint32(108, 0x1000 | (mips > 1 ? 0x400008 : 0), true);
  b.set(payload, 128);
  return b;
}

describe("image info (no GPU)", () => {
  test("TGA 24 bit reports R8G8B8, 32 bit A8R8G8B8, PNG, DDS DXT1 with its mip count", () => {
    const t24 = D3DXGetImageInfoFromFileInMemory(tga(2, 2, 24, new Array(12).fill(0)));
    expect(t24.info).toMatchObject({ Width: 2, Height: 2, Format: D3DFMT.R8G8B8, ImageFileFormat: D3DXIFF.TGA, MipLevels: 1, Depth: 1 });
    expect(D3DXGetImageInfoFromFileInMemory(tga(3, 1, 32, new Array(12).fill(0))).info).toMatchObject({ Width: 3, Height: 1, Format: D3DFMT.A8R8G8B8 });
    expect(D3DXGetImageInfoFromFileInMemory(encodePng(new Uint8Array(4 * 5 * 6), 5, 6)).info).toMatchObject({ Width: 5, Height: 6, ImageFileFormat: D3DXIFF.PNG });
    const d = D3DXGetImageInfoFromFileInMemory(dds(8, 8, 4, "DXT1", new Array(32 + 8 + 8 + 8).fill(0)));
    expect(d.info).toMatchObject({ Width: 8, Height: 8, Format: D3DFMT.DXT1, MipLevels: 4, ImageFileFormat: D3DXIFF.DDS });
    expect(D3DXGetImageInfoFromFileInMemory(Uint8Array.from([1, 2, 3])).hr).toBe(D3DXERR_INVALIDDATA);
    // a JPEG: size only
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 1, 0x22, 0, 0, 0]);
    expect(D3DXGetImageInfoFromFileInMemory(jpg).info).toMatchObject({ Width: 30, Height: 20, ImageFileFormat: D3DXIFF.JPG });
  });

  test("resampling: point, bilinear tap, box", () => {
    // 4x1: 0, 100, 200, 40 (red channel)
    const src = Uint8Array.from([0, 0, 0, 255, 100, 0, 0, 255, 200, 0, 0, 255, 40, 0, 0, 255]);
    expect(Array.from(resizeRgba(src, 4, 1, 2, 1, D3DX_FILTER.NONE)).filter((_, i) => i % 4 === 0)).toEqual([100, 40]); // centres 1.0 -> 1, 3.0 -> 3
    expect(Array.from(resizeRgba(src, 4, 1, 2, 1, D3DX_FILTER.LINEAR)).filter((_, i) => i % 4 === 0)).toEqual([50, 120]); // taps between texels 0/1 and 2/3
    expect(Array.from(resizeRgba(src, 4, 1, 2, 1, D3DX_FILTER.BOX)).filter((_, i) => i % 4 === 0)).toEqual([50, 120]);
    expect(Array.from(resizeRgba(src, 4, 1, 8, 1, D3DX_FILTER.NONE)).filter((_, i) => i % 4 === 0)).toEqual([0, 0, 100, 100, 200, 200, 40, 40]);
  });
});

describe("texture creation (needs a WebGPU adapter)", () => {
  gpuTest("CheckTextureRequirements: defaults, clamping, mip counts, format substitutions", async () => {
    const dev = await newD3D9(4, 4);
    expect(D3DXCheckTextureRequirements(dev, 100, 60, 1, 0, D3DFMT.UNKNOWN, D3DPOOL.MANAGED)).toMatchObject({ hr: 0, width: 100, height: 60, mipLevels: 1, format: D3DFMT.A8R8G8B8 });
    expect(D3DXCheckTextureRequirements(dev, 100, 60, 0, 0, D3DFMT.DXT1, D3DPOOL.MANAGED)).toMatchObject({ mipLevels: 7, format: D3DFMT.DXT1 });
    expect(D3DXCheckTextureRequirements(dev, 100, 60, 99, 0, D3DFMT.R8G8B8, D3DPOOL.MANAGED)).toMatchObject({ mipLevels: 7, format: D3DFMT.X8R8G8B8 });
    expect(D3DXCheckTextureRequirements(dev, 100000, 3, 1, 0, D3DFMT.A8R8G8B8, D3DPOOL.MANAGED)).toMatchObject({ width: 8192, height: 3 });
    expect(D3DXCheckTextureRequirements(dev, 2, 2, 1, 0, D3DFMT.DXT5, D3DPOOL.MANAGED)).toMatchObject({ format: D3DFMT.A8R8G8B8 });
    const rt = D3DXCreateTexture(dev, 8, 4, 1, D3DUSAGE.RENDERTARGET, D3DFMT.X8R8G8B8, D3DPOOL.DEFAULT);
    expect(rt.hr).toBe(0);
    expect(rt.tex!.GetLevelDesc(0)).toMatchObject({ Width: 8, Height: 4, Format: D3DFMT.X8R8G8B8 });
  });

  async function show(dev: Awaited<ReturnType<typeof newD3D9>>, tex: NonNullable<ReturnType<typeof D3DXCreateTexture>["tex"]>, w: number, h: number) {
    initFixed(dev);
    dev.SetTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG1); dev.SetTextureStageState(0, D3DTSS.COLORARG1, D3DTA.TEXTURE);
    dev.SetTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG1); dev.SetTextureStageState(0, D3DTSS.ALPHAARG1, D3DTA.TEXTURE);
    dev.SetTexture(0, tex);
    pointSample(dev);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(0, 9, 9, 9), 1, 0);
    drawRhwQuad(dev, -0.5, -0.5, w - 0.5, h - 0.5, argb(255, 255, 255, 255), [0, 0, 1, 1]);
    const img = await snap(dev);
    expect(await dev.takeErrorsAsync()).toEqual([]);
    return img;
  }

  gpuTest("the exe's call (UNKNOWN format, 1 level, same size, FILTER_NONE) keeps a 24-bit TGA's pixels (as X8R8G8B8)", async () => {
    const dev = await newD3D9(2, 2, { backBufferFormat: D3DFMT.A8R8G8B8 });
    const file = tga(2, 2, 24, [3, 2, 1, 6, 5, 4, 9, 8, 7, 12, 11, 10]); // BGR: (1,2,3) (4,5,6) / (7,8,9) (10,11,12)
    const r = D3DXCreateTextureFromFileInMemoryEx(dev, file, 2, 2, 1, 0, D3DFMT.UNKNOWN, D3DPOOL.MANAGED, D3DX_FILTER.NONE, D3DX_FILTER.NONE, 0);
    expect(r.hr).toBe(0);
    expect(r.info).toMatchObject({ Format: D3DFMT.R8G8B8, Width: 2 });
    expect(r.tex!.GetLevelDesc(0)).toMatchObject({ Format: D3DFMT.X8R8G8B8, Width: 2, Height: 2 }); // R8G8B8 does not exist as a texture format
    const img = await show(dev, r.tex!, 2, 2);
    expect([img.at(0, 0), img.at(1, 0), img.at(0, 1), img.at(1, 1)].map((p) => [p.r, p.g, p.b, p.a])).toEqual([[1, 2, 3, 255], [4, 5, 6, 255], [7, 8, 9, 255], [10, 11, 12, 255]]);
  });

  gpuTest("detail-level downscale (LINEAR filter), colour key, mip generation", async () => {
    const dev = await newD3D9(2, 2, { backBufferFormat: D3DFMT.A8R8G8B8 });
    // 4x4 PNG: left half (x<2) value 100, right half 200; one pixel (3,3) is the colour key 0xFF00FF
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) rgba.set([x < 2 ? 100 : 200, 50, 25, 255], (y * 4 + x) * 4);
    const png = encodePng(rgba, 4, 4);
    const half = D3DXCreateTextureFromFileInMemoryEx(dev, png, 2, 2, 1, 0, D3DFMT.UNKNOWN, D3DPOOL.MANAGED, D3DX_FILTER.LINEAR, D3DX_FILTER.NONE, 0);
    expect(half.hr).toBe(0);
    const img = await show(dev, half.tex!, 2, 2);
    expect([img.at(0, 0).r, img.at(1, 0).r, img.at(0, 1).r, img.at(1, 1).r]).toEqual([100, 200, 100, 200]);

    const keyed = new Uint8Array(rgba); keyed.set([255, 0, 255, 255], (3 * 4 + 3) * 4);
    const k = D3DXCreateTextureFromFileInMemoryEx(dev, encodePng(keyed, 4, 4), 4, 4, 1, 0, D3DFMT.A8R8G8B8, D3DPOOL.MANAGED, D3DX_FILTER.NONE, D3DX_FILTER.NONE, argb(255, 255, 0, 255));
    const lk = k.tex!.LockRect(0, null, 0);
    expect([lk.pBits![(3 * 4 + 3) * 4 + 3], lk.pBits![(3 * 4 + 2) * 4 + 3]]).toEqual([0, 255]); // keyed pixel became transparent black, neighbour untouched
    expect(lk.pBits![(3 * 4 + 3) * 4 + 2]).toBe(0);

    const m = D3DXCreateTextureFromFileInMemoryEx(dev, png, 0, 0, 0, 0, D3DFMT.UNKNOWN, D3DPOOL.MANAGED, D3DX_FILTER.NONE, D3DX_DEFAULT, 0);
    expect(m.tex!.levels).toBe(3); // 4x4, 2x2, 1x1
    const l1 = m.tex!.LockRect(1, null, 0).pBits!;
    expect([l1[2], l1[6]]).toEqual([100, 200]); // BGRA bytes: R at +2
    const l2 = m.tex!.LockRect(2, null, 0).pBits!;
    expect(l2[2]).toBe(150);
  });

  gpuTest("DDS DXT1 is copied block for block, including the mip chain, and renders like the CPU decoder", async () => {
    const dev = await newD3D9(4, 4, { backBufferFormat: D3DFMT.A8R8G8B8 });
    // 8x8 DXT1 = 4 blocks (level 0) + 1 block (level 1) + 1 block (level 2 = 2x2) + 1 block (level 3 = 1x1)
    const block = (c0: number, c1: number, idx: number): number[] => [c0 & 255, c0 >> 8, c1 & 255, c1 >> 8, idx & 255, (idx >> 8) & 255, (idx >> 16) & 255, (idx >>> 24) & 255];
    const blocks = [block(0xf800, 0x001f, 0), block(0x07e0, 0x0000, 0), block(0x001f, 0xf800, 0), block(0xffff, 0x0000, 0), block(0x07ff, 0, 0), block(0xf81f, 0, 0), block(0xffe0, 0, 0)];
    const file = dds(8, 8, 4, "DXT1", blocks.flat());
    const r = D3DXCreateTextureFromFileInMemoryEx(dev, file, 8, 8, 0, 0, D3DFMT.UNKNOWN, D3DPOOL.MANAGED, D3DX_FILTER.NONE, D3DX_FILTER.NONE, 0);
    expect(r.hr).toBe(0);
    expect(r.tex!.levels).toBe(4);
    expect(r.tex!.GetLevelDesc(0)!.Format).toBe(D3DFMT.DXT1);
    const l0 = r.tex!.LockRect(0, null, 0);
    expect(Array.from(l0.pBits!.subarray(0, 8))).toEqual(blocks[0]!);
    expect(Array.from(l0.pBits!.subarray(24, 32))).toEqual(blocks[3]!);
    r.tex!.UnlockRect(0);
    expect(Array.from(r.tex!.LockRect(2, null, 0).pBits!.subarray(0, 8))).toEqual(blocks[5]!);
    // sample level 0 at 8x8: the four blocks are red / green / blue / white
    const big = await newD3D9(8, 8, { backBufferFormat: D3DFMT.A8R8G8B8 });
    const r2 = D3DXCreateTextureFromFileInMemoryEx(big, file, 8, 8, 1, 0, D3DFMT.UNKNOWN, D3DPOOL.MANAGED, D3DX_FILTER.NONE, D3DX_FILTER.NONE, 0);
    const img = await show(big, r2.tex!, 8, 8);
    expect([img.at(1, 1), img.at(6, 1), img.at(1, 6), img.at(6, 6)].map((p) => [p.r, p.g, p.b])).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]);
  });

  gpuTest("JPEG cannot be decoded here (D3DERR_NOTAVAILABLE), garbage is D3DXERR_INVALIDDATA; saving a surface gives a PNG that decodes to the pixels", async () => {
    const dev = await newD3D9(4, 4, { backBufferFormat: D3DFMT.A8R8G8B8 });
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 1, 0x22, 0, 0, 0]);
    expect(D3DXCreateTextureFromFileInMemoryEx(dev, jpg, 0, 0, 1, 0, 0, D3DPOOL.MANAGED, 1, 1, 0).hr).toBeLessThan(0);
    expect(D3DXCreateTextureFromFileInMemoryEx(dev, Uint8Array.from([1, 2, 3, 4]), 0, 0, 1, 0, 0, D3DPOOL.MANAGED, 1, 1, 0).hr).toBe(D3DXERR_INVALIDDATA);
    initFixed(dev);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 10, 20, 30), 1, 0);
    drawRhwQuad(dev, 1, 1, 3, 3, argb(255, 200, 100, 50));
    const saved = await D3DXSaveSurfaceToFileInMemory(dev, D3DXIFF.JPG, dev.GetRenderTarget(0)!);
    expect(saved.hr).toBe(0);
    const back = decodePng(saved.data!);
    const px = await snap(dev);
    expect(Buffer.compare(back.rgba, px.rgba)).toBe(0);
  });
});
