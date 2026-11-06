/** D3DX animation (sets, controller with keyed events), skin info, ConvertToIndexedBlendedMesh and the frame hierarchy loader. */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { KomArchive, fileSource } from "@els/kom";
import type { XMeshData } from "@els/assets";
import {
  D3DXAnimationController, D3DXBuildMesh, D3DXCreateAnimationController, D3DXCreateKeyframedAnimationSet, D3DXCreateMeshFVF, D3DXCreateSkinInfoFVF, D3DXEVENT, D3DXFrameCalculateBoundingSphere, D3DXFrameDestroy, D3DXFrameFind,
  D3DXFrameNumNamedMatrices, D3DXFrameRegisterNamedMatrices, D3DXLoadMeshHierarchyFromXInMemory, D3DXMESH, D3DXMESHTYPE, D3DXPLAY, D3DXPRIORITY, D3DXTRANSITION, D3DXERR_INVALIDDATA, D3DERR_INVALIDCALL, E_FAIL, D3DDECLTYPE, D3DDECLUSAGE,
  composeSRT, declarationToFvf, fvfToElements, matIdentity, matMultiply, matRotationQuaternion, matRotationY, matTranslation, matDecompose, quatRotationMatrix, skinInfoFor,
} from "../src/index.ts";
import type { D3DXFrame, D3DXMeshContainer, ID3DXAllocateHierarchy, D3DXKeyVector3, D3DXKeyQuaternion } from "../src/index.ts";
import { gpuAvailable, newD3D9 } from "./gpu-helper.ts";

const HAVE_GPU = await gpuAvailable();
const gpuTest = HAVE_GPU ? test : test.skip;

const v3 = (t: number, x: number, y: number, z: number): D3DXKeyVector3 => ({ Time: t, Value: { x, y, z } });
const qk = (t: number, x: number, y: number, z: number, w: number): D3DXKeyQuaternion => ({ Time: t, Value: { x, y, z, w } });
const close = (a: number, b: number, tol = 1e-5): void => { expect(Math.abs(a - b)).toBeLessThanOrEqual(tol); };

/** a set with one animation "a" moving x from 0 to 10 in one second (4800 ticks/s) */
function setA(playback: number = D3DXPLAY.LOOP) {
  const s = D3DXCreateKeyframedAnimationSet("A", 4800, playback, 2).set!;
  s.RegisterAnimationSRTKeys("a", [], [], [v3(0, 0, 0, 0), v3(4800, 10, 0, 0)]);
  return s;
}
/** the same animation name, constant translation (0, 20, 0) */
function setB() {
  const s = D3DXCreateKeyframedAnimationSet("B", 4800, D3DXPLAY.LOOP, 1).set!;
  s.RegisterAnimationSRTKeys("a", [], [], [v3(0, 0, 20, 0), v3(4800, 0, 20, 0)]);
  return s;
}
function controllerWithOutput() {
  const ac = D3DXCreateAnimationController(4, 4, 2, 30).controller!;
  const mat = new Float32Array(16);
  expect(ac.RegisterAnimationOutput("a", mat, null, null, null)).toBe(0);
  return { ac, mat };
}

