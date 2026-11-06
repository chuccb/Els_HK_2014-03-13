/**
 * The scene an X file describes, read the way `D3DXLoadMeshFromX` / `D3DXLoadMeshHierarchyFromX` see it: a forest of frames with a
 * local transform each, meshes attached to frames, optional skin weights per mesh, and animation sets that drive frame transforms.
 * Built on the generic reader (`xfile.ts`); this layer only knows the standard DirectX templates (Frame, FrameTransformMatrix, Mesh,
 * MeshNormals, MeshTextureCoords, MeshVertexColors, MeshMaterialList, Material, TextureFilename, XSkinMeshHeader, SkinWeights,
 * VertexDuplicationIndices, AnimationSet, Animation, AnimationKey, AnimTicksPerSecond).
 *
 * Census of the shipped data (25,313 X/Y files, `tools/census-xscene.ts`): every mesh has normals, texture coordinates and a
 * material list (0 with MeshVertexColors but one), 14,151 files hold several meshes, 7,395 are skinned, 5,341 carry animation sets;
 * only 21 meshes sit outside a Frame.  72 meshes (`UI_AD_*.X`) carry an `FVFData` object of per-vertex DWORDs for an XYZB4 |
 * LASTBETA_D3DCOLOR vertex; it is ignored here (D3DX would append it to the vertex).
 *
 * Conventions kept from the file: matrices are row-major with the translation in the last row (D3D); quaternion keys are stored
 * w, x, y, z; times are in animation ticks.
 */
import { decompressXFile, isCompressedXFile } from "./mszip.ts";
import { parseXFile } from "./xfile.ts";
import type { XNode, XObject, XValue } from "./xfile.ts";

export interface XMaterial {
  /** faceColor (RGBA) */
  diffuse: [number, number, number, number];
  power: number;
  specular: [number, number, number];
  emissive: [number, number, number];
  textureFilename: string | null;
}

export interface XSkinBone {
  /** name of the frame whose transform moves this bone */
  name: string;
  vertexIndices: Uint32Array;
  weights: Float32Array;
  /** `matrixOffset`: mesh space -> bone space */
  offset: Float32Array;
}

export interface XMeshData {
  name: string;
  /** 3 floats per vertex */
  positions: Float32Array;
  /** one array of vertex indices per face (3 or more) */
  faces: number[][];
  /** 3 floats per normal and, per face, the normal index of every corner (MeshNormals.faceNormals) */
  normals: Float32Array | null;
  normalFaces: number[][] | null;
  /** 2 floats per vertex */
  texCoords: Float32Array | null;
  /** 4 floats (RGBA) per vertex, unset vertices are 1,1,1,1 (what D3DX uses for MeshVertexColors gaps) */
  vertexColors: Float32Array | null;
  /** material index per face (always faces.length entries) */
  faceMaterial: Uint32Array;
  materials: XMaterial[];
  skin: { maxWeightsPerVertex: number; maxWeightsPerFace: number; bones: XSkinBone[] } | null;
  /** VertexDuplicationIndices.indices: for every vertex the index of the vertex it was split from */
  duplicationIndices: Uint32Array | null;
}

export interface XFrameData {
  name: string;
  /** FrameTransformMatrix (identity when absent): this frame relative to its parent */
  matrix: Float32Array;
  children: XFrameData[];
  meshes: XMeshData[];
  /** true for the frame this reader makes up around a top-level Mesh (D3DX creates that frame with a NULL name; the mesh keeps its own name) */
  synthetic?: boolean;
}

/** One animated frame: the key lists that were present (`AnimationKey` keyType 0 rotation, 1 scale, 2 position, 3 and 4 matrix). */
export interface XAnimation {
  /** name of the animated frame (from the `{ Frame }` reference) */
  frame: string;
  rotation: { time: number; q: [number, number, number, number] }[];
  scale: { time: number; v: [number, number, number] }[];
  position: { time: number; v: [number, number, number] }[];
  matrix: { time: number; m: Float32Array }[];
  /** AnimationOptions (openclosed, positionquality) when present */
  options?: { openClosed: number; positionQuality: number };
}
export interface XAnimationSet { name: string; animations: XAnimation[] }

export interface XScene {
  /** top-level frames (a top-level Mesh gets a synthetic frame named after the mesh with an identity transform) */
  frames: XFrameData[];
  animationSets: XAnimationSet[];
  /** `AnimTicksPerSecond`, 4800 when the file has none (the D3DX default) */
  ticksPerSecond: number;
  format: "txt" | "bin";
}

