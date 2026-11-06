/**
 * The keys of a KAC animation as `ReadFromMemoryDeserializer` (32989F10) hands them to `RegisterAnimationSRTKeys`:
 * UnpackKeys (done by `parseKac`) -> `OptimizeKeys` (32988610, tolerance 0.001) -> D3DXKEY_VECTOR3 / D3DXKEY_QUATERNION arrays.
 *
 * `OptimizeKeys(&scalesBegin, &scalesEnd, &transBegin, &transEnd, &rotsBegin, &rotsEnd, tolerance)` works on the three key arrays in place:
 *
 *  1. `CorrectVectorKeyOrder` (329884B0) / `CorrectQuaternionKeyOrder` (32988330): keys with a negative time are dropped (the last one of them
 *     becomes the key at time 0 when the first non-negative key is later than 0), unsorted keys are sorted by time (`std::sort`), keys with an
 *     equal time are collapsed to the first (`std::unique`).
 *  2. A greedy reducer with a three-state machine per channel: state 0 = the last kept key is the previous key, 1 = a run of keys within the
 *     tolerance of the last kept key is being skipped, 2 = a straight segment (lerp, for rotations slerp) from the last kept key is being
 *     extended while the following keys stay within `tolerance / 10 * count` of the prediction.  A key that breaks the prediction can widen the
 *     tolerance (`count`, at most 10 keys' worth in total); otherwise the segment is closed with the previous key and the breaking key is
 *     looked at again in state 0.  The first key is always kept, and so is the last one unless the channel ended in state 0.
 *     Scales and translations use the same reducer; scales are additionally gated by sign accumulators (see `signBits`).
 *  3. Rotation keys are normalised (`D3DXQuaternionNormalize`) and flipped into the hemisphere of the last kept key (w >= 0 for the first), a
 *     channel with fewer than two keys is left alone (not even normalised).
 *
 * All arithmetic is single precision (SSE `mulss` / `addss` ...: `Math.fround` after every operation); the only double-precision steps are
 * `sin` of the slerp weights and `atan2` of the slerp angle, as in the exe (`_libm_sse2_sin_precise`, `_CIatan2`, both rounded to float).
 *
 * **The exe has a bug in the scale channel**: the two sign accumulators of the reducer (`[esp+48h]` for states 0 / 1 and `[esp+8Ch]` for state 2) are
 * never initialised, they start with whatever the stack held (the frame of `CorrectVectorKeyOrder` that ran just before).  Their low six bits are
 * three 2-bit fields (x, y, z: 1 = a positive value was seen, 2 = a negative one, 3 = both); a field that reaches 3 makes the keys "sign
 * inconsistent" for the rest of the channel, which turns the reduction off (every key is kept).  With the typical scale of (1, 1, 1) the reduction
 * on or off gives the same animation, only the number of keys differs.  The port starts both accumulators at 0 (`options.signBits` overrides).
 */
import { quatMultiply, quatNormalize } from "@els/d3d9";
import type { D3DXKeyQuaternion, D3DXKeyVector3 } from "@els/d3d9";
import type { KacAnimation } from "@els/assets";

const f = Math.fround;
/** `OptimizeKeys`' tolerance argument in `ReadFromMemoryDeserializer` */
export const KAC_OPTIMIZE_TOLERANCE = 0.001;
/** 1 / 1024 (0x334AC5A4): below this length of the relative rotation's vector part a rotation segment is interpolated linearly */
const MIN_AXIS = 0.0009765625;

export interface OptimizeOptions {
  /** the initial values of the two uninitialised sign accumulators of the scale reducer: states 0 / 1 and state 2 (default 0 / 0) */
  signBits?: { a: number; b: number };
}

// ------------------------------------------------------------------------------------------------ key order

/** the `[start, end)` range (in keys) of an array that `Correct*KeyOrder` leaves */
interface KeyRange { start: number; end: number }

/** `std::unique` with `D3DXKEY_*_EQUAL` (equal Time): keeps the first of a run, returns the new end (L448648 / 32988030) */
function uniqueKeys(a: Float32Array, stride: number, first: number, last: number): number {
  if (first === last) return last;
  let v3 = first + 1;
  if (v3 === last) return last;
  let v2 = first;
  let v4: number;
  for (;;) {
    v4 = v3 + 1;
    if (a[v2 * stride] === a[v3 * stride]) break;
    v2 = v3++;
    if (v4 === last) return last;
  }
  for (; v4 !== last; v4++) {
    if (a[v2 * stride] !== a[v4 * stride]) { v2++; a.copyWithin(v2 * stride, v4 * stride, v4 * stride + stride); }
  }
  return v2 + 1;
}

