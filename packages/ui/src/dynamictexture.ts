/**
 * `CKTDGDynamicTexture` (0x20 bytes): a texture the CPU writes into.  The glyph cache of a `CKTDGFreeTypeFont` draws its pages with it.
 *
 * Two Direct3D textures back it, as in the exe: a system-memory one (pool 2) the CPU keeps LOCKED all the time (`LockRect` with
 * `D3DLOCK.NO_DIRTY_UPDATE`, so `m_LockedRect.pBits` is always valid) and a default-pool one (pool 0) the GPU samples.  A writer tells
 * `SetChange(rect)` which part it changed (`AddDirtyRect` and the update flag); `SetTexture(stage)` copies the system texture into the
 * video one first when something changed (`UnlockRect`, `UpdateTexture`, `LockRect` again), then sets the video texture on the stage
 * through the state manager's mirror `ms_apd3dTextures`.  `@els/d3d9` has no `AddDirtyRect`: `UpdateTexture` copies the whole texture,
 * which gives the same pixels (the system texture holds all of them).
 *
 * Without a Direct3D device (`device` null: the census and most tests) the pixels live in a plain array and nothing is uploaded; the
 * exe never runs without a device, so this is the port's own mode, what the text measuring needs (the glyph metrics come from the
 * rasteriser, not from the GPU).
 *
 * | member | address |
 * |---|---|
 * | `~CKTDGDynamicTexture` (`Destroy`) | 32963240 |
 * | `CreateTexture` | 329632C0 |
 * | `LostDevice` | 32963490 |
 * | `ResetDevice` | 329634B0 |
 * | `SetChange` | 329635D0 |
 * | `SetTexture` | 32963600 |
 *
 * A C++ destructor is a method `Destroy()` (a TypeScript class has none): the exe's own `delete` / `~X()` call sites call it.
 */
import { D3DLOCK, D3DPOOL, D3DXCreateTexture } from "@els/d3d9";
import type { Direct3DDevice9, Direct3DTexture9 } from "@els/d3d9";
import type { Rect } from "./rect.ts";
import type { ErrorLogLike, TextureTarget } from "./device.ts";

/** what a dynamic texture reaches: `g_pKTDXApp->m_pd3dDevice`, the state manager's texture mirror, `g_CKTDXLog` */
export interface DynamicTextureHost {
  /** the Direct3D device; null: no device (the pixels stay on the CPU) */
  readonly device: Direct3DDevice9 | null;
  /** `g_pd3dDevice` and `ms_apd3dTextures` (`UIRender` is one); null with no device */
  readonly target: TextureTarget | null;
  readonly log: ErrorLogLike;
}

/** the HRESULTs `CreateTexture` names (the others are logged without a text) */
const D3DERR_INVALIDCALL = -2005530516;
const D3DERR_NOTAVAILABLE = -2005530518;
const E_OUTOFMEMORY = -2147024882;
const D3DERR_OUTOFVIDEOMEMORY = -2005532292;

function hresultName(hr: number): string | undefined {
  switch (hr) {
    case D3DERR_NOTAVAILABLE: return "D3DERR_NOTAVAILABLE";
    case E_OUTOFMEMORY: return "E_OUTOFMEMORY";
    case D3DERR_OUTOFVIDEOMEMORY: return "D3DERR_OUTOFVIDEOMEMORY";
    case D3DERR_INVALIDCALL: return "D3DERR_INVALIDCALL";
    default: return undefined;
  }
}

export class CKTDGDynamicTexture {
  /**
   * `m_LockedRect.pBits` seen as 32-bit pixels (the texture is A8R8G8B8, `D3DFMT_A8R8G8B8` = 21: the glyph cache writes
   * `(alpha << 24) | 0xFFFFFF`); `m_LockedRect.Pitch` is `pitch` bytes
   */
  pBits: Uint32Array | null = null;
  pitch = 0;
  /** `m_pTextureSys` (pool 2) and `m_pTextureVid` (pool 0) */
  m_pTextureSys: Direct3DTexture9 | null = null;
  m_pTextureVid: Direct3DTexture9 | null = null;
  /** `m_bUpdateTexture`: `SetChange` was called since the last upload */
  m_bUpdateTexture = false;
  m_dwWidth = 0;
  m_dwHeight = 0;
  m_d3dFormat = 0;
  /** not in the exe: the rectangles `SetChange` reported since the last upload (what `AddDirtyRect` collected) */
  readonly dirtyRects: Rect[] = [];

  constructor(private readonly host: DynamicTextureHost) {}

  /**
   * `CreateTexture(dwWidth, dwHeight, d3dFormat)` (329632C0): a failure is logged (error 9 for the system texture, 0x72 for the video
   * one, with the name of the HRESULT when it is one of four) and answers false.
   */
  CreateTexture(dwWidth: number, dwHeight: number, d3dFormat: number): boolean {
    this.m_dwWidth = dwWidth >>> 0;
    this.m_dwHeight = dwHeight >>> 0;
    this.m_d3dFormat = d3dFormat;
    const device = this.host.device;
    if (!device) {
      if (d3dFormat !== 21) throw new Error(`CKTDGDynamicTexture: format ${d3dFormat} without a device (only A8R8G8B8 is ported)`);
      this.pBits = new Uint32Array(dwWidth * dwHeight);
      this.pitch = dwWidth * 4;
      this.m_bUpdateTexture = false;
      return true;
    }
    const sys = D3DXCreateTexture(device, dwWidth, dwHeight, 1, 0, d3dFormat, D3DPOOL.SYSTEMMEM);
    if (sys.hr < 0 || !sys.tex) {
      this.host.log.push(9, hresultName(sys.hr));
      return false;
    }
    this.m_pTextureSys = sys.tex;
    // `DXUTGetDeviceObjectsReset()`: the device objects exist (a device the app has made is always in that state here)
    const vid = D3DXCreateTexture(device, this.m_dwWidth, this.m_dwHeight, 1, 0, d3dFormat, D3DPOOL.DEFAULT);
    if (vid.hr < 0 || !vid.tex) {
      this.host.log.push(0x72, hresultName(vid.hr));
      return false;
    }
    this.m_pTextureVid = vid.tex;
    this.m_bUpdateTexture = false;
    this.lock();
    return true;
  }

