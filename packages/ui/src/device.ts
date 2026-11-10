/**
 * The texture devices the UI opens: `CKTDXDeviceManager::OpenTexture` (328EE8E0), the `CKTDXDeviceTexture` device behind it and the
 * `CKTDXDeviceManager` device map.  What a UI control needs from a texture is its file's size (`m_Info.Width` / `Height`, the values the
 * UVs are normalised by) and its UV table (`m_tet`, the `.tet` file next to the image).  Without a Direct3D device the texture stops there
 * (the census, most tests); with one (`DeviceManager.d3dDevice`) `_Load` makes the GPU texture too (below).
 *
 * `OpenTexture(id, fmt, bAlwaysHigh, bLog)`:
 *   - an empty id gives null; the id is upper-cased (`_towupper`);
 *   - `OpenDevice`: a device with that id in `m_DeviceMap` is `RefDevice`d (reference count + 1) and `LoadDevice`d: a device whose load
 *     failed stays in the map in state FAILED and keeps answering null;
 *   - otherwise, if `KGCMassFileManager::IsValidFile(id)` (an exact lookup, mapping included), a `CKTDXDeviceTexture` is created
 *     (`bAlwaysHigh` becomes true when the id contains one of `m_HighTexName`: texture detail only, not modelled), put into the map
 *     (`CreateAndOpenDevice`, reference count 1) and loaded.
 * `CKTDXDeviceTexture::_Load` (329682A0): `LoadTwoDataFiles(id, id minus its last 3 characters + L"TET")`; no image bytes is error 0x58
 * (and the load fails); `D3DXGetImageInfoFromFileInMemory` failing is error 0x59 (fails); each failure goes on to error 0x5A with the name
 * of the HRESULT and the id (below); a `.tet` that is there but that `CKTDXDeviceTET_Preprocessing::OpenFile` rejects is error 0x5F with
 * the TET's name (the texture still loads, its UV table stays empty); `m_Info` is the info of the FILE (not of a texture reduced by the
 * detail level).
 * `CloseDevice(id)` (328ED610): upper-case, find, `UnrefDevice`; the last reference removes the device from the map.
 *
 * With a Direct3D device attached (`DeviceManager.d3dDevice`, `g_pKTDXApp->m_pd3dDevice`) `_Load` goes on: the size and format by the detail
 * level (`DL_HIGH`: the file's; `DL_MEDIUM` halves a side of 128 or more, `DL_LOW` quarters it (halves one of 64..127); both ask for DXT1 when
 * the file is `R8G8B8` / `R5G6B5` and `DL_LOW` for DXT3 otherwise; `bAlwaysHigh` skips that), `D3DXCheckTextureRequirements` (managed pool, one
 * mip level), then `D3DXCreateTextureFromFileInMemoryEx` (filter `NONE` when the size is the file's, else `LINEAR`, mip filter `NONE`); a failing
 * step is error 0x5A (the name of the HRESULT, a space and the id) and fails the load, before the TET is read.  `SetDeviceTexture(stage)`
 * binds it.
 *
 * Also here: the render target textures (`OpenRenderTargetTexture` 328EE4C0, which `CKTDGUIControl::CMovieData::SetRect` uses) and
 * the video player (Bandisoft's `bdvid32.dll`, which `CMovieData` plays its file with) as the interfaces `CMovieData` needs of it.
 */
import { parseTet } from "@els/assets";
import type { TetFile } from "@els/assets";
import { D3DCLEAR, D3DFMT, D3DPOOL, D3DPT, D3DUSAGE, D3DXCheckTextureRequirements, D3DXCreateTexture, D3DXCreateTextureFromFileInMemoryEx, D3DXGetImageInfoFromFileInMemory, D3DX_FILTER } from "@els/d3d9";
import type { D3DXImageInfo, Direct3DDevice9, Direct3DSurface9, Direct3DTexture9 } from "@els/d3d9";
import { KGCMassFileManager, towupperAscii } from "@els/host";
import { DVB_TYPE } from "@els/engine";
import { RSI_DEVICE_TEXTURE, VertexUI4 } from "./render.ts";
import type { UIRender } from "./render.ts";

/** `CKTDXDeviceTexture` */
export class DeviceTexture {
  /** m_DeviceID (upper case) */
  readonly deviceID: string;
  /** reference count (`RefDevice` / `UnrefDevice`) */
  refCount = 0;
  /** DEVICE_STATE_FAILED */
  failed = false;
  /** `m_Info` */
  info: D3DXImageInfo = { Width: 0, Height: 0, Depth: 0, MipLevels: 0, Format: 0, ResourceType: 0, ImageFileFormat: 0 };
  /** `m_tet`: the UV rectangles of the `.tet` next to the image (undefined: an empty table) */
  tet: TetFile | undefined;
  /** the image file's bytes (what the renderer turns into a GPU texture) */
  data: Uint8Array = new Uint8Array(0);
  /** `m_pTexture`: the Direct3D texture; null when there was no Direct3D device at load time (headless) or D3DX could not make it */
  m_pTexture: Direct3DTexture9 | null = null;
  /** `m_uWidth` / `m_uHeight`: the size of that texture (the file's, reduced by the detail level and fitted to the device) */
  uWidth = 0;
  uHeight = 0;

