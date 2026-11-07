import { divFix, mulDiv, mulFix } from "./calc.ts";
import type { FtFace } from "./face.ts";
import {
  type CodeRange,
  type DefRecord,
  type GraphicsState,
  GlyphZone,
  type SizeMetrics,
  type TtSizeMetrics,
  cloneSizeMetrics,
  newDefaultGraphicsState,
  newSizeMetrics,
  newTtSizeMetrics,
} from "./ttypes.ts";
import { FT_FACE_FLAG, FtErr, FtError, pixCeil, pixFloor, pixRound } from "./types.ts";

/** FT_Size_Request_Type */
export const FT_SIZE_REQUEST_TYPE = { NOMINAL: 0, REAL_DIM: 1, BBOX: 2, CELL: 3, SCALES: 4, MAX: 5 } as const;

/** FT_Size_RequestRec */
export interface SizeRequest {
  type: number;
  width: number;
  height: number;
  horiResolution: number;
  vertResolution: number;
}

const i32 = (v: number): number => v | 0;
const u16 = (v: number): number => v & 0xffff;

/**
 * FT_SizeRec + TT_SizeRec (ttobjs.h).  `metrics` is the public FT_Size_Metrics (face->size->metrics, what the exe reads); `scaled` is TT_SizeRec.metrics, the copy
 * tt_size_reset recomputes and hands to the interpreter (exec->metrics).
 */
export class FtSize {
  metrics: SizeMetrics = newSizeMetrics();
  scaled: SizeMetrics = newSizeMetrics();
  ttmetrics: TtSizeMetrics = newTtSizeMetrics();
  strikeIndex = 0xffffffff;

  // bytecode state (tt_size_init_bytecode)
  bytecodeReady = false;
  cvtReady = false;
  cvt: Int32Array = new Int32Array(0);
  storage: Int32Array = new Int32Array(0);
  twilight: GlyphZone = new GlyphZone();
  GS: GraphicsState = newDefaultGraphicsState();
  functionDefs: DefRecord[] = [];
  instructionDefs: DefRecord[] = [];
  numFunctionDefs = 0;
  maxFunctionDefs = 0;
  numInstructionDefs = 0;
  maxInstructionDefs = 0;
  maxFunc = 0;
  maxIns = 0;
  codeRangeTable: CodeRange[] = [
    { base: null, size: 0 },
    { base: null, size: 0 },
    { base: null, size: 0 },
  ];

  constructor(readonly face: FtFace) {}
}

/** ft_recompute_scaled_metrics (GRID_FIT_METRICS is defined in the exe's ftobjs.c) */
function recomputeScaledMetrics(face: FtFace, m: SizeMetrics): void {
  m.ascender = pixCeil(mulFix(face.ascender, m.yScale));
  m.descender = pixFloor(mulFix(face.descender, m.yScale));
  m.height = pixRound(mulFix(face.height, m.yScale));
  m.maxAdvance = pixRound(mulFix(face.maxAdvanceWidth, m.xScale));
}

/** FT_Select_Metrics */
function selectMetrics(face: FtFace, strikeIndex: number): void {
  const m = face.size.metrics;
  const bs = face.availableSizes[strikeIndex]!;
  m.xPpem = u16((bs.xPpem + 32) >> 6);
  m.yPpem = u16((bs.yPpem + 32) >> 6);
  if (face.faceFlags & FT_FACE_FLAG.SCALABLE) {
    m.xScale = divFix(bs.xPpem, face.unitsPerEM);
    m.yScale = divFix(bs.yPpem, face.unitsPerEM);
    recomputeScaledMetrics(face, m);
  } else {
    m.xScale = 1 << 16;
    m.yScale = 1 << 16;
    m.ascender = bs.yPpem;
    m.descender = 0;
    m.height = bs.height << 6;
    m.maxAdvance = bs.xPpem;
  }
}

