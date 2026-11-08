import { describe, expect, test } from "bun:test";
import type { Direct3DDevice9, Direct3DTexture9 } from "@els/d3d9";
import { CKTDGDynamicTexture } from "../src/dynamictexture.ts";
import type { DynamicTextureHost } from "../src/dynamictexture.ts";
import { FakePageTexture, Recorder } from "./rig.ts";

/**
 * CKTDGDynamicTexture (CreateTexture 329632C0, SetChange 329635D0, SetTexture 32963600): every expectation is read off the decompile.
 */
function host(dev: Recorder | null, mirror: (Direct3DTexture9 | null)[] = []) {
  const log: { id: number; text?: string }[] = [];
  const h: DynamicTextureHost = {
    device: dev as unknown as Direct3DDevice9 | null,
    target: dev ? ({ device: dev, states: { apd3dTextures: mirror } } as unknown as DynamicTextureHost["target"]) : null,
    log: { push: (id, text) => void log.push({ id, text }) },
  };
  return { h, log, mirror };
}

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const D3DERR_INVALIDCALL = -2005530516;
const D3DERR_NOTAVAILABLE = -2005530518;
const E_OUTOFMEMORY = -2147024882;
const D3DERR_OUTOFVIDEOMEMORY = -2005532292;

describe("CKTDGDynamicTexture without a device (the pixels stay on the CPU)", () => {
  test("CreateTexture keeps the size and format, makes 256 x 256 32-bit texels (pitch 1024) and nothing is waiting to be uploaded", () => {
    const { h, log } = host(null);
    const t = new CKTDGDynamicTexture(h);
    expect(t.CreateTexture(256, 128, 21)).toBe(true);
    expect([t.m_dwWidth, t.m_dwHeight, t.m_d3dFormat, t.pBits!.length, t.pitch, t.m_bUpdateTexture]).toEqual([256, 128, 21, 256 * 128, 1024, false]);
    expect(t.pBits!.every((v) => v === 0)).toBe(true);
    expect([t.m_pTextureSys, t.m_pTextureVid, log.length]).toEqual([null, null, 0]);
  });

  test("a format other than A8R8G8B8 has no pixels to keep: an error (the exe asks D3DX for it, the port has no device)", () => {
    const t = new CKTDGDynamicTexture(host(null).h);
    expect(() => t.CreateTexture(16, 16, 22)).toThrow(/format 22/);
  });

  test("SetChange: a rectangle with no width or no height changes nothing; any other sets the flag and is remembered until SetTexture", () => {
    const t = new CKTDGDynamicTexture(host(null).h);
    t.CreateTexture(256, 256, 21);
    t.SetChange(rect(5, 5, 5, 9)); // right == left
    t.SetChange(rect(5, 5, 9, 5)); // bottom == top
    t.SetChange(rect(9, 5, 5, 9)); // right < left
    t.SetChange(rect(5, 9, 9, 5)); // bottom < top
    expect([t.m_bUpdateTexture, t.dirtyRects.length]).toEqual([false, 0]);
    t.SetChange(rect(1, 2, 3, 4));
    t.SetChange(rect(10, 20, 11, 21));
    expect(t.m_bUpdateTexture).toBe(true);
    expect(t.dirtyRects).toEqual([rect(1, 2, 3, 4), rect(10, 20, 11, 21)]);
    t.SetTexture(0);
    expect([t.m_bUpdateTexture, t.dirtyRects.length]).toEqual([false, 0]);
  });

  test("SetChange keeps a copy of the rectangle: what the caller does to it afterwards does not reach the list", () => {
    const t = new CKTDGDynamicTexture(host(null).h);
    t.CreateTexture(256, 256, 21);
    const r = rect(1, 2, 3, 4);
    t.SetChange(r);
    r.left = 99;
    r.bottom = 77;
    expect(t.dirtyRects).toEqual([rect(1, 2, 3, 4)]);
  });
});

