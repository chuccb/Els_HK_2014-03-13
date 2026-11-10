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
 * While the game runs: `OnFrameMove` (32924DE0) asks the player for its status (a movie that has played to its end seeks to the start and plays
 * again when it loops, else stops) and copies the frame that is due into the locked video texture; `OnFrameRender` (32925150) draws the video texture
 * into the render target texture and the render target texture at the movie's place.  The static the movie belongs to calls both
 * (`CKTDGUIStatic::OnFrameMove` 3292A120 for every movie, `OnFrameRender` 3292A2B0 for every movie that is shown, after it has set `m_vPos`).
 */
import { Vec2 } from "@els/host";
import type { CKTDGUIControl__CMovieData_Methods } from "@els/host";
import type { UIContext } from "./control.ts";
import { BVL_SEEK, BVL_STATUS, D3DFMT_A8R8G8B8 } from "./device.ts";
import type { BandiVideoLibrary, BandiVideoTexture, BvlFrame, DeviceRenderTargetTexture, VideoInfo } from "./device.ts";
import { ftoi } from "./rect.ts";

/**
 * the low 32 bits of the 64-bit integer `_ftol2_sse` makes of a float: the number cut toward zero, modulo 2^32.  A float that does not fit (2^63 and more,
 * NaN, the infinities) makes the integer indefinite, 0x8000000000000000, whose low 32 bits are 0, and `| 0` makes 0 of those as well (a float of 2^63
 * or more is a multiple of 2^32; it is only ever a float: `m_vSize` holds single precision numbers).
 */
function ftol(x: number): number {
  return Math.trunc(x) | 0;
}

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

  /**
   * `OnFrameMove()` (32924DE0): `GetStatus`: a movie at `BVL_STATUS_PLAYEND` seeks to time 0 and plays again when `m_bLoop` is set, else stops.  Then,
   * when the player says a frame is due (`IsNextFrame`) and there is a video texture whose `Lock` gives a place, the frame is copied there
   * (`GetFrame(&frame, 1)`: the buffer, its size `pitch * m_Info.height`, the pitch, the video's size and the texture's pixel format) and the
   * texture is unlocked.  A player that is not created fails `GetStatus` without writing the status, which the exe's local is not initialised
   * for: the value is 0 here, and it cannot matter, since every call after it fails or answers 0 as well.
   */
  onFrameMove(): void {
    const bvl = this.m_Bvl;
    const state = { status: BVL_STATUS.CLOSED as number };
    bvl.getStatus(state);
    if (state.status === BVL_STATUS.PLAYEND) {
      bvl.seek(0n, BVL_SEEK.TIME);
      if (this.m_bLoop) bvl.play();
      else bvl.stop();
    }
    if (bvl.isNextFrame() === 0) return;
    const texture = this.m_pBvt;
    if (!texture) return;
    const locked = texture.lock();
    if (!locked) return;
    const frame: BvlFrame = {
      frame_buf: locked.bits,
      frame_buf_size: Math.imul(locked.pitch, this.m_Info.height),
      pitch: locked.pitch,
      width: this.m_Info.width,
      height: this.m_Info.height,
      pixel_format: texture.getFormat(),
      frame_time: 0n,
      frame_number: 0n,
    };
    bvl.getFrame(frame, 1);
    texture.unlock();
  }

  /**
   * `OnFrameRender()` (32925150): the render target texture becomes the device's target and is cleared twice (`BeginRender(true)`, `Clear(0)`), the
   * video texture draws its frame over `(0, 0)` to `(int)m_vSize` (when there is one), the target is put back (`EndRender`), and the render target
   * texture is drawn in white at `m_vPos` divided by the resolution scale (cut to whole numbers: the draw multiplies by the scale again) over
   * `(__int64)m_vSize`.  No device draws nothing; a movie that was never given a size has no render target texture, which the exe reads null for.
   */
  onFrameRender(): void {
    const render = this.ctx.render;
    if (!render) return;
    const target = this.m_pRenderTargetTexture;
    if (!target) throw new Error("CKTDGUIControl::CMovieData::OnFrameRender (32925150): no render target texture (SetRect did not make one): the exe dereferences null");
    const f = Math.fround;
    target.beginRender(render.device, true);
    target.clear(render.device, 0);
    this.m_pBvt?.draw(0, 0, ftoi(this.m_vSize.x), ftoi(this.m_vSize.y));
    target.endRender(render.device);
    const scale = render.resolutionScale;
    target.draw(render, ftoi(f(this.m_vPos.x / scale.x)), ftoi(f(this.m_vPos.y / scale.y)), ftol(this.m_vSize.x), ftol(this.m_vSize.y), 0xffffffff);
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
    else this.m_pBvt = devices.createVideoTexture(this.ctx.render);
    this.m_pBvt.open(this.m_Info.width, this.m_Info.height);
    bvl.play();
  }
}
