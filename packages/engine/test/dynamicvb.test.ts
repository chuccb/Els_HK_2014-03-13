/**
 * `CKTDGDynamicVBManager` (x2.exe 328E2DB0 .. 328E3730, 328E56E0): the buffer ring and the way vertices are appended to it.  The device
 * is a recorder; the expected values are worked out by hand from the decompile (comments say how).
 */
import { describe, expect, test } from "bun:test";
import { D3DLOCK, D3DPOOL, D3DPT, D3DUSAGE } from "@els/d3d9";
import { CKTDGDynamicVBManager, ConvertToNumPrimitives, ConvertToNumVertices, DVB_TYPE, DYNAMIC_VB_MODE } from "../src/index.ts";
import type { DynamicVBDevice, DynamicVertexBuffer } from "../src/index.ts";

class FakeVB implements DynamicVertexBuffer {
  readonly data: Uint8Array;
  readonly locks: { offset: number; size: number; flags: number }[] = [];
  released = false;
  failLock = false;
  constructor(readonly id: number, readonly length: number, readonly usage: number, readonly fvf: number, readonly pool: number) {
    this.data = new Uint8Array(length);
  }
  Lock(offset: number, size: number, flags: number): { hr: number; data: Uint8Array | null } {
    if (this.failLock) return { hr: -1, data: null };
    this.locks.push({ offset, size, flags });
    return { hr: 0, data: this.data.subarray(offset, offset + size) };
  }
  Unlock(): number {
    return 0;
  }
  Release(): number {
    this.released = true;
    return 0;
  }
}

class FakeDevice implements DynamicVBDevice {
  readonly log: string[] = [];
  readonly vbs: FakeVB[] = [];
  readonly upData: Uint8Array[] = [];
  maxPrimitiveCount = 0xfffff;
  GetDeviceCaps(): { MaxPrimitiveCount: number } {
    return { MaxPrimitiveCount: this.maxPrimitiveCount };
  }
  CreateVertexBuffer(length: number, usage: number, fvf: number, pool: number): { hr: number; vb: DynamicVertexBuffer | null } {
    const vb = new FakeVB(this.vbs.length, length, usage, fvf, pool);
    this.vbs.push(vb);
    return { hr: 0, vb };
  }
  SetFVF(fvf: number): number {
    this.log.push(`fvf ${fvf}`);
    return 0;
  }
  SetStreamSource(stream: number, vb: DynamicVertexBuffer | null, offset: number, stride: number): number {
    if (stream !== 0 || offset !== 0) throw new Error("the manager only uses stream 0 at offset 0");
    this.log.push(`src ${(vb as FakeVB).id} ${stride}`);
    return 0;
  }
  DrawPrimitive(primitiveType: number, startVertex: number, primitiveCount: number): number {
    this.log.push(`draw ${primitiveType} ${startVertex} ${primitiveCount}`);
    return 0;
  }
  DrawPrimitiveUP(primitiveType: number, primitiveCount: number, vertexData: Uint8Array, stride: number): number {
    this.log.push(`up ${primitiveType} ${primitiveCount} ${vertexData.length} ${stride}`);
    this.upData.push(vertexData.slice());
    return 0;
  }
}

/** bytes that tell where they came from */
const pattern = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255);