/**
 * `std::_Sort_unchecked` by Time.  MSVC's `std::sort` is a (stable) insertion sort for up to 32 keys, which this stable sort equals; for more keys it is
 * an introsort, which is not stable: for an UNSORTED array of more than 32 keys that holds keys of equal time, the exe may keep a different one of them
 * (`std::unique` keeps the first of the run).  That case is not ported: the oracle never produces it, and every key array of the shipped animations is
 * already sorted (`tools/verify-ksm.ts`), so for them the exe does not reach its sort at all (only `std::unique`, when two keys have the same time).
 */
function sortKeys(a: Float32Array, stride: number, first: number, last: number): void {
  const rows: Float32Array[] = [];
  for (let i = first; i < last; i++) rows.push(a.slice(i * stride, i * stride + stride));
  rows.sort((p, q) => (p[0]! < q[0]! ? -1 : p[0]! > q[0]! ? 1 : 0));
  rows.forEach((r, k) => a.set(r, (first + k) * stride));
}

/** `CorrectVectorKeyOrder` (329884B0, L448773) and `CorrectQuaternionKeyOrder` (32988330, L448885): the same algorithm on two key layouts. */
function correctKeyOrder(a: Float32Array, stride: number, r: KeyRange): void {
  const T = (i: number): number => a[i * stride]!;
  const start = r.start;
  const end = r.end;
  if (start === end) return;
  if (start + 1 === end) { if (T(start) < 0) a[start * stride] = 0; return; }
  // the first key with a non-negative time
  let i = start;
  for (;; i++) {
    if (T(i) >= 0) break;
    if (i + 1 === end) { a[i * stride] = 0; r.start = i; return; } // all negative: the last one becomes the key at time 0
  }
  const timeI = T(i);
  if (i + 1 === end) { // exactly one non-negative key, the last one
    if (timeI !== 0) { i--; a[i * stride] = 0; }
    r.start = i;
    return;
  }
  // the key before the first non-negative one stands in for time 0 when that one is later than 0
  let back = -1;
  if (i !== start) { back = i - 1; if (timeI <= 0) back = -1; }
  let dup = false;
  let cur = i;
  let next = i + 1;
  while (T(cur) <= T(next)) {
    if (T(cur) === T(next)) dup = true;
    cur = next++;
    if (next === end) { // already sorted
      if (back >= 0) { a[back * stride] = 0; r.start = back; } else r.start = i;
      if (dup) r.end = uniqueKeys(a, stride, r.start, r.end);
      return;
    }
  }
  sortKeys(a, stride, r.start, r.end);
  r.end = uniqueKeys(a, stride, r.start, r.end);
  if (r.start < r.end && T(r.start) < 0) {
    let p = r.start + 1;
    while (p !== r.end && T(p) < 0) p++;
    r.start = p;
  }
}

// ------------------------------------------------------------------------------------------------ vector channels

/** 0 = zero (or NaN), 1 = positive, 2 = negative: the 2-bit sign code of a component (`comiss` against 0) */
const signCode = (v: number): number => (v > 0 ? 1 : v < 0 ? 2 : 0);
/** the codes of a key's x, y, z packed as `cx | cy << 2 | cz << 4` */
const keyCode = (k: Float32Array, i: number): number => signCode(k[i * 4 + 1]!) | (signCode(k[i * 4 + 2]!) << 2) | (signCode(k[i * 4 + 3]!) << 4);
/** no component has seen both signs */
const consistent = (bits: number): boolean => (bits & 0x30) !== 0x30 && (bits & 0xc) !== 0xc && (bits & 3) !== 3;

/**
 * The reducer of the scale (with `signs`) and translation channels over `n` keys of 4 floats {time, x, y, z} (L449137 / L449546 ...);
 * returns the number of keys kept.
 */