  /** `log`: `g_CKTDXLog` (`SetDeviceTexture` reports its failures there) */
  constructor(deviceID: string, private readonly log: ErrorLogLike = { push() {} }) {
    this.deviceID = deviceID;
  }

  /**
   * `SetDeviceTexture(stage)` (32968070): a texture that is not there is error 0x5E.  A stage below 16 has its texture remembered in
   * `ms_apd3dTextures`: the call does nothing when the stage already holds this texture, otherwise `SetTexture` (a failing one is followed by
   * `SetTexture(stage, null)`) and the remembered texture is released and replaced (and referenced).  Stages from 16 are set directly.  A
   * failure (`D3DERR_INVALIDCALL`, else `D3DERR_UNKNOWN`, then a space and the id) is error 0x80.
   */
  setDeviceTexture(target: TextureTarget, stage: number): void {
    const texture = this.m_pTexture;
    if (!texture) {
      this.log.push(0x5e, this.deviceID);
      return;
    }
    let hr: number;
    if (stage < 0x10) {
      const cache = target.states.apd3dTextures;
      if (cache[stage] === texture) {
        hr = 0;
      } else {
        hr = target.device.SetTexture(stage, texture);
        if (hr < 0) target.device.SetTexture(stage, null);
        cache[stage]?.Release();
        cache[stage] = texture;
        texture.AddRef();
      }
    } else {
      hr = target.device.SetTexture(stage, texture);
    }
    if (hr < 0) this.log.push(0x80, `${hr === D3DERR_INVALIDCALL ? "D3DERR_INVALIDCALL" : "D3DERR_UNKNOWN"} ${this.deviceID}`);
  }

  /**
   * `Draw(nX, nY, nWidth, nHeight, color, fRotateDegree)` (329675F0): the whole texture as one quad (`drawDeviceTexture`).
   *
   * Not ported: the rotated quad (`fRotateDegree != 0`: the corners turned about the middle with the CRT's `cos` and `sin`); no
   * control passes a rotation.  It throws.
   */
  draw(render: UIRender, nX: number, nY: number, nWidth: number, nHeight: number, color: number, rotateDegree: number): void {
    if (rotateDegree !== 0) throw new Error("CKTDXDeviceTexture::Draw with a rotation is not ported");
    drawDeviceTexture(render, this, nX, nY, nWidth, nHeight, color);
  }
}

/**
 * What `CKTDXDeviceTexture::Draw` (329675F0, without a rotation) and `CKTDXDeviceRenderTargetTexture::Draw` (32971200) both do (the exe has the code
 * twice): the whole texture as one quad at a place of the 1024 x 768 layout, every corner of the one `color` (ARGB).  `akRSICKTDXDeviceTexture` is
 * pushed for the draw and popped after it.  The corners are `scale * nX - 0.5` and `scale * nY - 0.5` on the left and at the top, but
 * `scale * nWidth + scale * nX` and `scale * nHeight + scale * nY` on the right and at the bottom (no half pixel is taken off there: the quad is half a
 * pixel wider and higher than the layout says), all in single precision and with no cutting to whole pixels.  The vertices are left-top (u v 0 0),
 * left-bottom (0 1), right-top (1 0) and right-bottom (1 1), z = rhw = 1; the texture goes to stage 0 (its `SetDeviceTexture`, which logs an
 * error for a texture that is not there and then draws with what the stage holds) and the strip is handed to the vertex buffer manager, type 3, once.
 */
function drawDeviceTexture(
  render: UIRender, texture: { setDeviceTexture(target: TextureTarget, stage: number): void }, nX: number, nY: number, nWidth: number, nHeight: number, color: number,
): void {
  const f = Math.fround;
  const states = render.states;
  const top = states.stackPointer;
  states.apply(RSI_DEVICE_TEXTURE);
  const sx = render.resolutionScale.x;
  const sy = render.resolutionScale.y;
  const x = f(sx * f(nX));
  const y = f(sy * f(nY));
  const left = f(x - 0.5);
  const upper = f(y - 0.5);
  const right = f(f(f(nWidth) * sx) + x);
  const lower = f(f(f(nHeight) * sy) + y);
  const v = new VertexUI4();
  const corners: [number, number, number, number][] = [
    [left, upper, 0, 0],
    [left, lower, 0, 1],
    [right, upper, 1, 0],
    [right, lower, 1, 1],
  ];
  corners.forEach(([cx, cy, u, w], i) => {
    v.setX(i, cx);
    v.setY(i, cy);
    v.setZ(i, 1);
    v.setRhw(i, 1);
    v.setColor(i, color);
    v.setU(i, u);
    v.setV(i, w);
  });
  texture.setDeviceTexture(render, 0);
  render.dvb.drawPrimitive(DVB_TYPE.XYZRHW_DIFFUSE_TEX1, D3DPT.TRIANGLESTRIP, 2, v.bytes, 1);
  states.popTo(top);
}

