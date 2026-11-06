/**
 * Census of the skinned / animated X files through the D3DX hierarchy layer (`D3DXLoadMeshHierarchyFromXInMemory`, skin info,
 * `ConvertToIndexedBlendedMesh`, the animation controller): the numbers behind FINDINGS 12.4.
 * Usage: ./tools/gpu.sh bun run tools/census-skin.ts [maxFiles]
 */
import { loadXScene, walkFrames } from "@els/assets";
import { D3DXFrameFind, D3DXLoadMeshHierarchyFromXInMemory, D3DXMESH, D3DXMESHTYPE, D3DDECLUSAGE, fvfToElements, matIdentity } from "../packages/d3d9/src/index.ts";
import type { D3DXFrame, D3DXMeshContainer, ID3DXAllocateHierarchy } from "../packages/d3d9/src/index.ts";
import { Direct3DDevice9 } from "../packages/d3d9/src/index.ts";
import { indexAllKoms } from "./komindex.ts";
import { newD3D9 } from "../packages/d3d9/test/gpu-helper.ts";

const limit = Number(process.argv[2] ?? Infinity);
const idx = await indexAllKoms();
const dev: Direct3DDevice9 = await newD3D9(4, 4);
const alloc: ID3DXAllocateHierarchy = {
  CreateFrame: (n) => ({ hr: 0, frame: { Name: n, TransformationMatrix: matIdentity(), pMeshContainer: null, pFrameSibling: null, pFrameFirstChild: null } }),
  CreateMeshContainer: (n, md, mats, _e, nm, adj, skin) => ({ hr: 0, container: { Name: n, MeshData: md, pMaterials: mats, pEffects: null, NumMaterials: nm, pAdjacency: adj, pSkinInfo: skin, pNextMeshContainer: null } as D3DXMeshContainer }),
  DestroyFrame: () => 0,
  DestroyMeshContainer: (c) => { c.MeshData.pMesh?.Release(); return 0; },
};
const hist = (m: Map<number, number>, k: number): void => { m.set(k, (m.get(k) ?? 0) + 1); };
const fmt = (m: Map<number, number>): string => [...m].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ");