describe("ConvertToNumPrimitives / ConvertToNumVertices", () => {
  test("every primitive type", () => {
    const P = D3DPT;
    const prims = (t: number, n: number): number => ConvertToNumPrimitives(t, n);
    expect([0, 1, 2, 3, 7, 10].map((n) => prims(P.POINTLIST, n))).toEqual([0, 1, 2, 3, 7, 10]);
    expect([0, 1, 2, 3, 7, 10].map((n) => prims(P.LINELIST, n))).toEqual([0, 0, 1, 1, 3, 5]);
    expect([0, 1, 2, 3, 7, 10].map((n) => prims(P.LINESTRIP, n))).toEqual([0, 0, 1, 2, 6, 9]);
    expect([0, 1, 2, 3, 7, 10].map((n) => prims(P.TRIANGLELIST, n))).toEqual([0, 0, 0, 1, 2, 3]);
    expect([0, 1, 2, 3, 7, 10].map((n) => prims(P.TRIANGLESTRIP, n))).toEqual([0, 0, 0, 1, 5, 8]);
    expect([0, 1, 2, 3, 7, 10].map((n) => prims(P.TRIANGLEFAN, n))).toEqual([0, 0, 0, 1, 5, 8]);
    expect(prims(0, 9)).toBe(0);
    expect(prims(7, 9)).toBe(0);
    const verts = (t: number, n: number): number => ConvertToNumVertices(t, n);
    expect([0, 1, 2, 5].map((n) => verts(P.POINTLIST, n))).toEqual([0, 1, 2, 5]);
    expect([0, 1, 2, 5].map((n) => verts(P.LINELIST, n))).toEqual([0, 2, 4, 10]);
    expect([0, 1, 2, 5].map((n) => verts(P.LINESTRIP, n))).toEqual([0, 2, 3, 6]);
    expect([0, 1, 2, 5].map((n) => verts(P.TRIANGLELIST, n))).toEqual([0, 3, 6, 15]);
    expect([0, 1, 2, 5].map((n) => verts(P.TRIANGLESTRIP, n))).toEqual([0, 3, 4, 7]);
    expect([0, 1, 2, 5].map((n) => verts(P.TRIANGLEFAN, n))).toEqual([0, 3, 4, 7]);
    expect(verts(0, 4)).toBe(0);
    expect(verts(9, 4)).toBe(0);
  });
});

describe("CKTDGDynamicVBManager: the buffers", () => {
  test("DYNAMICVB makes the ring of every type: 1 + 10 + 1 + 10 buffers, dynamic and write-only, in the default pool", () => {
    const dev = new FakeDevice();
    const m = new CKTDGDynamicVBManager(dev);
    expect(m.m_eDynamicVBMode).toBe(DYNAMIC_VB_MODE.DYNAMICVB);
    expect(m.m_uNumMaxPrimitiveCount).toBe(0xfffff);
    expect(m.m_pDrawPrimitiveFn).not.toBeNull();
    expect(dev.vbs.length).toBe(22);
    const shape = [[1024, 66, 16, 1], [4096, 322, 24, 10], [1024, 258, 20, 1], [40960, 324, 28, 10]] as const;
    let at = 0;
    shape.forEach(([vertices, fvf, stride, buffers], type) => {
      const info = m.m_aDynamicVBInfo[type]!;
      expect([info.m_uNumVertices, info.m_dwFVF, info.m_dwVertexStride, info.m_vecVBInfo.length, info.m_iCurVBInfoIndex]).toEqual([vertices, fvf, stride, buffers, 0]);
      for (let k = 0; k < buffers; k++, at++) {
        const vb = dev.vbs[at]!;
        expect([vb.length, vb.usage, vb.fvf, vb.pool]).toEqual([vertices * stride, D3DUSAGE.DYNAMIC | D3DUSAGE.WRITEONLY, fvf, D3DPOOL.DEFAULT]);
        expect(info.m_vecVBInfo[k]!.m_pVB).toBe(vb);
      }
    });
    expect(dev.vbs[12]!.length).toBe(40960 * 28);
  });

  test("PRIMITIVEUP makes no buffers (one description each)", () => {
    const dev = new FakeDevice();
    const m = new CKTDGDynamicVBManager(dev, DYNAMIC_VB_MODE.PRIMITIVEUP);
    expect(dev.vbs.length).toBe(0);
    expect(m.m_aDynamicVBInfo.map((i) => i.m_vecVBInfo.length)).toEqual([1, 1, 1, 1]);
    expect(m.m_pDrawPrimitiveFn).not.toBeNull();
  });

  test("the modes that are not ported leave no draw function", () => {
    expect(new CKTDGDynamicVBManager(new FakeDevice(), DYNAMIC_VB_MODE.MANAGED).m_pDrawPrimitiveFn).toBeNull();
    expect(new CKTDGDynamicVBManager(new FakeDevice(), DYNAMIC_VB_MODE.DYNAMICVB_WITH_TRY_CATCH).m_pDrawPrimitiveFn).toBeNull();
  });

  test("a manager without a device has descriptions but no buffers and draws nothing", () => {
    const m = new CKTDGDynamicVBManager(null);
    expect(m.m_aDynamicVBInfo[3]!.m_uNumVertices).toBe(40960);
    expect(m.m_aDynamicVBInfo[3]!.m_vecVBInfo.every((i) => i.m_pVB === null)).toBe(true);
    expect(m.m_pDrawPrimitiveFn).toBeNull();
    m.drawPrimitive(DVB_TYPE.XYZRHW_DIFFUSE_TEX1, D3DPT.TRIANGLESTRIP, 2, pattern(112), 1);
  });

  test("OnLostDevice releases the buffers and stops drawing; OnResetDevice makes new ones", () => {
    const dev = new FakeDevice();
    const m = new CKTDGDynamicVBManager(dev);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, pattern(112), 1);
    expect(m.m_aDynamicVBInfo[3]!.m_vecVBInfo[0]!.m_uCurVertexIndex).toBe(4);
    expect(m.onLostDevice()).toBe(0);
    expect(dev.vbs.every((v) => v.released)).toBe(true);
    expect(m.m_pDrawPrimitiveFn).toBeNull();
    expect(m.m_aDynamicVBInfo[3]!.m_vecVBInfo.every((i) => i.m_pVB === null && i.m_uCurVertexIndex === 0)).toBe(true);
    dev.log.length = 0;
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, pattern(112), 1);
    expect(dev.log).toEqual([]);
    expect(m.onResetDevice()).toBe(0);
    expect(dev.vbs.length).toBe(44);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, pattern(112), 1);
    expect(dev.log).toEqual(["fvf 324", "src 34 28", "draw 5 0 2"]); // the first buffer of the new type-3 ring: 22 + 12
  });

  test("CustomFinalize resets every description and releases the buffers", () => {
    const dev = new FakeDevice();
    const m = new CKTDGDynamicVBManager(dev);
    m.customFinalize();
    expect(dev.vbs.every((v) => v.released)).toBe(true);
    expect(m.m_aDynamicVBInfo.map((i) => [i.m_uNumVertices, i.m_dwFVF, i.m_dwVertexStride, i.m_iCurVBInfoIndex])).toEqual([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  });
});

