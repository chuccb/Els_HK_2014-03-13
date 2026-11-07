/**
 * `CKTDGDynamicVBManager`: where the client draws vertices it makes on the CPU every frame (UI quads, slash traces, particles ...).
 *
 * `DrawPrimitive(eType, primitiveType, numPrimitives, pData, numDraws)` copies the vertices into the next free part of a ring of vertex
 * buffers and draws them from there, `numDraws` times (a repeat count the UI uses to make a picture brighter).  The default mode on a
 * current Windows is DYNAMICVB; the buffers are `D3DUSAGE_DYNAMIC | WRITEONLY` in the default pool, a lock at offset 0 is a DISCARD lock
 * (the ring moved on to a fresh buffer) and every other lock is NOOVERWRITE.  The mode PRIMITIVEUP, which draws straight from the
 * caller's memory, is the same function without the buffers.
 *
 * Ported: ctor (328E2DB0), `CustomInitialize` (328E3080), `CustomFinalize` (328E3060), `DynamicVBInfo::Reset` (328E3620),
 * `OnLostDevice` (328E3390), `OnResetDevice` (328E3400), `_DrawPrimitiveDynamicVB` (328E3730), `_DrawPrimitiveUP` (328E56E0),
 * `ConvertToNumPrimitives` (328E3670), `ConvertToNumVertices` (328E36E0).  Not ported: MANAGED mode, the try / catch variant that only a
 * Windows 2000 / XP machine selects, and the `..._SplitData` family (they draw vertices that are kept in separate arrays).
 */
import { D3DLOCK, D3DPOOL, D3DPT, D3DUSAGE, fvfVertexSize } from "@els/d3d9";

/** `CKTDGDynamicVBManager::EDYNAMIC_VB_TYPE` */
export const DVB_TYPE = { XYZ_DIFFUSE: 0, XYZ_DIFFUSE_TEX1: 1, XYZ_TEX1: 2, XYZRHW_DIFFUSE_TEX1: 3 } as const;
/** `CKTDGDynamicVBManager::EDYNAMIC_VB_MODE` */
export const DYNAMIC_VB_MODE = { MANAGED: 0, PRIMITIVEUP: 1, DYNAMICVB: 2, DYNAMICVB_WITH_TRY_CATCH: 3 } as const;

/** a vertex buffer as the manager uses it (`IDirect3DVertexBuffer9`) */
export interface DynamicVertexBuffer {
  Lock(offset: number, size: number, flags: number): { hr: number; data: Uint8Array | null };
  Unlock(): number;
  Release(): number;
}

/** the device calls of the manager */
export interface DynamicVBDevice {
  GetDeviceCaps(): { MaxPrimitiveCount: number };
  CreateVertexBuffer(length: number, usage: number, fvf: number, pool: number): { hr: number; vb: DynamicVertexBuffer | null };
  SetFVF(fvf: number): number;
  SetStreamSource(stream: number, vb: DynamicVertexBuffer | null, offset: number, stride: number): number;
  DrawPrimitive(primitiveType: number, startVertex: number, primitiveCount: number): number;
  DrawPrimitiveUP(primitiveType: number, primitiveCount: number, vertexData: Uint8Array, stride: number): number;
}

/** `CKTDGDynamicVBManager::KVBInfo` */
export interface KVBInfo {
  m_uCurVertexIndex: number;
  m_pVB: DynamicVertexBuffer | null;
}

/** `CKTDGDynamicVBManager::DynamicVBInfo` */
export class DynamicVBInfo {
  m_uNumVertices = 0;
  m_dwFVF = 0;
  m_dwVertexStride = 0;
  m_vecVBInfo: KVBInfo[] = [];
  m_iCurVBInfoIndex = 0;

