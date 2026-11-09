/**
 * `CKTDGUIControl::CMovieData` (the Lua class `CMovieData`, 0x78 bytes; `CKTDGUIDialog::CreateMovie` 328C15E0): a video a static plays
 * (`AddMovieData`).  Constructor 329231E0: its own video player (`CBandiVideoLibrary`), no video texture and no render target, an empty
 * file name, everything 0, hidden, not looping.
 *
 * The Lua methods: SetLoop 328CD8B0 and SetShow 328CDAF0 (folded by the linker with `CXMeshInstance::SetPerFrameSimulation`; the byte it
 * writes is `m_bShow`, 0x70; SetLoop writes 0x71), SetRect_LUA 32926540 (the position and size, and the render target texture "MoveData"
 * the frames are drawn into: `OpenRenderTargetTexture(L"MoveData", (int)width, (int)height, D3DFMT_A8R8G8B8)`; an earlier one is not closed)
 * and SetMovieFileName_LUA 329258F0 (the player is created and verified, the file is `<current directory>\movie\<name>`; if the
 * player opens it, the video's size sizes the video texture, which is made on the first open, and the video plays).
 *
 * The destructor (32923740, `Destroy()`): the render target texture is closed, the video player is destroyed when it was created, the video
 * texture is closed and deleted, and the player's own destructor (`~CBandiVideoLibrary` 329840E0, the same release as `Destroy` 329842B0)
 * runs at the end whether the player was created or not.
 *
 * Not ported: what the movie does while the game runs (`OnFrameMove` 32924DE0 copies the player's frame into the video texture and
 * loops, `OnFrameRender` 32925150 draws it through the render target).
 */
import { Vec2 } from "@els/host";
import type { CKTDGUIControl__CMovieData_Methods } from "@els/host";
import type { UIContext } from "./control.ts";
import { D3DFMT_A8R8G8B8 } from "./device.ts";
import type { BandiVideoLibrary, BandiVideoTexture, DeviceRenderTargetTexture, VideoInfo } from "./device.ts";

export class CMovieData implements Partial<CKTDGUIControl__CMovieData_Methods> {
  readonly m_Bvl: BandiVideoLibrary;
  m_Info: VideoInfo = { width: 0, height: 0 };
  m_pBvt: BandiVideoTexture | null = null;
  m_pRenderTargetTexture: DeviceRenderTargetTexture | null = null;
  m_wstrMovieFileName = "";
  readonly m_vSize = new Vec2(0, 0);
  readonly m_vOriginPos = new Vec2(0, 0);
  readonly m_vPos = new Vec2(0, 0);
  m_bShow = false;
  m_bLoop = false;

  constructor(private readonly ctx: UIContext) {
    this.m_Bvl = ctx.devices.createVideoLibrary();
  }

  SetLoop(loop: boolean): void {
    this.m_bLoop = loop;
  }

  SetShow(show: boolean): void {
    this.m_bShow = show;
  }

  /** `SetRect_LUA(x, y, width, height)` (32926540) */
  SetRect(x: number, y: number, width: number, height: number): void {
    this.m_vOriginPos.set(x, y);
    this.m_vSize.set(width, height);
    this.m_pRenderTargetTexture = this.ctx.devices.openRenderTargetTexture("MoveData", Math.trunc(width), Math.trunc(height), D3DFMT_A8R8G8B8) ?? null;
  }

  /**
   * `~CMovieData` (32923740): the render target texture (`SetRect` opened it) is closed by its id and forgotten; the video player is destroyed
   * when it was created (`IsCreated`); the video texture is closed and deleted (its deleting destructor) and forgotten; the player's
   * destructor (`~CBandiVideoLibrary` 329840E0: stop and release the video, free the DLL, each only when there is one) runs last, for a player
   * that was created (a second release, which finds nothing) and for one that was not.
   */
  Destroy(): void {
    const target = this.m_pRenderTargetTexture;
    if (target) {
      this.ctx.devices.closeDevice(target.deviceID);
      this.m_pRenderTargetTexture = null;
    }
    if (this.m_Bvl.isCreated()) this.m_Bvl.destroy();
    const texture = this.m_pBvt;
    if (texture) {
      texture.close();
      texture.Destroy();
      this.m_pBvt = null;
    }
    this.m_Bvl.destroy();
  }

  /** `SetMovieFileName_LUA(name)` (329258F0) */
  SetMovieFileName(name: string): void {
    const devices = this.ctx.devices;
    const bvl = this.m_Bvl;
    if (!bvl.isCreated()) bvl.create("bdvid32.dll");
    bvl.verify("KOG_ELSWORD_20131203", "1b9b533c");
    this.m_wstrMovieFileName = `${devices.currentDirectory}\\movie\\${name}`;
    bvl.close();
    if (bvl.open(this.m_wstrMovieFileName, 0) < 0) return;
    this.m_Info = bvl.getVideoInfo();
    if (this.m_pBvt) this.m_pBvt.close();
    else this.m_pBvt = devices.createVideoTexture();
    this.m_pBvt.open(this.m_Info.width, this.m_Info.height);
    bvl.play();
  }
}
