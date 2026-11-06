/** Render-target textures, StretchRect, UpdateTexture, Reset: the way CKTDXDeviceRenderTargetTexture and CKTDGDynamicTexture use them. */
import { describe, expect, test } from "bun:test";
import { D3DCLEAR, D3DCULL, D3DFMT, D3DPOOL, D3DRS, D3DTEXF, D3DUSAGE, D3DTSS, D3DTOP, D3DTA } from "../src/index.ts";
import type { Direct3DDevice9, Direct3DTexture9 } from "../src/index.ts";
import { argb, drawRhwQuad, gpuAvailable, initFixed, near, newD3D9, pointSample, snap } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;
const WHITE = argb(255, 255, 255, 255);

function selectTexture(dev: Direct3DDevice9): void {
  dev.SetTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG1); dev.SetTextureStageState(0, D3DTSS.COLORARG1, D3DTA.TEXTURE);
  dev.SetTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG1); dev.SetTextureStageState(0, D3DTSS.ALPHAARG1, D3DTA.TEXTURE);
}

/** what CKTDXDeviceRenderTargetTexture::OnResetDevice does: texture + depth surface of the same size, backups of the current ones */
function makeRtt(dev: Direct3DDevice9, w: number, h: number): { tex: Direct3DTexture9; surface: NonNullable<ReturnType<Direct3DDevice9["GetRenderTarget"]>>; z: NonNullable<ReturnType<Direct3DDevice9["GetDepthStencilSurface"]>> } {
  const backZ = dev.GetDepthStencilSurface()!;
  const fmt = dev.GetRenderTarget(0)!.GetDesc().Format;
  const { hr, tex } = dev.CreateTexture(w, h, 1, D3DUSAGE.RENDERTARGET, fmt, D3DPOOL.DEFAULT);
  expect(hr).toBe(0);
  const surface = tex!.GetSurfaceLevel(0)!;
  const { surface: z, hr: hz } = dev.CreateDepthStencilSurface(w, h, backZ.GetDesc().Format);
  expect(hz).toBe(0);
  return { tex: tex!, surface, z: z! };
}

