/**
 * KSM / KAC loading (x2.exe.c L429515 LoadKSkinnedMesh, L430172 ReadKSM, L448687 KTDXAnimationController::ReadFromMemory) and the
 * CMultiAnimAllocateHierarchy (L428782 / L428909).  The expectations come from the decompile and from parsing the shipped files with
 * @els/assets (independent of the loader); the pose test recomputes frame matrices from the raw keys.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { KomArchive, fileSource } from "@els/kom";
import { parseKsm } from "@els/assets";
import { D3DXMESHTYPE, D3DXFrameFind, composeSRT, quatNormalize } from "@els/d3d9";
import type { D3DXFrame, D3DXMesh, D3DXMaterial } from "@els/d3d9";
import {
  CMultiAnimAllocateHierarchy, MultiAnimFrame, MultiAnimMC, NO_NAME, isKsmData, loadKSkinnedMesh, loadSkinnedMesh, normalizeRotationKeys,
} from "../src/index.ts";
import { gpuAvailable, newD3D9 } from "../../d3d9/test/gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU && existsSync("data/data033.kom") && existsSync("data/data021.kom") ? test : test.skip;

async function read(kom: string, name: string): Promise<Uint8Array> {
  const a = await KomArchive.open(fileSource(`data/${kom}`));
  return a.read(a.entries.find((e) => e.name.toUpperCase() === name.toUpperCase())!);
}

describe("CMultiAnimAllocateHierarchy.CreateFrame (3296DE80)", () => {
  const alloc = new CMultiAnimAllocateHierarchy("Bip01");
  const make = (n: string | null) => alloc.CreateFrame(n).frame as MultiAnimFrame;

  test("a null or empty name becomes \"<no_name>\"; everything else is kept", () => {
    expect(make(null).Name).toBe(NO_NAME);
    expect(make("").Name).toBe(NO_NAME);
    expect(make("Bip01_Spine").Name).toBe("Bip01_Spine");
    expect(NO_NAME).toBe("<no_name>");
  });

  test("defaults of the MultiAnimFrame members", () => {
    const f = make("x");
    expect(alloc.CreateFrame("x").hr).toBe(0);
    expect([f.m_bDraw, f.m_bMoveBone, f.m_iIndex, f.m_bScale, f.m_bApplyChild, f.m_fDistance, f.m_bJiggleFrame, f.m_iJiggleLevel, f.m_bMoveBoneY, f.m_fMoveBoneY, f.fBoundingRadius])
      .toEqual([true, false, -1, false, true, -1, false, 0, false, 0, 0]);
    expect(f.m_vScaleRel).toEqual([1, 1, 1]);
    expect(Array.from(f.combineMatrix)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(f.pMeshContainer).toBeNull();
  });

  test("COLLISION*, ATTACK* and Bip01_Footsteps* frames are not drawn; the move bone is the frame whose name equals the proxy's", () => {
    for (const n of ["COLLISION_BOX", "ATTACK_LINE_END0", "Bip01_Footsteps", "Bip01_Footsteps_x"]) expect([n, make(n).m_bDraw]).toEqual([n, false]);
    for (const n of ["COLLISIO", "ATTAC", "Bip01_Footstep"]) expect([n, make(n).m_bDraw]).toEqual([n, true]);
    expect(make("Bip01").m_bMoveBone).toBe(true);
    expect(make("Bip02").m_bMoveBone).toBe(false);
    expect(make("bip01").m_bMoveBone).toBe(false); // strcmp: case sensitive
    expect(new CMultiAnimAllocateHierarchy("").CreateFrame("Bip01").frame).toMatchObject({ m_bMoveBone: false });
  });
});

describe("CMultiAnimAllocateHierarchy.CreateMeshContainer (3296E0F0)", () => {
  const fakeMesh = { GetNumFaces: () => 2, Release: () => 0 } as unknown as D3DXMesh;
  const alloc = new CMultiAnimAllocateHierarchy();
  const mat = (r: number): D3DXMaterial => ({ MatD3D: { diffuse: { r, g: 0, b: 0, a: 1 }, ambient: { r: 0, g: 1, b: 0, a: 1 }, specular: { r: 0, g: 0, b: 1, a: 1 }, emissive: { r: 1, g: 1, b: 0, a: 1 }, power: 5 }, pTextureFilename: "a.tga" });
  const adjacency = Uint32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);

  test("a copy of the materials and the adjacency, a null name becomes \"<no_name>\", one texture slot per material", () => {
    const r = alloc.CreateMeshContainer(null, { Type: D3DXMESHTYPE.MESH, pMesh: fakeMesh }, [mat(0.25), mat(0.5)], null, 2, adjacency, null);
    const mc = r.container as MultiAnimMC;
    expect(r.hr).toBe(0);
    expect(mc.Name).toBe(NO_NAME);
    expect(mc.NumMaterials).toBe(2);
    expect(mc.pMaterials[1]!.MatD3D.diffuse.r).toBe(0.5);
    expect(mc.pMaterials[0]!.pTextureFilename).toBe("a.tga");
    expect(Array.from(mc.pAdjacency!)).toEqual([1, 2, 3, 4, 5, 6]); // 3 per face
    expect(mc.m_apTextures).toEqual([null, null]);
    expect(mc.pSkinInfo).toBeNull();
    expect(mc.m_dwNumBones).toBe(0);
  });

  test("no material at all gives one grey default (diffuse = specular = 0.5, alpha 0, no texture)", () => {
    const mc = alloc.CreateMeshContainer("m", { Type: D3DXMESHTYPE.MESH, pMesh: fakeMesh }, [], null, 0, adjacency, null).container as MultiAnimMC;
    expect(mc.NumMaterials).toBe(1);
    expect(mc.pMaterials[0]).toEqual({ MatD3D: { diffuse: { r: 0.5, g: 0.5, b: 0.5, a: 0 }, ambient: { r: 0, g: 0, b: 0, a: 0 }, specular: { r: 0.5, g: 0.5, b: 0.5, a: 0 }, emissive: { r: 0, g: 0, b: 0, a: 0 }, power: 0 }, pTextureFilename: null });
  });

  test("only plain meshes; a skin info without bones is refused", () => {
    const logs: number[] = [];
    const a = new CMultiAnimAllocateHierarchy("", (id) => logs.push(id));
    expect(a.CreateMeshContainer("p", { Type: D3DXMESHTYPE.PMESH, pMesh: fakeMesh }, [], null, 0, adjacency, null).hr).toBeLessThan(0);
    const noBones = { GetNumBones: () => 0 } as never;
    expect(a.CreateMeshContainer("s", { Type: D3DXMESHTYPE.MESH, pMesh: fakeMesh }, [], null, 0, adjacency, noBones).container).toBeNull();
    expect(logs).toEqual([0x65, 0x150, 0x65]);
  });

  test("the palette is min(bones, 20) and the bone offsets are copied", () => {
    const skin = (n: number) => ({ GetNumBones: () => n, GetBoneOffsetMatrix: (i: number) => Float32Array.from({ length: 16 }, (_, k) => i * 100 + k) }) as never;
    const c = (n: number) => alloc.CreateMeshContainer("s", { Type: D3DXMESHTYPE.MESH, pMesh: fakeMesh }, [mat(1)], null, 1, adjacency, skin(n)).container as MultiAnimMC;
    expect(c(7).m_dwNumPaletteEntries).toBe(7);
    expect(c(20).m_dwNumPaletteEntries).toBe(20);
    expect(c(43).m_dwNumPaletteEntries).toBe(20);
    expect(c(3).m_amxBoneOffsets!.map((m) => m[0])).toEqual([0, 100, 200]);
  });
});

describe("rotation keys as OptimizeKeys leaves them", () => {
  test("one key is left alone; two or more are normalised and flipped into the previous key's hemisphere (the first gets w >= 0)", () => {
    expect(normalizeRotationKeys([{ time: 0, value: [0, 0, 0, 2] }])[0]!.Value).toEqual({ x: 0, y: 0, z: 0, w: 2 });
    const k = normalizeRotationKeys([{ time: 0, value: [0, 0, 0, -2] }, { time: 1, value: [0, 0, 3, -3] }, { time: 2, value: [0, 0, -1, 0] }]);
    expect(k[0]!.Value).toEqual({ x: -0, y: -0, z: -0, w: 1 });
    const s = Math.fround(Math.SQRT1_2);
    expect(k[1]!.Value).toEqual({ x: -0, y: -0, z: -s, w: s }); // dot with the first key was negative -> negated (the exe flips sign bits, so the zeros become -0)
    expect(k[2]!.Value).toEqual({ x: 0, y: 0, z: -1, w: 0 }); // dot with the second key is +s -> kept
    for (const q of k) expect(Math.hypot(q.Value.x, q.Value.y, q.Value.z, q.Value.w)).toBeCloseTo(1, 6);
    expect(quatNormalize({ x: 0, y: 0, z: 0, w: 0 })).toEqual({ x: 0, y: 0, z: 0, w: 0 });
  });
});

describe("loading real files", () => {
  test("the format test: 'KSM ' only", () => {
    expect(isKsmData(Uint8Array.from([0x4b, 0x53, 0x4d, 0x20, 1]))).toBe(true);
    expect(isKsmData(Uint8Array.from([0x4b, 0x53, 0x4d]))).toBe(false);
    expect(isKsmData(Uint8Array.from([0x78, 0x6f, 0x66, 0x20]))).toBe(false);
  });

  gpuTest("Motion_Elsword.x: 68 frames, 12 containers (6 skinned), 90 animation sets bound by frame name", async () => {
    const bytes = await read("data033.kom", "Motion_Elsword.x");
    const parsed = parseKsm(bytes);
    const dev = await newD3D9(4, 4);
    const logs: number[] = [];
    const k = loadKSkinnedMesh(bytes, dev, "", (id) => logs.push(id));
    expect(k.hr).toBe(0);
    expect(logs).toEqual([]);
    expect(k.frameList.length).toBe(68);
    expect(k.frameRoot).toBe(k.frameList[0]!);
    expect(k.frameList.every((f, i) => f.m_iIndex === i)).toBe(true);
    expect(k.frameList.map((f) => f.Name)).toEqual(parsed.frames.map((f) => f.name || NO_NAME));
    expect(k.frameList.map((f) => f.fBoundingRadius)).toEqual(parsed.frames.map((f) => f.boundingRadius));
    expect(k.center).toEqual(parsed.center);
    expect(k.maxBoundingRadius).toBe(parsed.maxBoundingRadius);
    // links: sibling / first child by index
    parsed.frames.forEach((pf, i) => {
      expect(k.frameList[i]!.pFrameSibling).toBe(pf.sibling >= 0 ? k.frameList[pf.sibling]! : null);
      expect(k.frameList[i]!.pFrameFirstChild).toBe(pf.firstChild >= 0 ? k.frameList[pf.firstChild]! : null);
    });
    // containers
    const withMesh = k.frameList.filter((f) => f.pMeshContainer);
    expect(withMesh.length).toBe(12);
    let skinned = 0;
    for (const f of withMesh) {
      const mc = f.pMeshContainer as MultiAnimMC, pc = parsed.frames[f.m_iIndex]!.meshContainer!;
      const mesh = mc.MeshData.pMesh!;
      expect([mesh.GetNumVertices(), mesh.GetNumFaces(), mesh.GetFVF(), mc.NumMaterials]).toEqual([pc.vertexCount, pc.faceCount, pc.fvf, pc.materials.length]);
      expect(mc.MeshData.Type).toBe(D3DXMESHTYPE.MESH);
      expect(mc.pAdjacency!.length).toBe(3 * pc.faceCount);
      expect(Array.from(mesh.attributeBuffer)).toEqual(Array.from(pc.attributes));
      expect(Array.from(mesh.indices())).toEqual(Array.from(pc.indices));
      expect(Buffer.compare(Buffer.from(mesh.vb.cpu.subarray(0, pc.vertices.length)), Buffer.from(pc.vertices))).toBe(0);
      expect(mc.pMaterials.map((m) => m.pTextureFilename)).toEqual(pc.materials.map((m) => m.texture));
      expect(mc.pMaterials[0]!.MatD3D.diffuse).toEqual({ r: pc.materials[0]!.diffuse[0], g: pc.materials[0]!.diffuse[1], b: pc.materials[0]!.diffuse[2], a: pc.materials[0]!.diffuse[3] });
      expect(mc.m_dwNumBones).toBe(pc.bones.length);
      if (pc.bones.length === 0) { expect(mc.pSkinInfo).toBeNull(); continue; }
      skinned++;
      const si = mc.pSkinInfo!;
      expect(si.GetNumBones()).toBe(pc.bones.length);
      expect(mc.m_dwNumPaletteEntries).toBe(pc.numPaletteEntries);
      pc.bones.forEach((b, i) => {
        expect(mc.m_ppBoneFrames![i]).toBe(k.frameList[b.frameIndex]!); // by index, not by name
        expect(si.GetBoneName(i)).toBe(k.frameList[b.frameIndex]!.Name);
        expect(Array.from(si.GetBoneOffsetMatrix(i)!)).toEqual(Array.from(b.offsetMatrix));
        const inf = si.GetBoneInfluence(i)!;
        expect([Array.from(inf.vertices), Array.from(inf.weights)]).toEqual([Array.from(b.vertexIndices), Array.from(b.weights)]);
      });
    }
    expect(skinned).toBe(6);
    // controller: 2 tracks, 30 events, one set per KAC set, named like the file's
    const c = k.animController!;
    expect([c.GetMaxNumTracks(), c.GetMaxNumEvents(), c.GetNumAnimationSets()]).toEqual([2, 30, 90]);
    expect(c.GetMaxNumAnimationOutputs()).toBe(68);
    parsed.animation!.sets.forEach((s, i) => {
      const set = c.GetAnimationSet(i).set!;
      expect(set.GetName()).toBe(s.name);
      expect(set.GetNumAnimations()).toBe(s.animations.length);
      expect(set.GetPeriod()).toBeCloseTo(Math.max(...s.animations.flatMap((a) => [a.scales, a.rotations, a.translations].map((l) => (l.length ? l[l.length - 1]!.time : 0)))) / s.ticksPerSecond, 9);
    });
  });

  gpuTest("the pose at time 0 is the first key of every animated frame (scale, rotation, translation composed like D3DX)", async () => {
    const bytes = await read("data033.kom", "Motion_Elsword.x");
    const parsed = parseKsm(bytes);
    const dev = await newD3D9(4, 4);
    const k = loadKSkinnedMesh(bytes, dev);
    const c = k.animController!;
    const set0 = parsed.animation!.sets[0]!;
    c.SetTrackAnimationSet(0, c.GetAnimationSet(0).set);
    c.SetTrackEnable(0, true);
    c.SetTrackPosition(0, 0);
    c.AdvanceTime(0, null);
    expect(set0.animations.length).toBeGreaterThan(30);
    for (const a of set0.animations) {
      const frame = k.frameList[a.frameIndex]!;
      const s = a.scales[0]!.value, t = a.translations[0]!.value, q = a.rotations.length > 1 ? quatNormalize({ x: a.rotations[0]!.value[0], y: a.rotations[0]!.value[1], z: a.rotations[0]!.value[2], w: a.rotations[0]!.value[3] }) : { x: a.rotations[0]!.value[0], y: a.rotations[0]!.value[1], z: a.rotations[0]!.value[2], w: a.rotations[0]!.value[3] };
      const qq = q.w < 0 && a.rotations.length > 1 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
      const want = composeSRT({ x: s[0], y: s[1], z: s[2] }, { x: -qq.x, y: -qq.y, z: -qq.z, w: qq.w }, { x: t[0], y: t[1], z: t[2] }); // the matrix is built from the conjugate of the key
      for (let i = 0; i < 16; i++) expect(Math.abs(frame.TransformationMatrix[i]! - want[i]!)).toBeLessThan(1e-5);
    }
  });

  gpuTest("the keys are X-convention quaternions: Wait3 at 0 s puts Bip01 (and the idle pose of most bones) on the rest matrix of the file", async () => {
    const bytes = await read("data033.kom", "Motion_Elsword.x");
    const parsed = parseKsm(bytes);
    const dev = await newD3D9(4, 4);
    const k = loadKSkinnedMesh(bytes, dev);
    const rest = k.frameList.map((f) => f.TransformationMatrix.slice());
    const c = k.animController!;
    c.SetTrackAnimationSet(0, c.GetAnimationSet(0).set);
    c.SetTrackEnable(0, true);
    c.AdvanceTime(0, null);
    const same = (i: number): boolean => rest[i]!.every((v, j) => Math.abs(v - k.frameList[i]!.TransformationMatrix[j]!) < 2e-3);
    const bip = k.frameList.findIndex((f) => f.Name === "Bip01");
    expect(parsed.frames[bip]!.matrix[2]).toBeLessThan(-0.9); // the file's matrix (rotation about y by 105 degrees); the key (0, -0.79, 0, 0.61) read as D3DX does would give +0.96
    expect(same(bip)).toBe(true);
    const animated = parsed.animation!.sets[0]!.animations.map((a) => a.frameIndex);
    expect(animated.filter(same).length).toBeGreaterThan(animated.length * 0.5);
  });

  gpuTest("Mesh_Elsword_Base_SD.x: two frames, one static container; loadSkinnedMesh sniffs the format and lists the draw frames", async () => {
    const bytes = await read("data021.kom", "Mesh_Elsword_Base_SD.x");
    const dev = await newD3D9(4, 4);
    const m = loadSkinnedMesh(bytes, dev);
    expect(m.hr).toBe(0);
    expect(m.format).toBe("KSM");
    expect(m.frameList.length).toBe(2);
    expect(m.drawFrameList.length).toBe(1);
    expect(m.animController!.GetNumAnimationSets()).toBe(1);
    const parsed = parseKsm(bytes);
    const mc = m.drawFrameList[0]!.pMeshContainer as MultiAnimMC;
    expect(mc.MeshData.pMesh!.GetNumVertices()).toBe(711);
    expect(mc.pSkinInfo).toBeNull();
    expect(m.center).toEqual(parsed.center);
  });

  gpuTest("X files still go through D3DX: frames named by the allocator, bones found by name, bounding sphere computed", async () => {
    if (!existsSync("data/data017.kom")) return;
    const bytes = await read("data017.kom", "MESH_ELSWORD_BASIC_WEAPON.X");
    const dev = await newD3D9(4, 4);
    const m = loadSkinnedMesh(bytes, dev, "Bip01");
    expect(m.hr).toBe(0);
    expect(m.format).toBe("X");
    expect(m.frames!.frames.length).toBe(7);
    expect(m.frameList.every((f) => f instanceof MultiAnimFrame && f.Name !== null)).toBe(true);
    expect(m.drawFrameList.map((f) => f.Name)).toEqual(["Elsword_Basic_Weapon"]);
    expect(m.maxBoundingRadius).toBeGreaterThan(0);
    expect(m.animController!.GetNumAnimationSets()).toBe(1); // the loader's own controller (D3DXLoadMeshHierarchyFromXInMemory)
    expect(m.animController!.GetMaxNumAnimationOutputs()).toBe(7);
  });

  gpuTest("a damaged KSM fails with E_FAIL and no objects; an X file that is not a KSM is not misread", async () => {
    const bytes = await read("data021.kom", "Mesh_Elsword_Base_SD.x");
    const dev = await newD3D9(4, 4);
    const logs: number[] = [];
    const cut = loadSkinnedMesh(bytes.subarray(0, 4000), dev, "", (id) => logs.push(id));
    expect(cut.hr).toBeLessThan(0);
    expect(cut.frameRoot).toBeNull();
    expect(logs.length).toBeGreaterThan(0);
    const wrongVersion = Uint8Array.from(bytes);
    wrongVersion[4] = 1;
    expect(loadSkinnedMesh(wrongVersion, dev).hr).toBeLessThan(0);
    expect(loadSkinnedMesh(Uint8Array.from([1, 2, 3, 4, 5, 6]), dev).hr).toBeLessThan(0);
    expect(D3DXFrameFind(null, "x")).toBeNull();
    const none: D3DXFrame | null = loadSkinnedMesh(wrongVersion, dev).frameRoot;
    expect(none).toBeNull();
  });
});
