/**
 * Raw DEFLATE decoder that writes straight into a caller-owned output buffer and stops after a requested number of bytes.
 *
 * Why not fflate: MSZIP chunks (mszip.ts) back-reference the previous 32 KiB of *output*, which here is simply the bytes already
 * in `out`, and 50 shipped `.x` / `.y` files contain stored blocks without the NLEN complement (see the stored-block branch),
 * which a conforming inflater rejects. Decoding ends as soon as `limit` bytes have been produced.
 * Canonical-Huffman decoding after zlib's `puff.c`.
 */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huffman {
  count: Uint16Array; // number of codes of each length
  symbol: Uint16Array; // symbols ordered by code
}

function build(lengths: ArrayLike<number>, n: number): Huffman {
  const count = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]!]!++;
  const offs = new Uint16Array(16);
  for (let l = 1; l < 15; l++) offs[l + 1] = offs[l]! + count[l]!;
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]! !== 0) symbol[offs[lengths[i]!]!++] = i;
  return { count, symbol };
}

let fixedLit: Huffman | undefined;
let fixedDist: Huffman | undefined;
function fixedTables(): [Huffman, Huffman] {
  if (!fixedLit || !fixedDist) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    fixedLit = build(l, 288);
    fixedDist = build(new Uint8Array(30).fill(5), 30);
  }
  return [fixedLit, fixedDist];
}

export class InflateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InflateError";
  }
}

/**
 * Inflate the raw deflate stream `src[start, end)` into `out` starting at `outPos`, until `limit` bytes have been written
 * (`outPos + limit` is never exceeded). Back-references may reach down to `out[windowStart]`. Returns the output position reached
 * (always `outPos + limit` on success).
 */
export function inflateInto(src: Uint8Array, start: number, end: number, out: Uint8Array, outPos: number, limit: number, windowStart = 0): number {
  const outEnd = outPos + limit;
  let sp = start;
  let bitBuf = 0;
  let bitCnt = 0;
  const bits = (n: number): number => {
    while (bitCnt < n) {
      if (sp >= end) throw new InflateError("unexpected end of deflate data");
      bitBuf |= src[sp++]! << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const count = h.count[len]!;
      if (code - count < first) return h.symbol[index + (code - first)]!;
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new InflateError("invalid Huffman code");
  };

  let op = outPos;
  for (;;) {
    if (op >= outEnd) return op;
    const final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0; // discard the rest of the byte
      if (sp + 2 > end) throw new InflateError("truncated stored block");
      const len = src[sp]! | (src[sp + 1]! << 8);
      // Standard deflate: LEN, ~LEN, data. The MSZIP writer of the shipped `.x` files emits stored blocks (the incompressible tail
      // of a chunk) with LEN only, the data following directly; accept that form when the complement is absent.
      sp += sp + 4 <= end && (src[sp + 2]! | (src[sp + 3]! << 8)) === (len ^ 0xffff) ? 4 : 2;
      if (sp + len > end || op + len > outEnd) throw new InflateError("stored block overruns");
      out.set(src.subarray(sp, sp + len), op);
      sp += len; op += len;
    } else if (type === 1 || type === 2) {
      let lit: Huffman, dist: Huffman;
      if (type === 1) [lit, dist] = fixedTables();
      else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) throw new InflateError("bad dynamic block counts");
        const lengths = new Uint8Array(320);
        for (let i = 0; i < ncode; i++) lengths[CL_ORDER[i]!] = bits(3);
        const cl = build(lengths.subarray(0, 19), 19);
        let idx = 0;
        const all = new Uint8Array(nlen + ndist);
        while (idx < nlen + ndist) {
          const sym = decode(cl);
          if (sym < 16) all[idx++] = sym;
          else {
            let prev = 0, rep: number;
            if (sym === 16) {
              if (idx === 0) throw new InflateError("repeat with no previous length");
              prev = all[idx - 1]!; rep = 3 + bits(2);
            } else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (idx + rep > nlen + ndist) throw new InflateError("too many code lengths");
            while (rep--) all[idx++] = prev;
          }
        }
        lit = build(all.subarray(0, nlen), nlen);
        dist = build(all.subarray(nlen), ndist);
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) {
          if (op >= outEnd) throw new InflateError("output overrun");
          out[op++] = sym;
        } else if (sym === 256) break;
        else {
          const li = sym - 257;
          if (li >= 29) throw new InflateError("bad length symbol");
          const len = LEN_BASE[li]! + bits(LEN_EXTRA[li]!);
          const ds = decode(dist);
          if (ds >= 30) throw new InflateError("bad distance symbol");
          const d = DIST_BASE[ds]! + bits(DIST_EXTRA[ds]!);
          if (op - d < windowStart) throw new InflateError("distance reaches before the window");
          if (op + len > outEnd) throw new InflateError("output overrun");
          for (let i = 0; i < len; i++, op++) out[op] = out[op - d]!;
        }
        if (op >= outEnd) return op;
      }
    } else throw new InflateError("invalid block type 3");
    if (final) {
      if (op !== outEnd) throw new InflateError(`final block ended after ${op - outPos} of ${limit} bytes`);
      return op;
    }
  }
}
