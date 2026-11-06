/** Render states: culling, depth, blending, alpha test, stencil, masks, scissor/viewport (analytic expectations). */
import { describe, expect, test } from "bun:test";
import { D3DBLEND, D3DBLENDOP, D3DCLEAR, D3DCMP, D3DCOLORWRITEENABLE, D3DCULL, D3DFMT, D3DFVF, D3DPT, D3DRS, D3DSTENCILOP, D3DTS, D3DTS_WORLD, D3DZB, matOrthoLH, matPerspectiveFovLH, matIdentity, matLookAtLH, vec3Project } from "../src/index.ts";
import type { Direct3DDevice9 } from "../src/index.ts";
import { argb, drawRhwQuad, gpuAvailable, initFixed, near, newD3D9, packVertices, snap } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;
const f2d = (f: number): number => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, f, true); return b.getUint32(0, true); };

const XYZ_DIFF = D3DFVF.XYZ | D3DFVF.DIFFUSE;
/** ortho projection mapping x,y in [-1,1] to the whole target; z in [0,1] */
function ortho(dev: Direct3DDevice9): void {
  dev.SetTransform(D3DTS_WORLD, matIdentity());
  dev.SetTransform(D3DTS.VIEW, matIdentity());
  dev.SetTransform(D3DTS.PROJECTION, matOrthoLH(2, 2, 0, 1));
}
function tri(dev: Direct3DDevice9, pts: [number, number, number][], color: number, fvf = XYZ_DIFF): number {
  const { bytes, stride } = packVertices(fvf, pts.map((p) => [...p, color]));
  dev.SetFVF(fvf);
  return dev.DrawPrimitiveUP(D3DPT.TRIANGLELIST, 1, bytes, stride);
}
/** an axis-aligned quad in NDC (x0,y0)-(x1,y1) at depth z as two triangles, both wound clockwise on screen */
function ndcQuad(dev: Direct3DDevice9, x0: number, y0: number, x1: number, y1: number, z: number, color: number): void {
  tri(dev, [[x0, y0, z], [x0, y1, z], [x1, y0, z]], color);
  tri(dev, [[x1, y0, z], [x0, y1, z], [x1, y1, z]], color);
}
async function fresh(w = 16, h = 16, format: number = D3DFMT.X8R8G8B8): Promise<Direct3DDevice9> {
  const dev = await newD3D9(w, h, { backBufferFormat: format });
  initFixed(dev);
  ortho(dev);
  dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER | D3DCLEAR.STENCIL, argb(255, 0, 0, 0), 1, 0);
  return dev;
}
const RED = argb(255, 255, 0, 0), GREEN = argb(255, 0, 255, 0), BLUE = argb(255, 0, 0, 255);

describe("culling (needs a WebGPU adapter)", () => {
  // v0 bottom-left, v1 top-left, v2 bottom-right in NDC: clockwise on the screen
  const cw: [number, number, number][] = [[-0.8, -0.8, 0.5], [-0.8, 0.8, 0.5], [0.8, -0.8, 0.5]];
  const ccw: [number, number, number][] = [cw[0]!, cw[2]!, cw[1]!];
  gpuTest("D3DCULL_CCW (default) culls counter-clockwise triangles, CW culls clockwise ones, NONE keeps both", async () => {
    for (const [mode, drawsCw, drawsCcw] of [[D3DCULL.CCW, true, false], [D3DCULL.CW, false, true], [D3DCULL.NONE, true, true]] as const) {
      for (const [name, pts, expected] of [["cw", cw, drawsCw], ["ccw", ccw, drawsCcw]] as const) {
        const dev = await fresh();
        dev.SetRenderState(D3DRS.CULLMODE, mode);
        tri(dev, pts as [number, number, number][], RED);
        const img = await snap(dev);
        expect({ mode, name, drawn: img.at(3, 12).r === 255 }).toEqual({ mode, name, drawn: expected });
        expect(await dev.takeErrorsAsync()).toEqual([]);
      }
    }
  });

  gpuTest("a default device culls CCW (render state default)", async () => {
    const dev = await newD3D9(16, 16);
    expect(dev.GetRenderState(D3DRS.CULLMODE).value).toBe(D3DCULL.CCW);
  });
});

