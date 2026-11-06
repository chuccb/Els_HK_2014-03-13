/**
 * Skinned meshes in KOG's own format, turned into the D3DX objects the engine works with (x2.exe.c):
 *
 *   XSkinMeshProxy::LoadKSkinnedMesh        3296EBB0 (L429515)  frames, mesh containers, animation controller
 *   MultiAnimMC::ReadKSM                    3296F7B0 (L430172)  one mesh container: ID3DXMesh + ID3DXSkinInfo
 *   KTDXAnimationController::ReadFromMemory 32988150 (L448687)  ID3DXAnimationController with one keyframed set per KAC set
 *   ReadFromMemoryDeserializer              32989F10 (L450334)  one set (keys: UnpackKeys, OptimizeKeys -> RegisterAnimationSRTKeys)
 *
 * The bytes are decoded by `parseKsm` / `parseKac` (@els/assets); this module is the part that talks to Direct3D.  The exe fails with E_FAIL and an
 * error log id at the first problem; the parser reports the same conditions as `KFormatError`, which becomes E_FAIL here.
 */
import { KFormatError, parseKsm } from "@els/assets";
import type { KacFile, KsmFile, KsmMeshContainer } from "@els/assets";
import {
  D3DXCreateAnimationController, D3DXCreateKeyframedAnimationSet, D3DXCreateMeshFVF, D3DXCreateSkinInfoFVF, D3DXFrameNumNamedMatrices,
  D3DXFrameRegisterNamedMatrices, D3DXMESH, D3DXMESHTYPE, D3D_OK, E_FAIL,
} from "@els/d3d9";
import type { D3DXAnimationController, D3DXFrame, D3DXMaterial, Direct3DDevice9 } from "@els/d3d9";
import { prepareKeys } from "./kac-keys.ts";
import { CMultiAnimAllocateHierarchy, MultiAnimFrame, MultiAnimMC } from "./multianim.ts";
import type { ErrorLog } from "./multianim.ts";

/** The animation controller of a KSM has two tracks and room for 30 events (L448740: `D3DXCreateAnimationController(n, sets, 2, 30)`). */
export const KSM_CONTROLLER_TRACKS = 2;
export const KSM_CONTROLLER_EVENTS = 30;

export interface KSkinnedMesh {
  hr: number;
  /** `m_pFrameRoot` = frame 0 */
  frameRoot: MultiAnimFrame | null;
  /** `m_apFrameList` in file order (the file's frame indices) */
  frameList: MultiAnimFrame[];
  /** `m_pAC`; null when the file has no animation block */
  animController: D3DXAnimationController | null;
  /** `m_vCenter` / `m_fMaxBoundingRadius`: stored in the file header (the X path computes them with D3DXFrameCalculateBoundingSphere) */
  center: [number, number, number];
  maxBoundingRadius: number;
  /** the parse result (frame names, raw keys), for tools */
  file: KsmFile | null;
}

const failed = (hr: number = E_FAIL): KSkinnedMesh => ({ hr, frameRoot: null, frameList: [], animController: null, center: [0, 0, 0], maxBoundingRadius: 0, file: null });

/** True when the data starts with "KSM " (`_Load`: `size >= 4 && *(DWORD*)data == 541938507`). */
export function isKsmData(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x4b && data[1] === 0x53 && data[2] === 0x4d && data[3] === 0x20;
}

/**
 * `MultiAnimMC::ReadKSM`: the mesh (`D3DXCreateMeshFVF` with the file's 32-bit flag + D3DXMESH_MANAGED, vertices / indices / attributes copied,
 * adjacency generated), the materials and, when there are bones, the skin info (bone name = the name of the bone's frame, offset matrix,
 * influences) with `m_ppBoneFrames` taken from the frame indices.  Null on failure (the exe's E_FAIL).
 */
