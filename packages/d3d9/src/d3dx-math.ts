/**
 * The D3DX9 math functions x2.exe imports from d3dx9_43.dll (see docs/FINDINGS.md §12 for the census; the exe does not use any
 * other D3DX math function).  Conventions are D3DX's: row vectors, row-major `D3DXMATRIX` (`m[row * 4 + col]`, i.e. `_11, _12,
 * _13, _14, _21, ...`), left-handed coordinates, `v' = v * M`.  Results are stored in float32 like the originals; intermediate
 * sums use doubles, so a result may differ from the SSE implementation in the last bit.
 *
 * Imported by the exe (x2.exe.c, "D3DX" prototypes): D3DXMatrixInverse/LookAtLH/Multiply/OrthoLH/PerspectiveFovLH/RotationAxis/
 * RotationY/RotationYawPitchRoll/Scaling/Transformation2D/Translation, D3DXPlaneFromPointNormal/IntersectLine/Normalize,
 * D3DXQuaternionMultiply/Normalize/Slerp, D3DXVec2Normalize/Transform, D3DXVec3CatmullRom/Normalize/Project/Transform/
 * TransformCoord/TransformNormal, D3DXVec4Normalize.
 */

export type Mat4 = Float32Array;
export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Vec4 { x: number; y: number; z: number; w: number }
export interface Quat { x: number; y: number; z: number; w: number }
/** `D3DXPLANE`: ax + by + cz + d = 0. */
export interface Plane { a: number; b: number; c: number; d: number }
export interface Viewport { x: number; y: number; width: number; height: number; minZ: number; maxZ: number }

const f = Math.fround;

export const matIdentity = (): Mat4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** `D3DXMatrixMultiply(out, a, b)` = a * b (a is applied first). */
export function matMultiply(a: ArrayLike<number>, b: ArrayLike<number>, out: Mat4 = new Float32Array(16)): Mat4 {
  const r = new Float64Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      r[i * 4 + j] = a[i * 4]! * b[j]! + a[i * 4 + 1]! * b[4 + j]! + a[i * 4 + 2]! * b[8 + j]! + a[i * 4 + 3]! * b[12 + j]!;
    }
  }
  out.set(r);
  return out;
}

export function matTranspose(m: ArrayLike<number>, out: Mat4 = new Float32Array(16)): Mat4 {
  const r = new Float64Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) r[i * 4 + j] = m[j * 4 + i]!;
  out.set(r);
  return out;
}

export function matTranslation(x: number, y: number, z: number): Mat4 {
  const m = matIdentity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function matScaling(x: number, y: number, z: number): Mat4 {
  const m = matIdentity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

/** `D3DXMatrixRotationY`: _11 = cos, _13 = -sin, _31 = sin, _33 = cos. */
export function matRotationY(angle: number): Mat4 {
  const m = matIdentity();
  const s = Math.sin(f(angle)), c = Math.cos(f(angle));
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}
export function matRotationX(angle: number): Mat4 {
  const m = matIdentity();
  const s = Math.sin(f(angle)), c = Math.cos(f(angle));
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}
export function matRotationZ(angle: number): Mat4 {
  const m = matIdentity();
  const s = Math.sin(f(angle)), c = Math.cos(f(angle));
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

/** `D3DXMatrixRotationAxis`: rotation about the (normalised) axis, left-handed, row vectors. */
export function matRotationAxis(axis: Vec3, angle: number): Mat4 {
  const n = vec3Normalize(axis);
  const s = Math.sin(f(angle)), c = Math.cos(f(angle)), t = 1 - c;
  const { x, y, z } = n;
  const m = matIdentity();
  m[0] = t * x * x + c;     m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
  m[4] = t * x * y - s * z; m[5] = t * y * y + c;     m[6] = t * y * z + s * x;
  m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
  return m;
}

/** `D3DXMatrixRotationQuaternion`. */
export function matRotationQuaternion(q: Quat): Mat4 {
  const { x, y, z, w } = q;
  const m = matIdentity();
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w);     m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w);     m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w);     m[9] = 2 * (y * z - x * w);     m[10] = 1 - 2 * (x * x + y * y);
  return m;
}

