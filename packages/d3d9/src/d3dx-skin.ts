/**
 * Frame hierarchies and skinning: `D3DXLoadMeshHierarchyFromXInMemory` with the `ID3DXAllocateHierarchy` callbacks, `D3DXFrame*`, `ID3DXSkinInfo` and
 * `ConvertToIndexedBlendedMesh` - what CKTDXDeviceXSkinMesh uses (x2.exe.c L428783 `CMultiAnimAllocateHierarchy::CreateFrame`, L428910 `CreateMeshContainer`,
 * L429352 `LoadD3DXSkinnedMesh`, L428426 `MultiAnimMC::ConvertToSkinnedMesh`).
 *
 * The exe's allocator (the DirectX SDK "MultiAnimation" sample, adapted) takes the loaded `ID3DXMesh`, the materials, the adjacency and the skin info as D3DX
 * produced them, then asks the skin info for the bone count, `GetBoneName` (to find the bone frames with `D3DXFrameFind`) and `GetBoneOffsetMatrix`; later it runs
 * `pSkinInfo->ConvertToIndexedBlendedMesh(mesh, MANAGED, paletteSize <= 20, ...)`, clones the result to FVF 4380 (XYZB4 | LASTBETA_UBYTE4 | NORMAL | TEX1),
 * rewrites BLENDINDICES as D3DCOLOR and calls `UpdateSemantics`.  The loader also returns an animation controller (2 tracks, 30 events) with every
 * `AnimationSet` of the file registered and the named frame matrices registered as outputs.
 *
 * Checked against Wine's d3dx9 tests (which also pass on native Windows, FINDINGS 12.3): `D3DXFrameFind` is breadth first (it matters for the two files that repeat a bone name); an unnamed `Frame` /
 * `Mesh` is passed to the allocator as `""`, the frame D3DX makes around a top-level Mesh and the extra root over several top-level frames have a NULL name; no frame is `E_FAIL`; no `AnimationSet`
 * means no controller; `UpdateSkinnedMesh` ignores the stored offset matrices.  Choices without an oracle (FINDINGS 12.5): X rotation keys (w, x, y, z) become D3DXQUATERNION (-x, -y, -z, w) (decided on the data: for 323 informative frames the first key equals the rest
 * pose only in this form, 0 as stored); matrix keys are decomposed into scale / rotation / translation (as `ID3DXKeyframedAnimationSet` only holds SRT keys); the
 * animation sets are LOOP sets with `AnimTicksPerSecond` (default 4800).  `ConvertToIndexedBlendedMesh` produces a valid palette partition (faces of one material
 * packed greedily into combinations whose bone set fits the palette, vertices duplicated per combination, weights normalised, slots in ascending bone order); D3DX's own
 * packing order is not reproduced, so combination and vertex order can differ while every triangle gets the same bones and weights.
 */
import { loadXScene } from "@els/assets";
import type { XFrameData, XMeshData, XScene } from "@els/assets";
import { D3DDECLTYPE, D3DDECLUSAGE } from "./enums.ts";
import { D3DERR_INVALIDCALL, D3DXERR_INVALIDDATA, D3D_OK, E_FAIL, E_NOTIMPL } from "./hresult.ts";
import { D3DXAnimationController, D3DXCreateAnimationController, D3DXCreateKeyframedAnimationSet, D3DXPLAY } from "./d3dx-animation.ts";
import type { D3DXKeyQuaternion, D3DXKeyVector3 } from "./d3dx-animation.ts";
import { D3DXBuildMesh, D3DXCreateMeshFVF, D3DXMESH } from "./d3dx-mesh.ts";
import type { D3DXMaterial, D3DXMesh } from "./d3dx-mesh.ts";
import { matDecompose, matIdentity, matMultiply, vec3TransformCoord } from "./d3dx-math.ts";
import type { Mat4, Vec3 } from "./d3dx-math.ts";
import { fvfToElements, fvfVertexSize } from "./vertex.ts";
import type { VertexElement } from "./vertex.ts";
import type { Direct3DDevice9 } from "./device.ts";

/** D3DXMESHTYPE_MESH */
export const D3DXMESHTYPE = { MESH: 0x001, PMESH: 0x002, PATCHMESH: 0x003 } as const;
const UNUSED_BONE = 0xffffffff;
/** Four palette indices fit the UBYTE4 of an indexed-blend vertex; a vertex with more influences keeps its four strongest (weights renormalised). */
const MAX_INDEXED_INFLUENCES = 4;