describe("D3DX keyframed animation set", () => {
  test("period, periodic position (loop / once / ping-pong), key sampling, defaults, registration rules", () => {
    const s = D3DXCreateKeyframedAnimationSet("walk", 4800, D3DXPLAY.LOOP, 2).set!;
    expect(s.RegisterAnimationSRTKeys("a", [], [], [v3(0, 0, 0, 0), v3(4800, 10, 0, 0)]).hr).toBe(0);
    const half = Math.SQRT1_2;
    s.RegisterAnimationSRTKeys("b", [v3(0, 1, 1, 1), v3(2400, 3, 3, 3)], [qk(0, 0, 0, 0, 1), qk(4800, 0, half, 0, half)], []);
    expect(s.GetPeriod()).toBe(1);
    expect(s.GetNumAnimations()).toBe(2);
    expect(s.GetAnimationIndexByName("b")).toEqual({ hr: 0, index: 1 });
    expect(s.GetAnimationIndexByName("zz").hr).toBeLessThan(0);
    expect(s.GetAnimationNameByIndex(0).name).toBe("a");
    expect(s.GetPeriodicPosition(1.25)).toBeCloseTo(0.25, 12);
    expect(s.GetPeriodicPosition(-0.25)).toBeCloseTo(0.75, 12);
    expect(s.GetPeriodicPosition(1)).toBeCloseTo(0, 12);
    const once = D3DXCreateKeyframedAnimationSet("o", 4800, D3DXPLAY.ONCE, 1).set!; once.RegisterAnimationSRTKeys("a", [], [], [v3(4800, 1, 1, 1)]);
    expect(once.GetPeriodicPosition(1.25)).toBe(1);
    expect(once.GetPeriodicPosition(-1)).toBe(0);
    const pp = D3DXCreateKeyframedAnimationSet("p", 4800, D3DXPLAY.PINGPONG, 1).set!; pp.RegisterAnimationSRTKeys("a", [], [], [v3(4800, 1, 1, 1)]);
    expect(pp.GetPeriodicPosition(1.25)).toBeCloseTo(0.75, 12);
    expect(pp.GetPeriodicPosition(2.25)).toBeCloseTo(0.25, 12);
    // translation lerp; defaults for the channels without keys
    const a = s.GetSRT(0.5, 0);
    expect(a.translation.x).toBeCloseTo(5, 5);
    expect(a.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(a.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    // scale reaches its last key at 0.5 s and stays; rotation slerps (half-way = 45 degrees about y)
    expect(s.GetSRT(0.25, 1).scale.x).toBeCloseTo(2, 5);
    expect(s.GetSRT(0.75, 1).scale.x).toBeCloseTo(3, 5);
    const r = s.GetSRT(0.5, 1).rotation;
    close(r.y, Math.sin(Math.PI / 8)); close(r.w, Math.cos(Math.PI / 8)); close(r.x, 0);
    // limits: only 2 animations, names are unique, a bad ticks value is rejected
    expect(s.RegisterAnimationSRTKeys("c", [], [], []).hr).toBeLessThan(0);
    expect(D3DXCreateKeyframedAnimationSet("x", 0, D3DXPLAY.LOOP, 1).hr).toBeLessThan(0);
    expect(D3DXCreateKeyframedAnimationSet("x", 30, D3DXPLAY.LOOP, 0).hr).toBeLessThan(0);
    const dup = D3DXCreateKeyframedAnimationSet("d", 30, D3DXPLAY.LOOP, 4).set!; dup.RegisterAnimationSRTKeys("a", [], [], []);
    expect(dup.RegisterAnimationSRTKeys("a", [], [], []).hr).toBeLessThan(0);
  });
});

describe("D3DX animation controller", () => {
  test("one track: position follows speed, the pose is S * R * T of the set at that position", () => {
    const { ac, mat } = controllerWithOutput();
    const s = setA();
    expect(ac.RegisterAnimationSet(s)).toBe(0);
    expect(ac.SetTrackAnimationSet(0, s)).toBe(0);
    ac.AdvanceTime(0.5);
    expect(mat[12]).toBe(0); // the track is not enabled yet
    expect(ac.SetTrackEnable(0, true)).toBe(0);
    ac.AdvanceTime(0.5);
    expect(ac.GetTrackDesc(0).desc!.Position).toBeCloseTo(0.5, 12);
    close(mat[12], 5);
    expect([mat[0], mat[5], mat[10], mat[15]]).toEqual([1, 1, 1, 1]);
    ac.SetTrackSpeed(0, 2);
    ac.AdvanceTime(0.125); // position 0.75
    close(mat[12], 7.5);
    ac.AdvanceTime(0.25); // 1.25 -> loops to 0.25
    close(mat[12], 2.5);
    expect(ac.GetTime()).toBeCloseTo(1.375, 12);
    expect(ac.AdvanceTime(-1)).toBeLessThan(0);
  });

  test("rotation keys are in the X-file convention: the matrix is built from their conjugate, the rotation output is the key itself", () => {
    const theta = 0.8, key = qk(0, 0, Math.sin(theta / 2), 0, Math.cos(theta / 2));
    const s = D3DXCreateKeyframedAnimationSet("R", 4800, D3DXPLAY.LOOP, 1).set!;
    s.RegisterAnimationSRTKeys("a", [], [key, qk(4800, 0, Math.sin(theta / 2), 0, Math.cos(theta / 2))], []);
    const ac = D3DXCreateAnimationController(1, 1, 1, 1).controller!;
    const mat = new Float32Array(16), rot = { x: 0, y: 0, z: 0, w: 1 };
    ac.RegisterAnimationOutput("a", mat, null, rot, null);
    ac.RegisterAnimationSet(s); ac.SetTrackAnimationSet(0, s); ac.SetTrackEnable(0, true);
    ac.AdvanceTime(0.25);
    const want = matRotationY(-theta); // D3DXMatrixRotationQuaternion(key) would be matRotationY(+theta)
    for (let i = 0; i < 16; i++) close(mat[i]!, want[i]!, 1e-6);
    close(rot.y, Math.sin(theta / 2), 1e-6); close(rot.w, Math.cos(theta / 2), 1e-6);
  });

  test("KeyTrackSpeed: the position is the integral of a linear / smoothstep ramp; the state ends at the target; small steps agree with one big step", () => {
    for (const [transition, expectedHalf] of [[D3DXTRANSITION.LINEAR, 0.125], [D3DXTRANSITION.EASEINEASEOUT, 0.09375]] as const) {
      const { ac } = controllerWithOutput();
      const s = setA(); ac.RegisterAnimationSet(s); ac.SetTrackAnimationSet(0, s); ac.SetTrackEnable(0, true);
      ac.SetTrackSpeed(0, 0);
      expect(ac.KeyTrackSpeed(0, 1, 0, 1, transition)).toBeGreaterThan(0);
      ac.AdvanceTime(0.5);
      close(ac.GetTrackDesc(0).desc!.Position, expectedHalf, 1e-6); // linear: int_0^.5 t = 0.125, smoothstep: 0.125 - 0.03125
      ac.AdvanceTime(0.5);
      close(ac.GetTrackDesc(0).desc!.Position, 0.5, 1e-6); // both ramps are symmetric: 1/2
      expect(ac.GetTrackDesc(0).desc!.Speed).toBe(1);
      ac.AdvanceTime(1);
      close(ac.GetTrackDesc(0).desc!.Position, 1.5, 1e-6);
      // ten small steps give the same position as one step
      const b = controllerWithOutput().ac;
      b.RegisterAnimationSet(s); b.SetTrackAnimationSet(0, s); b.SetTrackEnable(0, true); b.SetTrackSpeed(0, 0);
      b.KeyTrackSpeed(0, 1, 0, 1, transition);
      for (let i = 0; i < 10; i++) b.AdvanceTime(0.1);
      close(b.GetTrackDesc(0).desc!.Position, 0.5, 1e-6);
    }
  });

  test("two tracks cross-fade by weight events; the weighted sum is written to the output", () => {
    const { ac, mat } = controllerWithOutput();
    const a = setA(), b = setB();
    ac.RegisterAnimationSet(a); ac.RegisterAnimationSet(b);
    ac.SetTrackAnimationSet(0, a); ac.SetTrackAnimationSet(1, b);
    ac.SetTrackEnable(0, true); ac.SetTrackEnable(1, true);
    ac.SetTrackWeight(1, 0);
    ac.KeyTrackWeight(0, 0, 0, 1, D3DXTRANSITION.LINEAR);
    ac.KeyTrackWeight(1, 1, 0, 1, D3DXTRANSITION.LINEAR);
    ac.AdvanceTime(0);
    close(mat[12], 0); close(mat[13], 0); // track 0 still has weight 1 at t = 0, but position 0
    ac.AdvanceTime(0.5); // weights 0.5 / 0.5, both tracks at position 0.5: 0.5 * (5,0,0) + 0.5 * (0,20,0)
    close(ac.GetTrackDesc(0).desc!.Weight, 0.5); close(ac.GetTrackDesc(1).desc!.Weight, 0.5);
    close(mat[12], 2.5); close(mat[13], 10);
    ac.AdvanceTime(0.5); // track 0 weight 0, track 1 weight 1 (position 1.0 loops to 0)
    close(mat[12], 0); close(mat[13], 20);
    expect(ac.GetTrackDesc(0).desc!.Weight).toBe(0);
    expect(ac.GetTrackDesc(1).desc!.Weight).toBe(1);
  });

  test("the exact cross-fade the exe keys in CKTDGXSkinAnim::ChangeAnim(transition = true)", () => {
    const { ac, mat } = controllerWithOutput();
    const a = setA(), b = setB();
    ac.RegisterAnimationSet(a); ac.RegisterAnimationSet(b);
    // old animation on track 0, playing at speed 1 / weight 1
    ac.SetTrackAnimationSet(0, a); ac.SetTrackEnable(0, true); ac.SetTrackSpeed(0, 1); ac.SetTrackWeight(0, 1);
    ac.AdvanceTime(0.25);
    close(mat[12], 2.5);
    // ChangeAnim: transition time 0.2, play speed 2 -> the keys last 0.2 / 2 = 0.1 s
    const playSpeed = 2, d = 0.2 / playSpeed, start = 0.3;
    ac.ResetTime();
    ac.UnkeyAllTrackEvents(0); ac.UnkeyAllTrackEvents(1);
    expect(ac.KeyTrackEnable(0, false, d)).toBeGreaterThan(0);
    ac.KeyTrackSpeed(0, 0, 0, d, D3DXTRANSITION.LINEAR);
    ac.KeyTrackWeight(0, 0, 0, d, D3DXTRANSITION.LINEAR);
    ac.SetTrackAnimationSet(1, b); ac.SetTrackEnable(1, true); ac.SetTrackSpeed(1, 0); ac.SetTrackWeight(1, 0);
    ac.KeyTrackSpeed(1, playSpeed, 0, d, D3DXTRANSITION.LINEAR);
    ac.KeyTrackWeight(1, 1, 0, d, D3DXTRANSITION.LINEAR);
    ac.SetTrackPosition(1, start);
    ac.AdvanceTime(0); // the engine advances by 0 right after: the old pose is still fully visible
    expect(ac.GetTime()).toBe(0);
    expect(ac.GetTrackDesc(0).desc!.Weight).toBe(1);
    expect(ac.GetTrackDesc(1).desc!.Weight).toBe(0);
    close(mat[12], 2.5); close(mat[13], 0);
    ac.AdvanceTime(d / 2);
    close(ac.GetTrackDesc(0).desc!.Weight, 0.5); close(ac.GetTrackDesc(1).desc!.Weight, 0.5);
    close(ac.GetTrackDesc(1).desc!.Speed, playSpeed / 2);
    // new track position: start + int_0^{d/2} playSpeed * t / d dt = start + playSpeed * d / 8
    close(ac.GetTrackDesc(1).desc!.Position, start + playSpeed * d / 8);
    // old track: speed 1 -> 0 over d, position 0.25 + int (1 - t/d) = 0.25 + (d/2 - d/8)
    close(ac.GetTrackDesc(0).desc!.Position, 0.25 + d / 2 - d / 8);
    ac.AdvanceTime(d / 2);
    expect(ac.GetTrackDesc(0).desc!.Enable).toBe(false);
    expect(ac.GetTrackDesc(0).desc!.Weight).toBe(0);
    close(ac.GetTrackDesc(1).desc!.Weight, 1);
    close(ac.GetTrackDesc(1).desc!.Position, start + playSpeed * d / 2);
    close(mat[13], 20); close(mat[12], 0);
    expect(ac.GetCurrentTrackEvent(0, D3DXEVENT.TRACKSPEED)).toBe(0); // all events are over
  });

  test("enable and position events, UnkeyEvent, the event limit, ResetTime rebasing, priority groups, GetEventDesc", () => {
    const { ac, mat } = controllerWithOutput();
    const a = setA(), b = setB();
    ac.RegisterAnimationSet(a); ac.RegisterAnimationSet(b);
    ac.SetTrackAnimationSet(0, a); ac.SetTrackEnable(0, true);
    const h = ac.KeyTrackEnable(0, false, 0.5);
    expect(ac.GetEventDesc(h).desc).toMatchObject({ Type: D3DXEVENT.TRACKENABLE, Track: 0, StartTime: 0.5, Enable: false });
    ac.AdvanceTime(1);
    close(ac.GetTrackDesc(0).desc!.Position, 0.5); // stopped at the event
    expect(ac.GetTrackDesc(0).desc!.Enable).toBe(false);
    expect(ac.ValidateEvent(h)).toBeLessThan(0); // finished events are gone
    // a position event
    ac.SetTrackEnable(0, true);
    ac.KeyTrackPosition(0, 0.25, 1.5);
    ac.AdvanceTime(0.75); // time 1.75: at 1.5 the position jumps to 0.25, then 0.25 more
    close(ac.GetTrackDesc(0).desc!.Position, 0.5);
    // unkey
    const h2 = ac.KeyTrackEnable(0, false, 100);
    expect(ac.UnkeyEvent(h2)).toBe(0);
    expect(ac.UnkeyEvent(h2)).toBeLessThan(0);
    // 30 events max
    const hs: number[] = [];
    for (let i = 0; i < 30; i++) hs.push(ac.KeyTrackWeight(0, 1, 50 + i, 1, D3DXTRANSITION.LINEAR));
    expect(hs.every((x) => x > 0)).toBe(true);
    expect(ac.KeyTrackWeight(0, 1, 90, 1, D3DXTRANSITION.LINEAR)).toBe(0);
    ac.UnkeyAllTrackEvents(0);
    expect(ac.KeyTrackWeight(0, 1, 90, 1, D3DXTRANSITION.LINEAR)).toBeGreaterThan(0);
    expect(ac.KeyTrackSpeed(5, 1, 0, 1, 0)).toBe(0); // no such track
    // ResetTime keeps events at the same distance from "now"
    const c = D3DXCreateAnimationController(4, 4, 2, 30).controller!;
    const m2 = new Float32Array(16); c.RegisterAnimationOutput("a", m2, null, null, null);
    c.RegisterAnimationSet(a); c.SetTrackAnimationSet(0, a); c.SetTrackEnable(0, true);
    c.KeyTrackEnable(0, false, 2);
    c.AdvanceTime(1); c.ResetTime();
    expect(c.GetTime()).toBe(0);
    c.AdvanceTime(0.5); expect(c.GetTrackDesc(0).desc!.Enable).toBe(true);
    c.AdvanceTime(1); // the event (now at 1) fires at 1: position 1.0 (first second) + 0.5 + 0.5
    expect(c.GetTrackDesc(0).desc!.Enable).toBe(false);
    close(c.GetTrackDesc(0).desc!.Position, 2);
    // priority groups: LOW track a (x = 5 at 0.5), HIGH track b (y = 20); blend 0.25 -> 0.75 * low + 0.25 * high
    const d = D3DXCreateAnimationController(4, 4, 2, 30).controller!;
    const m3 = new Float32Array(16); d.RegisterAnimationOutput("a", m3, null, null, null);
    d.RegisterAnimationSet(a); d.RegisterAnimationSet(b);
    d.SetTrackAnimationSet(0, a); d.SetTrackAnimationSet(1, b); d.SetTrackEnable(0, true); d.SetTrackEnable(1, true);
    d.SetTrackPriority(1, D3DXPRIORITY.HIGH);
    d.SetPriorityBlend(0.25);
    d.AdvanceTime(0.5);
    close(m3[12], 0.75 * 5); close(m3[13], 0.25 * 20);
    expect(d.SetPriorityBlend(2)).toBeLessThan(0);
    void mat;
  });

  test("unknown outputs are ignored, separate S / R / T outputs, set registration, CloneAnimationController copies the state but not the outputs", () => {
    const s = D3DXCreateKeyframedAnimationSet("S", 4800, D3DXPLAY.LOOP, 2).set!;
    s.RegisterAnimationSRTKeys("a", [v3(0, 2, 2, 2)], [qk(0, 0, Math.SQRT1_2, 0, Math.SQRT1_2)], [v3(0, 1, 2, 3)]);
    s.RegisterAnimationSRTKeys("ghost", [], [], [v3(0, 9, 9, 9)]); // no frame of that name
    const ac = D3DXCreateAnimationController(4, 2, 2, 30).controller!;
    const mat = new Float32Array(16), scale = { x: 0, y: 0, z: 0 }, rot = { x: 0, y: 0, z: 0, w: 0 }, tr = { x: 0, y: 0, z: 0 };
    ac.RegisterAnimationOutput("a", mat, scale, rot, tr);
    expect(ac.RegisterAnimationOutput("", mat, null, null, null)).toBeLessThan(0);
    expect(ac.RegisterAnimationSet(s)).toBe(0);
    expect(ac.RegisterAnimationSet(s)).toBeLessThan(0); // already registered
    expect(ac.GetAnimationSetByName("S").set).toBe(s);
    ac.SetTrackAnimationSet(0, s); ac.SetTrackEnable(0, true);
    ac.AdvanceTime(0.1);
    expect(scale).toEqual({ x: 2, y: 2, z: 2 });
    close(rot.y, Math.SQRT1_2); close(rot.w, Math.SQRT1_2);
    expect(tr).toEqual({ x: 1, y: 2, z: 3 });
    const expected = composeSRT(scale, { x: -rot.x, y: -rot.y, z: -rot.z, w: rot.w }, tr); // the matrix is built from the conjugate of the key; the rotation output is the key
    expect(Array.from(mat).map((x) => +x.toFixed(5))).toEqual(Array.from(expected).map((x) => +x.toFixed(5)));
    // S * R * T for row vectors: the translation is the last row and is not scaled / rotated
    expect([mat[12], mat[13], mat[14]]).toEqual([1, 2, 3]);
    const cl = ac.CloneAnimationController(4, 2, 2, 30).controller!;
    expect(cl.GetNumAnimationSets()).toBe(1);
    expect(cl.GetTrackDesc(0).desc).toMatchObject({ Enable: true, Position: 0.1 });
    expect(cl.GetTime()).toBeCloseTo(0.1, 12);
    mat.fill(0);
    cl.AdvanceTime(0.1); // the clone has no outputs: the original's matrix is untouched
    expect(mat[15]).toBe(0);
    expect(ac.CloneAnimationController(4, 0, 2, 30).hr).toBeLessThan(0);
    expect(ac.UnregisterAnimationSet(s)).toBe(0);
    expect(ac.GetNumAnimationSets()).toBe(0);
    expect(ac.GetTrackAnimationSet(0).set).toBeNull();
    expect(D3DXCreateAnimationController(0, 1, 1, 1).hr).toBeLessThan(0);
    expect(D3DXAnimationController.name).toBe("D3DXAnimationController");
  });
});

describe("D3DX quaternion / matrix helpers behind the loader", () => {
  test("quatRotationMatrix inverts matRotationQuaternion; matDecompose splits S * R * T", () => {
    for (const q of [{ x: 0.1, y: 0.2, z: 0.3, w: 0.9 }, { x: 0.9, y: 0.1, z: 0.2, w: 0.1 }, { x: 0.1, y: 0.9, z: 0.1, w: 0.2 }, { x: 0.2, y: 0.1, z: 0.9, w: 0.1 }, { x: 1, y: 0, z: 0, w: 0 }]) {
      const n = Math.hypot(q.x, q.y, q.z, q.w), qn = { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
      const back = quatRotationMatrix(matRotationQuaternion(qn));
      const sign = Math.sign(back.w * qn.w + back.x * qn.x + back.y * qn.y + back.z * qn.z) || 1;
      close(back.x * sign, qn.x, 2e-6); close(back.y * sign, qn.y, 2e-6); close(back.z * sign, qn.z, 2e-6); close(back.w * sign, qn.w, 2e-6);
    }
    const m = composeSRT({ x: 2, y: 3, z: 4 }, { x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) }, { x: 5, y: 6, z: 7 });
    const d = matDecompose(m)!;
    close(d.scale.x, 2); close(d.scale.y, 3); close(d.scale.z, 4);
    expect(d.translation).toEqual({ x: 5, y: 6, z: 7 });
    close(d.rotation.y, Math.sin(0.4)); close(d.rotation.w, Math.cos(0.4));
    expect(matDecompose(matMultiply(matIdentity(), Float32Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])))).toBeNull(); // a zero scale cannot be decomposed
    expect(matDecompose(matMultiply(matRotationY(1), matTranslation(1, 2, 3)))!.translation).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("D3DXFrameFind", () => {
  const frame = (name: string | null): D3DXFrame => ({ Name: name, TransformationMatrix: matIdentity(), pMeshContainer: null, pFrameSibling: null, pFrameFirstChild: null });
  test("the sequence of Wine's native-checked test: siblings first, then the children of the first frame, then of the second ...", () => {
    const root = frame(null);
    expect(D3DXFrameFind(root, null)).toBe(root); // a null name finds the first unnamed frame
    root.Name = "n1";
    expect(D3DXFrameFind(root, null)).toBeNull();
    expect(D3DXFrameFind(root, "n1")).toBe(root);
    expect(D3DXFrameFind(root, "N1")).toBeNull(); // case sensitive
    expect(D3DXFrameFind(null, "x")).toBeNull();
    const sibling = frame("n2"), sibling2 = frame("n2");
    root.pFrameSibling = sibling;
    expect(D3DXFrameFind(root, "n2")).toBe(sibling);
    sibling.pFrameSibling = sibling2;
    expect(D3DXFrameFind(root, "n2")).toBe(sibling); // the first of two siblings with the same name
    sibling2.Name = "n3";
    expect(D3DXFrameFind(root, "n3")).toBe(sibling2);
    const child = frame("n2");
    root.pFrameFirstChild = child;
    expect(D3DXFrameFind(root, "n2")).toBe(sibling); // siblings first
    child.Name = "n4";
    expect(D3DXFrameFind(root, "n4")).toBe(child);
    const child2 = frame("n5"), child3 = frame("n5");
    sibling.pFrameFirstChild = child2; child.pFrameFirstChild = child3;
    expect(D3DXFrameFind(root, "n5")).toBe(child2); // the child of the second frame of the first level beats the grandchild below the first
    child3.Name = "n6";
    expect(D3DXFrameFind(root, "n6")).toBe(child3);
    expect(D3DXFrameFind(sibling, "n1")).toBeNull(); // the search starts at the frame it is given
  });
});

describe("D3DX skin info", () => {
  test("influences, bone names / offsets, max influences, Clone, Remap, software skinning", () => {
    const si = D3DXCreateSkinInfoFVF(3, 0x12, 2).skinInfo!; // XYZ | NORMAL
    expect(si.GetNumBones()).toBe(2);
    expect(si.SetBoneName(0, "b0")).toBe(0); si.SetBoneName(1, "b1");
    expect(si.GetBoneName(1)).toBe("b1");
    expect(si.SetBoneName(2, "x")).toBeLessThan(0);
    expect(si.SetBoneInfluence(0, [0, 2], [1, 0.5])).toBe(0);
    expect(si.SetBoneInfluence(1, [1, 2], [1, 0.5])).toBe(0);
    expect(si.SetBoneInfluence(1, [5], [1])).toBeLessThan(0); // vertex out of range
    expect(si.GetMaxVertexInfluences()).toBe(2);
    expect(si.GetNumBoneInfluences(0)).toBe(2);
    expect(si.GetBoneInfluence(1)!.weights[1]).toBeCloseTo(0.5, 6);
    expect(si.GetMaxFaceInfluences([0, 1, 2], 1)).toBe(2);
    expect(si.GetMaxFaceInfluences([0, 0, 0], 1)).toBe(1);
    // software skinning (as Wine's UpdateSkinnedMesh): bone 0 moves by (10,0,0), bone 1 by (0,10,0); the stored offset matrices are not applied
    si.SetBoneOffsetMatrix(0, matTranslation(100, 100, 100));
    const src = new Float32Array([0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 2, 2, 2, 0, 0, 1]); // 3 vertices of position + normal
    const dst = new Uint8Array(src.byteLength);
    const t0 = matTranslation(10, 0, 0), t1 = matTranslation(0, 10, 0);
    expect(si.UpdateSkinnedMesh([t0, t1], [matIdentity(), matIdentity()], new Uint8Array(src.buffer), dst)).toBe(0);
    const out = new Float32Array(dst.buffer);
    expect(Array.from(out.slice(0, 3))).toEqual([10, 0, 0]);
    expect(Array.from(out.slice(3, 6))).toEqual([0, 0, 1]); // normal through the identity inverse-transpose
    expect(Array.from(out.slice(6, 9))).toEqual([1, 11, 1]);
    expect(Array.from(out.slice(12, 15))).toEqual([2 + 5, 2 + 5, 2]); // weights 0.5 / 0.5
    // without inverse transposes the bone transforms transform the normals (a translation leaves them alone); a rotation by 90 degrees about z turns (1,0,0) into (0,1,0)
    const rz = Float32Array.from([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const dst2 = new Uint8Array(src.byteLength);
    si.UpdateSkinnedMesh([rz, rz], null, new Uint8Array(new Float32Array([1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer), dst2);
    expect(Array.from(new Float32Array(dst2.buffer).slice(0, 6))).toEqual([0, 1, 0, 0, 1, 0]);
    // a vertex that no bone influences is zeroed (positions and normals), the rest is copied
    const lone = D3DXCreateSkinInfoFVF(1, 0x112, 1).skinInfo!; // XYZ | NORMAL | TEX1
    const lsrc = new Float32Array([5, 6, 7, 0, 1, 0, 0.25, 0.75]), ldst = new Uint8Array(32);
    expect(lone.UpdateSkinnedMesh([matIdentity()], null, new Uint8Array(lsrc.buffer), ldst)).toBe(0);
    expect(Array.from(new Float32Array(ldst.buffer))).toEqual([0, 0, 0, 0, 0, 0, 0.25, 0.75]);
    const cl = si.Clone();
    cl.SetBoneName(0, "changed");
    expect(si.GetBoneName(0)).toBe("b0");
    cl.Remap(2, [1, 0, 7]); // vertex 0 -> 1, 1 -> 0, 2 dropped
    expect(Array.from(cl.GetBoneInfluence(0)!.vertices)).toEqual([1]);
    expect(si.SetBoneName(0, null)).toBeLessThan(0);
    expect(D3DXCreateSkinInfoFVF(3, 0, 1).hr).toBe(0); // FVF 0 = empty declaration
    expect(D3DXCreateSkinInfoFVF(3, 0x1 | 0x2, 1).hr).toBeLessThan(0); // reserved bit
    expect(D3DXCreateSkinInfoFVF(3, 0x00e, 1).hr).toBeLessThan(0); // XYZB5 without LASTBETA = 5 weights
  });

  test("declarationToFvf understands blend elements and texture coordinate sizes", () => {
    const el = (type: number, usage: number, usageIndex = 0) => ({ stream: 0, offset: 0, type, method: 0, usage, usageIndex });
    const fvf = declarationToFvf([el(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.POSITION), el(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.BLENDWEIGHT), el(D3DDECLTYPE.D3DCOLOR, D3DDECLUSAGE.BLENDINDICES), el(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.NORMAL), el(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.TEXCOORD)]);
    expect(fvf).toBe(0x800c | 0x10 | 0x100 | (1 << 16)); // XYZB4 | LASTBETA_D3DCOLOR | NORMAL | TEX1 with a 3-float set
    const ub = declarationToFvf([el(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.POSITION), el(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.BLENDWEIGHT), el(D3DDECLTYPE.UBYTE4, D3DDECLUSAGE.BLENDINDICES), el(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.NORMAL), el(D3DDECLTYPE.FLOAT2, D3DDECLUSAGE.TEXCOORD)]);
    expect(ub).toBe(4380); // the FVF the exe converts every skinned mesh to
    expect(fvfToElements(4380).elements.map((e) => e.usage)).toEqual([D3DDECLUSAGE.POSITION, D3DDECLUSAGE.BLENDWEIGHT, D3DDECLUSAGE.BLENDINDICES, D3DDECLUSAGE.NORMAL, D3DDECLUSAGE.TEXCOORD]);
    expect(declarationToFvf([el(D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.TANGENT)])).toBeNull();
  });
});

function skinnedXMesh(): XMeshData {
  // a strip of 4 quads (8 triangles, 10 vertices) along x; 4 bones, each vertex influenced by two neighbours -> a palette of 2 needs several combinations
  const positions: number[] = [];
  for (let i = 0; i <= 4; i++) positions.push(i, 0, 0, i, 1, 0);
  const faces: number[][] = [];
  for (let i = 0; i < 4; i++) { const a = i * 2; faces.push([a, a + 2, a + 1], [a + 1, a + 2, a + 3]); }
  const bones = [0, 1, 2, 3].map((b) => ({ name: `bone${b}`, vertexIndices: [] as number[], weights: [] as number[], offset: matIdentity() }));
  for (let i = 0; i <= 4; i++) for (const v of [i * 2, i * 2 + 1]) {
    const lo = Math.min(i, 3), hi = Math.min(i + 1, 3);
    if (lo === hi) { bones[lo]!.vertexIndices.push(v); bones[lo]!.weights.push(1); }
    else { bones[lo]!.vertexIndices.push(v); bones[lo]!.weights.push(0.75); bones[hi]!.vertexIndices.push(v); bones[hi]!.weights.push(0.25); }
  }
  return {
    name: "strip", positions: Float32Array.from(positions), faces, normals: Float32Array.of(0, 0, -1), normalFaces: faces.map(() => [0, 0, 0]), texCoords: Float32Array.from(positions.filter((_, k) => k % 3 !== 2)), vertexColors: null,
    faceMaterial: Uint32Array.from(faces.map((_, k) => (k < 4 ? 0 : 1))), materials: [0, 1].map(() => ({ diffuse: [1, 1, 1, 1] as [number, number, number, number], power: 0, specular: [0, 0, 0] as [number, number, number], emissive: [0, 0, 0] as [number, number, number], textureFilename: null })),
    skin: { maxWeightsPerVertex: 2, maxWeightsPerFace: 3, bones: bones.map((b) => ({ ...b, vertexIndices: Uint32Array.from(b.vertexIndices), weights: Float32Array.from(b.weights) })) }, duplicationIndices: null,
  };
}

describe("skinned meshes (need a WebGPU adapter for the buffers)", () => {
  gpuTest("ConvertToIndexedBlendedMesh: valid palette partition that reproduces every bone weight; FVF; attribute table = combinations; the exe's follow-up (clone to 4380, UpdateSemantics)", async () => {
    const dev = await newD3D9(4, 4);
    const data = skinnedXMesh();
    const built = D3DXBuildMesh([{ data, world: matIdentity() }], D3DXMESH.MANAGED, dev);
    const mesh = built.mesh!;
    const si = skinInfoFor(data, mesh, built.vertexOrigin)!;
    expect(si.GetNumBones()).toBe(4);
    expect(si.GetMaxVertexInfluences()).toBe(2);
    expect(si.GetMaxFaceInfluences(mesh.indices(), mesh.GetNumFaces())).toBe(3);
    // a palette of 2 cannot hold a face whose vertices use 3 bones
    // (face 0..: vertices of columns i and i+1 -> bones {i, i+1} and {i+1, i+2} at the column boundary)
    const tooSmall = si.ConvertToIndexedBlendedMesh(mesh, D3DXMESH.MANAGED, 2);
    expect(tooSmall.hr).toBeLessThan(0);
    const conv = si.ConvertToIndexedBlendedMesh(mesh, D3DXMESH.MANAGED, 3);
    expect(conv.hr).toBe(0);
    const out = conv.mesh!;
    expect(conv.maxVertexInfluences).toBe(2);
    expect(out.GetFVF()).toBe((0x008 | 0x1000 | 0x10 | 0x100) >>> 0); // XYZB2 | LASTBETA_UBYTE4 | NORMAL | TEX1
    expect(out.GetNumFaces()).toBe(8);
    expect(conv.boneCombinations.length).toBeGreaterThanOrEqual(2); // two materials, so at least two combinations
    // attribute table: one entry per combination, disjoint contiguous face and vertex ranges
    const table = out.GetAttributeTable();
    expect(table.length).toBe(conv.boneCombinations.length);
    let faces = 0, verts = 0;
    table.forEach((t, i) => {
      expect(t.AttribId).toBe(i);
      expect(t.FaceStart).toBe(faces); faces += t.FaceCount;
      expect(t.VertexStart).toBe(verts); verts += t.VertexCount;
      const bc = conv.boneCombinations[i]!;
      expect([bc.FaceStart, bc.FaceCount, bc.VertexStart, bc.VertexCount]).toEqual([t.FaceStart, t.FaceCount, t.VertexStart, t.VertexCount]);
      expect(bc.BoneId.length).toBe(3);
      const used = Array.from(bc.BoneId).filter((b) => b !== 0xffffffff);
      expect(new Set(used).size).toBe(used.length);
      // faces use only vertices of their own range
      const ix = out.indices();
      for (let k = t.FaceStart * 3; k < (t.FaceStart + t.FaceCount) * 3; k++) { expect(ix[k]!).toBeGreaterThanOrEqual(t.VertexStart); expect(ix[k]!).toBeLessThan(t.VertexStart + t.VertexCount); }
    });
    expect(faces).toBe(8); expect(verts).toBe(out.GetNumVertices());
    // every output vertex reproduces the bone weights of the vertex it came from, through its combination's palette
    const el = fvfToElements(out.GetFVF()).elements, wEl = el.find((e) => e.usage === D3DDECLUSAGE.BLENDWEIGHT)!, iEl = el.find((e) => e.usage === D3DDECLUSAGE.BLENDINDICES)!;
    const st = out.GetNumBytesPerVertex(), dv = new DataView(out.vb.cpu.buffer, out.vb.cpu.byteOffset, out.vb.cpu.byteLength);
    const sdv = new DataView(mesh.vb.cpu.buffer, mesh.vb.cpu.byteOffset, mesh.vb.cpu.byteLength);
    const srcInfl = (v: number): Map<number, number> => { const m = new Map<number, number>(); for (let b = 0; b < 4; b++) { const inf = si.GetBoneInfluence(b)!; inf.vertices.forEach((x, k) => { if (x === v) m.set(b, inf.weights[k]!); }); } return m; };
    conv.boneCombinations.forEach((bc) => {
      for (let nv = bc.VertexStart; nv < bc.VertexStart + bc.VertexCount; nv++) {
        const old = conv.vertexRemap![nv]!;
        const w0 = dv.getFloat32(nv * st + wEl.offset, true), w1 = 1 - w0;
        const slots = [out.vb.cpu[nv * st + iEl.offset]!, out.vb.cpu[nv * st + iEl.offset + 1]!];
        const got = new Map<number, number>();
        got.set(bc.BoneId[slots[0]!]!, w0);
        if (w1 > 1e-6) got.set(bc.BoneId[slots[1]!]!, w1);
        const want = srcInfl(old);
        expect(new Set(got.keys())).toEqual(new Set(want.keys()));
        for (const [b, w] of want) close(got.get(b)!, w, 1e-6);
        // positions came along
        for (let c = 0; c < 3; c++) expect(dv.getFloat32(nv * st + 4 * c, true)).toBe(sdv.getFloat32(old * mesh.GetNumBytesPerVertex() + 4 * c, true));
      }
    });
    // what the exe does next: clone to FVF 4380 (zero weights are filled in by the exe itself) and rewrite BLENDINDICES as D3DCOLOR
    const c4380 = out.CloneMeshFVF(D3DXMESH.MANAGED, 4380, dev).mesh!;
    expect(c4380.GetNumBytesPerVertex()).toBe(48);
    expect(Array.from(c4380.indices())).toEqual(Array.from(out.indices()));
    expect(c4380.GetAttributeTable().length).toBe(table.length);
    const decl = c4380.GetDeclaration().map((e) => (e.usage === D3DDECLUSAGE.BLENDINDICES && e.usageIndex === 0 ? { ...e, type: D3DDECLTYPE.D3DCOLOR } : e));
    expect(c4380.UpdateSemantics(decl)).toBe(0);
    expect(c4380.GetFVF()).toBe((0x00c | 0x8000 | 0x10 | 0x100) >>> 0);
    expect(c4380.UpdateSemantics(decl.slice(1))).toBeLessThan(0); // a declaration with other offsets is refused
  });

  gpuTest("a split vertex (second normal) inherits the influences of the vertex it was split from", async () => {
    const dev = await newD3D9(4, 4);
    const m: XMeshData = {
      name: "m", positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0), faces: [[0, 1, 2], [1, 3, 2]], normals: Float32Array.of(0, 0, -1, 0, 1, 0), normalFaces: [[0, 0, 0], [1, 1, 1]],
      texCoords: new Float32Array(8), vertexColors: null, faceMaterial: new Uint32Array(2), materials: [], duplicationIndices: null,
      skin: { maxWeightsPerVertex: 1, maxWeightsPerFace: 2, bones: [{ name: "a", vertexIndices: Uint32Array.of(0, 1), weights: Float32Array.of(1, 1), offset: matIdentity() }, { name: "b", vertexIndices: Uint32Array.of(2, 3), weights: Float32Array.of(1, 1), offset: matIdentity() }] },
    };
    const built = D3DXBuildMesh([{ data: m, world: matIdentity() }], D3DXMESH.MANAGED, dev);
    expect(built.mesh!.GetNumVertices()).toBe(6); // vertices 1 and 2 are split (face 1 uses the second normal)
    expect(Array.from(built.vertexOrigin)).toEqual([0, 1, 2, 3, 1, 2]);
    const si = skinInfoFor(m, built.mesh!, built.vertexOrigin)!;
    expect(Array.from(si.GetBoneInfluence(0)!.vertices).sort()).toEqual([0, 1, 4]); // bone a: vertex 0, 1 and the copy of 1
    expect(Array.from(si.GetBoneInfluence(1)!.vertices).sort()).toEqual([2, 3, 5]);
    expect(si.numVertices).toBe(6);
    void D3DXCreateMeshFVF;
  });

  gpuTest("D3DXLoadMeshHierarchyFromXInMemory on LENA_SI_A_LE_BACKJUMP_SHOT01.X: frames, mesh container + skin info, controller; the pose at t = 0 is the rest pose (this fixes the quaternion convention)", async () => {
    if (!existsSync("data/data121.kom")) return;
    const kom = await KomArchive.open(fileSource("data/data121.kom"));
    const bytes = await kom.read(kom.entries.find((e) => e.name.toUpperCase() === "LENA_SI_A_LE_BACKJUMP_SHOT01.X")!);
    const dev = await newD3D9(4, 4);
    const created: string[] = [], destroyed: string[] = [];
    const alloc: ID3DXAllocateHierarchy = {
      CreateFrame: (n) => { created.push(`f:${n}`); return { hr: 0, frame: { Name: n, TransformationMatrix: matIdentity(), pMeshContainer: null, pFrameSibling: null, pFrameFirstChild: null } }; },
      CreateMeshContainer: (n, md, mats, eff, nm, adj, skin) => { created.push(`m:${n}`); return { hr: 0, container: { Name: n, MeshData: md, pMaterials: mats, pEffects: null, NumMaterials: nm, pAdjacency: adj, pSkinInfo: skin, pNextMeshContainer: null } as D3DXMeshContainer }; },
      DestroyFrame: (f) => { destroyed.push(`f:${f.Name}`); return 0; },
      DestroyMeshContainer: (c) => { destroyed.push(`m:${c.Name}`); return 0; },
    };
    const r = D3DXLoadMeshHierarchyFromXInMemory(bytes, D3DXMESH.MANAGED, dev, alloc);
    expect(r.hr).toBe(0);
    const root = r.frameRoot!;
    expect(root.Name).toBe("Scene_Root");
    expect(D3DXFrameNumNamedMatrices(root)).toBe(7);
    const plane = D3DXFrameFind(root, "Plane01")!;
    expect(plane.pMeshContainer).not.toBeNull();
    const mc = plane.pMeshContainer!;
    expect(mc.MeshData.Type).toBe(D3DXMESHTYPE.MESH);
    expect(mc.MeshData.pMesh!.GetNumVertices()).toBe(23);
    expect(mc.MeshData.pMesh!.GetNumFaces()).toBe(21);
    expect(mc.MeshData.pMesh!.GetFVF()).toBe(274);
    expect(mc.pAdjacency!.length).toBe(63);
    expect(mc.pSkinInfo!.GetFVF()).toBe(mc.MeshData.pMesh!.GetFVF()); // the exe checks this
    expect(mc.pSkinInfo!.GetNumBones()).toBe(2);
    const names = [0, 1].map((i) => mc.pSkinInfo!.GetBoneName(i)!);
    expect(names).toEqual(["Bip01", "Bip03"]);
    for (const n of names) expect(D3DXFrameFind(root, n)).not.toBeNull();
    expect(mc.pSkinInfo!.GetBoneOffsetMatrix(0)!.length).toBe(16);
    expect(created.filter((x) => x.startsWith("f:")).length).toBe(7);
    const sphere = D3DXFrameCalculateBoundingSphere(root);
    expect(sphere.radius).toBeGreaterThan(0);
    // controller: 2 tracks, 30 events, the file's one set, outputs = the named frames
    const ac = r.animController!;
    expect([ac.GetMaxNumTracks(), ac.GetMaxNumEvents(), ac.GetNumAnimationSets()]).toEqual([2, 30, 1]);
    const set = ac.GetAnimationSet(0).set!;
    expect(set.GetName()).toBe("Normal");
    expect(set.GetNumAnimations()).toBe(7);
    close(set.GetPeriod(), 0.36666667, 1e-6); // 1760 ticks at 4800 per second
    const rest = new Map<string, Float32Array>();
    for (const n of ["Scene_Root", "Particle_View_01", "Plane01", "Bip01", "Bip02", "Bip03", "Dummy01"]) rest.set(n, D3DXFrameFind(root, n)!.TransformationMatrix.slice());
    ac.SetTrackAnimationSet(0, set); ac.SetTrackEnable(0, true);
    ac.AdvanceTime(0);
    for (const [n, m] of rest) {
      const now = D3DXFrameFind(root, n)!.TransformationMatrix;
      const diff = Math.max(...Array.from(now, (v, i) => Math.abs(v - m[i]!)));
      expect(diff).toBeLessThan(2e-4); // key 0 of every animation equals the frame's rest matrix (conjugated X quaternion, decomposed matrix keys)
    }
    ac.AdvanceTime(0.2); // later in the animation at least one frame moved
    let moved = 0;
    for (const [n, m] of rest) if (Math.max(...Array.from(D3DXFrameFind(root, n)!.TransformationMatrix, (v, i) => Math.abs(v - m[i]!))) > 1e-3) moved++;
    expect(moved).toBeGreaterThan(0);
    // a second hierarchy can share the controller's sets through CloneAnimationController + its own registration
    const clone = ac.CloneAnimationController(7, 1, 2, 30).controller!;
    expect(D3DXFrameRegisterNamedMatrices(root, clone)).toBe(0);
    // the tree goes back through the allocator
    expect(D3DXFrameDestroy(root, alloc)).toBe(0);
    expect(destroyed.filter((x) => x.startsWith("f:")).length).toBe(7);
    expect(destroyed).toContain("m:"); // the Mesh block has no name: the container gets the empty string
    expect(D3DXLoadMeshHierarchyFromXInMemory(new Uint8Array(32), D3DXMESH.MANAGED, dev, alloc).hr).toBe(D3DXERR_INVALIDDATA);
    expect(D3DXLoadMeshHierarchyFromXInMemory(new Uint8Array(0), D3DXMESH.MANAGED, dev, alloc).hr).toBe(D3DERR_INVALIDCALL);
    expect(D3DXLoadMeshHierarchyFromXInMemory(bytes, D3DXMESH.MANAGED, null, alloc).hr).toBe(D3DERR_INVALIDCALL);
    expect(D3DXLoadMeshHierarchyFromXInMemory(bytes, D3DXMESH.MANAGED, dev, null).hr).toBe(D3DERR_INVALIDCALL);
  });
});
