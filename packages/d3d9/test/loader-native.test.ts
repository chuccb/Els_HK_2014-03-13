/**
 * The D3DX loaders against the expectations of Wine's `dlls/d3dx9_36/tests/mesh.c` (D3DXLoadMeshTest, test_load_skin_mesh_from_xof, test_frame_find ...).  Wine requires those tests to pass
 * on native Windows too, so - unlike everything else about D3DX here, which has no oracle - these numbers are what the real d3dx9 produces: the order of the split vertices, the
 * index buffer of a triangulated quad, the colour rounding (alpha 0.1 -> 0x1a), the material fields (Ambient is black, Specular / Emissive get alpha 1), the frame / container
 * naming (NULL for the frame made around a top-level Mesh, the empty string for unnamed blocks), the synthetic root over several top-level frames, E_FAIL for an empty file.
 * The X files below are re-typed from those tests (a cube is a cube); the expected values are theirs.
 */
import { describe, expect, test } from "bun:test";
import {
  D3DXFrameDestroy, D3DXFrameFind, D3DXLoadMeshFromXInMemory, D3DXLoadMeshHierarchyFromXInMemory, D3DXMESH, D3DXMESHTYPE, D3DXERR_LOADEDMESHASNODATA, D3DERR_INVALIDCALL, E_FAIL,
} from "../src/index.ts";
import type { D3DXFrame, D3DXKeyframedAnimationSet, D3DXMeshContainer, D3DXMesh, ID3DXAllocateHierarchy } from "../src/index.ts";
import { matIdentity } from "../src/index.ts";
import { gpuAvailable, newD3D9 } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const SIMPLE_X = `xof 0303txt 0032
Mesh { 3; 0.0; 0.0; 0.0;, 0.0; 1.0; 0.0;, 1.0; 1.0; 0.0;; 1; 3; 0, 1, 2;; }`;

const BOX_X = `xof 0303txt 0032
template TestData { <12345678-1234-1234-1234-111111111111> DWORD value; }
Mesh {
  8;
  0.0; 0.0; 0.0;, 0.0; 0.0; 1.0;, 0.0; 1.0; 0.0;, 0.0; 1.0; 1.0;, 1.0; 0.0; 0.0;, 1.0; 0.0; 1.0;, 1.0; 1.0; 0.0;, 1.0; 1.0; 1.0;;
  6;
  4; 0, 1, 3, 2;, 4; 2, 3, 7, 6;, 4; 6, 7, 5, 4;, 4; 1, 0, 4, 5;, 4; 1, 5, 7, 3;, 4; 0, 2, 6, 4;;
  MeshNormals {
    6;
    -1.0; 0.0; 0.0;, 0.0; 1.0; 0.0;, 1.0; 0.0; 0.0;, 0.0; -1.0; 0.0;, 0.0; 0.0; 1.0;, 0.0; 0.0; -1.0;;
    6;
    4; 0, 0, 0, 0;, 4; 1, 1, 1, 1;, 4; 2, 2, 2, 2;, 4; 3, 3, 3, 3;, 4; 4, 4, 4, 4;, 4; 5, 5, 5, 5;;
  }
  TestData { 1;; }
  MeshMaterialList materials {
    2;
    6;
    0, 0, 0, 1, 1, 1;;
    Material { 0.0; 0.0; 1.0; 1.0;; 0.5; 1.0; 1.0; 1.0;; 0.0; 0.0; 0.0;; }
    Material { 1.0; 1.0; 1.0; 1.0;; 1.0; 1.0; 1.0; 1.0;; 0.0; 0.0; 0.0;; TextureFilename { "texture.jpg"; } }
  }
  TestData { 2;; }
  MeshVertexColors {
    8;
    0; 0.0; 0.0; 0.0; 0.0;;, 1; 0.0; 0.0; 1.0; 0.1;;, 2; 0.0; 1.0; 0.0; 0.2;;, 3; 0.0; 1.0; 1.0; 0.3;;,
    4; 1.0; 0.0; 0.0; 0.4;;, 5; 1.0; 0.0; 1.0; 0.5;;, 6; 1.0; 1.0; 0.0; 0.6;;, 7; 1.0; 1.0; 1.0; 0.7;;;
  }
  MeshTextureCoords {
    8;
    0.0; 1.0;, 1.0; 1.0;, 0.0; 0.0;, 1.0; 0.0;, 1.0; 1.0;, 0.0; 1.0;, 1.0; 0.0;, 0.0; 0.0;;
  }
}`;