// ---------------------------------------------------------------------------------------------------------- frames
export interface D3DXMeshContainer {
  Name: string | null;
  MeshData: { Type: number; pMesh: D3DXMesh | null };
  pMaterials: D3DXMaterial[];
  pEffects: null;
  NumMaterials: number;
  pAdjacency: Uint32Array | null;
  pSkinInfo: D3DXSkinInfo | null;
  pNextMeshContainer: D3DXMeshContainer | null;
}
export interface D3DXFrame {
  Name: string | null;
  TransformationMatrix: Float32Array;
  pMeshContainer: D3DXMeshContainer | null;
  pFrameSibling: D3DXFrame | null;
  pFrameFirstChild: D3DXFrame | null;
}
/** ID3DXAllocateHierarchy: the application creates (and destroys) the frames and mesh containers, usually as subclasses with extra members. */
export interface ID3DXAllocateHierarchy {
  CreateFrame(name: string | null): { hr: number; frame: D3DXFrame | null };
  CreateMeshContainer(name: string | null, meshData: { Type: number; pMesh: D3DXMesh }, materials: D3DXMaterial[], effectInstances: null, numMaterials: number, adjacency: Uint32Array, skinInfo: D3DXSkinInfo | null): { hr: number; container: D3DXMeshContainer | null };
  DestroyFrame(frame: D3DXFrame): number;
  DestroyMeshContainer(container: D3DXMeshContainer): number;
}

/**
 * `D3DXFrameFind`: breadth first - the sibling chain of `root` is checked in order, then the child chains of those frames, first frame first (Wine's implementation, which
 * its tests run against native d3dx9; a frame with no name matches `name === null`).
 */
export function D3DXFrameFind(root: D3DXFrame | null, name: string | null): D3DXFrame | null {
  const queue: D3DXFrame[] = [];
  let frame: D3DXFrame | null = root;
  for (let head = 0; ;) {
    for (; frame; frame = frame.pFrameSibling) {
      if (name === null ? frame.Name === null : frame.Name === name) return frame;
      queue.push(frame);
    }
    if (head >= queue.length) return null;
    frame = queue[head++]!.pFrameFirstChild;
  }
}
/** `D3DXFrameAppendChild`: append `child` (with its siblings) after the last child of `parent`. */
export function D3DXFrameAppendChild(parent: D3DXFrame, child: D3DXFrame): number {
  if (!parent.pFrameFirstChild) { parent.pFrameFirstChild = child; return D3D_OK; }
  let f = parent.pFrameFirstChild;
  while (f.pFrameSibling) f = f.pFrameSibling;
  f.pFrameSibling = child;
  return D3D_OK;
}
/** `D3DXFrameDestroy`: every frame and mesh container of the tree goes through the allocator. */
export function D3DXFrameDestroy(root: D3DXFrame | null, alloc: ID3DXAllocateHierarchy): number {
  let f = root;
  while (f) {
    const next = f.pFrameSibling;
    D3DXFrameDestroy(f.pFrameFirstChild, alloc);
    for (let c = f.pMeshContainer; c;) { const nc = c.pNextMeshContainer; alloc.DestroyMeshContainer(c); c = nc; }
    alloc.DestroyFrame(f);
    f = next;
  }
  return D3D_OK;
}
/** `D3DXFrameNumNamedMatrices`: frames with a name. */
export function D3DXFrameNumNamedMatrices(root: D3DXFrame | null): number {
  let n = 0;
  for (let f = root; f; f = f.pFrameSibling) { if (f.Name) n++; n += D3DXFrameNumNamedMatrices(f.pFrameFirstChild); }
  return n;
}
/** `D3DXFrameRegisterNamedMatrices`: every named frame's TransformationMatrix becomes an output of the controller. */
export function D3DXFrameRegisterNamedMatrices(root: D3DXFrame | null, controller: D3DXAnimationController): number {
  for (let f = root; f; f = f.pFrameSibling) {
    if (f.Name) { const hr = controller.RegisterAnimationOutput(f.Name, f.TransformationMatrix, null, null, null); if (hr < 0) return hr; }
    const hr = D3DXFrameRegisterNamedMatrices(f.pFrameFirstChild, controller);
    if (hr < 0) return hr;
  }
  return D3D_OK;
}
/** `D3DXFrameCalculateBoundingSphere`: centroid + largest distance of all mesh vertices in world space (frame matrices accumulated from the root). */
export function D3DXFrameCalculateBoundingSphere(root: D3DXFrame | null): { hr: number; center: Vec3; radius: number } {
  const pts: Vec3[] = [];
  const visit = (f: D3DXFrame | null, parent: Mat4): void => {
    for (; f; f = f.pFrameSibling) {
      const world = matMultiply(f.TransformationMatrix, parent);
      for (let c = f.pMeshContainer; c; c = c.pNextMeshContainer) {
        const m = c.MeshData.pMesh;
        if (!m) continue;
        const st = m.GetNumBytesPerVertex(), dv = new DataView(m.vb.cpu.buffer, m.vb.cpu.byteOffset, m.vb.cpu.byteLength);
        for (let v = 0; v < m.GetNumVertices(); v++) pts.push(vec3TransformCoord({ x: dv.getFloat32(v * st, true), y: dv.getFloat32(v * st + 4, true), z: dv.getFloat32(v * st + 8, true) }, world));
      }
      visit(f.pFrameFirstChild, world);
    }
  };
  visit(root, matIdentity());
  if (pts.length === 0) return { hr: D3D_OK, center: { x: 0, y: 0, z: 0 }, radius: 0 };
  const f32 = Math.fround;
  let sx = 0, sy = 0, sz = 0;
  for (const p of pts) { sx = f32(sx + p.x); sy = f32(sy + p.y); sz = f32(sz + p.z); }
  const inv = f32(1 / pts.length), center = { x: f32(sx * inv), y: f32(sy * inv), z: f32(sz * inv) };
  let radius = 0;
  for (const p of pts) radius = Math.max(radius, f32(Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z)));
  return { hr: D3D_OK, center, radius };
}

