/**
 * `CKTDXDeviceTexture` with a Direct3D device (x2.exe `_Load` 329682A0, `SetDeviceTexture` 32968070): the size and format a detail level asks
 * for, the Direct3D texture the manager makes, the errors it logs, and the texture cache of the state manager.  The device is a recorder; the
 * expected values are worked out by hand from the decompile.
 */
import { describe, expect, test } from "bun:test";
import { D3DFMT, defaultCaps } from "@els/d3d9";
import type { Direct3DDevice9, Direct3DTexture9 } from "@els/d3d9";
import { KGCMassFileManager } from "@els/host";
import { DL, DeviceManager, DeviceTexture, textureLoadRequest } from "../src/index.ts";

const D3DERR_INVALIDCALL = -2005530516;
const D3DERR_OUTOFVIDEOMEMORY = -2005532292;
const UNKNOWN_ERROR = "알수없는에러"; // `word_334B0660`: "unknown error" in Korean

class FakeTexture {
  refs = 1;
  uploads: [number, number][] = [];
  constructor(readonly name: string, readonly levels = 1) {}
  AddRef(): number { return ++this.refs; }
  Release(): number { return --this.refs; }
  setLevelFromRgba8(level: number, rgba: Uint8Array): void { this.uploads.push([level, rgba.length]); }
}
const asD3D = (t: FakeTexture): Direct3DTexture9 => t as unknown as Direct3DTexture9;

describe("textureLoadRequest: the size and format _Load asks D3DXCheckTextureRequirements for", () => {
  const R8G8B8 = D3DFMT.R8G8B8, A8R8G8B8 = D3DFMT.A8R8G8B8, X8R8G8B8 = D3DFMT.X8R8G8B8, R5G6B5 = D3DFMT.R5G6B5;
  const ask = (w: number, h: number, format: number, level: number) => {
    const r = textureLoadRequest({ Width: w, Height: h, Format: format }, level);
    return [r.width, r.height, r.format];
  };

  test("the numbers of the formats", () => {
    expect([R8G8B8, A8R8G8B8, X8R8G8B8, R5G6B5, D3DFMT.DXT1, D3DFMT.DXT3]).toEqual([20, 21, 22, 23, 0x31545844, 0x33545844]); // 'DXT1', 'DXT3'
    expect([DL.HIGH, DL.MEDIUM, DL.LOW]).toEqual([0, 1, 2]);
  });

  test("DL_HIGH asks for the file's size and D3DFMT_UNKNOWN", () => {
    expect(ask(256, 128, A8R8G8B8, DL.HIGH)).toEqual([256, 128, 0]);
    expect(ask(3, 5, R8G8B8, DL.HIGH)).toEqual([3, 5, 0]);
  });

  test("DL_MEDIUM halves a side of 128 or more; DXT1 for R8G8B8 and R5G6B5 only", () => {
    expect(ask(256, 128, R8G8B8, DL.MEDIUM)).toEqual([128, 64, D3DFMT.DXT1]);
    expect(ask(256, 128, A8R8G8B8, DL.MEDIUM)).toEqual([128, 64, 0]);
    expect(ask(100, 64, R5G6B5, DL.MEDIUM)).toEqual([100, 64, D3DFMT.DXT1]);
    expect(ask(128, 127, X8R8G8B8, DL.MEDIUM)).toEqual([64, 127, 0]);
  });

  test("DL_LOW quarters a side of 128 or more and halves one of 64 to 127; DXT1 for R8G8B8 and R5G6B5, DXT3 for the rest", () => {
    expect(ask(512, 256, X8R8G8B8, DL.LOW)).toEqual([128, 64, D3DFMT.DXT3]);
    expect(ask(128, 64, R8G8B8, DL.LOW)).toEqual([32, 32, D3DFMT.DXT1]);
    expect(ask(127, 63, A8R8G8B8, DL.LOW)).toEqual([63, 63, D3DFMT.DXT3]);
    expect(ask(64, 32, R5G6B5, DL.LOW)).toEqual([32, 32, D3DFMT.DXT1]);
  });
});

