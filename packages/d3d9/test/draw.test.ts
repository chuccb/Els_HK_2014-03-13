/**
 * Every way the exe submits geometry (static / dynamic buffers, user pointers, lists / strips / fans, indexed or not, with
 * start/base/min offsets) must produce the same picture.
 */
import { describe, expect, test } from "bun:test";
import { D3DCLEAR, D3DFMT, D3DFVF, D3DLOCK, D3DPOOL, D3DPT, D3DUSAGE, D3DRS } from "../src/index.ts";
import type { Direct3DDevice9 } from "../src/index.ts";
import { argb, gpuAvailable, initFixed, newD3D9, packVertices, snap } from "./gpu-helper.ts";
import type { Image } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;
const FVF = D3DFVF.XYZRHW | D3DFVF.DIFFUSE;
const RED = argb(255, 255, 0, 0), GREEN = argb(255, 0, 255, 0);

/** Four corners of an 8x8 quad at (x,y), in the order TL TR BL BR (strip) */
const quad = (x: number, y: number, c: number): number[][] => [[x, y, 0.5, 1, c], [x + 8, y, 0.5, 1, c], [x, y + 8, 0.5, 1, c], [x + 8, y + 8, 0.5, 1, c]];

async function fresh(): Promise<Direct3DDevice9> {
  const dev = await newD3D9(24, 12);
  initFixed(dev);
  dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
  dev.SetFVF(FVF);
  return dev;
}
const q1 = quad(2, 2, RED), q2 = quad(14, 2, GREEN);

/** The reference picture: both quads via DrawPrimitiveUP triangle strips */
async function reference(): Promise<Image> {
  const dev = await fresh();
  for (const q of [q1, q2]) { const { bytes, stride } = packVertices(FVF, q); dev.DrawPrimitiveUP(D3DPT.TRIANGLESTRIP, 2, bytes, stride); }
  const img = await snap(dev);
  expect(await dev.takeErrorsAsync()).toEqual([]);
  return img;
}
const same = (a: Image, b: Image): boolean => Buffer.compare(a.rgba, b.rgba) === 0;

function createVb(dev: Direct3DDevice9, bytes: Uint8Array, usage: number, pool: number, lockFlags = 0) {
  const { hr, vb } = dev.CreateVertexBuffer(bytes.length, usage, FVF, pool);
  expect(hr).toBe(0);
  const l = vb!.Lock(0, bytes.length, lockFlags);
  l.data!.set(bytes);
  vb!.Unlock();
  return vb!;
}
function createIb(dev: Direct3DDevice9, idx: number[], usage: number, pool: number, wide = false) {
  const bytes = wide ? new Uint8Array(new Uint32Array(idx).buffer) : new Uint8Array(new Uint16Array(idx).buffer);
  const { hr, ib } = dev.CreateIndexBuffer(bytes.length, usage, wide ? D3DFMT.INDEX32 : D3DFMT.INDEX16, pool);
  expect(hr).toBe(0);
  ib!.Lock(0, bytes.length, 0).data!.set(bytes);
  ib!.Unlock();
  return ib!;
}