describe("_DrawPrimitiveDynamicVB", () => {
  const quad = pattern(112); // four 28 byte vertices
  const setup = (): { dev: FakeDevice; m: CKTDGDynamicVBManager } => {
    const dev = new FakeDevice();
    return { dev, m: new CKTDGDynamicVBManager(dev) };
  };

  test("a UI quad: SetFVF, SetStreamSource, a DISCARD lock at offset 0, the copy, DrawPrimitive(strip, 0, 2)", () => {
    const { dev, m } = setup();
    m.drawPrimitive(DVB_TYPE.XYZRHW_DIFFUSE_TEX1, D3DPT.TRIANGLESTRIP, 2, quad, 1);
    expect(dev.log).toEqual(["fvf 324", "src 12 28", "draw 5 0 2"]);
    const vb = dev.vbs[12]!;
    expect(vb.locks).toEqual([{ offset: 0, size: 112, flags: D3DLOCK.DISCARD }]);
    expect(Array.from(vb.data.subarray(0, 112))).toEqual(Array.from(quad));
    expect(m.m_aDynamicVBInfo[3]!.m_vecVBInfo[0]!.m_uCurVertexIndex).toBe(4);
  });

  test("the next quad goes behind it with a NOOVERWRITE lock and is drawn from vertex 4", () => {
    const { dev, m } = setup();
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, quad, 1);
    const second = quad.map((b) => b ^ 0x55);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, second, 1);
    expect(dev.log).toEqual(["fvf 324", "src 12 28", "draw 5 0 2", "fvf 324", "src 12 28", "draw 5 4 2"]);
    const vb = dev.vbs[12]!;
    expect(vb.locks[1]).toEqual({ offset: 112, size: 112, flags: D3DLOCK.NOOVERWRITE });
    expect(Array.from(vb.data.subarray(112, 224))).toEqual(Array.from(second));
    expect(m.m_aDynamicVBInfo[3]!.m_vecVBInfo[0]!.m_uCurVertexIndex).toBe(8);
  });

  test("a repeat count draws the same vertices that many times from one copy", () => {
    const { dev, m } = setup();
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, quad, 3);
    expect(dev.log).toEqual(["fvf 324", "src 12 28", "draw 5 0 2", "draw 5 0 2", "draw 5 0 2"]);
    expect(dev.vbs[12]!.locks.length).toBe(1);
  });

  test("an argument that makes no draw makes no call (type, primitive count, data, repeat count)", () => {
    const { dev, m } = setup();
    m.drawPrimitive(4, D3DPT.TRIANGLESTRIP, 2, quad, 1);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 0, quad, 1);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, null, 1);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, quad, 0);
    m.drawPrimitive(3, 0, 2, quad, 1); // a primitive type with no vertices
    expect(dev.log).toEqual([]);
  });

  test("a device that reports no primitives draws nothing", () => {
    const dev = new FakeDevice();
    dev.maxPrimitiveCount = 0;
    const m = new CKTDGDynamicVBManager(dev);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, quad, 1);
    expect(dev.log).toEqual([]);
  });

  test("a lock that fails ends the draw before DrawPrimitive and leaves the position", () => {
    const { dev, m } = setup();
    dev.vbs[12]!.failLock = true;
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, quad, 1);
    expect(dev.log).toEqual(["fvf 324", "src 12 28"]);
    expect(m.m_aDynamicVBInfo[3]!.m_vecVBInfo[0]!.m_uCurVertexIndex).toBe(0);
  });

  test("vertices that do not fit are cut where the buffer ends and the rest starts the next lap (a one-buffer ring wraps to itself)", () => {
    // type 0: 1024 vertices of 16 bytes in a single buffer.  Three lists of 100 triangles fill 900 vertices; the fourth has 300: 124 fit
    // behind them (41 triangles = 123 vertices), the remaining 59 triangles = 177 vertices start the buffer again with a DISCARD lock
    const { dev, m } = setup();
    const list = pattern(300 * 16);
    for (let k = 0; k < 3; k++) m.drawPrimitive(DVB_TYPE.XYZ_DIFFUSE, D3DPT.TRIANGLELIST, 100, list, 1);
    expect(dev.log.filter((l) => l.startsWith("draw"))).toEqual(["draw 4 0 100", "draw 4 300 100", "draw 4 600 100"]);
    dev.log.length = 0;
    const fourth = pattern(300 * 16).map((b) => b ^ 0xa5);
    m.drawPrimitive(DVB_TYPE.XYZ_DIFFUSE, D3DPT.TRIANGLELIST, 100, fourth, 1);
    expect(dev.log).toEqual(["fvf 66", "src 0 16", "draw 4 900 41", "draw 4 0 59"]);
    const vb = dev.vbs[0]!;
    expect(vb.locks.slice(3)).toEqual([
      { offset: 900 * 16, size: 123 * 16, flags: D3DLOCK.NOOVERWRITE },
      { offset: 0, size: 177 * 16, flags: D3DLOCK.DISCARD },
    ]);
    expect(Array.from(vb.data.subarray(900 * 16, 1023 * 16))).toEqual(Array.from(fourth.subarray(0, 123 * 16)));
    expect(Array.from(vb.data.subarray(0, 177 * 16))).toEqual(Array.from(fourth.subarray(123 * 16, 300 * 16)));
    expect(m.m_aDynamicVBInfo[0]!.m_vecVBInfo[0]!.m_uCurVertexIndex).toBe(177);
  });

  test("the pieces are drawn as often as the repeat count says", () => {
    const { dev, m } = setup();
    const list = pattern(300 * 16);
    for (let k = 0; k < 3; k++) m.drawPrimitive(0, D3DPT.TRIANGLELIST, 100, list, 1);
    dev.log.length = 0;
    m.drawPrimitive(0, D3DPT.TRIANGLELIST, 100, list, 2);
    expect(dev.log).toEqual(["fvf 66", "src 0 16", "draw 4 900 41", "draw 4 900 41", "draw 4 0 59", "draw 4 0 59"]);
  });

  test("a full buffer moves the ring on to the next buffer, which is bound with SetStreamSource and locked with DISCARD", () => {
    // type 1: 4096 vertices of 24 bytes in ten buffers (ids 1..10).  1365 triangles take 4095 vertices; one more triangle does not fit
    const { dev, m } = setup();
    m.drawPrimitive(DVB_TYPE.XYZ_DIFFUSE_TEX1, D3DPT.TRIANGLELIST, 1365, pattern(4095 * 24), 1);
    expect(dev.log).toEqual(["fvf 322", "src 1 24", "draw 4 0 1365"]);
    dev.log.length = 0;
    const tri = pattern(72);
    m.drawPrimitive(1, D3DPT.TRIANGLELIST, 1, tri, 1);
    expect(dev.log).toEqual(["fvf 322", "src 1 24", "src 2 24", "draw 4 0 1"]);
    expect(dev.vbs[2]!.locks).toEqual([{ offset: 0, size: 72, flags: D3DLOCK.DISCARD }]);
    expect(Array.from(dev.vbs[2]!.data.subarray(0, 72))).toEqual(Array.from(tri));
    expect(m.m_aDynamicVBInfo[1]!.m_iCurVBInfoIndex).toBe(1);
    dev.log.length = 0;
    m.drawPrimitive(1, D3DPT.TRIANGLELIST, 1, tri, 1); // it goes on in the buffer it moved to
    expect(dev.log).toEqual(["fvf 322", "src 2 24", "draw 4 3 1"]);
    expect(dev.vbs[2]!.locks[1]).toEqual({ offset: 72, size: 72, flags: D3DLOCK.NOOVERWRITE });
  });

  test("a full last buffer sends the ring round to the first buffer", () => {
    // the tenth buffer of type 1 (id 10) is full; the first one (id 1) is next, bound again and locked with DISCARD
    const { dev, m } = setup();
    const info = m.m_aDynamicVBInfo[1]!;
    info.m_iCurVBInfoIndex = 9;
    info.m_vecVBInfo[9]!.m_uCurVertexIndex = 4096;
    const tri = pattern(72);
    m.drawPrimitive(1, D3DPT.TRIANGLELIST, 1, tri, 1);
    expect(dev.log).toEqual(["fvf 322", "src 10 24", "src 1 24", "draw 4 0 1"]);
    expect(dev.vbs[1]!.locks).toEqual([{ offset: 0, size: 72, flags: D3DLOCK.DISCARD }]);
    expect(info.m_iCurVBInfoIndex).toBe(0);
    expect(info.m_vecVBInfo[0]!.m_uCurVertexIndex).toBe(3);
  });

  test("a list cut at the end of the last buffer goes on in the first one", () => {
    // buffer 10 of type 1 has 4093 vertices in use: 1 triangle (3 vertices) fits, the other 2 start buffer 1 with a DISCARD lock
    const { dev, m } = setup();
    const info = m.m_aDynamicVBInfo[1]!;
    info.m_iCurVBInfoIndex = 9;
    info.m_vecVBInfo[9]!.m_uCurVertexIndex = 4093;
    const tris = pattern(9 * 24);
    m.drawPrimitive(1, D3DPT.TRIANGLELIST, 3, tris, 1);
    // 3 vertices are left, but the piece rule is "what fits": 1 triangle, then the rest (2 triangles) in the next buffer
    expect(dev.log).toEqual(["fvf 322", "src 10 24", "draw 4 4093 1", "src 1 24", "draw 4 0 2"]);
    expect(dev.vbs[10]!.locks).toEqual([{ offset: 4093 * 24, size: 3 * 24, flags: D3DLOCK.NOOVERWRITE }]);
    expect(dev.vbs[1]!.locks).toEqual([{ offset: 0, size: 6 * 24, flags: D3DLOCK.DISCARD }]);
    expect(Array.from(dev.vbs[1]!.data.subarray(0, 144))).toEqual(Array.from(tris.subarray(72)));
  });

  test("a strip is cut at an even number of triangles and the next piece starts two vertices back", () => {
    // type 0: a strip of 1000 triangles takes 1002 vertices; 21 more need 23 and 22 are left: 20 triangles go behind it (22 vertices),
    // the 21st (vertices 20, 21, 22 of the strip) starts the buffer again
    const { dev, m } = setup();
    m.drawPrimitive(0, D3DPT.TRIANGLESTRIP, 1000, pattern(1002 * 16), 1);
    dev.log.length = 0;
    const strip = pattern(23 * 16);
    m.drawPrimitive(0, D3DPT.TRIANGLESTRIP, 21, strip, 1);
    expect(dev.log).toEqual(["fvf 66", "src 0 16", "draw 5 1002 20", "draw 5 0 1"]);
    const vb = dev.vbs[0]!;
    expect(vb.locks.slice(1)).toEqual([
      { offset: 1002 * 16, size: 22 * 16, flags: D3DLOCK.NOOVERWRITE },
      { offset: 0, size: 3 * 16, flags: D3DLOCK.DISCARD },
    ]);
    expect(Array.from(vb.data.subarray(0, 48))).toEqual(Array.from(strip.subarray(20 * 16, 23 * 16)));
  });

  test("a fan never splits: it moves to the next buffer and starts it", () => {
    const { dev, m } = setup();
    m.drawPrimitive(0, D3DPT.TRIANGLELIST, 333, pattern(999 * 16), 1);
    dev.log.length = 0;
    const fan = pattern(32 * 16);
    m.drawPrimitive(0, D3DPT.TRIANGLEFAN, 30, fan, 1);
    expect(dev.log).toEqual(["fvf 66", "src 0 16", "draw 6 0 30"]);
    expect(dev.vbs[0]!.locks.at(-1)).toEqual({ offset: 0, size: 32 * 16, flags: D3DLOCK.DISCARD });
    expect(m.m_aDynamicVBInfo[0]!.m_vecVBInfo[0]!.m_uCurVertexIndex).toBe(32);
  });

  test("a fan is cut to MaxPrimitiveCount, and to the buffer when that is smaller", () => {
    const dev = new FakeDevice();
    dev.maxPrimitiveCount = 10;
    const m = new CKTDGDynamicVBManager(dev);
    m.drawPrimitive(0, D3DPT.TRIANGLEFAN, 30, pattern(32 * 16), 1);
    expect(dev.log).toEqual(["fvf 66", "src 0 16", "draw 6 0 10"]);
    expect(dev.vbs[0]!.locks).toEqual([{ offset: 0, size: 12 * 16, flags: D3DLOCK.DISCARD }]);
    dev.log.length = 0;
    dev.maxPrimitiveCount = 0xfffff;
    m.onResetDevice();
    m.drawPrimitive(0, D3DPT.TRIANGLEFAN, 2000, pattern(1024 * 16), 1); // more than the buffer holds: 1022 triangles
    expect(dev.log).toEqual(["fvf 66", "src 22 16", "draw 6 0 1022"]); // the buffer OnResetDevice made (the first 22 ids were the constructor's)
  });
});

