/**
 * `ID3DXMesh` and the D3DX mesh functions the exe imports (x2.exe.c: CKTDXDeviceXMesh::_Load ~L425250..426100, the skin-mesh loader
 * ~L429300..430500): `D3DXLoadMeshFromXInMemory`, `D3DXCreateMeshFVF`, `D3DXWeldVertices`, `D3DXComputeBoundingSphere`,
 * `D3DXIntersect`, and the mesh methods LockVertexBuffer / LockIndexBuffer / GetAttributeTable / Optimize / CloneMeshFVF / DrawSubset.
 *
 * The exe loads a static mesh like this (CKTDXDeviceXMesh): LoadMeshFromX(options D3DXMESH_MANAGED) -> CloneMeshFVF to FVF 338
 * (XYZ | NORMAL | DIFFUSE | TEX1) when the loaded FVF differs -> writes 0xFFFFFFFF into every vertex colour itself ->
 * ComputeBoundingSphere -> WeldVertices(flags 0, all epsilons 0) -> Optimize(ATTRSORT | VERTEXCACHE | MANAGED) -> GetAttributeTable
 * -> one bounding sphere per subset from its vertex range.  Everything below is written so that this sequence yields the same
 * subsets, vertex ranges and bounding spheres as D3DX would; what D3DX does internally and cannot be observed through that
 * sequence is documented as an assumption:
 *  - `D3DXLoadMeshFromX` merges every mesh of the file into one, baking each mesh's accumulated frame transform (row-vector
 *    convention: world = local * parentWorld) into positions and normals; materials are appended per mesh (not deduplicated) and a
 *    face's attribute is its mesh's material base + its MeshMaterialList index.  Vertices are split where a face corner uses another
 *    normal index than the first corner that used the position (D3DX does the same to get one normal per vertex).
 *  - Optimize with ATTRSORT sorts faces by attribute (stable) and, unless DONOTSPLIT, gives every attribute group its own vertex
 *    range (vertices shared between groups are duplicated); VERTEXCACHE / COMPACT renumber vertices in order of first use.  The
 *    cache-optimising face order of the real VERTEXCACHE pass is not reproduced (it is invisible except through face indices).
 *  - WeldVertices welds vertices whose components are within the epsilons, wherever they are (D3DX restricts the match by adjacency
 *    unless D3DXWELDEPSILONS_WELDALL is set; for exact duplicates of watertight meshes the result is the same).
 *  - ComputeBoundingSphere = centroid + largest distance (the documented behaviour, and what Wine's d3dx9_36 does; not the minimal sphere).
 */
import { loadXScene, walkFrames } from "@els/assets";
import type { XMeshData, XScene } from "@els/assets";
import { D3DDECLTYPE, D3DDECLUSAGE, D3DFMT, D3DPOOL, D3DPT, D3DUSAGE } from "./enums.ts";
import { D3DERR_INVALIDCALL, D3DXERR_INVALIDDATA, D3D_OK, E_FAIL } from "./hresult.ts";
import { fvfToElements, fvfVertexSize } from "./vertex.ts";
import type { VertexElement } from "./vertex.ts";
import { matMultiply, vec3TransformCoord, vec3TransformNormal } from "./d3dx-math.ts";
import type { Mat4, Vec3 } from "./d3dx-math.ts";
import type { Material } from "./state.ts";
import type { Direct3DDevice9 } from "./device.ts";
import type { Direct3DIndexBuffer9, Direct3DVertexBuffer9 } from "./resources.ts";

/** D3DXMESH_* */
export const D3DXMESH = {
  _32BIT: 0x001, DONOTCLIP: 0x002, POINTS: 0x004, RTPATCHES: 0x008, NPATCHES: 0x4000,
  VB_SYSTEMMEM: 0x010, VB_MANAGED: 0x020, VB_WRITEONLY: 0x040, VB_DYNAMIC: 0x080, VB_SOFTWAREPROCESSING: 0x8000,
  IB_SYSTEMMEM: 0x100, IB_MANAGED: 0x200, IB_WRITEONLY: 0x400, IB_DYNAMIC: 0x800, IB_SOFTWAREPROCESSING: 0x10000,
  VB_SHARE: 0x1000, USEHWONLY: 0x2000, SYSTEMMEM: 0x110, MANAGED: 0x220, WRITEONLY: 0x440, DYNAMIC: 0x880, SOFTWAREPROCESSING: 0x18000,
} as const;
/** D3DXMESHOPT_* */
export const D3DXMESHOPT = {
  COMPACT: 0x01000000, ATTRSORT: 0x02000000, VERTEXCACHE: 0x04000000, STRIPREORDER: 0x08000000, IGNOREVERTS: 0x10000000, DONOTSPLIT: 0x20000000, DEVICEINDEPENDENT: 0x00400000,
} as const;
/** D3DXWELDEPSILONS flags */
export const D3DXWELDEPSILONS = { WELDALL: 1, WELDPARTIALMATCHES: 2, DONOTREMOVEVERTICES: 4, DONOTSPLIT: 8 } as const;

export const NO_NEIGHBOUR = 0xffffffff;

