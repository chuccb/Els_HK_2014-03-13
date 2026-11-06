/**
 * The frame / mesh container classes of `CKTDXDeviceXSkinMesh` and the allocator the D3DX hierarchy loader calls for X files
 * (x2.exe.c; the allocator is a variant of the DirectX SDK's MultiAnimation sample):
 *
 *   MultiAnimFrame : _D3DXFRAME   x2.exe.h L91587   (the members that follow D3DXFRAME)
 *   MultiAnimMC    : _D3DXMESHCONTAINER x2.exe.h L292992
 *   CMultiAnimAllocateHierarchy::CreateFrame          3296DE80 (L428782)
 *   CMultiAnimAllocateHierarchy::CreateMeshContainer  3296E0F0 (L428909)
 *   CMultiAnimAllocateHierarchy::DestroyMeshContainer 3296E3E0 (L429082)
 *
 * `ReadKSM` (ksm-load.ts) builds `MultiAnimMC` objects itself, without going through the allocator.
 */
import { D3DXMESHTYPE, D3D_OK, E_FAIL, matIdentity } from "@els/d3d9";
import type { D3DXFrame, D3DXMaterial, D3DXMesh, D3DXMeshContainer, D3DXSkinInfo, Direct3DTexture9, ID3DXAllocateHierarchy } from "@els/d3d9";
import { isNoDrawFrameName } from "./skinmesh-frames.ts";

/** `CreateFrame` / `CreateMeshContainer` never hand out a null name: the exe stores "<no_name>" instead. */
export const NO_NAME = "<no_name>";

/** `CKTDXLog::PushErrorLog(id, text)`: the exe's error log; the ids are the numbers of the string table the decompile shows as `(const char *)0x...`. */
export type ErrorLog = (id: number, text?: string) => void;

/** `CKTDXDeviceXSkinMesh::MultiAnimFrame`: a D3DXFRAME plus the members CreateFrame initialises (x2.exe.h L91587). */
export class MultiAnimFrame implements D3DXFrame {
  Name: string;
  TransformationMatrix: Float32Array = matIdentity();
  pMeshContainer: D3DXMeshContainer | null = null;
  pFrameSibling: D3DXFrame | null = null;
  pFrameFirstChild: D3DXFrame | null = null;
  /** set by the CKTDGXSkinAnim clones (L437688 ...), not by the loaders */
  baseMatrix: Float32Array = matIdentity();
  /** the frame's world matrix after the animation has posed the hierarchy (identity until the owner computes it) */
  combineMatrix: Float32Array = matIdentity();
  fBoundingRadius = 0;
  /** false for COLLISION* / ATTACK* / Bip01_Footsteps* frames */
  m_bDraw = true;
  /** the frame's name is the proxy's m_strMoveBoneNameMB */
  m_bMoveBone = false;
  /** position in `m_apFrameList` as the KSM loader numbers it; -1 for frames from X files */
  m_iIndex = -1;
  m_bScale = false;
  m_bApplyChild = true;
  m_vScaleRel: [number, number, number] = [1, 1, 1];
  m_fDistance = -1;
  m_bJiggleFrame = false;
  m_iJiggleLevel = 0;
  m_bMoveBoneY = false;
  m_fMoveBoneY = 0;

  constructor(name: string) {
    this.Name = name;
  }
}

/** `CKTDXDeviceXSkinMesh::MultiAnimMC`: a D3DXMESHCONTAINER plus the per-bone data the skinning code reads (x2.exe.h L292992). */
export class MultiAnimMC implements D3DXMeshContainer {
  Name: string | null = null;
  MeshData: { Type: number; pMesh: D3DXMesh | null } = { Type: D3DXMESHTYPE.MESH, pMesh: null };
  pMaterials: D3DXMaterial[] = [];
  pEffects: null = null;
  NumMaterials = 0;
  pAdjacency: Uint32Array | null = null;
  pSkinInfo: D3DXSkinInfo | null = null;
  pNextMeshContainer: D3DXMeshContainer | null = null;
  /** `CKTDXDeviceTexture *` per material (`CKTDXDeviceManager::OpenTexture` in `_Load`); here the D3D texture */
  m_apTextures: (Direct3DTexture9 | null)[] = [];
  m_dwNumBones = 0;
  /** `D3DXMATRIX` per bone */
  m_amxBoneOffsets: Float32Array[] | null = null;
  /** the frame of every bone (KSM: by frame index; X: `D3DXFrameFind` by name) */
  m_ppBoneFrames: (D3DXFrame | null)[] | null = null;
  m_dwNumPaletteEntries = 0;
  // m_dwMaxSkinningVertices, m_dwNumAttrGroups, m_pAttributeRange, m_pdwBoneCombinationExtra belong to MultiAnimMC::ConvertToSkinnedMesh (GPU skinning, not ported)
}

