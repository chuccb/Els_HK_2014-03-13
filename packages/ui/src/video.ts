/**
 * The video a `CMovieData` plays: `CBandiVideoTexture_DX9` (the exe's own code, 32984470 .. 32984D60: the texture the frames are copied into and the
 * quad that draws it) and, as the platform's part, a player that stands in for Bandisoft's `bdvid32.dll` (the exe loads the DLL at run time and talks to the
 * `IBandiVideo2` it makes; nothing of the DLL is in x2.exe).
 *
 * `CBandiVideoTexture_DX9` (0x28 bytes, vtable 334B10AC; `m_texture` 4, `m_vertex_buffer` 8 (never made), `m_fmt_d3d` 0xC, `m_fmt_bvl` 0x10, the video's and
 * the texture's sizes 0x14 .. 0x20, `m_pixel_size` 0x24):
 *  - the constructor (32984470) asks `g_pD3D` for the display mode of adapter 0 and takes the first of four formats (the table at 334B10D0:
 *    X8R8G8B8, R8G8B8, R5G6B5, X1R5G5B5, each with its `BVL_PIXEL_FORMAT` and its bytes per pixel) that `CheckDeviceFormat` accepts as a texture of
 *    that desktop; none, or no display mode, leaves D3DFMT_UNKNOWN, BVLPF_NULL and 0;
 *  - `Open(width, height)` (32984BC0) makes the texture: a size rounded up to a power of two (from 16) only when the device wants one (`CalcTexSize`
 *    32984660: `TextureCaps` bit 2, asked when bit 0x100, conditional non-power-of-two, is not there), a dynamic texture of the managed pool first and,
 *    when the runtime refuses, a plain one; both refused is `Beep(1000, 1000)` and the error.  The texture is cleared to zeros row by row;
 *  - `Close` (329846E0) forgets the sizes and releases the texture, `Lock` (32984B80) locks level 0 and gives the pixels and the pitch (the result of
 *    `LockRect` is not looked at), `Unlock` (32984D60), `GetFormat` (3289C7D0: `m_fmt_bvl`) and the deleting destructor (329845C0: `Close`);
 *  - `Draw(x, y, width, height)` (32984720): the texture goes to stage 0 through the state manager's cache (a failing `SetTexture` is the result);
 *    clamped addressing and linear magnification and minification are pushed on stage 0; the quad (no half pixel: x, y, x + width, y + height, the
 *    corners of the video's part of the texture as `(float)video / (float)texture`, z 0, rhw 1, white) is handed to the vertex buffer manager, type 3,
 *    once; the states are popped.
 *
 * The player (`Mpeg1VideoLibrary`) is the platform's: it opens an AVI file with an MPEG-1 video stream (the `data/movie` files, `@els/assets`' `Mpeg1Movie`),
 * keeps the clock a player keeps (the frame that is due at the time since `Play`, at the movie's rate) and converts the frame it gives to the pixel format
 * the texture asked for.  It answers like the DLL's object as far as the exe asks: `GetStatus` is `PLAYEND` once the last frame has been given and its time is
 * over; `Seek(0)` and `Play` start again; `Stop` is `READY` at the first frame.  There is no sound (the exe makes the library without a sound object).
 */
import { D3DDEVTYPE, D3DFMT, D3DPOOL, D3DPT, D3DRTYPE, D3DSAMP, D3DTADDRESS, D3DTEXF, D3DUSAGE } from "@els/d3d9";
import type { Direct3DTexture9 } from "@els/d3d9";
import { Mpeg1Movie, yuv420ToBgra } from "@els/assets";
import { DVB_TYPE } from "@els/engine";
import {
  BVLPF, BVL_E_ALREADY_CREATED, BVL_E_NOT_CREATED, BVL_SEEK, BVL_STATUS, E_FAIL,
} from "./device.ts";
import type { BandiVideoLibrary, BandiVideoTexture, BvlFrame, DeviceManager, VideoInfo } from "./device.ts";
import { VertexUI4 } from "./render.ts";
import type { UIDevice, UIRender } from "./render.ts";

/** the table at 334B10D0 the constructor walks: the `D3DFORMAT`, the `BVL_PIXEL_FORMAT` and the bytes of a pixel */
const TEXTURE_FORMATS: readonly (readonly [number, number, number])[] = [
  [D3DFMT.X8R8G8B8, BVLPF.X8R8G8B8, 4],
  [D3DFMT.R8G8B8, BVLPF.R8G8B8, 3],
  [D3DFMT.R5G6B5, BVLPF.R5G6B5, 2],
  [D3DFMT.X1R5G5B5, BVLPF.R5G5B5, 2],
];

