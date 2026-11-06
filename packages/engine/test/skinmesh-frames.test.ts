/** CKTDXDeviceXSkinMesh::XSkinMeshProxy frame lists (x2.exe.c L430693 SetupFrameList, L430592 SetupDrawFrameList, L428384 ComputeCollisionData). */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { KomArchive, fileSource } from "@els/kom";
import { D3DXLoadMeshHierarchyFromXInMemory, D3DXMESH, matIdentity } from "@els/d3d9";
import type { D3DXFrame, D3DXMeshContainer, ID3DXAllocateHierarchy } from "@els/d3d9";
import { MAX_FRAMES, collisionFrames, isCollisionFrameName, isNoDrawFrameName, setupDrawFrameList, setupFrameList } from "../src/index.ts";
import { gpuAvailable, newD3D9 } from "../../d3d9/test/gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;

const container = (n: number, next: D3DXMeshContainer | null = null): D3DXMeshContainer =>
  ({ Name: `mc${n}`, MeshData: { Type: 1, pMesh: null }, pMaterials: [], pEffects: null, NumMaterials: 0, pAdjacency: null, pSkinInfo: null, pNextMeshContainer: next }) as unknown as D3DXMeshContainer;
const frame = (name: string | null, opts: { mesh?: boolean; sibling?: D3DXFrame | null; child?: D3DXFrame | null } = {}): D3DXFrame =>
  ({ Name: name, TransformationMatrix: matIdentity(), pMeshContainer: opts.mesh ? container(1) : null, pFrameSibling: opts.sibling ?? null, pFrameFirstChild: opts.child ?? null });
const names = (fs: readonly D3DXFrame[]): (string | null)[] => fs.map((f) => f.Name);

describe("frame names", () => {
  test("COLLISION (9 bytes) and ATTACK (6 bytes) prefixes, Bip01_Footsteps (15 bytes) only for no-draw; all case sensitive", () => {
    for (const n of ["COLLISION", "COLLISION_BOX1", "ATTACK", "ATTACK_LINE_START0_Sword", "ATTACK_SPHERE3_Back01"]) expect([n, isCollisionFrameName(n), isNoDrawFrameName(n)]).toEqual([n, true, true]);
    for (const n of ["COLLISIO", "ATTAC", "attack_line", "Collision", "MyATTACK", "", null]) expect([n, isCollisionFrameName(n), isNoDrawFrameName(n)]).toEqual([n, false, false]);
    expect([isCollisionFrameName("Bip01_Footsteps"), isNoDrawFrameName("Bip01_Footsteps")]).toEqual([false, true]);
    expect(isNoDrawFrameName("Bip01_Footsteps_x")).toBe(true);
    for (const n of ["Bip01_Footstep", "bip01_footsteps", "Bip01_Footstepz", "Bip01"]) expect([n, isNoDrawFrameName(n)]).toEqual([n, false]);
  });
});

describe("SetupFrameList", () => {
  test("a frame, then its siblings (each with their siblings), then its children", () => {
    const a1 = frame("A1");
    const c = frame("C");
    const b = frame("B", { sibling: c });
    const a = frame("A", { sibling: b, child: a1 });
    const r = frame("R", { child: a });
    const l = setupFrameList(r);
    expect(l.hr).toBe(0);
    expect(names(l.frames)).toEqual(["R", "A", "B", "C", "A1"]);
    expect(l.errors).toEqual([]);
  });

  test("255 frames are fine, the 256th fails with log id 0x15C", () => {
    const chain = (n: number): D3DXFrame => { let head: D3DXFrame | null = null; for (let i = n - 1; i >= 0; i--) head = frame(`f${i}`, { child: head }); return head!; };
    const ok = setupFrameList(chain(MAX_FRAMES));
    expect([ok.hr, ok.frames.length]).toEqual([0, 255]);
    const bad = setupFrameList(chain(MAX_FRAMES + 1));
    expect(bad.hr).toBeLessThan(0);
    expect(bad.frames.length).toBe(255);
    expect(bad.errors).toEqual([{ code: 0x15c, frame: "f255" }]);
  });

  test("a second mesh container in a frame is only logged (0xD4)", () => {
    const f = frame("two");
    f.pMeshContainer = container(1, container(2));
    const l = setupFrameList(f);
    expect(l.hr).toBe(0);
    expect(l.errors).toEqual([{ code: 0xd4, frame: "two" }]);
  });

  test("no root, no frames", () => { expect(setupFrameList(null)).toEqual({ hr: 0, frames: [], errors: [] }); });
});

