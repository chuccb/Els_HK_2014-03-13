import { divFix, mulDiv, mulFix } from "./calc.ts";
import type { TtExec } from "./interp.ts";
import type { FtFace } from "./face.ts";
import type { GlyphLoader } from "./loader.ts";
import { FT_OUTLINE, Outline, outlineCheck, outlineGetCBox, outlineTranslate } from "./outline.ts";
import { ttSizeReadyBytecode, ttSizeRunPrep } from "./bytecode.ts";
import type { FtSize } from "./size.ts";
import type { GlyphSlot } from "./slot.ts";
import { sqrtFixed, vectorTransform } from "./trig.ts";
import { renderGlyph } from "./render.ts";
import { cloneGraphicsState, GlyphZone, newDefaultGraphicsState, TT_CODERANGE } from "./ttypes.ts";
import { FT_CURVE_TAG, FT_FACE_FLAG, FT_GLYPH_FORMAT, FT_LOAD, FtErr, FtError, loadTargetMode, pixCeil, pixFloor, pixRound } from "./types.ts";

/**
 * FT_Load_Glyph for the TrueType driver: ftobjs.c's FT_Load_Glyph (autohinter excluded, see below), ttdriver.c's tt_glyph_load -> ttgload.c's TT_Load_Glyph
 * (load_truetype_glyph, TT_Load_Simple_Glyph, TT_Load_Composite_Glyph, TT_Process_*, TT_Hint_Glyph, compute_glyph_metrics, tt_loader_init).
 *
 * NOT PORTED, and reported with FtError(Unimplemented_Feature) instead of a wrong answer:
 *  - embedded bitmaps (Gulim's EBDT): the exe always loads with FT_LOAD_NO_BITMAP; without it a face with a selected strike would decode a bitmap,
 *  - the autohinter: FT_Load_Glyph hands the glyph to it for FT_LOAD_FORCE_AUTOHINT, FT_RENDER_MODE_LIGHT targets, and fonts without instructions
 *    (num_locations && maxSizeOfInstructions == 0); none of the five fonts of the client is one of these,
 *  - GX variations (`doblend`), incremental fonts, subpixel hinting (not compiled in), FT_LOAD_NO_RECURSE composites (needs FT_Face subglyph access),
 *    FT_LOAD_VERTICAL_LAYOUT (vertical metrics are computed, the layout swap is ported), face transforms (FT_Set_Transform is never called).
 */

// composite glyph flags
const ARGS_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const ROUND_XY_TO_GRID = 0x0004;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_XY_SCALE = 0x0040;
const WE_HAVE_A_2X2 = 0x0080;
const WE_HAVE_INSTR = 0x0100;
const USE_MY_METRICS = 0x0200;
const SCALED_COMPONENT_OFFSET = 0x0800;

const int16 = (v: number): number => (v << 16) >> 16;
const uint16 = (v: number): number => v & 0xffff;

interface Vec {
  x: number;
  y: number;
}

/** TT_LoaderRec */
class TtLoader {
  glyphIndex = 0;
  loadFlags = 0;
  cursor = 0;
  limit = 0;
  byteLen = 0;
  glyfOffset = 0;
  nContours = 0;
  bbox = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  leftBearing = 0;
  advance = 0;
  linear = 0;
  linearDef = false;
  topBearing = 0;
  vadvance = 0;
  pp1: Vec = { x: 0, y: 0 };
  pp2: Vec = { x: 0, y: 0 };
  pp3: Vec = { x: 0, y: 0 };
  pp4: Vec = { x: 0, y: 0 };
  insPos = 0;
  exec: TtExec | null = null;
  zone = new GlyphZone();

  constructor(
    readonly face: FtFace,
    readonly size: FtSize,
    readonly glyph: GlyphSlot,
    readonly gloader: GlyphLoader,
  ) {}
}

const isHinted = (flags: number): boolean => (flags & FT_LOAD.NO_HINTING) === 0;

/** TT_Get_HMetrics / TT_Get_VMetrics + tt_get_metrics */
function ttGetMetrics(L: TtLoader, glyphIndex: number): void {
  const face = L.face;
  const [lsb, aw] = face.getMetrics(false, glyphIndex);
  let tsb: number;
  let ah: number;
  if (face.verticalInfo) [tsb, ah] = face.getMetrics(true, glyphIndex);
  else {
    tsb = 0;
    ah = face.unitsPerEM;
  }
  L.leftBearing = lsb;
  L.advance = aw;
  L.topBearing = tsb;
  L.vadvance = ah;
  if (!L.linearDef) {
    L.linearDef = true;
    L.linear = aw;
  }
}

