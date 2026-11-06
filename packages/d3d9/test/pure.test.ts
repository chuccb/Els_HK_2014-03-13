/** The parts of the layer that need no GPU: D3DX math, FVF/declaration tables, generated enums. */
import { describe, expect, test } from "bun:test";
import {
  D3DFVF, D3DDECLTYPE, D3DDECLUSAGE, buildLayouts, fvfToElements, fvfVertexSize, matInverse, matLookAtLH, matMultiply, matOrthoLH, matPerspectiveFovLH, matRotationAxis,
  matRotationX, matRotationY, matRotationYawPitchRoll, matRotationZ, matScaling, matTransformation2D, matTranslation, matTranspose, matIdentity, planeFromPointNormal,
  planeIntersectLine, planeNormalize, quatMultiply, quatNormalize, quatRotationYawPitchRoll, quatSlerp, vec2Normalize, vec2Transform, vec3CatmullRom, vec3Cross,
  vec3Normalize, vec3Project, vec3Transform, vec3TransformCoord, vec3TransformNormal, vec4Normalize, matRotationQuaternion,
} from "../src/index.ts";

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5): boolean => a.length === b.length && Array.from(a).every((v, i) => Math.abs(v - b[i]!) <= eps);
const M = (...v: number[]): Float32Array => new Float32Array(v);