// ------------------------------------------------------------------------------------------------------ skin info
export interface D3DXBoneCombination { AttribId: number; FaceStart: number; FaceCount: number; VertexStart: number; VertexCount: number; BoneId: Uint32Array }

interface Bone { name: string | null; offset: Float32Array; vertices: Uint32Array; weights: Float32Array }

export class D3DXSkinInfo {
  private bones: Bone[];
  private minInfluence = 0.00001;

  constructor(public numVertices: number, public fvf: number, numBones: number) {
    this.bones = Array.from({ length: numBones }, () => ({ name: null, offset: matIdentity(), vertices: new Uint32Array(0), weights: new Float32Array(0) }));
  }
  GetNumBones(): number { return this.bones.length; }
  GetFVF(): number { return this.fvf; }
  SetFVF(fvf: number): number { this.fvf = fvf; return D3D_OK; }
  GetDeclaration(): VertexElement[] { return fvfToElements(this.fvf).elements; }
  SetMinBoneInfluence(v: number): number { this.minInfluence = v; return D3D_OK; }
  GetMinBoneInfluence(): number { return this.minInfluence; }

  private bone(i: number): Bone | null { return Number.isInteger(i) && i >= 0 && i < this.bones.length ? this.bones[i]! : null; }
  SetBoneName(i: number, name: string | null): number { const b = this.bone(i); if (!b || name === null) return D3DERR_INVALIDCALL; b.name = name; return D3D_OK; }
  GetBoneName(i: number): string | null { return this.bone(i)?.name ?? null; }
  SetBoneOffsetMatrix(i: number, m: ArrayLike<number>): number { const b = this.bone(i); if (!b) return D3DERR_INVALIDCALL; b.offset.set(Array.from({ length: 16 }, (_, k) => m[k]!)); return D3D_OK; }
  /** The stored matrix (not a copy). */
  GetBoneOffsetMatrix(i: number): Float32Array | null { return this.bone(i)?.offset ?? null; }
  /** Replaces the influences of a bone. */
  SetBoneInfluence(i: number, vertices: ArrayLike<number>, weights: ArrayLike<number>): number {
    const b = this.bone(i);
    if (!b || vertices.length !== weights.length) return D3DERR_INVALIDCALL;
    for (let k = 0; k < vertices.length; k++) if (!(vertices[k]! >= 0 && vertices[k]! < this.numVertices)) return D3DERR_INVALIDCALL;
    b.vertices = Uint32Array.from(vertices); b.weights = Float32Array.from(weights);
    return D3D_OK;
  }
  GetNumBoneInfluences(i: number): number { return this.bone(i)?.vertices.length ?? 0; }
  GetBoneInfluence(i: number): { vertices: Uint32Array; weights: Float32Array } | null { const b = this.bone(i); return b ? { vertices: b.vertices.slice(), weights: b.weights.slice() } : null; }