export function readKSM(c: KsmMeshContainer, frameList: readonly D3DXFrame[], device: Direct3DDevice9, log: ErrorLog = () => {}): MultiAnimMC | null {
  const mc = new MultiAnimMC();
  mc.Name = c.name;
  mc.NumMaterials = c.materials.length;
  mc.pMaterials = c.materials.map((m): D3DXMaterial => ({
    MatD3D: {
      diffuse: { r: m.diffuse[0], g: m.diffuse[1], b: m.diffuse[2], a: m.diffuse[3] }, ambient: { r: m.ambient[0], g: m.ambient[1], b: m.ambient[2], a: m.ambient[3] },
      specular: { r: m.specular[0], g: m.specular[1], b: m.specular[2], a: m.specular[3] }, emissive: { r: m.emissive[0], g: m.emissive[1], b: m.emissive[2], a: m.emissive[3] },
      power: m.power,
    },
    pTextureFilename: m.texture,
  }));
  mc.m_apTextures = new Array(mc.NumMaterials).fill(null);

  const created = D3DXCreateMeshFVF(c.faceCount, c.vertexCount, (c.options & 1) | D3DXMESH.MANAGED, c.fvf, device);
  if (created.hr < 0 || !created.mesh) { log(0x106); return null; }
  const mesh = created.mesh;
  mc.MeshData = { Type: D3DXMESHTYPE.MESH, pMesh: mesh };
  if (mesh.GetNumBytesPerVertex() !== c.vertexStride) { log(0x108); return null; }
  const vb = mesh.LockVertexBuffer(0);
  if (vb.hr < 0 || !vb.data) { log(0x10a); return null; }
  vb.data.set(c.vertices);
  if (mesh.UnlockVertexBuffer() < 0) log(0x10b);
  const ib = mesh.LockIndexBuffer(0);
  if (ib.hr < 0 || !ib.data) { log(0x10e); return null; }
  ib.data.set(new Uint8Array(c.indices.buffer, c.indices.byteOffset, c.indices.byteLength));
  if (mesh.UnlockIndexBuffer() < 0) log(0x10f);
  const ab = mesh.LockAttributeBuffer(0);
  if (ab.hr < 0 || !ab.data) { log(0x112); return null; }
  ab.data.set(c.attributes);
  if (mesh.UnlockAttributeBuffer() < 0) log(0x113);
  mc.pAdjacency = mesh.GenerateAdjacency(0);

  if (c.bones.length === 0) return mc; // m_dwNumBones = 0, no skin info, no palette
  const skin = D3DXCreateSkinInfoFVF(c.vertexCount, c.fvf, c.bones.length);
  if (skin.hr < 0 || !skin.skinInfo) { log(0x117); return null; }
  const si = skin.skinInfo;
  mc.pSkinInfo = si;
  mc.m_dwNumBones = c.bones.length;
  mc.m_amxBoneOffsets = [];
  mc.m_ppBoneFrames = [];
  for (let i = 0; i < c.bones.length; i++) {
    const b = c.bones[i]!;
    mc.m_amxBoneOffsets.push(Float32Array.from(b.offsetMatrix));
    const frame = frameList[b.frameIndex];
    if (!frame) { log(0x11a); return null; }
    mc.m_ppBoneFrames.push(frame);
    if (frame.Name !== null && si.SetBoneName(i, frame.Name) < 0) log(0x11c);
    if (si.SetBoneOffsetMatrix(i, mc.m_amxBoneOffsets[i]!) < 0) log(0x11d);
    if (b.vertexIndices.length !== 0 && si.SetBoneInfluence(i, b.vertexIndices, b.weights) < 0) log(0x120);
  }
  mc.m_dwNumPaletteEntries = c.numPaletteEntries;
  return mc;
}

/**
 * `KTDXAnimationController::ReadFromMemory` + `ReadFromMemoryDeserializer`: the controller gets one keyframed set per KAC set; every animation of a set
 * is registered under the *name* of its frame (so frames with the same name share keys), and the frames' matrices become the controller's outputs.
 * Compressed sets (`D3DXCreateCompressedAnimationSet`) do not occur in the data and are not supported (E_FAIL).
 */