  /** `DynamicVBInfo::Reset` (328E3620) */
  reset(): void {
    this.m_uNumVertices = 0;
    this.m_dwFVF = 0;
    this.m_dwVertexStride = 0;
    for (const i of this.m_vecVBInfo) {
      i.m_uCurVertexIndex = 0;
      if (i.m_pVB) {
        i.m_pVB.Release();
        i.m_pVB = null;
      }
    }
    this.m_iCurVBInfoIndex = 0;
  }
}

/** `ConvertToNumPrimitives` (328E3670) */
export function ConvertToNumPrimitives(primitiveType: number, numVertices: number): number {
  switch (primitiveType) {
    case D3DPT.POINTLIST: return numVertices;
    case D3DPT.LINELIST: return numVertices >>> 1;
    case D3DPT.LINESTRIP: return numVertices > 1 ? numVertices - 1 : 0;
    case D3DPT.TRIANGLELIST: return Math.floor(numVertices / 3);
    case D3DPT.TRIANGLESTRIP:
    case D3DPT.TRIANGLEFAN: return numVertices > 2 ? numVertices - 2 : 0;
    default: return 0;
  }
}

/** `ConvertToNumVertices` (328E36E0) */
export function ConvertToNumVertices(primitiveType: number, numPrimitives: number): number {
  if (numPrimitives === 0) return 0;
  switch (primitiveType) {
    case D3DPT.POINTLIST: return numPrimitives;
    case D3DPT.LINELIST: return 2 * numPrimitives;
    case D3DPT.LINESTRIP: return numPrimitives + 1;
    case D3DPT.TRIANGLELIST: return 3 * numPrimitives;
    case D3DPT.TRIANGLESTRIP:
    case D3DPT.TRIANGLEFAN: return numPrimitives + 2;
    default: return 0;
  }
}

export type DrawPrimitiveFn = (type: number, primitiveType: number, numPrimitives: number, data: Uint8Array | null, numDraws: number) => void;

export class CKTDGDynamicVBManager {
  /** `m_eDynamicVBMode` */
  m_eDynamicVBMode: number = DYNAMIC_VB_MODE.MANAGED;
  /** `m_uNumMaxPrimitiveCount`: `D3DCAPS9::MaxPrimitiveCount` of the device */
  m_uNumMaxPrimitiveCount = 0;
  /** `m_uNumExceptionsOccurred`: counts the exceptions the try / catch mode (not ported) catches */
  m_uNumExceptionsOccurred = 0;
  /** `m_aDynamicVBInfo` */
  readonly m_aDynamicVBInfo: DynamicVBInfo[] = [new DynamicVBInfo(), new DynamicVBInfo(), new DynamicVBInfo(), new DynamicVBInfo()];
  /** `m_pDrawPrimitiveFn`: set by `OnResetDevice`, null while the device is lost */
  m_pDrawPrimitiveFn: DrawPrimitiveFn | null = null;

  /** `CKTDGDynamicVBManager::CKTDGDynamicVBManager` (328E2DB0): `CustomInitialize(false)` of a device whose objects exist */
  constructor(readonly device: DynamicVBDevice | null, mode: number = DYNAMIC_VB_MODE.DYNAMICVB) {
    this.customInitialize(mode);
  }