  /** Per-vertex influence lists (bone ascending), weights above the minimum only; `limit` keeps the strongest ones (ties: lower bone index). */
  private influences(limit = Infinity): { bone: number; w: number }[][] {
    const out: { bone: number; w: number }[][] = Array.from({ length: this.numVertices }, () => []);
    this.bones.forEach((b, bi) => b.vertices.forEach((v, k) => { if (b.weights[k]! > this.minInfluence) out[v]!.push({ bone: bi, w: b.weights[k]! }); }));
    if (limit < Infinity) for (let v = 0; v < out.length; v++) if (out[v]!.length > limit) out[v] = out[v]!.sort((a, b) => b.w - a.w || a.bone - b.bone).slice(0, limit).sort((a, b) => a.bone - b.bone);
    return out;
  }
  GetMaxVertexInfluences(): number { let m = 0; for (const l of this.influences()) m = Math.max(m, l.length); return m; }
  /** Largest number of distinct bones that influence the three vertices of one face. */
  GetMaxFaceInfluences(indices: ArrayLike<number>, numFaces: number): number {
    const infl = this.influences();
    let m = 0;
    for (let f = 0; f < numFaces; f++) {
      const set = new Set<number>();
      for (let c = 0; c < 3; c++) for (const x of infl[indices[f * 3 + c]!] ?? []) set.add(x.bone);
      m = Math.max(m, set.size);
    }
    return m;
  }
  Clone(): D3DXSkinInfo {
    const c = new D3DXSkinInfo(this.numVertices, this.fvf, this.bones.length);
    c.minInfluence = this.minInfluence;
    c.bones = this.bones.map((b) => ({ name: b.name, offset: b.offset.slice(), vertices: b.vertices.slice(), weights: b.weights.slice() }));
    return c;
  }
  /** `Remap`: vertex i of the old mesh becomes vertex `remap[i]` (indices >= numVertices drop the influence). */
  Remap(newNumVertices: number, remap: ArrayLike<number>): number {
    for (const b of this.bones) {
      const v: number[] = [], w: number[] = [];
      b.vertices.forEach((old, k) => { const n = remap[old]!; if (n >= 0 && n < newNumVertices) { v.push(n); w.push(b.weights[k]!); } });
      b.vertices = Uint32Array.from(v); b.weights = Float32Array.from(w);
    }
    this.numVertices = newNumVertices;
    return D3D_OK;
  }

  /**
   * `UpdateSkinnedMesh` (as Wine implements it, tested there against native d3dx9): every position / normal of `dst` is the weighted sum over the bones that influence the
   * vertex of the position transformed by `boneTransforms[i]` (`D3DXVec3TransformCoord`) and the normal transformed by `boneInvTransposeTransforms[i]` (or `boneTransforms[i]` when
   * that is null; `D3DXVec3TransformNormal`, no renormalisation); vertices without influences end up with zero; the other components are copied.  The stored offset matrices are
   * NOT applied: the caller passes `offset * bone` (the usual sample code).
   */
  UpdateSkinnedMesh(boneTransforms: readonly ArrayLike<number>[], boneInvTransposeTransforms: readonly ArrayLike<number>[] | null, src: Uint8Array, dst: Uint8Array): number {
    const stride = fvfVertexSize(this.fvf), els = fvfToElements(this.fvf).elements;
    const pos = els.find((e) => e.usage === D3DDECLUSAGE.POSITION), nor = els.find((e) => e.usage === D3DDECLUSAGE.NORMAL);
    if (!pos || pos.type !== D3DDECLTYPE.FLOAT3 || (nor && nor.type !== D3DDECLTYPE.FLOAT3)) return E_NOTIMPL;
    if (src.length < stride * this.numVertices || dst.length < stride * this.numVertices || boneTransforms.length < this.bones.length) return D3DERR_INVALIDCALL;
    dst.set(src.subarray(0, stride * this.numVertices));
    const sv = new DataView(src.buffer, src.byteOffset, src.byteLength), dv = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
    for (let v = 0; v < this.numVertices; v++) for (let c = 0; c < 3; c++) { dv.setFloat32(v * stride + pos.offset + 4 * c, 0, true); if (nor) dv.setFloat32(v * stride + nor.offset + 4 * c, 0, true); }
    const f32 = Math.fround;
    this.bones.forEach((b, bi) => b.vertices.forEach((v, k) => {
      const w = b.weights[k]!, m = boneTransforms[bi]!;
      const o = v * stride + pos.offset;
      const px = sv.getFloat32(o, true), py = sv.getFloat32(o + 4, true), pz = sv.getFloat32(o + 8, true);
      // D3DXVec3TransformCoord: (x, y, z, 1) * M, divided by w
      const iw = f32(1 / f32(f32(f32(px * m[3]!) + f32(py * m[7]!)) + f32(f32(pz * m[11]!) + m[15]!)));
      const tx = f32(f32(f32(f32(px * m[0]!) + f32(py * m[4]!)) + f32(f32(pz * m[8]!) + m[12]!)) * iw);
      const ty = f32(f32(f32(f32(px * m[1]!) + f32(py * m[5]!)) + f32(f32(pz * m[9]!) + m[13]!)) * iw);
      const tz = f32(f32(f32(f32(px * m[2]!) + f32(py * m[6]!)) + f32(f32(pz * m[10]!) + m[14]!)) * iw);
      dv.setFloat32(o, f32(dv.getFloat32(o, true) + f32(w * tx)), true);
      dv.setFloat32(o + 4, f32(dv.getFloat32(o + 4, true) + f32(w * ty)), true);
      dv.setFloat32(o + 8, f32(dv.getFloat32(o + 8, true) + f32(w * tz)), true);
      if (nor) {
        const n = (boneInvTransposeTransforms ? boneInvTransposeTransforms[bi] : m)!;
        const no = v * stride + nor.offset;
        const nx = sv.getFloat32(no, true), ny = sv.getFloat32(no + 4, true), nz = sv.getFloat32(no + 8, true);
        // D3DXVec3TransformNormal: the 3x3 part
        dv.setFloat32(no, f32(dv.getFloat32(no, true) + f32(w * f32(f32(f32(nx * n[0]!) + f32(ny * n[4]!)) + f32(nz * n[8]!)))), true);
        dv.setFloat32(no + 4, f32(dv.getFloat32(no + 4, true) + f32(w * f32(f32(f32(nx * n[1]!) + f32(ny * n[5]!)) + f32(nz * n[9]!)))), true);
        dv.setFloat32(no + 8, f32(dv.getFloat32(no + 8, true) + f32(w * f32(f32(f32(nx * n[2]!) + f32(ny * n[6]!)) + f32(nz * n[10]!)))), true);
      }
    }));
    return D3D_OK;
  }

