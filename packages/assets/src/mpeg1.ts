/**
 * MPEG-1 video decoder (ISO/IEC 11172-2), for the character-creation movies in `data/movie` (30 AVI files, fourcc `MPG1`, 400x220, 24 fps).
 *
 * The exe plays them through the closed library `bdvid32.dll` (Bandisoft; `CKTDGUIControl::CMovieData`, x2.exe.c L367000 / L368330 /
 * L368902), so there is no decoder code to port: this is a decoder of the standard.  It handles I, P and B pictures (the movies only
 * contain I and P) and everything the syntax allows below MPEG-2: custom quantiser matrices, any size, full-pel vectors, several slices
 * per row, skipped macroblocks, picture re-ordering.  D pictures (DC only, never used) are rejected.
 *
 * What is normative and what is a choice:
 *  - bit stream parsing, dequantisation (with the odd-value mismatch control), motion vectors, half-pel averaging `(a + b + 1) >> 1` /
 *    `(a + b + c + d + 2) >> 2`, bidirectional `(f + b + 1) >> 1` and chroma vectors (luma vector / 2, truncated toward zero) are fixed by the
 *    standard;
 *  - the IDCT is a choice (the standard only bounds its error, IEEE 1180): this is the 16 bit integer "simple" IDCT that libavcodec uses,
 *    so pictures can be compared sample for sample with FFmpeg (tools/verify-mpeg1.ts); another decoder may differ by one in the last bit
 *    and the differences accumulate along P pictures, invisibly;
 *  - the YUV -> RGB conversion of `bdvid32.dll` is unknown: `yuv420ToBgra` uses ITU-R BT.601 limited range and replicates chroma samples
 *    (docs/FINDINGS.md section 13).
 *
 * Each call of `decode` takes whole pictures (an AVI chunk holds one, with its sequence / GOP headers when it is an I picture); pictures
 * come out in display order, so with B pictures a reference is held back until the next one has been decoded (`flush` releases it).
 *
 * Verified against libavcodec (through PyAV, tools/oracle-mpeg1.py): tools/verify-mpeg1.ts decodes all 30 shipped movies and every one of
 * the 18,514 pictures is sample for sample identical; packages/assets/test/mpeg1.test.ts does the same for synthetic streams with B pictures,
 * custom matrices, odd sizes, large vectors, quantiser changes, 16 bit escapes, long skip runs and full-pel vectors, plus hand made streams
 * for slices that start inside a row.  Not covered by any oracle: vectors that point outside the coded picture (the standard forbids them;
 * here the reference is read with replicated edge samples, libavcodec skips the prediction) and, for matrices with entries below 6, the
 * result of a coefficient that dequantises to 0 (the standard: stays 0; libavcodec's `(v - 1) | 1` makes it +-1).
 */
import {
  CODED_BLOCK_PATTERN, DC_SIZE_CHROMA, DC_SIZE_LUMA, DEFAULT_INTRA_MATRIX, MB_ADDR_INCR, MB_BACKWARD, MB_FORWARD, MB_INTRA, MB_PATTERN, MB_QUANT,
  MB_TYPE_B, MB_TYPE_I, MB_TYPE_P, MOTION_CODE, RL_EOB, RL_ESCAPE, RUN_LEVEL,
} from "./mpeg1-tables.ts";

export class Mpeg1Error extends Error {}

// ------------------------------------------------------------------------------------------------------------------ tables
interface Vlc { readonly bits: number; readonly table: Int32Array }

/** Lookup table of 2^maxBits entries: (value << 8) | length; 0 = not a code. */
function buildVlc(codes: ReadonlyArray<readonly number[]>, values: ReadonlyArray<number>): Vlc {
  const bits = Math.max(...codes.map((c) => c[1]!));
  const table = new Int32Array(1 << bits);
  codes.forEach((c, i) => {
    const code = c[0]!, len = c[1]!;
    const lo = code << (bits - len);
    for (let k = 0; k < 1 << (bits - len); k++) {
      if (table[lo + k] !== 0) throw new Error("MPEG-1 VLC table is not a prefix code");
      table[lo + k] = (values[i]! << 8) | len;
    }
  });
  return { bits, table };
}
const seq = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