  /**
   * `CustomInitialize` (328E3080): every buffer description is reset, the mode is DYNAMICVB, the four descriptions are filled and, when
   * the device objects exist, `OnResetDevice` makes the buffers.  `mode` is for tests of the other mode that is ported.
   */
  customInitialize(mode: number = DYNAMIC_VB_MODE.DYNAMICVB): void {
    this.m_eDynamicVBMode = DYNAMIC_VB_MODE.MANAGED;
    this.m_uNumMaxPrimitiveCount = 0;
    this.m_pDrawPrimitiveFn = null;
    this.m_uNumExceptionsOccurred = 0;
    for (const i of this.m_aDynamicVBInfo) i.reset();
    this.m_eDynamicVBMode = mode;
    const dynamic = mode === DYNAMIC_VB_MODE.DYNAMICVB || mode === DYNAMIC_VB_MODE.DYNAMICVB_WITH_TRY_CATCH;
    const fill = (type: number, vertices: number, fvf: number, buffers: number): void => {
      const info = this.m_aDynamicVBInfo[type]!;
      info.m_uNumVertices = vertices;
      info.m_dwFVF = fvf;
      info.m_dwVertexStride = fvfVertexSize(fvf);
      info.m_vecVBInfo = Array.from({ length: dynamic ? buffers : 1 }, () => ({ m_uCurVertexIndex: 0, m_pVB: null }));
    };
    fill(DVB_TYPE.XYZ_DIFFUSE, 1024, 0x42, 1);
    fill(DVB_TYPE.XYZ_DIFFUSE_TEX1, 4096, 0x142, 10);
    fill(DVB_TYPE.XYZ_TEX1, 1024, 0x102, 1);
    fill(DVB_TYPE.XYZRHW_DIFFUSE_TEX1, 40960, 0x144, 10);
    if (this.device) this.onResetDevice();
  }

  /** `CustomFinalize` (328E3060) */
  customFinalize(): void {
    for (const i of this.m_aDynamicVBInfo) i.reset();
  }

  /** `OnLostDevice` (328E3390): the buffers go, drawing stops */
  onLostDevice(): number {
    this.m_pDrawPrimitiveFn = null;
    for (const info of this.m_aDynamicVBInfo) {
      for (const i of info.m_vecVBInfo) {
        i.m_uCurVertexIndex = 0;
        if (i.m_pVB) {
          i.m_pVB.Release();
          i.m_pVB = null;
        }
      }
      info.m_iCurVBInfoIndex = 0;
    }
    return 0;
  }

  /** `OnResetDevice` (328E3400): the buffers are made again and the draw function of the mode is chosen */
  onResetDevice(): number {
    const device = this.device;
    this.m_uNumMaxPrimitiveCount = 0;
    if (device) this.m_uNumMaxPrimitiveCount = device.GetDeviceCaps().MaxPrimitiveCount;
    for (const info of this.m_aDynamicVBInfo) {
      for (const i of info.m_vecVBInfo) {
        if (i.m_pVB) {
          i.m_pVB.Release();
          i.m_pVB = null;
        }
        i.m_uCurVertexIndex = 0;
      }
      info.m_iCurVBInfoIndex = 0;
      if (info.m_uNumVertices !== 0 && device) {
        const mode = this.m_eDynamicVBMode;
        if (mode === DYNAMIC_VB_MODE.MANAGED || mode === DYNAMIC_VB_MODE.DYNAMICVB || mode === DYNAMIC_VB_MODE.DYNAMICVB_WITH_TRY_CATCH) {
          const usage = mode === DYNAMIC_VB_MODE.MANAGED ? D3DUSAGE.WRITEONLY : D3DUSAGE.DYNAMIC | D3DUSAGE.WRITEONLY;
          const pool = mode === DYNAMIC_VB_MODE.MANAGED ? D3DPOOL.MANAGED : D3DPOOL.DEFAULT;
          for (const i of info.m_vecVBInfo) i.m_pVB = device.CreateVertexBuffer(info.m_uNumVertices * info.m_dwVertexStride, usage, info.m_dwFVF, pool).vb;
          info.m_iCurVBInfoIndex = 0;
        }
      }
    }
    switch (this.m_eDynamicVBMode) {
      case DYNAMIC_VB_MODE.PRIMITIVEUP:
        this.m_pDrawPrimitiveFn = (t, p, n, d, k) => this._DrawPrimitiveUP(t, p, n, d, k);
        break;
      case DYNAMIC_VB_MODE.DYNAMICVB:
        this.m_pDrawPrimitiveFn = (t, p, n, d, k) => this._DrawPrimitiveDynamicVB(t, p, n, d, k);
        break;
      default:
        // MANAGED and the try / catch mode draw through functions that are not ported: nothing is drawn
        this.m_pDrawPrimitiveFn = null;
    }
    return 0;
  }