function reduceVectorKeys(k: Float32Array, n: number, tol: number, signs: { a: number; b: number } | null): number {
  if (n <= 1) return n;
  const T = (i: number): number => k[i * 4]!;
  const X = (i: number): number => k[i * 4 + 1]!;
  const Y = (i: number): number => k[i * 4 + 2]!;
  const Z = (i: number): number => k[i * 4 + 3]!;
  const emit = (src: number): void => { o++; if (o !== src) k.copyWithin(o * 4, src * 4, src * 4 + 4); };
  /** |a - b| <= tol, or <= max(|a|, |b|) * tol */
  const near = (a: number, b: number): boolean => {
    const e = a < b ? f(b - a) : f(a - b);
    if (tol >= e) return true;
    return f(Math.max(Math.abs(a), Math.abs(b)) * tol) >= e;
  };
  let o = 0; // the last kept key
  let state = 0;
  let invDt = 0, dx = 0, dy = 0, dz = 0, tolSeg = 0, count = 0, sum = 0;
  let accA = signs ? signs.a : 0, accB = signs ? signs.b : 0;
  let code = signs ? keyCode(k, 1) : 0; // the sign code of the key being looked at
  let i = 1;
  const advance = (): void => { i++; if (signs && i < n) code = keyCode(k, i); };
  /** the error of a component against its prediction: 0 when within `tolSeg`, else the ratio error / allowed (> 1) */
  const miss = (actual: number, pred: number): number => {
    const e = actual < pred ? f(pred - actual) : f(actual - pred);
    if (tolSeg >= e) return 0;
    const m = f(Math.max(Math.max(Math.abs(actual), Math.abs(pred)), 1) * tolSeg);
    return m >= e ? 0 : f(e / m);
  };
  while (i < n) {
    if (state < 2) {
      let ok = true;
      if (signs) { accA |= code; ok = consistent(accA); }
      if (ok && near(X(i), X(o)) && near(Y(i), Y(o)) && near(Z(i), Z(o))) { state = 1; advance(); continue; }
      if (state === 1) emit(i - 1); // the last key of the run that was skipped
      if (ok) { // start a straight segment from the last kept key to this key
        invDt = f(1 / f(T(i) - T(o)));
        dx = f(X(i) - X(o)); dy = f(Y(i) - Y(o)); dz = f(Z(i) - Z(o));
        state = 2; count = 1; sum = 1; tolSeg = f(tol / 10);
      } else { emit(i); state = 0; }
      advance();
      continue;
    }
    // state 2
    let close = false;
    if (signs) { accB |= code; if (!consistent(accB)) close = true; }
    if (!close) {
      const dt = f(T(i) - T(o));
      const w = f(dt * invDt);
      const px = f(f(w * dx) + X(o)), py = f(f(w * dy) + Y(o)), pz = f(f(w * dz) + Z(o));
      let rx = 1, ry = 1, rz = 1;
      let fail = false;
      const mx = miss(X(i), px);
      if (mx !== 0) { rx = mx; fail = true; } else {
        const my = miss(Y(i), py);
        if (my !== 0) { ry = my; fail = true; } else {
          const mz = miss(Z(i), pz);
          if (mz !== 0) { rz = mz; fail = true; }
        }
      }
      if (!fail) { advance(); continue; }
      const ratio = Math.max(rx, Math.max(ry, rz));
      if (count < 10) {
        const r = f(f(count) * ratio);
        if (r <= 10) {
          let c1 = count + 1;
          const want = Math.ceil(r);
          if (c1 <= want) c1 = want;
          sum += c1;
          if (sum <= 10) { // widen the tolerance and re-fit the segment to this key
            count = c1;
            invDt = f(1 / dt);
            dx = f(X(i) - X(o)); dy = f(Y(i) - Y(o)); dz = f(Z(i) - Z(o));
            tolSeg = f(f(tol / 10) * f(c1));
            advance();
            continue;
          }
        }
      }
    }
    emit(i - 1); // close the segment with the previous key; this key is looked at again in state 0
    state = 0;
  }
  if (state !== 0) emit(n - 1);
  return o + 1;
}

// ------------------------------------------------------------------------------------------------ rotation channel

interface Quat { x: number; y: number; z: number; w: number }
const negQ = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: -q.w });