const requestWidth = (r: SizeRequest): number => (r.horiResolution ? Math.trunc(i32(i32(r.width * r.horiResolution) + 36) / 72) : r.width);
const requestHeight = (r: SizeRequest): number => (r.vertResolution ? Math.trunc(i32(i32(r.height * r.vertResolution) + 36) / 72) : r.height);

/** FT_Request_Metrics */
function requestMetrics(face: FtFace, req: SizeRequest): void {
  const m = face.size.metrics;
  if (face.faceFlags & FT_FACE_FLAG.SCALABLE) {
    let w = 0;
    let h = 0;
    let scaledW = 0;
    let scaledH = 0;
    let skipScales = false;
    switch (req.type) {
      case FT_SIZE_REQUEST_TYPE.NOMINAL:
        w = h = face.unitsPerEM;
        break;
      case FT_SIZE_REQUEST_TYPE.REAL_DIM:
        w = h = face.ascender - face.descender;
        break;
      case FT_SIZE_REQUEST_TYPE.BBOX:
        w = face.bbox.xMax - face.bbox.xMin;
        h = face.bbox.yMax - face.bbox.yMin;
        break;
      case FT_SIZE_REQUEST_TYPE.CELL:
        w = face.maxAdvanceWidth;
        h = face.ascender - face.descender;
        break;
      case FT_SIZE_REQUEST_TYPE.SCALES:
        m.xScale = i32(req.width);
        m.yScale = i32(req.height);
        if (!m.xScale) m.xScale = m.yScale;
        else if (!m.yScale) m.yScale = m.xScale;
        skipScales = true;
        break;
      default:
        break;
    }
    if (!skipScales) {
      if (w < 0) w = -w;
      if (h < 0) h = -h;
      scaledW = requestWidth(req);
      scaledH = requestHeight(req);
      if (req.width) {
        m.xScale = divFix(scaledW, w);
        if (req.height) {
          m.yScale = divFix(scaledH, h);
          if (req.type === FT_SIZE_REQUEST_TYPE.CELL) {
            if (m.yScale > m.xScale) m.yScale = m.xScale;
            else m.xScale = m.yScale;
          }
        } else {
          m.yScale = m.xScale;
          scaledH = mulDiv(scaledW, h, w);
        }
      } else {
        m.xScale = m.yScale = divFix(scaledH, h);
        scaledW = mulDiv(scaledH, w, h);
      }
    }
    if (req.type !== FT_SIZE_REQUEST_TYPE.NOMINAL) {
      scaledW = mulFix(face.unitsPerEM, m.xScale);
      scaledH = mulFix(face.unitsPerEM, m.yScale);
    }
    m.xPpem = u16((scaledW + 32) >> 6);
    m.yPpem = u16((scaledH + 32) >> 6);
    recomputeScaledMetrics(face, m);
  } else {
    Object.assign(m, newSizeMetrics());
    m.xScale = 1 << 16;
    m.yScale = 1 << 16;
  }
}

/** FT_Match_Size (ignore_width = 0 for sfnt's set_sbit_strike): the strike index, or an error code */
function matchSize(face: FtFace, req: SizeRequest, ignoreWidth: boolean): number {
  if (!(face.faceFlags & FT_FACE_FLAG.FIXED_SIZES)) return FtErr.Invalid_Face_Handle;
  if (req.type !== FT_SIZE_REQUEST_TYPE.NOMINAL) return FtErr.Unimplemented_Feature;
  let w = requestWidth(req);
  let h = requestHeight(req);
  if (req.width && !req.height) h = w;
  else if (!req.width && req.height) w = h;
  w = pixRound(w);
  h = pixRound(h);
  for (let i = 0; i < face.availableSizes.length; i++) {
    const bs = face.availableSizes[i]!;
    if (h !== pixRound(bs.yPpem)) continue;
    if (w === pixRound(bs.xPpem) || ignoreWidth) return i;
  }
  return -FtErr.Invalid_Pixel_Size; // negative: an error (strike indices are >= 0)
}