/** `D3DXQuaternionRotationYawPitchRoll`: roll about Z, then pitch about X, then yaw about Y. */
export function quatRotationYawPitchRoll(yaw: number, pitch: number, roll: number): Quat {
  const sy = Math.sin(f(yaw) * 0.5), cy = Math.cos(f(yaw) * 0.5);
  const sp = Math.sin(f(pitch) * 0.5), cp = Math.cos(f(pitch) * 0.5);
  const sr = Math.sin(f(roll) * 0.5), cr = Math.cos(f(roll) * 0.5);
  return {
    x: f(cy * sp * cr + sy * cp * sr),
    y: f(sy * cp * cr - cy * sp * sr),
    z: f(cy * cp * sr - sy * sp * cr),
    w: f(cy * cp * cr + sy * sp * sr),
  };
}

/** `D3DXMatrixRotationYawPitchRoll` = Rz(roll) * Rx(pitch) * Ry(yaw). */
export const matRotationYawPitchRoll = (yaw: number, pitch: number, roll: number): Mat4 =>
  matRotationQuaternion(quatRotationYawPitchRoll(yaw, pitch, roll));

export function matLookAtLH(eye: Vec3, at: Vec3, up: Vec3): Mat4 {
  const z = vec3Normalize(vec3Sub(at, eye));
  const x = vec3Normalize(vec3Cross(up, z));
  const y = vec3Cross(z, x);
  const m = matIdentity();
  m[0] = x.x; m[1] = y.x; m[2] = z.x;
  m[4] = x.y; m[5] = y.y; m[6] = z.y;
  m[8] = x.z; m[9] = y.z; m[10] = z.z;
  m[12] = -vec3Dot(x, eye); m[13] = -vec3Dot(y, eye); m[14] = -vec3Dot(z, eye);
  return m;
}

export function matPerspectiveFovLH(fovy: number, aspect: number, zn: number, zf: number): Mat4 {
  const yScale = 1 / Math.tan(f(fovy) / 2);
  const m = new Float32Array(16);
  m[0] = yScale / aspect; m[5] = yScale;
  m[10] = zf / (zf - zn); m[11] = 1;
  m[14] = (-zn * zf) / (zf - zn);
  return m;
}

export function matOrthoLH(w: number, h: number, zn: number, zf: number): Mat4 {
  const m = matIdentity();
  m[0] = 2 / w; m[5] = 2 / h; m[10] = 1 / (zf - zn); m[14] = zn / (zn - zf);
  return m;
}