/** translate_array on `n` points of `coords` starting at point `first` */
function translateArray(n: number, coords: Int32Array, first: number, dx: number, dy: number): void {
  if (dx) for (let k = 0; k < n; k++) coords[2 * (first + k)] = (coords[2 * (first + k)]! + dx) | 0;
  if (dy) for (let k = 0; k < n; k++) coords[2 * (first + k) + 1] = (coords[2 * (first + k) + 1]! + dy) | 0;
}

/** TT_Access_Glyph_Frame: FT_STREAM_SEEK + FT_FRAME_ENTER on a memory stream */
function accessGlyphFrame(L: TtLoader, offset: number, byteCount: number): number {
  const size = L.face.stream.size;
  if (offset > size) return FtErr.Invalid_Stream_Operation;
  if (offset >= size || size - offset < byteCount) return FtErr.Invalid_Stream_Operation;
  L.cursor = offset;
  L.limit = offset + byteCount;
  return FtErr.Ok;
}

/** TT_Load_Glyph_Header */
function readGlyphHeader(L: TtLoader): number {
  const b = L.face.stream;
  let p = L.cursor;
  if (p + 10 > L.limit) return FtErr.Invalid_Outline;
  L.nContours = b.s16(p);
  L.bbox.xMin = b.s16(p + 2);
  L.bbox.yMin = b.s16(p + 4);
  L.bbox.xMax = b.s16(p + 6);
  L.bbox.yMax = b.s16(p + 8);
  p += 10;
  L.cursor = p;
  return FtErr.Ok;
}

/** TT_Load_Simple_Glyph */
function readSimpleGlyph(L: TtLoader): number {
  const b = L.face.stream;
  let p = L.cursor;
  const limit = L.limit;
  const gl = L.gloader;
  const nContours = L.nContours;
  let error = gl.checkPoints(0, nContours);
  if (error) return error;
  const cont0 = gl.baseNContours;
  if (nContours >= 0xfff || p + (nContours + 1) * 2 > limit) return FtErr.Invalid_Outline;
  let prevCont = b.s16(p);
  p += 2;
  if (nContours > 0) gl.contours[cont0] = prevCont;
  if (prevCont < 0) return FtErr.Invalid_Outline;
  for (let c = 1; c < nContours; c++) {
    const v = b.s16(p);
    p += 2;
    gl.contours[cont0 + c] = v;
    if (v <= prevCont) return FtErr.Invalid_Outline;
    prevCont = v;
  }
  let nPoints = 0;
  if (nContours > 0) {
    nPoints = int16(gl.contours[cont0 + nContours - 1]!) + 1;
    if (nPoints < 0) return FtErr.Invalid_Outline;
  }
  error = gl.checkPoints(nPoints + 4, 0);
  if (error) return error;
  L.glyph.controlLen = 0;
  if (p + 2 > limit) return FtErr.Invalid_Outline;
  const nIns = b.u16(p);
  p += 2;
  if (nIns > L.face.maxProfile.maxSizeOfInstructions) return FtErr.Too_Many_Hints;
  if (limit - p < nIns) return FtErr.Too_Many_Hints;
  if (isHinted(L.loadFlags)) {
    L.glyph.controlLen = nIns;
    L.exec!.glyphIns.set(b.data.subarray(p, p + nIns));
  }
  p += nIns;
  const pt0 = gl.baseNPoints;
  const tags = gl.tags;
  let flag = pt0;
  const flagLimit = pt0 + nPoints;
  while (flag < flagLimit) {
    if (p + 1 > limit) return FtErr.Invalid_Outline;
    const c = b.u8(p);
    p++;
    tags[flag++] = c;
    if (c & 8) {
      if (p + 1 > limit) return FtErr.Invalid_Outline;
      let count = b.u8(p);
      p++;
      if (flag + count > flagLimit) return FtErr.Invalid_Outline;
      for (; count > 0; count--) tags[flag++] = c;
    }
  }
  const pts = gl.points;
  let x = 0;
  for (let i = 0; i < nPoints; i++) {
    let y = 0;
    const f = tags[pt0 + i]!;
    if (f & 2) {
      if (p + 1 > limit) return FtErr.Invalid_Outline;
      y = b.u8(p);
      p++;
      if ((f & 16) === 0) y = -y;
    } else if ((f & 16) === 0) {
      if (p + 2 > limit) return FtErr.Invalid_Outline;
      y = b.s16(p);
      p += 2;
    }
    x = (x + y) | 0;
    pts[2 * (pt0 + i)] = x;
    tags[pt0 + i] = f & ~(2 | 16);
  }
  x = 0;
  for (let i = 0; i < nPoints; i++) {
    let y = 0;
    const f = tags[pt0 + i]!;
    if (f & 4) {
      if (p + 1 > limit) return FtErr.Invalid_Outline;
      y = b.u8(p);
      p++;
      if ((f & 32) === 0) y = -y;
    } else if ((f & 32) === 0) {
      if (p + 2 > limit) return FtErr.Invalid_Outline;
      y = b.s16(p);
      p += 2;
    }
    x = (x + y) | 0;
    pts[2 * (pt0 + i) + 1] = x;
    tags[pt0 + i] = f & TAG_ON;
  }
  gl.curNPoints = nPoints & 0xffff;
  gl.curNContours = int16(nContours);
  L.cursor = p;
  return FtErr.Ok;
}

