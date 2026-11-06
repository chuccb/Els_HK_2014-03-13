/**
 * XORCRCDecrypt — the stream cipher applied to KOM entries whose manifest `Algorithm` is 2
 * (every `.lua`, `.txt` and `.kim` in this client).
 *
 * Ported from the inline copies in x2.exe.c, canonical one: `IncludeLua_` @328C2930
 * (x2.exe.c L284967–285434), with the key table `s_aiXorKeys` at x2.exe.c L37018 and the CRC-32
 * helper `CRC_32` @328E1700 (L311633).  Cross-checked against tools/luadecrypt.py (an independent
 * Python port) and by the Adler-32/size verification of all 4,539 algorithm-2 entries
 * (tools/verify-kom.ts).
 *
 * The plain data on disk is `zlib(deflate(content))`; this cipher is applied on top of the zlib stream,
 * so decoding is  inflate(xorCrcDecrypt(stored, name, csize)).
 */

/** s_aiXorKeys[5] (x2.exe.c L37018) — signed 32-bit values exactly as IDA prints them. */
const S_AI_XOR_KEYS = [-868397061, 1497161391, -817744418, -566968968, 1387481717] as const;
const KEY_MASK = 0x38d2dfa4;

/** Standard reflected CRC-32 table (poly 0xEDB88320), as used by CRC_32 @328E1700. */
export const CRC32_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** 20 key bytes: each s_aiXorKeys dword ^ 0x38D2DFA4, little endian. */
const KEY: Uint8Array = (() => {
  const k = new Uint8Array(20);
  const dv = new DataView(k.buffer);
  S_AI_XOR_KEYS.forEach((v, i) => dv.setUint32(i * 4, ((v >>> 0) ^ KEY_MASK) >>> 0, true));
  return k;
})();

function towlower(code: number): number {
  const s = String.fromCharCode(code).toLowerCase();
  return s.length === 1 ? s.charCodeAt(0) : code;
}

/**
 * Decrypts `data` (the first `csize` bytes) and returns a new array.
 * `name` is the entry name from the KOM manifest (case-insensitive: the cipher lower-cases it),
 * `csize` is the manifest `CompressedSize`.
 */
export function xorCrcDecrypt(data: Uint8Array, name: string, csize: number): Uint8Array {
  // Seed material: lower-cased UTF-16 name (low byte, plus high byte only when non-zero; at most 260
  // characters) followed by the little-endian bytes of csize (trailing zero bytes dropped, at most 4).
  const seed: number[] = [];
  const nameLen = Math.min(name.length, 260);
  for (let i = 0; i < nameLen; i++) {
    const c = towlower(name.charCodeAt(i));
    seed.push(c & 0xff);
    if (c >>> 8) seed.push(c >>> 8);
  }
  let v = csize >>> 0;
  for (let i = 0; i < 4 && v !== 0; i++) {
    seed.push(v & 0xff);
    v >>>= 8;
  }

  const n = seed.length;
  let state = 0xffffffff;
  let ki = 0;
  for (let i = 0; i < n; i++) {
    state = (CRC32_TABLE[(state & 0xff) ^ (seed[i]! ^ KEY[ki]!)]! ^ (state >>> 8)) >>> 0;
    ki = ki === 19 ? 0 : ki + 1;
  }

  // Key rotated left by n % 20.
  const rot = n % 20;
  const rkey = new Uint8Array(20);
  for (let i = 0; i < 20; i++) rkey[i] = KEY[(i + rot) % 20]!;

  const out = new Uint8Array(data);
  const count = Math.min(csize, out.length);
  ki = 0;
  for (let i = 0; i < count; i++) {
    const k = (state & 0xff) ^ rkey[ki]!;
    const t = k ^ (~out[i]! & 0xff);
    const T = CRC32_TABLE[t]!;
    out[i] = (T ^ k) & 0xff;
    state = ((((T & 0xffffff00) | t) ^ (state >>> 8)) >>> 0);
    ki = ki === 19 ? 0 : ki + 1;
  }
  return out;
}