/** `D3DXMatrixInverse`: null when the determinant is 0 (D3DX returns NULL and leaves the output untouched). */
export function matInverse(m: ArrayLike<number>): { matrix: Mat4; determinant: number } | null {
  const a = Array.from(m as ArrayLike<number>, Number);
  const inv = new Array<number>(16);
  inv[0] = a[5]! * a[10]! * a[15]! - a[5]! * a[11]! * a[14]! - a[9]! * a[6]! * a[15]! + a[9]! * a[7]! * a[14]! + a[13]! * a[6]! * a[11]! - a[13]! * a[7]! * a[10]!;
  inv[4] = -a[4]! * a[10]! * a[15]! + a[4]! * a[11]! * a[14]! + a[8]! * a[6]! * a[15]! - a[8]! * a[7]! * a[14]! - a[12]! * a[6]! * a[11]! + a[12]! * a[7]! * a[10]!;
  inv[8] = a[4]! * a[9]! * a[15]! - a[4]! * a[11]! * a[13]! - a[8]! * a[5]! * a[15]! + a[8]! * a[7]! * a[13]! + a[12]! * a[5]! * a[11]! - a[12]! * a[7]! * a[9]!;
  inv[12] = -a[4]! * a[9]! * a[14]! + a[4]! * a[10]! * a[13]! + a[8]! * a[5]! * a[14]! - a[8]! * a[6]! * a[13]! - a[12]! * a[5]! * a[10]! + a[12]! * a[6]! * a[9]!;
  inv[1] = -a[1]! * a[10]! * a[15]! + a[1]! * a[11]! * a[14]! + a[9]! * a[2]! * a[15]! - a[9]! * a[3]! * a[14]! - a[13]! * a[2]! * a[11]! + a[13]! * a[3]! * a[10]!;
  inv[5] = a[0]! * a[10]! * a[15]! - a[0]! * a[11]! * a[14]! - a[8]! * a[2]! * a[15]! + a[8]! * a[3]! * a[14]! + a[12]! * a[2]! * a[11]! - a[12]! * a[3]! * a[10]!;
  inv[9] = -a[0]! * a[9]! * a[15]! + a[0]! * a[11]! * a[13]! + a[8]! * a[1]! * a[15]! - a[8]! * a[3]! * a[13]! - a[12]! * a[1]! * a[11]! + a[12]! * a[3]! * a[9]!;
  inv[13] = a[0]! * a[9]! * a[14]! - a[0]! * a[10]! * a[13]! - a[8]! * a[1]! * a[14]! + a[8]! * a[2]! * a[13]! + a[12]! * a[1]! * a[10]! - a[12]! * a[2]! * a[9]!;
  inv[2] = a[1]! * a[6]! * a[15]! - a[1]! * a[7]! * a[14]! - a[5]! * a[2]! * a[15]! + a[5]! * a[3]! * a[14]! + a[13]! * a[2]! * a[7]! - a[13]! * a[3]! * a[6]!;
  inv[6] = -a[0]! * a[6]! * a[15]! + a[0]! * a[7]! * a[14]! + a[4]! * a[2]! * a[15]! - a[4]! * a[3]! * a[14]! - a[12]! * a[2]! * a[7]! + a[12]! * a[3]! * a[6]!;
  inv[10] = a[0]! * a[5]! * a[15]! - a[0]! * a[7]! * a[13]! - a[4]! * a[1]! * a[15]! + a[4]! * a[3]! * a[13]! + a[12]! * a[1]! * a[7]! - a[12]! * a[3]! * a[5]!;
  inv[14] = -a[0]! * a[5]! * a[14]! + a[0]! * a[6]! * a[13]! + a[4]! * a[1]! * a[14]! - a[4]! * a[2]! * a[13]! - a[12]! * a[1]! * a[6]! + a[12]! * a[2]! * a[5]!;
  inv[3] = -a[1]! * a[6]! * a[11]! + a[1]! * a[7]! * a[10]! + a[5]! * a[2]! * a[11]! - a[5]! * a[3]! * a[10]! - a[9]! * a[2]! * a[7]! + a[9]! * a[3]! * a[6]!;
  inv[7] = a[0]! * a[6]! * a[11]! - a[0]! * a[7]! * a[10]! - a[4]! * a[2]! * a[11]! + a[4]! * a[3]! * a[10]! + a[8]! * a[2]! * a[7]! - a[8]! * a[3]! * a[6]!;
  inv[11] = -a[0]! * a[5]! * a[11]! + a[0]! * a[7]! * a[9]! + a[4]! * a[1]! * a[11]! - a[4]! * a[3]! * a[9]! - a[8]! * a[1]! * a[7]! + a[8]! * a[3]! * a[5]!;
  inv[15] = a[0]! * a[5]! * a[10]! - a[0]! * a[6]! * a[9]! - a[4]! * a[1]! * a[10]! + a[4]! * a[2]! * a[9]! + a[8]! * a[1]! * a[6]! - a[8]! * a[2]! * a[5]!;
  const det = a[0]! * inv[0]! + a[1]! * inv[4]! + a[2]! * inv[8]! + a[3]! * inv[12]!;
  if (det === 0) return null;
  const out = new Float32Array(16);
  for (let i = 0; i < 16; i++) out[i] = inv[i]! / det;
  return { matrix: out, determinant: f(det) };
}

/**
 * `D3DXMatrixTransformation2D`: M = Msc^-1 * Msr^-1 * Ms * Msr * Msc * Mrc^-1 * Mr * Mrc * Mt with all rotations about Z
 * (this is D3DXMatrixTransformation with z components 0 / scaling z 1).
 */