/** The rotation reducer over `n >= 2` keys of 5 floats {time, x, y, z, w} (L450071 ...); returns the number of keys kept. */
function reduceQuaternionKeys(k: Float32Array, n: number, tol: number): number {
  const T = (i: number): number => k[i * 5]!;
  const Q = (i: number): Quat => ({ x: k[i * 5 + 1]!, y: k[i * 5 + 2]!, z: k[i * 5 + 3]!, w: k[i * 5 + 4]! });
  const put = (i: number, q: Quat): void => { k[i * 5 + 1] = q.x; k[i * 5 + 2] = q.y; k[i * 5 + 3] = q.z; k[i * 5 + 4] = q.w; };
  // the first key: normalised, w >= 0
  let q0 = quatNormalize(Q(0));
  if (!(q0.w >= 0)) q0 = negQ(q0);
  put(0, q0);
  let o = 0;
  let state = 0;
  let qlast: Quat = { x: 0, y: 0, z: 0, w: 1 }; // the last key looked at, normalised and flipped (v252 / v256)
  let qseg: Quat = qlast; // the end of the segment (v257 / v258)
  let inv = 0, omega = 0, invDt = 0, tolSeg = 0, count = 0, sum = 0;
  const emitLast = (src: number): void => { o++; put(o, qlast); k[o * 5] = T(src); };
  /** |pred - actual| against `tolSeg`: 0 when within, else the ratio */
  const miss = (actual: number, pred: number): number => {
    const e = actual < pred ? f(pred - actual) : f(actual - pred);
    if (tolSeg >= e) return 0;
    const m = f(Math.max(Math.max(Math.abs(actual), Math.abs(pred)), 1) * tolSeg);
    return m >= e ? 0 : f(e / m);
  };
  /** state 0 / 1: is d within `tol` of the identity (w against 1, x / y / z against 0)? */
  const identityish = (d: Quat): boolean => {
    const ew = d.w < 1 ? f(1 - d.w) : f(d.w - 1);
    if (tol < ew && f(Math.max(Math.abs(d.w), 1) * tol) < ew) return false;
    for (const v of [d.x, d.y, d.z]) {
      const e = v < 0 ? f(0 - v) : f(v - 0);
      if (tol < e && f(Math.max(Math.abs(v), 0) * tol) < e) return false;
    }
    return true;
  };
  /** the length of the vector part of d, ((y² + x²) + z²) in single precision */
  const axisLength = (d: Quat): number => f(Math.sqrt(f(f(f(d.y * d.y) + f(d.x * d.x)) + f(d.z * d.z))));
  let i = 1;
  while (i < n) {
    let qn = quatNormalize(Q(i));
    const L = Q(o);
    let d = quatMultiply(qn, { x: -L.x, y: -L.y, z: -L.z, w: L.w });
    if (!(d.w >= 0)) { d = negQ(d); qn = negQ(qn); }
    if (state < 2) {
      if (identityish(d)) { state = 1; qlast = qn; i++; continue; }
      if (state === 1) emitLast(i - 1); // the last key of the run that was skipped (d stays the one computed against the older key)
      invDt = f(1 / f(T(i) - k[o * 5]!));
      qseg = qn; qlast = qn;
      const s = axisLength(d);
      inv = s < MIN_AXIS ? 0 : f(1 / s);
      omega = f(Math.atan2(s, d.w));
      state = 2; count = 1; sum = 1; tolSeg = f(tol / 10);
      i++;
      continue;
    }
    // state 2
    let close = false;
    const d2 = quatMultiply(qn, { x: -qlast.x, y: -qlast.y, z: -qlast.z, w: qlast.w });
    if (d2.w <= 0) close = true;
    if (!close) {
      const dt = f(T(i) - T(o));
      const t = f(dt * invDt);
      const omt = f(1 - t);
      let pw: number, px: number, py: number, pz: number;
      if (inv === 0) {
        pw = f(f(L.w * omt) + f(t * qseg.w)); px = f(f(L.x * omt) + f(t * qseg.x)); py = f(f(L.y * omt) + f(t * qseg.y)); pz = f(f(L.z * omt) + f(t * qseg.z));
      } else {
        const s1 = f(f(Math.sin(f(omt * omega))) * inv);
        const s2 = f(f(Math.sin(f(t * omega))) * inv);
        px = f(f(L.x * s1) + f(s2 * qseg.x)); py = f(f(L.y * s1) + f(s2 * qseg.y)); pw = f(f(L.w * s1) + f(s2 * qseg.w)); pz = f(f(L.z * s1) + f(s2 * qseg.z));
      }
      let rw = 1, rx = 1, ry = 1, rz = 1;
      let fail = false;
      const mw = miss(qn.w, pw);
      if (mw !== 0) { rw = mw; fail = true; } else {
        const mx = miss(qn.x, px);
        if (mx !== 0) { rx = mx; fail = true; } else {
          const my = miss(qn.y, py);
          if (my !== 0) { ry = my; fail = true; } else {
            const mz = miss(qn.z, pz);
            if (mz !== 0) { rz = mz; fail = true; }
          }
        }
      }
      if (!fail) {
        qlast = qn;
        const s = axisLength(d);
        if (s >= MIN_AXIS && inv === 0) { // the segment was linear because the first step was tiny: now it has a direction
          invDt = f(1 / dt);
          qseg = qlast;
          inv = f(1 / s);
          omega = f(Math.atan2(s, d.w));
        }
        i++;
        continue;
      }
      const ratio = Math.max(Math.max(rw, rx), Math.max(ry, rz));
      if (count < 10) {
        const r = f(f(count) * ratio);
        if (r <= 10) {
          let c1 = count + 1;
          const want = Math.ceil(r);
          if (c1 <= want) c1 = want;
          sum += c1;
          if (sum <= 10) {
            count = c1;
            qseg = qn; qlast = qn;
            tolSeg = f(f(tol / 10) * f(c1));
            const s = axisLength(d);
            inv = s < MIN_AXIS ? 0 : f(1 / s);
            omega = f(Math.atan2(s, d.w));
            invDt = f(1 / dt);
            i++;
            continue;
          }
        }
      }
    }
    emitLast(i - 1); // close the segment with the previous key; this key is looked at again in state 0
    state = 0;
  }
  if (state !== 0) emitLast(n - 1);
  return o + 1;
}