  /**
   * `ConvertToIndexedBlendedMesh`: a mesh whose vertices carry up to `m` bone weights + palette indices (FVF: XYZB(m) | LASTBETA_UBYTE4 | the source's normal / colour /
   * texture components) and whose attribute table has one entry per bone combination (`DrawSubset(i)` draws combination i, `boneCombinations[i].AttribId` is the material).
   * At most 4 influences per vertex are kept (the strongest, renormalised), as the indices are one UBYTE4.
   */
  ConvertToIndexedBlendedMesh(mesh: D3DXMesh, options: number, paletteSize: number): {
    hr: number; mesh: D3DXMesh | null; maxVertexInfluences: number; boneCombinations: D3DXBoneCombination[]; adjacencyOut: Uint32Array | null; faceRemap: Uint32Array | null; vertexRemap: Uint32Array | null;
  } {
    const fail = (hr: number) => ({ hr, mesh: null, maxVertexInfluences: 0, boneCombinations: [], adjacencyOut: null, faceRemap: null, vertexRemap: null });
    if (paletteSize < 1 || mesh.GetNumVertices() !== this.numVertices) return fail(D3DERR_INVALIDCALL);
    const src = mesh.indices(), nF = mesh.GetNumFaces(), attrs = mesh.attributeBuffer;
    const infl = this.influences(MAX_INDEXED_INFLUENCES);
    let m = 0;
    for (const l of infl) m = Math.max(m, l.length);
    m = Math.max(m, 1);
    const faceBones: number[][] = [];
    for (let f = 0; f < nF; f++) {
      const set = new Set<number>();
      for (let c = 0; c < 3; c++) for (const x of infl[src[f * 3 + c]!]!) set.add(x.bone);
      if (set.size > paletteSize) return fail(E_FAIL);
      faceBones.push([...set].sort((a, b) => a - b));
    }
    // faces of one material, in order, packed into combinations
    const order = Array.from({ length: nF }, (_, i) => i).sort((a, b) => attrs[a]! - attrs[b]! || a - b);
    interface Combo { attrib: number; faces: number[]; bones: Set<number> }
    const combos: Combo[] = [];
    for (const f of order) {
      let c = combos[combos.length - 1];
      if (c && c.attrib === attrs[f]) {
        const union = new Set(c.bones); for (const b of faceBones[f]!) union.add(b);
        if (union.size <= paletteSize) { c.bones = union; c.faces.push(f); continue; }
      }
      c = { attrib: attrs[f]!, faces: [f], bones: new Set(faceBones[f]!) };
      combos.push(c);
    }
    // vertex format: XYZB(m) | LASTBETA_UBYTE4 plus the other components of the source
    const srcEls = fvfToElements(mesh.GetFVF()).elements;
    if (!srcEls.some((e) => e.usage === D3DDECLUSAGE.POSITION && e.type === D3DDECLTYPE.FLOAT3) || srcEls.some((e) => e.usage === D3DDECLUSAGE.BLENDWEIGHT || e.usage === D3DDECLUSAGE.BLENDINDICES)) return fail(D3DERR_INVALIDCALL);
    const outFvf = ((mesh.GetFVF() & ~0x00e) | (0x004 + 2 * m) | 0x1000) >>> 0;
    const outEls = fvfToElements(outFvf).elements, outStride = fvfVertexSize(outFvf), srcStride = mesh.GetNumBytesPerVertex();
    const wEl = outEls.find((e) => e.usage === D3DDECLUSAGE.BLENDWEIGHT), iEl = outEls.find((e) => e.usage === D3DDECLUSAGE.BLENDINDICES)!;
    // build vertices per combination
    const vertexRemap: number[] = [], faceRemap: number[] = [], outIdx: number[] = [];
    const table: D3DXAttributeRangeLike[] = [], boneCombinations: D3DXBoneCombination[] = [];
    const vertexBytes: Uint8Array[] = [];
    const sv = mesh.vb.cpu;
    for (const c of combos) {
      const bones = [...c.bones].sort((a, b) => a - b);
      const slot = new Map<number, number>(); bones.forEach((b, i) => slot.set(b, i));
      const boneId = new Uint32Array(paletteSize).fill(UNUSED_BONE); bones.forEach((b, i) => { boneId[i] = b; });
      const vStart = vertexRemap.length, local = new Map<number, number>(), fStart = faceRemap.length;
      for (const f of c.faces) {
        faceRemap.push(f);
        for (let k = 0; k < 3; k++) {
          const old = src[f * 3 + k]!;
          let nv = local.get(old);
          if (nv === undefined) {
            nv = vertexRemap.length; local.set(old, nv); vertexRemap.push(old);
            const out = new Uint8Array(outStride), dv = new DataView(out.buffer);
            // copy the shared components by usage
            for (const oe of outEls) {
              if (oe.usage === D3DDECLUSAGE.BLENDWEIGHT || oe.usage === D3DDECLUSAGE.BLENDINDICES) continue;
              const se = srcEls.find((e) => e.usage === oe.usage && e.usageIndex === oe.usageIndex);
              if (se) out.set(sv.subarray(old * srcStride + se.offset, old * srcStride + se.offset + declSize(se.type)), oe.offset);
            }
            const list = infl[old]!;
            const total = list.reduce((a, x) => a + x.w, 0) || 1;
            const ws = list.map((x) => ({ slot: slot.get(x.bone)!, w: x.w / total }));
            if (ws.length === 0) ws.push({ slot: 0, w: 1 });
            if (wEl) for (let i = 0; i < m - 1; i++) dv.setFloat32(wEl.offset + 4 * i, ws[i]?.w ?? 0, true);
            for (let i = 0; i < 4; i++) out[iEl.offset + i] = ws[i]?.slot ?? 0;
            vertexBytes.push(out);
          }
          outIdx.push(nv);
        }
      }
      table.push({ AttribId: boneCombinations.length, FaceStart: fStart, FaceCount: c.faces.length, VertexStart: vStart, VertexCount: vertexRemap.length - vStart });
      boneCombinations.push({ AttribId: c.attrib, FaceStart: fStart, FaceCount: c.faces.length, VertexStart: vStart, VertexCount: vertexRemap.length - vStart, BoneId: boneId });
    }
    const want32 = (options & D3DXMESH._32BIT) !== 0 || mesh.is32 || vertexRemap.length > 0xffff;
    const created = D3DXCreateMeshFVF(nF, vertexRemap.length, want32 ? options | D3DXMESH._32BIT : options & ~D3DXMESH._32BIT, outFvf, mesh.device);
    if (created.hr < 0 || !created.mesh) return fail(created.hr);
    const out = created.mesh;
    vertexBytes.forEach((b, i) => out.vb.cpu.set(b, i * outStride));
    out.vb.markDirty(0, out.vb.length);
    const di = out.indices();
    for (let i = 0; i < outIdx.length; i++) di[i] = outIdx[i]!;
    out.ib.markDirty(0, out.ib.length);
    boneCombinations.forEach((bc, i) => out.attributeBuffer.fill(i, bc.FaceStart, bc.FaceStart + bc.FaceCount));
    out.attributeTable = table;
    return { hr: D3D_OK, mesh: out, maxVertexInfluences: m, boneCombinations, adjacencyOut: out.GenerateAdjacency(0), faceRemap: Uint32Array.from(faceRemap), vertexRemap: Uint32Array.from(vertexRemap) };
  }
}
type D3DXAttributeRangeLike = { AttribId: number; FaceStart: number; FaceCount: number; VertexStart: number; VertexCount: number };
function declSize(t: number): number { return t === D3DDECLTYPE.FLOAT1 ? 4 : t === D3DDECLTYPE.FLOAT2 ? 8 : t === D3DDECLTYPE.FLOAT3 ? 12 : t === D3DDECLTYPE.FLOAT4 ? 16 : 4; }

