/**
 * A TrueType font made of boxes: what the text tests draw with.  The five fonts of the client are far too rich to derive a pixel from by hand;
 * here every glyph is one filled rectangle (or none) with an advance width, all in font units, so that at a size where a pixel is a whole
 * number of units (unitsPerEm 1024 at 16 px: 64 units) the metrics, the bitmap and the cell of the glyph cache follow from the numbers
 * in the spec.  The font has no hinting program (`maxSizeOfInstructions` is not 0, so the loader does not look for an auto-hinter, which
 * is not ported and which the exe does not have).
 *
 * Tables: head, hhea, maxp, hmtx, loca (short), glyf, cmap (format 4, one segment per glyph), OS/2, post, name: the set the synthetic fonts
 * of packages/freetype/test/synth.ts have, in the same encodings.
 */
export interface BoxGlyph {
  /** the character (one UTF-16 unit) the cmap maps to this glyph */
  char: string;
  /** the advance width, font units */
  advance: number;
  /** the rectangle [xMin, yMin, xMax, yMax] in font units; none: an empty glyph (a space) */
  box?: [number, number, number, number];
}

export interface BoxFontSpec {
  unitsPerEm?: number;
  ascender: number;
  descender: number;
  /** glyph 1, 2, ...; glyph 0 is `.notdef` (empty, advance `notdefAdvance`) */
  glyphs: BoxGlyph[];
  notdefAdvance?: number;
}

class Out {
  readonly a: number[] = [];
  u8(v: number): this {
    this.a.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    this.a.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  u32(v: number): this {
    this.a.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this;
  }
  bytes(b: ArrayLike<number>): this {
    for (let i = 0; i < b.length; i++) this.a.push(b[i]! & 0xff);
    return this;
  }
  pad4(): this {
    while (this.a.length % 4) this.a.push(0);
    return this;
  }
}

function checksum(data: number[]): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum = (sum + (((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0))) >>> 0;
  return sum;
}

/** the bytes of a simple glyph with one clockwise rectangle (the left edge up, across the top, down the right edge) */
function rectGlyph([x0, y0, x1, y1]: [number, number, number, number]): number[] {
  const pts: [number, number][] = [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
  const g = new Out().u16(1).u16(x0).u16(y0).u16(x1).u16(y1).u16(3).u16(0); // one contour, the box, 4 points, no instructions
  for (let i = 0; i < 4; i++) g.u8(1); // on curve, 16-bit deltas
  let px = 0;
  for (const [x] of pts) {
    g.u16(x - px);
    px = x;
  }
  let py = 0;
  for (const [, y] of pts) {
    g.u16(y - py);
    py = y;
  }
  return g.pad4().a;
}

export function boxFont(spec: BoxFontSpec): Uint8Array {
  const em = spec.unitsPerEm ?? 1024;
  const nGlyphs = 1 + spec.glyphs.length;
  const all: BoxGlyph[] = [{ char: "\0", advance: spec.notdefAdvance ?? 0 }, ...spec.glyphs];

  const glyf = new Out();
  const loca = new Out();
  loca.u16(0);
  for (const gl of all) {
    if (gl.box) glyf.bytes(rectGlyph(gl.box));
    loca.u16(glyf.a.length >> 1);
  }

  const hmtx = new Out();
  for (const gl of all) hmtx.u16(gl.advance).u16(gl.box ? gl.box[0] : 0);

  const boxes = all.filter((g) => g.box).map((g) => g.box!);
  const xMin = Math.min(0, ...boxes.map((b) => b[0]));
  const yMin = Math.min(0, ...boxes.map((b) => b[1]));
  const xMax = Math.max(0, ...boxes.map((b) => b[2]));
  const yMax = Math.max(0, ...boxes.map((b) => b[3]));

  const maxp = new Out()
    .u32(0x00010000).u16(nGlyphs).u16(4).u16(1).u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(64).u16(8).u16(0).u16(0);
  const head = new Out()
    .u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(em)
    .u32(0).u32(0).u32(0).u32(0)
    .u16(xMin).u16(yMin).u16(xMax).u16(yMax).u16(0).u16(8).u16(2).u16(0).u16(0);
  const hhea = new Out()
    .u32(0x00010000).u16(spec.ascender).u16(spec.descender).u16(0).u16(Math.max(...all.map((g) => g.advance)))
    .u16(0).u16(0).u16(xMax).u16(1).u16(0).u16(0).u32(0).u32(0).u16(0).u16(nGlyphs);

  // cmap format 4: a segment per character (sorted), then the closing 0xFFFF
  const mapped = spec.glyphs.map((g, i) => ({ code: g.char.charCodeAt(0), gid: i + 1 })).sort((p, q) => p.code - q.code);
  const segCount = mapped.length + 1;
  let sr = 1;
  let es = 0;
  while (sr * 2 <= segCount) {
    sr *= 2;
    es++;
  }
  const sub = new Out().u16(4).u16(16 + 8 * segCount).u16(0).u16(segCount * 2).u16(sr * 2).u16(es).u16(segCount * 2 - sr * 2);
  for (const m of mapped) sub.u16(m.code);
  sub.u16(0xffff).u16(0);
  for (const m of mapped) sub.u16(m.code);
  sub.u16(0xffff);
  for (const m of mapped) sub.u16((m.gid - m.code) & 0xffff);
  sub.u16(1);
  for (let i = 0; i < segCount; i++) sub.u16(0);
  const cmap = new Out().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(sub.a);

  const nameT = new Out().u16(0).u16(0).u16(6);
  const post = new Out().u32(0x00030000).u32(0).u16(-100 & 0xffff).u16(50).u32(0).u32(0).u32(0).u32(0).u32(0);
  const os2 = new Out().u16(0).u16(500).u16(400).u16(5).u16(0);
  while (os2.a.length < 78) os2.u8(0);

  const tables: [string, number[]][] = [
    ["OS/2", os2.a], ["cmap", cmap.a], ["glyf", glyf.a], ["head", head.a], ["hhea", hhea.a], ["hmtx", hmtx.a], ["loca", loca.a],
    ["maxp", maxp.a], ["name", nameT.a], ["post", post.a],
  ];
  const out = new Out();
  const n = tables.length;
  let tsr = 1;
  let tes = 0;
  while (tsr * 2 <= n) {
    tsr *= 2;
    tes++;
  }
  out.u32(0x00010000).u16(n).u16(tsr * 16).u16(tes).u16(n * 16 - tsr * 16);
  let off = 12 + 16 * n;
  const bodies: number[][] = [];
  for (const [tag, data] of tables) {
    const padded = new Out().bytes(data).pad4();
    bodies.push(padded.a);
    out.bytes([...tag].map((c) => c.charCodeAt(0))).u32(checksum(padded.a)).u32(off).u32(data.length);
    off += padded.a.length;
  }
  for (const b of bodies) out.bytes(b);
  return Uint8Array.from(out.a);
}
