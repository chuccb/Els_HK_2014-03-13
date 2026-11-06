/** Sampling: texel/pixel alignment, filters, address modes, mip chains, texture coordinate sources and transforms, formats. */
import { describe, expect, test } from "bun:test";
import { D3DCLEAR, D3DFMT, D3DPOOL, D3DRS, D3DSAMP, D3DTADDRESS, D3DTEXF, D3DTOP, D3DTA, D3DTSS, D3DTSS_TCI, D3DTTFF, D3DTS, D3DTS_WORLD, D3DUSAGE, matIdentity, matOrthoLH, matScaling, matTranslation, mipSize } from "../src/index.ts";
import type { Direct3DDevice9 } from "../src/index.ts";
import { argb, drawRhwQuad, gpuAvailable, initFixed, makeTexture, near, newD3D9, packVertices, pointSample, snap } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;
const WHITE = argb(255, 255, 255, 255);

/** modulate-free texture output: stage 0 = SELECTARG1(TEXTURE) for colour and alpha */
function selectTexture(dev: Direct3DDevice9): void {
  dev.SetTextureStageState(0, D3DTSS.COLOROP, D3DTOP.SELECTARG1); dev.SetTextureStageState(0, D3DTSS.COLORARG1, D3DTA.TEXTURE);
  dev.SetTextureStageState(0, D3DTSS.ALPHAOP, D3DTOP.SELECTARG1); dev.SetTextureStageState(0, D3DTSS.ALPHAARG1, D3DTA.TEXTURE);
}
async function fresh(w: number, h: number): Promise<Direct3DDevice9> {
  const dev = await newD3D9(w, h, { backBufferFormat: D3DFMT.A8R8G8B8 });
  initFixed(dev);
  selectTexture(dev);
  dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(0, 0, 0, 0), 1, 0);
  return dev;
}
/** an RGBA texture whose texel (x, y) is (16x+1, 16y+2, 100+x+4y, 200+x) */
const patternTexel = (x: number, y: number): number[] => [16 * x + 1, 16 * y + 2, 100 + x + 4 * y, 200 + x];
function pattern(w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(...patternTexel(x, y));
  return out;
}

