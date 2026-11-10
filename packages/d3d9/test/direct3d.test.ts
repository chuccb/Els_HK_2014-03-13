/** `IDirect3D9` (the exe's `g_pD3D`): the adapter's display mode and `CheckDeviceFormat`; the refusal of a dynamic managed texture.  No GPU needed. */
import { describe, expect, test } from "bun:test";
import { D3DDEVTYPE, D3DFMT, D3DPOOL, D3DRTYPE, D3DUSAGE, D3DERR_INVALIDCALL, D3DERR_NOTAVAILABLE, D3D_OK, Direct3D9, Direct3DDevice9 } from "../src/index.ts";

const check = (d3d: Direct3D9, usage: number, format: number, adapterFormat: number = D3DFMT.X8R8G8B8, type: number = D3DRTYPE.TEXTURE): number =>
  d3d.CheckDeviceFormat(0, D3DDEVTYPE.HAL, adapterFormat, usage, type, format);

describe("Direct3D9", () => {
  test("one adapter whose desktop is X8R8G8B8; the mode is a copy", () => {
    const d3d = new Direct3D9();
    expect(d3d.GetAdapterCount()).toBe(1);
    const { hr, mode } = d3d.GetAdapterDisplayMode(0);
    expect([hr, mode!.Width, mode!.Height, mode!.RefreshRate, mode!.Format]).toEqual([D3D_OK, 1024, 768, 60, D3DFMT.X8R8G8B8]);
    mode!.Format = D3DFMT.R5G6B5;
    expect(d3d.GetAdapterDisplayMode(0).mode!.Format).toBe(D3DFMT.X8R8G8B8);
    d3d.displayMode = { Width: 1280, Height: 720, RefreshRate: 75, Format: D3DFMT.R5G6B5 };
    const again = d3d.GetAdapterDisplayMode(0).mode!;
    expect([again.Width, again.Height, again.RefreshRate, again.Format]).toEqual([1280, 720, 75, D3DFMT.R5G6B5]);
    expect([d3d.GetAdapterDisplayMode(1).hr, d3d.GetAdapterDisplayMode(1).mode]).toEqual([D3DERR_INVALIDCALL, null]);
  });

  test("the four formats CBandiVideoTexture_DX9 asks for, as a current card answers: all but the 24-bit R8G8B8", () => {
    const d3d = new Direct3D9();
    expect([D3DFMT.X8R8G8B8, D3DFMT.R8G8B8, D3DFMT.R5G6B5, D3DFMT.X1R5G5B5].map((f) => check(d3d, 0, f))).toEqual([D3D_OK, D3DERR_NOTAVAILABLE, D3D_OK, D3D_OK]);
  });

  test("usage: a render target is not compressed, a depth format is for depth stencils only, nothing else is a depth stencil", () => {
    const d3d = new Direct3D9();
    expect(check(d3d, D3DUSAGE.RENDERTARGET, D3DFMT.A8R8G8B8)).toBe(D3D_OK);
    expect(check(d3d, D3DUSAGE.RENDERTARGET, D3DFMT.DXT5)).toBe(D3DERR_NOTAVAILABLE);
    expect(check(d3d, 0, D3DFMT.DXT5)).toBe(D3D_OK);
    expect(check(d3d, D3DUSAGE.DEPTHSTENCIL, D3DFMT.D24S8, D3DFMT.X8R8G8B8, D3DRTYPE.SURFACE)).toBe(D3D_OK);
    expect(check(d3d, 0, D3DFMT.D24S8)).toBe(D3DERR_NOTAVAILABLE);
    expect(check(d3d, D3DUSAGE.DEPTHSTENCIL, D3DFMT.A8R8G8B8)).toBe(D3DERR_NOTAVAILABLE);
    expect(check(d3d, 0, 9999)).toBe(D3DERR_NOTAVAILABLE);
  });

  test("the adapter, the device type, the adapter format and the resource type are checked first", () => {
    const d3d = new Direct3D9();
    expect(d3d.CheckDeviceFormat(1, D3DDEVTYPE.HAL, D3DFMT.X8R8G8B8, 0, D3DRTYPE.TEXTURE, D3DFMT.X8R8G8B8)).toBe(D3DERR_INVALIDCALL);
    expect(d3d.CheckDeviceFormat(0, D3DDEVTYPE.REF, D3DFMT.X8R8G8B8, 0, D3DRTYPE.TEXTURE, D3DFMT.X8R8G8B8)).toBe(D3DERR_NOTAVAILABLE);
    expect(check(d3d, 0, D3DFMT.X8R8G8B8, D3DFMT.DXT1)).toBe(D3DERR_NOTAVAILABLE);
    for (const adapterFormat of [D3DFMT.A8R8G8B8, D3DFMT.R5G6B5, D3DFMT.X1R5G5B5]) expect(check(d3d, 0, D3DFMT.X8R8G8B8, adapterFormat)).toBe(D3D_OK);
    expect(check(d3d, 0, D3DFMT.X8R8G8B8, D3DFMT.X8R8G8B8, D3DRTYPE.SURFACE)).toBe(D3D_OK);
    expect(check(d3d, 0, D3DFMT.X8R8G8B8, D3DFMT.X8R8G8B8, D3DRTYPE.VERTEXBUFFER)).toBe(D3DERR_NOTAVAILABLE);
  });
});

describe("CreateTexture: a dynamic texture in the managed pool", () => {
  // the check comes before the device is touched: the call needs no GPU
  const create = (usage: number, pool: number): number => Direct3DDevice9.prototype.CreateTexture.call({} as Direct3DDevice9, 16, 16, 1, usage, D3DFMT.X8R8G8B8, pool).hr;

  test("is refused as the runtime refuses it (D3DUSAGE_DYNAMIC with D3DPOOL_MANAGED)", () => {
    expect(create(D3DUSAGE.DYNAMIC, D3DPOOL.MANAGED)).toBe(D3DERR_INVALIDCALL);
    expect(create(D3DUSAGE.DYNAMIC | D3DUSAGE.WRITEONLY, D3DPOOL.MANAGED)).toBe(D3DERR_INVALIDCALL);
  });
});
