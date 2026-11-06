/**
 * Census + integrity check of every X/Y file through `loadXScene` (the structural layer under D3DXLoadMeshFromX / HierarchyFromX).
 * Usage: bun run tools/census-xscene.ts
 */
import { loadXScene, walkFrames } from "@els/assets";
import type { XScene } from "@els/assets";
import { indexAllKoms } from "./komindex.ts";

const idx = await indexAllKoms();
const stat = {
  files: 0, notX: 0, errors: 0, meshes: 0, vertices: 0, faces: 0, polygons: 0, frames: 0, multiMesh: 0, skinned: 0, skinnedMeshes: 0, bones: 0, animSets: 0, animations: 0,
  badFaceIndex: 0, badNormalFace: 0, badTexCount: 0, noNormals: 0, noTex: 0, missingMaterial: 0, badSkinVertex: 0, unresolvedBone: 0, unresolvedAnimFrame: 0, unsortedKeys: 0,
  dupFrameNames: 0, nonRigidFrame: 0, withTicks: 0, maxMaterials: 0, maxVertices: 0, vertexColors: 0,
};
const keyKinds = new Map<string, number>();
const errors: string[] = [];
for (const [name, e] of idx) {
  if (!/\.(X|Y)$/.test(name)) continue;
  let bytes: Uint8Array;
  try { bytes = await e.kom.read(e.entry); } catch { stat.errors++; continue; }
  if (!(bytes[0] === 0x78 && bytes[1] === 0x6f && bytes[2] === 0x66)) { stat.notX++; continue; } // KME / KSM
  let scene: XScene;
  try { scene = loadXScene(bytes); } catch (err) { stat.errors++; errors.push(`${name}: ${(err as Error).message}`); continue; }
  stat.files++;
  const frameNames = new Set<string>();
  let meshCount = 0, skinned = false;
  walkFrames(scene.frames, (f) => {
    stat.frames++;
    if (frameNames.has(f.name)) stat.dupFrameNames++;
    frameNames.add(f.name);
    const m = f.matrix;
    // rigid = rows of the 3x3 part orthogonal with equal length (up to the usual float noise)
    const l0 = Math.hypot(m[0]!, m[1]!, m[2]!), l1 = Math.hypot(m[4]!, m[5]!, m[6]!), l2 = Math.hypot(m[8]!, m[9]!, m[10]!);
    if (Math.abs(l0 - 1) > 1e-3 || Math.abs(l1 - 1) > 1e-3 || Math.abs(l2 - 1) > 1e-3) stat.nonRigidFrame++;
    for (const mesh of f.meshes) {
      meshCount++;
      stat.meshes++;
      const nV = mesh.positions.length / 3;
      stat.vertices += nV; stat.faces += mesh.faces.length; stat.maxVertices = Math.max(stat.maxVertices, nV);
      if (mesh.faces.some((q) => q.length > 3)) stat.polygons++;
      if (mesh.faces.some((q) => q.length < 3 || q.some((i) => i >= nV))) stat.badFaceIndex++;
      if (!mesh.normals) stat.noNormals++;
      else if (!mesh.normalFaces || mesh.normalFaces.length !== mesh.faces.length || mesh.normalFaces.some((q, i) => q.length !== mesh.faces[i]!.length || q.some((k) => k >= mesh.normals!.length / 3))) stat.badNormalFace++;
      if (!mesh.texCoords) stat.noTex++;
      else if (mesh.texCoords.length / 2 !== nV) stat.badTexCount++;
      if (mesh.vertexColors) stat.vertexColors++;
      let maxMat = -1;
      for (const k of mesh.faceMaterial) maxMat = Math.max(maxMat, k);
      if (maxMat >= mesh.materials.length) stat.missingMaterial++;
      stat.maxMaterials = Math.max(stat.maxMaterials, mesh.materials.length);
      if (mesh.skin) {
        skinned = true; stat.skinnedMeshes++; stat.bones += mesh.skin.bones.length;
        for (const b of mesh.skin.bones) {
          if (b.vertexIndices.some((i) => i >= nV)) stat.badSkinVertex++;
        }
      }
    }
  });
  if (meshCount > 1) stat.multiMesh++;
  if (skinned) {
    stat.skinned++;
    walkFrames(scene.frames, (f) => { for (const m of f.meshes) for (const b of m.skin?.bones ?? []) if (!frameNames.has(b.name)) stat.unresolvedBone++; });
  }
  for (const s of scene.animationSets) {
    stat.animSets++;
    for (const a of s.animations) {
      stat.animations++;
      if (!frameNames.has(a.frame)) stat.unresolvedAnimFrame++;
      const lists = [a.rotation, a.scale, a.position, a.matrix] as { time: number }[][];
      for (const l of lists) if (l.some((k, i) => i > 0 && k.time < l[i - 1]!.time)) stat.unsortedKeys++;
      const kind = [a.rotation.length ? "R" : "", a.scale.length ? "S" : "", a.position.length ? "T" : "", a.matrix.length ? "M" : ""].join("");
      keyKinds.set(kind, (keyKinds.get(kind) ?? 0) + 1);
    }
  }
  if (scene.ticksPerSecond !== 4800) stat.withTicks++;
}
console.log(JSON.stringify(stat, null, 1));
console.log("animation key kinds:", Object.fromEntries(keyKinds));
if (errors.length) console.log(errors.slice(0, 20).join("\n"));