const TAG_ON = FT_CURVE_TAG.ON;

/** TT_Load_Composite_Glyph */
function readCompositeGlyph(L: TtLoader): number {
  const b = L.face.stream;
  let p = L.cursor;
  const limit = L.limit;
  const gl = L.gloader;
  let numSubglyphs = 0;
  let flags: number;
  do {
    const error = gl.checkSubGlyphs(numSubglyphs + 1);
    if (error) return error;
    if (p + 4 > limit) return FtErr.Invalid_Composite;
    const sg = gl.subglyphs[gl.baseNumSubglyphs + numSubglyphs]!;
    sg.arg1 = sg.arg2 = 0;
    sg.flags = flags = b.u16(p);
    sg.index = b.u16(p + 2);
    p += 4;
    let count = 2;
    if (flags & ARGS_ARE_WORDS) count += 2;
    if (flags & WE_HAVE_A_SCALE) count += 2;
    else if (flags & WE_HAVE_AN_XY_SCALE) count += 4;
    else if (flags & WE_HAVE_A_2X2) count += 8;
    if (p + count > limit) return FtErr.Invalid_Composite;
    if (flags & ARGS_ARE_WORDS) {
      sg.arg1 = b.s16(p);
      sg.arg2 = b.s16(p + 2);
      p += 4;
    } else {
      sg.arg1 = b.s8(p);
      sg.arg2 = b.s8(p + 1);
      p += 2;
    }
    let xx = 0x10000;
    let yy = 0x10000;
    let xy = 0;
    let yx = 0;
    if (flags & WE_HAVE_A_SCALE) {
      xx = b.s16(p) << 2;
      yy = xx;
      p += 2;
    } else if (flags & WE_HAVE_AN_XY_SCALE) {
      xx = b.s16(p) << 2;
      yy = b.s16(p + 2) << 2;
      p += 4;
    } else if (flags & WE_HAVE_A_2X2) {
      xx = b.s16(p) << 2;
      yx = b.s16(p + 2) << 2;
      xy = b.s16(p + 4) << 2;
      yy = b.s16(p + 6) << 2;
      p += 8;
    }
    sg.xx = xx;
    sg.xy = xy;
    sg.yx = yx;
    sg.yy = yy;
    numSubglyphs++;
  } while (flags & MORE_COMPONENTS);
  gl.curNumSubglyphs = numSubglyphs;
  L.insPos = p;
  L.cursor = p;
  return FtErr.Ok;
}

/** tt_prepare_zone: the zone is a window of the loader's buffers (`fromBase`: the base outline, else the current one) */
function prepareZone(zone: GlyphZone, gl: GlyphLoader, fromBase: boolean, startPoint: number, startContour: number): void {
  const pt0 = fromBase ? 0 : gl.baseNPoints;
  const ct0 = fromBase ? 0 : gl.baseNContours;
  const nPts = fromBase ? gl.baseNPoints : gl.curNPoints;
  const nCts = fromBase ? gl.baseNContours : gl.curNContours;
  zone.nPoints = (nPts - startPoint) & 0xffff;
  zone.nContours = int16(nCts - startContour);
  zone.org = gl.extra.subarray(2 * (pt0 + startPoint));
  zone.cur = gl.points.subarray(2 * (pt0 + startPoint));
  zone.orus = gl.extra2.subarray(2 * (pt0 + startPoint));
  zone.tags = gl.tags.subarray(pt0 + startPoint);
  zone.contours = gl.contours.subarray(ct0 + startContour);
  zone.firstPoint = startPoint & 0xffff;
}