const MBA_ESCAPE = 34, MBA_STUFFING = 35;
const VLC_MBA = buildVlc(MB_ADDR_INCR, MB_ADDR_INCR.map((_, i) => (i < 33 ? i + 1 : i === 33 ? MBA_ESCAPE : MBA_STUFFING)));
const VLC_CBP = buildVlc(CODED_BLOCK_PATTERN, seq(64));
const VLC_MV = buildVlc(MOTION_CODE, seq(17));
const VLC_DC_LUMA = buildVlc(DC_SIZE_LUMA, seq(12));
const VLC_DC_CHROMA = buildVlc(DC_SIZE_CHROMA, seq(12));
const VLC_MBTYPE = [
  null,
  buildVlc(MB_TYPE_I, MB_TYPE_I.map((e) => e[2])),
  buildVlc(MB_TYPE_P, MB_TYPE_P.map((e) => e[2])),
  buildVlc(MB_TYPE_B, MB_TYPE_B.map((e) => e[2])),
];
/** DCT coefficients: entry = length | level << 8 | run << 16; run 200 = end of block, 201 = escape. */
const RL_BITS = 16;
const RL_TABLE = (() => {
  const t = new Int32Array(1 << RL_BITS);
  const put = (code: number, len: number, run: number, level: number): void => {
    const lo = code << (RL_BITS - len);
    for (let k = 0; k < 1 << (RL_BITS - len); k++) {
      if (t[lo + k] !== 0) throw new Error("MPEG-1 DCT table is not a prefix code");
      t[lo + k] = len | (level << 8) | (run << 16);
    }
  };
  for (const [code, len, run, level] of RUN_LEVEL) put(code, len, run, level);
  put(RL_ESCAPE[0], RL_ESCAPE[1], 201, 0);
  put(RL_EOB[0], RL_EOB[1], 200, 0);
  return t;
})();

/** zigzag position -> raster index */
export const ZIGZAG: ReadonlyArray<number> = (() => {
  const z: number[] = [];
  let x = 0, y = 0, up = true;
  for (let i = 0; i < 64; i++) {
    z.push(y * 8 + x);
    if (up) { if (x === 7) { y++; up = false; } else if (y === 0) { x++; up = false; } else { x++; y--; } }
    else if (y === 7) { x++; up = true; } else if (x === 0) { y++; up = true; } else { x--; y++; }
  }
  return z;
})();

// ----------------------------------------------------------------------------------------------------------- bit reader
class BitReader {
  pos = 0; // in bits
  constructor(readonly data: Uint8Array, readonly end = data.length * 8) {}
  /** the next n (1..24) bits without consuming them; reads past the end give zeros */
  peek(n: number): number {
    const p = this.pos >>> 3, d = this.data;
    const v = (((d[p] ?? 0) << 24) | ((d[p + 1] ?? 0) << 16) | ((d[p + 2] ?? 0) << 8) | (d[p + 3] ?? 0)) >>> 0;
    return ((v << (this.pos & 7)) >>> 0) >>> (32 - n);
  }
  skip(n: number): void { this.pos += n; }
  read(n: number): number {
    if (n === 0) return 0;
    if (n <= 24) { const v = this.peek(n); this.pos += n; return v; }
    const hi = this.read(n - 16);
    return hi * 65536 + this.read(16);
  }
  bit(): number { const v = (this.data[this.pos >>> 3] ?? 0) >> (7 - (this.pos & 7)) & 1; this.pos++; return v; }
  vlc(v: Vlc): number {
    const e = v.table[this.peek(v.bits)]!;
    if (e === 0) throw new Mpeg1Error("invalid variable length code");
    this.pos += e & 0xff;
    return e >> 8;
  }
  get exhausted(): boolean { return this.pos >= this.end; }
}

/** offset of the next `00 00 01` at or after `from`, or -1 */
function findStartCode(d: Uint8Array, from: number): number {
  for (let i = from; i + 3 <= d.length;) {
    const c = d[i + 2]!;
    if (c > 1) i += 3;
    else if (c === 1 && d[i] === 0 && d[i + 1] === 0) return i;
    else i++;
  }
  return -1;
}

/**
 * Split an elementary stream into pictures: each piece holds one picture with the sequence / GOP headers in front of it (what an AVI chunk
 * of the shipped movies holds, and what `Mpeg1Decoder.decode` takes).
 */
export function splitPictures(es: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = -1, hasPicture = false;
  for (let pos = findStartCode(es, 0); pos >= 0; pos = findStartCode(es, pos + 4)) {
    const code = es[pos + 3]!;
    if (code !== 0xb3 && code !== 0xb8 && code !== 0x00) continue;
    if (hasPicture) { out.push(es.subarray(start, pos)); start = pos; hasPicture = false; }
    else if (start < 0) start = pos;
    if (code === 0x00) hasPicture = true;
  }
  if (start >= 0 && hasPicture) out.push(es.subarray(start));
  return out;
}

// -------------------------------------------------------------------------------------------------------------- IDCT
// The "simple" 16 bit IDCT (rows with 11 bit, columns with 20 bit scaling; W_k = round(sqrt(2) * cos(k pi / 16) * 2^14)).
const W1 = 22725, W2 = 21407, W3 = 19266, W4 = 16383, W5 = 12873, W6 = 8867, W7 = 4520;
const ROW_SHIFT = 11, COL_SHIFT = 20;

