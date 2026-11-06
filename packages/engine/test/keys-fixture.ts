/**
 * The file formats of the `OptimizeKeys` oracle (tools/oracle-optimizekeys.py) and of the recorded fixture the unit tests replay:
 *
 *   cases   = "OKC1" u32 n { f32 tolerance, u32 signA, u32 signB, u32 nScale, u32 nTrans, u32 nRot, f32[nScale*4], f32[nTrans*4], f32[nRot*5] }
 *   results = "OKR1" u32 n { u32 nScale, u32 nTrans, u32 nRot, f32[nScale*4], f32[nTrans*4], f32[nRot*5] }
 *   fixture = u32 length of the cases blob, the cases blob, the results blob
 *
 * (little endian; a vector key is time, x, y, z and a quaternion key time, x, y, z, w.)  `signA` / `signB` are the initial values of the two
 * uninitialised sign accumulators of the scale reducer (see kac-keys.ts); 0xFFFFFFFF = whatever the emulated stack held.
 */
import type { KeyArrays } from "../src/index.ts";

export interface KeyCase { kind: string; tol: number; signA: number; signB: number; keys: KeyArrays }

export const NATURAL = 0xffffffff;

const f32bytes = (a: Float32Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.length * 4);

export function encodeCases(cases: readonly KeyCase[]): Uint8Array {
  let size = 8;
  for (const c of cases) size += 24 + 4 * (c.keys.scales.length + c.keys.translations.length + c.keys.rotations.length);
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  new Uint8Array(buf).set([0x4f, 0x4b, 0x43, 0x31]); // "OKC1"
  dv.setUint32(4, cases.length, true);
  let p = 8;
  for (const c of cases) {
    dv.setFloat32(p, c.tol, true); dv.setUint32(p + 4, c.signA, true); dv.setUint32(p + 8, c.signB, true);
    dv.setUint32(p + 12, c.keys.scales.length / 4, true); dv.setUint32(p + 16, c.keys.translations.length / 4, true); dv.setUint32(p + 20, c.keys.rotations.length / 5, true);
    p += 24;
    for (const a of [c.keys.scales, c.keys.translations, c.keys.rotations]) { new Uint8Array(buf, p, a.length * 4).set(f32bytes(a)); p += a.length * 4; }
  }
  return new Uint8Array(buf);
}

export function decodeCases(bytes: Uint8Array): KeyCase[] {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const dv = new DataView(buf);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "OKC1") throw new Error("not a cases blob");
  const n = dv.getUint32(4, true);
  const out: KeyCase[] = [];
  let p = 8;
  for (let i = 0; i < n; i++) {
    const tol = dv.getFloat32(p, true), signA = dv.getUint32(p + 4, true), signB = dv.getUint32(p + 8, true);
    const ns = dv.getUint32(p + 12, true), nt = dv.getUint32(p + 16, true), nr = dv.getUint32(p + 20, true);
    p += 24;
    const take = (count: number): Float32Array => { const a = new Float32Array(buf.slice(p, p + count * 4)); p += count * 4; return a; };
    out.push({ kind: `case ${i}`, tol, signA, signB, keys: { scales: take(ns * 4), translations: take(nt * 4), rotations: take(nr * 5) } });
  }
  return out;
}

export function decodeResults(bytes: Uint8Array): KeyArrays[] {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const dv = new DataView(buf);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "OKR1") throw new Error("not a results blob");
  const n = dv.getUint32(4, true);
  const out: KeyArrays[] = [];
  let p = 8;
  for (let i = 0; i < n; i++) {
    const ns = dv.getUint32(p, true), nt = dv.getUint32(p + 4, true), nr = dv.getUint32(p + 8, true);
    p += 12;
    const take = (count: number): Float32Array => { const a = new Float32Array(buf.slice(p, p + count * 4)); p += count * 4; return a; };
    out.push({ scales: take(ns * 4), translations: take(nt * 4), rotations: take(nr * 5) });
  }
  return out;
}

/** the results blob of the oracle, for the cases `cases` (the size of one results record) */
export function encodeResults(results: readonly KeyArrays[]): Uint8Array {
  let size = 8;
  for (const r of results) size += 12 + 4 * (r.scales.length + r.translations.length + r.rotations.length);
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  new Uint8Array(buf).set([0x4f, 0x4b, 0x52, 0x31]); // "OKR1"
  dv.setUint32(4, results.length, true);
  let p = 8;
  for (const r of results) {
    dv.setUint32(p, r.scales.length / 4, true); dv.setUint32(p + 4, r.translations.length / 4, true); dv.setUint32(p + 8, r.rotations.length / 5, true);
    p += 12;
    for (const a of [r.scales, r.translations, r.rotations]) { new Uint8Array(buf, p, a.length * 4).set(f32bytes(a)); p += a.length * 4; }
  }
  return new Uint8Array(buf);
}

export function encodeFixture(cases: readonly KeyCase[], results: readonly KeyArrays[]): Uint8Array {
  const a = encodeCases(cases), b = encodeResults(results);
  const out = new Uint8Array(4 + a.length + b.length);
  new DataView(out.buffer).setUint32(0, a.length, true);
  out.set(a, 4); out.set(b, 4 + a.length);
  return out;
}

export function decodeFixture(bytes: Uint8Array): { cases: KeyCase[]; results: KeyArrays[] } {
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  return { cases: decodeCases(bytes.subarray(4, 4 + len)), results: decodeResults(bytes.subarray(4 + len)) };
}

/** the first difference between two float arrays (bit for bit; NaN equals NaN), or null */
export function firstDiff(got: Float32Array, want: Float32Array, stride: number): string | null {
  if (got.length !== want.length) return `${got.length / stride} keys, expected ${want.length / stride}`;
  const g = new Uint32Array(got.buffer, got.byteOffset, got.length), w = new Uint32Array(want.buffer, want.byteOffset, want.length);
  for (let i = 0; i < g.length; i++) {
    if (g[i] === w[i] || (Number.isNaN(got[i]) && Number.isNaN(want[i]))) continue;
    return `key ${Math.floor(i / stride)} field ${i % stride}: ${got[i]} vs expected ${want[i]}`;
  }
  return null;
}
