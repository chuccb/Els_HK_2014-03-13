/**
 * `IDirect3D9`, the object `Direct3DCreate9` makes (the exe's `g_pD3D`, a DXUT global): what the game asks of the adapter before and besides the
 * device.  Only what the exe's code reaches is here: the display mode of the adapter and `CheckDeviceFormat` (`CBandiVideoTexture_DX9`'s
 * constructor picks the texture format of a video with them).  The adapter is a typical Windows desktop one: a HAL device on adapter 0 whose
 * desktop is `X8R8G8B8`.
 */
import { D3DDEVTYPE, D3DFMT, D3DRTYPE, D3DUSAGE } from "./enums.ts";
import { formatInfo } from "./formats.ts";
import { D3DERR_INVALIDCALL, D3DERR_NOTAVAILABLE, D3D_OK } from "./hresult.ts";

/** `D3DDISPLAYMODE` */
export interface DisplayMode {
  Width: number;
  Height: number;
  RefreshRate: number;
  Format: number;
}

export class Direct3D9 {
  /** the desktop's mode, which `GetAdapterDisplayMode` answers (a platform sets what its window's screen is) */
  displayMode: DisplayMode = { Width: 1024, Height: 768, RefreshRate: 60, Format: D3DFMT.X8R8G8B8 };

  GetAdapterCount(): number {
    return 1;
  }

  /** `GetAdapterDisplayMode(adapter, &mode)`: the mode of adapter 0; another adapter is `D3DERR_INVALIDCALL` */
  GetAdapterDisplayMode(adapter: number): { hr: number; mode: DisplayMode | null } {
    if (adapter !== 0) return { hr: D3DERR_INVALIDCALL, mode: null };
    return { hr: D3D_OK, mode: { ...this.displayMode } };
  }

  /**
   * `CheckDeviceFormat(adapter, deviceType, adapterFormat, usage, resourceType, checkFormat)`: whether a surface or texture of the format can be
   * made with the usage on the adapter.  The answer is the one of a current graphics card: every colour format of `formats.ts` but the 24-bit
   * `R8G8B8` (no card has it any more) is there for textures, a render target cannot be compressed, and a depth format is for `DEPTHSTENCIL`
   * usage only (and nothing else is).  `D3DERR_NOTAVAILABLE` says no, also for a device that is not a HAL, an adapter format that is no display
   * format and a resource that is neither a surface nor a texture; an adapter that is not there is `D3DERR_INVALIDCALL`.
   */
  CheckDeviceFormat(adapter: number, deviceType: number, adapterFormat: number, usage: number, resourceType: number, checkFormat: number): number {
    if (adapter !== 0) return D3DERR_INVALIDCALL;
    if (deviceType !== D3DDEVTYPE.HAL) return D3DERR_NOTAVAILABLE;
    if (adapterFormat !== D3DFMT.X8R8G8B8 && adapterFormat !== D3DFMT.R5G6B5 && adapterFormat !== D3DFMT.X1R5G5B5 && adapterFormat !== D3DFMT.A8R8G8B8) {
      return D3DERR_NOTAVAILABLE;
    }
    if (resourceType !== D3DRTYPE.TEXTURE && resourceType !== D3DRTYPE.SURFACE) return D3DERR_NOTAVAILABLE;
    const info = formatInfo(checkFormat);
    if (!info || checkFormat === D3DFMT.R8G8B8) return D3DERR_NOTAVAILABLE;
    if (info.depth) return usage & D3DUSAGE.DEPTHSTENCIL ? D3D_OK : D3DERR_NOTAVAILABLE;
    if (usage & D3DUSAGE.DEPTHSTENCIL) return D3DERR_NOTAVAILABLE;
    if (usage & D3DUSAGE.RENDERTARGET && info.compressed) return D3DERR_NOTAVAILABLE;
    return D3D_OK;
  }
}