/** D3DXATTRIBUTERANGE */
export interface D3DXAttributeRange { AttribId: number; FaceStart: number; FaceCount: number; VertexStart: number; VertexCount: number }
/** D3DXMATERIAL */
export interface D3DXMaterial { MatD3D: Material; pTextureFilename: string | null }
/** D3DXWELDEPSILONS: 17 floats; unnamed members of the C struct are kept in the same order. */
export interface D3DXWeldEpsilons {
  Position: number; BlendWeights: number; Normal: number; PSize: number; Specular: number; Diffuse: number; Texcoord: number[]; Tangent: number; Binormal: number; TessFactor: number;
}
export const zeroWeldEpsilons = (): D3DXWeldEpsilons => ({ Position: 0, BlendWeights: 0, Normal: 0, PSize: 0, Specular: 0, Diffuse: 0, Texcoord: new Array(8).fill(0), Tangent: 0, Binormal: 0, TessFactor: 0 });

const OPT_MASK_VB = D3DXMESH.VB_SYSTEMMEM | D3DXMESH.VB_MANAGED | D3DXMESH.VB_DYNAMIC;
function poolOf(options: number, mask: number, systemmem: number): number {
  return (options & systemmem) !== 0 && (options & mask) === systemmem ? D3DPOOL.SYSTEMMEM : D3DPOOL.MANAGED;
}
void OPT_MASK_VB;

export interface OptimizeResult { hr: number; adjacencyOut: Uint32Array | null; faceRemap: Uint32Array | null; vertexRemap: Uint32Array | null }

export class D3DXMesh {
  attributeTable: D3DXAttributeRange[] | null = null;
  private readonly stride: number;
  private attrLocked = false;

  constructor(
    readonly device: Direct3DDevice9, readonly numFaces: number, readonly numVertices: number, readonly options: number, readonly fvf: number,
    readonly vb: Direct3DVertexBuffer9, readonly ib: Direct3DIndexBuffer9, public attributeBuffer: Uint32Array,
  ) {
    this.stride = fvfVertexSize(fvf);
  }

  // --- ID3DXBaseMesh --------------------------------------------------------------------------------------------------
  GetNumFaces(): number { return this.numFaces; }
  GetNumVertices(): number { return this.numVertices; }
  GetFVF(): number { return this.fvf; }
  GetDeclaration(): VertexElement[] { return fvfToElements(this.fvf).elements; }
  GetNumBytesPerVertex(): number { return this.stride; }
  GetOptions(): number { return this.options; }
  GetDevice(): Direct3DDevice9 { return this.device; }
  GetVertexBuffer(): Direct3DVertexBuffer9 { this.vb.AddRef(); return this.vb; }
  GetIndexBuffer(): Direct3DIndexBuffer9 { this.ib.AddRef(); return this.ib; }
  get is32(): boolean { return this.ib.is32; }

  LockVertexBuffer(flags: number): { hr: number; data: Uint8Array | null } { return this.vb.Lock(0, 0, flags); }
  UnlockVertexBuffer(): number { return this.vb.Unlock(); }
  LockIndexBuffer(flags: number): { hr: number; data: Uint8Array | null } { return this.ib.Lock(0, 0, flags); }
  UnlockIndexBuffer(): number { return this.ib.Unlock(); }
  LockAttributeBuffer(_flags: number): { hr: number; data: Uint32Array | null } {
    if (this.attrLocked) return { hr: D3DERR_INVALIDCALL, data: null };
    this.attrLocked = true;
    return { hr: D3D_OK, data: this.attributeBuffer };
  }
  UnlockAttributeBuffer(): number { if (!this.attrLocked) return D3DERR_INVALIDCALL; this.attrLocked = false; return D3D_OK; }

  /** The face index list as a typed view over the buffer shadow (3 entries per face). */
  indices(): Uint16Array | Uint32Array {
    const c = this.ib.cpu;
    return this.is32 ? new Uint32Array(c.buffer, c.byteOffset, this.numFaces * 3) : new Uint16Array(c.buffer, c.byteOffset, this.numFaces * 3);
  }

  /** `GetAttributeTable(NULL, &n)` + `GetAttributeTable(table, &n)`: empty until the mesh was attribute-sorted. */
  GetAttributeTable(): D3DXAttributeRange[] { return (this.attributeTable ?? []).map((r) => ({ ...r })); }
  SetAttributeTable(table: readonly D3DXAttributeRange[] | null): number { this.attributeTable = table && table.length ? table.map((r) => ({ ...r })) : null; return D3D_OK; }