/** In place on 64 coefficients (raster order); afterwards `b` holds the residual samples (not clipped).  With an Int16Array the row pass wraps at 16 bits like the C code. */
export function inverseDct(b: Int16Array | Int32Array): void {
  for (let r = 0; r < 64; r += 8) {
    const r0 = b[r]!, r1 = b[r + 1]!, r2 = b[r + 2]!, r3 = b[r + 3]!, r4 = b[r + 4]!, r5 = b[r + 5]!, r6 = b[r + 6]!, r7 = b[r + 7]!;
    if ((r1 | r2 | r3 | r4 | r5 | r6 | r7) === 0) {
      const v = (r0 << 3) << 16 >> 16; // the DC shortcut keeps 16 bits
      b[r] = b[r + 1] = b[r + 2] = b[r + 3] = b[r + 4] = b[r + 5] = b[r + 6] = b[r + 7] = v;
      continue;
    }
    let a0 = W4 * r0 + (1 << (ROW_SHIFT - 1));
    let a1 = a0, a2 = a0, a3 = a0;
    a0 += W2 * r2; a1 += W6 * r2; a2 -= W6 * r2; a3 -= W2 * r2;
    let b0 = W1 * r1 + W3 * r3;
    let b1 = W3 * r1 - W7 * r3;
    let b2 = W5 * r1 - W1 * r3;
    let b3 = W7 * r1 - W5 * r3;
    if ((r4 | r5 | r6 | r7) !== 0) {
      a0 += W4 * r4 + W6 * r6; a1 += -W4 * r4 - W2 * r6; a2 += -W4 * r4 + W2 * r6; a3 += W4 * r4 - W6 * r6;
      b0 += W5 * r5 + W7 * r7; b1 += -W1 * r5 - W5 * r7; b2 += W7 * r5 + W3 * r7; b3 += W3 * r5 - W1 * r7;
    }
    b[r] = (a0 + b0) >> ROW_SHIFT; b[r + 7] = (a0 - b0) >> ROW_SHIFT;
    b[r + 1] = (a1 + b1) >> ROW_SHIFT; b[r + 6] = (a1 - b1) >> ROW_SHIFT;
    b[r + 2] = (a2 + b2) >> ROW_SHIFT; b[r + 5] = (a2 - b2) >> ROW_SHIFT;
    b[r + 3] = (a3 + b3) >> ROW_SHIFT; b[r + 4] = (a3 - b3) >> ROW_SHIFT;
  }
  for (let c = 0; c < 8; c++) {
    const c0 = b[c]!, c1 = b[8 + c]!, c2 = b[16 + c]!, c3 = b[24 + c]!, c4 = b[32 + c]!, c5 = b[40 + c]!, c6 = b[48 + c]!, c7 = b[56 + c]!;
    let a0 = W4 * (c0 + ((1 << (COL_SHIFT - 1)) / W4 | 0));
    let a1 = a0, a2 = a0, a3 = a0;
    a0 += W2 * c2; a1 += W6 * c2; a2 -= W6 * c2; a3 -= W2 * c2;
    let b0 = W1 * c1 + W3 * c3;
    let b1 = W3 * c1 - W7 * c3;
    let b2 = W5 * c1 - W1 * c3;
    let b3 = W7 * c1 - W5 * c3;
    if (c4) { a0 += W4 * c4; a1 -= W4 * c4; a2 -= W4 * c4; a3 += W4 * c4; }
    if (c5) { b0 += W5 * c5; b1 -= W1 * c5; b2 += W7 * c5; b3 += W3 * c5; }
    if (c6) { a0 += W6 * c6; a1 -= W2 * c6; a2 += W2 * c6; a3 -= W6 * c6; }
    if (c7) { b0 += W7 * c7; b1 -= W5 * c7; b2 += W3 * c7; b3 -= W1 * c7; }
    b[c] = (a0 + b0) >> COL_SHIFT; b[56 + c] = (a0 - b0) >> COL_SHIFT;
    b[8 + c] = (a1 + b1) >> COL_SHIFT; b[48 + c] = (a1 - b1) >> COL_SHIFT;
    b[16 + c] = (a2 + b2) >> COL_SHIFT; b[40 + c] = (a2 - b2) >> COL_SHIFT;
    b[24 + c] = (a3 + b3) >> COL_SHIFT; b[32 + c] = (a3 - b3) >> COL_SHIFT;
  }
}

const clip8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------------------------------------------------------------------------------------------------------- public types
export interface Mpeg1SequenceInfo {
  width: number;
  height: number;
  /** `picture_rate` code and the rate it stands for (null for reserved codes) */
  frameRateCode: number;
  frameRate: { num: number; den: number } | null;
  aspectRatioCode: number;
  /** bits per second / 400, 0x3ffff = variable */
  bitRate: number;
  vbvBufferSize: number;
  constrainedParameters: boolean;
  /** the matrices in raster order (defaults unless the sequence header carries them) */
  intraMatrix: Uint8Array;
  nonIntraMatrix: Uint8Array;
}