/** where the device objects report their errors (`g_CKTDXLog.PushErrorLog`) */
export interface ErrorLogLike {
  push(id: number, text?: string): void;
}

/** what `SetDeviceTexture` reaches: `g_pd3dDevice` and the state manager's `ms_apd3dTextures` */
export interface TextureTarget {
  readonly device: { SetTexture(stage: number, texture: Direct3DTexture9 | null): number };
  readonly states: { readonly apd3dTextures: (Direct3DTexture9 | null)[] };
}

/** the HRESULTs `_Load` and `SetDeviceTexture` name */
const D3DERR_INVALIDCALL = -2005530516;
const HRESULT_NAMES = new Map<number, string>([
  [-2005530518, "D3DERR_NOTAVAILABLE"],
  [-2005532292, "D3DERR_OUTOFVIDEOMEMORY"],
  [D3DERR_INVALIDCALL, "D3DERR_INVALIDCALL"],
  [-2005529767, "D3DXERR_INVALIDDATA"],
  [-2147024882, "E_OUTOFMEMORY"],
]);

/** `CKTDXDeviceTexture::DETAIL_LEVEL` */
export const DL = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

/**
 * What `_Load` (329682A0) asks `D3DXCheckTextureRequirements` for: the file's size and `D3DFMT_UNKNOWN` at `DL_HIGH`; `DL_MEDIUM` halves a
 * side that is 128 or more and asks for DXT1 when the file is `R8G8B8` or `R5G6B5`; `DL_LOW` quarters a side of 128 or more, halves one of
 * 64 to 127, and asks for DXT1 (those two formats) or DXT3 (any other).
 */
export function textureLoadRequest(info: { Width: number; Height: number; Format: number }, level: number): { width: number; height: number; format: number } {
  let width = info.Width, height = info.Height;
  let format: number = D3DFMT.UNKNOWN;
  const small = info.Format === D3DFMT.R8G8B8 || info.Format === D3DFMT.R5G6B5;
  if (level === DL.MEDIUM) {
    if (info.Width >= 0x80) width = info.Width >>> 1;
    if (info.Height >= 0x80) height = info.Height >>> 1;
    if (small) format = D3DFMT.DXT1;
  } else if (level === DL.LOW) {
    if (info.Width >= 0x40) width = info.Width >= 0x80 ? info.Width >>> 2 : info.Width >>> 1;
    if (info.Height >= 0x40) height = info.Height >= 0x80 ? info.Height >>> 2 : info.Height >>> 1;
    format = small ? D3DFMT.DXT1 : D3DFMT.DXT3;
  }
  return { width, height, format };
}

/**
 * `CKTDXDeviceSound` (329718B0): a sound the FMOD system plays.  Only the identity is modelled (the name it was opened under, the
 * 3D settings, the reference count); there is no audio device behind it yet.
 */
export class DeviceSound {
  readonly deviceID: string;
  refCount = 0;
  readonly b3DSound: boolean;
  /** `m_fMaxDistance` (-1: unset) */
  fMaxDistance = -1;
  /** how often `play` was called (nothing is played yet: FMOD becomes WebAudio with the sound layer) */
  plays = 0;

  constructor(deviceID: string, bUse3D: boolean) {
    this.deviceID = deviceID;
    this.b3DSound = bUse3D;
  }

  /** `CKTDXDeviceSound::Play(bLoop, b3DSound)` */
  play(bLoop: boolean, b3DSound: boolean): void {
    void bLoop;
    void b3DSound;
    this.plays++;
  }
}

/** `D3DFMT_A8R8G8B8` */
export const D3DFMT_A8R8G8B8 = 21;

/** `E_FAIL`, what the video library answers when it cannot do what it was asked */
export const E_FAIL = -2147467259;

/**
 * `CKTDXDeviceRenderTargetTexture` (0x6C bytes, vtable 334B096C): a texture that is drawn into.  Its constructor (32970D60) stores the size and the
 * format and, when the Direct3D device objects exist (`DXUTGetDeviceObjectsReset`: here `DeviceManager.d3dDevice`), makes its resources with
 * `OnResetDevice` (32971480).  The four calls a movie makes (`CMovieData::OnFrameRender`) are `BeginRender` (32971050), `Clear` (329710B0),
 * `EndRender` (329713D0) and `Draw` (32971200).  The Direct3D resources are the device's.
 */