  /** Face adjacency: 3 neighbours per face (edge i = vertices i, i+1), 0xFFFFFFFF = none.  Vertices match when their positions are within `epsilon`. */
  GenerateAdjacency(epsilon: number): Uint32Array {
    const idx = this.indices(), vcpu = this.vb.cpu, dv = new DataView(vcpu.buffer, vcpu.byteOffset, vcpu.byteLength);
    const pos = (v: number): [number, number, number] => [dv.getFloat32(v * this.stride, true), dv.getFloat32(v * this.stride + 4, true), dv.getFloat32(v * this.stride + 8, true)];
    // canonical id per position (positions within epsilon share an id)
    const canon = new Uint32Array(this.numVertices);
    const buckets = new Map<string, number[]>();
    const q = Math.max(epsilon, 1e-9);
    for (let v = 0; v < this.numVertices; v++) {
      const p = pos(v);
      const cell = (a: number): number => Math.floor(a / (q * 2));
      let found = -1;
      for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
        const list = buckets.get(`${cell(p[0]) + dx},${cell(p[1]) + dy},${cell(p[2]) + dz}`);
        if (!list) continue;
        for (const u of list) {
          const o = pos(u);
          if (Math.abs(o[0] - p[0]) <= epsilon && Math.abs(o[1] - p[1]) <= epsilon && Math.abs(o[2] - p[2]) <= epsilon) { found = canon[u]!; break; }
        }
      }
      canon[v] = found >= 0 ? found : v;
      const key = `${cell(p[0])},${cell(p[1])},${cell(p[2])}`;
      const l = buckets.get(key); if (l) l.push(v); else buckets.set(key, [v]);
    }
    const adj = new Uint32Array(this.numFaces * 3).fill(NO_NEIGHBOUR);
    const edges = new Map<string, number[]>(); // "a,b" (directed) -> edge ids f*3+e
    for (let f = 0; f < this.numFaces; f++) for (let e = 0; e < 3; e++) {
      const a = canon[idx[f * 3 + e]!]!, b = canon[idx[f * 3 + (e + 1) % 3]!]!;
      if (a === b) continue;
      const key = `${a},${b}`;
      const l = edges.get(key); if (l) l.push(f * 3 + e); else edges.set(key, [f * 3 + e]);
    }
    for (let f = 0; f < this.numFaces; f++) for (let e = 0; e < 3; e++) {
      const a = canon[idx[f * 3 + e]!]!, b = canon[idx[f * 3 + (e + 1) % 3]!]!;
      const opp = edges.get(`${b},${a}`);
      if (!opp) continue;
      const other = opp.find((id) => Math.floor(id / 3) !== f);
      if (other !== undefined) adj[f * 3 + e] = Math.floor(other / 3);
    }
    return adj;
  }

  /** `DrawSubset`: the faces with the given attribute (one draw per attribute-table entry, or per contiguous run of an unsorted mesh). */
  DrawSubset(attribId: number): number {
    const d = this.device;
    d.SetFVF(this.fvf);
    d.SetStreamSource(0, this.vb, 0, this.stride);
    d.SetIndices(this.ib);
    const draw = (faceStart: number, faceCount: number, vStart: number, vCount: number): void => {
      if (faceCount > 0) d.DrawIndexedPrimitive(D3DPT.TRIANGLELIST, 0, vStart, vCount, faceStart * 3, faceCount);
    };
    if (this.attributeTable) {
      for (const r of this.attributeTable) if (r.AttribId === attribId) draw(r.FaceStart, r.FaceCount, r.VertexStart, r.VertexCount);
      return D3D_OK;
    }
    let f = 0;
    while (f < this.numFaces) {
      if (this.attributeBuffer[f] !== attribId) { f++; continue; }
      const start = f;
      while (f < this.numFaces && this.attributeBuffer[f] === attribId) f++;
      draw(start, f - start, 0, this.numVertices);
    }
    return D3D_OK;
  }

  // --- cloning --------------------------------------------------------------------------------------------------------
  CloneMeshFVF(options: number, fvf: number, device: Direct3DDevice9 = this.device): { hr: number; mesh: D3DXMesh | null } {
    const dst = D3DXCreateMeshFVF(this.numFaces, this.numVertices, options, fvf, device);
    if (dst.hr < 0 || !dst.mesh) return dst;
    const out = dst.mesh;
    convertVertices(this.vb.cpu, this.fvf, out.vb.cpu, fvf, this.numVertices);
    out.vb.markDirty(0, out.vb.length);
    const src = this.indices(), di = out.indices();
    for (let i = 0; i < src.length; i++) di[i] = src[i]!;
    out.ib.markDirty(0, out.ib.length);
    out.attributeBuffer.set(this.attributeBuffer);
    out.attributeTable = this.attributeTable ? this.attributeTable.map((r) => ({ ...r })) : null;
    return { hr: D3D_OK, mesh: out };
  }

  CloneMesh(options: number, declaration: readonly VertexElement[], device: Direct3DDevice9 = this.device): { hr: number; mesh: D3DXMesh | null } {
    const fvf = declarationToFvf(declaration);
    if (fvf === null) return { hr: D3DERR_INVALIDCALL, mesh: null };
    return this.CloneMeshFVF(options, fvf, device);
  }

  // --- optimisation ---------------------------------------------------------------------------------------------------
  /** Reorder faces / renumber vertices; returns the new data without touching this mesh. */
  private optimizeData(flags: number): { indices: Uint32Array; vertexRemap: Uint32Array; faceRemap: Uint32Array; attributes: Uint32Array; table: D3DXAttributeRange[] | null } {
    const nF = this.numFaces, src = this.indices(), attrs = this.attributeBuffer;
    const faceRemap = Uint32Array.from({ length: nF }, (_, i) => i);
    if (flags & D3DXMESHOPT.ATTRSORT) faceRemap.sort((a, b) => attrs[a]! - attrs[b]! || a - b);
    const attributes = new Uint32Array(nF);
    for (let i = 0; i < nF; i++) attributes[i] = attrs[faceRemap[i]!]!;
    const indices = new Uint32Array(nF * 3);
    const vertexRemap: number[] = [];
    const split = (flags & D3DXMESHOPT.ATTRSORT) !== 0 && (flags & D3DXMESHOPT.DONOTSPLIT) === 0 && (flags & D3DXMESHOPT.IGNOREVERTS) === 0;
    if (flags & D3DXMESHOPT.IGNOREVERTS) {
      for (let i = 0; i < nF; i++) for (let c = 0; c < 3; c++) indices[i * 3 + c] = src[faceRemap[i]! * 3 + c]!;
      for (let v = 0; v < this.numVertices; v++) vertexRemap.push(v);
    } else if (split) {
      let i = 0;
      while (i < nF) {
        let j = i; while (j < nF && attributes[j] === attributes[i]) j++;
        const local = new Map<number, number>();
        for (let f = i; f < j; f++) for (let c = 0; c < 3; c++) {
          const old = src[faceRemap[f]! * 3 + c]!;
          let nv = local.get(old);
          if (nv === undefined) { nv = vertexRemap.length; vertexRemap.push(old); local.set(old, nv); }
          indices[f * 3 + c] = nv;
        }
        i = j;
      }
    } else if (flags & (D3DXMESHOPT.COMPACT | D3DXMESHOPT.VERTEXCACHE)) {
      const map = new Map<number, number>();
      if (flags & D3DXMESHOPT.VERTEXCACHE) {
        for (let f = 0; f < nF; f++) for (let c = 0; c < 3; c++) {
          const old = src[faceRemap[f]! * 3 + c]!;
          let nv = map.get(old);
          if (nv === undefined) { nv = vertexRemap.length; vertexRemap.push(old); map.set(old, nv); }
          indices[f * 3 + c] = nv;
        }
      } else {
        const used = new Uint8Array(this.numVertices);
        for (let f = 0; f < nF; f++) for (let c = 0; c < 3; c++) used[src[f * 3 + c]!] = 1;
        for (let v = 0; v < this.numVertices; v++) if (used[v]) { map.set(v, vertexRemap.length); vertexRemap.push(v); }
        for (let f = 0; f < nF; f++) for (let c = 0; c < 3; c++) indices[f * 3 + c] = map.get(src[faceRemap[f]! * 3 + c]!)!;
      }
    } else {
      for (let i = 0; i < nF; i++) for (let c = 0; c < 3; c++) indices[i * 3 + c] = src[faceRemap[i]! * 3 + c]!;
      for (let v = 0; v < this.numVertices; v++) vertexRemap.push(v);
    }
    let table: D3DXAttributeRange[] | null = null;
    if (flags & D3DXMESHOPT.ATTRSORT) {
      table = [];
      let i = 0;
      while (i < nF) {
        let j = i; while (j < nF && attributes[j] === attributes[i]) j++;
        let lo = Infinity, hi = -1;
        for (let k = i * 3; k < j * 3; k++) { lo = Math.min(lo, indices[k]!); hi = Math.max(hi, indices[k]!); }
        table.push({ AttribId: attributes[i]!, FaceStart: i, FaceCount: j - i, VertexStart: lo, VertexCount: hi - lo + 1 });
        i = j;
      }
    }
    return { indices, vertexRemap: Uint32Array.from(vertexRemap), faceRemap, attributes, table };
  }

  /** `Optimize`: the D3DXMESH_* bits of `flags` (like the exe's 0x6000220 = ATTRSORT | VERTEXCACHE | MANAGED) describe the new mesh. */
  Optimize(flags: number, _adjacencyIn: Uint32Array | null): OptimizeResult & { mesh: D3DXMesh | null } {
    const options = (flags & 0x3ffff) || this.options;
    const r = this.optimizeData(flags);
    const nV = r.vertexRemap.length;
    const created = D3DXCreateMeshFVF(this.numFaces, nV, (options & ~D3DXMESH._32BIT) | (this.is32 || nV > 0xffff ? D3DXMESH._32BIT : 0), this.fvf, this.device);
    if (created.hr < 0 || !created.mesh) return { hr: created.hr, mesh: null, adjacencyOut: null, faceRemap: null, vertexRemap: null };
    const m = created.mesh;
    const vs = this.vb.cpu, vd = m.vb.cpu, st = this.stride;
    for (let n = 0; n < nV; n++) vd.set(vs.subarray(r.vertexRemap[n]! * st, r.vertexRemap[n]! * st + st), n * st);
    m.vb.markDirty(0, m.vb.length);
    const di = m.indices();
    for (let i = 0; i < r.indices.length; i++) di[i] = r.indices[i]!;
    m.ib.markDirty(0, m.ib.length);
    m.attributeBuffer.set(r.attributes);
    m.attributeTable = r.table;
    return { hr: D3D_OK, mesh: m, adjacencyOut: m.GenerateAdjacency(0), faceRemap: r.faceRemap, vertexRemap: r.vertexRemap };
  }

  /** In place: the vertex buffer is rewritten (and reallocated when the vertex count grows through splitting, which D3DX forbids in place). */
  OptimizeInplace(flags: number, _adjacencyIn: Uint32Array | null): OptimizeResult {
    const r = this.optimizeData(flags | D3DXMESHOPT.DONOTSPLIT);
    const nV = r.vertexRemap.length;
    if (nV > this.numVertices) return { hr: E_FAIL, adjacencyOut: null, faceRemap: null, vertexRemap: null };
    const st = this.stride, vs = this.vb.cpu.slice();
    for (let n = 0; n < nV; n++) this.vb.cpu.set(vs.subarray(r.vertexRemap[n]! * st, r.vertexRemap[n]! * st + st), n * st);
    this.vb.markDirty(0, this.vb.length);
    const di = this.indices();
    for (let i = 0; i < r.indices.length; i++) di[i] = r.indices[i]!;
    this.ib.markDirty(0, this.ib.length);
    this.attributeBuffer.set(r.attributes);
    this.attributeTable = r.table;
    return { hr: D3D_OK, adjacencyOut: this.GenerateAdjacency(0), faceRemap: r.faceRemap, vertexRemap: r.vertexRemap };
  }

  Release(): number { this.vb.Release(); return this.ib.Release(); }
}

