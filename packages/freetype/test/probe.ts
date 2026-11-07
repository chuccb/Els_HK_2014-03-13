import { createHash } from "node:crypto";
import { FtFace, FtError } from "../src/index.ts";
import { bitmapCopy, bitmapEmbolden } from "../src/bitmap.ts";
import { loadGlyph } from "../src/glyph.ts";
import { renderGlyph } from "../src/render.ts";
import { Bitmap } from "../src/slot.ts";
import { divFix, mulDiv, mulDivNoRound, mulFix } from "../src/calc.ts";
import { sqrtFixed, vectorLength, vectorTransform } from "../src/trig.ts";

/**
 * What the port's state looks like in the format tools/oracle-freetype.py prints for the exe's FreeType (field names of the oracle's result lines), so a
 * result of the exe and one of the port compare with one `toEqual`: used by tools/verify-freetype.ts (live oracle) and by test/oracle.test.ts (the recorded
 * fixture).
 */
export type Json = Record<string, any>;

export const faceInfo = (f: FtFace): Json => ({
  num_faces: f.numFaces,
  face_index: f.faceIndex,
  face_flags: f.faceFlags,
  style_flags: f.styleFlags,
  num_glyphs: f.numGlyphs,
  num_charmaps: f.charmaps.length,
  bbox: [f.bbox.xMin, f.bbox.yMin, f.bbox.xMax, f.bbox.yMax],
  units_per_EM: f.unitsPerEM,
  ascender: f.ascender,
  descender: f.descender,
  height: f.height,
  max_advance_width: f.maxAdvanceWidth,
  max_advance_height: f.maxAdvanceHeight,
  underline_position: f.underlinePosition,
  underline_thickness: f.underlineThickness,
});

export const sizeInfo = (f: FtFace): Json => {
  const m = f.size.metrics;
  return { x_ppem: m.xPpem, y_ppem: m.yPpem, x_scale: m.xScale, y_scale: m.yScale, ascender: m.ascender, descender: m.descender, height: m.height, max_advance: m.maxAdvance };
};


export const bufHex = (b: Uint8Array | null, n: number): string => (b ? Buffer.from(b.subarray(0, n)).toString("hex") : "");

/** what the oracle prints for a loaded glyph, from the port's slot: FT_Load_Glyph(flags), then FT_Render_Glyph(mode) when `render` is not null */
export function portGlyph(face: FtFace, gi: number, flags: number, render: number | null, withOutline: boolean): Json {
  const r: Json = { glyph: gi, load_err: 0, render_err: null };
  let err: number;
  try {
    err = loadGlyph(face, gi, flags);
  } catch (e) {
    if (e instanceof FtError) return { glyph: gi, thrown: e.message };
    throw e;
  }
  r.load_err = err;
  if (err) return r;
  const s = face.glyph;
  const m = s.metrics;
  const metrics = (): number[] => [m.width, m.height, m.horiBearingX, m.horiBearingY, m.horiAdvance, m.vertBearingX, m.vertBearingY, m.vertAdvance];
  r.metrics = metrics();
  r.linear = [s.linearHoriAdvance, s.linearVertAdvance];
  r.advance = [s.advance.x, s.advance.y];
  r.format = s.format;
  if (withOutline && s.format === 0x6f75746c) {
    const o = s.outline;
    r.outline = {
      contours: Array.from(o.contours.subarray(0, o.nContours)),
      points: Array.from({ length: o.nPoints }, (_, i) => [o.points[2 * i]!, o.points[2 * i + 1]!]),
      tags: Array.from(o.tags.subarray(0, o.nPoints)),
      flags: o.flags,
    };
  }
  if (render !== null) {
    try {
      r.render_err = renderGlyph(s, render);
    } catch (e) {
      if (e instanceof FtError) return { glyph: gi, thrown: e.message };
      throw e;
    }
    if (r.render_err === 0) {
      const b = s.bitmap;
      r.bitmap = { rows: b.rows, width: b.width, pitch: b.pitch, mode: b.pixelMode, left: s.bitmapLeft, top: s.bitmapTop, hex: bufHex(b.buffer, b.rows * Math.abs(b.pitch)) };
      r.metrics_after = metrics();
    }
  }
  return r;
}


export interface SynthOutline {
  points: number[][];
  tags: number[];
  contours: number[];
  flags: number;
}


export const sha1 = (b: Uint8Array): string => createHash("sha1").update(b).digest("hex");