export interface Mpeg1Frame {
  /** displayed size; the planes cover whole macroblocks */
  width: number;
  height: number;
  y: Uint8Array;
  cb: Uint8Array;
  cr: Uint8Array;
  strideY: number;
  strideC: number;
  /** 1 = I, 2 = P, 3 = B */
  pictureType: number;
  temporalReference: number;
}

function newStats(): Mpeg1Stats {
  return { pictures: [0, 0, 0, 0], slices: 0, macroblocks: 0, intra: 0, forward: 0, backward: 0, bidirectional: 0, skipped: 0, noVector: 0, quantChanges: 0, addrEscapes: 0, escapes: 0, escapes16: 0, fullPelPictures: 0, maxFCode: 0, outsideVectors: 0, customMatrices: 0 };
}

const FRAME_RATES: ReadonlyArray<{ num: number; den: number } | null> = [
  null, { num: 24000, den: 1001 }, { num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 50, den: 1 },
  { num: 60000, den: 1001 }, { num: 60, den: 1 },
];

// ------------------------------------------------------------------------------------------------------------- decoder
interface PictureState {
  frame: Mpeg1Frame;
  type: number;
  forward: Mpeg1Frame | null;
  backward: Mpeg1Frame | null;
  fullPelF: boolean; fCodeF: number;
  fullPelB: boolean; fCodeB: number;
}

/** What a decoder has met so far (the tests use it to check that a stream exercises the feature it is meant to). */
export interface Mpeg1Stats {
  pictures: [number, number, number, number]; // by picture_coding_type (index 0 unused)
  slices: number;
  macroblocks: number;
  intra: number;
  /** by prediction: forward only, backward only, both */
  forward: number; backward: number; bidirectional: number;
  skipped: number;
  /** coded macroblocks of P pictures without a vector (pattern only) */
  noVector: number;
  quantChanges: number;
  /** macroblock_escape codes (address increments above 33) */
  addrEscapes: number;
  escapes: number;
  /** escapes with a 16 bit level */
  escapes16: number;
  fullPelPictures: number;
  maxFCode: number;
  /** vectors that point (partly) outside the coded picture (the standard forbids them) */
  outsideVectors: number;
  customMatrices: number;
}

export class Mpeg1Decoder {
  info: Mpeg1SequenceInfo | null = null;
  stats: Mpeg1Stats = newStats();
  private mbW = 0;
  private mbH = 0;
  /** matrices in zigzag order, as the dequantiser walks them */
  private intraZ = new Int32Array(64);
  private nonIntraZ = new Int32Array(64);
  private refOld: Mpeg1Frame | null = null; // forward reference of B pictures
  private refNew: Mpeg1Frame | null = null; // most recent I / P picture
  private held: Mpeg1Frame | null = null; // reference waiting for display
  private pic: PictureState | null = null;
  private readonly block = new Int16Array(64); // 16 bit like libavcodec's blocks: out of range intermediate values wrap the same way
  private readonly tmp = new Uint8Array(16 * 16);
  private readonly tmp2 = new Uint8Array(16 * 16);
  // slice state
  private qscale = 1;
  private dcPred = [128, 128, 128];
  private mvF = [0, 0];
  private mvB = [0, 0];
  private prevFlags = 0;

  /** Decode every picture in `data` (whole pictures, optionally preceded by sequence and GOP headers); frames come out in display order. */
  decode(data: Uint8Array): Mpeg1Frame[] {
    const out: Mpeg1Frame[] = [];
    let pos = findStartCode(data, 0);
    while (pos >= 0) {
      const code = data[pos + 3]!;
      const next = findStartCode(data, pos + 4);
      const body = data.subarray(pos + 4, next < 0 ? data.length : next);
      if (code === 0xb3) { this.finishPicture(out); this.sequenceHeader(body); }
      else if (code === 0xb8 || code === 0xb7) this.finishPicture(out);
      else if (code === 0x00) { this.finishPicture(out); this.pictureHeader(body); }
      else if (code >= 0x01 && code <= 0xaf) { if (this.pic) this.slice(code - 1, body); }
      // 0xb2 user data, 0xb5 extension data and system codes: skipped
      pos = next;
    }
    this.finishPicture(out);
    return out;
  }

  /** The reference that was held back for display. */
  flush(): Mpeg1Frame[] {
    const out: Mpeg1Frame[] = [];
    if (this.held) out.push(this.held);
    this.held = null;
    return out;
  }

  resetStats(): void { this.stats = newStats(); }

  /** Forget the references (a seek, or a new stream); the sequence parameters stay. */
  reset(): void { this.refOld = this.refNew = this.held = null; this.pic = null; }

