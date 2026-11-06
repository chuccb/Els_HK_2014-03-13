/**
 * The frame lists `CKTDXDeviceXSkinMesh::XSkinMeshProxy` builds after `D3DXLoadMeshHierarchyFromXInMemory` (x2.exe.c):
 *
 *   LoadD3DXSkinnedMesh  L429311   hierarchy load with options 544 (= D3DXMESH_MANAGED), then
 *     SetupFrameList        L430693   m_apFrameList[255]: every frame, depth first, siblings before children
 *     (bone frames)         L429385   per skinned container: D3DXFrameFind for every bone name
 *     D3DXFrameCalculateBoundingSphere -> m_vCenter / m_fMaxBoundingRadius
 *     SetupDrawFrameList    L430592   m_apDrawFrameList[255]: the frames that are drawn
 *     ComputeCollisionData  L428384   AddCollisionData (L427598) for the frames named COLLISION* / ATTACK*
 *
 * The model files carry helper frames (`ATTACK_LINE_START0_Sword`, `ATTACK_LINE_END0`, `ATTACK_SPHERE*`, `COLLISION*`, `Bip01_Footsteps*`)
 * with box / sphere meshes: they feed the collision data and are never drawn, and everything below them is skipped by SetupDrawFrameList.
 * The name tests are byte comparisons in the exe (prefix and minimum length), case sensitive.
 */
import type { D3DXFrame } from "@els/d3d9";

/** `m_apFrameList` / `m_apDrawFrameList` have 255 entries; SetupFrameList fails on the 256th frame. */
export const MAX_FRAMES = 255;
const E_FAIL = 0x80004005 | 0;

const startsWith = (name: string, prefix: string): boolean => name.length >= prefix.length && name.startsWith(prefix);

/** names `ComputeCollisionData` / `SetupDrawFrameList` treat as collision frames: "COLLISION" (9 bytes) or "ATTACK" (6 bytes) */
export function isCollisionFrameName(name: string | null | undefined): boolean {
  return !!name && (startsWith(name, "COLLISION") || startsWith(name, "ATTACK"));
}

/** frames that are not drawn and whose children are not visited: the collision frames and "Bip01_Footsteps" (15 bytes) */
export function isNoDrawFrameName(name: string | null | undefined): boolean {
  return isCollisionFrameName(name) || (!!name && startsWith(name, "Bip01_Footsteps"));
}

export interface FrameListError {
  /** `CKTDXLog::PushErrorLog` id the exe uses: 0xD4 = more than one mesh container in a frame, 0x15C = more than 255 frames */
  code: number;
  frame: string | null;
}
export interface FrameList {
  /** 0, or E_FAIL when the hierarchy has more than 255 frames (the exe then refuses to load the mesh) */
  hr: number;
  frames: D3DXFrame[];
  errors: FrameListError[];
}

/** `SetupFrameList(root)`: the frame, then its sibling chain (recursively), then its first child's subtree. */
export function setupFrameList(root: D3DXFrame | null): FrameList {
  const out: FrameList = { hr: 0, frames: [], errors: [] };
  const visit = (frame: D3DXFrame): number => {
    if (out.frames.length >= MAX_FRAMES) { out.errors.push({ code: 0x15c, frame: frame.Name }); return E_FAIL; }
    out.frames.push(frame);
    if (frame.pMeshContainer?.pNextMeshContainer) out.errors.push({ code: 0xd4, frame: frame.Name });
    if (frame.pFrameSibling) { const r = visit(frame.pFrameSibling); if (r < 0) return r; }
    if (frame.pFrameFirstChild && visit(frame.pFrameFirstChild) < 0) return E_FAIL;
    return 0;
  };
  if (root) out.hr = visit(root);
  return out;
}

/**
 * `SetupDrawFrameList(root)`: the frames with a mesh container, except those named COLLISION* / ATTACK* / Bip01_Footsteps*;
 * the children of such a frame are not visited at all (whether or not it carries a mesh).  Order: the frame, its siblings, its children.
 */
export function setupDrawFrameList(root: D3DXFrame | null): D3DXFrame[] {
  const out: D3DXFrame[] = [];
  const visit = (start: D3DXFrame): void => {
    for (let frame: D3DXFrame | null = start; frame; ) {
      const noDraw = isNoDrawFrameName(frame.Name);
      if (frame.pMeshContainer && !noDraw && out.length < MAX_FRAMES) out.push(frame);
      if (frame.pFrameSibling) visit(frame.pFrameSibling);
      if (!frame.pFrameFirstChild || noDraw) return;
      frame = frame.pFrameFirstChild;
    }
  };
  if (root) visit(root);
  return out;
}

/** the frames of `ComputeCollisionData`: every entry of the frame list named COLLISION* or ATTACK* (the exe turns them into CT_SPHERE / CT_GUARD / attack-line data) */
export function collisionFrames(frames: readonly D3DXFrame[]): D3DXFrame[] {
  return frames.filter((f) => isCollisionFrameName(f.Name));
}
