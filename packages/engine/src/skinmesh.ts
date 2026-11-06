/**
 * `CKTDXDeviceXSkinMesh::_Load` (32970130, L430796) up to the point where the file is in memory: the data is a KOG skinned mesh when it starts with
 * "KSM ", otherwise it goes to D3DX's X-file loader:
 *
 *   LoadKSkinnedMesh   3296EBB0  -> ksm-load.ts
 *   LoadD3DXSkinnedMesh 3296E760 (L429311)  D3DXLoadMeshHierarchyFromXInMemory(MANAGED, CMultiAnimAllocateHierarchy), SetupFrameList (more than 255
 *       frames: error 0x158 and the load fails), the bone frames of every container (`D3DXFrameFind` by bone name; a missing bone ends the search),
 *       D3DXFrameCalculateBoundingSphere, SetupDrawFrameList
 *
 * What the exe does afterwards for its GPU skinning (EstimateDrawFrameWorkingPaletteSizeAndBoneNum, ComputeCollisionData, OptimizeDrawFrameMesh,
 * ConvertDrawFrameToSkinnedMesh, ReleaseUnusedInfo) and the texture / XET loading of `_Load` are not part of this port.
 */
import { D3DXFrameCalculateBoundingSphere, D3DXFrameFind, D3DXLoadMeshHierarchyFromXInMemory, D3DXMESH, D3D_OK, E_FAIL } from "@els/d3d9";
import type { D3DXAnimationController, D3DXFrame, Direct3DDevice9 } from "@els/d3d9";
import { isKsmData, loadKSkinnedMesh } from "./ksm-load.ts";
import { CMultiAnimAllocateHierarchy, MultiAnimMC } from "./multianim.ts";
import type { ErrorLog, MultiAnimFrame } from "./multianim.ts";
import { setupDrawFrameList, setupFrameList } from "./skinmesh-frames.ts";
import type { FrameList } from "./skinmesh-frames.ts";

export interface SkinMesh {
  hr: number;
  format: "KSM" | "X";
  /** `m_pFrameRoot` */
  frameRoot: D3DXFrame | null;
  /** `m_apFrameList` (KSM: the file's order; X: SetupFrameList's order) */
  frameList: D3DXFrame[];
  /** `m_apDrawFrameList`: the frames that are drawn (a mesh container, not a COLLISION* / ATTACK* / Bip01_Footsteps* frame) */
  drawFrameList: D3DXFrame[];
  /** `m_pAC` */
  animController: D3DXAnimationController | null;
  /** `m_vCenter`, `m_fMaxBoundingRadius` */
  center: [number, number, number];
  maxBoundingRadius: number;
  /** SetupFrameList's result for X files (null for KSM) */
  frames: FrameList | null;
  /**
   * For tools only: the hierarchy D3DX produced for an X file the exe then refuses (more than 255 frames, `hr` < 0).  The exe destroys it; the inspector
   * can still look at it.
   */
  discarded: { frameRoot: D3DXFrame; animController: D3DXAnimationController | null } | null;
}

const none = (format: SkinMesh["format"], hr: number, frames: FrameList | null = null, discarded: SkinMesh["discarded"] = null): SkinMesh =>
  ({ hr, format, frameRoot: null, frameList: [], drawFrameList: [], animController: null, center: [0, 0, 0], maxBoundingRadius: 0, frames, discarded });

/** `LoadD3DXSkinnedMesh` (L429311). */
export function loadD3DXSkinnedMesh(data: Uint8Array, device: Direct3DDevice9, moveBoneName = "", log: ErrorLog = () => {}): SkinMesh {
  const loaded = D3DXLoadMeshHierarchyFromXInMemory(data, D3DXMESH.MANAGED, device, new CMultiAnimAllocateHierarchy(moveBoneName, log));
  if (loaded.hr < 0 || !loaded.frameRoot) { log(0x157); return none("X", loaded.hr < 0 ? loaded.hr : E_FAIL); }
  const frames = setupFrameList(loaded.frameRoot);
  if (frames.hr < 0) { log(0x158); return none("X", frames.hr, frames, { frameRoot: loaded.frameRoot, animController: loaded.animController }); }
  search:
  for (const frame of frames.frames) {
    const mc = frame.pMeshContainer as MultiAnimMC | null; // only the first container of a frame is looked at
    const skin = mc?.pSkinInfo;
    if (!mc || !skin) continue;
    mc.m_ppBoneFrames = new Array(skin.GetNumBones()).fill(null);
    for (let i = 0; i < skin.GetNumBones(); i++) {
      const bone = D3DXFrameFind(loaded.frameRoot, skin.GetBoneName(i));
      if (!bone) break search; // v16 == 0: the loop over the frames ends (the remaining containers keep no bone frames)
      mc.m_ppBoneFrames[i] = bone;
    }
  }
  const sphere = D3DXFrameCalculateBoundingSphere(loaded.frameRoot);
  return {
    hr: D3D_OK, format: "X", frameRoot: loaded.frameRoot, frameList: frames.frames, drawFrameList: setupDrawFrameList(loaded.frameRoot),
    animController: loaded.animController, center: [sphere.center.x, sphere.center.y, sphere.center.z], maxBoundingRadius: sphere.radius, frames, discarded: null,
  };
}

/** `_Load`'s format test, then `LoadKSkinnedMesh` or `LoadD3DXSkinnedMesh`. */
export function loadSkinnedMesh(data: Uint8Array, device: Direct3DDevice9, moveBoneName = "", log: ErrorLog = () => {}): SkinMesh {
  if (!isKsmData(data)) return loadD3DXSkinnedMesh(data, device, moveBoneName, log);
  const k = loadKSkinnedMesh(data, device, moveBoneName, log);
  if (k.hr < 0 || !k.frameRoot) return none("KSM", k.hr < 0 ? k.hr : E_FAIL);
  return {
    hr: D3D_OK, format: "KSM", frameRoot: k.frameRoot, frameList: k.frameList, drawFrameList: setupDrawFrameList(k.frameRoot),
    animController: k.animController, center: k.center, maxBoundingRadius: k.maxBoundingRadius, frames: null, discarded: null,
  };
}

export type { MultiAnimFrame };