const num = (v: XValue | undefined, d = 0): number => (typeof v === "number" ? v : d);
const obj = (v: XValue | undefined): { [k: string]: XValue } => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arr = (v: XValue | undefined): XValue[] => (Array.isArray(v) ? v : []);

function matrixOf(v: XValue | undefined): Float32Array {
  const m = arr(obj(v).matrix);
  const out = new Float32Array(16);
  for (let i = 0; i < 16; i++) out[i] = num(m[i]);
  return out;
}

function parseMaterial(o: XObject): XMaterial {
  const d = o.data;
  const fc = obj(d.faceColor), sp = obj(d.specularColor), em = obj(d.emissiveColor);
  let tex: string | null = null;
  for (const c of o.children) if (c.kind === "object" && c.type === "TextureFilename" && typeof c.data.filename === "string") tex = c.data.filename;
  return {
    diffuse: [num(fc.red), num(fc.green), num(fc.blue), num(fc.alpha)], power: num(d.power),
    specular: [num(sp.red), num(sp.green), num(sp.blue)], emissive: [num(em.red), num(em.green), num(em.blue)], textureFilename: tex,
  };
}

function parseMesh(o: XObject): XMeshData {
  const d = o.data;
  const nV = num(d.nVertices);
  const positions = new Float32Array(nV * 3);
  arr(d.vertices).forEach((v, i) => { const p = obj(v); positions[i * 3] = num(p.x); positions[i * 3 + 1] = num(p.y); positions[i * 3 + 2] = num(p.z); });
  const faces = arr(d.faces).map((f) => arr(obj(f).faceVertexIndices).map((x) => num(x)));
  const mesh: XMeshData = {
    name: o.name, positions, faces, normals: null, normalFaces: null, texCoords: null, vertexColors: null,
    faceMaterial: new Uint32Array(faces.length), materials: [], skin: null, duplicationIndices: null,
  };
  const bones: XSkinBone[] = [];
  let skinHeader = { maxWeightsPerVertex: 0, maxWeightsPerFace: 0 };
  for (const c of o.children) {
    if (c.kind !== "object") continue;
    const cd = c.data;
    switch (c.type) {
      case "MeshNormals": {
        const ns = arr(cd.normals);
        mesh.normals = new Float32Array(ns.length * 3);
        ns.forEach((v, i) => { const p = obj(v); mesh.normals![i * 3] = num(p.x); mesh.normals![i * 3 + 1] = num(p.y); mesh.normals![i * 3 + 2] = num(p.z); });
        mesh.normalFaces = arr(cd.faceNormals).map((f) => arr(obj(f).faceVertexIndices).map((x) => num(x)));
        break;
      }
      case "MeshTextureCoords": {
        const ts = arr(cd.textureCoords);
        mesh.texCoords = new Float32Array(ts.length * 2);
        ts.forEach((v, i) => { const p = obj(v); mesh.texCoords![i * 2] = num(p.u); mesh.texCoords![i * 2 + 1] = num(p.v); });
        break;
      }
      case "MeshVertexColors": {
        mesh.vertexColors = new Float32Array(nV * 4).fill(1);
        for (const e of arr(cd.vertexColors)) {
          const p = obj(e), col = obj(p.indexColor), idx = num(p.index);
          if (idx >= 0 && idx < nV) { mesh.vertexColors[idx * 4] = num(col.red); mesh.vertexColors[idx * 4 + 1] = num(col.green); mesh.vertexColors[idx * 4 + 2] = num(col.blue); mesh.vertexColors[idx * 4 + 3] = num(col.alpha); }
        }
        break;
      }
      case "MeshMaterialList": {
        const idx = arr(cd.faceIndexes).map((x) => num(x));
        // one entry applies to every face (X spec); a short list leaves the remaining faces on material 0
        for (let f = 0; f < faces.length; f++) mesh.faceMaterial[f] = idx.length === 1 ? idx[0]! : (idx[f] ?? 0);
        for (const m of c.children) {
          if (m.kind === "object" && m.type === "Material") mesh.materials.push(parseMaterial(m));
          else if (m.kind === "ref" && m.target && m.target.type === "Material") mesh.materials.push(parseMaterial(m.target));
        }
        break;
      }
      case "VertexDuplicationIndices": mesh.duplicationIndices = Uint32Array.from(arr(cd.indices).map((x) => num(x))); break;
      case "XSkinMeshHeader": skinHeader = { maxWeightsPerVertex: num(cd.nMaxSkinWeightsPerVertex), maxWeightsPerFace: num(cd.nMaxSkinWeightsPerFace) }; break;
      case "SkinWeights":
        bones.push({
          name: typeof cd.transformNodeName === "string" ? cd.transformNodeName : "",
          vertexIndices: Uint32Array.from(arr(cd.vertexIndices).map((x) => num(x))), weights: Float32Array.from(arr(cd.weights).map((x) => num(x))), offset: matrixOf(cd.matrixOffset),
        });
        break;
    }
  }
  if (bones.length) mesh.skin = { ...skinHeader, bones };
  return mesh;
}