  // ------------------------------------------------------------------------------------------------------ headers
  private sequenceHeader(body: Uint8Array): void {
    const br = new BitReader(body);
    const width = br.read(12), height = br.read(12);
    const aspect = br.read(4), rateCode = br.read(4);
    const bitRate = br.read(18);
    if (!br.bit()) throw new Mpeg1Error("sequence header marker bit");
    const vbv = br.read(10);
    const constrained = br.bit() === 1;
    const intra = new Uint8Array(64), nonIntra = new Uint8Array(64);
    if (br.bit()) { for (let i = 0; i < 64; i++) intra[ZIGZAG[i]!] = br.read(8); this.stats.customMatrices++; }
    else intra.set(DEFAULT_INTRA_MATRIX);
    if (br.bit()) { for (let i = 0; i < 64; i++) nonIntra[ZIGZAG[i]!] = br.read(8); this.stats.customMatrices++; }
    else nonIntra.fill(16);
    if (width === 0 || height === 0) throw new Mpeg1Error("empty picture size");
    this.info = { width, height, frameRateCode: rateCode, frameRate: FRAME_RATES[rateCode] ?? null, aspectRatioCode: aspect, bitRate, vbvBufferSize: vbv, constrainedParameters: constrained, intraMatrix: intra, nonIntraMatrix: nonIntra };
    for (let i = 0; i < 64; i++) { this.intraZ[i] = intra[ZIGZAG[i]!]!; this.nonIntraZ[i] = nonIntra[ZIGZAG[i]!]!; }
    const mbW = (width + 15) >> 4, mbH = (height + 15) >> 4;
    if (mbW !== this.mbW || mbH !== this.mbH) { this.mbW = mbW; this.mbH = mbH; this.reset(); }
  }

  private pictureHeader(body: Uint8Array): void {
    if (!this.info) throw new Mpeg1Error("picture before the first sequence header");
    const br = new BitReader(body);
    const temporalReference = br.read(10), type = br.read(3);
    br.skip(16); // vbv_delay
    if (type < 1 || type > 3) throw new Mpeg1Error(type === 4 ? "D pictures are not supported" : `picture_coding_type ${type}`);
    let fullPelF = false, fCodeF = 1, fullPelB = false, fCodeB = 1;
    if (type >= 2) { fullPelF = br.bit() === 1; fCodeF = br.read(3); if (fCodeF === 0) throw new Mpeg1Error("forward_f_code 0"); }
    if (type === 3) { fullPelB = br.bit() === 1; fCodeB = br.read(3); if (fCodeB === 0) throw new Mpeg1Error("backward_f_code 0"); }
    const st = this.stats;
    st.pictures[type]!++;
    if (fullPelF || fullPelB) st.fullPelPictures++;
    st.maxFCode = Math.max(st.maxFCode, type >= 2 ? fCodeF : 0, type === 3 ? fCodeB : 0);
    const forward = type === 2 ? this.refNew : type === 3 ? this.refOld : null;
    const backward = type === 3 ? this.refNew : null;
    if ((type === 2 && !forward) || (type === 3 && (!forward || !backward))) { this.pic = null; return; } // no reference to predict from: skip the picture
    const frame: Mpeg1Frame = {
      width: this.info.width, height: this.info.height,
      y: new Uint8Array(this.mbW * 16 * this.mbH * 16), cb: new Uint8Array(this.mbW * 8 * this.mbH * 8), cr: new Uint8Array(this.mbW * 8 * this.mbH * 8),
      strideY: this.mbW * 16, strideC: this.mbW * 8, pictureType: type, temporalReference,
    };
    this.pic = { frame, type, forward, backward, fullPelF, fCodeF, fullPelB, fCodeB };
  }

  private finishPicture(out: Mpeg1Frame[]): void {
    const p = this.pic;
    if (!p) return;
    this.pic = null;
    if (p.type === 3) { out.push(p.frame); return; }
    if (this.held) out.push(this.held);
    this.held = p.frame;
    this.refOld = this.refNew;
    this.refNew = p.frame;
  }

  // ------------------------------------------------------------------------------------------------------- slices
  private slice(row: number, body: Uint8Array): void {
    const p = this.pic!;
    if (row >= this.mbH) return;
    const br = new BitReader(body);
    this.stats.slices++;
    this.qscale = br.read(5);
    if (this.qscale === 0) throw new Mpeg1Error("quantiser_scale 0");
    while (br.bit()) br.skip(8); // extra_information_slice
    this.dcPred[0] = this.dcPred[1] = this.dcPred[2] = 128;
    this.mvF[0] = this.mvF[1] = this.mvB[0] = this.mvB[1] = 0;
    this.prevFlags = 0;
    let addr = row * this.mbW - 1;
    for (let first = true; ; first = false) {
      // address increment, with stuffing and escapes
      let incr = 0;
      for (;;) {
        const v = br.vlc(VLC_MBA);
        if (v === MBA_STUFFING) continue;
        if (v === MBA_ESCAPE) { incr += 33; this.stats.addrEscapes++; continue; }
        incr += v;
        break;
      }
      if (incr > 1) {
        if (first) addr += incr - 1; // the slice starts further right
        else for (let k = 1; k < incr; k++) { addr++; if (addr < this.mbW * this.mbH) this.skipped(p, addr); }
      }
      addr++;
      if (addr >= this.mbW * this.mbH) throw new Mpeg1Error("macroblock address out of range");
      this.macroblock(p, br, addr);
      if (br.peek(23) === 0 || br.pos >= br.end) break; // next start code
    }
  }