export function matTransformation2D(scalingCenter: Vec2 | null, scalingRotation: number, scaling: Vec2 | null, rotationCenter: Vec2 | null, rotation: number, translation: Vec2 | null): Mat4 {
  const sc = scalingCenter ?? { x: 0, y: 0 };
  const rc = rotationCenter ?? { x: 0, y: 0 };
  const srq = quatZ(scalingRotation), rq = quatZ(rotation);
  const msr = matRotationQuaternion(srq);
  let m = matTranslation(-sc.x, -sc.y, 0);
  m = matMultiply(m, matTranspose(msr));
  m = matMultiply(m, matScaling(scaling?.x ?? 1, scaling?.y ?? 1, 1));
  m = matMultiply(m, msr);
  m = matMultiply(m, matTranslation(sc.x, sc.y, 0));
  m = matMultiply(m, matTranslation(-rc.x, -rc.y, 0));
  m = matMultiply(m, matRotationQuaternion(rq));
  m = matMultiply(m, matTranslation(rc.x, rc.y, 0));
  m = matMultiply(m, matTranslation(translation?.x ?? 0, translation?.y ?? 0, 0));
  return m;
}
const quatZ = (angle: number): Quat => ({ x: 0, y: 0, z: f(Math.sin(f(angle) / 2)), w: f(Math.cos(f(angle) / 2)) });

// ---------------------------------------------------------------- vectors
export const vec3Sub = (a: Vec3, b: Vec3): Vec3 => ({ x: f(a.x - b.x), y: f(a.y - b.y), z: f(a.z - b.z) });
export const vec3Add = (a: Vec3, b: Vec3): Vec3 => ({ x: f(a.x + b.x), y: f(a.y + b.y), z: f(a.z + b.z) });
export const vec3Scale = (a: Vec3, s: number): Vec3 => ({ x: f(a.x * s), y: f(a.y * s), z: f(a.z * s) });
export const vec3Dot = (a: Vec3, b: Vec3): number => f(a.x * b.x + a.y * b.y + a.z * b.z);
export const vec3Cross = (a: Vec3, b: Vec3): Vec3 => ({ x: f(a.y * b.z - a.z * b.y), y: f(a.z * b.x - a.x * b.z), z: f(a.x * b.y - a.y * b.x) });
export const vec3Length = (a: Vec3): number => f(Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z));

/** `D3DXVec3Normalize`: a zero vector stays zero. */
export function vec3Normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return len ? { x: f(v.x / len), y: f(v.y / len), z: f(v.z / len) } : { x: 0, y: 0, z: 0 };
}
export function vec2Normalize(v: Vec2): Vec2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len ? { x: f(v.x / len), y: f(v.y / len) } : { x: 0, y: 0 };
}
export function vec4Normalize(v: Vec4): Vec4 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w);
  return len ? { x: f(v.x / len), y: f(v.y / len), z: f(v.z / len), w: f(v.w / len) } : { x: 0, y: 0, z: 0, w: 0 };
}

/** `D3DXVec2Transform`: (x, y, 0, 1) * M. */
export function vec2Transform(v: Vec2, m: ArrayLike<number>): Vec4 {
  return {
    x: f(v.x * m[0]! + v.y * m[4]! + m[12]!), y: f(v.x * m[1]! + v.y * m[5]! + m[13]!),
    z: f(v.x * m[2]! + v.y * m[6]! + m[14]!), w: f(v.x * m[3]! + v.y * m[7]! + m[15]!),
  };
}
/** `D3DXVec3Transform`: (x, y, z, 1) * M. */
export function vec3Transform(v: Vec3, m: ArrayLike<number>): Vec4 {
  return {
    x: f(v.x * m[0]! + v.y * m[4]! + v.z * m[8]! + m[12]!), y: f(v.x * m[1]! + v.y * m[5]! + v.z * m[9]! + m[13]!),
    z: f(v.x * m[2]! + v.y * m[6]! + v.z * m[10]! + m[14]!), w: f(v.x * m[3]! + v.y * m[7]! + v.z * m[11]! + m[15]!),
  };
}
/** `D3DXVec3TransformCoord`: transform as a point, then divide by w. */
export function vec3TransformCoord(v: Vec3, m: ArrayLike<number>): Vec3 {
  const x = v.x * m[0]! + v.y * m[4]! + v.z * m[8]! + m[12]!;
  const y = v.x * m[1]! + v.y * m[5]! + v.z * m[9]! + m[13]!;
  const z = v.x * m[2]! + v.y * m[6]! + v.z * m[10]! + m[14]!;
  const w = v.x * m[3]! + v.y * m[7]! + v.z * m[11]! + m[15]!;
  return { x: f(x / w), y: f(y / w), z: f(z / w) };
}
/** `D3DXVec3TransformNormal`: rotation/scale part only. */
export function vec3TransformNormal(v: Vec3, m: ArrayLike<number>): Vec3 {
  return {
    x: f(v.x * m[0]! + v.y * m[4]! + v.z * m[8]!), y: f(v.x * m[1]! + v.y * m[5]! + v.z * m[9]!), z: f(v.x * m[2]! + v.y * m[6]! + v.z * m[10]!),
  };
}