export class BandiVideoTextureDX9 implements BandiVideoTexture {
  m_texture: Direct3DTexture9 | null = null;
  m_fmt_d3d = 0;
  m_fmt_bvl = 0;
  m_pixel_size = 0;
  m_vid_width = 0;
  m_vid_height = 0;
  m_tex_width = 0;
  m_tex_height = 0;
  /** the `Beep(frequency, duration)` calls `Open` made when no texture could be made */
  readonly beeps: [number, number][] = [];

  /** `render`: `g_pD3D` (its `d3d`), `g_pd3dDevice`, the state manager and the vertex buffer manager; none (a world without a device: the exe's `g_pD3D` always exists) leaves the format unknown */
  constructor(private readonly render: UIRender | null) {
    if (!render) return;
    const d3d = render.d3d;
    const display = d3d.GetAdapterDisplayMode(0);
    if (display.hr < 0) return;
    for (const [d3dFormat, bvlFormat, size] of TEXTURE_FORMATS) {
      if (d3d.CheckDeviceFormat(0, D3DDEVTYPE.HAL, display.mode!.Format, 0, D3DRTYPE.TEXTURE, d3dFormat) >= 0) {
        this.m_fmt_d3d = d3dFormat;
        this.m_fmt_bvl = bvlFormat;
        this.m_pixel_size = size;
        return;
      }
    }
  }

  /**
   * `CalcTexSize(vid_size, pow2)` (32984660): the size of the video unless the device wants a power of two (and one is asked for).  (The exe answers 0 when
   * there is no device; `Open` has returned before it asks without one.)
   */
  private calcTexSize(device: UIDevice, vidSize: number, pow2: boolean): number {
    const caps = device.GetDeviceCaps();
    if (pow2 && (caps.TextureCaps & 2) !== 0) {
      let result = 16;
      while (result < vidSize) result *= 2;
      return result;
    }
    return vidSize;
  }

  /** `Open(vid_width, vid_height)` (32984BC0, slot 1) */
  open(vidWidth: number, vidHeight: number): number {
    const device = this.render?.device;
    if (!device) return E_FAIL;
    const caps = device.GetDeviceCaps();
    const pow2 = (caps.TextureCaps & 0x100) === 0;
    const width = this.calcTexSize(device, vidWidth, pow2);
    const height = this.calcTexSize(device, vidHeight, pow2);
    let made = device.CreateTexture(width, height, 1, D3DUSAGE.DYNAMIC, this.m_fmt_d3d, D3DPOOL.MANAGED);
    if (made.hr < 0) {
      made = device.CreateTexture(width, height, 1, 0, this.m_fmt_d3d, D3DPOOL.MANAGED);
      if (made.hr < 0) {
        this.beeps.push([1000, 1000]);
        return made.hr;
      }
    }
    const texture = made.tex!;
    const locked = texture.LockRect(0, null, 0);
    if (locked.hr >= 0) {
      const rowBytes = Math.imul(this.m_pixel_size, width);
      let at = 0;
      for (let rows = height; rows > 0; rows--) {
        locked.pBits!.fill(0, at, at + rowBytes);
        at += locked.pitch;
      }
      texture.UnlockRect(0);
    }
    this.m_texture = texture;
    this.m_vid_width = vidWidth;
    this.m_tex_height = height;
    this.m_vid_height = vidHeight;
    this.m_tex_width = width;
    return 0;
  }

  /** `Close()` (329846E0, slot 2) */
  close(): void {
    this.m_vid_height = 0;
    this.m_vid_width = 0;
    this.m_tex_height = 0;
    this.m_tex_width = 0;
    if (this.m_texture) {
      this.m_texture.Release();
      this.m_texture = null;
    }
  }

  /** `Lock(&pitch)` (32984B80, slot 3): null without a texture; the result of `LockRect` is not looked at (a failing one gives the exe an uninitialised pointer: an Error here) */
  lock(): { bits: Uint8Array; pitch: number } | null {
    const texture = this.m_texture;
    if (!texture) return null;
    const locked = texture.LockRect(0, null, 0);
    if (locked.hr < 0) throw new Error("CBandiVideoTexture_DX9::Lock (32984B80): LockRect failed and the exe goes on with the pointer it did not set");
    return { bits: locked.pBits!, pitch: locked.pitch };
  }

  /** `Unlock()` (32984D60, slot 4): a texture that is not there is a null dereference of the exe */
  unlock(): void {
    if (!this.m_texture) throw new Error("CBandiVideoTexture_DX9::Unlock (32984D60): no texture: the exe dereferences null");
    this.m_texture.UnlockRect(0);
  }

  /** `GetFormat()` (3289C7D0, slot 7) */
  getFormat(): number {
    return this.m_fmt_bvl;
  }

  /** the deleting destructor (329845C0, slot 0): the sizes forgotten and the texture released, as `Close` does it */
  Destroy(): void {
    this.close();
  }

