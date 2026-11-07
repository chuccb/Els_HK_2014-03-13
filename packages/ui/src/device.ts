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
import { D3DFMT, D3DPOOL, D3DPT, D3DXCheckTextureRequirements, D3DXCreateTextureFromFileInMemoryEx, D3DXGetImageInfoFromFileInMemory, D3DX_FILTER } from "@els/d3d9";
import type { D3DXImageInfo, Direct3DDevice9, Direct3DTexture9 } from "@els/d3d9";
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
   * `Draw(nX, nY, nWidth, nHeight, color, fRotateDegree)` (329675F0): the whole texture as one quad at a place of the 1024 x 768 layout, every
   * corner of the one `color` (ARGB).  `akRSICKTDXDeviceTexture` is pushed for the draw and popped after it.  The corners are
   * `scale * nX - 0.5` and `scale * nY - 0.5` on the left and at the top, but `scale * nWidth + scale * nX` and `scale * nHeight + scale * nY`
   * on the right and at the bottom (no half pixel is taken off there: the quad is half a pixel wider and higher than the layout says),
   * all in single precision and with no cutting to whole pixels.  The vertices are left-top (u v 0 0), left-bottom (0 1), right-top (1 0) and
   * right-bottom (1 1), z = rhw = 1; the texture goes to stage 0 (`SetDeviceTexture`, which logs error 0x5E for a texture that is not
   * there and then draws with what the stage holds) and the strip is handed to the vertex buffer manager, type 3, once.
   *
   * Not ported: the rotated quad (`fRotateDegree != 0`: the corners turned about the middle with the CRT's `cos` and `sin`); no
   * control passes a rotation.  It throws.
   */
  draw(render: UIRender, nX: number, nY: number, nWidth: number, nHeight: number, color: number, rotateDegree: number): void {
    if (rotateDegree !== 0) throw new Error("CKTDXDeviceTexture::Draw with a rotation is not ported");
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
    this.setDeviceTexture(render, 0);
    render.dvb.drawPrimitive(DVB_TYPE.XYZRHW_DIFFUSE_TEX1, D3DPT.TRIANGLESTRIP, 2, v.bytes, 1);
    states.popTo(top);
  }
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
 * `CKTDXDeviceRenderTargetTexture` (0x6C bytes): a texture that is drawn into.  Its constructor (32970D60) stores the size and the format
 * and, when the Direct3D device objects exist (`DXUTGetDeviceObjectsReset`), `OnResetDevice` (32971480) creates the texture, its surface and a
 * depth surface of the same size (a failing step is error log 0x4C..0x50 and `E_FAIL`).  The Direct3D resources belong to the renderer.
 */
export class DeviceRenderTargetTexture {
  /** `m_DeviceID` (upper case) */
  readonly deviceID: string;
  refCount = 0;
  readonly width: number;
  readonly height: number;
  /** `m_D3DFormat` */
  readonly format: number;

  constructor(deviceID: string, width: number, height: number, format: number) {
    this.deviceID = deviceID;
    this.width = width | 0;
    this.height = height | 0;
    this.format = format | 0;
  }
}

/** `BVL_VIDEO_INFO`: what `CMovieData` takes of it */
export interface VideoInfo {
  width: number;
  height: number;
}

/**
 * `CBandiVideoLibrary` (Bandisoft's video player, a wrapper class that loads `bdvid32.dll`; an `IBandiVideo2`) as far as `CMovieData::SetMovieFileName`
 * uses it.  Every method that returns an `HRESULT` returns a negative number for a failure.
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
}

/** `CBandiVideoTexture_DX9` (0x28 bytes): the Direct3D texture the video's frames are copied into */
export interface BandiVideoTexture {
  open(width: number, height: number): number;
  close(): void;
}

/** a machine without `bdvid32.dll`: nothing can be created, nothing can be opened (and no movie file is there to play) */
export class NoVideoLibrary implements BandiVideoLibrary {
  isCreated(): boolean {
    return false;
  }

  create(): number {
    return E_FAIL;
  }

  verify(): number {
    return E_FAIL;
  }

  close(): void {}

  open(): number {
    return E_FAIL;
  }

  getVideoInfo(): VideoInfo {
    return { width: 0, height: 0 };
  }

  play(): number {
    return E_FAIL;
  }
}

/** the texture of a video that cannot play (it is only reached with a library that opens files) */
export class NoVideoTexture implements BandiVideoTexture {
  open(): number {
    return E_FAIL;
  }

  close(): void {}
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
  /** the texture a movie that opened gets (`new CBandiVideoTexture_DX9`) */
  createVideoTexture: () => BandiVideoTexture = () => new NoVideoTexture();
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
    target = new DeviceRenderTargetTexture(id, width, height, format);
    target.refCount = 1;
    this.renderTargets.set(id, target);
    return target;
  }

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
      if (--target.refCount <= 0) this.renderTargets.delete(id);
      return;
    }
    const snd = this.sounds.get(id);
    if (snd && --snd.refCount <= 0) this.sounds.delete(id);
  }
}