/** `D3DXVec3CatmullRom(v0, v1, v2, v3, s)`: Catmull-Rom spline segment v1..v2. */
export function vec3CatmullRom(v0: Vec3, v1: Vec3, v2: Vec3, v3: Vec3, s: number): Vec3 {
  const s2 = s * s, s3 = s2 * s;
  const c = (a: number, b: number, cc: number, d: number): number =>
    f(0.5 * (2 * b + (-a + cc) * s + (2 * a - 5 * b + 4 * cc - d) * s2 + (-a + 3 * b - 3 * cc + d) * s3));
  return { x: c(v0.x, v1.x, v2.x, v3.x), y: c(v0.y, v1.y, v2.y, v3.y), z: c(v0.z, v1.z, v2.z, v3.z) };
}

/** `D3DXVec3Project(v, viewport, projection, view, world)`; null matrices are identity. */
export function vec3Project(v: Vec3, vp: Viewport, projection: ArrayLike<number> | null, view: ArrayLike<number> | null, world: ArrayLike<number> | null): Vec3 {
  let m = matIdentity();
  if (world) m = matMultiply(m, world);
  if (view) m = matMultiply(m, view);
  if (projection) m = matMultiply(m, projection);
  const p = vec3TransformCoord(v, m);
  return {
    x: f(vp.x + (1 + p.x) * vp.width / 2),
    y: f(vp.y + (1 - p.y) * vp.height / 2),
    z: f(vp.minZ + p.z * (vp.maxZ - vp.minZ)),
  };
}

// ---------------------------------------------------------------- quaternions
/** `D3DXQuaternionMultiply(q1, q2)` = q2 applied after q1 (D3DX's component order). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: f(b.w * a.x + b.x * a.w + b.y * a.z - b.z * a.y),
    y: f(b.w * a.y - b.x * a.z + b.y * a.w + b.z * a.x),
    z: f(b.w * a.z + b.x * a.y - b.y * a.x + b.z * a.w),
    w: f(b.w * a.w - b.x * a.x - b.y * a.y - b.z * a.z),
  };
}
/** `D3DXQuaternionConjugate` */
export function quatConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}
export function quatNormalize(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return len ? { x: f(q.x / len), y: f(q.y / len), z: f(q.z / len), w: f(q.w / len) } : { x: 0, y: 0, z: 0, w: 0 };
}
/** `D3DXQuaternionSlerp` (the shortest-arc form with the 0.001 linear fallback). */
export function quatSlerp(q1: Quat, q2: Quat, t: number): Quat {
  let temp = 1 - t;
  let dot = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;
  if (dot < 0) { t = -t; dot = -dot; }
  if (1 - dot > 0.001) {
    const theta = Math.acos(f(dot));
    temp = Math.sin(theta * temp) / Math.sin(theta);
    t = Math.sin(theta * t) / Math.sin(theta);
  }
  return { x: f(temp * q1.x + t * q2.x), y: f(temp * q1.y + t * q2.y), z: f(temp * q1.z + t * q2.z), w: f(temp * q1.w + t * q2.w) };
}