describe("draw paths (needs a WebGPU adapter)", () => {
  gpuTest("static vertex buffer: DrawPrimitive with start vertex, strips, lists, fans", async () => {
    const ref = await reference();
    ref.save("draw-reference");
    expect(ref.count((p) => p.r === 255) + ref.count((p) => p.g === 255)).toBe(128);

    // strip: 2 quads (4+4 vertices, second at startVertex 4)
    {
      const dev = await fresh();
      const { bytes, stride } = packVertices(FVF, [...q1, ...q2]);
      const vb = createVb(dev, bytes, D3DUSAGE.WRITEONLY, D3DPOOL.DEFAULT);
      dev.SetStreamSource(0, vb, 0, stride);
      expect(dev.DrawPrimitive(D3DPT.TRIANGLESTRIP, 0, 2)).toBe(0);
      expect(dev.DrawPrimitive(D3DPT.TRIANGLESTRIP, 4, 2)).toBe(0);
      expect(same(await snap(dev), ref)).toBe(true);
      expect(await dev.takeErrorsAsync()).toEqual([]);
    }
    // list: 6 vertices per quad, second quad at startVertex 6, buffer offset 12 bytes of padding via SetStreamSource offset
    {
      const dev = await fresh();
      const list = (q: number[][]): number[][] => [q[0]!, q[1]!, q[2]!, q[2]!, q[1]!, q[3]!];
      const { bytes, stride } = packVertices(FVF, [[0, 0, 0, 1, 0], ...list(q1), ...list(q2)]);
      const vb = createVb(dev, bytes, D3DUSAGE.WRITEONLY, D3DPOOL.MANAGED);
      dev.SetStreamSource(0, vb, stride, stride);
      dev.DrawPrimitive(D3DPT.TRIANGLELIST, 0, 2);
      dev.DrawPrimitive(D3DPT.TRIANGLELIST, 6, 2);
      expect(same(await snap(dev), ref)).toBe(true);
      expect(await dev.takeErrorsAsync()).toEqual([]);
    }
    // fan: TL TR BR BL
    {
      const dev = await fresh();
      const fan = (q: number[][]): number[][] => [q[0]!, q[1]!, q[3]!, q[2]!];
      const { bytes, stride } = packVertices(FVF, [...fan(q1), ...fan(q2)]);
      const vb = createVb(dev, bytes, D3DUSAGE.WRITEONLY, D3DPOOL.DEFAULT);
      dev.SetStreamSource(0, vb, 0, stride);
      dev.DrawPrimitive(D3DPT.TRIANGLEFAN, 0, 2);
      dev.DrawPrimitive(D3DPT.TRIANGLEFAN, 4, 2);
      expect(same(await snap(dev), ref)).toBe(true);
      expect(await dev.takeErrorsAsync()).toEqual([]);
    }
  });

  gpuTest("static buffers: DrawIndexedPrimitive with base/min/start offsets, 16 and 32 bit indices, list/strip/fan", async () => {
    const ref = await reference();
    for (const wide of [false, true]) for (const prim of [D3DPT.TRIANGLELIST, D3DPT.TRIANGLESTRIP, D3DPT.TRIANGLEFAN]) {
      const dev = await fresh();
      // vertex buffer: 3 junk vertices, then q1 (4), q2 (4)
      const junk = [[0, 0, 0.9, 1, argb(255, 9, 9, 9)], [1, 1, 0.9, 1, argb(255, 9, 9, 9)], [2, 2, 0.9, 1, argb(255, 9, 9, 9)]];
      const { bytes, stride } = packVertices(FVF, [...junk, ...q1, ...q2]);
      const vb = createVb(dev, bytes, D3DUSAGE.WRITEONLY, D3DPOOL.DEFAULT);
      // quad indices relative to BaseVertexIndex (strip order TL TR BL BR -> list 0 1 2 2 1 3 -> fan 0 1 3 2)
      const idxFor = (first: number): number[] => (prim === D3DPT.TRIANGLELIST ? [0, 1, 2, 2, 1, 3] : prim === D3DPT.TRIANGLESTRIP ? [0, 1, 2, 3] : [0, 1, 3, 2]).map((i) => i + first);
      // index buffer: 5 junk indices, quad 1 indices (relative to q1 start = 0), quad 2 indices (relative to 0 as well; drawn with base 4)
      const i1 = idxFor(0), i2 = idxFor(0);
      const ib = createIb(dev, [7, 7, 7, 7, 7, ...i1, ...i2], D3DUSAGE.WRITEONLY, D3DPOOL.DEFAULT, wide);
      dev.SetStreamSource(0, vb, 0, stride);
      dev.SetIndices(ib);
      const prims = prim === D3DPT.TRIANGLELIST ? 2 : 2;
      expect(dev.DrawIndexedPrimitive(prim, 3, 0, 4, 5, prims)).toBe(0); // base 3 -> q1
      expect(dev.DrawIndexedPrimitive(prim, 7, 0, 4, 5 + i1.length, prims)).toBe(0); // base 7 -> q2
      const img = await snap(dev);
      expect(same(img, ref)).toBe(true);
      expect(await dev.takeErrorsAsync()).toEqual([]);
    }
  });

  gpuTest("dynamic buffers (DISCARD, NOOVERWRITE appends) behave like static ones", async () => {
    const ref = await reference();
    const dev = await fresh();
    const stride = 20;
    const { hr, vb } = dev.CreateVertexBuffer(stride * 64, D3DUSAGE.DYNAMIC | D3DUSAGE.WRITEONLY, FVF, D3DPOOL.DEFAULT);
    expect(hr).toBe(0);
    dev.SetStreamSource(0, vb!, 0, stride);
    // first draw: DISCARD lock at offset 0, 4 vertices
    let l = vb!.Lock(0, stride * 4, D3DLOCK.DISCARD);
    l.data!.set(packVertices(FVF, q1).bytes);
    vb!.Unlock();
    dev.DrawPrimitive(D3DPT.TRIANGLESTRIP, 0, 2);
    // second draw: NOOVERWRITE append after the first 4 vertices (draw 1 must keep its data)
    l = vb!.Lock(stride * 4, stride * 4, D3DLOCK.NOOVERWRITE);
    l.data!.set(packVertices(FVF, q2).bytes);
    vb!.Unlock();
    dev.DrawPrimitive(D3DPT.TRIANGLESTRIP, 4, 2);
    expect(same(await snap(dev), ref)).toBe(true);
    expect(await dev.takeErrorsAsync()).toEqual([]);

    // DISCARD between draws in the same frame: both draws must see their own data
    const dev2 = await fresh();
    const b2 = dev2.CreateVertexBuffer(stride * 64, D3DUSAGE.DYNAMIC | D3DUSAGE.WRITEONLY, FVF, D3DPOOL.DEFAULT).vb!;
    dev2.SetStreamSource(0, b2, 0, stride);
    for (const q of [q1, q2]) {
      const lk = b2.Lock(0, stride * 4, D3DLOCK.DISCARD);
      lk.data!.set(packVertices(FVF, q).bytes);
      b2.Unlock();
      dev2.DrawPrimitive(D3DPT.TRIANGLESTRIP, 0, 2);
    }
    expect(same(await snap(dev2), ref)).toBe(true);

    // dynamic index buffer + dynamic vertex buffer, indexed fan/strip with offsets
    const dev3 = await fresh();
    const vb3 = dev3.CreateVertexBuffer(stride * 64, D3DUSAGE.DYNAMIC | D3DUSAGE.WRITEONLY, FVF, D3DPOOL.DEFAULT).vb!;
    const ib3 = dev3.CreateIndexBuffer(2 * 64, D3DUSAGE.DYNAMIC | D3DUSAGE.WRITEONLY, D3DFMT.INDEX16, D3DPOOL.DEFAULT).ib!;
    dev3.SetStreamSource(0, vb3, 0, stride);
    dev3.SetIndices(ib3);
    vb3.Lock(0, stride * 11, D3DLOCK.DISCARD).data!.set(packVertices(FVF, [[0, 0, 0.9, 1, 1], [0, 0, 0.9, 1, 1], [0, 0, 0.9, 1, 1], ...q1, ...q2]).bytes);
    vb3.Unlock();
    ib3.Lock(0, 2 * 12, D3DLOCK.DISCARD).data!.set(new Uint8Array(new Uint16Array([9, 9, 0, 1, 2, 3, 0, 1, 2, 3]).buffer));
    ib3.Unlock();
    dev3.DrawIndexedPrimitive(D3DPT.TRIANGLESTRIP, 3, 0, 4, 2, 2);
    dev3.DrawIndexedPrimitive(D3DPT.TRIANGLESTRIP, 7, 0, 4, 6, 2);
    expect(same(await snap(dev3), ref)).toBe(true);
    expect(await dev3.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("user-pointer draws: indexed with min vertex, fan", async () => {
    const ref = await reference();
    const dev = await fresh();
    const stride = 20;
    // vertices 0..2 unused, 3..10 used (minVertexIndex 3, numVertices 8)
    const all = packVertices(FVF, [[0, 0, 0.9, 1, 1], [0, 0, 0.9, 1, 1], [0, 0, 0.9, 1, 1], ...q1, ...q2]).bytes;
    const idx = new Uint8Array(new Uint16Array([3, 4, 5, 5, 4, 6, 7, 8, 9, 9, 8, 10]).buffer);
    expect(dev.DrawIndexedPrimitiveUP(D3DPT.TRIANGLELIST, 3, 8, 4, idx, D3DFMT.INDEX16, all, stride)).toBe(0);
    expect(same(await snap(dev), ref)).toBe(true);

    const dev2 = await fresh();
    const fan = (q: number[][]): number[][] => [q[0]!, q[1]!, q[3]!, q[2]!];
    for (const q of [q1, q2]) { const { bytes } = packVertices(FVF, fan(q)); expect(dev2.DrawPrimitiveUP(D3DPT.TRIANGLEFAN, 2, bytes, stride)).toBe(0); }
    expect(same(await snap(dev2), ref)).toBe(true);
    expect(await dev.takeErrorsAsync()).toEqual([]);
    expect(await dev2.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("a static buffer rewritten between two draws of the same frame keeps both pictures (resource renaming)", async () => {
    const ref = await reference();
    const dev = await fresh();
    const stride = 20;
    const vb = createVb(dev, packVertices(FVF, q1).bytes, D3DUSAGE.WRITEONLY, D3DPOOL.DEFAULT);
    dev.SetStreamSource(0, vb, 0, stride);
    dev.DrawPrimitive(D3DPT.TRIANGLESTRIP, 0, 2);
    vb.Lock(0, stride * 4, 0).data!.set(packVertices(FVF, q2).bytes);
    vb.Unlock();
    dev.DrawPrimitive(D3DPT.TRIANGLESTRIP, 0, 2);
    expect(same(await snap(dev), ref)).toBe(true);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });

  gpuTest("lines and points are drawn (line list / strip, point list)", async () => {
    const dev = await fresh();
    const stride = 20;
    const w = argb(255, 255, 255, 255);
    // horizontal line from (2,5) to (10,5): D3D9 line rasterisation covers the pixel row y=5
    const { bytes } = packVertices(FVF, [[2, 5, 0.5, 1, w], [10, 5, 0.5, 1, w]]);
    expect(dev.DrawPrimitiveUP(D3DPT.LINELIST, 1, bytes, stride)).toBe(0);
    const pts = packVertices(FVF, [[15, 3, 0.5, 1, w], [17, 7, 0.5, 1, w]]).bytes;
    expect(dev.DrawPrimitiveUP(D3DPT.POINTLIST, 2, pts, stride)).toBe(0);
    const img = await snap(dev);
    img.save("draw-lines");
    const white = img.count((p) => p.r === 255 && p.g === 255);
    expect(white).toBeGreaterThanOrEqual(8 + 2);
    expect(img.at(5, 5).r).toBe(255);
    expect(img.at(15, 3).r).toBe(255);
    expect(img.at(17, 7).r).toBe(255);
    expect(await dev.takeErrorsAsync()).toEqual([]);
  });
});