describe("render targets (needs a WebGPU adapter)", () => {
  gpuTest("draw into a render-target texture, restore the back buffer, then draw the texture", async () => {
    const dev = await newD3D9(16, 16, { backBufferFormat: D3DFMT.A8R8G8B8 });
    initFixed(dev);
    selectTexture(dev);
    const backBuffer = dev.GetRenderTarget(0)!, backZ = dev.GetDepthStencilSurface()!;
    const rtt = makeRtt(dev, 8, 8);
    // BeginRender(true)
    dev.SetRenderTarget(0, rtt.surface); dev.SetDepthStencilSurface(rtt.z);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 255), 1, 0);
    drawRhwQuad(dev, 2, 2, 6, 6, argb(255, 255, 0, 0));
    // EndRender
    dev.SetRenderTarget(0, backBuffer); dev.SetDepthStencilSurface(backZ);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
    // Draw(): the texture on a quad of the same size (point sampled, 1:1)
    dev.SetTexture(0, rtt.tex);
    pointSample(dev);
    drawRhwQuad(dev, 4 - 0.5, 4 - 0.5, 12 - 0.5, 12 - 0.5, WHITE, [0, 0, 1, 1]);
    const img = await snap(dev);
    img.save("rendertarget");
    expect(img.at(3, 3)).toMatchObject({ r: 0, g: 0, b: 0 }); // outside
    expect(img.at(4, 4)).toMatchObject({ r: 0, g: 0, b: 255 }); // blue border of the RTT
    expect(img.at(6, 6)).toMatchObject({ r: 255, g: 0, b: 0 }); // red square (2..5) of the RTT sits at 6..9
    expect(img.at(9, 9)).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(img.at(10, 10)).toMatchObject({ r: 0, g: 0, b: 255 });
    expect(img.at(11, 11)).toMatchObject({ r: 0, g: 0, b: 255 });
    expect(img.at(12, 12)).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("an X8R8G8B8 render-target texture samples with alpha 1", async () => {
    const dev = await newD3D9(8, 8); // X8R8G8B8 back buffer
    initFixed(dev);
    selectTexture(dev);
    const backBuffer = dev.GetRenderTarget(0)!, backZ = dev.GetDepthStencilSurface()!;
    const rtt = makeRtt(dev, 4, 4);
    dev.SetRenderTarget(0, rtt.surface); dev.SetDepthStencilSurface(rtt.z);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(0, 10, 20, 30), 1, 0); // clear colour alpha 0 on an alpha-less target
    dev.SetRenderTarget(0, backBuffer); dev.SetDepthStencilSurface(backZ);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
    dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 1); dev.SetRenderState(D3DRS.SRCBLEND, 5); dev.SetRenderState(D3DRS.DESTBLEND, 6);
    dev.SetTexture(0, rtt.tex); pointSample(dev);
    drawRhwQuad(dev, -0.5, -0.5, 3.5, 3.5, WHITE, [0, 0, 1, 1]);
    const p = (await snap(dev)).at(1, 1);
    expect([p.r, p.g, p.b]).toEqual([10, 20, 30]); // blended with alpha 1, not 0
  });

  gpuTest("StretchRect: equal sizes copy, down-scaling with POINT and LINEAR, sub-rectangles", async () => {
    const dev = await newD3D9(8, 8, { backBufferFormat: D3DFMT.A8R8G8B8 });
    initFixed(dev);
    selectTexture(dev);
    const backBuffer = dev.GetRenderTarget(0)!;
    // left half red, right half green; a white 2x2 spot at (1,1)
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 255, 0, 0), 1, 0);
    drawRhwQuad(dev, 4, 0, 8, 8, argb(255, 0, 255, 0));
    drawRhwQuad(dev, 1, 1, 3, 3, WHITE);
    const copyTo = (w: number, h: number): { tex: Direct3DTexture9; surface: NonNullable<ReturnType<Direct3DDevice9["GetRenderTarget"]>> } => {
      const { tex } = dev.CreateTexture(w, h, 1, D3DUSAGE.RENDERTARGET, D3DFMT.A8R8G8B8, D3DPOOL.DEFAULT);
      return { tex: tex!, surface: tex!.GetSurfaceLevel(0)! };
    };
    // equal size
    const same = copyTo(8, 8);
    expect(dev.StretchRect(backBuffer, null, same.surface, null, D3DTEXF.LINEAR)).toBe(0);
    // half size
    const half = copyTo(4, 4);
    expect(dev.StretchRect(backBuffer, null, half.surface, null, D3DTEXF.POINT)).toBe(0);
    const halfLin = copyTo(4, 4);
    expect(dev.StretchRect(backBuffer, null, halfLin.surface, null, D3DTEXF.LINEAR)).toBe(0);
    // sub rectangle of the source into a sub rectangle of the destination (2x magnification)
    const sub = copyTo(8, 8);
    expect(dev.StretchRect(backBuffer, { left: 0, top: 0, right: 4, bottom: 4 }, sub.surface, { left: 0, top: 0, right: 8, bottom: 8 }, D3DTEXF.POINT)).toBe(0);
    // invalid calls
    expect(dev.StretchRect(backBuffer, null, backBuffer, null, D3DTEXF.POINT)).toBeLessThan(0);
    expect(dev.StretchRect(backBuffer, { left: 0, top: 0, right: 9, bottom: 4 }, sub.surface, null, D3DTEXF.POINT)).toBeLessThan(0);

    const a = await dev.readPixels(backBuffer);
    const b = await dev.readPixels(same.surface);
    expect(Buffer.compare(Buffer.from(a.rgba), Buffer.from(b.rgba))).toBe(0);
    const px = (img: { width: number; rgba: Uint8Array }, x: number, y: number): number[] => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    // 2:1 minification: the centre of destination pixel x lies on the boundary of source pixels 2x and 2x+1.  POINT must pick one of them
    // (which one is up to the hardware, so only unambiguous pixels are checked); LINEAR must average them exactly.
    const hp = await dev.readPixels(half.surface);
    expect(px(hp, 3, 3)).toEqual([0, 255, 0, 255]);
    expect(px(hp, 2, 3)).toEqual([0, 255, 0, 255]);
    expect(px(hp, 0, 3)).toEqual([255, 0, 0, 255]);
    const hl = await dev.readPixels(halfLin.surface);
    const spot = px(hl, 0, 0); // the white 2x2 spot at (1,1)-(2,2) is shared by the destination pixels 0 and 1: 1/4 white + 3/4 red, 1/4 white + 3/4 red...
    expect([near(spot[0]!, 255, 1), near(spot[1]!, 64, 1), near(spot[2]!, 64, 1)]).toEqual([true, true, true]);
    expect(px(hl, 3, 3)).toEqual([0, 255, 0, 255]);
    expect(px(hl, 1, 3)).toEqual([255, 0, 0, 255]);
    // 2x magnification of the source's top-left 4x4: POINT = 2x2 blocks (the white spot at source (1..2, 1..2) becomes dest (2..5, 2..5))
    const m = await dev.readPixels(sub.surface);
    expect(px(m, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(px(m, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(m, 7, 7)).toEqual([255, 0, 0, 255]);
  });
});