  /** `Draw(x, y, width, height)` (32984720, slot 5); no device draws nothing */
  draw(x: number, y: number, width: number, height: number): number {
    const render = this.render;
    if (!render) return 0;
    const f = Math.fround;
    const texture = this.m_texture;
    const states = render.states;
    const cache = states.apd3dTextures;
    if (cache[0] !== texture) {
      const hr = render.device.SetTexture(0, texture);
      if (hr < 0) render.device.SetTexture(0, null);
      cache[0]?.Release();
      cache[0] = texture;
      texture?.AddRef();
      if (hr < 0) return hr;
    }
    const top = states.stackPointer;
    states.setSamplerState(0, D3DSAMP.ADDRESSU, D3DTADDRESS.CLAMP);
    states.setSamplerState(0, D3DSAMP.ADDRESSV, D3DTADDRESS.CLAMP);
    states.setSamplerState(0, D3DSAMP.MAGFILTER, D3DTEXF.LINEAR);
    states.setSamplerState(0, D3DSAMP.MINFILTER, D3DTEXF.LINEAR);
    const u = f(this.m_vid_width / this.m_tex_width);
    const v = f(this.m_vid_height / this.m_tex_height);
    const left = f(x);
    const upper = f(y);
    const right = f(left + f(width));
    const lower = f(upper + f(height));
    const quad = new VertexUI4();
    const corners: [number, number, number, number][] = [
      [left, upper, 0, 0],
      [right, upper, u, 0],
      [left, lower, 0, v],
      [right, lower, u, v],
    ];
    corners.forEach(([cx, cy, tu, tv], i) => {
      quad.setX(i, cx);
      quad.setY(i, cy); // (z is 0, which the exe stores: the buffer is new)
      quad.setRhw(i, 1);
      quad.setColor(i, 0xffffffff);
      quad.setU(i, tu);
      quad.setV(i, tv);
    });
    render.dvb.drawPrimitive(DVB_TYPE.XYZRHW_DIFFUSE_TEX1, D3DPT.TRIANGLESTRIP, 2, quad.bytes, 1);
    states.popTo(top);
    return 0;
  }
}

/**
 * The player of the platform: `IBandiVideo2` of an MPEG-1 AVI.  `files` gives the bytes of the file the exe names (`<current directory>\movie\<name>`),
 * `clock` the time in milliseconds.
 */
export class Mpeg1VideoLibrary implements BandiVideoLibrary {
  private created = false;
  private movie: Mpeg1Movie | null = null;
  private status: number = BVL_STATUS.CLOSED;
  /** the frame the movie is at (the one `Play` starts from, the one `Seek` named) and the time `Play` was called */
  private origin = 0;
  private startedAt = 0;
  /** the number of the last frame given by `GetFrame` (-1: none since the movie was opened or sought) */
  private given = -1;

  constructor(private readonly files: (path: string) => Uint8Array | null, private readonly clock: () => number) {}

  isCreated(): boolean {
    return this.created;
  }

  create(): number {
    if (this.created) return BVL_E_ALREADY_CREATED;
    this.created = true;
    return 0;
  }

  verify(): number {
    return this.created ? 0 : BVL_E_NOT_CREATED;
  }

  close(): void {
    this.movie = null;
    this.status = BVL_STATUS.CLOSED;
  }

  /** a file that is not there, or is no AVI with an MPEG-1 video stream, is `E_FAIL` */
  open(path: string): number {
    if (!this.created) return BVL_E_NOT_CREATED;
    this.close();
    const bytes = this.files(path);
    if (!bytes) return E_FAIL;
    try {
      this.movie = Mpeg1Movie.open(bytes);
    } catch {
      return E_FAIL;
    }
    this.status = BVL_STATUS.READY;
    this.origin = 0;
    this.given = -1;
    return 0;
  }

  getVideoInfo(): VideoInfo {
    const info = this.movie?.info;
    if (!info) return { width: 0, height: 0 };
    return {
      width: info.width, height: info.height, fps_rate: info.frameRate.num, fps_scale: info.frameRate.den, samplerate: 0, channels: 0,
      total_time: BigInt(Math.round(info.durationMs)), total_frames: BigInt(info.frameCount),
    };
  }

  play(): number {
    if (!this.created || !this.movie) return BVL_E_NOT_CREATED;
    this.status = BVL_STATUS.PLAYING;
    this.startedAt = this.clock();
    return 0;
  }

  stop(): number {
    if (!this.created || !this.movie) return BVL_E_NOT_CREATED;
    this.status = BVL_STATUS.READY;
    this.origin = 0;
    this.given = -1;
    return 0;
  }