/** TT_Hint_Glyph: round the origin, run the glyph's instructions on the zone; an FT_Error */
function hintGlyph(L: TtLoader, isComposite: boolean): number {
  const zone = L.zone;
  const exec = L.exec!;
  const nIns = L.glyph.controlLen;
  const cur = zone.cur;
  const n = zone.nPoints;
  let origin = cur[2 * (n - 4)]!;
  origin = (pixRound(origin) - origin) | 0;
  if (origin) translateArray(n, cur, 0, origin, 0);
  if (nIns > 0) zone.org.set(cur.subarray(0, 2 * n));
  exec.GS = cloneGraphicsState(L.size.GS);
  if (isComposite) {
    exec.metrics.xScale = 1 << 16;
    exec.metrics.yScale = 1 << 16;
    zone.orus.set(cur.subarray(0, 2 * n));
  } else {
    exec.metrics.xScale = L.size.scaled.xScale;
    exec.metrics.yScale = L.size.scaled.yScale;
  }
  cur[2 * (n - 3)] = pixRound(cur[2 * (n - 3)]!);
  cur[2 * (n - 1) + 1] = pixRound(cur[2 * (n - 1) + 1]!);
  if (nIns > 0) {
    const gl = L.gloader;
    const curTag0 = gl.baseNPoints; // gloader->current.outline.tags[0]
    exec.setCodeRange(TT_CODERANGE.GLYPH, exec.glyphIns, nIns);
    exec.isComposite = isComposite;
    exec.pts.assign(zone);
    const error = exec.runContext();
    if (error && exec.pedanticHinting) return error;
    gl.tags[curTag0] = gl.tags[curTag0]! | ((exec.GS.scanType << 5) & 0xff) | FT_CURVE_TAG.HAS_SCANMODE;
  }
  L.pp1 = { x: cur[2 * (n - 4)]!, y: cur[2 * (n - 4) + 1]! };
  L.pp2 = { x: cur[2 * (n - 3)]!, y: cur[2 * (n - 3) + 1]! };
  L.pp3 = { x: cur[2 * (n - 2)]!, y: cur[2 * (n - 2) + 1]! };
  L.pp4 = { x: cur[2 * (n - 1)]!, y: cur[2 * (n - 1) + 1]! };
  return FtErr.Ok;
}

/** TT_Process_Simple_Glyph */
function processSimpleGlyph(L: TtLoader): number {
  const gl = L.gloader;
  const pt0 = gl.baseNPoints;
  let nPoints = gl.curNPoints;
  const pts = gl.points;
  const tags = gl.tags;
  const phantoms = [L.pp1, L.pp2, L.pp3, L.pp4];
  for (let i = 0; i < 4; i++) {
    pts[2 * (pt0 + nPoints + i)] = phantoms[i]!.x;
    pts[2 * (pt0 + nPoints + i) + 1] = phantoms[i]!.y;
    tags[pt0 + nPoints + i] = 0;
  }
  nPoints += 4;
  if (isHinted(L.loadFlags)) {
    prepareZone(L.zone, gl, false, 0, 0);
    L.zone.orus.set(L.zone.cur.subarray(0, 2 * (L.zone.nPoints + 4)));
  }
  if ((L.loadFlags & FT_LOAD.NO_SCALE) === 0) {
    const xScale = L.size.scaled.xScale;
    const yScale = L.size.scaled.yScale;
    for (let i = 0; i < nPoints; i++) {
      pts[2 * (pt0 + i)] = mulFix(pts[2 * (pt0 + i)]!, xScale);
      pts[2 * (pt0 + i) + 1] = mulFix(pts[2 * (pt0 + i) + 1]!, yScale);
    }
    const at = (i: number): Vec => ({ x: pts[2 * (pt0 + i)]!, y: pts[2 * (pt0 + i) + 1]! });
    L.pp1 = at(nPoints - 4);
    L.pp2 = at(nPoints - 3);
    L.pp3 = at(nPoints - 2);
    L.pp4 = at(nPoints - 1);
  }
  let error: number = FtErr.Ok;
  if (isHinted(L.loadFlags)) {
    L.zone.nPoints = (L.zone.nPoints + 4) & 0xffff;
    error = hintGlyph(L, false);
  }
  return error;
}

/** TT_Process_Composite_Component */
function processCompositeComponent(L: TtLoader, sg: { flags: number; arg1: number; arg2: number; xx: number; xy: number; yx: number; yy: number }, startPoint: number, numBasePoints: number): number {
  const gl = L.gloader;
  const baseVec = gl.points; // base.outline.points: the base starts at index 0
  const numPoints = gl.baseNPoints;
  const haveScale = (sg.flags & (WE_HAVE_A_SCALE | WE_HAVE_AN_XY_SCALE | WE_HAVE_A_2X2)) !== 0;
  if (haveScale) for (let i = numBasePoints; i < numPoints; i++) vectorTransform(baseVec, 2 * i, sg.xx, sg.xy, sg.yx, sg.yy);
  let x: number;
  let y: number;
  if (!(sg.flags & ARGS_ARE_XY_VALUES)) {
    let k = sg.arg1 >>> 0;
    let l = sg.arg2 >>> 0;
    k = (k + startPoint) >>> 0;
    l = (l + numBasePoints) >>> 0;
    if (k >= numBasePoints || l >= numPoints) return FtErr.Invalid_Composite;
    x = (baseVec[2 * k]! - baseVec[2 * l]!) | 0;
    y = (baseVec[2 * k + 1]! - baseVec[2 * l + 1]!) | 0;
  } else {
    x = sg.arg1;
    y = sg.arg2;
    if (!x && !y) return FtErr.Ok;
    if (haveScale && (sg.flags & SCALED_COMPONENT_OFFSET)) {
      const macXScale = sqrtFixed((mulFix(sg.xx, sg.xx) | 0) + (mulFix(sg.xy, sg.xy) | 0));
      const macYScale = sqrtFixed((mulFix(sg.yy, sg.yy) | 0) + (mulFix(sg.yx, sg.yx) | 0));
      x = mulFix(x, macXScale);
      y = mulFix(y, macYScale);
    }
    if (!(L.loadFlags & FT_LOAD.NO_SCALE)) {
      x = mulFix(x, L.size.scaled.xScale);
      y = mulFix(y, L.size.scaled.yScale);
      if (sg.flags & ROUND_XY_TO_GRID) {
        x = pixRound(x);
        y = pixRound(y);
      }
    }
  }
  if (x || y) translateArray(numPoints - numBasePoints, baseVec, numBasePoints, x, y);
  return FtErr.Ok;
}

