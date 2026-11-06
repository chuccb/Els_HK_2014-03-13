/** D3DX mesh: loading (frame baking, normal splits, materials), Optimize / Weld / Clone / adjacency, bounding sphere, ray tests, DrawSubset. */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { KomArchive, fileSource } from "@els/kom";
import type { XFrameData, XMeshData, XScene } from "@els/assets";
import {
  D3DCLEAR, D3DFMT, D3DTS, D3DTS_WORLD, D3DXComputeBoundingSphere, D3DXCreateMeshFVF, D3DXIntersect, D3DXLoadMeshFromXInMemory, D3DXLoadMeshFromXScene,
  D3DXMESH, D3DXMESHOPT, D3DXWeldVertices, NO_NEIGHBOUR, D3DRS, D3DCULL, zeroWeldEpsilons, matIdentity, matOrthoLH, matTranslation, fvfVertexSize,
} from "../src/index.ts";
import { argb, gpuAvailable, newD3D9, snap } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;

const IDENT = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
function mesh(p: Omit<Partial<XMeshData>, "positions"> & { positions: number[]; faces: number[][] }): XMeshData {
  return {
    name: "m", normals: null, normalFaces: null, texCoords: null, vertexColors: null, faceMaterial: new Uint32Array(p.faces.length), materials: [{ diffuse: [1, 1, 1, 1], power: 0, specular: [0, 0, 0], emissive: [0, 0, 0], textureFilename: null }],
    skin: null, duplicationIndices: null, ...p, positions: Float32Array.from(p.positions),
  };
}
const frame = (name: string, matrix: Float32Array, meshes: XMeshData[] = [], children: XFrameData[] = []): XFrameData => ({ name, matrix, meshes, children });
const scene = (frames: XFrameData[]): XScene => ({ frames, animationSets: [], ticksPerSecond: 4800, format: "bin" });
const readVerts = (m: ReturnType<typeof D3DXCreateMeshFVF>["mesh"] & object): number[][] => {
  const st = m.GetNumBytesPerVertex(), dv = new DataView(m.vb.cpu.buffer, m.vb.cpu.byteOffset, m.vb.cpu.byteLength);
  return Array.from({ length: m.GetNumVertices() }, (_, v) => Array.from({ length: st / 4 }, (_, k) => dv.getFloat32(v * st + k * 4, true)));
};