/** `D3DXCreateSkinInfoFVF` */
export function D3DXCreateSkinInfoFVF(numVertices: number, fvf: number, numBones: number): { hr: number; skinInfo: D3DXSkinInfo | null } {
  // D3DXDeclaratorFromFVF refuses the reserved bits, XYZW and more than four blend weights; FVF 0 is an empty declaration and accepted
  const blend = (fvf & 0x00e) >= 0x006 ? 1 + (((fvf & 0x00e) - 0x006) >> 1) - ((fvf & 0x3000) !== 0 ? 1 : 0) : 0;
  if (numVertices < 0 || numBones < 0 || (fvf & 0x6001) !== 0 || (fvf & 0xe) === 0x004 || blend > 4) return { hr: D3DERR_INVALIDCALL, skinInfo: null };
  return { hr: D3D_OK, skinInfo: new D3DXSkinInfo(numVertices, fvf, numBones) };
}

// -------------------------------------------------------------------------------------------------------- loader
/** The skin info D3DX creates for a loaded mesh (bone names, offsets and influences; vertices split off by normal indices repeat the influences of their origin). */
export function skinInfoFor(data: XMeshData, mesh: D3DXMesh, origin: Uint32Array): D3DXSkinInfo | null {
  if (!data.skin) return null;
  const created = D3DXCreateSkinInfoFVF(mesh.GetNumVertices(), mesh.GetFVF(), data.skin.bones.length);
  if (created.hr < 0 || !created.skinInfo) return null;
  const si = created.skinInfo;
  // vertices D3DX appended when splitting normals inherit the influences of the vertex they were split from
  const copies = new Map<number, number[]>();
  origin.forEach((o, v) => { const l = copies.get(o); if (l) l.push(v); else copies.set(o, [v]); });
  data.skin.bones.forEach((b, i) => {
    const vs: number[] = [], ws: number[] = [];
    b.vertexIndices.forEach((v, k) => { for (const nv of copies.get(v) ?? []) { vs.push(nv); ws.push(b.weights[k]!); } });
    si.SetBoneName(i, b.name);
    si.SetBoneOffsetMatrix(i, b.offset);
    si.SetBoneInfluence(i, vs, ws);
  });
  return si;
}