/** position, normal, D3DCOLOR, texture coordinates of the 24 vertices D3DX makes of BOX_X, and the 12 triangles */
const BOX_VERTICES: [number[], number[], number, number[]][] = [
  [[0, 0, 0], [-1, 0, 0], 0x00000000, [0, 1]], [[0, 0, 1], [-1, 0, 0], 0x1a0000ff, [1, 1]], [[0, 1, 0], [-1, 0, 0], 0x3300ff00, [0, 0]], [[0, 1, 1], [-1, 0, 0], 0x4d00ffff, [1, 0]],
  [[1, 0, 0], [1, 0, 0], 0x66ff0000, [1, 1]], [[1, 0, 1], [1, 0, 0], 0x80ff00ff, [0, 1]], [[1, 1, 0], [0, 1, 0], 0x99ffff00, [1, 0]], [[1, 1, 1], [0, 1, 0], 0xb3ffffff, [0, 0]],
  [[0, 1, 0], [0, 1, 0], 0x3300ff00, [0, 0]], [[0, 1, 1], [0, 1, 0], 0x4d00ffff, [1, 0]], [[1, 1, 0], [1, 0, 0], 0x99ffff00, [1, 0]], [[1, 1, 1], [1, 0, 0], 0xb3ffffff, [0, 0]],
  [[0, 0, 1], [0, -1, 0], 0x1a0000ff, [1, 1]], [[0, 0, 0], [0, -1, 0], 0x00000000, [0, 1]], [[1, 0, 0], [0, -1, 0], 0x66ff0000, [1, 1]], [[1, 0, 1], [0, -1, 0], 0x80ff00ff, [0, 1]],
  [[0, 0, 1], [0, 0, 1], 0x1a0000ff, [1, 1]], [[1, 0, 1], [0, 0, 1], 0x80ff00ff, [0, 1]], [[1, 1, 1], [0, 0, 1], 0xb3ffffff, [0, 0]], [[0, 1, 1], [0, 0, 1], 0x4d00ffff, [1, 0]],
  [[0, 0, 0], [0, 0, -1], 0x00000000, [0, 1]], [[0, 1, 0], [0, 0, -1], 0x3300ff00, [0, 0]], [[1, 1, 0], [0, 0, -1], 0x99ffff00, [1, 0]], [[1, 0, 0], [0, 0, -1], 0x66ff0000, [1, 1]],
];
const BOX_INDICES = [0, 1, 3, 0, 3, 2, 8, 9, 7, 8, 7, 6, 10, 11, 5, 10, 5, 4, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23];
const BOX_FVF = 0x002 | 0x010 | 0x040 | 0x100; // XYZ | NORMAL | DIFFUSE | TEX1

function expectBox(mesh: D3DXMesh): void {
  expect(mesh.GetFVF()).toBe(BOX_FVF);
  expect(mesh.GetNumVertices()).toBe(24);
  expect(mesh.GetNumFaces()).toBe(12);
  const dv = new DataView(mesh.vb.cpu.buffer, mesh.vb.cpu.byteOffset, mesh.vb.cpu.byteLength);
  BOX_VERTICES.forEach(([p, n, c, t], i) => {
    const o = i * 36;
    expect([0, 1, 2].map((k) => dv.getFloat32(o + 4 * k, true))).toEqual(p);
    expect([0, 1, 2].map((k) => dv.getFloat32(o + 12 + 4 * k, true))).toEqual(n);
    expect(dv.getUint32(o + 24, true)).toBe(c);
    expect([0, 1].map((k) => dv.getFloat32(o + 28 + 4 * k, true))).toEqual(t);
  });
  expect(Array.from(mesh.indices())).toEqual(BOX_INDICES);
}