  /** `m_pTextureSys->LockRect(0, &m_LockedRect, NULL, D3DLOCK.NO_DIRTY_UPDATE)` */
  private lock(): void {
    const lk = this.m_pTextureSys!.LockRect(0, null, D3DLOCK.NO_DIRTY_UPDATE);
    if (lk.pBits) {
      this.pBits = new Uint32Array(lk.pBits.buffer, lk.pBits.byteOffset, lk.pBits.byteLength >> 2);
      this.pitch = lk.pitch;
    }
  }

  /** `SetChange(rect)` (329635D0): an empty rectangle changes nothing */
  SetChange(rect: Rect): void {
    if (rect.right > rect.left && rect.bottom > rect.top) {
      if (this.pBits !== null) {
        // `m_pTextureSys` null is the headless case: the exe has the texture, the flag is the same
        this.dirtyRects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
        this.m_bUpdateTexture = true;
      }
    }
  }

  /**
   * `SetTexture(iStage)` (32963600): upload what changed, then set the video texture on the stage.  A stage below 16 goes through
   * the mirror (nothing happens when the stage holds the texture already; otherwise `SetTexture`, a failing one followed by
   * `SetTexture(stage, NULL)`, then the old texture is released and this one referenced); from 16 the device is called directly.
   * A failing `SetTexture` is error 0xD.
   */
  SetTexture(iStage: number): void {
    if (this.m_bUpdateTexture) {
      this.m_bUpdateTexture = false;
      this.dirtyRects.length = 0;
      const sys = this.m_pTextureSys;
      if (sys && this.m_pTextureVid && this.host.device) {
        sys.UnlockRect(0);
        this.host.device.UpdateTexture(sys, this.m_pTextureVid);
        this.lock();
      }
    }
    const vid = this.m_pTextureVid;
    const target = this.host.target;
    if (!vid || !target) return; // no device: nothing to set
    let hr: number;
    if (iStage < 0x10) {
      const mirror = target.states.apd3dTextures;
      if (mirror[iStage] === vid) return;
      hr = target.device.SetTexture(iStage, vid);
      if (hr < 0) target.device.SetTexture(iStage, null);
      mirror[iStage]?.Release();
      mirror[iStage] = vid;
      vid.AddRef();
    } else {
      hr = target.device.SetTexture(iStage, vid);
    }
    if (hr < 0) this.host.log.push(0xd);
  }

  /**
   * `~CKTDGDynamicTexture` (32963240): the system texture is unlocked and released, the video one released (the exe's `delete` then frees the
   * object).  The pixel array the object still holds is the exe's dangling `m_LockedRect`: nothing may use it any more.
   */
  Destroy(): void {
    const sys = this.m_pTextureSys;
    if (sys) {
      sys.UnlockRect(0);
      sys.Release();
      this.m_pTextureSys = null;
    }
    const vid = this.m_pTextureVid;
    if (vid) {
      vid.Release();
      this.m_pTextureVid = null;
    }
  }

  /**
   * `LostDevice()` (32963490): the device is going to be reset: the default-pool texture is released (it cannot survive a `Reset`).  The
   * system texture, which holds the pixels, stays, still locked.
   */
  LostDevice(): void {
    const vid = this.m_pTextureVid;
    if (vid) {
      vid.Release();
      this.m_pTextureVid = null;
    }
  }

  /**
   * `ResetDevice()` (329634B0): the device is back.  The old video texture (if any) is released, a new one made (`D3DXCreateTexture`, one
   * level, usage 0, pool 0, the size and format `CreateTexture` was given) and filled from the system texture: unlock, mark it all dirty
   * (`AddDirtyRect(NULL)`; `UpdateTexture` here copies all of it anyway), `UpdateTexture` (a failure is error 0xC with the text
   * `"D3DERR_INVALIDCALL."`, and goes on), the update flag cleared, locked again (`D3DLOCK_NO_DIRTY_UPDATE`).  A texture that cannot be made
   * is error 0xB (named like `CreateTexture`'s) and stays without a video texture.  Without a device (the pixels on the CPU only) nothing is
   * to be done.
   */
  ResetDevice(): void {
    const device = this.host.device;
    if (!device) return;
    this.LostDevice(); // the exe releases the old texture first, the same two lines
    const made = D3DXCreateTexture(device, this.m_dwWidth, this.m_dwHeight, 1, 0, this.m_d3dFormat, D3DPOOL.DEFAULT);
    if (made.hr < 0 || !made.tex) {
      this.host.log.push(0xb, hresultName(made.hr));
      return;
    }
    this.m_pTextureVid = made.tex;
    const sys = this.m_pTextureSys;
    if (sys) {
      sys.UnlockRect(0);
      if (device.UpdateTexture(sys, made.tex) < 0) this.host.log.push(0xc, "D3DERR_INVALIDCALL.");
      this.m_bUpdateTexture = false;
      this.dirtyRects.length = 0; // (the port's list of what AddDirtyRect collected: all of it went)
      this.lock();
    }
  }
}
