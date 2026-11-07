/**
 * Records shared by the TrueType size, the glyph loader and the bytecode interpreter (ttobjs.h / ttinterp.h of FreeType 2.4.11).
 * Every field keeps the C width: the F2Dot14 vectors are int16, rp0..rp2 / gep0..gep2 / delta_base / delta_shift are 16 bit.
 */

/** FT_UnitVector (F2Dot14) */
export interface UnitVector {
  x: number;
  y: number;
}

/** TT_GraphicsState */
export interface GraphicsState {
  rp0: number;
  rp1: number;
  rp2: number;
  dualVector: UnitVector;
  projVector: UnitVector;
  freeVector: UnitVector;
  loop: number;
  minimumDistance: number;
  roundState: number;
  autoFlip: boolean;
  controlValueCutin: number;
  singleWidthCutin: number;
  singleWidthValue: number;
  deltaBase: number;
  deltaShift: number;
  instructControl: number;
  scanControl: boolean;
  scanType: number;
  gep0: number;
  gep1: number;
  gep2: number;
}

/** tt_default_graphics_state (ttinterp.c: { 0, 0, 0, {0x4000, 0} x 3, 1, 64, 1, TRUE, 68, 0, 0, 9, 3, 0, FALSE, 0, 1, 1, 1 }) */
export const newDefaultGraphicsState = (): GraphicsState => ({
  rp0: 0,
  rp1: 0,
  rp2: 0,
  dualVector: { x: 0x4000, y: 0 },
  projVector: { x: 0x4000, y: 0 },
  freeVector: { x: 0x4000, y: 0 },
  loop: 1,
  minimumDistance: 64,
  roundState: 1,
  autoFlip: true,
  controlValueCutin: 68,
  singleWidthCutin: 0,
  singleWidthValue: 0,
  deltaBase: 9,
  deltaShift: 3,
  instructControl: 0,
  scanControl: false,
  scanType: 0,
  gep0: 1,
  gep1: 1,
  gep2: 1,
});

export const cloneGraphicsState = (g: GraphicsState): GraphicsState => ({
  rp0: g.rp0,
  rp1: g.rp1,
  rp2: g.rp2,
  dualVector: { x: g.dualVector.x, y: g.dualVector.y },
  projVector: { x: g.projVector.x, y: g.projVector.y },
  freeVector: { x: g.freeVector.x, y: g.freeVector.y },
  loop: g.loop,
  minimumDistance: g.minimumDistance,
  roundState: g.roundState,
  autoFlip: g.autoFlip,
  controlValueCutin: g.controlValueCutin,
  singleWidthCutin: g.singleWidthCutin,
  singleWidthValue: g.singleWidthValue,
  deltaBase: g.deltaBase,
  deltaShift: g.deltaShift,
  instructControl: g.instructControl,
  scanControl: g.scanControl,
  scanType: g.scanType,
  gep0: g.gep0,
  gep1: g.gep1,
  gep2: g.gep2,
});

/**
 * TT_GlyphZoneRec.  Points are interleaved (x, y) pairs; `cur` / `org` / `orus` / `tags` are windows (subarrays) of the glyph loader's buffers or of a
 * size's twilight arrays, exactly like the C pointers.  `contours` holds the end point of each contour as an index into the whole base outline
 * (`firstPoint` is the offset of the zone inside it).
 */
export class GlyphZone {
  maxPoints = 0;
  maxContours = 0;
  nPoints = 0;
  nContours = 0;
  org: Int32Array = new Int32Array(0);
  cur: Int32Array = new Int32Array(0);
  orus: Int32Array = new Int32Array(0);
  tags: Uint8Array = new Uint8Array(0);
  contours: Uint16Array = new Uint16Array(0);
  firstPoint = 0;

  /** a struct copy (`exec->zp0 = exec->pts`): the arrays stay shared */
  assign(o: GlyphZone): void {
    this.maxPoints = o.maxPoints;
    this.maxContours = o.maxContours;
    this.nPoints = o.nPoints;
    this.nContours = o.nContours;
    this.org = o.org;
    this.cur = o.cur;
    this.orus = o.orus;
    this.tags = o.tags;
    this.contours = o.contours;
    this.firstPoint = o.firstPoint;
  }

  clear(): void {
    this.maxPoints = 0;
    this.maxContours = 0;
    this.nPoints = 0;
    this.nContours = 0;
    this.org = new Int32Array(0);
    this.cur = new Int32Array(0);
    this.orus = new Int32Array(0);
    this.tags = new Uint8Array(0);
    this.contours = new Uint16Array(0);
    this.firstPoint = 0;
  }

  /** tt_glyphzone_new: zeroed arrays of `maxPoints` points and `maxContours` contours */
  static create(maxPoints: number, maxContours: number): GlyphZone {
    const z = new GlyphZone();
    z.org = new Int32Array(maxPoints * 2);
    z.cur = new Int32Array(maxPoints * 2);
    z.orus = new Int32Array(maxPoints * 2);
    z.tags = new Uint8Array(maxPoints);
    z.contours = new Uint16Array(maxContours);
    z.maxPoints = maxPoints;
    z.maxContours = maxContours;
    return z;
  }
}

/** TT_DefRecord (FDEF / IDEF) */
export interface DefRecord {
  range: number;
  start: number;
  end: number;
  opc: number;
  active: boolean;
  inlineDelta: boolean;
}

/** TT_CodeRange: a window of a byte array */
export interface CodeRange {
  base: Uint8Array | null;
  size: number;
}

/** TT_Size_Metrics */
export interface TtSizeMetrics {
  xRatio: number;
  yRatio: number;
  ppem: number;
  ratio: number;
  scale: number;
  compensations: number[];
  valid: boolean;
  rotated: boolean;
  stretched: boolean;
}

export const newTtSizeMetrics = (): TtSizeMetrics => ({
  xRatio: 0,
  yRatio: 0,
  ppem: 0,
  ratio: 0,
  scale: 0,
  compensations: [0, 0, 0, 0],
  valid: false,
  rotated: false,
  stretched: false,
});

export const cloneTtSizeMetrics = (m: TtSizeMetrics): TtSizeMetrics => ({ ...m, compensations: m.compensations.slice() });

/** FT_Size_Metrics */
export interface SizeMetrics {
  xPpem: number;
  yPpem: number;
  xScale: number;
  yScale: number;
  ascender: number;
  descender: number;
  height: number;
  maxAdvance: number;
}

export const newSizeMetrics = (): SizeMetrics => ({ xPpem: 0, yPpem: 0, xScale: 0, yScale: 0, ascender: 0, descender: 0, height: 0, maxAdvance: 0 });
export const cloneSizeMetrics = (m: SizeMetrics): SizeMetrics => ({ ...m });

export const TT_CODERANGE = { NONE: 0, FONT: 1, CVT: 2, GLYPH: 3 } as const;
