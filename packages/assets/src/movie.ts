/**
 * `data/movie/*.avi` as the engine sees them: an AVI file with one MPEG-1 video stream, played through Bandisoft's bdvid32.dll
 * (`CKTDGUIControl::CMovieData`, x2.exe.c L367000): open the file, read the video info, then fetch frames at the movie's rate.
 * This class is the decoding half of that: random access by frame number and sequential decoding; the clock lives in the engine.
 */
import { parseAvi, streamChunks } from "./avi.ts";
import type { AviFile } from "./avi.ts";
import { Mpeg1Decoder } from "./mpeg1.ts";
import type { Mpeg1Frame } from "./mpeg1.ts";

export interface MovieInfo {
  width: number;
  height: number;
  frameCount: number;
  /** frames per second as a fraction (24 / 1 for the shipped files) */
  frameRate: { num: number; den: number };
  durationMs: number;
}

export class Mpeg1Movie {
  readonly info: MovieInfo;
  private readonly chunks: Uint8Array[];
  /** chunk indices where decoding can start (pictures that come with a sequence header and are intra coded) */
  private readonly entryPoints: number[] = [];
  private readonly hasBPictures: boolean;
  private decoder = new Mpeg1Decoder();
  /** the picture `next()` returns next (-1: nothing decoded yet) */
  private nextIndex = -1;
  private queue: Mpeg1Frame[] = [];
  private nextChunk = 0;

  private constructor(readonly avi: AviFile, videoStream: number) {
    this.chunks = streamChunks(avi, videoStream);
    const s = avi.streams[videoStream]!;
    let b = false;
    this.chunks.forEach((c, i) => {
      const t = pictureType(c);
      if (t === 3) b = true;
      if (t === 1 && hasSequenceHeader(c)) this.entryPoints.push(i);
    });
    this.hasBPictures = b;
    const bih = new DataView(s.format.buffer, s.format.byteOffset, s.format.byteLength);
    const width = s.format.length >= 12 ? bih.getInt32(4, true) : avi.width;
    const height = s.format.length >= 12 ? Math.abs(bih.getInt32(8, true)) : avi.height;
    const rate = s.rate && s.scale ? { num: s.rate, den: s.scale } : { num: 1_000_000, den: avi.microSecPerFrame || 41666 };
    this.info = { width, height, frameCount: this.chunks.length, frameRate: rate, durationMs: (this.chunks.length * 1000 * rate.den) / rate.num };
  }

  static open(bytes: Uint8Array): Mpeg1Movie {
    const avi = parseAvi(bytes);
    const v = avi.streams.findIndex((s) => s.type === "vids");
    if (v < 0) throw new Error("the AVI file has no video stream");
    return new Mpeg1Movie(avi, v);
  }

  /** Position the decoder so that `next()` returns picture `index` (clamped to the movie). */
  seek(index: number): void {
    index = Math.max(0, Math.min(this.info.frameCount, index | 0));
    // decoding forward from here reaches any later picture; jump to an entry point only when that skips pictures
    if (this.nextIndex >= 0 && index >= this.nextIndex && (this.hasBPictures || this.entryPointFor(index) <= this.nextChunk)) {
      while (this.nextIndex < index && this.next()) { /* decode forward */ }
      return;
    }
    const start = this.hasBPictures ? 0 : this.entryPointFor(index);
    this.decoder = new Mpeg1Decoder();
    this.queue = [];
    this.nextChunk = start;
    this.nextIndex = start;
    while (this.nextIndex < index && this.next()) { /* discard up to the target */ }
  }

  /** The next picture in display order, or null at the end of the movie. */
  next(): Mpeg1Frame | null {
    if (this.nextIndex < 0) this.seek(0);
    while (this.queue.length === 0) {
      if (this.nextChunk < this.chunks.length) this.queue.push(...this.decoder.decode(this.chunks[this.nextChunk++]!));
      else if (this.nextChunk === this.chunks.length) { this.nextChunk++; this.queue.push(...this.decoder.flush()); if (this.queue.length === 0) return null; }
      else return null;
    }
    this.nextIndex++;
    return this.queue.shift()!;
  }

  /** Picture `index` (random access: decoding restarts at the preceding entry point). */
  frame(index: number): Mpeg1Frame | null {
    if (index < 0 || index >= this.info.frameCount) return null;
    this.seek(index);
    return this.next();
  }

  /** The index of the picture `next()` returns next. */
  get position(): number { return Math.max(0, this.nextIndex); }

  private entryPointFor(index: number): number {
    let best = 0;
    for (const e of this.entryPoints) { if (e <= index) best = e; else break; }
    return best;
  }
}

/** `picture_coding_type` of the first picture in a chunk (0 if there is none) */
function pictureType(c: Uint8Array): number {
  for (let i = 0; i + 6 <= c.length; i++) {
    if (c[i] === 0 && c[i + 1] === 0 && c[i + 2] === 1 && c[i + 3] === 0) return (c[i + 5]! >> 3) & 7;
  }
  return 0;
}

function hasSequenceHeader(c: Uint8Array): boolean {
  for (let i = 0; i + 4 <= c.length && i < 64; i++) if (c[i] === 0 && c[i + 1] === 0 && c[i + 2] === 1 && c[i + 3] === 0xb3) return true;
  return false;
}
