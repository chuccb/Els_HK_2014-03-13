/**
 * The rig the drawing tests share: a Direct3D device that writes down the calls that change something, and a world that draws on it with
 * textures of 64 x 32 texels that each hold a fake Direct3D texture named after the file.  The world is 1536 x 1536 pixels, so the layout
 * of 1024 x 768 is scaled by (1536 * 0.0009765625, 1536 / 768) = (1.5, 2).
 */
import { StringTable } from "@els/assets";
import type { Direct3DDevice9, Direct3DTexture9 } from "@els/d3d9";
import type { MassFileSource } from "@els/host";
import { UIPointData, UITextureData, VertexUI4 } from "../src/index.ts";
import type { UIContext } from "../src/index.ts";
import { setup } from "./harness.ts";

export const E_FAIL = -2147467259;

export class FakeTexture {
  refs = 1;
  constructor(readonly name: string) {}
  AddRef(): number { return ++this.refs; }
  Release(): number { return --this.refs; }
}

export class FakeVB {
  readonly data: Uint8Array;
  constructor(readonly id: number, length: number) { this.data = new Uint8Array(length); }
  Lock(offset: number, size: number): { hr: number; data: Uint8Array | null } { return { hr: 0, data: this.data.subarray(offset, offset + size) }; }
  Unlock(): number { return 0; }
  Release(): number { return 0; }
}

/** a texture `D3DXCreateTexture` made on the recorder (the pages of a glyph font): its pixels, whether it is locked and with which flags */
export class FakePageTexture {
  refs = 1;
  locked = false;
  lockFlags = -1;
  lockCount = 0;
  readonly bits: Uint8Array;
  constructor(readonly id: number, readonly pool: number, readonly width: number, readonly height: number, readonly levels = 1, readonly usage = 0, readonly format = 0) {
    this.bits = new Uint8Array(width * height * 4);
  }
  get name(): string { return `page${this.id}`; }
  AddRef(): number { return ++this.refs; }
  Release(): number { return --this.refs; }
  LockRect(_level: number, _rect: unknown, flags: number): { hr: number; pBits: Uint8Array; pitch: number } {
    this.locked = true;
    this.lockFlags = flags;
    this.lockCount++;
    return { hr: 0, pBits: this.bits, pitch: this.width * 4 };
  }
  UnlockRect(): number { this.locked = false; return 0; }
}

/** a Direct3D device that writes down the calls that change something */
export class Recorder {
  readonly log: string[] = [];
  readonly vbs: FakeVB[] = [];
  readonly textures: FakePageTexture[] = [];
  /** the HRESULT `CreateTexture` answers for the next calls (a queue; empty: success) */
  readonly textureResults: number[] = [];
  readonly declaration = { released: 0, Release: () => ++this.declaration.released };
  GetDeviceCaps(): { MaxPrimitiveCount: number; MaxTextureWidth: number; MaxTextureHeight: number } {
    return { MaxPrimitiveCount: 0xfffff, MaxTextureWidth: 4096, MaxTextureHeight: 4096 };
  }
  CreateTexture(width: number, height: number, levels: number, usage: number, format: number, pool: number): { hr: number; tex: FakePageTexture | null } {
    const hr = this.textureResults.shift() ?? 0;
    if (hr < 0) return { hr, tex: null };
    const tex = new FakePageTexture(this.textures.length, pool, width, height, levels, usage, format);
    this.textures.push(tex);
    this.log.push(`create ${tex.id} pool ${pool} ${width}x${height}`);
    return { hr: 0, tex };
  }
  /** the ids of the source textures `UpdateTexture` was given while they were still locked (Direct3D wants them unlocked) */
  readonly lockedUpdates: number[] = [];
  UpdateTexture(src: FakePageTexture, dst: FakePageTexture): number {
    if (src.locked) this.lockedUpdates.push(src.id);
    this.log.push(`update ${src.id} ${dst.id}`);
    dst.bits.set(src.bits);
    return 0;
  }
  CreateVertexBuffer(length: number): { hr: number; vb: FakeVB } {
    const vb = new FakeVB(this.vbs.length, length);
    this.vbs.push(vb);
    return { hr: 0, vb };
  }
  SetFVF(fvf: number): number { this.log.push(`fvf ${fvf}`); return 0; }
  SetStreamSource(_stream: number, vb: FakeVB | null, _offset: number, stride: number): number { this.log.push(`src ${vb!.id} ${stride}`); return 0; }
  DrawPrimitive(type: number, start: number, count: number): number { this.log.push(`draw ${type} ${start} ${count}`); return 0; }
  DrawPrimitiveUP(): number { this.log.push("up"); return 0; }
  SetRenderState(state: number, value: number): number { this.log.push(`rs ${state} ${value}`); return 0; }
  SetTextureStageState(stage: number, type: number, value: number): number { this.log.push(`tss ${stage} ${type} ${value}`); return 0; }
  SetSamplerState(stage: number, type: number, value: number): number { this.log.push(`ss ${stage} ${type} ${value}`); return 0; }
  SetTexture(stage: number, texture: FakeTexture | null): number { this.log.push(`tex ${stage} ${texture ? texture.name : "null"}`); return 0; }
  GetVertexDeclaration(): unknown { this.log.push("getdecl"); return this.declaration; }
  SetVertexDeclaration(declaration: unknown): number { this.log.push(declaration ? "setdecl" : "setdecl null"); return 0; }
}