describe("CKTDXDeviceTexture.SetDeviceTexture (32968070)", () => {
  class Device {
    calls: string[] = [];
    result = 0;
    SetTexture(stage: number, t: FakeTexture | null): number {
      this.calls.push(`set ${stage} ${t ? t.name : "null"}`);
      return t ? this.result : 0;
    }
  }
  function rig() {
    const device = new Device();
    const states = { apd3dTextures: new Array<Direct3DTexture9 | null>(16).fill(null) };
    const log: { id: number; text?: string }[] = [];
    const make = (id: string) => {
      const t = new DeviceTexture(id, { push: (i, text) => void log.push({ id: i, text }) });
      const gpu = new FakeTexture(id);
      t.m_pTexture = asD3D(gpu);
      return { t, gpu };
    };
    return { device, states, log, make, target: { device, states } as never };
  }

  test("a texture that is not there is error 0x5E with the id, and nothing is set", () => {
    const { device, log, target } = rig();
    const t = new DeviceTexture("A.TGA", { push: (id, text) => void log.push({ id, text }) });
    t.setDeviceTexture(target, 0);
    expect(log).toEqual([{ id: 0x5e, text: "A.TGA" }]);
    expect(device.calls).toEqual([]);
  });

  test("a stage below 16 remembers the texture: the same one is not set again, another one releases the first and is referenced", () => {
    const { device, states, make, target, log } = rig();
    const a = make("A.TGA"), b = make("B.TGA");
    a.t.setDeviceTexture(target, 3);
    expect(device.calls).toEqual(["set 3 A.TGA"]);
    expect([states.apd3dTextures[3] === asD3D(a.gpu), a.gpu.refs]).toEqual([true, 2]);
    a.t.setDeviceTexture(target, 3);
    expect(device.calls.length).toBe(1);
    expect(a.gpu.refs).toBe(2);
    b.t.setDeviceTexture(target, 3);
    expect(device.calls).toEqual(["set 3 A.TGA", "set 3 B.TGA"]);
    expect([states.apd3dTextures[3] === asD3D(b.gpu), a.gpu.refs, b.gpu.refs]).toEqual([true, 1, 2]);
    b.t.setDeviceTexture(target, 4); // another stage has its own memory
    expect(device.calls.length).toBe(3);
    expect(log).toEqual([]);
  });

  test("a stage from 16 sets the texture every time and remembers nothing", () => {
    const { device, states, make, target } = rig();
    const a = make("A.TGA");
    a.t.setDeviceTexture(target, 16);
    a.t.setDeviceTexture(target, 16);
    expect(device.calls).toEqual(["set 16 A.TGA", "set 16 A.TGA"]);
    expect([states.apd3dTextures.every((x) => x === null), a.gpu.refs]).toEqual([true, 1]);
  });

  test("a failing SetTexture clears the stage and is error 0x80: D3DERR_INVALIDCALL or D3DERR_UNKNOWN, a space, the id; the texture is remembered anyway", () => {
    const { device, states, make, target, log } = rig();
    const a = make("A.TGA");
    device.result = D3DERR_INVALIDCALL;
    a.t.setDeviceTexture(target, 0);
    expect(device.calls).toEqual(["set 0 A.TGA", "set 0 null"]);
    expect(log).toEqual([{ id: 0x80, text: "D3DERR_INVALIDCALL A.TGA" }]);
    expect(states.apd3dTextures[0] === asD3D(a.gpu)).toBe(true);
    const b = make("B.TGA");
    device.result = -1;
    b.t.setDeviceTexture(target, 16); // from 16 there is no clearing call
    expect(device.calls).toEqual(["set 0 A.TGA", "set 0 null", "set 16 B.TGA"]);
    expect(log[1]).toEqual({ id: 0x80, text: "D3DERR_UNKNOWN B.TGA" });
  });
});