  /** what every caller does: `if (m_pDrawPrimitiveFn) m_pDrawPrimitiveFn(this, ...)` */
  drawPrimitive(type: number, primitiveType: number, numPrimitives: number, data: Uint8Array | null, numDraws: number): void {
    if (this.m_pDrawPrimitiveFn) this.m_pDrawPrimitiveFn(type, primitiveType, numPrimitives, data, numDraws);
  }

  /** `_DrawPrimitiveUP` (328E56E0): `SetFVF`, then `DrawPrimitiveUP` from the caller's memory, in pieces of `MaxPrimitiveCount` */
  _DrawPrimitiveUP(type: number, primitiveType: number, numPrimitives: number, data: Uint8Array | null, numDraws: number): void {
    if (type > DVB_TYPE.XYZRHW_DIFFUSE_TEX1) return;
    let prims = numPrimitives;
    if (prims === 0 || !data || numDraws === 0) return;
    const info = this.m_aDynamicVBInfo[type]!;
    const device = this.device;
    if (info.m_uNumVertices === 0 || !device) return;
    const max = this.m_uNumMaxPrimitiveCount;
    if (max === 0) return;
    if (primitiveType === D3DPT.TRIANGLEFAN && prims > max) prims = max;
    device.SetFVF(info.m_dwFVF);
    const stride = info.m_dwVertexStride;
    const pieceSize = (): number => (primitiveType === D3DPT.TRIANGLESTRIP && max < prims ? max & ~1 : max);
    let piece = pieceSize();
    if (piece === 0) return;
    let at = 0;
    while (piece < prims) {
      for (let i = 0; i < numDraws; i++) device.DrawPrimitiveUP(primitiveType, piece, data.subarray(at), stride);
      prims -= piece;
      switch (primitiveType) {
        case D3DPT.POINTLIST:
        case D3DPT.LINESTRIP:
        case D3DPT.TRIANGLESTRIP: at += piece * stride; break;
        case D3DPT.LINELIST: at += 2 * piece * stride; break;
        case D3DPT.TRIANGLELIST: at += 3 * piece * stride; break;
        default: return;
      }
      piece = pieceSize();
      if (piece === 0) return;
    }
    for (let i = 0; i < numDraws; i++) device.DrawPrimitiveUP(primitiveType, prims, data.subarray(at), stride);
  }