export class DeviceRenderTargetTexture {
  /** `m_DeviceID` (upper case) */
  readonly deviceID: string;
  refCount = 0;
  readonly width: number;
  readonly height: number;
  /** `m_D3DFormat`: D3DFMT_UNKNOWN (0) becomes the back buffer's format at the first `OnResetDevice` */
  format: number;
  /** `m_pRenderTargetTexture`, with its level 0 `m_pRenderTargetSurface` and the depth surface `m_pRenderTargetZSurface` of its size */
  m_pRenderTargetTexture: Direct3DTexture9 | null = null;
  m_pRenderTargetSurface: Direct3DSurface9 | null = null;
  m_pRenderTargetZSurface: Direct3DSurface9 | null = null;
  /** the render target and the depth surface of the device at the last `OnResetDevice`, which `EndRender` puts back */
  m_pBackupBuffer: Direct3DSurface9 | null = null;
  m_pBackupZBuffer: Direct3DSurface9 | null = null;

  /** `log`: `g_CKTDXLog` (the failing steps of `OnResetDevice` and `SetDeviceTexture` report there) */
  constructor(deviceID: string, width: number, height: number, format: number, private readonly log: ErrorLogLike = { push() {} }) {
    this.deviceID = deviceID;
    this.width = width | 0;
    this.height = height | 0;
    this.format = format | 0;
  }

  /**
   * `OnLostDevice()` (32971400, vtable slot 1): every resource is released and forgotten (the exe's sixth one, `m_pDisplayVertexBuffer`, is never
   * made).  S_OK.
   */
  onLostDevice(): number {
    this.m_pRenderTargetTexture?.Release();
    this.m_pRenderTargetTexture = null;
    this.m_pRenderTargetSurface?.Release();
    this.m_pRenderTargetSurface = null;
    this.m_pRenderTargetZSurface?.Release();
    this.m_pRenderTargetZSurface = null;
    this.m_pBackupBuffer?.Release();
    this.m_pBackupBuffer = null;
    this.m_pBackupZBuffer?.Release();
    this.m_pBackupZBuffer = null;
    return 0;
  }

  /**
   * `OnResetDevice()` (32971480, slot 0): `OnLostDevice`, then the device's current render target and depth surface are kept as the backups (`GetRenderTarget`
   * and `GetDepthStencilSurface` add a reference each), an unknown format becomes the back buffer's, `D3DXCreateTexture` makes the texture (one level, usage
   * `D3DUSAGE_RENDERTARGET`, the default pool), its level 0 is the render target surface and `CreateDepthStencilSurface` makes a depth surface of the
   * size and the format of the backup's.  A step that fails is error 0x4C (the render target), 0x4D (the depth surface), 0x4E (the texture), 0x4F
   * (its level) or 0x50 (the depth surface) with the id, and `E_FAIL`; what was made before it stays.
   */
  onResetDevice(device: Direct3DDevice9): number {
    this.onLostDevice();
    const back = device.GetRenderTarget(0);
    if (!back) {
      this.log.push(0x4c, this.deviceID);
      return E_FAIL;
    }
    back.AddRef();
    this.m_pBackupBuffer = back;
    const backZ = device.GetDepthStencilSurface();
    if (!backZ) {
      this.log.push(0x4d, this.deviceID);
      return E_FAIL;
    }
    backZ.AddRef();
    this.m_pBackupZBuffer = backZ;
    if (this.format === D3DFMT.UNKNOWN) this.format = back.GetDesc().Format;
    const made = D3DXCreateTexture(device, this.width, this.height, 1, D3DUSAGE.RENDERTARGET, this.format, D3DPOOL.DEFAULT);
    if (made.hr < 0 || !made.tex) {
      this.m_pRenderTargetTexture = null;
      this.log.push(0x4e, this.deviceID);
      return E_FAIL;
    }
    this.m_pRenderTargetTexture = made.tex;
    const level = made.tex.GetSurfaceLevel(0);
    if (!level) {
      this.log.push(0x4f, this.deviceID);
      return E_FAIL;
    }
    this.m_pRenderTargetSurface = level;
    const z = device.CreateDepthStencilSurface(this.width, this.height, backZ.GetDesc().Format);
    if (z.hr < 0 || !z.surface) {
      this.log.push(0x50, this.deviceID);
      return E_FAIL;
    }
    this.m_pRenderTargetZSurface = z.surface;
    return 0;
  }

  /**
   * The deleting destructor (32970F70, slot 2): the same release as `OnLostDevice`.  `CKTDXDeviceManager::CloseDevice` calls it when the last
   * reference goes.
   */
  Destroy(): void {
    this.onLostDevice();
  }