describe("depth (needs a WebGPU adapter)", () => {
  gpuTest("ZENABLE: nearer geometry wins in either draw order; ZWRITEENABLE and ZFUNC", async () => {
    for (const order of ["far-first", "near-first"]) {
      const dev = await fresh();
      const near = (): void => ndcQuad(dev, -0.9, -0.9, 0.9, 0.9, 0.3, RED);
      const far = (): void => ndcQuad(dev, -0.5, -0.5, 0.5, 0.5, 0.7, GREEN);
      if (order === "far-first") { far(); near(); } else { near(); far(); }
      const img = await snap(dev);
      expect(img.at(8, 8)).toMatchObject({ r: 255, g: 0 });
    }
    // ZENABLE off: painter's order
    { const dev = await fresh(); dev.SetRenderState(D3DRS.ZENABLE, D3DZB.FALSE); ndcQuad(dev, -0.9, -0.9, 0.9, 0.9, 0.3, RED); ndcQuad(dev, -0.5, -0.5, 0.5, 0.5, 0.7, GREEN); expect((await snap(dev)).at(8, 8)).toMatchObject({ r: 0, g: 255 }); }
    // ZWRITEENABLE off: the far quad drawn second still passes
    { const dev = await fresh(); dev.SetRenderState(D3DRS.ZWRITEENABLE, 0); ndcQuad(dev, -0.9, -0.9, 0.9, 0.9, 0.3, RED); ndcQuad(dev, -0.5, -0.5, 0.5, 0.5, 0.7, GREEN); expect((await snap(dev)).at(8, 8)).toMatchObject({ r: 0, g: 255 }); }
    // ZFUNC GREATER: the farther one wins
    { const dev = await fresh(); dev.Clear(null, D3DCLEAR.ZBUFFER, 0, 0, 0); dev.SetRenderState(D3DRS.ZFUNC, D3DCMP.GREATER); ndcQuad(dev, -0.9, -0.9, 0.9, 0.9, 0.3, RED); ndcQuad(dev, -0.5, -0.5, 0.5, 0.5, 0.7, GREEN); const img = await snap(dev); expect(img.at(8, 8)).toMatchObject({ r: 0, g: 255 }); expect(img.at(2, 2)).toMatchObject({ r: 255, g: 0 }); }
    // ZFUNC EQUAL
    { const dev = await fresh(); ndcQuad(dev, -0.9, -0.9, 0.9, 0.9, 0.5, RED); dev.SetRenderState(D3DRS.ZFUNC, D3DCMP.EQUAL); ndcQuad(dev, -0.5, -0.5, 0.5, 0.5, 0.5, GREEN); ndcQuad(dev, -0.2, -0.2, 0.2, 0.2, 0.6, BLUE); const img = await snap(dev); expect(img.at(8, 8)).toMatchObject({ g: 255 }); expect(img.at(2, 2)).toMatchObject({ r: 255 }); }
  });

  gpuTest("viewport depth range maps z into [MinZ, MaxZ]", async () => {
    const dev = await fresh();
    dev.SetViewport({ x: 0, y: 0, width: 16, height: 16, minZ: 0.5, maxZ: 1 });
    ndcQuad(dev, -0.9, -0.9, 0.9, 0.9, 0.5, RED); // depth 0.75
    dev.SetViewport({ x: 0, y: 0, width: 16, height: 16, minZ: 0, maxZ: 1 });
    ndcQuad(dev, -0.5, -0.5, 0.5, 0.5, 0.7, GREEN); // depth 0.7 < 0.75: in front
    const img = await snap(dev);
    expect(img.at(8, 8)).toMatchObject({ g: 255 });
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("perspective projection: the Y axis is up, X right (left-handed), depth test through W", async () => {
    const dev = await fresh();
    dev.SetTransform(D3DTS.PROJECTION, matPerspectiveFovLH(Math.PI / 2, 1, 1, 100));
    dev.SetTransform(D3DTS.VIEW, matLookAtLH({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }));
    // fov 90 at distance 2: NDC = world / 2, so the triangle spans NDC 0.25..0.75 = window x 10..14, y 2..6 (Y is up)
    tri(dev, [[0.5, 0.5, 0], [1.5, 0.5, 0], [0.5, 1.5, 0]], RED);
    const vp = { x: 0, y: 0, width: 16, height: 16, minZ: 0, maxZ: 1 };
    const s = vec3Project({ x: 1, y: 1, z: 0 }, vp, dev.GetTransform(D3DTS.PROJECTION), dev.GetTransform(D3DTS.VIEW), matIdentity());
    const img = await snap(dev);
    // the projected point is at (12, 4): upper right of the centre
    expect(near(s.x, 12, 0.01) && near(s.y, 4, 0.01)).toBe(true);
    const reds: [number, number][] = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (img.at(x, y).r === 255) reds.push([x, y]);
    expect(reds.length).toBeGreaterThan(0);
    const mx = reds.reduce((a, p) => a + p[0], 0) / reds.length, my = reds.reduce((a, p) => a + p[1], 0) / reds.length;
    expect(mx).toBeGreaterThan(10); expect(mx).toBeLessThan(13);
    expect(my).toBeGreaterThan(2.5); expect(my).toBeLessThan(5.5);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });
});

describe("blending, alpha test, masks (needs a WebGPU adapter)", () => {
  const bg = argb(255, 100, 150, 200);
  const blendCase = async (src: number, dst: number, op: number, color: number): Promise<{ r: number; g: number; b: number; a: number }> => {
    const dev = await fresh(16, 16, D3DFMT.A8R8G8B8);
    dev.Clear(null, D3DCLEAR.TARGET, bg, 1, 0);
    dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 1);
    dev.SetRenderState(D3DRS.SRCBLEND, src);
    dev.SetRenderState(D3DRS.DESTBLEND, dst);
    dev.SetRenderState(D3DRS.BLENDOP, op);
    ndcQuad(dev, -1, -1, 1, 1, 0.5, color);
    const p = (await snap(dev)).at(8, 8);
    expect(await dev.takeErrorsAsync()).toEqual([]);
    return p;
  };
  const px = (s: number[], d: number[], sf: number[], df: number[], op: "add" | "sub" | "rsub" | "min" | "max"): number[] =>
    s.map((sv, i) => {
      const a = sv / 255 * sf[i]!, b = d[i]! / 255 * df[i]!;
      const v = op === "add" ? a + b : op === "sub" ? a - b : op === "rsub" ? b - a : op === "min" ? Math.min(sv / 255, d[i]! / 255) : Math.max(sv / 255, d[i]! / 255);
      return Math.round(Math.min(1, Math.max(0, v)) * 255);
    });

  gpuTest("SRCALPHA / INVSRCALPHA, ONE/ONE, DESTCOLOR/ZERO, REVSUBTRACT, MIN, MAX", async () => {
    const src = [200, 40, 120, 128], dst = [100, 150, 200, 255];
    const a = 128 / 255;
    const col = argb(src[3]!, src[0]!, src[1]!, src[2]!);
    const cases: [string, number, number, number, number[]][] = [
      ["alpha", D3DBLEND.SRCALPHA, D3DBLEND.INVSRCALPHA, D3DBLENDOP.ADD, px(src, dst, [a, a, a, a], [1 - a, 1 - a, 1 - a, 1 - a], "add")],
      ["additive", D3DBLEND.ONE, D3DBLEND.ONE, D3DBLENDOP.ADD, px(src, dst, [1, 1, 1, 1], [1, 1, 1, 1], "add")],
      ["modulate", D3DBLEND.DESTCOLOR, D3DBLEND.ZERO, D3DBLENDOP.ADD, px(src, dst, dst.map((x) => x / 255), [0, 0, 0, 0], "add")],
      ["rev-subtract", D3DBLEND.ONE, D3DBLEND.ONE, D3DBLENDOP.REVSUBTRACT, px(src, dst, [1, 1, 1, 1], [1, 1, 1, 1], "rsub")],
      ["subtract", D3DBLEND.ONE, D3DBLEND.ONE, D3DBLENDOP.SUBTRACT, px(src, dst, [1, 1, 1, 1], [1, 1, 1, 1], "sub")],
      ["min", D3DBLEND.ONE, D3DBLEND.ONE, D3DBLENDOP.MIN, px(src, dst, [1, 1, 1, 1], [1, 1, 1, 1], "min")],
      ["max", D3DBLEND.ONE, D3DBLEND.ONE, D3DBLENDOP.MAX, px(src, dst, [1, 1, 1, 1], [1, 1, 1, 1], "max")],
      ["inv-src-color", D3DBLEND.INVSRCCOLOR, D3DBLEND.SRCCOLOR, D3DBLENDOP.ADD, px(src, dst, src.map((x) => 1 - x / 255), src.map((x) => x / 255), "add")],
      ["dest-alpha", D3DBLEND.DESTALPHA, D3DBLEND.INVDESTALPHA, D3DBLENDOP.ADD, px(src, dst, [1, 1, 1, 1], [0, 0, 0, 0], "add")],
    ];
    for (const [name, s, d, op, exp] of cases) {
      const p = await blendCase(s, d, op, col);
      const got = [p.r, p.g, p.b, p.a];
      expect({ name, ok: got.every((v, i) => near(v, exp[i]!, 2)), got, exp }).toMatchObject({ name, ok: true });
    }
  });

  gpuTest("BOTHSRCALPHA and BOTHINVSRCALPHA set both factors (D3D9 legacy)", async () => {
    const p = await blendCase(D3DBLEND.BOTHSRCALPHA, D3DBLEND.ONE, D3DBLENDOP.ADD, argb(128, 200, 40, 120));
    const a = 128 / 255;
    expect(near(p.r, Math.round((200 * a + 100 * (1 - a))), 2)).toBe(true);
    const q = await blendCase(D3DBLEND.BOTHINVSRCALPHA, D3DBLEND.ONE, D3DBLENDOP.ADD, argb(128, 200, 40, 120));
    expect(near(q.r, Math.round((200 * (1 - a) + 100 * a)), 2)).toBe(true);
  });

  gpuTest("SEPARATEALPHABLEND uses its own factors for alpha", async () => {
    const dev = await fresh(16, 16, D3DFMT.A8R8G8B8);
    dev.Clear(null, D3DCLEAR.TARGET, argb(100, 100, 150, 200), 1, 0);
    dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 1);
    dev.SetRenderState(D3DRS.SRCBLEND, D3DBLEND.SRCALPHA);
    dev.SetRenderState(D3DRS.DESTBLEND, D3DBLEND.INVSRCALPHA);
    dev.SetRenderState(D3DRS.SEPARATEALPHABLENDENABLE, 1);
    dev.SetRenderState(D3DRS.SRCBLENDALPHA, D3DBLEND.ONE);
    dev.SetRenderState(D3DRS.DESTBLENDALPHA, D3DBLEND.ONE);
    dev.SetRenderState(D3DRS.BLENDOPALPHA, D3DBLENDOP.ADD);
    ndcQuad(dev, -1, -1, 1, 1, 0.5, argb(80, 255, 255, 255));
    const p = (await snap(dev)).at(8, 8);
    expect(near(p.a, 180, 1)).toBe(true);
    expect(near(p.r, Math.round(255 * 80 / 255 + 100 * (1 - 80 / 255)), 2)).toBe(true);
  });

  gpuTest("BLENDFACTOR (D3DRS_BLENDFACTOR) colour", async () => {
    const dev = await fresh(16, 16, D3DFMT.A8R8G8B8);
    dev.Clear(null, D3DCLEAR.TARGET, argb(255, 100, 100, 100), 1, 0);
    dev.SetRenderState(D3DRS.ALPHABLENDENABLE, 1);
    dev.SetRenderState(D3DRS.SRCBLEND, D3DBLEND.BLENDFACTOR);
    dev.SetRenderState(D3DRS.DESTBLEND, D3DBLEND.INVBLENDFACTOR);
    dev.SetRenderState(D3DRS.BLENDFACTOR, argb(0, 255, 128, 0));
    ndcQuad(dev, -1, -1, 1, 1, 0.5, argb(255, 200, 200, 200));
    const p = (await snap(dev)).at(8, 8);
    expect([near(p.r, 200, 1), near(p.g, Math.round(200 * 128 / 255 + 100 * (1 - 128 / 255)), 2), near(p.b, 100, 1)]).toEqual([true, true, true]);
  });

  gpuTest("alpha test: every function against the reference value", async () => {
    // quad alpha 100, ref 100 / 99 / 101
    const funcs: [string, number, [number, number, number]][] = [
      // [name, func, drawn when ref = 99, 100, 101]
      ["NEVER", D3DCMP.NEVER, [0, 0, 0]],
      ["LESS", D3DCMP.LESS, [0, 0, 1]],
      ["EQUAL", D3DCMP.EQUAL, [0, 1, 0]],
      ["LESSEQUAL", D3DCMP.LESSEQUAL, [0, 1, 1]],
      ["GREATER", D3DCMP.GREATER, [1, 0, 0]],
      ["NOTEQUAL", D3DCMP.NOTEQUAL, [1, 0, 1]],
      ["GREATEREQUAL", D3DCMP.GREATEREQUAL, [1, 1, 0]],
      ["ALWAYS", D3DCMP.ALWAYS, [1, 1, 1]],
    ];
    for (const [name, func, drawn] of funcs) {
      [99, 100, 101].forEach(async () => {});
      for (let k = 0; k < 3; k++) {
        const dev = await fresh();
        dev.SetRenderState(D3DRS.ALPHATESTENABLE, 1);
        dev.SetRenderState(D3DRS.ALPHAFUNC, func);
        dev.SetRenderState(D3DRS.ALPHAREF, 99 + k);
        ndcQuad(dev, -1, -1, 1, 1, 0.5, argb(100, 255, 0, 0));
        const p = (await snap(dev)).at(8, 8);
        expect({ name, ref: 99 + k, drawn: p.r === 255 ? 1 : 0 }).toEqual({ name, ref: 99 + k, drawn: drawn[k]! });
      }
    }
  });

  gpuTest("COLORWRITEENABLE masks channels; SCISSORTEST and the viewport clip", async () => {
    const dev = await fresh();
    dev.SetRenderState(D3DRS.COLORWRITEENABLE, D3DCOLORWRITEENABLE.RED | D3DCOLORWRITEENABLE.BLUE);
    ndcQuad(dev, -1, -1, 1, 1, 0.5, argb(255, 200, 100, 50));
    expect((await snap(dev)).at(8, 8)).toMatchObject({ r: 200, g: 0, b: 50 });

    const d2 = await fresh();
    d2.SetRenderState(D3DRS.SCISSORTESTENABLE, 1);
    d2.SetScissorRect({ left: 4, top: 6, right: 10, bottom: 12 });
    ndcQuad(d2, -1, -1, 1, 1, 0.5, RED);
    const i2 = await snap(d2);
    expect(i2.count((p) => p.r === 255)).toBe(6 * 6);
    expect(i2.at(4, 6).r).toBe(255); expect(i2.at(9, 11).r).toBe(255); expect(i2.at(3, 6).r).toBe(0); expect(i2.at(10, 11).r).toBe(0); expect(i2.at(4, 12).r).toBe(0);

    const d3 = await fresh();
    d3.SetViewport({ x: 4, y: 2, width: 8, height: 8, minZ: 0, maxZ: 1 });
    ndcQuad(d3, -1, -1, 1, 1, 0.5, RED);
    const i3 = await snap(d3);
    expect(i3.count((p) => p.r === 255)).toBe(64);
    expect(i3.at(4, 2).r).toBe(255); expect(i3.at(11, 9).r).toBe(255); expect(i3.at(12, 9).r).toBe(0);
    // pre-transformed vertices are clipped to the viewport as well
    const d4 = await fresh();
    d4.SetViewport({ x: 4, y: 2, width: 8, height: 8, minZ: 0, maxZ: 1 });
    drawRhwQuad(d4, 0, 0, 16, 16, RED);
    expect((await snap(d4)).count((p) => p.r === 255)).toBe(64);
    for (const d of [dev, d2, d3, d4]) expect(await d.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("clear honours rectangles and the viewport is not used by Clear", async () => {
    const dev = await fresh();
    dev.Clear([{ left: 2, top: 3, right: 6, bottom: 9 }], D3DCLEAR.TARGET, argb(255, 255, 0, 0), 1, 0);
    const img = await snap(dev);
    expect(img.count((p) => p.r === 255)).toBe(4 * 6);
    expect(img.at(2, 3).r).toBe(255); expect(img.at(5, 8).r).toBe(255); expect(img.at(6, 8).r).toBe(0);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });
});

describe("stencil (needs a WebGPU adapter)", () => {
  gpuTest("REPLACE then EQUAL masks a later draw; INCR/DECR/INVERT/ZERO operations", async () => {
    const dev = await fresh();
    dev.SetRenderState(D3DRS.ZENABLE, D3DZB.FALSE);
    dev.SetRenderState(D3DRS.STENCILENABLE, 1);
    dev.SetRenderState(D3DRS.STENCILFUNC, D3DCMP.ALWAYS);
    dev.SetRenderState(D3DRS.STENCILPASS, D3DSTENCILOP.REPLACE);
    dev.SetRenderState(D3DRS.STENCILREF, 5);
    dev.SetRenderState(D3DRS.COLORWRITEENABLE, 0);
    ndcQuad(dev, -0.5, -0.5, 0.5, 0.5, 0.5, RED);
    dev.SetRenderState(D3DRS.COLORWRITEENABLE, 15);
    dev.SetRenderState(D3DRS.STENCILFUNC, D3DCMP.EQUAL);
    dev.SetRenderState(D3DRS.STENCILPASS, D3DSTENCILOP.KEEP);
    ndcQuad(dev, -1, -1, 1, 1, 0.5, GREEN);
    const img = await snap(dev);
    expect(img.at(8, 8)).toMatchObject({ g: 255 });
    expect(img.at(1, 1)).toMatchObject({ g: 0 });
    expect(img.count((p) => p.g === 255)).toBe(64);

    // INCR twice then test EQUAL 2; DECR; INVERT (0 -> 255), ZERO
    const run = async (ops: number[], ref: number, func: number): Promise<boolean> => {
      const d = await fresh();
      d.SetRenderState(D3DRS.ZENABLE, D3DZB.FALSE);
      d.SetRenderState(D3DRS.STENCILENABLE, 1);
      d.SetRenderState(D3DRS.STENCILFUNC, D3DCMP.ALWAYS);
      d.SetRenderState(D3DRS.COLORWRITEENABLE, 0);
      for (const op of ops) { d.SetRenderState(D3DRS.STENCILPASS, op); ndcQuad(d, -1, -1, 1, 1, 0.5, RED); }
      d.SetRenderState(D3DRS.COLORWRITEENABLE, 15);
      d.SetRenderState(D3DRS.STENCILFUNC, func);
      d.SetRenderState(D3DRS.STENCILREF, ref);
      d.SetRenderState(D3DRS.STENCILPASS, D3DSTENCILOP.KEEP);
      ndcQuad(d, -1, -1, 1, 1, 0.5, GREEN);
      return (await snap(d)).at(8, 8).g === 255;
    };
    expect(await run([D3DSTENCILOP.INCR, D3DSTENCILOP.INCR], 2, D3DCMP.EQUAL)).toBe(true);
    expect(await run([D3DSTENCILOP.INCR, D3DSTENCILOP.INCR, D3DSTENCILOP.DECR], 1, D3DCMP.EQUAL)).toBe(true);
    expect(await run([D3DSTENCILOP.DECR], 0, D3DCMP.EQUAL)).toBe(false); // DECR wraps 0 -> 255
    expect(await run([D3DSTENCILOP.DECR], 255, D3DCMP.EQUAL)).toBe(true);
    expect(await run([D3DSTENCILOP.DECRSAT], 0, D3DCMP.EQUAL)).toBe(true);
    expect(await run([D3DSTENCILOP.INVERT], 255, D3DCMP.EQUAL)).toBe(true);
    expect(await run([D3DSTENCILOP.INCRSAT, D3DSTENCILOP.ZERO], 0, D3DCMP.EQUAL)).toBe(true);
    // D3D compares (ref & mask) FUNC (buffer & mask): after one INCR the buffer holds 1
    expect(await run([D3DSTENCILOP.INCR], 0, D3DCMP.LESS)).toBe(true); // 0 < 1
    expect(await run([D3DSTENCILOP.INCR], 2, D3DCMP.LESS)).toBe(false); // 2 < 1
    expect(await run([D3DSTENCILOP.INCR], 2, D3DCMP.GREATER)).toBe(true);
  });

  gpuTest("STENCILMASK / WRITEMASK", async () => {
    const dev = await fresh();
    dev.SetRenderState(D3DRS.ZENABLE, D3DZB.FALSE);
    dev.SetRenderState(D3DRS.STENCILENABLE, 1);
    dev.SetRenderState(D3DRS.STENCILFUNC, D3DCMP.ALWAYS);
    dev.SetRenderState(D3DRS.STENCILPASS, D3DSTENCILOP.REPLACE);
    dev.SetRenderState(D3DRS.STENCILREF, 0xff);
    dev.SetRenderState(D3DRS.STENCILWRITEMASK, 0x0f);
    dev.SetRenderState(D3DRS.COLORWRITEENABLE, 0);
    ndcQuad(dev, -1, -1, 1, 1, 0.5, RED); // stencil = 0x0f
    dev.SetRenderState(D3DRS.COLORWRITEENABLE, 15);
    dev.SetRenderState(D3DRS.STENCILFUNC, D3DCMP.EQUAL);
    dev.SetRenderState(D3DRS.STENCILPASS, D3DSTENCILOP.KEEP);
    dev.SetRenderState(D3DRS.STENCILMASK, 0xf0);
    dev.SetRenderState(D3DRS.STENCILREF, 0x00); // (0x0f & 0xf0) == (0 & 0xf0)
    ndcQuad(dev, -1, -1, 1, 1, 0.5, GREEN);
    expect((await snap(dev)).at(8, 8)).toMatchObject({ g: 255 });
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });
});