describe("CKTDGDynamicTexture with a device", () => {
  test("CreateTexture: the system-memory texture (pool 2) first, then the default-pool one (pool 0); the system one is locked for good with D3DLOCK_NO_DIRTY_UPDATE", () => {
    const dev = new Recorder();
    const { h, log } = host(dev);
    const t = new CKTDGDynamicTexture(h);
    expect(t.CreateTexture(256, 256, 21)).toBe(true);
    expect(dev.log).toEqual(["create 0 pool 2 256x256", "create 1 pool 0 256x256"]);
    const [sys, vid] = dev.textures;
    expect([t.m_pTextureSys, t.m_pTextureVid]).toEqual([sys as unknown as Direct3DTexture9, vid as unknown as Direct3DTexture9]);
    expect([sys!.locked, sys!.lockFlags, sys!.lockCount, vid!.locked, vid!.lockCount]).toEqual([true, 0x8000, 1, false, 0]);
    expect(t.pitch).toBe(1024);
    expect(t.pBits!.buffer).toBe(sys!.bits.buffer); // the texel array IS the locked memory
    expect([t.m_bUpdateTexture, log.length]).toEqual([false, 0]);
  });

  test("a system texture that cannot be made is error 9 with the name of the HRESULT (four are named, the others have no text) and the answer is false", () => {
    for (const [hr, text] of [[D3DERR_NOTAVAILABLE, "D3DERR_NOTAVAILABLE"], [E_OUTOFMEMORY, "E_OUTOFMEMORY"], [D3DERR_OUTOFVIDEOMEMORY, "D3DERR_OUTOFVIDEOMEMORY"], [D3DERR_INVALIDCALL, "D3DERR_INVALIDCALL"], [-5, undefined]] as const) {
      const dev = new Recorder();
      dev.textureResults.push(hr);
      const { h, log } = host(dev);
      const t = new CKTDGDynamicTexture(h);
      expect(t.CreateTexture(256, 256, 21)).toBe(false);
      expect(log).toEqual([{ id: 9, text }]);
      expect([t.m_pTextureSys, t.m_pTextureVid, t.pBits]).toEqual([null, null, null]);
    }
  });

  test("a video texture that cannot be made is error 0x72 (named the same way); the system texture stays made but is not locked", () => {
    for (const [hr, text] of [[D3DERR_OUTOFVIDEOMEMORY, "D3DERR_OUTOFVIDEOMEMORY"], [D3DERR_INVALIDCALL, "D3DERR_INVALIDCALL"], [E_OUTOFMEMORY, "E_OUTOFMEMORY"], [D3DERR_NOTAVAILABLE, "D3DERR_NOTAVAILABLE"], [-2005530517, undefined], [-1, undefined]] as const) {
      const dev = new Recorder();
      dev.textureResults.push(0, hr);
      const { h, log } = host(dev);
      const t = new CKTDGDynamicTexture(h);
      expect(t.CreateTexture(256, 256, 21)).toBe(false);
      expect(log).toEqual([{ id: 0x72, text }]);
      expect([t.m_pTextureSys === null, t.m_pTextureVid, dev.textures[0]!.locked]).toEqual([false, null, false]);
    }
  });

  test("SetTexture of a changed texture: unlock, UpdateTexture(system, video), lock again; then the video texture goes on the stage", () => {
    const dev = new Recorder();
    const { h, mirror } = host(dev);
    const t = new CKTDGDynamicTexture(h);
    t.CreateTexture(256, 256, 21);
    dev.log.length = 0;
    t.pBits![7] = 0xff112233;
    t.SetChange(rect(0, 0, 8, 1));
    expect(t.m_bUpdateTexture).toBe(true);
    t.SetTexture(0);
    const [sys, vid] = dev.textures;
    expect(dev.log).toEqual(["update 0 1", "tex 0 page1"]);
    expect([t.m_bUpdateTexture, sys!.locked, sys!.lockCount, sys!.lockFlags]).toEqual([false, true, 2, 0x8000]);
    expect(new Uint32Array(vid!.bits.buffer)[7]).toBe(0xff112233);
    expect(mirror[0]).toBe(vid as unknown as Direct3DTexture9);
    expect(vid!.refs).toBe(2); // made with 1, the mirror holds one more
    // nothing changed: the same texture on the same stage is not set again, and nothing is uploaded
    t.SetTexture(0);
    expect(dev.log).toEqual(["update 0 1", "tex 0 page1"]);
  });

  test("a stage that holds another texture gives it up (Release) and takes this one (AddRef); stages from 16 are set every time and not remembered", () => {
    const dev = new Recorder();
    const a = new CKTDGDynamicTexture(host(dev).h);
    const mirror: (Direct3DTexture9 | null)[] = [];
    const b = new CKTDGDynamicTexture(host(dev, mirror).h);
    const c = new CKTDGDynamicTexture(host(dev, mirror).h);
    for (const t of [a, b, c]) t.CreateTexture(256, 256, 21);
    const vids = [1, 3, 5].map((i) => dev.textures[i]!);
    dev.log.length = 0;
    b.SetTexture(2);
    c.SetTexture(2);
    expect(dev.log).toEqual(["tex 2 page3", "tex 2 page5"]);
    expect([vids[1]!.refs, vids[2]!.refs, mirror[2]]).toEqual([1, 2, vids[2] as unknown as Direct3DTexture9]); // b was released once, c is held
    dev.log.length = 0;
    b.SetTexture(16);
    b.SetTexture(16);
    expect(dev.log).toEqual(["tex 16 page3", "tex 16 page3"]);
    expect(vids[1]!.refs).toBe(1);
    expect(mirror[16]).toBeUndefined();
  });

  test("a SetTexture that fails is followed by SetTexture(stage, NULL) and logged as error 0xD; the mirror still takes the texture", () => {
    const dev = new Recorder();
    const { h, log, mirror } = host(dev);
    const t = new CKTDGDynamicTexture(h);
    t.CreateTexture(256, 256, 21);
    dev.log.length = 0;
    const calls: (FakePageTexture | null)[] = [];
    dev.SetTexture = ((stage: number, tex: FakePageTexture | null) => {
      calls.push(tex);
      return tex ? D3DERR_INVALIDCALL : 0;
    }) as typeof dev.SetTexture;
    t.SetTexture(3);
    expect(calls).toEqual([dev.textures[1]!, null]);
    expect(log).toEqual([{ id: 0xd, text: undefined }]);
    expect(mirror[3]).toBe(dev.textures[1] as unknown as Direct3DTexture9);
    // from stage 16 the same failure is only logged
    calls.length = 0;
    log.length = 0;
    t.SetTexture(16);
    expect(calls).toEqual([dev.textures[1]!]);
    expect(log).toEqual([{ id: 0xd, text: undefined }]);
  });

  test("CreateTexture: both textures are of the size asked for, width first (128 x 64), with ONE level", () => {
    const dev = new Recorder();
    const t = new CKTDGDynamicTexture(host(dev).h);
    expect(t.CreateTexture(128, 64, 21)).toBe(true);
    expect(dev.log).toEqual(["create 0 pool 2 128x64", "create 1 pool 0 128x64"]);
    expect(dev.textures.map((x) => x.levels)).toEqual([1, 1]);
    expect([t.m_dwWidth, t.m_dwHeight, t.pBits!.length, t.pitch]).toEqual([128, 64, 128 * 64, 512]);
  });

  test("SetTexture unlocks the system texture before it is the source of UpdateTexture (Direct3D wants it unlocked), and a SetTexture that works logs nothing, from stage 0 or from 16", () => {
    const dev = new Recorder();
    const { h, log } = host(dev);
    const t = new CKTDGDynamicTexture(h);
    t.CreateTexture(256, 256, 21);
    t.SetChange(rect(0, 0, 8, 1));
    t.SetTexture(0);
    t.SetTexture(16);
    expect(dev.lockedUpdates).toEqual([]);
    expect(dev.log.filter((l) => l.startsWith("update"))).toEqual(["update 0 1"]);
    expect(log).toEqual([]);
  });

  test("SetTexture of a texture that was never made (no video texture): nothing happens", () => {
    const dev = new Recorder();
    const t = new CKTDGDynamicTexture(host(dev).h);
    dev.log.length = 0;
    t.SetTexture(0);
    expect(dev.log).toEqual([]);
  });
});