  /** A skipped macroblock: P = copy with a zero vector, B = the previous prediction again. */
  private skipped(p: PictureState, addr: number): void {
    this.dcPred[0] = this.dcPred[1] = this.dcPred[2] = 128;
    const mbx = addr % this.mbW, mby = (addr / this.mbW) | 0;
    this.stats.skipped++;
    if (p.type === 2) {
      this.mvF[0] = this.mvF[1] = 0;
      this.predict(p, mbx, mby, MB_FORWARD, 0, 0, 0, 0);
    } else {
      const flags = this.prevFlags & (MB_FORWARD | MB_BACKWARD);
      this.predict(p, mbx, mby, flags || MB_FORWARD, this.mvF[0]!, this.mvF[1]!, this.mvB[0]!, this.mvB[1]!);
    }
  }

  private macroblock(p: PictureState, br: BitReader, addr: number): void {
    const mbx = addr % this.mbW, mby = (addr / this.mbW) | 0;
    const flags = br.vlc(VLC_MBTYPE[p.type]!);
    const st = this.stats;
    st.macroblocks++;
    if (flags & MB_QUANT) {
      this.qscale = br.read(5);
      if (this.qscale === 0) throw new Mpeg1Error("quantiser_scale 0");
      st.quantChanges++;
    }
    const intra = (flags & MB_INTRA) !== 0;
    if (intra) st.intra++;
    else if ((flags & (MB_FORWARD | MB_BACKWARD)) === (MB_FORWARD | MB_BACKWARD)) st.bidirectional++;
    else if (flags & MB_FORWARD) st.forward++;
    else if (flags & MB_BACKWARD) st.backward++;
    else st.noVector++;
    let fx = 0, fy = 0, bx = 0, by = 0;
    if (flags & MB_FORWARD) {
      this.mvF[0] = this.motionVector(br, this.mvF[0]!, p.fCodeF);
      this.mvF[1] = this.motionVector(br, this.mvF[1]!, p.fCodeF);
      fx = this.mvF[0]! * (p.fullPelF ? 2 : 1); fy = this.mvF[1]! * (p.fullPelF ? 2 : 1);
    } else if (p.type === 2) this.mvF[0] = this.mvF[1] = 0; // P without a vector: zero, and the predictor is reset
    if (flags & MB_BACKWARD) {
      this.mvB[0] = this.motionVector(br, this.mvB[0]!, p.fCodeB);
      this.mvB[1] = this.motionVector(br, this.mvB[1]!, p.fCodeB);
      bx = this.mvB[0]! * (p.fullPelB ? 2 : 1); by = this.mvB[1]! * (p.fullPelB ? 2 : 1);
    }
    let cbp = 0;
    if (flags & MB_PATTERN) cbp = br.vlc(VLC_CBP);
    if (intra) {
      cbp = 63;
      this.mvF[0] = this.mvF[1] = this.mvB[0] = this.mvB[1] = 0;
    } else {
      this.dcPred[0] = this.dcPred[1] = this.dcPred[2] = 128;
      if (p.type === 2) this.predict(p, mbx, mby, MB_FORWARD, fx, fy, 0, 0);
      else this.predict(p, mbx, mby, flags & (MB_FORWARD | MB_BACKWARD), fx, fy, bx, by);
    }
    this.prevFlags = flags;
    const f = p.frame;
    const b = this.block;
    for (let i = 0; i < 6; i++) {
      if (!(cbp & (32 >> i))) continue;
      b.fill(0);
      this.readBlock(br, i, intra, b);
      inverseDct(b);
      let plane: Uint8Array, stride: number, x: number, y: number;
      if (i < 4) { plane = f.y; stride = f.strideY; x = mbx * 16 + (i & 1) * 8; y = mby * 16 + (i >> 1) * 8; }
      else { plane = i === 4 ? f.cb : f.cr; stride = f.strideC; x = mbx * 8; y = mby * 8; }
      let o = y * stride + x;
      if (intra) for (let r = 0; r < 8; r++, o += stride) for (let c = 0; c < 8; c++) plane[o + c] = clip8(b[r * 8 + c]!);
      else for (let r = 0; r < 8; r++, o += stride) for (let c = 0; c < 8; c++) plane[o + c] = clip8(plane[o + c]! + b[r * 8 + c]!);
    }
  }