/** Rotation key of the file (w, x, y, z) -> D3DXQUATERNION: the stored value is the conjugate (see the header). */
const quatFromX = (q: readonly [number, number, number, number]) => ({ x: Math.fround(-q[1]), y: Math.fround(-q[2]), z: Math.fround(-q[3]), w: Math.fround(q[0]) });

/** The animation sets of an X scene as D3DX keyframed sets. */
export function buildAnimationSets(scene: XScene): ReturnType<typeof D3DXCreateKeyframedAnimationSet>["set"][] {
  const out: ReturnType<typeof D3DXCreateKeyframedAnimationSet>["set"][] = [];
  for (const s of scene.animationSets) {
    const r = D3DXCreateKeyframedAnimationSet(s.name, scene.ticksPerSecond, D3DXPLAY.LOOP, s.animations.length);
    if (r.hr < 0 || !r.set) continue;
    for (const a of s.animations) {
      let scale: D3DXKeyVector3[] = a.scale.map((k) => ({ Time: k.time, Value: { x: k.v[0], y: k.v[1], z: k.v[2] } }));
      let rotation: D3DXKeyQuaternion[] = a.rotation.map((k) => ({ Time: k.time, Value: quatFromX(k.q) }));
      let translation: D3DXKeyVector3[] = a.position.map((k) => ({ Time: k.time, Value: { x: k.v[0], y: k.v[1], z: k.v[2] } }));
      if (a.matrix.length) {
        scale = []; rotation = []; translation = [];
        for (const k of a.matrix) {
          const d = matDecompose(k.m);
          if (!d) continue;
          scale.push({ Time: k.time, Value: d.scale }); rotation.push({ Time: k.time, Value: d.rotation }); translation.push({ Time: k.time, Value: d.translation });
        }
      }
      r.set.RegisterAnimationSRTKeys(a.frame, scale, rotation, translation);
    }
    out.push(r.set);
  }
  return out;
}