function parseFrame(o: XObject, active: readonly XObject[] = []): XFrameData {
  const f: XFrameData = { name: o.name, matrix: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), children: [], meshes: [] };
  const stack = [...active, o];
  for (const c of o.children) {
    // D3DX enumerates a `{ Name }` reference like the object it points to (none of the shipped files has one inside a Frame; the guard stops a frame that contains itself)
    const obj_ = c.kind === "ref" ? c.target : c;
    if (!obj_ || obj_.kind !== "object") continue;
    if (obj_.type === "FrameTransformMatrix") f.matrix = matrixOf(obj_.data.frameMatrix);
    else if (obj_.type === "Frame") { if (!stack.includes(obj_)) f.children.push(parseFrame(obj_, stack)); }
    else if (obj_.type === "Mesh") f.meshes.push(parseMesh(obj_));
  }
  return f;
}

function parseAnimation(o: XObject): XAnimation {
  const a: XAnimation = { frame: "", rotation: [], scale: [], position: [], matrix: [] };
  for (const c of o.children) {
    if (c.kind === "ref") { if (!a.frame) a.frame = c.name; continue; }
    if (c.type === "Frame" && !a.frame) { a.frame = c.name; continue; }
    if (c.type === "AnimationOptions") { a.options = { openClosed: num(c.data.openclosed), positionQuality: num(c.data.positionquality) }; continue; }
    if (c.type !== "AnimationKey") continue;
    const type = num(c.data.keyType);
    for (const k of arr(c.data.keys)) {
      const key = obj(k), time = num(key.time), vals = arr(obj(key.tfkeys).values).map((x) => num(x));
      if (type === 0) a.rotation.push({ time, q: [vals[0] ?? 1, vals[1] ?? 0, vals[2] ?? 0, vals[3] ?? 0] });
      else if (type === 1) a.scale.push({ time, v: [vals[0] ?? 1, vals[1] ?? 1, vals[2] ?? 1] });
      else if (type === 2) a.position.push({ time, v: [vals[0] ?? 0, vals[1] ?? 0, vals[2] ?? 0] });
      else a.matrix.push({ time, m: Float32Array.from({ length: 16 }, (_, i) => vals[i] ?? 0) });
    }
  }
  return a;
}

/** Decode (MSZIP when the header says so), parse and interpret an X file. */
export function loadXScene(bytes: Uint8Array): XScene {
  const raw = isCompressedXFile(bytes) ? decompressXFile(bytes) : bytes;
  const file = parseXFile(raw);
  const scene: XScene = { frames: [], animationSets: [], ticksPerSecond: 4800, format: file.format };
  for (const o of file.objects) {
    switch (o.type) {
      case "Frame": scene.frames.push(parseFrame(o)); break;
      case "Mesh": {
        const m = parseMesh(o);
        scene.frames.push({ name: o.name, matrix: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), children: [], meshes: [m], synthetic: true });
        break;
      }
      case "AnimTicksPerSecond": scene.ticksPerSecond = num(o.data.AnimTicksPerSecond, 4800); break;
      case "AnimationSet": scene.animationSets.push({ name: o.name, animations: o.children.filter((c): c is XObject => c.kind === "object" && c.type === "Animation").map(parseAnimation) }); break;
    }
  }
  return scene;
}

/** Visit every frame depth first. */
export function walkFrames(frames: readonly XFrameData[], visit: (f: XFrameData, parent: XFrameData | null, depth: number) => void, parent: XFrameData | null = null, depth = 0): void {
  for (const f of frames) { visit(f, parent, depth); walkFrames(f.children, visit, f, depth + 1); }
}

export type { XNode };