  /** `motion_code` + `motion_residual` against the predictor; returns the new predictor (in the units of the picture: full or half pels) */
  private motionVector(br: BitReader, pred: number, fCode: number): number {
    let code = br.vlc(VLC_MV);
    if (code !== 0 && br.bit()) code = -code;
    const rSize = fCode - 1;
    let delta = code;
    if (rSize > 0 && code !== 0) {
      const residual = br.read(rSize);
      delta = ((Math.abs(code) - 1) << rSize) + residual + 1;
      if (code < 0) delta = -delta;
    }
    const f = 1 << rSize;
    let v = pred + delta;
    if (v < -16 * f) v += 32 * f; else if (v > 16 * f - 1) v -= 32 * f;
    return v;
  }

  // ------------------------------------------------------------------------------------------------------- blocks
  /** coefficients of one block into `b` (raster order, dequantised) */
  private readBlock(br: BitReader, index: number, intra: boolean, b: Int16Array): void {
    let i = 0;
    if (intra) {
      const comp = index < 4 ? 0 : index - 3;
      const size = br.vlc(index < 4 ? VLC_DC_LUMA : VLC_DC_CHROMA);
      let diff = 0;
      if (size) {
        diff = br.read(size);
        if (!(diff & (1 << (size - 1)))) diff -= (1 << size) - 1;
      }
      this.dcPred[comp] = this.dcPred[comp]! + diff;
      b[0] = this.dcPred[comp]! * 8;
      i = 1;
    }
    const qs = this.qscale;
    const matrix = intra ? this.intraZ : this.nonIntraZ;
    for (let first = true; ; first = false) {
      let run: number, level: number, negative: boolean;
      if (first && !intra && br.peek(1) === 1) { // the first coefficient of an inter block: `1s` is run 0, level 1
        br.skip(1); run = 0; level = 1; negative = br.bit() === 1;
      } else {
        const e = RL_TABLE[br.peek(RL_BITS)]!;
        if (e === 0) throw new Mpeg1Error("invalid DCT coefficient code");
        run = e >> 16;
        if (run === 200) { br.skip(2); return; } // end of block
        if (run === 201) { // escape: 6 bit run, 8 or 16 bit signed level
          br.skip(6);
          run = br.read(6);
          level = br.read(8);
          this.stats.escapes++;
          if (level === 0 || level === 128) this.stats.escapes16++;
          if (level === 0) level = br.read(8);
          else if (level === 128) level = br.read(8) - 256;
          else if (level > 128) level -= 256;
          negative = level < 0;
          if (negative) level = -level;
        } else {
          br.skip(e & 0xff);
          level = (e >> 8) & 0xff;
          negative = br.bit() === 1;
        }
      }
      i += run;
      if (i > 63) throw new Mpeg1Error("coefficient index beyond the block");
      let v = intra ? (level * qs * matrix[i]!) >> 3 : (((level << 1) + 1) * qs * matrix[i]!) >> 4;
      if (v !== 0 && (v & 1) === 0) v--; // mismatch control: every coefficient is odd
      if (negative) v = -v;
      b[ZIGZAG[i]!] = v < -2048 ? -2048 : v > 2047 ? 2047 : v;
      i++;
    }
  }

  // ------------------------------------------------------------------------------------------- motion compensation
  /** Write the prediction of the macroblock into the current frame (`mode` has MB_FORWARD and / or MB_BACKWARD; vectors in half pels). */
  private predict(p: PictureState, mbx: number, mby: number, mode: number, fx: number, fy: number, bx: number, by: number): void {
    const f = p.frame;
    const fw = (mode & MB_FORWARD) !== 0 ? p.forward : null, bw = (mode & MB_BACKWARD) !== 0 ? p.backward : null;
    const W = this.mbW * 16, H = this.mbH * 16;
    this.predictBlock(f.y, f.strideY, mbx * 16, mby * 16, 16, W, H, fw?.y ?? null, bw?.y ?? null, fx, fy, bx, by);
    // chroma: the luma vector halved, truncated toward zero, in half chroma samples
    const cfx = (fx / 2) | 0, cfy = (fy / 2) | 0, cbx = (bx / 2) | 0, cby = (by / 2) | 0;
    this.predictBlock(f.cb, f.strideC, mbx * 8, mby * 8, 8, W >> 1, H >> 1, fw?.cb ?? null, bw?.cb ?? null, cfx, cfy, cbx, cby);
    this.predictBlock(f.cr, f.strideC, mbx * 8, mby * 8, 8, W >> 1, H >> 1, fw?.cr ?? null, bw?.cr ?? null, cfx, cfy, cbx, cby);
  }

