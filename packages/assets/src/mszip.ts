/**
 * MSZIP container of DirectX `.x` files written with the compressed format (`xof 0303bzip0032` / `tzip`).
 *
 * Layout (checked on all 25,204 compressed entries of the client, see tools/verify-xfiles.ts):
 *   0x00  char[16]  "xof 0303bzip0032"  (format word "bzip" = binary + MSZIP, "tzip" = text + MSZIP; float size 32 or 64)
 *   0x10  u32       total size of the decompressed file *including* its 16-byte header
 *   0x14  chunks:   u16 uncompressed size (<= 32768), u16 compressed size (the 'CK' signature + deflate data), "CK", raw deflate
 * Every chunk is a raw deflate stream whose back-references may reach into the previous 32 KiB of output (the MSZIP / CAB rule);
 * inflate.ts decodes straight into the output buffer and stops after the chunk's declared size (51 shipped files have chunks
 * whose last deflate block is not flagged final). The decompressed file gets the header with the format word replaced by
 * "bin " / "txt ".
 */
import { inflateInto, InflateError } from "./inflate.ts";

export class MszipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MszipError";
  }
}

const WINDOW = 32768;

export function isCompressedXFile(b: Uint8Array): boolean {
  return b.length >= 20 && b[0] === 0x78 && b[1] === 0x6f && b[2] === 0x66 && b[3] === 0x20 &&
    ((b[8] === 0x62 || b[8] === 0x74) && b[9] === 0x7a && b[10] === 0x69 && b[11] === 0x70);
}

/** Decompress a `bzip` / `tzip` X file into the equivalent `bin ` / `txt ` file. */
export function decompressXFile(b: Uint8Array): Uint8Array {
  if (!isCompressedXFile(b)) throw new MszipError("not a compressed X file");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const total = dv.getUint32(16, true);
  if (total < 16 || total > 1 << 30) throw new MszipError(`implausible decompressed size ${total}`);
  const out = new Uint8Array(total);
  out.set(b.subarray(0, 16), 0);
  out[8] = b[8] === 0x62 ? 0x62 : 0x74; // 'b' / 't'
  out[9] = b[8] === 0x62 ? 0x69 : 0x78; // 'i' / 'x'
  out[10] = b[8] === 0x62 ? 0x6e : 0x74; // 'n' / 't'
  out[11] = 0x20;
  let o = 16;
  let p = 20;
  while (o < total) {
    if (p + 4 > b.length) throw new MszipError("truncated chunk header");
    const rawSize = b[p]! | (b[p + 1]! << 8);
    const packed = b[p + 2]! | (b[p + 3]! << 8);
    p += 4;
    if (packed < 2 || p + packed > b.length) throw new MszipError("chunk exceeds the file");
    if (b[p] !== 0x43 || b[p + 1] !== 0x4b) throw new MszipError("missing CK signature");
    if (rawSize > WINDOW || o + rawSize > total) throw new MszipError(`chunk of ${rawSize} bytes overruns the declared size`);
    try {
      inflateInto(b, p + 2, p + packed, out, o, rawSize, Math.max(16, o - WINDOW));
    } catch (e) {
      if (e instanceof InflateError) throw new MszipError(`chunk at offset ${p}: ${e.message}`);
      throw e;
    }
    o += rawSize;
    p += packed;
  }
  if (p !== b.length) throw new MszipError(`${b.length - p} trailing bytes after the last chunk`);
  return out;
}