// ------------------------------------------------------------------------------------------------------- creation
export function D3DXCreateMeshFVF(numFaces: number, numVertices: number, options: number, fvf: number, device: Direct3DDevice9): { hr: number; mesh: D3DXMesh | null } {
  if (numFaces <= 0 || numVertices <= 0) return { hr: D3DERR_INVALIDCALL, mesh: null };
  const stride = fvfVertexSize(fvf);
  if (stride === 0) return { hr: D3DERR_INVALIDCALL, mesh: null };
  const is32 = (options & D3DXMESH._32BIT) !== 0;
  if (!is32 && numVertices > 0xffff) return { hr: D3DERR_INVALIDCALL, mesh: null };
  const usageV = (options & D3DXMESH.VB_DYNAMIC ? D3DUSAGE.DYNAMIC : 0) | (options & D3DXMESH.VB_WRITEONLY ? D3DUSAGE.WRITEONLY : 0);
  const usageI = (options & D3DXMESH.IB_DYNAMIC ? D3DUSAGE.DYNAMIC : 0) | (options & D3DXMESH.IB_WRITEONLY ? D3DUSAGE.WRITEONLY : 0);
  const vbr = device.CreateVertexBuffer(numVertices * stride, usageV, fvf, poolOf(options, D3DXMESH.VB_MANAGED | D3DXMESH.VB_SYSTEMMEM, D3DXMESH.VB_SYSTEMMEM));
  if (vbr.hr < 0 || !vbr.vb) return { hr: vbr.hr, mesh: null };
  const ibr = device.CreateIndexBuffer(numFaces * 3 * (is32 ? 4 : 2), usageI, is32 ? D3DFMT.INDEX32 : D3DFMT.INDEX16, poolOf(options, D3DXMESH.IB_MANAGED | D3DXMESH.IB_SYSTEMMEM, D3DXMESH.IB_SYSTEMMEM));
  if (ibr.hr < 0 || !ibr.ib) return { hr: ibr.hr, mesh: null };
  return { hr: D3D_OK, mesh: new D3DXMesh(device, numFaces, numVertices, options, fvf, vbr.vb, ibr.ib, new Uint32Array(numFaces)) };
}