  /** A `size` x `size` block at (x, y) of `dst`, predicted from one reference or averaged from two: `(forward + backward + 1) >> 1`. */
  private predictBlock(dst: Uint8Array, stride: number, x: number, y: number, size: number, w: number, h: number,
    refF: Uint8Array | null, refB: Uint8Array | null, fx: number, fy: number, bx: number, by: number): void {
    if (refF && refB) {
      this.fetch(refF, stride, w, h, x, y, size, fx, fy, this.tmp, size, 0);
      this.fetch(refB, stride, w, h, x, y, size, bx, by, this.tmp2, size, 0);
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dst[(y + r) * stride + x + c] = (this.tmp[r * size + c]! + this.tmp2[r * size + c]! + 1) >> 1;
    } else if (refF) this.fetch(refF, stride, w, h, x, y, size, fx, fy, dst, stride, y * stride + x);
    else if (refB) this.fetch(refB, stride, w, h, x, y, size, bx, by, dst, stride, y * stride + x);
  }

  /** Half-pel motion compensated copy of a size x size block (references are clamped at the edges of the coded picture). */
  private fetch(ref: Uint8Array, stride: number, w: number, h: number, x: number, y: number, size: number, mvx: number, mvy: number,
    out: Uint8Array, outStride: number, outOffset: number): void {
    const hx = mvx & 1, hy = mvy & 1;
    const sx = x + (mvx >> 1), sy = y + (mvy >> 1);
    if (sx >= 0 && sy >= 0 && sx + size + hx <= w && sy + size + hy <= h) {
      for (let r = 0; r < size; r++) {
        let o = (sy + r) * stride + sx, q = outOffset + r * outStride;
        if (!hx && !hy) for (let c = 0; c < size; c++) out[q++] = ref[o++]!;
        else if (hx && !hy) for (let c = 0; c < size; c++, o++) out[q++] = (ref[o]! + ref[o + 1]! + 1) >> 1;
        else if (!hx && hy) for (let c = 0; c < size; c++, o++) out[q++] = (ref[o]! + ref[o + stride]! + 1) >> 1;
        else for (let c = 0; c < size; c++, o++) out[q++] = (ref[o]! + ref[o + 1]! + ref[o + stride]! + ref[o + stride + 1]! + 2) >> 2;
      }
      return;
    }
    this.stats.outsideVectors++;
    const px = (xx: number, yy: number): number => ref[(yy < 0 ? 0 : yy >= h ? h - 1 : yy) * stride + (xx < 0 ? 0 : xx >= w ? w - 1 : xx)]!;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const xx = sx + c, yy = sy + r;
        let v: number;
        if (!hx && !hy) v = px(xx, yy);
        else if (hx && !hy) v = (px(xx, yy) + px(xx + 1, yy) + 1) >> 1;
        else if (!hx && hy) v = (px(xx, yy) + px(xx, yy + 1) + 1) >> 1;
        else v = (px(xx, yy) + px(xx + 1, yy) + px(xx, yy + 1) + px(xx + 1, yy + 1) + 2) >> 2;
        out[outOffset + r * outStride + c] = v;
      }
    }
  }
}

/** The displayed part of the planes of a picture, without the padding up to whole macroblocks: Y (width x height), Cb and Cr ((w + 1) / 2 x (h + 1) / 2). */
export function visiblePlanes(f: Mpeg1Frame): [Uint8Array, Uint8Array, Uint8Array] {
  const cw = (f.width + 1) >> 1, ch = (f.height + 1) >> 1;
  const crop = (p: Uint8Array, stride: number, w: number, h: number): Uint8Array => {
    const o = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) o.set(p.subarray(r * stride, r * stride + w), r * w);
    return o;
  };
  return [crop(f.y, f.strideY, f.width, f.height), crop(f.cb, f.strideC, cw, ch), crop(f.cr, f.strideC, cw, ch)];
}

// ------------------------------------------------------------------------------------------------------ colour
/**
 * I420 -> BGRA (the byte order of a little endian D3DFMT_A8R8G8B8 / X8R8G8B8 texture), ITU-R BT.601 limited range, chroma replicated.
 * `out` has `width * height * 4` bytes (a new array when omitted).
 */
export function yuv420ToBgra(f: Mpeg1Frame, out: Uint8Array = new Uint8Array(f.width * f.height * 4)): Uint8Array {
  let o = 0;
  for (let y = 0; y < f.height; y++) {
    const yr = y * f.strideY, cr = (y >> 1) * f.strideC;
    for (let x = 0; x < f.width; x++) {
      const c = 298 * (f.y[yr + x]! - 16) + 128, d = f.cb[cr + (x >> 1)]! - 128, e = f.cr[cr + (x >> 1)]! - 128;
      out[o++] = clip8((c + 516 * d) >> 8);
      out[o++] = clip8((c - 100 * d - 208 * e) >> 8);
      out[o++] = clip8((c + 409 * e) >> 8);
      out[o++] = 255;
    }
  }
  return out;
}