  /**
   * `SetDeviceTexture(stage)` (32971750, slot 5): what `CKTDXDeviceTexture::SetDeviceTexture` does for the render target's texture (a stage
   * below 16 remembers it in `ms_apd3dTextures` and does nothing when the stage holds it already; a texture that is not there is simply set as
   * none), and a failure of `SetTexture` is error 0x51 with the id.
   */
  setDeviceTexture(target: TextureTarget, stage: number): void {
    const texture = this.m_pRenderTargetTexture;
    let hr: number;
    if (stage < 0x10) {
      const cache = target.states.apd3dTextures;
      if (cache[stage] === texture) return;
      hr = target.device.SetTexture(stage, texture);
      if (hr < 0) target.device.SetTexture(stage, null);
      cache[stage]?.Release();
      cache[stage] = texture;
      texture?.AddRef();
    } else {
      hr = target.device.SetTexture(stage, texture);
    }
    if (hr < 0) this.log.push(0x51, this.deviceID);
  }

  /**
   * `BeginRender(bClear)` (32971050): the render target and the depth surface of the device become this texture's and, when asked, both are
   * cleared (`D3DCLEAR_TARGET | D3DCLEAR_ZBUFFER`: colour 0, depth 1.0, stencil 0).  A texture that has no resources (its device objects were
   * never made) hands the device null surfaces, which the device refuses (the exe reads `m_pRenderTargetSurface` the same way).
   */
  beginRender(device: UIRenderTargetDevice, clear: boolean): void {
    device.SetRenderTarget(0, this.m_pRenderTargetSurface);
    device.SetDepthStencilSurface(this.m_pRenderTargetZSurface);
    if (clear) device.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, 0, 1, 0);
  }

  /** `Clear(color)` (329710B0): the target and the depth surface of the device (this texture's after `BeginRender`) are cleared to `color`, depth 1.0 */
  clear(device: UIRenderTargetDevice, color: number): void {
    device.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, color >>> 0, 1, 0);
  }

  /** `EndRender()` (329713D0): the backups are the device's render target and depth surface again */
  endRender(device: UIRenderTargetDevice): void {
    device.SetRenderTarget(0, this.m_pBackupBuffer);
    device.SetDepthStencilSurface(this.m_pBackupZBuffer);
  }

  /**
   * `Draw(nX, nY, nWidth, nHeight, color)` (32971200): the texture as one quad at a place of the 1024 x 768 layout, the way `CKTDXDeviceTexture::Draw`
   * (329675F0) draws a texture without a rotation (`drawDeviceTexture`).
   */
  draw(render: UIRender, nX: number, nY: number, nWidth: number, nHeight: number, color: number): void {
    drawDeviceTexture(render, this, nX, nY, nWidth, nHeight, color);
  }
}

/** what `BeginRender`, `Clear` and `EndRender` ask of `g_pKTDXApp->m_pd3dDevice` */
export type UIRenderTargetDevice = Pick<UIRender["device"], "SetRenderTarget" | "SetDepthStencilSurface" | "Clear">;

/**
 * `BVL_VIDEO_INFO`: `CMovieData` takes the size (`m_Info`, and the video texture is made of it); a player fills the rest (the rate as a fraction,
 * the sound's, the length in milliseconds and in frames) as bdvid32.dll does.
 */
export interface VideoInfo {
  width: number;
  height: number;
  fps_rate?: number;
  fps_scale?: number;
  samplerate?: number;
  channels?: number;
  total_time?: bigint;
  total_frames?: bigint;
}

/** `BVL_STATUS` (`IBandiVideo2::GetStatus`) */
export const BVL_STATUS = { ERROR: -1, CLOSED: 0, OPENING: 1, READY: 2, PLAYING: 3, PAUSED: 4, PLAYEND: 5 } as const;
/** `BVL_SEEK_FLAG`: what `Seek`'s value counts */
export const BVL_SEEK = { TIME: 0, FRAME: 1 } as const;
/** `BVL_PIXEL_FORMAT`: the layout of a frame's pixels (little-endian, as the `D3DFMT` of the same name) */
export const BVLPF = { NULL: 0, X8R8G8B8: 1, R8G8B8: 2, R5G6B5: 3, R5G5B5: 4, A8R8G8B8: 5 } as const;

/** what `CBandiVideoLibrary` answers: the library is not created (no `m_bvl`) */
export const BVL_E_NOT_CREATED = -2054811613;
/** `CBandiVideoLibrary::Create`: the library is created already (0x85861021), `GetProcAddress` failed (0x85861022), neither `LoadLibraryW` could load the DLL (0x85861020) nor the system is new enough (0x85861024) */
export const BVL_E_ALREADY_CREATED = -2054811615;
export const BVL_E_NO_ENTRY = -2054811614;
export const BVL_E_NO_DLL = -2054811616;
export const BVL_E_OLD_SYSTEM = -2054811612;