/** TT_Process_Composite_Glyph: the hinting pass over a whole composite */
function processCompositeGlyph(L: TtLoader, startPoint: number, startContour: number): number {
  const gl = L.gloader;
  let error = gl.checkPoints(gl.baseNPoints + 4, 0);
  if (error) return error;
  const n = gl.baseNPoints;
  const phantoms = [L.pp1, L.pp2, L.pp3, L.pp4];
  for (let i = 0; i < 4; i++) {
    gl.points[2 * (n + i)] = phantoms[i]!.x;
    gl.points[2 * (n + i) + 1] = phantoms[i]!.y;
    gl.tags[n + i] = 0;
  }
  const b = L.face.stream;
  if (L.insPos > b.size) return FtErr.Invalid_Stream_Operation;
  if (L.insPos + 2 > b.size) return FtErr.Invalid_Stream_Operation;
  const nIns = b.u16(L.insPos);
  const maxIns = L.face.maxProfile.maxSizeOfInstructions;
  const exec = L.exec!;
  if (nIns > maxIns) {
    if (nIns > L.byteLen) return FtErr.Too_Many_Hints;
    if (exec.glyphSize < nIns) {
      const g = new Uint8Array(nIns);
      g.set(exec.glyphIns);
      exec.glyphIns = g;
      exec.glyphSize = nIns & 0xffff;
    }
  } else if (nIns === 0) return FtErr.Ok;
  if (L.insPos + 2 + nIns > b.size) return FtErr.Invalid_Stream_Operation;
  exec.glyphIns.set(b.data.subarray(L.insPos + 2, L.insPos + 2 + nIns));
  L.glyph.controlLen = nIns;
  prepareZone(L.zone, gl, true, startPoint, startContour);
  for (let i = startPoint; i < L.zone.nPoints; i++) L.zone.tags[i]! &= ~(FT_CURVE_TAG.TOUCH_X | FT_CURVE_TAG.TOUCH_Y);
  L.zone.nPoints = (L.zone.nPoints + 4) & 0xffff;
  error = hintGlyph(L, true);
  return error;
}

function setPp(L: TtLoader): void {
  L.pp1 = { x: (L.bbox.xMin - L.leftBearing) | 0, y: 0 };
  L.pp2 = { x: (L.pp1.x + L.advance) | 0, y: 0 };
  L.pp3 = { x: 0, y: (L.topBearing + L.bbox.yMax) | 0 };
  L.pp4 = { x: 0, y: (L.pp3.y - L.vadvance) | 0 };
}