export function bitmapJson(s: { bitmap: Bitmap; bitmapLeft: number; bitmapTop: number }): Json {
  const b = s.bitmap;
  const data = b.buffer ? b.buffer.subarray(0, b.rows * Math.abs(b.pitch)) : new Uint8Array(0);
  const r: Json = { rows: b.rows, width: b.width, pitch: b.pitch, mode: b.pixelMode, left: s.bitmapLeft, top: s.bitmapTop, sha1: sha1(data) };
  if (data.length <= 4096) r.hex = Buffer.from(data).toString("hex");
  return r;
}

export function portRaster(face: FtFace, o: SynthOutline): Json {
  const slot = face.glyph;
  slot.clear();
  const ol = slot.outline;
  ol.nContours = o.contours.length;
  ol.nPoints = o.points.length;
  ol.points = Int32Array.from(o.points.flat());
  ol.tags = Uint8Array.from(o.tags);
  ol.contours = Uint16Array.from(o.contours);
  ol.flags = o.flags;
  slot.format = 0x6f75746c;
  const r: Json = { raster: true, render_err: renderGlyph(slot, 0) };
  if (r.render_err === 0) r.bitmap = bitmapJson(slot);
  return r;
}


/** FT_Bitmap_Copy + FT_Bitmap_Embolden of a bitmap given as the oracle's embolden job gives it */
export function portEmbolden(b: { rows: number; width: number; pitch: number; pixel_mode: number; hex: string }, xstr: number, ystr: number): Json {
  const src = new Bitmap();
  src.rows = b.rows;
  src.width = b.width;
  src.pitch = b.pitch;
  src.pixelMode = b.pixel_mode;
  src.numGrays = 256;
  src.buffer = Uint8Array.from(Buffer.from(b.hex, "hex"));
  const dst = new Bitmap();
  let err = bitmapCopy(src, dst);
  if (!err) err = bitmapEmbolden(dst, xstr, ystr);
  return { err, rows: dst.rows, width: dst.width, pitch: dst.pitch, mode: dst.pixelMode, hex: bufHex(dst.buffer, dst.rows * Math.abs(dst.pitch)), embolden: true };
}

/**
 * A glyph result in a form small enough for a fixture: the outline's points and tags and a bitmap's pixels (when more than 80 bytes) are replaced by
 * their SHA-1 (pixels kept when up to 80 bytes); font / size / code are the fixture record's own.  Applied to the oracle's line and to the port's `portGlyph` alike.
 */
export function compactGlyph(r: Json): Json {
  const c: Json = { ...r };
  for (const k of ["font", "size", "code"]) delete c[k];
  if (c.outline) {
    const o = c.outline;
    c.outline = { contours: o.contours, nPoints: o.points.length, flags: o.flags, sha1: sha1(Buffer.from(JSON.stringify([o.points, o.tags]))) };
  }
  if (c.bitmap && c.bitmap.hex !== undefined) {
    const b = { ...c.bitmap, sha1: sha1(Buffer.from(c.bitmap.hex, "hex")) };
    if (c.bitmap.hex.length > 160) delete b.hex;
    c.bitmap = b;
  }
  return c;
}

/** the glyph indices of a run of character codes, as a hash (a fixture of 2^18 lookups per font would be a megabyte) */
export function indicesDigest(glyphs: number[]): { count: number; nonzero: number; sha1: string } {
  return { count: glyphs.length, nonzero: glyphs.filter((g) => g !== 0).length, sha1: sha1(Buffer.from(Int32Array.from(glyphs).buffer)) };
}

export type CalcKind = "mulfix" | "muldiv" | "muldiv_no_round" | "divfix" | "sqrtfixed" | "veclen" | "vtransform";

/** the integer helpers the oracle can call (tools/oracle-freetype.py `calc` jobs), run on the port */
export function portCalc(kind: CalcKind, a: number[]): number | number[] {
  switch (kind) {
    case "mulfix":
      return mulFix(a[0]!, a[1]!);
    case "muldiv":
      return mulDiv(a[0]!, a[1]!, a[2]!);
    case "muldiv_no_round":
      return mulDivNoRound(a[0]!, a[1]!, a[2]!);
    case "divfix":
      return divFix(a[0]!, a[1]!);
    case "sqrtfixed":
      return sqrtFixed(a[0]!);
    case "veclen":
      return vectorLength(a[0]!, a[1]!);
    case "vtransform": {
      const v = new Int32Array([a[0]!, a[1]!]);
      vectorTransform(v, 0, a[2]!, a[3]!, a[4]!, a[5]!);
      return [v[0]!, v[1]!];
    }
  }
}