/**
 * `BVL_FRAME`: what `GetFrame` fills.  The caller sets the buffer (`frame_buf`, the locked texture's bytes from its first pixel, `frame_buf_size` of them,
 * `pitch` bytes to the next row), the size to copy and the pixel format the texture has; the player copies the frame and writes the time and the
 * number of the frame it gave.
 */
export interface BvlFrame {
  frame_buf: Uint8Array;
  frame_buf_size: number;
  pitch: number;
  width: number;
  height: number;
  pixel_format: number;
  frame_time: bigint;
  frame_number: bigint;
}

/**
 * `CBandiVideoLibrary` (Bandisoft's video player: a wrapper class of the exe, 329840C0 .. 32984450, that loads `bdvid32.dll` and forwards to the
 * `IBandiVideo2` it makes; an `IBandiVideo2` itself) as far as `CMovieData` uses it.  Every method that returns an `HRESULT` returns a negative number
 * for a failure; a library that is not created (`m_bvl` null) answers `BVL_E_NOT_CREATED` to every call that has to reach the player, 0 to `IsNextFrame`,
 * and writes nothing.
 */
export interface BandiVideoLibrary {
  isCreated(): boolean;
  /** `Create(dllPath, ...)`: loads the DLL */
  create(dllPath: string): number;
  /** `Verify(name, key)` (the licence check) */
  verify(name: string, key: string): number;
  /** `Close()` */
  close(): void;
  /** `Open(path, flags)` */
  open(path: string, flags: number): number;
  /** `GetVideoInfo(&info)` of the file that is open */
  getVideoInfo(): VideoInfo;
  /** `Play()` */
  play(): number;
  /** `Stop()` */
  stop(): number;
  /** `Seek(value, flag)` (`BVL_SEEK`) */
  seek(value: bigint, flag: number): number;
  /** `GetStatus(&status)`: the status (`BVL_STATUS`) goes to `out.status` when the call succeeds, which the exe's local is not initialised for */
  getStatus(out: { status: number }): number;
  /** `IsNextFrame()`: a frame is due (not 0) */
  isNextFrame(): number;
  /** `GetFrame(&frame, canSkip)`: the frame that is due is copied into `frame.frame_buf` (a frame behind is skipped when `canSkip` is not 0) */
  getFrame(frame: BvlFrame, canSkip: number): number;
  /**
   * `Destroy()` (329842B0) and `~CBandiVideoLibrary` (329840E0), the same release: the video is stopped and released and the DLL freed, each only
   * when there is one.  `CMovieData`'s destructor calls `Destroy` for a library that was created and the destructor at its end.
   */
  destroy(): void;
}

/** `CBandiVideoTexture_DX9` (0x28 bytes, vtable 334B10AC): the Direct3D texture the video's frames are copied into, and the quad it draws them with */
export interface BandiVideoTexture {
  /** slot 1: `Open(width, height)`, the size of the video */
  open(width: number, height: number): number;
  /** slot 2 */
  close(): void;
  /** slot 3: `Lock(&pitch)`, the texture's first pixel and the bytes to the next row; null when there is no texture */
  lock(): { bits: Uint8Array; pitch: number } | null;
  /** slot 4 */
  unlock(): void;
  /** slot 5: `Draw(x, y, width, height)`; the failure of `SetTexture` or 0 */
  draw(x: number, y: number, width: number, height: number): number;
  /** slot 7: `GetFormat()`, the `BVL_PIXEL_FORMAT` the texture takes */
  getFormat(): number;
  /** the deleting destructor (the vtable's slot 0), which `CMovieData`'s destructor calls after `Close` */
  Destroy(): void;
}

/** a machine without `bdvid32.dll`: nothing can be created, nothing can be opened (and no movie file is there to play) */
export class NoVideoLibrary implements BandiVideoLibrary {
  isCreated(): boolean {
    return false;
  }

  create(): number {
    return BVL_E_NO_DLL;
  }

  verify(): number {
    return BVL_E_NOT_CREATED;
  }

  close(): void {}

  open(): number {
    return BVL_E_NOT_CREATED;
  }

  getVideoInfo(): VideoInfo {
    return { width: 0, height: 0 };
  }

  play(): number {
    return BVL_E_NOT_CREATED;
  }

  stop(): number {
    return BVL_E_NOT_CREATED;
  }

  seek(): number {
    return BVL_E_NOT_CREATED;
  }

  getStatus(): number {
    return BVL_E_NOT_CREATED;
  }

  isNextFrame(): number {
    return 0;
  }

  getFrame(): number {
    return BVL_E_NOT_CREATED;
  }

  destroy(): void {}
}

/** the texture of a video that cannot play (it is only reached with a library that opens files) */
export class NoVideoTexture implements BandiVideoTexture {
  open(): number {
    return E_FAIL;
  }

  close(): void {}

  lock(): null {
    return null;
  }

  unlock(): void {}

  draw(): number {
    return 0;
  }

  getFormat(): number {
    return BVLPF.NULL;
  }