/** D3DFVF code for a declaration made of the standard FVF elements (what CloneMesh needs here); null for anything else. */
export function declarationToFvf(decl: readonly VertexElement[]): number | null {
  let fvf = 0, tex = 0;
  for (const e of decl) {
    if (e.stream === 0xff) break;
    switch (e.usage) {
      case D3DDECLUSAGE.POSITION: fvf |= 0x002; break;
      case D3DDECLUSAGE.POSITIONT: fvf |= 0x004; break;
      case D3DDECLUSAGE.NORMAL: fvf |= 0x010; break;
      case D3DDECLUSAGE.PSIZE: fvf |= 0x020; break;
      case D3DDECLUSAGE.COLOR: fvf |= e.usageIndex === 0 ? 0x040 : 0x080; break;
      case D3DDECLUSAGE.TEXCOORD: tex = Math.max(tex, e.usageIndex + 1); break;
      default: return null;
    }
  }
  return fvf | (tex << 8);
}

/** Copy vertices between two FVF layouts: elements present in both are copied (float components up to the smaller size), new ones are zero. */
export function convertVertices(src: Uint8Array, srcFvf: number, dst: Uint8Array, dstFvf: number, count: number): void {
  const a = fvfToElements(srcFvf), b = fvfToElements(dstFvf);
  const plan = b.elements.map((de) => {
    const se = a.elements.find((e) => e.usage === de.usage && e.usageIndex === de.usageIndex);
    return { de, se };
  });
  for (let v = 0; v < count; v++) {
    for (const { de, se } of plan) {
      if (!se) continue;
      const dsz = declSize(de.type), ssz = declSize(se.type);
      if (de.type === se.type) dst.set(src.subarray(v * a.stride + se.offset, v * a.stride + se.offset + ssz), v * b.stride + de.offset);
      else {
        const n = Math.min(dsz, ssz);
        dst.set(src.subarray(v * a.stride + se.offset, v * a.stride + se.offset + n), v * b.stride + de.offset);
      }
    }
  }
}
function declSize(t: number): number {
  switch (t) {
    case D3DDECLTYPE.FLOAT1: return 4; case D3DDECLTYPE.FLOAT2: return 8; case D3DDECLTYPE.FLOAT3: return 12; case D3DDECLTYPE.FLOAT4: return 16;
    default: return 4;
  }
}

// --------------------------------------------------------------------------------------------------- X file loading
const IDENTITY: Mat4 = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

interface FlatMesh { data: XMeshData; world: Mat4 }

function flatten(scene: XScene): FlatMesh[] {
  const out: FlatMesh[] = [];
  const worlds = new Map<object, Mat4>();
  walkFrames(scene.frames, (f, parent) => {
    const w = matMultiply(f.matrix, parent ? worlds.get(parent)! : IDENTITY);
    worlds.set(f, w);
    for (const m of f.meshes) out.push({ data: m, world: w });
  });
  return out;
}

