/**
 * `CKTDXDeviceXMesh::XMeshProxy` - what `CKTDXDeviceXMesh::_Load` (x2.exe.c L426604) makes of a static mesh file before it opens the textures and the
 * XET: `LoadKMEMesh` (L425712, 3296A880) when the data starts with "KME " (541412683), `LoadD3DXMesh` (L425208, 3296A130) for everything else.
 *
 * Both end in the same shape: one ID3DXMesh of FVF 338 (XYZ | NORMAL | DIFFUSE | TEX1, 36 bytes: position, normal, colour at +24, uv), welded with zero
 * epsilons and `Optimize(ATTRSORT | VERTEXCACHE | MANAGED)`d, its attribute table (one range per used material), a bounding sphere of the whole mesh and one
 * per attribute range (`KSubsetCullingInfo`, used for culling and for sorting).  The differences:
 *  - X: `D3DXLoadMeshFromXInMemory(MANAGED)`, the materials get Ambient = Diffuse (the loader's own ambient is 0), a mesh that is not FVF 338 is cloned to it, and
 *    every vertex that a face uses gets the colour 0xFFFFFFFF; the whole-mesh sphere is `D3DXComputeBoundingSphere` over the vertices.
 *  - KME: the file holds the FVF 338 vertices (colours included), the indices (16 or 32 bit), one attribute per face and the materials (as stored, ambient too);
 *    the whole-mesh sphere is the file's (centre, radius); adjacency is `GenerateAdjacency(0)`.
 */
import { KFormatError, parseKme } from "@els/assets";
import type { KmeMesh } from "@els/assets";
import {
  D3DXComputeBoundingSphere, D3DXCreateMeshFVF, D3DXLoadMeshFromXInMemory, D3DXMESH, D3DXMESHOPT, D3DXMESHTYPE, D3DXWeldVertices, E_FAIL, zeroWeldEpsilons,
} from "@els/d3d9";
import type { D3DXAttributeRange, D3DXMaterial, D3DXMesh, Direct3DDevice9 } from "@els/d3d9";
import { MultiAnimFrame, MultiAnimMC } from "./multianim.ts";
import type { ErrorLog } from "./multianim.ts";

/** MESH_VERTEX of FVF 338 */
export const XMESH_FVF = 338;
const XMESH_STRIDE = 36;

/** `CKTDXDeviceXMesh::KSubsetCullingInfo`: centre + radius of one attribute range */
export interface SubsetCullingInfo { center: [number, number, number]; radius: number }

export interface XMeshProxy {
  hr: number;
  format: "KME" | "X";
  mesh: D3DXMesh | null;
  /** m_pdxMaterials (the texture file names as stored; opening them is the caller's) */
  materials: D3DXMaterial[];
  /** m_vCenter / m_fRadius */
  center: [number, number, number];
  radius: number;
  /** m_pAttributeRange */
  attributeRange: D3DXAttributeRange[];
  /** m_vecSubsetCullingInfo */
  subsetCulling: SubsetCullingInfo[];
}

const failed = (format: XMeshProxy["format"], hr: number = E_FAIL): XMeshProxy =>
  ({ hr, format, mesh: null, materials: [], center: [0, 0, 0], radius: 0, attributeRange: [], subsetCulling: [] });

/** True when the data starts with "KME " (`_Load`: `size >= 4 && *(DWORD*)data == 541412683`). */
export function isKmeData(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x4b && data[1] === 0x4d && data[2] === 0x45 && data[3] === 0x20;
}

/** The ID of the exe's error log line for a KME file that `parseKme` refuses (the checks of `LoadKMEMesh`, in its order). */
function kmeErrorId(e: unknown): number {
  const m = e instanceof KFormatError ? e.message : "";
  if (/header/.test(m)) return 0xab;
  if (/not a KME/.test(m)) return 0xac;
  if (/version/.test(m)) return 0xad;
  if (/vertex format/.test(m)) return 0xae;
  if (/without materials/.test(m)) return 0xb3;
  if (/without vertices/.test(m)) return 0xb8;
  if (/without faces/.test(m)) return 0xbd;
  if (/without attribute/.test(m)) return 0xc1;
  return 0xb4;
}