  /**
   * `_DrawPrimitiveDynamicVB` (328E3730).  The vertices are appended to the current buffer of the ring (`m_iCurVBInfoIndex`) at its
   * `m_uCurVertexIndex`.  When they do not fit, a fan or a full buffer moves on to the next buffer at offset 0 and anything else is cut
   * into pieces that fill the rest of the buffer and go on in the next one.
   */
  _DrawPrimitiveDynamicVB(type: number, primitiveType: number, numPrimitives: number, data: Uint8Array | null, numDraws: number): void {
    if (type > DVB_TYPE.XYZRHW_DIFFUSE_TEX1) return;
    let prims = numPrimitives; // uNumPrimitives
    if (prims === 0 || !data || numDraws === 0) return;
    const info = this.m_aDynamicVBInfo[type]!;
    const numVertices = info.m_uNumVertices;
    const ring = info.m_vecVBInfo;
    const device = this.device;
    if (numVertices === 0 || !ring[info.m_iCurVBInfoIndex]?.m_pVB || !device) return;
    const max = this.m_uNumMaxPrimitiveCount;
    if (max === 0) return;
    const stride = info.m_dwVertexStride;
    if (primitiveType === D3DPT.TRIANGLEFAN && prims > max) prims = max;
    let vertices = ConvertToNumVertices(primitiveType, prims); // eTypea: the vertices to copy
    if (vertices === 0) return;
    if (primitiveType === D3DPT.TRIANGLEFAN && vertices > numVertices) {
      vertices = numVertices;
      prims = numVertices > 2 ? numVertices - 2 : 0;
    }
    device.SetFVF(info.m_dwFVF);
    let bound = info.m_iCurVBInfoIndex; // v51: the buffer SetStreamSource has been given last
    device.SetStreamSource(0, ring[bound]!.m_pVB, 0, stride);
    let at = ring[info.m_iCurVBInfoIndex]!.m_uCurVertexIndex; // v15: where the next vertex goes
    let src = 0; // how far `pData` has advanced, in bytes

    const nextBuffer = (): void => {
      info.m_iCurVBInfoIndex++;
      if (info.m_iCurVBInfoIndex >= ring.length) info.m_iCurVBInfoIndex = 0;
      at = 0;
      ring[info.m_iCurVBInfoIndex]!.m_uCurVertexIndex = 0;
    };
    /** the pieces: what fits in `room` vertices (a whole number of strip pairs, unless it is the last piece) */
    const pieceSize = (room: number): number => {
      const n = Math.min(max, ConvertToNumPrimitives(primitiveType, room));
      return primitiveType === D3DPT.TRIANGLESTRIP && n < prims ? n & ~1 : n;
    };
    /** lock, copy, unlock, draw `numDraws` times from `at`; false when the lock failed */
    const emit = (count: number, primCount: number): boolean => {
      const cur = info.m_iCurVBInfoIndex;
      if (bound !== cur) {
        bound = cur;
        device.SetStreamSource(0, ring[cur]!.m_pVB, 0, stride);
      }
      const vb = ring[cur]!.m_pVB!;
      const lock = vb.Lock(at * stride, count * stride, at === 0 ? D3DLOCK.DISCARD : D3DLOCK.NOOVERWRITE);
      if (lock.hr < 0) return false;
      if (lock.data) lock.data.set(data.subarray(src, src + count * stride));
      vb.Unlock();
      for (let i = 0; i < numDraws; i++) device.DrawPrimitive(primitiveType, at, primCount);
      return true;
    };

    if (at + vertices > numVertices) {
      if (at >= numVertices || primitiveType === D3DPT.TRIANGLEFAN) nextBuffer();
      let piece = pieceSize(numVertices - at);
      if (piece === 0) {
        nextBuffer();
        piece = pieceSize(numVertices);
        if (piece === 0) return;
      }
      while (piece < prims) {
        let count: number; // eTypeb: the vertices of the piece
        switch (primitiveType) {
          case D3DPT.POINTLIST: count = piece; break;
          case D3DPT.LINELIST: count = 2 * piece; break;
          case D3DPT.LINESTRIP: count = piece + 1; break;
          case D3DPT.TRIANGLELIST: count = 3 * piece; break;
          case D3DPT.TRIANGLESTRIP:
          case D3DPT.TRIANGLEFAN: count = piece + 2; break;
          default: count = 0;
        }
        if (!emit(count, piece)) return;
        at += count;
        prims -= piece;
        ring[info.m_iCurVBInfoIndex]!.m_uCurVertexIndex = at;
        switch (primitiveType) {
          case D3DPT.POINTLIST:
          case D3DPT.LINESTRIP:
          case D3DPT.TRIANGLESTRIP: src += piece * stride; break;
          case D3DPT.LINELIST: src += 2 * piece * stride; break;
          case D3DPT.TRIANGLELIST: src += 3 * piece * stride; break;
          default: return;
        }
        piece = pieceSize(numVertices - at);
        if (piece === 0) {
          nextBuffer();
          piece = pieceSize(numVertices);
          if (piece === 0) return;
        }
      }
      vertices = ConvertToNumVertices(primitiveType, prims);
      if (vertices === 0 || vertices > numVertices) return;
    }
    // the last (or the only) piece
    if (emit(vertices, prims)) ring[info.m_iCurVBInfoIndex]!.m_uCurVertexIndex = at + vertices;
  }
}
