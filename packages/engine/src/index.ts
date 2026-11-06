/** `@els/engine`: the engine classes (CKTDX* / CKTDG*) over the D3D9 layer, ported one function at a time from x2.exe (docs/ROADMAP.md Phase 3 "engine classes"). */
export {
  MAX_FRAMES, isCollisionFrameName, isNoDrawFrameName, setupFrameList, setupDrawFrameList, collisionFrames,
} from "./skinmesh-frames.ts";
export type { FrameList, FrameListError } from "./skinmesh-frames.ts";
export { NO_NAME, MAX_PALETTE_ENTRIES, MultiAnimFrame, MultiAnimMC, CMultiAnimAllocateHierarchy } from "./multianim.ts";
export type { ErrorLog } from "./multianim.ts";
export { KSM_CONTROLLER_TRACKS, KSM_CONTROLLER_EVENTS, isKsmData, readKSM, readKacController, loadKSkinnedMesh } from "./ksm-load.ts";
export type { KSkinnedMesh } from "./ksm-load.ts";
export { KAC_OPTIMIZE_TOLERANCE, optimizeKeys, prepareKeys } from "./kac-keys.ts";
export type { KeyArrays, OptimizeOptions, PreparedKeys } from "./kac-keys.ts";
export { loadSkinnedMesh, loadD3DXSkinnedMesh } from "./skinmesh.ts";
export type { SkinMesh } from "./skinmesh.ts";
export { XMESH_FVF, isKmeData, loadXMesh, loadD3DXMesh, loadKMEMesh, xmeshAsFrame } from "./xmesh.ts";
export type { XMeshProxy, SubsetCullingInfo } from "./xmesh.ts";