/** tt_size_reset (ttobjs.c): recompute the scaled metrics of the TrueType size */
export function ttSizeReset(size: FtSize): number {
  const face = size.face;
  size.ttmetrics.valid = false;
  const m = (size.scaled = cloneSizeMetrics(size.metrics));
  if (m.xPpem < 1 || m.yPpem < 1) return FtErr.Invalid_PPem;
  if (face.header.flags & 8) {
    m.xScale = divFix(m.xPpem << 6, face.unitsPerEM);
    m.yScale = divFix(m.yPpem << 6, face.unitsPerEM);
    m.ascender = pixRound(mulFix(face.ascender, m.yScale));
    m.descender = pixRound(mulFix(face.descender, m.yScale));
    m.height = pixRound(mulFix(face.height, m.yScale));
    m.maxAdvance = pixRound(mulFix(face.maxAdvanceWidth, m.xScale));
  }
  if (m.xPpem >= m.yPpem) {
    size.ttmetrics.scale = m.xScale;
    size.ttmetrics.ppem = m.xPpem;
    size.ttmetrics.xRatio = 0x10000;
    size.ttmetrics.yRatio = divFix(m.yPpem, m.xPpem);
  } else {
    size.ttmetrics.scale = m.yScale;
    size.ttmetrics.ppem = m.yPpem;
    size.ttmetrics.xRatio = divFix(m.xPpem, m.yPpem);
    size.ttmetrics.yRatio = 0x10000;
  }
  size.cvtReady = false;
  size.ttmetrics.valid = true;
  return FtErr.Ok;
}

/** tt_size_select */
function ttSizeSelect(size: FtSize, strikeIndex: number): number {
  const face = size.face;
  size.strikeIndex = strikeIndex;
  if (face.faceFlags & FT_FACE_FLAG.SCALABLE) {
    selectMetrics(face, strikeIndex);
    ttSizeReset(size);
    return FtErr.Ok;
  }
  try {
    const sm = face.loadStrikeMetrics(strikeIndex);
    size.metrics.xPpem = sm.xPpem;
    size.metrics.yPpem = sm.yPpem;
    size.metrics.ascender = sm.ascender;
    size.metrics.descender = sm.descender;
    size.metrics.height = sm.height;
    size.metrics.maxAdvance = sm.maxAdvance;
    return FtErr.Ok;
  } catch (e) {
    if (e instanceof FtError) {
      size.strikeIndex = 0xffffffff;
      return e.code;
    }
    throw e;
  }
}

/** tt_size_request (ttdriver.c) = FT_Request_Size for the TrueType driver; returns an FT_Error number */
export function requestSize(face: FtFace, req: SizeRequest): number {
  if (req.width < 0 || req.height < 0 || req.type >= FT_SIZE_REQUEST_TYPE.MAX) return FtErr.Invalid_Argument;
  const size = face.size;
  let error: number = FtErr.Ok;
  if (face.faceFlags & FT_FACE_FLAG.FIXED_SIZES) {
    const idx = matchSize(face, req, false);
    if (idx < 0 || idx > 0xffff) size.strikeIndex = 0xffffffff;
    else return ttSizeSelect(size, idx);
  }
  requestMetrics(face, req);
  if (face.faceFlags & FT_FACE_FLAG.SCALABLE) {
    error = ttSizeReset(size);
    size.metrics = cloneSizeMetrics(size.scaled);
  }
  return error;
}

/** FT_Set_Char_Size */
export function setCharSize(face: FtFace, charWidth: number, charHeight: number, horzResolution: number, vertResolution: number): number {
  if (!charWidth) charWidth = charHeight;
  else if (!charHeight) charHeight = charWidth;
  if (!horzResolution) horzResolution = vertResolution;
  else if (!vertResolution) vertResolution = horzResolution;
  if (charWidth < 64) charWidth = 64;
  if (charHeight < 64) charHeight = 64;
  if (!horzResolution) horzResolution = vertResolution = 72;
  return requestSize(face, { type: FT_SIZE_REQUEST_TYPE.NOMINAL, width: charWidth, height: charHeight, horiResolution: horzResolution, vertResolution });
}