/** load_truetype_glyph; an FT_Error */
function loadTrueTypeGlyph(L: TtLoader, glyphIndex: number, recurseCount: number, headerOnly: boolean): number {
  const face = L.face;
  const gl = L.gloader;
  if (recurseCount > 1 && recurseCount > face.maxProfile.maxComponentDepth) return FtErr.Invalid_Composite;
  if (glyphIndex >>> 0 >= face.numGlyphs >>> 0) return FtErr.Invalid_Glyph_Index;
  L.glyphIndex = glyphIndex;
  let xScale: number;
  let yScale: number;
  if ((L.loadFlags & FT_LOAD.NO_SCALE) === 0) {
    xScale = L.size.scaled.xScale;
    yScale = L.size.scaled.yScale;
  } else {
    xScale = 0x10000;
    yScale = 0x10000;
  }
  ttGetMetrics(L, glyphIndex);
  const [offset, byteLen] = face.getLocation(glyphIndex);
  L.byteLen = byteLen;
  let error: number;
  if (L.byteLen > 0) {
    if (!L.glyfOffset) return FtErr.Invalid_Table;
    error = accessGlyphFrame(L, L.glyfOffset + offset, L.byteLen);
    if (error) return error;
    error = readGlyphHeader(L);
    if (error || headerOnly) return error;
  }
  if (L.byteLen === 0 || L.nContours === 0) {
    L.bbox.xMin = 0;
    L.bbox.xMax = 0;
    L.bbox.yMin = 0;
    L.bbox.yMax = 0;
    if (headerOnly) return FtErr.Ok;
    setPp(L);
    if ((L.loadFlags & FT_LOAD.NO_SCALE) === 0) {
      L.pp1.x = mulFix(L.pp1.x, xScale);
      L.pp2.x = mulFix(L.pp2.x, xScale);
      L.pp3.y = mulFix(L.pp3.y, yScale);
      L.pp4.y = mulFix(L.pp4.y, yScale);
    }
    return FtErr.Ok;
  }
  setPp(L);
  if (L.nContours > 0) {
    error = readSimpleGlyph(L);
    if (error) return error;
    error = processSimpleGlyph(L);
    if (error) return error;
    gl.add();
  } else if (L.nContours === -1) {
    const startPoint = gl.baseNPoints;
    const startContour = gl.baseNContours;
    error = readCompositeGlyph(L);
    if (error) return error;
    const insPos = L.insPos;
    if ((L.loadFlags & FT_LOAD.NO_SCALE) === 0) {
      L.pp1.x = mulFix(L.pp1.x, xScale);
      L.pp2.x = mulFix(L.pp2.x, xScale);
      L.pp3.y = mulFix(L.pp3.y, yScale);
      L.pp4.y = mulFix(L.pp4.y, yScale);
    }
    if (L.loadFlags & FT_LOAD.NO_RECURSE) throw new FtError(FtErr.Unimplemented_Feature, "FT_LOAD_NO_RECURSE composite glyphs are not ported");
    let numPoints = startPoint;
    const numSubglyphs = gl.curNumSubglyphs;
    const numBaseSubgs = gl.baseNumSubglyphs;
    const oldByteLen = L.byteLen;
    gl.add();
    let sg = gl.subglyphs[numBaseSubgs]!;
    for (let n = 0; n < numSubglyphs; n++) {
      sg = gl.subglyphs[numBaseSubgs + n]!;
      const pp = [L.pp1, L.pp2, L.pp3, L.pp4].map((v) => ({ x: v.x, y: v.y }));
      const numBasePoints = gl.baseNPoints;
      error = loadTrueTypeGlyph(L, sg.index, recurseCount + 1, false);
      if (error) return error;
      sg = gl.subglyphs[numBaseSubgs + n]!;
      if (!(sg.flags & USE_MY_METRICS)) {
        L.pp1 = pp[0]!;
        L.pp2 = pp[1]!;
        L.pp3 = pp[2]!;
        L.pp4 = pp[3]!;
      }
      numPoints = gl.baseNPoints;
      if (numPoints === numBasePoints) continue;
      processCompositeComponent(L, sg, startPoint, numBasePoints);
    }
    L.byteLen = oldByteLen;
    L.insPos = insPos;
    if (isHinted(L.loadFlags) && sg.flags & WE_HAVE_INSTR && numPoints > startPoint) processCompositeGlyph(L, startPoint, startContour);
  } else return FtErr.Invalid_Outline;
  return FtErr.Ok;
}

/** compute_glyph_metrics */
function computeGlyphMetrics(L: TtLoader, glyphIndex: number): number {
  const face = L.face;
  const glyph = L.glyph;
  const size = L.size;
  let yScale = 0x10000;
  if ((L.loadFlags & FT_LOAD.NO_SCALE) === 0) yScale = size.metrics.yScale;
  const bbox = glyph.format !== FT_GLYPH_FORMAT.COMPOSITE ? outlineGetCBox(glyph.outline) : L.bbox;
  glyph.linearHoriAdvance = L.linear;
  glyph.metrics.horiBearingX = bbox.xMin;
  glyph.metrics.horiBearingY = bbox.yMax;
  glyph.metrics.horiAdvance = (L.pp2.x - L.pp1.x) | 0;
  if (!face.postscript.isFixedPitch && isHinted(L.loadFlags)) {
    const w = face.getDeviceMetrics(size.metrics.xPpem, glyphIndex);
    if (w >= 0) glyph.metrics.horiAdvance = w << 6;
  }
  glyph.metrics.width = (bbox.xMax - bbox.xMin) | 0;
  glyph.metrics.height = (bbox.yMax - bbox.yMin) | 0;
  let top: number;
  let advance: number;
  if (face.verticalInfo && face.vertical!.numberOfHMetrics > 0) {
    top = int16(divFix((L.pp3.y - bbox.yMax) | 0, yScale));
    if (L.pp3.y <= L.pp4.y) advance = 0;
    else advance = uint16(divFix((L.pp3.y - L.pp4.y) | 0, yScale));
  } else {
    const height = int16(divFix((bbox.yMax - bbox.yMin) | 0, yScale));
    if (face.os2.version !== 0xffff) advance = face.os2.sTypoAscender - face.os2.sTypoDescender;
    else advance = face.horizontal.ascender - face.horizontal.descender;
    top = Math.trunc((advance - height) / 2) | 0;
  }
  glyph.linearVertAdvance = advance;
  if (!(L.loadFlags & FT_LOAD.NO_SCALE)) {
    top = mulFix(top, yScale);
    advance = mulFix(advance, yScale);
  }
  glyph.metrics.vertBearingX = (glyph.metrics.horiBearingX - (Math.trunc(glyph.metrics.horiAdvance / 2) | 0)) | 0;
  glyph.metrics.vertBearingY = top;
  glyph.metrics.vertAdvance = advance;
  return 0;
}