describe("the life of the device (~CKTDGDynamicTexture 32963240, LostDevice 32963490, ResetDevice 329634B0)", () => {
  /** a texture made on a recorder (`w` x `h`), the log cleared: the system texture is 0, the video texture 1 */
  const made = (w = 256, h = 256) => {
    const dev = new Recorder();
    const hh = host(dev);
    const t = new CKTDGDynamicTexture(hh.h);
    t.CreateTexture(w, h, 21);
    dev.log.length = 0;
    return { dev, t, log: hh.log };
  };

  test("Destroy unlocks the system texture BEFORE it releases it, and releases the video texture: both go, the pointers are null; the second Destroy has nothing to do", () => {
    const { dev, t } = made();
    const [sys, vid] = dev.textures;
    expect([sys!.locked, sys!.refs, vid!.refs]).toEqual([true, 1, 1]);
    let lockedAtRelease: boolean | undefined;
    const release = sys!.Release.bind(sys);
    sys!.Release = () => {
      lockedAtRelease = sys!.locked;
      return release();
    };
    t.Destroy();
    expect(lockedAtRelease).toBe(false);
    expect([sys!.locked, sys!.refs, vid!.refs]).toEqual([false, 0, 0]);
    expect([t.m_pTextureSys, t.m_pTextureVid]).toEqual([null, null]);
    t.Destroy();
    expect([sys!.refs, vid!.refs]).toEqual([0, 0]);
  });

  test("Destroy of a texture whose video texture could not be made releases the system one only; of one that was never made it does nothing", () => {
    const dev = new Recorder();
    dev.textureResults.push(0, E_OUTOFMEMORY);
    const t = new CKTDGDynamicTexture(host(dev).h);
    expect(t.CreateTexture(256, 256, 21)).toBe(false);
    expect(dev.textures[0]!.refs).toBe(1);
    t.Destroy();
    expect([dev.textures[0]!.refs, t.m_pTextureSys, t.m_pTextureVid]).toEqual([0, null, null]);
    new CKTDGDynamicTexture(host(dev).h).Destroy(); // no textures at all: no failure
    expect(dev.textures.length).toBe(1);
  });

  test("LostDevice releases the video texture only: the system texture stays, locked, with its pixels; a second LostDevice has nothing to do", () => {
    const { dev, t } = made();
    const [sys, vid] = dev.textures;
    t.pBits![9] = 0x80ffffff;
    t.LostDevice();
    expect([vid!.refs, t.m_pTextureVid]).toEqual([0, null]);
    expect([sys!.refs, sys!.locked, sys!.lockCount, t.m_pTextureSys === null, t.pBits![9]]).toEqual([1, true, 1, false, 0x80ffffff]);
    t.LostDevice();
    expect(vid!.refs).toBe(0);
    expect(dev.log).toEqual([]);
  });

  test("ResetDevice makes a new video texture of the same size (width first) and format, one level, in the default pool, and fills it from the system texture: unlock, UpdateTexture, lock again with D3DLOCK_NO_DIRTY_UPDATE; the update flag is cleared, the pixels are the same", () => {
    const { dev, t, log } = made(128, 64);
    t.pBits![7] = 0xff112233;
    t.pBits![128 * 64 - 1] = 0x80402010;
    t.SetChange(rect(0, 0, 8, 1)); // a change nobody has uploaded
    expect(t.m_bUpdateTexture).toBe(true);
    t.LostDevice();
    t.ResetDevice();
    expect(dev.log).toEqual(["create 2 pool 0 128x64", "update 0 2"]);
    const [sys, , vid] = dev.textures;
    expect([vid!.levels, vid!.usage, vid!.format, log.length]).toEqual([1, 0, 21, 0]);
    expect(t.m_pTextureVid).toBe(vid as unknown as Direct3DTexture9);
    const px = new Uint32Array(vid!.bits.buffer);
    expect([px[7], px[128 * 64 - 1], px[8]]).toEqual([0xff112233, 0x80402010, 0]);
    expect([sys!.locked, sys!.lockCount, sys!.lockFlags, dev.lockedUpdates]).toEqual([true, 2, 0x8000, []]);
    expect([t.m_bUpdateTexture, t.dirtyRects.length]).toEqual([false, 0]);
    expect([vid!.refs, dev.textures[1]!.refs]).toEqual([1, 0]); // the lost one stays released, the new one is held by the texture
  });

  test("ResetDevice of a texture that still has its video texture releases that one first, then does the same", () => {
    const { dev, t } = made();
    t.ResetDevice();
    expect(dev.log).toEqual(["create 2 pool 0 256x256", "update 0 2"]);
    expect([dev.textures[1]!.refs, dev.textures[2]!.refs, t.m_pTextureVid]).toEqual([0, 1, dev.textures[2] as unknown as Direct3DTexture9]);
  });

  test("a video texture that cannot be made is error 0xB, named like CreateTexture's (four are, the others have no text); the texture stays without one, the system texture is left locked as it was", () => {
    for (const [hr, text] of [[D3DERR_NOTAVAILABLE, "D3DERR_NOTAVAILABLE"], [E_OUTOFMEMORY, "E_OUTOFMEMORY"], [D3DERR_OUTOFVIDEOMEMORY, "D3DERR_OUTOFVIDEOMEMORY"], [D3DERR_INVALIDCALL, "D3DERR_INVALIDCALL"], [-5, undefined]] as const) {
      const { dev, t, log } = made();
      dev.textureResults.push(hr);
      t.ResetDevice();
      expect(log).toEqual([{ id: 0xb, text }]);
      expect([t.m_pTextureVid, dev.textures[1]!.refs, dev.textures[0]!.locked, dev.textures[0]!.lockCount, dev.log]).toEqual([null, 0, true, 1, []]);
    }
  });

  test("an UpdateTexture that fails is error 0xC (\"D3DERR_INVALIDCALL.\", with the full stop) and the rest goes on: the flag is cleared and the system texture locked again", () => {
    const { dev, t, log } = made();
    dev.UpdateTexture = (() => D3DERR_INVALIDCALL) as typeof dev.UpdateTexture;
    t.SetChange(rect(0, 0, 2, 2));
    t.ResetDevice();
    expect(log).toEqual([{ id: 0xc, text: "D3DERR_INVALIDCALL." }]);
    expect([t.m_bUpdateTexture, dev.textures[0]!.locked, dev.textures[0]!.lockCount, t.m_pTextureVid === null]).toEqual([false, true, 2, false]);
  });

  test("a texture with no system texture is given a video texture and nothing to copy", () => {
    const { dev, t, log } = made();
    t.m_pTextureSys = null;
    t.ResetDevice();
    expect(dev.log).toEqual(["create 2 pool 0 256x256"]);
    expect([t.m_pTextureVid === null, log]).toEqual([false, []]);
  });

  test("without a device the pixels are on the CPU only: LostDevice, ResetDevice and Destroy leave them alone and cost nothing", () => {
    const { h, log } = host(null);
    const t = new CKTDGDynamicTexture(h);
    t.CreateTexture(256, 256, 21);
    t.pBits![3] = 0x12345678;
    t.SetChange(rect(0, 0, 4, 4));
    t.LostDevice();
    t.ResetDevice();
    t.Destroy();
    expect([t.pBits![3], t.m_bUpdateTexture, log.length]).toEqual([0x12345678, true, 0]);
  });
});