describe("SetupDrawFrameList", () => {
  test("only frames with a mesh container; helper frames and everything below them are skipped; siblings of a helper frame are not", () => {
    const deepMesh = frame("deep_under_attack", { mesh: true });
    const attackKid = frame("kid", { mesh: true, child: deepMesh });
    const attack = frame("ATTACK_LINE_END0", { mesh: true, child: attackKid });
    const coll = frame("COLLISION_SPHERE1", { mesh: false, child: frame("under_collision", { mesh: true }) });
    const foot = frame("Bip01_Footsteps", { mesh: true, child: frame("under_foot", { mesh: true }) });
    const hand = frame("Bip01_R_Hand", { mesh: false, child: frame("weapon_mesh", { mesh: true }) });
    const body = frame("Body", { mesh: true, sibling: attack, child: frame("bodychild", { mesh: true, sibling: coll }) });
    attack.pFrameSibling = foot;
    foot.pFrameSibling = hand;
    const root = frame("Scene_Root", { child: body });
    expect(names(setupDrawFrameList(root))).toEqual(["Body", "weapon_mesh", "bodychild"]);
    // the full list still has everything (the frame list is not filtered)
    expect(setupFrameList(root).frames.length).toBe(12);
  });

  test("a mesh-less frame named ATTACK* hides its subtree too; a frame shorter than 6 bytes is always drawn", () => {
    const root = frame("ROOT", { child: frame("ATTACK_X", { mesh: false, child: frame("hidden", { mesh: true }) }) });
    expect(setupDrawFrameList(root)).toEqual([]);
    expect(names(setupDrawFrameList(frame("ATTAC", { mesh: true })))).toEqual(["ATTAC"]);
    expect(names(setupDrawFrameList(frame(null, { mesh: true })))).toEqual([null]);
  });

  test("the draw list holds at most 255 frames", () => {
    let head: D3DXFrame | null = null;
    for (let i = 0; i < 300; i++) head = frame(`m${i}`, { mesh: true, sibling: head });
    expect(setupDrawFrameList(head).length).toBe(255);
  });

  test("collisionFrames picks COLLISION* / ATTACK* entries of the frame list in order", () => {
    const b = frame("ATTACK_SPHERE1_Lhand1");
    const a = frame("COLLISION_BODY", { sibling: b });
    const root = frame("root", { child: frame("Bip01", { child: a }) });
    expect(names(collisionFrames(setupFrameList(root).frames))).toEqual(["COLLISION_BODY", "ATTACK_SPHERE1_Lhand1"]);
  });
});

describe("real data", () => {
  gpuTest("MESH_ELSWORD_BASIC_WEAPON.X: 7 frames; only Elsword_Basic_Weapon is drawn, the two ATTACK_LINE boxes are collision data", async () => {
    if (!existsSync("data/data017.kom")) return;
    const kom = await KomArchive.open(fileSource("data/data017.kom"));
    const bytes = await kom.read(kom.entries.find((e) => e.name.toUpperCase() === "MESH_ELSWORD_BASIC_WEAPON.X")!);
    const dev = await newD3D9(4, 4);
    const alloc: ID3DXAllocateHierarchy = {
      CreateFrame: (n) => ({ hr: 0, frame: frame(n) }),
      CreateMeshContainer: (n, md, mats, _eff, nm, adj, skin) => ({ hr: 0, container: { Name: n, MeshData: md, pMaterials: mats, pEffects: null, NumMaterials: nm, pAdjacency: adj, pSkinInfo: skin, pNextMeshContainer: null } }),
      DestroyFrame: () => 0,
      DestroyMeshContainer: () => 0,
    };
    const r = D3DXLoadMeshHierarchyFromXInMemory(bytes, D3DXMESH.MANAGED, dev, alloc);
    expect(r.hr).toBe(0);
    const list = setupFrameList(r.frameRoot);
    expect(list.hr).toBe(0);
    expect(list.frames.length).toBe(7);
    expect(names(setupDrawFrameList(r.frameRoot))).toEqual(["Elsword_Basic_Weapon"]);
    expect(names(collisionFrames(list.frames))).toEqual(["ATTACK_LINE_END0", "ATTACK_LINE_START0_Sword"]);
  });
});