describe("the Direct3D texture CKTDXDeviceManager.openTexture makes", () => {
  /** an uncompressed true-colour TGA of w x h pixels */
  function tga(w: number, h: number, bpp: 24 | 32): Uint8Array {
    const bytes = new Uint8Array(18 + w * h * (bpp / 8));
    bytes[2] = 2;
    bytes[12] = w & 255; bytes[13] = w >> 8; bytes[14] = h & 255; bytes[15] = h >> 8;
    bytes[16] = bpp;
    bytes[17] = bpp === 32 ? 8 | 0x20 : 0x20; // alpha bits, top-left origin
    for (let i = 18; i < bytes.length; i++) bytes[i] = (i * 7) & 255;
    return bytes;
  }

  class D3D {
    calls: string[] = [];
    failWith = 0;
    textures: FakeTexture[] = [];
    GetDeviceCaps() { return defaultCaps(); }
    CreateTexture(w: number, h: number, levels: number, usage: number, format: number, pool: number): { hr: number; tex: FakeTexture | null } {
      this.calls.push(`create ${w}x${h} levels ${levels} usage ${usage} format ${format} pool ${pool}`);
      if (this.failWith) return { hr: this.failWith, tex: null };
      const tex = new FakeTexture(`T${this.textures.length}`, levels);
      this.textures.push(tex);
      return { hr: 0, tex };
    }
  }

  /** `unreadable`: members the archive lists but cannot hand out */
  function manager(files: Record<string, Uint8Array>, device: D3D | null, level: number = DL.HIGH, unreadable: string[] = []) {
    const massFiles = new KGCMassFileManager();
    const map = new Map(Object.entries(files));
    massFiles.source = { has: (n) => map.has(n) || unreadable.includes(n), read: (n) => map.get(n) };
    const dm = new DeviceManager(massFiles);
    dm.d3dDevice = device as unknown as Direct3DDevice9 | null;
    dm.textureDetailLevel = level;
    return dm;
  }

  test("DL_HIGH: the file's size, one level, format A8R8G8B8 (UNKNOWN is whatever the device picks), managed pool", () => {
    const d3d = new D3D();
    const dm = manager({ "A.TGA": tga(256, 128, 24) }, d3d);
    const t = dm.openTexture("a.tga")!;
    expect(d3d.calls).toEqual(["create 256x128 levels 1 usage 0 format 21 pool 1"]);
    expect([t.uWidth, t.uHeight, t.info.Width, t.info.Height]).toEqual([256, 128, 256, 128]);
    expect(t.m_pTexture === asD3D(d3d.textures[0]!)).toBe(true);
    expect(d3d.textures[0]!.uploads).toEqual([[0, 256 * 128 * 4]]);
    expect(dm.massFiles.log.entries).toEqual([]);
  });

  test("DL_MEDIUM and DL_LOW make a smaller texture of the same file; the UVs still go by the file's size", () => {
    const medium = new D3D();
    const t = manager({ "A.TGA": tga(256, 128, 24) }, medium, DL.MEDIUM).openTexture("A.TGA")!;
    expect(medium.calls).toEqual(["create 128x64 levels 1 usage 0 format 21 pool 1"]); // DXT1 is asked for; a TGA is not block-copied, A8R8G8B8 it is
    expect([t.uWidth, t.uHeight, t.info.Width, t.info.Height]).toEqual([128, 64, 256, 128]);
    expect(medium.textures[0]!.uploads).toEqual([[0, 128 * 64 * 4]]);
    const low = new D3D();
    const u = manager({ "B.TGA": tga(256, 128, 32) }, low, DL.LOW).openTexture("B.TGA")!;
    expect(low.calls).toEqual(["create 64x32 levels 1 usage 0 format 21 pool 1"]);
    expect([u.uWidth, u.uHeight]).toEqual([64, 32]);
  });

  test("a texture that cannot be made is error 0x5A (the HRESULT's name, a space, the id) and does not open; the TET is not read then", () => {
    const d3d = new D3D();
    d3d.failWith = D3DERR_OUTOFVIDEOMEMORY;
    const dm = manager({ "A.TGA": tga(8, 8, 24), "A.TET": new Uint8Array(40) }, d3d);
    expect(dm.openTexture("A.TGA")).toBeUndefined();
    expect(dm.massFiles.log.entries).toEqual([{ id: 0x5a, text: "D3DERR_OUTOFVIDEOMEMORY A.TGA" }]);
    expect(dm.openTexture("A.TGA")).toBeUndefined(); // it stays in the map as a failed device
    d3d.failWith = -1;
    const other = manager({ "B.TGA": tga(8, 8, 24) }, d3d);
    other.openTexture("B.TGA");
    expect(other.massFiles.log.entries).toEqual([{ id: 0x5a, text: `${UNKNOWN_ERROR} B.TGA` }]);
  });

  test("no image bytes is error 0x58 and then 0x5A with E_FAIL (an unknown error); an image D3DX cannot read is 0x59 and then 0x5A with D3DXERR_INVALIDDATA", () => {
    const d3d = new D3D();
    const empty = manager({}, d3d, DL.HIGH, ["A.TGA"]);
    expect(empty.openTexture("A.TGA")).toBeUndefined();
    expect(empty.massFiles.log.entries).toEqual([{ id: 0x58, text: "A.TGA" }, { id: 0x5a, text: `${UNKNOWN_ERROR} A.TGA` }]);
    const junk = manager({ "B.TGA": Uint8Array.from({ length: 64 }, (_, i) => 200 + (i & 7)) }, d3d);
    expect(junk.openTexture("B.TGA")).toBeUndefined();
    expect(junk.massFiles.log.entries).toEqual([{ id: 0x59, text: "B.TGA" }, { id: 0x5a, text: "D3DXERR_INVALIDDATA B.TGA" }]);
    expect(d3d.calls).toEqual([]);
  });

  test("a TET that does not open is error 0x5F with the TET's name; the texture still loads without its UV table, also without a device", () => {
    const d3d = new D3D();
    const files = { "A.TGA": tga(8, 8, 24), "A.TET": new Uint8Array(40) };
    const dm = manager(files, d3d);
    const t = dm.openTexture("A.TGA")!;
    expect(dm.massFiles.log.entries).toEqual([{ id: 0x5f, text: "A.TET" }]);
    expect([t.tet === undefined, t.m_pTexture !== null]).toEqual([true, true]);
    const bare = manager(files, null);
    const u = bare.openTexture("A.TGA")!;
    expect(bare.massFiles.log.entries).toEqual([{ id: 0x5f, text: "A.TET" }]);
    expect([u.m_pTexture, u.uWidth, u.uHeight, u.info.Width]).toEqual([null, 0, 0, 8]); // headless: no Direct3D texture
  });
});