  Destroy(): void {}
}

/** the texture and sound part of `CKTDXDeviceManager` */
export class DeviceManager {
  /** `m_MassFileManager`: the one the Lua global `KGCMassFileManager` is */
  readonly massFiles: KGCMassFileManager;
  /** `m_DeviceMap` (textures) */
  readonly devices = new Map<string, DeviceTexture>();
  /** `m_DeviceMap` (sounds; the exe has one map for every device type, the ids never collide) */
  readonly sounds = new Map<string, DeviceSound>();
  /** `m_DeviceMap` (render target textures) */
  readonly renderTargets = new Map<string, DeviceRenderTargetTexture>();
  /** `GetCurrentDirectoryW`: the folder the game runs in (the movies are in its `movie` folder) */
  currentDirectory = "";
  /** the video player a `CMovieData` creates (`CBandiVideoLibrary::CBandiVideoLibrary`); the default is a machine without one */
  createVideoLibrary: () => BandiVideoLibrary = () => new NoVideoLibrary();
  /** the texture a movie that opened gets (`new CBandiVideoTexture_DX9`, which works with the render's device, state manager and vertex buffers) */
  createVideoTexture: (render: UIRender | null) => BandiVideoTexture = () => new NoVideoTexture();
  /**
   * `g_pKTDXApp->m_pDSManager->m_bInit`: whether the sound system (FMOD) is up.  `OpenSound` creates a sound device only then; without
   * it `OpenSound` answers null for every sound that is not open yet, as the exe does when FMOD failed to initialise.
   */
  soundSystemInitialised = false;
  /**
   * `g_pKTDXApp->m_pd3dDevice`: with a device, a texture that loads also gets its Direct3D texture (`m_pTexture`); without one (the census,
   * most tests) it keeps only its file's size and UV table.  The textures already open are not touched when it is set.
   */
  d3dDevice: Direct3DDevice9 | null = null;
  /** `m_TexDetailLevel` (`SetTextureDetailLevel`): what the textures opened from now on are reduced to (`DL.HIGH`: not at all) */
  textureDetailLevel: number = DL.HIGH;
  /** `GetCaretBlinkTime()` in milliseconds (the system setting; Windows' default is 530) */
  caretBlinkTime = 530;
  /** `DXUTGetGlobalTimer()->GetAbsoluteTime()` in seconds (a clock that stands still unless the application wires a real one) */
  absoluteTime: () => number = () => 0;

  constructor(massFiles: KGCMassFileManager = new KGCMassFileManager()) {
    this.massFiles = massFiles;
  }

  /** `CKTDXDeviceManager::OpenTexture(deviceID, texFormat, bAlwaysHigh, bLog)`; the texture format and detail level do not matter headless */
  openTexture(deviceID: string): DeviceTexture | undefined {
    if (deviceID.length === 0) return undefined;
    const id = towupperAscii(deviceID);
    const known = this.devices.get(id);
    if (known) {
      known.refCount++; // OpenDevice: RefDevice, then LoadDevice
      return known.failed ? undefined : known;
    }
    if (!this.massFiles.isValidFile(id)) return undefined;
    const tex = new DeviceTexture(id, this.massFiles.log);
    tex.refCount = 1; // CreateAndOpenDevice
    this.devices.set(id, tex);
    if (!this.loadTexture(tex)) {
      tex.failed = true;
      return undefined;
    }
    return tex;
  }

  /**
   * `CKTDXDeviceTexture::_Load` (329682A0): the file and its TET (`LoadTwoDataFiles`), the image info, the Direct3D texture, the TET table.
   * Every failure ends in error 0x5A, the name of the HRESULT, a space and the id (a missing file, error 0x58 before it, is `E_FAIL`; an
   * image D3DX cannot read, error 0x59 before it, is whatever D3DX answered).  The TET is read after the texture is made; one that does
   * not open is error 0x5F with the TET's name and the texture still loads, its UV table empty.
   */
  private loadTexture(tex: DeviceTexture): boolean {
    const id = tex.deviceID;
    const tetName = id.length > 3 ? id.slice(0, -3) + "TET" : "";
    const log = this.massFiles.log;
    const { first, second } = this.massFiles.loadTwoDataFiles(id, tetName);
    if (!first) {
      log.push(0x58, id);
      return this.loadFailed(id, E_FAIL);
    }
    const { hr, info } = D3DXGetImageInfoFromFileInMemory(first);
    if (hr !== 0 || !info) {
      log.push(0x59, id);
      return this.loadFailed(id, hr);
    }
    if (this.d3dDevice) {
      const made = this.createD3DTexture(first, info);
      if (made.hr !== 0) return this.loadFailed(id, made.hr);
      tex.m_pTexture = made.tex;
      tex.uWidth = made.width;
      tex.uHeight = made.height;
    }
    if (second) {
      const tet = parseTet(second);
      if (tet) tex.tet = tet;
      else log.push(0x5f, tetName);
    }
    tex.info = info;
    tex.data = first;
    return true;
  }