/** tt_loader_init (glyf_table_only = FALSE); an FT_Error */
function ttLoaderInit(L: TtLoader, loadFlagsIn: number): number {
  const face = L.face;
  const size = L.size;
  let loadFlags = loadFlagsIn;
  const pedantic = (loadFlags & FT_LOAD.PEDANTIC) !== 0;
  if (isHinted(loadFlags)) {
    if (!size.cvtReady) {
      const error = ttSizeReadyBytecode(size, pedantic);
      if (error) return error;
    }
    const exec = face.lib.exec;
    const grayscale = loadTargetMode(loadFlags) !== 2; // FT_RENDER_MODE_MONO
    exec.loadContext(face, size);
    if (grayscale !== exec.grayscale) {
      exec.grayscale = grayscale;
      for (let i = 0; i < size.cvt.length; i++) size.cvt[i] = mulFix(face.cvt[i]!, size.ttmetrics.scale);
      ttSizeRunPrep(size, pedantic);
    }
    if (exec.GS.instructControl & 1) loadFlags |= FT_LOAD.NO_HINTING;
    if (exec.GS.instructControl & 2) exec.GS = newDefaultGraphicsState();
    exec.pedanticHinting = (loadFlags & FT_LOAD.PEDANTIC) !== 0;
    L.exec = exec;
  }
  const g = face.lookupTable(0x676c7966); // 'glyf'
  L.glyfOffset = g ? g.offset : 0;
  L.gloader.rewind();
  L.loadFlags = loadFlags;
  return FtErr.Ok;
}

/** TT_Load_Glyph; an FT_Error */
export function ttLoadGlyph(size: FtSize, glyph: GlyphSlot, glyphIndex: number, loadFlags: number): number {
  const face = glyph.face;
  if (size.strikeIndex !== 0xffffffff && (loadFlags & FT_LOAD.NO_BITMAP) === 0) {
    throw new FtError(FtErr.Unimplemented_Feature, "embedded bitmaps (FT_LOAD_NO_BITMAP clear on a face with a selected strike) are not ported");
  }
  if (!(loadFlags & FT_LOAD.NO_SCALE) && !size.ttmetrics.valid) return FtErr.Invalid_Size_Handle;
  if (loadFlags & FT_LOAD.SBITS_ONLY) return FtErr.Invalid_Argument;
  const L = new TtLoader(face, size, glyph, glyph.loader);
  let error = ttLoaderInit(L, loadFlags);
  if (error) return error;
  glyph.format = FT_GLYPH_FORMAT.OUTLINE;
  glyph.numSubglyphs = 0;
  glyph.outline.flags = 0;
  error = loadTrueTypeGlyph(L, glyphIndex, 0, false);
  if (!error) {
    const gl = L.gloader;
    // glyph->outline = gloader->base.outline (the arrays are shared, like the C struct copy)
    const o = new Outline();
    o.nPoints = gl.baseNPoints;
    o.nContours = gl.baseNContours;
    o.points = gl.points.subarray(0, 2 * gl.baseNPoints);
    o.tags = gl.tags.subarray(0, gl.baseNPoints);
    o.contours = gl.contours.subarray(0, gl.baseNContours);
    o.flags = 0;
    glyph.outline.copyFrom(o);
    glyph.outline.flags &= ~FT_OUTLINE.SINGLE_PASS;
    if (L.pp1.x) outlineTranslate(glyph.outline, -L.pp1.x | 0, 0);
    if (isHinted(loadFlags)) {
      const e = L.exec!;
      if (e.GS.scanControl) {
        switch (e.GS.scanType) {
          case 0:
            glyph.outline.flags |= FT_OUTLINE.INCLUDE_STUBS;
            break;
          case 1:
            break;
          case 4:
            glyph.outline.flags |= FT_OUTLINE.SMART_DROPOUTS | FT_OUTLINE.INCLUDE_STUBS;
            break;
          case 5:
            glyph.outline.flags |= FT_OUTLINE.SMART_DROPOUTS;
            break;
          default:
            glyph.outline.flags |= FT_OUTLINE.IGNORE_DROPOUTS;
            break;
        }
      } else glyph.outline.flags |= FT_OUTLINE.IGNORE_DROPOUTS;
    }
    computeGlyphMetrics(L, glyphIndex);
  }
  if (!(loadFlags & FT_LOAD.NO_SCALE) && size.metrics.yPpem < 24) glyph.outline.flags |= FT_OUTLINE.HIGH_PRECISION;
  return error;
}