/** The mesh and its materials from an already parsed scene (what D3DXLoadMeshFromXInMemory returns, see the file header). */
export function D3DXLoadMeshFromXScene(scene: XScene, options: number, device: Direct3DDevice9): { hr: number; mesh: D3DXMesh | null; adjacency: Uint32Array | null; materials: D3DXMaterial[] } {
  const meshes = flatten(scene).filter((m) => m.data.faces.length > 0 && m.data.positions.length > 0);
  if (meshes.length === 0) return { hr: D3DXERR_INVALIDDATA, mesh: null, adjacency: null, materials: [] };
  const anyNormals = meshes.some((m) => m.data.normals), anyTex = meshes.some((m) => m.data.texCoords), anyColor = meshes.some((m) => m.data.vertexColors);
  const fvf = 0x002 | (anyNormals ? 0x010 : 0) | (anyColor ? 0x040 : 0) | (anyTex ? 0x100 : 0);
  const stride = fvfVertexSize(fvf);
  const oN = 12, oC = 12 + (anyNormals ? 12 : 0), oT = oC + (anyColor ? 4 : 0);

  const vertexBytes: Uint8Array[] = [];
  const faceIdx: number[] = [], faceAttr: number[] = [];
  const materials: D3DXMaterial[] = [];
  let vertexBase = 0;
  for (const { data: m, world } of meshes) {
    const nV = m.positions.length / 3;
    const base = vertexBase;
    const verts: Uint8Array[] = new Array(nV);
    const make = (pi: number, ni: number): Uint8Array => {
      const b = new Uint8Array(stride), dv = new DataView(b.buffer);
      const p = vec3TransformCoord({ x: m.positions[pi * 3]!, y: m.positions[pi * 3 + 1]!, z: m.positions[pi * 3 + 2]! }, world);
      dv.setFloat32(0, p.x, true); dv.setFloat32(4, p.y, true); dv.setFloat32(8, p.z, true);
      if (anyNormals && m.normals && ni >= 0) {
        let n: Vec3 = vec3TransformNormal({ x: m.normals[ni * 3]!, y: m.normals[ni * 3 + 1]!, z: m.normals[ni * 3 + 2]! }, world);
        const len = Math.hypot(n.x, n.y, n.z);
        if (len > 0) n = { x: n.x / len, y: n.y / len, z: n.z / len };
        dv.setFloat32(oN, n.x, true); dv.setFloat32(oN + 4, n.y, true); dv.setFloat32(oN + 8, n.z, true);
      }
      if (anyColor) {
        const c = m.vertexColors ? [m.vertexColors[pi * 4]!, m.vertexColors[pi * 4 + 1]!, m.vertexColors[pi * 4 + 2]!, m.vertexColors[pi * 4 + 3]!] : [1, 1, 1, 1];
        const q = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));
        dv.setUint32(oC, ((q(c[3]!) << 24) | (q(c[0]!) << 16) | (q(c[1]!) << 8) | q(c[2]!)) >>> 0, true);
      }
      if (anyTex && m.texCoords) { dv.setFloat32(oT, m.texCoords[pi * 2]!, true); dv.setFloat32(oT + 4, m.texCoords[pi * 2 + 1]!, true); }
      return b;
    };
    // vertex i keeps its index; it takes the normal of the first corner using it, later corners with another normal add vertices
    const firstNormal = new Int32Array(nV).fill(-2);
    m.faces.forEach((face, fi) => face.forEach((pi, c) => { if (firstNormal[pi] === -2) firstNormal[pi] = m.normalFaces ? m.normalFaces[fi]![c]! : -1; }));
    for (let v = 0; v < nV; v++) verts[v] = make(v, firstNormal[v] === -2 ? -1 : firstNormal[v]!);
    const extra = new Map<string, number>();
    const extras: Uint8Array[] = [];
    const cornerVertex = (fi: number, c: number): number => {
      const pi = m.faces[fi]![c]!;
      const ni = m.normalFaces ? m.normalFaces[fi]![c]! : -1;
      if (ni === firstNormal[pi]) return base + pi;
      const key = `${pi}/${ni}`;
      let id = extra.get(key);
      if (id === undefined) { id = base + nV + extras.length; extras.push(make(pi, ni)); extra.set(key, id); }
      return id;
    };
    const matBase = materials.length;
    m.faces.forEach((face, fi) => {
      for (let k = 1; k + 1 < face.length; k++) { // fan triangulation
        faceIdx.push(cornerVertex(fi, 0), cornerVertex(fi, k), cornerVertex(fi, k + 1));
        faceAttr.push(matBase + (m.faceMaterial[fi] ?? 0));
      }
    });
    for (const mat of m.materials) materials.push({
      MatD3D: {
        diffuse: { r: mat.diffuse[0], g: mat.diffuse[1], b: mat.diffuse[2], a: mat.diffuse[3] }, ambient: { r: mat.diffuse[0], g: mat.diffuse[1], b: mat.diffuse[2], a: mat.diffuse[3] },
        specular: { r: mat.specular[0], g: mat.specular[1], b: mat.specular[2], a: 1 }, emissive: { r: mat.emissive[0], g: mat.emissive[1], b: mat.emissive[2], a: 1 }, power: mat.power,
      },
      pTextureFilename: mat.textureFilename,
    });
    vertexBytes.push(...verts, ...extras);
    vertexBase += nV + extras.length;
  }
  const nF = faceIdx.length / 3;
  const want32 = (options & D3DXMESH._32BIT) !== 0 || vertexBase > 0xffff;
  const created = D3DXCreateMeshFVF(nF, vertexBase, want32 ? options | D3DXMESH._32BIT : options, fvf, device);
  if (created.hr < 0 || !created.mesh) return { hr: created.hr, mesh: null, adjacency: null, materials: [] };
  const mesh = created.mesh;
  vertexBytes.forEach((b, i) => mesh.vb.cpu.set(b, i * stride));
  mesh.vb.markDirty(0, mesh.vb.length);
  const di = mesh.indices();
  for (let i = 0; i < faceIdx.length; i++) di[i] = faceIdx[i]!;
  mesh.ib.markDirty(0, mesh.ib.length);
  mesh.attributeBuffer.set(faceAttr);
  return { hr: D3D_OK, mesh, adjacency: mesh.GenerateAdjacency(0), materials };
}