describe("D3DX matrices (row-vector convention, left-handed)", () => {
  test("LookAtLH, PerspectiveFovLH, OrthoLH against the documented layouts", () => {
    expect(close(matLookAtLH({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), M(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1))).toBe(true);
    // eye (1,2,3) looking at the origin from above: zaxis = normalize(-eye), xaxis = normalize(up x z), yaxis = z x x
    const eye = { x: 1, y: 2, z: 3 };
    const m = matLookAtLH(eye, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const z = vec3Normalize({ x: -1, y: -2, z: -3 });
    const x = vec3Normalize(vec3Cross({ x: 0, y: 1, z: 0 }, z));
    const y = vec3Cross(z, x);
    const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(close(m, M(x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1), 1e-5)).toBe(true);
    const fov = Math.PI / 3, aspect = 4 / 3, zn = 0.5, zf = 100;
    const ys = 1 / Math.tan(fov / 2), xs = ys / aspect;
    expect(close(matPerspectiveFovLH(fov, aspect, zn, zf), M(xs, 0, 0, 0, 0, ys, 0, 0, 0, 0, zf / (zf - zn), 1, 0, 0, (-zn * zf) / (zf - zn), 0), 1e-5)).toBe(true);
    expect(close(matOrthoLH(8, 6, 1, 11), M(0.25, 0, 0, 0, 0, 1 / 3, 0, 0, 0, 0, 0.1, 0, 0, 0, -0.1, 1))).toBe(true);
  });

  test("rotations: X, Y, Z, axis, yaw-pitch-roll, quaternion", () => {
    const a = 0.7, c = Math.cos(a), s = Math.sin(a);
    expect(close(matRotationX(a), M(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1))).toBe(true);
    expect(close(matRotationY(a), M(c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1))).toBe(true);
    expect(close(matRotationZ(a), M(c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1))).toBe(true);
    expect(close(matRotationAxis({ x: 0, y: 0, z: 2 }, a), matRotationZ(a))).toBe(true);
    expect(close(matRotationAxis({ x: 1, y: 0, z: 0 }, a), matRotationX(a))).toBe(true);
    // a general axis, by Rodrigues' formula for row vectors
    const ax = vec3Normalize({ x: 1, y: 2, z: 2 });
    const t = 1 - c;
    expect(close(matRotationAxis({ x: 1, y: 2, z: 2 }, a), M(
      c + ax.x * ax.x * t, ax.x * ax.y * t + ax.z * s, ax.x * ax.z * t - ax.y * s, 0,
      ax.x * ax.y * t - ax.z * s, c + ax.y * ax.y * t, ax.y * ax.z * t + ax.x * s, 0,
      ax.x * ax.z * t + ax.y * s, ax.y * ax.z * t - ax.x * s, c + ax.z * ax.z * t, 0,
      0, 0, 0, 1,
    ), 1e-5)).toBe(true);
    // yaw (Y), pitch (X), roll (Z): roll first, then pitch, then yaw
    expect(close(matRotationYawPitchRoll(0.3, 0.2, 0.1), matMultiply(matMultiply(matRotationZ(0.1), matRotationX(0.2)), matRotationY(0.3)), 1e-5)).toBe(true);
    expect(close(matRotationQuaternion(quatRotationYawPitchRoll(0.3, 0.2, 0.1)), matRotationYawPitchRoll(0.3, 0.2, 0.1), 1e-5)).toBe(true);
  });

  test("multiply, transpose, inverse, translation, scaling", () => {
    const a = matMultiply(matRotationYawPitchRoll(0.4, 0.5, 0.6), matTranslation(1, -2, 3));
    const b = matMultiply(matScaling(2, 3, 4), a);
    const inv = matInverse(b)!;
    expect(close(matMultiply(b, inv.matrix), matIdentity(), 1e-5)).toBe(true);
    expect(inv.determinant).toBeCloseTo(24, 4);
    expect(matInverse(matScaling(1, 0, 1))).toBeNull();
    expect(close(matTranspose(matTranspose(b)), b)).toBe(true);
    // translation sits in row 4 (_41.._43): v * T
    expect(vec3TransformCoord({ x: 1, y: 1, z: 1 }, matTranslation(5, 6, 7))).toEqual({ x: 6, y: 7, z: 8 });
    expect(vec3TransformNormal({ x: 1, y: 1, z: 1 }, matTranslation(5, 6, 7))).toEqual({ x: 1, y: 1, z: 1 });
    // multiply order: (v * A) * B == v * (A * B)
    const v = { x: 0.3, y: -0.4, z: 0.9 };
    const lhs = vec3TransformCoord(vec3TransformCoord(v, a), matScaling(2, 3, 4));
    const rhs = vec3TransformCoord(v, matMultiply(a, matScaling(2, 3, 4)));
    expect(close([lhs.x, lhs.y, lhs.z], [rhs.x, rhs.y, rhs.z], 1e-5)).toBe(true);
  });

  test("Transformation2D = Msc^-1 Msr^-1 Ms Msr Msc Mrc^-1 Mr Mrc Mt", () => {
    const sc = { x: 3, y: 4 }, sr = 0.3, s = { x: 2, y: 0.5 }, rc = { x: -1, y: 2 }, r = 0.8, t = { x: 5, y: -6 };
    const got = matTransformation2D(sc, sr, s, rc, r, t);
    const T = (p: { x: number; y: number }): Float32Array => matTranslation(p.x, p.y, 0);
    const Ti = (p: { x: number; y: number }): Float32Array => matTranslation(-p.x, -p.y, 0);
    let want = Ti(sc);
    for (const m of [matRotationZ(-sr), matScaling(s.x, s.y, 1), matRotationZ(sr), T(sc), Ti(rc), matRotationZ(r), T(rc), T(t)]) want = matMultiply(want, m);
    expect(close(got, want, 1e-4)).toBe(true);
    // null arguments are identities
    expect(close(matTransformation2D(null, 0, null, null, 0, { x: 1, y: 2 }), matTranslation(1, 2, 0))).toBe(true);
    expect(close(matTransformation2D({ x: 1, y: 1 }, 0, { x: 2, y: 2 }, null, 0, null), M(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, -1, -1, 0, 1))).toBe(true);
  });
});

describe("D3DX vectors, planes, quaternions", () => {
  test("vector helpers", () => {
    expect(vec3Normalize({ x: 3, y: 0, z: 4 })).toEqual({ x: 0.6000000238418579, y: 0, z: 0.800000011920929 });
    expect(vec3Normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(vec2Normalize({ x: 0, y: -2 })).toEqual({ x: 0, y: -1 });
    expect(vec4Normalize({ x: 0, y: 3, z: 0, w: 4 })).toEqual({ x: 0, y: 0.6000000238418579, z: 0, w: 0.800000011920929 });
    // Vec2Transform: (x, y, 0, 1) * M
    expect(vec2Transform({ x: 1, y: 2 }, matTranslation(10, 20, 30))).toEqual({ x: 11, y: 22, z: 30, w: 1 });
    expect(vec3Transform({ x: 1, y: 2, z: 3 }, matScaling(2, 2, 2))).toEqual({ x: 2, y: 4, z: 6, w: 1 });
    // CatmullRom: s=0 -> v1, s=1 -> v2, and the documented polynomial in between
    const v0 = { x: 0, y: 0, z: 0 }, v1 = { x: 1, y: 2, z: 3 }, v2 = { x: 4, y: 3, z: 1 }, v3 = { x: 6, y: 9, z: 2 };
    expect(vec3CatmullRom(v0, v1, v2, v3, 0)).toEqual(v1);
    expect(vec3CatmullRom(v0, v1, v2, v3, 1)).toEqual(v2);
    const s = 0.3;
    const poly = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s * s + (-a + 3 * b - 3 * c + d) * s * s * s);
    const cr = vec3CatmullRom(v0, v1, v2, v3, s);
    expect(close([cr.x, cr.y, cr.z], [poly(0, 1, 4, 6), poly(0, 2, 3, 9), poly(0, 3, 1, 2)], 1e-5)).toBe(true);
    // Project: NDC (0,0) is the viewport centre, +y is up
    const vp = { x: 10, y: 20, width: 200, height: 100, minZ: 0.25, maxZ: 0.75 };
    expect(vec3Project({ x: 0, y: 0, z: 0.5 }, vp, null, null, null)).toEqual({ x: 110, y: 70, z: 0.5 });
    expect(vec3Project({ x: 1, y: 1, z: 1 }, vp, null, null, null)).toEqual({ x: 210, y: 20, z: 0.75 });
  });

  test("planes", () => {
    const p = planeFromPointNormal({ x: 0, y: 2, z: 0 }, { x: 0, y: 3, z: 0 });
    expect(p).toEqual({ a: 0, b: 3, c: 0, d: -6 });
    expect(planeNormalize(p)).toEqual({ a: 0, b: 1, c: 0, d: -2 });
    expect(planeIntersectLine(planeNormalize(p), { x: 1, y: 0, z: 0 }, { x: 1, y: 4, z: 2 })).toEqual({ x: 1, y: 2, z: 1 });
    expect(planeIntersectLine(planeNormalize(p), { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull(); // parallel
  });

  test("quaternions", () => {
    const id = { x: 0, y: 0, z: 0, w: 1 };
    const qy = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
    const near = (a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }): boolean => close([a.x, a.y, a.z, a.w], [b.x, b.y, b.z, b.w], 1e-6);
    expect(near(quatSlerp(id, qy(Math.PI / 2), 0), id)).toBe(true);
    expect(near(quatSlerp(id, qy(Math.PI / 2), 1), qy(Math.PI / 2))).toBe(true);
    expect(near(quatSlerp(id, qy(Math.PI / 2), 0.5), qy(Math.PI / 4))).toBe(true);
    // shortest path: -q is the same rotation, slerp must not go the long way round
    const neg = { x: -0, y: -qy(0.5).y, z: -0, w: -qy(0.5).w };
    expect(near(quatSlerp(id, neg, 0.5), qy(0.25)) || near(quatSlerp(id, neg, 0.5), { x: 0, y: -qy(0.25).y, z: 0, w: -qy(0.25).w })).toBe(true);
    // D3DXQuaternionMultiply(q1, q2) composes like matrix multiplication of row-vector matrices: q1 first, then q2.  Its component formulas
    // are those of the Hamilton product q2 * q1.
    const a = quatRotationYawPitchRoll(0.3, 0, 0), b = quatRotationYawPitchRoll(0, 0.4, 0);
    const prod = quatMultiply(a, b);
    const e = { x: b.w * a.x + b.x * a.w + b.y * a.z - b.z * a.y, y: b.w * a.y - b.x * a.z + b.y * a.w + b.z * a.x, z: b.w * a.z + b.x * a.y - b.y * a.x + b.z * a.w, w: b.w * a.w - b.x * a.x - b.y * a.y - b.z * a.z };
    expect(near(prod, e)).toBe(true);
    expect(close(matRotationQuaternion(prod), matMultiply(matRotationQuaternion(a), matRotationQuaternion(b)), 1e-6)).toBe(true);
    expect(near(quatNormalize({ x: 0, y: 0, z: 0, w: 2 }), id)).toBe(true);
    // yaw/pitch/roll formula
    const y = 0.3, p = 0.2, r = 0.1;
    const q = quatRotationYawPitchRoll(y, p, r);
    const [sy, cy, sp, cp, sr, cr] = [Math.sin(y / 2), Math.cos(y / 2), Math.sin(p / 2), Math.cos(p / 2), Math.sin(r / 2), Math.cos(r / 2)];
    expect(near(q, { x: sp * cy * cr + cp * sy * sr, y: cp * sy * cr - sp * cy * sr, z: cp * cy * sr - sp * sy * cr, w: cp * cy * cr + sp * sy * sr })).toBe(true);
  });
});

describe("vertex formats", () => {
  test("FVF sizes (the four dynamic vertex-buffer formats of CKTDGDynamicVBManager and others)", () => {
    expect(fvfVertexSize(66)).toBe(16); // XYZ | DIFFUSE
    expect(fvfVertexSize(322)).toBe(24); // XYZ | DIFFUSE | TEX1
    expect(fvfVertexSize(258)).toBe(20); // XYZ | TEX1
    expect(fvfVertexSize(324)).toBe(28); // XYZRHW | DIFFUSE | TEX1
    expect(fvfVertexSize(D3DFVF.XYZ | D3DFVF.NORMAL | D3DFVF.DIFFUSE | D3DFVF.SPECULAR | D3DFVF.TEX2)).toBe(12 + 12 + 4 + 4 + 16);
    expect(fvfVertexSize(D3DFVF.XYZB3 | D3DFVF.LASTBETA_UBYTE4 | D3DFVF.NORMAL | D3DFVF.TEX1)).toBe(12 + 12 + 12 + 8); // the last beta is a DWORD (UBYTE4 indices) but still 4 bytes
  });

  test("FVF -> element list: offsets, types, semantics", () => {
    const { elements, stride } = fvfToElements(322);
    expect(stride).toBe(24);
    expect(elements.map((e) => [e.offset, e.type, e.usage, e.usageIndex])).toEqual([
      [0, D3DDECLTYPE.FLOAT3, D3DDECLUSAGE.POSITION, 0],
      [12, D3DDECLTYPE.D3DCOLOR, D3DDECLUSAGE.COLOR, 0],
      [16, D3DDECLTYPE.FLOAT2, D3DDECLUSAGE.TEXCOORD, 0],
    ]);
    const rhw = fvfToElements(324).elements;
    expect(rhw[0]).toMatchObject({ type: D3DDECLTYPE.FLOAT4, usage: D3DDECLUSAGE.POSITIONT });
  });

  test("layouts bind attributes to semantic locations and drop elements nothing reads", () => {
    const { elements } = fvfToElements(322);
    const layouts = buildLayouts(elements, new Map([[0, 24]]));
    expect(layouts.length).toBe(1);
    expect(layouts[0]!.stride).toBe(24);
    expect(layouts[0]!.attributes.map((a) => [a.location, a.format, a.bgra])).toEqual([[0, "float32x3", false], [5, "unorm8x4", true], [7, "float32x2", false]]);
  });
});

describe("generated tables", () => {
  test("enums.generated.ts is up to date with data/x2.exe.h", () => {
    const r = Bun.spawnSync([process.execPath, "run", "tools/gen-d3d9-enums.ts", "--check"], { cwd: new URL("../../..", import.meta.url).pathname });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  });
});
