/** Adler-32 (RFC 1950). KOM manifests store the Adler-32 of each entry's *stored* (pre-decrypt, compressed) bytes. */
export function adler32(data: Uint8Array, seed = 1): number {
  let a = seed & 0xffff;
  let b = (seed >>> 16) & 0xffff;
  const n = data.length;
  let i = 0;
  while (i < n) {
    const end = Math.min(i + 5552, n); // 5552 = largest block that cannot overflow 32 bits
    for (; i < end; i++) {
      a += data[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}