/** The palette of a skinned X mesh holds at most 20 matrices (`CreateMeshContainer`: `v26 > 0x14 -> 20`). */
export const MAX_PALETTE_ENTRIES = 20;

/** `CMultiAnimAllocateHierarchy` (`m_strMoveBoneNameMB` is copied from the device when the load starts). */
export class CMultiAnimAllocateHierarchy implements ID3DXAllocateHierarchy {
  constructor(readonly m_strMoveBoneNameMB = "", private readonly log: ErrorLog = () => {}) {}

  /**
   * 3296DE80: the frame gets the name ("<no_name>" for a null or empty one), `m_bDraw` unless the name is a helper frame (COLLISION*, ATTACK*,
   * Bip01_Footsteps*, which also skips the move-bone test), `m_bMoveBone` when the name equals the move bone's name.  Always S_OK.
   */
  CreateFrame(name: string | null): { hr: number; frame: D3DXFrame | null } {
    const frame = new MultiAnimFrame(name === null || name === "" ? NO_NAME : name);
    if (isNoDrawFrameName(frame.Name)) frame.m_bDraw = false;
    else frame.m_bMoveBone = this.m_strMoveBoneNameMB === frame.Name;
    return { hr: D3D_OK, frame };
  }

  /**
   * 3296E0F0.  Only plain meshes are accepted.  No material in the file means one default material (diffuse and specular 0.5 grey, alpha 0, no
   * texture); a skin info without bones is an error (log 0x150, then 0x65 and E_FAIL); the palette is min(bones, 20).
   */
  CreateMeshContainer(name: string | null, meshData: { Type: number; pMesh: D3DXMesh }, materials: D3DXMaterial[], _effects: null, numMaterials: number, adjacency: Uint32Array, skinInfo: D3DXSkinInfo | null): { hr: number; container: D3DXMeshContainer | null } {
    if (meshData.Type !== D3DXMESHTYPE.MESH) { this.log(0x65, name ?? undefined); return { hr: E_FAIL, container: null }; }
    const mc = new MultiAnimMC();
    mc.Name = name ?? NO_NAME;
    mc.MeshData = { Type: meshData.Type, pMesh: meshData.pMesh };
    mc.pAdjacency = Uint32Array.from(adjacency.subarray(0, 3 * meshData.pMesh.GetNumFaces()));
    if (numMaterials !== 0) {
      mc.NumMaterials = numMaterials;
      mc.pMaterials = materials.slice(0, numMaterials).map((m) => ({ MatD3D: { diffuse: { ...m.MatD3D.diffuse }, ambient: { ...m.MatD3D.ambient }, specular: { ...m.MatD3D.specular }, emissive: { ...m.MatD3D.emissive }, power: m.MatD3D.power }, pTextureFilename: m.pTextureFilename }));
    } else {
      const grey = { r: 0.5, g: 0.5, b: 0.5, a: 0 };
      mc.NumMaterials = 1;
      mc.pMaterials = [{ MatD3D: { diffuse: { ...grey }, ambient: { r: 0, g: 0, b: 0, a: 0 }, specular: { ...grey }, emissive: { r: 0, g: 0, b: 0, a: 0 }, power: 0 }, pTextureFilename: null }];
    }
    mc.m_apTextures = new Array<Direct3DTexture9 | null>(mc.NumMaterials).fill(null);
    if (skinInfo) {
      mc.pSkinInfo = skinInfo;
      const bones = skinInfo.GetNumBones();
      if (bones === 0) { this.log(0x150, name ?? undefined); this.log(0x65, name ?? undefined); return { hr: E_FAIL, container: null }; }
      mc.m_amxBoneOffsets = Array.from({ length: bones }, (_, i) => Float32Array.from(skinInfo.GetBoneOffsetMatrix(i)!));
      mc.m_dwNumPaletteEntries = Math.min(bones, MAX_PALETTE_ENTRIES);
    }
    return { hr: D3D_OK, container: mc };
  }

  DestroyFrame(_frame: D3DXFrame): number { return D3D_OK; }

  /** 3296E3E0: releases the mesh (the textures belong to the device manager in the exe). */
  DestroyMeshContainer(container: D3DXMeshContainer): number {
    const mc = container as MultiAnimMC;
    mc.MeshData.pMesh?.Release();
    mc.MeshData.pMesh = null;
    mc.pAdjacency = null; mc.pSkinInfo = null; mc.pMaterials = []; mc.NumMaterials = 0; mc.m_apTextures = [];
    return D3D_OK;
  }
}