describe("_DrawPrimitiveUP", () => {
  const make = (max = 0xfffff): { dev: FakeDevice; m: CKTDGDynamicVBManager } => {
    const dev = new FakeDevice();
    dev.maxPrimitiveCount = max;
    return { dev, m: new CKTDGDynamicVBManager(dev, DYNAMIC_VB_MODE.PRIMITIVEUP) };
  };
  const quad = pattern(112);

  test("SetFVF once, then DrawPrimitiveUP as often as the repeat count says, from the caller's memory", () => {
    const { dev, m } = make();
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, quad, 2);
    expect(dev.log).toEqual(["fvf 324", "up 5 2 112 28", "up 5 2 112 28"]);
    expect(Array.from(dev.upData[0]!)).toEqual(Array.from(quad));
  });

  test("an argument that makes no draw makes no call", () => {
    const { dev, m } = make();
    m.drawPrimitive(7, D3DPT.TRIANGLESTRIP, 2, quad, 1);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 0, quad, 1);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, null, 1);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, quad, 0);
    expect(dev.log).toEqual([]);
    const none = make(0);
    none.m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 2, quad, 1);
    expect(none.dev.log).toEqual([]);
  });

  test("a strip longer than MaxPrimitiveCount is cut into even pieces that share their two vertices", () => {
    // 10 triangles = 12 vertices of 28 bytes (336 bytes), at most 4 triangles per call: 4 + 4 + 2, the pieces start 4 vertices apart
    const { dev, m } = make(4);
    const strip = pattern(12 * 28);
    m.drawPrimitive(3, D3DPT.TRIANGLESTRIP, 10, strip, 1);
    expect(dev.log).toEqual(["fvf 324", "up 5 4 336 28", "up 5 4 224 28", "up 5 2 112 28"]);
    expect(Array.from(dev.upData[1]!)).toEqual(Array.from(strip.subarray(112)));
    expect(Array.from(dev.upData[2]!)).toEqual(Array.from(strip.subarray(224)));
  });

  test("a list is cut into whole triangles", () => {
    const { dev, m } = make(4);
    m.drawPrimitive(3, D3DPT.TRIANGLELIST, 10, pattern(30 * 28), 1);
    expect(dev.log).toEqual(["fvf 324", "up 4 4 840 28", "up 4 4 504 28", "up 4 2 168 28"]);
  });

  test("a fan is cut to MaxPrimitiveCount and drawn once", () => {
    const { dev, m } = make(4);
    m.drawPrimitive(3, D3DPT.TRIANGLEFAN, 10, pattern(12 * 28), 1);
    expect(dev.log).toEqual(["fvf 324", "up 6 4 336 28"]);
  });
});