describe("UpdateTexture / dynamic textures (needs a WebGPU adapter)", () => {
  gpuTest("system-memory texture -> default-pool texture (CKTDGDynamicTexture)", async () => {
    const dev = await newD3D9(4, 4, { backBufferFormat: D3DFMT.A8R8G8B8 });
    initFixed(dev);
    selectTexture(dev);
    const sys = dev.CreateTexture(4, 4, 1, 0, D3DFMT.A8R8G8B8, D3DPOOL.SYSTEMMEM).tex!;
    const vid = dev.CreateTexture(4, 4, 1, D3DUSAGE.DYNAMIC, D3DFMT.A8R8G8B8, D3DPOOL.DEFAULT).tex!;
    const frame = async (color: number[]): Promise<number[]> => {
      const l = sys.LockRect(0, null, 0x8000 /* NOSYSLOCK */);
      for (let i = 0; i < 16; i++) { l.pBits![i * 4] = color[2]!; l.pBits![i * 4 + 1] = color[1]!; l.pBits![i * 4 + 2] = color[0]!; l.pBits![i * 4 + 3] = 255; }
      sys.UnlockRect(0);
      expect(dev.UpdateTexture(sys, vid)).toBe(0);
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
      dev.SetTexture(0, vid); pointSample(dev);
      drawRhwQuad(dev, -0.5, -0.5, 3.5, 3.5, WHITE, [0, 0, 1, 1]);
      const p = (await snap(dev)).at(2, 2);
      return [p.r, p.g, p.b];
    };
    expect(await frame([10, 20, 30])).toEqual([10, 20, 30]);
    expect(await frame([200, 100, 50])).toEqual([200, 100, 50]);
    // two updates inside one frame (no flush in between): both draws see their own data
    const two = async (): Promise<number[][]> => {
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
      dev.SetTexture(0, vid); pointSample(dev);
      for (const [i, c] of [[0, [255, 0, 0]], [1, [0, 0, 255]]] as const) {
        const l = sys.LockRect(0, null, 0);
        for (let k = 0; k < 16; k++) { l.pBits![k * 4] = c[2]; l.pBits![k * 4 + 1] = c[1]; l.pBits![k * 4 + 2] = c[0]; l.pBits![k * 4 + 3] = 255; }
        sys.UnlockRect(0);
        dev.UpdateTexture(sys, vid);
        drawRhwQuad(dev, i * 2 - 0.5, -0.5, i * 2 + 1.5, 3.5, WHITE, [0, 0, 1, 1]);
      }
      const img = await snap(dev);
      return [[img.at(0, 1).r, img.at(0, 1).b], [img.at(3, 1).r, img.at(3, 1).b]];
    };
    expect(await two()).toEqual([[255, 0], [0, 255]]);
    // mismatching formats are refused
    const other = dev.CreateTexture(4, 4, 1, 0, D3DFMT.R5G6B5, D3DPOOL.SYSTEMMEM).tex!;
    expect(dev.UpdateTexture(other, vid)).toBeLessThan(0);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });
});

describe("Reset and depth buffers (needs a WebGPU adapter)", () => {
  gpuTest("Reset resizes the back buffer, restores default states and drops bindings", async () => {
    const dev = await newD3D9(16, 16);
    dev.SetRenderState(D3DRS.CULLMODE, D3DCULL.NONE);
    dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 1);
    expect(dev.Reset(32, 8)).toBe(0);
    expect(dev.GetRenderState(D3DRS.CULLMODE).value).toBe(D3DCULL.CCW);
    expect(dev.GetRenderState(D3DRS.ALPHABLENDENABLE).value).toBe(0);
    expect(dev.GetBackBuffer().GetDesc()).toMatchObject({ Width: 32, Height: 8 });
    expect(dev.GetViewport()).toMatchObject({ width: 32, height: 8 });
    initFixed(dev);
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 1, 2, 3), 1, 0);
    drawRhwQuad(dev, 0, 0, 32, 8, argb(255, 9, 8, 7));
    const img = await snap(dev);
    expect([img.width, img.height]).toEqual([32, 8]);
    expect(img.at(31, 7)).toMatchObject({ r: 9, g: 8, b: 7 });
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("a depth buffer larger than the render target is tolerated (depth testing is skipped with a warning)", async () => {
    const warnings: string[] = [];
    const dev = await newD3D9(16, 16, { backBufferFormat: D3DFMT.A8R8G8B8, warn: (m: string) => warnings.push(m) });
    initFixed(dev);
    const back = dev.GetRenderTarget(0)!;
    const { tex } = dev.CreateTexture(8, 8, 1, D3DUSAGE.RENDERTARGET, D3DFMT.A8R8G8B8, D3DPOOL.DEFAULT);
    dev.SetRenderTarget(0, tex!.GetSurfaceLevel(0)!); // the 16x16 depth buffer stays
    dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 255), 1, 0);
    drawRhwQuad(dev, 0, 0, 8, 8, argb(255, 255, 0, 0));
    dev.SetRenderTarget(0, back);
    const r = await dev.readPixels(tex!.GetSurfaceLevel(0)!);
    expect(r.rgba[0]).toBe(255);
    expect(warnings.some((w) => w.includes("depth"))).toBe(true);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });
});