describe("texel / pixel alignment (needs a WebGPU adapter)", () => {
  gpuTest("a quad at (-0.5, -0.5) with UV 0..1 shows the texture 1:1 (point and linear filtering)", async () => {
    for (const filter of [D3DTEXF.POINT, D3DTEXF.LINEAR]) {
      const dev = await fresh(4, 4);
      dev.SetTexture(0, makeTexture(dev, 4, 4, pattern(4, 4)));
      pointSample(dev);
      dev.SetSamplerState(0, D3DSAMP.MAGFILTER, filter); dev.SetSamplerState(0, D3DSAMP.MINFILTER, filter);
      drawRhwQuad(dev, -0.5, -0.5, 3.5, 3.5, WHITE, [0, 0, 1, 1]);
      const img = await snap(dev);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const t = patternTexel(x, y), p = img.at(x, y);
        expect({ filter, x, y, ok: [p.r, p.g, p.b, p.a].every((v, i) => near(v, t[i]!, 1)) }).toEqual({ filter, x, y, ok: true });
      }
      expect(await dev.takeErrorsAsync()).toEqual([]);
    }
  });

  gpuTest("magnification: point = blocks, linear = interpolation between texel centres with clamped edges", async () => {
    const tex = [255, 0, 0, 255, 0, 0, 255, 255]; // 2x1: red, blue
    const dev = await fresh(8, 1);
    dev.SetTexture(0, makeTexture(dev, 2, 1, tex));
    pointSample(dev);
    drawRhwQuad(dev, -0.5, -0.5, 7.5, 0.5, WHITE, [0, 0, 1, 1]);
    const p = await snap(dev);
    expect([0, 1, 2, 3].map((x) => p.at(x, 0).r)).toEqual([255, 255, 255, 255]);
    expect([4, 5, 6, 7].map((x) => p.at(x, 0).b)).toEqual([255, 255, 255, 255]);

    const d2 = await fresh(8, 1);
    d2.SetTexture(0, makeTexture(d2, 2, 1, tex));
    pointSample(d2);
    d2.SetSamplerState(0, D3DSAMP.MAGFILTER, D3DTEXF.LINEAR); d2.SetSamplerState(0, D3DSAMP.MINFILTER, D3DTEXF.LINEAR);
    drawRhwQuad(d2, -0.5, -0.5, 7.5, 0.5, WHITE, [0, 0, 1, 1]);
    const l = await snap(d2);
    for (let x = 0; x < 8; x++) {
      const u = (x + 0.5) / 8, t = Math.min(1, Math.max(0, u * 2 - 0.5)); // texel coordinate between the two centres
      const r = Math.round(255 * (1 - t)), b = Math.round(255 * t);
      expect({ x, ok: near(l.at(x, 0).r, r, 2) && near(l.at(x, 0).b, b, 2) }).toEqual({ x, ok: true });
    }
  });

  gpuTest("address modes: WRAP, MIRROR, CLAMP over UV -1..2", async () => {
    const tex = [255, 0, 0, 255, 0, 255, 0, 255]; // red, green (2x1)
    const run = async (mode: number): Promise<number[]> => {
      const dev = await fresh(12, 1);
      dev.SetTexture(0, makeTexture(dev, 2, 1, tex));
      pointSample(dev);
      dev.SetSamplerState(0, D3DSAMP.ADDRESSU, mode);
      // 12 pixels cover u from -1 to 2: pixel i has u = -1 + (i + 0.5) / 4  => 4 pixels per unit, 2 per texel
      drawRhwQuad(dev, -0.5, -0.5, 11.5, 0.5, WHITE, [-1, 0, 2, 1]);
      const img = await snap(dev);
      return Array.from({ length: 12 }, (_, x) => (img.at(x, 0).r > 128 ? 0 : 1)); // 0 = red texel, 1 = green texel
    };
    // texel index of pixel i for u in [-1,2): texel = floor(frac(u) * 2) for wrap
    const wrap = Array.from({ length: 12 }, (_, i) => { const u = -1 + (i + 0.5) / 4; return Math.floor((u - Math.floor(u)) * 2); });
    const mirror = Array.from({ length: 12 }, (_, i) => { const u = -1 + (i + 0.5) / 4; const m = Math.abs(((u % 2) + 2) % 2); const f = m > 1 ? 2 - m : m; return Math.min(1, Math.floor(f * 2)); });
    const clamp = Array.from({ length: 12 }, (_, i) => { const u = Math.min(1, Math.max(0, -1 + (i + 0.5) / 4)); return Math.min(1, Math.floor(u * 2)); });
    expect(await run(D3DTADDRESS.WRAP)).toEqual(wrap);
    expect(await run(D3DTADDRESS.MIRROR)).toEqual(mirror);
    expect(await run(D3DTADDRESS.CLAMP)).toEqual(clamp);
  });

  gpuTest("mip chains: level selection by minification, MIPFILTER none/point/linear, MAXMIPLEVEL", async () => {
    // 16x16 texture, 5 levels with solid colours 255/200/150/100/50 in the red channel
    const mk = (dev: Direct3DDevice9): ReturnType<Direct3DDevice9["CreateTexture"]>["tex"] => {
      const t = dev.CreateTexture(16, 16, 0, 0, D3DFMT.A8R8G8B8, D3DPOOL.MANAGED).tex!;
      expect(t.levels).toBe(5);
      for (let l = 0; l < 5; l++) { const n = mipSize(16, l); const v = [255, 200, 150, 100, 50][l]!; t.setLevelFromRgba8(l, new Uint8Array(n * n * 4).map((_, i) => (i % 4 === 0 ? v : i % 4 === 3 ? 255 : 0))); }
      return t;
    };
    const draw = async (size: number, mip: number, maxMip = 0, bias = 0): Promise<number> => {
      const dev = await fresh(32, 32);
      dev.SetTexture(0, mk(dev)!);
      pointSample(dev);
      dev.SetSamplerState(0, D3DSAMP.MIPFILTER, mip);
      dev.SetSamplerState(0, D3DSAMP.MAXMIPLEVEL, maxMip);
      if (bias) dev.SetSamplerState(0, D3DSAMP.MIPMAPLODBIAS, new Uint32Array(new Float32Array([bias]).buffer)[0]!);
      drawRhwQuad(dev, -0.5, -0.5, size - 0.5, size - 0.5, WHITE, [0, 0, 1, 1]);
      const r = (await snap(dev)).at(size >> 1, size >> 1).r;
      expect(await dev.takeErrorsAsync()).toEqual([]);
      return r;
    };
    expect(await draw(16, D3DTEXF.POINT)).toBe(255); // 1:1 -> level 0
    expect(await draw(8, D3DTEXF.POINT)).toBe(200); // 2x minified -> level 1
    expect(await draw(4, D3DTEXF.POINT)).toBe(150); // level 2
    expect(await draw(2, D3DTEXF.POINT)).toBe(100); // level 3
    expect(await draw(8, D3DTEXF.NONE)).toBe(255); // no mip filter: base level
    expect(await draw(8, D3DTEXF.POINT, 2)).toBe(150); // MAXMIPLEVEL=2: levels 0 and 1 are not used
    expect(near(await draw(11, D3DTEXF.LINEAR), 255 + (200 - 255) * Math.log2(16 / 11), 3)).toBe(true); // trilinear blend between level 0 and 1
    expect(await draw(16, D3DTEXF.POINT, 0, 1)).toBe(200); // LOD bias +1
  });
});

