/**
 * The texture devices the UI opens: `CKTDXDeviceManager::OpenTexture` (328EE8E0), the `CKTDXDeviceTexture` device behind it and the
 * `CKTDXDeviceManager` device map, headless.  What a UI control needs from a texture is its file's size (`m_Info.Width` / `Height`, the
 * values the UVs are normalised by) and its UV table (`m_tet`, the `.tet` file next to the image); the GPU texture itself is a renderer's
 * business and is created from `data` when something is drawn.
 *
 * `OpenTexture(id, fmt, bAlwaysHigh, bLog)`:
 *   - an empty id gives null; the id is upper-cased (`_towupper`);
 *   - `OpenDevice`: a device with that id in `m_DeviceMap` is `RefDevice`d (reference count + 1) and `LoadDevice`d: a device whose load
 *     failed stays in the map in state FAILED and keeps answering null;
 *   - otherwise, if `KGCMassFileManager::IsValidFile(id)` (an exact lookup, mapping included), a `CKTDXDeviceTexture` is created
 *     (`bAlwaysHigh` becomes true when the id contains one of `m_HighTexName`: texture detail only, not modelled), put into the map
 *     (`CreateAndOpenDevice`, reference count 1) and loaded.
 * `CKTDXDeviceTexture::_Load` (329682A0): `LoadTwoDataFiles(id, id minus its last 3 characters + L"TET")`; no image bytes is error 0x58
 * (and the load fails); `D3DXGetImageInfoFromFileInMemory` failing is error 0x59 (fails); a `.tet` that is there but that
 * `CKTDXDeviceTET_Preprocessing::OpenFile` rejects is error 0x5F (the texture still loads, its UV table stays empty); `m_Info` is the
 * info of the FILE (not of a texture reduced by the detail level).
 * `CloseDevice(id)` (328ED610): upper-case, find, `UnrefDevice`; the last reference removes the device from the map.
 */
import { parseTet } from "@els/assets";
import type { TetFile } from "@els/assets";
import { D3DXGetImageInfoFromFileInMemory } from "@els/d3d9";
import type { D3DXImageInfo } from "@els/d3d9";
import { KGCMassFileManager, towupperAscii } from "@els/host";

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

  constructor(deviceID: string) {
    this.deviceID = deviceID;
  }
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

  constructor(deviceID: string, bUse3D: boolean) {
    this.deviceID = deviceID;
    this.b3DSound = bUse3D;
  }
}

/** the texture and sound part of `CKTDXDeviceManager` */
export class DeviceManager {
  /** `m_MassFileManager`: the one the Lua global `KGCMassFileManager` is */
  readonly massFiles: KGCMassFileManager;
  /** `m_DeviceMap` (textures) */
  readonly devices = new Map<string, DeviceTexture>();
  /** `m_DeviceMap` (sounds; the exe has one map for every device type, the ids never collide) */
  readonly sounds = new Map<string, DeviceSound>();
  /**
   * `g_pKTDXApp->m_pDSManager->m_bInit`: whether the sound system (FMOD) is up.  `OpenSound` creates a sound device only then; without
   * it `OpenSound` answers null for every sound that is not open yet, as the exe does when FMOD failed to initialise.
   */
  soundSystemInitialised = false;

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
    const tex = new DeviceTexture(id);
    tex.refCount = 1; // CreateAndOpenDevice
    this.devices.set(id, tex);
    if (!this.loadTexture(tex)) {
      tex.failed = true;
      return undefined;
    }
    return tex;
  }

  /** `CKTDXDeviceTexture::_Load` */
  private loadTexture(tex: DeviceTexture): boolean {
    const id = tex.deviceID;
    const tetName = id.length > 3 ? id.slice(0, -3) + "TET" : "";
    const { first, second } = this.massFiles.loadTwoDataFiles(id, tetName);
    if (!first) {
      this.massFiles.log.push(0x58, id);
      return false;
    }
    const { hr, info } = D3DXGetImageInfoFromFileInMemory(first);
    if (hr !== 0 || !info) {
      this.massFiles.log.push(0x59, id);
      return false;
    }
    if (second) {
      const tet = parseTet(second);
      if (tet) tex.tet = tet;
      else this.massFiles.log.push(0x5f, id);
    }
    tex.info = info;
    tex.data = first;
    return true;
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

  /** `CKTDXDeviceManager::CloseDevice(deviceID)` (328ED610) */
  closeDevice(deviceID: string): void {
    if (deviceID.length === 0) return;
    const id = towupperAscii(deviceID);
    const tex = this.devices.get(id);
    if (tex) {
      if (--tex.refCount <= 0) this.devices.delete(id);
      return;
    }
    const snd = this.sounds.get(id);
    if (snd && --snd.refCount <= 0) this.sounds.delete(id);
  }
}