// ------------------------------------------------------------------------------------------------ OptimizeKeys

/** The three key arrays as Float32Arrays: vector keys {time, x, y, z}, quaternion keys {time, x, y, z, w} (the layout of D3DXKEY_VECTOR3 / D3DXKEY_QUATERNION). */
export interface KeyArrays { scales: Float32Array; translations: Float32Array; rotations: Float32Array }

/** `OptimizeKeys(scales, translations, rotations, tolerance)` (32988610); returns new arrays (the inputs are not modified). */
export function optimizeKeys(keys: KeyArrays, tolerance: number = KAC_OPTIMIZE_TOLERANCE, options: OptimizeOptions = {}): KeyArrays {
  const tol = f(tolerance);
  const run = (src: Float32Array, stride: 4 | 5, reduce: (k: Float32Array, n: number) => number): Float32Array => {
    const a = src.slice();
    const r: KeyRange = { start: 0, end: a.length / stride };
    if (r.start === r.end) return a;
    correctKeyOrder(a, stride, r);
    const view = a.subarray(r.start * stride, r.end * stride);
    const n = reduce(view, r.end - r.start);
    return view.slice(0, n * stride);
  };
  const signs = options.signBits ?? { a: 0, b: 0 };
  return {
    scales: run(keys.scales, 4, (k, n) => reduceVectorKeys(k, n, tol, { a: signs.a, b: signs.b })),
    translations: run(keys.translations, 4, (k, n) => reduceVectorKeys(k, n, tol, null)),
    rotations: run(keys.rotations, 5, (k, n) => (n >= 2 ? reduceQuaternionKeys(k, n, tol) : n)),
  };
}

// ------------------------------------------------------------------------------------------------ the keys of one animation

export interface PreparedKeys { scales: D3DXKeyVector3[]; rotations: D3DXKeyQuaternion[]; translations: D3DXKeyVector3[] }

const packVec = (keys: readonly { time: number; value: [number, number, number] }[]): Float32Array => {
  const a = new Float32Array(keys.length * 4);
  keys.forEach((k, i) => { a[i * 4] = k.time; a[i * 4 + 1] = k.value[0]; a[i * 4 + 2] = k.value[1]; a[i * 4 + 3] = k.value[2]; });
  return a;
};
const packQuat = (keys: readonly { time: number; value: [number, number, number, number] }[]): Float32Array => {
  const a = new Float32Array(keys.length * 5);
  keys.forEach((k, i) => { a[i * 5] = k.time; a[i * 5 + 1] = k.value[0]; a[i * 5 + 2] = k.value[1]; a[i * 5 + 3] = k.value[2]; a[i * 5 + 4] = k.value[3]; });
  return a;
};
const unpackVec = (a: Float32Array): D3DXKeyVector3[] => Array.from({ length: a.length / 4 }, (_, i) => ({ Time: a[i * 4]!, Value: { x: a[i * 4 + 1]!, y: a[i * 4 + 2]!, z: a[i * 4 + 3]! } }));
const unpackQuat = (a: Float32Array): D3DXKeyQuaternion[] => Array.from({ length: a.length / 5 }, (_, i) => ({ Time: a[i * 5]!, Value: { x: a[i * 5 + 1]!, y: a[i * 5 + 2]!, z: a[i * 5 + 3]!, w: a[i * 5 + 4]! } }));

/** The keys of one animation (frame) ready for `RegisterAnimationSRTKeys`: unpacked keys through `OptimizeKeys` with the tolerance 0.001. */
export function prepareKeys(a: KacAnimation, options: OptimizeOptions = {}): PreparedKeys {
  const o = optimizeKeys({ scales: packVec(a.scales), translations: packVec(a.translations), rotations: packQuat(a.rotations) }, KAC_OPTIMIZE_TOLERANCE, options);
  return { scales: unpackVec(o.scales), rotations: unpackQuat(o.rotations), translations: unpackVec(o.translations) };
}