/** `D3DXQuaternionRotationMatrix` (row-vector convention, the inverse of `matRotationQuaternion`). */
export function quatRotationMatrix(m: ArrayLike<number>): Quat {
  const trace = f(m[0]! + m[5]! + m[10]! + 1);
  if (trace > 1) {
    const s = 2 * Math.sqrt(trace);
    return { x: f((m[6]! - m[9]!) / s), y: f((m[8]! - m[2]!) / s), z: f((m[1]! - m[4]!) / s), w: f(Math.sqrt(trace) / 2) };
  }
  let maxi = 0, maxdiag = m[0]!;
  if (m[5]! > maxdiag) { maxi = 1; maxdiag = m[5]!; }
  if (m[10]! > maxdiag) { maxi = 2; maxdiag = m[10]!; }
  void maxdiag;
  let s: number;
  switch (maxi) {
    case 0:
      s = 2 * Math.sqrt(1 + m[0]! - m[5]! - m[10]!);
      return { x: f(0.25 * s), y: f((m[1]! + m[4]!) / s), z: f((m[2]! + m[8]!) / s), w: f((m[6]! - m[9]!) / s) };
    case 1:
      s = 2 * Math.sqrt(1 + m[5]! - m[0]! - m[10]!);
      return { x: f((m[1]! + m[4]!) / s), y: f(0.25 * s), z: f((m[6]! + m[9]!) / s), w: f((m[8]! - m[2]!) / s) };
    default:
      s = 2 * Math.sqrt(1 + m[10]! - m[0]! - m[5]!);
      return { x: f((m[2]! + m[8]!) / s), y: f((m[6]! + m[9]!) / s), z: f(0.25 * s), w: f((m[1]! - m[4]!) / s) };
  }
}

/** `D3DXMatrixDecompose`: scale = row lengths, translation = last row, rotation from the normalised rows; null when a scale is 0 (D3DERR_INVALIDCALL). */
export function matDecompose(m: ArrayLike<number>): { scale: Vec3; rotation: Quat; translation: Vec3 } | null {
  const sx = f(Math.hypot(m[0]!, m[1]!, m[2]!)), sy = f(Math.hypot(m[4]!, m[5]!, m[6]!)), sz = f(Math.hypot(m[8]!, m[9]!, m[10]!));
  if (sx === 0 || sy === 0 || sz === 0) return null;
  const n = matIdentity();
  for (let c = 0; c < 3; c++) { n[c] = f(m[c]! / sx); n[4 + c] = f(m[4 + c]! / sy); n[8 + c] = f(m[8 + c]! / sz); }
  return { scale: { x: sx, y: sy, z: sz }, rotation: quatRotationMatrix(n), translation: { x: m[12]!, y: m[13]!, z: m[14]! } };
}

// ---------------------------------------------------------------- planes
/** `D3DXPlaneFromPointNormal`. */
export const planeFromPointNormal = (p: Vec3, n: Vec3): Plane => ({ a: n.x, b: n.y, c: n.z, d: f(-vec3Dot(p, n)) });
/** `D3DXPlaneNormalize`: scale so that (a, b, c) is a unit vector; a degenerate plane becomes (0, 0, 0, 0). */
export function planeNormalize(p: Plane): Plane {
  const len = Math.sqrt(p.a * p.a + p.b * p.b + p.c * p.c);
  return len ? { a: f(p.a / len), b: f(p.b / len), c: f(p.c / len), d: f(p.d / len) } : { a: 0, b: 0, c: 0, d: 0 };
}
/** `D3DXPlaneIntersectLine`: the point where line p1-p2 crosses the plane, or null when parallel. */
export function planeIntersectLine(pl: Plane, p1: Vec3, p2: Vec3): Vec3 | null {
  const d = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  const denom = pl.a * d.x + pl.b * d.y + pl.c * d.z;
  if (denom === 0) return null;
  const t = -(pl.a * p1.x + pl.b * p1.y + pl.c * p1.z + pl.d) / denom;
  return { x: f(p1.x + t * d.x), y: f(p1.y + t * d.y), z: f(p1.z + t * d.z) };
}