  /** the end of `_Load` for every failure (LABEL_30): error 0x5A with the HRESULT's name (`알수없는에러`, "unknown error", for the others) */
  private loadFailed(id: string, hr: number): boolean {
    this.massFiles.log.push(0x5a, `${HRESULT_NAMES.get(hr) ?? "알수없는에러"} ${id}`);
    return false;
  }

  /**
   * The Direct3D half of `_Load`: the size by the detail level (`bAlwaysHigh` is not modelled: no id is exempt), the requirements check,
   * the texture from the file's bytes.  `m_LoadTexFormat` is `D3DFMT_UNKNOWN` (the UI never asks for a format).
   */
  private createD3DTexture(data: Uint8Array, info: D3DXImageInfo): { hr: number; tex: Direct3DTexture9 | null; width: number; height: number } {
    const device = this.d3dDevice!;
    const request = textureLoadRequest(info, this.textureDetailLevel);
    const check = D3DXCheckTextureRequirements(device, request.width, request.height, 1, 0, request.format, D3DPOOL.MANAGED);
    if (check.hr !== 0) return { hr: check.hr, tex: null, width: 0, height: 0 };
    const { width, height } = check;
    const filter = width === info.Width && height === info.Height ? D3DX_FILTER.NONE : D3DX_FILTER.LINEAR;
    const created = D3DXCreateTextureFromFileInMemoryEx(device, data, width, height, 1, 0, check.format, D3DPOOL.MANAGED, filter, D3DX_FILTER.NONE, 0);
    if (created.hr !== 0) {
      created.tex?.Release();
      return { hr: created.hr, tex: null, width: 0, height: 0 };
    }
    return { hr: 0, tex: created.tex, width, height };
  }

  /**
   * `CKTDXDeviceManager::OpenSound(deviceID, bufCount, bUse3D, fMax3DDistance)` (328EE5E0): an empty id gives null; the id is upper-cased;
   * an open sound is referenced once more; otherwise a valid file (`IsValidFile`) and a running sound system are needed to create it.
   * A positive `fMax3DDistance` is handed to the sound (also an already open one).
   */
  openSound(deviceID: string, bUse3D = true, fMax3DDistance = -1): DeviceSound | undefined {
    if (deviceID.length === 0) return undefined;
    const id = towupperAscii(deviceID);
    let snd = this.sounds.get(id);
    if (snd) {
      snd.refCount++;
    } else {
      if (!this.massFiles.isValidFile(id)) return undefined;
      if (!this.soundSystemInitialised) return undefined;
      snd = new DeviceSound(id, bUse3D);
      snd.refCount = 1;
      this.sounds.set(id, snd);
    }
    if (fMax3DDistance > 0) snd.fMaxDistance = Math.fround(fMax3DDistance);
    return snd;
  }

  /**
   * `CKTDXDeviceManager::OpenRenderTargetTexture(deviceID, width, height, fmt)` (328EE4C0): an empty id gives null; the id is upper-cased;
   * a device with that id is referenced once more (and keeps the size it was made with), otherwise one is made (reference count 1).
   */
  openRenderTargetTexture(deviceID: string, width: number, height: number, format: number): DeviceRenderTargetTexture | undefined {
    if (deviceID.length === 0) return undefined;
    const id = towupperAscii(deviceID);
    let target = this.renderTargets.get(id);
    if (target) {
      target.refCount++;
      return target;
    }
    target = new DeviceRenderTargetTexture(id, width, height, format, this.massFiles.log);
    target.refCount = 1;
    if (this.d3dDevice) target.onResetDevice(this.d3dDevice); // the constructor: `DXUTGetDeviceObjectsReset()`
    this.renderTargets.set(id, target);
    return target;
  }

  /**
   * Not in the exe: told the id of a `CloseDevice` that finds no device (a close of a reference nobody holds: harmless in the exe, a
   * mistake of the caller), for the census that checks the destructors.
   */
  onStrayClose: ((id: string) => void) | undefined;

  /** `CKTDXDeviceManager::CloseDevice(deviceID)` (328ED610) */
  closeDevice(deviceID: string): void {
    if (deviceID.length === 0) return;
    const id = towupperAscii(deviceID);
    const tex = this.devices.get(id);
    if (tex) {
      if (--tex.refCount <= 0) this.devices.delete(id);
      return;
    }
    const target = this.renderTargets.get(id);
    if (target) {
      if (--target.refCount <= 0) {
        this.renderTargets.delete(id);
        target.Destroy();
      }
      return;
    }
    const snd = this.sounds.get(id);
    if (snd) {
      if (--snd.refCount <= 0) this.sounds.delete(id);
      return;
    }
    this.onStrayClose?.(id);
  }
}