/** a world that draws on the recorder, with textures of 64 x 32 texels that each hold a fake Direct3D texture named after the file */
export function rig(extra: { backBuffer?: { width: number; height: number }; tickCount?: () => number; source?: MassFileSource } = {}) {
  const dev = new Recorder();
  const s = setup(new StringTable([]), { device: dev as unknown as Direct3DDevice9, backBuffer: { width: 1536, height: 1536 }, ...extra });
  const open = s.w.devices.openTexture.bind(s.w.devices);
  s.w.devices.openTexture = ((id: string) => {
    const t = open(id);
    if (t) {
      t.m_pTexture = new FakeTexture(id.toUpperCase()) as unknown as Direct3DTexture9;
      t.uWidth = 64;
      t.uHeight = 32;
    }
    return t;
  }) as typeof s.w.devices.openTexture;
  dev.log.length = 0; // what bringing the device to the baseline cost is pinned by a test of its own
  return { ...s, dev };
}

/** a world without a device: the census and the other tests */
export const headless = () => setup();

/** the quad of a 64 x 32 picture at (x, y), the UVs 0..1 (a texture without a key: the whole image) */
export function quad(w: UIContext, x: number, y: number, texture = "QUAD.TGA"): UIPointData {
  const p = new UIPointData();
  p.leftTopPoint.set(x, y);
  p.rightTopPoint.set(x + 64, y);
  p.leftBottomPoint.set(x, y + 32);
  p.rightBottomPoint.set(x + 64, y + 32);
  const t = new UITextureData();
  t.pTexture = w.devices.openTexture(texture) ?? null;
  const uv = [[0, 0], [1, 0], [0, 0.5], [1, 0.5]] as const;
  uv.forEach(([u, v], i) => t.uvTexture[i]!.set(u, v));
  p.pUITextureData = t;
  return p;
}

export const verts = (v: VertexUI4) => [0, 1, 2, 3].map((i) => [v.x(i), v.y(i), v.z(i), v.rhw(i), v.color(i), v.u(i), v.v(i)]);

/**
 * The triangles of the `DrawPrimitive` calls the recorder saw from `from` on (an index into `log`): the vertex bytes the dynamic vertex
 * buffer wrote (`src <buffer> <stride>` names the buffer a `draw <type> <start> <count>` reads).  A vertex of stride 28 is
 * `[x, y, z, rhw, color, u, v]`, one of stride 24 `[x, y, z, color, u, v]`; the colour is the 32-bit value.
 */
export interface DrawnCall {
  /** the primitive type (4: triangle list) */
  type: number;
  prims: number;
  stride: number;
  /** `3 * prims` vertices for a list */
  vertices: number[][];
}
export function drawnCalls(dev: Recorder, from = 0): DrawnCall[] {
  const out: DrawnCall[] = [];
  let vb = -1;
  let stride = 0;
  for (const line of dev.log.slice(from)) {
    const w = line.split(" ");
    if (w[0] === "src") {
      vb = Number(w[1]);
      stride = Number(w[2]);
    } else if (w[0] === "draw") {
      const type = Number(w[1]), start = Number(w[2]), prims = Number(w[3]);
      const data = dev.vbs[vb]!.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const n = type === 4 ? prims * 3 : prims + 2;
      const vertices: number[][] = [];
      for (let i = 0; i < n; i++) {
        const at = (start + i) * stride;
        const v: number[] = [];
        for (let k = 0; k < stride / 4; k++) {
          const colorSlot = stride === 28 ? 4 : 3;
          v.push(k === colorSlot ? view.getUint32(at + 4 * k, true) : view.getFloat32(at + 4 * k, true));
        }
        vertices.push(v);
      }
      out.push({ type, prims, stride, vertices });
    }
  }
  return out;
}