/**
 * The tail both loaders share (L425208 from the weld, L425712 from `GenerateAdjacency`): weld with zero epsilons (log 0x165 and failure when it fails),
 * `Optimize(0x6000220)` (the old mesh is replaced only when it succeeds), the attribute table, and a bounding sphere per attribute range over
 * `36 * VertexStart` for `VertexCount` vertices (a failing sphere is (0, 0, 0) with radius 0).
 */
function finish(p: XMeshProxy, adjacency: Uint32Array | null, log: ErrorLog): XMeshProxy {
  const welded = D3DXWeldVertices(p.mesh!, 0, zeroWeldEpsilons(), adjacency);
  if (welded.hr < 0) { log(0x165); return failed(p.format, welded.hr); }
  const opt = p.mesh!.Optimize(D3DXMESHOPT.ATTRSORT | D3DXMESHOPT.VERTEXCACHE | D3DXMESH.MANAGED, welded.adjacencyOut ?? adjacency);
  if (opt.hr === 0 && opt.mesh) p.mesh = opt.mesh;
  p.attributeRange = p.mesh!.GetAttributeTable();
  if (p.attributeRange.length === 0) log(p.format === "X" ? 0xc5 : 0xca);
  const vb = p.mesh!.vb.cpu;
  p.subsetCulling = p.attributeRange.map((r): SubsetCullingInfo => {
    const s = D3DXComputeBoundingSphere(vb, XMESH_STRIDE * r.VertexStart, r.VertexCount, p.mesh!.GetNumBytesPerVertex());
    return s.hr < 0 ? { center: [0, 0, 0], radius: 0 } : { center: [s.center.x, s.center.y, s.center.z], radius: s.radius };
  });
  return p;
}

/** `XMeshProxy::LoadD3DXMesh` (L425208, 3296A130) */
export function loadD3DXMesh(data: Uint8Array, device: Direct3DDevice9, log: ErrorLog = () => {}): XMeshProxy {
  const loaded = D3DXLoadMeshFromXInMemory(data, D3DXMESH.MANAGED, device);
  if (loaded.hr < 0 || !loaded.mesh) return failed("X", loaded.hr);
  if (loaded.materials.length === 0) return failed("X"); // m_dwNumMaterials == 0
  const p = failed("X");
  p.hr = 0;
  p.mesh = loaded.mesh;
  const index32 = loaded.mesh.GetOptions() & 1;
  // the materials as D3DX made them, with Ambient = Diffuse
  p.materials = loaded.materials.map((m): D3DXMaterial => ({ MatD3D: { ...m.MatD3D, ambient: { ...m.MatD3D.diffuse } }, pTextureFilename: m.pTextureFilename }));
  if (p.mesh.GetFVF() !== XMESH_FVF) {
    const clone = p.mesh.CloneMeshFVF(index32 | D3DXMESH.MANAGED, XMESH_FVF, device);
    if (clone.hr < 0 || !clone.mesh) return failed("X", clone.hr);
    p.mesh = clone.mesh;
  }
  const mesh = p.mesh;
  const vb = mesh.LockVertexBuffer(0);
  if (vb.hr !== 0 || !vb.data) { log(0xa4); return failed("X"); }
  const ib = mesh.LockIndexBuffer(0x10); // D3DLOCK_READONLY
  if (ib.hr !== 0 || !ib.data) { log(0xa5); return failed("X"); }
  const dv = new DataView(vb.data.buffer, vb.data.byteOffset, vb.data.byteLength);
  const idx = mesh.indices();
  for (let i = 0; i < idx.length; i++) dv.setUint32(idx[i]! * XMESH_STRIDE + 24, 0xffffffff, true); // every vertex a face uses: white
  const sphere = D3DXComputeBoundingSphere(vb.data, 0, mesh.GetNumVertices(), mesh.GetNumBytesPerVertex());
  if (sphere.hr >= 0) { p.center = [sphere.center.x, sphere.center.y, sphere.center.z]; p.radius = sphere.radius; }
  if (mesh.UnlockIndexBuffer() !== 0) log(0xa8);
  if (mesh.UnlockVertexBuffer() !== 0) log(0xa9);
  return finish(p, loaded.adjacency, log);
}