  /** `Seek(value, flag)`: a time in milliseconds or a frame number; the movie stays playing when it was; a seek of a finished movie makes it ready */
  seek(value: bigint, flag: number): number {
    const movie = this.movie;
    if (!this.created || !movie) return BVL_E_NOT_CREATED;
    const info = movie.info;
    const frame = flag === BVL_SEEK.FRAME ? Number(value) : this.framesIn(Number(value), info);
    this.origin = Math.max(0, Math.min(info.frameCount - 1, frame));
    this.given = -1;
    this.startedAt = this.clock();
    if (this.status === BVL_STATUS.PLAYEND) this.status = BVL_STATUS.READY;
    return 0;
  }

  /** the number of frames that have begun after `ms` milliseconds of the movie */
  private framesIn(ms: number, info: Mpeg1Movie["info"]): number {
    return Math.floor((ms * info.frameRate.num) / (1000 * info.frameRate.den));
  }

  /** the frame the clock is at: the number of frames since `Play`, counted from where the movie started (the movie's end not taken into account) */
  private clockFrame(info: Mpeg1Movie["info"]): number {
    return this.origin + this.framesIn(Math.max(0, this.clock() - this.startedAt), info);
  }

  /** the frame that is due now: the one the clock is at, but not past the last one (only a playing movie is asked: it has a movie) */
  private due(): number {
    const info = this.movie!.info;
    return Math.min(this.clockFrame(info), info.frameCount - 1);
  }

  /** a playing movie whose last frame was given and whose time is over has played to its end */
  private update(): void {
    if (this.status !== BVL_STATUS.PLAYING) return;
    const info = this.movie!.info;
    if (this.clockFrame(info) >= info.frameCount && this.given === info.frameCount - 1) this.status = BVL_STATUS.PLAYEND;
  }

  getStatus(out: { status: number }): number {
    if (!this.created) return BVL_E_NOT_CREATED;
    this.update();
    out.status = this.status;
    return 0;
  }

  /** only a playing movie has a frame due (a movie that is playing is a movie of a created player); `GetStatus` is where the end is noticed */
  isNextFrame(): number {
    return this.status === BVL_STATUS.PLAYING && this.due() > this.given ? 1 : 0;
  }

  getFrame(frame: BvlFrame, canSkip: number): number {
    const movie = this.movie;
    if (!this.created || !movie) return BVL_E_NOT_CREATED;
    if (this.status !== BVL_STATUS.PLAYING || this.due() <= this.given) return E_FAIL;
    const number = canSkip !== 0 ? this.due() : this.given + 1;
    const decoded = movie.frame(number);
    if (!decoded) return E_FAIL;
    const bgra = yuv420ToBgra(decoded);
    const width = Math.min(frame.width, decoded.width);
    const height = Math.min(frame.height, decoded.height);
    const out = frame.frame_buf;
    for (let y = 0; y < height; y++) {
      let at = y * frame.pitch;
      let from = y * decoded.width * 4;
      for (let x = 0; x < width; x++, from += 4) {
        const b = bgra[from]!;
        const g = bgra[from + 1]!;
        const r = bgra[from + 2]!;
        if (frame.pixel_format === BVLPF.X8R8G8B8 || frame.pixel_format === BVLPF.A8R8G8B8) {
          out[at++] = b;
          out[at++] = g;
          out[at++] = r;
          out[at++] = 255;
        } else if (frame.pixel_format === BVLPF.R8G8B8) {
          out[at++] = b;
          out[at++] = g;
          out[at++] = r;
        } else {
          const packed = frame.pixel_format === BVLPF.R5G6B5 ? ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3) : ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          out[at++] = packed & 0xff;
          out[at++] = packed >> 8;
        }
      }
    }
    frame.frame_number = BigInt(number);
    frame.frame_time = BigInt(Math.round((number * 1000 * movie.info.frameRate.den) / movie.info.frameRate.num));
    this.given = number;
    return 0;
  }

  destroy(): void {
    this.movie = null;
    this.created = false;
    this.status = BVL_STATUS.CLOSED;
  }
}

/**
 * Make the world play its movies with a platform's files and clock: the video player of every `CMovieData` is an `Mpeg1VideoLibrary` that reads
 * `<current directory>\movie\<name>` through `read(name)` and the video texture is the exe's `CBandiVideoTexture_DX9`.
 */
export function installMovies(devices: DeviceManager, read: (name: string) => Uint8Array | null, clock: () => number): void {
  devices.createVideoLibrary = () =>
    new Mpeg1VideoLibrary((path) => {
      const prefix = `${devices.currentDirectory}\\movie\\`;
      return read(path.startsWith(prefix) ? path.slice(prefix.length) : path);
    }, clock);
  devices.createVideoTexture = (render) => new BandiVideoTextureDX9(render);
}