/** ft_glyphslot_grid_fit_metrics (GRID_FIT_METRICS) */
function gridFitMetrics(glyph: GlyphSlot, vertical: boolean): void {
  const m = glyph.metrics;
  let right: number;
  let bottom: number;
  if (vertical) {
    m.horiBearingX = pixFloor(m.horiBearingX);
    m.horiBearingY = pixCeil(m.horiBearingY);
    right = pixCeil((m.vertBearingX + m.width) | 0);
    bottom = pixCeil((m.vertBearingY + m.height) | 0);
    m.vertBearingX = pixFloor(m.vertBearingX);
    m.vertBearingY = pixFloor(m.vertBearingY);
    m.width = (right - m.vertBearingX) | 0;
    m.height = (bottom - m.vertBearingY) | 0;
  } else {
    m.vertBearingX = pixFloor(m.vertBearingX);
    m.vertBearingY = pixFloor(m.vertBearingY);
    right = pixCeil((m.horiBearingX + m.width) | 0);
    bottom = pixFloor((m.horiBearingY - m.height) | 0);
    m.horiBearingX = pixFloor(m.horiBearingX);
    m.horiBearingY = pixCeil(m.horiBearingY);
    m.width = (right - m.horiBearingX) | 0;
    m.height = (m.horiBearingY - bottom) | 0;
  }
  m.horiAdvance = pixRound(m.horiAdvance);
  m.vertAdvance = pixRound(m.vertAdvance);
}

/**
 * FT_Load_Glyph: an FT_Error (0 = ok).  With FT_LOAD_RENDER the glyph is rendered (FT_Render_Glyph, render.ts) -- the exe does not set it, it loads with 8
 * (FT_LOAD_NO_BITMAP) and renders with its own call.
 */
export function loadGlyph(face: FtFace, glyphIndex: number, loadFlags: number): number {
  const slot = face.glyph;
  slot.clear();
  if (loadFlags & FT_LOAD.NO_RECURSE) loadFlags |= FT_LOAD.NO_SCALE | FT_LOAD.IGNORE_TRANSFORM;
  if (loadFlags & FT_LOAD.NO_SCALE) {
    loadFlags |= FT_LOAD.NO_HINTING | FT_LOAD.NO_BITMAP;
    loadFlags &= ~FT_LOAD.RENDER;
  }
  // the autohinter is chosen for a scalable font when hinting is on and ...
  if (!(loadFlags & FT_LOAD.NO_HINTING) && !(loadFlags & FT_LOAD.NO_AUTOHINT)) {
    const mode = loadTargetMode(loadFlags);
    if (loadFlags & FT_LOAD.FORCE_AUTOHINT || mode === 1 || (face.faceFlags & FT_FACE_FLAG.SFNT && face.numLocations && face.maxProfile.maxSizeOfInstructions === 0)) {
      throw new FtError(FtErr.Unimplemented_Feature, "the autohinter is not ported (FT_LOAD_FORCE_AUTOHINT, FT_RENDER_MODE_LIGHT, or a font without instructions)");
    }
  }
  let error = ttLoadGlyph(face.size, slot, glyphIndex, loadFlags);
  if (error) return error;
  if (slot.format === FT_GLYPH_FORMAT.OUTLINE) {
    error = outlineCheck(slot.outline);
    if (error) return error;
    if (!(loadFlags & FT_LOAD.NO_HINTING)) gridFitMetrics(slot, (loadFlags & FT_LOAD.VERTICAL_LAYOUT) !== 0);
  }
  if (loadFlags & FT_LOAD.VERTICAL_LAYOUT) {
    slot.advance.x = 0;
    slot.advance.y = slot.metrics.vertAdvance;
  } else {
    slot.advance.x = slot.metrics.horiAdvance;
    slot.advance.y = 0;
  }
  if ((loadFlags & FT_LOAD.LINEAR_DESIGN) === 0 && face.faceFlags & FT_FACE_FLAG.SCALABLE) {
    const m = face.size.metrics;
    slot.linearHoriAdvance = mulDiv(slot.linearHoriAdvance, m.xScale, 64);
    slot.linearVertAdvance = mulDiv(slot.linearVertAdvance, m.yScale, 64);
  }
  if (slot.format !== FT_GLYPH_FORMAT.BITMAP && slot.format !== FT_GLYPH_FORMAT.COMPOSITE && loadFlags & FT_LOAD.RENDER) {
    let mode = loadTargetMode(loadFlags);
    if (mode === 0 && loadFlags & FT_LOAD.MONOCHROME) mode = 2;
    error = renderGlyph(slot, mode);
  }
  return error;
}