/** `XMeshProxy::LoadKMEMesh` (L425712, 3296A880) */
export function loadKMEMesh(data: Uint8Array, device: Direct3DDevice9, log: ErrorLog = () => {}): XMeshProxy {
  let kme: KmeMesh;
  try { kme = parseKme(data); } catch (e) { log(kmeErrorId(e)); return failed("KME"); }
  const p = failed("KME");
  p.hr = 0;
  p.center = [...kme.center];
  p.radius = kme.radius;
  p.materials = kme.materials.map((m): D3DXMaterial => ({
    MatD3D: {
      diffuse: { r: m.diffuse[0], g: m.diffuse[1], b: m.diffuse[2], a: m.diffuse[3] }, ambient: { r: m.ambient[0], g: m.ambient[1], b: m.ambient[2], a: m.ambient[3] },
      specular: { r: m.specular[0], g: m.specular[1], b: m.specular[2], a: m.specular[3] }, emissive: { r: m.emissive[0], g: m.emissive[1], b: m.emissive[2], a: m.emissive[3] },
      power: m.power,
    },
    pTextureFilename: m.texture,
  }));
  const created = D3DXCreateMeshFVF(kme.faceCount, kme.vertexCount, (kme.options & 1) | D3DXMESH.MANAGED, kme.fvf, device);
  if (created.hr < 0 || !created.mesh) { log(0xb7); return failed("KME", created.hr); }
  const mesh = created.mesh;
  if (mesh.GetNumBytesPerVertex() !== kme.vertexStride) { log(0xb9); return failed("KME"); }
  const vb = mesh.LockVertexBuffer(0);
  if (vb.hr < 0 || !vb.data) { log(0xbb); return failed("KME"); }
  vb.data.set(kme.vertices);
  if (mesh.UnlockVertexBuffer() < 0) log(0xbc);
  const ib = mesh.LockIndexBuffer(0);
  if (ib.hr < 0 || !ib.data) { log(0xbf); return failed("KME"); }
  ib.data.set(new Uint8Array(kme.indices.buffer, kme.indices.byteOffset, kme.indices.byteLength));
  if (mesh.UnlockIndexBuffer() < 0) log(0xc0);
  const ab = mesh.LockAttributeBuffer(0);
  if (ab.hr < 0 || !ab.data) { log(0xc3); return failed("KME"); }
  ab.data.set(kme.attributes);
  if (mesh.UnlockAttributeBuffer() < 0) log(0xc4);
  p.mesh = mesh;
  return finish(p, mesh.GenerateAdjacency(0), log);
}

/** `CKTDXDeviceXMesh::_Load`'s choice: "KME " data is a KME, everything else goes to D3DX's X loader. */
export function loadXMesh(data: Uint8Array, device: Direct3DDevice9, log: ErrorLog = () => {}): XMeshProxy {
  return isKmeData(data) ? loadKMEMesh(data, device, log) : loadD3DXMesh(data, device, log);
}

/**
 * The static mesh as a one-frame hierarchy (a frame with an identity matrix around one mesh container), the shape D3DX gives a top-level `Mesh` of an X
 * file: what a viewer that draws frame hierarchies (the skin-mesh path) can show.  Not part of the exe.
 */
export function xmeshAsFrame(x: XMeshProxy): MultiAnimFrame {
  const f = new MultiAnimFrame("<xmesh>");
  const c = new MultiAnimMC();
  c.Name = null;
  c.NumMaterials = x.materials.length;
  c.pMaterials = x.materials;
  c.m_apTextures = new Array(x.materials.length).fill(null);
  c.MeshData = { Type: D3DXMESHTYPE.MESH, pMesh: x.mesh };
  f.pMeshContainer = c;
  return f;
}