const s = {
  files: 0, loadFail: 0, containers: 0, skinned: 0, unresolvedBones: 0, dupBoneFrames: 0, fvfMismatch: 0, zeroInfluenceVertices: 0, weightSumOff: 0, convFail: 0, convFailMore20: 0, invariantFail: 0,
  animFiles: 0, animFrames: 0, restMatch: 0, restMismatch: 0, noOutputSet: 0, over4: 0, verticesOver4: 0, verts: 0, outVerts: 0, combos: 0, meshesTotal: 0,
};
const maxInfl = new Map<number, number>(), maxFaceInfl = new Map<number, number>(), combosPer = new Map<number, number>(), bonesPer = new Map<number, number>();
const examples: string[] = [];
let n = 0;
for (const [name, e] of idx) {
  if (!/\.(X|Y)$/.test(name)) continue;
  const bytes = await e.kom.read(e.entry);
  if (!(bytes[0] === 0x78 && bytes[1] === 0x6f && bytes[2] === 0x66)) continue;
  let skinnedFile = false;
  try { const sc = loadXScene(bytes); walkFrames(sc.frames, (f) => { for (const m of f.meshes) if (m.skin) skinnedFile = true; }); } catch { continue; }
  if (!skinnedFile) continue;
  if (++n > limit) break;
  s.files++;
  const r = D3DXLoadMeshHierarchyFromXInMemory(bytes, D3DXMESH.MANAGED, dev, alloc);
  if (r.hr < 0 || !r.frameRoot) { s.loadFail++; examples.push(`${name}: load hr ${r.hr}`); continue; }
  const frames: D3DXFrame[] = [];
  (function walk(f: D3DXFrame | null) { for (; f; f = f.pFrameSibling) { frames.push(f); walk(f.pFrameFirstChild); } })(r.frameRoot);
  for (const f of frames) for (let c = f.pMeshContainer; c; c = c.pNextMeshContainer) {
    s.containers++;
    const mesh = c.MeshData.pMesh!; s.meshesTotal++;
    if (c.MeshData.Type !== D3DXMESHTYPE.MESH) continue;
    const si = c.pSkinInfo;
    if (!si) continue;
    s.skinned++;
    hist(bonesPer, Math.min(si.GetNumBones(), 40));
    if (si.GetFVF() !== mesh.GetFVF()) s.fvfMismatch++;
    for (let b = 0; b < si.GetNumBones(); b++) {
      const bn = si.GetBoneName(b)!;
      const found = D3DXFrameFind(r.frameRoot, bn);
      if (!found) { s.unresolvedBones++; examples.push(`${name}: bone ${bn} has no frame`); }
      else if (frames.filter((x) => x.Name === bn).length > 1) s.dupBoneFrames++;
    }
    // weights per vertex
    const wsum = new Float64Array(si.numVertices), cnt = new Uint8Array(si.numVertices);
    for (let b = 0; b < si.GetNumBones(); b++) { const inf = si.GetBoneInfluence(b)!; inf.vertices.forEach((v, k) => { wsum[v]! += inf.weights[k]!; if (inf.weights[k]! > si.GetMinBoneInfluence()) cnt[v]!++; }); }
    for (let v = 0; v < si.numVertices; v++) { if (cnt[v] === 0) s.zeroInfluenceVertices++; else if (Math.abs(wsum[v]! - 1) > 1e-3) s.weightSumOff++; }
    const m = si.GetMaxVertexInfluences(); hist(maxInfl, m); if (m > 4) { s.over4++; for (let v = 0; v < si.numVertices; v++) if (cnt[v]! > 4) s.verticesOver4++; examples.push(`${name}: max vertex influences ${m}`); }
    const mf = si.GetMaxFaceInfluences(mesh.indices(), mesh.GetNumFaces()); hist(maxFaceInfl, mf);
    const palette = Math.min(si.GetNumBones(), 20);
    const conv = si.ConvertToIndexedBlendedMesh(mesh, D3DXMESH.MANAGED, palette);
    if (conv.hr < 0 || !conv.mesh) { s.convFail++; if (mf > 20) s.convFailMore20++; examples.push(`${name}: convert failed (bones ${si.GetNumBones()}, face infl ${mf}, palette ${palette})`); continue; }
    s.verts += mesh.GetNumVertices(); s.outVerts += conv.mesh.GetNumVertices(); s.combos += conv.boneCombinations.length; hist(combosPer, Math.min(conv.boneCombinations.length, 20));
    // invariant: every output vertex reproduces the influences of its origin
    const out = conv.mesh, el = fvfToElements(out.GetFVF()).elements, wEl = el.find((x) => x.usage === D3DDECLUSAGE.BLENDWEIGHT), iEl = el.find((x) => x.usage === D3DDECLUSAGE.BLENDINDICES)!;
    const st = out.GetNumBytesPerVertex(), dv = new DataView(out.vb.cpu.buffer, out.vb.cpu.byteOffset, out.vb.cpu.byteLength);
    const inflOf: Map<number, number>[] = Array.from({ length: si.numVertices }, () => new Map());
    for (let b = 0; b < si.GetNumBones(); b++) { const inf = si.GetBoneInfluence(b)!; inf.vertices.forEach((v, k) => { if (inf.weights[k]! > si.GetMinBoneInfluence()) inflOf[v]!.set(b, inf.weights[k]!); }); }
    let bad = false;
    for (const bc of conv.boneCombinations) for (let nv = bc.VertexStart; nv < bc.VertexStart + bc.VertexCount && !bad; nv++) {
      let want = inflOf[conv.vertexRemap![nv]!]!;
      if (want.size > 4) want = new Map([...want].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4));
      const total = [...want.values()].reduce((a, x) => a + x, 0) || 1;
      const got = new Map<number, number>();
      const mm = conv.maxVertexInfluences;
      let acc = 0;
      for (let i = 0; i < mm; i++) {
        const w = i < mm - 1 ? dv.getFloat32(nv * st + (wEl ? wEl.offset : 0) + 4 * i, true) : 1 - acc;
        acc += w;
        if (w > 1e-6) got.set(bc.BoneId[out.vb.cpu[nv * st + iEl.offset + i]!]!, (got.get(bc.BoneId[out.vb.cpu[nv * st + iEl.offset + i]!]!) ?? 0) + w);
      }
      if (want.size === 0) continue;
      for (const [b, w] of want) if (Math.abs((got.get(b) ?? -1) - w / total) > 1e-4) bad = true;
      if (got.size !== want.size) bad = true;
    }
    if (bad) { s.invariantFail++; examples.push(`${name}: invariant failed`); }
  }
  // animation: pose at t = 0 vs the rest matrices
  const ac = r.animController;
  if (ac && ac.GetNumAnimationSets() > 0) {
    s.animFiles++;
    const rest = new Map<D3DXFrame, Float32Array>(); for (const f of frames) rest.set(f, f.TransformationMatrix.slice());
    ac.SetTrackAnimationSet(0, ac.GetAnimationSet(0).set!); ac.SetTrackEnable(0, true);
    ac.AdvanceTime(0);
    const set = ac.GetAnimationSet(0).set!;
    for (const f of frames) {
      if (!f.Name || set.GetAnimationIndexByName(f.Name).hr < 0) continue;
      s.animFrames++;
      const d = Math.max(...Array.from(f.TransformationMatrix, (v, i) => Math.abs(v - rest.get(f)![i]!)));
      if (d < 1e-3) s.restMatch++; else s.restMismatch++;
    }
  } else s.noOutputSet++;
  const root = r.frameRoot; r.frameRoot = null;
  (await import("../packages/d3d9/src/index.ts")).D3DXFrameDestroy(root, alloc);
}
console.log(JSON.stringify(s, null, 1));
console.log("max vertex influences:", fmt(maxInfl));
console.log("max face influences:", fmt(maxFaceInfl));
console.log("bones per skin (>=40 merged):", fmt(bonesPer));
console.log("bone combinations per mesh (>=20 merged):", fmt(combosPer));
console.log(examples.slice(0, 25).join("\n"));