describe("D3DX meshes (need a WebGPU adapter for the buffers)", () => {
  gpuTest("D3DXCreateMeshFVF: sizes, 32-bit rule, locks, attribute buffer", async () => {
    const dev = await newD3D9(4, 4);
    expect(D3DXCreateMeshFVF(0, 3, D3DXMESH.MANAGED, 0x112, dev).hr).toBeLessThan(0);
    expect(D3DXCreateMeshFVF(10, 70000, D3DXMESH.MANAGED, 0x112, dev).hr).toBeLessThan(0); // 16-bit indices cannot address 70000 vertices
    const big = D3DXCreateMeshFVF(10, 70000, D3DXMESH.MANAGED | D3DXMESH._32BIT, 0x112, dev);
    expect(big.mesh!.GetOptions() & 1).toBe(1);
    expect(big.mesh!.is32).toBe(true);
    const r = D3DXCreateMeshFVF(2, 4, D3DXMESH.MANAGED, 0x152, dev).mesh!;
    expect(r.GetNumBytesPerVertex()).toBe(36);
    expect(fvfVertexSize(r.GetFVF())).toBe(36);
    const lk = r.LockVertexBuffer(0);
    expect(lk.data!.length).toBe(4 * 36);
    expect(r.UnlockVertexBuffer()).toBe(0);
    expect(r.LockIndexBuffer(0).data!.length).toBe(2 * 3 * 2);
    r.UnlockIndexBuffer();
    expect(r.LockAttributeBuffer(0).data!.length).toBe(2);
    expect(r.GetAttributeTable()).toEqual([]);
  });

  gpuTest("loading: frame transforms are baked in, polygons are fanned, normal indices split vertices, materials are appended per mesh", async () => {
    const dev = await newD3D9(4, 4);
    // mesh A: a quad polygon (0,1,2,3) with normal 0 everywhere, then a triangle (1,4,2) whose corners use normal 1: vertices 1 and 2 are
    // already used with normal 0 and must be split, vertex 4 is new
    const A = mesh({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0], faces: [[0, 1, 2, 3], [1, 4, 2]],
      normals: Float32Array.of(0, 0, 1, 0, 1, 0), normalFaces: [[0, 0, 0, 0], [1, 1, 1]], texCoords: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1, 2, 0),
      materials: [{ diffuse: [1, 0, 0, 1], power: 2, specular: [0.5, 0.5, 0.5], emissive: [0, 0, 0], textureFilename: "a.tga" }],
    });
    // mesh B: one triangle in a child frame translated by (10, 0, 0) of a parent translated by (0, 5, 0)
    const B = mesh({
      positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], faces: [[0, 1, 2]], normals: Float32Array.of(0, 1, 0), normalFaces: [[0, 0, 0]], texCoords: Float32Array.of(0, 0, 1, 0, 0, 1),
      materials: [{ diffuse: [0, 1, 0, 1], power: 0, specular: [0, 0, 0], emissive: [0, 0, 0], textureFilename: null }, { diffuse: [0, 0, 1, 1], power: 0, specular: [0, 0, 0], emissive: [0, 0, 0], textureFilename: "b.tga" }],
    });
    B.faceMaterial[0] = 1;
    const parent = frame("p", matTranslation(0, 5, 0), [A], [frame("c", matTranslation(10, 0, 0), [B])]);
    const r = D3DXLoadMeshFromXScene(scene([parent]), D3DXMESH.MANAGED, dev);
    expect(r.hr).toBe(0);
    const m = r.mesh!;
    expect(m.GetFVF()).toBe(0x112); // XYZ | NORMAL | TEX1
    expect(m.GetNumFaces()).toBe(4); // the quad becomes two triangles
    expect(m.GetNumVertices()).toBe(5 + 2 + 3); // A: 5 + two split vertices, B: 3
    expect(r.materials.map((x) => x.pTextureFilename)).toEqual(["a.tga", null, "b.tga"]);
    expect(r.materials[0]!.MatD3D.power).toBe(2);
    expect(Array.from(m.attributeBuffer)).toEqual([0, 0, 0, 2]); // B's face uses its material 1 -> 1 + base 1 = 2
    expect(Array.from(m.indices())).toEqual([0, 1, 2, 0, 2, 3, 5, 4, 6, 7, 8, 9]);
    const v = readVerts(m);
    expect(v[0]!.slice(0, 3)).toEqual([0, 5, 0]); // A baked with the parent's translation (row-vector positions: v * local * parent)
    expect(v[5]!.slice(0, 6)).toEqual([1, 5, 0, 0, 1, 0]); // split copy of vertex 1 carries the second normal
    expect(v[1]!.slice(3, 6)).toEqual([0, 0, 1]);
    expect(v[4]!.slice(3, 6)).toEqual([0, 1, 0]);
    // B: local * parentWorld = T(10,0,0) * T(0,5,0)
    expect(v[7]!.slice(0, 3)).toEqual([10, 5, 0]);
    expect(v[9]!.slice(0, 3)).toEqual([10, 5, 1]);
    expect(v[9]!.slice(6, 8)).toEqual([0, 1]); // texcoords
    // adjacency matches edges by position: face 0 = (0,1,2), face 1 = (0,2,3), face 2 = split copy of (1,4,2)
    expect(r.adjacency!.length).toBe(12);
    expect(r.adjacency![0 * 3 + 2]).toBe(1); // edge 2->0 of face 0 is edge 0->2 of face 1
    expect(r.adjacency![1 * 3 + 0]).toBe(0);
    expect(r.adjacency![0 * 3 + 1]).toBe(2); // edge 1->2 of face 0 meets edge 2->1 of face 2 (a different vertex index, the same position)
    expect(r.adjacency![2 * 3 + 2]).toBe(0);
    expect(r.adjacency![3 * 3]).toBe(NO_NEIGHBOUR);
  });

  gpuTest("Optimize ATTRSORT: faces sorted by attribute, vertices split per attribute group, disjoint vertex ranges; DONOTSPLIT and COMPACT variants", async () => {
    const dev = await newD3D9(4, 4);
    // a strip of 4 triangles over 6 vertices; attributes 1,0,1,0 so the two groups share vertices
    const m = D3DXCreateMeshFVF(4, 7, D3DXMESH.MANAGED, 0x002, dev).mesh!; // vertex 6 is unused
    const vb = m.LockVertexBuffer(0).data!, fv = new Float32Array(vb.buffer, vb.byteOffset, 21);
    for (let v = 0; v < 7; v++) fv.set([v, v % 2, 0], v * 3);
    m.UnlockVertexBuffer();
    const ids = m.LockIndexBuffer(0).data!;
    new Uint16Array(ids.buffer, ids.byteOffset, 12).set([0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5]);
    m.UnlockIndexBuffer();
    m.LockAttributeBuffer(0).data!.set([1, 0, 1, 0]); m.UnlockAttributeBuffer();

    const a = m.Optimize(D3DXMESHOPT.ATTRSORT | D3DXMESHOPT.VERTEXCACHE | D3DXMESH.MANAGED, null);
    expect(a.hr).toBe(0);
    expect(Array.from(a.faceRemap!)).toEqual([1, 3, 0, 2]);
    const t = a.mesh!.GetAttributeTable();
    expect(t.map((r) => [r.AttribId, r.FaceStart, r.FaceCount])).toEqual([[0, 0, 2], [1, 2, 2]]);
    // group 0 uses vertices {1,2,3} + {3,4,5} = 5 unique, group 1 uses {0,1,2} + {2,3,4} = 5 unique; no sharing between groups after the split
    expect(a.mesh!.GetNumVertices()).toBe(10);
    expect(t[0]).toMatchObject({ VertexStart: 0, VertexCount: 5 });
    expect(t[1]).toMatchObject({ VertexStart: 5, VertexCount: 5 });
    expect(Array.from(a.vertexRemap!)).toEqual([1, 2, 3, 4, 5, 0, 1, 2, 3, 4]);
    // the vertex data followed the remap
    const nv = readVerts(a.mesh!);
    expect(nv[0]![0]).toBe(1);
    expect(nv[5]![0]).toBe(0);
    for (const r of t) { const ix = a.mesh!.indices(); for (let k = r.FaceStart * 3; k < (r.FaceStart + r.FaceCount) * 3; k++) { expect(ix[k]!).toBeGreaterThanOrEqual(r.VertexStart); expect(ix[k]!).toBeLessThan(r.VertexStart + r.VertexCount); } }

    const ns = m.Optimize(D3DXMESHOPT.ATTRSORT | D3DXMESHOPT.DONOTSPLIT | D3DXMESH.MANAGED, null);
    expect(ns.mesh!.GetNumVertices()).toBe(7); // untouched vertex set
    expect(ns.mesh!.GetAttributeTable().map((r) => [r.AttribId, r.VertexStart, r.VertexCount])).toEqual([[0, 1, 5], [1, 0, 5]]);

    const c = m.Optimize(D3DXMESHOPT.COMPACT | D3DXMESH.MANAGED, null);
    expect(c.mesh!.GetNumVertices()).toBe(6); // the unused vertex is dropped, order kept
    expect(c.mesh!.GetAttributeTable()).toEqual([]);

    const ip = m.OptimizeInplace(D3DXMESHOPT.ATTRSORT, null);
    expect(ip.hr).toBe(0);
    expect(Array.from(m.attributeBuffer)).toEqual([0, 0, 1, 1]);
    expect(m.GetAttributeTable().length).toBe(2);
  });

  gpuTest("D3DXWeldVertices: identical vertices merge (not across attributes), tolerance welds near ones", async () => {
    const dev = await newD3D9(4, 4);
    /** an XYZ|TEX1 mesh of two triangles over 6 vertices (x, y, z, u, v each) */
    const make = (verts: number[][], attrs: number[] = [0, 0]): NonNullable<ReturnType<typeof D3DXCreateMeshFVF>["mesh"]> => {
      const m = D3DXCreateMeshFVF(2, 6, D3DXMESH.MANAGED, 0x102, dev).mesh!;
      const vb = m.LockVertexBuffer(0).data!, fv = new Float32Array(vb.buffer, vb.byteOffset, 30);
      verts.forEach((v, i) => fv.set(v, i * 5));
      m.UnlockVertexBuffer();
      const ids = m.LockIndexBuffer(0).data!;
      new Uint16Array(ids.buffer, ids.byteOffset, 6).set([0, 1, 2, 3, 4, 5]);
      m.UnlockIndexBuffer();
      m.LockAttributeBuffer(0).data!.set(attrs); m.UnlockAttributeBuffer();
      return m;
    };
    const quad = [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [0, 1, 0, 0, 1], [1, 0, 0, 1, 0], [1, 1, 0, 1, 1], [0, 1, 0, 0, 1]];
    const m = make(quad);
    const r = D3DXWeldVertices(m, 0, zeroWeldEpsilons(), null);
    expect(r.hr).toBe(0);
    expect(m.GetNumVertices()).toBe(4);
    expect(Array.from(m.indices())).toEqual([0, 1, 2, 1, 3, 2]);
    expect(Array.from(r.vertexRemap!)).toEqual([0, 1, 2, 4]);
    // a different attribute keeps the duplicates apart
    const m2 = make(quad, [0, 1]);
    D3DXWeldVertices(m2, 0, zeroWeldEpsilons(), null);
    expect(m2.GetNumVertices()).toBe(6);
    // tolerance
    const near = quad.map((v) => v.slice());
    near[3]![0] = 1.0004; near[5]![1] = 1.0004;
    const strict = make(near);
    D3DXWeldVertices(strict, 0, zeroWeldEpsilons(), null);
    expect(strict.GetNumVertices()).toBe(6);
    const m3 = make(near);
    const eps = zeroWeldEpsilons(); eps.Position = 0.001;
    D3DXWeldVertices(m3, 0, eps, null);
    expect(m3.GetNumVertices()).toBe(4);
  });

  gpuTest("CloneMeshFVF adds the diffuse colour (zero) and keeps positions, normals, uv, indices, attributes; 32-bit option converts the indices", async () => {
    const dev = await newD3D9(4, 4);
    const src = D3DXLoadMeshFromXScene(scene([frame("f", IDENT, [mesh({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [[0, 1, 2]], normals: Float32Array.of(0, 0, 1), normalFaces: [[0, 0, 0]], texCoords: Float32Array.of(0, 0, 1, 0, 0, 1) })])]), D3DXMESH.MANAGED, dev).mesh!;
    expect(src.GetFVF()).toBe(274);
    const c = src.CloneMeshFVF(D3DXMESH.MANAGED | D3DXMESH._32BIT, 338, dev).mesh!;
    expect(c.GetNumBytesPerVertex()).toBe(36);
    expect(c.is32).toBe(true);
    const dv = new DataView(c.vb.cpu.buffer, c.vb.cpu.byteOffset, c.vb.cpu.byteLength);
    expect([dv.getFloat32(36, true), dv.getFloat32(36 + 12 + 8, true)].length).toBe(2);
    expect(dv.getFloat32(36 + 0, true)).toBe(1); // vertex 1 x
    expect(dv.getFloat32(36 + 20, true)).toBe(1); // vertex 1 normal.z (the normal is (0,0,1))
    expect(dv.getFloat32(36 + 24, true)).toBe(0); // diffuse slot is zero filled
    expect(dv.getFloat32(36 + 28, true)).toBe(1); // u of vertex 1
    expect(Array.from(c.indices())).toEqual([0, 1, 2]);
  });

  test("D3DXComputeBoundingSphere: centroid and largest distance (not the minimal sphere); stride and offset", () => {
    const f = new Float32Array([0, 0, 0, 9, 9, 9, 10, 0, 0, 0, 0, 0, 0, 8, 0, 9, 9, 9, 0, 0, 6, 9, 9, 9]); // positions with 5 junk floats between (stride 24)
    const bytes = new Uint8Array(f.buffer);
    const r = D3DXComputeBoundingSphere(bytes, 0, 4, 24);
    // positions: (0,0,0) (10,0,0) (0,8,0) (0,0,6); centroid (2.5, 2, 1.5)
    expect(r.center).toEqual({ x: 2.5, y: 2, z: 1.5 });
    expect(r.radius).toBeCloseTo(Math.hypot(7.5, 2, 1.5), 5);
    expect(D3DXComputeBoundingSphere(bytes, 24, 1, 24).center).toEqual({ x: 10, y: 0, z: 0 });
  });

  gpuTest("D3DXIntersect: closest hit, barycentric u/v, distance in ray-direction units; misses", async () => {
    const dev = await newD3D9(4, 4);
    const m = D3DXLoadMeshFromXScene(scene([frame("f", IDENT, [mesh({
      positions: [0, 0, 5, 4, 0, 5, 0, 4, 5, 0, 0, 9, 4, 0, 9, 0, 4, 9], faces: [[0, 1, 2], [3, 4, 5]], normals: Float32Array.of(0, 0, -1), normalFaces: [[0, 0, 0], [0, 0, 0]], texCoords: new Float32Array(12),
    })])]), D3DXMESH.MANAGED, dev).mesh!;
    const h = D3DXIntersect(m, { x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 2 }); // direction length 2 -> distance 2.5 = 5 units
    expect(h.hit).toBe(true);
    expect(h.faceIndex).toBe(0);
    expect(h.dist).toBeCloseTo(2.5, 6);
    expect(h.u).toBeCloseTo(0.25, 6); expect(h.v).toBeCloseTo(0.25, 6);
    expect(h.allHits.map((x) => x.FaceIndex)).toEqual([0, 1]);
    expect(D3DXIntersect(m, { x: 3.5, y: 3.5, z: 0 }, { x: 0, y: 0, z: 1 }).hit).toBe(false); // outside both triangles (x + y > 4)
    expect(D3DXIntersect(m, { x: 1, y: 1, z: 10 }, { x: 0, y: 0, z: 1 }).hit).toBe(false); // behind the origin
  });

  gpuTest("DrawSubset draws only the faces of that attribute (unsorted mesh by runs, sorted mesh by the attribute table)", async () => {
    const dev = await newD3D9(16, 8, { backBufferFormat: D3DFMT.A8R8G8B8 });
    // two quads side by side, left = attribute 0, right = attribute 1
    const quad = (x0: number, a: number): XMeshData => mesh({
      positions: [x0, 0, 0, x0 + 1, 0, 0, x0 + 1, 1, 0, x0, 1, 0], faces: [[0, 2, 1], [0, 3, 2]], normals: Float32Array.of(0, 0, -1), normalFaces: [[0, 0, 0], [0, 0, 0]], texCoords: new Float32Array(8),
      faceMaterial: Uint32Array.of(a, a),
      materials: [{ diffuse: [1, 1, 1, 1], power: 0, specular: [0, 0, 0], emissive: [0, 0, 0], textureFilename: null }, { diffuse: [1, 1, 1, 1], power: 0, specular: [0, 0, 0], emissive: [0, 0, 0], textureFilename: null }],
    });
    // meshes A and B each use material 0 / 1 of their own list, so the merged attributes are 0 (A) and 2 (B); relabel B's faces as attribute 1
    const m = D3DXLoadMeshFromXScene(scene([frame("f", IDENT, [quad(0, 0), quad(1, 0)])]), D3DXMESH.MANAGED, dev).mesh!;
    m.LockAttributeBuffer(0).data!.set([0, 0, 1, 1]); m.UnlockAttributeBuffer();
    // x in [0,2], y in [0,1] fills the target; z shifted into the ortho range
    dev.SetTransform(D3DTS_WORLD, matIdentity());
    dev.SetTransform(D3DTS.VIEW, matTranslation(-1, -0.5, 0.5));
    dev.SetTransform(D3DTS.PROJECTION, matOrthoLH(2, 1, 0, 1));
    dev.SetRenderState(D3DRS.LIGHTING, 0);
    dev.SetRenderState(D3DRS.CULLMODE, D3DCULL.NONE);
    dev.SetRenderState(D3DRS.ZENABLE, 0);
    const covered = async (mm: NonNullable<typeof m>, id: number): Promise<[number, number]> => {
      dev.Clear(null, D3DCLEAR.TARGET | D3DCLEAR.ZBUFFER, argb(255, 0, 0, 0), 1, 0);
      mm.DrawSubset(id);
      const img = await snap(dev);
      expect(await dev.takeErrorsAsync()).toEqual([]);
      return [img.at(3, 4).r, img.at(12, 4).r];
    };
    expect(await covered(m, 0)).toEqual([255, 0]);
    expect(await covered(m, 1)).toEqual([0, 255]);
    expect(await covered(m, 7)).toEqual([0, 0]); // no such subset: nothing drawn
    const o = m.Optimize(D3DXMESHOPT.ATTRSORT | D3DXMESHOPT.VERTEXCACHE | D3DXMESH.MANAGED, null).mesh!;
    expect(o.GetAttributeTable().length).toBe(2);
    expect(await covered(o, 0)).toEqual([255, 0]);
    expect(await covered(o, 1)).toEqual([0, 255]);
  });

  gpuTest("real asset MESH_ELSWORD_BASIC_WEAPON.X (data017.kom): 3 meshes merged -> 78 faces, 85 vertices, texture + 2 untextured materials; weld, optimize, bounding spheres", async () => {
    if (!existsSync("data/data017.kom")) return;
    const kom = await KomArchive.open(fileSource("data/data017.kom"));
    const entry = kom.entries.find((e) => e.name.toUpperCase() === "MESH_ELSWORD_BASIC_WEAPON.X")!;
    const bytes = await kom.read(entry);
    const dev = await newD3D9(4, 4);
    const r = D3DXLoadMeshFromXInMemory(bytes, D3DXMESH.MANAGED, dev);
    expect(r.hr).toBe(0);
    expect(r.mesh!.GetNumFaces()).toBe(78);
    expect(r.mesh!.GetNumVertices()).toBe(85);
    expect(r.mesh!.GetFVF()).toBe(274);
    expect(r.materials.map((m) => m.pTextureFilename)).toEqual(["Elsword_Basic_Weapon.tga", null, null]);
    expect(r.materials[1]!.MatD3D.diffuse.g).toBeCloseTo(0.890625, 6);
    expect(D3DXWeldVertices(r.mesh!, 0, zeroWeldEpsilons(), r.adjacency).hr).toBe(0);
    expect(r.mesh!.GetNumVertices()).toBe(77);
    const o = r.mesh!.Optimize(0x6000220, null);
    expect(o.hr).toBe(0);
    expect(o.mesh!.GetAttributeTable().map((t) => [t.AttribId, t.FaceStart, t.FaceCount, t.VertexStart, t.VertexCount])).toEqual([[0, 0, 54, 0, 37], [1, 54, 12, 37, 20], [2, 66, 12, 57, 20]]);
    expect(NO_NEIGHBOUR).toBe(0xffffffff);
  });
});
