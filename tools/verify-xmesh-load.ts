/**
 * Load the static meshes of the KOMs through the engine's `loadXMesh` (CKTDXDeviceXMesh::_Load: LoadKMEMesh for "KME " data, LoadD3DXMesh for X files)
 * on a software WebGPU device:
 *   ./tools/gpu.sh ./node_modules/.bin/bun run tools/verify-xmesh-load.ts [--x N|all] [--verbose]
 * Every KME file is loaded and compared with what `parseKme` says is in it (faces, materials, attribute ids, centre / radius, no error logged);
 * `--x N` also loads every N-th X / Y file (all of them for `all`; KSM files are skipped) and checks the invariants of the exe's tail (FVF 338,
 * attribute ranges tile the faces, one finite sphere per range).
 */
import { parseKme } from "@els/assets";
import { D3DXERR_LOADEDMESHASNODATA } from "@els/d3d9";
import { isKmeData, isKsmData, loadXMesh } from "@els/engine";
import { newD3D9 } from "../packages/d3d9/test/gpu-helper.ts";
import { indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const xStep = opt("--x") === undefined ? 0 : opt("--x") === "all" ? 1 : Number(opt("--x"));
const verbose = args.includes("--verbose");

const dev = await newD3D9(4, 4);
const index = await indexAllKoms();
const problems: string[] = [];
const sum = { kme: 0, kmeVertices: 0, kmeWelded: 0, kmeFaces: 0, kmeRanges: 0, x: 0, xFailed: 0, xVertices: 0, xFaces: 0, xRanges: 0, xNoMaterial: 0, xNoMesh: 0 };
const t0 = performance.now();
let n = 0;
for (const [key, hit] of index) {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  if (ext !== "X" && ext !== "Y") continue;
  const bytes = await hit.kom.read(hit.entry);
  if (isKsmData(bytes)) continue;
  const name = hit.entry.name;
  const logs: string[] = [];
  const log = (id: number): void => { logs.push(`0x${id.toString(16)}`); };
  if (isKmeData(bytes)) {
    sum.kme++;
    const f = parseKme(bytes);
    const x = loadXMesh(bytes, dev, log);
    if (x.hr < 0 || !x.mesh) { problems.push(`${name}: KME load failed 0x${(x.hr >>> 0).toString(16)} ${logs.join(" ")}`); continue; }
    if (logs.length) problems.push(`${name}: logged ${logs.join(" ")}`);
    const ids = [...new Set(f.attributes)].sort((a, b) => a - b);
    if (x.mesh.GetNumFaces() !== f.faceCount) problems.push(`${name}: ${x.mesh.GetNumFaces()} faces, file has ${f.faceCount}`);
    if (x.mesh.GetNumVertices() > f.vertexCount) problems.push(`${name}: welding added vertices`);
    if (JSON.stringify(x.attributeRange.map((r) => r.AttribId)) !== JSON.stringify(ids)) problems.push(`${name}: attribute ids differ`);
    if (x.attributeRange.reduce((a, r) => a + r.FaceCount, 0) !== f.faceCount) problems.push(`${name}: ranges do not cover the faces`);
    if (x.subsetCulling.length !== x.attributeRange.length || x.subsetCulling.some((c) => !Number.isFinite(c.radius + c.center[0] + c.center[1] + c.center[2]))) problems.push(`${name}: subset spheres`);
    if (x.materials.length !== f.materials.length || x.materials.some((m, i) => m.pTextureFilename !== f.materials[i]!.texture)) problems.push(`${name}: materials differ`);
    if (x.radius !== f.radius || x.center.some((c, i) => c !== f.center[i])) problems.push(`${name}: centre / radius differ from the file`);
    sum.kmeVertices += f.vertexCount; sum.kmeWelded += x.mesh.GetNumVertices(); sum.kmeFaces += f.faceCount; sum.kmeRanges += x.attributeRange.length;
    if (verbose) console.log(`${name}: ${f.vertexCount} -> ${x.mesh.GetNumVertices()} vertices, ${f.faceCount} faces, ${x.attributeRange.length} ranges`);
    x.mesh.Release();
  } else if (xStep > 0 && n++ % xStep === 0) {
    sum.x++;
    const x = loadXMesh(bytes, dev, log);
    // a file without a mesh (a dummy / spawn point: frames only) is not a static mesh; D3DXLoadMeshFromX says so
    if (x.hr === D3DXERR_LOADEDMESHASNODATA) { sum.xNoMesh++; continue; }
    if (x.hr < 0 || !x.mesh) { sum.xFailed++; problems.push(`${name}: X load failed 0x${(x.hr >>> 0).toString(16)} ${logs.join(" ")}`); continue; }
    if (logs.length) problems.push(`${name}: logged ${logs.join(" ")}`);
    if (x.mesh.GetFVF() !== 338) problems.push(`${name}: FVF ${x.mesh.GetFVF()}`);
    if (x.attributeRange.reduce((a, r) => a + r.FaceCount, 0) !== x.mesh.GetNumFaces()) problems.push(`${name}: ranges do not cover the faces`);
    if (x.subsetCulling.length !== x.attributeRange.length || x.subsetCulling.some((c) => !Number.isFinite(c.radius + c.center[0] + c.center[1] + c.center[2]))) problems.push(`${name}: subset spheres`);
    if (x.materials.length === 0) sum.xNoMaterial++;
    sum.xVertices += x.mesh.GetNumVertices(); sum.xFaces += x.mesh.GetNumFaces(); sum.xRanges += x.attributeRange.length;
    x.mesh.Release();
  }
}
console.log(JSON.stringify(sum));
console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (problems.length) { console.log(`${problems.length} problems:`); for (const p of problems.slice(0, 40)) console.log("  " + p); process.exit(1); }
console.log("all static meshes load");