/**
 * `D3DXLoadMeshHierarchyFromXInMemory`.  Structure as D3DX makes it (Wine's implementation of the same entry point, whose tests also run on native d3dx9): a top-level `Mesh`
 * is wrapped in a frame created with a NULL name; unnamed `Frame` blocks and meshes get the empty string; when the file has more than one top-level frame the
 * returned root is one more frame (NULL name, identity) holding them as its children; no frame at all is `E_FAIL`; no animation set means no controller.
 */
export function D3DXLoadMeshHierarchyFromXInMemory(data: Uint8Array, options: number, device: Direct3DDevice9 | null, alloc: ID3DXAllocateHierarchy | null, _loadUserData: null = null): { hr: number; frameRoot: D3DXFrame | null; animController: D3DXAnimationController | null } {
  const bad = (hr: number) => ({ hr, frameRoot: null, animController: null });
  if (!data || data.length === 0 || !device || !alloc) return bad(D3DERR_INVALIDCALL);
  let scene: XScene;
  try { scene = loadXScene(data); } catch { return bad(D3DXERR_INVALIDDATA); }
  let error = D3D_OK;

  const build = (x: XFrameData): D3DXFrame | null => {
    const created = alloc.CreateFrame(x.synthetic ? null : x.name);
    if (created.hr < 0 || !created.frame) { error = created.hr < 0 ? created.hr : E_FAIL; return null; }
    const frame = created.frame;
    frame.TransformationMatrix = Float32Array.from(x.matrix);
    let lastContainer: D3DXMeshContainer | null = null;
    for (const md of x.meshes) {
      const built = D3DXBuildMesh([{ data: md, world: matIdentity() }], options, device);
      if (built.hr < 0 || !built.mesh) { if (built.hr === D3DXERR_INVALIDDATA) continue; error = built.hr; return frame; }
      const skin = skinInfoFor(md, built.mesh, built.vertexOrigin);
      const c = alloc.CreateMeshContainer(md.name, { Type: D3DXMESHTYPE.MESH, pMesh: built.mesh }, built.materials, null, built.materials.length, built.adjacency!, skin);
      if (c.hr < 0 || !c.container) { error = c.hr < 0 ? c.hr : E_FAIL; return frame; }
      if (lastContainer) lastContainer.pNextMeshContainer = c.container; else frame.pMeshContainer = c.container;
      lastContainer = c.container;
    }
    let lastChild: D3DXFrame | null = null;
    for (const cx of x.children) {
      const child = build(cx);
      if (!child) return frame;
      if (lastChild) lastChild.pFrameSibling = child; else frame.pFrameFirstChild = child;
      lastChild = child;
      if (error < 0) return frame;
    }
    return frame;
  };

  let first: D3DXFrame | null = null, last: D3DXFrame | null = null;
  for (const top of scene.frames) {
    const f = build(top);
    if (f) { if (last) last.pFrameSibling = f; else first = f; last = f; }
    if (error < 0 || !f) break;
  }
  if (error < 0) { if (first) D3DXFrameDestroy(first, alloc); return bad(error); }
  if (!first) return bad(E_FAIL);
  let root: D3DXFrame = first;
  if (first.pFrameSibling) {
    const r = alloc.CreateFrame(null);
    if (r.hr < 0 || !r.frame) { D3DXFrameDestroy(first, alloc); return bad(E_FAIL); }
    r.frame.TransformationMatrix = matIdentity();
    r.frame.pFrameFirstChild = first;
    root = r.frame;
  }

  let controller: D3DXAnimationController | null = null;
  const sets = buildAnimationSets(scene).filter((s): s is NonNullable<typeof s> => s !== null);
  if (sets.length > 0) {
    const c = D3DXCreateAnimationController(Math.max(1, D3DXFrameNumNamedMatrices(root)), sets.length, 2, 30);
    if (c.hr >= 0 && c.controller) {
      controller = c.controller;
      for (const s of sets) controller.RegisterAnimationSet(s);
      D3DXFrameRegisterNamedMatrices(root, controller);
    }
  }
  return { hr: D3D_OK, frameRoot: root, animController: controller };
}