/** `D3DXLoadMeshFromXInMemory`. */
export function D3DXLoadMeshFromXInMemory(data: Uint8Array, options: number, device: Direct3DDevice9): { hr: number; mesh: D3DXMesh | null; adjacency: Uint32Array | null; materials: D3DXMaterial[] } {
  let scene: XScene;
  try { scene = loadXScene(data); } catch { return { hr: D3DXERR_INVALIDDATA, mesh: null, adjacency: null, materials: [] }; }
  return D3DXLoadMeshFromXScene(scene, options, device);
}

// -------------------------------------------------------------------------------------------------------- welding
/** `D3DXWeldVertices` on an FVF mesh, in place.  Returns the vertex remap (new vertex -> old vertex) and the new adjacency. */
export function D3DXWeldVertices(mesh: D3DXMesh, flags: number, eps: D3DXWeldEpsilons, _adjacencyIn: Uint32Array | null): { hr: number; adjacencyOut: Uint32Array | null; faceRemap: Uint32Array | null; vertexRemap: Uint32Array | null } {
  const { elements, stride } = fvfToElements(mesh.fvf);
  const dv = new DataView(mesh.vb.cpu.buffer, mesh.vb.cpu.byteOffset, mesh.vb.cpu.byteLength);
  const nV = mesh.numVertices;
  const tolFor = (e: VertexElement): number => {
    switch (e.usage) {
      case D3DDECLUSAGE.POSITION: return eps.Position;
      case D3DDECLUSAGE.BLENDWEIGHT: return eps.BlendWeights;
      case D3DDECLUSAGE.NORMAL: return eps.Normal;
      case D3DDECLUSAGE.PSIZE: return eps.PSize;
      case D3DDECLUSAGE.COLOR: return e.usageIndex === 0 ? eps.Diffuse : eps.Specular;
      case D3DDECLUSAGE.TEXCOORD: return eps.Texcoord[e.usageIndex] ?? 0;
      default: return 0;
    }
  };
  const same = (a: number, b: number): boolean => {
    for (const e of elements) {
      const tol = tolFor(e), n = e.type === D3DDECLTYPE.FLOAT1 ? 1 : e.type === D3DDECLTYPE.FLOAT2 ? 2 : e.type === D3DDECLTYPE.FLOAT3 ? 3 : e.type === D3DDECLTYPE.FLOAT4 ? 4 : 0;
      if (n === 0) { if (dv.getUint32(a * stride + e.offset, true) !== dv.getUint32(b * stride + e.offset, true)) return false; continue; }
      for (let k = 0; k < n; k++) if (Math.abs(dv.getFloat32(a * stride + e.offset + k * 4, true) - dv.getFloat32(b * stride + e.offset + k * 4, true)) > tol) return false;
    }
    return true;
  };
  // vertices can only be welded within one attribute group unless the mesh has no attributes besides 0 (D3DX never merges across materials)
  const idx = mesh.indices();
  const groupOf = new Int32Array(nV).fill(-1);
  const multi = new Set<number>();
  for (let f = 0; f < mesh.numFaces; f++) for (let c = 0; c < 3; c++) {
    const v = idx[f * 3 + c]!;
    if (groupOf[v] === -1) groupOf[v] = mesh.attributeBuffer[f]!;
    else if (groupOf[v] !== mesh.attributeBuffer[f]) multi.add(v);
  }
  // exact path: bucket by raw bytes; tolerant path: compare against earlier representatives in the same spatial cell
  const useBytes = eps.Position === 0 && eps.BlendWeights === 0 && eps.Normal === 0 && eps.PSize === 0 && eps.Specular === 0 && eps.Diffuse === 0 && eps.Texcoord.every((t) => t === 0) && eps.Tangent === 0 && eps.Binormal === 0 && eps.TessFactor === 0;
  const rep = new Int32Array(nV).fill(-1);
  const keep: number[] = [];
  const newIndex = new Int32Array(nV);
  const buckets = new Map<string, number[]>();
  for (let v = 0; v < nV; v++) {
    const bytes = mesh.vb.cpu.subarray(v * stride, v * stride + stride);
    let key: string;
    if (useBytes) key = Buffer.from(bytes).toString("latin1");
    else { const q = Math.max(eps.Position, 1e-6) * 4; key = `${Math.floor(dv.getFloat32(v * stride, true) / q)},${Math.floor(dv.getFloat32(v * stride + 4, true) / q)},${Math.floor(dv.getFloat32(v * stride + 8, true) / q)}`; }
    key += `|${multi.has(v) ? "m" : groupOf[v]}`;
    const list = buckets.get(key);
    let found = -1;
    if (list) for (const u of list) if (useBytes || same(u, v)) { found = u; break; }
    if (found >= 0) { rep[v] = found; newIndex[v] = newIndex[found]!; }
    else { rep[v] = v; newIndex[v] = keep.length; keep.push(v); if (list) list.push(v); else buckets.set(key, [v]); }
  }
  if (keep.length === nV) return { hr: D3D_OK, adjacencyOut: mesh.GenerateAdjacency(0), faceRemap: Uint32Array.from({ length: mesh.numFaces }, (_, i) => i), vertexRemap: Uint32Array.from({ length: nV }, (_, i) => i) };
  void flags;
  // rebuild the mesh buffers: D3DX keeps the vertex count of the object, the vertex data is compacted in place
  const copy = mesh.vb.cpu.slice();
  keep.forEach((old, n) => mesh.vb.cpu.set(copy.subarray(old * stride, old * stride + stride), n * stride));
  mesh.vb.markDirty(0, mesh.vb.length);
  for (let i = 0; i < idx.length; i++) idx[i] = newIndex[idx[i]!]!;
  mesh.ib.markDirty(0, mesh.ib.length);
  (mesh as { numVertices: number }).numVertices = keep.length;
  mesh.attributeTable = null;
  return { hr: D3D_OK, adjacencyOut: mesh.GenerateAdjacency(0), faceRemap: Uint32Array.from({ length: mesh.numFaces }, (_, i) => i), vertexRemap: Uint32Array.from(keep) };
}

