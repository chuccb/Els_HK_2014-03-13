/**
 * The keys of a KAC animation as `ReadFromMemoryDeserializer` (32989F10) hands them to `RegisterAnimationSRTKeys`:
 * UnpackKeys (done by `parseKac`) -> OptimizeKeys (32988610, tolerance 0.001) -> D3DXKEY_VECTOR3 / D3DXKEY_QUATERNION arrays.
 */
import { quatNormalize } from "@els/d3d9";
import type { D3DXKeyQuaternion, D3DXKeyVector3 } from "@els/d3d9";
import type { KacAnimation } from "@els/assets";

export interface PreparedKeys { scales: D3DXKeyVector3[]; rotations: D3DXKeyQuaternion[]; translations: D3DXKeyVector3[] }

const v3 = (k: { time: number; value: [number, number, number] }): D3DXKeyVector3 => ({ Time: k.time, Value: { x: k.value[0], y: k.value[1], z: k.value[2] } });

/**
 * Rotation keys as OptimizeKeys leaves them when no key is dropped: with two or more keys every key is normalised and, walking forward, flipped
 * into the hemisphere of the previous key (so that the first key has w >= 0 and consecutive keys have a non-negative dot product).
 */
export function normalizeRotationKeys(keys: readonly { time: number; value: [number, number, number, number] }[]): D3DXKeyQuaternion[] {
  const out: D3DXKeyQuaternion[] = keys.map((k) => ({ Time: k.time, Value: { x: k.value[0], y: k.value[1], z: k.value[2], w: k.value[3] } }));
  if (out.length < 2) return out;
  let prev = quatNormalize(out[0]!.Value);
  if (prev.w < 0) prev = { x: -prev.x, y: -prev.y, z: -prev.z, w: -prev.w };
  out[0]!.Value = prev;
  for (let i = 1; i < out.length; i++) {
    let q = quatNormalize(out[i]!.Value);
    if (q.x * prev.x + q.y * prev.y + q.z * prev.z + q.w * prev.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
    out[i]!.Value = q;
    prev = q;
  }
  return out;
}

/** The keys of one animation (frame) ready for `RegisterAnimationSRTKeys`. */
export function prepareKeys(a: KacAnimation): PreparedKeys {
  return { scales: a.scales.map(v3), rotations: normalizeRotationKeys(a.rotations), translations: a.translations.map(v3) };
}
