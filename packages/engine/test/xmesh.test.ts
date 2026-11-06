/**
 * `CKTDXDeviceXMesh::XMeshProxy` (x2.exe.c L425208 LoadD3DXMesh, L425712 LoadKMEMesh): the static-mesh loaders.  KME expectations come from parsing
 * the shipped files with @els/assets (independent of the loader); the X path is checked against the rules the decompile shows (FVF 338, white vertex
 * colours, Ambient = Diffuse, welded + attribute sorted, one bounding sphere per attribute range).
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { KomArchive, fileSource } from "@els/kom";
import { parseKme } from "@els/assets";
import { D3DXMESHTYPE } from "@els/d3d9";
import { MultiAnimMC, XMESH_FVF, isKmeData, loadKMEMesh, loadXMesh, xmeshAsFrame } from "../src/index.ts";
import { gpuAvailable, newD3D9 } from "../../d3d9/test/gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU && existsSync("data/data026.kom") && existsSync("data/data017.kom") ? test : test.skip;

async function read(kom: string, name: string): Promise<Uint8Array> {
  const a = await KomArchive.open(fileSource(`data/${kom}`));
  return a.read(a.entries.find((e) => e.name.toUpperCase() === name.toUpperCase())!);
}

describe("the format test of CKTDXDeviceXMesh::_Load", () => {
  test("'KME ' (541412683) at the start, and at least 4 bytes", () => {
    expect(isKmeData(Uint8Array.of(0x4b, 0x4d, 0x45, 0x20, 0))).toBe(true);
    expect(isKmeData(Uint8Array.of(0x4b, 0x4d, 0x45))).toBe(false);
    expect(isKmeData(new TextEncoder().encode("xof 0303txt 0032"))).toBe(false);
    expect(isKmeData(Uint8Array.of(0x4b, 0x53, 0x4d, 0x20))).toBe(false); // a KSM is not a KME
  });
});

describe("LoadKMEMesh (3296A880)", () => {
  gpuTest("Elder_Village_clo1.Y: a quad with one material; centre and radius come from the file; the single range spans the mesh", async () => {
    const bytes = await read("data026.kom", "Elder_Village_clo1.Y");
    const kme = parseKme(bytes);
    const dev = await newD3D9(4, 4);
    const logs: number[] = [];
    const x = loadXMesh(bytes, dev, (id) => logs.push(id));
    expect(logs).toEqual([]);
    expect(x.hr).toBe(0);
    expect(x.format).toBe("KME");
    expect(x.mesh!.GetFVF()).toBe(XMESH_FVF);
    expect(x.mesh!.GetNumVertices()).toBe(4);
    expect(x.mesh!.GetNumFaces()).toBe(2);
    expect(x.center).toEqual(kme.center);
    expect(x.radius).toBe(kme.radius);
    expect(x.materials.length).toBe(1);
    expect(x.materials[0]!.pTextureFilename).toBe("Ruben_Village_Clo1.dds");
    expect(x.attributeRange).toEqual([{ AttribId: 0, FaceStart: 0, FaceCount: 2, VertexStart: 0, VertexCount: 4 }]);
    expect(x.subsetCulling.length).toBe(1);
    // the sphere of the subset is the sphere of its four vertices (centroid + farthest distance)
    expect(x.subsetCulling[0]!.radius).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) expect(Math.abs(x.subsetCulling[0]!.center[i]! - kme.center[i]!)).toBeLessThan(Math.max(1, Math.abs(kme.center[i]!)) * 0.01);
  });

  gpuTest("Elder_Village_pvp_obj.Y: welded (504 -> 390 vertices), 416 faces attribute-sorted into the 4 used materials, one sphere per range, no log", async () => {
    const bytes = await read("data026.kom", "Elder_Village_pvp_obj.Y");
    const kme = parseKme(bytes);
    const dev = await newD3D9(4, 4);
    const logs: number[] = [];
    const x = loadKMEMesh(bytes, dev, (id) => logs.push(id));
    expect(logs).toEqual([]);
    expect(kme.vertexCount).toBe(504);
    expect(kme.faceCount).toBe(416);
    expect(x.mesh!.GetNumVertices()).toBe(390);
    expect(x.mesh!.GetNumFaces()).toBe(416);
    expect(x.attributeRange.map((r) => r.AttribId)).toEqual([0, 1, 2, 3]);
    expect(x.attributeRange.reduce((n, r) => n + r.FaceCount, 0)).toBe(416);
    // ranges tile the face list and the vertex list; every face of a range uses only its vertex range
    let face = 0;
    const idx = x.mesh!.indices();
    const attr = x.mesh!.attributeBuffer;
    for (const r of x.attributeRange) {
      expect(r.FaceStart).toBe(face);
      face += r.FaceCount;
      for (let f = r.FaceStart; f < r.FaceStart + r.FaceCount; f++) {
        expect(attr[f]).toBe(r.AttribId);
        for (let k = 0; k < 3; k++) { const v = idx[f * 3 + k]!; expect(v >= r.VertexStart && v < r.VertexStart + r.VertexCount).toBe(true); }
      }
    }
    expect(x.subsetCulling.length).toBe(4);
    for (const c of x.subsetCulling) { expect(c.radius).toBeGreaterThan(0); expect(Number.isFinite(c.center[0] + c.center[1] + c.center[2])).toBe(true); }
    // the whole-mesh sphere stays the file's
    expect(x.center).toEqual(kme.center);
    expect(x.radius).toBe(kme.radius);
    // the materials are the file's as stored (the KME path does not touch the ambient colour)
    expect(x.materials.map((m) => m.MatD3D.ambient.r)).toEqual(kme.materials.map((m) => m.ambient[0]));
  });

  gpuTest("damaged files: the exe's log id and failure, no mesh", async () => {
    const good = await read("data026.kom", "Elder_Village_clo1.Y");
    const dev = await newD3D9(4, 4);
    const run = (b: Uint8Array): { hr: number; logs: number[] } => { const logs: number[] = []; const x = loadKMEMesh(b, dev, (id) => logs.push(id)); expect(x.mesh).toBeNull(); return { hr: x.hr, logs }; };
    const patch = (off: number, v: number): Uint8Array => { const b = good.slice(); new DataView(b.buffer).setUint32(off, v, true); return b; };
    expect(run(good.slice(0, 40)).logs).toEqual([0xab]); // shorter than the 0x3c header
    expect(run(patch(0, 0x12345678)).logs).toEqual([0xac]); // magic
    expect(run(patch(4, 513)).logs).toEqual([0xad]); // version
    expect(run(patch(8, 322)).logs).toEqual([0xae]); // FVF
    expect(run(patch(16, 0)).logs).toEqual([0xb3]); // no materials
    expect(run(patch(24, 0)).logs).toEqual([0xb8]); // no vertices
    expect(run(patch(32, 0)).logs).toEqual([0xbd]); // no faces
    expect(run(patch(40, 0)).logs).toEqual([0xc1]); // no attribute table
    for (const b of [good.slice(0, 40), patch(4, 513)]) expect(run(b).hr).toBeLessThan(0);
  });
});

describe("LoadD3DXMesh (3296A130)", () => {
  gpuTest("MESH_ELSWORD_BASIC_WEAPON.X: FVF 338, white vertex colours, Ambient = Diffuse, welded and attribute sorted, one sphere per range", async () => {
    const bytes = await read("data017.kom", "MESH_ELSWORD_BASIC_WEAPON.X");
    const dev = await newD3D9(4, 4);
    const logs: number[] = [];
    const x = loadXMesh(bytes, dev, (id) => logs.push(id));
    expect(logs).toEqual([]);
    expect(x.hr).toBe(0);
    expect(x.format).toBe("X");
    const mesh = x.mesh!;
    expect(mesh.GetFVF()).toBe(XMESH_FVF);
    expect(mesh.GetNumBytesPerVertex()).toBe(36);
    // every vertex a face uses is white
    const dv = new DataView(mesh.vb.cpu.buffer, mesh.vb.cpu.byteOffset, mesh.vb.cpu.byteLength);
    for (const v of mesh.indices()) expect(dv.getUint32(v * 36 + 24, true)).toBe(0xffffffff);
    for (const m of x.materials) expect(m.MatD3D.ambient).toEqual(m.MatD3D.diffuse);
    expect(x.attributeRange.length).toBeGreaterThan(0);
    expect(x.attributeRange.reduce((n, r) => n + r.FaceCount, 0)).toBe(mesh.GetNumFaces());
    expect(x.subsetCulling.length).toBe(x.attributeRange.length);
    expect(x.radius).toBeGreaterThan(0);
    // every subset sphere is inside (or on) the sphere of the whole mesh, give or take the centroid's slack
    for (const c of x.subsetCulling) expect(Math.hypot(c.center[0] - x.center[0], c.center[1] - x.center[1], c.center[2] - x.center[2]) - c.radius).toBeLessThan(x.radius * 1.01);
  });

  gpuTest("an X file that is not X, and an empty file, fail without a mesh", async () => {
    const dev = await newD3D9(4, 4);
    expect(loadXMesh(new TextEncoder().encode("this is not a mesh at all"), dev).hr).toBeLessThan(0);
    expect(loadXMesh(new Uint8Array(0), dev).hr).toBeLessThan(0);
  });
});

describe("xmeshAsFrame", () => {
  gpuTest("a frame with an identity matrix around one container that holds the mesh and the materials", async () => {
    const dev = await newD3D9(4, 4);
    const x = loadKMEMesh(await read("data026.kom", "Elder_Village_clo1.Y"), dev);
    const f = xmeshAsFrame(x);
    expect(Array.from(f.TransformationMatrix)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const c = f.pMeshContainer as MultiAnimMC;
    expect(c.MeshData.Type).toBe(D3DXMESHTYPE.MESH);
    expect(c.MeshData.pMesh).toBe(x.mesh);
    expect(c.NumMaterials).toBe(1);
    expect(c.m_apTextures).toEqual([null]);
  });
});
