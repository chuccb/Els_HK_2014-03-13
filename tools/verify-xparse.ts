/**
 * Parse every DirectX-format `.x` / `.y` entry (txt, bin, bzip) of the KOMs and collect statistics:
 *   bun run tools/verify-xparse.ts [--limit N] [--filter REGEX] [--verbose]
 * Failure = the generic reader (packages/assets/src/xfile.ts) cannot consume the file completely. For every Mesh object the
 * consistency of counts and indices is checked as well (faces index existing vertices, normals / texture coordinates / material
 * list sizes match, skin weight indices in range).
 */
import { parseXFile } from "@els/assets";
import type { XObject, XValue } from "@els/assets";
import { indexAllKoms } from "./komindex.ts";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const limit = opt("--limit") ? Number(opt("--limit")) : Infinity;
const filter = opt("--filter") ? new RegExp(opt("--filter")!, "i") : undefined;
const verbose = args.includes("--verbose");

const index = await indexAllKoms();
const errors: string[] = [];
const problems: string[] = [];
const kinds = new Map<string, number>();
const objTypes = new Map<string, number>();
const meshStats = { meshes: 0, vertices: 0, faces: 0, withNormals: 0, withUV: 0, withMaterials: 0, skinned: 0 };
let parsed = 0, tried = 0;
const t0 = performance.now();

function* walk(o: XObject): Generator<XObject> {
  yield o;
  for (const c of o.children) if (c.kind === "object") yield* walk(c);
}
const arr = (v: XValue | undefined): XValue[] => (Array.isArray(v) ? v : []);
const num = (v: XValue | undefined): number => (typeof v === "number" ? v : NaN);

function checkMesh(file: string, m: XObject): void {
  const nv = num(m.data.nVertices), nf = num(m.data.nFaces);
  meshStats.meshes++; meshStats.vertices += nv; meshStats.faces += nf;
  const faces = arr(m.data.faces) as Array<{ nFaceVertexIndices: number; faceVertexIndices: number[] }>;
  if (faces.length !== nf) problems.push(`${file}: faces ${faces.length} != nFaces ${nf}`);
  for (const f of faces) {
    if (f.nFaceVertexIndices !== f.faceVertexIndices.length) { problems.push(`${file}: face index count mismatch`); break; }
    if (f.faceVertexIndices.some((i) => !(i < nv))) { problems.push(`${file}: face index beyond ${nv} vertices`); break; }
  }
  for (const c of m.children) {
    if (c.kind !== "object") continue;
    if (c.type === "MeshNormals") {
      meshStats.withNormals++;
      if (num(c.data.nNormals) !== arr(c.data.normals).length) problems.push(`${file}: normals count`);
      const fn = arr(c.data.faceNormals).length;
      if (fn !== nf) problems.push(`${file}: faceNormals ${fn} != nFaces ${nf}`);
    } else if (c.type === "MeshTextureCoords") {
      meshStats.withUV++;
      if (num(c.data.nTextureCoords) !== nv) problems.push(`${file}: texcoords ${num(c.data.nTextureCoords)} != vertices ${nv}`);
    } else if (c.type === "MeshMaterialList") {
      meshStats.withMaterials++;
      const fi = arr(c.data.faceIndexes) as number[];
      const nm = num(c.data.nMaterials);
      if (fi.length !== nf && fi.length !== 1) problems.push(`${file}: material face indexes ${fi.length} != nFaces ${nf}`);
      if (fi.some((i) => !(i < nm))) problems.push(`${file}: material index beyond ${nm}`);
      const mats = c.children.filter((x) => x.kind === "object" && x.type === "Material" || x.kind === "ref").length;
      if (mats !== nm) problems.push(`${file}: ${mats} materials listed, nMaterials ${nm}`);
    } else if (c.type === "SkinWeights") {
      meshStats.skinned++;
      const vi = arr(c.data.vertexIndices) as number[];
      if (vi.some((i) => !(i < nv))) problems.push(`${file}: skin weight vertex index beyond ${nv}`);
      if (vi.length !== arr(c.data.weights).length) problems.push(`${file}: skin weights count`);
    }
  }
}

for (const [key, hit] of index) {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  if (ext !== "X" && ext !== "Y") continue;
  if (filter && !filter.test(hit.entry.name)) continue;
  const d = await hit.kom.read(hit.entry);
  if (!(d[0] === 0x78 && d[1] === 0x6f && d[2] === 0x66 && d[3] === 0x20)) continue; // KSM / KME are other formats
  if (tried >= limit) break;
  tried++;
  try {
    const f = parseXFile(d);
    parsed++;
    kinds.set(`${f.format}${f.floatSize}`, (kinds.get(`${f.format}${f.floatSize}`) ?? 0) + 1);
    for (const top of f.objects) {
      for (const o of walk(top)) {
        objTypes.set(o.type, (objTypes.get(o.type) ?? 0) + 1);
        if (o.type === "Mesh") checkMesh(hit.entry.name, o);
      }
    }
  } catch (e) {
    errors.push(`${hit.entry.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`parsed ${parsed} of ${tried} DirectX-format files in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log("formats:", JSON.stringify([...kinds]));
console.log("object types:", JSON.stringify([...objTypes].sort((a, b) => b[1] - a[1])));
console.log("meshes:", JSON.stringify(meshStats));
console.log(`parse errors: ${errors.length}`);
for (const e of errors.slice(0, verbose ? 200 : 25)) console.log("  " + e);
console.log(`consistency problems: ${problems.length}`);
for (const e of problems.slice(0, verbose ? 200 : 25)) console.log("  " + e);