describe("texture coordinates (needs a WebGPU adapter)", () => {
  /** quad covering the target, 3D vertices with normals and 2D texture coordinates; orthographic [-1,1] */
  async function textured(w: number, setup: (dev: Direct3DDevice9) => void, tc: number[][], fvf: number): Promise<{ dev: Direct3DDevice9; img: Awaited<ReturnType<typeof snap>> }> {
    const dev = await fresh(w, w);
    dev.SetTransform(D3DTS.PROJECTION, matOrthoLH(2, 2, 0, 1));
    dev.SetTexture(0, makeTexture(dev, 4, 4, pattern(4, 4)));
    pointSample(dev);
    setup(dev);
    const pos = [[-1, 1, 0.5], [1, 1, 0.5], [-1, -1, 0.5], [1, -1, 0.5]];
    const { bytes, stride } = packVertices(fvf, pos.map((p, i) => [...p, ...tc[i]!]));
    dev.SetFVF(fvf);
    dev.DrawPrimitiveUP(5 /* strip */, 2, bytes, stride);
    return { dev, img: await snap(dev) };
  }
  const XYZ_TEX = 0x2 | 0x100; // XYZ | TEX1

  gpuTest("texture transform matrix (COUNT2): translation and scale of (u, v)", async () => {
    const tc = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const { img } = await textured(4, (dev) => {
      dev.SetTextureStageState(0, D3DTSS.TEXTURETRANSFORMFLAGS, D3DTTFF.COUNT2);
      // 2D coordinates enter the matrix as (u, v, 1, 0): the translation of a 2D transform lives in _31/_32.  u' = 0.5 u + 0.5
      const m = matScaling(0.5, 1, 1); m[8] = 0.5; // _31 = 0.5
      dev.SetTransform(D3DTS.TEXTURE0, m);
    }, tc, XYZ_TEX);
    // D3D9 pixel centres are at integer window coordinates: pixel x of a full-viewport quad has u = x / 4; u' = 0.5 + 0.5u
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      const u = x / 4, tx = Math.floor((0.5 + 0.5 * u) * 4 + 1e-6);
      const t = patternTexel(tx, y), p = img.at(x, y);
      expect({ x, y, ok: [p.r, p.g, p.b].every((v, i) => near(v, t[i]!, 1)) }).toEqual({ x, y, ok: true });
    }
  });

  gpuTest("TEXCOORDINDEX selects the vertex coordinate set", async () => {
    const tc = [[0, 0, 0.5, 0.5], [1, 0, 0.5, 0.5], [0, 1, 0.5, 0.5], [1, 1, 0.5, 0.5]];
    // two coordinate sets: set 1 is constant (0.5, 0.5) -> every pixel shows texel (2, 2)
    const { img } = await textured(4, (dev) => { dev.SetTextureStageState(0, D3DTSS.TEXCOORDINDEX, 1); }, tc, 0x2 | 0x200 /* TEX2 */);
    const t = patternTexel(2, 2);
    for (const [x, y] of [[0, 0], [3, 3], [1, 2]] as const) expect([img.at(x, y).r, img.at(x, y).g].map((v, i) => near(v, t[i]!, 1))).toEqual([true, true]);
  });

  gpuTest("projected coordinates (COUNT3 | PROJECTED divide by the last component)", async () => {
    const tc = [[0, 0, 2], [2, 0, 2], [0, 2, 2], [2, 2, 2]]; // (u, v, q) = 2 * (0..1, 0..1, 1)
    const { img } = await textured(4, (dev) => { dev.SetTextureStageState(0, D3DTSS.TEXTURETRANSFORMFLAGS, D3DTTFF.COUNT3 | D3DTTFF.PROJECTED); }, tc, 0x2 | 0x100 | (1 << 16) /* TEX1 with TEXCOORDSIZE3(0) */);
    // with the 3-float set, the sample position is (u/q, v/q) = 0..1 again: 1:1
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      const t = patternTexel(x, y), p = img.at(x, y);
      expect({ x, y, ok: [p.r, p.g, p.b].every((v, i) => near(v, t[i]!, 1)) }).toEqual({ x, y, ok: true });
    }
  });

  gpuTest("camera-space position coordinates feed the transform (TCI_CAMERASPACEPOSITION)", async () => {
    // u = x, v = y of the vertex in camera space, mapped to 0..1 by the texture matrix
    const m = matScaling(0.5, -0.5, 1); m[12] = 0.5; m[13] = 0.5;
    const { img } = await textured(4, (dev) => {
      dev.SetTextureStageState(0, D3DTSS.TEXCOORDINDEX, D3DTSS_TCI.CAMERASPACEPOSITION);
      dev.SetTextureStageState(0, D3DTSS.TEXTURETRANSFORMFLAGS, D3DTTFF.COUNT2);
      dev.SetTransform(D3DTS.TEXTURE0, m);
    }, [[0], [0], [0], [0]], 0x2 | 0x100 /* the texcoord is ignored: only set 0 with 1 float */);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      const t = patternTexel(x, y), p = img.at(x, y);
      expect({ x, y, ok: [p.r, p.g, p.b].every((v, i) => near(v, t[i]!, 1)) }).toEqual({ x, y, ok: true });
    }
  });
});