const alloc = (log: string[] = []): ID3DXAllocateHierarchy => ({
  CreateFrame: (name) => ({ hr: 0, frame: { Name: name, TransformationMatrix: matIdentity(), pMeshContainer: null, pFrameSibling: null, pFrameFirstChild: null } as D3DXFrame }),
  CreateMeshContainer: (name, md, materials, _fx, numMaterials, adjacency, skin) => {
    log.push(`container ${name === null ? "NULL" : `'${name}'`}`);
    return { hr: 0, container: { Name: name, MeshData: md, pMaterials: materials, pEffects: null, NumMaterials: numMaterials, pAdjacency: adjacency, pSkinInfo: skin, pNextMeshContainer: null } as D3DXMeshContainer };
  },
  DestroyFrame: () => 0,
  DestroyMeshContainer: () => 0,
});

describe("D3DX loaders vs Wine's native-checked d3dx9 mesh tests", () => {
  gpuTest("D3DXLoadMeshFromXInMemory(box): split vertices, triangulated quads, D3DCOLORs, materials", async () => {
    const dev = await newD3D9(4, 4);
    const r = D3DXLoadMeshFromXInMemory(enc(BOX_X), D3DXMESH.MANAGED, dev);
    expect(r.hr).toBe(0);
    expectBox(r.mesh!);
    expect(r.materials.length).toBe(2);
    const [m0, m1] = r.materials as [typeof r.materials[0], typeof r.materials[0]];
    expect(m0.MatD3D).toEqual({ diffuse: { r: 0, g: 0, b: 1, a: 1 }, ambient: { r: 0, g: 0, b: 0, a: 1 }, specular: { r: 1, g: 1, b: 1, a: 1 }, emissive: { r: 0, g: 0, b: 0, a: 1 }, power: 0.5 });
    expect(m0.pTextureFilename).toBeNull();
    expect(m1.MatD3D).toEqual({ diffuse: { r: 1, g: 1, b: 1, a: 1 }, ambient: { r: 0, g: 0, b: 0, a: 1 }, specular: { r: 1, g: 1, b: 1, a: 1 }, emissive: { r: 0, g: 0, b: 0, a: 1 }, power: 1 });
    expect(m1.pTextureFilename).toBe("texture.jpg");
    // the loader sorted by material (already sorted here) and built the table: faces 0-5 material 0, 6-11 material 1
    expect(r.mesh!.GetAttributeTable().map((a) => [a.AttribId, a.FaceStart, a.FaceCount])).toEqual([[0, 0, 6], [1, 6, 6]]);
    // the adjacency is the one GenerateAdjacency(0) gives for the final mesh
    expect(Array.from(r.adjacency!)).toEqual(Array.from(r.mesh!.GenerateAdjacency(0)));
  });

  gpuTest("D3DXLoadMeshFromXInMemory: a mesh without materials gets the one default material (0.5 diffuse and specular, the rest 0); bad arguments and empty files", async () => {
    const dev = await newD3D9(4, 4);
    const r = D3DXLoadMeshFromXInMemory(enc(SIMPLE_X), D3DXMESH.MANAGED, dev);
    expect(r.hr).toBe(0);
    expect(r.mesh!.GetFVF()).toBe(0x002);
    expect(Array.from(new Float32Array(r.mesh!.vb.cpu.buffer, r.mesh!.vb.cpu.byteOffset, 9))).toEqual([0, 0, 0, 0, 1, 0, 1, 1, 0]);
    expect(Array.from(r.mesh!.indices())).toEqual([0, 1, 2]);
    expect(r.materials).toEqual([{ MatD3D: { diffuse: { r: 0.5, g: 0.5, b: 0.5, a: 0 }, ambient: { r: 0, g: 0, b: 0, a: 0 }, specular: { r: 0.5, g: 0.5, b: 0.5, a: 0 }, emissive: { r: 0, g: 0, b: 0, a: 0 }, power: 0 }, pTextureFilename: null }]);
    expect(D3DXLoadMeshFromXInMemory(new Uint8Array(0), D3DXMESH.MANAGED, dev).hr).toBe(D3DERR_INVALIDCALL);
    expect(D3DXLoadMeshFromXInMemory(enc(SIMPLE_X), D3DXMESH.MANAGED, null).hr).toBe(D3DERR_INVALIDCALL);
    expect(D3DXLoadMeshFromXInMemory(enc("xof 0303txt 0032"), D3DXMESH.MANAGED, dev).hr).toBe(E_FAIL);
    expect(D3DXLoadMeshFromXInMemory(enc("xof 0303txt 0032\nMesh { 0;; 0;; }"), D3DXMESH.MANAGED, dev).hr).toBe(D3DXERR_LOADEDMESHASNODATA);
  });

  gpuTest("equal normal VALUES under different normal indices do not split a vertex", async () => {
    const dev = await newD3D9(4, 4);
    // two triangles sharing the edge 1-2; the normal list repeats (0,0,1) under indices 0 and 1, face 2 uses index 1 for its corners
    const x = `xof 0303txt 0032
Mesh { 4; 0.0;0.0;0.0;, 1.0;0.0;0.0;, 0.0;1.0;0.0;, 1.0;1.0;0.0;; 2; 3; 0,1,2;, 3; 1,3,2;;
  MeshNormals { 2; 0.0;0.0;1.0;, 0.0;0.0;1.0;; 2; 3; 0,0,0;, 3; 1,1,1;; } }`;
    const r = D3DXLoadMeshFromXInMemory(enc(x), D3DXMESH.MANAGED, dev);
    expect(r.hr).toBe(0);
    expect(r.mesh!.GetNumVertices()).toBe(4); // by index it would be 6
    expect(Array.from(r.mesh!.indices())).toEqual([0, 1, 2, 1, 3, 2]);
    // ... but different values do
    const y = x.replace("0.0;0.0;1.0;;", "0.0;0.0;-1.0;;");
    const r2 = D3DXLoadMeshFromXInMemory(enc(y), D3DXMESH.MANAGED, dev);
    expect(r2.mesh!.GetNumVertices()).toBe(6); // vertices 1 and 2 are repeated, in order of first appearance
    expect(Array.from(r2.mesh!.indices())).toEqual([0, 1, 2, 4, 3, 5]);
  });

  gpuTest("hierarchy: a top-level Mesh gets a frame with a NULL name, the container name is the empty string, no materials stay none, no controller", async () => {
    const dev = await newD3D9(4, 4);
    const log: string[] = [];
    const simple = D3DXLoadMeshHierarchyFromXInMemory(enc(SIMPLE_X), D3DXMESH.MANAGED, dev, alloc(log));
    expect(simple.hr).toBe(0);
    expect(simple.animController).toBeNull();
    const f = simple.frameRoot!;
    expect(f.Name).toBeNull();
    expect(Array.from(f.TransformationMatrix)).toEqual(Array.from(matIdentity()));
    const c = f.pMeshContainer!;
    expect(c.Name).toBe("");
    expect(c.MeshData.Type).toBe(D3DXMESHTYPE.MESH);
    expect(c.NumMaterials).toBe(0);
    expect(c.pSkinInfo).toBeNull();
    expect(c.pAdjacency).toEqual(Uint32Array.of(0xffffffff, 0xffffffff, 0xffffffff));
    expect(D3DXFrameDestroy(f, alloc())).toBe(0);

    const box = D3DXLoadMeshHierarchyFromXInMemory(enc(BOX_X), D3DXMESH.MANAGED, dev, alloc());
    expect(box.animController).toBeNull();
    expect(box.frameRoot!.Name).toBeNull();
    expect(box.frameRoot!.pMeshContainer!.NumMaterials).toBe(2);
    expectBox(box.frameRoot!.pMeshContainer!.MeshData.pMesh!);
    expect(Array.from(box.frameRoot!.pMeshContainer!.pAdjacency!)).toEqual(Array.from(box.frameRoot!.pMeshContainer!.MeshData.pMesh!.GenerateAdjacency(0)));
  });

  gpuTest("hierarchy: a frame with three meshes (the last FrameTransformMatrix wins), an unnamed Frame is named '', an empty Mesh gives a frame without container, empty file is E_FAIL", async () => {
    const dev = await newD3D9(4, 4);
    const framed = `xof 0303txt 0032
Frame {
  Mesh { 3; 0.0;0.0;0.0;, 0.0;1.0;0.0;, 1.0;1.0;0.0;; 1; 3; 0,1,2;; }
  FrameTransformMatrix { 1.0,0.0,0.0,0.0, 0.0,1.0,0.0,0.0, 0.0,0.0,1.0,0.0, 0.0,0.0,2.0,1.0;; }
  Mesh { 3; 0.0;0.0;0.0;, 0.0;1.0;0.0;, 2.0;1.0;0.0;; 1; 3; 0,1,2;; }
  FrameTransformMatrix { 1.0,0.0,0.0,0.0, 0.0,1.0,0.0,0.0, 0.0,0.0,1.0,0.0, 0.0,0.0,3.0,1.0;; }
  Mesh { 3; 0.0;0.0;0.0;, 0.0;1.0;0.0;, 3.0;1.0;0.0;; 1; 3; 0,1,2;; }
}`;
    const r = D3DXLoadMeshHierarchyFromXInMemory(enc(framed), D3DXMESH.MANAGED, dev, alloc());
    expect(r.hr).toBe(0);
    expect(r.frameRoot!.Name).toBe("");
    expect(r.frameRoot!.TransformationMatrix[14]).toBe(3);
    const xs: number[] = [];
    for (let c = r.frameRoot!.pMeshContainer; c; c = c.pNextMeshContainer) { expect(c.Name).toBe(""); xs.push(new Float32Array(c.MeshData.pMesh!.vb.cpu.buffer, c.MeshData.pMesh!.vb.cpu.byteOffset, 9)[6]!); }
    expect(xs).toEqual([1, 2, 3]);

    const empty = D3DXLoadMeshHierarchyFromXInMemory(enc("xof 0303txt 0032\nFrame Box01 { Mesh { 0;; 0;; MeshNormals { 0;; 0;; } } }"), D3DXMESH.MANAGED, dev, alloc());
    expect(empty.hr).toBe(0);
    expect(empty.frameRoot!.Name).toBe("Box01");
    expect(empty.frameRoot!.pMeshContainer).toBeNull();

    expect(D3DXLoadMeshHierarchyFromXInMemory(enc("xof 0303txt 0032"), D3DXMESH.MANAGED, dev, alloc()).hr).toBe(E_FAIL);
    expect(D3DXLoadMeshHierarchyFromXInMemory(new Uint8Array(0), D3DXMESH.MANAGED, dev, alloc()).hr).toBe(D3DERR_INVALIDCALL);
    expect(D3DXLoadMeshHierarchyFromXInMemory(enc(SIMPLE_X), D3DXMESH.MANAGED, null, alloc()).hr).toBe(D3DERR_INVALIDCALL);
    expect(D3DXLoadMeshHierarchyFromXInMemory(enc(SIMPLE_X), D3DXMESH.MANAGED, dev, null).hr).toBe(D3DERR_INVALIDCALL);
  });

  gpuTest("hierarchy: several top-level frames / meshes hang below one extra root frame (NULL name, identity)", async () => {
    const dev = await newD3D9(4, 4);
    const tri = (x: number) => `Mesh { 3; 0.0;0.0;0.0;, 0.0;1.0;0.0;, ${x}.0;1.0;0.0;; 1; 3; 0,1,2;; }`;
    const two = `xof 0303txt 0032\nFrame A { ${tri(1)} } Frame B { Frame B1 { ${tri(2)} } } ${tri(3)}`;
    const r = D3DXLoadMeshHierarchyFromXInMemory(enc(two), D3DXMESH.MANAGED, dev, alloc());
    expect(r.hr).toBe(0);
    const root = r.frameRoot!;
    expect(root.Name).toBeNull();
    expect(root.pMeshContainer).toBeNull();
    const kids: (string | null)[] = [];
    for (let f = root.pFrameFirstChild; f; f = f.pFrameSibling) kids.push(f.Name);
    expect(kids).toEqual(["A", "B", null]); // the top-level Mesh sits in a frame of its own
    expect(root.pFrameFirstChild!.pFrameSibling!.pFrameFirstChild!.Name).toBe("B1");
    expect(root.pFrameSibling).toBeNull();
    // a single top-level frame is returned as is
    const one = D3DXLoadMeshHierarchyFromXInMemory(enc(`xof 0303txt 0032\nFrame A { ${tri(1)} }`), D3DXMESH.MANAGED, dev, alloc());
    expect(one.frameRoot!.Name).toBe("A");
    expect(one.frameRoot!.pFrameSibling).toBeNull();
  });

  gpuTest("hierarchy: an AnimationSet gives a controller with that set registered and an output per named frame", async () => {
    const dev = await newD3D9(4, 4);
    const x = `xof 0303txt 0032
Mesh CubeMesh { 3; 0.0;0.0;0.0;, 0.0;1.0;0.0;, 1.0;1.0;0.0;; 1; 3; 0,1,2;; }
Frame CubeFrame {
  FrameTransformMatrix { 1.0,0.0,0.0,0.0, 0.0,1.0,0.0,0.0, 0.0,0.0,1.0,0.0, 0.0,0.0,0.0,1.0;; }
  { CubeMesh }
}
AnimationSet AnimationSet0 {
  Animation Animation0 {
    { CubeFrame }
    AnimationKey { 2; 3; 10; 3; -100.0, 0.0, 0.0;;, 50; 3; 0.0, 0.0, 0.0;;, 90; 3; 100.0, 0.0, 0.0;;; }
  }
}`;
    const r = D3DXLoadMeshHierarchyFromXInMemory(enc(x), D3DXMESH.MANAGED, dev, alloc());
    expect(r.hr).toBe(0);
    const ac = r.animController!;
    expect(ac).not.toBeNull();
    expect(ac.GetNumAnimationSets()).toBe(1);
    const set = ac.GetAnimationSetByName("AnimationSet0").set! as D3DXKeyframedAnimationSet;
    expect(set.GetNumAnimations()).toBe(1);
    expect(set.GetSourceTicksPerSecond()).toBe(4800); // the D3DX default without an AnimTicksPerSecond
    expect(set.GetPeriod()).toBeCloseTo(90 / 4800, 12);
    // the frame called CubeFrame is moved by the controller
    const cube = D3DXFrameFind(r.frameRoot, "CubeFrame");
    expect(cube).not.toBeNull();
    expect(r.frameRoot!.Name).toBeNull(); // the top-level CubeMesh and the Frame: two top-level items below the synthetic root
    expect(cube!.pMeshContainer!.Name).toBe("CubeMesh"); // the { CubeMesh } reference inside the frame is resolved
    ac.SetTrackAnimationSet(0, set); ac.SetTrackEnable(0, true);
    ac.AdvanceTime(50 / 4800);
    expect(cube!.TransformationMatrix[12]).toBeCloseTo(0, 4);
    ac.AdvanceTime(20 / 4800);
    expect(cube!.TransformationMatrix[12]).toBeCloseTo(50, 3);
  });
});
