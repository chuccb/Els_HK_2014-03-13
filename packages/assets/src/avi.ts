/**
 * RIFF AVI demuxer: the stream headers and the chunk list of the `movi` list.  Only what the shipped movies need is interpreted
 * (`data/movie/*.avi`: one `vids` stream with the handler `MPG1`, 24 fps, no audio, a `JUNK` chunk after the headers), but the structure is
 * walked generally: nested `LIST`s, `rec ` lists, odd sized chunks padded to even offsets, a trailing `idx1` (read for the key frame flags).
 */

export class AviError extends Error {}

export interface AviStream {
  index: number;
  /** `vids`, `auds`, `txts` ... */
  type: string;
  /** codec fourcc of the stream (`MPG1`) */
  handler: string;
  /** frames per second = rate / scale */
  rate: number;
  scale: number;
  length: number;
  /** BITMAPINFOHEADER / WAVEFORMATEX */
  format: Uint8Array;
}

export interface AviChunk {
  /** stream number from the chunk id (`00dc` -> 0) */
  stream: number;
  /** the two letter suffix: `dc` / `db` video, `wb` audio */
  kind: string;
  /** position of the payload in the file */
  offset: number;
  size: number;
  keyframe: boolean;
}

export interface AviFile {
  data: Uint8Array;
  /** `avih.dwMicroSecPerFrame` */
  microSecPerFrame: number;
  totalFrames: number;
  width: number;
  height: number;
  streams: AviStream[];
  /** all chunks of the `movi` list in file order */
  chunks: AviChunk[];
}

const fourcc = (d: Uint8Array, o: number): string => String.fromCharCode(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!);

export function parseAvi(data: Uint8Array): AviFile {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 12 || fourcc(data, 0) !== "RIFF" || fourcc(data, 8) !== "AVI ") throw new AviError("not a RIFF AVI file");
  const avi: AviFile = { data, microSecPerFrame: 0, totalFrames: 0, width: 0, height: 0, streams: [], chunks: [] };
  let idx1: { id: string; flags: number; offset: number; size: number }[] = [];
  let moviStart = 0;

  const walk = (start: number, end: number, listType: string): void => {
    let p = start;
    while (p + 8 <= end) {
      const id = fourcc(data, p);
      const size = dv.getUint32(p + 4, true);
      const body = p + 8;
      const bodyEnd = Math.min(body + size, end);
      if (id === "LIST" || id === "RIFF") {
        const type = fourcc(data, body);
        if (type === "movi") moviStart = body + 4;
        walk(body + 4, bodyEnd, type);
      } else if (listType === "hdrl" && id === "avih") {
        avi.microSecPerFrame = dv.getUint32(body, true);
        avi.totalFrames = dv.getUint32(body + 16, true);
        avi.width = dv.getUint32(body + 32, true);
        avi.height = dv.getUint32(body + 36, true);
      } else if (listType === "strl" && id === "strh") {
        avi.streams.push({
          index: avi.streams.length, type: fourcc(data, body), handler: fourcc(data, body + 4), scale: dv.getUint32(body + 20, true),
          rate: dv.getUint32(body + 24, true), length: dv.getUint32(body + 32, true), format: new Uint8Array(0),
        });
      } else if (listType === "strl" && id === "strf") {
        const s = avi.streams[avi.streams.length - 1];
        if (s) s.format = data.subarray(body, bodyEnd);
      } else if (listType === "movi" || listType === "rec ") {
        const n = /^(\d\d)([a-z]{2})$/i.exec(id);
        if (n) avi.chunks.push({ stream: Number(n[1]), kind: n[2]!.toLowerCase(), offset: body, size: bodyEnd - body, keyframe: true });
      } else if (id === "idx1") {
        for (let q = body; q + 16 <= bodyEnd; q += 16) idx1.push({ id: fourcc(data, q), flags: dv.getUint32(q + 4, true), offset: dv.getUint32(q + 8, true), size: dv.getUint32(q + 12, true) });
      }
      p = body + size + (size & 1);
    }
  };
  walk(12, Math.min(data.length, 8 + dv.getUint32(4, true)), "AVI ");

  if (!avi.streams.length) throw new AviError("AVI without streams");
  // key frame flags from idx1 (AVIIF_KEYFRAME = 0x10); the offsets are relative to the `movi` list type field (some files: to the file start)
  if (idx1.length) {
    const byOffset = new Map<number, number>();
    for (const e of idx1) byOffset.set(e.offset, e.flags);
    const rel = avi.chunks.length && byOffset.has(avi.chunks[0]!.offset - 8 - (moviStart - 4)) ? moviStart - 4 : 0;
    for (const c of avi.chunks) {
      const f = byOffset.get(c.offset - 8 - rel);
      if (f !== undefined) c.keyframe = (f & 0x10) !== 0;
    }
  }
  return avi;
}

/** The payloads of the chunks of one stream, in order. */
export function streamChunks(avi: AviFile, stream: number): Uint8Array[] {
  return avi.chunks.filter((c) => c.stream === stream && c.kind !== "wb").map((c) => avi.data.subarray(c.offset, c.offset + c.size));
}