// ---------------------------------------------------------------------------------------------- geometry queries
/** `D3DXComputeBoundingSphere`: centroid of the positions and the largest distance from it (as in Wine's d3dx9_36; single-precision steps). */
export function D3DXComputeBoundingSphere(data: Uint8Array, byteOffset: number, numVertices: number, stride: number): { hr: number; center: Vec3; radius: number } {
  if (numVertices <= 0) return { hr: D3D_OK, center: { x: NaN, y: NaN, z: NaN }, radius: 0 };
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const f = Math.fround;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < numVertices; i++) {
    const o = byteOffset + i * stride;
    sx = f(sx + dv.getFloat32(o, true)); sy = f(sy + dv.getFloat32(o + 4, true)); sz = f(sz + dv.getFloat32(o + 8, true));
  }
  const inv = f(1 / numVertices);
  const center = { x: f(sx * inv), y: f(sy * inv), z: f(sz * inv) };
  let radius = 0;
  for (let i = 0; i < numVertices; i++) {
    const o = byteOffset + i * stride;
    const dx = f(dv.getFloat32(o, true) - center.x), dy = f(dv.getFloat32(o + 4, true) - center.y), dz = f(dv.getFloat32(o + 8, true) - center.z);
    const d = f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))));
    if (d > radius) radius = d;
  }
  return { hr: D3D_OK, center, radius };
}

export interface IntersectInfo { FaceIndex: number; U: number; V: number; Dist: number }

/** `D3DXIntersect`: closest hit of a ray with the mesh's triangles; `U`/`V` are the barycentric weights of the 2nd and 3rd vertex. */
export function D3DXIntersect(mesh: D3DXMesh, rayPos: Vec3, rayDir: Vec3): { hr: number; hit: boolean; faceIndex: number; u: number; v: number; dist: number; allHits: IntersectInfo[] } {
  const idx = mesh.indices(), st = mesh.GetNumBytesPerVertex();
  const cpu = mesh.vb.cpu, dv = new DataView(cpu.buffer, cpu.byteOffset, cpu.byteLength);
  const P = (v: number): Vec3 => ({ x: dv.getFloat32(v * st, true), y: dv.getFloat32(v * st + 4, true), z: dv.getFloat32(v * st + 8, true) });
  const hits: IntersectInfo[] = [];
  for (let f = 0; f < mesh.numFaces; f++) {
    const v0 = P(idx[f * 3]!), v1 = P(idx[f * 3 + 1]!), v2 = P(idx[f * 3 + 2]!);
    const e1 = { x: v1.x - v0.x, y: v1.y - v0.y, z: v1.z - v0.z }, e2 = { x: v2.x - v0.x, y: v2.y - v0.y, z: v2.z - v0.z };
    const pv = { x: rayDir.y * e2.z - rayDir.z * e2.y, y: rayDir.z * e2.x - rayDir.x * e2.z, z: rayDir.x * e2.y - rayDir.y * e2.x };
    const det = e1.x * pv.x + e1.y * pv.y + e1.z * pv.z;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const t = { x: rayPos.x - v0.x, y: rayPos.y - v0.y, z: rayPos.z - v0.z };
    const u = (t.x * pv.x + t.y * pv.y + t.z * pv.z) * inv;
    if (u < 0 || u > 1) continue;
    const q = { x: t.y * e1.z - t.z * e1.y, y: t.z * e1.x - t.x * e1.z, z: t.x * e1.y - t.y * e1.x };
    const v = (rayDir.x * q.x + rayDir.y * q.y + rayDir.z * q.z) * inv;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2.x * q.x + e2.y * q.y + e2.z * q.z) * inv;
    if (dist < 0) continue;
    hits.push({ FaceIndex: f, U: u, V: v, Dist: dist });
  }
  if (hits.length === 0) return { hr: D3D_OK, hit: false, faceIndex: 0xffffffff, u: 0, v: 0, dist: 0, allHits: [] };
  const best = hits.reduce((a, b) => (b.Dist < a.Dist ? b : a));
  return { hr: D3D_OK, hit: true, faceIndex: best.FaceIndex, u: best.U, v: best.V, dist: best.Dist, allHits: hits.sort((a, b) => a.Dist - b.Dist) };
}