export function readKacController(kac: KacFile, frameList: readonly D3DXFrame[], root: D3DXFrame | null, log: ErrorLog = () => {}): { hr: number; controller: D3DXAnimationController | null } {
  const created = D3DXCreateAnimationController(D3DXFrameNumNamedMatrices(root), kac.sets.length, KSM_CONTROLLER_TRACKS, KSM_CONTROLLER_EVENTS);
  if (created.hr < 0 || !created.controller) { log(0x194); return { hr: created.hr, controller: null }; }
  const controller = created.controller;
  const readSet = (s: KacFile["sets"][number]): number => {
    if (s.kind !== "keyframed") { log(0x1a4); return E_FAIL; }
    const set = D3DXCreateKeyframedAnimationSet(s.name, s.ticksPerSecond, s.playbackType, s.animations.length);
    if (set.hr < 0 || !set.set) { log(0x19b); return E_FAIL; }
    for (const a of s.animations) {
      const frame = frameList[a.frameIndex];
      if (!frame || frame.Name === null) { log(0x19d); return E_FAIL; }
      const keys = prepareKeys(a);
      if (set.set.RegisterAnimationSRTKeys(frame.Name, keys.scales, keys.rotations, keys.translations).hr < 0) { log(0x19e); return E_FAIL; }
    }
    if (controller.RegisterAnimationSet(set.set) < 0) { log(0x19f); return E_FAIL; }
    return D3D_OK;
  };
  for (const s of kac.sets) if (readSet(s) < 0) { log(0x195); return { hr: E_FAIL, controller: null }; }
  const hr = D3DXFrameRegisterNamedMatrices(root, controller);
  if (hr < 0) { log(0x196); return { hr, controller: null }; }
  return { hr: D3D_OK, controller };
}

/**
 * `LoadKSkinnedMesh(pInData_, dwInSize_)`: header (magic, version 512, centre, max radius, <= 255 frames) -> frames through
 * `CMultiAnimAllocateHierarchy::CreateFrame` (name, matrix, bounding radius, index) -> sibling / first child links (frame 0 must be the root and
 * every other frame referenced exactly once) -> `ReadKSM` for every frame with a container offset -> the animation controller.
 * (The exe then runs SetupDrawFrameList ... ConvertDrawFrameToSkinnedMesh; see `loadSkinnedMesh`.)
 */
export function loadKSkinnedMesh(data: Uint8Array, device: Direct3DDevice9, moveBoneName = "", log: ErrorLog = () => {}): KSkinnedMesh {
  let file: KsmFile;
  try { file = parseKsm(data); } catch (e) {
    if (!(e instanceof KFormatError)) throw e;
    log(0xe2, e.message);
    return failed();
  }
  const alloc = new CMultiAnimAllocateHierarchy(moveBoneName, log);
  const frameList: MultiAnimFrame[] = [];
  file.frames.forEach((f, i) => {
    const frame = alloc.CreateFrame(f.name).frame as MultiAnimFrame;
    frame.TransformationMatrix = Float32Array.from(f.matrix);
    frame.m_iIndex = i;
    frame.fBoundingRadius = f.boundingRadius;
    frameList.push(frame);
  });
  file.frames.forEach((f, i) => {
    frameList[i]!.pFrameSibling = f.sibling >= 0 ? frameList[f.sibling]! : null;
    frameList[i]!.pFrameFirstChild = f.firstChild >= 0 ? frameList[f.firstChild]! : null;
  });
  const root = frameList[0] ?? null;
  for (let i = 0; i < file.frames.length; i++) {
    const c = file.frames[i]!.meshContainer;
    if (!c) continue;
    const mc = readKSM(c, frameList, device, log);
    if (!mc) { log(0xf2); return failed(); }
    frameList[i]!.pMeshContainer = mc;
  }
  let animController: D3DXAnimationController | null = null;
  if (file.animation) {
    const r = readKacController(file.animation, frameList, root, log);
    if (r.hr < 0) { log(0xf6); return failed(r.hr); }
    animController = r.controller;
  }
  return { hr: D3D_OK, frameRoot: root, frameList, animController, center: [...file.center], maxBoundingRadius: file.maxBoundingRadius, file };
}
